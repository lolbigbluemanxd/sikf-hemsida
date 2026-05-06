/*
 * SIKF secure form handler.
 * Sends all <form data-sikf-form> submissions to the local PHP backend.
 */
(function () {
  'use strict';

  var ENDPOINT = 'sendemail.php';
  var csrfPromise = null;

  function ensureFeedbackBox(form) {
    var box = form.querySelector(':scope > .sikf-form-feedback');
    if (!box) {
      box = document.createElement('div');
      box.className = 'sikf-form-feedback';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      box.style.display = 'none';
      form.appendChild(box);
    }
    return box;
  }

  function showFeedback(form, type, msg) {
    var box = ensureFeedbackBox(form);
    box.className = 'sikf-form-feedback sikf-form-feedback--' + type;
    box.textContent = msg;
    box.style.display = 'block';
    try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
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

  function getCsrfToken() {
    if (window.location.protocol === 'file:') {
      return Promise.reject(new Error('Forms require a hosted PHP server.'));
    }
    if (!csrfPromise) {
      csrfPromise = fetch(endpointUrl(), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (!data || !data.success || !data.csrf_token) {
            throw new Error('CSRF token missing.');
          }
          return data.csrf_token;
        });
    }
    return csrfPromise;
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
    if (!form || form.dataset.sikfFormReady) return;
    form.dataset.sikfFormReady = '1';
    form.setAttribute('action', ENDPOINT);
    form.setAttribute('method', 'POST');
    form.setAttribute('autocomplete', 'on');

    ensureHidden(form, 'csrf_token', '');
    ensureHoneypot(form);

    getCsrfToken()
      .then(function (token) { ensureHidden(form, 'csrf_token', token); })
      .catch(function () {});

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      setButtonLoading(btn, true);

      if (isStaticOnly() && typeof form.sikfStaticSubmit === 'function') {
        Promise.resolve(form.sikfStaticSubmit())
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

      getCsrfToken()
        .then(function (token) {
          ensureHidden(form, 'csrf_token', token);
          if (typeof form.sikfBeforeSubmit === 'function') {
            return Promise.resolve(form.sikfBeforeSubmit()).then(function () {
              return token;
            });
          }
          return token;
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
            return data;
          });
        })
        .then(function (data) {
          if (data && data.success) {
            showFeedback(form, 'success', data.message || 'Tack! Formuläret är skickat.');
            form.reset();
            var msg = form.querySelector('#support-message');
            if (msg) msg.value = '';
            csrfPromise = null;
            return getCsrfToken().then(function (token) {
              ensureHidden(form, 'csrf_token', token);
            }).catch(function () {});
          }
          showFeedback(form, 'error',
            (data && data.message) ? data.message : 'Något gick fel. Försök igen senare.');
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
    var forms = document.querySelectorAll('form[data-sikf-form]');
    for (var i = 0; i < forms.length; i++) attach(forms[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
