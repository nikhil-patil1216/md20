const express = require('express');
const { createClient } = require('@libsql/client');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'vip_industry_md20_warehouse_secret_2024';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== DATABASE CONNECT =====================
var dbUrl = process.env.TURSO_DATABASE_URL || 'file:local.db';
var dbToken = process.env.TURSO_AUTH_TOKEN || undefined;

var db = createClient({
  url: dbUrl,
  authToken: dbToken
});

// ===================== DATABASE HELPERS =====================
async function dbRun(sql, params) {
  params = params || [];
  await db.execute({ sql: sql, args: params });
  try {
    var r = await db.execute("SELECT last_insert_rowid() as id");
    return { changes: 1, lastInsertRowid: r.rows[0].id };
  } catch (e) {
    return { changes: 1, lastInsertRowid: 0 };
  }
}

async function dbGet(sql, params) {
  params = params || [];
  try {
    var result = await db.execute({ sql: sql, args: params });
    if (result.rows.length > 0) return result.rows[0];
    return undefined;
  } catch (e) {
    return undefined;
  }
}

async function dbAll(sql, params) {
  params = params || [];
  try {
    var result = await db.execute({ sql: sql, args: params });
    return result.rows;
  } catch (e) {
    return [];
  }
}

async function dbExec(sql) {
  try {
    await db.execute(sql);
  } catch (e) {
    console.error('SQL Error:', e.message);
  }

}

// ===================== TABLE CREATION =====================
var TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    access TEXT DEFAULT '[]',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_no TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    driver_mobile TEXT NOT NULL,
    transport TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS vehicle_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    invoice_no TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inbound_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    invoice_no TEXT NOT NULL,
    material TEXT NOT NULL,
    ean TEXT DEFAULT '',
    description TEXT DEFAULT '',
    div TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    qty REAL NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS grn_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_no TEXT UNIQUE NOT NULL,
    vehicle_id INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS putaway_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_no TEXT NOT NULL,
    invoice_no TEXT NOT NULL,
    material TEXT NOT NULL,
    ean TEXT DEFAULT '',
    description TEXT DEFAULT '',
    div TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    inbound_qty REAL DEFAULT 0,
    putaway_qty REAL DEFAULT 0,
    short_qty REAL DEFAULT 0,
    rack TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    created_by TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS piv_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    piv_by TEXT NOT NULL,
    date TEXT NOT NULL,
    rack TEXT NOT NULL,
    ean TEXT DEFAULT '',
    material TEXT NOT NULL,
    description TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    packing TEXT DEFAULT '',
    box_no TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS location_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    grn_no TEXT DEFAULT '',
    invoice_no TEXT DEFAULT '',
    date TEXT NOT NULL,
    rack TEXT NOT NULL,
    ean TEXT DEFAULT '',
    material TEXT NOT NULL,
    description TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    packing TEXT DEFAULT '',
    box_no TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS material_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material TEXT NOT NULL,
    description TEXT DEFAULT '',
    div TEXT DEFAULT '',
    ean TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS bins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rack TEXT NOT NULL,
    bin TEXT NOT NULL,
    capacity REAL DEFAULT 0,
    current_qty REAL DEFAULT 0,
    status TEXT DEFAULT 'empty',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS sequences (
    name TEXT PRIMARY KEY,
    last_value INTEGER DEFAULT 0,
    date TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS location_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ho_no TEXT UNIQUE NOT NULL,
    picker_name TEXT NOT NULL,
    materials TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS location_report_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    location_data_id INTEGER NOT NULL,
    action TEXT DEFAULT 'none'
  );
  CREATE TABLE IF NOT EXISTS location_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ho_no TEXT DEFAULT '',
    action TEXT NOT NULL,
    location_data_id INTEGER DEFAULT 0,
    rack TEXT DEFAULT '',
    ean TEXT DEFAULT '',
    material TEXT DEFAULT '',
    description TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    performed_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    user TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`;

// ===================== HELPERS =====================
async function getNextNumber(prefix) {
  var today = new Date().toISOString().split('T')[0];
  var dateStr = today.replace(/-/g, '');
  var row = await dbGet('SELECT * FROM sequences WHERE name = ?', [prefix]);
  if (!row || row.date !== today) {
    await dbRun('INSERT OR REPLACE INTO sequences (name, last_value, date) VALUES (?, 1, ?)', [prefix, today]);
    return prefix + dateStr + '0001';
  }
  var next = row.last_value + 1;
  await dbRun('UPDATE sequences SET last_value = ? WHERE name = ?', [next, prefix]);
  return prefix + dateStr + String(next).padStart(4, '0');
}

async function logActivity(module, action, details, user) {
  await dbRun('INSERT INTO activity_log (module, action, details, user) VALUES (?, ?, ?, ?)', [module, action, details || '', user || '']);
}

function authMiddleware(req, res, next) {
  var token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function hasAccess(user, mod) {
  try {
    var access = JSON.parse(user.access || '[]');
    if (access.indexOf('admin') >= 0) return true;
    return access.indexOf(mod) >= 0;
  } catch (e) { return false; }
}

// ===================== AUTH ROUTES =====================
app.post('/api/auth/login', async function(req, res) {
  var username = req.body.username;
  var password = req.body.password;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  var user = await dbGet('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  var token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, access: user.access }, JWT_SECRET, { expiresIn: '24h' });
  await logActivity('auth', 'login', 'User ' + user.name + ' logged in', user.name);
  res.json({ token: token, user: { id: user.id, username: user.username, name: user.name, role: user.role, access: user.access } });
});

app.post('/api/auth/change-password', authMiddleware, async function(req, res) {
  var oldPassword = req.body.oldPassword;
  var newPassword = req.body.newPassword;
  var user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(oldPassword, user.password)) return res.status(400).json({ error: 'Old password incorrect' });
  await dbRun('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), req.user.id]);
  res.json({ message: 'Password changed' });
});

// ===================== USER ROUTES =====================
app.get('/api/users', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  res.json(await dbAll('SELECT id, username, name, role, access, active, created_at FROM users ORDER BY id'));
});

app.post('/api/users', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  var username = req.body.username, password = req.body.password, name = req.body.name, role = req.body.role, access = req.body.access;
  if (!username || !password || !name) return res.status(400).json({ error: 'Username, password, name required' });
  var exists = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) return res.status(400).json({ error: 'Username already exists' });
  await dbRun('INSERT INTO users (username, password, name, role, access) VALUES (?, ?, ?, ?, ?)', [username, bcrypt.hashSync(password, 10), name, role || 'user', JSON.stringify(access || [])]);
  await logActivity('admin', 'create_user', 'Created user: ' + name, req.user.name);
  res.json({ message: 'User created' });
});

app.put('/api/users/:id', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  var name = req.body.name, role = req.body.role, access = req.body.access, active = req.body.active, password = req.body.password;
  if (password) {
    await dbRun('UPDATE users SET name=?, role=?, access=?, active=?, password=? WHERE id=?', [name, role, JSON.stringify(access || []), active ? 1 : 0, bcrypt.hashSync(password, 10), req.params.id]);
  } else {
    await dbRun('UPDATE users SET name=?, role=?, access=?, active=? WHERE id=?', [name, role, JSON.stringify(access || []), active ? 1 : 0, req.params.id]);
  }
  await logActivity('admin', 'update_user', 'Updated user ID: ' + req.params.id, req.user.name);
  res.json({ message: 'User updated' });
});

app.delete('/api/users/:id', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  if (req.user.id === parseInt(req.params.id)) return res.status(400).json({ error: 'Cannot delete yourself' });
  await dbRun('DELETE FROM users WHERE id = ?', [req.params.id]);
  await logActivity('admin', 'delete_user', 'Deleted user ID: ' + req.params.id, req.user.name);
  res.json({ message: 'User deleted' });
});

// ===================== VEHICLE / INBOUND ENTRY =====================
app.post('/api/vehicles', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  var v = req.body;
  if (!v.vehicle_no || !v.driver_name || !v.driver_mobile || !v.transport || !v.invoices || !v.invoices.length) return res.status(400).json({ error: 'All fields required' });
  var result = await dbRun('INSERT INTO vehicles (vehicle_no, driver_name, driver_mobile, transport) VALUES (?, ?, ?, ?)', [v.vehicle_no, v.driver_name, v.driver_mobile, v.transport]);
  var vid = result.lastInsertRowid;
  for (var i = 0; i < v.invoices.length; i++) {
    await dbRun('INSERT INTO vehicle_invoices (vehicle_id, invoice_no) VALUES (?, ?)', [vid, v.invoices[i].invoice_no]);
  }
  await logActivity('inbound', 'vehicle_entry', 'Vehicle ' + v.vehicle_no + ' with ' + v.invoices.length + ' invoices', req.user.name);
  res.json({ id: vid, message: 'Vehicle entry saved' });
});

app.get('/api/vehicles', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  res.json(await dbAll('SELECT v.*, (SELECT GROUP_CONCAT(vi.invoice_no, ", ") FROM vehicle_invoices vi WHERE vi.vehicle_id = v.id) as invoice_list FROM vehicles v ORDER BY v.id DESC'));
});

app.get('/api/vehicles/:id', authMiddleware, async function(req, res) {
  var vehicle = await dbGet('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  var invoices = await dbAll('SELECT * FROM vehicle_invoices WHERE vehicle_id = ?', [req.params.id]);
  var materials = await dbAll('SELECT * FROM inbound_materials WHERE vehicle_id = ?', [req.params.id]);
  vehicle.invoices = invoices;
  vehicle.materials = materials;
  res.json(vehicle);
});

// ===================== INBOUND MATERIALS =====================
app.post('/api/inbound/materials', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  var vehicle_id = req.body.vehicle_id, materials = req.body.materials;
  if (!vehicle_id || !materials || !materials.length) return res.status(400).json({ error: 'Vehicle ID and materials required' });
  for (var i = 0; i < materials.length; i++) {
    var m = materials[i];
    await dbRun('INSERT INTO inbound_materials (vehicle_id, invoice_no, material, ean, description, div, brand, qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [vehicle_id, m.invoice_no, m.material, m.ean || '', m.description || '', m.div || '', m.brand || '', m.qty || 0]);
  }
  await dbRun('UPDATE vehicles SET status = ? WHERE id = ?', ['material_entered', vehicle_id]);
  await logActivity('inbound', 'materials_entered', 'Materials for vehicle ID: ' + vehicle_id, req.user.name);
  res.json({ message: 'Materials saved, moved to unloading pending' });
});

app.get('/api/inbound/pending', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  res.json(await dbAll('SELECT v.*, (SELECT GROUP_CONCAT(vi.invoice_no, ", ") FROM vehicle_invoices vi WHERE vi.vehicle_id = v.id) as invoice_list FROM vehicles v WHERE v.status IN ("material_entered", "pending", "unloading") ORDER BY v.id DESC'));
});

// ===================== UNLOAD PROCESS =====================
app.post('/api/inbound/unload', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  var vehicle_id = req.body.vehicle_id, invoice_no = req.body.invoice_no, scanned_materials = req.body.scanned_materials;
  if (!vehicle_id || !invoice_no || !scanned_materials || !scanned_materials.length) return res.status(400).json({ error: 'All fields required' });
  for (var i = 0; i < scanned_materials.length; i++) {
    await dbRun('UPDATE inbound_materials SET status = ? WHERE vehicle_id = ? AND invoice_no = ? AND material = ?', ['unloaded', vehicle_id, invoice_no, scanned_materials[i].material]);
  }
  var pending = await dbGet('SELECT COUNT(*) as c FROM inbound_materials WHERE vehicle_id = ? AND status = "pending"', [vehicle_id]);
  if (pending.c === 0) {
    var grn_no = await getNextNumber('GRN');
    await dbRun('INSERT INTO grn_records (grn_no, vehicle_id) VALUES (?, ?)', [grn_no, vehicle_id]);
    await dbRun('UPDATE vehicles SET status = ? WHERE id = ?', ['unloaded', vehicle_id]);
    await logActivity('inbound', 'unload_complete', 'Vehicle ID: ' + vehicle_id + ' GRN: ' + grn_no, req.user.name);
    res.json({ message: 'All invoices scanned, GRN created', grn_no: grn_no });
  } else {
    await dbRun('UPDATE vehicles SET status = ? WHERE id = ?', ['unloading', vehicle_id]);
    await logActivity('inbound', 'unload_partial', 'Partial unload vehicle ID: ' + vehicle_id, req.user.name);
    res.json({ message: 'Invoice scanned, more pending' });
  }
});

// ===================== GRN ROUTES =====================
app.get('/api/grn', authMiddleware, async function(req, res) {
  res.json(await dbAll('SELECT gr.*, v.vehicle_no, v.driver_name, (SELECT GROUP_CONCAT(vi.invoice_no, ", ") FROM vehicle_invoices vi WHERE vi.vehicle_id = gr.vehicle_id) as invoice_list FROM grn_records gr JOIN vehicles v ON gr.vehicle_id = v.id ORDER BY gr.id DESC'));
});

app.get('/api/grn/:grn_no', authMiddleware, async function(req, res) {
  var grn = await dbGet('SELECT * FROM grn_records WHERE grn_no = ?', [req.params.grn_no]);
  if (!grn) return res.status(404).json({ error: 'GRN not found' });
  var materials = await dbAll('SELECT * FROM inbound_materials WHERE vehicle_id = ?', [grn.vehicle_id]);
  var invoiceRows = await dbAll('SELECT DISTINCT invoice_no FROM inbound_materials WHERE vehicle_id = ?', [grn.vehicle_id]);
  var invoices = [];
  for (var i = 0; i < invoiceRows.length; i++) invoices.push(invoiceRows[i].invoice_no);
  grn.materials = materials;
  grn.invoices = invoices;
  res.json(grn);
});

// ===================== PUTAWAY ROUTES =====================
app.post('/api/putaway', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'putaway')) return res.status(403).json({ error: 'No access' });
  var grn_no = req.body.grn_no, invoice_no = req.body.invoice_no, items = req.body.items;
  if (!grn_no || !invoice_no || !items || !items.length) return res.status(400).json({ error: 'All fields required' });
  var today = new Date().toISOString().split('T')[0];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    await dbRun('INSERT INTO putaway_records (grn_no, invoice_no, material, ean, description, div, brand, inbound_qty, putaway_qty, short_qty, rack, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [grn_no, invoice_no, it.material, it.ean || '', it.description || '', it.div || '', it.brand || '', it.inbound_qty || 0, it.putaway_qty || 0, it.short_qty || 0, it.rack || '', req.user.name]);
    var existing = await dbGet('SELECT id FROM location_data WHERE source="putaway" AND date=? AND rack=? AND material=? AND qty=? AND active=1', [today, it.rack || '', it.material, it.putaway_qty || 0]);
    if (!existing) {
      await dbRun('INSERT INTO location_data (source, grn_no, invoice_no, date, rack, ean, material, description, qty, packing, box_no) VALUES ("putaway", ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [grn_no, invoice_no, today, it.rack || '', it.ean || '', it.material, it.description || '', it.putaway_qty || 0, '', '']);
    }
  }
  await logActivity('putaway', 'putaway_done', 'Putaway GRN: ' + grn_no + ' Invoice: ' + invoice_no, req.user.name);
  res.json({ message: 'Putaway saved' });
});
app.get('/api/putaway/remaining/:grn_no', authMiddleware, async function(req, res) {
  var grn = await dbGet('SELECT * FROM grn_records WHERE grn_no = ?', [req.params.grn_no]);
  if (!grn) return res.status(404).json({ error: 'GRN not found' });
  var inbound = await dbAll('SELECT * FROM inbound_materials WHERE vehicle_id = ?', [grn.vehicle_id]);
  var putaway = await dbAll('SELECT * FROM putaway_records WHERE grn_no = ?', [req.params.grn_no]);
  var result = [];
  for (var i = 0; i < inbound.length; i++) {
    var ib = inbound[i];
    var paQty = 0;
    for (var j = 0; j < putaway.length; j++) {
      if (putaway[j].invoice_no === ib.invoice_no && putaway[j].material === ib.material) {
        paQty += putaway[j].putaway_qty;
      }
    }
    var remaining = ib.qty - paQty;
    result.push({
      invoice_no: ib.invoice_no,
      material: ib.material,
      ean: ib.ean || '',
      description: ib.description || '',
      inbound_qty: ib.qty,
      putaway_qty: paQty,
      remaining_qty: remaining,
      completed: remaining <= 0
    });
  }
  res.json(result);
});
app.get('/api/putaway/difference/:grn_no', authMiddleware, async function(req, res) {
  var grn = await dbGet('SELECT * FROM grn_records WHERE grn_no = ?', [req.params.grn_no]);
  if (!grn) return res.status(404).json({ error: 'GRN not found' });
  var inbound = await dbAll('SELECT * FROM inbound_materials WHERE vehicle_id = ?', [grn.vehicle_id]);
  var putaway = await dbAll('SELECT * FROM putaway_records WHERE grn_no = ?', [req.params.grn_no]);
  var diff = [];
  for (var i = 0; i < inbound.length; i++) {
    var ib = inbound[i];
    var paQty = 0, shortQty = 0;
    for (var j = 0; j < putaway.length; j++) {
      if (putaway[j].invoice_no === ib.invoice_no && putaway[j].material === ib.material) {
        paQty += putaway[j].putaway_qty;
        shortQty += putaway[j].short_qty;
      }
    }
    diff.push({ invoice_no: ib.invoice_no, material: ib.material, description: ib.description, ean: ib.ean, inbound_qty: ib.qty, putaway_qty: paQty, difference: ib.qty - paQty, short_qty: shortQty });
  }
  res.json(diff);
});

// ===================== PIV ROUTES =====================
app.post('/api/piv', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'piv')) return res.status(403).json({ error: 'No access' });
  var piv_by = req.body.piv_by, items = req.body.items;
  if (!piv_by || !items || !items.length) return res.status(400).json({ error: 'PIV by and items required' });
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var pDate = it.date || new Date().toISOString().split('T')[0];
    await dbRun('INSERT INTO piv_records (piv_by, date, rack, ean, material, description, qty, packing, box_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [piv_by, pDate, it.rack, it.ean || '', it.material, it.description || '', it.qty || 0, it.packing || '', it.box_no || '']);
    await dbRun('UPDATE location_data SET active = 0 WHERE source = "piv" AND rack = ? AND active = 1', [it.rack]);
    var existing = await dbGet('SELECT id FROM location_data WHERE source="piv" AND date=? AND rack=? AND material=? AND qty=? AND active=1', [pDate, it.rack, it.material, it.qty || 0]);
    if (!existing) {
      await dbRun('INSERT INTO location_data (source, date, rack, ean, material, description, qty, packing, box_no) VALUES ("piv", ?, ?, ?, ?, ?, ?, ?, ?)', [pDate, it.rack, it.ean || '', it.material, it.description || '', it.qty || 0, it.packing || '', it.box_no || '']);
    }
  }
  await logActivity('piv', 'piv_done', 'PIV by ' + piv_by + ', ' + items.length + ' items', req.user.name);
  res.json({ message: 'PIV saved' });
});

app.get('/api/piv', authMiddleware, async function(req, res) {
  res.json(await dbAll('SELECT * FROM piv_records ORDER BY id DESC LIMIT 500'));
});

// ===================== LOCATION ROUTES =====================
app.get('/api/location', authMiddleware, async function(req, res) {
  res.json(await dbAll('SELECT * FROM location_data WHERE active = 1 ORDER BY id DESC'));
});

app.get('/api/location/search', authMiddleware, async function(req, res) {
  var materials = req.query.materials;
  if (!materials) return res.status(400).json({ error: 'Materials required' });
  var matList = materials.split(',');
  var cleanList = [];
  for (var i = 0; i < matList.length; i++) { var m = matList[i].trim(); if (m) cleanList.push(m); }
  var placeholders = [];
  var params = [];
  for (var j = 0; j < cleanList.length; j++) { placeholders.push('?'); params.push(cleanList[j]); }
  res.json(await dbAll('SELECT * FROM location_data WHERE active = 1 AND material IN (' + placeholders.join(',') + ') ORDER BY rack', params));
});

app.post('/api/location/bulk', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'location')) return res.status(403).json({ error: 'No access' });
  var items = req.body.items;
  if (!items || !items.length) return res.status(400).json({ error: 'Items array required' });
  var today = new Date().toISOString().split('T')[0];
  var count = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it.rack || !it.material) continue;
    var qty = parseFloat(it.qty) || 0;
    if (qty <= 0) continue;
    var existing = await dbGet('SELECT id FROM location_data WHERE date=? AND rack=? AND material=? AND qty=? AND active=1', [it.date || today, it.rack, it.material, qty]);
    if (!existing) {
      await dbRun('INSERT INTO location_data (source, date, rack, ean, material, description, qty, packing, box_no) VALUES ("manual", ?, ?, ?, ?, ?, ?, ?, ?)', [it.date || today, it.rack, it.ean || '', it.material, it.description || '', qty, it.packing || '', it.box_no || '']);
      count++;
    }
  }
  await logActivity('location', 'bulk_add', 'Bulk added ' + count + ' location items', req.user.name);
  res.json({ message: count + ' location items added' });
});

app.post('/api/location/report', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'location')) return res.status(403).json({ error: 'No access' });
  var picker_name = req.body.picker_name, materials = req.body.materials, location_ids = req.body.location_ids;
  if (!picker_name || !location_ids || !location_ids.length) return res.status(400).json({ error: 'Picker name and location IDs required' });
  var ho_no = await getNextNumber('HO');
  await dbRun('INSERT INTO location_reports (ho_no, picker_name, materials) VALUES (?, ?, ?)', [ho_no, picker_name, materials || '']);
  var report = await dbGet('SELECT id FROM location_reports WHERE ho_no = ?', [ho_no]);
  for (var i = 0; i < location_ids.length; i++) {
    await dbRun('INSERT INTO location_report_items (report_id, location_data_id, action) VALUES (?, ?, ?)', [report.id, location_ids[i], 'none']);
  }
  await logActivity('location', 'report_created', 'HO: ' + ho_no + ' Picker: ' + picker_name, req.user.name);
  res.json({ ho_no: ho_no, message: 'Location report created' });
});

app.get('/api/location/report/:ho_no', authMiddleware, async function(req, res) {
  var report = await dbGet('SELECT * FROM location_reports WHERE ho_no = ?', [req.params.ho_no]);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  var items = await dbAll('SELECT lri.id as report_item_id, lri.action, ld.* FROM location_report_items lri JOIN location_data ld ON lri.location_data_id = ld.id WHERE lri.report_id = ?', [report.id]);
  report.items = items;
  res.json(report);
});

app.put('/api/location/report/:ho_no/item/:item_id', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'location')) return res.status(403).json({ error: 'No access' });
  var action = req.body.action, qty = req.body.qty;
  var reportItem = await dbGet('SELECT lri.*, ld.* FROM location_report_items lri JOIN location_data ld ON lri.location_data_id = ld.id WHERE lri.id = ?', [req.params.item_id]);
  if (!reportItem) return res.status(404).json({ error: 'Item not found' });
  if (action === 'delete') {
    await dbRun('UPDATE location_data SET active = 0 WHERE id = ?', [reportItem.location_data_id]);
    await dbRun('UPDATE location_report_items SET action = ? WHERE id = ?', ['deleted', req.params.item_id]);
    await dbRun('INSERT INTO location_audit (ho_no, action, location_data_id, rack, ean, material, description, qty, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.params.ho_no, 'delete', reportItem.location_data_id, reportItem.rack, reportItem.ean, reportItem.material, reportItem.description, reportItem.qty, req.user.name]);
    await logActivity('location', 'item_deleted', 'HO: ' + req.params.ho_no + ' Material: ' + reportItem.material, req.user.name);
  } else if (action === 'minus') {
    var minusQty = qty || reportItem.qty;
    var newQty = Math.max(0, reportItem.qty - minusQty);
    if (newQty === 0) {
      await dbRun('UPDATE location_data SET active = 0 WHERE id = ?', [reportItem.location_data_id]);
    } else {
      await dbRun('UPDATE location_data SET qty = ? WHERE id = ?', [newQty, reportItem.location_data_id]);
    }
    await dbRun('UPDATE location_report_items SET action = ? WHERE id = ?', ['minus', req.params.item_id]);
    await dbRun('INSERT INTO location_audit (ho_no, action, location_data_id, rack, ean, material, description, qty, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.params.ho_no, 'minus', reportItem.location_data_id, reportItem.rack, reportItem.ean, reportItem.material, reportItem.description, minusQty, req.user.name]);
    await logActivity('location', 'item_minus', 'HO: ' + req.params.ho_no + ' Material: ' + reportItem.material + ' Qty: -' + minusQty, req.user.name);
  }
  res.json({ message: 'Action ' + action + ' performed' });
});

app.get('/api/location/audit', authMiddleware, async function(req, res) {
  res.json(await dbAll('SELECT * FROM location_audit ORDER BY id DESC'));
});

// ===================== MATERIAL MASTER =====================
app.get('/api/materials', authMiddleware, async function(req, res) {
  var search = req.query.search;
  if (search) {
    res.json(await dbAll('SELECT * FROM material_master WHERE material LIKE ? OR description LIKE ? OR ean LIKE ? ORDER BY id DESC', ['%' + search + '%', '%' + search + '%', '%' + search + '%']));
  } else {
    res.json(await dbAll('SELECT * FROM material_master ORDER BY id DESC'));
  }
});

app.post('/api/materials/bulk', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'material')) return res.status(403).json({ error: 'No access' });
  var materials = req.body.materials;
  if (!materials || !materials.length) return res.status(400).json({ error: 'Materials array required' });
  var count = 0;
  for (var i = 0; i < materials.length; i++) {
    var m = materials[i];
    await dbRun('INSERT OR IGNORE INTO material_master (material, description, div, ean, brand) VALUES (?, ?, ?, ?, ?)', [m.material, m.description || '', m.div || '', m.ean || '', m.brand || '']);
    count++;
  }
  await logActivity('material', 'bulk_add', 'Added ' + count + ' materials', req.user.name);
  res.json({ message: count + ' materials added' });
});

app.post('/api/materials/single', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'material')) return res.status(403).json({ error: 'No access' });
  var m = req.body;
  if (!m.material) return res.status(400).json({ error: 'Material code required' });
  await dbRun('INSERT OR IGNORE INTO material_master (material, description, div, ean, brand) VALUES (?, ?, ?, ?, ?)', [m.material, m.description || '', m.div || '', m.ean || '', m.brand || '']);
  await logActivity('material', 'add_single', 'Added material: ' + m.material, req.user.name);
  res.json({ message: 'Material added' });
});

app.get('/api/materials/lookup/:ean', authMiddleware, async function(req, res) {
  var mat = await dbGet('SELECT * FROM material_master WHERE ean = ? OR material = ?', [req.params.ean, req.params.ean]);
  res.json(mat || null);
});

// ===================== BIN MANAGEMENT =====================
app.get('/api/bins', authMiddleware, async function(req, res) {
  res.json(await dbAll('SELECT * FROM bins ORDER BY rack, bin'));
});

app.post('/api/bins/bulk', authMiddleware, async function(req, res) {
  if (!hasAccess(req.user, 'bin')) return res.status(403).json({ error: 'No access' });
  var bins = req.body.bins;
  if (!bins || !bins.length) return res.status(400).json({ error: 'Bins array required' });
  var count = 0;
  for (var i = 0; i < bins.length; i++) {
    var b = bins[i];
    await dbRun('INSERT OR IGNORE INTO bins (rack, bin, capacity) VALUES (?, ?, ?)', [b.rack, b.bin, b.capacity || 0]);
    count++;
  }
  await logActivity('bin', 'bulk_add', 'Added ' + count + ' bins', req.user.name);
  res.json({ message: count + ' bins added' });
});

app.get('/api/bins/search/:material', authMiddleware, async function(req, res) {
  var mat = req.params.material;
  var locations = await dbAll('SELECT * FROM location_data WHERE active = 1 AND material = ? ORDER BY rack', [mat]);
  var putawayHistory = await dbAll('SELECT grn_no, rack, putaway_qty, created_at FROM putaway_records WHERE material = ? ORDER BY created_at DESC LIMIT 20', [mat]);
  var pivHistory = await dbAll('SELECT rack, qty, created_at FROM piv_records WHERE material = ? ORDER BY created_at DESC LIMIT 20', [mat]);
  res.json({ locations: locations, putawayHistory: putawayHistory, pivHistory: pivHistory });
});

// ===================== LIVE ACTION =====================
app.get('/api/live-actions', authMiddleware, async function(req, res) {
  res.json(await dbAll('SELECT * FROM activity_log ORDER BY id DESC LIMIT 100'));
});

// ===================== DASHBOARD =====================
app.get('/api/dashboard/stats', authMiddleware, async function(req, res) {
  var pv = await dbGet("SELECT COUNT(*) as c FROM vehicles WHERE status IN ('pending', 'material_entered')");
  var uv = await dbGet("SELECT COUNT(*) as c FROM vehicles WHERE status = 'unloading'");
  var grn = await dbGet("SELECT COUNT(*) as c FROM grn_records");
  var pa = await dbGet("SELECT COUNT(*) as c FROM putaway_records");
  var piv = await dbGet("SELECT COUNT(*) as c FROM piv_records");
  var mat = await dbGet("SELECT COUNT(*) as c FROM material_master");
  var tb = await dbGet("SELECT COUNT(*) as c FROM bins");
  var fb = await dbGet("SELECT COUNT(*) as c FROM bins WHERE status = 'filled'");
  var al = await dbGet("SELECT COUNT(*) as c FROM location_data WHERE active = 1");
  res.json({
    pendingVehicles: pv.c,
    unloadingVehicles: uv.c,
    totalGRN: grn.c,
    totalPutaway: pa.c,
    totalPIV: piv.c,
    totalMaterials: mat.c,
    totalBins: tb.c,
    filledBins: fb.c,
    activeLocations: al.c
  });
});

// ===================== CATCH ALL =====================
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===================== START SERVER =====================
async function startServer() {
  console.log('Connecting to Turso Cloud Database...');
  try {
    var statements = TABLES_SQL.split(';');
    for (var i = 0; i < statements.length; i++) {
      var s = statements[i].trim();
      if (s.length > 10) {
        try { await db.execute(s); } catch(e) { console.log('Table skip:', e.message); }
      }
    }
    console.log('Tables ready.');
  } catch (err) {
    console.error('DB Connection Error:', err.message);
    console.log('Starting with fallback local DB...');
    db = createClient({ url: 'file:local.db' });
    var statements2 = TABLES_SQL.split(';');
    for (var j = 0; j < statements2.length; j++) {
      var s2 = statements2[j].trim();
      if (s2.length > 10) {
        try { await db.execute(s2); } catch(e2) {}
      }
    }
  }
    }
  
  console.log('Tables ready.');

  var adminExists = await dbGet("SELECT id FROM users WHERE username = 'admin'");
  if (!adminExists) {
    await dbRun("INSERT INTO users (username, password, name, role, access) VALUES (?, ?, ?, ?, ?)", [
      'admin', bcrypt.hashSync('admin123', 10), 'Admin', 'admin', JSON.stringify(['admin','inbound','putaway','piv','location','material','bin'])
    ]);
    console.log('Default admin created: username=admin, password=admin123');
  }

  app.listen(PORT, function() {
    console.log('');
    console.log('======================================================');
    console.log('   VIP Industry (MD20) - WMS Server');
    console.log('   Database: Turso Cloud (Permanent Storage)');
    console.log('   Running on: http://localhost:' + PORT);
    console.log('   Developed by: Nikhil Patil');
    console.log('======================================================');
    console.log('');
  });


startServer().catch(function(err) {
  console.error('Failed to start:', err);
  process.exit(1);
});