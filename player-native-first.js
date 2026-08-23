/* IPTV PLAYER WEB 2026 - player único com destinos separados */
(function(){
'use strict';
let shakaPlayer=null,hlsPlayer=null,tsPlayer=null,token=0,currentVideo=null;
const $=id=>document.getElementById(id);

function ui(opts={}){
 return {
  video:$(opts.videoId||'videoPlayer'),
  status:$(opts.statusId||'playerStatus'),
  title:$(opts.titleId||'playerTitle'),
  placeholder:$(opts.placeholderId||'playerPlaceholder')
 };
}
function setStatus(node,text,type=''){if(!node)return;node.classList.remove('ok','error');if(type)node.classList.add(type);node.textContent=text;}
function setTitle(node,text){if(node)node.textContent=text||'Reproduzindo';}
async function destroyAll(){
 token++;
 try{if(shakaPlayer){await shakaPlayer.destroy();shakaPlayer=null;}}catch(_){}
 try{if(hlsPlayer){hlsPlayer.destroy();hlsPlayer=null;}}catch(_){}
 try{if(tsPlayer){tsPlayer.pause();tsPlayer.unload();tsPlayer.detachMediaElement();tsPlayer.destroy();tsPlayer=null;}}catch(_){}
 if(currentVideo){try{currentVideo.pause();currentVideo.removeAttribute('src');currentVideo.removeAttribute('crossorigin');currentVideo.load();}catch(_){} currentVideo=null;}
}
function loadScript(src,test){return new Promise((resolve,reject)=>{if(test())return resolve();const s=document.createElement('script');s.src=src;s.async=true;s.onload=()=>test()?resolve():reject(new Error('biblioteca não carregou'));s.onerror=reject;document.head.appendChild(s);});}
async function ensureShaka(){try{await loadScript('https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.16.12/shaka-player.compiled.min.js',()=>!!window.shaka);if(window.shaka&&shaka.polyfill)shaka.polyfill.installAll();return !!window.shaka;}catch(e){console.warn('Shaka indisponível',e);return false;}}
function mediaType(url){const clean=String(url||'').split('?')[0].toLowerCase();if(clean.endsWith('.m3u8'))return'hls';if(clean.endsWith('.ts'))return'ts';return'native';}

async function tryShaka(video,url,myToken,label,statusNode){
 if(!(await ensureShaka())||myToken!==token)return false;
 try{
  shakaPlayer=new shaka.Player();await shakaPlayer.attach(video);
  shakaPlayer.configure({streaming:{bufferingGoal:15,rebufferingGoal:2,bufferBehind:30,lowLatencyMode:false}});
  setStatus(statusNode,'Abrindo com Shaka Player...');await shakaPlayer.load(url);
  if(myToken!==token)return false;await video.play().catch(()=>{});
  if(video.readyState>=1){setStatus(statusNode,label+' carregado com Shaka.','ok');return true;}return false;
 }catch(e){console.warn('Shaka falhou',url,e);try{if(shakaPlayer){await shakaPlayer.destroy();shakaPlayer=null;}}catch(_){}return false;}
}
async function tryHls(video,url,myToken,label,statusNode){
 if(!(window.Hls&&Hls.isSupported()))return false;
 return new Promise(resolve=>{try{
  setStatus(statusNode,'Tentando HLS.js...');
  hlsPlayer=new Hls({enableWorker:true,lowLatencyMode:false,manifestLoadingTimeOut:7000,levelLoadingTimeOut:7000,fragLoadingTimeOut:9000,maxBufferLength:30});
  let done=false,timer;const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v);};
  hlsPlayer.on(Hls.Events.MANIFEST_PARSED,()=>{if(myToken!==token)return finish(false);video.play().catch(()=>{});setStatus(statusNode,label+' carregado em HLS.','ok');finish(true);});
  hlsPlayer.on(Hls.Events.ERROR,(_e,d)=>{if(d&&d.fatal){try{hlsPlayer.destroy();}catch(_){}hlsPlayer=null;finish(false);}});
  hlsPlayer.loadSource(url);hlsPlayer.attachMedia(video);timer=setTimeout(()=>finish(video.readyState>=1),9000);
 }catch(_){resolve(false);}});
}
async function tryTs(video,url,myToken,label,statusNode){
 if(!(window.mpegts&&mpegts.isSupported()))return false;
 return new Promise(resolve=>{try{
  setStatus(statusNode,'Tentando MPEG-TS...');
  tsPlayer=mpegts.createPlayer({type:'mpegts',isLive:true,url,cors:true},{enableWorker:true,enableStashBuffer:false,liveBufferLatencyChasing:true});
  let done=false,timer;const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v);};
  tsPlayer.on(mpegts.Events.ERROR,()=>finish(false));
  video.addEventListener('canplay',()=>{if(myToken!==token)return finish(false);video.play().catch(()=>{});setStatus(statusNode,label+' carregado em MPEG-TS.','ok');finish(true);},{once:true});
  tsPlayer.attachMediaElement(video);tsPlayer.load();tsPlayer.play().catch(()=>{});timer=setTimeout(()=>finish(video.readyState>=1),9000);
 }catch(_){resolve(false);}});
}
async function tryNative(video,url,myToken,label,statusNode){
 return new Promise(resolve=>{
  setStatus(statusNode,'Tentando reprodução nativa...');let done=false,timer;
  const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v);};
  const ready=()=>{if(myToken!==token)return finish(false);video.play().catch(()=>{});setStatus(statusNode,label+' carregado pelo navegador.','ok');finish(true);};
  video.addEventListener('canplay',ready,{once:true});video.addEventListener('loadedmetadata',ready,{once:true});video.addEventListener('error',()=>finish(false),{once:true});
  try{video.removeAttribute('crossorigin');video.src=url;video.load();video.play().catch(()=>{});}catch(_){return finish(false);}timer=setTimeout(()=>finish(video.readyState>=1),8000);
 });
}

async function playUrl(url,name,label='Conteúdo',opts={}){
 const target=ui(opts),video=target.video;if(!video||!url)return false;
 await destroyAll();const myToken=++token;currentVideo=video;
 if(target.placeholder)target.placeholder.style.display='none';setTitle(target.title,name);setStatus(target.status,'Preparando '+label.toLowerCase()+'...');
 const type=mediaType(url);let ok=false;
 if(type==='hls')ok=await tryShaka(video,url,myToken,label,target.status)||await tryHls(video,url,myToken,label,target.status)||await tryNative(video,url,myToken,label,target.status);
 else if(type==='ts')ok=await tryShaka(video,url,myToken,label,target.status)||await tryTs(video,url,myToken,label,target.status)||await tryNative(video,url,myToken,label,target.status);
 else ok=await tryNative(video,url,myToken,label,target.status)||await tryShaka(video,url,myToken,label,target.status);
 if(!ok)setStatus(target.status,label+' não pôde ser reproduzido neste navegador.','error');return ok;
}
function xtreamUrl(kind,session,id,ext){
 const base=String(session.server||'').replace(/\/+$/,'');const u=encodeURIComponent(session.username||''),p=encodeURIComponent(session.password||''),sid=encodeURIComponent(id||'');
 return `${base}/${kind}/${u}/${p}/${sid}.${String(ext||'mp4').replace(/^\./,'')}`;
}
window.playMediaUrl=playUrl;
window.playXtreamMedia=async function(kind,session,id,extension,name,opts={}){
 if(!session)return false;
 const route=kind==='movie'?'movie':kind==='series'?'series':'live';
 const ext=String(extension||(route==='live'?'ts':'mp4')).replace(/^\./,'').toLowerCase();
 const urls=[];const add=x=>{if(x&&!urls.includes(x))urls.push(x);};
 add(xtreamUrl(route,session,id,ext));
 if(route==='live'){if(ext!=='m3u8')add(xtreamUrl(route,session,id,'m3u8'));if(ext!=='ts')add(xtreamUrl(route,session,id,'ts'));}
 for(const url of urls){if(await playUrl(url,name,route==='live'?'Canal':route==='movie'?'Filme':'Episódio',opts))return true;}
 return false;
};
window.openLiveChannel=(session,id,ext,name)=>window.playXtreamMedia('live',session,id,ext,name,{videoId:'videoPlayer',statusId:'playerStatus',titleId:'playerTitle',placeholderId:'playerPlaceholder'});
window.showExternalFallback=()=>{};window.getPreferredPlayer=()=> 'web';window.setPreferredPlayer=()=>{};window.openInVlc=()=>{};window.downloadM3U=()=>{};window.copyStreamUrl=()=>{};
window.addEventListener('beforeunload',()=>{destroyAll();});
})();
