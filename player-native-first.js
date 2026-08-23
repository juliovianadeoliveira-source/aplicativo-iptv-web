/* IPTV PLAYER WEB 2026 - Shaka principal + HLS.js + MPEGTS + nativo */
(function(){
'use strict';
let shakaPlayer=null,hlsPlayer=null,tsPlayer=null,token=0;
const $=id=>document.getElementById(id);
function status(t,type=''){const e=$('playerStatus');if(!e)return;e.classList.remove('ok','error');if(type)e.classList.add(type);e.textContent=t;}
function title(t){const e=$('playerTitle');if(e)e.textContent=t||'Reproduzindo';}
async function destroy(video){
 token++;
 try{if(shakaPlayer){await shakaPlayer.destroy();shakaPlayer=null;}}catch(_){}
 try{if(hlsPlayer){hlsPlayer.destroy();hlsPlayer=null;}}catch(_){}
 try{if(tsPlayer){tsPlayer.pause();tsPlayer.unload();tsPlayer.detachMediaElement();tsPlayer.destroy();tsPlayer=null;}}catch(_){}
 try{video.pause();video.removeAttribute('src');video.removeAttribute('crossorigin');video.load();}catch(_){}
}
function loadScript(src,test){return new Promise((resolve,reject)=>{if(test())return resolve();const s=document.createElement('script');s.src=src;s.async=true;s.onload=()=>test()?resolve():reject(new Error('biblioteca não carregou'));s.onerror=reject;document.head.appendChild(s);});}
async function ensureShaka(){
 try{await loadScript('https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.16.12/shaka-player.compiled.min.js',()=>!!window.shaka);if(window.shaka&&shaka.polyfill)shaka.polyfill.installAll();return !!window.shaka;}catch(e){console.warn('Shaka indisponível',e);return false;}
}
function candidates(session,id,ext){
 const base=String(session.server||'').replace(/\/+$/,'');
 const u=encodeURIComponent(session.username||''),p=encodeURIComponent(session.password||''),sid=encodeURIComponent(id||'');
 const e=String(ext||'ts').replace(/^\./,'').toLowerCase();
 const root=`${base}/live/${u}/${p}/${sid}`;
 const out=[];const add=(url,type)=>{if(!out.some(x=>x.url===url))out.push({url,type});};
 add(`${root}.${e}`,e==='m3u8'?'hls':e==='ts'?'ts':'native');
 if(e!=='m3u8')add(`${root}.m3u8`,'hls');
 if(e!=='ts')add(`${root}.ts`,'ts');
 return out;
}
async function tryShaka(video,url,myToken){
 if(!(await ensureShaka())||myToken!==token)return false;
 try{
  if(shakaPlayer){await shakaPlayer.destroy();shakaPlayer=null;}
  shakaPlayer=new shaka.Player();
  await shakaPlayer.attach(video);
  shakaPlayer.configure({streaming:{bufferingGoal:12,rebufferingGoal:2,bufferBehind:20,lowLatencyMode:true}});
  status('Abrindo com Shaka Player...');
  await shakaPlayer.load(url);
  if(myToken!==token)return false;
  await video.play().catch(()=>{});
  if(video.readyState>=1){status('Canal carregado com Shaka.','ok');return true;}
  return false;
 }catch(e){console.warn('Shaka falhou',url,e);try{if(shakaPlayer){await shakaPlayer.destroy();shakaPlayer=null;}}catch(_){}return false;}
}
async function tryHls(video,url,myToken){
 if(!(window.Hls&&Hls.isSupported()))return false;
 return new Promise(resolve=>{
  try{
   status('Tentando HLS.js...');
   hlsPlayer=new Hls({enableWorker:true,lowLatencyMode:true,manifestLoadingTimeOut:7000,levelLoadingTimeOut:7000,fragLoadingTimeOut:9000,maxBufferLength:20});
   let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(tm);resolve(v);};
   hlsPlayer.on(Hls.Events.MANIFEST_PARSED,()=>{if(myToken!==token)return finish(false);video.play().catch(()=>{});status('Canal carregado em HLS.','ok');finish(true);});
   hlsPlayer.on(Hls.Events.ERROR,(_e,d)=>{if(d&&d.fatal){try{hlsPlayer.destroy();}catch(_){}hlsPlayer=null;finish(false);}});
   hlsPlayer.loadSource(url);hlsPlayer.attachMedia(video);
   const tm=setTimeout(()=>finish(video.readyState>=1),9000);
  }catch(_){resolve(false);}
 });
}
async function tryTs(video,url,myToken){
 if(!(window.mpegts&&mpegts.isSupported()))return false;
 return new Promise(resolve=>{
  try{
   status('Tentando MPEG-TS...');
   tsPlayer=mpegts.createPlayer({type:'mpegts',isLive:true,url,cors:true},{enableWorker:true,enableStashBuffer:false,liveBufferLatencyChasing:true});
   let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(tm);resolve(v);};
   tsPlayer.on(mpegts.Events.ERROR,()=>finish(false));
   video.addEventListener('canplay',()=>{if(myToken!==token)return finish(false);video.play().catch(()=>{});status('Canal carregado em MPEG-TS.','ok');finish(true);},{once:true});
   tsPlayer.attachMediaElement(video);tsPlayer.load();tsPlayer.play().catch(()=>{});
   const tm=setTimeout(()=>finish(video.readyState>=1),9000);
  }catch(_){resolve(false);}
 });
}
async function tryNative(video,url,myToken){
 return new Promise(resolve=>{
  status('Tentando reprodução nativa...');
  let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(tm);resolve(v);};
  const ready=()=>{if(myToken!==token)return finish(false);video.play().catch(()=>{});status('Canal carregado pelo navegador.','ok');finish(true);};
  const fail=()=>finish(false);
  video.addEventListener('canplay',ready,{once:true});video.addEventListener('loadedmetadata',ready,{once:true});video.addEventListener('error',fail,{once:true});
  try{video.removeAttribute('crossorigin');video.src=url;video.load();video.play().catch(()=>{});}catch(_){return finish(false);}
  const tm=setTimeout(()=>finish(video.readyState>=1),7000);
 });
}
window.showExternalFallback=function(){status('Não foi possível abrir este stream no navegador.','error');};
window.getPreferredPlayer=()=> 'web';window.setPreferredPlayer=()=>{};window.openInVlc=()=>{};window.downloadM3U=()=>{};window.copyStreamUrl=()=>{};
window.openLiveChannel=async function(session,streamId,extension,name){
 const video=$('videoPlayer');if(!video||!session)return;
 await destroy(video);const myToken=++token;
 const ph=$('playerPlaceholder');if(ph)ph.style.display='none';title(name);status('Preparando transmissão...');
 const list=candidates(session,streamId,extension);
 for(const c of list){
  if(myToken!==token)return;
  let ok=false;
  if(c.type==='hls') ok=await tryShaka(video,c.url,myToken) || await tryHls(video,c.url,myToken);
  else if(c.type==='ts') ok=await tryShaka(video,c.url,myToken) || await tryTs(video,c.url,myToken);
  else ok=await tryNative(video,c.url,myToken);
  if(ok)return;
  try{video.pause();video.removeAttribute('src');video.load();}catch(_){}
 }
 status('O stream foi recusado pelo navegador. Verifique HTTPS/CORS do servidor do canal.','error');
};
window.addEventListener('beforeunload',()=>{try{const v=$('videoPlayer');if(v)destroy(v);}catch(_){}});
})();
