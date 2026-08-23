/* IPTV PLAYER WEB 2026 - player final único
   Ordem: URL original -> HLS.js -> MPEG-TS -> nativo
   Sem VLC, sem M3U, sem copiar URL.
*/
(function () {
  'use strict';

  let hls = null;
  let mpegtsPlayer = null;
  let playToken = 0;

  function el(id) { return document.getElementById(id); }

  function setStatus(text, type) {
    const node = el('playerStatus');
    if (!node) return;
    node.classList.remove('ok', 'error');
    if (type) node.classList.add(type);
    node.textContent = text;
  }

  function setTitle(title) {
    const node = el('playerTitle');
    if (node) node.textContent = title || 'Reproduzindo';
  }

  function destroyPlayers() {
    try {
      if (hls) {
        hls.destroy();
        hls = null;
      }
    } catch (_) {}

    try {
      if (mpegtsPlayer) {
        mpegtsPlayer.pause();
        mpegtsPlayer.unload();
        mpegtsPlayer.detachMediaElement();
        mpegtsPlayer.destroy();
        mpegtsPlayer = null;
      }
    } catch (_) {}
  }

  function resetVideo(video) {
    destroyPlayers();
    try {
      video.pause();
      video.removeAttribute('src');
      video.removeAttribute('crossorigin');
      video.load();
    } catch (_) {}
  }

  function addUnique(list, url, type) {
    if (!url || list.some(item => item.url === url)) return;
    list.push({ url, type });
  }

  function buildCandidates(session, streamId, extension) {
    const server = String(session.server || '').replace(/\/+$/, '');
    const user = encodeURIComponent(session.username || '');
    const pass = encodeURIComponent(session.password || '');
    const id = encodeURIComponent(streamId || '');
    const ext = String(extension || 'ts').replace(/^\./, '').toLowerCase();
    const root = `${server}/live/${user}/${pass}/${id}`;
    const list = [];

    // 1) Exatamente o formato informado pelo servidor.
    addUnique(list, `${root}.${ext}`, ext === 'm3u8' ? 'hls' : ext === 'ts' ? 'mpegts' : 'native');

    // 2) HLS é o formato mais indicado para navegador.
    if (ext !== 'm3u8') addUnique(list, `${root}.m3u8`, 'hls');

    // 3) MPEG-TS para servidores Xtream que entregam .ts.
    if (ext !== 'ts') addUnique(list, `${root}.ts`, 'mpegts');

    return list;
  }

  function waitForVideo(video, token, timeout, onReady, onFail) {
    let finished = false;
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', ready);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('playing', ready);
      video.removeEventListener('error', fail);
      video.removeEventListener('abort', fail);
    };

    const ready = () => {
      if (finished || token !== playToken) return;
      if (video.readyState < 1) return;
      finished = true;
      cleanup();
      onReady();
    };

    const fail = () => {
      if (finished || token !== playToken) return;
      finished = true;
      cleanup();
      onFail();
    };

    video.addEventListener('loadedmetadata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('playing', ready);
    video.addEventListener('error', fail);
    video.addEventListener('abort', fail);
    timer = setTimeout(() => {
      if (video.readyState >= 1) ready();
      else fail();
    }, timeout);

    return cleanup;
  }

  function playNative(video, candidate, token, next) {
    setStatus('Abrindo transmissão direta...', '');
    resetVideo(video);

    const cleanup = waitForVideo(video, token, 6500, () => {
      setStatus('Canal carregado.', 'ok');
      video.play().catch(() => setStatus('Canal carregado. Clique no ▶ para iniciar.', 'ok'));
    }, next);

    try {
      video.removeAttribute('crossorigin');
      video.src = candidate.url;
      video.load();
      video.play().catch(() => {});
    } catch (_) {
      cleanup();
      next();
    }
  }

  function playHls(video, candidate, token, next) {
    if (!(window.Hls && Hls.isSupported())) {
      // Safari e alguns navegadores conseguem HLS nativamente.
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        playNative(video, candidate, token, next);
        return;
      }
      next();
      return;
    }

    setStatus('Abrindo HLS...', '');
    resetVideo(video);

    try {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 7000,
        levelLoadingTimeOut: 7000,
        fragLoadingTimeOut: 9000,
        startFragPrefetch: true
      });

      let done = false;
      const fail = () => {
        if (done || token !== playToken) return;
        done = true;
        try { hls.destroy(); } catch (_) {}
        hls = null;
        next();
      };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (done || token !== playToken) return;
        done = true;
        setStatus('Canal carregado em HLS.', 'ok');
        video.play().catch(() => setStatus('Canal carregado. Clique no ▶ para iniciar.', 'ok'));
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data && data.fatal) fail();
      });

      hls.loadSource(candidate.url);
      hls.attachMedia(video);
      setTimeout(() => {
        if (!done && video.readyState === 0) fail();
      }, 8500);
    } catch (_) {
      next();
    }
  }

  function playMpegTs(video, candidate, token, next) {
    if (!(window.mpegts && mpegts.isSupported())) {
      next();
      return;
    }

    setStatus('Abrindo MPEG-TS...', '');
    resetVideo(video);

    try {
      mpegtsPlayer = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: candidate.url,
        cors: true
      }, {
        enableWorker: true,
        enableStashBuffer: false,
        stashInitialSize: 128,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 3,
        liveBufferLatencyMinRemain: 0.5
      });

      let done = false;
      const fail = () => {
        if (done || token !== playToken) return;
        done = true;
        try { mpegtsPlayer.destroy(); } catch (_) {}
        mpegtsPlayer = null;
        next();
      };

      mpegtsPlayer.on(mpegts.Events.ERROR, fail);
      video.addEventListener('canplay', () => {
        if (done || token !== playToken) return;
        done = true;
        setStatus('Canal carregado em MPEG-TS.', 'ok');
        video.play().catch(() => setStatus('Canal carregado. Clique no ▶ para iniciar.', 'ok'));
      }, { once: true });

      mpegtsPlayer.attachMediaElement(video);
      mpegtsPlayer.load();
      mpegtsPlayer.play().catch(() => {});

      setTimeout(() => {
        if (!done && video.readyState === 0) fail();
      }, 8500);
    } catch (_) {
      next();
    }
  }

  function tryCandidate(video, candidates, index, token) {
    if (token !== playToken) return;

    if (index >= candidates.length) {
      resetVideo(video);
      setStatus('Este canal não pôde ser reproduzido pelo navegador. O servidor precisa entregar o stream por HTTPS e permitir acesso ao vídeo.', 'error');
      return;
    }

    const candidate = candidates[index];
    const next = () => {
      if (token !== playToken) return;
      tryCandidate(video, candidates, index + 1, token);
    };

    if (candidate.type === 'hls') {
      playHls(video, candidate, token, next);
    } else if (candidate.type === 'mpegts') {
      playMpegTs(video, candidate, token, next);
    } else {
      playNative(video, candidate, token, next);
    }
  }

  // Neutraliza qualquer fallback antigo definido antes deste arquivo.
  window.showExternalFallback = function () {
    setStatus('Este canal não pôde ser reproduzido pelo navegador.', 'error');
  };
  window.getPreferredPlayer = function () { return 'web'; };
  window.setPreferredPlayer = function () {};
  window.openInVlc = function () {};
  window.downloadM3U = function () {};
  window.copyStreamUrl = function () {};

  window.openLiveChannel = function (session, streamId, extension, title) {
    const video = el('videoPlayer');
    if (!video || !session) return;

    playToken += 1;
    const token = playToken;

    const placeholder = el('playerPlaceholder');
    if (placeholder) placeholder.style.display = 'none';

    setTitle(title);
    setStatus('Preparando canal...', '');
    resetVideo(video);

    const candidates = buildCandidates(session, streamId, extension);
    tryCandidate(video, candidates, 0, token);
  };

  window.addEventListener('beforeunload', () => {
    playToken += 1;
    destroyPlayers();
  });
})();
