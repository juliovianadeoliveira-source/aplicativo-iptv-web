/* IPTV PLAYER WEB 2026 - Shaka + HLS.js + MPEGTS + nativo */
(function(){
'use strict';
let shakaPlayer=null,hlsPlayer=null,tsPlayer=null,token=0;
const $=id=>document.getElementById(id);
function status(t,type=''){const e=$('playerStatus');if(!e)return;e.classList.remove('ok','error');if(type)e.classList.add(type);e.textContent=t;}
function setTitle(t){const e=$('playerTitle');if(e)e.textContent=t||'Reproduzindo';}
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
function mediaType(url){
 const clean=String(url||'').split('?')[0].toLowerCase();
 if(clean.endsWith('.m3u8'))return'hls';
 if(clean.endsWith('.ts'))return'ts';
 return'native';
}
async function tryShaka(video,url,myToken,label='Conteúdo'){
 if(!(await ensureShaka())||myToken!==token)return false;
 try{
  if(shakaPlayer){await shakaPlayer.destroy();shakaPlayer=null;}
  shakaPlayer=new shaka.Player();
  await shakaPlayer.attach(video);
  shakaPlayer.configure({streaming:{bufferingGoal:15,rebufferingGoal:2,bufferBehind:30,lowLatencyMode:false}});
  status('Abrindo com Shaka Player...');
  await shakaPlayer.load(url);
  if(myToken!==token)return false;
  await video.play().catch(()=>{});
  if(video.readyState>=1){status(label+' carregado com Shaka.','ok');return true;}
  return false;
 }catch(e){console.warn('Shaka falhou',url,e);try{if(shakaPlayer){await shakaPlayer.destroy();shakaPlayer=null;}}catch(_){}return false;}
}
async function tryHls(video,url,myToken,label='Conteúdo'){
 if(!(window.Hls&&Hls.isSupported()))return false;
 return new Promise(resolve=>{
  try{
   status('Tentando HLS.js...');
   hlsPlayer=new Hls({enableWorker:true,lowLatencyMode:false,manifestLoadingTimeOut:7000,levelLoadingTimeOut:7000,fragLoadingTimeOut:9000,maxBufferLength:30});
   let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(tm);resolve(v);};
   hlsPlayer.on(Hls.Events.MANIFEST_PARSED,()=>{if(myToken!==token)return finish(false);video.play().catch(()=>{});status(label+' carregado em HLS.','ok');finish(true);});
   hlsPlayer.on(Hls.Events.ERROR,(_e,d)=>{if(d&&d.fatal){try{hlsPlayer.destroy();}catch(_){}hlsPlayer=null;finish(false);}});
   hlsPlayer.loadSource(url);hlsPlayer.attachMedia(video);
   const tm=setTimeout(()=>finish(video.readyState>=1),9000);
  }catch(_){resolve(false);}
 });
}
async function tryTs(video,url,myToken,label='Conteúdo'){
 if(!(window.mpegts&&mpegts.isSupported()))return false;
 return new Promise(resolve=>{
  try{
   status('Tentando MPEG-TS...');
   tsPlayer=mpegts.createPlayer({type:'mpegts',isLive:true,url,cors:true},{enableWorker:true,enableStashBuffer:false,liveBufferLatencyChasing:true});
   let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(tm);resolve(v);};
   tsPlayer.on(mpegts.Events.ERROR,()=>finish(false));
   video.addEventListener('canplay',()=>{if(myToken!==token)return finish(false);video.play().catch(()=>{});status(label+' carregado em MPEG-TS.','ok');finish(true);},{once:true});
   tsPlayer.attachMediaElement(video);tsPlayer.load();tsPlayer.play().catch(()=>{});
   const tm=setTimeout(()=>finish(video.readyState>=1),9000);
  }catch(_){resolve(false);}
 });
}
async function tryNative(video,url,myToken,label='Conteúdo'){
 return new Promise(resolve=>{
  status('Tentando reprodução nativa...');
  let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(tm);resolve(v);};
  const ready=()=>{if(myToken!==token)return finish(false);video.play().catch(()=>{});status(label+' carregado pelo navegador.','ok');finish(true);};
  const fail=()=>finish(false);
  video.addEventListener('canplay',ready,{once:true});video.addEventListener('loadedmetadata',ready,{once:true});video.addEventListener('error',fail,{once:true});
  try{video.removeAttribute('crossorigin');video.src=url;video.load();video.play().catch(()=>{});}catch(_){return finish(false);}
  const tm=setTimeout(()=>finish(video.readyState>=1),8000);
 });
}
async function playUrl(url,name,label='Conteúdo'){
 const video=$('videoPlayer');if(!video||!url)return false;
 await destroy(video);const myToken=++token;
 const ph=$('playerPlaceholder');if(ph)ph.style.display='none';setTitle(name);status('Preparando '+label.toLowerCase()+'...');
 const type=mediaType(url);let ok=false;
 if(type==='hls')ok=await tryShaka(video,url,myToken,label)||await tryHls(video,url,myToken,label)||await tryNative(video,url,myToken,label);
 else if(type==='ts')ok=await tryShaka(video,url,myToken,label)||await tryTs(video,url,myToken,label)||await tryNative(video,url,myToken,label);
 else ok=await tryNative(video,url,myToken,label)||await tryShaka(video,url,myToken,label);
 if(!ok)status(label+' não pôde ser reproduzido neste navegador.','error');
 return ok;
}
window.playMediaUrl=playUrl;
window.showExternalFallback=function(){status('Não foi possível abrir este stream no navegador.','error');};
window.getPreferredPlayer=()=> 'web';window.setPreferredPlayer=()=>{};window.openInVlc=()=>{};window.downloadM3U=()=>{};window.copyStreamUrl=()=>{};
window.openLiveChannel=async function(session,streamId,extension,name){
 if(!session)return;
 const base=String(session.server||'').replace(/\/+$/,'');
 const u=encodeURIComponent(session.username||''),p=encodeURIComponent(session.password||''),sid=encodeURIComponent(streamId||'');
 const ext=String(extension||'ts').replace(/^\./,'').toLowerCase();
 const root=`${base}/live/${u}/${p}/${sid}`;
 const urls=[];const add=u=>{if(!urls.includes(u))urls.push(u);};
 add(`${root}.${ext}`);if(ext!=='m3u8')add(`${root}.m3u8`);if(ext!=='ts')add(`${root}.ts`);
 for(const url of urls){if(await playUrl(url,name,'Canal'))return;}
 status('O stream foi recusado pelo navegador. Verifique HTTPS/CORS do servidor do canal.','error');
};
window.addEventListener('beforeunload',()=>{try{const v=$('videoPlayer');if(v)destroy(v);}catch(_){}});
})();
