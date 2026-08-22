/* PLAYER IPTV - HLS + MPEG-TS + VLC fallback + server_info Xtream */
let enhancedMpegtsPlayer = null;
let cachedServerInfo = null;
let serverInfoPromise = null;
let lastExternalPlayback = null;

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

async function buildExternalHosts(session) {
    const info = await getXtreamServerInfo(session);
    const hosts = [];
    const sessionBase = String(session.server || "").replace(/\/+$/, "");
    const hostname = hostOnly(info.url || sessionBase);
    const httpsPort = String(info.https_port || "").trim();
    const normalPort = String(info.port || "").trim();

    // VLC não sofre o bloqueio de mixed-content/CORS do navegador,
    // então aqui mantemos tanto HTTP quanto HTTPS.
    addHost(hosts, sessionBase);

    if (hostname && normalPort && normalPort !== "0") {
        addHost(hosts, `http://${hostname}${normalPort === "80" ? "" : `:${normalPort}`}`);
    }
    if (hostname) addHost(hosts, `http://${hostname}`);

    if (hostname && httpsPort && httpsPort !== "0") {
        addHost(hosts, `https://${hostname}${httpsPort === "443" ? "" : `:${httpsPort}`}`);
    }
    if (hostname) addHost(hosts, `https://${hostname}`);

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

async function prepareExternalPlayback(session, streamId, extension, title) {
    const hosts = await buildExternalHosts(session);
    const candidates = candidateList(hosts, session, streamId, extension);

    // VLC costuma lidar muito bem com TS. Priorizamos o formato original,
    // depois TS e por último HLS.
    const ext = String(extension || "ts").replace(/^\./, "").toLowerCase();
    const ordered = [
        ...candidates.filter(c => c.url.toLowerCase().endsWith(`.${ext}`)),
        ...candidates.filter(c => c.type === "mpegts"),
        ...candidates.filter(c => c.type === "hls"),
        ...candidates
    ];

    const unique = [];
    ordered.forEach(item => {
        if (!unique.some(x => x.url === item.url)) unique.push(item);
    });

    lastExternalPlayback = {
        title: title || "Canal IPTV",
        url: unique.length ? unique[0].url : "",
        candidates: unique
    };

    return lastExternalPlayback;
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

    await prepareExternalPlayback(session, streamId, extension, title);

    const hosts = await buildStreamHosts(session);
    if (!hosts.length) {
        showVlcFallback("Este stream não tem rota HTTPS utilizável no navegador.");
        return;
    }

    const candidates = candidateList(hosts, session, streamId, extension);
    tryEnhancedCandidate(candidates, 0, video);
}

function tryEnhancedCandidate(candidates, index, video) {
    if (index >= candidates.length) {
        showVlcFallback("O navegador bloqueou ou não conseguiu decodificar este stream.");
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

function showVlcFallback(reason) {
    const status = document.getElementById("playerStatus");
    if (!status) return;

    status.className = "player-status error";
    status.innerHTML = "";

    const message = document.createElement("div");
    message.textContent = `${reason} Você pode abrir o mesmo canal no VLC, que não depende do CORS do GitHub Pages.`;
    message.style.marginBottom = "10px";
    status.appendChild(message);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";

    const vlcButton = makePlayerAction("▶ Abrir no VLC", openCurrentInVlc);
    const m3uButton = makePlayerAction("⬇ VLC (.m3u)", downloadCurrentM3U);
    const copyButton = makePlayerAction("🔗 Copiar URL", copyCurrentStreamUrl);

    actions.appendChild(vlcButton);
    actions.appendChild(m3uButton);
    actions.appendChild(copyButton);
    status.appendChild(actions);
}

function makePlayerAction(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.border = "1px solid rgba(255,255,255,.18)";
    button.style.background = "rgba(255,255,255,.08)";
    button.style.color = "#fff";
    button.style.borderRadius = "8px";
    button.style.padding = "7px 10px";
    button.style.cursor = "pointer";
    button.style.fontSize = "11px";
    button.addEventListener("click", handler);
    return button;
}

function openCurrentInVlc() {
    if (!lastExternalPlayback || !lastExternalPlayback.url) return;
    const url = lastExternalPlayback.url;
    const ua = navigator.userAgent || "";

    // Android: tenta abrir diretamente o VLC instalado.
    if (/Android/i.test(ua)) {
        const withoutScheme = url.replace(/^https?:\/\//i, "");
        const scheme = /^https:\/\//i.test(url) ? "https" : "http";
        window.location.href = `intent://${withoutScheme}#Intent;scheme=${scheme};package=org.videolan.vlc;end`;
        return;
    }

    // Desktop/iOS: tenta o protocolo do VLC. Se o sistema não tiver
    // associação para vlc://, o botão .m3u continua disponível logo ao lado.
    window.location.href = `vlc://${url}`;
}

function downloadCurrentM3U() {
    if (!lastExternalPlayback || !lastExternalPlayback.url) return;

    const safeTitle = String(lastExternalPlayback.title || "canal")
        .replace(/[\\/:*?"<>|]+/g, " ")
        .trim() || "canal";

    const content = `#EXTM3U\n#EXTINF:-1,${lastExternalPlayback.title || "Canal IPTV"}\n${lastExternalPlayback.url}\n`;
    const blob = new Blob([content], { type: "audio/x-mpegurl;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${safeTitle}.m3u`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

async function copyCurrentStreamUrl() {
    if (!lastExternalPlayback || !lastExternalPlayback.url) return;
    try {
        await navigator.clipboard.writeText(lastExternalPlayback.url);
        setPlayerStatus("URL do canal copiada. Cole em Mídia > Abrir fluxo de rede no VLC.", "ok");
    } catch (_) {
        window.prompt("Copie a URL e cole no VLC:", lastExternalPlayback.url);
    }
}

window.addEventListener("beforeunload", destroyEnhancedPlayers);
