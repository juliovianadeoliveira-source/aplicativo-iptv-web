const API='https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/m3u-manager';
const AUTH='https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/m3u-panel-auth';
const $=id=>document.getElementById(id);
let session=localStorage.getItem('jstech_m3u_session')||'',outputToken=localStorage.getItem('jstech_m3u_output')||'',state={sources:[],total:0,kinds:{}},previewItems=[],selectedKind='',contentFilter='';
$('outputToken').value=outputToken;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function toast(m){$('toast').textContent=m;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)}
async function api(action,opt={}){const u=new URL(API);u.searchParams.set('action',action);if(session)u.searchParams.set('session',session);const r=await fetch(u,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})},cache:'no-store'});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{d={error:t}}if(!r.ok||d.ok===false)throw new Error(d.error||'Falha na operação');return d}
async function login(){
 const username=$('loginUser').value.trim().toLowerCase(),password=$('loginPassword').value;
 $('loginError').textContent='';
 try{
  const r=await fetch(AUTH,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
  const d=await r.json();
  if(!r.ok||!d.ok)throw new Error('Usuário ou senha incorretos.');
  session=d.token;localStorage.setItem('jstech_m3u_session',session);
  const status=await api('status');
  $('loginView').classList.add('hidden');$('panel').classList.remove('hidden');applyStatus(status);await preview();
 }catch(e){$('loginError').textContent=e.message||'Não foi possível entrar.'}
}
$('loginBtn').onclick=login;
$('loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('logoutBtn').onclick=()=>{localStorage.removeItem('jstech_m3u_session');location.reload()};
if(session){api('status').then(async d=>{$('loginView').classList.add('hidden');$('panel').classList.remove('hidden');applyStatus(d);await preview()}).catch(()=>localStorage.removeItem('jstech_m3u_session'))};
const titles={dashboard:'Dashboard',servers:'Listaes',content:'Conteúdo',sync:'Sincronização',output:'Lista final'};
function go(p){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+p));document.querySelectorAll('.nav[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===p));$('pageTitle').textContent=titles[p]||'Painel'}
document.querySelectorAll('.nav[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
function applyStatus(d){state=d;$('total').textContent=d.total||0;$('live').textContent=d.kinds?.live||0;$('movie').textContent=d.kinds?.movie||0;$('series').textContent=d.kinds?.series||0;$('finalCountText').textContent=(d.total||0)+' itens';renderServers();renderSummary();renderSync();updateUrl()}
async function refresh(){applyStatus(await api('status'))}
function statusClass(s){return s==='ok'?'ok':s==='error'?'bad':'never'}
function renderSummary(){const a=state.sources||[];$('serverSummary').innerHTML=a.length?a.slice(0,6).map(s=>`<div class="summary-row"><div><b>${esc(s.name)}</b><small>${s.item_count||0} itens • prioridade ${s.priority}</small></div><span class="status ${statusClass(s.last_status)}">${esc(s.last_status||'never')}</span></div>`).join(''):'<p class="muted">Nenhum lista cadastrado.</p>'}
function renderSync(){const a=state.sources||[];$('syncList').innerHTML=a.length?a.map(s=>`<div class="summary-row"><div><b>${esc(s.name)}</b><small>${s.last_sync_at?new Date(s.last_sync_at).toLocaleString('pt-BR'):'Nunca sincronizado'} • ${s.item_count||0} itens</small>${s.last_error?`<small style="color:#fb7185">${esc(s.last_error)}</small>`:''}</div><div class="server-actions"><span class="status ${statusClass(s.last_status)}">${esc(s.last_status||'never')}</span><button data-sync="${s.id}" class="ghost">Sincronizar</button></div></div>`).join(''):'<p class="muted">Nenhum lista cadastrado.</p>';document.querySelectorAll('#syncList [data-sync]').forEach(b=>b.onclick=()=>sync(b.dataset.sync,b))}
function maskUrl(raw){try{const u=new URL(raw);if(u.searchParams.has('password'))u.searchParams.set('password','••••••');return u.toString()}catch{return raw}}
function renderServers(){const a=state.sources||[];$('sources').innerHTML=a.length?a.map(s=>`<article class="server-card"><div class="head"><div><h4>${esc(s.name)}</h4><p>${esc(maskUrl(s.url))}</p></div><span class="status ${statusClass(s.last_status)}">${esc(s.last_status||'never')}</span></div><div class="server-meta"><span class="chip">${s.item_count||0} itens</span><span class="chip">Prioridade ${s.priority}</span><span class="chip">${s.enabled?'Ativo':'Inativo'}</span></div><div class="server-actions"><button class="ghost" data-edit="${s.id}">Editar</button><button class="primary" data-sync="${s.id}">Sincronizar</button><button class="ghost" data-del="${s.id}">Excluir</button></div></article>`).join(''):'<article class="card"><p class="muted">Nenhum lista cadastrado.</p></article>';document.querySelectorAll('#sources [data-edit]').forEach(b=>b.onclick=()=>editSource(b.dataset.edit));document.querySelectorAll('#sources [data-sync]').forEach(b=>b.onclick=()=>sync(b.dataset.sync,b));document.querySelectorAll('#sources [data-del]').forEach(b=>b.onclick=()=>delSource(b.dataset.del))}
function openForm(edit=false){$('serverFormCard').classList.remove('hidden');$('serverFormTitle').textContent=edit?'Editar lista M3U':'Nova lista M3U';setTimeout(()=>$('serverFormCard').scrollIntoView({behavior:'smooth',block:'start'}),50)}
function closeForm(){resetForm();$('serverFormCard').classList.add('hidden')}
$('newServerBtn').onclick=()=>{resetForm();openForm(false)};$('closeServerForm').onclick=closeForm;$('cancelEdit').onclick=closeForm;

$('sourceForm').onsubmit=async e=>{
 e.preventDefault();
 const url=$('sourceUrl').value.trim();
 if(!/^https?:\/\//i.test(url))return alert('Cole uma URL M3U http:// ou https:// válida.');
 const body={id:$('sourceId').value||undefined,name:$('sourceName').value.trim(),url,priority:Number($('sourcePriority').value||100),enabled:$('sourceEnabled').checked};
 try{await api('save-source',{method:'POST',body:JSON.stringify(body)});closeForm();await refresh();toast('Lista salva')}
 catch(e){alert(e.message)}
};
function resetForm(){$('sourceForm').reset();$('sourceId').value='';$('sourcePriority').value='100';$('sourceEnabled').checked=true}
function editSource(id){
 const s=state.sources.find(x=>x.id===id);if(!s)return;
 $('sourceId').value=s.id;$('sourceName').value=s.name;$('sourcePriority').value=s.priority;$('sourceEnabled').checked=s.enabled;$('sourceUrl').value=s.url;openForm(true)
}

$('bulkImportBtn').onclick=async()=>{
 const lines=$('bulkUrls').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(!lines.length)return alert('Cole pelo menos uma URL M3U.');
 const items=[];
 let n=1;
 for(const line of lines){
   let name='',url=line;
   const pipe=line.indexOf('|');
   if(pipe>0 && !/^https?:\/\//i.test(line.slice(0,pipe))){
     name=line.slice(0,pipe).trim();url=line.slice(pipe+1).trim();
   }
   if(!/^https?:\/\//i.test(url))continue;
   items.push({name:name||('Lista '+String(n).padStart(3,'0')),url,priority:100+n,enabled:true});n++;
 }
 if(!items.length)return alert('Nenhuma URL válida encontrada.');
 $('bulkImportBtn').disabled=true;$('bulkStatus').textContent='Importando 0 de '+items.length+'...';
 let ok=0,fail=0;
 for(let i=0;i<items.length;i+=10){
   const batch=items.slice(i,i+10);
   const results=await Promise.allSettled(batch.map(body=>api('save-source',{method:'POST',body:JSON.stringify(body)})));
   for(const r of results){if(r.status==='fulfilled')ok++;else fail++}
   $('bulkStatus').textContent='Importando '+Math.min(i+10,items.length)+' de '+items.length+'...';
 }
 $('bulkImportBtn').disabled=false;$('bulkStatus').textContent=ok+' importadas'+(fail?' • '+fail+' com erro':'');
 $('bulkUrls').value='';await refresh();toast('Importação concluída');
}
async function delSource(id){if(!confirm('Excluir esta lista e os itens importados dela?'))return;await api('delete-source',{method:'POST',body:JSON.stringify({id})});await refresh();await preview();toast('Lista excluída')}
async function sync(id,btn){
 const old=btn?.textContent;
 if(btn){btn.disabled=true;btn.textContent='Sincronizando...'}
 try{
   const d=await api('sync',{method:'POST',body:JSON.stringify({source_id:id})});
   const r=(d.results||[])[0];
   if(r && !r.ok)throw new Error(r.error||'Falha ao sincronizar esta lista.');
   toast('Lista sincronizada');
   await refresh();await preview();
 }catch(e){alert(e.message||'Falha ao sincronizar esta lista.')}
 finally{if(btn){btn.disabled=false;btn.textContent=old}}
}
async function syncAllSequential(btn){
 const old=btn?.textContent;
 const sources=(state.sources||[]).filter(s=>s.enabled);
 if(!sources.length)return alert('Nenhuma lista ativa cadastrada.');
 btn.disabled=true;
 let ok=0,fail=0;
 try{
   for(let i=0;i<sources.length;i++){
     const s=sources[i];
     btn.textContent='Sincronizando '+(i+1)+'/'+sources.length;
     try{
       const d=await api('sync',{method:'POST',body:JSON.stringify({source_id:s.id})});
       const r=(d.results||[])[0];
       if(r && r.ok)ok++; else fail++;
     }catch(e){fail++}
     await refresh();
   }
   await preview();
   toast(ok+' lista(s) sincronizada(s)'+(fail?' • '+fail+' com erro':''));
 }finally{
   btn.disabled=false;btn.textContent=old;
 }
}
$('syncAll').onclick=()=>syncAllSequential($('syncAll'));
$('topSyncAll').onclick=()=>syncAllSequential($('topSyncAll'));
async function preview(){try{const d=await api('preview');previewItems=d.items||[];renderPreview()}catch(e){previewItems=[];renderPreview(e.message)}}
function renderPreview(err=''){const a=contentFilter?previewItems.filter(i=>i.kind===contentFilter):previewItems;const rows=err?`<tr><td colspan="5" style="color:#fb7185">${esc(err)}</td></tr>`:(a.map(i=>`<tr><td><span class="pill">${esc(i.kind)}</span></td><td>${esc(i.title)}</td><td>${esc(i.group_title)}</td><td>${esc(i.source_name)}</td><td>${i.quality_score||0}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Nenhum item sincronizado.</td></tr>');$('previewBody').innerHTML=rows;$('dashboardPreview').innerHTML=rows}
$('refreshPreview').onclick=preview;$('dashboardRefresh').onclick=preview;document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');contentFilter=b.dataset.filter||'';renderPreview()});
function updateUrl(){outputToken=$('outputToken').value.trim();localStorage.setItem('jstech_m3u_output',outputToken);const u=new URL(API);u.searchParams.set('action','playlist');if(outputToken)u.searchParams.set('token',outputToken);if(selectedKind)u.searchParams.set('kind',selectedKind);$('finalUrl').textContent=u.href}
$('outputToken').oninput=updateUrl;document.querySelectorAll('.kind').forEach(b=>b.onclick=()=>{document.querySelectorAll('.kind').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedKind=b.dataset.kind||'';updateUrl()});$('copyUrl').onclick=async()=>{await navigator.clipboard.writeText($('finalUrl').textContent);toast('URL copiada')};