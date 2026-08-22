/* =========================================================
   IPTV PLAYER
   Login, conexão Xtream Codes e player
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    initPasswordToggle();
    initLogin();

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
        initDashboard(session);
    }

    if (changeAccount) {
        changeAccount.addEventListener("click", logout);
    }

    initNavigation();
});

/* =========================================================
   LOGIN
   ========================================================= */

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
    const loginForm = document.getElementById("loginForm");
    if (!loginForm) return;

    const savedSession = getSession();

    if (savedSession && savedSession.server && savedSession.username) {
        window.location.href = "dashboard.html";
        return;
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const serverInput = document.getElementById("server");
        const usernameInput = document.getElementById("username");
        const passwordInput = document.getElementById("password");
        const rememberInput = document.getElementById("remember");
        const message = document.getElementById("loginMessage");
        const button = loginForm.querySelector("button[type=submit]");

        const server = serverInput.value.trim();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const remember = rememberInput.checked;

        if (!server || !username || !password) {
            showMessage(message, "Preencha todos os campos.", false);
            return;
        }

        let validUrl;

        try {
            validUrl = new URL(server);
        } catch {
            showMessage(message, "Digite uma URL válida.", false);
            return;
        }

        if (!["http:", "https:"].includes(validUrl.protocol)) {
            showMessage(message, "A URL precisa utilizar HTTP ou HTTPS.", false);
            return;
        }

        const session = {
            server: validUrl.origin,
            username,
            password,
            loggedAt: new Date().toISOString()
        };

        setButtonLoading(button, true);
        showMessage(message, "Testando conexão com o servidor...", true);

        try {
            const response = await xtreamRequest(session, "");
            const userInfo = response && response.user_info;

            if (userInfo && userInfo.status && String(userInfo.status).toLowerCase() !== "active") {
                throw new Error("A conta não está ativa no servidor.");
            }

            saveSession(session, remember);
            showMessage(message, "Conectado! Carregando conteúdo...", true);

            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 350);
        } catch (error) {
            console.error("Erro de conexão:", error);

            /*
             * Alguns servidores IPTV não permitem CORS. Nesse caso o login
             * ainda pode ser salvo, mas o conteúdo só poderá ser carregado
             * se o servidor permitir requisições do navegador ou existir um
             * proxy/backend no mesmo domínio.
             */
            showMessage(message, formatConnectionError(error), false);
        } finally {
            setButtonLoading(button, false);
        }
    });
}

function saveSession(session, remember) {
    localStorage.removeItem("iptvSession");
    sessionStorage.removeItem("iptvSession");

    const storage = remember ? localStorage : sessionStorage;
    storage.setItem("iptvSession", JSON.stringify(session));
}

/* =========================================================
   DASHBOARD / CONTEÚDO
   ========================================================= */

async function initDashboard(session) {
    const channelsGrid = document.getElementById("channelsGrid");
    if (!channelsGrid) return;

    setupPlayer();
    setupChannelSearch();

    await loadDashboardContent(session);
}

async function loadDashboardContent(session) {
    const channelsGrid = document.getElementById("channelsGrid");
    const moviesGrid = document.getElementById("moviesGrid");
    const seriesGrid = document.getElementById("seriesGrid");

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

        setText("channelCount", String(channelList.length));
        setText("movieCount", String(movieList.length));
        setText("seriesCount", String(seriesList.length));

        if (!channelList.length && !movieList.length && !seriesList.length) {
            setConnectionStatus("Conectado, sem conteúdo");
        } else {
            setConnectionStatus("Conectado");
        }
    } catch (error) {
        console.error("Erro ao carregar conteúdo:", error);
        setConnectionStatus("Erro de conexão");
        renderLoadError(channelsGrid, error);
        if (moviesGrid) renderLoadError(moviesGrid, error, "Filmes");
        if (seriesGrid) renderLoadError(seriesGrid, error, "Séries");
    }
}

async function xtreamRequest(session, action) {
    const base = normalizeServer(session.server);
    const url = new URL("player_api.php", base + "/");

    url.searchParams.set("username", session.username);
    url.searchParams.set("password", session.password);

    if (action) {
        url.searchParams.set("action", action);
    }

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: { "Accept": "application/json" },
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(`Servidor respondeu HTTP ${response.status}.`);
    }

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("A resposta do servidor não é um JSON válido. Verifique se a URL é um servidor Xtream Codes.");
    }

    if (data && data.user_info && String(data.user_info.status || "").toLowerCase() === "disabled") {
        throw new Error("Usuário ou senha recusados pelo servidor.");
    }

    if (data && data.error) {
        throw new Error(String(data.error));
    }

    return data;
}

function normalizeServer(server) {
    return String(server || "").replace(/\/+$/, "") + "/";
}

/* =========================================================
   CANAIS
   ========================================================= */

function renderChannels(channels, session) {
    const grid = document.getElementById("channelsGrid");
    if (!grid) return;

    if (!channels.length) {
        grid.innerHTML = emptyStateHTML("📺", "Nenhum canal encontrado", "O servidor não retornou canais ao vivo para esta conta.");
        return;
    }

    grid.innerHTML = channels.map(channel => {
        const name = escapeHTML(channel.name || `Canal ${channel.stream_id}`);
        const logo = channel.stream_icon || "";
        const streamUrl = buildLiveUrl(session, channel);

        return `
            <button class="channel-item" type="button"
                data-name="${name}"
                data-stream-url="${escapeAttribute(streamUrl)}"
                data-title="${name}">
                <div class="channel-logo">
                    ${logo ? `<img src="${escapeAttribute(logo)}" alt="" loading="lazy" onerror="this.style.display='none'">` : "📺"}
                </div>
                <div class="channel-info">
                    <strong>${name}</strong>
                    <span>${escapeHTML(channel.category_name || "Canal ao vivo")}</span>
                </div>
                <span class="channel-play">▶</span>
            </button>
        `;
    }).join("");

    grid.querySelectorAll(".channel-item").forEach(item => {
        item.addEventListener("click", () => {
            openPlayer(item.dataset.streamUrl, item.dataset.title);
        });
    });
}

function buildLiveUrl(session, channel) {
    const extension = String(channel.container_extension || "m3u8").replace(/^\./, "");
    return `${normalizeServer(session.server)}live/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(channel.stream_id)}.${extension}`;
}

/* =========================================================
   FILMES
   ========================================================= */

function renderMovies(movies, session) {
    const grid = document.getElementById("moviesGrid");
    if (!grid) return;

    if (!movies.length) {
        grid.innerHTML = emptyStateHTML("🎬", "Nenhum filme encontrado", "O servidor não retornou filmes para esta conta.");
        return;
    }

    grid.innerHTML = movies.map(movie => {
        const name = escapeHTML(movie.name || `Filme ${movie.stream_id}`);
        const poster = movie.stream_icon || movie.cover || "";
        const extension = String(movie.container_extension || "mp4").replace(/^\./, "");
        const url = `${normalizeServer(session.server)}movie/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(movie.stream_id)}.${extension}`;

        return `
            <button class="media-card" type="button"
                data-stream-url="${escapeAttribute(url)}"
                data-title="${name}">
                <div class="media-poster">
                    ${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy" onerror="this.style.display='none'">` : "🎬"}
                </div>
                <strong>${name}</strong>
            </button>
        `;
    }).join("");

    grid.querySelectorAll(".media-card").forEach(item => {
        item.addEventListener("click", () => {
            openPlayer(item.dataset.streamUrl, item.dataset.title);
        });
    });
}

/* =========================================================
   SÉRIES
   ========================================================= */

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

        return `
            <button class="media-card series-card" type="button"
                data-series-id="${escapeAttribute(item.series_id)}"
                data-title="${name}">
                <div class="media-poster">
                    ${poster ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy" onerror="this.style.display='none'">` : "📚"}
                </div>
                <strong>${name}</strong>
            </button>
        `;
    }).join("");

    grid.querySelectorAll(".series-card").forEach(item => {
        item.addEventListener("click", () => {
            loadSeriesEpisodes(session, item.dataset.seriesId, item.dataset.title);
        });
    });
}

async function loadSeriesEpisodes(session, seriesId, title) {
    try {
        const data = await xtreamRequestWithAction(session, "get_series_info", "series_id", seriesId);
        const episodes = flattenEpisodes(data && data.episodes);

        if (!episodes.length) {
            alert("Nenhum episódio disponível para esta série.");
            return;
        }

        const first = episodes[0];
        const url = `${normalizeServer(session.server)}series/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(first.id)}.${String(first.container_extension || "mp4").replace(/^\./, "")}`;
        openPlayer(url, `${title} - Episódio ${first.episode_num || 1}`);
    } catch (error) {
        console.error(error);
        alert("Não foi possível carregar os episódios desta série.");
    }
}

async function xtreamRequestWithAction(session, action, parameter, value) {
    const base = normalizeServer(session.server);
    const url = new URL("player_api.php", base);

    url.searchParams.set("username", session.username);
    url.searchParams.set("password", session.password);
    url.searchParams.set("action", action);
    url.searchParams.set(parameter, value);

    const response = await fetch(url.toString(), { cache: "no-store" });

    if (!response.ok) {
        throw new Error(`Servidor respondeu HTTP ${response.status}.`);
    }

    return response.json();
}

function flattenEpisodes(episodes) {
    if (!episodes || typeof episodes !== "object") return [];

    return Object.values(episodes).flatMap(value => Array.isArray(value) ? value : []);
}

/* =========================================================
   PLAYER
   ========================================================= */

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
    const playerTitle = document.getElementById("playerTitle");
    const playerError = document.getElementById("playerError");

    if (!modal || !video) return;

    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    video.pause();
    video.removeAttribute("src");
    video.load();

    if (playerTitle) playerTitle.textContent = title || "Reproduzindo";
    if (playerError) playerError.textContent = "";

    modal.classList.add("open");

    const isHls = /\.m3u8(?:$|\?)/i.test(url);

    if (isHls && window.Hls && Hls.isSupported()) {
        hlsInstance = new Hls({
            enableWorker: true,
            lowLatencyMode: true
        });

        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {});
        });

        hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
            if (data && data.fatal) {
                showPlayerError("Não foi possível reproduzir esta transmissão. Verifique se o canal está online e se o servidor permite acesso pelo navegador.");
            }
        });

        return;
    }

    if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.addEventListener("loadedmetadata", () => {
            video.play().catch(() => {});
        }, { once: true });
        return;
    }

    video.src = url;
    video.play().catch(() => {
        showPlayerError("O navegador não conseguiu iniciar este vídeo. Tente novamente ou use um stream HLS (.m3u8) compatível.");
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

    if (modal) modal.classList.remove("open");
}

function showPlayerError(message) {
    const error = document.getElementById("playerError");
    if (error) error.textContent = message;
}

/* =========================================================
   NAVEGAÇÃO / PESQUISA
   ========================================================= */

function initNavigation() {
    document.querySelectorAll(".menu-item, .category-card").forEach(item => {
        item.addEventListener("click", () => {
            openSection(item.dataset.section);
        });
    });
}

function setupChannelSearch() {
    const search = document.getElementById("channelSearch");
    if (!search) return;

    search.addEventListener("input", event => {
        const value = event.target.value.toLowerCase().trim();

        document.querySelectorAll(".channel-item").forEach(channel => {
            const name = String(channel.dataset.name || channel.textContent).toLowerCase();
            channel.style.display = name.includes(value) ? "" : "none";
        });
    });
}

function openSection(section) {
    document.querySelectorAll(".content-section").forEach(item => {
        item.classList.remove("active");
    });

    const selected = document.getElementById(`${section}Section`);
    if (selected) selected.classList.add("active");

    document.querySelectorAll(".menu-item").forEach(item => {
        item.classList.toggle("active", item.dataset.section === section);
    });
}

/* =========================================================
   UTILITÁRIOS
   ========================================================= */

function getSession() {
    const local = localStorage.getItem("iptvSession");
    const temporary = sessionStorage.getItem("iptvSession");
    const data = local || temporary;

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

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function setConnectionStatus(text) {
    const element = document.querySelector(".connection-status");
    if (!element) return;
    element.innerHTML = `<span></span>${escapeHTML(text)}`;
}

function showMessage(element, text, success) {
    if (!element) return;
    element.textContent = text;
    element.style.color = success ? "#20d68b" : "#ff7777";
}

function setButtonLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.dataset.originalText ||= button.textContent;
    button.querySelector("span")?.replaceChildren(document.createTextNode(loading ? "CONECTANDO..." : "ENTRAR"));
}

function formatConnectionError(error) {
    const message = String(error && error.message ? error.message : error);

    if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
        return "Não foi possível acessar o servidor. Verifique HTTPS/CORS e se a URL é um servidor Xtream Codes.";
    }

    return message || "Falha ao conectar ao servidor.";
}

function renderLoadError(grid, error, type = "Canais") {
    if (!grid) return;

    const message = formatConnectionError(error);

    grid.innerHTML = emptyStateHTML(
        "⚠️",
        `Não foi possível carregar ${type.toLowerCase()}`,
        message
    );
}

function emptyStateHTML(icon, title, text) {
    return `
        <div class="empty-state">
            <div>${icon}</div>
            <h3>${escapeHTML(title)}</h3>
            <p>${escapeHTML(text)}</p>
        </div>
    `;
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
    return escapeHTML(value);
}
