/* ============================================================
   SMART XRAY — js/auth.js
   Shared core: session/auth (swap-ready for backend),
   toast, modal, theme, sidebar, dropdowns, micro-interactions.
   ============================================================ */
(function () {
  'use strict';

  var SX = (window.SX = window.SX || {});
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  SX.reducedMotion = reduced;

  /* ---------------- tiny utils ---------------- */
  SX.qs = function (s, r) { return (r || document).querySelector(s); };
  SX.qsa = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  SX.esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };
  SX.fmtDate = function (iso) {
    var d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  SX.fmtShort = function (iso) {
    var d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  SX.fmtBytes = function (b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  };
  SX.hashStr = function (s) {
    var h = 0;
    for (var i = 0; i < String(s).length; i++) { h = (h * 31 + String(s).charCodeAt(i)) >>> 0; }
    return h;
  };
  SX.initials = function (name) {
    var parts = String(name).replace(/^dr\.?\s+/i, '').split(/\s+/).filter(Boolean);
    var a = parts[0] ? parts[0][0] : '?', b = parts[1] ? parts[1][0] : '';
    return (a + b).toUpperCase();
  };

  /* Animated number counter (respects prefers-reduced-motion) */
  SX.countUp = function (el, end, opts) {
    opts = opts || {};
    var dec = opts.dec || 0, dur = opts.dur || 1300, suf = opts.suffix || '';
    if (reduced || !el) { if (el) el.textContent = end.toFixed(dec) + suf; return; }
    var t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = (end * e).toFixed(dec) + suf;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };

  /* Status badge helper (shared by all pages); optional id for later lookup */
  SX.badgeHtml = function (pred, id) {
    var cls = pred === 'PNEUMONIA' ? 'b-pneu' : (pred === 'PENDING' ? 'b-pending' : 'b-normal');
    var i = id ? ' id="' + id + '"' : '';
    return '<span class="badge ' + cls + '"' + i + '"><span class="b-dot"></span>' + SX.esc(pred) + '</span>';
  };

  /* ---------------- toast notifications ---------------- */
  var TOAST_ICONS = {
    success: '<path d="M20 6 9 17l-5-5"/>',
    error: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'
  };
  SX.toast = function (title, type, sub, ms) {
    type = type || 'info';
    var region = SX.qs('#toast-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'toast-region';
      region.className = 'toast-region';
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    var t = document.createElement('div');
    t.className = 'toast t-' + type;
    t.innerHTML =
      '<svg class="t-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + TOAST_ICONS[type] + '</svg>' +
      '<div><b>' + SX.esc(title) + '</b>' + (sub ? '<span>' + SX.esc(sub) + '</span>' : '') + '</div>';
    region.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 420);
    }, ms || 4600);
  };

  /* ---------------- modal ---------------- */
  SX.showModal = function (title, bodyHtml, footHtml) {
    var old = SX.qs('#sx-modal'); if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.id = 'sx-modal';
    wrap.className = 'modal-backdrop';
    wrap.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + SX.esc(title) + '">' +
      '<div class="modal-head"><h3>' + SX.esc(title) + '</h3>' +
      '<button class="icon-btn sm" data-mx aria-label="Close dialog"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="modal-foot">' + footHtml + '</div>' : '') +
      '</div>';
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add('show'); });
    function close() { wrap.classList.remove('show'); setTimeout(function () { wrap.remove(); }, 240); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('[data-mx]').addEventListener('click', close);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    return { el: wrap, close: close };
  };

  /* ---------------- session + mock authentication ----------------
     ── To connect a real backend, replace the body of SX.loginUser
        with a fetch call to your /api/login endpoint. The rest of
        the app only consumes { ok, user } and never touches
        credentials anywhere else. ─────────────────────────────── */
  var AUTH_MOCK = true; // flip to false when your backend login endpoint exists
  SX.AUTH_MOCK = AUTH_MOCK;

  var DEMO_USERS = {
    doctor: { id: 'DOC-1001', email: 'doctor@smartxray.in', password: 'demo123', name: 'Dr. Ananya Sharma', role: 'doctor', specialty: 'Diagnostic Radiology' },
    patient: { id: 'PX-10294', email: 'rahul@smartxray.in', password: 'demo123', name: 'Rahul Mehta', role: 'patient' }
  };
  SX.DEMO_USERS = DEMO_USERS;

  async function loginUser(identifier, password, role, remember) {
    // =====================================================
    // SMART XRAY AUTHENTICATION — MOCK IMPLEMENTATION
    // Replace with your backend call, e.g.:
    //   const res = await fetch('http://localhost:5000/api/login', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ identifier, password, role })
    //   });
    //   return await res.json();  // → { ok, user }
    // =====================================================
    await new Promise(function (r) { setTimeout(r, 650); });
    var u = DEMO_USERS[role];
    if (!u) return { ok: false, error: 'Unknown role.' };
    var idOk = identifier.trim().toLowerCase() === u.email.toLowerCase() ||
               identifier.trim().toUpperCase() === u.id;
    if (idOk && password === u.password) {
      return { ok: true, user: { id: u.id, name: u.name, role: u.role, specialty: u.specialty || '' } };
    }
    return { ok: false, error: 'Invalid credentials for ' + role + ' login. Use the demo buttons below.' };
  }
  SX.loginUser = loginUser;

  var SKEY = 'sx_session';
  SX.session = function () {
    try {
      var raw = (rememberPref() && localStorage.getItem(SKEY)) || sessionStorage.getItem(SKEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  function rememberPref() {
    try { return localStorage.getItem('sx_remember') === '1'; } catch (e) { return false; }
  }
  SX.setSession = function (user, remember) {
    // Always mirror into sessionStorage (guarantees the very next page
    // load can find the session); persist to localStorage only when
    // "Remember me" is on. Falls back gracefully if storage is blocked.
    try {
      var raw = JSON.stringify(user);
      sessionStorage.setItem(SKEY, raw);
      if (remember) { localStorage.setItem(SKEY, raw); localStorage.setItem('sx_remember', '1'); }
    } catch (e) {
      try { sessionStorage.setItem(SKEY, JSON.stringify(user)); } catch (e2) { /* no storage available */ }
    }
  };
  SX.clearSession = function () {
    try { localStorage.removeItem(SKEY); sessionStorage.removeItem(SKEY); localStorage.removeItem('sx_remember'); } catch (e) {}
  };

  /* ---------------- init ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    // Theme
    var theme = 'light';
    try { theme = localStorage.getItem('sx_theme') || 'light'; } catch (e) {}
    document.documentElement.setAttribute('data-theme', theme);
    SX.qsa('[data-theme-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', cur);
        try { localStorage.setItem('sx_theme', cur); } catch (e) {}
      });
    });

    // Dropdown menus
    SX.qsa('[data-drop]').forEach(function (drop) {
      var btn = drop.querySelector('button');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = drop.classList.contains('open');
        SX.qsa('[data-drop]').forEach(function (d) { d.classList.remove('open'); });
        if (!open) drop.classList.add('open');
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    });
    document.addEventListener('click', function () { SX.qsa('[data-drop]').forEach(function (d) { d.classList.remove('open'); }); });

    // Sidebar: desktop collapse + mobile off-canvas
    var body = document.body;
    try {
      if (localStorage.getItem('sx_sb') === '1') body.classList.add('sb-collapsed');
    } catch (e) {}
    SX.qsa('[data-sb-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        body.classList.toggle('sb-collapsed');
        try { localStorage.setItem('sx_sb', body.classList.contains('sb-collapsed') ? '1' : '0'); } catch (e) {}
      });
    });
    var sb = SX.qs('#sidebar'), bd = SX.qs('#sb-backdrop');
    SX.qsa('[data-menu-open]').forEach(function (b) {
      b.addEventListener('click', function () { sb.classList.add('open'); if (bd) bd.classList.add('show'); });
    });
    if (bd) bd.addEventListener('click', function () { sb.classList.remove('open'); bd.classList.remove('show'); });

    // Scroll reveal
    if ('IntersectionObserver' in window && !reduced) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
      }, { threshold: 0.12 });
      SX.qsa('.reveal').forEach(function (el) { io.observe(el); });
    } else {
      SX.qsa('.reveal').forEach(function (el) { el.classList.add('in'); });
    }

    // Inject signed-in user into the UI
    var user = SX.session();
    if (user) {
      SX.qsa('[data-user-name]').forEach(function (el) { el.textContent = user.name; });
      SX.qsa('[data-user-id]').forEach(function (el) { el.textContent = user.id; });
      SX.qsa('[data-user-initials]').forEach(function (el) { el.textContent = SX.initials(user.name); });
    }

    // Protected pages: redirect to login when signed out / wrong role
    var protect = body.getAttribute('data-protect');
    if (protect && (!user || user.role !== protect)) {
      window.location.replace('login.html');
      return;
    }
    // Already signed in on the login page → go to your dashboard
    if (body.getAttribute('data-page') === 'login' && user) {
      window.location.replace(user.role === 'doctor' ? 'doctor-dashboard.html' : 'patient-dashboard.html');
      return;
    }

    // Logout
    SX.qsa('[data-logout]').forEach(function (b) {
      b.addEventListener('click', function () {
        SX.clearSession();
        SX.toast('Signed out', 'info', 'Your session has ended securely.');
        setTimeout(function () { window.location.href = 'login.html'; }, 500);
      });
    });

    // Footer years
    SX.qsa('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
  });
})();
