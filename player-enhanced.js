/* PLAYER IPTV - HLS + MPEG-TS + VLC + categorias de midia */
let enhancedMpegtsPlayer = null;
let cachedServerInfo = null;
let serverInfoPromise = null;
let currentExternalStream = "";
let currentExternalTitle = "Canal";
let vodItemsEnhanced = [];
let vodCategoriesEnhanced = [];
let seriesItemsEnhanced = [];
let seriesCategoriesEnhanced = [];
let activeVodCategory = "all";
let activeSeriesCategory = "all";

const PLAYER_PREF_KEY = "iptvPreferredPlayer";

function getPreferredPlayer() {
    return localStorage.getItem(PLAYER_PREF_KEY) || "web";
}

function setPreferredPlayer(value) {
    localStorage.setItem(PLAYER_PREF_KEY, value || "web");
}

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

async function buildStreamHosts(session, includeHttp = false) {
    const info = await getXtreamServerInfo(session);
    const hosts = [];
    const sessionBase = String(session.server || "").replace(/\/+$/, "");
    const hostname = hostOnly(info.url || sessionBase);
    const httpsPort = String(info.https_port || "").trim();
    const normalPort = String(info.port || "").trim();

    if (hostname && httpsPort && httpsPort !== "0") {
        addHost(hosts, `https://${hostname}${httpsPort === "443" ? "" : `:${httpsPort}`}`);
    }
    if (/^https:\/\//i.test(sessionBase)) addHost(hosts, sessionBase);
    if (hostname) addHost(hosts, `https://${hostname}`);

    if (includeHttp) {
        if (/^http:\/\//i.test(sessionBase)) addHost(hosts, sessionBase);
        if (hostname && normalPort && normalPort !== "0") {
            addHost(hosts, `http://${hostname}${normalPort === "80" ? "" : `:${normalPort}`}`);
        }
        if (hostname) addHost(hosts, `http://${hostname}`);
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

async function getExternalStream(session, streamId, extension) {
    const hosts = await buildStreamHosts(session, true);
    const list = candidateList(hosts, session, streamId, extension);
    const httpTs = list.find(x => /^http:\/\//i.test(x.url) && /\.ts(?:$|\?)/i.test(x.url));
    const anyHttp = list.find(x => /^http:\/\//i.test(x.url));
    const anyTs = list.find(x => /\.ts(?:$|\?)/i.test(x.url));
    return (httpTs || anyHttp || anyTs || list[0] || {}).url || "";
}

async function openLiveChannel(session, streamId, extension, title) {
    const pref = getPreferredPlayer();
    currentExternalTitle = title || "Canal";
    currentExternalStream = await getExternalStream(session, streamId, extension);

    if (pref === "vlc") {
        openInVlc(currentExternalStream);
        return;
    }
    if (pref === "m3u") {
        downloadM3U(currentExternalStream, currentExternalTitle);
        return;
    }
    if (pref === "copy") {
        await copyStreamUrl(currentExternalStream);
        setPlayerStatus("URL do canal copiada. Abra no seu player externo.", "ok");
        return;
    }

    const video = document.getElementById("videoPlayer");
    const placeholder = document.getElementById("playerPlaceholder");
    if (!video || !session) return;

    destroyEnhancedPlayers();
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
    if (placeholder) placeholder.style.display = "none";
    setText("playerTitle", title || "Reproduzindo");
    setPlayerStatus("Localizando a melhor rota do canal...", "");

    const hosts = await buildStreamHosts(session, false);
    if (!hosts.length) {
        showExternalFallback("O servidor não informou uma rota HTTPS para o navegador.");
        return;
    }

    const candidates = candidateList(hosts, session, streamId, extension);
    tryEnhancedCandidate(candidates, 0, video);
}

function tryEnhancedCandidate(candidates, index, video) {
    if (index >= candidates.length) {
        showExternalFallback("O canal não abriu no player web. Você pode abrir no VLC abaixo.");
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
                const fail = () => { if (!failed) { failed = true; next(); } };
                hlsInstance.loadSource(candidate.url);
                hlsInstance.attachMedia(video);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    setPlayerStatus("Canal carregado.", "ok");
                    video.play().catch(() => setPlayerStatus("Canal carregado. Clique no ▶ do vídeo.", "ok"));
                });
                hlsInstance.on(Hls.Events.ERROR, (_event, data) => { if (data && data.fatal) fail(); });
                setTimeout(() => { if (video.readyState === 0) fail(); }, 6500);
                return;
            } catch (_) { next(); return; }
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
        next(); return;
    }

    if (candidate.type === "mpegts" && window.mpegts && mpegts.isSupported()) {
        try {
            enhancedMpegtsPlayer = mpegts.createPlayer({ type: "mpegts", isLive: true, url: candidate.url }, {
                enableWorker: true,
                enableStashBuffer: false,
                stashInitialSize: 128,
                liveBufferLatencyChasing: true
            });
            let failed = false;
            const fail = () => { if (!failed) { failed = true; next(); } };
            enhancedMpegtsPlayer.attachMediaElement(video);
            enhancedMpegtsPlayer.load();
            enhancedMpegtsPlayer.on(mpegts.Events.ERROR, fail);
            video.addEventListener("canplay", () => {
                setPlayerStatus("Canal carregado.", "ok");
                video.play().catch(() => setPlayerStatus("Canal carregado. Clique no ▶ do vídeo.", "ok"));
            }, { once: true });
            setTimeout(() => { if (video.readyState === 0) fail(); }, 6500);
            return;
        } catch (_) { next(); return; }
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

function showExternalFallback(message) {
    const status = document.getElementById("playerStatus");
    if (!status) return;
    status.classList.add("error");
    status.innerHTML = `${escapeHTML(message)}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button type="button" id="vlcOpenBtn" style="padding:8px 11px;border:0;border-radius:9px;background:#ff6a00;color:#fff;cursor:pointer">▶ Abrir no VLC</button>
        <button type="button" id="vlcM3uBtn" style="padding:8px 11px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:#27100b;color:#fff;cursor:pointer">Baixar .m3u</button>
        <button type="button" id="copyStreamBtn" style="padding:8px 11px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:#27100b;color:#fff;cursor:pointer">Copiar URL</button>
    </div>`;
    document.getElementById("vlcOpenBtn")?.addEventListener("click", () => openInVlc(currentExternalStream));
    document.getElementById("vlcM3uBtn")?.addEventListener("click", () => downloadM3U(currentExternalStream, currentExternalTitle));
    document.getElementById("copyStreamBtn")?.addEventListener("click", () => copyStreamUrl(currentExternalStream));
}

function openInVlc(url) {
    if (!url) return;
    window.location.href = `vlc://${url}`;
}

function downloadM3U(url, title) {
    if (!url) return;
    const text = `#EXTM3U\n#EXTINF:-1,${String(title || "Canal").replace(/[\r\n]/g, " ")}\n${url}\n`;
    const blob = new Blob([text], { type: "audio/x-mpegurl" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeFileName(title || "canal")}.m3u`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function copyStreamUrl(url) {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); }
    catch (_) {
        const ta = document.createElement("textarea"); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
}

function safeFileName(value) {
    return String(value).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "canal";
}

/* ==================== FILMES / SERIES ==================== */
async function loadMovies() {
    moviesLoaded = true;
    const grid = document.getElementById("moviesGrid");
    if (!grid || !activeSession) return;
    ensureMediaTools("movies");
    grid.innerHTML = `<div class="empty-state"><div>⏳</div><h3>Carregando filmes...</h3></div>`;
    try {
        const [items, categories] = await Promise.all([
            xtreamRequest(activeSession, "get_vod_streams"),
            xtreamRequest(activeSession, "get_vod_categories").catch(() => [])
        ]);
        vodItemsEnhanced = Array.isArray(items) ? items : [];
        vodCategoriesEnhanced = Array.isArray(categories) ? categories : [];
        setText("movieCount", vodItemsEnhanced.length);
        renderMediaCategoryOptions("movies");
        renderEnhancedMovies();
    } catch (error) {
        grid.innerHTML = emptyStateHTML("⚠️", "Não foi possível carregar filmes", formatError(error));
    }
}

async function loadSeries() {
    seriesLoaded = true;
    const grid = document.getElementById("seriesGrid");
    if (!grid || !activeSession) return;
    ensureMediaTools("series");
    grid.innerHTML = `<div class="empty-state"><div>⏳</div><h3>Carregando séries...</h3></div>`;
    try {
        const [items, categories] = await Promise.all([
            xtreamRequest(activeSession, "get_series"),
            xtreamRequest(activeSession, "get_series_categories").catch(() => [])
        ]);
        seriesItemsEnhanced = Array.isArray(items) ? items : [];
        seriesCategoriesEnhanced = Array.isArray(categories) ? categories : [];
        setText("seriesCount", seriesItemsEnhanced.length);
        renderMediaCategoryOptions("series");
        renderEnhancedSeries();
    } catch (error) {
        grid.innerHTML = emptyStateHTML("⚠️", "Não foi possível carregar séries", formatError(error));
    }
}

function ensureMediaTools(type) {
    const section = document.getElementById(type === "movies" ? "moviesSection" : "seriesSection");
    if (!section || section.querySelector(`.media-tools[data-type="${type}"]`)) return;
    const grid = document.getElementById(type === "movies" ? "moviesGrid" : "seriesGrid");
    const tools = document.createElement("div");
    tools.className = "media-tools";
    tools.dataset.type = type;
    tools.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;margin:0 0 16px";
    tools.innerHTML = `<select id="${type}CategoryFilter" style="min-width:220px;height:43px;border-radius:12px;border:1px solid rgba(255,130,60,.22);background:#260b07;color:#fff;padding:0 12px"><option value="all">Todas as categorias</option></select>
    <input id="${type}Search" type="search" placeholder="Pesquisar ${type === "movies" ? "filme" : "série"}..." style="flex:1;min-width:220px;height:43px;border-radius:12px;border:1px solid rgba(255,130,60,.22);background:#260b07;color:#fff;padding:0 13px">`;
    grid.parentNode.insertBefore(tools, grid);

    document.getElementById(`${type}CategoryFilter`).addEventListener("change", e => {
        if (type === "movies") { activeVodCategory = e.target.value; renderEnhancedMovies(); }
        else { activeSeriesCategory = e.target.value; renderEnhancedSeries(); }
    });
    document.getElementById(`${type}Search`).addEventListener("input", () => {
        if (type === "movies") renderEnhancedMovies(); else renderEnhancedSeries();
    });
}

function renderMediaCategoryOptions(type) {
    const select = document.getElementById(`${type}CategoryFilter`);
    if (!select) return;
    const cats = type === "movies" ? vodCategoriesEnhanced : seriesCategoriesEnhanced;
    select.innerHTML = `<option value="all">Todas as categorias</option>` + cats.map(cat => `<option value="${escapeAttribute(cat.category_id)}">${escapeHTML(cat.category_name || "Sem categoria")}</option>`).join("");
}

function enhancedCategoryName(type, id) {
    const cats = type === "movies" ? vodCategoriesEnhanced : seriesCategoriesEnhanced;
    const found = cats.find(c => String(c.category_id) === String(id));
    return found ? (found.category_name || "Sem categoria") : "Sem categoria";
}

function renderEnhancedMovies() {
    const grid = document.getElementById("moviesGrid"); if (!grid) return;
    const q = (document.getElementById("moviesSearch")?.value || "").toLowerCase().trim();
    let list = vodItemsEnhanced;
    if (activeVodCategory !== "all") list = list.filter(x => String(x.category_id) === String(activeVodCategory));
    if (q) list = list.filter(x => String(x.name || "").toLowerCase().includes(q));
    list = list.slice(0, 500);
    if (!list.length) { grid.innerHTML = emptyStateHTML("🎬", "Nenhum filme encontrado", ""); return; }
    grid.innerHTML = list.map(item => {
        const raw = item.name || `Filme ${item.stream_id}`;
        const poster = item.stream_icon || item.cover || "";
        return `<button class="media-card" type="button"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy">` : "🎬"}</div><strong>${escapeHTML(raw)}</strong><small style="display:block;padding:0 12px 12px;color:#c89585">${escapeHTML(enhancedCategoryName("movies", item.category_id))}</small></button>`;
    }).join("");
}

function renderEnhancedSeries() {
    const grid = document.getElementById("seriesGrid"); if (!grid) return;
    const q = (document.getElementById("seriesSearch")?.value || "").toLowerCase().trim();
    let list = seriesItemsEnhanced;
    if (activeSeriesCategory !== "all") list = list.filter(x => String(x.category_id) === String(activeSeriesCategory));
    if (q) list = list.filter(x => String(x.name || "").toLowerCase().includes(q));
    list = list.slice(0, 500);
    if (!list.length) { grid.innerHTML = emptyStateHTML("📚", "Nenhuma série encontrada", ""); return; }
    grid.innerHTML = list.map(item => {
        const raw = item.name || `Série ${item.series_id}`;
        const poster = item.cover || item.cover_big || "";
        return `<button class="media-card" type="button"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy">` : "📚"}</div><strong>${escapeHTML(raw)}</strong><small style="display:block;padding:0 12px 12px;color:#c89585">${escapeHTML(enhancedCategoryName("series", item.category_id))}</small></button>`;
    }).join("");
}

/* ==================== CONFIGURACOES ==================== */
function installPlayerSettings() {
    const settings = document.getElementById("settingsSection");
    if (!settings || document.getElementById("preferredPlayer")) return;
    const card = settings.querySelector(".settings-card") || settings;
    const box = document.createElement("div");
    box.style.cssText = "margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08)";
    box.innerHTML = `<h3 style="margin:0 0 12px">Player dos canais</h3>
        <div class="setting-row"><span>Abrir canais com</span><select id="preferredPlayer" style="min-width:220px;height:40px;border-radius:10px;border:1px solid rgba(255,130,60,.22);background:#260b07;color:#fff;padding:0 10px">
            <option value="web">Player Web (HLS / MPEG-TS)</option>
            <option value="vlc">VLC direto</option>
            <option value="m3u">VLC por arquivo .m3u</option>
            <option value="copy">Copiar URL do canal</option>
        </select></div>
        <p style="font-size:10px;color:#c89585;margin:10px 0 0">Se o servidor bloquear o navegador, use VLC direto ou arquivo .m3u.</p>`;
    card.appendChild(box);
    const select = document.getElementById("preferredPlayer");
    select.value = getPreferredPlayer();
    select.addEventListener("change", e => setPreferredPlayer(e.target.value));
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installPlayerSettings);
} else installPlayerSettings();

window.addEventListener("beforeunload", destroyEnhancedPlayers);
