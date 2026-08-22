/* =========================================================
   IPTV PLAYER - Web Player Xtream Codes
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

        const serverInput = document.getElementById("server");
        const usernameInput = document.getElementById("username");
        const passwordInput = document.getElementById("password");
        const rememberInput = document.getElementById("remember");
        const message = document.getElementById("loginMessage");
        const button = document.getElementById("loginButton");

        const server = serverInput.value.trim();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const remember = rememberInput.checked;

        if (!server || !username || !password) {
            showMessage(message, "Preencha todos os campos.", false);
            return;
        }

        let url;
        try {
            url = new URL(server);
        } catch {
            showMessage(message, "Digite uma URL válida. Exemplo: https://servidor.com", false);
            return;
        }

        if (!["http:", "https:"].includes(url.protocol)) {
            showMessage(message, "A URL precisa utilizar HTTP ou HTTPS.", false);
            return;
        }

        const candidate = {
            server: url.origin,
            username,
            password,
            loggedAt: new Date().toISOString()
        };

        setLoginBusy(button, true);
        showMessage(message, "Testando HTTP/HTTPS com o servidor...", true);

        try {
            const tested = await testConnectionCandidates(candidate);
            validateAuthentication(tested.data);
            candidate.server = tested.server;

            localStorage.removeItem("iptvSession");
            sessionStorage.removeItem("iptvSession");
            (remember ? localStorage : sessionStorage).setItem("iptvSession", JSON.stringify(candidate));

            showMessage(message, "Conectado com sucesso. Abrindo player...", true);
            window.location.href = "dashboard.html";
        } catch (error) {
            console.error("Login IPTV:", error);
            showMessage(message, formatError(error), false);
            setLoginBusy(button, false);
        }
    });
}

async function testConnectionCandidates(session) {
    const original = String(session.server).replace(/\/+$/, "");
    const candidates = [];

    const add = value => {
        if (value && !candidates.includes(value)) candidates.push(value);
    };

    if (window.location.protocol === "https:" && /^http:\/\//i.test(original)) {
        add(original.replace(/^http:\/\//i, "https://"));
        add(original);
    } else {
        add(original);
        if (/^https:\/\//i.test(original)) add(original.replace(/^https:\/\//i, "http://"));
        if (/^http:\/\//i.test(original)) add(original.replace(/^http:\/\//i, "https://"));
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

    throw lastError || new Error("Não foi possível conectar ao servidor por HTTP ou HTTPS.");
}

function validateAuthentication(data) {
    if (!data || typeof data !== "object") {
        throw new Error("O servidor respondeu, mas não retornou dados válidos.");
    }

    const info = data.user_info;
    if (!info) {
        throw new Error("A resposta não contém user_info. Confira URL, usuário e senha.");
    }

    const auth = String(info.auth ?? "");
    const status = String(info.status || "").toLowerCase();

    if (auth === "0" || ["disabled", "banned", "expired"].includes(status)) {
        if (status === "expired") throw new Error("Esta conta está expirada.");
        if (status === "banned") throw new Error("Esta conta está bloqueada pelo servidor.");
        throw new Error("Usuário ou senha recusados pelo servidor.");
    }
}

async function loadDashboardContent(session) {
    const channelsGrid = document.getElementById("channelsGrid");
    const moviesGrid = document.getElementById("moviesGrid");
    const seriesGrid = document.getElementById("seriesGrid");
    if (!channelsGrid) return;

    setConnectionStatus("Conectando...");

    try {
        const auth = await xtreamRequest(session, "");
        validateAuthentication(auth);

        const results = await Promise.allSettled([
            xtreamRequest(session, "get_live_streams"),
            xtreamRequest(session, "get_vod_streams"),
            xtreamRequest(session, "get_series")
        ]);

        const channels = results[0].status === "fulfilled" && Array.isArray(results[0].value) ? results[0].value : [];
        const movies = results[1].status === "fulfilled" && Array.isArray(results[1].value) ? results[1].value : [];
        const series = results[2].status === "fulfilled" && Array.isArray(results[2].value) ? results[2].value : [];

        if (results[0].status === "fulfilled") renderChannels(channels, session);
        else renderLoadError(channelsGrid, results[0].reason, "canais");

        if (moviesGrid) {
            if (results[1].status === "fulfilled") renderMovies(movies, session);
            else renderLoadError(moviesGrid, results[1].reason, "filmes");
        }

        if (seriesGrid) {
            if (results[2].status === "fulfilled") renderSeries(series, session);
            else renderLoadError(seriesGrid, results[2].reason, "séries");
        }

        setText("channelCount", channels.length);
        setText("movieCount", movies.length);
        setText("seriesCount", series.length);
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

    let response;
    try {
        response = await fetch(url.toString(), {
            method: "GET",
            cache: "no-store",
            mode: "cors",
            credentials: "omit"
        });
    } catch (error) {
        const wrapped = new Error("Failed to fetch");
        wrapped.cause = error;
        throw wrapped;
    }

    if (!response.ok) {
        throw new Error(`Servidor respondeu HTTP ${response.status}.`);
    }

    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("A resposta não é JSON. Confira se a URL aponta para um servidor Xtream Codes compatível.");
    }

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
        const category = item.category_name || "Canal ao vivo";
        return `<button class="channel-item" type="button" data-name="${escapeAttribute(name)}" data-stream-url="${escapeAttribute(liveUrl(session, item))}" data-title="${escapeAttribute(name)}"><div class="channel-logo">${logo ? `<img src="${escapeAttribute(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "📺"}</div><div class="channel-info"><strong>${name}</strong><span>${escapeHTML(category)}</span></div><span class="channel-play">▶</span></button>`;
    }).join("");

    grid.querySelectorAll(".channel-item").forEach(item => {
        item.addEventListener("click", () => openPlayer(item.dataset.streamUrl, item.dataset.title));
    });
}

function renderMovies(movies, session) {
    const grid = document.getElementById("moviesGrid");
    if (!grid) return;

    if (!movies.length) {
        grid.innerHTML = emptyStateHTML("🎬", "Nenhum filme encontrado", "O servidor não retornou filmes para esta conta.");
        return;
    }

    grid.innerHTML = movies.map(item => {
        const name = escapeHTML(item.name || `Filme ${item.stream_id}`);
        const poster = item.stream_icon || item.cover || "";
        const ext = String(item.container_extension || "mp4").replace(/^\./, "");
        const url = `${String(session.server).replace(/\/+$/, "")}/movie/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(item.stream_id)}.${ext}`;
        return `<button class="media-card" type="button" data-stream-url="${escapeAttribute(url)}" data-title="${escapeAttribute(name)}"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "🎬"}</div><strong>${name}</strong></button>`;
    }).join("");

    grid.querySelectorAll(".media-card").forEach(item => {
        item.addEventListener("click", () => openPlayer(item.dataset.streamUrl, item.dataset.title));
    });
}

function renderSeries(series, session) {
    const grid = document.getElementById("seriesGrid");
    if (!grid) return;

    if (!series.length) {
        grid.innerHTML = emptyStateHTML("📚", "Nenhuma série encontrada", "O servidor não retornou séries para esta conta.");
        return;
    }

    grid.innerHTML = series.map(item => {
        const name = escapeHTML(item.name || `Série ${item.series_id}`);
        const poster = item.cover || item.cover_big || "";
        return `<button class="media-card series-card" type="button" data-series-id="${escapeAttribute(item.series_id)}" data-title="${escapeAttribute(name)}"><div class="media-poster">${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "📚"}</div><strong>${name}</strong></button>`;
    }).join("");

    grid.querySelectorAll(".series-card").forEach(item => {
        item.addEventListener("click", () => loadSeriesEpisodes(session, item.dataset.seriesId, item.dataset.title));
    });
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
        const episodes = Object.values(data.episodes || {}).flatMap(value => Array.isArray(value) ? value : []);
        if (!episodes.length) {
            alert("Nenhum episódio disponível para esta série.");
            return;
        }

        const episodeNumber = prompt(`A série possui ${episodes.length} episódio(s). Digite o número do episódio que deseja abrir:`, "1");
        if (episodeNumber === null) return;

        const wanted = Math.max(1, parseInt(episodeNumber, 10) || 1);
        const episode = episodes.find(ep => Number(ep.episode_num) === wanted) || episodes[wanted - 1] || episodes[0];
        const ext = String(episode.container_extension || "mp4").replace(/^\./, "");
        const stream = `${String(session.server).replace(/\/+$/, "")}/series/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(episode.id)}.${ext}`;

        openPlayer(stream, `${title} - Episódio ${episode.episode_num || wanted}`);
    } catch (error) {
        console.error(error);
        alert(formatError(error));
    }
}

let hlsInstance = null;

function setupPlayer() {
    const modal = document.getElementById("playerModal");
    const close = document.getElementById("closePlayer");
    if (!modal || !close) return;

    close.addEventListener("click", closePlayer);
    modal.addEventListener("click", event => {
        if (event.target === modal) closePlayer();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closePlayer();
    });
}

function openPlayer(url, title) {
    const modal = document.getElementById("playerModal");
    const video = document.getElementById("videoPlayer");
    const titleElement = document.getElementById("playerTitle");
    const error = document.getElementById("playerError");
    if (!modal || !video || !url) return;

    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    video.pause();
    video.removeAttribute("src");
    video.load();

    if (titleElement) titleElement.textContent = title || "Reproduzindo";
    if (error) error.textContent = "";
    modal.classList.add("open");

    const candidates = streamCandidates(url);
    playStreamCandidates(candidates, 0, video);
}

function streamCandidates(url) {
    const original = String(url);
    const list = [];
    const add = value => { if (value && !list.includes(value)) list.push(value); };

    if (window.location.protocol === "https:" && /^http:\/\//i.test(original)) {
        add(original.replace(/^http:\/\//i, "https://"));
        add(original);
    } else {
        add(original);
        if (/^https:\/\//i.test(original)) add(original.replace(/^https:\/\//i, "http://"));
        if (/^http:\/\//i.test(original)) add(original.replace(/^http:\/\//i, "https://"));
    }
    return list;
}

function playStreamCandidates(candidates, index, video) {
    if (index >= candidates.length) {
        showPlayerError("Não foi possível abrir este canal. O servidor pode estar bloqueando CORS/conteúdo misto, o canal pode estar offline ou o formato pode não ser compatível com o navegador.");
        return;
    }

    const url = candidates[index];
    const next = () => {
        if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
        video.pause();
        video.removeAttribute("src");
        video.load();
        playStreamCandidates(candidates, index + 1, video);
    };

    const isHls = /\.m3u8(?:$|\?)/i.test(url);

    if (isHls && window.Hls && Hls.isSupported()) {
        hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true });
        let advanced = false;
        const fail = () => { if (!advanced) { advanced = true; next(); } };
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {
                showPlayerError("Canal carregado. Clique no botão ▶ do vídeo para iniciar.");
            });
        });
        hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
            if (data && data.fatal) fail();
        });
        return;
    }

    const onError = () => {
        video.removeEventListener("error", onError);
        next();
    };
    video.addEventListener("error", onError, { once: true });
    video.src = url;
    video.load();
    video.play().catch(() => {
        if (video.readyState > 0) {
            showPlayerError("Canal carregado. Clique no botão ▶ do vídeo para iniciar.");
        }
    });
}

function closePlayer() {
    const modal = document.getElementById("playerModal");
    const video = document.getElementById("videoPlayer");

    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
    }

    const error = document.getElementById("playerError");
    if (error) error.textContent = "";
    if (modal) modal.classList.remove("open");
}

function showPlayerError(message) {
    const el = document.getElementById("playerError");
    if (el) el.textContent = message;
}

function initNavigation() {
    document.querySelectorAll(".menu-item, .category-card").forEach(item => {
        item.addEventListener("click", () => openSection(item.dataset.section));
    });
}

function setupChannelSearch() {
    const input = document.getElementById("channelSearch");
    if (!input) return;

    input.addEventListener("input", event => {
        const value = event.target.value.toLowerCase().trim();
        document.querySelectorAll(".channel-item").forEach(item => {
            item.style.display = String(item.dataset.name || item.textContent).toLowerCase().includes(value) ? "" : "none";
        });
    });
}

function openSection(section) {
    if (!section) return;
    document.querySelectorAll(".content-section").forEach(item => item.classList.remove("active"));
    const selected = document.getElementById(`${section}Section`);
    if (selected) selected.classList.add("active");
    document.querySelectorAll(".menu-item").forEach(item => {
        item.classList.toggle("active", item.dataset.section === section);
    });
}

function getSession() {
    const data = localStorage.getItem("iptvSession") || sessionStorage.getItem("iptvSession");
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch {
        localStorage.removeItem("iptvSession");
        sessionStorage.removeItem("iptvSession");
        return null;
    }
}

function logout() {
    localStorage.removeItem("iptvSession");
    sessionStorage.removeItem("iptvSession");
    closePlayer();
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

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setConnectionStatus(text) {
    const el = document.querySelector(".connection-status");
    if (el) el.innerHTML = `<span></span>${escapeHTML(text)}`;
}

function showMessage(el, text, success) {
    if (!el) return;
    el.textContent = text;
    el.style.color = success ? "#20d68b" : "#ff7777";
}

function renderLoadError(grid, error, type) {
    grid.innerHTML = emptyStateHTML("⚠️", `Não foi possível carregar ${type}`, formatError(error));
}

function formatError(error) {
    const msg = String(error && error.message ? error.message : error || "");

    if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed")) {
        return "Não foi possível acessar o servidor. O player tentou HTTP/HTTPS quando possível. Pode ser CORS, conteúdo misto bloqueado pelo navegador, SSL/DNS inválido ou servidor fora do ar.";
    }

    if (/HTTP 401|HTTP 403/.test(msg)) {
        return "O servidor recusou a requisição. Confira usuário, senha e permissões da conta.";
    }

    if (/HTTP 404/.test(msg)) {
        return "player_api.php não foi encontrado nessa URL. Confira o endereço do servidor.";
    }

    if (/HTTP 5\d\d/.test(msg)) {
        return "O servidor respondeu com erro interno. Tente novamente ou verifique o servidor.";
    }

    return msg || "Falha ao carregar conteúdo.";
}

function emptyStateHTML(icon, title, text) {
    return `<div class="empty-state"><div>${icon}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p></div>`;
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
    return escapeHTML(value);
}
