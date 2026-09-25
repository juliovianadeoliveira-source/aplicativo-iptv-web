import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const SUPABASE_URL = "https://fvttsguxeocisqvcrbqh.supabase.co";
const SUPABASE_KEY = "sb_publishable_0EBQukCnPwUwAFo5gzfl5g_Ycbw3dqN";
const BRIDGE_FUNCTION = "jstech-wa-bridge";
const VOICE_FUNCTION = "jstech-voice-admin";
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
  automations:[], knowledge:[], campaigns:[], panels:[], panelApps:[], panelMappings:[], panelJobs:[], activePanel:null, activeConversation:null, activeAutomation:null,
  activeNode:null, editingKnowledge:null, channel:null, simNode:null, panelLoadError:null, bridgeManagedLocally:false, bridgeHosted:false, userRole:null,
  whatsappConnections:[], activeWhatsAppSlot:1,
  activeCampaignId:null, campaignFormCampaignId:null, campaignDeliveries:[], activeActivationAppId:null, nationalLeads:[], nationalLeadCount:0, voiceConfig:null
};

function toast(msg, type="success"){
  const el=$("#toast"); el.textContent=msg; el.className="toast "+type;
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.add("hidden"),3200);
}
let deferredInstallPrompt=null;
function isStandaloneApp(){
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone===true;
}
function updateInstallButtons(){
  const installed=isStandaloneApp();
  $$(".install-app-btn").forEach(btn=>btn.classList.toggle("hidden",installed));
}
async function requestAppInstall(){
  if(isStandaloneApp()){
    toast("O aplicativo JSTech já está instalado.");
    return;
  }
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    const choice=await deferredInstallPrompt.userChoice.catch(()=>null);
    if(choice?.outcome==="accepted")toast("Instalação iniciada.");
    deferredInstallPrompt=null;
    updateInstallButtons();
    return;
  }
  const ua=navigator.userAgent||"";
  const ios=/iPad|iPhone|iPod/.test(ua) || (navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  if(ios){
    alert("No iPhone ou iPad: abra este painel no Safari, toque em Compartilhar e escolha Adicionar à Tela de Início.");
  }else{
    alert("No Android: abra este painel no Chrome, toque no menu do navegador e escolha Instalar aplicativo ou Adicionar à tela inicial.");
  }
}
window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  updateInstallButtons();
});
window.addEventListener("appinstalled",()=>{
  deferredInstallPrompt=null;
  updateInstallButtons();
  toast("JSTech instalado no aparelho.");
});
$("#installAppBtnLogin")?.addEventListener("click",requestAppInstall);
$("#installAppBtnTop")?.addEventListener("click",requestAppInstall);
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./service-worker.js",{scope:"./"}).catch(err=>console.warn("SW",err));
    updateInstallButtons();
  });
}

function fmtDate(v){ if(!v)return "-"; return new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v)); }
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function initials(name, phone){const s=(name||phone||"J").trim();return s.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();}
function contactAvatarHtml(c,small=false){
  const cls=small?"conversation-avatar-photo":"wa-contact-photo";
  const fallbackCls=small?"conversation-avatar":"wa-contact-photo-fallback";
  const fallback='<div class="'+fallbackCls+'">'+escapeHtml(initials(c?.name,c?.phone))+'</div>';
  const raw=String(c?.profile_photo_url||"").trim();
  const preview=String(c?.profile_photo_preview_url||"").trim()||(raw&&/s96x96/i.test(raw)?raw:"");
  const full=String(c?.profile_photo_hd_url||"").trim()||(raw&&!/s96x96/i.test(raw)?raw:"");
  const listPhoto=preview||full||raw;
  if(!listPhoto)return fallback;
  return '<img class="'+cls+'" src="'+escapeHtml(listPhoto)+'" alt="" loading="lazy" referrerpolicy="no-referrer" data-contact-avatar data-photo-full="'+escapeHtml(full)+'" data-photo-preview="'+escapeHtml(preview||listPhoto)+'" data-photo-name="'+escapeHtml(c?.name||"Contato")+'" data-photo-phone="'+escapeHtml(c?.phone||"")+'"><div class="'+fallbackCls+' hidden">'+escapeHtml(initials(c?.name,c?.phone))+'</div>';
}
const photoPreloadCache=new Map();
function preloadContactPhoto(url){
  if(!url||photoPreloadCache.has(url))return;
  const im=new Image();
  im.decoding="async";
  im.referrerPolicy="no-referrer";
  im.src=url;
  photoPreloadCache.set(url,im);
}
function openContactPhoto(img){
  const modal=$("#contactPhotoModal");
  if(!modal||!img?.src)return;
  const full=String(img.dataset.photoFull||"").trim();
  const preview=String(img.dataset.photoPreview||img.currentSrc||img.src).trim();
  const url=full||preview;
  const large=$("#contactPhotoLarge");
  large.classList.toggle("low-resolution",!full);
  large.src=url;
  large.decoding="async";
  large.referrerPolicy="no-referrer";
  $("#contactPhotoName").textContent=img.dataset.photoName||"Contato";
  $("#contactPhotoPhone").textContent=img.dataset.photoPhone||"";
  modal.classList.remove("hidden");
  document.body.classList.add("photo-modal-open");
  preloadContactPhoto(full||preview);
}
function closeContactPhoto(){
  const modal=$("#contactPhotoModal");
  if(!modal)return;
  modal.classList.add("hidden");
  $("#contactPhotoLarge").removeAttribute("src");
  document.body.classList.remove("photo-modal-open");
}
function wireAvatarFallback(root=document){
  root.querySelectorAll?.("[data-contact-avatar]").forEach(img=>{
    img.addEventListener("error",()=>{
      img.classList.add("hidden");
      img.nextElementSibling?.classList.remove("hidden");
    },{once:true});
    const warm=()=>preloadContactPhoto(img.dataset.photoFull||img.currentSrc||img.src);
    img.addEventListener("mouseenter",warm,{once:true});
    img.addEventListener("touchstart",warm,{once:true,passive:true});
    img.addEventListener("click",e=>{
      e.stopPropagation();
      openContactPhoto(img);
    });
  });
}
$("#closeContactPhotoBtn")?.addEventListener("click",closeContactPhoto);
$("#contactPhotoModal")?.addEventListener("click",e=>{
  if(e.target.closest("[data-close-contact-photo]"))closeContactPhoto();
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&!$("#contactPhotoModal")?.classList.contains("hidden"))closeContactPhoto();
});

async function fileToDataUrl(file,maxBytes=1572864){
  if(!file)return null;
  if(file.size>maxBytes)throw new Error("A imagem deve ter no máximo 1,5 MB.");
  return await new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>resolve(String(fr.result||""));
    fr.onerror=()=>reject(new Error("Não foi possível ler a imagem."));
    fr.readAsDataURL(file);
  });
}
function applyBrandLogo(){
  const logo=String(state.settings?.brand_logo_url||"").trim();
  const img=$("#sidebarBrandLogo"), initials=$("#sidebarBrandInitials");
  if(img&&initials){
    if(logo){img.src=logo;img.classList.remove("hidden");initials.classList.add("hidden");}
    else{img.removeAttribute("src");img.classList.add("hidden");initials.classList.remove("hidden");}
  }
  const preview=$("#brandLogoPreview"), wrap=$("#brandLogoPreviewWrap");
  if(preview&&wrap){
    if(logo){preview.src=logo;wrap.classList.remove("hidden");}
    else{preview.removeAttribute("src");wrap.classList.add("hidden");}
  }
}
function showOnboardingIfNeeded(){
  const modal=$("#onboardingWizard");
  if(!modal||!state.workspace)return;
  if(state.workspace.onboarding_completed){modal.classList.add("hidden");return;}
  $("#onboardingCompany").value=state.settings?.company_name&&state.settings.company_name!=="Minha empresa"?state.settings.company_name:"";
  $("#onboardingAgent").value=state.settings?.virtual_agent_name||"";
  $("#onboardingWhatsapp").value=state.settings?.whatsapp_number||state.settings?.bridge_phone||"";
  $("#onboardingBusinessType").value=state.workspace?.business_type||"";
  $("#onboardingProducts").value=state.settings?.products_and_services||"";
  $("#onboardingArea").value=state.settings?.service_area||"";
  $("#onboardingDdds").value=(state.workspace?.service_ddds||[]).join(", ");
  $("#onboardingTone").value=state.settings?.conversation_tone||"natural, educado, direto e sem repetir perguntas";
  modal.classList.remove("hidden");
}
$("#onboardingLogo")?.addEventListener("change",async e=>{
  const file=e.target.files?.[0];
  if(!file)return;
  try{
    const url=await fileToDataUrl(file);
    $("#onboardingLogoPreview").src=url;
    $("#onboardingLogoPreviewWrap").classList.remove("hidden");
  }catch(err){$("#onboardingMsg").textContent=err.message||"Imagem inválida."}
});
$("#brandLogoFile")?.addEventListener("change",async e=>{
  const file=e.target.files?.[0];
  if(!file)return;
  try{
    const url=await fileToDataUrl(file);
    $("#brandLogoPreview").src=url;
    $("#brandLogoPreviewWrap").classList.remove("hidden");
  }catch(err){toast(err.message||"Imagem inválida.","error")}
});
$("#onboardingForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=e.submitter; if(btn)btn.disabled=true;
  const msg=$("#onboardingMsg"); if(msg)msg.textContent="Salvando...";
  try{
    const logoFile=$("#onboardingLogo")?.files?.[0];
    const logo=logoFile?await fileToDataUrl(logoFile):(state.settings?.brand_logo_url||null);
    const company=$("#onboardingCompany").value.trim();
    const agent=$("#onboardingAgent").value.trim();
    const whatsapp=$("#onboardingWhatsapp").value.replace(/\D+/g,"");
    const businessType=$("#onboardingBusinessType").value.trim();
    const products=$("#onboardingProducts").value.trim();
    const area=$("#onboardingArea").value.trim();
    const serviceDdds=String($("#onboardingDdds").value||"").split(",").map(x=>x.replace(/\D/g,"").slice(0,2)).filter(x=>x.length===2);
    const tone=$("#onboardingTone").value.trim()||"natural, educado, direto e sem repetir perguntas";
    if(!company||!whatsapp)throw new Error("Preencha o nome da empresa/marca e o WhatsApp. Os demais campos podem ficar vazios para usar o modo geral.");

    const settingsPatch={
      company_name:company,
      brand_logo_url:logo,
      virtual_agent_name:agent,
      whatsapp_number:whatsapp,
      products_and_services:products,
      business_description:products||"",
      service_area:area,
      conversation_tone:tone,
      ai_enabled:true,
      universal_mode:true,
      media_understanding_enabled:true,
      web_research_enabled:true,
      updated_at:new Date().toISOString()
    };
    const workspacePatch={
      name:company+" - Atendimento",
      business_type:businessType||null,
      business_description:products||null,
      service_ddds:[...new Set(serviceDdds)],
      onboarding_completed:true,
      updated_at:new Date().toISOString()
    };
    const [sr,wr]=await Promise.all([
      sb.from("wa_settings").update(settingsPatch).eq("workspace_id",state.workspace.id).select().single(),
      sb.from("wa_workspaces").update(workspacePatch).eq("id",state.workspace.id).select().single()
    ]);
    if(sr.error)throw sr.error;if(wr.error)throw wr.error;
    state.settings=sr.data;state.workspace=wr.data;
    applyBrandLogo();
    if($("#sidebarCompanyName"))$("#sidebarCompanyName").textContent=company;
    $("#onboardingWizard").classList.add("hidden");
    renderAll();
    toast("Configuração inicial salva. Esta conta está pronta.");
  }catch(err){
    if(msg)msg.textContent=err.message||"Não foi possível salvar.";
  }finally{if(btn)btn.disabled=false}
});

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
  const meta=pageMeta(page);
  if(!meta)return;
  $$(".page").forEach(x=>x.classList.remove("active"));
  $("#page-"+page)?.classList.add("active");
  $$(".nav-item[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  const [e,t]=meta; $("#pageEyebrow").textContent=e; $("#pageTitle").textContent=t;
  try{
    const url=new URL(location.href);
    if(page==="dashboard")url.searchParams.delete("page"); else url.searchParams.set("page",page);
    history.replaceState(null,"",url);
  }catch{}
}
function openRequestedAppPage(){
  const page=new URLSearchParams(location.search).get("page");
  if(page&&pageMeta(page))goPage(page);
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
  openRequestedAppPage();
  subscribeRealtime();
}
sb.auth.onAuthStateChange(async(_event,session)=>{
  state.session=session;
  if(!session){state.channel?.unsubscribe();showLogin();return}
  showApp(); await loadAll(); openRequestedAppPage(); subscribeRealtime();
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
    const isMasterRoot=Number(state.workspace?.tenant_level||0)===0&&!state.workspace?.parent_workspace_id;
    const nationalLeadPromise=isMasterRoot
      ? sb.from("wa_national_leads").select("*",{count:"exact"}).eq("workspace_id",id).order("updated_at",{ascending:false}).limit(500)
      : Promise.resolve({data:[],error:null,count:0});
    const [settings,contacts,convs,autos,knowledge,campaigns,campaignDeliveries,nationalLeads]=await Promise.all([
      sb.from("wa_settings").select("*").eq("workspace_id",id).single(),
      sb.from("wa_contacts").select("*").eq("workspace_id",id).order("updated_at",{ascending:false}),
      sb.from("wa_conversations").select("*,wa_contacts(id,name,phone,email,status,bot_enabled,notes,profile_photo_url,profile_photo_preview_url,profile_photo_hd_url,bot_context,memory_context)").eq("workspace_id",id).order("last_message_at",{ascending:false}),
      sb.from("wa_automations").select("*").eq("workspace_id",id).order("created_at"),
      sb.from("wa_knowledge").select("*").eq("workspace_id",id).order("title"),
      sb.from("wa_campaigns").select("*").eq("workspace_id",id).order("created_at",{ascending:true}),
      sb.from("wa_campaign_deliveries").select("id,campaign_id,contact_id,message_id,status,sent_at,created_at,attempt_count,claimed_at,next_attempt_at,last_error,provider_message_id").eq("workspace_id",id).order("created_at",{ascending:false}).limit(500),
      nationalLeadPromise
    ]);
    if(settings.error)throw settings.error;if(contacts.error)throw contacts.error;if(convs.error)throw convs.error;if(autos.error)throw autos.error;if(knowledge.error)throw knowledge.error;if(campaigns.error)throw campaigns.error;if(campaignDeliveries.error)throw campaignDeliveries.error;if(nationalLeads.error)throw nationalLeads.error;
    state.settings=settings.data;state.contacts=contacts.data||[];state.conversations=convs.data||[];state.automations=autos.data||[];state.knowledge=knowledge.data||[];state.campaigns=campaigns.data||[];state.campaignDeliveries=campaignDeliveries.data||[];state.nationalLeads=nationalLeads.data||[];state.nationalLeadCount=Number(nationalLeads.count??state.nationalLeads.length);
    if($("#sidebarCompanyName"))$("#sidebarCompanyName").textContent=state.settings?.company_name||"JSTech";
    if(!state.activeCampaignId || (state.activeCampaignId!=="__new__" && !state.campaigns.some(x=>x.id===state.activeCampaignId))){
      state.activeCampaignId=state.campaigns[0]?.id||"__new__";
      state.campaignFormCampaignId=null;
    }
    const {data:alias}=await sb.from("wa_login_aliases").select("role").eq("auth_user_id",state.session.user.id).eq("workspace_id",id).maybeSingle();
    state.userRole=alias?.role||"owner";
    const exclusivePanels=Number(state.workspace?.tenant_level||0)===0;
    $(".nav-item[data-page=\"panels\"]")?.classList.toggle("hidden",!exclusivePanels);
    $("#page-panels")?.classList.toggle("tenant-exclusive-hidden",!exclusivePanels);
    if(state.userRole==="reseller")state.bridgeHosted=true;
    if(!state.activeAutomation&&state.automations.length){state.activeAutomation=structuredClone(state.automations[0]);state.activeNode=state.activeAutomation.flow?.start||Object.keys(state.activeAutomation.flow?.nodes||{})[0]}
    try{
      const multi=await bridgeInvoke("list_connections",{slot:state.activeWhatsAppSlot});
      state.whatsappConnections=Array.isArray(multi?.connections)?multi.connections:[];
    }catch{
      state.whatsappConnections=[];
    }
    await loadPanelConnectors(false);
    renderAll(); applyBrandLogo(); showOnboardingIfNeeded(); if(showToast)toast("Painel atualizado.");
  }catch(err){console.error(err);toast(err.message||"Erro ao carregar o painel.","error")}
}
function renderAll(){renderDashboard();renderConversations();renderContacts();renderCampaigns();renderOrganicLinks();renderPanelConnectors();renderAutomations();renderKnowledge();renderSettings();}

function renderDashboard(){
  const unread=state.conversations.reduce((n,c)=>n+(c.unread_count||0),0);
  $("#statConversations").textContent=state.conversations.length;$("#statUnread").textContent=unread;$("#statContacts").textContent=state.contacts.length;$("#statBot").textContent=state.contacts.filter(c=>c.bot_enabled).length;
  $("#navUnread").textContent=unread;$("#navUnread").classList.toggle("hidden",!unread);

  const fallback=[
    {slot:1,connected:!!state.settings?.bridge_connected,configured:true,state:state.settings?.bridge_connected?"connected":"disconnected"},
    {slot:2,connected:false,configured:false,state:"disconnected"},
    {slot:3,connected:false,configured:false,state:"disconnected"},
    {slot:4,connected:false,configured:false,state:"disconnected"}
  ];
  const rows=state.whatsappConnections?.length?state.whatsappConnections:fallback;
  const connectedRows=rows.filter(x=>x.connected);
  const connected=connectedRows.length>0;

  $("#connectionDot").classList.toggle("on",connected);
  $("#connectionText").textContent=connected
    ? (connectedRows.length===1?"1 WhatsApp conectado":connectedRows.length+" WhatsApps conectados")
    :"WhatsApp não conectado";

  $("#dashMetaPill").className="pill "+(connected?"success":"warning");
  $("#dashMetaPill").textContent=connected
    ? (connectedRows.length===1?"1 conectado":connectedRows.length+" conectados")
    :"Aguardando";

  $("#dashMetaLine").innerHTML=connected
    ? "<b>✓</b><span>"+(connectedRows.length===1?"1 WhatsApp conectado por QR Code":connectedRows.length+" WhatsApps conectados por QR Code")+"</span>"
    : "<b>○</b><span>Conectar WhatsApp por QR Code</span>";

  $("#dashAiLine").innerHTML=state.settings?.ai_enabled
    ? "<b>✓</b><span>IA ativa + atendimento humano pelo painel</span>"
    : "<b>✓</b><span>Automação + atendimento humano pelo painel</span>";

  const box=$("#dashboardWhatsappSlots");
  if(box){
    box.innerHTML=[1,2,3,4].map(slot=>{
      const x=rows.find(r=>Number(r.slot)===slot)||{slot,connected:false,configured:false,state:"disconnected"};
      const label=x.connected?"Conectado":(x.configured&&["provisioning","preparing_qr","waiting_qr","ready"].includes(String(x.state||""))?"Aguardando QR":"Conectar");
      return '<button class="dashboard-wa-slot '+(x.connected?"connected ":"")+(state.activeWhatsAppSlot===slot?"active":"")+'" type="button" data-dashboard-wa-slot="'+slot+'"><b>WhatsApp '+slot+'</b><span>'+escapeHtml(label)+'</span></button>';
    }).join("");
  }
}
function convFilter(c,q){const ct=c.wa_contacts||{};return !q||(ct.name||"").toLowerCase().includes(q)||(ct.phone||"").includes(q)||(ct.email||"").toLowerCase().includes(q);}
function renderConversations(){
  const q=($("#conversationSearch")?.value||"").toLowerCase().trim(), list=$("#conversationList");
  const rows=state.conversations.filter(c=>convFilter(c,q));
  if(!rows.length){list.className="conversation-list empty-box";list.textContent="Nenhuma conversa ainda.";return}
  list.className="conversation-list"; list.innerHTML=rows.map(c=>{const ct=c.wa_contacts||{};return '<div class="conversation-item '+(state.activeConversation?.id===c.id?"active":"")+'" data-id="'+c.id+'">'+contactAvatarHtml(ct,true)+'<div class="conversation-info"><b>'+escapeHtml(ct.name||ct.phone||"Cliente")+'</b><span>'+escapeHtml(ct.phone||"")+'</span></div><div class="conversation-time">'+fmtDate(c.last_message_at)+(c.unread_count?'<span class="unread-dot">'+c.unread_count+'</span>':"")+"</div></div>"}).join("");
  wireAvatarFallback(list);
  $$("[data-id]",list).forEach(el=>el.addEventListener("click",()=>openConversation(el.dataset.id)));
}
$("#conversationSearch").addEventListener("input",renderConversations);
$("#mobileChatBack")?.addEventListener("click",()=>{
  $(".chat-layout")?.classList.remove("chat-open");
});
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
  $("#contactDetails").innerHTML='<div class="contact-card"><div class="contact-row"><span>Nome</span><b>'+escapeHtml(ct.name||"Não informado")+'</b></div><div class="contact-row"><span>Telefone</span><b>'+escapeHtml(ct.phone||"-")+'</b></div>'+(ct.email?'<div class="contact-row"><span>E-mail</span><b>'+escapeHtml(ct.email)+'</b></div>':'')+'<div class="contact-row"><span>Status</span><b>'+escapeHtml(c.status||ct.status||"aberta")+'</b></div><div class="contact-row"><span>Modo atual</span><b>'+mode+'</b></div></div>';
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
  const durableContext={...(ct.memory_context||{}),...(ct.bot_context||{})};
  const nextContext=value?{...durableContext,manual_pause:false,human_takeover_until:null}:{...durableContext,manual_pause:true,human_takeover_until:null};
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
  const grid=$("#contactsGrid");
  if(!grid)return;
  const rows=state.contacts
    .filter(c=>!q||(c.name||"").toLowerCase().includes(q)||(c.phone||"").includes(q)||(c.email||"").toLowerCase().includes(q))
    .slice()
    .sort((a,b)=>String(a.name||a.phone||"").localeCompare(String(b.name||b.phone||""),"pt-BR"));

  if(!rows.length){
    grid.innerHTML='<p class="muted">Nenhum contato encontrado.</p>';
    return;
  }

  grid.innerHTML=rows.map(c=>{
    const selected=!!(c.marketing_opt_in&&!c.marketing_opt_out_at);
    return '<article class="wa-contact-card '+(selected?"selected":"")+'">'
      +'<input class="wa-contact-check" type="checkbox" data-marketing="'+c.id+'" '+(selected?"checked":"")+' title="Adicionar ou remover da transmissão">'
      +contactAvatarHtml(c)
      +'<b class="wa-contact-name">'+escapeHtml(c.name||"Sem nome")+'</b>'
      +'<span class="wa-contact-phone">'+escapeHtml(c.phone||"")+(c.email?'<small class="wa-contact-email">'+escapeHtml(c.email)+'</small>':'')+'</span>'
      +'<div class="wa-contact-meta"><button class="wa-contact-bot '+(c.bot_enabled?"on":"")+'" data-contact-bot="'+c.id+'">'+(c.bot_enabled?"IA ativa":"IA pausada")+'</button></div>'
      +'</article>';
  }).join("");

  wireAvatarFallback(grid);
  grid.querySelectorAll("[data-contact-bot]").forEach(b=>b.addEventListener("click",()=>toggleContactBot(b.dataset.contactBot)));
  grid.querySelectorAll("[data-marketing]").forEach(box=>box.addEventListener("change",async()=>{
    box.disabled=true;
    await setTransmissionContact(box.dataset.marketing,box.checked);
  }));
}
$("#contactSearch").addEventListener("input",renderContacts);
async function toggleContactBot(id){const c=state.contacts.find(x=>x.id===id);if(!c)return;const value=!c.bot_enabled;const durable={...(c.memory_context||{}),...(c.bot_context||{})};const ctx=value?{...durable,manual_pause:false,human_takeover_until:null}:{...durable,manual_pause:true,human_takeover_until:null};const {error}=await sb.from("wa_contacts").update({bot_enabled:value,bot_context:ctx,updated_at:new Date().toISOString()}).eq("id",id);if(error)return toast(error.message,"error");c.bot_enabled=value;c.bot_context=ctx;renderContacts();renderDashboard()}
async function setTransmissionContact(id,value){
  const c=state.contacts.find(x=>x.id===id);if(!c)return false;
  const active=!!(c.marketing_opt_in&&!c.marketing_opt_out_at);
  if(active===value)return true;
  if(value&&!confirm("Adicionar este contato à transmissão? Confirme somente se ele autorizou receber mensagens pelo WhatsApp.")){
    renderTransmissionContacts();
    return false;
  }
  const now=new Date().toISOString();
  const patch=value
    ? {marketing_opt_in:true,marketing_opt_in_at:now,marketing_opt_out_at:null,marketing_source:"selecionado_na_transmissao",updated_at:now}
    : {marketing_opt_in:false,marketing_opt_out_at:now,updated_at:now};
  const {error}=await sb.from("wa_contacts").update(patch).eq("id",id);
  if(error){
    toast(error.message,"error");
    renderTransmissionContacts();
    return false;
  }
  Object.assign(c,patch);
  renderContacts();
  renderCampaigns();
  toast(value?"Contato adicionado à transmissão.":"Contato removido da transmissão.");
  return true;
}

async function toggleMarketing(id){
  const c=state.contacts.find(x=>x.id===id);if(!c)return;
  const value=!(c.marketing_opt_in&&!c.marketing_opt_out_at);
  await setTransmissionContact(id,value);
}

function renderTransmissionContacts(){
  const grid=$("#transmissionContactsGrid");
  if(!grid)return;
  const q=($("#transmissionContactSearch")?.value||"").toLowerCase().trim();
  const selected=c=>!!(c.marketing_opt_in&&!c.marketing_opt_out_at);
  const rows=state.contacts
    .filter(c=>!q||(c.name||"").toLowerCase().includes(q)||(c.phone||"").includes(q)||(c.email||"").toLowerCase().includes(q))
    .slice()
    .sort((a,b)=>Number(selected(b))-Number(selected(a))||String(a.name||a.phone||"").localeCompare(String(b.name||b.phone||""),"pt-BR"));

  if($("#transmissionSelectedCount")){
    $("#transmissionSelectedCount").textContent=state.contacts.filter(selected).length;
  }
  if(!rows.length){
    grid.innerHTML='<p class="muted">Nenhum contato encontrado.</p>';
    return;
  }

  grid.innerHTML=rows.map(c=>{
    const checked=selected(c);
    return '<article class="wa-contact-card '+(checked?"selected":"")+'">'
      +'<input class="wa-contact-check" type="checkbox" data-transmission-contact="'+c.id+'" '+(checked?"checked":"")+' title="Adicionar ou remover da transmissão">'
      +contactAvatarHtml(c)
      +'<b class="wa-contact-name">'+escapeHtml(c.name||"Sem nome")+'</b>'
      +'<span class="wa-contact-phone">'+escapeHtml(c.phone||"")+(c.email?'<small class="wa-contact-email">'+escapeHtml(c.email)+'</small>':'')+'</span>'
      +'</article>';
  }).join("");

  wireAvatarFallback(grid);
  grid.querySelectorAll("[data-transmission-contact]").forEach(box=>box.addEventListener("change",async()=>{
    box.disabled=true;
    await setTransmissionContact(box.dataset.transmissionContact,box.checked);
  }));
}
$("#transmissionContactSearch")?.addEventListener("input",renderTransmissionContacts);



function renderNationalLeads(){
  const panel=$("#nationalLeadPanel");
  if(!panel)return;
  const master=Number(state.workspace?.tenant_level||0)===0&&!state.workspace?.parent_workspace_id;
  panel.classList.toggle("hidden",!master);
  if(!master)return;
  const rows=state.nationalLeads||[];
  $("#nationalLeadTotal").textContent=String(state.nationalLeadCount||rows.length);
  $("#nationalLeadOpted").textContent=String(rows.filter(x=>x.marketing_opt_in).length);
  $("#nationalLeadStates").textContent=String(new Set(rows.map(x=>String(x.state_code||"").trim().toUpperCase()).filter(Boolean)).size);
  const body=$("#nationalLeadBody");
  if(!body)return;
  if(!rows.length){
    body.innerHTML='<tr><td colspan="6" class="campaign-wall-empty">Nenhum lead importado.</td></tr>';
    return;
  }
  body.innerHTML=rows.slice(0,250).map(x=>
    '<tr><td>'+escapeHtml(x.name||"Sem nome")+'</td><td>'+escapeHtml(x.phone||"")+'</td><td>'+escapeHtml(x.ddd||"")+'</td><td>'+escapeHtml(x.state_code||"")+'</td><td>'+escapeHtml(x.city||"")+'</td><td><span class="campaign-wall-status '+(x.marketing_opt_in?"sent":"queued")+'">'+(x.marketing_opt_in?"Autorizado":"Lead")+'</span></td></tr>'
  ).join("");
}

function nationalHeaderIndex(headers,names){
  return headers.findIndex(h=>names.some(n=>h===n||h.includes(n)));
}
function parseNationalLeadCsv(text){
  const lines=String(text||"").replace(/^\uFEFF/,"").replace(/\r/g,"").split("\n").filter(x=>x.trim());
  if(lines.length<2)return [];
  const first=lines[0];
  const delimiter=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?";":((first.match(/\t/g)||[]).length?"\t":",");
  const headers=splitCsvLine(first,delimiter).map(x=>x.trim().toLowerCase());
  const nameI=nationalHeaderIndex(headers,["nome","name","contato"]);
  const phoneI=nationalHeaderIndex(headers,["whatsapp","telefone","celular","phone","mobile"]);
  const dddI=nationalHeaderIndex(headers,["ddd"]);
  const stateI=nationalHeaderIndex(headers,["estado","uf","state"]);
  const cityI=nationalHeaderIndex(headers,["cidade","city","municipio","município"]);
  const cepI=nationalHeaderIndex(headers,["cep","postal"]);
  const out=[];
  for(const line of lines.slice(1)){
    const c=splitCsvLine(line,delimiter);
    const phone=normalizeImportedPhone(phoneI>=0?c[phoneI]:"");
    if(!phone)continue;
    const local=phone.startsWith("55")?phone.slice(2):phone;
    out.push({
      name:nameI>=0?String(c[nameI]||"").trim():"",
      phone,
      ddd:(dddI>=0?String(c[dddI]||"").replace(/\D/g,"").slice(0,2):local.slice(0,2)),
      state_code:stateI>=0?String(c[stateI]||"").trim().toUpperCase().slice(0,2):"",
      city:cityI>=0?String(c[cityI]||"").trim():"",
      postal_code:cepI>=0?String(c[cepI]||"").replace(/\D/g,"").slice(0,8):""
    });
  }
  return [...new Map(out.map(x=>[x.phone,x])).values()];
}
async function reloadNationalLeads(){
  if(!state.workspace?.id)return;
  const {data,error,count}=await sb.from("wa_national_leads").select("*",{count:"exact"})
    .eq("workspace_id",state.workspace.id).order("updated_at",{ascending:false}).limit(500);
  if(error)throw error;
  state.nationalLeads=data||[];
  state.nationalLeadCount=Number(count??state.nationalLeads.length);
  renderNationalLeads();
}
$("#importNationalLeadsBtn")?.addEventListener("click",async()=>{
  const file=$("#nationalLeadFile")?.files?.[0];
  if(!file)return toast("Escolha o arquivo CSV da base nacional.","error");
  const consent=$("#nationalLeadConsent")?.checked===true;
  const btn=$("#importNationalLeadsBtn");btn.disabled=true;btn.textContent="Importando...";
  try{
    const rows=parseNationalLeadCsv(await file.text());
    if(!rows.length)throw new Error("Não encontrei telefones válidos no CSV.");
    const now=new Date().toISOString();
    const baseRows=rows.map(x=>({
      workspace_id:state.workspace.id,
      name:x.name||x.phone,
      phone:x.phone,
      ddd:x.ddd||null,
      state_code:x.state_code||null,
      city:x.city||null,
      postal_code:x.postal_code||null,
      source:"csv_base_nacional",
      marketing_opt_in:consent,
      marketing_opt_in_at:consent?now:null,
      marketing_consent_proof:consent?{source:"import_base_nacional",confirmed_in_panel:true,confirmed_at:now}:{},
      status:"lead",
      updated_at:now
    }));
    for(let i=0;i<baseRows.length;i+=250){
      const {error}=await sb.from("wa_national_leads").upsert(baseRows.slice(i,i+250),{onConflict:"workspace_id,phone",ignoreDuplicates:false});
      if(error)throw error;
    }
    if(consent){
      const contactRows=baseRows.map(x=>({
        workspace_id:state.workspace.id,
        phone:x.phone,
        name:x.name,
        city:x.city,
        state_code:x.state_code,
        postal_code:x.postal_code,
        customer_kind:"lead",
        lead_source:"base_nacional",
        lead_source_at:now,
        marketing_opt_in:true,
        marketing_opt_in_at:now,
        marketing_opt_out_at:null,
        marketing_source:"base_nacional",
        marketing_consent_proof:x.marketing_consent_proof,
        updated_at:now
      }));
      for(let i=0;i<contactRows.length;i+=250){
        const {error}=await sb.from("wa_contacts").upsert(contactRows.slice(i,i+250),{onConflict:"workspace_id,phone",ignoreDuplicates:false});
        if(error)throw error;
      }
      await refreshSyncedContacts();
    }
    await reloadNationalLeads();
    $("#nationalLeadFile").value="";
    toast(rows.length+" lead"+(rows.length===1?"":"s")+" importado"+(rows.length===1?"":"s")+" na base nacional.");
  }catch(err){toast(err.message||"Falha ao importar a base nacional.","error")}
  finally{btn.disabled=false;btn.textContent="Importar base nacional"}
});

function campaignWallStatusLabel(status){
  return ({queued:"Na fila",processing:"Enviando",sent:"Enviado",failed:"Falhou"})[status]||String(status||"-");
}
function campaignWallStatusClass(status){
  return ["queued","processing","sent","failed"].includes(status)?status:"queued";
}
function renderCampaignWall(){
  const body=$("#campaignWallBody");
  if(!body)return;
  const rows=state.campaignDeliveries||[];
  const counts={queued:0,processing:0,sent:0,failed:0};
  rows.forEach(r=>{if(counts[r.status]!==undefined)counts[r.status]++});
  $("#campaignWallQueued").textContent=counts.queued;
  $("#campaignWallProcessing").textContent=counts.processing;
  $("#campaignWallSent").textContent=counts.sent;
  $("#campaignWallFailed").textContent=counts.failed;
  $("#campaignWallTotal").textContent=rows.length;

  const status=$("#campaignWallStatusFilter")?.value||"";
  const q=($("#campaignWallSearch")?.value||"").trim().toLowerCase();
  const contacts=new Map(state.contacts.map(c=>[c.id,c]));
  const campaigns=new Map(state.campaigns.map(c=>[c.id,c]));
  const filtered=rows.filter(r=>{
    if(status&&r.status!==status)return false;
    if(!q)return true;
    const ct=contacts.get(r.contact_id)||{};
    const camp=campaigns.get(r.campaign_id)||{};
    return [ct.name,ct.phone,camp.name,r.status,r.last_error].some(v=>String(v||"").toLowerCase().includes(q));
  });

  if(!filtered.length){
    body.innerHTML='<tr><td colspan="7" class="campaign-wall-empty">Nenhum disparo encontrado.</td></tr>';
    return;
  }

  body.innerHTML=filtered.map(r=>{
    const ct=contacts.get(r.contact_id)||{};
    const camp=campaigns.get(r.campaign_id)||{};
    const when=r.sent_at||r.claimed_at||r.created_at;
    const detail=r.status==="failed"
      ? (r.last_error||"Falha no envio")
      : r.status==="processing"
        ? "Enviando agora"
        : r.status==="queued"
          ? "Aguardando envio"
          : (r.provider_message_id?"ID: "+r.provider_message_id:"Confirmado");
    return '<tr data-wall-status="'+escapeHtml(r.status||"")+'">'
      +'<td><span class="campaign-wall-status '+campaignWallStatusClass(r.status)+'">'+escapeHtml(campaignWallStatusLabel(r.status))+'</span></td>'
      +'<td><b>'+escapeHtml(camp.name||"Campanha")+'</b></td>'
      +'<td>'+escapeHtml(ct.name||"Sem nome")+'</td>'
      +'<td class="campaign-wall-phone">'+escapeHtml(ct.phone||"-")+'</td>'
      +'<td>'+Number(r.attempt_count||0)+'</td>'
      +'<td>'+escapeHtml(fmtDate(when))+'</td>'
      +'<td class="campaign-wall-detail" title="'+escapeHtml(detail)+'">'+escapeHtml(detail)+'</td>'
      +'</tr>';
  }).join("");
}
async function refreshCampaignWall(showToast=false){
  if(!state.workspace?.id)return;
  const {data,error}=await sb.from("wa_campaign_deliveries")
    .select("id,campaign_id,contact_id,message_id,status,sent_at,created_at,attempt_count,claimed_at,next_attempt_at,last_error,provider_message_id")
    .eq("workspace_id",state.workspace.id)
    .order("created_at",{ascending:false})
    .limit(500);
  if(error){
    if(showToast)toast(error.message||"Falha ao atualizar a parede.","error");
    return;
  }
  state.campaignDeliveries=data||[];
  renderCampaignWall();
  if(showToast)toast("Parede dos disparos atualizada.");
}
$("#campaignWallRefreshBtn")?.addEventListener("click",()=>refreshCampaignWall(true));
$("#campaignWallStatusFilter")?.addEventListener("change",renderCampaignWall);
$("#campaignWallSearch")?.addEventListener("input",renderCampaignWall);
setInterval(()=>{
  if(state.session && $("#page-campaigns")?.classList.contains("active"))refreshCampaignWall(false);
},5000);

function currentCampaign(){
  return state.campaigns.find(x=>x.id===state.activeCampaignId)||null;
}

function renderCampaignSelector(){
  const sel=$("#campaignSelector");
  if(!sel)return;
  const isNew=state.activeCampaignId==="__new__";
  const opts=[];
  if(isNew||!state.campaigns.length)opts.push('<option value="__new__">Nova transmissão</option>');
  for(const x of state.campaigns){
    opts.push('<option value="'+x.id+'">'+escapeHtml(x.name||"Transmissão sem nome")+'</option>');
  }
  sel.innerHTML=opts.join("");
  sel.value=isNew?"__new__":(currentCampaign()?.id||state.campaigns[0]?.id||"__new__");
}

function renderCampaigns(){
  renderNationalLeads();
  renderCampaignWall();
  renderTransmissionContacts();
  renderCampaignSelector();
  const camp=currentCampaign();
  const formKey=camp?.id||"__new__";
  const eligible=state.contacts.filter(c=>c.marketing_opt_in&&!c.marketing_opt_out_at).length;
  if($("#campaignEligible"))$("#campaignEligible").textContent=eligible;
  if($("#transmissionContactsTotal"))$("#transmissionContactsTotal").textContent=state.contacts.length;
  if($("#lastContactSync")){
    const parts=[];
    if(state.settings?.last_contact_sync_at)parts.push("WhatsApp "+fmtDate(state.settings.last_contact_sync_at)+" • "+Number(state.settings?.last_contact_sync_count||0)+" contatos • "+Number(state.settings?.last_contact_photo_count||0)+" fotos");
    if(state.settings?.last_email_contact_sync_at)parts.push("E-mail "+fmtDate(state.settings.last_email_contact_sync_at)+" • "+Number(state.settings?.last_email_contact_sync_count||0)+" contatos");
    $("#lastContactSync").textContent=parts.length?parts.join(" | "):"Ainda não sincronizado";
  }
  if($("#contactSyncStatus")){
    const anyConnected=(state.whatsappConnections||[]).some(x=>x.connected)||!!state.settings?.bridge_connected;
    $("#contactSyncStatus").className="pill "+(anyConnected?"success":"warning");
    $("#contactSyncStatus").textContent=anyConnected?"WhatsApp + E-mail":"E-mail disponível";
  }

  if(state.campaignFormCampaignId!==formKey){
    if(camp){
      if($("#campaignName"))$("#campaignName").value=camp.name||"";
      if($("#campaignMessage"))$("#campaignMessage").value=camp.message||"";
      if($("#campaignHour"))$("#campaignHour").value=String(camp.daily_hour??12);
      if($("#campaignEnabled"))$("#campaignEnabled").checked=!!camp.enabled;
      if($("#campaignAudienceMode"))$("#campaignAudienceMode").value=camp.audience_mode||"all_opted_in";
      if($("#campaignRandomLimit"))$("#campaignRandomLimit").value=String(camp.random_limit||50);
      if($("#campaignDdds"))$("#campaignDdds").value=(camp.ddd_filter||[]).join(", ");
      if($("#campaignStates"))$("#campaignStates").value=(camp.audience_filters?.states||[]).join(", ");
      if($("#campaignCustomerKind"))$("#campaignCustomerKind").value=(camp.audience_filters?.customer_kinds||[])[0]||"";
      if($("#campaignLatitude"))$("#campaignLatitude").value=camp.center_latitude??"";
      if($("#campaignLongitude"))$("#campaignLongitude").value=camp.center_longitude??"";
      if($("#campaignRadiusKm"))$("#campaignRadiusKm").value=camp.radius_km??"";
      if($("#campaignTemplateName"))$("#campaignTemplateName").value=camp.template_name||"";
      if($("#campaignTemplateLanguage"))$("#campaignTemplateLanguage").value=camp.template_language||"pt_BR";
      if(camp.image_data_uri){
        $("#campaignImagePreview").src=camp.image_data_uri;
        $("#campaignImagePreviewWrap")?.classList.remove("hidden");
      }else{
        $("#campaignImagePreview")?.removeAttribute("src");
        $("#campaignImagePreviewWrap")?.classList.add("hidden");
      }
    }else{
      if($("#campaignName"))$("#campaignName").value="";
      if($("#campaignMessage"))$("#campaignMessage").value="";
      if($("#campaignHour"))$("#campaignHour").value="12";
      if($("#campaignEnabled"))$("#campaignEnabled").checked=false;
      if($("#campaignAudienceMode"))$("#campaignAudienceMode").value="all_opted_in";
      if($("#campaignRandomLimit"))$("#campaignRandomLimit").value="50";
      if($("#campaignDdds"))$("#campaignDdds").value="";
      if($("#campaignStates"))$("#campaignStates").value="";
      if($("#campaignCustomerKind"))$("#campaignCustomerKind").value="";
      if($("#campaignLatitude"))$("#campaignLatitude").value="";
      if($("#campaignLongitude"))$("#campaignLongitude").value="";
      if($("#campaignRadiusKm"))$("#campaignRadiusKm").value="";
      if($("#campaignTemplateName"))$("#campaignTemplateName").value="";
      if($("#campaignTemplateLanguage"))$("#campaignTemplateLanguage").value="pt_BR";
      if($("#campaignImage"))$("#campaignImage").value="";
      $("#campaignImagePreview")?.removeAttribute("src");
      $("#campaignImagePreviewWrap")?.classList.add("hidden");
    }
    if($("#campaignImage"))$("#campaignImage").value="";
    state.campaignFormCampaignId=formKey;
  }

  if($("#campaignStatus")){
    if(!camp){
      $("#campaignStatus").className="pill warning";
      $("#campaignStatus").textContent="Nova";
    }else{
      $("#campaignStatus").className="pill "+(camp.enabled?"success":"warning");
      $("#campaignStatus").textContent=camp.enabled
        ? "Automática • diária • "+String(camp.daily_hour??12).padStart(2,"0")+":00"
        : "Manual";
    }
  }
  if($("#campaignLastSent"))$("#campaignLastSent").textContent=camp?.last_sent_at?fmtDate(camp.last_sent_at):"Ainda não enviada";
  updateCampaignAudienceUi();
  updateCampaignShareLink();
}
function readCampaignImage(){
  const file=$("#campaignImage")?.files?.[0];
  if(!file)return Promise.resolve(currentCampaign()?.image_data_uri||null);
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

$("#campaignSelector")?.addEventListener("change",()=>{
  const value=$("#campaignSelector").value;
  if(!value)return;
  state.activeCampaignId=value;
  state.campaignFormCampaignId=null;
  renderCampaigns();
});

$("#newTransmissionBtn")?.addEventListener("click",()=>{
  state.activeCampaignId="__new__";
  state.campaignFormCampaignId=null;
  renderCampaigns();
  $("#campaignName")?.focus();
  toast("Nova transmissão aberta. Preencha e clique em Salvar transmissão.");
});

function updateCampaignAudienceUi(){
  const random=$("#campaignAudienceMode")?.value==="random_opted_in";
  $("#campaignRandomLimitWrap")?.classList.toggle("hidden",!random);
}
function campaignShareUrl(){
  const camp=currentCampaign();
  const phone=String(state.settings?.bridge_phone||"").replace(/\D+/g,"");
  if(!camp?.source_code||!phone)return "";
  const url=new URL("../jstech-oferta/",location.href);
  url.searchParams.set("src",camp.source_code);
  url.searchParams.set("phone",phone);
  return url.href;
}
function updateCampaignShareLink(){
  const input=$("#campaignShareLink");
  if(input)input.value=campaignShareUrl();
}
$("#campaignAudienceMode")?.addEventListener("change",updateCampaignAudienceUi);
$("#copyCampaignLinkBtn")?.addEventListener("click",async()=>{
  const link=campaignShareUrl();
  if(!link)return toast("Salve a transmissão e conecte o WhatsApp para gerar o link.","error");
  try{await navigator.clipboard.writeText(link);toast("Link QUERO copiado.");}
  catch{prompt("Copie o link:",link);}
});

async function saveTransmission(){
  let camp=currentCampaign();
  let imageData=null;
  try{imageData=await readCampaignImage()}catch(err){throw new Error(err.message||"Imagem inválida.")}
  const payload={
    workspace_id:state.workspace.id,
    name:$("#campaignName").value.trim()||"Transmissão JSTech",
    message:$("#campaignMessage").value.trim(),
    enabled:$("#campaignEnabled").checked,
    cadence:"daily",
    daily_hour:Number($("#campaignHour").value||12),
    ddd_filter:String($("#campaignDdds")?.value||"").split(",").map(x=>x.replace(/\D/g,"").trim()).filter(Boolean),
    audience_filters:{
      states:String($("#campaignStates")?.value||"").split(",").map(x=>x.trim().toUpperCase()).filter(Boolean),
      customer_kinds:$("#campaignCustomerKind")?.value?[$("#campaignCustomerKind").value]:[]
    },
    audience_mode:$("#campaignAudienceMode")?.value==="random_opted_in"?"random_opted_in":"all_opted_in",
    random_limit:Math.max(1,Math.min(500,Number($("#campaignRandomLimit")?.value||50))),
    center_latitude:$("#campaignLatitude")?.value===""?null:Number($("#campaignLatitude")?.value),
    center_longitude:$("#campaignLongitude")?.value===""?null:Number($("#campaignLongitude")?.value),
    radius_km:$("#campaignRadiusKm")?.value===""?null:Number($("#campaignRadiusKm")?.value),
    require_opt_in:true,
    template_name:$("#campaignTemplateName")?.value.trim()||null,
    template_language:$("#campaignTemplateLanguage")?.value.trim()||"pt_BR",
    image_data_uri:imageData,
    updated_at:new Date().toISOString()
  };
  if(!payload.message)throw new Error("Escreva a mensagem da transmissão.");
  const eligible=state.contacts.filter(c=>c.marketing_opt_in&&!c.marketing_opt_out_at).length;
  if(payload.enabled&&eligible===0){
    $("#campaignEnabled").checked=false;
    payload.enabled=false;
    throw new Error("Nenhum contato está selecionado para transmissão. Marque os contatos na lista ao lado.");
  }
  let result;
  if(camp){
    result=await sb.from("wa_campaigns").update(payload).eq("id",camp.id).select().single();
  }else{
    result=await sb.from("wa_campaigns").insert(payload).select().single();
  }
  if(result.error)throw result.error;
  if(camp){
    state.campaigns=state.campaigns.map(x=>x.id===result.data.id?result.data:x);
  }else{
    state.campaigns=[...state.campaigns,result.data];
  }
  state.activeCampaignId=result.data.id;
  state.campaignFormCampaignId=result.data.id;
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
    const eligible=state.contacts.filter(c=>c.marketing_opt_in&&c.marketing_opt_in_at&&!c.marketing_opt_out_at).length;
    if(!eligible)throw new Error("Nenhum contato autorizado para receber a transmissão.");
    const target=camp.audience_mode==="random_opted_in"?Math.min(eligible,Number(camp.random_limit||50)):eligible;
    const mode=camp.audience_mode==="random_opted_in"?" selecionado"+(target===1?"":"s")+" aleatoriamente":"";
    if(!confirm("Enviar esta transmissão agora para até "+target+" contato"+(target===1?"":"s")+" autorizado"+(target===1?"":"s")+mode+"?"))return;
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
      await refreshCampaignWall(false);
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
    await refreshBridgeConnections().catch(()=>{});
    let slots=(state.whatsappConnections||[]).filter(x=>x.connected).map(x=>Number(x.slot)).filter(Boolean);
    if(!slots.length && state.settings?.bridge_connected)slots=[1];
    if(!slots.length)throw new Error("Conecte pelo menos um WhatsApp antes de sincronizar os contatos.");

    let total=0;
    for(const slot of slots){
      await bridgeInvoke("sync_contacts",{slot});
      for(let i=0;i<20;i++){
        await new Promise(r=>setTimeout(r,900));
        const st=await bridgeInvoke("sync_contacts_status",{slot});
        if(st.status==="done"){
          total+=Number(st.result?.imported_count??st.result?.count??0);
          break;
        }
        if(st.status==="failed")throw new Error(st.error||("A sincronização do WhatsApp "+slot+" falhou."));
      }
    }
    await refreshSyncedContacts();
    toast(total+" contato"+(total===1?"":"s")+" sincronizado"+(total===1?"":"s")+" dos WhatsApps conectados.");
  }catch(err){
    toast(err.message||"Não foi possível sincronizar os contatos.","error");
  }finally{
    btn.disabled=false;
    btn.textContent="Sincronizar WhatsApp";
  }
});

function splitCsvLine(line,delimiter){
  const out=[];let cur="",quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted&&line[i+1]==='"'){cur+='"';i++}
      else quoted=!quoted;
    }else if(ch===delimiter&&!quoted){out.push(cur);cur=""}
    else cur+=ch;
  }
  out.push(cur);
  return out;
}
function normalizeImportedPhone(v){
  let d=String(v||"").replace(/\D/g,"");
  if(!d)return "";
  if((d.length===10||d.length===11)&&!d.startsWith("55"))d="55"+d;
  return d.length>=10&&d.length<=15?d:"";
}
function parseVcardContacts(text){
  return String(text||"").split(/END:VCARD/i).map(block=>{
    const lines=block.replace(/\r/g,"").split("\n");
    let name="",email="",phone="";
    for(const line of lines){
      if(/^FN[;:]/i.test(line))name=(line.split(":").slice(1).join(":")||"").trim();
      else if(/^EMAIL[;:]/i.test(line)&&!email)email=(line.split(":").slice(1).join(":")||"").trim();
      else if(/^TEL[;:]/i.test(line)&&!phone)phone=normalizeImportedPhone(line.split(":").slice(1).join(":"));
    }
    return {name,email,phone};
  }).filter(x=>x.phone);
}
function parseCsvContacts(text){
  const lines=String(text||"").replace(/^\uFEFF/,"").replace(/\r/g,"").split("\n").filter(x=>x.trim());
  if(lines.length<2)return [];
  const first=lines[0];
  const delimiter=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?";":((first.match(/\t/g)||[]).length? "\t":",");
  const headers=splitCsvLine(first,delimiter).map(x=>x.trim().toLowerCase());
  const find=(names)=>headers.findIndex(h=>names.some(n=>h===n||h.includes(n)));
  const nameIdx=find(["name","nome","full name","display name"]);
  const firstIdx=find(["given name","first name","primeiro nome"]);
  const lastIdx=find(["family name","last name","sobrenome"]);
  const emailIdx=find(["e-mail 1 - value","email address","e-mail address","email","e-mail"]);
  const phoneCandidates=headers.map((h,i)=>({h,i})).filter(x=>/phone|telefone|celular|mobile/.test(x.h)).map(x=>x.i);
  const rows=[];
  for(const line of lines.slice(1)){
    const cols=splitCsvLine(line,delimiter);
    let name=nameIdx>=0?String(cols[nameIdx]||"").trim():"";
    if(!name)name=[firstIdx>=0?cols[firstIdx]:"",lastIdx>=0?cols[lastIdx]:""].filter(Boolean).join(" ").trim();
    const email=emailIdx>=0?String(cols[emailIdx]||"").trim():"";
    let phone="";
    for(const i of phoneCandidates){phone=normalizeImportedPhone(cols[i]);if(phone)break}
    if(phone)rows.push({name:name||phone,email,phone});
  }
  return rows;
}
async function importEmailContactsFile(file){
  const text=await file.text();
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  const rows=ext==="vcf"||/BEGIN:VCARD/i.test(text)?parseVcardContacts(text):parseCsvContacts(text);
  if(!rows.length)throw new Error("Não encontrei contatos com telefone nesse arquivo.");
  const now=new Date().toISOString();
  const unique=[...new Map(rows.map(x=>[x.phone,x])).values()];
  const payload=unique.map(x=>({
    workspace_id:state.workspace.id,
    phone:x.phone,
    name:x.name||x.phone,
    email:x.email||null,
    contact_source:"email_import",
    email_synced_at:now,
    updated_at:now
  }));
  for(let i=0;i<payload.length;i+=250){
    const {error}=await sb.from("wa_contacts").upsert(payload.slice(i,i+250),{onConflict:"workspace_id,phone",ignoreDuplicates:false});
    if(error)throw error;
  }
  await sb.from("wa_settings").update({
    last_email_contact_sync_at:now,
    last_email_contact_sync_count:payload.length,
    updated_at:now
  }).eq("workspace_id",state.workspace.id);
  await refreshSyncedContacts();
  return payload.length;
}
$("#importEmailContactsBtn")?.addEventListener("click",()=>$("#emailContactsFile")?.click());
$("#emailContactsFile")?.addEventListener("change",async e=>{
  const file=e.target.files?.[0];
  if(!file)return;
  const btn=$("#importEmailContactsBtn");
  btn.disabled=true;btn.textContent="Importando...";
  try{
    const n=await importEmailContactsFile(file);
    toast(n+" contato"+(n===1?"":"s")+" importado"+(n===1?"":"s")+" da agenda do e-mail.");
  }catch(err){
    toast(err.message||"Não foi possível importar a agenda.","error");
  }finally{
    btn.disabled=false;btn.textContent="Importar agenda do e-mail";e.target.value="";
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
    state.panelJobs=data?.jobs||[];
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
    state.panelJobs=[];
    state.panelLoadError=err?.message||"Falha ao carregar os painéis";
    if(showToast)toast("Não foi possível carregar os painéis: "+state.panelLoadError,"error");
  }
}

const PANEL_ACTION_LABELS={
  test:"Criar teste",
  create_user:"Criar usuário",
  search_user:"Buscar cliente",
  renew:"Renovar",
  activate:"Ativar acesso",
  activate_app:"Ativar aplicativo"
};
function panelJobStatusLabel(status){
  return ({
    pending:"Na fila",
    processing:"Executando",
    waiting_setup:"Aguardando acesso",
    done:"Concluído",
    failed:"Falhou",
    cancelled:"Cancelado"
  })[status]||status||"-";
}
function panelJobStatusClass(status){
  if(status==="done")return "sent";
  if(status==="failed")return "failed";
  if(status==="processing")return "sending";
  return "queued";
}
function supportedPanelActions(panel){
  if(!panel)return [];
  const caps=new Set(panel.capabilities||[]);
  const out=[];
  if(caps.has("test"))out.push("test");
  if(caps.has("create_user"))out.push("create_user");
  if(caps.has("lookup_client")||caps.has("search_user"))out.push("search_user");
  if(caps.has("renew")){out.push("renew");out.push("activate")}
  if(caps.has("activate_app"))out.push("activate_app");
  return [...new Set(out)];
}
function renderPanelAutomationAppOptions(panelId){
  const sel=$("#panelAutomationApp");
  if(!sel)return;
  const maps=(state.panelMappings||[]).filter(m=>m.connector_id===panelId&&m.enabled!==false);
  if(!maps.length){
    sel.innerHTML='<option value="">Nenhum aplicativo mapeado neste painel</option>';
    return;
  }
  sel.innerHTML='<option value="">Escolha quando a ação exigir</option>'+maps.map(m=>
    '<option value="'+m.id+'" data-app-id="'+escapeHtml(m.app_catalog_id||"")+'" data-app-name="'+escapeHtml(m.app_name||"")+'" data-app-code="'+escapeHtml(m.panel_app_code||"")+'">'+escapeHtml(m.app_name||"Aplicativo")+(m.panel_app_code?" • "+escapeHtml(m.panel_app_code):"")+'</option>'
  ).join("");
}
function renderPanelAutomationActions(panelId){
  const panel=(state.panels||[]).find(p=>p.id===panelId);
  const sel=$("#panelAutomationAction");
  if(!sel)return;
  const actions=supportedPanelActions(panel);
  sel.innerHTML=actions.length
    ? actions.map(a=>'<option value="'+a+'">'+escapeHtml(PANEL_ACTION_LABELS[a]||a)+'</option>').join("")
    : '<option value="">Nenhuma ação disponível</option>';
  renderPanelAutomationAppOptions(panelId);
  updatePanelAutomationHint();
}
function updatePanelAutomationHint(){
  const panel=(state.panels||[]).find(p=>p.id===$("#panelAutomationPanel")?.value);
  const action=$("#panelAutomationAction")?.value||"";
  const hint=$("#panelAutomationHint");
  if(!hint)return;
  if(!panel){hint.textContent="Escolha um painel.";return}
  if(!(panel.has_credentials&&panel.last_status==="driver_ready")){
    hint.textContent="Este painel ainda não está pronto. O job pode ser salvo como Aguardando acesso e será liberado depois que o login for validado.";
    return;
  }
  hint.textContent=(PANEL_ACTION_LABELS[action]||"Ação")+" será executado pelo agente da VPS neste painel.";
}
function renderPanelAutomationCenter(){
  const panelSel=$("#panelAutomationPanel");
  if(!panelSel)return;

  const panels=state.panels||[];
  const ready=panels.filter(p=>p.has_credentials&&p.last_status==="driver_ready").length;
  const saved=panels.filter(p=>p.has_credentials&&p.last_status!=="driver_ready").length;
  const withoutCredentials=panels.filter(p=>!p.has_credentials).length;
  const jobs=state.panelJobs||[];
  const realJobs=jobs.filter(j=>j.action_type!=="probe_login");
  const pending=realJobs.filter(j=>["pending","processing","waiting_setup"].includes(j.status)).length;
  const done=realJobs.filter(j=>j.status==="done").length;
  const failed=realJobs.filter(j=>j.status==="failed").length;
  $("#panelAutomationReady").textContent=String(ready);
  $("#panelAutomationWaiting").textContent=String(saved);
  if($("#panelAutomationWaitingDetail"))$("#panelAutomationWaitingDetail").textContent=withoutCredentials+" sem credencial";
  $("#panelAutomationPending").textContent=String(pending);
  $("#panelAutomationDone").textContent=String(done);
  $("#panelAutomationFailed").textContent=String(failed);
  $("#panelAutomationLastUpdate").textContent="Atualizado "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"});

  const previous=panelSel.value;
  panelSel.innerHTML=panels.length
    ? panels.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+' • '+escapeHtml(panelStatusLabel(p))+'</option>').join("")
    : '<option value="">Nenhum painel</option>';
  const selected=(previous&&panels.some(p=>p.id===previous))
    ? previous
    : (state.activePanel?.id||panels[0]?.id||"");
  if(selected)panelSel.value=selected;
  renderPanelAutomationActions(selected);

  const byId=new Map(panels.map(p=>[p.id,p]));
  const body=$("#panelAutomationJobsBody");
  if(body){
    body.innerHTML=jobs.length?jobs.slice(0,100).map(j=>{
      const p=byId.get(j.connector_id);
      const who=j.requested_username||j.customer_name||j.customer_phone||j.payload?.username||"-";
      return '<tr>'
        +'<td>'+escapeHtml(fmtDate(j.created_at))+'</td>'
        +'<td>'+escapeHtml(p?.name||"Aplicativo")+'</td>'
        +'<td>'+escapeHtml(PANEL_ACTION_LABELS[j.action_type]||j.action_type||"-")+'</td>'
        +'<td><span class="campaign-wall-status '+panelJobStatusClass(j.status)+'">'+escapeHtml(panelJobStatusLabel(j.status))+'</span></td>'
        +'<td>'+escapeHtml(who)+'</td>'
        +'<td class="panel-job-error">'+escapeHtml(j.error||"")+'</td>'
        +'</tr>';
    }).join(""):'<tr><td colspan="6" class="campaign-wall-empty">Nenhum job ainda.</td></tr>';
  }
}
$("#panelAutomationPanel")?.addEventListener("change",e=>renderPanelAutomationActions(e.target.value));
$("#panelAutomationAction")?.addEventListener("change",updatePanelAutomationHint);
$("#reloadPanelAutomationBtn")?.addEventListener("click",async()=>{
  const btn=$("#reloadPanelAutomationBtn");btn.disabled=true;
  try{
    await loadPanelConnectors(false);
    renderPanelConnectors();
    renderPanelAutomationCenter();
    toast("Fila de automação atualizada.");
  }finally{btn.disabled=false}
});
$("#queuePanelAutomationBtn")?.addEventListener("click",async()=>{
  const connectorId=$("#panelAutomationPanel")?.value||"";
  const actionType=$("#panelAutomationAction")?.value||"";
  const panel=state.panels.find(p=>p.id===connectorId);
  if(!panel||!actionType)return toast("Escolha o painel e a ação.","error");

  const username=$("#panelAutomationUsername")?.value.trim()||"";
  const customerName=$("#panelAutomationCustomer")?.value.trim()||"";
  const customerPhone=$("#panelAutomationPhone")?.value.trim()||"";
  const planDays=Number($("#panelAutomationPlan")?.value||30);
  const screenCount=Math.max(1,Math.min(10,Number($("#panelAutomationScreens")?.value||1)));
  const appOption=$("#panelAutomationApp")?.selectedOptions?.[0];
  const appCatalogId=appOption?.dataset?.appId||null;
  const appName=appOption?.dataset?.appName||null;
  const panelAppCode=appOption?.dataset?.appCode||null;
  const mac=$("#panelAutomationMac")?.value.trim()||"";
  const deviceKey=$("#panelAutomationKey")?.value.trim()||"";
  const playlist=$("#panelAutomationPlaylist")?.value.trim()||"";

  if(["search_user","renew","activate"].includes(actionType)&&!username)
    return toast("Informe o usuário/login para esta ação.","error");
  if(actionType==="test"&&!appCatalogId)
    return toast("Escolha o aplicativo mapeado para criar o teste.","error");
  if(actionType==="activate_app"&&!mac&&!deviceKey)
    return toast("Informe o MAC ou a Key para ativar o aplicativo.","error");

  const btn=$("#queuePanelAutomationBtn");
  btn.disabled=true;btn.textContent="Enviando para a fila...";
  try{
    const data=await panelAdmin({
      action:"queue_job",
      workspace_id:state.workspace.id,
      connector_id:connectorId,
      action_type:actionType,
      username,
      customer_name:customerName,
      customer_phone:customerPhone,
      plan_days:planDays,
      screen_count:screenCount,
      app_catalog_id:appCatalogId,
      app_name:appName,
      panel_app_code:panelAppCode,
      payload:{
        username,
        customer_name:customerName,
        phone:customerPhone,
        plan_days:planDays,
        screen_count:screenCount,
        mac,
        device_key:deviceKey,
        playlist_url:playlist
      }
    });
    await loadPanelConnectors(false);
    renderPanelConnectors();
    renderPanelAutomationCenter();
    toast(data.waiting_setup?"Job salvo. Está aguardando acesso válido do painel.":"Automação enviada para execução.");
  }catch(err){
    toast(err.message||"Não foi possível criar o job.","error");
  }finally{
    btn.disabled=false;btn.textContent="Executar automação";
  }
});

function panelStatusLabel(p){
  if(p.last_status==="driver_ready")return p.consecutive_failures>0
    ?"Conectado • oscilação "+p.consecutive_failures+"/3"
    :"Conectado";
  if(p.last_status==="validando_login")return "Validando automação";
  if(p.last_status==="route_blocked")return "Rota VPS bloqueada • tentando reconectar";
  if(p.last_status==="url_invalid")return "VPS bloqueada pelo painel (404)";
  if(p.last_status==="unreachable")return "Painel inacessível pela VPS";
  if(p.last_status==="bot_challenge")return "Cloudflare bloqueando automação";
  if(p.last_status==="auth_failed")return p.has_credentials
    ?"Acesso salvo • login automático falhou"
    :"Login não validado";
  if(p.has_credentials)return "Acesso salvo • reconectando automação";
  if(p.last_status==="site_online")return "Site online";
  return "Aguardando acesso";
}
function renderPanelConnectors(){
  renderPanelAutomationCenter();
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
  if($("#panelAutomationPanel")){
    $("#panelAutomationPanel").value=p.id;
    renderPanelAutomationActions(p.id);
  }
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
  renderDeviceActivation();
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

function activationApp(){
  return state.panelApps.find(a=>a.id===state.activeActivationAppId)||null;
}
function activationPayloadFieldNames(app){
  const t=app?.activation_payload_template&&typeof app.activation_payload_template==="object"?app.activation_payload_template:{};
  let mac="mac",key="key",playlist="";
  for(const [k,v] of Object.entries(t)){
    const s=String(v||"");
    if(s.includes("{{mac}}"))mac=k;
    else if(s.includes("{{key}}")||s.includes("{{device_key}}"))key=k;
    else if(s.includes("{{playlist_url}}")||s.includes("{{m3u}}")||s.includes("{{url}}"))playlist=k;
  }
  return {mac,key,playlist};
}
function updateDeviceActivationDriverUi(){
  const api=$("#deviceActivationDriver")?.value==="api";
  $("#deviceActivationMethodWrap")?.classList.toggle("hidden",!api);
  $("#deviceActivationFieldNames")?.classList.toggle("hidden",!api);
}
function renderDeviceActivation(){
  const sel=$("#deviceActivationAppSelect");
  if(!sel)return;
  const apps=(state.panelApps||[]).slice().sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"pt-BR"));
  if(!apps.length){
    sel.innerHTML='<option value="">Nenhum aplicativo cadastrado</option>';
    return;
  }
  if(!state.activeActivationAppId||!apps.some(a=>a.id===state.activeActivationAppId))state.activeActivationAppId=apps[0].id;
  sel.innerHTML=apps.map(a=>'<option value="'+a.id+'">'+escapeHtml(a.name)+'</option>').join("");
  sel.value=state.activeActivationAppId;
  const a=activationApp();
  if(!a)return;
  $("#deviceRequiresMacKey").checked=!!a.requires_mac_key;
  $("#deviceActivationDriver").value=a.activation_driver||"rpa";
  $("#deviceActivationUrl").value=a.activation_url||"";
  $("#deviceActivationMethod").value=a.activation_method||"POST";
  const fields=activationPayloadFieldNames(a);
  $("#deviceMacFieldName").value=fields.mac||"mac";
  $("#deviceKeyFieldName").value=fields.key||"key";
  $("#devicePlaylistFieldName").value=fields.playlist||"";
  $("#deviceActivationApiHeader").value=a.activation_api_key_header||"Authorization";
  $("#deviceActivationApiPrefix").value=a.activation_api_key_prefix??"Bearer ";
  $("#deviceActivationNotes").value=a.activation_notes||"";
  $("#deviceActivationUsername").value="";
  $("#deviceActivationPassword").value="";
  $("#deviceActivationApiKey").value="";
  const ready=!!(a.requires_mac_key&&a.activation_driver&&a.activation_url);
  $("#deviceActivationStatus").className="pill "+(ready?"success":"warning");
  $("#deviceActivationStatus").textContent=ready?(a.has_activation_credentials?"Configurada + acesso":"Configurada"):"Não configurada";
  updateDeviceActivationDriverUi();
}
$("#deviceActivationAppSelect")?.addEventListener("change",e=>{
  state.activeActivationAppId=e.target.value||null;
  renderDeviceActivation();
});
$("#deviceActivationDriver")?.addEventListener("change",updateDeviceActivationDriverUi);
$("#saveDeviceActivationBtn")?.addEventListener("click",async()=>{
  const appId=$("#deviceActivationAppSelect")?.value;
  if(!appId)return toast("Escolha o aplicativo.","error");
  const requires=$("#deviceRequiresMacKey")?.checked===true;
  const driver=$("#deviceActivationDriver")?.value||"rpa";
  const url=$("#deviceActivationUrl")?.value.trim()||"";
  if(requires&&!url)return toast("Informe o endereço usado para configurar MAC e Key.","error");

  const macField=$("#deviceMacFieldName")?.value.trim()||"mac";
  const keyField=$("#deviceKeyFieldName")?.value.trim()||"key";
  const playlistField=$("#devicePlaylistFieldName")?.value.trim()||"";
  const template={};
  template[macField]="{{mac}}";
  template[keyField]="{{key}}";
  if(playlistField)template[playlistField]="{{playlist_url}}";

  const btn=$("#saveDeviceActivationBtn");btn.disabled=true;
  try{
    await panelAdmin({
      action:"save_app_activation",
      workspace_id:state.workspace.id,
      app_catalog_id:appId,
      requires_mac_key:requires,
      activation_driver:driver,
      activation_url:url,
      activation_method:$("#deviceActivationMethod")?.value||"POST",
      activation_payload_template:template,
      activation_username:$("#deviceActivationUsername")?.value.trim()||"",
      activation_password:$("#deviceActivationPassword")?.value||"",
      activation_api_key:$("#deviceActivationApiKey")?.value.trim()||"",
      activation_api_key_header:$("#deviceActivationApiHeader")?.value.trim()||"Authorization",
      activation_api_key_prefix:$("#deviceActivationApiPrefix")?.value??"Bearer ",
      activation_notes:$("#deviceActivationNotes")?.value.trim()||""
    });
    await loadPanelConnectors(false);
    state.activeActivationAppId=appId;
    renderDeviceActivation();
    toast("Automação MAC / Key salva para este aplicativo.");
  }catch(err){toast(err.message||"Falha ao salvar a automação MAC / Key.","error")}
  finally{btn.disabled=false}
});

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

function connectionForSlot(slot=state.activeWhatsAppSlot){
  return (state.whatsappConnections||[]).find(x=>Number(x.slot)===Number(slot))||null;
}

async function refreshBridgeConnections(){
  if(!state.workspace)return [];
  try{
    const data=await bridgeInvoke("list_connections",{slot:state.activeWhatsAppSlot});
    state.whatsappConnections=Array.isArray(data?.connections)?data.connections:[];
    renderDashboard();
    renderWhatsAppSlotTabs();
    return state.whatsappConnections;
  }catch{
    return state.whatsappConnections||[];
  }
}

function renderWhatsAppSlotTabs(){
  $$("[data-wa-slot]").forEach(btn=>{
    const slot=Number(btn.dataset.waSlot||1);
    const row=connectionForSlot(slot);
    const connected=!!row?.connected;
    btn.classList.toggle("active",slot===state.activeWhatsAppSlot);
    btn.classList.toggle("connected",connected);
    btn.innerHTML="WhatsApp "+slot+(connected?"<small>Conectado</small>":"<small>Conectar</small>");
  });
}

async function selectWhatsAppSlot(slot,openSettings=false){
  const n=Math.max(1,Math.min(4,Number(slot||1)));
  if(bridgePoll){clearInterval(bridgePoll);bridgePoll=null}
  state.activeWhatsAppSlot=n;
  if(openSettings)goPage("settings");
  renderWhatsAppSlotTabs();
  await refreshBridgeStatus(n);
}

$("#dashboardWhatsappSlots")?.addEventListener("click",e=>{
  const btn=e.target.closest("[data-dashboard-wa-slot]");
  if(btn)selectWhatsAppSlot(Number(btn.dataset.dashboardWaSlot||1),true);
});
$(".whatsapp-slot-tabs")?.addEventListener("click",e=>{
  const btn=e.target.closest("[data-wa-slot]");
  if(btn)selectWhatsAppSlot(Number(btn.dataset.waSlot||1),false);
});

function linesValue(value){
  return Array.isArray(value)?value.join("\n"):"";
}
function linesArray(value){
  return String(value||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
}

async function voiceAdmin(action,extra={}){
  const {data,error}=await sb.functions.invoke(VOICE_FUNCTION,{
    body:{workspace_id:state.workspace.id,action,...extra}
  });
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  return data||{};
}

function renderVoiceConfig(){
  const c=state.voiceConfig||null;
  const pill=$("#voiceCloneStatus");
  const title=$("#voiceSampleTitle");
  const text=$("#voiceSampleText");
  if(!pill||!title||!text)return;

  if(!c||!c.has_api_key){
    pill.className="pill warning";
    pill.textContent="Falta chave ElevenLabs";
    title.textContent="Primeiro salve a chave da ElevenLabs";
    text.textContent="Depois mande um áudio normal do seu próprio WhatsApp para qualquer pessoa. O sistema vai pegar esse áudio como amostra da sua voz.";
    return;
  }

  if(c.clone_status==="waiting_sample"){
    pill.className="pill warning";
    pill.textContent="Aguardando seu áudio";
    title.textContent="Agora mande um áudio pelo seu WhatsApp";
    text.textContent="Pode mandar para qualquer pessoa. O próximo áudio enviado por você será usado automaticamente como amostra da sua voz.";
    return;
  }

  if(c.clone_status==="cloning"){
    pill.className="pill warning";
    pill.textContent="Criando sua voz";
    title.textContent="Sua amostra foi recebida";
    text.textContent="A ElevenLabs está criando a voz a partir do áudio que você enviou.";
    return;
  }

  if(c.clone_status==="ready"&&c.voice_ready){
    pill.className="pill success";
    pill.textContent="Sua voz está pronta";
    title.textContent="Resposta em áudio ativada";
    text.textContent="Quando o cliente mandar áudio, o Whisper ouve e a resposta volta em áudio usando a sua voz.";
    return;
  }

  if(c.clone_status==="verification_required"){
    pill.className="pill warning";
    pill.textContent="Verificação necessária";
    title.textContent="A ElevenLabs pediu verificação da voz";
    text.textContent="A amostra foi recebida, mas a ElevenLabs ainda exige a verificação da sua voz antes de liberar o uso.";
    return;
  }

  pill.className="pill danger";
  pill.textContent="Erro na voz";
  title.textContent="Não foi possível concluir";
  text.textContent=c.last_error||"Confira a chave da ElevenLabs e mande novamente um áudio seu pelo WhatsApp.";
}

async function loadVoiceConfig(){
  if(!state.workspace?.id)return null;
  try{
    const data=await voiceAdmin("status");
    state.voiceConfig=data?.config||null;
    renderVoiceConfig();
    return state.voiceConfig;
  }catch{
    state.voiceConfig=null;
    renderVoiceConfig();
    return null;
  }
}

$("#saveElevenLabsKeyBtn")?.addEventListener("click",async()=>{
  const apiKey=$("#elevenLabsApiKey")?.value.trim()||"";
  if(!apiKey)return toast("Cole a chave da ElevenLabs.","error");
  const btn=$("#saveElevenLabsKeyBtn");
  btn.disabled=true;
  btn.textContent="Salvando...";
  try{
    await voiceAdmin("save_key",{api_key:apiKey});
    $("#elevenLabsApiKey").value="";
    await loadVoiceConfig();
    toast("Chave salva. Agora mande um áudio seu pelo WhatsApp para qualquer pessoa.");
  }catch(err){
    toast(err.message||"Não foi possível salvar a chave da ElevenLabs.","error");
  }finally{
    btn.disabled=false;
    btn.textContent="Salvar chave da ElevenLabs";
  }
});

function renderSettings(){
  const s=state.settings||{};
  if($("#sidebarCompanyName"))$("#sidebarCompanyName").textContent=s.company_name||"JSTech";
  $("#companyName").value=s.company_name||"JSTech";
  if($("#virtualAgentName"))$("#virtualAgentName").value=s.virtual_agent_name||(Number(state.workspace?.tenant_level||0)===0?"Ana":"");
  if($("#businessType"))$("#businessType").value=state.workspace?.business_type||"";
  if($("#businessDescription"))$("#businessDescription").value=s.business_description||state.workspace?.business_description||"";
  if($("#productsAndServices"))$("#productsAndServices").value=s.products_and_services||"";
  if($("#salesObjective"))$("#salesObjective").value=s.sales_objective||"";
  if($("#serviceArea"))$("#serviceArea").value=s.service_area||"";
  if($("#conversationTone"))$("#conversationTone").value=s.conversation_tone||"natural, educado, direto e sem repetir perguntas";
  if($("#qualificationQuestions"))$("#qualificationQuestions").value=linesValue(s.qualification_questions);
  if($("#handoffRules"))$("#handoffRules").value=linesValue(s.handoff_rules);
  if($("#universalMode"))$("#universalMode").checked=s.universal_mode!==false;
  if($("#mediaUnderstandingEnabled"))$("#mediaUnderstandingEnabled").checked=s.media_understanding_enabled!==false;
  if($("#webResearchEnabled"))$("#webResearchEnabled").checked=s.web_research_enabled!==false;
  if($("#botDisclosure"))$("#botDisclosure").checked=s.bot_disclosure!==false;
  if($("#conversationEngine"))$("#conversationEngine").value=s.conversation_engine||"openai";
  if($("#aiInstructions"))$("#aiInstructions").value=s.ai_instructions||"";
  if($("#humanizedMode"))$("#humanizedMode").checked=s.humanized_mode!==false;
  if($("#humanizedSplitMessages"))$("#humanizedSplitMessages").checked=s.humanized_split_messages!==false;
  if($("#humanizedEmojis"))$("#humanizedEmojis").checked=s.humanized_emojis!==false;
  if($("#humanizedAbbreviations"))$("#humanizedAbbreviations").checked=s.humanized_abbreviations!==false;
  if($("#humanizedTypingMin"))$("#humanizedTypingMin").value=Number(s.humanized_typing_min_ms||1800);
  if($("#humanizedTypingMax"))$("#humanizedTypingMax").value=Number(s.humanized_typing_max_ms||5000);
  if($("#conversationBotStatus")){$("#conversationBotStatus").className="pill "+(s.ai_enabled===false?"warning":"success");$("#conversationBotStatus").textContent=s.ai_enabled===false?"Desativado":"Ativo";}
  $("#welcomeMessage").value=s.welcome_message||"";
  $("#fallbackMessage").value=s.fallback_message||"";
  renderWhatsAppSlotTabs();
  const row=connectionForSlot(state.activeWhatsAppSlot);
  renderBridgeUi(!!row?.connected,row?.configured!==false);
  refreshBridgeStatus(state.activeWhatsAppSlot).catch(()=>{});
  loadVoiceConfig().catch(()=>{});
}

$("#settingsForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=e.submitter;if(btn)btn.disabled=true;
  try{
    const businessDescription=$("#businessDescription")?.value.trim()||"";
    const brandFile=$("#brandLogoFile")?.files?.[0];
    const brandLogo=brandFile?await fileToDataUrl(brandFile):(state.settings?.brand_logo_url||null);
    const settingsPatch={
      brand_logo_url:brandLogo,
      company_name:$("#companyName").value.trim()||"Minha empresa",
      virtual_agent_name:$("#virtualAgentName")?.value.trim()||(Number(state.workspace?.tenant_level||0)===0?"Ana":""),
      business_description:businessDescription,
      products_and_services:$("#productsAndServices")?.value.trim()||"",
      sales_objective:$("#salesObjective")?.value.trim()||"",
      service_area:$("#serviceArea")?.value.trim()||"",
      conversation_tone:$("#conversationTone")?.value.trim()||"natural, educado e direto",
      qualification_questions:linesArray($("#qualificationQuestions")?.value),
      handoff_rules:linesArray($("#handoffRules")?.value),
      universal_mode:$("#universalMode")?.checked!==false,
      media_understanding_enabled:$("#mediaUnderstandingEnabled")?.checked!==false,
      web_research_enabled:$("#webResearchEnabled")?.checked!==false,
      bot_disclosure:$("#botDisclosure")?.checked!==false,
      conversation_engine:$("#conversationEngine")?.value||"openai",
      ai_instructions:$("#aiInstructions")?.value||"",
      humanized_mode:$("#humanizedMode")?.checked!==false,
      humanized_split_messages:$("#humanizedSplitMessages")?.checked!==false,
      humanized_emojis:$("#humanizedEmojis")?.checked!==false,
      humanized_abbreviations:$("#humanizedAbbreviations")?.checked!==false,
      humanized_typing_min_ms:Math.max(800,Math.min(5000,Number($("#humanizedTypingMin")?.value||1800))),
      humanized_typing_max_ms:Math.max(800,Math.min(5000,Number($("#humanizedTypingMax")?.value||5000))),
      welcome_message:$("#welcomeMessage").value.trim(),
      ai_enabled:true,
      fallback_message:$("#fallbackMessage").value.trim(),
      updated_at:new Date().toISOString()
    };
    const workspacePatch={
      business_type:$("#businessType")?.value.trim()||null,
      business_description:businessDescription||null,
      onboarding_completed:true,
      updated_at:new Date().toISOString()
    };
    const [sr,wr]=await Promise.all([
      sb.from("wa_settings").update(settingsPatch).eq("workspace_id",state.workspace.id).select().single(),
      sb.from("wa_workspaces").update(workspacePatch).eq("id",state.workspace.id).select().single()
    ]);
    if(sr.error)throw sr.error;if(wr.error)throw wr.error;
    state.settings=sr.data;state.workspace=wr.data;
    if($("#sidebarCompanyName"))$("#sidebarCompanyName").textContent=sr.data.company_name||"Minha empresa";
    applyBrandLogo();
    renderDashboard();
    toast("Configurações salvas e aplicadas na IA.");
  }catch(err){toast(err.message||"Não foi possível salvar.","error")}
  finally{if(btn)btn.disabled=false}
});

async function bridgeInvoke(action,extra={}){
  const slot=Number(extra?.slot||state.activeWhatsAppSlot||1);
  const {data,error}=await sb.functions.invoke(BRIDGE_FUNCTION,{body:{workspace_id:state.workspace.id,action,slot,...extra}});
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

  const slot=state.activeWhatsAppSlot||1;
  const extraSlot=slot>1;
  pill.className="pill "+(connected?"success":"warning");
  pill.textContent=connected?"Conectado":"Não conectado";
  title.textContent=connected?"WhatsApp "+slot+" conectado":"WhatsApp "+slot+" ainda não conectado";

  if(extraSlot){
    state.bridgeHosted=true;
    state.bridgeManagedLocally=true;
    hint.textContent=connected
      ?"Este WhatsApp está ligado ao mesmo atendimento desta conta."
      :"Clique em Gerar QR Code e escaneie com o WhatsApp comum ou Business que deseja usar nesta conexão.";
    connect.textContent=connected?"Verificar conexão":"Gerar QR Code";
    disconnect.classList.toggle("hidden",!connected);
    $("#bridgeAdvanced")?.classList.add("hidden");
  }else if(state.bridgeHosted){
    hint.textContent=connected
      ?"Este número está conectado e as conversas ficam separadas nesta conta."
      :"Escaneie o QR Code com o WhatsApp comum ou Business desta conta.";
    connect.textContent=connected?"Verificar conexão":"Gerar QR Code";
    disconnect.classList.toggle("hidden",!connected);
    $("#bridgeAdvanced")?.classList.add("hidden");
  }else if(state.bridgeManagedLocally){
    hint.textContent=connected
      ?"Servidor JSTech conectado e mantendo a sessão automaticamente."
      :"Clique em Gerar QR Code e escaneie com o WhatsApp comum ou Business.";
    connect.textContent=connected?"Verificar conexão":"Gerar QR Code";
    disconnect.classList.toggle("hidden",!connected);
    $("#bridgeAdvanced")?.classList.add("hidden");
  }else{
    hint.textContent=connected?"Mensagens entrando e saindo pelo painel.":configured?"Clique abaixo para gerar o QR Code.":"Configure o servidor uma única vez para liberar o QR Code.";
    connect.textContent=connected?"Verificar conexão":"Conectar WhatsApp";
    disconnect.classList.toggle("hidden",!connected);
    $("#bridgeAdvanced")?.classList.toggle("hidden",slot>1);
  }
  if(connected)$("#qrPanel").classList.add("hidden");
}

async function refreshBridgeStatus(slot=state.activeWhatsAppSlot){
  if(!state.workspace)return;
  const targetSlot=Math.max(1,Math.min(4,Number(slot||1)));
  try{
    const data=await bridgeInvoke("status",{slot:targetSlot});
    const connected=!!data.connected;

    if(targetSlot===state.activeWhatsAppSlot){
      state.bridgeManagedLocally=targetSlot>1?true:!!data.managed_locally;
      state.bridgeHosted=targetSlot>1?true:!!data.hosted;
      if(targetSlot===1)state.settings.bridge_connected=connected;
      renderBridgeUi(connected,data.configured!==false);

      if(data.qr&&!connected){
        if($("#qrImage").getAttribute("src")!==data.qr)$("#qrImage").src=data.qr;
        $("#qrPanel").classList.remove("hidden");
        $("#qrConnectionTitle").textContent="Escaneie o QR Code do WhatsApp "+targetSlot;
        $("#qrConnectionHint").textContent="Abra o WhatsApp comum ou Business → Aparelhos conectados → Conectar um aparelho.";
      }else if(!connected){
        $("#qrImage").removeAttribute("src");
        $("#qrPanel").classList.add("hidden");
      }
      if(data.error&&!connected)toast(String(data.error),"error");
      if(targetSlot===1){
        if(data.base_url&&!$("#bridgeUrl").value)$("#bridgeUrl").value=data.base_url;
        if(data.instance_name)$("#bridgeInstance").value=data.instance_name;
        if(data.setup_required&&!$("#bridgeAdvanced")?.classList.contains("hidden"))$("#bridgeAdvanced").open=true;
      }
    }

    const idx=(state.whatsappConnections||[]).findIndex(x=>Number(x.slot)===targetSlot);
    const row={slot:targetSlot,connected,configured:data.configured!==false,state:data.state|| (connected?"connected":"disconnected"),provider:data.provider||null,instance_name:data.instance_name||null,error:data.error||null};
    if(idx>=0)state.whatsappConnections[idx]={...state.whatsappConnections[idx],...row};
    else state.whatsappConnections=[...(state.whatsappConnections||[]),row];

    renderDashboard();
    renderWhatsAppSlotTabs();
    return data;
  }catch(err){
    if(targetSlot===state.activeWhatsAppSlot)renderBridgeUi(false,true);
    return null;
  }
}

async function startBridgeConnect(){
  const targetSlot=state.activeWhatsAppSlot||1;
  const btn=$("#connectWhatsAppBtn");
  btn.disabled=true;btn.textContent="Preparando QR Code...";
  try{
    const data=await bridgeInvoke("connect",{slot:targetSlot});
    state.bridgeHosted=targetSlot>1?true:(!!data.hosted||state.bridgeHosted);
    state.bridgeManagedLocally=targetSlot>1?true:(!!data.managed_locally||state.bridgeManagedLocally);

    if(data.connected){
      if(targetSlot===1)state.settings.bridge_connected=true;
      await refreshBridgeConnections();
      renderBridgeUi(true,true);
      toast("WhatsApp "+targetSlot+" conectado.");
      return;
    }

    if(bridgePoll){clearInterval(bridgePoll);bridgePoll=null}
    const poll=async()=>{
      if(state.activeWhatsAppSlot!==targetSlot){
        if(bridgePoll){clearInterval(bridgePoll);bridgePoll=null}
        return;
      }
      const s=await refreshBridgeStatus(targetSlot);
      if(s?.connected){
        if(bridgePoll){clearInterval(bridgePoll);bridgePoll=null}
        $("#qrPanel").classList.add("hidden");
        await refreshBridgeConnections();
        toast("WhatsApp "+targetSlot+" conectado com sucesso.");
        return;
      }
      if(s?.qr){
        if($("#qrImage").getAttribute("src")!==s.qr)$("#qrImage").src=s.qr;
        $("#qrPanel").classList.remove("hidden");
        $("#qrConnectionTitle").textContent="Escaneie o QR Code do WhatsApp "+targetSlot;
        $("#qrConnectionHint").textContent="Abra o WhatsApp comum ou Business → Aparelhos conectados → Conectar um aparelho.";
      }
    };

    await poll();
    const current=connectionForSlot(targetSlot);
    if(!current?.connected){
      bridgePoll=setInterval(poll,7000);
      toast(data.qr?"QR Code gerado.":"Preparando o QR Code do WhatsApp "+targetSlot+"...");
    }
  }catch(err){
    if(targetSlot===1&&(String(err.message).includes("Servidor do WhatsApp")||String(err.message).includes("setup"))){
      $("#bridgeAdvanced").classList.remove("hidden");
      $("#bridgeAdvanced").open=true;
    }
    toast(err.message||"Não foi possível gerar o QR Code.","error");
  }finally{
    btn.disabled=false;
    const current=connectionForSlot(targetSlot);
    btn.textContent=current?.connected?"Verificar conexão":"Gerar QR Code";
  }
}

$("#connectWhatsAppBtn").addEventListener("click",startBridgeConnect);

$("#disconnectWhatsAppBtn").addEventListener("click",async()=>{
  const slot=state.activeWhatsAppSlot||1;
  if(!confirm("Desconectar o WhatsApp "+slot+" do painel?"))return;
  try{
    await bridgeInvoke("disconnect",{slot});
    if(slot===1)state.settings.bridge_connected=false;
    await refreshBridgeConnections();
    renderBridgeUi(false,true);
    toast("WhatsApp "+slot+" desconectado.");
  }catch(err){toast(err.message||"Falha ao desconectar.","error")}
});

$("#saveBridgeBtn").addEventListener("click",async()=>{
  if(state.activeWhatsAppSlot!==1)return toast("A configuração manual do servidor é usada somente no WhatsApp 1.","error");
  const base_url=$("#bridgeUrl").value.trim();
  const api_key=$("#bridgeApiKey").value.trim();
  const instance_name=$("#bridgeInstance").value.trim()||"jstech";
  if(!base_url||!api_key)return toast("Informe o endereço e a chave do servidor.","error");
  const btn=$("#saveBridgeBtn");btn.disabled=true;
  try{
    await bridgeInvoke("configure",{slot:1,base_url,api_key,instance_name});
    $("#bridgeApiKey").value="";
    $("#bridgeAdvanced").open=false;
    toast("Servidor salvo. Agora clique em Conectar WhatsApp.");
    await refreshBridgeStatus(1);
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
let refreshTimer=null;function refreshConversationData(){clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{const id=state.workspace.id;const [contacts,convs]=await Promise.all([sb.from("wa_contacts").select("*").eq("workspace_id",id).order("updated_at",{ascending:false}),sb.from("wa_conversations").select("*,wa_contacts(id,name,phone,email,status,bot_enabled,notes,profile_photo_url,profile_photo_preview_url,profile_photo_hd_url,bot_context,memory_context)").eq("workspace_id",id).order("last_message_at",{ascending:false})]);if(!contacts.error)state.contacts=contacts.data||[];if(!convs.error)state.conversations=convs.data||[];if(state.activeConversation){const fresh=state.conversations.find(x=>x.id===state.activeConversation.id);if(fresh)state.activeConversation=fresh}renderDashboard();renderContacts();renderConversations()},250)}
boot();
$("#campaignDdd27")?.addEventListener("change",renderCampaigns);
$("#campaignDdd28")?.addEventListener("change",renderCampaigns);

let panelAutomationAutoRefresh=setInterval(async()=>{
  const page=$("#page-panels");
  if(!page||!page.classList.contains("active")||!state.workspace?.id)return;
  try{
    await loadPanelConnectors(false);
    renderPanelConnectors();
    renderPanelAutomationCenter();
  }catch{}
},8000);
