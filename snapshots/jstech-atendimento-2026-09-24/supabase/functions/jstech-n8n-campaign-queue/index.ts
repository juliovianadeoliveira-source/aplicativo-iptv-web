
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const URL = Deno.env.get("SUPABASE_URL")!;
const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secretJson = Deno.env.get("SUPABASE_SECRET_KEYS");
const SERVICE = secretJson ? JSON.parse(secretJson)["default"] : legacy;
if (!SERVICE) throw new Error("backend key unavailable");
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const out = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { return out({ error: "invalid_json" }, 400); }

  const action = String(body?.action || "");
  const token = String(body?.token || "");
  if (!token) return out({ error: "token_required" }, 401);

  if (action === "claim") {
    const { data, error } = await db.rpc("n8n_campaign_claim", {
      p_token: token,
      p_limit: Math.max(1, Math.min(Number(body?.limit || 500), 500)),
    });
    if (error) return out({ error: error.message }, /unauthorized/i.test(error.message) ? 401 : 500);
    return out({ ok: true, items: data || [], count: (data || []).length });
  }

  if (action === "ack") {
    const { data, error } = await db.rpc("n8n_campaign_ack", {
      p_token: token,
      p_delivery_id: body?.delivery_id,
      p_ok: body?.ok === true,
      p_provider_message_id: body?.provider_message_id || null,
      p_error: body?.error || null,
    });
    if (error) return out({ error: error.message }, /unauthorized/i.test(error.message) ? 401 : 500);
    return out({ ok: data === true });
  }

  return out({ error: "unknown_action" }, 400);
});
