/* ============================================================
   SMART XRAY — js/analysis.js
   1) AI MODEL API INTEGRATION LAYER  ← the ONLY place to
      change when connecting your Python/TensorFlow backend.
   2) Mock sample imagery (canvas-generated placeholder X-ray
      + Grad-CAM heatmap) so the demo runs with no backend.
   3) Demo analysis store (patients + history).
   4) New-Analysis page controller (upload, validation, staged
      loader, error handling).
   ============================================================ */
(function () {
  'use strict';
  var SX = window.SX;

  /* =====================================================
     SMART XRAY AI MODEL API INTEGRATION
     Replace API_URL with your Python Flask/FastAPI endpoint.
     Set MOCK_MODE = false to send real images to your model.
     Everything else in the app reads results through this
     single layer — no other file talks to the backend.
     ===================================================== */
  var API_URL = 'http://localhost:5000/api/analyze';
  // ── Flip this back to `true` for a frontend-only demo (no backend).
  //    When `false`, the uploaded X-ray is sent to the real Flask backend.
  const MOCK_MODE = false;
  var MAX_FILE_MB = 10;
  window.SXAPI = window.SXAPI || {};
  window.SXAPI.config = { API_URL: API_URL, MOCK_MODE: MOCK_MODE, MAX_FILE_MB: MAX_FILE_MB };

  /**
   * Analyze a chest X-ray.
   * @param {File} imageFile   - the uploaded X-ray image
   * @param {Object} patientData - { name, id, age, gender, contact, notes }
   * @returns {Promise<{prediction:string, confidence:number,
   *            originalImage:string, heatmapImage:string,
   *            analysisId:string, timestamp:string}>}
   */
  async function analyzeXray(imageFile, patientData) {
    if (MOCK_MODE) return mockAnalyze(imageFile, patientData);

    // ── REAL MODE: multipart/form-data POST to your Python backend ──
    var fd = new FormData();
    fd.append('image', imageFile, imageFile.name);
    fd.append('patient_name', patientData.name);
    fd.append('patient_id', patientData.id);
    fd.append('age', String(patientData.age || ''));
    fd.append('gender', patientData.gender || '');
    fd.append('clinical_notes', patientData.notes || '');

    var res;
    try {
      res = await fetch(API_URL, { method: 'POST', body: fd });
    } catch (e) {
      throw new Error('NETWORK');
    }
    if (!res.ok) {
      // Try to surface the backend's own error message (e.g. the JSON
      // `{ "error": "..." }` returned by Flask) instead of a bare status.
      var backendMsg = '';
      try {
        var eb = await res.json();
        backendMsg = eb && (eb.error || eb.message) ? String(eb.error || eb.message) : '';
      } catch (e2) {}
      var httpErr = new Error('HTTP_' + res.status);
      httpErr.backendMessage = backendMsg;
      throw httpErr;
    }
    var json;
    try { json = await res.json(); } catch (e) { throw new Error('BAD_JSON'); }
    var mapped = mapApiResult(json);
    if (!mapped) throw new Error('BAD_RESPONSE');
    return mapped;
  }
  window.SXAPI.analyzeXray = analyzeXray;

  /**
   * ── MAP YOUR BACKEND FIELD NAMES HERE ──
   * If your Python backend returns different key names, adjust
   * only this function. Expected contract:
   * { prediction, confidence, original_image, heatmap_image,
   *   analysis_id, timestamp }
   */
  function mapApiResult(r) {
    var pred = String(r.prediction != null ? r.prediction : r.label != null ? r.label : '').toUpperCase();
    var conf = parseFloat(r.confidence != null ? r.confidence : r.probability);
    if (pred.indexOf('PNEU') === 0) pred = 'PNEUMONIA';
    if (pred === 'NORMAL' || pred === 'NO PNEUMONIA' || pred === 'NEGATIVE') pred = 'NORMAL';
    if (pred !== 'PNEUMONIA' && pred !== 'NORMAL') return null;
    if (isNaN(conf)) return null;
    if (conf <= 1) conf = conf * 100; // accept 0..1 probabilities
    return {
      prediction: pred,
      confidence: Math.round(conf * 100) / 100,
      // ── Where your backend's original X-ray URL is inserted ──
      originalImage: r.original_image || r.original || '',
      // ── Where your backend's Grad-CAM heatmap URL is inserted ──
      heatmapImage: r.heatmap_image || r.heatmap || r.gradcam || '',
      analysisId: r.analysis_id || r.id || ('XR-' + new Date().getFullYear() + '-000'),
      timestamp: r.timestamp || new Date().toISOString()
    };
  }
  window.SXAPI.mapApiResult = mapApiResult;

  /* =====================================================
     AI MODEL HEALTH CHECK — GET /api/health
     Powers the "● AI MODEL ONLINE / OFFLINE" indicator.
     It reports the real backend state and never fakes it.
     ===================================================== */
  function healthUrl() {
    return String(API_URL || '').replace(/\/api\/analyze\/?$/, '/api/health');
  }
  window.SXAPI.healthUrl = healthUrl;
  window.SXAPI.checkHealth = function () {
    return new Promise(function (resolve) {
      var done = false;
      function settle(v) { if (!done) { done = true; resolve(v); } }
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        settle({ online: false, model_loaded: false });
      }, 4000);
      var opts = { method: 'GET', headers: { 'Accept': 'application/json' } };
      if (ctrl) opts.signal = ctrl.signal;
      fetch(healthUrl(), opts).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) return settle({ online: false, model_loaded: false });
        return r.json().then(function (j) {
          settle({ online: true, model_loaded: !!(j && j.model_loaded) });
        }).catch(function () { settle({ online: true, model_loaded: false }); });
      }).catch(function () { clearTimeout(timer); settle({ online: false, model_loaded: false }); });
    });
  };

  function paintHealth(el, state) {
    var text = el.querySelector('[data-health-text]');
    el.classList.remove('h-online', 'h-offline', 'h-checking');
    if (state.online && state.model_loaded) {
      el.classList.add('h-online');
      if (text) text.textContent = 'AI MODEL ONLINE';
      el.title = 'Backend reachable · model loaded';
    } else if (state.online && !state.model_loaded) {
      el.classList.add('h-offline');
      if (text) text.textContent = 'AI MODEL OFFLINE';
      el.title = 'Backend reachable · model NOT loaded — check the Flask console';
    } else {
      el.classList.add('h-offline');
      if (text) text.textContent = 'AI MODEL OFFLINE';
      el.title = 'Backend unreachable — start it with: python backend/app.py';
    }
  }
  function initHealthIndicators() {
    var els = SX.qsa('[data-health]');
    if (!els.length) return;
    function refresh() {
      els.forEach(function (el) {
        el.classList.remove('h-online', 'h-offline');
        el.classList.add('h-checking');
        var text = el.querySelector('[data-health-text]');
        if (text) text.textContent = 'CHECKING…';
      });
      window.SXAPI.checkHealth().then(function (state) {
        els.forEach(function (el) { paintHealth(el, state); });
      });
    }
    refresh();
    setInterval(refresh, 20000); // re-poll every 20s
  }
  document.addEventListener('DOMContentLoaded', initHealthIndicators);

  /* =====================================================
     MOCK ENGINE — used only when MOCK_MODE = true.
     Generates a stable, demo-grade result and canvas images.
     ===================================================== */
  function mockAnalyze(imageFile, patientData) {
    return new Promise(function (resolve) {
      var delay = 2100 + Math.random() * 1300;
      setTimeout(function () {
        var seed = SX.hashStr((imageFile && imageFile.name) || 'demo') + ((imageFile && imageFile.size) || 17);
        var rng = seeded(seed);
        var pneumonia = rng() < 0.62; // ~62% of demo scans flag pneumonia
        var confidence = pneumonia
          ? 96.1 + rng() * 3.7
          : 93.4 + rng() * 5.8;
        confidence = Math.round(confidence * 100) / 100;
        var id = SX.store.nextId();
        var res = {
          prediction: pneumonia ? 'PNEUMONIA' : 'NORMAL',
          confidence: confidence,
          originalImage: '',
          heatmapImage: '',
          analysisId: id,
          timestamp: new Date().toISOString(),
          _seed: seed,
          _pneumonia: pneumonia
        };
        // In mock mode the uploaded file IS the "original"; the mock
        // Grad-CAM is composited over it. When MOCK_MODE=false these
        // values come straight from your Python backend response.
        if (imageFile && /^image\/(jpeg|png)$/.test(imageFile.type)) {
          readAsDataURL(imageFile).then(function (dataUrl) {
            res.originalImage = dataUrl;
            mockImages.heatmapOverDataUrl(dataUrl, pneumonia, seed).then(function (h) {
              res.heatmapImage = h;
              resolve(res);
            }).catch(function () { resolve(res); });
          }).catch(function () { resolve(res); });
        } else {
          resolve(res);
        }
      }, delay);
    });
  }
  function seeded(s) {
    var x = s || 1;
    return function () { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  }
  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  /* =====================================================
     MOCK SAMPLE IMAGERY (canvas-generated placeholders)
     Replace with the images your model returns — nothing
     else needs to change.
     ===================================================== */
  var W = 810, H = 990;
  var cache = {};

  function rng(seed) {
    var x = seed % 233280;
    return function () { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  }

  function xrayCanvas(opts) {
    opts = opts || {};
    var key = 'x' + (opts.seed || 0) + (opts.pneumonia ? 'p' : 'n');
    if (cache[key]) return cache[key];
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var rnd = rng((opts.seed || 1) * 7919 + 13);

    // background
    ctx.fillStyle = '#04070c'; ctx.fillRect(0, 0, W, H);

    // soft glow behind torso
    var g = ctx.createRadialGradient(W / 2, H * 0.52, 60, W / 2, H * 0.52, H * 0.62);
    g.addColorStop(0, 'rgba(70,90,120,0.30)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // torso
    ctx.save(); ctx.filter = 'blur(10px)';
    ctx.fillStyle = '#232c39';
    ctx.beginPath();
    ctx.moveTo(W * 0.16, 0); ctx.lineTo(W * 0.84, 0);
    ctx.bezierCurveTo(W * 0.90, H * 0.2, W * 0.88, H * 0.5, W * 0.82, H);
    ctx.lineTo(W * 0.18, H);
    ctx.bezierCurveTo(W * 0.12, H * 0.5, W * 0.10, H * 0.2, W * 0.16, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // lungs (darker air columns)
    ctx.save(); ctx.filter = 'blur(16px)';
    ctx.fillStyle = '#0b111b';
    ctx.beginPath(); ctx.ellipse(W * 0.315, H * 0.50, W * 0.165, H * 0.30, -0.05, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(W * 0.685, H * 0.50, W * 0.165, H * 0.30, 0.05, 0, Math.PI * 2); ctx.fill();
    // heart shadow
    ctx.fillStyle = '#2b3547';
    ctx.beginPath(); ctx.ellipse(W * 0.45, H * 0.66, W * 0.13, H * 0.115, -0.35, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // lung borders
    ctx.save(); ctx.filter = 'blur(3px)';
    ctx.strokeStyle = 'rgba(190,205,225,0.10)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(W * 0.315, H * 0.50, W * 0.168, H * 0.30, -0.05, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(W * 0.685, H * 0.50, W * 0.168, H * 0.30, 0.05, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // ribs
    ctx.save(); ctx.filter = 'blur(2.5px)';
    for (var i = 0; i < 8; i++) {
      var ry = H * (0.30 + i * 0.055);
      ctx.strokeStyle = 'rgba(215,228,245,' + (0.13 - i * 0.004) + ')';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(W * 0.5, ry, W * (0.30 - i * 0.006), H * 0.052, 0, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
    }
    // spine
    for (var s2 = 0; s2 < 10; s2++) {
      ctx.fillStyle = 'rgba(200,214,235,0.10)';
      ctx.fillRect(W * 0.478, H * (0.22 + s2 * 0.062), W * 0.044, H * 0.042);
    }
    // clavicles
    ctx.strokeStyle = 'rgba(220,232,248,0.16)'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.ellipse(W * 0.32, H * 0.115, W * 0.17, H * 0.035, 0.22, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(W * 0.68, H * 0.115, W * 0.17, H * 0.035, -0.22, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // trachea
    ctx.strokeStyle = 'rgba(6,10,16,0.85)'; ctx.lineWidth = 13;
    ctx.beginPath(); ctx.moveTo(W * 0.5, H * 0.05); ctx.lineTo(W * 0.5, H * 0.26); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,214,235,0.12)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W * 0.49, H * 0.05); ctx.lineTo(W * 0.49, H * 0.26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.51, H * 0.05); ctx.lineTo(W * 0.51, H * 0.26); ctx.stroke();

    // pneumonia consolidation (viewer-left lower lobe) + satellite
    if (opts.pneumonia) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      var cx = W * 0.355, cy = H * 0.665;
      var blobs = [[0.16, 1], [0.11, 0.8, 0.05, 0.06], [0.09, 0.7, -0.06, -0.04], [0.07, 0.55, 0.03, -0.08], [0.05, 0.4, -0.02, 0.05]];
      blobs.forEach(function (b, bi) {
        var bx = cx + b[2] * W * (b[2] || 0), by = cy + b[3] * H * (b[3] || 0);
        if (bi === 0) { bx = cx; by = cy; }
        var rg = ctx.createRadialGradient(bx, by, 2, bx, by, b[0] * W);
        rg.addColorStop(0, 'rgba(205,218,235,' + (0.34 * b[1]) + ')');
        rg.addColorStop(0.55, 'rgba(190,205,225,' + (0.18 * b[1]) + ')');
        rg.addColorStop(1, 'rgba(180,200,220,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(bx, by, b[0] * W, 0, Math.PI * 2); ctx.fill();
      });
      // faint satellite in opposite lung
      var rg2 = ctx.createRadialGradient(W * 0.64, H * 0.52, 2, W * 0.64, H * 0.52, W * 0.07);
      rg2.addColorStop(0, 'rgba(200,214,232,0.14)'); rg2.addColorStop(1, 'rgba(190,205,225,0)');
      ctx.fillStyle = rg2; ctx.beginPath(); ctx.arc(W * 0.64, H * 0.52, W * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // film grain
    for (var n = 0; n < 2400; n++) {
      ctx.fillStyle = 'rgba(255,255,255,' + (rnd() * 0.045) + ')';
      ctx.fillRect(rnd() * W, rnd() * H, 1, 1);
    }
    // vignette
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    cache[key] = c;
    return c;
  }

  /** Draws the Grad-CAM blobs onto a given 2D context over region. */
  function drawHeat(ctx2, pneumonia, seed) {
    var r2 = rng((seed || 1) * 6151 + 7);
    ctx2.save();
    ctx2.globalCompositeOperation = 'screen';
    var cx = pneumonia ? W * 0.355 : W * 0.36;
    var cy = pneumonia ? H * 0.665 : H * 0.68;
    var strength = pneumonia ? 1 : 0.42;
    var radii = pneumonia ? [0.185, 0.135, 0.095, 0.06, 0.038] : [0.10, 0.07, 0.045];
    for (var i = 0; i < radii.length; i++) {
      var bx = cx + (r2() - 0.5) * W * 0.02;
      var by = cy + (r2() - 0.5) * H * 0.02;
      var rad = radii[i] * W;
      var rg = ctx2.createRadialGradient(bx, by, 1, bx, by, rad);
      rg.addColorStop(0, 'rgba(253,224,106,' + (0.92 * strength * (1 - i * 0.14)) + ')');
      rg.addColorStop(0.35, 'rgba(245,165,36,' + (0.62 * strength * (1 - i * 0.12)) + ')');
      rg.addColorStop(0.7, 'rgba(229,72,77,' + (0.38 * strength * (1 - i * 0.1)) + ')');
      rg.addColorStop(1, 'rgba(229,72,77,0)');
      ctx2.fillStyle = rg;
      ctx2.beginPath(); ctx2.arc(bx, by, rad, 0, Math.PI * 2); ctx2.fill();
    }
    if (pneumonia) { // secondary hotspot
      var rg3 = ctx2.createRadialGradient(W * 0.64, H * 0.52, 1, W * 0.64, H * 0.52, W * 0.05);
      rg3.addColorStop(0, 'rgba(245,165,36,0.45)'); rg3.addColorStop(1, 'rgba(229,72,77,0)');
      ctx2.fillStyle = rg3; ctx2.beginPath(); ctx2.arc(W * 0.64, H * 0.52, W * 0.05, 0, Math.PI * 2); ctx2.fill();
    }
    ctx2.restore();
  }

  function heatmapCanvas(opts) {
    opts = opts || {};
    var key = 'h' + (opts.seed || 0) + (opts.pneumonia ? 'p' : 'n');
    if (cache[key]) return cache[key];
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.drawImage(xrayCanvas(opts), 0, 0);
    ctx.fillStyle = 'rgba(4,8,16,0.62)'; ctx.fillRect(0, 0, W, H);
    drawHeat(ctx, !!opts.pneumonia, opts.seed || 1);
    // heat legend strip
    ctx.save();
    var lg = ctx.createLinearGradient(W * 0.55, 0, W * 0.95, 0);
    lg.addColorStop(0, '#1A2B52'); lg.addColorStop(0.45, '#E5484D'); lg.addColorStop(0.75, '#F5A524'); lg.addColorStop(1, '#FBE05A');
    ctx.fillStyle = lg;
    ctx.fillRect(W * 0.55, H - 34, W * 0.40, 7);
    ctx.fillStyle = 'rgba(210,225,245,0.65)';
    ctx.font = '11px monospace';
    ctx.fillText('LOW', W * 0.55, H - 42);
    ctx.fillText('HIGH', W * 0.90, H - 42);
    ctx.restore();
    cache[key] = c;
    return c;
  }

  var mockImages = {
    xrayDataURL: function (opts) { return xrayCanvas(opts).toDataURL('image/jpeg', 0.86); },
    heatmapDataURL: function (opts) { return heatmapCanvas(opts).toDataURL('image/jpeg', 0.86); },
    /** Blends Grad-CAM onto a real uploaded image (mock explainability). */
    heatmapOverDataUrl: function (dataUrl, pneumonia, seed) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          try {
            var c = document.createElement('canvas');
            c.width = W; c.height = H;
            var ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, W, H);
            ctx.fillStyle = 'rgba(4,8,16,0.35)'; ctx.fillRect(0, 0, W, H);
            drawHeat(ctx, pneumonia, seed);
            resolve(c.toDataURL('image/jpeg', 0.86));
          } catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = dataUrl;
      });
    }
  };
  window.SXAPI.mockImages = mockImages;

  /* =====================================================
     DEMO DATA — patients & analysis history (localStorage)
     ===================================================== */
  var PATIENTS = [
    { id: 'PX-10294', name: 'Rahul Mehta', age: 42, gender: 'Male', contact: '+91 98450 10294' },
    { id: 'PX-10311', name: 'Priya Patel', age: 29, gender: 'Female', contact: '+91 99302 44811' },
    { id: 'PX-10427', name: 'Arjun Nair', age: 58, gender: 'Male', contact: '+91 98200 77645' },
    { id: 'PX-10512', name: 'Sana Qureshi', age: 71, gender: 'Female', contact: '+91 90040 31288' },
    { id: 'PX-10638', name: 'Vikram Joshi', age: 34, gender: 'Male', contact: '+91 97321 58902' },
    { id: 'PX-10702', name: 'Meera Iyer', age: 63, gender: 'Female', contact: '+91 98860 20317' }
  ];
  window.SXAPI.patients = PATIENTS;

  var SEED_ANALYSES = [
    { id: 'XR-2026-013', patientName: 'Meera Iyer', patientId: 'PX-10702', age: 63, gender: 'Female', date: '2026-08-22', prediction: 'PENDING', confidence: null, status: 'PENDING', notes: 'Follow-up scan in queue.' },
    { id: 'XR-2026-012', patientName: 'Rahul Mehta', patientId: 'PX-10294', age: 42, gender: 'Male', date: '2026-08-21', prediction: 'PNEUMONIA', confidence: 99.79, status: 'COMPLETE', notes: 'Fever × 4 days, productive cough. Right lower lobe opacity.' },
    { id: 'XR-2026-011', patientName: 'Priya Patel', patientId: 'PX-10311', age: 29, gender: 'Female', date: '2026-08-20', prediction: 'NORMAL', confidence: 97.42, status: 'COMPLETE', notes: 'Incidental screening, asymptomatic.' },
    { id: 'XR-2026-010', patientName: 'Arjun Nair', patientId: 'PX-10427', age: 58, gender: 'Male', date: '2026-08-19', prediction: 'PNEUMONIA', confidence: 96.83, status: 'COMPLETE', notes: 'Chronic cough, smoker history.' },
    { id: 'XR-2026-009', patientName: 'Sana Qureshi', patientId: 'PX-10512', age: 71, gender: 'Female', date: '2026-08-18', prediction: 'NORMAL', confidence: 98.10, status: 'COMPLETE', notes: 'Post-discharge follow-up scan.' },
    { id: 'XR-2026-008', patientName: 'Vikram Joshi', patientId: 'PX-10638', age: 34, gender: 'Male', date: '2026-08-17', prediction: 'PNEUMONIA', confidence: 94.56, status: 'COMPLETE', notes: 'High-grade fever, chills.' },
    { id: 'XR-2026-007', patientName: 'Meera Iyer', patientId: 'PX-10702', age: 63, gender: 'Female', date: '2026-08-16', prediction: 'NORMAL', confidence: 99.21, status: 'COMPLETE', notes: 'Routine screening.' },
    { id: 'XR-2026-006', patientName: 'Arjun Nair', patientId: 'PX-10427', age: 58, gender: 'Male', date: '2026-08-12', prediction: 'PNEUMONIA', confidence: 91.37, status: 'COMPLETE', notes: 'Worsening dyspnoea, referred by pulmonology.' },
    { id: 'XR-2026-005', patientName: 'Sana Qureshi', patientId: 'PX-10512', age: 71, gender: 'Female', date: '2026-08-08', prediction: 'NORMAL', confidence: 97.88, status: 'COMPLETE', notes: 'Clear lung fields on review.' },
    { id: 'XR-2026-004', patientName: 'Rahul Mehta', patientId: 'PX-10294', age: 42, gender: 'Male', date: '2026-08-05', prediction: 'NORMAL', confidence: 95.02, status: 'COMPLETE', notes: 'Initial scan — no acute findings.' },
    { id: 'XR-2026-003', patientName: 'Vikram Joshi', patientId: 'PX-10638', age: 34, gender: 'Male', date: '2026-08-07', prediction: 'NORMAL', confidence: 96.64, status: 'COMPLETE', notes: 'Pre-employment screening.' },
    { id: 'XR-2026-002', patientName: 'Priya Patel', patientId: 'PX-10311', age: 29, gender: 'Female', date: '2026-08-04', prediction: 'NORMAL', confidence: 98.53, status: 'COMPLETE', notes: 'Travel screening.' },
    { id: 'XR-2026-001', patientName: 'Sana Qureshi', patientId: 'PX-10512', age: 71, gender: 'Female', date: '2026-07-30', prediction: 'PNEUMONIA', confidence: 97.95, status: 'COMPLETE', notes: 'Left mid-zone consolidation, treated.' }
  ];
  var HKEY = 'sx_history_v1';
  var liveImages = {}; // analysisId → { original, heatmap } (in-memory only)

  var store = {
    all: function () {
      try {
        var raw = localStorage.getItem(HKEY);
        if (raw) { var arr = JSON.parse(raw); if (arr && arr.length) return arr; }
      } catch (e) {}
      try { localStorage.setItem(HKEY, JSON.stringify(SEED_ANALYSES)); } catch (e) {}
      return SEED_ANALYSES.slice();
    },
    get: function (id) { return this.all().filter(function (a) { return a.id === id; })[0] || null; },
    add: function (a) {
      var arr = this.all();
      arr.unshift(a);
      try { localStorage.setItem(HKEY, JSON.stringify(arr)); } catch (e) {}
      return a;
    },
    nextId: function () {
      var max = 0;
      this.all().forEach(function (a) {
        var m = /(\d+)\s*$/.exec(a.id);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
      return 'XR-' + new Date().getFullYear() + '-' + String(max + 1).padStart(3, '0');
    },
    reset: function () {
      try { localStorage.removeItem(HKEY); } catch (e) {}
    }
  };
  SX.store = store;
  window.SXAPI.store = store;

  /**
   * Returns { original, heatmap } image sources for any analysis:
   * live images (upload/mock composite) first, then backend URLs
   * from the API response, then generated demo placeholders.
   */
  window.SXAPI.getImagePair = function (a) {
    if (liveImages[a.id]) return liveImages[a.id];
    if (a.originalImage || a.heatmapImage) {
      return { original: a.originalImage || '', heatmap: a.heatmapImage || '' };
    }
    var seed = SX.hashStr(a.id) % 23327 + 1;
    var pneu = a.prediction === 'PNEUMONIA';
    return {
      original: mockImages.xrayDataURL({ pneumonia: pneu, seed: seed }),
      heatmap: mockImages.heatmapDataURL({ pneumonia: pneu, seed: seed })
    };
  };
  window.SXAPI.setLiveImages = function (id, pair) { liveImages[id] = pair; };

  // expose mockAnalyze for tests/demo
  window.SXAPI.mockAnalyze = mockAnalyze;

  /* =====================================================
     NEW ANALYSIS PAGE CONTROLLER
     ===================================================== */
  document.addEventListener('DOMContentLoaded', function () {
    if (document.body.getAttribute('data-page') !== 'analysis') return;
    var SXA = window.SXAPI;
    var file = null, filePreview = '';
    var $ = SX.qs;

    // mode pill
    var pill = $('#az-mode-pill');
    if (pill) {
      if (SXA.config.MOCK_MODE) { pill.textContent = 'Mock'; pill.title = 'MOCK_MODE=true — results are simulated. Set false in js/analysis.js to call your backend.'; }
      else { pill.textContent = 'Live'; pill.title = SXA.config.API_URL; }
    }

    // ── patient select ──
    var sel = $('#patient-select');
    SXA.patients.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name + ' · ' + p.id + ' · ' + p.age + 'y ' + p.gender;
      sel.appendChild(o);
    });
    var f = {
      name: $('#p-name'), id: $('#p-id'), age: $('#p-age'),
      gender: $('#p-gender'), contact: $('#p-contact'), notes: $('#p-notes')
    };
    function prefill(pid) {
      var p = SXA.patients.filter(function (x) { return x.id === pid; })[0];
      if (!p) return;
      f.name.value = p.name; f.id.value = p.id;
      f.age.value = p.age; f.gender.value = p.gender; f.contact.value = p.contact;
      updateSummary();
    }
    sel.addEventListener('change', function () { prefill(sel.value); });

    // prefill from ?patient=PX-XXXX
    var qp = new URLSearchParams(window.location.search).get('patient');
    if (qp) { sel.value = qp; prefill(qp); }

    if (!f.id.value) {
      f.id.addEventListener('blur', function () {
        if (!f.id.value.trim()) {
          var n = 10800 + (SX.store.all().length % 190);
          f.id.value = 'PX-' + n;
        }
      });
    }

    // ── dropzone ──
    var dz = $('#dropzone'), fi = $('#file-input');
    dz.addEventListener('click', function () { fi.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) acceptFile(dt.files[0]);
    });
    fi.addEventListener('change', function () { if (fi.files && fi.files[0]) acceptFile(fi.files[0]); });

    function acceptFile(fileIn) {
      hideError();
      // validation: format
      if (!/^image\/(jpeg|png)$/.test(fileIn.type)) {
        SX.toast('Unsupported image format', 'error', 'Please upload a JPG, JPEG or PNG chest X-ray.');
        return;
      }
      // validation: size
      if (fileIn.size > SXA.config.MAX_FILE_MB * 1048576) {
        SX.toast('File too large', 'error', 'Maximum size is ' + SXA.config.MAX_FILE_MB + ' MB. This file is ' + SX.fmtBytes(fileIn.size) + '.');
        return;
      }
      file = fileIn;
      var fr = new FileReader();
      fr.onload = function () {
        filePreview = fr.result;
        $('#dz-preview').src = fr.result;
        $('#dz-name').textContent = file.name;
        $('#dz-size').textContent = SX.fmtBytes(file.size) + ' · ' + (file.type === 'image/png' ? 'PNG' : 'JPEG');
        $('#dz-file').classList.add('show');
        updateSummary();
      };
      fr.readAsDataURL(file);
    }

    function clearFile() {
      file = null; filePreview = '';
      fi.value = '';
      $('#dz-file').classList.remove('show');
      updateSummary();
    }
    $('#dz-remove').addEventListener('click', function (e) { e.stopPropagation(); clearFile(); });

    function updateSummary() {
      var nm = f.name.value.trim();
      $('#ab-patient').textContent = nm ? (nm + (f.id.value ? ' · ' + f.id.value.trim() : '')) : 'No patient selected yet';
      $('#ab-file').textContent = file ? ('X-ray ready: ' + file.name) : 'No X-ray uploaded';
      $('#btn-analyze').disabled = !(file && nm);
    }
    Object.keys(f).forEach(function (k) { f[k].addEventListener('input', updateSummary); });

    function showErr(title, msgHtml) {
      $('#api-error-title').textContent = title;
      $('#api-error-msg').innerHTML = msgHtml;
      $('#api-error').classList.remove('show');
      void $('#api-error').offsetWidth;
      $('#api-error').classList.add('show');
    }
    function hideError() { $('#api-error').classList.remove('show'); }

    // ── staged loader ──
    var overlay = $('#loader-overlay'), bar = $('#loader-bar');
    var stages = SX.qsa('#stages .stage');
    var running = false, stageTimer = null;

    function setStage(n) {
      stages.forEach(function (s) {
        var i = +s.getAttribute('data-stage');
        s.classList.toggle('active', i === n);
        s.classList.toggle('done', i < n);
      });
      bar.style.width = (Math.min(n, 5) / 5 * 100) + '%';
    }
    function resetStages() {
      clearInterval(stageTimer);
      stages.forEach(function (s) { s.classList.remove('active', 'done'); });
      bar.style.width = '0%';
    }
    function openLoader() {
      running = true;
      overlay.classList.add('show');
      setStage(1);
      stageTimer = setInterval(function () {
        var cur = +stages.filter(function (s) { return s.classList.contains('active'); })[0].getAttribute('data-stage');
        if (cur < 4) setStage(cur + 1);
      }, 1150);
    }
    function closeLoader(done) {
      clearInterval(stageTimer);
      if (done) setStage(6);
      setTimeout(function () {
        overlay.classList.remove('show');
        resetStages();
        running = false;
      }, done ? 500 : 150);
    }
    $('#loader-cancel').addEventListener('click', function () {
      if (running) { closeLoader(false); SX.toast('Analysis cancelled', 'info', 'The image was kept — you can retry any time.'); }
    });

    // ── run analysis ──
    $('#btn-analyze').addEventListener('click', async function () {
      if (!file) { SX.toast('No X-ray uploaded', 'error', 'Please upload a chest X-ray image first.'); return; }
      if (!f.name.value.trim()) { SX.toast('Patient name required', 'error', 'Enter the patient name before running the AI.'); return; }
      hideError();
      var btn = $('#btn-analyze');
      btn.disabled = true;

      openLoader();
      try {
        var patientData = {
          name: f.name.value.trim(),
          id: f.id.value.trim() || ('PX-' + (10800 + Math.floor(Math.random() * 900))),
          age: f.age.value,
          gender: f.gender.value,
          contact: f.contact.value,
          notes: f.notes.value.trim()
        };
        var result = await SXA.analyzeXray(file, patientData);

        // persist the analysis record (images stay in-memory / come from backend)
        var rec = {
          id: result.analysisId,
          patientName: patientData.name,
          patientId: patientData.id,
          age: patientData.age || '',
          gender: patientData.gender || '',
          date: (result.timestamp || new Date().toISOString()).slice(0, 10),
          prediction: result.prediction,
          confidence: result.confidence,
          status: 'COMPLETE',
          notes: patientData.notes
        };
        // Persist the REAL backend image URLs into the history store so the
        // report page, dashboard and PDF all still show the actual X-ray and
        // Grad-CAM after a page reload. (Mock-mode data URLs stay in-memory
        // only, keeping the existing demo behaviour and localStorage lean.)
        if (result.originalImage && !/^data:/.test(result.originalImage)) {
          rec.originalImage = result.originalImage;
        }
        if (result.heatmapImage && !/^data:/.test(result.heatmapImage)) {
          rec.heatmapImage = result.heatmapImage;
        }
        SX.store.add(rec);
        if (result.originalImage || result.heatmapImage) {
          SXA.setLiveImages(result.analysisId, { original: result.originalImage, heatmap: result.heatmapImage });
        }
        closeLoader(true);
        SX.toast('AI analysis complete', 'success',
          result.prediction === 'PNEUMONIA'
            ? 'Pneumonia pattern detected · ' + result.confidence + '% confidence.'
            : 'No pneumonia pattern detected · ' + result.confidence + '% confidence.');
        setTimeout(function () {
          window.location.href = 'report.html?id=' + encodeURIComponent(result.analysisId);
        }, 900);
      } catch (err) {
        closeLoader(false);
        var code = err && err.message ? err.message : 'UNKNOWN';
        var backendMsg = err && err.backendMessage ? err.backendMessage : '';
        if (code === 'NETWORK') {
          SX.toast('Unable to connect to Smart Xray AI server', 'error', 'Please make sure the Flask backend is running.');
          showErr('Unable to reach the AI backend.',
            'Smart Xray could not connect to <code>' + SX.esc(SXA.config.API_URL) + '</code>. ' +
            'Make sure your Python/Flask app is running, then press Analyze again.');
        } else if (code.indexOf('HTTP_') === 0) {
          var status = code.replace('HTTP_', '');
          SX.toast('AI server error (' + status + ')', 'error', backendMsg || 'The backend responded with an error status.');
          showErr(backendMsg || 'The AI backend returned an error.',
            'Status <code>' + SX.esc(status) + '</code>. Check the Python console for model errors and retry.');
        } else if (code === 'BAD_JSON') {
          SX.toast('Invalid API response', 'error', 'The backend did not return valid JSON.');
          showErr('Invalid API response.', 'The backend returned a non-JSON payload. Expected a JSON object from <code>POST /api/analyze</code>.');
        } else if (code === 'BAD_RESPONSE') {
          SX.toast('Unexpected API response shape', 'error', 'Missing prediction or confidence fields.');
          showErr('Unexpected API response shape.',
            'Expected fields: <code>prediction</code>, <code>confidence</code>, <code>heatmap_image</code>. Adjust the mapping in <code>mapApiResult()</code> in js/analysis.js.');
        } else {
          SX.toast('Analysis failed', 'error', 'An unexpected error occurred.');
          showErr('Analysis failed.', 'An unexpected error occurred. Please try again.');
        }
      } finally {
        btn.disabled = !(file && f.name.value.trim());
      }
    });
  });
})();
