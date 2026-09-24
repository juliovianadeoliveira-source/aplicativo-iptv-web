import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const url = Deno.env.get("SUPABASE_URL")!;
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const publishableKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function countMatches(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches?.length) return matches.length;
  }
  return 0;
}

function parseStatus(xml: string) {
  const total = countMatches(xml, [
    /<(?:user|proxy-user|proxyuser)\b/gi,
    /<(?:client|session)\b/gi,
  ]);
  const active = countMatches(xml, [
    /<(?:user|proxy-user|proxyuser)\b[^>]*(?:connected|online|active)=["'](?:true|1|yes|online|connected)["'][^>]*>/gi,
    /<(?:client|session)\b[^>]*(?:connected|online|active)=["'](?:true|1|yes|online|connected)["'][^>]*>/gi,
    /<(?:user|proxy-user|proxyuser|client|session)\b[^>]*>[^<]*(?:online|connected)[^<]*<\//gi,
  ]);
  const declaredTotal = xml.match(/<(?:total-users|total_users|users-count|usercount)>\s*(\d+)\s*<\//i);
  const declaredActive = xml.match(/<(?:active-users|active_users|active-count|connected-users)>\s*(\d+)\s*<\//i);
  return {
    total: declaredTotal ? Number(declaredTotal[1]) : total,
    active: declaredActive ? Number(declaredActive[1]) : active,
  };
}

function safeTarget(protocol: string, host: string, port: number, path: string) {
  if (!["http", "https"].includes(protocol)) throw new Error("Protocolo inválido");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Porta inválida");
  const normalizedHost = host.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])$/i.test(normalizedHost)) throw new Error("Endereço inválido");
  if (normalizedHost === "localhost" || normalizedHost.endsWith(".local") ||
      /^127\./.test(normalizedHost) || /^10\./.test(normalizedHost) ||
      /^192\.168\./.test(normalizedHost) || /^169\.254\./.test(normalizedHost) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(normalizedHost) ||
      normalizedHost === "0.0.0.0" || normalizedHost === "[::1]") {
    throw new Error("Use um IP ou domínio público");
  }
  const cleanPath = path.startsWith("/") ? path : "/" + path;
  return `${protocol}://${host}:${port}${cleanPath}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  let serverId = "";
  try {
    const body = await req.json();
    serverId = String(body.server_id || "");
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(serverId)) return json({ error: "invalid_server" }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile } = await admin.from("profiles").select("role,active").eq("id", user.id).single();
  if (!profile?.active || !["owner", "admin", "operator"].includes(profile.role)) {
    return json({ error: "forbidden" }, 403);
  }

  const { data: server, error: serverError } = await admin.from("csp_servers")
    .select("id,host,status_port,protocol,status_path,enabled")
    .eq("id", serverId).single();
  if (serverError || !server) return json({ error: "server_not_found" }, 404);
  if (!server.enabled) return json({ error: "server_disabled" }, 409);

  const started = Date.now();
  let status = "offline";
  let totalUsers = 0;
  let activeUsers = 0;
  let latencyMs: number | null = null;
  let errorMessage: string | null = null;

  try {
    const target = safeTarget(server.protocol, server.host, server.status_port,
      server.status_path || "/xmlHandler?command=proxy-users&hide-inactive=false");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response: Response;
    try {
      response = await fetch(target, {
        method: "GET",
        headers: { "Accept": "application/xml,text/xml,text/plain,*/*" },
        signal: controller.signal,
        redirect: "manual",
      });
    } finally {
      clearTimeout(timeout);
    }
    latencyMs = Date.now() - started;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error("resposta vazia");
    const parsed = parseStatus(text);
    totalUsers = parsed.total;
    activeUsers = parsed.active;
    status = "online";
  } catch (error) {
    latencyMs = Date.now() - started;
    const rawError = String(error instanceof Error ? error.message : error);
    if (/invalid HTTP version/i.test(rawError)) {
      status = "warning";
      errorMessage = "Porta acessível, mas não é a porta HTTP de status";
    } else {
      errorMessage = error instanceof DOMException && error.name === "AbortError"
        ? "tempo de resposta esgotado"
        : rawError.slice(0, 300);
    }
  }

  const now = new Date().toISOString();
  const { error: updateError } = await admin.from("csp_servers").update({
    current_sessions: activeUsers,
    health_status: status,
    last_seen_at: status !== "offline" ? now : null,
    last_latency_ms: latencyMs,
    last_error: errorMessage,
    updated_at: now,
  }).eq("id", serverId);
  if (updateError) return json({ error: "update_failed" }, 500);

  await admin.from("csp_snapshots").insert({
    server_id: serverId,
    status,
    total_users: totalUsers,
    active_users: activeUsers,
    latency_ms: latencyMs,
    error_message: errorMessage,
  });

  return json({
    ok: status === "online",
    status,
    total_users: totalUsers,
    active_users: activeUsers,
    latency_ms: latencyMs,
    error: errorMessage,
  }, status === "offline" ? 502 : 200);
});