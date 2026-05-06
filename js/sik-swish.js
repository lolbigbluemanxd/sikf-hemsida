/*
 * SIK Swish QR-generator
 * Bygger en levande Swish-QR på alla element med klassen .sik-swish-widget.
 * Använder qrcodejs (laddas separat från CDN) för själva QR-grafiken.
 *
 * --- SETUP ---
 * SIK:s Swish-nummer.
 * Det är 10 siffror utan mellanslag.
 * När besokaren skannar QR med Swish-appen öppnas appen med SIK som
 * mottagare, beloppet förifyllt och meddelandet förifyllt.
 */
(function () {
  'use strict';

  var SWISH_NUMBER = '1231982289';
  var DEFAULT_AMOUNT = 150;
  var DEFAULT_MESSAGE = 'Donation SIK';

  function buildSwishUrl(number, amount, message) {
    // Officiell Swish-deeplink. Skannas QR med Swish-appen öppnar
    // den direkt med förifyllt mottagarnummer + belopp + meddelande.
    var u = 'https://app.swish.nu/1/p/sw/?sw=' + encodeURIComponent(number);
    if (amount && Number(amount) > 0) u += '&amt=' + encodeURIComponent(amount);
    if (message) u += '&msg=' + encodeURIComponent(message);
    u += '&src=qr';
    return u;
  }

  function formatSwishNumber(num) {
    if (!num) return '';
    var clean = String(num).replace(/\D/g, '');
    if (clean.length !== 10) return clean;
    return clean.slice(0, 3) + ' ' + clean.slice(3, 6) + ' ' +
           clean.slice(6, 8) + ' ' + clean.slice(8);
  }

  function attachWidget(widget) {
    var qrTarget = widget.querySelector('.sik-swish-qr');
    if (!qrTarget) return;
    if (typeof window.QRCode === 'undefined') {
      qrTarget.textContent = 'QR-bibliotek kunde inte laddas.';
      return;
    }

    qrTarget.innerHTML = '';
    var qr = new window.QRCode(qrTarget, {
      text: buildSwishUrl(SWISH_NUMBER, DEFAULT_AMOUNT, DEFAULT_MESSAGE),
      width: 220,
      height: 220,
      colorDark: '#0f5a3d',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });

    var amountButtons = widget.querySelectorAll('.sik-swish-amount');
    var customWrap = widget.querySelector('.sik-swish-custom-wrap');
    var customInput = widget.querySelector('.sik-swish-custom');
    var summary = widget.querySelector('.sik-swish-summary');
    var numberDisplay = widget.querySelector('.sik-swish-number');

    if (numberDisplay) numberDisplay.textContent = formatSwishNumber(SWISH_NUMBER);

    function update(amount) {
      var url = buildSwishUrl(SWISH_NUMBER, amount, DEFAULT_MESSAGE);
      qr.clear();
      qr.makeCode(url);
      if (summary) {
        if (amount && Number(amount) > 0) {
          summary.textContent = amount + ' kr • ' + DEFAULT_MESSAGE;
        } else {
          summary.textContent = 'Välj belopp eller skriv eget';
        }
      }
    }

    function setActive(btn) {
      for (var j = 0; j < amountButtons.length; j++) {
        amountButtons[j].classList.remove('active');
      }
      btn.classList.add('active');
    }

    Array.prototype.forEach.call(amountButtons, function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        setActive(btn);
        var v = btn.getAttribute('data-amount');
        if (v === 'custom') {
          if (customWrap) customWrap.style.display = 'block';
          var c = customInput && customInput.value ? Number(customInput.value) : 0;
          update(c);
          if (customInput) customInput.focus();
        } else {
          if (customWrap) customWrap.style.display = 'none';
          update(Number(v));
        }
      });
    });

    if (customInput) {
      customInput.addEventListener('input', function () {
        update(Number(customInput.value) || 0);
      });
    }

    update(DEFAULT_AMOUNT);
  }

  function init() {
    var widgets = document.querySelectorAll('.sik-swish-widget');
    for (var i = 0; i < widgets.length; i++) attachWidget(widgets[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
