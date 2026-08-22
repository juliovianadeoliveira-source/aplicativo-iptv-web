/* Tentativa nativa primeiro: usa a URL direta no <video> antes dos players JS. */
(function(){
  const fallbackOpen = window.openLiveChannel;

  function directCandidates(session, streamId, extension){
    const base = String(session.server || "").replace(/\/+$/, "");
    const user = encodeURIComponent(session.username || "");
    const pass = encodeURIComponent(session.password || "");
    const id = encodeURIComponent(streamId || "");
    const ext = String(extension || "ts").replace(/^\./, "").toLowerCase();
    const path = `${user}/${pass}/${id}`;
    const list = [];
    const add = u => { if (u && !list.includes(u)) list.push(u); };

    // Primeiro: exatamente o host salvo na sessão + extensão original retornada pela API.
    add(`${base}/live/${path}.${ext}`);

    // Depois variantes comuns no mesmo host.
    if (ext !== "m3u8") add(`${base}/live/${path}.m3u8`);
    if (ext !== "ts") add(`${base}/live/${path}.ts`);

    return list;
  }

  function tryNative(video, urls, index, title, done){
    if (index >= urls.length) return done(false);

    const url = urls[index];
    let finished = false;
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
      video.removeEventListener("stalled", onError);
      video.removeEventListener("abort", onError);
    };

    const succeed = () => {
      if (finished) return;
      finished = true;
      cleanup();
      if (typeof setPlayerStatus === "function") setPlayerStatus("Canal aberto pelo player nativo do navegador.", "ok");
      video.play().catch(() => {
        if (typeof setPlayerStatus === "function") setPlayerStatus("Canal carregado. Clique no ▶ do vídeo para iniciar.", "ok");
      });
      done(true);
    };

    const fail = () => {
      if (finished) return;
      finished = true;
      cleanup();
      try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
      tryNative(video, urls, index + 1, title, done);
    };

    const onReady = () => {
      if (video.readyState >= 1) succeed();
    };
    const onError = () => fail();

    if (typeof setText === "function") setText("playerTitle", title || "Reproduzindo");
    if (typeof setPlayerStatus === "function") setPlayerStatus("Tentando reprodução direta do navegador...", "");

    try {
      video.crossOrigin = null;
      video.removeAttribute("crossorigin");
      video.src = url;
      video.load();
    } catch (_) {
      fail();
      return;
    }

    video.addEventListener("loadedmetadata", onReady, { once:false });
    video.addEventListener("canplay", onReady, { once:false });
    video.addEventListener("error", onError, { once:false });
    video.addEventListener("stalled", onError, { once:false });
    video.addEventListener("abort", onError, { once:false });

    timer = setTimeout(() => {
      if (video.readyState >= 1) succeed();
      else fail();
    }, 4500);
  }

  window.openLiveChannel = async function(session, streamId, extension, title){
    const pref = (typeof getPreferredPlayer === "function") ? getPreferredPlayer() : "web";

    // Respeita VLC / M3U / copiar URL escolhidos nas configurações.
    if (pref && pref !== "web") {
      return fallbackOpen(session, streamId, extension, title);
    }

    const video = document.getElementById("videoPlayer");
    const placeholder = document.getElementById("playerPlaceholder");
    if (!video || !session) return fallbackOpen(session, streamId, extension, title);

    try {
      if (typeof destroyEnhancedPlayers === "function") destroyEnhancedPlayers();
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (_) {}

    if (placeholder) placeholder.style.display = "none";

    const urls = directCandidates(session, streamId, extension);
    tryNative(video, urls, 0, title, ok => {
      if (!ok) fallbackOpen(session, streamId, extension, title);
    });
  };
})();
