import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const URL="https://fvttsguxeocisqvcrbqh.supabase.co";
const KEY="sb_publishable_0EBQukCnPwUwAFo5gzfl5g_Ycbw3dqN";
const db=createClient(URL,KEY);
const ADMIN_FN=URL+"/functions/v1/jstech-sync-admin";
const INGEST=URL+"/functions/v1/jstech-sync-ingest";
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

async function getWorkspace(){
  const {data,error}=await db.from("wa_workspaces").select("*").order("created_at").limit(1);
  if(error)throw error;
  return data?.[0]||null;
}
async function callAdmin(body){
  const {data:{session}}=await db.auth.getSession();
  if(!session)throw new Error("Entre no painel novamente.");
  const r=await fetch(ADMIN_FN,{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"apikey":KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||"Falha na operação.");
  return d;
}
function mount(){
  if($("#syncSourcesPanel"))return;
  const grid=$("#page-settings .settings-grid");if(!grid)return;
  const el=document.createElement("article");
  el.id="syncSourcesPanel";el.className="panel sync-panel";
  el.innerHTML='<div class="panel-head"><div><p class="eyebrow">Revendas e bancos externos</p><h3>Sincronização de bancos</h3></div><button id="syncNewSource" class="btn primary compact">+ Nova fonte</button></div><p class="muted">Cada revenda recebe um token próprio. O coletor fica no servidor onde está o banco e sincroniza os clientes com o JSTech.</p><div class="sync-endpoint"><b>Destino</b><code>'+INGEST+'</code></div><div id="syncSourcesList" class="sync-list"></div><div class="sync-help"><b>Como funciona</b><p>Crie a fonte, copie o token e coloque o coletor PHP no servidor da revenda. Ele pode sincronizar manualmente ou pelo cron.</p></div>';
  grid.appendChild(el);
  $("#syncNewSource").onclick=createSource;
}
async function createSource(){
  try{
    const w=await getWorkspace();if(!w)throw new Error("Workspace não encontrado.");
    const name=prompt("Nome da revenda ou do banco:","Revenda IPTV");if(!name)return;
    const sourceType=(prompt("Tipo: iptv, cs ou outro","iptv")||"iptv").trim().toLowerCase();
    const d=await callAdmin({action:"create",workspace_id:w.id,name:name.trim(),source_type:sourceType});
    prompt("Copie este token agora. Ele só aparece uma vez:",d.token);
    await loadSources();
  }catch(e){alert(e.message)}
}
async function rotate(id){
  if(!confirm("Gerar token novo? O token antigo vai parar de funcionar."))return;
  try{const d=await callAdmin({action:"rotate",source_id:id});prompt("Copie o novo token agora:",d.token);await loadSources()}catch(e){alert(e.message)}
}
async function toggle(id,isEnabled){
  try{await callAdmin({action:isEnabled?"disable":"enable",source_id:id});await loadSources()}catch(e){alert(e.message)}
}
async function loadSources(){
  mount();
  const w=await getWorkspace();if(!w)return;
  const {data,error}=await db.from("wa_sync_sources").select("*").eq("workspace_id",w.id).order("created_at",{ascending:false});
  if(error)return;
  const host=$("#syncSourcesList");if(!host)return;
  host.innerHTML=(data||[]).map(x=>'<div class="sync-source"><div><b>'+esc(x.name)+'</b><span>'+esc(String(x.source_type||"").toUpperCase())+' · '+(x.enabled?'Ativa':'Desativada')+'</span><small>Última sincronização: '+(x.last_synced_at?new Date(x.last_synced_at).toLocaleString("pt-BR"):"Nunca")+' · '+Number(x.record_count||0)+' registros</small>'+(x.last_error?'<small class="sync-error">'+esc(x.last_error)+'</small>':'')+'</div><div class="sync-actions"><button data-rotate="'+x.id+'">Novo token</button><button data-toggle="'+x.id+'" data-enabled="'+(x.enabled?'1':'0')+'">'+(x.enabled?'Desativar':'Ativar')+'</button></div></div>').join("")||'<p class="muted">Nenhuma fonte cadastrada.</p>';
  host.querySelectorAll("[data-rotate]").forEach(b=>b.onclick=()=>rotate(b.dataset.rotate));
  host.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>toggle(b.dataset.toggle,b.dataset.enabled==="1"));
}
db.auth.onAuthStateChange((_e,s)=>{if(s)setTimeout(loadSources,250)});
setTimeout(loadSources,700);
