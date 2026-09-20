# JSTech WhatsApp por QR Code

Conector privado do JSTech Atendimento. O usuário final não configura Meta Developers, Phone ID, token ou webhook.

## Instalação no servidor

Execute o instalador em uma VPS Linux com acesso público. Informe a URL pública que aponta para a porta 8080.

```bash
sudo bash install.sh http://SEU_IP_PUBLICO:8080
```

Ao terminar, o instalador mostra somente dois dados para a configuração inicial do administrador:

- Endereço do servidor
- Chave do servidor

Depois de salvar isso no JSTech Atendimento, o uso normal é apenas:

**Conectar WhatsApp → escanear QR Code → pronto.**

A imagem está fixada em Evolution API v2.3.7 para evitar mudanças inesperadas em produção.
