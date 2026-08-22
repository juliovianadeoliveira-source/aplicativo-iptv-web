/* IPTV PLAYER - otimizado para GitHub Pages / Xtream Codes */
let liveChannels = [];
let liveCategories = [];
let activeCategoryId = "";
let activeSession = null;
let moviesLoaded = false;
let seriesLoaded = false;
let hlsInstance = null;

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
        setText("settingsServer", session.server);
        setText("settingsUsername", session.username);

        logoutButton.addEventListener("click", logout);
        if (changeAccount) changeAccount.addEventListener("click", logout);

        setupChannelSearch();
        loadLiveContent(session);
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

        const candidate = {
            server: parsed.origin,
            username,
            password,
            loggedAt: new Date().toISOString()
        };

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
    const candidates = [];
    const add = value => { if (value && !candidates.includes(value)) candidates.push(value); };

    if (/^http:\/\//i.test(original)) {
        add(original.replace(/^http:\/\//i, "https://"));
        add(original);
    } else {
        add(original);
        add(original.replace(/^https:\/\//i, "http://"));
    }

    let lastError = null;
    for (const server of candidates) {
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

async function loadLiveContent(session) {
    setConnectionStatus("Conectando...");
    setMini("liveCategories", "Carregando pastas...");

    try {
        const auth = await xtreamRequest(session, "");
        validateAuthentication(auth);

        const [categoriesResult, channelsResult] = await Promise.allSettled([
            xtreamRequest(session, "get_live_categories"),
            xtreamRequest(session, "get_live_streams")
        ]);

        liveCategories = categoriesResult.status === "fulfilled" && Array.isArray(categoriesResult.value)
            ? categoriesResult.value : [];
        liveChannels = channelsResult.status === "fulfilled" && Array.isArray(channelsResult.value)
            ? channelsResult.value : [];

        setText("channelCount", liveChannels.length);
        setText("categoryCount", liveCategories.length);

        renderCategoryFolders();
        selectInitialCategory();
        setConnectionStatus("Conectado");
    } catch (error) {
        setConnectionStatus("Erro de conexão");
        setMini("liveCategories", formatError(error), true);
        setMini("channelsGrid", "Não foi possível carregar canais.", true);
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
        response = await fetch(url.toString(), {
            method: "GET",
            cache: "no-store",
            mode: "cors",
            credentials: "omit"
        });
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

function renderCategoryFolders() {
    const panel = document.getElementById("liveCategories");
    if (!panel) return;

    const counts = new Map();
    for (const channel of liveChannels) {
        const id = String(channel.category_id ?? "0");
        counts.set(id, (counts.get(id) || 0) + 1);
    }

    const folders = [
        { category_id: "all", category_name: "Todos os canais", count: liveChannels.length },
        ...liveCategories.map(cat => ({
            ...cat,
            count: counts.get(String(cat.category_id)) || 0
        })).filter(cat => cat.count > 0)
    ];

    panel.innerHTML = folders.map(cat => {
        const id = String(cat.category_id);
        return `<button class="category-folder" type="button" data-category-id="${escapeAttribute(id)}" data-category-name="${escapeAttribute(cat.category_name || "Sem categoria")}">
            <span class="folder-icon">${id === "all" ? "▦" : "📁"}</span>
            <span class="folder-name">${escapeHTML(cat.category_name || "Sem categoria")}</span>
            <span class="count">${cat.count || 0}</span>
        </button>`;
    }).join("");

    panel.querySelectorAll(".category-folder").forEach(button => {
        button.addEventListener("click", () => activateCategory(button.dataset.categoryId, button.dataset.categoryName));
    });
}

function selectInitialCategory() {
    const firstUseful = liveCategories.find(cat => liveChannels.some(ch => String(ch.category_id) === String(cat.category_id)));
    if (firstUseful) activateCategory(String(firstUseful.category_id), firstUseful.category_name || "Canais");
    else activateCategory("all", "Todos os canais");
}

function activateCategory(categoryId, categoryName) {
    activeCategoryId = String(categoryId);
    document.querySelectorAll(".category-folder").forEach(button => {
        button.classList.toggle("active", button.dataset.categoryId === activeCategoryId);
    });
    setText("currentCategoryName", categoryName || "Canais");
    renderVisibleChannels();
}

function renderVisibleChannels() {
    const grid = document.getElementById("channelsGrid");
    if (!grid) return;

    const input = document.getElementById("channelSearch");
    const query = input ? input.value.toLowerCase().trim() : "";

    let filtered = liveChannels;
    if (activeCategoryId && activeCategoryId !== "all") {
        filtered = filtered.filter(item => String(item.category_id) === activeCategoryId);
    }
    if (query) {
        filtered = filtered.filter(item => String(item.name || "").toLowerCase().includes(query));
    }

    const total = filtered.length;
    const maxRender = activeCategoryId === "all" ? 160 : 300;
    const visible = filtered.slice(0, maxRender);
    setText("visibleChannelCount", total);

    if (!visible.length) {
        grid.innerHTML = `<div class="empty-mini"><b>Nenhum canal</b>Nada encontrado nesta pasta.</div>`;
        return;
    }

    grid.innerHTML = visible.map(item => channelRowHTML(item)).join("") +
        (total > maxRender ? `<div class="empty-mini">Mostrando ${maxRender} de ${total}. Use a busca para localizar outros canais.</div>` : "");

    grid.querySelectorAll(".channel-row").forEach(row => {
        row.addEventListener("click", () => {
            grid.querySelectorAll(".channel-row").forEach(x => x.classList.remove("active"));
            row.classList.add("active");
            openLiveChannel(activeSession, row.dataset.streamId, row.dataset.extension, row.dataset.title);
        });
    });
}

function channelRowHTML(item) {
    const rawName = item.name || `Canal ${item.stream_id}`;
    const logo = item.stream_icon || "";
    const categoryName = categoryNameById(item.category_id);
    return `<button class="channel-row" type="button" data-stream-id="${escapeAttribute(item.stream_id)}" data-extension="${escapeAttribute(item.container_extension || "ts")}" data-title="${escapeAttribute(rawName)}">
        <span class="channel-thumb">${logo ? `<img src="${escapeAttribute(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "📺"}</span>
        <span class="channel-copy"><strong>${escapeHTML(rawName)}</strong><small>${escapeHTML(categoryName)}</small></span>
        <span class="mini-play">▶</span>
    </button>`;
}

function categoryNameById(id) {
    const found = liveCategories.find(cat => String(cat.category_id) === String(id));
    return found ? (found.category_name || "Canal ao vivo") : "Canal ao vivo";
}

function setupChannelSearch() {
    const input = document.getElementById("channelSearch");
    if (!input) return;
    let timer = null;
    input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(renderVisibleChannels, 120);
    });
}

/* Fallback. player-enhanced.js substitui esta função quando carregado. */
function openLiveChannel(session, streamId, extension, title) {
    const base = String(session.server).replace(/\/+$/, "");
    const url = `${base}/live/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(streamId)}.m3u8`;
    const video = document.getElementById("videoPlayer");
    const placeholder = document.getElementById("playerPlaceholder");
    setText("playerTitle", title || "Reproduzindo");
    setPlayerStatus("Abrindo canal...", "");
    if (placeholder) placeholder.style.display = "none";
    if (!video) return;
    video.src = url;
    video.play().catch(() => setPlayerStatus("Clique no botão ▶ do vídeo para iniciar.", ""));
}

function initNavigation() {
    document.querySelectorAll(".menu-item,.category-card").forEach(item => {
        item.addEventListener("click", () => openSection(item.dataset.section));
    });
}

function openSection(section) {
    if (!section) return;
    document.querySelectorAll(".content-section").forEach(item => item.classList.remove("active"));
    const selected = document.getElementById(`${section}Section`);
    if (selected) selected.classList.add("active");
    document.querySelectorAll(".menu-item").forEach(item => item.classList.toggle("active", item.dataset.section === section));

    if (section === "movies" && !moviesLoaded) loadMovies();
    if (section === "series" && !seriesLoaded) loadSeries();
}

async function loadMovies() {
    moviesLoaded = true;
    const grid = document.getElementById("moviesGrid");
    if (!grid || !activeSession) return;
    grid.innerHTML = `<div class="empty-state"><div>⏳</div><h3>Carregando filmes...</h3></div>`;
    try {
        const movies = await xtreamRequest(activeSession, "get_vod_streams");
        const list = Array.isArray(movies) ? movies : [];
        setText("movieCount", list.length);
        renderMovies(list.slice(0, 400));
    } catch (error) {
        grid.innerHTML = emptyStateHTML("⚠️", "Não foi possível carregar filmes", formatError(error));
    }
}

function renderMovies(movies) {
    const grid = document.getElementById("moviesGrid");
    if (!grid) return;
    if (!movies.length) { grid.innerHTML = emptyStateHTML("🎬", "Nenhum filme encontrado", ""); return; }
    grid.innerHTML = movies.map(item => {
        const raw = item.name || `Filme ${item.stream_id}`;
        const poster = item.stream_icon || item.cover || "";
        return `<button class="media-card" type="button"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy">` : "🎬"}</div><strong>${escapeHTML(raw)}</strong></button>`;
    }).join("");
}

async function loadSeries() {
    seriesLoaded = true;
    const grid = document.getElementById("seriesGrid");
    if (!grid || !activeSession) return;
    grid.innerHTML = `<div class="empty-state"><div>⏳</div><h3>Carregando séries...</h3></div>`;
    try {
        const series = await xtreamRequest(activeSession, "get_series");
        const list = Array.isArray(series) ? series : [];
        setText("seriesCount", list.length);
        renderSeries(list.slice(0, 400));
    } catch (error) {
        grid.innerHTML = emptyStateHTML("⚠️", "Não foi possível carregar séries", formatError(error));
    }
}

function renderSeries(series) {
    const grid = document.getElementById("seriesGrid");
    if (!grid) return;
    if (!series.length) { grid.innerHTML = emptyStateHTML("📚", "Nenhuma série encontrada", ""); return; }
    grid.innerHTML = series.map(item => {
        const raw = item.name || `Série ${item.series_id}`;
        const poster = item.cover || item.cover_big || "";
        return `<button class="media-card" type="button"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy">` : "📚"}</div><strong>${escapeHTML(raw)}</strong></button>`;
    }).join("");
}

function setPlayerStatus(text, type) {
    const el = document.getElementById("playerStatus");
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("error", "ok");
    if (type) el.classList.add(type);
}

function getSession() {
    const data = localStorage.getItem("iptvSession") || sessionStorage.getItem("iptvSession");
    if (!data) return null;
    try { return JSON.parse(data); }
    catch {
        localStorage.removeItem("iptvSession");
        sessionStorage.removeItem("iptvSession");
        return null;
    }
}

function logout() {
    localStorage.removeItem("iptvSession");
    sessionStorage.removeItem("iptvSession");
    window.location.href = "index.html";
}

function setLoginBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.style.opacity = busy ? ".65" : "";
    button.style.cursor = busy ? "wait" : "";
    const span = button.querySelector("span");
    if (span) span.textContent = busy ? "CONECTANDO..." : "ENTRAR";
}

function setConnectionStatus(text) {
    const el = document.querySelector(".connection-status");
    if (el) el.innerHTML = `<span></span>${escapeHTML(text)}`;
}

function setMini(id, text, error = false) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="empty-mini">${error ? "⚠️ " : ""}${escapeHTML(text)}</div>`;
}

function formatError(error) {
    const msg = String(error && error.message ? error.message : error || "");
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "O navegador não conseguiu acessar o servidor. Pode ser CORS, HTTP/HTTPS, SSL ou servidor fora do ar.";
    if (/HTTP 401|HTTP 403/.test(msg)) return "Servidor recusou a requisição. Confira usuário e senha.";
    if (/HTTP 404/.test(msg)) return "player_api.php não foi encontrado nessa URL.";
    return msg || "Falha ao carregar conteúdo.";
}

function showMessage(el, text, success) { if (el) { el.textContent = text; el.style.color = success ? "#20d68b" : "#ff7777"; } }
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function emptyStateHTML(icon, title, text) { return `<div class="empty-state"><div>${icon}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text || "")}</p></div>`; }
function escapeHTML(value) { return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;"); }
function escapeAttribute(value) { return escapeHTML(value); }