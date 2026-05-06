/*
 * Prepared SIKF BankID flow.
 * Safe-by-default: starts real signing only when bankid.php is configured with
 * a real BankID/Autogiro provider.
 */
(function () {
  'use strict';

  var ENDPOINT = 'bankid.php';
  var csrfPromise = null;

  function endpointUrl() {
    return new URL(ENDPOINT, window.location.href).toString();
  }

  function getToken() {
    if (window.location.protocol === 'file:') {
      return Promise.reject(new Error('BankID requires a PHP server.'));
    }
    if (!csrfPromise) {
      csrfPromise = fetch(endpointUrl(), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (!data || !data.csrf_token) throw new Error('BankID token missing.');
          return data.csrf_token;
        });
    }
    return csrfPromise;
  }

  function formValue(form, name) {
    var field = form.elements[name];
    return field ? field.value.trim() : '';
  }

  function setText(panel, selector, text) {
    var node = panel.querySelector(selector);
    if (node) node.textContent = text;
  }

  function setState(panel, state, title, message) {
    panel.setAttribute('data-bankid-state', state);
    setText(panel, '[data-bankid-title]', title);
    setText(panel, '[data-bankid-message]', message);
  }

  function payload(form, token, action) {
    return {
      action: action || 'start',
      csrf_token: token,
      amount: formValue(form, 'amount'),
      first_name: formValue(form, 'first_name'),
      last_name: formValue(form, 'last_name'),
      email: formValue(form, 'email'),
      personal_number: formValue(form, 'personal_number'),
      phone: formValue(form, 'phone'),
      bank: formValue(form, 'bank'),
      payment_method: formValue(form, 'payment_method')
    };
  }

  function postBankId(data) {
    return fetch(endpointUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    }).then(function (response) {
      return response.json().catch(function () {
        return { success: false, message: 'BankID-servern svarade inte med giltig JSON.' };
      }).then(function (body) {
        body.httpStatus = response.status;
        return body;
      });
    });
  }

  function start(form, panel) {
    var startButton = panel.querySelector('[data-bankid-start]');
    if (startButton) startButton.disabled = true;
    setState(panel, 'loading', 'Förbereder BankID', 'Kontrollerar att BankID-kopplingen är aktiverad...');

    getToken()
      .then(function (token) { return postBankId(payload(form, token, 'start')); })
      .then(function (data) {
        if (data && data.success) {
          setState(panel, 'active', 'Öppna BankID', data.message || 'Skanna QR-koden med BankID för att signera.');
          return;
        }

        if (data && data.status === 'provider_not_configured') {
          setState(panel, 'prepared',
            'BankID är förberett',
            data.message || 'Skicka anmälan så kontaktar SIKF dig för signering när rutinen är klar.');
          return;
        }

        setState(panel, 'error',
          'BankID kunde inte startas',
          (data && data.message) ? data.message : 'Försök igen eller skicka anmälan till SIKF.');
      })
      .catch(function () {
        setState(panel, 'error',
          'BankID kräver webbserver',
          'Kör hemsidan på PHP-server eller webbhotell för att testa BankID-förberedelsen.');
      })
      .then(function () {
        if (startButton) startButton.disabled = false;
      });
  }

  function init() {
    var form = document.getElementById('donor-flow');
    var panel = document.querySelector('[data-bankid-panel]');
    if (!form || !panel) return;

    var startButton = panel.querySelector('[data-bankid-start]');
    if (startButton) {
      startButton.addEventListener('click', function () {
        start(form, panel);
      });
    }

    form.addEventListener('sikf:donor-step', function (event) {
      if (event.detail && event.detail.step === 5) {
        start(form, panel);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
