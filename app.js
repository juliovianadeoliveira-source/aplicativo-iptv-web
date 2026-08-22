/* =========================================================
   IPTV PLAYER
   Controle da aplicação
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    const loginForm = document.getElementById("loginForm");

    const logoutButton =
        document.getElementById("logoutButton");

    const showPassword =
        document.getElementById("showPassword");

    const changeAccount =
        document.getElementById("changeAccount");


    /* =====================================================
       MOSTRAR / ESCONDER SENHA
       ===================================================== */

    if (showPassword) {

        showPassword.addEventListener("click", () => {

            const password =
                document.getElementById("password");

            if (!password) return;

            if (password.type === "password") {

                password.type = "text";

                showPassword.textContent = "🙈";

            } else {

                password.type = "password";

                showPassword.textContent = "👁";
            }

        });

    }


    /* =====================================================
       LOGIN
       ===================================================== */

    if (loginForm) {

        const savedSession =
            localStorage.getItem("iptvSession");

        if (savedSession) {

            try {

                const session =
                    JSON.parse(savedSession);

                if (
                    session &&
                    session.server &&
                    session.username
                ) {

                    window.location.href =
                        "dashboard.html";

                    return;
                }

            } catch (error) {

                localStorage.removeItem("iptvSession");

            }

        }


        loginForm.addEventListener("submit", (event) => {

            event.preventDefault();


            const server =
                document
                    .getElementById("server")
                    .value
                    .trim();

            const username =
                document
                    .getElementById("username")
                    .value
                    .trim();

            const password =
                document
                    .getElementById("password")
                    .value;

            const remember =
                document
                    .getElementById("remember")
                    .checked;

            const message =
                document.getElementById("loginMessage");


            if (!server || !username || !password) {

                message.textContent =
                    "Preencha todos os campos.";

                return;
            }


            /* Verifica URL */

            let validUrl;

            try {

                validUrl =
                    new URL(server);

            } catch {

                message.textContent =
                    "Digite uma URL válida.";

                return;
            }


            if (
                validUrl.protocol !== "http:" &&
                validUrl.protocol !== "https:"
            ) {

                message.textContent =
                    "A URL precisa utilizar HTTP ou HTTPS.";

                return;
            }


            /*
             * Sessão local.
             *
             * IMPORTANTE:
             * Em produção, a autenticação real deve ser
             * feita por um servidor/backend.
             */

            const session = {

                server:
                    validUrl.origin,

                username:
                    username,

                password:
                    password,

                loggedAt:
                    new Date().toISOString()

            };


            /*
             * Não salvar credenciais quando
             * "Manter conectado" estiver desligado.
             */

            if (remember) {

                localStorage.setItem(
                    "iptvSession",
                    JSON.stringify(session)
                );

            } else {

                sessionStorage.setItem(
                    "iptvSession",
                    JSON.stringify(session)
                );

            }


            message.style.color =
                "#20d68b";

            message.textContent =
                "Conectando...";


            setTimeout(() => {

                window.location.href =
                    "dashboard.html";

            }, 500);

        });

    }


    /* =====================================================
       DASHBOARD
       ===================================================== */

    if (logoutButton) {

        const session =
            getSession();


        if (!session) {

            window.location.href =
                "index.html";

            return;
        }


        const dashboardUsername =
            document.getElementById(
                "dashboardUsername"
            );

        const serverAddress =
            document.getElementById(
                "serverAddress"
            );

        const settingsServer =
            document.getElementById(
                "settingsServer"
            );

        const settingsUsername =
            document.getElementById(
                "settingsUsername"
            );


        if (dashboardUsername) {

            dashboardUsername.textContent =
                session.username;

        }


        if (serverAddress) {

            serverAddress.textContent =
                session.server;

        }


        if (settingsServer) {

            settingsServer.textContent =
                session.server;

        }


        if (settingsUsername) {

            settingsUsername.textContent =
                session.username;

        }


        logoutButton.addEventListener(
            "click",
            logout
        );

    }


    /* =====================================================
       TROCAR CONTA
       ===================================================== */

    if (changeAccount) {

        changeAccount.addEventListener(
            "click",
            () => {

                logout();

            }
        );

    }


    /* =====================================================
       MENU
       ===================================================== */

    const menuItems =
        document.querySelectorAll(
            ".menu-item"
        );

    menuItems.forEach(item => {

        item.addEventListener("click", () => {

            const section =
                item.dataset.section;

            openSection(section);

        });

    });


    /* =====================================================
       CARDS
       ===================================================== */

    const categoryCards =
        document.querySelectorAll(
            ".category-card"
        );

    categoryCards.forEach(card => {

        card.addEventListener("click", () => {

            const section =
                card.dataset.section;

            openSection(section);

        });

    });


    /* =====================================================
       PESQUISA
       ===================================================== */

    const channelSearch =
        document.getElementById(
            "channelSearch"
        );

    if (channelSearch) {

        channelSearch.addEventListener(
            "input",
            event => {

                const value =
                    event.target.value
                        .toLowerCase()
                        .trim();

                const channels =
                    document.querySelectorAll(
                        ".channel-item"
                    );

                channels.forEach(channel => {

                    const name =
                        channel.textContent
                            .toLowerCase();

                    channel.style.display =
                        name.includes(value)
                            ? ""
                            : "none";

                });

            }
        );

    }

});


/* =========================================================
   SESSÃO
   ========================================================= */

function getSession() {

    const local =
        localStorage.getItem(
            "iptvSession"
        );

    const temporary =
        sessionStorage.getItem(
            "iptvSession"
        );


    const data =
        local || temporary;


    if (!data) {

        return null;

    }


    try {

        return JSON.parse(data);

    } catch {

        localStorage.removeItem(
            "iptvSession"
        );

        sessionStorage.removeItem(
            "iptvSession"
        );

        return null;

    }

}


/* =========================================================
   SAIR
   ========================================================= */

function logout() {

    localStorage.removeItem(
        "iptvSession"
    );

    sessionStorage.removeItem(
        "iptvSession"
    );

    window.location.href =
        "index.html";

}


/* =========================================================
   ABRIR SEÇÃO
   ========================================================= */

function openSection(section) {

    const sections =
        document.querySelectorAll(
            ".content-section"
        );

    sections.forEach(item => {

        item.classList.remove(
            "active"
        );

    });


    const selected =
        document.getElementById(
            section + "Section"
        );


    if (selected) {

        selected.classList.add(
            "active"
        );

    }


    const menuItems =
        document.querySelectorAll(
            ".menu-item"
        );

    menuItems.forEach(item => {

        item.classList.remove(
            "active"
        );


        if (
            item.dataset.section ===
            section
        ) {

            item.classList.add(
                "active"
            );

        }

    });

}
