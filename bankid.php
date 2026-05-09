<?php
declare(strict_types=1);

/*
 * Prepared BankID endpoint for SIK.
 *
 * This file is intentionally safe-by-default. It will not pretend to run a
 * BankID signing unless a real provider or bank supplies credentials/API URLs.
 */

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => $https,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$defaultConfig = [
    'bankid_enabled' => false,
    'bankid_provider_name' => '',
    'bankid_provider_start_url' => '',
    'bankid_provider_status_url' => '',
    'bankid_provider_cancel_url' => '',
    'bankid_api_key' => '',
    'bankid_timeout_seconds' => 120,
    'rate_limit_dir' => __DIR__ . '/storage/rate_limit',
    'bankid_rate_limit_count' => 20,
    'bankid_rate_limit_window_seconds' => 900,
];

$configPath = __DIR__ . '/config.php';
$config = is_file($configPath) ? array_merge($defaultConfig, require $configPath) : $defaultConfig;

function bankid_json(bool $success, string $message, int $status = 200, array $extra = []): void
{
    http_response_code($status);
    echo json_encode(array_merge([
        'success' => $success,
        'message' => $message,
    ], $extra), JSON_UNESCAPED_UNICODE);
    exit;
}

function bankid_csrf_token(): string
{
    if (empty($_SESSION['bankid_csrf_token'])) {
        $_SESSION['bankid_csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['bankid_csrf_token'];
}

function bankid_clean(?string $value, int $maxLength = 200): string
{
    $value = trim((string) $value);
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    $value = str_replace(["\r", "\n"], ' ', $value);
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $maxLength, 'UTF-8');
    }
    return substr($value, 0, $maxLength);
}

function bankid_same_origin(): bool
{
    $serverHost = $_SERVER['HTTP_HOST'] ?? '';
    if ($serverHost === '') {
        return true;
    }
    $serverHost = strtolower(preg_replace('/:\d+$/', '', $serverHost) ?? $serverHost);

    foreach (['HTTP_ORIGIN', 'HTTP_REFERER'] as $header) {
        if (empty($_SERVER[$header])) {
            continue;
        }
        $parts = parse_url($_SERVER[$header]);
        if (!empty($parts['host']) && strtolower($parts['host']) !== $serverHost) {
            return false;
        }
    }

    return true;
}

function bankid_request_data(): array
{
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($contentType, 'application/json') !== false) {
        $decoded = json_decode((string) file_get_contents('php://input'), true);
        return is_array($decoded) ? $decoded : [];
    }
    return $_POST;
}

function bankid_rate_limit(array $config): void
{
    $limit = max(1, (int) ($config['bankid_rate_limit_count'] ?? 20));
    $window = max(60, (int) ($config['bankid_rate_limit_window_seconds'] ?? 900));
    $dir = (string) ($config['rate_limit_dir'] ?? (__DIR__ . '/storage/rate_limit'));

    if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
        bankid_json(false, 'BankID-skyddet kunde inte startas. Försök igen senare.', 503);
    }

    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $key = hash('sha256', 'bankid|' . $ip . '|' . substr($ua, 0, 120));
    $path = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . 'bankid-' . $key . '.json';
    $now = time();
    $hits = [];

    if (is_file($path)) {
        $stored = json_decode((string) @file_get_contents($path), true);
        if (is_array($stored)) {
            $hits = array_values(array_filter($stored, static fn($ts) => is_int($ts) && $ts > ($now - $window)));
        }
    }

    if (count($hits) >= $limit) {
        bankid_json(false, 'För många BankID-försök. Vänta en stund och försök igen.', 429);
    }

    $hits[] = $now;
    @file_put_contents($path, json_encode($hits), LOCK_EX);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    bankid_json(true, 'BankID-token hämtad.', 200, [
        'csrf_token' => bankid_csrf_token(),
        'enabled' => (bool) $config['bankid_enabled'],
        'provider' => (string) $config['bankid_provider_name'],
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    bankid_json(false, 'Metoden är inte tillåten.', 405);
}

if (!bankid_same_origin()) {
    bankid_json(false, 'Ogiltig BankID-förfrågan.', 403);
}

bankid_rate_limit($config);

$data = bankid_request_data();
$postedToken = bankid_clean($data['csrf_token'] ?? '', 128);
if ($postedToken === '' || !hash_equals(bankid_csrf_token(), $postedToken)) {
    bankid_json(false, 'BankID-säkerhetstoken saknas eller har gått ut.', 403);
}

$action = bankid_clean($data['action'] ?? 'start', 30);
$providerName = bankid_clean((string) $config['bankid_provider_name'], 80);

if ($action === 'status') {
    bankid_json(false, 'BankID är förberett men ingen aktiv order finns ännu.', 202, [
        'status' => 'not_started',
        'enabled' => (bool) $config['bankid_enabled'],
    ]);
}

if ($action === 'cancel') {
    unset($_SESSION['bankid_order_ref']);
    bankid_json(true, 'BankID-flödet avbröts.', 200, ['status' => 'cancelled']);
}

if ($action !== 'start') {
    bankid_json(false, 'Okänd BankID-åtgärd.', 400);
}

$email = bankid_clean($data['email'] ?? '', 254);
$firstName = bankid_clean($data['first_name'] ?? '', 80);
$lastName = bankid_clean($data['last_name'] ?? '', 80);
$amount = filter_var(bankid_clean($data['amount'] ?? '', 12), FILTER_VALIDATE_INT, [
    'options' => ['min_range' => 1, 'max_range' => 50000],
]);

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $firstName === '' || $lastName === '' || $amount === false) {
    bankid_json(false, 'Fyll i namn, e-post och giltigt månadsbelopp innan BankID startas.', 422);
}

if (empty($config['bankid_enabled'])) {
    bankid_json(false, 'BankID är förberett men inte aktiverat ännu. Anmälan kan skickas till SIK så kontaktar föreningen dig för nästa steg.', 501, [
        'status' => 'provider_not_configured',
        'enabled' => false,
        'next_step' => 'submit_manual_registration',
    ]);
}

if (empty($config['bankid_provider_start_url']) || empty($config['bankid_api_key'])) {
    bankid_json(false, 'BankID är aktiverat i config men leverantörens API-url eller nyckel saknas.', 500, [
        'status' => 'provider_missing_credentials',
        'provider' => $providerName,
    ]);
}

/*
 * Future provider integration point:
 * Send a server-side request to bankid_provider_start_url here, using the API key
 * from config.php. Store the returned orderRef in $_SESSION['bankid_order_ref'],
 * then return qr_data/status to the frontend.
 */
bankid_json(false, 'BankID-leverantör är konfigurerad men API-kopplingen behöver anpassas till leverantörens format.', 501, [
    'status' => 'provider_adapter_required',
    'provider' => $providerName,
]);
