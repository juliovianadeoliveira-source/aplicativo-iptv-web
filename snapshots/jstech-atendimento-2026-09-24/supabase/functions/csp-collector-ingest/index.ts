import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false }
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const serverId = String(body.server_id ?? "");
  const token = String(body.token ?? "");
  const status = String(body.status ?? "");
  const totalUsers = Number(body.total_users ?? 0);
  const activeUsers = Number(body.active_users ?? 0);
  const latencyMs = body.latency_ms == null ? null : Number(body.latency_ms);
  const errorMessage = body.error_message == null ? null : String(body.error_message).slice(0, 500);

  if (!serverId || token.length < 32 || !["online","warning","offline"].includes(status)) {
    return new Response(JSON.stringify({ error: "invalid_payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { error } = await admin.rpc("ingest_csp_snapshot", {
    p_server_id: serverId,
    p_token: token,
    p_status: status,
    p_total_users: Number.isFinite(totalUsers) ? Math.max(0, Math.trunc(totalUsers)) : 0,
    p_active_users: Number.isFinite(activeUsers) ? Math.max(0, Math.trunc(activeUsers)) : 0,
    p_latency_ms: latencyMs == null || !Number.isFinite(latencyMs) ? null : Math.max(0, Math.trunc(latencyMs)),
    p_error_message: errorMessage
  });

  if (error) {
    const authFailure = /token|credencial|revogado|permission|permissão/i.test(error.message);
    return new Response(JSON.stringify({ error: authFailure ? "unauthorized" : "ingest_failed" }), {
      status: authFailure ? 401 : 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
});
