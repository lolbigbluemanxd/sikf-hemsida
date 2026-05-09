# SIK production checklist

Use this checklist before the site is opened for real donors.

## Hosting

- Use a PHP-capable web host for the live site. GitHub Pages can show the static pages, but it cannot run `sendemail.php`, `bankid.php`, `admin.php`, document storage, or cleanup jobs.
- Enable HTTPS on the domain before launch. The `.htaccess` file redirects HTTP to HTTPS and sends HSTS headers when Apache headers/rewrite modules are enabled.

## Server config

1. Copy `config.example.php` to `config.php` on the server.
2. Set `email_to` to the official recipient address.
3. Set `from_email` to an address on the production domain.
4. Generate a storage key and set `storage_encryption_key`, or set environment variable `SIK_STORAGE_KEY`.
5. Generate an admin password hash:

```sh
php -r "echo password_hash('choose-a-strong-password', PASSWORD_DEFAULT), PHP_EOL;"
```

6. Set `admin_username` and `admin_password_hash`.
7. If e-mail should be sent directly from the server, set `email_enabled`, `smtp_enabled`, `smtp_host`, `smtp_username`, `smtp_password`, and SMTP options.
8. If Cloudflare Turnstile is used, set `turnstile_enabled`, `turnstile_site_key`, and `turnstile_secret_key`.

## Storage and retention

- Ensure `storage/`, `storage/autogiro_documents/`, and `storage/rate_limit/` are writable by PHP.
- Keep `storage/` private. The included `.htaccess` files deny direct web access where possible.
- Schedule the cleanup job daily:

```sh
0 3 * * * /usr/bin/php /path/to/site/storage_cleanup.php >> /path/to/logs/sik-cleanup.log 2>&1
```

- Back up `storage/` securely. Autogiro documents contain sensitive data.

## BankID and Autogiro

- `bankid.php` is prepared but not connected to a real BankID provider.
- Until a provider such as Scrive, Signicat, Criipto, or a bank-approved signing service is connected, treat the form as a prepared autogiro blankett that the donor signs and SIK handles manually.

## Pre-launch checks

- Run PHP syntax checks on the server:

```sh
php -l sendemail.php
php -l bankid.php
php -l admin.php
php -l storage_cleanup.php
```

- Submit one contact form and one autogiro test with non-real test data.
- Verify that encrypted documents can be opened through `admin.php`.
- Verify that old files are removed by `storage_cleanup.php --dry-run`.
