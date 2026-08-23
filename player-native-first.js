/* IPTV PLAYER WEB 2026 - player único com destinos separados + server_info Xtream */
(function(){
'use strict';
let shakaPlayer=null,hlsPlayer=null,tsPlayer=null,token=0,currentVideo=null;
let serverInfoCache=new Map();
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
 return ok;
}

function hostFrom(value){
 if(!value)return'';
 try{return new URL(/^https?:\/\//i.test(value)?value:'https://'+value).hostname;}catch(_){return String(value).replace(/^https?:\/\//i,'').split('/')[0].split(':')[0];}
}
function addBase(list,value){if(!value)return;value=String(value).replace(/\/+$/,'');if(value&&!list.includes(value))list.push(value);}
async function getServerInfo(session){
 const key=[session.server,session.username].join('|');
 if(serverInfoCache.has(key))return serverInfoCache.get(key);
 let info={};
 try{
  if(typeof window.xtreamRequest==='function'){
   const data=await window.xtreamRequest(session,'');info=(data&&data.server_info)||{};
  }else if(typeof xtreamRequest==='function'){
   const data=await xtreamRequest(session,'');info=(data&&data.server_info)||{};
  }
 }catch(e){console.warn('server_info indisponível',e);}
 serverInfoCache.set(key,info);return info;
}
async function streamBases(session){
 const info=await getServerInfo(session),out=[];
 const sessionBase=String(session.server||'').replace(/\/+$/,'');
 const host=hostFrom(info.url||sessionBase);
 const httpsPort=String(info.https_port||'').trim();
 const port=String(info.port||'').trim();
 const proto=String(info.server_protocol||'').replace(':','').toLowerCase();

 // Em GitHub Pages, HTTPS é prioridade absoluta.
 if(host&&httpsPort&&httpsPort!=='0')addBase(out,`https://${host}${httpsPort==='443'?'':':'+httpsPort}`);
 if(/^https:\/\//i.test(sessionBase))addBase(out,sessionBase);
 if(host)addBase(out,`https://${host}`);

 // Mantém HTTP no fim para ambientes que não estejam sob HTTPS.
 if(location.protocol!=='https:'){
  if(host&&port&&port!=='0')addBase(out,`http://${host}${port==='80'?'':':'+port}`);
  if(/^http:\/\//i.test(sessionBase))addBase(out,sessionBase);
  if(host&&proto==='http')addBase(out,`http://${host}`);
 }
 return out;
}
function xtreamUrl(base,kind,session,id,ext){
 const u=encodeURIComponent(session.username||''),p=encodeURIComponent(session.password||''),sid=encodeURIComponent(id||'');
 return `${String(base).replace(/\/+$/,'')}/${kind}/${u}/${p}/${sid}.${String(ext||'mp4').replace(/^\./,'')}`;
}

window.playMediaUrl=playUrl;
window.playXtreamMedia=async function(kind,session,id,extension,name,opts={}){
 if(!session)return false;
 const target=ui(opts);
 const route=kind==='movie'?'movie':kind==='series'?'series':'live';
 const ext=String(extension||(route==='live'?'ts':'mp4')).replace(/^\./,'').toLowerCase();
 const bases=await streamBases(session);
 const urls=[];const add=x=>{if(x&&!urls.includes(x))urls.push(x);};

 for(const base of bases){
  add(xtreamUrl(base,route,session,id,ext));
  if(route==='live'){
   if(ext!=='m3u8')add(xtreamUrl(base,route,session,id,'m3u8'));
   if(ext!=='ts')add(xtreamUrl(base,route,session,id,'ts'));
  }
 }

 if(!urls.length){setStatus(target.status,'O servidor não informou uma rota HTTPS para reprodução.','error');return false;}
 for(const url of urls){
  console.log('[IPTV PLAY]',route,url);
  if(await playUrl(url,name,route==='live'?'Canal':route==='movie'?'Filme':'Episódio',opts))return true;
 }
 setStatus(target.status,(route==='live'?'Canal':route==='movie'?'Filme':'Episódio')+' não pôde ser reproduzido. O servidor recusou as rotas HTTPS disponíveis.','error');
 return false;
};
window.openLiveChannel=(session,id,ext,name)=>window.playXtreamMedia('live',session,id,ext,name,{videoId:'videoPlayer',statusId:'playerStatus',titleId:'playerTitle',placeholderId:'playerPlaceholder'});
window.showExternalFallback=()=>{};window.getPreferredPlayer=()=> 'web';window.setPreferredPlayer=()=>{};window.openInVlc=()=>{};window.downloadM3U=()=>{};window.copyStreamUrl=()=>{};
window.addEventListener('beforeunload',()=>{destroyAll();});
})();
