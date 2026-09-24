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

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return safeEqual("sha256=" + hex(digest), signature.toLowerCase());
}

function extractIncoming(message: any) {
  if (!message) return { text: "", type: "unknown" };
  if (message.type === "text") return { text: message.text?.body ?? "", type: "text" };
  if (message.type === "button") {
    return { text: message.button?.payload || message.button?.text || "", type: "button" };
  }
  if (message.type === "interactive") {
    const button = message.interactive?.button_reply;
    const list = message.interactive?.list_reply;
    return {
      text: button?.id || button?.title || list?.id || list?.title || "",
      type: "interactive",
    };
  }
  return { text: "", type: message.type || "unknown" };
}

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

async function sendMetaText(phoneNumberId: string, to: string, body: string) {
  const token = Deno.env.get("META_WHATSAPP_TOKEN");
  const graphVersion = Deno.env.get("META_GRAPH_VERSION");
  if (!token || !graphVersion) {
    return { ok: false, setupMissing: true, id: null, detail: "META_WHATSAPP_TOKEN/META_GRAPH_VERSION ausente" };
  }

  const res = await fetch("https://graph.facebook.com/" + graphVersion + "/" + phoneNumberId + "/messages", {
    method: "POST",
    headers: {
      "authorization": "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: false },
    }),
  });

  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    setupMissing: false,
    id: data?.messages?.[0]?.id ?? null,
    detail: res.ok ? null : data,
  };
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

async function processMessage(value: any, message: any) {
  const phoneNumberId = value?.metadata?.phone_number_id;
  const from = message?.from;
  if (!phoneNumberId || !from) return;

  const incoming = extractIncoming(message);
  if (!incoming.text) return;

  const { data: settings } = await db
    .from("wa_settings")
    .select("*")
    .eq("meta_phone_number_id", phoneNumberId)
    .eq("meta_connected", true)
    .maybeSingle();

  if (!settings?.workspace_id) return;

  const workspaceId = settings.workspace_id;
  const profileName = value?.contacts?.[0]?.profile?.name || null;

  await db.from("wa_webhook_events").insert({
    workspace_id: workspaceId,
    external_event_id: message.id || null,
    payload: { value, message },
  });

  const { data: contact, error: contactErr } = await db
    .from("wa_contacts")
    .upsert({
      workspace_id: workspaceId,
      phone: from,
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
    content: incoming.text,
    message_type: incoming.type,
    external_message_id: message.id || null,
    status: "received",
    metadata: { raw_type: message.type },
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
      const opt = matchOption(currentNode, incoming.text);
      if (opt?.next) nextNodeKey = opt.next;
    }
  }

  if (!nextNodeKey) {
    const t = normalize(incoming.text);
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
    reply = await aiFallback(settings, workspaceId, incoming.text);
    senderType = settings.ai_enabled ? "ai" : "bot";
  }

  const sent = await sendMetaText(phoneNumberId, from, reply);
  await saveOutbound(
    workspaceId,
    conversation.id,
    contact.id,
    reply,
    sent.id,
    sent.ok ? "sent" : (sent.setupMissing ? "pending_setup" : "failed"),
    senderType,
  );

  await db.from("wa_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const verifyToken = Deno.env.get("META_VERIFY_TOKEN");
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (verifyToken && mode === "subscribe" && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("verification failed", { status: 403 });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appSecret) return json({ error: "META_APP_SECRET_not_configured" }, 503);

  const raw = await req.text();
  const ok = await validSignature(raw, req.headers.get("x-hub-signature-256"), appSecret);
  if (!ok) return json({ error: "invalid_signature" }, 401);

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  try {
    for (const entry of payload?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value;
        for (const message of value?.messages || []) {
          await processMessage(value, message);
        }
      }
    }
    return json({ ok: true });
  } catch (error) {
    console.error("Webhook processing error", error);
    return json({ ok: false, error: "processing_failed" }, 500);
  }
});