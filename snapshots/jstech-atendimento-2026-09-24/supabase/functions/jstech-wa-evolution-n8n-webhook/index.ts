
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

function directMessageText(value:string){
  return String(value||"")
    .replace(/^\s*(?:ana|atendente|assistente|você|voce)\s*[,;:-]?\s*(?:disse|respondeu)?\s*:?\s*/i,"")
    .replace(/^\s*[^\n]{1,50},\s*disse:\s*/i,"")
    .replace(/^\s*(?:resposta|mensagem)\s+(?:ao|para o)\s+cliente\s*:\s*/i,"")
    .trim();
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

function openAIWebSources(data:any){
  const out:{url:string,title?:string}[]=[];
  const seen=new Set<string>();
  for(const item of data?.output||[]){
    if(item?.type==="web_search_call"){
      for(const s of item?.action?.sources||[]){
        const url=String(s?.url||"").trim();
        if(url&&!seen.has(url)){seen.add(url);out.push({url,title:s?.title});}
      }
    }
    for(const part of item?.content||[]){
      for(const a of part?.annotations||[]){
        if(a?.type==="url_citation"){
          const url=String(a?.url||"").trim();
          if(url&&!seen.has(url)){seen.add(url);out.push({url,title:a?.title});}
        }
      }
    }
  }
  return out;
}

function geminiWebSources(data:any){
  const out:{url:string,title?:string}[]=[];
  const seen=new Set<string>();
  const gm=data?.candidates?.[0]?.groundingMetadata;
  for(const chunk of gm?.groundingChunks||[]){
    const url=String(chunk?.web?.uri||"").trim();
    const title=String(chunk?.web?.title||"").trim();
    if(url&&!seen.has(url)){seen.add(url);out.push({url,title});}
  }
  return out;
}

function attachRequestedSources(text:string,sources:{url:string,title?:string}[],wantsVideo:boolean,asksSource:boolean){
  let answer=String(text||"").trim();
  if(!answer)return answer;
  const hasUrl=/https?:\/\/\S+/i.test(answer);

  if(wantsVideo&&!hasUrl){
    const yt=sources.find(s=>/youtube\.com|youtu\.be/i.test(s.url)||/youtube/i.test(String(s.title||"")));
    if(yt)answer+="\n\nVídeo: "+yt.url;
  }else if(asksSource&&!hasUrl&&sources.length){
    answer+="\n\nFonte: "+sources.slice(0,2).map(s=>s.url).join("\n");
  }
  return answer;
}

async function aiFallback(settings: any, workspaceId: string, conversationId: string, contactId: string, customerText: string) {
  if (!settings?.ai_enabled) {
    return settings?.fallback_message || "Vou encaminhar sua mensagem para um atendente.";
  }

  const [{ data: knowledge }, { data: history }] = await Promise.all([
    db.from("wa_knowledge")
      .select("title,keywords,content")
      .eq("workspace_id", workspaceId)
      .eq("enabled", true)
      .limit(30),
    db.from("wa_messages")
      .select("direction,sender_type,content,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(18),
  ]);

  const normalized = normalize(customerText);
  const wantsVideo=/\b(video|vídeo|youtube|tutorial|passo a passo|manda video|manda vídeo|me manda um video|me manda um vídeo)\b/i.test(normalized);
  const asksSource=/\b(fonte|link da fonte|onde viu|onde vc viu|onde você viu|de onde tirou)\b/i.test(normalized);
  const webSearchEnabled=settings?.web_research_enabled!==false;
  const relevant = (knowledge || []).filter((k: any) =>
    (k.keywords || []).some((kw: string) => normalized.includes(normalize(kw)))
  );
  const base = (relevant.length ? relevant : (knowledge || []).slice(0, 12))
    .map((k: any) => "### " + k.title + "\n" + k.content)
    .join("\n\n");

  const memoryRows=(history||[]).slice().reverse();
  const hist = memoryRows.map((m: any) => {
    const who = m.direction === "in"
      ? "Cliente"
      : (m.sender_type === "human" ? "Atendente humano" : (settings?.virtual_agent_name || "Ana"));
    return who + ": " + String(m.content || "").slice(0, 700);
  }).join("\n");

  const geminiMemory=memoryRows.map((m:any)=>({
    role:m.direction==="in"?"user":"model",
    parts:[{text:String(m.content||"").slice(0,1000)}]
  }));
  const openAiMemory=memoryRows.map((m:any)=>({
    role:m.direction==="in"?"user":"assistant",
    content:String(m.content||"").slice(0,1000)
  }));

  const agentName = String(settings?.virtual_agent_name || "Ana").trim() || "Ana";
  const companyName = String(settings?.company_name || "JSTech").trim() || "JSTech";

  const instructions = [
    settings?.ai_instructions || "",
    "Você é " + agentName + ", atendente de suporte e vendas da equipe " + companyName + ".",
    "Converse como atendimento natural de WhatsApp, com frases curtas, linguagem informal e sem formalidade exagerada.",
    settings?.humanized_abbreviations !== false
      ? "Use abreviações comuns como vc, pq, tbm e né de vez em quando, sem exagero."
      : "",
    settings?.humanized_emojis !== false
      ? "Use no máximo 1 ou 2 emojis amigáveis quando fizer sentido, sem usar em toda resposta."
      : "Não use emojis.",
    "Não mande textos enormes. Prefira respostas curtas; respostas maiores serão divididas em mensagens separadas pelo sistema.",
    "Entenda gírias, abreviações, erros de digitação e frases incompletas sem corrigir o português do cliente.",
    "Tenha empatia e persistência comercial. Se houver dúvida ou resistência ao preço, converse com calma e explique os benefícios.",
    "Mantenha o contexto. Não repita perguntas que o cliente já respondeu.",
    "Responda primeiro ao que o cliente acabou de perguntar e faça no máximo uma pergunta útil por mensagem.",
    "Use a base abaixo como fonte de verdade. Não invente preço, prazo, disponibilidade nem condição que não esteja nela.",
    "Se faltar informação interna necessária, diga que vai conferir em vez de inventar.",
    webSearchEnabled ? "AGENTE DE PESQUISA NA WEB ATIVO: quando a dúvida exigir informação externa, atualizada, rara ou técnica que não esteja clara na base, use a ferramenta de pesquisa antes de responder." : "",
    webSearchEnabled ? "Na pesquisa, procure primeiro documentação e site oficial. Quando ajudar, consulte também resultados públicos de fóruns, páginas técnicas e outras fontes da web. Cruze as informações antes de responder." : "",
    webSearchEnabled ? "Se o cliente pedir vídeo ou tutorial, procure no YouTube um material que corresponda ao aparelho, aplicativo, modelo ou erro citado e envie no máximo um link direto realmente relacionado." : "",
    webSearchEnabled ? "Se houver informações conflitantes entre fontes, não invente. Dê preferência à fonte oficial ou mais recente e diga ao cliente que encontrou divergência." : "",
    webSearchEnabled ? "Pesquise apenas conteúdo público. Não tente acessar conta privada, grupo fechado, login ou conteúdo particular." : "",
    hist ? "HISTÓRICO RECENTE:\n" + hist : "",
    base ? "BASE DE CONHECIMENTO:\n" + base : "BASE DE CONHECIMENTO: vazia.",
  ].filter(Boolean).join("\n\n");

  const engine = String(settings?.conversation_engine || "openai").toLowerCase();
  const configured = String(settings?.ai_model || "").trim();

  if (engine === "gemini") {
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return settings?.fallback_message || "Vou conferir isso pra vc e já sigo daqui.";
    const model = configured.toLowerCase().startsWith("gemini")
      ? configured
      : (Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash");

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": geminiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [
            ...geminiMemory,
            { role: "user", parts: [{ text: customerText }] }
          ],
          ...(webSearchEnabled ? { tools: [{ googleSearch: {} }] } : {}),
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 360,
          },
        }),
      },
    );

    if (!res.ok) {
      console.error("Gemini conversation error", res.status, await res.text().catch(() => ""));
      return settings?.fallback_message || "Vou conferir isso pra vc e já sigo daqui.";
    }
    const data = await res.json();
    const answer=String(
      data?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||"").join("") || ""
    ).trim();
    return attachRequestedSources(
      answer || settings?.fallback_message || "Vou conferir isso pra vc e já sigo daqui.",
      geminiWebSources(data),
      wantsVideo,
      asksSource
    );
  }

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAiKey) return settings?.fallback_message || "Vou conferir isso pra vc e já sigo daqui.";
  const model = configured && !configured.toLowerCase().startsWith("gemini")
    ? configured
    : (Deno.env.get("OPENAI_MODEL") || "gpt-4o");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": "Bearer " + openAiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions,
      input: [
        ...openAiMemory,
        { role: "user", content: customerText }
      ],
      ...(webSearchEnabled ? {
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        include: ["web_search_call.action.sources"]
      } : {}),
      max_output_tokens: 360,
    }),
  });

  if (!res.ok) {
    console.error("OpenAI conversation error", res.status, await res.text().catch(() => ""));
    return settings?.fallback_message || "Vou conferir isso pra vc e já sigo daqui.";
  }
  const data = await res.json();
  const answer=responseTextFromOpenAI(data) ||
    settings?.fallback_message ||
    "Vou conferir isso pra vc e já sigo daqui.";
  return attachRequestedSources(answer,openAIWebSources(data),wantsVideo,asksSource);
}

async function evo(config: any, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", config.api_key);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(String(config.base_url).replace(/\/+$/, "") + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function humanizedDelayMs(text: string, minMs = 1800, maxMs = 5000) {
  const min = Math.max(800, Math.min(Number(minMs || 1800), 5000));
  const max = Math.max(min, Math.min(Number(maxMs || 5000), 5000));
  const calculated = 1200 + String(text || "").length * 20;
  return Math.max(min, Math.min(max, calculated));
}

function splitHumanized(text: string) {
  const clean = String(text || "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length < 140) return [clean];

  const paragraphs = clean.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  if (paragraphs.length >= 2 && paragraphs.length <= 3 && paragraphs.every((x) => x.length <= 420)) {
    return paragraphs;
  }

  const sentences = (clean.match(/[^.!?\n]+(?:[.!?]+|$)/g) || [clean])
    .map((x) => x.trim())
    .filter(Boolean);
  if (sentences.length < 2) return [clean];

  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? current + " " + sentence : sentence;
    if (current && candidate.length > 210 && parts.length < 2) {
      parts.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current.trim());
  if (parts.length > 3) return [parts[0], parts[1], parts.slice(2).join(" ")];
  return parts.filter(Boolean);
}

async function sendText(config: any, to: string, body: string, delayMs = 2500) {
  const path = "/message/sendText/" + encodeURIComponent(config.instance_name);
  const payload = {
    number: to,
    text: body,
    delay: Math.max(500, Math.min(Number(delayMs || 2500), 5000)),
  };

  let r = await evo(config, path, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!r.ok && [400, 404, 422].includes(r.status)) {
    r = await evo(config, path, {
      method: "POST",
      body: JSON.stringify({
        number: to,
        options: {
          delay: Math.max(500, Math.min(Number(delayMs || 2500), 5000)),
          presence: "composing",
        },
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

function mediaInfo(raw: any) {
  const msg = raw?.message ?? raw?.messages?.[0]?.message ?? {};
  const entries: any[] = [
    ["image", msg?.imageMessage],
    ["document", msg?.documentMessage],
    ["video", msg?.videoMessage],
    ["audio", msg?.audioMessage],
  ];
  for (const [kind, node] of entries) {
    if (node) return {
      kind,
      node,
      mimetype: String(node?.mimetype || ""),
      fileName: String(node?.fileName || ""),
    };
  }
  return null;
}

async function getMediaBase64(config: any, raw: any) {
  const path = "/chat/getBase64FromMediaMessage/" + encodeURIComponent(config.instance_name);
  const r = await evo(config, path, {
    method: "POST",
    body: JSON.stringify({ message: raw }),
  });
  if (!r.ok) return null;
  const d = r.data?.data ?? r.data ?? {};
  return {
    base64: d?.base64 || null,
    mimetype: d?.mimetype || null,
    fileName: d?.fileName || null,
    mediaType: d?.mediaType || null,
    caption: d?.caption || null,
  };
}

function rawBase64(value:string){
  const s=String(value||"").trim();
  return s.includes(",")?s.split(",",2)[1]:s;
}

function base64ToBytes(value:string){
  const bin=atob(rawBase64(value));
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes:Uint8Array){
  let out="";
  const size=0x8000;
  for(let i=0;i<bytes.length;i+=size){
    out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+size,bytes.length)));
  }
  return btoa(out);
}

async function sha256Hex(bytes:Uint8Array){
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}

async function voiceConfig(workspaceId:string){
  const {data}=await db.from("wa_voice_configs")
    .select("*").eq("workspace_id",workspaceId).maybeSingle();
  return data||null;
}

async function elevenApiKey(workspaceId:string){
  const {data,error}=await db.rpc("voice_agent_get_elevenlabs_api_key",{p_workspace_id:workspaceId});
  if(error)return "";
  return String(data||"").trim();
}

async function captureOwnerVoiceSample(config:any,raw:any,workspaceId:string,externalId:string|null){
  const cfg=await voiceConfig(workspaceId);
  if(!cfg?.enabled||cfg?.auto_capture_owner_voice!==true)return {handled:false};
  if(cfg.voice_id&&cfg.clone_status==="ready")return {handled:true,status:"already_ready"};

  const apiKey=await elevenApiKey(workspaceId);
  if(!apiKey){
    await db.from("wa_voice_configs").update({
      clone_status:"waiting_api_key",
      last_error:"elevenlabs_api_key_missing",
      updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    return {handled:true,status:"waiting_api_key"};
  }

  const media=await getMediaBase64(config,raw);
  if(!media?.base64){
    await db.from("wa_voice_configs").update({
      clone_status:"waiting_sample",
      last_error:"owner_audio_download_failed",
      updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    return {handled:true,status:"sample_download_failed"};
  }

  const bytes=base64ToBytes(media.base64);
  if(bytes.length<8000){
    await db.from("wa_voice_configs").update({
      clone_status:"waiting_sample",
      last_error:"owner_audio_too_short",
      updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    return {handled:true,status:"sample_too_short"};
  }

  await db.from("wa_voice_configs").update({
    clone_status:"cloning",
    last_error:null,
    updated_at:new Date().toISOString()
  }).eq("workspace_id",workspaceId);

  const mime=String(media.mimetype||"audio/ogg").split(";")[0]||"audio/ogg";
  const ext=mime.includes("mpeg")||mime.includes("mp3")?"mp3":mime.includes("mp4")?"m4a":"ogg";
  const form=new FormData();
  form.append("name",String(cfg.voice_name||"Julio - WhatsApp"));
  form.append("files",new Blob([bytes],{type:mime}),"whatsapp-voice."+ext);
  form.append("remove_background_noise","false");
  form.append("description","Voz própria capturada de um áudio enviado pelo titular no WhatsApp.");

  const res=await fetch("https://api.elevenlabs.io/v1/voices/add",{
    method:"POST",
    headers:{"xi-api-key":apiKey},
    body:form,
    signal:AbortSignal.timeout(60000)
  });

  const payload=await res.json().catch(()=>({}));
  if(!res.ok||!payload?.voice_id){
    await db.from("wa_voice_configs").update({
      clone_status:"error",
      last_error:"elevenlabs_clone_failed_"+res.status,
      updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    console.error("ElevenLabs clone error",res.status,JSON.stringify(payload).slice(0,900));
    return {handled:true,status:"clone_failed"};
  }

  const requiresVerification=payload?.requires_verification===true;
  await db.from("wa_voice_configs").update({
    voice_id:String(payload.voice_id),
    clone_status:requiresVerification?"verification_required":"ready",
    last_sample_external_message_id:externalId,
    last_sample_hash:await sha256Hex(bytes),
    last_sample_mime:mime,
    last_sample_at:new Date().toISOString(),
    cloned_at:requiresVerification?null:new Date().toISOString(),
    last_error:requiresVerification?"elevenlabs_verification_required":null,
    updated_at:new Date().toISOString()
  }).eq("workspace_id",workspaceId);

  return {handled:true,status:requiresVerification?"verification_required":"ready"};
}

async function transcribeCustomerAudio(config:any,raw:any,workspaceId:string){
  const cfg=await voiceConfig(workspaceId);
  if(!cfg?.enabled)return null;
  const openAiKey=Deno.env.get("OPENAI_API_KEY");
  if(!openAiKey)return null;

  const media=await getMediaBase64(config,raw);
  if(!media?.base64)return null;

  const bytes=base64ToBytes(media.base64);
  const mime=String(media.mimetype||"audio/ogg").split(";")[0]||"audio/ogg";
  const ext=mime.includes("mpeg")||mime.includes("mp3")?"mp3":mime.includes("mp4")?"m4a":mime.includes("wav")?"wav":mime.includes("webm")?"webm":"ogg";
  const form=new FormData();
  form.append("file",new Blob([bytes],{type:mime}),"cliente."+ext);
  form.append("model",String(cfg.transcription_model||"whisper-1"));
  form.append("language","pt");
  form.append("response_format","json");

  const res=await fetch("https://api.openai.com/v1/audio/transcriptions",{
    method:"POST",
    headers:{"authorization":"Bearer "+openAiKey},
    body:form,
    signal:AbortSignal.timeout(60000)
  });
  if(!res.ok){
    console.error("Whisper transcription error",res.status,(await res.text().catch(()=>"")).slice(0,800));
    return null;
  }
  const data=await res.json().catch(()=>({}));
  const text=String(data?.text||"").trim();
  return text||null;
}

async function synthesizeOwnerVoice(workspaceId:string,text:string){
  const cfg=await voiceConfig(workspaceId);
  if(!cfg?.enabled||cfg?.reply_audio_when_customer_audio!==true||cfg?.clone_status!=="ready"||!cfg?.voice_id)return null;
  const apiKey=await elevenApiKey(workspaceId);
  if(!apiKey)return null;

  const url="https://api.elevenlabs.io/v1/text-to-speech/"+encodeURIComponent(String(cfg.voice_id))+"?output_format=mp3_44100_128";
  const res=await fetch(url,{
    method:"POST",
    headers:{
      "xi-api-key":apiKey,
      "content-type":"application/json",
      "accept":"audio/mpeg"
    },
    body:JSON.stringify({
      text:String(text||"").trim(),
      model_id:String(cfg.tts_model||"eleven_multilingual_v2")
    }),
    signal:AbortSignal.timeout(60000)
  });

  if(!res.ok){
    const err=(await res.text().catch(()=>"")).slice(0,900);
    console.error("ElevenLabs TTS error",res.status,err);
    await db.from("wa_voice_configs").update({
      last_error:"elevenlabs_tts_failed_"+res.status,
      updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    return null;
  }

  const bytes=new Uint8Array(await res.arrayBuffer());
  return bytesToBase64(bytes);
}

async function sendVoice(config:any,to:string,audioBase64:string,delayMs=2500){
  const path="/message/sendWhatsAppAudio/"+encodeURIComponent(config.instance_name);
  const r=await evo(config,path,{
    method:"POST",
    body:JSON.stringify({
      number:to,
      audio:rawBase64(audioBase64),
      delay:Math.max(500,Math.min(Number(delayMs||2500),5000))
    })
  });
  const id=
    r.data?.key?.id ??
    r.data?.data?.key?.id ??
    r.data?.message?.key?.id ??
    r.data?.messages?.[0]?.id ??
    null;
  return {ok:r.ok,id,detail:r.data};
}

function parseJsonLoose(value: string) {
  const raw = String(value || "").trim()
    .replace(/^\\\`\\\`\\\`json\\s*/i, "")
    .replace(/\\\`\\\`\\\`$/,"")
    .trim();
  try { return JSON.parse(raw); } catch {}
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try { return JSON.parse(raw.slice(i, j + 1)); } catch {}
  }
  return null;
}

async function analyzePixReceipt(media: any, payment: any, pixSettings: any) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key || !media?.base64) return null;

  const expectedAmount = Number(payment?.amount || 0);
  const expectedPixKey = String(
    payment?.metadata?.pix_key ||
    payment?.metadata?.expected_pix_key ||
    pixSettings?.pix_key ||
    ""
  ).trim();
  const expectedReceiver = String(
    payment?.metadata?.receiver_name ||
    payment?.metadata?.expected_receiver ||
    pixSettings?.pix_holder ||
    ""
  ).trim();
  const mime = String(media?.mimetype || "image/jpeg");
  const isPdf = mime.includes("pdf");

  const prompt = [
    "Analise SOMENTE o comprovante PIX anexado.",
    "Isso é pré-validação documental e NÃO prova que o dinheiro caiu na conta.",
    "Extraia apenas o que estiver legível. Nunca invente.",
    "Retorne APENAS JSON válido, sem markdown, com:",
    '{"is_pix_receipt":boolean,"amount":number|null,"payer_name":string|null,"receiver_name":string|null,"receiver_key":string|null,"txid":string|null,"end_to_end_id":string|null,"paid_at_iso":string|null,"recent":boolean|null,"amount_matches":boolean|null,"receiver_matches":boolean|null,"suspicious":boolean,"risk_score":number,"reason":string}',
    "risk_score: 0=sem sinal aparente de problema; 100=fortes sinais de fraude/edição ou dados incompatíveis.",
    "expected_amount=" + expectedAmount,
    "expected_pix_key=" + (expectedPixKey || "(não cadastrado)"),
    "expected_receiver=" + (expectedReceiver || "(não cadastrado)"),
  ].join("\\n");

  const content: any[] = [{ type: "input_text", text: prompt }];
  if (isPdf) {
    content.push({
      type: "input_file",
      filename: media?.fileName || "comprovante.pdf",
      file_data: "data:" + mime + ";base64," + media.base64,
    });
  } else {
    content.push({
      type: "input_image",
      image_url: "data:" + mime + ";base64," + media.base64,
      detail: "high",
    });
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": "Bearer " + key,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_VISION_MODEL") || "gpt-5.6-luna",
      input: [{ role: "user", content }],
      max_output_tokens: 500,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return parseJsonLoose(responseTextFromOpenAI(data));
}

async function latestPendingPayment(workspaceId: string, contactId: string, conversationId: string) {
  let q = db.from("wa_payments")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .in("status", ["pendente","pending","aguardando","awaiting_payment"])
    .order("created_at", { ascending: false })
    .limit(1);

  const { data } = await q.maybeSingle();
  if (data) return data;

  const fallback = await db.from("wa_payments")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return fallback.data || null;
}

async function handleReceiptMedia(
  config: any,
  raw: any,
  workspaceId: string,
  contact: any,
  conversation: any,
  externalId: string | null,
  text: string,
) {
  const info = mediaInfo(raw);
  if (!info) return false;

  const isReceiptCandidate =
    info.kind === "image" ||
    (info.kind === "document" && (info.mimetype.includes("pdf") || info.mimetype.startsWith("image/")));

  if (!isReceiptCandidate) return false;

  const payment = await latestPendingPayment(workspaceId, contact.id, conversation.id);
  const { data: pixSettings } = await db
    .from("wa_settings")
    .select("pix_key,pix_holder")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const media = await getMediaBase64(config, raw);

  if (!media?.base64) {
    const reply = "Recebi o arquivo, mas não consegui abrir o comprovante. Pode enviar novamente como foto ou PDF?";
    const sent = await sendText(config, contact.phone, reply);
    await saveOutbound(workspaceId, conversation.id, contact.id, reply, sent.id || null, sent.ok ? "sent" : "failed", "bot");
    return true;
  }

  const analysis = await analyzePixReceipt(media, payment, pixSettings);
  const expected = payment ? Number(payment.amount || 0) : null;
  const amount = analysis?.amount == null ? null : Number(analysis.amount);
  const amountMatches = expected == null || amount == null
    ? null
    : Math.abs(expected - amount) < 0.001;

  const verdict =
    !analysis ? "analysis_failed" :
    analysis?.is_pix_receipt !== true ? "not_pix_receipt" :
    analysis?.suspicious === true ? "suspicious" :
    amountMatches === false ? "amount_mismatch" :
    "document_ok_waiting_bank";

  const existing = externalId
    ? await db.from("wa_payment_receipts").select("id").eq("workspace_id", workspaceId).eq("external_message_id", externalId).maybeSingle()
    : { data: null };

  if (!existing.data) {
    await db.from("wa_payment_receipts").insert({
      workspace_id: workspaceId,
      contact_id: contact.id,
      conversation_id: conversation.id,
      payment_id: payment?.id || null,
      external_message_id: externalId,
      expected_amount: expected,
      detected_amount: amount,
      detected_payer_name: analysis?.payer_name || null,
      detected_receiver_name: analysis?.receiver_name || null,
      detected_receiver_key: analysis?.receiver_key || null,
      detected_reference: analysis?.end_to_end_id || analysis?.txid || null,
      detected_paid_at: analysis?.paid_at_iso || null,
      media_metadata: {
        kind: info.kind,
        mimetype: media.mimetype || info.mimetype,
        file_name: media.fileName || info.fileName,
      },
      analysis: analysis || { error: "vision_unavailable" },
      risk_score: analysis?.risk_score == null ? null : Number(analysis.risk_score),
      vision_verdict: verdict,
      bank_match: false,
      status: verdict,
      updated_at: new Date().toISOString(),
    });
  }

  if (payment && analysis?.end_to_end_id) {
    await db.from("wa_payments").update({
      pix_end_to_end_id: String(analysis.end_to_end_id),
      updated_at: new Date().toISOString(),
      metadata: {
        ...(payment.metadata || {}),
        receipt_txid: analysis?.txid || null,
        receipt_end_to_end_id: analysis?.end_to_end_id || null,
        receipt_detected_amount: amount,
        receipt_vision_verdict: verdict,
      },
    }).eq("id", payment.id);
  }

  let reply: string;
  if (!payment) {
    reply = "Li o comprovante, mas não encontrei uma cobrança pendente ligada a esta conversa. Não vou liberar nada automaticamente até localizar a cobrança correta.";
  } else if (!analysis) {
    reply = "Recebi o comprovante. Não consegui concluir a leitura automática agora, então ele ficou aguardando conferência do pagamento.";
  } else if (analysis?.is_pix_receipt !== true) {
    reply = "Esse arquivo não foi reconhecido como um comprovante PIX válido. Pode enviar o comprovante completo em foto ou PDF?";
  } else if (amountMatches === false) {
    reply = "Recebi o comprovante, mas o valor lido não bate com a cobrança. Vou manter o acesso aguardando pagamento correto.";
  } else if (analysis?.suspicious === true || Number(analysis?.risk_score || 0) >= 70) {
    reply = "Recebi o comprovante, mas ele precisa de confirmação do banco antes da liberação. Assim que a transação aparecer confirmada, o sistema libera automaticamente.";
  } else {
    reply = "Comprovante recebido e lido certinho. Agora estou aguardando a confirmação real do PIX no banco. Assim que o pagamento for confirmado, o acesso é liberado automaticamente.";
  }

  const sent = await sendText(config, contact.phone, reply);
  await saveOutbound(workspaceId, conversation.id, contact.id, reply, sent.id || null, sent.ok ? "sent" : "failed", "bot");
  return true;
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
  messageType = "text",
  metadata: any = {},
) {
  await db.from("wa_messages").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    contact_id: contactId,
    direction: "out",
    sender_type: senderType,
    content: String(text||"").trim(),
    message_type: messageType,
    external_message_id: externalId,
    status,
    metadata
  });
}

async function processIncoming(config: any, payload: any) {
  const raw = unwrapPayload(payload);
  const key = raw?.key ?? raw?.data?.key ?? {};
  const workspaceId = config.workspace_id;
  const externalId = key?.id ?? raw?.id ?? payload?.id ?? null;
  const media = mediaInfo(raw);

  if (key?.fromMe === true) {
    if (media?.kind === "audio") {
      await captureOwnerVoiceSample(config,raw,workspaceId,externalId);
    }
    return;
  }

  let remoteJid =
    key?.remoteJidAlt ??
    raw?.remoteJidAlt ??
    key?.remoteJid ??
    raw?.remoteJid ??
    "";
  if (!remoteJid || /@g\.us$/i.test(remoteJid) || /status@broadcast/i.test(remoteJid)) return;

  const phone = phoneFromJid(remoteJid);
  let text = String(extractText(raw) || "").trim();
  let audioTranscript:string|null=null;
  if(media?.kind==="audio"){
    audioTranscript=await transcribeCustomerAudio(config,raw,workspaceId);
    if(audioTranscript)text=audioTranscript;
  }
  if (!phone || (!text && !media)) return;

  const profileName = raw?.pushName ?? raw?.notifyName ?? payload?.senderName ?? null;

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
    content: text || (media?.kind==="audio"?"[áudio recebido]":""),
    message_type: media?.kind || "text",
    external_message_id: externalId,
    status: "received",
    metadata: {
      provider: "qr",
      raw_type: raw?.messageType ?? payload?.event ?? "text",
      ...(media?.kind==="audio"?{audio_transcript:audioTranscript||null,transcription_model:"whisper-1"}:{})
    },
  });

  if (msgErr && String(msgErr.code) === "23505") return;
  if (msgErr) throw msgErr;

  await db.from("wa_conversations").update({
    unread_count: (conversation.unread_count || 0) + 1,
    last_message_at: new Date().toISOString(),
  }).eq("id", conversation.id);

  if (media && await handleReceiptMedia(
    config,
    raw,
    workspaceId,
    contact,
    conversation,
    externalId,
    text,
  )) return;

  const optText = normalize(text);
  const isOptOut =
    /^(parar|sair|cancelar|remover|stop)$/.test(optText) ||
    /^(nao quero mais receber|nao quero receber|pare de mandar|pare de enviar)$/.test(optText);

  if (isOptOut) {
    const optOutAt = new Date().toISOString();
    await db.from("wa_contacts").update({
      marketing_opt_in: false,
      marketing_opt_out_at: optOutAt,
      marketing_consent_proof: {
        action: "opt_out",
        source: "whatsapp_reply",
        text,
        at: optOutAt,
      },
      updated_at: optOutAt,
    }).eq("id", contact.id);

    const confirmation = "Certo. Retirei este número dos envios de novidades e promoções. Se precisar de atendimento, pode continuar falando comigo por aqui.";
    const sent = await sendText(config, phone, confirmation);
    await saveOutbound(
      workspaceId,
      conversation.id,
      contact.id,
      confirmation,
      sent.id || null,
      sent.ok ? "sent" : "failed",
      "bot",
    );
    return;
  }

  if (!contact.bot_enabled) return;

  const { data: automations } = await db
    .from("wa_automations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);

  let selected: any = null;
  let nextNodeKey: string | null = null;
  const context = contact.bot_context || {};
  const {count:conversationMessageCount}=await db.from("wa_messages")
    .select("id",{count:"exact",head:true})
    .eq("conversation_id",conversation.id);
  const conversationStarted=Number(conversationMessageCount||0)>1;

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
    const isGreeting=/^(oi|ola|bom dia|boa tarde|boa noite)$/.test(t);
    if(!(isGreeting&&conversationStarted)){
      selected = (automations || []).find((a: any) =>
        (a.trigger_texts || []).some((x: string) => normalize(x) === t)
      );
      if (selected) nextNodeKey = selected.flow?.start || "welcome";
    }
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
    reply = await aiFallback(settings, workspaceId, conversation.id, contact.id, text);
    senderType = settings?.ai_enabled ? "ai" : "bot";
  }

  reply=directMessageText(reply);
  const parts = settings?.humanized_mode === false || settings?.humanized_split_messages === false
    ? [String(reply || "").trim()]
    : splitHumanized(reply);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const delayMs = settings?.humanized_mode === false
      ? 500
      : humanizedDelayMs(
          part,
          settings?.humanized_typing_min_ms ?? 1800,
          settings?.humanized_typing_max_ms ?? 5000,
        );

    let sent:any=null;
    if(media?.kind==="audio"){
      const clonedAudio=await synthesizeOwnerVoice(workspaceId,part);
      if(clonedAudio){
        sent=await sendVoice(config,phone,clonedAudio,delayMs);
        await saveOutbound(
          workspaceId,
          conversation.id,
          contact.id,
          part,
          sent.id,
          sent.ok ? "sent" : "failed",
          senderType,
          "audio",
          {voice_clone_provider:"elevenlabs",reply_to_customer_audio:true}
        );
        continue;
      }
    }

    sent=await sendText(config, phone, part, delayMs);
    await saveOutbound(
      workspaceId,
      conversation.id,
      contact.id,
      part,
      sent.id,
      sent.ok ? "sent" : "failed",
      senderType,
    );
  }

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
    .from("wa_evolution_configs")
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
      await db.from("wa_evolution_configs").update({
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
