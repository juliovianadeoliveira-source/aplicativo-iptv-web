/* IPTV PLAYER - GitHub Pages / Xtream Codes */
let hlsInstance = null;
let liveChannels = [];
let liveCategories = [];
let activeCategoryId = "all";
let activeSession = null;

document.addEventListener("DOMContentLoaded", () => {
    initPasswordToggle();
    initLogin();
    initNavigation();

    const logoutButton = document.getElementById("logoutButton");
    const changeAccount = document.getElementById("changeAccount");

    if (logoutButton) {
        const session = getSession();
        if (!session) {
            window.location.href = "index.html";
            return;
        }
        activeSession = session;
        setText("dashboardUsername", session.username);
        setText("serverAddress", session.server);
        setText("settingsServer", session.server);
        setText("settingsUsername", session.username);
        logoutButton.addEventListener("click", logout);
        if (changeAccount) changeAccount.addEventListener("click", logout);
        setupPlayer();
        setupChannelSearch();
        loadDashboardContent(session);
    }
});

function initPasswordToggle() {
    const button = document.getElementById("showPassword");
    const password = document.getElementById("password");
    if (!button || !password) return;
    button.addEventListener("click", () => {
        const visible = password.type === "text";
        password.type = visible ? "password" : "text";
        button.textContent = visible ? "👁" : "🙈";
    });
}

function initLogin() {
    const form = document.getElementById("loginForm");
    if (!form) return;
    if (getSession()) {
        window.location.href = "dashboard.html";
        return;
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        const server = document.getElementById("server").value.trim();
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        const remember = document.getElementById("remember").checked;
        const message = document.getElementById("loginMessage");
        const button = document.getElementById("loginButton");

        if (!server || !username || !password) {
            showMessage(message, "Preencha todos os campos.", false);
            return;
        }

        let parsed;
        try { parsed = new URL(server); }
        catch {
            showMessage(message, "Digite uma URL válida começando com http:// ou https://", false);
            return;
        }
        if (!["http:", "https:"].includes(parsed.protocol)) {
            showMessage(message, "Use HTTP ou HTTPS.", false);
            return;
        }

        const candidate = { server: parsed.origin, username, password, loggedAt: new Date().toISOString() };
        setLoginBusy(button, true);
        showMessage(message, "Testando conexão...", true);

        try {
            const tested = await testConnectionCandidates(candidate);
            candidate.server = tested.server;
            localStorage.removeItem("iptvSession");
            sessionStorage.removeItem("iptvSession");
            (remember ? localStorage : sessionStorage).setItem("iptvSession", JSON.stringify(candidate));
            showMessage(message, "Conectado. Abrindo player...", true);
            window.location.href = "dashboard.html";
        } catch (error) {
            showMessage(message, formatError(error), false);
            setLoginBusy(button, false);
        }
    });
}

async function testConnectionCandidates(session) {
    const original = String(session.server).replace(/\/+$/, "");
    const tries = [];
    const add = s => { if (s && !tries.includes(s)) tries.push(s); };

    if (/^http:\/\//i.test(original)) {
        add(original.replace(/^http:\/\//i, "https://"));
        add(original);
    } else {
        add(original);
        add(original.replace(/^https:\/\//i, "http://"));
    }

    let lastError;
    for (const server of tries) {
        try {
            const data = await xtreamRequest({ ...session, server }, "");
            validateAuthentication(data);
            return { server, data };
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("Servidor indisponível.");
}

function validateAuthentication(data) {
    if (!data || !data.user_info) throw new Error("Resposta inválida do servidor.");
    const info = data.user_info;
    const auth = String(info.auth ?? "");
    const status = String(info.status || "").toLowerCase();
    if (auth === "0" || ["disabled", "banned", "expired"].includes(status)) {
        if (status === "expired") throw new Error("Conta expirada.");
        if (status === "banned") throw new Error("Conta bloqueada.");
        throw new Error("Usuário ou senha recusados.");
    }
}

async function loadDashboardContent(session) {
    const channelsGrid = document.getElementById("channelsGrid");
    const moviesGrid = document.getElementById("moviesGrid");
    const seriesGrid = document.getElementById("seriesGrid");
    setConnectionStatus("Conectando...");

    try {
        const auth = await xtreamRequest(session, "");
        validateAuthentication(auth);

        const results = await Promise.allSettled([
            xtreamRequest(session, "get_live_categories"),
            xtreamRequest(session, "get_live_streams"),
            xtreamRequest(session, "get_vod_streams"),
            xtreamRequest(session, "get_series")
        ]);

        liveCategories = results[0].status === "fulfilled" && Array.isArray(results[0].value) ? results[0].value : [];
        liveChannels = results[1].status === "fulfilled" && Array.isArray(results[1].value) ? results[1].value : [];
        const movies = results[2].status === "fulfilled" && Array.isArray(results[2].value) ? results[2].value : [];
        const series = results[3].status === "fulfilled" && Array.isArray(results[3].value) ? results[3].value : [];

        renderLiveCategories();
        renderChannels(liveChannels, session);
        renderMovies(movies, session);
        renderSeries(series, session);
        setText("channelCount", liveChannels.length);
        setText("movieCount", movies.length);
        setText("seriesCount", series.length);
        setConnectionStatus("Conectado");
    } catch (error) {
        setConnectionStatus("Erro de conexão");
        if (channelsGrid) renderLoadError(channelsGrid, error, "canais");
        if (moviesGrid) renderLoadError(moviesGrid, error, "filmes");
        if (seriesGrid) renderLoadError(seriesGrid, error, "séries");
    }
}

async function xtreamRequest(session, action) {
    const base = String(session.server).replace(/\/+$/, "") + "/";
    const url = new URL("player_api.php", base);
    url.searchParams.set("username", session.username);
    url.searchParams.set("password", session.password);
    if (action) url.searchParams.set("action", action);

    let response;
    try {
        response = await fetch(url.toString(), { method: "GET", cache: "no-store", mode: "cors", credentials: "omit" });
    } catch (cause) {
        const error = new Error("Failed to fetch");
        error.cause = cause;
        throw error;
    }
    if (!response.ok) throw new Error(`Servidor respondeu HTTP ${response.status}.`);
    const text = await response.text();
    try { return JSON.parse(text); }
    catch { throw new Error("A API não retornou JSON válido."); }
}

function renderLiveCategories() {
    const panel = document.getElementById("liveCategories");
    if (!panel) return;

    const counts = new Map();
    liveChannels.forEach(ch => {
        const id = String(ch.category_id ?? "0");
        counts.set(id, (counts.get(id) || 0) + 1);
    });

    const folders = [{ category_id: "all", category_name: "Todos os canais" }, ...liveCategories];
    panel.innerHTML = folders.map(cat => {
        const id = String(cat.category_id);
        const count = id === "all" ? liveChannels.length : (counts.get(id) || 0);
        return `<button class="category-folder ${id === activeCategoryId ? "active" : ""}" type="button" data-category-id="${escapeAttribute(id)}" data-category-name="${escapeAttribute(cat.category_name || "Sem categoria")}"><span>📁</span><span>${escapeHTML(cat.category_name || "Sem categoria")}</span><span class="count">${count}</span></button>`;
    }).join("");

    panel.querySelectorAll(".category-folder").forEach(btn => {
        btn.addEventListener("click", () => {
            activeCategoryId = btn.dataset.categoryId;
            panel.querySelectorAll(".category-folder").forEach(x => x.classList.toggle("active", x === btn));
            setText("currentCategoryName", btn.dataset.categoryName);
            applyChannelFilters();
        });
    });
}

function renderChannels(channels, session) {
    const grid = document.getElementById("channelsGrid");
    if (!grid) return;
    if (!channels.length) {
        grid.innerHTML = emptyStateHTML("📺", "Nenhum canal encontrado", "O servidor não retornou canais.");
        return;
    }

    grid.innerHTML = channels.map(item => {
        const nameRaw = item.name || `Canal ${item.stream_id}`;
        const name = escapeHTML(nameRaw);
        const logo = item.stream_icon || "";
        const categoryId = String(item.category_id ?? "0");
        const categoryName = categoryNameById(categoryId);
        return `<button class="channel-item" type="button" data-name="${escapeAttribute(nameRaw.toLowerCase())}" data-category-id="${escapeAttribute(categoryId)}" data-stream-id="${escapeAttribute(item.stream_id)}" data-extension="${escapeAttribute(item.container_extension || "ts")}" data-title="${escapeAttribute(nameRaw)}"><div class="channel-logo">${logo ? `<img src="${escapeAttribute(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "📺"}</div><div class="channel-info"><strong>${name}</strong><span>${escapeHTML(categoryName)}</span></div><span class="channel-play">▶</span></button>`;
    }).join("");

    grid.querySelectorAll(".channel-item").forEach(item => {
        item.addEventListener("click", () => openLiveChannel(session, item.dataset.streamId, item.dataset.extension, item.dataset.title));
    });
    applyChannelFilters();
}

function categoryNameById(id) {
    const found = liveCategories.find(cat => String(cat.category_id) === String(id));
    return found ? (found.category_name || "Canal ao vivo") : "Canal ao vivo";
}

function applyChannelFilters() {
    const input = document.getElementById("channelSearch");
    const query = input ? input.value.toLowerCase().trim() : "";
    document.querySelectorAll(".channel-item").forEach(item => {
        const categoryOk = activeCategoryId === "all" || item.dataset.categoryId === activeCategoryId;
        const searchOk = !query || String(item.dataset.name || "").includes(query);
        item.style.display = categoryOk && searchOk ? "" : "none";
    });
}

function setupChannelSearch() {
    const input = document.getElementById("channelSearch");
    if (!input) return;
    input.addEventListener("input", applyChannelFilters);
}

function openLiveChannel(session, streamId, extension, title) {
    const base = String(session.server).replace(/\/+$/, "");
    const authPath = `${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(streamId)}`;
    const originalExt = String(extension || "ts").replace(/^\./, "").toLowerCase();
    const urls = [];
    const add = u => { if (u && !urls.includes(u)) urls.push(u); };

    // HLS primeiro: é o formato mais compatível com navegador + hls.js.
    add(`${base}/live/${authPath}.m3u8`);
    if (originalExt !== "m3u8") add(`${base}/live/${authPath}.${originalExt}`);

    // Se o servidor informado for HTTP/HTTPS, tenta a versão oposta também.
    const snapshot = [...urls];
    snapshot.forEach(u => {
        if (/^http:\/\//i.test(u)) add(u.replace(/^http:\/\//i, "https://"));
        else if (/^https:\/\//i.test(u)) add(u.replace(/^https:\/\//i, "http://"));
    });

    openPlayerCandidates(urls, title);
}

function renderMovies(movies, session) {
    const grid = document.getElementById("moviesGrid");
    if (!grid) return;
    if (!movies.length) { grid.innerHTML = emptyStateHTML("🎬", "Nenhum filme encontrado", "O servidor não retornou filmes."); return; }
    grid.innerHTML = movies.map(item => {
        const raw = item.name || `Filme ${item.stream_id}`;
        const poster = item.stream_icon || item.cover || "";
        const ext = String(item.container_extension || "mp4").replace(/^\./, "");
        const url = `${String(session.server).replace(/\/+$/, "")}/movie/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(item.stream_id)}.${ext}`;
        return `<button class="media-card" type="button" data-stream-url="${escapeAttribute(url)}" data-title="${escapeAttribute(raw)}"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "🎬"}</div><strong>${escapeHTML(raw)}</strong></button>`;
    }).join("");
    grid.querySelectorAll(".media-card").forEach(item => item.addEventListener("click", () => openPlayerCandidates(streamSchemeCandidates(item.dataset.streamUrl), item.dataset.title)));
}

function renderSeries(series, session) {
    const grid = document.getElementById("seriesGrid");
    if (!grid) return;
    if (!series.length) { grid.innerHTML = emptyStateHTML("📚", "Nenhuma série encontrada", "O servidor não retornou séries."); return; }
    grid.innerHTML = series.map(item => {
        const raw = item.name || `Série ${item.series_id}`;
        const poster = item.cover || item.cover_big || "";
        return `<button class="media-card series-card" type="button" data-series-id="${escapeAttribute(item.series_id)}" data-title="${escapeAttribute(raw)}"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "📚"}</div><strong>${escapeHTML(raw)}</strong></button>`;
    }).join("");
    grid.querySelectorAll(".series-card").forEach(item => item.addEventListener("click", () => loadSeriesEpisodes(session, item.dataset.seriesId, item.dataset.title)));
}

async function loadSeriesEpisodes(session, seriesId, title) {
    try {
        const base = String(session.server).replace(/\/+$/, "") + "/";
        const url = new URL("player_api.php", base);
        url.searchParams.set("username", session.username);
        url.searchParams.set("password", session.password);
        url.searchParams.set("action", "get_series_info");
        url.searchParams.set("series_id", seriesId);
        const response = await fetch(url.toString(), { cache: "no-store", mode: "cors", credentials: "omit" });
        if (!response.ok) throw new Error("Falha ao consultar episódios.");
        const data = await response.json();
        const episodes = Object.values(data.episodes || {}).flatMap(v => Array.isArray(v) ? v : []);
        if (!episodes.length) return alert("Nenhum episódio disponível.");
        const wantedText = prompt(`A série possui ${episodes.length} episódio(s). Digite o número:`, "1");
        if (wantedText === null) return;
        const wanted = Math.max(1, parseInt(wantedText, 10) || 1);
        const ep = episodes.find(x => Number(x.episode_num) === wanted) || episodes[wanted - 1] || episodes[0];
        const ext = String(ep.container_extension || "mp4").replace(/^\./, "");
        const stream = `${String(session.server).replace(/\/+$/, "")}/series/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(ep.id)}.${ext}`;
        openPlayerCandidates(streamSchemeCandidates(stream), `${title} - Episódio ${ep.episode_num || wanted}`);
    } catch (error) { alert(formatError(error)); }
}

function setupPlayer() {
    const modal = document.getElementById("playerModal");
    const close = document.getElementById("closePlayer");
    if (!modal || !close) return;
    close.addEventListener("click", closePlayer);
    modal.addEventListener("click", e => { if (e.target === modal) closePlayer(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closePlayer(); });
}

function streamSchemeCandidates(url) {
    const list = [];
    const add = u => { if (u && !list.includes(u)) list.push(u); };
    add(url);
    if (/^http:\/\//i.test(url)) add(url.replace(/^http:\/\//i, "https://"));
    else if (/^https:\/\//i.test(url)) add(url.replace(/^https:\/\//i, "http://"));
    return list;
}

function openPlayerCandidates(urls, title) {
    const modal = document.getElementById("playerModal");
    const video = document.getElementById("videoPlayer");
    if (!modal || !video || !urls.length) return;
    closePlayerMediaOnly();
    setText("playerTitle", title || "Reproduzindo");
    showPlayerError("");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    tryPlayback(urls, 0, video);
}

function tryPlayback(urls, index, video) {
    if (index >= urls.length) {
        showPlayerError("Não foi possível abrir este canal no navegador. Se o servidor fornecer apenas HTTP dentro do GitHub Pages (HTTPS), o Chrome bloqueia. Se houver HLS/HTTPS, o player já tenta automaticamente.");
        return;
    }

    const url = urls[index];
    const isHls = /\.m3u8(?:$|\?)/i.test(url);
    const next = () => {
        if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
        video.pause(); video.removeAttribute("src"); video.load();
        tryPlayback(urls, index + 1, video);
    };

    if (isHls && window.Hls && Hls.isSupported()) {
        hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 30 });
        let failed = false;
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => showPlayerError("Canal carregado. Clique no ▶ do vídeo para iniciar."));
        });
        hlsInstance.on(Hls.Events.ERROR, (_e, data) => {
            if (data && data.fatal && !failed) { failed = true; next(); }
        });
        return;
    }

    if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        const fail = () => next();
        video.addEventListener("error", fail, { once: true });
        video.src = url;
        video.play().catch(() => {});
        return;
    }

    const fail = () => next();
    video.addEventListener("error", fail, { once: true });
    video.src = url;
    video.load();
    video.play().catch(() => {
        if (video.readyState > 0) showPlayerError("Canal carregado. Clique no ▶ do vídeo para iniciar.");
        else next();
    });
}

function closePlayerMediaOnly() {
    const video = document.getElementById("videoPlayer");
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
}

function closePlayer() {
    closePlayerMediaOnly();
    const modal = document.getElementById("playerModal");
    showPlayerError("");
    if (modal) { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); }
}

function showPlayerError(message) { const el = document.getElementById("playerError"); if (el) el.textContent = message; }
function initNavigation() { document.querySelectorAll(".menu-item,.category-card").forEach(item => item.addEventListener("click", () => openSection(item.dataset.section))); }
function openSection(section) { if (!section) return; document.querySelectorAll(".content-section").forEach(x => x.classList.remove("active")); const selected = document.getElementById(`${section}Section`); if (selected) selected.classList.add("active"); document.querySelectorAll(".menu-item").forEach(x => x.classList.toggle("active", x.dataset.section === section)); }
function getSession() { const data = localStorage.getItem("iptvSession") || sessionStorage.getItem("iptvSession"); if (!data) return null; try { return JSON.parse(data); } catch { localStorage.removeItem("iptvSession"); sessionStorage.removeItem("iptvSession"); return null; } }
function logout() { localStorage.removeItem("iptvSession"); sessionStorage.removeItem("iptvSession"); closePlayer(); window.location.href = "index.html"; }
function setLoginBusy(button,busy) { if (!button) return; button.disabled=busy; button.style.opacity=busy?".65":""; button.style.cursor=busy?"wait":""; const span=button.querySelector("span"); if(span) span.textContent=busy?"CONECTANDO...":"ENTRAR"; }
function setText(id,value) { const el=document.getElementById(id); if(el) el.textContent=value; }
function setConnectionStatus(text) { const el=document.querySelector(".connection-status"); if(el) el.innerHTML=`<span></span>${escapeHTML(text)}`; }
function showMessage(el,text,success) { if(el){el.textContent=text;el.style.color=success?"#20d68b":"#ff7777";} }
function renderLoadError(grid,error,type) { grid.innerHTML=emptyStateHTML("⚠️",`Não foi possível carregar ${type}`,formatError(error)); }
function formatError(error) { const msg=String(error&&error.message?error.message:error||""); if(/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Não foi possível acessar o servidor pelo navegador. Pode ser CORS, conteúdo misto HTTP/HTTPS, SSL/DNS ou servidor fora do ar."; if(/HTTP 401|HTTP 403/.test(msg)) return "Servidor recusou a requisição. Confira usuário e senha."; if(/HTTP 404/.test(msg)) return "player_api.php não foi encontrado nessa URL."; return msg||"Falha ao carregar conteúdo."; }
function emptyStateHTML(icon,title,text) { return `<div class="empty-state"><div>${icon}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p></div>`; }
function escapeHTML(value) { return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;"); }
function escapeAttribute(value) { return escapeHTML(value); }
