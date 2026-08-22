# IPTV Player Web

Web Player IPTV para GitHub Pages, com login Xtream Codes, organização por categorias e reprodução no navegador.

## Arquivos principais

- `index.html` — tela de login
- `dashboard.html` — painel principal e player
- `style.css` — estilos globais
- `app.js` — login, API, categorias, canais, filmes e séries
- `player-enhanced.js` — reprodução HLS/MPEG-TS e tentativas de portas/HTTPS
- `config.js` — configurações gerais do aplicativo
- `manifest.webmanifest` — manifesto PWA
- `favicon.svg` — ícone do aplicativo
- `404.html` — página personalizada de erro

## Recursos

- Login por URL, usuário e senha
- API Xtream Codes (`player_api.php`)
- Canais ao vivo por categorias
- Busca de canais
- Filmes e séries
- Reprodução HLS com `hls.js`
- Reprodução MPEG-TS com `mpegts.js`
- Tentativa automática HTTP/HTTPS quando possível
- Layout responsivo
- Compatível com GitHub Pages

## Limitações do navegador

GitHub Pages roda em HTTPS. Se o servidor IPTV fornecer somente streams HTTP, o navegador pode bloquear a reprodução por Mixed Content. A API e os streams também precisam permitir acesso pelo navegador quando CORS for exigido.

## Publicação

O projeto pode ser publicado diretamente pela branch `main` usando GitHub Pages.
