import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const SUPABASE_URL = "https://fvttsguxeocisqvcrbqh.supabase.co";
const SUPABASE_KEY = "sb_publishable_0EBQukCnPwUwAFo5gzfl5g_Ycbw3dqN";
const BRIDGE_FUNCTION = "jstech-wa-bridge";
const USERNAME_LOGIN_URL = SUPABASE_URL + "/functions/v1/jstech-username-login";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function panelAdmin(body){
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw new Error("Sessão expirada. Entre novamente no painel.");
  const res=await fetch(SUPABASE_URL+"/functions/v1/jstech-panel-admin",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "apikey":SUPABASE_KEY,
      "Authorization":"Bearer "+session.access_token
    },
    body:JSON.stringify(body)
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data?.error)throw new Error(data?.error||("HTTP "+res.status));
  return data;
}

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = {
  session:null, workspace:null, settings:null, contacts:[], conversations:[], messages:[],
  automations:[], knowledge:[], campaigns:[], panels:[], panelApps:[], panelMappings:[], activePanel:null, activeConversation:null, activeAutomation:null,
  activeNode:null, editingKnowledge:null, channel:null, simNode:null, panelLoadError:null, bridgeManagedLocally:false, bridgeHosted:false, userRole:null
};

function toast(msg, type="success"){
  const el=$("#toast"); el.textContent=msg; el.className="toast "+type;
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.add("hidden"),3200);
}
function fmtDate(v){ if(!v)return "-"; return new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v)); }
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function initials(name, phone){const s=(name||phone||"J").trim();return s.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();}
function showLogin(msg=""){ $("#loginView").classList.remove("hidden"); $("#appView").classList.add("hidden"); $("#loginMsg").textContent=msg; }
function showApp(){ $("#loginView").classList.add("hidden"); $("#appView").classList.remove("hidden"); }
function pageMeta(page){
  return ({
    dashboard:["Visão geral","Dashboard"],conversations:["Atendimento","Conversas"],
    contacts:["CRM","Clientes"],campaigns:["Marketing","Transmissão"],
    organic:["Captação","Divulgação grátis"],panels:["Integrações","Painéis automáticos"],
    automation:["Fluxos e regras","Automação"],
    knowledge:["Conteúdo","Respostas prontas"],resellers:["Revenda","Revendedores"],settings:["Integrações","Configurações"]
  })[page];
}
function goPage(page){
  $$(".page").forEach(x=>x.classList.remove("active"));
  $("#page-"+page)?.classList.add("active");
  $$(".nav-item[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  const [e,t]=pageMeta(page); $("#pageEyebrow").textContent=e; $("#pageTitle").textContent=t;
}

async function login(username,password){
  const res=await fetch(USERNAME_LOGIN_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY},
    body:JSON.stringify({username,password})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||"Usuário ou senha inválidos.");
  const {error}=await sb.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
  if(error) throw error;
}
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); $("#loginMsg").textContent="Entrando...";
  try{await login($("#loginUsername").value.trim(),$("#loginPassword").value)}catch(err){$("#loginMsg").textContent=err.message||"Não foi possível entrar."}
});
$("#logoutBtn").addEventListener("click",()=>sb.auth.signOut());
$("#mainNav").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)goPage(b.dataset.page)});
$$("[data-go]").forEach(b=>b.addEventListener("click",()=>goPage(b.dataset.go)));
$("#refreshBtn").addEventListener("click",()=>loadAll(true));

async function boot(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){showLogin();return}
  state.session=session; showApp();
  const label=session.user.user_metadata?.username||session.user.user_metadata?.display_name||"J"; $("#userAvatar").textContent=String(label)[0].toUpperCase();
  await loadAll();
  subscribeRealtime();
}
sb.auth.onAuthStateChange(async(_event,session)=>{
  state.session=session;
  if(!session){state.channel?.unsubscribe();showLogin();return}
  showApp(); await loadAll(); subscribeRealtime();
});

async function ensureWorkspace(){
  const {data,error}=await sb.from("wa_workspaces").select("*").order("created_at").limit(1);
  if(error) throw error;
  if(data?.length){state.workspace=data[0];return}
  const uid=state.session.user.id;
  const {data:newWs,error:createErr}=await sb.from("wa_workspaces").insert({owner_id:uid,name:"JSTech Atendimento",slug:"jstech"}).select().single();
  if(createErr) throw createErr;
  state.workspace=newWs;
  await sb.from("wa_settings").insert({workspace_id:newWs.id,company_name:"JSTech"});
}
async function loadAll(showToast=false){
  try{
    await ensureWorkspace();
    const id=state.workspace.id;
    const [settings,contacts,convs,autos,knowledge,campaigns]=await Promise.all([
      sb.from("wa_settings").select("*").eq("workspace_id",id).single(),
      sb.from("wa_contacts").select("*").eq("workspace_id",id).order("updated_at",{ascending:false}),
      sb.from("wa_conversations").select("*,wa_contacts(id,name,phone,status,bot_enabled,notes)").eq("workspace_id",id).order("last_message_at",{ascending:false}),
      sb.from("wa_automations").select("*").eq("workspace_id",id).order("created_at"),
      sb.from("wa_knowledge").select("*").eq("workspace_id",id).order("title"),
      sb.from("wa_campaigns").select("*").eq("workspace_id",id).order("created_at",{ascending:true})
    ]);
    if(settings.error)throw settings.error;if(contacts.error)throw contacts.error;if(convs.error)throw convs.error;if(autos.error)throw autos.error;if(knowledge.error)throw knowledge.error;if(campaigns.error)throw campaigns.error;
    state.settings=settings.data;state.contacts=contacts.data||[];state.conversations=convs.data||[];state.automations=autos.data||[];state.knowledge=knowledge.data||[];state.campaigns=campaigns.data||[];
    const {data:alias}=await sb.from("wa_login_aliases").select("role").eq("auth_user_id",state.session.user.id).eq("workspace_id",id).maybeSingle();
    state.userRole=alias?.role||"owner";
    if(state.userRole==="reseller")state.bridgeHosted=true;
    if(!state.activeAutomation&&state.automations.length){state.activeAutomation=structuredClone(state.automations[0]);state.activeNode=state.activeAutomation.flow?.start||Object.keys(state.activeAutomation.flow?.nodes||{})[0]}
    await loadPanelConnectors(false);
    renderAll(); if(showToast)toast("Painel atualizado.");
  }catch(err){console.error(err);toast(err.message||"Erro ao carregar o painel.","error")}
}
function renderAll(){renderDashboard();renderConversations();renderContacts();renderCampaigns();renderOrganicLinks();renderPanelConnectors();renderAutomations();renderKnowledge();renderSettings();}

function renderDashboard(){
  const unread=state.conversations.reduce((n,c)=>n+(c.unread_count||0),0);
  $("#statConversations").textContent=state.conversations.length;$("#statUnread").textContent=unread;$("#statContacts").textContent=state.contacts.length;$("#statBot").textContent=state.contacts.filter(c=>c.bot_enabled).length;
  $("#navUnread").textContent=unread;$("#navUnread").classList.toggle("hidden",!unread);
  const connected=!!state.settings?.bridge_connected;
  $("#connectionDot").classList.toggle("on",connected);$("#connectionText").textContent=connected?"WhatsApp conectado":"WhatsApp não conectado";
  $("#dashMetaPill").className="pill "+(connected?"success":"warning");$("#dashMetaPill").textContent=connected?"Conectado":"Aguardando";
  $("#dashMetaLine").innerHTML=connected?"<b>✓</b><span>WhatsApp conectado por QR Code</span>":"<b>○</b><span>Conectar WhatsApp por QR Code</span>";
  $("#dashAiLine").innerHTML=state.settings?.ai_enabled
    ? "<b>✓</b><span>IA ativa + atendimento humano pelo painel</span>"
    : "<b>✓</b><span>Automação + atendimento humano pelo painel</span>";
}
function convFilter(c,q){const ct=c.wa_contacts||{};return !q||(ct.name||"").toLowerCase().includes(q)||(ct.phone||"").includes(q);}
function renderConversations(){
  const q=($("#conversationSearch")?.value||"").toLowerCase().trim(), list=$("#conversationList");
  const rows=state.conversations.filter(c=>convFilter(c,q));
  if(!rows.length){list.className="conversation-list empty-box";list.textContent="Nenhuma conversa ainda.";return}
  list.className="conversation-list"; list.innerHTML=rows.map(c=>{const ct=c.wa_contacts||{};return '<div class="conversation-item '+(state.activeConversation?.id===c.id?"active":"")+'" data-id="'+c.id+'"><div class="conversation-avatar">'+escapeHtml(initials(ct.name,ct.phone))+'</div><div class="conversation-info"><b>'+escapeHtml(ct.name||ct.phone||"Cliente")+'</b><span>'+escapeHtml(ct.phone||"")+'</span></div><div class="conversation-time">'+fmtDate(c.last_message_at)+(c.unread_count?'<span class="unread-dot">'+c.unread_count+'</span>':"")+"</div></div>"}).join("");
  $$("[data-id]",list).forEach(el=>el.addEventListener("click",()=>openConversation(el.dataset.id)));
}
$("#conversationSearch").addEventListener("input",renderConversations);
async function openConversation(id){
  const c=state.conversations.find(x=>x.id===id);if(!c)return;state.activeConversation=c;
  $(".chat-layout").classList.add("chat-open");$("#chatEmpty").classList.add("hidden");$("#chatActive").classList.remove("hidden");
  const ct=c.wa_contacts||{};$("#chatName").textContent=ct.name||ct.phone||"Cliente";$("#chatPhone").textContent=ct.phone||"";$("#toggleBotBtn").textContent=ct.bot_enabled?"🤖 IA ativa":"👤 Atendimento humano";
  $("#toggleBotBtn").classList.toggle("primary",ct.bot_enabled);
  renderContactDetails(ct,c);
  await sb.from("wa_conversations").update({unread_count:0}).eq("id",id);
  c.unread_count=0;renderDashboard();renderConversations();await loadMessages(id);
}
async function loadMessages(conversationId){
  const {data,error}=await sb.from("wa_messages").select("*").eq("conversation_id",conversationId).order("created_at");
  if(error){toast(error.message,"error");return}state.messages=data||[];renderMessages();
}
function renderMessages(){
  const box=$("#messageList");
  box.innerHTML=state.messages.map(m=>{
    const cls=m.direction==="in"?"in":"out "+(m.sender_type==="ai"?"ai":"");
    const who=m.direction==="in"?"Cliente":m.sender_type==="human"?"Atendente":m.sender_type==="ai"?"IA":"Automático";
    return '<div class="message '+cls+'">'+escapeHtml(m.content)+'<small>'+escapeHtml(who)+' • '+fmtDate(m.created_at)+'</small></div>';
  }).join("");
  box.scrollTop=box.scrollHeight;
}
function renderContactDetails(ct,c){
  const mode=ct.bot_enabled?"IA/automação ativa":"Atendimento humano";
  $("#contactDetails").innerHTML='<div class="contact-card"><div class="contact-row"><span>Nome</span><b>'+escapeHtml(ct.name||"Não informado")+'</b></div><div class="contact-row"><span>Telefone</span><b>'+escapeHtml(ct.phone||"-")+'</b></div><div class="contact-row"><span>Status</span><b>'+escapeHtml(c.status||ct.status||"aberta")+'</b></div><div class="contact-row"><span>Modo atual</span><b>'+mode+'</b></div></div>';
}
$("#composerForm").addEventListener("submit",async e=>{
  e.preventDefault();const text=$("#composerText").value.trim();if(!text||!state.activeConversation)return;
  const btn=e.submitter||$("#composerForm button[type='submit']");btn.disabled=true;
  try{
    const {data,error}=await sb.functions.invoke("jstech-wa-send",{body:{conversation_id:state.activeConversation.id,text}});
    if(error)throw error;if(data?.error)throw new Error(data.error==="whatsapp_not_connected"?"Conecte o número do WhatsApp primeiro.":data.error);
    $("#composerText").value="";
    const ct=state.activeConversation?.wa_contacts;
    if(ct){
      ct.bot_enabled=false;
      ct.bot_context={...(ct.bot_context||{}),human_takeover_until:new Date(Date.now()+3*60*1000).toISOString(),manual_pause:false};
    }
    state.activeConversation.status="atendimento_humano";
    $("#toggleBotBtn").textContent="👤 Atendimento humano";
    $("#toggleBotBtn").classList.remove("primary");
    renderContactDetails(ct||{},state.activeConversation);
    await loadMessages(state.activeConversation.id);
    toast("Mensagem enviada. A IA espera 3 minutos e volta sozinha se o atendimento humano parar.");
  }catch(err){toast(err.message||"Falha ao enviar.","error")}finally{btn.disabled=false}
});
$("#composerText").addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){
    e.preventDefault();
    $("#composerForm").requestSubmit();
  }
});
$("#toggleBotBtn").addEventListener("click",async()=>{
  const ct=state.activeConversation?.wa_contacts;if(!ct)return;const value=!ct.bot_enabled;
  const now=new Date().toISOString();
  const nextContext=value?{}:{...(ct.bot_context||{}),manual_pause:true,human_takeover_until:null};
  const [{error},convUpdate]=await Promise.all([
    sb.from("wa_contacts").update({bot_enabled:value,bot_context:nextContext,updated_at:now}).eq("id",ct.id),
    sb.from("wa_conversations").update({status:value?"aberta":"atendimento_humano"}).eq("id",state.activeConversation.id)
  ]);
  if(error){toast(error.message,"error");return}
  ct.bot_enabled=value;
  ct.bot_context=nextContext;
  state.activeConversation.status=value?"aberta":"atendimento_humano";
  $("#toggleBotBtn").textContent=value?"🤖 IA ativa":"👤 Atendimento humano";
  $("#toggleBotBtn").classList.toggle("primary",value);
  renderContactDetails(ct,state.activeConversation);renderContacts();
  toast(value?"IA reativada nesta conversa.":"Você assumiu o atendimento. A IA foi pausada.");
});

function renderContacts(){
  const q=($("#contactSearch")?.value||"").toLowerCase().trim();
  $("#contactsTable").innerHTML=state.contacts.filter(c=>!q||(c.name||"").toLowerCase().includes(q)||(c.phone||"").includes(q)).map(c=>'<tr><td><b>'+escapeHtml(c.name||"Sem nome")+'</b></td><td>'+escapeHtml(c.phone)+'</td><td>'+escapeHtml(c.status||"novo")+'</td><td><button class="toggle-chip '+(c.bot_enabled?"on":"")+'" data-contact-bot="'+c.id+'">'+(c.bot_enabled?"Ativo":"Pausado")+'</button></td><td><button class="toggle-chip '+(c.marketing_opt_in&&!c.marketing_opt_out_at?"on":"")+'" data-marketing="'+c.id+'">'+(c.marketing_opt_in&&!c.marketing_opt_out_at?"Autorizado":"Não autorizado")+'</button></td><td>'+fmtDate(c.updated_at)+'</td></tr>').join("");
  $$("[data-contact-bot]").forEach(b=>b.addEventListener("click",()=>toggleContactBot(b.dataset.contactBot)));
  $$("[data-marketing]").forEach(b=>b.addEventListener("click",()=>toggleMarketing(b.dataset.marketing)));
}
$("#contactSearch").addEventListener("input",renderContacts);
async function toggleContactBot(id){const c=state.contacts.find(x=>x.id===id);if(!c)return;const value=!c.bot_enabled;const ctx=value?{}:{...(c.bot_context||{}),manual_pause:true,human_takeover_until:null};const {error}=await sb.from("wa_contacts").update({bot_enabled:value,bot_context:ctx,updated_at:new Date().toISOString()}).eq("id",id);if(error)return toast(error.message,"error");c.bot_enabled=value;c.bot_context=ctx;renderContacts();renderDashboard()}
async function toggleMarketing(id){
  const c=state.contacts.find(x=>x.id===id);if(!c)return;
  const value=!(c.marketing_opt_in&&!c.marketing_opt_out_at);
  if(value&&!confirm("Confirme somente se este cliente autorizou receber ofertas pelo WhatsApp."))return;
  const patch=value
    ? {marketing_opt_in:true,marketing_opt_in_at:new Date().toISOString(),marketing_opt_out_at:null,marketing_source:"autorizado_no_painel",updated_at:new Date().toISOString()}
    : {marketing_opt_in:false,marketing_opt_out_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {error}=await sb.from("wa_contacts").update(patch).eq("id",id);
  if(error)return toast(error.message,"error");
  Object.assign(c,patch);renderContacts();renderCampaigns();
  toast(value?"Cliente autorizado para transmissão.":"Transmissão desativada para este cliente.");
}

function renderCampaigns(){
  const camp=state.campaigns[0];
  const eligible=state.contacts.filter(c=>c.marketing_opt_in&&!c.marketing_opt_out_at).length;
  if($("#campaignEligible"))$("#campaignEligible").textContent=eligible;
  if($("#transmissionContactsTotal"))$("#transmissionContactsTotal").textContent=state.contacts.length;
  if($("#lastContactSync"))$("#lastContactSync").textContent=state.settings?.last_contact_sync_at
    ? fmtDate(state.settings.last_contact_sync_at)+" • "+Number(state.settings?.last_contact_sync_count||0)+" contatos"
    : "Ainda não sincronizado";
  if($("#contactSyncStatus")){
    $("#contactSyncStatus").className="pill "+(state.settings?.bridge_connected?"success":"warning");
    $("#contactSyncStatus").textContent=state.settings?.bridge_connected?"Ativa":"WhatsApp desconectado";
  }
  if(!camp){
    if($("#campaignStatus"))$("#campaignStatus").textContent="Desativada";
    if($("#campaignLastSent"))$("#campaignLastSent").textContent="Ainda não enviada";
    return;
  }
  if($("#campaignName"))$("#campaignName").value=camp.name||"";
  if($("#campaignMessage"))$("#campaignMessage").value=camp.message||"";
  if($("#campaignHour"))$("#campaignHour").value=String(camp.daily_hour??12);
  if($("#campaignEnabled"))$("#campaignEnabled").checked=!!camp.enabled;
  if($("#campaignStatus"))$("#campaignStatus").textContent=camp.enabled
    ? "Automática • diária • "+String(camp.daily_hour??12).padStart(2,"0")+":00"
    : "Manual";
  if($("#campaignLastSent"))$("#campaignLastSent").textContent=camp.last_sent_at?fmtDate(camp.last_sent_at):"Ainda não enviada";
  if(camp.image_data_uri){
    $("#campaignImagePreview").src=camp.image_data_uri;
    $("#campaignImagePreviewWrap")?.classList.remove("hidden");
  }else{
    $("#campaignImagePreview")?.removeAttribute("src");
    $("#campaignImagePreviewWrap")?.classList.add("hidden");
  }
}

function readCampaignImage(){
  const file=$("#campaignImage")?.files?.[0];
  if(!file)return Promise.resolve(state.campaigns[0]?.image_data_uri||null);
  if(file.size>3*1024*1024)return Promise.reject(new Error("A imagem deve ter no máximo 3 MB."));
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>resolve(String(fr.result||""));
    fr.onerror=()=>reject(new Error("Não foi possível ler a imagem."));
    fr.readAsDataURL(file);
  });
}
$("#campaignImage")?.addEventListener("change",async()=>{
  try{
    const img=await readCampaignImage();
    if(img){
      $("#campaignImagePreview").src=img;
      $("#campaignImagePreviewWrap")?.classList.remove("hidden");
    }
  }catch(err){toast(err.message||"Falha ao carregar imagem.","error")}
});

async function saveTransmission(){
  let camp=state.campaigns[0];
  let imageData=null;
  try{imageData=await readCampaignImage()}catch(err){throw new Error(err.message||"Imagem inválida.")}
  const payload={
    workspace_id:state.workspace.id,
    name:$("#campaignName").value.trim()||"Transmissão JSTech",
    message:$("#campaignMessage").value.trim(),
    enabled:$("#campaignEnabled").checked,
    cadence:"daily",
    daily_hour:Number($("#campaignHour").value||12),
    ddd_filter:[],
    image_data_uri:imageData,
    updated_at:new Date().toISOString()
  };
  if(!payload.message)throw new Error("Escreva a mensagem da transmissão.");
  const eligible=state.contacts.filter(c=>c.marketing_opt_in&&!c.marketing_opt_out_at).length;
  if(payload.enabled&&eligible===0){
    $("#campaignEnabled").checked=false;
    payload.enabled=false;
    throw new Error("Nenhum contato está autorizado para transmissão. Marque os autorizados na aba Clientes.");
  }
  let result;
  if(camp){
    result=await sb.from("wa_campaigns").update(payload).eq("id",camp.id).select().single();
  }else{
    result=await sb.from("wa_campaigns").insert(payload).select().single();
  }
  if(result.error)throw result.error;
  state.campaigns=[result.data];
  renderCampaigns();
  return result.data;
}

$("#campaignForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=e.submitter;
  if(btn)btn.disabled=true;
  try{
    const camp=await saveTransmission();
    toast(camp.enabled?"Transmissão automática salva.":"Transmissão salva.");
  }catch(err){
    toast(err.message||"Não foi possível salvar a transmissão.","error");
  }finally{
    if(btn)btn.disabled=false;
  }
});

$("#sendTransmissionNowBtn")?.addEventListener("click",async()=>{
  const btn=$("#sendTransmissionNowBtn");
  btn.disabled=true;
  try{
    const camp=await saveTransmission();
    const eligible=state.contacts.filter(c=>c.marketing_opt_in&&!c.marketing_opt_out_at).length;
    if(!eligible)throw new Error("Nenhum contato autorizado para receber a transmissão.");
    if(!confirm("Enviar esta transmissão agora para "+eligible+" contato"+(eligible===1?"":"s")+" autorizado"+(eligible===1?"":"s")+"?"))return;
    const {data,error}=await sb.functions.invoke("jstech-wa-broadcast",{
      body:{workspace_id:state.workspace.id,campaign_id:camp.id}
    });
    if(error)throw error;
    if(data?.error)throw new Error(data.error==="whatsapp_not_connected"?"Conecte o WhatsApp antes de enviar.":data.error);
    const total=Number(data?.queued||0);
    if(total===0){
      toast("Esses contatos já receberam esta transmissão hoje. Nenhum envio duplicado foi criado.","error");
    }else{
      camp.last_sent_at=new Date().toISOString();
      renderCampaigns();
      toast(total+" mensagem"+(total===1?"":"s")+" colocada"+(total===1?"":"s")+" na fila de transmissão.");
    }
  }catch(err){
    toast(err.message||"Falha ao iniciar a transmissão.","error");
  }finally{
    btn.disabled=false;
  }
});

async function refreshSyncedContacts(){
  const id=state.workspace.id;
  const [contacts,settings]=await Promise.all([
    sb.from("wa_contacts").select("*").eq("workspace_id",id).order("updated_at",{ascending:false}),
    sb.from("wa_settings").select("*").eq("workspace_id",id).single()
  ]);
  if(contacts.error)throw contacts.error;
  if(settings.error)throw settings.error;
  state.contacts=contacts.data||[];
  state.settings=settings.data;
  renderContacts();renderCampaigns();renderDashboard();
}

$("#syncContactsBtn")?.addEventListener("click",async()=>{
  const btn=$("#syncContactsBtn");
  btn.disabled=true;
  btn.textContent="Sincronizando...";
  try{
    if(!state.settings?.bridge_connected)throw new Error("Conecte o WhatsApp antes de sincronizar os contatos.");
    await bridgeInvoke("sync_contacts");
    let done=false;
    for(let i=0;i<18;i++){
      await new Promise(r=>setTimeout(r,1000));
      const st=await bridgeInvoke("sync_contacts_status");
      if(st.status==="done"){
        await refreshSyncedContacts();
        const n=Number(st.result?.imported_count??st.result?.count??0);
        toast(n+" contato"+(n===1?"":"s")+" sincronizado"+(n===1?"":"s")+" com o painel.");
        done=true;break;
      }
      if(st.status==="failed")throw new Error(st.error||"A sincronização falhou.");
    }
    if(!done)toast("A sincronização continua em segundo plano. Atualize o painel em alguns segundos.");
  }catch(err){
    toast(err.message||"Não foi possível sincronizar os contatos.","error");
  }finally{
    btn.disabled=false;
    btn.textContent="Sincronizar contatos agora";
  }
});


const ORGANIC_BASE="https://juliovianadeoliveira-source.github.io/aplicativo-iptv-web/jstech-oferta/";
function organicLink(src){return ORGANIC_BASE+"?src="+encodeURIComponent(src)}
function renderOrganicLinks(){
  $$("[data-organic-link]").forEach(el=>{
    const src=el.dataset.organicLink;
    const url=organicLink(src);
    el.textContent=url;
    el.href=url;
  });
}
$$("[data-copy-organic]").forEach(btn=>btn.addEventListener("click",async()=>{
  const src=btn.dataset.copyOrganic;
  try{
    await navigator.clipboard.writeText(organicLink(src));
    toast("Link de divulgação copiado.");
  }catch{
    prompt("Copie o link:",organicLink(src));
  }
}));


async function loadPanelConnectors(showToast=false){
  if(!state.workspace?.id)return;
  try{
    const data=await panelAdmin({action:"list",workspace_id:state.workspace.id});
    state.panels=data?.panels||[];
    state.panelApps=data?.apps||[];
    state.panelMappings=data?.mappings||[];
    state.panelLoadError=null;
    if(state.activePanel){
      state.activePanel=state.panels.find(x=>x.id===state.activePanel.id)||null;
    }
    if(showToast)toast("Painéis atualizados.");
  }catch(err){
    console.error("panel admin",err);
    state.panels=[];
    state.panelApps=[];
    state.panelMappings=[];
    state.panelLoadError=err?.message||"Falha ao carregar os painéis";
    if(showToast)toast("Não foi possível carregar os painéis: "+state.panelLoadError,"error");
  }
}
function panelStatusLabel(p){
  if(p.last_status==="driver_ready")return "Conectado";
  if(p.last_status==="validando_login")return "Validando login";
  if(p.last_status==="auth_failed")return "Login não validado";
  if(p.has_credentials)return "Acesso salvo";
  if(p.last_status==="site_online")return "Site online";
  return "Aguardando acesso";
}
function renderPanelConnectors(){
  const list=$("#panelConnectorList");
  if(!list)return;
  const q=($("#panelSearch")?.value||"").toLowerCase().trim();
  const rows=state.panels.filter(p=>!q||(p.name||"").toLowerCase().includes(q)||(p.base_url||"").toLowerCase().includes(q));
  if(!rows.length){
    list.innerHTML='<p class="muted">'+(state.panels.length?"Nenhum painel encontrado.":state.panelLoadError?("Erro ao carregar: "+escapeHtml(state.panelLoadError)):"Nenhum painel carregado.")+'</p>';
    return;
  }
  list.innerHTML=rows.map(p=>{
    const status=panelStatusLabel(p);
    return '<div class="knowledge-item panel-connector-item '+(state.activePanel?.id===p.id?"active":"")+'" data-panel-select="'+p.id+'">'
      +'<div class="knowledge-item-head"><div><b>'+escapeHtml(p.name)+'</b><p>'+escapeHtml(p.base_url||"Endereço ainda não identificado")+'</p></div>'
      +'<span class="pill '+(p.last_status==="driver_ready"?"success":"warning")+'">'+escapeHtml(status)+'</span></div>'
      +'<p>'+escapeHtml((p.capabilities||[]).join(" • ")||"teste • criar usuário • renovar")+'</p></div>';
  }).join("");
  $$("[data-panel-select]",list).forEach(el=>el.addEventListener("click",()=>selectPanelConnector(el.dataset.panelSelect)));
  if(!state.activePanel && rows.length)selectPanelConnector(rows[0].id);
}
function selectPanelConnector(id){
  const p=state.panels.find(x=>x.id===id);if(!p)return;
  state.activePanel=p;
  $("#panelCredentialTitle").textContent=p.name;
  $("#panelCredentialHint").textContent=p.has_credentials
    ?"Este painel já tem credenciais próprias salvas. Digite novas credenciais somente se quiser substituir o acesso."
    :"Cadastre o usuário e a senha específicos deste painel.";
  $("#panelConnectorId").value=p.id;
  $("#panelBaseUrl").value=p.base_url||"";
  $("#panelUsername").value="";
  $("#panelPassword").value="";
  $("#panelCredentialForm").classList.remove("hidden");
  const botBtn=$("#togglePanelBotBtn");
  if(botBtn){
    const ready=p.last_status==="driver_ready"&&p.has_credentials;
    botBtn.textContent=!ready?"Aguardando validação":(p.enabled?"Desativar no bot":"Ativar no bot");
    botBtn.classList.toggle("primary",!!(ready&&p.enabled));
    botBtn.disabled=!ready;
  }
  renderPanelAppMappings();
  const list=$("#panelConnectorList");
  if(list){
    $$("[data-panel-select]",list).forEach(el=>el.classList.toggle("active",el.dataset.panelSelect===p.id));
  }
}
function renderPanelAppMappings(){
  const select=$("#panelAppSelect"),box=$("#panelAppMappings");
  if(!select||!box)return;
  const p=state.activePanel;
  if(!p){
    select.innerHTML="";
    box.innerHTML='<p class="muted">Selecione um painel.</p>';
    return;
  }
  const used=new Set(state.panelMappings.filter(m=>m.connector_id===p.id&&m.enabled).map(m=>m.app_catalog_id));
  const available=state.panelApps.filter(a=>!used.has(a.id));
  select.innerHTML=available.length
    ? available.map(a=>'<option value="'+a.id+'">'+escapeHtml(a.name)+'</option>').join("")
    : '<option value="">Todos os aplicativos já foram associados</option>';

  const mappings=state.panelMappings.filter(m=>m.connector_id===p.id&&m.enabled);
  if(!mappings.length){
    box.innerHTML='<p class="muted">Nenhum aplicativo associado a este painel ainda.</p>';
    return;
  }
  box.innerHTML=mappings.map(m=>
    '<div class="knowledge-item"><div class="knowledge-item-head"><div><b>'+escapeHtml(m.app_name)+'</b>'
    +'<p>'+(m.panel_app_code?'Código no painel: '+escapeHtml(m.panel_app_code):'Sem código específico cadastrado')+'</p></div>'
    +'<button class="remove-option" data-remove-panel-app="'+m.id+'">×</button></div></div>'
  ).join("");
  $$("[data-remove-panel-app]",box).forEach(btn=>btn.addEventListener("click",()=>removePanelAppMapping(btn.dataset.removePanelApp)));
}
$("#savePanelAppBtn")?.addEventListener("click",async()=>{
  const p=state.activePanel;if(!p)return;
  const appId=$("#panelAppSelect").value;
  if(!appId)return toast("Escolha um aplicativo.","error");
  const btn=$("#savePanelAppBtn");btn.disabled=true;
  try{
    await panelAdmin({
      action:"save_app_mapping",
      workspace_id:state.workspace.id,
      connector_id:p.id,
      app_catalog_id:appId,
      panel_app_code:$("#panelAppCode").value.trim()
    });
    $("#panelAppCode").value="";
    await loadPanelConnectors(false);
    state.activePanel=state.panels.find(x=>x.id===p.id)||null;
    renderPanelAppMappings();renderPanelConnectors();
    toast("Aplicativo vinculado ao painel.");
  }catch(err){toast(err.message||"Falha ao vincular aplicativo.","error")}
  finally{btn.disabled=false}
});
async function removePanelAppMapping(mappingId){
  const p=state.activePanel;if(!p)return;
  try{
    await panelAdmin({
      action:"delete_app_mapping",
      workspace_id:state.workspace.id,
      connector_id:p.id,
      mapping_id:mappingId
    });
    await loadPanelConnectors(false);
    state.activePanel=state.panels.find(x=>x.id===p.id)||null;
    renderPanelAppMappings();renderPanelConnectors();
    toast("Aplicativo removido deste painel.");
  }catch(err){toast(err.message||"Falha ao remover vínculo.","error")}
}

$("#panelSearch")?.addEventListener("input",renderPanelConnectors);
$("#reloadPanelsBtn")?.addEventListener("click",async()=>{await loadPanelConnectors(true);renderPanelConnectors()});
let panelCredentialAutoSaveTimer=null;
function schedulePanelCredentialAutoSave(){
  clearTimeout(panelCredentialAutoSaveTimer);
  panelCredentialAutoSaveTimer=setTimeout(()=>{
    const form=$("#panelCredentialForm");
    const user=$("#panelUsername")?.value?.trim();
    const pass=$("#panelPassword")?.value||"";
    if(form&&!form.classList.contains("hidden")&&user&&pass){
      form.requestSubmit();
    }
  },700);
}
$("#panelUsername")?.addEventListener("change",schedulePanelCredentialAutoSave);
$("#panelPassword")?.addEventListener("change",schedulePanelCredentialAutoSave);
$("#panelPassword")?.addEventListener("blur",schedulePanelCredentialAutoSave);

$("#panelCredentialForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const p=state.activePanel;if(!p)return;
  const username=$("#panelUsername").value.trim();
  const password=$("#panelPassword").value;
  const base_url=$("#panelBaseUrl").value.trim();
  if(!username||!password)return toast("Informe o usuário e a senha deste painel.","error");
  const btn=e.submitter||$("#panelCredentialForm button[type='submit']");btn.disabled=true;
  try{
    await panelAdmin({
      action:"save_credentials",workspace_id:state.workspace.id,connector_id:p.id,
      username,password,base_url
    });
    $("#panelUsername").value="";$("#panelPassword").value="";
    await loadPanelConnectors(false);
    state.activePanel=state.panels.find(x=>x.id===p.id)||null;
    selectPanelConnector(p.id);
    toast("Acesso salvo. A validação automática do painel foi iniciada.");
  }catch(err){toast(err.message||"Falha ao salvar o acesso.","error")}
  finally{btn.disabled=false}
});
$("#openPanelBtn")?.addEventListener("click",()=>{
  const p=state.activePanel;if(!p)return;
  const url=$("#panelBaseUrl").value.trim()||p.base_url||"";
  if(!url)return toast("Este painel ainda não tem endereço cadastrado.","error");
  window.open(url,"_blank","noopener,noreferrer");
});
$("#togglePanelBotBtn")?.addEventListener("click",async()=>{
  const p=state.activePanel;if(!p)return;
  if(!p.has_credentials)return toast("Salve o usuário e a senha deste painel primeiro.","error");
  const next=!p.enabled;
  const btn=$("#togglePanelBotBtn");btn.disabled=true;
  try{
    await panelAdmin({
      action:"update_panel",workspace_id:state.workspace.id,connector_id:p.id,enabled:next
    });
    await loadPanelConnectors(false);
    state.activePanel=state.panels.find(x=>x.id===p.id)||null;
    selectPanelConnector(p.id);
    toast(next?"Painel liberado para uso do bot.":"Painel removido do uso automático do bot.");
  }catch(err){toast(err.message||"Falha ao alterar o painel.","error")}
  finally{btn.disabled=false}
});
$("#testPanelBtn")?.addEventListener("click",async()=>{
  const p=state.activePanel;if(!p)return;
  const base_url=$("#panelBaseUrl").value.trim();
  const btn=$("#testPanelBtn");btn.disabled=true;btn.textContent="Testando...";
  try{
    const data=await panelAdmin({
      action:"test_site",workspace_id:state.workspace.id,connector_id:p.id,base_url
    });
    await loadPanelConnectors(false);state.activePanel=state.panels.find(x=>x.id===p.id)||null;renderPanelConnectors();
    toast(data?.ok?"Site do painel respondeu.":"O site do painel não respondeu.",data?.ok?"success":"error");
  }catch(err){toast(err.message||"Falha ao testar o painel.","error")}
  finally{btn.disabled=false;btn.textContent="Testar site"}
});
$("#clearPanelCredentialsBtn")?.addEventListener("click",async()=>{
  const p=state.activePanel;if(!p)return;
  if(!confirm("Remover o usuário e a senha salvos deste painel?"))return;
  try{
    await panelAdmin({
      action:"clear_credentials",workspace_id:state.workspace.id,connector_id:p.id
    });
    await loadPanelConnectors(false);state.activePanel=state.panels.find(x=>x.id===p.id)||null;selectPanelConnector(p.id);
    toast("Credenciais removidas deste painel.");
  }catch(err){toast(err.message||"Falha ao remover o acesso.","error")}
});

function renderAutomations(){
  const list=$("#automationList");list.innerHTML=state.automations.map(a=>'<div class="automation-item '+(state.activeAutomation?.id===a.id?"active":"")+'" data-auto="'+a.id+'"><b>'+escapeHtml(a.name)+'</b><span>'+(a.enabled?"Ativa":"Desativada")+' • '+(a.trigger_texts||[]).join(", ")+'</span></div>').join("");
  $$("[data-auto]",list).forEach(x=>x.addEventListener("click",()=>selectAutomation(x.dataset.auto)));
  if(state.activeAutomation)renderBuilder();
}
function selectAutomation(id){const a=state.automations.find(x=>x.id===id);if(!a)return;state.activeAutomation=structuredClone(a);state.activeNode=a.flow?.start||Object.keys(a.flow?.nodes||{})[0]||null;state.simNode=null;renderAutomations();resetSimulator()}
function renderBuilder(){
  const a=state.activeAutomation;$("#automationTitle").textContent=a.name;$("#triggerTexts").value=(a.trigger_texts||[]).join(", ");
  const nodes=a.flow?.nodes||{},nl=$("#nodeList");nl.innerHTML=Object.entries(nodes).map(([key,n])=>'<div class="node-item '+(state.activeNode===key?"active":"")+'" data-node="'+escapeHtml(key)+'"><b>'+escapeHtml(key)+'</b><span>'+escapeHtml((n.text||"").slice(0,36))+'</span></div>').join("");
  $$("[data-node]",nl).forEach(x=>x.addEventListener("click",()=>{state.activeNode=x.dataset.node;renderBuilder()}));
  renderNodeEditor();
}
function renderNodeEditor(){
  const a=state.activeAutomation,key=state.activeNode,node=a?.flow?.nodes?.[key],box=$("#nodeEditor");if(!node){box.innerHTML='<p class="muted">Crie ou escolha uma etapa.</p>';return}
  const keys=Object.keys(a.flow.nodes);
  box.innerHTML='<label>ID da etapa<input id="nodeId" value="'+escapeHtml(key)+'" disabled></label><label>Tipo<select id="nodeType"><option value="message" '+(node.type!=="handoff"?"selected":"")+'>Mensagem</option><option value="handoff" '+(node.type==="handoff"?"selected":"")+'>Transferir para atendente</option></select></label><label>Mensagem<textarea id="nodeText" rows="5">'+escapeHtml(node.text||"")+'</textarea></label><div class="subhead"><b>Botões / opções</b><button id="addOptionBtn" class="btn ghost compact">+ Opção</button></div><div id="optionsEditor"></div>';
  $("#nodeType").addEventListener("change",e=>node.type=e.target.value);$("#nodeText").addEventListener("input",e=>node.text=e.target.value);$("#addOptionBtn").addEventListener("click",()=>{node.options=node.options||[];node.options.push({key:String(node.options.length+1),label:"Nova opção",next:keys[0]||key});renderNodeEditor()});
  const ob=$("#optionsEditor"),opts=node.options||[];ob.innerHTML=opts.map((o,i)=>'<div class="option-row"><input data-ok="'+i+'" value="'+escapeHtml(o.key||"")+'" placeholder="1"><input data-ol="'+i+'" value="'+escapeHtml(o.label||"")+'" placeholder="Texto do botão"><select data-on="'+i+'">'+keys.map(k=>'<option value="'+escapeHtml(k)+'" '+(o.next===k?"selected":"")+'>'+escapeHtml(k)+'</option>').join("")+'</select><button class="remove-option" data-or="'+i+'">×</button></div>').join("");
  $$("[data-ok]",ob).forEach(x=>x.addEventListener("input",e=>opts[+e.target.dataset.ok].key=e.target.value));$$("[data-ol]",ob).forEach(x=>x.addEventListener("input",e=>opts[+e.target.dataset.ol].label=e.target.value));$$("[data-on]",ob).forEach(x=>x.addEventListener("change",e=>opts[+e.target.dataset.on].next=e.target.value));$$("[data-or]",ob).forEach(x=>x.addEventListener("click",e=>{opts.splice(+e.currentTarget.dataset.or,1);renderNodeEditor()}));
}
$("#addNodeBtn").addEventListener("click",()=>{if(!state.activeAutomation)return;let base="etapa_"+String(Date.now()).slice(-5),key=base,i=1;while(state.activeAutomation.flow.nodes[key])key=base+"_"+i++;state.activeAutomation.flow.nodes[key]={type:"message",text:"Nova mensagem",options:[]};state.activeNode=key;renderBuilder()});
$("#saveAutomationBtn").addEventListener("click",async()=>{const a=state.activeAutomation;if(!a)return;a.trigger_texts=$("#triggerTexts").value.split(",").map(x=>x.trim()).filter(Boolean);const {error}=await sb.from("wa_automations").update({trigger_texts:a.trigger_texts,flow:a.flow,updated_at:new Date().toISOString()}).eq("id",a.id);if(error)return toast(error.message,"error");const idx=state.automations.findIndex(x=>x.id===a.id);state.automations[idx]=structuredClone(a);toast("Fluxo salvo.");renderAutomations()});
$("#newAutomationBtn").addEventListener("click",async()=>{const name=prompt("Nome da nova automação:","Novo atendimento");if(!name)return;const flow={start:"inicio",nodes:{inicio:{type:"message",text:"Olá! Como posso ajudar?",options:[]}}};const {data,error}=await sb.from("wa_automations").insert({workspace_id:state.workspace.id,name,trigger_texts:["oi"],flow,enabled:true}).select().single();if(error)return toast(error.message,"error");state.automations.push(data);selectAutomation(data.id);toast("Automação criada.")});

function simAppend(kind,text,options=[]){const box=$("#simulatorMessages"),b=document.createElement("div");b.className="sim-bubble "+kind;b.textContent=text;box.appendChild(b);if(options.length){const wrap=document.createElement("div");wrap.className="sim-options";options.forEach(o=>{const btn=document.createElement("button");btn.type="button";btn.textContent=o.key+" - "+o.label;btn.onclick=()=>simGo(o.next,o.key);wrap.appendChild(btn)});box.appendChild(wrap)}box.scrollTop=box.scrollHeight}
function simGo(key,userLabel=null){const nodes=state.activeAutomation?.flow?.nodes||{},n=nodes[key];if(userLabel)simAppend("user",userLabel);if(!n)return;if(n.type==="handoff"){simAppend("bot",n.text||"Vou chamar um atendente.");state.simNode=null;return}state.simNode=key;simAppend("bot",n.text||"",n.options||[])}
function resetSimulator(){const box=$("#simulatorMessages");box.innerHTML="";state.simNode=null;simAppend("bot","Simulador pronto. Digite “oi” para iniciar o fluxo.")}
$("#resetSimulatorBtn").addEventListener("click",resetSimulator);
$("#simulatorForm").addEventListener("submit",e=>{e.preventDefault();const input=$("#simulatorInput"),v=input.value.trim();if(!v)return;simAppend("user",v);input.value="";const a=state.activeAutomation;if(!a)return;const norm=x=>x.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().trim();if(!state.simNode&&(a.trigger_texts||[]).some(t=>norm(t)===norm(v))){simGo(a.flow.start);return}const node=a.flow.nodes?.[state.simNode];const opt=(node?.options||[]).find(o=>norm(o.key)===norm(v)||norm(o.label)===norm(v));if(opt){simGo(opt.next);return}simAppend("bot","Não encontrei uma regra para essa resposta. No WhatsApp, vou pedir mais contexto ou deixar a conversa pronta para atendimento humano.")});
resetSimulator();

function renderKnowledge(){
  const list=$("#knowledgeList");if(!state.knowledge.length){list.innerHTML='<p class="muted">Nenhuma informação cadastrada.</p>';return}
  list.innerHTML=state.knowledge.map(k=>'<div class="knowledge-item"><div class="knowledge-item-head"><div><b>'+escapeHtml(k.title)+'</b><p>'+escapeHtml((k.keywords||[]).join(", "))+'</p></div><div class="knowledge-actions"><button data-ke="'+k.id+'">Editar</button><button data-kd="'+k.id+'">Excluir</button></div></div><p>'+escapeHtml(k.content.slice(0,150))+(k.content.length>150?"…":"")+'</p></div>').join("");
  $$("[data-ke]").forEach(b=>b.addEventListener("click",()=>editKnowledge(b.dataset.ke)));$$("[data-kd]").forEach(b=>b.addEventListener("click",()=>deleteKnowledge(b.dataset.kd)));
}
function editKnowledge(id){const k=state.knowledge.find(x=>x.id===id);state.editingKnowledge=id;$("#knowledgeFormTitle").textContent="Editar informação";$("#knowledgeTitle").value=k.title;$("#knowledgeKeywords").value=(k.keywords||[]).join(", ");$("#knowledgeContent").value=k.content}
function clearKnowledge(){state.editingKnowledge=null;$("#knowledgeFormTitle").textContent="Nova informação";$("#knowledgeForm").reset()}
$("#newKnowledgeBtn").addEventListener("click",clearKnowledge);$("#cancelKnowledgeBtn").addEventListener("click",clearKnowledge);
$("#knowledgeForm").addEventListener("submit",async e=>{e.preventDefault();const row={workspace_id:state.workspace.id,title:$("#knowledgeTitle").value.trim(),keywords:$("#knowledgeKeywords").value.split(",").map(x=>x.trim()).filter(Boolean),content:$("#knowledgeContent").value.trim(),enabled:true,updated_at:new Date().toISOString()};let r;if(state.editingKnowledge)r=await sb.from("wa_knowledge").update(row).eq("id",state.editingKnowledge).select().single();else r=await sb.from("wa_knowledge").insert(row).select().single();if(r.error)return toast(r.error.message,"error");await loadAll();clearKnowledge();toast("Base de conhecimento salva.")});
async function deleteKnowledge(id){if(!confirm("Excluir esta informação?"))return;const {error}=await sb.from("wa_knowledge").delete().eq("id",id);if(error)return toast(error.message,"error");await loadAll();toast("Informação excluída.")}

let bridgePoll=null;

function renderSettings(){
  const s=state.settings||{};
  $("#companyName").value=s.company_name||"JSTech";
  $("#welcomeMessage").value=s.welcome_message||"";
  $("#fallbackMessage").value=s.fallback_message||"";
  renderBridgeUi(!!s.bridge_connected);
  refreshBridgeStatus().catch(()=>{});
}

$("#settingsForm").addEventListener("submit",async e=>{e.preventDefault();const patch={company_name:$("#companyName").value.trim()||"JSTech",welcome_message:$("#welcomeMessage").value.trim(),ai_enabled:state.settings?.ai_enabled!==false,fallback_message:$("#fallbackMessage").value.trim(),updated_at:new Date().toISOString()};const {data,error}=await sb.from("wa_settings").update(patch).eq("workspace_id",state.workspace.id).select().single();if(error)return toast(error.message,"error");state.settings=data;renderDashboard();toast("Configurações salvas.")});

async function bridgeInvoke(action,extra={}){
  const {data,error}=await sb.functions.invoke(BRIDGE_FUNCTION,{body:{workspace_id:state.workspace.id,action,...extra}});
  if(error)throw error;
  if(data?.error)throw new Error(data.message||data.error);
  return data||{};
}

function renderBridgeUi(connected,configured=true){
  const pill=$("#qrStatusPill");
  const title=$("#qrConnectionTitle");
  const hint=$("#qrConnectionHint");
  const connect=$("#connectWhatsAppBtn");
  const disconnect=$("#disconnectWhatsAppBtn");
  if(!pill)return;
  pill.className="pill "+(connected?"success":"warning");
  pill.textContent=connected?"Conectado":"Não conectado";
  title.textContent=connected?"WhatsApp conectado":"WhatsApp ainda não conectado";

  if(state.bridgeHosted){
    hint.textContent=connected
      ?"Este número pertence somente a esta revenda. As conversas ficam separadas do administrador."
      :"Escaneie o QR Code com o WhatsApp da sua revenda. O administrador não vê seus clientes.";
    connect.textContent=connected?"Verificar conexão":"Gerar QR Code";
    disconnect.classList.toggle("hidden",!connected);
    $("#bridgeAdvanced")?.classList.add("hidden");
  }else if(state.bridgeManagedLocally){
    hint.textContent=connected
      ?"Servidor JSTech conectado e mantendo a sessão automaticamente."
      :"Clique em Gerar QR Code e escaneie com o WhatsApp.";
    connect.textContent=connected?"Verificar conexão":"Gerar QR Code";
    disconnect.classList.toggle("hidden",!connected);
    $("#bridgeAdvanced")?.classList.add("hidden");
  }else{
    hint.textContent=connected?"Mensagens entrando e saindo pelo painel.":configured?"Clique abaixo para gerar o QR Code.":"Configure o servidor uma única vez para liberar o QR Code.";
    connect.textContent=connected?"Verificar conexão":"Conectar WhatsApp";
    disconnect.classList.toggle("hidden",!connected);
    $("#bridgeAdvanced")?.classList.remove("hidden");
  }
  if(connected)$("#qrPanel").classList.add("hidden");
}

async function refreshBridgeStatus(){
  if(!state.workspace)return;
  try{
    const data=await bridgeInvoke("status");
    const connected=!!data.connected;
    state.bridgeManagedLocally=!!data.managed_locally;
    state.bridgeHosted=!!data.hosted;
    state.settings.bridge_connected=connected;
    renderBridgeUi(connected,data.configured!==false);
    if(data.qr&&!connected){
      if($("#qrImage").getAttribute("src")!==data.qr)$("#qrImage").src=data.qr;
      $("#qrPanel").classList.remove("hidden");
      $("#qrConnectionTitle").textContent="Escaneie o QR Code";
      $("#qrConnectionHint").textContent=state.bridgeHosted
        ?"QR renovado automaticamente. Abra o WhatsApp da revenda → Aparelhos conectados → Conectar um aparelho."
        :"QR renovado automaticamente. Aguardando leitura pelo WhatsApp...";
    }else if(!connected){
      $("#qrImage").removeAttribute("src");
      $("#qrPanel").classList.add("hidden");
    }
    if(data.error&&!connected)toast(String(data.error),"error");
    renderDashboard();
    if(data.base_url&&!$("#bridgeUrl").value)$("#bridgeUrl").value=data.base_url;
    if(data.instance_name)$("#bridgeInstance").value=data.instance_name;
    if(data.setup_required)$("#bridgeAdvanced").open=true;
    return data;
  }catch(err){
    renderBridgeUi(false,true);
    return null;
  }
}

async function startBridgeConnect(){
  const btn=$("#connectWhatsAppBtn");
  btn.disabled=true;btn.textContent="Preparando QR Code...";
  try{
    const data=await bridgeInvoke("connect");
    state.bridgeHosted=!!data.hosted||state.bridgeHosted;
    state.bridgeManagedLocally=!!data.managed_locally||state.bridgeManagedLocally;
    if(data.connected){
      state.settings.bridge_connected=true;
      renderBridgeUi(true,true);renderDashboard();toast("WhatsApp conectado.");
      return;
    }

    clearInterval(bridgePoll);
    let tries=0;
    const poll=async()=>{
      tries++;
      const s=await refreshBridgeStatus();
      if(s?.connected){
        clearInterval(bridgePoll);bridgePoll=null;
        $("#qrPanel").classList.add("hidden");
        toast("WhatsApp conectado com sucesso.");
        return;
      }
      if(s?.qr){
        if($("#qrImage").getAttribute("src")!==s.qr)$("#qrImage").src=s.qr;
        $("#qrPanel").classList.remove("hidden");
        $("#qrConnectionTitle").textContent="Escaneie o QR Code";
        $("#qrConnectionHint").textContent=state.bridgeHosted
          ?"QR renovado automaticamente. Use o WhatsApp da revenda para escanear."
          :"QR renovado automaticamente. Aguardando leitura pelo WhatsApp...";
      }else if(!s?.connected){
        $("#qrImage").removeAttribute("src");
        $("#qrPanel").classList.add("hidden");
      }
    };
    await poll();
    if(!state.settings?.bridge_connected){
      bridgePoll=setInterval(poll,10000);
      toast(data.qr?"QR Code gerado.":"Preparando seu QR Code...");
    }
  }catch(err){
    if(String(err.message).includes("Servidor do WhatsApp")||String(err.message).includes("setup")){
      $("#bridgeAdvanced").open=true;
    }
    toast(err.message||"Não foi possível gerar o QR Code.","error");
  }finally{
    btn.disabled=false;
    if(!state.settings?.bridge_connected)btn.textContent=state.bridgeHosted?"Gerar QR Code":"Conectar WhatsApp";
  }
}

$("#connectWhatsAppBtn").addEventListener("click",startBridgeConnect);

$("#disconnectWhatsAppBtn").addEventListener("click",async()=>{
  if(!confirm("Desconectar este WhatsApp do painel?"))return;
  try{
    await bridgeInvoke("disconnect");
    state.settings.bridge_connected=false;
    renderBridgeUi(false,true);renderDashboard();toast("WhatsApp desconectado.");
  }catch(err){toast(err.message||"Falha ao desconectar.","error")}
});

$("#saveBridgeBtn").addEventListener("click",async()=>{
  const base_url=$("#bridgeUrl").value.trim();
  const api_key=$("#bridgeApiKey").value.trim();
  const instance_name=$("#bridgeInstance").value.trim()||"jstech";
  if(!base_url||!api_key)return toast("Informe o endereço e a chave do servidor.","error");
  const btn=$("#saveBridgeBtn");btn.disabled=true;
  try{
    await bridgeInvoke("configure",{base_url,api_key,instance_name});
    $("#bridgeApiKey").value="";
    $("#bridgeAdvanced").open=false;
    toast("Servidor salvo. Agora clique em Conectar WhatsApp.");
    await refreshBridgeStatus();
  }catch(err){toast(err.message||"Não foi possível salvar o servidor.","error")}
  finally{btn.disabled=false}
});

function subscribeRealtime(){
  if(!state.workspace)return;state.channel?.unsubscribe();
  state.channel=sb.channel("jstech-wa-"+state.workspace.id)
    .on("postgres_changes",{event:"*",schema:"public",table:"wa_messages",filter:"workspace_id=eq."+state.workspace.id},async p=>{if(state.activeConversation&&(p.new?.conversation_id===state.activeConversation.id||p.old?.conversation_id===state.activeConversation.id))await loadMessages(state.activeConversation.id);await refreshConversationData()})
    .on("postgres_changes",{event:"*",schema:"public",table:"wa_conversations",filter:"workspace_id=eq."+state.workspace.id},refreshConversationData)
    .on("postgres_changes",{event:"*",schema:"public",table:"wa_contacts",filter:"workspace_id=eq."+state.workspace.id},refreshConversationData)
    .subscribe();
}
let refreshTimer=null;function refreshConversationData(){clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{const id=state.workspace.id;const [contacts,convs]=await Promise.all([sb.from("wa_contacts").select("*").eq("workspace_id",id).order("updated_at",{ascending:false}),sb.from("wa_conversations").select("*,wa_contacts(id,name,phone,status,bot_enabled,notes)").eq("workspace_id",id).order("last_message_at",{ascending:false})]);if(!contacts.error)state.contacts=contacts.data||[];if(!convs.error)state.conversations=convs.data||[];if(state.activeConversation){const fresh=state.conversations.find(x=>x.id===state.activeConversation.id);if(fresh)state.activeConversation=fresh}renderDashboard();renderContacts();renderConversations()},250)}
boot();
$("#campaignDdd27")?.addEventListener("change",renderCampaigns);
$("#campaignDdd28")?.addEventListener("change",renderCampaigns);
