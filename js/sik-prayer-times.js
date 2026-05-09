/*
 * SIK prayer times widget
 * Fetches today's prayer times for Trollhättan from api.aladhan.com
 * and populates any element with [data-prayer="<Name>"] on the page.
 *
 * --- CONFIG ---
 * METHOD (calculation method):
 *   13 -> Diyanet (Turkey), closest public AlAdhan method to Awqat Salah.
 *
 * SCHOOL (Asr madhhab):
 *   0  -> Shafi'i / Maliki / Hanbali (1× shadow length)
 *   1  -> Hanafi (2× shadow length, later Asr)
 *
 * LAT_ADJUST (high-latitude adjustment - critical for Sweden in summer):
 *   1  -> Middle of the Night
 *   2  -> One-Seventh of the Night
 *   3  -> Angle Based (recommended for Scandinavia)
 */
(function () {
  'use strict';

  var LAT = 58.2837;          // Trollhättan latitude
  var LNG = 12.2886;          // Trollhättan longitude
  var METHOD = 13;            // Diyanet / Turkey, same tradition as Awqat Salah
  var SCHOOL = 0;             // 0 = Shafi'i, 1 = Hanafi
  var LAT_ADJUST = 2;         // One-seventh high-latitude adjustment
  var TZ = 'Europe/Stockholm';
  var TUNE = '0,-35,0,0,0,5,0,24,0';

  var PRAYERS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayDDMMYYYY() {
    var d = new Date();
    return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear();
  }

  function setText(selector, text) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = text;
  }

  function showError() {
    var err = document.getElementById('sik-prayer-error');
    if (err) err.style.display = 'block';
    PRAYERS.forEach(function (p) {
      setText('[data-prayer="' + p + '"]', '—');
    });
  }

  function loadTimes() {
    if (!window.fetch) { showError(); return; }
    var url = 'https://api.aladhan.com/v1/timings/' + todayDDMMYYYY() +
              '?latitude=' + LAT +
              '&longitude=' + LNG +
              '&method=' + METHOD +
              '&school=' + SCHOOL +
              '&latitudeAdjustmentMethod=' + LAT_ADJUST +
              '&tune=' + encodeURIComponent(TUNE) +
              '&timezonestring=' + encodeURIComponent(TZ);

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (!json || !json.data || !json.data.timings) throw new Error('Bad payload');

        var t = json.data.timings;
        if (window.console && console.info) {
          console.info('SIK bönetider (' + (json.data.meta && json.data.meta.method && json.data.meta.method.name) +
            ', high-lat=' + LAT_ADJUST + ', tune=' + TUNE + '):', t);
        }
        PRAYERS.forEach(function (p) {
          var time = (t[p] || '').slice(0, 5); // strip seconds if any
          setText('[data-prayer="' + p + '"]', time || '—');
        });

        var dateNode = document.getElementById('sik-prayer-date');
        if (dateNode && json.data.date) {
          var d = json.data.date;
          var hijri = d.hijri ?
            ' • Hijri ' + d.hijri.day + ' ' + d.hijri.month.en + ' ' + d.hijri.year : '';
          dateNode.textContent = 'Idag: ' + d.readable + hijri;
        }
      })
      .catch(function (err) {
        if (window.console && console.warn) {
          console.warn('SIK: kunde inte hämta bönetider:', err);
        }
        showError();
      });
  }

  // ---------- Weekly overview ----------
  var weeklyLoaded = false;

  function dayName(d) {
    var names = ['Sön', 'Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör'];
    return names[d.getDay()];
  }

  function addDays(date, days) {
    var d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function loadWeeklyTimes() {
    var container = document.getElementById('sik-weekly-table');
    if (!container || weeklyLoaded) return;
    weeklyLoaded = true;
    container.textContent = 'Hämtar vecka…';

    var today = new Date();
    var promises = [];
    for (var i = 0; i < 7; i++) {
      var d = addDays(today, i);
      var dateStr = pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear();
      var url = 'https://api.aladhan.com/v1/timings/' + dateStr +
                '?latitude=' + LAT +
                '&longitude=' + LNG +
                '&method=' + METHOD +
                '&school=' + SCHOOL +
                '&latitudeAdjustmentMethod=' + LAT_ADJUST +
                '&tune=' + encodeURIComponent(TUNE) +
                '&timezonestring=' + encodeURIComponent(TZ);
      promises.push(fetch(url).then(function (r) { return r.json(); }));
    }

    Promise.all(promises)
      .then(function (responses) {
        var todayKey = pad(today.getDate()) + '-' + pad(today.getMonth() + 1);
        var html = '<table class="table table-striped table-condensed">' +
          '<thead><tr><th>Dag</th><th>Datum</th><th>Fajr</th><th>Soluppgång</th>' +
          '<th>Dhuhr</th><th>Asr</th><th>Maghrib</th><th>Isha</th></tr></thead><tbody>';
        responses.forEach(function (json, idx) {
          if (!json || !json.data) return;
          var t = json.data.timings;
          var d = addDays(today, idx);
          var dateKey = pad(d.getDate()) + '-' + pad(d.getMonth() + 1);
          var rowClass = (dateKey === todayKey) ? ' class="is-today"' : '';
          html += '<tr' + rowClass + '>' +
            '<td>' + dayName(d) + '</td>' +
            '<td>' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '</td>' +
            '<td>' + (t.Fajr || '').slice(0, 5) + '</td>' +
            '<td>' + (t.Sunrise || '').slice(0, 5) + '</td>' +
            '<td>' + (t.Dhuhr || '').slice(0, 5) + '</td>' +
            '<td>' + (t.Asr || '').slice(0, 5) + '</td>' +
            '<td>' + (t.Maghrib || '').slice(0, 5) + '</td>' +
            '<td>' + (t.Isha || '').slice(0, 5) + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
      })
      .catch(function (err) {
        weeklyLoaded = false;
        container.textContent = 'Veckoöversikten kunde inte hämtas. Försök igen.';
        if (window.console && console.warn) console.warn('SIK weekly fetch error:', err);
      });
  }

  function attachWeeklyToggle() {
    var btn = document.getElementById('sik-weekly-toggle');
    var box = document.getElementById('sik-weekly-table');
    if (!btn || !box) return;
    btn.addEventListener('click', function () {
      var isOpen = !box.hidden;
      if (isOpen) {
        box.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = 'Visa hela veckan';
      } else {
        box.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = 'Dölj veckan';
        loadWeeklyTimes();
      }
    });
  }

  function init() {
    loadTimes();
    attachWeeklyToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
