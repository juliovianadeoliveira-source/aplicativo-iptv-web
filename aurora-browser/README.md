# Aurora 0.1.0 — prévia para Windows e Android

Aplicativo de navegação com abas, barra de endereço, voltar, avançar, atualizar, início e busca de sites, imagens, vídeos, notícias e mapas. Marca pública: **Aurora**. Não é afiliado ao Google ou ao Chrome.

## Privacidade e limitações reais

- Bloqueio básico de requisições de subrecursos por uma lista embarcada de domínios. Não é equivalente a um bloqueador completo com EasyList nem protege contra todo fingerprinting.
- Sem SDK de analytics ou gravação de buscas no Supabase.
- Windows: sessão em memória com cache desativado e perfil temporário. O perfil é removido no encerramento normal. Um encerramento forçado pode deixar resíduos no diretório temporário do sistema.
- Android: cookies de terceiros bloqueados; cache, cookies e armazenamento de sites são limpos no início, ao limpar sessão e ao usar Fechar Aurora. Encerramentos pelo sistema podem deixar resíduos até a próxima inicialização. WebView e sistema operacional podem manter dados técnicos.
- Não há histórico persistente, favoritos persistentes ou senhas salvas. Histórico de voltar/avançar existe durante a sessão.
- Localização, câmera, microfone, notificações, downloads e envio de arquivos não são permitidos nesta prévia.
- Não é VPN nem Tor e não oculta o IP. Sites, buscadores, provedor de internet e serviços de hospedagem podem manter registros próprios.
- DuckDuckGo é o buscador padrão. Google é opcional e recebe as pesquisas quando escolhido.
- Windows utiliza Electron/Chromium. Android utiliza Android System WebView e depende das atualizações desse componente no aparelho.
- HTTP explicitamente digitado é permitido e não é criptografado. HTTPS é o padrão para domínios sem esquema; certificados inválidos não são ignorados.
- Alguns sites com DRM, login restrito ou recursos que exigem permissões podem não funcionar nesta versão.

## Instalação e builds

O workflow `Build Aurora Apps` compila instalador e executável portátil para Windows x64 e APK de prévia para Android 8 ou superior. Gera checksums SHA-256 e publica uma prévia na release `aurora-v0.1.0` quando os dois builds passam.

Windows ainda não tem certificado de assinatura de código. O APK é assinado com chave de debug do runner, para testes; builds posteriores podem exigir desinstalação antes de instalar. Assinatura estável de produção e atualização automática ainda não estão implementadas. O botão de atualização da página recarrega o site, não instala uma nova versão do navegador.

## Desenvolvimento

```sh
cd aurora-browser/desktop
npm ci
npm test
npm start
```

Build Windows: `npm run dist` em Windows. Build Android: Gradle 8.10.2, JDK 17, SDK 35; `gradle assembleDebug` em `aurora-browser/android`.

`shared/trackers.txt` é copiado para o aplicativo desktop e para os assets Android antes do build. A função Supabase `aurora-release-info` entrega somente informações da versão; não recebe consultas ou histórico. A consulta de versão é manual, via página de downloads, e não é uma atualização automática.
