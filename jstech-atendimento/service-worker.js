const CACHE="jstech-atendimento-v13-current-only";
const CORE=[
  "./",
  "./index.html",
  "./styles.css",
  "./crm.css",
  "./sync-sources.css",
  "./app.js",
  "./crm.js",
  "./sync-sources.js",
  "./resellers.js",
  "./external-clients.js",
  "./manifest.webmanifest",
  "./app-icon.svg"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>k===CACHE?Promise.resolve(false):caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  if(req.mode==="navigate"){
    event.respondWith(
      fetch(req)
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE).then(cache=>cache.put("./index.html",copy)).catch(()=>{});
          return res;
        })
        .catch(()=>caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then(res=>{
        if(res.ok){
          const copy=res.clone();
          caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
        }
        return res;
      })
      .catch(async()=>{
        return (await caches.match(req,{ignoreSearch:true})) || Response.error();
      })
  );
});
