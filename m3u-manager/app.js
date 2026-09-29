const API='https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/m3u-manager';
const $=id=>document.getElementById(id);
let key=localStorage.getItem('jstech_m3u_admin')||'';
let outputToken=localStorage.getItem('jstech_m3u_output')||'';
let state={sources:[]},selectedKind='';
$('adminKey').value=key;$('outputToken').value=outputToken;

function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2400)}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
async function api(action,opt={}){
 const r=await fetch(API+'?action='+encodeURIComponent(action),{...opt,headers:{'x-admin-key':key,'content-type':'application/json',...(opt.headers||{})},cache:'no-store'});
 const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch{d={error:text}}
 if(!r.ok||d.ok===false)throw new Error(d.error||'Falha na operação');
 return d;
}
async function login(){
 key=$('adminKey').value.trim();
 try{const d=await api('status');localStorage.setItem('jstech_m3u_admin',key);$('loginCard').classList.add('hidden');$('app').classList.remove('hidden');$('logoutBtn').classList.remove('hidden');applyStatus(d);await preview()}
 catch(e){$('loginError').textContent=e.message==='unauthorized'?'Chave inválida.':e.message}
}
$('loginBtn').onclick=login;
$('logoutBtn').onclick=()=>{localStorage.removeItem('jstech_m3u_admin');location.reload()};
if(key)login();

function applyStatus(d){
 state=d;$('total').textContent=d.total||0;$('live').textContent=d.kinds?.live||0;$('movie').textContent=d.kinds?.movie||0;$('series').textContent=d.kinds?.series||0;renderSources();updateUrl();
}
async function refresh(){applyStatus(await api('status'))}
function updateUrl(){
 outputToken=$('outputToken').value.trim();localStorage.setItem('jstech_m3u_output',outputToken);
 const u=new URL(API);u.searchParams.set('action','playlist');if(outputToken)u.searchParams.set('token',outputToken);if(selectedKind)u.searchParams.set('kind',selectedKind);$('finalUrl').value=u.href;
}
$('outputToken').oninput=updateUrl;
document.querySelectorAll('.kind').forEach(b=>b.onclick=()=>{selectedKind=b.dataset.kind||'';updateUrl();toast(selectedKind?'Filtro: '+b.textContent:'Lista completa')});
$('copyUrl').onclick=async()=>{await navigator.clipboard.writeText($('finalUrl').value);toast('URL copiada')};

$('sourceForm').onsubmit=async e=>{
 e.preventDefault();
 const body={id:$('sourceId').value||undefined,name:$('sourceName').value.trim(),url:$('sourceUrl').value.trim(),priority:Number($('sourcePriority').value||100),enabled:$('sourceEnabled').checked};
 try{await api('save-source',{method:'POST',body:JSON.stringify(body)});resetForm();await refresh();toast('Fonte salva')}
 catch(e){alert(e.message)}
};
function resetForm(){$('sourceForm').reset();$('sourceId').value='';$('sourcePriority').value='100';$('sourceEnabled').checked=true;$('cancelEdit').classList.add('hidden')}
$('cancelEdit').onclick=resetForm;

function renderSources(){
 const box=$('sources'),arr=state.sources||[];
 if(!arr.length){box.innerHTML='<p class="muted">Nenhuma fonte cadastrada ainda.</p>';return}
 box.innerHTML=arr.map(s=>`<div class="source"><div class="source-top"><div><b>${esc(s.name)}</b><small>${esc(s.url)}</small><small>Prioridade ${s.priority} • ${s.item_count||0} itens • <span class="${s.last_status==='ok'?'ok':s.last_status==='error'?'bad':''}">${esc(s.last_status||'never')}</span></small>${s.last_error?`<small class="bad">${esc(s.last_error)}</small>`:''}</div><div class="actions"><button class="secondary" data-edit="${s.id}">Editar</button><button data-sync="${s.id}">Sincronizar</button><button class="ghost" data-del="${s.id}">Excluir</button></div></div></div>`).join('');
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editSource(b.dataset.edit));
 document.querySelectorAll('[data-sync]').forEach(b=>b.onclick=()=>sync(b.dataset.sync,b));
 document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delSource(b.dataset.del));
}
function editSource(id){
 const s=state.sources.find(x=>x.id===id);if(!s)return;
 $('sourceId').value=s.id;$('sourceName').value=s.name;$('sourceUrl').value=s.url;$('sourcePriority').value=s.priority;$('sourceEnabled').checked=s.enabled;$('cancelEdit').classList.remove('hidden');scrollTo({top:$('sourceForm').offsetTop-120,behavior:'smooth'});
}
async function delSource(id){if(!confirm('Excluir esta fonte e os itens importados dela?'))return;await api('delete-source',{method:'POST',body:JSON.stringify({id})});await refresh();await preview();toast('Fonte excluída')}
async function sync(id,btn){
 const old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='Sincronizando...'}
 try{const d=await api('sync',{method:'POST',body:JSON.stringify(id?{source_id:id}:{})});const bad=(d.results||[]).filter(x=>!x.ok);toast(bad.length?bad.length+' fonte(s) com erro':'Sincronização concluída');await refresh();await preview()}
 catch(e){alert(e.message)}finally{if(btn){btn.disabled=false;btn.textContent=old}}
}
$('syncAll').onclick=()=>sync('', $('syncAll'));

async function preview(){
 try{const d=await api('preview');$('previewBody').innerHTML=(d.items||[]).map(i=>`<tr><td><span class="pill">${esc(i.kind)}</span></td><td>${esc(i.title)}</td><td>${esc(i.group_title)}</td><td>${esc(i.source_name)}</td><td>${i.quality_score||0}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Nenhum item sincronizado.</td></tr>'}
 catch(e){$('previewBody').innerHTML='<tr><td colspan="5" class="bad">'+esc(e.message)+'</td></tr>'}
}
$('refreshPreview').onclick=preview;