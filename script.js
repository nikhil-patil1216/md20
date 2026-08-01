/* ============================================================
   VIP INDUSTRIES LIMITED MD20 — WMS COMPLETE SCRIPT
   Developed by Nikhil Patil
   PART 1: Core Infrastructure + Complete Inbound Flow
   ============================================================ */

// ==================== SUPABASE SYNC ====================
let supabaseClient = null;
try {
    const SUPABASE_URL = 'https://whlqsapzywnadvkhfhzp.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobHFzYXB6eXduYWR2a2hmaHpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE4ODMsImV4cCI6MjEwMDczNzg4M30.YaNFKPQ9vmhKHYa0DtaZPbbM44IqgSlibPSABId_bno';
    if (typeof supabase !== 'undefined' && SUPABASE_URL.includes('supabase.co')) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch(e) {}

async function pushServerData(key, value) {
    if (!supabaseClient) return;
    try { await supabaseClient.from('app_data').upsert({ key: key, value: value }, { onConflict: 'key' }); } catch(e) {}
}

async function pullAllServerData() {
    if (!supabaseClient) return;
    try {
        var tables = ['users','location_master','material_master','rack_master','vehicles','invoices','invoice_materials','picking_reports','audit_log','notifications','difference_reports','obd_data','picking_assignments','loading_assignments','loading_data','user_sessions','grn_records','short_reports','receiving_docs','loaded_vehicles','picking_done','loading_users'];
        for (var i = 0; i < tables.length; i++) {
            var t = tables[i];
            var res = await supabaseClient.from('app_data').select('value').eq('key', t).single();
            if (res.data && res.data.value) {
                localStorage.setItem('wms_' + t, JSON.stringify(res.data.value));
            }
        }
    } catch(e) {}
}

// Real-time sync
if (supabaseClient) {
    try {
        supabaseClient.channel('db-live-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_data' }, function(payload) {
            if (payload.new && payload.new.key && payload.new.value) {
                localStorage.setItem('wms_' + payload.new.key, JSON.stringify(payload.new.value));
                if (APP.currentUser && APP.currentSection) {
                    renderSection(APP.currentSection, APP.currentSub);
                    showToast('Live Update: Data changed by another user', 'info');
                }
            }
        }).subscribe();
    } catch(e) {}
}

// ==================== STATE ====================
var APP = {
    currentUser: null,
    currentSection: 'dashboard',
    currentSub: null,
    theme: localStorage.getItem('wms_theme') || 'dark',
    sessionStart: null,
    SESSION_TIMEOUT: 30 * 60 * 1000,
    WARNING_BEFORE: 5 * 60 * 1000,
    locPage: 1, locPerPage: 15,
    auditPage: 1, auditPerPage: 15,
    reportPage: 1, reportPerPage: 15,
    matPage: 1, matPerPage: 15
};

// ==================== DATABASE LAYER ====================
var DB = {
    _key: function(k) { return 'wms_' + k; },
    get: function(k) { try { return JSON.parse(localStorage.getItem(this._key(k)) || '[]'); } catch(e) { return []; } },
    getObj: function(k) { try { return JSON.parse(localStorage.getItem(this._key(k)) || '{}'); } catch(e) { return {}; } },
    set: function(k, v) { localStorage.setItem(this._key(k), JSON.stringify(v)); pushServerData(k, v); },
    add: function(k, item) {
        var data = this.get(k);
        item.id = item.id || this.uid();
        item.createdAt = item.createdAt || new Date().toISOString();
        data.push(item);
        this.set(k, data);
        return item;
    },
    update: function(k, id, updates) {
        var data = this.get(k);
        var idx = -1;
        for (var i = 0; i < data.length; i++) { if (data[i].id === id) { idx = i; break; } }
        if (idx > -1) {
            for (var key in updates) { data[idx][key] = updates[key]; }
            data[idx].updatedAt = new Date().toISOString();
            this.set(k, data);
            return data[idx];
        }
        return null;
    },
    remove: function(k, id) { var data = this.get(k).filter(function(d) { return d.id !== id; }); this.set(k, data); },
    find: function(k, id) { return this.get(k).filter(function(d) { return d.id === id; })[0] || null; },
    filter: function(k, fn) { return this.get(k).filter(fn); },
    count: function(k, fn) { return fn ? this.get(k).filter(fn).length : this.get(k).length; },
    uid: function() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); },
    actionNo: function() { return 'ACT-' + Date.now().toString(36).toUpperCase(); },
    reportNo: function() { return 'PR-' + new Date().getFullYear() + '-' + String(this.count('picking_reports') + 1).padStart(4, '0'); },
    grnNo: function(invNo) { return 'GRN-' + (invNo || 'XXXX').replace(/\s/g, ''); },
    shortNo: function() { return 'SRT-' + new Date().getFullYear() + '-' + String(this.count('short_reports') + 1).padStart(4, '0'); },
    rcvNo: function() { return 'RCV-' + Date.now().toString(36).toUpperCase().substr(0, 8); },
    loadNo: function(obdNo) { return 'LOAD-' + (obdNo || 'XXXX').replace(/\s/g, ''); }
};

// ==================== UTILITIES ====================
function formatDate(d) {
    if (!d) return '-';
    var dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(d) {
    if (!d) return '-';
    var dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
        dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function today() { return new Date().toISOString().split('T')[0]; }
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
}
function paginate(arr, page, perPage) {
    var start = (page - 1) * perPage;
    return { items: arr.slice(start, start + perPage), total: arr.length, pages: Math.ceil(arr.length / perPage) || 1 };
}
function renderPagination(currentPage, totalPages, onClickFn) {
    if (totalPages <= 1) return '';
    var html = '<div class="pagination">';
    html += '<button class="page-btn" onclick="' + onClickFn + '(' + (currentPage - 1) + ')" ' + (currentPage <= 1 ? 'disabled' : '') + '><i class="bx bx-chevron-left"></i></button>';
    for (var i = 1; i <= totalPages; i++) {
        if (totalPages > 7 && i > 3 && i < totalPages - 2 && Math.abs(i - currentPage) > 1) {
            if (i === 4 || i === totalPages - 3) html += '<span style="color:var(--text-muted);padding:0 4px">...</span>';
            continue;
        }
        html += '<button class="page-btn ' + (i === currentPage ? 'active' : '') + '" onclick="' + onClickFn + '(' + i + ')">' + i + '</button>';
    }
    html += '<button class="page-btn" onclick="' + onClickFn + '(' + (currentPage + 1) + ')" ' + (currentPage >= totalPages ? 'disabled' : '') + '><i class="bx bx-chevron-right"></i></button>';
    html += '</div>';
    return html;
}

// ==================== TOAST ====================
function showToast(msg, type) {
    type = type || 'info';
    var icons = { success: 'bx-check-circle', error: 'bx-error-circle', warning: 'bx-error', info: 'bx-info-circle' };
    var container = document.getElementById('toastContainer');
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = '<i class="bx ' + (icons[type] || icons.info) + '"></i><span>' + escapeHtml(msg) + '</span>';
    container.appendChild(toast);
    setTimeout(function() {
        toast.classList.add('removing');
        setTimeout(function() { toast.remove(); }, 300);
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
        '<div class="modal-header"><h3>' + title + '</h3>' +
        '<button class="modal-close" onclick="closeModal()"><i class="bx bx-x"></i></button></div>' +
        '<div class="modal-body">' + bodyHtml + '</div>' +
        (footerHtml ? '<div class="modal-footer">' + footerHtml + '</div>' : '');
    overlay.classList.add('open');
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
document.getElementById('modalOverlay').addEventListener('click', function(e) { if (e.target === this) closeModal(); });

// ==================== LOADER ====================
function showLoader() { document.getElementById('pageLoader').style.display = 'flex'; }
function hideLoader() { document.getElementById('pageLoader').style.display = 'none'; }

// ==================== AUDIT LOG ====================
function logAction(module, action, details) {
    DB.add('audit_log', {
        actionNo: DB.actionNo(), module: module, action: action, details: details,
        userId: APP.currentUser ? APP.currentUser.id : 'system',
        userName: APP.currentUser ? APP.currentUser.name : 'System',
        dateTime: new Date().toISOString()
    });
}

// ==================== NOTIFICATIONS ====================
function addNotification(msg, type, targetUser) {
    type = type || 'info';
    var notifs = DB.get('notifications');
    notifs.unshift({ id: DB.uid(), message: msg, type: type, read: false, dateTime: new Date().toISOString(), targetUser: targetUser || null });
    if (notifs.length > 100) notifs.length = 100;
    DB.set('notifications', notifs);
    updateNotifBadge();
}
function updateNotifBadge() {
    var count = 0;
    var notifs = DB.get('notifications');
    for (var i = 0; i < notifs.length; i++) {
        if (!notifs[i].read) count++;
    }
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
    var show = notifs.slice(0, 30);
    for (var i = 0; i < show.length; i++) {
        var n = show[i];
        html += '<div class="notif-item ' + (n.read ? '' : 'unread') + '" style="cursor:pointer" onclick="handleNotifClick(\'' + escapeHtml(n.message) + '\')">' +
            '<div>' + escapeHtml(n.message) + '</div>' +
            '<div class="notif-time">' + formatDateTime(n.dateTime) + '</div></div>';
    }
    list.innerHTML = html;
    // Mark all as read
    var all = DB.get('notifications');
    for (var j = 0; j < all.length; j++) { all[j].read = true; }
    DB.set('notifications', all);
    updateNotifBadge();
}
function handleNotifClick(msg) {
    document.getElementById('notifPanel').classList.remove('open');
    // Smart navigation based on notification content
    if (msg.indexOf('Approval') > -1 || msg.indexOf('approve') > -1) {
        navigateTo('inbound', 'pending-vehicle');
    } else if (msg.indexOf('Vehicle') > -1) {
        navigateTo('inbound', 'pending-vehicle');
    } else if (msg.indexOf('Picking') > -1) {
        navigateTo('picking', 'picking-done');
    } else if (msg.indexOf('Loading') > -1) {
        navigateTo('loading', 'loading-done');
    } else {
        navigateTo('dashboard');
    }
}

// ==================== SEED DATA ====================
function seedData() {
    if (DB.get('users').length > 0) return;
    DB.set('users', [
        { id: 'u1', username: 'superadmin', password: 'super123', name: 'Super Admin', role: 'Super Admin', permissions: { modules: ['all'], actions: { canSecurityEntry: true, canUploadInvoice: true, canAssignVehicle: true, canStartUnloading: true, canPostVehicle: true, canApprove: true, canViewReports: true, canPutaway: true, canPIV: true, canPick: true, canLoad: true, canAdmin: true } } },
        { id: 'u2', username: 'admin', password: 'admin123', name: 'Warehouse Admin', role: 'Admin', permissions: { modules: ['all'], actions: { canSecurityEntry: false, canUploadInvoice: true, canAssignVehicle: true, canStartUnloading: true, canPostVehicle: true, canApprove: true, canViewReports: true, canPutaway: true, canPIV: true, canPick: true, canLoad: true, canAdmin: true } } },
        { id: 'u3', username: 'manager', password: 'mgr123', name: 'Warehouse Manager', role: 'Manager', permissions: { modules: ['dashboard','inbound','reports','audit','picking','loading'], actions: { canSecurityEntry: false, canUploadInvoice: true, canAssignVehicle: true, canStartUnloading: false, canPostVehicle: false, canApprove: true, canViewReports: true, canPutaway: false, canPIV: false, canPick: true, canLoad: true, canAdmin: false } } },
        { id: 'u4', username: 'deo', password: 'deo123', name: 'Data Entry Operator', role: 'DEO', permissions: { modules: ['inbound'], actions: { canSecurityEntry: false, canUploadInvoice: true, canAssignVehicle: true, canStartUnloading: false, canPostVehicle: false, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: false, canLoad: false, canAdmin: false } } },
        { id: 'u5', username: 'security', password: 'sec123', name: 'Security Guard', role: 'Security', permissions: { modules: ['security-gate'], actions: { canSecurityEntry: true, canUploadInvoice: false, canAssignVehicle: false, canStartUnloading: false, canPostVehicle: false, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: false, canLoad: false, canAdmin: false } } },
        { id: 'u6', username: 'unloader', password: 'unl123', name: 'Unloading User', role: 'Unloading User', permissions: { modules: ['unloading-screen'], actions: { canSecurityEntry: false, canUploadInvoice: false, canAssignVehicle: false, canStartUnloading: true, canPostVehicle: true, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: false, canLoad: false, canAdmin: false } } },
        { id: 'u7', username: 'picker', password: 'pick123', name: 'Picker User', role: 'Picker', permissions: { modules: ['picking'], actions: { canSecurityEntry: false, canUploadInvoice: false, canAssignVehicle: false, canStartUnloading: false, canPostVehicle: false, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: true, canLoad: false, canAdmin: false } } },
        { id: 'u8', username: 'loader', password: 'load123', name: 'Loading User', role: 'Loader', permissions: { modules: ['loading'], actions: { canSecurityEntry: false, canUploadInvoice: false, canAssignVehicle: false, canStartUnloading: false, canPostVehicle: false, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: false, canLoad: true, canAdmin: false } } }
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
    for (var i = 0; i < materials.length; i++) { DB.add('material_master', materials[i]); }
    for (var r = 1; r <= 30; r++) { DB.add('rack_master', { rack: 'RACK-' + String(r).padStart(3, '0') }); }
    DB.add('vehicles', { id: 'v1', vehicleNo: 'MH-12-AB-1234', lrNo: 'LR-2025-001', driverName: 'Rajesh Kumar', driverMobile: '9876543210', transportName: 'Fast Cargo', vehicleType: 'Unloading', status: 'Unloaded', reportedAt: new Date().toISOString() });
    DB.add('vehicles', { id: 'v2', vehicleNo: 'GJ-05-CD-5678', lrNo: 'LR-2025-002', driverName: 'Amit Patel', driverMobile: '9123456789', transportName: 'Green Logistics', vehicleType: 'Unloading', status: 'Unload Pending', reportedAt: new Date().toISOString() });
    DB.add('vehicles', { id: 'v3', vehicleNo: 'RJ-14-EF-9012', lrNo: 'LR-2025-003', driverName: 'Suresh Meena', driverMobile: '9988776655', transportName: 'Rajput Transport', vehicleType: 'Unloading', status: 'Unload Pending', reportedAt: new Date().toISOString() });
    DB.add('invoices', { id: 'inv1', vehicleId: 'v2', invoiceNo: 'INV-2025-101', status: 'Pending' });
    DB.add('invoice_materials', { id: 'im1', invoiceId: 'inv1', material: 'VIP PREMIUM RICE 5KG', ean: '8901234567001', qty: 50, unloadedQty: 0 });
    DB.add('invoice_materials', { id: 'im2', invoiceId: 'inv1', material: 'VIP GOLD WHEAT 10KG', ean: '8901234567002', qty: 30, unloadedQty: 0 });
    DB.add('invoice_materials', { id: 'im3', invoiceId: 'inv1', material: 'VIP SUGAR 1KG', ean: '8901234567003', qty: 100, unloadedQty: 0 });
    DB.add('invoices', { id: 'inv2', vehicleId: 'v2', invoiceNo: 'INV-2025-102', status: 'Pending' });
    DB.add('invoice_materials', { id: 'im4', invoiceId: 'inv2', material: 'VIP DAL TOOR 1KG', ean: '8901234567004', qty: 80, unloadedQty: 0 });
    DB.add('invoice_materials', { id: 'im5', invoiceId: 'inv2', material: 'VIP SALT 1KG', ean: '8901234567005', qty: 120, unloadedQty: 0 });
    DB.add('invoices', { id: 'inv3', vehicleId: 'v3', invoiceNo: 'INV-2025-103', status: 'Pending' });
    DB.add('invoice_materials', { id: 'im6', invoiceId: 'inv3', material: 'VIP OIL SUNFLOWER 1L', ean: '8901234567006', qty: 60, unloadedQty: 0 });
    DB.add('invoice_materials', { id: 'im7', invoiceId: 'inv3', material: 'VIP TEA 500G', ean: '8901234567007', qty: 40, unloadedQty: 0 });
    var locData = [
        { rack: 'RACK-001', ean: '8901234567001', material: 'VIP PREMIUM RICE 5KG', description: 'Premium Basmati Rice 5kg Pack', quantity: 20, packing: 'Bag', box: 'B001', action: 'PUTAWAY' },
        { rack: 'RACK-002', ean: '8901234567002', material: 'VIP GOLD WHEAT 10KG', description: 'Golden Wheat Atta 10kg', quantity: 15, packing: 'Bag', box: 'B002', action: 'PUTAWAY' },
        { rack: 'RACK-003', ean: '8901234567003', material: 'VIP SUGAR 1KG', description: 'Refined Sugar 1kg Pack', quantity: 50, packing: 'Box', box: 'B003', action: 'PUTAWAY' },
        { rack: 'RACK-005', ean: '8901234567004', material: 'VIP DAL TOOR 1KG', description: 'Toor Dal 1kg Pack', quantity: 30, packing: 'Bag', box: 'B004', action: 'PIV' },
        { rack: 'RACK-007', ean: '8901234567006', material: 'VIP OIL SUNFLOWER 1L', description: 'Sunflower Oil 1 Litre', quantity: 25, packing: 'Bottle', box: 'B005', action: 'PUTAWAY' },
        { rack: 'RACK-009', ean: '8901234567007', material: 'VIP TEA 500G', description: 'Premium Tea 500g', quantity: 18, packing: 'Box', box: 'B006', action: 'PIV' }
    ];
    for (var j = 0; j < locData.length; j++) {
        var l = locData[j];
        DB.add('location_master', { date: today(), rack: l.rack, ean: l.ean, material: l.material, description: l.description, quantity: l.quantity, packing: l.packing, box: l.box, action: l.action, user: 'Admin', dateTime: new Date().toISOString() });
    }
    addNotification('Vehicle GJ-05-CD-5678 arrived — Pending Unload', 'warning');
    addNotification('Vehicle RJ-14-EF-9012 arrived — Pending Unload', 'warning');
    logAction('System', 'INIT', 'System initialized with seed data');
}

// ==================== AUTH ====================
function login(username, password) {
    // Fast user sync from server (max 3 sec, then local login)
    try {
        if (supabaseClient) {
            var userPromise = supabaseClient.from('app_data').select('value').eq('key', 'users');
            var timeoutPromise = new Promise(function(_, reject) { setTimeout(function() { reject(new Error('Timeout')); }, 3000); });
            Promise.race([userPromise, timeoutPromise]).then(function(res) {
                if (res.data && res.data.length > 0 && res.data[0].value) {
                    localStorage.setItem('wms_users', JSON.stringify(res.data[0].value));
                }
            }).catch(function() {});
        }
    } catch(e) {}

    var users = DB.get('users');
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].username === username && users[i].password === password) { user = users[i]; break; }
    }
    if (!user) { showToast('Invalid username or password', 'error'); return false; }
    APP.currentUser = user;
    APP.sessionStart = Date.now();
    localStorage.setItem('wms_session', JSON.stringify({ userId: user.id, loginTime: new Date().toISOString() }));
    // Track user session
    DB.add('user_sessions', { userId: user.id, userName: user.name, loginTime: new Date().toISOString(), logoutTime: null, status: 'Active' });
    logAction('Auth', 'LOGIN', 'User ' + user.name + ' logged in');
    pullAllServerData();
    return true;
}

function logout() {
    if (APP.currentUser) {
        logAction('Auth', 'LOGOUT', 'User ' + APP.currentUser.name + ' logged out');
        // Close session
        var sessions = DB.get('user_sessions');
        for (var i = sessions.length - 1; i >= 0; i--) {
            if (sessions[i].userId === APP.currentUser.id && !sessions[i].logoutTime) {
                DB.update('user_sessions', sessions[i].id, { logoutTime: new Date().toISOString(), status: 'Logged Out' });
                break;
            }
        }
    }
    APP.currentUser = null;
    localStorage.removeItem('wms_session');
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginPage').style.display = 'flex';
}

function checkPermission(module) {
    if (!APP.currentUser) return false;
    if (APP.currentUser.permissions.modules.indexOf('all') > -1) return true;
    return APP.currentUser.permissions.modules.indexOf(module) > -1;
}
function checkActionPerm(action) {
    if (!APP.currentUser) return false;
    if (APP.currentUser.role === 'Super Admin') return true;
    return APP.currentUser.permissions.actions && APP.currentUser.permissions.actions[action] === true;
}

// ==================== SIDEBAR ====================
function renderSidebar() {
    if (!APP.currentUser) return;
    var modules = [
        { id: 'dashboard', icon: 'bxs-dashboard', label: 'Dashboard', subs: [] },
        { id: 'inbound', icon: 'bxs-truck', label: 'Inbound', subs: [
            { id: 'security-gate', label: 'Security Gate' },
            { id: 'pending-vehicle', label: 'Pending Vehicle' },
            { id: 'unloading-screen', label: 'Unloading Screen' },
            { id: 'posting-pending', label: 'Posting Pending' },
            { id: 'inbound-record', label: 'Inbound Record' }
        ]},
        { id: 'putaway', icon: 'bxs-package', label: 'Putaway', subs: [] },
        { id: 'piv', icon: 'bxs-clipboard', label: 'PIV', subs: [] },
        { id: 'location', icon: 'bxs-map-pin', label: 'Location Master', subs: [] },
        { id: 'rack', icon: 'bxs-grid-alt', label: 'Rack Master', subs: [] },
        { id: 'material', icon: 'bxs-label', label: 'Material Master', subs: [] },
        { id: 'picking', icon: 'bxs-box', label: 'Picking', subs: [
            { id: 'obd-upload', label: 'OBD Upload' },
            { id: 'picking-assign', label: 'Picking Assign' },
            { id: 'start-picking', label: 'Start Picking' },
            { id: 'picking-done', label: 'Picking Done' }
        ]},
        { id: 'loading', icon: 'bxs-truck', label: 'Loading', subs: [
            { id: 'loading-assign', label: 'Loading Assign' },
            { id: 'start-loading', label: 'Start Loading' },
            { id: 'loading-done', label: 'Loaded Vehicles' },
            { id: 'qty-mismatch', label: 'Qty Mismatch' }
        ]},
        { id: 'user-time', icon: 'bx-time-five', label: 'User Working Time', subs: [] },
        { id: 'admin', icon: 'bxs-user-detail', label: 'Admin', subs: [] },
        { id: 'settings', icon: 'bxs-cog', label: 'Settings', subs: [] },
        { id: 'reports', icon: 'bxs-bar-chart-alt-2', label: 'Reports', subs: [] },
        { id: 'audit', icon: 'bxs-receipt', label: 'Audit Log', subs: [] }
    ];

    var html = '';
    for (var m = 0; m < modules.length; m++) {
        var mod = modules[m];
        var hasSub = mod.subs.length > 0;
        var hasParentAccess = checkPermission(mod.id);
        var hasAnySubAccess = false;
        if (hasSub) {
            for (var s = 0; s < mod.subs.length; s++) {
                if (checkPermission(mod.subs[s].id)) { hasAnySubAccess = true; break; }
            }
        }
        if (!hasParentAccess && !hasAnySubAccess) continue;

        html += '<div class="nav-group">';
        html += '<a href="#" data-section="' + mod.id + '" class="nav-item' + (hasSub ? ' has-sub' : '') + '">';
        html += '<i class="bx ' + mod.icon + '"></i><span>' + mod.label + '</span>';
        if (hasSub) html += '<i class="bx bx-chevron-down sub-arrow"></i>';
        html += '</a>';
        if (hasSub) {
            html += '<div class="nav-sub" id="' + mod.id + 'Sub">';
            for (var s2 = 0; s2 < mod.subs.length; s2++) {
                if (checkPermission(mod.subs[s2].id)) {
                    html += '<a href="#" data-sub="' + mod.subs[s2].id + '" class="nav-sub-item">' + mod.subs[s2].label + '</a>';
                }
            }
            html += '</div>';
        }
        html += '</div>';
    }
    document.getElementById('sidebarNav').innerHTML = html;

    // Bind click events
    var navItems = document.querySelectorAll('#sidebarNav .nav-item');
    for (var n = 0; n < navItems.length; n++) {
        navItems[n].addEventListener('click', function(e) {
            e.preventDefault();
            var section = this.getAttribute('data-section');
            // Toggle sub-menu
            if (this.classList.contains('has-sub')) {
                this.classList.toggle('open');
                var sub = this.nextElementSibling;
                if (sub) sub.classList.toggle('open');
                return;
            }
            if (section) navigateTo(section);
        });
    }
    var subItems = document.querySelectorAll('#sidebarNav .nav-sub-item');
    for (var si = 0; si < subItems.length; si++) {
        subItems[si].addEventListener('click', function(e) {
            e.preventDefault();
            var sub = this.getAttribute('data-sub');
            var parentGroup = this.closest('.nav-group');
            var parentSection = parentGroup ? parentGroup.querySelector('.nav-item').getAttribute('data-section') : null;
            if (sub && parentSection) navigateTo(parentSection, sub);
        });
    }
}

// ==================== NAVIGATION ====================
function navigateTo(section, sub) {
    sub = sub || null;
    // Check parent or sub permission
    if (!checkPermission(section) && !sub) {
        showToast('Access Denied! Admin ne iska access nahi diya.', 'error');
        return;
    }
    if (sub && !checkPermission(sub)) {
        showToast('Access Denied!', 'error');
        return;
    }
    APP.currentSection = section;
    APP.currentSub = sub;

    // Highlight nav
    var allNav = document.querySelectorAll('.nav-item');
    for (var i = 0; i < allNav.length; i++) { allNav[i].classList.remove('active'); }
    var allSubNav = document.querySelectorAll('.nav-sub-item');
    for (var j = 0; j < allSubNav.length; j++) { allSubNav[j].classList.remove('active'); }

    var navItem = document.querySelector('.nav-item[data-section="' + section + '"]');
    if (navItem) navItem.classList.add('active');
    if (sub) {
        var subItem = document.querySelector('.nav-sub-item[data-sub="' + sub + '"]');
        if (subItem) subItem.classList.add('active');
        // Open parent sub
        if (navItem) { navItem.classList.add('open'); }
        var parentSub = document.getElementById(section + 'Sub');
        if (parentSub) parentSub.classList.add('open');
    }

    // Breadcrumb
    var names = { dashboard:'Dashboard', inbound:'Inbound', putaway:'Putaway', piv:'PIV', location:'Location Master', rack:'Rack Master', material:'Material Master', admin:'Admin', settings:'Settings', reports:'Reports', audit:'Audit Log', picking:'Picking', loading:'Loading', 'user-time':'User Working Time' };
    var subNames = { 'security-gate':'Security Gate', 'pending-vehicle':'Pending Vehicle', 'unloading-screen':'Unloading Screen', 'posting-pending':'Posting Pending', 'inbound-record':'Inbound Record', 'obd-upload':'OBD Upload', 'picking-assign':'Picking Assign', 'start-picking':'Start Picking', 'picking-done':'Picking Done', 'loading-assign':'Loading Assign', 'start-loading':'Start Loading', 'loading-done':'Loaded Vehicles', 'qty-mismatch':'Qty Mismatch' };
    var bc = 'VIP INDUSTRIES LIMITED MD20 <i class="bx bx-chevron-right"></i> <span class="bc-item active">' + (names[section] || section) + '</span>';
    if (sub) bc += ' <i class="bx bx-chevron-right"></i> <span class="bc-item active">' + (subNames[sub] || sub) + '</span>';
    document.getElementById('breadcrumb').innerHTML = bc;

    // Show section (create dynamically if not exists)
    var allSections = document.querySelectorAll('.content-section');
    for (var k = 0; k < allSections.length; k++) { allSections[k].classList.remove('active'); }
    var sec = document.getElementById('section-' + section);
    if (!sec) {
        sec = document.createElement('section');
        sec.id = 'section-' + section;
        sec.className = 'content-section';
        document.getElementById('contentArea').appendChild(sec);
    }
    sec.classList.add('active');

    renderSection(section, sub);
    closeSidebar();
}

function renderSection(section, sub) {
    var renderers = {
        dashboard: renderDashboard,
        inbound: function() { renderInbound(sub); },
        putaway: renderPutaway,
        piv: renderPIV,
        location: renderLocationMaster,
        rack: renderRackMaster,
        material: renderMaterialMaster,
        admin: renderAdmin,
        settings: renderSettings,
        reports: renderReports,
        audit: renderAuditLog,
        picking: function() { renderPicking(sub); },
        loading: function() { renderLoading(sub); },
        'user-time': renderUserWorkingTime
    };
    if (renderers[section]) renderers[section]();
    else {
        var sec = document.getElementById('section-' + section);
        if (sec) sec.innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-code-block"></i><p>Module coming soon...</p></div></div>';
    }
}

// ==================== DASHBOARD ====================
function renderDashboard() {
    var vehicles = DB.get('vehicles');
    var locations = DB.get('location_master');
    var racks = DB.get('rack_master');
    var todayStr = today();
    var totalVehicles = vehicles.length;
    var pendingUnload = 0, loadedCount = 0, postedCount = 0, postingPending = 0;
    for (var i = 0; i < vehicles.length; i++) {
        var s = vehicles[i].status;
        if (s === 'Unload Pending' || s === 'Assigned') pendingUnload++;
        if (s === 'Loaded' || s === 'Loading Done') loadedCount++;
        if (s === 'Posted' || s === 'Unloaded') postedCount++;
        if (s === 'Posting Pending Approval') postingPending++;
    }
    var todayPutaway = 0, todayPIV = 0;
    for (var j = 0; j < locations.length; j++) {
        if (locations[j].action === 'PUTAWAY' && locations[j].date === todayStr) todayPutaway++;
        if (locations[j].action === 'PIV' && locations[j].date === todayStr) todayPIV++;
    }
    var occupiedRackSet = {};
    for (var k = 0; k < locations.length; k++) { occupiedRackSet[locations[k].rack] = true; }
    var occupiedRacks = 0;
    for (var r = 0; r < racks.length; r++) { if (occupiedRackSet[racks[r].rack]) occupiedRacks++; }
    var emptyRacks = racks.length - occupiedRacks;
    var recentActivity = DB.get('audit_log').slice(-10).reverse();
    var pendingV = [];
    for (var p = 0; p < vehicles.length; p++) {
        if (vehicles[p].status === 'Unload Pending' || vehicles[p].status === 'Assigned') pendingV.push(vehicles[p]);
    }

    var html = '<div class="section-header"><h2><i class="bx bxs-dashboard"></i> Dashboard</h2>' +
        '<div style="color:var(--text-muted);font-size:13px">' + formatDateTime(new Date()) + '</div></div>';
    html += '<div class="kpi-grid">';
    html += kpiCard('bxs-truck', totalVehicles, 'Total Vehicles');
    html += kpiCard('bx-time-five', pendingUnload, 'Pending Unload');
    html += kpiCard('bxs-package', todayPutaway, "Today's Putaway");
    html += kpiCard('bxs-clipboard', todayPIV, "Today's PIV");
    html += kpiCard('bxs-grid-alt', occupiedRacks, 'Occupied Racks');
    html += kpiCard('bx-grid', emptyRacks, 'Empty Racks');
    html += kpiCard('bxs-check-circle', postedCount, 'Posted GRN');
    html += kpiCard('bx-error-circle', postingPending, 'Pending Approval');
    html += '</div>';

    html += '<div class="grid-2">';
    // Recent Activity
    html += '<div class="card"><div class="card-title">Recent Activity</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Action No</th><th>Module</th><th>Action</th><th>Time</th></tr></thead><tbody>';
    if (recentActivity.length === 0) {
        html += '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:30px">No activity yet</td></tr>';
    } else {
        for (var a = 0; a < recentActivity.length; a++) {
            var act = recentActivity[a];
            html += '<tr><td><span style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(act.actionNo) + '</span></td>' +
                '<td>' + escapeHtml(act.module) + '</td><td>' + escapeHtml(act.action) + '</td>' +
                '<td style="font-size:12px;color:var(--text-muted)">' + formatDateTime(act.dateTime) + '</td></tr>';
        }
    }
    html += '</tbody></table></div></div>';

    // Pending Vehicles
    html += '<div class="card"><div class="card-title">Pending Vehicles</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>Driver</th><th>Transport</th><th>Status</th></tr></thead><tbody>';
    if (pendingV.length === 0) {
        html += '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:30px">No pending vehicles</td></tr>';
    } else {
        for (var pv = 0; pv < pendingV.length; pv++) {
            var v = pendingV[pv];
            html += '<tr style="cursor:pointer" onclick="navigateTo(\'inbound\',\'pending-vehicle\')"><td><strong>' + escapeHtml(v.vehicleNo) + '</strong></td><td>' + escapeHtml(v.driverName || '-') + '</td>' +
                '<td>' + escapeHtml(v.transportName || '-') + '</td><td><span class="badge badge-warning">' + escapeHtml(v.status) + '</span></td></tr>';
        }
    }
    html += '</tbody></table></div></div>';
    html += '</div>';
    document.getElementById('section-dashboard').innerHTML = html;
}

function kpiCard(icon, value, label) {
    return '<div class="kpi-card" style="cursor:pointer" onclick="this.style.transform=\'scale(0.97)\'"><div class="kpi-icon"><i class="bx ' + icon + '"></i></div>' +
        '<div class="kpi-value">' + value + '</div><div class="kpi-label">' + label + '</div></div>';
}

// ==================== INBOUND ====================

// --- SECURITY GATE ---
function renderSecurityGate() {
    var html = '<div class="section-header"><h2><i class="bx bx-shield-quarter"></i> Security Gate Entry</h2></div>';
    html += '<div class="card"><div class="card-title">Vehicle Reporting</div>';
    html += '<div class="form-group" style="margin-bottom:16px"><label>Vehicle Type <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:12px;margin-top:6px">';
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid var(--accent);border-radius:8px;background:var(--accent-dim);flex:1;justify-content:center;font-weight:600;color:var(--accent)"><input type="radio" name="vehType" value="Unloading" checked style="accent-color:var(--accent);width:18px;height:18px"> UNLOADING</label>';
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid var(--border);border-radius:8px;flex:1;justify-content:center;font-weight:600;color:var(--text-secondary)"><input type="radio" name="vehType" value="Loading" style="accent-color:var(--accent2);width:18px;height:18px"> LOADING</label>';
    html += '</div></div>';

    html += '<div class="form-row">';
    html += '<div class="form-group"><label>Vehicle Number <span class="req">*</span></label><input type="text" id="secVehicleNo" class="form-input" placeholder="e.g. MH-12-AB-1234" style="text-transform:uppercase"></div>';
    html += '<div class="form-group" id="lrGroup"><label>LR Number <span class="req">*</span></label><input type="text" id="secLrNo" class="form-input" placeholder="e.g. LR-2025-001" style="border-color:var(--warning)"></div>';
    html += '<div class="form-group"><label>Driver Name <span class="req">*</span></label><input type="text" id="secDriverName" class="form-input" placeholder="Driver full name"></div>';
    html += '<div class="form-group"><label>Driver Mobile <span class="req">*</span></label><input type="tel" id="secDriverMobile" class="form-input" placeholder="10 digit" maxlength="10"></div>';
    html += '<div class="form-group"><label>Transporter Name <span class="req">*</span></label><input type="text" id="secTransport" class="form-input" placeholder="Transport company"></div>';
    html += '<div class="form-group"><label>Reporting Time</label><div class="form-input" style="background:var(--bg-secondary);color:var(--accent);font-weight:bold">' + formatDateTime(new Date()) + ' <small>(Auto)</small></div></div>';
    html += '</div>';
    html += '<div class="form-actions">';
    if (checkActionPerm('canSecurityEntry')) {
        html += '<button class="btn btn-primary" onclick="submitSecurityGate()"><i class="bx bx-check-circle"></i> Submit Vehicle</button>';
    } else {
        html += '<button class="btn btn-primary" disabled><i class="bx bx-block"></i> Access Denied</button>';
    }
    html += '</div></div>';
    return html;
}

// Toggle LR field based on vehicle type
document.addEventListener('change', function(e) {
    if (e.target.name === 'vehType') {
        var lrGroup = document.getElementById('lrGroup');
        if (lrGroup) {
            lrGroup.style.display = e.target.value === 'Unloading' ? '' : 'none';
        }
        var labels = document.querySelectorAll('input[name="vehType"]');
        for (var i = 0; i < labels.length; i++) {
            var parent = labels[i].closest('label');
            if (labels[i].checked) {
                parent.style.borderColor = labels[i].value === 'Unloading' ? 'var(--accent)' : 'var(--accent2)';
                parent.style.background = labels[i].value === 'Unloading' ? 'var(--accent-dim)' : 'var(--accent2-dim)';
                parent.style.color = labels[i].value === 'Unloading' ? 'var(--accent)' : 'var(--accent2)';
            } else {
                parent.style.borderColor = 'var(--border)';
                parent.style.background = 'transparent';
                parent.style.color = 'var(--text-secondary)';
            }
        }
    }
});

function submitSecurityGate() {
    var vehType = document.querySelector('input[name="vehType"]:checked');
    var vNo = document.getElementById('secVehicleNo').value.trim().toUpperCase();
    var lrNo = document.getElementById('secLrNo').value.trim().toUpperCase();
    var driverName = document.getElementById('secDriverName').value.trim();
    var mobile = document.getElementById('secDriverMobile').value.trim();
    var transport = document.getElementById('secTransport').value.trim();
    if (!vNo || !driverName || !mobile || !transport) { showToast('All fields are required', 'error'); return; }
    if (!/^\d{10}$/.test(mobile)) { showToast('Invalid 10-digit mobile number', 'error'); return; }
    var type = vehType ? vehType.value : 'Unloading';

    if (type === 'Unloading' && !lrNo) { showToast('LR Number is required for unloading vehicles', 'error'); return; }

    // Check duplicate LR for unloading
    if (type === 'Unloading') {
        var lrExists = DB.filter('vehicles', function(v) { return v.lrNo && v.lrNo.toUpperCase() === lrNo; });
        if (lrExists.length > 0) { showToast('ERROR: LR Number already exists!', 'error'); return; }
    }

    var status = type === 'Unloading' ? 'Unload Pending' : 'Loading Pending';
    DB.add('vehicles', {
        vehicleNo: vNo, lrNo: lrNo || '', driverName: driverName, driverMobile: mobile,
        transportName: transport, vehicleType: type, status: status,
        reportedAt: new Date().toISOString()
    });
    addNotification('New ' + type + ' Vehicle ' + vNo + ' reported at gate.', type === 'Unloading' ? 'warning' : 'info');
    logAction('Security Gate', 'ENTRY', type + ' Vehicle ' + vNo + ' reported. LR: ' + (lrNo || 'N/A'));
    showToast('Vehicle submitted successfully!', 'success');
    document.getElementById('secVehicleNo').value = '';
    document.getElementById('secLrNo').value = '';
    document.getElementById('secDriverName').value = '';
    document.getElementById('secDriverMobile').value = '';
    document.getElementById('secTransport').value = '';
}

// --- BULK INVOICE UPLOAD ---
function showBulkInvoiceUpload() {
    var html = '<div class="form-group"><label>Upload Bulk Data (Excel) <span class="req">*</span></label>' +
        '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Choose File' +
        '<input type="file" id="bulkInvFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="document.getElementById(\'bulkInvName\').innerText=this.files[0].name"></label>' +
        '<div id="bulkInvName" style="font-size:12px;color:var(--text-muted);margin-top:5px">No file chosen</div></div>' +
        '<div style="background:var(--bg-secondary);padding:12px;border-radius:6px;font-size:12px;color:var(--text-muted);border:1px dashed var(--warning)">' +
        '<strong style="color:var(--warning)">Excel Format (Row 1 = Header):</strong><br>' +
        'Vehicle No | LR No | Invoice No | Customer | Material Code | Description | Qty</div>';
    showModal('Bulk Upload Invoices & Materials', html, 'md',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="processBulkInvoiceUpload()"><i class="bx bx-check-double"></i> Upload</button>');
}

function processBulkInvoiceUpload() {
    var fileInput = document.getElementById('bulkInvFile');
    if (!fileInput || !fileInput.files[0]) { showToast('Select a file first', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (data.length === 0) { showToast('Empty file', 'error'); return; }
            var startRow = (String(data[0][1] || '').toLowerCase().indexOf('lr') > -1) ? 1 : 0;
            var vehicleMap = {}, countInv = 0, countMat = 0;
            for (var k = startRow; k < data.length; k++) {
                var r = data[k];
                if (!r || !r[1] || !r[2]) continue;
                var vNo = String(r[0] || '').trim(), lr = String(r[1] || '').trim().toUpperCase();
                var invNo = String(r[2] || '').trim(), customer = String(r[3] || '').trim();
                var matCode = String(r[4] || '').trim(), matDesc = String(r[5] || '').trim(), invQty = parseInt(r[6]) || 0;
                if (!vehicleMap[lr]) {
                    var existingV = DB.filter('vehicles', function(v) { return v.lrNo && v.lrNo.toUpperCase() === lr; });
                    if (existingV.length > 0) {
                        vehicleMap[lr] = { vehicleId: existingV[0].id, invoices: {} };
                        if (existingV[0].status === 'Reporting Completed' || existingV[0].status === 'Unload Pending') {
                            DB.update('vehicles', existingV[0].id, { status: 'Unload Pending' });
                        }
                    } else {
                        var v = DB.add('vehicles', { vehicleNo: vNo, lrNo: lr, driverName: '', driverMobile: '', transportName: '', vehicleType: 'Unloading', status: 'Unload Pending', reportedAt: new Date().toISOString() });
                        vehicleMap[lr] = { vehicleId: v.id, invoices: {} };
                    }
                }
                if (!vehicleMap[lr].invoices[invNo] && invNo) {
                    DB.add('invoices', { vehicleId: vehicleMap[lr].vehicleId, invoiceNo: invNo, customer: customer, status: 'Pending' });
                    vehicleMap[lr].invoices[invNo] = true;
                    countInv++;
                }
                if (matCode && invQty > 0 && vehicleMap[lr].invoices[invNo]) {
                    var invList = DB.get('invoices');
                    var invObj = null;
                    for (var ii = 0; ii < invList.length; ii++) {
                        if (invList[ii].vehicleId === vehicleMap[lr].vehicleId && invList[ii].invoiceNo === invNo) { invObj = invList[ii]; break; }
                    }
                    if (invObj) {
                        // Try to find EAN from material master
                        var eanCode = '';
                        var matMaster = DB.get('material_master');
                        for (var mm = 0; mm < matMaster.length; mm++) {
                            if (matMaster[mm].material === matCode) { eanCode = matMaster[mm].ean || ''; break; }
                        }
                        DB.add('invoice_materials', { invoiceId: invObj.id, material: matCode, ean: eanCode, description: matDesc, qty: invQty, unloadedQty: 0 });
                        countMat++;
                    }
                }
            }
            logAction('Inbound', 'BULK_UPLOAD', 'Processed ' + Object.keys(vehicleMap).length + ' vehicles, ' + countInv + ' invoices, ' + countMat + ' materials.');
            showToast('Success! ' + countInv + ' invoices, ' + countMat + ' materials uploaded.', 'success');
            closeModal();
            renderInbound('pending-vehicle');
        } catch (err) { showToast('Error reading Excel file: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(fileInput.files[0]);
}

// --- PENDING VEHICLES ---
function renderPendingVehicles() {
    var allVehicles = DB.get('vehicles');
    var unassigned = [], assigned = [], pendingApproval = [];

    for (var i = 0; i < allVehicles.length; i++) {
        var v = allVehicles[i];
        if (v.vehicleType !== 'Unloading') continue;
        if (v.status === 'Posting Pending Approval') pendingApproval.push(v);
        else if (v.assignedTo && v.status !== 'Posted' && v.status !== 'Unloaded' && v.status !== 'Rejected') assigned.push(v);
        else if (v.status === 'Unload Pending' || v.status === 'Reporting Completed') unassigned.push(v);
    }

    var html = '<div class="section-header"><h2><i class="bx bx-time-five"></i> Inbound Control Tower</h2>';
    if (checkActionPerm('canUploadInvoice')) html += '<button class="btn btn-warning" onclick="showBulkInvoiceUpload()"><i class="bx bx-upload"></i> Bulk Upload</button>';
    html += '</div>';

    // Unassigned Vehicles
    html += '<div class="card"><div class="card-title">Unassigned Vehicles (' + unassigned.length + ')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR No</th><th>Transport</th><th>Invoices</th><th>Materials</th><th>Action</th></tr></thead><tbody>';
    if (unassigned.length === 0) {
        html += '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No unassigned vehicles</td></tr>';
    } else {
        for (var u = 0; u < unassigned.length; u++) {
            var veh = unassigned[u];
            var invCount = DB.filter('invoices', function(inv) { return inv.vehicleId === veh.id; }).length;
            var matCount = 0;
            var vehInvs = DB.filter('invoices', function(inv) { return inv.vehicleId === veh.id; });
            for (var vi = 0; vi < vehInvs.length; vi++) {
                matCount += DB.filter('invoice_materials', function(im) { return im.invoiceId === vehInvs[vi].id; }).length;
            }
            var hasData = invCount > 0;
            html += '<tr><td><strong>' + escapeHtml(veh.vehicleNo) + '</strong></td><td style="font-family:var(--font-display);font-size:11px;color:var(--warning)">' + escapeHtml(veh.lrNo) + '</td><td>' + escapeHtml(veh.transportName || '-') + '</td>';
            html += '<td><span class="badge ' + (hasData ? 'badge-success' : 'badge-warning') + '">' + invCount + '</span></td>';
            html += '<td>' + matCount + '</td><td><div class="table-actions">';
            if (hasData && checkActionPerm('canAssignVehicle')) {
                html += '<button class="btn btn-primary btn-sm" onclick="assignVehicleModal(\'' + veh.id + '\')"><i class="bx bx-user-plus"></i> Assign</button>';
            } else if (!hasData) {
                html += '<button class="btn btn-sm" disabled style="opacity:0.5;cursor:not-allowed"><i class="bx bx-block"></i> No Data</button>';
            }
            if (checkActionPerm('canUploadInvoice')) {
                html += '<button class="btn btn-secondary btn-sm" onclick="showVehicleInvoiceUpload(\'' + veh.id + '\')"><i class="bx bx-file"></i> Upload</button>';
            }
            html += '</div></td></tr>';
        }
    }
    html += '</tbody></table></div></div>';

    // Pending Approvals
    if (pendingApproval.length > 0 && checkActionPerm('canApprove')) {
        html += '<div class="card" style="margin-top:20px;border:2px solid var(--warning)"><div class="card-title" style="color:var(--warning)"><i class="bx bx-error-circle"></i> Pending Approvals (' + pendingApproval.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>LR No</th><th>Unloader</th><th>Report No</th><th>Action</th></tr></thead><tbody>';
        for (var pa = 0; pa < pendingApproval.length; pa++) {
            var pv = pendingApproval[pa];
            html += '<tr><td><strong>' + escapeHtml(pv.vehicleNo) + '</strong></td><td>' + escapeHtml(pv.lrNo) + '</td><td>' + escapeHtml(pv.assignedToUsername || '-') + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(pv.shortReportNo || '-') + '</td>';
            html += '<td><div class="table-actions">';
            html += '<button class="btn btn-success btn-sm" onclick="approveVehicle(\'' + pv.id + '\')"><i class="bx bx-check"></i> Approve</button>';
            html += '<button class="btn btn-danger btn-sm" onclick="rejectVehicle(\'' + pv.id + '\')"><i class="bx bx-x"></i> Reject</button>';
            html += '<button class="btn btn-secondary btn-sm" onclick="viewShortReport(\'' + pv.id + '\')"><i class="bx bx-show"></i> View</button>';
            html += '</div></td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    // Assigned Vehicles
    html += '<div class="card" style="margin-top:20px"><div class="card-title">Active Assigned Vehicles (' + assigned.length + ')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>LR No</th><th>Assigned To</th><th>Status</th></tr></thead><tbody>';
    if (assigned.length === 0) {
        html += '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No active vehicles</td></tr>';
    } else {
        for (var av = 0; av < assigned.length; av++) {
            var avv = assigned[av];
            html += '<tr><td><strong>' + escapeHtml(avv.vehicleNo) + '</strong></td><td>' + escapeHtml(avv.lrNo) + '</td><td>' + escapeHtml(avv.assignedToUsername) + '</td><td><span class="badge badge-warning">' + escapeHtml(avv.status) + '</span></td></tr>';
        }
    }
    html += '</tbody></table></div></div>';
    return html;
}

function assignVehicleModal(vehicleId) {
    var users = DB.get('users');
    var options = '';
    for (var i = 0; i < users.length; i++) {
        if (users[i].permissions.actions && users[i].permissions.actions.canStartUnloading) {
            options += '<option value="' + users[i].username + '">' + escapeHtml(users[i].name) + ' (' + users[i].username + ')</option>';
        }
    }
    var html = '<div class="form-group"><label>Assign To <span class="req">*</span></label>' +
        '<select id="assignUserName" class="form-input"><option value="">-- Select User --</option>' + options + '</select></div>';
    showModal('Assign Vehicle', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="confirmAssignVehicle(\'' + vehicleId + '\')"><i class="bx bx-check"></i> Assign</button>');
}

function confirmAssignVehicle(vehicleId) {
    var uname = document.getElementById('assignUserName').value;
    if (!uname) { showToast('Select a user', 'error'); return; }
    DB.update('vehicles', vehicleId, { assignedTo: uname, assignedToUsername: uname, status: 'Assigned' });
    addNotification('Vehicle assigned to ' + uname, 'info');
    logAction('Inbound', 'ASSIGN', 'Vehicle assigned to ' + uname);
    showToast('Assigned successfully!', 'success');
    closeModal();
    renderInbound('pending-vehicle');
}

function showVehicleInvoiceUpload(vehicleId) {
    var vehicle = DB.find('vehicles', vehicleId);
    if (!vehicle) return;
    var html = '<div style="background:var(--bg-secondary);padding:10px;border-radius:6px;margin-bottom:15px;border-left:4px solid var(--accent)">' +
        '<strong>Uploading for:</strong> ' + escapeHtml(vehicle.vehicleNo) + ' (LR: ' + escapeHtml(vehicle.lrNo) + ')</div>' +
        '<div class="form-group"><label>Upload Invoice Data <span class="req">*</span></label>' +
        '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Choose File' +
        '<input type="file" id="vehInvFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="document.getElementById(\'vehInvName\').innerText=this.files[0].name"></label>' +
        '<div id="vehInvName" style="font-size:12px;color:var(--text-muted);margin-top:5px">No file chosen</div></div>' +
        '<div style="background:var(--bg-secondary);padding:12px;border-radius:6px;font-size:12px;color:var(--text-muted);border:1px dashed var(--warning)">' +
        '<strong style="color:var(--warning)">Excel Format:</strong><br>Invoice No | Customer | Material Code | Description | Qty</div>';
    showModal('Upload Invoices - ' + vehicle.vehicleNo, html, 'md',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="processVehicleInvoiceUpload(\'' + vehicleId + '\')"><i class="bx bx-check-double"></i> Upload</button>');
}

function processVehicleInvoiceUpload(vehicleId) {
    var fileInput = document.getElementById('vehInvFile');
    if (!fileInput || !fileInput.files[0]) { showToast('Select a file first', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (data.length === 0) { showToast('Empty file', 'error'); return; }
            var startRow = (String(data[0][0] || '').toLowerCase().indexOf('invoice') > -1) ? 1 : 0;
            var countInv = 0, countMat = 0;
            for (var k = startRow; k < data.length; k++) {
                var r = data[k]; if (!r || !r[0]) continue;
                var invNo = String(r[0] || '').trim(), customer = String(r[1] || '').trim();
                var matCode = String(r[2] || '').trim(), matDesc = String(r[3] || '').trim(), invQty = parseInt(r[4]) || 0;
                var invObj = null;
                var allInvs = DB.get('invoices');
                for (var ii = 0; ii < allInvs.length; ii++) {
                    if (allInvs[ii].vehicleId === vehicleId && allInvs[ii].invoiceNo === invNo) { invObj = allInvs[ii]; break; }
                }
                if (!invObj && invNo) {
                    invObj = DB.add('invoices', { vehicleId: vehicleId, invoiceNo: invNo, customer: customer, status: 'Pending' });
                    countInv++;
                }
                if (matCode && invQty > 0 && invObj) {
                    var eanCode = '';
                    var matMaster = DB.get('material_master');
                    for (var mm = 0; mm < matMaster.length; mm++) {
                        if (matMaster[mm].material === matCode) { eanCode = matMaster[mm].ean || ''; break; }
                    }
                    DB.add('invoice_materials', { invoiceId: invObj.id, material: matCode, ean: eanCode, description: matDesc, qty: invQty, unloadedQty: 0 });
                    countMat++;
                }
            }
            DB.update('vehicles', vehicleId, { status: 'Unload Pending' });
            logAction('Inbound', 'INV_UPLOAD', 'Uploaded ' + countInv + ' invoices, ' + countMat + ' materials for vehicle.');
            showToast('Success! ' + countInv + ' invoices, ' + countMat + ' materials uploaded.', 'success');
            closeModal();
            renderInbound('pending-vehicle');
        } catch (err) { showToast('Error reading file: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(fileInput.files[0]);
}

// --- UNLOADING SCREEN ---
// Global state for current unloading session
var currentUnloadSession = { vehicleId: null, scannedItems: [], startTime: null };

function renderUnloadingScreen() {
    if (!APP.currentUser) return '<div class="card"><div class="empty-state"><i class="bx bx-lock"></i><p>Not logged in</p></div></div>';

    // Show only vehicles assigned to THIS user
    var myVehicles = DB.filter('vehicles', function(v) {
        return v.assignedTo === APP.currentUser.username && (v.status === 'Assigned' || v.status === 'Unloading In Progress');
    });

    var html = '<div class="section-header"><h2><i class="bx bx-download"></i> Unloading Screen</h2>' +
        '<div style="color:var(--text-muted);font-size:13px">User: <strong style="color:var(--accent)">' + escapeHtml(APP.currentUser.name) + '</strong></div></div>';

    if (myVehicles.length === 0) {
        html += '<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No vehicles assigned to you</p><small style="color:var(--text-muted)">Contact admin for vehicle assignment</small></div></div>';
        return html;
    }

    // Vehicle list - simplified (only vehicle no, LR, driver)
    html += '<div class="card"><div class="card-title">Your Assigned Vehicles</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR No</th><th>Driver Mobile</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < myVehicles.length; i++) {
        var v = myVehicles[i];
        html += '<tr><td><strong>' + escapeHtml(v.vehicleNo) + '</strong></td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(v.lrNo) + '</td><td>' + escapeHtml(v.driverMobile || '-') + '</td>';
        html += '<td><span class="badge badge-warning">' + escapeHtml(v.status) + '</span></td>';
        html += '<td><button class="btn btn-primary btn-sm" onclick="startUnloading(\'' + v.id + '\')"><i class="bx bx-download"></i> Unload</button></td></tr>';
    }
    html += '</tbody></table></div></div>';

    // Scanning area (hidden initially, shown after clicking Unload)
    html += '<div id="unloadingScanArea" style="display:none"></div>';
    return html;
}

function startUnloading(vehicleId) {
    var vehicle = DB.find('vehicles', vehicleId);
    if (!vehicle) return;
    DB.update('vehicles', vehicleId, { status: 'Unloading In Progress' });
    currentUnloadSession = { vehicleId: vehicleId, scannedItems: [], startTime: new Date().toISOString() };
    logAction('Inbound', 'UNLOAD_START', 'Started unloading vehicle ' + vehicle.vehicleNo);

    // Get all invoice materials for this vehicle for background comparison
    var invoices = DB.filter('invoices', function(inv) { return inv.vehicleId === vehicleId; });
    var invoiceMaterials = [];
    for (var i = 0; i < invoices.length; i++) {
        var mats = DB.filter('invoice_materials', function(im) { return im.invoiceId === invoices[i].id; });
        for (var j = 0; j < mats.length; j++) {
            invoiceMaterials.push({ material: mats[j].material, ean: mats[j].ean || '', invoiceQty: mats[j].qty, invoiceId: mats[j].invoiceId, invoiceNo: invoices[i].invoiceNo, unloadedQty: 0 });
        }
    }

    var scanHtml = '<div class="card" style="border:2px solid var(--accent)"><div class="card-title" style="color:var(--accent)"><i class="bx bx-scan"></i> Scanning Sheet — ' + escapeHtml(vehicle.vehicleNo) + '</div>';
    scanHtml += '<div class="form-row" style="margin-bottom:16px">';
    scanHtml += '<div class="form-group"><label>EAN / Barcode <span class="req">*</span></label><div style="display:flex;gap:8px"><input type="text" id="scanEanInput" class="form-input" placeholder="Scan or type EAN..." style="flex:1" onkeydown="if(event.key===\'Enter\')addScanItem()"><button class="btn btn-primary btn-sm" onclick="addScanItem()"><i class="bx bx-plus"></i> Add</button><button class="btn btn-secondary btn-sm scan-btn" onclick="openScannerForUnloading()"><i class="bx bx-qr"></i> Scan</button></div></div>';
    scanHtml += '<div class="form-group"><label>Material (Auto / Manual)</label><input type="text" id="scanMaterial" class="form-input" placeholder="Auto-filled from scan"></div>';
    scanHtml += '<div class="form-group"><label>Description</label><input type="text" id="scanDesc" class="form-input" placeholder="Auto-filled"></div>';
    scanHtml += '<div class="form-group"><label>Qty</label><input type="number" id="scanQty" class="form-input" value="1" min="1" style="max-width:100px"></div>';
    scanHtml += '</div>';

    // Scanned items table
    scanHtml += '<div id="scannedItemsTable"></div>';
    scanHtml += '<hr class="cyber-line">';
    scanHtml += '<div class="form-actions">';
    scanHtml += '<button class="btn btn-danger" onclick="cancelUnloading()"><i class="bx bx-x"></i> Cancel</button>';
    scanHtml += '<button class="btn btn-primary" onclick="submitUnloading()"><i class="bx bx-check-double"></i> Submit Unloading</button>';
    scanHtml += '</div></div>';

    document.getElementById('unloadingScanArea').innerHTML = scanHtml;
    document.getElementById('unloadingScanArea').style.display = 'block';
    document.getElementById('scanEanInput').focus();
    renderScannedItems(invoiceMaterials);
}

function openScannerForUnloading() {
    openScannerModal(function(code) {
        document.getElementById('scanEanInput').value = code;
        addScanItem();
    });
}

function addScanItem() {
    var ean = document.getElementById('scanEanInput').value.trim();
    if (!ean) { showToast('Scan or enter EAN first', 'error'); return; }

    var material = document.getElementById('scanMaterial').value.trim();
    var desc = document.getElementById('scanDesc').value.trim();
    var qty = parseInt(document.getElementById('scanQty').value) || 1;

    // Auto-fill from material master if material is empty
    if (!material || !desc) {
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === ean) {
                material = material || matMaster[i].material;
                desc = desc || matMaster[i].description;
                break;
            }
        }
        // Also try matching by material name if EAN not found
        if (!material) {
            for (var j = 0; j < matMaster.length; j++) {
                if (matMaster[j].material && matMaster[j].material.toUpperCase() === ean.toUpperCase()) {
                    material = matMaster[j].material;
                    desc = matMaster[j].description;
                    ean = matMaster[j].ean || ean;
                    break;
                }
            }
        }
    }

    // Check if this material exists in vehicle's invoice
    var invoices = DB.filter('invoices', function(inv) { return inv.vehicleId === currentUnloadSession.vehicleId; });
    var foundInInvoice = false;
    for (var ii = 0; ii < invoices.length; ii++) {
        var mats = DB.filter('invoice_materials', function(im) { return im.invoiceId === invoices[ii].id; });
        for (var jj = 0; jj < mats.length; jj++) {
            if (mats[jj].ean === ean || mats[jj].material.toUpperCase() === (material || '').toUpperCase()) {
                foundInInvoice = true;
                break;
            }
        }
        if (foundInInvoice) break;
    }

    currentUnloadSession.scannedItems.push({
        id: DB.uid(), ean: ean, material: material || 'UNKNOWN', description: desc || '-',
        qty: qty, inInvoice: foundInInvoice, scanTime: new Date().toISOString()
    });

    // Clear inputs
    document.getElementById('scanEanInput').value = '';
    document.getElementById('scanMaterial').value = '';
    document.getElementById('scanDesc').value = '';
    document.getElementById('scanQty').value = '1';
    document.getElementById('scanEanInput').focus();

    renderScannedItems();
    if (!foundInInvoice) {
        showToast('WARNING: This material is NOT in the invoice!', 'warning');
    } else {
        showToast('Scanned: ' + (material || ean), 'success');
    }
}

function removeScanItem(itemId) {
    currentUnloadSession.scannedItems = currentUnloadSession.scannedItems.filter(function(s) { return s.id !== itemId; });
    renderScannedItems();
}

function renderScannedItems() {
    var container = document.getElementById('scannedItemsTable');
    if (!container) return;

    // Get invoice materials for comparison
    var invoices = DB.filter('invoices', function(inv) { return inv.vehicleId === currentUnloadSession.vehicleId; });
    var invoiceMats = [];
    for (var i = 0; i < invoices.length; i++) {
        var mats = DB.filter('invoice_materials', function(im) { return im.invoiceId === invoices[i].id; });
        for (var j = 0; j < mats.length; j++) {
            invoiceMats.push(Object.assign({}, mats[j], { invoiceNo: invoices[i].invoiceNo }));
        }
    }

    var html = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Description</th><th>Qty</th><th>Invoice Status</th><th>Action</th></tr></thead><tbody>';

    if (currentUnloadSession.scannedItems.length === 0) {
        html += '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No items scanned yet</td></tr>';
    } else {
        for (var k = 0; k < currentUnloadSession.scannedItems.length; k++) {
            var s = currentUnloadSession.scannedItems[k];
            var rowStyle = s.inInvoice ? '' : 'style="background:var(--danger-dim)"';
            var statusBadge = s.inInvoice ? '<span class="badge badge-success"><i class="bx bx-check"></i> In Invoice</span>' : '<span class="badge badge-danger"><i class="bx bx-x"></i> NOT in Invoice</span>';
            html += '<tr ' + rowStyle + '><td>' + (k + 1) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(s.ean) + '</td>';
            html += '<td>' + escapeHtml(s.material) + '</td><td>' + escapeHtml(s.description) + '</td>';
            html += '<td><strong>' + s.qty + '</strong></td><td>' + statusBadge + '</td>';
            html += '<td><button class="btn btn-danger btn-sm" onclick="removeScanItem(\'' + s.id + '\')"><i class="bx bx-trash"></i></button></td></tr>';
        }
    }
    html += '</tbody></table></div>';

    // Live comparison summary
    if (currentUnloadSession.scannedItems.length > 0) {
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">';
        html += '<div style="padding:10px;background:var(--success);background:rgba(16,185,129,.1);border-radius:8px;border:1px solid rgba(16,185,129,.3);text-align:center"><strong style="color:var(--success)">' + currentUnloadSession.scannedItems.filter(function(s) { return s.inInvoice; }).length + '</strong><br><small style="color:var(--text-muted)">Matched</small></div>';
        html += '<div style="padding:10px;background:var(--danger-dim);border-radius:8px;border:1px solid rgba(239,68,68,.3);text-align:center"><strong style="color:var(--danger)">' + currentUnloadSession.scannedItems.filter(function(s) { return !s.inInvoice; }).length + '</strong><br><small style="color:var(--text-muted)">Not in Invoice</small></div>';
        html += '</div>';
    }

    container.innerHTML = html;
}

function cancelUnloading() {
    if (currentUnloadSession.scannedItems.length > 0) {
        if (!confirm('Are you sure? All scanned data will be lost.')) return;
    }
    if (currentUnloadSession.vehicleId) {
        DB.update('vehicles', currentUnloadSession.vehicleId, { status: 'Assigned' });
    }
    currentUnloadSession = { vehicleId: null, scannedItems: [], startTime: null };
    document.getElementById('unloadingScanArea').style.display = 'none';
    document.getElementById('unloadingScanArea').innerHTML = '';
    renderInbound('unloading-screen');
}

function submitUnloading() {
    if (currentUnloadSession.scannedItems.length === 0) { showToast('No items scanned!', 'error'); return; }

    var vehicle = DB.find('vehicles', currentUnloadSession.vehicleId);
    if (!vehicle) return;

    // Update invoice_materials with scanned quantities
    var invoices = DB.filter('invoices', function(inv) { return inv.vehicleId === currentUnloadSession.vehicleId; });
    for (var i = 0; i < invoices.length; i++) {
        var mats = DB.filter('invoice_materials', function(im) { return im.invoiceId === invoices[i].id; });
        for (var j = 0; j < mats.length; j++) {
            var scannedQty = 0;
            for (var s = 0; s < currentUnloadSession.scannedItems.length; s++) {
                var si = currentUnloadSession.scannedItems[s];
                if (si.inInvoice && (si.ean === mats[j].ean || si.material.toUpperCase() === mats[j].material.toUpperCase())) {
                    scannedQty += si.qty;
                }
            }
            DB.update('invoice_materials', mats[j].id, { unloadedQty: scannedQty });
        }
    }

    // Generate Short/Excess Report
    var shortReportNo = DB.shortNo();
    var reportLines = [];
    var hasMismatch = false;

    for (var ii = 0; ii < invoices.length; ii++) {
        var invMats = DB.filter('invoice_materials', function(im) { return im.invoiceId === invoices[ii].id; });
        for (var jj = 0; jj < invMats.length; jj++) {
            var im = invMats[jj];
            var diff = (im.unloadedQty || 0) - im.qty;
            var status = diff === 0 ? 'Match' : (diff < 0 ? 'Short' : 'Excess');
            if (diff !== 0) hasMismatch = true;
            reportLines.push({
                invoiceNo: invoices[ii].invoiceNo, material: im.material, ean: im.ean || '',
                invoiceQty: im.qty, scannedQty: im.unloadedQty || 0, difference: diff, status: status
            });
        }
    }

    // Add non-invoice scanned items
    for (var ni = 0; ni < currentUnloadSession.scannedItems.length; ni++) {
        var ns = currentUnloadSession.scannedItems[ni];
        if (!ns.inInvoice) {
            reportLines.push({
                invoiceNo: 'N/A', material: ns.material, ean: ns.ean,
                invoiceQty: 0, scannedQty: ns.qty, difference: ns.qty, status: 'Extra'
            });
            hasMismatch = true;
        }
    }

    // Save short report
    DB.add('short_reports', {
        reportNo: shortReportNo, vehicleId: currentUnloadSession.vehicleId,
        vehicleNo: vehicle.vehicleNo, lrNo: vehicle.lrNo,
        unloader: APP.currentUser.name, unloaderUser: APP.currentUser.username,
        lines: reportLines, hasMismatch: hasMismatch,
        dateTime: new Date().toISOString()
    });

    // Save receiving doc
    var rcvNo = DB.rcvNo();
    DB.add('receiving_docs', {
        rcvNo: rcvNo, vehicleId: currentUnloadSession.vehicleId,
        vehicleNo: vehicle.vehicleNo, lrNo: vehicle.lrNo,
        scannedItems: currentUnloadSession.scannedItems,
        shortReportNo: shortReportNo, unloader: APP.currentUser.name,
        dateTime: new Date().toISOString()
    });

    // Update vehicle status
    if (hasMismatch) {
        DB.update('vehicles', currentUnloadSession.vehicleId, {
            status: 'Posting Pending Approval',
            shortReportNo: shortReportNo,
            rcvNo: rcvNo,
            unloadedAt: new Date().toISOString()
        });
        addNotification('Vehicle ' + vehicle.vehicleNo + ' — Posting Pending Approval. Short Report: ' + shortReportNo, 'warning');
        // Notify manager
        var managers = DB.filter('users', function(u) { return u.role === 'Manager' || u.role === 'Super Admin'; });
        for (var mg = 0; mg < managers.length; mg++) {
            addNotification('Approval needed for vehicle ' + vehicle.vehicleNo + '. Report: ' + shortReportNo, 'warning', managers[mg].username);
        }
    } else {
        // Perfect match — auto post
        postVehicle(currentUnloadSession.vehicleId, shortReportNo, rcvNo);
    }

    logAction('Inbound', 'UNLOAD_SUBMIT', 'Unloading submitted for ' + vehicle.vehicleNo + '. Report: ' + shortReportNo + (hasMismatch ? ' (MISMATCH - Pending Approval)' : ' (MATCH - Auto Posted)'));
    showToast(hasMismatch ? 'Submitted! Pending approval due to mismatch.' : 'Submitted! Perfect match — auto posted.', hasMismatch ? 'warning' : 'success');

    currentUnloadSession = { vehicleId: null, scannedItems: [], startTime: null };
    renderInbound('unloading-screen');
}

// --- POSTING / APPROVAL ---
function approveVehicle(vehicleId) {
    var vehicle = DB.find('vehicles', vehicleId);
    if (!vehicle) return;
    postVehicle(vehicleId, vehicle.shortReportNo, vehicle.rcvNo);
    logAction('Inbound', 'APPROVED', 'Vehicle ' + vehicle.vehicleNo + ' approved and posted by ' + APP.currentUser.name);
    addNotification('Vehicle ' + vehicle.vehicleNo + ' approved and posted!', 'success');
    showToast('Vehicle approved and posted!', 'success');
    renderInbound('pending-vehicle');
}

function rejectVehicle(vehicleId) {
    var vehicle = DB.find('vehicles', vehicleId);
    if (!vehicle) return;
    DB.update('vehicles', vehicleId, { status: 'Rejected' });
    logAction('Inbound', 'REJECTED', 'Vehicle ' + vehicle.vehicleNo + ' rejected by ' + APP.currentUser.name);
    addNotification('Vehicle ' + vehicle.vehicleNo + ' rejected!', 'error');
    showToast('Vehicle rejected!', 'error');
    renderInbound('pending-vehicle');
}

function postVehicle(vehicleId, shortReportNo, rcvNo) {
    var vehicle = DB.find('vehicles', vehicleId);
    if (!vehicle) return;

    // Create GRN for each invoice
    var invoices = DB.filter('invoices', function(inv) { return inv.vehicleId === vehicleId; });
    var grnNumbers = [];
    for (var i = 0; i < invoices.length; i++) {
        var grnNo = DB.grnNo(invoices[i].invoiceNo);
        DB.add('grn_records', {
            grnNo: grnNo, vehicleId: vehicleId, vehicleNo: vehicle.vehicleNo, lrNo: vehicle.lrNo,
            invoiceId: invoices[i].id, invoiceNo: invoices[i].invoiceNo,
            shortReportNo: shortReportNo, rcvNo: rcvNo,
            postedBy: APP.currentUser ? APP.currentUser.name : 'System',
            postedAt: new Date().toISOString()
        });
        grnNumbers.push(grnNo);
        DB.update('invoices', invoices[i].id, { status: 'Posted', grnNo: grnNo });
    }

    DB.update('vehicles', vehicleId, {
        status: 'Posted', grnNumbers: grnNumbers,
        shortReportNo: shortReportNo, rcvNo: rcvNo,
        postedAt: new Date().toISOString()
    });
}

function viewShortReport(vehicleId) {
    var vehicle = DB.find('vehicles', vehicleId);
    if (!vehicle) return;
    var report = DB.filter('short_reports', function(r) { return r.vehicleId === vehicleId; })[0];
    if (!report) { showToast('No report found', 'error'); return; }

    var html = '<div style="background:var(--accent-dim);padding:12px;border-radius:8px;margin-bottom:16px;border-left:4px solid var(--accent)">';
    html += '<strong>Report No:</strong> <span style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(report.reportNo) + '</span><br>';
    html += '<strong>Vehicle:</strong> ' + escapeHtml(vehicle.vehicleNo) + ' | <strong>LR:</strong> ' + escapeHtml(vehicle.lrNo) + '<br>';
    html += '<strong>Unloader:</strong> ' + escapeHtml(report.unloader) + ' | <strong>Date:</strong> ' + formatDateTime(report.dateTime);
    html += '</div>';

    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Invoice</th><th>Material</th><th>EAN</th><th>Invoice Qty</th><th>Scanned Qty</th><th>Diff</th><th>Status</th></tr></thead><tbody>';
    for (var i = 0; i < report.lines.length; i++) {
        var l = report.lines[i];
        var statusClass = l.status === 'Match' ? 'badge-success' : (l.status === 'Short' ? 'badge-danger' : 'badge-warning');
        html += '<tr><td>' + escapeHtml(l.invoiceNo) + '</td><td>' + escapeHtml(l.material) + '</td>';
        html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(l.ean) + '</td>';
        html += '<td>' + l.invoiceQty + '</td><td>' + l.scannedQty + '</td>';
        html += '<td class="' + (l.difference !== 0 ? 'qty-mismatch' : 'qty-match') + '">' + (l.difference > 0 ? '+' : '') + l.difference + '</td>';
        html += '<td><span class="badge ' + statusClass + '">' + l.status + '</span></td></tr>';
    }
    html += '</tbody></table></div>';

    showModal('Short/Excess Report', html, 'lg',
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
        '<button class="btn btn-primary" onclick="exportShortReport(\'' + vehicleId + '\')"><i class="bx bx-download"></i> Export PDF</button>');
}

function exportShortReport(vehicleId) {
    var vehicle = DB.find('vehicles', vehicleId);
    var report = DB.filter('short_reports', function(r) { return r.vehicleId === vehicleId; })[0];
    if (!report || !vehicle) return;
    try {
        var doc = new jspdf.jsPDF();
        doc.setFontSize(16);
        doc.text('VIP INDUSTRIES LIMITED (MD20)', 14, 20);
        doc.setFontSize(12);
        doc.text('Short/Excess Report', 14, 30);
        doc.setFontSize(10);
        doc.text('Report No: ' + report.reportNo, 14, 40);
        doc.text('Vehicle: ' + vehicle.vehicleNo + '  |  LR: ' + vehicle.lrNo, 14, 47);
        doc.text('Unloader: ' + report.unloader + '  |  Date: ' + formatDateTime(report.dateTime), 14, 54);

        var tableData = [];
        for (var i = 0; i < report.lines.length; i++) {
            var l = report.lines[i];
            tableData.push([l.invoiceNo, l.material, l.ean, l.invoiceQty, l.scannedQty, (l.difference > 0 ? '+' : '') + l.difference, l.status]);
        }
        doc.autoTable({
            head: [['Invoice', 'Material', 'EAN', 'Inv Qty', 'Scan Qty', 'Diff', 'Status']],
            body: tableData,
            startY: 62,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 229, 160] }
        });
        doc.save('ShortReport_' + report.reportNo + '.pdf');
        showToast('PDF exported!', 'success');
    } catch(e) { showToast('PDF export failed: ' + e.message, 'error'); }
}

// --- POSTING PENDING TAB ---
function renderPostingPending() {
    var pendingVehicles = DB.filter('vehicles', function(v) { return v.status === 'Posting Pending Approval'; });
    var postedVehicles = DB.filter('vehicles', function(v) { return v.status === 'Posted'; });

    var html = '<div class="section-header"><h2><i class="bx bx-clock"></i> Posting Status</h2></div>';

    // Pending
    html += '<div class="card"><div class="card-title" style="color:var(--warning)">Pending Approval (' + pendingVehicles.length + ')</div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>LR</th><th>Unloader</th><th>Report No</th><th>RCV No</th><th>Action</th></tr></thead><tbody>';
    if (pendingVehicles.length === 0) {
        html += '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No pending approvals</td></tr>';
    } else {
        for (var i = 0; i < pendingVehicles.length; i++) {
            var v = pendingVehicles[i];
            html += '<tr><td><strong>' + escapeHtml(v.vehicleNo) + '</strong></td><td>' + escapeHtml(v.lrNo) + '</td>';
            html += '<td>' + escapeHtml(v.assignedToUsername || '-') + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(v.shortReportNo || '-') + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px;color:var(--info)">' + escapeHtml(v.rcvNo || '-') + '</td>';
            html += '<td><div class="table-actions">';
            html += '<button class="btn btn-secondary btn-sm" onclick="viewShortReport(\'' + v.id + '\')"><i class="bx bx-show"></i> View</button>';
            if (checkActionPerm('canApprove')) {
                html += '<button class="btn btn-success btn-sm" onclick="approveVehicle(\'' + v.id + '\')"><i class="bx bx-check"></i> Approve</button>';
                html += '<button class="btn btn-danger btn-sm" onclick="rejectVehicle(\'' + v.id + '\')"><i class="bx bx-x"></i> Reject</button>';
            }
            html += '</div></td></tr>';
        }
    }
    html += '</tbody></table></div></div>';

    // Posted
    html += '<div class="card" style="margin-top:20px"><div class="card-title" style="color:var(--success)">Posted GRN (' + postedVehicles.length + ')</div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>LR</th><th>GRN Numbers</th><th>Report No</th><th>Posted At</th></tr></thead><tbody>';
    if (postedVehicles.length === 0) {
        html += '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No posted vehicles</td></tr>';
    } else {
        for (var j = 0; j < postedVehicles.length; j++) {
            var pv = postedVehicles[j];
            var grnStr = '';
            if (pv.grnNumbers && pv.grnNumbers.length > 0) {
                grnStr = pv.grnNumbers.map(function(g) { return '<span style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(g) + '</span>'; }).join(', ');
            }
            html += '<tr><td><strong>' + escapeHtml(pv.vehicleNo) + '</strong></td><td>' + escapeHtml(pv.lrNo) + '</td>';
            html += '<td>' + grnStr + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(pv.shortReportNo || '-') + '</td>';
            html += '<td style="font-size:12px;color:var(--text-muted)">' + formatDateTime(pv.postedAt) + '</td></tr>';
        }
    }
    html += '</tbody></table></div></div>';
    return html;
}

// --- INBOUND RECORD (Search by Invoice No / GRN No / Report No) ---
function renderInboundRecord() {
    return '<div class="section-header"><h2><i class="bx bx-search-alt-2"></i> Inbound Record Search</h2></div>' +
        '<div class="card" style="margin-bottom:20px"><div class="form-row">' +
        '<div class="form-group"><label>Search by Invoice No / GRN No / Report No / RCV No <span class="req">*</span></label>' +
        '<div style="display:flex;gap:8px"><input type="text" id="searchInvNo" class="form-input" placeholder="e.g. INV-2025-101 or GRN-INV-2025-101 or SRT-2025-0001">' +
        '<button class="btn btn-primary" onclick="loadInboundRecord()"><i class="bx bx-search"></i> Find</button></div></div></div></div>' +
        '<div id="inboundRecordData"></div>';
}

function loadInboundRecord() {
    var search = document.getElementById('searchInvNo').value.trim().toUpperCase();
    if (!search) { showToast('Enter invoice number, GRN no, or report no', 'error'); return; }
    var container = document.getElementById('inboundRecordData');

    // Try to find by invoice no
    var invoice = null;
    var allInvs = DB.get('invoices');
    for (var i = 0; i < allInvs.length; i++) {
        if (allInvs[i].invoiceNo.toUpperCase() === search) { invoice = allInvs[i]; break; }
    }

    // Try GRN
    var grn = null;
    if (!invoice) {
        var allGrns = DB.get('grn_records');
        for (var g = 0; g < allGrns.length; g++) {
            if (allGrns[g].grnNo.toUpperCase() === search) {
                grn = allGrns[g];
                // Get the invoice
                for (var gi = 0; gi < allInvs.length; gi++) {
                    if (allInvs[gi].id === grn.invoiceId) { invoice = allInvs[gi]; break; }
                }
                break;
            }
        }
    }

    // Try Short Report No
    var shortReport = null;
    if (!invoice) {
        var allReports = DB.get('short_reports');
        for (var sr = 0; sr < allReports.length; sr++) {
            if (allReports[sr].reportNo.toUpperCase() === search) {
                shortReport = allReports[sr];
                break;
            }
        }
        // Try RCV No
        if (!shortReport) {
            var allRcvs = DB.get('receiving_docs');
            for (var rc = 0; rc < allRcvs.length; rc++) {
                if (allRcvs[rc].rcvNo.toUpperCase() === search) {
                    shortReport = DB.filter('short_reports', function(r) { return r.rcvNo === allRcvs[rc].rcvNo; })[0] || null;
                    break;
                }
            }
        }
    }

    if (!invoice && !shortReport) {
        container.innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-error-circle"></i><p>No record found for "' + escapeHtml(search) + '"</p></div></div>';
        return;
    }

    var html = '';
    if (invoice) {
        var vehicle = DB.find('vehicles', invoice.vehicleId);
        var materials = DB.filter('invoice_materials', function(m) { return m.invoiceId === invoice.id; });
        var grnRecord = DB.filter('grn_records', function(g) { return g.invoiceId === invoice.id; })[0];
        var sReport = DB.filter('short_reports', function(r) { return r.vehicleId === invoice.vehicleId; })[0];
        var rcvDoc = DB.filter('receiving_docs', function(r) { return r.vehicleId === invoice.vehicleId; })[0];

        html += '<div class="card" style="border-left:4px solid var(--accent)">';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">';
        html += '<div><small style="color:var(--text-muted)">Invoice No</small><div style="font-family:var(--font-display);font-size:14px;color:var(--accent)">' + escapeHtml(invoice.invoiceNo) + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Vehicle No</small><div><strong>' + escapeHtml(vehicle ? vehicle.vehicleNo : '-') + '</strong></div></div>';
        html += '<div><small style="color:var(--text-muted)">LR No</small><div><strong>' + escapeHtml(vehicle ? vehicle.lrNo : '-') + '</strong></div></div>';
        html += '<div><small style="color:var(--text-muted)">GRN No</small><div style="font-family:var(--font-display);color:var(--success)">' + escapeHtml(grnRecord ? grnRecord.grnNo : 'Not Posted') + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Short Report No</small><div style="font-family:var(--font-display);color:var(--warning)">' + escapeHtml(sReport ? sReport.reportNo : '-') + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">RCV No</small><div style="font-family:var(--font-display);color:var(--info)">' + escapeHtml(rcvDoc ? rcvDoc.rcvNo : '-') + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Assigned To (Unload)</small><div>' + escapeHtml(vehicle ? (vehicle.assignedToUsername || '-') : '-') + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Unloaded By</small><div>' + escapeHtml(sReport ? sReport.unloader : '-') + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Posted By</small><div>' + escapeHtml(grnRecord ? grnRecord.postedBy : '-') + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Vehicle Status</small><div><span class="badge badge-' + (vehicle && vehicle.status === 'Posted' ? 'success' : 'warning') + '">' + escapeHtml(vehicle ? vehicle.status : '-') + '</span></div></div>';
        html += '<div><small style="color:var(--text-muted)">Invoice Status</small><div><span class="badge badge-' + (invoice.status === 'Posted' ? 'success' : 'warning') + '">' + escapeHtml(invoice.status) + '</span></div></div>';
        html += '<div><small style="color:var(--text-muted)">Posted At</small><div>' + formatDateTime(grnRecord ? grnRecord.postedAt : null) + '</div></div>';
        html += '</div>';

        // Materials table
        html += '<div class="card-title">Materials</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Material</th><th>EAN</th><th>Invoice Qty</th><th>Unloaded Qty</th><th>Diff</th><th>Status</th></tr></thead><tbody>';
        for (var m = 0; m < materials.length; m++) {
            var mat = materials[m];
            var diff = (mat.unloadedQty || 0) - mat.qty;
            var mStatus = diff === 0 ? 'Match' : (diff < 0 ? 'Short' : 'Excess');
            html += '<tr><td>' + (m + 1) + '</td><td>' + escapeHtml(mat.material) + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(mat.ean || '-') + '</td>';
            html += '<td>' + mat.qty + '</td><td>' + (mat.unloadedQty || 0) + '</td>';
            html += '<td class="' + (diff !== 0 ? 'qty-mismatch' : 'qty-match') + '">' + (diff > 0 ? '+' : '') + diff + '</td>';
            html += '<td><span class="badge badge-' + (diff === 0 ? 'success' : 'danger') + '">' + mStatus + '</span></td></tr>';
        }
        html += '</tbody></table></div>';
        html += '</div>';

        // Short Report detail if exists
        if (sReport) {
            html += '<div class="card" style="margin-top:20px;border-left:4px solid var(--warning)"><div class="card-title" style="color:var(--warning)">Short/Excess Report Detail</div>';
            html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Invoice</th><th>Material</th><th>Inv Qty</th><th>Scan Qty</th><th>Diff</th><th>Status</th></tr></thead><tbody>';
            for (var rl = 0; rl < sReport.lines.length; rl++) {
                var line = sReport.lines[rl];
                html += '<tr><td>' + escapeHtml(line.invoiceNo) + '</td><td>' + escapeHtml(line.material) + '</td>';
                html += '<td>' + line.invoiceQty + '</td><td>' + line.scannedQty + '</td>';
                html += '<td class="' + (line.difference !== 0 ? 'qty-mismatch' : 'qty-match') + '">' + (line.difference > 0 ? '+' : '') + line.difference + '</td>';
                html += '<td><span class="badge badge-' + (line.status === 'Match' ? 'success' : (line.status === 'Short' ? 'danger' : 'warning')) + '">' + line.status + '</span></td></tr>';
            }
            html += '</tbody></table></div></div>';
        }
    }

    if (shortReport && !invoice) {
        html += '<div class="card" style="border-left:4px solid var(--warning)">';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">';
        html += '<div><small style="color:var(--text-muted)">Report No</small><div style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(shortReport.reportNo) + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Vehicle</small><div><strong>' + escapeHtml(shortReport.vehicleNo) + '</strong></div></div>';
        html += '<div><small style="color:var(--text-muted)">LR No</small><div>' + escapeHtml(shortReport.lrNo) + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Unloader</small><div>' + escapeHtml(shortReport.unloader) + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Date</small><div>' + formatDateTime(shortReport.dateTime) + '</div></div>';
        html += '<div><small style="color:var(--text-muted)">Status</small><div><span class="badge ' + (shortReport.hasMismatch ? 'badge-danger' : 'badge-success') + '">' + (shortReport.hasMismatch ? 'Has Mismatch' : 'Perfect Match') + '</span></div></div>';
        html += '</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Invoice</th><th>Material</th><th>Inv Qty</th><th>Scan Qty</th><th>Diff</th><th>Status</th></tr></thead><tbody>';
        for (var sl = 0; sl < shortReport.lines.length; sl++) {
            var sLine = shortReport.lines[sl];
            html += '<tr><td>' + escapeHtml(sLine.invoiceNo) + '</td><td>' + escapeHtml(sLine.material) + '</td>';
            html += '<td>' + sLine.invoiceQty + '</td><td>' + sLine.scannedQty + '</td>';
            html += '<td class="' + (sLine.difference !== 0 ? 'qty-mismatch' : 'qty-match') + '">' + (sLine.difference > 0 ? '+' : '') + sLine.difference + '</td>';
            html += '<td><span class="badge badge-' + (sLine.status === 'Match' ? 'success' : 'danger') + '">' + sLine.status + '</span></td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    container.innerHTML = html;
}

// --- INBOUND ROUTER ---
function renderInbound(sub) {
    if (!sub) {
        var allSubs = ['security-gate', 'pending-vehicle', 'unloading-screen', 'posting-pending', 'inbound-record'];
        for (var i = 0; i < allSubs.length; i++) {
            if (checkPermission(allSubs[i])) { sub = allSubs[i]; break; }
        }
        if (!sub) sub = 'security-gate';
    }
    var container = document.getElementById('section-inbound');
    var allowedSubs = [
        { id: 'security-gate', label: 'Security Gate' },
        { id: 'pending-vehicle', label: 'Pending Vehicle' },
        { id: 'unloading-screen', label: 'Unloading Screen' },
        { id: 'posting-pending', label: 'Posting Pending' },
        { id: 'inbound-record', label: 'Inbound Record' }
    ].filter(function(s) { return checkPermission(s.id); });

    var tabBtns = '';
    if (allowedSubs.length > 1) {
        tabBtns = '<div class="tab-bar">';
        for (var t = 0; t < allowedSubs.length; t++) {
            tabBtns += '<button class="tab-btn ' + (sub === allowedSubs[t].id ? 'active' : '') + '" onclick="navigateTo(\'inbound\',\'' + allowedSubs[t].id + '\')">' + allowedSubs[t].label + '</button>';
        }
        tabBtns += '</div>';
    }

    var content = '';
    if (sub === 'security-gate') content = renderSecurityGate();
    else if (sub === 'pending-vehicle') content = renderPendingVehicles();
    else if (sub === 'unloading-screen') content = renderUnloadingScreen();
    else if (sub === 'posting-pending') content = renderPostingPending();
    else if (sub === 'inbound-record') content = renderInboundRecord();
    else content = '<div class="card"><div class="empty-state"><i class="bx bx-error-circle"></i><p>Access Denied</p></div></div>';

    container.innerHTML = tabBtns + content;
}

// ==================== SCANNER ====================
var scannerInstance = null;
var scannerCallback = null;

function openScannerModal(callback) {
    scannerCallback = callback;
    document.getElementById('scannerModal').style.display = 'flex';
}

function closeScannerModal() {
    document.getElementById('scannerModal').style.display = 'none';
    if (scannerInstance) {
        try { scannerInstance.stop(); } catch(e) {}
        scannerInstance = null;
    }
    document.getElementById('qr-reader').innerHTML = '';
}

function startCameraScan() {
    document.getElementById('qr-reader').innerHTML = '';
    try {
        scannerInstance = new Html5Qrcode('qr-reader');
        scannerInstance.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 250, height: 150 } },
            function(decodedText) {
                closeScannerModal();
                if (scannerCallback) scannerCallback(decodedText);
            },
            function() {}
        ).catch(function(err) {
            showToast('Camera error: ' + err, 'error');
        });
    } catch(e) {
        showToast('Scanner init failed', 'error');
    }
}

function focusForBluetoothScanner() {
    closeScannerModal();
    // Create a hidden input for Bluetooth/USB scanner
    var existing = document.getElementById('btScannerHidden');
    if (existing) existing.remove();

    var input = document.createElement('input');
    input.id = 'btScannerHidden';
    input.style.cssText = 'position:fixed;top:-100px;left:-100px;opacity:0;width:1px;height:1px';
    input.placeholder = 'Waiting for scanner...';
    document.body.appendChild(input);
    input.focus();

    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            var val = input.value.trim();
            if (val && scannerCallback) {
                scannerCallback(val);
            }
            input.value = '';
            input.remove();
        }
    });

    showToast('Bluetooth/USB scanner ready! Scan now...', 'info');
    setTimeout(function() { if (document.getElementById('btScannerHidden')) { document.getElementById('btScannerHidden').focus(); } }, 100);
}

// ==================== PLACEHOLDER FUNCTIONS (Parts 2-4 will replace these) ====================
function renderPutaway() {
    document.getElementById('section-putaway').innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-package"></i><p>Putaway Module — Loading in Part 2...</p><small style="color:var(--text-muted)">Say "continue" for Part 2</small></div></div>';
}
function renderPIV() {
    document.getElementById('section-piv').innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-clipboard"></i><p>PIV Module — Loading in Part 2...</p></div></div>';
}
function renderLocationMaster() {
    document.getElementById('section-location').innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-map-pin"></i><p>Location Master — Loading in Part 2...</p></div></div>';
}
function renderRackMaster() {
    document.getElementById('section-rack').innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-grid-alt"></i><p>Rack Master — Loading in Part 2...</p></div></div>';
}
function renderMaterialMaster() {
    document.getElementById('section-material').innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-label"></i><p>Material Master — Loading in Part 2...</p></div></div>';
}
function renderPicking(sub) {
    var sec = document.getElementById('section-picking');
    if (!sec) return;
    sec.innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-box"></i><p>Picking Module — Loading in Part 3...</p></div></div>';
}
function renderLoading(sub) {
    var sec = document.getElementById('section-loading');
    if (!sec) return;
    sec.innerHTML = '<div class="card"><div class="empty-state"><i class="bx bxs-truck"></i><p>Loading Module — Loading in Part 3...</p></div></div>';
}
function renderUserWorkingTime() {
    var sec = document.getElementById('section-user-time');
    if (!sec) return;
    sec.innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-time-five"></i><p>User Working Time — Loading in Part 4...</p></div></div>';
}
function renderAdmin() {
    document.getElementById('section-admin').innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-user-detail"></i><p>Admin Module — Loading in Part 4...</p><small style="color:var(--text-muted)">User management, permissions, role setup</small></div></div>';
}

function renderSettings() {
    var html = '<div class="section-header"><h2><i class="bx bxs-cog"></i> Settings</h2></div>';
    html += '<div class="grid-2">';

    // Theme
    html += '<div class="card"><div class="card-title">Theme</div>';
    html += '<div style="display:flex;gap:12px;margin-top:10px">';
    html += '<button class="btn ' + (APP.theme === 'dark' ? 'btn-primary' : 'btn-secondary') + '" onclick="setTheme(\'dark\')"><i class="bx bx-moon"></i> Dark</button>';
    html += '<button class="btn ' + (APP.theme === 'light' ? 'btn-primary' : 'btn-secondary') + '" onclick="setTheme(\'light\')"><i class="bx bx-sun"></i> Light</button>';
    html += '</div></div>';

    // Session Info
    html += '<div class="card"><div class="card-title">Session Info</div>';
    if (APP.currentUser) {
        var elapsed = Date.now() - APP.sessionStart;
        var mins = Math.floor(elapsed / 60000);
        html += '<div style="margin-top:10px"><small style="color:var(--text-muted)">User:</small> <strong>' + escapeHtml(APP.currentUser.name) + '</strong><br>';
        html += '<small style="color:var(--text-muted)">Role:</small> <span class="badge badge-accent">' + escapeHtml(APP.currentUser.role) + '</span><br>';
        html += '<small style="color:var(--text-muted)">Session Duration:</small> <strong>' + mins + ' minutes</strong><br>';
        html += '<small style="color:var(--text-muted)">Login Time:</small> ' + formatDateTime(new Date(APP.sessionStart)) + '</div>';
    }
    html += '</div>';

    // Data Management
    html += '</div><div class="card" style="margin-top:20px"><div class="card-title">Data Management</div>';
    html += '<div class="form-actions" style="margin-top:10px">';
    html += '<button class="btn btn-warning" onclick="exportAllData()"><i class="bx bx-download"></i> Export All Data (JSON)</button>';
    html += '<label class="btn btn-secondary" style="cursor:pointer"><i class="bx bx-upload"></i> Import Data (JSON)<input type="file" accept=".json" style="display:none" onchange="importAllData(this)"></label>';
    html += '<button class="btn btn-danger" onclick="clearAllData()"><i class="bx bx-trash"></i> Clear All Data</button>';
    html += '</div></div>';

    document.getElementById('section-settings').innerHTML = html;
}

function setTheme(theme) {
    APP.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('wms_theme', theme);
    var icon = document.querySelector('#themeToggle i');
    if (icon) icon.className = theme === 'dark' ? 'bx bx-moon' : 'bx bx-sun';
    renderSettings();
}

function exportAllData() {
    var allKeys = ['users','location_master','material_master','rack_master','vehicles','invoices','invoice_materials','picking_reports','audit_log','notifications','difference_reports','obd_data','picking_assignments','loading_assignments','loading_data','user_sessions','grn_records','short_reports','receiving_docs','loaded_vehicles','picking_done','loading_users'];
    var exportData = {};
    for (var i = 0; i < allKeys.length; i++) {
        var k = allKeys[i];
        var data = DB.get(k);
        if (data.length > 0) exportData[k] = data;
    }
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'WMS_Backup_' + today() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported!', 'success');
    logAction('Settings', 'EXPORT', 'Full data backup exported');
}

function importAllData(input) {
    if (!input.files[0]) return;
    if (!confirm('This will OVERWRITE all existing data. Continue?')) { input.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var data = JSON.parse(e.target.result);
            var count = 0;
            for (var key in data) {
                if (data.hasOwnProperty(key)) {
                    DB.set(key, data[key]);
                    count += data[key].length;
                }
            }
            showToast('Imported ' + count + ' records!', 'success');
            logAction('Settings', 'IMPORT', 'Data imported: ' + count + ' records');
            renderSection(APP.currentSection, APP.currentSub);
        } catch(err) {
            showToast('Invalid JSON file!', 'error');
        }
    };
    reader.readAsText(input.files[0]);
    input.value = '';
}

function clearAllData() {
    if (!confirm('WARNING: This will DELETE ALL DATA permanently. Are you sure?')) return;
    if (!confirm('LAST CHANCE: Type OK to confirm?')) return;
    var allKeys = ['users','location_master','material_master','rack_master','vehicles','invoices','invoice_materials','picking_reports','audit_log','notifications','difference_reports','obd_data','picking_assignments','loading_assignments','loading_data','user_sessions','grn_records','short_reports','receiving_docs','loaded_vehicles','picking_done','loading_users'];
    for (var i = 0; i < allKeys.length; i++) {
        localStorage.removeItem('wms_' + allKeys[i]);
    }
    showToast('All data cleared! Refreshing...', 'warning');
    setTimeout(function() { location.reload(); }, 1500);
}

// ==================== REPORTS (Basic — Enhanced in Part 4) ====================
function renderReports() {
    var html = '<div class="section-header"><h2><i class="bx bxs-bar-chart-alt-2"></i> Reports</h2></div>';
    html += '<div class="kpi-grid">';

    var vehicles = DB.get('vehicles');
    var grns = DB.get('grn_records');
    var shorts = DB.get('short_reports');
    var locs = DB.get('location_master');
    var picks = DB.get('picking_done');
    var loaded = DB.get('loaded_vehicles');

    html += kpiCard('bxs-truck', vehicles.length, 'Total Vehicles');
    html += kpiCard('bx-check-circle', grns.length, 'Total GRN');
    html += kpiCard('bx-error-circle', shorts.filter(function(s) { return s.hasMismatch; }).length, 'Short/Excess Reports');
    html += kpiCard('bxs-package', locs.filter(function(l) { return l.action === 'PUTAWAY'; }).length, 'Total Putaway');
    html += kpiCard('bxs-clipboard', locs.filter(function(l) { return l.action === 'PIV'; }).length, 'Total PIV');
    html += kpiCard('bxs-box', picks.length, 'Picking Done');
    html += kpiCard('bxs-truck', loaded.length, 'Vehicles Loaded');
    html += kpiCard('bxs-receipt', DB.get('audit_log').length, 'Audit Entries');
    html += '</div>';

    // Quick search by any number
    html += '<div class="card" style="margin-top:20px"><div class="card-title">Quick Search by Number</div>';
    html += '<div class="form-row"><div class="form-group"><label>Enter any Report No / GRN No / Invoice No / OBD No</label>';
    html += '<div style="display:flex;gap:8px"><input type="text" id="reportQuickSearch" class="form-input" placeholder="e.g. GRN-INV-2025-101 or SRT-2025-0001 or OBD-001">';
    html += '<button class="btn btn-primary" onclick="quickSearchReport()"><i class="bx bx-search"></i> Search</button></div></div></div>';
    html += '<div id="reportSearchResult"></div></div>';

    document.getElementById('section-reports').innerHTML = html;
}

function quickSearchReport() {
    var search = document.getElementById('reportQuickSearch').value.trim().toUpperCase();
    if (!search) { showToast('Enter a number to search', 'error'); return; }
    var container = document.getElementById('reportSearchResult');
    var html = '';

    // Search GRN
    var grnMatch = DB.filter('grn_records', function(g) { return g.grnNo.toUpperCase().indexOf(search) > -1; });
    if (grnMatch.length > 0) {
        html += '<div class="card" style="margin-top:16px;border-left:4px solid var(--success)"><div class="card-title" style="color:var(--success)">GRN Records Found (' + grnMatch.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>GRN No</th><th>Vehicle</th><th>Invoice</th><th>Posted By</th><th>Date</th></tr></thead><tbody>';
        for (var i = 0; i < grnMatch.length; i++) {
            var g = grnMatch[i];
            html += '<tr><td style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(g.grnNo) + '</td><td>' + escapeHtml(g.vehicleNo) + '</td><td>' + escapeHtml(g.invoiceNo) + '</td><td>' + escapeHtml(g.postedBy) + '</td><td style="font-size:12px">' + formatDateTime(g.postedAt) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    // Search Short Report
    var srtMatch = DB.filter('short_reports', function(s) { return s.reportNo.toUpperCase().indexOf(search) > -1; });
    if (srtMatch.length > 0) {
        html += '<div class="card" style="margin-top:16px;border-left:4px solid var(--warning)"><div class="card-title" style="color:var(--warning)">Short/Excess Reports (' + srtMatch.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Report No</th><th>Vehicle</th><th>Unloader</th><th>Mismatch</th><th>Date</th></tr></thead><tbody>';
        for (var j = 0; j < srtMatch.length; j++) {
            var s = srtMatch[j];
            html += '<tr><td style="font-family:var(--font-display);color:var(--warning)">' + escapeHtml(s.reportNo) + '</td><td>' + escapeHtml(s.vehicleNo) + '</td><td>' + escapeHtml(s.unloader) + '</td><td><span class="badge ' + (s.hasMismatch ? 'badge-danger' : 'badge-success') + '">' + (s.hasMismatch ? 'Yes' : 'No') + '</span></td><td style="font-size:12px">' + formatDateTime(s.dateTime) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    // Search Invoice
    var invMatch = DB.filter('invoices', function(inv) { return inv.invoiceNo.toUpperCase().indexOf(search) > -1; });
    if (invMatch.length > 0) {
        html += '<div class="card" style="margin-top:16px;border-left:4px solid var(--info)"><div class="card-title" style="color:var(--info)">Invoices (' + invMatch.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Invoice No</th><th>Vehicle</th><th>Status</th><th>GRN</th></tr></thead><tbody>';
        for (var k = 0; k < invMatch.length; k++) {
            var inv = invMatch[k];
            var veh = DB.find('vehicles', inv.vehicleId);
            var grnRec = DB.filter('grn_records', function(g) { return g.invoiceId === inv.id; })[0];
            html += '<tr><td style="font-family:var(--font-display);color:var(--info)">' + escapeHtml(inv.invoiceNo) + '</td><td>' + escapeHtml(veh ? veh.vehicleNo : '-') + '</td><td><span class="badge badge-' + (inv.status === 'Posted' ? 'success' : 'warning') + '">' + escapeHtml(inv.status) + '</span></td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(grnRec ? grnRec.grnNo : '-') + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    if (!html) {
        html = '<div class="card" style="margin-top:16px"><div class="empty-state"><i class="bx bx-search-alt"></i><p>No results found for "' + escapeHtml(search) + '"</p></div></div>';
    }
    container.innerHTML = html;
}

// ==================== AUDIT LOG ====================
function renderAuditLog() {
    var allLogs = DB.get('audit_log').reverse();
    var pg = paginate(allLogs, APP.auditPage, APP.auditPerPage);

    var html = '<div class="section-header"><h2><i class="bx bxs-receipt"></i> Audit Log</h2>' +
        '<div style="font-size:12px;color:var(--text-muted)">Total: ' + allLogs.length + ' entries</div></div>';

    // Filter bar
    html += '<div class="card" style="margin-bottom:16px"><div class="form-row">';
    html += '<div class="form-group"><label>Filter by Module</label><select id="auditFilterModule" class="form-input" onchange="APP.auditPage=1;renderAuditLog()"><option value="">All Modules</option>';
    var modules = ['Auth','Security Gate','Inbound','Putaway','PIV','Picking','Loading','Admin','Settings','System'];
    for (var m = 0; m < modules.length; m++) {
        html += '<option value="' + modules[m] + '">' + modules[m] + '</option>';
    }
    html += '</select></div>';
    html += '<div class="form-group"><label>Filter by User</label><input type="text" id="auditFilterUser" class="form-input" placeholder="Username" onchange="APP.auditPage=1;renderAuditLog()"></div>';
    html += '<div class="form-group"><label>Filter by Date</label><input type="date" id="auditFilterDate" class="form-input" onchange="APP.auditPage=1;renderAuditLog()"></div>';
    html += '<div class="form-group"><label>Export</label><button class="btn btn-secondary btn-sm" style="margin-top:20px" onclick="exportAuditLog()"><i class="bx bx-download"></i> Export PDF</button></div>';
    html += '</div></div>';

    // Apply filters
    var filterModule = document.getElementById('auditFilterModule') ? document.getElementById('auditFilterModule').value : '';
    var filterUser = document.getElementById('auditFilterUser') ? document.getElementById('auditFilterUser').value.trim().toLowerCase() : '';
    var filterDate = document.getElementById('auditFilterDate') ? document.getElementById('auditFilterDate').value : '';

    var filtered = allLogs;
    if (filterModule) filtered = filtered.filter(function(l) { return l.module === filterModule; });
    if (filterUser) filtered = filtered.filter(function(l) { return (l.userName || '').toLowerCase().indexOf(filterUser) > -1; });
    if (filterDate) filtered = filtered.filter(function(l) { return l.dateTime && l.dateTime.indexOf(filterDate) > -1; });

    var fpg = paginate(filtered, APP.auditPage, APP.auditPerPage);

    html += '<div class="card"><div class="table-wrapper"><table class="data-table"><thead><tr><th>Action No</th><th>DateTime</th><th>User</th><th>Module</th><th>Action</th><th>Details</th></tr></thead><tbody>';
    if (fpg.items.length === 0) {
        html += '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">No audit entries found</td></tr>';
    } else {
        for (var i = 0; i < fpg.items.length; i++) {
            var log = fpg.items[i];
            html += '<tr><td style="font-family:var(--font-display);font-size:10px;color:var(--accent);white-space:nowrap">' + escapeHtml(log.actionNo) + '</td>';
            html += '<td style="font-size:11px;white-space:nowrap">' + formatDateTime(log.dateTime) + '</td>';
            html += '<td>' + escapeHtml(log.userName) + '</td>';
            html += '<td><span class="badge badge-info">' + escapeHtml(log.module) + '</span></td>';
            html += '<td><strong>' + escapeHtml(log.action) + '</strong></td>';
            html += '<td style="font-size:12px;color:var(--text-secondary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(log.details) + '">' + escapeHtml(log.details) + '</td></tr>';
        }
    }
    html += '</tbody></table></div>';
    html += renderPagination(fpg.pages, APP.auditPage, 'goAuditPage');
    html += '</div>';

    document.getElementById('section-audit').innerHTML = html;
}

function goAuditPage(p) {
    APP.auditPage = p;
    renderAuditLog();
}

function exportAuditLog() {
    try {
        var doc = new jspdf.jsPDF('l', 'mm', 'a4');
        doc.setFontSize(16);
        doc.text('VIP INDUSTRIES LIMITED (MD20) — Audit Log', 14, 15);
        doc.setFontSize(9);
        doc.text('Generated: ' + formatDateTime(new Date()), 14, 22);

        var logs = DB.get('audit_log').reverse();
        var tableData = [];
        for (var i = 0; i < logs.length; i++) {
            var l = logs[i];
            tableData.push([l.actionNo, formatDateTime(l.dateTime), l.userName, l.module, l.action, l.details || '']);
        }
        doc.autoTable({
            head: [['Action No', 'DateTime', 'User', 'Module', 'Action', 'Details']],
            body: tableData,
            startY: 28,
            styles: { fontSize: 7 },
            headStyles: { fillColor: [0, 229, 160] },
            columnStyles: { 0: { cellWidth: 30 }, 5: { cellWidth: 80 } }
        });
        doc.save('AuditLog_' + today() + '.pdf');
        showToast('Audit log exported!', 'success');
    } catch(e) { showToast('Export failed: ' + e.message, 'error'); }
}

// ==================== GLOBAL SEARCH ====================
function performGlobalSearch(query) {
    query = query.trim().toLowerCase();
    if (!query) return;
    var results = [];

    // Search vehicles
    var vehs = DB.filter('vehicles', function(v) {
        return (v.vehicleNo || '').toLowerCase().indexOf(query) > -1 ||
               (v.lrNo || '').toLowerCase().indexOf(query) > -1 ||
               (v.driverName || '').toLowerCase().indexOf(query) > -1;
    });
    for (var i = 0; i < vehs.length; i++) {
        results.push({ type: 'Vehicle', label: vehs[i].vehicleNo + ' (LR: ' + vehs[i].lrNo + ')', action: "navigateTo('inbound','inbound-record')" });
    }

    // Search invoices
    var invs = DB.filter('invoices', function(inv) {
        return (inv.invoiceNo || '').toLowerCase().indexOf(query) > -1;
    });
    for (var j = 0; j < invs.length; j++) {
        results.push({ type: 'Invoice', label: invs[j].invoiceNo, action: "navigateTo('inbound','inbound-record')" });
    }

    // Search materials
    var mats = DB.filter('material_master', function(m) {
        return (m.material || '').toLowerCase().indexOf(query) > -1 ||
               (m.ean || '').toLowerCase().indexOf(query) > -1;
    });
    for (var k = 0; k < mats.length; k++) {
        results.push({ type: 'Material', label: mats[k].material + ' (EAN: ' + mats[k].ean + ')', action: "navigateTo('material')" });
    }

    // Search GRN
    var grns = DB.filter('grn_records', function(g) {
        return (g.grnNo || '').toLowerCase().indexOf(query) > -1;
    });
    for (var g = 0; g < grns.length; g++) {
        results.push({ type: 'GRN', label: grns[g].grnNo, action: "navigateTo('reports')" });
    }

    // Search Short Reports
    var srts = DB.filter('short_reports', function(s) {
        return (s.reportNo || '').toLowerCase().indexOf(query) > -1;
    });
    for (var s = 0; s < srts.length; s++) {
        results.push({ type: 'Report', label: srts[s].reportNo, action: "navigateTo('reports')" });
    }

    if (results.length === 0) {
        showToast('No results found for "' + query + '"', 'info');
        return;
    }

    var html = '<div style="max-height:400px;overflow-y:auto">';
    for (var r = 0; r < Math.min(results.length, 20); r++) {
        var res = results[r];
        html += '<div class="notif-item" style="cursor:pointer" onclick="' + res.action + ';document.getElementById(\'searchInput\').value=\'\';document.getElementById(\'searchDropdown\').remove()">';
        html += '<span class="badge badge-info" style="margin-right:8px">' + res.type + '</span> ' + escapeHtml(res.label);
        html += '</div>';
    }
    html += '</div>';

    // Remove old dropdown
    var old = document.getElementById('searchDropdown');
    if (old) old.remove();

    var dropdown = document.createElement('div');
    dropdown.id = 'searchDropdown';
    dropdown.style.cssText = 'position:fixed;top:50px;left:50%;transform:translateX(-50%);width:500px;max-width:90vw;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.5);z-index:700;overflow:hidden;animation:dropIn .2s ease-out';
    dropdown.innerHTML = '<div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted)">' + results.length + ' results found</div>' + html;
    document.body.appendChild(dropdown);

    // Close on outside click
    setTimeout(function() {
        document.addEventListener('click', function closeSearch(e) {
            if (!e.target.closest('#searchDropdown') && !e.target.closest('#globalSearch')) {
                var dd = document.getElementById('searchDropdown');
                if (dd) dd.remove();
                document.removeEventListener('click', closeSearch);
            }
        });
    }, 100);
}

// ==================== MATRIX ANIMATION (Login Page) ====================
function initMatrix() {
    var canvas = document.getElementById('matrixCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    var cols = Math.floor(canvas.width / 14);
    var drops = [];
    for (var i = 0; i < cols; i++) { drops[i] = Math.random() * -100; }
    var chars = 'VIPINDUSTRIESMD20WMS01';
    function draw() {
        ctx.fillStyle = 'rgba(5, 8, 16, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#00E5A0';
        ctx.font = '13px monospace';
        for (var j = 0; j < drops.length; j++) {
            var text = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillText(text, j * 14, drops[j] * 14);
            if (drops[j] * 14 > canvas.height && Math.random() > 0.975) { drops[j] = 0; }
            drops[j]++;
        }
    }
    setInterval(draw, 50);
    window.addEventListener('resize', function() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

// ==================== SIDEBAR TOGGLE ====================
function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('open');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
}

// ==================== SESSION TIMEOUT ====================
function checkSessionTimeout() {
    if (!APP.sessionStart) return;
    var elapsed = Date.now() - APP.sessionStart;
    if (elapsed >= APP.SESSION_TIMEOUT) {
        showToast('Session expired! Please login again.', 'warning');
        logout();
        return;
    }
    if (elapsed >= APP.SESSION_TIMEOUT - APP.WARNING_BEFORE) {
        var remaining = Math.ceil((APP.SESSION_TIMEOUT - elapsed) / 60000);
        showToast('Session will expire in ' + remaining + ' minutes!', 'warning');
    }
}
setInterval(checkSessionTimeout, 60000);

// ==================== AUTO 6PM DIFFERENCE REPORT ====================
function checkAutoReport() {
    var now = new Date();
    if (now.getHours() === 18 && now.getMinutes() === 0 && now.getSeconds() < 2) {
        var diffReports = DB.filter('difference_reports', function(r) {
            return r.dateTime && r.dateTime.indexOf(today()) > -1;
        });
        if (diffReports.length > 0) {
            var managers = DB.filter('users', function(u) { return u.role === 'Manager' || u.role === 'Super Admin'; });
            for (var i = 0; i < managers.length; i++) {
                addNotification('Daily Difference Report: ' + diffReports.length + ' picking differences logged today.', 'warning', managers[i].username);
            }
            logAction('System', 'AUTO_REPORT', '6PM auto difference report sent. Count: ' + diffReports.length);
        }
    }
}
setInterval(checkAutoReport, 1000);

// ==================== APP INITIALIZATION ====================
function initApp() {
    // Apply saved theme
    document.documentElement.setAttribute('data-theme', APP.theme);
    var themeIcon = document.querySelector('#themeToggle i');
    if (themeIcon) themeIcon.className = APP.theme === 'dark' ? 'bx bx-moon' : 'bx bx-sun';

    // Seed data if first time
    seedData();

    // Check for existing session
    var session = null;
    try { session = JSON.parse(localStorage.getItem('wms_session')); } catch(e) {}
    if (session && session.userId) {
        var user = DB.find('users', session.userId);
        if (user) {
            APP.currentUser = user;
            APP.sessionStart = Date.now();
            // Re-open session record
            DB.add('user_sessions', { userId: user.id, userName: user.name, loginTime: new Date().toISOString(), logoutTime: null, status: 'Active' });
            showMainApp();
            return;
        }
    }

    // Show login
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    initMatrix();
}

function showMainApp() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';

    // Set user info in shell bar
    document.getElementById('userAvatar').textContent = (APP.currentUser.name || 'A').charAt(0).toUpperCase();
    document.getElementById('userName').textContent = APP.currentUser.name;

    // Render sidebar with permissions
    renderSidebar();

    // Update notifications
    updateNotifBadge();

    // Navigate to dashboard
    navigateTo('dashboard');

    // Pull server data in background
    pullAllServerData();

    logAction('System', 'SESSION_START', 'Session started for ' + APP.currentUser.name);
}

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', function() {
    initApp();

    // Login form
    document.getElementById('loginForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var username = document.getElementById('loginUser').value.trim();
        var password = document.getElementById('loginPass').value;
        if (login(username, password)) {
            showMainApp();
        }
    });

    // Menu toggle
    document.getElementById('menuToggle').addEventListener('click', openSidebar);
    document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
    document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', function() {
        setTheme(APP.theme === 'dark' ? 'light' : 'dark');
    });

    // Notification panel
    document.getElementById('notifBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        var panel = document.getElementById('notifPanel');
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) renderNotifPanel();
    });
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBtn')) {
            document.getElementById('notifPanel').classList.remove('open');
        }
    });
    document.getElementById('clearNotifs').addEventListener('click', function() {
        DB.set('notifications', []);
        updateNotifBadge();
        renderNotifPanel();
        showToast('Notifications cleared', 'info');
    });

    // User dropdown
    document.getElementById('userMenu').addEventListener('click', function(e) {
        e.stopPropagation();
        document.getElementById('userDropdown').classList.toggle('open');
    });
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#userMenu')) {
            document.getElementById('userDropdown').classList.remove('open');
        }
    });

    // User menu actions
    document.getElementById('ddProfile').addEventListener('click', function(e) {
        e.preventDefault();
        document.getElementById('userDropdown').classList.remove('open');
        if (APP.currentUser) {
            showModal('My Profile',
                '<div class="form-row">' +
                '<div class="form-group"><label>Name</label><div class="form-input" style="background:var(--bg-secondary)">' + escapeHtml(APP.currentUser.name) + '</div></div>' +
                '<div class="form-group"><label>Username</label><div class="form-input" style="background:var(--bg-secondary)">' + escapeHtml(APP.currentUser.username) + '</div></div>' +
                '<div class="form-group"><label>Role</label><div class="form-input" style="background:var(--bg-secondary)"><span class="badge badge-accent">' + escapeHtml(APP.currentUser.role) + '</span></div></div>' +
                '<div class="form-group"><label>Modules</label><div class="form-input" style="background:var(--bg-secondary);font-size:12px">' + escapeHtml(APP.currentUser.permissions.modules.join(', ')) + '</div></div>' +
                '</div>', 'md', '<button class="btn btn-secondary" onclick="closeModal()">Close</button>');
        }
    });

    document.getElementById('ddPassword').addEventListener('click', function(e) {
        e.preventDefault();
        document.getElementById('userDropdown').classList.remove('open');
        showModal('Change Password',
            '<div class="form-group"><label>Current Password</label><input type="password" id="cpOld" class="form-input" placeholder="Enter current password"></div>' +
            '<div class="form-group"><label>New Password</label><input type="password" id="cpNew" class="form-input" placeholder="Enter new password"></div>' +
            '<div class="form-group"><label>Confirm New Password</label><input type="password" id="cpConfirm" class="form-input" placeholder="Confirm new password"></div>',
            'sm',
            '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
            '<button class="btn btn-primary" onclick="changePassword()"><i class="bx bx-check"></i> Change</button>');
    });

    document.getElementById('ddLogout').addEventListener('click', function(e) {
        e.preventDefault();
        document.getElementById('userDropdown').classList.remove('open');
        if (confirm('Are you sure you want to logout?')) logout();
    });

    // Global search
    document.getElementById('searchInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            performGlobalSearch(this.value);
        }
    });

    // Ctrl+K shortcut
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }
        if (e.key === 'Escape') {
            var dd = document.getElementById('searchDropdown');
            if (dd) dd.remove();
            document.getElementById('notifPanel').classList.remove('open');
            document.getElementById('userDropdown').classList.remove('open');
            closeModal();
            closeScannerModal();
        }
    });

    // 3D Card tilt effect
    document.addEventListener('mousemove', function(e) {
        var cards = document.querySelectorAll('.kpi-card, .card');
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var rect = card.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
                var rotateX = ((y - rect.height / 2) / rect.height) * -4;
                var rotateY = ((x - rect.width / 2) / rect.width) * 4;
                card.style.transform = 'perspective(800px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) translateY(-3px)';
                card.style.transition = 'transform 0.1s ease';
            } else {
                card.style.transform = '';
                card.style.transition = 'transform 0.3s ease';
            }
        }
    });
});

function changePassword() {
    var oldPass = document.getElementById('cpOld').value;
    var newPass = document.getElementById('cpNew').value;
    var confirmPass = document.getElementById('cpConfirm').value;
    if (!oldPass || !newPass || !confirmPass) { showToast('All fields required', 'error'); return; }
    if (oldPass !== APP.currentUser.password) { showToast('Current password is wrong!', 'error'); return; }
    if (newPass.length < 4) { showToast('New password must be at least 4 characters', 'error'); return; }
    if (newPass !== confirmPass) { showToast('New passwords do not match!', 'error'); return; }
    DB.update('users', APP.currentUser.id, { password: newPass });
    APP.currentUser.password = newPass;
    logAction('Auth', 'PASSWORD_CHANGE', 'Password changed for ' + APP.currentUser.name);
    showToast('Password changed successfully!', 'success');
    closeModal();
}
/* ============================================================
   PART 2: PUTAWAY + PIV + LOCATION/BIN MASTER + RACK + MATERIAL
   Developed by Nikhil Patil
   ============================================================ */

// ==================== PUTAWAY ====================
var putawayBuffer = [];

function renderPutaway() {
    var html = '<div class="section-header"><h2><i class="bx bxs-package"></i> Putaway</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="clearPutawayBuffer()"><i class="bx bx-plus"></i> New Entry</button>';
    html += '<button class="btn btn-success btn-sm" onclick="savePutawayBuffer()"><i class="bx bx-save"></i> Save All to Bin Master</button>';
    html += '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload Putaway<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadPutaway(this)"></label>';
    html += '</div></div>';

    // Mode toggle
    html += '<div class="card" style="margin-bottom:16px"><div class="form-group">';
    html += '<label style="margin-bottom:8px;display:block">Putaway Mode</label>';
    html += '<div style="display:flex;gap:12px">';
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid var(--accent);border-radius:8px;background:var(--accent-dim);font-weight:600;color:var(--accent)"><input type="radio" name="putawayMode" value="without" checked style="accent-color:var(--accent);width:16px;height:16px" onchange="togglePutawayInvoiceMode()"> WITHOUT Invoice</label>';
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid var(--border);border-radius:8px;font-weight:600;color:var(--text-secondary)"><input type="radio" name="putawayMode" value="with" style="accent-color:var(--info);width:16px;height:16px" onchange="togglePutawayInvoiceMode()"> WITH Invoice</label>';
    html += '</div></div>';

    // Invoice selector (hidden by default)
    html += '<div id="putawayInvoiceSelector" style="display:none;margin-top:12px"><div class="form-group"><label>Select Invoice</label>';
    html += '<select id="putawayInvoiceSelect" class="form-input" onchange="loadPutawayInvoiceMaterials()"><option value="">-- Select --</option>';
    var postedInvs = DB.filter('invoices', function(inv) { return inv.status === 'Posted'; });
    for (var i = 0; i < postedInvs.length; i++) {
        var veh = DB.find('vehicles', postedInvs[i].vehicleId);
        html += '<option value="' + postedInvs[i].id + '">' + escapeHtml(postedInvs[i].invoiceNo) + ' — ' + escapeHtml(veh ? veh.vehicleNo : '') + '</option>';
    }
    html += '</select></div>';
    html += '<div id="putawayInvoiceMaterials"></div></div>';
    html += '</div>';

    // Scan form
    html += '<div class="card" style="border:2px solid var(--accent);margin-bottom:16px"><div class="card-title" style="color:var(--accent)"><i class="bx bx-scan"></i> Scan & Putaway</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>EAN / Barcode <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:6px"><input type="text" id="putEanInput" class="form-input" placeholder="Scan or type EAN..." style="flex:1" onkeydown="if(event.key===\'Enter\')addPutawayItem()">';
    html += '<button class="btn btn-primary btn-sm" onclick="addPutawayItem()"><i class="bx bx-plus"></i></button>';
    html += '<button class="btn btn-secondary btn-sm scan-btn" onclick="openScannerModal(function(code){document.getElementById(\'putEanInput\').value=code;addPutawayItem()})"><i class="bx bx-qr"></i></button></div></div>';
    html += '<div class="form-group"><label>Material (Auto)</label><input type="text" id="putMaterial" class="form-input" placeholder="Auto from master" readonly style="background:var(--bg-secondary)"></div>';
    html += '<div class="form-group"><label>Description (Auto)</label><input type="text" id="putDesc" class="form-input" placeholder="Auto from master" readonly style="background:var(--bg-secondary)"></div>';
    html += '<div class="form-group"><label>Rack / Location <span class="req">*</span></label>';
    html += '<select id="putRack" class="form-input"><option value="">-- Select Rack --</option>';
    var racks = DB.get('rack_master');
    for (var r = 0; r < racks.length; r++) {
        html += '<option value="' + escapeHtml(racks[r].rack) + '">' + escapeHtml(racks[r].rack) + '</option>';
    }
    html += '</select></div>';
    html += '<div class="form-group"><label>Qty <span class="req">*</span></label><input type="number" id="putQty" class="form-input" value="1" min="1" style="max-width:120px"></div>';
    html += '<div class="form-group"><label>Packing</label><select id="putPacking" class="form-input"><option value="Bag">Bag</option><option value="Box">Box</option><option value="Carton">Carton</option><option value="Pallet">Pallet</option><option value="Bottle">Bottle</option><option value="Pouch">Pouch</option><option value="Loose">Loose</option></select></div>';
    html += '<div class="form-group"><label>Box No</label><input type="text" id="putBoxNo" class="form-input" placeholder="e.g. B001"></div>';
    html += '</div>';
    html += '<div class="form-actions"><button class="btn btn-primary" onclick="addPutawayItem()"><i class="bx bx-plus-circle"></i> Add to Buffer</button></div>';
    html += '</div>';

    // Buffer table
    html += '<div class="card"><div class="card-title">Putaway Buffer (' + putawayBuffer.length + ' items)</div>';
    html += '<div id="putawayBufferTable"></div>';
    if (putawayBuffer.length > 0) {
        html += '<div class="form-actions" style="margin-top:12px"><button class="btn btn-success" onclick="savePutawayBuffer()"><i class="bx bx-save"></i> Save All to Bin Master</button><button class="btn btn-danger" onclick="clearPutawayBuffer()"><i class="bx bx-trash"></i> Clear Buffer</button></div>';
    }
    html += '</div>';

    // Today's putaway history
    var todayPutaway = DB.filter('location_master', function(l) { return l.action === 'PUTAWAY' && l.date === today(); });
    if (todayPutaway.length > 0) {
        html += '<div class="card" style="margin-top:16px"><div class="card-title">Today\'s Putaway (' + todayPutaway.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Time</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>Box</th><th>User</th></tr></thead><tbody>';
        for (var t = 0; t < todayPutaway.length; t++) {
            var tp = todayPutaway[t];
            html += '<tr><td>' + (t + 1) + '</td><td style="font-size:11px;color:var(--text-muted)">' + formatDateTime(tp.dateTime) + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(tp.ean) + '</td>';
            html += '<td>' + escapeHtml(tp.material) + '</td><td><span class="badge badge-accent">' + escapeHtml(tp.rack) + '</span></td>';
            html += '<td><strong>' + tp.quantity + '</strong></td><td>' + escapeHtml(tp.packing) + '</td><td>' + escapeHtml(tp.box) + '</td>';
            html += '<td>' + escapeHtml(tp.user) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    document.getElementById('section-putaway').innerHTML = html;
    renderPutawayBuffer();
}

function togglePutawayInvoiceMode() {
    var mode = document.querySelector('input[name="putawayMode"]:checked').value;
    var selector = document.getElementById('putawayInvoiceSelector');
    if (selector) selector.style.display = mode === 'with' ? 'block' : 'none';
    // Update radio styling
    var labels = document.querySelectorAll('input[name="putawayMode"]');
    for (var i = 0; i < labels.length; i++) {
        var parent = labels[i].closest('label');
        if (labels[i].checked) {
            parent.style.borderColor = labels[i].value === 'without' ? 'var(--accent)' : 'var(--info)';
            parent.style.background = labels[i].value === 'without' ? 'var(--accent-dim)' : 'var(--info-dim)';
            parent.style.color = labels[i].value === 'without' ? 'var(--accent)' : 'var(--info)';
        } else {
            parent.style.borderColor = 'var(--border)';
            parent.style.background = 'transparent';
            parent.style.color = 'var(--text-secondary)';
        }
    }
}

function loadPutawayInvoiceMaterials() {
    var invId = document.getElementById('putawayInvoiceSelect').value;
    var container = document.getElementById('putawayInvoiceMaterials');
    if (!invId) { container.innerHTML = ''; return; }
    var mats = DB.filter('invoice_materials', function(m) { return m.invoiceId === invId; });
    var html = '<div class="table-wrapper" style="margin-top:12px"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Invoice Qty</th><th>Unloaded Qty</th><th>Remaining</th></tr></thead><tbody>';
    for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        var putawayDone = 0;
        // Check how much already putaway for this invoice+material
        var allLoc = DB.get('location_master');
        for (var j = 0; j < allLoc.length; j++) {
            if (allLoc[j].invoiceId === invId && allLoc[j].material === m.material && allLoc[j].action === 'PUTAWAY') {
                putawayDone += allLoc[j].quantity;
            }
        }
        var remaining = (m.unloadedQty || 0) - putawayDone;
        html += '<tr><td>' + escapeHtml(m.material) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(m.ean || '-') + '</td>';
        html += '<td>' + m.qty + '</td><td>' + (m.unloadedQty || 0) + '</td>';
        html += '<td class="' + (remaining > 0 ? 'qty-match' : 'qty-mismatch') + '">' + remaining + '</td></tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function addPutawayItem() {
    var ean = document.getElementById('putEanInput').value.trim();
    var rack = document.getElementById('putRack').value;
    var qty = parseInt(document.getElementById('putQty').value) || 0;
    var packing = document.getElementById('putPacking').value;
    var boxNo = document.getElementById('putBoxNo').value.trim();

    if (!ean) { showToast('Scan or enter EAN', 'error'); return; }
    if (!rack) { showToast('Select a rack', 'error'); return; }
    if (qty <= 0) { showToast('Enter valid qty', 'error'); return; }

    var material = document.getElementById('putMaterial').value.trim();
    var desc = document.getElementById('putDesc').value.trim();

    // Auto-fill from master if empty
    if (!material || !desc) {
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === ean || matMaster[i].material.toUpperCase() === ean.toUpperCase()) {
                material = material || matMaster[i].material;
                desc = desc || matMaster[i].description;
                ean = matMaster[i].ean || ean;
                break;
            }
        }
    }

    if (!material) { showToast('Material not found in master! Enter manually.', 'warning'); }

    // Get invoice ID if in "with invoice" mode
    var invId = '';
    var invNo = '';
    var mode = document.querySelector('input[name="putawayMode"]');
    if (mode && mode.value === 'with') {
        var sel = document.getElementById('putawayInvoiceSelect');
        if (sel && sel.value) {
            invId = sel.value;
            var inv = DB.find('invoices', invId);
            invNo = inv ? inv.invoiceNo : '';
        }
    }

    putawayBuffer.push({
        id: DB.uid(), date: today(), ean: ean, material: material || 'UNKNOWN',
        description: desc || '-', rack: rack, quantity: qty, packing: packing,
        box: boxNo || '-', action: 'PUTAWAY', user: APP.currentUser ? APP.currentUser.name : 'System',
        invoiceId: invId, invoiceNo: invNo, dateTime: new Date().toISOString()
    });

    // Clear inputs
    document.getElementById('putEanInput').value = '';
    document.getElementById('putMaterial').value = '';
    document.getElementById('putDesc').value = '';
    document.getElementById('putQty').value = '1';
    document.getElementById('putBoxNo').value = '';
    document.getElementById('putEanInput').focus();

    renderPutawayBuffer();
    showToast('Added: ' + (material || ean) + ' → ' + rack, 'success');
}

function removePutawayItem(id) {
    putawayBuffer = putawayBuffer.filter(function(p) { return p.id !== id; });
    renderPutawayBuffer();
    renderPutaway(); // Re-render to update count
}

function renderPutawayBuffer() {
    var container = document.getElementById('putawayBufferTable');
    if (!container) return;
    if (putawayBuffer.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">Buffer is empty. Scan items above.</div>';
        return;
    }
    var html = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>Box</th><th>Invoice</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < putawayBuffer.length; i++) {
        var p = putawayBuffer[i];
        html += '<tr><td>' + (i + 1) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(p.ean) + '</td>';
        html += '<td>' + escapeHtml(p.material) + '</td><td><span class="badge badge-accent">' + escapeHtml(p.rack) + '</span></td>';
        html += '<td><strong>' + p.quantity + '</strong></td><td>' + escapeHtml(p.packing) + '</td><td>' + escapeHtml(p.box) + '</td>';
        html += '<td>' + escapeHtml(p.invoiceNo || '-') + '</td>';
        html += '<td><button class="btn btn-danger btn-sm" onclick="removePutawayItem(\'' + p.id + '\')"><i class="bx bx-trash"></i></button></td></tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function savePutawayBuffer() {
    if (putawayBuffer.length === 0) { showToast('Buffer is empty!', 'error'); return; }
    for (var i = 0; i < putawayBuffer.length; i++) {
        var item = Object.assign({}, putawayBuffer[i]);
        delete item.id; // Let DB.add create new id
        DB.add('location_master', item);
    }
    logAction('Putaway', 'SAVE', 'Saved ' + putawayBuffer.length + ' items to bin master');
    showToast(putawayBuffer.length + ' items saved to Bin Master!', 'success');
    var count = putawayBuffer.length;
    putawayBuffer = [];
    renderPutaway();
    addNotification(count + ' items putaway completed by ' + (APP.currentUser ? APP.currentUser.name : 'System'), 'success');
}

function clearPutawayBuffer() {
    if (putawayBuffer.length > 0 && !confirm('Clear all ' + putawayBuffer.length + ' items from buffer?')) return;
    putawayBuffer = [];
    renderPutaway();
}

function bulkUploadPutaway(input) {
    if (!input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (data.length === 0) { showToast('Empty file', 'error'); return; }
            var startRow = (String(data[0][0] || '').toLowerCase().indexOf('ean') > -1 || String(data[0][0] || '').toLowerCase().indexOf('date') > -1) ? 1 : 0;
            var count = 0;
            for (var k = startRow; k < data.length; k++) {
                var r = data[k]; if (!r || !r[1]) continue;
                var ean = String(r[1] || '').trim();
                var material = String(r[2] || '').trim();
                var desc = String(r[3] || '').trim();
                var qty = parseInt(r[4]) || 0;
                var packing = String(r[5] || 'Bag').trim();
                var box = String(r[6] || '-').trim();
                var rack = String(r[7] || '').trim();
                if (ean && material && qty > 0) {
                    DB.add('location_master', {
                        date: String(r[0] || today()), ean: ean, material: material, description: desc,
                        rack: rack || 'UNASSIGNED', quantity: qty, packing: packing, box: box,
                        action: 'PUTAWAY', user: APP.currentUser ? APP.currentUser.name : 'System',
                        dateTime: new Date().toISOString()
                    });
                    count++;
                }
            }
            logAction('Putaway', 'BULK_UPLOAD', 'Bulk uploaded ' + count + ' items');
            showToast('Bulk upload: ' + count + ' items saved!', 'success');
            renderPutaway();
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(input.files[0]);
    input.value = '';
}

// ==================== PIV ====================
var pivLiveActive = false;
var pivLiveItems = [];

function renderPIV() {
    var html = '<div class="section-header"><h2><i class="bx bxs-clipboard"></i> PIV (Physical Inventory Verification)</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="togglePivLive()"><i class="bx bx-play"></i> <span id="pivLiveBtnText">Start Live Scan</span></button>';
    html += '<button class="btn btn-success btn-sm" onclick="savePivData()"><i class="bx bx-save"></i> Save to Bin Master</button>';
    html += '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload PIV<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadPIV(this)"></label>';
    html += '</div></div>';

    // Scan form (same as putaway but PIV action)
    html += '<div class="card" style="border:2px solid var(--accent2);margin-bottom:16px"><div class="card-title" style="color:var(--accent2)"><i class="bx bx-scan"></i> PIV Scan Entry</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>EAN / Barcode <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:6px"><input type="text" id="pivEanInput" class="form-input" placeholder="Scan or type EAN..." style="flex:1" onkeydown="if(event.key===\'Enter\')addPivItem()">';
    html += '<button class="btn btn-primary btn-sm" onclick="addPivItem()"><i class="bx bx-plus"></i></button>';
    html += '<button class="btn btn-secondary btn-sm scan-btn" onclick="openScannerModal(function(code){document.getElementById(\'pivEanInput\').value=code;addPivItem()})"><i class="bx bx-qr"></i></button></div></div>';
    html += '<div class="form-group"><label>Material (Auto)</label><input type="text" id="pivMaterial" class="form-input" placeholder="Auto from master" readonly style="background:var(--bg-secondary)"></div>';
    html += '<div class="form-group"><label>Description (Auto)</label><input type="text" id="pivDesc" class="form-input" placeholder="Auto from master" readonly style="background:var(--bg-secondary)"></div>';
    html += '<div class="form-group"><label>Rack / Location</label>';
    html += '<select id="pivRack" class="form-input"><option value="">-- Select Rack --</option>';
    var racks = DB.get('rack_master');
    for (var r = 0; r < racks.length; r++) {
        html += '<option value="' + escapeHtml(racks[r].rack) + '">' + escapeHtml(racks[r].rack) + '</option>';
    }
    html += '</select></div>';
    html += '<div class="form-group"><label>Qty</label><input type="number" id="pivQty" class="form-input" value="1" min="1" style="max-width:120px"></div>';
    html += '<div class="form-group"><label>Packing</label><select id="pivPacking" class="form-input"><option value="Bag">Bag</option><option value="Box">Box</option><option value="Carton">Carton</option><option value="Pallet">Pallet</option><option value="Bottle">Bottle</option><option value="Pouch">Pouch</option><option value="Loose">Loose</option></select></div>';
    html += '<div class="form-group"><label>Box No</label><input type="text" id="pivBoxNo" class="form-input" placeholder="e.g. B001"></div>';
    html += '</div>';
    html += '<div class="form-actions"><button class="btn btn-primary" onclick="addPivItem()"><i class="bx bx-plus-circle"></i> Add PIV Entry</button></div>';
    html += '</div>';

    // Live scan indicator
    html += '<div id="pivLiveIndicator" style="display:none;padding:10px;background:var(--accent2-dim);border:1px solid var(--accent2);border-radius:8px;margin-bottom:16px;text-align:center;color:var(--accent2);font-weight:700;animation:pulse 1.5s infinite"><i class="bx bx-broadcast"></i> LIVE SCAN MODE ACTIVE — Each scan saves directly to Bin Master</div>';

    // PIV items table
    html += '<div class="card"><div class="card-title">PIV Entries (This Session: ' + pivLiveItems.length + ')</div>';
    html += '<div id="pivItemsTable"></div>';
    html += '</div>';

    // Today's PIV history
    var todayPiv = DB.filter('location_master', function(l) { return l.action === 'PIV' && l.date === today(); });
    if (todayPiv.length > 0) {
        html += '<div class="card" style="margin-top:16px"><div class="card-title">Today\'s PIV History (' + todayPiv.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Time</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>Box</th><th>User</th></tr></thead><tbody>';
        for (var t = 0; t < todayPiv.length; t++) {
            var tp = todayPiv[t];
            html += '<tr><td>' + (t + 1) + '</td><td style="font-size:11px;color:var(--text-muted)">' + formatDateTime(tp.dateTime) + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(tp.ean) + '</td>';
            html += '<td>' + escapeHtml(tp.material) + '</td><td><span class="badge badge-accent">' + escapeHtml(tp.rack) + '</span></td>';
            html += '<td><strong>' + tp.quantity + '</strong></td><td>' + escapeHtml(tp.packing) + '</td><td>' + escapeHtml(tp.box) + '</td>';
            html += '<td>' + escapeHtml(tp.user) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    document.getElementById('section-piv').innerHTML = html;
    renderPivItems();
}

function togglePivLive() {
    pivLiveActive = !pivLiveActive;
    var btn = document.getElementById('pivLiveBtnText');
    var indicator = document.getElementById('pivLiveIndicator');
    if (pivLiveActive) {
        if (btn) btn.textContent = 'Stop Live Scan';
        if (indicator) indicator.style.display = 'block';
        document.getElementById('pivEanInput').focus();
        showToast('LIVE SCAN ON — Each scan saves directly!', 'warning');
    } else {
        if (btn) btn.textContent = 'Start Live Scan';
        if (indicator) indicator.style.display = 'none';
        showToast('Live scan stopped', 'info');
    }
}

function addPivItem() {
    var ean = document.getElementById('pivEanInput').value.trim();
    var rack = document.getElementById('pivRack').value || 'UNASSIGNED';
    var qty = parseInt(document.getElementById('pivQty').value) || 1;
    var packing = document.getElementById('pivPacking').value;
    var boxNo = document.getElementById('pivBoxNo').value.trim();

    if (!ean) { showToast('Scan or enter EAN', 'error'); return; }

    var material = document.getElementById('pivMaterial').value.trim();
    var desc = document.getElementById('pivDesc').value.trim();

    // Auto-fill from master
    if (!material || !desc) {
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === ean || matMaster[i].material.toUpperCase() === ean.toUpperCase()) {
                material = material || matMaster[i].material;
                desc = desc || matMaster[i].description;
                ean = matMaster[i].ean || ean;
                break;
            }
        }
    }

    var item = {
        id: DB.uid(), date: today(), ean: ean, material: material || 'UNKNOWN',
        description: desc || '-', rack: rack, quantity: qty, packing: packing,
        box: boxNo || '-', action: 'PIV', user: APP.currentUser ? APP.currentUser.name : 'System',
        dateTime: new Date().toISOString()
    };

    // LIVE MODE: Save directly to bin master
    if (pivLiveActive) {
        var saved = DB.add('location_master', item);
        logAction('PIV', 'LIVE_SCAN', 'Live PIV: ' + item.material + ' qty=' + qty + ' at ' + rack);
        showToast('LIVE SAVED: ' + (material || ean), 'success');
    } else {
        pivLiveItems.push(item);
    }

    // Clear inputs
    document.getElementById('pivEanInput').value = '';
    document.getElementById('pivMaterial').value = '';
    document.getElementById('pivDesc').value = '';
    document.getElementById('pivQty').value = '1';
    document.getElementById('pivBoxNo').value = '';
    document.getElementById('pivEanInput').focus();

    if (!pivLiveActive) {
        renderPivItems();
        showToast('Added: ' + (material || ean), 'success');
    }
}

function removePivItem(id) {
    pivLiveItems = pivLiveItems.filter(function(p) { return p.id !== id; });
    renderPivItems();
}

function renderPivItems() {
    var container = document.getElementById('pivItemsTable');
    if (!container) return;
    if (pivLiveItems.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">No PIV entries yet. ' + (pivLiveActive ? 'Live mode ON — just scan!' : 'Scan items or enable Live mode.') + '</div>';
        return;
    }
    var html = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>Box</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < pivLiveItems.length; i++) {
        var p = pivLiveItems[i];
        html += '<tr><td>' + (i + 1) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(p.ean) + '</td>';
        html += '<td>' + escapeHtml(p.material) + '</td><td><span class="badge badge-accent">' + escapeHtml(p.rack) + '</span></td>';
        html += '<td><strong>' + p.quantity + '</strong></td><td>' + escapeHtml(p.packing) + '</td><td>' + escapeHtml(p.box) + '</td>';
        html += '<td><button class="btn btn-danger btn-sm" onclick="removePivItem(\'' + p.id + '\')"><i class="bx bx-trash"></i></button></td></tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function savePivData() {
    if (pivLiveItems.length === 0) { showToast('No PIV entries to save!', 'error'); return; }
    for (var i = 0; i < pivLiveItems.length; i++) {
        var item = Object.assign({}, pivLiveItems[i]);
        delete item.id;
        DB.add('location_master', item);
    }
    logAction('PIV', 'SAVE', 'Saved ' + pivLiveItems.length + ' PIV items to bin master');
    showToast(pivLiveItems.length + ' PIV items saved to Bin Master!', 'success');
    var count = pivLiveItems.length;
    pivLiveItems = [];
    renderPIV();
    addNotification(count + ' PIV items saved by ' + (APP.currentUser ? APP.currentUser.name : 'System'), 'info');
}

function bulkUploadPIV(input) {
    if (!input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (data.length === 0) { showToast('Empty file', 'error'); return; }
            var startRow = (String(data[0][0] || '').toLowerCase().indexOf('ean') > -1 || String(data[0][0] || '').toLowerCase().indexOf('date') > -1) ? 1 : 0;
            var count = 0;
            for (var k = startRow; k < data.length; k++) {
                var r = data[k]; if (!r || !r[1]) continue;
                var ean = String(r[1] || '').trim();
                var material = String(r[2] || '').trim();
                var desc = String(r[3] || '').trim();
                var qty = parseInt(r[4]) || 0;
                var packing = String(r[5] || 'Bag').trim();
                var box = String(r[6] || '-').trim();
                if (ean && material && qty > 0) {
                    DB.add('location_master', {
                        date: String(r[0] || today()), ean: ean, material: material, description: desc,
                        rack: 'UNASSIGNED', quantity: qty, packing: packing, box: box,
                        action: 'PIV', user: APP.currentUser ? APP.currentUser.name : 'System',
                        dateTime: new Date().toISOString()
                    });
                    count++;
                }
            }
            logAction('PIV', 'BULK_UPLOAD', 'Bulk uploaded ' + count + ' PIV items');
            showToast('PIV Bulk upload: ' + count + ' items!', 'success');
            renderPIV();
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(input.files[0]);
    input.value = '';
}

// ==================== LOCATION MASTER ====================
function renderLocationMaster() {
    var locations = DB.get('location_master');
    var search = document.getElementById('locSearchInput') ? document.getElementById('locSearchInput').value.trim().toLowerCase() : '';
    var filterRack = document.getElementById('locRackFilter') ? document.getElementById('locRackFilter').value : '';
    var filterAction = document.getElementById('locActionFilter') ? document.getElementById('locActionFilter').value : '';

    // Apply filters
    var filtered = locations;
    if (search) {
        filtered = filtered.filter(function(l) {
            return (l.rack || '').toLowerCase().indexOf(search) > -1 ||
                (l.material || '').toLowerCase().indexOf(search) > -1 ||
                (l.ean || '').toLowerCase().indexOf(search) > -1 ||
                (l.description || '').toLowerCase().indexOf(search) > -1 ||
                String(l.quantity || '').indexOf(search) > -1;
        });
    }
    if (filterRack) {
        filtered = filtered.filter(function(l) { return l.rack === filterRack; });
    }
    if (filterAction) {
        filtered = filtered.filter(function(l) { return l.action === filterAction; });
    }

    // Sort newest first
    filtered.sort(function(a, b) { return new Date(b.createdAt || b.dateTime || 0) - new Date(a.createdAt || a.dateTime || 0); });

    var pg = paginate(filtered, APP.locPage, APP.locPerPage);
    var racks = DB.get('rack_master');
    var rackOptions = '<option value="">All Racks</option>';
    for (var r = 0; r < racks.length; r++) {
        rackOptions += '<option value="' + escapeHtml(racks[r].rack) + '"' + (filterRack === racks[r].rack ? ' selected' : '') + '>' + escapeHtml(racks[r].rack) + '</option>';
    }

    // Total quantity in warehouse
    var totalQty = 0;
    for (var tq = 0; tq < locations.length; tq++) {
        totalQty += (Number(locations[tq].quantity) || 0);
    }

    var html = '<div class="section-header"><h2><i class="bx bxs-map-pin"></i> Location Master</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary" onclick="showAddLocationForm()"><i class="bx bx-plus"></i> Add Location</button>';
    html += '<button class="btn btn-warning" onclick="showBulkLocationUpload()"><i class="bx bx-upload"></i> Bulk Upload</button>';
    html += '<button class="btn btn-secondary" onclick="exportLocationMaster()"><i class="bx bx-download"></i> Export Excel</button>';
    html += '</div></div>';

    // KPI row
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px">';
    html += '<div class="kpi-card"><div class="kpi-value">' + locations.length + '</div><div class="kpi-label">Total Records</div></div>';
    html += '<div class="kpi-card"><div class="kpi-value">' + totalQty + '</div><div class="kpi-label">Total Quantity</div></div>';
    html += '<div class="kpi-card"><div class="kpi-value">' + (filtered.length) + '</div><div class="kpi-label">Filtered Records</div></div>';
    html += '</div>';

    // Filters
    html += '<div class="card" style="margin-bottom:16px"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">';
    html += '<div class="form-group" style="flex:1;min-width:200px"><label>Search</label><input type="text" id="locSearchInput" class="form-input" placeholder="Rack, Material, EAN, Qty..." value="' + escapeHtml(search) + '" oninput="APP.locPage=1;renderLocationMaster()"></div>';
    html += '<div class="form-group" style="min-width:160px"><label>Rack</label><select id="locRackFilter" class="form-input" onchange="APP.locPage=1;renderLocationMaster()">' + rackOptions + '</select></div>';
    html += '<div class="form-group" style="min-width:130px"><label>Action</label><select id="locActionFilter" class="form-input" onchange="APP.locPage=1;renderLocationMaster()"><option value="">All</option><option value="PUTAWAY"' + (filterAction === 'PUTAWAY' ? ' selected' : '') + '>PUTAWAY</option><option value="PIV"' + (filterAction === 'PIV' ? ' selected' : '') + '>PIV</option></select></div>';
    html += '<button class="btn btn-sm btn-secondary" onclick="APP.locPage=1;document.getElementById(\'locSearchInput\').value=\'\';document.getElementById(\'locRackFilter\').value=\'\';document.getElementById(\'locActionFilter\').value=\'\';renderLocationMaster()"><i class="bx bx-refresh"></i> Clear</button>';
    html += '</div></div>';

    // Table
    html += '<div class="card"><div class="card-title">Location Records (' + pg.total + ')</div><div class="table-wrapper"><table class="data-table"><thead><tr>';
    html += '<th>#</th><th>Date</th><th>Rack</th><th>EAN</th><th>Material</th><th>Description</th><th style="color:var(--accent);font-weight:800">Qty</th><th>Packing</th><th>Box</th><th>Action</th><th>User</th><th>Actions</th>';
    html += '</tr></thead><tbody>';
    if (pg.items.length === 0) {
        html += '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:40px"><i class="bx bx-inbox" style="font-size:32px;display:block;margin-bottom:8px"></i>No location records found</td></tr>';
    } else {
        for (var i = 0; i < pg.items.length; i++) {
            var l = pg.items[i];
            var rowNum = (APP.locPage - 1) * APP.locPerPage + i + 1;
            var qtyVal = Number(l.quantity) || 0;
            var qtyClass = qtyVal > 0 ? 'qty-match' : 'qty-mismatch';
            html += '<tr>';
            html += '<td>' + rowNum + '</td>';
            html += '<td style="font-size:12px">' + escapeHtml(l.date || '-') + '</td>';
            html += '<td><strong style="color:var(--accent)">' + escapeHtml(l.rack || '-') + '</strong></td>';
            html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(l.ean || '-') + '</td>';
            html += '<td>' + escapeHtml(l.material || '-') + '</td>';
            html += '<td style="font-size:12px;color:var(--text-secondary)">' + escapeHtml(l.description || '-') + '</td>';
            html += '<td class="' + qtyClass + '" style="font-size:16px;font-weight:800">' + qtyVal + '</td>';
            html += '<td>' + escapeHtml(l.packing || '-') + '</td>';
            html += '<td>' + escapeHtml(l.box || '-') + '</td>';
            html += '<td><span class="badge badge-' + (l.action === 'PUTAWAY' ? 'success' : 'info') + '">' + escapeHtml(l.action || '-') + '</span></td>';
            html += '<td style="font-size:12px;color:var(--text-muted)">' + escapeHtml(l.user || '-') + '</td>';
            html += '<td><div class="table-actions">';
            html += '<button class="btn-icon" title="Edit" onclick="showEditLocation(\'' + l.id + '\')"><i class="bx bx-edit"></i></button>';
            html += '<button class="btn-icon danger" title="Delete" onclick="deleteLocation(\'' + l.id + '\')"><i class="bx bx-trash"></i></button>';
            html += '</div></td>';
            html += '</tr>';
        }
    }
    html += '</tbody></table></div>';
    html += renderPagination(APP.locPage, pg.pages, 'goLocPage');
    html += '</div>';

    var sec = document.getElementById('section-location');
    if (sec) sec.innerHTML = html;
}

function goLocPage(p) {
    if (p < 1) return;
    APP.locPage = p;
    renderLocationMaster();
}

// --- ADD SINGLE LOCATION ---
function showAddLocationForm() {
    var racks = DB.get('rack_master');
    var materials = DB.get('material_master');
    var rackOpts = '<option value="">-- Select Rack --</option>';
    for (var r = 0; r < racks.length; r++) {
        rackOpts += '<option value="' + escapeHtml(racks[r].rack) + '">' + escapeHtml(racks[r].rack) + '</option>';
    }
    var matOpts = '<option value="">-- Select Material --</option>';
    for (var m = 0; m < materials.length; m++) {
        matOpts += '<option value="' + escapeHtml(materials[m].material) + '" data-ean="' + escapeHtml(materials[m].ean || '') + '" data-desc="' + escapeHtml(materials[m].description || '') + '">' + escapeHtml(materials[m].material) + ' (' + escapeHtml(materials[m].ean || 'No EAN') + ')</option>';
    }
    var html = '<div class="form-row">';
    html += '<div class="form-group"><label>Date <span class="req">*</span></label><input type="date" id="locFormDate" class="form-input" value="' + today() + '"></div>';
    html += '<div class="form-group"><label>Rack <span class="req">*</span></label><select id="locFormRack" class="form-input">' + rackOpts + '</select></div>';
    html += '<div class="form-group"><label>Material <span class="req">*</span></label><select id="locFormMaterial" class="form-input" onchange="onLocMaterialChange()">' + matOpts + '</select></div>';
    html += '</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>EAN</label><input type="text" id="locFormEan" class="form-input" placeholder="Auto-filled or scan" readonly style="background:var(--bg-secondary)"></div>';
    html += '<div class="form-group"><label>Description</label><input type="text" id="locFormDesc" class="form-input" placeholder="Auto-filled" readonly style="background:var(--bg-secondary)"></div>';
    html += '<div class="form-group"><label>Quantity <span class="req">*</span></label><input type="number" id="locFormQty" class="form-input" placeholder="Enter quantity" min="0" style="font-size:18px;font-weight:800;color:var(--accent)"></div>';
    html += '</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>Packing</label><input type="text" id="locFormPacking" class="form-input" placeholder="e.g. Bag, Box, Bottle"></div>';
    html += '<div class="form-group"><label>Box No</label><input type="text" id="locFormBox" class="form-input" placeholder="e.g. B001"></div>';
    html += '<div class="form-group"><label>Action <span class="req">*</span></label><select id="locFormAction" class="form-input"><option value="PUTAWAY">PUTAWAY</option><option value="PIV">PIV</option></select></div>';
    html += '</div>';
    showModal('<i class="bx bx-plus-circle"></i> Add Location', html, 'lg',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="saveLocation()"><i class="bx bx-check-circle"></i> Save Location</button>');
}

function onLocMaterialChange() {
    var sel = document.getElementById('locFormMaterial');
    if (sel && sel.selectedOptions[0]) {
        var opt = sel.selectedOptions[0];
        document.getElementById('locFormEan').value = opt.getAttribute('data-ean') || '';
        document.getElementById('locFormDesc').value = opt.getAttribute('data-desc') || '';
    }
}

function saveLocation() {
    var date = document.getElementById('locFormDate').value;
    var rack = document.getElementById('locFormRack').value;
    var material = document.getElementById('locFormMaterial').value;
    var ean = document.getElementById('locFormEan').value.trim();
    var desc = document.getElementById('locFormDesc').value.trim();
    var qtyRaw = document.getElementById('locFormQty').value;
    var packing = document.getElementById('locFormPacking').value.trim();
    var box = document.getElementById('locFormBox').value.trim();
    var action = document.getElementById('locFormAction').value;

    if (!date || !rack || !material) { showToast('Date, Rack and Material are required', 'error'); return; }

    // FIX: Robust quantity parsing
    var qty = Number(qtyRaw);
    if (isNaN(qty) || qtyRaw === '') { showToast('Enter a valid quantity', 'error'); return; }
    if (qty < 0) { showToast('Quantity cannot be negative', 'error'); return; }

    // Check if same rack+ean already exists — if yes, add to quantity
    var existing = DB.filter('location_master', function(l) {
        return l.rack === rack && l.ean === ean && ean !== '';
    });

    if (existing.length > 0) {
        var oldQty = Number(existing[0].quantity) || 0;
        DB.update('location_master', existing[0].id, { quantity: oldQty + qty, date: date, packing: packing, box: box, action: action, user: APP.currentUser ? APP.currentUser.name : 'Admin' });
        logAction('Location Master', 'UPDATE_QTY', 'Added ' + qty + ' to ' + rack + ' / ' + material + '. New qty: ' + (oldQty + qty));
        showToast('Quantity updated! ' + rack + ' now has ' + (oldQty + qty) + ' units', 'success');
    } else {
        DB.add('location_master', {
            date: date, rack: rack, ean: ean, material: material, description: desc,
            quantity: qty, packing: packing, box: box, action: action,
            user: APP.currentUser ? APP.currentUser.name : 'Admin',
            dateTime: new Date().toISOString()
        });
        logAction('Location Master', 'ADD', 'Added ' + material + ' at ' + rack + ', Qty: ' + qty);
        showToast('Location added successfully! Qty: ' + qty, 'success');
    }
    closeModal();
    renderLocationMaster();
}

// --- EDIT LOCATION ---
function showEditLocation(id) {
    var l = DB.find('location_master', id);
    if (!l) { showToast('Record not found', 'error'); return; }
    var racks = DB.get('rack_master');
    var rackOpts = '<option value="">-- Select Rack --</option>';
    for (var r = 0; r < racks.length; r++) {
        rackOpts += '<option value="' + escapeHtml(racks[r].rack) + '"' + (l.rack === racks[r].rack ? ' selected' : '') + '>' + escapeHtml(racks[r].rack) + '</option>';
    }
    var html = '<div class="form-row">';
    html += '<div class="form-group"><label>Date</label><input type="date" id="editLocDate" class="form-input" value="' + escapeHtml(l.date || '') + '"></div>';
    html += '<div class="form-group"><label>Rack</label><select id="editLocRack" class="form-input">' + rackOpts + '</select></div>';
    html += '<div class="form-group"><label>EAN</label><input type="text" id="editLocEan" class="form-input" value="' + escapeHtml(l.ean || '') + '"></div>';
    html += '</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>Material</label><input type="text" id="editLocMaterial" class="form-input" value="' + escapeHtml(l.material || '') + '"></div>';
    html += '<div class="form-group"><label>Description</label><input type="text" id="editLocDesc" class="form-input" value="' + escapeHtml(l.description || '') + '"></div>';
    html += '<div class="form-group"><label>Quantity <span class="req">*</span></label><input type="number" id="editLocQty" class="form-input" value="' + (Number(l.quantity) || 0) + '" min="0" style="font-size:18px;font-weight:800;color:var(--accent)"></div>';
    html += '</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>Packing</label><input type="text" id="editLocPacking" class="form-input" value="' + escapeHtml(l.packing || '') + '"></div>';
    html += '<div class="form-group"><label>Box No</label><input type="text" id="editLocBox" class="form-input" value="' + escapeHtml(l.box || '') + '"></div>';
    html += '<div class="form-group"><label>Action</label><select id="editLocAction" class="form-input"><option value="PUTAWAY"' + (l.action === 'PUTAWAY' ? ' selected' : '') + '>PUTAWAY</option><option value="PIV"' + (l.action === 'PIV' ? ' selected' : '') + '>PIV</option></select></div>';
    html += '</div>';
    showModal('<i class="bx bx-edit"></i> Edit Location', html, 'lg',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="updateLocation(\'' + id + '\')"><i class="bx bx-check-circle"></i> Update</button>');
}

function updateLocation(id) {
    var qtyRaw = document.getElementById('editLocQty').value;
    var qty = Number(qtyRaw);
    if (isNaN(qty) || qtyRaw === '') { showToast('Enter a valid quantity', 'error'); return; }
    if (qty < 0) { showToast('Quantity cannot be negative', 'error'); return; }

    DB.update('location_master', id, {
        date: document.getElementById('editLocDate').value,
        rack: document.getElementById('editLocRack').value,
        ean: document.getElementById('editLocEan').value.trim(),
        material: document.getElementById('editLocMaterial').value.trim(),
        description: document.getElementById('editLocDesc').value.trim(),
        quantity: qty,
        packing: document.getElementById('editLocPacking').value.trim(),
        box: document.getElementById('editLocBox').value.trim(),
        action: document.getElementById('editLocAction').value,
        user: APP.currentUser ? APP.currentUser.name : 'Admin'
    });
    logAction('Location Master', 'EDIT', 'Updated location id=' + id + ', Qty set to: ' + qty);
    showToast('Location updated! Qty: ' + qty, 'success');
    closeModal();
    renderLocationMaster();
}

// --- DELETE LOCATION ---
function deleteLocation(id) {
    var l = DB.find('location_master', id);
    if (!l) return;
    showModal('<i class="bx bx-trash" style="color:var(--danger)"></i> Delete Location',
        '<p>Are you sure you want to delete this location record?</p>' +
        '<div style="background:var(--bg-secondary);padding:12px;border-radius:8px;margin-top:12px;font-size:13px">' +
        '<strong>Rack:</strong> ' + escapeHtml(l.rack) + '<br>' +
        '<strong>Material:</strong> ' + escapeHtml(l.material) + '<br>' +
        '<strong>Qty:</strong> <span style="color:var(--danger);font-weight:800">' + (Number(l.quantity) || 0) + '</span></div>',
        'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-danger" onclick="confirmDeleteLocation(\'' + id + '\')"><i class="bx bx-trash"></i> Delete</button>');
}

function confirmDeleteLocation(id) {
    DB.remove('location_master', id);
    logAction('Location Master', 'DELETE', 'Deleted location id=' + id);
    showToast('Location deleted', 'success');
    closeModal();
    renderLocationMaster();
}

// ==================== BULK UPLOAD — FIXED QTY ISSUE ====================
function showBulkLocationUpload() {
    var html = '<div style="margin-bottom:16px">';
    html += '<div class="form-group"><label>Upload Bulk Data (Excel) <span class="req">*</span></label>';
    html += '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Choose File';
    html += '<input type="file" id="bulkLocFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="document.getElementById(\'bulkLocName\').innerText=this.files[0].name;document.getElementById(\'bulkLocPreviewBtn\').disabled=false"></label>';
    html += '<div id="bulkLocName" style="font-size:12px;color:var(--text-muted);margin-top:5px">No file chosen</div></div>';
    html += '<button id="bulkLocPreviewBtn" class="btn btn-secondary btn-sm" disabled onclick="previewBulkLocation()"><i class="bx bx-eye"></i> Preview Data</button>';
    html += '</div>';

    html += '<div style="background:var(--bg-secondary);padding:14px;border-radius:8px;font-size:12px;color:var(--text-muted);border:1px dashed var(--warning);margin-bottom:16px">';
    html += '<strong style="color:var(--warning)"><i class="bx bx-info-circle"></i> Excel Format (Row 1 = Header):</strong><br>';
    html += '<code style="display:block;margin-top:6px;padding:8px;background:var(--bg-input);border-radius:4px;font-size:11px;color:var(--accent)">';
    html += 'Date | Rack | EAN | Material | Description | Quantity | Packing | Box | Action';
    html += '</code><br>';
    html += '<strong>Important:</strong> Column names must match exactly (case-insensitive).<br>';
    html += 'Quantity column must contain numbers only (no text/spaces).<br>';
    html += 'If same Rack+EAN exists, quantities will be ADDED to existing record.';
    html += '</div>';

    html += '<div id="bulkLocPreviewArea"></div>';

    showModal('<i class="bx bx-upload"></i> Bulk Upload Location Master', html, 'lg',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button id="bulkLocConfirmBtn" class="btn btn-primary" disabled onclick="confirmBulkLocationUpload()"><i class="bx bx-check-double"></i> Confirm Upload</button>');
}

// Store parsed bulk data globally for confirm step
var _bulkLocParsedData = [];

function previewBulkLocation() {
    var fileInput = document.getElementById('bulkLocFile');
    if (!fileInput || !fileInput.files[0]) { showToast('Select a file first', 'error'); return; }

    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });

            if (rawData.length < 2) { showToast('File has no data rows (need header + at least 1 row)', 'error'); return; }

            // ===== FIX: Dynamic column mapping from header =====
            var headerRow = rawData[0].map(function(h) { return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); });
            var colMap = {};
            var possibleColumns = {
                date: ['date', 'dt', 'datee'],
                rack: ['rack', 'rackno', 'rackno', 'racknumber'],
                ean: ['ean', 'eancode', 'barcode', 'bar-code', 'scancode'],
                material: ['material', 'materialcode', 'materialcode', 'matcode', 'materialname', 'item', 'itemcode', 'product'],
                description: ['description', 'desc', 'description', 'materialdesc', 'itemdesc', 'productdesc'],
                quantity: ['quantity', 'qty', 'quantity', 'qty', 'quant', 'amount', 'units', 'stock', 'balance', 'qty', 'qty'],
                packing: ['packing', 'pack', 'packingtype', 'uom', 'unit'],
                box: ['box', 'boxno', 'boxnumber', 'boxno', 'carton', 'cartonno'],
                action: ['action', 'actiontype', 'type', 'transactiontype']
            };

            // Map each field to the first matching column index
            for (var field in possibleColumns) {
                var aliases = possibleColumns[field];
                for (var a = 0; a < aliases.length; a++) {
                    var idx = headerRow.indexOf(aliases[a]);
                    if (idx > -1) {
                        colMap[field] = idx;
                        break;
                    }
                }
            }

            // Log mapping for debugging
            console.log('=== BULK LOCATION COLUMN MAPPING ===');
            console.log('Header row:', rawData[0]);
            console.log('Normalized:', headerRow);
            console.log('Column map:', colMap);

            // Check critical columns
            if (colMap.rack === undefined) {
                showToast('ERROR: "Rack" column not found in header! Found columns: ' + rawData[0].join(', '), 'error');
                return;
            }

            // Parse data rows
            _bulkLocParsedData = [];
            var errors = [];
            for (var k = 1; k < rawData.length; k++) {
                var r = rawData[k];
                if (!r || r.length === 0) continue;

                // Skip completely empty rows
                var hasData = false;
                for (var ci = 0; ci < r.length; ci++) {
                    if (r[ci] !== null && r[ci] !== undefined && String(r[ci]).trim() !== '') { hasData = true; break; }
                }
                if (!hasData) continue;

                // ===== FIX: Robust quantity parsing =====
                var rawQty = (colMap.quantity !== undefined) ? r[colMap.quantity] : 0;
                var parsedQty = 0;

                if (rawQty !== null && rawQty !== undefined && String(rawQty).trim() !== '') {
                    // Remove any non-numeric characters except dot and minus
                    var cleanQtyStr = String(rawQty).replace(/[^\d.\-]/g, '').trim();
                    parsedQty = Number(cleanQtyStr);
                    if (isNaN(parsedQty)) parsedQty = 0;
                    // Ensure non-negative
                    if (parsedQty < 0) parsedQty = 0;
                }

                var row = {
                    date: colMap.date !== undefined ? String(r[colMap.date] || '').trim() : today(),
                    rack: colMap.rack !== undefined ? String(r[colMap.rack] || '').trim() : '',
                    ean: colMap.ean !== undefined ? String(r[colMap.ean] || '').trim() : '',
                    material: colMap.material !== undefined ? String(r[colMap.material] || '').trim() : '',
                    description: colMap.description !== undefined ? String(r[colMap.description] || '').trim() : '',
                    quantity: parsedQty,
                    packing: colMap.packing !== undefined ? String(r[colMap.packing] || '').trim() : '',
                    box: colMap.box !== undefined ? String(r[colMap.box] || '').trim() : '',
                    action: colMap.action !== undefined ? String(r[colMap.action] || '').trim().toUpperCase() : 'PUTAWAY'
                };

                // Validate action
                if (row.action !== 'PUTAWAY' && row.action !== 'PIV') row.action = 'PUTAWAY';

                // Validate date format
                if (row.date && row.date.indexOf('/') > -1) {
                    var parts = row.date.split('/');
                    if (parts.length === 3) {
                        // Try DD/MM/YYYY
                        var tryDate = new Date(parts[2], parts[1] - 1, parts[0]);
                        if (!isNaN(tryDate.getTime())) {
                            row.date = tryDate.toISOString().split('T')[0];
                        }
                    }
                } else if (row.date && row.date.indexOf('-') === -1) {
                    // Might be Excel serial date
                    var excelDate = Number(row.date);
                    if (!isNaN(excelDate) && excelDate > 40000 && excelDate < 60000) {
                        var jsDate = new Date((excelDate - 25569) * 86400 * 1000);
                        row.date = jsDate.toISOString().split('T')[0];
                    }
                }
                if (!row.date || row.date === 'undefined' || row.date === 'NaN-NaN-NaN') row.date = today();

                if (!row.rack) {
                    errors.push('Row ' + (k + 1) + ': Rack is empty — skipped');
                    continue;
                }

                _bulkLocParsedData.push(row);
            }

            if (_bulkLocParsedData.length === 0) {
                showToast('No valid data rows found! ' + (errors.length > 0 ? 'Errors: ' + errors[0] : 'Check your Excel format.'), 'error');
                return;
            }

            // Show preview table
            var previewHtml = '<div style="margin-top:12px">';
            previewHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
            previewHtml += '<strong style="color:var(--accent)"><i class="bx bx-check-circle"></i> Preview: ' + _bulkLocParsedData.length + ' rows parsed</strong>';
            previewHtml += '<span style="font-size:12px;color:var(--text-muted)">Column Map: ' + JSON.stringify(colMap) + '</span>';
            previewHtml += '</div>';

            if (errors.length > 0) {
                previewHtml += '<div style="background:var(--warning-dim);padding:8px 12px;border-radius:6px;margin-bottom:8px;font-size:11px;color:var(--warning)">';
                previewHtml += '<strong>Warnings:</strong><br>';
                for (var ei = 0; ei < Math.min(errors.length, 5); ei++) {
                    previewHtml += '• ' + escapeHtml(errors[ei]) + '<br>';
                }
                if (errors.length > 5) previewHtml += '• ...and ' + (errors.length - 5) + ' more';
                previewHtml += '</div>';
            }

            previewHtml += '<div class="table-wrapper" style="max-height:300px;overflow-y:auto"><table class="data-table"><thead><tr>';
            previewHtml += '<th>#</th><th>Date</th><th>Rack</th><th>EAN</th><th>Material</th><th style="color:var(--accent)">Qty</th><th>Packing</th><th>Box</th><th>Action</th>';
            previewHtml += '</tr></thead><tbody>';
            for (var pi = 0; pi < _bulkLocParsedData.length; pi++) {
                var pr = _bulkLocParsedData[pi];
                var qClass = pr.quantity > 0 ? 'qty-match' : 'qty-mismatch';
                previewHtml += '<tr>';
                previewHtml += '<td>' + (pi + 1) + '</td>';
                previewHtml += '<td style="font-size:11px">' + escapeHtml(pr.date) + '</td>';
                previewHtml += '<td><strong>' + escapeHtml(pr.rack) + '</strong></td>';
                previewHtml += '<td style="font-size:11px">' + escapeHtml(pr.ean) + '</td>';
                previewHtml += '<td>' + escapeHtml(pr.material) + '</td>';
                previewHtml += '<td class="' + qClass + '" style="font-weight:800;font-size:15px">' + pr.quantity + '</td>';
                previewHtml += '<td>' + escapeHtml(pr.packing) + '</td>';
                previewHtml += '<td>' + escapeHtml(pr.box) + '</td>';
                previewHtml += '<td><span class="badge badge-' + (pr.action === 'PUTAWAY' ? 'success' : 'info') + '">' + escapeHtml(pr.action) + '</span></td>';
                previewHtml += '</tr>';
            }
            previewHtml += '</tbody></table></div></div>';

            document.getElementById('bulkLocPreviewArea').innerHTML = previewHtml;
            document.getElementById('bulkLocConfirmBtn').disabled = false;

            // Log the mapping
            console.log('Parsed ' + _bulkLocParsedData.length + ' rows. Sample:', _bulkLocParsedData[0]);

        } catch (err) {
            showToast('Error reading Excel: ' + err.message, 'error');
            console.error('Bulk location upload error:', err);
        }
    };
    reader.readAsArrayBuffer(fileInput.files[0]);
}

function confirmBulkLocationUpload() {
    if (_bulkLocParsedData.length === 0) { showToast('No data to upload', 'error'); return; }

    var addedCount = 0, updatedCount = 0, totalQtyAdded = 0;
    var allLocations = DB.get('location_master');

    for (var i = 0; i < _bulkLocParsedData.length; i++) {
        var row = _bulkLocParsedData[i];
        var qty = Number(row.quantity) || 0;  // ===== FIX: Extra safety =====
        totalQtyAdded += qty;

        // Check duplicate: same rack + ean
        var foundIdx = -1;
        for (var j = 0; j < allLocations.length; j++) {
            if (allLocations[j].rack === row.rack && allLocations[j].ean === row.ean && row.ean !== '') {
                foundIdx = j;
                break;
            }
        }

        if (foundIdx > -1) {
            // Update existing — add quantity
            var oldQty = Number(allLocations[foundIdx].quantity) || 0;
            allLocations[foundIdx].quantity = oldQty + qty;
            allLocations[foundIdx].date = row.date;
            allLocations[foundIdx].material = row.material;
            allLocations[foundIdx].description = row.description;
            allLocations[foundIdx].packing = row.packing;
            allLocations[foundIdx].box = row.box;
            allLocations[foundIdx].action = row.action;
            allLocations[foundIdx].user = APP.currentUser ? APP.currentUser.name : 'Admin';
            allLocations[foundIdx].updatedAt = new Date().toISOString();
            updatedCount++;
        } else {
            // Add new
            allLocations.push({
                id: DB.uid(),
                date: row.date,
                rack: row.rack,
                ean: row.ean,
                material: row.material,
                description: row.description,
                quantity: qty,  // ===== FIX: Using parsed qty, not raw string =====
                packing: row.packing,
                box: row.box,
                action: row.action,
                user: APP.currentUser ? APP.currentUser.name : 'Admin',
                dateTime: new Date().toISOString(),
                createdAt: new Date().toISOString()
            });
            addedCount++;
        }
    }

    // Save all at once
    DB.set('location_master', allLocations);

    logAction('Location Master', 'BULK_UPLOAD', 'Uploaded ' + _bulkLocParsedData.length + ' rows (' + addedCount + ' new, ' + updatedCount + ' updated). Total Qty: ' + totalQtyAdded);
    showToast('Success! ' + addedCount + ' added, ' + updatedCount + ' updated. Total Qty uploaded: ' + totalQtyAdded, 'success');
    _bulkLocParsedData = [];
    closeModal();
    renderLocationMaster();
}

// ==================== EXPORT LOCATION MASTER ====================
function exportLocationMaster() {
    var locations = DB.get('location_master');
    if (locations.length === 0) { showToast('No data to export', 'warning'); return; }

    var exportData = [];
    for (var i = 0; i < locations.length; i++) {
        var l = locations[i];
        exportData.push({
            Date: l.date || '',
            Rack: l.rack || '',
            EAN: l.ean || '',
            Material: l.material || '',
            Description: l.description || '',
            Quantity: Number(l.quantity) || 0,
            Packing: l.packing || '',
            Box: l.box || '',
            Action: l.action || '',
            User: l.user || '',
            'Created At': formatDateTime(l.createdAt || l.dateTime)
        });
    }

    var ws = XLSX.utils.json_to_sheet(exportData);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Location Master');
    XLSX.writeFile(wb, 'Location_Master_' + today() + '.xlsx');
    logAction('Location Master', 'EXPORT', 'Exported ' + locations.length + ' records');
    showToast('Exported ' + locations.length + ' records!', 'success');
}
// ==================== RACK MASTER ====================
function renderRackMaster() {
    var racks = DB.get('rack_master');
    var locations = DB.get('location_master');

    // Build rack occupancy map
    var rackOccupancy = {};
    for (var i = 0; i < locations.length; i++) {
        var r = locations[i].rack;
        if (!rackOccupancy[r]) rackOccupancy[r] = { items: 0, qty: 0, materials: [] };
        rackOccupancy[r].items++;
        rackOccupancy[r].qty += (locations[i].quantity || 0);
        if (rackOccupancy[r].materials.indexOf(locations[i].material) < 0) {
            rackOccupancy[r].materials.push(locations[i].material);
        }
    }

    var occupiedCount = 0;
    for (var j = 0; j < racks.length; j++) {
        if (rackOccupancy[racks[j].rack]) occupiedCount++;
    }

    var html = '<div class="section-header"><h2><i class="bx bxs-grid-alt"></i> Rack Master</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="showAddRackModal()"><i class="bx bx-plus"></i> Add Rack</button>';
    html += '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadRacks(this)"></label>';
    html += '</div></div>';

    // KPIs
    html += '<div class="kpi-grid" style="margin-bottom:20px">';
    html += kpiCard('bxs-grid-alt', racks.length, 'Total Racks');
    html += kpiCard('bx-check-circle', occupiedCount, 'Occupied');
    html += kpiCard('bx-x-circle', racks.length - occupiedCount, 'Empty');
    html += '</div>';

    // Visual Grid
    html += '<div class="card"><div class="card-title">Visual Rack Grid</div>';
    html += '<div class="rack-grid">';
    for (var k = 0; k < racks.length; k++) {
        var rk = racks[k];
        var isOccupied = !!rackOccupancy[rk.rack];
        html += '<div class="rack-cell ' + (isOccupied ? 'occupied' : 'empty') + '" onclick="showRackDetail(\'' + escapeHtml(rk.rack) + '\')" title="' + escapeHtml(rk.rack) + ' — ' + (isOccupied ? 'Occupied' : 'Empty') + '">';
        html += escapeHtml(rk.rack.replace('RACK-', ''));
        html += '</div>';
    }
    html += '</div>';
    html += '<div style="display:flex;gap:16px;margin-top:12px;font-size:12px;color:var(--text-muted)">';
    html += '<span><span class="status-dot green"></span> Occupied</span>';
    html += '<span><span class="status-dot red"></span> Empty</span>';
    html += '</div></div>';

    // Rack list table
    html += '<div class="card" style="margin-top:20px"><div class="card-title">Rack Details</div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Rack</th><th>Status</th><th>Items</th><th>Total Qty</th><th>Materials</th><th>Action</th></tr></thead><tbody>';
    for (var m = 0; m < racks.length; m++) {
        var rack = racks[m];
        var occ = rackOccupancy[rack.rack];
        html += '<tr><td><strong style="font-family:var(--font-display)">' + escapeHtml(rack.rack) + '</strong></td>';
        html += '<td>' + (occ ? '<span class="status-dot green"></span> Occupied' : '<span class="status-dot red"></span> Empty') + '</td>';
        html += '<td>' + (occ ? occ.items : 0) + '</td>';
        html += '<td>' + (occ ? occ.qty : 0) + '</td>';
        html += '<td style="font-size:11px;color:var(--text-secondary)">' + (occ ? occ.materials.slice(0, 3).join(', ') + (occ.materials.length > 3 ? '...' : '') : '-') + '</td>';
        html += '<td><div class="table-actions">';
        html += '<button class="btn btn-secondary btn-sm" onclick="showRackDetail(\'' + escapeHtml(rack.rack) + '\')"><i class="bx bx-show"></i></button>';
        html += '<button class="btn-icon danger" onclick="deleteRack(\'' + rack.id + '\')"><i class="bx bx-trash"></i></button>';
        html += '</div></td></tr>';
    }
    html += '</tbody></table></div></div>';

    document.getElementById('section-rack').innerHTML = html;
}

function showAddRackModal() {
    var html = '<div class="form-group"><label>Rack Name <span class="req">*</span></label><input type="text" id="newRackName" class="form-input" placeholder="e.g. RACK-031"></div>';
    html += '<div style="font-size:12px;color:var(--text-muted)">Or bulk add multiple racks</div>';
    html += '<div class="form-group" style="margin-top:10px"><label>Bulk Add (comma separated)</label><input type="text" id="bulkRackNames" class="form-input" placeholder="e.g. RACK-031,RACK-032,RACK-033"></div>';
    showModal('Add Rack', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="addRack()"><i class="bx bx-check"></i> Add</button>');
}

function addRack() {
    var single = document.getElementById('newRackName').value.trim().toUpperCase();
    var bulk = document.getElementById('bulkRackNames').value.trim().toUpperCase();
    var count = 0;

    if (bulk) {
        var names = bulk.split(',').map(function(n) { return n.trim(); }).filter(function(n) { return n; });
        for (var i = 0; i < names.length; i++) {
            var exists = DB.filter('rack_master', function(r) { return r.rack === names[i]; });
            if (exists.length === 0) { DB.add('rack_master', { rack: names[i] }); count++; }
        }
    } else if (single) {
        var exists2 = DB.filter('rack_master', function(r) { return r.rack === single; });
        if (exists2.length > 0) { showToast('Rack already exists!', 'error'); return; }
        DB.add('rack_master', { rack: single });
        count = 1;
    } else {
        showToast('Enter rack name!', 'error'); return;
    }

    logAction('Rack', 'ADD', 'Added ' + count + ' racks');
    showToast(count + ' rack(s) added!', 'success');
    closeModal();
    renderRackMaster();
}

function deleteRack(id) {
    if (!confirm('Delete this rack?')) return;
    DB.remove('rack_master', id);
    logAction('Rack', 'DELETE', 'Deleted rack');
    showToast('Rack deleted', 'info');
    renderRackMaster();
}

function showRackDetail(rackName) {
    var locs = DB.filter('location_master', function(l) { return l.rack === rackName; });
    var totalQty = 0;
    for (var i = 0; i < locs.length; i++) { totalQty += (locs[i].quantity || 0); }

    var html = '<div style="background:var(--accent-dim);padding:12px;border-radius:8px;margin-bottom:16px;border-left:4px solid var(--accent)">';
    html += '<strong style="font-family:var(--font-display);font-size:16px;color:var(--accent)">' + escapeHtml(rackName) + '</strong><br>';
    html += '<span style="color:var(--text-muted)">Total Items: ' + locs.length + ' | Total Qty: ' + totalQty + '</span></div>';

    if (locs.length === 0) {
        html += '<div style="text-align:center;color:var(--text-muted);padding:30px"><i class="bx bx-box" style="font-size:36px;display:block;margin-bottom:8px"></i>This rack is empty</div>';
    } else {
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Date</th><th>EAN</th><th>Material</th><th>Qty</th><th>Packing</th><th>Box</th><th>Action</th><th>User</th></tr></thead><tbody>';
        for (var j = 0; j < locs.length; j++) {
            var l = locs[j];
            html += '<tr><td style="font-size:11px">' + escapeHtml(l.date) + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(l.ean) + '</td>';
            html += '<td>' + escapeHtml(l.material) + '</td><td><strong>' + l.quantity + '</strong></td>';
            html += '<td>' + escapeHtml(l.packing) + '</td><td>' + escapeHtml(l.box) + '</td>';
            html += '<td><span class="badge ' + (l.action === 'PUTAWAY' ? 'badge-success' : 'badge-info') + '">' + escapeHtml(l.action) + '</span></td>';
            html += '<td style="font-size:11px">' + escapeHtml(l.user) + '</td></tr>';
        }
        html += '</tbody></table></div>';
    }
    showModal('Rack Detail: ' + rackName, html, 'lg', '<button class="btn btn-secondary" onclick="closeModal()">Close</button>');
}

function bulkUploadRacks(input) {
    if (!input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (data.length === 0) { showToast('Empty file', 'error'); return; }
            var startRow = (String(data[0][0] || '').toLowerCase().indexOf('rack') > -1) ? 1 : 0;
            var count = 0;
            for (var k = startRow; k < data.length; k++) {
                var r = data[k]; if (!r || !r[0]) continue;
                var rackName = String(r[0]).trim().toUpperCase();
                if (rackName) {
                    var exists = DB.filter('rack_master', function(rk) { return rk.rack === rackName; });
                    if (exists.length === 0) { DB.add('rack_master', { rack: rackName }); count++; }
                }
            }
            logAction('Rack', 'BULK_UPLOAD', 'Bulk uploaded ' + count + ' racks');
            showToast('Bulk upload: ' + count + ' racks!', 'success');
            renderRackMaster();
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(input.files[0]);
    input.value = '';
}

// ==================== MATERIAL MASTER ====================
function renderMaterialMaster() {
    var allMats = DB.get('material_master');

    // Filters
    var filterSearch = '', filterDivision = '';
    var fSearchEl = document.getElementById('matFilterSearch');
    var fDivEl = document.getElementById('matFilterDivision');
    if (fSearchEl) filterSearch = fSearchEl.value.trim().toLowerCase();
    if (fDivEl) filterDivision = fDivEl.value;

    var filtered = allMats;
    if (filterSearch) filtered = filtered.filter(function(m) {
        return (m.material || '').toLowerCase().indexOf(filterSearch) > -1 ||
               (m.ean || '').toLowerCase().indexOf(filterSearch) > -1 ||
               (m.description || '').toLowerCase().indexOf(filterSearch) > -1;
    });
    if (filterDivision) filtered = filtered.filter(function(m) { return m.division === filterDivision; });

    var pg = paginate(filtered, APP.matPage, APP.matPerPage);

    // Divisions
    var divSet = {};
    for (var i = 0; i < allMats.length; i++) { if (allMats[i].division) divSet[allMats[i].division] = true; }
    var divisions = Object.keys(divSet).sort();

    var html = '<div class="section-header"><h2><i class="bx bxs-label"></i> Material Master</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="showAddMaterialModal()"><i class="bx bx-plus"></i> Add Material</button>';
    html += '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadMaterials(this)"></label>';
    html += '<button class="btn btn-secondary btn-sm" onclick="exportMaterialExcel()"><i class="bx bx-download"></i> Export Excel</button>';
    html += '</div></div>';

    // Filter bar
    html += '<div class="card" style="margin-bottom:16px"><div class="form-row">';
    html += '<div class="form-group"><label>Search (Material / EAN / Desc)</label><input type="text" id="matFilterSearch" class="form-input" placeholder="Search..." value="' + escapeHtml(filterSearch) + '" onkeydown="if(event.key===\'Enter\'){APP.matPage=1;renderMaterialMaster()}"></div>';
    html += '<div class="form-group"><label>Division</label><select id="matFilterDivision" class="form-input" onchange="APP.matPage=1;renderMaterialMaster()"><option value="">All</option>';
    for (var d = 0; d < divisions.length; d++) {
        html += '<option value="' + escapeHtml(divisions[d]) + '"' + (filterDivision === divisions[d] ? ' selected' : '') + '>' + escapeHtml(divisions[d]) + '</option>';
    }
    html += '</select></div>';
    html += '</div></div>';

    // KPI
    html += '<div class="kpi-grid" style="margin-bottom:16px">';
    html += kpiCard('bxs-label', allMats.length, 'Total Materials');
    html += kpiCard('bx-category', divisions.length, 'Divisions');
    html += kpiCard('bx-filter', filtered.length, 'Showing');
    html += '</div>';

    // Table
    html += '<div class="card"><div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Material Code</th><th>Description</th><th>EAN</th><th>Division</th><th>Brand</th><th>Action</th></tr></thead><tbody>';
    if (pg.items.length === 0) {
        html += '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">No materials found</td></tr>';
    } else {
        for (var j = 0; j < pg.items.length; j++) {
            var mat = pg.items[j];
            var globalIdx = (APP.matPage - 1) * APP.matPerPage + j + 1;
            html += '<tr><td>' + globalIdx + '</td>';
            html += '<td><strong>' + escapeHtml(mat.material) + '</strong></td>';
            html += '<td style="font-size:12px;color:var(--text-secondary)">' + escapeHtml(mat.description) + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(mat.ean) + '</td>';
            html += '<td><span class="badge badge-info">' + escapeHtml(mat.division || '-') + '</span></td>';
            html += '<td>' + escapeHtml(mat.brand || '-') + '</td>';
            html += '<td><div class="table-actions">';
            html += '<button class="btn-icon" onclick="showEditMaterialModal(\'' + mat.id + '\')"><i class="bx bx-pencil"></i></button>';
            html += '<button class="btn-icon danger" onclick="deleteMaterial(\'' + mat.id + '\')"><i class="bx bx-trash"></i></button>';
            html += '</div></td></tr>';
        }
    }
    html += '</tbody></table></div>';
    html += renderPagination(pg.pages, APP.matPage, 'goMatPage');
    html += '</div>';

    // Bulk upload format
    html += '<div class="card" style="margin-top:16px"><div class="card-title">Bulk Upload Format (Excel)</div>';
    html += '<div style="background:var(--bg-secondary);padding:12px;border-radius:6px;font-size:12px;color:var(--text-muted);border:1px dashed var(--warning)">';
    html += '<strong style="color:var(--warning)">Column Order:</strong> Material Code | Description | EAN | Division | Brand</div></div>';

    document.getElementById('section-material').innerHTML = html;
}

function goMatPage(p) { APP.matPage = p; renderMaterialMaster(); }

function showAddMaterialModal() {
    var html = '<div class="form-group"><label>Material Code <span class="req">*</span></label><input type="text" id="matCode" class="form-input" placeholder="e.g. VIP PREMIUM RICE 5KG"></div>';
    html += '<div class="form-group"><label>Description</label><input type="text" id="matDesc" class="form-input" placeholder="Product description"></div>';
    html += '<div class="form-group"><label>EAN / Barcode</label><input type="text" id="matEan" class="form-input" placeholder="e.g. 8901234567001"></div>';
    html += '<div class="form-group"><label>Division</label><input type="text" id="matDivision" class="form-input" placeholder="e.g. Rice, Flour, Sugar"></div>';
    html += '<div class="form-group"><label>Brand</label><input type="text" id="matBrand" class="form-input" placeholder="e.g. VIP"></div>';
    showModal('Add Material', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="addMaterial()"><i class="bx bx-check"></i> Add</button>');
}

function addMaterial() {
    var code = document.getElementById('matCode').value.trim();
    if (!code) { showToast('Material code is required', 'error'); return; }
    var exists = DB.filter('material_master', function(m) { return m.material.toUpperCase() === code.toUpperCase(); });
    if (exists.length > 0) { showToast('Material already exists!', 'error'); return; }
    DB.add('material_master', {
        material: code,
        description: document.getElementById('matDesc').value.trim(),
        ean: document.getElementById('matEan').value.trim(),
        division: document.getElementById('matDivision').value.trim(),
        brand: document.getElementById('matBrand').value.trim()
    });
    logAction('Material', 'ADD', 'Added material: ' + code);
    showToast('Material added!', 'success');
    closeModal();
    renderMaterialMaster();
}

function showEditMaterialModal(id) {
    var mat = DB.find('material_master', id);
    if (!mat) return;
    var html = '<div class="form-group"><label>Material Code</label><input type="text" id="editMatCode" class="form-input" value="' + escapeHtml(mat.material) + '" readonly style="background:var(--bg-secondary)"></div>';
    html += '<div class="form-group"><label>Description</label><input type="text" id="editMatDesc" class="form-input" value="' + escapeHtml(mat.description) + '"></div>';
    html += '<div class="form-group"><label>EAN / Barcode</label><input type="text" id="editMatEan" class="form-input" value="' + escapeHtml(mat.ean) + '"></div>';
    html += '<div class="form-group"><label>Division</label><input type="text" id="editMatDiv" class="form-input" value="' + escapeHtml(mat.division) + '"></div>';
    html += '<div class="form-group"><label>Brand</label><input type="text" id="editMatBrand" class="form-input" value="' + escapeHtml(mat.brand) + '"></div>';
    showModal('Edit Material', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="updateMaterial(\'' + id + '\')"><i class="bx bx-check"></i> Update</button>');
}

function updateMaterial(id) {
    DB.update('material_master', id, {
        description: document.getElementById('editMatDesc').value.trim(),
        ean: document.getElementById('editMatEan').value.trim(),
        division: document.getElementById('editMatDiv').value.trim(),
        brand: document.getElementById('editMatBrand').value.trim()
    });
    logAction('Material', 'UPDATE', 'Updated material');
    showToast('Material updated!', 'success');
    closeModal();
    renderMaterialMaster();
}

function deleteMaterial(id) {
    if (!confirm('Delete this material?')) return;
    DB.remove('material_master', id);
    logAction('Material', 'DELETE', 'Deleted material');
    showToast('Material deleted', 'info');
    renderMaterialMaster();
}

function bulkUploadMaterials(input) {
    if (!input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (data.length === 0) { showToast('Empty file', 'error'); return; }
            var startRow = (String(data[0][0] || '').toLowerCase().indexOf('material') > -1) ? 1 : 0;
            var count = 0;
            for (var k = startRow; k < data.length; k++) {
                var r = data[k]; if (!r || !r[0]) continue;
                var code = String(r[0]).trim();
                var exists = DB.filter('material_master', function(m) { return m.material.toUpperCase() === code.toUpperCase(); });
                if (exists.length === 0) {
                    DB.add('material_master', {
                        material: code, description: String(r[1] || '').trim(),
                        ean: String(r[2] || '').trim(), division: String(r[3] || '').trim(),
                        brand: String(r[4] || '').trim()
                    });
                    count++;
                }
            }
            logAction('Material', 'BULK_UPLOAD', 'Bulk uploaded ' + count + ' materials');
            showToast('Bulk upload: ' + count + ' materials!', 'success');
            renderMaterialMaster();
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(input.files[0]);
    input.value = '';
}

function exportMaterialExcel() {
    try {
        var mats = DB.get('material_master');
        var wsData = [['Material Code', 'Description', 'EAN', 'Division', 'Brand']];
        for (var i = 0; i < mats.length; i++) {
            var m = mats[i];
            wsData.push([m.material, m.description, m.ean, m.division, m.brand]);
        }
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, 'Materials');
        XLSX.writeFile(wb, 'Material_Master_' + today() + '.xlsx');
        showToast('Excel exported!', 'success');
    } catch(e) { showToast('Export failed: ' + e.message, 'error'); }
}
/* ============================================================
   PART 3: PICKING + LOADING (Complete Workflow)
   Developed by Nikhil Patil
   ============================================================ */

// ==================== SESSION STATE ====================
var currentPickingSession = null;
var currentLoadingSession = null;

// ==================== PICKING MODULE ====================
function renderPicking(sub) {
    var sec = document.getElementById('section-picking');
    if (!sec) return;
    if (!sub) {
        var allSubs = ['obd-upload', 'picking-assign', 'start-picking', 'picking-done'];
        for (var i = 0; i < allSubs.length; i++) { if (checkPermission(allSubs[i])) { sub = allSubs[i]; break; } }
        if (!sub) sub = 'obd-upload';
    }
    var allowedSubs = [
        { id: 'obd-upload', label: 'OBD Upload' },
        { id: 'picking-assign', label: 'Picking Assign' },
        { id: 'start-picking', label: 'Start Picking' },
        { id: 'picking-done', label: 'Picking Done' }
    ].filter(function(s) { return checkPermission(s.id); });

    var tabBtns = '<div class="tab-bar">';
    for (var t = 0; t < allowedSubs.length; t++) {
        tabBtns += '<button class="tab-btn ' + (sub === allowedSubs[t].id ? 'active' : '') + '" onclick="navigateTo(\'picking\',\'' + allowedSubs[t].id + '\')">' + allowedSubs[t].label + '</button>';
    }
    tabBtns += '</div>';

    var content = '';
    if (sub === 'obd-upload') content = renderOBDUpload();
    else if (sub === 'picking-assign') content = renderPickingAssign();
    else if (sub === 'start-picking') content = renderStartPicking();
    else if (sub === 'picking-done') content = renderPickingDone();
    else content = '<div class="card"><div class="empty-state"><i class="bx bx-error-circle"></i><p>Access Denied</p></div></div>';
    sec.innerHTML = tabBtns + content;
}

// --- OBD UPLOAD ---
function renderOBDUpload() {
    var allObd = DB.get('obd_data');
    var html = '<div class="section-header"><h2><i class="bx bx-upload"></i> OBD Upload</h2>';
    html += '<label class="btn btn-warning"><i class="bx bx-upload"></i> Upload OBD Data (Excel)<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="processOBDUpload(this)"></label></div>';

    html += '<div class="card" style="margin-bottom:16px"><div style="background:var(--bg-secondary);padding:12px;border-radius:6px;font-size:12px;color:var(--text-muted);border:1px dashed var(--warning)">';
    html += '<strong style="color:var(--warning)">Excel Format (Row 1 = Header):</strong><br>';
    html += 'OBD No | Material | Description | EAN | Order Qty | Picking Qty | Customer</div></div>';

    // OBD List with location reports
    html += '<div class="card"><div class="card-title">Uploaded OBDs (' + allObd.length + ')</div>';
    if (allObd.length === 0) {
        html += '<div class="empty-state"><i class="bx bx-inbox"></i><p>No OBDs uploaded yet</p></div>';
    } else {
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Customer</th><th>Materials</th><th>Total Picking Qty</th><th>Location Status</th><th>Picking Status</th><th>Actions</th></tr></thead><tbody>';
        for (var i = 0; i < allObd.length; i++) {
            var obd = allObd[i];
            var totalPick = 0, insufficient = false;
            if (obd.materials) {
                for (var m = 0; m < obd.materials.length; m++) {
                    totalPick += (obd.materials[m].pickingQty || 0);
                    if (obd.materials[m].locationStatus === 'Insufficient') insufficient = true;
                }
            }
            var statusClass = obd.status === 'Loaded' ? 'badge-success' : (obd.status === 'Qty Mismatch' ? 'badge-danger' : 'badge-warning');
            html += '<tr><td style="font-family:var(--font-display);font-size:12px;color:var(--accent)">' + escapeHtml(obd.obdNo) + '</td>';
            html += '<td>' + escapeHtml(obd.customer || '-') + '</td>';
            html += '<td>' + (obd.materials ? obd.materials.length : 0) + '</td>';
            html += '<td><strong>' + totalPick + '</strong></td>';
            html += '<td>' + (insufficient ? '<span class="badge badge-danger">Insufficient Stock</span>' : '<span class="badge badge-success">Sufficient</span>') + '</td>';
            html += '<td><span class="badge ' + statusClass + '">' + escapeHtml(obd.status || 'Pending') + '</span></td>';
            html += '<td><div class="table-actions">';
            html += '<button class="btn btn-secondary btn-sm" onclick="viewOBDReport(\'' + obd.id + '\')"><i class="bx bx-show"></i> Report</button>';
            if (obd.status === 'Pending' || obd.status === 'Assigned') {
                html += '<button class="btn-icon danger" onclick="deleteOBD(\'' + obd.id + '\')"><i class="bx bx-trash"></i></button>';
            }
            html += '</div></td></tr>';
        }
        html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
}

function processOBDUpload(input) {
    if (!input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (data.length === 0) { showToast('Empty file', 'error'); return; }
            var startRow = (String(data[0][0] || '').toLowerCase().indexOf('obd') > -1) ? 1 : 0;

            // Group by OBD No
            var obdMap = {};
            for (var k = startRow; k < data.length; k++) {
                var r = data[k]; if (!r || !r[0]) continue;
                var obdNo = String(r[0] || '').trim();
                var material = String(r[1] || '').trim();
                var desc = String(r[2] || '').trim();
                var ean = String(r[3] || '').trim();
                var orderQty = parseInt(r[4]) || 0;
                var pickingQty = parseInt(r[5]) || 0;
                var customer = String(r[6] || '').trim();
                if (pickingQty === 0) pickingQty = orderQty;

                if (!obdMap[obdNo]) { obdMap[obdNo] = { obdNo: obdNo, customer: customer, materials: [] }; }
                obdMap[obdNo].materials.push({ material: material, description: desc, ean: ean, orderQty: orderQty, pickingQty: pickingQty });
            }

            // Assign locations from bin master
            var binMaster = DB.get('location_master');
            var obdCount = 0, matCount = 0;
            for (var key in obdMap) {
                var obd = obdMap[key];
                for (var mi = 0; mi < obd.materials.length; mi++) {
                    var mat = obd.materials[mi];
                    var locations = [];
                    var totalAvail = 0;
                    for (var bi = 0; bi < binMaster.length; bi++) {
                        if (binMaster[bi].material === mat.material || binMaster[bi].ean === mat.ean) {
                            locations.push({ rack: binMaster[bi].rack, availableQty: binMaster[bi].quantity, ean: binMaster[bi].ean });
                            totalAvail += binMaster[bi].quantity;
                        }
                    }
                    mat.locations = locations;
                    mat.totalAvailable = totalAvail;
                    mat.locationStatus = totalAvail >= mat.pickingQty ? 'Sufficient' : 'Insufficient';
                    matCount++;
                }
                DB.add('obd_data', { obdNo: obd.obdNo, customer: obd.customer, materials: obd.materials, status: 'Pending', assignedPicker: '', assignedLoader: '', pickedItems: [], loadedItems: [], loadingNo: '', vehicleNo: '', securityName: '' });
                obdCount++;
            }
            logAction('Picking', 'OBD_UPLOAD', 'Uploaded ' + obdCount + ' OBDs, ' + matCount + ' materials');
            showToast('Success! ' + obdCount + ' OBDs uploaded with location reports.', 'success');
            renderPicking('obd-upload');
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(input.files[0]);
    input.value = '';
}

function viewOBDReport(obdId) {
    var obd = DB.find('obd_data', obdId);
    if (!obd) return;
    var html = '<div style="background:var(--accent-dim);padding:12px;border-radius:8px;margin-bottom:16px;border-left:4px solid var(--accent)">';
    html += '<strong style="font-family:var(--font-display);font-size:16px;color:var(--accent)">' + escapeHtml(obd.obdNo) + '</strong><br>';
    html += '<span style="color:var(--text-muted)">Customer: ' + escapeHtml(obd.customer || '-') + ' | Status: <span class="badge badge-warning">' + escapeHtml(obd.status) + '</span></span></div>';

    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Material</th><th>Description</th><th>EAN</th><th>Order Qty</th><th>Picking Qty</th><th>Locations Available</th><th>Total Avail</th><th>Status</th></tr></thead><tbody>';
    if (obd.materials) {
        for (var i = 0; i < obd.materials.length; i++) {
            var m = obd.materials[i];
            var locStr = '';
            if (m.locations && m.locations.length > 0) {
                locStr = m.locations.map(function(l) { return escapeHtml(l.rack) + '(' + l.availableQty + ')'; }).join(', ');
            } else {
                locStr = '<span style="color:var(--danger)">No location found</span>';
            }
            html += '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(m.material) + '</td><td style="font-size:12px;color:var(--text-secondary)">' + escapeHtml(m.description) + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(m.ean) + '</td>';
            html += '<td>' + m.orderQty + '</td><td><strong>' + m.pickingQty + '</strong></td>';
            html += '<td style="font-size:11px">' + locStr + '</td>';
            html += '<td>' + (m.totalAvailable || 0) + '</td>';
            html += '<td><span class="badge ' + (m.locationStatus === 'Sufficient' ? 'badge-success' : 'badge-danger') + '">' + escapeHtml(m.locationStatus || '-') + '</span></td></tr>';
        }
    }
    html += '</tbody></table></div>';

    // Show picked items if any
    if (obd.pickedItems && obd.pickedItems.length > 0) {
        html += '<hr class="cyber-line"><div class="card-title" style="color:var(--info)">Picked Items</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>Location</th><th>Expected</th><th>Picked</th><th>Reason</th></tr></thead><tbody>';
        for (var p = 0; p < obd.pickedItems.length; p++) {
            var pi = obd.pickedItems[p];
            html += '<tr><td>' + escapeHtml(pi.material) + '</td><td>' + escapeHtml(pi.location) + '</td>';
            html += '<td>' + pi.expectedQty + '</td><td class="' + (pi.pickedQty < pi.expectedQty ? 'qty-mismatch' : 'qty-match') + '">' + pi.pickedQty + '</td>';
            html += '<td>' + (pi.reason ? '<span class="badge badge-danger">' + escapeHtml(pi.reason) + '</span>' : '<span class="badge badge-success">OK</span>') + '</td></tr>';
        }
        html += '</tbody></table></div>';
    }

    // Show loaded items if any
    if (obd.loadedItems && obd.loadedItems.length > 0) {
        html += '<hr class="cyber-line"><div class="card-title" style="color:var(--success)">Loaded Items</div>';
        html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Vehicle: ' + escapeHtml(obd.vehicleNo || '-') + ' | Security: ' + escapeHtml(obd.securityName || '-') + ' | Loading No: <span style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(obd.loadingNo || '-') + '</span></div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Qty Loaded</th><th>In OBD</th></tr></thead><tbody>';
        for (var li = 0; li < obd.loadedItems.length; li++) {
            var ldi = obd.loadedItems[li];
            html += '<tr><td>' + escapeHtml(ldi.material) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(ldi.ean) + '</td>';
            html += '<td><strong>' + ldi.qty + '</strong></td>';
            html += '<td>' + (ldi.inOBD ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>') + '</td></tr>';
        }
        html += '</tbody></table></div>';
    }

    showModal('OBD Report: ' + obd.obdNo, html, 'lg',
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
        '<button class="btn btn-primary" onclick="exportOBDReport(\'' + obdId + '\')"><i class="bx bx-download"></i> Export PDF</button>');
}

function exportOBDReport(obdId) {
    try {
        var obd = DB.find('obd_data', obdId);
        if (!obd) return;
        var doc = new jspdf.jsPDF();
        doc.setFontSize(16); doc.text('VIP INDUSTRIES LIMITED (MD20)', 14, 20);
        doc.setFontSize(12); doc.text('OBD Picking Report', 14, 28);
        doc.setFontSize(10);
        doc.text('OBD No: ' + obd.obdNo, 14, 38);
        doc.text('Customer: ' + (obd.customer || '-'), 14, 44);
        doc.text('Status: ' + (obd.status || '-'), 14, 50);

        var tableData = [];
        if (obd.materials) {
            for (var i = 0; i < obd.materials.length; i++) {
                var m = obd.materials[i];
                var locStr = '';
                if (m.locations) locStr = m.locations.map(function(l) { return l.rack + '(' + l.availableQty + ')'; }).join(', ');
                tableData.push([m.material, m.ean, m.orderQty, m.pickingQty, locStr, m.totalAvailable || 0, m.locationStatus || '-']);
            }
        }
        doc.autoTable({
            head: [['Material', 'EAN', 'Order Qty', 'Pick Qty', 'Locations', 'Avail', 'Status']],
            body: tableData, startY: 58, styles: { fontSize: 7 },
            headStyles: { fillColor: [0, 229, 160] }
        });

        if (obd.pickedItems && obd.pickedItems.length > 0) {
            var pickData = [];
            for (var p = 0; p < obd.pickedItems.length; p++) {
                var pi = obd.pickedItems[p];
                pickData.push([pi.material, pi.location, pi.expectedQty, pi.pickedQty, pi.reason || 'OK']);
            }
            doc.autoTable({
                head: [['Material', 'Location', 'Expected', 'Picked', 'Reason']],
                body: pickData, startY: doc.lastAutoTable.finalY + 10,
                styles: { fontSize: 7 }, headStyles: { fillColor: [59, 130, 246] }
            });
        }
        doc.save('OBD_' + obd.obdNo + '.pdf');
        showToast('PDF exported!', 'success');
    } catch(e) { showToast('Export failed: ' + e.message, 'error'); }
}

function deleteOBD(obdId) {
    if (!confirm('Delete this OBD?')) return;
    DB.remove('obd_data', obdId);
    logAction('Picking', 'DELETE_OBD', 'Deleted OBD');
    showToast('OBD deleted', 'info');
    renderPicking('obd-upload');
}

// --- PICKING ASSIGN ---
function renderPickingAssign() {
    var pendingObds = DB.filter('obd_data', function(o) { return o.status === 'Pending' || o.status === 'Assigned'; });
    var html = '<div class="section-header"><h2><i class="bx bx-user-plus"></i> Picking Assign</h2></div>';

    html += '<div class="card" style="margin-bottom:16px"><div class="card-title">Assign OBD to Picker</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>Select OBD <span class="req">*</span></label><select id="pickingAssignObd" class="form-input"><option value="">-- Select OBD --</option>';
    for (var i = 0; i < pendingObds.length; i++) {
        html += '<option value="' + pendingObds[i].id + '">' + escapeHtml(pendingObds[i].obdNo) + ' — ' + escapeHtml(pendingObds[i].customer || '') + ' [' + pendingObds[i].status + ']</option>';
    }
    html += '</select></div>';
    html += '<div class="form-group"><label>Picker Username <span class="req">*</span></label><input type="text" id="pickingAssignUser" class="form-input" placeholder="e.g. picker"></div>';
    html += '</div>';
    html += '<div class="form-actions">';
    html += '<button class="btn btn-primary" onclick="assignPickingToUser()"><i class="bx bx-send"></i> Send Picking Report</button>';
    html += '<button class="btn btn-secondary" onclick="assignAllPickingToUser()"><i class="bx bx-send"></i> Send All Pending</button>';
    html += '</div></div>';

    // Assigned list
    var assignedObds = DB.filter('obd_data', function(o) { return o.status === 'Assigned' && o.assignedPicker; });
    if (assignedObds.length > 0) {
        html += '<div class="card"><div class="card-title">Currently Assigned</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Customer</th><th>Assigned To</th><th>Action</th></tr></thead><tbody>';
        for (var j = 0; j < assignedObds.length; j++) {
            var a = assignedObds[j];
            html += '<tr><td style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(a.obdNo) + '</td>';
            html += '<td>' + escapeHtml(a.customer || '-') + '</td><td><strong>' + escapeHtml(a.assignedPicker) + '</strong></td>';
            html += '<td><button class="btn btn-danger btn-sm" onclick="unassignPicking(\'' + a.id + '\')"><i class="bx bx-x"></i> Unassign</button></td></tr>';
        }
        html += '</tbody></table></div></div>';
    }
    return html;
}

function assignPickingToUser() {
    var obdId = document.getElementById('pickingAssignObd').value;
    var username = document.getElementById('pickingAssignUser').value.trim();
    if (!obdId) { showToast('Select an OBD', 'error'); return; }
    if (!username) { showToast('Enter username', 'error'); return; }
    var user = DB.filter('users', function(u) { return u.username === username; });
    if (user.length === 0) { showToast('Username not found!', 'error'); return; }

    DB.update('obd_data', obdId, { status: 'Assigned', assignedPicker: username });
    addNotification('Picking report assigned: OBD sent to ' + username, 'info', username);
    logAction('Picking', 'ASSIGN', 'OBD assigned to ' + username);
    showToast('Picking report sent to ' + username + '!', 'success');
    renderPicking('picking-assign');
}

function assignAllPickingToUser() {
    var username = document.getElementById('pickingAssignUser').value.trim();
    if (!username) { showToast('Enter username first', 'error'); return; }
    var user = DB.filter('users', function(u) { return u.username === username; });
    if (user.length === 0) { showToast('Username not found!', 'error'); return; }
    var pending = DB.filter('obd_data', function(o) { return o.status === 'Pending'; });
    if (pending.length === 0) { showToast('No pending OBDs', 'error'); return; }
    for (var i = 0; i < pending.length; i++) {
        DB.update('obd_data', pending[i].id, { status: 'Assigned', assignedPicker: username });
    }
    addNotification(pending.length + ' OBD picking reports assigned to you', 'info', username);
    logAction('Picking', 'ASSIGN_ALL', pending.length + ' OBDs assigned to ' + username);
    showToast(pending.length + ' OBDs sent to ' + username + '!', 'success');
    renderPicking('picking-assign');
}

function unassignPicking(obdId) {
    DB.update('obd_data', obdId, { status: 'Pending', assignedPicker: '' });
    showToast('Unassigned', 'info');
    renderPicking('picking-assign');
}

// --- START PICKING (Picker's View) ---
function renderStartPicking() {
    if (!APP.currentUser) return '<div class="card"><div class="empty-state"><i class="bx bx-lock"></i><p>Not logged in</p></div></div>';

    var myObds = DB.filter('obd_data', function(o) {
        return o.assignedPicker === APP.currentUser.username && (o.status === 'Assigned' || o.status === 'Picking In Progress');
    });

    var html = '<div class="section-header"><h2><i class="bx bx-box"></i> Start Picking</h2>';
    html += '<div style="color:var(--text-muted);font-size:13px">User: <strong style="color:var(--accent)">' + escapeHtml(APP.currentUser.name) + '</strong> | Assigned OBDs: ' + myObds.length + '</div></div>';

    if (myObds.length === 0) {
        html += '<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No OBDs assigned to you</p><small style="color:var(--text-muted)">Contact admin for picking assignment</small></div></div>';
        return html;
    }

    html += '<div class="card"><div class="card-title">Your Assigned OBDs</div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Customer</th><th>Materials</th><th>Total Pick Qty</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < myObds.length; i++) {
        var obd = myObds[i];
        var totalPick = 0;
        if (obd.materials) { for (var m = 0; m < obd.materials.length; m++) { totalPick += obd.materials[m].pickingQty; } }
        html += '<tr><td style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(obd.obdNo) + '</td>';
        html += '<td>' + escapeHtml(obd.customer || '-') + '</td><td>' + (obd.materials ? obd.materials.length : 0) + '</td>';
        html += '<td><strong>' + totalPick + '</strong></td>';
        html += '<td><span class="badge badge-warning">' + escapeHtml(obd.status) + '</span></td>';
        html += '<td><button class="btn btn-primary btn-sm" onclick="openPickingSession(\'' + obd.id + '\')"><i class="bx bx-play"></i> Start Picking</button></td></tr>';
    }
    html += '</tbody></table></div></div>';

    // Active picking session area
    html += '<div id="pickingSessionArea"></div>';
    return html;
}

function openPickingSession(obdId) {
    var obd = DB.find('obd_data', obdId);
    if (!obd) return;
    DB.update('obd_data', obdId, { status: 'Picking In Progress' });
    logAction('Picking', 'START', 'Started picking OBD ' + obd.obdNo);

    // Initialize session
    currentPickingSession = { obdId: obdId, items: [] };
    if (obd.pickedItems && obd.pickedItems.length > 0) {
        currentPickingSession.items = obd.pickedItems.map(function(pi) { return Object.assign({}, pi); });
    } else if (obd.materials) {
        for (var i = 0; i < obd.materials.length; i++) {
            var m = obd.materials[i];
            var locStr = '';
            if (m.locations && m.locations.length > 0) {
                locStr = m.locations[0].rack;
            }
            currentPickingSession.items.push({
                id: DB.uid(), material: m.material, ean: m.ean, description: m.description,
                location: locStr, expectedQty: m.pickingQty, pickedQty: m.pickingQty,
                reason: '', reasonDetail: ''
            });
        }
    }

    renderPickingSessionUI();
}

function renderPickingSessionUI() {
    var area = document.getElementById('pickingSessionArea');
    if (!area || !currentPickingSession) return;
    var obd = DB.find('obd_data', currentPickingSession.obdId);

    var html = '<div class="card" style="border:2px solid var(--info);margin-top:16px">';
    html += '<div class="card-title" style="color:var(--info)"><i class="bx bx-clipboard"></i> Picking Report — ' + escapeHtml(obd.obdNo) + ' | Customer: ' + escapeHtml(obd.customer || '-') + '</div>';

    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Material</th><th>EAN</th><th>Location</th><th>Expected Qty</th><th>Picked Qty</th><th>Reason</th><th>Actions</th></tr></thead><tbody>';
    for (var i = 0; i < currentPickingSession.items.length; i++) {
        var item = currentPickingSession.items[i];
        var hasReason = item.reason && item.reason !== '';
        var rowStyle = hasReason ? 'style="background:var(--danger-dim)"' : '';
        html += '<tr ' + rowStyle + '><td>' + (i + 1) + '</td>';
        html += '<td>' + escapeHtml(item.material) + '</td>';
        html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(item.ean) + '</td>';
        html += '<td><span class="badge badge-accent">' + escapeHtml(item.location) + '</span></td>';
        html += '<td>' + item.expectedQty + '</td>';
        html += '<td id="pickQty_' + item.id + '" class="' + (item.pickedQty < item.expectedQty ? 'qty-mismatch' : 'qty-match') + '"><strong>' + item.pickedQty + '</strong></td>';
        html += '<td>' + (hasReason ? '<span class="badge badge-danger">' + escapeHtml(item.reason) + '</span>' : '<span class="badge badge-success">OK</span>') + '</td>';
        html += '<td><div class="table-actions">';
        html += '<button class="btn btn-secondary btn-sm" onclick="editPickedQty(\'' + item.id + '\')"><i class="bx bx-pencil"></i> Edit</button>';
        html += '<button class="btn btn-warning btn-sm" onclick="givePickingReason(\'' + item.id + '\')"><i class="bx bx-error"></i> Reason</button>';
        html += '</div></td></tr>';
    }
    html += '</tbody></table></div>';

    html += '<hr class="cyber-line">';
    html += '<div class="form-actions">';
    html += '<button class="btn btn-danger" onclick="cancelPickingSession()"><i class="bx bx-x"></i> Cancel</button>';
    html += '<button class="btn btn-primary" onclick="submitPicking()"><i class="bx bx-check-double"></i> Submit Picking</button>';
    html += '</div></div>';

    area.innerHTML = html;
}

function editPickedQty(itemId) {
    var item = null;
    for (var i = 0; i < currentPickingSession.items.length; i++) {
        if (currentPickingSession.items[i].id === itemId) { item = currentPickingSession.items[i]; break; }
    }
    if (!item) return;
    var html = '<div class="form-group"><label>Material</label><div class="form-input" style="background:var(--bg-secondary)">' + escapeHtml(item.material) + '</div></div>';
    html += '<div class="form-group"><label>Location</label><div class="form-input" style="background:var(--bg-secondary)">' + escapeHtml(item.location) + '</div></div>';
    html += '<div class="form-group"><label>Expected Qty</label><div class="form-input" style="background:var(--bg-secondary)">' + item.expectedQty + '</div></div>';
    html += '<div class="form-group"><label>Picked Qty <span class="req">*</span></label><input type="number" id="editPickedQtyVal" class="form-input" value="' + item.pickedQty + '" min="0" max="' + item.expectedQty + '"></div>';
    showModal('Edit Picked Qty', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="savePickedQty(\'' + itemId + '\')"><i class="bx bx-check"></i> Save</button>');
}

function savePickedQty(itemId) {
    var newQty = parseInt(document.getElementById('editPickedQtyVal').value) || 0;
    for (var i = 0; i < currentPickingSession.items.length; i++) {
        if (currentPickingSession.items[i].id === itemId) {
            currentPickingSession.items[i].pickedQty = newQty;
            if (newQty < currentPickingSession.items[i].expectedQty && !currentPickingSession.items[i].reason) {
                currentPickingSession.items[i].reason = 'Short quantity';
            }
            break;
        }
    }
    closeModal();
    renderPickingSessionUI();
}

function givePickingReason(itemId) {
    var item = null;
    for (var i = 0; i < currentPickingSession.items.length; i++) {
        if (currentPickingSession.items[i].id === itemId) { item = currentPickingSession.items[i]; break; }
    }
    if (!item) return;
    var html = '<div class="form-group"><label>Material</label><div class="form-input" style="background:var(--bg-secondary)">' + escapeHtml(item.material) + '</div></div>';
    html += '<div class="form-group"><label>Location</label><div class="form-input" style="background:var(--bg-secondary)">' + escapeHtml(item.location) + '</div></div>';
    html += '<div class="form-group"><label>Expected: ' + item.expectedQty + ' | Picked: ' + item.pickedQty + '</label></div>';
    html += '<div class="form-group"><label>Reason <span class="req">*</span></label>';
    html += '<select id="pickReasonSelect" class="form-input"><option value="">-- Select Reason --</option>';
    html += '<option value="Material not found at location">Material not found at location</option>';
    html += '<option value="Damaged material">Damaged material</option>';
    html += '<option value="Wrong material at location">Wrong material at location</option>';
    html += '<option value="Short quantity">Short quantity</option>';
    html += '<option value="Other">Other</option>';
    html += '</select></div>';
    html += '<div class="form-group"><label>Additional Detail</label><input type="text" id="pickReasonDetail" class="form-input" placeholder="Any extra detail..."></div>';
    showModal('Give Reason', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-warning" onclick="savePickingReason(\'' + itemId + '\')"><i class="bx bx-check"></i> Save Reason</button>');
}

function savePickingReason(itemId) {
    var reason = document.getElementById('pickReasonSelect').value;
    var detail = document.getElementById('pickReasonDetail').value.trim();
    if (!reason) { showToast('Select a reason', 'error'); return; }
    for (var i = 0; i < currentPickingSession.items.length; i++) {
        if (currentPickingSession.items[i].id === itemId) {
            currentPickingSession.items[i].reason = reason;
            currentPickingSession.items[i].reasonDetail = detail;
            // Auto reduce picked qty if reason is "not found"
            if (reason === 'Material not found at location') {
                currentPickingSession.items[i].pickedQty = 0;
            }
            break;
        }
    }
    closeModal();
    renderPickingSessionUI();
}

function cancelPickingSession() {
    if (currentPickingSession && currentPickingSession.items.some(function(it) { return it.pickedQty < it.expectedQty; })) {
        if (!confirm('You have uncommitted changes. Cancel anyway?')) return;
    }
    if (currentPickingSession) {
        DB.update('obd_data', currentPickingSession.obdId, { status: 'Assigned' });
    }
    currentPickingSession = null;
    document.getElementById('pickingSessionArea').innerHTML = '';
    renderPicking('start-picking');
}

function submitPicking() {
    if (!currentPickingSession) return;
    var obd = DB.find('obd_data', currentPickingSession.obdId);

    // Save picked items to OBD
    var pickedItems = currentPickingSession.items.map(function(item) {
        return {
            id: DB.uid(), material: item.material, ean: item.ean, description: item.description,
            location: item.location, expectedQty: item.expectedQty, pickedQty: item.pickedQty,
            reason: item.reason || '', reasonDetail: item.reasonDetail || '',
            pickerName: APP.currentUser.name, pickedAt: new Date().toISOString()
        };
    });

    DB.update('obd_data', currentPickingSession.obdId, { status: 'Picked', pickedItems: pickedItems });

    // Create difference reports for items with reasons
    for (var i = 0; i < pickedItems.length; i++) {
        if (pickedItems[i].reason) {
            DB.add('difference_reports', {
                obdNo: obd.obdNo, pickerName: APP.currentUser.name, material: pickedItems[i].material,
                location: pickedItems[i].location, reason: pickedItems[i].reason,
                reasonDetail: pickedItems[i].reasonDetail, expectedQty: pickedItems[i].expectedQty,
                pickedQty: pickedItems[i].pickedQty, dateTime: new Date().toISOString()
            });
        }
    }

    logAction('Picking', 'SUBMIT', 'Picking completed for OBD ' + obd.obdNo + '. Items: ' + pickedItems.length);
    addNotification('Picking completed for OBD ' + obd.obdNo, 'success');
    showToast('Picking submitted! OBD moved to Picking Done.', 'success');
    currentPickingSession = null;
    renderPicking('start-picking');
}

// --- PICKING DONE ---
function renderPickingDone() {
    var doneObds = DB.filter('obd_data', function(o) { return o.status === 'Picked'; });
    var html = '<div class="section-header"><h2><i class="bx bx-check-circle"></i> Picking Done</h2>';
    html += '<div style="color:var(--text-muted);font-size:13px">' + doneObds.length + ' OBDs ready for loading</div></div>';

    if (doneObds.length === 0) {
        html += '<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No completed pickings yet</p></div></div>';
        return html;
    }

    html += '<div class="card"><div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Customer</th><th>Picker</th><th>Materials</th><th>Picked Qty</th><th>Differences</th><th>Actions</th></tr></thead><tbody>';
    for (var i = 0; i < doneObds.length; i++) {
        var obd = doneObds[i];
        var totalPicked = 0, diffCount = 0;
        if (obd.pickedItems) {
            for (var p = 0; p < obd.pickedItems.length; p++) {
                totalPicked += obd.pickedItems[p].pickedQty;
                if (obd.pickedItems[p].reason) diffCount++;
            }
        }
        html += '<tr><td style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(obd.obdNo) + '</td>';
        html += '<td>' + escapeHtml(obd.customer || '-') + '</td>';
        html += '<td>' + escapeHtml(obd.assignedPicker || '-') + '</td>';
        html += '<td>' + (obd.pickedItems ? obd.pickedItems.length : 0) + '</td>';
        html += '<td><strong>' + totalPicked + '</strong></td>';
        html += '<td>' + (diffCount > 0 ? '<span class="badge badge-danger">' + diffCount + ' diffs</span>' : '<span class="badge badge-success">None</span>') + '</td>';
        html += '<td><div class="table-actions">';
        html += '<button class="btn btn-secondary btn-sm" onclick="viewOBDReport(\'' + obd.id + '\')"><i class="bx bx-show"></i> View</button>';
        html += '<button class="btn btn-primary btn-sm" onclick="exportOBDReport(\'' + obd.id + '\')"><i class="bx bx-download"></i> PDF</button>';
        html += '</div></td></tr>';
    }
    html += '</tbody></table></div></div>';
    return html;
}


// ==================== LOADING MODULE ====================
function renderLoading(sub) {
    var sec = document.getElementById('section-loading');
    if (!sec) return;
    if (!sub) {
        var allSubs = ['loading-assign', 'start-loading', 'loading-done', 'qty-mismatch'];
        for (var i = 0; i < allSubs.length; i++) { if (checkPermission(allSubs[i])) { sub = allSubs[i]; break; } }
        if (!sub) sub = 'loading-assign';
    }
    var allowedSubs = [
        { id: 'loading-assign', label: 'Loading Assign' },
        { id: 'start-loading', label: 'Start Loading' },
        { id: 'loading-done', label: 'Loaded Vehicles' },
        { id: 'qty-mismatch', label: 'Qty Mismatch' }
    ].filter(function(s) { return checkPermission(s.id); });

    var tabBtns = '<div class="tab-bar">';
    for (var t = 0; t < allowedSubs.length; t++) {
        tabBtns += '<button class="tab-btn ' + (sub === allowedSubs[t].id ? 'active' : '') + '" onclick="navigateTo(\'loading\',\'' + allowedSubs[t].id + '\')">' + allowedSubs[t].label + '</button>';
    }
    tabBtns += '</div>';

    var content = '';
    if (sub === 'loading-assign') content = renderLoadingAssign();
    else if (sub === 'start-loading') content = renderStartLoading();
    else if (sub === 'loading-done') content = renderLoadedVehicles();
    else if (sub === 'qty-mismatch') content = renderQtyMismatch();
    else content = '<div class="card"><div class="empty-state"><i class="bx bx-error-circle"></i><p>Access Denied</p></div></div>';
    sec.innerHTML = tabBtns + content;
}

// --- LOADING ASSIGN ---
function renderLoadingAssign() {
    var pickedObds = DB.filter('obd_data', function(o) { return o.status === 'Picked'; });
    var html = '<div class="section-header"><h2><i class="bx bx-user-plus"></i> Loading Assign</h2></div>';

    html += '<div class="card" style="margin-bottom:16px"><div class="card-title">Assign OBD to Loader</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>Select OBD <span class="req">*</span></label><select id="loadingAssignObd" class="form-input"><option value="">-- Select OBD --</option>';
    for (var i = 0; i < pickedObds.length; i++) {
        var totalPicked = 0;
        if (pickedObds[i].pickedItems) { for (var p = 0; p < pickedObds[i].pickedItems.length; p++) { totalPicked += pickedObds[i].pickedItems[p].pickedQty; } }
        html += '<option value="' + pickedObds[i].id + '">' + escapeHtml(pickedObds[i].obdNo) + ' — ' + escapeHtml(pickedObds[i].customer || '') + ' (Picked: ' + totalPicked + ')</option>';
    }
    html += '</select></div>';
    html += '<div class="form-group"><label>Loader Username <span class="req">*</span></label><input type="text" id="loadingAssignUser" class="form-input" placeholder="e.g. loader"></div>';
    html += '</div>';
    html += '<div class="form-actions">';
    html += '<button class="btn btn-primary" onclick="assignLoadingToUser()"><i class="bx bx-send"></i> Send Loading Report</button>';
    html += '<button class="btn btn-secondary" onclick="assignAllLoadingToUser()"><i class="bx bx-send"></i> Send All Picked</button>';
    html += '</div></div>';

    // Assigned list
    var assignedObds = DB.filter('obd_data', function(o) { return o.status === 'Loading Assigned' && o.assignedLoader; });
    if (assignedObds.length > 0) {
        html += '<div class="card"><div class="card-title">Currently Assigned for Loading</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Customer</th><th>Assigned Loader</th><th>Action</th></tr></thead><tbody>';
        for (var j = 0; j < assignedObds.length; j++) {
            var a = assignedObds[j];
            html += '<tr><td style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(a.obdNo) + '</td>';
            html += '<td>' + escapeHtml(a.customer || '-') + '</td><td><strong>' + escapeHtml(a.assignedLoader) + '</strong></td>';
            html += '<td><button class="btn btn-danger btn-sm" onclick="unassignLoading(\'' + a.id + '\')"><i class="bx bx-x"></i> Unassign</button></td></tr>';
        }
        html += '</tbody></table></div></div>';
    }
    return html;
}

function assignLoadingToUser() {
    var obdId = document.getElementById('loadingAssignObd').value;
    var username = document.getElementById('loadingAssignUser').value.trim();
    if (!obdId) { showToast('Select an OBD', 'error'); return; }
    if (!username) { showToast('Enter username', 'error'); return; }
    var user = DB.filter('users', function(u) { return u.username === username; });
    if (user.length === 0) { showToast('Username not found!', 'error'); return; }
    DB.update('obd_data', obdId, { status: 'Loading Assigned', assignedLoader: username });
    addNotification('Loading report assigned: OBD sent to ' + username, 'info', username);
    logAction('Loading', 'ASSIGN', 'OBD assigned for loading to ' + username);
    showToast('Loading report sent to ' + username + '!', 'success');
    renderLoading('loading-assign');
}

function assignAllLoadingToUser() {
    var username = document.getElementById('loadingAssignUser').value.trim();
    if (!username) { showToast('Enter username first', 'error'); return; }
    var user = DB.filter('users', function(u) { return u.username === username; });
    if (user.length === 0) { showToast('Username not found!', 'error'); return; }
    var picked = DB.filter('obd_data', function(o) { return o.status === 'Picked'; });
    if (picked.length === 0) { showToast('No picked OBDs', 'error'); return; }
    for (var i = 0; i < picked.length; i++) {
        DB.update('obd_data', picked[i].id, { status: 'Loading Assigned', assignedLoader: username });
    }
    addNotification(picked.length + ' OBD loading reports assigned to you', 'info', username);
    logAction('Loading', 'ASSIGN_ALL', picked.length + ' OBDs assigned for loading to ' + username);
    showToast(picked.length + ' OBDs sent to ' + username + '!', 'success');
    renderLoading('loading-assign');
}

function unassignLoading(obdId) {
    DB.update('obd_data', obdId, { status: 'Picked', assignedLoader: '' });
    showToast('Unassigned', 'info');
    renderLoading('loading-assign');
}

// --- START LOADING (Loader's View) ---
function renderStartLoading() {
    if (!APP.currentUser) return '<div class="card"><div class="empty-state"><i class="bx bx-lock"></i><p>Not logged in</p></div></div>';

    var myObds = DB.filter('obd_data', function(o) {
        return o.assignedLoader === APP.currentUser.username && (o.status === 'Loading Assigned' || o.status === 'Loading In Progress');
    });

    var html = '<div class="section-header"><h2><i class="bx bxs-truck"></i> Start Loading</h2>';
    html += '<div style="color:var(--text-muted);font-size:13px">User: <strong style="color:var(--accent)">' + escapeHtml(APP.currentUser.name) + '</strong> | Assigned OBDs: ' + myObds.length + '</div></div>';

    if (myObds.length === 0) {
        html += '<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No OBDs assigned for loading</p><small style="color:var(--text-muted)">Contact admin for loading assignment</small></div></div>';
        return html;
    }

    html += '<div class="card"><div class="card-title">Your Loading Assignments</div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Customer</th><th>Materials</th><th>Picked Qty</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < myObds.length; i++) {
        var obd = myObds[i];
        var totalPicked = 0;
        if (obd.pickedItems) { for (var p = 0; p < obd.pickedItems.length; p++) { totalPicked += obd.pickedItems[p].pickedQty; } }
        html += '<tr><td style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(obd.obdNo) + '</td>';
        html += '<td>' + escapeHtml(obd.customer || '-') + '</td><td>' + (obd.pickedItems ? obd.pickedItems.length : 0) + '</td>';
        html += '<td><strong>' + totalPicked + '</strong></td>';
        html += '<td><span class="badge badge-warning">' + escapeHtml(obd.status) + '</span></td>';
        html += '<td><button class="btn btn-primary btn-sm" onclick="showLoadingSecurityPrompt(\'' + obd.id + '\')"><i class="bx bxs-truck"></i> Start Loading</button></td></tr>';
    }
    html += '</tbody></table></div></div>';

    html += '<div id="loadingSessionArea"></div>';
    return html;
}

function showLoadingSecurityPrompt(obdId) {
    var obd = DB.find('obd_data', obdId);
    if (!obd) return;
    var html = '<div style="background:var(--warning-dim);padding:12px;border-radius:8px;margin-bottom:16px;border-left:4px solid var(--warning)">';
    html += '<strong>OBD: ' + escapeHtml(obd.obdNo) + '</strong> | Customer: ' + escapeHtml(obd.customer || '') + '</div>';
    html += '<div class="form-group"><label>Vehicle Number <span class="req">*</span></label><input type="text" id="loadingVehicleNo" class="form-input" placeholder="e.g. MH-12-AB-1234" style="text-transform:uppercase"></div>';
    html += '<div class="form-group"><label>Security Guard Name <span class="req">*</span></label><input type="text" id="loadingSecurityName" class="form-input" placeholder="Security guard name with you"></div>';
    showModal('Start Loading — Security Check', html, 'sm',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="beginLoadingSession(\'' + obdId + '\')"><i class="bx bxs-truck"></i> Submit & Start Scanning</button>');
}

function beginLoadingSession(obdId) {
    var vehicleNo = document.getElementById('loadingVehicleNo').value.trim().toUpperCase();
    var securityName = document.getElementById('loadingSecurityName').value.trim();
    if (!vehicleNo) { showToast('Enter vehicle number', 'error'); return; }
    if (!securityName) { showToast('Enter security guard name', 'error'); return; }

    DB.update('obd_data', obdId, { status: 'Loading In Progress', vehicleNo: vehicleNo, securityName: securityName });
    currentLoadingSession = { obdId: obdId, vehicleNo: vehicleNo, securityName: securityName, scannedItems: [] };
    logAction('Loading', 'START', 'Loading started for OBD. Vehicle: ' + vehicleNo + ', Security: ' + securityName);
    closeModal();
    renderLoadingSessionUI();
}

function renderLoadingSessionUI() {
    var area = document.getElementById('loadingSessionArea');
    if (!area || !currentLoadingSession) return;
    var obd = DB.find('obd_data', currentLoadingSession.obdId);

    // Build OBD material map for quick lookup
    var obdMaterials = {};
    if (obd.pickedItems) {
        for (var p = 0; p < obd.pickedItems.length; p++) {
            obdMaterials[obd.pickedItems[p].material] = obd.pickedItems[p].pickedQty;
        }
    }

    var html = '<div class="card" style="border:2px solid var(--success);margin-top:16px">';
    html += '<div class="card-title" style="color:var(--success)"><i class="bx bxs-truck"></i> Loading Scan — ' + escapeHtml(obd.obdNo) + '</div>';
    html += '<div style="background:var(--bg-secondary);padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:12px">';
    html += '<strong>Vehicle:</strong> ' + escapeHtml(currentLoadingSession.vehicleNo) + ' | <strong>Security:</strong> ' + escapeHtml(currentLoadingSession.securityName);
    html += '</div>';

    // Scan form
    html += '<div class="form-row" style="margin-bottom:12px">';
    html += '<div class="form-group"><label>EAN / Barcode <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:6px"><input type="text" id="loadScanEan" class="form-input" placeholder="Scan EAN..." style="flex:1" onkeydown="if(event.key===\'Enter\')addLoadingScan()">';
    html += '<button class="btn btn-primary btn-sm" onclick="addLoadingScan()"><i class="bx bx-plus"></i></button>';
    html += '<button class="btn btn-secondary btn-sm scan-btn" onclick="openScannerModal(function(code){document.getElementById(\'loadScanEan\').value=code;addLoadingScan()})"><i class="bx bx-qr"></i></button></div></div>';
    html += '<div class="form-group"><label>Material (Auto/Manual)</label><input type="text" id="loadScanMaterial" class="form-input" placeholder="Auto from scan"></div>';
    html += '<div class="form-group"><label>Description</label><input type="text" id="loadScanDesc" class="form-input" placeholder="Auto from scan"></div>';
    html += '</div>';

    // Live comparison summary
    var scannedMap = {};
    for (var s = 0; s < currentLoadingSession.scannedItems.length; s++) {
        var si = currentLoadingSession.scannedItems[s];
        scannedMap[si.material] = (scannedMap[si.material] || 0) + si.qty;
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:12px">';
    var allMatched = true;
    for (var matKey in obdMaterials) {
        var expected = obdMaterials[matKey];
        var scanned = scannedMap[matKey] || 0;
        var matched = scanned >= expected;
        if (!matched) allMatched = false;
        var clr = matched ? 'var(--success)' : 'var(--danger)';
        html += '<div style="padding:8px;border-radius:6px;border:1px solid ' + clr + ';background:' + (matched ? 'rgba(16,185,129,.08)' : 'rgba(239,68,68,.08)') + ';font-size:12px">';
        html += '<div style="color:var(--text-muted)">' + escapeHtml(matKey) + '</div>';
        html += '<div><span style="color:' + clr + ';font-weight:700">' + scanned + '</span> / ' + expected + '</div></div>';
    }
    html += '</div>';

    // Scanned items table
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Description</th><th>Qty</th><th>In OBD</th><th>Action</th></tr></thead><tbody>';
    if (currentLoadingSession.scannedItems.length === 0) {
        html += '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No items scanned yet</td></tr>';
    } else {
        for (var i = 0; i < currentLoadingSession.scannedItems.length; i++) {
            var item = currentLoadingSession.scannedItems[i];
            var rowStyle = item.inOBD ? '' : 'style="background:var(--danger-dim)"';
            html += '<tr ' + rowStyle + '><td>' + (i + 1) + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(item.ean) + '</td>';
            html += '<td>' + escapeHtml(item.material) + '</td><td style="font-size:12px">' + escapeHtml(item.description) + '</td>';
            html += '<td><strong>' + item.qty + '</strong></td>';
            html += '<td>' + (item.inOBD ? '<span class="badge badge-success"><i class="bx bx-check"></i> Yes</span>' : '<span class="badge badge-danger"><i class="bx bx-x"></i> NO</span>') + '</td>';
            html += '<td><button class="btn btn-danger btn-sm" onclick="removeLoadingScan(\'' + item.id + '\')"><i class="bx bx-trash"></i> Delete</button></td></tr>';
        }
    }
    html += '</tbody></table></div>';

    html += '<hr class="cyber-line">';
    html += '<div class="form-actions">';
    html += '<button class="btn btn-danger" onclick="cancelLoadingSession()"><i class="bx bx-x"></i> Cancel</button>';
    html += '<button class="btn btn-primary" onclick="submitLoading()"><i class="bx bxs-truck"></i> Submit Loading</button>';
    html += '</div></div>';

    area.innerHTML = html;
    document.getElementById('loadScanEan').focus();
}

function addLoadingScan() {
    var ean = document.getElementById('loadScanEan').value.trim();
    if (!ean) { showToast('Scan or enter EAN', 'error'); return; }

    var material = document.getElementById('loadScanMaterial').value.trim();
    var desc = document.getElementById('loadScanDesc').value.trim();

    // Auto-fill from master
    if (!material || !desc) {
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === ean || matMaster[i].material.toUpperCase() === ean.toUpperCase()) {
                material = material || matMaster[i].material;
                desc = desc || matMaster[i].description;
                ean = matMaster[i].ean || ean;
                break;
            }
        }
    }

    // Check if in OBD
    var obd = DB.find('obd_data', currentLoadingSession.obdId);
    var inOBD = false;
    if (obd && obd.pickedItems) {
        for (var p = 0; p < obd.pickedItems.length; p++) {
            if (obd.pickedItems[p].ean === ean || obd.pickedItems[p].material.toUpperCase() === (material || '').toUpperCase()) {
                inOBD = true; break;
            }
        }
    }

    currentLoadingSession.scannedItems.push({
        id: DB.uid(), ean: ean, material: material || 'UNKNOWN', description: desc || '-',
        qty: 1, inOBD: inOBD, scanTime: new Date().toISOString()
    });

    // Clear inputs
    document.getElementById('loadScanEan').value = '';
    document.getElementById('loadScanMaterial').value = '';
    document.getElementById('loadScanDesc').value = '';
    document.getElementById('loadScanEan').focus();

    renderLoadingSessionUI();
    if (!inOBD) {
        showToast('WARNING: This material is NOT in the OBD!', 'warning');
    } else {
        showToast('Scanned: ' + (material || ean), 'success');
    }
}

function removeLoadingScan(itemId) {
    currentLoadingSession.scannedItems = currentLoadingSession.scannedItems.filter(function(s) { return s.id !== itemId; });
    renderLoadingSessionUI();
}

function cancelLoadingSession() {
    if (currentLoadingSession) {
        DB.update('obd_data', currentLoadingSession.obdId, { status: 'Loading Assigned' });
    }
    currentLoadingSession = null;
    document.getElementById('loadingSessionArea').innerHTML = '';
    renderLoading('start-loading');
}

function submitLoading() {
    if (!currentLoadingSession || currentLoadingSession.scannedItems.length === 0) {
        showToast('No items scanned!', 'error'); return;
    }
    var obd = DB.find('obd_data', currentLoadingSession.obdId);

    // Compare scanned qty vs OBD picked qty
    var obdMaterials = {};
    if (obd.pickedItems) {
        for (var p = 0; p < obd.pickedItems.length; p++) {
            obdMaterials[obd.pickedItems[p].material] = obd.pickedItems[p].pickedQty;
        }
    }
    var scannedMap = {};
    for (var s = 0; s < currentLoadingSession.scannedItems.length; s++) {
        var si = currentLoadingSession.scannedItems[s];
        if (si.inOBD) {
            scannedMap[si.material] = (scannedMap[si.material] || 0) + si.qty;
        }
    }

    var allMatch = true;
    var matchDetails = [];
    for (var matKey in obdMaterials) {
        var expected = obdMaterials[matKey];
        var actual = scannedMap[matKey] || 0;
        var matched = actual === expected;
        if (!matched) allMatch = false;
        matchDetails.push({ material: matKey, expected: expected, actual: actual, match: matched });
    }
    // Check for extra scanned not in OBD
    for (var sk in scannedMap) {
        if (!obdMaterials[sk]) {
            allMatch = false;
            matchDetails.push({ material: sk, expected: 0, actual: scannedMap[sk], match: false });
        }
    }

    var loadingNo = DB.loadNo(obd.obdNo);

    // Save loaded items to OBD
    DB.update('obd_data', currentLoadingSession.obdId, {
        loadedItems: currentLoadingSession.scannedItems,
        loadingNo: loadingNo,
        vehicleNo: currentLoadingSession.vehicleNo,
        securityName: currentLoadingSession.securityName,
        matchDetails: matchDetails,
        loadedBy: APP.currentUser ? APP.currentUser.name : 'System',
        loadedAt: new Date().toISOString(),
        status: allMatch ? 'Loaded' : 'Qty Mismatch'
    });

    // Create loaded vehicle record
    DB.add('loaded_vehicles', {
        obdId: currentLoadingSession.obdId, obdNo: obd.obdNo, loadingNo: loadingNo,
        vehicleNo: currentLoadingSession.vehicleNo, securityName: currentLoadingSession.securityName,
        loader: APP.currentUser ? APP.currentUser.name : 'System',
        scannedItems: currentLoadingSession.scannedItems, matchDetails: matchDetails,
        allMatch: allMatch, loadedAt: new Date().toISOString(),
        status: allMatch ? 'Loaded' : 'Qty Mismatch'
    });

    logAction('Loading', 'SUBMIT', 'Loading ' + (allMatch ? 'DONE' : 'QTY MISMATCH') + ' for OBD ' + obd.obdNo + '. Vehicle: ' + currentLoadingSession.vehicleNo + '. Loading No: ' + loadingNo);
    addNotification('Vehicle ' + currentLoadingSession.vehicleNo + ' — Loading ' + (allMatch ? 'completed' : 'qty mismatch') + '. ' + loadingNo, allMatch ? 'success' : 'warning');
    showToast(allMatch ? 'Loading DONE! No: ' + loadingNo : 'Qty MISMATCH! Check Mismatch tab.', allMatch ? 'success' : 'warning');

    currentLoadingSession = null;
    renderLoading('start-loading');
}

// --- LOADED VEHICLES ---
function renderLoadedVehicles() {
    var loaded = DB.filter('loaded_vehicles', function(v) { return v.allMatch === true; });
    var html = '<div class="section-header"><h2><i class="bx bx-check-circle"></i> Loaded Vehicles</h2>';
    html += '<div style="color:var(--text-muted);font-size:13px">' + loaded.length + ' vehicles successfully loaded</div></div>';

    if (loaded.length === 0) {
        html += '<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No loaded vehicles yet</p></div></div>';
        return html;
    }

    // Group by vehicle
    var vehicleMap = {};
    for (var i = 0; i < loaded.length; i++) {
        var v = loaded[i];
        if (!vehicleMap[v.vehicleNo]) {
            vehicleMap[v.vehicleNo] = { vehicleNo: v.vehicleNo, obds: [], totalItems: 0, loader: v.loader, security: v.securityName, loadedAt: v.loadedAt };
        }
        vehicleMap[v.vehicleNo].obds.push(v);
        vehicleMap[v.vehicleNo].totalItems += (v.scannedItems ? v.scannedItems.length : 0);
    }

    html += '<div class="card"><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>OBDs Loaded</th><th>Total Items</th><th>Loader</th><th>Security</th><th>Loaded At</th><th>Actions</th></tr></thead><tbody>';
    for (var vk in vehicleMap) {
        var vg = vehicleMap[vk];
        var obdStr = vg.obds.map(function(o) { return '<span style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(o.obdNo) + '</span>'; }).join(', ');
        html += '<tr><td><strong>' + escapeHtml(vg.vehicleNo) + '</strong></td>';
        html += '<td>' + obdStr + '</td><td><strong>' + vg.totalItems + '</strong></td>';
        html += '<td>' + escapeHtml(vg.loader) + '</td><td>' + escapeHtml(vg.security) + '</td>';
        html += '<td style="font-size:12px">' + formatDateTime(vg.loadedAt) + '</td>';
        html += '<td><div class="table-actions">';
        for (var oi = 0; oi < vg.obds.length; oi++) {
            html += '<button class="btn btn-secondary btn-sm" onclick="viewOBDReport(\'' + vg.obds[oi].obdId + '\')"><i class="bx bx-show"></i></button>';
        }
        html += '</div></td></tr>';
    }
    html += '</tbody></table></div></div>';
    return html;
}

// --- QTY MISMATCH ---
function renderQtyMismatch() {
    var mismatched = DB.filter('loaded_vehicles', function(v) { return v.allMatch === false; });
    var html = '<div class="section-header"><h2><i class="bx bx-error-circle"></i> Qty Mismatch</h2>';
    html += '<div style="color:var(--text-muted);font-size:13px">' + mismatched.length + ' vehicles with quantity mismatch</div></div>';

    if (mismatched.length === 0) {
        html += '<div class="card"><div class="empty-state"><i class="bx bx-check-circle"></i><p>No mismatches! All good.</p></div></div>';
        return html;
    }

    for (var i = 0; i < mismatched.length; i++) {
        var mv = mismatched[i];
        html += '<div class="card" style="margin-bottom:16px;border:2px solid var(--danger)">';
        html += '<div style="background:var(--danger-dim);padding:12px;border-radius:8px;margin-bottom:12px;border-left:4px solid var(--danger)">';
        html += '<strong style="color:var(--danger)">QTY MISMATCH</strong><br>';
        html += '<span style="font-size:12px">Vehicle: <strong>' + escapeHtml(mv.vehicleNo) + '</strong> | OBD: <span style="font-family:var(--font-display);color:var(--accent)">' + escapeHtml(mv.obdNo) + '</span> | Loading No: <span style="font-family:var(--font-display);color:var(--warning)">' + escapeHtml(mv.loadingNo) + '</span></span><br>';
        html += '<span style="font-size:12px">Loader: ' + escapeHtml(mv.loader) + ' | Security: ' + escapeHtml(mv.security) + ' | Time: ' + formatDateTime(mv.loadedAt) + '</span>';
        html += '</div>';

        if (mv.matchDetails && mv.matchDetails.length > 0) {
            html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>Expected (Picked)</th><th>Actual (Scanned)</th><th>Diff</th><th>Status</th></tr></thead><tbody>';
            for (var d = 0; d < mv.matchDetails.length; d++) {
                var det = mv.matchDetails[d];
                var diff = det.actual - det.expected;
                html += '<tr><td>' + escapeHtml(det.material) + '</td><td>' + det.expected + '</td>';
                html += '<td class="' + (diff !== 0 ? 'qty-mismatch' : 'qty-match') + '">' + det.actual + '</td>';
                html += '<td class="' + (diff !== 0 ? 'qty-mismatch' : 'qty-match') + '">' + (diff > 0 ? '+' : '') + diff + '</td>';
                html += '<td><span class="badge ' + (det.match ? 'badge-success' : 'badge-danger') + '">' + (det.match ? 'Match' : 'Mismatch') + '</span></td></tr>';
            }
            html += '</tbody></table></div>';
        }
        html += '</div>';
    }
    return html;
}
/* ============================================================
   PART 4: ADMIN + USER WORKING TIME + ENHANCED REPORTS
   Developed by Nikhil Patil
   ============================================================ */

// ==================== ADMIN MODULE ====================
function renderAdmin() {
    if (!checkActionPerm('canAdmin')) {
        document.getElementById('section-admin').innerHTML = '<div class="card"><div class="empty-state"><i class="bx bx-lock"></i><p>Access Denied — Admin only</p></div></div>';
        return;
    }

    var users = DB.get('users');
    var html = '<div class="section-header"><h2><i class="bx bxs-user-detail"></i> Admin — User Management</h2>';
    html += '<button class="btn btn-primary" onclick="showAddUserModal()"><i class="bx bx-user-plus"></i> Add User</button></div>';

    // Role summary
    var roleCount = {};
    for (var i = 0; i < users.length; i++) {
        var role = users[i].role || 'Unknown';
        roleCount[role] = (roleCount[role] || 0) + 1;
    }
    html += '<div class="kpi-grid" style="margin-bottom:20px">';
    for (var rk in roleCount) {
        html += kpiCard('bx-user', roleCount[rk], rk + 's');
    }
    html += '</div>';

    // Users table
    html += '<div class="card"><div class="card-title">All Users (' + users.length + ')</div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Name</th><th>Username</th><th>Role</th><th>Modules</th><th>Actions</th><th>Status</th></tr></thead><tbody>';
    for (var j = 0; j < users.length; j++) {
        var u = users[j];
        var moduleStr = '';
        if (u.permissions && u.permissions.modules) {
            if (u.permissions.modules.indexOf('all') > -1) {
                moduleStr = '<span class="badge badge-accent">ALL</span>';
            } else {
                moduleStr = u.permissions.modules.slice(0, 3).map(function(m) { return '<span class="badge badge-info" style="margin:1px">' + escapeHtml(m) + '</span>'; }).join(' ');
                if (u.permissions.modules.length > 3) moduleStr += '<span class="badge" style="margin:1px">+' + (u.permissions.modules.length - 3) + '</span>';
            }
        }
        // Check if user is currently active
        var activeSession = DB.filter('user_sessions', function(s) { return s.userId === u.id && !s.logoutTime; });
        var statusBadge = activeSession.length > 0 ? '<span class="badge badge-success"><span class="status-dot green"></span> Online</span>' : '<span class="badge" style="background:var(--bg-secondary);color:var(--text-muted)"><span class="status-dot" style="background:var(--text-muted)"></span> Offline</span>';

        html += '<tr><td>' + (j + 1) + '</td>';
        html += '<td><strong>' + escapeHtml(u.name) + '</strong></td>';
        html += '<td style="font-family:var(--font-display);font-size:12px;color:var(--accent)">' + escapeHtml(u.username) + '</td>';
        html += '<td><span class="badge badge-warning">' + escapeHtml(u.role) + '</span></td>';
        html += '<td>' + moduleStr + '</td>';
        html += '<td><div class="table-actions">';
        html += '<button class="btn-icon" onclick="showEditUserModal(\'' + u.id + '\')"><i class="bx bx-pencil"></i></button>';
        html += '<button class="btn-icon" onclick="showUserPermModal(\'' + u.id + '\')" title="Permissions"><i class="bx bx-shield"></i></button>';
        if (u.role !== 'Super Admin') {
            html += '<button class="btn-icon danger" onclick="deleteUser(\'' + u.id + '\')"><i class="bx bx-trash"></i></button>';
        }
        html += '</div></td>';
        html += '<td>' + statusBadge + '</td></tr>';
    }
    html += '</tbody></table></div></div>';

    document.getElementById('section-admin').innerHTML = html;
}

function showAddUserModal() {
    var html = '<div class="form-row">';
    html += '<div class="form-group"><label>Full Name <span class="req">*</span></label><input type="text" id="addUserName" class="form-input" placeholder="e.g. John Doe"></div>';
    html += '<div class="form-group"><label>Username <span class="req">*</span></label><input type="text" id="addUserUsername" class="form-input" placeholder="e.g. johndoe"></div>';
    html += '</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>Password <span class="req">*</span></label><input type="password" id="addUserPassword" class="form-input" placeholder="Min 4 characters"></div>';
    html += '<div class="form-group"><label>Role <span class="req">*</span></label>';
    html += '<select id="addUserRole" class="form-input" onchange="setRoleDefaults()">';
    html += '<option value="">-- Select Role --</option>';
    html += '<option value="Super Admin">Super Admin</option>';
    html += '<option value="Admin">Admin</option>';
    html += '<option value="Manager">Manager</option>';
    html += '<option value="DEO">Data Entry Operator</option>';
    html += '<option value="Security">Security</option>';
    html += '<option value="Unloading User">Unloading User</option>';
    html += '<option value="Picker">Picker</option>';
    html += '<option value="Loader">Loader</option>';
    html += '<option value="Custom">Custom</option>';
    html += '</select></div>';
    html += '</div>';
    html += '<div id="roleDefaultsMsg" style="font-size:12px;color:var(--text-muted);margin-bottom:12px"></div>';
    showModal('Add New User', html, 'md',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="addUser()"><i class="bx bx-check"></i> Create User</button>');
}

function setRoleDefaults() {
    var role = document.getElementById('addUserRole').value;
    var msg = document.getElementById('roleDefaultsMsg');
    var defaults = {
        'Super Admin': 'Full access to everything',
        'Admin': 'Full access except Security Gate entry',
        'Manager': 'Dashboard, Inbound, Reports, Audit, Picking, Loading (view + assign)',
        'DEO': 'Inbound only (upload invoice, assign vehicle)',
        'Security': 'Security Gate entry only',
        'Unloading User': 'Unloading Screen only (scan + submit)',
        'Picker': 'Picking only (start picking)',
        'Loader': 'Loading only (start loading)',
        'Custom': 'You can set custom permissions after creation'
    };
    msg.innerHTML = defaults[role] ? '<span class="badge badge-info">Default: ' + defaults[role] + '</span>' : '';
}

function addUser() {
    var name = document.getElementById('addUserName').value.trim();
    var username = document.getElementById('addUserUsername').value.trim().toLowerCase();
    var password = document.getElementById('addUserPassword').value;
    var role = document.getElementById('addUserRole').value;

    if (!name || !username || !password || !role) { showToast('All fields required', 'error'); return; }
    if (password.length < 4) { showToast('Password must be at least 4 characters', 'error'); return; }
    var exists = DB.filter('users', function(u) { return u.username === username; });
    if (exists.length > 0) { showToast('Username already exists!', 'error'); return; }

    var perms = getDefaultPermissions(role);
    DB.add('users', { name: name, username: username, password: password, role: role, permissions: perms });
    logAction('Admin', 'ADD_USER', 'Created user: ' + name + ' (' + username + ') role=' + role);
    showToast('User created: ' + name, 'success');
    closeModal();
    renderAdmin();
}

function getDefaultPermissions(role) {
    var perms = { modules: [], actions: {} };
    switch (role) {
        case 'Super Admin':
            perms.modules = ['all'];
            perms.actions = { canSecurityEntry: true, canUploadInvoice: true, canAssignVehicle: true, canStartUnloading: true, canPostVehicle: true, canApprove: true, canViewReports: true, canPutaway: true, canPIV: true, canPick: true, canLoad: true, canAdmin: true };
            break;
        case 'Admin':
            perms.modules = ['all'];
            perms.actions = { canSecurityEntry: false, canUploadInvoice: true, canAssignVehicle: true, canStartUnloading: true, canPostVehicle: true, canApprove: true, canViewReports: true, canPutaway: true, canPIV: true, canPick: true, canLoad: true, canAdmin: true };
            break;
        case 'Manager':
            perms.modules = ['dashboard', 'inbound', 'reports', 'audit', 'picking', 'loading'];
            perms.actions = { canSecurityEntry: false, canUploadInvoice: true, canAssignVehicle: true, canStartUnloading: false, canPostVehicle: false, canApprove: true, canViewReports: true, canPutaway: false, canPIV: false, canPick: true, canLoad: true, canAdmin: false };
            break;
        case 'DEO':
            perms.modules = ['inbound'];
            perms.actions = { canSecurityEntry: false, canUploadInvoice: true, canAssignVehicle: true, canStartUnloading: false, canPostVehicle: false, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: false, canLoad: false, canAdmin: false };
            break;
        case 'Security':
            perms.modules = ['security-gate'];
            perms.actions = { canSecurityEntry: true, canUploadInvoice: false, canAssignVehicle: false, canStartUnloading: false, canPostVehicle: false, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: false, canLoad: false, canAdmin: false };
            break;
        case 'Unloading User':
            perms.modules = ['unloading-screen'];
            perms.actions = { canSecurityEntry: false, canUploadInvoice: false, canAssignVehicle: false, canStartUnloading: true, canPostVehicle: true, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: false, canLoad: false, canAdmin: false };
            break;
        case 'Picker':
            perms.modules = ['picking'];
            perms.actions = { canSecurityEntry: false, canUploadInvoice: false, canAssignVehicle: false, canStartUnloading: false, canPostVehicle: false, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: true, canLoad: false, canAdmin: false };
            break;
        case 'Loader':
            perms.modules = ['loading'];
            perms.actions = { canSecurityEntry: false, canUploadInvoice: false, canAssignVehicle: false, canStartUnloading: false, canPostVehicle: false, canApprove: false, canViewReports: false, canPutaway: false, canPIV: false, canPick: false, canLoad: true, canAdmin: false };
            break;
        default:
            perms.modules = ['dashboard'];
            perms.actions = {};
    }
    return perms;
}

function showEditUserModal(userId) {
    var user = DB.find('users', userId);
    if (!user) return;
    var html = '<div class="form-row">';
    html += '<div class="form-group"><label>Full Name</label><input type="text" id="editUserName" class="form-input" value="' + escapeHtml(user.name) + '"></div>';
    html += '<div class="form-group"><label>Username</label><input type="text" id="editUserUsername" class="form-input" value="' + escapeHtml(user.username) + '" readonly style="background:var(--bg-secondary)"></div>';
    html += '</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label>New Password (leave blank to keep current)</label><input type="password" id="editUserPassword" class="form-input" placeholder="New password..."></div>';
    html += '<div class="form-group"><label>Role</label>';
    html += '<select id="editUserRole" class="form-input">';
    var roles = ['Super Admin', 'Admin', 'Manager', 'DEO', 'Security', 'Unloading User', 'Picker', 'Loader', 'Custom'];
    for (var i = 0; i < roles.length; i++) {
        html += '<option value="' + roles[i] + '"' + (user.role === roles[i] ? ' selected' : '') + '>' + roles[i] + '</option>';
    }
    html += '</select></div>';
    html += '</div>';
    showModal('Edit User: ' + user.name, html, 'md',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="updateUser(\'' + userId + '\')"><i class="bx bx-check"></i> Update</button>');
}

function updateUser(userId) {
    var name = document.getElementById('editUserName').value.trim();
    var password = document.getElementById('editUserPassword').value;
    var role = document.getElementById('editUserRole').value;
    if (!name) { showToast('Name is required', 'error'); return; }
    var updates = { name: name, role: role };
    if (password && password.length >= 4) updates.password = password;
    if (password && password.length < 4) { showToast('Password must be at least 4 characters', 'error'); return; }
    DB.update('users', userId, updates);
    logAction('Admin', 'EDIT_USER', 'Updated user: ' + name + ' role=' + role);
    showToast('User updated!', 'success');
    closeModal();
    renderAdmin();
}

function deleteUser(userId) {
    var user = DB.find('users', userId);
    if (!user) return;
    if (user.role === 'Super Admin') { showToast('Cannot delete Super Admin!', 'error'); return; }
    if (user.id === APP.currentUser.id) { showToast('Cannot delete yourself!', 'error'); return; }
    if (!confirm('Delete user "' + user.name + '" (' + user.username + ')?')) return;
    DB.remove('users', userId);
    logAction('Admin', 'DELETE_USER', 'Deleted user: ' + user.name);
    showToast('User deleted', 'info');
    renderAdmin();
}

// --- PERMISSION EDITOR ---
function showUserPermModal(userId) {
    var user = DB.find('users', userId);
    if (!user) return;
    if (user.role === 'Super Admin') { showToast('Super Admin has all permissions by default', 'info'); return; }

    var allModules = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'inbound', label: 'Inbound' },
        { id: 'security-gate', label: 'Security Gate' },
        { id: 'pending-vehicle', label: 'Pending Vehicle' },
        { id: 'unloading-screen', label: 'Unloading Screen' },
        { id: 'posting-pending', label: 'Posting Pending' },
        { id: 'inbound-record', label: 'Inbound Record' },
        { id: 'putaway', label: 'Putaway' },
        { id: 'piv', label: 'PIV' },
        { id: 'location', label: 'Location Master' },
        { id: 'rack', label: 'Rack Master' },
        { id: 'material', label: 'Material Master' },
        { id: 'picking', label: 'Picking' },
        { id: 'obd-upload', label: 'OBD Upload' },
        { id: 'picking-assign', label: 'Picking Assign' },
        { id: 'start-picking', label: 'Start Picking' },
        { id: 'picking-done', label: 'Picking Done' },
        { id: 'loading', label: 'Loading' },
        { id: 'loading-assign', label: 'Loading Assign' },
        { id: 'start-loading', label: 'Start Loading' },
        { id: 'loading-done', label: 'Loading Done' },
        { id: 'qty-mismatch', label: 'Qty Mismatch' },
        { id: 'user-time', label: 'User Working Time' },
        { id: 'admin', label: 'Admin' },
        { id: 'settings', label: 'Settings' },
        { id: 'reports', label: 'Reports' },
        { id: 'audit', label: 'Audit Log' }
    ];

    var allActions = [
        { id: 'canSecurityEntry', label: 'Security Gate Entry' },
        { id: 'canUploadInvoice', label: 'Upload Invoice' },
        { id: 'canAssignVehicle', label: 'Assign Vehicle' },
        { id: 'canStartUnloading', label: 'Start Unloading' },
        { id: 'canPostVehicle', label: 'Post Vehicle' },
        { id: 'canApprove', label: 'Approve/Reject' },
        { id: 'canViewReports', label: 'View Reports' },
        { id: 'canPutaway', label: 'Putaway Access' },
        { id: 'canPIV', label: 'PIV Access' },
        { id: 'canPick', label: 'Picking Access' },
        { id: 'canLoad', label: 'Loading Access' },
        { id: 'canAdmin', label: 'Admin Access' }
    ];

    var currentModules = (user.permissions && user.permissions.modules) ? user.permissions.modules : [];
    var currentActions = (user.permissions && user.permissions.actions) ? user.permissions.actions : {};
    var isAll = currentModules.indexOf('all') > -1;

    var html = '<div style="background:var(--accent-dim);padding:10px;border-radius:6px;margin-bottom:16px"><strong>' + escapeHtml(user.name) + '</strong> (' + escapeHtml(user.username) + ') — Role: <span class="badge badge-warning">' + escapeHtml(user.role) + '</span></div>';

    // Modules
    html += '<div class="card-title" style="margin-bottom:8px">Module Access</div>';
    html += '<div class="perm-grid" style="margin-bottom:16px">';
    html += '<label class="perm-item" style="border-color:var(--accent);background:var(--accent-dim)"><input type="checkbox" id="permAllModules" ' + (isAll ? 'checked' : '') + ' onchange="toggleAllPerms()"> <strong style="color:var(--accent)">ALL MODULES</strong></label>';
    for (var m = 0; m < allModules.length; m++) {
        var mod = allModules[m];
        var checked = isAll || currentModules.indexOf(mod.id) > -1;
        html += '<label class="perm-item"><input type="checkbox" class="permModuleCb" value="' + mod.id + '" ' + (checked ? 'checked' : '') + ' ' + (isAll ? 'disabled' : '') + '> ' + mod.label + '</label>';
    }
    html += '</div>';

    // Actions
    html += '<div class="card-title" style="margin-bottom:8px">Button / Action Access</div>';
    html += '<div class="perm-grid">';
    for (var a = 0; a < allActions.length; a++) {
        var act = allActions[a];
        var actChecked = isAll || currentActions[act.id] === true;
        html += '<label class="perm-item"><input type="checkbox" class="permActionCb" value="' + act.id + '" ' + (actChecked ? 'checked' : '') + ' ' + (isAll ? 'disabled' : '') + '> ' + act.label + '</label>';
    }
    html += '</div>';

    showModal('Permissions: ' + user.name, html, 'lg',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="savePermissions(\'' + userId + '\')"><i class="bx bx-shield"></i> Save Permissions</button>');
}

function toggleAllPerms() {
    var isAll = document.getElementById('permAllModules').checked;
    var modCbs = document.querySelectorAll('.permModuleCb');
    var actCbs = document.querySelectorAll('.permActionCb');
    for (var i = 0; i < modCbs.length; i++) { modCbs[i].checked = isAll; modCbs[i].disabled = isAll; }
    for (var j = 0; j < actCbs.length; j++) { actCbs[j].checked = isAll; actCbs[j].disabled = isAll; }
}

function savePermissions(userId) {
    var isAll = document.getElementById('permAllModules').checked;
    var modules = [];
    var actions = {};

    if (isAll) {
        modules = ['all'];
        actions = { canSecurityEntry: true, canUploadInvoice: true, canAssignVehicle: true, canStartUnloading: true, canPostVehicle: true, canApprove: true, canViewReports: true, canPutaway: true, canPIV: true, canPick: true, canLoad: true, canAdmin: true };
    } else {
        var modCbs = document.querySelectorAll('.permModuleCb');
        for (var i = 0; i < modCbs.length; i++) {
            if (modCbs[i].checked) modules.push(modCbs[i].value);
        }
        var actCbs = document.querySelectorAll('.permActionCb');
        for (var j = 0; j < actCbs.length; j++) {
            actions[actCbs[j].value] = actCbs[j].checked;
        }
    }

    DB.update('users', userId, { permissions: { modules: modules, actions: actions } });
    var user = DB.find('users', userId);
    logAction('Admin', 'UPDATE_PERMS', 'Updated permissions for ' + (user ? user.name : userId));
    showToast('Permissions saved!', 'success');
    closeModal();
    renderAdmin();
}

// ==================== USER WORKING TIME ====================
function renderUserWorkingTime() {
    var sessions = DB.get('user_sessions').slice().reverse();
    var users = DB.get('users');

    // Filters
    var filterUser = '';
    var filterDate = '';
    var fUserEl = document.getElementById('utFilterUser');
    var fDateEl = document.getElementById('utFilterDate');
    if (fUserEl) filterUser = fUserEl.value;
    if (fDateEl) filterDate = fDateEl.value;

    var filtered = sessions;
    if (filterUser) filtered = filtered.filter(function(s) { return s.userId === filterUser; });
    if (filterDate) filtered = filtered.filter(function(s) { return s.loginTime && s.loginTime.indexOf(filterDate) > -1; });

    var html = '<div class="section-header"><h2><i class="bx bx-time-five"></i> User Working Time</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-secondary btn-sm" onclick="exportUserTimePDF()"><i class="bx bx-download"></i> Export PDF</button>';
    html += '</div></div>';

    // Filter bar
    html += '<div class="card" style="margin-bottom:16px"><div class="form-row">';
    html += '<div class="form-group"><label>Filter by User</label><select id="utFilterUser" class="form-input" onchange="renderUserWorkingTime()"><option value="">All Users</option>';
    for (var u = 0; u < users.length; u++) {
        html += '<option value="' + users[u].id + '"' + (filterUser === users[u].id ? ' selected' : '') + '>' + escapeHtml(users[u].name) + ' (' + users[u].username + ')</option>';
    }
    html += '</select></div>';
    html += '<div class="form-group"><label>Filter by Date</label><input type="date" id="utFilterDate" class="form-input" value="' + escapeHtml(filterDate) + '" onchange="renderUserWorkingTime()"></div>';
    html += '</div></div>';

    // Summary KPIs
    var totalSessions = filtered.length;
    var activeNow = filtered.filter(function(s) { return !s.logoutTime; }).length;
    var totalMinutes = 0;
    for (var t = 0; t < filtered.length; t++) {
        var s = filtered[t];
        var end = s.logoutTime ? new Date(s.logoutTime) : new Date();
        var start = new Date(s.loginTime);
        totalMinutes += Math.round((end - start) / 60000);
    }
    var totalHours = (totalMinutes / 60).toFixed(1);

    html += '<div class="kpi-grid" style="margin-bottom:16px">';
    html += kpiCard('bx-user', totalSessions, 'Total Sessions');
    html += kpiCard('bx-broadcast', activeNow, 'Currently Active');
    html += kpiCard('bx-time', totalHours + 'h', 'Total Hours');
    html += kpiCard('bx-timer', totalMinutes + 'm', 'Total Minutes');
    html += '</div>';

    // Per-user daily summary
    var userDayMap = {};
    for (var d = 0; d < filtered.length; d++) {
        var sess = filtered[d];
        var day = sess.loginTime ? sess.loginTime.split('T')[0] : 'Unknown';
        var key = sess.userName + '|' + day;
        if (!userDayMap[key]) {
            userDayMap[key] = { userName: sess.userName, userId: sess.userId, date: day, sessions: 0, totalMinutes: 0, firstLogin: sess.loginTime, lastLogout: sess.logoutTime };
        }
        userDayMap[key].sessions++;
        var sEnd = sess.logoutTime ? new Date(sess.logoutTime) : new Date();
        var sStart = new Date(sess.loginTime);
        userDayMap[key].totalMinutes += Math.round((sEnd - sStart) / 60000);
        if (!sess.logoutTime) userDayMap[key].lastLogout = 'Active';
    }

    var dailySummary = [];
    for (var dk in userDayMap) { dailySummary.push(userDayMap[dk]); }
    dailySummary.sort(function(a, b) { return b.date.localeCompare(a.date) || a.userName.localeCompare(b.userName); });

    html += '<div class="card" style="margin-bottom:16px"><div class="card-title">Daily Summary Per User</div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>User</th><th>Date</th><th>Sessions</th><th>Total Time</th><th>First Login</th><th>Last Logout</th><th>Status</th></tr></thead><tbody>';
    for (var ds = 0; ds < dailySummary.length; ds++) {
        var dsItem = dailySummary[ds];
        var hrs = Math.floor(dsItem.totalMinutes / 60);
        var mins = dsItem.totalMinutes % 60;
        var timeStr = hrs + 'h ' + mins + 'm';
        var statusBadge = dsItem.lastLogout === 'Active' ? '<span class="badge badge-success"><span class="status-dot green"></span> Active</span>' : '<span class="badge" style="background:var(--bg-secondary);color:var(--text-muted)">Logged Out</span>';
        html += '<tr><td><strong>' + escapeHtml(dsItem.userName) + '</strong></td>';
        html += '<td>' + escapeHtml(dsItem.date) + '</td><td>' + dsItem.sessions + '</td>';
        html += '<td><strong>' + timeStr + '</strong></td>';
        html += '<td style="font-size:11px">' + formatDateTime(dsItem.firstLogin) + '</td>';
        html += '<td style="font-size:11px">' + (dsItem.lastLogout === 'Active' ? '<span style="color:var(--success)">Active Now</span>' : formatDateTime(dsItem.lastLogout)) + '</td>';
        html += '<td>' + statusBadge + '</td></tr>';
    }
    html += '</tbody></table></div></div>';

    // Detailed session log
    html += '<div class="card"><div class="card-title">Session Log (' + filtered.length + ')</div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>User</th><th>Login Time</th><th>Logout Time</th><th>Duration</th><th>Status</th></tr></thead><tbody>';
    if (filtered.length === 0) {
        html += '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">No sessions found</td></tr>';
    } else {
        for (var sl = 0; sl < filtered.length; sl++) {
            var sess = filtered[sl];
            var endT = sess.logoutTime ? new Date(sess.logoutTime) : new Date();
            var startT = new Date(sess.loginTime);
            var durMins = Math.round((endT - startT) / 60000);
            var durHrs = Math.floor(durMins / 60);
            var durM = durMins % 60;
            var durStr = durHrs + 'h ' + durM + 'm';
            var sBadge = !sess.logoutTime ? '<span class="badge badge-success"><span class="status-dot green"></span> Active</span>' : '<span class="badge" style="background:var(--bg-secondary);color:var(--text-muted)">Ended</span>';
            html += '<tr><td>' + (sl + 1) + '</td><td><strong>' + escapeHtml(sess.userName) + '</strong></td>';
            html += '<td style="font-size:12px">' + formatDateTime(sess.loginTime) + '</td>';
            html += '<td style="font-size:12px">' + (sess.logoutTime ? formatDateTime(sess.logoutTime) : '<span style="color:var(--success)">— Active —</span>') + '</td>';
            html += '<td><strong>' + durStr + '</strong></td><td>' + sBadge + '</td></tr>';
        }
    }
    html += '</tbody></table></div></div>';

    var sec = document.getElementById('section-user-time');
    if (sec) sec.innerHTML = html;
}

function exportUserTimePDF() {
    try {
        var sessions = DB.get('user_sessions').slice().reverse();
        var doc = new jspdf.jsPDF('l', 'mm', 'a4');
        doc.setFontSize(16); doc.text('VIP INDUSTRIES LIMITED (MD20) — User Working Time Report', 14, 15);
        doc.setFontSize(9); doc.text('Generated: ' + formatDateTime(new Date()), 14, 22);

        // Daily summary
        var userDayMap = {};
        for (var d = 0; d < sessions.length; d++) {
            var sess = sessions[d];
            var day = sess.loginTime ? sess.loginTime.split('T')[0] : 'Unknown';
            var key = sess.userName + '|' + day;
            if (!userDayMap[key]) {
                userDayMap[key] = { userName: sess.userName, date: day, sessions: 0, totalMinutes: 0 };
            }
            userDayMap[key].sessions++;
            var sEnd = sess.logoutTime ? new Date(sess.logoutTime) : new Date();
            var sStart = new Date(sess.loginTime);
            userDayMap[key].totalMinutes += Math.round((sEnd - sStart) / 60000);
        }

        var dailyData = [];
        for (var dk in userDayMap) {
            var dItem = userDayMap[dk];
            var hrs = Math.floor(dItem.totalMinutes / 60);
            var mins = dItem.totalMinutes % 60;
            dailyData.push([dItem.userName, dItem.date, dItem.sessions, hrs + 'h ' + mins + 'm']);
        }
        doc.autoTable({
            head: [['User', 'Date', 'Sessions', 'Total Time']],
            body: dailyData, startY: 28, styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 229, 160] }
        });

        // Detail log
        var logData = [];
        for (var l = 0; l < sessions.length; l++) {
            var s = sessions[l];
            var endT = s.logoutTime ? new Date(s.logoutTime) : new Date();
            var startT = new Date(s.loginTime);
            var durMins = Math.round((endT - startT) / 60000);
            logData.push([s.userName, formatDateTime(s.loginTime), s.logoutTime ? formatDateTime(s.logoutTime) : 'Active', Math.floor(durMins / 60) + 'h ' + (durMins % 60) + 'm']);
        }
        doc.autoTable({
            head: [['User', 'Login', 'Logout', 'Duration']],
            body: logData, startY: doc.lastAutoTable.finalY + 10,
            styles: { fontSize: 7 }, headStyles: { fillColor: [59, 130, 246] }
        });

        doc.save('UserWorkingTime_' + today() + '.pdf');
        showToast('PDF exported!', 'success');
    } catch(e) { showToast('Export failed: ' + e.message, 'error'); }
}

// ==================== ENHANCED REPORTS ====================
function renderReports() {
    var vehicles = DB.get('vehicles');
    var grns = DB.get('grn_records');
    var shorts = DB.get('short_reports');
    var locs = DB.get('location_master');
    var picks = DB.filter('obd_data', function(o) { return o.status === 'Picked' || o.status === 'Loaded' || o.status === 'Qty Mismatch' || o.status === 'Loading Assigned' || o.status === 'Loading In Progress'; });
    var loaded = DB.filter('loaded_vehicles', function(v) { return v.allMatch === true; });
    var mismatched = DB.filter('loaded_vehicles', function(v) { return v.allMatch === false; });
    var diffs = DB.get('difference_reports');
    var users = DB.get('users');

    var html = '<div class="section-header"><h2><i class="bx bxs-bar-chart-alt-2"></i> Reports</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-secondary btn-sm" onclick="exportFullReportPDF()"><i class="bx bx-download"></i> Full Report PDF</button>';
    html += '</div></div>';

    // KPIs
    html += '<div class="kpi-grid">';
    html += kpiCard('bxs-truck', vehicles.length, 'Total Vehicles');
    html += kpiCard('bx-check-circle', grns.length, 'Total GRN');
    html += kpiCard('bx-error-circle', shorts.filter(function(s) { return s.hasMismatch; }).length, 'Short/Excess');
    html += kpiCard('bxs-package', locs.filter(function(l) { return l.action === 'PUTAWAY'; }).length, 'Putaway');
    html += kpiCard('bxs-clipboard', locs.filter(function(l) { return l.action === 'PIV'; }).length, 'PIV');
    html += kpiCard('bxs-box', picks.length, 'Picking Done');
    html += kpiCard('bxs-truck', loaded.length, 'Loaded OK');
    html += kpiCard('bx-error', mismatched.length, 'Qty Mismatch');
    html += kpiCard('bx-error-circle', diffs.length, 'Picking Diffs');
    html += kpiCard('bxs-receipt', DB.get('audit_log').length, 'Audit Entries');
    html += '</div>';

    // Quick search
    html += '<div class="card" style="margin-bottom:16px"><div class="card-title">Quick Search by Any Number</div>';
    html += '<div class="form-row"><div class="form-group"><label>GRN No / Report No / Invoice No / OBD No / LOAD No / Vehicle No</label>';
    html += '<div style="display:flex;gap:8px"><input type="text" id="reportQuickSearch" class="form-input" placeholder="Type any number...">';
    html += '<button class="btn btn-primary" onclick="quickSearchReport()"><i class="bx bx-search"></i> Search</button></div></div></div>';
    html += '<div id="reportSearchResult"></div></div>';

    // --- Vehicle Report ---
    html += '<div class="card" style="margin-bottom:16px"><div class="card-title" style="cursor:pointer;display:flex;align-items:center;gap:8px" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'"><i class="bx bxs-truck"></i> Vehicle Report <i class="bx bx-chevron-down" style="margin-left:auto"></i></div>';
    html += '<div style="margin-top:12px"><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>Type</th><th>LR</th><th>Transport</th><th>Status</th><th>GRN</th><th>Report</th></tr></thead><tbody>';
    for (var vi = 0; vi < vehicles.length; vi++) {
        var v = vehicles[vi];
        var grnStr = v.grnNumbers ? v.grnNumbers.map(function(g) { return '<span style="font-family:var(--font-display);font-size:10px;color:var(--accent)">' + escapeHtml(g) + '</span>'; }).join(', ') : '-';
        var statusClass = v.status === 'Posted' || v.status === 'Unloaded' ? 'badge-success' : (v.status === 'Posting Pending Approval' ? 'badge-danger' : 'badge-warning');
        html += '<tr><td><strong>' + escapeHtml(v.vehicleNo) + '</strong></td><td>' + escapeHtml(v.vehicleType || '-') + '</td>';
        html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(v.lrNo || '-') + '</td>';
        html += '<td>' + escapeHtml(v.transportName || '-') + '</td>';
        html += '<td><span class="badge ' + statusClass + '">' + escapeHtml(v.status) + '</span></td>';
        html += '<td>' + grnStr + '</td>';
        html += '<td style="font-family:var(--font-display);font-size:10px">' + escapeHtml(v.shortReportNo || '-') + '</td></tr>';
    }
    html += '</tbody></table></div></div></div>';

    // --- User Productivity Report ---
    html += '<div class="card" style="margin-bottom:16px"><div class="card-title" style="cursor:pointer;display:flex;align-items:center;gap:8px" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'"><i class="bx bx-bar-chart"></i> User Productivity <i class="bx bx-chevron-down" style="margin-left:auto"></i></div>';
    html += '<div style="margin-top:12px"><div class="table-wrapper"><table class="data-table"><thead><tr><th>User</th><th>Role</th><th>Vehicles Unloaded</th><th>Putaway Items</th><th>PIV Items</th><th>Picking OBDs</th><th>Loadings</th></tr></thead><tbody>';
    for (var ui = 0; ui < users.length; ui++) {
        var usr = users[ui];
        var unloaded = DB.filter('vehicles', function(v) { return v.assignedTo === usr.username && (v.status === 'Posted' || v.status === 'Posting Pending Approval' || v.status === 'Unloaded'); }).length;
        var putawayItems = DB.filter('location_master', function(l) { return l.user === usr.name && l.action === 'PUTAWAY'; }).length;
        var pivItems = DB.filter('location_master', function(l) { return l.user === usr.name && l.action === 'PIV'; }).length;
        var pickedObds = DB.filter('obd_data', function(o) { return o.assignedPicker === usr.username && (o.status === 'Picked' || o.status === 'Loaded' || o.status === 'Qty Mismatch'); }).length;
        var loadings = DB.filter('loaded_vehicles', function(lv) { return lv.loader === usr.name; }).length;
        html += '<tr><td><strong>' + escapeHtml(usr.name) + '</strong></td><td><span class="badge badge-info">' + escapeHtml(usr.role) + '</span></td>';
        html += '<td>' + unloaded + '</td><td>' + putawayItems + '</td><td>' + pivItems + '</td>';
        html += '<td>' + pickedObds + '</td><td>' + loadings + '</td></tr>';
    }
    html += '</tbody></table></div></div></div>';

    // --- Difference Report Summary ---
    if (diffs.length > 0) {
        html += '<div class="card" style="margin-bottom:16px;border:2px solid var(--danger)"><div class="card-title" style="color:var(--danger);cursor:pointer;display:flex;align-items:center;gap:8px" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'"><i class="bx bx-error-circle"></i> Picking Difference Report (' + diffs.length + ') <i class="bx bx-chevron-down" style="margin-left:auto"></i></div>';
        html += '<div style="margin-top:12px"><div class="table-wrapper"><table class="data-table"><thead><tr><th>Date</th><th>OBD No</th><th>Picker</th><th>Material</th><th>Location</th><th>Reason</th><th>Expected</th><th>Picked</th></tr></thead><tbody>';
        for (var di = 0; di < diffs.length; di++) {
            var diff = diffs[di];
            html += '<tr><td style="font-size:11px">' + formatDateTime(diff.dateTime) + '</td>';
            html += '<td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">' + escapeHtml(diff.obdNo) + '</td>';
            html += '<td>' + escapeHtml(diff.pickerName) + '</td>';
            html += '<td>' + escapeHtml(diff.material) + '</td>';
            html += '<td><span class="badge badge-accent">' + escapeHtml(diff.location) + '</span></td>';
            html += '<td><span class="badge badge-danger">' + escapeHtml(diff.reason) + '</span>' + (diff.reasonDetail ? '<br><small style="color:var(--text-muted)">' + escapeHtml(diff.reasonDetail) + '</small>' : '') + '</td>';
            html += '<td>' + diff.expectedQty + '</td>';
            html += '<td class="qty-mismatch">' + diff.pickedQty + '</td></tr>';
        }
        html += '</tbody></table></div></div></div>';
    }

    document.getElementById('section-reports').innerHTML = html;
}

function exportFullReportPDF() {
    try {
        var doc = new jspdf.jsPDF('l', 'mm', 'a4');
        doc.setFontSize(18); doc.text('VIP INDUSTRIES LIMITED (MD20)', 14, 15);
        doc.setFontSize(12); doc.text('Complete Warehouse Report', 14, 23);
        doc.setFontSize(9); doc.text('Generated: ' + formatDateTime(new Date()) + ' | By: ' + (APP.currentUser ? APP.currentUser.name : 'System'), 14, 30);

        var y = 38;

        // Vehicle Summary
        var vehicles = DB.get('vehicles');
        var vehData = vehicles.map(function(v) {
            return [v.vehicleNo, v.vehicleType || '-', v.lrNo || '-', v.transportName || '-', v.status, v.grnNumbers ? v.grnNumbers.join(', ') : '-', v.shortReportNo || '-'];
        });
        doc.setFontSize(11); doc.text('Vehicle Report', 14, y); y += 5;
        doc.autoTable({
            head: [['Vehicle', 'Type', 'LR', 'Transport', 'Status', 'GRN', 'Short Report']],
            body: vehData, startY: y, styles: { fontSize: 6 },
            headStyles: { fillColor: [0, 229, 160] }
        });
        y = doc.lastAutoTable.finalY + 10;

        // GRN Report
        var grns = DB.get('grn_records');
        var grnData = grns.map(function(g) {
            return [g.grnNo, g.vehicleNo, g.lrNo, g.invoiceNo, g.postedBy, formatDateTime(g.postedAt)];
        });
        if (grnData.length > 0) {
            doc.setFontSize(11); doc.text('GRN Report', 14, y); y += 5;
            doc.autoTable({
                head: [['GRN No', 'Vehicle', 'LR', 'Invoice', 'Posted By', 'Date']],
                body: grnData, startY: y, styles: { fontSize: 6 },
                headStyles: { fillColor: [16, 185, 129] }
            });
            y = doc.lastAutoTable.finalY + 10;
        }

        // Picking Difference
        var diffs = DB.get('difference_reports');
        if (diffs.length > 0) {
            var diffData = diffs.map(function(d) {
                return [d.obdNo, d.pickerName, d.material, d.location, d.reason, d.expectedQty, d.pickedQty, formatDateTime(d.dateTime)];
            });
            doc.setFontSize(11); doc.text('Picking Difference Report', 14, y); y += 5;
            doc.autoTable({
                head: [['OBD', 'Picker', 'Material', 'Location', 'Reason', 'Expected', 'Picked', 'Date']],
                body: diffData, startY: y, styles: { fontSize: 6 },
                headStyles: { fillColor: [239, 68, 68] }
            });
            y = doc.lastAutoTable.finalY + 10;
        }

        // Loaded Vehicles
        var loaded = DB.get('loaded_vehicles');
        if (loaded.length > 0) {
            var loadData = loaded.map(function(lv) {
                return [lv.vehicleNo, lv.obdNo, lv.loadingNo, lv.loader, lv.securityName, lv.allMatch ? 'Match' : 'Mismatch', formatDateTime(lv.loadedAt)];
            });
            doc.setFontSize(11); doc.text('Loading Report', 14, y); y += 5;
            doc.autoTable({
                head: [['Vehicle', 'OBD', 'Loading No', 'Loader', 'Security', 'Status', 'Date']],
                body: loadData, startY: y, styles: { fontSize: 6 },
                headStyles: { fillColor: [59, 130, 246] }
            });
        }

        doc.save('WMS_FullReport_' + today() + '.pdf');
        showToast('Full report PDF exported!', 'success');
    } catch(e) { showToast('Export failed: ' + e.message, 'error'); }
}

/* ============================================================
   CRITICAL FIX: Real-time re-render wiping scan area
   ============================================================ */

// Add flag to prevent re-render during active sessions
APP.isScanning = false;
APP.isLoading = false;
APP.isPickingActive = false;

// Override the real-time sync to check flag FIRST
// Find and replace the old real-time listener
if (supabaseClient) {
    try {
        // Unsubscribe from old channel first
        supabaseClient.removeAllChannels();
        
        // Re-subscribe with fix
        supabaseClient.channel('db-live-sync-fixed')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'app_data' }, 
            function(payload) {
                if (payload.new && payload.new.key && payload.new.value) {
                    // Save to local storage
                    localStorage.setItem('wms_' + payload.new.key, JSON.stringify(payload.new.value));
                    
                    // FIX: Don't re-render if user is in active scanning/loading/picking session
                    if (APP.isScanning || APP.isLoading || APP.isPickingActive) {
                        console.log('Real-time update received but skipped (active session)');
                        return;
                    }
                    
                    if (APP.currentUser && APP.currentSection) {
                        // Small delay to prevent rapid re-renders
                        clearTimeout(APP._renderTimeout);
                        APP._renderTimeout = setTimeout(function() {
                            renderSection(APP.currentSection, APP.currentSub);
                            showToast('Live Update: Data changed', 'info');
                        }, 2000);
                    }
                }
            }
        )
        .subscribe(function(status) {
            console.log('Real-time sync status:', status);
        });
    } catch(e) {
        console.log('Real-time sync error:', e);
    }
}


// ==================== COMPLETE UNLOADING FIX ====================

function renderUnloadingScreen() {
    if (!APP.currentUser) return '<div class="card"><div class="empty-state"><i class="bx bx-lock"></i><p>Not logged in</p></div></div>';

    // FIX: Correct operator precedence with parentheses
    var myVehicles = DB.filter('vehicles', function(v) {
        return v.vehicleType === 'Unloading' && v.assignedTo && 
               (v.assignedTo === APP.currentUser.username || 
                APP.currentUser.role === 'Super Admin' || 
                APP.currentUser.role === 'Admin' || 
                APP.currentUser.role === 'Manager') &&
               (v.status === 'Assigned' || v.status === 'Unloading In Progress');
    });

    var html = '<div class="section-header"><h2><i class="bx bx-download"></i> Unloading Screen</h2>';
    html += '<div style="color:var(--text-muted);font-size:13px">User: <strong style="color:var(--accent)">' + escapeHtml(APP.currentUser.name) + '</strong> (' + escapeHtml(APP.currentUser.role) + ')</div></div>';

    if (myVehicles.length === 0) {
        html += '<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No vehicles assigned for unloading</p>';
        
        // Show hint if vehicles exist but assigned to others
        var otherVehicles = DB.filter('vehicles', function(v) {
            return v.vehicleType === 'Unloading' && v.assignedTo && v.assignedTo !== APP.currentUser.username &&
                   (v.status === 'Assigned' || v.status === 'Unloading In Progress');
        });
        
        if (otherVehicles.length > 0) {
            html += '<div style="margin-top:16px;text-align:left;max-width:450px;margin-left:auto;margin-right:auto">';
            html += '<p style="color:var(--warning);font-weight:600;margin-bottom:8px"><i class="bx bx-info-circle"></i> ' + otherVehicles.length + ' vehicle(s) assigned to OTHER users:</p>';
            for (var i = 0; i < otherVehicles.length; i++) {
                html += '<div style="background:var(--bg-secondary);padding:8px 12px;border-radius:6px;margin-bottom:4px;font-size:12px">';
                html += '<strong>' + escapeHtml(otherVehicles[i].vehicleNo) + '</strong> → <span class="badge badge-info">' + escapeHtml(otherVehicles[i].assignedTo || '?') + '</span>';
                html += '</div>';
            }
            html += '</div>';
        } else {
            html += '<small style="color:var(--text-muted);display:block;margin-top:8px">Go to <strong>Pending Vehicle</strong> tab to assign vehicles first</small>';
        }
        html += '</div></div>';
        return html;
    }

    // Vehicle table
    html += '<div class="card"><div class="card-title">Vehicles Ready to Unload (' + myVehicles.length + ')</div>';
    html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR No</th><th>Assigned To</th><th>Status</th><th>Invoices</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < myVehicles.length; i++) {
        var v = myVehicles[i];
        var invCount = DB.filter('invoices', function(inv) { return inv.vehicleId === v.id; }).length;
        html += '<tr><td><strong>' + escapeHtml(v.vehicleNo) + '</strong></td>';
        html += '<td style="font-family:var(--font-display);font-size:12px;color:var(--warning)">' + escapeHtml(v.lrNo) + '</td>';
        html += '<td>' + escapeHtml(v.assignedTo || '-') + '</td>';
        html += '<td><span class="badge badge-warning">' + escapeHtml(v.status) + '</span></td>';
        html += '<td><span class="badge ' + (invCount > 0 ? 'badge-success' : 'badge-danger') + '">' + invCount + '</span></td>';
        html += '<td><button class="btn btn-primary btn-sm" onclick="startUnloading(\'' + v.id + '\')"><i class="bx bx-download"></i> Unload</button></td></tr>';
    }
    html += '</tbody></table></div></div>';

    // Scan area — ALWAYS in DOM but hidden
    html += '<div id="unloadingScanArea" style="display:none"></div>';
    return html;
}


// COMPLETE startUnloading with all fixes
function startUnloading(vehicleId) {
    var vehicle = DB.find('vehicles', vehicleId);
    if (!vehicle) {
        showToast('Vehicle not found! Try refreshing.', 'error');
        return;
    }

    // SET FLAG — prevents real-time re-render from wiping scan area
    APP.isScanning = true;

    // Update status
    DB.update('vehicles', vehicleId, { status: 'Unloading In Progress' });
    currentUnloadSession = {
        vehicleId: vehicleId,
        scannedItems: [],
        startTime: new Date().toISOString()
    };
    logAction('Inbound', 'UNLOAD_START', 'Started unloading vehicle ' + vehicle.vehicleNo);

    // Build scan HTML
    var scanHtml = '';
    scanHtml += '<div class="card" style="border:2px solid var(--accent)">';
    scanHtml += '<div class="card-title" style="color:var(--accent);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">';
    scanHtml += '<span><i class="bx bx-scan"></i> Scanning — <strong>' + escapeHtml(vehicle.vehicleNo) + '</strong> (LR: ' + escapeHtml(vehicle.lrNo) + ')</span>';
    scanHtml += '<span class="badge badge-warning" id="unloadScanCount">0 items scanned</span>';
    scanHtml += '</div>';

    // Scan form
    scanHtml += '<div class="form-row" style="margin-bottom:16px">';
    scanHtml += '<div class="form-group"><label>EAN / Barcode <span class="req">*</span></label>';
    scanHtml += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    scanHtml += '<input type="text" id="scanEanInput" class="form-input" placeholder="Scan or type EAN..." style="flex:1;min-width:200px" onkeydown="if(event.key===\'Enter\')addScanItem()">';
    scanHtml += '<button class="btn btn-primary btn-sm" onclick="addScanItem()"><i class="bx bx-plus"></i> Add</button>';
    scanHtml += '<button class="btn btn-secondary btn-sm scan-btn" onclick="openScannerForField(\'scanEanInput\',\'scanMaterial\',\'scanDesc\')"><i class="bx bx-qr"></i> Camera</button>';
    scanHtml += '</div></div>';
    scanHtml += '<div class="form-group"><label>Material (Auto / Manual)</label><input type="text" id="scanMaterial" class="form-input" placeholder="Auto-filled or type manually"></div>';
    scanHtml += '<div class="form-group"><label>Description</label><input type="text" id="scanDesc" class="form-input" placeholder="Auto-filled"></div>';
    scanHtml += '<div class="form-group"><label>Qty (1 per scan)</label><input type="number" id="scanQty" class="form-input" value="1" min="1" style="max-width:100px"></div>';
    scanHtml += '</div>';

    // Scanned items container
    scanHtml += '<div id="scannedItemsTable"></div>';

    scanHtml += '<hr class="cyber-line">';
    scanHtml += '<div class="form-actions">';
    scanHtml += '<button class="btn btn-danger" onclick="cancelUnloading()"><i class="bx bx-x"></i> Cancel</button>';
    scanHtml += '<button class="btn btn-primary" onclick="submitUnloading()"><i class="bx bx-check-double"></i> Submit Unloading</button>';
    scanHtml += '</div></div>';

    // Insert into DOM
    var area = document.getElementById('unloadingScanArea');
    if (!area) {
        // Fallback: create the div if it doesn't exist
        var section = document.getElementById('section-inbound');
        if (section) {
            var div = document.createElement('div');
            div.id = 'unloadingScanArea';
            section.querySelector('.content-section, [class*="card"]:last-child]').appendChild(div);
            area = div;
        }
    }

    if (area) {
        area.innerHTML = scanHtml;
        area.style.display = 'block';
        
        // Focus the EAN input
        setTimeout(function() {
            var eanInput = document.getElementById('scanEanInput');
            if (eanInput) eanInput.focus();
        }, 100);

        // Render empty scan table
        renderScannedItems();
        
        showToast('Scanning started for ' + vehicle.vehicleNo, 'success');
    } else {
        showToast('ERROR: Scan area not found! Refreshing page...', 'error');
        APP.isScanning = false;
        setTimeout(function() { location.reload(); }, 2000);
    }
}


// FIXED cancelUnloading — clears the flag
function cancelUnloading() {
    if (currentUnloadSession && currentUnloadSession.scannedItems.length > 0) {
        if (!confirm('Are you sure? All scanned data will be lost.')) return;
    }
    if (currentUnloadSession && currentUnloadSession.vehicleId) {
        DB.update('vehicles', currentUnloadSession.vehicleId, { status: 'Assigned' });
    }
    APP.isScanning = false;  // CLEAR FLAG
    currentUnloadSession = { vehicleId: null, scannedItems: [], startTime: null };
    
    var area = document.getElementById('unloadingScanArea');
    if (area) {
        area.style.display = 'none';
        area.innerHTML = '';
    }
    renderInbound('unloading-screen');
}


// FIXED submitUnloading — clears the flag
function submitUnloading() {
    if (!currentUnloadSession || currentUnloadSession.scannedItems.length === 0) {
        showToast('No items scanned!', 'error');
        return;
    }

    var vehicle = DB.find('vehicles', currentUnloadSession.vehicleId);
    if (!vehicle) { showToast('Vehicle not found!', 'error'); return; }

    // Update invoice_materials with scanned quantities
    var invoices = DB.filter('invoices', function(inv) { return inv.vehicleId === currentUnloadSession.vehicleId; });
    for (var i = 0; i < invoices.length; i++) {
        var mats = DB.filter('invoice_materials', function(im) { return im.invoiceId === invoices[i].id; });
        for (var j = 0; j < mats.length; j++) {
            var scannedQty = 0;
            for (var s = 0; s < currentUnloadSession.scannedItems.length; s++) {
                var si = currentUnloadSession.scannedItems[s];
                if (si.inInvoice && (si.ean === mats[j].ean || si.material.toUpperCase() === mats[j].material.toUpperCase())) {
                    scannedQty += si.qty;
                }
            }
            DB.update('invoice_materials', mats[j].id, { unloadedQty: scannedQty });
        }
    }

    // Generate Short/Excess Report
    var shortReportNo = DB.shortNo();
    var reportLines = [];
    var hasMismatch = false;

    for (var ii = 0; ii < invoices.length; ii++) {
        var invMats = DB.filter('invoice_materials', function(im) { return im.invoiceId === invoices[ii].id; });
        for (var jj = 0; jj < invMats.length; jj++) {
            var im = invMats[jj];
            var diff = (im.unloadedQty || 0) - im.qty;
            var status = diff === 0 ? 'Match' : (diff < 0 ? 'Short' : 'Excess');
            if (diff !== 0) hasMismatch = true;
            reportLines.push({
                invoiceNo: invoices[ii].invoiceNo, material: im.material, ean: im.ean || '',
                invoiceQty: im.qty, scannedQty: im.unloadedQty || 0, difference: diff, status: status
            });
        }
    }

    // Non-invoice scanned items
    for (var ni = 0; ni < currentUnloadSession.scannedItems.length; ni++) {
        var ns = currentUnloadSession.scannedItems[ni];
        if (!ns.inInvoice) {
            reportLines.push({
                invoiceNo: 'N/A', material: ns.material, ean: ns.ean,
                invoiceQty: 0, scannedQty: ns.qty, difference: ns.qty, status: 'Extra'
            });
            hasMismatch = true;
        }
    }

    // Save short report
    DB.add('short_reports', {
        reportNo: shortReportNo, vehicleId: currentUnloadSession.vehicleId,
        vehicleNo: vehicle.vehicleNo, lrNo: vehicle.lrNo,
        unloader: APP.currentUser.name, unloaderUser: APP.currentUser.username,
        lines: reportLines, hasMismatch: hasMismatch,
        dateTime: new Date().toISOString()
    });

    // Save receiving doc
    var rcvNo = DB.rcvNo();
    DB.add('receiving_docs', {
        rcvNo: rcvNo, vehicleId: currentUnloadSession.vehicleId,
        vehicleNo: vehicle.vehicleNo, lrNo: vehicle.lrNo,
        scannedItems: currentUnloadSession.scannedItems,
        shortReportNo: shortReportNo, unloader: APP.currentUser.name,
        dateTime: new Date().toISOString()
    });

    // CLEAR FLAG before updating status (to prevent re-render wipe)
    APP.isScanning = false;

    if (hasMismatch) {
        DB.update('vehicles', currentUnloadSession.vehicleId, {
            status: 'Posting Pending Approval',
            shortReportNo: shortReportNo, rcvNo: rcvNo,
            unloadedAt: new Date().toISOString()
        });
        addNotification('Vehicle ' + vehicle.vehicleNo + ' — Pending Approval. Report: ' + shortReportNo, 'warning');
        var managers = DB.filter('users', function(u) { return u.role === 'Manager' || u.role === 'Super Admin'; });
        for (var mg = 0; mg < managers.length; mg++) {
            addNotification('Approval needed: ' + vehicle.vehicleNo + '. Report: ' + shortReportNo, 'warning', managers[mg].username);
        }
        logAction('Inbound', 'UNLOAD_SUBMIT', 'Unloading submitted. MISMATCH — Pending Approval. Report: ' + shortReportNo);
        showToast('Submitted! Pending approval due to mismatch.', 'warning');
    } else {
        // Perfect match — post directly
        postVehicle(currentUnloadSession.vehicleId, shortReportNo, rcvNo);
        logAction('Inbound', 'UNLOAD_SUBMIT', 'Unloading submitted. PERFECT MATCH — Auto Posted. Report: ' + shortReportNo);
        showToast('Submitted! Perfect match — auto posted! GRN created.', 'success');
    }

    // Clear session
    currentUnloadSession = { vehicleId: null, scannedItems: [], startTime: null };

    // Small delay then re-render
    setTimeout(function() {
        renderInbound('unloading-screen');
    }, 500);
}


// FIXED renderScannedItems — with proper null checks
function renderScannedItems() {
    var container = document.getElementById('scannedItemsTable');
    if (!container) return;

    // Update count
    var countBadge = document.getElementById('unloadScanCount');
    if (countBadge && currentUnloadSession) {
        countBadge.textContent = currentUnloadSession.scannedItems.length + ' items scanned';
    }

    if (!currentUnloadSession || currentUnloadSession.scannedItems.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px">';
        container.innerHTML += '<i class="bx bx-qr-scan" style="font-size:40px;display:block;margin-bottom:10px;opacity:.3"></i>';
        container.innerHTML += 'Scan EAN barcode to start<br>';
        container.innerHTML += '<small>Each scan = 1 qty. Change qty before adding next item.</small>';
        container.innerHTML += '</div>';
        return;
    }

    var html = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Description</th><th>Qty</th><th>Invoice Status</th><th>Action</th></tr></thead><tbody>';

    for (var k = 0; k < currentUnloadSession.scannedItems.length; k++) {
        var s = currentUnloadSession.scannedItems[k];
        var rowStyle = s.inInvoice ? '' : 'style="background:var(--danger-dim)"';
        var statusBadge = s.inInvoice 
            ? '<span class="badge badge-success"><i class="bx bx-check"></i> In Invoice</span>' 
            : '<span class="badge badge-danger"><i class="bx bx-x"></i> NOT in Invoice</span>';

        html += '<tr ' + rowStyle + '>';
        html += '<td>' + (k + 1) + '</td>';
        html += '<td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(s.ean) + '</td>';
        html += '<td>' + escapeHtml(s.material) + '</td>';
        html += '<td style="font-size:12px;color:var(--text-secondary)">' + escapeHtml(s.description) + '</td>';
        html += '<td><strong>' + s.qty + '</strong></td>';
        html += '<td>' + statusBadge + '</td>';
        html += '<td><button class="btn btn-danger btn-sm" onclick="removeScanItem(\'' + s.id + '\')"><i class="bx bx-trash"></i></button></td>';
        html += '</tr>';
    }

    html += '</tbody></table></div>';

    // Summary boxes
    var matched = 0, notMatched = 0;
    for (var m = 0; m < currentUnloadSession.scannedItems.length; m++) {
        if (currentUnloadSession.scannedItems[m].inInvoice) matched++;
        else notMatched++;
    }

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">';
    html += '<div style="padding:12px;background:rgba(16,185,129,.1);border-radius:8px;border:1px solid rgba(16,185,129,.3);text-align:center">';
    html += '<strong style="color:var(--success);font-size:20px">' + matched + '</strong><br><small style="color:var(--text-muted)">Matched (Green)</small></div>';
    html += '<div style="padding:12px;background:var(--danger-dim);border-radius:8px;border:1px solid rgba(239,68,68,.3);text-align:center">';
    html += '<strong style="color:var(--danger);font-size:20px">' + notMatched + '</strong><br><small style="color:var(--text-muted)">Not in Invoice (Red)</small></div>';
    html += '</div>';

    container.innerHTML = html;
}


// FIXED removeScanItem
function removeScanItem(itemId) {
    if (!currentUnloadSession) return;
    currentUnloadSession.scannedItems = currentUnloadSession.scannedItems.filter(function(s) { return s.id !== itemId; });
    renderScannedItems();
}


// FIXED addScanItem — with null checks
function addScanItem() {
    if (!currentUnloadSession) {
        showToast('No active unloading session! Click Unload first.', 'error');
        return;
    }

    var eanEl = document.getElementById('scanEanInput');
    var matEl = document.getElementById('scanMaterial');
    var descEl = document.getElementById('scanDesc');
    var qtyEl = document.getElementById('scanQty');

    if (!eanEl) { showToast('Scan area not loaded! Refresh page.', 'error'); return; }

    var ean = eanEl.value.trim();
    if (!ean) { showToast('Scan or enter EAN first', 'error'); return; }

    var material = matEl ? matEl.value.trim() : '';
    var desc = descEl ? descEl.value.trim() : '';
    var qty = qtyEl ? (parseInt(qtyEl.value) || 1) : 1;

    // Auto-fill from material master
    if (!material || !desc) {
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === ean || matMaster[i].material.toUpperCase() === ean.toUpperCase()) {
                material = material || matMaster[i].material;
                desc = desc || matMaster[i].description;
                ean = matMaster[i].ean || ean;
                break;
            }
        }
    }

    // Check if in vehicle's invoice
    var invoices = DB.filter('invoices', function(inv) { return inv.vehicleId === currentUnloadSession.vehicleId; });
    var foundInInvoice = false;
    for (var ii = 0; ii < invoices.length; ii++) {
        var mats = DB.filter('invoice_materials', function(im) { return im.invoiceId === invoices[ii].id; });
        for (var jj = 0; jj < mats.length; jj++) {
            if (mats[jj].ean === ean || mats[jj].material.toUpperCase() === (material || '').toUpperCase()) {
                foundInInvoice = true;
                break;
            }
        }
        if (foundInInvoice) break;
    }

    currentUnloadSession.scannedItems.push({
        id: DB.uid(), ean: ean, material: material || 'UNKNOWN', description: desc || '-',
        qty: qty, inInvoice: foundInInvoice, scanTime: new Date().toISOString()
    });

    // Clear inputs
    eanEl.value = '';
    if (matEl) matEl.value = '';
    if (descEl) descEl.value = '';
    if (qtyEl) qtyEl.value = '1';
    eanEl.focus();

    renderScannedItems();

    if (!foundInInvoice) {
        showToast('WARNING: NOT in invoice! Row is RED.', 'warning');
    } else {
        showToast('Scanned: ' + (material || ean) + ' ✓', 'success');
    }
}
/* ============================================================
   FINAL FIX: Putaway + PIV Scan (EAN + Rack) — Complete
   ============================================================ */

// ==================== MASTER SCANNER ENGINE ====================
var _scannerInstance = null;
var _scannerCallback = null;

// Open scanner modal (works for ALL scan types)
function openMyScanner(callback) {
    _scannerCallback = callback;
    var modal = document.getElementById('scannerModal');
    if (!modal) {
        // Create modal if not exists
        modal = document.createElement('div');
        modal.id = 'scannerModal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'z-index:99999;display:none;';
        modal.innerHTML = '<div class="modal-container" style="max-width:420px"><div class="modal-header"><h3><i class="bx bx-qr-scan"></i> Scan Code</h3><button class="modal-close" onclick="closeMyScanner()"><i class="bx bx-x"></i></button></div><div class="modal-body" style="text-align:center;padding:10px"><div style="margin-bottom:15px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="startMyCamera()"><i class="bx bx-camera"></i> Camera Scan</button><button class="btn btn-secondary btn-sm" onclick="startMyBluetooth()"><i class="bx bx-bluetooth"></i> Bluetooth/USB</button></div><div id="myQrReader" style="width:100%;border-radius:8px;overflow:hidden;background:#000;min-height:50px"></div><p style="color:var(--text-muted);margin-top:10px;font-size:12px">Camera open hone pe barcode ko saamne rakhna</p></div></div>';
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    var readerDiv = document.getElementById('myQrReader');
    if (readerDiv) {
        readerDiv.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)"><i class="bx bx-camera" style="font-size:40px;display:block;margin-bottom:10px;opacity:.4"></i>Click <strong>Camera Scan</strong> to start</div>';
    }
}

function closeMyScanner() {
    var modal = document.getElementById('scannerModal');
    if (modal) modal.style.display = 'none';
    if (_scannerInstance) {
        try { _scannerInstance.stop(); } catch(e) {}
        _scannerInstance = null;
    }
    var readerDiv = document.getElementById('myQrReader');
    if (readerDiv) readerDiv.innerHTML = '';
}

function startMyCamera() {
    var readerDiv = document.getElementById('myQrReader');
    if (!readerDiv) return;
    readerDiv.innerHTML = '<div style="padding:30px;text-align:center;color:var(--accent)"><i class="bx bx-loader-circle bx-spin" style="font-size:36px;display:block;margin-bottom:10px"></i>Camera starting...</div>';

    // Stop previous
    if (_scannerInstance) {
        try { _scannerInstance.stop(); } catch(e) {}
        _scannerInstance = null;
    }

    setTimeout(function() {
        try {
            _scannerInstance = new Html5Qrcode('myQrReader');
            _scannerInstance.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.5 },
                function(decodedText) {
                    // SCAN SUCCESS
                    try { _scannerInstance.stop(); } catch(e) {}
                    _scannerInstance = null;
                    closeMyScanner();
                    if (_scannerCallback) {
                        setTimeout(function() { _scannerCallback(decodedText); }, 200);
                    }
                },
                function() { /* scanning... */ }
            ).then(function() {
                console.log('Camera started');
            }).catch(function(err) {
                readerDiv.innerHTML = '<div style="padding:20px;text-align:center;color:var(--danger)"><i class="bx bx-error-circle" style="font-size:36px;display:block;margin-bottom:10px"></i><strong>Camera Error</strong><br><small style="color:var(--text-muted)">' + escapeHtml(String(err)) + '</small><br><br><button class="btn btn-secondary btn-sm" onclick="startMyCamera()"><i class="bx bx-refresh"></i> Retry</button></div>';
            });
        } catch(e) {
            readerDiv.innerHTML = '<div style="padding:20px;text-align:center;color:var(--danger)"><i class="bx bx-error" style="font-size:36px;display:block;margin-bottom:10px"></i>Scanner failed<br><small>' + escapeHtml(String(e)) + '</small></div>';
        }
    }, 300);
}

function startMyBluetooth() {
    closeMyScanner();
    // Remove old
    var old = document.getElementById('btScanInput');
    if (old) old.remove();

    // Create big visible input at top
    var input = document.createElement('input');
    input.id = 'btScanInput';
    input.type = 'text';
    input.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:60px;background:linear-gradient(135deg,#00E5A0,#00B87A);color:#000;font-size:20px;font-weight:800;text-align:center;z-index:999999;padding:12px;border:none;outline:none;letter-spacing:1px';
    input.placeholder = '|||| SCANNING — SCAN BARCODE NOW ||||';
    document.body.appendChild(input);

    setTimeout(function() { input.focus(); }, 100);

    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            var val = input.value.trim();
            input.remove();
            if (val && _scannerCallback) {
                _scannerCallback(val);
            }
        }
    });

    // Auto-remove after 30 seconds
    setTimeout(function() {
        var el = document.getElementById('btScanInput');
        if (el) el.remove();
    }, 30000);

    showToast('Bluetooth scanner ready! Scan now...', 'info');
}


// ==================== PUTAWAY WITH WORKING SCANS ====================
function renderPutaway() {
    var html = '<div class="section-header"><h2><i class="bx bxs-package"></i> Putaway</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="clearPutawayBuffer()"><i class="bx bx-plus"></i> New</button>';
    html += '<button class="btn btn-success btn-sm" onclick="savePutawayBuffer()"><i class="bx bx-save"></i> Save All</button>';
    html += '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadPutaway(this)"></label>';
    html += '</div></div>';

    // Mode toggle
    html += '<div class="card" style="margin-bottom:16px"><div class="form-group">';
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap">';
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid var(--accent);border-radius:8px;background:var(--accent-dim);font-weight:600;color:var(--accent)"><input type="radio" name="putMode" value="without" checked style="accent-color:var(--accent);width:16px;height:16px"> WITHOUT Invoice</label>';
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid var(--border);border-radius:8px;font-weight:600;color:var(--text-secondary)"><input type="radio" name="putMode" value="with" style="accent-color:var(--info);width:16px;height:16px"> WITH Invoice</label>';
    html += '</div></div>';
    html += '<div id="putInvSel" style="display:none;margin-top:12px"><select id="putawayInvoiceSelect" class="form-input" onchange="loadPutawayInvoiceMaterials()"><option value="">-- Select Invoice --</option>';
    var pInvs = DB.filter('invoices', function(inv) { return inv.status === 'Posted'; });
    for (var i = 0; i < pInvs.length; i++) {
        var pv = DB.find('vehicles', pInvs[i].vehicleId);
        html += '<option value="' + pInvs[i].id + '">' + escapeHtml(pInvs[i].invoiceNo) + ' — ' + escapeHtml(pv ? pv.vehicleNo : '') + '</option>';
    }
    html += '</select><div id="putawayInvoiceMaterials" style="margin-top:8px"></div></div></div>';

    // ===== SCAN FORM WITH ALL SCAN BUTTONS =====
    html += '<div class="card" style="border:2px solid var(--accent);margin-bottom:16px">';
    html += '<div class="card-title" style="color:var(--accent)"><i class="bx bx-scan"></i> Scan & Putaway</div>';
    html += '<div class="form-row">';

    // EAN with SCAN
    html += '<div class="form-group"><label>EAN / Barcode <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    html += '<input type="text" id="putEanInput" class="form-input" placeholder="Scan or type EAN..." style="flex:1;min-width:180px" onkeydown="if(event.key===\'Enter\')doPutawayScan()">';
    html += '<button class="btn btn-primary btn-sm" onclick="doPutawayScan()"><i class="bx bx-plus"></i></button>';
    html += '<button class="btn btn-secondary btn-sm scan-btn" style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent)" onclick="doPutawayEanScan()"><i class="bx bx-camera"></i> Scan</button>';
    html += '</div></div>';

    // Material (auto)
    html += '<div class="form-group"><label>Material (Auto)</label><input type="text" id="putMaterial" class="form-input" placeholder="Auto from master" style="background:var(--bg-secondary)"></div>';

    // Description (auto)
    html += '<div class="form-group"><label>Description (Auto)</label><input type="text" id="putDesc" class="form-input" placeholder="Auto from master" style="background:var(--bg-secondary)"></div>';

    // RACK WITH SCAN
    html += '<div class="form-group"><label>Rack / Location <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    html += '<select id="putRack" class="form-input" style="flex:1;min-width:150px"><option value="">-- Select Rack --</option>';
    var racks = DB.get('rack_master');
    for (var r = 0; r < racks.length; r++) {
        html += '<option value="' + escapeHtml(racks[r].rack) + '">' + escapeHtml(racks[r].rack) + '</option>';
    }
    html += '</select>';
    html += '<button class="btn btn-secondary btn-sm scan-btn" style="background:var(--accent2-dim);color:var(--accent2);border:1px solid var(--accent2)" onclick="doPutawayRackScan()"><i class="bx bx-qr"></i> Scan Rack</button>';
    html += '</div></div>';

    // Qty
    html += '<div class="form-group"><label>Qty <span class="req">*</span></label><input type="number" id="putQty" class="form-input" value="1" min="1" style="max-width:100px"></div>';

    // Packing
    html += '<div class="form-group"><label>Packing</label><select id="putPacking" class="form-input"><option value="Bag">Bag</option><option value="Box">Box</option><option value="Carton">Carton</option><option value="Pallet">Pallet</option><option value="Bottle">Bottle</option><option value="Pouch">Pouch</option><option value="Loose">Loose</option></select></div>';

    // Box No
    html += '<div class="form-group"><label>Box No</label><input type="text" id="putBoxNo" class="form-input" placeholder="e.g. B001"></div>';
    html += '</div>';

    html += '<div class="form-actions"><button class="btn btn-primary" onclick="doPutawayScan()"><i class="bx bx-plus-circle"></i> Add to Buffer</button></div>';
    html += '</div>';

    // Buffer
    html += '<div class="card"><div class="card-title">Putaway Buffer (<span id="putBufCnt">' + putawayBuffer.length + '</span>)</div>';
    html += '<div id="putBufTable"></div>';
    if (putawayBuffer.length > 0) {
        html += '<div class="form-actions" style="margin-top:12px"><button class="btn btn-success" onclick="savePutawayBuffer()"><i class="bx bx-save"></i> Save All to Bin</button><button class="btn btn-danger" onclick="clearPutawayBuffer()"><i class="bx bx-trash"></i> Clear</button></div>';
    }
    html += '</div>';

    // Today's putaway
    var tPut = DB.filter('location_master', function(l) { return l.action === 'PUTAWAY' && l.date === today(); });
    if (tPut.length > 0) {
        html += '<div class="card" style="margin-top:16px"><div class="card-title">Today (' + tPut.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Time</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>User</th></tr></thead><tbody>';
        for (var t = 0; t < tPut.length; t++) {
            html += '<tr><td>' + (t+1) + '</td><td style="font-size:11px">' + formatDateTime(tPut[t].dateTime) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(tPut[t].ean) + '</td><td>' + escapeHtml(tPut[t].material) + '</td><td><span class="badge badge-accent">' + escapeHtml(tPut[t].rack) + '</span></td><td><strong>' + tPut[t].quantity + '</strong></td><td>' + escapeHtml(tPut[t].user) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    // Mode toggle binding
    document.getElementById('section-putaway').innerHTML = html;

    // Bind mode toggle
    var modeRadios = document.querySelectorAll('input[name="putMode"]');
    for (var mr = 0; mr < modeRadios.length; mr++) {
        modeRadios[mr].addEventListener('change', function() {
            var sel = document.getElementById('putInvSel');
            if (sel) sel.style.display = this.value === 'with' ? 'block' : 'none';
        });
    }

    renderPutawayBuffer();
}

// PUTAWAY: EAN Scan button
function doPutawayEanScan() {
    openMyScanner(function(code) {
        var el = document.getElementById('putEanInput');
        if (el) el.value = code;
        // Auto-fill material
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === code || matMaster[i].material.toUpperCase() === code.toUpperCase()) {
                var mEl = document.getElementById('putMaterial');
                var dEl = document.getElementById('putDesc');
                if (mEl) mEl.value = matMaster[i].material;
                if (dEl) dEl.value = matMaster[i].description;
                if (el) el.value = matMaster[i].ean || code;
                break;
            }
        }
        showToast('EAN Scanned: ' + code, 'success');
    });
}

// PUTAWAY: Rack Scan button
function doPutawayRackScan() {
    openMyScanner(function(code) {
        var sel = document.getElementById('putRack');
        if (!sel) return;
        var rackCode = code.toUpperCase().trim();
        var found = false;
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value.toUpperCase() === rackCode || sel.options[i].value.toUpperCase().indexOf(rackCode) > -1) {
                sel.selectedIndex = i;
                found = true;
                break;
            }
        }
        if (found) {
            showToast('Rack Selected: ' + sel.value, 'success');
        } else {
            showToast('Rack "' + rackCode + '" not found. Select manually.', 'warning');
        }
    });
}

// PUTAWAY: Add item (from scan or manual)
function doPutawayScan() {
    var ean = document.getElementById('putEanInput').value.trim();
    var rack = document.getElementById('putRack').value;
    var qty = parseInt(document.getElementById('putQty').value) || 0;
    var packing = document.getElementById('putPacking').value;
    var boxNo = document.getElementById('putBoxNo').value.trim();
    var material = document.getElementById('putMaterial').value.trim();
    var desc = document.getElementById('putDesc').value.trim();

    if (!ean) { showToast('Scan or enter EAN first', 'error'); return; }
    if (!rack) { showToast('Select or scan a rack', 'error'); return; }
    if (qty <= 0) { showToast('Enter valid qty', 'error'); return; }

    // Auto-fill if still empty
    if (!material || !desc) {
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === ean || matMaster[i].material.toUpperCase() === ean.toUpperCase()) {
                material = material || matMaster[i].material;
                desc = desc || matMaster[i].description;
                ean = matMaster[i].ean || ean;
                break;
            }
        }
    }

    // Get invoice if in "with" mode
    var invId = '', invNo = '';
    var modeRadio = document.querySelector('input[name="putMode"]:checked');
    if (modeRadio && modeRadio.value === 'with') {
        var selInv = document.getElementById('putawayInvoiceSelect');
        if (selInv && selInv.value) {
            invId = selInv.value;
            var inv = DB.find('invoices', invId);
            invNo = inv ? inv.invoiceNo : '';
        }
    }

    putawayBuffer.push({
        id: DB.uid(), date: today(), ean: ean, material: material || 'UNKNOWN',
        description: desc || '-', rack: rack, quantity: qty, packing: packing,
        box: boxNo || '-', action: 'PUTAWAY', user: APP.currentUser ? APP.currentUser.name : 'System',
        invoiceId: invId, invoiceNo: invNo, dateTime: new Date().toISOString()
    });

    // Clear
    document.getElementById('putEanInput').value = '';
    document.getElementById('putMaterial').value = '';
    document.getElementById('putDesc').value = '';
    document.getElementById('putQty').value = '1';
    document.getElementById('putBoxNo').value = '';
    document.getElementById('putEanInput').focus();

    renderPutawayBuffer();
    showToast('Added: ' + (material || ean) + ' → ' + rack, 'success');
}

function renderPutawayBuffer() {
    var c = document.getElementById('putBufTable');
    var cnt = document.getElementById('putBufCnt');
    if (cnt) cnt.textContent = putawayBuffer.length;
    if (!c) return;
    if (putawayBuffer.length === 0) { c.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">Buffer empty — scan items above</div>'; return; }
    var h = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>Box</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < putawayBuffer.length; i++) {
        var p = putawayBuffer[i];
        h += '<tr><td>' + (i+1) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(p.ean) + '</td><td>' + escapeHtml(p.material) + '</td><td><span class="badge badge-accent">' + escapeHtml(p.rack) + '</span></td><td><strong>' + p.quantity + '</strong></td><td>' + escapeHtml(p.packing) + '</td><td>' + escapeHtml(p.box) + '</td><td><button class="btn btn-danger btn-sm" onclick="putawayBuffer.splice(' + i + ',1);renderPutawayBuffer()"><i class="bx bx-trash"></i></button></td></tr>';
    }
    h += '</tbody></table></div>';
    c.innerHTML = h;
}

function clearPutawayBuffer() {
    if (putawayBuffer.length > 0 && !confirm('Clear ' + putawayBuffer.length + ' items?')) return;
    putawayBuffer = [];
    renderPutaway();
}

function savePutawayBuffer() {
    if (putawayBuffer.length === 0) { showToast('Buffer empty!', 'error'); return; }
    for (var i = 0; i < putawayBuffer.length; i++) {
        var item = Object.assign({}, putawayBuffer[i]);
        delete item.id;
        DB.add('location_master', item);
    }
    var cnt = putawayBuffer.length;
    logAction('Putaway', 'SAVE', 'Saved ' + cnt + ' items to bin');
    showToast(cnt + ' items saved to Bin Master!', 'success');
    putawayBuffer = [];
    renderPutaway();
    addNotification(cnt + ' putaway items by ' + (APP.currentUser ? APP.currentUser.name : ''), 'success');
}


// ==================== PIV WITH WORKING SCANS ====================
function renderPIV() {
    var html = '<div class="section-header"><h2><i class="bx bxs-clipboard"></i> PIV (Physical Inventory Verification)</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="togglePivLive()"><i class="bx bx-play"></i> <span id="pivLiveTxt">Start Live Scan</span></button>';
    html += '<button class="btn btn-success btn-sm" onclick="savePivData()"><i class="bx bx-save"></i> Save to Bin</button>';
    html += '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadPIV(this)"></label>';
    html += '</div></div>';

    // Live indicator
    html += '<div id="pivLiveInd" style="display:none;padding:10px;background:var(--accent2-dim);border:1px solid var(--accent2);border-radius:8px;margin-bottom:16px;text-align:center;color:var(--accent2);font-weight:700;animation:pulse 1.5s infinite"><i class="bx bx-broadcast"></i> LIVE SCAN MODE — Each scan saves directly to Bin</div>';

    // ===== SCAN FORM WITH ALL SCAN BUTTONS =====
    html += '<div class="card" style="border:2px solid var(--accent2);margin-bottom:16px">';
    html += '<div class="card-title" style="color:var(--accent2)"><i class="bx bx-scan"></i> PIV Scan Entry</div>';
    html += '<div class="form-row">';

    // EAN with SCAN
    html += '<div class="form-group"><label>EAN / Barcode <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    html += '<input type="text" id="pivEanInput" class="form-input" placeholder="Scan or type EAN..." style="flex:1;min-width:180px" onkeydown="if(event.key===\'Enter\')doPivScan()">';
    html += '<button class="btn btn-primary btn-sm" onclick="doPivScan()"><i class="bx bx-plus"></i></button>';
    html += '<button class="btn btn-secondary btn-sm scan-btn" style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent)" onclick="doPivEanScan()"><i class="bx bx-camera"></i> Scan</button>';
    html += '</div></div>';

    // Material (auto)
    html += '<div class="form-group"><label>Material (Auto)</label><input type="text" id="pivMaterial" class="form-input" placeholder="Auto from master" style="background:var(--bg-secondary)"></div>';

    // Description (auto)
    html += '<div class="form-group"><label>Description (Auto)</label><input type="text" id="pivDesc" class="form-input" placeholder="Auto from master" style="background:var(--bg-secondary)"></div>';

    // RACK WITH SCAN
    html += '<div class="form-group"><label>Rack / Location</label>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    html += '<select id="pivRack" class="form-input" style="flex:1;min-width:150px"><option value="">-- Select Rack --</option>';
    var racks = DB.get('rack_master');
    for (var r = 0; r < racks.length; r++) {
        html += '<option value="' + escapeHtml(racks[r].rack) + '">' + escapeHtml(racks[r].rack) + '</option>';
    }
    html += '</select>';
    html += '<button class="btn btn-secondary btn-sm scan-btn" style="background:var(--accent2-dim);color:var(--accent2);border:1px solid var(--accent2)" onclick="doPivRackScan()"><i class="bx bx-qr"></i> Scan Rack</button>';
    html += '</div></div>';

    // Qty
    html += '<div class="form-group"><label>Qty</label><input type="number" id="pivQty" class="form-input" value="1" min="1" style="max-width:100px"></div>';

    // Packing
    html += '<div class="form-group"><label>Packing</label><select id="pivPacking" class="form-input"><option value="Bag">Bag</option><option value="Box">Box</option><option value="Carton">Carton</option><option value="Pallet">Pallet</option><option value="Bottle">Bottle</option><option value="Pouch">Pouch</option><option value="Loose">Loose</option></select></div>';

    // Box No
    html += '<div class="form-group"><label>Box No</label><input type="text" id="pivBoxNo" class="form-input" placeholder="e.g. B001"></div>';
    html += '</div>';

    html += '<div class="form-actions"><button class="btn btn-primary" onclick="doPivScan()"><i class="bx bx-plus-circle"></i> Add PIV Entry</button></div>';
    html += '</div>';

    // PIV items
    html += '<div class="card"><div class="card-title">PIV Entries (Session: <span id="pivSesCnt">' + pivLiveItems.length + '</span>)</div>';
    html += '<div id="pivItemsTbl"></div></div>';

    // Today's PIV
    var tPiv = DB.filter('location_master', function(l) { return l.action === 'PIV' && l.date === today(); });
    if (tPiv.length > 0) {
        html += '<div class="card" style="margin-top:16px"><div class="card-title">Today (' + tPiv.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Time</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>User</th></tr></thead><tbody>';
        for (var t = 0; t < tPiv.length; t++) {
            html += '<tr><td>' + (t+1) + '</td><td style="font-size:11px">' + formatDateTime(tPiv[t].dateTime) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(tPiv[t].ean) + '</td><td>' + escapeHtml(tPiv[t].material) + '</td><td><span class="badge badge-accent">' + escapeHtml(tPiv[t].rack) + '</span></td><td><strong>' + tPiv[t].quantity + '</strong></td><td>' + escapeHtml(tPiv[t].user) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    document.getElementById('section-piv').innerHTML = html;
    renderPivItems();
}

// PIV: EAN Scan button
function doPivEanScan() {
    openMyScanner(function(code) {
        var el = document.getElementById('pivEanInput');
        if (el) el.value = code;
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === code || matMaster[i].material.toUpperCase() === code.toUpperCase()) {
                var mEl = document.getElementById('pivMaterial');
                var dEl = document.getElementById('pivDesc');
                if (mEl) mEl.value = matMaster[i].material;
                if (dEl) dEl.value = matMaster[i].description;
                if (el) el.value = matMaster[i].ean || code;
                break;
            }
        }
        showToast('EAN Scanned: ' + code, 'success');
    });
}

// PIV: Rack Scan button
function doPivRackScan() {
    openMyScanner(function(code) {
        var sel = document.getElementById('pivRack');
        if (!sel) return;
        var rackCode = code.toUpperCase().trim();
        var found = false;
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value.toUpperCase() === rackCode || sel.options[i].value.toUpperCase().indexOf(rackCode) > -1) {
                sel.selectedIndex = i;
                found = true;
                break;
            }
        }
        if (found) {
            showToast('Rack Selected: ' + sel.value, 'success');
        } else {
            showToast('Rack "' + rackCode + '" not found. Select manually.', 'warning');
        }
    });
}

// PIV: Add item
function doPivScan() {
    var ean = document.getElementById('pivEanInput').value.trim();
    var rack = document.getElementById('pivRack').value || 'UNASSIGNED';
    var qty = parseInt(document.getElementById('pivQty').value) || 1;
    var packing = document.getElementById('pivPacking').value;
    var boxNo = document.getElementById('pivBoxNo').value.trim();
    var material = document.getElementById('pivMaterial').value.trim();
    var desc = document.getElementById('pivDesc').value.trim();

    if (!ean) { showToast('Scan or enter EAN', 'error'); return; }

    if (!material || !desc) {
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === ean || matMaster[i].material.toUpperCase() === ean.toUpperCase()) {
                material = material || matMaster[i].material;
                desc = desc || matMaster[i].description;
                ean = matMaster[i].ean || ean;
                break;
            }
        }
    }

    var item = {
        id: DB.uid(), date: today(), ean: ean, material: material || 'UNKNOWN',
        description: desc || '-', rack: rack, quantity: qty, packing: packing,
        box: boxNo || '-', action: 'PIV', user: APP.currentUser ? APP.currentUser.name : 'System',
        dateTime: new Date().toISOString()
    };

    if (pivLiveActive) {
        // LIVE: Save directly
        delete item.id;
        DB.add('location_master', item);
        logAction('PIV', 'LIVE_SCAN', 'Live: ' + item.material + ' qty=' + qty + ' at ' + rack);
        showToast('LIVE SAVED: ' + (material || ean), 'success');
    } else {
        // BUFFER: Add to session
        pivLiveItems.push(item);
        renderPivItems();
        showToast('Added: ' + (material || ean), 'success');
    }

    // Clear
    document.getElementById('pivEanInput').value = '';
    document.getElementById('pivMaterial').value = '';
    document.getElementById('pivDesc').value = '';
    document.getElementById('pivQty').value = '1';
    document.getElementById('pivBoxNo').value = '';
    document.getElementById('pivEanInput').focus();
}

function togglePivLive() {
    pivLiveActive = !pivLiveActive;
    var txt = document.getElementById('pivLiveTxt');
    var ind = document.getElementById('pivLiveInd');
    if (pivLiveActive) {
        if (txt) txt.textContent = 'Stop Live Scan';
        if (ind) ind.style.display = 'block';
        document.getElementById('pivEanInput').focus();
        showToast('LIVE MODE ON — Scans save directly!', 'warning');
    } else {
        if (txt) txt.textContent = 'Start Live Scan';
        if (ind) ind.style.display = 'none';
        showToast('Live scan stopped', 'info');
    }
}

function renderPivItems() {
    var c = document.getElementById('pivItemsTbl');
    var cnt = document.getElementById('pivSesCnt');
    if (cnt) cnt.textContent = pivLiveItems.length;
    if (!c) return;
    if (pivLiveItems.length === 0) { c.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">' + (pivLiveActive ? 'Live ON — just scan!' : 'No entries yet') + '</div>'; return; }
    var h = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>Box</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < pivLiveItems.length; i++) {
        var p = pivLiveItems[i];
        h += '<tr><td>' + (i+1) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(p.ean) + '</td><td>' + escapeHtml(p.material) + '</td><td><span class="badge badge-accent">' + escapeHtml(p.rack) + '</span></td><td><strong>' + p.quantity + '</strong></td><td>' + escapeHtml(p.packing) + '</td><td>' + escapeHtml(p.box) + '</td><td><button class="btn btn-danger btn-sm" onclick="pivLiveItems.splice(' + i + ',1);renderPivItems()"><i class="bx bx-trash"></i></button></td></tr>';
    }
    h += '</tbody></table></div>';
    c.innerHTML = h;
}

function savePivData() {
    if (pivLiveItems.length === 0) { showToast('No PIV entries!', 'error'); return; }
    for (var i = 0; i < pivLiveItems.length; i++) {
        var item = Object.assign({}, pivLiveItems[i]);
        delete item.id;
        DB.add('location_master', item);
    }
    var cnt = pivLiveItems.length;
    logAction('PIV', 'SAVE', 'Saved ' + cnt + ' PIV items');
    showToast(cnt + ' PIV items saved!', 'success');
    pivLiveItems = [];
    renderPIV();
}

function bulkUploadPIV(input) {
    if (!input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            var startRow = (String(data[0][0] || '').toLowerCase().indexOf('ean') > -1 || String(data[0][0] || '').toLowerCase().indexOf('date') > -1) ? 1 : 0;
            var count = 0;
            for (var k = startRow; k < data.length; k++) {
                var r = data[k]; if (!r || !r[1]) continue;
                DB.add('location_master', {
                    date: String(r[0] || today()), ean: String(r[1] || '').trim(),
                    material: String(r[2] || '').trim(), description: String(r[3] || '').trim(),
                    quantity: parseInt(r[4]) || 0, packing: String(r[5] || 'Bag').trim(),
                    box: String(r[6] || '-').trim(), rack: 'UNASSIGNED',
                    action: 'PIV', user: APP.currentUser ? APP.currentUser.name : 'System',
                    dateTime: new Date().toISOString()
                });
                count++;
            }
            logAction('PIV', 'BULK', 'Bulk ' + count + ' items');
            showToast('PIV Bulk: ' + count + ' items!', 'success');
            renderPIV();
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(input.files[0]);
    input.value = '';
}
/* ============================================================
   FIX: Rack=Scan+Manual only, Packing=Manual only, No Camera on Desktop
   ============================================================ */

// ==================== DETECT DESKTOP (No Camera) ====================
var IS_DESKTOP = false;
try {
    // Check if no camera available (desktop without webcam)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        IS_DESKTOP = true;
    }
    // Also check by screen size hint
    if (window.innerWidth > 1024 && !('ontouchstart' in window)) {
        IS_DESKTOP = true;
    }
} catch(e) {}

// Override scanner modal for desktop — NO camera button
function openMyScanner(callback) {
    _scannerCallback = callback;
    var modal = document.getElementById('scannerModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'scannerModal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'z-index:99999;display:none;';
        modal.innerHTML = '<div class="modal-container" style="max-width:400px"><div class="modal-header"><h3><i class="bx bx-qr-scan"></i> Scan Code</h3><button class="modal-close" onclick="closeMyScanner()"><i class="bx bx-x"></i></button></div><div class="modal-body" id="scannerModalBody" style="text-align:center;padding:16px"></div></div>';
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    var body = document.getElementById('scannerModalBody');
    if (body) {
        if (IS_DESKTOP) {
            // DESKTOP: Only Bluetooth/USB, NO camera
            body.innerHTML = '<div style="margin-bottom:16px"><i class="bx bx-desktop" style="font-size:48px;color:var(--text-muted);display:block;margin-bottom:10px"></i><p style="color:var(--text-muted);margin-bottom:16px">Desktop detected — Camera not available</p></div>' +
                '<button class="btn btn-primary" style="width:100%;padding:16px;font-size:15px" onclick="startMyBluetooth()"><i class="bx bx-bluetooth"></i> Start Bluetooth / USB Scanner</button>' +
                '<div style="margin-top:16px;background:var(--bg-secondary);padding:12px;border-radius:8px;font-size:12px;color:var(--text-muted)"><strong>Instructions:</strong><br>1. Click button above<br>2. Green bar appears at top<br>3. Scan barcode with your scanner<br>4. It auto-fills the field</div>';
        } else {
            // MOBILE/TABLET: Camera + Bluetooth both
            body.innerHTML = '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:16px">' +
                '<button class="btn btn-primary" style="padding:14px 24px;font-size:14px" onclick="startMyCamera()"><i class="bx bx-camera"></i> Camera Scan</button>' +
                '<button class="btn btn-secondary" style="padding:14px 24px;font-size:14px" onclick="startMyBluetooth()"><i class="bx bx-bluetooth"></i> Bluetooth/USB</button></div>' +
                '<div id="myQrReader" style="width:100%;border-radius:8px;overflow:hidden;background:#000;min-height:50px"></div>' +
                '<p style="color:var(--text-muted);margin-top:10px;font-size:12px">Camera open hone pe barcode ko saamne rakhna</p>';
        }
    }
}

function closeMyScanner() {
    var modal = document.getElementById('scannerModal');
    if (modal) modal.style.display = 'none';
    if (_scannerInstance) {
        try { _scannerInstance.stop(); } catch(e) {}
        _scannerInstance = null;
    }
}


// ==================== PUTAWAY — Rack=Scan+Manual, Packing=Manual ====================
function renderPutaway() {
    var html = '<div class="section-header"><h2><i class="bx bxs-package"></i> Putaway</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="clearPutawayBuffer()"><i class="bx bx-plus"></i> New</button>';
    html += '<button class="btn btn-success btn-sm" onclick="savePutawayBuffer()"><i class="bx bx-save"></i> Save All</button>';
    html += '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadPutaway(this)"></label>';
    html += '</div></div>';

    // Mode toggle
    html += '<div class="card" style="margin-bottom:16px"><div class="form-group">';
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap">';
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid var(--accent);border-radius:8px;background:var(--accent-dim);font-weight:600;color:var(--accent)"><input type="radio" name="putMode" value="without" checked style="accent-color:var(--accent);width:16px;height:16px"> WITHOUT Invoice</label>';
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid var(--border);border-radius:8px;font-weight:600;color:var(--text-secondary)"><input type="radio" name="putMode" value="with" style="accent-color:var(--info);width:16px;height:16px"> WITH Invoice</label>';
    html += '</div></div>';
    html += '<div id="putInvSel" style="display:none;margin-top:12px"><select id="putawayInvoiceSelect" class="form-input" onchange="loadPutawayInvoiceMaterials()"><option value="">-- Select Invoice --</option>';
    var pInvs = DB.filter('invoices', function(inv) { return inv.status === 'Posted'; });
    for (var i = 0; i < pInvs.length; i++) {
        var pv = DB.find('vehicles', pInvs[i].vehicleId);
        html += '<option value="' + pInvs[i].id + '">' + escapeHtml(pInvs[i].invoiceNo) + ' — ' + escapeHtml(pv ? pv.vehicleNo : '') + '</option>';
    }
    html += '</select><div id="putawayInvoiceMaterials" style="margin-top:8px"></div></div></div>';

    // ===== SCAN FORM =====
    html += '<div class="card" style="border:2px solid var(--accent);margin-bottom:16px">';
    html += '<div class="card-title" style="color:var(--accent)"><i class="bx bx-scan"></i> Scan & Putaway</div>';
    html += '<div class="form-row">';

    // EAN with SCAN
    html += '<div class="form-group"><label>EAN / Barcode <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    html += '<input type="text" id="putEanInput" class="form-input" placeholder="Scan or type EAN..." style="flex:1;min-width:180px" onkeydown="if(event.key===\'Enter\')doPutawayScan()">';
    html += '<button class="btn btn-primary btn-sm" onclick="doPutawayScan()"><i class="bx bx-plus"></i></button>';
    html += '<button class="btn btn-secondary btn-sm scan-btn" style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent)" onclick="doPutawayEanScan()"><i class="bx bx-qr"></i> Scan</button>';
    html += '</div></div>';

    // Material (auto)
    html += '<div class="form-group"><label>Material (Auto)</label><input type="text" id="putMaterial" class="form-input" placeholder="Auto from master" style="background:var(--bg-secondary)"></div>';

    // Description (auto)
    html += '<div class="form-group"><label>Description (Auto)</label><input type="text" id="putDesc" class="form-input" placeholder="Auto from master" style="background:var(--bg-secondary)"></div>';

    // RACK — ONLY Scan Button + Manual Text Input, NO DROPDOWN
    html += '<div class="form-group"><label>Rack / Location <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    html += '<input type="text" id="putRackInput" class="form-input" placeholder="Type rack name or scan..." style="flex:1;min-width:150px;text-transform:uppercase" onkeydown="if(event.key===\'Enter\')doPutawayScan()">';
    html += '<button class="btn btn-secondary btn-sm scan-btn" style="background:var(--accent2-dim);color:var(--accent2);border:1px solid var(--accent2);white-space:nowrap" onclick="doPutawayRackScan()"><i class="bx bx-qr"></i> Scan Rack</button>';
    html += '</div></div>';

    // Qty
    html += '<div class="form-group"><label>Qty <span class="req">*</span></label><input type="number" id="putQty" class="form-input" value="1" min="1" style="max-width:100px"></div>';

    // PACKING — ONLY Manual Text Input, NO DROPDOWN
    html += '<div class="form-group"><label>Packing</label>';
    html += '<input type="text" id="putPackingInput" class="form-input" placeholder="Type: Bag, Box, Carton, Pallet, Bottle...">';
    html += '</div>';

    // Box No
    html += '<div class="form-group"><label>Box No</label><input type="text" id="putBoxNo" class="form-input" placeholder="e.g. B001"></div>';
    html += '</div>';

    html += '<div class="form-actions"><button class="btn btn-primary" onclick="doPutawayScan()"><i class="bx bx-plus-circle"></i> Add to Buffer</button></div>';
    html += '</div>';

    // Buffer
    html += '<div class="card"><div class="card-title">Putaway Buffer (<span id="putBufCnt">' + putawayBuffer.length + '</span>)</div>';
    html += '<div id="putBufTable"></div>';
    if (putawayBuffer.length > 0) {
        html += '<div class="form-actions" style="margin-top:12px"><button class="btn btn-success" onclick="savePutawayBuffer()"><i class="bx bx-save"></i> Save All to Bin</button><button class="btn btn-danger" onclick="clearPutawayBuffer()"><i class="bx bx-trash"></i> Clear</button></div>';
    }
    html += '</div>';

    // Today's putaway
    var tPut = DB.filter('location_master', function(l) { return l.action === 'PUTAWAY' && l.date === today(); });
    if (tPut.length > 0) {
        html += '<div class="card" style="margin-top:16px"><div class="card-title">Today (' + tPut.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Time</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>User</th></tr></thead><tbody>';
        for (var t = 0; t < tPut.length; t++) {
            html += '<tr><td>' + (t+1) + '</td><td style="font-size:11px">' + formatDateTime(tPut[t].dateTime) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(tPut[t].ean) + '</td><td>' + escapeHtml(tPut[t].material) + '</td><td><span class="badge badge-accent">' + escapeHtml(tPut[t].rack) + '</span></td><td><strong>' + tPut[t].quantity + '</strong></td><td>' + escapeHtml(tPut[t].packing) + '</td><td>' + escapeHtml(tPut[t].user) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    document.getElementById('section-putaway').innerHTML = html;

    // Bind mode toggle
    var modeRadios = document.querySelectorAll('input[name="putMode"]');
    for (var mr = 0; mr < modeRadios.length; mr++) {
        modeRadios[mr].addEventListener('change', function() {
            var sel = document.getElementById('putInvSel');
            if (sel) sel.style.display = this.value === 'with' ? 'block' : 'none';
        });
    }
    renderPutawayBuffer();
}

// PUTAWAY: EAN Scan
function doPutawayEanScan() {
    openMyScanner(function(code) {
        var el = document.getElementById('putEanInput');
        if (el) el.value = code;
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === code || matMaster[i].material.toUpperCase() === code.toUpperCase()) {
                var mEl = document.getElementById('putMaterial');
                var dEl = document.getElementById('putDesc');
                if (mEl) mEl.value = matMaster[i].material;
                if (dEl) dEl.value = matMaster[i].description;
                if (el) el.value = matMaster[i].ean || code;
                break;
            }
        }
        showToast('EAN Scanned: ' + code, 'success');
    });
}

// PUTAWAY: Rack Scan
function doPutawayRackScan() {
    openMyScanner(function(code) {
        var el = document.getElementById('putRackInput');
        if (el) el.value = code.toUpperCase();
        showToast('Rack Scanned: ' + code.toUpperCase(), 'success');
    });
}

// PUTAWAY: Add item
function doPutawayScan() {
    var ean = document.getElementById('putEanInput').value.trim();
    var rack = document.getElementById('putRackInput').value.trim().toUpperCase();
    var qty = parseInt(document.getElementById('putQty').value) || 0;
    var packing = document.getElementById('putPackingInput').value.trim() || 'Bag';
    var boxNo = document.getElementById('putBoxNo').value.trim();
    var material = document.getElementById('putMaterial').value.trim();
    var desc = document.getElementById('putDesc').value.trim();

    if (!ean) { showToast('Scan or enter EAN first', 'error'); return; }
    if (!rack) { showToast('Type or scan rack name', 'error'); return; }
    if (qty <= 0) { showToast('Enter valid qty', 'error'); return; }

    // Auto-fill material if empty
    if (!material || !desc) {
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === ean || matMaster[i].material.toUpperCase() === ean.toUpperCase()) {
                material = material || matMaster[i].material;
                desc = desc || matMaster[i].description;
                ean = matMaster[i].ean || ean;
                break;
            }
        }
    }

    // Invoice check
    var invId = '', invNo = '';
    var modeRadio = document.querySelector('input[name="putMode"]:checked');
    if (modeRadio && modeRadio.value === 'with') {
        var selInv = document.getElementById('putawayInvoiceSelect');
        if (selInv && selInv.value) {
            invId = selInv.value;
            var inv = DB.find('invoices', invId);
            invNo = inv ? inv.invoiceNo : '';
        }
    }

    putawayBuffer.push({
        id: DB.uid(), date: today(), ean: ean, material: material || 'UNKNOWN',
        description: desc || '-', rack: rack, quantity: qty, packing: packing,
        box: boxNo || '-', action: 'PUTAWAY', user: APP.currentUser ? APP.currentUser.name : 'System',
        invoiceId: invId, invoiceNo: invNo, dateTime: new Date().toISOString()
    });

    // Clear inputs
    document.getElementById('putEanInput').value = '';
    document.getElementById('putMaterial').value = '';
    document.getElementById('putDesc').value = '';
    document.getElementById('putRackInput').value = '';
    document.getElementById('putQty').value = '1';
    document.getElementById('putPackingInput').value = '';
    document.getElementById('putBoxNo').value = '';
    document.getElementById('putEanInput').focus();

    renderPutawayBuffer();
    showToast('Added: ' + (material || ean) + ' → ' + rack, 'success');
}

function renderPutawayBuffer() {
    var c = document.getElementById('putBufTable');
    var cnt = document.getElementById('putBufCnt');
    if (cnt) cnt.textContent = putawayBuffer.length;
    if (!c) return;
    if (putawayBuffer.length === 0) { c.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">Buffer empty — scan items above</div>'; return; }
    var h = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>Box</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < putawayBuffer.length; i++) {
        var p = putawayBuffer[i];
        h += '<tr><td>' + (i+1) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(p.ean) + '</td><td>' + escapeHtml(p.material) + '</td><td><span class="badge badge-accent">' + escapeHtml(p.rack) + '</span></td><td><strong>' + p.quantity + '</strong></td><td>' + escapeHtml(p.packing) + '</td><td>' + escapeHtml(p.box) + '</td><td><button class="btn btn-danger btn-sm" onclick="putawayBuffer.splice(' + i + ',1);renderPutawayBuffer()"><i class="bx bx-trash"></i></button></td></tr>';
    }
    h += '</tbody></table></div>';
    c.innerHTML = h;
}

function clearPutawayBuffer() {
    if (putawayBuffer.length > 0 && !confirm('Clear ' + putawayBuffer.length + ' items?')) return;
    putawayBuffer = [];
    renderPutaway();
}

function savePutawayBuffer() {
    if (putawayBuffer.length === 0) { showToast('Buffer empty!', 'error'); return; }
    for (var i = 0; i < putawayBuffer.length; i++) {
        var item = Object.assign({}, putawayBuffer[i]);
        delete item.id;
        DB.add('location_master', item);
    }
    var cnt = putawayBuffer.length;
    logAction('Putaway', 'SAVE', 'Saved ' + cnt + ' items to bin');
    showToast(cnt + ' items saved to Bin Master!', 'success');
    putawayBuffer = [];
    renderPutaway();
    addNotification(cnt + ' putaway items by ' + (APP.currentUser ? APP.currentUser.name : ''), 'success');
}


// ==================== PIV — Rack=Scan+Manual, Packing=Manual ====================
function renderPIV() {
    var html = '<div class="section-header"><h2><i class="bx bxs-clipboard"></i> PIV (Physical Inventory Verification)</h2>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="togglePivLive()"><i class="bx bx-play"></i> <span id="pivLiveTxt">Start Live Scan</span></button>';
    html += '<button class="btn btn-success btn-sm" onclick="savePivData()"><i class="bx bx-save"></i> Save to Bin</button>';
    html += '<label class="btn btn-warning btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Bulk Upload<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="bulkUploadPIV(this)"></label>';
    html += '</div></div>';

    // Live indicator
    html += '<div id="pivLiveInd" style="display:none;padding:10px;background:var(--accent2-dim);border:1px solid var(--accent2);border-radius:8px;margin-bottom:16px;text-align:center;color:var(--accent2);font-weight:700;animation:pulse 1.5s infinite"><i class="bx bx-broadcast"></i> LIVE SCAN MODE — Each scan saves directly to Bin</div>';

    // ===== SCAN FORM =====
    html += '<div class="card" style="border:2px solid var(--accent2);margin-bottom:16px">';
    html += '<div class="card-title" style="color:var(--accent2)"><i class="bx bx-scan"></i> PIV Scan Entry</div>';
    html += '<div class="form-row">';

    // EAN with SCAN
    html += '<div class="form-group"><label>EAN / Barcode <span class="req">*</span></label>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    html += '<input type="text" id="pivEanInput" class="form-input" placeholder="Scan or type EAN..." style="flex:1;min-width:180px" onkeydown="if(event.key===\'Enter\')doPivScan()">';
    html += '<button class="btn btn-primary btn-sm" onclick="doPivScan()"><i class="bx bx-plus"></i></button>';
    html += '<button class="btn btn-secondary btn-sm scan-btn" style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent)" onclick="doPivEanScan()"><i class="bx bx-qr"></i> Scan</button>';
    html += '</div></div>';

    // Material (auto)
    html += '<div class="form-group"><label>Material (Auto)</label><input type="text" id="pivMaterial" class="form-input" placeholder="Auto from master" style="background:var(--bg-secondary)"></div>';

    // Description (auto)
    html += '<div class="form-group"><label>Description (Auto)</label><input type="text" id="pivDesc" class="form-input" placeholder="Auto from master" style="background:var(--bg-secondary)"></div>';

    // RACK — ONLY Scan Button + Manual Text Input, NO DROPDOWN
    html += '<div class="form-group"><label>Rack / Location</label>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    html += '<input type="text" id="pivRackInput" class="form-input" placeholder="Type rack name or scan..." style="flex:1;min-width:150px;text-transform:uppercase" onkeydown="if(event.key===\'Enter\')doPivScan()">';
    html += '<button class="btn btn-secondary btn-sm scan-btn" style="background:var(--accent2-dim);color:var(--accent2);border:1px solid var(--accent2);white-space:nowrap" onclick="doPivRackScan()"><i class="bx bx-qr"></i> Scan Rack</button>';
    html += '</div></div>';

    // Qty
    html += '<div class="form-group"><label>Qty</label><input type="number" id="pivQty" class="form-input" value="1" min="1" style="max-width:100px"></div>';

    // PACKING — ONLY Manual Text Input, NO DROPDOWN
    html += '<div class="form-group"><label>Packing</label>';
    html += '<input type="text" id="pivPackingInput" class="form-input" placeholder="Type: Bag, Box, Carton, Pallet, Bottle...">';
    html += '</div>';

    // Box No
    html += '<div class="form-group"><label>Box No</label><input type="text" id="pivBoxNo" class="form-input" placeholder="e.g. B001"></div>';
    html += '</div>';

    html += '<div class="form-actions"><button class="btn btn-primary" onclick="doPivScan()"><i class="bx bx-plus-circle"></i> Add PIV Entry</button></div>';
    html += '</div>';

    // PIV items
    html += '<div class="card"><div class="card-title">PIV Entries (Session: <span id="pivSesCnt">' + pivLiveItems.length + '</span>)</div>';
    html += '<div id="pivItemsTbl"></div></div>';

    // Today's PIV
    var tPiv = DB.filter('location_master', function(l) { return l.action === 'PIV' && l.date === today(); });
    if (tPiv.length > 0) {
        html += '<div class="card" style="margin-top:16px"><div class="card-title">Today (' + tPiv.length + ')</div>';
        html += '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Time</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>User</th></tr></thead><tbody>';
        for (var t = 0; t < tPiv.length; t++) {
            html += '<tr><td>' + (t+1) + '</td><td style="font-size:11px">' + formatDateTime(tPiv[t].dateTime) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(tPiv[t].ean) + '</td><td>' + escapeHtml(tPiv[t].material) + '</td><td><span class="badge badge-accent">' + escapeHtml(tPiv[t].rack) + '</span></td><td><strong>' + tPiv[t].quantity + '</strong></td><td>' + escapeHtml(tPiv[t].packing) + '</td><td>' + escapeHtml(tPiv[t].user) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
    }

    document.getElementById('section-piv').innerHTML = html;
    renderPivItems();
}

// PIV: EAN Scan
function doPivEanScan() {
    openMyScanner(function(code) {
        var el = document.getElementById('pivEanInput');
        if (el) el.value = code;
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === code || matMaster[i].material.toUpperCase() === code.toUpperCase()) {
                var mEl = document.getElementById('pivMaterial');
                var dEl = document.getElementById('pivDesc');
                if (mEl) mEl.value = matMaster[i].material;
                if (dEl) dEl.value = matMaster[i].description;
                if (el) el.value = matMaster[i].ean || code;
                break;
            }
        }
        showToast('EAN Scanned: ' + code, 'success');
    });
}

// PIV: Rack Scan
function doPivRackScan() {
    openMyScanner(function(code) {
        var el = document.getElementById('pivRackInput');
        if (el) el.value = code.toUpperCase();
        showToast('Rack Scanned: ' + code.toUpperCase(), 'success');
    });
}

// PIV: Add item
function doPivScan() {
    var ean = document.getElementById('pivEanInput').value.trim();
    var rack = document.getElementById('pivRackInput').value.trim().toUpperCase() || 'UNASSIGNED';
    var qty = parseInt(document.getElementById('pivQty').value) || 1;
    var packing = document.getElementById('pivPackingInput').value.trim() || 'Bag';
    var boxNo = document.getElementById('pivBoxNo').value.trim();
    var material = document.getElementById('pivMaterial').value.trim();
    var desc = document.getElementById('pivDesc').value.trim();

    if (!ean) { showToast('Scan or enter EAN', 'error'); return; }

    if (!material || !desc) {
        var matMaster = DB.get('material_master');
        for (var i = 0; i < matMaster.length; i++) {
            if (matMaster[i].ean === ean || matMaster[i].material.toUpperCase() === ean.toUpperCase()) {
                material = material || matMaster[i].material;
                desc = desc || matMaster[i].description;
                ean = matMaster[i].ean || ean;
                break;
            }
        }
    }

    var item = {
        id: DB.uid(), date: today(), ean: ean, material: material || 'UNKNOWN',
        description: desc || '-', rack: rack, quantity: qty, packing: packing,
        box: boxNo || '-', action: 'PIV', user: APP.currentUser ? APP.currentUser.name : 'System',
        dateTime: new Date().toISOString()
    };

    if (pivLiveActive) {
        delete item.id;
        DB.add('location_master', item);
        logAction('PIV', 'LIVE_SCAN', 'Live: ' + item.material + ' qty=' + qty + ' at ' + rack);
        showToast('LIVE SAVED: ' + (material || ean), 'success');
    } else {
        pivLiveItems.push(item);
        renderPivItems();
        showToast('Added: ' + (material || ean), 'success');
    }

    // Clear
    document.getElementById('pivEanInput').value = '';
    document.getElementById('pivMaterial').value = '';
    document.getElementById('pivDesc').value = '';
    document.getElementById('pivRackInput').value = '';
    document.getElementById('pivQty').value = '1';
    document.getElementById('pivPackingInput').value = '';
    document.getElementById('pivBoxNo').value = '';
    document.getElementById('pivEanInput').focus();
}

function togglePivLive() {
    pivLiveActive = !pivLiveActive;
    var txt = document.getElementById('pivLiveTxt');
    var ind = document.getElementById('pivLiveInd');
    if (pivLiveActive) {
        if (txt) txt.textContent = 'Stop Live Scan';
        if (ind) ind.style.display = 'block';
        document.getElementById('pivEanInput').focus();
        showToast('LIVE MODE ON!', 'warning');
    } else {
        if (txt) txt.textContent = 'Start Live Scan';
        if (ind) ind.style.display = 'none';
        showToast('Live scan stopped', 'info');
    }
}

function renderPivItems() {
    var c = document.getElementById('pivItemsTbl');
    var cnt = document.getElementById('pivSesCnt');
    if (cnt) cnt.textContent = pivLiveItems.length;
    if (!c) return;
    if (pivLiveItems.length === 0) { c.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">' + (pivLiveActive ? 'Live ON — just scan!' : 'No entries yet') + '</div>'; return; }
    var h = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Rack</th><th>Qty</th><th>Packing</th><th>Box</th><th>Action</th></tr></thead><tbody>';
    for (var i = 0; i < pivLiveItems.length; i++) {
        var p = pivLiveItems[i];
        h += '<tr><td>' + (i+1) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(p.ean) + '</td><td>' + escapeHtml(p.material) + '</td><td><span class="badge badge-accent">' + escapeHtml(p.rack) + '</span></td><td><strong>' + p.quantity + '</strong></td><td>' + escapeHtml(p.packing) + '</td><td>' + escapeHtml(p.box) + '</td><td><button class="btn btn-danger btn-sm" onclick="pivLiveItems.splice(' + i + ',1);renderPivItems()"><i class="bx bx-trash"></i></button></td></tr>';
    }
    h += '</tbody></table></div>';
    c.innerHTML = h;
}

function savePivData() {
    if (pivLiveItems.length === 0) { showToast('No PIV entries!', 'error'); return; }
    for (var i = 0; i < pivLiveItems.length; i++) {
        var item = Object.assign({}, pivLiveItems[i]);
        delete item.id;
        DB.add('location_master', item);
    }
    var cnt = pivLiveItems.length;
    logAction('PIV', 'SAVE', 'Saved ' + cnt + ' PIV items');
    showToast(cnt + ' PIV items saved!', 'success');
    pivLiveItems = [];
    renderPIV();
}

function bulkUploadPIV(input) {
    if (!input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            var startRow = (String(data[0][0] || '').toLowerCase().indexOf('ean') > -1 || String(data[0][0] || '').toLowerCase().indexOf('date') > -1) ? 1 : 0;
            var count = 0;
            for (var k = startRow; k < data.length; k++) {
                var r = data[k]; if (!r || !r[1]) continue;
                DB.add('location_master', {
                    date: String(r[0] || today()), ean: String(r[1] || '').trim(),
                    material: String(r[2] || '').trim(), description: String(r[3] || '').trim(),
                    quantity: parseInt(r[4]) || 0, packing: String(r[5] || 'Bag').trim(),
                    box: String(r[6] || '-').trim(), rack: 'UNASSIGNED',
                    action: 'PIV', user: APP.currentUser ? APP.currentUser.name : 'System',
                    dateTime: new Date().toISOString()
                });
                count++;
            }
            logAction('PIV', 'BULK', 'Bulk ' + count + ' items');
            showToast('PIV Bulk: ' + count + ' items!', 'success');
            renderPIV();
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(input.files[0]);
    input.value = '';
}

// Also fix loadPutawayInvoiceMaterials
function loadPutawayInvoiceMaterials() {
    var invId = document.getElementById('putawayInvoiceSelect').value;
    var container = document.getElementById('putawayInvoiceMaterials');
    if (!invId) { if (container) container.innerHTML = ''; return; }
    var mats = DB.filter('invoice_materials', function(m) { return m.invoiceId === invId; });
    if (mats.length === 0) { container.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:12px">No materials in this invoice</div>'; return; }
    var html = '<div class="table-wrapper" style="margin-top:8px"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Inv Qty</th><th>Unloaded</th><th>Remaining</th></tr></thead><tbody>';
    for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        var putDone = 0;
        var allLoc = DB.get('location_master');
        for (var j = 0; j < allLoc.length; j++) {
            if (allLoc[j].invoiceId === invId && allLoc[j].material === m.material && allLoc[j].action === 'PUTAWAY') {
                putDone += allLoc[j].quantity;
            }
        }
        var remaining = (m.unloadedQty || 0) - putDone;
        html += '<tr><td>' + escapeHtml(m.material) + '</td><td style="font-family:var(--font-display);font-size:11px">' + escapeHtml(m.ean || '-') + '</td>';
        html += '<td>' + m.qty + '</td><td>' + (m.unloadedQty || 0) + '</td>';
        html += '<td class="' + (remaining > 0 ? 'qty-match' : 'qty-mismatch') + '">' + remaining + '</td></tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
}
// ============================================================
// NUCLEAR FIX — Location Master Bulk Upload
// Paste at END of script.js
// ============================================================

(function(){
    'use strict';

    // --- Override renderLocationMaster ---
    var _origRenderLoc = (typeof renderLocationMaster === 'function') ? renderLocationMaster : null;

    window.renderLocationMaster = function() {
        var locations = DB.get('location_master');
        var search = (document.getElementById('locSearchInput') || {}).value || '';
        search = String(search).trim().toLowerCase();
        var filterRack = (document.getElementById('locRackFilter') || {}).value || '';
        var filterAction = (document.getElementById('locActionFilter') || {}).value || '';

        var filtered = locations;
        if (search) {
            filtered = filtered.filter(function(l) {
                return String(l.rack||'').toLowerCase().indexOf(search) > -1 ||
                    String(l.material||'').toLowerCase().indexOf(search) > -1 ||
                    String(l.ean||'').toLowerCase().indexOf(search) > -1 ||
                    String(l.description||'').toLowerCase().indexOf(search) > -1 ||
                    String(l.quantity||'').indexOf(search) > -1;
            });
        }
        if (filterRack) filtered = filtered.filter(function(l){ return l.rack === filterRack; });
        if (filterAction) filtered = filtered.filter(function(l){ return l.action === filterAction; });

        filtered.sort(function(a,b){ return new Date(b.createdAt||b.dateTime||0) - new Date(a.createdAt||a.dateTime||0); });

        var pg = paginate(filtered, APP.locPage, APP.locPerPage);
        var racks = DB.get('rack_master');
        var rackOpts = '<option value="">All Racks</option>';
        for(var r=0;r<racks.length;r++){
            rackOpts += '<option value="'+escapeHtml(racks[r].rack)+'"'+(filterRack===racks[r].rack?' selected':'')+'>'+escapeHtml(racks[r].rack)+'</option>';
        }

        var totalQty = 0;
        for(var tq=0;tq<locations.length;tq++) totalQty += (Number(locations[tq].quantity) || 0);

        var html = '<div class="section-header"><h2><i class="bx bxs-map-pin"></i> Location Master</h2>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
        html += '<button class="btn btn-primary" onclick="showAddLocationForm()"><i class="bx bx-plus"></i> Add Location</button>';
        html += '<button class="btn btn-warning" onclick="window._bulkLocUploadNEW()"><i class="bx bx-upload"></i> Bulk Upload</button>';
        html += '<button class="btn btn-secondary" onclick="exportLocationMaster()"><i class="bx bx-download"></i> Export Excel</button>';
        html += '</div></div>';

        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px">';
        html += '<div class="kpi-card"><div class="kpi-value">'+locations.length+'</div><div class="kpi-label">Total Records</div></div>';
        html += '<div class="kpi-card"><div class="kpi-value" style="color:var(--accent)">'+totalQty+'</div><div class="kpi-label">Total Qty in Warehouse</div></div>';
        html += '<div class="kpi-card"><div class="kpi-value">'+filtered.length+'</div><div class="kpi-label">Filtered</div></div>';
        html += '</div>';

        html += '<div class="card" style="margin-bottom:16px"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">';
        html += '<div class="form-group" style="flex:1;min-width:200px"><label>Search</label><input type="text" id="locSearchInput" class="form-input" placeholder="Rack, Material, EAN..." value="'+escapeHtml(search)+'" oninput="APP.locPage=1;renderLocationMaster()"></div>';
        html += '<div class="form-group" style="min-width:160px"><label>Rack</label><select id="locRackFilter" class="form-input" onchange="APP.locPage=1;renderLocationMaster()">'+rackOpts+'</select></div>';
        html += '<div class="form-group" style="min-width:130px"><label>Action</label><select id="locActionFilter" class="form-input" onchange="APP.locPage=1;renderLocationMaster()"><option value="">All</option><option value="PUTAWAY"'+(filterAction==='PUTAWAY'?' selected':'')+'>PUTAWAY</option><option value="PIV"'+(filterAction==='PIV'?' selected':'')+'>PIV</option></select></div>';
        html += '<button class="btn btn-sm btn-secondary" onclick="APP.locPage=1;document.getElementById(\'locSearchInput\').value=\'\';document.getElementById(\'locRackFilter\').value=\'\';document.getElementById(\'locActionFilter\').value=\'\';renderLocationMaster()"><i class="bx bx-refresh"></i> Clear</button>';
        html += '</div></div>';

        html += '<div class="card"><div class="card-title">Records ('+pg.total+')</div><div class="table-wrapper"><table class="data-table"><thead><tr>';
        html += '<th>#</th><th>Date</th><th>Rack</th><th>EAN</th><th>Material</th><th>Description</th><th style="color:var(--accent);font-size:13px">QTY</th><th>Packing</th><th>Box</th><th>Action</th><th>User</th><th>Actions</th>';
        html += '</tr></thead><tbody>';

        if(pg.items.length === 0){
            html += '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:40px"><i class="bx bx-inbox" style="font-size:32px;display:block;margin-bottom:8px"></i>No records</td></tr>';
        } else {
            for(var i=0;i<pg.items.length;i++){
                var l = pg.items[i];
                var rowNum = (APP.locPage-1)*APP.locPerPage + i + 1;
                var qv = Number(l.quantity) || 0;
                html += '<tr>';
                html += '<td>'+rowNum+'</td>';
                html += '<td style="font-size:12px">'+escapeHtml(l.date||'-')+'</td>';
                html += '<td><strong style="color:var(--accent)">'+escapeHtml(l.rack||'-')+'</strong></td>';
                html += '<td style="font-family:var(--font-display);font-size:11px">'+escapeHtml(l.ean||'-')+'</td>';
                html += '<td>'+escapeHtml(l.material||'-')+'</td>';
                html += '<td style="font-size:12px;color:var(--text-secondary)">'+escapeHtml(l.description||'-')+'</td>';
                html += '<td style="font-size:18px;font-weight:900;color:'+(qv>0?'var(--accent)':'var(--danger)')+'">'+qv+'</td>';
                html += '<td>'+escapeHtml(l.packing||'-')+'</td>';
                html += '<td>'+escapeHtml(l.box||'-')+'</td>';
                html += '<td><span class="badge badge-'+(l.action==='PUTAWAY'?'success':'info')+'">'+escapeHtml(l.action||'-')+'</span></td>';
                html += '<td style="font-size:12px;color:var(--text-muted)">'+escapeHtml(l.user||'-')+'</td>';
                html += '<td><div class="table-actions">';
                html += '<button class="btn-icon" title="Edit" onclick="showEditLocation(\''+l.id+'\')"><i class="bx bx-edit"></i></button>';
                html += '<button class="btn-icon danger" title="Delete" onclick="deleteLocation(\''+l.id+'\')"><i class="bx bx-trash"></i></button>';
                html += '</div></td></tr>';
            }
        }
        html += '</tbody></table></div>';
        html += renderPagination(APP.locPage, pg.pages, 'goLocPage');
        html += '</div>';

        var sec = document.getElementById('section-location');
        if(sec) sec.innerHTML = html;
    };

    // --- Override goLocPage ---
    window.goLocPage = function(p){
        if(p<1) return;
        APP.locPage = p;
        renderLocationMaster();
    };

    // --- NEW BULK UPLOAD (completely independent) ---
    var _parsedRows = [];

    window._bulkLocUploadNEW = function() {
        _parsedRows = [];
        var html = '';
        html += '<div class="form-group"><label>Choose Excel File</label>';
        html += '<label class="btn btn-warning" style="cursor:pointer;display:inline-flex"><i class="bx bx-upload"></i> Select File (.xlsx/.xls/.csv)';
        html += '<input type="file" id="_blFileInput" accept=".xlsx,.xls,.csv" style="display:none"></label>';
        html += ' <span id="_blFileName" style="font-size:12px;color:var(--text-muted)">No file</span></div>';

        html += '<div style="background:var(--warning-dim);border:1px dashed var(--warning);padding:12px;border-radius:8px;font-size:12px;color:var(--warning);margin:12px 0">';
        html += '<strong>Required Columns (Header Row):</strong><br>';
        html += '<code style="display:block;margin-top:6px;padding:6px 10px;background:var(--bg-input);border-radius:4px;color:var(--accent);font-size:11px">Date | Rack | EAN | Material | Description | Quantity | Packing | Box | Action</code>';
        html += '<br>Minimum required: <strong>Rack</strong> + <strong>Quantity</strong>';
        html += '</div>';

        html += '<div id="_blStep2" style="display:none">';
        html += '<button class="btn btn-secondary btn-sm" onclick="window._blParseFile()" style="margin-bottom:12px"><i class="bx bx-search"></i> Step 1: Parse & Preview</button>';
        html += '</div>';

        html += '<div id="_blPreview"></div>';

        html += '<div id="_blManualCol" style="display:none;margin-top:12px;padding:12px;background:var(--danger-dim);border:1px solid var(--danger);border-radius:8px">';
        html += '<strong style="color:var(--danger)"><i class="bx bx-error"></i> Auto-detect failed! Manually select column numbers:</strong>';
        html += '<div class="form-row" style="margin-top:8px">';
        html += '<div class="form-group"><label>Rack Column #</label><input type="number" id="_blMRack" class="form-input" min="0" placeholder="0,1,2..."></div>';
        html += '<div class="form-group"><label>Material Column #</label><input type="number" id="_blMMat" class="form-input" min="0" placeholder="0,1,2..."></div>';
        html += '<div class="form-group"><label>Quantity Column #</label><input type="number" id="_blMQty" class="form-input" min="0" placeholder="0,1,2..." style="border-color:var(--danger)"></div>';
        html += '</div>';
        html += '<button class="btn btn-danger btn-sm" onclick="window._blParseManual()"><i class="bx bx-check"></i> Parse with Manual Columns</button>';
        html += '</div>';

        showModal('<i class="bx bx-upload"></i> Bulk Upload — Location Master', html, 'lg',
            '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
            '<button id="_blSaveBtn" class="btn btn-primary" disabled onclick="window._blSaveAll()"><i class="bx bx-check-double"></i> Confirm & Save All</button>'
        );

        // Bind file input
        setTimeout(function(){
            var fi = document.getElementById('_blFileInput');
            if(fi) fi.addEventListener('change', function(){
                var fn = document.getElementById('_blFileName');
                if(fn && this.files[0]) fn.innerText = this.files[0].name;
                document.getElementById('_blStep2').style.display = 'block';
            });
        }, 100);
    };

    // --- Parse file ---
    window._blParseFile = function() {
        var fi = document.getElementById('_blFileInput');
        if(!fi || !fi.files[0]){ showToast('Select file first','error'); return; }

        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var wb = XLSX.read(e.target.result, {type:'array'});
                var ws = wb.Sheets[wb.SheetNames[0]];
                var raw = XLSX.utils.sheet_to_json(ws, {header:1});

                console.log('=== RAW EXCEL DATA ===');
                console.log('Total rows (including header):', raw.length);
                console.log('Header:', raw[0]);
                if(raw.length > 1) console.log('Row 1 (first data):', raw[1]);
                if(raw.length > 2) console.log('Row 2:', raw[2]);

                if(raw.length < 2){ showToast('File is empty (only header, no data)','error'); return; }

                // Dynamic column mapping
                var hdr = raw[0].map(function(h){ return String(h||'').trim().toLowerCase().replace(/[^a-z0-9]/g,''); });
                console.log('Normalized headers:', hdr);

                var colMap = {};
                                var mapDef = {
                    date:      ['date','dt'],
                    rack:      ['rack','rackno','racknumber','location','loc'],
                    ean:       ['ean','eancode','barcode','scancode','barcodescan'],
                    material:  ['material','materialcode','materialname','matcode','item','itemcode','product','productcode','itemname','productname','sku','skucode'],
                    description:['description','desc','materialdesc','itemdesc','productdesc','itemdescription'],
                    quantity:  ['quantity','qty','quant','units','stock','balance','amount','nos','pieces','pcs','noofpcs','totalqty','qty'],
                    packing:   ['packing','pack','uom','unit','packtype','packingtype'],
                    box:       ['box','boxno','boxnumber','carton','cartonno','boxno'],
                    action:    ['action','actiontype','type','transactiontype','transaction','movetype','movementtype','process','processtype','activity']
                };

                for(var field in mapDef){
                    for(var a=0; a<mapDef[field].length; a++){
                        var idx = hdr.indexOf(mapDef[field][a]);
                        if(idx > -1){ colMap[field] = idx; break; }
                    }
                }

                console.log('=== COLUMN MAPPING ===', colMap);

                // Check critical
                if(colMap.rack === undefined && colMap.quantity === undefined){
                    // Show manual column selector
                    document.getElementById('_blManualCol').style.display = 'block';
                    document.getElementById('_blManualCol').dataset_raw = JSON.stringify(raw);
                    showToast('Could not auto-detect Rack/Qty columns. Use manual selection below.','warning');
                    return;
                }

                _blDoParse(raw, colMap);

            } catch(err){
                console.error('Parse error:', err);
                showToast('Error: ' + err.message, 'error');
            }
        };
        reader.readAsArrayBuffer(fi.files[0]);
    };

    window._blParseManual = function() {
        var raw = JSON.parse(document.getElementById('_blManualCol').dataset_raw);
        var colMap = {
            rack: parseInt(document.getElementById('_blMRack').value),
            material: parseInt(document.getElementById('_blMMat').value),
            quantity: parseInt(document.getElementById('_blMQty').value)
        };
        if(isNaN(colMap.quantity)){ showToast('Quantity column # is required','error'); return; }
        _blDoParse(raw, colMap);
    };

        function _blDoParse(raw, colMap) {
        _parsedRows = [];
        var warnings = [];

        for(var k=1; k<raw.length; k++){
            var r = raw[k];
            if(!r) continue;

            // Skip empty rows
            var isEmpty = true;
            for(var ci=0; ci<r.length; ci++){
                if(r[ci] !== null && r[ci] !== undefined && String(r[ci]).trim() !== ''){ isEmpty=false; break; }
            }
            if(isEmpty) continue;

            // ===== QUANTITY PARSING =====
            var rawQtyVal = (colMap.quantity !== undefined) ? r[colMap.quantity] : 0;
            var finalQty = 0;

            if(rawQtyVal !== null && rawQtyVal !== undefined && String(rawQtyVal).trim() !== ''){
                if(typeof rawQtyVal === 'number'){
                    finalQty = rawQtyVal;
                } else {
                    var cleanStr = String(rawQtyVal).replace(/[,₹$₽€£\s]/g, '').trim();
                    finalQty = Number(cleanStr);
                }
                if(isNaN(finalQty) || !isFinite(finalQty)) finalQty = 0;
                if(finalQty < 0) finalQty = 0;
            }

            // ===== ACTION PARSING — FIXED =====
            var actRaw = (colMap.action !== undefined) ? String(r[colMap.action] || '').trim() : '';
            var actVal = '';

            if(!actRaw){
                // No action column ya empty — default PUTAWAY
                actVal = 'PUTAWAY';
            } else {
                var actUpper = actRaw.toUpperCase().replace(/[\s\-_]/g, '');

                // Match known values — flexible
                if(actUpper.indexOf('PUTAWAY') > -1 || actUpper.indexOf('PUTAW') > -1 || actUpper === 'PUT' || actUpper === 'PA' || actUpper.indexOf('INBOUND') > -1 || actUpper.indexOf('RECEIVE') > -1 || actUpper.indexOf('GRN') > -1){
                    actVal = 'PUTAWAY';
                } else if(actUpper.indexOf('PIV') > -1 || actUpper.indexOf('PHYSICAL') > -1 || actUpper.indexOf('INVENTORY') > -1 || actUpper.indexOf('VERIFICATION') > -1 || actUpper.indexOf('VERIFY') > -1 || actUpper === 'PV' || actUpper === 'IV'){
                    actVal = 'PIV';
                } else if(actUpper.indexOf('PICK') > -1){
                    actVal = 'PICKING';
                } else if(actUpper.indexOf('LOAD') > -1){
                    actVal = 'LOADING';
                } else if(actUpper.indexOf('TRANSFER') > -1 || actUpper.indexOf('MOVEMENT') > -1){
                    actVal = 'TRANSFER';
                } else if(actUpper.indexOf('RETURN') > -1){
                    actVal = 'RETURN';
                } else {
                    // Unknown value — JO BHI USER NE LIKHA HAI WOHI SAVE KARO
                    actVal = actRaw.toUpperCase().substring(0, 20);
                    warnings.push('Row '+(k+1)+': Unknown action "'+actRaw+'" → saved as "'+actVal+'"');
                }
            }

            console.log('Row', k, '- Action raw: "'+actRaw+'" → Parsed: "'+actVal+'"');

            var rackVal = (colMap.rack !== undefined) ? String(r[colMap.rack] || '').trim() : '';
            var matVal = (colMap.material !== undefined) ? String(r[colMap.material] || '').trim() : '';
            var eanVal = (colMap.ean !== undefined) ? String(r[colMap.ean] || '').trim() : '';
            var descVal = (colMap.description !== undefined) ? String(r[colMap.description] || '').trim() : '';
            var dateVal = (colMap.date !== undefined) ? String(r[colMap.date] || '').trim() : today();
            var packVal = (colMap.packing !== undefined) ? String(r[colMap.packing] || '').trim() : '';
            var boxVal = (colMap.box !== undefined) ? String(r[colMap.box] || '').trim() : '';

            // Fix date formats
            if(dateVal && dateVal.indexOf('/') > -1){
                var dp = dateVal.split('/');
                if(dp.length === 3){
                    var td = new Date(dp[2], dp[1]-1, dp[0]);
                    if(!isNaN(td.getTime())) dateVal = td.toISOString().split('T')[0];
                }
            } else if(dateVal && dateVal.indexOf('-') === -1){
                var ed = Number(dateVal);
                if(!isNaN(ed) && ed > 40000 && ed < 60000){
                    dateVal = new Date((ed-25569)*86400*1000).toISOString().split('T')[0];
                }
            }
            if(!dateVal || dateVal === 'undefined' || dateVal === 'NaN-NaN-NaN') dateVal = today();

            if(!rackVal){
                warnings.push('Row '+(k+1)+': No rack — skipped');
                continue;
            }

            _parsedRows.push({
                date: dateVal,
                rack: rackVal,
                ean: eanVal,
                material: matVal,
                description: descVal,
                quantity: finalQty,
                packing: packVal,
                box: boxVal,
                action: actVal  // <== JO BHI PARSE HUA WOHI
            });
        }

        console.log('=== PARSED RESULT ===');
        console.log('Total parsed rows:', _parsedRows.length);
        if(_parsedRows.length > 0) console.log('First row:', JSON.stringify(_parsedRows[0]));

        if(_parsedRows.length === 0){
            showToast('No valid rows! Check console (F12) for details.','error');
            return;
        }

        // Build preview
        var ph = '<div style="margin-top:12px">';
        ph += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
        ph += '<strong style="color:var(--accent)"><i class="bx bx-check-circle"></i> '+_parsedRows.length+' rows ready</strong>';
        ph += '<span style="font-size:11px;color:var(--text-muted)">Columns: '+JSON.stringify(colMap)+'</span>';
        ph += '</div>';

        if(warnings.length > 0){
            ph += '<div style="background:var(--warning-dim);padding:8px;border-radius:6px;margin-bottom:8px;font-size:11px;color:var(--warning);max-height:80px;overflow-y:auto">';
            for(var w=0;w<Math.min(warnings.length,8);w++) ph += '• '+escapeHtml(warnings[w])+'<br>';
            if(warnings.length>8) ph += '• ...+'+(warnings.length-8)+' more';
            ph += '</div>';
        }

        // Action summary
        var actSummary = {};
        for(var as=0;as<_parsedRows.length;as++){
            var av = _parsedRows[as].action;
            if(!actSummary[av]) actSummary[av] = 0;
            actSummary[av]++;
        }
        ph += '<div style="background:var(--info-dim);padding:8px 12px;border-radius:6px;margin-bottom:8px;font-size:12px;color:var(--info)">';
        ph += '<strong>Action Summary:</strong> ';
        var actParts = [];
        for(var ak in actSummary) actParts.push(ak + ': ' + actSummary[ak]);
        ph += actParts.join(' | ');
        ph += '</div>';

        ph += '<div class="table-wrapper" style="max-height:280px;overflow-y:auto"><table class="data-table"><thead><tr>';
        ph += '<th>#</th><th>Date</th><th>Rack</th><th>EAN</th><th>Material</th><th style="color:var(--accent);font-size:14px">QTY</th><th>Pack</th><th>Box</th><th>Action</th>';
        ph += '</tr></thead><tbody>';

        for(var pi=0;pi<_parsedRows.length;pi++){
            var pr = _parsedRows[pi];
            var qc = pr.quantity > 0 ? 'color:var(--accent)' : 'color:var(--danger)';
            var actBadge = 'badge-info';
            if(pr.action === 'PUTAWAY') actBadge = 'badge-success';
            else if(pr.action === 'PIV') actBadge = 'badge-warning';
            else actBadge = 'badge-accent';

            ph += '<tr>';
            ph += '<td>'+(pi+1)+'</td>';
            ph += '<td style="font-size:11px">'+escapeHtml(pr.date)+'</td>';
            ph += '<td><strong>'+escapeHtml(pr.rack)+'</strong></td>';
            ph += '<td style="font-size:11px">'+escapeHtml(pr.ean)+'</td>';
            ph += '<td>'+escapeHtml(pr.material)+'</td>';
            ph += '<td style="font-size:18px;font-weight:900;'+qc+'">'+pr.quantity+'</td>';
            ph += '<td>'+escapeHtml(pr.packing)+'</td>';
            ph += '<td>'+escapeHtml(pr.box)+'</td>';
            ph += '<td><span class="badge '+actBadge+'">'+escapeHtml(pr.action)+'</span></td>';
            ph += '</tr>';
        }
        ph += '</tbody></table></div></div>';

        document.getElementById('_blPreview').innerHTML = ph;
        document.getElementById('_blSaveBtn').disabled = false;
        document.getElementById('_blManualCol').style.display = 'none';

        showToast('Preview ready! Check Action column.','info');
    }

    // Also update the column mapping to catch more action column names
    // Find this line in _blParseFile and replace the mapDef:

    // --- SAVE ALL ---
    window._blSaveAll = function() {
        if(_parsedRows.length === 0){ showToast('Nothing to save','error'); return; }

        var allLoc = DB.get('location_master');
        var added = 0, updated = 0, totalQ = 0;

        for(var i=0; i<_parsedRows.length; i++){
            var row = _parsedRows[i];
            var qty = Number(row.quantity); // EXPLICIT Number() call
            if(isNaN(qty)) qty = 0;
            totalQ += qty;

            // Find existing
            var found = -1;
            for(var j=0; j<allLoc.length; j++){
                if(allLoc[j].rack === row.rack && allLoc[j].ean === row.ean && row.ean !== ''){
                    found = j; break;
                }
            }

            if(found > -1){
                var oldQ = Number(allLoc[found].quantity) || 0;
                allLoc[found].quantity = oldQ + qty;
                allLoc[found].date = row.date;
                allLoc[found].material = row.material;
                allLoc[found].description = row.description;
                allLoc[found].packing = row.packing;
                allLoc[found].box = row.box;
                allLoc[found].action = row.action;
                allLoc[found].user = APP.currentUser ? APP.currentUser.name : 'Admin';
                allLoc[found].updatedAt = new Date().toISOString();
                updated++;
            } else {
                allLoc.push({
                    id: DB.uid(),
                    date: row.date,
                    rack: row.rack,
                    ean: row.ean,
                    material: row.material,
                    description: row.description,
                    quantity: qty,
                    packing: row.packing,
                    box: row.box,
                    action: row.action,
                    user: APP.currentUser ? APP.currentUser.name : 'Admin',
                    dateTime: new Date().toISOString(),
                    createdAt: new Date().toISOString()
                });
                added++;
            }
        }

        // Save
        DB.set('location_master', allLoc);

        // VERIFY — Read back and check
        var verify = DB.get('location_master');
        var verifyQty = 0;
        for(var v=0; v<verify.length; v++) verifyQty += (Number(verify[v].quantity) || 0);

        console.log('=== AFTER SAVE VERIFICATION ===');
        console.log('Total records now:', verify.length);
        console.log('Total quantity in DB:', verifyQty);
        console.log('Last 3 records:', verify.slice(-3));

        logAction('Location Master', 'BULK_UPLOAD_FIXED', added+' added, '+updated+' updated. Total qty uploaded: '+totalQ+'. Verified total in DB: '+verifyQty);
        showToast('DONE! '+added+' new, '+updated+' updated. Qty uploaded: '+totalQ+'. DB total: '+verifyQty, 'success');

        _parsedRows = [];
        closeModal();
        renderLocationMaster();
    }

    console.log('[NUCLEAR FIX] Location Master bulk upload override loaded successfully.');

})();
