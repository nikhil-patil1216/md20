const express = require('express');
const { createClient } = require('@libsql/client');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'vip_md20_secret_2024';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

var db = null;

async function dbRun(sql, params) {
  params = params || [];
  await db.execute({ sql: sql, args: params });
  try { var r = await db.execute("SELECT last_insert_rowid() as id"); return { changes: 1, lastInsertRowid: r.rows[0].id }; }
  catch (e) { return { changes: 1, lastInsertRowid: 0 }; }
}

async function dbGet(sql, params) {
  params = params || [];
  try { var r = await db.execute({ sql: sql, args: params }); return r.rows.length > 0 ? r.rows[0] : undefined; }
  catch (e) { return undefined; }
}

async function dbAll(sql, params) {
  params = params || [];
  try { var r = await db.execute({ sql: sql, args: params }); return r.rows; }
  catch (e) { return []; }
}

var TABLES = "CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,name TEXT NOT NULL,role TEXT DEFAULT 'user',access TEXT DEFAULT '[]',active INTEGER DEFAULT 1,created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS vehicles(id INTEGER PRIMARY KEY AUTOINCREMENT,vehicle_no TEXT NOT NULL,driver_name TEXT NOT NULL,driver_mobile TEXT NOT NULL,transport TEXT NOT NULL,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS vehicle_invoices(id INTEGER PRIMARY KEY AUTOINCREMENT,vehicle_id INTEGER NOT NULL,invoice_no TEXT NOT NULL);CREATE TABLE IF NOT EXISTS inbound_materials(id INTEGER PRIMARY KEY AUTOINCREMENT,vehicle_id INTEGER NOT NULL,invoice_no TEXT NOT NULL,material TEXT NOT NULL,ean TEXT DEFAULT '',description TEXT DEFAULT '',div TEXT DEFAULT '',brand TEXT DEFAULT '',qty REAL NOT NULL DEFAULT 0,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS grn_records(id INTEGER PRIMARY KEY AUTOINCREMENT,grn_no TEXT UNIQUE NOT NULL,vehicle_id INTEGER NOT NULL,status TEXT DEFAULT 'active',created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS putaway_records(id INTEGER PRIMARY KEY AUTOINCREMENT,grn_no TEXT NOT NULL,invoice_no TEXT NOT NULL,material TEXT NOT NULL,ean TEXT DEFAULT '',description TEXT DEFAULT '',div TEXT DEFAULT '',brand TEXT DEFAULT '',inbound_qty REAL DEFAULT 0,putaway_qty REAL DEFAULT 0,short_qty REAL DEFAULT 0,rack TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')),created_by TEXT DEFAULT '');CREATE TABLE IF NOT EXISTS piv_records(id INTEGER PRIMARY KEY AUTOINCREMENT,piv_by TEXT NOT NULL,date TEXT NOT NULL,rack TEXT NOT NULL,ean TEXT DEFAULT '',material TEXT NOT NULL,description TEXT DEFAULT '',qty REAL DEFAULT 0,packing TEXT DEFAULT '',box_no TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS location_data(id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL,grn_no TEXT DEFAULT '',invoice_no TEXT DEFAULT '',date TEXT NOT NULL,rack TEXT NOT NULL,ean TEXT DEFAULT '',material TEXT NOT NULL,description TEXT DEFAULT '',qty REAL DEFAULT 0,packing TEXT DEFAULT '',box_no TEXT DEFAULT '',active INTEGER DEFAULT 1,created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS material_master(id INTEGER PRIMARY KEY AUTOINCREMENT,material TEXT NOT NULL,description TEXT DEFAULT '',div TEXT DEFAULT '',ean TEXT DEFAULT '',brand TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS bins(id INTEGER PRIMARY KEY AUTOINCREMENT,rack TEXT NOT NULL,bin TEXT NOT NULL,capacity REAL DEFAULT 0,current_qty REAL DEFAULT 0,status TEXT DEFAULT 'empty',created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS sequences(name TEXT PRIMARY KEY,last_value INTEGER DEFAULT 0,date TEXT DEFAULT '');CREATE TABLE IF NOT EXISTS location_reports(id INTEGER PRIMARY KEY AUTOINCREMENT,ho_no TEXT UNIQUE NOT NULL,picker_name TEXT NOT NULL,materials TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS location_report_items(id INTEGER PRIMARY KEY AUTOINCREMENT,report_id INTEGER NOT NULL,location_data_id INTEGER NOT NULL,action TEXT DEFAULT 'none');CREATE TABLE IF NOT EXISTS location_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,ho_no TEXT DEFAULT '',action TEXT NOT NULL,location_data_id INTEGER DEFAULT 0,rack TEXT DEFAULT '',ean TEXT DEFAULT '',material TEXT DEFAULT '',description TEXT DEFAULT '',qty REAL DEFAULT 0,performed_by TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));CREATE TABLE IF NOT EXISTS activity_log(id INTEGER PRIMARY KEY AUTOINCREMENT,module TEXT NOT NULL,action TEXT NOT NULL,details TEXT DEFAULT '',user TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now','localtime')));";

async function getNextNumber(prefix) {
  var today = new Date().toISOString().split('T')[0];
  var ds = today.replace(/-/g, '');
  var row = await dbGet('SELECT * FROM sequences WHERE name = ?', [prefix]);
  if (!row || row.date !== today) { await dbRun('INSERT OR REPLACE INTO sequences (name, last_value, date) VALUES (?, 1, ?)', [prefix, today]); return prefix + ds + '0001'; }
  var next = row.last_value + 1;
  await dbRun('UPDATE sequences SET last_value = ? WHERE name = ?', [next, prefix]);
  return prefix + ds + String(next).padStart(4, '0');
}

async function logAct(mod, act, det, usr) { await dbRun('INSERT INTO activity_log (module,action,details,user) VALUES (?,?,?,?)', [mod, act, det || '', usr || '']); }

function authMw(req, res, next) {
  var t = (req.headers.authorization || '').split(' ')[1];
  if (!t) return res.status(401).json({ error: 'Token required' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch (e) { res.status(401).json({ error: 'Invalid token' }); }
}

function hasAcc(u, m) { try { var a = JSON.parse(u.access || '[]'); return a.indexOf('admin') >= 0 || a.indexOf(m) >= 0; } catch(e) { return false; } }

// ===== AUTH =====
app.post('/api/auth/login', async function(req, res) {
  var u = req.body.username, p = req.body.password;
  if (!u || !p) return res.status(400).json({ error: 'Fill all fields' });
  var user = await dbGet('SELECT * FROM users WHERE username = ? AND active = 1', [u]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(p, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  var token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, access: user.access }, JWT_SECRET, { expiresIn: '24h' });
  await logAct('auth', 'login', user.name + ' logged in', user.name);
  res.json({ token: token, user: { id: user.id, username: user.username, name: user.name, role: user.role, access: user.access } });
});

app.post('/api/auth/change-password', authMw, async function(req, res) {
  var o = req.body.oldPassword, n = req.body.newPassword;
  var user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(o, user.password)) return res.status(400).json({ error: 'Old password wrong' });
  await dbRun('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(n, 10), req.user.id]);
  res.json({ message: 'Password changed' });
});

app.get('/api/auth/reset-admin', async function(req, res) {
  await dbRun("INSERT OR IGNORE INTO users (username,password,name,role,access,active) VALUES (?,?,?,?,?,?)", ['admin', bcrypt.hashSync('admin123', 10), 'Admin', 'admin', JSON.stringify(['admin','inbound','putaway','piv','location','material','bin']), 1]);
  res.send('<html><body style="font-family:Arial;padding:40px;text-align:center;"><h2 style="color:#008FD3;">Admin Reset Done!</h2><p><b>Username:</b> admin</p><p><b>Password:</b> admin123</p><p style="margin-top:20px;"><a href="/">Click here to Login</a></p></body></html>');
});
app.post('/api/auth/reset-admin', async function(req, res) { res.json({ message: 'Admin reset done' }); });

// ===== USERS =====
app.get('/api/users', authMw, async function(req, res) { if (!hasAcc(req.user, 'admin')) return res.status(403).json({ error: 'No access' }); res.json(await dbAll('SELECT id,username,name,role,access,active,created_at FROM users ORDER BY id')); });
app.post('/api/users', authMw, async function(req, res) {
  if (!hasAcc(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  var d = req.body;
  if (!d.username || !d.password || !d.name) return res.status(400).json({ error: 'All fields required' });
  if (await dbGet('SELECT id FROM users WHERE username = ?', [d.username])) return res.status(400).json({ error: 'Username exists' });
  await dbRun('INSERT INTO users (username,password,name,role,access) VALUES (?,?,?,?,?)', [d.username, bcrypt.hashSync(d.password, 10), d.name, d.role || 'user', JSON.stringify(d.access || [])]);
  res.json({ message: 'User created' });
});
app.put('/api/users/:id', authMw, async function(req, res) {
  if (!hasAcc(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  var d = req.body;
  if (d.password) { await dbRun('UPDATE users SET name=?,role=?,access=?,active=?,password=? WHERE id=?', [d.name, d.role, JSON.stringify(d.access || []), d.active ? 1 : 0, bcrypt.hashSync(d.password, 10), req.params.id]); }
  else { await dbRun('UPDATE users SET name=?,role=?,access=?,active=? WHERE id=?', [d.name, d.role, JSON.stringify(d.access || []), d.active ? 1 : 0, req.params.id]); }
  res.json({ message: 'User updated' });
});
app.delete('/api/users/:id', authMw, async function(req, res) {
  if (!hasAcc(req.user, 'admin')) return res.status(403).json({ error: 'No access' });
  if (req.user.id === parseInt(req.params.id)) return res.status(400).json({ error: 'Cannot delete yourself' });
  await dbRun('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ message: 'User deleted' });
});

// ===== VEHICLES =====
app.post('/api/vehicles', authMw, async function(req, res) {
  if (!hasAcc(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  var v = req.body;
  if (!v.vehicle_no || !v.driver_name || !v.driver_mobile || !v.transport || !v.invoices || !v.invoices.length) return res.status(400).json({ error: 'All fields required' });
  var r = await dbRun('INSERT INTO vehicles (vehicle_no,driver_name,driver_mobile,transport) VALUES (?,?,?,?)', [v.vehicle_no, v.driver_name, v.driver_mobile, v.transport]);
  var vid = r.lastInsertRowid;
  for (var i = 0; i < v.invoices.length; i++) { await dbRun('INSERT INTO vehicle_invoices (vehicle_id,invoice_no) VALUES (?,?)', [vid, v.invoices[i].invoice_no]); }
  await logAct('inbound', 'vehicle_entry', v.vehicle_no, req.user.name);
  res.json({ id: vid, message: 'Vehicle saved' });
});
app.get('/api/vehicles', authMw, async function(req, res) { if (!hasAcc(req.user, 'inbound')) return res.status(403).json({ error: 'No access' }); res.json(await dbAll('SELECT v.*, (SELECT GROUP_CONCAT(vi.invoice_no,", ") FROM vehicle_invoices vi WHERE vi.vehicle_id=v.id) as invoice_list FROM vehicles v ORDER BY v.id DESC')); });
app.get('/api/vehicles/:id', authMw, async function(req, res) {
  var v = await dbGet('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
  if (!v) return res.status(404).json({ error: 'Not found' });
  v.invoices = await dbAll('SELECT * FROM vehicle_invoices WHERE vehicle_id = ?', [v.id]);
  v.materials = await dbAll('SELECT * FROM inbound_materials WHERE vehicle_id = ?', [v.id]);
  res.json(v);
});

// ===== INBOUND MATERIALS =====
app.post('/api/inbound/materials', authMw, async function(req, res) {
  if (!hasAcc(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  var vid = req.body.vehicle_id, mats = req.body.materials;
  if (!vid || !mats || !mats.length) return res.status(400).json({ error: 'Required' });
  for (var i = 0; i < mats.length; i++) {
    var m = mats[i];
    await dbRun('INSERT INTO inbound_materials (vehicle_id,invoice_no,material,ean,description,div,brand,qty) VALUES (?,?,?,?,?,?,?,?)', [vid, m.invoice_no, m.material, m.ean||'', m.description||'', m.div||'', m.brand||'', m.qty||0]);
  }
  await dbRun('UPDATE vehicles SET status=? WHERE id=?', ['material_entered', vid]);
  await logAct('inbound', 'materials_entered', 'Vehicle ID: '+vid, req.user.name);
  res.json({ message: 'Materials saved' });
});
app.get('/api/inbound/pending', authMw, async function(req, res) { if (!hasAcc(req.user, 'inbound')) return res.status(403).json({ error: 'No access' }); res.json(await dbAll('SELECT v.*, (SELECT GROUP_CONCAT(vi.invoice_no,", ") FROM vehicle_invoices vi WHERE vi.vehicle_id=v.id) as invoice_list FROM vehicles v WHERE v.status IN ("material_entered","pending","unloading") ORDER BY v.id DESC')); });

// ===== UNLOAD =====
app.post('/api/inbound/unload', authMw, async function(req, res) {
  if (!hasAcc(req.user, 'inbound')) return res.status(403).json({ error: 'No access' });
  var vid = req.body.vehicle_id, inv = req.body.invoice_no, sm = req.body.scanned_materials;
  if (!vid || !inv || !sm || !sm.length) return res.status(400).json({ error: 'All fields required' });
  for (var i = 0; i < sm.length; i++) { await dbRun('UPDATE inbound_materials SET status=? WHERE vehicle_id=? AND invoice_no=? AND material=?', ['unloaded', vid, inv, sm[i].material]); }
  var p = await dbGet('SELECT COUNT(*) as c FROM inbound_materials WHERE vehicle_id=? AND status="pending"', [vid]);
  if (p.c === 0) {
    var gn = await getNextNumber('GRN');
    await dbRun('INSERT INTO grn_records (grn_no,vehicle_id) VALUES (?,?)', [gn, vid]);
    await dbRun('UPDATE vehicles SET status=? WHERE id=?', ['unloaded', vid]);
    await logAct('inbound', 'unload_complete', 'GRN: '+gn, req.user.name);
    res.json({ message: 'GRN created', grn_no: gn });
  } else {
    await dbRun('UPDATE vehicles SET status=? WHERE id=?', ['unloading', vid]);
    res.json({ message: 'More invoices pending' });
  }
});

// ===== GRN =====
app.get('/api/grn', authMw, async function(req, res) { res.json(await dbAll('SELECT gr.*,v.vehicle_no,v.driver_name,(SELECT GROUP_CONCAT(vi.invoice_no,", ") FROM vehicle_invoices vi WHERE vi.vehicle_id=gr.vehicle_id) as invoice_list FROM grn_records gr JOIN vehicles v ON gr.vehicle_id=v.id ORDER BY gr.id DESC')); });
app.get('/api/grn/:gn', authMw, async function(req, res) {
  var g = await dbGet('SELECT * FROM grn_records WHERE grn_no=?', [req.params.gn]);
  if (!g) return res.status(404).json({ error: 'GRN not found' });
  g.materials = await dbAll('SELECT * FROM inbound_materials WHERE vehicle_id=?', [g.vehicle_id]);
  var ir = await dbAll('SELECT DISTINCT invoice_no FROM inbound_materials WHERE vehicle_id=?', [g.vehicle_id]);
  g.invoices = ir.map(function(x) { return x.invoice_no; });
  res.json(g);
});

// ===== PUTAWAY =====
app.get('/api/putaway/remaining/:gn', authMw, async function(req, res) {
  var g = await dbGet('SELECT * FROM grn_records WHERE grn_no=?', [req.params.gn]);
  if (!g) return res.status(404).json({ error: 'GRN not found' });
  var ib = await dbAll('SELECT * FROM inbound_materials WHERE vehicle_id=?', [g.vehicle_id]);
  var pa = await dbAll('SELECT * FROM putaway_records WHERE grn_no=?', [req.params.gn]);
  var r = [];
  for (var i = 0; i < ib.length; i++) {
    var pQty = 0;
    for (var j = 0; j < pa.length; j++) { if (pa[j].invoice_no===ib[i].invoice_no && pa[j].material===ib[i].material) pQty += pa[j].putaway_qty; }
    r.push({ invoice_no: ib[i].invoice_no, material: ib[i].material, ean: ib[i].ean||'', description: ib[i].description||'', inbound_qty: ib[i].qty, putaway_qty: pQty, remaining_qty: ib[i].qty-pQty, completed: ib[i].qty-pQty<=0 });
  }
  res.json(r);
});
app.post('/api/putaway', authMw, async function(req, res) {
  if (!hasAcc(req.user, 'putaway')) return res.status(403).json({ error: 'No access' });
  var gn = req.body.grn_no, inv = req.body.invoice_no, items = req.body.items;
  if (!gn || !inv || !items || !items.length) return res.status(400).json({ error: 'All fields required' });
  var td = new Date().toISOString().split('T')[0];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    await dbRun('INSERT INTO putaway_records (grn_no,invoice_no,material,ean,description,div,brand,inbound_qty,putaway_qty,short_qty,rack,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [gn,inv,it.material,it.ean||'',it.description||'',it.div||'',it.brand||'',it.inbound_qty||0,it.putaway_qty||0,it.short_qty||0,it.rack||'',req.user.name]);
    var ex = await dbGet('SELECT id FROM location_data WHERE source="putaway" AND date=? AND rack=? AND material=? AND qty=? AND active=1', [td,it.rack||'',it.material,it.putaway_qty||0]);
    if (!ex) { await dbRun('INSERT INTO location_data (source,grn_no,invoice_no,date,rack,ean,material,description,qty,packing,box_no) VALUES ("putaway",?,?,?,?,?,?,?,?,?,?)', [gn,inv,td,it.rack||'',it.ean||'',it.material,it.description||'',it.putaway_qty||0,'','']); }
  }
  await logAct('putaway','putaway_done','GRN: '+gn, req.user.name);
  res.json({ message: 'Putaway saved' });
});
app.get('/api/putaway/difference/:gn', authMw, async function(req, res) {
  var g = await dbGet('SELECT * FROM grn_records WHERE grn_no=?', [req.params.gn]);
  if (!g) return res.status(404).json({ error: 'GRN not found' });
  var ib = await dbAll('SELECT * FROM inbound_materials WHERE vehicle_id=?', [g.vehicle_id]);
  var pa = await dbAll('SELECT * FROM putaway_records WHERE grn_no=?', [req.params.gn]);
  var diff = [];
  for (var i = 0; i < ib.length; i++) {
    var pq=0, sq=0;
    for (var j = 0; j < pa.length; j++) { if (pa[j].invoice_no===ib[i].invoice_no && pa[j].material===ib[i].material) { pq += pa[j].putaway_qty; sq += pa[j].short_qty; } }
    diff.push({ invoice_no: ib[i].invoice_no, material: ib[i].material, description: ib[i].description, ean: ib[i].ean, inbound_qty: ib[i].qty, putaway_qty: pq, difference: ib[i].qty-pq, short_qty: sq });
  }
  res.json(diff);
});

// ===== PIV =====
app.post('/api/piv', authMw, async function(req, res) {
  if (!hasAcc(req.user,'piv')) return res.status(403).json({ error:'No access' });
  var pb = req.body.piv_by, items = req.body.items;
  if (!pb || !items || !items.length) return res.status(400).json({ error:'PIV by and items required' });
  for (var i=0;i<items.length;i++) {
    var it=items[i], pd=it.date||new Date().toISOString().split('T')[0];
    await dbRun('INSERT INTO piv_records (piv_by,date,rack,ean,material,description,qty,packing,box_no) VALUES (?,?,?,?,?,?,?,?,?)', [pb,pd,it.rack,it.ean||'',it.material,it.description||'',it.qty||0,it.packing||'',it.box_no||'']);
    await dbRun('UPDATE location_data SET active=0 WHERE source="piv" AND rack=? AND active=1',[it.rack]);
    var ex=await dbGet('SELECT id FROM location_data WHERE source="piv" AND date=? AND rack=? AND material=? AND qty=? AND active=1',[pd,it.rack,it.material,it.qty||0]);
    if(!ex){await dbRun('INSERT INTO location_data (source,date,rack,ean,material,description,qty,packing,box_no) VALUES ("piv",?,?,?,?,?,?,?,?)',[pd,it.rack,it.ean||'',it.material,it.description||'',it.qty||0,it.packing||'',it.box_no||'']);}
  }
  await logAct('piv','piv_done','PIV by '+pb+', '+items.length+' items',req.user.name);
  res.json({ message:'PIV saved' });
});
app.get('/api/piv', authMw, async function(req,res){res.json(await dbAll('SELECT * FROM piv_records ORDER BY id DESC LIMIT 500'));});

// ===== LOCATION =====
app.get('/api/location', authMw, async function(req,res){
  var pg=parseInt(req.query.page)||1,lm=parseInt(req.query.limit)||200,off=(pg-1)*lm;
  var data=await dbAll('SELECT * FROM location_data WHERE active=1 ORDER BY id DESC LIMIT ? OFFSET ?',[lm,off]);
  var tot=await dbGet('SELECT COUNT(*) as c FROM location_data WHERE active=1');
  res.json({data:data,total:tot.c,page:pg,limit:lm,pages:Math.ceil(tot.c/lm)});
});
app.get('/api/location/search', authMw, async function(req,res){
  var mats=req.query.materials;if(!mats)return res.status(400).json({error:'Materials required'});
  var ml=mats.split(','),cl=[],ph=[],pr=[];
  for(var i=0;i<ml.length;i++){var m=ml[i].trim();if(m){cl.push(m);ph.push('?');pr.push(m);}}
  res.json(await dbAll('SELECT * FROM location_data WHERE active=1 AND material IN ('+ph.join(',')+') ORDER BY rack',pr));
});
app.post('/api/location/bulk',authMw,async function(req,res){
  if(!hasAcc(req.user,'location'))return res.status(403).json({error:'No access'});
  var items=req.body.items;if(!items||!items.length)return res.status(400).json({error:'Items required'});
  var td=new Date().toISOString().split('T')[0],cnt=0,bs=500;
  for(var b=0;b<items.length;b+=bs){
    var batch=items.slice(b,b+bs),vs=[],ps=[];
    for(var i=0;i<batch.length;i++){
      var it=batch[i];if(!it.rack||!it.material)continue;var qty=parseFloat(it.qty)||0;if(qty<=0)continue;
      vs.push('(?,?,?,?,?,?,?,?,?,?)');ps.push('manual',it.date||td,it.rack,it.ean||'',it.material,it.description||'',qty,it.packing||'',it.box_no||'',1);
    }
    if(vs.length===0)continue;
    try{await db.execute({sql:'INSERT INTO location_data (source,date,rack,ean,material,description,qty,packing,box_no,active) VALUES '+vs.join(','),args:ps});cnt+=vs.length;}catch(e){console.error('Batch err:',e.message);}
  }
  await logAct('location','bulk_add','Bulk added '+cnt+' items',req.user.name);
  res.json({message:cnt+' location items added'});
});
app.post('/api/location/report',authMw,async function(req,res){
  if(!hasAcc(req.user,'location'))return res.status(403).json({error:'No access'});
  var pn=req.body.picker_name, mats=req.body.materials,ids=req.body.location_ids;
  if(!pn||!ids||!ids.length)return res.status(400).json({error:'Picker name and IDs required'});
  var ho=await getNextNumber('HO');
  await dbRun('INSERT INTO location_reports (ho_no,picker_name,materials) VALUES (?,?,?)',[ho,pn,mats||'']);
  var rp=await dbGet('SELECT id FROM location_reports WHERE ho_no=?',[ho]);
  for(var i=0;i<ids.length;i++){await dbRun('INSERT INTO location_report_items (report_id,location_data_id,action) VALUES (?,?,?)',[rp.id,ids[i],'none']);}
  await logAct('location','report_created','HO: '+ho+' Picker: '+pn,req.user.name);
  res.json({ho_no:ho,message:'Report created'});
});
app.get('/api/location/report/:ho',authMw,async function(req,res){
  var rp=await dbGet('SELECT * FROM location_reports WHERE ho_no=?',[req.params.ho]);
  if(!rp)return res.status(404).json({error:'Not found'});
  rp.items=await dbAll('SELECT lri.id as report_item_id,lri.action,ld.* FROM location_report_items lri JOIN location_data ld ON lri.location_data_id=ld.id WHERE lri.report_id=?',[rp.id]);
  res.json(rp);
});
app.put('/api/location/report/:ho/item/:iid',authMw,async function(req,res){
  if(!hasAcc(req.user,'location'))return res.status(403).json({error:'No access'});
  var act=req.body.action,qty=req.body.qty;
  var ri=await dbGet('SELECT lri.*,ld.* FROM location_report_items lri JOIN location_data ld ON lri.location_data_id=ld.id WHERE lri.id=?',[req.params.iid]);
  if(!ri)return res.status(404).json({error:'Not found'});
  if(act==='delete'){
    await dbRun('UPDATE location_data SET active=0 WHERE id=?',[ri.location_data_id]);
    await dbRun('UPDATE location_report_items SET action=? WHERE id=?',['deleted',req.params.iid]);
    await dbRun('INSERT INTO location_audit (ho_no,action,location_data_id,rack,ean,material,description,qty,performed_by) VALUES (?,?,?,?,?,?,?,?,?)',[req.params.ho,'delete',ri.location_data_id,ri.rack,ri.ean,ri.material,ri.description,ri.qty,req.user.name]);
  }else if(act==='minus'){
    var mq=qty||ri.qty,nq=Math.max(0,ri.qty-mq);
    if(nq<=0){await dbRun('UPDATE location_data SET active=0 WHERE id=?',[ri.location_data_id]);}
    else{await dbRun('UPDATE location_data SET qty=? WHERE id=?',[nq,ri.location_data_id]);}
    await dbRun('UPDATE location_report_items SET action=? WHERE id=?',['minus',req.params.iid]);
    await dbRun('INSERT INTO location_audit (ho_no,action,location_data_id,rack,ean,material,description,qty,performed_by) VALUES (?,?,?,?,?,?,?,?,?)',[req.params.ho,'minus',ri.location_data_id,ri.rack,ri.ean,ri.material,ri.description,mq,req.user.name]);
  }
  res.json({message:'Action '+act+' done'});
});
app.get('/api/location/audit',authMw,async function(req,res){res.json(await dbAll('SELECT * FROM location_audit ORDER BY id DESC'));});
app.get('/api/location/reports',authMw,async function(req,res){res.json(await dbAll('SELECT * FROM location_reports ORDER BY id DESC'));});
app.post('/api/location/pick',authMw,async function(req,res){
  if(!hasAcc(req.user,'location'))return res.status(403).json({error:'No access'});
  var lid=req.body.location_id,pq=parseFloat(req.body.pick_qty)||0;
  if(!lid||pq<=0)return res.status(400).json({error:'ID and qty required'});
  var loc=await dbGet('SELECT * FROM location_data WHERE id=? AND active=1',[lid]);
  if(!loc)return res.status(404).json({error:'Not found'});
  if(pq>loc.qty)return res.status(400).json({error:'Cannot pick more than '+loc.qty});
  var nq=loc.qty-pq;
  if(nq<=0){await dbRun('UPDATE location_data SET active=0 WHERE id=?',[lid]);}
  else{await dbRun('UPDATE location_data SET qty=? WHERE id=?',[nq,lid]);}
  await dbRun('INSERT INTO location_audit (action,location_data_id,rack,ean,material,description,qty,performed_by) VALUES ("picked",?,?,?,?,?,?,?,?)',[lid,loc.rack,loc.ean,loc.material,loc.description,pq,req.user.name]);
  res.json({message:'Picked '+pq+' from '+loc.rack,remaining:nq});
});

// ===== MATERIALS =====
app.get('/api/materials',authMw,async function(req,res){
  var s=req.query.search;
  if(s)res.json(await dbAll('SELECT * FROM material_master WHERE material LIKE ? OR description LIKE ? OR ean LIKE ? ORDER BY id DESC',['%'+s+'%','%'+s+'%','%'+s+'%']));
  else res.json(await dbAll('SELECT * FROM material_master ORDER BY id DESC'));
});
app.post('/api/materials/bulk',authMw,async function(req,res){
  if(!hasAcc(req.user,'material'))return res.status(403).json({error:'No access'});
  var mats=req.body.materials;if(!mats||!mats.length)return res.status(400).json({error:'Required'});
  var cnt=0,bs=500;
  for(var b=0;b<mats.length;b+=bs){
    var batch=mats.slice(b,b+bs),vs=[],ps=[];
    for(var i=0;i<batch.length;i++){var m=batch[i];if(!m.material)continue;vs.push('(?,?,?,?,?,?)');ps.push(m.material,m.description||'',m.div||'',m.ean||'',m.brand||'');}
    if(vs.length===0)continue;
    try{await db.execute({sql:'INSERT OR IGNORE INTO material_master (material,description,div,ean,brand) VALUES '+vs.join(','),args:ps});cnt+=vs.length;}catch(e){}
  }
  res.json({message:cnt+' materials added'});
});
app.post('/api/materials/single',authMw,async function(req,res){
  if(!hasAcc(req.user,'material'))return res.status(403).json({error:'No access'});
  var m=req.body;if(!m.material)return res.status(400).json({error:'Material code required'});
  await dbRun('INSERT OR IGNORE INTO material_master (material,description,div,ean,brand) VALUES (?,?,?,?,?,?)',[m.material,m.description||'',m.div||'',m.ean||'',m.brand||'']);
  res.json({message:'Material added'});
});
app.get('/api/materials/lookup/:ean',authMw,async function(req,res){res.json(await dbGet('SELECT * FROM material_master WHERE ean=? OR material=?',[req.params.ean,req.params.ean])||null);});

// ===== BINS =====
app.get('/api/bins',authMw,async function(req,res){res.json(await dbAll('SELECT * FROM bins ORDER BY rack,bin'));});
app.post('/api/bins/bulk',authMw,async function(req,res){
  if(!hasAcc(req.user,'bin'))return res.status(403).json({error:'No access'});
  var bins=req.body.bins;if(!bins||!bins.length)return res.status(400).json({error:'Required'});
  var cnt=0,bs=500;
  for(var b=0;b<bins.length;b+=bs){
    var batch=bins.slice(b,b+bs),vs=[],ps=[];
    for(var i=0;i<batch.length;i++){var bi=batch[i];if(!bi.rack||!bi.bin)continue;vs.push('(?,?,?)');ps.push(bi.rack,bi.bin,bi.capacity||0);}
    if(vs.length===0)continue;
    try{await db.execute({sql:'INSERT OR IGNORE INTO bins (rack,bin,capacity) VALUES '+vs.join(','),args:ps});cnt+=vs.length;}catch(e){}
  }
  res.json({message:cnt+' bins added'});
});
app.get('/api/bins/search/:mat',authMw,async function(req,res){
  var m=req.params.mat;
  res.json({
    locations:await dbAll('SELECT * FROM location_data WHERE active=1 AND material=? ORDER BY rack',[m]),
    putawayHistory:await dbAll('SELECT grn_no,rack,putaway_qty,created_at FROM putaway_records WHERE material=? ORDER BY created_at DESC LIMIT 20',[m]),
    pivHistory:await dbAll('SELECT rack,qty,created_at FROM piv_records WHERE material=? ORDER BY created_at DESC LIMIT 20',[m])
  });
});

// ===== DASHBOARD & LIVE =====
app.get('/api/dashboard/stats',authMw,async function(req,res){
  var pv=await dbGet("SELECT COUNT(*) as c FROM vehicles WHERE status IN ('pending','material_entered')");
  var uv=await dbGet("SELECT COUNT(*) as c FROM vehicles WHERE status='unloading'");
  var grn=await dbGet("SELECT COUNT(*) as c FROM grn_records");
  var pa=await dbGet("SELECT COUNT(*) as c FROM putaway_records");
  var piv=await dbGet("SELECT COUNT(*) as c FROM piv_records");
  var mat=await dbGet("SELECT COUNT(*) as c FROM material_master");
  var tb=await dbGet("SELECT COUNT(*) as c FROM bins");
  var fb=await dbGet("SELECT COUNT(*) as c FROM bins WHERE status='filled'");
  var al=await dbGet("SELECT COUNT(*) as c FROM location_data WHERE active=1");
  res.json({pendingVehicles:pv.c,unloadingVehicles:uv.c,totalGRN:grn.c,totalPutaway:pa.c,totalPIV:piv.c,totalMaterials:mat.c,totalBins:tb.c,filledBins:fb.c,activeLocations:al.c});
});
app.get('/api/live-actions',authMw,async function(req,res){res.json(await dbAll('SELECT * FROM activity_log ORDER BY id DESC LIMIT 100'));});

// ===== CATCH ALL =====
app.get('*',function(req,res){res.sendFile(path.join(__dirname,'public','index.html'));});

// ===== START =====
async function startServer() {
  console.log('Connecting to Database...');
  try{
    var url=process.env.TURSO_DATABASE_URL||'',tk=process.env.TURSO_AUTH_TOKEN||undefined;
    if(url&&url.startsWith('libsql://'))db=createClient({url:url,authToken:tk});
    else db=createClient({url:'file:local.db'});
    var st=TABLES_SQL.split(';');
    for(var i=0;i<st.length;i++){
      var s=st[i].trim();
      if(s.length>10){
        try{await db.execute(s);}catch(e){}
      }
    }
    console.log('Database connected!');
  }catch(e){
    console.log('Cloud failed, using local...');
    db=createClient({url:'file:local.db'});
    var st2=TABLES_SQL.split(';');
    for(var j=0;j<st2.length;j++){
      var s2=st2[j].trim();
      if(s2.length>10){
        try{await db.execute(s2);}catch(e2){}
      }
    }
    console.log('Local DB ready.');
  }
  try{await dbRun("INSERT OR IGNORE INTO users (username,password,name,role,access,active) VALUES (?,?,?,?,?,?)",['admin',bcrypt.hashSync('admin123',10),'Admin','admin',JSON.stringify(['admin','inbound','putaway','piv','location','material','bin']),1]);}catch(e){}
  app.listen(PORT,function(){
    console.log('======================================================');
    console.log('   VIP Industry (MD20) - WMS Server');
    console.log('   http://localhost:'+PORT);
    console.log('   Developed by: Nikhil Patil');
    console.log('======================================================');
  });
}
startServer().catch(function(e){console.error('Start failed:',e);process.exit(1);});