const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'vip_industry_md20_warehouse_secret_2024';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== DATABASE SETUP =====================
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);
const db = new Database(path.join(dbDir, 'warehouse.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===================== TABLE CREATION =====================
db.exec(`
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
    invoice_no TEXT NOT NULL,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
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
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS grn_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_no TEXT UNIQUE NOT NULL,
    vehicle_id INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
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
    action TEXT DEFAULT 'none',
    FOREIGN KEY (report_id) REFERENCES location_reports(id) ON DELETE CASCADE,
    FOREIGN KEY (location_data_id) REFERENCES location_data(id)
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
`);

// ===================== HELPERS =====================
function getNextNumber(prefix) {
  const today = new Date().toISOString().split('T')[0];
  const dateStr = today.replace(/-/g, '');
  let row = db.prepare('SELECT * FROM sequences WHERE name = ?').get(prefix);
  if (!row || row.date !== today) {
    db.prepare('INSERT OR REPLACE INTO sequences (name, last_value, date) VALUES (?, 1, ?)').run(prefix, today);
    return `${prefix}${dateStr}0001`;
  }
  const next = row.last_value + 1;
  db.prepare('UPDATE sequences SET last_value = ? WHERE name = ?').run(next, prefix);
  return `${prefix}${dateStr}${String(next).padStart(4, '0')}`;
}

function logActivity(module, action, details, user) {
  db.prepare('INSERT INTO activity_log (module, action, details, user) VALUES (?, ?, ?, ?)').run(module, action, details, user || '');
}

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

function hasAccess(user, module) {
  try {
    const access = JSON.parse(user.access || '[]');
    if (access.includes('admin')) return true;
    return access.includes(module);
  } catch { return false; }
}

// ===================== AUTH ROUTES =====================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, access: user.access }, JWT_SECRET, { expiresIn: '24h' });
  logActivity('auth', 'login', `User ${user.name} logged in`, user.name);
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role, access: user.access } });
});

app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(oldPassword, user.password)) return res.status(400).json({ error: 'Old password incorrect' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ message: 'Password changed' });
});

// ===================== USER ROUTES (ADMIN) =====================
app.get('/api/users', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  const users = db.prepare('SELECT id, username, name, role, access, active, created_at FROM users ORDER BY id').all();
  res.json(users);
});

app.post('/api/users', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  const { username, password, name, role, access } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Username, password, name required' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: 'Username already exists' });
  db.prepare('INSERT INTO users (username, password, name, role, access) VALUES (?, ?, ?, ?, ?)').run(
    username, bcrypt.hashSync(password, 10), name, role || 'user', JSON.stringify(access || [])
  );
  logActivity('admin', 'create_user', `Created user: ${name}`, req.user.name);
  res.json({ message: 'User created' });
});

app.put('/api/users/:id', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  const { name, role, access, active, password } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (password) {
    db.prepare('UPDATE users SET name=?, role=?, access=?, active=?, password=? WHERE id=?').run(
      name, role, JSON.stringify(access || []), active ? 1 : 0, bcrypt.hashSync(password, 10), req.params.id
    );
  } else {
    db.prepare('UPDATE users SET name=?, role=?, access=?, active=? WHERE id=?').run(
      name, role, JSON.stringify(access || []), active ? 1 : 0, req.params.id
    );
  }
  logActivity('admin', 'update_user', `Updated user ID: ${req.params.id}`, req.user.name);
  res.json({ message: 'User updated' });
});

app.delete('/api/users/:id', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  if (req.user.id === parseInt(req.params.id)) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logActivity('admin', 'delete_user', `Deleted user ID: ${req.params.id}`, req.user.name);
  res.json({ message: 'User deleted' });
});

// ===================== VEHICLE / INBOUND ENTRY =====================
app.post('/api/vehicles', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  const { vehicle_no, driver_name, driver_mobile, transport, invoices } = req.body;
  if (!vehicle_no || !driver_name || !driver_mobile || !transport || !invoices?.length) {
    return res.status(400).json({ error: 'All fields required with at least one invoice' });
  }
  const result = db.prepare('INSERT INTO vehicles (vehicle_no, driver_name, driver_mobile, transport) VALUES (?, ?, ?, ?)').run(
    vehicle_no, driver_name, driver_mobile, transport
  );
  const vid = result.lastInsertRowid;
  const insertInv = db.prepare('INSERT INTO vehicle_invoices (vehicle_id, invoice_no) VALUES (?, ?)');
  for (const inv of invoices) {
    insertInv.run(vid, inv.invoice_no);
  }
  logActivity('inbound', 'vehicle_entry', `Vehicle ${vehicle_no} entered with ${invoices.length} invoices`, req.user.name);
  res.json({ id: vid, message: 'Vehicle entry saved' });
});

app.get('/api/vehicles', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  const vehicles = db.prepare(`
    SELECT v.*, 
      (SELECT GROUP_CONCAT(vi.invoice_no, ', ') FROM vehicle_invoices vi WHERE vi.vehicle_id = v.id) as invoice_list
    FROM vehicles v ORDER BY v.id DESC
  `).all();
  res.json(vehicles);
});

app.get('/api/vehicles/:id', authMiddleware, (req, res) => {
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!vehicle) return res.status(404).json({ error: 'Not found' });
  const invoices = db.prepare('SELECT * FROM vehicle_invoices WHERE vehicle_id = ?').all(req.params.id);
  const materials = db.prepare('SELECT * FROM inbound_materials WHERE vehicle_id = ?').all(req.params.id);
  res.json({ ...vehicle, invoices, materials });
});

// ===================== INBOUND MATERIALS =====================
app.post('/api/inbound/materials', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  const { vehicle_id, materials } = req.body;
  if (!vehicle_id || !materials?.length) return res.status(400).json({ error: 'Vehicle ID and materials required' });
  const insert = db.prepare('INSERT INTO inbound_materials (vehicle_id, invoice_no, material, ean, description, div, brand, qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const m of materials) {
    insert.run(vehicle_id, m.invoice_no, m.material, m.ean || '', m.description || '', m.div || '', m.brand || '', m.qty || 0);
  }
  db.prepare('UPDATE vehicles SET status = ? WHERE id = ?').run('material_entered', vehicle_id);
  logActivity('inbound', 'materials_entered', `Materials entered for vehicle ID: ${vehicle_id}`, req.user.name);
  res.json({ message: 'Materials saved, moved to unloading pending' });
});

app.get('/api/inbound/pending', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  const vehicles = db.prepare(`
    SELECT v.*, 
      (SELECT GROUP_CONCAT(vi.invoice_no, ', ') FROM vehicle_invoices vi WHERE vi.vehicle_id = v.id) as invoice_list
    FROM vehicles v WHERE v.status IN ('material_entered', 'pending') ORDER BY v.id DESC
  `).all();
  res.json(vehicles);
});

// ===================== UNLOAD PROCESS =====================
app.post('/api/inbound/unload', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  const { vehicle_id, invoice_no, scanned_materials } = req.body;
  if (!vehicle_id || !invoice_no || !scanned_materials?.length) return res.status(400).json({ error: 'All fields required' });

  const updateMat = db.prepare('UPDATE inbound_materials SET status = ? WHERE vehicle_id = ? AND invoice_no = ? AND material = ?');
  for (const sm of scanned_materials) {
    updateMat.run('unloaded', vehicle_id, invoice_no, sm.material);
  }

  // Check if all materials for this vehicle are unloaded
  const pending = db.prepare("SELECT COUNT(*) as c FROM inbound_materials WHERE vehicle_id = ? AND status = 'pending'").get(vehicle_id);
  if (pending.c === 0) {
    const grn_no = getNextNumber('GRN');
    db.prepare('INSERT INTO grn_records (grn_no, vehicle_id) VALUES (?, ?)').run(grn_no, vehicle_id);
    db.prepare('UPDATE vehicles SET status = ? WHERE id = ?').run('unloaded', vehicle_id);
    logActivity('inbound', 'unload_complete', `Vehicle ID: ${vehicle_id} unloaded, GRN: ${grn_no}`, req.user.name);
    res.json({ message: 'All invoices scanned, GRN created', grn_no });
  } else {
    db.prepare('UPDATE vehicles SET status = ? WHERE id = ?').run('unloading', vehicle_id);
    logActivity('inbound', 'unload_partial', `Partial unload for vehicle ID: ${vehicle_id}, invoice: ${invoice_no}`, req.user.name);
    res.json({ message: 'Invoice scanned, more invoices pending' });
  }
});

// ===================== GRN ROUTES =====================
app.get('/api/grn', authMiddleware, (req, res) => {
  const grns = db.prepare(`
    SELECT gr.*, v.vehicle_no, v.driver_name,
      (SELECT GROUP_CONCAT(vi.invoice_no, ', ') FROM vehicle_invoices vi WHERE vi.vehicle_id = gr.vehicle_id) as invoice_list
    FROM grn_records gr JOIN vehicles v ON gr.vehicle_id = v.id ORDER BY gr.id DESC
  `).all();
  res.json(grns);
});

app.get('/api/grn/:grn_no', authMiddleware, (req, res) => {
  const grn = db.prepare('SELECT * FROM grn_records WHERE grn_no = ?').get(req.params.grn_no);
  if (!grn) return res.status(404).json({ error: 'GRN not found' });
  const materials = db.prepare('SELECT * FROM inbound_materials WHERE vehicle_id = ?').all(grn.vehicle_id);
  const invoices = db.prepare('SELECT DISTINCT invoice_no FROM inbound_materials WHERE vehicle_id = ?').all(grn.vehicle_id).map(i => i.invoice_no);
  res.json({ ...grn, materials, invoices });
});

// ===================== PUTAWAY ROUTES =====================
app.post('/api/putaway', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'putaway')) return res.status(403).json({ error: 'No access' });
  const { grn_no, invoice_no, items } = req.body;
  if (!grn_no || !invoice_no || !items?.length) return res.status(400).json({ error: 'All fields required' });

  const insert = db.prepare(`INSERT INTO putaway_records (grn_no, invoice_no, material, ean, description, div, brand, inbound_qty, putaway_qty, short_qty, rack, created_by) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertLoc = db.prepare(`INSERT INTO location_data (source, grn_no, invoice_no, date, rack, ean, material, description, qty, packing, box_no) 
    VALUES ('putaway', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  for (const item of items) {
    insert.run(grn_no, invoice_no, item.material, item.ean || '', item.description || '', item.div || '', item.brand || '',
      item.inbound_qty || 0, item.putaway_qty || 0, item.short_qty || 0, item.rack || '', req.user.name);

    // Dedup check for location_data
    const today = new Date().toISOString().split('T')[0];
    const existing = db.prepare(`SELECT id FROM location_data WHERE source='putaway' AND date=? AND rack=? AND material=? AND qty=? AND active=1`)
      .get(today, item.rack || '', item.material, item.putaway_qty || 0);
    if (!existing) {
      insertLoc.run(grn_no, invoice_no, today, item.rack || '', item.ean || '', item.material, item.description || '', item.putaway_qty || 0, '', '');
    }
  }

  logActivity('putaway', 'putaway_done', `Putaway for GRN: ${grn_no}, Invoice: ${invoice_no}`, req.user.name);
  res.json({ message: 'Putaway saved' });
});

app.get('/api/putaway/difference/:grn_no', authMiddleware, (req, res) => {
  const grn = db.prepare('SELECT * FROM grn_records WHERE grn_no = ?').get(req.params.grn_no);
  if (!grn) return res.status(404).json({ error: 'GRN not found' });
  const inbound = db.prepare('SELECT * FROM inbound_materials WHERE vehicle_id = ?').all(grn.vehicle_id);
  const putaway = db.prepare('SELECT * FROM putaway_records WHERE grn_no = ?').all(req.params.grn_no);

  const diff = [];
  for (const ib of inbound) {
    const pa = putaway.filter(p => p.invoice_no === ib.invoice_no && p.material === ib.material);
    const paQty = pa.reduce((s, p) => s + p.putaway_qty, 0);
    const shortQty = pa.reduce((s, p) => s + p.short_qty, 0);
    diff.push({
      invoice_no: ib.invoice_no,
      material: ib.material,
      description: ib.description,
      ean: ib.ean,
      inbound_qty: ib.qty,
      putaway_qty: paQty,
      difference: ib.qty - paQty,
      short_qty: shortQty
    });
  }
  res.json(diff);
});

// ===================== PIV ROUTES =====================
app.post('/api/piv', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'piv')) return res.status(403).json({ error: 'No access' });
  const { piv_by, items } = req.body;
  if (!piv_by || !items?.length) return res.status(400).json({ error: 'PIV by and items required' });

  const insertPiv = db.prepare('INSERT INTO piv_records (piv_by, date, rack, ean, material, description, qty, packing, box_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertLoc = db.prepare('INSERT INTO location_data (source, date, rack, ean, material, description, qty, packing, box_no) VALUES (\'piv\', ?, ?, ?, ?, ?, ?, ?, ?)');
  const deactivateOld = db.prepare('UPDATE location_data SET active = 0 WHERE source = \'piv\' AND rack = ? AND active = 1');

  for (const item of items) {
    insertPiv.run(piv_by, item.date || new Date().toISOString().split('T')[0], item.rack, item.ean || '', item.material, item.description || '', item.qty || 0, item.packing || '', item.box_no || '');

    // Deactivate old PIV data for same rack
    deactivateOld.run(item.rack);

    // Dedup check
    const today = item.date || new Date().toISOString().split('T')[0];
    const existing = db.prepare(`SELECT id FROM location_data WHERE source='piv' AND date=? AND rack=? AND material=? AND qty=? AND active=1`)
      .get(today, item.rack, item.material, item.qty || 0);
    if (!existing) {
      insertLoc.run(today, item.rack, item.ean || '', item.material, item.description || '', item.qty || 0, item.packing || '', item.box_no || '');
    }
  }

  logActivity('piv', 'piv_done', `PIV by ${piv_by}, ${items.length} items`, req.user.name);
  res.json({ message: 'PIV saved' });
});

app.get('/api/piv', authMiddleware, (req, res) => {
  const records = db.prepare('SELECT * FROM piv_records ORDER BY id DESC LIMIT 500').all();
  res.json(records);
});

// ===================== LOCATION ROUTES =====================
app.get('/api/location', authMiddleware, (req, res) => {
  const data = db.prepare('SELECT * FROM location_data WHERE active = 1 ORDER BY id DESC').all();
  res.json(data);
});

app.get('/api/location/search', authMiddleware, (req, res) => {
  const materials = req.query.materials;
  if (!materials) return res.status(400).json({ error: 'Materials parameter required' });
  const matList = materials.split(',').map(m => m.trim());
  const placeholders = matList.map(() => '?').join(',');
  const data = db.prepare(`SELECT * FROM location_data WHERE active = 1 AND material IN (${placeholders}) ORDER BY rack`).all(...matList);
  res.json(data);
});

app.post('/api/location/report', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'location')) return res.status(403).json({ error: 'No access' });
  const { picker_name, materials, location_ids } = req.body;
  if (!picker_name || !location_ids?.length) return res.status(400).json({ error: 'Picker name and location IDs required' });

  const ho_no = getNextNumber('HO');
  db.prepare('INSERT INTO location_reports (ho_no, picker_name, materials) VALUES (?, ?, ?)').run(ho_no, picker_name, materials || '');

  const insertItem = db.prepare('INSERT INTO location_report_items (report_id, location_data_id, action) VALUES (?, ?, ?)');
  for (const lid of location_ids) {
    insertItem.run(db.prepare('SELECT last_insert_rowid() as id').get().id, lid, 'none');
  }
  // Fix: get report id properly
  const report = db.prepare('SELECT id FROM location_reports WHERE ho_no = ?').get(ho_no);
  db.prepare('DELETE FROM location_report_items WHERE report_id = ?', report.id); // clean up bad inserts
  for (const lid of location_ids) {
    insertItem.run(report.id, lid, 'none');
  }

  logActivity('location', 'report_created', `HO: ${ho_no}, Picker: ${picker_name}`, req.user.name);
  res.json({ ho_no, message: 'Location report created' });
});

app.get('/api/location/report/:ho_no', authMiddleware, (req, res) => {
  const report = db.prepare('SELECT * FROM location_reports WHERE ho_no = ?').get(req.params.ho_no);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const items = db.prepare(`
    SELECT lri.id as report_item_id, lri.action, ld.*
    FROM location_report_items lri
    JOIN location_data ld ON lri.location_data_id = ld.id
    WHERE lri.report_id = ?
  `).all(report.id);
  res.json({ ...report, items });
});

app.put('/api/location/report/:ho_no/item/:item_id', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'location')) return res.status(403).json({ error: 'No access' });
  const { action, qty } = req.body; // action: 'delete' or 'minus'
  const reportItem = db.prepare(`
    SELECT lri.*, ld.* 
    FROM location_report_items lri 
    JOIN location_data ld ON lri.location_data_id = ld.id 
    WHERE lri.id = ?
  `).get(req.params.item_id);

  if (!reportItem) return res.status(404).json({ error: 'Item not found' });

  if (action === 'delete') {
    db.prepare('UPDATE location_data SET active = 0 WHERE id = ?').run(reportItem.location_data_id);
    db.prepare('UPDATE location_report_items SET action = ? WHERE id = ?').run('deleted', req.params.item_id);
    db.prepare('INSERT INTO location_audit (ho_no, action, location_data_id, rack, ean, material, description, qty, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.params.ho_no, 'delete', reportItem.location_data_id, reportItem.rack, reportItem.ean, reportItem.material, reportItem.description, reportItem.qty, req.user.name);
    logActivity('location', 'item_deleted', `HO: ${req.params.ho_no}, Material: ${reportItem.material}`, req.user.name);
  } else if (action === 'minus') {
    const minusQty = qty || reportItem.qty;
    const newQty = Math.max(0, reportItem.qty - minusQty);
    if (newQty === 0) {
      db.prepare('UPDATE location_data SET active = 0 WHERE id = ?').run(reportItem.location_data_id);
    } else {
      db.prepare('UPDATE location_data SET qty = ? WHERE id = ?').run(newQty, reportItem.location_data_id);
    }
    db.prepare('UPDATE location_report_items SET action = ? WHERE id = ?').run('minus', req.params.item_id);
    db.prepare('INSERT INTO location_audit (ho_no, action, location_data_id, rack, ean, material, description, qty, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.params.ho_no, 'minus', reportItem.location_data_id, reportItem.rack, reportItem.ean, reportItem.material, reportItem.description, minusQty, req.user.name);
    logActivity('location', 'item_minus', `HO: ${req.params.ho_no}, Material: ${reportItem.material}, Qty: -${minusQty}`, req.user.name);
  }

  res.json({ message: `Action ${action} performed` });
});

app.get('/api/location/audit', authMiddleware, (req, res) => {
  const audit = db.prepare('SELECT * FROM location_audit ORDER BY id DESC').all();
  res.json(audit);
});

// ===================== MATERIAL MASTER =====================
app.get('/api/materials', authMiddleware, (req, res) => {
  const search = req.query.search;
  if (search) {
    const materials = db.prepare(`SELECT * FROM material_master WHERE material LIKE ? OR description LIKE ? OR ean LIKE ? ORDER BY id DESC`)
      .all(`%${search}%`, `%${search}%`, `%${search}%`);
    res.json(materials);
  } else {
    const materials = db.prepare('SELECT * FROM material_master ORDER BY id DESC').all();
    res.json(materials);
  }
});

app.post('/api/materials/bulk', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'material')) return res.status(403).json({ error: 'No access' });
  const { materials } = req.body;
  if (!materials?.length) return res.status(400).json({ error: 'Materials array required' });
  const insert = db.prepare('INSERT OR IGNORE INTO material_master (material, description, div, ean, brand) VALUES (?, ?, ?, ?, ?)');
  let count = 0;
  for (const m of materials) {
    const result = insert.run(m.material, m.description || '', m.div || '', m.ean || '', m.brand || '');
    if (result.changes > 0) count++;
  }
  logActivity('material', 'bulk_add', `Added ${count} materials`, req.user.name);
  res.json({ message: `${count} materials added` });
});

app.post('/api/materials/single', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'material')) return res.status(403).json({ error: 'No access' });
  const { material, description, div, ean, brand } = req.body;
  if (!material) return res.status(400).json({ error: 'Material code required' });
  db.prepare('INSERT OR IGNORE INTO material_master (material, description, div, ean, brand) VALUES (?, ?, ?, ?, ?)')
    .run(material, description || '', div || '', ean || '', brand || '');
  logActivity('material', 'add_single', `Added material: ${material}`, req.user.name);
  res.json({ message: 'Material added' });
});

app.get('/api/materials/lookup/:ean', authMiddleware, (req, res) => {
  const mat = db.prepare('SELECT * FROM material_master WHERE ean = ? OR material = ?').get(req.params.ean, req.params.ean);
  res.json(mat || null);
});

// ===================== BIN MANAGEMENT =====================
app.get('/api/bins', authMiddleware, (req, res) => {
  const bins = db.prepare('SELECT * FROM bins ORDER BY rack, bin').all();
  res.json(bins);
});

app.post('/api/bins/bulk', authMiddleware, (req, res) => {
  if (!hasAccess(req.user, 'bin')) return res.status(403).json({ error: 'No access' });
  const { bins } = req.body;
  if (!bins?.length) return res.status(400).json({ error: 'Bins array required' });
  const insert = db.prepare('INSERT OR IGNORE INTO bins (rack, bin, capacity) VALUES (?, ?, ?)');
  let count = 0;
  for (const b of bins) {
    const result = insert.run(b.rack, b.bin, b.capacity || 0);
    if (result.changes > 0) count++;
  }
  logActivity('bin', 'bulk_add', `Added ${count} bins`, req.user.name);
  res.json({ message: `${count} bins added` });
});

app.get('/api/bins/search/:material', authMiddleware, (req, res) => {
  const mat = req.params.material;
  const locations = db.prepare(`SELECT * FROM location_data WHERE active = 1 AND material = ? ORDER BY rack`).all(mat);
  const putawayHistory = db.prepare(`SELECT grn_no, rack, putaway_qty, created_at FROM putaway_records WHERE material = ? ORDER BY created_at DESC LIMIT 20`).all(mat);
  const pivHistory = db.prepare(`SELECT rack, qty, created_at FROM piv_records WHERE material = ? ORDER BY created_at DESC LIMIT 20`).all(mat);
  res.json({ locations, putawayHistory, pivHistory });
});

// ===================== LIVE ACTION =====================
app.get('/api/live-actions', authMiddleware, (req, res) => {
  const actions = db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 100').all();
  res.json(actions);
});

// ===================== DASHBOARD =====================
app.get('/api/dashboard/stats', authMiddleware, (req, res) => {
  const pendingVehicles = db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE status IN ('pending', 'material_entered')").get().c;
  const unloadingVehicles = db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE status = 'unloading'").get().c;
  const totalGRN = db.prepare("SELECT COUNT(*) as c FROM grn_records").get().c;
  const totalPutaway = db.prepare("SELECT COUNT(*) as c FROM putaway_records").get().c;
  const totalPIV = db.prepare("SELECT COUNT(*) as c FROM piv_records").get().c;
  const totalMaterials = db.prepare("SELECT COUNT(*) as c FROM material_master").get().c;
  const totalBins = db.prepare("SELECT COUNT(*) as c FROM bins").get().c;
  const filledBins = db.prepare("SELECT COUNT(*) as c FROM bins WHERE status = 'filled'").get().c;
  const activeLocations = db.prepare("SELECT COUNT(*) as c FROM location_data WHERE active = 1").get().c;
  res.json({ pendingVehicles, unloadingVehicles, totalGRN, totalPutaway, totalPIV, totalMaterials, totalBins, filledBins, activeLocations });
});

// ===================== CATCH ALL =====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// Create default admin if not exists
const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (!adminExists) {
  db.prepare("INSERT INTO users (username, password, name, role, access) VALUES (?, ?, ?, ?, ?)").run(
    'admin', bcrypt.hashSync('admin123', 10), 'Admin', 'admin', JSON.stringify(['admin','inbound','putaway','piv','location','material','bin'])
  );
  console.log('Default admin created: username=admin, password=admin123');
}
// ===================== START SERVER =====================
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║   VIP Industry (MD20) - WMS Server           ║`);
  console.log(`║   Running on: http://localhost:${PORT}            ║`);
  console.log(`║   Developed by: Nikhil Patil                  ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
});