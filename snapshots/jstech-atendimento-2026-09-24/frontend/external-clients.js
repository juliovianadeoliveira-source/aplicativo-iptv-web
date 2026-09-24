import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
const db=createClient("https://fvttsguxeocisqvcrbqh.supabase.co","sb_publishable_0EBQukCnPwUwAFo5gzfl5g_Ycbw3dqN");
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const date=v=>v?new Date(v+"T12:00:00").toLocaleDateString("pt-BR"):"-";
let rows=[];

function mount(){
  if($("#externalClientsPanel"))return;
  const page=$("#page-contacts");if(!page)return;
  const el=document.createElement("article");el.id="externalClientsPanel";el.className="panel";el.style.marginBottom="18px";
  el.innerHTML='<div class="panel-head"><div><p class="eyebrow">Bancos conectados</p><h3>Clientes sincronizados</h3></div><input id="externalSearch" class="inline-search" placeholder="Buscar sincronizados"></div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Origem</th><th>Serviço</th><th>Aplicativo / usuário</th><th>Vencimento</th><th>Status</th></tr></thead><tbody id="externalRows"></tbody></table></div>';
  page.prepend(el);$("#externalSearch").oninput=render;
}
async function load(){
  mount();
  const {data:w}=await db.from("wa_workspaces").select("id").order("created_at").limit(1);if(!w?.length)return;
  const {data,error}=await db.from("wa_external_clients").select("*,wa_sync_sources(name,source_type)").eq("workspace_id",w[0].id).eq("active",true).order("expires_at",{ascending:true}).limit(3000);
  if(!error){rows=data||[];render()}
}
function render(){
  const host=$("#externalRows");if(!host)return;
  const q=($("#externalSearch")?.value||"").toLowerCase().trim();
  const list=rows.filter(x=>!q||[x.name,x.phone,x.service_type,x.app_name,x.login_username,x.wa_sync_sources?.name].join(" ").toLowerCase().includes(q));
  host.innerHTML=list.map(x=>'<tr><td><b>'+esc(x.name||"Sem nome")+'</b><small style="display:block;color:var(--muted)">'+esc(x.phone||"")+'</small></td><td>'+esc(x.wa_sync_sources?.name||"-")+'</td><td>'+esc(x.service_type||x.wa_sync_sources?.source_type||"-")+'</td><td>'+esc(x.app_name||"-")+'<small style="display:block;color:var(--muted)">'+esc(x.login_username||"")+'</small></td><td>'+date(x.expires_at)+'</td><td>'+esc(x.status||"-")+'</td></tr>').join("")||'<tr><td colspan="6" class="muted">Nenhum cliente sincronizado ainda.</td></tr>';
}
db.auth.onAuthStateChange((_e,s)=>{if(s)setTimeout(load,300)});setTimeout(load,800);
