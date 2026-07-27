/* ============================================================
   VIP INDUSTRIES LIMITED MD20 — WMS COMPLETE SCRIPT
   Developed by Nikhil Patil
   ============================================================ */

// ==================== STATE ====================
const APP = {
    currentUser: null,
    currentSection: 'dashboard',
    currentSub: null,
    theme: 'dark',
    sessionStart: null,
    SESSION_TIMEOUT: 30 * 60 * 1000,
    WARNING_BEFORE: 5 * 60 * 1000,
    locPage: 1,
    locPerPage: 15,
    auditPage: 1,
    auditPerPage: 15,
    reportPage: 1,
    reportPerPage: 15,
    matPage: 1,
    matPerPage: 15,
};

// ==================== DATABASE LAYER ====================
const DB = {
    _key(k) { return 'wms_' + k; },
    get(k) {
        try { return JSON.parse(localStorage.getItem(this._key(k)) || '[]'); }
        catch (e) { return []; }
    },
    getObj(k) {
        try { return JSON.parse(localStorage.getItem(this._key(k)) || '{}'); }
        catch (e) { return {}; }
    },
    set(k, v) { localStorage.setItem(this._key(k), JSON.stringify(v)); },
    add(k, item) {
        const data = this.get(k);
        item.id = item.id || this.uid();
        item.createdAt = item.createdAt || new Date().toISOString();
        data.push(item);
        this.set(k, data);
        return item;
    },
    update(k, id, updates) {
        const data = this.get(k);
        const idx = data.findIndex(d => d.id === id);
        if (idx > -1) {
            Object.assign(data[idx], updates, { updatedAt: new Date().toISOString() });
            this.set(k, data);
            return data[idx];
        }
        return null;
    },
    remove(k, id) {
        const data = this.get(k).filter(d => d.id !== id);
        this.set(k, data);
    },
    find(k, id) { return this.get(k).find(d => d.id === id); },
    filter(k, fn) { return this.get(k).filter(fn); },
    count(k, fn) { return fn ? this.get(k).filter(fn).length : this.get(k).length; },
    uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); },
    actionNo() { return 'ACT-' + Date.now().toString(36).toUpperCase(); },
    reportNo() { return 'PR-' + new Date().getFullYear() + '-' + String(this.count('picking_reports') + 1).padStart(4, '0'); }
};

// ==================== UTILITIES ====================
function formatDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
        dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function today() { return new Date().toISOString().split('T')[0]; }
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
}
function paginate(arr, page, perPage) {
    const start = (page - 1) * perPage;
    return { items: arr.slice(start, start + perPage), total: arr.length, pages: Math.ceil(arr.length / perPage) || 1 };
}
function renderPagination(currentPage, totalPages, onClickFn) {
    if (totalPages <= 1) return '';
    let html = '<div class="pagination">';
    html += `<button class="page-btn" onclick="${onClickFn}(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}><i class='bx bx-chevron-left'></i></button>`;
    for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 7 && i > 3 && i < totalPages - 2 && Math.abs(i - currentPage) > 1) {
            if (i === 4 || i === totalPages - 3) html += '<span style="color:var(--text-muted);padding:0 4px">...</span>';
            continue;
        }
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="${onClickFn}(${i})">${i}</button>`;
    }
    html += `<button class="page-btn" onclick="${onClickFn}(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}><i class='bx bx-chevron-right'></i></button>`;
    html += '</div>';
    return html;
}

// ==================== TOAST ====================
function showToast(msg, type) {
    type = type || 'info';
    const icons = { success: 'bx-check-circle', error: 'bx-error-circle', warning: 'bx-error', info: 'bx-info-circle' };
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = '<i class="bx ' + (icons[type] || icons.info) + '"></i><span>' + escapeHtml(msg) + '</span>';
    container.appendChild(toast);
    setTimeout(function () {
        toast.classList.add('removing');
        setTimeout(function () { toast.remove(); }, 300);
    }, 3500);
}

// ==================== MODAL ====================
function showModal(title, bodyHtml, size, footerHtml) {
    size = size || '';
    footerHtml = footerHtml || '';
    var overlay = document.getElementById('modalOverlay');
    var container = document.getElementById('modalContainer');
    container.className = 'modal-container' + (size ? ' modal-' + size : '');
    container.innerHTML =
        '<div class="modal-header">' +
        '<h3>' + title + '</h3>' +
        '<button class="modal-close" onclick="closeModal()"><i class="bx bx-x"></i></button>' +
        '</div>' +
        '<div class="modal-body">' + bodyHtml + '</div>' +
        (footerHtml ? '<div class="modal-footer">' + footerHtml + '</div>' : '');
    overlay.classList.add('open');
}
function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
}
document.getElementById('modalOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
});

// ==================== LOADER ====================
function showLoader() { document.getElementById('pageLoader').style.display = 'flex'; }
function hideLoader() { document.getElementById('pageLoader').style.display = 'none'; }

// ==================== AUDIT LOG ====================
function logAction(module, action, details) {
    DB.add('audit_log', {
        actionNo: DB.actionNo(),
        module: module,
        action: action,
        details: details,
        userId: APP.currentUser ? APP.currentUser.id : 'system',
        userName: APP.currentUser ? APP.currentUser.name : 'System',
        dateTime: new Date().toISOString()
    });
}

// ==================== NOTIFICATIONS ====================
function addNotification(msg, type) {
    type = type || 'info';
    var notifs = DB.get('notifications');
    notifs.unshift({ id: DB.uid(), message: msg, type: type, read: false, dateTime: new Date().toISOString() });
    if (notifs.length > 50) notifs.length = 50;
    DB.set('notifications', notifs);
    updateNotifBadge();
}
function updateNotifBadge() {
    var count = DB.filter('notifications', function (n) { return !n.read; }).length;
    var badge = document.getElementById('notifBadge');
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
}
function renderNotifPanel() {
    var list = document.getElementById('notifList');
    var notifs = DB.get('notifications');
    if (notifs.length === 0) {
        list.innerHTML = '<div class="notif-empty"><i class="bx bx-bell-off"></i><p>No notifications</p></div>';
        return;
    }
    var html = '';
    notifs.slice(0, 30).forEach(function (n) {
        html += '<div class="notif-item ' + (n.read ? '' : 'unread') + '">' +
            '<div>' + escapeHtml(n.message) + '</div>' +
            '<div class="notif-time">' + formatDateTime(n.dateTime) + '</div>' +
            '</div>';
    });
    list.innerHTML = html;
    var all = DB.get('notifications').map(function (n) { return Object.assign({}, n, { read: true }); });
    DB.set('notifications', all);
    updateNotifBadge();
}

// ==================== SEED DATA ====================
function seedData() {
    if (DB.get('users').length > 0) return;
    DB.set('users', [
        { id: 'u1', username: 'admin', password: 'admin123', name: 'Admin', role: 'Super Admin', permissions: { modules: ['all'], dashboard: true, download: true, delete: true }, createdAt: new Date().toISOString() },
        { id: 'u2', username: 'operator', password: 'op123', name: 'Warehouse Operator', role: 'Operator', permissions: { modules: ['dashboard', 'inbound', 'putaway', 'piv', 'location'], dashboard: true, download: true, delete: false }, createdAt: new Date().toISOString() }
    ]);
    var materials = [
        { material: 'VIP PREMIUM RICE 5KG', description: 'Premium Basmati Rice 5kg Pack', division: 'Rice', ean: '8901234567001', brand: 'VIP' },
        { material: 'VIP GOLD WHEAT 10KG', description: 'Golden Wheat Atta 10kg', division: 'Flour', ean: '8901234567002', brand: 'VIP' },
        { material: 'VIP SUGAR 1KG', description: 'Refined Sugar 1kg Pack', division: 'Sugar', ean: '8901234567003', brand: 'VIP' },
        { material: 'VIP DAL TOOR 1KG', description: 'Toor Dal 1kg Pack', division: 'Pulses', ean: '8901234567004', brand: 'VIP' },
        { material: 'VIP SALT 1KG', description: 'Iodized Salt 1kg', division: 'Salt', ean: '8901234567005', brand: 'VIP' },
        { material: 'VIP OIL SUNFLOWER 1L', description: 'Sunflower Oil 1 Litre', division: 'Oil', ean: '8901234567006', brand: 'VIP' },
        { material: 'VIP TEA 500G', description: 'Premium Tea 500g', division: 'Tea', ean: '8901234567007', brand: 'VIP' },
        { material: 'VIP SPICE TURMERIC 100G', description: 'Turmeric Powder 100g', division: 'Spices', ean: '8901234567008', brand: 'VIP' },
        { material: 'VIP CHOLE MASALA 200G', description: 'Chole Masala 200g Pack', division: 'Spices', ean: '8901234567009', brand: 'VIP' },
        { material: 'VIP BASMATI RICE 25KG', description: 'Extra Long Basmati Rice 25kg', division: 'Rice', ean: '8901234567010', brand: 'VIP' }
    ];
    materials.forEach(function (m) { DB.add('material_master', m); });
    for (var r = 1; r <= 30; r++) {
        DB.add('rack_master', { rack: 'RACK-' + String(r).padStart(3, '0') });
    }
    DB.add('vehicles', { id: 'v1', vehicleNo: 'MH-12-AB-1234', lrNo: 'LR-2025-001', driverName: 'Rajesh Kumar', driverMobile: '9876543210', transportName: 'Fast Cargo', status: 'Unloaded' });
    DB.add('vehicles', { id: 'v2', vehicleNo: 'GJ-05-CD-5678', lrNo: 'LR-2025-002', driverName: 'Amit Patel', driverMobile: '9123456789', transportName: 'Green Logistics', status: 'Pending Unload' });
    DB.add('vehicles', { id: 'v3', vehicleNo: 'RJ-14-EF-9012', lrNo: 'LR-2025-003', driverName: 'Suresh Meena', driverMobile: '9988776655', transportName: 'Rajput Transport', status: 'Pending Unload' });
    DB.add('invoices', { id: 'inv1', vehicleId: 'v2', invoiceNo: 'INV-2025-101', status: 'Pending' });
    DB.add('invoice_materials', { id: 'im1', invoiceId: 'inv1', material: 'VIP PREMIUM RICE 5KG', qty: 50, unloadedQty: 0 });
    DB.add('invoice_materials', { id: 'im2', invoiceId: 'inv1', material: 'VIP GOLD WHEAT 10KG', qty: 30, unloadedQty: 0 });
    DB.add('invoice_materials', { id: 'im3', invoiceId: 'inv1', material: 'VIP SUGAR 1KG', qty: 100, unloadedQty: 0 });
    DB.add('invoices', { id: 'inv2', vehicleId: 'v2', invoiceNo: 'INV-2025-102', status: 'Pending' });
    DB.add('invoice_materials', { id: 'im4', invoiceId: 'inv2', material: 'VIP DAL TOOR 1KG', qty: 80, unloadedQty: 0 });
    DB.add('invoice_materials', { id: 'im5', invoiceId: 'inv2', material: 'VIP SALT 1KG', qty: 120, unloadedQty: 0 });
    DB.add('invoices', { id: 'inv3', vehicleId: 'v3', invoiceNo: 'INV-2025-103', status: 'Pending' });
    DB.add('invoice_materials', { id: 'im6', invoiceId: 'inv3', material: 'VIP OIL SUNFLOWER 1L', qty: 60, unloadedQty: 0 });
    DB.add('invoice_materials', { id: 'im7', invoiceId: 'inv3', material: 'VIP TEA 500G', qty: 40, unloadedQty: 0 });
    var locData = [
        { rack: 'RACK-001', ean: '8901234567001', material: 'VIP PREMIUM RICE 5KG', description: 'Premium Basmati Rice 5kg Pack', quantity: 20, packing: 'Bag', box: 'B001', action: 'PUTAWAY' },
        { rack: 'RACK-002', ean: '8901234567002', material: 'VIP GOLD WHEAT 10KG', description: 'Golden Wheat Atta 10kg', quantity: 15, packing: 'Bag', box: 'B002', action: 'PUTAWAY' },
        { rack: 'RACK-003', ean: '8901234567003', material: 'VIP SUGAR 1KG', description: 'Refined Sugar 1kg Pack', quantity: 50, packing: 'Box', box: 'B003', action: 'PUTAWAY' },
        { rack: 'RACK-005', ean: '8901234567004', material: 'VIP DAL TOOR 1KG', description: 'Toor Dal 1kg Pack', quantity: 30, packing: 'Bag', box: 'B004', action: 'PIV' },
        { rack: 'RACK-007', ean: '8901234567006', material: 'VIP OIL SUNFLOWER 1L', description: 'Sunflower Oil 1 Litre', quantity: 25, packing: 'Bottle', box: 'B005', action: 'PUTAWAY' },
        { rack: 'RACK-009', ean: '8901234567007', material: 'VIP TEA 500G', description: 'Premium Tea 500g', quantity: 18, packing: 'Box', box: 'B006', action: 'PIV' },
        { rack: 'RACK-011', ean: '8901234567008', material: 'VIP SPICE TURMERIC 100G', description: 'Turmeric Powder 100g', quantity: 40, packing: 'Pouch', box: 'B007', action: 'PUTAWAY' },
        { rack: 'RACK-015', ean: '8901234567010', material: 'VIP BASMATI RICE 25KG', description: 'Extra Long Basmati Rice 25kg', quantity: 10, packing: 'Bag', box: 'B008', action: 'PUTAWAY' }
    ];
    locData.forEach(function (l) {
        DB.add('location_master', {
            date: today(), rack: l.rack, ean: l.ean, material: l.material,
            description: l.description, quantity: l.quantity, packing: l.packing,
            box: l.box, action: l.action, user: 'Admin',
            dateTime: new Date().toISOString()
        });
    });
    addNotification('Vehicle GJ-05-CD-5678 arrived — Pending Unload', 'warning');
    addNotification('Vehicle RJ-14-EF-9012 arrived — Pending Unload', 'warning');
    addNotification('Putaway completed for RACK-001, RACK-002, RACK-003', 'success');
    logAction('System', 'INIT', 'System initialized with seed data');
}

// ==================== AUTH ====================
function login(username, password) {
    var users = DB.get('users');
    var user = users.find(function (u) { return u.username === username && u.password === password; });
    if (!user) return false;
    APP.currentUser = user;
    APP.sessionStart = Date.now();
    localStorage.setItem('wms_session', JSON.stringify({ userId: user.id, loginTime: new Date().toISOString() }));
    logAction('Auth', 'LOGIN', 'User ' + user.name + ' logged in');
    return true;
}
function logout() {
    if (APP.currentUser) logAction('Auth', 'LOGOUT', 'User ' + APP.currentUser.name + ' logged out');
    APP.currentUser = null;
    localStorage.removeItem('wms_session');
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('loginForm').reset();
}
function checkSession() {
    var session = JSON.parse(localStorage.getItem('wms_session') || 'null');
    if (!session) return false;
    var user = DB.find('users', session.userId);
    if (!user) return false;
    APP.currentUser = user;
    APP.sessionStart = new Date(session.loginTime).getTime();
    return true;
}
function checkPermission(module) {
    if (!APP.currentUser) return false;
    if (APP.currentUser.permissions.modules.indexOf('all') > -1) return true;
    return APP.currentUser.permissions.modules.indexOf(module) > -1;
}
function checkPermType(type) {
    if (!APP.currentUser) return false;
    if (APP.currentUser.role === 'Super Admin') return true;
    return APP.currentUser.permissions[type] || false;
}

// ==================== NAVIGATION ====================
function navigateTo(section, sub) {
    sub = sub || null;
    APP.currentSection = section;
    APP.currentSub = sub;
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    document.querySelectorAll('.nav-sub-item').forEach(function (n) { n.classList.remove('active'); });
    var navItem = document.querySelector('.nav-item[data-section="' + section + '"]');
    if (navItem) navItem.classList.add('active');
    if (sub) {
        var subItem = document.querySelector('.nav-sub-item[data-sub="' + sub + '"]');
        if (subItem) subItem.classList.add('active');
        var parentSub = document.getElementById('inboundSub');
        if (parentSub) parentSub.classList.add('open');
        if (navItem) navItem.classList.add('open');
    }
    var names = {
        dashboard: 'Dashboard', inbound: 'Inbound', putaway: 'Putaway', piv: 'PIV',
        location: 'Location Master', rack: 'Rack Master', material: 'Material Master',
        admin: 'Admin', settings: 'Settings', reports: 'Reports', audit: 'Audit Log'
    };
    var subNames = {
        'vehicle-entry': 'Vehicle Entry', 'pending-vehicle': 'Pending Vehicle', 'unload-process': 'Unload Process'
    };
    var bc = 'VIP INDUSTRIES LIMITED MD20 <i class="bx bx-chevron-right"></i> <span class="bc-item active">' + (names[section] || section) + '</span>';
    if (sub) bc += ' <i class="bx bx-chevron-right"></i> <span class="bc-item active">' + (subNames[sub] || sub) + '</span>';
    document.getElementById('breadcrumb').innerHTML = bc;
    document.querySelectorAll('.content-section').forEach(function (s) { s.classList.remove('active'); });
    var sec = document.getElementById('section-' + section);
    if (sec) sec.classList.add('active');
    renderSection(section, sub);
    closeSidebar();
}
function renderSection(section, sub) {
    var renderers = {
        dashboard: renderDashboard, inbound: function () { renderInbound(sub); },
        putaway: renderPutaway, piv: renderPIV, location: renderLocationMaster,
        rack: renderRackMaster, material: renderMaterialMaster, admin: renderAdmin,
        settings: renderSettings, reports: renderReports, audit: renderAuditLog
    };
    if (renderers[section]) renderers[section]();
}

// ==================== DASHBOARD ====================
function renderDashboard() {
    var vehicles = DB.get('vehicles');
    var locations = DB.get('location_master');
    var racks = DB.get('rack_master');
    var todayStr = today();
    var totalVehicles = vehicles.length;
    var pendingUnload = vehicles.filter(function (v) { return v.status === 'Pending Unload'; }).length;
    var todayPutaway = locations.filter(function (l) { return l.action === 'PUTAWAY' && l.date === todayStr; }).length;
    var todayPIV = locations.filter(function (l) { return l.action === 'PIV' && l.date === todayStr; }).length;
    var occupiedRackSet = {};
    locations.forEach(function (l) { occupiedRackSet[l.rack] = true; });
    var occupiedRacks = racks.filter(function (r) { return occupiedRackSet[r.rack]; }).length;
    var emptyRacks = racks.length - occupiedRacks;
    var recentActivity = DB.get('audit_log').slice(-10).reverse();
    var pendingV = vehicles.filter(function (v) { return v.status === 'Pending Unload'; });
    var html = '<div class="section-header"><h2><i class="bx bxs-dashboard"></i>Dashboard</h2>' +
        '<div style="color:var(--text-muted);font-size:13px">' + formatDateTime(new Date()) + '</div></div>';
    html += '<div class="kpi-grid">';
    html += kpiCard('bxs-truck', totalVehicles, 'Total Vehicles');
    html += kpiCard('bx-time-five', pendingUnload, 'Pending Unload');
    html += kpiCard('bxs-package', todayPutaway, "Today's Putaway");
    html += kpiCard('bxs-clipboard', todayPIV, "Today's PIV");
    html += kpiCard('bxs-grid-alt', occupiedRacks, 'Occupied Racks');
    html += kpiCard('bx-grid', emptyRacks, 'Empty Racks');
    html += '</div>';
    html += '<div class="grid-2">';
    html += '<div class="card"><div class="card-title">Recent Activity</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Action No</th><th>Module</th><th>Action</th><th>Time</th></tr></thead><tbody>';
    if (recentActivity.length === 0) {
        html += '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:30px">No activity yet</td></tr>';
    } else {
        recentActivity.forEach(function (a) {
            html += '<tr><td><span style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(a.actionNo) + '</span></td>' +
                '<td>' + escapeHtml(a.module) + '</td><td>' + escapeHtml(a.action) + '</td>' +
                '<td style="font-size:12px;color:var(--text-muted)">' + formatDateTime(a.dateTime) + '</td></tr>';
        });
    }
    html += '</tbody></table></div></div>';
    html += '<div class="card"><div class="card-title">Pending Vehicles</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>Driver</th><th>Transport</th><th>Status</th></tr></thead><tbody>';
    if (pendingV.length === 0) {
        html += '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:30px">No pending vehicles</td></tr>';
    } else {
        pendingV.forEach(function (v) {
            html += '<tr><td><strong>' + escapeHtml(v.vehicleNo) + '</strong></td><td>' + escapeHtml(v.driverName) + '</td>' +
                '<td>' + escapeHtml(v.transportName) + '</td><td><span class="badge badge-warning">Pending</span></td></tr>';
        });
    }
    html += '</tbody></table></div></div></div>';
    document.getElementById('section-dashboard').innerHTML = html;
}
function kpiCard(icon, value, label) {
    return '<div class="kpi-card"><div class="kpi-icon"><i class="bx ' + icon + '"></i></div>' +
        '<div class="kpi-value">' + value + '</div><div class="kpi-label">' + label + '</div></div>';
}

// ==================== INBOUND ====================
var tempInvoices = [];
var invoiceCounter = 0;

function renderInbound(sub) {
    sub = sub || 'vehicle-entry';
    var container = document.getElementById('section-inbound');
    var tabBtns = '<div class="tab-bar">' +
        '<button class="tab-btn ' + (sub === 'vehicle-entry' ? 'active' : '') + '" onclick="navigateTo(\'inbound\',\'vehicle-entry\')">Vehicle Entry</button>' +
        '<button class="tab-btn ' + (sub === 'pending-vehicle' ? 'active' : '') + '" onclick="navigateTo(\'inbound\',\'pending-vehicle\')">Pending Vehicle</button>' +
        '<button class="tab-btn ' + (sub === 'unload-process' ? 'active' : '') + '" onclick="navigateTo(\'inbound\',\'unload-process\')">Unload Process</button>' +
        '</div>';
    if (sub === 'vehicle-entry') {
        tempInvoices = [];
        invoiceCounter = 0;
        container.innerHTML = tabBtns + renderVehicleEntryForm();
    } else if (sub === 'pending-vehicle') {
        container.innerHTML = tabBtns + renderPendingVehicles();
    } else if (sub === 'unload-process') {
        container.innerHTML = tabBtns + renderUnloadProcess();
    }
}

function renderVehicleEntryForm() {
    return '<div class="section-header"><h2><i class="bx bxs-truck"></i>Vehicle Entry</h2></div>' +
        '<div class="card" style="margin-bottom:20px"><div class="card-title">Vehicle Details</div>' +
        '<div class="form-row">' +
        '<div class="form-group"><label>Vehicle Number <span class="req">*</span></label><input type="text" id="veVehicleNo" class="form-input" placeholder="e.g. MH-12-AB-1234"></div>' +
        '<div class="form-group"><label>LR Number <span class="req">*</span></label><input type="text" id="veLrNo" class="form-input" placeholder="e.g. LR-2025-001"></div>' +
        '<div class="form-group"><label>Driver Name <span class="req">*</span></label><input type="text" id="veDriverName" class="form-input" placeholder="Full name"></div>' +
        '<div class="form-group"><label>Driver Mobile <span class="req">*</span></label><input type="tel" id="veDriverMobile" class="form-input" placeholder="10 digit mobile" maxlength="10"><div class="form-error" id="mobileError">Mobile must be exactly 10 digits</div></div>' +
        '<div class="form-group"><label>Transport Name <span class="req">*</span></label><input type="text" id="veTransport" class="form-input" placeholder="Transport company"></div>' +
        '</div></div>' +
        '<div class="card" style="margin-bottom:20px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
        '<div class="card-title" style="margin-bottom:0">Invoices</div>' +
        '<button class="btn btn-secondary btn-sm" onclick="addInvoiceBlock()"><i class="bx bx-plus"></i> Add Invoice</button></div>' +
        '<div id="invoiceBlocks"><div class="empty-state" style="padding:30px"><i class="bx bx-file"></i><p>Click "Add Invoice" to add invoices</p></div></div></div>' +
        '<div class="form-actions"><button class="btn btn-primary" onclick="submitVehicleEntry()"><i class="bx bx-check-circle"></i> Submit Vehicle Entry</button>' +
        '<button class="btn btn-secondary" onclick="navigateTo(\'inbound\',\'vehicle-entry\')"><i class="bx bx-refresh"></i> Reset</button></div>';
}

function addInvoiceBlock() {
    invoiceCounter++;
    var invId = 'inv-block-' + invoiceCounter;
    tempInvoices.push({ id: invId, invoiceNo: '', materials: [] });
    var blocks = document.getElementById('invoiceBlocks');
    if (blocks.querySelector('.empty-state')) blocks.innerHTML = '';
    var div = document.createElement('div');
    div.id = invId;
    div.className = 'card';
    div.style.cssText = 'margin-bottom:12px;border-left:3px solid var(--accent)';
    div.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
        '<div class="card-title" style="margin-bottom:0">Invoice #' + invoiceCounter + '</div>' +
        '<button class="btn-icon danger" onclick="removeInvoiceBlock(\'' + invId + '\')"><i class="bx bx-trash"></i></button></div>' +
        '<div class="form-row"><div class="form-group"><label>Invoice Number <span class="req">*</span></label>' +
        '<input type="text" class="form-input inv-no" data-invid="' + invId + '" placeholder="e.g. INV-2025-101"></div></div>' +
        '<div style="margin-bottom:12px"><div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
        '<button class="btn btn-secondary btn-sm" onclick="addMaterialRow(\'' + invId + '\')"><i class="bx bx-plus"></i> Add Material</button>' +
        '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Upload Excel' +
        '<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="uploadInvoiceExcel(this,\'' + invId + '\')"></label></div>' +
        '<div class="table-wrapper"><table class="data-table" id="mat-table-' + invId + '">' +
        '<thead><tr><th>Material</th><th>Quantity</th><th>Action</th></tr></thead><tbody></tbody></table></div></div>';
    blocks.appendChild(div);
}

function removeInvoiceBlock(invId) {
    tempInvoices = tempInvoices.filter(function (t) { return t.id !== invId; });
    var el = document.getElementById(invId);
    if (el) el.remove();
    var blocks = document.getElementById('invoiceBlocks');
    if (blocks && blocks.children.length === 0) {
        blocks.innerHTML = '<div class="empty-state" style="padding:30px"><i class="bx bx-file"></i><p>Click "Add Invoice" to add invoices</p></div>';
    }
}

function addMaterialRow(invId, material, qty) {
    material = material || '';
    qty = qty || '';
    var tbody = document.querySelector('#mat-table-' + invId + ' tbody');
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="text" class="form-input mat-name" value="' + escapeHtml(material) + '" placeholder="Material name" style="min-width:200px"></td>' +
        '<td><input type="number" class="form-input mat-qty" value="' + qty + '" placeholder="Qty" min="1" style="width:100px"></td>' +
        '<td><button class="btn-icon danger" onclick="this.closest(\'tr\').remove()"><i class="bx bx-trash"></i></button></td>';
    tbody.appendChild(tr);
}

function uploadInvoiceExcel(input, invId) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            var start = (data[0] && (data[0][0] || '').toString().toLowerCase().indexOf('material') > -1) ? 1 : 0;
            for (var i = start; i < data.length; i++) {
                if (data[i][0]) addMaterialRow(invId, data[i][0].toString(), data[i][1] || '');
            }
            showToast('Excel data imported successfully', 'success');
        } catch (err) {
            showToast('Failed to read Excel file', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
}

function submitVehicleEntry() {
    var vehicleNo = document.getElementById('veVehicleNo').value.trim();
    var lrNo = document.getElementById('veLrNo').value.trim();
    var driverName = document.getElementById('veDriverName').value.trim();
    var driverMobile = document.getElementById('veDriverMobile').value.trim();
    var transport = document.getElementById('veTransport').value.trim();
    if (!vehicleNo || !lrNo || !driverName || !driverMobile || !transport) {
        showToast('Please fill all vehicle details', 'error'); return;
    }
    if (!/^\d{10}$/.test(driverMobile)) {
        document.getElementById('mobileError').style.display = 'block';
        document.getElementById('veDriverMobile').classList.add('error');
        showToast('Mobile number must be exactly 10 digits', 'error'); return;
    }
    document.getElementById('mobileError').style.display = 'none';
    document.getElementById('veDriverMobile').classList.remove('error');
    var invBlocks = document.querySelectorAll('[id^="inv-block-"]');
    if (invBlocks.length === 0) { showToast('Please add at least one invoice', 'error'); return; }
    var vehicle = DB.add('vehicles', {
        vehicleNo: vehicleNo, lrNo: lrNo, driverName: driverName,
        driverMobile: driverMobile, transportName: transport, status: 'Pending Unload'
    });
    var hasEmptyInv = false;
    invBlocks.forEach(function (block) {
        var invNo = block.querySelector('.inv-no').value.trim();
        if (!invNo) { hasEmptyInv = true; return; }
        var invoice = DB.add('invoices', { vehicleId: vehicle.id, invoiceNo: invNo, status: 'Pending' });
        var rows = block.querySelectorAll('tbody tr');
        rows.forEach(function (row) {
            var mat = row.querySelector('.mat-name').value.trim();
            var qty = parseInt(row.querySelector('.mat-qty').value) || 0;
            if (mat && qty > 0) {
                DB.add('invoice_materials', { invoiceId: invoice.id, material: mat, qty: qty, unloadedQty: 0 });
            }
        });
    });
    if (hasEmptyInv) { showToast('All invoices must have invoice numbers', 'error'); return; }
    logAction('Inbound', 'VEHICLE_ENTRY', 'Vehicle ' + vehicleNo + ' registered with LR ' + lrNo);
    addNotification('Vehicle ' + vehicleNo + ' registered — Pending Unload', 'info');
    showToast('Vehicle entry saved successfully', 'success');
    navigateTo('inbound', 'vehicle-entry');
}

function renderPendingVehicles() {
    var vehicles = DB.filter('vehicles', function (v) { return v.status === 'Pending Unload'; });
    var html = '<div class="section-header"><h2><i class="bx bx-time-five"></i>Pending Vehicles</h2></div><div class="card">';
    if (vehicles.length === 0) {
        html += '<div class="empty-state"><i class="bx bx-check-circle"></i><p>No pending vehicles</p></div>';
    } else {
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR Number</th><th>Driver</th><th>Mobile</th><th>Transport</th><th>Invoices</th><th>Action</th></tr></thead><tbody>';
        vehicles.forEach(function (v) {
            var invCount = DB.filter('invoices', function (inv) { return inv.vehicleId === v.id; }).length;
            html += '<tr><td><strong>' + escapeHtml(v.vehicleNo) + '</strong></td><td>' + escapeHtml(v.lrNo) + '</td>' +
                '<td>' + escapeHtml(v.driverName) + '</td><td>' + escapeHtml(v.driverMobile) + '</td>' +
                '<td>' + escapeHtml(v.transportName) + '</td><td><span class="badge badge-info">' + invCount + '</span></td>' +
                '<td><button class="btn btn-secondary btn-sm" onclick="navigateTo(\'inbound\',\'unload-process\')"><i class="bx bx-download"></i> Unload</button></td></tr>';
        });
        html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
}

function renderUnloadProcess() {
    var vehicles = DB.filter('vehicles', function (v) { return v.status === 'Pending Unload'; });
    var html = '<div class="section-header"><h2><i class="bx bx-download"></i>Unload Process</h2></div>' +
        '<div class="card" style="margin-bottom:20px"><div class="form-row"><div class="form-group"><label>Select Vehicle</label>' +
        '<select id="unloadVehicle" class="form-input" onchange="loadUnloadInvoices()"><option value="">-- Select Vehicle --</option>';
    vehicles.forEach(function (v) {
        html += '<option value="' + v.id + '">' + escapeHtml(v.vehicleNo) + ' — ' + escapeHtml(v.lrNo) + '</option>';
    });
    html += '</select></div></div></div><div id="unloadContent"></div>';
    return html;
}

function loadUnloadInvoices() {
    var vehicleId = document.getElementById('unloadVehicle').value;
    var container = document.getElementById('unloadContent');
    if (!vehicleId) { container.innerHTML = ''; return; }
    var invoices = DB.filter('invoices', function (inv) { return inv.vehicleId === vehicleId; });
    if (invoices.length === 0) {
        container.innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-file"></i><p>No invoices found</p></div></div>';
        return;
    }
    var html = '<div class="card" style="margin-bottom:16px"><div class="card-title">Select Invoice to Unload</div><div style="display:flex;gap:8px;flex-wrap:wrap">';
    invoices.forEach(function (inv) {
        var cls = inv.status === 'Pending' ? 'btn-secondary' : 'btn-primary';
        var dis = inv.status === 'Unloaded' ? ' disabled' : '';
        var label = inv.status === 'Unloaded' ? ' <i class="bx bx-check"></i> Done' : '';
        html += '<button class="btn ' + cls + ' btn-sm" onclick="loadInvoiceMaterials(\'' + inv.id + '\')"' + dis + '>' + escapeHtml(inv.invoiceNo) + label + '</button>';
    });
    html += '</div></div><div id="unloadMaterials"></div>';
    container.innerHTML = html;
}

function loadInvoiceMaterials(invoiceId) {
    var materials = DB.filter('invoice_materials', function (m) { return m.invoiceId === invoiceId; });
    var container = document.getElementById('unloadMaterials');
    var html = '<div class="card"><div class="card-title">Materials — Enter Unloaded Quantity</div><div class="table-wrapper">' +
        '<table class="data-table"><thead><tr><th>Material</th><th>Invoice Qty</th><th>Unloaded Qty</th><th>Difference</th></tr></thead><tbody>';
    materials.forEach(function (m) {
        html += '<tr id="unload-row-' + m.id + '"><td><strong>' + escapeHtml(m.material) + '</strong></td><td>' + m.qty + '</td>' +
            '<td><input type="number" class="form-input unload-qty" data-matid="' + m.id + '" data-expected="' + m.qty + '" value="' + (m.unloadedQty || '') + '" min="0" style="width:120px" oninput="checkUnloadDiff(this)"></td>' +
            '<td class="diff-cell" id="diff-' + m.id + '">—</td></tr>';
    });
    html += '</tbody></table></div><div class="form-actions">' +
        '<button class="btn btn-primary" onclick="processUnload(\'' + invoiceId + '\')"><i class="bx bx-check-double"></i> Process Unload</button></div></div>';
    container.innerHTML = html;
}

function checkUnloadDiff(input) {
    var matId = input.dataset.matid;
    var expected = parseInt(input.dataset.expected);
    var actual = parseInt(input.value) || 0;
    var diffCell = document.getElementById('diff-' + matId);
    var diff = actual - expected;
    if (input.value === '') {
        diffCell.innerHTML = '—';
    } else if (diff === 0) {
        diffCell.innerHTML = '<span class="qty-match">Match</span>';
    } else {
        diffCell.innerHTML = '<span class="qty-mismatch">' + (diff > 0 ? '+' : '') + diff + '</span>';
    }
}

function processUnload(invoiceId) {
    var materials = DB.filter('invoice_materials', function (m) { return m.invoiceId === invoiceId; });
    var hasMismatch = false;
    var differences = [];
    materials.forEach(function (m) {
        var input = document.querySelector('.unload-qty[data-matid="' + m.id + '"]');
        var unloaded = parseInt(input.value) || 0;
        DB.update('invoice_materials', m.id, { unloadedQty: unloaded });
        if (unloaded !== m.qty) {
            hasMismatch = true;
            differences.push({ material: m.material, expected: m.qty, actual: unloaded, diff: unloaded - m.qty });
        }
    });
    if (hasMismatch) {
        var diffHtml = '<div class="table-wrapper" style="margin-bottom:16px"><table class="data-table"><thead><tr><th>Material</th><th>Expected</th><th>Actual</th><th>Difference</th></tr></thead><tbody>';
        differences.forEach(function (d) {
            diffHtml += '<tr><td>' + escapeHtml(d.material) + '</td><td>' + d.expected + '</td><td>' + d.actual + '</td>' +
                '<td><span class="qty-mismatch">' + (d.diff > 0 ? '+' : '') + d.diff + '</span></td></tr>';
        });
        diffHtml += '</tbody></table></div>';
        diffHtml += '<p style="color:var(--warning);font-size:13px;margin-bottom:16px"><i class="bx bx-error"></i> Quantity mismatch detected. Admin has been notified.</p>';
        showModal('Qty Not Match', diffHtml, 'lg',
            '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
            '<button class="btn btn-primary" onclick="confirmUnload(\'' + invoiceId + '\')">Accept & Continue</button>');
        var invoice = DB.find('invoices', invoiceId);
        differences.forEach(function (d) {
            DB.add('difference_reports', {
                invoiceId: invoiceId, invoiceNo: invoice ? invoice.invoiceNo : '',
                material: d.material, expected: d.expected, actual: d.actual, diff: d.diff,
                status: 'Pending Review'
            });
        });
        addNotification('Quantity mismatch detected in unload — Admin notified', 'warning');
    } else {
        confirmUnload(invoiceId);
    }
}

function confirmUnload(invoiceId) {
    closeModal();
    DB.update('invoices', invoiceId, { status: 'Unloaded' });
    var invoice = DB.find('invoices', invoiceId);
    if (invoice) {
        var allInvoices = DB.filter('invoices', function (inv) { return inv.vehicleId === invoice.vehicleId; });
        var allDone = allInvoices.every(function (inv) { return inv.status === 'Unloaded'; });
        if (allDone) {
            DB.update('vehicles', invoice.vehicleId, { status: 'Unloaded' });
            var vehicle = DB.find('vehicles', invoice.vehicleId);
            addNotification('Vehicle ' + (vehicle ? vehicle.vehicleNo : '') + ' fully unloaded', 'success');
        }
    }
    logAction('Inbound', 'UNLOAD', 'Invoice ' + invoiceId + ' unloaded');
    showToast('Unload processed successfully', 'success');
    loadUnloadInvoices();
}

// ==================== PUTAWAY ====================
function renderPutaway() {
    var unloadedVehicles = DB.filter('vehicles', function (v) { return v.status === 'Unloaded'; });
    var html = '<div class="section-header"><h2><i class="bx bxs-package"></i>Putaway</h2></div>' +
        '<div class="tab-bar"><button class="tab-btn active" id="tabPutWithInv" onclick="switchPutTab(\'with\')">With Invoice</button>' +
        '<button class="tab-btn" id="tabPutWithoutInv" onclick="switchPutTab(\'without\')">Without Invoice</button></div>' +
        '<div id="putWithInv"><div class="card" style="margin-bottom:16px"><div class="form-row">' +
        '<div class="form-group"><label>Select Vehicle</label><select id="putVehicle" class="form-input" onchange="loadPutInvoices()"><option value="">-- Select --</option>';
    unloadedVehicles.forEach(function (v) { html += '<option value="' + v.id + '">' + escapeHtml(v.vehicleNo) + '</option>'; });
    html += '</select></div><div class="form-group"><label>Select Invoice</label><select id="putInvoice" class="form-input" onchange="loadPutMaterials()"><option value="">-- Select --</option></select></div></div></div></div>' +
        '<div id="putWithoutInv" style="display:none"></div>' +
        '<div class="card"><div class="card-title">Putaway Details</div><div class="form-row">' +
        '<div class="form-group"><label>Date</label><input type="date" id="putDate" class="form-input" value="' + today() + '" readonly></div>' +
        '<div class="form-group"><label>Rack <span class="req">*</span></label><div style="display:flex;gap:6px"><input type="text" id="putRack" class="form-input" placeholder="Scan or enter rack"><button class="btn-icon scan-btn" onclick="simulateScan(\'putRack\')"><i class="bx bx-qr-scan"></i></button></div></div>' +
        '<div class="form-group"><label>EAN <span class="req">*</span></label><div style="display:flex;gap:6px"><input type="text" id="putEan" class="form-input" placeholder="Scan or enter EAN" oninput="lookupEANForPut()"><button class="btn-icon scan-btn" onclick="simulateScan(\'putEan\')"><i class="bx bx-qr-scan"></i></button></div></div>' +
        '<div class="form-group"><label>Material</label><input type="text" id="putMaterial" class="form-input" placeholder="Auto-filled" readonly></div>' +
        '<div class="form-group"><label>Description</label><input type="text" id="putDesc" class="form-input" placeholder="Auto-filled" readonly></div>' +
        '<div class="form-group"><label>Packing</label><input type="text" id="putPacking" class="form-input" placeholder="e.g. Bag, Box, Bottle"></div>' +
        '<div class="form-group"><label>Box Number</label><input type="text" id="putBox" class="form-input" placeholder="e.g. B001"></div>' +
        '<div class="form-group"><label>Quantity <span class="req">*</span></label><input type="number" id="putQty" class="form-input" placeholder="0" min="1"></div>' +
        '</div><div class="form-actions"><button class="btn btn-primary" onclick="submitPutaway()"><i class="bx bx-check-circle"></i> Save Putaway</button></div></div>';
    document.getElementById('section-putaway').innerHTML = html;
}

function switchPutTab(tab) {
    document.getElementById('tabPutWithInv').classList.toggle('active', tab === 'with');
    document.getElementById('tabPutWithoutInv').classList.toggle('active', tab === 'without');
    document.getElementById('putWithInv').style.display = tab === 'with' ? 'block' : 'none';
    document.getElementById('putWithoutInv').style.display = tab === 'without' ? 'block' : 'none';
}

function loadPutInvoices() {
    var vId = document.getElementById('putVehicle').value;
    var sel = document.getElementById('putInvoice');
    sel.innerHTML = '<option value="">-- Select --</option>';
    if (!vId) return;
    DB.filter('invoices', function (inv) { return inv.vehicleId === vId; }).forEach(function (inv) {
        sel.innerHTML += '<option value="' + inv.id + '">' + escapeHtml(inv.invoiceNo) + '</option>';
    });
}

function loadPutMaterials() {
    var invId = document.getElementById('putInvoice').value;
    if (!invId) return;
    var mats = DB.filter('invoice_materials', function (m) { return m.invoiceId === invId; });
    if (mats.length > 0) document.getElementById('putMaterial').value = mats[0].material;
}

function lookupEANForPut() {
    var ean = document.getElementById('putEan').value.trim();
    if (ean.length < 5) return;
    var mat = DB.get('material_master').find(function (m) { return m.ean === ean; });
    if (mat) {
        document.getElementById('putMaterial').value = mat.material;
        document.getElementById('putDesc').value = mat.description;
    }
}

function submitPutaway() {
    var rack = document.getElementById('putRack').value.trim();
    var ean = document.getElementById('putEan').value.trim();
    var material = document.getElementById('putMaterial').value.trim();
    var description = document.getElementById('putDesc').value.trim();
    var packing = document.getElementById('putPacking').value.trim();
    var box = document.getElementById('putBox').value.trim();
    var qty = parseInt(document.getElementById('putQty').value) || 0;
    if (!rack || !ean || !material || qty <= 0) { showToast('Please fill all required fields', 'error'); return; }
    DB.add('location_master', {
        date: today(), rack: rack, ean: ean, material: material, description: description,
        quantity: qty, packing: packing, box: box, action: 'PUTAWAY',
        user: APP.currentUser ? APP.currentUser.name : 'Unknown', dateTime: new Date().toISOString()
    });
    logAction('Putaway', 'PUTAWAY', material + ' — ' + qty + ' units to ' + rack);
    showToast('Putaway saved successfully', 'success');
    ['putRack', 'putEan', 'putMaterial', 'putDesc', 'putPacking', 'putBox', 'putQty'].forEach(function (id) {
        document.getElementById(id).value = '';
    });
}

// ==================== PIV ====================
// ==================== PIV ====================
function renderPIV() {
    var html = '<div class="section-header"><h2><i class="bx bxs-clipboard"></i>Physical Inventory Verification</h2></div>' +
        '<div class="card"><div class="form-row">' +
        '<div class="form-group"><label>User</label><input type="text" class="form-input" value="' + escapeHtml(APP.currentUser ? APP.currentUser.name : '') + '" readonly></div>' +
        '<div class="form-group"><label>Date</label><input type="date" class="form-input" value="' + today() + '" readonly></div>' +
        '<div class="form-group"><label>Rack <span class="req">*</span></label><div style="display:flex;gap:6px"><input type="text" id="pivRack" class="form-input" placeholder="Scan or enter rack"><button class="btn-icon scan-btn" onclick="simulateScan(\'pivRack\')"><i class="bx bx-qr-scan"></i></button></div></div>' +
        '<div class="form-group"><label>EAN <span class="req">*</span></label><div style="display:flex;gap:6px"><input type="text" id="pivEan" class="form-input" placeholder="Scan or enter EAN" oninput="lookupEANForPIV()"><button class="btn-icon scan-btn" onclick="simulateScan(\'pivEan\')"><i class="bx bx-qr-scan"></i></button></div></div>' +
        '<div class="form-group"><label>Material <span class="req">*</span></label><input type="text" id="pivMaterial" class="form-input" placeholder="Auto-fill from EAN or type manually"></div>' +
        '<div class="form-group"><label>Description</label><input type="text" id="pivDesc" class="form-input" placeholder="Auto-fills if EAN found"></div>' +
        '<div class="form-group"><label>Packing</label><input type="text" id="pivPacking" class="form-input" placeholder="e.g. Bag, Box"></div>' +
        '<div class="form-group"><label>Box</label><input type="text" id="pivBox" class="form-input" placeholder="Box number"></div>' +
        '<div class="form-group"><label>Quantity <span class="req">*</span></label><input type="number" id="pivQty" class="form-input" placeholder="0" min="1"></div>' +
        '</div><div class="form-actions"><button class="btn btn-primary" onclick="submitPIV()"><i class="bx bx-check-circle"></i> Save PIV</button></div></div>';
    document.getElementById('section-piv').innerHTML = html;
}

function lookupEANForPIV() {
    var ean = document.getElementById('pivEan').value.trim();
    var matInput = document.getElementById('pivMaterial');
    var descInput = document.getElementById('pivDesc');
    
    // Agar EAN 5 se chhota hai toh kuch mat karo
    if (ean.length < 5) return;
    
    // Database me EAN dhundho
    var mat = DB.get('material_master').find(function (m) { return m.ean === ean; });
    
    if (mat) {
        // EAN mil gaya: Material aur Description auto fill karo
        matInput.value = mat.material;
        descInput.value = mat.description;
    } else {
        // EAN nahi mila: Fields khali chhodo taaki user manual daal sake
        matInput.value = '';
        descInput.value = '';
    }
}

function submitPIV() {
    var rack = document.getElementById('pivRack').value.trim();
    var ean = document.getElementById('pivEan').value.trim();
    var material = document.getElementById('pivMaterial').value.trim();
    var description = document.getElementById('pivDesc').value.trim();
    var packing = document.getElementById('pivPacking').value.trim();
    var box = document.getElementById('pivBox').value.trim();
    var qty = parseInt(document.getElementById('pivQty').value) || 0;
    
    if (!rack || !ean || !material || qty <= 0) { 
        showToast('Please fill Rack, EAN, Material and Quantity', 'error'); 
        return; 
    }
    
    DB.add('location_master', {
        date: today(), 
        rack: rack, // Ab yahan user ne jo rack dala hai wo aayega
        ean: ean, 
        material: material, 
        description: description,
        quantity: qty, 
        packing: packing, 
        box: box, 
        action: 'PIV',
        user: APP.currentUser ? APP.currentUser.name : 'Unknown', 
        dateTime: new Date().toISOString()
    });
    
    logAction('PIV', 'PIV', material + ' — ' + qty + ' units verified at ' + rack);
    showToast('PIV saved successfully', 'success');
    
    // Form clear karo (Rack field bhi clear hoga)
    ['pivRack', 'pivEan', 'pivMaterial', 'pivDesc', 'pivPacking', 'pivBox', 'pivQty'].forEach(function (id) {
        document.getElementById(id).value = '';
    });
}

function submitPIV() {
    var ean = document.getElementById('pivEan').value.trim();
    var material = document.getElementById('pivMaterial').value.trim();
    var description = document.getElementById('pivDesc').value.trim();
    var packing = document.getElementById('pivPacking').value.trim();
    var box = document.getElementById('pivBox').value.trim();
    var qty = parseInt(document.getElementById('pivQty').value) || 0;
    if (!ean || !material || qty <= 0) { showToast('Please fill all required fields', 'error'); return; }
    DB.add('location_master', {
        date: today(), rack: 'PIV-SCAN', ean: ean, material: material, description: description,
        quantity: qty, packing: packing, box: box, action: 'PIV',
        user: APP.currentUser ? APP.currentUser.name : 'Unknown', dateTime: new Date().toISOString()
    });
    logAction('PIV', 'PIV', material + ' — ' + qty + ' units verified');
    showToast('PIV saved successfully', 'success');
    ['pivEan', 'pivMaterial', 'pivDesc', 'pivPacking', 'pivBox', 'pivQty'].forEach(function (id) {
        document.getElementById(id).value = '';
    });
}

// ==================== LOCATION MASTER ====================
// ==================== LOCATION MASTER ====================
function renderLocationMaster() {
    var locations = DB.get('location_master');
    var searchMat = document.getElementById('locSearchMat') ? document.getElementById('locSearchMat').value.trim().toLowerCase() : '';
    var searchEan = document.getElementById('locSearchEan') ? document.getElementById('locSearchEan').value.trim().toLowerCase() : '';
    var searchRack = document.getElementById('locSearchRack') ? document.getElementById('locSearchRack').value.trim().toLowerCase() : '';
    var searchBrand = document.getElementById('locSearchBrand') ? document.getElementById('locSearchBrand').value.trim().toLowerCase() : '';
    
    var filtered = locations;
    
    // ⭐ YEH LINE ADD KI HAI - FILTERED DATA SAVE KARNE KE LIYE ⭐
    APP.filteredLocations = filtered;

    if (searchMat) {
        var matParts = searchMat.split(',');
        filtered = filtered.filter(function (l) {
            return matParts.some(function (p) { return l.material.toLowerCase().indexOf(p.trim()) > -1; });
        });
    }
    if (searchEan) filtered = filtered.filter(function (l) { return l.ean.toLowerCase().indexOf(searchEan) > -1; });
    if (searchRack) filtered = filtered.filter(function (l) { return l.rack.toLowerCase().indexOf(searchRack) > -1; });
    if (searchBrand) {
        var eans = DB.filter('material_master', function (m) { return m.brand && m.brand.toLowerCase().indexOf(searchBrand) > -1; }).map(function (m) { return m.ean; });
        filtered = filtered.filter(function (l) { return eans.indexOf(l.ean) > -1; });
    }

    // ⭐ YEH LINE BHI ADD KI HAI - FINAL FILTERED DATA SAVE KARNE KE LIYE ⭐
    APP.filteredLocations = filtered;

    var pg = paginate(filtered, APP.locPage, APP.locPerPage);
    var html = '<div class="section-header"><h2><i class="bx bxs-map-pin"></i>Location Master</h2>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-secondary btn-sm" onclick="showPickModal()"><i class="bx bx-clipboard"></i> Picking Report</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="showReportHistory()"><i class="bx bx-history"></i> Report History</button>' +
        '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload' +
        '<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadLocation(this)"></label>' +
        '<button class="btn btn-primary btn-sm" onclick="exportLocationExcel()"><i class="bx bx-download"></i> Export Excel</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportLocationPDF()"><i class="bx bx-file"></i> Export PDF</button>' +
        '<button class="btn btn-sm" style="background:var(--info-dim);color:var(--info);border:1px solid rgba(59,130,246,.2)" onclick="printLocation()"><i class="bx bx-printer"></i> Print</button>' +
        '</div></div>';
    html += '<div class="card" style="margin-bottom:16px"><div class="card-title">Search & Filter</div><div class="form-row">' +
        '<div class="form-group"><label>Material</label><input type="text" id="locSearchMat" class="form-input" placeholder="Material name (comma for multiple)" value="' + escapeHtml(searchMat) + '"></div>' +
        '<div class="form-group"><label>EAN</label><input type="text" id="locSearchEan" class="form-input" placeholder="EAN code" value="' + escapeHtml(searchEan) + '"></div>' +
        '<div class="form-group"><label>Rack</label><input type="text" id="locSearchRack" class="form-input" placeholder="Rack name" value="' + escapeHtml(searchRack) + '"></div>' +
        '<div class="form-group"><label>Brand</label><input type="text" id="locSearchBrand" class="form-input" placeholder="Brand name" value="' + escapeHtml(searchBrand) + '"></div>' +
        '</div><div class="form-actions"><button class="btn btn-primary btn-sm" onclick="APP.locPage=1;renderLocationMaster()"><i class="bx bx-search"></i> Search</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="clearLocSearch()"><i class="bx bx-refresh"></i> Clear</button></div></div>';
    html += '<div class="card"><div class="card-title">Records (' + pg.total + ')</div><div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Date</th><th>Rack</th><th>EAN</th><th>Material</th><th>Description</th><th>Qty</th><th>Packing</th><th>Box</th><th>Action</th><th>User</th><th>DateTime</th></tr></thead><tbody>';
    if (pg.items.length === 0) {
        html += '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:30px">No records found</td></tr>';
    } else {
        pg.items.forEach(function (l) {
            var badge = l.action === 'PUTAWAY' ? 'badge-accent' : 'badge-info';
            html += '<tr><td>' + escapeHtml(l.date) + '</td><td>' + escapeHtml(l.rack) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(l.ean) + '</td>' +
                '<td>' + escapeHtml(l.material) + '</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(l.description) + '</td>' +
                '<td><strong>' + l.quantity + '</strong></td><td>' + escapeHtml(l.packing) + '</td><td>' + escapeHtml(l.box) + '</td>' +
                '<td><span class="badge ' + badge + '">' + escapeHtml(l.action) + '</span></td><td>' + escapeHtml(l.user) + '</td><td style="font-size:11px;color:var(--text-muted)">' + formatDateTime(l.dateTime) + '</td></tr>';
        });
    }
    html += '</tbody></table></div>' + renderPagination(APP.locPage, pg.pages, 'goLocPage') + '</div>';
    document.getElementById('section-location').innerHTML = html;
}

function goLocPage(p) { APP.locPage = p; renderLocationMaster(); }
function clearLocSearch() {
    ['locSearchMat', 'locSearchEan', 'locSearchRack', 'locSearchBrand'].forEach(function (id) { if (document.getElementById(id)) document.getElementById(id).value = ''; });
    APP.locPage = 1; renderLocationMaster();
}

function bulkUploadLocation(input) {
    var file = input.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws);
            var count = 0;
            data.forEach(function (row) {
                if (row.Rack || row.Material) {
                    DB.add('location_master', {
                        date: row.Date || today(), rack: row.Rack || '', ean: row.EAN || '',
                        material: row.Material || '', description: row.Description || '',
                        quantity: parseInt(row.Quantity) || 0, packing: row.Packing || '',
                        box: row.Box || '', action: row.Action || 'UPLOAD',
                        user: APP.currentUser ? APP.currentUser.name : 'Unknown',
                        dateTime: new Date().toISOString()
                    });
                    count++;
                }
            });
            logAction('Location', 'BULK_UPLOAD', count + ' records uploaded');
            showToast(count + ' records uploaded successfully', 'success');
            renderLocationMaster();
        } catch (err) { showToast('Failed to read file', 'error'); }
    };
    reader.readAsArrayBuffer(file); input.value = '';
}

function exportLocationExcel() {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var locations = DB.get('location_master');
    var wsData = [['Date', 'Rack', 'EAN', 'Material', 'Description', 'Quantity', 'Packing', 'Box', 'Action', 'User', 'DateTime']];
    locations.forEach(function (l) {
        wsData.push([l.date, l.rack, l.ean, l.material, l.description, l.quantity, l.packing, l.box, l.action, l.user, formatDateTime(l.dateTime)]);
    });
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 35 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Location Master');
    XLSX.writeFile(wb, 'Location_Master_' + today() + '.xlsx');
    logAction('Location', 'EXPORT_EXCEL', 'Location Master exported');
    showToast('Excel exported', 'success');
}

function exportLocationPDF() {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var locations = DB.get('location_master');
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(16);
    doc.text('VIP INDUSTRIES LIMITED MD20 — Location Master', 14, 15);
    doc.setFontSize(9);
    doc.text('Generated: ' + formatDateTime(new Date()), 14, 22);
    var tableData = locations.map(function (l) {
        return [l.date, l.rack, l.ean, l.material, l.description, l.quantity, l.packing, l.box, l.action, l.user];
    });
    doc.autoTable({
        head: [['Date', 'Rack', 'EAN', 'Material', 'Description', 'Qty', 'Packing', 'Box', 'Action', 'User']],
        body: tableData, startY: 28, styles: { fontSize: 7 }, headStyles: { fillColor: [0, 180, 130] }
    });
    doc.save('Location_Master_' + today() + '.pdf');
    logAction('Location', 'EXPORT_PDF', 'Location Master exported as PDF');
    showToast('PDF exported', 'success');
}

function printLocation() {
    var locations = DB.get('location_master');
    var html = '<html><head><title>Location Master — VIP INDUSTRIES LIMITED MD20</title>' +
        '<style>body{font-family:Arial,sans-serif;font-size:11px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#00B882;color:#fff}h1{font-size:18px}p{color:#666;font-size:10px}</style></head><body>' +
        '<h1>VIP INDUSTRIES LIMITED MD20 — Location Master</h1><p>Generated: ' + formatDateTime(new Date()) + '</p>' +
        '<table><thead><tr><th>Date</th><th>Rack</th><th>EAN</th><th>Material</th><th>Desc</th><th>Qty</th><th>Packing</th><th>Box</th><th>Action</th><th>User</th></tr></thead><tbody>';
    locations.forEach(function (l) {
        html += '<tr><td>' + escapeHtml(l.date) + '</td><td>' + escapeHtml(l.rack) + '</td><td>' + escapeHtml(l.ean) + '</td><td>' + escapeHtml(l.material) + '</td><td>' + escapeHtml(l.description) + '</td><td>' + l.quantity + '</td><td>' + escapeHtml(l.packing) + '</td><td>' + escapeHtml(l.box) + '</td><td>' + escapeHtml(l.action) + '</td><td>' + escapeHtml(l.user) + '</td></tr>';
    });
    html += '</tbody></table></body></html>';
    var w = window.open('', '_blank');
    w.document.write(html); w.document.close(); w.print();
    logAction('Location', 'PRINT', 'Location Master printed');
}

// ==================== PICKING REPORT ====================
function showPickModal() {
    var html = '<div class="form-group"><label>Picker Name <span class="req">*</span></label>' +
        '<input type="text" id="pickerName" class="form-input" placeholder="Enter picker name"></div>' +
        '<p style="color:var(--text-muted);font-size:12px;margin-top:8px">A unique Report Number will be generated automatically.</p>';
    showModal('Create Picking Report', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="createPickingReport()"><i class="bx bx-check-circle"></i> Create</button>');
}

function createPickingReport() {
    var pickerName = document.getElementById('pickerName').value.trim();
    if (!pickerName) { showToast('Enter picker name', 'error'); return; }
    
    // ⭐ YEH LINE HAI JO FIX KAREGI - AB SIRF SEARCHED DATA AAYEGA ⭐
    var locations = APP.filteredLocations || [];
    
    if (locations.length === 0) { showToast('Koi filtered data nahi hai! Pehle search karo.', 'error'); closeModal(); return; }
    var reportNo = DB.reportNo();
    var reportItems = locations.map(function (l) {
        return { locationId: l.id, material: l.material, description: l.description, rack: l.rack, ean: l.ean, quantity: l.quantity, packing: l.packing, box: l.box, pickedQty: l.quantity };
    });
    DB.add('picking_reports', {
        reportNo: reportNo, pickerName: pickerName, status: 'Open',
        items: reportItems, createdAt: new Date().toISOString()
    });
    logAction('Location', 'PICK_REPORT', 'Report ' + reportNo + ' created by ' + pickerName);
    showToast('Picking Report ' + reportNo + ' created', 'success');
    closeModal();
    showPickDetail(reportNo);
}

function showReportHistory() {
    var reports = DB.get('picking_reports').reverse();
    var html = '<div class="section-header"><h2><i class="bx bx-history"></i>Picking Report History</h2></div><div class="card">';
    if (reports.length === 0) {
        html += '<div class="empty-state"><i class="bx bx-clipboard"></i><p>No reports generated yet</p></div>';
    } else {
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Report No</th><th>Picker</th><th>Items</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>';
        reports.forEach(function (r) {
            var statusBadge = r.status === 'Open' ? 'badge-warning' : 'badge-success';
            html += '<tr><td><strong style="color:var(--accent)">' + escapeHtml(r.reportNo) + '</strong></td>' +
                '<td>' + escapeHtml(r.pickerName) + '</td><td>' + (r.items ? r.items.length : 0) + '</td>' +
                '<td><span class="badge ' + statusBadge + '">' + escapeHtml(r.status) + '</span></td>' +
                '<td style="font-size:12px;color:var(--text-muted)">' + formatDateTime(r.createdAt) + '</td>' +
                '<td><div class="table-actions">' +
                '<button class="btn-icon" onclick="showPickDetail(\'' + r.reportNo + '\')" title="Open"><i class="bx bx-show"></i></button>' +
                '<button class="btn-icon" onclick="exportPickExcel(\'' + r.reportNo + '\')" title="Excel"><i class="bx bx-download"></i></button>' +
                '<button class="btn-icon" onclick="exportPickPDF(\'' + r.reportNo + '\')" title="PDF"><i class="bx bx-file"></i></button>' +
                '<button class="btn-icon" onclick="printPickReport(\'' + r.reportNo + '\')" title="Print"><i class="bx bx-printer"></i></button>' +
                '</div></td></tr>';
        });
        html += '</tbody></table></div>';
    }
    html += '</div>';
    showModal('Report History', html, 'lg');
}

function showPickDetail(reportNo) {
    var report = DB.get('picking_reports').find(function (r) { return r.reportNo === reportNo; });
    if (!report) { showToast('Report not found', 'error'); return; }
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
        '<div><strong style="font-family:var(--font-display);color:var(--accent);font-size:16px">' + escapeHtml(report.reportNo) + '</strong>' +
        '<span style="margin-left:12px;color:var(--text-muted);font-size:13px">Picker: ' + escapeHtml(report.pickerName) + '</span></div>' +
        '<span class="badge ' + (report.status === 'Open' ? 'badge-warning' : 'badge-success') + '">' + escapeHtml(report.status) + '</span></div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>Description</th><th>Rack</th><th>EAN</th><th>Original Qty</th><th>Picked Qty</th><th>Actions</th></tr></thead><tbody>';
    if (!report.items || report.items.length === 0) {
        html += '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">No items</td></tr>';
    } else {
        report.items.forEach(function (item, idx) {
            html += '<tr id="pick-row-' + idx + '"><td>' + escapeHtml(item.material) + '</td>' +
                '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(item.description) + '</td>' +
                '<td>' + escapeHtml(item.rack) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(item.ean) + '</td>' +
                '<td>' + item.quantity + '</td><td><strong>' + item.pickedQty + '</strong></td>' +
                '<td><div class="table-actions">' +
                '<button class="btn-icon" onclick="minusPickQty(\'' + reportNo + '\',' + idx + ')" title="Minus Qty"><i class="bx bx-minus-circle"></i></button>';
            if (checkPermType('delete')) {
                html += '<button class="btn-icon danger" onclick="deletePickItem(\'' + reportNo + '\',' + idx + ')" title="Delete"><i class="bx bx-trash"></i></button>';
            }
            html += '</div></td></tr>';
        });
    }
    html += '</tbody></table></div>';
    html += '<div class="form-actions" style="margin-top:16px">' +
        '<button class="btn btn-secondary btn-sm" onclick="exportPickExcel(\'' + reportNo + '\')"><i class="bx bx-download"></i> Excel</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportPickPDF(\'' + reportNo + '\')"><i class="bx bx-file"></i> PDF</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="printPickReport(\'' + reportNo + '\')"><i class="bx bx-printer"></i> Print</button>' +
        '<button class="btn btn-primary btn-sm" onclick="closePickReport(\'' + reportNo + '\')"><i class="bx bx-check"></i> Close Report</button></div>';
    showModal('Picking Report — ' + reportNo, html, 'lg');
}

function minusPickQty(reportNo, idx) {
    var reports = DB.get('picking_reports');
    var report = reports.find(function (r) { return r.reportNo === reportNo; });
    if (!report || !report.items[idx]) return;
    var item = report.items[idx];
    var diffHtml = '<div class="form-group"><label>Quantity to Subtract</label>' +
        '<input type="number" id="minusQtyInput" class="form-input" min="1" max="' + item.pickedQty + '" placeholder="Enter qty" value="1"></div>' +
        '<p style="color:var(--text-muted);font-size:12px">Current picked qty: <strong>' + item.pickedQty + '</strong></p>';
    showModal('Minus Quantity — ' + item.material, diffHtml, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="confirmMinusQty(\'' + reportNo + '\',' + idx + ')"><i class="bx bx-check"></i> Confirm</button>');
}

function confirmMinusQty(reportNo, idx) {
    var qty = parseInt(document.getElementById('minusQtyInput').value) || 0;
    if (qty <= 0) { showToast('Enter valid quantity', 'error'); return; }
    var reports = DB.get('picking_reports');
    var report = reports.find(function (r) { return r.reportNo === reportNo; });
    if (!report || !report.items[idx]) return;
    var item = report.items[idx];
    if (qty > item.pickedQty) { showToast('Cannot subtract more than picked qty', 'error'); return; }
    item.pickedQty -= qty;
    // Update Location Master
    var locItem = DB.find('location_master', item.locationId);
    if (locItem && locItem.quantity >= qty) {
        DB.update('location_master', item.locationId, { quantity: locItem.quantity - qty });
    }
    DB.set('picking_reports', reports);
    logAction('Location', 'PICK_MINUS', item.material + ' — subtracted ' + qty + ' from Report ' + reportNo);
    showToast('Quantity updated', 'success');
    closeModal();
    showPickDetail(reportNo);
}

function deletePickItem(reportNo, idx) {
    var reports = DB.get('picking_reports');
    var report = reports.find(function (r) { return r.reportNo === reportNo; });
    if (!report || !report.items[idx]) return;
    var item = report.items[idx];
    // Remove from Location Master
    DB.remove('location_master', item.locationId);
    report.items.splice(idx, 1);
    DB.set('picking_reports', reports);
    logAction('Location', 'PICK_DELETE', item.material + ' — deleted from Report ' + reportNo);
    showToast('Item removed', 'success');
    showPickDetail(reportNo);
}

function closePickReport(reportNo) {
    var reports = DB.get('picking_reports');
    var report = reports.find(function (r) { return r.reportNo === reportNo; });
    if (report) { report.status = 'Closed'; DB.set('picking_reports', reports); }
    logAction('Location', 'PICK_CLOSE', 'Report ' + reportNo + ' closed');
    showToast('Report closed', 'success');
    closeModal();
    renderLocationMaster();
}

function exportPickExcel(reportNo) {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var report = DB.get('picking_reports').find(function (r) { return r.reportNo === reportNo; });
    if (!report) return;
    var wsData = [['Report No: ' + reportNo, '', 'Picker: ' + report.pickerName, '', 'Date: ' + formatDateTime(report.createdAt)], [],
        ['Material', 'Description', 'Rack', 'EAN', 'Original Qty', 'Picked Qty', 'Packing', 'Box']
    ];
    (report.items || []).forEach(function (item) {
        wsData.push([item.material, item.description, item.rack, item.ean, item.quantity, item.pickedQty, item.packing, item.box]);
    });
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Picking Report');
    XLSX.writeFile(wb, reportNo + '.xlsx');
    showToast('Excel exported', 'success');
}

function exportPickPDF(reportNo) {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var report = DB.get('picking_reports').find(function (r) { return r.reportNo === reportNo; });
    if (!report) return;
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(16);
    doc.text('VIP INDUSTRIES LIMITED MD20 — Picking Report', 14, 15);
    doc.setFontSize(10);
    doc.text('Report: ' + reportNo + '  |  Picker: ' + report.pickerName + '  |  Date: ' + formatDateTime(report.createdAt), 14, 23);
    var tableData = (report.items || []).map(function (item) {
        return [item.material, item.description, item.rack, item.ean, item.quantity, item.pickedQty, item.packing, item.box];
    });
    doc.autoTable({
        head: [['Material', 'Description', 'Rack', 'EAN', 'Original Qty', 'Picked Qty', 'Packing', 'Box']],
        body: tableData, startY: 30, styles: { fontSize: 8 }, headStyles: { fillColor: [0, 180, 130] }
    });
    doc.save(reportNo + '.pdf');
    showToast('PDF exported', 'success');
}

function printPickReport(reportNo) {
    var report = DB.get('picking_reports').find(function (r) { return r.reportNo === reportNo; });
    if (!report) return;
    var html = '<html><head><title>Picking Report — ' + reportNo + '</title>' +
        '<style>body{font-family:Arial,sans-serif;font-size:11px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#00B882;color:#fff}h1{font-size:18px}p{color:#666;font-size:10px}.info{margin:10px 0}</style></head><body>' +
        '<h1>VIP INDUSTRIES LIMITED MD20 — Picking Report</h1>' +
        '<div class="info"><p>Report: <strong>' + escapeHtml(reportNo) + '</strong> | Picker: <strong>' + escapeHtml(report.pickerName) + '</strong> | Date: ' + formatDateTime(report.createdAt) + '</p></div>' +
        '<table><thead><tr><th>Material</th><th>Description</th><th>Rack</th><th>EAN</th><th>Original Qty</th><th>Picked Qty</th><th>Packing</th><th>Box</th></tr></thead><tbody>';
    (report.items || []).forEach(function (item) {
        html += '<tr><td>' + escapeHtml(item.material) + '</td><td>' + escapeHtml(item.description) + '</td><td>' + escapeHtml(item.rack) + '</td><td>' + escapeHtml(item.ean) + '</td><td>' + item.quantity + '</td><td>' + item.pickedQty + '</td><td>' + escapeHtml(item.packing) + '</td><td>' + escapeHtml(item.box) + '</td></tr>';
    });
    html += '</tbody></table></body></html>';
    var w = window.open('', '_blank');
    w.document.write(html); w.document.close(); w.print();
}

// ==================== RACK MASTER ====================
function renderRackMaster() {
    var racks = DB.get('rack_master');
    var locations = DB.get('location_master');
    var occupiedSet = {};
    locations.forEach(function (l) { occupiedSet[l.rack] = true; });
    var html = '<div class="section-header"><h2><i class="bx bxs-grid-alt"></i>Rack Master</h2>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<label class="btn btn-secondary btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload' +
        '<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadRacks(this)"></label>' +
        '<button class="btn btn-primary btn-sm" onclick="addSingleRack()"><i class="bx bx-plus"></i> Add Rack</button>' +
        '</div></div>';
    html += '<div class="grid-2"><div class="card"><div class="card-title">Rack Visualization</div><div class="rack-grid">';
    racks.forEach(function (r) {
        var cls = occupiedSet[r.rack] ? 'occupied' : 'empty';
        var icon = occupiedSet[r.rack] ? '<i class="bx bx-check" style="margin-right:4px"></i>' : '<i class="bx bx-x" style="margin-right:4px"></i>';
        html += '<div class="rack-cell ' + cls + '" title="' + escapeHtml(r.rack) + '">' + icon + escapeHtml(r.rack.replace('RACK-', '')) + '</div>';
    });
    html += '</div></div>';
    html += '<div class="card"><div class="card-title">Rack Details</div><div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Rack</th><th>Status</th></tr></thead><tbody>';
    racks.forEach(function (r) {
        var isOccupied = occupiedSet[r.rack];
        html += '<tr><td><strong>' + escapeHtml(r.rack) + '</strong></td>' +
            '<td><span class="status-dot ' + (isOccupied ? 'green' : 'red') + '"></span>' +
            (isOccupied ? '<span class="badge badge-success">Occupied</span>' : '<span class="badge badge-danger">Empty</span>') + '</td></tr>';
    });
    html += '</tbody></table></div></div></div>';
    document.getElementById('section-rack').innerHTML = html;
}

function bulkUploadRacks(input) {
    var file = input.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws);
            var count = 0;
            data.forEach(function (row) {
                var rack = row.Rack || row.rack || row.RACK;
                if (rack) { DB.add('rack_master', { rack: String(rack).trim() }); count++; }
            });
            logAction('Rack', 'BULK_UPLOAD', count + ' racks uploaded');
            showToast(count + ' racks added', 'success');
            renderRackMaster();
        } catch (err) { showToast('Failed to read file', 'error'); }
    };
    reader.readAsArrayBuffer(file); input.value = '';
}

function addSingleRack() {
    var html = '<div class="form-group"><label>Rack Name <span class="req">*</span></label>' +
        '<input type="text" id="newRackName" class="form-input" placeholder="e.g. RACK-031"></div>';
    showModal('Add Rack', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="saveSingleRack()"><i class="bx bx-check"></i> Save</button>');
}

function saveSingleRack() {
    var name = document.getElementById('newRackName').value.trim();
    if (!name) { showToast('Enter rack name', 'error'); return; }
    DB.add('rack_master', { rack: name });
    logAction('Rack', 'ADD', 'Rack ' + name + ' added');
    showToast('Rack added', 'success');
    closeModal(); renderRackMaster();
}

// ==================== MATERIAL MASTER ====================
function renderMaterialMaster() {
    var materials = DB.get('material_master');
    var search = document.getElementById('matSearchInput') ? document.getElementById('matSearchInput').value.trim().toLowerCase() : '';
    var filtered = materials;
    if (search) {
        filtered = materials.filter(function (m) {
            return m.material.toLowerCase().indexOf(search) > -1 || m.ean.toLowerCase().indexOf(search) > -1 ||
                (m.brand && m.brand.toLowerCase().indexOf(search) > -1) || (m.description && m.description.toLowerCase().indexOf(search) > -1);
        });
    }
    var pg = paginate(filtered, APP.matPage, APP.matPerPage);
    var html = '<div class="section-header"><h2><i class="bx bxs-label"></i>Material Master</h2>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-primary btn-sm" onclick="showAddMaterial()"><i class="bx bx-plus"></i> Add Material</button>' +
        '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload' +
        '<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadMaterials(this)"></label>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportMaterialExcel()"><i class="bx bx-download"></i> Export</button>' +
        '</div></div>';
    html += '<div class="card" style="margin-bottom:16px"><div class="form-row">' +
        '<div class="form-group" style="flex:1"><label>Search</label><input type="text" id="matSearchInput" class="form-input" placeholder="Search by material, EAN, brand..." value="' + escapeHtml(search) + '"></div>' +
        '<div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-primary btn-sm" onclick="APP.matPage=1;renderMaterialMaster()"><i class="bx bx-search"></i> Search</button></div>' +
        '</div></div>';
    html += '<div class="card"><div class="card-title">Materials (' + pg.total + ')</div><div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Material</th><th>Description</th><th>Division</th><th>EAN</th><th>Brand</th><th>Actions</th></tr></thead><tbody>';
    if (pg.items.length === 0) {
        html += '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">No materials found</td></tr>';
    } else {
        pg.items.forEach(function (m) {
            html += '<tr><td><strong>' + escapeHtml(m.material) + '</strong></td>' +
                '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(m.description) + '</td>' +
                '<td>' + escapeHtml(m.division) + '</td>' +
                '<td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(m.ean) + '</td>' +
                '<td>' + escapeHtml(m.brand) + '</td>' +
                '<td><div class="table-actions">' +
                '<button class="btn-icon" onclick="editMaterial(\'' + m.id + '\')" title="Edit"><i class="bx bx-edit"></i></button>';
            if (checkPermType('delete')) {
                html += '<button class="btn-icon danger" onclick="deleteMaterial(\'' + m.id + '\')" title="Delete"><i class="bx bx-trash"></i></button>';
            }
            html += '</div></td></tr>';
        });
    }
    html += '</tbody></table></div>' + renderPagination(APP.matPage, pg.pages, 'goMatPage') + '</div>';
    document.getElementById('section-material').innerHTML = html;
}

function goMatPage(p) { APP.matPage = p; renderMaterialMaster(); }

function showAddMaterial() {
    var html = '<div class="form-row">' +
        '<div class="form-group"><label>Material <span class="req">*</span></label><input type="text" id="matFormName" class="form-input" placeholder="Material name"></div>' +
        '<div class="form-group"><label>Description</label><input type="text" id="matFormDesc" class="form-input" placeholder="Description"></div>' +
        '<div class="form-group"><label>Division</label><input type="text" id="matFormDiv" class="form-input" placeholder="Division"></div>' +
        '<div class="form-group"><label>EAN <span class="req">*</span></label><input type="text" id="matFormEan" class="form-input" placeholder="EAN barcode"></div>' +
        '<div class="form-group"><label>Brand</label><input type="text" id="matFormBrand" class="form-input" placeholder="Brand name"></div>' +
        '</div>';
    showModal('Add Material', html, '',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="saveMaterial()"><i class="bx bx-check"></i> Save</button>');
}

function saveMaterial() {
    var material = document.getElementById('matFormName').value.trim();
    var description = document.getElementById('matFormDesc').value.trim();
    var division = document.getElementById('matFormDiv').value.trim();
    var ean = document.getElementById('matFormEan').value.trim();
    var brand = document.getElementById('matFormBrand').value.trim();
    if (!material || !ean) { showToast('Material and EAN are required', 'error'); return; }
    DB.add('material_master', { material: material, description: description, division: division, ean: ean, brand: brand });
    logAction('Material', 'ADD', material + ' (' + ean + ') added');
    showToast('Material added', 'success');
    closeModal(); renderMaterialMaster();
}

function editMaterial(id) {
    var m = DB.find('material_master', id);
    if (!m) return;
    var html = '<div class="form-row">' +
        '<div class="form-group"><label>Material <span class="req">*</span></label><input type="text" id="editMatName" class="form-input" value="' + escapeHtml(m.material) + '"></div>' +
        '<div class="form-group"><label>Description</label><input type="text" id="editMatDesc" class="form-input" value="' + escapeHtml(m.description) + '"></div>' +
        '<div class="form-group"><label>Division</label><input type="text" id="editMatDiv" class="form-input" value="' + escapeHtml(m.division) + '"></div>' +
        '<div class="form-group"><label>EAN <span class="req">*</span></label><input type="text" id="editMatEan" class="form-input" value="' + escapeHtml(m.ean) + '"></div>' +
        '<div class="form-group"><label>Brand</label><input type="text" id="editMatBrand" class="form-input" value="' + escapeHtml(m.brand) + '"></div>' +
        '</div>';
    showModal('Edit Material', html, '',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="updateMaterial(\'' + id + '\')"><i class="bx bx-check"></i> Update</button>');
}

function updateMaterial(id) {
    var material = document.getElementById('editMatName').value.trim();
    var description = document.getElementById('editMatDesc').value.trim();
    var division = document.getElementById('editMatDiv').value.trim();
    var ean = document.getElementById('editMatEan').value.trim();
    var brand = document.getElementById('editMatBrand').value.trim();
    if (!material || !ean) { showToast('Material and EAN are required', 'error'); return; }
    DB.update('material_master', id, { material: material, description: description, division: division, ean: ean, brand: brand });
    logAction('Material', 'EDIT', material + ' (' + ean + ') updated');
    showToast('Material updated', 'success');
    closeModal(); renderMaterialMaster();
}

function deleteMaterial(id) {
    var m = DB.find('material_master', id);
    if (!m) return;
    var html = '<p style="margin-bottom:16px">Are you sure you want to delete <strong>' + escapeHtml(m.material) + '</strong>?</p>' +
        '<p style="color:var(--warning);font-size:13px"><i class="bx bx-error"></i> This action cannot be undone.</p>';
    showModal('Delete Material', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-danger" onclick="confirmDeleteMaterial(\'' + id + '\')"><i class="bx bx-trash"></i> Delete</button>');
}

function confirmDeleteMaterial(id) {
    var m = DB.find('material_master', id);
    DB.remove('material_master', id);
    logAction('Material', 'DELETE', (m ? m.material : id) + ' deleted');
    showToast('Material deleted', 'success');
    closeModal(); renderMaterialMaster();
}

function bulkUploadMaterials(input) {
    var file = input.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws);
            var count = 0;
            data.forEach(function (row) {
                var mat = row.Material || row.material;
                var ean = row.EAN || row.ean;
                if (mat && ean) {
                    DB.add('material_master', {
                        material: String(mat).trim(), description: (row.Description || row.description || '').toString().trim(),
                        division: (row.Division || row.division || '').toString().trim(),
                        ean: String(ean).trim(), brand: (row.Brand || row.brand || '').toString().trim()
                    });
                    count++;
                }
            });
            logAction('Material', 'BULK_UPLOAD', count + ' materials uploaded');
            showToast(count + ' materials uploaded', 'success');
            renderMaterialMaster();
        } catch (err) { showToast('Failed to read file', 'error'); }
    };
    reader.readAsArrayBuffer(file); input.value = '';
}

function exportMaterialExcel() {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var materials = DB.get('material_master');
    var wsData = [['Material', 'Description', 'Division', 'EAN', 'Brand']];
    materials.forEach(function (m) { wsData.push([m.material, m.description, m.division, m.ean, m.brand]); });
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 30 }, { wch: 40 }, { wch: 15 }, { wch: 18 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Material Master');
    XLSX.writeFile(wb, 'Material_Master_' + today() + '.xlsx');
    showToast('Excel exported', 'success');
}

// ==================== ADMIN ====================
function renderAdmin() {
    if (APP.currentUser && APP.currentUser.role !== 'Super Admin') {
        document.getElementById('section-admin').innerHTML = '<div class="empty-state"><i class="bx bx-lock-alt"></i><p>Access Denied — Super Admin only</p></div>';
        return;
    }
    var users = DB.get('users');
    var html = '<div class="section-header"><h2><i class="bx bxs-user-detail"></i>User Management</h2>' +
        '<button class="btn btn-primary btn-sm" onclick="showAddUser()"><i class="bx bx-plus"></i> Create User</button></div>';
    html += '<div class="card"><div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Modules</th><th>Dashboard</th><th>Download</th><th>Delete</th><th>Actions</th></tr></thead><tbody>';
    users.forEach(function (u) {
        var p = u.permissions || {};
        html += '<tr><td><strong>' + escapeHtml(u.username) + '</strong></td>' +
            '<td>' + escapeHtml(u.name) + '</td><td>' + escapeHtml(u.role) + '</td>' +
            '<td style="font-size:12px">' + escapeHtml((p.modules || []).join(', ')) + '</td>' +
            '<td>' + (p.dashboard ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>') + '</td>' +
            '<td>' + (p.download ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>') + '</td>' +
            '<td>' + (p.delete ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>') + '</td>' +
            '<td><div class="table-actions">' +
            '<button class="btn-icon" onclick="editUser(\'' + u.id + '\')" title="Edit"><i class="bx bx-edit"></i></button>' +
            (u.role !== 'Super Admin' ? '<button class="btn-icon danger" onclick="deleteUser(\'' + u.id + '\')" title="Delete"><i class="bx bx-trash"></i></button>' : '') +
            '</div></td></tr>';
    });
    html += '</tbody></table></div></div>';
    document.getElementById('section-admin').innerHTML = html;
}

function showAddUser() {
    var modules = ['dashboard', 'inbound', 'putaway', 'piv', 'location', 'rack', 'material', 'reports', 'audit'];
    var html = '<div class="form-row">' +
        '<div class="form-group"><label>Username <span class="req">*</span></label><input type="text" id="newUserName" class="form-input" placeholder="Username"></div>' +
        '<div class="form-group"><label>Password <span class="req">*</span></label><input type="password" id="newUserPass" class="form-input" placeholder="Password"></div>' +
        '<div class="form-group"><label>Full Name <span class="req">*</span></label><input type="text" id="newUserFullName" class="form-input" placeholder="Full name"></div>' +
        '<div class="form-group"><label>Role</label><select id="newUserRole" class="form-input"><option>Operator</option><option>Manager</option><option>Viewer</option></select></div>' +
        '</div>';
    html += '<div class="card-title" style="margin-top:16px">Module Permissions</div><div class="perm-grid">';
    modules.forEach(function (m) {
        html += '<label class="perm-item"><input type="checkbox" class="perm-module" value="' + m + '"> ' + m.charAt(0).toUpperCase() + m.slice(1) + '</label>';
    });
    html += '</div>';
    html += '<div class="card-title" style="margin-top:16px">Other Permissions</div><div class="perm-grid">' +
        '<label class="perm-item"><input type="checkbox" id="permDashboard" checked> Dashboard Access</label>' +
        '<label class="perm-item"><input type="checkbox" id="permDownload" checked> Download/Export</label>' +
        '<label class="perm-item"><input type="checkbox" id="permDelete"> Delete Access</label>' +
        '</div>';
    showModal('Create User', html, 'lg',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="saveNewUser()"><i class="bx bx-check"></i> Create User</button>');
}

function saveNewUser() {
    var username = document.getElementById('newUserName').value.trim();
    var password = document.getElementById('newUserPass').value.trim();
    var name = document.getElementById('newUserFullName').value.trim();
    var role = document.getElementById('newUserRole').value;
    if (!username || !password || !name) { showToast('Fill all required fields', 'error'); return; }
    var existing = DB.get('users').find(function (u) { return u.username === username; });
    if (existing) { showToast('Username already exists', 'error'); return; }
    var modules = [];
    document.querySelectorAll('.perm-module:checked').forEach(function (cb) { modules.push(cb.value); });
    if (modules.length === 0) { showToast('Select at least one module', 'error'); return; }
    var permissions = {
        modules: modules,
        dashboard: document.getElementById('permDashboard').checked,
        download: document.getElementById('permDownload').checked,
        delete: document.getElementById('permDelete').checked
    };
    DB.add('users', { username: username, password: password, name: name, role: role, permissions: permissions });
    logAction('Admin', 'CREATE_USER', 'User ' + username + ' created');
    showToast('User created successfully', 'success');
    closeModal(); renderAdmin();
}

function editUser(id) {
    var u = DB.find('users', id);
    if (!u) return;
    var modules = ['dashboard', 'inbound', 'putaway', 'piv', 'location', 'rack', 'material', 'reports', 'audit'];
    var p = u.permissions || {};
    var html = '<div class="form-row">' +
        '<div class="form-group"><label>Username</label><input type="text" class="form-input" value="' + escapeHtml(u.username) + '" readonly></div>' +
        '<div class="form-group"><label>New Password</label><input type="password" id="editUserPass" class="form-input" placeholder="Leave blank to keep current"></div>' +
        '<div class="form-group"><label>Full Name</label><input type="text" id="editUserFullName" class="form-input" value="' + escapeHtml(u.name) + '"></div>' +
        '<div class="form-group"><label>Role</label><select id="editUserRole" class="form-input">' +
        '<option' + (u.role === 'Operator' ? ' selected' : '') + '>Operator</option>' +
        '<option' + (u.role === 'Manager' ? ' selected' : '') + '>Manager</option>' +
        '<option' + (u.role === 'Viewer' ? ' selected' : '') + '>Viewer</option></select></div></div>';
    html += '<div class="card-title" style="margin-top:16px">Module Permissions</div><div class="perm-grid">';
    modules.forEach(function (m) {
        var checked = (p.modules || []).indexOf(m) > -1 || (p.modules || []).indexOf('all') > -1;
        html += '<label class="perm-item"><input type="checkbox" class="perm-module" value="' + m + '"' + (checked ? ' checked' : '') + '> ' + m.charAt(0).toUpperCase() + m.slice(1) + '</label>';
    });
    html += '</div>';
    html += '<div class="card-title" style="margin-top:16px">Other Permissions</div><div class="perm-grid">' +
        '<label class="perm-item"><input type="checkbox" id="editPermDashboard"' + (p.dashboard ? ' checked' : '') + '> Dashboard Access</label>' +
        '<label class="perm-item"><input type="checkbox" id="editPermDownload"' + (p.download ? ' checked' : '') + '> Download/Export</label>' +
        '<label class="perm-item"><input type="checkbox" id="editPermDelete"' + (p.delete ? ' checked' : '') + '> Delete Access</label></div>';
    showModal('Edit User — ' + u.name, html, 'lg',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="updateUser(\'' + id + '\')"><i class="bx bx-check"></i> Update</button>');
}

function updateUser(id) {
    var password = document.getElementById('editUserPass').value.trim();
    var name = document.getElementById('editUserFullName').value.trim();
    var role = document.getElementById('editUserRole').value;
    if (!name) { showToast('Name is required', 'error'); return; }
    var modules = [];
    document.querySelectorAll('.perm-module:checked').forEach(function (cb) { modules.push(cb.value); });
    if (modules.length === 0) { showToast('Select at least one module', 'error'); return; }
    var updates = {
        name: name, role: role,
        permissions: {
            modules: modules,
            dashboard: document.getElementById('editPermDashboard').checked,
            download: document.getElementById('editPermDownload').checked,
            delete: document.getElementById('editPermDelete').checked
        }
    };
    if (password) updates.password = password;
    DB.update('users', id, updates);
    if (APP.currentUser && APP.currentUser.id === id) {
        APP.currentUser.name = name;
        APP.currentUser.role = role;
        APP.currentUser.permissions = updates.permissions;
        if (password) APP.currentUser.password = password;
        document.getElementById('userName').textContent = name;
        document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
    }
    logAction('Admin', 'EDIT_USER', 'User ' + name + ' updated');
    showToast('User updated', 'success');
    closeModal(); renderAdmin();
}

function deleteUser(id) {
    var u = DB.find('users', id);
    if (!u) return;
    var html = '<p style="margin-bottom:16px">Delete user <strong>' + escapeHtml(u.name) + '</strong> (' + escapeHtml(u.username) + ')?</p>' +
        '<p style="color:var(--warning);font-size:13px"><i class="bx bx-error"></i> This cannot be undone.</p>';
    showModal('Delete User', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-danger" onclick="confirmDeleteUser(\'' + id + '\')"><i class="bx bx-trash"></i> Delete</button>');
}

function confirmDeleteUser(id) {
    var u = DB.find('users', id);
    DB.remove('users', id);
    logAction('Admin', 'DELETE_USER', 'User ' + (u ? u.username : id) + ' deleted');
    showToast('User deleted', 'success');
    closeModal(); renderAdmin();
}

// ==================== SETTINGS ====================
function renderSettings() {
    var currentTheme = APP.theme;
    var html = '<div class="section-header"><h2><i class="bx bxs-cog"></i>Settings</h2></div>';
    html += '<div class="grid-2">';
    // Theme
    html += '<div class="card"><div class="card-title">Theme</div>' +
        '<div style="display:flex;gap:12px;margin-top:8px">' +
        '<button class="btn ' + (currentTheme === 'dark' ? 'btn-primary' : 'btn-secondary') + '" onclick="setTheme(\'dark\')"><i class="bx bx-moon"></i> Dark</button>' +
        '<button class="btn ' + (currentTheme === 'light' ? 'btn-primary' : 'btn-secondary') + '" onclick="setTheme(\'light\')"><i class="bx bx-sun"></i> Light</button>' +
        '</div></div>';
    // Company Logo
    html += '<div class="card"><div class="card-title">Company Logo</div>' +
        '<div style="text-align:center;padding:20px 0">' +
        '<div style="width:80px;height:80px;margin:0 auto 12px;background:linear-gradient(135deg,var(--accent),#00B87A);' +
        'clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);' +
        'display:flex;align-items:center;justify-content:center;font-size:32px;color:#050810">' +
        '<i class="bx bxs-building-house"></i></div>' +
        '<strong style="font-family:var(--font-display);font-size:14px;letter-spacing:2px">VIP INDUSTRIES LIMITED MD20</strong>' +
        '</div></div>';
    // Password Change
    html += '<div class="card"><div class="card-title">Change Password</div>' +
        '<div class="form-group" style="margin-bottom:12px"><label>Current Password</label><input type="password" id="setCurrPass" class="form-input" placeholder="Current password"></div>' +
        '<div class="form-group" style="margin-bottom:12px"><label>New Password</label><input type="password" id="setNewPass" class="form-input" placeholder="New password"></div>' +
        '<div class="form-group" style="margin-bottom:16px"><label>Confirm New Password</label><input type="password" id="setConfPass" class="form-input" placeholder="Confirm new password"></div>' +
        '<button class="btn btn-primary btn-sm" onclick="changePassword()"><i class="bx bx-lock"></i> Update Password</button></div>';
    // Backup & Restore
    html += '<div class="card"><div class="card-title">Backup & Restore</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">' +
        '<button class="btn btn-secondary btn-sm" onclick="backupData()"><i class="bx bx-download"></i> Download Backup</button>' +
        '<label class="btn btn-warning btn-sm" style="cursor:pointer;text-align:center"><i class="bx bx-upload"></i> Restore Backup' +
        '<input type="file" accept=".json" style="display:none" onchange="restoreData(this)"></label>' +
        '</div></div>';
    // Excel Templates
    html += '<div class="card"><div class="card-title">Excel Templates</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">' +
        '<button class="btn btn-secondary btn-sm" onclick="downloadTemplate(\'invoice\')"><i class="bx bx-file"></i> Invoice Material Template</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="downloadTemplate(\'location\')"><i class="bx bx-file"></i> Location Master Template</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="downloadTemplate(\'rack\')"><i class="bx bx-file"></i> Rack Master Template</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="downloadTemplate(\'material\')"><i class="bx bx-file"></i> Material Master Template</button>' +
        '</div></div>';
    // System Info
    html += '<div class="card"><div class="card-title">System Info</div>' +
        '<div style="font-size:13px;line-height:2">' +
        '<div><strong>System:</strong> VIP INDUSTRIES LIMITED MD20 WMS</div>' +
        '<div><strong>Version:</strong> 1.0.0</div>' +
        '<div><strong>Developer:</strong> Nikhil Patil</div>' +
        '<div><strong>Storage Used:</strong> ' + (JSON.stringify(localStorage).length / 1024).toFixed(1) + ' KB</div>' +
        '<div><strong>Total Records:</strong> ' + getTotalRecords() + '</div>' +
        '</div></div>';
    html += '</div>';
    document.getElementById('section-settings').innerHTML = html;
}

function getTotalRecords() {
    var keys = ['vehicles', 'invoices', 'invoice_materials', 'location_master', 'rack_master', 'material_master', 'users', 'audit_log', 'picking_reports', 'difference_reports'];
    var total = 0;
    keys.forEach(function (k) { total += DB.get(k).length; });
    return total;
}

function setTheme(theme) {
    APP.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('wms_theme', theme);
    var icon = document.querySelector('#themeToggle i');
    icon.className = theme === 'dark' ? 'bx bx-moon' : 'bx bx-sun';
    renderSettings();
}

function changePassword() {
    if (!APP.currentUser) return;
    var curr = document.getElementById('setCurrPass').value;
    var newP = document.getElementById('setNewPass').value;
    var conf = document.getElementById('setConfPass').value;
    if (curr !== APP.currentUser.password) { showToast('Current password is incorrect', 'error'); return; }
    if (newP.length < 4) { showToast('Password must be at least 4 characters', 'error'); return; }
    if (newP !== conf) { showToast('New passwords do not match', 'error'); return; }
    DB.update('users', APP.currentUser.id, { password: newP });
    APP.currentUser.password = newP;
    logAction('Settings', 'PASSWORD_CHANGE', 'Password changed');
    showToast('Password updated', 'success');
    document.getElementById('setCurrPass').value = '';
    document.getElementById('setNewPass').value = '';
    document.getElementById('setConfPass').value = '';
}

function backupData() {
    var data = {};
    var keys = ['vehicles', 'invoices', 'invoice_materials', 'location_master', 'rack_master', 'material_master', 'users', 'audit_log', 'picking_reports', 'difference_reports', 'notifications'];
    keys.forEach(function (k) { data[k] = DB.get(k); });
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'WMS_Backup_' + today() + '.json';
    a.click(); URL.revokeObjectURL(url);
    logAction('Settings', 'BACKUP', 'Data backup downloaded');
    showToast('Backup downloaded', 'success');
}

function restoreData(input) {
    var file = input.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            var data = JSON.parse(e.target.result);
            Object.keys(data).forEach(function (k) { DB.set(k, data[k]); });
            logAction('Settings', 'RESTORE', 'Data restored from backup');
            showToast('Data restored successfully. Reloading...', 'success');
            setTimeout(function () { location.reload(); }, 1500);
        } catch (err) { showToast('Invalid backup file', 'error'); }
    };
    reader.readAsText(file); input.value = '';
}

function downloadTemplate(type) {
    var wsData = [];
    if (type === 'invoice') wsData = [['Material', 'Qty'], ['VIP PREMIUM RICE 5KG', 50], ['VIP SUGAR 1KG', 100]];
    else if (type === 'location') wsData = [['Date', 'Rack', 'EAN', 'Material', 'Description', 'Quantity', 'Packing', 'Box', 'Action'], [today(), 'RACK-001', '8901234567001', 'VIP PREMIUM RICE 5KG', 'Premium Basmati Rice 5kg', 20, 'Bag', 'B001', 'UPLOAD']];
    else if (type === 'rack') wsData = [['Rack'], ['RACK-031'], ['RACK-032']];
    else if (type === 'material') wsData = [['Material', 'Description', 'Division', 'EAN', 'Brand'], ['VIP PREMIUM RICE 5KG', 'Premium Basmati Rice 5kg', 'Rice', '8901234567001', 'VIP']];
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Template_' + type + '.xlsx');
    showToast('Template downloaded', 'success');
}

// ==================== REPORTS ====================
function renderReports() {
    var html = '<div class="section-header"><h2><i class="bx bxs-bar-chart-alt-2"></i>Reports</h2></div>';
    html += '<div class="grid-3">';
    // Vehicle Report
    html += '<div class="card cyber-border"><div class="card-title">Vehicle Report</div>' +
        '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">All vehicles with status</p>' +
        '<div class="form-actions"><button class="btn btn-primary btn-sm" onclick="exportVehicleReport(\'excel\')"><i class="bx bx-download"></i> Excel</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportVehicleReport(\'pdf\')"><i class="bx bx-file"></i> PDF</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportVehicleReport(\'print\')"><i class="bx bx-printer"></i> Print</button></div></div>';
    // Location Report
    html += '<div class="card cyber-border"><div class="card-title">Location Report</div>' +
        '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">Complete location master data</p>' +
        '<div class="form-actions"><button class="btn btn-primary btn-sm" onclick="exportLocationExcel()"><i class="bx bx-download"></i> Excel</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportLocationPDF()"><i class="bx bx-file"></i> PDF</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="printLocation()"><i class="bx bx-printer"></i> Print</button></div></div>';
    // Material Report
    html += '<div class="card cyber-border"><div class="card-title">Material Report</div>' +
        '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">All materials in master</p>' +
        '<div class="form-actions"><button class="btn btn-primary btn-sm" onclick="exportMaterialExcel()"><i class="bx bx-download"></i> Excel</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportMaterialReportPDF()"><i class="bx bx-file"></i> PDF</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportMaterialReportPrint()"><i class="bx bx-printer"></i> Print</button></div></div>';
    // Difference Report
    html += '<div class="card cyber-border"><div class="card-title">Difference Report</div>' +
        '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">Qty mismatches from unload</p>' +
        '<div class="form-actions"><button class="btn btn-primary btn-sm" onclick="exportDiffReport(\'excel\')"><i class="bx bx-download"></i> Excel</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportDiffReport(\'pdf\')"><i class="bx bx-file"></i> PDF</button></div></div>';
    // Picking Report
    html += '<div class="card cyber-border"><div class="card-title">Picking Reports</div>' +
        '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">All picking reports</p>' +
        '<div class="form-actions"><button class="btn btn-primary btn-sm" onclick="showReportHistory()"><i class="bx bx-show"></i> View All</button></div></div>';
    // Audit Report
    html += '<div class="card cyber-border"><div class="card-title">Audit Report</div>' +
        '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">Complete audit trail</p>' +
        '<div class="form-actions"><button class="btn btn-primary btn-sm" onclick="exportAuditExcel()"><i class="bx bx-download"></i> Excel</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportAuditPDF()"><i class="bx bx-file"></i> PDF</button></div></div>';
    html += '</div>';
    document.getElementById('section-reports').innerHTML = html;
}

function exportVehicleReport(format) {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var vehicles = DB.get('vehicles');
    if (format === 'excel') {
        var wsData = [['Vehicle No', 'LR Number', 'Driver', 'Mobile', 'Transport', 'Status', 'Created']];
        vehicles.forEach(function (v) { wsData.push([v.vehicleNo, v.lrNo, v.driverName, v.driverMobile, v.transportName, v.status, formatDateTime(v.createdAt)]); });
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, 'Vehicles');
        XLSX.writeFile(wb, 'Vehicle_Report_' + today() + '.xlsx');
    } else if (format === 'pdf') {
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(16); doc.text('VIP INDUSTRIES LIMITED MD20 — Vehicle Report', 14, 15);
        doc.autoTable({
            head: [['Vehicle No', 'LR No', 'Driver', 'Mobile', 'Transport', 'Status']],
            body: vehicles.map(function (v) { return [v.vehicleNo, v.lrNo, v.driverName, v.driverMobile, v.transportName, v.status]; }),
            startY: 25, styles: { fontSize: 8 }, headStyles: { fillColor: [0, 180, 130] }
        });
        doc.save('Vehicle_Report_' + today() + '.pdf');
    } else {
        var html = '<html><head><title>Vehicle Report</title><style>body{font-family:Arial;font-size:11px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ddd;padding:6px 8px}th{background:#00B882;color:#fff}h1{font-size:18px}</style></head><body><h1>VIP INDUSTRIES LIMITED MD20 — Vehicle Report</h1><table><thead><tr><th>Vehicle</th><th>LR</th><th>Driver</th><th>Mobile</th><th>Transport</th><th>Status</th></tr></thead><tbody>';
        vehicles.forEach(function (v) { html += '<tr><td>' + escapeHtml(v.vehicleNo) + '</td><td>' + escapeHtml(v.lrNo) + '</td><td>' + escapeHtml(v.driverName) + '</td><td>' + escapeHtml(v.driverMobile) + '</td><td>' + escapeHtml(v.transportName) + '</td><td>' + escapeHtml(v.status) + '</td></tr>'; });
        html += '</tbody></table></body></html>';
        var w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.print();
    }
    showToast('Report exported', 'success');
}

function exportMaterialReportPDF() {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var materials = DB.get('material_master');
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(16); doc.text('VIP INDUSTRIES LIMITED MD20 — Material Master', 14, 15);
    doc.autoTable({
        head: [['Material', 'Description', 'Division', 'EAN', 'Brand']],
        body: materials.map(function (m) { return [m.material, m.description, m.division, m.ean, m.brand]; }),
        startY: 25, styles: { fontSize: 8 }, headStyles: { fillColor: [0, 180, 130] }
    });
    doc.save('Material_Master_' + today() + '.pdf');
    showToast('PDF exported', 'success');
}

function exportMaterialReportPrint() {
    var materials = DB.get('material_master');
    var html = '<html><head><title>Material Report</title><style>body{font-family:Arial;font-size:11px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ddd;padding:6px 8px}th{background:#00B882;color:#fff}h1{font-size:18px}</style></head><body><h1>VIP INDUSTRIES LIMITED MD20 — Material Report</h1><table><thead><tr><th>Material</th><th>Description</th><th>Division</th><th>EAN</th><th>Brand</th></tr></thead><tbody>';
    materials.forEach(function (m) { html += '<tr><td>' + escapeHtml(m.material) + '</td><td>' + escapeHtml(m.description) + '</td><td>' + escapeHtml(m.division) + '</td><td>' + escapeHtml(m.ean) + '</td><td>' + escapeHtml(m.brand) + '</td></tr>'; });
    html += '</tbody></table></body></html>';
    var w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.print();
}

function exportDiffReport(format) {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var diffs = DB.get('difference_reports');
    if (format === 'excel') {
        var wsData = [['Invoice No', 'Material', 'Expected', 'Actual', 'Difference', 'Status', 'Date']];
        diffs.forEach(function (d) { wsData.push([d.invoiceNo, d.material, d.expected, d.actual, d.diff, d.status, formatDateTime(d.createdAt)]); });
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsData), 'Differences');
        XLSX.writeFile(wb, 'Difference_Report_' + today() + '.xlsx');
    } else {
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(16); doc.text('VIP INDUSTRIES LIMITED MD20 — Difference Report', 14, 15);
        doc.autoTable({
            head: [['Invoice', 'Material', 'Expected', 'Actual', 'Diff', 'Status']],
            body: diffs.map(function (d) { return [d.invoiceNo, d.material, d.expected, d.actual, d.diff, d.status]; }),
            startY: 25, styles: { fontSize: 8 }, headStyles: { fillColor: [239, 68, 68] }
        });
        doc.save('Difference_Report_' + today() + '.pdf');
    }
    showToast('Report exported', 'success');
}

function exportAuditExcel() {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var logs = DB.get('audit_log');
    var wsData = [['Action No', 'Module', 'Action', 'Details', 'User', 'Date Time']];
    logs.forEach(function (l) { wsData.push([l.actionNo, l.module, l.action, l.details, l.userName, formatDateTime(l.dateTime)]); });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsData), 'Audit Log');
    XLSX.writeFile(wb, 'Audit_Log_' + today() + '.xlsx');
    showToast('Audit log exported', 'success');
}

function exportAuditPDF() {
    if (!checkPermType('download')) { showToast('No download permission', 'error'); return; }
    var logs = DB.get('audit_log');
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF('l', 'mm', 'a4');
    doc.setFontSize(16); doc.text('VIP INDUSTRIES LIMITED MD20 — Audit Log', 14, 15);
    doc.autoTable({
        head: [['Action No', 'Module', 'Action', 'Details', 'User', 'Date Time']],
        body: logs.map(function (l) { return [l.actionNo, l.module, l.action, l.details, l.userName, formatDateTime(l.dateTime)]; }),
        startY: 25, styles: { fontSize: 7 }, headStyles: { fillColor: [0, 180, 130] }
    });
    doc.save('Audit_Log_' + today() + '.pdf');
    showToast('Audit log exported', 'success');
}

// ==================== AUDIT LOG ====================
function renderAuditLog() {
    var logs = DB.get('audit_log').reverse();
    var searchAction = document.getElementById('auditSearchAction') ? document.getElementById('auditSearchAction').value.trim().toUpperCase() : '';
    var searchModule = document.getElementById('auditSearchModule') ? document.getElementById('auditSearchModule').value.trim().toLowerCase() : '';
    var filtered = logs;
    if (searchAction) filtered = filtered.filter(function (l) { return l.actionNo.toUpperCase().indexOf(searchAction) > -1; });
    if (searchModule) filtered = filtered.filter(function (l) { return l.module.toLowerCase().indexOf(searchModule) > -1; });
    var pg = paginate(filtered, APP.auditPage, APP.auditPerPage);
    var html = '<div class="section-header"><h2><i class="bx bxs-receipt"></i>Audit Log</h2>' +
        '<button class="btn btn-secondary btn-sm" onclick="exportAuditExcel()"><i class="bx bx-download"></i> Export Excel</button></div>';
    html += '<div class="card" style="margin-bottom:16px"><div class="form-row">' +
        '<div class="form-group"><label>Search by Action Number</label><input type="text" id="auditSearchAction" class="form-input" placeholder="e.g. ACT-XXXX" value="' + escapeHtml(searchAction) + '"></div>' +
        '<div class="form-group"><label>Search by Module</label><input type="text" id="auditSearchModule" class="form-input" placeholder="e.g. Inbound" value="' + escapeHtml(searchModule) + '"></div>' +
        '<div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-primary btn-sm" onclick="APP.auditPage=1;renderAuditLog()"><i class="bx bx-search"></i> Search</button></div>' +
        '</div></div>';
    html += '<div class="card"><div class="card-title">Audit Entries (' + pg.total + ')</div><div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Action No</th><th>Module</th><th>Action</th><th>Details</th><th>User</th><th>Date Time</th></tr></thead><tbody>';
    if (pg.items.length === 0) {
        html += '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">No records found</td></tr>';
    } else {
        pg.items.forEach(function (l) {
            html += '<tr style="cursor:pointer" onclick="showAuditDetail(\'' + l.actionNo + '\')">' +
                '<td><span style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(l.actionNo) + '</span></td>' +
                '<td>' + escapeHtml(l.module) + '</td><td>' + escapeHtml(l.action) + '</td>' +
                '<td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(l.details) + '</td>' +
                '<td>' + escapeHtml(l.userName) + '</td>' +
                '<td style="font-size:12px;color:var(--text-muted)">' + formatDateTime(l.dateTime) + '</td></tr>';
        });
    }
    html += '</tbody></table></div>' + renderPagination(APP.auditPage, pg.pages, 'goAuditPage') + '</div>';
    document.getElementById('section-audit').innerHTML = html;
}

function goAuditPage(p) { APP.auditPage = p; renderAuditLog(); }

function showAuditDetail(actionNo) {
    var logs = DB.get('audit_log').filter(function (l) { return l.actionNo === actionNo; });
    var html = '<div style="margin-bottom:16px"><strong style="font-family:var(--font-display);color:var(--accent);font-size:16px">' + escapeHtml(actionNo) + '</strong></div>';
    if (logs.length === 0) {
        html += '<p style="color:var(--text-muted)">No history found for this action number.</p>';
    } else {
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Module</th><th>Action</th><th>Details</th><th>User</th><th>Date Time</th></tr></thead><tbody>';
        logs.forEach(function (l) {
            html += '<tr><td>' + escapeHtml(l.module) + '</td><td>' + escapeHtml(l.action) + '</td><td>' + escapeHtml(l.details) + '</td><td>' + escapeHtml(l.userName) + '</td><td>' + formatDateTime(l.dateTime) + '</td></tr>';
        });
        html += '</tbody></table></div>';
    }
    showModal('Audit Detail — ' + actionNo, html, 'lg');
}

// ==================== SCAN SIMULATION ====================
function simulateScan(inputId) {
    var materials = DB.get('material_master');
    var racks = DB.get('rack_master');
    var input = document.getElementById(inputId);
    if (!input) return;

    if (inputId.indexOf('Rack') > -1 || inputId.indexOf('rack') > -1) {
        var randomRack = racks[Math.floor(Math.random() * racks.length)];
        if (randomRack) {
            input.value = randomRack.rack;
            input.dispatchEvent(new Event('input'));
            showToast('Rack scanned: ' + randomRack.rack, 'info');
        }
    } else {
        var randomMat = materials[Math.floor(Math.random() * materials.length)];
        if (randomMat) {
            input.value = randomMat.ean;
            input.dispatchEvent(new Event('input'));
            showToast('EAN scanned: ' + randomMat.ean + ' — ' + randomMat.material, 'info');
        }
    }
}

// ==================== GLOBAL SEARCH ====================
// Ye globalSearch function POORA replace karo pichle wale se
function globalSearch(query) {
    query = query.trim().toLowerCase();
    if (!query || query.length < 2) return;
    var results = [];
    DB.get('material_master').forEach(function (m) {
        if (m.material.toLowerCase().indexOf(query) > -1 || m.ean.toLowerCase().indexOf(query) > -1 || (m.brand && m.brand.toLowerCase().indexOf(query) > -1)) {
            results.push({ type: 'Material', name: m.material, sub: m.ean, section: 'material' });
        }
    });
    DB.get('location_master').forEach(function (l) {
        if (l.material.toLowerCase().indexOf(query) > -1 || l.rack.toLowerCase().indexOf(query) > -1 || l.ean.toLowerCase().indexOf(query) > -1) {
            results.push({ type: 'Location', name: l.material, sub: l.rack, section: 'location' });
        }
    });
    DB.get('vehicles').forEach(function (v) {
        if (v.vehicleNo.toLowerCase().indexOf(query) > -1 || v.driverName.toLowerCase().indexOf(query) > -1) {
            results.push({ type: 'Vehicle', name: v.vehicleNo, sub: v.status, section: 'inbound' });
        }
    });
    DB.get('rack_master').forEach(function (r) {
        if (r.rack.toLowerCase().indexOf(query) > -1) {
            results.push({ type: 'Rack', name: r.rack, sub: '', section: 'rack' });
        }
    });
    DB.get('audit_log').forEach(function (a) {
        if (a.actionNo.toLowerCase().indexOf(query) > -1 || a.details.toLowerCase().indexOf(query) > -1) {
            results.push({ type: 'Audit', name: a.actionNo, sub: a.action, section: 'audit' });
        }
    });
    if (results.length === 0) {
        showToast('No results found for "' + query + '"', 'warning');
        return;
    }
    var html = '<div class="card-title">Search Results (' + results.length + ')</div><div class="table-wrapper"><table class="data-table">' +
        '<thead><tr><th>Type</th><th>Name</th><th>Details</th><th>Action</th></tr></thead><tbody>';
    results.slice(0, 20).forEach(function (r) {
        var badge = 'badge-info';
        if (r.type === 'Material') badge = 'badge-accent';
        else if (r.type === 'Vehicle') badge = 'badge-warning';
        else if (r.type === 'Rack') badge = 'badge-success';
        else if (r.type === 'Audit') badge = 'badge-danger';
        html += '<tr><td><span class="badge ' + badge + '">' + escapeHtml(r.type) + '</span></td>' +
            '<td>' + escapeHtml(r.name) + '</td><td style="color:var(--text-muted)">' + escapeHtml(r.sub) + '</td>' +
            '<td><button class="btn btn-secondary btn-sm" onclick="closeModal();navigateTo(\'' + r.section + '\')"><i class="bx bx-show"></i> Go</button></td></tr>';
    });
    html += '</tbody></table></div>';
    showModal('Search Results — "' + escapeHtml(query) + '"', html, 'lg');
    document.getElementById('searchInput').value = '';
}

// ==================== SIDEBAR ====================
function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('open');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
}
document.getElementById('menuToggle').addEventListener('click', function () {
    var sb = document.getElementById('sidebar');
    if (sb.classList.contains('open')) { closeSidebar(); } else { openSidebar(); }
});
document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

// ==================== NOTIFICATION PANEL ====================
document.getElementById('notifBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    var panel = document.getElementById('notifPanel');
    var dd = document.getElementById('userDropdown');
    dd.classList.remove('open');
    if (panel.classList.contains('open')) { panel.classList.remove('open'); }
    else { renderNotifPanel(); panel.classList.add('open'); }
});
document.getElementById('clearNotifs').addEventListener('click', function () {
    DB.set('notifications', []);
    updateNotifBadge();
    renderNotifPanel();
    showToast('Notifications cleared', 'success');
});

// ==================== USER DROPDOWN ====================
document.getElementById('userMenu').addEventListener('click', function (e) {
    e.stopPropagation();
    var dd = document.getElementById('userDropdown');
    var panel = document.getElementById('notifPanel');
    panel.classList.remove('open');
    dd.classList.toggle('open');
});
document.getElementById('ddLogout').addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    document.getElementById('userDropdown').classList.remove('open');
    logout();
});
document.getElementById('ddPassword').addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    document.getElementById('userDropdown').classList.remove('open');
    navigateTo('settings');
});
document.getElementById('ddProfile').addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    document.getElementById('userDropdown').classList.remove('open');
    if (APP.currentUser) {
        showModal('Profile', '<div style="text-align:center;padding:20px">' +
            '<div style="width:70px;height:70px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#00B87A);' +
            'display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#050810;margin:0 auto 16px">' +
            escapeHtml(APP.currentUser.name.charAt(0)) + '</div>' +
            '<h3 style="margin-bottom:4px">' + escapeHtml(APP.currentUser.name) + '</h3>' +
            '<p style="color:var(--text-muted);font-size:13px">' + escapeHtml(APP.currentUser.role) + '</p>' +
            '<p style="color:var(--text-muted);font-size:12px;margin-top:8px">@' + escapeHtml(APP.currentUser.username) + '</p></div>');
    }
});

// Close dropdowns on outside click
document.addEventListener('click', function () {
    document.getElementById('userDropdown').classList.remove('open');
    document.getElementById('notifPanel').classList.remove('open');
});

// ==================== THEME TOGGLE ====================
document.getElementById('themeToggle').addEventListener('click', function () {
    setTheme(APP.theme === 'dark' ? 'light' : 'dark');
});

// ==================== NAV CLICK HANDLERS ====================
document.querySelectorAll('.nav-item[data-section]').forEach(function (item) {
    item.addEventListener('click', function (e) {
        e.preventDefault();
        var section = this.getAttribute('data-section');
        if (this.classList.contains('has-sub')) {
            this.classList.toggle('open');
            var sub = this.nextElementSibling;
            if (sub && sub.classList.contains('nav-sub')) {
                sub.classList.toggle('open');
            }
            if (!this.classList.contains('open') || section === 'inbound') {
                navigateTo(section, 'vehicle-entry');
            }
        } else {
            navigateTo(section);
        }
    });
});
document.querySelectorAll('.nav-sub-item[data-sub]').forEach(function (item) {
    item.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var sub = this.getAttribute('data-sub');
        navigateTo('inbound', sub);
    });
});

// ==================== LOGIN FORM ====================
document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var username = document.getElementById('loginUser').value.trim();
    var password = document.getElementById('loginPass').value;
    if (!username || !password) { showToast('Enter username and password', 'error'); return; }
    showLoader();
    setTimeout(function () {
        var success = login(username, password);
        hideLoader();
        if (success) {
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('mainApp').style.display = 'flex';
            document.getElementById('userName').textContent = APP.currentUser.name;
            document.getElementById('userAvatar').textContent = APP.currentUser.name.charAt(0).toUpperCase();
            updateNotifBadge();
            navigateTo('dashboard');
            showToast('Welcome, ' + APP.currentUser.name + '!', 'success');
        } else {
            showToast('Invalid username or password', 'error');
        }
    }, 800);
});

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        document.getElementById('searchInput').focus();
    }
    if (e.key === 'Escape') {
        closeModal();
        document.getElementById('userDropdown').classList.remove('open');
        document.getElementById('notifPanel').classList.remove('open');
    }
});

// Global search on Enter
document.getElementById('searchInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        globalSearch(this.value);
    }
});

// ==================== SESSION TIMEOUT ====================
function checkSessionTimeout() {
    if (!APP.sessionStart) return;
    var elapsed = Date.now() - APP.sessionStart;
    var remaining = APP.SESSION_TIMEOUT - elapsed;
    if (remaining <= 0) {
        showToast('Session expired. Please login again.', 'warning');
        logout();
    } else if (remaining <= APP.WARNING_BEFORE) {
        var mins = Math.ceil(remaining / 60000);
        showToast('Session will expire in ' + mins + ' minute(s)', 'warning');
    }
}
setInterval(checkSessionTimeout, 60000);

// ==================== MATRIX RAIN ANIMATION ====================
function initMatrixRain() {
    var canvas = document.getElementById('matrixCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    var chars = 'VIPINDUSTRYMD200123456789ABCDEF';
    var fontSize = 14;
    var columns = Math.floor(canvas.width / fontSize);
    var drops = [];
    for (var i = 0; i < columns; i++) {
        drops[i] = Math.random() * -100;
    }
    function draw() {
        ctx.fillStyle = 'rgba(5, 8, 16, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#00E5A0';
        ctx.font = fontSize + 'px monospace';
        for (var i = 0; i < drops.length; i++) {
            var text = chars[Math.floor(Math.random() * chars.length)];
            ctx.globalAlpha = 0.15 + Math.random() * 0.3;
            ctx.fillText(text, i * fontSize, drops[i] * fontSize);
            if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
                drops[i] = 0;
            }
            drops[i]++;
        }
        ctx.globalAlpha = 1;
    }
    var matrixInterval = setInterval(draw, 50);
    window.addEventListener('resize', function () {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        columns = Math.floor(canvas.width / fontSize);
        drops = [];
        for (var j = 0; j < columns; j++) { drops[j] = Math.random() * -100; }
    });
    // Stop animation after login
    var origLogin = document.getElementById('loginForm').onsubmit;
    var stopMatrix = function () {
        clearInterval(matrixInterval);
    };
    document.getElementById('loginForm').addEventListener('submit', stopMatrix);
}

// ==================== MOBILE CAMERA SCANNER ====================
function openCameraScanner(targetInputId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Camera not supported on this device', 'error');
        return;
    }
    var html = '<div style="text-align:center">' +
        '<video id="cameraVideo" autoplay playsinline style="width:100%;max-width:400px;border-radius:8px;background:#000;min-height:250px"></video>' +
        '<p style="color:var(--text-muted);font-size:12px;margin-top:10px">Point camera at barcode/QR code</p>' +
        '</div>';
    showModal('Camera Scanner', html, '',
        '<button class="btn btn-secondary" onclick="stopCamera();closeModal()">Cancel</button>');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
        var video = document.getElementById('cameraVideo');
        video.srcObject = stream;
        video.play();
        window._cameraStream = stream;
    }).catch(function (err) {
        showToast('Camera access denied', 'error');
        closeModal();
    });
}
function stopCamera() {
    if (window._cameraStream) {
        window._cameraStream.getTracks().forEach(function (t) { t.stop(); });
        window._cameraStream = null;
    }
}

// ==================== APP INITIALIZATION ====================
function initApp() {
    // Load theme
    var savedTheme = localStorage.getItem('wms_theme') || 'dark';
    APP.theme = savedTheme;
    document.documentElement.setAttribute('data-theme', savedTheme);
    var themeIcon = document.querySelector('#themeToggle i');
    if (themeIcon) themeIcon.className = savedTheme === 'dark' ? 'bx bx-moon' : 'bx bx-sun';

    // Seed initial data
    seedData();

    // Check for existing session
    if (checkSession()) {
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        document.getElementById('userName').textContent = APP.currentUser.name;
        document.getElementById('userAvatar').textContent = APP.currentUser.name.charAt(0).toUpperCase();
        updateNotifBadge();
        navigateTo('dashboard');
    } else {
        // Show login with matrix animation
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
        initMatrixRain();
    }

    // Session timeout check
    checkSessionTimeout();
}

// ==================== START APP ====================
document.addEventListener('DOMContentLoaded', initApp);