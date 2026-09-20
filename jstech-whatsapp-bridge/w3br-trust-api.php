<?php
// JSTech -> W3BR: API segura para "Liberação de confiança".
// Coloque em /var/www/html/painel/jstech-trust-api.php.
// O segredo fica fora do webroot em /etc/jstech-trust-api.php.

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function respond_json($status, $data) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond_json(405, array('ok' => false, 'error' => 'method_not_allowed'));
}

$configFile = '/etc/jstech-trust-api.php';
if (!is_file($configFile)) {
    respond_json(500, array('ok' => false, 'error' => 'server_not_configured'));
}
$config = require $configFile;
$expected = isset($config['secret']) ? (string)$config['secret'] : '';
$received = isset($_SERVER['HTTP_X_JSTECH_SECRET']) ? (string)$_SERVER['HTTP_X_JSTECH_SECRET'] : '';
if ($expected === '' || $received === '' || !hash_equals($expected, $received)) {
    respond_json(401, array('ok' => false, 'error' => 'unauthorized'));
}

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    respond_json(400, array('ok' => false, 'error' => 'invalid_json'));
}
$identifier = isset($body['identifier']) ? trim((string)$body['identifier']) : '';
if ($identifier === '' || strlen($identifier) > 120) {
    respond_json(400, array('ok' => false, 'error' => 'identifier_required'));
}

require __DIR__ . '/conexao.php';

if (!isset($painel_user) || !($painel_user instanceof PDO)) {
    respond_json(500, array('ok' => false, 'error' => 'painel_user_unavailable'));
}

function digits_only($value) {
    return preg_replace('/\D+/', '', (string)$value);
}

function find_account($db, $identifier) {
    $tables = array('admin', 'rev', 'usuario', 'teste');
    $digits = digits_only($identifier);
    $found = array();

    foreach ($tables as $table) {
        try {
            $sql = "SELECT usuario, celular FROM `{$table}` WHERE usuario = :ident";
            $params = array(':ident' => $identifier);
            if ($digits !== '') {
                $sql .= " OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(celular,''), '(', ''), ')', ''), '-', ''), ' ', ''), '+', ''), '.', '') = :digits";
                $params[':digits'] = $digits;
            }
            $sql .= " LIMIT 3";
            $q = $db->prepare($sql);
            $q->execute($params);
            while ($row = $q->fetch(PDO::FETCH_ASSOC)) {
                $username = isset($row['usuario']) ? trim((string)$row['usuario']) : '';
                if ($username !== '') {
                    $found[$table . ':' . $username] = array(
                        'table' => $table,
                        'username' => $username,
                        'phone' => isset($row['celular']) ? (string)$row['celular'] : ''
                    );
                }
            }
        } catch (Exception $e) {
            // Algumas instalações não possuem todas as tabelas. Ignora e segue.
        }
    }

    if (count($found) === 0) return array(null, 'not_found');
    if (count($found) > 1) return array(null, 'ambiguous');
    return array(array_values($found)[0], null);
}

function locate_trust_db() {
    $names = array('painel_acessos', 'painel_geral', 'painel_user');
    foreach ($names as $name) {
        if (!isset($GLOBALS[$name]) || !($GLOBALS[$name] instanceof PDO)) continue;
        $db = $GLOBALS[$name];
        try {
            $q = $db->query("SHOW TABLES LIKE 'liberarcomputador'");
            if ($q && $q->fetch(PDO::FETCH_NUM)) return array($db, $name);
        } catch (Exception $e) {
        }
    }
    return array(null, null);
}

list($account, $accountError) = find_account($painel_user, $identifier);
if ($accountError === 'not_found') {
    respond_json(404, array('ok' => false, 'error' => 'account_not_found'));
}
if ($accountError === 'ambiguous') {
    respond_json(409, array('ok' => false, 'error' => 'ambiguous_identifier'));
}

list($trustDb, $trustDbName) = locate_trust_db();
if (!$trustDb) {
    respond_json(500, array('ok' => false, 'error' => 'trust_table_not_found'));
}

$username = $account['username'];

try {
    $q = $trustDb->prepare("SELECT id FROM liberarcomputador WHERE CadUser = :usuario");
    $q->execute(array(':usuario' => $username));
    $rows = $q->fetchAll(PDO::FETCH_COLUMN);

    if (!$rows) {
        respond_json(200, array(
            'ok' => true,
            'released' => 0,
            'already_released' => true,
            'username' => $username
        ));
    }

    $trustDb->beginTransaction();
    $del = $trustDb->prepare("DELETE FROM liberarcomputador WHERE CadUser = :usuario");
    $del->execute(array(':usuario' => $username));
    $count = $del->rowCount();
    $trustDb->commit();

    error_log('[JSTech Trust] released user=' . $username . ' rows=' . $count . ' db=' . $trustDbName);

    respond_json(200, array(
        'ok' => true,
        'released' => (int)$count,
        'already_released' => false,
        'username' => $username
    ));
} catch (Exception $e) {
    if ($trustDb && $trustDb->inTransaction()) $trustDb->rollBack();
    error_log('[JSTech Trust] error user=' . $username . ' detail=' . $e->getMessage());
    respond_json(500, array('ok' => false, 'error' => 'release_failed'));
}
