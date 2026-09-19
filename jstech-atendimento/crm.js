import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const db=createClient("https://fvttsguxeocisqvcrbqh.supabase.co","sb_publishable_0EBQukCnPwUwAFo5gzfl5g_Ycbw3dqN");
const S={workspace:null,settings:null,contacts:[],guides:[],pending:[],history:[]};
const q=s=>document.querySelector(s);
const qa=s=>[...document.querySelectorAll(s)];
const money=v=>v==null||v===""?"valor não definido":Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const brdate=v=>v?new Intl.DateTimeFormat("pt-BR").format(new Date(v+"T12:00:00")):"-";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
function notice(t){alert(t)}
function device(v){return {smart_tv:"Smart TV",android:"Android / TV Box / Fire TV",receptor:"Receptor",outro:"Outro"}[v]||v||"-"}
function addDays(base,days){let d=base?new Date(base+"T12:00:00"):new Date();let n=new Date();n.setHours(12,0,0,0);if(d<n)d=n;d.setDate(d.getDate()+Number(days));return d.toISOString().slice(0,10)}
async function copy(t){try{await navigator.clipboard.writeText(t);notice("Mensagem copiada.")}catch{prompt("Copie a mensagem:",t)}}

function mount(){
  if(q("#crmPlus"))return;
  const p=q("#page-contacts"),s=q("#page-settings");if(!p||!s)return;
  const box=document.createElement("article");box.id="crmPlus";box.className="panel crm-plus";
  box.innerHTML='<div class="panel-head"><div><p class="eyebrow">Gerenciamento completo</p><h3>Cadastro, PIX e renovação</h3></div><button id="crmAdd" class="btn primary compact">+ Cadastrar cliente</button></div><div class="crm-kpis"><span><b id="crmTotal">0</b> clientes</span><span><b id="crmPend">0</b> renovações pendentes</span></div><div class="table-wrap"><table class="crm-table"><thead><tr><th>Cliente</th><th>Serviço</th><th>Aparelho</th><th>Vencimento</th><th>Ações</th></tr></thead><tbody id="crmRows"></tbody></table></div><h3 class="crm-subtitle">Aguardando confirmação de pagamento</h3><div id="crmPending"></div>';
  p.prepend(box);q("#crmAdd").onclick=()=>editClient();

  const cfg=document.createElement("article");cfg.className="panel crm-business";cfg.innerHTML='<p class="eyebrow">Cobrança e instalação</p><h3>PIX, preços e vídeos</h3><form id="crmCfg" class="stack"><label>Chave PIX<input id="crmPix"></label><label>Nome do recebedor<input id="crmHolder"></label><div class="crm-grid4"><label>30 dias<input id="p30" type="number" step="0.01"></label><label>90 dias<input id="p90" type="number" step="0.01"></label><label>180 dias<input id="p180" type="number" step="0.01"></label><label>365 dias<input id="p365" type="number" step="0.01"></label></div><label>Vídeo Smart TV<input id="vSmart" type="url" placeholder="https://..."></label><label>Vídeo Android / TV Box / Fire TV<input id="vAndroid" type="url" placeholder="https://..."></label><button class="btn primary" type="submit">Salvar PIX, valores e vídeos</button></form>';
  s.querySelector(".settings-grid")?.appendChild(cfg);q("#crmCfg").onsubmit=saveCfg;
}

async function init(){
  mount();
  const {data:{session}}=await db.auth.getSession();if(!session)return;
  const {data:w}=await db.from("wa_workspaces").select("*").order("created_at").limit(1);if(!w?.length)return;
  S.workspace=w[0];await refresh();
}
async function refresh(){
  const id=S.workspace.id;
  const [a,b,c,d,e]=await Promise.all([
    db.from("wa_settings").select("*").eq("workspace_id",id).single(),
    db.from("wa_contacts").select("*").eq("workspace_id",id).order("updated_at",{ascending:false}),
    db.from("wa_install_guides").select("*").eq("workspace_id",id),
    db.from("wa_pending_actions").select("*").eq("workspace_id",id).eq("status","aguardando_confirmacao").order("created_at",{ascending:false}),
    db.from("wa_history").select("*").eq("workspace_id",id).order("created_at",{ascending:false})
  ]);
  S.settings=a.data;S.contacts=b.data||[];S.guides=c.data||[];S.pending=d.data||[];S.history=e.data||[];render();
}
function render(){
  if(!q("#crmRows"))return;
  q("#crmTotal").textContent=S.contacts.length;q("#crmPend").textContent=S.pending.length;
  q("#crmRows").innerHTML=S.contacts.map(c=>'<tr><td><b>'+esc(c.name||"Sem nome")+'</b><small>'+esc(c.phone||"")+'</small></td><td>'+esc(c.service_type||"-")+'</td><td>'+esc(device(c.device_type))+'</td><td>'+brdate(c.expires_at)+'</td><td><div class="crm-actions"><button data-e="'+c.id+'">Editar</button><button data-r="'+c.id+'">Renovar</button><button data-p="'+c.id+'">PIX</button><button data-i="'+c.id+'">Instalação</button><button data-h="'+c.id+'">Histórico</button></div></td></tr>').join("")||'<tr><td colspan="5">Nenhum cliente.</td></tr>';
  qa("[data-e]").forEach(b=>b.onclick=()=>editClient(b.dataset.e));qa("[data-r]").forEach(b=>b.onclick=()=>renew(b.dataset.r));qa("[data-p]").forEach(b=>b.onclick=()=>pix(b.dataset.p));qa("[data-i]").forEach(b=>b.onclick=()=>install(b.dataset.i));qa("[data-h]").forEach(b=>b.onclick=()=>history(b.dataset.h));
  q("#crmPending").innerHTML=S.pending.map(a=>{const c=S.contacts.find(x=>x.id===a.contact_id),p=a.payload||{};return '<div class="crm-pending"><div><b>'+esc(c?.name||c?.phone||"Cliente")+'</b><span>'+esc(p.days)+' dias • '+money(p.amount)+'</span></div><div class="crm-actions"><button data-cpix="'+a.id+'">PIX</button><button class="ok" data-ok="'+a.id+'">Confirmar pago</button><button class="bad" data-x="'+a.id+'">Cancelar</button></div></div>'}).join("")||'<p class="muted">Nenhuma renovação pendente.</p>';
  qa("[data-cpix]").forEach(b=>b.onclick=()=>pendingPix(b.dataset.cpix));qa("[data-ok]").forEach(b=>b.onclick=()=>confirmPay(b.dataset.ok));qa("[data-x]").forEach(b=>b.onclick=()=>cancelPay(b.dataset.x));fillCfg();
}

async function editClient(id){
  const c=S.contacts.find(x=>x.id===id)||{};
  const name=prompt("Nome do cliente:",c.name||"");if(name===null)return;
  const phone=prompt("Telefone:",c.phone||"");if(phone===null||!phone.trim())return;
  const service=prompt("Serviço: IPTV, CS ou Outro",c.service_type||"IPTV");if(service===null)return;
  const dev=prompt("Aparelho: digite smart_tv para Smart TV, android para TV Box/Fire TV/Android, receptor ou outro",c.device_type||"");if(dev===null)return;
  const app=prompt("Aplicativo usado:",c.app_name||"");if(app===null)return;
  const exp=prompt("Vencimento no formato AAAA-MM-DD:",c.expires_at||"");if(exp===null)return;
  const notes=prompt("Observações:",c.notes||"");if(notes===null)return;
  const row={workspace_id:S.workspace.id,name:name.trim(),phone:phone.replace(/\D/g,""),service_type:service.trim()||null,device_type:dev.trim()||null,app_name:app.trim()||null,expires_at:exp.trim()||null,notes:notes.trim()||null,updated_at:new Date().toISOString()};
  const r=id?await db.from("wa_contacts").update(row).eq("id",id).select().single():await db.from("wa_contacts").insert(row).select().single();
  if(r.error)return notice(r.error.message);
  await db.from("wa_history").insert({workspace_id:S.workspace.id,contact_id:r.data.id,action:id?"cadastro_atualizado":"cliente_cadastrado",details:{service_type:row.service_type,device_type:row.device_type}});
  await refresh();notice(id?"Cliente atualizado.":"Cliente cadastrado.");
}

async function renew(id){
  const c=S.contacts.find(x=>x.id===id);if(!c)return;
  const days=prompt("Quantos dias? 30, 90, 180 ou 365","30");if(days===null)return;
  if(!["30","90","180","365"].includes(days))return notice("Escolha 30, 90, 180 ou 365.");
  const preset=S.settings?.renewal_prices?.[days];const value=prompt("Valor da renovação:",preset??c.plan_value??"");if(value===null||value==="")return;
  const amount=Number(String(value).replace(",", "."));if(!Number.isFinite(amount))return notice("Valor inválido.");
  const {data:a,error}=await db.from("wa_pending_actions").insert({workspace_id:S.workspace.id,contact_id:id,action_type:"renewal",payload:{days:Number(days),amount,old_expires_at:c.expires_at}}).select().single();
  if(error)return notice(error.message);
  await db.from("wa_payments").insert({workspace_id:S.workspace.id,contact_id:id,amount,method:"pix",status:"pendente",reference:a.id});
  await db.from("wa_history").insert({workspace_id:S.workspace.id,contact_id:id,action:"renovacao_solicitada",details:{days:Number(days),amount}});
  await refresh();notice("Renovação ficou pendente. O vencimento ainda NÃO foi alterado.");
}
function pixText(c,amount){
  if(!S.settings?.pix_key)return null;
  let t="Olá "+(c.name||"")+"! Para pagamento da renovação:\n\nChave PIX: "+S.settings.pix_key;
  if(S.settings.pix_holder)t+="\nRecebedor: "+S.settings.pix_holder;if(amount!=null)t+="\nValor: "+money(amount);
  t+="\n\nDepois do pagamento, envie o comprovante. A renovação será confirmada após a conferência.";return t;
}
function pix(id){const c=S.contacts.find(x=>x.id===id),a=S.pending.find(x=>x.contact_id===id);const t=pixText(c,a?.payload?.amount??c?.plan_value);if(!t)return notice("Cadastre sua chave PIX em Configurações.");copy(t)}
function pendingPix(id){const a=S.pending.find(x=>x.id===id),c=S.contacts.find(x=>x.id===a?.contact_id);const t=pixText(c,a?.payload?.amount);if(!t)return notice("Cadastre sua chave PIX em Configurações.");copy(t)}
async function confirmPay(id){
  const a=S.pending.find(x=>x.id===id),c=S.contacts.find(x=>x.id===a?.contact_id);if(!a||!c)return;
  if(!confirm("Pagamento conferido? Isso vai renovar "+(a.payload?.days||0)+" dias para "+(c.name||c.phone)+"."))return;
  const n=addDays(c.expires_at,a.payload.days);
  const r=await db.from("wa_contacts").update({expires_at:n,plan_days:Number(a.payload.days),plan_value:Number(a.payload.amount),payment_status:"pago",updated_at:new Date().toISOString()}).eq("id",c.id);if(r.error)return notice(r.error.message);
  await Promise.all([db.from("wa_pending_actions").update({status:"confirmado",confirmed_at:new Date().toISOString()}).eq("id",id),db.from("wa_payments").update({status:"pago",paid_at:new Date().toISOString()}).eq("reference",id),db.from("wa_history").insert({workspace_id:S.workspace.id,contact_id:c.id,action:"pagamento_confirmado_e_renovado",details:{days:a.payload.days,amount:a.payload.amount,new_expires_at:n}})]);
  await refresh();notice("Pago confirmado. Novo vencimento: "+brdate(n));
}
async function cancelPay(id){const a=S.pending.find(x=>x.id===id);if(!a||!confirm("Cancelar esta renovação pendente?"))return;await db.from("wa_pending_actions").update({status:"cancelado"}).eq("id",id);await db.from("wa_payments").update({status:"cancelado"}).eq("reference",id);await refresh()}

async function install(id){
  const c=S.contacts.find(x=>x.id===id);if(!c)return;let d=c.device_type;
  if(!d){d=prompt("É Smart TV ou Android/TV Box/Fire TV? Digite smart_tv ou android","android");if(!d)return;await db.from("wa_contacts").update({device_type:d,updated_at:new Date().toISOString()}).eq("id",id);c.device_type=d}
  const g=S.guides.find(x=>x.device_type===d);let t="Seu aparelho é "+device(d)+".\n\n"+(g?.instructions||"Vou te orientar na instalação.");
  if(g?.video_url)t+="\n\nVeja o vídeo passo a passo:\n"+g.video_url;else t+="\n\nO vídeo ainda não foi cadastrado. Um atendente vai orientar você.";
  await copy(t);if(g?.video_url&&confirm("Abrir o vídeo agora?"))window.open(g.video_url,"_blank","noopener");
}
function history(id){const c=S.contacts.find(x=>x.id===id),it=S.history.filter(x=>x.contact_id===id);let t="Histórico de "+(c?.name||c?.phone||"cliente")+":\n\n"+(it.map(x=>new Date(x.created_at).toLocaleString("pt-BR")+" - "+x.action).join("\n")||"Sem histórico.");alert(t)}

function fillCfg(){
  if(!S.settings||!q("#crmPix"))return;const p=S.settings.renewal_prices||{};q("#crmPix").value=S.settings.pix_key||"";q("#crmHolder").value=S.settings.pix_holder||"";q("#p30").value=p["30"]??"";q("#p90").value=p["90"]??"";q("#p180").value=p["180"]??"";q("#p365").value=p["365"]??"";
  q("#vSmart").value=S.guides.find(x=>x.device_type==="smart_tv")?.video_url||"";q("#vAndroid").value=S.guides.find(x=>x.device_type==="android")?.video_url||"";
}
async function saveCfg(e){
  e.preventDefault();const val=id=>q(id).value===""?null:Number(q(id).value);
  const r=await db.from("wa_settings").update({pix_key:q("#crmPix").value.trim()||null,pix_holder:q("#crmHolder").value.trim()||null,renewal_prices:{"30":val("#p30"),"90":val("#p90"),"180":val("#p180"),"365":val("#p365")},updated_at:new Date().toISOString()}).eq("workspace_id",S.workspace.id);if(r.error)return notice(r.error.message);
  const a=S.guides.find(x=>x.device_type==="smart_tv"),b=S.guides.find(x=>x.device_type==="android");if(a)await db.from("wa_install_guides").update({video_url:q("#vSmart").value.trim()||null,updated_at:new Date().toISOString()}).eq("id",a.id);if(b)await db.from("wa_install_guides").update({video_url:q("#vAndroid").value.trim()||null,updated_at:new Date().toISOString()}).eq("id",b.id);
  await refresh();notice("PIX, preços e vídeos salvos.");
}

db.auth.onAuthStateChange((_e,s)=>{if(s)init()});init();