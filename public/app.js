/* ================================================================
   VIP Industry (MD20) - Warehouse Management System
   Developed by: Nikhil Patil
   ================================================================ */

const App = {
  user: null,
  token: null,
  currentPage: 'dashboard',
  scannerCallback: null,
  scannerInstance: null,

  // ===================== INIT =====================
  init() {
    const token = localStorage.getItem('vip_token');
    const user = localStorage.getItem('vip_user');
    if (token && user) {
      this.token = token;
      this.user = JSON.parse(user);
      this.showApp();
    } else {
      this.showLogin();
    }
    window.addEventListener('hashchange', () => this.route());
  },

  // ===================== API HELPER =====================
  async api(method, url, data) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.token
      }
    };
    if (data) opts.body = JSON.stringify(data);
    try {
      const res = await fetch(url, opts);
      if (res.status === 401) { this.logout(); return null; }
      return await res.json();
    } catch (e) {
      this.toast('Network error', 'error');
      return null;
    }
  },

  // ===================== TOAST =====================
  toast(msg, type) {
    type = type || 'info';
    const c = document.getElementById('toastContainer');
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i> ' + msg;
    c.appendChild(t);
    setTimeout(function() { t.remove(); }, 3200);
  },

  // ===================== THEME =====================
  toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('vip_theme', next);
    const icon = document.querySelector('.theme-toggle i');
    icon.className = next === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
  },

  // ===================== AUTH =====================
  showLogin() {
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('headerUser').style.display = 'none';
    document.getElementById('pageContent').innerHTML =
      '<div class="login-container">' +
        '<div class="login-box">' +
          '<div class="login-icon"><i class="fas fa-warehouse"></i></div>' +
          '<h2>VIP Industry (MD20)</h2>' +
          '<p>Warehouse Management System - Secure Login</p>' +
          '<div class="form-group"><label>Username</label>' +
            '<input type="text" id="loginUser" placeholder="Enter username" onkeydown="if(event.key===\'Enter\')document.getElementById(\'loginPass\').focus()">' +
          '</div>' +
          '<div class="form-group"><label>Password</label>' +
            '<input type="password" id="loginPass" placeholder="Enter password" onkeydown="if(event.key===\'Enter\')App.doLogin()">' +
          '</div>' +
          '<button class="btn btn-primary btn-block" onclick="App.doLogin()"><i class="fas fa-sign-in-alt"></i> Login</button>' +
        '</div>' +
      '</div>';
  },

  async doLogin() {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value.trim();
    if (!username || !password) return this.toast('Fill all fields', 'warning');
    const res = await this.api('POST', '/api/auth/login', { username: username, password: password });
    if (res && res.token) {
      this.token = res.token;
      this.user = res.user;
      localStorage.setItem('vip_token', res.token);
      localStorage.setItem('vip_user', JSON.stringify(res.user));
      this.toast('Welcome, ' + res.user.name, 'success');
      this.showApp();
    } else {
      this.toast((res && res.error) ? res.error : 'Login failed', 'error');
    }
  },

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('vip_token');
    localStorage.removeItem('vip_user');
    this.showLogin();
  },

  // ===================== SHOW APP =====================
  showApp() {
    document.getElementById('sidebar').style.display = 'block';
    document.getElementById('headerUser').style.display = 'flex';
    document.getElementById('headerUserName').textContent = this.user.name;
    this.buildSidebar();
    const theme = localStorage.getItem('vip_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.querySelector('.theme-toggle i');
    icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
    if (!window.location.hash) window.location.hash = '#dashboard';
    this.route();
  },

  buildSidebar() {
    var access = [];
    try { access = JSON.parse(this.user.access || '[]'); } catch(e) { access = []; }
    var isAdmin = access.indexOf('admin') >= 0;
    var has = function(m) { return access.indexOf(m) >= 0 || isAdmin; };
    var menu = document.getElementById('sidebarMenu');
    var items = [
      { id: 'dashboard', icon: 'fa-tachometer-alt', label: 'Dashboard', show: true },
      { section: 'INBOUND' },
      { id: 'inbound-entry', icon: 'fa-truck', label: 'Vehicle Entry', show: has('inbound') },
      { id: 'inbound-material', icon: 'fa-boxes-stacked', label: 'Inbound Material', show: has('inbound') },
      { id: 'inbound-unload', icon: 'fa-dolly', label: 'Unload Process', show: has('inbound') },
      { id: 'inbound-records', icon: 'fa-clipboard-list', label: 'Inbound Records', show: has('inbound') || has('putaway') },
      { section: 'PUTAWAY' },
      { id: 'putaway', icon: 'fa-location-dot', label: 'Putaway', show: has('putaway') },
      { section: 'PIV' },
      { id: 'piv', icon: 'fa-barcode', label: 'PIV Process', show: has('piv') },
      { section: 'LOCATION' },
      { id: 'location', icon: 'fa-map-marker-alt', label: 'Location Page', show: has('location') },
      { section: 'MASTER DATA' },
      { id: 'material-master', icon: 'fa-database', label: 'Material Master', show: has('material') },
      { id: 'bin-management', icon: 'fa-th', label: 'Bin Management', show: has('bin') },
      { section: 'OTHERS' },
      { id: 'live-action', icon: 'fa-bolt', label: 'Live Action', show: true },
      { id: 'admin', icon: 'fa-user-shield', label: 'Admin Panel', show: isAdmin },
    ];
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.section) {
        html += '<div class="sidebar-section">' + it.section + '</div>';
      } else if (it.show) {
        html += '<div class="sidebar-item" data-page="' + it.id + '" onclick="App.navigate(\'' + it.id + '\')">' +
          '<i class="fas ' + it.icon + '"></i><span>' + it.label + '</span></div>';
      }
    }
    menu.innerHTML = html;
  },

  navigate(page) {
    window.location.hash = '#' + page;
  },

  route() {
    var hash = window.location.hash.replace('#', '') || 'dashboard';
    this.currentPage = hash;
    document.querySelectorAll('.sidebar-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.page === hash);
    });
    var pages = {
      'dashboard': function() { App.pageDashboard(); },
      'inbound-entry': function() { App.pageInboundEntry(); },
      'inbound-material': function() { App.pageInboundMaterial(); },
      'inbound-unload': function() { App.pageInboundUnload(); },
      'inbound-records': function() { App.pageInboundRecords(); },
      'putaway': function() { App.pagePutaway(); },
      'piv': function() { App.pagePIV(); },
      'location': function() { App.pageLocation(); },
      'material-master': function() { App.pageMaterialMaster(); },
      'bin-management': function() { App.pageBinManagement(); },
      'live-action': function() { App.pageLiveAction(); },
      'admin': function() { App.pageAdmin(); },
    };
    var renderer = pages[hash];
    if (renderer) {
      document.getElementById('pageContent').innerHTML = '<div class="spinner"></div>';
      renderer();
    } else {
      document.getElementById('pageContent').innerHTML = '<div class="empty-state"><i class="fas fa-question-circle"></i><p>Page not found</p></div>';
    }
  },

  // ===================== SCANNER =====================
  scannerOpen(callback) {
    this.scannerCallback = callback;
    document.getElementById('scannerModal').style.display = 'flex';
    document.getElementById('scannerManualInput').value = '';
    var container = document.getElementById('scannerContainer');
    container.innerHTML = '';
    var self = this;
    try {
      this.scannerInstance = new Html5Qrcode("scannerContainer");
      this.scannerInstance.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        function(decodedText) { self.scannerSubmit(decodedText); },
        function() {}
      ).catch(function() {
        container.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center;">Camera not available. Use manual input below.</p>';
      });
    } catch (e) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center;">Scanner error. Use manual input.</p>';
    }
    setTimeout(function() { document.getElementById('scannerManualInput').focus(); }, 500);
  },

  scannerSubmit(value) {
    var val = value || document.getElementById('scannerManualInput').value.trim();
    if (!val) return;
    this.scannerClose();
    if (this.scannerCallback) this.scannerCallback(val);
  },

  scannerClose() {
    if (this.scannerInstance) {
      try {
        var inst = this.scannerInstance;
        inst.stop().then(function() { inst.clear(); }).catch(function() {});
      } catch(e) {}
      this.scannerInstance = null;
    }
    document.getElementById('scannerModal').style.display = 'none';
  },

  // ===================== MODAL =====================
  openModal(title, bodyHtml, maxWidth) {
    document.getElementById('genericModalTitle').innerHTML = title;
    document.getElementById('genericModalBody').innerHTML = bodyHtml;
    document.getElementById('genericModalContent').style.maxWidth = (maxWidth || 600) + 'px';
    document.getElementById('genericModal').style.display = 'flex';
  },

  closeModal() {
    document.getElementById('genericModal').style.display = 'none';
  },

  // ===================== DASHBOARD =====================
    async pageDashboard() {
    var stats = await this.api('GET', '/api/dashboard/stats');
    if (!stats) return;
    var actions = await this.api('GET', '/api/live-actions');
    var recentActions = actions ? actions.slice(0, 6) : [];

    var totalBinPercent = stats.totalBins > 0 ? Math.round((stats.filledBins / stats.totalBins) * 100) : 0;

    var feedHtml = '';
    for (var f = 0; f < recentActions.length; f++) {
      var a = recentActions[f];
      var iconCls = a.module || 'admin';
      var iconMap = { inbound: 'fa-truck', putaway: 'fa-location-dot', piv: 'fa-barcode', location: 'fa-map-marker-alt', admin: 'fa-user-shield', material: 'fa-database', bin: 'fa-th', auth: 'fa-sign-in-alt' };
      var colorMap = { inbound: 'var(--accent)', putaway: 'var(--success)', piv: '#a855f7', location: 'var(--danger)', admin: 'var(--warning)', material: 'var(--accent)', bin: 'var(--success)', auth: 'var(--accent)' };
      feedHtml += '<div class="feed-item">' +
        '<div class="feed-dot" style="background:' + (colorMap[iconCls] || 'var(--accent)') + '"></div>' +
        '<div class="feed-text"><span class="feed-action">' + a.action + '</span> <span class="feed-detail">' + (a.details || '') + '</span>' +
        '<div class="feed-time"><i class="fas fa-clock"></i> ' + a.created_at + (a.user ? ' · <strong>' + a.user + '</strong>' : '') + '</div></div></div>';
    }

    document.getElementById('pageContent').innerHTML =
      '<div class="dash-grid">' +
        // Row 1: Quick Actions
        '<div class="dash-card dash-quick">' +
          '<div class="dash-card-head"><i class="fas fa-bolt"></i> Quick Actions</div>' +
          '<div class="quick-grid">' +
            '<div class="quick-btn" onclick="App.navigate(\'inbound-entry\')"><i class="fas fa-truck"></i><span>New Vehicle</span></div>' +
            '<div class="quick-btn" onclick="App.navigate(\'inbound-unload\')"><i class="fas fa-dolly"></i><span>Unload</span></div>' +
            '<div class="quick-btn" onclick="App.navigate(\'putaway\')"><i class="fas fa-location-dot"></i><span>Putaway</span></div>' +
            '<div class="quick-btn" onclick="App.navigate(\'piv\')"><i class="fas fa-barcode"></i><span>PIV</span></div>' +
            '<div class="quick-btn" onclick="App.navigate(\'location\')"><i class="fas fa-map-marker-alt"></i><span>Location</span></div>' +
            '<div class="quick-btn" onclick="App.navigate(\'material-master\')"><i class="fas fa-database"></i><span>Materials</span></div>' +
          '</div>' +
        '</div>' +
        // Row 1: Bin Usage
        '<div class="dash-card dash-bin">' +
          '<div class="dash-card-head"><i class="fas fa-th"></i> Bin Usage</div>' +
          '<div class="bin-ring-wrap">' +
            '<div class="bin-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring-bg"/><circle cx="60" cy="60" r="52" class="ring-fill" style="stroke-dasharray:' + (3.27 * totalBinPercent) + ' 327"/>' +
            '</svg><div class="ring-text"><span class="ring-pct">' + totalBinPercent + '%</span><span class="ring-label">Used</span></div></div>' +
            '<div class="bin-stats"><div class="bin-stat"><span class="bin-stat-val">' + stats.filledBins + '</span><span class="bin-stat-lbl">Filled</span></div>' +
            '<div class="bin-stat"><span class="bin-stat-val">' + (stats.totalBins - stats.filledBins) + '</span><span class="bin-stat-lbl">Empty</span></div>' +
            '<div class="bin-stat"><span class="bin-stat-val">' + stats.totalBins + '</span><span class="bin-stat-lbl">Total</span></div></div>' +
          '</div>' +
        '</div>' +
        // Row 2: Stats
        '<div class="dash-card dash-stats">' +
          '<div class="dash-card-head"><i class="fas fa-chart-bar"></i> Warehouse Overview</div>' +
          '<div class="mini-stats-grid">' +
            '<div class="mini-stat"><div class="mini-stat-icon" style="background:rgba(0,143,211,0.12);color:var(--accent)"><i class="fas fa-truck"></i></div><div class="mini-stat-info"><span class="mini-stat-val">' + stats.pendingVehicles + '</span><span class="mini-stat-lbl">Pending</span></div></div>' +
            '<div class="mini-stat"><div class="mini-stat-icon" style="background:rgba(240,171,0,0.12);color:var(--warning)"><i class="fas fa-dolly"></i></div><div class="mini-stat-info"><span class="mini-stat-val">' + stats.unloadingVehicles + '</span><span class="mini-stat-lbl">Unloading</span></div></div>' +
            '<div class="mini-stat"><div class="mini-stat-icon" style="background:rgba(76,175,80,0.12);color:var(--success)"><i class="fas fa-file-invoice"></i></div><div class="mini-stat-info"><span class="mini-stat-val">' + stats.totalGRN + '</span><span class="mini-stat-lbl">GRN</span></div></div>' +
            '<div class="mini-stat"><div class="mini-stat-icon" style="background:rgba(0,143,211,0.12);color:var(--accent)"><i class="fas fa-location-dot"></i></div><div class="mini-stat-info"><span class="mini-stat-val">' + stats.totalPutaway + '</span><span class="mini-stat-lbl">Putaway</span></div></div>' +
            '<div class="mini-stat"><div class="mini-stat-icon" style="background:rgba(168,85,247,0.12);color:#a855f7"><i class="fas fa-barcode"></i></div><div class="mini-stat-info"><span class="mini-stat-val">' + stats.totalPIV + '</span><span class="mini-stat-lbl">PIV</span></div></div>' +
            '<div class="mini-stat"><div class="mini-stat-icon" style="background:rgba(76,175,80,0.12);color:var(--success)"><i class="fas fa-database"></i></div><div class="mini-stat-info"><span class="mini-stat-val">' + stats.totalMaterials + '</span><span class="mini-stat-lbl">Materials</span></div></div>' +
            '<div class="mini-stat"><div class="mini-stat-icon" style="background:rgba(0,143,211,0.12);color:var(--accent)"><i class="fas fa-th"></i></div><div class="mini-stat-info"><span class="mini-stat-val">' + stats.totalBins + '</span><span class="mini-stat-lbl">Bins</span></div></div>' +
            '<div class="mini-stat"><div class="mini-stat-icon" style="background:rgba(76,175,80,0.12);color:var(--success)"><i class="fas fa-check-double"></i></div><div class="mini-stat-info"><span class="mini-stat-val">' + stats.activeLocations + '</span><span class="mini-stat-lbl">Locations</span></div></div>' +
          '</div>' +
        '</div>' +
        // Row 2: Live Feed
        '<div class="dash-card dash-feed">' +
          '<div class="dash-card-head"><i class="fas fa-bolt"></i> Live Activity <span class="live-dot"></span></div>' +
          (feedHtml || '<div class="feed-empty"><i class="fas fa-pause-circle"></i><p>No activities yet</p></div>') +
        '</div>' +
      '</div>';

    // Auto refresh live feed
    if (this._dashInterval) clearInterval(this._dashInterval);
    var self = this;
    this._dashInterval = setInterval(function() {
      if (self.currentPage === 'dashboard') self.pageDashboard();
    }, 15000);
  },
  
  // ===================== INBOUND ENTRY =====================
  pageInboundEntry() {
    var invoices = [];
    var self = this;

    function render() {
      var invTags = '';
      for (var i = 0; i < invoices.length; i++) {
        invTags += '<div class="invoice-tag">' + invoices[i] + ' <span class="remove-inv" onclick="App._veRemoveInv(' + i + ')">&times;</span></div>';
      }
      if (invoices.length === 0) invTags = '<span style="color:var(--text-muted);font-size:13px;">No invoices added yet</span>';

      document.getElementById('pageContent').innerHTML =
        '<div class="card-3d">' +
          '<div class="card-title"><i class="fas fa-truck"></i> Vehicle Entry - Inbound</div>' +
          '<div class="form-grid">' +
            '<div class="form-group"><label>Vehicle No.</label><input type="text" id="veVehicleNo" placeholder="e.g. MH12AB1234"></div>' +
            '<div class="form-group"><label>Driver Name</label><input type="text" id="veDriverName" placeholder="Driver full name"></div>' +
            '<div class="form-group"><label>Driver Mobile</label><input type="text" id="veDriverMobile" placeholder="Mobile number"></div>' +
            '<div class="form-group"><label>Transport</label><input type="text" id="veTransport" placeholder="Transport company"></div>' +
          '</div>' +
          '<div class="mt-2">' +
            '<label style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);font-weight:600;">Invoices</label>' +
            '<div class="input-group mt-1">' +
              '<input type="text" id="veInvoiceInput" placeholder="Enter invoice number and press Add">' +
              '<button class="btn btn-primary btn-sm" onclick="App._veAddInv()"><i class="fas fa-plus"></i> Add</button>' +
            '</div>' +
            '<div class="invoice-list" id="veInvoiceList">' + invTags + '</div>' +
          '</div>' +
          '<div class="mt-2"><button class="btn btn-primary" onclick="App._veSubmit()"><i class="fas fa-arrow-right"></i> Next - Add Materials</button></div>' +
        '</div>';

      document.getElementById('veInvoiceInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') self._veAddInv();
      });
    }

    this._veInvoices = invoices;
    this._veRender = render;
    render();
  },

  _veAddInv: function() {
    var input = document.getElementById('veInvoiceInput');
    var val = input.value.trim();
    if (!val) return this.toast('Enter invoice number', 'warning');
    if (this._veInvoices.indexOf(val) >= 0) return this.toast('Invoice already added', 'warning');
    this._veInvoices.push(val);
    input.value = '';
    input.focus();
    this._veRender();
  },

  _veRemoveInv: function(idx) {
    this._veInvoices.splice(idx, 1);
    this._veRender();
  },

  _veSubmit: async function() {
    var vehicle_no = document.getElementById('veVehicleNo').value.trim();
    var driver_name = document.getElementById('veDriverName').value.trim();
    var driver_mobile = document.getElementById('veDriverMobile').value.trim();
    var transport = document.getElementById('veTransport').value.trim();
    if (!vehicle_no || !driver_name || !driver_mobile || !transport) return this.toast('Fill all vehicle details', 'warning');
    if (this._veInvoices.length === 0) return this.toast('Add at least one invoice', 'warning');
    var invoices = [];
    for (var i = 0; i < this._veInvoices.length; i++) {
      invoices.push({ invoice_no: this._veInvoices[i] });
    }
    var res = await this.api('POST', '/api/vehicles', {
      vehicle_no: vehicle_no, driver_name: driver_name, driver_mobile: driver_mobile, transport: transport, invoices: invoices
    });
    if (res && !res.error) {
      this.toast('Vehicle entry saved! Now add materials.', 'success');
      this.navigate('inbound-material');
    } else {
      this.toast((res && res.error) || 'Error saving', 'error');
    }
  },

  // ===================== INBOUND MATERIAL =====================
  async pageInboundMaterial() {
    var vehicles = await this.api('GET', '/api/vehicles');
    if (!vehicles) return;
    var pending = [];
    for (var i = 0; i < vehicles.length; i++) {
      if (vehicles[i].status === 'pending') pending.push(vehicles[i]);
    }
    if (pending.length === 0) {
      document.getElementById('pageContent').innerHTML =
        '<div class="card-3d"><div class="card-title"><i class="fas fa-boxes-stacked"></i> Inbound Material Entry</div>' +
        '<div class="empty-state"><i class="fas fa-inbox"></i><p>No pending vehicles. Add vehicle entry first.</p></div></div>';
      return;
    }
    var opts = '<option value="">-- Select Vehicle --</option>';
    for (var j = 0; j < pending.length; j++) {
      opts += '<option value="' + pending[j].id + '">' + pending[j].vehicle_no + ' - ' + pending[j].driver_name + ' [' + pending[j].invoice_list + ']</option>';
    }
    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title"><i class="fas fa-boxes-stacked"></i> Inbound Material Entry</div>' +
        '<div class="form-group mb-2"><label>Select Vehicle</label><select id="imVehicle" onchange="App._imLoad()">' + opts + '</select></div>' +
        '<div id="imContent"></div>' +
      '</div>';
  },

  async _imLoad() {
    var vid = document.getElementById('imVehicle').value;
    if (!vid) { document.getElementById('imContent').innerHTML = ''; return; }
    var data = await this.api('GET', '/api/vehicles/' + vid);
    if (!data) return;
    var invNos = [];
    for (var i = 0; i < data.invoices.length; i++) invNos.push(data.invoices[i].invoice_no);
    window._imInvoices = invNos;
    window._imVehicleId = vid;

    var sheets = '';
    for (var j = 0; j < invNos.length; j++) {
      sheets += '<div class="scan-sheet" id="imSheet_' + j + '">' +
        '<div class="flex-between mb-1"><strong class="text-accent">Invoice: ' + invNos[j] + '</strong>' +
        '<button class="btn btn-outline btn-xs" onclick="App._imAddRow(' + j + ')"><i class="fas fa-plus"></i> Add Material</button></div>' +
        '<div class="scan-row scan-row-header"><span>Material</span><span>EAN</span><span>Description</span><span>Qty</span><span></span></div>' +
        '<div id="imRows_' + j + '">' +
          '<div class="scan-row">' +
            '<input type="text" placeholder="Material code" class="im-mat" data-inv="' + invNos[j] + '">' +
            '<input type="text" placeholder="EAN" class="im-ean" data-inv="' + invNos[j] + '">' +
            '<input type="text" placeholder="Description" class="im-desc" data-inv="' + invNos[j] + '">' +
            '<input type="number" placeholder="Qty" class="im-qty" data-inv="' + invNos[j] + '">' +
            '<button class="btn btn-danger btn-xs" onclick="this.closest(\'.scan-row\').remove()"><i class="fas fa-trash"></i></button>' +
          '</div>' +
        '</div></div>';
    }
    document.getElementById('imContent').innerHTML = sheets +
      '<div class="mt-2"><button class="btn btn-success" onclick="App._imSubmit()"><i class="fas fa-check"></i> Submit - Move to Unloading Pending</button></div>';
  },

  _imAddRow: function(idx) {
    var inv = window._imInvoices[idx];
    var container = document.getElementById('imRows_' + idx);
    var row = document.createElement('div');
    row.className = 'scan-row';
    row.innerHTML = '<input type="text" placeholder="Material code" class="im-mat" data-inv="' + inv + '">' +
      '<input type="text" placeholder="EAN" class="im-ean" data-inv="' + inv + '">' +
      '<input type="text" placeholder="Description" class="im-desc" data-inv="' + inv + '">' +
      '<input type="number" placeholder="Qty" class="im-qty" data-inv="' + inv + '">' +
      '<button class="btn btn-danger btn-xs" onclick="this.closest(\'.scan-row\').remove()"><i class="fas fa-trash"></i></button>';
    container.appendChild(row);
  },

  _imSubmit: async function() {
    var materials = [];
    var sheets = document.querySelectorAll('.scan-sheet');
    for (var s = 0; s < sheets.length; s++) {
      var rows = sheets[s].querySelectorAll('.scan-row:not(.scan-row-header)');
      for (var r = 0; r < rows.length; r++) {
        var mat = rows[r].querySelector('.im-mat').value.trim();
        var ean = rows[r].querySelector('.im-ean').value.trim();
        var desc = rows[r].querySelector('.im-desc').value.trim();
        var qty = parseFloat(rows[r].querySelector('.im-qty').value) || 0;
        var inv = rows[r].querySelector('.im-mat').dataset.inv;
        if (mat && qty > 0) materials.push({ invoice_no: inv, material: mat, ean: ean, description: desc, qty: qty });
      }
    }
    if (materials.length === 0) return this.toast('Add at least one material with qty', 'warning');
    var res = await this.api('POST', '/api/inbound/materials', { vehicle_id: window._imVehicleId, materials: materials });
    if (res && !res.error) {
      this.toast('Materials saved! Moved to unloading pending.', 'success');
      this.navigate('inbound-unload');
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  // ===================== INBOUND UNLOAD =====================
  async pageInboundUnload() {
    var vehicles = await this.api('GET', '/api/inbound/pending');
    if (!vehicles) return;
    if (vehicles.length === 0) {
      document.getElementById('pageContent').innerHTML =
        '<div class="card-3d"><div class="card-title"><i class="fas fa-dolly"></i> Unload Process</div>' +
        '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No pending unloads.</p></div></div>';
      return;
    }
    var rows = '';
    for (var i = 0; i < vehicles.length; i++) {
      var v = vehicles[i];
      var badgeCls = v.status === 'pending' ? 'pending' : 'unloading';
      rows += '<tr><td><strong>' + v.vehicle_no + '</strong></td><td>' + v.driver_name + '</td><td>' + v.transport + '</td>' +
        '<td>' + v.invoice_list + '</td><td><span class="badge badge-' + badgeCls + '">' + v.status + '</span></td>' +
        '<td><button class="btn btn-primary btn-sm" onclick="App._ulStart(' + v.id + ')"><i class="fas fa-dolly"></i> Unload</button></td></tr>';
    }
    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title"><i class="fas fa-dolly"></i> Unload Process - Select Vehicle</div>' +
        '<div class="table-wrapper"><table><thead><tr><th>Vehicle</th><th>Driver</th><th>Transport</th><th>Invoices</th><th>Status</th><th>Action</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>';
  },

    async _ulStart(vid) {
    var data = await this.api('GET', '/api/vehicles/' + vid);
    if (!data) return;
    // Sirf wo invoices dikhao jinka abhi bhi pending material hai
    var pendingInvMap = {};
    for (var i = 0; i < data.materials.length; i++) {
      if (data.materials[i].status === 'pending') {
        pendingInvMap[data.materials[i].invoice_no] = true;
      }
    }
    var invNos = Object.keys(pendingInvMap);
    if (invNos.length === 0) {
      this.toast('All invoices already unloaded!', 'info');
      return;
    }
    var opts = '<option value="">-- Select Invoice --</option>';
    for (var j = 0; j < invNos.length; j++) opts += '<option value="' + invNos[j] + '">' + invNos[j] + '</option>';
    this.openModal('<i class="fas fa-dolly"></i> Unload Vehicle: ' + data.vehicle_no,
      '<p class="mb-2">Select invoice to scan/unload materials</p>' +
      '<div class="form-group mb-2"><label>Invoice No</label><select id="ulInvoice" onchange="App._ulLoadInv(' + vid + ')">' + opts + '</select></div>' +
      '<div id="ulScanContent"></div>');
  },

  async _ulLoadInv(vid) {
    var inv = document.getElementById('ulInvoice').value;
    if (!inv) { document.getElementById('ulScanContent').innerHTML = ''; return; }
    var data = await this.api('GET', '/api/vehicles/' + vid);
    var mats = [];
    for (var i = 0; i < data.materials.length; i++) {
      if (data.materials[i].invoice_no === inv && data.materials[i].status === 'pending') mats.push(data.materials[i]);
    }
    if (mats.length === 0) {
      document.getElementById('ulScanContent').innerHTML = '<p class="text-success mt-1">All materials for this invoice already scanned!</p>';
      return;
    }
    window._ulVid = vid;
    window._ulInv = inv;
    var rows = '';
    for (var j = 0; j < mats.length; j++) {
      rows += '<div class="scan-row" id="ulRow_' + j + '">' +
        '<input type="text" value="' + mats[j].material + '" readonly style="background:var(--bg-secondary);color:var(--text-muted);">' +
        '<input type="text" id="ulScan_' + j + '" placeholder="Scan material" data-mat="' + mats[j].material + '">' +
        '<input type="number" id="ulQty_' + j + '" value="' + mats[j].qty + '">' +
        '<button class="btn btn-primary btn-xs" onclick="App._ulScanRow(' + j + ')"><i class="fas fa-qrcode"></i></button>' +
        '<span id="ulStatus_' + j + '"></span></div>';
    }
    document.getElementById('ulScanContent').innerHTML =
      '<div class="scan-sheet"><div class="scan-row scan-row-header"><span>Material</span><span>Scan/Type</span><span>Qty</span><span></span><span></span></div>' +
      rows + '</div><div class="mt-2"><button class="btn btn-success" onclick="App._ulSubmit()"><i class="fas fa-check"></i> Submit Scanned</button></div>';
  },

  _ulScanRow: function(idx) {
    var input = document.getElementById('ulScan_' + idx);
    var self = this;
    this.scannerOpen(function(val) {
      input.value = val;
      document.getElementById('ulStatus_' + idx).innerHTML = '<i class="fas fa-check-circle text-success"></i>';
      var next = document.getElementById('ulScan_' + (idx + 1));
      if (next) next.focus();
    });
  },

  _ulSubmit: async function() {
    var scanned_materials = [];
    var inputs = document.querySelectorAll('.ul-scan-input, [id^="ulScan_"]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value.trim()) {
        var idx = inputs[i].id.replace('ulScan_', '');
        var qtyEl = document.getElementById('ulQty_' + idx);
        scanned_materials.push({
          material: inputs[i].dataset.mat,
          scanned_value: inputs[i].value.trim(),
          qty: qtyEl ? parseFloat(qtyEl.value) || 0 : 0
        });
      }
    }
    if (scanned_materials.length === 0) return this.toast('Scan at least one item', 'warning');
    var res = await this.api('POST', '/api/inbound/unload', {
      vehicle_id: window._ulVid, invoice_no: window._ulInv, scanned_materials: scanned_materials
    });
    if (res && !res.error) {
      this.toast(res.message, 'success');
      if (res.grn_no) this.toast('GRN Created: ' + res.grn_no, 'info');
      this.closeModal();
      this.route();
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  // ===================== INBOUND RECORDS =====================
  async pageInboundRecords() {
    var grns = await this.api('GET', '/api/grn');
    if (!grns) return;
    if (grns.length === 0) {
      document.getElementById('pageContent').innerHTML =
        '<div class="card-3d"><div class="card-title"><i class="fas fa-clipboard-list"></i> Inbound Records</div>' +
        '<div class="empty-state"><i class="fas fa-inbox"></i><p>No GRN records yet.</p></div></div>';
      return;
    }
    var rows = '';
    for (var i = 0; i < grns.length; i++) {
      rows += '<tr><td><strong class="text-accent">' + grns[i].grn_no + '</strong></td><td>' + grns[i].vehicle_no + '</td>' +
        '<td>' + grns[i].driver_name + '</td><td>' + grns[i].invoice_list + '</td><td>' + grns[i].created_at + '</td>' +
        '<td><button class="btn btn-primary btn-xs" onclick="App._showDiff(\'' + grns[i].grn_no + '\')"><i class="fas fa-exchange-alt"></i> Difference</button></td></tr>';
    }
    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title"><i class="fas fa-clipboard-list"></i> Inbound Records - GRN List</div>' +
        '<div class="table-wrapper"><table><thead><tr><th>GRN No</th><th>Vehicle</th><th>Driver</th><th>Invoices</th><th>Date</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>';
  },

  async _showDiff(grnNo) {
    var diff = await this.api('GET', '/api/putaway/difference/' + grnNo);
    if (!diff) return;
    var rows = '';
    for (var i = 0; i < diff.length; i++) {
      var d = diff[i];
      var diffVal = d.inbound_qty - d.putaway_qty;
      var cls = diffVal > 0 ? 'diff-negative' : diffVal === 0 ? 'diff-zero' : 'diff-positive';
      rows += '<tr><td>' + d.invoice_no + '</td><td>' + d.material + '</td><td>' + d.inbound_qty + '</td><td>' + d.putaway_qty + '</td>' +
        '<td class="' + cls + '">' + diffVal + '</td>' +
        '<td><input type="number" value="' + d.short_qty + '" style="width:70px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;padding:4px;color:var(--text-primary);text-align:center;"></td></tr>';
    }
    this.openModal('<i class="fas fa-exchange-alt"></i> Difference - ' + grnNo,
      '<div class="table-wrapper"><table><thead><tr><th>Invoice</th><th>Material</th><th>Inbound</th><th>Putaway</th><th>Diff</th><th>Short</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>', 800);
  },

  // ===================== PUTAWAY =====================
  async pagePutaway() {
    var grns = await this.api('GET', '/api/grn');
    if (!grns) return;
    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title"><i class="fas fa-location-dot"></i> Putaway Process</div>' +
        '<div class="form-group mb-2"><label>GRN No</label><select id="paGrn" onchange="App._paLoadGrn()">' +
          '<option value="">-- Select GRN --</option>' +
          grns.map(function(g) { return '<option value="' + g.grn_no + '">' + g.grn_no + ' (' + g.vehicle_no + ')</option>'; }).join('') +
        '</select></div>' +
        '<div id="paContent"></div>' +
      '</div>';
  },

  async _paLoadGrn() {
    var grnNo = document.getElementById('paGrn').value;
    if (!grnNo) { document.getElementById('paContent').innerHTML = ''; return; }
    var data = await this.api('GET', '/api/grn/' + grnNo);
    if (!data) return;
    window._paGrnNo = grnNo;

    // Group materials by invoice
    var invMap = {};
    for (var i = 0; i < data.materials.length; i++) {
      var m = data.materials[i];
      if (!invMap[m.invoice_no]) invMap[m.invoice_no] = [];
      invMap[m.invoice_no].push(m);
    }

    var sheets = '';
    var invIdx = 0;
    for (var inv in invMap) {
      var mats = invMap[inv];
      var mRows = '';
      for (var j = 0; j < mats.length; j++) {
        mRows += '<div class="scan-row">' +
          '<input type="text" value="' + mats[j].material + '" readonly style="background:var(--bg-secondary);color:var(--text-muted);" data-mat="' + mats[j].material + '" data-ean="' + (mats[j].ean || '') + '" data-desc="' + (mats[j].description || '') + '" data-qty="' + mats[j].qty + '">' +
          '<input type="text" id="paScan_' + invIdx + '_' + j + '" placeholder="Scan/Type material" data-mat="' + mats[j].material + '" data-inbound-qty="' + mats[j].qty + '">' +
          '<input type="number" id="paQty_' + invIdx + '_' + j + '" placeholder="Putaway Qty">' +
          '<input type="text" id="paRack_' + invIdx + '_' + j + '" placeholder="Rack">' +
          '<button class="btn btn-primary btn-xs" onclick="App._paScanRow(\'paScan_' + invIdx + '_' + j + '\')"><i class="fas fa-qrcode"></i></button>' +
          '</div>';
      }
      sheets += '<div class="scan-sheet"><div class="flex-between mb-1"><strong class="text-accent">Invoice: ' + inv + '</strong></div>' +
        '<div class="scan-row scan-row-header"><span>Material</span><span>Scan/Type</span><span>Putaway Qty</span><span>Rack</span><span></span></div>' +
        mRows + '</div>';
      invIdx++;
    }
    document.getElementById('paContent').innerHTML = sheets +
      '<div class="mt-2"><button class="btn btn-success" onclick="App._paSubmit()"><i class="fas fa-check"></i> Submit Putaway</button></div>';
  },

  _paScanRow: function(inputId) {
    var input = document.getElementById(inputId);
    var self = this;
    this.scannerOpen(function(val) {
      input.value = val;
      // Auto-fill from material master
      self.api('GET', '/api/materials/lookup/' + encodeURIComponent(val)).then(function(mat) {
        if (mat) {
          var row = input.closest('.scan-row');
          var readonlyField = row.querySelector('input[readonly]');
          if (readonlyField && !readonlyField.dataset.mat) {
            // auto fill material code
          }
        }
      });
    });
  },

  _paSubmit: async function() {
    var items = [];
    var scanInputs = document.querySelectorAll('[id^="paScan_"]');
    for (var i = 0; i < scanInputs.length; i++) {
      var si = scanInputs[i];
      var idxStr = si.id.replace('paScan_', '');
      var qtyVal = parseFloat(document.getElementById('paQty_' + idxStr).value) || 0;
      var rackVal = document.getElementById('paRack_' + idxStr).value.trim();
      if (si.value.trim() && qtyVal > 0) {
        var readonlyField = si.closest('.scan-row').querySelector('input[readonly]');
        items.push({
          material: si.dataset.mat || si.value.trim(),
          ean: readonlyField ? readonlyField.dataset.ean : '',
          description: readonlyField ? readonlyField.dataset.desc : '',
          inbound_qty: parseFloat(si.dataset.inboundQty) || 0,
          putaway_qty: qtyVal,
          short_qty: (parseFloat(si.dataset.inboundQty) || 0) - qtyVal,
          rack: rackVal
        });
      }
    }
    if (items.length === 0) return this.toast('Scan at least one item', 'warning');

    // Get invoice from first item context
    var firstScanId = scanInputs[0].id;
    // We need invoice_no - get from sheet headers
    var sheets = document.querySelectorAll('.scan-sheet');
    var invoiceNo = '';
    if (sheets.length > 0) {
      var strong = sheets[0].querySelector('strong');
      if (strong) invoiceNo = strong.textContent.replace('Invoice: ', '').trim();
    }

    var res = await this.api('POST', '/api/putaway', {
      grn_no: window._paGrnNo,
      invoice_no: invoiceNo,
      items: items
    });
    if (res && !res.error) {
      this.toast('Putaway saved successfully!', 'success');
      this.route();
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  // ===================== PIV =====================
  pagePIV() {
    var self = this;
    window._pivRows = [{ date: new Date().toISOString().split('T')[0], rack: '', ean: '', material: '', description: '', qty: '', packing: '', box_no: '' }];

    function renderPiv() {
      var rows = '';
      for (var i = 0; i < window._pivRows.length; i++) {
        var r = window._pivRows[i];
        rows += '<div class="piv-grid piv-row-data" data-idx="' + i + '">' +
          '<input type="date" value="' + r.date + '" onchange="App._pivUpdate(' + i + ',\'date\',this.value)" style="background:var(--bg-input);border:1px solid var(--border);border-radius:4px;padding:6px;color:var(--text-primary);">' +
          '<input type="text" value="' + r.rack + '" placeholder="Rack" onchange="App._pivUpdate(' + i + ',\'rack\',this.value)" onfocus="App._pivScanField(this,\'rack\',' + i + ')" style="background:var(--bg-input);border:1px solid var(--border);border-radius:4px;padding:6px;color:var(--text-primary);cursor:pointer;">' +
          '<input type="text" value="' + r.ean + '" placeholder="EAN No" onchange="App._pivUpdate(' + i + ',\'ean\',this.value)" onfocus="App._pivScanField(this,\'ean\',' + i + ')" style="background:var(--bg-input);border:1px solid var(--border);border-radius:4px;padding:6px;color:var(--text-primary);cursor:pointer;">' +
          '<input type="text" value="' + r.material + '" placeholder="Material" onchange="App._pivUpdate(' + i + ',\'material\',this.value)" onfocus="App._pivScanField(this,\'material\',' + i + ')" style="background:var(--bg-input);border:1px solid var(--border);border-radius:4px;padding:6px;color:var(--text-primary);cursor:pointer;">' +
          '<input type="text" value="' + r.description + '" placeholder="Description" readonly style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;padding:6px;color:var(--text-muted);">' +
          '<input type="number" value="' + r.qty + '" placeholder="Qty" onchange="App._pivUpdate(' + i + ',\'qty\',this.value)" style="background:var(--bg-input);border:1px solid var(--border);border-radius:4px;padding:6px;color:var(--text-primary);">' +
          '<input type="text" value="' + r.packing + '" placeholder="Packing" onchange="App._pivUpdate(' + i + ',\'packing\',this.value)" style="background:var(--bg-input);border:1px solid var(--border);border-radius:4px;padding:6px;color:var(--text-primary);">' +
          '<input type="text" value="' + r.box_no + '" placeholder="Box No" onchange="App._pivUpdate(' + i + ',\'box_no\',this.value)" style="background:var(--bg-input);border:1px solid var(--border);border-radius:4px;padding:6px;color:var(--text-primary);">' +
          '</div>';
      }

      document.getElementById('pageContent').innerHTML =
        '<div class="card-3d"><div class="card-title"><i class="fas fa-barcode"></i> PIV Process</div>' +
          '<div class="form-group mb-2"><label>PIV By (Name)</label><input type="text" id="pivBy" placeholder="Enter name of person doing PIV"></div>' +
          '<div class="mt-2">' +
            '<div class="piv-grid piv-header"><span>Date</span><span>Rack</span><span>EAN No</span><span>Material</span><span>Description</span><span>Qty</span><span>Packing</span><span>Box No</span></div>' +
            rows +
          '</div>' +
          '<div class="mt-2" style="display:flex;gap:8px;">' +
            '<button class="btn btn-outline btn-sm" onclick="App._pivAddRow()"><i class="fas fa-plus"></i> Add Row</button>' +
            '<button class="btn btn-success" onclick="App._pivSubmit()"><i class="fas fa-check"></i> Submit PIV</button>' +
          '</div>' +
        '</div>';
    }

    this._pivRender = renderPiv;
    renderPiv();
  },

  _pivUpdate: function(idx, field, value) {
    window._pivRows[idx][field] = value;
    // Auto lookup material master
    if (field === 'ean' || field === 'material') {
      var self = this;
      this.api('GET', '/api/materials/lookup/' + encodeURIComponent(value)).then(function(mat) {
        if (mat) {
          window._pivRows[idx].material = mat.material;
          window._pivRows[idx].description = mat.description;
          window._pivRows[idx].ean = mat.ean;
          self._pivRender();
        }
      });
    }
  },

  _pivScanField: function(input, field, idx) {
    var self = this;
    // Double click to scan, single click just focuses
    input.ondblclick = function() {
      self.scannerOpen(function(val) {
        input.value = val;
        self._pivUpdate(idx, field, val);
        // Move to next field
        var row = input.closest('.piv-grid');
        var inputs = row.querySelectorAll('input');
        var curIdx = Array.prototype.indexOf.call(inputs, input);
        if (curIdx < inputs.length - 1) inputs[curIdx + 1].focus();
      });
    };
    input.title = 'Double-click to scan';
  },

  _pivAddRow: function() {
    window._pivRows.push({ date: new Date().toISOString().split('T')[0], rack: '', ean: '', material: '', description: '', qty: '', packing: '', box_no: '' });
    this._pivRender();
  },

  _pivSubmit: async function() {
    var pivBy = document.getElementById('pivBy').value.trim();
    if (!pivBy) return this.toast('Enter PIV by name', 'warning');
    var validItems = [];
    for (var i = 0; i < window._pivRows.length; i++) {
      var r = window._pivRows[i];
      if (r.material && r.rack && (parseFloat(r.qty) || 0) > 0) {
        validItems.push(r);
      }
    }
    if (validItems.length === 0) return this.toast('Add at least one complete row', 'warning');
    var res = await this.api('POST', '/api/piv', { piv_by: pivBy, items: validItems });
    if (res && !res.error) {
      this.toast('PIV saved successfully!', 'success');
      window._pivRows = [{ date: new Date().toISOString().split('T')[0], rack: '', ean: '', material: '', description: '', qty: '', packing: '', box_no: '' }];
      this._pivRender();
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  // ===================== LOCATION PAGE =====================
  async pageLocation() {
    var data = await this.api('GET', '/api/location');
    if (!data) return;

    var rows = '';
    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      var srcBadge = d.source === 'piv' ? 'badge-piv' : 'badge-putaway';
      rows += '<tr><td><span class="badge ' + srcBadge + '">' + d.source + '</span></td><td>' + d.date + '</td><td>' + d.rack + '</td>' +
        '<td>' + d.ean + '</td><td>' + d.material + '</td><td>' + d.description + '</td><td>' + d.qty + '</td>' +
        '<td>' + (d.packing || '-') + '</td><td>' + (d.box_no || '-') + '</td></tr>';
    }

    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title"><i class="fas fa-map-marker-alt"></i> Location Page - All Data</div>' +
        '<div class="flex-between mb-2">' +
          '<div class="input-group" style="max-width:400px;">' +
            '<input type="text" id="locSearch" placeholder="Search materials (comma separated for multiple)">' +
            '<button class="btn btn-primary btn-sm" onclick="App._locSearch()"><i class="fas fa-search"></i> Search</button>' +
          '</div>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-outline btn-sm" onclick="App._locAddSingle()"><i class="fas fa-plus"></i> Add Single</button>' +
            '<button class="btn btn-outline btn-sm" onclick="App._locCreateReport()"><i class="fas fa-file-alt"></i> Create HO Report</button>' +
            '<button class="btn btn-warning btn-sm" onclick="App._locEditReport()"><i class="fas fa-edit"></i> Edit HO Report</button>' +
          '</div>' +
          '<div class="file-upload-zone mb-2" onclick="document.getElementById(\'locFileInput\').click()">' +
            '<i class="fas fa-file-excel"></i>' +
            '<p>Click to upload Excel for bulk location add</p>' +
            '<p style="font-size:11px;color:var(--text-muted);">Format: Date, Rack, EAN, Material, Description, Qty, Packing, Box No</p>' +
            '<input type="file" id="locFileInput" accept=".xlsx,.xls,.csv" style="display:none" onchange="App._locBulkUpload(this)">' +
          '</div>' +
        '</div>' +
        (data.length === 0 ? '<div class="empty-state"><i class="fas fa-inbox"></i><p>No location data yet.</p></div>' :
        '<div class="table-wrapper"><table><thead><tr><th>Source</th><th>Date</th><th>Rack</th><th>EAN</th><th>Material</th><th>Description</th><th>Qty</th><th>Packing</th><th>Box No</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>') +
      '</div>';
  },
  _locBulkUpload: function(input) {
    var self = this;
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb = XLSX.read(e.target.result, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var json = XLSX.utils.sheet_to_json(ws);
        if (json.length === 0) return self.toast('No data found in file', 'warning');
        var items = [];
        for (var i = 0; i < json.length; i++) {
          var row = json[i];
          var rack = row['RACK'] || row['Rack'] || row['rack'] || '';
          var ean = row['EAN NO'] || row['EAN No'] || row['ean no'] || row['EAN'] || row['ean'] || '';
          var material = row['MATERIAL'] || row['Material'] || row['material'] || '';
          var description = row['DESCRIPTION'] || row['Description'] || row['description'] || '';
          var qty = row['QTY'] || row['Qty'] || row['qty'] || row['Quantity'] || 0;
          var packing = row['PACKING'] || row['Packing'] || row['packing'] || '';
          var box_no = row['BOX NO'] || row['Box No'] || row['box no'] || row['BoxNo'] || '';
          var date = row['DATE'] || row['Date'] || row['date'] || '';
          // Date format convert: 07/24/2025 → 2025-07-24
          if (date) {
            if (String(date).indexOf('/') >= 0) {
              var parts = String(date).split('/');
              if (parts.length === 3) {
                date = parts[2] + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
              }
            }
            // Excel serial date convert
            else if (typeof date === 'number') {
              var d = new Date((date - 25569) * 86400 * 1000);
              date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            }
          }
          if (rack && material) {
            items.push({ rack: String(rack), ean: String(ean), material: String(material), description: String(description), qty: parseFloat(qty) || 0, packing: String(packing), box_no: String(box_no), date: String(date) });
          }
        }
        if (items.length === 0) return self.toast('No valid data found', 'warning');
        self.api('POST', '/api/location/bulk', { items: items }).then(function(res) {
          if (res && !res.error) {
            self.toast(res.message, 'success');
            self.pageLocation();
          } else {
            self.toast((res && res.error) || 'Error', 'error');
          }
        });
      } catch (err) {
        self.toast('Error reading file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  
  },

  _locAddSingle: function() {
    this.openModal('<i class="fas fa-plus"></i> Add Single Location',
      '<div class="form-grid">' +
        '<div class="form-group"><label>Rack</label><input type="text" id="lsRack" placeholder="e.g. R1"></div>' +
        '<div class="form-group"><label>EAN</label><input type="text" id="lsEan" placeholder="EAN number"></div>' +
        '<div class="form-group"><label>Material</label><input type="text" id="lsMaterial" placeholder="Material code"></div>' +
        '<div class="form-group"><label>Description</label><input type="text" id="lsDesc" placeholder="Description"></div>' +
        '<div class="form-group"><label>Qty</label><input type="number" id="lsQty" placeholder="0"></div>' +
        '<div class="form-group"><label>Packing</label><input type="text" id="lsPacking" placeholder="Packing"></div>' +
        '<div class="form-group"><label>Box No</label><input type="text" id="lsBox" placeholder="Box number"></div>' +
        '<div class="form-group"><label>Date</label><input type="date" id="lsDate" value="' + new Date().toISOString().split('T')[0] + '"></div>' +
      '</div>' +
      '<div class="mt-2"><button class="btn btn-success" onclick="App._locSaveSingle()"><i class="fas fa-check"></i> Save</button></div>');
  },

  _locSaveSingle: async function() {
    var rack = document.getElementById('lsRack').value.trim();
    var material = document.getElementById('lsMaterial').value.trim();
    var qty = parseFloat(document.getElementById('lsQty').value) || 0;
    if (!rack || !material || qty <= 0) return this.toast('Rack, Material and Qty required', 'warning');
    var items = [{
      rack: rack,
      ean: document.getElementById('lsEan').value.trim(),
      material: material,
      description: document.getElementById('lsDesc').value.trim(),
      qty: qty,
      packing: document.getElementById('lsPacking').value.trim(),
      box_no: document.getElementById('lsBox').value.trim(),
      date: document.getElementById('lsDate').value
    }];
    var res = await this.api('POST', '/api/location/bulk', { items: items });
    if (res && !res.error) {
      this.toast('Location added!', 'success');
      this.closeModal();
      this.pageLocation();
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },
  
  async _locSearch() {
    var materials = document.getElementById('locSearch').value.trim();
    if (!materials) return this.toast('Enter material(s) to search', 'warning');
    var data = await this.api('GET', '/api/location/search?materials=' + encodeURIComponent(materials));
    if (!data) return;
    if (data.length === 0) {
      this.toast('No location found for these materials', 'warning');
      return;
    }
    var rows = '';
    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      var srcBadge = d.source === 'piv' ? 'badge-piv' : 'badge-putaway';
      rows += '<tr><td><span class="badge ' + srcBadge + '">' + d.source + '</span></td><td>' + d.date + '</td><td>' + d.rack + '</td>' +
        '<td>' + d.ean + '</td><td>' + d.material + '</td><td>' + d.description + '</td><td>' + d.qty + '</td></tr>';
    }
    this.openModal('<i class="fas fa-search"></i> Location Search Results',
      '<div class="table-wrapper"><table><thead><tr><th>Source</th><th>Date</th><th>Rack</th><th>EAN</th><th>Material</th><th>Description</th><th>Qty</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>', 800);
  },

  _locCreateReport: async function() {
    var pickerName = prompt('Enter Picker Name:');
    if (!pickerName) return;
    var materials = prompt('Enter materials (comma separated):');
    if (!materials) return;

    // Get location data for these materials
    var locData = await this.api('GET', '/api/location/search?materials=' + encodeURIComponent(materials));
    if (!locData || locData.length === 0) return this.toast('No location data found', 'warning');

    var ids = locData.map(function(d) { return d.id; });
    var res = await this.api('POST', '/api/location/report', {
      picker_name: pickerName,
      materials: materials,
      location_ids: ids
    });
    if (res && !res.error) {
      this.toast('HO Report Created: ' + res.ho_no, 'success');
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  _locEditReport: function() {
    var self = this;
    var hoNo = prompt('Enter HO Report No:');
    if (!hoNo) return;
    this.api('GET', '/api/location/report/' + hoNo).then(function(data) {
      if (!data || !data.items || data.items.length === 0) {
        self.toast('Report not found or empty', 'error');
        return;
      }
      var rows = '';
      for (var i = 0; i < data.items.length; i++) {
        var item = data.items[i];
        var srcBadge = item.source === 'piv' ? 'badge-piv' : 'badge-putaway';
        rows += '<tr>' +
          '<td><span class="badge ' + srcBadge + '">' + item.source + '</span></td>' +
          '<td>' + item.rack + '</td><td>' + item.material + '</td><td>' + item.description + '</td><td>' + item.qty + '</td>' +
          '<td>' + (item.action === 'none' ? '-' : '<span class="badge badge-' + item.action + '">' + item.action + '</span>') + '</td>' +
          '<td class="action-btns">' +
            '<button class="btn btn-danger btn-xs" onclick="App._locAction(\'' + hoNo + '\',' + item.report_item_id + ',\'delete\')"><i class="fas fa-trash"></i> Delete</button>' +
            '<button class="btn btn-warning btn-xs" onclick="App._locAction(\'' + hoNo + '\',' + item.report_item_id + ',\'minus\')"><i class="fas fa-minus"></i> Minus</button>' +
          '</td></tr>';
      }
      self.openModal('<i class="fas fa-edit"></i> Edit HO Report: ' + hoNo,
        '<p class="mb-1">Picker: <strong>' + data.picker_name + '</strong> | Created: ' + data.created_at + '</p>' +
        '<div class="table-wrapper"><table><thead><tr><th>Source</th><th>Rack</th><th>Material</th><th>Desc</th><th>Qty</th><th>Action</th><th>Operations</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>', 900);
    });
  },

  _locAction: async function(hoNo, itemId, action) {
    var res = await this.api('PUT', '/api/location/report/' + hoNo + '/item/' + itemId, { action: action, qty: 0 });
    if (res && !res.error) {
      this.toast('Action ' + action + ' performed', 'success');
      this._locEditReport(); // Refresh - will ask hoNo again so let's bypass
      // Instead, refresh the modal directly
      var self = this;
      this.api('GET', '/api/location/report/' + hoNo).then(function(data) {
        if (!data || !data.items) return;
        var rows = '';
        for (var i = 0; i < data.items.length; i++) {
          var item = data.items[i];
          var srcBadge = item.source === 'piv' ? 'badge-piv' : 'badge-putaway';
          rows += '<tr><td><span class="badge ' + srcBadge + '">' + item.source + '</span></td>' +
            '<td>' + item.rack + '</td><td>' + item.material + '</td><td>' + item.description + '</td><td>' + item.qty + '</td>' +
            '<td>' + (item.action === 'none' ? '-' : '<span class="badge badge-' + item.action + '">' + item.action + '</span>') + '</td>' +
            '<td class="action-btns">' +
              '<button class="btn btn-danger btn-xs" onclick="App._locAction(\'' + hoNo + '\',' + item.report_item_id + ',\'delete\')"><i class="fas fa-trash"></i> Delete</button>' +
              '<button class="btn btn-warning btn-xs" onclick="App._locAction(\'' + hoNo + '\',' + item.report_item_id + ',\'minus\')"><i class="fas fa-minus"></i> Minus</button>' +
            '</td></tr>';
        }
        document.getElementById('genericModalBody').innerHTML =
          '<p class="mb-1">Picker: <strong>' + data.picker_name + '</strong> | Created: ' + data.created_at + '</p>' +
          '<div class="table-wrapper"><table><thead><tr><th>Source</th><th>Rack</th><th>Material</th><th>Desc</th><th>Qty</th><th>Action</th><th>Operations</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>';
      });
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  // ===================== MATERIAL MASTER =====================
  async pageMaterialMaster() {
    var materials = await this.api('GET', '/api/materials');
    if (!materials) return;
    var rows = '';
    for (var i = 0; i < materials.length; i++) {
      var m = materials[i];
      rows += '<tr><td>' + m.material + '</td><td>' + m.description + '</td><td>' + m.div + '</td><td>' + m.ean + '</td><td>' + m.brand + '</td></tr>';
    }
    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title"><i class="fas fa-database"></i> Material Master</div>' +
        '<div class="flex-between mb-2">' +
          '<div class="input-group" style="max-width:300px;">' +
            '<input type="text" id="matSearchInput" placeholder="Search materials..." onkeydown="if(event.key===\'Enter\')App._matSearch()">' +
            '<button class="btn btn-primary btn-sm" onclick="App._matSearch()"><i class="fas fa-search"></i></button>' +
          '</div>' +
          '<button class="btn btn-outline btn-sm" onclick="App._matAddSingle()"><i class="fas fa-plus"></i> Add Single</button>' +
        '</div>' +
        '<div class="file-upload-zone mb-2" onclick="document.getElementById(\'matFileInput\').click()">' +
          '<i class="fas fa-file-excel"></i>' +
          '<p>Click to upload Excel file for bulk material add</p>' +
          '<p style="font-size:11px;color:var(--text-muted);">Format: Material, Material Description, Div, EAN No, Brand</p>' +
          '<input type="file" id="matFileInput" accept=".xlsx,.xls,.csv" style="display:none" onchange="App._matBulkUpload(this)">' +
        '</div>' +
        (materials.length === 0 ? '<div class="empty-state"><i class="fas fa-inbox"></i><p>No materials in master.</p></div>' :
        '<div class="table-wrapper"><table><thead><tr><th>Material</th><th>Description</th><th>Div</th><th>EAN</th><th>Brand</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>') +
      '</div>';
  },

  async _matSearch() {
    var q = document.getElementById('matSearchInput').value.trim();
    if (!q) return this.route();
    var materials = await this.api('GET', '/api/materials?search=' + encodeURIComponent(q));
    if (!materials) return;
    var rows = '';
    for (var i = 0; i < materials.length; i++) {
      var m = materials[i];
      rows += '<tr><td>' + m.material + '</td><td>' + m.description + '</td><td>' + m.div + '</td><td>' + m.ean + '</td><td>' + m.brand + '</td></tr>';
    }
    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title"><i class="fas fa-database"></i> Material Master - Search Results</div>' +
        '<div class="flex-between mb-2">' +
          '<div class="input-group" style="max-width:300px;">' +
            '<input type="text" id="matSearchInput" value="' + q + '" onkeydown="if(event.key===\'Enter\')App._matSearch()">' +
            '<button class="btn btn-primary btn-sm" onclick="App._matSearch()"><i class="fas fa-search"></i></button>' +
          '</div>' +
          '<button class="btn btn-outline btn-sm" onclick="App.pageMaterialMaster()"><i class="fas fa-arrow-left"></i> Back</button>' +
        '</div>' +
        '<div class="table-wrapper"><table><thead><tr><th>Material</th><th>Description</th><th>Div</th><th>EAN</th><th>Brand</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>';
  },

  _matAddSingle: function() {
    this.openModal('<i class="fas fa-plus"></i> Add Single Material',
      '<div class="form-grid">' +
        '<div class="form-group"><label>Material Code</label><input type="text" id="matSingleCode"></div>' +
        '<div class="form-group"><label>Description</label><input type="text" id="matSingleDesc"></div>' +
        '<div class="form-group"><label>Div</label><input type="text" id="matSingleDiv"></div>' +
        '<div class="form-group"><label>EAN No</label><input type="text" id="matSingleEan"></div>' +
        '<div class="form-group"><label>Brand</label><input type="text" id="matSingleBrand"></div>' +
      '</div>' +
      '<div class="mt-2"><button class="btn btn-success" onclick="App._matSaveSingle()"><i class="fas fa-check"></i> Save</button></div>');
  },

  _matSaveSingle: async function() {
    var material = document.getElementById('matSingleCode').value.trim();
    if (!material) return this.toast('Material code required', 'warning');
    var res = await this.api('POST', '/api/materials/single', {
      material: material,
      description: document.getElementById('matSingleDesc').value.trim(),
      div: document.getElementById('matSingleDiv').value.trim(),
      ean: document.getElementById('matSingleEan').value.trim(),
      brand: document.getElementById('matSingleBrand').value.trim()
    });
    if (res && !res.error) {
      this.toast('Material added!', 'success');
      this.closeModal();
      this.pageMaterialMaster();
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  _matBulkUpload: function(input) {
    var self = this;
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb = XLSX.read(e.target.result, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var json = XLSX.utils.sheet_to_json(ws);
        if (json.length === 0) return self.toast('No data found in file', 'warning');

        var materials = [];
        for (var i = 0; i < json.length; i++) {
          var row = json[i];
          // Support multiple column name formats
          var mat = row['Material'] || row['material'] || row['MATERIAL'] || '';
          var desc = row['Material Description'] || row['material description'] || row['MATERIAL DESCRIPTION'] || row['Description'] || row['description'] || '';
          var div = row['Div'] || row['div'] || row['DIV'] || '';
          var ean = row['EAN No'] || row['ean no'] || row['EAN NO'] || row['EAN'] || row['ean'] || '';
          var brand = row['Brand'] || row['brand'] || row['BRAND'] || '';
          if (mat) materials.push({ material: String(mat), description: String(desc), div: String(div), ean: String(ean), brand: String(brand) });
        }
        if (materials.length === 0) return self.toast('No valid materials found', 'warning');

        self.api('POST', '/api/materials/bulk', { materials: materials }).then(function(res) {
          if (res && !res.error) {
            self.toast(res.message, 'success');
            self.pageMaterialMaster();
          } else {
            self.toast((res && res.error) || 'Error', 'error');
          }
        });
      } catch (err) {
        self.toast('Error reading file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  },

  // ===================== BIN MANAGEMENT =====================
  async pageBinManagement() {
    var bins = await this.api('GET', '/api/bins');
    if (!bins) return;

    // Sort by rack, bin for sequence display
    bins.sort(function(a, b) {
      if (a.rack < b.rack) return -1;
      if (a.rack > b.rack) return 1;
      return a.bin.localeCompare(b.bin);
    });

    var gridHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">';
    for (var i = 0; i < bins.length; i++) {
      var b = bins[i];
      var statusCls = b.status === 'filled' ? 'filled' : 'empty';
      gridHtml += '<div class="stat-card ' + (b.status === 'filled' ? 'success' : '') + '" style="padding:14px;text-align:center;">' +
        '<div style="font-family:Orbitron;font-size:11px;color:var(--accent);margin-bottom:4px;">' + b.rack + '</div>' +
        '<div style="font-size:18px;font-weight:700;">' + b.bin + '</div>' +
        '<span class="badge badge-' + statusCls + '" style="margin-top:6px;">' + b.status + '</span>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">' + b.current_qty + '/' + b.capacity + '</div></div>';
    }
    gridHtml += '</div>';

    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title"><i class="fas fa-th"></i> Bin Management</div>' +
        '<div class="flex-between mb-2">' +
          '<div class="input-group" style="max-width:400px;">' +
            '<input type="text" id="binSearchMat" placeholder="Search material in bins...">' +
            '<button class="btn btn-primary btn-sm" onclick="App._binSearchMat()"><i class="fas fa-search"></i></button>' +
          '</div>' +
          '<button class="btn btn-outline btn-sm" onclick="App._binBulkAdd()"><i class="fas fa-plus"></i> Bulk Add Bins</button>' +
        '</div>' +
        '<div class="file-upload-zone mb-2" onclick="document.getElementById(\'binFileInput\').click()">' +
          '<i class="fas fa-file-excel"></i>' +
          '<p>Upload Excel for bulk bin add (Rack, Bin, Capacity)</p>' +
          '<input type="file" id="binFileInput" accept=".xlsx,.xls,.csv" style="display:none" onchange="App._binBulkUpload(this)">' +
        '</div>' +
        (bins.length === 0 ? '<div class="empty-state"><i class="fas fa-inbox"></i><p>No bins added yet.</p></div>' : gridHtml) +
      '</div>';
  },

  _binBulkAdd: function() {
    this.openModal('<i class="fas fa-plus"></i> Add Bins',
      '<div class="form-grid">' +
        '<div class="form-group"><label>Rack</label><input type="text" id="binRack" placeholder="e.g. R1"></div>' +
        '<div class="form-group"><label>Bin</label><input type="text" id="binBin" placeholder="e.g. B1"></div>' +
        '<div class="form-group"><label>Capacity</label><input type="number" id="binCap" placeholder="0"></div>' +
      '</div>' +
      '<div class="mt-2"><button class="btn btn-success" onclick="App._binSaveSingle()"><i class="fas fa-check"></i> Add</button></div>');
  },

  _binSaveSingle: async function() {
    var rack = document.getElementById('binRack').value.trim();
    var bin = document.getElementById('binBin').value.trim();
    if (!rack || !bin) return this.toast('Rack and Bin required', 'warning');
    var cap = parseFloat(document.getElementById('binCap').value) || 0;
    var res = await this.api('POST', '/api/bins/bulk', { bins: [{ rack: rack, bin: bin, capacity: cap }] });
    if (res && !res.error) {
      this.toast('Bin added!', 'success');
      this.closeModal();
      this.pageBinManagement();
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  _binBulkUpload: function(input) {
    var self = this;
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb = XLSX.read(e.target.result, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var json = XLSX.utils.sheet_to_json(ws);
        var bins = [];
        for (var i = 0; i < json.length; i++) {
          var row = json[i];
          var rack = row['Rack'] || row['rack'] || row['RACK'] || '';
          var bin = row['Bin'] || row['bin'] || row['BIN'] || '';
          var cap = row['Capacity'] || row['capacity'] || row['CAPACITY'] || 0;
          if (rack && bin) bins.push({ rack: String(rack), bin: String(bin), capacity: parseFloat(cap) || 0 });
        }
        if (bins.length === 0) return self.toast('No valid bins found', 'warning');
        self.api('POST', '/api/bins/bulk', { bins: bins }).then(function(res) {
          if (res && !res.error) {
            self.toast(res.message, 'success');
            self.pageBinManagement();
          } else {
            self.toast((res && res.error) || 'Error', 'error');
          }
        });
      } catch (err) {
        self.toast('Error reading file', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  },

  async _binSearchMat() {
    var mat = document.getElementById('binSearchMat').value.trim();
    if (!mat) return this.toast('Enter material', 'warning');
    var data = await this.api('GET', '/api/bins/search/' + encodeURIComponent(mat));
    if (!data) return;
    var locRows = '';
    for (var i = 0; i < data.locations.length; i++) {
      var l = data.locations[i];
      locRows += '<tr><td>' + l.rack + '</td><td>' + l.source + '</td><td>' + l.qty + '</td><td>' + l.date + '</td></tr>';
    }
    var paRows = '';
    for (var j = 0; j < data.putawayHistory.length; j++) {
      var p = data.putawayHistory[j];
      paRows += '<tr><td>' + p.rack + '</td><td>' + p.putaway_qty + '</td><td>' + p.grn_no + '</td><td>' + p.created_at + '</td></tr>';
    }
    var pivRows = '';
    for (var k = 0; k < data.pivHistory.length; k++) {
      var pv = data.pivHistory[k];
      pivRows += '<tr><td>' + pv.rack + '</td><td>' + pv.qty + '</td><td>' + pv.created_at + '</td></tr>';
    }
    this.openModal('<i class="fas fa-search"></i> Bin Search: ' + mat,
      '<h4 style="color:var(--accent);margin-bottom:8px;font-size:13px;">Current Locations</h4>' +
      (locRows ? '<div class="table-wrapper mb-2"><table><thead><tr><th>Rack</th><th>Source</th><th>Qty</th><th>Date</th></tr></thead><tbody>' + locRows + '</tbody></table></div>' : '<p class="text-muted mb-2">No current locations</p>') +
      '<h4 style="color:var(--success);margin-bottom:8px;font-size:13px;">Putaway History</h4>' +
      (paRows ? '<div class="table-wrapper mb-2"><table><thead><tr><th>Rack</th><th>Qty</th><th>GRN</th><th>Date</th></tr></thead><tbody>' + paRows + '</tbody></table></div>' : '<p class="text-muted mb-2">No putaway history</p>') +
      '<h4 style="color:#a855f7;margin-bottom:8px;font-size:13px;">PIV History</h4>' +
      (pivRows ? '<div class="table-wrapper"><table><thead><tr><th>Rack</th><th>Qty</th><th>Date</th></tr></thead><tbody>' + pivRows + '</tbody></table></div>' : '<p class="text-muted">No PIV history</p>'),
      800);
  },

  // ===================== LIVE ACTION =====================
  async pageLiveAction() {
    var actions = await this.api('GET', '/api/live-actions');
    if (!actions) return;
    var feed = '';
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var iconCls = a.module || 'admin';
      feed += '<div class="live-feed-item">' +
        '<div class="live-feed-icon ' + iconCls + '"><i class="fas fa-' +
          (a.module === 'inbound' ? 'truck' : a.module === 'putaway' ? 'location-dot' : a.module === 'piv' ? 'barcode' : a.module === 'location' ? 'map-marker-alt' : 'user-shield') +
        '"></i></div>' +
        '<div class="live-feed-text">' +
          '<div class="action">' + a.action + '</div>' +
          '<div class="details">' + (a.details || '') + (a.user ? ' - by ' + a.user : '') + '</div>' +
          '<div class="time">' + a.created_at + '</div>' +
        '</div></div>';
    }
    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title pulse"><i class="fas fa-bolt"></i> Live Action Feed</div>' +
        (actions.length === 0 ? '<div class="empty-state"><i class="fas fa-pause-circle"></i><p>No activities yet.</p></div>' : feed) +
      '</div>';

    // Auto refresh every 10 seconds
    if (this._liveInterval) clearInterval(this._liveInterval);
    var self = this;
    this._liveInterval = setInterval(function() {
      if (self.currentPage === 'live-action') self.pageLiveAction();
    }, 10000);
  },

  // ===================== ADMIN PANEL =====================
  async pageAdmin() {
    var users = await this.api('GET', '/api/users');
    if (!users) return;

    var allModules = ['inbound', 'putaway', 'piv', 'location', 'material', 'bin', 'admin'];

    var rows = '';
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var accessArr = [];
      try { accessArr = JSON.parse(u.access || '[]'); } catch(e) { accessArr = []; }
      var accessBadges = '';
      for (var j = 0; j < accessArr.length; j++) {
        accessBadges += '<span class="badge badge-putaway" style="margin:1px;">' + accessArr[j] + '</span>';
      }
      rows += '<tr>' +
        '<td>' + u.id + '</td>' +
        '<td><strong>' + u.username + '</strong></td>' +
        '<td>' + u.name + '</td>' +
        '<td><span class="badge ' + (u.role === 'admin' ? 'badge-piv' : 'badge-pending') + '">' + u.role + '</span></td>' +
        '<td>' + (accessBadges || '<span class="text-muted">none</span>') + '</td>' +
        '<td><span class="badge ' + (u.active ? 'badge-active' : 'badge-deleted') + '">' + (u.active ? 'Active' : 'Inactive') + '</span></td>' +
        '<td class="action-btns">' +
          '<button class="btn btn-primary btn-xs" onclick="App._adminEditUser(' + u.id + ')"><i class="fas fa-edit"></i></button>' +
          '<button class="btn btn-danger btn-xs" onclick="App._adminDeleteUser(' + u.id + ',\'' + u.name + '\')"><i class="fas fa-trash"></i></button>' +
        '</td></tr>';
    }

    var modCheckboxes = '';
    for (var m = 0; m < allModules.length; m++) {
      modCheckboxes += '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:13px;color:var(--text-secondary);cursor:pointer;">' +
        '<input type="checkbox" value="' + allModules[m] + '" class="admin-access-cb"> ' + allModules[m] + '</label>';
    }

    document.getElementById('pageContent').innerHTML =
      '<div class="card-3d"><div class="card-title"><i class="fas fa-user-shield"></i> Admin Panel - User Management</div>' +
        '<div class="flex-between mb-2">' +
          '<h3 style="font-size:14px;color:var(--text-primary);">Users (' + users.length + ')</h3>' +
          '<button class="btn btn-primary btn-sm" onclick="App._adminAddUser()"><i class="fas fa-plus"></i> Add User</button>' +
        '</div>' +
        '<div class="table-wrapper"><table><thead><tr><th>ID</th><th>Username</th><th>Name</th><th>Role</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
      '</div>' +
      '<div class="card-3d mt-2"><div class="card-title"><i class="fas fa-key"></i> Change Your Password</div>' +
        '<div class="form-grid" style="max-width:400px;">' +
          '<div class="form-group"><label>Old Password</label><input type="password" id="adminOldPass"></div>' +
          '<div class="form-group"><label>New Password</label><input type="password" id="adminNewPass"></div>' +
        '</div>' +
        '<div class="mt-1"><button class="btn btn-warning btn-sm" onclick="App._adminChangePass()"><i class="fas fa-key"></i> Change Password</button></div>' +
      '</div>';

    // Store modules for reuse
    window._adminModules = allModules;
  },

  _adminAddUser: function() {
    var modCheckboxes = '';
    var mods = window._adminModules || ['inbound', 'putaway', 'piv', 'location', 'material', 'bin', 'admin'];
    for (var m = 0; m < mods.length; m++) {
      modCheckboxes += '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:13px;color:var(--text-secondary);cursor:pointer;">' +
        '<input type="checkbox" value="' + mods[m] + '" class="admin-access-cb"> ' + mods[m] + '</label>';
    }
    this.openModal('<i class="fas fa-user-plus"></i> Add User',
      '<div class="form-grid">' +
        '<div class="form-group"><label>Username</label><input type="text" id="auUsername"></div>' +
        '<div class="form-group"><label>Password</label><input type="password" id="auPassword"></div>' +
        '<div class="form-group"><label>Full Name</label><input type="text" id="auName"></div>' +
        '<div class="form-group"><label>Role</label><select id="auRole"><option value="user">User</option><option value="admin">Admin</option></select></div>' +
      '</div>' +
      '<div class="form-group mt-1"><label>Access Modules</label><div class="mt-1">' + modCheckboxes + '</div></div>' +
      '<div class="mt-2"><button class="btn btn-success" onclick="App._adminSaveUser()"><i class="fas fa-check"></i> Create User</button></div>');
  },

  _adminSaveUser: async function() {
    var username = document.getElementById('auUsername').value.trim();
    var password = document.getElementById('auPassword').value.trim();
    var name = document.getElementById('auName').value.trim();
    var role = document.getElementById('auRole').value;
    if (!username || !password || !name) return this.toast('Username, password, name required', 'warning');
    var cbs = document.querySelectorAll('.admin-access-cb');
    var access = [];
    for (var i = 0; i < cbs.length; i++) { if (cbs[i].checked) access.push(cbs[i].value); }
    var res = await this.api('POST', '/api/users', { username: username, password: password, name: name, role: role, access: access });
    if (res && !res.error) {
      this.toast('User created!', 'success');
      this.closeModal();
      this.pageAdmin();
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  async _adminEditUser(uid) {
    var users = await this.api('GET', '/api/users');
    var user = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === uid) { user = users[i]; break; }
    }
    if (!user) return;

    var accessArr = [];
    try { accessArr = JSON.parse(user.access || '[]'); } catch(e) { accessArr = []; }

    var modCheckboxes = '';
    var mods = window._adminModules || ['inbound', 'putaway', 'piv', 'location', 'material', 'bin', 'admin'];
    for (var m = 0; m < mods.length; m++) {
      var checked = accessArr.indexOf(mods[m]) >= 0 ? 'checked' : '';
      modCheckboxes += '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:13px;color:var(--text-secondary);cursor:pointer;">' +
        '<input type="checkbox" value="' + mods[m] + '" class="eu-access-cb" ' + checked + '> ' + mods[m] + '</label>';
    }

    this.openModal('<i class="fas fa-user-edit"></i> Edit User: ' + user.name,
      '<div class="form-grid">' +
        '<div class="form-group"><label>Full Name</label><input type="text" id="euName" value="' + user.name + '"></div>' +
        '<div class="form-group"><label>Role</label><select id="euRole"><option value="user"' + (user.role === 'user' ? ' selected' : '') + '>User</option><option value="admin"' + (user.role === 'admin' ? ' selected' : '') + '>Admin</option></select></div>' +
        '<div class="form-group"><label>New Password (leave blank to keep)</label><input type="password" id="euPassword" placeholder="Optional"></div>' +
        '<div class="form-group"><label>Active</label><select id="euActive"><option value="1"' + (user.active ? ' selected' : '') + '>Active</option><option value="0"' + (!user.active ? ' selected' : '') + '>Inactive</option></select></div>' +
      '</div>' +
      '<div class="form-group mt-1"><label>Access Modules</label><div class="mt-1">' + modCheckboxes + '</div></div>' +
      '<div class="mt-2"><button class="btn btn-success" onclick="App._adminUpdateUser(' + uid + ')"><i class="fas fa-check"></i> Update</button></div>');

    window._euUid = uid;
  },

  _adminUpdateUser: async function(uid) {
    var name = document.getElementById('euName').value.trim();
    var role = document.getElementById('euRole').value;
    var password = document.getElementById('euPassword').value.trim();
    var active = document.getElementById('euActive').value === '1';
    var cbs = document.querySelectorAll('.eu-access-cb');
    var access = [];
    for (var i = 0; i < cbs.length; i++) { if (cbs[i].checked) access.push(cbs[i].value); }
    var data = { name: name, role: role, access: access, active: active };
    if (password) data.password = password;
    var res = await this.api('PUT', '/api/users/' + uid, data);
    if (res && !res.error) {
      this.toast('User updated!', 'success');
      this.closeModal();
      this.pageAdmin();
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },

  _adminDeleteUser: function(uid, name) {
    if (!confirm('Delete user "' + name + '"? This cannot be undone.')) return;
    var self = this;
    this.api('DELETE', '/api/users/' + uid).then(function(res) {
      if (res && !res.error) {
        self.toast('User deleted', 'success');
        self.pageAdmin();
      } else {
        self.toast((res && res.error) || 'Error', 'error');
      }
    });
  },

  _adminChangePass: async function() {
    var oldP = document.getElementById('adminOldPass').value.trim();
    var newP = document.getElementById('adminNewPass').value.trim();
    if (!oldP || !newP) return this.toast('Fill both password fields', 'warning');
    var res = await this.api('POST', '/api/auth/change-password', { oldPassword: oldP, newPassword: newP });
    if (res && !res.error) {
      this.toast('Password changed!', 'success');
      document.getElementById('adminOldPass').value = '';
      document.getElementById('adminNewPass').value = '';
    } else {
      this.toast((res && res.error) || 'Error', 'error');
    }
  },
};

// ===================== START APP =====================
document.addEventListener('DOMContentLoaded', function() {
  App.init();
});