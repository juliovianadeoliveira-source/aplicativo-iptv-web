/* IPTV PLAYER WEB 2026 - Shaka + HLS.js + MPEGTS + server_info/direct_source */
(function(){
'use strict';
let shakaPlayer=null,hlsPlayer=null,tsPlayer=null,token=0,currentVideo=null;
const serverInfoCache=new Map();
const streamMetaCache=new Map();
const $=id=>document.getElementById(id);

function ui(opts={}){return{video:$(opts.videoId||'videoPlayer'),status:$(opts.statusId||'playerStatus'),title:$(opts.titleId||'playerTitle'),placeholder:$(opts.placeholderId||'playerPlaceholder')}}
function setStatus(node,text,type=''){if(!node)return;node.classList.remove('ok','error');if(type)node.classList.add(type);node.textContent=text}
function setTitle(node,text){if(node)node.textContent=text||'Reproduzindo'}
async function destroyAll(){
 token++;
 try{if(shakaPlayer){await shakaPlayer.destroy();shakaPlayer=null}}catch(_){}
 try{if(hlsPlayer){hlsPlayer.destroy();hlsPlayer=null}}catch(_){}
 try{if(tsPlayer){tsPlayer.pause();tsPlayer.unload();tsPlayer.detachMediaElement();tsPlayer.destroy();tsPlayer=null}}catch(_){}
 if(currentVideo){try{currentVideo.pause();currentVideo.removeAttribute('src');currentVideo.removeAttribute('crossorigin');currentVideo.load()}catch(_){}currentVideo=null}
}
function loadScript(src,test){return new Promise((resolve,reject)=>{if(test())return resolve();const s=document.createElement('script');s.src=src;s.async=true;s.onload=()=>test()?resolve():reject(new Error('biblioteca não carregou'));s.onerror=reject;document.head.appendChild(s)})}
async function ensureShaka(){try{await loadScript('https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.16.12/shaka-player.compiled.min.js',()=>!!window.shaka);if(window.shaka&&shaka.polyfill)shaka.polyfill.installAll();return !!window.shaka}catch(e){console.warn('Shaka indisponível',e);return false}}
function mediaType(url){const c=String(url||'').split('?')[0].toLowerCase();if(c.endsWith('.m3u8'))return'hls';if(c.endsWith('.ts'))return'ts';return'native'}

async function tryShaka(video,url,my,label,statusNode){if(!(await ensureShaka())||my!==token)return false;try{shakaPlayer=new shaka.Player();await shakaPlayer.attach(video);shakaPlayer.configure({streaming:{bufferingGoal:15,rebufferingGoal:2,bufferBehind:30,lowLatencyMode:false}});setStatus(statusNode,'Abrindo com Shaka Player...');await shakaPlayer.load(url);if(my!==token)return false;await video.play().catch(()=>{});if(video.readyState>=1){setStatus(statusNode,label+' carregado com Shaka.','ok');return true}}catch(e){console.warn('[SHAKA]',url,e);try{if(shakaPlayer){await shakaPlayer.destroy();shakaPlayer=null}}catch(_){}}return false}
async function tryHls(video,url,my,label,statusNode){if(!(window.Hls&&Hls.isSupported()))return false;return new Promise(resolve=>{try{setStatus(statusNode,'Tentando HLS.js...');hlsPlayer=new Hls({enableWorker:true,manifestLoadingTimeOut:6500,levelLoadingTimeOut:6500,fragLoadingTimeOut:8500,maxBufferLength:30});let done=false,timer;const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v)};hlsPlayer.on(Hls.Events.MANIFEST_PARSED,()=>{if(my!==token)return finish(false);video.play().catch(()=>{});setStatus(statusNode,label+' carregado em HLS.','ok');finish(true)});hlsPlayer.on(Hls.Events.ERROR,(_e,d)=>{if(d&&d.fatal){console.warn('[HLS]',url,d);try{hlsPlayer.destroy()}catch(_){}hlsPlayer=null;finish(false)}});hlsPlayer.loadSource(url);hlsPlayer.attachMedia(video);timer=setTimeout(()=>finish(video.readyState>=1),8500)}catch(e){console.warn('[HLS]',e);resolve(false)}})}
async function tryTs(video,url,my,label,statusNode){if(!(window.mpegts&&mpegts.isSupported()))return false;return new Promise(resolve=>{try{setStatus(statusNode,'Tentando MPEG-TS...');tsPlayer=mpegts.createPlayer({type:'mpegts',isLive:label==='Canal',url,cors:true},{enableWorker:true,enableStashBuffer:false,liveBufferLatencyChasing:true});let done=false,timer;const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v)};tsPlayer.on(mpegts.Events.ERROR,e=>{console.warn('[MPEGTS]',url,e);finish(false)});video.addEventListener('canplay',()=>{if(my!==token)return finish(false);video.play().catch(()=>{});setStatus(statusNode,label+' carregado em MPEG-TS.','ok');finish(true)},{once:true});tsPlayer.attachMediaElement(video);tsPlayer.load();tsPlayer.play().catch(()=>{});timer=setTimeout(()=>finish(video.readyState>=1),8500)}catch(e){console.warn('[MPEGTS]',e);resolve(false)}})}
async function tryNative(video,url,my,label,statusNode){return new Promise(resolve=>{setStatus(statusNode,'Tentando reprodução nativa...');let done=false,timer;const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v)};const ready=()=>{if(my!==token)return finish(false);video.play().catch(()=>{});setStatus(statusNode,label+' carregado pelo navegador.','ok');finish(true)};video.addEventListener('canplay',ready,{once:true});video.addEventListener('loadedmetadata',ready,{once:true});video.addEventListener('error',()=>finish(false),{once:true});try{video.removeAttribute('crossorigin');video.src=url;video.load();video.play().catch(()=>{})}catch(_){return finish(false)}timer=setTimeout(()=>finish(video.readyState>=1),7500)})}
async function playUrl(url,name,label='Conteúdo',opts={}){const target=ui(opts),video=target.video;if(!video||!url)return false;await destroyAll();const my=++token;currentVideo=video;if(target.placeholder)target.placeholder.style.display='none';setTitle(target.title,name);setStatus(target.status,'Preparando '+label.toLowerCase()+'...');const type=mediaType(url);let ok=false;if(type==='hls')ok=await tryShaka(video,url,my,label,target.status)||await tryHls(video,url,my,label,target.status)||await tryNative(video,url,my,label,target.status);else if(type==='ts')ok=await tryShaka(video,url,my,label,target.status)||await tryTs(video,url,my,label,target.status)||await tryNative(video,url,my,label,target.status);else ok=await tryNative(video,url,my,label,target.status)||await tryShaka(video,url,my,label,target.status);return ok}

function hostFrom(v){if(!v)return'';try{return new URL(/^https?:\/\//i.test(v)?v:'https://'+v).hostname}catch(_){return String(v).replace(/^https?:\/\//i,'').split('/')[0].split(':')[0]}}
function addUnique(list,v){if(!v)return;v=String(v).replace(/\/+$/,'');if(v&&!list.includes(v))list.push(v)}
function apiUrl(session,action){const base=String(session.server||'').replace(/\/+$/,'')+'/';const u=new URL('player_api.php',base);u.searchParams.set('username',session.username||'');u.searchParams.set('password',session.password||'');if(action)u.searchParams.set('action',action);return u.toString()}
async function apiGet(session,action){const r=await fetch(apiUrl(session,action),{cache:'no-store',mode:'cors',credentials:'omit'});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
function persistServerInfo(session,info){try{session.serverInfo=info||{};const keys=['iptvSession'];for(const k of keys){if(localStorage.getItem(k))localStorage.setItem(k,JSON.stringify(session));if(sessionStorage.getItem(k))sessionStorage.setItem(k,JSON.stringify(session))}}catch(_){}}
async function getServerInfo(session){const key=[session.server,session.username].join('|');if(session.serverInfo&&Object.keys(session.serverInfo).length){serverInfoCache.set(key,session.serverInfo);return session.serverInfo}if(serverInfoCache.has(key))return serverInfoCache.get(key);let info={};try{const data=await apiGet(session,'');info=(data&&data.server_info)||{};persistServerInfo(session,info)}catch(e){console.warn('[SERVER_INFO]',e)}serverInfoCache.set(key,info);return info}
async function streamBases(session){const info=await getServerInfo(session),out=[];const sessionBase=String(session.server||'').replace(/\/+$/,'');const host=hostFrom(info.url||sessionBase);const httpsPort=String(info.https_port||'').trim();const port=String(info.port||'').trim();
 if(host&&httpsPort&&httpsPort!=='0')addUnique(out,`https://${host}${httpsPort==='443'?'':':'+httpsPort}`);
 if(/^https:\/\//i.test(sessionBase))addUnique(out,sessionBase);
 if(host)addUnique(out,`https://${host}`);
 if(location.protocol!=='https:'){if(host&&port&&port!=='0')addUnique(out,`http://${host}${port==='80'?'':':'+port}`);if(/^http:\/\//i.test(sessionBase))addUnique(out,sessionBase)}
 console.log('[IPTV BASES]',out,'server_info=',info);return out}
function xtreamUrl(base,kind,session,id,ext){const u=encodeURIComponent(session.username||''),p=encodeURIComponent(session.password||''),sid=encodeURIComponent(id||'');return `${String(base).replace(/\/+$/,'')}/${kind}/${u}/${p}/${sid}.${String(ext||'mp4').replace(/^\./,'')}`}
async function streamMetadata(kind,session,id){const route=kind==='live'?'get_live_streams':kind==='movie'?'get_vod_streams':null;if(!route)return null;const key=[session.server,session.username,route].join('|');let items=streamMetaCache.get(key);if(!items){try{items=await apiGet(session,route);if(!Array.isArray(items))items=[]}catch(e){console.warn('[META]',route,e);items=[]}streamMetaCache.set(key,items)}return items.find(x=>String(kind==='live'?x.stream_id:x.stream_id)===String(id))||null}
function usableDirectSource(source){if(!source)return'';source=String(source).trim();if(!/^https?:\/\//i.test(source))return'';if(location.protocol==='https:'&&/^http:\/\//i.test(source))return'';return source}

window.playMediaUrl=playUrl;
window.playXtreamMedia=async function(kind,session,id,extension,name,opts={},directSource=''){
 if(!session)return false;const target=ui(opts),route=kind==='movie'?'movie':kind==='series'?'series':'live',ext=String(extension||(route==='live'?'ts':'mp4')).replace(/^\./,'').toLowerCase(),urls=[];const add=x=>{if(x&&!urls.includes(x))urls.push(x)};
 add(usableDirectSource(directSource));
 if(route!=='series'){const meta=await streamMetadata(route,session,id);add(usableDirectSource(meta&&meta.direct_source))}
 const bases=await streamBases(session);for(const base of bases){add(xtreamUrl(base,route,session,id,ext));if(route==='live'){if(ext!=='m3u8')add(xtreamUrl(base,route,session,id,'m3u8'));if(ext!=='ts')add(xtreamUrl(base,route,session,id,'ts'))}}
 if(!urls.length){setStatus(target.status,'O servidor não informou uma rota HTTPS para reprodução.','error');return false}
 for(const url of urls){console.log('[IPTV PLAY]',route,url);if(await playUrl(url,name,route==='live'?'Canal':route==='movie'?'Filme':'Episódio',opts))return true}
 setStatus(target.status,(route==='live'?'Canal':route==='movie'?'Filme':'Episódio')+' não pôde ser reproduzido. As rotas HTTPS disponíveis foram recusadas pelo servidor.','error');return false
};
window.openLiveChannel=(session,id,ext,name)=>window.playXtreamMedia('live',session,id,ext,name,{videoId:'videoPlayer',statusId:'playerStatus',titleId:'playerTitle',placeholderId:'playerPlaceholder'});
window.showExternalFallback=()=>{};window.getPreferredPlayer=()=> 'web';window.setPreferredPlayer=()=>{};window.openInVlc=()=>{};window.downloadM3U=()=>{};window.copyStreamUrl=()=>{};
window.addEventListener('beforeunload',()=>destroyAll());
})();
