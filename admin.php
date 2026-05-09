<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');

/*
 * SIK admin: lightweight password-protected viewer for autogiro submissions.
 *
 * Setup:
 *   1. Generate a password hash:
 *        php -r "echo password_hash('your-strong-password', PASSWORD_DEFAULT), PHP_EOL;"
 *   2. Put the resulting hash in config.php as 'admin_password_hash'.
 *   3. Set 'admin_username' and (optionally) update 'storage_encryption_key'.
 *   4. Visit https://yoursite.example/admin.php and log in.
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

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Robots-Tag: noindex, nofollow');

$defaultConfig = [
    'admin_username' => 'admin',
    'admin_password_hash' => '',
    'saved_documents_dir' => __DIR__ . '/storage/autogiro_documents',
    'storage_encrypt_documents' => true,
    'storage_encryption_key' => '',
];
$configPath = __DIR__ . '/config.php';
$config = is_file($configPath) ? array_merge($defaultConfig, require $configPath) : $defaultConfig;

if (empty($config['admin_password_hash'])) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=UTF-8');
    echo "Admin är inte konfigurerad. Sätt admin_username och admin_password_hash i config.php.\n";
    exit;
}

function admin_csrf_token(): string
{
    if (empty($_SESSION['admin_csrf'])) {
        $_SESSION['admin_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['admin_csrf'];
}

function admin_logged_in(): bool
{
    return !empty($_SESSION['admin_authenticated']);
}

function admin_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
}

// Login + logout handlers
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    $token = (string) ($_POST['csrf'] ?? '');
    $valid = !empty($_SESSION['admin_csrf']) && hash_equals($_SESSION['admin_csrf'], $token);

    if ($action === 'logout' && $valid) {
        admin_logout();
        header('Location: admin.php');
        exit;
    }

    if ($action === 'login') {
        $username = trim((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $expectedUser = (string) ($config['admin_username'] ?? 'admin');
        $expectedHash = (string) $config['admin_password_hash'];
        // Use a slow comparison and constant-time username check.
        if (hash_equals($expectedUser, $username) && password_verify($password, $expectedHash)) {
            session_regenerate_id(true);
            $_SESSION['admin_authenticated'] = true;
            $_SESSION['admin_login_at'] = time();
            header('Location: admin.php');
            exit;
        }
        sleep(1); // discourage brute force
        $loginError = 'Felaktigt användarnamn eller lösenord.';
    }
}

// Document download
if (admin_logged_in() && isset($_GET['download'])) {
    $token = (string) ($_GET['csrf'] ?? '');
    if (empty($_SESSION['admin_csrf']) || !hash_equals($_SESSION['admin_csrf'], $token)) {
        http_response_code(403);
        echo 'Invalid token.';
        exit;
    }
    $name = basename((string) $_GET['download']);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $name)) {
        http_response_code(400);
        echo 'Bad filename.';
        exit;
    }
    $path = rtrim((string) $config['saved_documents_dir'], '/\\') . DIRECTORY_SEPARATOR . $name;
    if (!is_file($path)) {
        http_response_code(404);
        echo 'Not found.';
        exit;
    }
    $isEncrypted = substr($name, -4) === '.enc';
    if ($isEncrypted) {
        $envelope = json_decode((string) file_get_contents($path), true);
        if (!is_array($envelope) || empty($envelope['data'])) {
            http_response_code(500);
            echo 'Bad envelope.';
            exit;
        }
        $key = trim((string) ($config['storage_encryption_key'] ?? ''));
        if ($key === '') $key = trim((string) getenv('SIK_STORAGE_KEY'));
        if ($key === '') {
            http_response_code(500);
            echo 'Encryption key missing in config.';
            exit;
        }
        if (stripos($key, 'base64:') === 0) {
            $decoded = base64_decode(substr($key, 7), true);
            $rawKey = ($decoded !== false) ? substr($decoded, 0, 32) : hash('sha256', $key, true);
        } elseif (preg_match('/^[A-Fa-f0-9]{64,}$/', $key)) {
            $rawKey = hex2bin(substr($key, 0, 64));
        } else {
            $rawKey = hash('sha256', $key, true);
        }
        $iv = base64_decode($envelope['iv'] ?? '', true);
        $tag = base64_decode($envelope['tag'] ?? '', true);
        $cipher = base64_decode($envelope['data'] ?? '', true);
        $plain = openssl_decrypt($cipher, 'aes-256-gcm', $rawKey, OPENSSL_RAW_DATA, $iv, $tag);
        if ($plain === false) {
            http_response_code(500);
            echo 'Decryption failed.';
            exit;
        }
        $downloadName = preg_replace('/\.enc$/', '', $name);
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . $downloadName . '"');
        header('Content-Length: ' . strlen($plain));
        echo $plain;
        exit;
    }
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}

header('Content-Type: text/html; charset=UTF-8');
$csrf = admin_csrf_token();
?>
<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Admin - SIK</title>
<link href="css/bootstrap.min.css" rel="stylesheet">
<link href="css/font-awesome.min.css" rel="stylesheet">
<link href="css/main.css" rel="stylesheet">
<link href="css/responsive.css" rel="stylesheet">
<link href="css/custom.css" rel="stylesheet">
<style>
  body { background: #f4f7f4; padding: 30px 0; }
  .admin-card { background: #fff; border: 1px solid #e4ebe7; border-radius: 8px; padding: 24px; max-width: 920px; margin: 0 auto; }
  .admin-card table { width: 100%; }
  .admin-card td, .admin-card th { padding: 6px 8px; vertical-align: top; }
  .admin-card tr:nth-child(odd) { background: #fafbfa; }
  .admin-meta { color: #6a7a72; font-size: 13px; }
  .login-card { max-width: 380px; margin: 60px auto; }
</style>
</head>
<body class="sik-site">
<?php if (!admin_logged_in()): ?>
  <div class="admin-card login-card">
    <h1>SIK Admin</h1>
    <p class="admin-meta">Logga in för att visa autogiroanmälningar.</p>
    <?php if (!empty($loginError)): ?>
      <div class="sik-form-feedback sik-form-feedback--error" style="display:block;margin-bottom:16px;"><?= htmlspecialchars($loginError, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>
    <form method="post" autocomplete="off">
      <input type="hidden" name="action" value="login">
      <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES, 'UTF-8') ?>">
      <div class="form-group"><label>Användarnamn</label><input type="text" name="username" class="form-control" required autocomplete="username"></div>
      <div class="form-group"><label>Lösenord</label><input type="password" name="password" class="form-control" required autocomplete="current-password"></div>
      <button type="submit" class="btn btn-primary btn-block">Logga in</button>
    </form>
  </div>
<?php else:
    $docsDir = (string) $config['saved_documents_dir'];
    $rows = [];
    if (is_dir($docsDir)) {
        $items = scandir($docsDir) ?: [];
        foreach ($items as $name) {
            if ($name[0] === '.' || $name === 'index.html') continue;
            $path = $docsDir . DIRECTORY_SEPARATOR . $name;
            if (!is_file($path)) continue;
            if (substr($name, -5) === '.json') {
                $meta = json_decode((string) file_get_contents($path), true) ?: [];
                $rows[] = [
                    'name' => $name,
                    'meta' => $meta,
                    'pdf' => $meta['stored_file'] ?? '',
                    'mtime' => filemtime($path),
                ];
            }
        }
        usort($rows, function ($a, $b) { return $b['mtime'] <=> $a['mtime']; });
    }
    $logTail = [];
    $logPath = __DIR__ . '/storage/submissions.log';
    if (is_file($logPath)) {
        $lines = @file($logPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        $logTail = array_slice($lines, -25);
    }
?>
  <div class="admin-card">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h1 style="margin:0;">SIK Admin</h1>
        <p class="admin-meta">Inloggad sedan <?= date('Y-m-d H:i', (int) ($_SESSION['admin_login_at'] ?? time())) ?></p>
      </div>
      <form method="post" style="margin:0;">
        <input type="hidden" name="action" value="logout">
        <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES, 'UTF-8') ?>">
        <button type="submit" class="btn btn-default">Logga ut</button>
      </form>
    </div>

    <h2 style="margin-top:24px;">Autogiroanmälningar (<?= count($rows) ?>)</h2>
    <?php if (!$rows): ?>
      <p class="admin-meta">Inga anmälningar har sparats ännu.</p>
    <?php else: ?>
      <table class="table">
        <thead><tr><th>Datum</th><th>Namn</th><th>Bank</th><th>Belopp</th><th>Krypterad</th><th>PDF</th></tr></thead>
        <tbody>
        <?php foreach ($rows as $row): $m = $row['meta']; ?>
          <tr>
            <td><?= htmlspecialchars((string) ($m['created_at'] ?? date('c', (int) $row['mtime'])), ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= htmlspecialchars((string) ($m['name'] ?? '—'), ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= htmlspecialchars((string) ($m['bank'] ?? '—'), ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= htmlspecialchars((string) ($m['amount'] ?? '—'), ENT_QUOTES, 'UTF-8') ?></td>
            <td><?= !empty($m['encrypted']) ? 'ja' : 'nej' ?></td>
            <td>
              <?php if (!empty($row['pdf'])): ?>
                <a href="admin.php?download=<?= urlencode($row['pdf']) ?>&csrf=<?= urlencode($csrf) ?>">Ladda ner</a>
              <?php else: ?>
                —
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    <?php endif; ?>

    <h2 style="margin-top:24px;">Senaste händelser i submissions.log</h2>
    <?php if (!$logTail): ?>
      <p class="admin-meta">Loggen är tom.</p>
    <?php else: ?>
      <pre style="background:#f4f7f4;border:1px solid #e4ebe7;border-radius:4px;padding:14px;font-size:12px;max-height:320px;overflow:auto;"><?php
        foreach ($logTail as $line) {
            echo htmlspecialchars($line, ENT_QUOTES, 'UTF-8') . "\n";
        }
      ?></pre>
    <?php endif; ?>
  </div>
<?php endif; ?>
</body>
</html>
