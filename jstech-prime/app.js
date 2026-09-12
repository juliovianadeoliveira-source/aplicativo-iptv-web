const API = 'https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-prime-public-api';
const WHATSAPP = '5527997314781';

const fallbackSources = [
  {source_key:'plenocs',name:'Catálogo 1',sync_status:'fallback',plans:[{name:'Mensal',price:25,months:1,monthly_equivalent:25},{name:'Trimestral',price:65,months:3,monthly_equivalent:21.67},{name:'Semestral',price:120,months:6,monthly_equivalent:20},{name:'Anual',price:210,months:12,monthly_equivalent:17.5}],compatibility:['Smart TV','TV Box','Celular','Computador'],qualities:['HD','Full HD','4K'],payments:['Pix'],free_trial:true,support:{trial_hours:24,whatsapp_days_per_week:7}},
  {source_key:'questbr',name:'Catálogo 2',sync_status:'fallback',plans:[{name:'Mensal',price:25,months:1,monthly_equivalent:25},{name:'Trimestral',price:65,months:3,monthly_equivalent:21.67},{name:'Semestral',price:130,months:6,monthly_equivalent:21.67},{name:'Anual',price:250,months:12,monthly_equivalent:20.83}],compatibility:['Android TV','Fire TV Stick','Chromecast','Roku','Android','iPhone','Notebook','PC','iPad','Apple TV'],qualities:['SD','HD','Full HD','4K'],payments:['Pix','Cartão de crédito','Boleto bancário'],free_trial:true,support:{trial_hours:24,whatsapp_days_per_week:7}},
  {source_key:'camisa10',name:'Catálogo 3',sync_status:'fallback',plans:[{name:'Mensal',price:30,months:1,monthly_equivalent:30},{name:'Trimestral',price:80,months:3,monthly_equivalent:26.67},{name:'Semestral',price:150,months:6,monthly_equivalent:25},{name:'Anual',price:280,months:12,monthly_equivalent:23.33}],compatibility:['Smart TV','TV Box','Fire TV Stick','Celular','Tablet','Computador'],qualities:['SD','HD','Full HD','4K'],payments:['Pix','Cartão de crédito'],free_trial:true,support:{trial_hours:6}}
];

let sources = fallbackSources;
let selectedKey = sources[0].source_key;

function money(value){return Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
function unique(values){return [...new Set(values.filter(Boolean))]}
function wa(message){return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message)}`}

function wireWhatsApp(){
  document.querySelectorAll('[data-wa]').forEach(el=>{
    let message='Olá! Vim pelo site da JSTech Prime e gostaria de conhecer os planos disponíveis.';
    if(el.dataset.wa==='trial')message='Olá! Vim pelo site da JSTech Prime e gostaria de solicitar um teste grátis.';
    if(el.dataset.wa==='support')message='Olá! Vim pelo site da JSTech Prime e preciso de ajuda com meu aparelho.';
    el.href=wa(message);el.target='_blank';el.rel='noopener noreferrer';
  });
}

function sourceLabel(source,index){return source.display_name||source.name||`Catálogo ${index+1}`}

function renderTabs(){
  const tabs=document.getElementById('sourceTabs');
  tabs.innerHTML=sources.map((source,index)=>`<button type="button" role="tab" aria-selected="${source.source_key===selectedKey}" class="${source.source_key===selectedKey?'active':''} ${source.sync_status==='error'?'warn':''}" data-source="${source.source_key}">${sourceLabel(source,index)}</button>`).join('');
  tabs.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{selectedKey=button.dataset.source;renderTabs();renderPlans()}));
}

function renderPlans(){
  const source=sources.find(item=>item.source_key===selectedKey)||sources[0];
  const grid=document.getElementById('plansGrid');
  const plans=[...(source?.plans||[])].sort((a,b)=>Number(a.months)-Number(b.months));
  if(!plans.length){grid.innerHTML='<div class="sync-note"><strong>Nenhum plano disponível neste catálogo agora.</strong></div>';return}
  const longest=Math.max(...plans.map(plan=>Number(plan.months)||0));
  grid.innerHTML=plans.map(plan=>{
    const months=Number(plan.months)||1;
    const featured=months===longest;
    const message=`Olá! Vim pelo site da JSTech Prime e quero o ${sourceLabel(source,sources.indexOf(source))}, plano ${plan.name}, no valor de R$ ${money(plan.price)}.`;
    return `<article class="plan-card ${featured?'featured':''}"><small>${months===1?'COMECE POR AQUI':months===3?'MAIS FLEXÍVEL':months===6?'MAIS ECONOMIA':'MELHOR CUSTO'}</small><h3>Plano ${plan.name}</h3><div class="price"><span>R$</span><strong>${money(plan.price)}</strong></div><div class="monthly">${months>1?`equivale a R$ ${money(plan.monthly_equivalent||plan.price/months)} por mês`:'cobrado mensalmente'}</div><ul><li>Qualidade ${(source.qualities||['HD','Full HD']).join(' / ')}</li><li>Catálogo completo e organizado</li><li>Suporte pelo WhatsApp</li>${source.free_trial?'<li>Teste grátis quando disponível</li>':''}</ul><a class="btn ${featured?'btn-primary':'btn-ghost'}" href="${wa(message)}" target="_blank" rel="noopener noreferrer">Escolher este plano →</a></article>`;
  }).join('');
}

function deviceIcon(name){const n=name.toLowerCase();if(n.includes('tv')||n.includes('roku'))return'▣';if(n.includes('cel')||n.includes('iphone')||n==='android')return'▯';if(n.includes('pc')||n.includes('note')||n.includes('comput'))return'⌨';if(n.includes('box')||n.includes('fire')||n.includes('chrome'))return'◫';if(n.includes('tablet')||n.includes('ipad'))return'▱';return'◇'}

function renderCombined(){
  const devices=unique(sources.flatMap(source=>source.compatibility||[]));
  const qualities=unique(sources.flatMap(source=>source.qualities||[]));
  const trialHours=sources.map(source=>Number(source.support?.trial_hours)||0).filter(Boolean);
  document.getElementById('deviceCount').textContent=`${devices.length || 13}+`;
  document.getElementById('trialHours').textContent=trialHours.length?`até ${Math.max(...trialHours)}h`:'teste';
  document.getElementById('qualityRow').innerHTML=(qualities.length?qualities:['HD','Full HD','4K']).map(item=>`<b>${item.toUpperCase()}</b>`).join('');
  document.getElementById('deviceGrid').innerHTML=(devices.length?devices:fallbackSources.flatMap(s=>s.compatibility)).slice(0,16).map(name=>`<article class="device-card"><span>${deviceIcon(name)}</span><strong>${name}</strong><small>Compatibilidade conforme modelo e aplicativo.</small></article>`).join('');
  const good=sources.filter(source=>source.sync_status==='ok');
  const errors=sources.filter(source=>source.sync_status==='error');
  document.getElementById('syncDot').classList.toggle('error',errors.length>0);
  document.getElementById('syncTitle').textContent=good.length===3?'Três fontes sincronizadas':good.length?`${good.length} fonte(s) atualizada(s); último dado válido preservado`:'Exibindo último catálogo disponível';
  document.getElementById('syncText').textContent=errors.length?'Uma fonte não respondeu agora. O site não ficou vazio e tentará novamente na próxima atualização.':'Preços, planos e informações foram conferidos automaticamente.';
  const dates=sources.map(source=>new Date(source.fetched_at||0)).filter(date=>!Number.isNaN(date.getTime())&&date.getTime()>0);
  if(dates.length){const latest=new Date(Math.max(...dates));document.getElementById('lastUpdate').textContent=`Última atualização: ${latest.toLocaleString('pt-BR')}`}
}

async function loadCatalog(){
  try{
    const response=await fetch(API,{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    if(Array.isArray(payload))sources=payload;
    else if(Array.isArray(payload.sources)&&payload.sources.length)sources=payload.sources;
    if(!sources.some(source=>source.source_key===selectedKey))selectedKey=sources[0].source_key;
  }catch(error){console.warn('Usando catálogo de segurança.',error)}
  renderTabs();renderPlans();renderCombined();
}

document.querySelectorAll('.faq button').forEach(button=>button.addEventListener('click',()=>{
  const item=button.closest('.faq');const open=item.classList.contains('open');
  document.querySelectorAll('.faq.open').forEach(faq=>faq.classList.remove('open'));
  if(!open)item.classList.add('open');
}));

const form=document.getElementById('leadForm');
form?.addEventListener('submit',async event=>{
  event.preventDefault();const status=document.getElementById('formStatus');const button=form.querySelector('button[type=submit]');const data=Object.fromEntries(new FormData(form).entries());
  if(String(data.nome||'').trim().length<2||String(data.whatsapp||'').replace(/\D/g,'').length<8||!data.servico){status.textContent='Confira seu nome, WhatsApp e serviço.';return}
  button.disabled=true;button.textContent='Enviando…';status.textContent='';
  try{const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!response.ok)throw new Error();status.textContent='Solicitação enviada com sucesso!';form.reset()}
  catch{status.textContent='Não foi possível registrar agora. Use o botão do WhatsApp.'}
  finally{button.disabled=false;button.textContent='Enviar solicitação →'}
});

wireWhatsApp();loadCatalog();
