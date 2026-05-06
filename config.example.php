<?php
declare(strict_types=1);

return [
    // Copy this file to config.php and change these values on the server.
    'email_to' => 'sikforening@gmail.com',
    'from_email' => 'no-reply@sikforening.se',
    'from_name' => 'SIKF Hemsida',

    // Anti-spam limits per visitor/browser fingerprint.
    'rate_limit_count' => 5,
    'rate_limit_window_seconds' => 900,

    // Maximum length for contact message text.
    'max_message_length' => 3000,
    'max_attachment_bytes' => 6000000,

    // BankID/Autogiro preparation. Keep disabled until SIKF has a real provider.
    'bankid_enabled' => false,
    'bankid_provider_name' => '',
    'bankid_provider_start_url' => '',
    'bankid_provider_status_url' => '',
    'bankid_provider_cancel_url' => '',
    'bankid_api_key' => '',
    'bankid_timeout_seconds' => 120,
];
