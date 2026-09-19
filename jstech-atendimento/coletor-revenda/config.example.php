<?php
// Copie este arquivo para config.php e preencha SOMENTE no servidor da revenda.
// Nunca envie este arquivo preenchido para GitHub.
defined('JSTECH_SYNC') || exit;

return [
    'endpoint' => 'https://fvttsguxeocisqvcrbqh.supabase.co/functions/v1/jstech-sync-ingest',
    'token' => 'COLE_AQUI_O_TOKEN_JSTSYNC',

    // MySQL / MariaDB do painel da revenda
    'db' => [
        'dsn' => 'mysql:host=127.0.0.1;port=3306;dbname=SEU_BANCO;charset=utf8mb4',
        'user' => 'SEU_USUARIO',
        'pass' => 'SUA_SENHA',
    ],

    // Ajuste os nomes das colunas/tabela conforme o banco da revenda.
    // external_id precisa ser único para cada cliente.
    'query' => "
        SELECT
            id AS external_id,
            nome AS name,
            telefone AS phone,
            'IPTV' AS service_type,
            aparelho AS device_type,
            aplicativo AS app_name,
            usuario AS login_username,
            vencimento AS expires_at,
            valor AS amount,
            status AS status,
            observacao AS notes
        FROM clientes
    ",

    // true = cliente apagado no banco da revenda fica inativo no JSTech.
    'full_sync' => true,
    'timeout_seconds' => 40,
];
