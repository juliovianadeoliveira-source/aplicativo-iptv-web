/* PLAYER FINAL: reprodução web sem botões VLC/M3U/copiar URL */
(function () {
  const previousOpen = window.openLiveChannel;

  // Remove definitivamente o fallback antigo com VLC/M3U/Copiar URL.
  window.showExternalFallback = function () {
    const status = document.getElementById("playerStatus");
    if (!status) return;
    status.classList.remove("ok");
    status.classList.add("error");
    status.textContent = "Não foi possível reproduzir este canal no navegador.";
  };

  // O player padrão passa a ser sempre o player web.
  window.getPreferredPlayer = function () { return "web"; };

  function urlsFor(session, streamId, extension) {
    const base = String(session.server || "").replace(/\/+$/, "");
    const user = encodeURIComponent(session.username || "");
    const pass = encodeURIComponent(session.password || "");
    const id = encodeURIComponent(streamId || "");
    const ext = String(extension || "ts").replace(/^\./, "").toLowerCase();
    const root = `${base}/live/${user}/${pass}/${id}`;
    const list = [];
    const add = (url, type) => { if (!list.some(x => x.url === url)) list.push({ url, type }); };

    // Usa primeiro exatamente o formato informado pelo servidor.
    add(`${root}.${ext}`, ext === "m3u8" ? "hls" : ext === "ts" ? "mpegts" : "native");
    if (ext !== "m3u8") add(`${root}.m3u8`, "hls");
    if (ext !== "ts") add(`${root}.ts`, "mpegts");
    return list;
  }

  function cleanup(video) {
    try { if (typeof destroyEnhancedPlayers === "function") destroyEnhancedPlayers(); } catch (_) {}
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
  }

  function status(text, type) {
    if (typeof setPlayerStatus === "function") setPlayerStatus(text, type || "");
  }

  function attempt(video, list, index) {
    if (index >= list.length) {
      status("Não foi possível reproduzir este canal no navegador.", "error");
      return;
    }

    const item = list[index];
    let finished = false;
    const next = () => {
      if (finished) return;
      finished = true;
      cleanup(video);
      attempt(video, list, index + 1);
    };
    const ready = () => {
      if (finished) return;
      finished = true;
      status("Canal carregado.", "ok");
      video.play().catch(() => status("Canal carregado. Clique no ▶ para iniciar.", "ok"));
    };

    if (item.type === "hls" && window.Hls && Hls.isSupported()) {
      status("Carregando canal...", "");
      try {
        window.hlsInstance = new Hls({
          enableWorker: true,
          manifestLoadingTimeOut: 5000,
          levelLoadingTimeOut: 5000,
          fragLoadingTimeOut: 7000
        });
        hlsInstance.loadSource(item.url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, ready);
        hlsInstance.on(Hls.Events.ERROR, function (_event, data) { if (data && data.fatal) next(); });
        setTimeout(() => { if (!finished && video.readyState === 0) next(); }, 7000);
        return;
      } catch (_) { next(); return; }
    }

    if (item.type === "mpegts" && window.mpegts && mpegts.isSupported()) {
      status("Carregando canal...", "");
      try {
        const p = mpegts.createPlayer({ type: "mpegts", isLive: true, url: item.url }, {
          enableWorker: true,
          enableStashBuffer: false,
          liveBufferLatencyChasing: true
        });
        window.enhancedMpegtsPlayer = p;
        p.attachMediaElement(video);
        p.load();
        p.on(mpegts.Events.ERROR, next);
        video.addEventListener("canplay", ready, { once: true });
        setTimeout(() => { if (!finished && video.readyState === 0) next(); }, 7000);
        return;
      } catch (_) { next(); return; }
    }

    status("Carregando canal...", "");
    video.addEventListener("canplay", ready, { once: true });
    video.addEventListener("error", next, { once: true });
    try {
      video.removeAttribute("crossorigin");
      video.src = item.url;
      video.load();
      video.play().catch(() => {});
    } catch (_) { next(); return; }
    setTimeout(() => { if (!finished && video.readyState === 0) next(); }, 6500);
  }

  window.openLiveChannel = function (session, streamId, extension, title) {
    const video = document.getElementById("videoPlayer");
    const placeholder = document.getElementById("playerPlaceholder");
    if (!video || !session) {
      if (typeof previousOpen === "function") return previousOpen(session, streamId, extension, title);
      return;
    }

    cleanup(video);
    if (placeholder) placeholder.style.display = "none";
    const titleEl = document.getElementById("playerTitle");
    if (titleEl) titleEl.textContent = title || "Reproduzindo";
    status("Carregando canal...", "");
    attempt(video, urlsFor(session, streamId, extension), 0);
  };
})();
