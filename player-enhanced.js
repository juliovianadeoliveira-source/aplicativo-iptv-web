/* PLAYER IPTV - HLS + MPEG-TS + server_info Xtream */
let enhancedMpegtsPlayer = null;
let cachedServerInfo = null;
let serverInfoPromise = null;

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

async function getXtreamServerInfo(session) {
    if (cachedServerInfo) return cachedServerInfo;
    if (!serverInfoPromise) {
        serverInfoPromise = xtreamRequest(session, "")
            .then(data => {
                cachedServerInfo = data && data.server_info ? data.server_info : {};
                return cachedServerInfo;
            })
            .catch(() => ({}));
    }
    return serverInfoPromise;
}

function hostOnly(value) {
    if (!value) return "";
    let text = String(value).trim();
    try {
        if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
        return new URL(text).hostname;
    } catch (_) {
        return String(value).replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
    }
}

function addHost(list, value) {
    if (!value) return;
    const clean = String(value).replace(/\/+$/, "");
    if (!list.includes(clean)) list.push(clean);
}

async function buildStreamHosts(session) {
    const info = await getXtreamServerInfo(session);
    const hosts = [];
    const pageIsHttps = window.location.protocol === "https:";
    const sessionBase = String(session.server || "").replace(/\/+$/, "");
    const hostname = hostOnly(info.url || sessionBase);
    const httpsPort = String(info.https_port || "").trim();
    const normalPort = String(info.port || "").trim();

    if (pageIsHttps) {
        if (hostname && httpsPort && httpsPort !== "0") {
            addHost(hosts, `https://${hostname}${httpsPort === "443" ? "" : `:${httpsPort}`}`);
        }
        if (/^https:\/\//i.test(sessionBase)) addHost(hosts, sessionBase);
        if (hostname) addHost(hosts, `https://${hostname}`);
    } else {
        addHost(hosts, sessionBase);
        if (hostname && normalPort && normalPort !== "0") addHost(hosts, `http://${hostname}${normalPort === "80" ? "" : `:${normalPort}`}`);
        if (hostname && httpsPort && httpsPort !== "0") addHost(hosts, `https://${hostname}${httpsPort === "443" ? "" : `:${httpsPort}`}`);
    }

    return hosts;
}

function candidateList(hosts, session, streamId, extension) {
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

    hosts.forEach(host => {
        add(`${host}/live/${path}.m3u8`, "hls");
        add(`${host}/live/${path}.ts`, "mpegts");
        if (ext !== "m3u8" && ext !== "ts") add(`${host}/live/${path}.${ext}`, "native");
    });

    return list;
}

async function openLiveChannel(session, streamId, extension, title) {
    const video = document.getElementById("videoPlayer");
    const placeholder = document.getElementById("playerPlaceholder");
    if (!video || !session) return;

    destroyEnhancedPlayers();
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
    if (placeholder) placeholder.style.display = "none";
    setText("playerTitle", title || "Reproduzindo");
    setPlayerStatus("Localizando a melhor rota do canal...", "");

    const hosts = await buildStreamHosts(session);
    if (!hosts.length) {
        setPlayerStatus("Este servidor não informou uma rota HTTPS utilizável para os streams. No GitHub Pages o Chrome não permite vídeo HTTP dentro de uma página HTTPS.", "error");
        return;
    }

    const candidates = candidateList(hosts, session, streamId, extension);
    tryEnhancedCandidate(candidates, 0, video);
}

function tryEnhancedCandidate(candidates, index, video) {
    if (index >= candidates.length) {
        setPlayerStatus("O canal não abriu por HTTPS. Isso normalmente significa que o servidor não libera CORS nos streams ou não oferece HLS/MPEG-TS por HTTPS. O catálogo funciona porque a API está acessível, mas o vídeo precisa das mesmas permissões.", "error");
        return;
    }

    const candidate = candidates[index];
    const next = () => {
        destroyEnhancedPlayers();
        try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
        tryEnhancedCandidate(candidates, index + 1, video);
    };

    setPlayerStatus(candidate.type === "hls" ? "Tentando HLS..." : candidate.type === "mpegts" ? "Tentando MPEG-TS..." : "Tentando reprodução direta...", "");

    if (candidate.type === "hls") {
        if (window.Hls && Hls.isSupported()) {
            try {
                hlsInstance = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    manifestLoadingTimeOut: 5000,
                    levelLoadingTimeOut: 5000,
                    fragLoadingTimeOut: 7000,
                    maxBufferLength: 25
                });
                let failed = false;
                const fail = () => {
                    if (failed) return;
                    failed = true;
                    next();
                };
                hlsInstance.loadSource(candidate.url);
                hlsInstance.attachMedia(video);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    setPlayerStatus("Canal carregado.", "ok");
                    video.play().catch(() => setPlayerStatus("Canal carregado. Clique no ▶ do vídeo.", "ok"));
                });
                hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
                    if (data && data.fatal) fail();
                });
                setTimeout(() => {
                    if (video.readyState === 0) fail();
                }, 6500);
                return;
            } catch (_) {
                next();
                return;
            }
        }

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
            let done = false;
            const fail = () => { if (!done) { done = true; next(); } };
            video.addEventListener("error", fail, { once: true });
            video.src = candidate.url;
            video.addEventListener("canplay", () => {
                done = true;
                setPlayerStatus("Canal carregado.", "ok");
                video.play().catch(() => {});
            }, { once: true });
            setTimeout(() => { if (!done && video.readyState === 0) fail(); }, 6000);
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
                url: candidate.url
            }, {
                enableWorker: true,
                enableStashBuffer: false,
                stashInitialSize: 128,
                liveBufferLatencyChasing: true
            });

            let failed = false;
            const fail = () => {
                if (failed) return;
                failed = true;
                next();
            };

            enhancedMpegtsPlayer.attachMediaElement(video);
            enhancedMpegtsPlayer.load();
            enhancedMpegtsPlayer.on(mpegts.Events.ERROR, fail);
            video.addEventListener("canplay", () => {
                setPlayerStatus("Canal carregado.", "ok");
                video.play().catch(() => setPlayerStatus("Canal carregado. Clique no ▶ do vídeo.", "ok"));
            }, { once: true });
            setTimeout(() => { if (video.readyState === 0) fail(); }, 6500);
            return;
        } catch (_) {
            next();
            return;
        }
    }

    let done = false;
    const fail = () => { if (!done) { done = true; next(); } };
    video.addEventListener("error", fail, { once: true });
    video.src = candidate.url;
    video.load();
    video.addEventListener("canplay", () => {
        done = true;
        setPlayerStatus("Canal carregado.", "ok");
        video.play().catch(() => {});
    }, { once: true });
    setTimeout(() => { if (!done && video.readyState === 0) fail(); }, 5500);
}

window.addEventListener("beforeunload", destroyEnhancedPlayers);
