/*
 * SIK Google Maps consent overlay.
 * Loads the Maps iframe only after explicit click — avoids leaking the
 * visitor's IP to Google before they've consented.
 */
(function () {
  'use strict';

  function init() {
    var btn = document.getElementById('sik-map-load');
    var consent = document.getElementById('sik-map-consent');
    var wrapper = document.getElementById('sik-map-wrapper');
    if (!btn || !consent || !wrapper) return;

    btn.addEventListener('click', function () {
      var iframe = document.createElement('iframe');
      iframe.title = 'Karta till Somaliska Islamiska Moskén i Trollhättan';
      iframe.src = 'https://www.google.com/maps?q=Lantmannav%C3%A4gen%2042%2C%20461%2060%20Trollh%C3%A4ttan&output=embed';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer-when-downgrade';
      wrapper.insertBefore(iframe, consent);
      if (consent.parentNode) consent.parentNode.removeChild(consent);
      try {
        window.localStorage && window.localStorage.setItem('sik:map-consent:v1', '1');
      } catch (e) {}
    });

    // If user already accepted before, auto-load.
    try {
      if (window.localStorage && window.localStorage.getItem('sik:map-consent:v1') === '1') {
        btn.click();
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
