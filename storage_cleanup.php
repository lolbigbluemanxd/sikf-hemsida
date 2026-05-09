<?php
declare(strict_types=1);

/*
 * SIK retention cleanup.
 *
 * Run daily from the server command line via cron, e.g.:
 *   0 3 * * *  /usr/bin/php /var/www/sikforening.se/storage_cleanup.php >> /var/log/sik-cleanup.log 2>&1
 *
 * Behaviour:
 *   - Deletes files in storage/autogiro_documents/ (PDF/JSON/.enc) older than
 *     storage_retention_days (default 2555 = 7 år, för bokföringslagen).
 *   - Trims storage/submissions.log to entries within log_retention_days
 *     (default 90 dagar).
 *   - Deletes stale rate-limit JSON files older than 7 days.
 *
 * Prints a JSON summary so the cron log captures what happened.
 *
 * Safe to run with --dry-run to preview without deleting:
 *   php storage_cleanup.php --dry-run
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo "This script must be run from the command line.\n";
    exit;
}

$dryRun = in_array('--dry-run', $argv ?? [], true);

$defaultConfig = [
    'saved_documents_dir' => __DIR__ . '/storage/autogiro_documents',
    'storage_retention_days' => 2555,
    'log_retention_days' => 90,
];

$configPath = __DIR__ . '/config.php';
$config = is_file($configPath) ? array_merge($defaultConfig, require $configPath) : $defaultConfig;

$result = [
    'started_at' => gmdate('c'),
    'dry_run' => $dryRun,
    'documents_deleted' => 0,
    'documents_kept' => 0,
    'log_lines_kept' => 0,
    'log_lines_dropped' => 0,
    'rate_limit_files_deleted' => 0,
    'errors' => [],
];

$now = time();

// 1. Cleanup autogiro documents.
$docsDir = (string) $config['saved_documents_dir'];
$docRetentionSeconds = max(1, (int) $config['storage_retention_days']) * 86400;
$cutoff = $now - $docRetentionSeconds;

if (is_dir($docsDir)) {
    $items = scandir($docsDir) ?: [];
    foreach ($items as $name) {
        if ($name === '.' || $name === '..' || $name === '.htaccess' || $name === 'index.html') {
            continue;
        }
        $path = $docsDir . DIRECTORY_SEPARATOR . $name;
        if (!is_file($path)) {
            continue;
        }
        $mtime = filemtime($path);
        if ($mtime !== false && $mtime < $cutoff) {
            if ($dryRun) {
                $result['documents_deleted']++;
            } elseif (@unlink($path)) {
                $result['documents_deleted']++;
            } else {
                $result['errors'][] = 'Could not delete ' . $name;
            }
        } else {
            $result['documents_kept']++;
        }
    }
}

// 2. Trim submissions log.
$logPath = __DIR__ . '/storage/submissions.log';
$logRetentionSeconds = max(1, (int) $config['log_retention_days']) * 86400;
$logCutoff = $now - $logRetentionSeconds;

if (is_file($logPath)) {
    $kept = [];
    $handle = @fopen($logPath, 'r');
    if ($handle) {
        while (($line = fgets($handle)) !== false) {
            $trimmed = trim($line);
            if ($trimmed === '') continue;
            $entry = json_decode($trimmed, true);
            $ts = false;
            if (is_array($entry) && !empty($entry['time'])) {
                $ts = strtotime((string) $entry['time']);
            }
            if ($ts !== false && $ts >= $logCutoff) {
                $kept[] = $line;
                $result['log_lines_kept']++;
            } else {
                $result['log_lines_dropped']++;
            }
        }
        fclose($handle);
        if (!$dryRun && $result['log_lines_dropped'] > 0) {
            $tmpPath = $logPath . '.tmp';
            if (@file_put_contents($tmpPath, implode('', $kept), LOCK_EX) !== false) {
                @rename($tmpPath, $logPath);
            } else {
                $result['errors'][] = 'Could not rewrite submissions.log';
            }
        }
    }
}

// 3. Cleanup stale rate-limit files (older than 7 days, since the active window is 15 minutes).
$rateLimitDir = __DIR__ . '/storage/rate_limit';
$rateLimitCutoff = $now - (7 * 86400);
if (is_dir($rateLimitDir)) {
    $items = scandir($rateLimitDir) ?: [];
    foreach ($items as $name) {
        if ($name === '.' || $name === '..') continue;
        $path = $rateLimitDir . DIRECTORY_SEPARATOR . $name;
        if (!is_file($path)) continue;
        $mtime = filemtime($path);
        if ($mtime !== false && $mtime < $rateLimitCutoff) {
            if ($dryRun) {
                $result['rate_limit_files_deleted']++;
            } elseif (@unlink($path)) {
                $result['rate_limit_files_deleted']++;
            }
        }
    }
}

$result['finished_at'] = gmdate('c');
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL;
