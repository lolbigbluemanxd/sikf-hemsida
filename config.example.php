<?php
declare(strict_types=1);

return [
    // Copy this file to config.php and change these values on the server.
    // Must be set in config.php. Empty value blocks delivery instead of leaking data.
    'email_to' => '',
    'from_email' => 'no-reply@sikforening.se',
    'from_name' => 'SIK Hemsida',

    // Anti-spam limits per visitor/browser fingerprint.
    'rate_limit_count' => 5,
    'rate_limit_window_seconds' => 900,

    // Maximum length for contact message text.
    'max_message_length' => 3000,
    'max_attachment_bytes' => 6000000,
    'max_signature_bytes' => 750000,
    'email_enabled' => false,
    'save_autogiro_pdf' => true,
    'saved_documents_dir' => __DIR__ . '/storage/autogiro_documents',
    'storage_encrypt_documents' => true,
    // Required when storage_encrypt_documents is true.
    // Use a 32+ character random secret, or set environment variable SIK_STORAGE_KEY.
    'storage_encryption_key' => '',
    'storage_retention_days' => 2555,
    'log_retention_days' => 90,

    // Optional admin page for encrypted submissions. Generate with:
    // php -r "echo password_hash('choose-a-strong-password', PASSWORD_DEFAULT), PHP_EOL;"
    'admin_username' => 'admin',
    'admin_password_hash' => '',

    // SMTP e-mail delivery. Copy this file to config.php and fill these on the server.
    // For Gmail: enable 2-step verification, create an app password, then use smtp.gmail.com:587 tls.
    'smtp_enabled' => false,
    'smtp_host' => 'smtp.gmail.com',
    'smtp_port' => 587,
    'smtp_username' => '',
    'smtp_password' => '',
    'smtp_encryption' => 'tls',
    'smtp_timeout_seconds' => 15,

    // BankID/Autogiro preparation. Keep disabled until SIK has a real provider.
    'bankid_enabled' => false,
    'bankid_provider_name' => '',
    'bankid_provider_start_url' => '',
    'bankid_provider_status_url' => '',
    'bankid_provider_cancel_url' => '',
    'bankid_api_key' => '',
    'bankid_timeout_seconds' => 120,
    'bankid_rate_limit_count' => 20,
    'bankid_rate_limit_window_seconds' => 900,

    // Optional bot protection. Keep disabled until real Cloudflare Turnstile keys exist.
    'turnstile_enabled' => false,
    'turnstile_site_key' => '',
    'turnstile_secret_key' => '',
];
