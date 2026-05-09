/*
 * SIK secure form handler.
 * Sends all <form data-sik-form> submissions to the local PHP backend.
 *
 * Features:
 * - CSRF token negotiation via GET to sendemail.php
 * - Cloudflare Turnstile widget rendering when server config has it enabled
 * - Inline field-level error highlighting from backend response
 * - Honeypot anti-spam input
 * - Loading button states + accessible feedback box
 */
(function () {
  'use strict';

  var ENDPOINT = 'sendemail.php';
  var TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__sikTurnstileOnload&render=explicit';
  var serverConfigPromise = null;
  var turnstileScriptLoaded = false;
  var turnstileScriptPromise = null;

  // Map message keywords to form field names so we can highlight the right input.
  var FIELD_HINTS = [
    { re: /personnumm/i, field: 'personal_number' },
    { re: /clearing|kontonum|bank.*konto/i, field: 'bank_account' },
    { re: /bank(?!.*konto)/i, field: 'bank' },
    { re: /belopp|månadsbelopp/i, field: 'amount' },
    { re: /e-?post|email/i, field: 'email' },
    { re: /förnamn/i, field: 'first_name' },
    { re: /efternamn/i, field: 'last_name' },
    { re: /underskrift|signatur/i, field: 'signature_data' },
    { re: /pdf-blankett/i, field: 'autogiro_pdf' },
    { re: /godkänn|consent/i, field: 'consent' },
    { re: /ort.*datum/i, field: 'signature_place_date' },
    { re: /ämne/i, field: 'subject' },
    { re: /meddelande|message/i, field: 'message' },
    { re: /namn(?!.*efter|.*för)/i, field: 'name' }
  ];

  function ensureFeedbackBox(form) {
    var box = form.querySelector(':scope > .sik-form-feedback');
    if (!box) {
      box = document.createElement('div');
      box.className = 'sik-form-feedback';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      box.style.display = 'none';
      form.appendChild(box);
    }
    return box;
  }

  function showFeedback(form, type, msg) {
    var box = ensureFeedbackBox(form);
    box.className = 'sik-form-feedback sik-form-feedback--' + type;
    box.textContent = msg;
    box.style.display = 'block';
    try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }

  function clearFieldErrors(form) {
    var labels = form.querySelectorAll('.sik-field-error');
    for (var i = 0; i < labels.length; i++) {
      var node = labels[i];
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    var marked = form.querySelectorAll('[data-sik-field-error]');
    for (var j = 0; j < marked.length; j++) {
      marked[j].removeAttribute('data-sik-field-error');
      marked[j].setAttribute('aria-invalid', 'false');
    }
  }

  function detectFieldFromMessage(msg) {
    if (!msg) return '';
    for (var i = 0; i < FIELD_HINTS.length; i++) {
      if (FIELD_HINTS[i].re.test(msg)) return FIELD_HINTS[i].field;
    }
    return '';
  }

  function showFieldError(form, fieldName, message) {
    if (!fieldName) return;
    var input = form.elements[fieldName];
    if (!input) return;
    var target = input.length ? input[0] : input;
    if (!target.tagName) return;

    target.setAttribute('aria-invalid', 'true');
    target.setAttribute('data-sik-field-error', '1');

    // Clear any prior error label tied to this field.
    var prior = form.querySelector('.sik-field-error[data-sik-for="' + fieldName + '"]');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    var label = document.createElement('p');
    label.className = 'sik-field-error';
    label.setAttribute('data-sik-for', fieldName);
    label.setAttribute('role', 'alert');
    label.textContent = message;

    var anchor = target.parentNode;
    if (anchor && anchor.classList && anchor.classList.contains('form-group')) {
      anchor.appendChild(label);
    } else if (anchor) {
      anchor.insertBefore(label, target.nextSibling);
    }

    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus({ preventScroll: true });
    } catch (e) {}
  }

  function ensureHidden(form, name, value) {
    var input = form.elements[name];
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = value || '';
    return input;
  }

  function ensureHoneypot(form) {
    if (form.elements.website) return;
    var wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.left = '-10000px';
    wrap.style.width = '1px';
    wrap.style.height = '1px';
    wrap.style.overflow = 'hidden';
    wrap.setAttribute('aria-hidden', 'true');

    var label = document.createElement('label');
    label.textContent = 'Lämna tomt';

    var input = document.createElement('input');
    input.type = 'text';
    input.name = 'website';
    input.tabIndex = -1;
    input.autocomplete = 'off';

    label.appendChild(input);
    wrap.appendChild(label);
    form.appendChild(wrap);
  }

  function endpointUrl() {
    return new URL(ENDPOINT, window.location.href).toString();
  }

  function isStaticOnly() {
    return window.location.protocol === 'file:' ||
      window.location.hostname.indexOf('github.io') !== -1;
  }

  function getServerConfig() {
    if (window.location.protocol === 'file:') {
      return Promise.reject(new Error('Forms require a hosted PHP server.'));
    }
    if (!serverConfigPromise) {
      serverConfigPromise = fetch(endpointUrl(), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (!data || !data.success || !data.csrf_token) {
            throw new Error('CSRF token missing.');
          }
          return data;
        });
    }
    return serverConfigPromise;
  }

  function loadTurnstileScript() {
    if (turnstileScriptLoaded) return Promise.resolve();
    if (turnstileScriptPromise) return turnstileScriptPromise;

    turnstileScriptPromise = new Promise(function (resolve, reject) {
      window.__sikTurnstileOnload = function () {
        turnstileScriptLoaded = true;
        resolve();
      };
      var script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      script.onerror = function () { reject(new Error('Turnstile script failed to load.')); };
      document.head.appendChild(script);
    });
    return turnstileScriptPromise;
  }

  function renderTurnstile(form, siteKey) {
    if (!siteKey) return;
    var slot = form.querySelector('[data-sik-turnstile]');
    if (!slot) {
      slot = document.createElement('div');
      slot.setAttribute('data-sik-turnstile', '1');
      slot.className = 'sik-turnstile-slot';
      var submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn && submitBtn.parentNode) {
        submitBtn.parentNode.insertBefore(slot, submitBtn);
      } else {
        form.appendChild(slot);
      }
    }
    if (slot.dataset.sikRendered === '1') return;
    slot.dataset.sikRendered = '1';

    loadTurnstileScript().then(function () {
      if (window.turnstile && typeof window.turnstile.render === 'function') {
        window.turnstile.render(slot, {
          sitekey: siteKey,
          theme: 'light',
          size: 'flexible'
        });
      }
    }).catch(function () {
      // Silently degrade if Turnstile can't load — backend still has CSRF + honeypot.
    });
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.dataset.originalLabel = btn.tagName === 'BUTTON' ? btn.textContent : btn.value;
      btn.disabled = true;
      if (btn.tagName === 'BUTTON') btn.textContent = 'Skickar...';
      else btn.value = 'Skickar...';
      return;
    }
    btn.disabled = false;
    if (btn.dataset.originalLabel) {
      if (btn.tagName === 'BUTTON') btn.textContent = btn.dataset.originalLabel;
      else btn.value = btn.dataset.originalLabel;
    }
  }

  function attach(form) {
    if (!form || form.dataset.sikReady) return;
    form.dataset.sikReady = '1';
    form.setAttribute('action', ENDPOINT);
    form.setAttribute('method', 'POST');
    form.setAttribute('autocomplete', 'on');

    ensureHidden(form, 'csrf_token', '');
    ensureHoneypot(form);

    getServerConfig()
      .then(function (cfg) {
        ensureHidden(form, 'csrf_token', cfg.csrf_token);
        if (cfg.turnstile_enabled && cfg.turnstile_site_key) {
          renderTurnstile(form, cfg.turnstile_site_key);
        }
      })
      .catch(function () {});

    // Clear field-error state as user edits.
    form.addEventListener('input', function (event) {
      var target = event.target;
      if (target && target.hasAttribute && target.hasAttribute('data-sik-field-error')) {
        target.removeAttribute('data-sik-field-error');
        target.setAttribute('aria-invalid', 'false');
        var pname = target.getAttribute('name');
        var label = form.querySelector('.sik-field-error[data-sik-for="' + pname + '"]');
        if (label && label.parentNode) label.parentNode.removeChild(label);
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearFieldErrors(form);

      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      setButtonLoading(btn, true);

      if (isStaticOnly() && typeof form.sikStaticSubmit === 'function') {
        Promise.resolve(form.sikStaticSubmit())
          .then(function (data) {
            showFeedback(form, 'success',
              (data && data.message) ? data.message : 'PDF-blanketten är sparad på din enhet.');
          })
          .catch(function (error) {
            showFeedback(form, 'error',
              (error && error.message) ? error.message : 'PDF kunde inte sparas.');
          })
          .then(function () {
            setButtonLoading(btn, false);
          });
        return;
      }

      getServerConfig()
        .then(function (cfg) {
          ensureHidden(form, 'csrf_token', cfg.csrf_token);
          if (typeof form.sikBeforeSubmit === 'function') {
            return Promise.resolve(form.sikBeforeSubmit()).then(function () { return cfg; });
          }
          return cfg;
        })
        .then(function () {
          return fetch(endpointUrl(), {
            method: 'POST',
            body: new FormData(form),
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
          });
        })
        .then(function (response) {
          return response.text().then(function (text) {
            var data = null;
            try {
              data = JSON.parse(text);
            } catch (e) {
              var lower = text.toLowerCase();
              if (lower.indexOf('post content-length') !== -1 || lower.indexOf('exceeds the limit') !== -1) {
                data = { success: false, message: 'PDF-filen blev för stor för den lokala PHP-servern. Försök igen efter att sidan laddats om.' };
              } else if (lower.indexOf('failed to connect to mailserver') !== -1) {
                data = { success: false, message: 'PHP kan inte skicka e-post lokalt utan SMTP/webbhotell.' };
              } else {
                data = { success: false, message: 'Servern svarade inte med giltig JSON. Ladda om sidan och försök igen.' };
              }
            }
            if (!response.ok && data && !data.message) {
              data.message = 'Serverfel (' + response.status + ').';
            }
            data.__httpStatus = response.status;
            return data;
          });
        })
        .then(function (data) {
          if (data && data.success) {
            showFeedback(form, 'success', data.message || 'Tack! Formuläret är skickat.');
            form.reset();
            var msg = form.querySelector('#support-message');
            if (msg) msg.value = '';
            // Reset Turnstile widget after a successful submit so the next attempt re-challenges.
            if (window.turnstile && typeof window.turnstile.reset === 'function') {
              try { window.turnstile.reset(); } catch (err) {}
            }
            serverConfigPromise = null;
            return getServerConfig().then(function (cfg) {
              ensureHidden(form, 'csrf_token', cfg.csrf_token);
            }).catch(function () {});
          }
          var message = (data && data.message) ? data.message : 'Något gick fel. Försök igen senare.';
          showFeedback(form, 'error', message);
          // Try to highlight the field that failed validation.
          var field = data && data.field ? data.field : detectFieldFromMessage(message);
          if (data && data.__httpStatus === 422) {
            showFieldError(form, field, message);
          }
        })
        .catch(function (error) {
          var message = error && error.message && error.message.indexOf('PDF') !== -1
            ? error.message
            : 'Anslutningsfel. Kontrollera att sidan körs på webbhotellet och försök igen.';
          showFeedback(form, 'error', message);
        })
        .then(function () {
          setButtonLoading(btn, false);
        });
    });
  }

  function init() {
    var forms = document.querySelectorAll('form[data-sik-form]');
    for (var i = 0; i < forms.length; i++) attach(forms[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
