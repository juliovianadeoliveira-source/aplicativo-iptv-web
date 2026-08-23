/* PLAYER DIRETO PRIMEIRO
   1) tenta <video> nativo quando a URL puder ser embutida
   2) tenta HLS.js / MPEG-TS pelo player-enhanced existente
   3) se o GitHub Pages bloquear HTTP/CORS, oferece abertura DIRETA no navegador
*/
(function(){
  const enhancedOpen = window.openLiveChannel;
  let lastDirectUrls = [];
  let lastDirectTitle = "Canal";

  function esc(value){
    if (typeof escapeHTML === "function") return escapeHTML(value);
    return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function directCandidates(session, streamId, extension){
    const base = String(session.server || "").replace(/\/+$/, "");
    const user = encodeURIComponent(session.username || "");
    const pass = encodeURIComponent(session.password || "");
    const id = encodeURIComponent(streamId || "");
    const ext = String(extension || "ts").replace(/^\./, "").toLowerCase();
    const path = `${user}/${pass}/${id}`;
    const list = [];
    const add = u => { if (u && !list.includes(u)) list.push(u); };

    /* URL EXATA retornada pela API */
    add(`${base}/live/${path}.${ext}`);

    /* formatos mais comuns */
    if (ext !== "m3u8") add(`${base}/live/${path}.m3u8`);
    if (ext !== "ts") add(`${base}/live/${path}.ts`);

    /* tenta o outro protocolo somente como alternativa */
    if (/^https:\/\//i.test(base)) {
      const httpBase = base.replace(/^https:\/\//i, "http://");
      add(`${httpBase}/live/${path}.${ext}`);
      if (ext !== "m3u8") add(`${httpBase}/live/${path}.m3u8`);
      if (ext !== "ts") add(`${httpBase}/live/${path}.ts`);
    } else if (/^http:\/\//i.test(base)) {
      const httpsBase = base.replace(/^http:\/\//i, "https://");
      add(`${httpsBase}/live/${path}.${ext}`);
      if (ext !== "m3u8") add(`${httpsBase}/live/${path}.m3u8`);
      if (ext !== "ts") add(`${httpsBase}/live/${path}.ts`);
    }

    return list;
  }

  function canEmbed(url){
    /* HTTPS page cannot embed HTTP media. Top-level navigation can still open it. */
    if (window.location.protocol === "https:" && /^http:\/\//i.test(url)) return false;
    return true;
  }

  function cleanupVideo(video){
    try {
      video.pause();
      video.removeAttribute("src");
      video.removeAttribute("crossorigin");
      video.load();
    } catch (_) {}
  }

  function tryNative(video, urls, index, title, done){
    while (index < urls.length && !canEmbed(urls[index])) index++;
    if (index >= urls.length) return done(false);

    const url = urls[index];
    let finished = false;
    let timer = null;

    const cleanupListeners = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("error", onError);
      video.removeEventListener("abort", onError);
    };

    const succeed = () => {
      if (finished) return;
      finished = true;
      cleanupListeners();
      if (typeof setPlayerStatus === "function") setPlayerStatus("Canal aberto diretamente pelo navegador.", "ok");
      video.play().catch(() => {
        if (typeof setPlayerStatus === "function") setPlayerStatus("Canal carregado. Clique no ▶ do vídeo para iniciar.", "ok");
      });
      done(true);
    };

    const fail = () => {
      if (finished) return;
      finished = true;
      cleanupListeners();
      cleanupVideo(video);
      tryNative(video, urls, index + 1, title, done);
    };

    const onReady = () => {
      if (video.readyState >= 1) succeed();
    };
    const onError = () => fail();

    if (typeof setText === "function") setText("playerTitle", title || "Reproduzindo");
    if (typeof setPlayerStatus === "function") setPlayerStatus("Tentando abrir o canal diretamente...", "");

    try {
      video.removeAttribute("crossorigin");
      video.src = url;
      video.load();
    } catch (_) {
      fail();
      return;
    }

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener("error", onError);
    video.addEventListener("abort", onError);

    /* Não considerar stalled como falha imediata: IPTV ao vivo pode demorar */
    timer = setTimeout(() => {
      if (video.readyState >= 1) succeed();
      else fail();
    }, 7000);
  }

  function showDirectOpen(title, urls){
    const status = document.getElementById("playerStatus");
    if (!status) return;

    const original = urls[0] || "";
    const hls = urls.find(u => /\.m3u8(?:$|\?)/i.test(u)) || "";
    const ts = urls.find(u => /\.ts(?:$|\?)/i.test(u)) || "";

    status.classList.remove("ok");
    status.classList.add("error");
    status.innerHTML = `<div style="margin-bottom:9px">O navegador não conseguiu embutir este canal. Abra a transmissão diretamente, igual a colar o link na barra do Chrome.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="openDirectChannel" type="button" style="padding:9px 14px;border:0;border-radius:9px;background:#ff6a00;color:#fff;font-weight:700;cursor:pointer">▶ Abrir canal direto</button>
        ${hls ? '<button id="openDirectHls" type="button" style="padding:9px 12px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:#27100b;color:#fff;cursor:pointer">Abrir HLS</button>' : ''}
        ${ts ? '<button id="openDirectTs" type="button" style="padding:9px 12px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:#27100b;color:#fff;cursor:pointer">Abrir TS</button>' : ''}
      </div>`;

    const open = url => {
      if (!url) return;
      /* Navegação de topo: não é Mixed Content embutido */
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) window.location.href = url;
    };

    document.getElementById("openDirectChannel")?.addEventListener("click", () => open(original));
    document.getElementById("openDirectHls")?.addEventListener("click", () => open(hls));
    document.getElementById("openDirectTs")?.addEventListener("click", () => open(ts));
  }

  window.openLiveChannel = function(session, streamId, extension, title){
    const pref = (typeof getPreferredPlayer === "function") ? getPreferredPlayer() : "web";

    /* Respeita as opções externas escolhidas nas configurações */
    if (pref && pref !== "web") {
      return enhancedOpen(session, streamId, extension, title);
    }

    const video = document.getElementById("videoPlayer");
    const placeholder = document.getElementById("playerPlaceholder");
    const urls = directCandidates(session, streamId, extension);
    lastDirectUrls = urls;
    lastDirectTitle = title || "Canal";

    if (!video || !session) {
      showDirectOpen(lastDirectTitle, lastDirectUrls);
      return;
    }

    try {
      if (typeof destroyEnhancedPlayers === "function") destroyEnhancedPlayers();
      cleanupVideo(video);
    } catch (_) {}

    if (placeholder) placeholder.style.display = "none";

    /* Primeiro tenta a URL direta sem fetch/CORS JS. */
    tryNative(video, urls, 0, title, ok => {
      if (ok) return;

      /* Depois usa o player aprimorado (HLS.js / MPEG-TS). */
      let fallbackFinished = false;
      const status = document.getElementById("playerStatus");

      /* Observa se o enhanced termina em erro. */
      const observer = status ? new MutationObserver(() => {
        const text = status.textContent || "";
        if (/não abriu|VLC|rota HTTPS|bloque/i.test(text)) {
          observer.disconnect();
          if (!fallbackFinished) {
            fallbackFinished = true;
            showDirectOpen(title, urls);
          }
        }
      }) : null;
      if (observer && status) observer.observe(status, { childList:true, subtree:true, characterData:true });

      try {
        enhancedOpen(session, streamId, extension, title);
      } catch (_) {
        if (observer) observer.disconnect();
        showDirectOpen(title, urls);
        return;
      }

      /* Segurança: se o enhanced não resolver, mostra abertura direta. */
      setTimeout(() => {
        if (fallbackFinished) return;
        const v = document.getElementById("videoPlayer");
        if (v && v.readyState >= 2 && !v.error) return;
        if (observer) observer.disconnect();
        fallbackFinished = true;
        showDirectOpen(title, urls);
      }, 15000);
    });
  };
})();
