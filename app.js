/* =========================================================
   IPTV PLAYER - aplicação e reprodução
   ========================================================= */
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
        setText("dashboardUsername", session.username);
        setText("serverAddress", session.server);
        setText("settingsServer", session.server);
        setText("settingsUsername", session.username);
        logoutButton.addEventListener("click", logout);
        setupPlayer();
        setupChannelSearch();
        loadDashboardContent(session);
    }

    if (changeAccount) changeAccount.addEventListener("click", logout);
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
    form.addEventListener("submit", event => {
        event.preventDefault();
        const server = document.getElementById("server").value.trim();
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        const remember = document.getElementById("remember").checked;
        const message = document.getElementById("loginMessage");
        if (!server || !username || !password) {
            showMessage(message, "Preencha todos os campos.", false);
            return;
        }
        let url;
        try { url = new URL(server); } catch {
            showMessage(message, "Digite uma URL válida.", false);
            return;
        }
        if (!["http:", "https:"].includes(url.protocol)) {
            showMessage(message, "A URL precisa utilizar HTTP ou HTTPS.", false);
            return;
        }
        const session = { server: url.origin, username, password, loggedAt: new Date().toISOString() };
        localStorage.removeItem("iptvSession");
        sessionStorage.removeItem("iptvSession");
        (remember ? localStorage : sessionStorage).setItem("iptvSession", JSON.stringify(session));
        showMessage(message, "Conectando...", true);
        setTimeout(() => { window.location.href = "dashboard.html"; }, 300);
    });
}

async function loadDashboardContent(session) {
    const channelsGrid = document.getElementById("channelsGrid");
    const moviesGrid = document.getElementById("moviesGrid");
    const seriesGrid = document.getElementById("seriesGrid");
    if (!channelsGrid) return;
    setConnectionStatus("Conectando...");
    try {
        const [channels, movies, series] = await Promise.all([
            xtreamRequest(session, "get_live_streams"),
            xtreamRequest(session, "get_vod_streams"),
            xtreamRequest(session, "get_series")
        ]);
        const channelList = Array.isArray(channels) ? channels : [];
        const movieList = Array.isArray(movies) ? movies : [];
        const seriesList = Array.isArray(series) ? series : [];
        renderChannels(channelList, session);
        renderMovies(movieList, session);
        renderSeries(seriesList, session);
        setText("channelCount", channelList.length);
        setText("movieCount", movieList.length);
        setText("seriesCount", seriesList.length);
        setConnectionStatus("Conectado");
    } catch (error) {
        console.error("IPTV:", error);
        setConnectionStatus("Erro de conexão");
        renderLoadError(channelsGrid, error, "canais");
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
    const response = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error(`Servidor respondeu HTTP ${response.status}.`);
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch {
        throw new Error("A resposta não é JSON. A URL informada precisa apontar para um servidor Xtream Codes.");
    }
    if (data && data.user_info && String(data.user_info.status || "").toLowerCase() === "disabled") throw new Error("Usuário ou senha recusados pelo servidor.");
    return data;
}

function liveUrl(session, item) {
    const ext = String(item.container_extension || "m3u8").replace(/^\./, "");
    return `${String(session.server).replace(/\/+$/, "")}/live/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(item.stream_id)}.${ext}`;
}

function renderChannels(channels, session) {
    const grid = document.getElementById("channelsGrid");
    if (!grid) return;
    if (!channels.length) {
        grid.innerHTML = emptyStateHTML("📺", "Nenhum canal encontrado", "O servidor não retornou canais ao vivo para esta conta.");
        return;
    }
    grid.innerHTML = channels.map(item => {
        const name = escapeHTML(item.name || `Canal ${item.stream_id}`);
        const logo = item.stream_icon || "";
        return `<button class="channel-item" type="button" data-name="${name}" data-stream-url="${escapeAttribute(liveUrl(session,item))}" data-title="${name}"><div class="channel-logo">${logo ? `<img src="${escapeAttribute(logo)}" alt="" loading="lazy">` : "📺"}</div><div class="channel-info"><strong>${name}</strong><span>${escapeHTML(item.category_name || "Canal ao vivo")}</span></div><span class="channel-play">▶</span></button>`;
    }).join("");
    grid.querySelectorAll(".channel-item").forEach(item => item.addEventListener("click", () => openPlayer(item.dataset.streamUrl, item.dataset.title)));
}

function renderMovies(movies, session) {
    const grid = document.getElementById("moviesGrid");
    if (!grid) return;
    if (!movies.length) { grid.innerHTML = emptyStateHTML("🎬", "Nenhum filme encontrado", "O servidor não retornou filmes para esta conta."); return; }
    grid.innerHTML = movies.map(item => {
        const name = escapeHTML(item.name || `Filme ${item.stream_id}`);
        const poster = item.stream_icon || item.cover || "";
        const ext = String(item.container_extension || "mp4").replace(/^\./, "");
        const url = `${String(session.server).replace(/\/+$/, "")}/movie/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(item.stream_id)}.${ext}`;
        return `<button class="media-card" type="button" data-stream-url="${escapeAttribute(url)}" data-title="${name}"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy">` : "🎬"}</div><strong>${name}</strong></button>`;
    }).join("");
    grid.querySelectorAll(".media-card").forEach(item => item.addEventListener("click", () => openPlayer(item.dataset.streamUrl, item.dataset.title)));
}

function renderSeries(series, session) {
    const grid = document.getElementById("seriesGrid");
    if (!grid) return;
    if (!series.length) { grid.innerHTML = emptyStateHTML("📚", "Nenhuma série encontrada", "O servidor não retornou séries para esta conta."); return; }
    grid.innerHTML = series.map(item => {
        const name = escapeHTML(item.name || `Série ${item.series_id}`);
        const poster = item.cover || item.cover_big || "";
        return `<button class="media-card series-card" type="button" data-series-id="${escapeAttribute(item.series_id)}" data-title="${name}"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy">` : "📚"}</div><strong>${name}</strong></button>`;
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
        const response = await fetch(url.toString(), { cache: "no-store" });
        if (!response.ok) throw new Error("Falha ao consultar episódios.");
        const data = await response.json();
        const episodes = Object.values(data.episodes || {}).flatMap(v => Array.isArray(v) ? v : []);
        if (!episodes.length) { alert("Nenhum episódio disponível para esta série."); return; }
        const ep = episodes[0];
        const ext = String(ep.container_extension || "mp4").replace(/^\./, "");
        const stream = `${String(session.server).replace(/\/+$/, "")}/series/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(ep.id)}.${ext}`;
        openPlayer(stream, `${title} - Episódio ${ep.episode_num || 1}`);
    } catch (error) { console.error(error); alert("Não foi possível carregar os episódios desta série."); }
}

let hlsInstance = null;
function setupPlayer() {
    const modal = document.getElementById("playerModal");
    const close = document.getElementById("closePlayer");
    if (!modal || !close) return;
    close.addEventListener("click", closePlayer);
    modal.addEventListener("click", e => { if (e.target === modal) closePlayer(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closePlayer(); });
}

function openPlayer(url, title) {
    const modal = document.getElementById("playerModal");
    const video = document.getElementById("videoPlayer");
    const titleElement = document.getElementById("playerTitle");
    const error = document.getElementById("playerError");
    if (!modal || !video) return;
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    video.pause(); video.removeAttribute("src"); video.load();
    if (titleElement) titleElement.textContent = title || "Reproduzindo";
    if (error) error.textContent = "";
    modal.classList.add("open");
    const isHls = /\.m3u8(?:$|\?)/i.test(url);
    if (isHls && window.Hls && Hls.isSupported()) {
        hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hlsInstance.on(Hls.Events.ERROR, (_event, data) => { if (data && data.fatal) showPlayerError("Não foi possível reproduzir esta transmissão. Verifique se o canal está online e se o servidor permite acesso pelo navegador."); });
        return;
    }
    if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.addEventListener("loadedmetadata", () => video.play().catch(() => {}), { once: true });
        return;
    }
    video.src = url;
    video.play().catch(() => showPlayerError("O navegador não iniciou o vídeo. Verifique o formato e o acesso do servidor."));
}

function closePlayer() {
    const modal = document.getElementById("playerModal");
    const video = document.getElementById("videoPlayer");
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
    if (modal) modal.classList.remove("open");
}
function showPlayerError(message) { const el = document.getElementById("playerError"); if (el) el.textContent = message; }
function initNavigation() { document.querySelectorAll(".menu-item, .category-card").forEach(item => item.addEventListener("click", () => openSection(item.dataset.section))); }
function setupChannelSearch() { const input = document.getElementById("channelSearch"); if (!input) return; input.addEventListener("input", e => { const value = e.target.value.toLowerCase().trim(); document.querySelectorAll(".channel-item").forEach(item => item.style.display = String(item.dataset.name || item.textContent).toLowerCase().includes(value) ? "" : "none"); }); }
function openSection(section) { document.querySelectorAll(".content-section").forEach(item => item.classList.remove("active")); const selected = document.getElementById(`${section}Section`); if (selected) selected.classList.add("active"); document.querySelectorAll(".menu-item").forEach(item => item.classList.toggle("active", item.dataset.section === section)); }
function getSession() { const data = localStorage.getItem("iptvSession") || sessionStorage.getItem("iptvSession"); if (!data) return null; try { return JSON.parse(data); } catch { localStorage.removeItem("iptvSession"); sessionStorage.removeItem("iptvSession"); return null; } }
function logout() { localStorage.removeItem("iptvSession"); sessionStorage.removeItem("iptvSession"); closePlayer(); window.location.href = "index.html"; }
function setText(id,value) { const el=document.getElementById(id); if(el) el.textContent=value; }
function setConnectionStatus(text) { const el=document.querySelector(".connection-status"); if(el) el.innerHTML=`<span></span>${escapeHTML(text)}`; }
function showMessage(el,text,success) { if(el){el.textContent=text;el.style.color=success?"#20d68b":"#ff7777";} }
function renderLoadError(grid,error,type){grid.innerHTML=emptyStateHTML("⚠️",`Não foi possível carregar ${type}`,formatError(error));}
function formatError(error){const msg=String(error&&error.message?error.message:error);if(msg.includes("Failed to fetch")||msg.includes("NetworkError"))return "O navegador bloqueou a conexão (CORS) ou o servidor está inacessível. O servidor precisa permitir acesso do navegador.";return msg||"Falha ao carregar conteúdo.";}
function emptyStateHTML(icon,title,text){return `<div class="empty-state"><div>${icon}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p></div>`;}
function escapeHTML(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;");}
function escapeAttribute(value){return escapeHTML(value);}
