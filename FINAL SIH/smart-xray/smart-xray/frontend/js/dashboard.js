/* ============================================================
   SMART XRAY — js/dashboard.js
   Doctor dashboard (overview, patients, history, reports,
   settings) + patient portal, with search, filters, modals,
   animated stats and PDF report actions.
   ============================================================ */
(function () {
  'use strict';
  var SX = window.SX;

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.body.getAttribute('data-page');
    if (page === 'doctor-dashboard') doctorInit();
    if (page === 'patient-dashboard') patientInit();
  });

  /* ---------- small render helpers ---------- */
  function confCell(a) {
    if (a.prediction === 'PENDING' || a.confidence == null) {
      return '<span class="muted small">—</span>';
    }
    var cls = a.prediction === 'PNEUMONIA' ? 'hot' : 'cool';
    return '<div class="conf-cell"><div class="conf-bar"><i class="' + cls + '" style="width:' + Math.min(100, a.confidence) + '%"></i></div><b>' + a.confidence.toFixed(2) + '%</b></div>';
  }
  function patientCell(name, id) {
    return '<div class="cell-patient"><span class="avatar">' + SX.esc(SX.initials(name)) + '</span><span><b>' + SX.esc(name) + '</b><small>' + SX.esc(id) + '</small></span></div>';
  }
  function statusBadge(a) {
    return a.prediction === 'PENDING' ? SX.badgeHtml('PENDING') : SX.badgeHtml(a.prediction);
  }
  function completedSorted() {
    return SX.store.all().slice().sort(function (a, b) { return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); });
  }

  /* ============================================================
     DOCTOR DASHBOARD
     ============================================================ */
  function doctorInit() {
    var user = SX.session();

    // Greeting
    var h = new Date().getHours();
    var greet = h < 12 ? 'Good Morning' : (h < 17 ? 'Good Afternoon' : 'Good Evening');
    SX.qs('#greet-time').textContent = greet;
    SX.qs('#greet-name').textContent = user ? user.name : 'Doctor';
    SX.qs('#greet-date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // ── stats (animated) ──
    var all = SX.store.all();
    var done = all.filter(function (a) { return a.status === 'COMPLETE'; });
    var pneu = done.filter(function (a) { return a.prediction === 'PNEUMONIA'; });
    var patients = {};
    all.forEach(function (a) { patients[a.patientId] = 1; });
    var avg = done.length ? done.reduce(function (s, a) { return s + (a.confidence || 0); }, 0) / done.length : 0;
    SX.countUp(SX.qs('#st-patients'), Object.keys(patients).length, { dur: 1200 });
    SX.countUp(SX.qs('#st-analyzed'), done.length, { dur: 1400 });
    SX.countUp(SX.qs('#st-pneumonia'), pneu.length, { dur: 1500 });
    SX.countUp(SX.qs('#st-confidence'), avg, { dur: 1700, dec: 1 });

    // ── recent analyses ──
    function renderRecent(q) {
      var rows = completedSorted().filter(function (a) {
        if (a.prediction === 'PENDING') return false;
        if (!q) return true;
        var t = (a.patientName + ' ' + a.patientId + ' ' + a.id).toLowerCase();
        return t.indexOf(q.toLowerCase()) !== -1;
      });
      // include pending at the top for visibility
      var pend = SX.store.all().filter(function (a) { return a.prediction === 'PENDING'; });
      var list = pend.concat(rows).slice(0, 6);
      var tb = SX.qs('#recent-body');
      if (!list.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-row">No analyses match your search.</td></tr>'; return; }
      tb.innerHTML = list.map(function (a) {
        return '<tr>' +
          '<td>' + patientCell(a.patientName, a.patientId) + '</td>' +
          '<td class="mono small">' + SX.esc(a.patientId) + '</td>' +
          '<td class="small">' + SX.fmtShort(a.date) + '</td>' +
          '<td>' + statusBadge(a) + '</td>' +
          '<td>' + confCell(a) + '</td>' +
          '<td>' + (a.prediction === 'PENDING' ? '<span class="badge b-pending"><span class="b-dot"></span>PENDING</span>' : '<span class="badge b-neutral"><span class="b-dot"></span>REVIEWED</span>') + '</td>' +
          '<td><button class="mini-btn" data-action="' + (a.prediction === 'PENDING' ? 'pending' : 'view') + '" data-id="' + a.id + '">' +
          '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>' +
          ' View Report</button></td></tr>';
      }).join('');
    }

    // ── patients page ──
    function renderPatients() {
      var q = (SX.qs('#pt-search').value || '').toLowerCase();
      var resF = SX.qs('#pt-result-filter').value;
      var genF = SX.qs('#pt-gender-filter').value;
      var rows = SXAPI.patients.filter(function (p) {
        if (q && (p.name + ' ' + p.id).toLowerCase().indexOf(q) === -1) return false;
        if (genF && p.gender !== genF) return false;
        if (resF) {
          var last = latestFor(p.id);
          if (!last || last.prediction !== resF) return false;
        }
        return true;
      });
      var tb = SX.qs('#patients-body');
      if (!rows.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-row">No patients match the current filters.</td></tr>'; return; }
      tb.innerHTML = rows.map(function (p) {
        var last = latestFor(p.id);
        return '<tr>' +
          '<td class="mono small">' + SX.esc(p.id) + '</td>' +
          '<td>' + patientCell(p.name, p.id).replace('<small>' + SX.esc(p.id) + '</small>', '<small>' + SX.esc(p.contact) + '</small>') + '</td>' +
          '<td class="small">' + p.age + '</td>' +
          '<td class="small">' + SX.esc(p.gender) + '</td>' +
          '<td class="small">' + (last ? SX.fmtShort(last.date) : '—') + '</td>' +
          '<td>' + (last ? statusBadge(last) : '<span class="badge b-neutral">NONE</span>') + '</td>' +
          '<td><div class="row-actions">' +
          '<button class="mini-btn" data-action="view-patient" data-id="' + p.id + '" title="View patient">View</button>' +
          '<button class="mini-btn" data-action="analyze" data-id="' + p.id + '" title="Analyze X-Ray">Analyze X-Ray</button>' +
          '<button class="mini-btn" data-action="history" data-id="' + p.id + '" title="View history">History</button>' +
          '<button class="mini-btn" data-action="dl-patient" data-id="' + p.id + '" title="Download latest report">Reports</button>' +
          '</div></td></tr>';
      }).join('');
    }
    function latestFor(pid) {
      return SX.store.all().filter(function (a) { return a.patientId === pid && a.status === 'COMPLETE'; })
        .sort(function (a, b) { return b.date.localeCompare(a.date); })[0] || null;
    }
    ['pt-search', 'pt-result-filter', 'pt-gender-filter'].forEach(function (id) {
      SX.qs('#' + id).addEventListener('input', renderPatients);
    });

    // ── history page ──
    var histState = { f: 'ALL', date: '', conf: 0, q: '' };
    function renderHistory() {
      var list = SX.store.all().filter(function (a) {
        if (histState.f !== 'ALL' && a.prediction !== histState.f) return false;
        if (histState.date && a.date < histState.date) return false;
        if (histState.conf && (a.confidence || 0) < histState.conf) return false;
        if (histState.q) {
          var t = (a.patientName + ' ' + a.patientId + ' ' + a.id).toLowerCase();
          if (t.indexOf(histState.q.toLowerCase()) === -1) return false;
        }
        return true;
      }).sort(function (a, b) { return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); });
      var tb = SX.qs('#hist-body');
      if (!list.length) { tb.innerHTML = '<tr><td colspan="6" class="empty-row">No analyses match the selected filters.</td></tr>'; return; }
      tb.innerHTML = list.map(function (a) {
        var viewable = a.prediction !== 'PENDING';
        return '<tr>' +
          '<td>' + patientCell(a.patientName, a.patientId) + '</td>' +
          '<td class="mono small">' + SX.esc(a.id) + '</td>' +
          '<td class="small">' + SX.fmtShort(a.date) + '</td>' +
          '<td>' + statusBadge(a) + '</td>' +
          '<td>' + confCell(a) + '</td>' +
          '<td><div class="row-actions">' +
          '<button class="mini-btn" data-action="' + (viewable ? 'view' : 'pending') + '" data-id="' + a.id + '">View Result</button>' +
          (viewable ? '<button class="mini-btn" data-action="dl" data-id="' + a.id + '">' +
            '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Download</button>' : '') +
          '</div></td></tr>';
      }).join('');
    }
    SX.qsa('[data-hfilter]').forEach(function (b) {
      b.addEventListener('click', function () {
        SX.qsa('[data-hfilter]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        histState.f = b.getAttribute('data-hfilter');
        renderHistory();
      });
    });
    SX.qs('#hist-date').addEventListener('change', function () { histState.date = this.value; renderHistory(); });
    SX.qs('#hist-conf').addEventListener('input', function () {
      histState.conf = +this.value;
      SX.qs('#hist-conf-out').textContent = this.value + '%';
      renderHistory();
    });

    // ── reports page ──
    function renderReports() {
      var list = completedSorted();
      var box = SX.qs('#reports-list');
      box.innerHTML = list.length ? list.map(function (a) {
        return '<div class="card card-hover report-row">' +
          '<span class="rr-ic"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>' +
          '<div class="rr-main"><b>' + SX.esc(a.patientName) + ' — ' + SX.esc(a.id) + '</b>' +
          '<small>' + SX.esc(a.patientId) + ' · ' + SX.fmtDate(a.date) + '</small></div>' +
          '<div class="rr-meta">' + statusBadge(a) + confCell(a) +
          '<div class="row-actions">' +
          '<button class="mini-btn" data-action="view" data-id="' + a.id + '">Open</button>' +
          '<button class="mini-btn" data-action="dl" data-id="' + a.id + '">Download PDF</button>' +
          '</div></div></div>';
      }).join('') : '<div class="card card-pad"><p class="muted">No completed analyses yet.</p></div>';
    }

    renderRecent();
    renderPatients();
    renderHistory();
    renderReports();

    // ── topbar search: acts on the visible page ──
    var gs = SX.qs('#global-search');
    gs.addEventListener('input', function () {
      var v = gs.value;
      var act = SX.qs('.page.active');
      if (act && act.id === 'page-patients') { SX.qs('#pt-search').value = v; renderPatients(); }
      else if (act && act.id === 'page-history') { histState.q = v; renderHistory(); }
      else { renderRecent(v); }
    });

    // ── hash routing ──
    var pages = ['overview', 'patients', 'history', 'reports', 'settings'];
    function route() {
      var hash = (location.hash || '#overview').replace('#', '');
      if (pages.indexOf(hash) === -1) hash = 'overview';
      SX.qsa('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + hash); });
      SX.qsa('[data-nav]').forEach(function (l) {
        l.classList.toggle('active', l.getAttribute('data-nav') === hash && l.closest('.sidebar') !== null);
      });
      if (window.innerWidth < 861) {
        var sb = SX.qs('#sidebar'), bd = SX.qs('#sb-backdrop');
        if (sb) sb.classList.remove('open');
        if (bd) bd.classList.remove('show');
      }
    }
    window.addEventListener('hashchange', route);
    route();

    // ── action delegation ──
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var act = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');
      if (act === 'view') {
        window.location.href = 'report.html?id=' + encodeURIComponent(id);
      } else if (act === 'pending') {
        SX.toast('Analysis still in progress', 'info', 'This screening has not been completed yet (demo state).');
      } else if (act === 'dl') {
        var a = SX.store.get(id);
        if (a && window.SX && SX.downloadReport) SX.downloadReport(a);
      } else if (act === 'analyze') {
        window.location.href = 'analysis.html?patient=' + encodeURIComponent(id);
      } else if (act === 'history') {
        histState.q = id;
        location.hash = '#history';
        route();
        renderHistory();
        SX.qs('#global-search').value = '';
      } else if (act === 'view-patient') {
        openPatientModal(id);
      } else if (act === 'dl-patient') {
        var last = latestFor(id);
        if (last) SX.downloadReport(last);
        else SX.toast('No completed reports', 'info', 'This patient has no completed analyses yet.');
      }
    });

    function openPatientModal(pid) {
      var p = SXAPI.patients.filter(function (x) { return x.id === pid; })[0];
      if (!p) return;
      var list = SX.store.all().filter(function (a) { return a.patientId === pid; })
        .sort(function (a, b) { return b.date.localeCompare(a.date); });
      var body =
        '<div style="display:flex;gap:14px;align-items:center;margin-bottom:18px">' +
        '<span class="avatar" style="width:52px;height:52px;font-size:17px;border-radius:14px">' + SX.esc(SX.initials(p.name)) + '</span>' +
        '<div><b style="font-size:16px">' + SX.esc(p.name) + '</b><div class="small muted mono">' + SX.esc(p.id) + '</div></div></div>' +
        '<div class="pt-profile" style="margin-bottom:18px">' +
        '<div class="pp-row"><span><small>Age</small><b>' + p.age + ' years</b></span><span><small>Gender</small><b>' + SX.esc(p.gender) + '</b></span></div>' +
        '<div class="pp-row"><span><small>Contact</small><b>' + SX.esc(p.contact) + '</b></span><span><small>Screenings</small><b>' + list.length + '</b></span></div></div>' +
        '<h4 style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-family:var(--font-mono);color:var(--muted);margin-bottom:10px">Screening history</h4>' +
        (list.length ? list.map(function (a) {
          return '<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px dashed var(--border);flex-wrap:wrap">' +
            '<span class="mono small" style="color:var(--faint)">' + a.id + '</span>' +
            '<span class="small">' + SX.fmtShort(a.date) + '</span>' + statusBadge(a) +
            (a.confidence != null ? '<span class="mono small muted">' + a.confidence.toFixed(2) + '%</span>' : '') +
            (a.prediction !== 'PENDING' ? '<button class="mini-btn" style="margin-left:auto" data-action="view" data-id="' + a.id + '">Open</button>' : '') +
            '</div>';
        }).join('') : '<p class="muted small">No screenings yet.</p>');
      var m = SX.showModal(p.name, body,
        '<button class="btn btn-soft btn-sm" data-m-close>Close</button>' +
        '<a class="btn btn-primary btn-sm" href="analysis.html?patient=' + p.id + '">Analyze X-Ray</a>');
      m.el.querySelector('[data-m-close]').addEventListener('click', m.close);
    }

    // notifications
    var mr = SX.qs('#mark-read');
    if (mr) mr.addEventListener('click', function () {
      var dot = SX.qs('#notif-dot');
      if (dot) dot.style.display = 'none';
      SX.toast('All caught up', 'success', 'Notifications marked as read.');
    });

    // integration status (reads the single source of truth in analysis.js)
    var cfg = window.SXAPI && window.SXAPI.config;
    if (cfg) {
      var pillEl = SX.qs('#mock-pill'), pillTxt = SX.qs('#mock-pill-text');
      if (pillEl && pillTxt) {
        pillEl.className = 'mode-pill ' + (cfg.MOCK_MODE ? 'mode-mock' : 'mode-live');
        pillTxt.textContent = cfg.MOCK_MODE ? 'MOCK MODE' : 'LIVE MODEL';
      }
      var apiEl = SX.qs('#api-url');
      if (apiEl) apiEl.textContent = cfg.API_URL;
    }
  }

  /* ============================================================
     PATIENT DASHBOARD (simplified, patient-friendly)
     ============================================================ */
  function patientInit() {
    var user = SX.session() || { id: 'PX-10294', name: 'Rahul Mehta', role: 'patient' };
    var h = new Date().getHours();
    SX.qs('#pd-greet').textContent = h < 12 ? 'Good Morning' : (h < 17 ? 'Good Afternoon' : 'Good Evening');
    var first = user.name.replace(/^dr\.?\s+/i, '').split(' ')[0];
    SX.qs('#pd-name').textContent = first;

    var mine = SX.store.all()
      .filter(function (a) { return a.patientId === user.id && a.status === 'COMPLETE'; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
    var latest = mine[0];

    if (latest) {
      SX.qs('#pd-last-visit').textContent = SX.fmtShort(latest.date);
      var pair = window.SXAPI.getImagePair(latest);
      SX.qs('#pd-latest-img').src = pair.original;
      SX.qs('#pd-latest-badge').outerHTML = SX.badgeHtml(latest.prediction, 'pd-latest-badge');
      SX.qs('#pd-latest-date').textContent = 'Screened on ' + SX.fmtDate(latest.date) + ' · ' + latest.id;
      SX.qs('#pd-latest-conf').textContent = latest.confidence.toFixed(2) + '%';
      SX.qs('#pd-latest-msg').textContent = latest.prediction === 'PNEUMONIA'
        ? 'The AI screening of your chest X-ray found patterns that may be consistent with pneumonia. Your doctor has been notified and will review your images personally. Please follow up with them as advised — this AI result is a screening aid, not a final diagnosis.'
        : 'Good news — the AI screening of your chest X-ray did not find patterns consistent with pneumonia. Continue with your regular check-ups, and reach out to your doctor if you notice new symptoms.';
      SX.qs('#pd-view-details').href = 'report.html?id=' + encodeURIComponent(latest.id);
      SX.qs('#pd-download-report').addEventListener('click', function () { SX.downloadReport(latest); });
    } else {
      SX.qs('#pd-latest-msg').textContent = 'You do not have a completed screening yet. Ask your doctor to schedule your first chest X-ray.';
    }

    // timeline
    var tl = SX.qs('#pd-timeline');
    tl.innerHTML = mine.length ? mine.map(function (a) {
      var cls = a.prediction === 'PNEUMONIA' ? 'tl-pneu' : 'tl-normal';
      return '<div class="tl-item ' + cls + '">' +
        '<b>' + SX.fmtDate(a.date) + '</b><small>' + a.id + '</small>' +
        '<div class="tl-row">' + SX.badgeHtml(a.prediction) +
        '<span class="mono small muted">' + (a.confidence != null ? a.confidence.toFixed(2) + '% confidence' : '') + '</span>' +
        '<a class="mini-btn" href="report.html?id=' + encodeURIComponent(a.id) + '">View</a></div></div>';
    }).join('') : '<p class="muted">No screenings yet.</p>';
    SX.qs('#pd-screen-count').textContent = mine.length + ' completed';

    var pl = SX.qs('#pd-profile-link');
    if (pl) pl.addEventListener('click', function () {
      var target = SX.qs('#pd-profile');
      if (target) target.scrollIntoView({ behavior: SX.reducedMotion ? 'auto' : 'smooth', block: 'center' });
    });
  }
})();
