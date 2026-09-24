
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sj = Deno.env.get("SUPABASE_SECRET_KEYS");
const SERVICE = sj ? JSON.parse(sj)["default"] : legacy;
if (!SERVICE) throw new Error("backend key unavailable");

const db = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const str = (...v: any[]) => {
  for (const x of v) if (x !== undefined && x !== null && String(x).trim()) return String(x).trim();
  return "";
};

const num = (...v: any[]) => {
  for (const x of v) {
    if (x === undefined || x === null || x === "") continue;
    const n = Number(String(x).replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
};

function pick(body: any) {
  const data = body?.data ?? body?.pix ?? body?.payment ?? body;
  const meta = data?.metadata ?? body?.metadata ?? {};
  return {
    externalEventId: str(body?.id, body?.event_id, body?.eventId, data?.event_id, data?.eventId),
    externalPaymentId: str(
      data?.id,
      data?.payment_id,
      data?.paymentId,
      data?.charge_id,
      data?.chargeId,
      body?.payment_id,
      body?.paymentId
    ),
    internalPaymentId: str(meta?.payment_id, meta?.paymentId, data?.metadata?.payment_id),
    eventType: str(body?.type, body?.event, data?.type, data?.event),
    status: str(data?.status, body?.status, data?.situacao, data?.state).toLowerCase(),
    amount: num(data?.amount, data?.value, data?.valor, data?.pix?.valor, body?.amount, body?.value),
    txid: str(data?.txid, data?.pix?.txid, body?.txid),
    e2e: str(
      data?.end_to_end_id,
      data?.endToEndId,
      data?.e2e_id,
      data?.e2eId,
      data?.pix?.endToEndId,
      body?.end_to_end_id,
      body?.endToEndId
    ),
  };
}

function isPaidStatus(status: string, eventType: string) {
  const s = (status + " " + eventType).toLowerCase();
  return /paid|pago|confirmed|confirmado|completed|concluido|concluído|pix\.received|pix_received|received/.test(s);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const token = url.searchParams.get("token") || req.headers.get("x-webhook-token") || "";
  const provider = url.searchParams.get("provider") || req.headers.get("x-payment-provider") || "generic_pix";
  if (!token) return json({ error: "unauthorized" }, 401);

  const { data: cfg } = await db
    .from("wa_payment_provider_configs")
    .select("*")
    .eq("provider", provider)
    .eq("webhook_secret", token)
    .eq("enabled", true)
    .maybeSingle();

  if (!cfg) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const e = pick(body);
  const paid = isPaidStatus(e.status, e.eventType);
  const receivedAt = new Date().toISOString();

  let payment: any = null;

  if (e.internalPaymentId) {
    const r = await db.from("wa_payments").select("*")
      .eq("id", e.internalPaymentId)
      .eq("workspace_id", cfg.workspace_id)
      .maybeSingle();
    payment = r.data;
  }

  if (!payment && e.externalPaymentId) {
    const r = await db.from("wa_payments").select("*")
      .eq("workspace_id", cfg.workspace_id)
      .eq("provider_payment_id", e.externalPaymentId)
      .maybeSingle();
    payment = r.data;
  }

  if (!payment && e.e2e) {
    const r = await db.from("wa_payments").select("*")
      .eq("workspace_id", cfg.workspace_id)
      .eq("pix_end_to_end_id", e.e2e)
      .maybeSingle();
    payment = r.data;
  }

  if (!payment && e.txid) {
    const r = await db.from("wa_payments").select("*")
      .eq("workspace_id", cfg.workspace_id)
      .eq("pix_txid", e.txid)
      .maybeSingle();
    payment = r.data;
  }

  if (!payment && (e.e2e || e.txid)) {
    const ref = e.e2e || e.txid;
    const rr = await db.from("wa_payment_receipts")
      .select("payment_id")
      .eq("workspace_id", cfg.workspace_id)
      .eq("detected_reference", ref)
      .not("payment_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rr.data?.payment_id) {
      const r = await db.from("wa_payments").select("*")
        .eq("id", rr.data.payment_id)
        .eq("workspace_id", cfg.workspace_id)
        .maybeSingle();
      payment = r.data;
    }
  }

  const signatureValid = true;

  const { data: eventRow } = await db.from("wa_payment_provider_events").insert({
    workspace_id: cfg.workspace_id,
    provider,
    external_event_id: e.externalEventId || null,
    external_payment_id: e.externalPaymentId || null,
    event_type: e.eventType || null,
    amount: e.amount,
    status: e.status || null,
    pix_txid: e.txid || null,
    pix_end_to_end_id: e.e2e || null,
    payload: body,
    signature_valid: signatureValid,
    processed: false,
  }).select("id").maybeSingle();

  if (!paid) {
    if (eventRow?.id) {
      await db.from("wa_payment_provider_events").update({
        processed: true,
        processed_at: receivedAt,
        error: "event_not_paid",
      }).eq("id", eventRow.id);
    }
    return json({ ok: true, ignored: true, reason: "not_paid_event" });
  }

  if (!payment) {
    if (eventRow?.id) {
      await db.from("wa_payment_provider_events").update({
        error: "payment_not_matched",
      }).eq("id", eventRow.id);
    }
    return json({ ok: false, error: "payment_not_matched" }, 409);
  }

  const expected = Number(payment.amount || 0);
  if (e.amount === null || Math.abs(expected - e.amount) > 0.001) {
    if (eventRow?.id) {
      await db.from("wa_payment_provider_events").update({
        error: "amount_mismatch",
      }).eq("id", eventRow.id);
    }
    return json({
      ok: false,
      error: "amount_mismatch",
      expected,
      received: e.amount,
    }, 409);
  }

  const verificationPayload = {
    provider,
    event_id: e.externalEventId || null,
    provider_payment_id: e.externalPaymentId || null,
    txid: e.txid || null,
    end_to_end_id: e.e2e || null,
    amount: e.amount,
    confirmed_at: receivedAt,
  };

  const { error: payErr } = await db.from("wa_payments").update({
    provider,
    provider_payment_id: e.externalPaymentId || payment.provider_payment_id || null,
    pix_txid: e.txid || payment.pix_txid || null,
    pix_end_to_end_id: e.e2e || payment.pix_end_to_end_id || null,
    bank_verified_at: receivedAt,
    verification_source: provider === "generic_pix" ? "gateway_webhook" : "bank_webhook",
    verification_payload: verificationPayload,
    status: "pago",
    paid_at: receivedAt,
    updated_at: receivedAt,
  }).eq("id", payment.id).eq("workspace_id", cfg.workspace_id);

  if (payErr) {
    if (eventRow?.id) {
      await db.from("wa_payment_provider_events").update({
        error: String(payErr.message || payErr),
      }).eq("id", eventRow.id);
    }
    return json({ ok: false, error: "payment_update_failed" }, 500);
  }

  await db.from("wa_payment_receipts").update({
    bank_match: true,
    bank_match_at: receivedAt,
    verified_at: receivedAt,
    status: "bank_verified",
    updated_at: receivedAt,
  }).eq("payment_id", payment.id);

  if (eventRow?.id) {
    await db.from("wa_payment_provider_events").update({
      processed: true,
      processed_at: receivedAt,
      error: null,
    }).eq("id", eventRow.id);
  }

  if (payment.conversation_id && payment.contact_id) {
    await db.from("wa_messages").insert({
      workspace_id: cfg.workspace_id,
      conversation_id: payment.conversation_id,
      contact_id: payment.contact_id,
      direction: "out",
      sender_type: "bot",
      content: "Pagamento PIX confirmado no banco. Já estou liberando/renovando seu acesso automaticamente.",
      message_type: "text",
      status: "queued",
      metadata: {
        payment_id: payment.id,
        bank_verified: true,
        provider,
      },
    });
  }

  let { data: activationJob } = await db.from("wa_panel_jobs")
    .select("id,status,action_type")
    .eq("payment_id", payment.id)
    .in("action_type", ["activate","renew","create_user"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activationJob) {
    let connectorId = payment.connector_id || null;
    let username = String(payment.username || payment.metadata?.username || "").trim();
    let panelAccount: any = null;

    if (payment.panel_account_id) {
      const r = await db.from("wa_panel_accounts").select("*")
        .eq("id", payment.panel_account_id)
        .eq("workspace_id", cfg.workspace_id)
        .maybeSingle();
      panelAccount = r.data || null;
    }

    if (!panelAccount && payment.contact_id) {
      const r = await db.from("wa_panel_accounts").select("*")
        .eq("workspace_id", cfg.workspace_id)
        .eq("contact_id", payment.contact_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      panelAccount = r.data || null;
    }

    connectorId = connectorId || panelAccount?.connector_id || null;
    username = username || String(panelAccount?.username || "").trim();

    if (connectorId) {
      const { data: contact } = await db.from("wa_contacts")
        .select("name,phone")
        .eq("id", payment.contact_id)
        .eq("workspace_id", cfg.workspace_id)
        .maybeSingle();

      const planDays = Number(payment.plan_days || payment.metadata?.plan_days || panelAccount?.plan_days || 30);
      const screenCount = Number(payment.screen_count || payment.metadata?.screen_count || panelAccount?.screen_count || 1);

      const ins = await db.from("wa_panel_jobs").insert({
        workspace_id: cfg.workspace_id,
        contact_id: payment.contact_id,
        conversation_id: payment.conversation_id,
        connector_id: connectorId,
        action_type: username ? "renew" : "create_user",
        app_name: payment.app_name || panelAccount?.app_name || null,
        app_catalog_id: payment.app_catalog_id || panelAccount?.app_catalog_id || null,
        plan_days: planDays,
        screen_count: screenCount,
        customer_name: contact?.name || null,
        customer_phone: contact?.phone || null,
        payment_id: payment.id,
        status: "pending",
        requested_username: username || null,
        payload: {
          ...(username ? { username } : {}),
          payment_confirmed: true,
          bank_verified: true,
          provider,
          plan_days: planDays,
          screen_count: screenCount
        }
      }).select("id,status,action_type").single();

      if (!ins.error) activationJob = ins.data;
    }
  }

  return json({
    ok: true,
    payment_id: payment.id,
    bank_verified: true,
    activation_queued: !!activationJob,
    activation_job_id: activationJob?.id || null,
    activation_status: activationJob?.status || null,
    activation_action: activationJob?.action_type || null,
  });
});
