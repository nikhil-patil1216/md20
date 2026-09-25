/* ============================================================
   VIP WMS — ENTERPRISE UI PATCH
   Load AFTER script.js. UI layer only — no business logic touched.
   ============================================================ */
(function () {
  'use strict';

  /* ---- 0. Force light enterprise theme ---- */
  document.documentElement.setAttribute('data-theme', 'light');
  try { localStorage.setItem('wms_theme', 'light'); } catch (e) {}

  /* ---- 1. Disable legacy login effects ---- */
  window.initMatrix = function () {};

  /* ---- 2. Page metadata (title + description per screen) ---- */
  var META = {
    'dashboard': { t: 'Dashboard', d: 'Warehouse overview — inventory, inbound, picking and loading at a glance.' },
    'inbound': { t: 'Inbound', d: 'Vehicle gate entry, goods receipt (GRN) and unloading operations.' },
    'inbound:security-gate': { t: 'Vehicle Entry', d: 'Register vehicles reporting at the security gate.' },
    'inbound:pending-vehicle': { t: 'Unloading Pending', d: 'Vehicles waiting to be assigned for unloading.' },
    'inbound:unloading-screen': { t: 'Goods Receipt / Unloading', d: 'Scan EAN / material codes and verify quantities against invoices.' },
    'inbound:posting-pending': { t: 'Posting Pending', d: 'Goods receipts awaiting approval and posting.' },
    'inbound:inbound-record': { t: 'Inbound History', d: 'Complete record of inbound transactions.' },
    'inbound:unloading-stock': { t: 'Unloading Stock', d: 'Stock received through the unloading process.' },
    'putaway': { t: 'Putaway', d: 'Move received stock into storage locations.' },
    'piv': { t: 'PIV — Pick & Issue Verification', d: 'Create and process PIV transactions.' },
    'location': { t: 'Storage Locations', d: 'Location master — stock, capacity and utilization.' },
    'rack': { t: 'Storage Bins', d: 'Rack and bin master data.' },
    'material': { t: 'Materials', d: 'Material master records and EAN catalog.' },
    'picking': { t: 'Outbound Picking', d: 'OBD allocation and warehouse picking operations.' },
    'picking:obd-upload': { t: 'Outbound Deliveries (OBD)', d: 'Create or import OBD orders for picking.' },
    'picking:picking-assign': { t: 'Assign Picking', d: 'Assign pickers to outbound delivery tasks.' },
    'picking:start-picking': { t: 'Execute Picking', d: 'Pick materials against assigned OBDs.' },
    'picking:picking-done': { t: 'Picking Records', d: 'Completed and in-progress picking history.' },
    'picking:picking-with-loading': { t: 'Pick & Load', d: 'Combined picking with direct loading workflow.' },
    'loading': { t: 'Outbound Loading', d: 'Vehicle loading assignment and execution.' },
    'loading:loading-assign': { t: 'Assign Loading', d: 'Assign OBDs and vehicles for loading.' },
    'loading:start-loading': { t: 'Execute Loading', d: 'Scan and load picked quantities onto vehicles.' },
    'loading:loading-done': { t: 'Loading Records', d: 'Completed loading history.' },
    'loading:qty-mismatch': { t: 'Quantity Differences', d: 'Review loading mismatches and approvals.' },
    'user-time': { t: 'User Working Time', d: 'Attendance and productivity by user.' },
    'admin': { t: 'User Management', d: 'Users, roles and permissions.' },
    'settings': { t: 'System Settings', d: 'Application configuration and master data tools.' },
    'reports': { t: 'Reports & Analytics', d: 'Operational, inventory and user reports.' },
    'audit': { t: 'Audit Log', d: 'System-wide activity trail.' }
  };
  function metaFor(sec, sub) {
    return META[sec + ':' + (sub || '')] || META[sec] ||
      { t: (window.sectionNames && sectionNames[sec]) || sec, d: '' };
  }

  /* ---- 3. Enhanced navigation: breadcrumb + ERP page header ---- */
  window.navTo = function (sec, sub) {
    sub = sub || null;
    if (!chkPerm(sec) && !sub) { showToast('Access Denied!', 'error'); return; }
    if (sub && !chkPerm(sub)) { showToast('Access Denied!', 'error'); return; }
    APP.currentSection = sec; APP.currentSub = sub;

    /* sidebar highlight (same contract as original) */
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    document.querySelectorAll('.nav-sub-item').forEach(function (n) { n.classList.remove('active'); });
    var ni = document.querySelector('.nav-item[data-section="' + sec + '"]');
    if (ni) ni.classList.add('active');
    if (sub) {
      var si = document.querySelector('.nav-sub-item[data-sub="' + sub + '"]');
      if (si) si.classList.add('active');
      if (ni) ni.classList.add('open');
      var ps = document.getElementById(sec + 'Sub'); if (ps) ps.classList.add('open');
    }

    /* breadcrumb */
    var SN = window.sectionNames || {}, SB = window.subNames || {};
    var bc = '<span class="bc-item">Home</span><i class="bx bx-chevron-right"></i>' +
             '<span class="bc-item' + (sub ? '' : ' active') + '">' + esc(SN[sec] || sec) + '</span>';
    if (sub) bc += '<i class="bx bx-chevron-right"></i><span class="bc-item active">' + esc(SB[sub] || sub) + '</span>';
    document.getElementById('breadcrumb').innerHTML = bc;

    /* ERP page header + content host */
    var m = metaFor(sec, sub);
    var acts = '<button class="btn btn-secondary btn-sm" title="Refresh" onclick="renderSection(APP.currentSection,APP.currentSub)"><i class="bx bx-refresh"></i> Refresh</button>';
    if (sec === 'reports' || sec === 'audit') {
      acts += '<button class="btn btn-secondary btn-sm" onclick="window.print()"><i class="bx bx-printer"></i> Print</button>';
    }
    document.getElementById('contentArea').innerHTML =
      '<div class="erp-page-header" id="erpPageHeader">' +
        '<div class="eph-left"><h1>' + esc(m.t) + '</h1>' +
        (m.d ? '<p>' + esc(m.d) + '</p>' : '') + '</div>' +
        '<div class="eph-actions">' + acts + '</div>' +
      '</div>' +
      '<section class="content-section active" id="sec-content"></section>';

    renderSection(sec, sub);
    if (typeof closeSidebar === 'function') closeSidebar();

    /* bottom nav highlight */
    document.querySelectorAll('.bnav-item').forEach(function (b) { b.classList.remove('active'); });
    var bnMap = { dashboard: 'dashboard', inbound: 'inbound', picking: 'picking', loading: 'loading' };
    var bn = bnMap[sec];
    if (bn) { var be = document.querySelector('.bnav-item[data-bnav="' + bn + '"]'); if (be) be.classList.add('active'); }
  };

  /* ---- 4. Grouped ERP sidebar (same section/sub IDs → permissions & routing unchanged) ---- */
  var NAV = [
    { label: '', items: [
      { id: 'dashboard', icon: 'bxs-dashboard', label: 'Dashboard', subs: [] }
    ]},
    { label: 'Inbound', items: [
      { id: 'inbound', icon: 'bxs-truck', label: 'Inbound', subs: [
        { id: 'security-gate', label: 'Vehicle Entry' },
        { id: 'pending-vehicle', label: 'Unloading Pending' },
        { id: 'unloading-screen', label: 'Goods Receipt / Unloading' },
        { id: 'posting-pending', label: 'Posting Pending' },
        { id: 'inbound-record', label: 'Inbound History' },
        { id: 'unloading-stock', label: 'Unloading Stock' }
      ]}
    ]},
    { label: 'Warehouse', items: [
      { id: 'putaway', icon: 'bxs-package', label: 'Putaway', subs: [] },
      { id: 'piv', icon: 'bxs-clipboard', label: 'PIV', subs: [] }
    ]},
    { label: 'Master Data', items: [
      { id: 'location', icon: 'bxs-map-pin', label: 'Storage Locations', subs: [] },
      { id: 'rack', icon: 'bxs-grid-alt', label: 'Storage Bins', subs: [] },
      { id: 'material', icon: 'bxs-label', label: 'Materials', subs: [] }
    ]},
    { label: 'Outbound', items: [
      { id: 'picking', icon: 'bxs-box', label: 'Picking', subs: [
        { id: 'obd-upload', label: 'Outbound Deliveries (OBD)' },
        { id: 'picking-assign', label: 'Assign Picking' },
        { id: 'start-picking', label: 'Execute Picking' },
        { id: 'picking-done', label: 'Picking Records' },
        { id: 'picking-with-loading', label: 'Pick & Load' }
      ]},
      { id: 'loading', icon: 'bxs-truck', label: 'Loading', subs: [
        { id: 'loading-assign', label: 'Assign Loading' },
        { id: 'start-loading', label: 'Execute Loading' },
        { id: 'loading-done', label: 'Loading Records' },
        { id: 'qty-mismatch', label: 'Quantity Differences' }
      ]}
    ]},
    { label: 'Insights', items: [
      { id: 'reports', icon: 'bxs-bar-chart-alt-2', label: 'Reports', subs: [] },
      { id: 'user-time', icon: 'bx-time-five', label: 'User Working Time', subs: [] },
      { id: 'audit', icon: 'bxs-receipt', label: 'Audit Log', subs: [] }
    ]},
    { label: 'Administration', items: [
      { id: 'admin', icon: 'bxs-user-detail', label: 'User Management', subs: [] },
      { id: 'settings', icon: 'bxs-cog', label: 'Settings', subs: [] }
    ]}
  ];

  window.renderSidebar = function () {
    if (!APP.currentUser) return;
    var nav = document.getElementById('sidebarNav');
    var h = '';
    NAV.forEach(function (g) {
      var items = '';
      g.items.forEach(function (mod) {
        var parentOk = chkPerm(mod.id);
        var visibleSubs = mod.subs.filter(function (s) { return chkPerm(s.id); });
        if (!parentOk && !visibleSubs.length) return;
        items += '<a href="#" data-section="' + mod.id + '" data-tip="' + esc(mod.label) + '"' +
                 ' class="nav-item' + (visibleSubs.length ? ' has-sub' : '') + '">' +
                 '<i class="bx ' + mod.icon + '"></i>' +
                 '<span class="nav-text">' + esc(mod.label) + '</span>' +
                 (visibleSubs.length ? '<i class="bx bx-chevron-down sub-arrow"></i>' : '') + '</a>';
        if (visibleSubs.length) {
          items += '<div class="nav-sub" id="' + mod.id + 'Sub">';
          visibleSubs.forEach(function (s) {
            items += '<a href="#" data-sub="' + s.id + '" class="nav-sub-item"><span class="nav-text">' + esc(s.label) + '</span></a>';
          });
          items += '</div>';
        }
      });
      if (items) {
        if (g.label) h += '<div class="nav-group-label">' + esc(g.label) + '</div>';
        h += items;
      }
    });
    nav.innerHTML = h;

    /* one delegated handler (container onclick assignment = no duplicate binds) */
    nav.onclick = function (e) {
      var subEl = e.target.closest('.nav-sub-item');
      if (subEl) {
        e.preventDefault();
        var sec = (subEl.closest('.nav-sub').id || '').replace(/Sub$/, '');
        navTo(sec, subEl.getAttribute('data-sub'));
        return;
      }
      var item = e.target.closest('.nav-item');
      if (!item) return;
      e.preventDefault();
      var s2 = item.getAttribute('data-section');
      if (item.classList.contains('has-sub')) {
        if (document.body.classList.contains('nav-collapsed')) {
          document.body.classList.remove('nav-collapsed');
          try { localStorage.setItem('wms_nav', 'e'); } catch (err) {}
        }
        item.classList.toggle('open');
        var sb = document.getElementById(s2 + 'Sub');
        if (sb) sb.classList.toggle('open');
        return;
      }
      navTo(s2);
    };

    /* restore active state after re-render */
    if (APP.currentSection) {
      var a = nav.querySelector('.nav-item[data-section="' + APP.currentSection + '"]');
      if (a) {
        a.classList.add('active');
        if (APP.currentSub) {
          a.classList.add('open');
          var s3 = document.getElementById(APP.currentSection + 'Sub');
          if (s3) s3.classList.add('open');
          var b = nav.querySelector('.nav-sub-item[data-sub="' + APP.currentSub + '"]');
          if (b) b.classList.add('active');
        }
      }
    }
  };

  /* ---- 5. Compact ERP KPI card ---- */
  window.kpi = function (icon, val, label, color) {
    var map = { accent: 'blue', info: 'blue', accent2: 'indigo', success: 'green', warning: 'amber', danger: 'red' };
    return '<div class="kpi-card kpi-' + (map[color] || 'blue') + '">' +
      '<div class="kpi-top"><span class="kpi-icon"><i class="bx ' + icon + '"></i></span>' +
      '<span class="kpi-label">' + esc(label) + '</span></div>' +
      '<div class="kpi-value">' + val + '</div></div>';
  };

  /* ---- 6. Status badge helper (usable in any table) ---- */
  var STATUS_MAP = [
    [/mismatch|reject|cancel|fail|error|short|block|lock|wrong/i, 'danger'],
    [/pend|wait|hold|partial|draft|queue/i, 'warning'],
    [/complet|posted|unload(ed)|load(ed)|approv|done|match|activ|full|receiv|grn/i, 'success'],
    [/progress|process|assign|unload|load|pick|transit|start|run/i, 'info']
  ];
  window.statusBadge = function (s) {
    var txt = String(s == null ? '' : s), cls = 'neutral';
    for (var i = 0; i < STATUS_MAP.length; i++) {
      if (STATUS_MAP[i][0].test(txt)) { cls = STATUS_MAP[i][1]; break; }
    }
    return '<span class="badge badge-' + cls + '">' + esc(txt || '—') + '</span>';
  };

  /* ---- 7. Collapsible enterprise filter panel ---- */
  window.erpFilterPanel = function (id, title, fieldsHtml, onSearch, onClear) {
    return '<div class="filter-panel" id="' + id + '">' +
      '<div class="fp-header" onclick="erpToggleFilters(\'' + id + '\')">' +
        '<span class="fp-title"><i class="bx bx-filter"></i> ' + esc(title) + '</span>' +
        '<i class="bx bx-chevron-up fp-toggle"></i></div>' +
      '<div class="fp-body">' + fieldsHtml + '</div>' +
      '<div class="fp-footer">' +
        (onClear ? '<button class="btn btn-secondary btn-sm" onclick="' + onClear + '"><i class="bx bx-eraser"></i> Clear</button>' : '') +
        (onSearch ? '<button class="btn btn-primary btn-sm" onclick="' + onSearch + '"><i class="bx bx-search"></i> Search</button>' : '') +
      '</div></div>';
  };
  window.erpToggleFilters = function (id) {
    var p = document.getElementById(id); if (p) p.classList.toggle('closed');
  };

  /* ---- 8. Header controls ---- */
  function rebind(id, fn) {
    var b = document.getElementById(id); if (!b) return;
    var n = b.cloneNode(true); b.parentNode.replaceChild(n, b);
    n.addEventListener('click', fn); return n;
  }

  /* density toggle (replaces removed dark/light toggle) */
  try { if (localStorage.getItem('wms_compact') === '1') document.body.classList.add('compact'); } catch (e) {}
  rebind('themeToggle', function () {
    document.body.classList.toggle('compact');
    var on = document.body.classList.contains('compact');
    try { localStorage.setItem('wms_compact', on ? '1' : '0'); } catch (e) {}
    showToast(on ? 'Compact density: ON' : 'Compact density: OFF', 'info');
  });

  /* sidebar collapse (desktop) / drawer (mobile) */
  function setCollapsed(v) {
    document.body.classList.toggle('nav-collapsed', v);
    try { localStorage.setItem('wms_nav', v ? 'c' : 'e'); } catch (e) {}
  }
  try { if (localStorage.getItem('wms_nav') === 'c') document.body.classList.add('nav-collapsed'); } catch (e) {}
  rebind('menuToggle', function () {
    if (window.innerWidth <= 768) {
      var sb = document.getElementById('sidebar'), ov = document.getElementById('sidebarOverlay');
      if (sb) sb.classList.add('open');
      if (ov) ov.classList.add('open');
    } else {
      setCollapsed(!document.body.classList.contains('nav-collapsed'));
    }
  });
  rebind('sidebarClose', function () {
    var sb = document.getElementById('sidebar'), ov = document.getElementById('sidebarOverlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('open');
  });

  /* help dialog */
  rebind('helpBtn', function () {
    var b = '<div class="form-row">' +
      '<div class="form-group"><label>Global Search</label><div>Press <kbd>Ctrl</kbd> + <kbd>K</kbd> to search material, EAN, OBD, vehicle, invoice.</div></div>' +
      '<div class="form-group"><label>Sidebar</label><div>☰ collapses the menu on desktop; opens the drawer on mobile.</div></div>' +
      '<div class="form-group"><label>Density</label><div>The Aa button switches compact table density.</div></div>' +
      '<div class="form-group"><label>Support</label><div>VIP Industries Ltd. (MD20) — Developed by Nikhil Patil.</div></div></div>';
    showModal('Help & Shortcuts', b, 'sm', '<button class="btn btn-secondary" onclick="closeModal()">Close</button>');
  });

  /* ---- 9. Show role in header after login ---- */
  if (typeof window.doLogin === 'function') {
    var _doLogin = window.doLogin;
    window.doLogin = async function (u, p) {
      var ok = await _doLogin(u, p);
      if (ok && APP.currentUser) {
        var r = document.getElementById('userRole');
        if (r) r.textContent = APP.currentUser.role || '';
        var av = document.getElementById('userAvatar');
        if (av) av.textContent = (APP.currentUser.name || 'U').trim().charAt(0).toUpperCase();
        var un = document.getElementById('userName');
        if (un) un.textContent = APP.currentUser.name || 'User';
      }
      return ok;
    };
  }

  /* ---- 10. If a session was restored before this patch loaded, re-render the shell ---- */
  if (window.APP && APP.currentUser) {
    renderSidebar();
    var ca = document.getElementById('contentArea');
    if (ca && !document.getElementById('sec-content')) {
      navTo(APP.currentSection || 'dashboard', APP.currentSub);
    } else if (typeof updateNotifBadge === 'function') {
      updateNotifBadge();
    }
  }
})();