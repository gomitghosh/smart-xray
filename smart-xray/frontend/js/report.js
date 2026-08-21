/* ============================================================
   SMART XRAY — js/report.js
   Analysis result screen: prediction hero, original vs
   Grad-CAM comparison (zoom / fullscreen / compare slider),
   confidence visualization, clinical summary and the
   professional PDF report generator (jsPDF, CDN).
   ============================================================ */
(function () {
  'use strict';
  var SX = window.SX;
  var RING_C = 2 * Math.PI * 58; // 364.42 — matches .ring r=58

  document.addEventListener('DOMContentLoaded', function () {
    if (document.body.getAttribute('data-page') === 'report') init();
  });

  async function init() {
    var params = new URLSearchParams(window.location.search);
    var id = params.get('id');
    var a = id ? SX.store.get(id) : null;
    if (!a) {
      var done = SX.store.all().filter(function (x) { return x.status === 'COMPLETE'; });
      a = done.sort(function (x, y) { return y.date.localeCompare(x.date); })[0] || null;
    }
    if (!a || a.prediction === 'PENDING') {
      SX.qs('#rp-empty').classList.remove('hidden');
      SX.qs('#rp-body').classList.add('hidden');
      return;
    }
    SX.qs('#rp-empty').classList.add('hidden');
    SX.qs('#rp-body').classList.remove('hidden');

    var user = SX.session();
    var isPneu = a.prediction === 'PNEUMONIA';
    var pair = window.SXAPI.getImagePair(a);
    var role = user ? user.role : 'doctor';

    // ── hero ──
    var hero = SX.qs('#result-hero');
    hero.classList.add(isPneu ? 'is-pneumonia' : 'is-normal');
    SX.qs('#result-title').textContent = isPneu ? 'Pneumonia Detected' : 'No Pneumonia Detected';
    SX.qs('#result-sub').textContent = role === 'patient'
      ? (isPneu
        ? 'Our AI screening found patterns that may be consistent with pneumonia. Please discuss these findings with your doctor — clinical review recommended.'
        : 'Our AI screening did not find patterns consistent with pneumonia. Keep your regular check-ups — clinical review always stays with your doctor.')
      : 'AI Screening Result — clinical review recommended. This is a decision-support finding, not a final diagnosis.';
    SX.qs('#m-aid').textContent = a.id;
    SX.qs('#m-date').textContent = SX.fmtDate(a.date);
    SX.qs('#m-pred').textContent = a.prediction;
    SX.qs('#rp-back-label').textContent = role === 'patient' ? 'Back to My Dashboard' : 'Back to Dashboard';
    SX.qs('#rp-back').href = role === 'patient' ? 'patient-dashboard.html' : 'doctor-dashboard.html';

    // ── images ──
    SX.qs('#img-original').src = pair.original;
    SX.qs('#img-heatmap').src = pair.heatmap;
    SX.qs('#sl-orig').src = pair.original;
    SX.qs('#sl-heatimg').src = pair.heatmap;

    // ── confidence ring + bars (animated) ──
    var conf = a.confidence || 0;
    requestAnimationFrame(function () {
      var ring = SX.qs('#ring-circle');
      ring.style.strokeDasharray = RING_C;
      ring.style.strokeDashoffset = RING_C * (1 - conf / 100);
      SX.countUp(SX.qs('#ring-value'), conf, { dur: 1500, dec: 2, suffix: '%' });
      SX.countUp(SX.qs('#conf-big'), conf, { dur: 1500, dec: 2, suffix: '%' });
    });
    SX.qs('#prob-pneu').textContent = (isPneu ? conf : (100 - conf)).toFixed(2) + '%';
    SX.qs('#prob-normal').textContent = (isPneu ? (100 - conf) : conf).toFixed(2) + '%';
    setTimeout(function () {
      SX.qs('#bar-pneu').style.width = (isPneu ? conf : (100 - conf)) + '%';
      SX.qs('#bar-normal').style.width = (isPneu ? (100 - conf) : conf) + '%';
      SX.qsa('.metric i[data-w]').forEach(function (i) { i.style.width = i.getAttribute('data-w') + '%'; });
    }, 200);
    SX.qs('#conf-pred').outerHTML = SX.badgeHtml(a.prediction, 'conf-pred');

    // ── clinical summary ──
    SX.qs('#s-name').textContent = a.patientName;
    SX.qs('#s-id').textContent = a.patientId;
    SX.qs('#s-age').textContent = a.age ? (a.age + ' years') : '—';
    SX.qs('#s-gender').textContent = a.gender || '—';
    SX.qs('#s-aid').textContent = a.id;
    SX.qs('#s-pred').innerHTML = SX.badgeHtml(a.prediction);
    SX.qs('#s-conf').textContent = conf.toFixed(2) + '%';
    SX.qs('#s-date').textContent = SX.fmtDate(a.date);
    SX.qs('#interpret-text').textContent = isPneu
      ? 'The AI model identified imaging patterns associated with pneumonia. Highlighted regions in the Grad-CAM visualization indicate the areas of the lung field that contributed most strongly to this prediction. Confidence: ' + conf.toFixed(2) + '%. ' + (a.notes ? 'Clinical notes: ' + a.notes : '')
      : 'The AI model did not identify imaging patterns associated with pneumonia. The Grad-CAM visualization shows minimal, diffuse attention with no focal consolidation — consistent with a normal screening. Confidence: ' + conf.toFixed(2) + '%. ' + (a.notes ? 'Clinical notes: ' + a.notes : '');
    SX.qs('#rp-foot-id').textContent = a.id;

    // ── compare view modes ──
    var side = SX.qs('#cmp-stage'), slider = SX.qs('#cmp-slider');
    SX.qsa('.mode-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        SX.qsa('.mode-btn').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var m = b.getAttribute('data-mode');
        side.classList.toggle('hidden', m !== 'side');
        slider.classList.toggle('hidden', m !== 'slider');
      });
    });

    // compare slider (keyboard accessible via range input)
    var range = SX.qs('#sl-range');
    var heat = SX.qs('#sl-heat'), handle = SX.qs('#sl-handle');
    function applySlider() {
      var v = +range.value;
      heat.style.clipPath = 'inset(0 ' + (100 - v) + '% 0 0)';
      handle.style.left = v + '%';
    }
    range.addEventListener('input', applySlider);
    applySlider();

    // zoom (side-by-side panels)
    var z = 1;
    function applyZoom() {
      z = Math.min(4, Math.max(0.5, z));
      SX.qsa('.zoom-layer').forEach(function (l) { l.style.transform = 'scale(' + z + ')'; });
      SX.qs('#zoom-pct').textContent = Math.round(z * 100) + '%';
    }
    SX.qs('#zoom-in').addEventListener('click', function () { z += 0.25; applyZoom(); });
    SX.qs('#zoom-out').addEventListener('click', function () { z -= 0.25; applyZoom(); });
    SX.qs('#zoom-reset').addEventListener('click', function () { z = 1; applyZoom(); });

    // fullscreen
    var fsBtn = SX.qs('#btn-fs');
    fsBtn.addEventListener('click', function () {
      var target = slider.classList.contains('hidden') ? side : slider;
      if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
      if (target.requestFullscreen) target.requestFullscreen().catch(function () {
        SX.toast('Fullscreen unavailable', 'info', 'Your browser blocked the fullscreen request.');
      });
    });
    document.addEventListener('fullscreenchange', function () {
      side.classList.toggle('fs', !!document.fullscreenElement && slider.classList.contains('hidden'));
    });

    // PDF
    SX.qs('#btn-pdf').addEventListener('click', function () { SX.downloadReport(a); });
  }

  /* ============================================================
     PDF REPORT GENERATOR (jsPDF via CDN)
     Professional A4 medical screening report, generated fully
     in the browser. Used from report.html and the dashboards.
     ============================================================ */
  function toDataUrlSafe(src) {
    if (!src) return Promise.reject(new Error('no source'));
    if (/^data:/.test(src)) return Promise.resolve(src);
    return fetch(src).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.blob();
    }).then(function (b) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(fr.result); };
        fr.onerror = rej;
        fr.readAsDataURL(b);
      });
    });
  }

  SX.downloadReport = function (a) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      SX.toast('PDF library not loaded', 'error', 'Check your internet connection (jsPDF CDN) and try again.');
      return;
    }
    if (!a || a.prediction === 'PENDING') {
      SX.toast('Report unavailable', 'info', 'This analysis is not complete yet.');
      return;
    }
    SX.toast('Preparing PDF report…', 'info', 'Compiling images, scores and summary.');

    Promise.all([
      toDataUrlSafe(window.SXAPI.getImagePair(a).original),
      toDataUrlSafe(window.SXAPI.getImagePair(a).heatmap)
    ]).then(function (imgs) {
      buildPdf(a, imgs[0], imgs[1] || imgs[0]);
    }).catch(function () {
      buildPdf(a, window.SXAPI.getImagePair(a).original, window.SXAPI.getImagePair(a).heatmap);
    });
  };

  function buildPdf(a, origUrl, heatUrl) {
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    var W = 210, M = 16, R = W - M;
    var user = SX.session();
    var isPneu = a.prediction === 'PNEUMONIA';
    var conf = a.confidence || 0;
    var y;

    /* header */
    doc.setFillColor(10, 22, 48);
    doc.rect(0, 0, W, 30, 'F');
    doc.setFillColor(18, 181, 166);
    doc.rect(0, 30, W, 1.6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
    doc.text('SMART XRAY', M, 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.setTextColor(159, 200, 232);
    doc.text('AI-POWERED CHEST X-RAY SCREENING', M, 20.5);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('MEDICAL SCREENING REPORT', R, 12, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Generated: ' + new Date().toLocaleString('en-GB'), R, 18, { align: 'right' });
    doc.text('Analysis ID: ' + a.id, R, 23.5, { align: 'right' });

    y = 40;
    doc.setDrawColor(210, 220, 235);
    doc.line(M, y - 4, R, y - 4);

    function label(t) {
      doc.setFont('courier', 'bold'); doc.setFontSize(8.5);
      doc.setTextColor(46, 107, 230);
      doc.text(t, M, y); y += 6;
    }
    function kv(k, v, x, yy) {
      doc.setFont('courier', 'normal'); doc.setFontSize(7.5);
      doc.setTextColor(120, 135, 160);
      doc.text(k.toUpperCase(), x, yy);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.setTextColor(20, 32, 60);
      doc.text(String(v), x, yy + 4.6);
    }

    /* patient information */
    label('PATIENT INFORMATION');
    kv('Patient', a.patientName, M, y); kv('Patient ID', a.patientId, 112, y);
    y += 11;
    kv('Age', a.age || '—', M, y); kv('Gender', a.gender || '—', 112, y);
    y += 11;
    kv('Analysis ID', a.id, M, y); kv('Date', SX.fmtDate(a.date), 112, y);
    y += 12;

    /* AI screening result */
    label('AI SCREENING RESULT');
    if (isPneu) { doc.setFillColor(252, 236, 236); doc.setDrawColor(229, 72, 77); doc.setTextColor(160, 32, 37); }
    else { doc.setFillColor(228, 246, 242); doc.setDrawColor(15, 191, 174); doc.setTextColor(9, 110, 97); }
    doc.roundedRect(M, y, R - M, 17, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(isPneu ? 'PNEUMONIA DETECTED' : 'NO PNEUMONIA DETECTED', M + 8, y + 8.4);
    doc.setFontSize(11);
    doc.text('AI CONFIDENCE ' + conf.toFixed(2) + '%', R - 8, y + 8.4, { align: 'right' });
    y += 22.5;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5);
    doc.setTextColor(110, 122, 145);
    doc.text('AI Screening Result — clinical review recommended. This is not a final medical diagnosis.', M, y);
    y += 9;

    /* images */
    label('ORIGINAL X-RAY (UNMODIFIED)');
    doc.setFont('courier', 'bold'); doc.setFontSize(8.5); doc.setTextColor(46, 107, 230);
    doc.text('GRAD-CAM HEATMAP (MODEL ATTENTION)', 112, y - 5.5);
    var iw = 52.4, ih = 64;
    var f1 = /^data:image\/png/.test(origUrl) ? 'PNG' : 'JPEG';
    var f2 = /^data:image\/png/.test(heatUrl) ? 'PNG' : 'JPEG';
    doc.setDrawColor(200, 210, 228);
    doc.addImage(origUrl, f1, M, y, iw, ih);
    doc.rect(M, y, iw, ih);
    doc.addImage(heatUrl, f2, 140, y, iw, ih);
    doc.rect(140, y, iw, ih);
    y += ih + 5;

    /* confidence */
    label('CONFIDENCE');
    doc.setFillColor(232, 238, 247);
    doc.roundedRect(M, y, 120, 5, 2.5, 2.5, 'F');
    if (isPneu) doc.setFillColor(229, 72, 77); else doc.setFillColor(15, 191, 174);
    doc.roundedRect(M, y, Math.max(6, 120 * conf / 100), 5, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20, 32, 60);
    doc.text(conf.toFixed(2) + '%', M + 125, y + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110, 122, 145);
    doc.text('Per-image model confidence (not a model precision metric)', M, y + 10);
    y += 17;

    /* clinical summary */
    label('CLINICAL SUMMARY');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 75, 105);
    var summary = (isPneu
      ? 'The AI model identified imaging patterns associated with pneumonia. Highlighted regions in the Grad-CAM visualization indicate the areas that contributed most strongly to this prediction.'
      : 'The AI model did not identify imaging patterns associated with pneumonia. The Grad-CAM visualization shows minimal, diffuse attention with no focal consolidation, consistent with a normal screening.') +
      (a.notes ? ' Clinical notes: ' + a.notes : '');
    var lines = doc.splitTextToSize(summary, R - M);
    doc.text(lines, M, y);
    y += lines.length * 4.4 + 6;

    /* model info + doctor */
    label('MODEL INFORMATION');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60, 75, 105);
    var mlines = doc.splitTextToSize('Model: SmartXrayNet v2.1 · TensorFlow\nTask: binary pneumonia classification\nGrad-CAM: explainability overlay\nValidation: 94.2% acc / 92.8% sens / 95.1% spec', 90);
    doc.text(mlines, M, y);
    doc.setFont('courier', 'bold'); doc.setFontSize(8.5); doc.setTextColor(46, 107, 230);
    doc.text('REPORTING PHYSICIAN', 112, y - 5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(20, 32, 60);
    doc.text(user && user.name ? user.name : 'Dr. Ananya Sharma', 112, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60, 75, 105);
    doc.text((user && user.id) || 'DOC-1001', 112, y + 5);
    doc.text('Diagnostic Radiology', 112, y + 10);
    y += Math.max(lines.length * 4.4, 16) + 10;

    /* disclaimer + footer */
    doc.setFillColor(250, 246, 235);
    doc.setDrawColor(230, 210, 150);
    var dh = 16;
    var dy = 297 - dh - 12;
    doc.roundedRect(M, dy, R - M, dh, 2, 2, 'FD');
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.4); doc.setTextColor(120, 100, 40);
    var dlines = doc.splitTextToSize('Disclaimer: Smart Xray is an AI-assisted screening tool and does not replace professional medical diagnosis. This AI-generated screening result requires final interpretation by a qualified healthcare professional. Security indicators (encryption / privacy badges) are UI placeholders until enabled on the serving deployment.', R - M - 8);
    doc.text(dlines, M + 4, dy + 5.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140, 150, 170);
    doc.text('Generated by Smart Xray · ' + a.id + ' · Page 1 of 1', W / 2, 293, { align: 'center' });

    doc.save('SmartXray_Report_' + a.id + '.pdf');
    SX.toast('Report downloaded', 'success', 'SmartXray_Report_' + a.id + '.pdf');
  }
})();
