/* Reprodução aprimorada: HLS + MPEG-TS */
let enhancedMpegtsPlayer = null;

function destroyEnhancedPlayers() {
    try {
        if (enhancedMpegtsPlayer) {
            enhancedMpegtsPlayer.pause();
            enhancedMpegtsPlayer.unload();
            enhancedMpegtsPlayer.detachMediaElement();
            enhancedMpegtsPlayer.destroy();
        }
    } catch (_) {}
    enhancedMpegtsPlayer = null;

    try {
        if (typeof hlsInstance !== "undefined" && hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }
    } catch (_) {}
}

function enhancedCandidates(session, streamId, extension) {
    const base = String(session.server || "").replace(/\/+$/, "");
    const user = encodeURIComponent(session.username || "");
    const pass = encodeURIComponent(session.password || "");
    const id = encodeURIComponent(streamId || "");
    const ext = String(extension || "ts").replace(/^\./, "").toLowerCase();
    const path = `${user}/${pass}/${id}`;
    const list = [];
    const add = (url, type) => {
        if (!url || list.some(item => item.url === url)) return;
        list.push({ url, type });
    };

    const bases = [];
    const addBase = value => { if (value && !bases.includes(value)) bases.push(value); };

    // Em GitHub Pages, HTTPS tem prioridade para evitar mixed content.
    if (/^http:\/\//i.test(base)) {
        addBase(base.replace(/^http:\/\//i, "https://"));
        addBase(base);
    } else {
        addBase(base);
        if (/^https:\/\//i.test(base)) addBase(base.replace(/^https:\/\//i, "http://"));
    }

    bases.forEach(host => {
        add(`${host}/live/${path}.m3u8`, "hls");
        add(`${host}/live/${path}.ts`, "mpegts");
        if (ext !== "m3u8" && ext !== "ts") add(`${host}/live/${path}.${ext}`, "native");
    });

    return list;
}

function openLiveChannel(session, streamId, extension, title) {
    const modal = document.getElementById("playerModal");
    const video = document.getElementById("videoPlayer");
    if (!modal || !video) return;

    destroyEnhancedPlayers();
    video.pause();
    video.removeAttribute("src");
    video.load();

    setText("playerTitle", title || "Reproduzindo");
    showPlayerError("Abrindo canal...");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");

    const candidates = enhancedCandidates(session, streamId, extension);
    tryEnhancedCandidate(candidates, 0, video);
}

function tryEnhancedCandidate(candidates, index, video) {
    if (index >= candidates.length) {
        showPlayerError("Não foi possível reproduzir este canal no navegador. Se o servidor só entregar HTTP, o GitHub Pages em HTTPS será bloqueado pelo Chrome. Se o servidor liberar HTTPS/CORS, HLS ou MPEG-TS, este player tenta automaticamente.");
        return;
    }

    const candidate = candidates[index];
    const url = candidate.url;
    const next = () => {
        destroyEnhancedPlayers();
        try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
        tryEnhancedCandidate(candidates, index + 1, video);
    };

    showPlayerError(candidate.type === "hls" ? "Tentando HLS..." : candidate.type === "mpegts" ? "Tentando MPEG-TS..." : "Tentando reprodução...");

    if (candidate.type === "hls") {
        if (window.Hls && Hls.isSupported()) {
            try {
                hlsInstance = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    maxBufferLength: 40,
                    manifestLoadingTimeOut: 12000,
                    levelLoadingTimeOut: 12000,
                    fragLoadingTimeOut: 15000
                });
                let failed = false;
                hlsInstance.loadSource(url);
                hlsInstance.attachMedia(video);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    showPlayerError("");
                    video.play().catch(() => showPlayerError("Canal carregado. Clique no ▶ do vídeo para iniciar."));
                });
                hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
                    if (data && data.fatal && !failed) {
                        failed = true;
                        next();
                    }
                });
                return;
            } catch (_) {
                next();
                return;
            }
        }

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
            const fail = () => next();
            video.addEventListener("error", fail, { once: true });
            video.src = url;
            video.addEventListener("loadedmetadata", () => {
                showPlayerError("");
                video.play().catch(() => {});
            }, { once: true });
            return;
        }

        next();
        return;
    }

    if (candidate.type === "mpegts" && window.mpegts && mpegts.isSupported()) {
        try {
            enhancedMpegtsPlayer = mpegts.createPlayer({
                type: "mpegts",
                isLive: true,
                url
            }, {
                enableWorker: true,
                enableStashBuffer: false,
                stashInitialSize: 128,
                liveBufferLatencyChasing: true,
                liveBufferLatencyMaxLatency: 5,
                liveBufferLatencyMinRemain: 1
            });
            let advanced = false;
            const fail = () => {
                if (advanced) return;
                advanced = true;
                next();
            };
            enhancedMpegtsPlayer.attachMediaElement(video);
            enhancedMpegtsPlayer.load();
            enhancedMpegtsPlayer.on(mpegts.Events.ERROR, fail);
            video.addEventListener("canplay", () => {
                showPlayerError("");
                video.play().catch(() => showPlayerError("Canal carregado. Clique no ▶ do vídeo para iniciar."));
            }, { once: true });
            setTimeout(() => {
                if (video.readyState === 0) fail();
            }, 12000);
            return;
        } catch (_) {
            next();
            return;
        }
    }

    const fail = () => next();
    video.addEventListener("error", fail, { once: true });
    video.src = url;
    video.load();
    video.addEventListener("canplay", () => {
        showPlayerError("");
        video.play().catch(() => showPlayerError("Canal carregado. Clique no ▶ do vídeo para iniciar."));
    }, { once: true });
}

// Garante que fechar o modal derrube também o mpegts.js.
const originalClosePlayer = typeof closePlayer === "function" ? closePlayer : null;
closePlayer = function () {
    destroyEnhancedPlayers();
    if (originalClosePlayer) originalClosePlayer();
};
