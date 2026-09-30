const API='https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/m3u-manager';
const AUTH='https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/m3u-panel-auth';
const $=id=>document.getElementById(id);
let session=localStorage.getItem('jstech_m3u_session')||'',
outputToken=localStorage.getItem('jstech_m3u_output')||'',
state=(()=>{try{return JSON.parse(localStorage.getItem('jstech_m3u_state')||'null')||{sources:[],total:0,kinds:{}}}catch{return {sources:[],total:0,kinds:{}}}})(),
previewItems=(()=>{try{return JSON.parse(localStorage.getItem('jstech_m3u_preview')||'[]')}catch{return []}})(),
selectedKind='',contentFilter='';
$('outputToken').value=outputToken;
if($('bulkUrls')) $('bulkUrls').value=localStorage.getItem('jstech_m3u_bulk_draft')||'';
if($('bulkUrls')) $('bulkUrls').addEventListener('input',()=>localStorage.setItem('jstech_m3u_bulk_draft',$('bulkUrls').value));
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function toast(m){$('toast').textContent=m;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)}
async function api(action,opt={}){
 const u=new URL(API);u.searchParams.set('action',action);if(session)u.searchParams.set('session',session);
 const controller=new AbortController();
 const timeoutMs=action==='sync'?135000:30000;
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const r=await fetch(u,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})},cache:'no-store',signal:controller.signal});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{d={error:t}}
  if(!r.ok||d.ok===false)throw new Error(d.error||'Falha na operação');
  return d;
 }catch(e){
  if(e?.name==='AbortError')throw new Error(action==='sync'?'A lista continua processando; aguarde o status atualizar.':'O painel demorou para carregar os dados.');
  throw e;
 }finally{clearTimeout(timer)}
}
async function login(){
  const userEl=$('loginUser'), passEl=$('loginPassword'), err=$('loginError'), btn=$('loginBtn');
  const username=userEl.value.trim().toLowerCase();
  const password=passEl.value;
  if(!username||!password){err.textContent='Digite usuário e senha.';return}
  err.textContent='';
  btn.disabled=true;
  btn.textContent='Entrando...';
  try{
    const response=await Promise.race([
      fetch(AUTH,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username,password}),
        cache:'no-store'
      }),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tempo esgotado no login.')),10000))
    ]);
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{}}catch{}
    if(!response.ok||!data.ok||!data.token)throw new Error('Usuário ou senha incorretos.');

    session=data.token;
    localStorage.setItem('jstech_m3u_session',session);

    // abre imediatamente
    $('loginView').style.display='none';
    $('panel').classList.remove('hidden');
    btn.disabled=false;
    btn.textContent='Entrar';

    // carrega dados sem bloquear entrada
    setTimeout(async()=>{
      try{
        await loadSourcesFast();
        const status=await api('status');
        applyStatus(status);
        await preview();
      }catch(e){
        toast(e.message||'Painel aberto; dados ainda não carregaram.');
      }
    },50);
  }catch(e){
    err.textContent=e.message||'Não foi possível entrar.';
    btn.disabled=false;
    btn.textContent='Entrar';
  }
}
$('loginBtn').onclick=login;
$('loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('logoutBtn').onclick=()=>{localStorage.removeItem('jstech_m3u_session');location.reload()};
if(session){
  $('loginView').style.display='none';
  $('panel').classList.remove('hidden');
  if(state?.sources?.length || state?.total){
    applyStatus(state);
    if(previewItems.length)renderPreview();
  }
  loadSourcesFast();
  api('status').then(async d=>{
    $('loginView').style.display='none';
    $('panel').classList.remove('hidden');
    applyStatus(d);
    await preview();
  }).catch(()=>{
    localStorage.removeItem('jstech_m3u_session');
    session='';
  });
}
const titles={dashboard:'Dashboard',servers:'Listaes',content:'Conteúdo',sync:'Sincronização',output:'Lista final'};
function go(p){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+p));document.querySelectorAll('.nav[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===p));$('pageTitle').textContent=titles[p]||'Painel'}
document.querySelectorAll('.nav[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
function applyStatus(d){state=d;localStorage.setItem('jstech_m3u_state',JSON.stringify(d));$('total').textContent=d.total||0;$('live').textContent=d.kinds?.live||0;$('movie').textContent=d.kinds?.movie||0;$('series').textContent=d.kinds?.series||0;$('finalCountText').textContent=(d.total||0)+' itens';renderServers();renderSummary();renderSync();updateUrl()}
async function loadSourcesFast(){
  try{
    const d=await api('sources');
    state.sources=d.sources||[];
    localStorage.setItem('jstech_m3u_state',JSON.stringify(state));
    renderServers();
    renderSummary();
    renderSync();
  }catch(e){}
}
async function refresh(){await loadSourcesFast();applyStatus(await api('status'))}
function statusClass(s){return s==='ok'?'ok':s==='error'?'bad':'never'}
function renderSummary(){const a=state.sources||[];$('serverSummary').innerHTML=a.length?a.slice(0,6).map(s=>`<div class="summary-row"><div><b>${esc(s.name)}</b><small>${s.item_count||0} itens • prioridade ${s.priority}</small></div><span class="status ${statusClass(s.last_status)}">${esc(s.last_status||'never')}</span></div>`).join(''):'<p class="muted">Nenhum lista cadastrado.</p>'}
function renderSync(){const a=state.sources||[];$('syncList').innerHTML=a.length?a.map(s=>`<div class="summary-row"><div><b>${esc(s.name)}</b><small>${s.last_sync_at?new Date(s.last_sync_at).toLocaleString('pt-BR'):'Nunca sincronizado'} • ${s.item_count||0} itens</small>${s.last_error?`<small style="color:#fb7185">${esc(s.last_error)}</small>`:''}</div><div class="server-actions"><span class="status ${statusClass(s.last_status)}">${esc(s.last_status||'never')}</span><button data-sync="${s.id}" class="ghost">Sincronizar</button></div></div>`).join(''):'<p class="muted">Nenhum lista cadastrado.</p>';document.querySelectorAll('#syncList [data-sync]').forEach(b=>b.onclick=()=>sync(b.dataset.sync,b))}
function maskUrl(raw){
  try{
    const u=new URL(raw);
    const user=u.searchParams.get('username');
    const type=u.searchParams.get('type');
    const output=u.searchParams.get('output');
    let label=u.origin+u.pathname;
    const extras=[];
    if(user)extras.push('usuário '+user);
    if(type)extras.push(type);
    if(output)extras.push(output);
    return label+(extras.length?' • '+extras.join(' • '):'')+' • credenciais protegidas';
  }catch{return 'URL cadastrada • credenciais protegidas'}
}
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
     name=line.slice(0,pipe).trim();
     url=line.slice(pipe+1).trim();
   }
   if(!/^https?:\/\//i.test(url))continue;
   items.push({
     name:name||('Lista '+String(n).padStart(3,'0')),
     url,
     priority:100+n,
     enabled:true
   });
   n++;
 }
 if(!items.length)return alert('Nenhuma URL válida encontrada.');

 const btn=$('bulkImportBtn'),status=$('bulkStatus');
 btn.disabled=true;
 let saved=0,synced=0,failed=0;
 const created=[];

 try{
   // 1) salva as fontes
   for(let i=0;i<items.length;i++){
     status.textContent='Salvando '+(i+1)+'/'+items.length+'...';
     try{
       const d=await api('save-source',{method:'POST',body:JSON.stringify(items[i])});
       if(d?.source?.id){
         created.push(d.source);
         saved++;
       }else{
         failed++;
       }
     }catch(e){
       failed++;
     }
   }

   // 2) lê cada M3U imediatamente
   for(let i=0;i<created.length;i++){
     const s=created[i];
     status.textContent='Lendo '+(i+1)+'/'+created.length+' • '+s.name+'...';
     try{
       const d=await api('sync',{method:'POST',body:JSON.stringify({source_id:s.id})});
       const r=(d.results||[])[0];
       if(r?.ok)synced++;else failed++;
     }catch(e){
       failed++;
     }
     await refresh().catch(()=>{});
   }

   await preview().catch(()=>{});
   localStorage.setItem('jstech_m3u_bulk_draft',$('bulkUrls').value);
   status.textContent=synced+' lista(s) lida(s)'+(failed?' • '+failed+' com erro':'');
   toast('Importação concluída');
 }finally{
   btn.disabled=false;
 }
}

async function delSource(id){if(!confirm('Excluir esta lista e os itens importados dela?'))return;await api('delete-source',{method:'POST',body:JSON.stringify({id})});await refresh();await preview();toast('Lista excluída')}
async function sync(id,btn){
 const old=btn?.textContent;
 if(btn){btn.disabled=true;btn.textContent='Lendo lista...'}
 try{
   const d=await api('sync',{method:'POST',body:JSON.stringify({source_id:id})});
   const r=(d.results||[])[0];
   if(!r)throw new Error('O backend não retornou resultado para esta lista.');
   if(!r.ok)throw new Error(r.error||'Falha ao ler esta lista.');
   toast('Lista reconhecida: '+(r.items||0)+' itens');
   await refresh();await preview();
 }catch(e){
   await refresh().catch(()=>{});
   alert(e.message||'Falha ao ler esta lista.');
 } finally {
   if(btn){btn.disabled=false;btn.textContent=old}
 }
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
async function preview(kind=contentFilter){
 try{
  const actionKind=kind||'';
  const u=new URL(API);
  u.searchParams.set('action','preview');
  if(session)u.searchParams.set('session',session);
  if(actionKind)u.searchParams.set('kind',actionKind);
  const r=await fetch(u,{cache:'no-store'});
  const t=await r.text();
  let d={};try{d=t?JSON.parse(t):{}}catch{d={error:t}}
  if(!r.ok||d.ok===false)throw new Error(d.error||'Falha ao carregar conteúdo');
  previewItems=d.items||[];
  localStorage.setItem('jstech_m3u_preview_'+(actionKind||'all'),JSON.stringify(previewItems));
  renderPreview();
 }catch(e){
  const cachedKey='jstech_m3u_preview_'+(kind||'all');
  try{previewItems=JSON.parse(localStorage.getItem(cachedKey)||'[]')}catch{previewItems=[]}
  if(previewItems.length)renderPreview();else renderPreview(e.message);
 }
}
function renderPreview(err=''){const a=contentFilter?previewItems.filter(i=>i.kind===contentFilter):previewItems;const rows=err?`<tr><td colspan="5" style="color:#fb7185">${esc(err)}</td></tr>`:(a.map(i=>`<tr><td><span class="pill">${esc(i.kind)}</span></td><td>${esc(i.title)}</td><td>${esc(i.group_title)}</td><td>${esc(i.source_name)}</td><td>${i.quality_score||0}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Nenhum item sincronizado.</td></tr>');$('previewBody').innerHTML=rows;$('dashboardPreview').innerHTML=rows}
$('refreshPreview').onclick=preview;$('dashboardRefresh').onclick=preview;document.querySelectorAll('.filter').forEach(b=>b.onclick=async()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');contentFilter=b.dataset.filter||'';await preview(contentFilter)});
function updateUrl(){outputToken=$('outputToken').value.trim();localStorage.setItem('jstech_m3u_output',outputToken);const u=new URL(API);u.searchParams.set('action','playlist');if(outputToken)u.searchParams.set('token',outputToken);if(selectedKind)u.searchParams.set('kind',selectedKind);$('finalUrl').textContent=u.href}
$('outputToken').oninput=updateUrl;document.querySelectorAll('.kind').forEach(b=>b.onclick=()=>{document.querySelectorAll('.kind').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedKind=b.dataset.kind||'';updateUrl()});$('copyUrl').onclick=async()=>{await navigator.clipboard.writeText($('finalUrl').textContent);toast('URL copiada')};