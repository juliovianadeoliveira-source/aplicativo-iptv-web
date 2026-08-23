/* PLAYER DIRETO PRIMEIRO
   - Se GitHub Pages (HTTPS) + stream HTTP: abre DIRETO em nova aba no mesmo clique.
   - Se stream HTTPS: tenta <video> nativo, depois HLS/MPEG-TS.
   - Mantem opcoes externas escolhidas nas configuracoes.
*/
(function(){
  const enhancedOpen = window.openLiveChannel;

  function directCandidates(session, streamId, extension){
    const base = String(session.server || "").replace(/\/+$/, "");
    const user = encodeURIComponent(session.username || "");
    const pass = encodeURIComponent(session.password || "");
    const id = encodeURIComponent(streamId || "");
    const ext = String(extension || "ts").replace(/^\./, "").toLowerCase();
    const path = `${user}/${pass}/${id}`;
    const list = [];
    const add = u => { if (u && !list.includes(u)) list.push(u); };

    /* Primeiro sempre a URL exata que corresponde ao servidor salvo + extensao da API. */
    add(`${base}/live/${path}.${ext}`);
    if (ext !== "m3u8") add(`${base}/live/${path}.m3u8`);
    if (ext !== "ts") add(`${base}/live/${path}.ts`);

    /* Alternativa de protocolo, sem substituir a URL original. */
    if (/^https:\/\//i.test(base)) {
      const b = base.replace(/^https:\/\//i, "http://");
      add(`${b}/live/${path}.${ext}`);
      if (ext !== "m3u8") add(`${b}/live/${path}.m3u8`);
      if (ext !== "ts") add(`${b}/live/${path}.ts`);
    } else if (/^http:\/\//i.test(base)) {
      const b = base.replace(/^http:\/\//i, "https://");
      add(`${b}/live/${path}.${ext}`);
      if (ext !== "m3u8") add(`${b}/live/${path}.m3u8`);
      if (ext !== "ts") add(`${b}/live/${path}.ts`);
    }

    return list;
  }

  function cleanupVideo(video){
    try {
      video.pause();
      video.removeAttribute("src");
      video.removeAttribute("crossorigin");
      video.load();
    } catch (_) {}
  }

  function setDirectStatus(text, type){
    if (typeof setPlayerStatus === "function") setPlayerStatus(text, type || "");
  }

  function openTopLevel(url){
    if (!url) return false;
    try {
      const win = window.open(url, "_blank");
      if (win) return true;
    } catch (_) {}
    try {
      window.location.href = url;
      return true;
    } catch (_) {}
    return false;
  }

  function tryNative(video, urls, index, title, done){
    /* Nunca tenta embutir HTTP dentro da pagina HTTPS. */
    while (index < urls.length && window.location.protocol === "https:" && /^http:\/\//i.test(urls[index])) index++;
    if (index >= urls.length) return done(false);

    const url = urls[index];
    let finished = false;
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", ready);
      video.removeEventListener("canplay", ready);
      video.removeEventListener("playing", ready);
      video.removeEventListener("error", fail);
      video.removeEventListener("abort", fail);
    };

    const success = () => {
      if (finished) return;
      finished = true;
      cleanup();
      setDirectStatus("Canal aberto diretamente no player do navegador.", "ok");
      video.play().catch(() => setDirectStatus("Canal carregado. Clique no ▶ do video.", "ok"));
      done(true);
    };

    const fail = () => {
      if (finished) return;
      finished = true;
      cleanup();
      cleanupVideo(video);
      tryNative(video, urls, index + 1, title, done);
    };

    const ready = () => { if (video.readyState >= 1) success(); };

    if (typeof setText === "function") setText("playerTitle", title || "Reproduzindo");
    setDirectStatus("Tentando reproduzir diretamente...", "");

    try {
      video.removeAttribute("crossorigin");
      video.src = url;
      video.load();
      video.play().catch(() => {});
    } catch (_) { fail(); return; }

    video.addEventListener("loadedmetadata", ready);
    video.addEventListener("canplay", ready);
    video.addEventListener("playing", ready);
    video.addEventListener("error", fail);
    video.addEventListener("abort", fail);

    timer = setTimeout(() => {
      if (video.readyState >= 1) success(); else fail();
    }, 7000);
  }

  function showDirectButton(title, urls){
    const status = document.getElementById("playerStatus");
    if (!status) return;
    const original = urls[0] || "";
    const hls = urls.find(u => /\.m3u8(?:$|\?)/i.test(u)) || "";
    const ts = urls.find(u => /\.ts(?:$|\?)/i.test(u)) || "";

    status.classList.remove("ok");
    status.classList.add("error");
    status.innerHTML = `<div style="margin-bottom:9px">Este canal nao pode ser embutido no GitHub Pages. Use a abertura direta abaixo, que equivale a colar o link no navegador.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="directMain" type="button" style="padding:10px 15px;border:0;border-radius:9px;background:#ff6a00;color:#fff;font-weight:800;cursor:pointer">▶ ABRIR CANAL DIRETO</button>
        ${hls ? '<button id="directHls" type="button" style="padding:9px 12px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:#27100b;color:#fff;cursor:pointer">Abrir HLS</button>' : ''}
        ${ts ? '<button id="directTs" type="button" style="padding:9px 12px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:#27100b;color:#fff;cursor:pointer">Abrir TS</button>' : ''}
      </div>`;

    document.getElementById("directMain")?.addEventListener("click", () => openTopLevel(original));
    document.getElementById("directHls")?.addEventListener("click", () => openTopLevel(hls));
    document.getElementById("directTs")?.addEventListener("click", () => openTopLevel(ts));
  }

  window.openLiveChannel = function(session, streamId, extension, title){
    const pref = (typeof getPreferredPlayer === "function") ? getPreferredPlayer() : "web";
    if (pref && pref !== "web") return enhancedOpen(session, streamId, extension, title);

    const urls = directCandidates(session, streamId, extension);
    const original = urls[0] || "";
    const video = document.getElementById("videoPlayer");
    const placeholder = document.getElementById("playerPlaceholder");

    if (typeof setText === "function") setText("playerTitle", title || "Reproduzindo");
    if (placeholder) placeholder.style.display = "none";

    /* PONTO PRINCIPAL:
       GitHub Pages HTTPS + canal HTTP = nao tenta embed.
       Abre a URL diretamente no mesmo clique do usuario, evitando Mixed Content embutido.
    */
    if (window.location.protocol === "https:" && /^http:\/\//i.test(original)) {
      setDirectStatus("Abrindo canal diretamente no navegador...", "ok");
      const opened = openTopLevel(original);
      if (!opened) showDirectButton(title, urls);
      return;
    }

    if (!video || !session) {
      showDirectButton(title, urls);
      return;
    }

    try {
      if (typeof destroyEnhancedPlayers === "function") destroyEnhancedPlayers();
      cleanupVideo(video);
    } catch (_) {}

    tryNative(video, urls, 0, title, ok => {
      if (ok) return;

      /* Para HTTPS, ainda tenta HLS.js/MPEG-TS do player aprimorado. */
      let resolved = false;
      const status = document.getElementById("playerStatus");
      const observer = status ? new MutationObserver(() => {
        const text = status.textContent || "";
        if (/nao abriu|não abriu|VLC|rota HTTPS|bloque/i.test(text)) {
          observer.disconnect();
          if (!resolved) {
            resolved = true;
            showDirectButton(title, urls);
          }
        }
      }) : null;

      if (observer && status) observer.observe(status, { childList:true, subtree:true, characterData:true });

      try { enhancedOpen(session, streamId, extension, title); }
      catch (_) {
        if (observer) observer.disconnect();
        showDirectButton(title, urls);
        return;
      }

      setTimeout(() => {
        if (resolved) return;
        const v = document.getElementById("videoPlayer");
        if (v && v.readyState >= 2 && !v.error) return;
        if (observer) observer.disconnect();
        resolved = true;
        showDirectButton(title, urls);
      }, 15000);
    });
  };
})();
