# Coletor de banco da revenda — JSTech

Este coletor fica **no servidor da própria revenda**, próximo ao banco MySQL/MariaDB. A senha do banco não vai para o GitHub e não é enviada ao JSTech.

## Instalação

1. Crie uma fonte em **JSTech Atendimento > Configurações > Sincronização de bancos**.
2. Copie o token `jstsync_...` mostrado uma única vez.
3. No servidor da revenda, crie uma pasta fora do diretório público, por exemplo:
   `/opt/jstech-sync/`
4. Coloque `sync.php` e uma cópia de `config.example.php` renomeada para `config.php`.
5. Preencha o banco local, o token e ajuste a consulta SQL.
6. Teste:
   `php /opt/jstech-sync/sync.php`
7. Para sincronizar a cada 5 minutos:
   `*/5 * * * * /usr/bin/php /opt/jstech-sync/sync.php >> /var/log/jstech-sync.log 2>&1`

## Campos esperados

A consulta SQL deve retornar os aliases:
`external_id, name, phone, service_type, device_type, app_name, login_username, expires_at, amount, status, notes`.

O `external_id` é obrigatório e deve ser único no banco da revenda.

## Segurança

- Nunca coloque `config.php` no GitHub.
- Não use usuário MySQL `root`; crie um usuário somente com permissão **SELECT** nas tabelas necessárias.
- O coletor não envia a senha do banco.
- O modelo padrão também não envia senha de cliente.
- Se o token vazar, gere um token novo no painel; o antigo deixa de funcionar.
