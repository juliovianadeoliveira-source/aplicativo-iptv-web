import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const URL="https://fvttsguxeocisqvcrbqh.supabase.co";
const KEY="sb_publishable_0EBQukCnPwUwAFo5gzfl5g_Ycbw3dqN";
const db=createClient(URL,KEY);
const ADMIN_URL=URL+"/functions/v1/jstech-reseller-admin";
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
let workspace=null,role=null;

async function session(){
  return (await db.auth.getSession()).data.session;
}
async function call(body){
  const s=await session();if(!s)throw new Error("Entre novamente.");
  const r=await fetch(ADMIN_URL,{method:"POST",headers:{"Authorization":"Bearer "+s.access_token,"apikey":KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||"Falha na operação.");
  return d;
}
async function detectRole(){
  const s=await session();if(!s)return;
  const {data:a}=await db.from("wa_login_aliases").select("role,username,workspace_id").eq("auth_user_id",s.user.id).maybeSingle();
  role=a?.role||"reseller";
  workspace=a?.workspace_id?{id:a.workspace_id}:null;
  $("#resellerNav")?.classList.remove("hidden");
  $("#page-resellers")?.classList.remove("hidden");
  if(!workspace){
    const {data:w}=await db.from("wa_workspaces").select("id").eq("owner_id",s.user.id).limit(1);
    workspace=w?.[0]||null;
  }
  await load();
}
async function load(){
  if(!workspace)return;
  try{
    const d=await call({action:"list",workspace_id:workspace.id});
    const host=$("#resellerList");if(!host)return;
    host.innerHTML=(d.resellers||[]).map(r=>'<div class="knowledge-item"><div class="knowledge-item-head"><div><b>'+esc(r.name)+'</b><p>Usuário: '+esc(r.username)+' · Plano: '+esc(r.plan)+' · '+(r.active?'Ativo':'Bloqueado')+'</p></div><div class="knowledge-actions"><button data-pass="'+r.id+'">Senha</button><button data-toggle="'+r.id+'" data-active="'+(r.active?'1':'0')+'">'+(r.active?'Bloquear':'Ativar')+'</button></div></div></div>').join("")||'<p class="muted">Nenhum revendedor cadastrado.</p>';
    host.querySelectorAll("[data-pass]").forEach(b=>b.onclick=()=>resetPassword(b.dataset.pass));
    host.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>toggle(b.dataset.toggle,b.dataset.active==="1"));
  }catch(e){
    const host=$("#resellerList");if(host)host.innerHTML='<p class="muted">'+esc(e.message)+'</p>';
  }
}
async function toggle(id,active){
  if(!confirm(active?"Bloquear este revendedor?":"Ativar este revendedor?"))return;
  try{await call({action:active?"disable":"enable",workspace_id:workspace.id,reseller_id:id});await load()}catch(e){alert(e.message)}
}
async function resetPassword(id){
  const p=prompt("Digite a nova senha (mínimo 8 caracteres):");if(!p)return;
  try{await call({action:"password",workspace_id:workspace.id,reseller_id:id,password:p});alert("Senha alterada.")}catch(e){alert(e.message)}
}
$("#resellerForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=e.submitter;btn.disabled=true;
  try{
    await call({
      action:"create",workspace_id:workspace.id,
      name:$("#resellerName").value.trim(),
      username:$("#resellerUsername").value.trim(),
      password:$("#resellerPassword").value,
      plan:$("#resellerPlan").value.trim()||"revenda"
    });
    e.target.reset();$("#resellerPlan").value="revenda";
    alert("Revendedor criado. Ele já pode entrar com usuário e senha.");
    await load();
  }catch(err){alert(err.message)}finally{btn.disabled=false}
});
$("#reloadResellers")?.addEventListener("click",load);
db.auth.onAuthStateChange((_e,s)=>{if(s)setTimeout(detectRole,300)});
setTimeout(detectRole,700);
