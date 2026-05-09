/*
 * SIK monthly donor and autogiro flow.
 * Keeps the page script-free so CSP can block inline JavaScript.
 */
(function () {
  var form = document.getElementById('donor-flow');
  if (!form) return;

  var currentStep = 1;
  var amount = 150;
  var amountInput = document.getElementById('amount-input');
  var customWrap = form.querySelector('.custom-amount-wrap');
  var customAmount = document.getElementById('custom-amount');
  var autogiroFields = {
    name: form.querySelector('[data-ag="name"]'),
    address: form.querySelector('[data-ag="address"]'),
    personal: form.querySelector('[data-ag="personal"]'),
    bank: form.querySelector('[data-ag="bank"]'),
    account: form.querySelector('[data-ag="account"]'),
    placeDate: form.querySelector('[data-ag="placeDate"]')
  };
  var signatureCanvas = document.getElementById('signature-canvas');
  var signatureInput = document.getElementById('signature-data');
  var signatureModal = document.getElementById('signature-modal');
  var signatureOpen = form.querySelector('.signature-open');
  var signatureClear = signatureModal ? signatureModal.querySelector('.signature-clear') : null;
  var signatureCancel = signatureModal ? signatureModal.querySelector('.signature-cancel') : null;
  var signatureSave = signatureModal ? signatureModal.querySelector('.signature-save') : null;
  var signaturePreview = document.getElementById('signature-preview-image');
  var signatureStatus = form.querySelector('[data-signature-status]');
  var signatureBox = form.querySelector('.signature-box');
  var autogiroPdfInput = document.getElementById('autogiro-pdf-data');
  var autogiroPdfFilenameInput = document.getElementById('autogiro-pdf-filename');
  var signatureHasInk = false;
  var signatureImage = '';
  var resizeSignatureCanvas = function () {};
  var donorPage = form.closest ? form.closest('.monthly-donor-page') : null;

  function showStep(step) {
    currentStep = step;
    Array.prototype.forEach.call(form.querySelectorAll('.donor-step'), function (panel) {
      panel.classList.toggle('active', Number(panel.getAttribute('data-step')) === step);
    });
    Array.prototype.forEach.call(form.querySelectorAll('.flow-progress span'), function (dot) {
      dot.classList.toggle('active', Number(dot.getAttribute('data-progress')) <= step);
    });
    if (donorPage) donorPage.classList.toggle('is-autogiro-review', step === 5);
    updateSummary();
    try {
      form.dispatchEvent(new CustomEvent('sik:donor-step', { detail: { step: step } }));
    } catch (e) {}
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateAmount(newAmount) {
    amount = Number(newAmount) || 0;
    amountInput.value = amount;
    Array.prototype.forEach.call(form.querySelectorAll('[data-summary-amount]'), function (node) {
      node.textContent = amount || 0;
    });
  }

  function formValue(name) {
    var field = form.elements[name];
    return field ? field.value.trim() : '';
  }

  function renderSummary(summary, lines) {
    summary.textContent = '';
    if (!lines.length) {
      var empty = document.createElement('p');
      empty.textContent = 'Fyll i uppgifterna i steg 2.';
      summary.appendChild(empty);
      return;
    }
    lines.forEach(function (line) {
      var p = document.createElement('p');
      p.textContent = line;
      summary.appendChild(p);
    });
  }

  function setAg(name, value) {
    if (autogiroFields[name]) autogiroFields[name].textContent = value || '—';
  }

  function updateSummary() {
    var fullName = [formValue('first_name'), formValue('last_name')].filter(Boolean).join(' ');
    var addressLine = [formValue('address'), [formValue('postal_code'), formValue('city')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    var lines = [
      fullName,
      formValue('personal_number'),
      formValue('address'),
      [formValue('postal_code'), formValue('city')].filter(Boolean).join(' '),
      formValue('email'),
      formValue('phone'),
      formValue('bank'),
      formValue('bank_account')
    ].filter(Boolean);
    var summary = document.getElementById('donor-summary');
    if (summary) renderSummary(summary, lines);

    setAg('name', fullName);
    setAg('address', addressLine);
    setAg('personal', formValue('personal_number'));
    setAg('bank', formValue('bank'));
    setAg('account', formValue('bank_account'));
    setAg('placeDate', formValue('signature_place_date'));

    document.getElementById('support-message').value =
      'Belopp: ' + amount + ' kr/månad\n' +
      'Personnummer: ' + formValue('personal_number') + '\n' +
      'Namn: ' + fullName + '\n' +
      'Adress: ' + formValue('address') + '\n' +
      'Postnummer/stad: ' + [formValue('postal_code'), formValue('city')].filter(Boolean).join(' ') + '\n' +
      'Telefon: ' + formValue('phone') + '\n' +
      'Betalsätt: ' + (form.elements.payment_method.value || '') + '\n' +
      'Bank: ' + formValue('bank') + '\n' +
      'Clearing/konto: ' + formValue('bank_account') + '\n' +
      'Ort och datum: ' + formValue('signature_place_date');
  }

  function setupSignaturePad() {
    if (!signatureCanvas) return;
    var ctx = signatureCanvas.getContext('2d');
    var drawing = false;

    function resizeCanvas() {
      var oldSignature = signatureHasInk ? signatureCanvas.toDataURL('image/png') : '';
      var rect = signatureCanvas.getBoundingClientRect();
      var ratio = window.devicePixelRatio || 1;
      signatureCanvas.width = Math.max(1, Math.floor(rect.width * ratio));
      signatureCanvas.height = Math.max(1, Math.floor(rect.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#111';
      if (oldSignature || signatureImage) {
        var img = new Image();
        img.onload = function () { ctx.drawImage(img, 0, 0, rect.width, rect.height); };
        img.src = oldSignature || signatureImage;
      }
    }

    function point(event) {
      var rect = signatureCanvas.getBoundingClientRect();
      var touch = event.touches && event.touches[0] ? event.touches[0] : event;
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };
    }

    function start(event) {
      event.preventDefault();
      drawing = true;
      var p = point(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function move(event) {
      if (!drawing) return;
      event.preventDefault();
      var p = point(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      signatureHasInk = true;
    }

    function end() {
      if (!drawing) return;
      drawing = false;
    }

    resizeSignatureCanvas = resizeCanvas;
    window.addEventListener('resize', function () {
      if (signatureModal && !signatureModal.hidden) resizeCanvas();
    });
    signatureCanvas.addEventListener('mousedown', start);
    signatureCanvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    signatureCanvas.addEventListener('touchstart', start, { passive: false });
    signatureCanvas.addEventListener('touchmove', move, { passive: false });
    signatureCanvas.addEventListener('touchend', end);

    if (signatureClear) {
      signatureClear.addEventListener('click', function () {
        ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
        signatureHasInk = false;
      });
    }
  }

  function updateSignaturePreview() {
    if (!signaturePreview || !signatureStatus) return;
    if (signatureImage) {
      signaturePreview.src = signatureImage;
      signaturePreview.hidden = false;
      signatureStatus.hidden = true;
      if (signatureBox) {
        signatureBox.classList.add('is-signed');
        signatureBox.classList.remove('signature-missing');
      }
    } else {
      signaturePreview.removeAttribute('src');
      signaturePreview.hidden = true;
      signatureStatus.hidden = false;
      signatureStatus.textContent = 'Underskrift saknas';
      if (signatureBox) {
        signatureBox.classList.remove('is-signed');
        signatureBox.classList.add('signature-missing');
      }
    }
  }

  function openSignatureModal() {
    if (!signatureModal) return;
    signatureModal.hidden = false;
    document.body.classList.add('signature-modal-open');
    signatureHasInk = false;
    setTimeout(resizeSignatureCanvas, 30);
  }

  function closeSignatureModal() {
    if (!signatureModal) return;
    signatureModal.hidden = true;
    document.body.classList.remove('signature-modal-open');
  }

  function saveSignature() {
    if (!signatureCanvas) return;
    if (!signatureHasInk && !signatureImage) {
      alert('Skriv din underskrift innan du sparar.');
      return;
    }
    signatureImage = signatureCanvas.toDataURL('image/png');
    if (signatureInput) signatureInput.value = signatureImage;
    updateSignaturePreview();
    closeSignatureModal();
  }

  function printableHtml() {
    var clone = document.getElementById('autogiro-preview').cloneNode(true);
    var logo = clone.querySelector('.bankgirot-logo img');
    if (logo) {
      logo.src = new URL(logo.getAttribute('src'), window.location.href).toString();
    }
    var unsigned = clone.querySelector('[data-signature-status]');
    if (unsigned && signatureImage) unsigned.parentNode.removeChild(unsigned);
    var previewImage = clone.querySelector('#signature-preview-image');
    if (previewImage && signatureImage) {
      previewImage.src = signatureImage;
      previewImage.hidden = false;
    }
    var clear = clone.querySelector('.signature-clear');
    if (clear) clear.parentNode.removeChild(clear);
    var open = clone.querySelector('.signature-open');
    if (open) open.parentNode.removeChild(open);
    return '<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Autogiroanmälan SIK</title><style>' +
      '@page{size:A4 portrait;margin:11mm}*{box-sizing:border-box}body{color:#111;font-family:Georgia,\"Times New Roman\",serif;margin:0}.bg-autogiro-form{border:0;margin:0;padding:0}.bg-form-top{align-items:flex-start;display:flex;justify-content:space-between;margin-bottom:17px}.bankgirot-logo{align-items:center;display:flex;margin-bottom:7px}.bankgirot-logo img{display:block;height:auto;width:150px}.bankgirot-logo-text{align-items:center;color:#c41230;display:inline-flex;font-family:Georgia,\"Times New Roman\",serif;font-size:34px;font-weight:700;letter-spacing:-1px;line-height:1}.bankgirot-logo-text span{align-items:center;background:#c41230;color:#fff;display:inline-flex;font-size:24px;height:34px;justify-content:center;letter-spacing:-1px;margin-right:4px;width:23px}.bg-form-top p{color:#333;font-size:11px;line-height:1.2;margin:0}.bg-form-top h3{color:#333;font-family:Arial,sans-serif;font-size:18px;font-weight:800;line-height:1.15;margin:6px 0 0;text-align:right}.bg-form-columns,.bg-form-lower{display:grid;gap:18px;grid-template-columns:1fr 1fr}.bg-column h4,.bg-mandate-text h4{color:#333;font-family:Arial,sans-serif;font-size:13px;font-weight:800;margin:0 0 6px}.bg-field{border:1px solid #777;border-bottom:0;min-height:34px;padding:2px 6px 4px}.bg-field:last-of-type{border-bottom:1px solid #777}.bg-field-tall{min-height:56px}.bg-field label{color:#555;display:block;font-size:9.5px;font-weight:700;line-height:1.05;margin:0 0 2px}.bg-field span,.bg-field strong{color:#111;display:block;font-size:12px;font-weight:400;line-height:1.2;min-height:14px}.bg-field strong{font-weight:700}.bg-required{color:#333;font-size:10px;line-height:1.1;margin:5px 0 0}.bg-clearing-note{color:#333;font-size:8px;line-height:1.08;margin:8px 0 0}.bg-form-lower{align-items:start;margin-top:18px}.bg-mandate-text p{color:#222;font-size:12px;line-height:1.18;margin:0}.bg-signature-field{min-height:78px}.signature-preview{border-bottom:1px solid #777;min-height:39px}.signature-preview img{display:block;max-height:37px;max-width:100%;object-fit:contain;object-position:left bottom}.signature-preview em,.signature-open,.signature-clear{display:none}.bg-privacy-text{color:#333;font-size:10px;line-height:1.08;margin:20px 0 0}.bg-copyright{color:#555;font-size:8px;margin:34px 0 0}' +
      '</style></head><body>' + clone.outerHTML + '</body></html>';
  }

  function prepareExportClone() {
    var source = document.getElementById('autogiro-preview');
    var clone = source.cloneNode(true);
    var logo = clone.querySelector('.bankgirot-logo img');
    if (logo) {
      logo.src = new URL(logo.getAttribute('src'), window.location.href).toString();
    }
    var unsigned = clone.querySelector('[data-signature-status]');
    if (unsigned && signatureImage) unsigned.parentNode.removeChild(unsigned);
    var previewImage = clone.querySelector('#signature-preview-image');
    if (previewImage && signatureImage) {
      previewImage.src = signatureImage;
      previewImage.hidden = false;
    }
    var clear = clone.querySelector('.signature-clear');
    if (clear) clear.parentNode.removeChild(clear);
    var open = clone.querySelector('.signature-open');
    if (open) open.parentNode.removeChild(open);
    clone.classList.add('pdf-export-form');
    return clone;
  }

  function requireSignature() {
    if (signatureImage) return true;
    if (signatureBox) {
      signatureBox.classList.add('signature-attention');
      setTimeout(function () { signatureBox.classList.remove('signature-attention'); }, 1400);
    }
    alert('Underskrift krävs. Tryck på "Underskriv här", skriv din signatur och spara den först.');
    return false;
  }

  function fileSafeName() {
    return ([formValue('first_name'), formValue('last_name')]
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-') || 'blankett');
  }

  function autogiroPdfFilename() {
    return 'sik-autogiro-' + fileSafeName() + '.pdf';
  }

  function printAutogiro() {
    updateSummary();
    if (!requireSignature()) return;
    var printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      document.body.classList.add('is-printing-autogiro');
      window.print();
      setTimeout(function () { document.body.classList.remove('is-printing-autogiro'); }, 1000);
      return;
    }
    printWindow.document.open();
    printWindow.document.write(printableHtml());
    printWindow.document.close();
    printWindow.focus();
    setTimeout(function () {
      printWindow.print();
      printWindow.close();
    }, 300);
  }

  function createAutogiroPdf(options) {
    options = options || {};
    updateSummary();
    if (!requireSignature()) return Promise.resolve({ ok: false });
    if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
      if (!options.silent) {
        alert('PDF-exporten kunde inte laddas. Använd "Skriv ut blankett" och välj Spara som PDF.');
        printAutogiro();
      }
      return Promise.resolve({ ok: false });
    }

    var button = options.button || null;
    if (button) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = options.loadingText || 'Skapar PDF...';
      button.disabled = true;
    }
    document.body.classList.add('is-exporting-autogiro');
    var exportWrap = document.createElement('div');
    exportWrap.className = 'pdf-export-stage';
    var exportClone = prepareExportClone();
    exportWrap.appendChild(exportClone);
    document.body.appendChild(exportWrap);

    return window.html2canvas(exportClone, {
      backgroundColor: '#ffffff',
      allowTaint: true,
      scale: 1.65,
      useCORS: true
    }).then(function (canvas) {
      var pdf = new window.jspdf.jsPDF('p', 'mm', 'a4', true);
      var pageWidth = 210;
      var pageHeight = 297;
      var imgWidth = pageWidth - 18;
      var imgHeight = canvas.height * imgWidth / canvas.width;
      var x = (pageWidth - imgWidth) / 2;
      var y = 8;
      if (imgHeight > pageHeight - 14) {
        imgHeight = pageHeight - 14;
        imgWidth = canvas.width * imgHeight / canvas.height;
        x = (pageWidth - imgWidth) / 2;
      }
      var imageData = canvas.toDataURL('image/jpeg', 0.86);
      pdf.addImage(imageData, 'JPEG', x, y, imgWidth, imgHeight, undefined, 'MEDIUM');
      if (options.save) pdf.save(autogiroPdfFilename());
      return {
        ok: true,
        filename: autogiroPdfFilename(),
        dataUri: options.dataUri ? pdf.output('datauristring') : ''
      };
    }).catch(function () {
      if (!options.silent) alert('PDF kunde inte skapas automatiskt. Använd "Skriv ut blankett" och välj Spara som PDF.');
      return { ok: false };
    }).then(function (ok) {
      document.body.classList.remove('is-exporting-autogiro');
      if (exportWrap.parentNode) exportWrap.parentNode.removeChild(exportWrap);
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalLabel || 'Ladda ner PDF';
      }
      return ok;
    });
  }

  function downloadAutogiro() {
    return createAutogiroPdf({
      button: form.querySelector('.download-autogiro'),
      loadingText: 'Skapar PDF...',
      save: true
    }).then(function (result) {
      return !!(result && result.ok);
    });
  }

  function prepareAutogiroSubmit() {
    return createAutogiroPdf({
      loadingText: 'Skapar PDF...',
      dataUri: true,
      silent: true
    }).then(function (result) {
      if (!result || !result.ok || !result.dataUri) {
        throw new Error('PDF kunde inte skapas.');
      }
      if (autogiroPdfInput) autogiroPdfInput.value = result.dataUri;
      if (autogiroPdfFilenameInput) autogiroPdfFilenameInput.value = result.filename || autogiroPdfFilename();
    });
  }

  function saveAutogiroStatic() {
    return createAutogiroPdf({
      button: form.querySelector('button[type="submit"]'),
      loadingText: 'Sparar PDF...',
      save: true
    }).then(function (result) {
      if (!result || !result.ok) {
        throw new Error('PDF kunde inte sparas.');
      }
      return { message: 'PDF-blanketten är sparad på din enhet.' };
    });
  }

  Array.prototype.forEach.call(form.querySelectorAll('.amount-choice'), function (button) {
    button.addEventListener('click', function () {
      Array.prototype.forEach.call(form.querySelectorAll('.amount-choice'), function (item) { item.classList.remove('active'); });
      button.classList.add('active');
      var selected = button.getAttribute('data-amount');
      if (selected === 'other') {
        customWrap.hidden = false;
        customAmount.focus();
        updateAmount(customAmount.value);
      } else {
        customWrap.hidden = true;
        updateAmount(selected);
      }
    });
  });

  customAmount.addEventListener('input', function () {
    updateAmount(customAmount.value);
  });

  Array.prototype.forEach.call(form.querySelectorAll('.payment-choice input'), function (radio) {
    radio.addEventListener('change', function () {
      Array.prototype.forEach.call(form.querySelectorAll('.payment-choice'), function (choice) { choice.classList.remove('active'); });
      radio.closest('.payment-choice').classList.add('active');
      updateSummary();
    });
  });

  Array.prototype.forEach.call(form.querySelectorAll('.flow-next'), function (button) {
    button.addEventListener('click', function () {
      if (currentStep === 1 && amount < 1) {
        alert('Välj eller ange ett belopp.');
        return;
      }
      if (currentStep === 2 && (!formValue('first_name') || !formValue('last_name') || !formValue('email'))) {
        alert('Fyll i förnamn, efternamn och e-post.');
        return;
      }
      if (currentStep === 2 && !formValue('personal_number')) {
        alert('Fyll i personnummer. Det behövs för autogiroblanketten.');
        return;
      }
      if (currentStep === 3 && !form.elements.consent.checked) {
        alert('Du behöver godkänna att föreningen kontaktar dig.');
        return;
      }
      if (currentStep === 4 && (!formValue('bank') || !formValue('bank_account') || !formValue('signature_place_date'))) {
        alert('Fyll i bank, clearing/kontonummer samt ort och datum.');
        return;
      }
      showStep(Math.min(currentStep + 1, 5));
    });
  });

  Array.prototype.forEach.call(form.querySelectorAll('.flow-back'), function (button) {
    button.addEventListener('click', function () {
      showStep(Math.max(currentStep - 1, 1));
    });
  });

  form.querySelector('.auto-fill-button').addEventListener('click', function () {
    alert('Automatisk ifyllnad kan kopplas in senare. Fyll i uppgifterna manuellt just nu.');
  });

  if (signatureOpen) signatureOpen.addEventListener('click', openSignatureModal);
  if (signatureCancel) signatureCancel.addEventListener('click', closeSignatureModal);
  if (signatureSave) signatureSave.addEventListener('click', saveSignature);
  if (signatureModal) {
    signatureModal.addEventListener('click', function (event) {
      if (event.target === signatureModal) closeSignatureModal();
    });
  }

  var printButton = form.querySelector('.print-autogiro');
  if (printButton) {
    printButton.addEventListener('click', function () {
      printAutogiro();
    });
  }

  var downloadButton = form.querySelector('.download-autogiro');
  if (downloadButton) downloadButton.addEventListener('click', downloadAutogiro);

  form.sikBeforeSubmit = prepareAutogiroSubmit;
  form.sikStaticSubmit = saveAutogiroStatic;

  // ---------- Draft persistence (privacy-aware) ----------
  // Saves non-sensitive fields to localStorage so the user doesn't lose progress
  // when they switch tabs or refresh. Personnummer, bank account number and
  // signature are NEVER saved — those are personally sensitive.
  var DRAFT_KEY = 'sik:donor-flow:draft:v1';
  var DRAFT_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'address', 'postal_code', 'city', 'bank', 'signature_place_date', 'amount'];
  var draftSaveTimer = null;
  var draftNotice = null;

  function readDraft() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeDraft(data) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      }
    } catch (e) {}
  }

  function clearDraft() {
    try {
      if (window.localStorage) window.localStorage.removeItem(DRAFT_KEY);
    } catch (e) {}
    if (draftNotice && draftNotice.parentNode) {
      draftNotice.parentNode.removeChild(draftNotice);
      draftNotice = null;
    }
  }

  function snapshotDraft() {
    var data = { saved_at: Date.now() };
    DRAFT_FIELDS.forEach(function (name) {
      if (form.elements[name]) {
        data[name] = form.elements[name].value;
      }
    });
    return data;
  }

  function scheduleDraftSave() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(function () {
      var snapshot = snapshotDraft();
      var hasContent = false;
      DRAFT_FIELDS.forEach(function (name) {
        if (snapshot[name] && String(snapshot[name]).trim() !== '') hasContent = true;
      });
      if (hasContent) writeDraft(snapshot);
    }, 600);
  }

  function showDraftNotice(savedAt) {
    if (draftNotice) return;
    var step1 = form.querySelector('.donor-step[data-step="1"]');
    if (!step1) return;
    var minutes = Math.max(1, Math.round((Date.now() - Number(savedAt)) / 60000));
    var notice = document.createElement('div');
    notice.className = 'sik-draft-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<span><i class="fa fa-floppy-o"></i> Vi sparade dina uppgifter (utan personnummer/konto) ' +
      'för ungefär ' + minutes + ' minuter sedan. Vill du återuppta?</span>';
    var resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.textContent = 'Fortsätt utkast';
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Rensa';
    notice.appendChild(resumeBtn);
    notice.appendChild(clearBtn);
    step1.insertBefore(notice, step1.firstChild);
    draftNotice = notice;

    resumeBtn.addEventListener('click', function () {
      restoreDraft();
      if (notice.parentNode) notice.parentNode.removeChild(notice);
      draftNotice = null;
    });
    clearBtn.addEventListener('click', clearDraft);
  }

  function restoreDraft() {
    var draft = readDraft();
    if (!draft) return;
    DRAFT_FIELDS.forEach(function (name) {
      if (draft[name] && form.elements[name]) {
        form.elements[name].value = draft[name];
      }
    });
    if (draft.amount) {
      var n = Number(draft.amount);
      if (n > 0) {
        var presets = ['50', '150', '300', '500'];
        Array.prototype.forEach.call(form.querySelectorAll('.amount-choice'), function (b) { b.classList.remove('active'); });
        if (presets.indexOf(String(n)) !== -1) {
          var btn = form.querySelector('.amount-choice[data-amount="' + n + '"]');
          if (btn) btn.classList.add('active');
        } else {
          var other = form.querySelector('.amount-choice[data-amount="other"]');
          if (other) other.classList.add('active');
          if (customWrap) customWrap.hidden = false;
          if (customAmount) customAmount.value = n;
        }
        updateAmount(n);
      }
    }
    updateSummary();
  }

  // Show resume notice if we have a saved draft from less than 7 days ago.
  var existingDraft = readDraft();
  if (existingDraft && existingDraft.saved_at && (Date.now() - Number(existingDraft.saved_at)) < 7 * 86400000) {
    showDraftNotice(existingDraft.saved_at);
  } else if (existingDraft) {
    clearDraft();
  }

  form.addEventListener('input', updateSummary);
  form.addEventListener('input', scheduleDraftSave);
  form.addEventListener('submit', updateSummary);
  // Clear draft when feedback box reports success.
  var observer = (window.MutationObserver) ? new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.target && m.target.classList && m.target.classList.contains('sik-form-feedback--success')) {
        clearDraft();
      }
    });
  }) : null;
  if (observer) {
    observer.observe(form, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }

  updateAmount(150);
  setupSignaturePad();
  updateSignaturePreview();
})();
