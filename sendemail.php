<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');

/*
 * SIK secure form endpoint.
 *
 * Setup before publishing:
 * 1. Copy config.example.php to config.php.
 * 2. Put the real receiving e-mail address in config.php.
 * 3. Make sure the storage/ folder is writable by PHP.
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
    'email_to' => '',
    'from_email' => 'no-reply@sikforening.se',
    'from_name' => 'SIK Hemsida',
    'max_message_length' => 3000,
    'max_attachment_bytes' => 6000000,
    'max_signature_bytes' => 750000,
    'email_enabled' => false,
    'save_autogiro_pdf' => true,
    'saved_documents_dir' => __DIR__ . '/storage/autogiro_documents',
    'storage_encrypt_documents' => true,
    'storage_encryption_key' => getenv('SIK_STORAGE_KEY') ?: '',
    'storage_retention_days' => 2555,
    'log_retention_days' => 90,
    'rate_limit_count' => 5,
    'rate_limit_window_seconds' => 900,
    'smtp_enabled' => false,
    'smtp_host' => '',
    'smtp_port' => 587,
    'smtp_username' => '',
    'smtp_password' => '',
    'smtp_encryption' => 'tls',
    'smtp_timeout_seconds' => 15,
    'turnstile_enabled' => false,
    'turnstile_site_key' => '',
    'turnstile_secret_key' => '',
];

$configPath = __DIR__ . '/config.php';
$config = is_file($configPath) ? array_merge($defaultConfig, require $configPath) : $defaultConfig;

function json_response(bool $success, string $message, int $status = 200, array $extra = []): void
{
    http_response_code($status);
    echo json_encode(array_merge([
        'success' => $success,
        'message' => $message,
    ], $extra), JSON_UNESCAPED_UNICODE);
    exit;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function clean_string(?string $value, int $maxLength = 200): string
{
    $value = trim((string) $value);
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    $value = str_replace(["\r", "\n"], ' ', $value);
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $maxLength, 'UTF-8');
    }
    return substr($value, 0, $maxLength);
}

function clean_multiline(?string $value, int $maxLength): string
{
    $value = trim((string) $value);
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $maxLength, 'UTF-8');
    }
    return substr($value, 0, $maxLength);
}

function safe_filename(?string $value, string $fallback): string
{
    $value = trim((string) $value);
    $value = preg_replace('/[^A-Za-z0-9._-]+/', '-', $value) ?? '';
    $value = trim($value, '.-');
    if ($value === '') {
        $value = $fallback;
    }
    if (!preg_match('/\.pdf$/i', $value)) {
        $value .= '.pdf';
    }
    return substr($value, 0, 120);
}

function autogiro_pdf_attachment(?string $dataUri, ?string $filename, int $maxBytes): ?array
{
    $dataUri = trim((string) $dataUri);
    if ($dataUri === '') {
        return null;
    }
    if (!preg_match('/^data:application\/pdf(?:;[^,]*)?;base64,([A-Za-z0-9+\/=\s]+)$/i', $dataUri, $matches)) {
        json_response(false, 'PDF-bilagan har fel format.', 422);
    }
    $base64 = preg_replace('/\s+/', '', $matches[1]) ?? '';
    if (strlen($base64) > (int) ceil($maxBytes * 1.4)) {
        json_response(false, 'PDF-bilagan är för stor.', 413);
    }
    $binary = base64_decode($base64, true);
    if ($binary === false || strlen($binary) > $maxBytes || substr($binary, 0, 5) !== '%PDF-') {
        json_response(false, 'PDF-bilagan kunde inte läsas.', 422);
    }

    return [
        'filename' => safe_filename($filename, 'sik-autogiro.pdf'),
        'content' => $binary,
    ];
}

function validate_signature_data(?string $dataUri, int $maxBytes): void
{
    $dataUri = trim((string) $dataUri);
    if ($dataUri === '') {
        json_response(false, 'Underskrift saknas.', 422);
    }
    if (!preg_match('/^data:image\/png;base64,([A-Za-z0-9+\/=\s]+)$/i', $dataUri, $matches)) {
        json_response(false, 'Underskriften har fel format.', 422);
    }
    $base64 = preg_replace('/\s+/', '', $matches[1]) ?? '';
    if (strlen($base64) > (int) ceil($maxBytes * 1.4)) {
        json_response(false, 'Underskriften är för stor.', 413);
    }
    $binary = base64_decode($base64, true);
    if ($binary === false || strlen($binary) > $maxBytes || substr($binary, 0, 8) !== "\x89PNG\r\n\x1a\n") {
        json_response(false, 'Underskriften kunde inte läsas.', 422);
    }
}

function normalized_personal_number(string $personalNumber): string
{
    $digits = preg_replace('/\D+/', '', $personalNumber) ?? '';
    if (strlen($digits) === 12) {
        $digits = substr($digits, 2);
    }
    return $digits;
}

function luhn_valid(string $digits): bool
{
    $sum = 0;
    $length = strlen($digits);
    for ($i = 0; $i < $length; $i++) {
        $n = (int) $digits[$i];
        if (($length - $i) % 2 === 0) {
            $n *= 2;
            if ($n > 9) {
                $n -= 9;
            }
        }
        $sum += $n;
    }
    return $sum > 0 && $sum % 10 === 0;
}

function valid_swedish_personal_number(string $personalNumber): bool
{
    if (!preg_match('/^[0-9]{6,8}[-+]?[0-9]{4}$/', $personalNumber)) {
        return false;
    }
    $digits = normalized_personal_number($personalNumber);
    return strlen($digits) === 10 && luhn_valid($digits);
}

function valid_bank_account(string $value): bool
{
    $value = trim($value);
    if (!preg_match('/^[0-9][0-9\s-]{6,24}[0-9]$/', $value)) {
        return false;
    }
    $digits = preg_replace('/\D+/', '', $value) ?? '';
    return strlen($digits) >= 7 && strlen($digits) <= 18;
}

function storage_key(array $config): string
{
    $key = trim((string) ($config['storage_encryption_key'] ?? ''));
    if ($key === '') {
        $key = trim((string) getenv('SIK_STORAGE_KEY'));
    }
    if ($key === '') {
        throw new RuntimeException('Storage encryption key is missing.');
    }
    if (stripos($key, 'base64:') === 0) {
        $decoded = base64_decode(substr($key, 7), true);
        if ($decoded !== false && strlen($decoded) >= 32) {
            return substr($decoded, 0, 32);
        }
    }
    if (preg_match('/^[A-Fa-f0-9]{64,}$/', $key)) {
        $decoded = hex2bin(substr($key, 0, 64));
        if ($decoded !== false) {
            return $decoded;
        }
    }
    return hash('sha256', $key, true);
}

function encrypt_document(string $content, array $config): string
{
    $iv = random_bytes(12);
    $tag = '';
    $cipherText = openssl_encrypt(
        $content,
        'aes-256-gcm',
        storage_key($config),
        OPENSSL_RAW_DATA,
        $iv,
        $tag
    );
    if ($cipherText === false) {
        throw new RuntimeException('PDF document could not be encrypted.');
    }
    return json_encode([
        'version' => 1,
        'cipher' => 'aes-256-gcm',
        'iv' => base64_encode($iv),
        'tag' => base64_encode($tag),
        'data' => base64_encode($cipherText),
    ], JSON_UNESCAPED_SLASHES);
}

function ensure_private_directory(string $dir): void
{
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        throw new RuntimeException('Documents directory could not be created.');
    }

    $htaccess = $dir . '/.htaccess';
    if (!is_file($htaccess)) {
        file_put_contents($htaccess, "Require all denied\nOptions -Indexes\n", LOCK_EX);
    }

    $index = $dir . '/index.html';
    if (!is_file($index)) {
        file_put_contents($index, '', LOCK_EX);
    }
}

function save_autogiro_document(array $attachment, array $meta, string $dir, array $config): string
{
    ensure_private_directory($dir);

    $datePrefix = date('Ymd-His');
    $random = bin2hex(random_bytes(4));
    $pdfName = safe_filename($datePrefix . '-' . $random . '-' . $attachment['filename'], 'autogiro.pdf');
    $encrypt = !empty($config['storage_encrypt_documents']);
    $pdfPath = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . ($encrypt ? $pdfName . '.enc' : $pdfName);
    $content = $encrypt ? encrypt_document($attachment['content'], $config) : $attachment['content'];

    if (file_put_contents($pdfPath, $content, LOCK_EX) === false) {
        throw new RuntimeException('PDF document could not be saved.');
    }

    $metaPath = preg_replace('/\.pdf$/i', '.json', $pdfPath) ?? ($pdfPath . '.json');
    $safeMeta = [
        'created_at' => date('c'),
        'filename' => $pdfName,
        'stored_file' => basename($pdfPath),
        'encrypted' => $encrypt,
        'name' => $meta['name'] ?? '',
        'email_hash' => !empty($meta['email']) ? hash('sha256', strtolower((string) $meta['email'])) : '',
        'phone_hash' => !empty($meta['phone']) ? hash('sha256', (string) $meta['phone']) : '',
        'amount' => $meta['amount'] ?? '',
        'bank' => $meta['bank'] ?? '',
        'place_date' => $meta['place_date'] ?? '',
    ];
    file_put_contents($metaPath, json_encode($safeMeta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

    return $pdfPath;
}

function is_same_origin_request(): bool
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

function ensure_rate_limit(array $config): void
{
    $dir = __DIR__ . '/storage/rate_limit';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $agent = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $key = hash('sha256', $ip . '|' . $agent);
    $file = $dir . '/' . $key . '.json';
    $now = time();
    $window = (int) $config['rate_limit_window_seconds'];
    $limit = (int) $config['rate_limit_count'];
    $events = [];

    if (is_file($file)) {
        $decoded = json_decode((string) file_get_contents($file), true);
        if (is_array($decoded)) {
            $events = array_filter($decoded, static function ($ts) use ($now, $window): bool {
                return is_int($ts) && $ts > ($now - $window);
            });
        }
    }

    if (count($events) >= $limit) {
        json_response(false, 'För många försök. Vänta en stund och försök igen.', 429);
    }

    $events[] = $now;
    file_put_contents($file, json_encode(array_values($events)), LOCK_EX);
}

function log_event(string $type, array $context = []): void
{
    $dir = __DIR__ . '/storage';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $safeContext = [
        'type' => $type,
        'time' => gmdate('c'),
        'ip_hash' => hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown'),
        'subject' => $context['subject'] ?? '',
        'email_hash' => !empty($context['email']) ? hash('sha256', strtolower($context['email'])) : '',
        'success' => $context['success'] ?? null,
        'saved' => $context['saved'] ?? null,
    ];

    file_put_contents(
        $dir . '/submissions.log',
        json_encode($safeContext, JSON_UNESCAPED_UNICODE) . PHP_EOL,
        FILE_APPEND | LOCK_EX
    );
}

function verify_turnstile(array $config, string $token): bool
{
    if (empty($config['turnstile_enabled'])) {
        return true;
    }
    $secret = trim((string) ($config['turnstile_secret_key'] ?? ''));
    if ($secret === '') {
        error_log('Turnstile is enabled but turnstile_secret_key is missing.');
        return false;
    }
    if ($token === '') {
        return false;
    }

    $payload = http_build_query([
        'secret' => $secret,
        'response' => $token,
        'remoteip' => $_SERVER['REMOTE_ADDR'] ?? '',
    ]);
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $payload,
            'timeout' => 8,
            'ignore_errors' => true,
        ],
    ]);
    $response = @file_get_contents('https://challenges.cloudflare.com/turnstile/v0/siteverify', false, $context);
    if ($response === false) {
        error_log('Turnstile verify request failed.');
        return false;
    }
    $decoded = json_decode($response, true);
    return is_array($decoded) && !empty($decoded['success']);
}

function smtp_read_response($socket, array $expectedCodes): string
{
    $response = '';
    while (($line = fgets($socket, 515)) !== false) {
        $response .= $line;
        if (isset($line[3]) && $line[3] === ' ') {
            break;
        }
    }

    $code = (int) substr($response, 0, 3);
    if (!in_array($code, $expectedCodes, true)) {
        throw new RuntimeException('SMTP error: ' . trim($response));
    }

    return $response;
}

function smtp_command($socket, string $command, array $expectedCodes): string
{
    fwrite($socket, $command . "\r\n");
    return smtp_read_response($socket, $expectedCodes);
}

function smtp_dot_stuff(string $message): string
{
    $message = str_replace(["\r\n", "\r"], "\n", $message);
    $message = str_replace("\n", "\r\n", $message);
    return preg_replace('/^\./m', '..', $message) ?? $message;
}

function send_smtp_mail(array $config, string $to, string $fromEmail, string $fromName, string $replyTo, string $subject, array $headers, string $body): bool
{
    $host = clean_string($config['smtp_host'] ?? '', 255);
    $username = clean_string($config['smtp_username'] ?? '', 255);
    $password = (string) ($config['smtp_password'] ?? '');
    $port = (int) ($config['smtp_port'] ?? 587);
    $timeout = max(5, (int) ($config['smtp_timeout_seconds'] ?? 15));
    $encryption = strtolower(clean_string($config['smtp_encryption'] ?? 'tls', 12));

    if ($host === '' || $username === '' || $password === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return false;
    }

    $transport = $encryption === 'ssl' ? 'ssl://' : '';
    $socket = @stream_socket_client(
        $transport . $host . ':' . $port,
        $errno,
        $errstr,
        $timeout,
        STREAM_CLIENT_CONNECT
    );

    if (!$socket) {
        error_log('SMTP connect failed: ' . $errstr . ' (' . $errno . ')');
        return false;
    }

    stream_set_timeout($socket, $timeout);

    try {
        smtp_read_response($socket, [220]);
        $serverName = preg_replace('/[^A-Za-z0-9.-]/', '', $_SERVER['SERVER_NAME'] ?? 'localhost') ?: 'localhost';
        smtp_command($socket, 'EHLO ' . $serverName, [250]);

        if ($encryption === 'tls') {
            smtp_command($socket, 'STARTTLS', [220]);
            if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('SMTP TLS could not start.');
            }
            smtp_command($socket, 'EHLO ' . $serverName, [250]);
        }

        smtp_command($socket, 'AUTH LOGIN', [334]);
        smtp_command($socket, base64_encode($username), [334]);
        smtp_command($socket, base64_encode($password), [235]);

        $envelopeFrom = filter_var($fromEmail, FILTER_VALIDATE_EMAIL) ? $fromEmail : $username;
        smtp_command($socket, 'MAIL FROM:<' . $envelopeFrom . '>', [250]);
        smtp_command($socket, 'RCPT TO:<' . $to . '>', [250, 251]);
        smtp_command($socket, 'DATA', [354]);

        $rawHeaders = array_merge([
            'To: ' . $to,
            'Subject: ' . $subject,
        ], $headers);

        fwrite($socket, smtp_dot_stuff(implode("\r\n", $rawHeaders) . "\r\n\r\n" . $body) . "\r\n.\r\n");
        smtp_read_response($socket, [250]);
        smtp_command($socket, 'QUIT', [221]);
        fclose($socket);
        return true;
    } catch (Throwable $e) {
        error_log($e->getMessage());
        fclose($socket);
        return false;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_response(true, 'CSRF-token hämtad.', 200, [
        'csrf_token' => csrf_token(),
        'turnstile_enabled' => !empty($config['turnstile_enabled']),
        'turnstile_site_key' => (string) ($config['turnstile_site_key'] ?? ''),
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(false, 'Metoden är inte tillåten.', 405);
}

if (!is_same_origin_request()) {
    json_response(false, 'Ogiltig förfrågan.', 403);
}

ensure_rate_limit($config);

if (!empty($_POST['botcheck']) || !empty($_POST['website'])) {
    log_event('honeypot');
    json_response(true, 'Tack! Meddelandet är mottaget.');
}

$postedToken = clean_string($_POST['csrf_token'] ?? '', 128);
if ($postedToken === '' || !hash_equals(csrf_token(), $postedToken)) {
    json_response(false, 'Säkerhetstoken saknas eller har gått ut. Uppdatera sidan och försök igen.', 403);
}

if (!empty($config['turnstile_enabled'])) {
    $turnstileToken = clean_string($_POST['cf-turnstile-response'] ?? '', 2048);
    if (!verify_turnstile($config, $turnstileToken)) {
        log_event('turnstile_failed');
        json_response(false, 'Bot-skyddet kunde inte verifiera dig. Försök igen.', 403);
    }
}

$email = clean_string($_POST['email'] ?? '', 254);
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(false, 'Ange en giltig e-postadress.', 422);
}

$subject = clean_string($_POST['subject'] ?? 'Kontakt från SIK hemsida', 120);
$message = clean_multiline($_POST['message'] ?? '', (int) $config['max_message_length']);
$isDonor = isset($_POST['amount']) || stripos($subject, 'månad') !== false || stripos($subject, 'manad') !== false;

$name = clean_string($_POST['name'] ?? '', 120);
$firstName = clean_string($_POST['first_name'] ?? '', 80);
$lastName = clean_string($_POST['last_name'] ?? '', 80);
$phone = clean_string($_POST['phone'] ?? '', 40);
$personalNumber = clean_string($_POST['personal_number'] ?? '', 24);
$address = clean_string($_POST['address'] ?? '', 160);
$postalCode = clean_string($_POST['postal_code'] ?? '', 20);
$city = clean_string($_POST['city'] ?? '', 80);
$paymentMethod = clean_string($_POST['payment_method'] ?? '', 80);
$bank = clean_string($_POST['bank'] ?? '', 80);
$bankAccount = clean_string($_POST['bank_account'] ?? '', 80);
$signaturePlaceDate = clean_string($_POST['signature_place_date'] ?? '', 120);
$amountRaw = clean_string($_POST['amount'] ?? '', 12);
$amount = filter_var($amountRaw, FILTER_VALIDATE_INT, [
    'options' => ['min_range' => 1, 'max_range' => 50000],
]);
$attachment = autogiro_pdf_attachment(
    $_POST['autogiro_pdf'] ?? '',
    $_POST['autogiro_pdf_filename'] ?? '',
    (int) $config['max_attachment_bytes']
);

if ($isDonor) {
    if ($firstName === '' || $lastName === '') {
        json_response(false, 'Fyll i förnamn och efternamn.', 422);
    }
    if ($amount === false) {
        json_response(false, 'Ange ett giltigt månadsbelopp.', 422);
    }
    if (empty($_POST['consent'])) {
        json_response(false, 'Du behöver godkänna att SIK kontaktar dig.', 422);
    }
    if ($personalNumber === '') {
        json_response(false, 'Personnummer behövs för autogiroanmälan.', 422);
    }
    if (!valid_swedish_personal_number($personalNumber)) {
        json_response(false, 'Personnumret är inte giltigt. Kontrollera siffrorna och försök igen.', 422);
    }
    if ($bank === '' || $bankAccount === '' || $signaturePlaceDate === '') {
        json_response(false, 'Fyll i bankuppgifter och ort/datum för autogiroanmälan.', 422);
    }
    if (!valid_bank_account($bankAccount)) {
        json_response(false, 'Clearing- och kontonumret har fel format. Kontrollera bankens uppgifter.', 422);
    }
    if ($attachment === null) {
        json_response(false, 'Den ifyllda PDF-blanketten saknas. Försök igen eller ladda ner PDF och kontakta SIK.', 422);
    }
    validate_signature_data($_POST['signature_data'] ?? '', (int) $config['max_signature_bytes']);
} else {
    if ($name === '' || $subject === '' || $message === '') {
        json_response(false, 'Fyll i namn, ämne och meddelande.', 422);
    }
}

$displayName = trim($name . ' ' . $firstName . ' ' . $lastName);
$mailSubjectText = '[SIK] ' . ($subject !== '' ? $subject : 'Nytt meddelande');
$mailSubject = '=?UTF-8?B?' . base64_encode($mailSubjectText) . '?=';
$bodyLines = [
    'Typ: ' . ($isDonor ? 'Månadsgivare/donation' : 'Kontakt'),
    'Namn: ' . $displayName,
    'E-post: ' . $email,
    'Telefon: ' . $phone,
    'Personnummer: ' . $personalNumber,
    'Adress: ' . $address,
    'Postnummer/stad: ' . trim($postalCode . ' ' . $city),
    'Belopp: ' . ($amount !== false ? $amount . ' kr/månad' : ''),
    'Betalsätt: ' . $paymentMethod,
    'Bank: ' . $bank,
    'Clearing/konto: ' . $bankAccount,
    'Ort och datum: ' . $signaturePlaceDate,
    'Ämne: ' . $subject,
    '',
    'Meddelande:',
    $message,
];
$body = implode("\n", $bodyLines);
$savedDocumentPath = '';
if ($isDonor && $attachment !== null && !empty($config['save_autogiro_pdf'])) {
    try {
        $savedDocumentPath = save_autogiro_document($attachment, [
            'name' => $displayName,
            'email' => $email,
            'phone' => $phone,
            'amount' => $amount !== false ? $amount . ' kr/månad' : '',
            'bank' => $bank,
            'place_date' => $signaturePlaceDate,
        ], (string) $config['saved_documents_dir'], $config);
    } catch (Throwable $e) {
        error_log($e->getMessage());
        json_response(false, 'PDF-blanketten kunde inte sparas. Kontrollera att storage-mappen är skrivbar.', 500);
    }
}

if ($isDonor && $savedDocumentPath !== '' && empty($config['email_enabled'])) {
    log_event('donor_form', [
        'subject' => $subject,
        'email' => $email,
        'success' => true,
        'saved' => true,
    ]);

    json_response(true, 'PDF-blanketten är sparad i dokumentmappen.', 200, [
        'saved' => true,
    ]);
}

$fromName = clean_string((string) $config['from_name'], 80);
$fromEmail = filter_var($config['from_email'], FILTER_VALIDATE_EMAIL) ? $config['from_email'] : 'no-reply@sikforening.se';
$configuredEmailTo = trim((string) ($config['email_to'] ?? ''));
if (!filter_var($configuredEmailTo, FILTER_VALIDATE_EMAIL)) {
    error_log('SIK sendemail.php: email_to is missing or invalid in config.php — refusing to send.');
    log_event($isDonor ? 'donor_form' : 'contact_form', [
        'subject' => $subject,
        'email' => $email,
        'success' => false,
        'saved' => $savedDocumentPath !== '',
    ]);
    if ($isDonor && $savedDocumentPath !== '') {
        json_response(true, 'PDF-blanketten är sparad i dokumentmappen. E-postmottagare är inte konfigurerad ännu.', 200, [
            'saved' => true,
        ]);
    }
    json_response(false, 'Mottagar-e-post är inte konfigurerad på servern. Kontakta SIK direkt så löser vi det.', 503);
}
$emailTo = $configuredEmailTo;

$headers = [
    'MIME-Version: 1.0',
    'From: ' . $fromName . ' <' . $fromEmail . '>',
    'Reply-To: ' . $email,
    'X-Mailer: PHP/' . PHP_VERSION,
];

$mailBody = $body;
if ($attachment !== null) {
    $boundary = 'SIK-' . bin2hex(random_bytes(16));
    $headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';
    $mailBody = "--{$boundary}\r\n";
    $mailBody .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $mailBody .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
    $mailBody .= $body . "\r\n\r\n";
    $mailBody .= "--{$boundary}\r\n";
    $mailBody .= 'Content-Type: application/pdf; name="' . $attachment['filename'] . '"' . "\r\n";
    $mailBody .= "Content-Transfer-Encoding: base64\r\n";
    $mailBody .= 'Content-Disposition: attachment; filename="' . $attachment['filename'] . '"' . "\r\n\r\n";
    $mailBody .= chunk_split(base64_encode($attachment['content'])) . "\r\n";
    $mailBody .= "--{$boundary}--";
} else {
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';
}

$sent = !empty($config['smtp_enabled'])
    ? send_smtp_mail($config, $emailTo, $fromEmail, $fromName, $email, $mailSubject, $headers, $mailBody)
    : @mail($emailTo, $mailSubject, $mailBody, implode("\r\n", $headers));
log_event($isDonor ? 'donor_form' : 'contact_form', [
    'subject' => $subject,
    'email' => $email,
    'success' => $sent,
    'saved' => $savedDocumentPath !== '',
]);

if (!$sent) {
    if ($savedDocumentPath !== '') {
        json_response(true, 'PDF-blanketten är sparad i dokumentmappen. E-post är inte aktiverad på den här servern.', 200, [
            'saved' => true,
        ]);
    }
    json_response(false, 'Meddelandet kunde inte skickas just nu. Kontakta SIK direkt via e-post.', 500);
}

// Skicka bekräftelse till anmälaren (kvittens till deras egen inkorg).
if ($sent && filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $confirmationSubjectText = $isDonor
        ? 'Tack för din anmälan till SIK'
        : 'Tack för ditt meddelande till SIK';
    $confirmationSubject = '=?UTF-8?B?' . base64_encode($confirmationSubjectText) . '?=';

    if ($isDonor) {
        $confirmationLines = [
            'Hej ' . ($firstName !== '' ? $firstName : 'och tack'),
            '',
            'Tack för att du vill bli månadsgivare hos SIK!',
            '',
            'Vi har tagit emot din ifyllda autogiroanmälan med följande uppgifter:',
            '',
            'Belopp: ' . ($amount !== false ? $amount . ' kr/månad' : ''),
            'Bank: ' . $bank,
            '',
            'Föreningen kontaktar dig så snart som möjligt om nästa steg och',
            'eventuella uppgifter som behövs för att slutföra registreringen hos banken.',
            '',
            'Har du frågor är du välkommen att svara på det här mejlet eller',
            'kontakta oss på ' . $emailTo . '.',
            '',
            'Med vänliga hälsningar,',
            'Somaliska Islamiska Kulturföreningen',
            'Lantmannavägen 42, 461 60 Trollhättan',
        ];
    } else {
        $confirmationLines = [
            'Hej ' . ($name !== '' ? $name : 'och tack'),
            '',
            'Tack för ditt meddelande till SIK!',
            '',
            'Vi har tagit emot ditt meddelande och återkommer så snart som möjligt.',
            '',
            'Ditt ärende:',
            'Ämne: ' . $subject,
            '',
            'Med vänliga hälsningar,',
            'Somaliska Islamiska Kulturföreningen',
            'Lantmannavägen 42, 461 60 Trollhättan',
        ];
    }

    $confirmationBody = implode("\n", $confirmationLines);
    $confirmationHeaders = [
        'MIME-Version: 1.0',
        'From: ' . $fromName . ' <' . $fromEmail . '>',
        'Reply-To: ' . $emailTo,
        'X-Mailer: PHP/' . PHP_VERSION,
        'Content-Type: text/plain; charset=UTF-8',
    ];

    if (!empty($config['smtp_enabled'])) {
        @send_smtp_mail($config, $email, $fromEmail, $fromName, $emailTo, $confirmationSubject, $confirmationHeaders, $confirmationBody);
    } else {
        @mail($email, $confirmationSubject, $confirmationBody, implode("\r\n", $confirmationHeaders));
    }
}

json_response(true, $isDonor
    ? ($savedDocumentPath !== ''
        ? 'Tack! Din ifyllda PDF-blankett är sparad och skickad till SIK. En bekräftelse skickas till din e-post.'
        : 'Tack! Din ifyllda PDF-blankett är skickad till SIK. En bekräftelse skickas till din e-post.')
    : 'Tack för ditt meddelande. SIK kontaktar dig så snart som möjligt. En bekräftelse skickas till din e-post.'
, 200, ['saved' => $savedDocumentPath !== '']);
