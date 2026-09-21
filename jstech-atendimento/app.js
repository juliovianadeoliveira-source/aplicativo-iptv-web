import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const SUPABASE_URL = "https://fvttsguxeocisqvcrbqh.supabase.co";
const SUPABASE_KEY = "sb_publishable_0EBQukCnPwUwAFo5gzfl5g_Ycbw3dqN";
const BRIDGE_FUNCTION = "jstech-wa-bridge";
const USERNAME_LOGIN_URL = SUPABASE_URL + "/functions/v1/jstech-username-login";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = {
  session:null, workspace:null, settings:null, contacts:[], conversations:[], messages:[],
  automations:[], knowledge:[], activeConversation:null, activeAutomation:null,
  activeNode:null, editingKnowledge:null, channel:null, simNode:null, bridgeManagedLocally:false
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
    contacts:["CRM","Clientes"],automation:["Fluxos e regras","Automação"],
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
    const [settings,contacts,convs,autos,knowledge]=await Promise.all([
      sb.from("wa_settings").select("*").eq("workspace_id",id).single(),
      sb.from("wa_contacts").select("*").eq("workspace_id",id).order("updated_at",{ascending:false}),
      sb.from("wa_conversations").select("*,wa_contacts(id,name,phone,status,bot_enabled,notes)").eq("workspace_id",id).order("last_message_at",{ascending:false}),
      sb.from("wa_automations").select("*").eq("workspace_id",id).order("created_at"),
      sb.from("wa_knowledge").select("*").eq("workspace_id",id).order("title")
    ]);
    if(settings.error)throw settings.error;if(contacts.error)throw contacts.error;if(convs.error)throw convs.error;if(autos.error)throw autos.error;if(knowledge.error)throw knowledge.error;
    state.settings=settings.data;state.contacts=contacts.data||[];state.conversations=convs.data||[];state.automations=autos.data||[];state.knowledge=knowledge.data||[];
    if(!state.activeAutomation&&state.automations.length){state.activeAutomation=structuredClone(state.automations[0]);state.activeNode=state.activeAutomation.flow?.start||Object.keys(state.activeAutomation.flow?.nodes||{})[0]}
    renderAll(); if(showToast)toast("Painel atualizado.");
  }catch(err){console.error(err);toast(err.message||"Erro ao carregar o painel.","error")}
}
function renderAll(){renderDashboard();renderConversations();renderContacts();renderAutomations();renderKnowledge();renderSettings();}

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
    if(ct){ct.bot_enabled=false;ct.bot_context={};}
    state.activeConversation.status="atendimento_humano";
    $("#toggleBotBtn").textContent="👤 Atendimento humano";
    $("#toggleBotBtn").classList.remove("primary");
    renderContactDetails(ct||{},state.activeConversation);
    await loadMessages(state.activeConversation.id);
    toast("Mensagem enviada. A IA ficou pausada nesta conversa.");
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
  const [{error},convUpdate]=await Promise.all([
    sb.from("wa_contacts").update({bot_enabled:value,bot_context:{},updated_at:now}).eq("id",ct.id),
    sb.from("wa_conversations").update({status:value?"aberta":"atendimento_humano"}).eq("id",state.activeConversation.id)
  ]);
  if(error){toast(error.message,"error");return}
  ct.bot_enabled=value;
  state.activeConversation.status=value?"aberta":"atendimento_humano";
  $("#toggleBotBtn").textContent=value?"🤖 IA ativa":"👤 Atendimento humano";
  $("#toggleBotBtn").classList.toggle("primary",value);
  renderContactDetails(ct,state.activeConversation);renderContacts();
  toast(value?"IA reativada nesta conversa.":"Você assumiu o atendimento. A IA foi pausada.");
});

function renderContacts(){
  const q=($("#contactSearch")?.value||"").toLowerCase().trim();
  $("#contactsTable").innerHTML=state.contacts.filter(c=>!q||(c.name||"").toLowerCase().includes(q)||(c.phone||"").includes(q)).map(c=>'<tr><td><b>'+escapeHtml(c.name||"Sem nome")+'</b></td><td>'+escapeHtml(c.phone)+'</td><td>'+escapeHtml(c.status||"novo")+'</td><td><button class="toggle-chip '+(c.bot_enabled?"on":"")+'" data-contact-bot="'+c.id+'">'+(c.bot_enabled?"Ativo":"Pausado")+'</button></td><td>'+fmtDate(c.updated_at)+'</td></tr>').join("");
  $$("[data-contact-bot]").forEach(b=>b.addEventListener("click",()=>toggleContactBot(b.dataset.contactBot)));
}
$("#contactSearch").addEventListener("input",renderContacts);
async function toggleContactBot(id){const c=state.contacts.find(x=>x.id===id);if(!c)return;const {error}=await sb.from("wa_contacts").update({bot_enabled:!c.bot_enabled,bot_context:{},updated_at:new Date().toISOString()}).eq("id",id);if(error)return toast(error.message,"error");c.bot_enabled=!c.bot_enabled;renderContacts();renderDashboard()}

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

$("#settingsForm").addEventListener("submit",async e=>{e.preventDefault();const patch={company_name:$("#companyName").value.trim()||"JSTech",welcome_message:$("#welcomeMessage").value.trim(),ai_enabled:false,fallback_message:$("#fallbackMessage").value.trim(),updated_at:new Date().toISOString()};const {data,error}=await sb.from("wa_settings").update(patch).eq("workspace_id",state.workspace.id).select().single();if(error)return toast(error.message,"error");state.settings=data;renderDashboard();toast("Configurações salvas.")});

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
  hint.textContent=connected?"Mensagens entrando e saindo pelo painel.":configured?"Clique abaixo para gerar o QR Code.":"Configure o servidor uma única vez para liberar o QR Code.";
  connect.textContent=connected?"Verificar conexão":"Conectar WhatsApp";
  disconnect.classList.toggle("hidden",!connected||state.bridgeManagedLocally);
  if(state.bridgeManagedLocally){
    hint.textContent=connected?"Servidor JSTech conectado e mantendo a sessão automaticamente.":"Aguardando o agente do servidor JSTech.";
    connect.textContent="Verificar conexão";
    $("#bridgeAdvanced")?.classList.add("hidden");
  }else{
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
    state.settings.bridge_connected=connected;
    renderBridgeUi(connected,data.configured!==false);
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
  btn.disabled=true;btn.textContent="Gerando QR Code...";
  try{
    const data=await bridgeInvoke("connect");
    if(data.connected){
      state.settings.bridge_connected=true;
      renderBridgeUi(true,true);renderDashboard();toast("WhatsApp conectado.");
      return;
    }
    if(data.qr){
      $("#qrImage").src=data.qr;
      $("#qrPanel").classList.remove("hidden");
      $("#qrConnectionTitle").textContent="Escaneie o QR Code";
      $("#qrConnectionHint").textContent="Aguardando leitura pelo WhatsApp...";
      toast("QR Code gerado.");
      clearInterval(bridgePoll);
      bridgePoll=setInterval(async()=>{
        const s=await refreshBridgeStatus();
        if(s?.connected){clearInterval(bridgePoll);bridgePoll=null;$("#qrPanel").classList.add("hidden");toast("WhatsApp conectado com sucesso.");}
      },3000);
      setTimeout(()=>{if(bridgePoll){clearInterval(bridgePoll);bridgePoll=null;}},120000);
    }else{
      toast("Conexão iniciada. Clique novamente se o QR não aparecer.","error");
    }
  }catch(err){
    if(String(err.message).includes("Servidor do WhatsApp")||String(err.message).includes("setup")){
      $("#bridgeAdvanced").open=true;
    }
    toast(err.message||"Não foi possível gerar o QR Code.","error");
  }finally{
    btn.disabled=false;
    if(!state.settings?.bridge_connected)btn.textContent="Conectar WhatsApp";
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