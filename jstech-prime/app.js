const API='https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-prime-public-api';
const WHATSAPP='5527997314781';

const fallback={
  plans:[
    {name:'Mensal',price:25,months:1,monthly_equivalent:25},
    {name:'Trimestral',price:65,months:3,monthly_equivalent:21.67},
    {name:'Semestral',price:120,months:6,monthly_equivalent:20},
    {name:'Anual',price:210,months:12,monthly_equivalent:17.5}
  ],
  compatibility:['Smart TV','TV Box','Android TV','Fire TV Stick','Chromecast','Roku','Android','iPhone','Notebook','PC','Projetor smart','iPad','Apple TV'],
  qualities:['SD','HD','Full HD','4K'],
  payments:['Pix','Cartão de crédito','Boleto bancário'],
  internet_recommendations:{HD_mbps:15,FullHD_mbps:25,'4K_mbps':45},
  free_trial:true,
  support:{activation_minutes:10,whatsapp_days_per_week:7,trial_hours:24},
  fetched_at:null
};

function money(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
function uniq(list){return [...new Set((list||[]).filter(Boolean))]}
function wa(text){return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`}

function wireWhatsApp(){
  document.querySelectorAll('[data-wa]').forEach(el=>{
    const device=el.dataset.device;
    let msg='Olá! Vim pelo site da JSTech Prime e gostaria de conhecer os planos disponíveis.';
    if(el.dataset.wa==='support') msg='Olá! Vim pelo site da JSTech Prime e preciso de orientação/suporte.';
    if(el.dataset.wa==='trial') msg=device
      ?`Olá! Vim pelo site da JSTech Prime e gostaria de solicitar um teste no aparelho: ${device}.`
      :'Olá! Vim pelo site da JSTech Prime e gostaria de solicitar um teste, se estiver disponível.';
    el.href=wa(msg); el.target='_blank'; el.rel='noopener noreferrer';
  });
}
wireWhatsApp();

document.querySelectorAll('.faq button').forEach(btn=>btn.addEventListener('click',()=>{
  const item=btn.closest('.faq');
  const wasOpen=item.classList.contains('open');
  document.querySelectorAll('.faq.open').forEach(x=>x.classList.remove('open'));
  if(!wasOpen)item.classList.add('open');
}));

function normalize(rows){
  if(!Array.isArray(rows)||!rows.length)return fallback;
  const valid=rows.filter(r=>r&&(r.plans||r.compatibility||r.qualities));
  if(!valid.length)return fallback;

  const pleno=valid.find(r=>r.source_key==='plenocs');
  const quest=valid.find(r=>r.source_key==='questbr');
  const primaryPlans=(pleno?.plans?.length?pleno.plans:quest?.plans)||fallback.plans;
  const plans=[...primaryPlans].sort((a,b)=>Number(a.months)-Number(b.months));
  const compatibility=uniq(valid.flatMap(r=>Array.isArray(r.compatibility)?r.compatibility:[]));
  const qualities=uniq(valid.flatMap(r=>Array.isArray(r.qualities)?r.qualities:[]));
  const payments=uniq(valid.flatMap(r=>Array.isArray(r.payments)?r.payments:[]));
  const internet=Object.assign({},fallback.internet_recommendations,...valid.map(r=>r.internet_recommendations||{}));
  const latest=[...valid].sort((a,b)=>new Date(a.fetched_at||0)-new Date(b.fetched_at||0)).at(-1);
  const support=Object.assign({},fallback.support,...valid.map(r=>r.support||{}));

  return{
    plans:plans.length?plans:fallback.plans,
    compatibility:compatibility.length?compatibility:fallback.compatibility,
    qualities:qualities.length?qualities:fallback.qualities,
    payments:payments.length?payments:fallback.payments,
    internet_recommendations:internet,
    free_trial:valid.some(r=>r.free_trial===true),
    support,
    fetched_at:latest?.fetched_at||null
  };
}

function renderPlans(data){
  const grid=document.getElementById('plansGrid'); if(!grid)return;
  const max=Math.max(...data.plans.map(p=>Number(p.months)||0));
  grid.innerHTML=data.plans.map(p=>{
    const months=Number(p.months)||1;
    const featured=months===max;
    const label=months===1?'Para começar':months===3?'Economia inicial':months===6?'Mais equilíbrio':'Melhor escolha';
    const eq=p.monthly_equivalent?`≈ R$ ${money(p.monthly_equivalent)} por mês`:`${months} mês(es)`;
    const msg=`Olá! Vim pelo site da JSTech Prime e tenho interesse no plano ${p.name} de R$ ${money(p.price)}.`;
    return `<article class="plan ${featured?'featured':''}">
      <small>${label}</small>
      <h3>${p.name}</h3>
      <div class="price"><span>R$</span><strong>${Math.floor(Number(p.price))}</strong><span>,${String(Math.round((Number(p.price)%1)*100)).padStart(2,'0')}</span></div>
      <div class="plan-eq">${eq}</div>
      <ul>
        <li>Qualidade ${data.qualities.slice(-3).join(' / ')}</li>
        <li>Compatível com diversos dispositivos</li>
        <li>Suporte pelo WhatsApp</li>
        ${data.free_trial?'<li>Teste quando disponível</li>':''}
      </ul>
      <a class="button ${featured?'button-solid':'button-outline'}" target="_blank" rel="noopener noreferrer" href="${wa(msg)}">Escolher plano →</a>
    </article>`;
  }).join('');
}

function deviceIcon(name){
  const n=String(name).toLowerCase();
  if(n.includes('tv')||n.includes('roku'))return'▣';
  if(n.includes('iphone')||n.includes('android')||n.includes('cel'))return'▯';
  if(n.includes('pc')||n.includes('note'))return'⌨';
  if(n.includes('box')||n.includes('fire')||n.includes('chromecast'))return'◫';
  if(n.includes('ipad')||n.includes('tablet'))return'▱';
  return'◇';
}

function renderDevices(data){
  const grid=document.getElementById('deviceGrid'); if(!grid)return;
  grid.innerHTML=(data.compatibility||[]).slice(0,16).map(n=>`<article class="device"><span class="ico">${deviceIcon(n)}</span><strong>${n}</strong><small>Compatibilidade depende do modelo, sistema e aplicativo utilizado.</small></article>`).join('');
}

function renderSpeeds(data){
  const grid=document.getElementById('speedGrid'); if(!grid)return;
  const s=data.internet_recommendations||{};
  grid.innerHTML=[['HD',s.HD_mbps||15],['Full HD',s.FullHD_mbps||25],['4K',s['4K_mbps']||45]].map(([q,v])=>`<div><small>${q}</small><strong>${v}</strong><span>Mbps</span></div>`).join('');
}

function renderMeta(data,remote){
  const sync=document.getElementById('syncStatus');
  if(sync)sync.textContent=remote?`${data.compatibility.length}+ aparelhos/dados atuais`:'Dados de segurança';
  const last=document.getElementById('lastSync');
  if(last){
    const d=data.fetched_at?new Date(data.fetched_at):null;
    last.textContent=d&&!Number.isNaN(d.getTime())?`Última sincronização: ${d.toLocaleString('pt-BR')}`:'Dados comerciais sincronizados.';
  }
}

async function loadCatalog(){
  let data=fallback,remote=false;
  try{
    const r=await fetch(API,{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const rows=await r.json();
    data=normalize(rows); remote=Array.isArray(rows)&&rows.length>0;
  }catch(err){console.warn('Catálogo remoto indisponível.',err)}
  renderPlans(data); renderDevices(data); renderSpeeds(data); renderMeta(data,remote);
}
loadCatalog();

const form=document.getElementById('leadForm');
if(form)form.addEventListener('submit',async e=>{
  e.preventDefault();
  const status=document.getElementById('formStatus');
  const btn=form.querySelector('button[type=submit]');
  const fd=new FormData(form);
  const payload={
    nome:String(fd.get('nome')||'').trim(),
    whatsapp:String(fd.get('whatsapp')||'').trim(),
    servico:String(fd.get('servico')||'').trim(),
    mensagem:String(fd.get('mensagem')||'').trim()
  };
  if(payload.nome.length<2||payload.whatsapp.length<8||!payload.servico){status.textContent='Revise os campos antes de enviar.';return}
  btn.disabled=true; btn.textContent='Enviando…'; status.textContent='';
  try{
    const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!r.ok)throw new Error('Falha no envio');
    status.textContent='Solicitação enviada com sucesso!'; form.reset();
  }catch(err){status.textContent='Não foi possível registrar agora. Use o WhatsApp.'}
  finally{btn.disabled=false;btn.textContent='Enviar solicitação →'}
});