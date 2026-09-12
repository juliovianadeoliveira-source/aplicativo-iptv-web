const API='https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-prime-public-api';
const WHATSAPP='5527997314781';
const fallback={plans:[{name:'Mensal',price:25,months:1,monthly_equivalent:25},{name:'Trimestral',price:65,months:3,monthly_equivalent:21.67},{name:'Semestral',price:120,months:6,monthly_equivalent:20},{name:'Anual',price:210,months:12,monthly_equivalent:17.5}],compatibility:['Smart TV','TV Box','Android TV','Fire TV Stick','Chromecast','Roku','Android','iPhone','Notebook','PC','Projetor smart','iPad','Apple TV'],qualities:['SD','HD','Full HD','4K'],payments:['Pix','Cartão de crédito','Boleto bancário'],internet_recommendations:{HD_mbps:15,FullHD_mbps:25,'4K_mbps':45},free_trial:true,support:{trial_hours:24,activation_minutes:10,whatsapp_days_per_week:7},sources:['fallback'],fetched_at:null};
function wa(msg){return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`}
const msgs={general:'Olá! Vim pelo site da JSTech Prime e gostaria de conhecer os planos e serviços disponíveis.',support:'Olá! Vim pelo site da JSTech Prime e preciso de suporte/orientação.',trial:'Olá! Vim pelo site da JSTech Prime e gostaria de solicitar um teste, se estiver disponível.'};
function bindWhatsApp(){document.querySelectorAll('[data-wa]').forEach(el=>{el.href=wa(msgs[el.dataset.wa]||msgs.general);el.target='_blank';el.rel='noopener noreferrer'})}bindWhatsApp();
const slides=[...document.querySelectorAll('.hero-bg')],dots=[...document.querySelectorAll('.dots button')];let current=0;function showSlide(i){if(!slides.length)return;current=(i+slides.length)%slides.length;slides.forEach((s,x)=>s.classList.toggle('active',x===current));dots.forEach((d,x)=>d.classList.toggle('active',x===current))}dots.forEach((d,i)=>d.addEventListener('click',()=>showSlide(i)));if(slides.length)setInterval(()=>showSlide(current+1),5000);
document.querySelectorAll('.faq button').forEach(btn=>btn.addEventListener('click',()=>{const item=btn.closest('.faq'),open=item.classList.contains('open');document.querySelectorAll('.faq.open').forEach(x=>x.classList.remove('open'));if(!open)item.classList.add('open')}));
function money(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}function uniq(a){return [...new Set(a.filter(Boolean))]}
function normalize(rows){
  if(!Array.isArray(rows)||!rows.length)return fallback;
  const valid=rows.filter(r=>r&&(r.plans||r.compatibility||r.qualities));if(!valid.length)return fallback;
  const pleno=valid.find(r=>r.source_key==='plenocs')||{};
  const quest=valid.find(r=>r.source_key==='questbr')||{};
  const allPlans=[...(quest.plans||[]),...(pleno.plans||[])];
  const planMap=new Map();
  allPlans.forEach(p=>{if(p&&p.months&&!planMap.has(Number(p.months)))planMap.set(Number(p.months),p)});
  (pleno.plans||[]).forEach(p=>{if(p&&p.months)planMap.set(Number(p.months),p)});
  const union=k=>uniq(valid.flatMap(r=>Array.isArray(r[k])?r[k]:[]));
  const plans=[...planMap.values()].sort((a,b)=>Number(a.months)-Number(b.months));
  const fetched=valid.map(r=>r.fetched_at).filter(Boolean).sort().at(-1)||null;
  return{
    plans:plans.length?plans:fallback.plans,
    compatibility:union('compatibility').length?union('compatibility'):fallback.compatibility,
    qualities:union('qualities').length?union('qualities'):fallback.qualities,
    payments:union('payments').length?union('payments'):fallback.payments,
    internet_recommendations:Object.assign({},fallback.internet_recommendations,quest.internet_recommendations||{},pleno.internet_recommendations||{}),
    free_trial:valid.some(r=>r.free_trial===true),
    support:Object.assign({},fallback.support,quest.support||{},pleno.support||{}),
    sources:valid.map(r=>r.source_key).filter(Boolean),fetched_at:fetched
  };
}
function renderPlans(data){const grid=document.getElementById('plansGrid'),max=Math.max(...data.plans.map(p=>Number(p.months)||0));grid.innerHTML=data.plans.map(p=>{const featured=Number(p.months)===max,eq=p.monthly_equivalent?`≈ R$ ${money(p.monthly_equivalent)} por mês`:`${p.months||1} mês(es)`,label=p.months===1?'Para começar':p.months===3?'Economia inicial':p.months===6?'Equilíbrio':'Melhor custo-benefício',msg=`Olá! Vim pelo site da JSTech Prime e tenho interesse no plano ${p.name} de R$ ${money(p.price)}.`;return `<article class="plan ${featured?'featured':''}"><small>${label}</small><h3>${p.name}</h3><div class="price"><span>R$</span><strong>${Math.floor(Number(p.price))}</strong><span>,${String(Math.round((Number(p.price)%1)*100)).padStart(2,'0')}</span></div><div class="plan-eq">${eq}</div><ul><li>Qualidade conforme disponibilidade</li><li>Compatível com vários dispositivos</li><li>Suporte pelo WhatsApp</li>${data.free_trial?'<li>Teste antes de contratar quando disponível</li>':''}</ul><a class="btn ${featured?'primary':'ghost'}" target="_blank" rel="noopener noreferrer" href="${wa(msg)}">Escolher plano →</a></article>`}).join('')}
function ico(name){const n=String(name).toLowerCase();if(n.includes('tv')||n.includes('roku'))return'▣';if(n.includes('iphone')||n.includes('android')||n.includes('cel'))return'▯';if(n.includes('pc')||n.includes('note'))return'⌨';if(n.includes('box')||n.includes('fire')||n.includes('chromecast'))return'◫';if(n.includes('ipad')||n.includes('tablet'))return'▱';return'◇'}
function renderDevices(data){const el=document.getElementById('deviceGrid');if(!el)return;el.innerHTML=(data.compatibility||[]).slice(0,16).map(n=>`<article class="device"><span class="ico">${ico(n)}</span><strong>${n}</strong><small>Compatibilidade conforme modelo, sistema e aplicativo utilizado.</small></article>`).join('')}
function renderSpeeds(data){const el=document.getElementById('speedGrid');if(!el)return;const s=data.internet_recommendations||{};el.innerHTML=[['HD',s.HD_mbps||15],['Full HD',s.FullHD_mbps||25],['4K',s['4K_mbps']||45]].map(([q,v])=>`<div><small>${q}</small><strong>${v}</strong><span>Mbps</span></div>`).join('')}
function renderPayments(data){const el=document.getElementById('paymentGrid');if(!el)return;const labels={'Pix':['◇','rápido e simples'],'Cartão de crédito':['▣','quando disponível'],'Boleto bancário':['◈','quando disponível']};el.innerHTML=(data.payments||fallback.payments).map(p=>{const [i,s]=labels[p]||['◇','conforme disponibilidade'];return `<article><b>${i}</b><strong>${p}</strong><small>${s}</small></article>`}).join('')}
function renderMeta(data,remote){
  const sync=document.getElementById('syncStatus');if(sync)sync.textContent=remote?'catálogo atualizado':'dados de segurança';
  const q=document.getElementById('qualityChips');if(q)q.innerHTML=(data.qualities||fallback.qualities).map(x=>`<span>${x}</span>`).join('');
  const trialHours=Number(data.support?.trial_hours||24);const heroTrial=document.getElementById('heroTrial');if(heroTrial)heroTrial.textContent=`até ${trialHours}h`;
  const trialFaq=document.getElementById('trialFaq');if(trialFaq)trialFaq.textContent=data.free_trial?`Quando disponível, o teste pode durar até ${trialHours} horas, conforme o aparelho e a modalidade de streaming autorizada.`:'O teste está sujeito à disponibilidade atual.';
  const payFaq=document.getElementById('paymentsFaq');if(payFaq)payFaq.textContent=`Formas atuais: ${(data.payments||fallback.payments).join(', ')}.`;
  const d=data.fetched_at?new Date(data.fetched_at):null;const last=document.getElementById('lastSync');if(last)last.textContent=d&&!Number.isNaN(d.getTime())?`Dados atualizados em ${d.toLocaleString('pt-BR')}`:'Dados comerciais com atualização automática.';
}
async function loadCatalog(){let data=fallback,remote=false;try{const r=await fetch(API);if(!r.ok)throw new Error(`HTTP ${r.status}`);const rows=await r.json();data=normalize(rows);remote=Array.isArray(rows)&&rows.length>0}catch(e){console.warn('Catálogo remoto indisponível.',e)}renderPlans(data);renderDevices(data);renderSpeeds(data);renderPayments(data);renderMeta(data,remote);bindWhatsApp()}loadCatalog();
const form=document.getElementById('leadForm');if(form)form.addEventListener('submit',async e=>{e.preventDefault();const status=document.getElementById('formStatus'),btn=form.querySelector('button[type=submit]'),fd=new FormData(form),payload={nome:String(fd.get('nome')||'').trim(),whatsapp:String(fd.get('whatsapp')||'').trim(),servico:String(fd.get('servico')||'').trim(),mensagem:String(fd.get('mensagem')||'').trim()};if(payload.nome.length<2||payload.whatsapp.length<8||!payload.servico){status.textContent='Revise os campos antes de enviar.';return}btn.disabled=true;btn.textContent='Enviando…';status.textContent='';try{const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)throw new Error();status.textContent='Solicitação enviada com sucesso!';form.reset()}catch(err){status.textContent='Não foi possível registrar agora. Use o WhatsApp.'}finally{btn.disabled=false;btn.textContent='Enviar solicitação →'}});