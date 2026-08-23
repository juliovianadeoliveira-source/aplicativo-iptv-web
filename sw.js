const CACHE='iptv-player-v3';
const STATIC=['./favicon.svg','./manifest.webmanifest','./offline.html'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(STATIC)).catch(()=>{})
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;

  const url=new URL(event.request.url);
  const isAppCode = url.origin===self.location.origin && /\.(?:html|js|css)$/i.test(url.pathname);

  if(isAppCode){
    event.respondWith(
      fetch(new Request(event.request,{cache:'no-store'}))
        .catch(()=>caches.match(event.request))
        .then(response=>response||caches.match('./offline.html'))
    );
    return;
  }

  event.respondWith(
    fetch(event.request).catch(()=>caches.match(event.request).then(r=>r||caches.match('./offline.html')))
  );
});
