(function() {
    'use strict';

    if (window.__WMS_ENTERPRISE_SYNC__) {
        console.log('ℹ️ Enterprise Sync already running');
        return;
    }
    window.__WMS_ENTERPRISE_SYNC__ = true;

    console.log('%c🚀 WMS Enterprise Sync Service Starting...', 'color:#0a6ed1;font-weight:bold;font-size:14px');

    // ==================== CONFIG ====================
    var CONFIG = {
        PULL_INTERVAL: 30000,       // Pull from Supabase every 30 sec
        PUSH_INTERVAL: 5000,        // Push queue every 5 sec
        PULL_BATCH_SIZE: 1000,      // Rows per pull batch (Supabase max)
        PUSH_BATCH_SIZE: 500,       // Rows per push batch
        MAX_RETRIES: 3,             // Max retry attempts
        BULK_CHUNK_SIZE: 200,       // Rows per bulk upload chunk (small = no hang)
        BULK_CHUNK_DELAY: 50,      // ms delay between chunks (lets UI breathe)
        CONFLICT_WINDOW: 5000      // Skip realtime events for 5 sec after local write
    };

    // ==================== STATE ====================
    var writeQueue = {};
    var localWriteTs = {};
    var isSyncing = false;
    var syncStats = { pushed: 0, pulled: 0, failed: 0, queueSize: 0 };

    // Load queue from localStorage
    try {
        var saved = localStorage.getItem('wms_sync_queue');
        if (saved) writeQueue = JSON.parse(saved) || {};
    } catch(e) {}

    function saveQueue() {
        try {
            localStorage.setItem('wms_sync_queue', JSON.stringify(writeQueue));
            var total = 0;
            Object.keys(writeQueue).forEach(function(t) { total += writeQueue[t].length; });
            syncStats.queueSize = total;
        } catch(e) {}
    }

    function getSB() { return typeof supabaseClient !== 'undefined' ? supabaseClient : null; }
    function getTables() { return typeof ALL_TABLES !== 'undefined' ? ALL_TABLES : []; }

    // ==================== LOCAL WRITE TRACKING ====================
    function trackWrite(table, id) {
        localWriteTs[table + ':' + id] = Date.now();
    }
    function isRecentLocalWrite(table, id) {
        var ts = localWriteTs[table + ':' + id];
        if (!ts) return false;
        if (Date.now() - ts < CONFIG.CONFLICT_WINDOW) return true;
        delete localWriteTs[table + ':' + id];
        return false;
    }
    // Cleanup old entries every minute
    setInterval(function() {
        var now = Date.now();
        Object.keys(localWriteTs).forEach(function(k) {
            if (now - localWriteTs[k] > 30000) delete localWriteTs[k];
        });
    }, 60000);

    // ==================== QUEUE OPERATIONS ====================
    function enqueue(table, item, action) {
        if (!writeQueue[table]) writeQueue[table] = [];
        action = action || 'upsert';
        // Replace existing entry for same item
        for (var i = 0; i < writeQueue[table].length; i++) {
            if (writeQueue[table][i].id === item.id) {
                writeQueue[table][i] = { id: item.id, data: item, action: action, retries: 0 };
                saveQueue();
                return;
            }
        }
        writeQueue[table].push({ id: item.id, data: item, action: action, retries: 0 });
        saveQueue();
    }

    async function processQueue() {
        var sb = getSB();
        if (!sb) return;
        var tables = Object.keys(writeQueue);
        for (var t = 0; t < tables.length; t++) {
            var tableName = tables[t];
            var queue = writeQueue[tableName];
            if (!queue || !queue.length) continue;

            var upserts = queue.filter(function(e) { return e.action === 'upsert'; });
            var deletes = queue.filter(function(e) { return e.action === 'delete'; });

            // Process upserts in batches
            for (var i = 0; i < upserts.length; i += CONFIG.PUSH_BATCH_SIZE) {
                var batch = upserts.slice(i, i + CONFIG.PUSH_BATCH_SIZE);
                var rows = batch.map(function(e) {
                    return { id: e.id, data: e.data, created_at: new Date().toISOString() };
                });
                try {
                    var res = await sb.from(tableName).upsert(rows, { onConflict: 'id' });
                    if (res.error) {
                        console.error('Push error [' + tableName + ']:', res.error.message);
                        batch.forEach(function(e) { e.retries = (e.retries || 0) + 1; });
                    } else {
                        syncStats.pushed += batch.length;
                        batch.forEach(function(e) {
                            var idx = queue.indexOf(e);
                            if (idx >= 0) queue.splice(idx, 1);
                        });
                    }
                } catch(err) {
                    batch.forEach(function(e) { e.retries = (e.retries || 0) + 1; });
                }
            }

            // Process deletes
            for (var j = 0; j < deletes.length; j++) {
                var entry = deletes[j];
                try {
                    await sb.from(tableName).delete().eq('id', entry.id);
                    var idx = queue.indexOf(entry);
                    if (idx >= 0) queue.splice(idx, 1);
                } catch(err) {
                    entry.retries = (entry.retries || 0) + 1;
                }
            }

            // Remove items that exceeded max retries
            writeQueue[tableName] = queue.filter(function(e) { return (e.retries || 0) < CONFIG.MAX_RETRIES; });
            if (!writeQueue[tableName].length) delete writeQueue[tableName];
            saveQueue();
        }
    }

    // ==================== PAGINATED PULL (Fixes 1000 row limit) ====================
    async function pullTable(tableName) {
        var sb = getSB();
        if (!sb || typeof MEMORY_DB === 'undefined') return;

        try {
            var allData = [];
            var from = 0;
            var hasMore = true;
            var pages = 0;

            while (hasMore && pages < 50) {
                pages++;
                var res = await sb.from(tableName).select('data').range(from, from + CONFIG.PULL_BATCH_SIZE - 1);
                if (res.error) break;
                if (res.data && res.data.length > 0) {
                    var parsed = res.data.map(function(r) { return r.data; }).filter(function(d) { return d !== null; });
                    allData = allData.concat(parsed);
                    if (res.data.length < CONFIG.PULL_BATCH_SIZE) hasMore = false;
                    else from += CONFIG.PULL_BATCH_SIZE;
                } else hasMore = false;
            }

            // Merge with pending local writes
            var pending = {};
            if (writeQueue[tableName]) {
                writeQueue[tableName].forEach(function(e) { pending[e.id] = e.data; });
            }

            MEMORY_DB[tableName] = allData;
            Object.keys(pending).forEach(function(id) {
                var found = false;
                for (var k = 0; k < allData.length; k++) {
                    if (allData[k].id === id) { allData[k] = pending[id]; found = true; break; }
                }
                if (!found) allData.push(pending[id]);
            });

            // Safe localStorage save
            try {
                var str = JSON.stringify(allData);
                if (str.length < 4500000) localStorage.setItem('wms_' + tableName, str);
                else localStorage.setItem('wms_' + tableName, JSON.stringify(allData.slice(-2000)));
            } catch(e) {}

            syncStats.pulled += allData.length;
            return allData;
        } catch(err) {
            console.error('Pull error [' + tableName + ']:', err.message);
            if (!MEMORY_DB[tableName]) {
                try { MEMORY_DB[tableName] = JSON.parse(localStorage.getItem('wms_' + tableName) || '[]'); }
                catch(e) { MEMORY_DB[tableName] = []; }
            }
        }
    }

    async function pullAll() {
        if (!getSB() || isSyncing) return;
        isSyncing = true;
        var tables = getTables();
        for (var i = 0; i < tables.length; i++) {
            await pullTable(tables[i]);
        }
        isSyncing = false;
        if (typeof APP !== 'undefined' && APP.currentUser && APP.currentSection) {
            clearTimeout(window._syncRenderTimer);
            window._syncRenderTimer = setTimeout(function() {
                if (typeof renderSection === 'function') {
                    renderSection(APP.currentSection, APP.currentSub);
                }
                if (typeof updateNotifBadge === 'function') updateNotifBadge();
            }, 500);
        }
    }

    // ==================== HOOK DB OPERATIONS ====================
    function hookDB() {
        if (typeof DB === 'undefined' || DB.__syncHooked) return;

        var origSet = DB.set.bind(DB);
        var origAdd = DB.add.bind(DB);
        var origUpdate = DB.update.bind(DB);
        var origRemove = DB.remove.bind(DB);

        DB.set = function(k, v) {
            origSet(k, v);
            if (Array.isArray(v)) {
                v.forEach(function(item) { if (item && item.id) enqueue(k, item, 'upsert'); });
            }
        };
        DB.add = function(k, item) {
            var result = origAdd(k, item);
            if (result && result.id) enqueue(k, result, 'upsert');
            return result;
        };
        DB.update = function(k, id, updates) {
            var result = origUpdate(k, id, updates);
            if (result && result.id) enqueue(k, result, 'upsert');
            return result;
        };
        DB.remove = function(k, id) {
            origRemove(k, id);
            if (id) enqueue(k, { id: id }, 'delete');
        };
        DB.__syncHooked = true;
        console.log('✅ DB operations hooked');
    }

    // ==================== REALTIME SUBSCRIPTIONS ====================
    function setupRealtime() {
        var sb = getSB();
        if (!sb) return;
        var tables = getTables();
        tables.forEach(function(tableName) {
            sb.channel('wms-sync-' + tableName)
                .on('postgres_changes', { event: '*', schema: 'public', table: tableName },
                    function(payload) { handleRealtime(tableName, payload); })
                .subscribe();
        });
        console.log('✅ Realtime subscriptions active for ' + tables.length + ' tables');
    }

    function handleRealtime(tableName, payload) {
        if (typeof MEMORY_DB === 'undefined' || isSyncing) return;
        if (!MEMORY_DB[tableName]) {
            try { MEMORY_DB[tableName] = JSON.parse(localStorage.getItem('wms_' + tableName) || '[]'); }
            catch(e) { MEMORY_DB[tableName] = []; }
        }

        var itemId = null;
        if (payload.new && payload.new.data) itemId = payload.new.data.id;
        else if (payload.old && payload.old.id) itemId = payload.old.id;
        if (itemId && isRecentLocalWrite(tableName, itemId)) return;

        if (payload.eventType === 'DELETE' && payload.old && payload.old.id) {
            MEMORY_DB[tableName] = MEMORY_DB[tableName].filter(function(item) { return item.id !== payload.old.id; });
        } else if (payload.new && payload.new.data) {
            var newItem = payload.new.data;
            if (!newItem.id) return;
            var found = false;
            for (var j = 0; j < MEMORY_DB[tableName].length; j++) {
                if (MEMORY_DB[tableName][j].id === newItem.id) {
                    if (JSON.stringify(MEMORY_DB[tableName][j]) !== JSON.stringify(newItem)) {
                        MEMORY_DB[tableName][j] = newItem;
                    }
                    found = true;
                    break;
                }
            }
            if (!found) MEMORY_DB[tableName].push(newItem);
        }

        try {
            var str = JSON.stringify(MEMORY_DB[tableName]);
            if (str.length < 4500000) localStorage.setItem('wms_' + tableName, str);
        } catch(e) {}

        if (typeof APP !== 'undefined' && APP.currentUser && APP.currentSection) {
            clearTimeout(window._rtRenderTimer);
            window._rtRenderTimer = setTimeout(function() {
                if (typeof renderSection === 'function') renderSection(APP.currentSection, APP.currentSub);
            }, 300);
        }
    }

    // ==================== BULK UPLOAD FIX (No Hang) ====================
    // This overrides the original processLocBulkUpload, processBulkBinUpload, executeBulkUpload
    // to use chunked processing with progress bar

    function showBulkProgress(current, total, tableName) {
        var existing = document.getElementById('wmsBulkProgress');
        if (!existing) {
            var div = document.createElement('div');
            div.id = 'wmsBulkProgress';
            div.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#fff;border:2px solid #0a6ed1;border-radius:12px;padding:16px 24px;box-shadow:0 8px 24px rgba(0,0,0,0.2);z-index:99999;min-width:300px;font-family:sans-serif';
            document.body.appendChild(div);
        }
        var el = document.getElementById('wmsBulkProgress');
        var pct = Math.round((current / total) * 100);
        el.innerHTML = '<div style="font-size:13px;font-weight:700;color:#0a6ed1;margin-bottom:8px">📤 Uploading to Supabase: ' + tableName + '</div>' +
            '<div style="background:#e9edf1;border-radius:6px;height:24px;overflow:hidden;margin-bottom:8px">' +
            '<div style="background:linear-gradient(90deg,#0a6ed1,#5b5fc7);height:100%;width:' + pct + '%;border-radius:6px;transition:width 0.2s"></div></div>' +
            '<div style="font-size:12px;color:#55697e">' + current + ' / ' + total + ' rows (' + pct + '%)</div>';
    }

    function hideBulkProgress() {
        var el = document.getElementById('wmsBulkProgress');
        if (el) el.remove();
    }

    // Chunked upload function - processes data in small chunks
    // This prevents browser hang even for 20-25 MB files
    window.wmsBulkUpload = async function(tableName, items, options) {
        options = options || {};
        var sb = getSB();
        if (!sb) {
            console.error('Supabase not connected');
            return { success: 0, failed: items.length };
        }

        var total = items.length;
        var success = 0;
        var failed = 0;
        var chunkSize = CONFIG.BULK_CHUNK_SIZE;
        var delay = CONFIG.BULK_CHUNK_DELAY;

        console.log('🚀 Starting bulk upload: ' + tableName + ' (' + total + ' rows)');

        for (var i = 0; i < total; i += chunkSize) {
            var chunk = items.slice(i, i + chunkSize);
            var rows = chunk.map(function(item) {
                var id = item.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 6));
                if (!item.id) item.id = id;
                if (!item.createdAt) item.createdAt = new Date().toISOString();
                trackWrite(tableName, id);
                return { id: id, data: item, created_at: new Date().toISOString() };
            });

            try {
                var res = await sb.from(tableName).upsert(rows, { onConflict: 'id' });
                if (res.error) {
                    console.error('Chunk error:', res.error.message);
                    failed += chunk.length;
                } else {
                    success += chunk.length;
                }
            } catch(err) {
                console.error('Chunk exception:', err.message);
                failed += chunk.length;
            }

            // Update progress UI
            var current = Math.min(i + chunkSize, total);
            showBulkProgress(current, total, tableName);

            // Small delay to let UI breathe (prevents hang)
            await new Promise(function(resolve) { setTimeout(resolve, delay); });
        }

        hideBulkProgress();
        console.log('✅ Bulk upload complete: ' + tableName + ' — ' + success + ' success, ' + failed + ' failed');

        // Force refresh from Supabase
        setTimeout(function() {
            pullTable(tableName).then(function() {
                if (typeof APP !== 'undefined' && APP.currentUser && APP.currentSection) {
                    if (typeof renderSection === 'function') renderSection(APP.currentSection, APP.currentSub);
                }
            });
        }, 1000);

        return { success: success, failed: failed };
    };

    // ==================== HOOK BULK UPLOAD FUNCTIONS ====================
    function hookBulkUploads() {
        // Hook processLocBulkUpload
        if (typeof window.processLocBulkUpload === 'function' && !window.processLocBulkUpload.__hooked) {
            var origLocBulk = window.processLocBulkUpload;
            window.processLocBulkUpload = async function() {
                var fi = document.getElementById('locBulkFile');
                if (!fi || !fi.files[0]) { showToast('File select karein', 'error'); return; }

                var progDiv = document.getElementById('locBulkProgress');
                if (progDiv) {
                    progDiv.style.display = '';
                    progDiv.innerHTML = '<div style="text-align:center;padding:20px;color:var(--accent)"><i class="bx bx-loader-circle bx-spin" style="font-size:24px;display:block;margin-bottom:8px"></i>Processing Excel...</div>';
                }

                setTimeout(function() {
                    var reader = new FileReader();
                    reader.onload = async function(e) {
                        try {
                            var wb = XLSX.read(e.target.result, { type: 'array' });
                            var ws = wb.Sheets[wb.SheetNames[0]];
                            var data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

                            if (!data || data.length < 2) { showToast('File empty', 'error'); return; }

                            var headerRow = data[0].map(function(h) { return String(h || '').trim().toLowerCase(); });
                            var colMap = { date: -1, rack: -1, material: -1, description: -1, ean: -1, qty: -1, action: -1, packing: -1, box: -1 };
                            var aliases = {
                                date: ['date', 'dt'], rack: ['rack', 'location'], material: ['material', 'item'],
                                description: ['description', 'desc', 'material description'],
                                ean: ['ean', 'barcode'], qty: ['qty', 'quantity'],
                                action: ['action', 'type'], packing: ['packing', 'pack'], box: ['box', 'boxno']
                            };

                            Object.keys(aliases).forEach(function(k) {
                                aliases[k].forEach(function(a) {
                                    for (var ci = 0; ci < headerRow.length; ci++) {
                                        if (headerRow[ci] === a && colMap[k] === -1) { colMap[k] = ci; break; }
                                    }
                                });
                            });

                            if (colMap.rack === -1 || colMap.material === -1 || colMap.qty === -1) {
                                showToast('Missing required columns', 'error'); return;
                            }

                            function parseDate(val) {
                                if (!val) return new Date().toISOString().split('T')[0];
                                var s = String(val).trim();
                                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                                var parts = s.split(/[\/\-\.]/);
                                if (parts.length === 3) {
                                    if (parts[0].length === 4) return parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
                                    if (parts[2].length === 4) return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
                                }
                                return new Date().toISOString().split('T')[0];
                            }

                            var items = [];
                            var userName = (typeof APP !== 'undefined' && APP.currentUser) ? APP.currentUser.name : 'Bulk Upload';
                            var userId = (typeof APP !== 'undefined' && APP.currentUser) ? APP.currentUser.id : '';

                            for (var k = 1; k < data.length; k++) {
                                var r = data[k];
                                if (!r || !r.length) continue;
                                var rack = colMap.rack >= 0 ? String(r[colMap.rack] || '').trim().toUpperCase() : '';
                                var material = colMap.material >= 0 ? String(r[colMap.material] || '').trim() : '';
                                var description = colMap.description >= 0 ? String(r[colMap.description] || '').trim() : '';
                                var ean = colMap.ean >= 0 ? String(r[colMap.ean] || '').trim() : '';
                                var qty = colMap.qty >= 0 ? parseInt(r[colMap.qty]) || 0 : 0;
                                var action = colMap.action >= 0 ? String(r[colMap.action] || '').trim().toUpperCase() : 'BULK';
                                var packing = colMap.packing >= 0 ? String(r[colMap.packing] || '').trim() : '';
                                var box = colMap.box >= 0 ? String(r[colMap.box] || '').trim().toUpperCase() : '';
                                var date = colMap.date >= 0 ? parseDate(r[colMap.date]) : new Date().toISOString().split('T')[0];

                                if (!rack || !material || qty <= 0) continue;

                                items.push({
                                    id: (typeof DB !== 'undefined') ? DB.uid() : (Date.now().toString(36) + Math.random().toString(36).substr(2, 6)),
                                    date: date, rack: rack, ean: ean, material: material,
                                    description: description || material, quantity: qty,
                                    packing: packing, box: box, action: action || 'BULK',
                                    user: userName, userId: userId,
                                    dateTime: new Date().toISOString()
                                });
                            }

                            if (!items.length) { showToast('No valid data', 'error'); return; }

                            // Close modal
                            if (typeof closeModal === 'function') closeModal();

                            // Use chunked upload
                            var result = await window.wmsBulkUpload('location_master', items);

                            if (typeof logAction === 'function') {
                                logAction('Location Master', 'BULK_UPLOAD', result.success + ' rows uploaded');
                            }
                            showToast(result.success + ' rows uploaded successfully!', 'success');

                        } catch(err) {
                            showToast('Excel error: ' + err.message, 'error');
                            if (progDiv) progDiv.innerHTML = '';
                        }
                    };
                    reader.readAsArrayBuffer(fi.files[0]);
                }, 100);
            };
            window.processLocBulkUpload.__hooked = true;
            console.log('✅ processLocBulkUpload hooked (chunked upload)');
        }

        // Hook processBulkBinUpload
        if (typeof window.processBulkBinUpload === 'function' && !window.processBulkBinUpload.__hooked) {
            var origBinBulk = window.processBulkBinUpload;
            window.processBulkBinUpload = async function() {
                var fi = document.getElementById('binBulkFile');
                if (!fi || !fi.files[0]) { showToast('File select karein', 'error'); return; }

                var progDiv = document.getElementById('binBulkProgress');
                if (progDiv) {
                    progDiv.style.display = '';
                    progDiv.innerHTML = '<div style="text-align:center;padding:20px;color:var(--accent)"><i class="bx bx-loader-circle bx-spin" style="font-size:24px;display:block;margin-bottom:8px"></i>Processing...</div>';
                }

                setTimeout(function() {
                    var reader = new FileReader();
                    reader.onload = async function(e) {
                        try {
                            var wb = XLSX.read(e.target.result, { type: 'array' });
                            var ws = wb.Sheets[wb.SheetNames[0]];
                            var data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

                            if (!data || data.length < 1) { showToast('File empty', 'error'); return; }

                            var existingBins = {};
                            if (typeof DB !== 'undefined') {
                                DB.get('rack_master').forEach(function(r) { existingBins[r.rack] = true; });
                            }

                            var colIdx = 0;
                            var startRow = 0;
                            var firstVal = String(data[0][colIdx] || '').trim().toLowerCase();
                            if (firstVal.indexOf('bin') > -1 || firstVal.indexOf('rack') > -1 || firstVal.indexOf('name') > -1) startRow = 1;

                            var items = [];
                            for (var k = startRow; k < data.length; k++) {
                                var r = data[k];
                                if (!r) continue;
                                var binName = String(r[colIdx] || '').trim().toUpperCase();
                                if (!binName) continue;
                                if (existingBins[binName]) continue;
                                existingBins[binName] = true;
                                items.push({
                                    id: (typeof DB !== 'undefined') ? DB.uid() : (Date.now().toString(36) + Math.random().toString(36).substr(2, 6)),
                                    rack: binName
                                });
                            }

                            if (!items.length) { showToast('No new bins', 'error'); return; }
                            if (typeof closeModal === 'function') closeModal();

                            var result = await window.wmsBulkUpload('rack_master', items);
                            if (typeof logAction === 'function') logAction('Bin', 'BULK_UPLOAD', result.success + ' bins added');
                            showToast(result.success + ' bins uploaded!', 'success');

                        } catch(err) {
                            showToast('Excel error: ' + err.message, 'error');
                            if (progDiv) progDiv.innerHTML = '';
                        }
                    };
                    reader.readAsArrayBuffer(fi.files[0]);
                }, 150);
            };
            window.processBulkBinUpload.__hooked = true;
            console.log('✅ processBulkBinUpload hooked (chunked upload)');
        }

        // Hook executeBulkUpload (Material Master)
        if (typeof window.executeBulkUpload === 'function' && !window.executeBulkUpload.__hooked) {
            var origMatBulk = window.executeBulkUpload;
            window.executeBulkUpload = async function() {
                var rows = window._bulkRows;
                if (!rows || !rows.length) return;

                var progressDiv = document.getElementById('bulkProgress');
                if (progressDiv) {
                    progressDiv.style.display = 'block';
                }

                if (typeof closeModal === 'function') closeModal();

                // Use chunked upload
                var result = await window.wmsBulkUpload('material_master', rows);

                if (typeof logAction === 'function') {
                    logAction('Material', 'BULK_UPLOAD', result.success + ' materials uploaded');
                }
                showToast(result.success + ' materials uploaded!', 'success');
            };
            window.executeBulkUpload.__hooked = true;
            console.log('✅ executeBulkUpload hooked (chunked upload)');
        }
    }

    // ==================== HOOK LOGIN/LOGOUT ====================
    function hookAuth() {
        // Hook doLogin
        if (typeof window.doLogin === 'function' && !window.doLogin.__syncHooked) {
            var origLogin = window.doLogin;
            window.doLogin = async function(u, p) {
                var result = await origLogin(u, p);
                if (result && typeof APP !== 'undefined' && APP.currentUser) {
                    console.log('🔄 User logged in — triggering sync');
                    setTimeout(function() { pullAll(); }, 1000);
                }
                return result;
            };
            window.doLogin.__syncHooked = true;
        }

        // Hook doLogout
        if (typeof window.doLogout === 'function' && !window.doLogout.__syncHooked) {
            var origLogout = window.doLogout;
            window.doLogout = async function() {
                console.log('🔄 User logging out — flushing queue...');
                await processQueue();
                await new Promise(function(r) { setTimeout(r, 500); });
                return origLogout();
            };
            window.doLogout.__syncHooked = true;
        }
    }

    // ==================== OVERRIDE pullAll ====================
    // Replace the original pullAll with paginated version
    window.pullAll = pullAll;
    console.log('✅ pullAll overridden (paginated — no 1000 row limit)');

    // ==================== PUBLIC API ====================
    window.WMS_SYNC = {
        syncNow: async function() {
            console.log('🔄 Manual sync triggered');
            await processQueue();
            await pullAll();
            console.log('✅ Manual sync complete');
        },
        getStatus: function() {
            return {
                queueSize: syncStats.queueSize,
                pushed: syncStats.pushed,
                pulled: syncStats.pulled,
                failed: syncStats.failed,
                isSyncing: isSyncing,
                online: navigator.onLine
            };
        },
        bulkUpload: window.wmsBulkUpload,
        forcePull: pullAll,
        forcePush: processQueue
    };

    // ==================== START SERVICE ====================
    function start() {
        console.log('⚙️ Hooking DB operations...');
        hookDB();

        console.log('⚙️ Hooking bulk upload functions...');
        hookBulkUploads();

        console.log('⚙️ Hooking auth functions...');
        hookAuth();

        console.log('⚙️ Setting up realtime subscriptions...');
        setTimeout(setupRealtime, 2000);

        // Start push loop (every 5 sec)
        setInterval(processQueue, CONFIG.PUSH_INTERVAL);

        // Start pull loop (every 30 sec)
        setInterval(pullAll, CONFIG.PULL_INTERVAL);

        // Process existing queue
        setTimeout(processQueue, 3000);

        // Initial pull after login (if already logged in)
        setTimeout(function() {
            if (typeof APP !== 'undefined' && APP.currentUser) {
                console.log('🔄 User already logged in — pulling data');
                pullAll();
            }
        }, 5000);

        // Online/offline detection
        window.addEventListener('online', function() {
            console.log('🌐 Back online — syncing');
            processQueue();
            pullAll();
        });
        window.addEventListener('offline', function() {
            console.log('📡 Offline — writes queued');
        });

        // Save queue before unload
        window.addEventListener('beforeunload', function() {
            saveQueue();
        });

        console.log('%c✅ Enterprise Sync Service Started!', 'color:#10b981;font-weight:bold;font-size:14px');
        console.log('%c   Use WMS_SYNC.getStatus() to check sync status', 'color:#666;font-size:11px');
        console.log('%c   Use WMS_SYNC.syncNow() to force sync', 'color:#666;font-size:11px');
        console.log('%c   Use WMS_SYNC.bulkUpload(table, items) for custom uploads', 'color:#666;font-size:11px');
    }

    // Start after small delay
    setTimeout(start, 1500);

})();
