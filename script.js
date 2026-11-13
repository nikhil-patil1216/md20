/* ============================================================
   VIP INDUSTRIES LIMITED MD20 — WMS COMPLETE SCRIPT
   Developed by Nikhil Patil
   ============================================================ */

// ==================== SUPABASE SYNC (BULLETPROOF DATA PERSISTENCE) ====================
var supabaseClient = null;
var _localWriteTs = {};
var MEMORY_DB = {}; 
var pushTimers = {};
var _isSyncing = false;
var _pendingPushes = {};

try {
    var SUPABASE_URL = 'https://whlqsapzywnadvkhfhzp.supabase.co'; // Supabase project URL
    var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobHFzYXB6eXduYWR2a2hmaHpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE4ODMsImV4cCI6MjEwMDczNzg4M30.YaNFKPQ9vmhKHYa0DtaZPbbM44IqgSlibPSABId_bno';
    
    if (typeof supabase !== 'undefined' && SUPABASE_URL.indexOf('supabase.co') > -1) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            realtime: { params: { eventsPerSecond: 10 } },
            auth: { persistSession: true, autoRefreshToken: true }
        });
        console.log('✅ Supabase client initialized');
    }
} catch(e) {
    console.warn('Supabase init error:', e);
}

var ALL_TABLES = ['users','location_master','material_master','rack_master','vehicles','invoices','invoice_materials','picking_reports','audit_log','notifications','difference_reports','obd_data','picking_assignments','loading_assignments','loading_data','user_sessions','grn_records','short_reports','unloading_records','loaded_vehicles','picking_done','loading_users','user_work_log','partial_unloads','location_locks','loading_approvals','short_excess_reports','location_requests'];

// ==================== SERVER-SIDE SEARCH ENGINE (60k+ rows safe) ====================
// Master data (material_master / location_master) browser memory me FULL load NAHI hota.
// Har search/scan direct Supabase par hota hai. SQL indexes zaroori hain (supabase_setup.sql).
var _sbCache = {};      // scan cache (table|field|value -> row) — repeat scan instant
var _sbCacheN = 0;
var _sbFullPullTs = {}; // sbPullFull TTL cache timestamps
var _stockCtx = null;   // picking stock-map cache
var _stockCtxTs = 0;

function _sbClean(q){ return String(q||'').replace(/[%_,()"\u2019']/g,' ').trim(); }

// Paginated server-side search: { search:'text', cols:['material','ean'], eq:{rack:'R1'}, limit:50, offset:0, order:'created_at' }
async function sbSearch(table, opts){
    if(!supabaseClient) return {rows:[],count:0};
    opts = opts || {};
    var limit = opts.limit || 50, offset = opts.offset || 0;
    var q = supabaseClient.from(table).select('data', { count:'exact' });
    if(opts.eq){ for(var f in opts.eq){ q = q.filter('data->>'+f,'eq',String(opts.eq[f])); } }
    if(opts.gt){ for(var g in opts.gt){ q = q.filter('data->>'+g,'gt',String(opts.gt[g])); } }
    if(opts.search && opts.cols && opts.cols.length){
        var s = _sbClean(opts.search);
        if(s){
            var parts=[];
            for(var i=0;i<opts.cols.length;i++) parts.push('data->>'+opts.cols[i]+'.ilike.%'+s+'%');
            q = q.or(parts.join(','));
        }
    }
    if(opts.order) q = q.order(opts.order, { ascending:false });
    var res = await q.range(offset, offset+limit-1);
    if(res.error){ console.warn('sbSearch ['+table+']:', res.error.message); return {rows:[],count:0}; }
    return { rows:(res.data||[]).map(function(r){ return r.data; }), count:res.count||0 };
}

// Exact lookup — scanning ke liye (case-insensitive, indexed, ~20-50ms)
async function sbFindOne(table, field, value){
    if(!supabaseClient || !value) return null;
    var ck = table+'|'+field+'|'+String(value).toLowerCase();
    if(_sbCache[ck]) return _sbCache[ck];
    var res = await supabaseClient.from(table).select('data').ilike('data->>'+field, _sbClean(value)).limit(1);
    if(res.error || !res.data || !res.data.length) return null;
    var row = res.data[0].data;
    _sbCache[ck]=row; _sbCacheN++;
    if(_sbCacheN>500){ _sbCache={}; _sbCacheN=0; }
    return row;
}

// Exact, case-insensitive lookup — '_' aur '%' wale material codes bhi sahi match hon (sbFindOne unhe space bana deta hai)
async function sbFindExactCI(table, field, value){
    if(!supabaseClient || !value) return null;
    var ck = table+'|X|'+field+'|'+String(value).toLowerCase();
    if(_sbCache[ck]) return _sbCache[ck];
    var pat = String(value).replace(/[\\%_]/g, function(c){ return '\\'+c; });
    var res = await supabaseClient.from(table).select('data').filter('data->>'+field, 'ilike', pat).limit(1);
    if(res.error || !res.data || !res.data.length) return null;
    var row = res.data[0].data;
    _sbCache[ck]=row; _sbCacheN++;
    if(_sbCacheN>500){ _sbCache={}; _sbCacheN=0; }
    return row;
}
// Scan/type me EAN ho ya Material (code/name) — khud pehchan kar Material Master se row deta hai.
// return: { row, by:'ean'|'material'|'description' } ya null
async function sbFindMaterialAny(value){
    var v = String(value||'').trim();
    if(!v) return null;
    var looksEan = /^\d{8,14}$/.test(v);            // sirf 8-14 digit = EAN jaisa, pehle EAN try
    var order = looksEan ? ['ean','material','description'] : ['material','ean','description'];
    for(var i=0;i<order.length;i++){
        var row = order[i]==='ean' ? await sbFindOne('material_master','ean',v) : await sbFindExactCI('material_master',order[i],v);
        if(row) return { row:row, by:order[i] };
    }
    return null;
}

// Sirf COUNT (KPI ke liye — rows download nahi hoti)
async function sbCount(table, eq){
    if(!supabaseClient) return 0;
    var q = supabaseClient.from(table).select('data', { count:'exact', head:true });
    if(eq){ for(var f in eq){ q = q.filter('data->>'+f,'eq',String(eq[f])); } }
    var res = await q;
    return res.error?0:(res.count||0);
}

// Row by id (edit ke liye)
async function sbGetById(table, id){
    if(!supabaseClient || !id) return null;
    var res = await supabaseClient.from(table).select('data').eq('id',id).limit(1);
    return (res.error||!res.data||!res.data.length) ? null : res.data[0].data;
}

// Direct server update (memory me row na ho tab bhi chalega)
async function sbUpdate(table, id, patch){
    if(!supabaseClient || !id) return null;
    var cur = await sbGetById(table,id); if(!cur) return null;
    for(var k in patch) cur[k]=patch[k];
    cur.updatedAt = new Date().toISOString();
    var res = await supabaseClient.from(table).update({ data:cur }).eq('id',id);
    if(res.error) console.warn('sbUpdate ['+table+']:', res.error.message);
    return res.error?null:cur;
}

// Direct server delete (memory me row na ho tab bhi chalega)
async function sbRemove(table, id){
    if(!supabaseClient || !id) return;
    try{
        var res = await supabaseClient.from(table).delete().eq('id',id);
        if(res.error) console.warn('sbRemove ['+table+']:', res.error.message);
    }catch(e){ console.warn('sbRemove catch:',e); }
}

// On-demand FULL pull — sirf Excel export / Reports / picking stock-map ke liye
// maxAgeMs do to cached re-pull skip hota hai (e.g. 120000 = 2 min)
async function sbPullFull(table, maxAgeMs){
    if(!supabaseClient) return;
    if(maxAgeMs && _sbFullPullTs[table] && (Date.now()-_sbFullPullTs[table])<maxAgeMs && MEMORY_DB[table] && MEMORY_DB[table].length) return;
    showLoader();
    try{
        var all=[], from=0, step=1000, go=true;
        while(go){
            var res = await supabaseClient.from(table).select('data').order('created_at',{ascending:false}).range(from, from+step-1);
            if(res.error){ console.warn('sbPullFull ['+table+']:',res.error.message); break; }
            (res.data||[]).forEach(function(r){ if(r.data) all.push(r.data); });
            go = res.data && res.data.length===step;
            from += step;
        }
        MEMORY_DB[table]=all;
        _localWriteTs[table]=Date.now();
        _sbFullPullTs[table]=Date.now();
    }catch(e){ console.warn('sbPullFull catch:',e); }
    hideLoader();
}

// Picking stock-map (EAN -> locations) — server pull + 60s cache
async function ensureStockCtx(){
    var TTL=60000;
    if(_stockCtx && (Date.now()-_stockCtxTs)<TTL) return _stockCtx;
    await sbPullFull('location_master');
    _stockCtx=makeAvailCtx();
    _stockCtxTs=Date.now();
    return _stockCtx;
}

// ==================== LIVE MASTER DATA (Supabase-only, no device storage) ====================
var LIVE_TABLES = ['material_master','location_master','rack_master'];
function isLiveTable(k){return LIVE_TABLES.indexOf(k)>-1;}
var _livePushTs = {};

// Row-level push queue — sirf NAYI/changed rows jaate hain, poori table kabhi nahi
var _pendingRows = {};
var _rowPushTimers = {};
function pushRows(key, rows) {
    if (!supabaseClient || !rows || !rows.length) return;
    if (!_pendingRows[key]) _pendingRows[key] = [];
    for (var i = 0; i < rows.length; i++) _pendingRows[key].push(rows[i]);
    _localWriteTs[key] = Date.now();
    clearTimeout(_rowPushTimers[key]);
    _rowPushTimers[key] = setTimeout(async function() { await flushPushRows(key); }, 500);
}
async function flushPushRows(key) {
    if (!supabaseClient) return;
    var rows = _pendingRows[key];
    if (!rows || !rows.length) { delete _pendingRows[key]; return; }
    _pendingRows[key] = [];
    var total = rows.length, CHUNK = 500, PARALLEL = 3;
    try {
        for (var i = 0; i < total; i += CHUNK * PARALLEL) {
            var batch = [];
            for (var p = 0; p < PARALLEL; p++) {
                var s = i + p * CHUNK;
                if (s >= total) break;
                var chunk = rows.slice(s, s + CHUNK).map(function(item) {
                    return { id: item.id || (Date.now().toString(36) + Math.random().toString(36).substr(2,6)), data: item, created_at: item.createdAt || new Date().toISOString() };
                });
                batch.push(supabaseClient.from(key).upsert(chunk, { onConflict: 'id' }));
            }
            var results = await Promise.all(batch);
            results.forEach(function(r) { if (r && r.error) console.warn('❌ Row push error [' + key + ']:', r.error.message); });
        }
        console.log('✅ Row push done:', key, '(' + total + ' rows)');
    } catch(e) {
        console.warn('❌ Row push catch [' + key + ']:', e.message || e);
    }
}
// Immediate Push with Retry
async function pushServer(key, val) {
    if (!supabaseClient || !Array.isArray(val)) return;
    
    _pendingPushes[key] = val; 
    
    clearTimeout(pushTimers[key]);
    pushTimers[key] = setTimeout(async function() {
        await flushPush(key);
    }, 500); // 500ms debounce
}

// Flush data to Supabase
async function flushPush(key) {
    if (!supabaseClient) return;
    var val = _pendingPushes[key];
    if (!val || !Array.isArray(val)) return;
    
    try {
        var chunkSize = 500;
        for (var i = 0; i < val.length; i += chunkSize) {
            var chunk = val.slice(i, i + chunkSize);
            var rows = chunk.map(function(item) {
                return { 
                    id: item.id || (Date.now().toString(36) + Math.random().toString(36).substr(2,6)), 
                    data: item,
                    created_at: new Date().toISOString()
                };
            });
            
            var res = await supabaseClient.from(key)
                .upsert(rows, { onConflict: 'id' });
                
            if (res.error) {
                console.warn('❌ Push Error [' + key + ']:', res.error.message);
            }
        }
        
        delete _pendingPushes[key];
        console.log('✅ Synced:', key, '(' + val.length + ' rows)');
    } catch(e) {
        console.warn('❌ Push Catch [' + key + ']:', e.message || e);
    }
}

// Flush all pending (Called before logout)
async function flushAllPendingPushes() {
    if (!supabaseClient) return;
    var keys = Object.keys(_pendingPushes);
    var rkeys = Object.keys(_pendingRows);
    console.log('🔄 Flushing', keys.length + rkeys.length, 'pending tables...');
    var promises = keys.map(function(k) { clearTimeout(pushTimers[k]); return flushPush(k); });
    var rpromises = rkeys.map(function(k) { clearTimeout(_rowPushTimers[k]); return flushPushRows(k); });
    await Promise.all(promises.concat(rpromises));
    console.log('✅ All pending data flushed');
}

// Delete from Supabase
async function deleteServerRow(key, id) {
    if (!supabaseClient || !id) return;
    try {
        var res = await supabaseClient.from(key).delete().eq('id', id);
        if (res.error) console.warn('Delete error [' + key + ']:', res.error.message);
    } catch(e) {
        console.warn('Delete catch:', e);
    }
}

// Pull all data
async function pullAll() {
    if (!supabaseClient) return false;
    _isSyncing = true;
    console.log('🔄 Starting data sync from Supabase...');
    try {
        // Master data ka purana device-cache hata do — ab sirf Supabase se active hoga
        LIVE_TABLES.forEach(function(t){ try { localStorage.removeItem('wms_' + t); } catch(e) {} });

        await Promise.all(ALL_TABLES.map(async function(t) {
            // MASTER TABLES (60k+ rows) — full pull BAND. Ye ab server-side search se chalte hain.
            if(t==='material_master'||t==='location_master'){
                if(!MEMORY_DB[t]) MEMORY_DB[t]=[];
                return;
            }
            try {
                var res = await supabaseClient.from(t).select('data');
                if (res.error) {
                    console.warn('⚠️ Table not accessible:', t, '—', res.error.message);
                    if (!MEMORY_DB[t]) {
                        if (isLiveTable(t)) MEMORY_DB[t] = [];
                        else { try { MEMORY_DB[t] = JSON.parse(localStorage.getItem('wms_' + t) || '[]'); } catch(e) { MEMORY_DB[t] = []; } }
                    }
                    return;
                }
                if (res.data && res.data.length > 0) {
                    var parsed = res.data.map(function(row) { return row.data; }).filter(function(d) { return d !== null; });
                    MEMORY_DB[t] = parsed;
                    if (isLiveTable(t)) { try { localStorage.removeItem('wms_' + t); } catch(e) {} }
                    else { try { localStorage.setItem('wms_' + t, JSON.stringify(parsed)); } catch(e) {} }
                } else {
                    if (!MEMORY_DB[t]) {
                        if (isLiveTable(t)) MEMORY_DB[t] = [];
                        else { try { MEMORY_DB[t] = JSON.parse(localStorage.getItem('wms_' + t) || '[]'); } catch(e) { MEMORY_DB[t] = []; } }
                    }
                }
            } catch(e) { console.warn('Pull error [' + t + ']:', e.message || e); }
        }));

        _isSyncing = false;
        console.log('✅ Data sync complete!');
        if (APP.currentUser && APP.currentSection) {
            renderSection(APP.currentSection, APP.currentSub);
            if (typeof updateNotifBadge === 'function') updateNotifBadge();
        }
        return true;
    } catch(e) {
        _isSyncing = false;
        console.warn('❌ pullAll error:', e);
        return false;
    }
}

// ==================== REALTIME ====================
var _rtRenderTimer = null;
function rtScheduleRender() {
    if (_rtRenderTimer) return;                 // sab events merge — max 1 render / 800ms
    _rtRenderTimer = setTimeout(function() {
        _rtRenderTimer = null;
        if (APP.currentUser && APP.currentSection && !_isSyncing) {
            renderSection(APP.currentSection, APP.currentSub);
            if (typeof updateNotifBadge === 'function') updateNotifBadge();
        }
    }, 800);
}
function rtApplyChange(tableName, p) {
    if (!tableName) return;
    if (!MEMORY_DB[tableName]) { pullLiveTable(tableName); return; }   // table abhi pull nahi hui — server se le aao
    if (_localWriteTs[tableName] && (Date.now() - _localWriteTs[tableName]) < 5000) return;  // apna hi echo — ignore
    if (p.eventType === 'DELETE' && p.old && p.old.id) {
        MEMORY_DB[tableName] = MEMORY_DB[tableName].filter(function(item) { return item.id !== p.old.id; });
    } else if (p.new && p.new.data) {
        var newItem = p.new.data, found = false;
        for (var j = 0; j < MEMORY_DB[tableName].length; j++) {
            if (MEMORY_DB[tableName][j].id === newItem.id) { MEMORY_DB[tableName][j] = newItem; found = true; break; }
        }
        if (!found) MEMORY_DB[tableName].push(newItem);
    } else return;
    if (!isLiveTable(tableName)) { try { localStorage.setItem('wms_' + tableName, JSON.stringify(MEMORY_DB[tableName])); } catch(e) {} }
    rtScheduleRender();
}
var _rtStarted = false;
function startRealtime() {
    if (!supabaseClient || _rtStarted) return;
    _rtStarted = true;
    ALL_TABLES.forEach(function(t) {
        try {
            supabaseClient.channel('rt-' + t)
            
                .on('postgres_changes', { event: '*', schema: 'public', table: t }, function(p) { rtApplyChange(t, p); })
                .subscribe();
        } catch(e) { console.warn('Realtime channel error [' + t + ']:', e); }
    });
    // Broadcast refresh — bulk upload ke baad sab clients table dobara pull karte hain
    try {
        window._refreshChannel = supabaseClient.channel('wms-refresh', { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 'refresh' }, function(msg) {
                var tbl = msg.payload && msg.payload.table;
                if (tbl && msg.payload.by !== (APP.currentUser ? APP.currentUser.name : '')) pullLiveTable(tbl);
            })
            .subscribe();
    } catch(e) { console.warn('Refresh channel error:', e); }
}
function broadcastRefresh(table) {
    if (!supabaseClient || !window._refreshChannel) return;
    try {
        window._refreshChannel.send({ type: 'broadcast', event: 'refresh', payload: { table: table, by: APP.currentUser ? APP.currentUser.name : 'System', at: new Date().toISOString() } });
    } catch(e) {}
}
async function pullLiveTable(t) {
    if (!supabaseClient) return;
    if(t==='material_master'||t==='location_master'){ rtScheduleRender(); return; } // server-driven screens — full pull nahi
    try {
        var res = await supabaseClient.from(t).select('data');
        if (!res.error && res.data) {
            MEMORY_DB[t] = res.data.map(function(row) { return row.data; }).filter(function(d) { return d !== null; });
            if (!isLiveTable(t)) { try { localStorage.setItem('wms_' + t, JSON.stringify(MEMORY_DB[t])); } catch(e) {} }
            _isSyncing = false;
            rtScheduleRender();
            if (APP.currentUser) showToast('Live update: ' + t.replace(/_/g, ' ') + ' refreshed from server', 'info');
        }
    } catch(e) { console.warn('pullLiveTable error [' + t + ']:', e); }
}
// ==================== STATE & DATABASE (MEMORY-FIRST) ====================
var APP = {
    currentUser: null, currentSection: 'dashboard', currentSub: null,
    theme: localStorage.getItem('wms_theme') || 'dark',
    sessionStart: null, SESSION_TIMEOUT: 30*60*1000,
    locPage:1, locPerPage:15, auditPage:1, auditPerPage:15, reportPage:1, reportPerPage:15, matPage:1, matPerPage:15,
    scanCallback: null, html5QrCode: null
};

var DB = {
    _k: function(k){return 'wms_'+k;},
    get: function(k){
        if(!MEMORY_DB[k]) {
            if (isLiveTable(k)) MEMORY_DB[k] = [];   // master data device se kabhi load nahi hota — sirf Supabase
            else { try { MEMORY_DB[k] = JSON.parse(localStorage.getItem(this._k(k))||'[]'); } catch(e) { MEMORY_DB[k] = []; } }
        }
        return MEMORY_DB[k];
    },
    getObj: function(k){
        if(!MEMORY_DB[k]) {
            try { MEMORY_DB[k] = JSON.parse(localStorage.getItem(this._k(k))||'{}'); }
            catch(e) { MEMORY_DB[k] = {}; }
        }
        return MEMORY_DB[k];
    },
    set: function(k, v) {
        var old = MEMORY_DB[k];
        MEMORY_DB[k] = v;
        _localWriteTs[k] = Date.now();
        if (isLiveTable(k)) {
            // LIVE table: no localStorage, no full-array push — sirf changed rows diff karke push
            var toPush = [];
            if (v.length <= 3000) {
                var oldMap = {};
                if (old && old.length) for (var i = 0; i < old.length; i++) oldMap[old[i].id] = JSON.stringify(old[i]);
                for (var j = 0; j < v.length; j++) {
                    var s = JSON.stringify(v[j]);
                    if (!oldMap[v[j].id] || oldMap[v[j].id] !== s) toPush.push(v[j]);
                }
            } else {
                // badi array (bulk) — timestamp diff, O(n) fast
                for (var j2 = 0; j2 < v.length; j2++) {
                    var ts = Date.parse(v[j2].updatedAt || v[j2].createdAt || 0) || 0;
                    if (ts > (_livePushTs[k] || 0)) toPush.push(v[j2]);
                }
                _livePushTs[k] = Date.now();
            }
            if (toPush.length) pushRows(k, toPush);
        } else {
            try {
                var str = JSON.stringify(v);
                if (str.length < 4500000) localStorage.setItem(this._k(k), str);
                else localStorage.removeItem(this._k(k));
            } catch(e) { console.warn('LocalStorage quota exceeded, using memory only'); }
            pushServer(k, v);
        }
    },
    add: function(k, item) {
        var d = this.get(k);
        item.id = item.id || this.uid();
        item.createdAt = item.createdAt || new Date().toISOString();
        d.push(item);
        if (isLiveTable(k)) { _localWriteTs[k] = Date.now(); pushRows(k, [item]); }
        else this.set(k, d);
        return item;
    },
    addBulk: function(k, rows) {
        if (!rows || !rows.length) return 0;
        var d = this.get(k);
        for (var i = 0; i < rows.length; i++) {
            rows[i].id = rows[i].id || this.uid();
            rows[i].createdAt = rows[i].createdAt || new Date().toISOString();
            d.push(rows[i]);
        }
        if (isLiveTable(k)) { _localWriteTs[k] = Date.now(); pushRows(k, rows); if(rows.length>2000){ MEMORY_DB[k]=[]; _stockCtxTs=0; } }
        else this.set(k, d);
        return rows.length;
    },
    update: function(k, id, up) {
        var d = this.get(k), idx = -1;
        for (var i = 0; i < d.length; i++) { if (d[i].id === id) { idx = i; break; } }
        if (idx > -1) {
            for (var key in up) { d[idx][key] = up[key]; }
            d[idx].updatedAt = new Date().toISOString();
            if (isLiveTable(k)) { MEMORY_DB[k] = d; _localWriteTs[k] = Date.now(); pushRows(k, [d[idx]]); }
            else this.set(k, d);
            return d[idx];
        }
        return null;
    },
    remove: function(k, id) {
        deleteServerRow(k, id);
        var filtered = this.get(k).filter(function(d) { return d.id !== id; });
        if (isLiveTable(k)) { MEMORY_DB[k] = filtered; _localWriteTs[k] = Date.now(); }
        else this.set(k, filtered);
    },
    find: function(k,id){return this.get(k).filter(function(d){return d.id===id;})[0]||null;},
    filter: function(k,fn){return this.get(k).filter(fn);},
    count: function(k,fn){return fn?this.get(k).filter(fn).length:this.get(k).length;},
    uid: function(){return Date.now().toString(36)+Math.random().toString(36).substr(2,6);},
    grnNo: function(inv){return 'GRN-'+(inv||'XXXX').replace(/\s/g,'').substring(0,20)+'-'+Date.now().toString(36).toUpperCase().substr(0,4);},
    shortNo: function(){return 'SRT-'+new Date().getFullYear()+'-'+String(this.count('short_reports')+1).padStart(4,'0');},
    loadNo: function(){return 'LOAD-'+Date.now().toString(36).toUpperCase().substr(0,8);},
    unloadNo: function(){return 'UNL-'+Date.now().toString(36).toUpperCase().substr(0,8);},
    obdNo: function(){return 'OBD-'+new Date().getFullYear()+'-'+String(this.count('obd_data')+1).padStart(4,'0');}
};
// ==================== UTILITIES ====================
function fmtDate(d){if(!d)return'-';var dt=new Date(d);return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}
function fmtDT(d){if(!d)return'-';var dt=new Date(d);return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+' '+dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});}
function today(){return new Date().toISOString().split('T')[0];}
function esc(s){if(s===null||s===undefined)return'';var d=document.createElement('div');d.textContent=String(s);return d.innerHTML;}
function paginate(arr,page,pp){var s=(page-1)*pp;return{items:arr.slice(s,s+pp),total:arr.length,pages:Math.ceil(arr.length/pp)||1};}
function renderPag(cur,tp,fn){
    if(tp<=1)return'';
    var h='<div class="pagination">';
    h+='<button class="page-btn" onclick="'+fn+'('+(cur-1)+')" '+(cur<=1?'disabled':'')+'><i class="bx bx-chevron-left"></i></button>';
    for(var i=1;i<=tp;i++){
        if(tp>7&&i>3&&i<tp-2&&Math.abs(i-cur)>1){if(i===4||i===tp-3)h+='<span style="color:var(--text-muted);padding:0 3px">...</span>';continue;}
        h+='<button class="page-btn '+(i===cur?'active':'')+'" onclick="'+fn+'('+i+')">'+i+'</button>';
    }
    h+='<button class="page-btn" onclick="'+fn+'('+(cur+1)+')" '+(cur>=tp?'disabled':'')+'><i class="bx bx-chevron-right"></i></button></div>';
    return h;
}
function timeDiff(start,end){
    if(!start||!end)return'0m';
    var ms=new Date(end)-new Date(start);
    var m=Math.floor(ms/60000);
    if(m<60)return m+'m';
    var h=Math.floor(m/60);var rm=m%60;
    return h+'h '+rm+'m';
}

// ==================== TOAST ====================
function showToast(msg,type){
    type=type||'info';
    var icons={success:'bx-check-circle',error:'bx-error-circle',warning:'bx-error',info:'bx-info-circle'};
    var c=document.getElementById('toastContainer');
    var t=document.createElement('div');
    t.className='toast '+type;
    t.innerHTML='<i class="bx '+(icons[type]||icons.info)+'"></i><span>'+esc(msg)+'</span>';
    c.appendChild(t);
    setTimeout(function(){t.classList.add('removing');setTimeout(function(){t.remove();},250);},3500);
}

// ==================== MODAL ====================
function showModal(title,body,size,footer){
    size=size||'';footer=footer||'';
    var o=document.getElementById('modalOverlay'),c=document.getElementById('modalContainer');
    c.className='modal-container'+(size?' modal-'+size:'');
    c.innerHTML='<div class="modal-header"><h3>'+title+'</h3><button class="modal-close" onclick="closeModal()"><i class="bx bx-x"></i></button></div><div class="modal-body">'+body+'</div>'+(footer?'<div class="modal-footer">'+footer+'</div>':'');
    o.classList.add('open');
}
function closeModal(){document.getElementById('modalOverlay').classList.remove('open');}
document.getElementById('modalOverlay').addEventListener('click',function(e){if(e.target===this)closeModal();});

// ==================== LOADER ====================
function showLoader(){document.getElementById('pageLoader').style.display='flex';}
function hideLoader(){document.getElementById('pageLoader').style.display='none';}

// ==================== AUDIT ====================
function logAction(mod,act,det){
    DB.add('audit_log',{module:mod,action:act,details:det,userId:APP.currentUser?APP.currentUser.id:'system',userName:APP.currentUser?APP.currentUser.name:'System',dateTime:new Date().toISOString()});
    logWorkTime(mod,act);
}
function logWorkTime(mod,act){
    if(!APP.currentUser)return;
    var logs=DB.get('user_work_log');
    logs.push({userId:APP.currentUser.id,userName:APP.currentUser.name,module:mod,action:act,dateTime:new Date().toISOString()});
    if(logs.length>5000)logs=logs.slice(-3000);
    DB.set('user_work_log',logs);
}

// ==================== NOTIFICATIONS ====================
function addNotif(msg,type,target,dataId,navSection){
    type=type||'info';
    var n=DB.get('notifications');
    n.unshift({id:DB.uid(),message:type,type:type,read:false,dateTime:new Date().toISOString(),targetUser:target||null,messageText:msg,dataId:dataId||null,navSection:navSection||null});
    if(n.length>100)n.length=100;
    DB.set('notifications',n);updateNotifBadge();
}
function updateNotifBadge(){
    var c=0;var n=DB.get('notifications');
    for(var i=0;i<n.length;i++){if(!n[i].read)c++;}
    var b=document.getElementById('notifBadge');b.textContent=c;b.style.display=c>0?'flex':'none';
}
function renderNotifPanel(){
    var list=document.getElementById('notifList');
    var n=DB.get('notifications');
    if(!n.length){list.innerHTML='<div class="notif-empty"><i class="bx bx-bell-off"></i><p>No notifications</p></div>';return;}

    var h='';
    var s=n.slice(0,30);
    for(var i=0;i<s.length;i++){
        var nt=s[i];
        var isApproval=(nt.messageText||'').indexOf('Approval')>-1;
        var isPLApproval=(nt.messageText||'').indexOf('P&L Approval')>-1;
        var hasDataId=nt.dataId&&nt.dataId.length>0;

        h+='<div class="notif-item '+(nt.read?'':'unread')+'" style="cursor:pointer;padding:12px;margin-bottom:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg-secondary);transition:all .15s" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border)\'">';

        // Top row: icon + message
        h+='<div style="display:flex;align-items:flex-start;gap:8px">';
        var iconMap={warning:'bx-error',success:'bx-check-circle',error:'bx-error-circle',info:'bx-info-circle'};
        var colorMap={warning:'var(--warning)',success:'var(--success)',error:'var(--danger)',info:'var(--info)'};
        h+='<i class="bx '+(iconMap[nt.type]||iconMap.info)+'" style="color:'+(colorMap[nt.type]||colorMap.info)+';font-size:18px;margin-top:2px;flex-shrink:0"></i>';
        h+='<div style="flex:1;min-width:0"><div style="font-size:12px;line-height:1.5;word-break:break-word">'+esc(nt.messageText||nt.message)+'</div>';
        h+='<div class="notif-time" style="margin-top:4px">'+fmtDT(nt.dateTime)+'</div>';
        h+='</div>';

        // Unread dot + delete button
        if(!nt.read)h+='<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:6px"></div>';
        h+='<button class="btn btn-danger btn-sm" title="Delete" style="width:26px;height:26px;padding:0;min-width:26px;flex-shrink:0;margin-left:6px" onclick="event.stopPropagation();deleteNotif(\''+nt.id+'\')"><i class="bx bx-trash" style="font-size:12px"></i></button>';
        h+='</div>';

        // Action buttons for approval notifications
        if(hasDataId&&nt.navSection==='locreq'){
            h+='<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"><button class="btn btn-glass btn-sm" style="width:100%;justify-content:center" onclick="event.stopPropagation();locNotifOpen(\''+nt.dataId+'\')"><i class="bx bx-map-pin"></i> Review / Assign Location</button></div>';
        }else if(hasDataId&&nt.navSection==='locreq-picker'){
            h+='<div style="margin-top:10px"><button class="btn btn-glass btn-sm" style="width:100%;justify-content:center" onclick="event.stopPropagation();pickerNotifOpen(\''+nt.dataId+'\')"><i class="bx bx-box"></i> Open Picking</button></div>';
        }else if(hasDataId&&(isApproval||isPLApproval)){
            h+='<div style="display:flex;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">';
            h+='<button class="btn btn-glass btn-sm" style="flex:1;justify-content:center;background:rgba(46,213,115,0.15);border-color:var(--success);color:var(--success);font-weight:600" onclick="event.stopPropagation();approveFromNotif(\''+nt.dataId+'\')"><i class="bx bx-check"></i> Approve</button>';
            h+='<button class="btn btn-glass btn-sm" style="flex:1;justify-content:center;background:rgba(255,71,87,0.15);border-color:var(--danger);color:var(--danger);font-weight:600" onclick="event.stopPropagation();rejectFromNotif(\''+nt.dataId+'\')"><i class="bx bx-x"></i> Reject</button>';
            h+='<button class="btn btn-glass btn-sm" style="justify-content:center" onclick="event.stopPropagation();viewFromNotif(\''+nt.dataId+'\')"><i class="bx bx-eye"></i></button>';
            h+='</div>';
        }else if(hasDataId){
            // Other clickable notifications
            h+='<div style="margin-top:8px"><button class="btn btn-glass btn-sm" style="width:100%;justify-content:center" onclick="event.stopPropagation();viewFromNotif(\''+nt.dataId+'\')"><i class="bx bx-eye"></i> View Details</button></div>';
        }

        h+='</div>';
    }

    list.innerHTML=h;

    // Mark all as read
    var all=DB.get('notifications');
    for(var j=0;j<all.length;j++){all[j].read=true;}
    DB.set('notifications',all);updateNotifBadge();
}

// ★ Approve directly from notification
function approveFromNotif(approvalId){
    if(!confirm('Approve this loading?'))return;
    var a=DB.find('loading_approvals',approvalId);
    if(!a){showToast('Approval record not found','error');return;}
    if(a.status!=='Pending'){showToast('Already processed: '+a.status,'warning');return;}

    DB.update('loading_approvals',approvalId,{status:'Approved',approvedBy:APP.currentUser?APP.currentUser.id:'',approvedByName:APP.currentUser?APP.currentUser.name:'',approvedAt:new Date().toISOString()});

    var obdIds=a.obdIds;if(!Array.isArray(obdIds))obdIds=[obdIds];
    var obdNos=a.obdNos;if(!Array.isArray(obdNos))obdNos=[obdNos];

    DB.add('loaded_vehicles',{loadNo:a.loadNo,vehicleNo:a.vehicleNo,securityNo:a.securityNo,obdIds:obdIds,obdNos:obdNos,loadedBy:a.requestedBy,loadedByName:a.requestedByName,loadedAt:new Date().toISOString(),lastScannedAt:new Date().toISOString(),scannedItems:a.scannedItems,loadStatus:'Fully Loaded',mismatch:true,approvedById:approvalId,type:a.type||''});

    var mis=[];(a.expected||[]).forEach(function(e){if(e.scannedQty!==e.requiredQty)mis.push({obdNo:e.obdNo,material:e.material,ean:e.ean,expectedQty:e.requiredQty,scannedQty:e.scannedQty,diff:e.requiredQty-e.scannedQty});});
    (a.scannedItems||[]).filter(function(s){return !s.inOBD;}).forEach(function(s){mis.push({obdNo:'—',material:s.material,ean:s.ean,expectedQty:0,scannedQty:s.qty,diff:-s.qty});});
    if(mis.length)DB.add('loading_data',{loadNo:a.loadNo,vehicleNo:a.vehicleNo,mismatches:mis,createdAt:new Date().toISOString()});

    // Release locks if P&L
    if(a.type==='pickandload'){obdIds.forEach(function(oid){releaseLocksForOBD(oid);DB.update('obd_data',oid,{status:'P&L Done'});});}

    // Remove from assignments
    obdIds.forEach(function(oid){
        DB.filter('loading_assignments',function(as){return as.status==='Assigned'&&(as.obdIds||[]).indexOf(oid)>-1;}).forEach(function(as){
            var ni=(as.obdIds||[]).filter(function(o){return o!==oid;});var nn=(as.obdNos||[]).filter(function(n,i){return as.obdIds[i]!==oid;});
            if(!ni.length)DB.update('loading_assignments',as.id,{status:'Done'});else DB.update('loading_assignments',as.id,{obdIds:ni,obdNos:nn});
        });
        if(a.type==='pickandload'){
            DB.filter('picking_assignments',function(pa){return pa.type==='pickandload'&&pa.status==='Assigned'&&(pa.obdIds||[]).indexOf(oid)>-1;}).forEach(function(pa){
                var ni2=(pa.obdIds||[]).filter(function(o){return o!==oid;});var nn2=(pa.obdNos||[]).filter(function(n,i){return pa.obdIds[i]!==oid;});
                if(!ni2.length)DB.update('picking_assignments',pa.id,{status:'Done'});else DB.update('picking_assignments',pa.id,{obdIds:ni2,obdNos:nn2});
            });
        }
    });

    addNotif('Loading '+a.loadNo+' approved by '+(APP.currentUser?APP.currentUser.name:'Admin'),'success');
    logAction('Loading','APPROVED',a.loadNo+' approved from notification');
    showToast('Approved: '+a.loadNo,'success');
    renderNotifPanel();
    if(APP.currentSection&&APP.currentSub)renderSection(APP.currentSection,APP.currentSub);
}

// ★ Reject directly from notification
function rejectFromNotif(approvalId){
    if(!confirm('Reject this loading?'))return;
    var a=DB.find('loading_approvals',approvalId);
    if(!a){showToast('Approval record not found','error');return;}
    if(a.status!=='Pending'){showToast('Already processed: '+a.status,'warning');return;}

    // Ask for rejection reason
    var rh='<div class="form-group"><label>Rejection Reason <span class="req">*</span></label><textarea id="notifRejectReason" class="form-input" placeholder="Why are you rejecting?"></textarea></div>';
    showModal('Reject Loading — '+a.loadNo,rh,'sm',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-danger" onclick="doRejectFromNotif(\''+approvalId+'\')"><i class="bx bx-x"></i> Reject</button>');
}

function doRejectFromNotif(approvalId){
    var reason=(document.getElementById('notifRejectReason')||{}).value||'';
    if(!reason.trim()){showToast('Enter rejection reason','error');return;}
    var a=DB.find('loading_approvals',approvalId);if(!a)return;
    DB.update('loading_approvals',approvalId,{status:'Rejected',rejectReason:reason,rejectedBy:APP.currentUser?APP.currentUser.id:'',rejectedByName:APP.currentUser?APP.currentUser.name:'',rejectedAt:new Date().toISOString()});
    addNotif('Loading '+a.loadNo+' rejected by '+(APP.currentUser?APP.currentUser.name:'Admin'),'error');
    logAction('Loading','REJECTED',a.loadNo+' rejected. Reason: '+reason);
    showToast('Rejected: '+a.loadNo,'error');
    closeModal();renderNotifPanel();
    if(APP.currentSection&&APP.currentSub)renderSection(APP.currentSection,APP.currentSub);
}

// ★ View details from notification — opens in qty-mismatch section
function viewFromNotif(approvalId){
    var a=DB.find('loading_approvals',approvalId);
    if(!a){showToast('Record not found','error');return;}
    // Close notification panel
    document.getElementById('notifPanel').classList.remove('open');
    // Navigate to qty-mismatch section
    navTo('loading','qty-mismatch');
    // After a small delay, open the detail modal
    setTimeout(function(){viewApprovalRequest(approvalId);},300);
}

// ==================== SEED DATA ====================
function seedData(){
    if(DB.get('users').length>0)return;
    DB.set('users',[
        {id:'u1',username:'superadmin',password:'super123',name:'Super Admin',role:'Super Admin',permissions:{modules:['all'],actions:{canSecurityEntry:true,canUploadInvoice:true,canAssignVehicle:true,canStartUnloading:true,canPostVehicle:true,canApprove:true,canViewReports:true,canPutaway:true,canPIV:true,canPick:true,canLoad:true,canAdmin:true}}},
        {id:'u2',username:'admin',password:'admin123',name:'Warehouse Admin',role:'Admin',permissions:{modules:['all'],actions:{canSecurityEntry:false,canUploadInvoice:true,canAssignVehicle:true,canStartUnloading:false,canPostVehicle:true,canApprove:true,canViewReports:true,canPutaway:true,canPIV:true,canPick:true,canLoad:true,canAdmin:true}}},
        {id:'u3',username:'manager',password:'mgr123',name:'Warehouse Manager',role:'Manager',permissions:{modules:['dashboard','inbound','reports','audit','picking','loading','user-time'],actions:{canSecurityEntry:false,canUploadInvoice:true,canAssignVehicle:true,canStartUnloading:false,canPostVehicle:false,canApprove:true,canViewReports:true,canPutaway:false,canPIV:false,canPick:true,canLoad:true,canAdmin:false}}},
        {id:'u4',username:'deo',password:'deo123',name:'Data Entry Operator',role:'DEO',permissions:{modules:['inbound'],actions:{canSecurityEntry:false,canUploadInvoice:true,canAssignVehicle:true,canStartUnloading:false,canPostVehicle:false,canApprove:false,canViewReports:false,canPutaway:false,canPIV:false,canPick:false,canLoad:false,canAdmin:false}}},
        {id:'u5',username:'security',password:'sec123',name:'Security Guard',role:'Security',permissions:{modules:['inbound','loading'],actions:{canSecurityEntry:true,canUploadInvoice:false,canAssignVehicle:false,canStartUnloading:false,canPostVehicle:false,canApprove:false,canViewReports:false,canPutaway:false,canPIV:false,canPick:false,canLoad:false,canAdmin:false}}},
        {id:'u6',username:'unloader',password:'unl123',name:'Unloading User',role:'Unloader',permissions:{modules:['inbound'],actions:{canSecurityEntry:false,canUploadInvoice:false,canAssignVehicle:false,canStartUnloading:true,canPostVehicle:true,canApprove:false,canViewReports:false,canPutaway:false,canPIV:false,canPick:false,canLoad:false,canAdmin:false}}},
        {id:'u7',username:'picker',password:'pick123',name:'Picker User',role:'Picker',permissions:{modules:['picking'],actions:{canSecurityEntry:false,canUploadInvoice:false,canAssignVehicle:false,canStartUnloading:false,canPostVehicle:false,canApprove:false,canViewReports:false,canPutaway:false,canPIV:false,canPick:true,canLoad:false,canAdmin:false}}},
        {id:'u8',username:'loader',password:'load123',name:'Loading User',role:'Loader',permissions:{modules:['loading'],actions:{canSecurityEntry:false,canUploadInvoice:false,canAssignVehicle:false,canStartUnloading:false,canPostVehicle:false,canApprove:false,canViewReports:false,canPutaway:false,canPIV:false,canPick:false,canLoad:true,canAdmin:false}}}
    ]);
    var mats=[
        {material:'VIP PREMIUM RICE 5KG',description:'Premium Basmati Rice 5kg',division:'Rice',ean:'8901234567001',brand:'VIP'},
        {material:'VIP GOLD WHEAT 10KG',description:'Golden Wheat Atta 10kg',division:'Flour',ean:'8901234567002',brand:'VIP'},
        {material:'VIP SUGAR 1KG',description:'Refined Sugar 1kg',division:'Sugar',ean:'8901234567003',brand:'VIP'},
        {material:'VIP DAL TOOR 1KG',description:'Toor Dal 1kg',division:'Pulses',ean:'8901234567004',brand:'VIP'},
        {material:'VIP SALT 1KG',description:'Iodized Salt 1kg',division:'Salt',ean:'8901234567005',brand:'VIP'},
        {material:'VIP OIL SUNFLOWER 1L',description:'Sunflower Oil 1L',division:'Oil',ean:'8901234567006',brand:'VIP'},
        {material:'VIP TEA 500G',description:'Premium Tea 500g',division:'Tea',ean:'8901234567007',brand:'VIP'},
        {material:'VIP SPICE TURMERIC 100G',description:'Turmeric Powder 100g',division:'Spices',ean:'8901234567008',brand:'VIP'},
        {material:'VIP CHOLE MASALA 200G',description:'Chole Masala 200g',division:'Spices',ean:'8901234567009',brand:'VIP'},
        {material:'VIP BASMATI RICE 25KG',description:'Extra Long Basmati 25kg',division:'Rice',ean:'8901234567010',brand:'VIP'}
    ];
    mats.forEach(function(m){DB.add('material_master',m);});
    for(var r=1;r<=30;r++){DB.add('rack_master',{rack:'RACK-'+String(r).padStart(3,'0')});}
    // Sample vehicles
    DB.add('vehicles',{id:'v1',vehicleNo:'MH-12-AB-1234',lrNo:'LR-2025-001',driverName:'Rajesh Kumar',driverMobile:'9876543210',transportName:'Fast Cargo',vehicleType:'Unloading',status:'Unload Pending',reportedAt:new Date().toISOString()});
    DB.add('vehicles',{id:'v2',vehicleNo:'GJ-05-CD-5678',lrNo:'LR-2025-002',driverName:'Amit Patel',driverMobile:'9123456789',transportName:'Green Logistics',vehicleType:'Unloading',status:'Unload Pending',reportedAt:new Date().toISOString()});
    DB.add('vehicles',{id:'v3',vehicleNo:'RJ-14-EF-9012',lrNo:'LR-2025-003',driverName:'Suresh Meena',driverMobile:'9988776655',transportName:'Rajput Transport',vehicleType:'Unloading',status:'Unload Pending',reportedAt:new Date().toISOString()});
    // Sample invoices for v1
    DB.add('invoices',{id:'inv1',vehicleId:'v1',invoiceNo:'INV-2025-101',status:'Pending'});
    DB.add('invoice_materials',{id:'im1',invoiceId:'inv1',material:'VIP PREMIUM RICE 5KG',ean:'8901234567001',qty:50,unloadedQty:0});
    DB.add('invoice_materials',{id:'im2',invoiceId:'inv1',material:'VIP GOLD WHEAT 10KG',ean:'8901234567002',qty:30,unloadedQty:0});
    DB.add('invoice_materials',{id:'im3',invoiceId:'inv1',material:'VIP SUGAR 1KG',ean:'8901234567003',qty:100,unloadedQty:0});
    DB.add('invoices',{id:'inv2',vehicleId:'v1',invoiceNo:'INV-2025-102',status:'Pending'});
    DB.add('invoice_materials',{id:'im4',invoiceId:'inv2',material:'VIP DAL TOOR 1KG',ean:'8901234567004',qty:80,unloadedQty:0});
    DB.add('invoice_materials',{id:'im5',invoiceId:'inv2',material:'VIP SALT 1KG',ean:'8901234567005',qty:120,unloadedQty:0});
    // v2 invoices
    DB.add('invoices',{id:'inv3',vehicleId:'v2',invoiceNo:'INV-2025-103',status:'Pending'});
    DB.add('invoice_materials',{id:'im6',invoiceId:'inv3',material:'VIP OIL SUNFLOWER 1L',ean:'8901234567006',qty:60,unloadedQty:0});
    DB.add('invoice_materials',{id:'im7',invoiceId:'inv3',material:'VIP TEA 500G',ean:'8901234567007',qty:40,unloadedQty:0});
    // Sample locations
    var locs=[
        {rack:'RACK-001',ean:'8901234567001',material:'VIP PREMIUM RICE 5KG',description:'Premium Basmati Rice 5kg',quantity:20,packing:'Bag',box:'B001',action:'PUTAWAY'},
        {rack:'RACK-002',ean:'8901234567002',material:'VIP GOLD WHEAT 10KG',description:'Golden Wheat Atta 10kg',quantity:15,packing:'Bag',box:'B002',action:'PUTAWAY'},
        {rack:'RACK-003',ean:'8901234567003',material:'VIP SUGAR 1KG',description:'Refined Sugar 1kg',quantity:50,packing:'Box',box:'B003',action:'PUTAWAY'},
        {rack:'RACK-005',ean:'8901234567004',material:'VIP DAL TOOR 1KG',description:'Toor Dal 1kg',quantity:30,packing:'Bag',box:'B004',action:'PIV'},
        {rack:'RACK-007',ean:'8901234567006',material:'VIP OIL SUNFLOWER 1L',description:'Sunflower Oil 1L',quantity:25,packing:'Bottle',box:'B005',action:'PUTAWAY'},
        {rack:'RACK-009',ean:'8901234567007',material:'VIP TEA 500G',description:'Premium Tea 500g',quantity:18,packing:'Box',box:'B006',action:'PIV'}
    ];
    locs.forEach(function(l){DB.add('location_master',{date:today(),rack:l.rack,ean:l.ean,material:l.material,description:l.description,quantity:l.quantity,packing:l.packing,box:l.box,action:l.action,user:'Admin',dateTime:new Date().toISOString()});});
    addNotif('Vehicle MH-12-AB-1234 arrived — Pending Unload','warning');
    addNotif('Vehicle GJ-05-CD-5678 arrived — Pending Unload','warning');
    logAction('System','INIT','System initialized with seed data');
}

// ==================== SINGLE DEVICE LOGIN (SAP-style) ====================
// Ek user ID ek time par sirf ek device me chalegi.
// Server side: wms_device_sessions table + RPC (device_lock.sql run karna zaroori hai).
var DEVLOCK = {
    HEARTBEAT_MS: 30000,      // har 30 sec me "main zinda hu" signal
    ALLOW_TAKEOVER: false,    // true = SAP jaisa option: "purane device ko logout karke yaha login karein?"
    _timer: null
};
function devId() {
    var id = localStorage.getItem('wms_device_id');
    if (!id) {
        id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('wms_device_id', id);
    }
    return id;
}
function devToken() { return localStorage.getItem('wms_dev_token') || ''; }
function devInfo() { return (navigator.userAgent || 'Unknown device').slice(0, 120); }

async function devClaim(username, force) {
    var tok = 'tk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    var r = await supabaseClient.rpc('wms_claim_session', {
        p_username: username, p_device: devId(), p_token: tok, p_info: devInfo(), p_force: !!force
    });
    if (r.error) { console.warn('claim error', r.error); return { ok: false, reason: 'error', message: r.error.message }; }
    if (r.data && r.data.ok) localStorage.setItem('wms_dev_token', tok);
    return r.data || { ok: false, reason: 'error' };
}
async function devHeartbeat() {
    if (!APP.currentUser) return;
    try {
        var r = await supabaseClient.rpc('wms_heartbeat', { p_username: APP.currentUser.username, p_token: devToken() });
        if (r.error) return;                       // network issue — logout mat karo
        if (r.data === false) {                    // token match nahi — kisi aur device ne login le liya
            devStop();
            showToast('Your ID has been logged in on another device. Logging out...', 'warning');
            setTimeout(function () { doLogout(); }, 1500);
        }
    } catch (e) {}
}
function devStart() {
    devStop();
    DEVLOCK._timer = setInterval(devHeartbeat, DEVLOCK.HEARTBEAT_MS);
}
function devStop() {
    if (DEVLOCK._timer) { clearInterval(DEVLOCK._timer); DEVLOCK._timer = null; }
}
async function devRelease(username) {
    try { await supabaseClient.rpc('wms_release_session', { p_username: username, p_token: devToken() }); } catch (e) {}
    localStorage.removeItem('wms_dev_token');
}
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') devHeartbeat();   // mobile me tab wapas aate hi check
});

// ==================== AUTH ====================
async function doLogin(uname, pass) {
    if (!supabaseClient) { showToast('Server not connected', 'error'); return false; }
    uname = (uname || '').trim().toLowerCase();

    var r = await supabaseClient.auth.signInWithPassword({
        email: uname + '@wms.example.com', password: pass
    });
    if (r.error) { showToast('Invalid username or password', 'error'); return false; }

    showLoader();
    await pullAll();                       // ab authenticated hai, data aayega
    hideLoader();

    var user = DB.get('users').filter(function (u) { return u.username === uname; })[0];
    if (!user) {
        await supabaseClient.auth.signOut();
        showToast('User profile not found', 'error');
        return false;
    }

    // ---- Single device check ----
    var claim = await devClaim(user.username, false);
    if (!claim.ok && claim.reason === 'in_use') {
        var go = DEVLOCK.ALLOW_TAKEOVER && confirm('This user ID is already logged in on another device.\n\nEnd that session and log in here?');
        if (go) claim = await devClaim(user.username, true);
    }
    if (!claim.ok) {
        await supabaseClient.auth.signOut({ scope: 'local' });   // local: dusre device ka session na toote
        var msg = claim.reason === 'in_use'
            ? 'User "' + user.username + '" is already logged in on another device.\nPlease log out from that device first, then try again.'
            : 'Session check failed: ' + (claim.message || 'Please make sure device_lock.sql has been run in Supabase.');
        showToast(msg.replace(/\n/g, ' '), 'error');
        alert(msg);
        return false;
    }

    APP.currentUser = user;
    APP.sessionStart = Date.now();
    devStart();
    localStorage.setItem('wms_session', JSON.stringify({ userId: user.id, loginTime: new Date().toISOString() }));
    DB.add('user_sessions', { userId: user.id, userName: user.name, loginTime: new Date().toISOString(), logoutTime: null, status: 'Active' });
    logAction('Auth', 'LOGIN', 'User ' + user.name + ' logged in');
    startRealtime();                       // Step 3.5 wala function
    return true;
}
async function doLogout() {
    if (APP.currentUser) {
        showLoader();
        logAction('Auth', 'LOGOUT', 'User ' + APP.currentUser.name + ' logged out');
        
        var sessions = DB.get('user_sessions');
        for (var i = sessions.length - 1; i >= 0; i--) {
            if (sessions[i].userId === APP.currentUser.id && !sessions[i].logoutTime) {
                DB.update('user_sessions', sessions[i].id, { logoutTime: new Date().toISOString(), status: 'Logged Out' });
                break;
            }
        }
        
        await flushAllPendingPushes(); // Data save before logout
        devStop();
        await devRelease(APP.currentUser.username);   // device lock free karo
        await supabaseClient.auth.signOut({ scope: 'local' });
        await new Promise(function(r) { setTimeout(r, 500); });
        
        APP.currentUser = null;
        localStorage.removeItem('wms_session');
        
        hideLoader();
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginPage').style.display = 'flex';
        if (typeof initMatrix === 'function') initMatrix();
        showToast('Logged out successfully', 'success');
    }
}
function chkPerm(mod){
    if(!APP.currentUser)return false;
    return APP.currentUser.permissions.modules.indexOf('all')>-1||APP.currentUser.permissions.modules.indexOf(mod)>-1;
}
// --- Permission helpers (button-level) ---
var OLD_ACT_MAP={canSecurityEntry:'inb.gate.create',canUploadInvoice:'inb.inv.upload',canAssignVehicle:'inb.unload.assign',canStartUnloading:'inb.unload.start',canPostVehicle:'inb.grn.post',canApprove:'load.approve',canViewReports:'rep.run',canPutaway:'put.save',canPIV:'piv.save',canPick:'pick.confirm',canLoad:'load.execute',canAdmin:'adm.user.edit'};
function upgPerms(p){
    if(!p)p={modules:[],actions:{}};
    if(p._v2)return p;
    var a=p.actions||(p.actions={});
    var OLD2NEW={canSecurityEntry:['inb.gate.create'],canUploadInvoice:['inb.inv.upload'],canAssignVehicle:['inb.unload.assign'],canStartUnloading:['inb.unload.start','inb.unload.partial'],canPostVehicle:['inb.grn.post'],canApprove:['inb.grn.approve','load.approve'],canViewReports:['rep.run','rep.export'],canPutaway:['put.save'],canPIV:['piv.add','piv.save'],canPick:['pick.confirm','pick.notfound','pick.short','pick.list'],canLoad:['load.execute','load.manual'],canAdmin:['adm.user.add','adm.user.edit','adm.user.delete']};
    for(var k in OLD2NEW){if(a[k]===true){OLD2NEW[k].forEach(function(nid){a[nid]=true;});}}
    p._v2=true;
    return p;
}
function canBtn(id){
    if(!APP.currentUser)return false;
    if(APP.currentUser.role==='Super Admin')return true;
    if(APP.currentUser.permissions)upgPerms(APP.currentUser.permissions);
    var a=(APP.currentUser.permissions||{}).actions||{};
    return a[id]===true;
}
function pBtn(id,html){return canBtn(id)?html:'';}
function chkAct(act){
    if(!APP.currentUser)return false;
    if(APP.currentUser.role==='Super Admin')return true;
    if(OLD_ACT_MAP[act])return canBtn(OLD_ACT_MAP[act]);
    return canBtn(act);
}

// ==================== SIDEBAR ====================
function renderSidebar(){
    if(!APP.currentUser)return;
            var mods=[
        {id:'dashboard',icon:'bxs-home',label:'Home',subs:[]},
        {id:'inbound',icon:'bxs-truck',label:'Goods Inward',subs:[
            {id:'security-gate',label:'Gate Entry'},
            {id:'pending-vehicle',label:'Waiting Vehicles'},
            {id:'unloading-screen',label:'Unload Vehicle'},
            {id:'posting-pending',label:'Pending Approvals'},
            {id:'inbound-record',label:'Inward History'},
            {id:'unloading-stock',label:'Unloaded Stock'}
        ]},
        {id:'putaway',icon:'bxs-package',label:'Putaway (Store Stock)',subs:[]},
        {id:'piv',icon:'bxs-clipboard',label:'Stock Count',subs:[]},
        {id:'location',icon:'bxs-map-pin',label:'Stock Overview',subs:[]},
        {id:'rack',icon:'bxs-grid-alt',label:'Bins & Racks',subs:[]},
        {id:'material',icon:'bxs-label',label:'Products',subs:[]},
        {id:'picking',icon:'bxs-box',label:'Order Picking',subs:[
            {id:'obd-upload',label:'Create Delivery Order'},
            {id:'picking-assign',label:'Assign Picking Tasks'},
            {id:'start-picking',label:'Pick & Confirm'},
            {id:'picking-done',label:'Completed Picks'},
            {id:'picking-with-loading',label:'Pick and Load'},
            {id:'crossdock-report',label:'Cross-Dock Report'},
            {id:'loc-requests',label:'Location Requests'}
        ]},
        {id:'loading',icon:'bxs-truck',label:'Dispatch & Loading',subs:[
            {id:'loading-assign',label:'Assign Loading Tasks'},
            {id:'start-loading',label:'Load Vehicle'},
            {id:'loading-done',label:'Dispatch History'},
            {id:'loading-register',label:'Loading Register'},
            {id:'qty-mismatch',label:'Qty Difference Report'}
        ]},
        {id:'user-time',icon:'bx-time-five',label:'User Work Log',subs:[]},
        {id:'admin',icon:'bxs-user-detail',label:'Users & Permissions',subs:[]},
        {id:'settings',icon:'bxs-cog',label:'Settings',subs:[]},
        {id:'reports',icon:'bxs-bar-chart-alt-2',label:'Reports',subs:[]},
        {id:'audit',icon:'bxs-receipt',label:'Activity History',subs:[]}
    ];
    var h='';
    mods.forEach(function(mod){
        var hasSub=mod.subs.length>0;
        var hasParent=chkPerm(mod.id);
        var hasAnySub=false;
        if(hasSub){mod.subs.forEach(function(s){if(chkPerm(s.id)){hasAnySub=true;}});}
        if(!hasParent&&!hasAnySub)return;
        h+='<div class="nav-group">';
        h+='<a href="#" data-section="'+mod.id+'" class="nav-item'+(hasSub?' has-sub':'')+'">';
        h+='<i class="bx '+mod.icon+'"></i><span>'+mod.label+'</span>';
        if(hasSub)h+='<i class="bx bx-chevron-down sub-arrow"></i>';
        h+='</a>';
        if(hasSub){
            h+='<div class="nav-sub" id="'+mod.id+'Sub">';
            mod.subs.forEach(function(s){if(chkPerm(s.id))h+='<a href="#" data-sub="'+s.id+'" class="nav-sub-item">'+s.label+'</a>';});
            h+='</div>';
        }
        h+='</div>';
    });
    document.getElementById('sidebarNav').innerHTML=h;
    // Bind events
    document.querySelectorAll('#sidebarNav .nav-item').forEach(function(el){
        el.addEventListener('click',function(e){
            e.preventDefault();
            var sec=this.getAttribute('data-section');
            if(this.classList.contains('has-sub')){
                this.classList.toggle('open');
                var sub=this.nextElementSibling;if(sub)sub.classList.toggle('open');
                return;
            }
            if(sec)navTo(sec);
        });
    });
    document.querySelectorAll('#sidebarNav .nav-sub-item').forEach(function(el){
        el.addEventListener('click',function(e){
            e.preventDefault();
            var sub=this.getAttribute('data-sub');
            var pg=this.closest('.nav-group');
            var psec=pg?pg.querySelector('.nav-item').getAttribute('data-section'):null;
            if(sub&&psec)navTo(psec,sub);
        });
    });
}

// ==================== NAVIGATION ====================
var sectionNames={
    dashboard:'Home',
    inbound:'Goods Inward (Inbound)',
    putaway:'Putaway — Store Stock in Bins',
    piv:'Stock Count (Physical Inventory)',
    location:'Stock Overview (Warehouse Stock)',
    rack:'Bins & Racks (Storage Bin Master)',
    material:'Products (Product Master)',
    admin:'Users & Permissions',
    settings:'Settings',
    reports:'Reports & Analytics',
    audit:'Activity History (Audit Log)',
    picking:'Order Picking (Outbound)',
    loading:'Dispatch & Loading (Outbound)',
    'user-time':'User Work Log'
};

var subNames={
    'security-gate':'Gate Entry',
    'pending-vehicle':'Waiting Vehicles',
    'unloading-screen':'Unload Vehicle (Unloading)',
    'posting-pending':'Pending Approvals (GR Posting)',
    'inbound-record':'Inward History (Delivery Records)',
    'unloading-stock':'Unloaded Stock (GR Area)',
    'obd-upload':'Create Delivery Order',
    'picking-assign':'Assign Picking Tasks',
    'start-picking':'Pick & Confirm',
    'picking-done':'Completed Picks',
    'picking-with-loading':'Pick and Load',
    'loc-requests':'Location Requests',
    'crossdock-report':'Cross-Dock Report',
    'loading-register':'Loading Register',
    'loading-assign':'Assign Loading Tasks',
    'start-loading':'Load Vehicle',
    'loading-done':'Dispatch History (Goods Issue)',
    'qty-mismatch':'Qty Difference Report'
};

function navTo(sec,sub){
    sub=sub||null;
    if(!chkPerm(sec)&&!sub){showToast('Access Denied!','error');return;}
    if(sub&&!chkPerm(sub)){showToast('Access Denied!','error');return;}
    APP.currentSection=sec;APP.currentSub=sub;
    // Highlight
    document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
    document.querySelectorAll('.nav-sub-item').forEach(function(n){n.classList.remove('active');});
    var ni=document.querySelector('.nav-item[data-section="'+sec+'"]');
    if(ni)ni.classList.add('active');
    if(sub){
        var si=document.querySelector('.nav-sub-item[data-sub="'+sub+'"]');
        if(si)si.classList.add('active');
        if(ni){ni.classList.add('open');}
        var ps=document.getElementById(sec+'Sub');if(ps)ps.classList.add('open');
    }
    // Breadcrumb
    var bc='<span class="bc-item">Home</span> <i class="bx bx-chevron-right" style="font-size:10px;color:var(--text-muted)"></i> <span class="bc-item active">'+(sectionNames[sec]||sec)+'</span>';
    if(sub)bc+=' <i class="bx bx-chevron-right" style="font-size:10px;color:var(--text-muted)"></i> <span class="bc-item active">'+(subNames[sub]||sub)+'</span>';
    document.getElementById('breadcrumb').innerHTML=bc;
    // Section
    var ca=document.getElementById('contentArea');
    ca.innerHTML='<section class="content-section active" id="sec-content"></section>';
    renderSection(sec,sub);
    closeSidebar();
    // Bottom nav highlight
    document.querySelectorAll('.bnav-item').forEach(function(b){b.classList.remove('active');});
    var bnMap={dashboard:'dashboard',inbound:'inbound',picking:'picking',loading:'loading'};
    var bn=bnMap[sec];
    if(bn){var be=document.querySelector('.bnav-item[data-bnav="'+bn+'"]');if(be)be.classList.add('active');}
}

function renderSection(sec,sub){
    var r={
        dashboard:renderDashboard,
        inbound:function(){renderInbound(sub);},
        putaway:renderPutaway,
        piv:renderPIV,
        location:renderLocationMaster,
        rack:renderRackMaster,
        material:renderMaterialMaster,
        admin:renderAdmin,
        settings:renderSettings,
        reports:renderReports,
        audit:renderAuditLog,
        picking:function(){renderPicking(sub);},
        loading:function(){renderLoading(sub);},
        'user-time':renderUserWorkingTime
    };
    var el=document.getElementById('sec-content');
    if(!el){el=document.createElement('section');el.id='sec-content';el.className='content-section active';document.getElementById('contentArea').appendChild(el);}
    if(r[sec])r[sec]();
    else el.innerHTML='<div class="card"><div class="empty-state"><i class="bx bx-code-block"></i><p>Module coming soon...</p></div></div>';
}

function setHtml(html){var el=document.getElementById('sec-content');if(el)el.innerHTML=html;}

// ==================== DASHBOARD ====================
async function renderDashboard(){
    var vehs=DB.get('vehicles'),racks=DB.get('rack_master'),td=today();
    var obds=DB.get('obd_data'),loadedV=DB.get('loaded_vehicles'),grns=DB.get('grn_records'),pickDone=DB.get('picking_done');
    var u=APP.currentUser||{name:'User',role:''};

    // --- Counts ---
    var pending=0,posted=0,postPend=0;
    vehs.forEach(function(v){
        if(v.vehicleType==='Unloading'){
            if(v.status==='Unload Pending'||v.status==='Assigned'||v.status==='Partial Unload')pending++;
            if(v.status==='Posted'||v.status==='Unloaded')posted++;
            if(v.status==='Posting Pending Approval')postPend++;
        }
    });
    var obdOpen=obds.filter(function(o){return o.status==='Pending';}).length;
    var obdAssigned=obds.filter(function(o){return o.status==='Assigned'||o.status==='P&L Assigned';}).length;
    var obdPicked=obds.filter(function(o){return o.status==='Picking Done';}).length;
    var obdDone=obds.filter(function(o){return o.status==='P&L Done';}).length;
    var loadReady=pickDone.length-loadedV.filter(function(l){return l.loadStatus==='Fully Loaded'&&l.type!=='pickandload';}).length;
    if(loadReady<0)loadReady=0;
    var pendApprovals=DB.filter('loading_approvals',function(a){return a.status==='Pending';}).length;

    var todayPut=0,todayPIV=0,totalStockQty=0,occ=0;
    try{
        var st=await supabaseClient.rpc('wms_dash_stats');
        if(st.data){ totalStockQty=Math.round(st.data.totalQty||0); todayPut=st.data.todayPut||0; todayPIV=st.data.todayPIV||0; occ=st.data.occRacks||0; }
    }catch(e){ console.warn('wms_dash_stats:',e); }
    var totalBins=racks.length,emptyBins=totalBins-occ;
    var utilPct=totalBins>0?Math.round((occ/totalBins)*100):0;
    var shorts=DB.get('short_excess_reports').length+DB.get('short_reports').length;

    // --- Greeting ---
    var hr=new Date().getHours();
    var greet=hr<12?'Good Morning':(hr<17?'Good Afternoon':'Good Evening');

    var h='';
    // HERO
    h+='<div class="lp-hero"><div style="position:relative;z-index:1">';
    h+='<h1>'+greet+', '+esc(u.name)+'</h1>';
    h+='<p>Warehouse Overview — Plant MD20 | '+fmtDT(new Date())+'</p></div>';
    h+='<div class="lp-hero-meta">';
    h+='<div class="lp-chip"><i class="bx bx-building"></i> Plant MD20</div>';
    h+='<div class="lp-chip"><i class="bx bx-id-card"></i> '+esc(u.role||'User')+'</div>';
    h+='<div class="lp-chip"><i class="bx bx-grid-alt"></i> Bin Utilization '+utilPct+'%</div>';
    h+='</div></div>';

    // ===== INBOUND TILES =====
    h+='<div class="lp-group-title"><i class="bx bxs-truck" style="color:#0A6ED1"></i> Inbound</div><div class="lp-tiles">';
    h+=lpTile('Pending Goods Receipt','Vehicles waiting',pending,'Vehicles','bx-time-five','#E9730C','#FFF8D6',pending>0?'Action':'Clear',pending>0?'down':'up',"navTo('inbound','pending-vehicle')");
    h+=lpTile('GR Posting Pending','Awaiting approval',postPend,'Docs','bx-error-circle','#0A6ED1','#EBF5FE',postPend>0?'Review':'Clear',postPend>0?'neutral':'up',"navTo('inbound','posting-pending')");
    h+=lpTile('GR Posted','Goods receipt done',posted,'Vehicles','bxs-check-circle','#107E3E','#F1FDF6','Done','up',"navTo('inbound','inbound-record')");
    h+=lpTile('Putaway Today','Warehouse tasks',todayPut,'Tasks','bxs-package','#0A6ED1','#EBF5FE','Today','neutral',"navTo('putaway')");
    h+='</div>';

    // ===== OUTBOUND TILES =====
    h+='<div class="lp-group-title"><i class="bx bxs-box" style="color:#E9730C"></i> Outbound</div><div class="lp-tiles">';
    h+=lpTile('Open Deliveries','Not yet assigned',obdOpen,'ODs','bx-file','#E9730C','#FFF8D6',obdOpen>0?'Open':'Clear',obdOpen>0?'down':'up',"navTo('picking','picking-assign')");
    h+=lpTile('Picking In Process','Assigned tasks',obdAssigned,'ODs','bxs-box','#0A6ED1','#EBF5FE','Active','neutral',"navTo('picking','start-picking')");
    h+=lpTile('Ready for Loading','Picking confirmed',loadReady,'ODs','bxs-truck','#107E3E','#F1FDF6','Ready','up',"navTo('loading','loading-assign')");
    h+=lpTile('Approval Requests','Qty differences',pendApprovals,'Requests','bx-shield-quarter','#BB0000','#FFEBEB',pendApprovals>0?'Urgent':'Clear',pendApprovals>0?'down':'up',"navTo('loading','qty-mismatch')");
    h+='</div>';

    // ===== INVENTORY TILES =====
    h+='<div class="lp-group-title"><i class="bx bxs-grid-alt" style="color:#107E3E"></i> Inventory</div><div class="lp-tiles">';
    h+=lpTile('Total Stock','All storage bins',totalStockQty,'Units','bxs-package','#0A6ED1','#EBF5FE','Live','neutral',"navTo('location')");
    h+=lpTile('Occupied Bins','Bins with stock',occ+' / '+totalBins,'','bxs-grid-alt','#107E3E','#F1FDF6',utilPct+'%',utilPct>85?'down':'up',"navTo('rack')");
    h+=lpTile('Empty Bins','Available capacity',emptyBins,'Bins','bx-grid','#556B82','#F2F2F2','Free','neutral',"navTo('rack')");
    h+=lpTile('Physical Inventory','Counts today',todayPIV,'Counts','bxs-clipboard','#E9730C','#FFF8D6','Today','neutral',"navTo('piv')");
    h+='</div>';

    // ===== PANELS ROW =====
    h+='<div class="lp-row" style="margin-top:20px">';

    // Panel 1: Warehouse Activity Monitor (bars)
    var maxBar=Math.max(obdOpen,obdAssigned,obdPicked,obdDone,pending,postPend,posted,1);
    h+='<div class="lp-panel"><h3><i class="bx bx-bar-chart-alt-2"></i> Warehouse Activity Monitor</h3><div class="lp-bars">';
    h+=lpBar('GR Pending',pending,maxBar,'#E9730C');
    h+=lpBar('GR Posted',posted,maxBar,'#107E3E');
    h+=lpBar('OD Open',obdOpen,maxBar,'#BB0000');
    h+=lpBar('OD Assigned',obdAssigned,maxBar,'#0A6ED1');
    h+=lpBar('Picking Done',obdPicked,maxBar,'#8B5CF6');
    h+=lpBar('Goods Issued',obdDone+loadedV.length,Math.max(maxBar,obdDone+loadedV.length),'#107E3E');
    h+='</div></div>';

    // Panel 2: Donut — bin utilization
    var deg=Math.round(utilPct*3.6);
    h+='<div class="lp-panel"><h3><i class="bx bx-pie-chart-alt-2"></i> Bin Utilization</h3><div class="lp-donut-wrap">';
    h+='<div class="lp-donut" data-center="'+utilPct+'%" style="background:conic-gradient(#0A6ED1 0deg '+deg+'deg,#E5E5E5 '+deg+'deg 360deg)"></div>';
    h+='<div class="lp-legend"><span><i style="background:#0A6ED1"></i> Occupied: <b>'+occ+'</b></span><span><i style="background:#E5E5E5"></i> Empty: <b>'+emptyBins+'</b></span><span><i style="background:#32363A"></i> Total Bins: <b>'+totalBins+'</b></span></div>';
    h+='</div></div></div>';

    // ===== ALERTS + TIMELINE =====
    h+='<div class="lp-row" style="margin-top:16px;grid-template-columns:1fr 1fr">';

    // Alerts
    h+='<div class="lp-panel"><h3><i class="bx bx-bell"></i> Alerts & Exceptions</h3>';
    var alerts=0;
    if(pendApprovals>0){alerts++;h+='<div class="lp-alert err"><i class="bx bx-error-circle" style="color:#BB0000"></i><div><b>'+pendApprovals+' loading approval(s)</b> pending — quantity difference detected.</div></div>';}
    if(postPend>0){alerts++;h+='<div class="lp-alert warn"><i class="bx bx-time" style="color:#E9730C"></i><div><b>'+postPend+' vehicle(s)</b> waiting for GR posting.</div></div>';}
    if(pending>0){alerts++;h+='<div class="lp-alert warn"><i class="bx bxs-truck" style="color:#E9730C"></i><div><b>'+pending+' vehicle(s)</b> at gate, goods receipt not started.</div></div>';}
    if(obdOpen>0){alerts++;h+='<div class="lp-alert warn"><i class="bx bx-file" style="color:#E9730C"></i><div><b>'+obdOpen+' outbound deliver'+(obdOpen>1?'ies':'y')+'</b> not yet assigned for picking.</div></div>';}
    if(shorts>0){alerts++;h+='<div class="lp-alert err"><i class="bx bx-error" style="color:#BB0000"></i><div><b>'+shorts+' short/excess report(s)</b> on record.</div></div>';}
    if(utilPct>85){alerts++;h+='<div class="lp-alert warn"><i class="bx bx-grid-alt" style="color:#E9730C"></i><div>Bin utilization is high (<b>'+utilPct+'%</b>). Plan capacity.</div></div>';}
    if(!alerts)h+='<div class="lp-alert ok"><i class="bx bx-check-circle" style="color:#107E3E"></i><div><b>All clear.</b> No exceptions at the moment.</div></div>';
    h+='</div>';

    // Timeline (recent activity)
    var recent=DB.get('audit_log').slice(-7).reverse();
    h+='<div class="lp-panel"><h3><i class="bx bx-history"></i> Recent Activity</h3><div class="lp-timeline">';
    if(!recent.length)h+='<div style="color:#6A6D70;font-size:12px">No activity yet</div>';
    recent.forEach(function(a){
        h+='<div class="lp-tl-item"><b>'+esc(a.module)+' — '+esc(a.action)+'</b> by '+esc(a.userName)+'<small>'+fmtDT(a.dateTime)+'</small></div>';
    });
    h+='</div></div></div>';

    setHtml(h);
}

// ---- Dashboard helpers ----
function lpTile(title,sub,num,unit,icon,color,bg,trendTxt,trendCls,onclick){
    return '<div class="lp-tile" style="--tc:'+color+';--tb:'+bg+'" onclick="'+onclick+'">'+
        '<div class="lp-tile-top"><div><div class="lp-tile-title">'+title+'</div><div class="lp-tile-sub">'+sub+'</div></div>'+
        '<div class="lp-tile-ico"><i class="bx '+icon+'"></i></div></div>'+
        '<div class="lp-tile-foot"><div><span class="lp-tile-num">'+num+'</span><span class="lp-tile-unit">'+unit+'</span></div>'+
        '<span class="lp-trend '+trendCls+'">'+trendTxt+'</span></div></div>';
}
function lpBar(label,val,max,color){
    var pct=max>0?Math.round((val/max)*100):0;
    return '<div class="lp-bar-row"><div class="lp-bar-lbl">'+label+'</div><div class="lp-bar-track"><div class="lp-bar-fill" style="width:'+pct+'%;--bc:'+color+'"></div></div><div class="lp-bar-val">'+val+'</div></div>';
}
function kpi(icon,val,label,color){
    var colors={accent:'var(--accent)',warning:'var(--warning)',info:'var(--info)',accent2:'var(--accent2)',success:'var(--success)',danger:'var(--danger)'};
    var c=colors[color]||colors.accent;
    return '<div class="kpi-card"><div class="kpi-icon" style="background:'+c+'15;color:'+c+'"><i class="bx '+icon+'"></i></div><div class="kpi-value">'+val+'</div><div class="kpi-label">'+label+'</div></div>';
}

// ==================== INBOUND ====================
function renderInbound(sub){
    switch(sub){
        case 'security-gate':renderSecurityGate();break;
        case 'pending-vehicle':renderPendingVehicle();break;
        case 'unloading-screen':renderUnloadingScreen();break;
        case 'posting-pending':renderPostingPending();break;
        case 'inbound-record':renderInboundRecord();break;
        case 'unloading-stock':renderUnloadingStock();break;
        default:renderPendingVehicle();
    }
}

// --- Security Gate ---
document.addEventListener('change',function(e){
    if(e.target.name==='vehType'){
        var lg=document.getElementById('lrGrp');if(lg)lg.style.display=e.target.value==='Unloading'?'':'none';
        document.querySelectorAll('input[name="vehType"]').forEach(function(r){
            var p=r.closest('label');
            if(r.checked){p.style.borderColor=r.value==='Unloading'?'var(--accent)':'var(--accent2)';p.style.background=r.value==='Unloading'?'var(--accent-dim)':'var(--accent2-dim)';p.style.color=r.value==='Unloading'?'var(--accent)':'var(--accent2)';}
            else{p.style.borderColor='var(--border)';p.style.background='transparent';p.style.color='var(--text-secondary)';}
        });
    }
});
// --- Pending Vehicle ---
function renderPendingVehicle(){
    var allV=DB.get('vehicles');
    var unassigned=[],assigned=[],postPend=[];
    allV.forEach(function(v){
        if(v.vehicleType!=='Unloading')return;
        if(v.status==='Posting Pending Approval')postPend.push(v);
        else if(v.assignedTo&&v.status!=='Posted'&&v.status!=='Unloaded'&&v.status!=='Rejected')assigned.push(v);
        else if(v.status==='Unload Pending')unassigned.push(v);
    });
    var h='<div class="section-header"><h2><i class="bx bx-time-five"></i> Inbound Control Tower</h2>';
    if(chkAct('canUploadInvoice'))h+='<button class="btn btn-glass" onclick="showBulkUpload()"><i class="bx bx-upload"></i> Bulk Upload</button>';
    h+='</div>';
    h+='<div class="card"><div class="card-title"><i class="bx bx-clock"></i> Unassigned Vehicles ('+unassigned.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR No</th><th>Transport</th><th>Invoices</th><th>Materials</th><th>Entry By</th><th>Actions</th></tr></thead><tbody>';
    if(!unassigned.length)h+='<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No unassigned vehicles</td></tr>';
    else unassigned.forEach(function(v){
        var invs=DB.filter('invoices',function(i){return i.vehicleId===v.id;});
        var matCount=0;invs.forEach(function(inv){matCount+=DB.filter('invoice_materials',function(m){return m.invoiceId===inv.id;}).length;});
        h+='<tr><td><strong>'+esc(v.vehicleNo)+'</strong></td><td>'+esc(v.lrNo||'-')+'</td><td>'+esc(v.transportName||'-')+'</td><td><span class="badge badge-info">'+invs.length+'</span></td><td><span class="badge badge-accent">'+matCount+'</span></td><td style="font-size:11px;color:var(--text-secondary)">'+esc(v.entryByName||'-')+'</td><td><div class="table-actions">';
        if(chkAct('canUploadInvoice'))h+='<button class="btn btn-glass btn-sm" onclick="showUploadInvoice(\''+v.id+'\')"><i class="bx bx-upload"></i> Invoice</button>';
        if(chkAct('canUploadInvoice'))h+='<button class="btn btn-glass btn-sm" onclick="showVehicleExcelUpload(\''+v.id+'\')"><i class="bx bx-spreadsheet"></i> Excel</button>';
        h+='<button class="btn btn-glass btn-sm" onclick="viewVehicleInvoices(\''+v.id+'\')"><i class="bx bx-show"></i> View</button>';
        if(chkAct('canAssignVehicle'))h+='<button class="btn btn-glass btn-sm" onclick="showAssignUnloading(\''+v.id+'\')"><i class="bx bx-user-plus"></i> Assign</button>';
        h+='<button class="btn btn-danger btn-sm" title="Delete" onclick="deleteVehicle(\''+v.id+'\')"><i class="bx bx-trash"></i></button>';
        h+='</div></td></tr>';
    });
    h+='</tbody></table></div></div>';
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-user-check"></i> Assigned Vehicles ('+assigned.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR No</th><th>Assigned User</th><th>Invoices</th><th>Entry By</th><th>Actions</th></tr></thead><tbody>';
    if(!assigned.length)h+='<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No assigned vehicles</td></tr>';
    else assigned.forEach(function(v){
        var invs=DB.filter('invoices',function(i){return i.vehicleId===v.id;});
        h+='<tr><td><strong>'+esc(v.vehicleNo)+'</strong></td><td>'+esc(v.lrNo||'-')+'</td><td><span class="badge badge-accent" style="font-family:var(--font-display)">'+esc(v.assignedToName||v.assignedTo||'-')+'</span></td><td><span class="badge badge-info">'+invs.length+'</span></td><td style="font-size:11px;color:var(--text-secondary)">'+esc(v.entryByName||'-')+'</td><td><div class="table-actions">';
        h+='<button class="btn btn-glass btn-sm" onclick="viewVehicleInvoices(\''+v.id+'\')"><i class="bx bx-show"></i> View</button>';
        if(chkAct('canAssignVehicle'))h+='<button class="btn btn-danger btn-sm" onclick="unassignVehicle(\''+v.id+'\')"><i class="bx bx-user-minus"></i> Unassign</button>';
        h+='</div></td></tr>';
    });
    h+='</tbody></table></div></div>';
    if(postPend.length>0){
        h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-error-circle" style="color:var(--warning)"></i> Posting Pending Approval ('+postPend.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR No</th><th>Unload No</th><th>Submitted By</th><th>Actions</th></tr></thead><tbody>';
        postPend.forEach(function(v){
            h+='<tr><td><strong>'+esc(v.vehicleNo)+'</strong></td><td>'+esc(v.lrNo||'-')+'</td><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(v.unloadNo||'-')+'</td><td>'+esc(v.unloadedByName||'-')+'</td><td><div class="table-actions">';
            if(chkAct('canPostVehicle'))h+='<button class="btn btn-glass btn-sm" onclick="postVehicle(\''+v.id+'\')"><i class="bx bx-check-double"></i> Post</button>';
            h+='<button class="btn btn-glass btn-sm" onclick="viewUnloadingDetail(\''+v.id+'\')"><i class="bx bx-eye"></i> View</button>';
            h+='</div></td></tr>';
        });
        h+='</tbody></table></div></div>';
    }
    setHtml(h);
}

// --- Upload Invoice (FORMAT: Vehicle | LR | Invoice No | Material | Description | EAN | Qty | Customer) ---
function showUploadInvoice(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var h='';
    // Top section: Vehicle, LR (read-only) + Invoice No, Customer (manual)
    h+='<div class="form-row">';
    h+='<div class="form-group"><label>Vehicle No</label><div class="form-input" style="background:var(--bg-secondary);color:var(--accent);font-weight:700;font-family:var(--font-display)">'+esc(v.vehicleNo)+'</div></div>';
    h+='<div class="form-group"><label>LR No</label><div class="form-input" style="background:var(--bg-secondary);color:var(--accent);font-weight:700;font-family:var(--font-display)">'+esc(v.lrNo||'-')+'</div></div>';
    h+='<div class="form-group"><label>Invoice No <span class="req">*</span></label><input type="text" id="singleInvNo" class="form-input" placeholder="INV-2025-XXX" style="text-transform:uppercase"></div>';
    h+='<div class="form-group"><label>Customer <span class="req">*</span></label><input type="text" id="singleInvCust" class="form-input" placeholder="Customer name"></div>';
    h+='</div>';
    h+='<hr class="cyber-line"><div class="card-title"><i class="bx bx-list-plus"></i> Add Materials</div>';
    // Column headers
    h+='<div style="display:grid;grid-template-columns:2fr 2fr 1.2fr 0.6fr 30px;gap:6px;margin-bottom:6px;padding:0 2px">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Material</div>';
    h+='<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Description</div>';
    h+='<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase">EAN</div>';
    h+='<div style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase">Qty</div>';
    h+='<div></div>';
    h+='</div>';
    h+='<div id="singleMatRows">'+invMatRow(0)+'</div>';
    h+='<button class="btn btn-glass btn-sm" onclick="addInvMatRow()" style="margin-top:8px"><i class="bx bx-plus"></i> Add Row</button>';
    showModal('Upload Invoice — '+v.vehicleNo,h,'lg',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="saveSingleInvoice(\''+vehId+'\')"><i class="bx bx-check"></i> Save Invoice</button>');
}
function invMatRow(idx){
    return '<div class="inv-mat-row" id="imr_'+idx+'" style="display:grid;grid-template-columns:2fr 2fr 1.2fr 0.6fr 30px;gap:6px;margin-bottom:6px;align-items:end">'+
        '<div><input type="text" class="form-input imr-mat" placeholder="Material name" style="font-size:12px"></div>'+
        '<div><input type="text" class="form-input imr-desc" placeholder="Description" style="font-size:12px"></div>'+
        '<div><input type="text" class="form-input imr-ean" placeholder="EAN" style="font-family:var(--font-display);font-size:11px" onblur="autoFillInvMat(this)"></div>'+
        '<div><input type="number" class="form-input imr-qty" placeholder="1" min="1" value="1" style="text-align:center;font-size:12px"></div>'+
        '<div><button class="btn btn-danger btn-sm" style="width:30px;height:30px;padding:0" onclick="document.getElementById(\'imr_'+idx+'\').remove()"><i class="bx bx-trash"></i></button></div>'+
    '</div>';
}
var imrIdx=1;
function addInvMatRow(){
    var c=document.getElementById('singleMatRows');
    var div=document.createElement('div');div.innerHTML=invMatRow(imrIdx++);
    c.appendChild(div.firstElementChild);
}
async function autoFillInvMat(eanInput){
    var ean=eanInput.value.trim().toUpperCase();
    if(!ean||ean.length<5)return;
    var row=eanInput.closest('.inv-mat-row');
    var matInput=row.querySelector('.imr-mat');
    var descInput=row.querySelector('.imr-desc');
    var mm=await sbFindOne('material_master','ean',ean);   // ★ direct Supabase search
    if(mm){
        if(!matInput.value)matInput.value=mm.material||'';
        if(!descInput.value)descInput.value=mm.description||'';
    }
}
function saveSingleInvoice(vehId){
    var invNo=document.getElementById('singleInvNo').value.trim().toUpperCase();
    if(!invNo){showToast('Invoice number required','error');return;}
    var exists=DB.filter('invoices',function(i){return i.vehicleId===vehId&&i.invoiceNo===invNo;});
    if(exists.length>0){showToast('Invoice number already exists for this vehicle','error');return;}
    var cust=document.getElementById('singleInvCust').value.trim();
    if(!cust){showToast('Customer name required','error');return;}
    var inv=DB.add('invoices',{vehicleId:vehId,invoiceNo:invNo,customer:cust,status:'Pending'});
    var rows=document.querySelectorAll('.inv-mat-row');
    var count=0;
    rows.forEach(function(row){
        var mat=row.querySelector('.imr-mat').value.trim();
        var desc=row.querySelector('.imr-desc').value.trim();
        var ean=row.querySelector('.imr-ean').value.trim().toUpperCase();
        var qty=parseInt(row.querySelector('.imr-qty').value)||0;
        if(mat&&ean&&qty>0){
            DB.add('invoice_materials',{invoiceId:inv.id,material:mat,description:desc,ean:ean,qty:qty,unloadedQty:0});
            count++;
        }
    });
    if(!count){showToast('Add atleast one material with EAN and Qty','error');DB.remove('invoices',inv.id);return;}
    logAction('Inbound','INVOICE_UPLOAD','Invoice '+invNo+' uploaded with '+count+' materials');
    showToast('Invoice '+invNo+' saved with '+count+' materials!','success');
    closeModal();renderInbound('pending-vehicle');
}

// --- Bulk Upload (FORMAT: Vehicle No | LR No | Invoice No | Material | Description | EAN | Qty | Customer) ---
function showBulkUpload(){
    var h='<div class="form-group"><label>Upload Bulk Data (Excel) <span class="req">*</span></label>';
    h+='<label class="btn btn-glass btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Choose File<input type="file" id="bulkFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="document.getElementById(\'bulkFName\').innerText=this.files[0].name"></label>';
    h+='<div id="bulkFName" style="font-size:11px;color:var(--text-muted);margin-top:4px">No file chosen</div></div>';
    h+='<div style="background:var(--bg-secondary);padding:10px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted);border:1px dashed var(--warning)"><strong style="color:var(--warning)">Excel Format:</strong><br>Vehicle No | LR No | Invoice No | Material | Material Description | EAN No | Qty | Customer</div>';
    showModal('Bulk Upload Invoices',h,'md',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="processBulkUpload()"><i class="bx bx-check-double"></i> Upload</button>');
}
function processBulkUpload(){
    var fi=document.getElementById('bulkFile');if(!fi||!fi.files[0]){showToast('Select a file','error');return;}
    var reader=new FileReader();
    reader.onload=function(e){
        try{
            var wb=XLSX.read(e.target.result,{type:'array'});var ws=wb.Sheets[wb.SheetNames[0]];var data=XLSX.utils.sheet_to_json(ws,{header:1});
            if(!data.length){showToast('Empty file','error');return;}
            // Column: 0=Vehicle, 1=LR, 2=InvoiceNo, 3=Material, 4=Description, 5=EAN, 6=Qty, 7=Customer
            var startRow=(String(data[0][3]||'').toLowerCase().indexOf('material')>-1)?1:0;
            var vMap={},cInv=0,cMat=0;
            for(var k=startRow;k<data.length;k++){
                var r=data[k];if(!r||!r[0]||!r[5])continue;
                var vNo=String(r[0]||'').trim().toUpperCase();
                var lr=String(r[1]||'').trim().toUpperCase();
                var invNo=String(r[2]||'').trim().toUpperCase();
                var mat=String(r[3]||'').trim();
                var desc=String(r[4]||'').trim();
                var ean=String(r[5]||'').trim().toUpperCase();
                var qty=parseInt(r[6])||0;
                var cust=String(r[7]||'').trim();
                if(!mat||!ean||!qty)continue;
                // Vehicle find or create
                if(!vMap[lr]){
                    var exV=DB.filter('vehicles',function(v){return v.lrNo&&v.lrNo.toUpperCase()===lr;});
                    if(exV.length>0)vMap[lr]={vid:exV[0].id,vNo:vNo,lr:lr,invs:{}};
                    else{var nv=DB.add('vehicles',{vehicleNo:vNo,lrNo:lr,driverName:'',driverMobile:'',transportName:'',vehicleType:'Unloading',status:'Unload Pending',reportedAt:new Date().toISOString(),entryBy:'',entryByName:'Bulk Upload'});vMap[lr]={vid:nv.id,vNo:vNo,lr:lr,invs:{}};}
                }
                // Invoice find or create
                if(!invNo)invNo='INV-'+Date.now().toString(36).toUpperCase().substr(0,4)+cInv;
                if(!vMap[lr].invs[invNo]){
                    DB.add('invoices',{vehicleId:vMap[lr].vid,invoiceNo:invNo,customer:cust,status:'Pending'});
                    vMap[lr].invs[invNo]={invNo:invNo};cInv++;
                }
                // Find invoice object
                var invList=DB.get('invoices'),invObj=null;
                for(var ii=invList.length-1;ii>=0;ii--){
                    if(invList[ii].vehicleId===vMap[lr].vid&&invList[ii].invoiceNo===invNo){invObj=invList[ii];break;}
                }
                if(invObj){DB.add('invoice_materials',{invoiceId:invObj.id,material:mat,description:desc,ean:ean,qty:qty,unloadedQty:0});cMat++;}
            }
            logAction('Inbound','BULK_UPLOAD',Object.keys(vMap).length+' vehicles, '+cInv+' invoices, '+cMat+' materials');
            showToast('Success! '+cInv+' invoices, '+cMat+' materials','success');
            closeModal();renderInbound('pending-vehicle');
        }catch(err){showToast('Excel error: '+err.message,'error');}
    };
    reader.readAsArrayBuffer(fi.files[0]);
}

// --- Assign Unloading ---
function showAssignUnloading(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var invs=DB.filter('invoices',function(i){return i.vehicleId===vehId;});
    if(!invs.length){showToast('Upload invoices first!','error');return;}
    var users=DB.get('users');
    var uOpts='<option value="">-- Select User --</option>';
    users.forEach(function(u){uOpts+='<option value="'+esc(u.id)+'">'+esc(u.name)+' ('+esc(u.username)+') — '+esc(u.id)+'</option>';});
    var h='<div style="background:var(--accent-dim);padding:12px;border-radius:var(--radius-sm);margin-bottom:14px"><strong style="color:var(--accent)">'+esc(v.vehicleNo)+'</strong> — '+esc(v.lrNo||'')+' | Invoices: '+invs.length+'</div>';
    h+='<div class="form-group"><label>Select User <span class="req">*</span></label><select id="assignUserSelect" class="form-input" onchange="document.getElementById(\'assignUserIdInput\').value=this.value">'+uOpts+'</select></div>';
    h+='<div class="form-group"><label>Or Type User ID <span class="req">*</span></label><input type="text" id="assignUserIdInput" class="form-input" placeholder="User ID..." style="font-family:var(--font-display);font-size:13px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();doAssignUnloading(\''+vehId+'\');}"></div>';
    h+='<div style="background:var(--bg-secondary);padding:10px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted);border:1px dashed var(--border)"><i class="bx bx-info-circle" style="color:var(--warning)"></i> Select a user from the dropdown or type a User ID</div>';
    showModal('Assign Unloading — '+v.vehicleNo,h,'md',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="doAssignUnloading(\''+vehId+'\')"><i class="bx bx-check"></i> Assign</button>');
    setTimeout(function(){document.getElementById('assignUserSelect').focus();},300);
}
function doAssignUnloading(vehId){
    var userId=document.getElementById('assignUserIdInput').value.trim();
    if(!userId){showToast('Please select or type a User ID','error');return;}
    var userObj=DB.find('users',userId);
    var userName=userObj?userObj.name:userId;
    DB.update('vehicles',vehId,{assignedTo:userId,assignedToName:userName,status:'Assigned'});
    addNotif('Vehicle assigned to '+userName+' ('+userId+')','info');
    logAction('Inbound','ASSIGN','Vehicle '+vehId+' assigned to '+userName);
    showToast('Vehicle assigned to '+userName,'success');
    closeModal();renderInbound('pending-vehicle');
}
function unassignVehicle(vehId){
    if(!confirm('Unassign this vehicle?'))return;
    DB.update('vehicles',vehId,{assignedTo:null,assignedToName:null,status:'Unload Pending'});
    logAction('Inbound','UNASSIGN','Vehicle '+vehId+' unassigned');
    showToast('Vehicle unassigned','success');renderInbound('pending-vehicle');
}

// --- Unloading Screen ---
function renderUnloadingScreen(){
    if(!APP.currentUser){setHtml('<div class="card"><div class="empty-state"><i class="bx bx-lock-alt"></i><p>Login required</p></div></div>');return;}
    var myId=APP.currentUser.id;
    var pendingVehs=DB.filter('vehicles',function(v){return v.assignedTo===myId&&(v.status==='Assigned'||v.status==='Unload Pending');});
    var partialVehs=DB.filter('vehicles',function(v){return v.assignedTo===myId&&v.status==='Partial Unload';});
    var h='<div class="section-header"><h2><i class="bx bx-package"></i> My Goods Receipt</h2>';
    h+='<div style="font-size:12px;color:var(--text-muted)">Pending: '+pendingVehs.length+' | Partial: '+partialVehs.length+'</div></div>';
    if(pendingVehs.length>0){
        h+='<div class="card" style="margin-bottom:16px"><div class="card-title"><i class="bx bx-time-five" style="color:var(--warning)"></i> Pending Start ('+pendingVehs.length+')</div>';
        pendingVehs.forEach(function(v){
            var invs=DB.filter('invoices',function(i){return i.vehicleId===v.id;});
            var matCount=0;invs.forEach(function(inv){matCount+=DB.filter('invoice_materials',function(m){return m.invoiceId===inv.id;}).length;});
            h+='<div style="border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:10px;background:var(--bg-card)">';
            h+='<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px"><div>';
            h+='<div style="font-size:16px;font-weight:800;color:var(--accent);font-family:var(--font-display);letter-spacing:1px">'+esc(v.vehicleNo)+'</div>';
            h+='<div style="font-size:11px;color:var(--text-muted);margin-top:2px">LR: '+esc(v.lrNo||'-')+' | Invoices: '+invs.length+' | Materials: '+matCount+'</div>';
            h+='</div>';
            if(chkAct('canStartUnloading'))h+='<button class="btn btn-primary" onclick="startUnload(\''+v.id+'\')"><i class="bx bx-play-circle"></i> START UNLOADING</button>';
            else h+='<button class="btn btn-glass" disabled><i class="bx bx-block"></i> No Permission</button>';
            h+='</div></div>';
        });
        h+='</div>';
    }
    if(partialVehs.length>0){
        h+='<div class="card" style="margin-bottom:16px"><div class="card-title"><i class="bx bx-loader-circle" style="color:var(--info)"></i> Resume Unloading ('+partialVehs.length+')</div>';
        partialVehs.forEach(function(v){
            var partials=DB.filter('partial_unloads',function(p){return p.vehicleId===v.id;});
            partials.sort(function(a,b){return new Date(b.savedAt)-new Date(a.savedAt);});
            var latest=partials[0];
            var scanCount=latest?(latest.scanHistory||[]).length:0;
            var savedTime=latest?fmtDT(latest.savedAt):'-';
            h+='<div style="border:2px solid var(--info);border-radius:var(--radius);padding:14px;margin-bottom:10px;background:rgba(var(--info-rgb),.05)">';
            h+='<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px"><div>';
            h+='<div style="font-size:16px;font-weight:800;color:var(--info);font-family:var(--font-display)">'+esc(v.vehicleNo)+' <span class="badge badge-warning" style="font-size:9px;vertical-align:middle">PARTIAL</span></div>';
            h+='<div style="font-size:11px;color:var(--text-muted);margin-top:2px">LR: '+esc(v.lrNo||'-')+' | Saved: '+savedTime+' | Scanned: <strong style="color:var(--info)">'+scanCount+'</strong></div>';
            h+='</div><div style="display:flex;gap:6px">';
            h+='<button class="btn btn-info" onclick="resumePartialUnload(\''+v.id+'\')"><i class="bx bx-refresh"></i> RESUME</button>';
            h+='<button class="btn btn-danger btn-sm" onclick="discardPartialUnload(\''+v.id+'\')"><i class="bx bx-trash"></i> Discard</button>';
            h+='</div></div></div>';
        });
        h+='</div>';
    }
    if(!pendingVehs.length&&!partialVehs.length){
        h+='<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p style="font-size:15px;margin-bottom:6px">No vehicles assigned to you</p><p style="font-size:12px">Ask Admin to assign a vehicle</p></div></div>';
    }
    setHtml(h);
}

// --- Start Unload (Screenshot Format — Manual + Scan + Editable History) ---
function startUnload(vehId,existingData){
    var v=DB.find('vehicles',vehId);if(!v)return;
    if(!v.unloadStartedAt)DB.update('vehicles',vehId,{unloadStartedAt:new Date().toISOString()});
    var invs=DB.filter('invoices',function(i){return i.vehicleId===vehId;});

    // === SILENT BACKGROUND LOOKUP — nothing is shown to the operator ===
    var materialEntries=[],eanIndex={},matIndex={};
    invs.forEach(function(inv){
        DB.filter('invoice_materials',function(m){return m.invoiceId===inv.id;}).forEach(function(m){
            var ean=(m.ean||'').toUpperCase();
            var matUp=(m.material||'').toUpperCase();
            var idx=eanIndex[ean];
            if(idx===undefined) idx=matIndex[matUp];
            if(idx!==undefined){
                materialEntries[idx].totalQty+=m.qty;
                materialEntries[idx].baseRemaining+=(m.qty-(m.unloadedQty||0));
                if(!materialEntries[idx].ean&&ean){materialEntries[idx].ean=ean;eanIndex[ean]=idx;}
            }else{
                idx=materialEntries.length;
                materialEntries.push({material:m.material,description:m.description||'',ean:ean,uom:'PCS',totalQty:m.qty,baseRemaining:m.qty-(m.unloadedQty||0),sessionScanned:0});
                if(ean)eanIndex[ean]=idx;
                if(matUp)matIndex[matUp]=idx;
            }
        });
    });

    // Restore from resume
    var scanHistory=[];
    if(existingData&&existingData.scanHistory){
        scanHistory=existingData.scanHistory||[];
        scanHistory.forEach(function(sh){
            if(sh.matched&&sh.entryIdx!==undefined&&sh.entryIdx!==null&&materialEntries[sh.entryIdx]){
                materialEntries[sh.entryIdx].sessionScanned+=sh.qty;
            }
        });
    }

    window._unloadData={vehId:vehId,vehicleNo:v.vehicleNo,lrNo:v.lrNo,materialEntries:materialEntries,eanIndex:eanIndex,matIndex:matIndex,scanHistory:scanHistory,currentMatchIdx:null,editingIdx:-1};

    // === BUILD UI (SAP Fiori style) ===
    var h='';

    // Object header strip
    h+='<div style="background:#fff;border:1px solid #D9D9D9;border-radius:8px;margin-bottom:12px;padding:12px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
    h+='<div style="width:44px;height:44px;border-radius:10px;background:#EBF5FE;color:#0A6ED1;display:flex;align-items:center;justify-content:center;font-size:24px"><i class="bx bx-truck"></i></div>';
    h+='<div style="flex:1;min-width:200px"><div style="font-size:18px;font-weight:700;color:#32363A">'+esc(v.vehicleNo)+' <span style="font-weight:400;font-size:12px;color:#6A6D70">· LR '+esc(v.lrNo||'-')+'</span></div>';
    h+='<div style="font-size:12px;color:#6A6D70;margin-top:2px">Goods Receipt — Unloading · Plant MD20</div></div>';
    h+='<div style="text-align:right"><div style="font-size:11px;color:#6A6D70;text-transform:uppercase;letter-spacing:.5px">Scan Entries</div><div id="ulScanCount" style="font-size:22px;font-weight:800;color:#0A6ED1;line-height:1">'+scanHistory.length+'</div></div>';
    h+='</div>';

    // SCAN ENTRY panel
    h+='<div class="card" style="margin-bottom:12px">';
    h+='<div class="card-title"><i class="bx bx-barcode"></i> Scan / Manual Entry</div>';
    h+='<div class="form-row" style="grid-template-columns:1.3fr 1fr .45fr;align-items:end;margin-bottom:10px">';
    h+='<div class="form-group"><label>EAN / Barcode</label>';
    h+='<input type="text" id="ulScanEan" class="form-input" placeholder="Scan or type EAN code..." style="font-family:var(--font-display);font-size:15px;letter-spacing:1px;padding:10px 12px"></div>';
    h+='<div class="form-group"><label>Material Code</label>';
    h+='<input type="text" id="ulScanMat" class="form-input" placeholder="Enter material code..." style="text-transform:uppercase;padding:10px 12px"></div>';
    h+='<div class="form-group"><label>Qty</label>';
    h+='<input type="number" id="ulScanQty" class="form-input" value="1" min="1" style="text-align:center;font-weight:800;font-size:16px;padding:10px"></div>';
    h+='</div>';
    h+='<div class="form-actions" style="margin-top:0">';
    h+='<button class="btn btn-primary" id="ulBtnSubmit"><i class="bx bx-check-circle"></i> Submit Entry</button>';
    h+='<button class="btn btn-glass" id="ulBtnScanner"><i class="bx bx-qr"></i> Open Scanner</button>';
    h+='</div></div>';

    // MATERIAL DETAILS — proper row/column table
    h+='<div class="card" style="margin-bottom:12px">';
    h+='<div class="card-title"><i class="bx bx-info-circle"></i> Material Details (Auto-filled)</div>';
    h+='<div class="table-wrapper" style="border-radius:0"><table class="data-table"><thead><tr><th style="width:28%">Material</th><th>Description</th><th style="width:10%">UOM</th><th style="width:18%">Remaining Qty</th></tr></thead><tbody>';
    h+='<tr id="ulAutoBox" style="border:2px solid var(--border);transition:border-color .3s">';
    h+='<td style="padding:0"><input type="text" id="ulAutoMat" class="form-input" placeholder="—" style="border:none;background:transparent;color:var(--text-muted);font-weight:700;padding:9px 12px;border-radius:0;font-size:13px"></td>';
    h+='<td style="padding:0"><input type="text" id="ulAutoDesc" class="form-input" placeholder="—" style="border:none;background:transparent;color:var(--text-muted);padding:9px 12px;border-radius:0;font-size:13px"></td>';
    h+='<td style="padding:0"><input type="text" id="ulAutoUom" class="form-input" placeholder="—" style="border:none;background:transparent;color:var(--text-muted);font-weight:600;padding:9px 12px;border-radius:0;font-size:13px"></td>';
    h+='<td style="padding:0"><div id="ulAutoRem" class="form-input" style="border:none;background:transparent;color:var(--text-muted);font-size:16px;font-weight:800;padding:9px 12px;border-radius:0;font-family:var(--font-display)">—</div></td>';
    h+='</tr></tbody></table></div></div>';

    // SCAN HISTORY — proper row/column table
    h+='<div class="card">';
    h+='<div class="card-title"><i class="bx bx-history"></i> Scan History (latest first)</div>';
    h+='<div id="ulScanHistory"></div>';
    h+='</div>';

    // Footer
    var footer='';
    footer+='<button class="btn btn-glass" id="ulBtnSave"><i class="bx bx-save"></i> Save & Back</button>';
    footer+='<button class="btn btn-glass" onclick="closeModal()">Cancel</button>';
    footer+='<button class="btn btn-primary" id="ulBtnFinish"><i class="bx bx-check-double"></i> Finish Unloading</button>';

    showModal('Goods Receipt — '+v.vehicleNo,h,'xl',footer);
    renderScanHistory();

    // === EVENT LISTENERS ===
    setTimeout(function(){
        var el;
        el=document.getElementById('ulScanEan');
        if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();e.stopPropagation();doLookupScan('ean');}});
        el=document.getElementById('ulScanMat');
        if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();e.stopPropagation();doLookupScan('mat');}});
        el=document.getElementById('ulBtnSubmit');
        if(el)el.addEventListener('click',function(){doSubmitScan();});
        el=document.getElementById('ulScanQty');
        if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();e.stopPropagation();doSubmitScan();}});
        el=document.getElementById('ulBtnScanner');
        if(el)el.addEventListener('click',function(){openScanner(function(code){var inp=document.getElementById('ulScanEan');if(inp)inp.value=code;doLookupScan('ean');});});
        el=document.getElementById('ulBtnSave');
        if(el)el.addEventListener('click',function(){savePartialUnload();});
        el=document.getElementById('ulBtnFinish');
        if(el)el.addEventListener('click',function(){finishUnloading();});
        var eanInp=document.getElementById('ulScanEan');if(eanInp)eanInp.focus();
    },250);
}

// --- Lookup: invoice me dhundo, nahi mila to Material Master (Supabase) se auto-fill ---
var _ulLookupSeq=0;
function ulFillAuto(mat,desc,uom,rem,state){
    var matEl=document.getElementById('ulAutoMat'),descEl=document.getElementById('ulAutoDesc'),uomEl=document.getElementById('ulAutoUom'),remEl=document.getElementById('ulAutoRem'),boxEl=document.getElementById('ulAutoBox');
    if(!matEl)return;
    matEl.value=mat||'';descEl.value=desc||'';uomEl.value=uom||'PCS';
    var col=state==='extra'?'var(--warning)':'var(--accent)';
    var bg=state==='extra'?'rgba(var(--warning-rgb),.10)':'var(--accent-dim)';
    [matEl,uomEl].forEach(function(e){e.style.color=col;e.style.background=bg;});
    descEl.style.color='var(--text-primary)';descEl.style.background=bg;
    if(state==='extra'){remEl.textContent='NOT IN INVOICE';remEl.style.color='var(--warning)';remEl.style.background=bg;}
    else if(rem>0){remEl.textContent=rem;remEl.style.color='var(--accent)';remEl.style.background=bg;}
    else if(rem===0){remEl.textContent='COMPLETE';remEl.style.color='var(--success)';remEl.style.background='rgba(0,255,136,.1)';}
    else{remEl.textContent='EXCESS (+'+Math.abs(rem)+')';remEl.style.color='var(--danger)';remEl.style.background='rgba(255,107,107,.1)';}
    boxEl.style.borderColor=col;
}
async function doLookupScan(type){
    var ud=window._unloadData;if(!ud)return;
    var val='';
    if(type==='ean') val=(document.getElementById('ulScanEan').value||'').trim().toUpperCase();
    else val=(document.getElementById('ulScanMat').value||'').trim().toUpperCase();
    if(!val){showToast('Enter an EAN or Material Code','error');return;}
    var seq=++_ulLookupSeq;

    // 1) Invoice wale materials me dhundo
    var matchIdx=ud.eanIndex[val];
    if(matchIdx===undefined) matchIdx=ud.matIndex[val];
    if(matchIdx!==undefined&&ud.materialEntries[matchIdx]){
        var entry=ud.materialEntries[matchIdx];
        ud.currentMatchIdx=matchIdx;
        ulFillAuto(entry.material,entry.description,entry.uom,entry.baseRemaining-entry.sessionScanned,'match');
        // dusra field bhi auto bharo (EAN scan -> material code, material -> EAN)
        var eanEl=document.getElementById('ulScanEan'),matIn=document.getElementById('ulScanMat');
        if(eanEl&&!eanEl.value&&entry.ean)eanEl.value=entry.ean;
        if(matIn&&!matIn.value)matIn.value=entry.material||'';
        var q=document.getElementById('ulScanQty');q.focus();q.select();
        return;
    }

    // 2) Not in invoice — auto-fill from Material Master (Supabase)
    ud.currentMatchIdx=null;
    clearAutoFill();
    var mm=null;
    try{ var f=await sbFindMaterialAny(val); mm=f?f.row:null; }catch(e){ mm=null; }
    if(seq!==_ulLookupSeq)return;           // beech me naya scan aa gaya — purana result ignore
    if(!window._unloadData)return;          // modal band ho gaya
    if(mm){
        window._unloadData.currentMatchIdx=null;   // invoice me nahi => No Match (excess/wrong item) hi record hoga
        ulFillAuto(mm.material||val,mm.description||'',mm.uom||mm.baseUom||'PCS',0,'extra');
        var eanEl2=document.getElementById('ulScanEan'),matIn2=document.getElementById('ulScanMat');
        if(eanEl2&&!eanEl2.value&&mm.ean)eanEl2.value=String(mm.ean).toUpperCase();
        if(matIn2&&!matIn2.value)matIn2.value=mm.material||'';
        showToast((mm.material||val)+' — Not in invoice (details loaded from Material Master)','warning');
        var q2=document.getElementById('ulScanQty');q2.focus();q2.select();
    }else{
        showToast('Material Not Found in Invoice or Material Master.','error');
        var inp=type==='ean'?document.getElementById('ulScanEan'):document.getElementById('ulScanMat');
        if(inp){inp.style.borderColor='var(--danger)';inp.style.boxShadow='0 0 12px rgba(255,107,107,.4)';setTimeout(function(){inp.style.borderColor='';inp.style.boxShadow='';},1000);}
        var am=document.getElementById('ulAutoMat');if(am)am.focus();
    }
}

// --- Clear auto-fill ---
function clearAutoFill(){
    var ud=window._unloadData;if(ud)ud.currentMatchIdx=null;
    ['ulAutoMat','ulAutoDesc','ulAutoUom'].forEach(function(id){
        var el=document.getElementById(id);if(el){el.value='';el.style.color='var(--text-muted)';el.style.background='var(--bg-card)';}
    });
    var remEl=document.getElementById('ulAutoRem');if(remEl){remEl.textContent='—';remEl.style.color='var(--text-muted)';remEl.style.background='var(--bg-card)';}
    var box=document.getElementById('ulAutoBox');if(box)box.style.borderColor='var(--border)';
}

// --- Submit scan ---
function doSubmitScan(){
    var ud=window._unloadData;if(!ud)return;
    var eanVal=(document.getElementById('ulScanEan').value||'').trim().toUpperCase();
    var matVal=(document.getElementById('ulAutoMat').value||'').trim();
    var descVal=(document.getElementById('ulAutoDesc').value||'').trim();
    var uomVal=(document.getElementById('ulAutoUom').value||'').trim()||'PCS';
    var qtyVal=parseInt(document.getElementById('ulScanQty').value)||0;

    if(!matVal){showToast('Enter material name','error');document.getElementById('ulAutoMat').focus();return;}
    if(qtyVal<1){showToast('Enter minimum 1 qty','error');document.getElementById('ulScanQty').focus();return;}

    var matched=ud.currentMatchIdx!==null;
    var entryIdx=ud.currentMatchIdx;

    ud.scanHistory.push({ts:new Date().toISOString(),ean:eanVal,material:matVal,description:descVal,uom:uomVal,qty:qtyVal,matched:matched,entryIdx:entryIdx});

    if(matched&&entryIdx!==null&&ud.materialEntries[entryIdx]) ud.materialEntries[entryIdx].sessionScanned+=qtyVal;

    var countEl=document.getElementById('ulScanCount');if(countEl)countEl.textContent=ud.scanHistory.length;

    if(matched) showToast(matVal+' — '+qtyVal+' '+uomVal+' submitted','success');
    else showToast(matVal+' — '+qtyVal+' '+uomVal+' (Manual Entry)','warning');

    document.getElementById('ulScanEan').value='';
    document.getElementById('ulScanMat').value='';
    document.getElementById('ulScanQty').value='1';
    clearAutoFill();
    renderScanHistory();
    var eanInp=document.getElementById('ulScanEan');if(eanInp)eanInp.focus();
}

// --- Render scan history with edit/delete ---
function renderScanHistory(){
    var ud=window._unloadData;if(!ud)return;
    var container=document.getElementById('ulScanHistory');if(!container)return;

    if(!ud.scanHistory.length){
        container.innerHTML='<div class="empty-state" style="padding:28px 16px"><i class="bx bx-inbox"></i><p style="font-size:13px">No scan entries yet</p><p style="font-size:11px;margin-top:2px">Scan an EAN code or enter it manually</p></div>';
        return;
    }

    var h='<div class="table-wrapper" style="border-radius:0"><table class="data-table"><thead><tr><th style="width:34px">#</th><th>EAN</th><th>Material</th><th>Description</th><th style="width:56px">Qty</th><th style="width:54px">UOM</th><th style="width:86px">Status</th><th style="width:118px">Time</th><th style="width:86px">Actions</th></tr></thead><tbody>';
    for(var i=ud.scanHistory.length-1;i>=0;i--){
        var s=ud.scanHistory[i];
        if(ud.editingIdx===i){
            // === EDIT MODE — inline row edit (SAP ALV style) ===
            h+='<tr style="background:rgba(var(--warning-rgb),.07)">';
            h+='<td>'+(i+1)+'</td>';
            h+='<td style="padding:3px"><input class="form-input" id="edE_'+i+'" value="'+esc(s.ean||'')+'" style="padding:4px 8px;font-size:11px;font-family:var(--font-display)"></td>';
            h+='<td style="padding:3px"><input class="form-input" id="edM_'+i+'" value="'+esc(s.material)+'" style="padding:4px 8px;font-size:11px"></td>';
            h+='<td style="padding:3px"><input class="form-input" id="edD_'+i+'" value="'+esc(s.description||'')+'" style="padding:4px 8px;font-size:11px"></td>';
            h+='<td style="padding:3px"><input type="number" class="form-input" id="edQ_'+i+'" value="'+s.qty+'" min="1" style="padding:4px 8px;font-size:11px;text-align:center;font-weight:700;width:54px"></td>';
            h+='<td style="padding:3px"><input class="form-input" id="edU_'+i+'" value="'+esc(s.uom)+'" style="padding:4px 8px;font-size:11px;text-align:center;width:52px"></td>';
            h+='<td colspan="2"><span class="badge badge-warning">Editing</span></td>';
            h+='<td style="padding:3px"><div class="table-actions"><button class="btn btn-glass btn-sm" id="edC_'+i+'" title="Cancel"><i class="bx bx-x"></i></button><button class="btn btn-primary btn-sm" id="edS_'+i+'" title="Save"><i class="bx bx-check"></i></button></div></td>';
            h+='</tr>';
        }else{
            // === NORMAL MODE — table row ===
            h+='<tr class="'+(s.matched?'scan-row-green':'scan-row-red')+'">';
            h+='<td>'+(i+1)+'</td>';
            h+='<td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean||'Manual')+'</td>';
            h+='<td style="font-weight:600;font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.material)+'</td>';
            h+='<td style="font-size:11px;color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.description||'-')+'</td>';
            h+='<td><b style="font-family:var(--font-display);font-size:14px;color:'+(s.matched?'var(--success)':'var(--danger)')+'">'+s.qty+'</b></td>';
            h+='<td>'+esc(s.uom)+'</td>';
            h+='<td>'+(s.matched?'<span class="badge badge-success">Matched</span>':'<span class="badge badge-danger">No Match</span>')+'</td>';
            h+='<td style="font-size:10px;color:var(--text-muted)">'+fmtDT(s.ts)+'</td>';
            h+='<td><div class="table-actions"><button class="btn btn-glass btn-sm" id="ebE_'+i+'" title="Edit"><i class="bx bx-pencil"></i></button><button class="btn btn-danger btn-sm" id="ebD_'+i+'" title="Delete"><i class="bx bx-trash"></i></button></div></td>';
            h+='</tr>';
        }
    }
    h+='</tbody></table></div>';
    container.innerHTML=h;

    // Listeners
    ud.scanHistory.forEach(function(s,i){
        var el;
        el=document.getElementById('ebE_'+i);if(el)el.addEventListener('click',function(){ud.editingIdx=i;renderScanHistory();});
        el=document.getElementById('ebD_'+i);if(el)el.addEventListener('click',function(){deleteScanEntry(i);});
        el=document.getElementById('edS_'+i);if(el)el.addEventListener('click',function(){saveEditScan(i);});
        el=document.getElementById('edC_'+i);if(el)el.addEventListener('click',function(){ud.editingIdx=-1;renderScanHistory();});
        ['edM_'+i,'edD_'+i,'edQ_'+i,'edU_'+i,'edE_'+i].forEach(function(fid){
            var fe=document.getElementById(fid);if(fe)fe.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();saveEditScan(i);}});
        });
    });
}

// --- Delete scan entry ---
function deleteScanEntry(idx){
    var ud=window._unloadData;if(!ud)return;
    var s=ud.scanHistory[idx];if(!s)return;
    if(s.matched&&s.entryIdx!==null&&s.entryIdx!==undefined&&ud.materialEntries[s.entryIdx]){
        ud.materialEntries[s.entryIdx].sessionScanned=Math.max(0,ud.materialEntries[s.entryIdx].sessionScanned-s.qty);
    }
    ud.scanHistory.splice(idx,1);ud.editingIdx=-1;
    var countEl=document.getElementById('ulScanCount');if(countEl)countEl.textContent=ud.scanHistory.length;
    renderScanHistory();showToast('Entry removed','warning');
}

// --- Save edited scan entry ---
function saveEditScan(idx){
    var ud=window._unloadData;if(!ud)return;
    var s=ud.scanHistory[idx];if(!s)return;
    var newM=(document.getElementById('edM_'+idx).value||'').trim();
    var newEan=(document.getElementById('edE_'+idx)||{value:''}).value||'';
    newEan=newEan.trim().toUpperCase();
    var newD=(document.getElementById('edD_'+idx).value||'').trim();
    var newQ=parseInt(document.getElementById('edQ_'+idx).value)||0;
    var newU=(document.getElementById('edU_'+idx).value||'').trim()||'PCS';
    if(!newM){showToast('Material name required','error');return;}
    if(newQ<1){showToast('Minimum 1 qty','error');return;}
    if(s.matched&&s.entryIdx!==null&&s.entryIdx!==undefined&&ud.materialEntries[s.entryIdx]){
        ud.materialEntries[s.entryIdx].sessionScanned=Math.max(0,ud.materialEntries[s.entryIdx].sessionScanned-s.qty+newQ);
    }
    s.material=newM;s.ean=newEan||s.ean;s.description=newD;s.qty=newQ;s.uom=newU;
    ud.editingIdx=-1;renderScanHistory();showToast('Entry updated','success');
}

// --- Resume Partial ---
function resumePartialUnload(vehId){
    var partials=DB.filter('partial_unloads',function(p){return p.vehicleId===vehId;});
    partials.sort(function(a,b){return new Date(b.savedAt)-new Date(a.savedAt);});
    startUnload(vehId,partials[0]||null);
}

// --- Save Partial ---
function savePartialUnload(){
    var ud=window._unloadData;if(!ud)return;
    if(!ud.scanHistory.length){showToast('At least one scan entry is required','error');return;}
    ud.editingIdx=-1;
    var existing=DB.filter('partial_unloads',function(p){return p.vehicleId===ud.vehId;});
    if(existing.length>0) DB.update('partial_unloads',existing[0].id,{scanHistory:ud.scanHistory,savedAt:new Date().toISOString(),savedBy:APP.currentUser?APP.currentUser.name:'Unknown'});
    else DB.add('partial_unloads',{vehicleId:ud.vehId,vehicleNo:ud.vehicleNo,lrNo:ud.lrNo,scanHistory:ud.scanHistory,savedAt:new Date().toISOString(),savedBy:APP.currentUser?APP.currentUser.name:'Unknown'});
    DB.update('vehicles',ud.vehId,{status:'Partial Unload'});
    logAction('Unloading','PARTIAL_SAVE','Partial saved for '+ud.vehicleNo+' ('+ud.scanHistory.length+' scans)');
    showToast('Progress saved!','success');closeModal();renderUnloadingScreen();
}

// --- Discard Partial ---
function discardPartialUnload(vehId){
    if(!confirm('Partial data will be deleted. Are you sure?'))return;
    DB.filter('partial_unloads',function(p){return p.vehicleId===vehId;}).forEach(function(p){DB.remove('partial_unloads',p.id);});
    DB.update('vehicles',vehId,{status:'Assigned'});showToast('Discarded','warning');renderUnloadingScreen();
}

// --- Finish Unloading ---
function finishUnloading(){
    var ud=window._unloadData;if(!ud)return;
    if(!ud.scanHistory.length){showToast('At least one scan entry is required','error');return;}
    ud.editingIdx=-1;
    var unloadNo=DB.unloadNo();
    var invIdsAll=DB.filter('invoices',function(i){return i.vehicleId===ud.vehId;}).map(function(i){return i.id;});
    var materials=[],shortItems=[],excessItems=[],wrongItems=[];
    ud.materialEntries.forEach(function(entry){
        var scanned=entry.sessionScanned,expected=entry.totalQty;
        materials.push({invoiceNo:'',material:entry.material,ean:entry.ean,expectedQty:expected,scannedQty:scanned,diff:expected-scanned,match:true});
        if(scanned<expected) shortItems.push({invoiceNo:'',material:entry.material,ean:entry.ean,expected:expected,scanned:scanned,short:expected-scanned});
        if(scanned>expected) excessItems.push({invoiceNo:'',material:entry.material,ean:entry.ean,expected:expected,scanned:scanned,excess:scanned-expected});
    });
    ud.scanHistory.forEach(function(s){if(!s.matched) wrongItems.push({ean:s.ean,material:s.material,scannedQty:s.qty});});

    var partials=DB.filter('partial_unloads',function(p){return p.vehicleId===ud.vehId;});
    var wasPartial=partials.length>0,partialSessions=wasPartial?partials.length:0;

    DB.add('unloading_records',{startedAt:((DB.find('vehicles',ud.vehId)||{}).unloadStartedAt||''),invoiceNos:invIdsAll.map(function(id){return (DB.find('invoices',id)||{}).invoiceNo;}),wrongItems:wrongItems,unloadNo:unloadNo,vehicleId:ud.vehId,vehicleNo:ud.vehicleNo,lrNo:ud.lrNo,unloadedBy:APP.currentUser.id,unloadedByName:APP.currentUser.name,unloadedAt:new Date().toISOString(),materials:materials,status:'Posting Pending Approval',wasPartial:wasPartial,partialSessions:partialSessions});
    DB.update('vehicles',ud.vehId,{status:'Posting Pending Approval',unloadNo:unloadNo,unloadedBy:APP.currentUser.id,unloadedByName:APP.currentUser.name,unloadedAt:new Date().toISOString()});

    ud.materialEntries.forEach(function(entry){
        if(entry.sessionScanned<=0)return;
        var remaining=entry.sessionScanned,lastIm=null;
        DB.filter('invoice_materials',function(m){return m.ean&&m.ean.toUpperCase()===entry.ean&&invIdsAll.indexOf(m.invoiceId)>-1;}).forEach(function(im){
            lastIm=im;
            if(remaining<=0)return;
            var toUnload=Math.min(remaining,im.qty-(im.unloadedQty||0));
            if(toUnload>0){DB.update('invoice_materials',im.id,{unloadedQty:(im.unloadedQty||0)+toUnload});remaining-=toUnload;}
        });
        if(remaining>0&&lastIm){var cur=DB.find('invoice_materials',lastIm.id);DB.update('invoice_materials',lastIm.id,{unloadedQty:(cur.unloadedQty||0)+remaining,excessQty:(cur.excessQty||0)+remaining});}
    });
    var wrongAgg={};
    wrongItems.forEach(function(w){var k=w.ean||w.material;if(!wrongAgg[k])wrongAgg[k]={ean:w.ean,material:w.material,qty:0};wrongAgg[k].qty+=w.scannedQty;});
    for(var wk in wrongAgg){var w=wrongAgg[wk];if(invIdsAll[0]&&w.qty>0)DB.add('invoice_materials',{invoiceId:invIdsAll[0],material:w.material||w.ean,description:'Not in invoice (excess)',ean:w.ean,qty:0,unloadedQty:w.qty,excessQty:w.qty,extra:true});}

    partials.forEach(function(p){DB.remove('partial_unloads',p.id);});

    var hasDiscrepancy=shortItems.length>0||excessItems.length>0||wrongItems.length>0;
    var reportId=null;
    if(hasDiscrepancy){
        var reportNo=generateSERNo();
        var totalExp=0,totalScn=0;
        materials.forEach(function(m){totalExp+=m.expectedQty;totalScn+=m.scannedQty;});
        reportId=DB.add('short_excess_reports',{reportNo:reportNo,vehicleNo:ud.vehicleNo,lrNo:ud.lrNo,unloadNo:unloadNo,shortItems:shortItems,excessItems:excessItems,wrongItems:wrongItems,totalExpected:totalExp,totalScanned:totalScn,wasPartial:wasPartial,partialSessions:partialSessions,createdBy:APP.currentUser.name,createdAt:new Date().toISOString()}).id;
    }

    addNotif('Unloading '+unloadNo+' submitted for '+ud.vehicleNo,'warning');
    logAction('Unloading','SUBMIT',unloadNo+' for '+ud.vehicleNo);
    showToast('Unloading submitted!','success');closeModal();
    renderUnloadingScreen();
    setTimeout(function(){showUnloadReport(unloadNo);},400);
}

function generateSERNo(){return 'SER-'+new Date().getFullYear()+'-'+String(DB.get('short_excess_reports').length+1).padStart(4,'0');}

// --- Short/Excess Report ---
function showSEReport(reportId){
    var report=DB.find('short_excess_reports',reportId);if(!report)return;
    var h='<div style="text-align:center;margin-bottom:16px"><div style="font-size:22px;font-weight:900;color:var(--accent);font-family:var(--font-display);letter-spacing:3px">'+esc(report.reportNo)+'</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">Short / Excess / Wrong Report</div></div>';
    h+='<div style="display:flex;gap:14px;margin-bottom:14px;font-size:11px;flex-wrap:wrap;background:var(--bg-secondary);padding:10px;border-radius:var(--radius-sm)"><span><strong>Vehicle:</strong> '+esc(report.vehicleNo)+'</span><span><strong>LR:</strong> '+esc(report.lrNo||'-')+'</span><span><strong>Unload:</strong> '+esc(report.unloadNo)+'</span><span><strong>Date:</strong> '+fmtDT(report.createdAt)+'</span><span><strong>By:</strong> '+esc(report.createdBy)+'</span></div>';
    h+='<div style="display:flex;gap:10px;margin-bottom:14px">';
    h+='<div style="flex:1;padding:12px;background:var(--accent-dim);border-radius:var(--radius-sm);text-align:center;border:1px solid var(--accent)"><div style="font-size:22px;font-weight:900;color:var(--accent);font-family:var(--font-display)">'+report.totalExpected+'</div><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Expected</div></div>';
    h+='<div style="flex:1;padding:12px;background:rgba(0,255,136,.06);border-radius:var(--radius-sm);text-align:center;border:1px solid var(--success)"><div style="font-size:22px;font-weight:900;color:var(--success);font-family:var(--font-display)">'+report.totalScanned+'</div><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Scanned</div></div>';
    h+='<div style="flex:1;padding:12px;background:rgba(255,107,107,.06);border-radius:var(--radius-sm);text-align:center;border:1px solid var(--danger)"><div style="font-size:22px;font-weight:900;color:var(--danger);font-family:var(--font-display)">'+(report.totalExpected-report.totalScanned)+'</div><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Difference</div></div>';
    h+='</div>';
    if(report.shortItems&&report.shortItems.length){
        h+='<div class="card-title" style="color:var(--warning);margin-top:8px"><i class="bx bx-minus-circle"></i> Short Items ('+report.shortItems.length+')</div>';
        h+='<div class="table-wrapper" style="max-height:160px;overflow-y:auto"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Short</th></tr></thead><tbody>';
        report.shortItems.forEach(function(s){h+='<tr style="background:rgba(255,193,7,.05)"><td>'+esc(s.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td>'+s.expected+'</td><td>'+s.scanned+'</td><td><strong style="color:var(--danger)">-'+s.short+'</strong></td></tr>';});
        h+='</tbody></table></div>';
    }
    if(report.excessItems&&report.excessItems.length){
        h+='<div class="card-title" style="color:var(--danger);margin-top:12px"><i class="bx bx-plus-circle"></i> Excess Items ('+report.excessItems.length+')</div>';
        h+='<div class="table-wrapper" style="max-height:160px;overflow-y:auto"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Excess</th></tr></thead><tbody>';
        report.excessItems.forEach(function(s){h+='<tr style="background:rgba(255,107,107,.05)"><td>'+esc(s.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td>'+s.expected+'</td><td>'+s.scanned+'</td><td><strong style="color:var(--danger)">+'+s.excess+'</strong></td></tr>';});
        h+='</tbody></table></div>';
    }
    if(report.wrongItems&&report.wrongItems.length){
        h+='<div class="card-title" style="color:var(--danger);margin-top:12px"><i class="bx bx-x-circle"></i> Wrong Items ('+report.wrongItems.length+')</div>';
        h+='<div class="table-wrapper" style="max-height:140px;overflow-y:auto"><table class="data-table"><thead><tr><th>EAN</th><th>Material</th><th>Qty</th></tr></thead><tbody>';
        report.wrongItems.forEach(function(s){h+='<tr style="background:rgba(255,107,107,.08)"><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td>'+esc(s.material)+'</td><td><strong style="color:var(--danger)">'+s.scannedQty+'</strong></td></tr>';});
        h+='</tbody></table></div>';
    }
    h+='<div class="form-actions" style="margin-top:16px"><button class="btn btn-glass" onclick="closeModal()"><i class="bx bx-x"></i> Close</button></div>';
    showModal('Discrepancy Report',h,'xl','');
}

// --- PDF Download ---
function downloadSERPDF(reportId){
    var report=DB.find('short_excess_reports',reportId);if(!report){showToast('Report not found','error');return;}
    var jsPDF=window.jspdf.jsPDF;var doc=new jsPDF({unit:'mm',format:'a4'});var y=15;
    doc.setFillColor(15,23,42);doc.rect(0,0,210,40,'F');
    doc.setTextColor(0,255,136);doc.setFontSize(18);doc.setFont('helvetica','bold');doc.text('SHORT / EXCESS REPORT',105,y+8,{align:'center'});
    doc.setTextColor(200,200,200);doc.setFontSize(10);doc.setFont('helvetica','normal');doc.text(report.reportNo,105,y+18,{align:'center'});
    doc.setTextColor(150,150,150);doc.setFontSize(8);doc.text('Generated: '+fmtDT(new Date()),105,y+26,{align:'center'});
    y=48;doc.setDrawColor(0,255,136);doc.setLineWidth(0.5);doc.rect(10,y,190,22);
    doc.setTextColor(30,30,30);doc.setFontSize(9);doc.setFont('helvetica','bold');
    doc.text('Vehicle: '+report.vehicleNo,15,y+7);doc.text('LR: '+(report.lrNo||'-'),80,y+7);doc.text('Unload: '+report.unloadNo,140,y+7);
    doc.text('By: '+report.createdBy,15,y+16);doc.text('Date: '+fmtDT(report.createdAt),80,y+16);
    y=78;doc.setFillColor(240,240,240);doc.roundedRect(10,y,58,18,3,3,'F');doc.roundedRect(76,y,58,18,3,3,'F');doc.roundedRect(142,y,58,18,3,3,'F');
    doc.setFontSize(14);doc.setFont('helvetica','bold');doc.setTextColor(0,100,200);doc.text(String(report.totalExpected),39,y+12,{align:'center'});
    doc.setTextColor(0,180,80);doc.text(String(report.totalScanned),105,y+12,{align:'center'});
    doc.setTextColor(220,50,50);doc.text(String(report.totalExpected-report.totalScanned),171,y+12,{align:'center'});
    doc.setFontSize(7);doc.setTextColor(100,100,100);doc.setFont('helvetica','normal');doc.text('EXPECTED',39,y+17,{align:'center'});doc.text('SCANNED',105,y+17,{align:'center'});doc.text('DIFFERENCE',171,y+17,{align:'center'});
    y=104;
    function addTH(cols,w){doc.setFillColor(30,40,60);doc.rect(10,y,190,8,'F');doc.setTextColor(255,255,255);doc.setFontSize(7);doc.setFont('helvetica','bold');var x=12;cols.forEach(function(c,i){doc.text(c,x,y+5.5);x+=w[i];});y+=10;}
    function addTR(cells,w,alt){if(alt){doc.setFillColor(245,245,245);doc.rect(10,y-3,190,7,'F');}doc.setTextColor(30,30,30);doc.setFontSize(7);doc.setFont('helvetica','normal');var x=12;cells.forEach(function(c,i){doc.text(String(c),x,y+1);x+=w[i];});y+=6;}
    function chkPg(n){if(y+n>280){doc.addPage();y=15;}}
    if(report.shortItems&&report.shortItems.length){chkPg(30);doc.setTextColor(200,120,0);doc.setFontSize(10);doc.setFont('helvetica','bold');doc.text('SHORT ITEMS ('+report.shortItems.length+')',10,y);y+=6;addTH(['Material','EAN','Invoice','Expected','Scanned','Short'],[55,40,35,20,20,20]);report.shortItems.forEach(function(s,i){chkPg(8);addTR([s.material||'-',s.ean||'-',s.invoiceNo||'-',String(s.expected),String(s.scanned),'-'+s.short],[55,40,35,20,20,20],i%2===1);});y+=4;}
    if(report.excessItems&&report.excessItems.length){chkPg(30);doc.setTextColor(220,50,50);doc.setFontSize(10);doc.setFont('helvetica','bold');doc.text('EXCESS ITEMS ('+report.excessItems.length+')',10,y);y+=6;addTH(['Material','EAN','Invoice','Expected','Scanned','Excess'],[55,40,35,20,20,20]);report.excessItems.forEach(function(s,i){chkPg(8);addTR([s.material||'-',s.ean||'-',s.invoiceNo||'-',String(s.expected),String(s.scanned),'+'+s.excess],[55,40,35,20,20,20],i%2===1);});y+=4;}
    if(report.wrongItems&&report.wrongItems.length){chkPg(30);doc.setTextColor(220,50,50);doc.setFontSize(10);doc.setFont('helvetica','bold');doc.text('WRONG ITEMS ('+report.wrongItems.length+')',10,y);y+=6;addTH(['EAN','Material','Qty'],[60,80,50]);report.wrongItems.forEach(function(s,i){chkPg(8);addTR([s.ean||'-',s.material||'-',String(s.scannedQty)],[60,80,50],i%2===1);});}
    y=272;doc.setDrawColor(150,150,150);doc.line(10,y,200,y);doc.setTextColor(130,130,130);doc.setFontSize(7);doc.text('System Generated — '+report.reportNo+' — '+(APP.currentUser?APP.currentUser.name:''),105,y+5,{align:'center'});
    doc.save(report.reportNo+'.pdf');showToast('PDF downloaded!','success');
}

// --- Posting Pending ---
function renderPostingPending(){
    var pending=DB.filter('vehicles',function(v){return v.status==='Posting Pending Approval';});
    var h='<div class="section-header"><h2><i class="bx bx-error-circle"></i> GR Posting Pending ('+pending.length+')</h2></div>';
    if(!pending.length){h+='<div class="card"><div class="empty-state"><i class="bx bx-check-circle"></i><p>All clear!</p></div></div>';setHtml(h);return;}
    pending.forEach(function(v){
        var rec=DB.filter('unloading_records',function(r){return r.vehicleId===v.id&&r.status==='Posting Pending Approval';})[0];
        h+='<div class="card" style="margin-bottom:12px"><div class="card-title"><i class="bx bxs-truck"></i> '+esc(v.vehicleNo)+' — '+esc(v.lrNo||'')+'</div>';
        h+='<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Unload No: <strong style="color:var(--accent);font-family:var(--font-display)">'+esc(v.unloadNo||'-')+'</strong> | By: '+esc(v.unloadedByName||'-')+' | Time: '+fmtDT(v.unloadedAt)+'</div>';
        if(rec&&rec.materials){
            h+='<div class="table-wrapper" style="max-height:200px;overflow-y:auto"><table class="data-table"><thead><tr><th>Invoice</th><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Diff</th></tr></thead><tbody>';
            rec.materials.forEach(function(m){var cls=m.diff===0?'qty-match':'qty-mismatch';h+='<tr><td style="font-size:11px">'+esc(m.invoiceNo)+'</td><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+m.expectedQty+'</td><td>'+m.scannedQty+'</td><td class="'+cls+'">'+(m.diff>0?'-'+m.diff:(m.diff<0?'+'+Math.abs(m.diff):'0'))+'</td></tr>';});
            h+='</tbody></table></div>';
        }
        h+='<div class="form-actions">';
        if(chkAct('canPostVehicle'))h+='<button class="btn btn-glass" onclick="postVehicle(\''+v.id+'\')"><i class="bx bx-check-double"></i> Post Vehicle</button>';
        h+='<button class="btn btn-glass" onclick="viewUnloadingDetail(\''+v.id+'\')"><i class="bx bx-eye"></i> View</button>';
        h+='</div></div>';
    });
    setHtml(h);
}

// --- Post Vehicle ---
function postVehicle(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var invs=DB.filter('invoices',function(i){return i.vehicleId===vehId;});
    var grnList=[];
    invs.forEach(function(inv){
        var grnNo='GRN-'+inv.invoiceNo;
        grnList.push(grnNo);
        DB.add('grn_records',{grnNo:grnNo,vehicleId:vehId,vehicleNo:v.vehicleNo,lrNo:v.lrNo,invoiceId:inv.id,invoiceNo:inv.invoiceNo,postedBy:APP.currentUser.id,postedByName:APP.currentUser.name,postedAt:new Date().toISOString()});
        DB.update('invoices',inv.id,{status:'Posted',grnNo:grnNo});
    });
    DB.filter('unloading_records',function(r){return r.vehicleId===vehId&&r.status==='Posting Pending Approval';}).forEach(function(r){DB.update('unloading_records',r.id,{status:'Posted'});});
    DB.update('vehicles',vehId,{status:'Posted'});
    addNotif('Vehicle '+v.vehicleNo+' posted. GRNs: '+grnList.join(', '),'success');
    logAction('Inbound','POST','Vehicle '+v.vehicleNo+' posted. '+grnList.length+' GRNs');
    showToast('Vehicle posted! '+grnList.length+' GRN(s) created.','success');
    if(APP.currentSub==='posting-pending')renderPostingPending();
    else if(APP.currentSub==='pending-vehicle')renderPendingVehicle();
    else renderInbound(APP.currentSub);
}

function viewUnloadingDetail(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var recs=DB.filter('unloading_records',function(r){return r.vehicleId===vehId;});
    var rec=recs[recs.length-1];if(!rec){showToast('No record','error');return;}
    var h='<div style="margin-bottom:12px"><strong>Vehicle:</strong> '+esc(v.vehicleNo)+' | <strong>LR:</strong> '+esc(v.lrNo||'-')+' | <strong>Unload:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(rec.unloadNo)+'</span></div>';
    h+='<div style="margin-bottom:8px"><strong>By:</strong> '+esc(rec.unloadedByName||'-')+' | <strong>Time:</strong> '+fmtDT(rec.unloadedAt)+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Invoice</th><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Diff</th></tr></thead><tbody>';
    rec.materials.forEach(function(m){var cls=m.diff===0?'qty-match':'qty-mismatch';h+='<tr class="'+(m.diff===0?'':'scan-row-red')+'"><td>'+esc(m.invoiceNo)+'</td><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+m.expectedQty+'</td><td>'+m.scannedQty+'</td><td class="'+cls+'">'+(m.diff>0?'Short: -'+m.diff:(m.diff<0?'Extra: +'+Math.abs(m.diff):'0'))+'</td></tr>';});
    h+='</tbody></table></div>';
    var serReports=DB.filter('short_excess_reports',function(s){return s.vehicleNo===v.vehicleNo;});
    if(serReports.length){h+='<div style="margin-top:12px"><strong style="color:var(--warning)">Reports:</strong></div>';serReports.forEach(function(s){h+='<div class="inv-list-item" onclick="showSEReport(\''+s.id+'\')"><div class="ili-left"><span class="ili-invno">'+esc(s.reportNo)+'</span><span class="ili-info">Expected: '+s.totalExpected+' | Scanned: '+s.totalScanned+'</span></div><span class="badge badge-danger">View/PDF</span></div>';});}
    var grns=DB.filter('grn_records',function(g){return g.vehicleId===vehId;});
    if(grns.length){h+='<div style="margin-top:12px"><strong style="color:var(--accent)">GRNs:</strong></div>';grns.forEach(function(g){h+='<div class="inv-list-item"><div class="ili-left"><span class="ili-invno">'+esc(g.grnNo)+'</span><span class="ili-info">'+esc(g.invoiceNo)+'</span></div></div>';});}
    showModal('Unloading Detail — '+v.vehicleNo,h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button><button class="btn btn-info" onclick="showUnloadReport(\''+rec.unloadNo+'\')"><i class="bx bx-file"></i> Unloading Report</button>');
}

// --- Inbound Record ---
function renderInboundRecord(){
    var vehs=DB.get('vehicles').filter(function(v){return v.vehicleType==='Unloading';}).reverse();
    var h='<div class="section-header"><h2><i class="bx bx-list-ul"></i> Inbound Delivery Records ('+vehs.length+')</h2><button class="btn btn-glass" onclick="exportInboundExcel()"><i class="bx bx-download"></i> Excel</button></div>';
    h+='<div class="card" style="margin-bottom:12px"><div class="card-title"><i class="bx bx-search"></i> Search GRN No</div>';
    h+='<div class="search-box" style="max-width:500px"><i class="bx bx-barcode"></i><input type="text" id="grnSearchInput" placeholder="GRN-INV001..." oninput="searchGRNForMaterial()" style="font-family:var(--font-display);letter-spacing:1px"></div><div id="grnSearchResult"></div></div>';
    h+='<div class="search-box"><i class="bx bx-search"></i><input type="text" id="inboundRecSearch" placeholder="Search vehicle, LR..." oninput="filterInboundRec()"></div>';
    h+='<div id="inboundRecTable">'+buildInboundRecTable(vehs)+'</div>';
    setHtml(h);
}
function searchGRNForMaterial(){
    var q=document.getElementById('grnSearchInput').value.trim().toUpperCase();
    var c=document.getElementById('grnSearchResult');if(!q){c.innerHTML='';return;}
    var grns=DB.filter('grn_records',function(g){return (g.grnNo||'').toUpperCase().indexOf(q)>-1;});
    if(!grns.length){c.innerHTML='<div style="color:var(--text-muted);padding:12px;font-size:12px">No GRN found</div>';return;}
    var h='';
    grns.forEach(function(g){
        var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;});
        h+='<div style="margin-top:10px;padding:12px;border:1px solid var(--accent);border-radius:var(--radius-sm);background:var(--accent-dim)">';
        h+='<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-family:var(--font-display);font-size:13px;font-weight:700;color:var(--accent)">'+esc(g.grnNo)+'</span><span style="font-size:11px;color:var(--text-muted)">'+fmtDT(g.postedAt)+'</span></div>';
        h+='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Invoice: <strong>'+esc(g.invoiceNo)+'</strong> | Vehicle: <strong>'+esc(g.vehicleNo)+'</strong></div>';
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Inv Qty</th><th>Unloaded</th><th>Status</th></tr></thead><tbody>';
        mats.forEach(function(m){var diff=m.qty-(m.unloadedQty||0);h+='<tr><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+m.qty+'</td><td>'+(m.unloadedQty||0)+'</td><td><span class="badge '+(diff===0?'badge-success':'badge-warning')+'">'+(diff===0?'Full':'Short: '+diff)+'</span></td></tr>';});
        h+='</tbody></table></div></div>';
    });
    c.innerHTML=h;
}
function buildInboundRecTable(vehs){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>LR</th><th>Transport</th><th>Invoices</th><th>Status</th><th>Entry By</th><th>GRN</th><th></th></tr></thead><tbody>';
    if(!vehs.length)h+='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">No records</td></tr>';
    else vehs.forEach(function(v){
        var invs=DB.filter('invoices',function(i){return i.vehicleId===v.id;});
        var grns=DB.filter('grn_records',function(g){return g.vehicleId===v.id;});
        var grnStr=grns.map(function(g){return g.grnNo;}).join(', ')||'-';
        var sc=v.status==='Posted'?'badge-success':(v.status==='Partial Unload'?'badge-info':'badge-warning');
        h+='<tr><td><strong>'+esc(v.vehicleNo)+'</strong></td><td>'+esc(v.lrNo||'-')+'</td><td>'+esc(v.transportName||'-')+'</td><td><span class="badge badge-info">'+invs.length+'</span></td><td><span class="badge '+sc+'">'+esc(v.status)+'</span></td><td style="font-size:11px;color:var(--text-secondary)">'+esc(v.entryByName||'-')+'</td><td style="font-size:10px;font-family:var(--font-display);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(grnStr)+'</td><td><button class="btn btn-glass btn-sm" onclick="viewUnloadingDetail(\''+v.id+'\')"><i class="bx bx-eye"></i></button></td></tr>';
    });
    h+='</tbody></table></div>';return h;
}
function filterInboundRec(){
    var q=document.getElementById('inboundRecSearch').value.trim().toLowerCase();
    var vehs=DB.get('vehicles').filter(function(v){return v.vehicleType==='Unloading';}).reverse();
    if(q)vehs=vehs.filter(function(v){return(v.vehicleNo||'').toLowerCase().indexOf(q)>-1||(v.lrNo||'').toLowerCase().indexOf(q)>-1||(v.transportName||'').toLowerCase().indexOf(q)>-1;});
    document.getElementById('inboundRecTable').innerHTML=buildInboundRecTable(vehs);
}
function exportInboundExcel(){
    var vehs=DB.get('vehicles').filter(function(v){return v.vehicleType==='Unloading';});
    var rows=[['Vehicle No','LR No','Transport','Driver','Status','Entry By','Reported At']];
    vehs.forEach(function(v){rows.push([v.vehicleNo,v.lrNo||'',v.transportName||'',v.driverName||'',v.status,v.entryByName||'',fmtDT(v.reportedAt)]);});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Inbound');XLSX.writeFile(wb,'Inbound_Record_'+today()+'.xlsx');
    showToast('Excel downloaded!','success');
}

// --- Unloading Stock ---
function renderUnloadingStock(){
    var grns=DB.get('grn_records').slice().reverse();
    var h='<div class="section-header"><h2><i class="bx bx-box"></i> Stock in GR Area</h2></div>';
    h+='<div class="search-box"><i class="bx bx-search"></i><input type="text" id="stockSearch" placeholder="Search GRN or Invoice..." oninput="filterStock()"></div>';
    h+='<div id="stockList">'+buildStockList(grns)+'</div>';
    setHtml(h);
}
function buildStockList(grns){
    if(!grns.length)return '<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No stock</p></div></div>';
    var h='';grns.forEach(function(g){var mc=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;}).length;h+='<div class="inv-list-item" onclick="showStockDetail(\''+g.id+'\')"><div class="ili-left"><span class="ili-invno">'+esc(g.grnNo)+'</span><span class="ili-info">'+esc(g.invoiceNo)+' | '+esc(g.vehicleNo)+' | '+mc+' materials</span></div><span class="badge badge-accent">'+fmtDate(g.postedAt)+'</span></div>';});return h;
}
function filterStock(){
    var q=document.getElementById('stockSearch').value.trim().toLowerCase();
    var grns=DB.get('grn_records').slice().reverse();
    if(q)grns=grns.filter(function(g){return(g.grnNo||'').toLowerCase().indexOf(q)>-1||(g.invoiceNo||'').toLowerCase().indexOf(q)>-1;});
    document.getElementById('stockList').innerHTML=buildStockList(grns);
}
function showStockDetail(grnId){
    var g=DB.find('grn_records',grnId);if(!g)return;
    var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;});
    var h='<div style="margin-bottom:12px"><strong>GRN:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(g.grnNo)+'</span> | <strong>Invoice:</strong> '+esc(g.invoiceNo)+' | <strong>Vehicle:</strong> '+esc(g.vehicleNo)+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Inv Qty</th><th>Unloaded</th><th>Remaining</th></tr></thead><tbody>';
    mats.forEach(function(m){var rem=m.qty-(m.unloadedQty||0);h+='<tr><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+m.qty+'</td><td>'+(m.unloadedQty||0)+'</td><td class="'+(rem>0?'qty-match':'')+'">'+rem+'</td></tr>';});
    h+='</tbody></table></div>';
    h+='<div class="form-actions"><button class="btn btn-glass" onclick="closeModal();navTo(\'putaway\');setTimeout(function(){var i=document.getElementById(\'putawayInvNo\');if(i){i.value=\''+esc(g.invoiceNo)+'\';filterPutawayInv();}},200);"><i class="bx bx-package"></i> Start Putaway</button></div>';
    showModal('Stock Detail — '+g.grnNo,h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

// ==================== PUTAWAY ====================
function renderPutaway(){
    window._putawayItems = window._putawayItems || [];
    var h='<div class="section-header"><h2><i class="bx bx-package"></i> Putaway</h2></div>';

    // === Pending Putaway Card ===
    var pendingMats=getPendingPutawayMaterials();
    h+='<div class="card"><div class="card-title"><i class="bx bx-time" style="color:var(--warning)"></i> Pending Putaway ('+pendingMats.length+')</div>';
    if(!pendingMats.length){
        h+='<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:12px"><i class="bx bx-check-circle" style="font-size:20px;display:block;margin-bottom:6px;color:var(--success)"></i>All putaway tasks are complete. Nothing pending.</div>';
    } else {
        h+='<div class="table-wrapper" style="max-height:300px;overflow-y:auto"><table class="data-table"><thead><tr><th>GRN</th><th>Invoice</th><th>Material</th><th>EAN</th><th>Total</th><th>Done</th><th>Pending</th><th>Action</th></tr></thead><tbody>';
        pendingMats.forEach(function(p){
            var rem=p.totalQty-p.doneQty;
            var pct=Math.round((p.doneQty/p.totalQty)*100);
            h+='<tr><td style="font-family:var(--font-display);font-size:10px">'+esc(p.grnNo)+'</td><td>'+esc(p.invoiceNo)+'</td><td>'+esc(p.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(p.ean)+'</td><td>'+p.totalQty+'</td><td style="color:var(--success)">'+p.doneQty+'</td><td><strong style="color:var(--warning)">'+rem+'</strong><div style="background:var(--border);height:4px;border-radius:2px;margin-top:3px;width:80px"><div style="background:var(--accent);height:100%;border-radius:2px;width:'+pct+'%"></div></div></td><td><button class="btn btn-glass btn-sm" onclick="doPutaway(\''+p.grnId+'\')"><i class="bx bx-package"></i> Putaway</button></td></tr>';
        });
        h+='</tbody></table></div>';
    }
    h+='</div>';

    // === EAN Scan Putaway Card ===
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-scan"></i> EAN Scan Putaway</div>';
    h+='<div class="form-group"><label>EAN / Material <span class="req">*</span></label>';
    h+='<div style="display:flex;gap:6px"><div class="search-box" style="flex:1;max-width:100%"><i class="bx bx-barcode"></i><input type="text" id="putawayEanScan" placeholder="Scan or type EAN / Material..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();lookupPutawayEan();}" style="font-family:var(--font-display);font-size:13px;letter-spacing:1px"></div>';
    h+='<button class="btn btn-glass btn-sm" onclick="openScannerForPutawayEan()"><i class="bx bx-qr"></i></button>';
    h+='<button class="btn btn-glass btn-sm" onclick="lookupPutawayEan()"><i class="bx bx-search"></i></button></div></div>';
    h+='<div id="putawayMatInfo" style="display:none"><div id="paLookupMsg"></div>';
    h+='<div class="form-row" style="margin-top:8px">';
    h+='<div class="form-group" style="flex:2"><label>Material <span class="req">*</span></label><input type="text" id="paMaterial" class="form-input" placeholder="Auto ya manual"></div>';
    h+='<div class="form-group" style="flex:2"><label>Description</label><input type="text" id="paDescription" class="form-input" placeholder="Auto ya manual"></div>';
    h+='<div class="form-group"><label>EAN</label><input type="text" id="paEan" class="form-input" readonly style="background:var(--bg-secondary);font-family:var(--font-display);font-size:11px"></div>';
    h+='</div>';
    h+='<div class="form-row" style="margin-top:10px">';
    h+='<div class="form-group" style="flex:1"><label>Rack <span class="req">*</span></label>';
    h+='<div style="display:flex;gap:4px"><input type="text" id="paRackScan" class="form-input" placeholder="Scan ya type rack..." style="text-transform:uppercase" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'paQty\').focus();}">';
    h+='<button class="btn btn-glass btn-sm" onclick="openScannerForPutawayRack()"><i class="bx bx-qr"></i></button></div>';
    h+='<select class="form-input" id="paRackSelect" onchange="if(this.value)document.getElementById(\'paRackScan\').value=this.value;" style="margin-top:4px;font-size:12px"><option value="">-- Select --</option>';
    var racks=DB.get('rack_master');
    racks.forEach(function(r){h+='<option value="'+esc(r.rack)+'">'+esc(r.rack)+'</option>';});
    h+='</select></div>';
    h+='<div class="form-group"><label>Qty <span class="req">*</span></label><input type="number" id="paQty" class="form-input" value="1" min="1"></div>';
    h+='<div class="form-group"><label>Packing</label><input type="text" id="paPacking" class="form-input" placeholder="Bag/Box"></div>';
    h+='<div class="form-group"><label>Box No</label><input type="text" id="paBoxNo" class="form-input" placeholder="B001" style="text-transform:uppercase" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addToPutawayList();}"></div>';
    h+='</div>';
    h+='<div class="form-actions" style="margin-top:12px"><button class="btn btn-glass" onclick="addToPutawayList()"><i class="bx bx-plus-circle"></i> Add</button><button class="btn btn-glass btn-sm" onclick="resetPutawayScan()"><i class="bx bx-refresh"></i> Reset</button></div>';
    h+='</div>';
    h+='<div id="putawayScanList" style="margin-top:16px"></div>';
    h+='</div>';

    // === Invoice/GRN Search Card ===
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-file-find"></i> Invoice / GRN se Putaway</div>';
    h+='<div class="search-box" style="max-width:400px"><i class="bx bx-search"></i><input type="text" id="putawayInvNo" placeholder="Type Invoice No..." oninput="filterPutawayInv()"></div>';
    h+='<div id="putawayInvList"></div></div>';

    setHtml(h);
    renderPutawayList();
}

// --- Pending Putaway Materials Calculator ---
function getPendingPutawayMaterials(){
    var grns=DB.get('grn_records');
    var pending=[];
    grns.forEach(function(g){
        var mats=putawayMats(g.invoiceId);
        mats.forEach(function(m){
            var doneQty=m.putawayedQty||0;
            if(doneQty<m.qty){
                pending.push({grnId:g.id,grnNo:g.grnNo,invoiceId:g.invoiceId,invoiceNo:g.invoiceNo,vehicleNo:g.vehicleNo,material:m.material,ean:m.ean,totalQty:m.qty,doneQty:doneQty});
            }
        });
    });
    return pending;
}

// --- From Unloading Stock: Direct Modal Open ---
function startPutawayFromStock(grnId){
    closeModal();
    doPutaway(grnId);
}

// --- Putaway Modal (Rack Scan + Manual Qty + Partial Support) ---
async function doPutaway(grnId){
    var g=DB.find('grn_records',grnId);if(!g)return;
    var mats=putawayMats(g.invoiceId);

    // Show only materials whose putaway is pending
    var pendingMats=mats.filter(function(m){return (m.putawayedQty||0)<m.qty;});
    if(!pendingMats.length){showToast('All materials have been put away already!','success');return;}

    // ★ EAN -> description map ek hi server query se (per-row memory search nahi)
    var descMap={};
    var _eans=pendingMats.map(function(m){return m.ean;}).filter(Boolean);
    if(_eans.length && supabaseClient){
        var mres=await supabaseClient.from('material_master').select('data').filter('data->>ean','in','('+_eans.join(',')+')');
        if(!mres.error)(mres.data||[]).forEach(function(r){descMap[r.data.ean]=r.data.description||r.data.material;});
    }

    var rackList=DB.get('rack_master');
    var rOpts='<option value="">-- Scan ya Select --</option>';
    rackList.forEach(function(r){rOpts+='<option value="'+esc(r.rack)+'">'+esc(r.rack)+'</option>';});

    var totalRemaining=0;
    pendingMats.forEach(function(m){totalRemaining+=m.qty-(m.putawayedQty||0);});

    var h='<div style="margin-bottom:10px"><strong>GRN:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(g.grnNo)+'</span> | <strong>Invoice:</strong> '+esc(g.invoiceNo)+' | <strong>Vehicle:</strong> '+esc(g.vehicleNo)+'</div>';
    h+='<div style="background:var(--accent-dim);padding:10px;border-radius:var(--radius-sm);margin-bottom:14px;font-size:12px;color:var(--accent);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><span><i class="bx bx-info-circle"></i> Pending: <strong>'+totalRemaining+'</strong> qty in <strong>'+pendingMats.length+'</strong> materials</span><span style="font-size:11px;color:var(--text-muted)">Partial putaway allowed — the remaining quantity will be shown next time</span></div>';

    h+='<div id="putawayGRNMatList">';
    pendingMats.forEach(function(m,idx){
        var remaining=m.qty-(m.putawayedQty||0);
        var desc=descMap[m.ean]||m.material;
        var pct=Math.round(((m.putawayedQty||0)/m.qty)*100);

        h+='<div id="paGRow_'+idx+'" style="margin-bottom:14px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-secondary)">';

        // Material Info Header
        h+='<div style="display:flex;gap:14px;margin-bottom:10px;flex-wrap:wrap;align-items:center">';
        h+='<div style="flex:2;min-width:140px"><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">MATERIAL</div><div style="font-weight:700;font-size:13px">'+esc(m.material)+'</div><div style="font-size:11px;color:var(--text-secondary)">'+esc(desc)+'</div></div>';
        h+='<div style="min-width:100px"><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">EAN</div><div style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</div></div>';
        h+='<div style="text-align:center;min-width:50px"><div style="font-size:9px;color:var(--text-muted)">TOTAL</div><div style="font-weight:700;font-size:15px">'+m.qty+'</div></div>';
        h+='<div style="text-align:center;min-width:50px"><div style="font-size:9px;color:var(--text-muted)">DONE</div><div style="color:var(--success);font-weight:600;font-size:15px">'+(m.putawayedQty||0)+'</div></div>';
        h+='<div style="text-align:center;min-width:60px"><div style="font-size:9px;color:var(--text-muted)">REMAINING</div><div style="color:var(--warning);font-weight:800;font-size:18px">'+remaining+'</div></div>';
        h+='</div>';

        // Progress bar
        h+='<div style="background:var(--border);height:5px;border-radius:3px;margin-bottom:12px;overflow:hidden"><div style="background:linear-gradient(90deg,var(--accent),var(--success));height:100%;border-radius:3px;width:'+pct+'%;transition:width 0.3s"></div></div>';

        // Rack + Qty Row
        h+='<div class="form-row" style="align-items:end">';
        // Rack Scan
        h+='<div class="form-group" style="flex:1.2"><label>Rack <span class="req">*</span></label>';
        h+='<div style="display:flex;gap:4px"><input type="text" class="form-input" id="paGRackScan_'+idx+'" placeholder="Scan rack..." style="text-transform:uppercase" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'paGQty_'+idx+'\').focus();}">';
        h+='<button class="btn btn-glass btn-sm" onclick="openScannerForPutawayRackModal('+idx+')" title="Scan Rack"><i class="bx bx-qr"></i></button></div>';
        h+='<select class="form-input" id="paGRackSel_'+idx+'" onchange="if(this.value){document.getElementById(\'paGRackScan_'+idx+'\').value=this.value;document.getElementById(\'paGQty_'+idx+'\').focus();}" style="margin-top:4px;font-size:11px">'+rOpts+'</select></div>';
        // Qty
        h+='<div class="form-group"><label>Qty <span class="req">*</span></label><input type="number" class="form-input" id="paGQty_'+idx+'" min="1" max="'+remaining+'" value="'+remaining+'" placeholder="Max: '+remaining+'" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'paGPack_'+idx+'\').focus();}"></div>';
        // Packing
        h+='<div class="form-group"><label>Packing</label><input type="text" class="form-input" id="paGPack_'+idx+'" placeholder="Bag/Box" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'paGBox_'+idx+'\').focus();}"></div>';
        // Box No
        h+='<div class="form-group"><label>Box No</label><input type="text" class="form-input" id="paGBox_'+idx+'" placeholder="B001" style="text-transform:uppercase"></div>';
        h+='</div>';
        h+='</div>';
    });
    h+='</div>';

    h+='<div class="form-actions" style="margin-top:14px"><button class="btn btn-glass" onclick="savePutawayFromGRN(\''+grnId+'\')"><i class="bx bx-check-double"></i> Save Putaway</button></div>';

    showModal('Putaway — '+g.grnNo,h,'xl','<button class="btn btn-glass" onclick="closeModal()">Cancel</button>');

    // Pehle rack field pe focus
    setTimeout(function(){var f=document.getElementById('paGRackScan_0');if(f)f.focus();},300);
}

// --- Scanner for Rack inside Modal ---
function openScannerForPutawayRackModal(idx){
    APP.scanCallback=function(code){
        var field=document.getElementById('paGRackScan_'+idx);
        if(field)field.value=code.toUpperCase();
        var sel=document.getElementById('paGRackSel_'+idx);
        if(sel){for(var i=0;i<sel.options.length;i++){if(sel.options[i].value.toUpperCase()===code.toUpperCase()){sel.selectedIndex=i;break;}}}
        var qtyField=document.getElementById('paGQty_'+idx);
        if(qtyField)qtyField.focus();
    };
    document.getElementById('scannerModal').style.display='flex';
    
}

// --- Save Putaway from GRN (Partial Allowed) ---
async function savePutawayFromGRN(grnId){
    var g=DB.find('grn_records',grnId);if(!g)return;
    var mats=putawayMats(g.invoiceId);
    var pendingMats=mats.filter(function(m){return (m.putawayedQty||0)<m.qty;});
    var count=0, totalSaved=0;

    // ★ EAN -> description map ek hi server query se
    var descMap={};
    var _eans2=pendingMats.map(function(m){return m.ean;}).filter(Boolean);
    if(_eans2.length && supabaseClient){
        var mres2=await supabaseClient.from('material_master').select('data').filter('data->>ean','in','('+_eans2.join(',')+')');
        if(!mres2.error)(mres2.data||[]).forEach(function(r){descMap[r.data.ean]=r.data.description||r.data.material;});
    }

    for(var pi=0;pi<pendingMats.length;pi++){
      var m=pendingMats[pi],idx=pi;
        var rackField=document.getElementById('paGRackScan_'+idx);
        var qtyField=document.getElementById('paGQty_'+idx);
        var packField=document.getElementById('paGPack_'+idx);
        var boxField=document.getElementById('paGBox_'+idx);

        if(!rackField||!qtyField)continue;
        var rack=rackField.value.trim().toUpperCase();
        var qty=parseInt(qtyField.value)||0;
        var packing=packField?packField.value.trim():'';
        var box=boxField?boxField.value.trim().toUpperCase():'';
        var remaining=m.qty-(m.putawayedQty||0);

        if(!rack||qty<=0)continue;

        // Validate qty — cannot exceed the remaining quantity
        if(qty>remaining){
            showToast(m.material+': Max '+remaining+' qty allowed','error');
            continue;
        }

        // Description from material master (server-side map)
        var desc=descMap[m.ean]||m.material;

        // Location master mein save (server-side merge)
        await addPutawayStock({date:today(),rack:rack,ean:m.ean,material:m.material,description:desc,quantity:qty,packing:packing,box:box,action:'PUTAWAY',user:APP.currentUser.name,dateTime:new Date().toISOString(),grnNo:g.grnNo,invoiceNo:g.invoiceNo,invoiceId:g.invoiceId});

        // Invoice materials mein putawayedQty update
        var newPutawayed=(m.putawayedQty||0)+qty;
        DB.update('invoice_materials',m.id,{putawayedQty:newPutawayed});

        count++;
        totalSaved+=qty;

        // Hide the row when complete for visual feedback
        var row=document.getElementById('paGRow_'+idx);
        if(row&&newPutawayed>=m.qty){
            row.style.opacity='0.4';
            row.style.borderColor='var(--success)';
            rackField.disabled=true;qtyField.disabled=true;
            if(packField)packField.disabled=true;
            if(boxField)boxField.disabled=true;
        }
    }

    if(!count){showToast('Enter bin and quantity for at least one material','error');return;}

    // Check if everything is complete
    var stillPending=getPendingPutawayMaterials().filter(function(p){return p.grnId===grnId;});

    if(stillPending.length>0){
        var remTotal=0;stillPending.forEach(function(p){remTotal+=p.totalQty-p.doneQty;});
        showToast(count+' items saved! '+remTotal+' qty pending — baad mein kar sakte ho','warning');
    } else {
        showToast(count+' items putaway complete — all done!','success');
    }

    logAction('Putaway','GRN_SAVE',count+' items ('+totalSaved+' qty) putaway for '+g.grnNo);
    addNotif(count+' items putaway for '+g.grnNo+' ('+totalSaved+' qty) by '+APP.currentUser.name,'success');

    // Close the modal when everything is complete
    if(stillPending.length===0){
        setTimeout(function(){closeModal();renderPutaway();},800);
    }
}

// --- EAN Scan Putaway Functions ---
function openScannerForPutawayEan(){
    APP.scanCallback=function(code){document.getElementById('putawayEanScan').value=code;lookupPutawayEan();};
    document.getElementById('scannerModal').style.display='flex';
}
function openScannerForPutawayRack(){
    APP.scanCallback=function(code){
        document.getElementById('paRackScan').value=code.toUpperCase();
        var sel=document.getElementById('paRackSelect');
        if(sel){for(var i=0;i<sel.options.length;i++){if(sel.options[i].value.toUpperCase()===code.toUpperCase()){sel.selectedIndex=i;break;}}}
        document.getElementById('paQty').focus();
    };
    document.getElementById('scannerModal').style.display='flex';
}
async function lookupPutawayEan(){
    var input=document.getElementById('putawayEanScan');
    var val=input.value.trim().toUpperCase();
    if(!val){showToast('Scan or type an EAN code','error');return;}
    var hit=await sbFindMaterialAny(val); var found=hit?hit.row:null; var matchedBy=hit?hit.by:'';   // EAN ya Material — auto detect
    var infoDiv=document.getElementById('putawayMatInfo');
    var msgDiv=document.getElementById('paLookupMsg');
    infoDiv.style.display='';
    if(found){
        document.getElementById('paMaterial').value=found.material||'';
        document.getElementById('paDescription').value=found.description||found.material||'';
        document.getElementById('paEan').value=found.ean||val;
        if(matchedBy!=='ean'&&found.ean)document.getElementById('putawayEanScan').value=found.ean;
        msgDiv.innerHTML='<div style="background:var(--accent-dim);padding:10px;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px"><i class="bx bx-check-circle" style="color:var(--accent);font-size:18px"></i><span style="color:var(--accent)">Found in Product Master — <strong>'+esc(found.material)+'</strong>'+(matchedBy&&matchedBy!=='ean'?' <span style="opacity:.8">(matched by '+(matchedBy==='material'?'Material code':'Description')+')</span>':'')+'</span></div>';
        document.getElementById('paRackScan').focus();
    } else {
        document.getElementById('paMaterial').value='';
        document.getElementById('paDescription').value='';
        document.getElementById('paEan').value=val;
        msgDiv.innerHTML='<div style="background:rgba(255,107,107,0.1);padding:10px;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px;border:1px solid rgba(255,107,107,0.3)"><i class="bx bx-error-circle" style="color:var(--danger);font-size:18px"></i><span style="color:var(--danger)">EAN / Material <strong>'+esc(val)+'</strong> was not found in the Product Master. Please enter it manually.</span></div>';
        document.getElementById('paMaterial').focus();
    }
}
function resetPutawayScan(){
    document.getElementById('putawayEanScan').value='';
    document.getElementById('paMaterial').value='';
    document.getElementById('paDescription').value='';
    document.getElementById('paEan').value='';
    document.getElementById('paRackScan').value='';
    document.getElementById('paRackSelect').selectedIndex=0;
    document.getElementById('paQty').value='1';
    document.getElementById('paPacking').value='';
    document.getElementById('paBoxNo').value='';
    document.getElementById('putawayMatInfo').style.display='none';
    document.getElementById('putawayEanScan').focus();
}
function addToPutawayList(){
    var material=document.getElementById('paMaterial').value.trim();
    var description=document.getElementById('paDescription').value.trim();
    var ean=document.getElementById('paEan').value.trim();
    var rack=document.getElementById('paRackScan').value.trim().toUpperCase();
    var qty=parseInt(document.getElementById('paQty').value)||0;
    var packing=document.getElementById('paPacking').value.trim();
    var boxNo=document.getElementById('paBoxNo').value.trim().toUpperCase();
    if(!material){showToast('Material name is required','error');document.getElementById('paMaterial').focus();return;}
    if(!ean){showToast('EAN is required','error');return;}
    if(!rack){showToast('Scan or select a bin','error');document.getElementById('paRackScan').focus();return;}
    if(qty<=0){showToast('Quantity must be at least 1','error');document.getElementById('paQty').focus();return;}
    window._putawayItems.push({material:material,description:description,ean:ean,rack:rack,qty:qty,packing:packing,boxNo:boxNo,time:new Date().toISOString()});
    renderPutawayList();
    showToast('Added to the list!','success');
    document.getElementById('putawayEanScan').value='';document.getElementById('paMaterial').value='';document.getElementById('paDescription').value='';document.getElementById('paEan').value='';document.getElementById('paRackScan').value='';document.getElementById('paRackSelect').selectedIndex=0;document.getElementById('paQty').value='1';document.getElementById('paPacking').value='';document.getElementById('paBoxNo').value='';document.getElementById('putawayMatInfo').style.display='none';document.getElementById('putawayEanScan').focus();
}
function renderPutawayList(){
    var items=window._putawayItems||[];
    var container=document.getElementById('putawayScanList');if(!container)return;
    if(!items.length){container.innerHTML='';return;}
    var h='<div class="card-title" style="margin-top:8px"><i class="bx bx-list-check" style="color:var(--accent)"></i> EAN Scan List (<span style="color:var(--accent)">'+items.length+'</span>)</div>';
    h+='<div class="table-wrapper" style="max-height:250px;overflow-y:auto"><table class="data-table"><thead><tr><th>#</th><th>Material</th><th>EAN</th><th>Rack</th><th>Qty</th><th>Packing</th><th>Box</th><th></th></tr></thead><tbody>';
    items.forEach(function(item,idx){
        h+='<tr><td>'+(idx+1)+'</td><td><strong>'+esc(item.material)+'</strong></td><td style="font-family:var(--font-display);font-size:10px">'+esc(item.ean)+'</td><td><span class="badge badge-accent">'+esc(item.rack)+'</span></td><td><strong style="color:var(--accent)">'+item.qty+'</strong></td><td>'+esc(item.packing||'-')+'</td><td>'+esc(item.boxNo||'-')+'</td><td><button class="btn btn-danger btn-sm" onclick="removePutawayItem('+idx+')"><i class="bx bx-trash"></i></button></td></tr>';
    });
    h+='</tbody></table></div>';
    h+='<div class="form-actions" style="margin-top:12px"><button class="btn btn-glass" onclick="savePutawayScanList()"><i class="bx bx-check-double"></i> Save All ('+items.length+')</button><button class="btn btn-danger btn-sm" onclick="clearPutawayList()" style="margin-left:8px"><i class="bx bx-trash"></i> Clear</button></div>';
    container.innerHTML=h;
}
function removePutawayItem(idx){var r=window._putawayItems.splice(idx,1);renderPutawayList();showToast('Removed','warning');}
function clearPutawayList(){if(!confirm('Delete all items from the list?'))return;window._putawayItems=[];renderPutawayList();showToast('List clear','warning');}
async function savePutawayScanList(){
    var items=window._putawayItems||[];
    if(!items.length){showToast('There are no items in the list','error');return;}
    var count=0;
    for(var si=0;si<items.length;si++){
        var item=items[si];
        await addPutawayStock({date:today(),rack:item.rack,ean:item.ean,material:item.material,description:item.description||item.material,quantity:item.qty,packing:item.packing,box:item.boxNo,action:'PUTAWAY',user:APP.currentUser.name,dateTime:new Date().toISOString(),grnNo:'EAN-SCAN',invoiceNo:'EAN-SCAN',invoiceId:''});
        count++;
    }
    addNotif(count+' items putaway via EAN scan by '+APP.currentUser.name,'success');
    logAction('Putaway','EAN_SCAN_SAVE',count+' items');
    showToast(count+' items saved!','success');
    window._putawayItems=[];renderPutaway();
}

// --- Invoice/GRN Search ---
function filterPutawayInv(){
    var q=document.getElementById('putawayInvNo').value.trim().toUpperCase();
    var grns=DB.get('grn_records');
    if(q)grns=grns.filter(function(g){return (g.invoiceNo||'').toUpperCase().indexOf(q)>-1||(g.grnNo||'').toUpperCase().indexOf(q)>-1;});
    var h='';
    grns.slice(0,20).forEach(function(g){
        var mats=putawayMats(g.invoiceId);
        var totalQty=0,doneQty=0;mats.forEach(function(m){totalQty+=m.qty;doneQty+=(m.putawayedQty||0);});
        var pendingQty=totalQty-doneQty;
        var statusBadge=pendingQty>0?'<span class="badge badge-warning">'+pendingQty+' pending</span>':'<span class="badge badge-success">Done</span>';
        h+='<div class="inv-list-item" onclick="doPutaway(\''+g.id+'\')"><div class="ili-left"><span class="ili-invno">'+esc(g.grnNo)+'</span><span class="ili-info">'+esc(g.invoiceNo)+' | '+esc(g.vehicleNo)+' | Total: '+totalQty+' | Done: '+doneQty+'</span></div>'+statusBadge+'</div>';
    });
    if(!h)h='<div style="color:var(--text-muted);padding:20px;text-align:center">No results</div>';
    document.getElementById('putawayInvList').innerHTML=h;
}

// ==================== PIV ====================
// ---------- PIV CYCLE ENGINE (1 rack = 1.5 days | 60 racks = 90 days) ----------
function getPivCycles(){return DB.get('piv_cycles');}
function getCurrentPivCycle(){
    var cs=getPivCycles();
    for(var i=cs.length-1;i>=0;i--){if(!cs[i].completedAt)return cs[i];}
    return null;
}
function pivRackList(cyc){
    var racks=DB.get('rack_master').map(function(r){return r.rack;}).sort();
    var n=Math.min(racks.length,cyc?cyc.totalRacks:60);
    return racks.slice(0,n);
}
function pivWindow(cyc,idx){
    var ms=Math.round((cyc.daysPerRack||1.5)*86400000);
    var start=new Date(cyc.startDate+'T'+(cyc.startTime||'09:00')+':00').getTime();
    return {start:start+idx*ms,end:start+(idx+1)*ms};
}
function pivCycleEnd(cyc){
    var ms=Math.round((cyc.daysPerRack||1.5)*86400000);
    var start=new Date(cyc.startDate+'T'+(cyc.startTime||'09:00')+':00').getTime();
    return start+cyc.totalRacks*ms;
}
function pivRackStatus(cyc,rack,idx){
    var cycleStart=new Date(cyc.startDate+'T00:00:00').getTime();
    var recs=(window._pivRecsCache||[]).filter(function(l){
        if(l.action!=='PIV'||(l.rack||'')!==rack)return false;
        if(l.cycleNo)return l.cycleNo===cyc.cycleNo;
        var t=new Date(l.dateTime||l.createdAt||0).getTime();
        return t>=cycleStart;
    });
    if(recs.length){
        recs.sort(function(a,b){return new Date(b.dateTime||0)-new Date(a.dateTime||0);});
        return {status:'COUNTED',rec:recs[0]};
    }
    var w=pivWindow(cyc,idx),now=Date.now();
    if(now>w.end)return{status:'OVERDUE',rec:null};
    if(now>=w.start)return{status:'DUE NOW',rec:null};
    return{status:'UPCOMING',rec:null};
}
function renderPivCyclePanel(cyc){
    var racks=pivRackList(cyc);
    APP._pivCyc=cyc;
    var counted=0,dueNow=0,overdue=0,upcoming=0;
    racks.forEach(function(r,i){var s=pivRackStatus(cyc,r,i);if(s.status==='COUNTED')counted++;else if(s.status==='DUE NOW')dueNow++;else if(s.status==='OVERDUE')overdue++;else upcoming++;});
    var pct=racks.length?Math.round(counted/racks.length*100):0;
    var sDt=new Date(cyc.startDate+'T'+(cyc.startTime||'09:00')+':00');
    var eDt=new Date(pivCycleEnd(cyc));
    var daysLeft=Math.max(0,Math.ceil((eDt-Date.now())/86400000));
    var cycDays=Math.round((cyc.daysPerRack||1.5)*(cyc.totalRacks||racks.length));
    var h='<div class="card" style="margin-bottom:16px">';
    h+='<div class="card-title"><i class="bx bx-calendar-check" style="color:var(--accent)"></i> Count Cycle #'+cyc.cycleNo+' — Running <span style="font-size:10px;color:var(--text-muted);font-weight:normal">(1 rack = '+cyc.daysPerRack+' days • '+cyc.totalRacks+' racks = '+cycDays+' days)</span></div>';
    h+='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Cycle: <strong style="color:var(--text-primary)">'+fmtDT(sDt)+'</strong> → <strong style="color:var(--text-primary)">'+fmtDT(eDt)+'</strong> • <strong style="color:var(--warning)">'+daysLeft+' days left</strong></div>';
    h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><div style="flex:1;height:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:99px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,var(--accent),var(--accent2))"></div></div><strong style="color:var(--accent);font-size:13px">'+pct+'%</strong></div>';
    h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">';
    h+='<div style="flex:1;min-width:90px;padding:10px;background:rgba(0,255,136,0.06);border:1px solid var(--success);border-radius:var(--radius-sm);text-align:center"><div style="font-size:18px;font-weight:800;color:var(--success)">'+counted+' / '+racks.length+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">COUNTED</div></div>';
    h+='<div style="flex:1;min-width:90px;padding:10px;background:#FFF8D6;border:1px solid #E9730C;border-radius:var(--radius-sm);text-align:center"><div style="font-size:18px;font-weight:800;color:#E9730C">'+dueNow+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">DUE NOW</div></div>';
    h+='<div style="flex:1;min-width:90px;padding:10px;background:#FFEBEB;border:1px solid #BB0000;border-radius:var(--radius-sm);text-align:center"><div style="font-size:18px;font-weight:800;color:#BB0000">'+overdue+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">OVERDUE</div></div>';
    h+='<div style="flex:1;min-width:90px;padding:10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:18px;font-weight:700;color:var(--text-muted)">'+upcoming+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">UPCOMING</div></div>';
    h+='</div>';
    h+='<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap"><span style="font-size:11px;color:var(--text-muted);font-weight:600;letter-spacing:1px">SCHEDULE</span><select class="form-input" id="pivCycleFilter" onchange="filterPivCycleTable()" style="width:auto;min-width:120px;font-size:12px"><option value="ALL">All Racks</option><option value="DUE">Due Now</option><option value="OVERDUE">Overdue</option><option value="COUNTED">Counted</option><option value="UPCOMING">Upcoming</option></select></div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Rack</th><th>Count Window Starts</th><th>Complete By (Fixed Time)</th><th>Status</th><th>Last Counted</th><th>Last Qty</th><th></th></tr></thead><tbody id="pivCycleBody">'+buildPivCycleRows(cyc,'ALL')+'</tbody></table></div>';
    h+='</div>';
    return h;
}
function buildPivCycleRows(cyc,filter){
    var racks=pivRackList(cyc);var h='';
    racks.forEach(function(r,i){
        var w=pivWindow(cyc,i),s=pivRackStatus(cyc,r,i);
        if(filter==='DUE'&&s.status!=='DUE NOW')return;
        if(filter==='OVERDUE'&&s.status!=='OVERDUE')return;
        if(filter==='COUNTED'&&s.status!=='COUNTED')return;
        if(filter==='UPCOMING'&&s.status!=='UPCOMING')return;
        var badge=s.status==='COUNTED'?'<span class="badge badge-success">COUNTED</span>':(s.status==='DUE NOW'?'<span class="badge badge-warning">DUE NOW</span>':(s.status==='OVERDUE'?'<span class="badge" style="background:rgba(255,107,107,0.15);color:var(--danger)">OVERDUE</span>':'<span class="badge" style="background:var(--bg-secondary);color:var(--text-muted)">UPCOMING</span>'));
        h+='<tr><td>'+(i+1)+'</td><td><span class="badge badge-accent">'+esc(r)+'</span></td><td style="font-size:11px">'+fmtDT(w.start)+'</td><td style="font-size:11px">'+fmtDT(w.end)+'</td><td>'+badge+'</td><td style="font-size:11px;color:var(--text-secondary)">'+(s.rec?esc(s.rec.date||'-'):'—')+'</td><td>'+(s.rec?'<strong style="color:var(--accent)">'+s.rec.quantity+'</strong>':'—')+'</td><td><button class="btn btn-glass btn-sm" onclick="showAddPIVForRack(\''+esc(r)+'\')"><i class="bx bx-crosshair"></i> '+(s.status==='COUNTED'?'Recount':'Count Now')+'</button></td></tr>';
    });
    if(!h)h='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px">No racks in this view</td></tr>';
    return h;
}
function filterPivCycleTable(){
    var cyc=APP._pivCyc;if(!cyc)return;
    var f=document.getElementById('pivCycleFilter')?document.getElementById('pivCycleFilter').value:'ALL';
    var tb=document.getElementById('pivCycleBody');if(tb)tb.innerHTML=buildPivCycleRows(cyc,f);
}
function showAddPIVForRack(rack){showAddPIV(rack);}
var PIV_SRV={q:'',page:1,per:50,count:0};

async function renderPIV(){
    var cyc=getCurrentPivCycle();
    var off=(PIV_SRV.page-1)*PIV_SRV.per;
    var res=await sbSearch('location_master',{search:PIV_SRV.q,cols:['rack','material','ean','description','user'],eq:{action:'PIV'},limit:PIV_SRV.per,offset:off,order:'created_at'});
    PIV_SRV.count=res.count||0;
    // Cycle panel + stats ke liye PIV rows cache (server se, latest 10000)
    var pivAll=await sbSearch('location_master',{eq:{action:'PIV'},limit:10000,order:'created_at'});
    window._pivRecsCache=pivAll.rows||[];
    var td=today();
    var todayRows=window._pivRecsCache.filter(function(l){return l.date===td;});
    var todayPIV=todayRows.length, todayQty=0;
    todayRows.forEach(function(l){todayQty+=(parseInt(l.quantity)||0);});
    var h='<div class="section-header"><h2><i class="bx bx-clipboard"></i> Stock Count — PIV (Physical Inventory Verification)</h2>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
    if(!cyc)h+='<button class="btn btn-glass" onclick="showPivCycleSetup()"><i class="bx bx-play"></i> Start Count Cycle</button>';
    else{
        h+='<button class="btn btn-glass" onclick="showPivCycleSetup(true)"><i class="bx bx-calendar-edit"></i> Cycle Settings</button>';
        h+='<button class="btn btn-danger" onclick="closePivCycle()" title="Mark this cycle as complete"><i class="bx bx-check-double"></i> Close Cycle</button>';
    }
    h+='<button class="btn btn-glass" onclick="showAddPIV()"><i class="bx bx-plus"></i> Add Count</button>';
    h+='</div></div>';
    h+='<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">';
    h+='<div style="flex:1;min-width:140px;padding:14px;background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);text-align:center"><div style="font-size:24px;font-weight:800;color:var(--accent)">'+todayPIV+'</div><div style="font-size:10px;color:var(--text-muted);letter-spacing:1px">TODAY ENTRIES</div></div>';
    h+='<div style="flex:1;min-width:140px;padding:14px;background:rgba(0,255,136,0.06);border:1px solid var(--success);border-radius:var(--radius-sm);text-align:center"><div style="font-size:24px;font-weight:800;color:var(--success)">'+todayQty+'</div><div style="font-size:10px;color:var(--text-muted);letter-spacing:1px">TODAY QTY</div></div>';
    h+='<div style="flex:1;min-width:140px;padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:24px;font-weight:800;color:var(--text-primary)">'+PIV_SRV.count.toLocaleString()+'</div><div style="font-size:10px;color:var(--text-muted);letter-spacing:1px">TOTAL ENTRIES</div></div>';
    h+='</div>';
    // Cycle Planner
    if(cyc)h+=renderPivCyclePanel(cyc);
    else h+='<div class="card" style="margin-bottom:16px"><div class="empty-state"><i class="bx bx-calendar-exclamation" style="color:var(--warning)"></i><p><strong>No count cycle running.</strong><br>Start a cycle to schedule rack counting — 1 rack = 1.5 days, 60 racks = 90 days.<br>Each rack gets a fixed count window and must be completed on time.</p><button class="btn btn-glass" onclick="showPivCycleSetup()"><i class="bx bx-play"></i> Start Count Cycle</button></div></div>';
    // Records
    h+='<div class="card-title"><i class="bx bx-list-ul"></i> PIV Count Records ('+PIV_SRV.count.toLocaleString()+') <span style="font-size:10px;color:var(--text-muted);font-weight:normal">— re-counting the same material at the same rack replaces the old entry (stock is never inflated)</span></div>';
    h+='<div class="search-box" style="margin-bottom:12px"><i class="bx bx-search"></i><input type="text" id="pivSearchInput" value="'+esc(PIV_SRV.q)+'" placeholder="Search rack, material, EAN..." oninput="pivSrvType()"></div>';
    h+='<div id="pivTableWrap">'+buildPIVTable(res.rows)+'</div>';
    h+=renderPag(PIV_SRV.page,Math.ceil(PIV_SRV.count/PIV_SRV.per)||1,'goPivPage');
    setHtml(h);
    var f=document.getElementById('pivSearchInput');
    if(f&&PIV_SRV.q){ f.focus(); f.setSelectionRange(f.value.length,f.value.length); }
}
var _pivT=null;
function pivSrvType(){
    clearTimeout(_pivT);
    _pivT=setTimeout(async function(){
        var inp=document.getElementById('pivSearchInput'); if(!inp)return;
        PIV_SRV.q=inp.value.trim(); PIV_SRV.page=1;
        var res=await sbSearch('location_master',{search:PIV_SRV.q,cols:['rack','material','ean','description','user'],eq:{action:'PIV'},limit:PIV_SRV.per,offset:0,order:'created_at'});
        PIV_SRV.count=res.count||0;
        var w=document.getElementById('pivTableWrap');
        if(w)w.innerHTML=buildPIVTable(res.rows)+renderPag(PIV_SRV.page,Math.ceil(PIV_SRV.count/PIV_SRV.per)||1,'goPivPage');
        var f2=document.getElementById('pivSearchInput');
        if(f2){ f2.focus(); f2.setSelectionRange(f2.value.length,f2.value.length); }
    },350);
}
async function goPivPage(p){ PIV_SRV.page=p; await renderPIV(); }

function buildPIVTable(locs){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Date</th><th>Time</th><th>Cycle</th><th>Rack</th><th>Material</th><th>Description</th><th>EAN</th><th>Qty</th><th>Packing</th><th>Box</th><th>Done By</th><th></th></tr></thead><tbody>';
    if(!locs.length)h+='<tr><td colspan="13" style="text-align:center;color:var(--text-muted);padding:24px"><i class="bx bx-inbox" style="font-size:20px;display:block;margin-bottom:6px"></i>No PIV records</td></tr>';
    else locs.forEach(function(l,i){
        var timeStr=l.dateTime?new Date(l.dateTime).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'-';
        h+='<tr><td>'+(i+1)+'</td><td style="font-size:11px">'+esc(l.date)+'</td><td style="font-size:11px;color:var(--text-muted)">'+timeStr+'</td><td>'+(l.cycleNo?'<span class="badge badge-info">C'+l.cycleNo+'</span>':'<span style="font-size:10px;color:var(--text-muted)">—</span>')+'</td><td><span class="badge badge-accent">'+esc(l.rack)+'</span></td><td><strong>'+esc(l.material)+'</strong></td><td style="font-size:11px;color:var(--text-secondary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(l.description||'-')+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(l.ean||'-')+'</td><td><strong style="color:var(--accent)">'+l.quantity+'</strong></td><td>'+esc(l.packing||'-')+'</td><td>'+esc(l.box||'-')+'</td><td style="font-size:11px;color:var(--text-secondary)">'+esc(l.user||'-')+'</td><td><button class="btn btn-danger btn-sm" onclick="deletePivRow(\''+l.id+'\')" title="Delete this PIV record"><i class="bx bx-trash"></i></button></td></tr>';
    });
    h+='</tbody></table></div>';
    return h;
}

var _pivT2=null;
async function filterPIVTable(){
    var q=document.getElementById('pivSearchInput').value.trim();
    var res=await sbSearch('location_master',{search:q,cols:['rack','material','ean','description','user'],eq:{action:'PIV'},limit:200,offset:0,order:'created_at'});
    document.getElementById('pivTableWrap').innerHTML=buildPIVTable(res.rows);
}

// --- Add PIV Modal ---
function showAddPIV(prefRack){
    var racks=DB.get('rack_master');
    var rOpts='<option value="">-- Scan or Select --</option>';
    racks.forEach(function(r){rOpts+='<option value="'+esc(r.rack)+'">'+esc(r.rack)+'</option>';});

    var h='';

    // EAN Scan
    h+='<div class="form-group"><label>EAN / Material <span class="req">*</span></label>';
    h+='<div style="display:flex;gap:6px"><div class="search-box" style="flex:1;max-width:100%"><i class="bx bx-barcode"></i><input type="text" id="pivEanScan" placeholder="Scan or type EAN / Material..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();lookupPIVEan();}" style="font-family:var(--font-display);font-size:14px;letter-spacing:1px"></div>';
    h+='<button class="btn btn-glass btn-sm" onclick="openScannerForPIVEan()" title="Camera Scan"><i class="bx bx-qr"></i></button>';
    h+='<button class="btn btn-glass btn-sm" onclick="lookupPIVEan()" title="Search"><i class="bx bx-search"></i></button></div></div>';

    // Auto-fill info (hidden initially)
    h+='<div id="pivMatInfo" style="display:none">';
    h+='<div id="pivLookupMsg"></div>';
    h+='<div class="form-row" style="margin-top:8px">';
    h+='<div class="form-group" style="flex:2"><label>Material <span class="req">*</span></label><input type="text" id="pivMaterial" class="form-input" placeholder="Auto-fill or type manually"></div>';
    h+='<div class="form-group" style="flex:2"><label>Material Description</label><input type="text" id="pivDescription" class="form-input" placeholder="Auto-fill or type manually"></div>';
    h+='</div>';
    h+='<div class="form-row"><div class="form-group"><label>EAN (Saved)</label><input type="text" id="pivEanSaved" class="form-input" readonly style="background:var(--bg-secondary);font-family:var(--font-display);font-size:11px;color:var(--text-muted)"></div></div>';
    h+='</div>';

    // Rack Scan
    h+='<div style="margin-top:14px" id="pivRackSection"><div class="form-group"><label>Rack <span class="req">*</span></label>';
    h+='<div style="display:flex;gap:6px"><div class="search-box" style="flex:1;max-width:100%"><i class="bx bx-diamond"></i><input type="text" id="pivRackScan" placeholder="Scan or type rack..." style="text-transform:uppercase" oninput="showPivRackCycleInfo()" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'pivQty\').focus();}"></div>';
    h+='<button class="btn btn-glass btn-sm" onclick="openScannerForPIVRack()" title="Scan Rack"><i class="bx bx-qr"></i></button></div>';
    h+='<select class="form-input" id="pivRackSelect" onchange="if(this.value){document.getElementById(\'pivRackScan\').value=this.value;showPivRackCycleInfo();document.getElementById(\'pivQty\').focus();}" style="margin-top:6px;font-size:12px">'+rOpts+'</select>';
    h+='<div id="pivCycleHint" style="margin-top:8px"></div>';
    h+='</div></div>';

    // Qty + Packing + Box
    h+='<div class="form-row" style="margin-top:12px">';
    h+='<div class="form-group"><label>Quantity <span class="req">*</span></label><input type="number" id="pivQty" class="form-input" placeholder="0" min="1" value="1" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'pivPack\').focus();}"></div>';
    h+='<div class="form-group"><label>Packing</label><input type="text" id="pivPack" class="form-input" placeholder="Bag/Box/Pallet" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'pivBox\').focus();}"></div>';
    h+='<div class="form-group"><label>Box No</label><input type="text" id="pivBox" class="form-input" placeholder="B001" style="text-transform:uppercase" onkeydown="if(event.key===\'Enter\'){event.preventDefault();savePIV();}"></div>';
    h+='</div>';

    // Done By + Time (auto, read-only)
    h+='<div class="form-row" style="margin-top:10px">';
    h+='<div class="form-group"><label>Done By</label><div class="form-input" style="background:var(--bg-secondary);color:var(--accent2);font-weight:600"><i class="bx bx-user-check"></i> '+(APP.currentUser?esc(APP.currentUser.name):'Unknown')+'</div></div>';
    h+='<div class="form-group"><label>Date & Time</label><div class="form-input" style="background:var(--bg-secondary);color:var(--accent);font-weight:600;font-size:12px"><i class="bx bx-time-five"></i> '+fmtDT(new Date())+' <small>(Auto)</small></div></div>';
    h+='</div>';

    showModal('Add PIV Count',h,'lg',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="savePIV()"><i class="bx bx-check"></i> Save Count</button>');

    // Focus on EAN, or prefill rack (Count Now button)
    setTimeout(function(){
        if(prefRack){
            var rs=document.getElementById('pivRackScan');
            if(rs){rs.value=String(prefRack).toUpperCase();showPivRackCycleInfo();document.getElementById('pivQty').focus();}
        }else{document.getElementById('pivEanScan').focus();}
    },300);
}
// --- Cycle hint inside Add PIV modal ---
function showPivRackCycleInfo(){
    var rack=(document.getElementById('pivRackScan').value||'').trim().toUpperCase();
    var div=document.getElementById('pivCycleHint');
    if(!div)return;
    var cyc=getCurrentPivCycle();
    if(!rack||!cyc){div.innerHTML='';return;}
    var racks=pivRackList(cyc);
    var idx=racks.indexOf(rack);
    if(idx<0){
        div.innerHTML='<div style="background:var(--bg-secondary);border:1px solid var(--border);padding:8px 10px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted)"><i class="bx bx-info-circle"></i> No cycle slot assigned to this rack — the entry will still be saved as a normal PIV count.</div>';
        return;
    }
    var w=pivWindow(cyc,idx),s=pivRackStatus(cyc,rack,idx);
    var color=s.status==='COUNTED'?'var(--success)':(s.status==='DUE NOW'?'#E9730C':(s.status==='OVERDUE'?'var(--danger)':'var(--text-muted)'));
    div.innerHTML='<div style="background:var(--accent-dim);border:1px solid var(--accent);padding:8px 10px;border-radius:var(--radius-sm);font-size:11px;color:var(--accent)"><i class="bx bx-calendar-check"></i> <strong>Cycle #'+cyc.cycleNo+'</strong> — Slot '+(idx+1)+'/'+racks.length+' • Window: <strong>'+fmtDT(w.start)+'</strong> → Complete By: <strong>'+fmtDT(w.end)+'</strong> • Status: <strong style="color:'+color+'">'+s.status+'</strong>'+(s.rec?' • Last count qty: '+s.rec.quantity:'')+'</div>';
}

// --- Cycle Setup / Edit Modal ---
function showPivCycleSetup(editMode){
    var cyc=editMode?getCurrentPivCycle():null;
    var rackCount=DB.get('rack_master').length;
    var defTotal=rackCount>0?rackCount:60;
    var h='';
    h+='<div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--accent)"><i class="bx bx-info-circle"></i> Bin Master has <strong>'+rackCount+'</strong> racks. At 1.5 days per rack, a <strong>60-rack cycle runs 90 days</strong> (36-hour fixed window per rack).</div>';
    h+='<div class="form-row">';
    h+='<div class="form-group"><label>Cycle Start Date <span class="req">*</span></label><input type="date" id="pcStart" class="form-input" value="'+(cyc?cyc.startDate:today())+'"></div>';
    h+='<div class="form-group"><label>Daily Start Time <span class="req">*</span></label><input type="time" id="pcTime" class="form-input" value="'+(cyc?(cyc.startTime||'09:00'):'09:00')+'"></div>';
    h+='</div>';
    h+='<div class="form-row">';
    h+='<div class="form-group"><label>Days per Rack</label><input type="number" id="pcDays" class="form-input" step="0.5" min="0.5" value="'+(cyc?cyc.daysPerRack:1.5)+'"></div>';
    h+='<div class="form-group"><label>Total Racks in Cycle</label><input type="number" id="pcTotal" class="form-input" min="1" value="'+(cyc?cyc.totalRacks:defTotal)+'"></div>';
    h+='</div>';
    if(cyc)h+='<div style="background:#FFF8D6;border:1px solid #E9730C;padding:8px 12px;border-radius:var(--radius-sm);font-size:11px;color:#E9730C;margin-top:6px"><i class="bx bx-error-circle"></i> This cycle is running — changing these values re-calculates the fixed count window of every rack.</div>';
    showModal((cyc?'Edit Count Cycle':'Start Count Cycle'),h,'sm',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="createPivCycle('+(cyc?'true':'false')+')"><i class="bx bx-check"></i> '+(cyc?'Update Cycle':'Start Cycle')+'</button>');
}
function createPivCycle(editMode){
    var sd=document.getElementById('pcStart').value;
    var st=document.getElementById('pcTime').value||'09:00';
    var dp=parseFloat(document.getElementById('pcDays').value)||1.5;
    var tr=parseInt(document.getElementById('pcTotal').value)||0;
    if(!sd){showToast('Please select a cycle start date','error');return;}
    if(dp<=0){showToast('Days per rack must be greater than 0','error');return;}
    if(tr<1){showToast('Total racks must be at least 1','error');return;}
    if(editMode){
        var cyc=getCurrentPivCycle();if(!cyc)return;
        DB.update('piv_cycles',cyc.id,{startDate:sd,startTime:st,daysPerRack:dp,totalRacks:tr});
        logAction('PIV','CYCLE_UPDATE','Cycle #'+cyc.cycleNo+' updated — '+tr+' racks × '+dp+' days, from '+sd+' '+st);
        showToast('Cycle updated — every rack slot re-scheduled','success');
    }else{
        var no=getPivCycles().length+1;
        var c=DB.add('piv_cycles',{cycleNo:no,startDate:sd,startTime:st,daysPerRack:dp,totalRacks:tr});
        var end=pivCycleEnd(c);
        logAction('PIV','CYCLE_START','Cycle #'+no+' — '+tr+' racks × '+dp+' days (total '+Math.round(tr*dp)+' days), starts '+sd+' '+st+', ends '+fmtDT(end));
        addNotif('PIV Count Cycle #'+no+' started — '+tr+' racks × '+dp+' days. Complete by '+fmtDT(end),'info');
        showToast('Count Cycle #'+no+' started — '+tr+' racks, '+Math.round(tr*dp)+' days','success');
    }
    closeModal();renderPIV();
}
function closePivCycle(){
    var cyc=getCurrentPivCycle();if(!cyc)return;
    var racks=pivRackList(cyc);
    var counted=racks.filter(function(r,i){return pivRackStatus(cyc,r,i).status==='COUNTED';}).length;
    if(counted<racks.length&&!confirm(counted+' of '+racks.length+' racks counted. Close this cycle anyway?'))return;
    if(!confirm('Close Count Cycle #'+cyc.cycleNo+'? The next count will start a new cycle.'))return;
    DB.update('piv_cycles',cyc.id,{completedAt:new Date().toISOString()});
    logAction('PIV','CYCLE_CLOSE','Cycle #'+cyc.cycleNo+' closed — '+counted+'/'+racks.length+' racks counted');
    showToast('Cycle #'+cyc.cycleNo+' closed','success');
    renderPIV();
}
function deletePivRow(id){
    if(!confirm('Delete this PIV record? This cannot be undone.'))return;
    var rec=DB.find('location_master',id);
    DB.remove('location_master',id);
    logAction('PIV','DELETE',(rec?(rec.material+' @ '+(rec.rack||'')+' (qty '+(rec.quantity||0)+')'):'Record')+' — manual delete');
    showToast('PIV record deleted','success');
    renderPIV();
}

// --- Scanner Callbacks ---
function openScannerForPIVEan(){
    APP.scanCallback=function(code){
        document.getElementById('pivEanScan').value=code;
        lookupPIVEan();
    };
    document.getElementById('scannerModal').style.display='flex';
    
}
function openScannerForPIVRack(){
    APP.scanCallback=function(code){
        document.getElementById('pivRackScan').value=code.toUpperCase();
        var sel=document.getElementById('pivRackSelect');
        if(sel){for(var i=0;i<sel.options.length;i++){if(sel.options[i].value.toUpperCase()===code.toUpperCase()){sel.selectedIndex=i;break;}}}
        showPivRackCycleInfo();
        document.getElementById('pivQty').focus();
    };
    document.getElementById('scannerModal').style.display='flex';
    
}

// --- EAN Lookup from Material Master ---
async function lookupPIVEan(){
    var val=document.getElementById('pivEanScan').value.trim().toUpperCase();
    if(!val){showToast('Please scan or type an EAN number','error');return;}

    var hit=await sbFindMaterialAny(val); var found=hit?hit.row:null; var matchedBy=hit?hit.by:'';   // EAN ya Material — auto detect

    var infoDiv=document.getElementById('pivMatInfo');
    var msgDiv=document.getElementById('pivLookupMsg');
    infoDiv.style.display='';

    if(found){
        document.getElementById('pivMaterial').value=found.material||'';
        document.getElementById('pivDescription').value=found.description||found.material||'';
        document.getElementById('pivEanSaved').value=found.ean||val;
        if(matchedBy!=='ean'&&found.ean)document.getElementById('pivEanScan').value=found.ean;   // material scan kiya to EAN field me asli EAN aa jaye
        msgDiv.innerHTML='<div style="background:var(--accent-dim);padding:10px;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px"><i class="bx bx-check-circle" style="color:var(--accent);font-size:18px"></i><span style="color:var(--accent)">Material found in master — <strong>'+esc(found.material)+'</strong>'+(matchedBy&&matchedBy!=='ean'?' <span style="opacity:.8">(matched by '+(matchedBy==='material'?'Material code':'Description')+')</span>':'')+'. You can edit it.</span></div>';
        document.getElementById('pivRackScan').focus();
    } else {
        document.getElementById('pivMaterial').value='';
        document.getElementById('pivDescription').value='';
        document.getElementById('pivEanSaved').value=val;
        msgDiv.innerHTML='<div style="background:rgba(255,107,107,0.1);padding:10px;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px;border:1px solid rgba(255,107,107,0.3)"><i class="bx bx-error-circle" style="color:var(--danger);font-size:18px"></i><span style="color:var(--danger)">EAN <strong>'+esc(val)+'</strong> not found in Material Master. Please enter manually.</span></div>';
        document.getElementById('pivMaterial').focus();
    }
}

// --- Save PIV ---
// --- Save PIV (Re-count Rule) ---
// 1. Same material + same rack + same qty   → record stays as-is (no change)
// 2. Same material + same rack + new qty    → OLD entry DELETED, new entry ADDED (stock never increases)
async function savePIV(){
    var ean=document.getElementById('pivEanSaved')?document.getElementById('pivEanSaved').value.trim():document.getElementById('pivEanScan').value.trim().toUpperCase();
    var material=document.getElementById('pivMaterial').value.trim();
    var description=document.getElementById('pivDescription').value.trim();
    var rack=document.getElementById('pivRackScan').value.trim().toUpperCase();
    var qty=parseInt(document.getElementById('pivQty').value)||0;
    var packing=document.getElementById('pivPack').value.trim();
    var box=document.getElementById('pivBox').value.trim().toUpperCase();

    if(!ean){showToast('Please scan or type an EAN number','error');document.getElementById('pivEanScan').focus();return;}
    if(!material){showToast('Material name is required','error');document.getElementById('pivMaterial').focus();return;}
    if(!rack){showToast('Please scan or select a rack','error');document.getElementById('pivRackScan').focus();return;}
    if(qty<=0){showToast('Quantity must be at least 1','error');document.getElementById('pivQty').focus();return;}

    var cyc=getCurrentPivCycle();
    var rec={
        date:today(),
        rack:rack,
        ean:ean,
        material:material,
        description:description||material,
        quantity:qty,
        packing:packing,
        box:box,
        action:'PIV',
        user:APP.currentUser?APP.currentUser.name:'Unknown',
        userId:APP.currentUser?APP.currentUser.id:'',
        dateTime:new Date().toISOString(),
        cycleNo:cyc?cyc.cycleNo:null
    };

    // --- Find the most recent PIV entry for the SAME material + SAME rack (SERVER-side) ---
    var prevRes=await sbSearch('location_master',{eq:{action:'PIV',rack:rack},limit:50,order:'created_at'});
    var prev=prevRes.rows.filter(function(l){return (l.material||'').toUpperCase()===material.toUpperCase();})[0]||null;

    if(prev && prev.quantity===qty){
        // RULE 1: same material, same location, same qty → no change, record stays as-is
        logAction('PIV','NO-CHANGE',material+' @ '+rack+' — same qty '+qty+' counted again; record unchanged');
        showToast('Same material, same location, same quantity — record already exists. No change made.','info');
        closeModal();
        renderPIV();
        return;
    }

    if(prev){
        // RULE 2: re-count (5 days later or any time) → old entry deleted, new entry added
        // Works for any qty difference (10, 1, 500...) — stock is never inflated
        DB.remove('location_master',prev.id);
        DB.add('location_master',rec);scheduleAutoLock();
        logAction('PIV','RECOUNT',material+' @ '+rack+' — old entry (qty '+prev.quantity+') deleted, new count (qty '+qty+') saved. Stock not increased.');
        showToast('PIV updated — old entry deleted, new count saved (qty '+prev.quantity+' → '+qty+'). Stock not increased.','success');
        closeModal();
        renderPIV();
        return;
    }

    // First count for this material at this rack → normal add
    DB.add('location_master',rec);scheduleAutoLock();
    logAction('PIV','ADD',material+' qty:'+qty+' at '+rack+' EAN:'+ean+(cyc?' (Cycle #'+cyc.cycleNo+')':''));
    showToast('PIV entry saved!'+(cyc?' — Cycle #'+cyc.cycleNo+' slot updated.':''),'success');
    closeModal();
    renderPIV();
}

// ==================== LOCATION MASTER ====================
var LOC_SRV={q:'',page:1,per:50,count:0,action:''};

async function renderLocationMaster(){
    var off=(LOC_SRV.page-1)*LOC_SRV.per;
    var eq={}; if(LOC_SRV.action)eq.action=LOC_SRV.action;
    var res=await sbSearch('location_master',{search:LOC_SRV.q,cols:['rack','material','ean','description','user'],eq:eq,limit:LOC_SRV.per,offset:off,order:'created_at'});
    LOC_SRV.count=res.count||0;
    var putawayC=await sbCount('location_master',{action:'PUTAWAY'});
    var pivC=await sbCount('location_master',{action:'PIV'});
    var scanC=await sbCount('location_master',{action:'EAN-SCAN'});
    var h='<div class="section-header"><h2><i class="bx bx-map-pin"></i> Warehouse Stock ('+LOC_SRV.count.toLocaleString()+')</h2>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
    h+='<button class="btn btn-glass" onclick="showLocBulkUpload()"><i class="bx bx-upload"></i> Bulk Upload</button>';
    h+='<button class="btn btn-glass" onclick="downloadLocTemplate()"><i class="bx bx-file"></i> Template</button>';
    h+='<button class="btn btn-glass" onclick="exportTableExcel(&#39;location_master&#39;,&#39;Location_Master&#39;)"><i class="bx bx-download"></i> Excel</button>';
    h+='<button class="btn btn-glass" onclick="showLocReport()"><i class="bx bx-bar-chart"></i> Report</button>';
    h+='</div></div>';
    h+='<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">';
    h+='<div style="flex:1;min-width:100px;padding:10px;background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);text-align:center"><div style="font-size:18px;font-weight:800;color:var(--accent)">'+LOC_SRV.count.toLocaleString()+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">TOTAL ROWS</div></div>';
    h+='<div style="flex:1;min-width:80px;padding:10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:16px;font-weight:700;color:var(--accent)">'+putawayC.toLocaleString()+'</div><div style="font-size:9px;color:var(--text-muted)">PUTAWAY</div></div>';
    h+='<div style="flex:1;min-width:80px;padding:10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:16px;font-weight:700;color:var(--info)">'+pivC.toLocaleString()+'</div><div style="font-size:9px;color:var(--text-muted)">PIV</div></div>';
    h+='<div style="flex:1;min-width:80px;padding:10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:16px;font-weight:700;color:var(--accent2)">'+scanC.toLocaleString()+'</div><div style="font-size:9px;color:var(--text-muted)">EAN SCAN</div></div>';
    h+='</div>';
    h+='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">';
    h+='<div class="search-box" style="flex:1;min-width:200px"><i class="bx bx-search"></i><input type="text" id="locSearch" value="'+esc(LOC_SRV.q)+'" placeholder="Search rack, material, EAN, user..." oninput="locSrvType()"></div>';
    h+='<select class="form-input" id="locActionFilter" onchange="locSrvFilter(this.value)" style="width:auto;min-width:130px;font-size:12px"><option value="">All Actions</option><option value="PUTAWAY">PUTAWAY</option><option value="PIV">PIV</option><option value="EAN-SCAN">EAN-SCAN</option></select>';
    h+='<select class="form-input" id="locPerPageSel" onchange="locSrvPerPage(this.value)" style="width:auto;min-width:100px;font-size:12px"><option value="50">50/Page</option><option value="100">100/Page</option><option value="200">200/Page</option><option value="500">500/Page</option></select>';
    h+='</div>';
    h+='<div id="locTable">'+buildLocTable(res.rows)+'</div>';
    h+=renderPag(LOC_SRV.page,Math.ceil(LOC_SRV.count/LOC_SRV.per)||1,'goLocPage');
    setHtml(h);
    var af=document.getElementById('locActionFilter'); if(af)af.value=LOC_SRV.action;
    var ps=document.getElementById('locPerPageSel'); if(ps)ps.value=String(LOC_SRV.per);
    var sf=document.getElementById('locSearch');
    if(sf&&LOC_SRV.q){ sf.focus(); sf.setSelectionRange(sf.value.length,sf.value.length); }
}
var _locT=null;
function locSrvType(){
    clearTimeout(_locT);
    _locT=setTimeout(async function(){
        var inp=document.getElementById('locSearch'); if(!inp)return;
        LOC_SRV.q=inp.value.trim(); LOC_SRV.page=1;
        await renderLocationMaster();
    },350);
}
function locSrvFilter(v){ LOC_SRV.action=v; LOC_SRV.page=1; renderLocationMaster(); }
function locSrvPerPage(v){ LOC_SRV.per=parseInt(v)||50; LOC_SRV.page=1; renderLocationMaster(); }
async function goLocPage(p){ LOC_SRV.page=p; await renderLocationMaster(); }

function buildLocTable(locs){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Date</th><th>Rack</th><th>Material</th><th>Description</th><th>EAN</th><th>Qty</th><th>Action</th><th>Packing</th><th>Box</th><th>User</th><th></th></tr></thead><tbody>';
    if(!locs.length)h+='<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:20px"><i class="bx bx-inbox" style="font-size:20px;display:block;margin-bottom:6px"></i>No data</td></tr>';
    else {
        var startIdx=(LOC_SRV.page-1)*LOC_SRV.per;
        locs.forEach(function(l,i){
            var actCls=l.action==='PUTAWAY'?'badge-accent':(l.action==='PIV'?'badge-info':(l.action==='EAN-SCAN'?'badge-success':'badge-warning'));
            h+='<tr><td>'+(startIdx+i+1)+'</td><td style="font-size:11px">'+esc(l.date)+'</td><td><span class="badge badge-accent">'+esc(l.rack)+'</span></td><td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><strong>'+esc(l.material)+'</strong></td><td style="font-size:10px;color:var(--text-secondary);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(l.description||'-')+'</td><td style="font-family:var(--font-display);font-size:9px">'+esc(l.ean||'-')+'</td><td><strong style="color:var(--accent)">'+l.quantity+'</strong></td><td><span class="badge '+actCls+'">'+esc(l.action)+'</span></td><td>'+esc(l.packing||'-')+'</td><td>'+esc(l.box||'-')+'</td><td style="font-size:10px;color:var(--text-secondary)">'+esc(l.user||'-')+'</td><td><button class="btn btn-danger btn-sm" onclick="deleteLocRow(\''+l.id+'\')" title="Delete"><i class="bx bx-trash"></i></button></td></tr>';
        });
    }
    h+='</tbody></table></div>';return h;
}

async function goLocPageOld(p){LOC_SRV.page=p;renderLocationMaster();}

// --- Delete Single Row ---
function deleteLocRow(id){
    if(!confirm('Delete this row?'))return;
    DB.remove('location_master',id);
    showToast('Row deleted','warning');
    renderLocationMaster();
}

// --- Download Template ---
function downloadLocTemplate(){
    var rows=[
        ['Date','Rack','Material','EAN','Qty','Action','Packing','Box'],
        ['2025-01-15','RACK-A01','Sample Material 1','8901234567890','10','PUTAWAY','Bag','B001'],
        ['2025-01-15','RACK-B02','Sample Material 2','8901234567891','25','PIV','Box','B002'],
        ['2025-01-15','RACK-C03','Sample Material 3','8901234567892','50','EAN-SCAN','Pallet','P001']
    ];
    var ws=XLSX.utils.aoa_to_sheet(rows);
    // Column widths
    ws['!cols']=[{wch:12},{wch:14},{wch:30},{wch:18},{wch:8},{wch:12},{wch:10},{wch:10}];
    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Template');
    XLSX.writeFile(wb,'Location_Master_Template.xlsx');
    showToast('Template downloaded! Fill in data using this format','success');
}

// --- Bulk Upload ---
function showLocBulkUpload(){
    var h='<div style="background:var(--accent-dim);padding:12px;border-radius:var(--radius-sm);margin-bottom:14px;font-size:12px;color:var(--accent);border:1px solid var(--accent)"><i class="bx bx-info-circle" style="font-size:16px"></i> <strong>25,000+ rows</strong> are supported. The upload may take a while — please wait.</div>';
    h+='<div class="form-group"><label>Upload Excel File <span class="req">*</span></label>';
    h+='<label class="btn btn-glass btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px"><i class="bx bx-upload"></i> Choose File (.xlsx / .xls / .csv)<input type="file" id="locBulkFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="document.getElementById(\'locBulkFName\').innerText=this.files[0].name+\' (\'+(this.files[0].size/1024).toFixed(1)+\' KB)\'"></label>';
    h+='<div id="locBulkFName" style="font-size:11px;color:var(--text-muted);margin-top:6px">No file chosen</div></div>';
    h+='<div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted);border:1px dashed var(--border)">';
    h+='<div style="font-weight:700;color:var(--warning);margin-bottom:6px"><i class="bx bx-table"></i> Required Column Format (Row 1 = Header):</div>';
    h+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">';
    var cols=['Date','Rack','Material','EAN','Qty','Action','Packing','Box'];
    cols.forEach(function(c){h+='<span style="background:var(--accent-dim);color:var(--accent);padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;border:1px solid var(--accent)">'+c+'</span>';});
    h+='</div>';
    h+='<div><strong>Action values:</strong> PUTAWAY, PIV, EAN-SCAN (ya jo bhi custom ho)</div>';
    h+='<div><strong>Date format:</strong> YYYY-MM-DD ya DD/MM/YYYY</div>';
    h+='</div>';
    h+='<div id="locBulkProgress" style="display:none;margin-top:12px"></div>';
    showModal('Bulk Upload — Location Master',h,'lg',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="processLocBulkUpload()"><i class="bx bx-check-double"></i> Upload</button>');
}

function processLocBulkUpload(){
    var fi=document.getElementById('locBulkFile');
    if(!fi||!fi.files[0]){showToast('Please select a file','error');return;}

    var progDiv=document.getElementById('locBulkProgress');
    progDiv.style.display='';
    progDiv.innerHTML='<div style="background:var(--bg-secondary);padding:10px;border-radius:var(--radius-sm);text-align:center;color:var(--accent)"><i class="bx bx-loader-circle bx-spin" style="font-size:20px;display:block;margin-bottom:6px"></i>Reading file... please wait</div>';

    setTimeout(function(){
        try{
            var reader=new FileReader();
            reader.onload=function(e){
                try{
                    var t0=performance.now();
                    var wb=XLSX.read(e.target.result,{type:'array'});
                    var ws=wb.Sheets[wb.SheetNames[0]];
                    var data=XLSX.utils.sheet_to_json(ws,{header:1,raw:false});

                    if(!data||data.length<2){showToast('File is empty','error');progDiv.innerHTML='';return;}

                    var headerRow=data[0].map(function(h){return String(h||'').trim().toLowerCase();});
                    var colMap={date:-1,rack:-1,material:-1,ean:-1,qty:-1,action:-1,packing:-1,box:-1};
                    var keys=['date','rack','material','ean','qty','action','packing','box'];
                    var aliases={date:['date','dt'],rack:['rack','location'],material:['material','item'],ean:['ean','barcode'],qty:['qty','quantity'],action:['action','type'],packing:['packing','pack'],box:['box','boxno']};

                    keys.forEach(function(k){
                        aliases[k].forEach(function(a){
                            for(var ci=0;ci<headerRow.length;ci++){
                                if(headerRow[ci]===a&&colMap[k]===-1){colMap[k]=ci;break;}
                            }
                        });
                    });

                    if(colMap.rack===-1||colMap.material===-1||colMap.qty===-1){
                        showToast('Missing required columns: Rack, Material, Qty','error');progDiv.innerHTML='';return;
                    }

                    function parseDate(val){
                        if(!val)return today();
                        var s=String(val).trim();
                        if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
                        var parts=s.split(/[\/\-\.]/);
                        if(parts.length===3){
                            if(parts[0].length===4)return parts[0]+'-'+parts[1].padStart(2,'0')+'-'+parts[2].padStart(2,'0');
                            if(parts[2].length===4)return parts[2]+'-'+parts[1].padStart(2,'0')+'-'+parts[0].padStart(2,'0');
                        }
                        return today();
                    }

                    // ---- Validate + build rows (memory only — no DB writes here) ----
                    var valid=[];
                    var skipped=0;
                    var userName=APP.currentUser?APP.currentUser.name:'Bulk Upload';
                    var userId=APP.currentUser?APP.currentUser.id:'';

                    for(var k=1;k<data.length;k++){
                        var r=data[k];
                        if(!r||!r.length)continue;

                        var rack=colMap.rack>=0?String(r[colMap.rack]||'').trim().toUpperCase():'';
                        var material=colMap.material>=0?String(r[colMap.material]||'').trim():'';
                        var ean=colMap.ean>=0?String(r[colMap.ean]||'').trim():'';
                        var qty=colMap.qty>=0?parseInt(r[colMap.qty])||0:0;
                        var action=colMap.action>=0?String(r[colMap.action]||'').trim().toUpperCase():'BULK';
                        var packing=colMap.packing>=0?String(r[colMap.packing]||'').trim():'';
                        var box=colMap.box>=0?String(r[colMap.box]||'').trim().toUpperCase():'';
                        var date=colMap.date>=0?parseDate(r[colMap.date]):today();

                        if(!rack||!material||qty<=0){skipped++;continue;}

                        valid.push({
                            date:date,
                            rack:rack,
                            ean:ean,
                            material:material,
                            description:material,
                            quantity:qty,
                            packing:packing,
                            box:box,
                            action:action||'BULK',
                            user:userName,
                            userId:userId,
                            dateTime:new Date().toISOString()
                        });
                    }

                    if(!valid.length){
                        progDiv.innerHTML='<div style="background:rgba(255,107,107,0.1);padding:12px;border-radius:var(--radius-sm);color:var(--danger);font-size:12px"><i class="bx bx-error"></i> No valid rows found ('+skipped+' skipped)</div>';
                        return;
                    }

                    // ---- Chunked insert: 2500 rows per batch, UI freeze zero ----
                    var CHUNK=2500, done=0, total=valid.length;
                    var t1;

                    function renderProg(){
                        var pct=Math.round((done/total)*100);
                        var ph='<div style="padding:12px;background:var(--bg-secondary);border-radius:var(--radius-sm);border:1px solid var(--border)">';
                        ph+='<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><span><i class="bx bx-loader-alt bx-spin"></i> Uploading...</span><span style="color:var(--text-muted)">'+done.toLocaleString()+' / '+total.toLocaleString()+'</span></div>';
                        ph+='<div style="height:6px;background:var(--bg-primary);border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,var(--accent),#2ed573)"></div></div>';
                        ph+='</div>';
                        progDiv.innerHTML=ph;
                    }
                    renderProg();

                    function chunkInsert(){
                        var end=Math.min(done+CHUNK,total);
                        DB.addBulk('location_master',valid.slice(done,end));  // 1 memory write + row-level server push
                        done=end;
                        renderProg();
                        if(done<total){ setTimeout(chunkInsert,0); }
                        else { finishLoc(); }
                    }

                    async function finishLoc(){
                        if(_rowPushTimers['location_master'])clearTimeout(_rowPushTimers['location_master']);
                        await flushPushRows('location_master');
                        broadcastRefresh('location_master');     // sab users live refresh
                        scheduleAutoLock();
                        t1=performance.now();
                        var timeSec=((t1-t0)/1000).toFixed(1);
                        var resHtml='<div style="background:var(--bg-secondary);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border)">';
                        resHtml+='<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">';
                        resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--success)">'+done+'</div><div style="font-size:9px;color:var(--text-muted)">ADDED</div></div>';
                        if(skipped>0)resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--danger)">'+skipped+'</div><div style="font-size:9px;color:var(--text-muted)">SKIPPED</div></div>';
                        resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--accent)">'+timeSec+'s</div><div style="font-size:9px;color:var(--text-muted)">TIME</div></div>';
                        resHtml+='</div>';
                        resHtml+='<div style="font-size:11px;color:var(--text-muted)"><i class="bx bx-check-circle" style="color:var(--success)"></i> Upload complete — synced to Supabase, visible to all users live.</div>';
                        resHtml+='</div>';
                        progDiv.innerHTML=resHtml;
                        logAction('Location Master','BULK_UPLOAD',done+' rows added in '+timeSec+'s');
                        showToast(done.toLocaleString()+' rows uploaded! ('+timeSec+'s)','success');
                    }

                    chunkInsert();

                }catch(err){
                    progDiv.innerHTML='<div style="background:rgba(255,107,107,0.1);padding:12px;border-radius:var(--radius-sm);color:var(--danger);font-size:12px"><i class="bx bx-error"></i> Error: '+esc(err.message)+'</div>';
                    showToast('Excel error: '+err.message,'error');
                }
            };
            reader.readAsArrayBuffer(fi.files[0]);
        }catch(err){
            progDiv.innerHTML='<div style="color:var(--danger);font-size:12px">'+esc(err.message)+'</div>';
        }
    },100);
}

// --- Location Report ---
async function showLocReport(){
    await sbPullFull('location_master');   // server se poora data on-demand
    var locs=DB.get('location_master');

    // Action wise summary
    var actionMap={};
    var rackMap={};
    var dateMap={};
    var userMap={};
    var totalQty=0;

    locs.forEach(function(l){
        totalQty+=l.quantity;
        // Action
        if(!actionMap[l.action])actionMap[l.action]={count:0,qty:0};
        actionMap[l.action].count++;actionMap[l.action].qty+=l.quantity;
        // Rack
        if(!rackMap[l.rack])rackMap[l.rack]={count:0,qty:0};
        rackMap[l.rack].count++;rackMap[l.rack].qty+=l.quantity;
        // Date
        if(!dateMap[l.date])dateMap[l.date]={count:0,qty:0};
        dateMap[l.date].count++;dateMap[l.date].qty+=l.quantity;
        // User
        if(!userMap[l.user])userMap[l.user]={count:0,qty:0};
        userMap[l.user].count++;userMap[l.user].qty+=l.quantity;
    });

    // Sort racks by qty desc
    var sortedRacks=Object.keys(rackMap).sort(function(a,b){return rackMap[b].qty-rackMap[a].qty;});
    var sortedDates=Object.keys(dateMap).sort().reverse();
    var sortedUsers=Object.keys(userMap).sort(function(a,b){return userMap[b].qty-userMap[a].qty;});

    var h='<div style="text-align:center;margin-bottom:16px"><div style="font-size:11px;color:var(--text-muted);letter-spacing:2px">LOCATION MASTER REPORT</div><div style="font-size:20px;font-weight:800;color:var(--accent)">'+locs.length+' Records | '+totalQty+' Total Qty</div></div>';

    // Summary Cards
    h+='<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
    Object.keys(actionMap).forEach(function(a){
        var cls=a==='PUTAWAY'?'var(--accent)':(a==='PIV'?'var(--info)':'var(--accent2)');
        h+='<div style="flex:1;min-width:120px;padding:12px;background:var(--bg-secondary);border:1px solid '+cls+';border-radius:var(--radius-sm);text-align:center"><div style="font-size:20px;font-weight:800;color:'+cls+'">'+actionMap[a].qty+'</div><div style="font-size:10px;color:var(--text-muted)">'+esc(a)+' QTY</div><div style="font-size:9px;color:var(--text-muted)">'+actionMap[a].count+' rows</div></div>';
    });
    h+='</div>';

    // Rack Wise
    h+='<div class="card-title"><i class="bx bx-diamond" style="color:var(--accent)"></i> Rack Wise Summary ('+sortedRacks.length+' racks)</div>';
    h+='<div class="table-wrapper" style="max-height:200px;overflow-y:auto"><table class="data-table"><thead><tr><th>#</th><th>Rack</th><th>Rows</th><th>Total Qty</th><th>Share %</th></tr></thead><tbody>';
    sortedRacks.forEach(function(r,i){
        var pct=totalQty>0?((rackMap[r].qty/totalQty)*100).toFixed(1):'0.0';
        h+='<tr><td>'+(i+1)+'</td><td><span class="badge badge-accent">'+esc(r)+'</span></td><td>'+rackMap[r].count+'</td><td><strong style="color:var(--accent)">'+rackMap[r].qty+'</strong></td><td><div style="display:flex;align-items:center;gap:6px"><div style="background:var(--border);height:6px;border-radius:3px;width:80px"><div style="background:var(--accent);height:100%;border-radius:3px;width:'+pct+'%"></div></div><span style="font-size:10px;color:var(--text-muted)">'+pct+'%</span></div></td></tr>';
    });
    h+='</tbody></table></div>';

    // Date Wise
    h+='<div class="card-title" style="margin-top:14px"><i class="bx bx-calendar" style="color:var(--success)"></i> Date Wise ('+sortedDates.length+' days)</div>';
    h+='<div class="table-wrapper" style="max-height:180px;overflow-y:auto"><table class="data-table"><thead><tr><th>Date</th><th>Rows</th><th>Total Qty</th></tr></thead><tbody>';
    sortedDates.slice(0,30).forEach(function(d){
        h+='<tr><td>'+esc(d)+'</td><td>'+dateMap[d].count+'</td><td><strong style="color:var(--success)">'+dateMap[d].qty+'</strong></td></tr>';
    });
    h+='</tbody></table></div>';

    // User Wise
    h+='<div class="card-title" style="margin-top:14px"><i class="bx bx-user" style="color:var(--accent2)"></i> User Wise ('+sortedUsers.length+' users)</div>';
    h+='<div class="table-wrapper" style="max-height:180px;overflow-y:auto"><table class="data-table"><thead><tr><th>User</th><th>Rows</th><th>Total Qty</th></tr></thead><tbody>';
    sortedUsers.forEach(function(u){
        h+='<tr><td>'+esc(u)+'</td><td>'+userMap[u].count+'</td><td><strong style="color:var(--accent2)">'+userMap[u].qty+'</strong></td></tr>';
    });
    h+='</tbody></table></div>';

    h+='<div class="form-actions" style="margin-top:16px"><button class="btn btn-glass" onclick="downloadLocReportPDF()"><i class="bx bx-download"></i> Download Report PDF</button><button class="btn btn-glass" onclick="closeModal()">Close</button></div>';

    showModal('Location Master Report',h,'xl','');
}

// --- Report PDF Download ---
async function downloadLocReportPDF(){
    await sbPullFull('location_master');
    var locs=DB.get('location_master');
    var actionMap={},rackMap={},totalQty=0;
    locs.forEach(function(l){
        totalQty+=l.quantity;
        if(!actionMap[l.action])actionMap[l.action]={count:0,qty:0};
        actionMap[l.action].count++;actionMap[l.action].qty+=l.quantity;
        if(!rackMap[l.rack])rackMap[l.rack]={count:0,qty:0};
        rackMap[l.rack].count++;rackMap[l.rack].qty+=l.quantity;
    });
    var sortedRacks=Object.keys(rackMap).sort(function(a,b){return rackMap[b].qty-rackMap[a].qty;});

    var jsPDF=window.jspdf.jsPDF;
    var doc=new jsPDF({unit:'mm',format:'a4'});
    var y=15;

    // Header
    doc.setFillColor(15,23,42);doc.rect(0,0,210,35,'F');
    doc.setTextColor(0,255,136);doc.setFontSize(16);doc.setFont('helvetica','bold');
    doc.text('LOCATION MASTER REPORT',105,y+8,{align:'center'});
    doc.setTextColor(180,180,180);doc.setFontSize(9);doc.setFont('helvetica','normal');
    doc.text('Total: '+locs.length+' records | '+totalQty+' qty | Generated: '+fmtDT(new Date()),105,y+18,{align:'center'});
    y=45;

    // Action Summary
    doc.setFontSize(11);doc.setFont('helvetica','bold');doc.setTextColor(30,30,30);
    doc.text('Action Summary',10,y);y+=7;
    doc.setFillColor(240,240,240);doc.rect(10,y,190,7,'F');
    doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(80,80,80);
    doc.text('Action',12,y+5);doc.text('Rows',100,y+5);doc.text('Total Qty',140,y+5);y+=10;
    doc.setFont('helvetica','normal');doc.setTextColor(30,30,30);
    Object.keys(actionMap).forEach(function(a){
        doc.text(a,12,y+1);doc.text(String(actionMap[a].count),100,y+1);doc.text(String(actionMap[a].qty),140,y+1);y+=6;
    });
    y+=8;

    // Rack Summary
    doc.setFontSize(11);doc.setFont('helvetica','bold');
    doc.text('Rack Summary ('+sortedRacks.length+' racks)',10,y);y+=7;
    doc.setFillColor(240,240,240);doc.rect(10,y,190,7,'F');
    doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(80,80,80);
    doc.text('#',12,y+5);doc.text('Rack',22,y+5);doc.text('Rows',80,y+5);doc.text('Total Qty',110,y+5);doc.text('Share %',150,y+5);y+=10;
    doc.setFont('helvetica','normal');doc.setTextColor(30,30,30);
    sortedRacks.forEach(function(r,i){
        if(y>270){doc.addPage();y=15;}
        var pct=totalQty>0?((rackMap[r].qty/totalQty)*100).toFixed(1):'0.0';
        doc.text(String(i+1),12,y+1);doc.text(r,22,y+1);doc.text(String(rackMap[r].count),80,y+1);doc.text(String(rackMap[r].qty),110,y+1);doc.text(pct+'%',150,y+1);y+=6;
    });

    // Footer
    y=285;
    doc.setDrawColor(150,150,150);doc.line(10,y,200,y);
    doc.setTextColor(130,130,130);doc.setFontSize(7);
    doc.text('Location Master Report — '+APP.currentUser.name+' — '+new Date().toISOString(),105,y+4,{align:'center'});

    doc.save('Location_Master_Report_'+today()+'.pdf');
    showToast('Report PDF downloaded!','success');
    logAction('Location Master','REPORT_PDF','Report downloaded');
}

// ==================== BIN MASTER ====================
async function renderRackMaster(){
    var bins=DB.get('rack_master');
    await sbPullFull('location_master',120000);   // occupancy ke liye on-demand (2 min cache)

    var h='<div class="section-header"><h2><i class="bx bx-grid-alt"></i> Storage Bins ('+bins.length+')</h2>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
    h+='<button class="btn btn-glass" onclick="showAddRack()"><i class="bx bx-plus"></i> Add Bin</button>';
    h+='<button class="btn btn-glass" onclick="showBulkBinUpload()"><i class="bx bx-upload"></i> Bulk Upload</button>';
    h+='<button class="btn btn-glass" onclick="downloadBinTemplate()"><i class="bx bx-file"></i> Template</button>';
    h+='</div></div>';

    // Quick Stats
    var occMap=buildOccMap();var totalMats=0;for(var _k in occMap)totalMats+=occMap[_k].mats;
    var occupiedCount=Object.keys(occMap).length;
    var emptyCount=bins.length-occupiedCount;

    h+='<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">';
    h+='<div style="flex:1;min-width:100px;padding:12px;background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);text-align:center"><div style="font-size:22px;font-weight:800;color:var(--accent)">'+bins.length+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">TOTAL BINS</div></div>';
    h+='<div style="flex:1;min-width:100px;padding:12px;background:rgba(0,255,136,0.06);border:1px solid var(--success);border-radius:var(--radius-sm);text-align:center"><div style="font-size:22px;font-weight:800;color:var(--success)">'+occupiedCount+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">OCCUPIED</div></div>';
    h+='<div style="flex:1;min-width:100px;padding:12px;background:rgba(255,107,107,0.06);border:1px solid var(--danger);border-radius:var(--radius-sm);text-align:center"><div style="font-size:22px;font-weight:800;color:var(--danger)">'+emptyCount+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">EMPTY</div></div>';
    h+='<div style="flex:1;min-width:100px;padding:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:22px;font-weight:800;color:var(--accent2)">'+totalMats+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">MATERIALS</div></div>';
    h+='</div>';

    // Search
    h+='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">';
    h+='<div class="search-box" style="flex:1;min-width:200px"><i class="bx bx-search"></i><input type="text" id="binSearchInput" placeholder="Search bin..." oninput="filterBinGrid()"></div>';
    h+='<select class="form-input" id="binStatusFilter" onchange="filterBinGrid()" style="width:auto;min-width:130px;font-size:12px"><option value="">All</option><option value="occupied">Occupied</option><option value="empty">Empty</option></select>';
    h+='</div>';

    // Bin Visualization Grid
    h+='<div class="card"><div class="card-title"><i class="bx bx-grid"></i> Bin Visualization <span style="font-size:10px;color:var(--text-muted);font-weight:normal">(Click to see materials)</span></div>';
    h+='<div id="binGridWrap"><div class="rack-grid">';
    bins.forEach(function(b){
        var occ=occMap[rkey(b.rack)];
        h+='<div class="rack-cell '+(occ?'occupied':'empty')+'" onclick="showBinMaterials(\''+esc(b.rack).replace(/'/g,"\\'")+'\')" title="'+esc(b.rack)+(occ?' — '+occ.mats+' materials, '+occ.qty+' qty':' — Empty')+'"><div style="font-size:13px;font-weight:700">'+esc(b.rack.replace('RACK-','').replace('BIN-',''))+'</div>';
        if(occ)h+='<div style="font-size:8px;color:var(--success);margin-top:2px">'+occ.mats+' items</div>';
        h+='</div>';
    });
    if(!bins.length)h+='<div style="text-align:center;color:var(--text-muted);padding:24px;grid-column:1/-1"><i class="bx bx-inbox" style="font-size:24px;display:block;margin-bottom:8px"></i>No bins added</div>';
    h+='</div></div></div>';

    // Bin List Table with Pagination
    var pg=paginate(bins,APP.binPage||1,APP.binPerPage||100);
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-list-ul"></i> Bin List</div>';
    h+='<div id="binTableWrap">'+buildBinTable(bins,pg.items,occMap)+'</div>';
    h+=renderPag(APP.binPage||1,pg.pages,'goBinPage');
    h+='</div>';

    setHtml(h);
}

function buildBinTable(allBins,pageBins,occMap){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Bin</th><th>Status</th><th>Materials</th><th>Total Qty</th><th>Actions</th></tr></thead><tbody>';
    if(!pageBins.length)h+='<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No bins</td></tr>';
    else {
        var startIdx=((APP.binPage||1)-1)*(APP.binPerPage||100);
        pageBins.forEach(function(b,i){
            var occ=occMap[rkey(b.rack)];
            h+='<tr style="cursor:pointer" onclick="showBinMaterials(\''+esc(b.rack).replace(/'/g,"\\'")+'\')"><td>'+(startIdx+i+1)+'</td><td><strong>'+esc(b.rack)+'</strong></td><td><span class="badge '+(occ?'badge-success':'badge-danger')+'">'+(occ?'Occupied':'Empty')+'</span></td><td>'+(occ?occ.mats:0)+'</td><td>'+(occ?occ.qty:0)+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" onclick="event.stopPropagation();showBinMaterials(\''+esc(b.rack).replace(/'/g,"\\'")+'\')"><i class="bx bx-eye"></i> View</button><button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteRack(\''+b.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';
        });
    }
    h+='</tbody></table></div>';
    return h;
}

function goBinPage(p){APP.binPage=p;renderRackMaster();}

async function filterBinGrid(){
    var q=(document.getElementById('binSearchInput').value||'').trim().toLowerCase();
    var statusF=document.getElementById('binStatusFilter').value;
    var bins=DB.get('rack_master');
    await sbPullFull('location_master',120000);
    var occMap=buildOccMap();
    if(q)bins=bins.filter(function(b){return(b.rack||'').toLowerCase().indexOf(q)>-1;});
    if(statusF==='occupied')bins=bins.filter(function(b){return occMap[rkey(b.rack)];});
    else if(statusF==='empty')bins=bins.filter(function(b){return !occMap[rkey(b.rack)];});

    var h='<div class="rack-grid">';
    bins.forEach(function(b){
        var occ=occMap[rkey(b.rack)];
        h+='<div class="rack-cell '+(occ?'occupied':'empty')+'" onclick="showBinMaterials(\''+esc(b.rack).replace(/'/g,"\\'")+'\')" title="'+esc(b.rack)+(occ?' — '+occ.mats+' materials, '+occ.qty+' qty':' — Empty')+'"><div style="font-size:13px;font-weight:700">'+esc(b.rack.replace('RACK-','').replace('BIN-',''))+'</div>';
        if(occ)h+='<div style="font-size:8px;color:var(--success);margin-top:2px">'+occ.mats+' items</div>';
        h+='</div>';
    });
    if(!bins.length)h+='<div style="text-align:center;color:var(--text-muted);padding:24px;grid-column:1/-1">No bins found</div>';
    h+='</div>';
    document.getElementById('binGridWrap').innerHTML=h;

    // Update table too
    var pg=paginate(bins,1,APP.binPerPage||100);
    APP.binPage=1;
    document.getElementById('binTableWrap').innerHTML=buildBinTable(bins,pg.items,occMap);
}

// --- Click Bin → Show Materials ---
// --- Add Single Bin ---
function showAddRack(){
    showModal('Add Bin','<div class="form-group"><label>Bin Name <span class="req">*</span></label><input type="text" id="newRack" class="form-input" placeholder="BIN-001 ya RACK-001" style="text-transform:uppercase"></div>','sm',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button><button class="btn btn-glass" onclick="saveRack()"><i class="bx bx-check"></i> Save</button>');
    setTimeout(function(){document.getElementById('newRack').focus();},300);
}
function saveRack(){
    var name=document.getElementById('newRack').value.trim().toUpperCase();if(!name){showToast('Enter bin name','error');return;}
    var exists=DB.filter('rack_master',function(r){return r.rack===name;});
    if(exists.length){showToast('Bin already exists','error');return;}
    DB.add('rack_master',{rack:name});logAction('Bin','ADD',name);showToast('Bin added!','success');closeModal();renderRackMaster();
}
function deleteRack(id){if(!confirm('Delete this bin?'))return;DB.remove('rack_master',id);showToast('Bin deleted','success');renderRackMaster();}

// --- Download Template ---
function downloadBinTemplate(){
    var rows=[];
    rows.push(['BIN']);
    for(var i=1;i<=20;i++)rows.push(['BIN-'+String(i).padStart(3,'0')]);
    var ws=XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[{wch:16}];
    var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Template');
    XLSX.writeFile(wb,'Bin_Master_Template.xlsx');
    showToast('Template downloaded! Enter data only in the BIN column','success');
}

// --- Bulk Upload ---
function showBulkBinUpload(){
    var h='<div style="background:var(--accent-dim);padding:12px;border-radius:var(--radius-sm);margin-bottom:14px;font-size:12px;color:var(--accent);border:1px solid var(--accent)"><i class="bx bx-info-circle" style="font-size:16px"></i> <strong>15,000+ bins</strong> can be uploaded at once. The page will not freeze.</div>';
    h+='<div class="form-group"><label>Upload Excel/CSV <span class="req">*</span></label>';
    h+='<label class="btn btn-glass btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px"><i class="bx bx-upload"></i> Choose File<input type="file" id="binBulkFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="document.getElementById(\'binBulkFName\').innerText=this.files[0].name+\' (\'+(this.files[0].size/1024).toFixed(1)+\' KB)\'"></label>';
    h+='<div id="binBulkFName" style="font-size:11px;color:var(--text-muted);margin-top:6px">No file chosen</div></div>';
    h+='<div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted);border:1px dashed var(--border)">';
    h+='<div style="font-weight:700;color:var(--warning);margin-bottom:6px"><i class="bx bx-table"></i> Excel Format:</div>';
    h+='<div style="display:flex;gap:4px;margin-bottom:8px"><span style="background:var(--accent-dim);color:var(--accent);padding:3px 12px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid var(--accent)">BIN</span></div>';
    h+='<div style="font-family:var(--font-display);font-size:10px;background:var(--bg-primary);padding:8px;border-radius:4px">BIN-001<br>BIN-002<br>BIN-003<br>...</div>';
    h+='</div>';
    h+='<div id="binBulkProgress" style="display:none;margin-top:12px"></div>';
    showModal('Bulk Upload — Bins',h,'lg',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="processBulkBinUpload()"><i class="bx bx-check-double"></i> Upload</button>');
}

function processBulkBinUpload(){
    var fi=document.getElementById('binBulkFile');
    if(!fi||!fi.files[0]){showToast('Please select a file','error');return;}

    var progDiv=document.getElementById('binBulkProgress');
    progDiv.style.display='';
    progDiv.innerHTML='<div style="background:var(--bg-secondary);padding:16px;border-radius:var(--radius-sm);text-align:center;color:var(--accent)"><i class="bx bx-loader-circle bx-spin" style="font-size:24px;display:block;margin-bottom:8px"></i>Processing... 15000+ rows bhi handle honge</div>';

    setTimeout(function(){
        try{
            var reader=new FileReader();
            reader.onload=function(e){
                try{
                    var t0=performance.now();
                    var wb=XLSX.read(e.target.result,{type:'array'});
                    var ws=wb.Sheets[wb.SheetNames[0]];
                    var data=XLSX.utils.sheet_to_json(ws,{header:1,raw:false});

                    if(!data||data.length<1){showToast('The selected file is empty','error');progDiv.innerHTML='';return;}

                    // Existing bins set for fast lookup
                    var existingBins={};
                    DB.get('rack_master').forEach(function(r){existingBins[r.rack]=true;});

                    // Detect column — find first column with "bin" or "rack" in header, or just use col 0
                    var colIdx=0;
                    var header0=String(data[0][0]||'').trim().toLowerCase();
                    if(header0.indexOf('bin')>-1||header0.indexOf('rack')>-1||header0.indexOf('name')>-1){
                        colIdx=0;
                    }

                    var startRow=0;
                    // Check if first row is header
                    var firstVal=String(data[0][colIdx]||'').trim().toLowerCase();
                    if(firstVal.indexOf('bin')>-1||firstVal.indexOf('rack')>-1||firstVal.indexOf('name')>-1||firstVal.indexOf('header')>-1){
                        startRow=1;
                    }

                    var added=0,duplicate=0,skipped=0;
                    var userName=APP.currentUser?APP.currentUser.name:'Bulk Upload';

                    var newBins=[];
                    for(var k=startRow;k<data.length;k++){
                        var r=data[k];
                        if(!r)continue;
                        var binName=String(r[colIdx]||'').trim().toUpperCase();
                        if(!binName){skipped++;continue;}
                        if(existingBins[binName]){duplicate++;continue;}
                        newBins.push({rack:binName});
                        existingBins[binName]=true; // Add to set so no dupes in same upload
                        added++;
                    }
                    DB.addBulk('rack_master',newBins);   // 1 memory write + row-level server push — no freeze

                    var t1=performance.now();
                    var timeSec=((t1-t0)/1000).toFixed(1);

                    var resHtml='<div style="background:var(--bg-secondary);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border)">';
                    resHtml+='<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">';
                    resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--success)">'+added+'</div><div style="font-size:9px;color:var(--text-muted)">ADDED</div></div>';
                    if(duplicate>0)resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--warning)">'+duplicate+'</div><div style="font-size:9px;color:var(--text-muted)">DUPLICATES</div></div>';
                    if(skipped>0)resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--danger)">'+skipped+'</div><div style="font-size:9px;color:var(--text-muted)">SKIPPED</div></div>';
                    resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--accent)">'+timeSec+'s</div><div style="font-size:9px;color:var(--text-muted)">TIME</div></div>';
                    resHtml+='</div>';
                    resHtml+='<div style="font-size:11px;color:var(--text-muted)"><i class="bx bx-check-circle" style="color:var(--success)"></i> Upload complete!</div>';
                    resHtml+='</div>';
                    progDiv.innerHTML=resHtml;

                    logAction('Bin','BULK_UPLOAD',added+' bins added, '+duplicate+' duplicates, '+skipped+' skipped in '+timeSec+'s');
                    showToast(added+' bins uploaded! ('+timeSec+'s)','success');

                }catch(err){
                    progDiv.innerHTML='<div style="background:rgba(255,107,107,0.1);padding:12px;border-radius:var(--radius-sm);color:var(--danger);font-size:12px"><i class="bx bx-error"></i> Error: '+esc(err.message)+'</div>';
                    showToast('Excel error: '+err.message,'error');
                }
            };
            reader.readAsArrayBuffer(fi.files[0]);
        }catch(err){
            progDiv.innerHTML='<div style="color:var(--danger);font-size:12px">'+esc(err.message)+'</div>';
        }
    },150);
}

// ==================== MATERIAL MASTER ====================
var MAT_SRV={q:'',page:1,per:50,count:0};

async function renderMaterialMaster(){
    var off=(MAT_SRV.page-1)*MAT_SRV.per;
    var res=await sbSearch('material_master',{search:MAT_SRV.q,cols:['material','ean','description'],limit:MAT_SRV.per,offset:off,order:'created_at'});
    MAT_SRV.count=res.count||0;
    var h='<div class="section-header"><h2><i class="bx bx-label"></i> Product Master ('+MAT_SRV.count.toLocaleString()+')</h2><div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportTableExcel(&#39;material_master&#39;,&#39;Material_Master&#39;)"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="showBulkUploadMaterial()"><i class="bx bx-upload"></i> Bulk Upload</button><button class="btn btn-glass" onclick="showAddMaterial()"><i class="bx bx-plus"></i> Add</button></div></div>';
    h+='<div class="search-box"><i class="bx bx-search"></i><input type="text" id="matSearch" value="'+esc(MAT_SRV.q)+'" placeholder="Search material, EAN..." oninput="matSrvType()"></div>';
    h+='<div id="matTable">'+buildMatTable(res.rows)+'</div>';
    h+=renderPag(MAT_SRV.page,Math.ceil(MAT_SRV.count/MAT_SRV.per)||1,'goMatPage');
    setHtml(h);
    var f=document.getElementById('matSearch');
    if(f&&MAT_SRV.q){ f.focus(); f.setSelectionRange(f.value.length,f.value.length); }
}
var _matT=null;
function matSrvType(){
    clearTimeout(_matT);
    _matT=setTimeout(async function(){
        var inp=document.getElementById('matSearch'); if(!inp)return;
        MAT_SRV.q=inp.value.trim(); MAT_SRV.page=1;
        var res=await sbSearch('material_master',{search:MAT_SRV.q,cols:['material','ean','description'],limit:MAT_SRV.per,offset:0,order:'created_at'});
        MAT_SRV.count=res.count||0;
        var w=document.getElementById('matTable');
        if(w)w.innerHTML=buildMatTable(res.rows)+renderPag(MAT_SRV.page,Math.ceil(MAT_SRV.count/MAT_SRV.per)||1,'goMatPage');
        var f2=document.getElementById('matSearch');
        if(f2){ f2.focus(); f2.setSelectionRange(f2.value.length,f2.value.length); }
    },350);
}
async function goMatPage(p){ MAT_SRV.page=p; await renderMaterialMaster(); }

// ========== BULK UPLOAD FEATURE ==========
function showBulkUploadMaterial(){
    var h='<div style="margin-bottom:16px;padding:12px 16px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border-color)">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><i class="bx bx-info-circle" style="color:var(--accent);font-size:18px"></i><strong>Instructions</strong></div>';
    h+='<ul style="margin:0;padding-left:20px;color:var(--text-muted);font-size:13px;line-height:1.8">';
    h+='<li>Upload a CSV file (max 100,000 rows supported)</li>';
    h+='<li>Required columns: <code style="background:var(--bg-primary);padding:2px 6px;border-radius:4px">Material, EAN</code></li>';
    h+='<li>Optional columns: <code style="background:var(--bg-primary);padding:2px 6px;border-radius:4px">Description, Division, Brand</code></li>';
    h+='<li>Duplicate EAN skip ho jayenge</li>';
    h+='<li>First row must be header row</li>';
    h+='</ul></div>';
    
    h+='<div style="margin-bottom:16px"><button class="btn btn-glass" onclick="downloadMaterialTemplate()"><i class="bx bx-file"></i> Download CSV Template</button></div>';
    
    h+='<div id="bulkDropZone" style="border:2px dashed var(--border-color);border-radius:12px;padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s" ondragover="event.preventDefault();this.style.borderColor=\'var(--accent)\';this.style.background=\'var(--bg-secondary)\'" ondragleave="this.style.borderColor=\'var(--border-color)\';this.style.background=\'transparent\'" ondrop="handleBulkDrop(event)" onclick="document.getElementById(\'bulkFileInput\').click()">';
    h+='<i class="bx bx-cloud-upload" style="font-size:48px;color:var(--text-muted);display:block;margin-bottom:8px"></i>';
    h+='<p style="color:var(--text-muted);margin:0">Drag & Drop CSV file here<br><span style="font-size:12px">or click to browse</span></p>';
    h+='<input type="file" id="bulkFileInput" accept=".csv,.txt" style="display:none" onchange="handleBulkFile(this)">';
    h+='</div>';
    
    h+='<div id="bulkPreview" style="display:none;margin-top:16px"></div>';
    h+='<div id="bulkProgress" style="display:none;margin-top:16px"></div>';
    
    showModal('Bulk Upload Materials',h,'','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

function downloadMaterialTemplate(){
    var csv='Material,EAN,Description,Division,Brand\n';
    csv+='Example Mat 1,8901234567890,Test Description 1,Food,Brand A\n';
    csv+='Example Mat 2,8901234567891,Test Description 2,Home Care,Brand B\n';
    csv+='Example Mat 3,8901234567892,Test Description 3,Personal Care,Brand C\n';
    var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    var link=document.createElement('a');
    link.href=URL.createObjectURL(blob);
    link.download='Material_Master_Template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Template downloaded!','success');
}

function handleBulkDrop(e){
    e.preventDefault();
    var zone=document.getElementById('bulkDropZone');
    zone.style.borderColor='var(--border-color)';
    zone.style.background='transparent';
    var files=e.dataTransfer.files;
    if(files.length)processBulkFile(files[0]);
}

function handleBulkFile(input){
    if(input.files.length)processBulkFile(input.files[0]);
}

function processBulkFile(file){
    if(!file.name.match(/\.(csv|txt)$/i)){
        showToast('Only CSV files allowed','error');return;
    }
    if(file.size>50*1024*1024){
        showToast('File too large (max 50MB)','error');return;
    }
    
    var preview=document.getElementById('bulkPreview');
    preview.style.display='block';
    preview.innerHTML='<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="bx bx-loader-alt bx-spin" style="font-size:24px;display:block;margin-bottom:8px"></i>Reading file...</div>';
    
    var reader=new FileReader();
    reader.onload=function(e){
        var text=e.target.result;
        parseBulkCSV(text,file.name);
    };
    reader.readAsText(file);
}

function parseBulkCSV(text,fileName){
    var lines=text.split(/\r?\n/);
    var totalLines=lines.length-1; // minus header
    
    if(totalLines<1){
        document.getElementById('bulkPreview').innerHTML='<div style="padding:12px;background:#ff475722;border:1px solid #ff4757;color:#ff4757;border-radius:8px;text-align:center">Empty file or no data rows found</div>';
        return;
    }
    
    // Parse header
    var headerLine=lines[0];
    var headers=parseCSVLine(headerLine).map(function(h){return h.trim().toLowerCase();});
    
    // Find column indices
    var colIdx={
        material:headers.indexOf('material'),
        ean:headers.indexOf('ean'),
        description:headers.indexOf('description'),
        division:headers.indexOf('division'),
        brand:headers.indexOf('brand')
    };
    
    if(colIdx.material===-1||colIdx.ean===-1){
        document.getElementById('bulkPreview').innerHTML='<div style="padding:12px;background:#ff475722;border:1px solid #ff4757;color:#ff4757;border-radius:8px;text-align:center">Required columns "Material" and "EAN" not found in header.<br>Header found: <code>'+esc(headerLine)+'</code></div>';
        return;
    }
    
    // Parse all rows
    var validRows=[],skippedRows=[],errorRows=[];
    var existingEans={};
    var existingMats=DB.get('material_master');
    existingMats.forEach(function(m){if(m.ean)existingEans[m.ean]=true;});
    
    for(var i=1;i<lines.length;i++){
        var line=lines[i].trim();
        if(!line)continue;
        
        var cols=parseCSVLine(line);
        var mat=(cols[colIdx.material]||'').trim();
        var ean=(cols[colIdx.ean]||'').trim();
        
        if(!mat&&!ean){
            skippedRows.push({row:i,reason:'Empty row'});
            continue;
        }
        if(!mat){
            errorRows.push({row:i,reason:'Material name missing'});
            continue;
        }
        if(!ean){
            errorRows.push({row:i,reason:'EAN missing'});
            continue;
        }
        if(existingEans[ean]){
            skippedRows.push({row:i,reason:'Duplicate EAN: '+ean});
            continue;
        }
        
        existingEans[ean]=true; // track within file too
        validRows.push({
            material:mat,
            ean:ean,
            description:(cols[colIdx.description]||'').trim(),
            division:(cols[colIdx.division]||'').trim(),
            brand:(cols[colIdx.brand]||'').trim()
        });
    }
    
    // Show preview
    var pv='<div style="padding:16px;background:var(--bg-secondary);border-radius:12px;border:1px solid var(--border-color)">';
    pv+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">';
    pv+='<div style="text-align:center;padding:12px;background:#2ed57322;border-radius:8px"><div style="font-size:24px;font-weight:700;color:#2ed573;font-family:var(--font-display)">'+validRows.length.toLocaleString()+'</div><div style="font-size:11px;color:var(--text-muted)">Valid Rows</div></div>';
    pv+='<div style="text-align:center;padding:12px;background:#ffa50222;border-radius:8px"><div style="font-size:24px;font-weight:700;color:#ffa502;font-family:var(--font-display)">'+skippedRows.length.toLocaleString()+'</div><div style="font-size:11px;color:var(--text-muted)">Skipped (Duplicates)</div></div>';
    pv+='<div style="text-align:center;padding:12px;background:#ff475722;border-radius:8px"><div style="font-size:24px;font-weight:700;color:#ff4757;font-family:var(--font-display)">'+errorRows.length.toLocaleString()+'</div><div style="font-size:11px;color:var(--text-muted)">Errors</div></div>';
    pv+='<div style="text-align:center;padding:12px;background:var(--bg-primary);border-radius:8px"><div style="font-size:24px;font-weight:700;color:var(--text-primary);font-family:var(--font-display)">'+totalLines.toLocaleString()+'</div><div style="font-size:11px;color:var(--text-muted)">Total Rows</div></div>';
    pv+='</div>';
    
    // File info
    pv+='<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;padding:8px;background:var(--bg-primary);border-radius:6px"><i class="bx bx-file"></i> '+esc(fileName)+' | Columns detected: '+esc(headerLine)+'</div>';
    
    // Preview first 5 rows
    if(validRows.length>0){
        pv+='<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Preview (first 5 rows):</div>';
        pv+='<div style="max-height:180px;overflow-y:auto;border-radius:6px;border:1px solid var(--border-color)"><table class="data-table" style="font-size:11px"><thead><tr><th>Material</th><th>EAN</th><th>Description</th><th>Division</th><th>Brand</th></tr></thead><tbody>';
        var previewCount=Math.min(5,validRows.length);
        for(var p=0;p<previewCount;p++){
            var r=validRows[p];
            pv+='<tr><td>'+esc(r.material)+'</td><td style="font-family:var(--font-display)">'+esc(r.ean)+'</td><td>'+esc(r.description)+'</td><td>'+esc(r.division)+'</td><td>'+esc(r.brand)+'</td></tr>';
        }
        pv+='</tbody></table></div>';
    }
    
    // Error details (collapsible)
    if(errorRows.length>0){
        pv+='<details style="margin-top:10px"><summary style="cursor:pointer;color:#ff4757;font-size:12px"><i class="bx bx-error-circle"></i> View Error Details ('+errorRows.length+')</summary>';
        pv+='<div style="max-height:120px;overflow-y:auto;margin-top:6px;padding:8px;background:#ff475711;border-radius:6px;font-size:11px;font-family:var(--font-display)">';
        errorRows.slice(0,50).forEach(function(er){pv+='<div>Row '+er.row+': '+esc(er.reason)+'</div>';});
        if(errorRows.length>50)pv+='<div>...and '+(errorRows.length-50)+' more errors</div>';
        pv+='</div></details>';
    }
    
    pv+='</div>';
    
    // Action buttons
    pv+='<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">';
    pv+='<button class="btn btn-glass" onclick="document.getElementById(\'bulkFileInput\').value=\'\';document.getElementById(\'bulkPreview\').style.display=\'none\'"><i class="bx bx-reload"></i> Re-upload</button>';
    if(validRows.length>0){
        pv+='<button class="btn btn-glass" style="background:var(--accent);color:#000;font-weight:600" onclick="executeBulkUpload()"><i class="bx bx-upload"></i> Upload '+validRows.length.toLocaleString()+' Rows</button>';
    }
    pv+='</div>';
    
    document.getElementById('bulkPreview').innerHTML=pv;
    
    // Store valid rows globally for upload
    window._bulkRows=validRows;
}

// CSV line parser - handles quoted fields with commas
function parseCSVLine(line){
    var result=[];
    var current='';
    var inQuotes=false;
    for(var i=0;i<line.length;i++){
        var ch=line[i];
        if(inQuotes){
            if(ch==='"'){
                if(i+1<line.length&&line[i+1]==='"'){current+='"';i++;}
                else inQuotes=false;
            }else{current+=ch;}
        }else{
            if(ch==='"')inQuotes=true;
            else if(ch===','){result.push(current);current='';}
            else current+=ch;
        }
    }
    result.push(current);
    return result;
}

// Chunked bulk upload with progress — 60,000+ rows, zero UI freeze
function executeBulkUpload(){
    var rows=window._bulkRows;
    if(!rows||!rows.length)return;

    var progressDiv=document.getElementById('bulkProgress');
    progressDiv.style.display='block';

    var total=rows.length;
    var CHUNK=2000;                    // memory insert batch — 1 write per 2000 rows (pehle per-row tha = hang)
    var inserted=0;
    var startTime=Date.now();

    function renderProgress(syncing){
        var pct=Math.round((inserted/total)*100);
        var elapsed=((Date.now()-startTime)/1000).toFixed(1);
        var rate=inserted>0?Math.round(inserted/elapsed):0;
        var remaining=rate>0?Math.round((total-inserted)/rate):'...';
        var ph='<div style="padding:16px;background:var(--bg-secondary);border-radius:12px;border:1px solid var(--border-color)">';
        ph+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
        ph+='<span style="font-size:13px;font-weight:600"><i class="bx bx-loader-alt bx-spin"></i> Uploading...</span>';
        ph+='<span style="font-size:12px;color:var(--text-muted);font-family:var(--font-display)">'+inserted.toLocaleString()+' / '+total.toLocaleString()+'</span>';
        ph+='</div>';
        ph+='<div style="height:8px;background:var(--bg-primary);border-radius:4px;overflow:hidden;margin-bottom:8px">';
        ph+='<div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,var(--accent),#2ed573);border-radius:4px;transition:width .1s"></div>';
        ph+='</div>';
        ph+='<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)">';
        ph+='<span>'+pct+'% complete'+(syncing?' • syncing to Supabase':'')+'</span>';
        ph+='<span>'+rate.toLocaleString()+' rows/sec | ~'+remaining+'s remaining</span>';
        ph+='</div>';
        ph+='</div>';
        progressDiv.innerHTML=ph;
    }

    renderProgress(false);

    function processChunk(){
        var end=Math.min(inserted+CHUNK,total);
        DB.addBulk('material_master',rows.slice(inserted,end));   // fast path: no stringify per row, no localStorage
        inserted=end;
        renderProgress(true);
        if(inserted<total){ setTimeout(processChunk,0); }         // UI ko breathe karne do
        else { finish(); }
    }

    async function finish(){
        // Saari rows server par commit (row-level, chunked, 3 parallel)
        if(_rowPushTimers['material_master'])clearTimeout(_rowPushTimers['material_master']);
        await flushPushRows('material_master');
        broadcastRefresh('material_master');                     // sab users ko signal — table dobara pull karo
        var elapsed=((Date.now()-startTime)/1000).toFixed(1);
        var ph='<div style="padding:20px;background:#2ed57311;border:1px solid #2ed573;border-radius:12px;text-align:center">';
        ph+='<i class="bx bx-check-circle" style="font-size:48px;color:#2ed573;display:block;margin-bottom:8px"></i>';
        ph+='<div style="font-size:20px;font-weight:700;color:#2ed573;margin-bottom:4px">Upload Complete!</div>';
        ph+='<div style="color:var(--text-muted);font-size:13px">'+total.toLocaleString()+' materials inserted in '+elapsed+'s • synced to Supabase • visible to all users</div>';
        ph+='<button class="btn btn-glass" style="margin-top:12px" onclick="closeModal();renderMaterialMaster()"><i class="bx bx-check"></i> Done</button>';
        ph+='</div>';
        progressDiv.innerHTML=ph;
        logAction('Material','BULK_UPLOAD',total+' materials uploaded');
        showToast(total.toLocaleString()+' materials uploaded!','success');
    }

    processChunk();
}

// ========== EXISTING FUNCTIONS (unchanged) ==========
function buildMatTable(mats){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>Description</th><th>EAN</th><th>Division</th><th>Brand</th><th>Actions</th></tr></thead><tbody>';
    if(!mats.length)h+='<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No data</td></tr>';
    else mats.forEach(function(m){h+='<tr><td><strong>'+esc(m.material)+'</strong></td><td>'+esc(m.description)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+esc(m.division)+'</td><td>'+esc(m.brand)+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" onclick="editMaterial(\''+m.id+'\')"><i class="bx bx-edit"></i></button><button class="btn btn-danger btn-sm" onclick="deleteMaterial(\''+m.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';});
    h+='</tbody></table></div>';return h;
}
async function goMatPageOld(p){APP.matPage=p;renderMaterialMaster();}
function showAddMaterial(){
    var h='<div class="form-row"><div class="form-group"><label>Material Name <span class="req">*</span></label><input type="text" id="matName" class="form-input"></div><div class="form-group"><label>EAN <span class="req">*</span></label><input type="text" id="matEan" class="form-input"></div></div>';
    h+='<div class="form-row"><div class="form-group"><label>Description</label><input type="text" id="matDesc" class="form-input"></div><div class="form-group"><label>Division</label><input type="text" id="matDiv" class="form-input"></div><div class="form-group"><label>Brand</label><input type="text" id="matBrand" class="form-input"></div></div>';
    showModal('Add Material',h,'','<button class="btn btn-glass" onclick="closeModal()">Cancel</button><button class="btn btn-glass" onclick="saveMaterial()"><i class="bx bx-check"></i> Save</button>');
}
function saveMaterial(){
    var name=document.getElementById('matName').value.trim(),ean=document.getElementById('matEan').value.trim();
    if(!name||!ean){showToast('Fill required fields','error');return;}
    DB.add('material_master',{material:name,ean:ean,description:document.getElementById('matDesc').value.trim(),division:document.getElementById('matDiv').value.trim(),brand:document.getElementById('matBrand').value.trim()});
    logAction('Material','ADD',name);showToast('Material added!','success');closeModal();renderMaterialMaster();
}
async function editMaterial(id){
    var m=await sbGetById('material_master',id);   // ★ server se row
    if(!m){showToast('Record not found','error');return;}
    var h='<div class="form-row"><div class="form-group"><label>Material Name</label><input type="text" id="emName" class="form-input" value="'+esc(m.material)+'"></div><div class="form-group"><label>EAN</label><input type="text" id="emEan" class="form-input" value="'+esc(m.ean)+'"></div></div>';
    h+='<div class="form-row"><div class="form-group"><label>Description</label><input type="text" id="emDesc" class="form-input" value="'+esc(m.description||'')+'"></div><div class="form-group"><label>Division</label><input type="text" id="emDiv" class="form-input" value="'+esc(m.division||'')+'"></div><div class="form-group"><label>Brand</label><input type="text" id="emBrand" class="form-input" value="'+esc(m.brand||'')+'"></div></div>';
    showModal('Edit Material',h,'','<button class="btn btn-glass" onclick="closeModal()">Cancel</button><button class="btn btn-glass" onclick="updateMaterial(\''+id+'\')"><i class="bx bx-check"></i> Update</button>');
}
async function updateMaterial(id){
    var r=await sbUpdate('material_master',id,{material:document.getElementById('emName').value.trim(),ean:document.getElementById('emEan').value.trim(),description:document.getElementById('emDesc').value.trim(),division:document.getElementById('emDiv').value.trim(),brand:document.getElementById('emBrand').value.trim()});
    if(!r){showToast('Update failed — row not found','error');return;}
    logAction('Material','UPDATE','Material updated');showToast('Material updated!','success');closeModal();renderMaterialMaster();
}
function deleteMaterial(id){if(!confirm('Delete?'))return;DB.remove('material_master',id);showToast('Deleted','success');renderMaterialMaster();}

// ==================== PICKING ====================
// =====================================================================
//  OUTBOUND PICKING v2  (lock + nearby allocation + not-found requests
//  + admin location assign + reverse picking)       — by Claude
// =====================================================================
function renderPicking(sub){
    switch(sub){
        case 'obd-upload':renderOBDUpload();break;
        case 'picking-assign':renderPickingAssign();break;
        case 'start-picking':renderStartPicking();break;
        case 'picking-done':renderPickingDone();break;
        case 'picking-with-loading':renderPickingWithLoading();break;
        case 'loc-requests':renderLocRequests();break;
        case 'crossdock-report':renderCrossdockReport();break;
        default:renderOBDUpload();
    }
}

// ---------- small helpers ----------
function isAdminUser(){var u=APP.currentUser;return !!u&&(u.role==='Admin'||u.role==='Super Admin');}
function isMgrUser(){var u=APP.currentUser;return !!u&&(u.role==='Admin'||u.role==='Super Admin'||u.role==='Manager');}
function nowISO(){return new Date().toISOString();}
function sumBy(arr,fn){var s=0;arr.forEach(function(x){s+=(fn(x)||0);});return s;}
function isActiveLock(l){return l.status==='Locked'||l.status==='Hold';}
function groupMats(obd){
    var map={},order=[];
    (obd.materials||[]).forEach(function(m){
        var k=m.ean||('M:'+m.material);
        if(!map[k]){map[k]={material:m.material,ean:m.ean,qty:0};order.push(k);}
        map[k].qty+=m.qty;
    });
    return order.map(function(k){return map[k];});
}

// ---------- rack distance / walking route ----------
// "A-01-03" -> [1,1,3]   "RACK-012" -> [RACK,12]
function rackKey(r){
    var parts=String(r||'').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean),k=[];
    parts.forEach(function(p){
        (p.match(/[A-Z]+|\d+/g)||[]).forEach(function(t){
            if(/^\d+$/.test(t))k.push(parseInt(t,10));
            else{var n=0;for(var i=0;i<t.length;i++)n=n*26+(t.charCodeAt(i)-64);k.push(n);}
        });
    });
    return k;
}
function rackDist(a,b){
    var x=rackKey(a),y=rackKey(b);
    if(!x.length||!y.length)return 1e6;
    var W=[10000,1000,100,10,1],n=Math.max(x.length,y.length),d=0;
    for(var i=0;i<n;i++)d+=Math.abs((x[i]||0)-(y[i]||0))*(W[i]!==undefined?W[i]:1);
    return d;
}
function cmpRack(a,b){
    var x=rackKey(a),y=rackKey(b),n=Math.max(x.length,y.length);
    for(var i=0;i<n;i++){var d=(x[i]||0)-(y[i]||0);if(d)return d;}
    return String(a).localeCompare(String(b));
}
// nearest-neighbour walking order
function routeSort(items,getRack){
    if(items.length<2)return items.slice();
    var left=items.slice().sort(function(a,b){return cmpRack(getRack(a),getRack(b));});
    var res=[left.shift()];
    while(left.length){
        var last=getRack(res[res.length-1]),bi=0,bd=Infinity;
        for(var i=0;i<left.length;i++){var d=rackDist(last,getRack(left[i]));if(d<bd){bd=d;bi=i;}}
        res.push(left.splice(bi,1)[0]);
    }
    return res;
}

// ---------- stock availability (stock minus other OBD locks) ----------
function makeAvailCtx(){
    var lm={},lk={};
    DB.get('location_master').forEach(function(l){if(l.ean&&l.quantity>0)(lm[l.ean]=lm[l.ean]||[]).push(l);});
    DB.get('location_locks').forEach(function(k){if(k.ean&&isActiveLock(k))(lk[k.ean]=lk[k.ean]||[]).push(k);});
    return{lm:lm,lk:lk};
}
function getLocAvailability(ean,excludeObdId,ctx){
    if(!ean)return [];
    ctx=ctx||makeAvailCtx();
    var map={};
    (ctx.lm[ean]||[]).forEach(function(l){
        var R=String(l.rack||'').toUpperCase();
        if(!map[R])map[R]={rack:l.rack,locationId:l.id,stock:0,locked:0,lockedBy:[],oldest:Infinity};
        var o=map[R];o.stock+=l.quantity;
        var t=new Date(l.dateTime||l.date||0).getTime()||0;if(t<o.oldest)o.oldest=t;
    });
    (ctx.lk[ean]||[]).forEach(function(k){
        if(excludeObdId&&k.obdId===excludeObdId)return;
        var o=map[String(k.rack||'').toUpperCase()];if(!o)return;
        o.locked+=k.lockedQty;o.lockedBy.push({obdNo:k.obdNo,qty:k.lockedQty,picked:k.pickedQty||0,lockId:k.id});
    });
    var out=[];
    for(var r in map){map[r].available=Math.max(0,map[r].stock-map[r].locked);out.push(map[r]);}
    return out;
}

// ---------- nearby allocation algorithm ----------
// 1) one location that can fill everything (nearest to anchor, else best-fit, FIFO tie-break)
// 2) else start at nearest/largest location and keep adding nearest neighbours
function allocateMaterial(ean,need,excludeObdId,anchor,ctx){
    var avail=getLocAvailability(ean,excludeObdId,ctx).filter(function(a){return a.available>0;});
    var total=sumBy(avail,function(a){return a.available;});
    var take=Math.min(need,total),picks=[];
    if(take<=0)return{picks:[],locked:0,short:need,anchor:anchor};
    function dist(a){return anchor?rackDist(anchor,a.rack):0;}
    var fits=avail.filter(function(a){return a.available>=take;});
    if(fits.length){
        fits.sort(function(a,b){return (dist(a)-dist(b))||(a.available-b.available)||(a.oldest-b.oldest)||0;});
        picks.push({loc:fits[0],qty:take});
    }else{
        var pool=avail.slice(),rem=take,seed;
        if(anchor)pool.sort(function(a,b){return (dist(a)-dist(b))||(b.available-a.available);});
        else pool.sort(function(a,b){return (b.available-a.available)||(a.oldest-b.oldest)||0;});
        seed=pool.shift();
        var q=Math.min(seed.available,rem);picks.push({loc:seed,qty:q});rem-=q;
        var last=seed.rack;
        while(rem>0&&pool.length){
            var cand=pool.filter(function(a){return a.available>=rem;});
            var from=cand.length?cand:pool;
            from.sort(function(a,b){return (rackDist(last,a.rack)-rackDist(last,b.rack))||(b.available-a.available);});
            var nx=from[0];pool.splice(pool.indexOf(nx),1);
            var q2=Math.min(nx.available,rem);picks.push({loc:nx,qty:q2});rem-=q2;last=nx.rack;
        }
    }
    return{picks:picks,locked:take,short:need-take,anchor:picks[picks.length-1].loc.rack};
}
// same OBD + material + rack ke duplicate locks ko ek row me merge karta hai
function mergeDuplicateLocks(obdId){
    var seen={},merged=0;
    DB.filter('location_locks',function(l){return l.obdId===obdId&&l.status==='Locked';}).forEach(function(l){
        var k=l.ean+'|'+String(l.rack||'').toUpperCase(),f=seen[k];
        if(!f){seen[k]=l;return;}
        f.lockedQty+=l.lockedQty;f.pickedQty=(f.pickedQty||0)+(l.pickedQty||0);
        DB.update('location_locks',f.id,{lockedQty:f.lockedQty,pickedQty:f.pickedQty});
        DB.update('location_locks',l.id,{status:'Released',releaseReason:'Merged into '+f.id,releasedAt:nowISO()});
        merged++;
    });
    return merged;
}
function addLock(obd,mat,loc,qty,extra){
    var ex=DB.filter('location_locks',function(l){return l.obdId===obd.id&&l.ean===mat.ean&&l.status==='Locked'&&String(l.rack||'').toUpperCase()===String(loc.rack||'').toUpperCase();})[0];
    if(ex){return DB.update('location_locks',ex.id,{lockedQty:ex.lockedQty+qty});}
    var l={obdId:obd.id,obdNo:obd.obdNo,material:mat.material,ean:mat.ean,locationId:loc.locationId,rack:loc.rack,lockedQty:qty,pickedQty:0,status:'Locked',priority:obd.priority||'Normal'};
    if(extra)for(var k in extra)l[k]=extra[k];
    return DB.add('location_locks',l);
}

// ---------- LOCK LOCATIONS for an OBD (same return shape as before) ----------
async function lockLocationsForOBD(obdId,obdNo){
    var obd=DB.find('obd_data',obdId);
    var res={totalMaterials:0,fullyLocked:0,partialLocked:0,noStock:0,details:[]};
    if(!obd)return res;
    var mats=groupMats(obd),anchor=null;res.totalMaterials=mats.length;
    var _sctx=await ensureStockCtx();   // ★ stock map server se (60s cache)
    mats.forEach(function(m){
        if(m.qty<=0)return;
        var own=DB.filter('location_locks',function(l){return l.obdId===obdId&&l.ean===m.ean&&isActiveLock(l);});
        var have=sumBy(own,function(l){return l.lockedQty;}),locked=0,need=m.qty-have;
        if(need>0&&m.ean){
            var al=allocateMaterial(m.ean,need,null,anchor,_sctx);
            al.picks.forEach(function(pk){addLock(obd,m,pk.loc,pk.qty);});
            locked=al.locked;if(al.picks.length)anchor=al.anchor;
        }else if(own.length)anchor=own[own.length-1].rack;
        var total=have+locked;
        if(total===0)res.noStock++;else if(total<m.qty)res.partialLocked++;else res.fullyLocked++;
        res.details.push({material:m.material,ean:m.ean,needed:m.qty,locked:total,short:m.qty-total});
    });
    return res;
}
function releaseLocksForOBD(obdId){
    var locks=DB.filter('location_locks',function(l){return l.obdId===obdId&&isActiveLock(l);});
    locks.forEach(function(l){DB.update('location_locks',l.id,{status:'Released',releasedAt:nowISO()});});
    DB.filter('location_requests',function(r){return r.obdId===obdId&&r.status==='Pending';}).forEach(function(r){
        DB.update('location_requests',r.id,{status:'Cancelled',closedNote:'OBD unassigned / released',closedAt:nowISO()});
    });
    return locks.length;
}
// urgent OBD: take unpicked locks from non-urgent OBDs
function stealLocksForUrgent(obd){
    var affected={},total=0;
    groupMats(obd).forEach(function(m){
        if(!m.ean)return;
        var have=sumBy(DB.filter('location_locks',function(l){return l.obdId===obd.id&&l.ean===m.ean&&isActiveLock(l);}),function(l){return l.lockedQty;});
        var need=m.qty-have;if(need<=0)return;
        var donors=DB.filter('location_locks',function(l){return l.ean===m.ean&&l.status==='Locked'&&l.obdId!==obd.id&&(l.pickedQty||0)===0&&l.priority!=='Urgent';});
        donors.sort(function(a,b){return String(b.createdAt).localeCompare(String(a.createdAt));});
        donors.forEach(function(d){
            if(need<=0)return;
            var take=Math.min(d.lockedQty,need);
            if(take>=d.lockedQty)DB.update('location_locks',d.id,{status:'Released',releaseReason:'Reallocated to urgent '+obd.obdNo});
            else DB.update('location_locks',d.id,{lockedQty:d.lockedQty-take});
            addLock(obd,m,{locationId:d.locationId,rack:d.rack},take,{stolenFrom:d.obdNo});
            need-=take;total+=take;affected[d.obdNo]=(affected[d.obdNo]||0)+take;
        });
    });
    for(var no in affected)addNotif('Urgent '+obd.obdNo+' ne '+no+' se '+affected[no]+' qty lock le liya. '+no+' — lock re-check required.','warning');
    return total;
}

// ---------- stock info per OBD (used by OBD list / detail) ----------
function obdStockInfo(obd,ctx){
    ctx=ctx||makeAvailCtx();
    var rows=[],ok=true,any=false;
    groupMats(obd).forEach(function(m){
        var av=getLocAvailability(m.ean,obd.id,ctx);
        var stock=sumBy(av,function(a){return a.stock;}),free=sumBy(av,function(a){return a.available;});
        var st=free>=m.qty?'OK':(free>0?'Partial':'None');
        if(st!=='OK')ok=false;if(free>0)any=true;
        av.sort(function(a,b){return cmpRack(a.rack,b.rack);});
        rows.push({material:m.material,ean:m.ean,required:m.qty,stock:stock,free:free,lockedOthers:stock-free,status:st,locs:av});
    });
    return{rows:rows,allOk:ok,anyStock:any};
}
function stockBadge(info){
    if(info.allOk)return '<span class="badge badge-success">Stock OK</span>';
    return info.anyStock?'<span class="badge badge-warning">Partial Stock</span>':'<span class="badge badge-danger">No Stock</span>';
}

// ---------- Create Outbound Delivery (OBD upload + stock view) ----------
async function renderOBDUpload(){
    var obds=DB.get('obd_data').slice().reverse(),ctx=await ensureStockCtx();
    var h='<div class="section-header"><h2><i class="bx bx-upload"></i> Create Outbound Delivery</h2></div>';
    h+='<div class="card"><div class="card-title"><i class="bx bx-file"></i> Upload OBD (Bulk Excel)</div>';
    h+='<label class="btn btn-glass" style="cursor:pointer;margin-bottom:12px"><i class="bx bx-upload"></i> Choose OBD File<input type="file" id="obdFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="document.getElementById(\'obdFName\').innerText=this.files[0].name"></label>';
    h+='<div id="obdFName" style="font-size:11px;color:var(--text-muted);margin-bottom:8px">No file chosen</div>';
    h+='<button class="btn btn-glass" onclick="processOBDUpload()"><i class="bx bx-check-double"></i> Upload OBDs</button>';
    h+='<div style="background:var(--bg-secondary);padding:10px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted);border:1px dashed var(--warning);margin-top:10px"><strong style="color:var(--warning)">Excel Format:</strong><br>OBD No | Material | EAN | Qty | Customer</div>';
    h+='</div>';
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-list-ul"></i> Uploaded OBDs ('+obds.length+') <span style="font-size:10px;color:var(--text-muted);font-weight:normal">— click an OBD row to view material-wise stock</span></div><div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Customer</th><th>Materials</th><th>Total Qty</th><th>Warehouse Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    if(!obds.length)h+='<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No OBDs</td></tr>';
    else obds.forEach(function(o){
        var totalQty=sumBy(o.materials||[],function(m){return m.qty;});
        var sb=(o.status==='Pending')?stockBadge(obdStockInfo(o,ctx)):'<span style="color:var(--text-muted)">—</span>';
        h+='<tr style="cursor:pointer" onclick="showOBDStockDetail(\''+o.id+'\')"><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(o.obdNo)+(o.priority==='Urgent'?' <span class="badge badge-danger">URGENT</span>':'')+'</td><td>'+esc(o.customer||'-')+'</td><td><span class="badge badge-info">'+(o.materials||[]).length+'</span></td><td><strong>'+totalQty+'</strong></td><td>'+sb+'</td><td><span class="badge '+(o.status==='Picking Done'?'badge-success':(o.status==='Assigned'?'badge-warning':'badge-accent'))+'">'+esc(o.status||'Pending')+'</span></td><td><div class="table-actions"><button class="btn btn-danger btn-sm" title="Delete" onclick="event.stopPropagation();deleteOBD(\''+o.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';
    });
    h+='</tbody></table></div></div>';
    setHtml(h);
}
function processOBDUpload(){
    var fi=document.getElementById('obdFile');if(!fi||!fi.files[0]){showToast('Select file','error');return;}
    var reader=new FileReader();
    reader.onload=function(e){
        try{
            var wb=XLSX.read(e.target.result,{type:'array'});var ws=wb.Sheets[wb.SheetNames[0]];var data=XLSX.utils.sheet_to_json(ws,{header:1});
            if(!data.length){showToast('Empty file','error');return;}
            var startR=(String(data[0][0]||'').toLowerCase().indexOf('obd')>-1)?1:0;
            var obdMap={},count=0;
            for(var k=startR;k<data.length;k++){
                var r=data[k];if(!r||!r[0])continue;
                var obdNo=String(r[0]||'').trim().toUpperCase();
                var mat=String(r[1]||'').trim();
                var ean=String(r[2]||'').trim();
                var qty=parseInt(r[3])||0;
                var cust=String(r[4]||'').trim();
                if(!obdNo||!mat||!qty)continue;
                if(!obdMap[obdNo]){obdMap[obdNo]={materials:[],customer:cust};count++;}
                obdMap[obdNo].materials.push({material:mat,ean:ean,qty:qty,pickedQty:0});
            }
            for(var key in obdMap){
                DB.add('obd_data',{obdNo:key,customer:obdMap[key].customer,materials:obdMap[key].materials,status:'Pending',createdAt:new Date().toISOString()});
            }
            logAction('Picking','OBD_UPLOAD',count+' OBDs uploaded');
            showToast(count+' OBDs uploaded!','success');renderOBDUpload();
        }catch(err){showToast('Excel error: '+err.message,'error');}
    };
    reader.readAsArrayBuffer(fi.files[0]);
}

// ---------- Picking Assign (priority queue + auto lock) ----------
async function renderPickingAssign(){
    var plIds={};
    DB.filter('picking_assignments',function(a){return a.type==='pickandload'&&a.status==='Assigned';}).forEach(function(a){(a.obdIds||[]).forEach(function(id){plIds[id]=1;});});
    var obds=DB.get('obd_data').filter(function(o){return o.status==='Pending'&&!plIds[o.id];});
    var assigned=DB.filter('picking_assignments',function(a){return a.status==='Assigned'&&a.type!=='pickandload';});
    assigned.sort(function(a,b){return ((b.priority==='Urgent')-(a.priority==='Urgent'))||((a.seq||999)-(b.seq||999))||String(a.assignedAt).localeCompare(String(b.assignedAt));});
    var users=DB.get('users')||[];
    var h='<div class="section-header"><h2><i class="bx bx-user-plus"></i> Assign Warehouse Tasks</h2>';
    if(assigned.length)h+='<button class="btn btn-glass" onclick="topUpAll()"><i class="bx bx-refresh"></i> Re-check Locks (all)</button>';
    h+='</div>';
    h+='<div class="card"><div class="card-title"><i class="bx bx-list-ul"></i> Unassigned OBDs ('+obds.length+')</div>';
    if(!obds.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">All OBDs assigned</div>';
    else{
        h+='<div class="form-group" style="margin-bottom:12px"><label>Assign To User <span class="req">*</span></label>';
        h+='<select id="pickAssignUser" class="form-input" style="max-width:300px"><option value="">-- Select User --</option>';
        if(!users.length)h+='<option value="__manual__">-- Type Manually --</option>';
        else users.forEach(function(u){h+='<option value="'+esc(u.id)+'">'+esc(u.name||u.username)+(u.role?' ('+esc(u.role)+')':'')+'</option>';});
        h+='</select></div>';
        h+='<div id="manualUserWrap" style="display:none;margin-bottom:12px"><div class="form-group"><label>Enter User Name</label><input type="text" id="pickAssignUserManual" class="form-input" style="max-width:300px" placeholder="Type user name..."></div></div>';
        h+='<div class="pq-toolbar"><label><input type="checkbox" onchange="pqToggleAll(this.checked)"> Select all</label><span class="pq-hint">▲▼ to change sequence — the OBD on top gets the best / nearest locations first. ★ = Urgent (top priority).</span></div>';
        h+='<div id="pqList" class="pq-list">';
        var ctx=await ensureStockCtx();   // ★
        obds.forEach(function(o,i){
            var tq=sumBy(o.materials||[],function(m){return m.qty;});
            h+='<div class="pq-row" data-id="'+o.id+'" data-no="'+esc(o.obdNo)+'">';
            h+='<input type="checkbox" class="obd-chk" value="'+o.id+'" data-no="'+esc(o.obdNo)+'">';
            h+='<span class="pq-seq">'+(i+1)+'</span>';
            h+='<div class="pq-main"><strong>'+esc(o.obdNo)+'</strong><small>'+(o.materials||[]).length+' mats · '+tq+' qty'+(o.customer?' · '+esc(o.customer):'')+'</small></div>';
            h+=stockBadge(obdStockInfo(o,ctx))+inboundBadge(o);
            h+='<button type="button" class="pq-btn pq-star" title="Urgent" onclick="pqToggleUrgent(this)">★</button>';
            h+='<button type="button" class="pq-btn" onclick="pqMove(this,-1)">▲</button><button type="button" class="pq-btn" onclick="pqMove(this,1)">▼</button>';
            h+='<button type="button" class="pq-btn" title="Stock detail" onclick="showOBDStockDetail(\''+o.id+'\')"><i class="bx bx-show"></i></button>';
            h+='</div>';
        });
        h+='</div>';
        h+='<div class="form-actions"><button class="btn btn-glass" onclick="doPickingAssign()"><i class="bx bx-check-double"></i> Assign & Lock Locations (in this order)</button></div>';
    }
    h+='</div>';
    if(assigned.length){
        h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-user-check"></i> Assigned ('+assigned.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>OBD No</th><th>Assigned To</th><th>Lock Status</th><th>Picked</th><th>Actions</th></tr></thead><tbody>';
        assigned.forEach(function(a,i){
            var obd=DB.find('obd_data',a.obdId);
            var locks=DB.filter('location_locks',function(l){return l.obdId===a.obdId&&isActiveLock(l);});
            var tl=sumBy(locks,function(l){return l.lockedQty;}),tp=sumBy(locks,function(l){return l.pickedQty;});
            var tq=obd?sumBy(obd.materials||[],function(m){return m.qty;}):0;
            var hold=locks.filter(function(l){return l.status==='Hold';}).length;
            var lb=tl>=tq?'<span class="badge badge-success">Fully Locked</span>':(tl>0?'<span class="badge badge-warning">Partial ('+tl+'/'+tq+')</span>':'<span class="badge badge-danger">No Stock</span>');
            if(hold)lb+=' <span class="badge badge-info">'+hold+' on hold</span>';
            h+='<tr><td>'+(i+1)+'</td><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(a.obdNo||(obd?obd.obdNo:'-'))+(a.priority==='Urgent'?' <span class="badge badge-danger">URGENT</span>':'')+'</td><td>'+esc(a.assignedToName)+'</td><td>'+lb+'</td><td>'+tp+'</td><td style="display:flex;gap:4px;flex-wrap:wrap">';
            h+='<button class="btn btn-glass btn-sm" onclick="showOBDStockDetail(\''+a.obdId+'\')"><i class="bx bx-show"></i></button>';
            if(tl<tq)h+='<button class="btn btn-info btn-sm" onclick="topUpAssign(\''+a.id+'\')"><i class="bx bx-refresh"></i> Re-check</button>';
            if(a.priority!=='Urgent'&&tp===0)h+='<button class="btn btn-warning btn-sm" onclick="makeUrgentAssign(\''+a.id+'\')">★ Urgent</button>';
            h+='<button class="btn btn-danger btn-sm" onclick="unassignPicking(\''+a.id+'\')"><i class="bx bx-user-minus"></i></button></td></tr>';
        });
        h+='</tbody></table></div></div>';
    }
    setHtml(h);
    var sel=document.getElementById('pickAssignUser');
    if(sel){
        sel.onchange=function(){document.getElementById('manualUserWrap').style.display=(this.value==='__manual__'?'block':'none');};
        if(!users.length)document.getElementById('manualUserWrap').style.display='block';
    }
}
function pqRenum(){var i=0;document.querySelectorAll('#pqList .pq-row').forEach(function(r){r.querySelector('.pq-seq').textContent=++i;});}
function pqMove(btn,dir){
    var row=btn.closest('.pq-row'),p=row.parentNode;
    if(dir<0&&row.previousElementSibling)p.insertBefore(row,row.previousElementSibling);
    else if(dir>0&&row.nextElementSibling)p.insertBefore(row.nextElementSibling,row);
    pqRenum();
}
function pqToggleUrgent(btn){
    var row=btn.closest('.pq-row');row.classList.toggle('urgent');
    if(row.classList.contains('urgent'))row.parentNode.insertBefore(row,row.parentNode.firstChild);
    pqRenum();
}
function pqToggleAll(c){document.querySelectorAll('#pqList .obd-chk').forEach(function(x){x.checked=c;});}

async function doPickingAssign(){
    var sel=document.getElementById('pickAssignUser');
    var manualInp=document.getElementById('pickAssignUserManual');
    var userId='',userName='';
    if(sel.value==='__manual__'){userName=manualInp?manualInp.value.trim():'';userId=userName;}
    else if(sel.value){userId=sel.value;userName=sel.options[sel.selectedIndex].text;var rp=userName.lastIndexOf(' (');if(rp>-1)userName=userName.substring(0,rp);}
    if(!userId||!userName){showToast('Select a user','error');return;}
    var rows=[];
    document.querySelectorAll('#pqList .pq-row').forEach(function(r,i){
        var c=r.querySelector('.obd-chk');
        if(c&&c.checked)rows.push({id:c.value,no:r.getAttribute('data-no'),urgent:r.classList.contains('urgent'),i:i});
    });
    if(!rows.length){showToast('Select at least one OBD','error');return;}
    rows.sort(function(a,b){return ((b.urgent?1:0)-(a.urgent?1:0))||(a.i-b.i);});
    var results=[];
    for(var ri=0;ri<rows.length;ri++){
        var r=rows[ri],idx=ri;
        var pr=r.urgent?'Urgent':'Normal';
        DB.add('picking_assignments',{obdId:r.id,obdNo:r.no,assignedTo:userId,assignedToName:userName,status:'Assigned',assignedAt:nowISO(),priority:pr,seq:idx+1});
        DB.update('obd_data',r.id,{status:'Assigned',priority:pr});
        results.push({seq:idx+1,obdNo:r.no,priority:pr,result:await lockLocationsForOBD(r.id,r.no)});
    }
    logAction('Picking','ASSIGN',rows.length+' OBDs assigned to '+userName+' with location locks (sequence wise)');
    showToast(rows.length+' OBDs assigned!','success');
    var sh='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>OBD</th><th>Priority</th><th>Lock Result</th></tr></thead><tbody>';
    results.forEach(function(lr){
        var r=lr.result,txt;
        if(r.noStock===0&&r.partialLocked===0)txt='<span class="badge badge-success">Fully locked</span>';
        else{
            txt=r.details.filter(function(d){return d.short>0;}).map(function(d){return '<div style="font-size:11px">⚠ '+esc(d.material)+': need '+d.needed+', locked '+d.locked+', <b style="color:var(--danger)">short '+d.short+'</b></div>';}).join('');
        }
        sh+='<tr><td>'+lr.seq+'</td><td style="color:var(--accent);font-family:var(--font-display);font-size:11px">'+esc(lr.obdNo)+'</td><td>'+(lr.priority==='Urgent'?'<span class="badge badge-danger">URGENT</span>':'Normal')+'</td><td>'+txt+'</td></tr>';
    });
    sh+='</tbody></table></div>';
    showModal('<i class="bx bx-lock"></i> Location Lock Summary',sh,'lg','<button class="btn btn-glass" onclick="closeModal();renderPickingAssign()"><i class="bx bx-check"></i> OK</button>');
}
async function topUpAssign(assignId){
    var a=DB.find('picking_assignments',assignId);if(!a)return;
    var r=await lockLocationsForOBD(a.obdId,a.obdNo);
    var short=sumBy(r.details,function(d){return d.short;});
    showToast(short?'Still remaining: '+short+' qty short':'Fully locked!',short?'warning':'success');
    renderPickingAssign();
}
async function topUpAll(){
    var as=DB.filter('picking_assignments',function(a){return a.status==='Assigned'&&a.type!=='pickandload';});
    as.sort(function(a,b){return ((b.priority==='Urgent')-(a.priority==='Urgent'))||((a.seq||999)-(b.seq||999))||String(a.assignedAt).localeCompare(String(b.assignedAt));});
    var fixed=0;
    for(var ai=0;ai<as.length;ai++){
        var a=as[ai];
        var before=sumBy(DB.filter('location_locks',function(l){return l.obdId===a.obdId&&isActiveLock(l);}),function(l){return l.lockedQty;});
        await lockLocationsForOBD(a.obdId,a.obdNo);
        var after=sumBy(DB.filter('location_locks',function(l){return l.obdId===a.obdId&&isActiveLock(l);}),function(l){return l.lockedQty;});
        fixed+=after-before;
    }
    showToast(fixed+' qty newly locked','success');renderPickingAssign();
}
async function makeUrgentAssign(assignId){
    var a=DB.find('picking_assignments',assignId);if(!a)return;
    if(!confirm('Is OBD ko URGENT banayein? Zarurat padi to dusri (non-urgent, unpicked) OBD ke locks isko mil jayenge.'))return;
    DB.update('picking_assignments',assignId,{priority:'Urgent',seq:0});
    DB.update('obd_data',a.obdId,{priority:'Urgent'});
    DB.filter('location_locks',function(l){return l.obdId===a.obdId&&isActiveLock(l);}).forEach(function(l){DB.update('location_locks',l.id,{priority:'Urgent'});});
    var obd=DB.find('obd_data',a.obdId);
    await lockLocationsForOBD(a.obdId,a.obdNo);
    var stolen=stealLocksForUrgent(obd);
    logAction('Picking','URGENT',a.obdNo+' marked urgent, '+stolen+' qty re-allocated');
    showToast(a.obdNo+' urgent! '+stolen+' qty re-allocated','success');renderPickingAssign();
}
function unassignPicking(assignId){
    if(!confirm('Unassign?'))return;
    var a=DB.find('picking_assignments',assignId);if(!a)return;
    DB.update('picking_assignments',assignId,{status:'Unassigned'});
    DB.update('obd_data',a.obdId,{status:'Pending',priority:'Normal'});
    var released=releaseLocksForOBD(a.obdId);
    logAction('Picking','UNASSIGN','OBD '+a.obdNo+' unassigned, '+released+' locks released');
    showToast('Unassigned, '+released+' locks released','success');renderPickingAssign();
}

// ---------- Picker: My Picking ----------
function renderStartPicking(){
    if(!APP.currentUser)return;
    var my=DB.filter('picking_assignments',function(a){return a.assignedTo===APP.currentUser.id&&a.status==='Assigned'&&a.type!=='pickandload';});
    my.sort(function(a,b){return ((b.priority==='Urgent')-(a.priority==='Urgent'))||((a.seq||999)-(b.seq||999));});
    var h='<div class="section-header"><h2><i class="bx bx-box"></i> My Picking Tasks</h2></div>';
    if(!my.length){
        h+='<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No OBDs assigned to you</p></div></div>';
        setHtml(h);return;
    }
    h+='<div class="card"><div class="card-title"><i class="bx bx-list-ul"></i> Your OBDs ('+my.length+')</div>';
    my.forEach(function(a){
        var obd=DB.find('obd_data',a.obdId);if(!obd)return;
        var tq=sumBy(obd.materials||[],function(m){return m.qty;});
        var locks=DB.filter('location_locks',function(l){return l.obdId===a.obdId&&isActiveLock(l);});
        var tl=sumBy(locks,function(l){return l.lockedQty;}),tp=sumBy(locks,function(l){return l.pickedQty;});
        var hold=locks.filter(function(l){return l.status==='Hold';}).length;
        var pct=tq>0?Math.round(tp/tq*100):0,badge;
        if(tp>=tq)badge='<span class="badge badge-success">Ready to Submit</span>';
        else if(tp>0)badge='<span class="badge badge-warning">Picking '+pct+'%</span>';
        else if(tl>=tq)badge='<span class="badge badge-accent">Ready to Pick</span>';
        else if(tl>0)badge='<span class="badge badge-warning">Partial Lock</span>';
        else badge='<span class="badge badge-danger">No Stock</span>';
        h+='<div class="inv-list-item" onclick="openPickingOBD(\''+a.obdId+'\')"><div class="ili-left">';
        h+='<span class="ili-invno">'+esc(obd.obdNo)+(a.priority==='Urgent'?' <span class="badge badge-danger">URGENT</span>':'')+'</span>';
        h+='<span class="ili-info">'+(obd.materials||[]).length+' materials | '+tq+' total qty</span>';
        h+='<div class="pk-bar"><div style="width:'+pct+'%"></div></div>';
        h+='<span class="ili-info" style="font-size:10px"><i class="bx bx-lock"></i> Locked '+tl+' | Picked '+tp+'/'+tq+(hold?' | <span style="color:var(--warning)">'+hold+' waiting admin</span>':'')+'</span>';
        h+='</div>'+badge+'</div>';
    });
    h+='</div>';setHtml(h);
}

function openPickingOBD(obdId){
    var obd=DB.find('obd_data',obdId);if(!obd)return;
    mergeDuplicateLocks(obdId);
    var _tr=validateOBDLocks(obdId);if(_tr>0){showToast(_tr+' qty of stock was not available at the location — a new location was assigned','warning');}
    mergeDuplicateLocks(obdId);
    var mats=groupMats(obd);
    window._pickData={obdId:obdId,obdNo:obd.obdNo,materials:mats};
    var locks=DB.filter('location_locks',function(l){return l.obdId===obdId&&isActiveLock(l);});
    var need=sumBy(mats,function(m){return m.qty;}),picked=sumBy(locks,function(l){return l.pickedQty;});
    var pct=need?Math.round(picked/need*100):0;
    var h='<div class="pk-head"><div><strong style="color:var(--accent);font-family:var(--font-display)">'+esc(obd.obdNo)+'</strong>'+(obd.priority==='Urgent'?' <span class="badge badge-danger">URGENT</span>':'')+'<div style="font-size:11px;color:var(--text-muted)">'+esc(obd.customer||'')+'</div></div>';
    h+='<div class="pk-prog"><div class="pk-bar big"><div style="width:'+pct+'%"></div></div><span>'+picked+' / '+need+' picked ('+pct+'%)</span></div></div>';

    var _lk=locks.filter(function(l){return l.status==='Locked';});var openLocks=_lk.filter(function(l){return l.source==='GR';}).concat(routeSort(_lk.filter(function(l){return l.source!=='GR';}),function(l){return l.rack;}));
    h+='<div class="card-title" style="margin-top:12px"><i class="bx bx-walk"></i> Pick Route (walk in this order)</div>';
    if(!openLocks.length)h+='<div style="color:var(--text-muted);padding:10px;font-size:12px">There are no locked locations.</div>';
    openLocks.forEach(function(l,i){
        var rem=l.lockedQty-l.pickedQty,done=rem<=0;
        var m=mats.filter(function(x){return x.ean===l.ean;})[0]||{qty:0};
        var matRem=m.qty-sumBy(locks.filter(function(x){return x.ean===l.ean;}),function(x){return x.pickedQty;});
        var max=Math.min(rem,matRem);
        h+='<div class="pk-line'+(done?' done':'')+'"><div class="pk-seq">'+(i+1)+'</div>';
        h+='<div class="pk-rack"><i class="bx bx-map-pin"></i> '+esc(l.rack)+'</div>';
        h+='<div class="pk-mat"><b>'+esc(l.material)+'</b><small>'+esc(l.ean)+(l.viaRequest?' · admin assigned':'')+'</small></div>';
        if(done)h+='<div class="pk-act"><span class="badge badge-success"><i class="bx bx-check-circle"></i> Picked '+l.pickedQty+'</span>'+(l.source==='GR'?' <span class="badge badge-info">Unloading</span> <button class="btn btn-danger btn-sm" onclick="removeGRPick(\''+l.id+'\')"><i class="bx bx-undo"></i></button>':'')+'</div>';
        else if(max<=0)h+='<div class="pk-act"><span class="badge badge-info">Material complete</span></div>';
        else{
            h+='<div class="pk-qty">Pick <b>'+max+'</b>'+(l.pickedQty?'<small>('+l.pickedQty+' done)</small>':'')+'</div>';
            h+='<div class="pk-act"><input type="number" id="pq_'+l.id+'" value="'+max+'" min="1" max="'+max+'"><button class="btn btn-glass btn-sm" onclick="doPickFromLock(\''+l.id+'\')"><i class="bx bx-check"></i> Pick</button><button class="btn btn-warning btn-sm" title="Material not found" onclick="openNotFound(\''+l.id+'\')"><i class="bx bx-error"></i> Not Found</button></div>';
        }
        h+='</div>';
    });
    var holds=locks.filter(function(l){return l.status==='Hold';});
    if(holds.length){
        h+='<div class="card-title" style="margin-top:14px"><i class="bx bx-time"></i> Waiting for Admin</div>';
        holds.forEach(function(l){
            h+='<div class="pk-line hold"><div class="pk-rack"><i class="bx bx-lock"></i> '+esc(l.rack)+'</div><div class="pk-mat"><b>'+esc(l.material)+'</b><small>'+esc(l.holdReason||'')+'</small></div><div class="pk-qty">Qty <b>'+l.lockedQty+'</b></div><div class="pk-act"><span class="badge badge-warning">Request sent</span></div></div>';
        });
    }
    h+='<div class="card-title" style="margin-top:14px"><i class="bx bx-package"></i> Materials</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>Need</th><th>Locked</th><th>Picked</th><th>Status</th><th></th></tr></thead><tbody>';
    mats.forEach(function(m,idx){
        var ml=locks.filter(function(l){return l.ean===m.ean;});
        var tl=sumBy(ml,function(l){return l.lockedQty;}),tp=sumBy(ml,function(l){return l.pickedQty;});
        var pend=DB.filter('location_requests',function(r){return r.obdId===obdId&&r.ean===m.ean&&r.status==='Pending';}).length;
        var st=tp>=m.qty?'<span class="badge badge-success">Done</span>':(tp>0?'<span class="badge badge-warning">Partial</span>':(tl===0?'<span class="badge badge-danger">No stock locked</span>':'<span class="badge badge-accent">Ready</span>'));
        var act='';var _ib=inboundForEan(m.ean);
        if(tl<m.qty&&tp<m.qty)act=pend?'<span class="badge badge-info">Request pending</span>':'<button class="btn btn-warning btn-sm" onclick="requestLocationForMaterial('+idx+')"><i class="bx bx-send"></i> Request Location</button>';
        if(_ib.length&&tp<m.qty)act+=' <button class="btn btn-info btn-sm" onclick="openGRPick('+idx+')"><i class="bx bx-transfer"></i> Unloading Material ('+_ib.length+')</button>';
        h+='<tr><td>'+esc(m.material)+'<br><small style="color:var(--text-muted)">'+esc(m.ean)+'</small></td><td>'+m.qty+'</td><td>'+tl+'</td><td>'+tp+'</td><td>'+st+'</td><td>'+act+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('Picking — '+esc(obd.obdNo),h,'xl','<button class="btn btn-glass" onclick="closeModal();renderStartPicking()">Close</button><button class="btn btn-info" onclick="downloadPickList()"><i class="bx bx-file"></i> Pick List PDF</button><button class="btn btn-glass" onclick="submitPicking()"><i class="bx bx-check-double"></i> Submit Picking</button>');
}
function doPickFromLock(lockId){
    var pd=window._pickData;if(!pd)return;
    var lock=DB.find('location_locks',lockId);
    if(!lock||lock.status!=='Locked'){showToast('Lock not found','error');return;}
    var el=document.getElementById('pq_'+lockId),qty=parseInt(el?el.value:0)||0;
    if(qty<=0){showToast('Enter quantity','error');return;}
    var rem=lock.lockedQty-lock.pickedQty;
    if(qty>rem){showToast('Max '+rem+' allowed (locked qty)','error');return;}
    var mat=pd.materials.filter(function(m){return m.ean===lock.ean;})[0];
    var tp=sumBy(DB.filter('location_locks',function(l){return l.obdId===pd.obdId&&l.ean===lock.ean&&isActiveLock(l);}),function(l){return l.pickedQty;});
    if(mat&&tp+qty>mat.qty){showToast('Cannot exceed required qty '+mat.qty,'error');return;}
    DB.update('location_locks',lockId,{pickedQty:lock.pickedQty+qty,pickedBy:APP.currentUser.name,pickedAt:nowISO()});
    showToast('Picked '+qty+' from '+lock.rack,'success');
    openPickingOBD(pd.obdId);
}

// ---------- Not found at location -> request to admin (with auto report) ----------
function locReportHTML(rep){
    if(!rep)return '<div style="color:var(--text-muted)">No report</div>';
    var h='<div style="font-size:12px;margin-bottom:6px">System stock'+(rep.eanWide?' (all racks)':' at <b>'+esc(rep.rack)+'</b>')+': <b>'+rep.systemQty+'</b></div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr>'+(rep.eanWide?'<th>Rack</th>':'')+'<th>Entry Type</th><th>Entered By</th><th>Date / Time</th><th>Qty</th><th>GRN / Invoice</th></tr></thead><tbody>';
    if(!rep.records.length)h+='<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No stock record found</td></tr>';
    rep.records.forEach(function(r){
        h+='<tr>'+(rep.eanWide?'<td>'+esc(r.rack)+'</td>':'')+'<td><span class="badge '+(r.action==='PIV'?'badge-info':'badge-accent')+'">'+esc(r.action)+'</span></td><td>'+esc(r.user)+'</td><td style="font-size:11px">'+fmtDT(r.dateTime)+'</td><td><b>'+r.qty+'</b></td><td style="font-size:11px">'+esc(r.grnNo||r.invoiceNo||'-')+'</td></tr>';
    });
    h+='</tbody></table></div>';
    if(rep.recentPicks&&rep.recentPicks.length){
        h+='<div style="font-size:12px;margin:10px 0 4px"><b>Recent picks from this rack</b></div><div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD</th><th>Picked By</th><th>When</th><th>Qty</th><th>Status</th></tr></thead><tbody>';
        rep.recentPicks.forEach(function(p){h+='<tr><td>'+esc(p.obdNo)+'</td><td>'+esc(p.by)+'</td><td style="font-size:11px">'+fmtDT(p.at)+'</td><td>'+p.qty+'</td><td>'+esc(p.status||'')+'</td></tr>';});
        h+='</tbody></table></div>';
    }
    if(rep.otherLocks&&rep.otherLocks.length){
        h+='<div style="font-size:12px;margin-top:8px"><b>Locked by other OBDs:</b> '+rep.otherLocks.map(function(o){return esc(o.obdNo)+(o.rack?' @'+esc(o.rack):'')+' ('+o.qty+')';}).join(', ')+'</div>';
    }
    return h;
}
function nextReqNo(){return 'LR-'+new Date().getFullYear()+'-'+String(DB.count('location_requests')+1).padStart(4,'0');}
function notifyLocRequest(req){
    addNotif('Location Request '+req.reqNo+': '+req.material+' ('+req.obdNo+') '+(req.rack&&req.rack!=='—'?'rack '+req.rack+' was not found at this location. ':'Stock could not be locked. ')+'Missing '+req.missingQty+'. By '+req.requestedByName+'. Reason: '+req.reason,'warning',null,req.id,'locreq');
}
function openNotFound(lockId){
    var l=DB.find('location_locks',lockId);if(!l)return;
    var rem=l.lockedQty-l.pickedQty;
    var h='<div class="pk-info"><b>'+esc(l.material)+'</b> · EAN '+esc(l.ean)+'<br>Rack: <b>'+esc(l.rack)+'</b> · System required quantity: <b>'+rem+'</b></div>';
    h+='<div class="form-group"><label>Physically found quantity? (0 if nothing was found)</label><input type="number" id="nfFound" class="form-input" value="0" min="0" max="'+rem+'"></div>';
    h+='<div class="form-group"><label>Reason <span class="req">*</span></label><select id="nfReason" class="form-input"><option>Material not found at the location</option><option>Quantity less than in system</option><option>Material is damaged</option><option>Found stored at another location</option><option>Other</option></select></div>';
    h+='<div class="form-group"><label>Note</label><textarea id="nfNote" class="form-input" placeholder="Kuch aur detail..."></textarea></div>';
    h+='<div class="form-group"><label>What should be sent to the Admin?</label><label class="pk-radio"><input type="radio" name="nfAct" value="newloc" checked> Request new location + send report</label><label class="pk-radio"><input type="radio" name="nfAct" value="report"> Send report only (stock exists in system but was not found)</label></div>';
    showModal('Material Not Found',h,'sm','<button class="btn btn-glass" onclick="openPickingOBD(\''+l.obdId+'\')"><i class="bx bx-arrow-back"></i> Back</button><button class="btn btn-warning" onclick="submitNotFound(\''+lockId+'\')"><i class="bx bx-send"></i> Send to Admin</button>');
}
async function submitNotFound(lockId){
    var pd=window._pickData;if(!pd)return;
    var l=DB.find('location_locks',lockId);if(!l||l.status!=='Locked'){showToast('Lock not found','error');return;}
    var rem=l.lockedQty-l.pickedQty;
    var found=parseInt(document.getElementById('nfFound').value)||0;
    if(found<0||found>rem){showToast('Found qty 0 se '+rem+' ke beech ho','error');return;}
    var reason=document.getElementById('nfReason').value,note=document.getElementById('nfNote').value.trim();
    if(reason==='Other'&&!note){showToast('Please enter a note describing the issue','error');return;}
    var actEl=document.querySelector('input[name="nfAct"]:checked'),act=actEl?actEl.value:'newloc';
    var mat=pd.materials.filter(function(m){return m.ean===l.ean;})[0];
    var tp=sumBy(DB.filter('location_locks',function(x){return x.obdId===pd.obdId&&x.ean===l.ean&&isActiveLock(x);}),function(x){return x.pickedQty;});
    if(mat&&tp+found>mat.qty){showToast('Cannot exceed the required quantity','error');return;}
    var missing=rem-found;
    if(missing<=0){
        if(found>0)DB.update('location_locks',lockId,{pickedQty:l.pickedQty+found,pickedBy:APP.currentUser.name,pickedAt:nowISO()});
        openPickingOBD(pd.obdId);return;
    }
    var report=await buildLocReport(l.rack,l.ean,l.obdNo);
    var newPicked=l.pickedQty+found;
    if(newPicked>0)DB.update('location_locks',lockId,{lockedQty:newPicked,pickedQty:newPicked,pickedBy:APP.currentUser.name,pickedAt:nowISO()});
    else DB.update('location_locks',lockId,{status:'Released',releaseReason:'Not found at location',releasedAt:nowISO()});
    var hold=DB.add('location_locks',{obdId:l.obdId,obdNo:l.obdNo,material:l.material,ean:l.ean,locationId:l.locationId,rack:l.rack,lockedQty:missing,pickedQty:0,status:'Hold',holdReason:reason,priority:l.priority||'Normal'});
    var req=DB.add('location_requests',{reqNo:nextReqNo(),type:act==='newloc'?'NEW_LOCATION':'REPORT_ONLY',source:'NOT_FOUND',obdId:l.obdId,obdNo:l.obdNo,material:l.material,ean:l.ean,rack:l.rack,holdLockId:hold.id,missingQty:missing,foundQty:found,reason:reason,note:note,requestedBy:APP.currentUser.id,requestedByName:APP.currentUser.name,requestedAt:nowISO(),status:'Pending',report:report,assigned:[]});
    notifyLocRequest(req);
    logAction('Picking','LOC_REQUEST',req.reqNo+' '+l.material+' not found at '+l.rack+' (OBD '+l.obdNo+')');
    showToast('Request and report sent to Admin','success');
    openPickingOBD(pd.obdId);
}
function requestLocationForMaterial(matIdx){
    var pd=window._pickData;if(!pd)return;
    var m=pd.materials[matIdx];
    var h='<div class="pk-info"><b>'+esc(m.material)+'</b> · EAN '+esc(m.ean)+'<br>OBD qty: <b>'+m.qty+'</b></div><div class="form-group"><label>Reason / Note</label><textarea id="rlReason" class="form-input" placeholder="Why could the stock not be found?"></textarea></div>';
    showModal('Request Location',h,'sm','<button class="btn btn-glass" onclick="openPickingOBD(\''+pd.obdId+'\')"><i class="bx bx-arrow-back"></i> Back</button><button class="btn btn-warning" onclick="submitLocationRequest('+matIdx+')"><i class="bx bx-send"></i> Send to Admin</button>');
}
async function submitLocationRequest(matIdx){
    var pd=window._pickData;if(!pd)return;
    var m=pd.materials[matIdx];
    var locks=DB.filter('location_locks',function(l){return l.obdId===pd.obdId&&l.ean===m.ean&&isActiveLock(l);});
    var missing=m.qty-sumBy(locks,function(l){return l.lockedQty;});
    if(missing<=0){showToast('Fully locked','info');openPickingOBD(pd.obdId);return;}
    if(DB.filter('location_requests',function(r){return r.obdId===pd.obdId&&r.ean===m.ean&&r.status==='Pending'&&r.source==='NO_STOCK';}).length){showToast('A request has already been sent','warning');openPickingOBD(pd.obdId);return;}
    var note=document.getElementById('rlReason').value.trim();
    var _eanRep=await buildEanReport(m.ean,pd.obdNo);
    var req=DB.add('location_requests',{reqNo:nextReqNo(),type:'NEW_LOCATION',source:'NO_STOCK',obdId:pd.obdId,obdNo:pd.obdNo,material:m.material,ean:m.ean,rack:'—',holdLockId:'',missingQty:missing,foundQty:0,reason:'Stock could not be locked',note:note,requestedBy:APP.currentUser.id,requestedByName:APP.currentUser.name,requestedAt:nowISO(),status:'Pending',report:_eanRep,assigned:[]});
    notifyLocRequest(req);
    logAction('Picking','LOC_REQUEST',req.reqNo+' '+m.material+' no stock (OBD '+pd.obdNo+')');
    showToast('Request sent to Admin','success');openPickingOBD(pd.obdId);
}

// ---------- Admin: Location Requests ----------
function renderLocRequests(){
    if(!isMgrUser()){setHtml('<div class="card"><div class="empty-state"><i class="bx bx-lock"></i><p>Admin / Manager access only</p></div></div>');return;}
    var all=DB.get('location_requests').slice().reverse();
    var pend=all.filter(function(r){return r.status==='Pending';}),hist=all.filter(function(r){return r.status!=='Pending';}).slice(0,50);
    function tbl(list,isPend){
        var t='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Req</th><th>OBD</th><th>Material</th><th>Rack</th><th>Missing</th><th>By</th><th>Reason</th><th>'+(isPend?'Action':'Status')+'</th></tr></thead><tbody>';
        if(!list.length)t+='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:16px">Nothing</td></tr>';
        list.forEach(function(r){
            t+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(r.reqNo||'-')+'</td><td>'+esc(r.obdNo||'-')+'</td><td>'+esc(r.material||'-')+'</td><td>'+esc(r.rack||'-')+'</td><td><b>'+(r.missingQty||0)+'</b></td><td>'+esc(r.requestedByName||'-')+'<br><small style="color:var(--text-muted)">'+fmtDT(r.requestedAt)+'</small></td><td style="font-size:11px">'+esc(r.reason||'-')+(r.note?'<br><small>'+esc(r.note)+'</small>':'')+'</td><td>';
            t+=isPend?'<div class="table-actions"><button class="btn btn-glass btn-sm" onclick="openLocRequest(\''+r.id+'\')"><i class="bx bx-show"></i> Review / Assign</button><button class="btn btn-danger btn-sm" title="Delete" onclick="deleteLocRequest(\''+r.id+'\')"><i class="bx bx-trash"></i></button></div>':'<div class="table-actions"><span class="badge '+(r.status==='Resolved'?'badge-success':'badge-info')+'">'+esc(r.status)+'</span> <button class="btn btn-glass btn-sm" title="View" onclick="openLocRequest(\''+r.id+'\')"><i class="bx bx-show"></i></button><button class="btn btn-danger btn-sm" title="Delete" onclick="deleteLocRequest(\''+r.id+'\')"><i class="bx bx-trash"></i></button></div>';
            t+='</td></tr>';
        });
        return t+'</tbody></table></div>';
    }
    var h='<div class="section-header"><h2><i class="bx bx-map-pin"></i> Location Requests</h2></div>';
    h+='<div class="card"><div class="card-title"><i class="bx bx-error"></i> Pending ('+pend.length+')</div>'+tbl(pend,true)+'</div>';
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-history"></i> History</div>'+tbl(hist,false)+'</div>';
    setHtml(h);
}
function locNotifOpen(id){document.getElementById('notifPanel').classList.remove('open');if(!isMgrUser()){showToast('Admin / Manager access only','error');return;}openLocRequest(id);}
function pickerNotifOpen(obdId){document.getElementById('notifPanel').classList.remove('open');navTo('picking','start-picking');setTimeout(function(){openPickingOBD(obdId);},300);}
async function openLocRequest(reqId){
    var r=DB.find('location_requests',reqId);if(!r)return;
    var isP=r.status==='Pending'&&isMgrUser();
    var h='<div class="pk-info"><b>'+esc(r.reqNo)+'</b> · OBD <b>'+esc(r.obdNo)+'</b> · '+esc(r.material)+' ('+esc(r.ean)+')<br>Rack: <b>'+esc(r.rack)+'</b> · Missing qty: <b>'+(r.missingQty||0)+'</b>'+(r.foundQty?' · Found: '+r.foundQty:'')+'<br>By: '+esc(r.requestedByName)+' · '+fmtDT(r.requestedAt)+'<br>Reason: <span style="color:var(--warning)">'+esc(r.reason)+'</span>'+(r.note?' — '+esc(r.note):'')+'<br>Type: '+(r.type==='NEW_LOCATION'?'New location requested':'Report only')+' · Status: <b>'+esc(r.status)+'</b></div>';
    h+='<div class="card-title" style="margin-top:12px"><i class="bx bx-file"></i> Report — stock additions (who / when)</div>'+locReportHTML(r.report);
    if(r.assigned&&r.assigned.length)h+='<div style="margin-top:10px;font-size:12px"><b>Assigned:</b> '+r.assigned.map(function(a){return esc(a.rack)+' ('+a.qty+')';}).join(', ')+'</div>';
    if(isP){
        var obd=DB.find('obd_data',r.obdId);
        var _sctx=await ensureStockCtx();   // ★
        var av=getLocAvailability(r.ean,null,_sctx).filter(function(a){return String(a.rack).toUpperCase()!==String(r.rack).toUpperCase();});
        var free=av.filter(function(a){return a.available>0;});
        free.sort(function(a,b){return rackDist(r.rack,a.rack)-rackDist(r.rack,b.rack);});
        window._lrFree=free;
        h+='<div class="card-title" style="margin-top:14px"><i class="bx bx-map"></i> Assign New Location (nearest first)</div>';
        if(!free.length){
            h+='<div class="pk-info" style="border-color:var(--danger)">No free stock is available.';
            var lockedAll=av.filter(function(a){return a.locked>0;});
            if(lockedAll.length)h+='<br>Stock exists but is locked for another OBD: '+lockedAll.map(function(a){return esc(a.rack)+' → '+a.lockedBy.map(function(x){return esc(x.obdNo)+':'+x.qty;}).join(', ');}).join(' | ');
            h+='</div>';
        }else{
            h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Rack</th><th>Stock</th><th>Available</th><th>Distance</th><th>Assign Qty</th></tr></thead><tbody>';
            free.forEach(function(a,i){
                var d=rackDist(r.rack,a.rack);
                h+='<tr><td><b>'+esc(a.rack)+'</b></td><td>'+a.stock+(a.locked?' <small>(locked '+a.locked+')</small>':'')+'</td><td><b>'+a.available+'</b></td><td>'+(d<=10?'<span class="badge badge-success">Near</span>':(d<=1000?'<span class="badge badge-warning">Same aisle area</span>':'<span class="badge badge-danger">Far</span>'))+'</td><td><input type="number" class="form-input lrq-qty" id="lrq_'+i+'" min="0" max="'+a.available+'" value="0" style="width:90px"></td></tr>';
            });
            h+='</tbody></table></div><button class="btn btn-info btn-sm" style="margin-top:6px" onclick="lrAutoFill('+(r.missingQty||0)+')"><i class="bx bx-magic-wand"></i> Auto-fill (nearest)</button>';
        }
        if(r.rack&&r.rack!=='—')h+='<div class="form-group" style="margin-top:12px"><label class="pk-radio"><input type="checkbox" id="lrAdjust"> Purane location ('+esc(r.rack)+') — adjust its stock (reduce in system)</label></div>';
        h+='<div class="form-group"><label>Admin Note</label><textarea id="lrNote" class="form-input" placeholder="Message / decision for the picker..."></textarea></div>';
    }
    var f='<button class="btn btn-glass" onclick="closeModal()">Close</button><button class="btn btn-info" onclick="downloadLocReportPDF(\''+r.id+'\')"><i class="bx bx-file"></i> Report PDF</button>';
    if(isP)f+='<button class="btn btn-danger" onclick="markLocShort(\''+r.id+'\')"><i class="bx bx-x"></i> Mark Short</button><button class="btn btn-glass" onclick="assignLocRequest(\''+r.id+'\')"><i class="bx bx-check-double"></i> Assign / Resolve</button>';
    showModal('Location Request — '+esc(r.reqNo),h,'xl',f);
}
function lrAutoFill(missing){
    var free=window._lrFree||[],rem=missing;
    free.forEach(function(a,i){var q=Math.min(a.available,Math.max(rem,0));var el=document.getElementById('lrq_'+i);if(el)el.value=q;rem-=q;});
}
async function adjustLocStock(rack,ean,qty,reqNo){
    if(!rack||rack==='—'||qty<=0)return 0;
    var r=await deductStock(rack,ean,qty);
    logAction('Stock','ADJUST','Admin adjust -'+r.deducted+' at '+rack+' (EAN '+ean+') via '+reqNo);
    return r.deducted;
}
function finishLocRequest(r,status,note,assigned){
    DB.update('location_requests',r.id,{status:status,closedNote:note||'',resolvedBy:APP.currentUser.name,resolvedAt:nowISO(),assigned:assigned});
}
async function assignLocRequest(reqId){
    var r=DB.find('location_requests',reqId);if(!r||r.status!=='Pending')return;
    var obd=DB.find('obd_data',r.obdId);if(!obd){showToast('OBD not found','error');return;}
    var _sctx2=await ensureStockCtx();   // ★
    var fresh=getLocAvailability(r.ean,null,_sctx2),assignedNow=[],sum=0;
    var adj=document.getElementById('lrAdjust')&&document.getElementById('lrAdjust').checked,note=(document.getElementById('lrNote')||{}).value||'';
    var chosen=[];
    (window._lrFree||[]).forEach(function(a,i){
        var el=document.getElementById('lrq_'+i),q=parseInt(el?el.value:0)||0;if(q<=0)return;
        var f=fresh.filter(function(x){return String(x.rack).toUpperCase()===String(a.rack).toUpperCase();})[0];
        if(!f||q>f.available){chosen=null;showToast(a.rack+': only '+(f?f.available:0)+' available','error');return;}
        if(chosen)chosen.push({loc:f,qty:q});sum+=q;
    });
    if(!chosen)return;
    if(!chosen.length){showToast('Enter a quantity or use Mark Short','error');return;}
    if(sum>r.missingQty){showToast('Missing qty '+(r.missingQty||0)+' — cannot assign more than the missing quantity','error');return;}
    var mat={material:r.material,ean:r.ean};
    chosen.forEach(function(c){addLock(obd,mat,c.loc,c.qty,{viaRequest:r.reqNo});assignedNow.push({rack:c.loc.rack,qty:c.qty});});
    var left=(r.missingQty||0)-sum;
    var hold=r.holdLockId?DB.find('location_locks',r.holdLockId):null;
    if(hold&&hold.status==='Hold'){
        if(hold.lockedQty-sum<=0)DB.update('location_locks',hold.id,{status:'Released',releaseReason:'Resolved '+r.reqNo,releasedAt:nowISO()});
        else DB.update('location_locks',hold.id,{lockedQty:hold.lockedQty-sum});
    }
    if(adj)await adjustLocStock(r.rack,r.ean,sum,r.reqNo);
    var all=(r.assigned||[]).concat(assignedNow);
    if(left<=0)finishLocRequest(r,'Resolved',note,all);
    else DB.update('location_requests',r.id,{missingQty:left,assigned:all,adminNote:note});
    var txt=assignedNow.map(function(a){return a.rack+' ('+a.qty+')';}).join(', ');
    addNotif('New location assigned: '+r.material+' ('+r.obdNo+') → '+txt+(left>0?'. Remaining quantity: '+left+'.':''),'success',r.requestedBy,r.obdId,'locreq-picker');
    logAction('Picking','LOC_ASSIGN',r.reqNo+' → '+txt);
    showToast('Location assigned successfully','success');closeModal();
    if(APP.currentSub==='loc-requests')renderLocRequests();
}
function markLocShort(reqId){
    var r=DB.find('location_requests',reqId);if(!r||r.status!=='Pending')return;
    if(!confirm('Mark this material as SHORT? The picker will submit with a short quantity.'))return;
    var adj=document.getElementById('lrAdjust')&&document.getElementById('lrAdjust').checked,note=(document.getElementById('lrNote')||{}).value||'';
    var hold=r.holdLockId?DB.find('location_locks',r.holdLockId):null;
    if(hold&&hold.status==='Hold')DB.update('location_locks',hold.id,{status:'Released',releaseReason:'Marked short '+r.reqNo,releasedAt:nowISO()});
    if(adj)adjustLocStock(r.rack,r.ean,r.missingQty||0,r.reqNo);
    finishLocRequest(r,'Closed-Short',note||'No stock — short',r.assigned||[]);
    addNotif('Marked as SHORT: '+r.material+' ('+r.obdNo+'). Please submit picking with the short quantity.','warning',r.requestedBy,r.obdId,'locreq-picker');
    logAction('Picking','LOC_SHORT',r.reqNo+' marked short');
    showToast('Material marked as SHORT','success');closeModal();
    if(APP.currentSub==='loc-requests')renderLocRequests();
}
function downloadLocReportPDF(reqId){
    var r=DB.find('location_requests',reqId);if(!r||!r.report)return;
    var rep=r.report,pdf=new jspdf.jsPDF();
    pdf.setFontSize(13);pdf.text('Location Request Report — '+r.reqNo,14,14);
    pdf.setFontSize(9);pdf.text('OBD '+r.obdNo+' | '+r.material+' | EAN '+r.ean+' | Rack '+r.rack+' | Missing '+(r.missingQty||0),14,21);
    pdf.text('Reason: '+r.reason+(r.note?' - '+r.note:'')+' | By '+r.requestedByName+' | '+fmtDT(r.requestedAt),14,27);
    pdf.autoTable({startY:32,head:[[rep.eanWide?'Rack':'Type','Entry','By','Date','Qty','GRN/Invoice']],body:rep.records.map(function(x){return [rep.eanWide?x.rack:'',x.action,x.user,fmtDT(x.dateTime),x.qty,x.grnNo||x.invoiceNo||'-'];}),styles:{fontSize:8}});
    pdf.save('LocReport_'+r.reqNo+'.pdf');
}
function downloadPickList(){
    var pd=window._pickData;if(!pd)return;
    var locks=routeSort(DB.filter('location_locks',function(l){return l.obdId===pd.obdId&&l.status==='Locked';}),function(l){return l.rack;});
    var pdf=new jspdf.jsPDF();pdf.setFontSize(13);pdf.text('Pick List — '+pd.obdNo,14,14);pdf.setFontSize(8);pdf.text('Route order | '+fmtDT(new Date()),14,20);
    pdf.autoTable({startY:25,head:[['#','Rack','Material','EAN','Qty','Done']],body:locks.map(function(l,i){return [i+1,l.rack,l.material,l.ean,l.lockedQty,l.pickedQty];}),styles:{fontSize:8}});
    pdf.save('PickList_'+pd.obdNo+'.pdf');
}

// ---------- stock deduct / restore ----------
function restoreStock(rack,ean,qty,sources,meta){
    var left=qty;
    (sources||[]).forEach(function(s){
        if(left<=0)return;var q=Math.min(s.qty,left);
        DB.add('location_master',{date:s.date||today(),rack:rack,ean:ean,material:s.material||meta.material,description:s.description||meta.material,quantity:q,packing:s.packing||'',box:s.box||'',action:s.action||'REVERSE_PICK',user:s.user||'',userId:s.userId||'',dateTime:s.dateTime||nowISO(),grnNo:s.grnNo||'',invoiceNo:s.invoiceNo||'',restoredFrom:meta.obdNo,restoredAt:nowISO()});
        left-=q;
    });
    if(left>0)DB.add('location_master',{date:today(),rack:rack,ean:ean,material:meta.material,description:meta.material,quantity:left,packing:'',box:'',action:'REVERSE_PICK',user:APP.currentUser?APP.currentUser.name:'',dateTime:nowISO(),restoredFrom:meta.obdNo});
}

// ---------- Submit (confirm) picking ----------
async function submitPicking(){
    var pd=window._pickData;if(!pd)return;
    var obd=DB.find('obd_data',pd.obdId);if(!obd)return;
    var locks=DB.filter('location_locks',function(l){return l.obdId===pd.obdId&&isActiveLock(l);});
    var mats=groupMats(obd);
    var totalPicked=sumBy(locks,function(l){return l.pickedQty;});
    if(totalPicked<=0){showToast('Nothing has been picked yet','error');return;}
    var allPicked=mats.every(function(m){return sumBy(locks.filter(function(l){return l.ean===m.ean;}),function(l){return l.pickedQty;})>=m.qty;});
    var holds=locks.filter(function(l){return l.status==='Hold';}).length;
    if(!allPicked&&!confirm((holds?holds+' location request(s) are pending with the admin. ':'')+'Some materials were not fully picked. Submit with short quantity?'))return;
    var details=[];
    for(var mi=0;mi<mats.length;mi++){
        var m=mats[mi];
        var byRack={},locs=[];
        locks.filter(function(l){return l.ean===m.ean&&l.pickedQty>0;}).forEach(function(l){
            var R=String(l.rack).toUpperCase();
            if(!byRack[R]){byRack[R]={rack:l.rack,qty:0,ean:m.ean,material:m.material,source:l.source||'',invMatId:l.invMatId||''};locs.push(byRack[R]);}
            byRack[R].qty+=l.pickedQty;
        });
        for(var li=0;li<locs.length;li++){
            var lc=locs[li];
            if(lc.source==='GR'){var gim=DB.find('invoice_materials',lc.invMatId);if(gim)DB.update('invoice_materials',gim.id,{crossdockedQty:(gim.crossdockedQty||0)+lc.qty});lc.sources=[];continue;}
            var r=await deductStock(lc.rack,lc.ean,lc.qty);lc.sources=r.sources;if(r.deducted<lc.qty)lc.stockShort=lc.qty-r.deducted;
        }
        var picked=sumBy(locs,function(x){return x.qty;}),rs=[];
        DB.filter('location_requests',function(r){return r.obdId===pd.obdId&&r.ean===m.ean;}).forEach(function(r){var t=r.reason+(r.note?' — '+r.note:'');if(rs.indexOf(t)<0)rs.push(t);});
        details.push({material:m.material,ean:m.ean,requiredQty:m.qty,pickedQty:picked,locations:routeSort(locs,function(x){return x.rack;}),short:m.qty-picked,shortReason:rs.join(' | ')});
    }
    DB.add('picking_done',{obdId:pd.obdId,obdNo:pd.obdNo,pickedBy:APP.currentUser.id,pickedByName:APP.currentUser.name,pickedAt:nowISO(),details:details,status:'Done',priority:obd.priority||'Normal'});
    DB.update('obd_data',pd.obdId,{status:'Picking Done'});
    DB.filter('picking_assignments',function(a){return a.obdId===pd.obdId&&a.status==='Assigned';}).forEach(function(a){DB.update('picking_assignments',a.id,{status:'Done'});});
    locks.forEach(function(l){DB.update('location_locks',l.id,{status:'Released',releasedAt:nowISO()});});
    DB.filter('location_requests',function(r){return r.obdId===pd.obdId&&r.status==='Pending';}).forEach(function(r){DB.update('location_requests',r.id,{status:'Closed-Short',closedNote:'Picking submitted short',resolvedAt:nowISO()});});
    var shorts=details.filter(function(d){return d.short>0;});
    if(shorts.length)DB.add('short_reports',{shortNo:DB.shortNo(),vehicleNo:pd.obdNo,lrNo:'OBD',unloadNo:pd.obdNo,items:shorts.map(function(s){return{invoiceNo:pd.obdNo,material:s.material,ean:s.ean,expected:s.requiredQty,scanned:s.pickedQty,short:s.short};}),posted:false,createdAt:nowISO()});
    var rows=[];
    details.forEach(function(d){d.locations.forEach(function(loc){rows.push({obdNo:pd.obdNo,material:d.material,ean:d.ean,rack:loc.rack,qty:loc.qty,pickedBy:APP.currentUser.name,pickedAt:nowISO()});});});
    DB.add('picking_reports',{reportNo:'PR-'+Date.now().toString(36).toUpperCase(),obdNo:pd.obdNo,rows:rows,createdAt:nowISO()});
    logAction('Picking','DONE','OBD '+pd.obdNo+' picked by '+APP.currentUser.name);
    addNotif('OBD '+pd.obdNo+' picking completed by '+APP.currentUser.name+(shorts.length?' ('+shorts.length+' short)':''),shorts.length?'warning':'success');
    showToast('Picking completed for '+pd.obdNo,'success');
    closeModal();renderStartPicking();
}

// ---------- Confirmed tasks + reverse picking ----------
function renderPickingDone(){
    var done=DB.get('picking_done').slice().reverse();
    var h='<div class="section-header"><h2><i class="bx bx-check-circle"></i> Confirmed Picking Tasks ('+done.length+')</h2>';
    h+='<div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportPickingDoneExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportPickingDonePDF()"><i class="bx bx-file"></i> PDF</button></div></div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Materials</th><th>Picked By</th><th>Time</th><th>Short</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    if(!done.length)h+='<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">No picking done yet</td></tr>';
    else done.forEach(function(d){
        var sc=0;(d.details||[]).forEach(function(det){if(det.short>0)sc++;});
        h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(d.obdNo)+'</td><td><span class="badge badge-info">'+(d.details||[]).length+'</span></td><td>'+esc(d.pickedByName)+'</td><td style="font-size:11px;color:var(--text-muted)">'+fmtDT(d.pickedAt)+'</td><td>'+(sc?'<span class="badge badge-danger">'+sc+' short</span>':'<span class="badge badge-success">Complete</span>')+'</td><td>'+(d.status==='Reversed'?'<span class="badge badge-warning">Reversed</span>':'<span class="badge badge-success">Done</span>')+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" title="View" onclick="viewPickingDoneDetail(\''+d.id+'\')"><i class="bx bx-eye"></i></button>'+(d.status==='Done'?'<button class="btn btn-warning btn-sm" title="Reverse" onclick="openReverseModal(\''+d.id+'\')"><i class="bx bx-undo"></i></button>':'')+'<button class="btn btn-danger btn-sm" title="Delete" onclick="deletePickingDone(\''+d.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';
    });
    h+='</tbody></table></div>';
    setHtml(h);
}
function viewPickingDoneDetail(id){
    var d=DB.find('picking_done',id);if(!d)return;
    var h='<div style="margin-bottom:12px"><strong>OBD:</strong> <span style="color:var(--accent)">'+esc(d.obdNo)+'</span> | <strong>By:</strong> '+esc(d.pickedByName)+' | <strong>Time:</strong> '+fmtDT(d.pickedAt)+(d.status==='Reversed'?' | <span class="badge badge-warning">Reversed by '+esc(d.reversedByName||'')+' — '+esc(d.reverseReason||'')+'</span>':'')+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Required</th><th>Picked</th><th>Short</th><th>Locations</th></tr></thead><tbody>';
    (d.details||[]).forEach(function(det){
        var locStr=(det.locations||[]).map(function(l){return l.rack+':'+l.qty;}).join(', ');
        h+='<tr class="'+(det.short>0?'scan-row-red':'scan-row-green')+'"><td>'+esc(det.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(det.ean)+'</td><td>'+det.requiredQty+'</td><td><strong>'+det.pickedQty+'</strong></td><td class="'+(det.short>0?'qty-mismatch':'qty-match')+'">'+(det.short>0?'-'+det.short:'0')+'</td><td style="font-size:11px">'+esc(locStr)+(det.shortReason?'<br><span style="color:var(--warning)">'+esc(det.shortReason)+'</span>':'')+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('Picking Detail — '+esc(d.obdNo),h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
function reverseBlocker(d){
    var inLoaded=DB.filter('loaded_vehicles',function(l){return (l.obdIds||[]).indexOf(d.id)>-1;}).length;
    if(inLoaded)return 'Loading for this OBD is in progress or already completed — it cannot be reversed';
    var inAssign=DB.filter('loading_assignments',function(a){return a.status==='Assigned'&&(a.obdIds||[]).indexOf(d.id)>-1;}).length;
    if(inAssign)return 'Loading is assigned — please unassign it first in Assign Loading';
    var inAppr=DB.filter('loading_approvals',function(a){return a.status==='Pending'&&(a.obdIds||[]).indexOf(d.id)>-1;}).length;
    if(inAppr)return 'Loading approval is pending';
    return '';
}
function openReverseModal(id){
    var d=DB.find('picking_done',id);if(!d||d.status!=='Done')return;
    var blk=reverseBlocker(d);if(blk){showToast(blk,'error');return;}
    var h='<div class="pk-info">OBD <b>'+esc(d.obdNo)+'</b> · Picked by '+esc(d.pickedByName)+' · '+fmtDT(d.pickedAt)+'<br>On reversing, the following stock will be restored:</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>Rack</th><th>Qty</th></tr></thead><tbody>';
    (d.details||[]).forEach(function(det){(det.locations||[]).forEach(function(l){h+='<tr><td>'+esc(det.material)+'</td><td>'+esc(l.rack)+'</td><td><b>+'+l.qty+'</b></td></tr>';});});
    h+='</tbody></table></div>';
    h+='<div class="form-group" style="margin-top:10px"><label>Reverse Reason <span class="req">*</span></label><textarea id="rvReason" class="form-input"></textarea></div>';
    if(!isAdminUser())h+='<div class="pk-info" style="border-color:var(--warning)"><b>Admin authorization is required</b><div class="form-group" style="margin-top:6px"><label>Admin Username</label><input id="rvUser" class="form-input" autocomplete="off"></div><div class="form-group"><label>Admin Password</label><input id="rvPass" type="password" class="form-input" autocomplete="new-password"></div></div>';
    showModal('Reverse Picking — '+esc(d.obdNo),h,'lg','<button class="btn btn-glass" onclick="closeModal()">Cancel</button><button class="btn btn-warning" onclick="doReversePicking(\''+id+'\')"><i class="bx bx-undo"></i> Reverse & Restore Stock</button>');
}
function doReversePicking(id){
    var d=DB.find('picking_done',id);if(!d||d.status!=='Done')return;
    var blk=reverseBlocker(d);if(blk){showToast(blk,'error');return;}
    var reason=(document.getElementById('rvReason')||{}).value||'';
    if(!reason.trim()){showToast('Please enter a reason','error');return;}
    var authBy=null;
    if(isAdminUser())authBy=APP.currentUser;
    else{
        var un=((document.getElementById('rvUser')||{}).value||'').trim().toLowerCase(),pw=(document.getElementById('rvPass')||{}).value||'';
        authBy=DB.get('users').filter(function(u){return (u.role==='Admin'||u.role==='Super Admin')&&String(u.username||'').toLowerCase()===un&&u.password===pw;})[0];
        if(!authBy){showToast('Incorrect admin username or password','error');return;}
    }
    (d.details||[]).forEach(function(det){
        (det.locations||[]).forEach(function(l){if(l.source==='GR'){var gim=DB.find('invoice_materials',l.invMatId);if(gim)DB.update('invoice_materials',gim.id,{crossdockedQty:Math.max(0,(gim.crossdockedQty||0)-l.qty)});return;}restoreStock(l.rack,l.ean||det.ean,l.qty,l.sources,{material:det.material,obdNo:d.obdNo});});
    });
    DB.update('picking_done',id,{status:'Reversed',reversedBy:authBy.id,reversedByName:authBy.name,reversedAt:nowISO(),reverseReason:reason,reverseRequestedBy:APP.currentUser.name});
    DB.update('obd_data',d.obdId,{status:'Pending',priority:'Normal'});
    DB.filter('picking_reports',function(r){return r.obdNo===d.obdNo;}).forEach(function(r){DB.update('picking_reports',r.id,{reversed:true});});
    DB.filter('short_reports',function(s){return s.lrNo==='OBD'&&s.unloadNo===d.obdNo&&!s.posted;}).forEach(function(s){DB.remove('short_reports',s.id);});
    logAction('Picking','REVERSE','OBD '+d.obdNo+' reversed. Auth: '+authBy.name+'. Reason: '+reason);
    addNotif('Picking reversed: '+d.obdNo+' (auth '+authBy.name+'). Stock restored.','warning');
    showToast('Reversed — stock restored','success');
    closeModal();renderPickingDone();
}

// ---------- Loading Assign: OBD detail (OBD qty vs picked qty) ----------
function showLoadAssignDetail(pdId){
    var d=DB.find('picking_done',pdId);if(!d)return;
    var to=0,tp=0;
    var h='<div style="margin-bottom:10px"><b style="color:var(--accent)">'+esc(d.obdNo)+'</b> · Picked by '+esc(d.pickedByName)+' · '+fmtDT(d.pickedAt)+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>OBD Qty</th><th>Picked Qty</th><th>Diff</th><th>Short Reason</th></tr></thead><tbody>';
    (d.details||[]).forEach(function(x){
        to+=x.requiredQty;tp+=x.pickedQty;
        h+='<tr class="'+(x.short>0?'scan-row-red':'scan-row-green')+'"><td>'+esc(x.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(x.ean)+'</td><td>'+x.requiredQty+'</td><td><b>'+x.pickedQty+'</b></td><td class="'+(x.short>0?'qty-mismatch':'qty-match')+'">'+(x.short>0?'-'+x.short:'0')+'</td><td style="font-size:11px">'+esc(x.shortReason||'')+'</td></tr>';
    });
    h+='<tr><td colspan="2"><b>Total</b></td><td><b>'+to+'</b></td><td><b>'+tp+'</b></td><td colspan="2"></td></tr></tbody></table></div>';
    showModal('OBD Detail — '+esc(d.obdNo),h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

// =====================================================================
//  UPDATE 2 : Unloading report, Putaway fix, Warehouse stock merge,
//  Gate (city + gate pass), Loading Vehicle Register, Cross-Dock
// =====================================================================
function rkey(r){return String(r||'').trim().toUpperCase();}

// ---------- Putaway: received qty (incl. excess) minus cross-dock ----------
function reservedGR(invMatId){
    return sumBy(DB.filter('location_locks',function(l){return l.source==='GR'&&l.invMatId===invMatId&&isActiveLock(l);}),function(l){return l.lockedQty;});
}
function pwTotal(m){return Math.max(0,(m.unloadedQty||0)-(m.crossdockedQty||0)-reservedGR(m.id));}
function putawayMats(invoiceId){
    return DB.filter('invoice_materials',function(m){return m.invoiceId===invoiceId;}).map(function(m){
        var c=JSON.parse(JSON.stringify(m));c.invQty=m.qty;c.qty=pwTotal(m);return c;
    }).filter(function(m){return m.qty>0;});
}
// same date + same rack + same material => merged into one row
async function addPutawayStock(rec){
    var R=rkey(rec.rack),d=rec.date||today();
    var entry={action:'PUTAWAY',user:rec.user,userId:APP.currentUser?APP.currentUser.id:'',dateTime:rec.dateTime||nowISO(),qty:rec.quantity,grnNo:rec.grnNo||'',invoiceNo:rec.invoiceNo||'',packing:rec.packing||'',box:rec.box||''};
    // ★ Same rack+ean+date wali existing PUTAWAY row server se dhundo (merge ke liye)
    var res=await sbSearch('location_master',{eq:{ean:rec.ean,rack:R,action:'PUTAWAY',date:d},limit:1});
    var ex=res.rows.filter(function(l){return (parseInt(l.quantity)||0)>0;})[0];
    if(!ex){
        var added=DB.add('location_master',rec);
        _stockCtxTs=0; _sbFullPullTs['location_master']=0;
        scheduleAutoLock();
        return added;
    }
    var entries=(ex.entries&&ex.entries.length)?ex.entries.slice():[{action:ex.action,user:ex.user,userId:ex.userId||'',dateTime:ex.dateTime,qty:ex.quantity,grnNo:ex.grnNo||'',invoiceNo:ex.invoiceNo||'',packing:ex.packing||'',box:ex.box||''}];
    entries.push(entry);
    var box=ex.box||'';if(rec.box&&box.indexOf(rec.box)<0)box=box?box+', '+rec.box:rec.box;
    var pk=ex.packing||'';if(rec.packing&&pk.indexOf(rec.packing)<0)pk=pk?pk+', '+rec.packing:rec.packing;
    var upd=await sbUpdate('location_master',ex.id,{quantity:(parseInt(ex.quantity)||0)+rec.quantity,entries:entries,box:box,packing:pk});
    _stockCtxTs=0; _sbFullPullTs['location_master']=0;
    scheduleAutoLock();
    return upd;
}
function recRows(l){
    if(l.entries&&l.entries.length)return l.entries.map(function(e){return{rack:l.rack,action:e.action||'-',user:e.user||'-',dateTime:e.dateTime||l.date||'',qty:e.qty,grnNo:e.grnNo||'',invoiceNo:e.invoiceNo||''};});
    return [{rack:l.rack,action:l.action||'-',user:l.user||'-',dateTime:l.dateTime||l.date||'',qty:l.quantity,grnNo:l.grnNo||'',invoiceNo:l.invoiceNo||''}];
}
async function buildLocReport(rack,ean,obdNo){
    await sbPullFull('location_master',120000);
    var R=rkey(rack),recs=[];
    DB.filter('location_master',function(l){return l.ean===ean&&rkey(l.rack)===R&&l.quantity>0;}).forEach(function(l){recs=recs.concat(recRows(l));});
    var picks=[];
    DB.get('picking_done').forEach(function(p){(p.details||[]).forEach(function(d){(d.locations||[]).forEach(function(lc){
        if(rkey(lc.rack)===R&&lc.ean===ean)picks.push({obdNo:p.obdNo,by:p.pickedByName,at:p.pickedAt,qty:lc.qty,status:p.status});
    });});});
    var others=DB.filter('location_locks',function(k){return isActiveLock(k)&&k.ean===ean&&rkey(k.rack)===R&&k.obdNo!==obdNo;}).map(function(k){return{obdNo:k.obdNo,qty:k.lockedQty};});
    return{rack:rack,ean:ean,systemQty:sumBy(recs,function(r){return r.qty;}),records:recs,recentPicks:picks.slice(-10),otherLocks:others,generatedAt:nowISO()};
}
async function buildEanReport(ean,obdNo){
    await sbPullFull('location_master',120000);
    var recs=[];
    DB.filter('location_master',function(l){return l.ean===ean&&l.quantity>0;}).forEach(function(l){recs=recs.concat(recRows(l));});
    var others=DB.filter('location_locks',function(k){return isActiveLock(k)&&k.ean===ean&&k.obdNo!==obdNo;}).map(function(k){return{obdNo:k.obdNo,rack:k.rack,qty:k.lockedQty};});
    return{rack:'—',ean:ean,systemQty:sumBy(recs,function(r){return r.qty;}),records:recs,recentPicks:[],otherLocks:others,generatedAt:nowISO(),eanWide:true};
}
async function deductStock(rack,ean,qty){
    var R=rkey(rack),rem=qty,src=[];
    // ★ Server se us rack+ean ki rows fetch karo (memory full load ki zaroorat nahi)
    var res=await sbSearch('location_master',{eq:{ean:ean,rack:rack},limit:100});
    var rows=res.rows.filter(function(l){return (parseInt(l.quantity)||0)>0;})
      .sort(function(a,b){return String(a.dateTime||a.date).localeCompare(String(b.dateTime||b.date));});
    for(var i=0;i<rows.length;i++){
        var r=rows[i];
        if(rem<=0)break;
        var d=Math.min(r.quantity,rem),nq=r.quantity-d;
        if(r.entries&&r.entries.length){
            var need=d,ne=[];
            r.entries.forEach(function(e){
                if(need<=0){ne.push(e);return;}
                var t=Math.min(e.qty,need);
                src.push({action:e.action||'',user:e.user||'',userId:e.userId||'',dateTime:e.dateTime||'',date:r.date||'',grnNo:e.grnNo||'',invoiceNo:e.invoiceNo||'',packing:e.packing||'',box:e.box||'',description:r.description||'',material:r.material||'',qty:t});
                need-=t;
                if(e.qty-t>0){var c=JSON.parse(JSON.stringify(e));c.qty=e.qty-t;ne.push(c);}
            });
            if(nq<=0)await sbRemove('location_master',r.id);else await sbUpdate('location_master',r.id,{quantity:nq,entries:ne});
        }else{
            src.push({action:r.action||'',user:r.user||'',userId:r.userId||'',dateTime:r.dateTime||'',date:r.date||'',grnNo:r.grnNo||'',invoiceNo:r.invoiceNo||'',packing:r.packing||'',box:r.box||'',description:r.description||'',material:r.material||'',qty:d});
            if(nq<=0)await sbRemove('location_master',r.id);else await sbUpdate('location_master',r.id,{quantity:nq});
        }
        rem-=d;
    }
    _stockCtxTs=0; _sbFullPullTs['location_master']=0;   // caches invalidate — next pull fresh
    return{sources:src,deducted:qty-rem};
}
// Bin master: occupancy (rack normalised, qty>0, distinct materials)
function buildOccMap(){
    var occ={},seen={};
    DB.get('location_master').forEach(function(l){
        if(!(l.quantity>0))return;
        var k=rkey(l.rack);
        if(!occ[k]){occ[k]={mats:0,qty:0};seen[k]={};}
        occ[k].qty+=l.quantity;
        var id=l.ean||l.material;if(!seen[k][id]){seen[k][id]=1;occ[k].mats++;}
    });
    return occ;
}
async function showBinMaterials(binName){
    await sbPullFull('location_master',120000);   // bin ka stock server se (2 min cache)
    var locs=DB.filter('location_master',function(l){return rkey(l.rack)===rkey(binName)&&l.quantity>0;});
    var totalQty=sumBy(locs,function(l){return l.quantity;}),distinct={};
    locs.forEach(function(l){distinct[l.ean||l.material]=1;});
    var h='<div style="text-align:center;margin-bottom:14px"><div style="font-size:22px;font-weight:800;color:var(--accent);font-family:var(--font-display);letter-spacing:2px">'+esc(binName)+'</div><div style="font-size:11px;color:var(--text-muted)">'+Object.keys(distinct).length+' materials | '+totalQty+' total qty</div></div>';
    if(!locs.length){
        h+='<div style="text-align:center;color:var(--text-muted);padding:30px"><i class="bx bx-box" style="font-size:32px;display:block;margin-bottom:10px"></i>This bin is empty</div>';
    }else{
        h+='<div class="table-wrapper" style="max-height:400px;overflow-y:auto"><table class="data-table"><thead><tr><th>#</th><th>Date</th><th>Material</th><th>Description</th><th>EAN</th><th>Qty</th><th>Action</th><th>Packing</th><th>Box</th><th>User</th></tr></thead><tbody>';
        locs.forEach(function(l,i){
            var actCls=l.action==='PUTAWAY'?'badge-accent':(l.action==='PIV'?'badge-info':(l.action==='EAN-SCAN'?'badge-success':'badge-warning'));
            var users={};(l.entries||[]).forEach(function(e){users[e.user]=1;});
            var ustr=Object.keys(users).length?Object.keys(users).join(', '):(l.user||'-');
            h+='<tr><td>'+(i+1)+'</td><td style="font-size:11px">'+esc(l.date)+'</td><td><strong>'+esc(l.material)+'</strong></td><td style="font-size:10px;color:var(--text-secondary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(l.description||'-')+'</td><td style="font-family:var(--font-display);font-size:9px">'+esc(l.ean||'-')+'</td><td><strong style="color:var(--accent)">'+l.quantity+'</strong></td><td><span class="badge '+actCls+'">'+esc(l.action)+'</span></td><td>'+esc(l.packing||'-')+'</td><td>'+esc(l.box||'-')+'</td><td style="font-size:11px">'+esc(ustr)+'</td></tr>';
        });
        h+='</tbody></table></div>';
    }
    h+='<div class="form-actions" style="margin-top:14px"><button class="btn btn-glass" onclick="closeModal()">Close</button></div>';
    showModal('Bin Details — '+esc(binName),h,'xl','');
}

// ---------- Unloading Report ----------
function unloadReportData(unloadNo){
    var rec=DB.filter('unloading_records',function(r){return r.unloadNo===unloadNo;})[0];if(!rec)return null;
    var v=DB.find('vehicles',rec.vehicleId)||{};
    var rows=(rec.materials||[]).map(function(m){
        return{material:m.material,ean:m.ean,invQty:m.expectedQty,received:m.scannedQty,short:Math.max(0,m.expectedQty-m.scannedQty),excess:Math.max(0,m.scannedQty-m.expectedQty)};
    });
    (rec.wrongItems||[]).forEach(function(w){rows.push({material:w.material||w.ean,ean:w.ean,invQty:0,received:w.scannedQty,short:0,excess:w.scannedQty,notInInvoice:true});});
    var ser=DB.filter('short_excess_reports',function(s){return s.unloadNo===unloadNo;})[0];
    var mins=null;
    if(rec.startedAt&&rec.unloadedAt)mins=Math.max(1,Math.round((new Date(rec.unloadedAt)-new Date(rec.startedAt))/60000));
    return{rec:rec,v:v,rows:rows,ser:ser,mins:mins,
        tInv:sumBy(rows,function(r){return r.invQty;}),tRec:sumBy(rows,function(r){return r.received;}),
        tShort:sumBy(rows,function(r){return r.short;}),tEx:sumBy(rows,function(r){return r.excess;})};
}
function showUnloadReport(unloadNo){
    var d=unloadReportData(unloadNo);if(!d)return;
    var r=d.rec,v=d.v;
    var h='<div style="text-align:center;margin-bottom:12px"><div style="font-size:20px;font-weight:900;color:var(--accent);font-family:var(--font-display);letter-spacing:2px">'+esc(r.unloadNo)+'</div><div style="font-size:11px;color:var(--text-muted)">Unloading Report</div></div>';
    h+='<div class="pk-info">Vehicle: <b>'+esc(r.vehicleNo)+'</b> · LR: <b>'+esc(r.lrNo||'-')+'</b>'+(v.city?' · City: <b>'+esc(v.city)+'</b>':'')+' · Transporter: '+esc(v.transportName||'-')+'<br>Invoices: <b>'+esc((r.invoiceNos||[]).join(', ')||'-')+'</b><br>Unloaded by: <b>'+esc(r.unloadedByName||'-')+'</b>'+(r.startedAt?' · Start: '+fmtDT(r.startedAt):'')+' · End: '+fmtDT(r.unloadedAt)+(d.mins?' · Time: <b>'+d.mins+' min</b>':'')+(r.wasPartial?' · Partial sessions: '+r.partialSessions:'')+'</div>';
    h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><span class="badge badge-info">Invoice Qty '+d.tInv+'</span><span class="badge badge-accent">Received '+d.tRec+' (putaway ko jayega)</span><span class="badge '+(d.tShort?'badge-danger':'badge-success')+'">Short '+d.tShort+'</span><span class="badge '+(d.tEx?'badge-warning':'badge-success')+'">Excess '+d.tEx+'</span></div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Invoice Qty</th><th>Received</th><th>Short</th><th>Excess</th></tr></thead><tbody>';
    d.rows.forEach(function(x){
        h+='<tr class="'+((x.short||x.excess)?'scan-row-red':'scan-row-green')+'"><td>'+esc(x.material)+(x.notInInvoice?' <span class="badge badge-warning">Not in invoice</span>':'')+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(x.ean||'-')+'</td><td>'+x.invQty+'</td><td><b>'+x.received+'</b></td><td>'+(x.short?'<b style="color:var(--danger)">-'+x.short+'</b>':'0')+'</td><td>'+(x.excess?'<b style="color:var(--warning)">+'+x.excess+'</b>':'0')+'</td></tr>';
    });
    h+='</tbody></table></div>';
    var f='<button class="btn btn-glass" onclick="closeModal()">Close</button><button class="btn btn-info" onclick="downloadUnloadReportPDF(\''+esc(r.unloadNo)+'\')"><i class="bx bx-file"></i> PDF</button>';
    if(d.ser)f+='<button class="btn btn-warning" onclick="showSEReport(\''+d.ser.id+'\')"><i class="bx bx-error"></i> Short/Excess Report</button>';
    showModal('Unloading Report — '+esc(r.vehicleNo),h,'lg',f);
}
function downloadUnloadReportPDF(unloadNo){
    var d=unloadReportData(unloadNo);if(!d)return;
    var r=d.rec,pdf=new jspdf.jsPDF();
    pdf.setFontSize(14);pdf.text('Unloading Report — '+r.unloadNo,14,14);
    pdf.setFontSize(9);
    pdf.text('Vehicle '+r.vehicleNo+' | LR '+(r.lrNo||'-')+' | Invoices '+((r.invoiceNos||[]).join(', ')||'-'),14,21);
    pdf.text('By '+(r.unloadedByName||'-')+' | '+(r.startedAt?'Start '+fmtDT(r.startedAt)+' | ':'')+'End '+fmtDT(r.unloadedAt)+(d.mins?' | '+d.mins+' min':''),14,27);
    pdf.text('Invoice '+d.tInv+' | Received '+d.tRec+' | Short '+d.tShort+' | Excess '+d.tEx,14,33);
    pdf.autoTable({startY:38,head:[['Material','EAN','Invoice Qty','Received','Short','Excess']],body:d.rows.map(function(x){return [x.material+(x.notInInvoice?' (not in invoice)':''),x.ean||'-',x.invQty,x.received,x.short,x.excess];}),styles:{fontSize:8}});
    pdf.save('Unloading_Report_'+r.unloadNo+'.pdf');
}

// ---------- Inbound Control Tower: View invoices + per-vehicle Excel ----------
function viewVehicleInvoices(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var invs=DB.filter('invoices',function(i){return i.vehicleId===vehId;});
    var h='<div class="pk-info">Vehicle <b>'+esc(v.vehicleNo)+'</b> · LR '+esc(v.lrNo||'-')+' · '+esc(v.transportName||'-')+(v.city?' · '+esc(v.city):'')+' · Status: <b>'+esc(v.status)+'</b></div>';
    if(!invs.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">No invoices have been uploaded for this vehicle</div>';
    invs.forEach(function(inv){
        var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===inv.id;});
        h+='<div class="card" style="margin-bottom:10px"><div class="card-title"><i class="bx bx-file"></i> '+esc(inv.invoiceNo)+' <span style="font-size:11px;color:var(--text-muted);font-weight:normal">'+esc(inv.customer||'')+' · '+esc(inv.status||'')+'</span></div>';
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>Description</th><th>EAN</th><th>Invoice Qty</th><th>Received</th><th>Putaway</th></tr></thead><tbody>';
        mats.forEach(function(m){h+='<tr><td>'+esc(m.material)+(m.extra?' <span class="badge badge-warning">Extra</span>':'')+'</td><td style="font-size:11px">'+esc(m.description||'-')+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td><b>'+m.qty+'</b></td><td>'+(m.unloadedQty||0)+'</td><td>'+(m.putawayedQty||0)+'</td></tr>';});
        h+='</tbody></table></div></div>';
    });
    showModal('Invoices — '+esc(v.vehicleNo),h,'xl','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
function showVehicleExcelUpload(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var h='<div class="pk-info">Vehicle <b>'+esc(v.vehicleNo)+'</b> — Excel upload. Vehicle/LR will be applied automatically.<br><b>Format:</b> Invoice No | Material | Description | EAN | Qty | Customer</div>';
    h+='<input type="file" id="vehExcelFile" accept=".xlsx,.xls,.csv" class="form-input">';
    showModal('Excel Upload — '+esc(v.vehicleNo),h,'sm','<button class="btn btn-glass" onclick="closeModal()">Cancel</button><button class="btn btn-glass" onclick="processVehicleExcel(\''+vehId+'\')"><i class="bx bx-upload"></i> Upload</button>');
}
function processVehicleExcel(vehId){
    var fi=document.getElementById('vehExcelFile');if(!fi||!fi.files[0]){showToast('Please select a file','error');return;}
    var reader=new FileReader();
    reader.onload=function(e){
        try{
            var wb=XLSX.read(e.target.result,{type:'array'});var data=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});
            var start=(String(data[0]&&data[0][0]||'').toLowerCase().indexOf('inv')>-1)?1:0;
            var map={},order=[];
            for(var i=start;i<data.length;i++){
                var r=data[i];if(!r||!r[0])continue;
                var inv=String(r[0]).trim().toUpperCase(),mat=String(r[1]||'').trim(),desc=String(r[2]||'').trim(),ean=String(r[3]||'').trim().toUpperCase(),qty=parseInt(r[4])||0,cust=String(r[5]||'').trim();
                if(!inv||!mat||!ean||qty<=0)continue;
                if(!map[inv]){map[inv]={customer:cust,mats:[]};order.push(inv);}
                map[inv].mats.push({material:mat,description:desc,ean:ean,qty:qty});
            }
            var added=0,skipped=0,mc=0;
            order.forEach(function(no){
                if(DB.filter('invoices',function(x){return x.vehicleId===vehId&&x.invoiceNo===no;}).length){skipped++;return;}
                var inv=DB.add('invoices',{vehicleId:vehId,invoiceNo:no,customer:map[no].customer,status:'Pending'});
                map[no].mats.forEach(function(m){DB.add('invoice_materials',{invoiceId:inv.id,material:m.material,description:m.description,ean:m.ean,qty:m.qty,unloadedQty:0});mc++;});
                added++;
            });
            if(!added&&!skipped){showToast('No valid rows were found','error');return;}
            logAction('Inbound','INVOICE_UPLOAD',added+' invoices ('+mc+' materials) uploaded for vehicle');
            showToast(added+' invoice upload'+(skipped?', '+skipped+' already exist':''),'success');
            closeModal();renderInbound('pending-vehicle');
        }catch(err){showToast('Excel error: '+err.message,'error');}
    };
    reader.readAsArrayBuffer(fi.files[0]);
}

// ---------- Security Gate (City + Gate Pass) ----------
function genGatePassNo(){
    var d=new Date(),ds=d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
    var c=DB.filter('vehicles',function(v){return (v.gatePassNo||'').indexOf('GP-'+ds)===0;}).length;
    return 'GP-'+ds+'-'+String(c+1).padStart(3,'0');
}
function renderSecurityGate(){
    var cities={};DB.get('vehicles').forEach(function(v){if(v.city)cities[v.city]=1;});
    var h='<div class="section-header"><h2><i class="bx bx-shield-quarter"></i> Gate Check-In</h2></div>';
    h+='<div class="card"><div class="card-title"><i class="bx bxs-truck"></i> Vehicle Reporting</div>';
    h+='<div class="form-group" style="margin-bottom:16px"><label>Vehicle Type <span class="req">*</span></label>';
    h+='<div style="display:flex;gap:10px;margin-top:6px">';
    h+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 18px;border:2px solid var(--accent);border-radius:var(--radius-sm);background:var(--accent-dim);flex:1;justify-content:center;font-weight:600;color:var(--accent)"><input type="radio" name="vehType" value="Unloading" checked style="accent-color:var(--accent);width:16px;height:16px"> UNLOADING</label>';
    h+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 18px;border:2px solid var(--border);border-radius:var(--radius-sm);flex:1;justify-content:center;font-weight:600;color:var(--text-secondary)"><input type="radio" name="vehType" value="Loading" style="accent-color:var(--accent2);width:16px;height:16px"> LOADING</label>';
    h+='</div></div>';
    h+='<div class="form-row">';
    h+='<div class="form-group"><label>Vehicle Number <span class="req">*</span></label><input type="text" id="secVNo" class="form-input" placeholder="MH-12-AB-1234" style="text-transform:uppercase"></div>';
    h+='<div class="form-group" id="lrGrp"><label>LR Number <span class="req">*</span></label><input type="text" id="secLR" class="form-input" placeholder="LR-2025-001" style="text-transform:uppercase"></div>';
    h+='<div class="form-group" id="cityGrp" style="display:none"><label>City <span class="req">*</span></label><input type="text" id="secCity" class="form-input" list="secCityList" placeholder="Destination city"><datalist id="secCityList">'+Object.keys(cities).map(function(c){return '<option value="'+esc(c)+'">';}).join('')+'</datalist></div>';
    h+='<div class="form-group"><label>Driver Name <span class="req">*</span></label><input type="text" id="secDriver" class="form-input" placeholder="Driver full name"></div>';
    h+='<div class="form-group"><label>Driver Mobile <span class="req">*</span></label><input type="tel" id="secMobile" class="form-input" placeholder="10 digit" maxlength="10"></div>';
    h+='<div class="form-group"><label>Transporter Name <span class="req">*</span></label><input type="text" id="secTransport" class="form-input" placeholder="Transport company"></div>';
    h+='<div class="form-group"><label>Reporting Time</label><div class="form-input" style="background:var(--bg-secondary);color:var(--accent);font-weight:600">'+fmtDT(new Date())+' <small>(Auto)</small></div></div>';
    h+='<div class="form-group"><label>Entry By</label><div class="form-input" style="background:var(--bg-secondary);color:var(--accent2);font-weight:600"><i class="bx bx-user-check"></i> '+(APP.currentUser?esc(APP.currentUser.name)+' ('+esc(APP.currentUser.role)+')':'Unknown')+'</div></div>';
    h+='</div>';
    h+='<div class="form-actions">';
    if(chkAct('canSecurityEntry'))h+='<button class="btn btn-glass" onclick="submitSecGate()"><i class="bx bx-check-circle"></i> Submit Vehicle</button>';
    else h+='<button class="btn btn-glass" disabled><i class="bx bx-block"></i> Access Denied</button>';
    h+='</div></div>';
    setHtml(h);
}
document.addEventListener('change',function(e){
    if(e.target.name==='vehType'){var cg=document.getElementById('cityGrp');if(cg)cg.style.display=e.target.value==='Loading'?'':'none';}
});
function submitSecGate(){
    var vt=document.querySelector('input[name="vehType"]:checked');
    var vno=document.getElementById('secVNo').value.trim().toUpperCase();
    var lr=document.getElementById('secLR').value.trim().toUpperCase();
    var city=(document.getElementById('secCity')||{value:''}).value.trim();
    var dr=document.getElementById('secDriver').value.trim();
    var mb=document.getElementById('secMobile').value.trim();
    var tp=document.getElementById('secTransport').value.trim();
    var type=vt?vt.value:'Unloading';
    if(!vno||!dr||!mb||!tp){showToast('All fields are required','error');return;}
    if(!/^\d{10}$/.test(mb)){showToast('Invalid 10-digit mobile','error');return;}
    if(type==='Unloading'&&!lr){showToast('LR Number required for unloading','error');return;}
    if(type==='Loading'&&!city){showToast('City required for loading vehicle','error');return;}
    if(type==='Unloading'){
        if(DB.filter('vehicles',function(v){return v.lrNo&&v.lrNo.toUpperCase()===lr;}).length){showToast('LR Number already exists!','error');return;}
    }else{
        var act=DB.filter('vehicles',function(v){return v.vehicleType==='Loading'&&v.vehicleNo===vno&&v.status!=='Gate Out'&&loadingVehicleState(v).state!=='Loaded';});
        if(act.length){showToast('This vehicle is already IN at the gate ('+act[0].gatePassNo+')','error');return;}
    }
    var gp=genGatePassNo();
    DB.add('vehicles',{vehicleNo:vno,lrNo:lr||'',city:city,gatePassNo:gp,driverName:dr,driverMobile:mb,transportName:tp,vehicleType:type,status:type==='Unloading'?'Unload Pending':'Loading Pending',reportedAt:nowISO(),entryBy:APP.currentUser?APP.currentUser.id:'',entryByName:APP.currentUser?APP.currentUser.name:''});
    addNotif('New '+type+' Vehicle '+vno+(city?' ('+city+')':'')+' reported at gate by '+(APP.currentUser?APP.currentUser.name:'Unknown'),'warning');
    logAction('Security Gate','ENTRY',type+' Vehicle '+vno+' '+gp+(city?' City:'+city:'')+' LR:'+(lr||'N/A'));
    showToast('Vehicle submitted! Gate Pass '+gp,'success');
    ['secVNo','secLR','secCity','secDriver','secMobile','secTransport'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
}

// ---------- Loading Vehicle Register ----------
function loadingVehicleLoads(v){
    var vn=rkey(v.vehicleNo),t0=String(v.reportedAt||'');
    return{
        loads:DB.filter('loaded_vehicles',function(l){return rkey(l.vehicleNo)===vn&&String(l.loadedAt||l.lastScannedAt||'')>=t0;}),
        pending:DB.filter('loading_approvals',function(a){return rkey(a.vehicleNo)===vn&&String(a.createdAt||'')>=t0&&a.status==='Pending';})
    };
}
function loadingVehicleState(v){
    var x=loadingVehicleLoads(v),base=String(v.reopenedAt||v.reportedAt||'');
    var loads=x.loads.filter(function(l){return String(l.loadedAt||l.lastScannedAt||'')>=base;});
    var pend=x.pending.filter(function(a){return String(a.createdAt||'')>=base;});
    var full=loads.filter(function(l){return l.loadStatus==='Fully Loaded';}).length;
    var part=loads.filter(function(l){return l.loadStatus==='Partial';}).length;
    var s='Waiting';
    if(part||pend.length)s='Under Loading';
    else if(full)s='Loaded';
    return{state:s,loads:x.loads,pending:x.pending};
}
function loadingGateVehicles(){
    return DB.filter('vehicles',function(v){return v.vehicleType==='Loading'&&v.status!=='Gate Out';}).filter(function(v){var s=loadingVehicleState(v).state;return s==='Waiting'||s==='Under Loading';});
}
function isLoadingGateVehicle(vno){return loadingGateVehicles().some(function(v){return rkey(v.vehicleNo)===rkey(vno);});}
function loadingVehSelect(id,secId){
    var vs=loadingGateVehicles();
    if(!vs.length)return '<div class="pk-info" style="border-color:var(--danger)">No loading vehicle is currently IN at the gate. Please create a loading vehicle entry at the Security Gate first.</div><input type="hidden" id="'+id+'" value="">';
    var h='<select id="'+id+'" class="form-input" onchange="var o=this.options[this.selectedIndex],s=document.getElementById(\''+secId+'\');if(s&&o.getAttribute(\'data-gp\'))s.value=o.getAttribute(\'data-gp\');"><option value="">-- Select Vehicle (Gate IN) --</option>';
    vs.forEach(function(v){h+='<option value="'+esc(v.vehicleNo)+'" data-gp="'+esc(v.gatePassNo||v.lrNo||'')+'">'+esc(v.vehicleNo)+(v.city?' — '+esc(v.city):'')+' ['+loadingVehicleState(v).state+']</option>';});
    return h+'</select>';
}
function renderLoadingRegister(){
    var from=(window._lrgFrom!==undefined)?window._lrgFrom:today(),to=(window._lrgTo!==undefined)?window._lrgTo:today();
    var sf=window._lrgStatus||'',q=(window._lrgQ||'').toLowerCase();
    var all=DB.filter('vehicles',function(v){return v.vehicleType==='Loading';}).reverse(),rows=[];
    all.forEach(function(v){
        var st=loadingVehicleState(v),d=String(v.reportedAt||'').substring(0,10);
        var lastLoad=st.loads.length?st.loads[st.loads.length-1]:null;
        var ld=lastLoad?String(lastLoad.loadedAt||'').substring(0,10):'';
        var inRange=(!from||d>=from||ld>=from)&&(!to||d<=to||ld<=to);
        var open=(st.state!=='Loaded'&&v.status!=='Gate Out');
        if(!inRange&&!open)return;
        var s=v.status==='Gate Out'?'Gate Out':st.state;
        if(sf&&s!==sf)return;
        var obds=[],loadNos=[],by={},qty=0;
        st.loads.forEach(function(l){(l.obdNos||[]).forEach(function(n){if(obds.indexOf(n)<0)obds.push(n);});if(l.loadNo)loadNos.push(l.loadNo);if(l.loadedByName)by[l.loadedByName]=1;qty+=sumBy(l.scannedItems||[],function(i){return i.qty;});});
        var row={v:v,state:s,obds:obds,loadNos:loadNos,by:Object.keys(by).join(', '),qty:qty,loadedAt:lastLoad?lastLoad.loadedAt:''};
        var hay=(v.vehicleNo+' '+(v.city||'')+' '+(v.transportName||'')+' '+(v.gatePassNo||'')+' '+obds.join(' ')).toLowerCase();
        if(q&&hay.indexOf(q)<0)return;
        rows.push(row);
    });
    window._lrgRows=rows;
    var cnt={Waiting:0,'Under Loading':0,Loaded:0};rows.forEach(function(r){if(cnt[r.state]!==undefined)cnt[r.state]++;});
    var h='<div class="section-header"><h2><i class="bx bx-clipboard"></i> Loading Vehicle Register</h2><div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportLoadingRegister()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportLoadingRegisterPDF()"><i class="bx bx-file"></i> PDF</button></div></div>';
    h+='<div class="card"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">';
    h+='<div class="form-group" style="margin:0"><label>From</label><input type="date" id="lrgFrom" class="form-input" value="'+from+'"></div>';
    h+='<div class="form-group" style="margin:0"><label>To</label><input type="date" id="lrgTo" class="form-input" value="'+to+'"></div>';
    h+='<div class="form-group" style="margin:0"><label>Status</label><select id="lrgStatus" class="form-input"><option value="">All</option>'+['Waiting','Under Loading','Loaded','Gate Out'].map(function(s){return '<option'+(sf===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div>';
    h+='<div class="form-group" style="margin:0;flex:1;min-width:160px"><label>Search</label><input type="text" id="lrgQ" class="form-input" value="'+esc(window._lrgQ||'')+'" placeholder="Vehicle, city, OBD..."></div>';
    h+='<button class="btn btn-glass" onclick="applyLrgFilter()"><i class="bx bx-filter"></i> Apply</button></div></div>';
    h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><span class="badge badge-info">Waiting '+cnt.Waiting+'</span><span class="badge badge-warning">Under Loading '+cnt['Under Loading']+'</span><span class="badge badge-success">Loaded '+cnt.Loaded+'</span><span class="badge badge-accent">Total Qty Loaded '+sumBy(rows,function(r){return r.qty;})+'</span></div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Gate Pass</th><th>Vehicle</th><th>City</th><th>Transporter / Driver</th><th>Gate IN</th><th>Status</th><th>Load No</th><th>OBDs</th><th>Qty</th><th>Loaded By</th><th>Loaded At</th><th></th></tr></thead><tbody>';
    if(!rows.length)h+='<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:20px">No records</td></tr>';
    rows.forEach(function(r){
        var v=r.v,cls=r.state==='Loaded'?'badge-success':(r.state==='Under Loading'?'badge-warning':(r.state==='Gate Out'?'badge-danger':'badge-info'));
        h+='<tr><td style="font-family:var(--font-display);font-size:10px">'+esc(v.gatePassNo||'-')+'</td><td><b>'+esc(v.vehicleNo)+'</b></td><td>'+esc(v.city||'-')+'</td><td style="font-size:11px">'+esc(v.transportName||'-')+'<br><small style="color:var(--text-muted)">'+esc(v.driverName||'')+' '+esc(v.driverMobile||'')+'</small></td><td style="font-size:11px">'+fmtDT(v.reportedAt)+'</td><td><span class="badge '+cls+'">'+r.state+'</span></td><td style="font-size:10px">'+esc(r.loadNos.join(', ')||'-')+'</td><td style="font-size:11px">'+esc(r.obds.join(', ')||'-')+'</td><td>'+(r.qty||'-')+'</td><td style="font-size:11px">'+esc(r.by||'-')+'</td><td style="font-size:11px">'+(r.loadedAt?fmtDT(r.loadedAt):'-')+'</td><td style="display:flex;gap:4px">';
        if(r.state==='Waiting')h+='<button class="btn btn-danger btn-sm" onclick="gateOutVehicle(\''+v.id+'\')">Gate Out</button>';
        if(r.state==='Loaded')h+='<button class="btn btn-glass btn-sm" onclick="reopenGateVehicle(\''+v.id+'\')">Load more</button>';
        h+='</td></tr>';
    });
    h+='</tbody></table></div>';
    setHtml(h);
}
function applyLrgFilter(){
    window._lrgFrom=document.getElementById('lrgFrom').value;window._lrgTo=document.getElementById('lrgTo').value;
    window._lrgStatus=document.getElementById('lrgStatus').value;window._lrgQ=document.getElementById('lrgQ').value.trim();
    renderLoadingRegister();
}
function gateOutVehicle(id){if(!confirm('Gate Out this vehicle? It will no longer be selectable for loading.'))return;DB.update('vehicles',id,{status:'Gate Out',gateOutAt:nowISO()});logAction('Security Gate','GATE_OUT','Loading vehicle gate out');renderLoadingRegister();}
function reopenGateVehicle(id){DB.update('vehicles',id,{reopenedAt:nowISO()});showToast('Vehicle is available again for loading','success');renderLoadingRegister();}
function lrgTable(){return (window._lrgRows||[]).map(function(r){return [r.v.gatePassNo||'',r.v.vehicleNo,r.v.city||'',r.v.transportName||'',fmtDT(r.v.reportedAt),r.state,r.loadNos.join(', '),r.obds.join(', '),r.qty,r.by,r.loadedAt?fmtDT(r.loadedAt):''];});}
function exportLoadingRegister(){
    var rows=[['Gate Pass','Vehicle','City','Transporter','Gate IN','Status','Load No','OBDs','Qty','Loaded By','Loaded At']].concat(lrgTable());
    var ws=XLSX.utils.aoa_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Loading Register');XLSX.writeFile(wb,'Loading_Register_'+today()+'.xlsx');
}
function exportLoadingRegisterPDF(){
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(13);pdf.text('Loading Vehicle Register — VIP INDUSTRIES MD20',14,14);pdf.setFontSize(8);pdf.text('Generated: '+fmtDT(new Date()),14,20);
    pdf.autoTable({startY:25,head:[['Gate Pass','Vehicle','City','Transporter','Gate IN','Status','Load No','OBDs','Qty','By','Loaded At']],body:lrgTable(),styles:{fontSize:7}});
    pdf.save('Loading_Register_'+today()+'.pdf');
}

// ---------- Inbound info for a material (OBD assign / pick screen) ----------
function inboundForEan(ean){
    var out=[];if(!ean)return out;
    var E=String(ean).toUpperCase();
    DB.get('invoice_materials').forEach(function(m){
        if(String(m.ean||'').toUpperCase()!==E)return;
        var inv=DB.find('invoices',m.invoiceId);if(!inv)return;
        var v=DB.find('vehicles',inv.vehicleId);if(!v||v.vehicleType!=='Unloading'||v.status==='Rejected')return;
        var recv=m.unloadedQty||0,put=m.putawayedQty||0,cd=m.crossdockedQty||0,res=reservedGR(m.id);
        var gr=Math.max(0,recv-put-cd-res);
        var part=DB.filter('partial_unloads',function(p){return p.vehicleId===v.id;})[0];
        var partScanned=part?sumBy((part.scanHistory||[]).filter(function(s){return s.matched&&String(s.ean||'').toUpperCase()===E;}),function(s){return s.qty;}):0;
        var st,pendingVeh=(v.status==='Unload Pending'||v.status==='Assigned'||v.status==='Partial Unload');
        if(v.status==='Partial Unload'||part)st='Unloading in progress'+(v.assignedToName?' — '+v.assignedToName:'')+' (scanned '+partScanned+')';
        else if(v.status==='Unload Pending'||v.status==='Assigned')st=v.assignedToName?('Assigned to '+v.assignedToName+' — unloading not started'):'Gate me aayi — unassigned';
        else if(v.status==='Posting Pending Approval')st='Unloaded — posting pending (GR area)';
        else if(v.status==='Posted')st='Posted — GR area';
        else st=v.status;
        if(!pendingVeh&&gr<=0)return;
        out.push({vehId:v.id,vehicleNo:v.vehicleNo,invoiceNo:inv.invoiceNo,invMatId:m.id,status:st,invQty:m.qty,received:recv,partScanned:partScanned,grAvail:gr,pickable:gr>0});
    });
    return out;
}
function inboundHTML(rows){
    if(!rows.length)return '';
    return rows.map(function(r){
        return '<div class="ib-line"><i class="bx bx-down-arrow-circle"></i> <b>'+esc(r.vehicleNo)+'</b> · '+esc(r.invoiceNo)+' · '+esc(r.status)+' · invoice qty <b>'+r.invQty+'</b>'+(r.received?' · received <b>'+r.received+'</b>':'')+(r.grAvail?' · <span style="color:var(--success)">in GR area: <b>'+r.grAvail+'</b></span>':'')+'</div>';
    }).join('');
}
function showOBDStockDetail(obdId){
    var obd=DB.find('obd_data',obdId);if(!obd)return;
    var info=obdStockInfo(obd);
    var h='<div style="margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center"><strong style="color:var(--accent);font-family:var(--font-display)">'+esc(obd.obdNo)+'</strong><span>'+esc(obd.customer||'')+'</span>'+stockBadge(info)+'<span class="badge badge-accent">'+esc(obd.status||'Pending')+'</span></div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>OBD Qty</th><th>Total Stock</th><th>Locked (other OBD)</th><th>Free</th><th>Status</th></tr></thead><tbody>';
    info.rows.forEach(function(r){
        h+='<tr class="'+(r.status==='OK'?'scan-row-green':'scan-row-red')+'"><td>'+esc(r.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(r.ean)+'</td><td><strong>'+r.required+'</strong></td><td>'+r.stock+'</td><td>'+r.lockedOthers+'</td><td><strong>'+r.free+'</strong></td><td>'+(r.status==='OK'?'<span class="badge badge-success">OK</span>':(r.status==='Partial'?'<span class="badge badge-warning">Short '+(r.required-r.free)+'</span>':'<span class="badge badge-danger">No Stock</span>'))+'</td></tr>';
        if(r.locs.length){
            h+='<tr><td colspan="7" style="font-size:11px;color:var(--text-muted);padding:4px 12px 6px">';
            r.locs.forEach(function(a){
                var lb=a.lockedBy.map(function(x){return x.obdNo+':'+x.qty;}).join(', ');
                h+='<span class="lr-chip'+(a.available>0?'':' off')+'"><i class="bx bx-map-pin"></i> '+esc(a.rack)+' · stock '+a.stock+(a.locked?' · locked '+a.locked+' ('+esc(lb)+')':'')+' · <b>free '+a.available+'</b></span> ';
            });
            h+='</td></tr>';
        }
        var ib=inboundForEan(r.ean);
        if(ib.length)h+='<tr><td colspan="7" style="padding:2px 12px 10px"><div style="font-size:10px;color:var(--info);letter-spacing:1px;margin-bottom:2px">INBOUND / UNLOADING</div>'+inboundHTML(ib)+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('OBD Stock — '+esc(obd.obdNo),h,'xl','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

// ---------- Self-healing locks (re-allocate when stock is not found at the location) ----------
function validateOBDLocks(obdId){
    var obd=DB.find('obd_data',obdId);if(!obd)return 0;
    var trimmed=0,groups={};
    DB.filter('location_locks',function(l){return l.obdId===obdId&&l.status==='Locked'&&l.source!=='GR';}).forEach(function(l){var k=l.ean+'|'+rkey(l.rack);(groups[k]=groups[k]||[]).push(l);});
    for(var k in groups){
        var g=groups[k],ean=g[0].ean,R=rkey(g[0].rack);
        var stock=sumBy(DB.filter('location_master',function(l){return l.ean===ean&&rkey(l.rack)===R&&l.quantity>0;}),function(l){return l.quantity;});
        var others=sumBy(DB.filter('location_locks',function(l){return isActiveLock(l)&&l.obdId!==obdId&&l.ean===ean&&rkey(l.rack)===R&&l.source!=='GR';}),function(l){return l.lockedQty;});
        var mine=sumBy(g,function(l){return l.lockedQty;}),picked=sumBy(g,function(l){return l.pickedQty;});
        var cap=Math.max(Math.max(0,stock-others),picked);
        if(mine>cap){
            var cut=mine-cap;
            g.slice().reverse().forEach(function(l){
                if(cut<=0)return;
                var c=Math.min(l.lockedQty-(l.pickedQty||0),cut);if(c<=0)return;
                if(l.lockedQty-c<=0)DB.update('location_locks',l.id,{status:'Released',releaseReason:'Stock not at location',releasedAt:nowISO()});
                else DB.update('location_locks',l.id,{lockedQty:l.lockedQty-c});
                cut-=c;trimmed+=c;
            });
        }
    }
    if(trimmed>0)lockLocationsForOBD(obdId,obd.obdNo);
    return trimmed;
}
// remove extra unpicked rack locks once material was picked from GR
function trimExcessLocks(obdId,ean,matQty){
    var locks=DB.filter('location_locks',function(l){return l.obdId===obdId&&l.ean===ean&&l.status==='Locked';});
    var excess=sumBy(locks,function(l){return l.lockedQty;})-matQty;if(excess<=0)return;
    locks.filter(function(l){return l.source!=='GR';}).reverse().forEach(function(l){
        if(excess<=0)return;
        var c=Math.min(l.lockedQty-(l.pickedQty||0),excess);if(c<=0)return;
        if(l.lockedQty-c<=0)DB.update('location_locks',l.id,{status:'Released',releaseReason:'Covered by unloading material',releasedAt:nowISO()});
        else DB.update('location_locks',l.id,{lockedQty:l.lockedQty-c});
        excess-=c;
    });
}

// ---------- Cross-dock: pick directly from unloading (GR area) ----------
function openGRPick(matIdx){
    var pd=window._pickData;if(!pd)return;
    var m=pd.materials[matIdx];
    var locks=DB.filter('location_locks',function(l){return l.obdId===pd.obdId&&l.ean===m.ean&&isActiveLock(l);});
    var remain=m.qty-sumBy(locks,function(l){return l.pickedQty;});
    var rows=inboundForEan(m.ean);window._grRows=rows;
    var h='<div class="pk-info"><b>'+esc(m.material)+'</b> · EAN '+esc(m.ean)+'<br>OBD qty <b>'+m.qty+'</b> · Picked <b>'+(m.qty-remain)+'</b> · Remaining <b>'+remain+'</b><br><small style="color:var(--text-muted)">Unloaded material is picked directly for the OBD (without putaway). It is visible in the Cross-Dock Report.</small></div>';
    if(!rows.length)h+='<div style="color:var(--text-muted);padding:12px">There is no inbound vehicle for this material.</div>';
    else{
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>Invoice</th><th>Status</th><th>Invoice Qty</th><th>Received</th><th>GR Area</th><th>Pick Qty</th></tr></thead><tbody>';
        rows.forEach(function(r,i){
            h+='<tr><td><b>'+esc(r.vehicleNo)+'</b></td><td>'+esc(r.invoiceNo)+'</td><td style="font-size:11px">'+esc(r.status)+'</td><td>'+r.invQty+'</td><td>'+r.received+'</td><td><b>'+r.grAvail+'</b></td><td>';
            if(r.grAvail>0&&remain>0)h+='<input type="number" id="gr_'+i+'" class="form-input" style="width:80px;display:inline-block" min="1" max="'+Math.min(r.grAvail,remain)+'" value="'+Math.min(r.grAvail,remain)+'"> <button class="btn btn-glass btn-sm" onclick="pickFromGR('+matIdx+','+i+')"><i class="bx bx-check"></i> Pick</button>';
            else h+='<span style="color:var(--text-muted);font-size:11px">'+(r.grAvail>0?'—':'Not yet in the GR area')+'</span>';
            h+='</td></tr>';
        });
        h+='</tbody></table></div>';
    }
    showModal('Use Unloading Material',h,'lg','<button class="btn btn-glass" onclick="openPickingOBD(\''+pd.obdId+'\')"><i class="bx bx-arrow-back"></i> Back</button>');
}
function pickFromGR(matIdx,i){
    var pd=window._pickData;if(!pd)return;
    var m=pd.materials[matIdx],r=(window._grRows||[])[i];if(!r)return;
    var im=DB.find('invoice_materials',r.invMatId);if(!im){showToast('Record not found','error');return;}
    var avail=Math.max(0,(im.unloadedQty||0)-(im.putawayedQty||0)-(im.crossdockedQty||0)-reservedGR(im.id));
    var qty=parseInt((document.getElementById('gr_'+i)||{}).value)||0;
    var locks=DB.filter('location_locks',function(l){return l.obdId===pd.obdId&&l.ean===m.ean&&isActiveLock(l);});
    var remain=m.qty-sumBy(locks,function(l){return l.pickedQty;});
    if(qty<=0){showToast('Please enter a quantity','error');return;}
    if(qty>avail){showToast('Only '+avail+' available','error');return;}
    if(qty>remain){showToast('Only '+remain+' remaining','error');return;}
    var rack='GR:'+r.vehicleNo+'/'+r.invoiceNo;
    var ex=DB.filter('location_locks',function(l){return l.obdId===pd.obdId&&l.ean===m.ean&&l.rack===rack&&l.status==='Locked';})[0];
    if(ex)DB.update('location_locks',ex.id,{lockedQty:ex.lockedQty+qty,pickedQty:ex.pickedQty+qty});
    else DB.add('location_locks',{obdId:pd.obdId,obdNo:pd.obdNo,material:m.material,ean:m.ean,locationId:'GR',rack:rack,lockedQty:qty,pickedQty:qty,status:'Locked',source:'GR',invMatId:im.id,vehicleNo:r.vehicleNo,invoiceNo:r.invoiceNo,vehId:r.vehId,pickedBy:APP.currentUser.name,pickedAt:nowISO(),priority:(DB.find('obd_data',pd.obdId)||{}).priority||'Normal'});
    trimExcessLocks(pd.obdId,m.ean,m.qty);
    logAction('Cross-Dock','PICK',qty+' x '+m.material+' from '+r.vehicleNo+' to '+pd.obdNo);
    showToast(qty+' unloading se pick hua','success');
    openPickingOBD(pd.obdId);
}
function removeGRPick(lockId){
    var pd=window._pickData;var l=DB.find('location_locks',lockId);if(!l||l.source!=='GR')return;
    if(!confirm('Ye unloading pick hata dein?'))return;
    DB.update('location_locks',lockId,{status:'Released',releaseReason:'Removed by picker',releasedAt:nowISO()});
    if(pd)openPickingOBD(pd.obdId);
}
function renderCrossdockReport(){
    var from=(window._cdFrom!==undefined)?window._cdFrom:'',to=(window._cdTo!==undefined)?window._cdTo:'';
    var rows=[];
    DB.get('picking_done').forEach(function(p){
        (p.details||[]).forEach(function(d){(d.locations||[]).forEach(function(l){
            if(l.source!=='GR'&&String(l.rack||'').indexOf('GR:')!==0)return;
            var parts=String(l.rack).substring(3).split('/');
            var lv=DB.filter('loaded_vehicles',function(x){return (x.obdIds||[]).indexOf(p.id)>-1;})[0];
            rows.push({date:String(p.pickedAt||'').substring(0,10),at:p.pickedAt,inVeh:parts[0],inv:parts[1]||'',material:d.material,ean:d.ean,qty:l.qty,obdNo:p.obdNo,by:p.pickedByName,status:p.status==='Reversed'?'Reversed':(lv?(lv.loadStatus==='Fully Loaded'?'Loaded':'Loading'):'Picked'),outVeh:lv?lv.vehicleNo:'',loadNo:lv?lv.loadNo:''});
        });});
    });
    DB.filter('location_locks',function(l){return l.source==='GR'&&l.status==='Locked';}).forEach(function(l){
        rows.push({date:String(l.pickedAt||'').substring(0,10),at:l.pickedAt,inVeh:l.vehicleNo,inv:l.invoiceNo,material:l.material,ean:l.ean,qty:l.pickedQty,obdNo:l.obdNo,by:l.pickedBy,status:'In picking',outVeh:'',loadNo:''});
    });
    rows=rows.filter(function(r){return (!from||r.date>=from)&&(!to||r.date<=to);}).sort(function(a,b){return String(b.at).localeCompare(String(a.at));});
    window._cdRows=rows;
    var h='<div class="section-header"><h2><i class="bx bx-transfer"></i> Cross-Dock Report <span style="font-size:12px;color:var(--text-muted);font-weight:normal">(Unloading → OBD / Loading)</span></h2><div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportCrossdock()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportCrossdockPDF()"><i class="bx bx-file"></i> PDF</button></div></div>';
    h+='<div class="sap-report-header" style="margin-bottom:14px">';
    h+='<div class="srh-company"><h2>VIP INDUSTRIES LIMITED</h2><p>Plant MD20 · Cross-Docking Analysis</p></div>';
    h+='<div class="srh-divider"></div>';
    h+='<div class="srh-info"><span><strong>Report:</strong> Unloading → OBD / Loading</span><span><strong>Generated:</strong> '+fmtDT(new Date())+'</span><span><strong>User:</strong> '+esc(APP.currentUser?APP.currentUser.name:'-')+'</span></div>';
    h+='<div class="srh-title-bar"><h3><i class="bx bx-transfer"></i> Cross-Dock Report</h3><div class="report-export-bar"><span class="rsb-item"><strong>'+rows.length+'</strong> Records</span><span class="rsb-item"><strong>'+sumBy(rows.filter(function(r){return r.status!=='Reversed';}),function(r){return r.qty;})+'</strong> Total Qty</span></div></div>';
    h+='</div>';
    h+='<div class="report-filter-box" style="margin-bottom:14px"><div class="report-filter-header" style="margin-bottom:0;padding-bottom:0;border-bottom:none"><div class="rfh-title"><i class="bx bx-filter"></i> Filters</div></div><div class="report-date-row" style="margin-top:14px">';
    h+='<div class="form-group"><label>From Date</label><input type="date" id="cdFrom" class="form-input" value="'+from+'"></div>';
    h+='<div class="form-group"><label>To Date</label><input type="date" id="cdTo" class="form-input" value="'+to+'"></div>';
    h+='<div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-primary" onclick="window._cdFrom=document.getElementById(\'cdFrom\').value;window._cdTo=document.getElementById(\'cdTo\').value;renderCrossdockReport()"><i class="bx bx-check"></i> Apply</button></div>';
    h+='</div></div>';
    h+='<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px"><i class="bx bx-pointer"></i> Double-click any row to see which OBD the material was taken for.</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Date</th><th>Inbound Vehicle</th><th>Invoice</th><th>Material</th><th>Qty</th><th>OBD</th><th>Picked By</th><th>Status</th><th>Outbound Vehicle</th><th>Load No</th></tr></thead><tbody>';
    if(!rows.length)h+='<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:20px">No cross-dock records</td></tr>';
    rows.forEach(function(r,ix){h+='<tr class="cd-row" data-i="'+ix+'" ondblclick="toggleCdDetail(this)" style="cursor:pointer" title="Double click — OBD details"><td style="font-size:11px">'+esc(r.date)+'</td><td><b>'+esc(r.inVeh)+'</b></td><td>'+esc(r.inv)+'</td><td>'+esc(r.material)+'</td><td><b>'+r.qty+'</b></td><td style="color:var(--accent)">'+esc(r.obdNo)+'</td><td>'+esc(r.by||'-')+'</td><td><span class="badge '+(r.status==='Loaded'?'badge-success':(r.status==='Reversed'?'badge-warning':'badge-info'))+'">'+r.status+'</span></td><td>'+esc(r.outVeh||'-')+'</td><td style="font-size:10px">'+esc(r.loadNo||'-')+'</td></tr>';});
    h+='</tbody></table></div>';
    setHtml(h);
}
// Double-click: show below the row which OBD the material was taken for
function toggleCdDetail(tr){
    if(!tr)return;
    var nx=tr.nextElementSibling;
    if(nx&&nx.classList.contains('cd-detail')){nx.remove();tr.style.background='';return;}
    var r=(window._cdRows||[])[parseInt(tr.getAttribute('data-i'),10)];if(!r)return;
    var obd=DB.filter('obd_data',function(o){return o.obdNo===r.obdNo;})[0];
    var obdQty=0;
    if(obd)groupMats(obd).forEach(function(m){if((r.ean&&m.ean===r.ean)||m.material===r.material)obdQty+=m.qty;});
    var cdTot=sumBy((window._cdRows||[]).filter(function(x){return x.obdNo===r.obdNo&&x.status!=='Reversed'&&((r.ean&&x.ean===r.ean)||x.material===r.material);}),function(x){return x.qty;});
    function cell(l,v){return '<div style="min-width:130px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">'+l+'</div><div style="font-size:13px;font-weight:600">'+v+'</div></div>';}
    var d='<div style="padding:4px 2px"><div style="font-weight:700;color:var(--accent);margin-bottom:8px"><i class="bx bx-right-arrow-alt"></i> '+esc(r.material)+' ('+r.qty+') — OBD <b>'+esc(r.obdNo)+'</b> — material taken for this OBD</div><div style="display:flex;flex-wrap:wrap;gap:18px">';
    d+=cell('OBD No',esc(r.obdNo));
    d+=cell('Customer',esc(obd?(obd.customer||'-'):'-'));
    d+=cell('OBD Status',esc(obd?(obd.status||'-'):'-')+(obd&&obd.priority==='Urgent'?' <span class="badge badge-danger">URGENT</span>':''));
    d+=cell('Qty of this material in OBD',obd?obdQty:'-');
    d+=cell('Cross-dock qty (this entry)',r.qty);
    d+=cell('Total cross-dock for this OBD',cdTot);
    d+=cell('Inbound',esc(r.inVeh||'-')+' · Inv '+esc(r.inv||'-'));
    d+=cell('Picked by / time',esc(r.by||'-')+(r.at?' · '+fmtDT(r.at):''));
    d+=cell('Outbound / Load',esc(r.outVeh||'-')+' · '+esc(r.loadNo||'-'));
    d+='</div></div>';
    var row=document.createElement('tr');row.className='cd-detail';
    row.innerHTML='<td colspan="10" style="background:var(--accent-dim);border-left:3px solid var(--accent)">'+d+'</td>';
    tr.parentNode.insertBefore(row,tr.nextSibling);
    tr.style.background='var(--accent-dim)';
}
function exportCrossdockPDF(){
    var rows=window._cdRows||[];
    if(!rows.length){showToast('No cross-dock records to export','warning');return;}
    var pdf=new jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    var from=window._cdFrom||'',to=window._cdTo||'';
    pdf.setFontSize(15);pdf.setFont(undefined,'bold');pdf.text('VIP INDUSTRIES LIMITED',14,14);
    pdf.setFontSize(10);pdf.setFont(undefined,'normal');pdf.text('Plant MD20 - Cross-Dock Report (Unloading to OBD / Loading)',14,20);
    pdf.setFontSize(8);
    pdf.text('Generated: '+fmtDT(new Date())+'   |   User: '+(APP.currentUser?APP.currentUser.name:'-')+'   |   Period: '+(from||'All')+' to '+(to||'All'),14,26);
    var tq=sumBy(rows.filter(function(r){return r.status!=='Reversed';}),function(r){return r.qty;});
    pdf.text('Records: '+rows.length+'   |   Total Qty: '+tq,14,31);
    var body=rows.map(function(r){
        var obd=DB.filter('obd_data',function(o){return o.obdNo===r.obdNo;})[0];
        return [r.date,r.inVeh||'-',r.inv||'-',r.material||'-',r.qty,r.obdNo||'-',obd?(obd.customer||'-'):'-',r.by||'-',r.status,r.outVeh||'-',r.loadNo||'-'];
    });
    pdf.autoTable({startY:35,head:[['Date','Inbound Vehicle','Invoice','Material','Qty','OBD','Customer','Picked By','Status','Outbound Vehicle','Load No']],body:body,styles:{fontSize:7.5,cellPadding:1.8},headStyles:{fillColor:[10,110,209]},
        didDrawPage:function(){pdf.setFontSize(7);pdf.text('Page '+pdf.internal.getNumberOfPages(),pdf.internal.pageSize.getWidth()-20,pdf.internal.pageSize.getHeight()-6);}});
    pdf.save('CrossDock_Report_'+today()+'.pdf');
}
function exportCrossdock(){
    var rows=[['Date','Inbound Vehicle','Invoice','Material','EAN','Qty','OBD','Picked By','Status','Outbound Vehicle','Load No']].concat((window._cdRows||[]).map(function(r){return [r.date,r.inVeh,r.inv,r.material,r.ean,r.qty,r.obdNo,r.by,r.status,r.outVeh,r.loadNo];}));
    var ws=XLSX.utils.aoa_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'CrossDock');XLSX.writeFile(wb,'CrossDock_Report_'+today()+'.xlsx');
}
function inboundBadge(obd){
    var n=0,gr=0;
    groupMats(obd).forEach(function(m){var ib=inboundForEan(m.ean);if(ib.length){n++;gr+=sumBy(ib,function(r){return r.grAvail;});}});
    if(!n)return '';
    return '<span class="badge badge-info" title="'+n+' materials of this OBD are in inbound / unloading">Inbound '+n+(gr?' · GR '+gr:'')+'</span>';
}

function exportPickingDoneExcel(){
    var done=DB.get('picking_done');var rows=[['OBD No','Material','EAN','Required','Picked','Short','Picked By','Time']];
    done.forEach(function(d){(d.details||[]).forEach(function(det){rows.push([d.obdNo||d.obnNo,det.material,det.ean,det.requiredQty,det.pickedQty,det.short,det.pickedByName,fmtDT(d.pickedAt)]);});});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'PickingDone');XLSX.writeFile(wb,'Picking_Done_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}
function exportPickingDonePDF(){
    var done=DB.get('picking_done');var rows=[];
    done.forEach(function(d){(d.details||[]).forEach(function(det){rows.push([d.obdNo,det.material,det.ean,det.requiredQty,det.pickedQty,det.short,det.pickedByName,fmtDT(d.pickedAt)]);});});
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text('Picking Done Report — VIP INDUSTRIES MD20',14,15);pdf.setFontSize(8);pdf.text('Generated: '+fmtDT(new Date()),14,22);
    pdf.autoTable({startY:28,head:[['OBD No','Material','EAN','Req','Picked','Short','By','Time']],body:rows,theme:'grid',headStyles:{fillColor:[0,180,120]},styles:{fontSize:7}});
    pdf.save('Picking_Done_'+today()+'.pdf');showToast('PDF downloaded!','success');
}
// ==================== PICKING WITH LOADING ====================
function renderPickingWithLoading(){
    var isAssigner=chkAct('canPick')&&chkAct('canLoad');
    var h='<div class="section-header"><h2><i class="bx bx-transfer"></i> Pick & Load</h2></div>';

    // ===== SECTION 1: ASSIGN =====
    if(isAssigner){
        var plAssignedIds={};
        DB.filter('picking_assignments',function(a){return a.type==='pickandload'&&a.status==='Assigned';}).forEach(function(a){(a.obdIds||[]).forEach(function(id){plAssignedIds[id]=1;});});
        var obds=DB.get('obd_data').filter(function(o){return o.status==='Pending'&&!plAssignedIds[o.id];});
        var assigned=DB.filter('picking_assignments',function(a){return a.type==='pickandload'&&a.status==='Assigned';});

        h+='<div class="card"><div class="card-title"><i class="bx bx-user-plus"></i> P&L Assign</div>';
        if(!obds.length)h+='<div style="color:var(--text-muted);padding:12px;text-align:center">No OBDs pending</div>';
        else{
            h+='<div class="form-group" style="margin-bottom:10px"><label>Assign To <span class="req">*</span></label>';
            h+='<select id="pwlAssignUser" class="form-input" style="max-width:280px"><option value="">-- Select --</option>';
            DB.get('users').filter(function(u){return u.role==='Picker'||u.role==='Loader'||u.role==='Manager'||u.role==='Admin';}).forEach(function(u){h+='<option value="'+u.id+'" data-name="'+esc(u.name)+'">'+esc(u.name)+' ('+esc(u.role)+')</option>';});
            h+='</select></div>';
            h+='<div class="chk-list" id="pwlChkList" style="max-height:180px;overflow-y:auto">';
            obds.forEach(function(o){
                var tq=0;(o.materials||[]).forEach(function(m){tq+=m.qty;});
                h+='<label class="chk-list-item"><input type="checkbox" class="pwl-chk" value="'+o.id+'" data-no="'+esc(o.obdNo)+'"><span><strong style="color:var(--accent);font-family:var(--font-display);font-size:11px">'+esc(o.obdNo)+'</strong> — '+(o.materials||[]).length+' mats, '+tq+' qty</span></label>';
            });
            h+='</div>';
            h+='<div class="form-actions"><button class="btn btn-glass" onclick="doPWLAssign()"><i class="bx bx-check-double"></i> Assign & Lock</button></div>';
        }
        h+='</div>';

        if(assigned.length){
            h+='<div class="card" style="margin-top:12px"><div class="card-title"><i class="bx bx-user-check"></i> Active P&L ('+assigned.length+')</div>';
            h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>User</th><th>OBDs</th><th>Lock Status</th><th>Actions</th></tr></thead><tbody>';
            assigned.forEach(function(a){
                var tags='';(a.obdNos||[]).forEach(function(n){tags+='<span class="badge badge-info" style="margin:1px;font-size:9px">'+esc(n)+'</span>';});
                var lockInfo='';var tl=0,tp=0,tq=0;
                (a.obdIds||[]).forEach(function(oid){
                    var obd=DB.find('obd_data',oid);if(obd)(obd.materials||[]).forEach(function(m){tq+=m.qty;});
                    DB.filter('location_locks',function(l){return l.obdId===oid&&l.status==='Locked';}).forEach(function(l){tl+=l.lockedQty;tp+=l.pickedQty;});
                });
                lockInfo=tl>=tq?'<span class="badge badge-success">Locked</span>':(tl>0?'<span class="badge badge-warning">'+tl+'/'+tq+'</span>':'<span class="badge badge-danger">No Stock</span>');
                h+='<tr><td>'+esc(a.assignedToName)+'</td><td>'+tags+'</td><td>'+lockInfo+'</td><td><button class="btn btn-danger btn-sm" onclick="unassignPWL(\''+a.id+'\')"><i class="bx bx-user-minus"></i></button></td></tr>';
            });
            h+='</tbody></table></div></div>';
        }
    }

    // ===== SECTION 2: MY P&L =====
    var myPWL=DB.filter('picking_assignments',function(a){
        if(a.type!=='pickandload'||a.status!=='Assigned')return false;
        if(a.assignedTo===APP.currentUser.id)return true;
        return(a.assignedToName||'').toLowerCase().trim()===(APP.currentUser.name||'').toLowerCase().trim();
    });
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-box"></i> My P&L ('+myPWL.length+')</div>';
    if(!myPWL.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">No P&L assigned to you</div>';
    else{
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Materials</th><th>Locked</th><th>Picked</th><th>Loaded</th><th>Action</th></tr></thead><tbody>';
        myPWL.forEach(function(a){
            (a.obdIds||[]).forEach(function(oid,i){
                var obd=DB.find('obd_data',oid);if(!obd)return;
                var tq=0;(obd.materials||[]).forEach(function(m){tq+=m.qty;});
                var locks=DB.filter('location_locks',function(l){return l.obdId===oid&&l.status==='Locked';});
                var tl=0,tp=0;locks.forEach(function(l){tl+=l.lockedQty;tp+=l.pickedQty;});
                var partials=DB.filter('loaded_vehicles',function(lv){return lv.type==='pickandload'&&lv.loadStatus==='Partial';var ids=lv.obdIds;if(!Array.isArray(ids))ids=[ids];return ids.indexOf(oid)>-1;});
                var loadedQ=0;partials.forEach(function(p){(p.scannedItems||[]).forEach(function(s){if(s.inOBD)loadedQ+=s.qty;});});
                var done=DB.filter('loaded_vehicles',function(lv){return lv.type==='pickandload'&&lv.loadStatus==='Fully Loaded';var ids=lv.obdIds;if(!Array.isArray(ids))ids=[ids];return ids.indexOf(oid)>-1;});

                var statusBadge='',actionBtn='';
                if(done.length>0){statusBadge='<span class="badge badge-success">Done</span>';actionBtn='<span style="color:var(--text-muted);font-size:11px">Completed</span>';}
                else if(partials.length>0){
                    var pl=partials[partials.length-1];
                    statusBadge='<span class="badge badge-warning">Partial '+loadedQ+'/'+tq+'</span>';
                    actionBtn='<button class="btn btn-glass btn-sm" style="border-color:var(--warning)" onclick="continuePWL(\''+pl.id+'\')"><i class="bx bx-reload"></i> Continue</button>';
                }else if(tp>0){statusBadge='<span class="badge badge-accent">Picking '+tp+'/'+tq+'</span>';actionBtn='<button class="btn btn-glass btn-sm" onclick="resumePWLPicking(\''+oid+'\')"><i class="bx bx-play"></i> Resume</button>';}
                else if(tl>0){statusBadge='<span class="badge badge-info">Locked '+tl+'/'+tq+'</span>';actionBtn='<button class="btn btn-glass btn-sm" onclick="openPWLSetup(\''+oid+'\')"><i class="bx bx-play"></i> Start</button>';}
                else{statusBadge='<span class="badge badge-danger">No Stock</span>';actionBtn='<button class="btn btn-glass btn-sm" onclick="openPWLSetup(\''+oid+'\')"><i class="bx bx-play"></i> Start</button>';}

                h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(a.obdNos[i]||'-')+'</td><td><span class="badge badge-info">'+(obd.materials||[]).length+'</span></td><td style="font-family:var(--font-display)">'+tl+'</td><td style="font-family:var(--font-display)">'+tp+'</td><td style="font-family:var(--font-display)">'+loadedQ+'</td><td>'+actionBtn+'</td></tr>';
            });
        });
        h+='</tbody></table></div></div>';
    }

    // ===== SECTION 3: P&L DONE =====
    var pwlDone=DB.filter('loaded_vehicles',function(l){return l.type==='pickandload';}).reverse();
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-check-circle"></i> P&L Done ('+pwlDone.length+')</div>';
    if(!pwlDone.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">No P&L completed yet</div>';
    else{
        h+='<div class="search-box" style="margin-bottom:8px"><i class="bx bx-search"></i><input type="text" id="pwlDoneSearch" placeholder="Search LOAD-202601, vehicle..." oninput="searchPWLDone()"></div>';
        h+='<div id="pwlDoneTable">'+buildPWLDoneTable(pwlDone)+'</div>';
    }
    h+='</div>';
    setHtml(h);
}

function buildPWLDoneTable(list){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Load No</th><th>Vehicle</th><th>Security</th><th>OBD</th><th>Items</th><th>Status</th><th>By</th><th>Time</th><th>Action</th></tr></thead><tbody>';
    if(!list.length)h+='<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">No records</td></tr>';
    else list.forEach(function(l){
        var sb=l.loadStatus==='Fully Loaded'?'<span class="badge badge-success">Full</span>':'<span class="badge badge-warning">Partial</span>';
        var ot='';(l.obdNos||[]).forEach(function(n){ot+='<span class="badge badge-info" style="margin:1px;font-size:9px">'+esc(n)+'</span>';});
        h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(l.loadNo)+'</td><td><strong>'+esc(l.vehicleNo)+'</strong></td><td style="font-size:11px">'+esc(l.securityNo||'-')+'</td><td>'+ot+'</td><td><span class="badge badge-info">'+(l.scannedItems||[]).length+'</span></td><td>'+sb+'</td><td style="font-size:11px">'+esc(l.loadedByName)+'</td><td style="font-size:10px;color:var(--text-muted)">'+fmtDT(l.loadedAt)+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" title="View" onclick="viewPWLDoneDetail(\''+l.id+'\')"><i class="bx bx-eye"></i></button><button class="btn btn-danger btn-sm" title="Delete" onclick="deletePWLDone(\''+l.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';
    });
    h+='</tbody></table></div>';return h;
}
function searchPWLDone(){
    var q=(document.getElementById('pwlDoneSearch').value||'').trim().toUpperCase();
    var list=DB.filter('loaded_vehicles',function(l){return l.type==='pickandload';}).reverse();
    if(q)list=list.filter(function(l){return(l.loadNo||'').toUpperCase().indexOf(q)>-1||(l.vehicleNo||'').toUpperCase().indexOf(q)>-1;});
    document.getElementById('pwlDoneTable').innerHTML=buildPWLDoneTable(list);
}

// ===== ASSIGN =====
function doPWLAssign(){
    var sel=document.getElementById('pwlAssignUser');if(!sel.value){showToast('Select user','error');return;}
    var userName=sel.options[sel.selectedIndex].getAttribute('data-name');
    var checks=document.querySelectorAll('.pwl-chk:checked');if(!checks.length){showToast('Select OBDs','error');return;}
    var obdIds=[],obdNos=[];
    checks.forEach(function(c){obdIds.push(c.value);obdNos.push(c.getAttribute('data-no'));});
    DB.add('picking_assignments',{obdIds:obdIds,obdNos:obdNos,assignedTo:sel.value,assignedToName:userName,status:'Assigned',type:'pickandload',assignedAt:new Date().toISOString()});
    obdIds.forEach(function(oid){
        DB.update('obd_data',oid,{status:'P&L Assigned'});
        var obd=DB.find('obd_data',oid);
        lockLocationsForOBD(oid,obd?obd.obdNo:'');
    });
    logAction('P&L','ASSIGN',obdNos.join(', ')+' P&L assigned to '+userName);
    showToast(obdIds.length+' OBDs assigned with locks!','success');renderPickingWithLoading();
}
function unassignPWL(aid){
    if(!confirm('Unassign?'))return;
    var a=DB.find('picking_assignments',aid);if(!a)return;
    DB.update('picking_assignments',aid,{status:'Unassigned'});
    (a.obdIds||[]).forEach(function(oid){DB.update('obd_data',oid,{status:'Pending'});releaseLocksForOBD(oid);});
    logAction('P&L','UNASSIGN','Unassigned from '+a.assignedToName);showToast('Unassigned','success');renderPickingWithLoading();
}

// ===== STEP 1: VEHICLE + SECURITY =====
function openPWLSetup(obdId){
    var obd=DB.find('obd_data',obdId);if(!obd)return;
    window._pwlOBDId=obdId;
    var tq=0;(obd.materials||[]).forEach(function(m){tq+=m.qty;});
    var h='<div style="margin-bottom:12px;padding:10px;background:var(--accent-dim);border-radius:8px;border-left:3px solid var(--accent)">';
    h+='<div style="font-weight:700;color:var(--accent);font-family:var(--font-display)">'+esc(obd.obdNo)+'</div>';
    h+='<div style="font-size:12px;color:var(--text-muted)">'+(obd.materials||[]).length+' materials | '+tq+' qty</div></div>';
    h+='<div class="form-row">';
    h+='<div class="form-group"><label>Vehicle Number <span class="req">*</span></label>'+loadingVehSelect('pwlVehNo','pwlSecNo')+'</div>';
    h+='<div class="form-group"><label>Security / LR No <span class="req">*</span></label><input type="text" id="pwlSecNo" class="form-input" placeholder="SEC-001" style="text-transform:uppercase"></div>';
    h+='</div>';
    showModal('P&L Setup — '+obd.obdNo,h,'sm',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" style="background:var(--accent);color:#000;font-weight:600" onclick="openPWLPicking()"><i class="bx bx-box"></i> Next: Pick</button>');
}

// ===== STEP 2: PICKING =====
function openPWLPicking(){
    var vehNo=(document.getElementById('pwlVehNo').value||'').trim().toUpperCase();
    var secNo=(document.getElementById('pwlSecNo').value||'').trim().toUpperCase();
    if(!vehNo){showToast('Please select a Gate-IN vehicle','error');return;}
    if(!isLoadingGateVehicle(vehNo)){showToast('This vehicle is not IN at the gate','error');return;}
    if(!secNo){showToast('Enter security number','error');return;}
    var obdId=window._pwlOBDId;
    var obd=DB.find('obd_data',obdId);if(!obd)return;
    var allLocks=DB.filter('location_locks',function(l){return l.obdId===obdId&&l.status==='Locked';});

    // Build picked state from locks
    var pickedItems=[];
    obd.materials.forEach(function(m){
        var matLocks=allLocks.filter(function(l){return l.ean===m.ean;});
        var tp=0;matLocks.forEach(function(l){tp+=l.pickedQty;});
        var locs=[];matLocks.forEach(function(l){if(l.pickedQty>0)locs.push({rack:l.rack,qty:l.pickedQty});});
        pickedItems.push({material:m.material,ean:m.ean,requiredQty:m.qty,pickedQty:tp,locations:locs});
    });

    window._pwlData={obdId:obdId,obdNo:obd.obdNo,vehicleNo:vehNo,securityNo:secNo,materials:obd.materials,pickedItems:pickedItems,scannedItems:[],source:'new'};
    closeModal();renderPWLPickModal();
}

function resumePWLPicking(obdId){
    var obd=DB.find('obd_data',obdId);if(!obd)return;
    var allLocks=DB.filter('location_locks',function(l){return l.obdId===obdId&&l.status==='Locked';});
    var pickedItems=[];
    obd.materials.forEach(function(m){
        var matLocks=allLocks.filter(function(l){return l.ean===m.ean;});
        var tp=0;matLocks.forEach(function(l){tp+=l.pickedQty;});
        var locs=[];matLocks.forEach(function(l){if(l.pickedQty>0)locs.push({rack:l.rack,qty:l.pickedQty});});
        pickedItems.push({material:m.material,ean:m.ean,requiredQty:m.qty,pickedQty:tp,locations:locs});
    });
    // Try to get vehicle/sec from any partial
    var partials=DB.filter('loaded_vehicles',function(lv){return lv.type==='pickandload'&&lv.loadStatus==='Partial';var ids=lv.obdIds;if(!Array.isArray(ids))ids=[ids];return ids.indexOf(obdId)>-1;});
    var vehNo='?',secNo='?';var loadNo='';
    if(partials.length){var pl=partials[partials.length-1];vehNo=pl.vehicleNo||'?';secNo=pl.securityNo||'?';loadNo=pl.loadNo||'';window._pwlPartialId=pl.id;}
    window._pwlData={obdId:obdId,obdNo:obd.obdNo,vehicleNo:vehNo,securityNo:secNo,materials:obd.materials,pickedItems:pickedItems,scannedItems:[],source:loadNo?'continue':'new',loadNo:loadNo};
    renderPWLPickModal();
}

function renderPWLPickModal(){
    var pd=window._pwlData;if(!pd)return;
    var h='<div style="margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
    h+='<div style="padding:6px 12px;background:var(--accent-dim);border-radius:6px"><strong style="color:var(--accent);font-family:var(--font-display)">'+esc(pd.obdNo)+'</strong></div>';
    h+='<div style="padding:6px 12px;background:var(--bg-secondary);border-radius:6px"><i class="bx bx-truck"></i> '+esc(pd.vehicleNo)+'</div>';
    h+='<div style="padding:6px 12px;background:var(--bg-secondary);border-radius:6px"><i class="bx bx-shield-quarter"></i> '+esc(pd.securityNo)+'</div>';
    h+='</div>';
    h+='<div class="card-title"><i class="bx bx-box"></i> Pick Materials — Click to pick from locked locations</div>';
    h+='<div class="mat-cards-grid" id="pwlMatCards">';
    pd.pickedItems.forEach(function(m,idx){
        var allDone=m.pickedQty>=m.requiredQty;
        var partial=m.pickedQty>0&&!allDone;
        var noLock=m.pickedQty===0;
        var cs='';if(allDone)cs='background:var(--success-dim);border-color:var(--success)';else if(noLock)cs='background:rgba(255,71,87,0.08);border-color:var(--danger)';else if(partial)cs='background:rgba(255,165,2,0.08);border-color:var(--warning)';
        var st='';if(allDone)st='<span class="status-dot green"></span> Picked '+m.pickedQty;else if(partial)st='<span class="status-dot yellow"></span> Partial '+m.pickedQty+'/'+m.requiredQty;else if(noLock)st='<span class="status-dot red"></span> No Stock';else st='<span class="status-dot green"></span> Ready';
        h+='<div class="mat-card" style="'+cs+'" onclick="showPWLPickLocs('+idx+')">';
        h+='<div class="mc-name"><i class="bx bx-box" style="color:var(--accent)"></i> '+esc(m.material)+'</div>';
        h+='<div class="mc-ean">'+esc(m.ean)+'</div>';
        h+='<div class="mc-qty">Need: <strong>'+m.requiredQty+'</strong> | Picked: <strong style="color:'+(noLock?'var(--danger)':'var(--success)')+'">'+m.pickedQty+'</strong></div>';
        h+='<div class="mc-status">'+st+'</div></div>';
    });
    h+='</div>';

    var totalPicked=0,totalReq=0;pd.pickedItems.forEach(function(m){totalPicked+=m.pickedQty;totalReq+=m.requiredQty;});
    var canGo=totalPicked>0;
    h+='<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">';
    h+='<button class="btn btn-glass" onclick="closeModal()"><i class="bx bx-x"></i> Cancel</button>';
    h+='<button class="btn btn-glass" onclick="savePWLPartialPick()"><i class="bx bx-save"></i> Save Partial</button>';
    h+='<button class="btn btn-glass" style="background:var(--accent);color:#000;font-weight:700" '+(canGo?'':'disabled')+' onclick="goToPWLLoading()"><i class="bx bx-truck"></i> Go Loading ('+totalPicked+')</button>';
    h+='</div>';
    showModal('P&L Pick — '+pd.obdNo,h,'xl','');
}

function showPWLPickLocs(matIdx){
    var pd=window._pwlData;if(!pd)return;
    var m=pd.pickedItems[matIdx];
    var matLocks=DB.filter('location_locks',function(l){return l.obdId===pd.obdId&&l.ean===m.ean&&l.status==='Locked';});
    if(!matLocks.length){
        showModal('No Location', '<div style="text-align:center;padding:20px"><i class="bx bx-map-pin" style="font-size:36px;color:var(--danger);opacity:.5"></i><p style="color:var(--text-muted);margin:10px 0">No stock locked for this material</p></div>','sm','<button class="btn btn-glass" onclick="closeModal();renderPWLPickModal()">Back</button>');return;
    }
    var remaining=m.requiredQty-m.pickedQty;
    var h='<div style="margin-bottom:10px;padding:10px;background:var(--bg-secondary);border-radius:8px">';
    h+='<strong>'+esc(m.material)+'</strong> | EAN: <span style="font-family:var(--font-display)">'+esc(m.ean)+'</span><br>';
    h+='<span style="color:var(--accent)">Need: '+m.requiredQty+'</span> | <span style="color:var(--success)">Picked: '+m.pickedQty+'</span> | <span style="color:var(--warning)">Remaining: '+remaining+'</span></div>';
    h+='<div class="loc-cards-grid">';
    matLocks.forEach(function(lock,idx){
        var canPick=lock.lockedQty-lock.pickedQty;var isDone=lock.pickedQty>=lock.lockedQty;
        h+='<div class="loc-card '+(isDone?'lc-picked':'')+'">';
        h+='<div class="lc-rack"><i class="bx bx-lock"></i> '+esc(lock.rack)+'</div>';
        h+='<div class="lc-avail">Locked: <strong>'+lock.lockedQty+'</strong> | Picked: <strong>'+lock.pickedQty+'</strong></div>';
        if(canPick>0&&remaining>0){
            var mx=Math.min(canPick,remaining);
            h+='<input type="number" id="pwlPickQty_'+idx+'" value="'+mx+'" min="1" max="'+mx+'" style="width:100%;margin-top:6px;padding:6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);text-align:center;font-size:13px">';
            h+='<button class="btn btn-glass btn-sm" style="width:100%;margin-top:6px;justify-content:center" onclick="doPWLPick(\''+lock.id+'\','+matIdx+','+idx+')"><i class="bx bx-check"></i> Pick</button>';
        }else if(isDone){h+='<div style="text-align:center;color:var(--success);font-size:11px;margin-top:6px"><i class="bx bx-check-circle"></i> Done</div>';}
        else{h+='<div style="text-align:center;color:var(--text-muted);font-size:11px;margin-top:6px">—</div>';}
        h+='</div>';
    });
    h+='</div>';
    showModal('Pick — '+m.material,h,'lg','<button class="btn btn-glass" onclick="closeModal();renderPWLPickModal()"><i class="bx bx-arrow-back"></i> Back</button>');
}

function doPWLPick(lockId,matIdx,dispIdx){
    var pd=window._pwlData;if(!pd)return;
    var m=pd.pickedItems[matIdx];
    var lock=DB.find('location_locks',lockId);if(!lock||lock.status!=='Locked'){showToast('Lock not found','error');return;}
    var qty=parseInt((document.getElementById('pwlPickQty_'+dispIdx)||{}).value)||0;
    if(qty<=0){showToast('Enter qty','error');return;}
    var canPick=lock.lockedQty-lock.pickedQty;if(qty>canPick){showToast('Max '+canPick,'error');return;}
    if(m.pickedQty+qty>m.requiredQty){showToast('Max '+m.requiredQty,'error');return;}
    DB.update('location_locks',lockId,{pickedQty:lock.pickedQty+qty});
    m.pickedQty+=qty;
    var exists=false;m.locations.forEach(function(l){if(l.rack===lock.rack){l.qty+=qty;exists=true;}});
    if(!exists)m.locations.push({rack:lock.rack,qty:qty});
    showToast('Picked '+qty+' from '+lock.rack,'success');closeModal();renderPWLPickModal();
}

function savePWLPartialPick(){closeModal();showToast('Progress saved!','success');renderPickingWithLoading();}

// ===== STEP 3: GO LOADING =====
function goToPWLLoading(){
    var pd=window._pwlData;if(!pd)return;
    // Build expected from PICKED items only
    var expected=[];
    pd.pickedItems.forEach(function(m){
        if(m.pickedQty>0)expected.push({obdNo:pd.obdNo,material:m.material,ean:m.ean,requiredQty:m.pickedQty,scannedQty:0});
    });
    if(!expected.length){showToast('Pick at least one item','error');return;}
    pd.expected=expected;pd.scannedItems=[];
    closeModal();renderPWLLoadingScan();
}

function continuePWL(partialId){
    var pl=DB.find('loaded_vehicles',partialId);if(!pl){showToast('Record not found','error');return;}
    var obdIds=pl.obdIds;if(!Array.isArray(obdIds))obdIds=[obdIds];
    var obdNos=pl.obdNos;if(!Array.isArray(obdNos))obdNos=[obdNos];
    var obdId=obdIds[0];var obd=DB.find('obd_data',obdId);if(!obd){showToast('OBD not found','error');return;}
    var allLocks=DB.filter('location_locks',function(l){return l.obdId===obdId&&l.status==='Locked';});
    var pickedItems=[];obd.materials.forEach(function(m){
        var tp=0;allLocks.filter(function(l){return l.ean===m.ean;}).forEach(function(l){tp+=l.pickedQty;});
        var locs=[];allLocks.filter(function(l){return l.ean===m.ean&&l.pickedQty>0;}).forEach(function(l){locs.push({rack:l.rack,qty:l.pickedQty});});
        pickedItems.push({material:m.material,ean:m.ean,requiredQty:m.qty,pickedQty:tp,locations:locs});
    });
    var expected=[];pickedItems.forEach(function(m){if(m.pickedQty>0)expected.push({obdNo:obd.obdNo,material:m.material,ean:m.ean,requiredQty:m.pickedQty,scannedQty:0});});
    window._pwlData={obdId:obdIds,obdNo:obdNos,vehicleNo:pl.vehicleNo,securityNo:pl.securityNo||'',materials:obd.materials,pickedItems:pickedItems,scannedItems:JSON.parse(JSON.stringify(pl.scannedItems||[])),expected:expected,source:'continue',loadNo:pl.loadNo,partialLoadId:partialId};
    renderPWLLoadingScan();
}

// ===== LOADING SCAN (Same format as loading module) =====
function renderPWLLoadingScan(){
    var pd=window._pwlData;if(!pd)return;
    var obdTags='';if(Array.isArray(pd.obdNo))pd.obdNo.forEach(function(n){obdTags+='<span class="badge badge-info" style="font-size:9px">'+esc(n)+'</span>';});else obdTags='<span class="badge badge-info">'+esc(pd.obdNo)+'</span>';

    var h='<div style="margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
    h+='<div style="padding:6px 12px;background:var(--accent-dim);border-radius:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center"><strong style="color:var(--accent);font-size:11px">OBDs:</strong> '+obdTags+'</div>';
    h+='<div style="padding:6px 12px;background:var(--bg-secondary);border-radius:6px"><i class="bx bx-truck"></i> '+esc(pd.vehicleNo)+'</div>';
    h+='<div style="padding:6px 12px;background:var(--bg-secondary);border-radius:6px"><i class="bx bx-shield-quarter"></i> '+esc(pd.securityNo)+'</div>';
    if(pd.source==='continue')h+='<div style="padding:6px 12px;background:rgba(255,165,2,0.12);border-radius:6px;color:var(--warning)"><i class="bx bx-reload"></i> Continuing</div>';
    h+='</div>';

    // Picked summary bar
    var totalPicked=0;pd.expected.forEach(function(e){totalPicked+=e.requiredQty;});
    h+='<div style="padding:8px 12px;background:var(--bg-secondary);border-radius:6px;margin-bottom:10px;font-size:11px;color:var(--text-muted)"><i class="bx bx-info-circle" style="color:var(--accent)"></i> You picked <strong style="color:var(--accent)">'+totalPicked+'</strong> items — scan exactly <strong style="color:var(--success)">'+totalPicked+'</strong> to load into vehicle</div>';

    h+='<div class="search-box" style="margin-bottom:8px"><i class="bx bx-search"></i><input type="text" id="pwlScanInput" placeholder="Scan EAN..." onkeydown="if(event.key===\'Enter\')doPWLScan()" autofocus></div>';
    h+='<div style="display:flex;gap:6px;margin-bottom:12px">';
    h+='<button class="btn btn-glass btn-sm" onclick="APP.scanCallback=function(c){document.getElementById(\'pwlScanInput\').value=c;doPWLScan();};document.getElementById(\'scannerModal\').style.display=\'flex\'"><i class="bx bx-qr"></i> Scanner</button>';
    h+='<button class="btn btn-glass btn-sm" onclick="showPWLManualEntry()"><i class="bx bx-plus"></i> Manual</button>';
    h+='</div>';

    h+='<div class="table-wrapper" style="max-height:260px;overflow-y:auto"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Description</th><th>Qty</th><th>Status</th><th>X</th></tr></thead><tbody id="pwlScanBody"></tbody></table></div>';
    h+='<div id="pwlScanSummary" style="margin-top:12px"></div>';
    h+='<div class="form-actions" style="margin-top:12px">';
    h+='<button class="btn btn-glass" onclick="savePWLPartialLoad()"><i class="bx bx-save"></i> Partial</button>';
    h+='<button class="btn btn-glass" style="background:var(--accent);color:#000;font-weight:600" onclick="submitPWLLoading()"><i class="bx bx-check-double"></i> Submit Loading</button>';
    h+='</div>';

    showModal('P&L Loading — '+esc(pd.vehicleNo),h,'xl','<button class="btn btn-glass" onclick="closeModal()"><i class="bx bx-x"></i> Cancel</button>');
    renderPWLScanTable();
}

async function doPWLScan(){
    var inp=document.getElementById('pwlScanInput');if(!inp)return;
    var val=inp.value.trim();inp.value='';if(!val)return;
    var pd=window._pwlData;if(!pd)return;var uv=val.toUpperCase();
    var found=null;for(var i=0;i<pd.expected.length;i++){var e=pd.expected[i];if(e.ean&&e.ean.toUpperCase()===uv&&e.scannedQty<e.requiredQty){found=e;break;}}
    var mm=await sbFindOne('material_master','ean',uv);   // ★ direct Supabase search
    var mname=mm?(mm.material||''):'';
    var mdesc=mm?(mm.description||''):'';
    if(found){
        found.scannedQty++;
        pd.scannedItems.push({ean:found.ean,material:found.material,description:mdesc,qty:1,inOBD:true,obdNo:found.obdNo,scannedAt:new Date().toISOString()});
        showToast(found.material+' — Match ✓','success');
    }else{
        pd.scannedItems.push({ean:uv,material:mname||val,description:mdesc,qty:1,inOBD:false,obdNo:'—',scannedAt:new Date().toISOString()});
        showToast((mname||val)+' — Not in OBD ✗','warning');
    }
    renderPWLScanTable();setTimeout(function(){var i=document.getElementById('pwlScanInput');if(i)i.focus();},100);
}

function showPWLManualEntry(){
    var h='<div class="form-row">';
    h+='<div class="form-group"><label>EAN</label><input type="text" id="pwlManEan" class="form-input" placeholder="EAN" style="font-family:var(--font-display)" onblur="pwlManEanBlur(this)"></div>';
    h+='<div class="form-group"><label>Material</label><input type="text" id="pwlManMat" class="form-input" placeholder="Material"></div>';
    h+='<div class="form-group"><label>Description</label><input type="text" id="pwlManDesc" class="form-input" placeholder="Description"></div>';
    h+='<div class="form-group"><label>Qty</label><input type="number" id="pwlManQty" class="form-input" value="1" min="1"></div>';
    h+='</div>';
    showModal('Manual Entry',h,'sm','<button class="btn btn-glass" onclick="closeModal();renderPWLLoadingScan()">Cancel</button><button class="btn btn-glass" onclick="addPWLManualItem()"><i class="bx bx-check"></i> Add</button>');
}
async function pwlManEanBlur(inp){
    var e=(inp.value||'').trim().toUpperCase();
    if(e.length<=5)return;
    var mm=await sbFindOne('material_master','ean',e);   // ★ direct Supabase search
    if(mm){
        if(!document.getElementById('pwlManMat').value)document.getElementById('pwlManMat').value=mm.material||'';
        if(!document.getElementById('pwlManDesc').value)document.getElementById('pwlManDesc').value=mm.description||'';
    }
}
function addPWLManualItem(){
    var ean=(document.getElementById('pwlManEan').value||'').trim().toUpperCase();
    var mat=(document.getElementById('pwlManMat').value||'').trim();
    var desc=(document.getElementById('pwlManDesc').value||'').trim();
    var qty=parseInt(document.getElementById('pwlManQty').value)||0;
    if(!mat&&!ean){showToast('Enter data','error');return;}if(qty<=0){showToast('Enter qty','error');return;}
    var pd=window._pwlData;var inOBD=false,obdNo='—';
    pd.expected.forEach(function(e){if((e.ean&&e.ean.toUpperCase()===ean)||(e.material||'').toUpperCase()===mat.toUpperCase()){inOBD=true;obdNo=e.obdNo;e.scannedQty+=qty;}});
    pd.scannedItems.push({ean:ean,material:mat,description:desc,qty:qty,inOBD:inOBD,obdNo:obdNo,scannedAt:new Date().toISOString()});
    closeModal();renderPWLLoadingScan();showToast((inOBD?'Match ✓ ':'Not in OBD ✗ ')+mat+' x '+qty,'info');
}

function updatePWLScanQty(idx,nq){var pd=window._pwlData;if(!pd)return;var item=pd.scannedItems[idx];if(!item)return;nq=parseInt(nq)||1;if(nq<1)nq=1;var diff=nq-item.qty;if(item.inOBD)pd.expected.forEach(function(e){if(e.ean===item.ean)e.scannedQty+=diff;});item.qty=nq;renderPWLScanTable();}
function removePWLScanItem(idx){var pd=window._pwlData;if(!pd)return;var item=pd.scannedItems[idx];if(!item)return;if(item.inOBD)pd.expected.forEach(function(e){if(e.ean===item.ean)e.scannedQty-=item.qty;});pd.scannedItems.splice(idx,1);renderPWLScanTable();}

function renderPWLScanTable(){
    var pd=window._pwlData;if(!pd)return;var body=document.getElementById('pwlScanBody');if(!body)return;var h='';
    pd.scannedItems.forEach(function(s,i){
        var rc=s.inOBD?'':'scan-row-red';
        var sb=s.inOBD?'<span class="badge badge-success" style="font-size:9px;padding:2px 6px"><i class="bx bx-check" style="font-size:10px"></i> Match</span>':'<span class="badge badge-danger" style="font-size:9px;padding:2px 6px"><i class="bx bx-x" style="font-size:10px"></i> Not in OBD</span>';
        h+='<tr class="'+rc+'"><td style="font-size:11px;color:var(--text-muted);text-align:center;width:30px">'+(i+1)+'</td><td style="font-family:var(--font-display);font-size:10px;width:120px">'+esc(s.ean)+'</td><td style="font-size:12px;font-weight:500">'+esc(s.material)+'</td><td style="font-size:11px;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.description)+'</td><td style="width:70px"><input type="number" value="'+s.qty+'" min="1" style="width:55px;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);text-align:center;font-size:12px;font-family:var(--font-display)" onchange="updatePWLScanQty('+i+',parseInt(this.value)||1)"></td><td style="text-align:center;width:100px">'+sb+'</td><td style="width:30px;text-align:center"><button class="btn btn-danger btn-sm" style="width:24px;height:24px;padding:0;min-width:24px" onclick="removePWLScanItem('+i+')"><i class="bx bx-trash" style="font-size:10px"></i></button></td></tr>';
    });
    if(!pd.scannedItems.length)h='<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px"><i class="bx bx-scan" style="font-size:24px;display:block;margin-bottom:6px;opacity:0.3"></i>Scan EAN to load</td></tr>';
    body.innerHTML=h;
    var sd=document.getElementById('pwlScanSummary');if(!sd)return;
    var ts=0,mq=0,nq=0,mc=0;pd.scannedItems.forEach(function(s){ts+=s.qty;if(s.inOBD)mq+=s.qty;else nq+=s.qty;});
    pd.expected.forEach(function(e){if(e.scannedQty!==e.requiredQty)mc++;});
    var sh='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">';
    sh+='<div style="text-align:center;padding:8px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:18px;font-weight:700;color:var(--accent);font-family:var(--font-display)">'+ts+'</div><div style="font-size:10px;color:var(--text-muted)">Scanned</div></div>';
    sh+='<div style="text-align:center;padding:8px;background:rgba(46,213,115,0.1);border-radius:6px"><div style="font-size:18px;font-weight:700;color:var(--success);font-family:var(--font-display)">'+mq+'</div><div style="font-size:10px;color:var(--text-muted)">Match</div></div>';
    sh+='<div style="text-align:center;padding:8px;background:rgba(255,71,87,0.1);border-radius:6px"><div style="font-size:18px;font-weight:700;color:var(--danger);font-family:var(--font-display)">'+nq+'</div><div style="font-size:10px;color:var(--text-muted)">Not in OBD</div></div>';
    sh+='<div style="text-align:center;padding:8px;background:'+(mc?'rgba(255,71,87,0.1)':'rgba(46,213,115,0.1)')+';border-radius:6px"><div style="font-size:18px;font-weight:700;color:'+(mc?'var(--danger)':'var(--success)')+';font-family:var(--font-display)">'+(mc===0?'✓ OK':'⚠ '+mc)+'</div><div style="font-size:10px;color:var(--text-muted)">Mismatch</div></div>';
    sh+='</div>';sd.innerHTML=sh;
}

// ===== PARTIAL SAVE =====
function savePWLPartialLoad(){
    var pd=window._pwlData;if(!pd)return;if(!pd.scannedItems.length){showToast('Scan at least one item','error');return;}
    var obdIds=Array.isArray(pd.obdId)?pd.obdId:[pd.obdId];var obdNos=Array.isArray(pd.obdNo)?pd.obdNo:[pd.obdNo];
    var loadNo='';
    if(pd.source==='continue'&&pd.partialLoadId){var old=DB.find('loaded_vehicles',pd.partialLoadId);loadNo=old?old.loadNo:'';DB.update('loaded_vehicles',pd.partialLoadId,{scannedItems:pd.scannedItems,lastScannedAt:new Date().toISOString()});}
    else{loadNo=pd.loadNo||genLoadNo();DB.add('loaded_vehicles',{loadNo:loadNo,vehicleNo:pd.vehicleNo,securityNo:pd.securityNo,obdIds:obdIds,obdNos:obdNos,loadedBy:APP.currentUser.id,loadedByName:APP.currentUser.name,loadedAt:new Date().toISOString(),lastScannedAt:new Date().toISOString(),scannedItems:pd.scannedItems,loadStatus:'Partial',mismatch:false,type:'pickandload'});}
    logAction('P&L','PARTIAL',obdNos.join(', ')+' partial. '+loadNo);showToast('Partial saved: '+loadNo,'success');closeModal();renderPickingWithLoading();
}

// ===== SUBMIT =====
function submitPWLLoading(){
    var pd=window._pwlData;if(!pd)return;if(!pd.scannedItems.length){showToast('Scan at least one item','error');return;}
    var mismatch=false;pd.expected.forEach(function(e){if(e.scannedQty!==e.requiredQty)mismatch=true;});
    var hasNotInOBD=pd.scannedItems.some(function(s){return !s.inOBD;});
    if(mismatch||hasNotInOBD){showPWLMismatchBlock(pd);return;}
    doPWLFinalSubmit(pd);
}

function showPWLMismatchBlock(pd){
    var mh='<div style="margin-bottom:12px;padding:12px;background:rgba(255,71,87,0.1);border:1px solid var(--danger);border-radius:8px">';
    mh+='<div style="font-weight:700;color:var(--danger);margin-bottom:8px"><i class="bx bx-error-circle"></i> Picked ≠ Loaded — Cannot Submit!</div>';
    pd.expected.forEach(function(e){if(e.scannedQty!==e.requiredQty){var d=e.requiredQty-e.scannedQty;mh+='<div style="font-size:11px;padding:2px 0;color:var(--text-muted)">→ '+esc(e.material)+': Picked <strong>'+e.requiredQty+'</strong>, Loaded <strong style="color:var(--danger)">'+e.scannedQty+'</strong>, Diff: <strong style="color:var(--danger)">'+(d>0?'-'+d:'+'+Math.abs(d))+'</strong></div>';}});
    var nio=pd.scannedItems.filter(function(s){return !s.inOBD;});
    if(nio.length){mh+='<div style="font-size:12px;margin-top:6px;color:var(--warning)"><strong>Extra items:</strong></div>';nio.forEach(function(s){mh+='<div style="font-size:11px;color:var(--text-muted)">→ '+esc(s.material)+' ('+esc(s.ean)+') x '+s.qty+'</div>';});}
    mh+='</div>';
    mh+='<div class="form-group"><label>Reason <span class="req">*</span></label><textarea id="pwlMisReason" class="form-input" placeholder="Explain mismatch..."></textarea></div>';
    showModal('P&L Mismatch — Approval Required',mh,'lg','<button class="btn btn-glass" onclick="closeModal();renderPWLLoadingScan()"><i class="bx bx-arrow-back"></i> Back</button><button class="btn btn-glass" style="background:var(--warning);color:#000;font-weight:600" onclick="requestPWLApproval()"><i class="bx bx-send"></i> Request Approval</button>');
}

function requestPWLApproval(){
    var pd=window._pwlData;if(!pd)return;
    var reason=(document.getElementById('pwlMisReason')||{}).value||'';if(!reason.trim()){showToast('Enter reason','error');return;}
    var obdIds=Array.isArray(pd.obdId)?pd.obdId:[pd.obdId];var obdNos=Array.isArray(pd.obdNo)?pd.obdNo:[pd.obdNo];
    var loadNo=pd.loadNo||genLoadNo();
        var newPWLApproval=DB.add('loading_approvals',{loadNo:loadNo,vehicleNo:pd.vehicleNo,securityNo:pd.securityNo,obdIds:obdIds,obdNos:obdNos,requestedBy:APP.currentUser.id,requestedByName:APP.currentUser.name,reason:reason,scannedItems:pd.scannedItems,expected:pd.expected,status:'Pending',type:'pickandload',createdAt:new Date().toISOString()});
    if(pd.source==='continue'&&pd.partialLoadId)DB.remove('loaded_vehicles',pd.partialLoadId);
    // Release locks and mark done
    obdIds.forEach(function(oid){releaseLocksForOBD(oid);DB.update('obd_data',oid,{status:'P&L Done'});});
    DB.filter('picking_assignments',function(a){return a.type==='pickandload'&&a.status==='Assigned';}).forEach(function(a){var ni=(a.obdIds||[]).filter(function(o){return obdIds.indexOf(o)===-1;});var nn=(a.obdNos||[]).filter(function(n,i){return obdIds.indexOf(a.obdIds[i])===-1;});if(!ni.length)DB.update('picking_assignments',a.id,{status:'Done'});else DB.update('picking_assignments',a.id,{obdIds:ni,obdNos:nn});});
    addNotif('P&L Approval: '+loadNo+' for '+pd.vehicleNo,'warning',null,newPWLApproval.id,'qty-mismatch');logAction('P&L','APPROVAL_REQ',loadNo);
}

function doPWLFinalSubmit(pd){
    var obdIds=Array.isArray(pd.obdId)?pd.obdId:[pd.obdId];var obdNos=Array.isArray(pd.obdNo)?pd.obdNo:[pd.obdNo];
    var loadNo='';
    if(pd.source==='continue'&&pd.partialLoadId){var old=DB.find('loaded_vehicles',pd.partialLoadId);loadNo=old?old.loadNo:genLoadNo();DB.update('loaded_vehicles',pd.partialLoadId,{loadNo:loadNo,scannedItems:pd.scannedItems,loadStatus:'Fully Loaded',mismatch:false,loadedAt:new Date().toISOString(),lastScannedAt:new Date().toISOString()});}
    else{loadNo=pd.loadNo||genLoadNo();DB.add('loaded_vehicles',{loadNo:loadNo,vehicleNo:pd.vehicleNo,securityNo:pd.securityNo,obdIds:obdIds,obdNos:obdNos,loadedBy:APP.currentUser.id,loadedByName:APP.currentUser.name,loadedAt:new Date().toISOString(),lastScannedAt:new Date().toISOString(),scannedItems:pd.scannedItems,loadStatus:'Fully Loaded',mismatch:false,type:'pickandload'});}
    // ★ DEDUCT FROM LOCATION MASTER (based on picked/loaded qty) ★
    pd.pickedItems.forEach(function(m){
        if(m.pickedQty<=0)return;
        (m.locations||[]).forEach(function(loc){
            var locRecs=DB.filter('location_master',function(l){return l.rack===loc.rack&&l.ean===m.ean&&l.quantity>0;});
            var rem=loc.qty;locRecs.forEach(function(lr){if(rem<=0)return;var d=Math.min(lr.quantity,rem);DB.update('location_master',lr.id,{quantity:lr.quantity-d});rem-=d;});
            DB.filter('location_master',function(l){return l.rack===loc.rack&&l.ean===m.ean&&l.quantity<=0;}).forEach(function(zl){DB.remove('location_master',zl.id);});
        });
    });
    // Release locks
    obdIds.forEach(function(oid){releaseLocksForOBD(oid);DB.update('obd_data',oid,{status:'P&L Done'});});
    // Update assignments
    DB.filter('picking_assignments',function(a){return a.type==='pickandload'&&a.status==='Assigned';}).forEach(function(a){var ni=(a.obdIds||[]).filter(function(o){return obdIds.indexOf(o)===-1;});var nn=(a.obdNos||[]).filter(function(n,i){return obdIds.indexOf(a.obdIds[i])===-1;});if(!ni.length)DB.update('picking_assignments',a.id,{status:'Done'});else DB.update('picking_assignments',a.id,{obdIds:ni,obdNos:nn});});
    logAction('P&L','DONE',loadNo+' for '+pd.vehicleNo);addNotif('P&L '+loadNo+' completed','success');showToast('P&L '+loadNo+' submitted!','success');closeModal();renderPickingWithLoading();
}

// ===== VIEW DETAIL =====
function viewPWLDoneDetail(id){
    var l=DB.find('loaded_vehicles',id);if(!l)return;
    var h='<div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px">';
    h+='<div><strong>Load:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(l.loadNo)+'</span></div>';
    h+='<div><strong>Vehicle:</strong> '+esc(l.vehicleNo)+'</div>';
    h+='<div><strong>Security:</strong> '+esc(l.securityNo||'-')+'</div>';
    h+='<div><strong>Status:</strong> '+(l.loadStatus==='Fully Loaded'?'<span class="badge badge-success">Full</span>':'<span class="badge badge-warning">Partial</span>')+'</div>';
    h+='<div><strong>By:</strong> '+esc(l.loadedByName)+'</div><div><strong>Time:</strong> '+fmtDT(l.loadedAt)+'</div></div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Description</th><th>Qty</th><th>Status</th></tr></thead><tbody>';
    (l.scannedItems||[]).forEach(function(s,i){
        var rc=s.inOBD?'':'scan-row-red';var st=s.inOBD?'<span class="badge badge-success" style="font-size:9px">Match</span>':'<span class="badge badge-danger" style="font-size:9px">Not in OBD</span>';
        h+='<tr class="'+rc+'"><td>'+(i+1)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td>'+esc(s.material)+'</td><td style="font-size:11px;color:var(--text-muted)">'+esc(s.description)+'</td><td><strong>'+s.qty+'</strong></td><td>'+st+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('P&L Detail — '+l.loadNo,h,'xl','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
// ==================== LOADING ====================
function renderLoading(sub){
    switch(sub){
        case 'loading-assign':renderLoadingAssign();break;
        case 'loading-register':renderLoadingRegister();break;
        case 'start-loading':renderStartLoading();break;
        case 'loading-done':renderLoadingDone();break;
        case 'qty-mismatch':renderQtyMismatch();break;
        default:renderLoadingAssign();
    }
}

// --- Loading Assign ---
function renderLoadingAssign(){
    var pickedOBDs=DB.get('picking_done').filter(function(p){return p.status==='Done';});
    var fullyLoadedIds={};
    DB.get('loaded_vehicles').forEach(function(lv){
        if(lv.loadStatus==='Fully Loaded'){(lv.obdIds||[]).forEach(function(oid){fullyLoadedIds[oid]=1;});}
    });
    var availableOBDs=pickedOBDs.filter(function(o){return !fullyLoadedIds[o.id];});
    var assigned=DB.filter('loading_assignments',function(a){return a.status==='Assigned';});

    var h='<div class="section-header"><h2><i class="bx bx-truck"></i> Assign Loading</h2></div>';
    h+='<div class="card"><div class="card-title"><i class="bx bx-box"></i> Picking Done OBDs — Ready to Load ('+availableOBDs.length+')</div>';
    if(!availableOBDs.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">No OBDs ready for loading</div>';
    else{
        var assignedOBDIds={};
        assigned.forEach(function(a){(a.obdIds||[]).forEach(function(oid){assignedOBDIds[oid]=a;});});
        var partialOBDIds={};
        DB.get('loaded_vehicles').filter(function(lv){return lv.loadStatus==='Partial';}).forEach(function(lv){
            (lv.obdIds||[]).forEach(function(oid){partialOBDIds[oid]=lv;});
        });

        h+='<div class="form-row" style="margin-bottom:12px">';
        h+='<div class="form-group"><label>Assign To User <span class="req">*</span></label>';
        h+='<select id="loadAssignUser" class="form-input" style="max-width:300px"><option value="">-- Select User --</option>';
        DB.get('users').filter(function(u){return u.role==='Loader'||u.role==='Manager'||u.role==='Admin';}).forEach(function(u){
            h+='<option value="'+u.id+'" data-name="'+esc(u.name)+'">'+esc(u.name)+' ('+esc(u.role)+')</option>';
        });
        h+='</select></div></div>';

        h+='<div class="chk-list" id="loadObdChkList" style="max-height:300px;overflow-y:auto">';
        availableOBDs.forEach(function(o){
            var totalQ=0;(o.details||[]).forEach(function(d){totalQ+=d.pickedQty;});
            var statusBadge='';
            if(assignedOBDIds[o.id])statusBadge=' <span class="badge badge-warning" style="font-size:9px">Assigned: '+esc(assignedOBDIds[o.id].assignedToName)+'</span>';
            else if(partialOBDIds[o.id])statusBadge=' <span class="badge badge-accent" style="font-size:9px">Partial: '+esc(partialOBDIds[o.id].loadNo)+'</span>';
            else statusBadge=' <span class="badge badge-success" style="font-size:9px">Ready</span>';
            var dis=assignedOBDIds[o.id]?'disabled':'';
            h+='<label class="chk-list-item" style="'+(assignedOBDIds[o.id]?'opacity:0.5':'')+'"><input type="checkbox" class="load-obd-chk" value="'+o.id+'" data-no="'+esc(o.obdNo)+'" '+dis+'><span><strong style="color:var(--accent);font-family:var(--font-display);font-size:11px">'+esc(o.obdNo)+'</strong> — '+(o.details||[]).length+' mats, '+totalQ+' qty'+statusBadge+' <button type="button" class="btn btn-glass btn-sm" onclick="event.preventDefault();event.stopPropagation();showLoadAssignDetail(\''+o.id+'\')"><i class="bx bx-show"></i> Detail</button></span></label>';
        });
        h+='</div>';
        h+='<div class="form-actions"><button class="btn btn-glass" onclick="doLoadingAssign()"><i class="bx bx-check-double"></i> Assign Selected</button></div>';
    }
    h+='</div>';

    if(assigned.length){
        h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-user-check"></i> Active Assignments ('+assigned.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>User</th><th>OBDs</th><th>Assigned At</th><th>Actions</th></tr></thead><tbody>';
        assigned.forEach(function(a){
            var tags='';(a.obdNos||[]).forEach(function(n){tags+='<span class="badge badge-info" style="margin:1px;font-size:9px">'+esc(n)+'</span>';});
            h+='<tr><td>'+esc(a.assignedToName)+'</td><td>'+tags+'</td><td style="font-size:11px;color:var(--text-muted)">'+fmtDT(a.assignedAt)+'</td><td><button class="btn btn-danger btn-sm" onclick="unassignLoading(\''+a.id+'\')"><i class="bx bx-user-minus"></i> Unassign</button></td></tr>';
        });
        h+='</tbody></table></div></div>';
    }
    setHtml(h);
}
function doLoadingAssign(){
    var sel=document.getElementById('loadAssignUser');
    if(!sel.value){showToast('Select user','error');return;}
    var userName=sel.options[sel.selectedIndex].getAttribute('data-name');
    var checks=document.querySelectorAll('.load-obd-chk:checked');
    if(!checks.length){showToast('Select at least one OBD','error');return;}
    var obdIds=[],obdNos=[];
    checks.forEach(function(c){obdIds.push(c.value);obdNos.push(c.getAttribute('data-no'));});
    DB.add('loading_assignments',{obdIds:obdIds,obdNos:obdNos,assignedTo:sel.value,assignedToName:userName,status:'Assigned',assignedAt:new Date().toISOString()});
    logAction('Loading','ASSIGN',obdNos.join(', ')+' assigned to '+userName);
    showToast(obdIds.length+' OBDs assigned to '+userName,'success');renderLoadingAssign();
}
function unassignLoading(id){
    if(!confirm('Unassign?'))return;
    var a=DB.find('loading_assignments',id);if(!a)return;
    DB.update('loading_assignments',id,{status:'Unassigned'});
    logAction('Loading','UNASSIGN','Unassigned from '+a.assignedToName);
    showToast('Unassigned','success');renderLoadingAssign();
}

// --- Start Loading (COMPLETELY FIXED) ---
function renderStartLoading(){
    if(!APP.currentUser)return;
    var myAssigns=DB.filter('loading_assignments',function(a){
        if(a.status!=='Assigned')return false;
        if(a.assignedTo===APP.currentUser.id)return true;
        var an=(a.assignedToName||'').toLowerCase().trim();
        var cn=(APP.currentUser.name||'').toLowerCase().trim();
        return an&&cn&&an===cn;
    });
    var h='<div class="section-header"><h2><i class="bx bx-truck"></i> My Loading Tasks</h2></div>';
    if(!myAssigns.length){h+='<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No OBDs assigned to you</p></div></div>';setHtml(h);return;}

    var allOBDs=[];
    myAssigns.forEach(function(a){
        (a.obdIds||[]).forEach(function(oid,i){
            var pd=DB.find('picking_done',oid);if(!pd)return;
            var totalQ=0;(pd.details||[]).forEach(function(d){totalQ+=d.pickedQty;});
            // FIXED: handle both array and single string obdIds
            var partials=DB.filter('loaded_vehicles',function(lv){
                if(lv.loadStatus!=='Partial')return false;
                var ids=lv.obdIds;if(!Array.isArray(ids))ids=[ids];
                return ids.indexOf(oid)>-1;
            });
            var fullDone=DB.filter('loaded_vehicles',function(lv){
                if(lv.loadStatus!=='Fully Loaded')return false;
                var ids=lv.obdIds;if(!Array.isArray(ids))ids=[ids];
                return ids.indexOf(oid)>-1;
            });
            var approvedDone=DB.filter('loading_approvals',function(la){
                if(la.status!=='Approved')return false;
                var ids=la.obdIds;if(!Array.isArray(ids))ids=[ids];
                return ids.indexOf(oid)>-1;
            });

            var statusBadge='',actionBtn='',rowStyle='',isReady=true;
            if(fullDone.length>0||approvedDone.length>0){
                statusBadge='<span class="badge badge-success" style="font-size:9px">Done</span>';
                actionBtn='<span style="font-size:11px;color:var(--text-muted)">Completed</span>';
                rowStyle='opacity:0.4;pointer-events:none';isReady=false;
            }else if(partials.length>0){
                var pl=partials[partials.length-1];
                var loadedQ=0;(pl.scannedItems||[]).forEach(function(s){if(s.inOBD)loadedQ+=s.qty;});
                statusBadge='<span class="badge badge-warning" style="font-size:9px">Partial '+loadedQ+'/'+totalQ+'</span>';
                actionBtn='<button class="btn btn-glass btn-sm" style="border-color:var(--warning)" onclick="continueLoading(\''+pl.id+'\')"><i class="bx bx-reload"></i> Continue</button>';
                isReady=false;
            }else{
                statusBadge='<span class="badge badge-accent" style="font-size:9px">Ready</span>';
                actionBtn='';
            }
            allOBDs.push({id:oid,obdNo:a.obdNos[i]||'-',pd:pd,totalQ:totalQ,statusBadge:statusBadge,actionBtn:actionBtn,rowStyle:rowStyle,isReady:isReady});
        });
    });

    var readyOBDs=allOBDs.filter(function(o){return o.isReady;});
    var otherOBDs=allOBDs.filter(function(o){return !o.isReady;});

    if(readyOBDs.length>0){
        h+='<div class="card" style="margin-bottom:12px">';
        h+='<div class="card-title"><i class="bx bx-checkbox-checked"></i> Select OBDs to Load ('+readyOBDs.length+')</div>';
        h+='<div style="padding:8px 12px;background:var(--bg-secondary);border-radius:6px;margin-bottom:10px;font-size:11px;color:var(--text-muted)"><i class="bx bx-info-circle" style="color:var(--accent)"></i> Select OBDs → Click Start Loading → Enter vehicle → Scan</div>';
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th style="width:40px"><input type="checkbox" id="loadSelectAll" onchange="toggleAllLoadOBDs(this.checked)" style="cursor:pointer;accent-color:var(--accent);width:16px;height:16px"></th><th>OBD No</th><th>Materials</th><th>Total Qty</th><th>Status</th></tr></thead><tbody>';
        readyOBDs.forEach(function(o){
            h+='<tr style="'+o.rowStyle+'"><td><input type="checkbox" class="load-obd-sel-chk" value="'+o.id+'" data-no="'+esc(o.obdNo)+'" style="cursor:pointer;accent-color:var(--accent);width:16px;height:16px"></td>';
            h+='<td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(o.obdNo)+'</td>';
            h+='<td><span class="badge badge-info">'+(o.pd.details||[]).length+'</span></td>';
            h+='<td><strong>'+o.totalQ+'</strong></td><td>'+o.statusBadge+'</td></tr>';
        });
        h+='</tbody></table></div>';
        h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding:10px 14px;background:var(--accent-dim);border-radius:8px;border:1px solid var(--accent)">';
        h+='<div><span style="font-size:13px;font-weight:600">Selected: <span id="loadSelCount" style="color:var(--accent);font-family:var(--font-display)">0</span> OBDs</span>';
        h+='<div id="loadSelNames" style="font-size:11px;color:var(--text-muted);margin-top:2px">None selected</div></div>';
        h+='<button class="btn btn-glass" style="background:var(--accent);color:#000;font-weight:700;padding:10px 24px" onclick="startMultiLoading()"><i class="bx bx-truck"></i> Start Loading</button></div></div>';
    }

    if(otherOBDs.length>0){
        h+='<div class="card" style="margin-bottom:12px"><div class="card-title"><i class="bx bx-loader-circle"></i> In-Progress OBDs ('+otherOBDs.length+')</div>';
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Materials</th><th>Total Qty</th><th>Status</th><th>Action</th></tr></thead><tbody>';
        otherOBDs.forEach(function(o){
            h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(o.obdNo)+'</td>';
            h+='<td><span class="badge badge-info">'+(o.pd.details||[]).length+'</span></td>';
            h+='<td><strong>'+o.totalQ+'</strong></td><td>'+o.statusBadge+'</td><td>'+o.actionBtn+'</td></tr>';
        });
        h+='</tbody></table></div></div>';
    }
    setHtml(h);
    setTimeout(function(){document.querySelectorAll('.load-obd-sel-chk').forEach(function(c){c.onchange=updateLoadSelCount;});},100);
}

function toggleAllLoadOBDs(checked){document.querySelectorAll('.load-obd-sel-chk').forEach(function(c){c.checked=checked;});updateLoadSelCount();}
function updateLoadSelCount(){
    var checked=document.querySelectorAll('.load-obd-sel-chk:checked');
    var countEl=document.getElementById('loadSelCount');
    var namesEl=document.getElementById('loadSelNames');
    if(countEl)countEl.textContent=checked.length;
    if(namesEl){
        if(!checked.length)namesEl.innerHTML='None selected';
        else{var names=[];checked.forEach(function(c){names.push(c.getAttribute('data-no'));});namesEl.innerHTML=names.map(function(n){return '<span class="badge badge-info" style="margin:1px;font-size:10px">'+esc(n)+'</span>';}).join(' ');}
    }
}

function startMultiLoading(){
    var checked=document.querySelectorAll('.load-obd-sel-chk:checked');
    if(!checked.length){showToast('Select at least one OBD','error');return;}
    var obdIds=[],obdNos=[];
    checked.forEach(function(c){obdIds.push(c.value);obdNos.push(c.getAttribute('data-no'));});
    window._multiLoadOBDs={ids:obdIds,nos:obdNos};
    var totalMats=0,totalQty=0;
    obdIds.forEach(function(oid){var pd=DB.find('picking_done',oid);if(pd){(pd.details||[]).forEach(function(d){totalMats++;totalQty+=d.pickedQty;});}});
    var h='<div style="margin-bottom:16px;padding:12px;background:var(--accent-dim);border-radius:8px;border-left:3px solid var(--accent)">';
    h+='<div style="font-weight:700;color:var(--accent);margin-bottom:6px"><i class="bx bx-box"></i> '+obdIds.length+' OBDs Selected</div>';
    h+='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">';
    obdNos.forEach(function(n){h+='<span class="badge badge-info" style="font-size:10px">'+esc(n)+'</span>';});
    h+='</div><div style="font-size:12px;color:var(--text-muted)">'+totalMats+' materials | '+totalQty+' total qty</div></div>';
    h+='<div class="form-row">';
    h+='<div class="form-group"><label>Vehicle Number <span class="req">*</span></label>'+loadingVehSelect('loadVehicleNo','loadSecurityNo')+'</div>';
    h+='<div class="form-group"><label>Security / LR Number <span class="req">*</span></label><input type="text" id="loadSecurityNo" class="form-input" placeholder="SEC-001" style="text-transform:uppercase"></div>';
    h+='</div>';
    showModal('Loading Setup — '+obdIds.length+' OBDs',h,'sm',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" style="background:var(--accent);color:#000;font-weight:600" onclick="openMultiLoadingScanner()"><i class="bx bx-scan"></i> Next: Scan</button>');
}

function openMultiLoadingScanner(){
    var vehNo=(document.getElementById('loadVehicleNo').value||'').trim().toUpperCase();
    var secNo=(document.getElementById('loadSecurityNo').value||'').trim().toUpperCase();
    if(!vehNo){showToast('Please select a Gate-IN vehicle','error');return;}
    if(!isLoadingGateVehicle(vehNo)){showToast('This vehicle is not IN at the gate','error');return;}
    if(!secNo){showToast('Enter security number','error');return;}
    var ml=window._multiLoadOBDs;if(!ml)return;
    var expected=[];
    ml.ids.forEach(function(oid){var pd=DB.find('picking_done',oid);if(!pd)return;(pd.details||[]).forEach(function(d){expected.push({obdNo:d.obdNo,material:d.material,ean:d.ean,requiredQty:d.pickedQty,scannedQty:0});});});
    window._loadScanData={obdId:ml.ids,obdNo:ml.nos,vehicleNo:vehNo,securityNo:secNo,expected:expected,scannedItems:[],source:'new',isMulti:true};
    closeModal();renderLoadingScanModal();
}

// ★★★ FIXED: Continue Loading — handles both array & string obdIds ★★★
function continueLoading(partialLoadId){
    var pl=DB.find('loaded_vehicles',partialLoadId);
    if(!pl){showToast('Partial load record not found','error');return;}

    // FIX: handle both array and single string
    var obdIds=pl.obdIds;
    if(!Array.isArray(obdIds))obdIds=[obdIds];
    var obdNos=pl.obdNos;
    if(!Array.isArray(obdNos))obdNos=[obdNos];

    var obdId=obdIds[0];
    var pd=DB.find('picking_done',obdId);
    if(!pd){showToast('Picking data not found for OBD. It may have been cleared.','error');return;}

    var expected=[];
    (pd.details||[]).forEach(function(d){
        var done=0;
        (pl.scannedItems||[]).forEach(function(s){if(s.ean===d.ean&&s.inOBD)done+=s.qty;});
        expected.push({obdNo:d.obdNo,material:d.material,ean:d.ean,requiredQty:d.pickedQty,scannedQty:done});
    });

    window._loadScanData={
        obdId:obdIds,
        obdNo:obdNos,
        vehicleNo:pl.vehicleNo,
        securityNo:pl.securityNo||'',
        expected:expected,
        scannedItems:JSON.parse(JSON.stringify(pl.scannedItems||[])),
        partialLoadId:partialLoadId,
        source:'continue',
        isMulti:obdIds.length>1
    };
    renderLoadingScanModal();
}

// ★★★ FIXED: Scan Modal — proper format with Match/Not in OBD ★★★
function renderLoadingScanModal(){
    var ld=window._loadScanData;if(!ld)return;
    var obdTags='';
    if(ld.isMulti&&Array.isArray(ld.obdNo)){
        ld.obdNo.forEach(function(n){obdTags+='<span class="badge badge-info" style="font-size:9px">'+esc(n)+'</span>';});
    }else{
        var singleNo=Array.isArray(ld.obdNo)?ld.obdNo[0]:ld.obdNo;
        obdTags='<span class="badge badge-info">'+esc(singleNo)+'</span>';
    }

    var h='<div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
    h+='<div style="padding:6px 12px;background:var(--accent-dim);border-radius:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center"><strong style="color:var(--accent);font-size:11px">OBDs:</strong> '+obdTags+'</div>';
    h+='<div style="padding:6px 12px;background:var(--bg-secondary);border-radius:6px"><i class="bx bx-truck"></i> '+esc(ld.vehicleNo)+'</div>';
    h+='<div style="padding:6px 12px;background:var(--bg-secondary);border-radius:6px"><i class="bx bx-shield-quarter"></i> '+esc(ld.securityNo)+'</div>';
    if(ld.source==='continue')h+='<div style="padding:6px 12px;background:rgba(255,165,2,0.12);border-radius:6px;color:var(--warning)"><i class="bx bx-reload"></i> Continuing</div>';
    h+='</div>';

    // Scan input
    h+='<div class="search-box" style="margin-bottom:8px"><i class="bx bx-search"></i><input type="text" id="loadScanInput" placeholder="Scan EAN..." onkeydown="if(event.key===\'Enter\')doLoadScan()" autofocus></div>';
    h+='<div style="display:flex;gap:6px;margin-bottom:12px">';
    h+='<button class="btn btn-glass btn-sm" onclick="APP.scanCallback=function(c){document.getElementById(\'loadScanInput\').value=c;doLoadScan();};document.getElementById(\'scannerModal\').style.display=\'flex\'"><i class="bx bx-qr"></i> Scanner</button>';
    h+='<button class="btn btn-glass btn-sm" onclick="showManualLoadEntry()"><i class="bx bx-plus"></i> Manual Entry</button>';
    h+='</div>';

    // ★ Scanned Items Table — EAN | Material | Description | Qty | Status | X
    h+='<div class="table-wrapper" style="max-height:280px;overflow-y:auto"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Description</th><th>Qty</th><th>Status</th><th>X</th></tr></thead><tbody id="loadScanBody"></tbody></table></div>';

    // Summary
    h+='<div id="loadScanSummary" style="margin-top:12px"></div>';

    // Actions
    h+='<div class="form-actions" style="margin-top:12px">';
    h+='<button class="btn btn-glass" onclick="savePartialLoad()"><i class="bx bx-save"></i> Partial Load</button>';
    h+='<button class="btn btn-glass" style="background:var(--accent);color:#000;font-weight:600" onclick="submitFinalLoad()"><i class="bx bx-check-double"></i> Submit Loading</button>';
    h+='</div>';

    var title=ld.isMulti?'Loading Scan — '+esc(ld.vehicleNo):'Loading Scan — '+esc(Array.isArray(ld.obdNo)?ld.obdNo[0]:ld.obdNo);
    showModal(title,h,'xl','<button class="btn btn-glass" onclick="closeModal()">Cancel</button>');
    renderLoadScanTable();
}

// ★★★ FIXED: doLoadScan — auto fill material & description ★★★
async function doLoadScan(){
    var inp=document.getElementById('loadScanInput');if(!inp)return;
    var val=inp.value.trim();inp.value='';if(!val)return;
    var ld=window._loadScanData;if(!ld)return;
    var uv=val.toUpperCase();

    // Find first unmatched expected item
    var found=null;
    for(var i=0;i<ld.expected.length;i++){
        var e=ld.expected[i];
        if(e.ean&&e.ean.toUpperCase()===uv&&e.scannedQty<e.requiredQty){found=e;break;}
    }

    // Get material master for auto-fill (direct Supabase)
    var mm=await sbFindOne('material_master','ean',uv);   // ★
    var matName=mm?(mm.material||''):'';
    var matDesc=mm?(mm.description||''):'';

    if(found){
        found.scannedQty++;
        ld.scannedItems.push({
            ean:found.ean,
            material:found.material||matName,
            description:matDesc,
            qty:1,
            inOBD:true,
            obdNo:found.obdNo,
            scannedAt:new Date().toISOString()
        });
        showToast(found.material+' — Match ✓','success');
    }else{
        ld.scannedItems.push({
            ean:uv,
            material:matName||val,
            description:matDesc,
            qty:1,
            inOBD:false,
            obdNo:'—',
            scannedAt:new Date().toISOString()
        });
        showToast((matName||val)+' — Not in OBD ✗','warning');
    }
    renderLoadScanTable();
    setTimeout(function(){var i=document.getElementById('loadScanInput');if(i)i.focus();},100);
}

// ★★★ FIXED: Manual Entry with auto-fill ★★★
function showManualLoadEntry(){
    var h='<div class="form-row">';
    h+='<div class="form-group"><label>EAN</label><input type="text" id="manLoadEan" class="form-input" placeholder="Scan or type EAN" style="font-family:var(--font-display)" onblur="autoFillManualLoad()"></div>';
    h+='<div class="form-group"><label>Material Name</label><input type="text" id="manLoadMat" class="form-input" placeholder="Auto-filled or type"></div>';
    h+='<div class="form-group"><label>Description</label><input type="text" id="manLoadDesc" class="form-input" placeholder="Auto-filled or type"></div>';
    h+='<div class="form-group"><label>Qty</label><input type="number" id="manLoadQty" class="form-input" value="1" min="1"></div>';
    h+='</div>';
    showModal('Manual Entry',h,'sm',
        '<button class="btn btn-glass" onclick="closeModal();renderLoadingScanModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="addManualLoadItem()"><i class="bx bx-check"></i> Add</button>');
}

async function autoFillManualLoad(){
    var ean=(document.getElementById('manLoadEan').value||'').trim().toUpperCase();
    if(!ean||ean.length<5)return;
    var mm=await sbFindOne('material_master','ean',ean);   // ★ direct Supabase search
    if(mm){
        if(!document.getElementById('manLoadMat').value)document.getElementById('manLoadMat').value=mm.material||'';
        if(!document.getElementById('manLoadDesc').value)document.getElementById('manLoadDesc').value=mm.description||'';
    }
}

function addManualLoadItem(){
    var ean=(document.getElementById('manLoadEan').value||'').trim().toUpperCase();
    var mat=(document.getElementById('manLoadMat').value||'').trim();
    var desc=(document.getElementById('manLoadDesc').value||'').trim();
    var qty=parseInt(document.getElementById('manLoadQty').value)||0;
    if(!mat&&!ean){showToast('Enter EAN or Material','error');return;}
    if(qty<=0){showToast('Enter qty','error');return;}
    var ld=window._loadScanData;
    var inOBD=false,obdNo='—';
    ld.expected.forEach(function(e){
        if((e.ean&&e.ean.toUpperCase()===ean)||(e.material||'').toUpperCase()===mat.toUpperCase()){
            inOBD=true;obdNo=e.obdNo;e.scannedQty+=qty;
        }
    });
    ld.scannedItems.push({ean:ean,material:mat,description:desc,qty:qty,inOBD:inOBD,obdNo:obdNo,scannedAt:new Date().toISOString()});
    closeModal();renderLoadingScanModal();
    showToast((inOBD?'Match ✓ ':'Not in OBD ✗ — ')+mat+' x '+qty,'info');
}

function updateLoadScanQty(idx,nq){
    var ld=window._loadScanData;if(!ld)return;
    var item=ld.scannedItems[idx];if(!item)return;
    nq=parseInt(nq)||1;if(nq<1)nq=1;
    var diff=nq-item.qty;
    if(item.inOBD)ld.expected.forEach(function(e){if(e.ean===item.ean)e.scannedQty+=diff;});
    item.qty=nq;renderLoadScanTable();
}

function removeLoadScanItem(idx){
    var ld=window._loadScanData;if(!ld)return;
    var item=ld.scannedItems[idx];if(!item)return;
    if(item.inOBD)ld.expected.forEach(function(e){if(e.ean===item.ean)e.scannedQty-=item.qty;});
    ld.scannedItems.splice(idx,1);renderLoadScanTable();
}

// ★★★ FIXED: Render Scan Table — EAN | Material | Description | Qty | Match/Not in OBD ★★★
function renderLoadScanTable(){
    var ld=window._loadScanData;if(!ld)return;
    var body=document.getElementById('loadScanBody');if(!body)return;
    var h='';
    ld.scannedItems.forEach(function(s,i){
        var rowClass=s.inOBD?'':'scan-row-red';
        // Status badge
        var statusBadge=s.inOBD
            ?'<span class="badge badge-success" style="font-size:9px;padding:2px 6px"><i class="bx bx-check" style="font-size:10px"></i> Match</span>'
            :'<span class="badge badge-danger" style="font-size:9px;padding:2px 6px"><i class="bx bx-x" style="font-size:10px"></i> Not in OBD</span>';

        h+='<tr class="'+rowClass+'">';
        h+='<td style="font-size:11px;color:var(--text-muted);text-align:center;width:30px">'+(i+1)+'</td>';
        h+='<td style="font-family:var(--font-display);font-size:10px;width:120px">'+esc(s.ean)+'</td>';
        h+='<td style="font-size:12px;font-weight:500">'+esc(s.material)+'</td>';
        h+='<td style="font-size:11px;color:var(--text-muted);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.description)+'</td>';
        // Editable Qty
        h+='<td style="width:70px"><input type="number" value="'+s.qty+'" min="1" style="width:55px;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);text-align:center;font-size:12px;font-family:var(--font-display)" onchange="updateLoadScanQty('+i+',parseInt(this.value)||1)"></td>';
        // Status
        h+='<td style="text-align:center;width:100px">'+statusBadge+'</td>';
        // Delete
        h+='<td style="width:30px;text-align:center"><button class="btn btn-danger btn-sm" style="width:24px;height:24px;padding:0;min-width:24px" onclick="removeLoadScanItem('+i+')"><i class="bx bx-trash" style="font-size:10px"></i></button></td>';
        h+='</tr>';
    });
    if(!ld.scannedItems.length)h='<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px"><i class="bx bx-scan" style="font-size:24px;display:block;margin-bottom:6px;opacity:0.3"></i>Scan EAN to start loading</td></tr>';
    body.innerHTML=h;

    // Summary
    var sd=document.getElementById('loadScanSummary');if(!sd)return;
    var totalS=0,matchQ=0,notInOBDQ=0,misCount=0;
    ld.scannedItems.forEach(function(s){totalS+=s.qty;if(s.inOBD)matchQ+=s.qty;else notInOBDQ+=s.qty;});
    ld.expected.forEach(function(e){
        if(e.scannedQty>0&&e.scannedQty!==e.requiredQty)misCount++;
        if(e.scannedQty===0&&e.requiredQty>0)misCount++;
    });
    var sh='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">';
    sh+='<div style="text-align:center;padding:8px;background:var(--bg-secondary);border-radius:6px"><div style="font-size:18px;font-weight:700;color:var(--accent);font-family:var(--font-display)">'+totalS+'</div><div style="font-size:10px;color:var(--text-muted)">Scanned</div></div>';
    sh+='<div style="text-align:center;padding:8px;background:rgba(46,213,115,0.1);border-radius:6px"><div style="font-size:18px;font-weight:700;color:var(--success);font-family:var(--font-display)">'+matchQ+'</div><div style="font-size:10px;color:var(--text-muted)">Match</div></div>';
    sh+='<div style="text-align:center;padding:8px;background:rgba(255,71,87,0.1);border-radius:6px"><div style="font-size:18px;font-weight:700;color:var(--danger);font-family:var(--font-display)">'+notInOBDQ+'</div><div style="font-size:10px;color:var(--text-muted)">Not in OBD</div></div>';
    sh+='<div style="text-align:center;padding:8px;background:'+(misCount?'rgba(255,71,87,0.1)':'rgba(46,213,115,0.1)')+';border-radius:6px"><div style="font-size:18px;font-weight:700;color:'+(misCount?'var(--danger)':'var(--success)')+';font-family:var(--font-display)">'+(misCount===0?'✓':'⚠ '+misCount)+'</div><div style="font-size:10px;color:var(--text-muted)">Mismatch</div></div>';
    sh+='</div>';sd.innerHTML=sh;
}

// --- Partial Load ---
function savePartialLoad(){
    var ld=window._loadScanData;if(!ld)return;
    if(!ld.scannedItems.length){showToast('Scan at least one item','error');return;}
    var obdIds=ld.isMulti?ld.obdId:(Array.isArray(ld.obdId)?ld.obdId:[ld.obdId]);
    var obdNos=ld.isMulti?ld.obdNo:(Array.isArray(ld.obdNo)?ld.obdNo:[ld.obdNo]);
    var loadNo='';
    if(ld.source==='continue'&&ld.partialLoadId){
        var old=DB.find('loaded_vehicles',ld.partialLoadId);loadNo=old?old.loadNo:'';
        DB.update('loaded_vehicles',ld.partialLoadId,{scannedItems:ld.scannedItems,lastScannedAt:new Date().toISOString()});
    }else{
        loadNo=genLoadNo();
        DB.add('loaded_vehicles',{loadNo:loadNo,vehicleNo:ld.vehicleNo,securityNo:ld.securityNo,obdIds:obdIds,obdNos:obdNos,loadedBy:APP.currentUser.id,loadedByName:APP.currentUser.name,loadedAt:new Date().toISOString(),lastScannedAt:new Date().toISOString(),scannedItems:ld.scannedItems,loadStatus:'Partial',mismatch:false});
    }
    logAction('Loading','PARTIAL',obdNos.join(', ')+' partial. Load: '+loadNo);
    showToast('Partial saved: '+loadNo,'success');closeModal();renderStartLoading();
}

// --- Submit Final ---
function submitFinalLoad(){
    var ld=window._loadScanData;if(!ld)return;
    if(!ld.scannedItems.length){showToast('Scan at least one item','error');return;}
    var mismatch=hasMismatch(ld);
    var hasNotInOBD=ld.scannedItems.some(function(s){return !s.inOBD;});
    if(mismatch||hasNotInOBD){showMismatchBlock(ld);return;}
    doFinalSubmit(ld);
}

function hasMismatch(ld){var has=false;ld.expected.forEach(function(e){if(e.scannedQty!==e.requiredQty)has=true;});return has;}

function showMismatchBlock(ld){
    var mh='<div style="margin-bottom:12px;padding:12px;background:rgba(255,71,87,0.1);border:1px solid var(--danger);border-radius:8px">';
    mh+='<div style="font-weight:700;color:var(--danger);margin-bottom:8px"><i class="bx bx-error-circle"></i> Cannot Submit — Mismatch Found!</div>';
    ld.expected.forEach(function(e){
        if(e.scannedQty!==e.requiredQty){
            var diff=e.requiredQty-e.scannedQty;
            mh+='<div style="font-size:11px;padding:2px 0;color:var(--text-muted)">→ '+esc(e.material)+': Expected <strong>'+e.requiredQty+'</strong>, Scanned <strong style="color:'+(diff>0?'var(--danger)':'var(--warning)')+'">'+e.scannedQty+'</strong>, Diff: <strong style="color:var(--danger)">'+(diff>0?'-'+diff:'+'+Math.abs(diff))+'</strong></div>';
        }
    });
    var notInOBD=ld.scannedItems.filter(function(s){return !s.inOBD;});
    if(notInOBD.length){
        mh+='<div style="font-size:12px;margin-top:6px;color:var(--warning)"><strong>Extra items (Not in OBD):</strong></div>';
        notInOBD.forEach(function(s){mh+='<div style="font-size:11px;padding:2px 0;color:var(--text-muted)">→ '+esc(s.material)+' ('+esc(s.ean)+') x '+s.qty+'</div>';});
    }
    mh+='</div>';
    mh+='<div class="form-group"><label>Reason for mismatch <span class="req">*</span></label><textarea id="mismatchReason" class="form-input" placeholder="Explain why mismatch exists..."></textarea></div>';
    showModal('Mismatch — Approval Required',mh,'lg',
        '<button class="btn btn-glass" onclick="closeModal();renderLoadingScanModal()"><i class="bx bx-arrow-back"></i> Back</button>'+
        '<button class="btn btn-glass" style="background:var(--warning);color:#000;font-weight:600" onclick="requestLoadApproval()"><i class="bx bx-send"></i> Request Admin Approval</button>');
}

function requestLoadApproval(){
    var ld=window._loadScanData;if(!ld)return;
    var reason=(document.getElementById('mismatchReason')||{}).value||'';
    if(!reason.trim()){showToast('Enter reason','error');return;}
    var obdIds=ld.isMulti?ld.obdId:(Array.isArray(ld.obdId)?ld.obdId:[ld.obdId]);
    var obdNos=ld.isMulti?ld.obdNo:(Array.isArray(ld.obdNo)?ld.obdNo:[ld.obdNo]);
    var loadNo=ld.partialLoadId?(DB.find('loaded_vehicles',ld.partialLoadId)||{}).loadNo||genLoadNo():genLoadNo();
        var newApproval=DB.add('loading_approvals',{loadNo:loadNo,vehicleNo:ld.vehicleNo,securityNo:ld.securityNo,obdIds:obdIds,obdNos:obdNos,requestedBy:APP.currentUser.id,requestedByName:APP.currentUser.name,reason:reason,scannedItems:ld.scannedItems,expected:ld.expected,status:'Pending',createdAt:new Date().toISOString()});
    if(ld.source==='continue'&&ld.partialLoadId)DB.remove('loaded_vehicles',ld.partialLoadId);
    addNotif('Loading Approval: '+loadNo+' for '+ld.vehicleNo,'warning',null,newApproval.id,'qty-mismatch');
    logAction('Loading','APPROVAL_REQ',loadNo+' requested by '+APP.currentUser.name);
    showToast('Approval request sent!','success');closeModal();renderStartLoading();
}

function doFinalSubmit(ld){
    var obdIds=ld.isMulti?ld.obdId:(Array.isArray(ld.obdId)?ld.obdId:[ld.obdId]);
    var obdNos=ld.isMulti?ld.obdNo:(Array.isArray(ld.obdNo)?ld.obdNo:[ld.obdNo]);
    var loadNo='';
    if(ld.source==='continue'&&ld.partialLoadId){
        var old=DB.find('loaded_vehicles',ld.partialLoadId);loadNo=old?old.loadNo:genLoadNo();
        DB.update('loaded_vehicles',ld.partialLoadId,{loadNo:loadNo,scannedItems:ld.scannedItems,loadStatus:'Fully Loaded',mismatch:false,loadedAt:new Date().toISOString(),lastScannedAt:new Date().toISOString()});
    }else{
        loadNo=genLoadNo();
        DB.add('loaded_vehicles',{loadNo:loadNo,vehicleNo:ld.vehicleNo,securityNo:ld.securityNo,obdIds:obdIds,obdNos:obdNos,loadedBy:APP.currentUser.id,loadedByName:APP.currentUser.name,loadedAt:new Date().toISOString(),lastScannedAt:new Date().toISOString(),scannedItems:ld.scannedItems,loadStatus:'Fully Loaded',mismatch:false});
    }
    obdIds.forEach(function(oid){
        DB.filter('loading_assignments',function(a){return a.status==='Assigned'&&(a.obdIds||[]).indexOf(oid)>-1;}).forEach(function(a){
            var ni=(a.obdIds||[]).filter(function(o){return o!==oid;});
            var nn=(a.obdNos||[]).filter(function(n,i){return a.obdIds[i]!==oid;});
            if(!ni.length)DB.update('loading_assignments',a.id,{status:'Done'});else DB.update('loading_assignments',a.id,{obdIds:ni,obdNos:nn});
        });
    });
    var mis=[];ld.expected.forEach(function(e){if(e.scannedQty!==e.requiredQty)mis.push({obdNo:e.obdNo,material:e.material,ean:e.ean,expectedQty:e.requiredQty,scannedQty:e.scannedQty,diff:e.requiredQty-e.scannedQty});});
    ld.scannedItems.filter(function(s){return !s.inOBD;}).forEach(function(s){mis.push({obdNo:'—',material:s.material,ean:s.ean,expectedQty:0,scannedQty:s.qty,diff:-s.qty});});
    if(mis.length)DB.add('loading_data',{loadNo:loadNo,vehicleNo:ld.vehicleNo,mismatches:mis,createdAt:new Date().toISOString()});
    logAction('Loading','DONE',loadNo+' for '+ld.vehicleNo);
    addNotif('Loading '+loadNo+' completed by '+APP.currentUser.name,'success');
    showToast('Loading '+loadNo+' submitted!','success');closeModal();renderStartLoading();
}

function genLoadNo(){
    var now=new Date();var prefix='LOAD-'+now.getFullYear()+String(now.getMonth()+1).padStart(2,'0');
    var c1=DB.filter('loaded_vehicles',function(l){return(l.loadNo||'').indexOf(prefix)===0;}).length;
    var c2=DB.filter('loading_approvals',function(a){return(a.loadNo||'').indexOf(prefix)===0;}).length;
    return prefix+'-'+String(Math.max(c1,c2)+1).padStart(3,'0');
}

// --- Loading Done ---
function renderLoadingDone(){
   var all=DB.get('loaded_vehicles').filter(function(l){return l.type!=='pickandload';}).reverse();
    var approved=DB.filter('loading_approvals',function(a){return a.status==='Approved';});
    var h='<div class="section-header"><h2><i class="bx bx-check-circle"></i> Goods Issue Records ('+(all.length+approved.length)+')</h2>';
    h+='<div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportLoadingExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportLoadingPDF()"><i class="bx bx-file"></i> PDF</button></div></div>';
    h+='<div class="search-box"><i class="bx bx-search"></i><input type="text" id="loadDoneSearch" placeholder="Search LOAD-202601, vehicle, OBD..." oninput="searchLoadDone()"></div>';
    h+='<div id="loadDoneTable">'+buildLoadDoneTable(all,approved)+'</div>';
    setHtml(h);
}

function buildLoadDoneTable(loaded,approved){
    approved=approved||[];
    var items=[];
    loaded.forEach(function(l){items.push({t:'load',d:l});});
    approved.forEach(function(a){items.push({t:'appr',d:a});});
    items.sort(function(a,b){return new Date(b.d.loadedAt||b.d.createdAt)-new Date(a.d.loadedAt||a.d.createdAt);});
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Load No</th><th>Vehicle</th><th>Security</th><th>OBDs</th><th>Items</th><th>Status</th><th>By</th><th>Time</th><th>Actions</th></tr></thead><tbody>';
    if(!items.length)h+='<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px">No loaded vehicles</td></tr>';
    else items.forEach(function(it){
        var l=it.d;
        var sb=l.loadStatus==='Fully Loaded'?'<span class="badge badge-success">Full</span>':(l.loadStatus==='Partial'?'<span class="badge badge-warning">Partial</span>':'<span class="badge badge-accent">Approved</span>');
        var ot='';(l.obdNos||[]).forEach(function(n){ot+='<span class="badge badge-info" style="margin:1px;font-size:9px">'+esc(n)+'</span>';});
        var by=esc(l.loadedByName||l.requestedByName||'-');
        var tm=fmtDT(l.loadedAt||l.createdAt);
        var fn=it.t==='load'?'viewLoadDetail(\''+l.id+'\')':'viewApprovalDetail(\''+l.id+'\')';
        var dl=it.t==='load'?'deleteLoadedVehicle(\''+l.id+'\')':'deleteApprovalReq(\''+l.id+'\')';
        h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(l.loadNo)+'</td><td><strong>'+esc(l.vehicleNo)+'</strong></td><td style="font-size:11px">'+esc(l.securityNo||'-')+'</td><td>'+ot+'</td><td><span class="badge badge-info">'+(l.scannedItems||[]).length+'</span></td><td>'+sb+'</td><td style="font-size:11px">'+by+'</td><td style="font-size:10px;color:var(--text-muted)">'+tm+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" title="View" onclick="'+fn+'"><i class="bx bx-eye"></i></button><button class="btn btn-danger btn-sm" title="Delete" onclick="'+dl+'"><i class="bx bx-trash"></i></button></div></td></tr>';
    });
    h+='</tbody></table></div>';return h;
}

function searchLoadDone(){
    var q=(document.getElementById('loadDoneSearch').value||'').trim().toUpperCase();
    var all=DB.get('loaded_vehicles').slice().reverse();
    var approved=DB.filter('loading_approvals',function(a){return a.status==='Approved';});
    if(q){
        all=all.filter(function(l){return(l.loadNo||'').toUpperCase().indexOf(q)>-1||(l.vehicleNo||'').toUpperCase().indexOf(q)>-1||(l.obdNos||[]).join(',').toUpperCase().indexOf(q)>-1;});
        approved=approved.filter(function(a){return(a.loadNo||'').toUpperCase().indexOf(q)>-1||(a.vehicleNo||'').toUpperCase().indexOf(q)>-1;});
    }
    document.getElementById('loadDoneTable').innerHTML=buildLoadDoneTable(all,approved);
}

function viewLoadDetail(id){
    var l=DB.find('loaded_vehicles',id);if(!l)return;
    var h='<div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px">';
    h+='<div><strong>Load:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(l.loadNo)+'</span></div>';
    h+='<div><strong>Vehicle:</strong> '+esc(l.vehicleNo)+'</div>';
    h+='<div><strong>Security:</strong> '+esc(l.securityNo||'-')+'</div>';
    h+='<div><strong>Status:</strong> '+(l.loadStatus==='Fully Loaded'?'<span class="badge badge-success">Fully Loaded</span>':'<span class="badge badge-warning">Partial</span>')+'</div>';
    h+='<div><strong>By:</strong> '+esc(l.loadedByName)+'</div>';
    h+='<div><strong>Time:</strong> '+fmtDT(l.loadedAt)+'</div>';
    h+='</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Description</th><th>OBD</th><th>Qty</th><th>Status</th></tr></thead><tbody>';
    (l.scannedItems||[]).forEach(function(s,i){
        var rc=s.inOBD?'':'scan-row-red';
        var st=s.inOBD?'<span class="badge badge-success" style="font-size:9px">In OBD</span>':'<span class="badge badge-danger" style="font-size:9px">Not in OBD</span>';
        h+='<tr class="'+rc+'"><td>'+(i+1)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td>'+esc(s.material)+'</td><td style="font-size:11px;color:var(--text-muted)">'+esc(s.description)+'</td><td style="font-size:11px">'+esc(s.obdNo)+'</td><td><strong>'+s.qty+'</strong></td><td>'+st+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('Loading Detail — '+l.loadNo,h,'xl','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

function viewApprovalDetail(id){
    var a=DB.find('loading_approvals',id);if(!a)return;
    var h='<div style="margin-bottom:12px;padding:12px;background:var(--bg-secondary);border-radius:8px">';
    h+='<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px">';
    h+='<div><strong>Load:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(a.loadNo)+'</span></div>';
    h+='<div><strong>Vehicle:</strong> '+esc(a.vehicleNo)+'</div>';
    h+='<div><strong>Security:</strong> '+esc(a.securityNo||'-')+'</div>';
    h+='<div><span class="badge badge-success">Approved</span></div>';
    h+='</div>';
    h+='<div><strong>Requested By:</strong> '+esc(a.requestedByName)+' | <strong>Reason:</strong> <span style="color:var(--warning)">'+esc(a.reason)+'</span></div>';
    h+='</div>';
    // Expected vs Scanned
    if(a.expected){
        h+='<div class="card-title" style="margin-bottom:6px"><i class="bx bx-list-check"></i> Expected vs Scanned</div>';
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Diff</th></tr></thead><tbody>';
        (a.expected||[]).forEach(function(e){
            var d=e.requiredQty-e.scannedQty;var rc=d===0?'':'scan-row-red';
            h+='<tr class="'+rc+'"><td>'+esc(e.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(e.ean)+'</td><td>'+e.requiredQty+'</td><td><strong>'+(e.scannedQty||0)+'</strong></td><td class="'+(d===0?'qty-match':'qty-mismatch')+'">'+(d===0?'0':(d>0?'-'+d:'+'+Math.abs(d)))+'</td></tr>';
        });
        h+='</tbody></table></div>';
    }
    h+='<div class="table-wrapper" style="margin-top:10px"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Qty</th><th>In OBD</th></tr></thead><tbody>';
    (a.scannedItems||[]).forEach(function(s,i){
        h+='<tr class="'+(s.inOBD?'':'scan-row-red')+'"><td>'+(i+1)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td>'+esc(s.material)+'</td><td>'+s.qty+'</td><td>'+(s.inOBD?'<span class="badge badge-success" style="font-size:9px">Yes</span>':'<span class="badge badge-danger" style="font-size:9px">No</span>')+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('Approved Loading — '+a.loadNo,h,'xl','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

// --- Qty Mismatch ---
function renderQtyMismatch(){
    var shorts=DB.get('short_reports').slice().reverse();
    var loadMis=DB.get('loading_data').slice().reverse();
    var pending=DB.filter('loading_approvals',function(a){return a.status==='Pending';});
    var rejected=DB.filter('loading_approvals',function(a){return a.status==='Rejected';});
    var h='<div class="section-header"><h2><i class="bx bx-error-circle"></i> Quantity Differences</h2>';
    h+='<div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportMismatchExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportMismatchPDF()"><i class="bx bx-file"></i> PDF</button></div></div>';
    h+='<div class="search-box" style="margin-bottom:12px"><i class="bx bx-search"></i><input type="text" id="mismatchSearch" placeholder="Search LOAD-202601, vehicle, OBD..." oninput="searchMismatch()"></div>';
    h+='<div id="mismatchContent">'+buildMismatchHTML(shorts,loadMis,pending,rejected)+'</div>';
    setHtml(h);
}

function buildMismatchHTML(shorts,loadMis,pending,rejected){
    var h='';
    // Pending Approvals
    if(pending.length){
        h+='<div class="card"><div class="card-title"><i class="bx bx-time-five" style="color:var(--warning)"></i> Pending Approvals ('+pending.length+')</div>';
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Load No</th><th>Vehicle</th><th>OBD</th><th>By</th><th>Reason</th><th>Time</th><th>Actions</th></tr></thead><tbody>';
        pending.forEach(function(a){
            h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(a.loadNo)+'</td><td>'+esc(a.vehicleNo)+'</td><td>'+(a.obdNos||[]).map(function(n){return '<span class="badge badge-info" style="font-size:9px">'+esc(n)+'</span>';}).join(' ')+'</td><td>'+esc(a.requestedByName)+'</td><td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(a.reason)+'</td><td style="font-size:10px;color:var(--text-muted)">'+fmtDT(a.createdAt)+'</td>';
            h+='<td><div class="table-actions"><button class="btn btn-glass btn-sm" title="View" onclick="viewApprovalRequest(\''+a.id+'\')"><i class="bx bx-eye"></i></button>';
            if(chkAct('canApprove'))h+='<button class="btn btn-glass btn-sm" style="color:var(--success)" title="Approve" onclick="approveLoading(\''+a.id+'\')"><i class="bx bx-check"></i></button><button class="btn btn-danger btn-sm" title="Reject" onclick="rejectLoading(\''+a.id+'\')"><i class="bx bx-x"></i></button>';
            h+='<button class="btn btn-danger btn-sm" title="Delete" onclick="deleteApprovalReq(\''+a.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';
        });
        h+='</tbody></table></div></div>';
    }
    // Rejected
    if(rejected.length){
        h+='<div class="card" style="margin-top:12px"><div class="card-title"><i class="bx bx-x-circle" style="color:var(--danger)"></i> Rejected ('+rejected.length+')</div>';
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Load No</th><th>Vehicle</th><th>OBD</th><th>By</th><th>Reason</th><th>Time</th><th>Actions</th></tr></thead><tbody>';
        rejected.forEach(function(a){
            h+='<tr class="scan-row-red"><td style="font-family:var(--font-display);font-size:11px;color:var(--danger)">'+esc(a.loadNo)+'</td><td>'+esc(a.vehicleNo)+'</td><td>'+(a.obdNos||[]).map(function(n){return '<span class="badge badge-info" style="font-size:9px">'+esc(n)+'</span>';}).join(' ')+'</td><td>'+esc(a.requestedByName)+'</td><td style="font-size:11px">'+esc(a.reason)+'</td><td style="font-size:10px;color:var(--text-muted)">'+fmtDT(a.createdAt)+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" title="View" onclick="viewApprovalRequest(\''+a.id+'\')"><i class="bx bx-eye"></i></button><button class="btn btn-danger btn-sm" title="Delete" onclick="deleteApprovalReq(\''+a.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';
        });
        h+='</tbody></table></div></div>';
    }
    // Loading Mismatches
    h+='<div class="card" style="margin-top:12px"><div class="card-title"><i class="bx bx-error" style="color:var(--warning)"></i> Loading Mismatches ('+loadMis.length+')</div>';
    if(!loadMis.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">No loading mismatches</div>';
    else{
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Load No</th><th>Vehicle</th><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Diff</th><th>Actions</th></tr></thead><tbody>';
        loadMis.forEach(function(lm){
            (lm.mismatches||[]).forEach(function(m){
                h+='<tr class="scan-row-red"><td style="font-family:var(--font-display);font-size:10px;color:var(--accent)">'+esc(lm.loadNo)+'</td><td>'+esc(lm.vehicleNo)+'</td><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean||'')+'</td><td>'+m.expectedQty+'</td><td>'+m.scannedQty+'</td><td class="qty-mismatch">'+(m.diff>0?'-'+m.diff:'+'+Math.abs(m.diff))+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" title="View" onclick="viewMismatchDetail(\''+lm.id+'\')"><i class="bx bx-eye"></i></button><button class="btn btn-danger btn-sm" title="Delete" onclick="deleteLoadingMismatch(\''+lm.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';
            });
        });
        h+='</tbody></table></div>';
    }
    h+='</div>';
    // Unloading Shorts
    h+='<div class="card" style="margin-top:12px"><div class="card-title"><i class="bx bx-error" style="color:var(--danger)"></i> Unloading Shorts ('+shorts.length+')</div>';
    if(!shorts.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">No shorts</div>';
    else{
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Short No</th><th>Vehicle</th><th>Invoice</th><th>Material</th><th>EAN</th><th>Expected</th><th>Actual</th><th>Short</th><th>Posted</th><th>Actions</th></tr></thead><tbody>';
        shorts.forEach(function(s){
            (s.items||[]).forEach(function(it){
                h+='<tr class="scan-row-red"><td style="font-family:var(--font-display);font-size:10px">'+esc(s.shortNo)+'</td><td>'+esc(s.vehicleNo)+'</td><td>'+esc(it.invoiceNo)+'</td><td>'+esc(it.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(it.ean||'')+'</td><td>'+it.expected+'</td><td>'+it.scanned+'</td><td class="qty-mismatch">-'+it.short+'</td><td>'+(s.posted?'<span class="badge badge-success">Yes</span>':'<span class="badge badge-warning">No</span>')+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" title="View" onclick="viewShortDetail(\''+s.id+'\')"><i class="bx bx-eye"></i></button><button class="btn btn-danger btn-sm" title="Delete" onclick="deleteShortReport(\''+s.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';
            });
        });
        h+='</tbody></table></div>';
    }
    h+='</div>';return h;
}

function searchMismatch(){
    var q=(document.getElementById('mismatchSearch').value||'').trim().toUpperCase();
    var shorts=DB.get('short_reports').slice().reverse();
    var loadMis=DB.get('loading_data').slice().reverse();
    var pending=DB.filter('loading_approvals',function(a){return a.status==='Pending';});
    var rejected=DB.filter('loading_approvals',function(a){return a.status==='Rejected';});
    if(q){
        loadMis=loadMis.filter(function(lm){return(lm.loadNo||'').toUpperCase().indexOf(q)>-1||(lm.vehicleNo||'').toUpperCase().indexOf(q)>-1;});
        pending=pending.filter(function(a){return(a.loadNo||'').toUpperCase().indexOf(q)>-1||(a.vehicleNo||'').toUpperCase().indexOf(q)>-1;});
        rejected=rejected.filter(function(a){return(a.loadNo||'').toUpperCase().indexOf(q)>-1||(a.vehicleNo||'').toUpperCase().indexOf(q)>-1;});
        shorts=shorts.filter(function(s){return(s.shortNo||'').toUpperCase().indexOf(q)>-1||(s.vehicleNo||'').toUpperCase().indexOf(q)>-1;});
    }
    document.getElementById('mismatchContent').innerHTML=buildMismatchHTML(shorts,loadMis,pending,rejected);
}

function viewApprovalRequest(id){
    var a=DB.find('loading_approvals',id);if(!a)return;
    var h='<div style="margin-bottom:12px;padding:12px;background:var(--bg-secondary);border-radius:8px">';
    h+='<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px">';
    h+='<div><strong>Load:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(a.loadNo)+'</span></div>';
    h+='<div><strong>Vehicle:</strong> '+esc(a.vehicleNo)+'</div>';
    h+='<div><strong>Security:</strong> '+esc(a.securityNo||'-')+'</div>';
    h+='<div><span class="badge '+(a.status==='Pending'?'badge-warning':(a.status==='Approved'?'badge-success':'badge-danger'))+'">'+esc(a.status)+'</span></div>';
    h+='</div>';
    h+='<div><strong>By:</strong> '+esc(a.requestedByName)+' | <strong>Time:</strong> '+fmtDT(a.createdAt)+'</div>';
      h+='<div style="margin-top:4px"><strong>Reason:</strong> <span style="color:var(--warning)">'+esc(a.reason)+'</span></div>';
    if(a.status==='Rejected')h+='<div style="margin-top:4px"><strong>Rejection Reason:</strong> <span style="color:var(--danger)">'+esc(a.rejectReason||'Not provided')+'</span></div>';
    h+='</div>';
    if(a.expected){
        h+='<div class="card-title" style="margin-bottom:6px"><i class="bx bx-list-check"></i> Expected vs Scanned</div>';
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Diff</th></tr></thead><tbody>';
        (a.expected||[]).forEach(function(e){
            var d=e.requiredQty-e.scannedQty;h+='<tr class="'+(d===0?'':'scan-row-red')+'"><td>'+esc(e.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(e.ean)+'</td><td>'+e.requiredQty+'</td><td><strong>'+(e.scannedQty||0)+'</strong></td><td class="'+(d===0?'qty-match':'qty-mismatch')+'">'+(d===0?'0':(d>0?'-'+d:'+'+Math.abs(d)))+'</td></tr>';
        });
        h+='</tbody></table></div>';
    }
    h+='<div class="card-title" style="margin:10px 0 6px"><i class="bx bx-scan"></i> All Scanned ('+(a.scannedItems||[]).length+')</div>';
    h+='<div class="table-wrapper" style="max-height:200px;overflow-y:auto"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Qty</th><th>In OBD</th></tr></thead><tbody>';
    (a.scannedItems||[]).forEach(function(s,i){h+='<tr class="'+(s.inOBD?'':'scan-row-red')+'"><td>'+(i+1)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td>'+esc(s.material)+'</td><td>'+s.qty+'</td><td>'+(s.inOBD?'<span class="badge badge-success" style="font-size:9px">Yes</span>':'<span class="badge badge-danger" style="font-size:9px">No</span>')+'</td></tr>';});
    h+='</tbody></table></div>';
    var ft='<button class="btn btn-glass" onclick="closeModal()">Close</button>';
    if(a.status==='Pending'&&chkAct('canApprove'))ft+='<button class="btn btn-glass" style="background:var(--success);color:#000" onclick="approveLoading(\''+a.id+'\')"><i class="bx bx-check"></i> Approve</button><button class="btn btn-danger" onclick="rejectLoading(\''+a.id+'\')"><i class="bx bx-x"></i> Reject</button>';
    showModal('Approval — '+a.loadNo,h,'xl',ft);
}

function approveLoading(aid){
    if(!confirm('Approve this loading?'))return;
    var a=DB.find('loading_approvals',aid);if(!a)return;
    DB.update('loading_approvals',aid,{status:'Approved',approvedBy:APP.currentUser?APP.currentUser.id:'',approvedByName:APP.currentUser?APP.currentUser.name:'',approvedAt:new Date().toISOString()});
    DB.add('loaded_vehicles',{loadNo:a.loadNo,vehicleNo:a.vehicleNo,securityNo:a.securityNo,obdIds:a.obdIds,obdNos:a.obdNos,loadedBy:a.requestedBy,loadedByName:a.requestedByName,loadedAt:new Date().toISOString(),lastScannedAt:new Date().toISOString(),scannedItems:a.scannedItems,loadStatus:'Fully Loaded',mismatch:true,approvedById:aid});
    var mis=[];(a.expected||[]).forEach(function(e){if(e.scannedQty!==e.requiredQty)mis.push({obdNo:e.obdNo,material:e.material,ean:e.ean,expectedQty:e.requiredQty,scannedQty:e.scannedQty,diff:e.requiredQty-e.scannedQty});});
    (a.scannedItems||[]).filter(function(s){return !s.inOBD;}).forEach(function(s){mis.push({obdNo:'—',material:s.material,ean:s.ean,expectedQty:0,scannedQty:s.qty,diff:-s.qty});});
    if(mis.length)DB.add('loading_data',{loadNo:a.loadNo,vehicleNo:a.vehicleNo,mismatches:mis,createdAt:new Date().toISOString()});
    (a.obdIds||[]).forEach(function(oid){
        DB.filter('loading_assignments',function(as){return as.status==='Assigned'&&(as.obdIds||[]).indexOf(oid)>-1;}).forEach(function(as){
            var ni=(as.obdIds||[]).filter(function(o){return o!==oid;});var nn=(as.obdNos||[]).filter(function(n,i){return as.obdIds[i]!==oid;});
            if(!ni.length)DB.update('loading_assignments',as.id,{status:'Done'});else DB.update('loading_assignments',as.id,{obdIds:ni,obdNos:nn});
        });
    });
    addNotif('Loading '+a.loadNo+' approved','success');
    logAction('Loading','APPROVED',a.loadNo);
    showToast('Approved!','success');
    closeModal();
    renderQtyMismatch();
}

function rejectLoading(aid){
    if(!confirm('Reject this loading?'))return;
    var a=DB.find('loading_approvals',aid);if(!a)return;
    DB.update('loading_approvals',aid,{status:'Rejected',rejectedBy:APP.currentUser?APP.currentUser.id:'',rejectedByName:APP.currentUser?APP.currentUser.name:'',rejectedAt:new Date().toISOString()});
    addNotif('Loading '+a.loadNo+' rejected','error');
    logAction('Loading','REJECTED',a.loadNo+' rejected by '+APP.currentUser.name);
    showToast('Rejected','error');closeModal();renderQtyMismatch();
}

function viewMismatchDetail(id){
    var lm=DB.find('loading_data',id);if(!lm)return;
    var h='<div style="margin-bottom:12px"><strong>Load:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(lm.loadNo)+'</span> | <strong>Vehicle:</strong> '+esc(lm.vehicleNo)+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Diff</th></tr></thead><tbody>';
    (lm.mismatches||[]).forEach(function(m){
        var cls=m.diff===0?'':'scan-row-red';
        h+='<tr class="'+cls+'"><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean||'')+'</td><td>'+m.expectedQty+'</td><td><strong>'+m.scannedQty+'</strong></td><td class="'+(m.diff===0?'qty-match':'qty-mismatch')+'">'+(m.diff>0?'-'+m.diff:'+'+Math.abs(m.diff))+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('Mismatch Detail — '+lm.loadNo,h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

function viewShortDetail(id){
    var s=DB.find('short_reports',id);if(!s)return;
    var h='<div style="margin-bottom:12px"><strong>Short No:</strong> <span style="color:var(--danger);font-family:var(--font-display)">'+esc(s.shortNo)+'</span> | <strong>Vehicle:</strong> '+esc(s.vehicleNo)+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Invoice</th><th>Material</th><th>EAN</th><th>Expected</th><th>Actual</th><th>Short</th></tr></thead><tbody>';
    (s.items||[]).forEach(function(it){
        h+='<tr class="scan-row-red"><td>'+esc(it.invoiceNo)+'</td><td>'+esc(it.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(it.ean||'')+'</td><td>'+it.expected+'</td><td>'+it.scanned+'</td><td class="qty-mismatch">-'+it.short+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('Short Detail — '+s.shortNo,h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

function exportLoadingExcel(){
    var loaded=DB.get('loaded_vehicles');var approved=DB.filter('loading_approvals',function(a){return a.status==='Approved';});
    var rows=[['Load No','Vehicle','Security No','OBD','EAN','Material','Description','Qty','In OBD','Status','Loaded By','Time']];
    loaded.forEach(function(l){
        (l.scannedItems||[]).forEach(function(s){rows.push([l.loadNo,l.vehicleNo,l.securityNo||'',s.obdNo||'',s.ean,s.material,s.description||'',s.qty,s.inOBD?'Yes':'No',l.loadStatus,l.loadedByName,fmtDT(l.loadedAt)]);});
    });
    approved.forEach(function(a){
        (a.scannedItems||[]).forEach(function(s){rows.push([a.loadNo,a.vehicleNo,a.securityNo||'',s.obdNo||'',s.ean,s.material,s.description||'',s.qty,s.inOBD?'Yes':'No','Approved (Mismatch)',a.requestedByName,fmtDT(a.createdAt)]);});
    });
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Loading');XLSX.writeFile(wb,'Loading_Report_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}

function exportLoadingPDF(){
    var loaded=DB.get('loaded_vehicles');var approved=DB.filter('loading_approvals',function(a){return a.status==='Approved';});
    var rows=[];
    loaded.forEach(function(l){(l.scannedItems||[]).forEach(function(s){rows.push([l.loadNo,l.vehicleNo,l.securityNo||'',s.obdNo||'',s.ean,s.material,s.qty,s.inOBD?'Yes':'No',l.loadStatus,l.loadedByName,fmtDT(l.loadedAt)]);});});
    approved.forEach(function(a){(a.scannedItems||[]).forEach(function(s){rows.push([a.loadNo,a.vehicleNo,a.securityNo||'',s.obdNo||'',s.ean,s.material,s.qty,s.inOBD?'Yes':'No','Approved',a.requestedByName,fmtDT(a.createdAt)]);});});
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text('Loading Report — VIP INDUSTRIES MD20',14,15);pdf.setFontSize(8);pdf.text('Generated: '+fmtDT(new Date()),14,22);
    pdf.autoTable({startY:28,head:[['Load No','Vehicle','Security','OBD','EAN','Material','Qty','In OBD','Status','By','Time']],body:rows,theme:'grid',headStyles:{fillColor:[0,180,120]},styles:{fontSize:6}});
    pdf.save('Loading_Report_'+today()+'.pdf');showToast('PDF downloaded!','success');
}

function exportMismatchExcel(){
    var shorts=DB.get('short_reports');var loadMis=DB.get('loading_data');var pending=DB.filter('loading_approvals',function(a){return a.status==='Pending';});
    var rows=[['Type','Ref No','Vehicle','OBD','Material','EAN','Expected','Scanned','Diff','Status','Reason']];
    shorts.forEach(function(s){(s.items||[]).forEach(function(it){rows.push(['Unloading Short',s.shortNo,s.vehicleNo,it.invoiceNo,it.material,it.ean,it.expected,it.scanned,-it.short,s.posted?'Posted':'Unposted','']);});});
    loadMis.forEach(function(lm){(lm.mismatches||[]).forEach(function(m){rows.push(['Loading Mismatch',lm.loadNo,lm.vehicleNo,'',m.material,m.ean,m.expectedQty,m.scannedQty,m.diff,'Loaded','']);});});
    pending.forEach(function(a){(a.expected||[]).forEach(function(e){if(e.scannedQty!==e.requiredQty)rows.push(['Loading Approval',a.loadNo,a.vehicleNo,(a.obdNos||[]).join(','),e.material,e.ean,e.requiredQty,e.scannedQty,e.requiredQty-e.scannedQty,'Pending',a.reason]);});});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Mismatch');XLSX.writeFile(wb,'Qty_Mismatch_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}

function exportMismatchPDF(){
    var shorts=DB.get('short_reports');var loadMis=DB.get('loading_data');var pending=DB.filter('loading_approvals',function(a){return a.status==='Pending';});
    var rows=[];
    shorts.forEach(function(s){(s.items||[]).forEach(function(it){rows.push(['Unloading Short',s.shortNo,s.vehicleNo,it.invoiceNo,it.material,it.ean,it.expected,it.scanned,-it.short,s.posted?'Posted':'Pending']);});});
    loadMis.forEach(function(lm){(lm.mismatches||[]).forEach(function(m){rows.push(['Loading Mismatch',lm.loadNo,lm.vehicleNo,'',m.material,m.ean,m.expectedQty,m.scannedQty,m.diff,'Loaded']);});});
    pending.forEach(function(a){(a.expected||[]).forEach(function(e){if(e.scannedQty!==e.requiredQty)rows.push(['Loading Approval',a.loadNo,a.vehicleNo,(a.obdNos||[]).join(','),e.material,e.ean,e.requiredQty,e.scannedQty,e.requiredQty-e.scannedQty,'Pending']);});});
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text('Quantity Mismatch Report — VIP INDUSTRIES MD20',14,15);pdf.setFontSize(8);pdf.text('Generated: '+fmtDT(new Date()),14,22);
    pdf.autoTable({startY:28,head:[['Type','Ref No','Vehicle','OBD','Material','EAN','Expected','Scanned','Diff','Status']],body:rows,theme:'grid',headStyles:{fillColor:[220,38,38]},styles:{fontSize:6}});
    pdf.save('Qty_Mismatch_'+today()+'.pdf');showToast('PDF downloaded!','success');
}
        

// ==================== USER WORKING TIME ====================
function renderUserWorkingTime(){
    var logs=DB.get('user_work_log').slice().reverse();
    var h='<div class="section-header"><h2><i class="bx bx-time-five"></i> Resource Activity</h2>';
    h+='<div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportWorkTimeExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportWorkTimePDF()"><i class="bx bx-file"></i> PDF</button><button class="btn btn-danger" onclick="deleteWorkLog()"><i class="bx bx-trash"></i> Clear Log</button></div></div>';
    h+='<div class="form-row" style="margin-bottom:16px"><div class="form-group"><label>From Date</label><input type="date" id="wtFrom" class="form-input" value="'+today()+'"></div><div class="form-group"><label>To Date</label><input type="date" id="wtTo" class="form-input" value="'+today()+'"></div><div class="form-group"><label>User</label><select id="wtUser" class="form-input"><option value="">All Users</option>';
    var users=DB.get('users');
    users.forEach(function(u){h+='<option value="'+u.id+'">'+esc(u.name)+'</option>';});
    h+='</select></div><div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-glass" onclick="filterWorkTime()"><i class="bx bx-filter"></i> Filter</button></div></div>';
    h+='<div id="wtResult">'+buildWorkTimeTable(logs)+'</div>';
    setHtml(h);
}
function buildWorkTimeTable(logs){
    // Group by user + date
    var grouped={};
    logs.forEach(function(l){
        var dt=l.dateTime?l.dateTime.split('T')[0]:'Unknown';
        var key=l.userName+'|'+dt;
        if(!grouped[key])grouped[key]={user:l.userName,date:dt,activities:[]};
        grouped[key].activities.push({module:l.module,action:l.action,time:l.dateTime});
    });
    var keys=Object.keys(grouped);
    var h='';
    if(!keys.length){h='<div class="card"><div class="empty-state"><i class="bx bx-time"></i><p>No work logs</p></div></div>';return h;}
    keys.forEach(function(k){
        var g=grouped[k];
        var firstTime=g.activities[0]?g.activities[0].time:null;
        var lastTime=g.activities[g.activities.length-1]?g.activities[g.activities.length-1].time:null;
        var total=timeDiff(firstTime,lastTime);
        h+='<div class="time-card"><div class="tc-user"><i class="bx bx-user"></i> '+esc(g.user)+' <span style="font-size:11px;color:var(--text-muted);font-weight:400;margin-left:auto">'+esc(g.date)+'</span></div>';
        g.activities.forEach(function(a){
            h+='<div class="tc-activity"><span>'+esc(a.module)+' — '+esc(a.action)+'</span><span class="tc-time">'+fmtDT(a.time)+'</span></div>';
        });
        h+='<div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:12px"><span style="color:var(--text-muted)">Total Time</span><strong style="color:var(--accent)">'+total+'</strong></div>';
        h+='</div>';
    });
    return h;
}
function filterWorkTime(){
    var from=document.getElementById('wtFrom').value;
    var to=document.getElementById('wtTo').value;
    var userId=document.getElementById('wtUser').value;
    var logs=DB.get('user_work_log').slice().reverse();
    if(from)logs=logs.filter(function(l){return l.dateTime&&l.dateTime.split('T')[0]>=from;});
    if(to)logs=logs.filter(function(l){return l.dateTime&&l.dateTime.split('T')[0]<=to;});
    if(userId)logs=logs.filter(function(l){return l.userId===userId;});
    document.getElementById('wtResult').innerHTML=buildWorkTimeTable(logs);
}
function exportWorkTimeExcel(){
    var logs=DB.get('user_work_log').slice().reverse();var rows=[['User','Module','Action','Date Time']];
    logs.forEach(function(l){rows.push([l.userName,l.module,l.action,fmtDT(l.dateTime)]);});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'WorkTime');XLSX.writeFile(wb,'User_Work_Time_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}
function exportWorkTimePDF(){
    var logs=DB.get('user_work_log').slice().reverse();var rows=[];
    logs.forEach(function(l){rows.push([l.userName,l.module,l.action,fmtDT(l.dateTime)]);});
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text('User Working Time — VIP INDUSTRIES MD20',14,15);
    pdf.autoTable({startY:22,head:[['User','Module','Action','Date Time']],body:rows,theme:'grid',headStyles:{fillColor:[0,180,120]},styles:{fontSize:7}});
    pdf.save('User_Work_Time_'+today()+'.pdf');showToast('PDF downloaded!','success');
}

// ==================== ADMIN ====================

// --- Module & Action Definitions ---
var ALL_MODULES = [
    {id:'dashboard',label:'Home',group:'System'},
    {id:'inbound',label:'Goods Inward (Full Access)',group:'Inbound'},
    {id:'security-gate',label:'Gate Entry',group:'Inbound'},
    {id:'pending-vehicle',label:'Waiting Vehicles',group:'Inbound'},
    {id:'unloading-screen',label:'Unload Vehicle',group:'Inbound'},
    {id:'posting-pending',label:'Pending Approvals',group:'Inbound'},
    {id:'inbound-record',label:'Inward History',group:'Inbound'},
    {id:'unloading-stock',label:'Unloaded Stock',group:'Inbound'},
    {id:'putaway',label:'Putaway (Store Stock)',group:'Warehouse'},
    {id:'piv',label:'Stock Count',group:'Warehouse'},
    {id:'location',label:'Stock Overview',group:'Warehouse'},
    {id:'rack',label:'Bins & Racks',group:'Warehouse'},
    {id:'material',label:'Products',group:'Warehouse'},
    {id:'picking',label:'Order Picking',group:'Outbound'},
    {id:'loading',label:'Dispatch & Loading',group:'Outbound'},
    {id:'qty-mismatch',label:'Qty Difference Report',group:'Outbound'},
    {id:'loading-register',label:'Loading Register',group:'Outbound'},
    {id:'loc-requests',label:'Location Requests',group:'Outbound'},
    {id:'crossdock-report',label:'Cross-Dock Report',group:'Outbound'},
    {id:'user-time',label:'User Work Log',group:'System'},
    {id:'reports',label:'Reports',group:'System'},
    {id:'audit',label:'Activity History',group:'System'},
    {id:'admin',label:'Users & Permissions',group:'System'},
    {id:'settings',label:'Settings',group:'System'}
];

var ALL_ACTIONS = [
    {id:'canSecurityEntry',label:'Gate Entry Button',mod:'Gate Entry'},
    {id:'canUploadInvoice',label:'Upload Invoice Button',mod:'Waiting Vehicles'},
    {id:'canAssignVehicle',label:'Assign Vehicle Button',mod:'Waiting Vehicles'},
    {id:'canStartUnloading',label:'Start Unload Button',mod:'Unload Vehicle'},
    {id:'canPostVehicle',label:'Post Vehicle Button',mod:'Pending Approvals'},
    {id:'canApprove',label:'Approve / Reject Button',mod:'Pending Approvals'},
    {id:'canViewReports',label:'View Reports Button',mod:'Reports'},
    {id:'canPutaway',label:'Putaway Save Button',mod:'Putaway'},
    {id:'canPIV',label:'Stock Count Save Button',mod:'Stock Count'},
    {id:'canPick',label:'Picking Start Button',mod:'Order Picking'},
    {id:'canLoad',label:'Loading Start Button',mod:'Dispatch & Loading'},
    {id:'canAdmin',label:'Admin Panel Access',mod:'Users & Permissions'}
];
// ==================== BUTTON PERMISSIONS (module-wise, every button) ====================
// fns = onclick function names jo is permission se control honge (auto-enforcer inhe dhundta hai)
var BTN_PERMS=[
    // --- Goods Inward: Gate ---
    {mod:'Gate Entry',id:'inb.gate.create',label:'Create Gate Check-In',fns:['submitSecGate']},
    {mod:'Gate Entry',id:'inb.gate.reopen',label:'Re-open Vehicle',fns:['reopenGateVehicle']},
    // --- Goods Inward: Invoices ---
    {mod:'Inward Invoices',id:'inb.inv.upload',label:'Upload Invoice / Vehicle Excel',fns:['showUploadInvoice','saveSingleInvoice','addInvMatRow','showVehicleExcelUpload','processVehicleExcel']},
    // --- Goods Inward: Unloading & GR ---
    {mod:'Unloading',id:'inb.unload.assign',label:'Assign / Unassign Vehicle',fns:['showAssignUnloading','doAssignUnloading','unassignVehicle']},
    {mod:'Unloading',id:'inb.unload.start',label:'Start Unloading',fns:['startUnload']},
    {mod:'Unloading',id:'inb.unload.partial',label:'Partial Unload Controls',fns:['resumePartialUnload','discardPartialUnload','savePartialLoad']},
    {mod:'Unloading',id:'inb.grn.post',label:'Post Vehicle (GR)',fns:['postVehicle']},
    {mod:'Unloading',id:'inb.grn.approve',label:'Approve / Reject GR Posting',fns:['doRejectFromNotif']},
    {mod:'Unloading',id:'inb.report',label:'Inbound Reports & Export',fns:['showInboundReport','showUnloadReport','exportInboundExcel','exportInboundReportExcel','exportInboundReportPDF','downloadUnloadReportPDF']},
    // --- Putaway ---
    {mod:'Putaway',id:'put.add',label:'Add to Putaway List',fns:['addToPutawayList','removePutawayItem','resetPutawayScan']},
    {mod:'Putaway',id:'put.save',label:'Confirm Putaway (Save)',fns:['doPutaway','savePutawayScanList','savePutawayFromGRN']},
    {mod:'Putaway',id:'put.gr',label:'Putaway from GR Area',fns:['openGRPick','pickFromGR','removeGRPick']},
    {mod:'Putaway',id:'put.clear',label:'Clear Putaway List',fns:['clearPutawayList']},
    // --- PIV ---
    {mod:'PIV (Stock Count)',id:'piv.add',label:'Add PIV Count',fns:['showAddPIV']},
    {mod:'PIV (Stock Count)',id:'piv.save',label:'Save PIV Count',fns:['savePIV']},
    {mod:'PIV (Stock Count)',id:'piv.delete',label:'Delete PIV Record',fns:['deletePivRow']},
    // --- Stock Overview ---
    {mod:'Stock Overview',id:'loc.upload',label:'Bulk Upload Stock',fns:['showLocBulkUpload','processLocBulkUpload','downloadLocTemplate']},
    {mod:'Stock Overview',id:'loc.report',label:'Stock Report & PDF',fns:['showLocReport','downloadLocReportPDF']},
    {mod:'Stock Overview',id:'loc.export',label:'Export Stock Excel',fns:[]},
    {mod:'Stock Overview',id:'loc.delete',label:'Delete Stock Row',fns:['deleteLocRow']},
    // --- Bins & Racks ---
    {mod:'Bins & Racks',id:'rack.add',label:'Add Bin',fns:['showAddRack','saveRack']},
    {mod:'Bins & Racks',id:'rack.upload',label:'Bulk Upload Bins',fns:['showBulkBinUpload','processBulkBinUpload','downloadBinTemplate']},
    {mod:'Bins & Racks',id:'rack.delete',label:'Delete Bin',fns:['deleteRack']},
    // --- Products ---
    {mod:'Products',id:'mat.add',label:'Add Product',fns:['showAddMaterial','saveMaterial']},
    {mod:'Products',id:'mat.edit',label:'Edit Product',fns:['editMaterial','updateMaterial']},
    {mod:'Products',id:'mat.delete',label:'Delete Product',fns:['deleteMaterial']},
    {mod:'Products',id:'mat.upload',label:'Bulk Upload Products',fns:['showBulkUploadMaterial','showBulkUpload','processBulkFile','executeBulkUpload','downloadMaterialTemplate']},
    {mod:'Products',id:'mat.export',label:'Export Products Excel',fns:[]},
    // --- Order Picking ---
    {mod:'Order Picking',id:'pick.obd.upload',label:'Upload OBD File',fns:['processOBDUpload']},
    {mod:'Order Picking',id:'pick.assign',label:'Assign / Unassign Picking',fns:['doPickingAssign','unassignPicking','pqMove']},
    {mod:'Order Picking',id:'pick.urgent',label:'Urgent / Top-Up Controls',fns:['pqToggleUrgent','makeUrgentAssign','topUpAssign','topUpAll']},
    {mod:'Order Picking',id:'pick.confirm',label:'Confirm & Submit Picking',fns:['submitPicking','doPickFromLock']},
    {mod:'Order Picking',id:'pick.notfound',label:'Not-Found Request',fns:['openNotFound','submitNotFound','requestLocationForMaterial']},
    {mod:'Order Picking',id:'pick.short',label:'Mark Material Short',fns:['markLocShort']},
    {mod:'Order Picking',id:'pick.locreq',label:'Assign Location Requests (Admin)',fns:['openLocRequest','assignLocRequest','submitLocationRequest']},
    {mod:'Order Picking',id:'pick.reverse',label:'Reverse Picking',fns:['openReverseModal','doReversePicking']},
    {mod:'Order Picking',id:'pick.list',label:'Download Pick List',fns:['downloadPickList']},
    {mod:'Order Picking',id:'pick.report',label:'Picking Reports & Export',fns:['exportCrossdock','exportCrossdockPDF','exportPickingDoneExcel','exportPickingDonePDF']},
    // --- Pick & Load (Combined) ---
    {mod:'Pick & Load',id:'pick.pwl.assign',label:'PWL: Assign',fns:['openPWLSetup','doPWLAssign','unassignPWL']},
    {mod:'Pick & Load',id:'pick.pwl.execute',label:'PWL: Pick (Execute)',fns:['openPWLPicking','resumePWLPicking','continuePWL','doPWLPick','savePWLPartialPick','removePWLScanItem','openPWLManualEntry','addPWLManualItem','showPWLPickLocs']},
    {mod:'Pick & Load',id:'pick.pwl.load',label:'PWL: Load & Submit',fns:['goToPWLLoading','submitPWLLoading','savePWLPartialLoad']},
    {mod:'Pick & Load',id:'pick.pwl.approve',label:'PWL: Request Approval',fns:['requestPWLApproval']},
    // --- Dispatch & Loading ---
    {mod:'Loading',id:'load.assign',label:'Assign / Unassign Loading',fns:['doLoadingAssign','unassignLoading']},
    {mod:'Loading',id:'load.execute',label:'Execute Loading',fns:['startMultiLoading','continueLoading','removeLoadScanItem','submitFinalLoad']},
    {mod:'Loading',id:'load.manual',label:'Manual Load Entry',fns:['showManualLoadEntry','addManualLoadItem']},
    {mod:'Loading',id:'load.approve',label:'Approve / Reject Loading',fns:['approveLoading','rejectLoading','requestLoadApproval']},
    {mod:'Loading',id:'load.gateout',label:'Gate Out / Dispatch Vehicle',fns:['gateOutVehicle']},
    {mod:'Loading',id:'load.report',label:'Loading Reports & Export',fns:['showLoadingReport','exportLoadingExcel','exportLoadingPDF']},
    {mod:'Loading',id:'load.register',label:'Loading Register Export',fns:['exportLoadingRegister','exportLoadingRegisterPDF']},
    {mod:'Loading',id:'load.mismatch',label:'Qty Difference / SE Report & Export',fns:['showSEReport','exportMismatchExcel','exportMismatchPDF']},
    // --- Reports ---
    {mod:'Reports',id:'rep.run',label:'Run / Generate Reports',fns:['showGlobalReport','generateGlobalReport','runReport','showExportAll']},
    {mod:'Reports',id:'rep.export',label:'Export Reports (Excel/PDF)',fns:['exportGlobalExcel','exportGlobalPDF','exportReportExcel','exportReportPDF']},
    // --- Users & Permissions ---
    {mod:'User Admin',id:'adm.user.add',label:'Add User',fns:['showAddUser','saveUser']},
    {mod:'User Admin',id:'adm.user.edit',label:'Edit User & Permissions',fns:['editUser','updateUser']},
    {mod:'User Admin',id:'adm.user.delete',label:'Delete User',fns:['deleteUser']},
    // --- Settings ---
    {mod:'Settings',id:'set.manage',label:'Change Settings / Customize',fns:['setAccentColor','showFrontCustomize']},
    {mod:'Settings',id:'set.wipe',label:'Danger: Clear All Data / Reseed',fns:['clearAllData','reseedData']},
    // --- History & Logs ---
    {mod:'Logs',id:'aud.export',label:'Export Audit Log',fns:['exportAuditExcel']},
    {mod:'Logs',id:'wt.export',label:'Export Work Log',fns:['exportWorkTimeExcel','exportWorkTimePDF']}
];
// --- AUTO BUTTON ENFORCER: onclick function name se permission check ---
var _FN_PERM={};
BTN_PERMS.forEach(function(p){p.fns.forEach(function(f){_FN_PERM[f]=p.id;});});
var _EXPORT_ARG_PERM={'location_master':'loc.export','material_master':'mat.export'};
function enforceBtnPerms(){
    if(!APP.currentUser||APP.currentUser.role==='Super Admin')return;
    try{
        var btns=document.querySelectorAll('button[onclick], a[onclick], [onclick].btn');
        for(var i=0;i<btns.length;i++){
            var b=btns[i];
            var oc=b.getAttribute('onclick')||'';
            var m=oc.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            if(!m)continue;
            var fn=m[1];
            if(fn==='exportTableExcel'){
                var t=oc.match(/exportTableExcel\(\s*['"]([^'"]+)['"]/);
                if(t){var ep=_EXPORT_ARG_PERM[t[1]];if(ep&&!canBtn(ep))b.style.display='none';}
                continue;
            }
            var pid=_FN_PERM[fn];
            if(pid&&!canBtn(pid))b.style.display='none';
        }
    }catch(e){}
}
try{
    var _permMO=new MutationObserver(function(){enforceBtnPerms();});
    _permMO.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['onclick','style']});
}catch(e){}

var ROLE_DEFAULTS = {
    'Admin':{modules:['all'],actions:{}},
    'Manager':{modules:['dashboard','inbound','pending-vehicle','posting-pending','inbound-record','unloading-stock','reports','audit','picking','loading','user-time'],actions:{'inb.report':true,'inb.grn.approve':true,'inb.unload.assign':true,'load.assign':true,'load.execute':true,'load.approve':true,'load.report':true,'load.register':true,'load.mismatch':true,'pick.assign':true,'pick.confirm':true,'pick.report':true,'pick.list':true,'rep.run':true,'rep.export':true,'aud.export':true,'wt.export':true}},
    'DEO':{modules:['inbound','pending-vehicle'],actions:{'inb.inv.upload':true,'inb.unload.assign':true}},
    'Security':{modules:['inbound','loading'],actions:{'inb.gate.create':true,'inb.gate.reopen':true,'load.gateout':true}},
    'Unloader':{modules:['inbound'],actions:{'inb.unload.start':true,'inb.unload.partial':true,'inb.grn.post':true}},
    'Picker':{modules:['picking'],actions:{'pick.confirm':true,'pick.notfound':true,'pick.short':true,'pick.list':true,'pick.pwl.execute':true}},
    'Loader':{modules:['loading'],actions:{'load.execute':true,'load.manual':true}}
};

// --- Main Admin Page ---
function renderAdmin(){
    var users=DB.get('users');
    var h='<div class="section-header"><h2><i class="bx bx-user-detail"></i> User Management</h2>';
    h+='<button class="btn btn-glass" onclick="showAddUser()"><i class="bx bx-user-plus"></i> Add User</button></div>';

    // Role summary
    var roleC={};
    users.forEach(function(u){var r=u.role||'Unknown';roleC[r]=(roleC[r]||0)+1;});
    h+='<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
    for(var rk in roleC){
        h+='<div style="padding:10px 16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center;min-width:90px"><div style="font-size:20px;font-weight:800;color:var(--accent)">'+roleC[rk]+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">'+esc(rk)+'S</div></div>';
    }
    h+='</div>';

    // Users Table
    h+='<div class="card"><div class="card-title">All Users ('+users.length+')</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Name</th><th>Username</th><th>Role</th><th>Modules</th><th>Buttons</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    if(!users.length)h+='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">No users</td></tr>';
    users.forEach(function(u,i){
        var mods=(u.permissions&&u.permissions.modules)?u.permissions.modules:[];
        var acts=(u.permissions&&u.permissions.actions)?u.permissions.actions:{};
        var isAll=mods.indexOf('all')>-1;
        var modStr=isAll?'<span class="badge badge-accent">ALL</span>':'<span class="badge badge-info">'+mods.length+'</span>';
        var actCount=0;for(var ak in acts){if(acts[ak])actCount++;}
        var actStr='<span class="badge '+(actCount>6?'badge-success':'badge-warning')+'">'+actCount+'/'+ALL_ACTIONS.length+'</span>';
        var sessions=DB.filter('user_sessions',function(s){return s.userId===u.id&&!s.logoutTime;});
        var statusBadge=sessions.length>0?'<span class="badge badge-success"><span class="status-dot green"></span> Online</span>':'<span class="badge" style="background:var(--bg-secondary);color:var(--text-muted)"><span class="status-dot" style="background:var(--text-muted)"></span> Offline</span>';

        h+='<tr><td>'+(i+1)+'</td>';
        h+='<td><strong>'+esc(u.name)+'</strong></td>';
        h+='<td style="font-family:var(--font-display);font-size:12px;color:var(--accent)">'+esc(u.username)+'</td>';
        h+='<td><span class="badge badge-warning">'+esc(u.role)+'</span></td>';
        h+='<td>'+modStr+'</td>';
        h+='<td>'+actStr+'</td>';
        h+='<td>'+statusBadge+'</td>';
        h+='<td><div class="table-actions">';
        if(u.role==='Super Admin'){
            h+='<span style="font-size:10px;color:var(--text-muted)"><i class="bx bx-lock"></i> Locked</span>';
        } else {
            h+='<button class="btn btn-glass btn-sm" onclick="editUser(\''+u.id+'\')"><i class="bx bx-edit"></i></button>';
            h+='<button class="btn btn-danger btn-sm" onclick="deleteUser(\''+u.id+'\')"><i class="bx bx-trash"></i></button>';
        }
        h+='</div></td></tr>';
    });
    h+='</tbody></table></div></div>';
    setHtml(h);
}

// --- Permission Builder HTML ---
function buildPermHTML(prefix,isSuperAdmin,currentPerms){
    var cp=currentPerms||{modules:[],actions:{}};
    cp=upgPerms(cp);
    var cMods=cp.modules||[];
    var cActs=cp.actions||{};
    var isAll=cMods.indexOf('all')>-1;
    var disabled=isSuperAdmin?'disabled':'';
    var h='';

    // === MODULE VISIBILITY ===
    h+='<div style="margin-bottom:16px">';
    h+='<div class="card-title" style="margin-bottom:8px"><i class="bx bx-layout" style="color:var(--accent)"></i> Module Visibility <span style="font-size:10px;color:var(--text-muted);font-weight:normal">(Which menus appear in the sidebar)</span></div>';
    h+='<div style="margin-bottom:8px"><label class="perm-item" style="border-color:var(--accent);background:var(--accent-dim);cursor:pointer"><input type="checkbox" id="'+prefix+'_allMods" '+(isAll?'checked':'')+' '+disabled+' onchange="toggleAllMods(\''+prefix+'\')"> <strong style="color:var(--accent)">ALL MODULES</strong></label></div>';
    var groups={};
    ALL_MODULES.forEach(function(m){if(!groups[m.group])groups[m.group]=[];groups[m.group].push(m);});
    for(var gk in groups){
        h+='<div style="font-size:10px;color:var(--text-muted);letter-spacing:1px;margin:10px 0 4px;padding-left:8px;border-left:2px solid var(--border)">'+gk.toUpperCase()+'</div>';
        h+='<div class="perm-grid">';
        groups[gk].forEach(function(m){
            var chk=isAll||cMods.indexOf(m.id)>-1;
            h+='<label class="perm-item"><input type="checkbox" class="'+prefix+'_modCb" value="'+m.id+'" '+(chk?'checked':'')+' '+disabled+' '+(isAll?'disabled':'')+'> '+m.label+'</label>';
        });
        h+='</div>';
    }
    h+='</div>';

    // === BUTTON ACCESS (module-wise, every button) ===
    h+='<div>';
    h+='<div class="card-title" style="margin-bottom:8px"><i class="bx bx-shield" style="color:var(--warning)"></i> Button Access <span style="font-size:10px;color:var(--text-muted);font-weight:normal">(Which buttons the user can click — module-wise)</span></div>';
    h+='<div class="search-box" style="margin-bottom:10px"><i class="bx bx-search"></i><input type="text" id="'+prefix+'_permSearch" placeholder="Search button — delete, upload, approve..." oninput="filterPermList(\''+prefix+'\')"></div>';
    h+='<div style="margin-bottom:10px"><label class="perm-item" style="border-color:#E9730C;background:#FFF8D6;cursor:pointer"><input type="checkbox" onchange="toggleAllBtns(\''+prefix+'\',this.checked)"> <strong style="color:#E9730C">ALL BUTTONS</strong></label></div>';
    var mods=[];var seen={};
    BTN_PERMS.forEach(function(p){if(!seen[p.mod]){seen[p.mod]=true;mods.push(p.mod);}});
    mods.forEach(function(m,gi){
        h+='<div style="margin:10px 0 4px;display:flex;align-items:center;gap:8px;border-left:2px solid var(--warning);padding-left:8px">';
        h+='<input type="checkbox" onchange="togglePermGroup(\''+prefix+'\',\''+gi+'\',this.checked)" title="Grant ALL buttons of this module"> <span style="font-size:10px;color:var(--text-muted);letter-spacing:1px;font-weight:700">'+m.toUpperCase()+'</span></div>';
        h+='<div class="perm-grid" data-pgrp="'+gi+'">';
        BTN_PERMS.filter(function(p){return p.mod===m;}).forEach(function(p){
            var chk=isAll||cActs[p.id]===true;
            h+='<label class="perm-item" style="font-size:11px" data-plabel="'+esc((p.label+' '+p.id).toLowerCase())+'"><input type="checkbox" class="'+prefix+'_actCb" value="'+p.id+'" '+(chk?'checked':'')+' '+disabled+' '+(isAll?'disabled':'')+'> '+p.label+'</label>';
        });
        h+='</div>';
    });
    h+='</div>';
    return h;
}

function toggleAllBtns(prefix,on){
    var actCbs=document.querySelectorAll('.'+prefix+'_actCb');
    for(var i=0;i<actCbs.length;i++){actCbs[i].checked=on;actCbs[i].disabled=on;}
}
function togglePermGroup(prefix,gi,on){
    var box=document.querySelector('.perm-grid[data-pgrp="'+gi+'"]');
    if(!box)return;
    var cbs=box.querySelectorAll('.'+prefix+'_actCb');
    for(var i=0;i<cbs.length;i++){if(!cbs[i].disabled)cbs[i].checked=on;}
}
function filterPermList(prefix){
    var q=(document.getElementById(prefix+'_permSearch').value||'').trim().toLowerCase();
    var labels=document.querySelectorAll('#modalContainer label.perm-item[data-plabel]');
    for(var i=0;i<labels.length;i++){
        var l=labels[i];
        l.style.display=(!q||l.getAttribute('data-plabel').indexOf(q)>-1)?'':'none';
    }
}

function toggleAllMods(prefix){
    var isAll=document.getElementById(prefix+'_allMods').checked;
    var modCbs=document.querySelectorAll('.'+prefix+'_modCb');
    var actCbs=document.querySelectorAll('.'+prefix+'_actCb');
    for(var i=0;i<modCbs.length;i++){modCbs[i].checked=isAll;modCbs[i].disabled=isAll;}
    for(var j=0;j<actCbs.length;j++){actCbs[j].checked=isAll;actCbs[j].disabled=isAll;}
}

function readPermHTML(prefix){
    var isAll=document.getElementById(prefix+'_allMods').checked;
    var modules=[];
    var actions={};
    if(isAll){
        modules=['all'];
        BTN_PERMS.forEach(function(p){actions[p.id]=true;});
    } else {
        var modCbs=document.querySelectorAll('.'+prefix+'_modCb');
        for(var i=0;i<modCbs.length;i++){if(modCbs[i].checked)modules.push(modCbs[i].value);}
        var actCbs=document.querySelectorAll('.'+prefix+'_actCb');
        for(var j=0;j<actCbs.length;j++){actions[actCbs[j].value]=actCbs[j].checked;}
    }
    return {modules:modules,actions:actions};
}

// --- Add User ---
function showAddUser(){
    var h='<div class="form-row">';
    h+='<div class="form-group"><label>Full Name <span class="req">*</span></label><input type="text" id="auName" class="form-input" placeholder="e.g. Rahul Sharma"></div>';
    h+='<div class="form-group"><label>Username <span class="req">*</span></label><input type="text" id="auUser" class="form-input" placeholder="e.g. rahul" style="text-transform:lowercase"></div>';
    h+='</div>';
    h+='<div class="form-row">';
    h+='<div class="form-group"><label>Password <span class="req">*</span></label><input type="text" id="auPass" class="form-input" placeholder="Min 4 characters"></div>';
    h+='<div class="form-group"><label>Role <span class="req">*</span></label>';
    h+='<select id="auRole" class="form-input" onchange="applyRoleDefaults(\'au\')">';
    h+='<option value="">-- Select Role --</option>';
    var roles=['Admin','Manager','DEO','Security','Unloader','Picker','Loader'];
    roles.forEach(function(r){h+='<option value="'+r+'">'+r+'</option>';});
    h+='</select></div></div>';
    h+='<div id="auRoleMsg" style="font-size:11px;color:var(--text-muted);margin-bottom:10px"></div>';
    h+='<hr class="cyber-line" style="margin:14px 0">';
    h+=buildPermHTML('au',false,null);

    showModal('Add New User',h,'xl',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="saveUser()"><i class="bx bx-check"></i> Create User</button>');
}

function applyRoleDefaults(prefix){
    var role=document.getElementById(prefix+'Role').value;
    var msg=document.getElementById(prefix+'RoleMsg');
    var defs=ROLE_DEFAULTS[role];
    if(!defs){msg.innerHTML='';return;}

    // Show role description
    var descs={
        'Admin':'Full access except Security Gate entry. Can manage users.',
        'Manager':'View + Assign vehicles, View reports, Picking & Loading oversight.',
        'DEO':'Inbound only — upload invoices, assign vehicles.',
        'Security':'Security Gate entry only.',
        'Unloader':'Unloading Screen only — scan & submit.',
        'Picker':'Picking module only.',
        'Loader':'Loading module only.'
    };
    msg.innerHTML='<div style="background:var(--accent-dim);padding:8px 12px;border-radius:var(--radius-sm);font-size:11px;color:var(--accent)"><i class="bx bx-info-circle"></i> '+descs[role]+'</div>';

    // Apply defaults to checkboxes
    var isAll=defs.modules.indexOf('all')>-1;
    var allModCb=document.getElementById(prefix+'_allMods');
    if(allModCb){allModCb.checked=isAll;}
    var modCbs=document.querySelectorAll('.'+prefix+'_modCb');
    for(var i=0;i<modCbs.length;i++){
        var chk=isAll||defs.modules.indexOf(modCbs[i].value)>-1;
        modCbs[i].checked=chk;
        modCbs[i].disabled=isAll;
    }
    var actCbs=document.querySelectorAll('.'+prefix+'_actCb');
    for(var j=0;j<actCbs.length;j++){
        var aChk=isAll||defs.actions[actCbs[j].value]===true;
        actCbs[j].checked=aChk;
        actCbs[j].disabled=isAll;
    }
}

async function saveUser(){
    var nm=document.getElementById('auName').value.trim();
    var un=document.getElementById('auUser').value.trim().toLowerCase();
    var pw=document.getElementById('auPass').value.trim();
    var rl=document.getElementById('auRole').value;
    if(!nm||!un||!pw||!rl){showToast('All fields required','error');return;}
    if(pw.length<4){showToast('Password min 4 characters','error');return;}
    var exists=DB.filter('users',function(u){return u.username===un;});
    if(exists.length>0){showToast('Username already exists!','error');return;}
    var perms=readPermHTML('au');

    // Supabase Auth me user banao
    var rr=await supabaseClient.rpc('wms_upsert_auth_user',{p_username:un,p_password:pw});
    if(rr.error){showToast('Auth error: '+rr.error.message,'error');return;}

    DB.add('users',{username:un,password:pw,name:nm,role:rl,permissions:perms});
    logAction('Admin','ADD_USER','User '+un+' ('+rl+') created');
    showToast('User created: '+nm,'success');
    closeModal();renderAdmin();
}

// --- Edit User ---
function editUser(id){
    var u=DB.find('users',id);if(!u)return;
    var h='<div style="background:var(--accent-dim);padding:10px;border-radius:var(--radius-sm);margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><div><strong style="color:var(--accent)">'+esc(u.name)+'</strong> <span style="font-family:var(--font-display);font-size:12px;color:var(--text-muted)">('+esc(u.username)+')</span></div><span class="badge badge-warning">'+esc(u.role)+'</span></div>';

    h+='<div class="form-row">';
    h+='<div class="form-group"><label>Full Name <span class="req">*</span></label><input type="text" id="euName" class="form-input" value="'+esc(u.name)+'"></div>';
    h+='<div class="form-group"><label>Role <span class="req">*</span></label>';
    h+='<select id="euRole" class="form-input" onchange="applyRoleDefaults(\'eu\')">';
    var roles=['Admin','Manager','DEO','Security','Unloader','Picker','Loader'];
    roles.forEach(function(r){h+='<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+r+'</option>';});
    h+='</select></div></div>';
    h+='<div class="form-group"><label>New Password <span style="font-size:10px;color:var(--text-muted)">(blank = keep current)</span></label><input type="text" id="euPass" class="form-input" placeholder="New password..."></div>';
    h+='<div id="euRoleMsg" style="font-size:11px;color:var(--text-muted);margin-bottom:10px"></div>';
    h+='<hr class="cyber-line" style="margin:14px 0">';
    h+=buildPermHTML('eu',false,u.permissions);

    showModal('Edit User — '+u.name,h,'xl',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="updateUser(\''+id+'\')"><i class="bx bx-check"></i> Update</button>');
}

async function updateUser(id){
    var nm=document.getElementById('euName').value.trim();
    var rl=document.getElementById('euRole').value;
    var pw=document.getElementById('euPass').value.trim();
    if(!nm||!rl){showToast('Name and Role required','error');return;}
    if(pw&&pw.length<4){showToast('Password min 4 characters','error');return;}

    // Password badla hai to Supabase Auth me bhi badlo
    if(pw&&pw.length>=4){
        var eu=DB.find('users',id);
        var rr=await supabaseClient.rpc('wms_upsert_auth_user',{p_username:eu.username,p_password:pw});
        if(rr.error){showToast('Auth error: '+rr.error.message,'error');return;}
    }

    var up={name:nm,role:rl,permissions:readPermHTML('eu')};
    if(pw&&pw.length>=4)up.password=pw;
    DB.update('users',id,up);
    logAction('Admin','EDIT_USER','User '+id+' updated to '+rl);
    showToast('User updated!','success');
    closeModal();renderAdmin();
}

// --- Delete User ---
async function deleteUser(id){
    var u=DB.find('users',id);if(!u)return;
    if(u.id===APP.currentUser.id){showToast('Cannot delete yourself!','error');return;}
    if(!confirm('Delete user "'+u.name+'" ('+u.username+')?'))return;

    // Supabase Auth se bhi hatao
    await supabaseClient.rpc('wms_delete_auth_user',{p_username:u.username});

    DB.remove('users',id);
    logAction('Admin','DELETE_USER','User '+u.name+' deleted');
    showToast('User deleted','success');
    renderAdmin();
}

// ==================== SETTINGS (10 UI Options) ====================
function renderSettings(){
    var h='<div class="section-header"><h2><i class="bx bx-cog"></i> Settings</h2></div>';
    h+='<div class="settings-grid">';
    h+='<div class="settings-card" onclick="toggleTheme()"><div class="sc-icon" style="background:var(--accent-dim);color:var(--accent)"><i class="bx bx-moon"></i></div><div class="sc-title">Theme Toggle</div><div class="sc-desc">Switch between Dark and Light mode. Current: '+APP.theme+'</div></div>';
    h+='<div class="settings-card" onclick="clearAllData()"><div class="sc-icon" style="background:var(--danger-dim);color:var(--danger)"><i class="bx bx-trash"></i></div><div class="sc-title">Clear All Data</div><div class="sc-desc">Reset entire system. This cannot be undone.</div></div>';
    h+='<div class="settings-card" onclick="reseedData()"><div class="sc-icon" style="background:var(--warning-dim);color:var(--warning)"><i class="bx bx-refresh"></i></div><div class="sc-title">Re-seed Sample Data</div><div class="sc-desc">Add sample vehicles, invoices, materials again.</div></div>';
    h+='<div class="settings-card" onclick="showExportAll()"><div class="sc-icon" style="background:var(--info-dim);color:var(--info)"><i class="bx bx-download"></i></div><div class="sc-title">Export All Data</div><div class="sc-desc">Download complete database as Excel backup.</div></div>';
    h+='<div class="settings-card" onclick="showGlobalReport()"><div class="sc-icon" style="background:var(--accent-dim);color:var(--accent)"><i class="bx bx-bar-chart-alt-2"></i></div><div class="sc-title">Global Report</div><div class="sc-desc">Complete warehouse report with date filter.</div></div>';
    h+='<div class="settings-card" onclick="showInboundReport()"><div class="sc-icon" style="background:var(--accent2-dim);color:var(--accent2)"><i class="bx bxs-truck"></i></div><div class="sc-title">Inbound Report</div><div class="sc-desc">All inbound vehicles — loaded or not.</div></div>';
    h+='<div class="settings-card" onclick="showLoadingReport()"><div class="sc-icon" style="background:var(--info-dim);color:var(--info)"><i class="bx bxs-truck"></i></div><div class="sc-title">Loading Report</div><div class="sc-desc">All loading vehicles report.</div></div>';
    h+='<div class="settings-card" onclick="showChangePassword()"><div class="sc-icon" style="background:var(--warning-dim);color:var(--warning)"><i class="bx bx-lock"></i></div><div class="sc-title">Change Password</div><div class="sc-desc">Update your login password.</div></div>';
    h+='<div class="settings-card" onclick="showFrontCustomize()"><div class="sc-icon" style="background:var(--accent-dim);color:var(--accent)"><i class="bx bx-palette"></i></div><div class="sc-title">Front Customization</div><div class="sc-desc">Change accent color and UI style.</div></div>';
    h+='<div class="settings-card" onclick="showSessionInfo()"><div class="sc-icon" style="background:var(--info-dim);color:var(--info)"><i class="bx bx-info-circle"></i></div><div class="sc-title">Session Info</div><div class="sc-desc">View current session and system details.</div></div>';
    h+='</div>';
    setHtml(h);
}
function toggleTheme(){
    APP.theme=APP.theme==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',APP.theme);
    localStorage.setItem('wms_theme',APP.theme);
    var icon=document.getElementById('themeToggle').querySelector('i');
    icon.className=APP.theme==='dark'?'bx bx-moon':'bx bx-sun';
    showToast('Theme: '+APP.theme,'success');renderSettings();
}
function clearAllData(){
    if(!confirm('WARNING: This will delete ALL data. Continue?'))return;
    if(!confirm('Are you REALLY sure? This cannot be undone!'))return;
    var keys=Object.keys(localStorage).filter(function(k){return k.indexOf('wms_')===0;});
    keys.forEach(function(k){localStorage.removeItem(k);});
    showToast('All data cleared! Reloading...','warning');
    setTimeout(function(){location.reload();},1500);
}
function reseedData(){seedData();showToast('Sample data re-seeded!','success');renderSettings();}
async function showExportAll(){
    await sbPullFull('location_master');await sbPullFull('material_master');   // master tables bhi backup me aayengi
    var tables=['users','vehicles','invoices','invoice_materials','location_master','material_master','rack_master','obd_data','picking_done','loaded_vehicles','grn_records','short_reports','unloading_records','audit_log'];
    var wb=XLSX.utils.book_new();
    tables.forEach(function(t){
        var data=DB.get(t);
        if(!data.length)return;
        var rows=[];
        var keys=Object.keys(data[0]);
        rows.push(keys);
        data.forEach(function(d){rows.push(keys.map(function(k){return d[k]===null||d[k]===undefined?'':String(d[k]);}));});
        var ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,t.substring(0,31));
    });
    XLSX.writeFile(wb,'WMS_Full_Backup_'+today()+'.xlsx');showToast('Full backup downloaded!','success');
}
function showGlobalReport(){
    var h='<div class="form-row"><div class="form-group"><label>From Date</label><input type="date" id="grFrom" class="form-input" value="'+today()+'"></div><div class="form-group"><label>To Date</label><input type="date" id="grTo" class="form-input" value="'+today()+'"></div></div>';
    h+='<div class="form-actions"><button class="btn btn-glass" onclick="generateGlobalReport()"><i class="bx bx-bar-chart-alt-2"></i> Generate</button><button class="btn btn-glass" onclick="exportGlobalPDF()"><i class="bx bx-file"></i> PDF</button><button class="btn btn-glass" onclick="exportGlobalExcel()"><i class="bx bx-download"></i> Excel</button></div>';
    h+='<div id="grResult" style="margin-top:16px"></div>';
    showModal('Global Report',h,'xl','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
async function getGlobalData(){
    var from=document.getElementById('grFrom').value;
    var to=document.getElementById('grTo').value;
    var data={vehicles:0,posted:0,pending:0,putaway:0,piv:0,picked:0,loaded:0,shorts:0};
    var vehs=DB.get('vehicles').filter(function(v){return v.reportedAt&&v.reportedAt.split('T')[0]>=from&&v.reportedAt.split('T')[0]<=to;});
    data.vehicles=vehs.length;
    vehs.forEach(function(v){if(v.status==='Posted'||v.status==='Unloaded')data.posted++;else data.pending++;});
    await sbPullFull('location_master',120000);   // ★ server se on-demand (2 min cache)
    var locs=DB.get('location_master').filter(function(l){return l.date>=from&&l.date<=to;});
    locs.forEach(function(l){if(l.action==='PUTAWAY')data.putaway++;else if(l.action==='PIV')data.piv++;});
    data.picked=DB.get('picking_done').filter(function(p){return p.pickedAt&&p.pickedAt.split('T')[0]>=from&&p.pickedAt.split('T')[0]<=to;}).length;
    data.loaded=DB.get('loaded_vehicles').filter(function(l){return l.loadedAt&&l.loadedAt.split('T')[0]>=from&&l.loadedAt.split('T')[0]<=to;}).length;
    data.shorts=DB.get('short_reports').filter(function(s){return s.createdAt&&s.createdAt.split('T')[0]>=from&&s.createdAt.split('T')[0]<=to;}).length;
    return data;
}
async function generateGlobalReport(){
    var d=await getGlobalData();
    var h='<div class="kpi-grid">';
    h+=kpi('bxs-truck',d.vehicles,'Total Vehicles','accent');
    h+=kpi('bxs-check-circle',d.posted,'Posted','success');
    h+=kpi('bx-time-five',d.pending,'Pending','warning');
    h+=kpi('bxs-package',d.putaway,'Putaway','info');
    h+=kpi('bxs-clipboard',d.piv,'PIV','accent2');
    h+=kpi('bxs-box',d.picked,'Picked','success');
    h+=kpi('bxs-truck',d.loaded,'Loaded','info');
    h+=kpi('bx-error-circle',d.shorts,'Shorts','danger');
    h+='</div>';
    document.getElementById('grResult').innerHTML=h;
}
async function exportGlobalExcel(){
    var d=await getGlobalData();var rows=[['Metric','Value'],['Total Vehicles',d.vehicles],['Posted',d.posted],['Pending',d.pending],['Putaway',d.putaway],['PIV',d.piv],['Picked',d.picked],['Loaded',d.loaded],['Shorts',d.shorts]];
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Global');XLSX.writeFile(wb,'Global_Report_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}
async function exportGlobalPDF(){
    var d=await getGlobalData();var rows=[['Total Vehicles',d.vehicles],['Posted',d.posted],['Pending',d.pending],['Putaway',d.putaway],['PIV',d.piv],['Picked',d.picked],['Loaded',d.loaded],['Shorts',d.shorts]];
    var pdf=new jspdf.jsPDF();pdf.setFontSize(16);pdf.text('Global Warehouse Report',14,20);pdf.setFontSize(9);pdf.text('VIP INDUSTRIES LIMITED MD20 | '+fmtDT(new Date()),14,28);
    pdf.autoTable({startY:34,head:[['Metric','Value']],body:rows,theme:'grid',headStyles:{fillColor:[0,180,120]}});
    pdf.save('Global_Report_'+today()+'.pdf');showToast('PDF downloaded!','success');
}
function showInboundReport(){
    var vehs=DB.get('vehicles').filter(function(v){return v.vehicleType==='Unloading';});
    var unloaded=vehs.filter(function(v){return v.status==='Posted'||v.status==='Unloaded';});
    var notUnloaded=vehs.filter(function(v){return v.status!=='Posted'&&v.status!=='Unloaded';});
    var h='<div class="kpi-grid" style="margin-bottom:16px">';
    h+=kpi('bxs-truck',vehs.length,'Total Inbound','accent');
    h+=kpi('bxs-check-circle',unloaded.length,'Unloaded','success');
    h+=kpi('bx-time-five',notUnloaded.length,'Not Unloaded','danger');
    h+='</div>';
    h+='<div class="form-actions" style="margin-bottom:12px"><button class="btn btn-glass" onclick="exportInboundReportPDF()"><i class="bx bx-file"></i> PDF</button><button class="btn btn-glass" onclick="exportInboundReportExcel()"><i class="bx bx-download"></i> Excel</button></div>';
    if(notUnloaded.length){
        h+='<div class="card"><div class="card-title"><i class="bx bx-error" style="color:var(--danger)"></i> Not Yet Unloaded</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>LR</th><th>Status</th><th>Reported</th></tr></thead><tbody>';
        notUnloaded.forEach(function(v){h+='<tr><td>'+esc(v.vehicleNo)+'</td><td>'+esc(v.lrNo||'-')+'</td><td><span class="badge badge-warning">'+esc(v.status)+'</span></td><td style="font-size:11px">'+fmtDT(v.reportedAt)+'</td></tr>';});
        h+='</tbody></table></div></div>';
    }
    showModal('Inbound Report',h,'xl','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
function exportInboundReportPDF(){
    var vehs=DB.get('vehicles').filter(function(v){return v.vehicleType==='Unloading';});var rows=[];
    vehs.forEach(function(v){rows.push([v.vehicleNo,v.lrNo||'',v.transportName||'',v.status,fmtDT(v.reportedAt)]);});
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text('Inbound Report — VIP INDUSTRIES MD20',14,15);
    pdf.autoTable({startY:22,head:[['Vehicle','LR','Transport','Status','Reported']],body:rows,theme:'grid',headStyles:{fillColor:[0,180,120]},styles:{fontSize:7}});
    pdf.save('Inbound_Report_'+today()+'.pdf');showToast('PDF downloaded!','success');
}
function exportInboundReportExcel(){
    var vehs=DB.get('vehicles').filter(function(v){return v.vehicleType==='Unloading';});var rows=[['Vehicle','LR','Transport','Status','Reported']];
    vehs.forEach(function(v){rows.push([v.vehicleNo,v.lrNo||'',v.transportName||'',v.status,fmtDT(v.reportedAt)]);});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Inbound');XLSX.writeFile(wb,'Inbound_Report_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}
function showLoadingReport(){
    var loaded=DB.get('loaded_vehicles');
    var h='<div class="kpi-grid" style="margin-bottom:16px">';
    h+=kpi('bxs-truck',loaded.length,'Total Loaded','accent');
    h+='</div>';
    h+='<div class="form-actions" style="margin-bottom:12px"><button class="btn btn-glass" onclick="exportLoadingExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportLoadingPDF()"><i class="bx bx-file"></i> PDF</button></div>';
    showModal('Loading Report',h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
function showChangePassword(){
    var h='<div class="form-group"><label>Current Password <span class="req">*</span></label><input type="password" id="cpCurr" class="form-input"></div>';
    h+='<div class="form-group"><label>New Password <span class="req">*</span></label><input type="password" id="cpNew" class="form-input"></div>';
    h+='<div class="form-group"><label>Confirm New Password <span class="req">*</span></label><input type="password" id="cpConf" class="form-input"></div>';
    showModal('Change Password',h,'sm','<button class="btn btn-glass" onclick="closeModal()">Cancel</button><button class="btn btn-glass" onclick="doChangePassword()"><i class="bx bx-check"></i> Update</button>');
}
async function doChangePassword(){
    var curr=document.getElementById('cpCurr').value,newP=document.getElementById('cpNew').value,conf=document.getElementById('cpConf').value;
    if(curr!==APP.currentUser.password){showToast('Current password incorrect','error');return;}
    if(newP!==conf){showToast('Passwords do not match','error');return;}
    if(newP.length<4){showToast('Password too short','error');return;}

    // Supabase Auth me password badlo
    var cr=await supabaseClient.auth.updateUser({password:newP});
    if(cr.error){showToast(cr.error.message,'error');return;}

    DB.update('users',APP.currentUser.id,{password:newP});
    APP.currentUser.password=newP;showToast('Password updated!','success');closeModal();
}
function showFrontCustomize(){
    var colors=[
        {name:'Emerald',val:'#00E5A0'},{name:'Cyan',val:'#06B6D4'},{name:'Blue',val:'#3B82F6'},
        {name:'Purple',val:'#8B5CF6'},{name:'Pink',val:'#EC4899'},{name:'Red',val:'#EF4444'},
        {name:'Orange',val:'#F97316'},{name:'Amber',val:'#F59E0B'}
    ];
    var h='<div class="card-title">Accent Color</div><div style="display:flex;gap:10px;flex-wrap:wrap">';
    colors.forEach(function(c){
        h+='<div style="width:40px;height:40px;border-radius:10px;background:'+c.val+';cursor:pointer;border:3px solid transparent;transition:all .2s" onclick="setAccentColor(\''+c.val+'\',this)" title="'+c.name+'"></div>';
    });
    h+='</div>';
    showModal('Front Customization',h,'sm','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
function setAccentColor(color,el){
    document.documentElement.style.setProperty('--accent',color);
    var r=parseInt(color.slice(1,3),16),g=parseInt(color.slice(3,5),16),b=parseInt(color.slice(5,7),16);
    document.documentElement.style.setProperty('--accent-rgb',r+','+g+','+b);
    document.documentElement.style.setProperty('--accent-dim','rgba('+r+','+g+','+b+',.1)');
    localStorage.setItem('wms_accent',color);
    showToast('Accent color changed!','success');
}
function showSessionInfo(){
    var h='<div class="form-group"><label>Logged In As</label><div class="form-input" style="background:transparent;border:none;font-weight:700">'+esc(APP.currentUser.name)+' ('+esc(APP.currentUser.role)+')</div></div>';
    h+='<div class="form-group"><label>Login Time</label><div class="form-input" style="background:transparent;border:none">'+fmtDT(APP.sessionStart?new Date(APP.sessionStart):new Date())+'</div></div>';
    h+='<div class="form-group"><label>Session Duration</label><div class="form-input" style="background:transparent;border:none;color:var(--accent);font-weight:700">'+timeDiff(APP.sessionStart,new Date().toISOString())+'</div></div>';
    h+='<div class="form-group"><label>Theme</label><div class="form-input" style="background:transparent;border:none">'+APP.theme+'</div></div>';
    h+='<div class="form-group"><label>Supabase Connected</label><div class="form-input" style="background:transparent;border:none;color:'+(supabaseClient?'var(--success)':'var(--danger)')+'">'+(supabaseClient?'Yes':'No')+'</div></div>';
    showModal('Session Info',h,'sm','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

// ==================== REPORTS ====================
function renderReports(){
    var h='<div class="section-header"><h2><i class="bx bx-bar-chart-alt-2"></i> Reports</h2></div>';
    h+='<div class="settings-grid">';
    h+='<div class="settings-card" onclick="showGlobalReport()"><div class="sc-icon" style="background:var(--accent-dim);color:var(--accent)"><i class="bx bx-bar-chart-alt-2"></i></div><div class="sc-title">Global Report</div><div class="sc-desc">Complete warehouse summary with date filter.</div></div>';
    h+='<div class="settings-card" onclick="showInboundReport()"><div class="sc-icon" style="background:var(--accent2-dim);color:var(--accent2)"><i class="bx bxs-truck"></i></div><div class="sc-title">Inbound Report</div><div class="sc-desc">All inbound vehicles — unloaded or not.</div></div>';
    h+='<div class="settings-card" onclick="showLoadingReport()"><div class="sc-icon" style="background:var(--info-dim);color:var(--info)"><i class="bx bxs-truck"></i></div><div class="sc-title">Loading Report</div><div class="sc-desc">All loaded vehicles report.</div></div>';
    h+='<div class="settings-card" onclick="navTo(\'qty-mismatch\')"><div class="sc-icon" style="background:var(--danger-dim);color:var(--danger)"><i class="bx bx-error-circle"></i></div><div class="sc-title">Qty Mismatch</div><div class="sc-desc">Short reports and loading mismatches.</div></div>';
    h+='<div class="settings-card" onclick="navTo(\'user-time\')"><div class="sc-icon" style="background:var(--warning-dim);color:var(--warning)"><i class="bx bx-time-five"></i></div><div class="sc-title">User Working Time</div><div class="sc-desc">Who did what and how long.</div></div>';
    h+='<div class="settings-card" onclick="navTo(\'picking\',\'picking-done\')"><div class="sc-icon" style="background:var(--success);color:#fff;opacity:.8"><i class="bx bx-check-circle"></i></div><div class="sc-title">Picking Done</div><div class="sc-desc">All completed picking with details.</div></div>';
    h+='</div>';
    setHtml(h);
}

// ==================== AUDIT LOG ====================
function renderAuditLog(){
    var logs=DB.get('audit_log').slice().reverse();
    var pg=paginate(logs,APP.auditPage,APP.auditPerPage);
    var h='<div class="section-header"><h2><i class="bx bx-receipt"></i> Audit Log ('+logs.length+')</h2><div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportAuditExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-danger" onclick="clearAuditLog()"><i class="bx bx-trash"></i> Clear Log</button></div></div>';
    h+='<div class="search-box"><i class="bx bx-search"></i><input type="text" id="auditSearch" placeholder="Search module, action, user..." oninput="searchAudit()"></div>';
    h+='<div id="auditTable">'+buildAuditTable(pg.items)+'</div>';
    h+=renderPag(APP.auditPage,pg.pages,'goAuditPage');
    setHtml(h);
}
function buildAuditTable(logs){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Module</th><th>Action</th><th>Details</th><th>User</th><th>Date Time</th></tr></thead><tbody>';
    if(!logs.length)h+='<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No logs</td></tr>';
    else logs.forEach(function(l){h+='<tr><td>'+esc(l.module)+'</td><td><strong>'+esc(l.action)+'</strong></td><td style="font-size:11px;color:var(--text-secondary);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(l.details)+'</td><td>'+esc(l.userName)+'</td><td style="font-size:11px;color:var(--text-muted)">'+fmtDT(l.dateTime)+'</td></tr>';});
    h+='</tbody></table></div>';return h;
}
function goAuditPage(p){APP.auditPage=p;renderAuditLog();}
function searchAudit(){
    var q=document.getElementById('auditSearch').value.trim().toLowerCase();
    var logs=DB.get('audit_log').slice().reverse();
    if(q)logs=logs.filter(function(l){return(l.module||'').toLowerCase().indexOf(q)>-1||(l.action||'').toLowerCase().indexOf(q)>-1||(l.userName||'').toLowerCase().indexOf(q)>-1;});
    document.getElementById('auditTable').innerHTML=buildAuditTable(logs);
}
function exportAuditExcel(){
    var logs=DB.get('audit_log');var rows=[['Module','Action','Details','User','Date Time']];
    logs.forEach(function(l){rows.push([l.module,l.action,l.details,l.userName,fmtDT(l.dateTime)]);});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Audit');XLSX.writeFile(wb,'Audit_Log_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}

// ==================== DELETE ACTIONS ====================
// Centralised admin delete actions — every list/table in the ERP has a delete option.
function deletePickingDone(id){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    var d=DB.find('picking_done',id);if(!d)return;
    var blk=reverseBlocker(d);if(blk){showToast(blk,'error');return;}
    if(!confirm('Delete picking record '+d.obdNo+'? The stock will be restored first.'))return;
    (d.details||[]).forEach(function(det){(det.locations||[]).forEach(function(l){if(l.source==='GR'){var gim=DB.find('invoice_materials',l.invMatId);if(gim)DB.update('invoice_materials',gim.id,{crossdockedQty:Math.max(0,(gim.crossdockedQty||0)-l.qty)});return;}restoreStock(l.rack,l.ean||det.ean,l.qty,l.sources,{material:det.material,obdNo:d.obdNo});});});
    DB.remove('picking_done',id);
    DB.update('obd_data',d.obdId,{status:'Pending',priority:'Normal'});
    DB.filter('short_reports',function(s){return s.lrNo==='OBD'&&s.unloadNo===d.obdNo&&!s.posted;}).forEach(function(s){DB.remove('short_reports',s.id);});
    logAction('Picking','DELETE','Picking record '+d.obdNo+' deleted — stock restored');
    showToast('Picking record deleted — stock restored','success');
    renderPickingDone();
}
function deleteLocRequest(id){
    if(!isMgrUser()){showToast('Admin / Manager access only','error');return;}
    var r=DB.find('location_requests',id);if(!r)return;
    if(!confirm('Delete location request '+r.reqNo+'?'))return;
    DB.remove('location_requests',id);
    logAction('Picking','LOC_DELETE','Location request '+r.reqNo+' deleted');
    showToast('Request deleted','success');
    renderLocRequests();
}
function deleteShortReport(id){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    var s=DB.find('short_reports',id);if(!s)return;
    if(!confirm('Delete unloading short '+s.shortNo+'?'))return;
    DB.remove('short_reports',id);
    logAction('Reports','DELETE','Unloading short '+s.shortNo+' deleted');
    showToast('Unloading short deleted','success');renderQtyMismatch();
}
function deleteLoadingMismatch(id){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    var l=DB.find('loading_data',id);if(!l)return;
    if(!confirm('Delete loading mismatch '+l.loadNo+'?'))return;
    DB.remove('loading_data',id);
    logAction('Loading','DELETE','Loading mismatch '+l.loadNo+' deleted');
    showToast('Mismatch record deleted','success');renderQtyMismatch();
}
function deleteApprovalReq(id){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    var a=DB.find('loading_approvals',id);if(!a)return;
    if(!confirm('Delete approval record '+a.loadNo+'?'))return;
    DB.remove('loading_approvals',id);
    logAction('Loading','DELETE','Approval record '+a.loadNo+' deleted');
    showToast('Approval record deleted','success');renderQtyMismatch();
}
function deleteLoadedVehicle(id){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    var l=DB.find('loaded_vehicles',id);if(!l)return;
    if(!confirm('Delete goods issue record '+l.loadNo+'? The loading record will be removed.'))return;
    DB.remove('loaded_vehicles',id);
    logAction('Loading','DELETE','Goods issue record '+l.loadNo+' deleted');
    showToast('Record deleted','success');renderLoadingDone();
}
function deletePWLDone(id){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    var l=DB.find('loaded_vehicles',id);if(!l)return;
    if(!confirm('Delete P&L record '+l.loadNo+'?'))return;
    DB.remove('loaded_vehicles',id);
    logAction('Loading','DELETE','P&L record '+l.loadNo+' deleted');
    showToast('Record deleted','success');renderPickingWithLoading();
}
function deleteVehicle(id){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    var v=DB.find('vehicles',id);if(!v)return;
    if(v.status==='Posted'||v.status==='Unloaded'||v.status==='Posting Pending Approval'){showToast('Posted or unloaded vehicles cannot be deleted','error');return;}
    if(!confirm('Delete vehicle '+v.vehicleNo+' with all its invoices and materials?'))return;
    DB.filter('invoices',function(i){return i.vehicleId===id;}).forEach(function(i){
        DB.filter('invoice_materials',function(m){return m.invoiceId===i.id;}).forEach(function(m){DB.remove('invoice_materials',m.id);});
        DB.remove('invoices',i.id);
    });
    DB.remove('vehicles',id);
    logAction('Inbound','VEHICLE_DELETE','Vehicle '+v.vehicleNo+' deleted');
    showToast('Vehicle deleted','success');
    renderPendingVehicle();
}
function deleteOBD(id){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    var o=DB.find('obd_data',id);if(!o)return;
    if(o.status!=='Pending'){showToast('Only Pending OBDs can be deleted','error');return;}
    if(!confirm('Delete OBD '+o.obdNo+'?'))return;
    DB.filter('picking_assignments',function(a){return (a.obdIds||[]).indexOf(id)>-1&&a.status==='Assigned';}).forEach(function(a){
        var ni=(a.obdIds||[]).filter(function(x){return x!==id;});
        if(!ni.length)DB.remove('picking_assignments',a.id);else DB.update('picking_assignments',a.id,{obdIds:ni});
    });
    releaseLocksForOBD(id);
    DB.remove('obd_data',id);
    logAction('Picking','OBD_DELETE','OBD '+o.obdNo+' deleted');
    showToast('OBD deleted','success');
    renderOBDUpload();
}
function deleteNotif(id){
    var n=DB.get('notifications').filter(function(x){return x.id!==id;});
    DB.set('notifications',n);updateNotifBadge();renderNotifPanel();
}
function clearAuditLog(){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    if(!confirm('Delete the entire audit log? This cannot be undone.'))return;
    DB.set('audit_log',[]);logAction('System','AUDIT_CLEAR','Audit log cleared');
    showToast('Audit log cleared','success');renderAuditLog();
}
function deleteWorkLog(){
    if(!isAdminUser()){showToast('Admin / Manager access only','error');return;}
    if(!confirm('Delete the entire resource activity log?'))return;
    DB.set('user_work_log',[]);logAction('System','WORKLOG_CLEAR','Resource activity log cleared');
    showToast('Activity log cleared','success');renderUserWorkingTime();
}

// ==================== EXPORT UTILITY ====================
async function exportTableExcel(tableKey,fileName){
    await sbPullFull(tableKey);   // 60k rows on-demand — export ke waqt hi fetch hoti hain
    var data=DB.get(tableKey);if(!data.length){showToast('No data','error');return;}
    var rows=[];var keys=Object.keys(data[0]);
    rows.push(keys);
    data.forEach(function(d){rows.push(keys.map(function(k){return d[k]===null||d[k]===undefined?'':String(d[k]);}));});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,fileName);
    XLSX.writeFile(wb,fileName+'_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}

// ==================== SCANNER ====================
function startCameraScan(){
    var readerEl=document.getElementById('qr-reader');
    if(!readerEl)return;
    if(window._html5QrCode){try{window._html5QrCode.stop();}catch(e){}}
    window._html5QrCode=new Html5Qrcode('qr-reader');
    window._html5QrCode.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:250}},function(code){
        if(window._html5QrCode){try{window._html5QrCode.stop();}catch(e){}}
        closeScannerModal();
        if(APP.scanCallback){APP.scanCallback(code);APP.scanCallback=null;}
        showToast('Scanned: '+code,'success');
    },function(){}).catch(function(err){showToast('Camera error: '+err,'error');});
}
function focusForBluetoothScanner(){
    var inp=document.createElement('input');
    inp.style.cssText='position:fixed;top:-100px;left:-100px;opacity:0';
    inp.placeholder='Scan barcode with Bluetooth/USB scanner...';
    inp.autofocus=true;
    document.body.appendChild(inp);
    setTimeout(function(){inp.focus();},100);
    inp.addEventListener('keydown',function(e){
        if(e.key==='Enter'){
            var code=inp.value.trim();
            document.body.removeChild(inp);
            closeScannerModal();
            if(code&&APP.scanCallback){APP.scanCallback(code);APP.scanCallback=null;}
            else if(code)showToast('Scanned: '+code,'success');
        }
    });
    // Timeout - if no scan in 30s, remove
    setTimeout(function(){if(document.body.contains(inp)){document.body.removeChild(inp);}},30000);
}
function closeScannerModal(){
    document.getElementById('scannerModal').style.display='none';
    if(window._html5QrCode){try{window._html5QrCode.stop();}catch(e){}}
}

// ==================== SIDEBAR MOBILE ====================
function closeSidebar(){
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
}

// ==================== BOTTOM NAV ====================
function initBottomNav(){
    document.querySelectorAll('.bnav-item').forEach(function(el){
        el.addEventListener('click',function(e){
            e.preventDefault();
            var bnav=this.getAttribute('data-bnav');
            if(bnav==='more'){document.getElementById('morePanel').classList.add('open');return;}
            var secMap={dashboard:'dashboard',inbound:'inbound',picking:'picking',loading:'loading'};
            if(secMap[bnav])navTo(secMap[bnav]);
        });
    });
    // More panel
    document.getElementById('morePanelOverlay').addEventListener('click',function(){document.getElementById('morePanel').classList.remove('open');});
    document.getElementById('morePanelClose').addEventListener('click',function(){document.getElementById('morePanel').classList.remove('open');});
        var modules=[
        {id:'putaway',icon:'bxs-package',label:'Putaway'},
        {id:'piv',icon:'bxs-clipboard',label:'Stock Count'},
        {id:'location',icon:'bxs-map-pin',label:'Stock Overview'},
        {id:'rack',icon:'bxs-grid-alt',label:'Bins & Racks'},
        {id:'material',icon:'bxs-label',label:'Products'},
        {id:'admin',icon:'bxs-user-detail',label:'Users'},
        {id:'settings',icon:'bxs-cog',label:'Settings'},
        {id:'reports',icon:'bxs-bar-chart-alt-2',label:'Reports'},
        {id:'audit',icon:'bxs-receipt',label:'Activity History'},
        {id:'user-time',icon:'bx-time-five',label:'Work Log'}
    ];
    var gh='';
    modules.forEach(function(m){
        gh+='<div class="more-grid-item" onclick="document.getElementById(\'morePanel\').classList.remove(\'open\');navTo(\''+m.id+'\')"><i class="bx '+m.icon+'"></i><span>'+m.label+'</span></div>';
    });
    document.getElementById('morePanelGrid').innerHTML=gh;
}

// ==================== GLOBAL SEARCH ====================
function initGlobalSearch(){
    var input=document.getElementById('searchInput');
    if(!input)return;
    input.addEventListener('keydown',async function(e){
        if(e.key==='Enter'){
            var q=input.value.trim().toLowerCase();if(!q)return;
            // Search across all tables (Material + Location direct Supabase se)
            var results=[];
            DB.get('vehicles').forEach(function(v){if((v.vehicleNo||'').toLowerCase().indexOf(q)>-1||(v.lrNo||'').toLowerCase().indexOf(q)>-1)results.push({type:'Vehicle',label:v.vehicleNo,sub:v.lrNo||'',nav:'inbound',subNav:'inbound-record'});});
            var mres=await sbSearch('material_master',{search:q,cols:['material','ean'],limit:5});
            mres.rows.forEach(function(m){results.push({type:'Material',label:m.material,sub:m.ean||'',nav:'material'});});
            var lres=await sbSearch('location_master',{search:q,cols:['rack','material'],limit:5});
            lres.rows.forEach(function(l){results.push({type:'Location',label:l.rack+' - '+l.material,sub:'Qty: '+l.quantity,nav:'location'});});
            DB.get('obd_data').forEach(function(o){if((o.obdNo||'').toLowerCase().indexOf(q)>-1)results.push({type:'OBD',label:o.obdNo,sub:(o.materials||[]).length+' materials',nav:'picking',subNav:'obd-upload'});});
            DB.get('grn_records').forEach(function(g){if((g.grnNo||'').toLowerCase().indexOf(q)>-1||(g.invoiceNo||'').toLowerCase().indexOf(q)>-1)results.push({type:'GRN',label:g.grnNo,sub:g.invoiceNo,nav:'inbound',subNav:'unloading-stock'});});
            if(!results.length){showToast('No results found for "'+q+'"','warning');return;}
            var h='<div class="card-title"><i class="bx bx-search"></i> Search Results ('+results.length+')</div>';
            results.slice(0,15).forEach(function(r){
                h+='<div class="inv-list-item" onclick="closeModal();navTo(\''+r.nav+'\','+(r.subNav||'')+'\')"><div class="ili-left"><span class="badge badge-info" style="margin-right:8px">'+r.type+'</span><span class="ili-invno">'+esc(r.label)+'</span><span class="ili-info">'+esc(r.sub)+'</span></div><i class="bx bx-chevron-right" style="color:var(--text-muted)"></i></div>';
            });
            showModal('Search Results',h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
            input.value='';
        }
    });
    // Ctrl+K shortcut
    document.addEventListener('keydown',function(e){
        if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();input.focus();}
    });
}

// ==================== MATRIX LOGIN ANIMATION ====================
function initMatrix(){
    var canvas=document.getElementById('matrixCanvas');if(!canvas)return;
    var ctx=canvas.getContext('2d');
    canvas.width=window.innerWidth;canvas.height=window.innerHeight;
    var cols=Math.floor(canvas.width/14);
    var drops=[];
    for(var i=0;i<cols;i++)drops[i]=Math.random()*canvas.height/14;
    function draw(){
        ctx.fillStyle='rgba(5,8,16,0.05)';ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='#00E5A0';ctx.font='12px monospace';
        for(var i=0;i<drops.length;i++){
            var ch=String.fromCharCode(0x30A0+Math.random()*96);
            ctx.fillText(ch,i*14,drops[i]*14);
            if(drops[i]*14>canvas.height&&Math.random()>0.975)drops[i]=0;
            drops[i]++;
        }
    }
    window._matrixInterval=setInterval(draw,45);
    window.addEventListener('resize',function(){canvas.width=window.innerWidth;canvas.height=window.innerHeight;});
}

// ==================== SESSION TIMEOUT ====================
function initSessionTimeout(){
    setInterval(function(){
        if(!APP.currentUser||!APP.sessionStart)return;
        var elapsed=Date.now()-APP.sessionStart;
        if(elapsed>APP.SESSION_TIMEOUT){
            showToast('Session expired! Please login again.','warning');
            setTimeout(function(){doLogout();},2000);
        }
    },30000);
}

// ==================== EVENT LISTENERS ====================
function initEvents(){
    // Login form
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var btn = this.querySelector('button[type="submit"]');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> <span>Logging on...</span>';
    }
    
    try {
        var success = await doLogin(document.getElementById('loginUser').value.trim(), document.getElementById('loginPass').value);
        if (success) {
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('mainApp').style.display = 'flex';
            if (window._matrixInterval) clearInterval(window._matrixInterval);
            document.getElementById('userAvatar').textContent = APP.currentUser.name.charAt(0).toUpperCase();
            document.getElementById('userName').textContent = APP.currentUser.name;
            renderSidebar(); initBottomNav(); navTo('dashboard'); initSessionTimeout();
        }
    } catch(err) {
        showToast('Login failed: ' + (err.message || 'Unknown error'), 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>Log On</span><i class="bx bx-log-in"></i>';
        }
    }
});

    // Menu toggle
    document.getElementById('menuToggle').addEventListener('click',function(){
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebarOverlay').classList.toggle('open');
    });
    document.getElementById('sidebarClose').addEventListener('click',closeSidebar);
    document.getElementById('sidebarOverlay').addEventListener('click',closeSidebar);

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click',function(){
        APP.theme=APP.theme==='dark'?'light':'dark';
        document.documentElement.setAttribute('data-theme',APP.theme);
        localStorage.setItem('wms_theme',APP.theme);
        this.querySelector('i').className=APP.theme==='dark'?'bx bx-moon':'bx bx-sun';
    });

    // Notifications
    document.getElementById('notifBtn').addEventListener('click',function(e){
        e.stopPropagation();
        document.getElementById('notifPanel').classList.toggle('open');
        renderNotifPanel();
    });
    document.addEventListener('click',function(e){
        if(!e.target.closest('#notifPanel')&&!e.target.closest('#notifBtn'))document.getElementById('notifPanel').classList.remove('open');
    });
    document.getElementById('clearNotifs').addEventListener('click',function(){
        DB.set('notifications',[]);updateNotifBadge();renderNotifPanel();showToast('Notifications cleared','success');
    });

    // User dropdown
    document.getElementById('userMenu').addEventListener('click',function(e){
        e.stopPropagation();
        document.getElementById('userDropdown').classList.toggle('open');
    });
    document.addEventListener('click',function(e){
        if(!e.target.closest('#userMenu'))document.getElementById('userDropdown').classList.remove('open');
    });
    document.getElementById('ddLogout').addEventListener('click',function(e){e.preventDefault();doLogout();});
    document.getElementById('ddProfile').addEventListener('click',function(e){
        e.preventDefault();document.getElementById('userDropdown').classList.remove('open');
        showSessionInfo();
    });
    document.getElementById('ddPassword').addEventListener('click',function(e){
        e.preventDefault();document.getElementById('userDropdown').classList.remove('open');
        showChangePassword();
    });

    // Global search
    initGlobalSearch();
}

// ==================== INIT ====================
(function init(){
    // Apply theme
    document.documentElement.setAttribute('data-theme',APP.theme);
    var themeIcon=document.getElementById('themeToggle').querySelector('i');
    if(themeIcon)themeIcon.className=APP.theme==='dark'?'bx bx-moon':'bx bx-sun';

    // Apply saved accent
    var savedAccent=localStorage.getItem('wms_accent');
    if(savedAccent){
        var r=parseInt(savedAccent.slice(1,3),16),g=parseInt(savedAccent.slice(3,5),16),b=parseInt(savedAccent.slice(5,7),16);
        document.documentElement.style.setProperty('--accent',savedAccent);
        document.documentElement.style.setProperty('--accent-rgb',r+','+g+','+b);
        document.documentElement.style.setProperty('--accent-dim','rgba('+r+','+g+','+b+',.1)');
    }

    // Seed data
    //seedData();

    // Init login
    initMatrix();
    initEvents();

    // Check existing session
  (async function restoreSession() {
    if (!supabaseClient) return;
    var s = await supabaseClient.auth.getSession();
    if (!s.data.session) { localStorage.removeItem('wms_session'); return; }
    await pullAll();
    var uname = (s.data.session.user.email || '').split('@')[0];
    var user = DB.get('users').filter(function (u) { return u.username === uname; })[0];
    if (!user) return;
    // Refresh/reopen par bhi check: kya ye device abhi bhi is ID ka owner hai?
    var hb = await supabaseClient.rpc('wms_heartbeat', { p_username: user.username, p_token: devToken() });
    if (hb.error || hb.data !== true) {
        await supabaseClient.auth.signOut({ scope: 'local' });
        localStorage.removeItem('wms_session'); localStorage.removeItem('wms_dev_token');
        return;
    }
    APP.currentUser = user; APP.sessionStart = Date.now();
    devStart();
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';
    if (window._matrixInterval) clearInterval(window._matrixInterval);
    document.getElementById('userAvatar').textContent = user.name.charAt(0).toUpperCase();
    document.getElementById('userName').textContent = user.name;
    renderSidebar(); initBottomNav(); navTo('dashboard'); initSessionTimeout();
    startRealtime();
})();
})();

// ==================== SCANNER MODULE ====================
// Camera barcode/QR scanner — modal khulte hi camera apne aap start, code dikhte hi turant scan.
// Sab callers (Putaway, Stock Count/PIV, Picking, Loading, Unloading) isi ko use karte hain:
//   - APP.scanCallback set + #scannerModal display:flex   (purana tarika)
//   - openScanner(callback)                               (naya tarika)
var SCANNER = { html5Qr: null, callback: null, btInput: null, isActive: false, starting: false, handled: false };

function _scanFormats() {
    if (typeof Html5QrcodeSupportedFormats === 'undefined') return undefined;
    var F = Html5QrcodeSupportedFormats;
    // Sirf warehouse ke formats — decoder kam kaam karta hai, isliye jaldi pakadta hai
    return [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.QR_CODE, F.DATA_MATRIX]
        .filter(function (x) { return x !== undefined; });
}
// Barcode chauda hota hai — isliye scan area wide rectangle (square nahi)
function _scanBox(vw, vh) {
    var w = Math.floor(Math.min(vw * 0.92, 440));
    var h = Math.floor(Math.min(vh * 0.6, w * 0.55));
    return { width: Math.max(w, 60), height: Math.max(h, 60) };
}
function _scanBeep() {
    try {
        var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
        var ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.value = 1400; g.gain.value = 0.08;
        o.connect(g); g.connect(ctx.destination); o.start();
        setTimeout(function () { o.stop(); ctx.close(); }, 90);
    } catch (e) {}
}

function openScanner(callback) {
    if (typeof callback === 'function') SCANNER.callback = callback;
    var modal = document.getElementById('scannerModal');
    if (modal) modal.style.display = 'flex';          // observer camera start kar dega
}

function _stopCamera() {
    var q = SCANNER.html5Qr;
    SCANNER.html5Qr = null; SCANNER.starting = false;
    if (!q) return Promise.resolve();
    try {
        return q.stop().then(function () { try { q.clear(); } catch (e) {} }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
}
function _removeBtInput() {
    if (SCANNER.btInput) { try { SCANNER.btInput.remove(); } catch (e) {} SCANNER.btInput = null; }
}

function closeScannerModal() {
    SCANNER.isActive = false;
    SCANNER.callback = null;
    if (typeof APP !== 'undefined') APP.scanCallback = null;
    _removeBtInput();
    _stopCamera();
    var reader = document.getElementById('qr-reader');
    if (reader) setTimeout(function () { if (!SCANNER.html5Qr) reader.innerHTML = ''; }, 50);
    var modal = document.getElementById('scannerModal');
    if (modal) modal.style.display = 'none';
}

// Scan mil gaya — ek hi baar chalega, camera band, modal band, phir field me value
function scannerDeliver(code) {
    if (SCANNER.handled) return;
    code = String(code == null ? '' : code).trim();
    if (!code) return;
    SCANNER.handled = true;
    var cb = SCANNER.callback || (typeof APP !== 'undefined' ? APP.scanCallback : null);
    try { if (navigator.vibrate) navigator.vibrate(70); } catch (e) {}
    _scanBeep();
    closeScannerModal();
    if (typeof cb === 'function') {
        try { cb(code); } catch (e) { console.error('scan callback error', e); showToast('Scan error: ' + (e.message || e), 'error'); }
    } else {
        showToast('Scanned: ' + code, 'success');
    }
}

function _camError(reader, err) {
    SCANNER.starting = false;
    var msg = (err && (err.message || err.name)) || String(err || 'Unknown error');
    if (/NotAllowed|Permission/i.test(msg)) msg = 'Camera permission denied. Please allow camera access in browser/app settings.';
    reader.innerHTML = '<div style="padding:20px;text-align:center"><i class="bx bx-error-circle" style="font-size:32px;color:var(--danger);display:block;margin-bottom:8px"></i><div style="color:var(--danger);font-size:13px">Camera error</div><div style="color:var(--text-muted);font-size:11px;margin-top:4px">' + esc(msg) + '</div></div>';
}

function startCameraScan() {
    var reader = document.getElementById('qr-reader');
    if (!reader || SCANNER.starting) return;
    _removeBtInput();
    SCANNER.isActive = true; SCANNER.handled = false; SCANNER.starting = true;
    reader.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)"><div class="loader-hex" style="margin:0 auto 10px;width:30px;height:30px"></div>Camera starting...</div>';

    _stopCamera().then(function () {
        SCANNER.starting = true;
        function make() {
            var cfg = { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } };   // phone ka native fast decoder
            var f = _scanFormats(); if (f && f.length) cfg.formatsToSupport = f;
            return new Html5Qrcode('qr-reader', cfg);
        }
        function ok(text) { scannerDeliver(text); }
        function noop() {}

        // 1) HD + continuous autofocus (barcode jaldi pakadne ke liye)
        var hd = {
            fps: 25, qrbox: _scanBox, disableFlip: true,
            videoConstraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] }
        };
        var q1 = make(); SCANNER.html5Qr = q1;
        q1.start({ facingMode: 'environment' }, hd, ok, noop).then(function () { SCANNER.starting = false; }).catch(function (err1) {
            if (!SCANNER.isActive) return;
            if (/NotAllowed|Permission/i.test((err1 && (err1.message || err1.name)) || '')) { _camError(reader, err1); return; }
            // 2) fallback: basic settings
            var q2 = make(); SCANNER.html5Qr = q2;
            q2.start({ facingMode: 'environment' }, { fps: 15, qrbox: _scanBox, disableFlip: true }, ok, noop)
                .then(function () { SCANNER.starting = false; })
                .catch(function (err2) { SCANNER.html5Qr = null; _camError(reader, err2); });
        });
    });
}

function focusForBluetoothScanner() {
    var reader = document.getElementById('qr-reader');
    if (!reader) return;
    _stopCamera();
    _removeBtInput();
    SCANNER.isActive = true; SCANNER.handled = false;
    reader.innerHTML = '';
    SCANNER.btInput = document.createElement('input');
    SCANNER.btInput.type = 'text';
    SCANNER.btInput.autofocus = true;
    SCANNER.btInput.style.cssText = 'position:absolute;top:-200px;left:-200px;width:1px;height:1px;opacity:0;font-size:16px;';
    document.body.appendChild(SCANNER.btInput);
    reader.innerHTML = '<div style="padding:24px;text-align:center"><i class="bx bx-bluetooth" style="font-size:40px;color:var(--accent);display:block;margin-bottom:12px;animation:glow 2s infinite"></i><div style="font-size:14px;font-weight:700;color:var(--accent);margin-bottom:4px">Bluetooth Scanner Ready</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">Scan a barcode — the result will appear automatically</div><div style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;background:var(--accent-dim);border-radius:var(--radius-sm);border:1px solid rgba(var(--accent-rgb),.2)"><i class="bx bx-check-circle" style="color:var(--accent)"></i><span style="font-size:12px;color:var(--accent);font-weight:600">Waiting for scan...</span></div></div>';
    setTimeout(function () { if (SCANNER.btInput) SCANNER.btInput.focus(); }, 300);
    SCANNER.btInput.addEventListener('keydown', function (e) {
        if (!SCANNER.isActive) return;
        if (e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            var val = SCANNER.btInput.value.trim();
            SCANNER.btInput.value = '';
            if (val) scannerDeliver(val);
        }
        if (e.key === 'Tab') e.preventDefault();
    });
    SCANNER.btInput.addEventListener('blur', function () {
        if (SCANNER.isActive && SCANNER.btInput) setTimeout(function () { if (SCANNER.isActive && SCANNER.btInput) SCANNER.btInput.focus(); }, 100);
    });
}

// Modal jab bhi khule (kisi bhi screen se) — camera turant start; band ho to camera off
(function () {
    var m = document.getElementById('scannerModal');
    if (!m || !window.MutationObserver) return;
    new MutationObserver(function () {
        var open = m.style.display === 'flex';
        if (open && !SCANNER.html5Qr && !SCANNER.btInput && !SCANNER.starting) startCameraScan();
        if (!open && (SCANNER.html5Qr || SCANNER.btInput)) { SCANNER.isActive = false; _removeBtInput(); _stopCamera(); }
    }).observe(m, { attributes: true, attributeFilter: ['style'] });
})();

document.addEventListener('click', function(e) {
    var modal = document.getElementById('scannerModal');
    if (modal && modal.style.display === 'flex' && e.target === modal) closeScannerModal();
});

window.addEventListener('beforeunload', function() {
    if (SCANNER.html5Qr) try { SCANNER.html5Qr.stop(); } catch(e) {}
});
// ==================== SAP-STYLE DATE-WISE REPORTS ====================
var REPORT_TYPES = [
    {id:'inbound',icon:'bxs-truck',color:'var(--accent)',bg:'var(--accent-dim)',title:'Inbound Report',desc:'Vehicle-wise unloading, GRN & posting details',extras:[{id:'vehicleNo',label:'Vehicle No',type:'text',ph:'MH-12-AB-1234'},{id:'status',label:'Status',type:'select',opts:['All','Unload Pending','Assigned','Posting Pending Approval','Posted','Unloaded','Rejected']}]},
    {id:'outbound',icon:'bxs-truck',color:'var(--accent2)',bg:'var(--accent2-dim)',title:'Outbound / Loading Report',desc:'Loading, dispatch & loaded vehicle details',extras:[{id:'vehicleNo',label:'Vehicle No',type:'text',ph:'MH-12-AB-1234'},{id:'status',label:'Load Status',type:'select',opts:['All','Fully Loaded','Partial','With Mismatch']}]},
    {id:'picking',icon:'bxs-box',color:'var(--info)',bg:'var(--info-dim)',title:'Picking Report',desc:'OBD-wise picking activity & picker performance',extras:[{id:'pickerName',label:'Picker Name',type:'text',ph:'Name or username'},{id:'status',label:'OBD Status',type:'select',opts:['All','Pending','Assigned','Done','Picked','P&L Done']}]},
    {id:'stock',icon:'bxs-package',color:'var(--success)',bg:'rgba(var(--success-rgb),.1)',title:'Stock Position Report',desc:'Current stock by material, location & rack',extras:[{id:'material',label:'Material Keyword',type:'text',ph:'Rice, Sugar, Oil...'},{id:'rack',label:'Rack',type:'text',ph:'RACK-001'},{id:'action',label:'Action Type',type:'select',opts:['All','PUTAWAY','PIV']}]},
    {id:'short',icon:'bx-error-circle',color:'var(--danger)',bg:'var(--danger-dim)',title:'Short / Difference Report',desc:'All shortage, mismatch & difference records',extras:[{id:'vehicleNo',label:'Vehicle No',type:'text',ph:'MH-12-AB-1234'},{id:'material',label:'Material Keyword',type:'text',ph:'Material name'}]},
    {id:'user_activity',icon:'bx-time-five',color:'#8B5CF6',bg:'rgba(139,92,246,.1)',title:'User Activity Report',desc:'Who did what, when — complete audit trail',extras:[{id:'userName',label:'User Name',type:'text',ph:'Name or username'},{id:'module',label:'Module',type:'select',opts:['All','Auth','Security Gate','Inbound','Unloading','Posting','Putaway','PIV','Picking','Loading','Admin','System']}]},
    {id:'turnaround',icon:'bx-timer',color:'var(--warning)',bg:'var(--warning-dim)',title:'Vehicle Turnaround Report',desc:'Time analysis: arrival to posting per vehicle',extras:[{id:'vehicleNo',label:'Vehicle No',type:'text',ph:'MH-12-AB-1234'}]},
    {id:'putaway',icon:'bxs-clipboard',color:'#06B6D4',bg:'rgba(6,182,212,.1)',title:'Putaway / PIV Report',desc:'Item placement details — rack, qty, packing',extras:[{id:'material',label:'Material Keyword',type:'text',ph:'Material name'},{id:'rack',label:'Rack',type:'text',ph:'RACK-001'},{id:'action',label:'Action Type',type:'select',opts:['All','PUTAWAY','PIV']}]}
];

var RSTATE = {view:'select',type:null,from:'',to:'',filters:{}};
var LAST_REPORT = null;

function renderReports(){
    if(RSTATE.view==='select') renderReportSelect();
    else if(RSTATE.view==='filter') renderReportFilter();
    else if(RSTATE.view==='result') renderSAPReportView();
}

function renderReportSelect(){
    var h='<div class="section-header"><h2><i class="bx bxs-bar-chart-alt-2"></i> Reports</h2><div style="font-size:11px;color:var(--text-muted)">SAP-Style Date-Wise Reports</div></div>';
    h+='<div class="report-grid">';
    REPORT_TYPES.forEach(function(rt){
        h+='<div class="report-card" onclick="openReportFilter(\''+rt.id+'\')" style="--rc-color:'+rt.color+'">';
        h+='<div class="rc-icon" style="background:'+rt.bg+';color:'+rt.color+'"><i class="bx '+rt.icon+'"></i></div>';
        h+='<div class="rc-title">'+rt.title+'</div>';
        h+='<div class="rc-desc">'+rt.desc+'</div>';
        h+='</div>';
    });
    h+='</div>';
    setHtml(h);
}

function openReportFilter(typeId){
    RSTATE.view='filter';RSTATE.type=typeId;RSTATE.filters={};
    renderReportFilter();
}

function renderReportFilter(){
    var rt=null;
    for(var i=0;i<REPORT_TYPES.length;i++){if(REPORT_TYPES[i].id===RSTATE.type){rt=REPORT_TYPES[i];break;}}
    if(!rt){renderReportSelect();return;}
    var firstOfMonth=new Date();firstOfMonth.setDate(1);
    var fromDef=firstOfMonth.toISOString().split('T')[0];
    var toDef=today();

    var h='<div class="section-header"><h2><i class="bx bxs-bar-chart-alt-2"></i> Reports</h2></div>';
    h+='<div class="report-back-row"><button class="btn btn-glass btn-sm" onclick="RSTATE.view=\'select\';renderReports()"><i class="bx bx-arrow-back"></i> All Reports</button></div>';

    h+='<div class="report-filter-box">';
    h+='<div class="report-filter-header"><button class="rfh-back" onclick="RSTATE.view=\'select\';renderReports()"><i class="bx bx-arrow-back"></i></button><div class="rfh-title"><i class="bx '+rt.icon+'"></i> '+rt.title+'</div></div>';

    h+='<div class="report-date-row">';
    h+='<div class="form-group"><label>Date From <span class="req">*</span></label><input type="date" id="rptFrom" value="'+(RSTATE.from||fromDef)+'" min="2024-01-01" max="'+toDef+'"></div>';
    h+='<div class="form-group"><label>Date To <span class="req">*</span></label><input type="date" id="rptTo" value="'+(RSTATE.to||toDef)+'" min="2024-01-01" max="'+toDef+'"></div>';
    h+='</div>';

    if(rt.extras&&rt.extras.length){
        h+='<div class="report-extra-filters">';
        rt.extras.forEach(function(ex){
            h+='<div class="form-group"><label>'+ex.label+'</label>';
            if(ex.type==='text') h+='<input type="text" class="form-input" id="rptF_'+ex.id+'" placeholder="'+(ex.ph||'')+'">';
            else if(ex.type==='select'){
                h+='<select class="form-input" id="rptF_'+ex.id+'">';
                ex.opts.forEach(function(o){h+='<option value="'+o+'">'+o+'</option>';});
                h+='</select>';
            }
            h+='</div>';
        });
        h+='</div>';
    }

    h+='<div class="form-actions">';
    h+='<button class="btn btn-primary" onclick="runReport()"><i class="bx bx-play-circle"></i> Generate Report</button>';
    h+='<button class="btn btn-secondary" onclick="clearReportFilters()"><i class="bx bx-refresh"></i> Clear</button>';
    h+='</div>';
    h+='</div>';
    setHtml(h);
}

function clearReportFilters(){
    RSTATE.from='';RSTATE.to='';RSTATE.filters={};
    renderReportFilter();
}

async function runReport(){
    var from=document.getElementById('rptFrom').value;
    var to=document.getElementById('rptTo').value;
    if(!from||!to){showToast('Both Date From and Date To are required','error');return;}
    if(from>to){showToast('Date From must be earlier than Date To','error');return;}
    var filters={};
    var rt=null;
    for(var i=0;i<REPORT_TYPES.length;i++){if(REPORT_TYPES[i].id===RSTATE.type){rt=REPORT_TYPES[i];break;}}
    if(rt&&rt.extras){
        rt.extras.forEach(function(ex){
            var el=document.getElementById('rptF_'+ex.id);
            if(el)filters[ex.id]=el.value.trim();
        });
    }
    RSTATE.from=from;RSTATE.to=to;RSTATE.filters=filters;
    await sbPullFull('location_master',120000);   // ★ stock/putaway reports ke liye on-demand
    LAST_REPORT=buildReportData(RSTATE.type,from,to,filters);
    RSTATE.view='result';
    renderSAPReportView();
    logAction('Reports','GENERATED',RSTATE.type+' report: '+from+' to '+to);
}

function dateInRange(isoStr,from,to){
    if(!isoStr)return false;
    var d=isoStr.split('T')[0];
    return d>=from&&d<=to;
}

function statusBadge(s){
    if(!s)return'<span class="sap-badge gray">-</span>';
    var sl=s.toLowerCase();
    if(sl.indexOf('pending')>-1&&sl.indexOf('approval')<0)return'<span class="sap-badge yellow">'+esc(s)+'</span>';
    if(sl.indexOf('approval')>-1)return'<span class="sap-badge blue">'+esc(s)+'</span>';
    if(sl.indexOf('posted')>-1||sl.indexOf('done')>-1||sl.indexOf('loaded')>-1||sl.indexOf('picked')>-1||sl.indexOf('unloaded')>-1)return'<span class="sap-badge green">'+esc(s)+'</span>';
    if(sl.indexOf('reject')>-1)return'<span class="sap-badge red">'+esc(s)+'</span>';
    if(sl.indexOf('assign')>-1)return'<span class="sap-badge blue">'+esc(s)+'</span>';
    return'<span class="sap-badge gray">'+esc(s)+'</span>';
}

// ==================== BUILD REPORT DATA ====================
function buildReportData(type,from,to,filters){
    var u=APP.currentUser;
    var genBy=u?u.name:'System';
    var genAt=fmtDT(new Date());
    var period=fmtDate(from)+' to '+fmtDate(to);
    var data={type:type,period:period,generatedBy:genBy,generatedAt:genAt,headers:[],rows:[],totals:[],summary:[],numericCols:[],colWidths:[],colAlign:[]};

    switch(type){
    case 'inbound': buildInboundReport(data,from,to,filters); break;
    case 'outbound': buildOutboundReport(data,from,to,filters); break;
    case 'picking': buildPickingReport(data,from,to,filters); break;
    case 'stock': buildStockReport(data,from,to,filters); break;
    case 'short': buildShortReport(data,from,to,filters); break;
    case 'user_activity': buildUserActivityReport(data,from,to,filters); break;
    case 'turnaround': buildTurnaroundReport(data,from,to,filters); break;
    case 'putaway': buildPutawayReport(data,from,to,filters); break;
    }
    return data;
}

// --- INBOUND REPORT ---
function buildInboundReport(d,from,to,f){
    d.title='INBOUND REPORT';d.subtitle='Vehicle-wise Unloading & GRN Details';
    d.headers=['Sr','Vehicle No','LR No','Transport','Driver','Type','Status','Invoices','Materials','Reported At','Entry By'];
    d.numericCols=[7,8];d.colWidths=[22,68,58,52,48,38,62,32,38,72,48];
    d.colAlign=['center','left','left','left','left','center','center','center','center','center','left'];
    var vehs=DB.get('vehicles').filter(function(v){
        if(v.vehicleType!=='Unloading')return false;
        if(!dateInRange(v.reportedAt,from,to))return false;
        if(f.vehicleNo&&v.vehicleNo.toUpperCase().indexOf(f.vehicleNo.toUpperCase())<0)return false;
        if(f.status&&f.status!=='All'&&v.status!==f.status)return false;
        return true;
    });
    var totalInv=0,totalMat=0;
    vehs.forEach(function(v,i){
        var invs=DB.filter('invoices',function(inv){return inv.vehicleId===v.id;});
        var matC=0;invs.forEach(function(inv){matC+=DB.filter('invoice_materials',function(m){return m.invoiceId===inv.id;}).length;});
        totalInv+=invs.length;totalMat+=matC;
        d.rows.push([i+1,esc(v.vehicleNo),esc(v.lrNo||'-'),esc(v.transportName||'-'),esc(v.driverName||'-'),esc(v.vehicleType||'-'),statusBadge(v.status),invs.length,matC,fmtDT(v.reportedAt),esc(v.entryByName||'-')]);
    });
    d.totals=[['','TOTAL','','','','','',totalInv,totalMat,'','']];
    d.summary=[{label:'Total Vehicles',value:vehs.length},{label:'Total Invoices',value:totalInv},{label:'Total Material Lines',value:totalMat}];
}

// --- OUTBOUND/LOADING REPORT ---
function buildOutboundReport(d,from,to,f){
    d.title='OUTBOUND / LOADING REPORT';d.subtitle='Vehicle-wise Loading & Dispatch Details';
    d.headers=['Sr','Load No','Vehicle No','OBD Count','OBD Nos','Loaded By','Load Status','Mismatch','Loaded At'];
    d.numericCols=[3];d.colWidths=[22,68,68,32,100,52,48,32,72];
    d.colAlign=['center','left','left','center','left','left','center','center','center'];
    var loaded=DB.get('loaded_vehicles').filter(function(lv){
        if(!dateInRange(lv.loadedAt,from,to))return false;
        if(f.vehicleNo&&lv.vehicleNo.toUpperCase().indexOf(f.vehicleNo.toUpperCase())<0)return false;
        if(f.status&&f.status!=='All'){
            if(f.status==='Fully Loaded'&&lv.loadStatus!=='Fully Loaded')return false;
            if(f.status==='Partial'&&lv.loadStatus==='Fully Loaded')return false;
            if(f.status==='With Mismatch'&&!lv.mismatch)return false;
        }
        return true;
    });
    var totalOBD=0;
    loaded.forEach(function(lv,i){
        var obdNos=Array.isArray(lv.obdNos)?lv.obdNos.join(', '):(lv.obdNos||'-');
        var obdC=Array.isArray(lv.obdIds)?lv.obdIds.length:1;
        totalOBD+=obdC;
        d.rows.push([i+1,esc(lv.loadNo||'-'),esc(lv.vehicleNo||'-'),obdC,esc(obdNos),esc(lv.loadedByName||'-'),statusBadge(lv.loadStatus||'Loaded'),lv.mismatch?'<span class="sap-badge red">Yes</span>':'<span class="sap-badge green">No</span>',fmtDT(lv.loadedAt)]);
    });
    d.totals=[['','TOTAL','',''+totalOBD,'','','','','']];
    d.summary=[{label:'Vehicles Loaded',value:loaded.length},{label:'Total OBDs Dispatched',value:totalOBD},{label:'With Mismatch',value:loaded.filter(function(l){return l.mismatch;}).length}];
}

// --- PICKING REPORT ---
function buildPickingReport(d,from,to,f){
    d.title='PICKING REPORT';d.subtitle='OBD-wise Picking Activity';
    d.headers=['Sr','OBD No','Vehicle No','Materials','Status','Assigned To','Picked At','Created At'];
    d.numericCols=[3];d.colWidths=[22,68,68,32,52,58,72,72];
    d.colAlign=['center','left','left','center','center','left','center','center'];
    var obds=DB.get('obd_data').filter(function(o){
        var dt=o.pickedAt||o.assignedAt||o.createdAt;
        if(!dateInRange(dt,from,to))return false;
        if(f.pickerName){
            var pn=f.pickerName.toLowerCase();
            var an=(o.assignedToName||'').toLowerCase();
            if(an.indexOf(pn)<0)return false;
        }
        if(f.status&&f.status!=='All'&&o.status!==f.status)return false;
        return true;
    });
    var totalMat=0;
    obds.forEach(function(o,i){
        var matC=Array.isArray(o.materials)?o.materials.length:0;
        totalMat+=matC;
        d.rows.push([i+1,esc(o.obdNo||o.id),esc(o.vehicleNo||'-'),matC,statusBadge(o.status),esc(o.assignedToName||'-'),fmtDT(o.pickedAt),fmtDT(o.createdAt)]);
    });
    d.totals=[['','TOTAL','',''+totalMat,'','','','']];
    d.summary=[{label:'Total OBDs',value:obds.length},{label:'Total Material Lines',value:totalMat},{label:'Pending',value:obds.filter(function(o){return o.status==='Pending';}).length},{label:'Completed',value:obds.filter(function(o){return o.status==='Done'||o.status==='Picked'||o.status==='P&L Done';}).length}];
}

// --- STOCK POSITION REPORT ---
function buildStockReport(d,from,to,f){
    d.title='STOCK POSITION REPORT';d.subtitle='Current Stock by Material & Location';
    d.headers=['Sr','Material','EAN','Rack','Qty','Packing','Box','Action','Date','User'];
    d.numericCols=[4];d.colWidths=[22,130,72,48,28,38,38,38,52,48];
    d.colAlign=['center','left','left','center','center','center','center','center','center','left'];
    var locs=DB.get('location_master').filter(function(l){
        if(!dateInRange(l.dateTime||l.date,from,to))return false;
        if(f.material&&l.material.toUpperCase().indexOf(f.material.toUpperCase())<0)return false;
        if(f.rack&&l.rack.toUpperCase().indexOf(f.rack.toUpperCase())<0)return false;
        if(f.action&&f.action!=='All'&&l.action!==f.action)return false;
        return true;
    });
    var totalQty=0;
    locs.forEach(function(l,i){
        totalQty+=(parseInt(l.quantity)||0);
        d.rows.push([i+1,esc(l.material),esc(l.ean||'-'),esc(l.rack),(l.quantity||0),esc(l.packing||'-'),esc(l.box||'-'),'<span class="sap-badge '+(l.action==='PUTAWAY'?'green':'blue')+'">'+esc(l.action||'-')+'</span>',fmtDate(l.dateTime||l.date),esc(l.user||'-')]);
    });
    d.totals=[['','TOTAL','','',totalQty,'','','','','']];
    // Group by material for summary
    var byMat={};locs.forEach(function(l){if(!byMat[l.material])byMat[l.material]=0;byMat[l.material]+=(parseInt(l.quantity)||0);});
    var matKeys=Object.keys(byMat);
    d.summary=[{label:'Total Location Entries',value:locs.length},{label:'Total Quantity',value:totalQty},{label:'Unique Materials',value:matKeys.length},{label:'Racks Used',value:(function(){var s={};locs.forEach(function(l){s[l.rack]=1;});return Object.keys(s).length;})()}];
}

// --- SHORT / DIFFERENCE REPORT ---
function buildShortReport(d,from,to,f){
    d.title='SHORT / DIFFERENCE REPORT';d.subtitle='All Shortage & Mismatch Records';
    d.headers=['Sr','Short No','Vehicle No','Material','EAN','Expected','Found','Short Qty','Reported By','Date'];
    d.numericCols=[5,6,7];d.colWidths=[22,58,68,120,72,32,32,32,52,52];
    d.colAlign=['center','left','left','left','left','center','center','center','left','center'];
    var shorts=DB.get('short_reports').filter(function(s){
        if(!dateInRange(s.createdAt,from,to))return false;
        if(f.vehicleNo&&s.vehicleNo&&s.vehicleNo.toUpperCase().indexOf(f.vehicleNo.toUpperCase())<0)return false;
        if(f.material&&s.material&&s.material.toUpperCase().indexOf(f.material.toUpperCase())<0)return false;
        return true;
    });
    var totalExp=0,totalFnd=0,totalSrt=0;
    shorts.forEach(function(s,i){
        var exp=parseInt(s.expectedQty)||0;var fnd=parseInt(s.foundQty)||0;var srt=parseInt(s.shortQty)||(exp-fnd);
        totalExp+=exp;totalFnd+=fnd;totalSrt+=srt;
        d.rows.push([i+1,esc(s.shortNo||'-'),esc(s.vehicleNo||'-'),esc(s.material||'-'),esc(s.ean||'-'),exp,fnd,'<span style="color:var(--danger);font-weight:700">'+srt+'</span>',esc(s.reportedBy||s.reportedByName||'-'),fmtDT(s.createdAt)]);
    });
    d.totals=[['','TOTAL','','','',totalExp,totalFnd,'<span style="color:var(--danger);font-weight:700">'+totalSrt+'</span>','','']];
    d.summary=[{label:'Total Short Reports',value:shorts.length},{label:'Total Expected',value:totalExp},{label:'Total Found',value:totalFnd},{label:'Total Shortage',value:totalSrt}];
}

// --- USER ACTIVITY REPORT ---
function buildUserActivityReport(d,from,to,f){
    d.title='USER ACTIVITY REPORT';d.subtitle='Complete Audit Trail';
    d.headers=['Sr','Date / Time','User','Role','Module','Action','Details'];
    d.numericCols=[];d.colWidths=[22,62,52,42,52,52,200];
    d.colAlign=['center','center','left','center','left','left','left'];
    var logs=DB.get('audit_log').filter(function(a){
        if(!dateInRange(a.dateTime,from,to))return false;
        if(f.userName){
            var un=f.userName.toLowerCase();
            if((a.userName||'').toLowerCase().indexOf(un)<0)return false;
        }
        if(f.module&&f.module!=='All'&&a.module!==f.module)return false;
        return true;
    });
    logs.forEach(function(a,i){
        var user=DB.find('users',a.userId);
        var role=user?user.role:'-';
        d.rows.push([i+1,fmtDT(a.dateTime),esc(a.userName||'-'),esc(role),esc(a.module||'-'),esc(a.action||'-'),esc(a.details||'-')]);
    });
    // Group by user for summary
    var byUser={};logs.forEach(function(a){if(!byUser[a.userName])byUser[a.userName]=0;byUser[a.userName]++;});
    var uKeys=Object.keys(byUser);
    d.summary=[{label:'Total Actions',value:logs.length},{label:'Active Users',value:uKeys.length}];
    if(uKeys.length>0){
        d.summary.push({label:'Most Active',value:uKeys.reduce(function(a,b){return byUser[a]>byUser[b]?a:b;})+' ('+byUser[uKeys.reduce(function(a,b){return byUser[a]>byUser[b]?a:b;})]+' actions)'});
    }
}

// --- VEHICLE TURNAROUND REPORT ---
function buildTurnaroundReport(d,from,to,f){
    d.title='VEHICLE TURNAROUND REPORT';d.subtitle='Time Analysis: Arrival to Posting';
    d.headers=['Sr','Vehicle No','LR No','Transport','Arrival','Assigned At','Unload Start','Posted At','Total Time','Status'];
    d.numericCols=[];d.colWidths=[22,64,56,50,60,60,60,60,50,52];
    d.colAlign=['center','left','left','left','center','center','center','center','center','center'];
    var vehs=DB.get('vehicles').filter(function(v){
        if(v.vehicleType!=='Unloading')return false;
        if(!dateInRange(v.reportedAt,from,to))return false;
        if(f.vehicleNo&&v.vehicleNo.toUpperCase().indexOf(f.vehicleNo.toUpperCase())<0)return false;
        return true;
    });
    var totalTimeMins=0;var timedCount=0;
    vehs.forEach(function(v,i){
        var arr=v.reportedAt;var assigned=v.assignedAt;var unloadStart=v.unloadStartAt;var posted=v.postedAt;
        var totalTime='-';
        if(arr&&posted){totalTime=timeDiff(arr,posted);var ms=new Date(posted)-new Date(arr);totalTimeMins+=Math.floor(ms/60000);timedCount++;}
        d.rows.push([i+1,esc(v.vehicleNo),esc(v.lrNo||'-'),esc(v.transportName||'-'),fmtDT(arr),fmtDT(assigned),fmtDT(unloadStart),fmtDT(posted),totalTime,statusBadge(v.status)]);
    });
    var avgTime=timedCount>0?Math.round(totalTimeMins/timedCount):0;
    var avgStr=avgTime>=60?Math.floor(avgTime/60)+'h '+avgTime%60+'m':avgTime+'m';
    d.totals=[['','AVERAGE TURNAROUND: '+avgStr+'','','','','','','','','']];
    d.summary=[{label:'Total Vehicles',value:vehs.length},{label:'Avg Turnaround',value:avgStr},{label:'Posted',value:vehs.filter(function(v){return v.status==='Posted'||v.status==='Unloaded';}).length},{label:'Pending',value:vehs.filter(function(v){return v.status==='Unload Pending'||v.status==='Assigned';}).length}];
}

// --- PUTAWAY / PIV REPORT ---
function buildPutawayReport(d,from,to,f){
    d.title='PUTAWAY / PIV REPORT';d.subtitle='Item Placement Details';
    d.headers=['Sr','Date','Material','EAN','Rack','Qty','Packing','Box','Action','User','Time'];
    d.numericCols=[5];d.colWidths=[22,42,120,72,48,28,38,38,38,42,42];
    d.colAlign=['center','center','left','left','center','center','center','center','center','left','center'];
    var locs=DB.get('location_master').filter(function(l){
        if(!dateInRange(l.dateTime||l.date,from,to))return false;
        if(f.material&&l.material.toUpperCase().indexOf(f.material.toUpperCase())<0)return false;
        if(f.rack&&l.rack.toUpperCase().indexOf(f.rack.toUpperCase())<0)return false;
        if(f.action&&f.action!=='All'&&l.action!==f.action)return false;
        return true;
    });
    var totalQty=0;var putC=0;var pivC=0;
    locs.forEach(function(l,i){
        var q=parseInt(l.quantity)||0;totalQty+=q;
        if(l.action==='PUTAWAY')putC++;else pivC++;
        d.rows.push([i+1,fmtDate(l.dateTime||l.date),esc(l.material),esc(l.ean||'-'),esc(l.rack),q,esc(l.packing||'-'),esc(l.box||'-'),'<span class="sap-badge '+(l.action==='PUTAWAY'?'green':'blue')+'">'+esc(l.action||'-')+'</span>',esc(l.user||'-'),l.dateTime?new Date(l.dateTime).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'-']);
    });
    d.totals=[['','TOTAL','','','',totalQty,'','','','','']];
    d.summary=[{label:'Total Entries',value:locs.length},{label:'Total Quantity',value:totalQty},{label:'Putaway',value:putC},{label:'PIV',value:pivC}];
}

// ==================== RENDER SAP REPORT VIEW ====================
function renderSAPReportView(){
    var d=LAST_REPORT;if(!d){renderReportSelect();return;}
    var rt=null;for(var i=0;i<REPORT_TYPES.length;i++){if(REPORT_TYPES[i].id===d.type){rt=REPORT_TYPES[i];break;}}

    var h='<div class="section-header"><h2><i class="bx bxs-bar-chart-alt-2"></i> Reports</h2></div>';
    h+='<div class="report-back-row">';
    h+='<button class="btn btn-glass btn-sm" onclick="RSTATE.view=\'filter\';renderReports()"><i class="bx bx-arrow-back"></i> Change Filters</button>';
    h+='<button class="btn btn-glass btn-sm" onclick="RSTATE.view=\'select\';renderReports()"><i class="bx bx-grid-alt"></i> All Reports</button>';
    h+='</div>';

    // SAP Header
    h+='<div class="sap-report-header">';
    h+='<div class="srh-company"><h2>VIP INDUSTRIES LIMITED (MD20)</h2><p>Warehouse Management System</p></div>';
    h+='<div class="srh-divider"></div>';
    h+='<div class="srh-info">';
    h+='<span>Report: <strong>'+esc(d.title)+'</strong></span>';
    h+='<span>Period: <strong>'+esc(d.period)+'</strong></span>';
    h+='<span>Generated: <strong>'+esc(d.generatedBy)+'</strong> | '+esc(d.generatedAt)+'</span>';
    h+='</div>';

    // Title bar with exports
    h+='<div class="srh-title-bar"><h3><i class="bx '+(rt?rt.icon:'bxs-bar-chart-alt-2')+'"></i> '+esc(d.subtitle||d.title)+'</h3>';
    h+='<div class="report-export-bar">';
    h+='<button class="rex-btn excel" onclick="exportReportExcel()"><i class="bx bxs-file"></i> Excel</button>';
    h+='<button class="rex-btn pdf" onclick="exportReportPDF()"><i class="bx bxs-file-pdf"></i> PDF</button>';
    h+='<button class="rex-btn" onclick="window.print()"><i class="bx bx-printer"></i> Print</button>';
    h+='</div></div>';

    // Summary bar
    if(d.summary&&d.summary.length){
        h+='<div class="report-summary-bar">';
        d.summary.forEach(function(s){h+='<div class="rsb-item">'+esc(s.label)+': <strong>'+esc(String(s.value))+'</strong></div>';});
        h+='</div>';
    }

    h+='</div>'; // close sap-report-header

    // Table
    if(d.rows.length===0){
        h+='<div class="report-empty"><i class="bx bx-inbox"></i><p>No records found for selected criteria</p><div class="re-filters">Period: '+esc(d.period)+'</div></div>';
    }else{
        h+='<div class="sap-table-wrap"><table class="sap-table"><thead><tr>';
        d.headers.forEach(function(th,idx){
            var cls='';if(d.numericCols.indexOf(idx)>-1)cls=' num';if(d.colAlign[idx]==='center')cls=' center';
            h+='<th class="'+cls.trim()+'">'+esc(th)+'</th>';
        });
        h+='</tr></thead><tbody>';
        d.rows.forEach(function(row){
            h+='<tr>';
            row.forEach(function(cell,idx){
                var cls='';if(d.numericCols.indexOf(idx)>-1)cls=' num';if(d.colAlign[idx]==='center')cls=' center';
                h+='<td class="'+cls.trim()+'">'+cell+'</td>';
            });
            h+='</tr>';
        });
        if(d.totals&&d.totals.length){
            d.totals.forEach(function(trow,ti){
                var isGrand=ti===d.totals.length-1;
                h+='<tr class="'+(isGrand?'grand-total':'total-row')+'">';
                trow.forEach(function(cell,idx){
                    var cls='';if(d.numericCols.indexOf(idx)>-1)cls=' num';if(d.colAlign[idx]==='center')cls=' center';
                    h+='<td class="'+cls.trim()+'">'+cell+'</td>';
                });
                h+='</tr>';
            });
        }
        h+='</tbody></table></div>';
        h+='<div class="report-record-count"><span>Showing '+d.rows.length+' record'+(d.rows.length!==1?'s':'')+'</span><span>VIP INDUSTRIES LIMITED (MD20) — Confidential</span></div>';
    }
    setHtml(h);
}

// ==================== EXCEL EXPORT ====================
function exportReportExcel(){
    if(!LAST_REPORT){showToast('No report to export','error');return;}
    var d=LAST_REPORT;
    var ws_data=[];
    ws_data.push(['VIP INDUSTRIES LIMITED (MD20)']);
    ws_data.push(['Warehouse Management System']);
    ws_data.push([]);
    ws_data.push([d.title]);
    if(d.subtitle)ws_data.push([d.subtitle]);
    ws_data.push(['Period: '+d.period]);
    ws_data.push(['Generated By: '+d.generatedBy+' | '+d.generatedAt]);
    ws_data.push([]);
    if(d.summary&&d.summary.length){
        d.summary.forEach(function(s){ws_data.push([s.label+': ',s.value]);});
        ws_data.push([]);
    }
    ws_data.push(d.headers);
    // Clean HTML from rows for Excel
    d.rows.forEach(function(row){
        ws_data.push(row.map(function(cell){
            if(typeof cell!=='string')return cell;
            return cell.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
        }));
    });
    if(d.totals&&d.totals.length){
        ws_data.push([]);
        d.totals.forEach(function(trow){
            ws_data.push(trow.map(function(cell){
                if(typeof cell!=='string')return cell;
                return cell.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
            }));
        });
    }
    var ws=XLSX.utils.aoa_to_sheet(ws_data);
    var colCount=d.headers.length;
    ws['!merges']=[
        {s:{r:0,c:0},e:{r:0,c:colCount-1}},
        {s:{r:1,c:0},e:{r:1,c:colCount-1}},
        {s:{r:3,c:0},e:{r:3,c:colCount-1}}
    ];
    if(d.subtitle)ws['!merges'].push({s:{r:4,c:0},e:{r:4,c:colCount-1}});
    var widths=d.colWidths||d.headers.map(function(){return 15;});
    ws['!cols']=widths.map(function(w){return{wch:w};});
    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,d.title.substring(0,31));
    XLSX.writeFile(wb,d.title.replace(/\s+/g,'_')+'_'+today()+'.xlsx');
    showToast('Excel downloaded!','success');
    logAction('Reports','EXPORT_EXCEL',d.title+' | '+d.period);
}

// ==================== PDF EXPORT ====================
function exportReportPDF(){
    if(!LAST_REPORT){showToast('No report to export','error');return;}
    var d=LAST_REPORT;
    var doc=new jspdf.jsPDF('l','mm','a4');
    var pw=doc.internal.pageSize.getWidth();
    var isDark=APP.theme==='dark';

    // Company header
    doc.setFontSize(15);doc.setFont(undefined,'bold');
    doc.setTextColor(isDark?0:60,isDark?180:120,isDark?120:60);
    doc.text('VIP INDUSTRIES LIMITED (MD20)',pw/2,14,{align:'center'});
    doc.setFontSize(9);doc.setFont(undefined,'normal');doc.setTextColor(100);
    doc.text('Warehouse Management System',pw/2,20,{align:'center'});

    // Line
    doc.setDrawColor(0,180,120);doc.setLineWidth(0.6);
    doc.line(14,24,pw-14,24);

    // Title
    doc.setFontSize(12);doc.setFont(undefined,'bold');doc.setTextColor(30);
    doc.text(d.title,14,32);
    var yOff=38;
    if(d.subtitle){doc.setFontSize(9);doc.setFont(undefined,'normal');doc.setTextColor(80);doc.text(d.subtitle,14,yOff);yOff+=5;}

    // Period
    doc.setFontSize(8);doc.setTextColor(100);
    doc.text('Period: '+d.period+'    |    Generated By: '+d.generatedBy+'    |    '+d.generatedAt,14,yOff);
    yOff+=6;

    // Summary line
    if(d.summary&&d.summary.length){
        var sumStr=d.summary.map(function(s){return s.label+': '+s.value;}).join('   |   ');
        doc.setFontSize(8);doc.setTextColor(50);doc.setFont(undefined,'bold');
        doc.text(sumStr,14,yOff);
        yOff+=4;
        doc.setDrawColor(200);doc.setLineWidth(0.3);doc.line(14,yOff,pw-14,yOff);
        yOff+=3;
    }

    // Clean rows for PDF
    var cleanRows=d.rows.map(function(row){return row.map(function(cell){if(typeof cell!=='string')return cell;return cell.replace(/<[^>]*>/g,'');});});
    var cleanTotals=d.totals?d.totals.map(function(row){return row.map(function(cell){if(typeof cell!=='string')return cell;return cell.replace(/<[^>]*>/g,'');});}):[];

    var aligns=d.colAlign||[];

    doc.autoTable({
        head:[d.headers],
        body:cleanRows,
        startY:yOff,
        theme:'grid',
        headStyles:{fillColor:[0,180,120],textColor:[5,8,16],fontStyle:'bold',fontSize:7.5,halign:'center',cellPadding:3},
        bodyStyles:{fontSize:7,textColor:[30,30,30],cellPadding:2.5},
        alternateRowStyles:{fillColor:[245,248,250]},
        columnStyles:aligns.map(function(a){return{halign:a==='center'?'center':a==='right'?'right':'left'};}),
        didDrawPage:function(data){
            doc.setFontSize(7);doc.setTextColor(150);
            doc.text('Page '+doc.internal.getNumberOfPages(),pw/2,doc.internal.pageSize.getHeight()-8,{align:'center'});
            doc.text('VIP INDUSTRIES LIMITED (MD20) — Confidential',14,doc.internal.pageSize.getHeight()-8);
        }
    });

    // Totals
    if(cleanTotals.length>0){
        var finalY=doc.lastAutoTable.finalY+3;
        if(finalY>doc.internal.pageSize.getHeight()-20){doc.addPage();finalY=20;}
        doc.autoTable({
            head:[d.headers],
            body:cleanTotals,
            startY:finalY,
            theme:'plain',
            bodyStyles:{fontStyle:'bold',fillColor:[220,240,230],fontSize:7.5,cellPadding:3,textColor:[20,20,20]},
            columnStyles:aligns.map(function(a){return{halign:a==='center'?'center':a==='right'?'right':'left'};})
        });
    }

    doc.save(d.title.replace(/\s+/g,'_')+'_'+today()+'.pdf');
    showToast('PDF downloaded!','success');
    logAction('Reports','EXPORT_PDF',d.title+' | '+d.period);
}
// ============================================================
// SAP SMART TABLE — filter bar + variant management
// ============================================================
var ST = { seq: 0 };

function stRows(t) {
    return [].filter.call(t.querySelectorAll('tbody tr'), function (tr) {
        return tr.children.length > 1 && !tr.querySelector('td[colspan]');
    });
}
function stKey(t) {
    var h = [].map.call(t.querySelectorAll('thead th'), function (x) { return x.textContent.trim(); }).join('|');
    return 'wms_var_' + (APP.currentSection || '') + '_' + (APP.currentSub || '') + '_' + h.substring(0, 120);
}
function stLoad(k) {
    try { var o = JSON.parse(localStorage.getItem(k) || ''); if (o && o.list) return o; } catch (e) {}
    return { list: {}, def: '' };
}
function stPersist(bar) { try { localStorage.setItem(bar._key, JSON.stringify(bar._vars)); } catch (e) {} }
function stClone(s) { return { search: s.search || '', col: s.col || '', hidden: (s.hidden || []).slice() }; }
function stClean(n) { return String(n || '').replace(/["'<>&]/g, '').trim().substring(0, 30); }

function stApply(bar) {
    var t = bar._table, s = bar._state, q = (s.search || '').toLowerCase(), shown = 0, total = 0;
    stRows(t).forEach(function (tr) {
        total++;
        var ok = true;
        if (q) {
            if (s.col === '') ok = tr.textContent.toLowerCase().indexOf(q) > -1;
            else { var td = tr.children[parseInt(s.col, 10)]; ok = !!td && td.textContent.toLowerCase().indexOf(q) > -1; }
        }
        tr.style.display = ok ? '' : 'none';
        if (ok) shown++;
    });
    var n = t.querySelectorAll('thead th').length;
    for (var i = 0; i < n; i++) {
        var hid = s.hidden.indexOf(i) > -1;
        [].forEach.call(t.querySelectorAll('tr'), function (tr) {
            if (tr.querySelector('td[colspan]')) return;
            var c = tr.children[i]; if (c) c.style.display = hid ? 'none' : '';
        });
    }
    bar.querySelector('.st-count').textContent = shown + ' / ' + total + ' rows';
}
function stSync(bar) {
    var s = bar._state;
    bar.querySelector('.st-q').value = s.search;
    bar.querySelector('.st-col').value = s.col;
    [].forEach.call(bar.querySelectorAll('.st-pop input'), function (cb) { cb.checked = s.hidden.indexOf(parseInt(cb.value, 10)) < 0; });
}
function stFill(bar) {
    var v = bar._vars, h = '<option value="">Standard</option>';
    Object.keys(v.list).forEach(function (n) {
        h += '<option value="' + n + '"' + (bar._cur === n ? ' selected' : '') + '>' + (v.def === n ? '★ ' : '') + n + '</option>';
    });
    bar.querySelector('.st-vsel').innerHTML = h;
}

function stBuild(wrap) {
    if (wrap.dataset.st) return;
    var t = wrap.querySelector('table.data-table');
    if (!t || stRows(t).length < 5) { wrap.dataset.st = 'x'; return; }

    var heads = [].map.call(t.querySelectorAll('thead th'), function (x) { return x.textContent.trim(); });
    var bar = document.createElement('div');
    bar.className = 'st-bar'; bar.id = 'st' + (++ST.seq);
    bar._table = t; bar._key = stKey(t); bar._vars = stLoad(bar._key); bar._cur = '';
    bar._state = { search: '', col: '', hidden: [] };
    if (bar._vars.def && bar._vars.list[bar._vars.def]) { bar._cur = bar._vars.def; bar._state = stClone(bar._vars.list[bar._cur]); }

    var colOpts = '<option value="">All columns</option>', pop = '';
    heads.forEach(function (h, i) {
        var nm = h || '(Actions)';
        colOpts += '<option value="' + i + '">' + esc(nm) + '</option>';
        pop += '<label><input type="checkbox" value="' + i + '" checked> ' + esc(nm) + '</label>';
    });
    bar.innerHTML =
        '<div class="st-var"><select class="st-vsel" title="Variant"></select>' +
        '<button class="st-ic st-save" title="Save variant"><i class="bx bx-save"></i></button>' +
        '<button class="st-ic st-def" title="Set as default"><i class="bx bx-star"></i></button>' +
        '<button class="st-ic st-del" title="Delete variant"><i class="bx bx-trash"></i></button></div>' +
        '<div class="st-search"><i class="bx bx-search"></i><input class="st-q" type="text" placeholder="Search"></div>' +
        '<select class="st-col" title="Filter column">' + colOpts + '</select>' +
        '<button class="st-ic st-cols" title="Columns"><i class="bx bx-columns"></i></button>' +
        '<button class="st-ic st-xls" title="Export to Excel"><i class="bx bx-spreadsheet"></i></button>' +
        '<span class="st-count"></span><div class="st-pop">' + pop + '</div>';

    wrap.parentNode.insertBefore(bar, wrap);
    wrap.dataset.st = bar.id;

    var q = bar.querySelector('.st-q'), colSel = bar.querySelector('.st-col'), popEl = bar.querySelector('.st-pop');
    stFill(bar); stSync(bar); stApply(bar);

    q.addEventListener('input', function () { bar._state.search = q.value.trim(); stApply(bar); });
    colSel.addEventListener('change', function () { bar._state.col = colSel.value; stApply(bar); });

    bar.querySelector('.st-vsel').addEventListener('change', function () {
        bar._cur = this.value;
        bar._state = bar._cur ? stClone(bar._vars.list[bar._cur]) : { search: '', col: '', hidden: [] };
        stSync(bar); stApply(bar);
    });
    bar.querySelector('.st-save').addEventListener('click', function () {
        var name = bar._cur;
        if (!(name && confirm('Overwrite variant "' + name + '"?\n(Cancel = save as new)'))) {
            name = stClean(prompt('Variant name:', ''));
            if (!name) return;
        }
        bar._vars.list[name] = stClone(bar._state); bar._cur = name;
        stPersist(bar); stFill(bar); showToast('Variant saved: ' + name, 'success');
    });
    bar.querySelector('.st-def').addEventListener('click', function () {
        if (!bar._cur) { bar._vars.def = ''; stPersist(bar); stFill(bar); showToast('Standard is the default', 'info'); return; }
        bar._vars.def = (bar._vars.def === bar._cur) ? '' : bar._cur;
        stPersist(bar); stFill(bar); showToast(bar._vars.def ? 'Default variant set' : 'Default removed', 'success');
    });
    bar.querySelector('.st-del').addEventListener('click', function () {
        if (!bar._cur) { showToast('Select a variant first', 'warning'); return; }
        if (!confirm('Delete variant "' + bar._cur + '"?')) return;
        delete bar._vars.list[bar._cur];
        if (bar._vars.def === bar._cur) bar._vars.def = '';
        bar._cur = ''; bar._state = { search: '', col: '', hidden: [] };
        stPersist(bar); stFill(bar); stSync(bar); stApply(bar);
    });
    bar.querySelector('.st-cols').addEventListener('click', function (e) { e.stopPropagation(); popEl.classList.toggle('open'); });
    popEl.addEventListener('click', function (e) { e.stopPropagation(); });
    popEl.addEventListener('change', function () {
        var hid = [];
        [].forEach.call(popEl.querySelectorAll('input'), function (cb) { if (!cb.checked) hid.push(parseInt(cb.value, 10)); });
        bar._state.hidden = hid; stApply(bar);
    });
    bar.querySelector('.st-xls').addEventListener('click', function () {
        if (typeof XLSX === 'undefined') { showToast('Excel library not loaded', 'error'); return; }
        var hid = bar._state.hidden, aoa = [], head = [];
        [].forEach.call(t.querySelectorAll('thead th'), function (th, i) { if (hid.indexOf(i) < 0) head.push(th.textContent.trim()); });
        aoa.push(head);
        stRows(t).forEach(function (tr) {
            if (tr.style.display === 'none') return;
            var r = [];
            [].forEach.call(tr.children, function (td, i) { if (hid.indexOf(i) < 0) r.push(td.textContent.trim()); });
            aoa.push(r);
        });
        var ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Export');
        XLSX.writeFile(wb, 'Export_' + (APP.currentSub || APP.currentSection || 'table') + '_' + today() + '.xlsx');
        showToast('Excel downloaded!', 'success');
    });
}
document.addEventListener('click', function () {
    [].forEach.call(document.querySelectorAll('.st-pop.open'), function (p) { p.classList.remove('open'); });
});
(function () {
    var ca = document.getElementById('contentArea'), pend = false;
    if (!ca) return;
    function run() {
        pend = false;
        [].forEach.call(ca.querySelectorAll('.table-wrapper'), stBuild);
        [].forEach.call(ca.querySelectorAll('.st-bar'), function (b) {
            var n = b.nextElementSibling;
            if (!n || !n.classList.contains('table-wrapper') || n.dataset.st !== b.id) b.remove();
        });
    }
    new MutationObserver(function () { if (!pend) { pend = true; setTimeout(run, 60); } })
        .observe(ca, { childList: true, subtree: true });
})();

// ============================================================
// SAP OBJECT PAGE HEADER
// ============================================================
function opApply(o) {
    var el = document.getElementById('sec-content'); if (!el || !o) return;
    var h = '<div class="op-header"><div class="op-top"><div class="op-avatar"><i class="bx ' + o.icon + '"></i></div>' +
        '<div><div class="op-title">' + esc(o.title) + '</div><div class="op-sub">' + esc(o.sub) + '</div></div></div>' +
        '<div class="op-facts">';
    (o.facts || []).forEach(function (f) {
        h += '<div class="op-fact ' + (f.c || '') + '"><small>' + esc(f.l) + '</small><b>' + esc(String(f.v)) + '</b></div>';
    });
    h += '</div></div>';
    var tmp = document.createElement('div'); tmp.innerHTML = h;
    var node = tmp.firstChild;
    var sh = el.querySelector('.section-header');
    if (sh) sh.parentNode.replaceChild(node, sh); else el.insertBefore(node, el.firstChild);
    el.classList.add('op-page');

    var tabs = '', n = 0;
    [].forEach.call(el.querySelectorAll('.card'), function (c, i) {
        var t = c.querySelector('.card-title'); if (!t) return;
        c.id = 'op-sec-' + i;
        tabs += '<a class="op-tab' + (n === 0 ? ' active' : '') + '" data-t="op-sec-' + i + '">' + esc(t.textContent.trim()) + '</a>';
        n++;
    });
    if (n > 1) {
        var tb = document.createElement('div'); tb.className = 'op-tabs'; tb.innerHTML = tabs;
        node.appendChild(tb);
        tb.addEventListener('click', function (e) {
            var a = e.target.closest('.op-tab'); if (!a) return;
            [].forEach.call(tb.querySelectorAll('.op-tab'), function (x) { x.classList.remove('active'); });
            a.classList.add('active');
            var target = document.getElementById(a.getAttribute('data-t'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
}
function opWrap(fnName, metaFn) {
    var orig = window[fnName];
    window[fnName] = function () {
        orig.apply(this, arguments);
        try { opApply(metaFn()); } catch (e) { console.warn('Object header error:', e); }
    };
}

// ---- Unloading (Goods Receipt) ----
opWrap('renderUnloadingScreen', function () {
    if (!APP.currentUser) return null;
    var id = APP.currentUser.id;
    var pend = DB.filter('vehicles', function (v) { return v.assignedTo === id && (v.status === 'Assigned' || v.status === 'Unload Pending'); }).length;
    var part = DB.filter('vehicles', function (v) { return v.assignedTo === id && v.status === 'Partial Unload'; }).length;
    var done = DB.filter('vehicles', function (v) { return v.unloadedBy === id && (v.status === 'Posting Pending Approval' || v.status === 'Posted'); }).length;
    return {
        icon: 'bx-package', title: 'Goods Receipt', sub: 'My unloading tasks — ' + APP.currentUser.name,
        facts: [
            { l: 'Status', v: pend + part > 0 ? 'In Process' : 'Open', c: pend + part > 0 ? 'warn' : 'ok' },
            { l: 'Pending Start', v: pend, c: pend ? 'warn' : '' },
            { l: 'Partial (Resume)', v: part, c: part ? 'info' : '' },
            { l: 'Submitted', v: done, c: 'ok' }
        ]
    };
});

// ---- Picking (Confirm Picking Task) ----
opWrap('renderStartPicking', function () {
    if (!APP.currentUser) return null;
    var my = DB.filter('picking_assignments', function (a) { return a.assignedTo === APP.currentUser.id && a.status === 'Assigned' && a.type !== 'pickandload'; });
    var need = 0, locked = 0, picked = 0;
    my.forEach(function (a) {
        var obd = DB.find('obd_data', a.obdId);
        if (obd) (obd.materials || []).forEach(function (m) { need += m.qty; });
        DB.filter('location_locks', function (l) { return l.obdId === a.obdId && l.status === 'Locked'; })
            .forEach(function (l) { locked += l.lockedQty; picked += l.pickedQty; });
    });
    var pct = need > 0 ? Math.round(picked / need * 100) : 0;
    return {
        icon: 'bxs-box', title: 'Confirm Picking Task', sub: 'My warehouse tasks — ' + APP.currentUser.name,
        facts: [
            { l: 'Status', v: my.length ? 'In Process' : 'No Tasks', c: my.length ? 'warn' : 'ok' },
            { l: 'Open Deliveries', v: my.length, c: 'info' },
            { l: 'Required Qty', v: need },
            { l: 'Locked Qty', v: locked, c: locked >= need && need > 0 ? 'ok' : 'warn' },
            { l: 'Picked', v: picked + ' (' + pct + '%)', c: pct >= 100 ? 'ok' : '' }
        ]
    };
});

// ---- Loading (Execute Loading) ----
opWrap('renderStartLoading', function () {
    if (!APP.currentUser) return null;
    var my = DB.filter('loading_assignments', function (a) {
        if (a.status !== 'Assigned') return false;
        if (a.assignedTo === APP.currentUser.id) return true;
        var an = (a.assignedToName || '').toLowerCase().trim(), cn = (APP.currentUser.name || '').toLowerCase().trim();
        return an && cn && an === cn;
    });
    var cnt = 0, qty = 0;
    my.forEach(function (a) {
        (a.obdIds || []).forEach(function (oid) {
            var pd = DB.find('picking_done', oid); if (!pd) return;
            cnt++; (pd.details || []).forEach(function (d) { qty += d.pickedQty; });
        });
    });
    var partial = DB.filter('loaded_vehicles', function (l) { return l.loadStatus === 'Partial' && l.loadedBy === APP.currentUser.id; }).length;
    var appr = DB.filter('loading_approvals', function (a) { return a.status === 'Pending' && a.requestedBy === APP.currentUser.id; }).length;
    return {
        icon: 'bxs-truck', title: 'Execute Loading', sub: 'My loading tasks — ' + APP.currentUser.name,
        facts: [
            { l: 'Status', v: cnt ? 'In Process' : 'No Tasks', c: cnt ? 'warn' : 'ok' },
            { l: 'Assigned Deliveries', v: cnt, c: 'info' },
            { l: 'Total Qty', v: qty },
            { l: 'Partial Loads', v: partial, c: partial ? 'warn' : '' },
            { l: 'Awaiting Approval', v: appr, c: appr ? 'bad' : '' }
        ]
    };
});

// =====================================================================
//  AUTO LOCK FOR SHORT OBDs
//  OBD assign ho chuki hai aur stock kam tha -> jab PIV / Putaway / bulk upload se
//  stock aaye, to OBD sequence (Urgent pehle, phir assign order) me short material
//  ke liye us OBD ke already-assigned locations ke SABSE NAZDEEK wali location
//  auto-lock ho jati hai (picking me apne aap add).
// =====================================================================
var _autoLockBusy=false, _autoLockTimer=null;

function autoLockActiveOBDs(){
    // assigned OBDs, sequence wise: Urgent -> assign time -> seq
    var list=[];
    DB.filter('picking_assignments',function(a){return a.status==='Assigned';}).forEach(function(a){
        var ids=(a.type==='pickandload')?(a.obdIds||[]):(a.obdId?[a.obdId]:[]);
        ids.forEach(function(oid,i){
            list.push({obdId:oid,assignedTo:a.assignedTo,priority:a.priority||'Normal',at:a.assignedAt||'',seq:(a.seq||0)*1000+i});
        });
    });
    list.sort(function(x,y){
        return ((y.priority==='Urgent'?1:0)-(x.priority==='Urgent'?1:0))||String(x.at).localeCompare(String(y.at))||(x.seq-y.seq);
    });
    var seen={},out=[];
    list.forEach(function(e){
        if(seen[e.obdId])return;seen[e.obdId]=1;
        var obd=DB.find('obd_data',e.obdId);
        if(!obd||obd.status==='Picking Done'||obd.status==='P&L Done'||obd.status==='Pending')return;
        e.obd=obd;out.push(e);
    });
    return out;
}
function autoLockShortages(e){
    var res=[];
    groupMats(e.obd).forEach(function(m){
        if(!m.ean||m.qty<=0)return;
        var have=sumBy(DB.filter('location_locks',function(l){return l.obdId===e.obdId&&l.ean===m.ean&&isActiveLock(l);}),function(l){return l.lockedQty;});
        if(m.qty-have>0)res.push({m:m,need:m.qty-have});
    });
    return res;
}
async function autoLockShortOBDs(opts){
    opts=opts||{};
    if(_autoLockBusy||!APP.currentUser||!supabaseClient)return 0;
    _autoLockBusy=true;
    var totalLocked=0;
    try{
        var obds=autoLockActiveOBDs();
        // quick local check — koi shortage nahi to server pull bhi nahi
        var withShort=obds.filter(function(e){return autoLockShortages(e).length>0;});
        if(!withShort.length)return 0;

        // fresh stock (silent — loader flash nahi)
        var _sl=showLoader;showLoader=function(){};
        try{ _sbFullPullTs['location_master']=0; _stockCtxTs=0; await sbPullFull('location_master'); }
        finally{ showLoader=_sl; hideLoader(); }
        var ctx=makeAvailCtx();_stockCtx=ctx;_stockCtxTs=Date.now();
        if(!Object.keys(ctx.lm).length)return 0;

        for(var oi=0;oi<withShort.length;oi++){
            var e=withShort[oi],obd=e.obd,msgs=[];
            var shorts=autoLockShortages(e);   // OBD ke locks DB se (live)
            for(var si=0;si<shorts.length;si++){
                var m=shorts[si].m,need=shorts[si].need;
                if(!ctx.lm[m.ean])continue;
                // anchor: is OBD ke already-assigned locations me se jo available stock ke sabse nazdeek ho
                var anchors=DB.filter('location_locks',function(l){return l.obdId===e.obdId&&isActiveLock(l)&&l.source!=='GR'&&l.locationId!=='GR'&&l.rack;}).map(function(l){return l.rack;});
                var anchor=null,av=getLocAvailability(m.ean,null,ctx).filter(function(a){return a.available>0;});
                if(!av.length)continue;
                if(anchors.length){
                    var bd=Infinity;
                    av.forEach(function(a){anchors.forEach(function(r){var d=rackDist(r,a.rack);if(d<bd){bd=d;anchor=a.rack;}});});
                }
                var al=allocateMaterial(m.ean,need,null,anchor,ctx);
                al.picks.forEach(function(pk){
                    addLock(obd,m,pk.loc,pk.qty,{autoLocked:true,autoLockedAt:nowISO()});
                    (ctx.lk[m.ean]=ctx.lk[m.ean]||[]).push({ean:m.ean,rack:pk.loc.rack,lockedQty:pk.qty,pickedQty:0,obdId:obd.id,obdNo:obd.obdNo,status:'Locked'});   // next OBD ko updated availability
                    msgs.push(m.material+' — '+pk.qty+' @ '+pk.loc.rack);
                });
                totalLocked+=al.locked;
                // is material ki pending NO_STOCK request ab poori cover ho gayi to close
                if(al.short<=0){
                    DB.filter('location_requests',function(r){return r.obdId===e.obdId&&r.ean===m.ean&&r.status==='Pending'&&r.source==='NO_STOCK';}).forEach(function(r){
                        DB.update('location_requests',r.id,{status:'Resolved',closedNote:'Auto-locked — stock received',resolvedBy:'System',resolvedAt:nowISO()});
                    });
                }
            }
            if(msgs.length){
                mergeDuplicateLocks(e.obdId);
                addNotif('OBD '+obd.obdNo+': auto-locked after stock arrival — '+msgs.join(', '),'success',e.assignedTo);
                logAction('Picking','AUTO_LOCK','OBD '+obd.obdNo+' — '+msgs.join('; '));
                // picker ki screen par ye hi OBD khuli ho aur wo kuch type na kar raha ho to refresh
                try{
                    var ov=document.getElementById('modalOverlay'),ae=document.activeElement;
                    if(window._pickData&&window._pickData.obdId===e.obdId&&ov&&ov.classList.contains('open')&&!(ae&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))&&typeof openPickingOBD==='function'&&APP.currentUser.id===e.assignedTo)openPickingOBD(e.obdId);
                }catch(_e){}
            }
        }
        if(totalLocked>0&&!opts.silent)showToast(totalLocked+' qty auto-locked for short OBD(s)','success');
    }catch(err){ console.warn('autoLockShortOBDs:',err); }
    finally{ _autoLockBusy=false; }
    return totalLocked;
}
// stock add hone ke baad call karo (debounced)
function scheduleAutoLock(){
    if(_autoLockTimer)clearTimeout(_autoLockTimer);
    _autoLockTimer=setTimeout(function(){_autoLockTimer=null;autoLockShortOBDs();},3000);
}
// background check — har 2 minute (sirf Admin/Manager ke device par, taaki multiple devices ek saath lock na karein)
setInterval(function(){ if(APP.currentUser&&isMgrUser())autoLockShortOBDs({silent:false}); },120000);