<?php
declare(strict_types=1);
define('JSTECH_SYNC', true);

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    fwrite(STDERR, "ERRO: copie config.example.php para config.php e preencha os dados.\n");
    exit(1);
}
$config = require $configFile;

function fail(string $message, int $code = 1): never {
    fwrite(STDERR, $message . PHP_EOL);
    exit($code);
}

$endpoint = trim((string)($config['endpoint'] ?? ''));
$token = trim((string)($config['token'] ?? ''));
$query = trim((string)($config['query'] ?? ''));
$db = $config['db'] ?? [];

if (!$endpoint || !$token || !str_starts_with($token, 'jstsync_')) fail('Token JSTech inválido ou não configurado.');
if (!$query) fail('Consulta SQL não configurada.');
if (empty($db['dsn']) || !array_key_exists('user', $db) || !array_key_exists('pass', $db)) fail('Banco de dados não configurado.');

try {
    $pdo = new PDO((string)$db['dsn'], (string)$db['user'], (string)$db['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $rows = $pdo->query($query)->fetchAll();
} catch (Throwable $e) {
    fail('Erro ao ler banco local: ' . $e->getMessage());
}

$clients = [];
foreach ($rows as $row) {
    $externalId = trim((string)($row['external_id'] ?? $row['id'] ?? $row['username'] ?? $row['phone'] ?? ''));
    if ($externalId === '') continue;

    // Não sincroniza senha do banco nem senha de painel.
    $clients[] = [
        'external_id' => $externalId,
        'name' => $row['name'] ?? null,
        'phone' => $row['phone'] ?? null,
        'service_type' => $row['service_type'] ?? null,
        'device_type' => $row['device_type'] ?? null,
        'app_name' => $row['app_name'] ?? null,
        'login_username' => $row['login_username'] ?? null,
        'expires_at' => $row['expires_at'] ?? null,
        'amount' => $row['amount'] ?? null,
        'status' => $row['status'] ?? null,
        'notes' => $row['notes'] ?? null,
    ];
}

$payload = json_encode([
    'full_sync' => (bool)($config['full_sync'] ?? true),
    'clients' => $clients,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

if ($payload === false) fail('Não foi possível gerar o JSON.');

$ch = curl_init($endpoint);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $token,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => (int)($config['timeout_seconds'] ?? 40),
]);
$response = curl_exec($ch);
$curlError = curl_error($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false) fail('Erro ao conectar com JSTech: ' . $curlError);
if ($status < 200 || $status >= 300) fail("JSTech respondeu HTTP {$status}: {$response}");

echo date('Y-m-d H:i:s') . " - sincronização concluída: {$response}" . PHP_EOL;
