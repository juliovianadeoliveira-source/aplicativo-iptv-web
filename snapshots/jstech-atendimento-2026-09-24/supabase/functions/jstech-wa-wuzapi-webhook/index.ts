
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sj=Deno.env.get("SUPABASE_SECRET_KEYS");
const SERVICE=sj?JSON.parse(sj)["default"]:legacy;
if(!SERVICE)throw new Error("backend key unavailable");
const db=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(d:any,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});

const norm=(v="")=>String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
const digits=(v="")=>String(v).replace(/\D+/g,"");
function parseRequestedScreens(text:string){
  const t=norm(text);
  const m=t.match(/\b(10|[1-9])\s*(?:tela|telas|acesso|acessos)\b/);
  if(m)return Number(m[1]);
  const words:any={uma:1,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};
  const wm=t.match(/\b(uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(?:tela|telas|acesso|acessos)\b/);
  return wm?words[wm[1]]:null;
}
function isLocalESDDD(phone:string){
  let p=digits(phone);
  if(p.startsWith("55"))p=p.slice(2);
  return p.startsWith("27")||p.startsWith("28");
}
const DDD_UF:any={
  "11":"SP","12":"SP","13":"SP","14":"SP","15":"SP","16":"SP","17":"SP","18":"SP","19":"SP",
  "21":"RJ","22":"RJ","24":"RJ","27":"ES","28":"ES",
  "31":"MG","32":"MG","33":"MG","34":"MG","35":"MG","37":"MG","38":"MG",
  "41":"PR","42":"PR","43":"PR","44":"PR","45":"PR","46":"PR",
  "47":"SC","48":"SC","49":"SC","51":"RS","53":"RS","54":"RS","55":"RS",
  "61":"DF","62":"GO","63":"TO","64":"GO","65":"MT","66":"MT","67":"MS","68":"AC","69":"RO",
  "71":"BA","73":"BA","74":"BA","75":"BA","77":"BA","79":"SE",
  "81":"PE","82":"AL","83":"PB","84":"RN","85":"CE","86":"PI","87":"PE","88":"CE","89":"PI",
  "91":"PA","92":"AM","93":"PA","94":"PA","95":"RR","96":"AP","97":"AM","98":"MA","99":"MA"
};
const UF_NAMES:any={
  AC:"Acre",AL:"Alagoas",AP:"Amapá",AM:"Amazonas",BA:"Bahia",CE:"Ceará",DF:"Distrito Federal",
  ES:"Espírito Santo",GO:"Goiás",MA:"Maranhão",MT:"Mato Grosso",MS:"Mato Grosso do Sul",
  MG:"Minas Gerais",PA:"Pará",PB:"Paraíba",PR:"Paraná",PE:"Pernambuco",PI:"Piauí",
  RJ:"Rio de Janeiro",RN:"Rio Grande do Norte",RS:"Rio Grande do Sul",RO:"Rondônia",
  RR:"Roraima",SC:"Santa Catarina",SP:"São Paulo",SE:"Sergipe",TO:"Tocantins"
};
function phoneDDD(phone:string){
  let p=digits(phone);
  if(p.startsWith("55"))p=p.slice(2);
  return p.length>=10?p.slice(0,2):"";
}
function phoneRegion(phone:string){
  const ddd=phoneDDD(phone),uf=DDD_UF[ddd]||"";
  return ddd&&uf?{ddd,uf,state:UF_NAMES[uf]||uf}:null;
}
function regionalSalesLine(phone:string){
  const r=phoneRegion(phone);
  if(!r)return "";
  if(r.uf==="ES"){
    return "Ótimo, estamos no mesmo estado. Além do atendimento online, a JSTech também trabalha com instalação e assistência de antenas, câmeras de segurança, Starlink, motores de portão, fechaduras, cerca elétrica, alarmes e instalação de TVs. Se precisar de algum desses serviços, pode falar comigo por aqui.";
  }
  return "Que legal saber que você está em "+r.state+". Muito bom ver os serviços da JSTech chegando até aí. Podemos seguir com IPTV, CS, painéis, suporte e outros serviços que atendemos online. Vamos começar uma boa parceria por aqui.";
}
const cleanJid=(v="")=>String(v).replace(/:\d+(?=@)/,"").replace(/@s\.whatsapp\.net$/i,"").replace(/@c\.us$/i,"").replace(/@lid$/i,"");
function jidString(v:any){
  if(typeof v==="string")return v;
  if(v&&typeof v==="object"){
    const user=String(v.User??v.user??"").trim();
    const server=String(v.Server??v.server??"").trim();
    if(user&&server)return user+"@"+server;
    if(user)return user;
    if(typeof v.String==="string")return v.String;
  }
  return "";
}

function renderNode(node:any){
  if(!node)return "";
  let out=String(node.text||"").replace(/\\\\n/g,"\n").trim();
  const opts=Array.isArray(node.options)?node.options:[];
  if(opts.length)out+="\n\n"+opts.map((o:any)=>String(o.key)+" - "+String(o.label)).join("\n");
  return out.trim();
}
function matchOption(node:any,input:string){
  const v=norm(input),opts=Array.isArray(node?.options)?node.options:[];
  return opts.find((o:any)=>norm(o.key)===v||norm(o.label)===v);
}
function incomingMedia(payload:any,data:any){
  const m=data?.Message||data?.message||{};
  let kind="";
  if(m?.imageMessage)kind="image";
  else if(m?.audioMessage)kind="audio";
  else if(m?.documentMessage)kind="document";
  else if(m?.videoMessage)kind="video";
  const mime=String(payload?.mimeType??payload?.mimetype??m?.imageMessage?.mimetype??m?.audioMessage?.mimetype??m?.documentMessage?.mimetype??m?.videoMessage?.mimetype??"").trim();
  const fileName=String(payload?.fileName??payload?.filename??m?.documentMessage?.fileName??"").trim();
  const base64=String(payload?.base64??data?.base64??"").trim();
  const ocrText=String(payload?.ocrText??data?.ocrText??"").replace(/\s+/g," ").trim().slice(0,4000);
  return {kind,mime,fileName,base64,ocrText};
}

function rawVoiceBase64(value:string){
  const s=String(value||"").trim();
  return s.includes(",")?s.split(",",2)[1]:s;
}
function voiceBase64ToBytes(value:string){
  const bin=atob(rawVoiceBase64(value));
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}
function voiceBytesToBase64(bytes:Uint8Array){
  let out="";
  const size=0x8000;
  for(let i=0;i<bytes.length;i+=size){
    out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+size,bytes.length)));
  }
  return btoa(out);
}
async function voiceSha256Hex(bytes:Uint8Array){
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function tenantVoiceConfig(workspaceId:string){
  const {data}=await db.from("wa_voice_configs").select("*").eq("workspace_id",workspaceId).maybeSingle();
  return data||null;
}
async function tenantElevenKey(workspaceId:string){
  let current=workspaceId;
  for(let level=0;level<3&&current;level++){
    const {data:key}=await db.rpc("voice_agent_get_elevenlabs_api_key",{p_workspace_id:current});
    const value=String(key||"").trim();
    if(value)return value;
    const {data:ws}=await db.from("wa_workspaces").select("parent_workspace_id").eq("id",current).maybeSingle();
    current=String(ws?.parent_workspace_id||"").trim();
  }
  return String(Deno.env.get("ELEVENLABS_API_KEY")||"").trim();
}
async function captureTenantOwnerVoice(workspaceId:string,media:any,externalId:string|null){
  const cfg=await tenantVoiceConfig(workspaceId);
  if(!cfg?.enabled||cfg?.auto_capture_owner_voice!==true||media?.kind!=="audio")return {handled:false};
  if(cfg.voice_id&&cfg.clone_status==="ready")return {handled:true,status:"already_ready"};
  if(!media?.base64)return {handled:true,status:"needs_download"};

  const apiKey=await tenantElevenKey(workspaceId);
  if(!apiKey){
    await db.from("wa_voice_configs").update({
      clone_status:"waiting_api_key",
      last_error:"elevenlabs_api_key_missing",
      updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    return {handled:true,status:"waiting_api_key"};
  }

  const bytes=voiceBase64ToBytes(media.base64);
  if(bytes.length<8000){
    await db.from("wa_voice_configs").update({
      clone_status:"waiting_sample",
      last_error:"owner_audio_too_short",
      updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    return {handled:true,status:"sample_too_short"};
  }

  await db.from("wa_voice_configs").update({
    clone_status:"cloning",last_error:null,updated_at:new Date().toISOString()
  }).eq("workspace_id",workspaceId);

  const mime=String(media?.mime||"audio/ogg").split(";")[0]||"audio/ogg";
  const ext=mime.includes("mpeg")||mime.includes("mp3")?"mp3":mime.includes("mp4")?"m4a":"ogg";
  const form=new FormData();
  form.append("name",String(cfg.voice_name||"Minha voz WhatsApp"));
  form.append("files",new Blob([bytes],{type:mime}),"whatsapp-voice."+ext);
  form.append("remove_background_noise","true");
  form.append("description","Voz própria do titular desta conta, capturada de áudio enviado por ele no próprio WhatsApp.");

  const res=await fetch("https://api.elevenlabs.io/v1/voices/add",{
    method:"POST",headers:{"xi-api-key":apiKey},body:form,signal:AbortSignal.timeout(60000)
  });
  const payload=await res.json().catch(()=>({}));
  if(!res.ok||!payload?.voice_id){
    await db.from("wa_voice_configs").update({
      clone_status:"error",
      last_error:"elevenlabs_clone_failed_"+res.status,
      updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    console.error("ElevenLabs tenant clone error",res.status,JSON.stringify(payload).slice(0,900));
    return {handled:true,status:"clone_failed"};
  }

  const requiresVerification=payload?.requires_verification===true;
  await db.from("wa_voice_configs").update({
    voice_id:String(payload.voice_id),
    clone_status:requiresVerification?"verification_required":"ready",
    last_sample_external_message_id:externalId,
    last_sample_hash:await voiceSha256Hex(bytes),
    last_sample_mime:mime,
    last_sample_at:new Date().toISOString(),
    cloned_at:requiresVerification?null:new Date().toISOString(),
    last_error:requiresVerification?"elevenlabs_verification_required":null,
    updated_at:new Date().toISOString()
  }).eq("workspace_id",workspaceId);

  return {handled:true,status:requiresVerification?"verification_required":"ready"};
}

async function transcribeTenantCustomerAudio(workspaceId:string,base64:string,mime:string,fileName:string){
  const cfg=await tenantVoiceConfig(workspaceId);
  if(!cfg?.enabled||!base64)return "";
  const apiKey=String(Deno.env.get("OPENAI_API_KEY")||"").trim();
  if(!apiKey)return "";
  const bytes=voiceBase64ToBytes(base64);
  let mt=String(mime||"audio/ogg").toLowerCase().split(";")[0]||"audio/ogg";
  if(mt==="application/ogg"||mt==="application/octet-stream")mt="audio/ogg";
  const ext=mt.includes("mpeg")||mt.includes("mp3")?"mp3":mt.includes("mp4")?"m4a":mt.includes("wav")?"wav":mt.includes("webm")?"webm":"ogg";
  const form=new FormData();
  form.append("file",new Blob([bytes],{type:mt}),String(fileName||"cliente")+"."+ext);
  form.append("model",String(cfg.transcription_model||"whisper-1"));
  form.append("language","pt");
  form.append("response_format","json");
  try{
    const res=await fetch("https://api.openai.com/v1/audio/transcriptions",{
      method:"POST",
      headers:{"authorization":"Bearer "+apiKey},
      body:form,
      signal:AbortSignal.timeout(60000)
    });
    if(!res.ok){
      console.error("Whisper tenant transcription error",res.status,(await res.text().catch(()=>"")).slice(0,600));
      return "";
    }
    const data=await res.json().catch(()=>({}));
    return String(data?.text||"").trim();
  }catch(e){
    console.error("Whisper tenant transcription exception",String(e));
    return "";
  }
}

async function synthesizeTenantOwnerVoice(workspaceId:string,text:string){
  const cfg=await tenantVoiceConfig(workspaceId);
  if(!cfg?.enabled||cfg?.reply_audio_when_customer_audio!==true||cfg?.clone_status!=="ready"||!cfg?.voice_id)return null;
  const apiKey=await tenantElevenKey(workspaceId);
  if(!apiKey)return null;

  const res=await fetch(
    "https://api.elevenlabs.io/v1/text-to-speech/"+encodeURIComponent(String(cfg.voice_id))+"?output_format=opus_48000_64",
    {
      method:"POST",
      headers:{"xi-api-key":apiKey,"content-type":"application/json","accept":"audio/ogg"},
      body:JSON.stringify({
        text:String(text||"").trim(),
        model_id:String(cfg.tts_model||"eleven_multilingual_v2")
      }),
      signal:AbortSignal.timeout(60000)
    }
  );
  if(!res.ok){
    console.error("ElevenLabs tenant TTS error",res.status,(await res.text().catch(()=>"")).slice(0,800));
    await db.from("wa_voice_configs").update({
      last_error:"elevenlabs_tts_failed_"+res.status,updated_at:new Date().toISOString()
    }).eq("workspace_id",workspaceId);
    return null;
  }
  return voiceBytesToBase64(new Uint8Array(await res.arrayBuffer()));
}

function extractText(data:any){
  const m=data?.Message||data?.message||{};
  return String(
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.imageMessage?.caption ??
    m?.videoMessage?.caption ??
    m?.documentMessage?.caption ??
    data?.body ?? data?.text ?? ""
  ).trim();
}
function pick(list:string[],seed:string){
  let n=0;
  for(const ch of seed)n=(n+ch.charCodeAt(0))%100000;
  return list[n%list.length];
}

const BASE_CITY={name:"Boa Esperança",state:"Espírito Santo",state_code:"ES",country:"Brasil",country_code:"BR",latitude:-18.5394981,longitude:-40.2909978};

const BR_UFS=new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);
const BR_STATES:any={
  "acre":{name:"Acre",uf:"AC"},"alagoas":{name:"Alagoas",uf:"AL"},"amapa":{name:"Amapá",uf:"AP"},
  "amazonas":{name:"Amazonas",uf:"AM"},"bahia":{name:"Bahia",uf:"BA"},"ceara":{name:"Ceará",uf:"CE"},
  "distrito federal":{name:"Distrito Federal",uf:"DF"},"espirito santo":{name:"Espírito Santo",uf:"ES"},
  "goias":{name:"Goiás",uf:"GO"},"maranhao":{name:"Maranhão",uf:"MA"},"mato grosso":{name:"Mato Grosso",uf:"MT"},
  "mato grosso do sul":{name:"Mato Grosso do Sul",uf:"MS"},"minas gerais":{name:"Minas Gerais",uf:"MG"},
  "para":{name:"Pará",uf:"PA"},"paraiba":{name:"Paraíba",uf:"PB"},"parana":{name:"Paraná",uf:"PR"},
  "pernambuco":{name:"Pernambuco",uf:"PE"},"piaui":{name:"Piauí",uf:"PI"},"rio de janeiro":{name:"Rio de Janeiro",uf:"RJ"},
  "rio grande do norte":{name:"Rio Grande do Norte",uf:"RN"},"rio grande do sul":{name:"Rio Grande do Sul",uf:"RS"},
  "rondonia":{name:"Rondônia",uf:"RO"},"roraima":{name:"Roraima",uf:"RR"},"santa catarina":{name:"Santa Catarina",uf:"SC"},
  "sao paulo":{name:"São Paulo",uf:"SP"},"sergipe":{name:"Sergipe",uf:"SE"},"tocantins":{name:"Tocantins",uf:"TO"}
};
const STATE_BY_UF:any=Object.fromEntries(Object.values(BR_STATES).map((x:any)=>[x.uf,x]));

function parseBrazilLocation(raw:string){
  const original=String(raw||"").trim();
  const n=norm(original).replace(/\s+/g," ");
  if(BR_STATES[n])return {kind:"state",state:BR_STATES[n]};
  if(BR_UFS.has(n.toUpperCase()))return {kind:"state",state:STATE_BY_UF[n.toUpperCase()]};

  const ufMatch=original.match(/^(.*?)[,\s]+([A-Za-z]{2})$/);
  if(ufMatch && BR_UFS.has(ufMatch[2].toUpperCase())){
    return {kind:"city",city:ufMatch[1].trim(),uf:ufMatch[2].toUpperCase()};
  }

  const stateNames=Object.keys(BR_STATES).sort((a,b)=>b.length-a.length);
  for(const sn of stateNames){
    if(n.endsWith(" "+sn)){
      const cityNorm=n.slice(0,-sn.length).trim().replace(/[,;-]+$/,"").trim();
      if(cityNorm){
        const idx=norm(original).lastIndexOf(sn);
        const city=idx>0?original.slice(0,idx).replace(/[,;-]+$/,"").trim():cityNorm;
        return {kind:"city",city,uf:BR_STATES[sn].uf};
      }
    }
  }
  return {kind:"city",city:original,uf:""};
}

const KNOWN_LOCALITIES:any={
  "patrimonio do xv":{name:"Patrimônio do XV",municipality:"Nova Venécia",uf:"ES",latitude:-18.495313,longitude:-40.465860},
  "santo antonio do xv":{name:"Santo Antônio do XV",municipality:"Nova Venécia",uf:"ES"}
};

function knownLocalityFromText(raw:string){
  const n=norm(raw);
  for(const [key,value] of Object.entries(KNOWN_LOCALITIES)){
    if(n.includes(key))return value as any;
  }
  return null;
}

function parseMunicipalityLocality(raw:string){
  const original=String(raw||"").trim();
  const n=norm(original).replace(/\s+/g," ");
  const m=n.match(/^(.+?)\s+(?:municipio|municiopio|municpio|municipío)\s+de\s+(.+)$/i);
  if(!m)return null;
  const locality=m[1].trim();
  const municipality=m[2].trim();
  if(!locality||!municipality)return null;
  return {locality,municipality};
}

function asksWhereAreYou(text:string){
  const t=norm(text);
  return /\b(vc|voce|vcs|voces)\s+(e|sao)\s+de\s+onde\b/.test(t)
    || /\bde\s+onde\s+(vc|voce|vcs|voces)\s+(e|sao)\b/.test(t)
    || /\bqual\s+(e\s+a\s+)?cidade\s+(de\s+)?(vc|voce|vcs|voces)\b/.test(t)
    || /\bonde\s+(fica|ficam)\s+(a\s+)?jstech\b/.test(t)
    || /\bde\s+qual\s+cidade\s+(vc|voce|vcs|voces)\s+(e|sao)\b/.test(t);
}

function asksGeoQuestion(text:string){
  const t=norm(text);
  return /\b(onde fica|onde e|onde é|fica onde|qual municipio|qual município|qual cidade|qual estado|pertence a qual municipio|pertence a qual município|conhece|sabe onde fica|quantos km|qual distancia|qual distância|fica perto|e perto|é perto|fica longe|e longe|é longe|cep)\b/.test(t);
}

function extractGeoQuestionPlace(text:string){
  const raw=String(text||"").trim().replace(/[?!]+$/,"").trim();
  const n=norm(raw);

  const nearBase=raw.match(/^(.+?)\s+(?:fica|e|é)\s+(?:perto|longe)\s+(?:de|da|do)\s+boa\s+esperanca(?:-?es)?$/i);
  if(nearBase?.[1])return nearBase[1].trim();

  const distanceToBase=raw.match(/(?:quantos\s+km|qual\s+(?:a\s+)?distancia|qual\s+(?:a\s+)?distância|distancia|distância)\s+(?:de\s+)?(.+?)\s+(?:ate|até)\s+boa\s+esperanca(?:-?es)?$/i);
  if(distanceToBase?.[1])return distanceToBase[1].trim();

  const patterns=[
    /(?:sabe\s+)?onde\s+fica\s+(.+)$/i,
    /(?:voce\s+|vc\s+)?conhece\s+(.+)$/i,
    /qual\s+(?:e\s+o\s+|é\s+o\s+)?municipio\s+(?:de|do|da)\s+(.+)$/i,
    /qual\s+(?:e\s+a\s+|é\s+a\s+)?cidade\s+(?:de|do|da)\s+(.+)$/i,
    /qual\s+(?:e\s+o\s+|é\s+o\s+)?estado\s+(?:de|do|da)\s+(.+)$/i,
    /(.+?)\s+fica\s+em\s+qual\s+(?:municipio|cidade|estado)$/i,
    /(.+?)\s+pertence\s+a\s+qual\s+(?:municipio|cidade|estado)$/i,
    /(?:quantos\s+km|qual\s+(?:a\s+)?distancia|qual\s+(?:a\s+)?distância).*?(?:ate|até)\s+(.+)$/i
  ];
  for(const re of patterns){
    const m=raw.match(re);
    if(m?.[1]){
      const out=m[1].replace(/\s+(?:pra|para)\s+mim$/i,"").trim();
      if(out.length>=2)return out;
    }
  }

  if(/\bcep\b/.test(n)){
    const m=raw.match(/\b\d{5}[-\s]?\d{3}\b/);
    if(m)return "CEP "+m[0];
  }
  return "";
}

function extractLocationClaim(text:string,context:any={}){
  const raw=String(text||"").trim();
  const m=raw.match(/\b(?:sou|moro|estou|to|tô|falo)\s+(?:aqui\s+)?(?:de|do|da|em)\s+(.+)$/i);
  let place=m?.[1]?.trim()||"";
  if(place){
    place=place.replace(/\s+(?:e|,)\s*(?:vc|vcs|voce|voces)\b.*$/i,"").replace(/\s+(?:e|,)\s*de\s+onde\b.*$/i,"").replace(/[?.!]+$/,"").trim();
    if(place.length>=2)return place;
  }
  if(context?.awaiting_location && raw.length>=2 && raw.length<=120){
    const t=norm(raw);
    if(!/[?]/.test(raw) && !/\b(quero|preciso|plano|preco|teste|suporte|iptv|cs|painel|unitv)\b/.test(t))return raw.replace(/[.!]+$/,"").trim();
  }
  return "";
}

function haversineKm(lat1:number,lon1:number,lat2:number,lon2:number){
  const R=6371,rad=(x:number)=>x*Math.PI/180;
  const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function stateCodeFromResult(r:any){
  const direct=String(r?.state_code||r?.address?.["ISO3166-2-lvl4"]||r?.address?.["ISO3166-2-lvl3"]||"").toUpperCase();
  if(/^BR-[A-Z]{2}$/.test(direct))return direct.slice(3);
  if(BR_UFS.has(direct))return direct;
  const a=norm(r?.admin1||r?.address?.state||"");
  const map:any={"acre":"AC","alagoas":"AL","amapa":"AP","amazonas":"AM","bahia":"BA","ceara":"CE","distrito federal":"DF","espirito santo":"ES","goias":"GO","maranhao":"MA","mato grosso":"MT","mato grosso do sul":"MS","minas gerais":"MG","para":"PA","paraiba":"PB","parana":"PR","pernambuco":"PE","piaui":"PI","rio de janeiro":"RJ","rio grande do norte":"RN","rio grande do sul":"RS","rondonia":"RO","roraima":"RR","santa catarina":"SC","sao paulo":"SP","sergipe":"SE","tocantins":"TO"};
  return map[a]||"";
}

function formatPlace(r:any){
  if(!r)return "";
  const uf=stateCodeFromResult(r);
  if(r?.kind==="locality"||r?.kind==="neighbourhood"||r?.kind==="place"){
    const municipality=String(r?.municipality||r?.admin2||"").trim();
    if(String(r?.country_code||"").toUpperCase()==="BR"){
      return [r?.name,municipality?("município de "+municipality):"",uf||r?.admin1].filter(Boolean).join(", ");
    }
  }
  if(String(r?.country_code||"").toUpperCase()==="BR")return [r?.name,uf||r?.admin1].filter(Boolean).join("-");
  return [r?.name,r?.admin1,r?.country].filter(Boolean).join(", ");
}

async function geocodeCep(cepRaw:string){
  const cep=String(cepRaw||"").replace(/\D/g,"");
  if(cep.length!==8)return null;
  const cacheKey="cep|"+cep;
  const {data:cached}=await db.from("wa_geo_cache").select("result,updated_at").eq("query_key",cacheKey).maybeSingle();
  if(cached?.result && Date.now()-Date.parse(cached.updated_at||0)<1000*60*60*24*180)return cached.result;
  try{
    const res=await fetch("https://viacep.com.br/ws/"+cep+"/json/",{headers:{"accept":"application/json"},signal:AbortSignal.timeout(5000)});
    const j=await res.json().catch(()=>({}));
    if(!res.ok||j?.erro)return null;
    const result={
      kind:"postal",
      name:String(j?.bairro||j?.logradouro||j?.localidade||"CEP "+cep),
      municipality:String(j?.localidade||""),
      state_code:String(j?.uf||"").toUpperCase(),
      admin1:STATE_BY_UF[String(j?.uf||"").toUpperCase()]?.name||"",
      postal_code:cep,
      street:String(j?.logradouro||""),
      neighbourhood:String(j?.bairro||""),
      country:"Brasil",country_code:"BR"
    };
    await db.from("wa_geo_cache").upsert({query_key:cacheKey,query_text:cepRaw,result,provider:"viacep",updated_at:new Date().toISOString()},{onConflict:"query_key"});
    return result;
  }catch{return null}
}

async function geocodeNominatim(raw:string,wantedUf:string=""){
  const key=norm("osm|"+raw+"|"+wantedUf);
  const {data:cached}=await db.from("wa_geo_cache").select("result,updated_at").eq("query_key",key).maybeSingle();
  if(cached?.result && Date.now()-Date.parse(cached.updated_at||0)<1000*60*60*24*90)return cached.result;
  try{
    const searches:string[]=[];
    const base=String(raw||"").trim();
    if(wantedUf)searches.push(base+", "+wantedUf+", Brasil");
    searches.push(base+", Brasil");
    searches.push(base);
    let rows:any[]=[];
    for(const q of [...new Set(searches)]){
      const u=new URL("https://nominatim.openstreetmap.org/search");
      u.searchParams.set("q",q);
      u.searchParams.set("format","jsonv2");
      u.searchParams.set("addressdetails","1");
      u.searchParams.set("limit","8");
      u.searchParams.set("accept-language","pt-BR");
      const res=await fetch(u.toString(),{
        headers:{"accept":"application/json","user-agent":"JSTech-Atendimento/1.0"},
        signal:AbortSignal.timeout(6000)
      });
      const j=await res.json().catch(()=>[]);
      if(res.ok&&Array.isArray(j)&&j.length){rows=j;break}
    }
    if(!rows.length)return null;

    const target=norm(base);
    const score=(x:any)=>{
      const a=x?.address||{};
      const name=String(x?.name||x?.display_name?.split(",")?.[0]||"");
      const uf=stateCodeFromResult(x);
      let n=0;
      if(norm(name)===target)n+=10;
      if(norm(String(x?.display_name||"")).includes(target))n+=5;
      if(wantedUf&&uf===wantedUf)n+=8;
      if(String(x?.country_code||"").toUpperCase()==="BR")n+=4;
      const typ=String(x?.addresstype||x?.type||"").toLowerCase();
      if(["city","town","village","municipality","hamlet","suburb","neighbourhood","quarter","isolated_dwelling"].includes(typ))n+=3;
      return n;
    };
    rows.sort((a:any,b:any)=>score(b)-score(a));
    const best=rows[0];
    const a=best?.address||{};
    const typ=String(best?.addresstype||best?.type||"").toLowerCase();
    const municipality=String(a.city||a.town||a.municipality||a.county||a.village||"").trim();
    const name=String(best?.name||a.neighbourhood||a.suburb||a.hamlet||a.village||a.city||a.town||String(best?.display_name||"").split(",")[0]||base).trim();
    let kind="place";
    if(["city","town","municipality"].includes(typ))kind="city";
    else if(["village","hamlet","isolated_dwelling"].includes(typ))kind="locality";
    else if(["suburb","neighbourhood","quarter"].includes(typ))kind="neighbourhood";
    else if(typ==="state")kind="state";
    const result={
      kind,name,
      latitude:Number(best?.lat),longitude:Number(best?.lon),
      country_code:String(best?.country_code||"").toUpperCase(),
      country:String(a.country||""),
      admin1:String(a.state||""),
      admin2:String(a.county||""),
      municipality,
      state_code:stateCodeFromResult(best),
      postal_code:String(a.postcode||""),
      display_name:String(best?.display_name||""),
      osm_type:String(best?.osm_type||""),
      osm_id:String(best?.osm_id||"")
    };
    await db.from("wa_geo_cache").upsert({query_key:key,query_text:raw,result,provider:"openstreetmap-nominatim",updated_at:new Date().toISOString()},{onConflict:"query_key"});
    return result;
  }catch{return null}
}

async function geocodePlace(place:string){
  const raw=String(place||"").trim();
  if(!raw)return null;

  const cepMatch=raw.match(/\b(?:cep\s*)?(\d{5})[-\s]?(\d{3})\b/i);
  if(cepMatch){
    const byCep=await geocodeCep(cepMatch[1]+cepMatch[2]);
    if(byCep)return byCep;
  }

  const known=knownLocalityFromText(raw);
  if(known){
    const municipalityGeo=await geocodeNominatim(known.municipality,known.uf);
    return {
      kind:"locality",
      name:known.name,
      municipality:known.municipality,
      state_code:known.uf,
      admin1:known.uf==="ES"?"Espírito Santo":"",
      country:"Brasil",
      country_code:"BR",
      latitude:Number.isFinite(Number((known as any).latitude))?Number((known as any).latitude):municipalityGeo?.latitude,
      longitude:Number.isFinite(Number((known as any).longitude))?Number((known as any).longitude):municipalityGeo?.longitude
    };
  }

  const localityPhrase=parseMunicipalityLocality(raw);
  if(localityPhrase){
    const municipality=await geocodePlace(localityPhrase.municipality);
    if(municipality){
      const specific=await geocodeNominatim(localityPhrase.locality+", "+localityPhrase.municipality,stateCodeFromResult(municipality));
      if(specific)return {...specific,kind:specific.kind==="city"?"locality":specific.kind,municipality:specific.municipality||municipality.name};
      return {
        kind:"locality",
        name:localityPhrase.locality.replace(/\b\w/g,(x:string)=>x.toUpperCase()),
        municipality:municipality.name,
        state_code:stateCodeFromResult(municipality),
        admin1:municipality.admin1,
        country:municipality.country,
        country_code:municipality.country_code,
        latitude:municipality.latitude,
        longitude:municipality.longitude
      };
    }
  }

  const parsed=parseBrazilLocation(raw);
  if(parsed.kind==="state"){
    return {kind:"state",name:parsed.state.name,state_code:parsed.state.uf,country:"Brasil",country_code:"BR"};
  }

  const query=String(parsed.city||raw).trim();
  const wantedUf=String(parsed.uf||"").toUpperCase();
  const cacheKey=norm("city|"+query+"|"+wantedUf);
  const {data:cached}=await db.from("wa_geo_cache").select("result,updated_at").eq("query_key",cacheKey).maybeSingle();
  if(cached?.result && Date.now()-Date.parse(cached.updated_at||0)<1000*60*60*24*90)return cached.result;

  async function search(name:string){
    try{
      const u=new URL("https://geocoding-api.open-meteo.com/v1/search");
      u.searchParams.set("name",name);
      u.searchParams.set("count","20");
      u.searchParams.set("language","pt");
      u.searchParams.set("format","json");
      u.searchParams.set("countryCode","BR");
      const res=await fetch(u.toString(),{headers:{"accept":"application/json"},signal:AbortSignal.timeout(5000)});
      if(!res.ok)return [];
      const j=await res.json().catch(()=>({}));
      return Array.isArray(j?.results)?j.results:[];
    }catch{return []}
  }

  const results:any[]=await search(query);
  const target=norm(query);
  let pool=results.filter((r:any)=>String(r?.feature_code||"").startsWith("P"));
  if(!pool.length)pool=results;

  let exact=pool.filter((r:any)=>norm(r?.name||"")===target);
  if(wantedUf)exact=exact.filter((r:any)=>stateCodeFromResult(r)===wantedUf);

  if(!wantedUf && exact.length>1){
    const states=[...new Set(exact.map((r:any)=>stateCodeFromResult(r)).filter(Boolean))];
    if(states.length>1){
      const result={kind:"ambiguous",name:query,candidates:states};
      await db.from("wa_geo_cache").upsert({query_key:cacheKey,query_text:raw,result,updated_at:new Date().toISOString()},{onConflict:"query_key"});
      return result;
    }
  }

  let best=exact[0]||null;
  if(!best && wantedUf)best=pool.find((r:any)=>stateCodeFromResult(r)===wantedUf)||null;
  if(!best && !wantedUf)best=pool[0]||null;

  if(best){
    const result={
      kind:"city",
      id:best.id,name:best.name,latitude:Number(best.latitude),longitude:Number(best.longitude),
      country_code:String(best.country_code||"").toUpperCase(),country:best.country||"",
      admin1:best.admin1||"",admin2:best.admin2||"",timezone:best.timezone||"",
      population:Number(best.population||0),feature_code:best.feature_code||""
    };
    await db.from("wa_geo_cache").upsert({query_key:cacheKey,query_text:raw,result,provider:"open-meteo-geonames",updated_at:new Date().toISOString()},{onConflict:"query_key"});
    return result;
  }

  const osm=await geocodeNominatim(query,wantedUf);
  await db.from("wa_geo_cache").upsert({query_key:cacheKey,query_text:raw,result:osm,provider:osm?"openstreetmap-nominatim":"open-meteo-geonames",updated_at:new Date().toISOString()},{onConflict:"query_key"});
  return osm;
}

async function roadRoute(loc:any){
  const key="route|"+Number(loc.latitude).toFixed(5)+","+Number(loc.longitude).toFixed(5);
  const {data:cached}=await db.from("wa_geo_cache").select("result,updated_at").eq("query_key",key).maybeSingle();
  if(cached?.result && Date.now()-Date.parse(cached.updated_at||0)<1000*60*60*24*30)return cached.result;

  try{
    const u=new URL("https://router.project-osrm.org/route/v1/driving/"+BASE_CITY.longitude+","+BASE_CITY.latitude+";"+loc.longitude+","+loc.latitude);
    u.searchParams.set("overview","false");
    u.searchParams.set("steps","false");
    const res=await fetch(u.toString(),{headers:{"accept":"application/json"}});
    const j=await res.json().catch(()=>({}));
    const r=j?.routes?.[0];
    const result=(res.ok && r)?{
      distance_km:Math.round((Number(r.distance)||0)/1000),
      duration_min:Math.round((Number(r.duration)||0)/60)
    }:null;
    await db.from("wa_geo_cache").upsert({
      query_key:key,
      query_text:formatPlace(loc),
      result,
      provider:"osrm-driving",
      updated_at:new Date().toISOString()
    },{onConflict:"query_key"});
    return result;
  }catch{
    return null;
  }
}


function locationGreetingReply(loc:any,seed:string){
  if(loc?.kind==="state"){
    if(loc.state_code==="ES"){
      return pick([
        "Olha só, mais um capixaba por aqui. Eu sou de Boa Esperança-ES. Que bom ter você falando com a gente.",
        "Que legal, você também é do Espírito Santo. Eu sou de Boa Esperança-ES. É muito bom atender gente daqui do nosso estado.",
        "Bacana, então somos capixabas. Eu sou de Boa Esperança-ES. Fico feliz de ter você por aqui."
      ],seed);
    }
    return pick([
      "Nossa, que bom saber que nossos serviços chegaram até você em "+loc.name+". Eu sou de Boa Esperança-ES. Fico muito feliz de atender gente de tão longe.",
      "Que legal saber que você é de "+loc.name+". Eu sou de Boa Esperança-ES. É muito bom ver a JSTech chegando cada vez mais longe.",
      "Olha que bacana. Você está em "+loc.name+" e eu sou de Boa Esperança-ES. Fico feliz demais de saber que nossos serviços chegaram até aí."
    ],seed);
  }

  const cc=String(loc.country_code||"").toUpperCase();
  const uf=stateCodeFromResult(loc);
  const city=loc.name||"sua cidade";

  if(cc==="BR" && uf==="ES" && norm(city)===norm(BASE_CITY.name)){
    return pick([
      "Rapaz  aí é conterrâneo mesmo! Eu sou de Boa Esperança-ES também. Mundo pequeno, viu? ",
      "Aí sim  então somos conterrâneos mesmo! Eu sou de Boa Esperança-ES também.",
      "Olha essa  você é de Boa Esperança também? Então é conterrâneo de verdade "
    ],seed);
  }

  if(cc==="BR" && uf==="ES"){
    return pick([
      "Olha só, somos capixabas. Eu sou de Boa Esperança-ES e você de "+city+". Que bom ter você por aqui.",
      "Que legal, mais um capixaba por aqui. Eu sou de Boa Esperança-ES e você de "+city+".",
      "Bacana, somos do Espírito Santo. Eu sou de Boa Esperança-ES e você de "+city+". Fico feliz em te atender."
    ],seed);
  }

  if(cc==="BR"){
    const state=loc.admin1||uf||"outro estado";
    return pick([
      "Nossa, que bom saber que nossos serviços chegaram até você aí em "+city+", "+state+". Eu sou de Boa Esperança-ES. Fico muito feliz com isso.",
      "Que legal. Você está em "+city+", "+state+", e eu sou de Boa Esperança-ES. É muito bom ver a JSTech chegando tão longe.",
      "Olha que bacana. Eu sou de Boa Esperança-ES e você está em "+city+", "+state+". Fico feliz demais de saber que nossos serviços chegaram até você."
    ],seed);
  }

  return pick([
    "Nossa, que bom saber que nossos serviços chegaram até você em "+formatPlace(loc)+". Eu sou de Boa Esperança, Espírito Santo, Brasil. Fico muito feliz com isso.",
    "Que legal. Você está em "+formatPlace(loc)+" e eu sou de Boa Esperança-ES, no Brasil. É muito bom ver a JSTech chegando tão longe.",
    "Olha que bacana. Eu sou de Boa Esperança, Espírito Santo, Brasil, e você está em "+formatPlace(loc)+". Fico feliz demais de saber que nossos serviços chegaram até aí."
  ],seed);
}

function distanceReply(loc:any,route:any,seed:string){
  if(loc?.kind!=="city")return locationGreetingReply(loc,seed);
  const straight=Math.round(haversineKm(BASE_CITY.latitude,BASE_CITY.longitude,loc.latitude,loc.longitude));
  const d=route?.distance_km||straight;
  const city=loc.name||"sua cidade";
  if(route){
    return pick([
      city+" fica a aproximadamente "+d+" km por estrada de Boa Esperança-ES.",
      "De Boa Esperança-ES até "+city+" dá aproximadamente "+d+" km por estrada.",
      "A distância de Boa Esperança-ES até "+city+" fica em torno de "+d+" km por estrada."
    ],seed);
  }
  return city+" fica a aproximadamente "+straight+" km em linha reta de Boa Esperança-ES.";
}


async function locationConversationReply(text:string,context:any={},phone:string=""){
  const claim=extractLocationClaim(text,context);
  const asks=asksWhereAreYou(text);
  const geoQuestion=asksGeoQuestion(text);
  const questionPlace=extractGeoQuestionPlace(text);
  const t=norm(text);

  const currentLoc=context?.customer_location||null;
  if(currentLoc && !questionPlace && /\b(e perto|é perto|fica perto|e longe|é longe|fica longe|quantos km|quantos quilometros|quantos quilômetros|qual distancia|qual distância|distancia daqui|distância daqui|perto de voce|perto de vc|sabe.*quantos.*(?:km|quilometros|quilômetros))\b/.test(t)){
    if(Number.isFinite(Number(currentLoc?.latitude))&&Number.isFinite(Number(currentLoc?.longitude))){
      const route=await roadRoute(currentLoc);
      return {handled:true,reply:distanceReply({...currentLoc,kind:"city"},route,t+"|distance"),location:currentLoc,awaiting_location:false};
    }
    const where=formatPlace(currentLoc)||String(currentLoc?.name||"esse local");
    return {handled:true,reply:"Você me informou "+where+". Para calcular a distância exata por estrada, preciso que a localidade esteja identificada com coordenadas. Posso tentar pela cidade, município ou CEP.",location:currentLoc,awaiting_location:false};
  }

  if(questionPlace){
    const loc=await geocodePlace(questionPlace);
    if(loc?.kind==="ambiguous"){
      const states=(loc.candidates||[]).join(", ");
      return {handled:true,reply:"Encontrei mais de um lugar com esse nome. Me diga o estado"+(states?"; aparecem opções em "+states:"")+" para eu identificar o local certo.",location:null,awaiting_location:true};
    }
    if(loc){
      const uf=stateCodeFromResult(loc);
      const municipality=String(loc?.municipality||loc?.admin2||"").trim();
      const place=String(loc?.name||questionPlace).trim();
      const stateName=String(loc?.admin1||STATE_BY_UF[uf]?.name||"").trim();
      const isDistance=/\b(quantos km|distancia|distância|perto|longe)\b/.test(t);

      if(isDistance && Number.isFinite(Number(loc?.latitude))&&Number.isFinite(Number(loc?.longitude))){
        const route=await roadRoute(loc);
        const straight=Math.round(haversineKm(BASE_CITY.latitude,BASE_CITY.longitude,Number(loc.latitude),Number(loc.longitude)));
        const d=Number(route?.distance_km||straight);
        let proximity="";
        if(d<=40)proximity=" É bem perto.";
        else if(d<=120)proximity=" É relativamente perto.";
        else proximity=" Já fica mais distante.";
        return {
          handled:true,
          reply:"De Boa Esperança-ES até "+place+" dá aproximadamente "+d+" km "+(route?"por estrada":"em linha reta")+"."+proximity,
          location:loc,
          awaiting_location:false
        };
      }

      if(/\b(qual municipio|qual município|pertence a qual municipio|pertence a qual município)\b/.test(t)){
        if(municipality)return {handled:true,reply:place+" fica no município de "+municipality+(uf?"-"+uf:"")+".",location:loc,awaiting_location:false};
      }

      if(/\bqual estado\b/.test(t)){
        const state=stateName||(uf?STATE_BY_UF[uf]?.name:"");
        if(state)return {handled:true,reply:place+" fica em "+state+(uf?" ("+uf+")":"")+".",location:loc,awaiting_location:false};
      }

      if(loc?.kind==="postal"){
        const bits=[
          loc.street,
          loc.neighbourhood,
          municipality,
          uf
        ].filter(Boolean);
        return {handled:true,reply:"Esse CEP corresponde a "+bits.join(", ")+".",location:loc,awaiting_location:false};
      }

      if(["locality","neighbourhood","place"].includes(String(loc?.kind||""))){
        const where=municipality
          ? place+" fica no município de "+municipality+(uf?"-"+uf:"")
          : formatPlace(loc);
        return {handled:true,reply:where+".",location:loc,awaiting_location:false};
      }

      if(loc?.kind==="city"){
        const where=String(loc?.country_code||"").toUpperCase()==="BR"
          ? place+" fica em "+(stateName||uf||"Brasil")+(uf&&stateName?" ("+uf+")":"")
          : formatPlace(loc);
        return {handled:true,reply:where+".",location:loc,awaiting_location:false};
      }

      return {handled:true,reply:formatPlace(loc)+".",location:loc,awaiting_location:false};
    }

    // Se o geocodificador não achou, deixa a IA com pesquisa na web tentar antes de dizer que não existe.
    return {handled:false};
  }

  if(claim){
    const loc=await geocodePlace(claim);
    if(loc?.kind==="ambiguous"){
      const states=(loc.candidates||[]).join(", ");
      return {
        handled:true,
        reply:"Encontrei mais de uma cidade chamada "+loc.name+" no Brasil. Me fala o estado também"+(states?"; aparecem opções em "+states:"")+" para eu não confundir a cidade.",
        location:null,
        awaiting_location:true
      };
    }
    if(loc){
      if(["locality","neighbourhood","place","postal"].includes(String(loc?.kind||""))){
        const uf=String(loc.state_code||stateCodeFromResult(loc)||"").toUpperCase();
        const place=String(loc.name||claim).trim();
        const municipality=String(loc.municipality||loc.admin2||"").trim();
        const where=municipality ? place+", no município de "+municipality+(uf?"-"+uf:"") : formatPlace(loc);
        const reply=uf==="ES"
          ? "Ah, "+where+". Agora entendi. Estamos no mesmo estado. Me conta o que você precisa que eu já sigo com você."
          : "Ah, "+where+". Agora entendi. Me conta o que você precisa que eu já sigo com você.";
        return {handled:true,reply,location:loc,awaiting_location:false};
      }

      let reply=locationGreetingReply(loc,norm(text)+"|"+String(context?.turn||0));
      const uf=stateCodeFromResult(loc);
      if(loc?.kind==="city" && String(loc.country_code||"").toUpperCase()==="BR" && uf==="ES"){
        const route=await roadRoute(loc);
        const d=route?.distance_km;
        if(Number.isFinite(d) && d<=140){
          reply="Ah, "+loc.name+"! É pertinho de Boa Esperança, cerca de "+d+" km por estrada. Ótimo, estamos bem perto. Além de IPTV, CS, painéis e suporte, a JSTech trabalha com instalação e assistência de antenas, câmeras de segurança, Starlink, motores de portão, fechaduras, cerca elétrica, alarmes e instalação de TVs. Se precisar de algum desses serviços, já sabe com quem falar.";
        }else{
          reply="Ah, "+loc.name+"! Então somos do Espírito Santo. Muito bom ter você por aqui. Além de IPTV, CS, painéis e suporte, também trabalhamos com instalação e assistência de antenas, câmeras, Starlink, motores de portão, fechaduras, cerca elétrica, alarmes e instalação de TVs.";
        }
      }else if(loc?.kind==="city" && String(loc.country_code||"").toUpperCase()==="BR"){
        reply="Nossa, que bom saber que nossos serviços chegaram até você em "+loc.name+", "+(loc.admin1||uf||"Brasil")+". A JSTech é de Boa Esperança-ES, mas atende clientes de várias regiões. Vamos dar início a uma grande jornada por aqui; posso te ajudar com IPTV, CS, painéis, suporte e outras soluções online.";
      }else{
        const sales=regionalSalesLine(phone);
        if(sales)reply+=" "+sales;
      }
      return {handled:true,reply:reply+" Me conta o que você precisa que eu já sigo com você.",location:loc,awaiting_location:false};
    }

    // Um nome pequeno pode ser bairro, distrito, patrimônio, comunidade ou zona rural.
    // A IA com pesquisa na web tenta confirmar antes de pedir mais dados.
    return {handled:false};
  }

  if(asks){
    if(context?.customer_location){
      const loc=context.customer_location;
      const label=formatPlace(loc)||String(loc?.name||"");
      return {handled:true,reply:"Sou de Boa Esperança, no Espírito Santo. Você me informou que está em "+label+".",location:loc,awaiting_location:false};
    }
    const region=phoneRegion(phone);
    const regional=region
      ? (region.uf==="ES"
          ? "Sou de Boa Esperança, no Espírito Santo. Que bom, estamos no mesmo estado."
          : "Sou de Boa Esperança, no Espírito Santo. Que legal saber que você está em "+region.state+".")
      : "Sou de Boa Esperança, Espírito Santo.";
    return {handled:true,reply:regional+" E você, fala de qual cidade, bairro, distrito ou localidade?",location:null,awaiting_location:true};
  }

  if(geoQuestion)return {handled:false};
  return {handled:false};
}

async function transcribeSupportMedia(base64:string,mime:string,fileName:string){
  const key=Deno.env.get("GEMINI_API_KEY");
  if(!key||!base64)return "";
  const raw=base64.includes(",")?base64.split(",",2)[1]:base64;
  if(raw.length>22000000)return "";
  let mt=String(mime||"audio/ogg").toLowerCase().split(";")[0]||"audio/ogg";
  if(mt==="application/ogg"||mt==="application/octet-stream")mt="audio/ogg";
  try{
    const configuredModel=String(Deno.env.get("GEMINI_MODEL")||"").trim();
    const model=/^gemini-3\.6-flash/i.test(configuredModel)?configuredModel:"gemini-3.6-flash";
    const res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
      method:"POST",
      headers:{"x-goog-api-key":key,"content-type":"application/json"},
      body:JSON.stringify({
        contents:[{role:"user",parts:[
          {text:"Transcreva este áudio de WhatsApp em português do Brasil. Retorne somente a transcrição, sem explicações. Preserve corretamente termos de suporte como IPTV, P2P, código, aplicativo, TV Box, receptor, painel, teste, usuário, senha, ativar e abrir."},
          {inlineData:{mimeType:mt,data:raw}}
        ]}],
        generationConfig:{maxOutputTokens:1200,thinkingConfig:{thinkingLevel:"low"}}
      }),
      signal:AbortSignal.timeout(45000)
    });
    if(!res.ok){
      console.error("Gemini transcription error",res.status,(await res.text().catch(()=>"")).slice(0,800));
      return "";
    }
    const data=await res.json().catch(()=>({}));
    return String(data?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||"").join("")||"").trim();
  }catch(e){
    console.error("Gemini transcription exception",String(e));
    return "";
  }
}

function isStreamingSupportProblem(text:string){
  const t=norm(text);
  return /\b(tv aberta|tv ao vivo|canal|canais|filme|filmes|serie|series|série|séries|travando|trava|garra|carregando|nao abre|não abre|nao funciona|não funciona|parou|sem imagem|tela preta)\b/.test(t);
}

function supportFallbackReply(text:string,context:any={}){
  const t=norm(text);
  const app=String(context?.support_app||"").trim();

  if(/\b(tv aberta|tv ao vivo|canal|canais)\b/.test(t) && /\b(nao|não|parou|sem|funciona|funcionando|abre|abrindo)\b/.test(t)){
    return "Entendi. A TV ao vivo não está abrindo. Primeiro feche o aplicativo completamente e abra de novo. Se continuar igual, reinicie a TV ou TV Box e o roteador. Depois me diga qual aplicativo está usando para eu seguir no teste certo.";
  }

  if(/\b(filme|filmes|serie|series|série|séries)\b/.test(t) && /\b(trava|travando|garra|para|parando|carrega|carregando|nao funciona|não funciona)\b/.test(t)){
    return "Entendi. Se filmes e séries começam e depois travam, vamos separar se é aplicativo ou conexão. Feche o app, reinicie o roteador e o aparelho e teste novamente. Se a TV ao vivo funcionar normal mas filmes e séries continuarem travando, me diga o nome do aplicativo que você usa.";
  }

  if(/\b(esta carregando|está carregando|so carrega|só carrega|fica carregando)\b/.test(t)){
    return "Certo. Se ficou só carregando e não abriu, não precisa ficar esperando. Feche o aplicativo por completo, reinicie o aparelho e o roteador e abra novamente. Se continuar carregando, me diga qual aplicativo está aberto agora.";
  }

  if(/\b(continua na mesma|mesma coisa|nao resolveu|não resolveu|continua igual)\b/.test(t)){
    return "Certo, então esse teste não resolveu. Me diga qual aplicativo está usando agora e se o problema acontece na TV ao vivo, nos filmes e séries ou em tudo. Aí eu sigo para o próximo teste sem repetir o que você já fez.";
  }

  if(/\b(cloud|cloudy|cloudyy)\b/.test(t)){
    return "Certo, é no Cloud. Me diga o que acontece nele agora: fica carregando, dá erro, abre a TV ao vivo mas não abre filmes, ou não abre nada?";
  }

  if(/\b(fun play|funplay|fun pley|funpley)\b/.test(t)){
    return "Certo, você está usando o Fun Play. Como você já informou que não está abrindo nada, não precisa repetir. Feche o aplicativo por completo, limpe o cache do Fun Play e abra novamente. Se continuar igual, me diga se aparece alguma mensagem ou se fica apenas carregando.";
  }

  if(/\b(cinebox|cine box)\b/.test(t) && /\b(erro|mensagem|aparece|aparecendo)\b/.test(t)){
    return "Entendi: o erro aparece no receptor Cinebox. Não precisa escolher o serviço de novo. Me envie exatamente a mensagem ou o código que aparece na tela; se for mais fácil, mande uma foto do erro que eu vejo e continuo daqui.";
  }

  if(/^(sim|blz|beleza|entendi|certo|ok)$/.test(t) && context?.node==="support"){
    return "Certo. Faz o teste que combinamos e me diga só o resultado: abriu normal, ficou carregando ou continua travando.";
  }

  if(/\b(erro ao carregar canais|nenhum canal encontrado|nao encontrou nenhum canal|não encontrou nenhum canal)\b/.test(t)){
    return "Certo, agora ficou claro: o "+(app||"aplicativo")+" está mostrando erro ao carregar os canais e nenhum canal encontrado. Não precisa repetir. Primeiro atualize ou recarregue a lista dentro do aplicativo. Se continuar, me mande uma foto da tela de configuração do acesso, escondendo a senha, que eu confiro o servidor e o usuário.";
  }

  if(/\b(erro|invalido|inválido|falhou|nao encontrado|não encontrado|sem canais|sem canal)\b/.test(t)){
    const problem=String(text||"").trim().replace(/\s+/g," ");
    return "Entendi. No "+(app||"aplicativo")+" aparece: “"+problem+"”. Não precisa me informar o aplicativo novamente. Feche e abra o app e tente atualizar a lista. Se o erro continuar, mande uma foto da tela que eu sigo pelo erro exato.";
  }

  if(app && /\b(nao funciona nada|não funciona nada|nao abre nada|não abre nada|parou tudo)\b/.test(t)){
    return "Certo, no "+app+" não está funcionando nada. Feche o aplicativo completamente, reinicie o aparelho e o roteador e abra de novo. Se continuar, me diga a mensagem que aparece ou mande uma foto da tela.";
  }

  if(app){
    return "Estou acompanhando o atendimento no "+app+". O que aconteceu depois do último teste? Pode mandar a mensagem de erro ou uma foto da tela.";
  }

  return "";
}


async function supportConversationBrain(conversationId:string,text:string,context:any={}){
  const {data:recent}=await db.from("wa_messages")
    .select("direction,sender_type,content,created_at")
    .eq("conversation_id",conversationId)
    .order("created_at",{ascending:false})
    .limit(18);

  const rows=Array.isArray(recent)?recent:[];
  const inbound=rows
    .filter((m:any)=>m.direction==="in")
    .slice(0,7)
    .map((m:any)=>String(m.content||"").trim())
    .filter(Boolean)
    .reverse();
  const combined=[...inbound,String(text||"").trim()].filter(Boolean).join(" | ");
  const t=norm(combined);
  const current=norm(text);
  let app=String(context?.support_app||"").trim();
  if(/\b(fun play|funplay|fun pley|funpley)\b/.test(t))app="Fun Play";
  else if(/\b(cloud|cloudy|cloudyy)\b/.test(t))app="Cloud";
  else if(/\b(cinebox|cine box)\b/.test(t))app="Cinebox";

  const stage=String(context?.support_stage||"");
  let reply="";
  let nextStage=stage||"collecting_problem";
  let summary=String(context?.support_summary||"").trim();

  const channelListError=/\b(erro ao carregar canais|nenhum canal encontrado|nao encontrou nenhum canal|não encontrou nenhum canal|sem canais|lista nao carrega|lista não carrega)\b/.test(t);
  const invalidAccount=/\b(conta|usuario|usuário|login|senha|acesso)\b/.test(t)
    && /\b(invalida|inválida|invalido|inválido|incorreta|incorreto|expirou|vencido|nao entra|não entra)\b/.test(t);
  const shortConfirmation=/^(isso|sim|e isso|é isso|exato|exatamente|\?\?\?|ok|certo|blz|beleza|aguardo|fico no aguardo)$/.test(current);

  const cloudLoginScreen=/\b(cloud|xcloud)\b/.test(t) && /\b(login|password|senha|email|forgot|sign up)\b/.test(t);
  const cloudStatusQuestion=/\b(xcloud|cloud)\b/.test(t)
    && /\b(off|offline|fora do ar|caiu|parou|indisponivel|indisponível|o que houve|que houve)\b/.test(t);
  const contextCloud=(app==="Cloud"||/\bxcloud\b/.test(norm(summary)));

  if(cloudStatusQuestion){
    app="XCloud";
    summary="XCloud voltou para a tela de login; cliente perguntou se o painel está offline";
    reply="Entendi. O XCloud voltou para a tela de login e você quer saber se o painel caiu. Ainda não tenho confirmação de queda geral, então não vou inventar. Não altere nem apague o acesso agora. Tente tocar em Login uma vez; se aparecer alguma mensagem, mande o texto ou a foto que eu continuo exatamente daqui.";
    nextStage="xcloud_status_check";
  }else if(cloudLoginScreen){
    app="XCloud";
    summary="XCloud voltou para a tela de login";
    reply="Vi a tela: o XCloud voltou para o login. O e-mail está preenchido e a senha está oculta. Não envie sua senha aqui. Toque em Login uma vez e me diga se entra, se volta para essa mesma tela ou se aparece alguma mensagem de erro.";
    nextStage="xcloud_login_test";
  }else if(contextCloud && /^(\?\?+|eai|e ai|oi|ola|olá)$/.test(current)){
    app="XCloud";
    reply=stage==="xcloud_status_check"
      ? "Estou seguindo no problema do XCloud que voltou para o login. Ainda não há confirmação de queda geral. Ao tocar em Login, ele entra, volta para a mesma tela ou mostra algum erro?"
      : "Continuando no XCloud: ao tocar em Login, ele entra, volta para a mesma tela ou aparece alguma mensagem de erro?";
    nextStage=stage||"xcloud_login_test";
  }else if(channelListError){
    summary=(app?app+": ":"")+"erro ao carregar canais e nenhum canal encontrado";
    if(stage==="refresh_list_requested" && /\b(continua|igual|mesma|nao resolveu|não resolveu|ainda|\?\?\?|nao funciona|não funciona|nao esta funcionando|não está funcionando|nao abriu|não abriu|travou|parou|nada)\b/.test(current)){
      reply="Certo, a recarga da lista não resolveu. Agora vamos conferir o acesso que está no "+(app||"aplicativo")+". Abra a tela onde aparecem o servidor e o usuário e me mande uma foto. Não precisa mostrar a senha.";
      nextStage="awaiting_access_screen";
    }else{
      reply="Agora entendi: no "+(app||"aplicativo")+" aparece “erro ao carregar canais” e também “nenhum canal encontrado”. Primeiro abra o menu do aplicativo e use a opção Atualizar, Recarregar ou Sincronizar lista. Depois me diga se os canais voltaram ou se o mesmo erro continuou.";
      nextStage="refresh_list_requested";
    }
  }else if(invalidAccount){
    summary=(app?app+": ":"")+"conta ou acesso inválido";
    reply=app
      ? "Entendi. No "+app+" a conta está aparecendo como inválida. Me mande uma foto da tela do erro e diga se o acesso é por usuário e senha, código ou URL. Não envie a senha aqui."
      : "Entendi, a conta está aparecendo como inválida. Qual aplicativo está usando? Se puder, mande também uma foto da tela do erro. Não envie sua senha.";
    nextStage=app?"awaiting_invalid_account_screen":"awaiting_support_app";
  }else if(shortConfirmation && summary){
    reply="Certo, estou seguindo pelo problema que você já informou: "+summary+". O último teste resolveu ou continua aparecendo o mesmo erro?";
    nextStage=stage||"checking_result";
  }else{
    reply=supportFallbackReply(combined,{...context,support_app:app});
    if(reply)summary=summary||String(text||"").trim();
  }

  if(!reply)return null;

  const lastOut=rows.find((m:any)=>m.direction==="out");
  const lastText=String(lastOut?.content||"")
    .replace(/^\s*[^\n]{1,60},\s*disse:\s*/i,"")
    .trim();
  if(lastText && norm(lastText)===norm(reply)){
    reply="Já anotei essa informação e não vou repetir a pergunta. "+(summary
      ? "Estamos tratando de "+summary+". "
      : "")+"Me diga somente o resultado do último teste ou mande uma foto da tela atual.";
    nextStage=stage||"checking_result";
  }

  return {reply,app,nextStage,summary};
}

function naturalFallback(text:string,context:any={}){
  const t=norm(text);
  const turn=Number(context?.turn||0)+1;
  const seed=t+"|"+turn;
  const company=String(context?.company_name||"").trim();
  const agent=String(context?.agent_name||"").trim();

  if(isGeneralQuoteRequest(text))return generalJSTechPricesReply();
  if(isAntennaMaterialPriceQuestion(text))
    return "O fio coaxial fica R$ 2 por metro e o conector fica R$ 5 por unidade.";
  if(isReceiverRepairPriceQuestion(text))
    return "Conserto de receptor é feito por orçamento porque depende do modelo e do defeito. Me diga qual é o modelo e se ele não liga, está sem sinal, travando, sem imagem ou apresenta outro problema que eu sigo com a cotação.";

  if(/\b(voce e robo|vc e robo|e robo|automatico|atendimento automatico|e uma ia|voce e humano|vc e humano)\b/.test(t))
    return agent
      ?"Sou "+agent+", da equipe de atendimento. Pode falar comigo por aqui mesmo, me conta o que você precisa que eu sigo com você."
      :"Sou da equipe de atendimento. Pode falar comigo por aqui mesmo, me conta o que você precisa que eu sigo com você.";

  if(/\b(de onde voce e|de onde vc e|vcs? e de onde|voces? sao de onde|onde voces ficam|onde fica|qual cidade)\b/.test(t))
    return pick([
      "Sou da JSTech  O atendimento é feito por aqui mesmo no WhatsApp e a gente atende clientes de várias regiões. Você fala de qual cidade?",
      "Aqui é da JSTech  Nosso atendimento é online pelo WhatsApp. E você, é de qual cidade?",
      "Atendo pela JSTech por aqui  A gente atende online. Você está falando de qual cidade?"
    ],seed);

  if(/\b(qual seu nome|como voce chama|como vc chama|quem fala|com quem eu falo|quem e voce|quem e vc)\b/.test(t))
    return agent
      ? pick([
          "Sou "+agent+". Pode falar comigo por aqui, o que você precisa?",
          "Pode me chamar de "+agent+". Me conta no que posso te ajudar.",
          "Sou "+agent+", do atendimento"+(company?" da "+company:"")+". Pode falar comigo."
        ],seed)
      : "Sou do atendimento"+(company?" da "+company:"")+". Pode falar comigo por aqui.";

  if(/\b(tudo bem|como voce esta|como vc ta|como vc esta|ta tudo bem|esta tudo bem)\b/.test(t))
    return pick([
      "Tudo bem sim  E por aí, tudo certo?",
      "Tudo certo por aqui  E com você?",
      "Tudo tranquilo  E por aí, como estão as coisas?"
    ],seed);

  if(/\b(sou de|moro em|falo de|estou em|to em)\b/.test(t))
    return pick([
      "Legal  A gente atende por aqui mesmo no WhatsApp. Me conta, o que você está procurando?",
      "Que bacana  Atendemos online por aqui. O que você precisa hoje?",
      "Show  Dá para resolver muita coisa por aqui mesmo. O que você está procurando?"
    ],seed);

  if(/\b(obrigad|valeu|vlw|agradeco)\b/.test(t))
    return pick([
      "Imagina  Precisando, é só falar comigo.",
      "Por nada  Estou por aqui.",
      "Disponha  Se precisar de mais alguma coisa, me chama."
    ],seed);

  if(/^(oi|ola|opa|e ai|bom dia|boa tarde|boa noite)[!. ]*$/.test(t))
    return pick([
      "Oi  Tudo bem? Como posso te ajudar?",
      "Opa  Tudo certo? Me conta, no que posso te ajudar?",
      "Oi  Seja bem-vindo à JSTech. O que você precisa hoje?"
    ],seed);

  if(/\b(beleza|blz|tranquilo|show|top|bacana|legal)\b/.test(t))
    return pick([
      "Show  Me conta o que você precisa.",
      "Beleza  Pode falar, estou te acompanhando.",
      "Perfeito  E o que você está procurando?"
    ],seed);

  if(/\b(quero comprar|quero contratar|tenho interesse|me interessei)\b/.test(t))
    return "Claro  Me fala qual serviço você está procurando que eu te explico direitinho, sem enrolação.";

  if(/\b(me explica|como funciona|quero saber mais|mais informacoes|mais info)\b/.test(t))
    return "Claro  Me diz só sobre qual serviço você quer saber mais que eu te explico certinho.";

  if(/\b(codigo|código|senha|login|usuario|usuário)\b/.test(t))
    return "Entendi. Me diga qual aplicativo ou aparelho está usando e mande o código ou a mensagem que aparece na tela. Aí eu confiro exatamente o que está impedindo de abrir.";

  if(t==="audio recebido")
    return "Não consegui ouvir esse áudio com clareza. Pode reenviar o áudio ou escrever a parte principal para eu continuar do mesmo ponto.";

  if(/^(tv|televisao|televisão)$/.test(t) || /\b(instala|instalar|instalacao|instalação)\b.*\b(tv|televisao|televisão)\b/.test(t))
    return "Sim, fazemos instalação de TV. Me diga o tamanho da TV, se o suporte já está no local e em qual cidade será a instalação para eu orientar certinho.";
  if(/\b(novidade|novidades|promocao|promoção|lancamento|lançamento)\b/.test(t))
    return "Claro. Você quer ver as novidades de IPTV, CS ou dos serviços técnicos da empresa?";
  return "Entendi. Qual é o assunto: IPTV, CS, aplicativo ou serviço técnico? Aí eu sigo direto no que você precisa.";
}

function responseTextFromOpenAI(data:any,allowLinks=false){
  let text="";
  if(typeof data?.output_text==="string" && data.output_text.trim()){
    text=data.output_text.trim();
  }else{
    const chunks:string[]=[];
    for(const item of data?.output||[]){
      for(const part of item?.content||[]){
        if(part?.type==="output_text" && part?.text)chunks.push(part.text);
      }
    }
    text=chunks.join("\n").trim();
  }

  const sources:{url:string,title?:string}[]=[];
  const seen=new Set<string>();
  for(const item of data?.output||[]){
    if(item?.type==="web_search_call"){
      const arr=item?.action?.sources||[];
      for(const s of arr){
        const u=String(s?.url||"").trim();
        if(u && !seen.has(u)){seen.add(u);sources.push({url:u,title:s?.title});}
      }
    }
    for(const part of item?.content||[]){
      for(const a of part?.annotations||[]){
        if(a?.type==="url_citation"){
          const u=String(a?.url||"").trim();
          if(u && !seen.has(u)){seen.add(u);sources.push({url:u,title:a?.title});}
        }
      }
    }
  }

  text=text
    .replace(/^\s*(?:ana|assistente|atendente)\s*[,;:-]?\s*(?:disse|respondeu)\s*:\s*/i,"")
    .replace(/^\s*(?:resposta|mensagem)\s+(?:ao|para o)\s+cliente\s*:\s*/i,"")
    .trim();

  if(allowLinks){
    text=text
      .replace(/\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g,"$2")
      .replace(/\s*\(\s*\)/g,"")
      .replace(/\n?Fontes consultadas:[\s\S]*$/i,"")
      .trim();
  }else{
    text=text
      .replace(/\s*\[[^\]]*\]\([^\)]*\)/g,"")
      .replace(/https?:\/\/\S+/g,"")
      .replace(/\s*\(\s*\)/g,"")
      .replace(/\n?Fontes consultadas:[\s\S]*$/i,"")
      .trim();
  }
  return text;
}

function moneyBR(v:any){
  const n=Number(v);
  if(!Number.isFinite(n))return "";
  return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
}
function parseReceiptJson(raw:string){
  let s=String(raw||"").trim().replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim();
  try{return JSON.parse(s)}catch{}
  const a=s.indexOf("{"),b=s.lastIndexOf("}");
  if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1))}catch{}}
  return null;
}
async function analyzePaymentReceipt(base64:string,mime:string,fileName:string=""){
  if(!base64)return null;
  const raw=base64.includes(",")&&base64.startsWith("data:")?base64.split(",",2)[1]:base64;
  if(raw.length>24000000)return {error:"media_too_large"};
  const mt=String(mime||"").split(";")[0]||"image/jpeg";
  const prompt="Analise SOMENTE este comprovante PIX. Isto é pré-validação documental e NÃO confirma que o dinheiro caiu. Extraia apenas o que estiver legível, nunca invente. Responda APENAS JSON válido com: image_summary string curta, extracted_text string, image_type string, is_payment_receipt boolean, amount número ou null, payer_name string ou null, receiver_name string ou null, receiver_key string ou null, transaction_id string ou null, txid string ou null, end_to_end_id string ou null, payment_date string ou null, paid_at_iso string ou null, bank string ou null, suspicious boolean, risk_score número 0-100, confidence número 0-1, reason string.";

  if(mt.includes("pdf")){
    const key=Deno.env.get("OPENAI_API_KEY");
    if(!key)return null;
    try{
      const res=await fetch("https://api.openai.com/v1/responses",{
        method:"POST",
        headers:{"authorization":"Bearer "+key,"content-type":"application/json"},
        body:JSON.stringify({
          model:Deno.env.get("OPENAI_VISION_MODEL")||Deno.env.get("OPENAI_MODEL")||"gpt-5.6-luna",
          input:[{role:"user",content:[
            {type:"input_text",text:prompt},
            {type:"input_file",filename:fileName||"comprovante.pdf",file_data:"data:application/pdf;base64,"+raw}
          ]}],
          max_output_tokens:700
        }),
        signal:AbortSignal.timeout(45000)
      });
      if(!res.ok){
        console.error("OpenAI PDF receipt analysis error",res.status,(await res.text().catch(()=>"")).slice(0,800));
        return null;
      }
      const data=await res.json().catch(()=>({}));
      const chunks:string[]=[];
      if(typeof data?.output_text==="string")chunks.push(data.output_text);
      for(const item of data?.output||[])for(const part of item?.content||[])if(part?.type==="output_text"&&part?.text)chunks.push(part.text);
      return parseReceiptJson(chunks.join("\n"));
    }catch(e){
      console.error("OpenAI PDF receipt analysis exception",String(e));
      return null;
    }
  }

  const key=Deno.env.get("GEMINI_API_KEY");
  if(!key)return null;
  try{
    const model=String(Deno.env.get("GEMINI_MODEL")||"gemini-3.6-flash").trim();
    const res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
      method:"POST",
      headers:{"x-goog-api-key":key,"content-type":"application/json"},
      body:JSON.stringify({
        contents:[{role:"user",parts:[{text:prompt},{inlineData:{mimeType:/^image\//i.test(mt)?mt:"image/jpeg",data:raw}}]}],
        generationConfig:{temperature:0,maxOutputTokens:900,responseMimeType:"application/json"}
      }),
      signal:AbortSignal.timeout(45000)
    });
    if(!res.ok){
      console.error("Gemini receipt analysis error",res.status,(await res.text().catch(()=>"")).slice(0,800));
      return null;
    }
    const data=await res.json().catch(()=>({}));
    const answer=String(data?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||"").join("")||"").trim();
    const parsed=parseReceiptJson(answer);
    return parsed&&typeof parsed==="object"?parsed:null;
  }catch(e){
    console.error("Gemini receipt analysis exception",String(e));
    return null;
  }
}

async function analyzeSupportImage(base64:string,mime:string,fileName:string=""){
  if(!base64)return null;
  const raw=base64.includes(",")&&base64.startsWith("data:")?base64.split(",",2)[1]:base64;
  if(raw.length>24000000)return {error:"media_too_large"};
  const mt=String(mime||"").split(";")[0]||"image/jpeg";
  const key=Deno.env.get("GEMINI_API_KEY");
  if(!key)return null;

  const prompt=[
    "Analise esta foto enviada em uma conversa de suporte/ativação de TV ou aplicativo.",
    "Extraia somente o que estiver realmente visível. Nunca invente.",
    "Responda APENAS JSON válido com estes campos:",
    "image_summary string curta, extracted_text string, app_or_device string ou null, tv_brand string ou null, device_type string ou null, device_mac string ou null, device_key string ou null, visible_code string ou null, detected_issue string ou null, is_payment_receipt boolean, confidence número 0-1.",
    "Se a tela mostrar um aplicativo IPTV/player, identifique o nome exibido.",
    "Se houver Device MAC/MAC Address, copie exatamente.",
    "Se houver Device Key/Key/Código, copie exatamente.",
    "Se não estiver legível, use null."
  ].join(" ");

  try{
    const model=String(Deno.env.get("GEMINI_MODEL")||"gemini-3.6-flash").trim();
    const res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
      method:"POST",
      headers:{"x-goog-api-key":key,"content-type":"application/json"},
      body:JSON.stringify({
        contents:[{role:"user",parts:[
          {text:prompt},
          {inlineData:{mimeType:/^image\//i.test(mt)?mt:"image/jpeg",data:raw}}
        ]}],
        generationConfig:{
          maxOutputTokens:900,
          responseMimeType:"application/json",
          thinkingConfig:{thinkingLevel:"low"}
        }
      }),
      signal:AbortSignal.timeout(15000)
    });
    if(!res.ok){
      console.error("Gemini support image analysis error",res.status,(await res.text().catch(()=>"")).slice(0,800));
      return null;
    }
    const data=await res.json().catch(()=>({}));
    const answer=String(data?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||"").join("")||"").trim();
    const parsed=parseReceiptJson(answer);
    return parsed&&typeof parsed==="object"?parsed:null;
  }catch(e){
    console.error("Gemini support image analysis exception",String(e));
    return null;
  }
}

function imageAnalysisText(a:any){
  if(!a||a?.error)return "";
  const parts:string[]=[];
  const summary=String(a?.image_summary||"").trim();
  const extracted=String(a?.extracted_text||"").trim();
  const issue=String(a?.detected_issue||"").trim();
  const code=String(a?.visible_code||"").trim();
  const device=String(a?.app_or_device||"").trim();
  const brand=String(a?.tv_brand||"").trim();
  const mac=String(a?.device_mac||"").trim();
  const key=String(a?.device_key||"").trim();
  if(summary)parts.push(summary);
  if(device)parts.push("Aplicativo identificado: "+device);
  if(brand)parts.push("Marca da TV: "+brand);
  if(mac)parts.push("Device MAC: "+mac);
  if(key)parts.push("Device Key: "+key);
  if(issue)parts.push("Problema visível: "+issue);
  if(code)parts.push("Código visível: "+code);
  if(extracted)parts.push("Texto visível: "+extracted);
  return parts.join(". ").slice(0,5000);
}
async function handlePaymentReceipt(wid:string,contact:any,conv:any,phone:string,externalId:string|null,media:any,caption:string,preAnalysis:any=null){
  const supported=media?.kind==="image"||(media?.kind==="document"&&String(media?.mime||"").toLowerCase().includes("pdf"));
  if(!supported||!media?.base64)return null;

  const t=norm(caption||"");
  const [{data:payment},{data:pixSettings}]=await Promise.all([
    db.from("wa_payments").select("*")
      .eq("workspace_id",wid).eq("contact_id",contact.id)
      .in("status",["pendente","pending","aguardando_confirmacao","aguardando"])
      .order("created_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("wa_settings").select("pix_key,pix_holder").eq("workspace_id",wid).maybeSingle()
  ]);

  const analysis=preAnalysis||await analyzePaymentReceipt(media.base64,media.mime,media.fileName||"");
  const paymentIntent=!!payment||/\b(comprovante|pix|pagamento|paguei|pago)\b/.test(t);

  if(!analysis){
    if(paymentIntent){
      await queueOut(wid,conv.id,contact.id,phone,"Recebi o comprovante, mas não consegui ler com segurança. Envie novamente como foto nítida ou PDF completo mostrando valor, recebedor e identificação da transação.","bot");
      return {handled:true,status:"unreadable"};
    }
    return null;
  }
  if(analysis?.error==="media_too_large"){
    if(paymentIntent){
      await queueOut(wid,conv.id,contact.id,phone,"Recebi o arquivo, mas ele está grande demais para a conferência automática. Envie uma captura nítida ou um PDF menor do comprovante.","bot");
      return {handled:true,status:"too_large"};
    }
    return null;
  }
  if(analysis?.is_payment_receipt!==true){
    if(paymentIntent){
      await queueOut(wid,conv.id,contact.id,phone,"O arquivo não foi identificado com segurança como comprovante PIX. Envie novamente mostrando valor, pagador, recebedor e identificação da transação.","bot");
      return {handled:true,status:"not_receipt"};
    }
    return null;
  }

  const detected=Number(analysis?.amount);
  const expected=payment?Number(payment.amount):NaN;
  const amountOk=!!payment&&Number.isFinite(detected)&&Number.isFinite(expected)&&Math.abs(detected-expected)<0.01;

  const receiver=String(analysis?.receiver_name||"").trim();
  const receiverKey=String(analysis?.receiver_key||"").trim();
  const expectedHolder=String(pixSettings?.pix_holder||"").trim();
  const expectedKey=String(pixSettings?.pix_key||"").trim();
  const receiverOk=
    (!!expectedHolder&&!!receiver&&norm(receiver).includes(norm(expectedHolder))) ||
    (!!expectedKey&&!!receiverKey&&receiverKey.replace(/\s+/g,"")===expectedKey.replace(/\s+/g,"")) ||
    (!expectedHolder&&!expectedKey);

  const suspicious=analysis?.suspicious===true||Number(analysis?.risk_score||0)>=70;
  const receiptStatus=!payment
    ?"parsed_no_pending_charge"
    :(!amountOk||!receiverOk||suspicious?"mismatch_or_risk":"matches_waiting_bank");

  const ref=String(analysis?.end_to_end_id||analysis?.transaction_id||analysis?.txid||"").trim()||null;
  const existing=externalId
    ? await db.from("wa_payment_receipts").select("id").eq("workspace_id",wid).eq("external_message_id",externalId).maybeSingle()
    : {data:null};

  let receiptId=existing.data?.id||null;
  if(!receiptId){
    const ins=await db.from("wa_payment_receipts").insert({
      workspace_id:wid,contact_id:contact.id,conversation_id:conv.id,
      payment_id:payment?.id||null,external_message_id:externalId,
      expected_amount:payment?.amount??null,
      detected_amount:Number.isFinite(detected)?detected:null,
      detected_payer_name:String(analysis?.payer_name||"").trim()||null,
      detected_receiver_name:receiver||null,
      detected_receiver_key:receiverKey||null,
      detected_reference:ref,
      detected_paid_at:analysis?.paid_at_iso||analysis?.payment_date||null,
      media_metadata:{mime:media.mime||null,file_name:media.fileName||null,kind:media.kind},
      analysis,
      risk_score:Number.isFinite(Number(analysis?.risk_score))?Number(analysis.risk_score):null,
      vision_verdict:receiptStatus,
      bank_match:false,
      status:receiptStatus,
      updated_at:new Date().toISOString()
    }).select("id").single();
    receiptId=ins.data?.id||null;
  }

  if(payment){
    await db.from("wa_payments").update({
      metadata:{
        ...(payment.metadata||{}),
        last_receipt_id:receiptId,
        receipt_status:receiptStatus,
        receipt_reference:ref,
        receipt_detected_amount:Number.isFinite(detected)?detected:null
      },
      updated_at:new Date().toISOString()
    }).eq("id",payment.id);
  }

  if(!payment){
    await queueOut(wid,conv.id,contact.id,phone,"Recebi e li o comprovante, mas não encontrei uma cobrança pendente vinculada a esta conversa. O pagamento ficou registrado e nada será liberado até a cobrança correta ser localizada.","bot");
    return {handled:true,status:receiptStatus};
  }
  if(!amountOk){
    await queueOut(wid,conv.id,contact.id,phone,"Recebi o comprovante. O valor identificado foi "+(Number.isFinite(detected)?moneyBR(detected):"ilegível")+", mas a cobrança pendente é de "+moneyBR(expected)+". Não vou liberar o acesso até o valor correto ser confirmado.","bot");
    return {handled:true,status:receiptStatus};
  }
  if(!receiverOk){
    await queueOut(wid,conv.id,contact.id,phone,"O valor bate, mas o recebedor/chave PIX não confere com a configuração da cobrança. O acesso continuará aguardando confirmação real do banco.","bot");
    return {handled:true,status:receiptStatus};
  }
  if(suspicious){
    await queueOut(wid,conv.id,contact.id,phone,"Recebi o comprovante, mas ele precisa da confirmação do banco antes da liberação. Assim que a transação aparecer confirmada, o sistema libera automaticamente.","bot");
    return {handled:true,status:receiptStatus};
  }

  await queueOut(wid,conv.id,contact.id,phone,"Comprovante recebido e lido corretamente. Agora estou aguardando a confirmação real do PIX no banco. Assim que confirmar, o sistema libera ou renova o acesso automaticamente.","bot");
  return {handled:true,status:receiptStatus};
}

function learningTokens(text:string){
  const stop=new Set(["a","o","as","os","de","do","da","dos","das","e","em","um","uma","pra","para","por","com","que","vc","voce","você","me","te","se","ta","esta","está","ai","aí"]);
  return norm(text).split(/\s+/).map(x=>x.replace(/[^a-z0-9à-ÿ]/g,"")).filter(x=>x.length>=3&&!stop.has(x));
}

function learningScore(query:string,example:string){
  const a=new Set(learningTokens(query)), b=new Set(learningTokens(example));
  if(!a.size||!b.size)return 0;
  let hit=0;
  for(const x of a)if(b.has(x))hit++;
  return hit/Math.max(2,Math.min(a.size,b.size));
}

async function saveHumanSupportLearning(workspaceId:string,contactId:string,conversationId:string,humanReply:string){
  const reply=String(humanReply||"").trim();
  if(reply.length<4)return null;
  const nr=norm(reply);
  if(/^(oi|ola|olá|opa|sim|nao|não|ok|blz|beleza|valeu|obrigado|obrigada|show|certo|entendi)$/.test(nr))return null;

  const {data:lastIn}=await db.from("wa_messages")
    .select("content,created_at,message_type")
    .eq("conversation_id",conversationId)
    .eq("direction","in")
    .order("created_at",{ascending:false})
    .limit(10);

  const customer=(lastIn||[]).find((m:any)=>{
    const s=String(m?.content||"").trim();
    return s.length>=4 && !/^(Áudio recebido|Mídia recebida|Imagem recebida|Arquivo recebido)$/i.test(s);
  });
  if(!customer)return null;

  const customerMessage=String(customer.content||"").trim();
  const since=new Date(Date.now()-10*60*1000).toISOString();
  const {data:dup}=await db.from("wa_support_learnings")
    .select("id")
    .eq("workspace_id",workspaceId)
    .eq("conversation_id",conversationId)
    .eq("customer_message",customerMessage)
    .eq("human_reply",reply)
    .gte("created_at",since)
    .limit(1).maybeSingle();
  if(dup?.id)return dup.id;

  const topic=learningTokens(customerMessage).slice(0,8).join(" ");
  const {data:ins,error}=await db.from("wa_support_learnings").insert({
    workspace_id:workspaceId,
    contact_id:contactId,
    conversation_id:conversationId,
    customer_message:customerMessage,
    human_reply:reply,
    normalized_topic:topic,
    source:"whatsapp_native_human",
    updated_at:new Date().toISOString()
  }).select("id").single();
  if(error){
    console.error("support learning insert",error.message);
    return null;
  }
  return ins?.id||null;
}

async function aiFallback(workspaceId:string,conversationId:string,contactId:string,customerText:string,context:any={}){
  const {data:settings}=await db.from("wa_settings").select("company_name,virtual_agent_name,ai_enabled,ai_model,ai_instructions,fallback_message,business_description,products_and_services,sales_objective,service_area,conversation_tone,qualification_questions,handoff_rules,bot_disclosure,universal_mode,web_research_enabled,media_understanding_enabled,conversation_engine,humanized_mode,humanized_split_messages,humanized_emojis,humanized_abbreviations,humanized_typing_min_ms,humanized_typing_max_ms").eq("workspace_id",workspaceId).maybeSingle();
  const key=Deno.env.get("GEMINI_API_KEY");
  if(!key || !settings?.ai_enabled)return null;

  const [{data:knowledge},{data:history},{data:contactStyle},{data:supportLearnings}]=await Promise.all([
    db.from("wa_knowledge").select("title,keywords,content").eq("workspace_id",workspaceId).eq("enabled",true).limit(25),
    db.from("wa_messages").select("direction,sender_type,content,created_at").eq("conversation_id",conversationId).order("created_at",{ascending:false}).limit(16),
    db.from("wa_messages").select("content,created_at").eq("workspace_id",workspaceId).eq("contact_id",contactId).eq("direction","out").eq("sender_type","human").order("created_at",{ascending:false}).limit(20),
    db.from("wa_support_learnings").select("id,customer_message,human_reply,success_count,use_count,created_at")
      .eq("workspace_id",workspaceId).eq("enabled",true).order("updated_at",{ascending:false}).limit(100)
  ]);

  const normalized=norm(customerText);
  const learnedExamples=(supportLearnings||[])
    .map((x:any)=>({...x,score:learningScore(customerText,String(x.customer_message||""))}))
    .filter((x:any)=>x.score>=0.25)
    .sort((a:any,b:any)=>(b.success_count-a.success_count)||(b.score-a.score))
    .slice(0,4);
  const learnedBlock=learnedExamples.map((x:any,i:number)=>
    (i+1)+". Cliente: "+String(x.customer_message||"").slice(0,500)+"\n   Julio respondeu: "+String(x.human_reply||"").slice(0,700)+(Number(x.success_count||0)>0?"\n   Resultado confirmado como útil pelo cliente: "+x.success_count+" vez(es).":"")
  ).join("\n");
  const wantsVideo=/\b(video|vídeo|youtube|tutorial|passo a passo|tem video|manda video|me manda um video|como configura em video)\b/.test(normalized);
  const asksSource=/\b(fonte|onde voce viu|onde vc viu|de onde tirou|link da fonte)\b/.test(normalized);
  const allKnowledge=knowledge||[];
  const relevant=allKnowledge.filter((k:any)=>
    (k.keywords||[]).some((kw:string)=>normalized.includes(norm(kw)) || norm(kw).includes(normalized))
  );
  const base=(relevant.length?relevant.slice(0,8):allKnowledge.slice(0,5))
    .map((k:any)=>"### "+k.title+"\n"+String(k.content||"").slice(0,1400))
    .join("\n\n");

  const hist=(history||[]).slice().reverse().map((m:any)=>{
    const who=m.direction==="in"?"Cliente":(m.sender_type==="human"?"Atendente humano":(settings?.company_name||"Empresa"));
    return who+": "+String(m.content||"").slice(0,650);
  }).join("\n");

  let styleRows=(contactStyle||[]).filter((x:any)=>String(x?.content||"").trim());
  if(!styleRows.length){
    const {data:globalStyle}=await db.from("wa_messages")
      .select("content,created_at")
      .eq("workspace_id",workspaceId)
      .eq("direction","out")
      .eq("sender_type","human")
      .order("created_at",{ascending:false})
      .limit(10);
    styleRows=globalStyle||[];
  }
  const styleExamples=styleRows.slice(0,4).map((x:any,i:number)=>{
    let s=String(x.content||"").trim().replace(/https?:\/\/\S+/gi,"[link]");
    if(s.length>420)s=s.slice(0,420)+"…";
    return (i+1)+". "+s;
  }).join("\n");

  const configuredCompany=String(settings?.company_name||"").trim();
  const configuredAgent=String(settings?.virtual_agent_name||"").trim();
  const configuredBusiness=String(settings?.business_description||"").trim();
  const configuredProducts=String(settings?.products_and_services||"").trim();
  const tenantConfigured=!!(configuredBusiness||configuredProducts);
  const aiHourText=new Intl.DateTimeFormat("pt-BR",{
    timeZone:"America/Sao_Paulo",
    hour:"2-digit",
    hourCycle:"h23"
  }).format(new Date());
  const aiHour=Number(aiHourText);
  const aiGreeting=aiHour>=5&&aiHour<12?"Bom dia":aiHour>=12&&aiHour<18?"Boa tarde":"Boa noite";
  const aiNightShift=aiHour>=23||aiHour<7;
  const aiFirstMessage=context?.first_message===true||(!context?.initial_greeting_sent&&Number(context?.turn||0)===0);

  const instructions=[
    settings?.ai_instructions||"",
    "DADOS OPERACIONAIS VERIFICADOS: NUNCA invente usuário, senha, DNS, URL M3U, código, validade, teste criado, pagamento confirmado ou aplicativos parceiros. Esses dados só podem ser informados quando vierem de resultado real do painel, banco ou automação desta conta. Se ainda não houver resultado real, diga que vai consultar/executar a automação correspondente.",
    aiFirstMessage
      ?"PRIMEIRA MENSAGEM DESTA CONVERSA: comece naturalmente com '"+aiGreeting+"'. "+(configuredAgent?"Apresente-se brevemente como "+configuredAgent+", da equipe. ":"")+"Pergunte de forma natural como pode chamar o cliente. Se ele já trouxe uma dúvida ou problema na mesma mensagem, responda também ao assunto dele; não faça o cliente repetir."
      :"CONVERSA JÁ INICIADA: não repita saudação, apresentação nem pergunte o nome novamente se ele já foi informado.",
    aiNightShift
      ?"PLANTÃO NOTURNO: agora é madrugada (23h–07h). Use um tom mais calmo, direto e prestativo, sem animação exagerada."
      :"HORÁRIO NORMAL: mantenha um tom natural e prestativo.",
    configuredCompany
      ?"REGRA DE MARCA PRIORITÁRIA: esta conversa pertence à empresa '"+configuredCompany+"'. Use esse nome com o cliente quando fizer sentido. Não misture marcas entre revendas, sub-revendas ou conta principal."
      :"REGRA DE MARCA PRIORITÁRIA: esta conta ainda não configurou nome comercial. Não invente empresa, marca ou nome.",
    configuredCompany
      ?"Empresa atendida nesta conta: "+configuredCompany+"."
      :"Empresa ainda não configurada nesta conta. Atenda de forma geral sem citar JSTech, W3BR ou qualquer outra marca.",
    configuredCompany
      ?"Você está respondendo uma conversa de WhatsApp como atendimento comercial/secretaria de "+configuredCompany+", natural e direto."
      :"Você está respondendo uma conversa de WhatsApp como uma secretária/atendente geral desta conta, natural e direta.",
    configuredBusiness?"SOBRE ESTA EMPRESA: "+configuredBusiness:"",
    configuredProducts?"O QUE ESTA EMPRESA VENDE OU FAZ: "+configuredProducts:"",
    settings?.sales_objective?"OBJETIVO COMERCIAL DESTA CONTA: "+settings.sales_objective:"",
    settings?.service_area?"ÁREA DE ATENDIMENTO DESTA CONTA: "+settings.service_area:"",
    "TOM CONFIGURADO DESTA CONTA: "+(settings?.conversation_tone||"natural, direto e prestativo")+".",
    Array.isArray(settings?.qualification_questions)&&settings.qualification_questions.length?"PERGUNTAS DE QUALIFICAÇÃO DESTA CONTA (use uma por vez e somente quando necessária): "+settings.qualification_questions.join(" | "):"",
    Array.isArray(settings?.handoff_rules)&&settings.handoff_rules.length?"REGRAS DE TRANSFERÊNCIA DESTA CONTA: "+settings.handoff_rules.join(" | "):"",
    tenantConfigured
      ?"MODO UNIVERSAL MULTIEMPRESA: use somente o ramo, produtos e serviços configurados nesta conta. Não use dados de outra revenda, sub-revenda ou da conta principal."
      :"MODO GERAL AINDA NÃO CONFIGURADO: não suponha que esta empresa venda IPTV, CS, antenas, roupas, comida, peças ou qualquer outro item. Use somente o que o cliente explicar nesta conversa. Se precisar saber o assunto para continuar, faça UMA pergunta curta e natural sobre o que ele precisa.",
    "Se um fornecedor procurar a empresa, converse com ele, entenda catálogo, preços, pedido mínimo, pagamento, entrega, nota e garantia. Organize a proposta e só transfira quando chegar a decisão de compra ou pagamento.",
    "ESTILO HUMANO OBRIGATÓRIO: escreva como uma atendente experiente conversando no WhatsApp. Use frases curtas e naturais, reconheça o que a pessoa acabou de dizer, responda primeiro e faça no máximo UMA pergunta útil por mensagem. Não despeje cadastro, não dê sermão, não use linguagem de sistema, não diga 'selecione uma opção', 'informe os dados solicitados', 'continue do ponto certo' ou 'me diga com suas palavras'. Não repita saudação nem apresentação no meio da conversa. Menus só quando o cliente pedir lista ou quando realmente houver várias escolhas.",
    settings?.humanized_mode!==false?"HUMANIZAÇÃO ATIVA: responda como conversa de WhatsApp, com ritmo natural, sem textos longos. Prefira 1 a 4 frases e deixe o sistema dividir respostas maiores em partes curtas.":"",
    settings?.humanized_abbreviations!==false?"ABREVIAÇÕES NATURAIS: pode usar de vez em quando abreviações comuns como vc, pq, tbm e né quando combinarem com o jeito da conversa. Não exagere e não force gírias.":"",
    settings?.humanized_emojis!==false?"EMOJIS MODERADOS: pode usar 0, 1 ou no máximo 2 emojis simples quando fizer sentido. Não use emoji em toda mensagem e não transforme a resposta em enfeite.":"Não use emojis.",
    "ERROS DO CLIENTE: entenda abreviações, frases incompletas e erros como 'kero test', 'nao abre', 'ta travano' sem corrigir o português da pessoa. Responda ao significado do que ela quis dizer.",
    "NÃO SIMULE ERROS PROPOSITAIS de digitação. A naturalidade deve vir do ritmo, das frases curtas, do vocabulário e da continuidade da conversa.",
    configuredAgent
      ?"Seu nome como atendente/secretária desta conta é "+configuredAgent+". Quando precisar se apresentar, use esse nome. Não invente outro nome."
      :"Esta conta ainda não definiu nome para a atendente. Não use Ana, Carla ou qualquer nome inventado. Converse normalmente sem se apresentar pelo nome até o dono configurar um.",
    "Você é o atendente principal desta conversa, não um classificador e não um menu. Entenda a intenção mesmo com abreviações, falta de acento, palavras trocadas, erros de digitação e frases incompletas.",
    "RACIOCINE antes de responder como um atendente experiente: identifique a intenção real, separe assunto novo de continuação, confira o histórico e escolha a ação útil. Não responda apenas por palavra-chave.",

    "Antes de responder, reconstrua mentalmente: o que o cliente quer agora, o que ele já informou, qual foi a última pergunta pendente e qual é o próximo passo útil. Responda com base nisso.",
    "A MENSAGEM ATUAL tem prioridade sobre qualquer dado antigo salvo. Só use aplicativo, aparelho ou problema do histórico quando o cliente indicar continuação com palavras como 'ainda', 'continua', 'esse', 'isso', 'o mesmo' ou responder diretamente à pergunta anterior. Se ele trouxer outro pedido, mude de assunto imediatamente.",

    "Se a mensagem permitir duas interpretações, escolha a mais provável pelo histórico. Se ainda houver dúvida real, faça UMA pergunta objetiva oferecendo as duas possibilidades. Nunca responda com 'me diga com suas palavras', 'não entendi' ou outra frase genérica.",
    "Se o cliente relatar defeito ou erro, reconheça o problema, use o aparelho/aplicativo já citado e peça foto ou vídeo da tela somente quando isso ajudar o diagnóstico. Quando receber a mídia, analise-a e continue do mesmo ponto.",
    "Se o cliente disser que não sabe, não consegue ou não pode fazer algo que você pediu, NÃO repita o mesmo pedido. Explique como fazer em passos curtos e ofereça uma alternativa que não dependa daquela ação.",
    "Se o cliente pedir lista, foto, vídeo, preço, contato, configuração ou instrução, entregue exatamente esse pedido quando os dados estiverem disponíveis; não mude para outro assunto.",
    "Ao iniciar uma conversa, acompanhe a saudação do cliente: bom dia, boa tarde ou boa noite. Se ele já trouxe um problema na mesma mensagem, cumprimente brevemente e já trate o problema.",
    "Não repita 'como posso ajudar' se a pessoa já fez uma pergunta. Não reinicie a conversa. Continue do ponto em que ela está.",
    "Responda somente com a mensagem final que será enviada ao cliente. Nunca escreva cabeçalhos como 'Ana, disse:', 'Atendente respondeu:', 'Resposta ao cliente:' ou semelhantes.",
    "Se o cliente já informou aparelho, aplicativo ou defeito, reconheça esse dado e siga o diagnóstico. Nunca volte ao menu inicial nem peça novamente uma informação que já esteja no histórico.",
    "Em suporte técnico, não transforme a resposta em menu numerado. Faça no máximo uma pergunta específica por vez e preserve o contexto do problema.",
    "Evite respostas robóticas como 'me explique um pouco mais' quando der para fazer uma pergunta específica.",
    "Se o cliente perguntar como configurar um receptor sem dizer o modelo, responda de forma natural pedindo o modelo exato. Exemplo de tom: 'Dá sim. Qual é o modelo do seu Azamerica? S1005, S1006, S1007, S1009, Champions... O menu muda de um para outro. Me fala o modelo que eu te guio certinho.'",
    "Quando souber a resposta pela base, responda diretamente.",
    "Você tem pesquisa na web disponível. Use-a quando a resposta não estiver na base, quando a informação puder ter mudado ou quando precisar confirmar modelo, firmware, compatibilidade, instalação, aplicativo, painel, procedimento técnico ou localização geográfica.",
    "Para perguntas de localização, geografia e distância, trate como válidos cidade, município, distrito, patrimônio, bairro, comunidade, localidade rural, estado, país e CEP. Entenda erros de digitação. Se for um lugar pequeno, pesquise junto com o município e o estado informados. Nunca diga que não encontrou um lugar antes de tentar confirmar pela pesquisa pública. Quando confirmar, responda de forma simples dizendo onde fica e, se o cliente perguntar, a qual município/estado pertence ou a distância aproximada de Boa Esperança-ES.",
    "Se o cliente fizer uma pergunta clara e a resposta não estiver na base, pesquise na web antes de pedir que ele explique melhor. Só faça pergunta adicional quando faltar um dado realmente necessário para chegar à resposta correta.",
    "Na pesquisa, priorize site oficial do fabricante/serviço, documentação oficial e fontes confiáveis. Pode consultar páginas públicas e indexadas do YouTube, Telegram, Facebook, Instagram e outros sites quando forem úteis, mas nunca trate postagem de rede social como fonte principal se houver documentação oficial.",
    "Pesquise somente conteúdo público. Pode usar busca web ampla para encontrar resultados equivalentes aos que o cliente encontraria em mecanismos de busca, além de páginas públicas do YouTube e Telegram. Não tente acessar conta privada, grupo fechado, login, mensagem privada ou dado pessoal.",
    "Para preços internos já definidos da empresa desta conta — PIX, produtos, serviços e regras comerciais — a BASE DE CONHECIMENTO desta conta é a fonte de verdade e a web não pode substituir esses dados.",
    "A web não sabe o estoque interno da empresa desta conta. Se o cliente perguntar se há um produto para venda e isso não estiver cadastrado na base, não invente disponibilidade. Entenda o produto e use a web apenas para pesquisar referência de preço ou especificação quando fizer sentido.",
    "Para qualquer orçamento, use primeiro os produtos, serviços, preços, região e regras cadastrados NESTA conta. Se não houver preço cadastrado, não invente e não use o ramo de outra empresa. Entenda a necessidade, reúna os dados essenciais e deixe a proposta organizada para o responsável confirmar.",
    "Se encontrar versões conflitantes na web, diga que há divergência e dê preferência à fonte oficial ou mais recente. Nunca invente resposta para parecer certo.",
    "Quando usar a web, pesquise silenciosamente e use o resultado somente para formular uma resposta correta. Não diga ao cliente onde pesquisou, não mostre links, fontes, nomes de sites ou referências, a menos que o próprio cliente peça explicitamente a fonte.",
    wantsVideo ? "O cliente pediu vídeo/tutorial. Pesquise um vídeo que corresponda ao modelo exato do aparelho citado. Priorize o canal oficial da marca no YouTube; se não houver, use um tutorial público confiável que mostre exatamente o procedimento pedido. Envie no máximo UM link direto do vídeo do YouTube, com uma frase curta explicando que é o vídeo correspondente. Se o modelo exato não estiver claro, NÃO mande vídeo genérico: pergunte primeiro o modelo exato." : "",
    asksSource ? "O cliente pediu a fonte. Nesse caso, você pode informar a fonte e o link direto correspondente." : "",
    "Preços, PIX e listas devem permanecer exatamente como estão na base. Nunca altere números.",
    "Se a pessoa escrever com erros de português, entenda normalmente e não a corrija.",
    "Use o histórico desta conversa como memória do cliente: lembre o assunto, o aparelho, o serviço, a cidade, as dúvidas e o que já foi respondido para não perguntar tudo de novo.",
    "O atendimento precisa soar humano e natural. Evite respostas com cara de robô, menus desnecessários, frases repetidas e textos engessados. Fale como uma pessoa real do atendimento de "+(settings?.company_name||"esta empresa")+": direto, educado, acolhedor e simples.",
    "Varie a forma de responder. Use expressões naturais como 'beleza', 'claro', 'perfeito', 'entendi', 'show', 'fica tranquilo', 'te explico certinho', mas sem exagerar e sem usar sempre a mesma expressão.",
    "Quando houver cálculo, entregue primeiro a resposta final em linguagem normal e depois, se ajudar, explique a conta de forma simples. Não transforme toda resposta em fórmula matemática.",
    "Em orçamento, não interrompa uma pergunta clara apenas para pedir o nome. Responda primeiro o que já puder e peça somente o dado indispensável que falta. Use nome, produto, quantidade, medida, prazo, cidade ou modelo apenas quando forem realmente necessários para montar a proposta.",
    "Aprenda o jeito do Julio atender este cliente pelas mensagens humanas anteriores. Imite apenas o tom, o tamanho das respostas, o grau de informalidade e o jeito de perguntar. Nunca copie como fatos preços, senhas, usuários, links, credenciais ou dados de outra conversa.",
    styleExamples?"EXEMPLOS DE COMO JULIO COSTUMA RESPONDER (use somente o estilo):\n"+styleExamples:"Ainda não há exemplos humanos suficientes para este cliente; mantenha um tom natural, direto e simples.",
    learnedBlock?"APRENDIZADO REAL DOS ATENDIMENTOS DO JULIO:\n"+learnedBlock+"\n\nUse estes pares problema/resposta como experiência acumulada. Se o problema atual for semelhante, aproveite a solução que Julio usou e adapte ao contexto. Dê mais peso aos exemplos com resultado confirmado. Não trate um exemplo antigo como verdade universal quando aparelho, aplicativo ou situação forem diferentes.":"Ainda não há aprendizados de suporte semelhantes salvos.",
    base?"BASE DE CONHECIMENTO:\n"+base:"BASE DE CONHECIMENTO: vazia."
  ].join("\n\n");

  const input="MENSAGEM ATUAL DO CLIENTE — ESTA É A PRIORIDADE ABSOLUTA:\n"+customerText+"\n\nHISTÓRICO RECENTE — USE APENAS PARA CONTINUAR O ASSUNTO QUANDO A MENSAGEM ATUAL REALMENTE SE REFERIR A ELE:\n"+hist;

  let geminiRateLimited=false;
  async function callGemini(useWeb:boolean, extraInstruction=""){
    const configured=String(settings?.ai_model||Deno.env.get("GEMINI_MODEL")||"").trim();
    const model=/^gemini-/i.test(configured)?configured:"gemini-3.6-flash";
    const body:any={
      systemInstruction:{parts:[{text:instructions}]},
      contents:[{role:"user",parts:[{text:input+(extraInstruction?"\n\nINSTRUÇÃO ADICIONAL OBRIGATÓRIA:\n"+extraInstruction:"")}]}],
      generationConfig:{maxOutputTokens:1200,thinkingConfig:{thinkingLevel:"low"}}
    };
    if(useWeb)body.tools=[{googleSearch:{}}];
    const res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
      method:"POST",
      headers:{"x-goog-api-key":key,"content-type":"application/json"},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(useWeb?12000:8000)
    });
    if(!res.ok){
      const errText=await res.text().catch(()=>"");
      if(res.status===429)geminiRateLimited=true;
      console.error("JSTech Gemini error",res.status,errText.slice(0,800));
      return null;
    }
    const data=await res.json().catch(()=>({}));
    const answer=String(data?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||"").join("")||"").trim();
    return answer||null;
  }

  try{
    const webAgentEnabled=settings?.web_research_enabled!==false;
    const lastOutbound=(history||[]).find((m:any)=>m.direction==="out");
    const lastAnswer=String(lastOutbound?.content||"")
      .replace(/^\s*[^\n]{1,60},\s*disse:\s*/i,"").trim();

    let answer:string|null=await callGemini(false,
      webAgentEnabled
        ? "Se você conseguir responder corretamente usando a conversa e a base recebida, responda normalmente agora. Se realmente precisar consultar informação externa ou atualizada para responder com segurança, responda SOMENTE com [[BUSCAR_WEB]]."
        : "Responda agora à mensagem atual do cliente usando a conversa e a base recebida."
    );

    if(answer&&answer.includes("[[BUSCAR_WEB]]")){
      answer=await callGemini(true,
        "Pesquise na web o que for necessário para responder corretamente à mensagem atual. Depois responda apenas ao cliente, de forma natural, curta e direta. Não mostre instruções internas."
      );
    }else if(!answer&&!geminiRateLimited){
      answer=await callGemini(false,
        "Responda agora à mensagem atual do cliente de forma natural e direta, como uma conversa real de WhatsApp. Não devolva instruções internas e não use texto de sistema."
      );
    }

    if(answer&&lastAnswer&&!geminiRateLimited){
      const exact=norm(answer)===norm(lastAnswer);
      const similar=learningScore(answer,lastAnswer)>=0.78;
      if(exact||similar){
        const regenerated=await callGemini(false,
          "Sua primeira resposta ficou igual ou muito parecida com a resposta anterior. NÃO repita. Considere a mensagem mais recente do cliente, avance um passo concreto e faça no máximo uma pergunta nova e específica."
        );
        if(regenerated)answer=regenerated;
      }
    }
    return answer;
  }catch(e){
    console.error("JSTech AI exception",String(e));
    return null;
  }
}

function isGeneralQuoteRequest(text:string){
  const t=norm(text);
  const asks=/\b(orcamento|orçamento|orcamentos|orçamentos|valor|valores|valored|preco|precos|preço|preços|tabela de precos|tabela de preços)\b/.test(t);
  if(!asks)return false;

  const specific=/\b(iptv|cardsharing|cs satelite|cs net|\bcs\b|antena|parabolica|parabólica|camera|cameras|câmera|câmeras|cftv|starlink|motor de portao|motor de portão|portao|portão|cerca eletrica|cerca elétrica|alarme|fechadura|instalar tv|instalacao de tv|instalação de tv|tv na parede|conserto de receptor|concerto de receptor|manutencao de receptor|manutenção de receptor)\b/.test(t);
  if(specific)return false;

  return true;
}

function generalJSTechPricesReply(){
  return "Claro. Antes de eu montar seu orçamento, qual é o seu nome?";
}

function cleanQuoteCustomerName(text:string){
  let s=String(text||"").trim();
  s=s.replace(/^(meu nome (?:e|é)|me chamo|sou o|sou a|sou|pode me chamar de)\s+/i,"").trim();
  s=s.replace(/[^A-Za-zÀ-ÿ' -]/g," ").replace(/\s+/g," ").trim();
  if(s.length<2||s.length>60)return "";
  const words=s.split(" ").filter(Boolean);
  if(words.length>5)return "";
  const t=norm(s);
  if(/\b(iptv|cs|camera|câmera|starlink|antena|receptor|portao|portão|cerca|alarme|fechadura|tv|valor|preco|preço|orcamento|orçamento|servico|serviço|imagem recebida|audio recebido|áudio recebido|conteudo da imagem|conteúdo da imagem)\b/.test(t))return "";
  return words.map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
}

function quoteWithName(name:string,reply:string){
  const n=String(name||"").trim();
  const r=String(reply||"").trim();
  if(!n||!r)return r;
  return n+", "+r.charAt(0).toLowerCase()+r.slice(1);
}

function quoteServiceFromText(text:string){
  const t=norm(text);
  if(/\biptv\b/.test(t) && !/\b(painel|revenda|revendedor)\b/.test(t))
    return "IPTV para cliente final: mensal R$ 35, trimestral R$ 55, semestral R$ 100 e anual R$ 150. Me diga qual período você quer que eu já fecho o valor certinho.";
  if(/\b(cs|cardsharing|cs satelite|cs net)\b/.test(t) && !/\bpainel\b/.test(t))
    return "CS: mensal R$ 10, trimestral R$ 40, semestral R$ 60 e anual R$ 100. Me diga qual período você quer.";
  if(/\bantena|parabolica|parabólica\b/.test(t))
    return "Antena para receptor: R$ 180 só a antena. Já instalada, fica R$ 300.";
  if(/\bcftv|camera|cameras|câmera|câmeras\b/.test(t)){
    if(/\bchinesa|chinesas\b/.test(t))
      return "A câmera chinesa custa R$ 150 por unidade. A instalação custa R$ 150 por câmera e já inclui as conexões no DVR.";
    return "A instalação de câmera custa R$ 150 por câmera e já inclui as conexões no DVR. Me diga quantas câmeras para eu calcular o total exato.";
  }
  if(/\bstarlink\b/.test(t))
    return "A instalação da Starlink custa R$ 450. Suporte especial, estrutura extra ou passagem de cabo fora do padrão são cobrados à parte.";
  if(/\bportao|portão|motor de portao|motor de portão\b/.test(t))
    return "A instalação simples de motor de portão parte de R$ 600. O motor e os materiais são cobrados à parte.";
  if(/\bcerca eletrica|cerca elétrica\b/.test(t))
    return "A cerca elétrica custa R$ 80 por metro, com mínimo de R$ 700 de serviço. Me diga a metragem para eu calcular o total.";
  if(/\balarme\b/.test(t))
    return "A instalação básica de alarme residencial parte de R$ 300. O valor final depende da quantidade de sensores, central, sirene e recursos do sistema.";
  if(/\bfechadura\b/.test(t))
    return "A instalação de fechadura digital custa R$ 300 no modelo simples. Se precisar recorte ou adaptação da porta, pode chegar a R$ 400.";
  if(/\b(tv na parede|instalar tv|instalacao de tv|instalação de tv|suporte de tv|fixar tv|televisao|televisão|\btv\b)\b/.test(t))
    return "Instalação de TV na parede: R$ 180 até 55 polegadas e R$ 220 de 60 a 65 polegadas. Me diga o tamanho da TV para eu confirmar o valor.";
  if(/\b(receptor|receptores)\b/.test(t) && /\b(conserto|concerto|manutencao|manutenção|reparo|defeito|arrumar)\b/.test(t))
    return "Conserto de receptor é feito por orçamento porque depende do modelo e do defeito. Me diga o modelo e se ele não liga, está sem sinal, travando, sem imagem ou apresenta outro problema.";
  return "";
}

function isAntennaProductSaleQuestion(text:string){
  const t=norm(text);
  const antenna=/\b(antena|antenas|parabolica|parabolicas|parabólica|parabólicas)\b/.test(t);
  const sale=/\b(venda|vende|vender|comprar|compra|teria|tem para vender|produto|equipamento|kit)\b/.test(t);
  const asks=/\b(valor|valores|preco|precos|preço|preços|quanto|custa|fica)\b/.test(t);
  return antenna && (sale || (asks && /\b(antena|antenas)\b/.test(t) && !/\b(instalacao|instalação|instalar|mao de obra|mão de obra)\b/.test(t)));
}

function antennaProductSaleReply(name:string){
  const prefix=String(name||"").trim()?String(name).trim()+", ":"";
  return prefix+"a antena para receptor custa R$ 180. Se quiser já instalada, fica R$ 300.";
}

function isAntennaMaterialPriceQuestion(text:string){
  const t=norm(text);
  const material=/\b(fio|cabo|coaxial|rg6|rg 6|conector|conectores|conector f|plug|terminal)\b/.test(t);
  const asks=/\b(valor|valores|preco|precos|preço|preços|quanto|custa|fica|metro|unidade)\b/.test(t);
  return material&&asks;
}

function antennaMaterialMarketReply(text:string,name:string){
  const prefix=String(name||"").trim()?String(name).trim()+", ":"";
  const t=norm(text);
  const asksWire=/\b(fio|cabo|coaxial|rg6|rg 6|metro)\b/.test(t);
  const asksConnector=/\b(conector|conectores|conector f|plug|terminal)\b/.test(t);

  if(asksWire&&asksConnector)
    return prefix+"o fio coaxial fica R$ 2 por metro e o conector fica R$ 5 por unidade.";
  if(asksWire)
    return prefix+"o fio coaxial fica R$ 2 por metro.";
  if(asksConnector)
    return prefix+"o conector fica R$ 5 por unidade.";
  return prefix+"o fio coaxial fica R$ 2 por metro e o conector fica R$ 5 por unidade.";
}


function isReceiverRepairPriceQuestion(text:string){
  const t=norm(text);
  return /\b(receptor|receptores|aparelho|aparelhos)\b/.test(t)
    && /\b(conserto|concerto|manutencao|manutenção|reparo|arrumar|defeito)\b/.test(t)
    && /\b(valor|valores|preco|precos|preço|preços|quanto|custa|fica|orcamento|orçamento)\b/.test(t);
}

function isLocalServicePriceQuestion(text:string){
  const t=norm(text);
  const asksPrice=/\b(valor|valores|preco|precos|preço|preços|quanto|quanto custa|quanto fica|orcamento|orçamento|cobram|custa|fica|instalacao|instalação)\b/.test(t);
  const service=/\b(antena|parabolica|parabólica|receptor|receptores|conserto|concerto|manutencao|manutenção|reparo|cftv|camera|cameras|câmera|câmeras|starlink|portao|portão|motor de portao|motor de portão|fechadura|cerca eletrica|cerca elétrica|alarme|instalar tv|instalacao de tv|instalação de tv|tv na parede|suporte de tv)\b/.test(t);
  return asksPrice&&service;
}
function regionalPriceFallback(text:string){
  const t=norm(text);
  if(/\b(receptor|receptores)\b/.test(t) && /\b(conserto|concerto|manutencao|manutenção|reparo|defeito)\b/.test(t))
    return "Conserto de receptor não tem valor fixo cadastrado porque depende do modelo e do defeito. Para fazer uma cotação correta, me diga o modelo e o sintoma principal: não liga, sem sinal, travando, sem imagem ou outro defeito.";
  if(/\bantena|parabolica|parabólica\b/.test(t))
    return "Na JSTech, a antena para receptor custa R$ 180. Já instalada, fica R$ 300.";
  if(/\bcftv|camera|cameras|câmera|câmeras\b/.test(t))
    return "Na região, há referência de instalação de câmera/CFTV a partir de R$ 150 por serviço simples em São Mateus. Em Vitória, sistemas completos aparecem a partir de cerca de R$ 1.200, dependendo da quantidade de câmeras, DVR, cabeamento e acesso remoto. Para Boa Esperança, o melhor é trabalhar com uma faixa inicial e fechar o orçamento conforme a quantidade de pontos.";
  if(/\bportao|portão|motor de portao|motor de portão\b/.test(t))
    return "No Espírito Santo, encontrei instalação de portão eletrônico a partir de cerca de R$ 550, enquanto referências de mercado ficam normalmente entre R$ 600 e R$ 1.500 conforme peso do portão, motor, cremalheira e ajustes. Em Boa Esperança, eu trataria R$ 550 a R$ 800 como faixa de mão de obra simples, com equipamento e adaptações cobrados à parte.";
  if(/\bcerca eletrica|cerca elétrica\b/.test(t))
    return "No Espírito Santo, referências públicas ficam em torno de R$ 72 a R$ 95 por metro para cerca elétrica, com média próxima de R$ 80 por metro em Vitória; kits/instalações básicas também aparecem na faixa de R$ 700 a R$ 800. Em Boa Esperança, o orçamento deve considerar metragem, quantidade de hastes, central e altura do muro.";
  if(/\balarme\b/.test(t))
    return "No Espírito Santo, instalação de alarme residencial aparece a partir de cerca de R$ 300, e uma referência de Vitória fica perto de R$ 380 para sistema residencial com 4 sensores. Em Boa Esperança, o valor muda principalmente pela quantidade de sensores, sirene, central e necessidade de monitoramento.";
  if(/\bfechadura\b/.test(t))
    return "No Espírito Santo, a instalação de fechadura digital aparece em referências de aproximadamente R$ 150 a R$ 400; serviços credenciados nacionais ficam perto de R$ 300 a R$ 400 só de instalação. Em Boa Esperança, o preço final depende muito do tipo da porta e se vai precisar recorte ou adaptação.";
  if(/\bstarlink\b/.test(t))
    return "A própria Starlink permite autoinstalação, mas instalação profissional costuma ser cobrada à parte. Como referência de mercado, encontrei serviço profissional por cerca de R$ 500, podendo variar conforme telhado, suporte, passagem de cabo e altura. Para Boa Esperança, eu trabalharia orçamento por dificuldade do local, separando mão de obra do kit e da mensalidade.";
  if(/\binstalar tv|instalacao de tv|instalação de tv|tv na parede|suporte de tv\b/.test(t))
    return "Como referência de mercado, instalação de TV na parede aparece na faixa de aproximadamente R$ 160 a R$ 420, e serviços padronizados ficam perto de R$ 279. Em Boa Esperança, o valor deve variar pelo tamanho da TV, tipo de parede, suporte e necessidade de esconder cabos.";
  return "";
}
function fixedJSTechServiceQuote(text:string){
  const t=norm(text);
  if(/\bantena|parabolica|parabólica\b/.test(t) || (/\breceptor\b/.test(t) && /\b(instalacao|instalação|instalar|antena|parabolica|parabólica)\b/.test(t)))
    return "Antena para receptor: R$ 180 só a antena. Já instalada, fica R$ 300.";
  if(/\bcftv|camera|cameras|câmera|câmeras\b/.test(t)){
    if(/\bchinesa|chinesas\b/.test(t))
      return "A câmera chinesa fica em R$ 150 por unidade. A instalação é R$ 150 por câmera e já inclui as conexões no DVR. Exemplo: 2 câmeras = R$ 300 de instalação, além do valor dos equipamentos.";
    return "A instalação de câmera fica em R$ 150 por câmera e já inclui as conexões no DVR. Exemplo: 2 câmeras = R$ 300 de instalação. Se precisar de câmera chinesa, o equipamento fica em R$ 150 por unidade.";
  }
  if(/\bstarlink\b/.test(t))
    return "A instalação da Starlink pela JSTech fica em R$ 450. Esse valor é da instalação; suporte especial, estrutura extra ou passagem de cabo fora do padrão podem ser orçados à parte.";
  if(/\bportao|portão|motor de portao|motor de portão\b/.test(t))
    return "Para instalação de motor de portão, a cotação base da JSTech fica em R$ 600 na instalação simples, com o motor e materiais cobrados à parte. Se precisar de cremalheira, solda, reforço ou ajuste estrutural, eu faço o orçamento pelo local.";
  if(/\bcerca eletrica|cerca elétrica\b/.test(t))
    return "Para cerca elétrica, a cotação base fica em R$ 80 por metro, com valor mínimo de serviço de R$ 700. Central, hastes, isoladores e outros materiais entram conforme a metragem e o local.";
  if(/\balarme\b/.test(t))
    return "Para alarme residencial, a instalação básica fica a partir de R$ 300. O valor final depende da quantidade de sensores, sirene, central e se vai ter acesso por aplicativo ou monitoramento.";
  if(/\bfechadura\b/.test(t))
    return "Para fechadura digital, a instalação simples fica em R$ 300. Se for modelo de embutir ou precisar recortar e adaptar a porta, a instalação pode chegar a R$ 400.";
  if(/\binstalar tv|instalacao de tv|instalação de tv|tv na parede|suporte de tv|fixar tv\b/.test(t))
    return "Para instalar TV na parede, a cotação base é R$ 180 para TVs até 55 polegadas e R$ 220 de 60 a 65 polegadas. TV maior, drywall, painel especial ou passagem de cabos escondidos precisa de orçamento.";
  return "";
}

function wordNumber(v:string){
  const m:any={um:1,uma:1,dois:2,duas:2,tres:3,três:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};
  return m[norm(v)]||0;
}
function qtyBefore(text:string,units:string){
  const t=norm(text);
  const re=new RegExp("\\b(\\d+|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\\s*(?:"+units+")\\b","i");
  const m=t.match(re);
  if(!m)return 1;
  return /^\d+$/.test(m[1])?Math.max(1,Number(m[1])):Math.max(1,wordNumber(m[1]));
}
function requestedMonths(text:string){
  const t=norm(text);
  if(/\b(anual|12 meses|1 ano)\b/.test(t))return 12;
  if(/\b(semestral|6 meses)\b/.test(t))return 6;
  if(/\b(trimestral|3 meses)\b/.test(t))return 3;
  if(/\b(mensal|30 dias|1 mes|1 mês)\b/.test(t))return 1;
  const m=t.match(/\b(\d{1,2})\s*(?:mes|meses|mês|mêses)\b/);
  return m?Math.max(1,Number(m[1])):0;
}
function subscriptionQty(text:string){
  return qtyBefore(text,"assinatura|assinaturas|acesso|acessos|conta|contas|cliente|clientes|linha|linhas");
}
function exactBusinessCalculationReply(text:string){
  const t=norm(text);
  const asksMoney=/\b(valor|valores|preco|precos|quanto|custa|fica|total|calcula|calculo|orçamento|orcamento)\b/.test(t);
  const hasQty=/\b\d+\b/.test(t)||/\b(um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\b/.test(t);
  const hasPlan=/\b(mensal|trimestral|semestral|anual|mes|meses|ano|dias)\b/.test(t);
  if(!(asksMoney||hasQty||hasPlan))return "";

  if(/\bcftv|camera|cameras|câmera|câmeras\b/.test(t)){
    const q=qtyBefore(text,"camera|cameras|câmera|câmeras");
    const install=q*150;
    if(/\bchinesa|chinesas\b/.test(t)){
      const equip=q*150,total=install+equip;
      return "Claro Para "+q+" câmera"+(q>1?"s":"")+" chinesa"+(q>1?"s":"")+", fica assim: "+moneyBR(equip)+" nas câmeras + "+moneyBR(install)+" na instalação. Total: "+moneyBR(total)+". E a instalação já inclui as conexões no DVR.";
    }
    return "Fica tranquilo, eu já faço a conta pra você Para "+q+" câmera"+(q>1?"s":"")+", a instalação fica em "+moneyBR(install)+" no total. Já estão incluídas as conexões no DVR; as câmeras ficam à parte.";
  }

  if(/\bantena|parabolica|parabólica\b/.test(t)){
    const q=qtyBefore(text,"antena|antenas|parabolica|parabolicas|parabólica|parabólicas");
    const installed=/\b(instalada|instaladas|instalado|instalados|instalacao|instalação|instalar)\b/.test(t);
    const unit=installed?300:180;
    return "Para "+q+" antena"+(q>1?"s":"")+(installed?" instalada"+(q>1?"s":""):"")+", fica "+moneyBR(q*unit)+" no total.";
  }

  if(/\bstarlink\b/.test(t)){
    const q=qtyBefore(text,"starlink|starlinks|instalacao|instalacoes|instalação|instalações");
    return "Para "+q+" instalação"+(q>1?"ões":"")+" de Starlink, fica "+moneyBR(q*450)+" no total. Se precisar de suporte especial, estrutura extra ou passagem de cabo fora do padrão, eu te aviso antes de fechar.";
  }

  if(/\bportao|portão|motor de portao|motor de portão\b/.test(t)){
    const q=qtyBefore(text,"motor|motores|portao|portoes|portão|portões");
    return "Para "+q+" motor"+(q>1?"es":"")+" de portão, a instalação básica fica em "+moneyBR(q*600)+" no total. Motor, cremalheira, solda e outros materiais são separados, aí eu confirmo com você antes.";
  }

  if(/\bcerca eletrica|cerca elétrica\b/.test(t)){
    const m=t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:m|metro|metros)\b/);
    if(m){
      const metros=Number(m[1].replace(",","."));
      const calc=metros*80,total=Math.max(700,calc);
      return "Para "+metros.toLocaleString("pt-BR")+" metros de cerca elétrica, a mão de obra fica em "+moneyBR(total)+". O cálculo é R$ 80 por metro, com mínimo de R$ 700. Os materiais eu calculo certinho conforme o local.";
    }
    return "A cerca elétrica é calculada a R$ 80 por metro, com mínimo de R$ 700 de serviço. Me diga quantos metros para eu calcular o total exato.";
  }

  if(/\bfechadura\b/.test(t)){
    const q=qtyBefore(text,"fechadura|fechaduras");
    const adapt=/\bembutir|recorte|adaptacao|adaptação\b/.test(t);
    const unit=adapt?400:300;
    return "Para "+q+" fechadura"+(q>1?"s":"")+", a instalação fica em "+moneyBR(q*unit)+" no total"+(adapt?", já considerando recorte/adaptação.":". Se a porta for simples e não precisar adaptação, esse é o valor.");
  }

  if(/\balarme\b/.test(t)){
    const q=qtyBefore(text,"alarme|alarmes|sistema|sistemas");
    return "Para "+q+" sistema"+(q>1?"s":"")+" de alarme, a instalação começa em "+moneyBR(q*300)+". Se tiver sensor extra, central diferente, sirene ou acesso por aplicativo, eu monto o valor certinho pra você.";
  }

  if(/\b(tv na parede|instalar tv|instalacao de tv|instalação de tv|suporte de tv|fixar tv|televisao|televisão)\b/.test(t)){
    const q=qtyBefore(text,"tv|tvs|televisao|televisoes|televisão|televisões");
    const p=t.match(/\b(\d{2,3})\s*(?:pol|polegadas|\")\b/);
    const size=p?Number(p[1]):0;
    if(size>0&&size<=55)return "Para "+q+" TV"+(q>1?"s":"")+" de "+size+" polegadas, fica "+moneyBR(q*180)+" no total para instalar na parede.";
    if(size>=60&&size<=65)return "Para "+q+" TV"+(q>1?"s":"")+" de "+size+" polegadas, fica "+moneyBR(q*220)+" no total para instalar na parede.";
    if(size>65)return "Para TV acima de 65 polegadas eu preciso fazer orçamento pelo tamanho, tipo de parede, suporte e passagem de cabos.";
    return "Para calcular a instalação da TV, me diga o tamanho em polegadas. Até 55\" é R$ 180; de 60 a 65\" é R$ 220.";
  }

  if(/\biptv\b/.test(t) && !/\brevenda|revendedor|painel\b/.test(t)){
    const months=requestedMonths(text);
    const screens=parseRequestedScreens(text);
    if(screens&&screens>1)return "Para "+screens+" telas eu ainda não tenho uma tabela oficial cadastrada. Não vou multiplicar o valor de 1 tela e correr o risco de te passar preço errado.";
    const prices:any={1:35,3:55,6:100,12:150};
    const q=subscriptionQty(text);
    if(months){
      if(prices[months]===undefined)return "No IPTV eu tenho valores oficiais para mensal, trimestral, semestral e anual: R$ 35, R$ 55, R$ 100 e R$ 150. Para "+months+" meses não tenho tabela oficial cadastrada, então não vou inventar valor.";
      const unit=prices[months];
      return "No IPTV "+({1:"mensal",3:"trimestral",6:"semestral",12:"anual"} as any)[months]+", fica "+moneyBR(unit)+" por acesso"+(q>1?". Para "+q+" acessos, o total fica "+moneyBR(q*unit)+".":".");
    }
    if(asksMoney)return "IPTV para cliente final, 1 tela: mensal R$ 35, trimestral R$ 55, semestral R$ 100 e anual R$ 150. Me diga o período e, se forem vários acessos, a quantidade que eu calculo o total.";
  }

  if(/\b(cs|cardsharing|cs satelite|cs net)\b/.test(t)){
    const months=requestedMonths(text);
    const prices:any={1:10,3:40,6:60,12:100};
    const q=subscriptionQty(text);
    if(months){
      if(prices[months]===undefined)return "No CS eu tenho valores oficiais para mensal, trimestral, semestral e anual: R$ 10, R$ 40, R$ 60 e R$ 100. Para "+months+" meses não tenho tabela oficial cadastrada, então não vou inventar valor.";
      const unit=prices[months];
      return "No CS "+({1:"mensal",3:"trimestral",6:"semestral",12:"anual"} as any)[months]+", fica "+moneyBR(unit)+" por acesso"+(q>1?". Para "+q+" acessos, o total fica "+moneyBR(q*unit)+".":".");
    }
    if(asksMoney)return "CS: mensal R$ 10, trimestral R$ 40, semestral R$ 60 e anual R$ 100. Me diga o período e a quantidade de acessos que eu calculo o total.";
  }

  if(/\b(unitv|uni tv)\b/.test(t) && /\bcredito|creditos|crédito|créditos\b/.test(t)){
    const m=t.match(/\b(10|50|100)\s*(?:credito|creditos|crédito|créditos)\b/);
    if(m){
      const n=Number(m[1]),unit=n===10?12:n===50?10:8.5;
      return n+" créditos × "+moneyBR(unit)+" = "+moneyBR(n*unit)+" no total.";
    }
    return "UniTV: 10 créditos × R$ 12 = R$ 120; 50 × R$ 10 = R$ 500; 100 × R$ 8,50 = R$ 850.";
  }

  return "";
}

async function regionalServicePriceReply(text:string){
  const fixed=fixedJSTechServiceQuote(text);
  if(fixed)return fixed;
  const key=Deno.env.get("OPENAI_API_KEY");
  const fallback=regionalPriceFallback(text);
  if(!key)return fallback||null;
  try{
    const res=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"authorization":"Bearer "+key,"content-type":"application/json"},
      body:JSON.stringify({
        model:Deno.env.get("OPENAI_MODEL")||"gpt-5.6-luna",
        instructions:[
          "Você é o atendimento comercial da JSTech em Boa Esperança, Espírito Santo.",
          "O cliente perguntou preço/orçamento de um serviço técnico local. Responda direto, sem menu e sem enrolação.",
          "Pesquise preços públicos atuais. Priorize nesta ordem: Boa Esperança-ES, Nova Venécia-ES, São Mateus-ES, depois outras cidades do Espírito Santo. Se não houver preço local publicado, use referência estadual e deixe isso claro de forma curta.",
          "Faça um comparativo simples: menor referência encontrada, faixa de mercado e o que faz o preço variar.",
          "Não invente preço oficial da JSTech. Fale como referência de mercado e diga que o orçamento final depende do local quando necessário.",
          "Não mostre links nem nomes de sites, a menos que o cliente peça a fonte.",
          "Em respostas comuns use no máximo 6 frases curtas.",
          fallback ? "Se a busca falhar, use esta referência já levantada: "+fallback : ""
        ].filter(Boolean).join("\n"),
        input:text,
        tools:[{type:"web_search",search_context_size:"medium"}],
        tool_choice:"auto",
        include:["web_search_call.action.sources"],
        max_output_tokens:320
      })
    });
    if(!res.ok)return fallback||null;
    const data=await res.json().catch(()=>({}));
    return responseTextFromOpenAI(data,false)||fallback||null;
  }catch{
    return fallback||null;
  }
}

function intentNode(text:string){
  const t=norm(text);
  if(
    /\b(horario|horarios|que horas|hora de atendimento|horario de atendimento|funcionamento|ate que horas|até que horas|que hora abre|que hora fecha|voces trabalham|vocês trabalham|atendem que horas|ligaçao|ligacao|ligacoes|ligações|chamada|chamadas|telefone)\b/.test(t)
  ) return "business_hours";
  if(
    /\b(quais paineis|qual painel|paineis disponiveis|painel disponivel|lista de paineis|paineis para revenda|painel para revenda|quero ser revenda|quero ser revendedor|quero revender)\b/.test(t)
    && !/\b(preco|precos|preso|presos|valor|valores|quanto custa)\b/.test(t)
  ) return "reseller_panel_catalog";
  if(
    /\b(pix|chave pix|chave do pix|dados pix|dados para pagamento|forma de pagamento|pagamento via pix)\b/.test(t)
    || (/\b(renovar|renovacao)\b/.test(t) && /\b(chave|pix|pagar|pagamento)\b/.test(t))
  ) return "pix_payment";
  if(
    /\b(unitv|uni tv)\b/.test(t)
    && /\b(painel|revenda|revendedor|creditos|credito)\b/.test(t)
    && /\b(preco|precos|preso|presos|valor|valores|quanto custa|tabela)\b/.test(t)
  ) return "unitv_panel_prices";
  if(
    /\b(preco|precos|preso|presos|valor|valores|quanto custa|tabela)\b/.test(t)
    && /\b(10 creditos|50 creditos|100 creditos|creditos unitv|credito unitv)\b/.test(t)
  ) return "unitv_panel_prices";
  if(
    /\b(receptor|receptores|receptores|aparelho|aparelhos)\b/.test(t)
    && /\b(hd|canais hd|abre hd|abrem hd|abrindo hd|compativel|compativeis|compatível|compatíveis)\b/.test(t)
  ) return "cs_hd_receivers";
  if(
    /\b(configura|configurar|configuracao|configuração|como faco|como faço)\b/.test(t)
    && /\b(receptor|azamerica|az america|americabox|cinebox|gosat|probox|globalsat|duosat)\b/.test(t)
  ) return "receiver_help";
  if(
    /\b(quais receptores|qual receptor|lista de receptores|receptores compativeis)\b/.test(t)
    && /\b(hd|cs)\b/.test(t)
  ) return "cs_hd_receivers";
  if(
    /\b(servico|servicos|cervico|cervicos|servisso|servissos|produto|produtos|catalogo|catálogo)\b/.test(t)
    || /\b(quais servicos|que servicos|servicos voces|o que voces fazem|o que faz|trabalham com|voces trabalham|o que voces tem|o que vc tem|me mostra o que tem|lista de produtos|lista de servicos|manda a lista|manda o catalogo|manda catálogo|o que voces vendem|o que vc vende)\b/.test(t)
  )
    return "services";
  if(/\b(liberar|liberacao|confianca|computador|pc)\b/.test(t) && /\b(confianca|liberar|liberacao)\b/.test(t))
    return "trust_release";
  if(/\b(renovar|renovacao|vencimento)\b/.test(t))
    return "renew";
  // "teste" citado numa mensagem não significa que o cliente pediu um teste.
  // Só abre este fluxo quando há um pedido explícito do remetente.
  if(
    /\b(quero|gostaria|preciso|desejo|pode|consegue|consegui|libera|liberar|fazer|faz|faca|faça|pedir|solicitar|manda|mandar|gera|gerar|gere|cria|criar|crie)\b.{0,45}\b(o\s+)?(teste|testar)\b/.test(t)
    || /\b(teste|testar)\b.{0,25}\b(iptv|cs|servico|gratis|gratuito|agora|pra mim|para mim)\b/.test(t)
    || /\b(gere|gera|faz|faca|faça|cria|crie|manda|libera)\s+(?:ai\s+|aí\s+)?(?:o\s+)?teste\b/.test(t)
  )
    return "trial";
  if(/\b(falar com atendente|falar com uma pessoa|atendente humano|quero atendente|quero falar com alguem|quero falar com alguém)\b/.test(t))
    return "human";
  if(
    /\b(suporte|problema|erro|travando|ajuda|sem sinal|sem imagem|tela preta|caiu|parou)\b/.test(t)
    || /\bnao\s+(?:esta\s+)?(?:funciona|funcionando|abre|abrindo|carrega|carregando)\b/.test(t)
    || /\b(tv|canal|canais|iptv|app|aplicativo)\b.*\b(nao funciona|nao esta funcionando|travando|erro|parou|sem sinal|tela preta)\b/.test(t)
  )
    return "support";
  if(/\b(cs|cardsharing|cs satelite|cs net)\b/.test(t) && /\b(preco|precos|preso|presos|valor|valores|plano|planos|quanto custa|mensalidade)\b/.test(t))
    return "plans_cs";
  if(/\b(iptv)\b/.test(t) && /\b(preco|precos|preso|presos|valor|valores|plano|planos|quanto custa|mensalidade)\b/.test(t)){
    if(/\b(cliente|cliente final)\b/.test(t)) return "iptv_client_prices";
    if(/\b(revenda|revendedor|revender)\b/.test(t)) return "iptv_reseller_prices";
    return "iptv_price_gate";
  }
  if(
    /\b(painel iptv|painel hibrido|painel híbrido)\b/.test(t)
    && /\b(preco|precos|preso|presos|valor|valores|plano|planos|credito|creditos|quanto custa|mensalidade|tabela)\b/.test(t)
  ) return "panel_iptv";
  if(/\b(preco|precos|preso|presos|valor|valores|plano|planos|quanto custa|mensalidade)\b/.test(t))
    return "plans";
  if(/\b(painel iptv)\b/.test(t)) return "panel_iptv";
  if(/\b(painel cs)\b/.test(t)) return "panel_cs";
  if(/\b(unitv free)\b/.test(t)) return "unitv_free";
  if(/\b(unitv)\b/.test(t)) return "unitv";
  if(/\b(iptv)\b/.test(t)) return "iptv";
  if(/\b(cs satelite|cs net|servico cs|\bcs\b)\b/.test(t)) return "plans_cs";
  if(/\b(conserto|manutencao)\b/.test(t)) return "maintenance";
  if(/^(oi|ola|opa|bom dia|boa tarde|boa noite)[!. ]*$/.test(t)) return "welcome";
  return null;
}
function looksLikeNamedAppOrDevice(text:string){
  const t=norm(text);
  return /\b(smarters|iptv smarters|xciptv|ibo player|iboplayer|ibo pro|bob player|duplex|duplexplay|smart one|smartone|hot player|ss iptv|smart stb|stb|cloudy|clouddy|flix|player|samsung|lg|tcl|philips|philco|aoc|hisense|sony|panasonic|semp|toshiba|roku|android tv|google tv|tv box|fire tv|fire stick|iphone|android|windows|computador|xbox)\b/.test(t);
}
function looksLikeQuestionOrTopicShift(text:string){
  const raw=String(text||"").trim(),t=norm(raw);
  return raw.includes("?")
    || /\b(de onde|onde|quem|como|quando|porque|por que|qual|quais|quanto|quantos|me explica|me fale|me diz|pode me|voces|vocês)\b/.test(t)
    || /^(oi|ola|opa|bom dia|boa tarde|boa noite)\b/.test(t)
    || /\b(preco|precos|valor|valores|plano|planos|suporte|problema|erro|renovar|renovacao|teste|testar|pix|atendente|humano|servico|servicos)\b/.test(t);
}
function structuredInputExpected(node:string,text:string,context:any={}){
  const raw=String(text||"").trim(),t=norm(raw);
  if(["0","5","9"].includes(raw))return true;
  if(node==="trial_followup_offer")return /\b(sim|nao|não|quero|gostei|fechar|contratar|pacote|plano|valores|precos|preços|agora nao|agora não)\b/.test(t);
  if(node==="trial_choose_plan")return !!parsePlanDays(text);
  if(node==="trial_iptv_screens")return !!parseRequestedScreens(text);
  if(node==="trial_iptv_app"){
    if(/^([1-9][0-9]?)$/.test(raw))return true;
    if(/\b(nao sei|não sei|nenhum|nenhuma|sem app|sem aplicativo|nao tenho app|não tenho app|nao tenho aplicativo|não tenho aplicativo)\b/.test(t))return true;
    return looksLikeNamedAppOrDevice(text);
  }
  if(node==="trial_iptv"){
    const savedName=String(context?.trial_customer_name||"").trim();
    if(savedName)return !!detectAppPlatform(text)||looksLikeNamedAppOrDevice(text);
    if(looksLikeQuestionOrTopicShift(text)||/\d/.test(raw))return false;
    const words=raw.split(/\s+/).filter(Boolean);
    return raw.length>=2&&raw.length<=80&&words.length<=5;
  }
  return true;
}
function isStructuredConversationNode(node:string){
  return new Set(["trial_followup_offer","trial_choose_plan","trial_iptv","trial_iptv_app","trial_iptv_screens"]).has(node);
}
function shouldAIFirstForSupport(text:string){
  const t=norm(text);
  if(intentNode(text)!=="support")return false;
  return /\b(tv|canal|canais|filme|filmes|serie|series|app|aplicativo|iptv|receptor|imagem|som|aberta|abertos|travando|sem sinal|tela preta|erro|nao funciona|nao esta funcionando|parou)\b/.test(t);
}
function humanDelay(text:string){
  return Math.max(450,Math.min(1400,350+String(text).length*6));
}

const PANEL_CATALOG_URL="https://multi-paineis.sytes.net/";

function extractPanelNames(block:string){
  const names:string[]=[];
  const re=/\[\s*['"]([^'"]+)['"]/g;
  let m;
  while((m=re.exec(block))!==null){
    const n=String(m[1]||"").trim();
    if(n && !names.includes(n))names.push(n);
  }
  return names;
}
async function buildPanelCatalogReply(){
  try{
    const res=await fetch(PANEL_CATALOG_URL,{headers:{"accept":"text/html"}});
    if(!res.ok)throw new Error("catalog_http_"+res.status);
    const html=await res.text();

    const officialBlock=(html.match(/const\s+panels\s*=\s*\[([\s\S]*?)\];/)||[])[1]||"";
    const csBlock=(html.match(/const\s+csPanels\s*=\s*\[([\s\S]*?)\];/)||[])[1]||"";

    const official=extractPanelNames(officialBlock);
    const cs=extractPanelNames(csBlock).filter((x:string)=>!official.includes(x));

    if(!official.length && !cs.length)throw new Error("catalog_empty");

    let out="Temos vários painéis disponíveis para quem quer trabalhar com revenda.\n\n";
    if(official.length){
      out+=" Painéis IPTV disponíveis:\n";
      out+=official.map((n:string,i:number)=>(i+1)+" - "+n).join("\n");
    }
    if(cs.length){
      out+="\n\n Painéis CS disponíveis:\n";
      out+=cs.map((n:string,i:number)=>(i+1)+" - "+n).join("\n");
    }
    out+="\n\nA lista atualizada fica em:\n"+PANEL_CATALOG_URL;
    out+="\n\nSe algum desses te interessar, me fala o nome do painel que eu sigo com você.";
    return out;
  }catch{
    return "Temos vários painéis disponíveis para revenda. A lista atualizada fica aqui:\n"+PANEL_CATALOG_URL+"\n\nSe você me disser se procura painel IPTV ou CS, eu te oriento.";
  }
}

function stripBotEmoji(text:string){
  return String(text||"")
    .replace(/\p{Extended_Pictographic}/gu,"")
    .replace(/[\uFE0E\uFE0F]/g,"")
    .replace(/[ \t]+\n/g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}
function detectDeviceFromText(text:string){
  const t=norm(text);
  if(/\b(samsung|tizen)\b/.test(t))return "Samsung";
  if(/\b(lg|webos|web os)\b/.test(t))return "LG";
  if(/\b(tcl)\b/.test(t))return "TCL";
  if(/\b(philips)\b/.test(t))return "Philips";
  if(/\b(philco)\b/.test(t))return "Philco";
  if(/\b(aoc)\b/.test(t))return "AOC";
  if(/\b(hisense)\b/.test(t))return "Hisense";
  if(/\b(sony)\b/.test(t))return "Sony";
  if(/\b(panasonic)\b/.test(t))return "Panasonic";
  if(/\b(semp|toshiba)\b/.test(t))return "Semp/Toshiba";
  if(/\b(roku)\b/.test(t))return "Roku";
  if(/\b(google tv)\b/.test(t))return "Google TV";
  if(/\b(android tv|tv box|android box)\b/.test(t))return "Android";
  if(/\b(fire stick|fire tv|firestick)\b/.test(t))return "Fire Stick";
  if(/\b(iphone|ios)\b/.test(t))return "iPhone";
  if(/\b(android|celular android)\b/.test(t))return "Android";
  if(/\b(windows|computador|pc|notebook)\b/.test(t))return "Windows";
  if(/\b(xbox)\b/.test(t))return "Xbox";
  return "";
}
function detectAppPlatform(text:string){
  const t=norm(text);
  if(/\b(samsung|tizen)\b/.test(t))return "Samsung";
  if(/\b(lg|webos|web os)\b/.test(t))return "LG";
  if(/\b(roku)\b/.test(t))return "Roku";
  if(/\b(fire stick|fire tv|firestick)\b/.test(t))return "Fire Stick";
  if(/\b(tv box|android tv|android box)\b/.test(t))return "Android";
  if(/\b(android|celular android)\b/.test(t))return "Android";
  if(/\b(iphone|ios)\b/.test(t))return "iPhone";
  if(/\b(windows|computador|pc|notebook)\b/.test(t))return "Windows";
  if(/\b(xbox)\b/.test(t))return "Xbox";
  if(/\b(smart tv|smarttv)\b/.test(t))return "Smart TV";
  return "";
}
function asksForAppImage(text:string){
  const t=norm(text);
  const asksImage=/\b(manda|mandar|envia|enviar|mostra|mostrar|quero|preciso|procura|buscar|pesquisa|pesquisar|cade|cadê)\b/.test(t)
    && /\b(imagem|foto|logo|icone|ícone|print)\b/.test(t);
  const appContext=/\b(app|aplicativo|player|tv|loja)\b/.test(t);
  const namedImage=/\b(imagem|foto|logo|icone|ícone|print)\s+(?:do|da|de)\s+[^\s]{2,}/.test(t);
  return namedImage||asksImage&&(appContext||namedImage);
}

function bytesToBase64(bytes:Uint8Array){
  let out="";
  const step=0x8000;
  for(let i=0;i<bytes.length;i+=step){
    out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+step,bytes.length)));
  }
  return btoa(out);
}

async function findCatalogAppForImage(workspaceId:string,text:string,context:any={}){
  const {data:apps}=await db.from("wa_app_catalog")
    .select("id,name,aliases,platforms")
    .eq("workspace_id",workspaceId).eq("enabled",true).order("name");
  const rows=Array.isArray(apps)?apps:[];
  const t=norm(text);
  const direct=rows.find((a:any)=>{
    const names=[a.name,...(a.aliases||[])].map((x:string)=>norm(x)).filter(Boolean);
    return names.some((n:string)=>n.length>=3&&t.includes(n));
  });
  if(direct)return direct;

  const raw=String(text||"").replace(/\s+/g," ").trim();
  const patterns=[
    /(?:imagem|foto|logo|icone|ícone|print)\s+(?:do|da|de)\s+(?:aplicativo|app|player)?\s*([^,.;?!]+?)(?:\s+(?:para|pra)\s+|$)/i,
    /(?:aplicativo|app|player)\s+([^,.;?!]+?)(?:\s+(?:para|pra)\s+|$)/i
  ];
  for(const re of patterns){
    const m=raw.match(re);
    let guessed=String(m?.[1]||"").trim();
    guessed=guessed
      .replace(/\b(?:eu|cliente|ele|ela)\s+(?:achar|encontrar|localizar|ver|baixar|instalar)\b.*$/i,"")
      .replace(/\b(?:na|no)\s+(?:minha|sua|a)\s+(?:tv|televisao|televisão|aparelho)\b.*$/i,"")
      .replace(/\s+/g," ").trim();
    const generic=/^(?:ele|ela|dele|dela|esse|essa|isso|aplicativo|app|player)$/i.test(guessed);
    if(!generic&&guessed.length>=2&&guessed.length<=60){
      return {id:null,name:guessed,aliases:[],platforms:[],discovered:true};
    }
  }

  const remembered=norm(String(context?.app_name||context?.support_app||""));
  if(remembered){
    const rememberedApp=rows.find((a:any)=>{
      const names=[a.name,...(a.aliases||[])].map((x:string)=>norm(x)).filter(Boolean);
      return names.some((n:string)=>n===remembered||remembered.includes(n)||n.includes(remembered));
    });
    if(rememberedApp)return rememberedApp;
    return {id:null,name:String(context?.app_name||context?.support_app||"").trim(),aliases:[],platforms:[],discovered:true};
  }
  return null;
}

async function publicAppImageUrls(appName:string){
  const n=norm(appName);
  const seeded:string[]=[];
  if(n==="playsim"||n==="play sim")seeded.push("https://playsim.cloud/images/videocapa.png");
  if(n==="fast hd"||n==="fast iptv"||n==="fast")seeded.push("https://m.apksum.com/images/b6/com.lck.ourdatoo.player.fastiptv/icon.png");
  const key=Deno.env.get("OPENAI_API_KEY");
  if(!key)return seeded;
  try{
    const res=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"authorization":"Bearer "+key,"content-type":"application/json"},
      body:JSON.stringify({
        model:"gpt-5-mini",
        instructions:[
          "Pesquise na web imagens públicas que ajudem uma pessoa a reconhecer o aplicativo informado na loja da TV.",
          "Priorize ícone ou logo em site oficial, Google Play, App Store, loja de TV ou documentação oficial.",
          "Retorne SOMENTE JSON válido no formato {\"image_urls\":[\"https://...\",\"https://...\"]}.",
          "Forneça até 6 URLs HTTPS diretas de imagem JPG, JPEG, PNG ou WEBP, de fontes diferentes quando possível.",
          "Não retorne página HTML, rede social, imagem privada nem conteúdo protegido por login."
        ].join("\n"),
        input:"Aplicativo: "+appName+" IPTV. Encontre o ícone ou logo exato usado para localizar esse aplicativo na loja.",
        tools:[{type:"web_search",search_context_size:"high"}],
        tool_choice:"auto",
        max_output_tokens:420
      }),
      signal:AbortSignal.timeout(26000)
    });
    if(!res.ok)return seeded;
    const data=await res.json().catch(()=>({}));
    const raw=responseTextFromOpenAI(data,true);
    const parsed=JSON.parse(String(raw||"").replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"").trim());
    const found=Array.isArray(parsed?.image_urls)?parsed.image_urls:[parsed?.image_url];
    for(const value of found){
      const url=String(value||"").trim();
      if(/^https:\/\//i.test(url)&&!seeded.includes(url))seeded.push(url);
    }
  }catch{}
  return seeded.slice(0,7);
}

async function publicImageAsJpegDataUri(imageUrl:string){
  if(!/^https:\/\//i.test(imageUrl))return "";
  const attempts=[
    "https://images.weserv.nl/?url="+encodeURIComponent(imageUrl)+"&output=jpg&w=900&q=86",
    "https://images.weserv.nl/?url="+encodeURIComponent(imageUrl)+"&output=jpg&w=700&q=82&default=1",
    imageUrl
  ];
  for(const url of attempts){
    try{
      const res=await fetch(url,{headers:{"accept":"image/jpeg,image/*","user-agent":"Mozilla/5.0"},signal:AbortSignal.timeout(16000)});
      if(!res.ok)continue;
      const ct=String(res.headers.get("content-type")||"").toLowerCase();
      const bytes=new Uint8Array(await res.arrayBuffer());
      if(!ct.includes("image/")||bytes.length<500||bytes.length>7_000_000)continue;
      return "data:image/jpeg;base64,"+bytesToBase64(bytes);
    }catch{}
  }
  return "";
}

async function buildRequestedAppImage(workspaceId:string,text:string,context:any={}){
  if(!asksForAppImage(text))return null;
  const app=await findCatalogAppForImage(workspaceId,text,context);
  if(!app)return {handled:false,reason:"app_not_found"};
  const appName=String(app.name||"").trim();
  const appKey=norm(appName);

  if(appKey){
    const {data:cached}=await db.from("wa_app_image_memory")
      .select("image_data_uri,display_name,use_count")
      .eq("workspace_id",workspaceId).eq("app_key",appKey).maybeSingle();
    if(cached?.image_data_uri){
      await db.from("wa_app_image_memory").update({
        use_count:Number(cached.use_count||0)+1,
        last_used_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq("workspace_id",workspaceId).eq("app_key",appKey);
      return {handled:true,app:{...app,name:cached.display_name||appName},dataUri:cached.image_data_uri,memory:true};
    }
  }

  const imageUrls=await publicAppImageUrls(appName);
  for(const imageUrl of imageUrls){
    const dataUri=await publicImageAsJpegDataUri(imageUrl);
    if(!dataUri)continue;
    if(appKey){
      await db.from("wa_app_image_memory").upsert({
        workspace_id:workspaceId,
        app_key:appKey,
        display_name:appName,
        image_data_uri:dataUri,
        source_url:imageUrl,
        use_count:1,
        last_used_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      },{onConflict:"workspace_id,app_key"});
    }
    return {handled:true,app,dataUri,memory:false};
  }
  return {handled:false,reason:"image_not_found",app};
}

function asksForAppCatalogList(text:string){
  const t=norm(text);
  return /\b(lista|relacao|relação)\s+(?:de|dos)?\s*(?:apps?|aplicativos?|players?)\b/.test(t)
    || /\b(quais|qual)\s+(?:apps?|aplicativos?|players?)\s+(?:tem|têm|possui|disponiveis|disponíveis|trabalha|usa)\b/.test(t)
    || /\b(?:apps?|aplicativos?|players?)\s+(?:disponiveis|disponíveis|que tem|que vocês têm|que voces tem)\b/.test(t);
}

async function buildAppCatalogList(workspaceId:string){
  const {data:apps,error}=await db.from("wa_app_catalog")
    .select("name,platforms")
    .eq("workspace_id",workspaceId).eq("enabled",true).order("name");
  if(error)return {rows:[],reply:"Não consegui consultar a lista agora. Vou tentar novamente quando você pedir."};
  const rows=(Array.isArray(apps)?apps:[]).filter((a:any)=>String(a?.name||"").trim());
  if(!rows.length)return {rows:[],reply:"Ainda não há aplicativos cadastrados nesta conta."};
  const lines=rows.map((a:any,i:number)=>{
    const platforms=(Array.isArray(a.platforms)?a.platforms:[]).filter(Boolean).join(", ");
    return String(i+1)+". "+String(a.name)+(platforms?" — "+platforms:"");
  });
  return {
    rows,
    reply:"Claro. Estes são os aplicativos disponíveis nesta conta:\n\n"+lines.join("\n")+"\n\nMe diga o número ou o nome do aplicativo que você quer."
  };
}

type BusinessOverviewEntry={kind:"campaign"|"knowledge"|"apps";label:string;content:string};

function publicKnowledgeText(value:string){
  return String(value||"")
    .replace(/Não usar esta tabela[^.]*\.?/gi,"")
    .replace(/A lista dinâmica[^.]*\.?/gi,"")
    .replace(/Não invente[^.]*\.?/gi,"")
    .replace(/Quando (?:a pessoa|o contato|o cliente)[^.]*\.?/gi,"")
    .replace(/O sistema pode[^.]*\.?/gi,"")
    .replace(/Estes valores prevalecem[^.]*\.?/gi,"")
    .replace(/\s+/g," ")
    .trim();
}

async function businessOverviewEntries(workspaceId:string):Promise<BusinessOverviewEntry[]>{
  const [{data:knowledge},{data:apps},{data:lastCampaign}]=await Promise.all([
    db.from("wa_knowledge").select("title,content").eq("workspace_id",workspaceId).eq("enabled",true).order("title").limit(80),
    db.from("wa_app_catalog").select("name").eq("workspace_id",workspaceId).eq("enabled",true).order("name").limit(80),
    db.from("wa_messages").select("content,created_at").eq("workspace_id",workspaceId).eq("direction","out").eq("sender_type","campaign").order("created_at",{ascending:false}).limit(1).maybeSingle()
  ]);
  const entries:BusinessOverviewEntry[]=[];
  const campaign=publicKnowledgeText(String(lastCampaign?.content||""));
  if(campaign)entries.push({kind:"campaign",label:"Promoção ou novidade mais recente",content:campaign});

  const seen=new Set<string>();
  for(const row of (Array.isArray(knowledge)?knowledge:[])){
    const label=String(row?.title||"").replace(/\s+/g," ").trim();
    const key=norm(label);
    const content=publicKnowledgeText(String(row?.content||""));
    if(!label||!content||seen.has(key))continue;
    seen.add(key);
    entries.push({kind:"knowledge",label,content});
    if(entries.length>=13)break;
  }

  const appNames=(Array.isArray(apps)?apps:[]).map((x:any)=>String(x?.name||"").trim()).filter(Boolean);
  if(appNames.length&&entries.length<14){
    entries.push({kind:"apps",label:"Aplicativos disponíveis",content:appNames.join(", ")});
  }
  return entries;
}

async function buildBusinessOverview(workspaceId:string){
  const [{data:settings},entries]=await Promise.all([
    db.from("wa_settings").select("company_name").eq("workspace_id",workspaceId).maybeSingle(),
    businessOverviewEntries(workspaceId)
  ]);
  const company=String(settings?.company_name||"empresa").trim()||"empresa";
  if(!entries.length){
    return "Olá! Me diga o que você procura ou o que deseja saber sobre a "+company+". Vou conversar com você e entender sua necessidade.";
  }
  const options=entries.map((item,index)=>(index+1)+" - "+item.label);
  return [
    "Claro. O que você quer consultar na "+company+"?",
    "",
    ...options,
    "",
    "Responda com o número ou escreva com suas palavras o que você precisa."
  ].join("\n");
}

async function buildBusinessOverviewSection(workspaceId:string,choice:string){
  const entries=await businessOverviewEntries(workspaceId);
  const index=Number(choice)-1;
  if(!Number.isInteger(index)||index<0||index>=entries.length){
    return "Essa opção não está disponível agora. Escreva com suas palavras o que você procura que eu continuo o atendimento.";
  }
  const item=entries[index];
  let answer=item.label.toUpperCase()+"\n\n"+item.content;
  if(item.kind==="apps")answer+="\n\nSe quiser foto ou detalhes de algum aplicativo, escreva o nome dele.";
  else answer+="\n\nSe quiser continuar, me diga exatamente o que você precisa.";
  if(answer.length>3000)answer=answer.slice(0,2990)+"...";
  return answer;
}

async function universalWorkspaceReply(workspaceId:string,text:string,context:any={}){
  const [{data:settings},{data:knowledge}]=await Promise.all([
    db.from("wa_settings").select("company_name,virtual_agent_name,welcome_message").eq("workspace_id",workspaceId).maybeSingle(),
    db.from("wa_knowledge").select("title,keywords,content").eq("workspace_id",workspaceId).eq("enabled",true).limit(80)
  ]);
  const company=String(settings?.company_name||"a empresa").trim()||"a empresa";
  const agent=String(settings?.virtual_agent_name||"Atendimento").trim()||"Atendimento";
  const t=norm(text);
  const greeting=customerGreeting(text);
  if(/^(oi|ola|opa|bom dia|boa tarde|boa noite)[!. ]*$/.test(t)){
    if(Number(context?.turn||0)>1)return "Pode falar, tô te acompanhando 😊";
    return (greeting||"Olá!")+" Tudo bem? Pode falar, o que você precisa?";
  }
  if(/\b(qual seu nome|como voce chama|como vc chama|quem fala|com quem eu falo|quem e voce|quem e vc)\b/.test(t))
    return "Aqui é "+agent+", da "+company+". Pode falar comigo. O que você precisa?";
  if(/\b(voce e robo|voce e bot|vc e bot|atendimento automatico|voce e uma ia|vc e uma ia)\b/.test(t))
    return "Sou a assistente virtual da "+company+". Fui preparada para atender você por aqui e resolver o que for possível. O que você precisa?";
  const rows=Array.isArray(knowledge)?knowledge:[];
  const ranked=rows.map((x:any)=>{
    const hay=[x.title,...(Array.isArray(x.keywords)?x.keywords:[]),x.content].join(" ");
    return {...x,score:learningScore(text,hay)};
  }).filter((x:any)=>x.score>=0.32).sort((a:any,b:any)=>b.score-a.score);
  if(ranked.length){
    const best=ranked[0];
    let answer=String(best.content||"").replace(/\s+/g," ").trim();
    const internal=/^(quando|antes de|use |usar |nunca |não invente|nao invente|a base |para solicitar)/i;
    const sentences=answer.split(/(?<=[.!?])\s+/).filter((s:string)=>!internal.test(s.trim()));
    if(sentences.length)answer=sentences.join(" ");
    if(answer.length>1200)answer=answer.slice(0,1197)+"...";
    if(answer)return answer;
  }
  if(/\b(comprar|contratar|orcamento|orçamento|preco|preço|valor|quero|preciso)\b/.test(t))
    return "Claro, eu te ajudo. O que você está procurando? Se já souber o modelo ou a quantidade, pode me mandar também.";
  if(/\b(erro|problema|nao funciona|não funciona|parou|invalido|inválido)\b/.test(t))
    return "Entendi. O que está apresentando problema? Me diga o produto ou aparelho e o que aparece na tela. Se puder, mande uma foto ou um vídeo curto que eu verifico.";
  return null;
}

async function buildPartnerAppReply(workspaceId:string,text:string,context:any={}){
  const {data:apps}=await db.from("wa_app_catalog")
    .select("name,aliases,platforms,action_url,action_kind")
    .eq("workspace_id",workspaceId).eq("enabled",true).order("name");
  const rows=Array.isArray(apps)?apps:[];
  if(!rows.length)return null;

  const t=norm(text);
  const mentioned=rows.find((a:any)=>{
    const names=[a.name,...(a.aliases||[])].map((x:string)=>norm(x)).filter(Boolean);
    return names.some((n:string)=>n.length>=3 && t.includes(n));
  });

  if(mentioned){
    const installed=/\b(tenho|tem|ja tenho|já tenho|ja tem|já tem|instalado|instalada|aparece|veio com|minha tv tem)\b/.test(t);
    const plats=(mentioned.platforms||[]).join(", ");
    if(installed){
      return "Pode usar o "+mentioned.name+"  Ele está cadastrado como compatível com "+plats+". Como ele já está instalado, não precisa baixar de novo. Me diga a marca/modelo da sua TV ou aparelho e eu sigo com a configuração.";
    }
    if(mentioned.action_kind==="download" && mentioned.action_url && !String(mentioned.action_url).includes("wa.me/")){
      return "O "+mentioned.name+" é compatível com "+plats+". Para baixar, use este link:\n"+mentioned.action_url+"\n\nDepois de instalar, me diga a marca/modelo do aparelho e eu sigo com a configuração.";
    }
    return "O "+mentioned.name+" é compatível com "+plats+". O acesso/download desse aplicativo é fornecido pelo atendimento da JSTech. Me diga a marca/modelo da sua TV ou aparelho e eu sigo com você.";
  }

  const asksApp=/\b(qual app|qual aplicativo|que app|que aplicativo|aplicativo devo|app devo|qual baixar|o que baixar|aplicativo para|app para|qual usar na tv|qual usar no aparelho)\b/.test(t);
  if(!asksApp)return null;

  const platform=detectAppPlatform(text)||String(context?.device_type||context?.platform||"");
  if(!platform){
    return "Consigo te indicar o aplicativo certo. Me diga a marca/modelo da TV ou qual aparelho você usa: Samsung, LG, Roku, Android TV/TV Box, Fire Stick, iPhone ou computador.";
  }

  const matches=rows.filter((a:any)=>{
    const ps=(a.platforms||[]).map((x:string)=>norm(x));
    const p=norm(platform);
    if(p==="fire stick")return ps.includes("fire stick")||ps.includes("fire tv")||ps.includes("multiplataforma");
    if(p==="android")return ps.includes("android")||ps.includes("tv box")||ps.includes("multiplataforma");
    if(p==="smart tv")return ps.includes("smart tv")||ps.includes("multiplataforma");
    return ps.includes(p)||ps.includes("multiplataforma");
  }).sort((a:any,b:any)=>{
    const ad=a.action_kind==="download"&&!String(a.action_url||"").includes("wa.me/")?0:1;
    const bd=b.action_kind==="download"&&!String(b.action_url||"").includes("wa.me/")?0:1;
    return ad-bd;
  }).slice(0,4);

  if(!matches.length){
    return "Para "+platform+" eu preciso confirmar o modelo exato antes de indicar um aplicativo. Me diga a marca e o modelo do aparelho.";
  }

  let out="Para "+platform+", estas são opções compatíveis cadastradas na JSTech:\n\n";
  out+=matches.map((a:any,i:number)=>{
    const direct=a.action_kind==="download"&&a.action_url&&!String(a.action_url).includes("wa.me/");
    return (i+1)+" - "+a.name+(direct?"\n"+a.action_url:"\nDownload/acesso pelo atendimento");
  }).join("\n\n");
  out+="\n\nSe me disser qual dessas você quer usar, eu sigo com a configuração.";
  return out;
}

async function resolvePanelRouteForText(workspaceId:string,text:string){
  const {data:apps}=await db.from("wa_app_catalog")
    .select("id,name,aliases").eq("workspace_id",workspaceId).eq("enabled",true);
  const t=norm(text);
  const app=(apps||[]).find((a:any)=>{
    const names=[a.name,...(a.aliases||[])].map((x:string)=>norm(x)).filter(Boolean);
    return names.some((n:string)=>n.length>=3&&t.includes(n));
  });
  if(!app)return null;

  const {data:maps}=await db.from("wa_panel_app_map")
    .select("connector_id,panel_app_code,priority")
    .eq("workspace_id",workspaceId).eq("app_catalog_id",app.id).eq("enabled",true)
    .order("priority",{ascending:true}).limit(10);

  if(!(maps||[]).length)return {app_catalog_id:app.id,app_name:app.name};

  for(const m of maps||[]){
    const {data:p}=await db.from("wa_panel_connectors")
      .select("id,name,enabled,credential_secret_id,last_status")
      .eq("id",m.connector_id).eq("workspace_id",workspaceId).maybeSingle();
    if(p?.enabled&&p?.credential_secret_id&&p?.last_status==="driver_ready"){
      return {
        app_catalog_id:app.id,app_name:app.name,
        panel_connector_id:p.id,panel_name:p.name,panel_app_code:m.panel_app_code||null
      };
    }
  }
  const first=(maps||[])[0];
  return {
    app_catalog_id:app.id,app_name:app.name,
    panel_connector_id:first.connector_id,panel_app_code:first.panel_app_code||null,
    panel_waiting_credentials:true
  };
}


function appMatchesDevice(platforms:any[],device:string){
  const ps=(platforms||[]).map((x:any)=>norm(String(x||"")));
  const p=norm(device||"");
  if(!p)return true;
  if(p.includes("fire stick")||p.includes("fire tv"))return ps.includes("fire stick")||ps.includes("fire tv")||ps.includes("android")||ps.includes("multiplataforma");
  if(p.includes("android")||p.includes("tv box")||p.includes("google tv"))return ps.includes("android")||ps.includes("tv box")||ps.includes("smart tv")||ps.includes("multiplataforma");
  if(p.includes("lg"))return ps.includes("lg")||ps.includes("smart tv")||ps.includes("multiplataforma");
  if(p.includes("samsung"))return ps.includes("samsung")||ps.includes("smart tv")||ps.includes("multiplataforma");
  if(p.includes("roku"))return ps.includes("roku")||ps.includes("multiplataforma");
  if(p.includes("iphone")||p.includes("ios"))return ps.includes("iphone")||ps.includes("multiplataforma");
  if(p.includes("windows")||p.includes("computador")||p.includes("pc")||p.includes("notebook"))return ps.includes("windows")||ps.includes("multiplataforma");
  if(p.includes("xbox"))return ps.includes("xbox")||ps.includes("multiplataforma");
  return ps.includes("smart tv")||ps.includes("multiplataforma");
}

async function readyTrialAppChoices(workspaceId:string,device:string){
  const [{data:apps},{data:maps},{data:panels}]=await Promise.all([
    db.from("wa_app_catalog").select("id,name,platforms").eq("workspace_id",workspaceId).eq("enabled",true),
    db.from("wa_panel_app_map").select("connector_id,app_catalog_id,app_name,panel_app_code,priority").eq("workspace_id",workspaceId).eq("enabled",true).order("priority",{ascending:true}),
    db.from("wa_panel_connectors").select("id,name,enabled,credential_secret_id,last_status").eq("workspace_id",workspaceId).eq("enabled",true)
  ]);
  const readyPanels=new Map((panels||[])
    .filter((p:any)=>p.credential_secret_id&&p.last_status==="driver_ready")
    .map((p:any)=>[p.id,p]));
  const appById=new Map((apps||[]).map((a:any)=>[a.id,a]));
  const out:any[]=[];
  const seen=new Set<string>();
  for(const m of maps||[]){
    const p:any=readyPanels.get(m.connector_id);
    const a:any=appById.get(m.app_catalog_id);
    if(!p||!a||seen.has(a.id)||!appMatchesDevice(a.platforms||[],device))continue;
    seen.add(a.id);
    out.push({
      app_catalog_id:a.id,app_name:a.name,
      panel_connector_id:p.id,panel_name:p.name,
      panel_app_code:m.panel_app_code||null
    });
    if(out.length>=8)break;
  }
  return out;
}

function parsePlanDays(raw:string){
  const t=norm(raw);
  if(/\b(30 dias|mensal|1 mes|1 mês)\b/.test(t)||t==="1")return 30;
  if(/\b(90 dias|trimestral|3 meses)\b/.test(t)||t==="2")return 90;
  if(/\b(180 dias|semestral|6 meses)\b/.test(t)||t==="3")return 180;
  if(/\b(365 dias|anual|12 meses|1 ano)\b/.test(t)||t==="4")return 365;
  return 0;
}
function planLabel(days:number){
  if(days===30)return "Mensal";
  if(days===90)return "Trimestral";
  if(days===180)return "Semestral";
  if(days===365)return "Anual";
  return days+" dias";
}
function historyPlanCandidates(raw:string){
  const t=norm(raw);
  const found:number[]=[];
  if(/\b(30\s*dias|mensal|1\s*mes|1\s*mês)\b/.test(t))found.push(30);
  if(/\b(90\s*dias|trimestral|3\s*meses)\b/.test(t))found.push(90);
  if(/\b(180\s*dias|semestral|6\s*meses)\b/.test(t))found.push(180);
  if(/\b(365\s*dias|anual|12\s*meses|1\s*ano)\b/.test(t))found.push(365);
  return [...new Set(found)];
}
async function scanPanelPlanHistory(workspaceId:string,contactId:string,conversationId:string,username:string){
  const {data:msgs}=await db.from("wa_messages")
    .select("content,created_at,direction,sender_type")
    .eq("workspace_id",workspaceId)
    .eq("contact_id",contactId)
    .order("created_at",{ascending:false})
    .limit(180);

  let planDays:number|null=null;
  let planAt:string|null=null;
  let activatedAt:string|null=null;
  let screenCount:number|null=null;
  const evidence:any[]=[];
  const userNorm=norm(username);

  for(const m of msgs||[]){
    const raw=String(m.content||"");
    const t=norm(raw);
    if(!screenCount){
      const sc=parseRequestedScreens(raw);
      if(sc)screenCount=sc;
    }
    const plans=historyPlanCandidates(raw);
    if(plans.length!==1)continue;

    const relatedToUser=!!userNorm&&t.includes(userNorm);
    const actionText=/\b(plano escolhido|pagamento confirmado|pagamento aprovado|pago|ativado|ativacao|ativação|renovado|renovacao|renovação|contratado|contratacao|contratação)\b/.test(t);
    const customerChoice=m.direction==="in"&&/\b(mensal|trimestral|semestral|anual|30 dias|90 dias|180 dias|365 dias)\b/.test(t);
    if(!(relatedToUser||actionText||customerChoice))continue;

    const d=plans[0];
    if(!planDays){
      planDays=d;
      planAt=m.created_at;
    }
    if(!activatedAt&&actionText)activatedAt=m.created_at;
    if(evidence.length<4){
      evidence.push({
        created_at:m.created_at,
        direction:m.direction,
        plan_days:d,
        text:raw.slice(0,220)
      });
    }
    if(planDays&&activatedAt&&screenCount)break;
  }

  return {
    plan_days:planDays,
    plan_at:planAt,
    activated_at:activatedAt,
    screen_count:screenCount,
    evidence
  };
}

function extractPanelUsername(raw:string){
  const s=String(raw||"").trim();
  const direct=s.match(/(?:usuario|usuário|user|login)\s*(?:e|é)?\s*[:=-]?\s*([A-Za-z0-9._@-]{3,64})/i);
  if(direct)return direct[1];
  if(/^[A-Za-z0-9._@-]{3,64}$/.test(s) && !/^(oi|ola|teste|iptv|cliente|revenda|renovar|vencido|suporte)$/i.test(s))return s;
  return "";
}
function customerGreeting(raw:string){
  const t=norm(raw);
  if(/\bbom dia\b/.test(t))return "Bom dia!";
  if(/\bboa tarde\b/.test(t))return "Boa tarde!";
  if(/\bboa noite\b/.test(t))return "Boa noite!";
  return "";
}
function isAppInvalidAccountProblem(raw:string){
  const t=norm(raw);
  return /\b(conta|acesso|dados|login|usuario|senha)\b.*\b(invalid[oa]s?|incorret[oa]s?|erro)\b/.test(t)
    || /\b(invalid[oa]s?|incorret[oa]s?)\b.*\b(conta|acesso|dados|login|usuario|senha)\b/.test(t);
}
function isPanelAccountProblem(raw:string){
  const t=norm(raw);
  return /\b(login invalido|usuario invalido|senha invalida|credencial invalida|nao entra|parou de funcionar|acesso vencido|esta vencido|venceu|vencimento|renovar|renovacao|trocar o painel|trocar painel|troque o painel|mudar o painel|mudar painel|meu painel|painel esta com problema|problema no painel|problema no conteudo|conteudo nao funciona|conteudo parou|painel nao funciona|painel parou|resolver meu painel)\b/.test(t);
}
async function queuePanelUserSearch(workspaceId:string,contactId:string,conversationId:string,username:string,reason:string){
  const history=await scanPanelPlanHistory(workspaceId,contactId,conversationId,username);
  const [{data:panels},{data:known}]=await Promise.all([
    db.from("wa_panel_connectors")
      .select("id,name,last_status,enabled,credential_secret_id")
      .eq("workspace_id",workspaceId).eq("enabled",true),
    db.from("wa_panel_accounts")
      .select("connector_id,updated_at")
      .eq("workspace_id",workspaceId).ilike("username",username)
      .order("updated_at",{ascending:false}).limit(5)
  ]);
  const knownIds=new Set((known||[]).map((x:any)=>x.connector_id));
  const ready=(panels||[])
    .filter((p:any)=>p.credential_secret_id&&p.last_status==="driver_ready")
    .sort((a:any,b:any)=>Number(knownIds.has(b.id))-Number(knownIds.has(a.id)));
  if(!ready.length)return {count:0,group:""};
  const group=crypto.randomUUID();
  const rows=ready.map((p:any,i:number)=>({
    workspace_id:workspaceId,contact_id:contactId,conversation_id:conversationId,
    connector_id:p.id,action_type:"search_user",status:"pending",
    requested_username:username,lookup_group_id:group,
    history_plan_days:history.plan_days,history_plan_at:history.plan_at,
    screen_count:Number(history.screen_count||1),
    payload:{username,search_group:group,reason,panel_name:p.name,search_priority:i,history}
  }));
  const {error}=await db.from("wa_panel_jobs").insert(rows);
  if(error)throw error;
  return {count:rows.length,group};
}

function professionalText(value:string,senderType:string,allowEmojis=true){
  let raw=String(value||"");
  if(senderType!=="human"&&!allowEmojis){
    raw=raw
      .replace(/\p{Extended_Pictographic}/gu,"")
      .replace(/[\uFE0E\uFE0F]/g,"");
  }
  return raw
    .replace(/[ \t]{2,}/g," ")
    .replace(/^[ \t]+/gm,"")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}

function structuredHumanMessage(text:string){
  const s=String(text||"");
  return /https?:\/\//i.test(s)
    || /\b(?:pix|chave pix|usuario|usuário|senha|login|mac|device key|key|m3u|dns)\s*[:=-]/i.test(s)
    || /^\s*\d+\s*[-.)]\s+/m.test(s)
    || s.split("\n").filter(Boolean).length>7;
}

function splitHumanizedMessage(text:string){
  const clean=String(text||"").trim();
  if(clean.length<150||structuredHumanMessage(clean))return [clean];

  const paragraphs=clean.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
  if(paragraphs.length>=2&&paragraphs.length<=3&&paragraphs.every(x=>x.length<=420)){
    return paragraphs;
  }

  const sentences=(clean.match(/[^.!?\n]+(?:[.!?]+|$)/g)||[clean]).map(x=>x.trim()).filter(Boolean);
  if(sentences.length<2)return [clean];

  const parts:string[]=[];
  let cur="";
  for(const sentence of sentences){
    const candidate=cur?(cur+" "+sentence):sentence;
    if(cur&&candidate.length>210&&parts.length<2){
      parts.push(cur.trim());
      cur=sentence;
    }else{
      cur=candidate;
    }
  }
  if(cur)parts.push(cur.trim());
  if(parts.length>3){
    return [parts[0],parts[1],parts.slice(2).join(" ")];
  }
  return parts.filter(Boolean);
}

function humanizedDelay(text:string,minMs=1800,maxMs=5000){
  const min=Math.max(700,Math.min(Number(minMs||1800),5000));
  const max=Math.max(min,Math.min(Number(maxMs||5000),5000));
  const calculated=1200+String(text||"").length*18;
  return Math.max(min,Math.min(max,calculated));
}

async function queueOut(wid:string,cid:string,contactId:string,phone:string,text:string,senderType="bot",extraMetadata:any={}){
  const {data:slotRow}=await db.from("wa_conversations").select("connection_slot").eq("id",cid).maybeSingle();
  const connectionSlot=Number(slotRow?.connection_slot||1);
  const {data:brandSettings}=await db.from("wa_settings")
    .select("company_name,humanized_mode,humanized_split_messages,humanized_emojis,humanized_typing_min_ms,humanized_typing_max_ms")
    .eq("workspace_id",wid).maybeSingle();

  const companyName=String(brandSettings?.company_name||"JSTech").trim()||"JSTech";
  const brandedText=companyName==="JSTech"
    ? String(text||"")
    : String(text||"").replace(/\bJSTech\b/g,companyName);

  let clean=professionalText(brandedText,senderType,brandSettings?.humanized_emojis!==false);
  clean=clean
    .replace(/^\s*(?:ana|assistente|atendente)\s*[,;:-]?\s*(?:disse|respondeu)\s*:\s*/i,"")
    .replace(/^\s*[^\n]{1,50},\s*disse:\s*/i,"")
    .trim();

  const humanized=(senderType==="ai"||senderType==="bot")&&brandSettings?.humanized_mode!==false;

  // Se o cliente acabou de falar por áudio, tenta responder em áudio com a voz
  // exclusiva desta conta. Se a voz não estiver pronta, mantém o texto normal.
  let audioDataUri:string|null=null;
  if(humanized&&extraMetadata?.force_text!==true){
    const {data:lastInbound}=await db.from("wa_messages")
      .select("message_type,created_at")
      .eq("workspace_id",wid)
      .eq("conversation_id",cid)
      .eq("contact_id",contactId)
      .eq("direction","in")
      .order("created_at",{ascending:false})
      .limit(1)
      .maybeSingle();
    const recentAudio=lastInbound?.message_type==="audio"
      && !!lastInbound?.created_at
      && (Date.now()-new Date(lastInbound.created_at).getTime())<=5*60*1000;
    if(recentAudio){
      const audioB64=await synthesizeTenantOwnerVoice(wid,clean);
      if(audioB64)audioDataUri="data:audio/ogg;base64,"+audioB64;
    }
  }

  const canSplit=!audioDataUri&&humanized&&brandSettings?.humanized_split_messages!==false&&extraMetadata?.no_split!==true;
  const parts=audioDataUri?[clean]:(canSplit?splitHumanizedMessage(clean):[clean]);

  for(let i=0;i<parts.length;i++){
    const part=parts[i];
    if(!part)continue;
    const since=new Date(Date.now()-90000).toISOString();
    const {data:lastSame}=await db.from("wa_messages")
      .select("id")
      .eq("workspace_id",wid)
      .eq("contact_id",contactId)
      .eq("connection_slot",connectionSlot)
      .eq("direction","out")
      .eq("content",part)
      .gte("created_at",since)
      .order("created_at",{ascending:false})
      .limit(1)
      .maybeSingle();
    if(lastSame?.id)continue;

    const delay=humanized
      ? humanizedDelay(part,brandSettings?.humanized_typing_min_ms,brandSettings?.humanized_typing_max_ms)
      : humanDelay(part);

    const {error}=await db.from("wa_messages").insert({
      workspace_id:wid,conversation_id:cid,contact_id:contactId,connection_slot:connectionSlot,direction:"out",
      sender_type:senderType,content:part,message_type:audioDataUri?"audio":"text",status:"queued",
      metadata:{
        provider:"wuzapi-local",
        to_phone:phone,
        delay_ms:delay,
        connection_slot:connectionSlot,
        humanized,
        audio_reply:!!audioDataUri,
        audio_data_uri:audioDataUri,
        humanized_part:i+1,
        humanized_parts:parts.length,
        ...(extraMetadata||{})
      }
    });
    if(error)throw error;
  }
}

async function parseFormOrJson(req:Request){
  const ct=req.headers.get("content-type")||"";
  const raw=await req.text();
  if(ct.includes("application/x-www-form-urlencoded")){
    const p=new URLSearchParams(raw);
    let d:any={};
    const j=p.get("jsonData");
    if(j){try{d=JSON.parse(j)}catch{}}
    d._userID=p.get("userID")||"";
    d._instanceName=p.get("instanceName")||"";
    return d;
  }
  if(ct.includes("application/json")){
    try{return JSON.parse(raw)}catch{return {}}
  }
  try{return JSON.parse(raw)}catch{return {}}
}

type UniversalTriage = {
  department: "atendimento"|"vendas"|"suporte"|"financeiro"|"compras"|"parcerias";
  priority: "normal"|"alta"|"urgente";
  tags: string[];
  explicitHandoff: boolean;
  summary: string;
};

function classifyUniversalTriage(message:string, previous:any={}):UniversalTriage{
  const raw=String(message||"").replace(/\s+/g," ").trim();
  const t=norm(raw);
  const has=(rx:RegExp)=>rx.test(t);
  let department:UniversalTriage["department"]="atendimento";
  const tags:string[]=[];

  if(has(/\b(distribuidor|fornecedor|representante|responsavel por compras|setor de compras|comprador)\b/)){
    department="compras"; tags.push("compras","b2b");
  }else if(has(/\b(revenda|revendedor|revender|parceria|afiliado|painel de revenda)\b/)){
    department="parcerias"; tags.push("parcerias","revenda");
  }else if(has(/\b(pagamento|paguei|pix|boleto|fatura|cobranca|cobrança|vencimento|reembolso|estorno)\b/)){
    department="financeiro"; tags.push("financeiro");
  }else if(has(/\b(erro|invalida|inválida|nao funciona|não funciona|parou|travando|caiu|offline|configurar|instalar|ativar|senha|login|suporte|ajuda tecnica|ajuda técnica)\b/)){
    department="suporte"; tags.push("suporte");
  }else if(has(/\b(comprar|contratar|preco|preço|valor|orcamento|orçamento|promocao|promoção|novidades|catalogo|catálogo|plano)\b/)){
    department="vendas"; tags.push("vendas");
  }else if(previous?.triage_department){
    const known=["atendimento","vendas","suporte","financeiro","compras","parcerias"];
    if(known.includes(String(previous.triage_department)))department=previous.triage_department;
  }

  const urgent=has(/\b(urgente|emergencia|emergência|agora|imediato|prejuizo|prejuízo|sem funcionar|parado)\b/);
  const dissatisfied=has(/\b(cancelar|reclamacao|reclamação|procon|enganado|absurdo|péssimo|pessimo|raiva)\b/);
  const priority:UniversalTriage["priority"]=urgent&&dissatisfied?"urgente":(urgent||dissatisfied)?"alta":"normal";
  if(urgent)tags.push("urgente");
  if(dissatisfied)tags.push("risco");
  if(has(/\b(cliente|sou cliente|ja sou cliente|já sou cliente)\b/))tags.push("cliente");
  if(has(/\b(foto|imagem|print|video|vídeo|audio|áudio)\b/))tags.push("midia");
  // Pedir "responsável por compras/suporte" indica assunto, não transferência.
  // O bot só entrega a conversa quando o cliente pede claramente uma pessoa humana.
  const explicitHandoff=has(/\b(atendente humano|pessoa real|ser humano|atendimento humano|falar com atendente|falar com uma pessoa|falar com alguem|falar com alguém|quero um atendente|quero uma pessoa)\b/);
  const cleanTags=[...new Set(tags)];
  const summary=("Cliente direcionado para "+department+". Pedido: "+(raw||"mensagem sem texto")).slice(0,500);
  return {department,priority,tags:cleanTags,explicitHandoff,summary};
}


function extractDeviceMacKey(raw:string){
  const s=String(raw||"");
  const macMatch=s.match(/\b(?:MAC(?:\s*ADDRESS)?|ENDERE[CÇ]O\s*MAC)?\s*[:=-]?\s*((?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2})\b/i)
    || s.match(/\b([0-9A-Fa-f]{12})\b/);
  let mac=String(macMatch?.[1]||"").trim().toUpperCase();
  if(mac&&/^[0-9A-F]{12}$/.test(mac))mac=mac.match(/.{2}/g)?.join(":")||mac;

  const keyPatterns=[
    /\b(?:DEVICE\s*KEY|DEVICEKEY|KEY|CHAVE(?:\s+DO\s+APARELHO)?)\s*[:=-]\s*([A-Za-z0-9._-]{4,80})\b/i,
    /\b(?:DEVICE\s*CODE|CODIGO\s+DO\s+APARELHO|CÓDIGO\s+DO\s+APARELHO)\s*[:=-]\s*([A-Za-z0-9._-]{4,80})\b/i
  ];
  let key="";
  for(const re of keyPatterns){
    const m=s.match(re);
    if(m?.[1]){key=String(m[1]).trim();break}
  }
  if(key&&mac&&norm(key)===norm(mac))key="";
  return {mac,key};
}

async function findDeviceActivationApp(workspaceId:string,text:string,context:any={}){
  const {data:apps}=await db.from("wa_app_catalog")
    .select("id,name,aliases,requires_mac_key,activation_driver,activation_url,activation_method")
    .eq("workspace_id",workspaceId).eq("enabled",true).order("name");
  const rows=Array.isArray(apps)?apps:[];
  const t=norm(text);
  const remembered=norm(String(context?.app_name||context?.support_app||context?.device_app||""));

  let app=rows.find((a:any)=>{
    const names=[a.name,...(Array.isArray(a.aliases)?a.aliases:[])].map((x:any)=>norm(String(x||""))).filter(Boolean);
    return names.some((n:string)=>n.length>=3&&t.includes(n));
  })||null;

  if(!app&&remembered){
    app=rows.find((a:any)=>{
      const names=[a.name,...(Array.isArray(a.aliases)?a.aliases:[])].map((x:any)=>norm(String(x||""))).filter(Boolean);
      return names.some((n:string)=>n===remembered||remembered.includes(n)||n.includes(remembered));
    })||null;
  }
  return app;
}

async function handleDeviceMacKey(workspaceId:string,contact:any,conv:any,phone:string,text:string){
  const {data:ws}=await db.from("wa_workspaces").select("tenant_level").eq("id",workspaceId).maybeSingle();
  if(Number(ws?.tenant_level||0)!==0)return null;

  const current=(contact?.bot_context&&typeof contact.bot_context==="object")?contact.bot_context:{};
  const parsed=extractDeviceMacKey(text);
  const mac=parsed.mac||String(current?.pending_device_mac||"").trim();
  const key=parsed.key||String(current?.pending_device_key||"").trim();
  const hasPending=!!(current?.pending_device_mac||current?.pending_device_key);
  if(!parsed.mac&&!parsed.key&&!hasPending)return null;

  const next={...current};
  if(parsed.mac)next.pending_device_mac=parsed.mac;
  if(parsed.key)next.pending_device_key=parsed.key;

  if(!mac||!key){
    await db.from("wa_contacts").update({bot_context:next,updated_at:new Date().toISOString()}).eq("id",contact.id);
    const missing=!mac?"MAC":"Key";
    await queueOut(workspaceId,conv.id,contact.id,phone,"Consegui ler parte dos dados da tela. Falta só a "+missing+"; se ela estiver na foto eu vou tentar ler de novo, senão me manda somente esse dado.","bot");
    return {handled:true,status:"awaiting_mac_key"};
  }

  const app=await findDeviceActivationApp(workspaceId,text,{...next,app_name:contact?.app_name});
  const textNorm=norm(text);
  let appHint=String(app?.name||current?.device_app||contact?.app_name||"").trim();

  // Quando o nome do app veio na legenda/foto e ainda não está no catálogo,
  // guarda o texto mais provável sem obrigar o cliente a repetir.
  if(!appHint){
    if(/\biptv\s*[- ]?\s*4k\b/i.test(text))appHint="IPTV 4K";
    else{
      const hintMatch=text.match(/\b(?:app|aplicativo)?\s*([A-Za-z0-9][A-Za-z0-9 +_.-]{2,35}(?:player|play|iptv|4k)[A-Za-z0-9 +_.-]{0,20})\b/i);
      if(hintMatch?.[1])appHint=String(hintMatch[1]).trim();
    }
  }

  next.pending_device_mac=mac;
  next.pending_device_key=key;
  if(appHint)next.device_app=appHint;

  const {data:account}=await db.from("wa_panel_accounts")
    .select("access_data,username,app_name,connector_id")
    .eq("workspace_id",workspaceId).eq("contact_id",contact.id)
    .order("updated_at",{ascending:false}).limit(1).maybeSingle();
  const access=account?.access_data&&typeof account.access_data==="object"?account.access_data:{};
  const playlist=String(access?.m3u||access?.url||access?.xtream_url||"").trim();

  // Procura parceria real já cadastrada entre app e painel.
  const {data:mappings}=await db.from("wa_panel_app_map")
    .select("id,connector_id,app_catalog_id,app_name,panel_app_code,priority,enabled")
    .eq("workspace_id",workspaceId).eq("enabled",true).order("priority");
  const rows=Array.isArray(mappings)?mappings:[];
  const appNorm=norm(appHint||"");
  const mapping=rows.find((m:any)=>{
    if(app?.id&&m.app_catalog_id===app.id)return true;
    const n=norm(String(m.app_name||""));
    const c=norm(String(m.panel_app_code||""));
    return !!appNorm&&(n===appNorm||n.includes(appNorm)||appNorm.includes(n)||c===appNorm||c.includes(appNorm));
  })||null;

  if(mapping){
    const {data:panel}=await db.from("wa_panel_connectors")
      .select("id,name,enabled,last_status,credential_secret_id")
      .eq("id",mapping.connector_id).eq("workspace_id",workspaceId).maybeSingle();
    const ready=!!(panel?.enabled&&panel?.credential_secret_id&&panel?.last_status==="driver_ready");

    const since=new Date(Date.now()-5*60*1000).toISOString();
    const {data:existing}=await db.from("wa_panel_jobs").select("id,status")
      .eq("workspace_id",workspaceId).eq("contact_id",contact.id)
      .eq("action_type","activate_app").eq("connector_id",mapping.connector_id)
      .gte("created_at",since).in("status",["pending","processing","waiting_setup"]).limit(1).maybeSingle();

    let jobId=existing?.id||null;
    if(!jobId){
      const ins=await db.from("wa_panel_jobs").insert({
        workspace_id:workspaceId,
        contact_id:contact.id,
        conversation_id:conv.id,
        connector_id:mapping.connector_id,
        action_type:"activate_app",
        app_catalog_id:mapping.app_catalog_id||app?.id||null,
        app_name:mapping.app_name||appHint||app?.name||null,
        panel_app_code:mapping.panel_app_code||null,
        device_type:contact?.device_type||"Smart TV",
        customer_name:contact?.name||null,
        customer_phone:phone,
        status:ready?"pending":"waiting_setup",
        payload:{
          mac,device_key:key,playlist_url:playlist,
          app_name:mapping.app_name||appHint||null,
          panel_app_code:mapping.panel_app_code||null,
          source:"whatsapp_image_mac_key_panel_partner"
        }
      }).select("id,status").single();
      if(ins.error)throw ins.error;
      jobId=ins.data?.id||null;
    }

    delete next.pending_device_mac;
    delete next.pending_device_key;
    next.device_config_job_id=jobId;
    next.device_config_status=ready?"queued":"waiting_setup";
    next.device_partner_panel_id=mapping.connector_id;
    await db.from("wa_contacts").update({
      app_name:contact?.app_name||mapping.app_name||appHint||null,
      bot_context:next,
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);

    const reply=ready
      ?"Peguei o MAC e a Key da tela e achei a parceria do "+String(mapping.app_name||appHint||"aplicativo")+" no painel "+String(panel?.name||"")+". Já estou configurando. Assim que concluir eu só vou te pedir pra apertar Recarregar."
      :"Peguei o MAC e a Key e achei a parceria no painel "+String(panel?.name||"")+". A configuração ficou na fila aguardando o acesso automático desse painel.";
    await queueOut(workspaceId,conv.id,contact.id,phone,reply,"bot",{panel_partner:true,panel_job_id:jobId});
    return {handled:true,status:ready?"panel_partner_configuration_queued":"panel_partner_waiting_setup",job_id:jobId};
  }

  // Se ainda não há mapeamento, procura a parceria automaticamente nos painéis cadastrados.
  if(appHint){
    const {data:panels}=await db.from("wa_panel_connectors")
      .select("id,name,enabled,last_status,credential_secret_id")
      .eq("workspace_id",workspaceId).eq("enabled",true).order("name");

    const candidates=(panels||[]).filter((p:any)=>p.credential_secret_id);
    if(candidates.length){
      const searchGroup=crypto.randomUUID();
      for(const p of candidates){
        const ready=p.last_status==="driver_ready";
        await db.from("wa_panel_jobs").insert({
          workspace_id:workspaceId,
          contact_id:contact.id,
          conversation_id:conv.id,
          connector_id:p.id,
          action_type:"scan_apps",
          status:ready?"pending":"waiting_setup",
          customer_name:contact?.name||null,
          customer_phone:phone,
          payload:{
            source:"find_panel_partner_for_device",
            search_group:searchGroup,
            app_hint:appHint,
            pending_activation:{mac,device_key:key,playlist_url:playlist,device_type:contact?.device_type||"Smart TV"}
          }
        });
      }

      next.device_partner_search_group=searchGroup;
      next.device_config_status="searching_partner";
      await db.from("wa_contacts").update({bot_context:next,updated_at:new Date().toISOString()}).eq("id",contact.id);
      await queueOut(workspaceId,conv.id,contact.id,phone,"Peguei o MAC, a Key e o aplicativo "+appHint+". Agora vou localizar em qual painel tem parceria com ele e configurar direto. Você não precisa mandar os dados de novo.","bot");
      return {handled:true,status:"searching_panel_partnership",search_group:searchGroup};
    }
  }

  // Se o app possui ativação própria fora dos painéis, mantém o fluxo já existente.
  if(app&&app.requires_mac_key===true&&app.activation_url&&["api","rpa"].includes(String(app.activation_driver||""))){
    const since=new Date(Date.now()-5*60*1000).toISOString();
    const {data:existing}=await db.from("wa_panel_jobs").select("id,status")
      .eq("workspace_id",workspaceId).eq("contact_id",contact.id)
      .eq("action_type","configure_device").eq("app_catalog_id",app.id)
      .gte("created_at",since).in("status",["pending","processing","waiting_setup"]).limit(1).maybeSingle();

    let jobId=existing?.id||null;
    if(!jobId){
      const ins=await db.from("wa_panel_jobs").insert({
        workspace_id:workspaceId,
        contact_id:contact.id,
        conversation_id:conv.id,
        connector_id:null,
        action_type:"configure_device",
        app_catalog_id:app.id,
        app_name:app.name,
        device_type:contact?.device_type||"Smart TV",
        customer_name:contact?.name||null,
        customer_phone:phone,
        status:"pending",
        payload:{mac,device_key:key,playlist_url:playlist,source:"whatsapp_mac_key"}
      }).select("id").single();
      if(ins.error)throw ins.error;
      jobId=ins.data?.id||null;
    }
    delete next.pending_device_mac;
    delete next.pending_device_key;
    next.device_app=app.name;
    next.device_config_job_id=jobId;
    next.device_config_status="queued";
    await db.from("wa_contacts").update({app_name:contact?.app_name||app.name,bot_context:next,updated_at:new Date().toISOString()}).eq("id",contact.id);
    await queueOut(workspaceId,conv.id,contact.id,phone,"Já peguei os dados da tela e estou configurando o "+app.name+". Assim que concluir eu te aviso para apertar Recarregar.","bot");
    return {handled:true,status:"device_configuration_queued",job_id:jobId};
  }

  await db.from("wa_contacts").update({bot_context:next,updated_at:new Date().toISOString()}).eq("id",contact.id);
  await queueOut(workspaceId,conv.id,contact.id,phone,
    appHint
      ?"Já peguei o MAC e a Key do "+appHint+". Ainda não encontrei uma parceria cadastrada nos painéis disponíveis; vou manter esses dados salvos sem pedir de novo."
      :"Já peguei o MAC e a Key da tela. Não consegui identificar o nome do aplicativo com segurança; vou manter os dados salvos e preciso somente do nome do app.",
    "bot"
  );
  return {handled:true,status:appHint?"partner_not_found":"awaiting_device_app"};
}

async function routeNationalLeadToTenant(masterWid:string,contact:any,conv:any,phone:string,text:string){
  const {data:master}=await db.from("wa_workspaces")
    .select("id,parent_workspace_id,tenant_level")
    .eq("id",masterWid).maybeSingle();
  if(!master||master.parent_workspace_id||Number(master.tenant_level||0)!==0)return null;

  const ctx=(contact?.bot_context&&typeof contact.bot_context==="object")?contact.bot_context:{};
  let isNational=String(contact?.lead_source||"")==="base_nacional";
  if(!isNational){
    const {data:national}=await db.from("wa_national_leads").select("id")
      .eq("workspace_id",masterWid).eq("phone",phone).limit(1).maybeSingle();
    isNational=!!national?.id;
  }
  if(!isNational)return null;

  const {data:workspaces}=await db.from("wa_workspaces")
    .select("id,parent_workspace_id,tenant_level,service_ddds,state_code,onboarding_completed");
  const rows=Array.isArray(workspaces)?workspaces:[];
  const descendants=new Set<string>();
  let changed=true;
  while(changed){
    changed=false;
    for(const w of rows){
      if(descendants.has(w.id))continue;
      if(w.parent_workspace_id===masterWid||descendants.has(String(w.parent_workspace_id||""))){
        descendants.add(w.id);changed=true;
      }
    }
  }
  if(!descendants.size)return null;

  const ddd=phoneDDD(phone);
  const uf=String(contact?.state_code||DDD_UF[ddd]||"").toUpperCase();
  let targetId=String(ctx?.routed_workspace_id||"");
  if(targetId&&!descendants.has(targetId))targetId="";

  const ids=[...descendants];
  const {data:tenantSettings}=await db.from("wa_settings")
    .select("workspace_id,bridge_connected,ai_enabled,company_name,virtual_agent_name")
    .in("workspace_id",ids);
  const settingsMap=new Map((tenantSettings||[]).map((x:any)=>[x.workspace_id,x]));

  if(!targetId){
    const candidates=rows
      .filter((w:any)=>descendants.has(w.id)&&w.onboarding_completed===true&&settingsMap.get(w.id)?.bridge_connected===true)
      .map((w:any)=>{
        const ddds=Array.isArray(w.service_ddds)?w.service_ddds.map((x:any)=>String(x)):[];
        let score=0;
        if(ddd&&ddds.includes(ddd))score+=100;
        if(uf&&String(w.state_code||"").toUpperCase()===uf)score+=40;
        return {w,score};
      })
      .filter((x:any)=>x.score>0)
      .sort((a:any,b:any)=>b.score-a.score||Number(a.w.tenant_level||0)-Number(b.w.tenant_level||0));
    targetId=String(candidates[0]?.w?.id||"");
  }

  if(!targetId)return null;
  const targetSettings=settingsMap.get(targetId);
  if(!targetSettings?.bridge_connected)return null;

  const now=new Date().toISOString();
  const childPayload:any={
    workspace_id:targetId,
    phone,
    name:contact?.name||phone,
    status:"lead",
    bot_enabled:true,
    customer_kind:"lead",
    lead_source:"base_nacional_encaminhado",
    lead_source_at:now,
    city:contact?.city||null,
    state_code:contact?.state_code||uf||null,
    postal_code:contact?.postal_code||null,
    marketing_opt_in:contact?.marketing_opt_in===true,
    marketing_opt_in_at:contact?.marketing_opt_in_at||null,
    marketing_opt_out_at:contact?.marketing_opt_out_at||null,
    marketing_source:contact?.marketing_source||"base_nacional",
    updated_at:now
  };
  const {data:childContact,error:ccErr}=await db.from("wa_contacts")
    .upsert(childPayload,{onConflict:"workspace_id,phone",ignoreDuplicates:false}).select("*").single();
  if(ccErr||!childContact)return null;

  const {data:childConv,error:cvErr}=await db.from("wa_conversations").upsert({
    workspace_id:targetId,contact_id:childContact.id,channel:"whatsapp",connection_slot:1,last_message_at:now
  },{onConflict:"workspace_id,contact_id,channel,connection_slot",ignoreDuplicates:false}).select("*").single();
  if(cvErr||!childConv)return null;

  await db.from("wa_messages").insert({
    workspace_id:targetId,conversation_id:childConv.id,contact_id:childContact.id,connection_slot:1,
    direction:"in",sender_type:"customer",content:String(text||"").trim()||"Lead encaminhado da campanha nacional",
    message_type:"text",status:"received",
    metadata:{source:"master_national_route",master_workspace_id:masterWid,ddd,uf,routed_at:now}
  });

  const childContext={
    ...((childContact.memory_context&&typeof childContact.memory_context==="object")?childContact.memory_context:{}),
    ...((childContact.bot_context&&typeof childContact.bot_context==="object")?childContact.bot_context:{}),
    national_lead:true,origin_workspace_id:masterWid,route_ddd:ddd,route_state:uf
  };
  const reply=await aiFallback(targetId,childConv.id,childContact.id,String(text||""),childContext);
  if(reply)await queueOut(targetId,childConv.id,childContact.id,phone,reply,"ai",{national_route:true,origin_workspace_id:masterWid});

  const nextMasterContext={...ctx,routed_workspace_id:targetId,routed_at:now,route_ddd:ddd,route_state:uf};
  await db.from("wa_contacts").update({bot_context:nextMasterContext,updated_at:now}).eq("id",contact.id).eq("workspace_id",masterWid);
  await db.from("wa_national_leads").update({assigned_workspace_id:targetId,status:"encaminhado",updated_at:now})
    .eq("workspace_id",masterWid).eq("phone",phone);

  return {handled:true,target_workspace_id:targetId,ddd,uf};
}

Deno.serve(async req=>{ try {
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);

  const payload=await parseFormOrJson(req);
  const url=new URL(req.url);
  const querySig=String(url.searchParams.get("token")||"");
  const headerToken=String(req.headers.get("token")||req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const userID=String(payload?._userID||payload?.userID||"");
  const instanceName=String(payload?._instanceName||payload?.instanceName||"");

  let config:any=null;
  async function configBySig(sig:string){
    const {data:main}=await db.from("wa_bridge_configs")
      .select("workspace_id,provider,instance_name,external_user_id")
      .in("provider",["wuzapi-local","wuzapi-hosted"]).eq("agent_token_hash",sig).maybeSingle();
    if(main)return {...main,connection_slot:1};
    const {data:extra}=await db.from("wa_extra_bridge_configs")
      .select("workspace_id,connection_slot,provider,instance_name,external_user_id")
      .eq("provider","wuzapi-hosted").eq("agent_token_hash",sig).maybeSingle();
    return extra||null;
  }
  if(querySig){
    config=await configBySig(querySig);
  }else if(headerToken){
    const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(headerToken));
    const h=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
    config=await configBySig(h);
  }

  if(!config)return json({error:"unauthorized"},401);
  if(config.external_user_id && userID && config.external_user_id!==userID)return json({error:"unauthorized_user"},401);
  if(config.instance_name && instanceName && norm(config.instance_name)!==norm(instanceName))return json({error:"unauthorized_instance"},401);

  const wid=config.workspace_id;
  const connectionSlot=Number(config.connection_slot||1);
  const [{data:runtimeSettings},{data:runtimeWorkspace}]=await Promise.all([
    db.from("wa_settings")
      .select("company_name,virtual_agent_name,welcome_message")
      .eq("workspace_id",wid).maybeSingle(),
    db.from("wa_workspaces")
      .select("tenant_level,parent_workspace_id")
      .eq("id",wid).maybeSingle()
  ]);
  const childTenant=Number(runtimeWorkspace?.tenant_level||0)>0||!!runtimeWorkspace?.parent_workspace_id;
  const runtimeCompany=String(runtimeSettings?.company_name||(childTenant?"":"JSTech")).trim();
  const runtimeAgent=String(runtimeSettings?.virtual_agent_name||(childTenant?"":"Ana")).trim();
  let runtimeWelcome=String(runtimeSettings?.welcome_message||"Olá! Como posso ajudar?")
    .replace(/\{\{atendente\}\}/g,runtimeAgent)
    .replace(/\{\{empresa\}\}/g,runtimeCompany);
  runtimeWelcome=runtimeWelcome
    .replace(/\bme chamo\s*[.,!]?\s*(?=como|posso|$)/i,"")
    .replace(/\s{2,}/g," ")
    .trim();
  const eventName=typeof payload?.event==="string" ? payload.event : String(payload?.type||payload?.Event||"");
  const eventNorm=norm(eventName);
  const nowIso=new Date().toISOString();

  if(connectionSlot===1){
    await db.from("wa_bridge_configs").update({
      agent_last_seen:nowIso,last_status:eventName||"online",updated_at:nowIso
    }).eq("workspace_id",wid);
  }else{
    await db.from("wa_extra_bridge_configs").update({
      agent_last_seen:nowIso,last_status:eventName||"online",updated_at:nowIso
    }).eq("workspace_id",wid).eq("connection_slot",connectionSlot);
  }

  if(["connected","keepaliverestored"].includes(eventNorm)){
    if(connectionSlot===1){
      await db.from("wa_settings").update({bridge_connected:true,updated_at:nowIso}).eq("workspace_id",wid);
    }else{
      await db.from("wa_extra_bridge_configs").update({
        last_status:"connected",provision_status:"connected",qr_code:null,qr_expires_at:null,updated_at:nowIso
      }).eq("workspace_id",wid).eq("connection_slot",connectionSlot);
    }
    return json({ok:true,connection_slot:connectionSlot});
  }
  if(["disconnected","loggedout","connectfailure","keepalivetimeout","temporaryban"].includes(eventNorm)){
    if(connectionSlot===1){
      await db.from("wa_settings").update({bridge_connected:false,updated_at:nowIso}).eq("workspace_id",wid);
    }else{
      await db.from("wa_extra_bridge_configs").update({
        last_status:eventNorm||"disconnected",updated_at:nowIso
      }).eq("workspace_id",wid).eq("connection_slot",connectionSlot);
    }
    return json({ok:true,connection_slot:connectionSlot});
  }

  if(eventNorm==="calloffer"){
    const ev=(payload?.event&&typeof payload.event==="object")?payload.event:(payload?.data||payload);
    const callId=String(ev?.CallID??ev?.call_id??ev?.callId??"").trim();
    const from=jidString(ev?.CallCreator)||jidString(ev?.CallCreatorAlt)||jidString(ev?.From)||String(ev?.call_from??ev?.from??"").trim();
    const phone=digits(cleanJid(from));

    if(callId&&from){
      const {data:existing}=await db.from("wa_bridge_commands")
        .select("id").eq("workspace_id",wid).eq("connection_slot",connectionSlot).eq("action","reject_call")
        .contains("payload",{call_id:callId}).limit(1);
      if(!(existing||[]).length){
        await db.from("wa_bridge_commands").insert({
          workspace_id:wid,
          connection_slot:connectionSlot,
          action:"reject_call",
          payload:{call_from:from,call_id:callId,phone},
          status:"queued"
        });

        if(phone){
          let {data:ct}=await db.from("wa_contacts")
            .select("*").eq("workspace_id",wid).eq("phone",phone).maybeSingle();
          if(!ct){
            const ins=await db.from("wa_contacts").insert({
              workspace_id:wid,phone,updated_at:new Date().toISOString()
            }).select("*").single();
            ct=ins.data;
          }
          if(ct){
            const convRes=await db.from("wa_conversations").upsert({
              workspace_id:wid,contact_id:ct.id,channel:"whatsapp",connection_slot:connectionSlot,last_message_at:new Date().toISOString()
            },{onConflict:"workspace_id,contact_id,channel,connection_slot",ignoreDuplicates:false}).select("*").single();
            const conv=convRes.data;
            if(conv){
              await queueOut(
                wid,conv.id,ct.id,phone,
                " A JSTech não atende ligações pelo WhatsApp. Nosso atendimento é somente por mensagens.\n\n Horário normal: das 08:00 às 18:00.\n\nPode escrever o que precisa por aqui. Se for algo realmente urgente e estiver fora do horário, tentaremos atender se houver alguém disponível, mas não conseguimos garantir resposta imediata.",
                "bot"
              );
            }
          }
        }
      }
    }
    return json({ok:true,call_reject_queued:!!(callId&&from)});
  }

  if(eventNorm!=="message")return json({ok:true,ignored:true});

  const data=(payload?.event&&typeof payload.event==="object")?payload.event:(payload?.data||payload);
  const info=data?.Info||{};

  if(data?.Info?.IsFromMe===true||data?.fromMe===true){
    const outChat=String(info?.Chat||data?.chat||data?.key?.remoteJid||"");
    const outText=extractText(data);
    const outExternalId=String(info?.ID||data?.id||data?.key?.id||"")||null;
    const outMedia=incomingMedia(payload,data);

    // Qualquer áudio enviado pelo próprio dono desta conta pode virar a amostra
    // da voz desta conta. Nunca usa voice_id de pai, filho ou outra revenda.
    if(outMedia?.kind==="audio"){
      if(!outMedia?.base64){
        const rawMsg=data?.Message||data?.message||{};
        const node=rawMsg?.audioMessage||null;
        const downloadBody=node?{
          Url:String(node?.URL??node?.Url??node?.url??""),
          Mimetype:String(node?.mimetype??node?.Mimetype??outMedia?.mime??""),
          FileSHA256:String(node?.fileSHA256??node?.FileSHA256??node?.fileSha256??""),
          FileLength:Number(node?.fileLength??node?.FileLength??0),
          MediaKey:String(node?.mediaKey??node?.MediaKey??""),
          FileEncSHA256:String(node?.fileEncSHA256??node?.FileEncSHA256??node?.fileEncSha256??"")
        }:null;
        if(downloadBody?.Url&&downloadBody?.MediaKey&&downloadBody?.FileSHA256&&downloadBody?.FileLength){
          const {data:existing}=await db.from("wa_bridge_commands")
            .select("id").eq("workspace_id",wid).eq("connection_slot",connectionSlot)
            .eq("action","download_media")
            .contains("payload",{external_message_id:outExternalId,owner_voice_sample:true})
            .in("status",["queued","processing","done"]).limit(1).maybeSingle();
          if(!existing?.id){
            await db.from("wa_bridge_commands").insert({
              workspace_id:wid,connection_slot:connectionSlot,action:"download_media",status:"queued",
              payload:{
                kind:"audio",
                chat:outChat,
                sender:String(info?.Sender||""),
                recipient:String(info?.Recipient||info?.RecipientAlt||outChat||""),
                external_message_id:outExternalId,
                profile_name:String(info?.PushName||""),
                mime:outMedia?.mime||downloadBody.Mimetype||null,
                file_name:outMedia?.fileName||null,
                caption:"",
                from_me:true,
                owner_voice_sample:true,
                download_body:downloadBody
              }
            });
          }
          return json({ok:true,owner_voice_download_queued:true});
        }
      }else{
        await captureTenantOwnerVoice(wid,outMedia,outExternalId);
      }
    }

    let targetContact:any=null;
    let targetConv:any=null;

    const recipientCandidates=[
      String(info?.RecipientAlt||""),
      String(info?.Recipient||""),
      String(data?.recipient||""),
      String(outChat||"")
    ].filter(Boolean);
    let remotePhone="";
    for(const cand of recipientCandidates){
      if(/@s\.whatsapp\.net$|@c\.us$/i.test(cand)){
        remotePhone=digits(cleanJid(cand));
        if(remotePhone)break;
      }
    }

    if(remotePhone){
      const {data:ct}=await db.from("wa_contacts").select("*").eq("workspace_id",wid).eq("phone",remotePhone).maybeSingle();
      targetContact=ct;
    }

    if(!targetContact && outChat){
      const {data:known}=await db.from("wa_messages")
        .select("contact_id,conversation_id")
        .eq("workspace_id",wid)
        .eq("connection_slot",connectionSlot)
        .eq("metadata->>chat",outChat)
        .order("created_at",{ascending:false})
        .limit(1)
        .maybeSingle();
      if(known?.contact_id){
        const {data:ct}=await db.from("wa_contacts").select("*").eq("id",known.contact_id).maybeSingle();
        targetContact=ct;
        targetConv={id:known.conversation_id};
      }
    }

    if(!targetContact)return json({ok:true,ignored:"from_me_unmapped"});

    if(!targetConv){
      const {data:cv}=await db.from("wa_conversations").select("*")
        .eq("workspace_id",wid).eq("contact_id",targetContact.id).eq("connection_slot",connectionSlot)
        .order("last_message_at",{ascending:false}).limit(1).maybeSingle();
      targetConv=cv;
    }

    if(outText){
      const since=new Date(Date.now()-120000).toISOString();
      const {data:botEcho}=await db.from("wa_messages").select("id")
        .eq("workspace_id",wid).eq("contact_id",targetContact.id).eq("connection_slot",connectionSlot).eq("direction","out")
        .in("sender_type",["bot","ai","campaign"])
        .eq("content",professionalText(outText,"bot"))
        .gte("created_at",since)
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(botEcho?.id)return json({ok:true,ignored:"bot_echo"});
    }

    const until=new Date(Date.now()+3*60*1000).toISOString();
    const prev={
      ...((targetContact.memory_context&&typeof targetContact.memory_context==="object")?targetContact.memory_context:{}),
      ...((targetContact.bot_context&&typeof targetContact.bot_context==="object")?targetContact.bot_context:{})
    };
    const nextContext={...prev,human_takeover_until:until,manual_pause:false};

    if(targetConv?.id && (outText||outMedia?.kind)){
      const manualContent=outText||("["+String(outMedia?.kind||"midia")+" enviado pelo atendente]");
      await db.from("wa_messages").insert({
        workspace_id:wid,conversation_id:targetConv.id,contact_id:targetContact.id,connection_slot:connectionSlot,direction:"out",
        sender_type:"human",content:manualContent,message_type:outMedia?.kind||"text",
        external_message_id:outExternalId,status:"sent",
        metadata:{provider:"whatsapp-native",chat:outChat,manual_native:true,connection_slot:connectionSlot}
      }).then(()=>{}).catch(()=>{});
      if(outText){
        await saveHumanSupportLearning(wid,targetContact.id,targetConv.id,outText);
      }
    }

    await db.from("wa_contacts").update({
      bot_enabled:false,bot_context:nextContext,updated_at:new Date().toISOString()
    }).eq("id",targetContact.id);

    if(targetConv?.id){
      await db.from("wa_conversations").update({status:"em_atendimento"}).eq("id",targetConv.id);
    }

    return json({ok:true,human_native_takeover:true,paused_until:until});
  }

  const chat=String(info?.Chat||data?.chat||data?.key?.remoteJid||"");
  if(info?.IsGroup===true||/@g\.us$/i.test(chat))return json({ok:true,ignored:"group_for_now"});
  if(/@(newsletter|broadcast)$/i.test(chat)||/status@broadcast$/i.test(chat))return json({ok:true,ignored:"broadcast"});

  const senderMain=jidString(info?.Sender)||String(data?.sender||"");
  const senderAlt=jidString(info?.SenderAlt);
  const chatJid=jidString(chat)||chat;
  const isPhoneJid=(v:string)=>/@s\.whatsapp\.net$/i.test(String(v||""))||/@c\.us$/i.test(String(v||""));
  const sender=String(
    (isPhoneJid(senderMain)&&senderMain) ||
    (isPhoneJid(senderAlt)&&senderAlt) ||
    (isPhoneJid(chatJid)&&chatJid) ||
    senderMain || senderAlt || chatJid
  );
  const phone=digits(cleanJid(sender||chat));
  let text=extractText(data);
  const media=incomingMedia(payload,data);
  if(!phone||(!text&&!media?.base64))return json({ok:true,ignored:"empty"});

  let mediaTranscript="";
  if(!text&&media?.base64&&media?.kind==="audio"){
    mediaTranscript=await transcribeTenantCustomerAudio(wid,media.base64,media.mime,media.fileName);
    if(!mediaTranscript)mediaTranscript=await transcribeSupportMedia(media.base64,media.mime,media.fileName);
  }else if(!text&&media?.base64&&media?.kind==="video"){
    mediaTranscript=await transcribeSupportMedia(media.base64,media.mime,media.fileName);
  }
  let imageAnalysis:any=null;
  let imageContext="";
  if(media?.base64&&media?.kind==="image"){
    imageAnalysis=await analyzeSupportImage(media.base64,media.mime,media.fileName||"");
    imageContext=imageAnalysisText(imageAnalysis);
    const localOcr=String(media?.ocrText||"").trim();
    if(localOcr){
      imageContext=[imageContext,"Texto visível lido na imagem: "+localOcr].filter(Boolean).join(". ").slice(0,5000);
    }
  }
  const incomingText=media?.kind==="image"
    ? ([text,imageContext?("Conteúdo da imagem: "+imageContext):""].filter(Boolean).join("\n\n")||"Imagem recebida")
    : (text||mediaTranscript||(media?.kind==="audio"?"Áudio recebido":media?.kind==="document"?"Arquivo recebido":"Mídia recebida"));
  if((!text&&mediaTranscript)||media?.kind==="image")text=incomingText;

  const externalId=String(info?.ID||data?.id||data?.key?.id||"")||null;
  const profileName=String(info?.PushName||data?.pushName||"").trim()||null;

  const contactPayload:any={workspace_id:wid,phone,updated_at:new Date().toISOString()};
  if(profileName)contactPayload.name=profileName;
  const {data:contact,error:ce}=await db.from("wa_contacts").upsert(
    contactPayload,
    {onConflict:"workspace_id,phone",ignoreDuplicates:false}
  ).select("*").single();
  if(ce||!contact)throw ce||new Error("contact_failed");

  // Memória durável: dados importantes sobrevivem a troca de fluxo, atendimento humano,
  // reativação da IA, "oi/bom dia" e qualquer reset do estado temporário.
  contact.bot_context={
    ...((contact.memory_context&&typeof contact.memory_context==="object")?contact.memory_context:{}),
    ...((contact.bot_context&&typeof contact.bot_context==="object")?contact.bot_context:{})
  };

  const explicitScreens=parseRequestedScreens(text);
  if(explicitScreens){
    await db.from("wa_contacts").update({
      requested_screens:explicitScreens,updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    contact.requested_screens=explicitScreens;
  }

  const explicitDevice=detectDeviceFromText(text);
  if(explicitDevice){
    const nextBot={...((contact.bot_context&&typeof contact.bot_context==="object")?contact.bot_context:{}),tv_brand:explicitDevice,trial_device:explicitDevice};
    const nextMem={...((contact.memory_context&&typeof contact.memory_context==="object")?contact.memory_context:{}),tv_brand:explicitDevice,trial_device:explicitDevice};
    await db.from("wa_contacts").update({
      device_type:explicitDevice,
      bot_context:nextBot,
      memory_context:nextMem,
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    contact.device_type=explicitDevice;
    contact.bot_context=nextBot;
    contact.memory_context=nextMem;
  }

  const {data:conv,error:cve}=await db.from("wa_conversations").upsert({
    workspace_id:wid,contact_id:contact.id,channel:"whatsapp",connection_slot:connectionSlot,last_message_at:new Date().toISOString()
  },{onConflict:"workspace_id,contact_id,channel,connection_slot",ignoreDuplicates:false}).select("*").single();
  if(cve||!conv)throw cve||new Error("conversation_failed");

  // WuzAPI entrega primeiro os metadados da mídia. Baixa o arquivo antes de responder,
  // para foto/áudio/vídeo serem realmente entendidos e não caírem em resposta genérica.
  if(media?.kind&&!media?.base64){
    const rawMsg=data?.Message||data?.message||{};
    const node=
      media.kind==="image"?rawMsg?.imageMessage:
      media.kind==="audio"?rawMsg?.audioMessage:
      media.kind==="video"?rawMsg?.videoMessage:
      media.kind==="document"?rawMsg?.documentMessage:null;

    const downloadBody=node?{
      Url:String(node?.URL??node?.Url??node?.url??""),
      Mimetype:String(node?.mimetype??node?.Mimetype??media?.mime??""),
      FileSHA256:String(node?.fileSHA256??node?.FileSHA256??node?.fileSha256??""),
      FileLength:Number(node?.fileLength??node?.FileLength??0),
      MediaKey:String(node?.mediaKey??node?.MediaKey??""),
      FileEncSHA256:String(node?.fileEncSHA256??node?.FileEncSHA256??node?.fileEncSha256??"")
    }:null;

    if(downloadBody?.Url&&downloadBody?.MediaKey&&downloadBody?.FileSHA256&&downloadBody?.FileLength){
      const since=new Date(Date.now()-2*60*1000).toISOString();
      const {data:existingDownload}=await db.from("wa_bridge_commands")
        .select("id,status")
        .eq("workspace_id",wid)
        .eq("connection_slot",connectionSlot)
        .eq("action","download_media")
        .contains("payload",{external_message_id:externalId})
        .gte("created_at",since)
        .in("status",["queued","processing","done"])
        .limit(1)
        .maybeSingle();

      if(!existingDownload?.id){
        await db.from("wa_bridge_commands").insert({
          workspace_id:wid,
          connection_slot:connectionSlot,
          action:"download_media",
          status:"queued",
          payload:{
            kind:media.kind,
            chat,
            sender,
            external_message_id:externalId,
            profile_name:profileName,
            mime:media.mime||downloadBody.Mimetype||null,
            file_name:media.fileName||null,
            caption:String(text||"").trim(),
            download_body:downloadBody
          }
        });
      }
      return json({ok:true,media_download_queued:true,kind:media.kind});
    }
  }

  if((incomingText==="Mídia recebida"||incomingText==="Áudio recebido") && !media?.base64){
    const since=new Date(Date.now()-4000).toISOString();
    const {data:recentMedia}=await db.from("wa_messages")
      .select("id,content")
      .eq("workspace_id",wid)
      .eq("contact_id",contact.id)
      .eq("connection_slot",connectionSlot)
      .eq("direction","in")
      .in("content",["Mídia recebida","Áudio recebido"])
      .gte("created_at",since)
      .order("created_at",{ascending:false})
      .limit(1)
      .maybeSingle();
    if(recentMedia?.id)return json({ok:true,duplicate_media_event:true});
  }

  const incomingMetadata={
    provider:"wuzapi-local",chat,sender,
    mime_type:media?.mime||null,file_name:media?.fileName||null,
    has_media:!!media?.base64,transcribed:!!mediaTranscript,
    image_analyzed:!!imageContext,image_type:imageAnalysis?.image_type||null,
    ocr_text:media?.ocrText||null,
    connection_slot:connectionSlot
  };
  const {error:me}=await db.from("wa_messages").insert({
    workspace_id:wid,conversation_id:conv.id,contact_id:contact.id,connection_slot:connectionSlot,direction:"in",
    sender_type:"customer",content:incomingText,message_type:media?.kind||"text",external_message_id:externalId,
    status:"received",metadata:incomingMetadata
  });
  if(me&&String(me.code)==="23505"){
    if(media?.base64&&externalId){
      const {data:oldMsg}=await db.from("wa_messages")
        .select("id,metadata")
        .eq("workspace_id",wid)
        .eq("external_message_id",externalId)
        .maybeSingle();
      if(oldMsg?.id){
        await db.from("wa_messages").update({
          content:incomingText,
          message_type:media?.kind||"text",
          metadata:{...(oldMsg.metadata||{}),...incomingMetadata,reprocessed_media:true}
        }).eq("id",oldMsg.id);
      }
    }else{
      return json({ok:true,duplicate:true});
    }
  }else if(me)throw me;

  const confirmNorm=norm(incomingText);
  if(/\b(funcionou|deu certo|resolveu|agora foi|agora abriu|voltou|ficou bom|esta bom|está bom|perfeito agora)\b/.test(confirmNorm)){
    const {data:lastLearning}=await db.from("wa_support_learnings")
      .select("id,success_count")
      .eq("workspace_id",wid)
      .eq("conversation_id",conv.id)
      .eq("enabled",true)
      .order("created_at",{ascending:false})
      .limit(1).maybeSingle();
    if(lastLearning?.id){
      await db.from("wa_support_learnings").update({
        success_count:Number(lastLearning.success_count||0)+1,
        updated_at:new Date().toISOString()
      }).eq("id",lastLearning.id);
    }
  }

  try{
    await db.from("wa_bridge_commands").insert({
      workspace_id:wid,
      connection_slot:connectionSlot,
      action:"typing",
      payload:{phone,seconds:12},
      status:"queued"
    });
  }catch{}

  await db.from("wa_conversations").update({
    unread_count:(conv.unread_count||0)+1,last_message_at:new Date().toISOString()
  }).eq("id",conv.id);

  if(imageAnalysis&&media?.kind==="image"){
    const detectedApp=String(imageAnalysis?.app_or_device||"").trim();
    const detectedBrand=String(imageAnalysis?.tv_brand||"").trim();
    const detectedDevice=String(imageAnalysis?.device_type||detectedBrand||"").trim();
    const patch:any={updated_at:new Date().toISOString()};
    const nextCtx={...((contact.bot_context&&typeof contact.bot_context==="object")?contact.bot_context:{})};
    const nextMem={...((contact.memory_context&&typeof contact.memory_context==="object")?contact.memory_context:{})};

    if(detectedApp){
      patch.app_name=detectedApp;
      nextCtx.support_app=detectedApp;
      nextCtx.device_app=detectedApp;
      nextMem.support_app=detectedApp;
      nextMem.device_app=detectedApp;
      contact.app_name=detectedApp;
    }
    if(detectedDevice){
      patch.device_type=detectedDevice;
      nextCtx.tv_brand=detectedBrand||detectedDevice;
      nextCtx.trial_device=detectedDevice;
      nextMem.tv_brand=detectedBrand||detectedDevice;
      nextMem.trial_device=detectedDevice;
      contact.device_type=detectedDevice;
    }
    if(detectedApp||detectedDevice){
      patch.bot_context=nextCtx;
      patch.memory_context=nextMem;
      await db.from("wa_contacts").update(patch).eq("id",contact.id);
      contact.bot_context=nextCtx;
      contact.memory_context=nextMem;
    }
  }

  const receiptResult=await handlePaymentReceipt(wid,contact,conv,phone,externalId,media,text,null);
  if(receiptResult?.handled)return json({ok:true,payment_receipt:receiptResult.status});

  const deviceResult=await handleDeviceMacKey(wid,contact,conv,phone,incomingText);
  if(deviceResult?.handled)return json({ok:true,device_configuration:deviceResult});

  // Foto, áudio e vídeo precisam ser entendidos antes dos fluxos comerciais antigos.
  // Isso impede que uma mídia seja tratada como nome do cliente ou pedido de orçamento.
  const richMedia=media?.kind==="image"||media?.kind==="audio"||media?.kind==="video";
  if(richMedia){
    const cleanContext={
      ...(contact.bot_context||{}),
      awaiting_quote_name:false,
      awaiting_quote_service:false,
      quote_pending_text:null,
      quote_customer_name:null
    };

    if(media?.kind==="audio"&&!mediaTranscript){
      await db.from("wa_contacts").update({bot_context:cleanContext,updated_at:new Date().toISOString()}).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"Não consegui transcrever este áudio com segurança. Pode reenviar em um áudio mais curto ou escrever a parte principal? Vou continuar pelo assunto desta conversa, sem abrir orçamento.","bot");
      return json({ok:true,queued:true,audio_transcription_failed:true});
    }

    if(media?.kind==="image"&&!imageContext){
      const priorApp=String(cleanContext?.support_app||contact?.app_name||"").trim();
      const priorSummary=String(cleanContext?.support_summary||cleanContext?.triage_summary||"").trim();
      const testPhotoContext=/\b(teste|testar|mac|key|ativar|ativacao|ativação|configurar)\b/.test(norm(priorSummary+" "+String(cleanContext?.node||"")+" "+priorApp));
      const fallbackReply=testPhotoContext
        ? "Recebi a foto, mas não consegui ler o MAC e a Key com segurança. Me manda uma foto mais nítida mostrando esses dois dados e eu continuo daqui sem pedir o restante de novo."
        : (priorApp||priorSummary
          ? "Recebi a foto e vou continuar pelo assunto que você já explicou"+(priorApp?" no "+priorApp:"")+". Não consegui ler os dados da tela com segurança; me manda uma foto mais nítida da mensagem ou dos dados que aparecem nela."
          : "Recebi a foto, mas não consegui ler os dados da tela com segurança. Me manda uma foto mais nítida mostrando a parte que você quer que eu confira.");
      await db.from("wa_contacts").update({
        bot_context:{...cleanContext,node:testPhotoContext?"trial_iptv_app":"support",support_stage:"image_read_retry"},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,fallbackReply,"bot");
      return json({ok:true,queued:true,image_analysis_fallback:true,test_photo_context:testPhotoContext});
    }

    let mediaReply="";

    // Se já existe suporte em andamento, a mídia continua exatamente daquele ponto
    // antes de qualquer chamada de IA. Isso evita "Recebi o arquivo..." genérico.
    const mediaSupportActive=!!String(cleanContext?.support_stage||"").trim()
      || !!String(cleanContext?.support_summary||"").trim()
      || !!String(cleanContext?.support_app||"").trim()
      || cleanContext?.node==="support";
    if(mediaSupportActive){
      const mediaBrain=await supportConversationBrain(conv.id,incomingText,cleanContext);
      if(mediaBrain?.reply){
        const nextMediaContext={
          ...cleanContext,
          node:"support",
          support_app:mediaBrain.app||cleanContext?.support_app||"",
          support_stage:mediaBrain.nextStage||cleanContext?.support_stage||"collecting_problem",
          support_summary:mediaBrain.summary||cleanContext?.support_summary||String(incomingText||"").trim(),
          turn:Number(cleanContext?.turn||0)+1
        };
        await db.from("wa_contacts").update({
          bot_context:nextMediaContext,
          memory_context:{...((contact.memory_context&&typeof contact.memory_context==="object")?contact.memory_context:{}),last_media_summary:incomingText.slice(0,3000)},
          updated_at:new Date().toISOString()
        }).eq("id",contact.id);
        await queueOut(wid,conv.id,contact.id,phone,mediaBrain.reply,"bot",{
          media_support_continuation:true,
          support_stage:mediaBrain.nextStage||null,
          media_kind:media?.kind||null
        });
        return json({ok:true,queued:true,media_support_continuation:true,support_stage:mediaBrain.nextStage||null});
      }
    }

    const awaitingInvalidMedia=cleanContext?.node==="awaiting_app_invalid_media";
    if(awaitingInvalidMedia){
      const appName=String(cleanContext?.app_name||imageAnalysis?.app_or_device||"aplicativo").trim();
      const evidence=imageContext||mediaTranscript||text||"";
      mediaReply=await aiFallback(
        wid,conv.id,contact.id,
        "O cliente informou que a conta aparece como inválida no "+appName+". Analise a mídia recebida e responda somente com base no que estiver visível ou falado. Não peça novamente qual é o problema. Conteúdo da mídia: "+evidence,
        {...cleanContext,issue:"account_invalid",app_name:appName}
      );
      if(!mediaReply){
        mediaReply=media?.kind==="image"
          ? "Recebi e analisei a foto do "+appName+". "+(imageContext||"A tela não ficou legível o suficiente.")+" Se os dados estiverem corretos e ainda aparecer conta inválida, vou conferir o cadastro desse acesso."
          : "Recebi o vídeo do "+appName+". "+(mediaTranscript?"Entendi o que foi falado: "+mediaTranscript:"Não consegui identificar os detalhes da tela com segurança. Envie uma foto parada mostrando a mensagem completa.");
      }
    }else{
      mediaReply=await aiFallback(wid,conv.id,contact.id,incomingText,cleanContext);
    }
    const mediaNorm=norm(incomingText);
    if(!mediaReply&&media?.kind==="image"&&/\b(et player|player-xp|p2p)\b/.test(mediaNorm)){
      mediaReply="Entendi. A imagem mostra o ET PLAYER-XP com dados de acesso P2P. Vou tratar isso como suporte do aplicativo e não como IPTV por lista nem como pedido de orçamento. Me diga agora o que acontece ao tentar entrar: aparece erro, fica carregando ou volta para a tela de login?";
    }
    if(!mediaReply&&media?.kind==="audio"){
      mediaReply=supportFallbackReply(mediaTranscript,cleanContext)||naturalFallback(mediaTranscript,cleanContext);
    }
    if(!mediaReply){
      mediaReply=supportFallbackReply(incomingText,cleanContext)
        || naturalFallback(incomingText,{...cleanContext,company_name:runtimeCompany,agent_name:runtimeAgent});
    }

    await db.from("wa_contacts").update({
      bot_context:{...cleanContext,node:cleanContext?.node==="awaiting_app_invalid_media"?"app_invalid_under_review":"welcome",turn:Number(cleanContext?.turn||0)+1},
      memory_context:{...((contact.memory_context&&typeof contact.memory_context==="object")?contact.memory_context:{}),last_media_summary:incomingText.slice(0,3000)},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,mediaReply,"ai");
    return json({ok:true,queued:true,media_understood:true,kind:media.kind});
  }

  const sourceMatch=text.match(/\borigem=([a-z0-9_-]{2,40})/i);
  if(sourceMatch && !contact.lead_source){
    await db.from("wa_contacts").update({
      lead_source:sourceMatch[1].toLowerCase(),
      lead_source_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    contact.lead_source=sourceMatch[1].toLowerCase();
  }

  if(sourceMatch){
    await db.from("wa_lead_followups").upsert({
      workspace_id:wid,
      contact_id:contact.id,
      conversation_id:conv.id,
      lead_source:sourceMatch[1].toLowerCase(),
      initial_message_at:new Date().toISOString(),
      stage:0,
      status:"pending",
      next_followup_at:new Date(Date.now()+2*60*60*1000).toISOString(),
      updated_at:new Date().toISOString()
    },{onConflict:"workspace_id,contact_id",ignoreDuplicates:false});
  }else if(contact.lead_source){
    await db.from("wa_lead_followups").update({
      status:"engaged",
      updated_at:new Date().toISOString()
    }).eq("workspace_id",wid).eq("contact_id",contact.id).eq("status","pending");
  }

  // Pedido direto de link de aplicativo: usa somente o catálogo real desta conta.
  const appLinkRequest=/\b(link|baixar|download|site|onde baixo|onde baixar)\b/.test(norm(incomingText));
  if(appLinkRequest){
    const requestedNorm=norm(incomingText);
    const {data:catalogApps}=await db.from("wa_app_catalog")
      .select("id,name,aliases,platforms,action_url,action_kind,notes,enabled")
      .eq("workspace_id",wid)
      .eq("enabled",true)
      .order("name");
    const match=(catalogApps||[]).find((a:any)=>{
      const names=[String(a?.name||""),...((Array.isArray(a?.aliases)?a.aliases:[]).map((x:any)=>String(x||"")))];
      return names.some((n:string)=>{
        const nn=norm(n);
        if(!nn)return false;
        return requestedNorm.includes(nn) || (nn.includes("xcloud")&&/\bxclo?u?d\b/.test(requestedNorm));
      });
    });
    if(match){
      const url=String(match.action_url||"").trim();
      if(url){
        const platforms=Array.isArray(match.platforms)&&match.platforms.length
          ?" Funciona em "+match.platforms.join(", ")+"."
          :"";
        const reply="Claro! O link do "+String(match.name||"aplicativo")+" é: "+url+platforms;
        await queueOut(wid,conv.id,contact.id,phone,reply,"bot",{app_catalog_id:match.id,app_link:true,verified_catalog:true});
        return json({ok:true,queued:true,app_link:true,app_catalog_id:match.id});
      }
      await queueOut(wid,conv.id,contact.id,phone,"Tenho esse aplicativo cadastrado, mas o link ainda não está salvo no catálogo desta conta. Não vou inventar um link.","bot",{app_catalog_id:match.id,app_link_missing:true});
      return json({ok:true,queued:true,app_link_missing:true,app_catalog_id:match.id});
    }
  }

  const marketingCmd=norm(text);

  // Uma entrada QUERO com origem identificada é consentimento ativo para
  // continuar a conversa e receber ofertas deste mesmo workspace.
  if(sourceMatch && /^quero\b/.test(marketingCmd)){
    const consentAt=new Date().toISOString();
    await db.from("wa_contacts").update({
      marketing_opt_in:true,
      marketing_opt_in_at:consentAt,
      marketing_opt_out_at:null,
      marketing_source:"cta_"+sourceMatch[1].toLowerCase(),
      updated_at:consentAt
    }).eq("id",contact.id);
    contact.marketing_opt_in=true;
    contact.marketing_opt_in_at=consentAt;
    contact.marketing_opt_out_at=null;
    contact.marketing_source="cta_"+sourceMatch[1].toLowerCase();
  }

  if(/^(sair|parar|cancelar ofertas|nao quero ofertas|não quero ofertas|remover ofertas)$/.test(marketingCmd)){
    await db.from("wa_contacts").update({
      marketing_opt_in:false,
      marketing_opt_out_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,"Certo  Você não vai mais receber ofertas da JSTech por aqui.","bot");
    return json({ok:true,marketing_opt_out:true});
  }

  const nationalRoute=await routeNationalLeadToTenant(wid,contact,conv,phone,text);
  if(nationalRoute?.handled)return json({ok:true,national_route:nationalRoute});

  if(!contact.bot_enabled){
    const pausedContext=(contact.bot_context&&typeof contact.bot_context==="object")?contact.bot_context:{};
    const manualPause=pausedContext?.manual_pause===true;
    const takeoverUntil=Date.parse(String(pausedContext?.human_takeover_until||""));
    const activeTimedPause=Number.isFinite(takeoverUntil)&&takeoverUntil>Date.now();
    const paymentPause=manualPause&&(
      pausedContext?.awaiting_payment===true ||
      ["pix_payment","payment_handoff","awaiting_payment_confirmation"].includes(String(pausedContext?.node||""))
    );
    if(activeTimedPause||paymentPause){
      return json({ok:true,human_mode:true,paused_until:activeTimedPause?new Date(takeoverUntil).toISOString():null});
    }
    // Pausas antigas de conversa comum não podem calar o bot indefinidamente.
    // Depois do intervalo do atendimento humano, a próxima mensagem reativa a IA automaticamente.
    contact.bot_enabled=true;
    contact.bot_context={...pausedContext,manual_pause:false,human_takeover_until:null};
    await Promise.all([
      db.from("wa_contacts").update({
        bot_enabled:true,
        bot_context:contact.bot_context,
        updated_at:new Date().toISOString()
      }).eq("id",contact.id),
      db.from("wa_conversations").update({status:"aberta"}).eq("id",conv.id)
    ]);
  }

  const {data:autos}=await db.from("wa_automations").select("*").eq("workspace_id",wid).eq("enabled",true);
  let selected:any=null,nextKey:string|null=null;
  const context=contact.bot_context||{};
  let routedText=incomingText;

  const operationNorm=norm(routedText);
  const directTestCommand=/\b(gere|gera|gerar|faz|faca|faça|cria|criar|crie|manda|mandar|libera|liberar)\b.{0,30}\b(?:o\s+)?teste\b/.test(operationNorm);
  const asksJobStatus=/^(?:\?|fez ai|fez aí|ja fez|já fez|terminou|acabou|pronto|e ai|e aí|conseguiu|deu certo)[?!. ]*$/.test(operationNorm);

  if(directTestCommand||asksJobStatus){
    const sinceJobs=new Date(Date.now()-20*60*1000).toISOString();
    const {data:recentJob}=await db.from("wa_panel_jobs")
      .select("id,action_type,status,error,connector_id,app_name,created_at,result")
      .eq("workspace_id",wid)
      .eq("contact_id",contact.id)
      .in("action_type",["scan_apps","activate_app","configure_device","test"])
      .gte("created_at",sinceJobs)
      .order("created_at",{ascending:false})
      .limit(1)
      .maybeSingle();

    if(recentJob?.id){
      const {data:jobPanel}=recentJob.connector_id
        ? await db.from("wa_panel_connectors").select("name").eq("id",recentJob.connector_id).maybeSingle()
        : {data:null};
      const panelName=String(jobPanel?.name||"painel").trim();
      const appName=String(recentJob.app_name||contact?.app_name||context?.device_app||"aplicativo").trim();
      let statusReply="";
      if(recentJob.status==="processing"||recentJob.status==="pending"){
        if(recentJob.action_type==="scan_apps"){
          statusReply="Já peguei os dados da tela. Estou verificando nos painéis em qual deles existe parceria com "+appName+". Assim que achar, eu configuro nele.";
        }else if(recentJob.action_type==="activate_app"||recentJob.action_type==="configure_device"){
          statusReply="Achei o caminho da configuração e ela está sendo feita no "+panelName+". Quando concluir, eu te aviso para apertar Recarregar.";
        }else{
          statusReply="O teste está realmente na fila do "+panelName+". Assim que o painel devolver os dados eu te envio por aqui.";
        }
      }else if(recentJob.status==="waiting_setup"){
        statusReply="Os dados ficaram salvos, mas a automação do "+panelName+" ainda não está disponível para executar. Não vou dizer que gerei antes do painel confirmar.";
      }else if(recentJob.status==="done"){
        if(recentJob.action_type==="activate_app"||recentJob.action_type==="configure_device"){
          statusReply="Prontinho, a configuração foi concluída. Agora aperta em Recarregar / Reload / Atualizar lista no aplicativo e me fala se abriu.";
        }else{
          statusReply="O painel concluiu a operação. Vou usar somente os dados reais que ele retornou.";
        }
      }else if(recentJob.status==="failed"){
        statusReply="A automação tentou executar, mas o "+panelName+" não concluiu. Mantive os dados salvos para continuar sem pedir tudo de novo.";
      }

      if(statusReply){
        await queueOut(wid,conv.id,contact.id,phone,statusReply,"bot",{panel_job_status:true,panel_job_id:recentJob.id,panel_job_state:recentJob.status});
        return json({ok:true,queued:true,panel_job_status:true,status:recentJob.status});
      }
    }
  }

  const hourText24=new Intl.DateTimeFormat("pt-BR",{
    timeZone:"America/Sao_Paulo",
    hour:"2-digit",
    hourCycle:"h23"
  }).format(new Date());
  const hour24=Number(hourText24);
  const saudacao24=hour24>=5&&hour24<12?"Bom dia":hour24>=12&&hour24<18?"Boa tarde":"Boa noite";
  const madrugada24=hour24>=23||hour24<7;
  const firstConversation=!context?.initial_greeting_sent&&Number(context?.turn||0)===0;
  const simpleGreeting24=/^(?:oi+|ola+|olá+|opa+|bom dia|boa tarde|boa noite)[!. ]*$/i.test(String(routedText||"").trim());
  const wantsRealPerson24=/\b(atendente humano|pessoa real|ser humano|atendimento humano|falar com atendente|falar com uma pessoa|falar com alguem|falar com alguém|quero um atendente|quero uma pessoa|pessoa de verdade)\b/.test(norm(routedText));

  // Primeira mensagem: cumprimento pelo horário, apresentação e pergunta do nome.
  if(firstConversation&&simpleGreeting24){
    const intro=runtimeAgent
      ? saudacao24+"! Sou "+runtimeAgent+", atendente aqui da equipe. Como posso te chamar? Me conta também no que posso te ajudar."
      : saudacao24+"! Estou no atendimento por aqui. Como posso te chamar? Me conta também no que posso te ajudar.";
    const nextContext={
      ...context,
      initial_greeting_sent:true,
      awaiting_customer_name:true,
      shift_period:madrugada24?"madrugada":"normal",
      turn:1
    };
    await db.from("wa_contacts").update({
      bot_enabled:true,
      bot_context:nextContext,
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await db.from("wa_conversations").update({status:"aberta"}).eq("id",conv.id);
    await queueOut(wid,conv.id,contact.id,phone,intro,"ai",{first_greeting:true,shift_period:madrugada24?"madrugada":"normal"});
    return json({ok:true,queued:true,first_greeting:true,awaiting_customer_name:true});
  }

  // Se a Ana perguntou o nome, salva quando a resposta parece realmente um nome.
  if(context?.awaiting_customer_name){
    const informedName=cleanQuoteCustomerName(routedText);
    if(informedName){
      const nextContext={
        ...context,
        customer_name:informedName,
        awaiting_customer_name:false,
        initial_greeting_sent:true,
        turn:Number(context?.turn||0)+1
      };
      await db.from("wa_contacts").update({
        name:informedName,
        bot_context:nextContext,
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      contact.name=informedName;
      contact.bot_context=nextContext;
      const answer=await aiFallback(
        wid,conv.id,contact.id,
        "O cliente acabou de informar que o nome dele é "+informedName+". Continue a conversa naturalmente a partir daqui e não pergunte o nome novamente.",
        nextContext
      );
      if(answer){
        await queueOut(wid,conv.id,contact.id,phone,answer,"ai",{customer_name_captured:true});
        return json({ok:true,queued:true,customer_name_captured:true,name:informedName});
      }
    }
  }

  // Pedido para falar com uma pessoa: a Ana continua atendendo e não desliga a automação.
  if(wantsRealPerson24){
    const humanReply=runtimeAgent
      ?"Mas você já está falando comigo! Sou "+runtimeAgent+" aqui da equipe de atendimento. Me conta o que tá acontecendo que eu resolvo com você."
      :"Você já está falando comigo por aqui no atendimento. Me conta o que tá acontecendo que eu resolvo com você.";
    const nextContext={
      ...context,
      initial_greeting_sent:true,
      manual_pause:false,
      human_takeover_until:null,
      turn:Number(context?.turn||0)+1
    };
    await Promise.all([
      db.from("wa_contacts").update({
        bot_enabled:true,
        bot_context:nextContext,
        updated_at:new Date().toISOString()
      }).eq("id",contact.id),
      db.from("wa_conversations").update({status:"aberta"}).eq("id",conv.id)
    ]);
    await queueOut(wid,conv.id,contact.id,phone,humanReply,"ai",{self_service_human_request:true});
    return json({ok:true,queued:true,self_service_human_request:true});
  }

  // Quando a pessoa diz que já enviou o comprovante, consulta o estado real antes de responder.
  const asksPaymentConfirmation24=/\b(ja mandei|já mandei|mandei|enviei|ja enviei|já enviei)\b.{0,45}\b(comprovante|pix|pagamento)\b|\b(pode confirmar|confirma|confirmar)\b.{0,35}\b(pagamento|pix|comprovante)\b|\b(ja paguei|já paguei|pagamento caiu|pix caiu)\b/.test(norm(routedText));
  if(asksPaymentConfirmation24){
    const [{data:lastPayment},{data:lastReceipt}]=await Promise.all([
      db.from("wa_payments").select("id,status,amount,metadata,updated_at")
        .eq("workspace_id",wid).eq("contact_id",contact.id)
        .order("created_at",{ascending:false}).limit(1).maybeSingle(),
      db.from("wa_payment_receipts").select("id,status,bank_match,vision_verdict,detected_amount,updated_at")
        .eq("workspace_id",wid).eq("contact_id",contact.id)
        .order("created_at",{ascending:false}).limit(1).maybeSingle()
    ]);
    const pStatus=norm(String(lastPayment?.status||""));
    const paid=["paid","pago","confirmado","confirmed","aprovado","approved","concluido","concluído"].includes(pStatus);
    let paymentReply="";
    if(paid){
      paymentReply="Prontinho, pagamento confirmado por aqui. Já estou seguindo com a liberação/renovação do seu acesso.";
    }else if(lastReceipt?.id){
      paymentReply="Opa, vi o comprovante que você mandou. Estou conferindo a confirmação do PIX no sistema agora; assim que aparecer confirmado, eu sigo com a liberação sem você precisar mandar tudo de novo.";
    }else{
      paymentReply="Opa, vou conferir isso aqui rapidinho. Ainda não apareceu um comprovante vinculado nesta conversa; se você já enviou, pode aguardar um instante que eu continuo a conferência por aqui.";
    }
    await queueOut(wid,conv.id,contact.id,phone,paymentReply,"ai",{payment_status_check:true,payment_id:lastPayment?.id||null,receipt_id:lastReceipt?.id||null});
    return json({ok:true,queued:true,payment_status_check:true,paid});
  }

  // CÉREBRO UNIVERSAL MULTIEMPRESA.
  // Conversas livres passam primeiro pela IA e pela memória isolada deste workspace.
  // Somente ações transacionais/estruturadas continuam nos fluxos determinísticos abaixo.
  const universalOperationalNodes=new Set([
    "trial_iptv","trial_iptv_app","trial_iptv_screens","trust_release",
    "awaiting_app_invalid_media","app_catalog_list","app_catalog_selected",
    "pix_payment","payment_handoff","awaiting_payment_confirmation"
  ]);
  const universalCurrent=norm(routedText);
  const universalStructuredAnswer=/^\s*(?:[0-9]{1,3}|sim|nao|não|voltar)\s*$/.test(universalCurrent);
  const universalExplicitHandoff=/\b(atendente humano|pessoa real|ser humano|atendimento humano|falar com atendente|falar com uma pessoa|falar com alguem|falar com alguém|quero um atendente|quero uma pessoa)\b/.test(universalCurrent);
  const universalIntentNow=intentNode(routedText);
  const asksPartnerAppsNow=/\b(aplicativo|aplicativos|app|apps)\b.{0,35}\b(parceiro|parceiros|compativel|compatíveis|compativeis|servidor)\b|\b(parceiro|parceiros)\b.{0,35}\b(aplicativo|aplicativos|app|apps)\b/.test(universalCurrent);
  const partnerFlowActive=!!context?.partner_app_flow?.connector_id;
  const supportStateActive=!!String(context?.support_stage||"").trim()
    || !!String(context?.support_summary||"").trim()
    || !!String(context?.support_app||"").trim()
    || String(context?.node||"")==="support";
  const partnerFailedNow=partnerFlowActive&&/\b(nao funciona|não funciona|nao funcionou|não funcionou|travou|trava|nao abriu|não abriu|nao pega|não pega|nao pegou|não pegou|deu erro|erro|ruim|outro|proximo|próximo)\b/.test(universalCurrent);
  const partnerWorkedNow=partnerFlowActive&&/\b(funcionou|pegou|abriu|deu certo|esta bom|está bom|ficou bom|ta bom|tá bom|perfeito|show)\b/.test(universalCurrent);
  const wantsRenewNow=universalIntentNow==="renew"||/\b(renovar|renovacao|renovação)\b/.test(universalCurrent);
  const wantsCreateUserNow=/\b(criar|cria|crie|fazer|faz|faca|faça|gerar|gera|novo|nova)\b.{0,35}\b(usuario|usuário|cliente|acesso)\b/.test(universalCurrent);
  const answeringServiceChoice=!!context?.awaiting_service_for_trial&&/^(?:cs|iptv)$/i.test(String(routedText||"").trim());
  const universalTransactional=universalOperationalNodes.has(String(context?.node||""))
    || !!sourceMatch
    || /^quero\b/.test(marketingCmd)
    || universalStructuredAnswer
    || universalExplicitHandoff
    || universalIntentNow==="trial"
    || wantsRenewNow
    || wantsCreateUserNow
    || answeringServiceChoice
    || asksPartnerAppsNow
    || partnerFailedNow
    || partnerWorkedNow
    || supportStateActive;
  async function partnerAccessData(connectorId:string){
    const [{data:account},{data:testJob}]=await Promise.all([
      db.from("wa_panel_accounts")
        .select("username,access_data,expires_at,updated_at")
        .eq("workspace_id",wid).eq("contact_id",contact.id).eq("connector_id",connectorId)
        .order("updated_at",{ascending:false}).limit(1).maybeSingle(),
      db.from("wa_panel_jobs")
        .select("result,created_at")
        .eq("workspace_id",wid).eq("contact_id",contact.id).eq("connector_id",connectorId)
        .eq("action_type","test").eq("status","done")
        .order("created_at",{ascending:false}).limit(1).maybeSingle()
    ]);
    const a=(account?.access_data&&typeof account.access_data==="object")?account.access_data:{};
    const r=(testJob?.result&&typeof testJob.result==="object")?testJob.result:{};
    return {
      username:String(account?.username||a?.username||r?.username||"").trim(),
      password:String(a?.password||r?.password||"").trim(),
      dns:String(a?.dns||r?.dns||"").trim(),
      m3u:String(a?.m3u||r?.m3u||"").trim(),
      url:String(a?.url||r?.url||"").trim(),
      expires_at:account?.expires_at||r?.expires_at||null
    };
  }

  function partnerAppMessage(app:any,access:any){
    const lines:string[]=[];
    lines.push("Vamos testar o "+String(app.app_name||"aplicativo")+".");
    if(Array.isArray(app.platforms)&&app.platforms.length)lines.push("Compatível: "+app.platforms.join(", ")+".");
    if(app.provider_code)lines.push("Provedor: "+String(app.provider_code));
    if(app.activation_code)lines.push("Código: "+String(app.activation_code));
    if(app.downloader_code)lines.push("Downloader: "+String(app.downloader_code));
    if(app.ntdown_code)lines.push("NTDown: "+String(app.ntdown_code));
    if(app.direct_link)lines.push("Link direto: "+String(app.direct_link));
    if(access.username)lines.push("Usuário: "+access.username);
    if(access.password)lines.push("Senha: "+access.password);
    if(String(app.setup_type||"")==="m3u"){
      if(app.notes)lines.push("Apps: "+String(app.notes));
      if(access.m3u)lines.push("Lista M3U: "+access.m3u);
      else if(access.dns&&access.username&&access.password){
        const base=access.dns.replace(/\/$/,"");
        lines.push("Lista M3U: "+base+"/get.php?username="+encodeURIComponent(access.username)+"&password="+encodeURIComponent(access.password)+"&type=m3u_plus&output=mpegts");
      }
    }
    lines.push("Testa esse primeiro. Se não funcionar, me fala que eu já passo o próximo.");
    return lines.join("\n");
  }

  async function loadPartnerApps(connectorId:string){
    const {data}=await db.from("wa_panel_partner_apps")
      .select("id,app_name,priority,platforms,setup_type,provider_code,activation_code,downloader_code,ntdown_code,direct_link,notes,scan_status,enabled")
      .eq("workspace_id",wid).eq("connector_id",connectorId).eq("enabled",true)
      .neq("scan_status","unavailable")
      .order("priority",{ascending:true});
    return Array.isArray(data)?data:[];
  }

  async function startPartnerApp(connectorId:string,app:any,apps:any[]){
    const access=await partnerAccessData(connectorId);
    await db.from("wa_contact_partner_app_tests").insert({
      workspace_id:wid,
      contact_id:contact.id,
      conversation_id:conv.id,
      connector_id:connectorId,
      partner_app_id:app.id,
      status:"sent",
      feedback_text:null
    });
    const index=Math.max(0,apps.findIndex((x:any)=>x.id===app.id));
    const nextContext={
      ...context,
      partner_app_flow:{
        connector_id:connectorId,
        app_ids:apps.map((x:any)=>x.id),
        current_index:index,
        current_app_id:app.id,
        current_app_name:app.app_name,
        started_at:new Date().toISOString()
      },
      turn:Number(context?.turn||0)+1
    };
    await db.from("wa_contacts").update({
      bot_context:nextContext,
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,partnerAppMessage(app,access),"bot",{
      partner_app_flow:true,
      connector_id:connectorId,
      partner_app_id:app.id,
      partner_app_name:app.app_name
    });
    return nextContext;
  }

  function directServiceType(text:string){
    const t=norm(text);
    if(/\b(cs|cardsharing|card sharing|receptor|satelite|satélite)\b/.test(t))return "cs";
    if(/\b(iptv|m3u|lista iptv|smart tv|tv box|fire tv|roku|aplicativo iptv)\b/.test(t))return "iptv";
    const saved=String(context?.trial_orchestrator?.service_type||contact?.service_type||"").toLowerCase();
    return saved==="cs"||saved==="iptv"?saved:"";
  }

  async function buildTrialCandidates(serviceType:string){
    const {data:panels}=await db.from("wa_panel_connectors")
      .select("id,name,provider_type,service_order,enabled,credential_secret_id,capabilities,last_status")
      .eq("workspace_id",wid)
      .eq("provider_type",serviceType)
      .order("service_order",{ascending:true})
      .order("name",{ascending:true});

    const usable=(panels||[]).filter((p:any)=>{
      const caps=Array.isArray(p.capabilities)?p.capabilities:[];
      return p.enabled===true&&!!p.credential_secret_id&&(!caps.length||caps.includes("test"));
    });
    if(!usable.length)return [];

    const ids=usable.map((p:any)=>p.id);
    const {data:profiles}=await db.from("wa_panel_test_profiles")
      .select("id,connector_id,service_type,profile_name,panel_code,priority,metadata")
      .eq("workspace_id",wid)
      .eq("service_type",serviceType)
      .eq("enabled",true)
      .in("connector_id",ids)
      .order("priority",{ascending:true});

    const byPanel=new Map<string,any[]>();
    for(const p of profiles||[]){
      const arr=byPanel.get(String(p.connector_id))||[];
      arr.push(p);
      byPanel.set(String(p.connector_id),arr);
    }

    const out:any[]=[];
    for(const panel of usable){
      const list=byPanel.get(String(panel.id))||[];
      if(list.length){
        for(const profile of list){
          out.push({
            connector_id:panel.id,
            panel_name:panel.name,
            service_type:serviceType,
            profile_id:profile.id,
            profile_name:profile.profile_name,
            panel_code:profile.panel_code||null,
            service_order:Number(panel.service_order||100),
            profile_priority:Number(profile.priority||100),
            metadata:profile.metadata||{}
          });
        }
      }else{
        out.push({
          connector_id:panel.id,
          panel_name:panel.name,
          service_type:serviceType,
          profile_id:null,
          profile_name:serviceType==="cs"?"Teste CS":"Teste Rápido",
          panel_code:serviceType==="cs"?null:"Teste Rápido",
          service_order:Number(panel.service_order||100),
          profile_priority:999,
          metadata:{generic:true}
        });
      }
    }
    return out;
  }

  async function queueTrialCandidate(
    candidates:any[],
    index:number,
    serviceType:string,
    afterAction:string,
    reason:string,
    requestedUsername:string|null=null
  ){
    if(index<0||index>=candidates.length)return null;
    const candidate=candidates[index];
    const payload={
      source:"multi_panel_orchestrator",
      orchestrated_trial:true,
      service_type:serviceType,
      candidate_index:index,
      candidates,
      requested_after_trial:afterAction||"trial",
      requested_username:requestedUsername||null,
      reason,
      profile_id:candidate.profile_id||null,
      profile_name:candidate.profile_name||null,
      panel_name:candidate.panel_name||null
    };
    const {data:job,error}=await db.from("wa_panel_jobs").insert({
      workspace_id:wid,
      contact_id:contact.id,
      conversation_id:conv.id,
      connector_id:candidate.connector_id,
      action_type:"test",
      app_name:serviceType==="iptv"?candidate.profile_name:null,
      panel_app_code:serviceType==="iptv"?candidate.panel_code:null,
      device_type:contact.device_type||context?.trial_device||null,
      screen_count:Number(contact.requested_screens||context?.requested_screens||1),
      customer_name:contact.name||context?.trial_customer_name||null,
      customer_phone:phone,
      requested_username:requestedUsername||null,
      status:"pending",
      payload
    }).select("id,status").single();
    if(error)throw error;

    const nextContext={
      ...context,
      trial_orchestrator:{
        active:true,
        service_type:serviceType,
        candidates,
        current_index:index,
        current_connector_id:candidate.connector_id,
        current_panel_name:candidate.panel_name,
        current_profile_name:candidate.profile_name,
        requested_after_trial:afterAction||"trial",
        requested_username:requestedUsername||null,
        last_job_id:job?.id||null,
        updated_at:new Date().toISOString()
      },
      awaiting_service_for_trial:false,
      pending_after_trial_action:null,
      turn:Number(context?.turn||0)+1
    };
    await db.from("wa_contacts").update({
      service_type:serviceType,
      bot_context:nextContext,
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    return {job,candidate,nextContext};
  }

  // Cliente informou que o aplicativo atual falhou: grava e passa automaticamente ao próximo.
  if(partnerFailedNow){
    const flow=context?.partner_app_flow||{};
    const connectorId=String(flow.connector_id||"");
    const currentAppId=String(flow.current_app_id||"");
    const apps=await loadPartnerApps(connectorId);
    const currentIndex=Math.max(0,apps.findIndex((x:any)=>String(x.id)===currentAppId));
    const currentApp=apps[currentIndex]||null;

    if(currentApp){
      const {data:lastSent}=await db.from("wa_contact_partner_app_tests")
        .select("id").eq("workspace_id",wid).eq("contact_id",contact.id)
        .eq("connector_id",connectorId).eq("partner_app_id",currentApp.id)
        .order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(lastSent?.id){
        await db.from("wa_contact_partner_app_tests").update({
          status:"failed",
          feedback_at:new Date().toISOString(),
          feedback_text:routedText,
          updated_at:new Date().toISOString()
        }).eq("id",lastSent.id);
      }
      const {data:appState}=await db.from("wa_panel_partner_apps")
        .select("failure_count").eq("id",currentApp.id).maybeSingle();
      await db.from("wa_panel_partner_apps").update({
        last_feedback_status:"failed",
        last_feedback_at:new Date().toISOString(),
        failure_count:Number(appState?.failure_count||0)+1,
        updated_at:new Date().toISOString()
      }).eq("id",currentApp.id);
    }

    const {data:failedRows}=await db.from("wa_contact_partner_app_tests")
      .select("partner_app_id,status").eq("workspace_id",wid).eq("contact_id",contact.id)
      .eq("connector_id",connectorId).eq("status","failed");
    const failedIds=new Set((failedRows||[]).map((x:any)=>String(x.partner_app_id)));
    const next=apps.find((x:any,idx:number)=>idx>currentIndex&&!failedIds.has(String(x.id)))
      || apps.find((x:any)=>!failedIds.has(String(x.id)));

    if(next){
      await queueOut(wid,conv.id,contact.id,phone,"Entendi. Já marquei esse como não funcionando pra você. Vou passar o próximo.","bot",{partner_app_failed:true,failed_app:currentApp?.app_name||null});
      await startPartnerApp(connectorId,next,apps);
      return json({ok:true,queued:true,partner_app_rotated:true,next_app:next.app_name});
    }

    await queueOut(wid,conv.id,contact.id,phone,"Já testamos todos os aplicativos parceiros cadastrados desse servidor. Vou seguir para a próxima opção de servidor sem repetir os que já falharam.","bot",{partner_apps_exhausted:true,connector_id:connectorId});
    await db.from("wa_contacts").update({
      bot_context:{...context,partner_app_flow:null,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    return json({ok:true,queued:true,partner_apps_exhausted:true});
  }

  // Cliente confirmou que o aplicativo funcionou: grava sucesso e encerra a rotação.
  if(partnerWorkedNow){
    const flow=context?.partner_app_flow||{};
    const connectorId=String(flow.connector_id||"");
    const currentAppId=String(flow.current_app_id||"");
    const {data:lastSent}=await db.from("wa_contact_partner_app_tests")
      .select("id").eq("workspace_id",wid).eq("contact_id",contact.id)
      .eq("connector_id",connectorId).eq("partner_app_id",currentAppId)
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(lastSent?.id){
      await db.from("wa_contact_partner_app_tests").update({
        status:"working",
        feedback_at:new Date().toISOString(),
        feedback_text:routedText,
        updated_at:new Date().toISOString()
      }).eq("id",lastSent.id);
    }
    const {data:appState}=await db.from("wa_panel_partner_apps")
      .select("success_count,app_name").eq("id",currentAppId).maybeSingle();
    if(currentAppId){
      await db.from("wa_panel_partner_apps").update({
        last_feedback_status:"working",
        last_feedback_at:new Date().toISOString(),
        success_count:Number(appState?.success_count||0)+1,
        updated_at:new Date().toISOString()
      }).eq("id",currentAppId);
    }
    await db.from("wa_contacts").update({
      bot_context:{...context,partner_app_flow:null,working_partner_app:appState?.app_name||flow.current_app_name||null,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,"Show! Já deixei marcado que esse funcionou pra você. Vamos continuar nele então 👍","bot",{partner_app_working:true,partner_app_name:appState?.app_name||flow.current_app_name||null});
    return json({ok:true,queued:true,partner_app_working:true});
  }

  const trialFlow=context?.trial_orchestrator||null;
  const trialFlowActive=!!trialFlow?.active;
  const trialFailedNow=trialFlowActive&&!partnerFlowActive&&/\b(travou|travando|nao funciona|não funciona|nao funcionou|não funcionou|nao abriu|não abriu|nao pegou|não pegou|ruim|troca|trocar|outro servidor|proximo servidor|próximo servidor)\b/.test(universalCurrent);
  const trialWorkedNow=trialFlowActive&&!partnerFlowActive&&/\b(funcionou|pegou|abriu|deu certo|ficou bom|esta bom|está bom|ta bom|tá bom|gostei|perfeito|show)\b/.test(universalCurrent);

  if(!childTenant&&trialFailedNow){
    const candidates=Array.isArray(trialFlow?.candidates)?trialFlow.candidates:[];
    const nextIndex=Number(trialFlow?.current_index||0)+1;
    if(nextIndex<candidates.length){
      const queued=await queueTrialCandidate(
        candidates,
        nextIndex,
        String(trialFlow.service_type||"iptv"),
        String(trialFlow.requested_after_trial||"trial"),
        "customer_reported_failure",
        String(trialFlow.requested_username||"")||null
      );
      await queueOut(
        wid,conv.id,contact.id,phone,
        "Entendi. Já marquei esse teste como ruim e vou para a próxima opção agora: "+String(queued?.candidate?.panel_name||"próximo servidor")+" / "+String(queued?.candidate?.profile_name||"teste")+".",
        "bot",
        {trial_rotated:true,candidate_index:nextIndex}
      );
      return json({ok:true,queued:true,trial_rotated:true,candidate_index:nextIndex});
    }
    await db.from("wa_contacts").update({
      bot_context:{...context,trial_orchestrator:{...trialFlow,active:false,exhausted:true},turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,"Já passei por todas as opções de teste disponíveis desse serviço e não vou repetir as que falharam.","bot",{trial_sequence_exhausted:true});
    return json({ok:true,queued:true,trial_sequence_exhausted:true});
  }

  if(!childTenant&&trialWorkedNow){
    const after=String(trialFlow?.requested_after_trial||"trial");
    const serviceType=String(trialFlow?.service_type||contact.service_type||"iptv");
    const connectorId=String(trialFlow?.current_connector_id||"");
    const requestedUsername=String(trialFlow?.requested_username||"").trim();
    const savedPlan=Number(contact.plan_days||0)||0;

    if(after==="renew"){
      if(!requestedUsername){
        await db.from("wa_contacts").update({
          bot_context:{...context,trial_orchestrator:{...trialFlow,last_feedback:"working"},post_trial_action:"renew",post_trial_awaiting:"username",post_trial_service_type:serviceType},
          updated_at:new Date().toISOString()
        }).eq("id",contact.id);
        await queueOut(wid,conv.id,contact.id,phone,"Ótimo, o teste ficou bom. Me manda só o usuário/login que você quer renovar.","bot");
        return json({ok:true,queued:true,post_trial_action:"renew",awaiting:"username"});
      }
      if(!savedPlan){
        await db.from("wa_contacts").update({
          bot_context:{...context,trial_orchestrator:{...trialFlow,last_feedback:"working"},post_trial_action:"renew",post_trial_awaiting:"plan",post_trial_service_type:serviceType,post_trial_username:requestedUsername},
          updated_at:new Date().toISOString()
        }).eq("id",contact.id);
        await queueOut(wid,conv.id,contact.id,phone,"Certo. Me diga o período da renovação: 30, 90, 180 ou 365 dias.","bot");
        return json({ok:true,queued:true,post_trial_action:"renew",awaiting:"plan"});
      }

      const {data:renewPanels}=await db.from("wa_panel_connectors")
        .select("id,capabilities,enabled,credential_secret_id,service_order")
        .eq("workspace_id",wid).eq("provider_type",serviceType)
        .order("service_order",{ascending:true});
      const targets=(renewPanels||[]).filter((p:any)=>{
        const caps=Array.isArray(p.capabilities)?p.capabilities:[];
        return p.enabled===true&&!!p.credential_secret_id&&(!caps.length||(caps.includes("lookup_client")&&caps.includes("renew")));
      });
      const searchGroup=crypto.randomUUID();
      const rows=targets.map((p:any)=>({
        workspace_id:wid,contact_id:contact.id,conversation_id:conv.id,
        connector_id:p.id,action_type:"search_user",requested_username:requestedUsername,
        customer_name:contact.name||null,customer_phone:phone,plan_days:savedPlan,status:"pending",
        payload:{source:"post_trial_renew_search",username:requestedUsername,search_group:searchGroup,after_found_action:"renew",plan_days:savedPlan,service_type:serviceType}
      }));
      if(rows.length)await db.from("wa_panel_jobs").insert(rows);
      await queueOut(wid,conv.id,contact.id,phone,"Ótimo. Já estou procurando seu usuário nos painéis de "+serviceType.toUpperCase()+" para renovar no painel certo.","bot",{search_group:searchGroup});
      return json({ok:true,queued:true,post_trial_action:"renew",search_group:searchGroup});
    }

    if(after==="create_user"){
      if(!savedPlan){
        await db.from("wa_contacts").update({
          bot_context:{...context,trial_orchestrator:{...trialFlow,last_feedback:"working"},post_trial_action:"create_user",post_trial_awaiting:"plan",post_trial_service_type:serviceType,post_trial_connector_id:connectorId},
          updated_at:new Date().toISOString()
        }).eq("id",contact.id);
        await queueOut(wid,conv.id,contact.id,phone,"Ótimo. Me diga o período do acesso definitivo: 30, 90, 180 ou 365 dias.","bot");
        return json({ok:true,queued:true,post_trial_action:"create_user",awaiting:"plan"});
      }
      const {data:newJob}=await db.from("wa_panel_jobs").insert({
        workspace_id:wid,contact_id:contact.id,conversation_id:conv.id,
        connector_id:connectorId,action_type:"create_user",plan_days:savedPlan,
        screen_count:Number(contact.requested_screens||1),
        customer_name:contact.name||null,customer_phone:phone,status:"pending",
        payload:{source:"post_trial_create_user",plan_days:savedPlan,service_type:serviceType}
      }).select("id").single();
      await queueOut(wid,conv.id,contact.id,phone,"Ótimo. Já estou criando o acesso definitivo nesse mesmo servidor.","bot",{job_id:newJob?.id||null});
      return json({ok:true,queued:true,post_trial_action:"create_user"});
    }

    await db.from("wa_contacts").update({
      bot_context:{...context,trial_orchestrator:{...trialFlow,last_feedback:"working",working_at:new Date().toISOString()}},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,"Show. Já marquei esse servidor como funcionando pra você.","bot",{trial_working:true});
    return json({ok:true,queued:true,trial_working:true});
  }

  if(!childTenant&&context?.post_trial_action&&context?.post_trial_awaiting){
    const action=String(context.post_trial_action||"");
    const awaiting=String(context.post_trial_awaiting||"");
    const serviceType=String(context?.post_trial_service_type||context?.trial_orchestrator?.service_type||contact.service_type||"iptv");
    let username=String(context?.post_trial_username||context?.trial_orchestrator?.requested_username||"").trim();
    let planDays=Number(contact.plan_days||0)||0;

    if(awaiting==="username"){
      const raw=String(routedText||"").trim();
      if(!/^[A-Za-z0-9._-]{3,}$/.test(raw)){
        await queueOut(wid,conv.id,contact.id,phone,"Me manda somente o usuário/login que você quer renovar.","bot");
        return json({ok:true,queued:true,post_trial_awaiting:"username"});
      }
      username=raw;
      if(!planDays){
        await db.from("wa_contacts").update({
          bot_context:{...context,post_trial_username:username,post_trial_awaiting:"plan"},
          updated_at:new Date().toISOString()
        }).eq("id",contact.id);
        await queueOut(wid,conv.id,contact.id,phone,"Certo. Agora me diga o período: 30, 90, 180 ou 365 dias.","bot");
        return json({ok:true,queued:true,post_trial_awaiting:"plan"});
      }
    }

    if(awaiting==="plan"){
      const parsed=parsePlanDays(routedText);
      if(!parsed){
        await queueOut(wid,conv.id,contact.id,phone,"Me diga somente o período: 30, 90, 180 ou 365 dias.","bot");
        return json({ok:true,queued:true,post_trial_awaiting:"plan"});
      }
      planDays=parsed;
      await db.from("wa_contacts").update({plan_days:planDays,updated_at:new Date().toISOString()}).eq("id",contact.id);
    }

    if(action==="create_user"&&planDays){
      const connectorId=String(context?.post_trial_connector_id||context?.trial_orchestrator?.current_connector_id||"");
      const {data:newJob}=await db.from("wa_panel_jobs").insert({
        workspace_id:wid,contact_id:contact.id,conversation_id:conv.id,
        connector_id:connectorId,action_type:"create_user",plan_days:planDays,
        screen_count:Number(contact.requested_screens||1),
        customer_name:contact.name||null,customer_phone:phone,status:"pending",
        payload:{source:"post_trial_create_user",plan_days:planDays,service_type:serviceType}
      }).select("id").single();
      await db.from("wa_contacts").update({
        bot_context:{...context,post_trial_action:null,post_trial_awaiting:null,post_trial_username:null},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"Pronto. Já estou criando o acesso definitivo no servidor que passou no teste.","bot",{job_id:newJob?.id||null});
      return json({ok:true,queued:true,post_trial_action:"create_user"});
    }

    if(action==="renew"&&username&&planDays){
      const {data:renewPanels}=await db.from("wa_panel_connectors")
        .select("id,capabilities,enabled,credential_secret_id,service_order")
        .eq("workspace_id",wid).eq("provider_type",serviceType)
        .order("service_order",{ascending:true});
      const targets=(renewPanels||[]).filter((p:any)=>{
        const caps=Array.isArray(p.capabilities)?p.capabilities:[];
        return p.enabled===true&&!!p.credential_secret_id&&(!caps.length||(caps.includes("lookup_client")&&caps.includes("renew")));
      });
      const searchGroup=crypto.randomUUID();
      const rows=targets.map((p:any)=>({
        workspace_id:wid,contact_id:contact.id,conversation_id:conv.id,
        connector_id:p.id,action_type:"search_user",requested_username:username,
        customer_name:contact.name||null,customer_phone:phone,plan_days:planDays,status:"pending",
        payload:{source:"post_trial_renew_search",username,search_group:searchGroup,after_found_action:"renew",plan_days:planDays,service_type:serviceType}
      }));
      if(rows.length)await db.from("wa_panel_jobs").insert(rows);
      await db.from("wa_contacts").update({
        bot_context:{...context,post_trial_action:null,post_trial_awaiting:null,post_trial_username:null},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"Pronto. Já estou procurando esse usuário nos painéis de "+serviceType.toUpperCase()+" para renovar no painel certo.","bot",{search_group:searchGroup});
      return json({ok:true,queued:true,post_trial_action:"renew",search_group:searchGroup});
    }
  }

  const masterTrialRequest=!childTenant&&(universalIntentNow==="trial"||wantsRenewNow||wantsCreateUserNow||answeringServiceChoice);
  if(masterTrialRequest){
    let serviceType=directServiceType(routedText);
    const afterAction=answeringServiceChoice
      ? String(context?.pending_after_trial_action||"trial")
      : wantsRenewNow?"renew":wantsCreateUserNow?"create_user":"trial";
    const usernameMatch=String(routedText||"").match(/\b(?:usuario|usuário|login)\s*[:=-]?\s*([A-Za-z0-9._-]{3,})/i);
    const requestedUsername=usernameMatch?.[1]||String(context?.pending_requested_username||"").trim()||null;

    if(!serviceType){
      const nextContext={
        ...context,
        awaiting_service_for_trial:true,
        pending_after_trial_action:afterAction,
        pending_requested_username:requestedUsername,
        turn:Number(context?.turn||0)+1
      };
      await db.from("wa_contacts").update({bot_context:nextContext,updated_at:new Date().toISOString()}).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"É para IPTV ou CS? Me fala só isso que eu já começo pelo teste primeiro.","bot",{awaiting_service_for_trial:true});
      return json({ok:true,queued:true,awaiting_service_for_trial:true});
    }

    const candidates=await buildTrialCandidates(serviceType);
    if(!candidates.length){
      await queueOut(
        wid,conv.id,contact.id,phone,
        "Ainda não encontrei nenhum painel de "+serviceType.toUpperCase()+" com acesso salvo e habilitado para gerar o teste automático.",
        "bot",
        {trial_no_ready_panels:true,service_type:serviceType}
      );
      return json({ok:true,queued:true,trial_no_ready_panels:true,service_type:serviceType});
    }

    const queued=await queueTrialCandidate(candidates,0,serviceType,afterAction,"customer_request",requestedUsername);
    await queueOut(
      wid,conv.id,contact.id,phone,
      "Beleza. Vou começar pelo teste primeiro no "+String(queued?.candidate?.panel_name||"primeiro servidor")+" / "+String(queued?.candidate?.profile_name||"teste")+". Assim que o painel devolver os dados reais eu te mando.",
      "bot",
      {trial_orchestrator_started:true,service_type:serviceType,candidate_index:0}
    );
    return json({ok:true,queued:true,trial_orchestrator_started:true,service_type:serviceType});
  }

  if(!universalTransactional){
    const triageNow=classifyUniversalTriage(routedText,context);
    const universalContext={
      ...context,
      initial_greeting_sent:true,
      first_message:firstConversation,
      current_greeting:saudacao24,
      shift_period:madrugada24?"madrugada":"normal",
      triage_department:triageNow.department,
      triage_priority:triageNow.priority,
      triage_tags:triageNow.tags,
      triage_summary:triageNow.summary,
      triage_updated_at:new Date().toISOString(),
      conversation_mode:"universal_ai",
      turn:Number(context?.turn||0)+1
    };
    let universalAnswer:string|null=null;
    let aiError:any=null;
    try{
      universalAnswer=await aiFallback(wid,conv.id,contact.id,routedText,universalContext);
    }catch(error){
      aiError=error;
      console.error("Erro crítico na chamada do Gemini",error);
    }

    if(universalAnswer){
      await Promise.all([
        db.from("wa_contacts").update({
          bot_context:universalContext,
          updated_at:new Date().toISOString()
        }).eq("id",contact.id),
        db.from("wa_conversations").update({
          department:triageNow.department,
          priority:triageNow.priority,
          tags:triageNow.tags,
          handoff_summary:triageNow.summary,
          routing_updated_at:new Date().toISOString()
        }).eq("id",conv.id)
      ]);
      await queueOut(wid,conv.id,contact.id,phone,universalAnswer,"ai",{conversation_mode:"universal_ai"});
      return json({ok:true,status:"sucesso",queued:true,resposta:universalAnswer,conversation_brain:true,universal:true});
    }

    console.error("Falha técnica do Gemini na conversa livre",JSON.stringify({
      workspace_id:wid,
      conversation_id:conv.id,
      contact_id:contact.id,
      error:aiError?String(aiError):"empty_response"
    }));

    const fallbackContext={
      ...universalContext,
      company_name:runtimeCompany,
      agent_name:runtimeAgent
    };
    const respostaLocal=supportFallbackReply(routedText,fallbackContext)
      || naturalFallback(routedText,fallbackContext);
    await queueOut(wid,conv.id,contact.id,phone,respostaLocal,"bot",{
      conversation_mode:"local_state_fallback",
      ai_unavailable:true,
      gemini_rate_limited:geminiRateLimited
    });
    return json({ok:true,status:"fallback_local",queued:true,resposta:respostaLocal,conversation_brain:true,universal:true,ai_unavailable:true});
  }

  // Aplicativos parceiros: usa a base própria daquele servidor e inicia a rotação.
  if(asksPartnerAppsNow){
    const [{data:lastTrial},{data:lastAccount},{data:lastTestJob}]=await Promise.all([
      db.from("wa_trial_sessions")
        .select("id,connector_id,username,app_name,created_at")
        .eq("workspace_id",wid).eq("contact_id",contact.id)
        .order("created_at",{ascending:false}).limit(1).maybeSingle(),
      db.from("wa_panel_accounts")
        .select("id,connector_id,username,app_name,updated_at")
        .eq("workspace_id",wid).eq("contact_id",contact.id)
        .order("updated_at",{ascending:false}).limit(1).maybeSingle(),
      db.from("wa_panel_jobs")
        .select("id,connector_id,result,created_at")
        .eq("workspace_id",wid).eq("contact_id",contact.id)
        .eq("action_type","test")
        .order("created_at",{ascending:false}).limit(1).maybeSingle()
    ]);

    let connectorId=String(
      context?.partner_app_flow?.connector_id
      || lastTrial?.connector_id
      || lastAccount?.connector_id
      || lastTestJob?.connector_id
      || ""
    );

    if(!connectorId){
      const {data:firstBase}=await db.from("wa_panel_partner_apps")
        .select("connector_id")
        .eq("workspace_id",wid).eq("enabled",true)
        .order("priority",{ascending:true}).limit(1).maybeSingle();
      connectorId=String(firstBase?.connector_id||"");
    }

    if(!connectorId){
      const reply="Ainda não tem uma base de aplicativos parceiros cadastrada para este atendimento.";
      await queueOut(wid,conv.id,contact.id,phone,reply,"bot",{partner_apps_verified:false});
      return json({ok:true,queued:true,partner_apps_verified:false,no_connector:true});
    }

    const [{data:panel},apps]=await Promise.all([
      db.from("wa_panel_connectors")
        .select("id,name,last_status,credential_secret_id")
        .eq("id",connectorId).eq("workspace_id",wid).maybeSingle(),
      loadPartnerApps(connectorId)
    ]);

    if(!apps.length){
      const ready=!!(panel?.credential_secret_id&&panel?.last_status==="driver_ready");
      const ins=await db.from("wa_panel_jobs").insert({
        workspace_id:wid,
        contact_id:contact.id,
        conversation_id:conv.id,
        connector_id:connectorId,
        action_type:"scan_apps",
        status:ready?"pending":"waiting_setup",
        customer_name:contact.name||null,
        customer_phone:phone,
        payload:{source:"customer_partner_apps_question"}
      }).select("id,status").single();
      if(ins.error)throw ins.error;
      await queueOut(
        wid,conv.id,contact.id,phone,
        ready
          ?"Vou conferir direto no servidor quais aplicativos parceiros ele tem e já te passo os nomes."
          :"A lista desse servidor ainda está aguardando a automação do painel ficar disponível.",
        "bot",
        {partner_apps_scan:true,panel_job_id:ins.data?.id||null}
      );
      return json({ok:true,queued:true,partner_apps_scan:true});
    }

    const names=apps.map((x:any)=>String(x.app_name||"").trim()).filter(Boolean);
    const listText="Aplicativos parceiros deste servidor:\n\n"+names.map((n:string)=>"• "+n).join("\n");
    await queueOut(wid,conv.id,contact.id,phone,listText,"bot",{
      partner_apps_list:true,
      connector_id:connectorId,
      partner_apps:names
    });

    // Começa automaticamente pelo primeiro da ordem cadastrada.
    const first=apps[0];
    if(first){
      await startPartnerApp(connectorId,first,apps);
    }
    return json({ok:true,queued:true,partner_apps_list:true,started_app:first?.app_name||null});
  }

  // Compatibilidade de Smart TV vem antes do catálogo. Primeiro identificamos
  // o sistema da TV; só depois mostramos os aplicativos realmente compatíveis.
  const tvQuestion=norm(routedText);
  const asksTvApp=/\b(tv|televisao|televisão)\b/.test(tvQuestion)
    && /\b(aplicativo|aplicativos|app|apps|instalar|baixar|tem app)\b/.test(tvQuestion);
  const mentionsSony=/\bsony\b/.test(tvQuestion);
  if(asksTvApp&&mentionsSony){
    const reply="Pode ter, sim, mas depende do sistema da sua Sony. Se ela tiver Android TV ou Google TV, dá para instalar aplicativos pela Play Store. Aperte o botão HOME do controle e veja se aparece Play Store. Ela aparece aí?";
    await db.from("wa_contacts").update({
      device_type:"Sony TV",
      app_name:null,
      bot_context:{...context,node:"tv_app_compatibility",tv_brand:"Sony",tv_platform:null,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
    return json({ok:true,queued:true,tv_compatibility:true,brand:"Sony"});
  }

  if(String(context?.node||"")==="tv_app_compatibility"){
    // Ajuda prática antes de repetir uma solicitação que o cliente disse não saber cumprir.
    const cannotFollow=/\b(nao sei|não sei|nao consigo|não consigo|como faz|como fazer|onde fica|onde e|onde é|qual botao|qual botão|como tira|como tirar|como manda|como enviar|como envia)\b/.test(tvQuestion);
    if(cannotFollow){
      const asksPhotoHelp=/\b(foto|imagem|fotografia)\b/.test(tvQuestion);
      const asksVideoHelp=/\b(video|vídeo|gravar|filmagem)\b/.test(tvQuestion);
      const asksHomeHelp=/\b(home|botao|botão|controle|casinha)\b/.test(tvQuestion);
      let reply="";
      if(asksPhotoHelp){
        reply="Sem problema. Pegue o celular, abra a câmera, aponte para a tela inteira da TV e toque no botão redondo para tirar a foto. Depois, aqui no WhatsApp, toque no clipe ou na câmera, escolha a foto e envie. Se preferir, pode só escrever o que aparece na tela.";
      }else if(asksVideoHelp){
        reply="Sem problema. Abra a câmera do celular, escolha VÍDEO, grave alguns segundos mostrando a tela da TV e envie aqui pelo clipe do WhatsApp. Se não conseguir, escreva exatamente o que aparece na tela.";
      }else if(asksHomeHelp){
        reply="Sem problema. No controle da Sony, procure o botão HOME, geralmente com o desenho de uma casinha. Se não encontrar, procure MENU ou o botão da engrenagem. Diga quais botões aparecem no seu controle que eu te guio sem pedir foto.";
      }else{
        reply="Sem problema. Eu te explico passo a passo. Diga qual parte você não conseguiu fazer e eu continuo daqui sem repetir a mesma pergunta.";
      }
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"tv_app_compatibility",last_help_instruction:reply,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
      return json({ok:true,queued:true,tv_compatibility:true,guided_help:true});
    }
    const saysHasStore=/\b(tem|sim|aparece|achei|encontrei)\b/.test(tvQuestion)
      && /\b(play store|google play|android|google tv)\b/.test(tvQuestion);
    const saysNoStore=/\b(nao|não|nao tem|não tem|nao aparece|não aparece)\b/.test(tvQuestion)
      && /\b(play store|loja|aplicativo|app|aparece|tem)\b/.test(tvQuestion);
    if(saysHasStore){
      const {data:compatibleApps}=await db.from("wa_app_catalog")
        .select("name,platforms").eq("workspace_id",wid).eq("enabled",true).order("name").limit(80);
      const names=(Array.isArray(compatibleApps)?compatibleApps:[])
        .filter((x:any)=>{
          const p=(Array.isArray(x?.platforms)?x.platforms:[]).map((v:any)=>norm(String(v))).join(" ");
          return /\b(android|android tv|google tv|sony)\b/.test(p);
        })
        .map((x:any)=>String(x?.name||"").trim()).filter(Boolean);
      const first=names.slice(0,8);
      const reply=first.length
        ?"Ótimo, então sua Sony aceita aplicativos Android. Alguns compatíveis são: "+first.join(", ")+". Qual deles você quer usar?"
        :"Ótimo, então sua Sony aceita aplicativos Android. Qual aplicativo você está procurando?";
      await db.from("wa_contacts").update({
        device_type:"Sony Android TV",
        bot_context:{...context,node:"tv_app_compatibility",tv_platform:"Android TV",turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
      return json({ok:true,queued:true,tv_compatibility:true,platform:"Android TV"});
    }
    if(saysNoStore){
      const reply="Nesse caso, ela provavelmente não instala esses aplicativos diretamente. Dá para usar normalmente colocando um aparelho externo, como TV Box, Fire TV Stick ou Roku. Você já tem algum desses aparelhos?";
      await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
      return json({ok:true,queued:true,tv_compatibility:true,external_device_needed:true});
    }
    const reply="Para eu confirmar sem te passar informação errada, me mande o modelo da TV Sony ou uma foto da tela que aparece quando você aperta HOME.";
    await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
    return json({ok:true,queued:true,tv_compatibility:true,waiting_model_or_photo:true});
  }

  if(String(context?.node||"")==="business_overview_menu"){
    const choice=(String(text||"").trim().match(/^([1-9]|1[0-4])$/)||[])[1]||"";
    if(choice){
      const detail=await buildBusinessOverviewSection(wid,choice);
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"business_overview_menu",business_overview_choice:choice,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,detail,"bot");
      return json({ok:true,queued:true,business_overview_section:choice});
    }
  }

  // Triagem universal no estilo de uma central omnichannel: identifica o assunto,
  // mantém etiquetas e leva um resumo junto quando há transferência humana.
  const triage=classifyUniversalTriage(routedText,context);
  Object.assign(context,{
    triage_department:triage.department,
    triage_priority:triage.priority,
    triage_tags:triage.tags,
    triage_summary:triage.summary,
    triage_updated_at:new Date().toISOString()
  });
  await Promise.all([
    db.from("wa_conversations").update({
      department:triage.department,
      priority:triage.priority,
      tags:triage.tags,
      handoff_summary:triage.summary,
      routing_updated_at:new Date().toISOString()
    }).eq("id",conv.id),
    db.from("wa_contacts").update({
      bot_context:context,
      updated_at:new Date().toISOString()
    }).eq("id",contact.id)
  ]);

  if(triage.explicitHandoff){
    const sectorLabel:Record<string,string>={
      atendimento:"atendimento",vendas:"vendas",suporte:"suporte",
      financeiro:"financeiro",compras:"compras",parcerias:"parcerias"
    };
    const label=sectorLabel[triage.department]||"atendimento";
    const handoffReply=triage.department==="compras"
      ? "Entendi. Você quer falar com o responsável por compras. Já encaminhei a conversa com o resumo do seu pedido para o setor de compras, sem perder o que você informou."
      : "Entendi. Já encaminhei sua conversa para o setor de "+label+" com o resumo do que você precisa. Você não terá que repetir tudo.";
    await Promise.all([
      db.from("wa_contacts").update({
        bot_enabled:false,
        bot_context:{...context,node:"welcome",manual_pause:true,human_takeover_until:null},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id),
      db.from("wa_conversations").update({
        status:"aguardando_atendente",
        department:triage.department,
        priority:triage.priority,
        tags:triage.tags,
        handoff_summary:triage.summary,
        routing_updated_at:new Date().toISOString()
      }).eq("id",conv.id)
    ]);
    await queueOut(wid,conv.id,contact.id,phone,handoffReply,"bot");
    return json({ok:true,queued:true,handoff:true,department:triage.department,priority:triage.priority});
  }

  // Compras B2B é atendida pelo próprio agente virtual. Ele coleta os dados
  // e mantém a conversa ativa; não transfere apenas porque citaram um responsável.
  if(triage.department==="compras" || String(context?.node||"")==="business_procurement" || !!context?.procurement_stage){
    const raw=String(routedText||"").trim(), n=norm(raw);
    const buyer=/\b(responsavel por compras|responsável por compras|setor de compras|comprador)\b/.test(n);
    const supplierIntro=/\b(distribuidor|fornecedor|representante|fabricante)\b/.test(n);
    const productCount=(n.match(/\b(produto|marca|modelo|receptor|box|camera|câmera|dvr|cabo|antena|roteador|suporte|ferramenta|acessorio|acessório)\b/g)||[]).length;
    const catalog=raw.length>220 || raw.split("\n").filter((x:string)=>x.trim()).length>=5 || productCount>=4;
    const price=/\b(tabela|preco|preço|valor|reais|desconto)\b|r\$/i.test(raw);
    const minimum=/\b(pedido minimo|pedido mínimo|minimo de compra|mínimo de compra|quantidade minima|quantidade mínima)\b/.test(n);
    const paymentTerms=/\b(prazo|boleto|pix|cartao|cartão|parcel|pagamento|entrada)\b/.test(n);
    const delivery=/\b(entrega|frete|transportadora|retirada|regiao|região|cidade|estado|todo brasil)\b/.test(n);
    const invoice=/\b(nota fiscal|nf-e|nfe|garantia|troca|devolucao|devolução)\b/.test(n);
    const paymentMoment=/\b(envie? (?:o )?(?:pix|qr|link de pagamento|boleto|fatura)|mandei (?:o )?(?:pix|qr|link|boleto|fatura)|pode (?:fazer|realizar|efetuar) (?:o )?pagamento|vamos fechar (?:o )?pedido|pedido (?:esta|está) pronto para pagamento|aguardando pagamento)\b/.test(n);

    const {data:old}=await db.from("wa_supplier_proposals").select("*")
      .eq("workspace_id",wid).eq("contact_id",contact.id).maybeSingle();
    const messages=Array.isArray(old?.raw_messages)?old.raw_messages:[];
    const s:any={
      company:String(old?.company_name||context?.supplier_company||"").trim(),
      contact:String(old?.contact_name||context?.supplier_contact_name||contact?.name||"").trim(),
      offer:String(old?.offer_summary||"").trim(),
      catalog:String(old?.catalog_text||context?.supplier_catalog||"").trim(),
      pricing:String(old?.pricing_terms||"").trim(),
      min:String(old?.minimum_order||"").trim(),
      payment:String(old?.payment_terms||"").trim(),
      delivery:String(old?.delivery_terms||context?.supplier_region||"").trim(),
      invoice:String(old?.invoice_warranty||"").trim()
    };
    const previous=String(context?.procurement_stage||"");
    if(previous==="waiting_company"&&!buyer&&!supplierIntro&&!catalog)s.company=raw.slice(0,180);
    if(catalog){s.catalog=raw.slice(0,8000);s.offer=("Catálogo recebido com "+productCount+" grupos de produtos identificados.").slice(0,500);}
    else if(previous==="waiting_offer"&&raw.length>2)s.offer=raw.slice(0,1200);
    if(price)s.pricing=raw.slice(0,3000);
    if(minimum)s.min=raw.slice(0,1000);
    if(paymentTerms)s.payment=raw.slice(0,1500);
    if(delivery)s.delivery=raw.slice(0,1500);
    if(invoice)s.invoice=raw.slice(0,1500);

    let reply="",stage=previous||"qualifying",status="qualifying",handoff=false;
    if(paymentMoment){
      handoff=true;status="ready_for_payment";stage="ready_for_payment";
      reply="Perfeito. A proposta já está organizada e agora chegou a etapa de pagamento. Vou chamar o responsável com o resumo completo para ele finalizar com você. Não precisa repetir nada.";
    }else if(!s.company){
      stage="waiting_company";reply="Pode tratar da proposta comigo por aqui. Qual é o nome da sua empresa?";
    }else if(!s.offer&&!s.catalog){
      stage="waiting_offer";reply="Obrigado. O que sua empresa fornece? Pode mandar uma descrição, catálogo, fotos ou PDF.";
    }else if(!s.pricing){
      stage="waiting_pricing";reply="Recebi os produtos. Agora me envie a tabela de preços e diga se existe pedido mínimo.";
    }else if(!s.min){
      stage="waiting_minimum";reply="Qual é o valor ou a quantidade mínima para fazer um pedido?";
    }else if(!s.payment){
      stage="waiting_payment_terms";reply="Quais são as condições e os prazos de pagamento?";
    }else if(!s.delivery){
      stage="waiting_delivery";reply="Como funciona a entrega ou o frete e quais regiões vocês atendem?";
    }else if(!s.invoice){
      stage="waiting_invoice";reply="Vocês emitem nota fiscal? E como funciona a garantia ou troca?";
    }else{
      status="qualified";stage="proposal_qualified";
      reply=["Deixei a proposta organizada:","Empresa: "+s.company,s.contact?"Contato: "+s.contact:"",s.offer?"Oferta: "+s.offer:"","Preços e pedido mínimo: recebidos","Pagamento e entrega: recebidos","Nota fiscal e garantia: recebidas","","Está tudo certo com esse resumo?"].filter(Boolean).join("\n");
    }

    await db.from("wa_supplier_proposals").upsert({
      workspace_id:wid,contact_id:contact.id,conversation_id:conv.id,
      company_name:s.company||null,contact_name:s.contact||null,offer_summary:s.offer||null,
      catalog_text:s.catalog||null,pricing_terms:s.pricing||null,minimum_order:s.min||null,
      payment_terms:s.payment||null,delivery_terms:s.delivery||null,invoice_warranty:s.invoice||null,
      status,ready_for_human:handoff,
      raw_messages:[...messages,{at:new Date().toISOString(),text:raw.slice(0,5000)}].slice(-30),
      updated_at:new Date().toISOString()
    },{onConflict:"workspace_id,contact_id"});

    const next={...context,node:"business_procurement",procurement_stage:stage,triage_department:"compras",
      supplier_company:s.company||null,supplier_contact_name:s.contact||null,supplier_proposal_status:status,
      turn:Number(context?.turn||0)+1};
    await db.from("wa_contacts").update({
      bot_enabled:!handoff,bot_context:{...next,...(handoff?{manual_pause:true,human_takeover_until:null}:{})},updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await db.from("wa_conversations").update({
      status:handoff?"aguardando_atendente":"aberta",department:"compras",
      tags:[...new Set([...(Array.isArray(triage.tags)?triage.tags:[]),"fornecedor","proposta_comercial"])],
      handoff_summary:handoff?"Proposta qualificada e pronta para pagamento. Empresa: "+(s.company||"não informada")+".":"Fornecedor em qualificação automática. Etapa: "+stage+".",
      routing_updated_at:new Date().toISOString()
    }).eq("id",conv.id);
    await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
    return json({ok:true,queued:true,self_service:!handoff,handoff,department:"compras",procurement_stage:stage});
  }

  if(isAntennaMaterialPriceQuestion(text)){
    const reply=antennaMaterialMarketReply(text,String(context?.quote_customer_name||""));
    await db.from("wa_contacts").update({
      bot_context:{...context,node:"welcome",quote_last_service:"antenna_materials",turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
    return json({ok:true,queued:true,antenna_material_fixed_price:true});
  }

  if(/^\?+$/.test(String(text||"").trim())){
    const {data:recentIn}=await db.from("wa_messages")
      .select("content,created_at")
      .eq("conversation_id",conv.id)
      .eq("direction","in")
      .order("created_at",{ascending:false})
      .limit(8);
    const previous=(recentIn||[]).find((m:any)=>String(m.content||"").trim() && !/^\?+$/.test(String(m.content||"").trim()));
    if(previous && isAntennaProductSaleQuestion(String(previous.content||""))){
      const reply=antennaProductSaleReply(String(context?.quote_customer_name||""));
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"welcome",awaiting_antenna_product_type:true,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
      return json({ok:true,queued:true,recovered_previous_question:true,antenna_product_quote:true});
    }
  }

  if(isAntennaProductSaleQuestion(text)){
    const reply=antennaProductSaleReply(String(context?.quote_customer_name||""));
    await db.from("wa_contacts").update({
      bot_context:{...context,node:"welcome",awaiting_antenna_product_type:true,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
    return json({ok:true,queued:true,antenna_product_quote:true});
  }

  if(context?.awaiting_antenna_product_type){
    const tprod=norm(text);
    if(/\b(parabolica|parabólica|receptor|satelite|satélite)\b/.test(tprod)){
      const nm=String(context?.quote_customer_name||"").trim();
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"welcome",awaiting_antenna_product_type:false,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,(nm?nm+", ":"")+"para eu cotar a antena parabólica corretamente, me diga se você quer só a antena ou o kit completo com LNBF. Se souber o tamanho, por exemplo 60 cm ou 75 cm, me fale também.","bot");
      return json({ok:true,queued:true,antenna_product_type:"satellite"});
    }
    if(/\b(digital|uhf|tv aberta|tv local)\b/.test(tprod)){
      const nm=String(context?.quote_customer_name||"").trim();
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"welcome",awaiting_antenna_product_type:false,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,(nm?nm+", ":"")+"para antena digital eu preciso saber se é interna ou externa e, se possível, sua cidade ou bairro. Aí eu consigo cotar o modelo adequado sem te passar um valor errado.","bot");
      return json({ok:true,queued:true,antenna_product_type:"digital"});
    }
  }

  const supplierIntent=/\b(distribuidor|distribuidora|fornecedor|representante comercial|represento uma empresa|responsavel por compras|responsável por compras|setor de compras|departamento de compras|comprador)\b/.test(norm(text));
  const supplierContext=context?.node==="supplier_intake"||context?.supplier_intake===true;
  if(supplierIntent||supplierContext){
    const tSupplier=norm(text);
    const onlyRequest=/\b(gostaria|quero|preciso|poderia|pode|indicar|falar|contato|responsavel|responsável|compras|distribuidor|distribuidora|fornecedor)\b/.test(tSupplier)
      && !/\b(catalogo|catálogo|produto|produtos|marca|marcas|tabela|preco|preços|empresa|cnpj|condicao|condição|prazo|entrega)\b/.test(tSupplier);
    const nextContext={
      ...context,
      node:"supplier_intake",
      supplier_intake:true,
      awaiting_quote_name:false,
      awaiting_quote_service:false,
      quote_pending_text:null,
      turn:Number(context?.turn||0)+1
    };
    await db.from("wa_contacts").update({bot_context:nextContext,updated_at:new Date().toISOString()}).eq("id",contact.id);

    if(onlyRequest||supplierIntent){
      await queueOut(
        wid,conv.id,contact.id,phone,
        "Claro. Para encaminhar corretamente ao responsável por compras, me informe:\n\n1 - Nome da empresa ou distribuidora\n2 - Quais produtos e marcas você fornece\n3 - Cidade e estado\n4 - Catálogo, tabela de preços e condições comerciais\n\nPode mandar essas informações, fotos, PDF ou o catálogo por aqui. Assim eu organizo tudo e encaminho ao responsável sem você precisar repetir.",
        "bot"
      );
      return json({ok:true,queued:true,supplier_intake:true,waiting_supplier_details:true});
    }

    await queueOut(
      wid,conv.id,contact.id,phone,
      "Obrigado. Registrei suas informações comerciais. Se tiver catálogo, tabela de preços ou apresentação da empresa, envie por aqui. Depois disso eu encaminho o material completo ao responsável por compras.",
      "bot"
    );
    return json({ok:true,queued:true,supplier_intake:true,supplier_details_received:true});
  }

  if(!childTenant && context?.awaiting_quote_name){
    const customerName=cleanQuoteCustomerName(text);
    if(!customerName){
      await queueOut(wid,conv.id,contact.id,phone,"Para eu montar o orçamento certinho, me diga somente o seu nome.","bot");
      return json({ok:true,queued:true,awaiting_quote_name:true});
    }

    const pendingText=String(context?.quote_pending_text||"");
    const pendingQuote=quoteServiceFromText(pendingText);
    if(pendingQuote){
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"welcome",quote_customer_name:customerName,awaiting_quote_name:false,awaiting_quote_service:false,quote_pending_text:null,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,quoteWithName(customerName,pendingQuote),"bot");
      return json({ok:true,queued:true,quote_name_captured:true,specific_quote:true});
    }

    await db.from("wa_contacts").update({
      bot_context:{...context,node:"welcome",quote_customer_name:customerName,awaiting_quote_name:false,awaiting_quote_service:true,quote_pending_text:null,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,customerName+", agora me diga qual serviço você quer consultar o valor. Pode ser IPTV, CS, antena, câmera, Starlink, motor de portão, cerca elétrica, alarme, fechadura, instalação de TV ou conserto de receptor.","bot");
    return json({ok:true,queued:true,quote_name_captured:true,awaiting_quote_service:true});
  }

  if(!childTenant && context?.awaiting_quote_service){
    const serviceQuote=quoteServiceFromText(text);
    if(serviceQuote){
      const customerName=String(context?.quote_customer_name||"").trim();
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"welcome",awaiting_quote_service:false,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,quoteWithName(customerName,serviceQuote),"bot");
      return json({ok:true,queued:true,specific_quote:true});
    }
    await queueOut(wid,conv.id,contact.id,phone,(context?.quote_customer_name?String(context.quote_customer_name)+", ":"")+"me diga qual serviço você quer consultar para eu passar somente o valor dele.","bot");
    return json({ok:true,queued:true,awaiting_quote_service:true});
  }

  if(!childTenant && isGeneralQuoteRequest(text)){
    const customerName=String(context?.quote_customer_name||"").trim();
    if(!customerName){
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"welcome",awaiting_quote_name:true,awaiting_quote_service:false,quote_pending_text:text,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"Claro. Antes de eu montar seu orçamento, qual é o seu nome?","bot");
      return json({ok:true,queued:true,general_quote:true,awaiting_quote_name:true});
    }

    await db.from("wa_contacts").update({
      bot_context:{...context,node:"welcome",awaiting_quote_service:true,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,customerName+", qual serviço você quer consultar o valor?","bot");
    return json({ok:true,queued:true,general_quote:true,awaiting_quote_service:true});
  }

  const directServiceQuote=!childTenant?quoteServiceFromText(text):"";
  if(directServiceQuote && /\b(valor|valores|preco|precos|preço|preços|quanto|custa|fica|orcamento|orçamento)\b/.test(norm(text))){
    const customerName=String(context?.quote_customer_name||"").trim();
    if(!customerName){
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"welcome",awaiting_quote_name:true,awaiting_quote_service:false,quote_pending_text:text,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"Claro. Antes de eu passar o orçamento, qual é o seu nome?","bot");
      return json({ok:true,queued:true,direct_service_quote:true,awaiting_quote_name:true});
    }

    await db.from("wa_contacts").update({
      bot_context:{...context,node:"welcome",awaiting_quote_service:false,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,quoteWithName(customerName,directServiceQuote),"bot");
    return json({ok:true,queued:true,direct_service_quote:true});
  }

  const exactCalc=!childTenant?exactBusinessCalculationReply(text):"";
  if(exactCalc){
    await db.from("wa_contacts").update({
      bot_context:{...context,node:"welcome",turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,quoteWithName(String(context?.quote_customer_name||""),exactCalc),"bot");
    return json({ok:true,queued:true,exact_calculation:true});
  }

  if(!childTenant && isLocalServicePriceQuestion(text)){
    const priceReply=await regionalServicePriceReply(text);
    if(priceReply){
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"welcome",turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,priceReply,"ai");
      return json({ok:true,queued:true,regional_price_research:true});
    }
  }

  const currentNode=String(context?.node||"");
  const structuredNode=isStructuredConversationNode(currentNode);
  const expectedStructured=structuredNode ? structuredInputExpected(currentNode,text,context) : true;
  const topicShift=structuredNode && !expectedStructured;

  if(topicShift){
    const geoEarly=!childTenant?await locationConversationReply(text,context,phone):null;
    if(geoEarly?.handled){
      const newContext={...context,turn:Number(context?.turn||0)+1,awaiting_location:!!geoEarly.awaiting_location,...(geoEarly.location?{customer_location:geoEarly.location}:{})};
      await db.from("wa_contacts").update({bot_context:newContext,updated_at:new Date().toISOString()}).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,geoEarly.reply,"bot");
      return json({ok:true,queued:true,interrupted_flow:true,geo:true});
    }

    const aiReply=await aiFallback(wid,conv.id,contact.id,text,context);
    if(aiReply){
      await db.from("wa_contacts").update({
        bot_context:{...context,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,aiReply,"ai");
      return json({ok:true,queued:true,interrupted_flow:true,ai:true});
    }
  }

  const cleanGreeting=norm(String(routedText||"").trim());
  const greetingToken=cleanGreeting.replace(/[!.,?]+/g,"").replace(/\s+/g," ").trim();
  const explicitBomDia=/^bom+ dia+$/.test(greetingToken);
  const explicitBoaTarde=/^boa+ tarde+$/.test(greetingToken);
  const explicitBoaNoite=/^boa+ noite+$/.test(greetingToken);
  const simpleHello=/^(oi+|ola+|opa+)$/.test(greetingToken);
  const startsNewConversation=explicitBomDia||explicitBoaTarde||explicitBoaNoite||simpleHello;
  if(startsNewConversation&&!context?.initial_greeting_sent&&Number(context?.turn||0)===0){
    let periodGreeting="";
    if(explicitBomDia)periodGreeting="Bom dia";
    else if(explicitBoaTarde)periodGreeting="Boa tarde";
    else if(explicitBoaNoite)periodGreeting="Boa noite";
    else{
      const hourText=new Intl.DateTimeFormat("pt-BR",{
        timeZone:"America/Sao_Paulo",
        hour:"2-digit",
        hourCycle:"h23"
      }).format(new Date());
      const brazilHour=Number(hourText);
      periodGreeting=brazilHour>=5&&brazilHour<12
        ? "Bom dia"
        : brazilHour>=12&&brazilHour<18
        ? "Boa tarde"
        : "Boa noite";
    }
    const greetingReply=periodGreeting+"! Como posso ajudar?";
    const baseAutomation=(autos||[])[0];
    await db.from("wa_contacts").update({
      bot_context:{
        automation_id:baseAutomation?.id||null,
        node:"welcome",
        turn:Number(context?.turn||0)+1,
        manual_pause:false,
        human_takeover_until:null,
        universal_mode:true
      },
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,greetingReply,"bot");
    return json({ok:true,queued:true,new_conversation:true});
  }

  // Modo universal: para conversa livre, a IA entende o histórico antes dos menus.
  // Fluxos rígidos ficam somente para escolha numérica ou pedido operacional explícito.
  const universalText=norm(routedText);
  const exactMenuChoice=/^(?:0|[1-9]|10)$/.test(universalText);
  const explicitOperationalRequest=!childTenant&&(
    /\b(quero|gostaria|preciso|desejo|pode|consegue|manda|mandar|me passa|passa|libera|liberar|fazer|pedir|solicitar|gerar)\b.{0,45}\b(teste|testar|renovar|renovacao|pix|preco|precos|valor|valores|tabela|plano|planos|atendente|humano)\b/.test(universalText)
    || /\b(quanto custa|qual o valor|tabela de preco|tabela de precos|chave pix|falar com atendente|falar com uma pessoa)\b/.test(universalText)
  );
  const awaitingStructuredInput=structuredNode && expectedStructured;

  const supportConversation=!childTenant&&(shouldAIFirstForSupport(routedText) || String(context?.node||"").startsWith("support"));

  if(!exactMenuChoice && !explicitOperationalRequest && !awaitingStructuredInput && !supportConversation){
    const universalReply=await aiFallback(wid,conv.id,contact.id,routedText,context);
    if(universalReply){
      await db.from("wa_contacts").update({
        bot_context:{
          ...context,
          node:"welcome",
          turn:Number(context?.turn||0)+1,
          universal_mode:true
        },
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,universalReply,"ai");
      return json({ok:true,queued:true,universal_ai:true});
    }
    if(childTenant){
      const tenantSummary=String(context?.support_summary||context?.triage_summary||"").trim();
      const tenantFallback=tenantSummary
        ?"Certo, continuo pelo assunto que você já informou: "+tenantSummary+". Me diga só o resultado do último passo que eu sigo daqui."
        :"Pode falar, tô acompanhando por aqui. Me diga o que você precisa resolver agora.";
      await queueOut(wid,conv.id,contact.id,phone,tenantFallback,"bot",{tenant_general_mode:true,ai_unavailable:true,local_state_fallback:true});
      return json({ok:true,queued:true,universal_ai:false,tenant_general_mode:true,ai_unavailable:true});
    }
  }

  if(supportConversation){
    const brain=await supportConversationBrain(conv.id,routedText,context);
    const aiReply=brain?.reply?null:await aiFallback(wid,conv.id,contact.id,routedText,context);
    const answer=brain?.reply||aiReply;
    if(answer){
      await db.from("wa_contacts").update({
        bot_context:{
          ...context,
          node:"support",
          support_app:brain?.app||context?.support_app||"",
          support_stage:brain?.nextStage||context?.support_stage||"collecting_problem",
          support_summary:brain?.summary||context?.support_summary||String(routedText||"").trim(),
          turn:Number(context?.turn||0)+1
        },
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,answer,aiReply?"ai":"bot",{
        conversation_brain:true,
        support_stage:brain?.nextStage||null
      });
      return json({ok:true,queued:true,conversation_brain:true,support_ai:!!aiReply,support_stage:brain?.nextStage||null});
    }
  }

  if(context?.node==="trial_followup_offer"){
    const t=norm(text);
    if(/\b(nao|não|agora nao|agora não|nao quero|não quero)\b/.test(t)){
      if(context?.trial_id){
        await db.from("wa_trial_sessions").update({status:"declined",updated_at:new Date().toISOString()}).eq("id",context.trial_id).eq("workspace_id",wid);
      }
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"welcome",turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"Certo. Se quiser contratar depois, é só me chamar por aqui.","bot");
      return json({ok:true,queued:true,trial_declined:true});
    }
    if(/\b(sim|quero|gostei|fechar|contratar|pacote|plano|valores|precos|preços)\b/.test(t)){
      const screens=Number(context?.requested_screens||contact.requested_screens||1);
      const {data:prices}=await db.from("wa_plan_prices").select("plan_days,amount")
        .eq("workspace_id",wid).eq("service_type","iptv").eq("screen_count",screens).eq("enabled",true)
        .order("plan_days",{ascending:true});
      if(!(prices||[]).length){
        await queueOut(wid,conv.id,contact.id,phone,"O teste está salvo com "+screens+" telas, mas ainda não existe uma tabela automática de valores cadastrada para essa quantidade. Não vou inventar preço. O atendimento precisa cadastrar esse valor antes de fechar o pacote.","bot");
        return json({ok:true,queued:true,trial_price_missing:true});
      }
      const lines=(prices||[]).map((p:any,i:number)=>(i+1)+" - "+planLabel(Number(p.plan_days))+" - "+moneyBR(p.amount));
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"trial_choose_plan",turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"Estes são os planos disponíveis para "+(screens===1?"1 tela":screens+" telas")+":\n\n"+lines.join("\n")+"\n\nMe diga o número ou o nome do plano que deseja.","bot");
      return json({ok:true,queued:true,trial_choose_plan:true});
    }
    await queueOut(wid,conv.id,contact.id,phone,"Me diga se quer fechar um pacote após o teste. Pode responder sim ou não.","bot");
    return json({ok:true,queued:true,trial_followup_waiting:true});
  }

  if(context?.node==="trial_choose_plan"){
    const days=parsePlanDays(text);
    if(!days){
      await queueOut(wid,conv.id,contact.id,phone,"Escolha um plano: 1 Mensal, 2 Trimestral, 3 Semestral ou 4 Anual.","bot");
      return json({ok:true,queued:true,trial_plan_waiting:true});
    }
    const screens=Number(context?.requested_screens||contact.requested_screens||1);
    const [{data:price},{data:trial}]=await Promise.all([
      db.from("wa_plan_prices").select("amount").eq("workspace_id",wid).eq("service_type","iptv")
        .eq("screen_count",screens).eq("plan_days",days).eq("enabled",true).maybeSingle(),
      context?.trial_id
        ? db.from("wa_trial_sessions").select("*").eq("id",context.trial_id).eq("workspace_id",wid).maybeSingle()
        : Promise.resolve({data:null} as any)
    ]);
    if(!price){
      await queueOut(wid,conv.id,contact.id,phone,"Esse plano ainda não tem valor automático cadastrado para a quantidade de telas deste cliente. Não vou criar cobrança com valor incorreto.","bot");
      return json({ok:true,queued:true,trial_plan_price_missing:true});
    }
    if(!trial?.connector_id||!trial?.username){
      await queueOut(wid,conv.id,contact.id,phone,"O teste foi localizado, mas faltam os dados do painel usados na criação. Vou manter a venda pendente para não ativar no painel errado.","bot");
      return json({ok:true,queued:true,trial_missing_panel_data:true});
    }

    const {data:account}=await db.from("wa_panel_accounts").select("id")
      .eq("workspace_id",wid).eq("connector_id",trial.connector_id).eq("username",trial.username).maybeSingle();
    const pay=await db.from("wa_payments").insert({
      workspace_id:wid,contact_id:contact.id,conversation_id:conv.id,
      connector_id:trial.connector_id,panel_account_id:account?.id||null,
      app_catalog_id:trial.app_catalog_id||null,app_name:trial.app_name||null,
      username:trial.username,plan_days:days,screen_count:screens,
      amount:price.amount,method:"pix",status:"pendente",
      reference:"IPTV "+planLabel(days)+" - "+trial.username,
      metadata:{source:"trial_conversion",trial_id:trial.id}
    }).select("*").single();
    if(pay.error)throw pay.error;

    await db.from("wa_trial_sessions").update({status:"awaiting_payment",updated_at:new Date().toISOString()}).eq("id",trial.id);
    await db.from("wa_contacts").update({
      bot_context:{...context,node:"awaiting_payment",payment_id:pay.data.id,plan_days:days,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);

    const auto=(autos||[])[0];
    const pixNode=auto?.flow?.nodes?.pix_payment;
    const pixText=pixNode?String(pixNode.text||"").replace(/\\n/g,"\n").trim():"";
    await queueOut(wid,conv.id,contact.id,phone,
      "Plano escolhido: "+planLabel(days)+".\nValor: "+moneyBR(price.amount)+".\nTelas: "+screens+"."+ 
      (pixText?"\n\n"+pixText:"\n\nEnvie o comprovante por aqui depois do pagamento."),
      "bot");
    return json({ok:true,queued:true,payment_created:true});
  }

  const invalidAccountProblem=isAppInvalidAccountProblem(text);
  if(invalidAccountProblem){
    const greeting=customerGreeting(text);
    const knownApp=String(context?.app_name||context?.support_app||"").trim();
    const reply=(greeting?greeting+" ":"")+"Entendi, a conta está aparecendo como inválida."
      +(knownApp
        ?" Como você está usando o "+knownApp+", envie uma foto ou um vídeo mostrando a tela e a mensagem completa para eu verificar."
        :" Qual aplicativo você está usando? Depois me envie uma foto ou um vídeo mostrando a tela e a mensagem completa para eu verificar.");
    await db.from("wa_contacts").update({
      bot_context:{...context,node:"awaiting_app_invalid_media",issue:"account_invalid",turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,reply,"bot");
    return json({ok:true,queued:true,account_invalid_support:true,waiting_app:!knownApp});
  }

  if(context?.node==="awaiting_app_invalid_media"){
    const candidate=String(text||"").replace(/\s+/g," ").trim();
    const generic=/\b(conta|acesso|dados|login|usuario|senha)\b.*\b(invalid|invalida|invalido|erro)\b/i.test(norm(candidate));
    if(!generic&&candidate.length>=2&&candidate.length<=70){
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"awaiting_app_invalid_media",issue:"account_invalid",app_name:candidate,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"Certo, é no "+candidate+". Agora me envie uma foto ou um vídeo mostrando a tela inteira e a mensagem de conta inválida para eu analisar.","bot");
      return json({ok:true,queued:true,account_invalid_app_saved:true,app_name:candidate});
    }
  }

  const accountProblem=isPanelAccountProblem(text);
  const waitingPanelUsername=context?.awaiting_panel_username===true;
  const explicitUsernameMention=/\b(usuario|usuário|user|login)\b/i.test(text)&&!!extractPanelUsername(text);
  if(accountProblem||waitingPanelUsername||explicitUsernameMention){
    let username=extractPanelUsername(text);
    if(!username&&accountProblem){
      const {data:lastAccount}=await db.from("wa_panel_accounts")
        .select("username").eq("workspace_id",wid).eq("contact_id",contact.id)
        .order("updated_at",{ascending:false}).limit(1).maybeSingle();
      username=String(lastAccount?.username||"").trim();
    }
    if(!username){
      await db.from("wa_contacts").update({
        bot_context:{...context,awaiting_panel_username:true,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,"Me envie o usuário ou login do acesso. Vou procurar esse cadastro nos painéis conectados e conferir status, vencimento e dados atuais.","bot");
      return json({ok:true,queued:true,waiting_panel_username:true});
    }
    const lookup=await queuePanelUserSearch(wid,contact.id,conv.id,username,accountProblem?"account_problem":"username_lookup");
    await db.from("wa_contacts").update({
      bot_context:{...context,awaiting_panel_username:false,last_panel_username:username,panel_search_group:lookup.group,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    if(!lookup.count){
      await queueOut(wid,conv.id,contact.id,phone,"Recebi o usuário, mas ainda não há painel com login automático validado para fazer a busca. Assim que os painéis forem conectados no administrador, essa consulta passa a ser automática.","bot");
      return json({ok:true,queued:true,panel_search_waiting_setup:true});
    }
    await queueOut(wid,conv.id,contact.id,phone,"Recebi o usuário. Estou procurando nos painéis conectados e conferindo vencimento e dados atuais. Assim que localizar, envio o resultado por aqui.","bot");
    return json({ok:true,queued:true,panel_search:true,count:lookup.count});
  }

  if(asksForAppCatalogList(text)){
    const catalog=await buildAppCatalogList(wid);
    const choices=catalog.rows.map((a:any)=>String(a.name||"")).filter(Boolean);
    await queueOut(wid,conv.id,contact.id,phone,catalog.reply,"bot");
    await db.from("wa_contacts").update({
      bot_context:{...context,node:"app_catalog_list",app_catalog_choices:choices,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    return json({ok:true,queued:true,app_catalog:true,count:choices.length});
  }

  if(context?.node==="app_catalog_list" && /^\s*\d{1,3}\s*$/.test(String(text||""))){
    const choices=Array.isArray(context?.app_catalog_choices)?context.app_catalog_choices:[];
    const pos=Number(String(text).trim())-1;
    const selectedApp=String(choices[pos]||"").trim();
    if(selectedApp){
      await queueOut(
        wid,conv.id,contact.id,phone,
        "Você escolheu "+selectedApp+". O que você precisa?\n\n1 - Ver a foto do aplicativo\n2 - Saber onde baixar\n3 - Configurar o aplicativo",
        "bot"
      );
      await db.from("wa_contacts").update({
        bot_context:{...context,node:"app_catalog_selected",app_name:selectedApp,turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      return json({ok:true,queued:true,app_catalog_selected:true,app_name:selectedApp});
    }
  }

  const requestedAppImage=await buildRequestedAppImage(wid,text,context);
  if(requestedAppImage?.handled){
    const appName=String(requestedAppImage.app?.name||"aplicativo");
    await queueOut(
      wid,conv.id,contact.id,phone,
      "Aqui está a imagem do "+appName+" para você localizar o aplicativo na sua TV.",
      "bot",
      {image_data_uri:requestedAppImage.dataUri,media_type:"image",file_name:appName.replace(/[^A-Za-z0-9_-]+/g,"-")+".jpg"}
    );
    await db.from("wa_contacts").update({
      bot_context:{...context,app_name:appName,node:"welcome",turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    return json({ok:true,queued:true,app_image:true,app_name:appName});
  }
  if(requestedAppImage&&!requestedAppImage.handled){
    const requestedName=String(requestedAppImage.app?.name||context?.app_name||"").trim();
    await db.from("wa_contacts").update({
      bot_context:{...context,...(requestedName?{app_name:requestedName}:{}),turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(
      wid,conv.id,contact.id,phone,
      requestedAppImage.reason==="app_not_found"
        ? "Não consegui identificar o nome do aplicativo. Escreva somente o nome dele que eu procuro a foto."
        : "Ainda não consegui baixar uma imagem válida do "+(requestedName||"aplicativo")+". Vou manter esse nome salvo e tentar novamente quando você pedir a foto, sem mudar de assunto.",
      "bot"
    );
    return json({ok:true,queued:true,app_image:false,reason:requestedAppImage.reason,app_name:requestedName||null});
  }

  const asksEverythingOrNews=/\b(novidade|novidades|promocao|promoção|promocoes|promoções|lancamento|lançamento)\b/.test(norm(text))
    || (/\b(manda|mandar|envia|enviar|mostra|mostrar|passa|passar|quero ver)\b/.test(norm(text))
      && /\b(tudo|todos|todas|opcoes|opções|produtos|servicos|serviços|o que tiver|que tiver)\b/.test(norm(text)));
  if(asksEverythingOrNews){
    const overview=await buildBusinessOverview(wid);
    await db.from("wa_contacts").update({
      bot_context:{...context,node:"business_overview_menu",app_name:null,support_app:null,app_catalog_id:null,turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,overview,"bot");
    return json({ok:true,queued:true,business_overview:true});
  }

  // Ajuda prática quando o cliente não sabe enviar foto ou vídeo.
  // Não repete o pedido: ensina o procedimento e oferece uma alternativa sem mídia.
  const mediaHelpText=norm(text);
  const needsMediaHelp=/\b(nao sei|não sei|nao consigo|não consigo|como faz|como faco|como faço|onde aperta|onde clico)\b/.test(mediaHelpText)
    && /\b(tirar|tira|mandar|enviar|foto|imagem|video|vídeo|gravar)\b/.test(mediaHelpText);
  if(needsMediaHelp){
    const wantsVideoHelp=/\b(video|vídeo|gravar)\b/.test(mediaHelpText);
    const helpReply=wantsVideoHelp
      ? "Sem problema. Abra a câmera do celular, mude para Vídeo e grave alguns segundos mostrando a tela e o problema. Depois volte aqui, toque no clipe ou na câmera ao lado da mensagem, escolha o vídeo e envie. Se não conseguir, pode escrever exatamente o que aparece na tela que eu continuo por aqui."
      : "Sem problema. Abra a câmera do celular e tire uma foto mostrando a tela inteira. Depois volte nesta conversa, toque no clipe ou na câmera ao lado da mensagem, escolha a foto e envie. Se não conseguir, procure o modelo na etiqueta atrás do aparelho ou em Configurações > Sobre e me escreva o que aparecer.";
    await db.from("wa_contacts").update({
      bot_context:{...context,node:context?.node||"welcome",turn:Number(context?.turn||0)+1},
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    await queueOut(wid,conv.id,contact.id,phone,helpReply,"bot");
    return json({ok:true,queued:true,media_help:true});
  }

  // Cérebro geral da conversa: entra antes dos menus antigos, mas somente depois
  // dos fluxos que executam ações concretas (pagamento, mídia, painel, catálogo etc.).
  // Assim uma frase escrita de outro jeito continua sendo entendida como conversa humana.
  const protectedConversationNodes=new Set([
    "trial_iptv","trial_iptv_app","trial_iptv_screens","trust_release",
    "supplier_intake","awaiting_app_invalid_media","app_catalog_list","app_catalog_selected"
  ]);
  const normalizedConversation=norm(text);
  const isStructuredAnswer=/^\s*(?:[0-9]{1,3}|sim|nao|não|voltar|atendente)\s*$/.test(normalizedConversation);
  const isOperationalConversation=protectedConversationNodes.has(String(context?.node||""))
    || !!sourceMatch
    || /^quero\b/.test(marketingCmd)
    || isStructuredAnswer;
  if(!isOperationalConversation){
    let intelligentReply:string|null=null;
    let aiError:any=null;
    try{
      intelligentReply=await aiFallback(wid,conv.id,contact.id,routedText,context);
    }catch(error){
      aiError=error;
      console.error("Erro crítico na chamada do Gemini",error);
    }

    if(intelligentReply){
      await db.from("wa_contacts").update({
        bot_context:{...context,node:context?.node||"welcome",turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,intelligentReply,"ai");
      return json({ok:true,status:"sucesso",queued:true,resposta:intelligentReply,conversation_brain:true,universal:false});
    }

    console.error("Falha técnica do Gemini na conversa geral",JSON.stringify({
      workspace_id:wid,
      conversation_id:conv.id,
      contact_id:contact.id,
      error:aiError?String(aiError):"empty_response"
    }));

    const fallbackContext={...context,company_name:runtimeCompany,agent_name:runtimeAgent};
    const respostaLocal=supportFallbackReply(routedText,fallbackContext)
      || naturalFallback(routedText,fallbackContext);
    await queueOut(wid,conv.id,contact.id,phone,respostaLocal,"bot",{local_state_fallback:true,ai_unavailable:true});
    return json({ok:true,status:"fallback_local",queued:true,resposta:respostaLocal,conversation_brain:true,ai_unavailable:true});
  }

  const trialFlowNodes=["trial_iptv","trial_iptv_app","trial_iptv_screens"];
  const partnerAppReply=trialFlowNodes.includes(String(context?.node||"")) ? null : await buildPartnerAppReply(wid,text,context);
  if(partnerAppReply){
    const panelRoute=await resolvePanelRouteForText(wid,text);
    const routeContext={
      ...context,
      turn:Number(context?.turn||0)+1,
      ...(panelRoute||{}),
      requested_screens:Number(contact.requested_screens||1)
    };
    await queueOut(wid,conv.id,contact.id,phone,partnerAppReply,"bot");
    await db.from("wa_contacts").update({
      bot_context:routeContext,
      updated_at:new Date().toISOString()
    }).eq("id",contact.id);
    return json({ok:true,queued:true,partner_app:true,panel_routed:!!panelRoute?.panel_connector_id});
  }

  if(sourceMatch && /^quero\b/.test(marketingCmd)){
    selected=(autos||[])[0]||null;
    const choice=(text.match(/^\s*QUERO\s*([123])\b/i)||[])[1]||"";
    if(choice==="1" && selected?.flow?.nodes?.receiver_help)nextKey="receiver_help";
    else if(choice==="2" && selected?.flow?.nodes?.iptv)nextKey="iptv";
    else if(choice==="3" && selected?.flow?.nodes?.reseller_panel_catalog)nextKey="reseller_panel_catalog";
    else if(selected?.flow?.nodes?.organic_lead_menu)nextKey="organic_lead_menu";
  }

  const immediateIntent=intentNode(text);
  if(immediateIntent==="pix_payment"){
    selected=(autos||[])[0]||selected;
    if(selected?.flow?.nodes?.pix_payment)nextKey="pix_payment";
  }

  if(!nextKey&&context.automation_id&&context.node){
    selected=(autos||[]).find((a:any)=>a.id===context.automation_id);
    if(selected){
      const current=selected.flow?.nodes?.[context.node];
      let opt=matchOption(current,text);

      if(context.node==="iptv_price_gate" && !opt){
        const tctx=norm(text);
        if(/\b(cliente|sou cliente|cliente final)\b/.test(tctx)){
          opt={next:"iptv_client_prices"};
        }else if(/\b(revenda|revendedor|sou revenda|quero revender|trabalho com revenda)\b/.test(tctx)){
          opt={next:"iptv_reseller_prices"};
        }
      }

      if(!opt && context.node==="trial_iptv" && structuredInputExpected("trial_iptv",text,context)){
        const savedName=String(context?.trial_customer_name||"").trim();
        if(!savedName){
          const customerName=String(text||"").replace(/\s+/g," ").trim();
          if(customerName.length<2 || /^\d+$/.test(customerName)){
            await queueOut(wid,conv.id,contact.id,phone,"Para iniciar o teste, preciso primeiro do seu nome. Digite seu nome, por favor.","bot");
            return json({ok:true,queued:true,trial_waiting_name:true});
          }
          const firstName=customerName.split(" ")[0];
          const nextContext={
            ...context,
            automation_id:selected.id,
            node:"trial_iptv",
            trial_customer_name:customerName,
            turn:Number(context?.turn||0)+1
          };
          await db.from("wa_contacts").update({
            name:customerName,
            bot_context:nextContext,
            updated_at:new Date().toISOString()
          }).eq("id",contact.id);
          await queueOut(
            wid,conv.id,contact.id,phone,
            "Obrigado, "+firstName+". Agora me diga qual aparelho vai usar no teste. Exemplo: Samsung, LG, TCL, Philips, Roku TV, Android TV, TV Box, Fire TV, celular, computador ou Xbox.",
            "bot"
          );
          return json({ok:true,queued:true,trial_waiting_device:true});
        }

        const route=await resolvePanelRouteForText(wid,text);
        const device=detectAppPlatform(text)||String(text||"").trim();
        const screens=parseRequestedScreens(text);
        const nextNode=route?.app_catalog_id ? "trial_iptv_screens" : "trial_iptv_app";
        const nextContext={
          ...context,automation_id:selected.id,node:nextNode,
          trial_device:device,
          ...(route||{}),
          requested_screens:screens||Number(contact.requested_screens||1),
          turn:Number(context?.turn||0)+1
        };
        const patch:any={bot_context:nextContext,device_type:device,updated_at:new Date().toISOString()};
        if(route?.app_name)patch.app_name=route.app_name;
        if(screens)patch.requested_screens=screens;
        await db.from("wa_contacts").update(patch).eq("id",contact.id);

        if(route?.app_catalog_id){
          if(screens){
            const exact=screens===1?"1 tela":screens+" telas";
            await queueOut(wid,conv.id,contact.id,phone,"Identifiquei o aplicativo "+route.app_name+" e anotei exatamente "+exact+". Esses dados ficaram salvos para o teste, sem criar tela extra.","bot");
            return json({ok:true,queued:true,trial_saved:true});
          }
          await queueOut(wid,conv.id,contact.id,phone,"Identifiquei o aplicativo "+route.app_name+". Agora me diga quantas telas você vai usar nesse teste. Exemplo: 1 tela ou 2 telas.","bot");
          return json({ok:true,queued:true,trial_waiting_screens:true});
        }

        await queueOut(wid,conv.id,contact.id,phone,"Anotei seu aparelho. Agora me diga qual aplicativo você já tem instalado. Se ainda não tiver nenhum, diga que não sabe e eu mostro as opções compatíveis.","bot");
        return json({ok:true,queued:true,trial_waiting_app:true});
      }

      if(!opt && context.node==="trial_iptv_app" && structuredInputExpected("trial_iptv_app",text,context)){
        let route:any=null;
        const numeric=String(text||"").trim().match(/^([1-9][0-9]?)$/);
        const savedChoices=Array.isArray(context?.trial_app_choices)?context.trial_app_choices:[];
        if(numeric&&savedChoices.length){
          const idx=Number(numeric[1])-1;
          if(idx>=0&&idx<savedChoices.length)route=savedChoices[idx];
        }
        if(!route)route=await resolvePanelRouteForText(wid,text);

        if(!route?.app_catalog_id || !route?.panel_connector_id || route?.panel_waiting_credentials){
          const choices=await readyTrialAppChoices(wid,String(context.trial_device||contact.device_type||""));
          if(!choices.length){
            await queueOut(
              wid,conv.id,contact.id,phone,
              "Ainda não há um painel automático validado para gerar esse teste. O pedido ficou no atendimento, mas não vou inventar aplicativo nem criar acesso no painel errado.",
              "bot"
            );
            return json({ok:true,queued:true,trial_waiting_panel_setup:true});
          }
          const list=choices.map((x:any,i:number)=>(i+1)+" - "+x.app_name).join("\n");
          await db.from("wa_contacts").update({
            bot_context:{...context,trial_app_choices:choices,turn:Number(context?.turn||0)+1},
            updated_at:new Date().toISOString()
          }).eq("id",contact.id);
          await queueOut(
            wid,conv.id,contact.id,phone,
            "Aplicativos disponíveis para teste neste aparelho:\n\n"+list+"\n\nResponda somente com o número do aplicativo que deseja usar.",
            "bot"
          );
          return json({ok:true,queued:true,trial_waiting_app:true,choices:choices.length});
        }

        const nextContext={
          ...context,automation_id:selected.id,node:"trial_iptv_screens",
          ...route,trial_app_choices:undefined,turn:Number(context?.turn||0)+1
        };
        await db.from("wa_contacts").update({
          bot_context:nextContext,app_name:route.app_name,updated_at:new Date().toISOString()
        }).eq("id",contact.id);
        await queueOut(wid,conv.id,contact.id,phone,route.app_name+" identificado. Agora me diga quantas telas você vai usar nesse teste. Exemplo: 1 tela ou 2 telas.","bot");
        return json({ok:true,queued:true,trial_waiting_screens:true});
      }

      if(!opt && context.node==="trial_iptv_screens" && structuredInputExpected("trial_iptv_screens",text,context)){
        const screens=parseRequestedScreens(text);
        if(!screens){
          await queueOut(wid,conv.id,contact.id,phone,"Preciso somente da quantidade exata de telas para não criar acesso a mais. Me responda, por exemplo: 1 tela ou 2 telas.","bot");
          return json({ok:true,queued:true,trial_waiting_screens:true});
        }
        const nextContext={
          ...context,requested_screens:screens,turn:Number(context?.turn||0)+1
        };
        await db.from("wa_contacts").update({
          bot_context:nextContext,requested_screens:screens,updated_at:new Date().toISOString()
        }).eq("id",contact.id);

        if(context?.panel_connector_id){
          const {data:panel}=await db.from("wa_panel_connectors")
            .select("id,enabled,credential_secret_id,last_status")
            .eq("id",context.panel_connector_id).eq("workspace_id",wid).maybeSingle();
          const ready=!!(panel?.enabled&&panel?.credential_secret_id&&panel?.last_status==="driver_ready");
          await db.from("wa_panel_jobs").insert({
            workspace_id:wid,contact_id:contact.id,conversation_id:conv.id,
            connector_id:context.panel_connector_id,action_type:"test",
            app_catalog_id:context.app_catalog_id||null,app_name:context.app_name||null,
            panel_app_code:context.panel_app_code||null,device_type:context.trial_device||contact.device_type||null,
            screen_count:screens,
            customer_name:String(context?.trial_customer_name||contact.name||"").trim()||null,
            customer_phone:phone,
            status:ready?"pending":"waiting_setup",
            payload:{source:"whatsapp",exact_screens:screens,customer_name:String(context?.trial_customer_name||contact.name||"").trim()||null}
          });
        }

        const exact=screens===1?"1 tela":screens+" telas";
        await queueOut(wid,conv.id,contact.id,phone,"Perfeito  Anotei exatamente "+exact+". O pedido do teste ficou salvo com essa quantidade exata, sem duplicar telas.","bot");
        return json({ok:true,queued:true,trial_saved:true});
      }

      if(opt?.next){
        nextKey=opt.next;
      }else if(context.node==="trust_release"){
        await db.from("wa_pending_actions").insert({
          workspace_id:wid,contact_id:contact.id,action_type:"trust_release",
          payload:{identifier:text,requester_phone:phone,conversation_id:conv.id},
          status:"aguardando_execucao"
        });
        const reply="Certo  Recebi seu usuário. Estou verificando a liberação de confiança agora. Se estiver tudo certo com o número cadastrado, a confirmação chega por aqui.";
        await queueOut(wid,conv.id,contact.id,phone,reply);
        await db.from("wa_contacts").update({
          bot_context:{...context,automation_id:selected.id,node:"trust_release",awaiting:"trust_result",turn:Number(context?.turn||0)+1},
          updated_at:new Date().toISOString()
        }).eq("id",contact.id);
        return json({ok:true,queued_action:"trust_release"});
      }else if(!current?.free_chat){
        const protectedTrialNodes=new Set(["trial_iptv","trial_iptv_app","trial_iptv_screens"]);
        if(!protectedTrialNodes.has(String(context.node||""))){
          const opts=Array.isArray(current?.options)?current.options:[];
          const meaningful=opts.filter((o:any)=>!["0","5","9"].includes(String(o.key)));
          if(meaningful.length===0){
            const reply="Recebi as informações. Vou manter a conversa organizada para o atendimento continuar sem pedir os mesmos dados novamente.";
            await queueOut(wid,conv.id,contact.id,phone,reply);
            await db.from("wa_contacts").update({
          bot_enabled:false,
          bot_context:{
            ...context,
            node:"welcome",
            automation_id:context?.automation_id||null,
            manual_pause:true,
            human_takeover_until:null
          },
          updated_at:new Date().toISOString()
        }).eq("id",contact.id);
            await db.from("wa_conversations").update({status:"aguardando_atendente"}).eq("id",conv.id);
            return json({ok:true,handoff:true});
          }
        }
      }
    }
  }

  if(!nextKey){
    const geo=!childTenant?await locationConversationReply(text,context,phone):null;
    if(geo?.handled){
      const a=(autos||[])[0]||selected;
      const newContext={...context,...(a?.id?{automation_id:a.id}:{}),node:context?.node||"welcome",turn:Number(context?.turn||0)+1,awaiting_location:!!geo.awaiting_location,...(geo.location?{customer_location:geo.location}:{})};
      await db.from("wa_contacts").update({bot_context:newContext,updated_at:new Date().toISOString()}).eq("id",contact.id);
      await queueOut(wid,conv.id,contact.id,phone,geo.reply,"bot");
      return json({ok:true,queued:true,geo:true});
    }
  }

  if(!nextKey){
    const intent=intentNode(text);
    if(intent){
      selected=(autos||[])[0]||selected;
      const routedIntent=(intent==="services" && isLocalESDDD(phone) && selected?.flow?.nodes?.local_install_offer)
        ? "local_install_offer"
        : intent;
      if(selected?.flow?.nodes?.[routedIntent])nextKey=routedIntent;
    }
  }

  if(!nextKey){
    const t=norm(text);
    const triggered=(autos||[]).find((a:any)=>(a.trigger_texts||[]).some((x:string)=>norm(x)===t));
    if(triggered){
      selected=triggered;
      nextKey=triggered.flow?.start||"welcome";
    }
  }

  let reply="";
  if(selected&&nextKey){
    const node=selected.flow?.nodes?.[nextKey];
    if(node){
      reply=nextKey==="reseller_panel_catalog" ? await buildPanelCatalogReply() : renderNode(node);
      if(nextKey==="welcome"){
        const greetingNorm=norm(String(text||"").trim());
        const isGreeting=/^(oi|ola|bom dia|boa tarde|boa noite)$/.test(greetingNorm);
        const firstGreeting=isGreeting&&!context?.node;
        if(firstGreeting){
          reply=runtimeWelcome;
        }else if(isGreeting){
          reply="Pode falar, tô te acompanhando 😊";
        }else{
          reply=runtimeWelcome;
        }
      }
      if(node.type==="handoff"){
        await db.from("wa_contacts").update({
          bot_enabled:false,
          bot_context:{
            ...context,
            node:"welcome",
            manual_pause:true,
            human_takeover_until:null,
            turn:Number(context?.turn||0)+1
          },
          updated_at:new Date().toISOString()
        }).eq("id",contact.id);
        await db.from("wa_conversations").update({status:"aguardando_atendente"}).eq("id",conv.id);
      }else{
        await db.from("wa_contacts").update({
          bot_context:{...context,automation_id:selected.id,node:nextKey,turn:Number(context?.turn||0)+1},
          updated_at:new Date().toISOString()
        }).eq("id",contact.id);
      }
    }
  }

  let senderType="bot";
  if(!reply){
    const aiReply=await aiFallback(wid,conv.id,contact.id,routedText,context);
    const supportReply=context?.node==="support"?supportFallbackReply(routedText,context):"";
    const universalReply=aiReply?null:await universalWorkspaceReply(wid,routedText,context);
    reply=aiReply||supportReply||universalReply||naturalFallback(routedText,{...context,company_name:runtimeCompany,agent_name:runtimeAgent});
    senderType=aiReply?"ai":"bot";
    const a=(autos||[])[0];
    if(a?.flow?.nodes?.welcome){
      await db.from("wa_contacts").update({
        bot_context:{...context,automation_id:a.id,node:context?.node||"welcome",turn:Number(context?.turn||0)+1},
        updated_at:new Date().toISOString()
      }).eq("id",contact.id);
    }
  }

  await queueOut(wid,conv.id,contact.id,phone,reply,senderType);
  return json({ok:true,queued:true});
} catch(e:any) {
  return json({error:"internal"},500);
}
});
