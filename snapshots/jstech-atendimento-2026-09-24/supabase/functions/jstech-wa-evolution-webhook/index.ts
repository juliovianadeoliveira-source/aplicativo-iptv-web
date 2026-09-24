
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const legacyService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secretJson = Deno.env.get("SUPABASE_SECRET_KEYS");
const secretKey = secretJson ? JSON.parse(secretJson)["default"] : legacyService;
if (!secretKey) throw new Error("Supabase backend key unavailable");

const db = createClient(SUPABASE_URL, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const normalize = (value = "") =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

function renderNode(node: any) {
  if (!node) return "";
  let out = String(node.text || "").trim();
  const options = Array.isArray(node.options) ? node.options : [];
  if (options.length) {
    out += "\n\n" + options.map((o: any) => String(o.key) + " - " + String(o.label)).join("\n");
  }
  return out.trim();
}

function matchOption(node: any, incoming: string) {
  const v = normalize(incoming);
  const options = Array.isArray(node?.options) ? node.options : [];
  return options.find((o: any) =>
    normalize(String(o.key)) === v || normalize(String(o.label)) === v
  );
}

function responseTextFromOpenAI(data: any) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks: string[] = [];
  for (const item of data?.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part?.type === "output_text" && part?.text) chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

async function aiFallback(settings: any, workspaceId: string, customerText: string) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key || !settings?.ai_enabled) {
    return settings?.fallback_message || "Vou encaminhar sua mensagem para um atendente.";
  }

  const { data: knowledge } = await db
    .from("wa_knowledge")
    .select("title,keywords,content")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .limit(30);

  const normalized = normalize(customerText);
  const relevant = (knowledge || []).filter((k: any) =>
    (k.keywords || []).some((kw: string) => normalized.includes(normalize(kw)))
  );
  const base = (relevant.length ? relevant : (knowledge || []).slice(0, 12))
    .map((k: any) => "### " + k.title + "\n" + k.content)
    .join("\n\n");

  const instructions = [
    settings?.ai_instructions || "",
    "Empresa: " + (settings?.company_name || "JSTech") + ".",
    "Use a base abaixo como fonte de verdade. Não invente preço, prazo, disponibilidade nem condição que não esteja nela.",
    "Se faltar informação, diga que vai encaminhar para um atendente.",
    base ? "BASE DE CONHECIMENTO:\n" + base : "BASE DE CONHECIMENTO: vazia.",
  ].join("\n\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": "Bearer " + key,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: settings?.ai_model || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna",
      instructions,
      input: customerText,
      max_output_tokens: 280,
    }),
  });

  if (!res.ok) return settings?.fallback_message || "Vou encaminhar sua mensagem para um atendente.";
  const data = await res.json();
  return responseTextFromOpenAI(data) ||
    settings?.fallback_message ||
    "Vou encaminhar sua mensagem para um atendente.";
}

async function evo(config: any, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.api_key);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(String(config.base_url).replace(/\/+$/, "") + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function sendText(config: any, to: string, body: string) {
  const path = "/message/sendText/" + encodeURIComponent(config.instance_name);
  let r = await evo(config, path, {
    method: "POST",
    body: JSON.stringify({ number: to, text: body }),
  });
  if (!r.ok && [400, 404, 422].includes(r.status)) {
    r = await evo(config, path, {
      method: "POST",
      body: JSON.stringify({
        number: to,
        options: { delay: 500, presence: "composing" },
        textMessage: { text: body },
      }),
    });
  }
  const id =
    r.data?.key?.id ??
    r.data?.data?.key?.id ??
    r.data?.message?.key?.id ??
    r.data?.messages?.[0]?.id ??
    null;
  return { ok: r.ok, id, detail: r.data };
}

function unwrapPayload(payload: any) {
  const data = payload?.data ?? payload;
  if (Array.isArray(data?.messages) && data.messages.length) return data.messages[0];
  if (Array.isArray(data) && data.length) return data[0];
  return data;
}

function extractText(m: any) {
  const msg = m?.message ?? m?.messages?.[0]?.message ?? {};
  return (
    msg?.conversation ??
    msg?.extendedTextMessage?.text ??
    msg?.imageMessage?.caption ??
    msg?.videoMessage?.caption ??
    msg?.documentMessage?.caption ??
    msg?.buttonsResponseMessage?.selectedDisplayText ??
    msg?.buttonsResponseMessage?.selectedButtonId ??
    msg?.listResponseMessage?.title ??
    msg?.listResponseMessage?.singleSelectReply?.selectedRowId ??
    msg?.templateButtonReplyMessage?.selectedDisplayText ??
    msg?.templateButtonReplyMessage?.selectedId ??
    ""
  );
}

function phoneFromJid(jid = "") {
  return String(jid)
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@c\.us$/i, "")
    .replace(/@lid$/i, "");
}

async function saveOutbound(
  workspaceId: string,
  conversationId: string,
  contactId: string,
  text: string,
  externalId: string | null,
  status: string,
  senderType = "bot",
) {
  await db.from("wa_messages").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    contact_id: contactId,
    direction: "out",
    sender_type: senderType,
    content: text,
    message_type: "text",
    external_message_id: externalId,
    status,
  });
}

async function processIncoming(config: any, payload: any) {
  const raw = unwrapPayload(payload);
  const key = raw?.key ?? raw?.data?.key ?? {};
  if (key?.fromMe === true) return;

  let remoteJid =
    key?.remoteJidAlt ??
    raw?.remoteJidAlt ??
    key?.remoteJid ??
    raw?.remoteJid ??
    "";
  if (!remoteJid || /@g\.us$/i.test(remoteJid) || /status@broadcast/i.test(remoteJid)) return;

  const phone = phoneFromJid(remoteJid);
  const text = String(extractText(raw) || "").trim();
  if (!phone || !text) return;

  const workspaceId = config.workspace_id;
  const profileName = raw?.pushName ?? raw?.notifyName ?? payload?.senderName ?? null;
  const externalId = key?.id ?? raw?.id ?? payload?.id ?? null;

  const { data: settings } = await db
    .from("wa_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .single();

  const { data: contact, error: contactErr } = await db
    .from("wa_contacts")
    .upsert({
      workspace_id: workspaceId,
      phone,
      name: profileName,
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,phone", ignoreDuplicates: false })
    .select("*")
    .single();
  if (contactErr || !contact) throw contactErr || new Error("Falha ao criar contato");

  const { data: conversation, error: convErr } = await db
    .from("wa_conversations")
    .upsert({
      workspace_id: workspaceId,
      contact_id: contact.id,
      channel: "whatsapp",
      last_message_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,contact_id,channel", ignoreDuplicates: false })
    .select("*")
    .single();
  if (convErr || !conversation) throw convErr || new Error("Falha ao criar conversa");

  const { error: msgErr } = await db.from("wa_messages").insert({
    workspace_id: workspaceId,
    conversation_id: conversation.id,
    contact_id: contact.id,
    direction: "in",
    sender_type: "customer",
    content: text,
    message_type: "text",
    external_message_id: externalId,
    status: "received",
    metadata: { provider: "qr", raw_type: raw?.messageType ?? payload?.event ?? "text" },
  });

  if (msgErr && String(msgErr.code) === "23505") return;
  if (msgErr) throw msgErr;

  await db.from("wa_conversations").update({
    unread_count: (conversation.unread_count || 0) + 1,
    last_message_at: new Date().toISOString(),
  }).eq("id", conversation.id);

  if (!contact.bot_enabled) return;

  const { data: automations } = await db
    .from("wa_automations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);

  let selected: any = null;
  let nextNodeKey: string | null = null;
  const context = contact.bot_context || {};

  if (context.automation_id && context.node) {
    selected = (automations || []).find((a: any) => a.id === context.automation_id);
    if (selected) {
      const currentNode = selected.flow?.nodes?.[context.node];
      const opt = matchOption(currentNode, text);
      if (opt?.next) nextNodeKey = opt.next;
    }
  }

  if (!nextNodeKey) {
    const t = normalize(text);
    selected = (automations || []).find((a: any) =>
      (a.trigger_texts || []).some((x: string) => normalize(x) === t)
    );
    if (selected) nextNodeKey = selected.flow?.start || "welcome";
  }

  let reply = "";
  let senderType = "bot";

  if (selected && nextNodeKey) {
    const node = selected.flow?.nodes?.[nextNodeKey];
    if (node) {
      reply = renderNode(node);
      if (node.type === "handoff") {
        await db.from("wa_contacts").update({
          bot_enabled: false,
          bot_context: {},
          updated_at: new Date().toISOString(),
        }).eq("id", contact.id);
        await db.from("wa_conversations")
          .update({ status: "aguardando_atendente" })
          .eq("id", conversation.id);
      } else {
        await db.from("wa_contacts").update({
          bot_context: { automation_id: selected.id, node: nextNodeKey },
          updated_at: new Date().toISOString(),
        }).eq("id", contact.id);
      }
    }
  }

  if (!reply) {
    reply = await aiFallback(settings, workspaceId, text);
    senderType = settings?.ai_enabled ? "ai" : "bot";
  }

  const sent = await sendText(config, phone, reply);
  await saveOutbound(
    workspaceId,
    conversation.id,
    contact.id,
    reply,
    sent.id,
    sent.ok ? "sent" : "failed",
    senderType,
  );

  await db.from("wa_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) return json({ error: "unauthorized" }, 401);

  const { data: config, error: configError } = await db
    .from("wa_bridge_configs")
    .select("*")
    .eq("webhook_secret", token)
    .maybeSingle();
  if (configError || !config) return json({ error: "unauthorized" }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const event = String(payload?.event || payload?.type || "").toLowerCase();

  try {
    if (event.includes("connection")) {
      const state = String(payload?.data?.state ?? payload?.data?.status ?? payload?.state ?? "");
      const connected = ["open", "connected", "online"].includes(state.toLowerCase());
      await db.from("wa_settings").update({
        connection_mode: "qr",
        bridge_connected: connected,
        bridge_phone: payload?.data?.wuid ? phoneFromJid(payload.data.wuid) : undefined,
        bridge_name: payload?.data?.profileName ?? payload?.data?.name ?? undefined,
        updated_at: new Date().toISOString(),
      }).eq("workspace_id", config.workspace_id);
      await db.from("wa_bridge_configs").update({
        last_status: state || (connected ? "connected" : "disconnected"),
        updated_at: new Date().toISOString(),
      }).eq("workspace_id", config.workspace_id);
      return json({ ok: true });
    }

    if (event && !event.includes("messages.upsert") && !event.includes("messages_upsert") && event !== "message") {
      return json({ ok: true, ignored: true });
    }

    await processIncoming(config, payload);
    return json({ ok: true });
  } catch (error) {
    console.error("Evolution webhook error", error);
    return json({ ok: false, error: "processing_failed" }, 500);
  }
});
