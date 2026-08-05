/* ============================================================
   VIP INDUSTRIES LIMITED MD20 — WMS COMPLETE SCRIPT
   Developed by Nikhil Patil
   ============================================================ */

// ==================== SUPABASE SYNC ====================
var supabaseClient = null;
try {
    var SUPABASE_URL = 'https://whlqsapzywnadvkhfhzp.supabase.co';
    var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobHFzYXB6eXduYWR2a2hmaHpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE4ODMsImV4cCI6MjEwMDczNzg4M30.YaNFKPQ9vmhKHYa0DtaZPbbM44IqgSlibPSABId_bno';
    if (typeof supabase !== 'undefined' && SUPABASE_URL.indexOf('supabase.co') > -1) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch(e) {}

function pushServer(key, val) {
    if (!supabaseClient) return;
    try { supabaseClient.from('app_data').upsert({key:key, value:val}, {onConflict:'key'}); } catch(e) {}
}
function pullAll() {
    if (!supabaseClient) return;
    try {
        var tables = ['users','location_master','material_master','rack_master','vehicles','invoices','invoice_materials','picking_reports','audit_log','notifications','difference_reports','obd_data','picking_assignments','loading_assignments','loading_data','user_sessions','grn_records','short_reports','unloading_records','loaded_vehicles','picking_done','loading_users','user_work_log'];
        tables.forEach(function(t) {
            supabaseClient.from('app_data').select('value').eq('key', t).single().then(function(res) {
                if (res.data && res.data.value) localStorage.setItem('wms_'+t, JSON.stringify(res.data.value));
            }).catch(function(){});
        });
    } catch(e) {}
}
if (supabaseClient) {
    try {
        supabaseClient.channel('wms-live').on('postgres_changes',{event:'*',schema:'public',table:'app_data'},function(p) {
            if (p.new && p.new.key && p.new.value) {
                localStorage.setItem('wms_'+p.new.key, JSON.stringify(p.new.value));
                if (APP.currentUser && APP.currentSection) {
                    renderSection(APP.currentSection, APP.currentSub);
                }
            }
        }).subscribe();
    } catch(e) {}
}

// ==================== STATE ====================
var APP = {
    currentUser: null, currentSection: 'dashboard', currentSub: null,
    theme: localStorage.getItem('wms_theme') || 'dark',
    sessionStart: null, SESSION_TIMEOUT: 30*60*1000,
    locPage:1, locPerPage:15, auditPage:1, auditPerPage:15, reportPage:1, reportPerPage:15, matPage:1, matPerPage:15,
    scanCallback: null, html5QrCode: null
};

// ==================== DATABASE ====================
var DB = {
    _k: function(k){return 'wms_'+k;},
    get: function(k){try{return JSON.parse(localStorage.getItem(this._k(k))||'[]');}catch(e){return [];}},
    getObj: function(k){try{return JSON.parse(localStorage.getItem(this._k(k))||'{}');}catch(e){return {};}},
    set: function(k,v){localStorage.setItem(this._k(k),JSON.stringify(v));pushServer(k,v);},
    add: function(k,item){
        var d=this.get(k); item.id=item.id||this.uid(); item.createdAt=item.createdAt||new Date().toISOString();
        d.push(item); this.set(k,d); return item;
    },
    update: function(k,id,up){
        var d=this.get(k),idx=-1;
        for(var i=0;i<d.length;i++){if(d[i].id===id){idx=i;break;}}
        if(idx>-1){for(var key in up){d[idx][key]=up[key];} d[idx].updatedAt=new Date().toISOString(); this.set(k,d); return d[idx];}
        return null;
    },
    remove: function(k,id){this.set(k,this.get(k).filter(function(d){return d.id!==id;}));},
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
function addNotif(msg,type,target){
    type=type||'info';
    var n=DB.get('notifications');
    n.unshift({id:DB.uid(),message:type,type:type,read:false,dateTime:new Date().toISOString(),targetUser:target||null,messageText:msg});
    if(n.length>100)n.length=100;
    DB.set('notifications',n);updateNotifBadge();
}
function updateNotifBadge(){
    var c=0;var n=DB.get('notifications');
    for(var i=0;i<n.length;i++){if(!n[i].read)c++;}
    var b=document.getElementById('notifBadge');b.textContent=c;b.style.display=c>0?'flex':'none';
}
function renderNotifPanel(){
    var list=document.getElementById('notifList');var n=DB.get('notifications');
    if(!n.length){list.innerHTML='<div class="notif-empty"><i class="bx bx-bell-off"></i><p>No notifications</p></div>';return;}
    var h='';var s=n.slice(0,25);
    for(var i=0;i<s.length;i++){
        h+='<div class="notif-item '+(s[i].read?'':'unread')+'"><div>'+esc(s[i].messageText||s[i].message)+'</div><div class="notif-time">'+fmtDT(s[i].dateTime)+'</div></div>';
    }
    list.innerHTML=h;
    var all=DB.get('notifications');for(var j=0;j<all.length;j++){all[j].read=true;}DB.set('notifications',all);updateNotifBadge();
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

// ==================== AUTH ====================
function doLogin(uname,pass){
    var users=DB.get('users'),user=null;
    for(var i=0;i<users.length;i++){if(users[i].username===uname&&users[i].password===pass){user=users[i];break;}}
    if(!user){showToast('Invalid username or password','error');return false;}
    APP.currentUser=user;APP.sessionStart=Date.now();
    localStorage.setItem('wms_session',JSON.stringify({userId:user.id,loginTime:new Date().toISOString()}));
    DB.add('user_sessions',{userId:user.id,userName:user.name,loginTime:new Date().toISOString(),logoutTime:null,status:'Active'});
    logAction('Auth','LOGIN','User '+user.name+' logged in');
    pullAll();return true;
}
function doLogout(){
    if(APP.currentUser){
        logAction('Auth','LOGOUT','User '+APP.currentUser.name+' logged out');
        var sessions=DB.get('user_sessions');
        for(var i=sessions.length-1;i>=0;i--){
            if(sessions[i].userId===APP.currentUser.id&&!sessions[i].logoutTime){
                DB.update('user_sessions',sessions[i].id,{logoutTime:new Date().toISOString(),status:'Logged Out'});break;
            }
        }
    }
    APP.currentUser=null;localStorage.removeItem('wms_session');
    document.getElementById('mainApp').style.display='none';
    document.getElementById('loginPage').style.display='flex';
}
function chkPerm(mod){
    if(!APP.currentUser)return false;
    return APP.currentUser.permissions.modules.indexOf('all')>-1||APP.currentUser.permissions.modules.indexOf(mod)>-1;
}
function chkAct(act){
    if(!APP.currentUser)return false;
    if(APP.currentUser.role==='Super Admin')return true;
    return APP.currentUser.permissions.actions&&APP.currentUser.permissions.actions[act]===true;
}

// ==================== SIDEBAR ====================
function renderSidebar(){
    if(!APP.currentUser)return;
    var mods=[
        {id:'dashboard',icon:'bxs-dashboard',label:'Dashboard',subs:[]},
        {id:'inbound',icon:'bxs-truck',label:'Inbound',subs:[
            {id:'security-gate',label:'Security Gate'},
            {id:'pending-vehicle',label:'Pending Vehicle'},
            {id:'unloading-screen',label:'Unloading Screen'},
            {id:'posting-pending',label:'Posting Pending'},
            {id:'inbound-record',label:'Inbound Record'},
            {id:'unloading-stock',label:'Unloading Stock'}
        ]},
        {id:'putaway',icon:'bxs-package',label:'Putaway',subs:[]},
        {id:'piv',icon:'bxs-clipboard',label:'PIV',subs:[]},
        {id:'location',icon:'bxs-map-pin',label:'Location Master',subs:[]},
        {id:'rack',icon:'bxs-grid-alt',label:'Rack Master',subs:[]},
        {id:'material',icon:'bxs-label',label:'Material Master',subs:[]},
        {id:'picking',icon:'bxs-box',label:'Picking',subs:[
            {id:'obd-upload',label:'OBD Upload'},
            {id:'picking-assign',label:'Picking Assign'},
            {id:'start-picking',label:'Start Picking'},
            {id:'picking-done',label:'Picking Done'}
        ]},
        {id:'loading',icon:'bxs-truck',label:'Loading',subs:[
            {id:'loading-assign',label:'Loading Assign'},
            {id:'start-loading',label:'Start Loading'},
            {id:'loading-done',label:'Loaded Vehicles'},
            {id:'qty-mismatch',label:'Qty Mismatch'}
        ]},
        {id:'user-time',icon:'bx-time-five',label:'User Working Time',subs:[]},
        {id:'admin',icon:'bxs-user-detail',label:'Admin',subs:[]},
        {id:'settings',icon:'bxs-cog',label:'Settings',subs:[]},
        {id:'reports',icon:'bxs-bar-chart-alt-2',label:'Reports',subs:[]},
        {id:'audit',icon:'bxs-receipt',label:'Audit Log',subs:[]}
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
var sectionNames={dashboard:'Dashboard',inbound:'Inbound',putaway:'Putaway',piv:'PIV',location:'Location Master',rack:'Rack Master',material:'Material Master',admin:'Admin',settings:'Settings',reports:'Reports',audit:'Audit Log',picking:'Picking',loading:'Loading','user-time':'User Working Time'};
var subNames={'security-gate':'Security Gate','pending-vehicle':'Pending Vehicle','unloading-screen':'Unloading Screen','posting-pending':'Posting Pending','inbound-record':'Inbound Record','unloading-stock':'Unloading Stock','obd-upload':'OBD Upload','picking-assign':'Picking Assign','start-picking':'Start Picking','picking-done':'Picking Done','loading-assign':'Loading Assign','start-loading':'Start Loading','loading-done':'Loaded Vehicles','qty-mismatch':'Qty Mismatch'};

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
    var bc='<span class="bc-item">VIP MD20</span> <i class="bx bx-chevron-right" style="font-size:10px;color:var(--text-muted)"></i> <span class="bc-item active">'+(sectionNames[sec]||sec)+'</span>';
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
function renderDashboard(){
    var vehs=DB.get('vehicles'),locs=DB.get('location_master'),racks=DB.get('rack_master'),td=today();
    var pending=0,posted=0,postingPend=0,loaded=0;
    vehs.forEach(function(v){
        if(v.status==='Unload Pending'||v.status==='Assigned')pending++;
        if(v.status==='Posted'||v.status==='Unloaded')posted++;
        if(v.status==='Posting Pending Approval')postingPend++;
        if(v.status==='Loading Done'||v.status==='Loaded')loaded++;
    });
    var todayPut=0,todayPIV=0;
    locs.forEach(function(l){if(l.action==='PUTAWAY'&&l.date===td)todayPut++;if(l.action==='PIV'&&l.date===td)todayPIV++;});
    var occSet={};locs.forEach(function(l){occSet[l.rack]=true;});
    var occ=0;racks.forEach(function(r){if(occSet[r.rack])occ++;});
    var empty=racks.length-occ;
    var recent=DB.get('audit_log').slice(-8).reverse();
    var pendV=vehs.filter(function(v){return v.status==='Unload Pending'||v.status==='Assigned';});

    var h='<div class="section-header"><h2><i class="bx bxs-dashboard"></i> Dashboard</h2><div style="color:var(--text-muted);font-size:12px">'+fmtDT(new Date())+'</div></div>';
    h+='<div class="kpi-grid">';
    h+=kpi('bxs-truck',vehs.length,'Total Vehicles','accent');
    h+=kpi('bx-time-five',pending,'Pending Unload','warning');
    h+=kpi('bxs-package',todayPut,"Today Putaway","info");
    h+=kpi('bxs-clipboard',todayPIV,"Today PIV","accent2");
    h+=kpi('bxs-grid-alt',occ,'Occupied Racks','success');
    h+=kpi('bx-grid',empty,'Empty Racks','danger');
    h+=kpi('bxs-check-circle',posted,'Posted GRN','accent');
    h+=kpi('bx-error-circle',postingPend,'Pending Approval','warning');
    h+=kpi('bxs-truck',loaded,'Loaded Vehicles','info');
    h+='</div>';
    h+='<div class="grid-2">';
    // Recent Activity
    h+='<div class="card"><div class="card-title"><i class="bx bx-history"></i> Recent Activity</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Module</th><th>Action</th><th>User</th><th>Time</th></tr></thead><tbody>';
    if(!recent.length)h+='<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">No activity yet</td></tr>';
    else recent.forEach(function(a){h+='<tr><td>'+esc(a.module)+'</td><td>'+esc(a.action)+'</td><td>'+esc(a.userName)+'</td><td style="font-size:11px;color:var(--text-muted)">'+fmtDT(a.dateTime)+'</td></tr>';});
    h+='</tbody></table></div></div>';
    // Pending Vehicles
    h+='<div class="card"><div class="card-title"><i class="bx bx-time-five"></i> Pending Vehicles</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle</th><th>LR No</th><th>Transport</th><th>Status</th></tr></thead><tbody>';
    if(!pendV.length)h+='<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">No pending vehicles</td></tr>';
    else pendV.forEach(function(v){h+='<tr style="cursor:pointer" onclick="navTo(\'inbound\',\'pending-vehicle\')"><td><strong>'+esc(v.vehicleNo)+'</strong></td><td>'+esc(v.lrNo||'-')+'</td><td>'+esc(v.transportName||'-')+'</td><td><span class="badge badge-warning">'+esc(v.status)+'</span></td></tr>';});
    h+='</tbody></table></div></div></div>';
    setHtml(h);
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

// --- Security Gate (Entry By Added) ---
function renderSecurityGate(){
    var h='<div class="section-header"><h2><i class="bx bx-shield-quarter"></i> Security Gate Entry</h2></div>';
    h+='<div class="card"><div class="card-title"><i class="bx bxs-truck"></i> Vehicle Reporting</div>';
    h+='<div class="form-group" style="margin-bottom:16px"><label>Vehicle Type <span class="req">*</span></label>';
    h+='<div style="display:flex;gap:10px;margin-top:6px">';
    h+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 18px;border:2px solid var(--accent);border-radius:var(--radius-sm);background:var(--accent-dim);flex:1;justify-content:center;font-weight:600;color:var(--accent)"><input type="radio" name="vehType" value="Unloading" checked style="accent-color:var(--accent);width:16px;height:16px"> UNLOADING</label>';
    h+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 18px;border:2px solid var(--border);border-radius:var(--radius-sm);flex:1;justify-content:center;font-weight:600;color:var(--text-secondary)"><input type="radio" name="vehType" value="Loading" style="accent-color:var(--accent2);width:16px;height:16px"> LOADING</label>';
    h+='</div></div>';
    h+='<div class="form-row">';
    h+='<div class="form-group"><label>Vehicle Number <span class="req">*</span></label><input type="text" id="secVNo" class="form-input" placeholder="MH-12-AB-1234" style="text-transform:uppercase"></div>';
    h+='<div class="form-group" id="lrGrp"><label>LR Number <span class="req">*</span></label><input type="text" id="secLR" class="form-input" placeholder="LR-2025-001" style="text-transform:uppercase"></div>';
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
    if(e.target.name==='vehType'){
        var lg=document.getElementById('lrGrp');if(lg)lg.style.display=e.target.value==='Unloading'?'':'none';
        document.querySelectorAll('input[name="vehType"]').forEach(function(r){
            var p=r.closest('label');
            if(r.checked){p.style.borderColor=r.value==='Unloading'?'var(--accent)':'var(--accent2)';p.style.background=r.value==='Unloading'?'var(--accent-dim)':'var(--accent2-dim)';p.style.color=r.value==='Unloading'?'var(--accent)':'var(--accent2)';}
            else{p.style.borderColor='var(--border)';p.style.background='transparent';p.style.color='var(--text-secondary)';}
        });
    }
});
function submitSecGate(){
    var vt=document.querySelector('input[name="vehType"]:checked');
    var vno=document.getElementById('secVNo').value.trim().toUpperCase();
    var lr=document.getElementById('secLR').value.trim().toUpperCase();
    var dr=document.getElementById('secDriver').value.trim();
    var mb=document.getElementById('secMobile').value.trim();
    var tp=document.getElementById('secTransport').value.trim();
    if(!vno||!dr||!mb||!tp){showToast('All fields are required','error');return;}
    if(!/^\d{10}$/.test(mb)){showToast('Invalid 10-digit mobile','error');return;}
    var type=vt?vt.value:'Unloading';
    if(type==='Unloading'&&!lr){showToast('LR Number required for unloading','error');return;}
    if(type==='Unloading'){
        var lrE=DB.filter('vehicles',function(v){return v.lrNo&&v.lrNo.toUpperCase()===lr;});
        if(lrE.length>0){showToast('LR Number already exists!','error');return;}
    }
    var status=type==='Unloading'?'Unload Pending':'Loading Pending';
    DB.add('vehicles',{vehicleNo:vno,lrNo:lr||'',driverName:dr,driverMobile:mb,transportName:tp,vehicleType:type,status:status,reportedAt:new Date().toISOString(),entryBy:APP.currentUser?APP.currentUser.id:'',entryByName:APP.currentUser?APP.currentUser.name:''});
    addNotif('New '+type+' Vehicle '+vno+' reported at gate by '+(APP.currentUser?APP.currentUser.name:'Unknown'),'warning');
    logAction('Security Gate','ENTRY',type+' Vehicle '+vno+' LR:'+(lr||'N/A')+' By:'+(APP.currentUser?APP.currentUser.name:'Unknown'));
    showToast('Vehicle submitted successfully!','success');
    document.getElementById('secVNo').value='';document.getElementById('secLR').value='';
    document.getElementById('secDriver').value='';document.getElementById('secMobile').value='';document.getElementById('secTransport').value='';
}

// --- Pending Vehicle (Entry By Column + Manual Assign with Suggestions) ---
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
    // Unassigned
    h+='<div class="card"><div class="card-title"><i class="bx bx-clock"></i> Unassigned Vehicles ('+unassigned.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR No</th><th>Transport</th><th>Invoices</th><th>Materials</th><th>Entry By</th><th>Actions</th></tr></thead><tbody>';
    if(!unassigned.length)h+='<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No unassigned vehicles</td></tr>';
    else unassigned.forEach(function(v){
        var invs=DB.filter('invoices',function(i){return i.vehicleId===v.id;});
        var matCount=0;invs.forEach(function(inv){matCount+=DB.filter('invoice_materials',function(m){return m.invoiceId===inv.id;}).length;});
        h+='<tr><td><strong>'+esc(v.vehicleNo)+'</strong></td><td>'+esc(v.lrNo||'-')+'</td><td>'+esc(v.transportName||'-')+'</td><td><span class="badge badge-info">'+invs.length+'</span></td><td><span class="badge badge-accent">'+matCount+'</span></td><td style="font-size:11px;color:var(--text-secondary)">'+esc(v.entryByName||'-')+'</td><td><div class="table-actions">';
        if(chkAct('canUploadInvoice'))h+='<button class="btn btn-glass btn-sm" onclick="showUploadInvoice(\''+v.id+'\')"><i class="bx bx-upload"></i> Invoice</button>';
        if(chkAct('canAssignVehicle'))h+='<button class="btn btn-glass btn-sm" onclick="showAssignUnloading(\''+v.id+'\')"><i class="bx bx-user-plus"></i> Assign</button>';
        h+='</div></td></tr>';
    });
    h+='</tbody></table></div></div>';
    // Assigned
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-user-check"></i> Assigned Vehicles ('+assigned.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR No</th><th>Assigned To</th><th>Invoices</th><th>Entry By</th><th>Actions</th></tr></thead><tbody>';
    if(!assigned.length)h+='<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No assigned vehicles</td></tr>';
    else assigned.forEach(function(v){
        var invs=DB.filter('invoices',function(i){return i.vehicleId===v.id;});
        h+='<tr><td><strong>'+esc(v.vehicleNo)+'</strong></td><td>'+esc(v.lrNo||'-')+'</td><td>'+esc(v.assignedToName||'-')+'</td><td><span class="badge badge-info">'+invs.length+'</span></td><td style="font-size:11px;color:var(--text-secondary)">'+esc(v.entryByName||'-')+'</td><td><div class="table-actions">';
        if(chkAct('canAssignVehicle'))h+='<button class="btn btn-danger btn-sm" onclick="unassignVehicle(\''+v.id+'\')"><i class="bx bx-user-minus"></i> Unassign</button>';
        h+='</div></td></tr>';
    });
    h+='</tbody></table></div></div>';
    // Posting Pending
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

// Upload Invoice (unchanged)
function showUploadInvoice(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var h='<div class="form-group"><label>Invoice Number <span class="req">*</span></label><input type="text" id="singleInvNo" class="form-input" placeholder="INV-2025-XXX" style="text-transform:uppercase"></div>';
    h+='<div class="form-group"><label>Customer</label><input type="text" id="singleInvCust" class="form-input" placeholder="Customer name"></div>';
    h+='<hr class="cyber-line"><div class="card-title"><i class="bx bx-list-plus"></i> Add Materials</div>';
    h+='<div id="singleMatRows">';
    h+=singleMatRow(0);
    h+='</div>';
    h+='<button class="btn btn-glass btn-sm" onclick="addSingleMatRow()" style="margin-top:8px"><i class="bx bx-plus"></i> Add Material</button>';
    showModal('Upload Invoice — '+v.vehicleNo,h,'lg',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="saveSingleInvoice(\''+vehId+'\')"><i class="bx bx-check"></i> Save Invoice</button>');
}
function singleMatRow(idx){
    var mats=DB.get('material_master');
    var opts='<option value="">Select Material</option>';
    mats.forEach(function(m){opts+='<option value="'+esc(m.material)+'" data-ean="'+esc(m.ean||'')+'">'+esc(m.material)+' ('+esc(m.ean||'')+' )</option>';});
    return '<div class="form-row" style="margin-bottom:8px" id="smr_'+idx+'"><div class="form-group" style="flex:2"><label>Material</label><select class="form-input smr-mat" onchange="smrChange(this,'+idx+')">'+opts+'</select></div><div class="form-group"><label>EAN</label><input type="text" class="form-input smr-ean" id="smrEan_'+idx+'" placeholder="Auto"></div><div class="form-group"><label>Qty</label><input type="number" class="form-input smr-qty" id="smrQty_'+idx+'" placeholder="0" min="1"></div><div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-danger btn-sm" onclick="document.getElementById(\'smr_'+idx+'\').remove()"><i class="bx bx-trash"></i></button></div></div>';
}
var smrIdx=1;
function addSingleMatRow(){
    var c=document.getElementById('singleMatRows');
    var div=document.createElement('div');div.innerHTML=singleMatRow(smrIdx++);
    c.appendChild(div.firstElementChild);
}
function smrChange(sel,idx){
    var opt=sel.options[sel.selectedIndex];
    var eanField=document.getElementById('smrEan_'+idx);
    if(eanField)eanField.value=opt.getAttribute('data-ean')||'';
}
function saveSingleInvoice(vehId){
    var invNo=document.getElementById('singleInvNo').value.trim().toUpperCase();
    if(!invNo){showToast('Invoice number required','error');return;}
    var exists=DB.filter('invoices',function(i){return i.vehicleId===vehId&&i.invoiceNo===invNo;});
    if(exists.length>0){showToast('Invoice number already exists for this vehicle','error');return;}
    var cust=document.getElementById('singleInvCust').value.trim();
    var inv=DB.add('invoices',{vehicleId:vehId,invoiceNo:invNo,customer:cust,status:'Pending'});
    var matSels=document.querySelectorAll('.smr-mat');
    var count=0;
    matSels.forEach(function(sel){
        var row=sel.closest('.form-row');
        var ean=row.querySelector('.smr-ean').value.trim();
        var qty=parseInt(row.querySelector('.smr-qty').value)||0;
        if(sel.value&&qty>0){
            DB.add('invoice_materials',{invoiceId:inv.id,material:sel.value,ean:ean,qty:qty,unloadedQty:0});
            count++;
        }
    });
    logAction('Inbound','INVOICE_UPLOAD','Invoice '+invNo+' uploaded for vehicle '+vehId+' with '+count+' materials');
    showToast('Invoice '+invNo+' saved with '+count+' materials!','success');
    closeModal();renderInbound('pending-vehicle');
}

// Bulk Upload (unchanged)
function showBulkUpload(){
    var h='<div class="form-group"><label>Upload Bulk Data (Excel) <span class="req">*</span></label>';
    h+='<label class="btn btn-glass btn-sm" style="cursor:pointer"><i class="bx bx-upload"></i> Choose File<input type="file" id="bulkFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="document.getElementById(\'bulkFName\').innerText=this.files[0].name"></label>';
    h+='<div id="bulkFName" style="font-size:11px;color:var(--text-muted);margin-top:4px">No file chosen</div></div>';
    h+='<div style="background:var(--bg-secondary);padding:10px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted);border:1px dashed var(--warning)"><strong style="color:var(--warning)">Excel Format:</strong><br>Vehicle No | LR No | Invoice No | Customer | Material | EAN | Qty</div>';
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
            var startRow=(String(data[0][1]||'').toLowerCase().indexOf('lr')>-1)?1:0;
            var vMap={},cInv=0,cMat=0;
            for(var k=startRow;k<data.length;k++){
                var r=data[k];if(!r||!r[1]||!r[2])continue;
                var vNo=String(r[0]||'').trim(),lr=String(r[1]||'').trim().toUpperCase();
                var invNo=String(r[2]||'').trim(),cust=String(r[3]||'').trim();
                var mat=String(r[4]||'').trim(),ean=String(r[5]||'').trim(),qty=parseInt(r[6])||0;
                if(!vMap[lr]){
                    var exV=DB.filter('vehicles',function(v){return v.lrNo&&v.lrNo.toUpperCase()===lr;});
                    if(exV.length>0)vMap[lr]={vid:exV[0].id,invs:{}};
                    else{var nv=DB.add('vehicles',{vehicleNo:vNo,lrNo:lr,driverName:'',driverMobile:'',transportName:'',vehicleType:'Unloading',status:'Unload Pending',reportedAt:new Date().toISOString(),entryBy:'',entryByName:'Bulk Upload'});vMap[lr]={vid:nv.id,invs:{}};}
                }
                if(!vMap[lr].invs[invNo]&&invNo){DB.add('invoices',{vehicleId:vMap[lr].vid,invoiceNo:invNo,customer:cust,status:'Pending'});vMap[lr].invs[invNo]=true;cInv++;}
                if(mat&&qty>0&&vMap[lr].invs[invNo]){
                    var invList=DB.get('invoices'),invObj=null;
                    for(var ii=0;ii<invList.length;ii++){if(invList[ii].vehicleId===vMap[lr].vid&&invList[ii].invoiceNo===invNo){invObj=invList[ii];break;}}
                    if(invObj){DB.add('invoice_materials',{invoiceId:invObj.id,material:mat,ean:ean,qty:qty,unloadedQty:0});cMat++;}
                }
            }
            logAction('Inbound','BULK_UPLOAD',Object.keys(vMap).length+' vehicles, '+cInv+' invoices, '+cMat+' materials');
            showToast('Success! '+cInv+' invoices, '+cMat+' materials','success');
            closeModal();renderInbound('pending-vehicle');
        }catch(err){showToast('Excel error: '+err.message,'error');}
    };
    reader.readAsArrayBuffer(fi.files[0]);
}

// --- Assign Unloading (Manual Name + Suggestions) ---
function showAssignUnloading(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var invs=DB.filter('invoices',function(i){return i.vehicleId===vehId;});
    if(!invs.length){showToast('Upload invoices first!','error');return;}
    var h='<div class="form-group"><label>Vehicle: <strong style="color:var(--accent)">'+esc(v.vehicleNo)+'</strong></label></div>';
    h+='<div class="form-group" style="position:relative"><label>Assign To — Type Name <span class="req">*</span></label>';
    h+='<input type="text" id="assignUserInput" class="form-input" placeholder="Yahan name type karein..." autocomplete="off" oninput="suggestAssignUsers(this.value)" onkeydown="handleAssignKeydown(event)">';
    h+='<input type="hidden" id="assignUserId" value="">';
    h+='<div id="assignUserSuggestions"></div>';
    h+='</div>';
    h+='<div style="background:var(--accent-dim);padding:10px;border-radius:var(--radius-sm);font-size:12px;color:var(--accent)"><i class="bx bx-info-circle"></i> Name type karein — niche suggestions aayengi. Select karein ya jo type kiya wo hi save hoga.</div>';
    showModal('Assign Unloading — '+v.vehicleNo,h,'sm',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="doAssignUnloading(\''+vehId+'\')"><i class="bx bx-check"></i> Assign</button>');
    setTimeout(function(){document.getElementById('assignUserInput').focus();},300);
}
function suggestAssignUsers(query){
    var container=document.getElementById('assignUserSuggestions');
    var hiddenId=document.getElementById('assignUserId');
    if(!query.trim()){container.innerHTML='';hiddenId.value='';return;}
    var users=DB.get('users').filter(function(u){return u.role!=='Super Admin';});
    var q=query.toLowerCase();
    var filtered=users.filter(function(u){return u.name.toLowerCase().indexOf(q)>-1||(u.role||'').toLowerCase().indexOf(q)>-1;});
    if(!filtered.length){
        container.innerHTML='<div style="padding:8px 12px;color:var(--text-muted);font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-top:4px"><i class="bx bx-info-circle"></i> Koi match nahi — jo name type kiya wo save hoga</div>';
        hiddenId.value='';
        return;
    }
    var h='<div style="position:absolute;top:52px;left:0;right:0;background:var(--bg-primary);border:1px solid var(--accent);border-radius:var(--radius-sm);max-height:180px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.5);z-index:999">';
    filtered.forEach(function(u){
        var safeName=esc(u.name).replace(/'/g,"\\'");
        h+='<div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;transition:background 0.15s" onmousedown="selectAssignUser(\''+u.id+'\',\''+safeName+'\')" onmouseover="this.style.background=\'var(--bg-secondary)\'" onmouseout="this.style.background=\'transparent\'">';
        h+='<span><i class="bx bx-user" style="color:var(--accent);margin-right:8px"></i><strong>'+esc(u.name)+'</strong></span>';
        h+='<span class="badge badge-info" style="font-size:10px">'+esc(u.role)+'</span>';
        h+='</div>';
    });
    h+='</div>';
    container.innerHTML=h;
}
function selectAssignUser(id,name){
    document.getElementById('assignUserInput').value=name;
    document.getElementById('assignUserId').value=id;
    document.getElementById('assignUserSuggestions').innerHTML='';
}
function handleAssignKeydown(e){
    if(e.key==='Tab'){
        var firstSug=document.querySelector('#assignUserSuggestions div > div');
        if(firstSug&&document.getElementById('assignUserSuggestions').innerHTML.indexOf('Koi match')===-1){
            e.preventDefault();firstSug.onmousedown();
        }
    }
}
function doAssignUnloading(vehId){
    var nameInput=document.getElementById('assignUserInput').value.trim();
    var userIdInput=document.getElementById('assignUserId').value;
    if(!nameInput){showToast('Name type karein ya select karein','error');return;}
    DB.update('vehicles',vehId,{assignedTo:userIdInput||'manual-'+Date.now(),assignedToName:nameInput,status:'Assigned'});
    addNotif('Vehicle assigned to '+nameInput+' for unloading','info');
    logAction('Inbound','ASSIGN','Vehicle '+vehId+' assigned to '+nameInput);
    showToast('Vehicle assigned to '+nameInput,'success');
    closeModal();renderInbound('pending-vehicle');
}
function unassignVehicle(vehId){
    if(!confirm('Unassign this vehicle?'))return;
    DB.update('vehicles',vehId,{assignedTo:null,assignedToName:null,status:'Unload Pending'});
    logAction('Inbound','UNASSIGN','Vehicle '+vehId+' unassigned');
    showToast('Vehicle unassigned','success');renderInbound('pending-vehicle');
}

// --- Unloading Screen (Clean — No Invoice/Material Badges) ---
function renderUnloadingScreen(){
    if(!APP.currentUser)return;
    var myVehs=DB.filter('vehicles',function(v){
        return v.assignedTo===APP.currentUser.id&&(v.status==='Assigned'||v.status==='Unload Pending');
    });
    var h='<div class="section-header"><h2><i class="bx bx-package"></i> My Unloading</h2></div>';
    if(!myVehs.length){h+='<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No vehicles assigned to you</p></div></div>';setHtml(h);return;}
    myVehs.forEach(function(v){
        h+='<div class="card" style="margin-bottom:14px"><div class="card-title"><i class="bx bxs-truck"></i> '+esc(v.vehicleNo)+' — '+esc(v.lrNo||'')+'</div>';
        // Sirf vehicle info — koi invoice ya material badge nahi
        if(chkAct('canStartUnloading'))h+='<button class="btn btn-glass" onclick="startUnload(\''+v.id+'\')"><i class="bx bx-scan"></i> Start Unload</button>';
        h+='</div>';
    });
    setHtml(h);
}

// --- Start Unload (Blank Scan Page — Auto Match Check) ---
function startUnload(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var invs=DB.filter('invoices',function(i){return i.vehicleId===vehId;});

    // EAN lookup map banao — saare invoices ke materials se
    var lookupMap={};
    invs.forEach(function(inv){
        var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===inv.id;});
        mats.forEach(function(m){
            var ean=(m.ean||'').toUpperCase();
            var matName=(m.material||'').toUpperCase();
            // EAN se map
            if(ean){
                if(!lookupMap[ean])lookupMap[ean]={material:m.material,ean:ean,totalExpected:0,invoices:[]};
                lookupMap[ean].totalExpected+=m.qty;
                lookupMap[ean].invoices.push({invoiceNo:inv.invoiceNo,invoiceId:inv.id,qty:m.qty});
            }
            // Material name se bhi map (EAN nahi ho to)
            if(matName&&!lookupMap[matName]){
                lookupMap[matName]={material:m.material,ean:ean,totalExpected:m.qty,invoices:[{invoiceNo:inv.invoiceNo,invoiceId:inv.id,qty:m.qty}]};
            }
        });
    });

    window._unloadData={vehId:vehId,vehicleNo:v.vehicleNo,lrNo:v.lrNo,lookupMap:lookupMap,scanResults:{},scanOrder:[]};

    var expectedCount=Object.keys(lookupMap).length;
    var h='<div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><div><strong style="color:var(--accent);font-size:16px">'+esc(v.vehicleNo)+'</strong> <span style="color:var(--text-muted)">—</span> '+esc(v.lrNo||'')+'</div><div style="font-size:11px;color:var(--text-muted)">Expected Items: <strong style="color:var(--accent)">'+expectedCount+'</strong></div></div>';

    // Scan input — blank page
    h+='<div class="search-box" style="max-width:100%;margin-bottom:8px"><i class="bx bx-barcode"></i><input type="text" id="scanUnloadInput" placeholder="Scan ya type karein — EAN / Material..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();addScanUnloadItem();}" style="font-family:var(--font-display);font-size:14px;letter-spacing:1px"></div>';
    h+='<div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap">';
    h+='<button class="btn btn-glass btn-sm" onclick="openScannerForUnload()"><i class="bx bx-qr"></i> Scanner</button>';
    h+='<button class="btn btn-glass btn-sm" onclick="addScanUnloadItem()"><i class="bx bx-plus"></i> Add</button>';
    h+='<div style="margin-left:auto;display:flex;align-items:center;gap:6px"><label style="font-size:11px;color:var(--text-muted)">Qty/Scan:</label><input type="number" id="scanQtyPerScan" class="form-input" value="1" min="1" style="width:60px;text-align:center;font-size:12px;padding:4px 8px"></div>';
    h+='</div>';

    // Manual entry toggle
    h+='<div style="margin-bottom:12px"><button class="btn btn-glass btn-sm" onclick="toggleManualEntry()" id="manualEntryToggle"><i class="bx bx-edit"></i> Manual Entry</button>';
    h+='<div id="manualEntryForm" style="display:none;margin-top:8px;padding:12px;border:1px dashed var(--border);border-radius:var(--radius-sm);background:var(--bg-secondary)">';
    h+='<div class="form-row">';
    h+='<div class="form-group" style="flex:1"><label>EAN</label><input type="text" id="manualEan" class="form-input" placeholder="EAN Number" style="font-family:var(--font-display)"></div>';
    h+='<div class="form-group" style="flex:2"><label>Material</label><input type="text" id="manualMat" class="form-input" placeholder="Material name"></div>';
    h+='<div class="form-group"><label>Qty</label><input type="number" id="manualQty" class="form-input" value="1" min="1"></div>';
    h+='<div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-glass btn-sm" onclick="addManualEntry()"><i class="bx bx-plus"></i> Add</button></div>';
    h+='</div></div></div>';

    // Results table
    h+='<div class="table-wrapper" style="max-height:300px;overflow-y:auto"><table class="data-table"><thead><tr><th>#</th><th>EAN</th><th>Material</th><th>Invoice</th><th>Expected</th><th>Scanned</th><th>Status</th><th></th></tr></thead><tbody id="scanUnloadBody"></tbody></table></div>';

    // Summary
    h+='<div id="scanSummary" style="margin-top:10px;padding:10px;background:var(--bg-secondary);border-radius:var(--radius-sm);font-size:12px;display:none"></div>';

    h+='<div class="form-actions" style="margin-top:14px"><button class="btn btn-glass" onclick="submitUnloading()"><i class="bx bx-check-double"></i> Submit Unloading</button></div>';

    showModal('Unloading — '+v.vehicleNo,h,'xl','<button class="btn btn-glass" onclick="closeModal()">Cancel</button>');
    renderScanUnloadTable();
    document.getElementById('scanUnloadInput').focus();
}
function toggleManualEntry(){
    var f=document.getElementById('manualEntryForm');
    f.style.display=f.style.display==='none'?'':'none';
}
function openScannerForUnload(){
    APP.scanCallback=function(code){document.getElementById('scanUnloadInput').value=code;addScanUnloadItem();};
    document.getElementById('scannerModal').style.display='flex';focusForBluetoothScanner();
}
function addScanUnloadItem(){
    var input=document.getElementById('scanUnloadInput');if(!input)return;
    var val=input.value.trim().toUpperCase();input.value='';
    if(!val)return;
    var qtyPerScan=parseInt(document.getElementById('scanQtyPerScan').value)||1;
    processUnloadScan(val,qtyPerScan);
    document.getElementById('scanUnloadInput').focus();
}
function addManualEntry(){
    var ean=document.getElementById('manualEan').value.trim().toUpperCase();
    var mat=document.getElementById('manualMat').value.trim().toUpperCase();
    var qty=parseInt(document.getElementById('manualQty').value)||1;
    if(!ean&&!mat){showToast('EAN ya Material dalein','error');return;}
    processUnloadScan(ean||mat,qty);
    document.getElementById('manualEan').value='';document.getElementById('manualMat').value='';document.getElementById('manualQty').value='1';
}
function processUnloadScan(val,qty){
    var ud=window._unloadData;if(!ud)return;
    var found=ud.lookupMap[val];
    if(found){
        if(!ud.scanResults[val]){
            ud.scanResults[val]={material:found.material,ean:found.ean,expectedQty:found.totalExpected,scannedQty:0,match:true,invoiceNo:found.invoices.map(function(i){return i.invoiceNo;}).join(', ')};
            ud.scanOrder.push(val);
        }
        ud.scanResults[val].scannedQty+=qty;
    } else {
        if(!ud.scanResults[val]){
            ud.scanResults[val]={material:'UNKNOWN',ean:val,expectedQty:0,scannedQty:0,match:false,invoiceNo:'-'};
            ud.scanOrder.push(val);
        }
        ud.scanResults[val].scannedQty+=qty;
    }
    renderScanUnloadTable();
}
function renderScanUnloadTable(){
    var ud=window._unloadData;if(!ud)return;
    var body=document.getElementById('scanUnloadBody');if(!body)return;
    var summaryDiv=document.getElementById('scanSummary');
    var h='',matchC=0,shortC=0,excessC=0,wrongC=0;
    ud.scanOrder.forEach(function(key,idx){
        var r=ud.scanResults[key];
        var stText,stCls,rowCls;
        if(!r.match){stText='Wrong';stCls='badge-danger';rowCls='scan-row-red';wrongC++;}
        else if(r.scannedQty===r.expectedQty){stText='Match';stCls='badge-success';rowCls='scan-row-green';matchC++;}
        else if(r.scannedQty<r.expectedQty){stText='Short';stCls='badge-warning';rowCls='';shortC++;}
        else{stText='Excess';stCls='badge-danger';rowCls='scan-row-red';excessC++;}
        var safeKey=esc(key).replace(/'/g,"\\'");
        h+='<tr class="'+rowCls+'"><td>'+(idx+1)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(r.ean)+'</td><td>'+esc(r.material)+'</td><td style="font-size:10px">'+esc(r.invoiceNo)+'</td><td>'+r.expectedQty+'</td><td><strong>'+(r.scannedQty||0)+'</strong></td><td><span class="badge '+stCls+'">'+stText+'</span></td><td><button class="btn btn-danger btn-sm" onclick="removeScanResult(\''+safeKey+'\')"><i class="bx bx-minus"></i></button></td></tr>';
    });
    if(!ud.scanOrder.length){
        h='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px"><i class="bx bx-barcode" style="font-size:24px;display:block;margin-bottom:8px"></i>Scan ya type karein — result yahan dikhega</td></tr>';
    }
    body.innerHTML=h;
    if(ud.scanOrder.length>0){
        summaryDiv.style.display='';
        summaryDiv.innerHTML='<div style="display:flex;gap:16px;flex-wrap:wrap"><span><i class="bx bx-check-circle" style="color:var(--success)"></i> Match: <strong>'+matchC+'</strong></span><span><i class="bx bx-error-circle" style="color:var(--warning)"></i> Short: <strong>'+shortC+'</strong></span><span><i class="bx bx-plus-circle" style="color:var(--danger)"></i> Excess: <strong>'+excessC+'</strong></span><span><i class="bx bx-x-circle" style="color:var(--danger)"></i> Wrong: <strong>'+wrongC+'</strong></span><span style="margin-left:auto">Scanned: <strong style="color:var(--accent)">'+ud.scanOrder.length+'</strong></span></div>';
    } else {summaryDiv.style.display='none';}
}
function removeScanResult(key){
    var ud=window._unloadData;if(!ud||!ud.scanResults[key])return;
    ud.scanResults[key].scannedQty--;
    if(ud.scanResults[key].scannedQty<=0){delete ud.scanResults[key];ud.scanOrder=ud.scanOrder.filter(function(k){return k!==key;});}
    renderScanUnloadTable();
}

// --- Submit Unloading (with Short/Excess Report) ---
function submitUnloading(){
    var ud=window._unloadData;if(!ud)return;
    if(!ud.scanOrder.length){showToast('Kam se kam ek item scan karein','error');return;}
    var unloadNo=DB.unloadNo();
    var materials=[],shortItems=[],excessItems=[],wrongItems=[];

    // Scanned items add karo
    ud.scanOrder.forEach(function(key){
        var r=ud.scanResults[key];
        materials.push({invoiceNo:r.invoiceNo,material:r.material,ean:r.ean,expectedQty:r.expectedQty,scannedQty:r.scannedQty,diff:r.expectedQty-r.scannedQty,match:r.match});
        if(!r.match)wrongItems.push({ean:r.ean,material:r.material,scannedQty:r.scannedQty});
        else if(r.scannedQty<r.expectedQty)shortItems.push({invoiceNo:r.invoiceNo,material:r.material,ean:r.ean,expected:r.expectedQty,scanned:r.scannedQty,short:r.expectedQty-r.scannedQty});
        else if(r.scannedQty>r.expectedQty)excessItems.push({invoiceNo:r.invoiceNo,material:r.material,ean:r.ean,expected:r.expectedQty,scanned:r.scannedQty,excess:r.scannedQty-r.expectedQty});
    });

    // Jo expected the but scan hi nahi hue — complete short
    Object.keys(ud.lookupMap).forEach(function(key){
        if(!ud.scanResults[key]){
            var lm=ud.lookupMap[key];
            materials.push({invoiceNo:lm.invoices.map(function(i){return i.invoiceNo;}).join(', '),material:lm.material,ean:lm.ean,expectedQty:lm.totalExpected,scannedQty:0,diff:lm.totalExpected,match:true});
            shortItems.push({invoiceNo:lm.invoices.map(function(i){return i.invoiceNo;}).join(', '),material:lm.material,ean:lm.ean,expected:lm.totalExpected,scanned:0,short:lm.totalExpected});
        }
    });

    DB.add('unloading_records',{unloadNo:unloadNo,vehicleId:ud.vehId,vehicleNo:ud.vehicleNo,lrNo:ud.lrNo,unloadedBy:APP.currentUser.id,unloadedByName:APP.currentUser.name,unloadedAt:new Date().toISOString(),materials:materials,status:'Posting Pending Approval'});
    DB.update('vehicles',ud.vehId,{status:'Posting Pending Approval',unloadNo:unloadNo,unloadedBy:APP.currentUser.id,unloadedByName:APP.currentUser.name,unloadedAt:new Date().toISOString()});

    // Update invoice materials
    ud.scanOrder.forEach(function(key){
        var r=ud.scanResults[key];
        if(r.match&&r.ean){
            var invs=DB.filter('invoices',function(i){return i.vehicleId===ud.vehId;});
            var invIds=invs.map(function(i){return i.id;});
            var ims=DB.filter('invoice_materials',function(m){return m.ean&&m.ean.toUpperCase()===r.ean&&invIds.indexOf(m.invoiceId)>-1;});
            ims.forEach(function(im){DB.update('invoice_materials',im.id,{unloadedQty:(im.unloadedQty||0)+r.scannedQty});});
        }
    });

    // Short/Excess Report banao agar discrepancy hai
    var hasDiscrepancy=shortItems.length>0||excessItems.length>0||wrongItems.length>0;
    var reportId=null;
    if(hasDiscrepancy){
        var reportNo=generateSERNo();
        var totalExp=0,totalScn=0;
        materials.forEach(function(m){totalExp+=m.expectedQty;totalScn+=m.scannedQty;});
        reportId=DB.add('short_excess_reports',{reportNo:reportNo,vehicleNo:ud.vehicleNo,lrNo:ud.lrNo,unloadNo:unloadNo,shortItems:shortItems,excessItems:excessItems,wrongItems:wrongItems,totalExpected:totalExp,totalScanned:totalScn,createdBy:APP.currentUser.name,createdAt:new Date().toISOString()}).id;
    }

    addNotif('Unloading '+unloadNo+' submitted for '+ud.vehicleNo,'warning');
    logAction('Unloading','SUBMIT',unloadNo+' for '+ud.vehicleNo);
    showToast('Unloading submitted!','success');
    closeModal();

    if(reportId){setTimeout(function(){showSEReport(reportId);},400);}
    else{renderUnloadingScreen();}
}

function generateSERNo(){
    var existing=DB.get('short_excess_reports');
    return 'SER-'+new Date().getFullYear()+'-'+String(existing.length+1).padStart(4,'0');
}

// --- Short/Excess Report View + PDF Download ---
function showSEReport(reportId){
    var report=DB.find('short_excess_reports',reportId);if(!report)return;
    var h='<div style="text-align:center;margin-bottom:16px"><div style="font-size:20px;font-weight:800;color:var(--accent);font-family:var(--font-display);letter-spacing:2px">'+esc(report.reportNo)+'</div><div style="font-size:12px;color:var(--text-muted)">Short / Excess / Wrong Report</div></div>';
    h+='<div style="display:flex;gap:16px;margin-bottom:12px;font-size:12px;flex-wrap:wrap"><span><strong>Vehicle:</strong> '+esc(report.vehicleNo)+'</span><span><strong>LR:</strong> '+esc(report.lrNo||'-')+'</span><span><strong>Unload:</strong> '+esc(report.unloadNo)+'</span><span><strong>Date:</strong> '+fmtDT(report.createdAt)+'</span><span><strong>By:</strong> '+esc(report.createdBy)+'</span></div>';
    h+='<div style="display:flex;gap:12px;margin-bottom:12px">';
    h+='<div style="flex:1;padding:10px;background:var(--accent-dim);border-radius:var(--radius-sm);text-align:center"><div style="font-size:20px;font-weight:700;color:var(--accent)">'+report.totalExpected+'</div><div style="font-size:10px;color:var(--text-muted)">Expected</div></div>';
    h+='<div style="flex:1;padding:10px;background:rgba(0,255,136,0.08);border-radius:var(--radius-sm);text-align:center"><div style="font-size:20px;font-weight:700;color:var(--success)">'+report.totalScanned+'</div><div style="font-size:10px;color:var(--text-muted)">Scanned</div></div>';
    h+='<div style="flex:1;padding:10px;background:rgba(255,107,107,0.08);border-radius:var(--radius-sm);text-align:center"><div style="font-size:20px;font-weight:700;color:var(--danger)">'+(report.totalExpected-report.totalScanned)+'</div><div style="font-size:10px;color:var(--text-muted)">Difference</div></div>';
    h+='</div>';

    if(report.shortItems&&report.shortItems.length){
        h+='<div class="card-title" style="color:var(--warning)"><i class="bx bx-minus-circle"></i> Short Items ('+report.shortItems.length+')</div>';
        h+='<div class="table-wrapper" style="max-height:150px;overflow-y:auto"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Invoice</th><th>Expected</th><th>Scanned</th><th>Short</th></tr></thead><tbody>';
        report.shortItems.forEach(function(s){h+='<tr class="scan-row-red"><td>'+esc(s.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td style="font-size:10px">'+esc(s.invoiceNo)+'</td><td>'+s.expected+'</td><td>'+s.scanned+'</td><td><strong style="color:var(--danger)">-'+s.short+'</strong></td></tr>';});
        h+='</tbody></table></div>';
    }
    if(report.excessItems&&report.excessItems.length){
        h+='<div class="card-title" style="color:var(--danger);margin-top:10px"><i class="bx bx-plus-circle"></i> Excess Items ('+report.excessItems.length+')</div>';
        h+='<div class="table-wrapper" style="max-height:150px;overflow-y:auto"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Invoice</th><th>Expected</th><th>Scanned</th><th>Excess</th></tr></thead><tbody>';
        report.excessItems.forEach(function(s){h+='<tr><td>'+esc(s.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td style="font-size:10px">'+esc(s.invoiceNo)+'</td><td>'+s.expected+'</td><td>'+s.scanned+'</td><td><strong style="color:var(--danger)">+'+s.excess+'</strong></td></tr>';});
        h+='</tbody></table></div>';
    }
    if(report.wrongItems&&report.wrongItems.length){
        h+='<div class="card-title" style="color:var(--danger);margin-top:10px"><i class="bx bx-x-circle"></i> Wrong Items ('+report.wrongItems.length+')</div>';
        h+='<div class="table-wrapper" style="max-height:150px;overflow-y:auto"><table class="data-table"><thead><tr><th>EAN</th><th>Material</th><thMaterial</th><th>Qty</th></tr></thead><tbody>';
        report.wrongItems.forEach(function(s){h+='<tr class="scan-row-red"><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td>'+esc(s.material)+'</td><td><strong style="color:var(--danger)">'+s.scannedQty+'</strong></td></tr>';});
        h+='</tbody></table></div>';
    }

    h+='<div class="form-actions" style="margin-top:16px"><button class="btn btn-glass" onclick="downloadSERPDF(\''+reportId+'\')"><i class="bx bx-download"></i> Download PDF</button><button class="btn btn-glass" onclick="closeModal();renderUnloadingScreen();">Close</button></div>';
    showModal('Short / Excess Report',h,'xl','');
}

// --- PDF Download for SER Report ---
function downloadSERPDF(reportId){
    var report=DB.find('short_excess_reports',reportId);if(!report){showToast('Report not found','error');return;}
    var jsPDF=window.jspdf.jsPDF;
    var doc=new jsPDF({unit:'mm',format:'a4'});
    var y=15;

    // Header
    doc.setFillColor(15,23,42);doc.rect(0,0,210,40,'F');
    doc.setTextColor(0,255,136);doc.setFontSize(18);doc.setFont('helvetica','bold');
    doc.text('SHORT / EXCESS REPORT',105,y+8,{align:'center'});
    doc.setTextColor(200,200,200);doc.setFontSize(10);doc.setFont('helvetica','normal');
    doc.text(report.reportNo,105,y+18,{align:'center'});
    doc.setTextColor(150,150,150);doc.setFontSize(8);
    doc.text('Generated: '+fmtDT(new Date()),105,y+26,{align:'center'});
    y=48;

    // Info box
    doc.setDrawColor(0,255,136);doc.setLineWidth(0.5);doc.rect(10,y,190,22);
    doc.setTextColor(30,30,30);doc.setFontSize(9);doc.setFont('helvetica','bold');
    doc.text('Vehicle: '+report.vehicleNo,15,y+7);
    doc.text('LR: '+(report.lrNo||'-'),80,y+7);
    doc.text('Unload: '+report.unloadNo,140,y+7);
    doc.text('By: '+report.createdBy,15,y+16);
    doc.text('Date: '+fmtDT(report.createdAt),80,y+16);
    y=78;

    // Summary boxes
    doc.setFillColor(240,240,240);doc.roundedRect(10,y,58,18,3,3,'F');
    doc.roundedRect(76,y,58,18,3,3,'F');
    doc.roundedRect(142,y,58,18,3,3,'F');
    doc.setFontSize(14);doc.setFont('helvetica','bold');doc.setTextColor(0,100,200);
    doc.text(String(report.totalExpected),39,y+12,{align:'center'});
    doc.setTextColor(0,180,80);
    doc.text(String(report.totalScanned),105,y+12,{align:'center'});
    doc.setTextColor(220,50,50);
    doc.text(String(report.totalExpected-report.totalScanned),171,y+12,{align:'center'});
    doc.setFontSize(7);doc.setTextColor(100,100,100);doc.setFont('helvetica','normal');
    doc.text('EXPECTED',39,y+17,{align:'center'});
    doc.text('SCANNED',105,y+17,{align:'center'});
    doc.text('DIFFERENCE',171,y+17,{align:'center'});
    y=104;

    // Table helper
    function addTableHeader(cols,colors){
        doc.setFillColor(30,40,60);doc.rect(10,y,190,8,'F');
        doc.setTextColor(255,255,255);doc.setFontSize(7);doc.setFont('helvetica','bold');
        var x=12;
        cols.forEach(function(c,i){doc.text(c,x,y+5.5);x+=colors[i];});
        y+=10;
    }
    function addTableRow(cells,widths,isAlt){
        if(isAlt){doc.setFillColor(245,245,245);doc.rect(10,y-3,190,7,'F');}
        doc.setTextColor(30,30,30);doc.setFontSize(7);doc.setFont('helvetica','normal');
        var x=12;
        cells.forEach(function(c,i){doc.text(String(c),x,y+1);x+=widths[i];});
        y+=6;
    }
    function checkPage(needed){
        if(y+needed>280){doc.addPage();y=15;return true;}return false;
    }

    // Short Items
    if(report.shortItems&&report.shortItems.length){
        checkPage(30);
        doc.setTextColor(200,120,0);doc.setFontSize(10);doc.setFont('helvetica','bold');
        doc.text('SHORT ITEMS ('+report.shortItems.length+')',10,y);y+=6;
        addTableHeader(['Material','EAN','Invoice','Expected','Scanned','Short'],[55,40,35,20,20,20]);
        report.shortItems.forEach(function(s,i){
            checkPage(8);
            addTableRow([s.material||'-',s.ean||'-',s.invoiceNo||'-',String(s.expected),String(s.scanned),'-'+s.short],[55,40,35,20,20,20],i%2===1);
        });
        y+=4;
    }

    // Excess Items
    if(report.excessItems&&report.excessItems.length){
        checkPage(30);
        doc.setTextColor(220,50,50);doc.setFontSize(10);doc.setFont('helvetica','bold');
        doc.text('EXCESS ITEMS ('+report.excessItems.length+')',10,y);y+=6;
        addTableHeader(['Material','EAN','Invoice','Expected','Scanned','Excess'],[55,40,35,20,20,20]);
        report.excessItems.forEach(function(s,i){
            checkPage(8);
            addTableRow([s.material||'-',s.ean||'-',s.invoiceNo||'-',String(s.expected),String(s.scanned),'+'+s.excess],[55,40,35,20,20,20],i%2===1);
        });
        y+=4;
    }

    // Wrong Items
    if(report.wrongItems&&report.wrongItems.length){
        checkPage(30);
        doc.setTextColor(220,50,50);doc.setFontSize(10);doc.setFont('helvetica','bold');
        doc.text('WRONG ITEMS ('+report.wrongItems.length+')',10,y);y+=6;
        addTableHeader(['EAN','Material','Qty Scanned'],[60,80,50]);
        report.wrongItems.forEach(function(s,i){
            checkPage(8);
            addTableRow([s.ean||'-',s.material||'-',String(s.scannedQty)],[60,80,50],i%2===1);
        });
    }

    // Footer
    y=272;
    doc.setDrawColor(150,150,150);doc.line(10,y,200,y);
    doc.setTextColor(130,130,130);doc.setFontSize(7);
    doc.text('This is system generated report — '+report.reportNo+' — '+APP.currentUser.name,105,y+5,{align:'center'});

    doc.save(report.reportNo+'.pdf');
    showToast('PDF downloaded!','success');
    logAction('Report','PDF_DOWNLOAD','SER PDF '+report.reportNo);
}

// --- Posting Pending (unchanged) ---
function renderPostingPending(){
    var pending=DB.filter('vehicles',function(v){return v.status==='Posting Pending Approval';});
    var h='<div class="section-header"><h2><i class="bx bx-error-circle"></i> Posting Pending Approval ('+pending.length+')</h2></div>';
    if(!pending.length){h+='<div class="card"><div class="empty-state"><i class="bx bx-check-circle"></i><p>All clear! No pending approvals.</p></div></div>';setHtml(h);return;}
    pending.forEach(function(v){
        var rec=DB.filter('unloading_records',function(r){return r.vehicleId===v.id&&r.status==='Posting Pending Approval';})[0];
        h+='<div class="card" style="margin-bottom:12px"><div class="card-title"><i class="bx bxs-truck"></i> '+esc(v.vehicleNo)+' — '+esc(v.lrNo||'')+'</div>';
        h+='<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Unload No: <strong style="color:var(--accent);font-family:var(--font-display)">'+esc(v.unloadNo||'-')+'</strong> | By: '+esc(v.unloadedByName||'-')+' | Time: '+fmtDT(v.unloadedAt)+'</div>';
        if(rec&&rec.materials){
            h+='<div class="table-wrapper" style="max-height:200px;overflow-y:auto"><table class="data-table"><thead><tr><th>Invoice</th><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Diff</th></tr></thead><tbody>';
            rec.materials.forEach(function(m){
                var cls=m.diff===0?'qty-match':(m.diff>0?'qty-mismatch':'qty-mismatch');
                h+='<tr><td style="font-size:11px">'+esc(m.invoiceNo)+'</td><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+m.expectedQty+'</td><td>'+m.scannedQty+'</td><td class="'+cls+'">'+(m.diff>0?'-'+m.diff:(m.diff<0?'+'+Math.abs(m.diff):'0'))+'</td></tr>';
            });
            h+='</tbody></table></div>';
        }
        h+='<div class="form-actions">';
        if(chkAct('canPostVehicle'))h+='<button class="btn btn-glass" onclick="postVehicle(\''+v.id+'\')"><i class="bx bx-check-double"></i> Post Vehicle</button>';
        h+='<button class="btn btn-glass" onclick="viewUnloadingDetail(\''+v.id+'\')"><i class="bx bx-eye"></i> Full Detail</button>';
        h+='</div></div>';
    });
    setHtml(h);
}

// --- Post Vehicle (GRN = GRN-InvoiceNo format) ---
function postVehicle(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var invs=DB.filter('invoices',function(i){return i.vehicleId===vehId;});
    var grnList=[];
    invs.forEach(function(inv){
        // GRN-InvoiceNo format, koi random sequence nahi
        var grnNo='GRN-'+inv.invoiceNo;
        grnList.push({invoiceId:inv.id,invoiceNo:inv.invoiceNo,grnNo:grnNo});
        DB.add('grn_records',{grnNo:grnNo,vehicleId:vehId,vehicleNo:v.vehicleNo,lrNo:v.lrNo,invoiceId:inv.id,invoiceNo:inv.invoiceNo,postedBy:APP.currentUser.id,postedByName:APP.currentUser.name,postedAt:new Date().toISOString()});
        DB.update('invoices',inv.id,{status:'Posted',grnNo:grnNo});
    });
    var recs=DB.filter('unloading_records',function(r){return r.vehicleId===vehId&&r.status==='Posting Pending Approval';});
    recs.forEach(function(r){DB.update('unloading_records',r.id,{status:'Posted'});});
    DB.update('vehicles',vehId,{status:'Posted'});
    addNotif('Vehicle '+v.vehicleNo+' posted. GRNs: '+grnList.map(function(g){return g.grnNo;}).join(', '),'success');
    logAction('Inbound','POST','Vehicle '+v.vehicleNo+' posted. GRNs: '+grnList.length);
    showToast('Vehicle posted! '+grnList.length+' GRN(s) created.','success');
    if(APP.currentSub==='posting-pending')renderPostingPending();
    else if(APP.currentSub==='pending-vehicle')renderPendingVehicle();
    else renderInbound(APP.currentSub);
}

function viewUnloadingDetail(vehId){
    var v=DB.find('vehicles',vehId);if(!v)return;
    var recs=DB.filter('unloading_records',function(r){return r.vehicleId===vehId;});
    var rec=recs[recs.length-1];if(!rec){showToast('No unloading record','error');return;}
    var h='<div style="margin-bottom:12px"><strong>Vehicle:</strong> '+esc(v.vehicleNo)+' | <strong>LR:</strong> '+esc(v.lrNo||'-')+' | <strong>Unload No:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(rec.unloadNo)+'</span></div>';
    h+='<div style="margin-bottom:8px"><strong>By:</strong> '+esc(rec.unloadedByName||'-')+' | <strong>Time:</strong> '+fmtDT(rec.unloadedAt)+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Invoice</th><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Diff</th></tr></thead><tbody>';
    rec.materials.forEach(function(m){
        var cls=m.diff===0?'qty-match':'qty-mismatch';
        h+='<tr class="'+(m.diff===0?'':'scan-row-red')+'"><td>'+esc(m.invoiceNo)+'</td><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+m.expectedQty+'</td><td>'+m.scannedQty+'</td><td class="'+cls+'">'+(m.diff>0?'Short: -'+m.diff:(m.diff<0?'Extra: +'+Math.abs(m.diff):'0'))+'</td></tr>';
    });
    h+='</tbody></table></div>';
    // SER Report link agar hai
    var serReports=DB.filter('short_excess_reports',function(s){return s.vehicleNo===v.vehicleNo;});
    if(serReports.length){
        h+='<div style="margin-top:12px"><strong style="color:var(--warning)">Discrepancy Reports:</strong></div>';
        serReports.forEach(function(s){
            var itemCount=(s.shortItems||[]).length+(s.excessItems||[]).length+(s.wrongItems||[]).length;
            h+='<div class="inv-list-item" onclick="showSEReport(\''+s.id+'\')"><div class="ili-left"><span class="ili-invno">'+esc(s.reportNo)+'</span><span class="ili-info">'+itemCount+' items | Expected: '+s.totalExpected+' | Scanned: '+s.totalScanned+'</span></div><span class="badge badge-danger">View / PDF</span></div>';
        });
    }
    // GRN info
    var grns=DB.filter('grn_records',function(g){return g.vehicleId===vehId;});
    if(grns.length){
        h+='<div style="margin-top:12px"><strong style="color:var(--accent)">GRN Numbers:</strong></div>';
        grns.forEach(function(g){h+='<div class="inv-list-item"><div class="ili-left"><span class="ili-invno">'+esc(g.grnNo)+'</span><span class="ili-info">'+esc(g.invoiceNo)+'</span></div></div>';});
    }
    showModal('Unloading Detail — '+v.vehicleNo,h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}

// --- Inbound Record (GRN = GRN-InvoiceNo, GRN Search shows inbound material) ---
function renderInboundRecord(){
    var vehs=DB.get('vehicles').filter(function(v){return v.vehicleType==='Unloading';}).reverse();
    var h='<div class="section-header"><h2><i class="bx bx-list-ul"></i> Inbound Record ('+vehs.length+')</h2>';
    h+='<button class="btn btn-glass" onclick="exportInboundExcel()"><i class="bx bx-download"></i> Excel</button>';
    h+='</div>';
    // GRN Search Box
    h+='<div class="card" style="margin-bottom:12px"><div class="card-title"><i class="bx bx-search"></i> Search GRN No — Inbound Material Dekhen</div>';
    h+='<div class="search-box" style="max-width:500px"><i class="bx bx-barcode"></i><input type="text" id="grnSearchInput" placeholder="GRN-INV001 type karein..." oninput="searchGRNForMaterial()" style="font-family:var(--font-display);letter-spacing:1px"></div>';
    h+='<div id="grnSearchResult"></div></div>';
    // Vehicle table
    h+='<div class="search-box"><i class="bx bx-search"></i><input type="text" id="inboundRecSearch" placeholder="Search vehicle, LR..." oninput="filterInboundRec()"></div>';
    h+='<div id="inboundRecTable">';
    h+=buildInboundRecTable(vehs);
    h+='</div>';
    setHtml(h);
}
function searchGRNForMaterial(){
    var q=document.getElementById('grnSearchInput').value.trim().toUpperCase();
    var container=document.getElementById('grnSearchResult');
    if(!q){container.innerHTML='';return;}
    var grns=DB.filter('grn_records',function(g){return (g.grnNo||'').toUpperCase().indexOf(q)>-1;});
    if(!grns.length){container.innerHTML='<div style="color:var(--text-muted);padding:12px;font-size:12px">GRN nahi mila</div>';return;}
    var h='';
    grns.forEach(function(g){
        var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;});
        h+='<div style="margin-top:10px;padding:12px;border:1px solid var(--accent);border-radius:var(--radius-sm);background:var(--accent-dim)">';
        h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="font-family:var(--font-display);font-size:13px;font-weight:700;color:var(--accent)">'+esc(g.grnNo)+'</span><span style="font-size:11px;color:var(--text-muted)">'+fmtDT(g.postedAt)+'</span></div>';
        h+='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Invoice: <strong>'+esc(g.invoiceNo)+'</strong> | Vehicle: <strong>'+esc(g.vehicleNo)+'</strong> | LR: <strong>'+esc(g.lrNo||'-')+'</strong> | Posted By: <strong>'+esc(g.postedByName||'-')+'</strong></div>';
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Invoice Qty</th><th>Unloaded Qty</th><th>Status</th></tr></thead><tbody>';
        var totalInv=0,totalUnl=0;
        mats.forEach(function(m){
            totalInv+=m.qty;totalUnl+=(m.unloadedQty||0);
            var diff=m.qty-(m.unloadedQty||0);
            var stCls=diff===0?'badge-success':(diff>0?'badge-warning':'badge-danger');
            var stTxt=diff===0?'Full':'Short: '+diff;
            h+='<tr><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+m.qty+'</td><td>'+(m.unloadedQty||0)+'</td><td><span class="badge '+stCls+'">'+stTxt+'</span></td></tr>';
        });
        h+='<tr style="background:var(--bg-secondary);font-weight:700"><td colspan="2">TOTAL</td><td style="color:var(--accent)">'+totalInv+'</td><td style="color:var(--success)">'+totalUnl+'</td><td>'+(totalInv===totalUnl?'<span class="badge badge-success">Complete</span>':'<span class="badge badge-warning">Pending: '+(totalInv-totalUnl)+'</span>')+'</td></tr>';
        h+='</tbody></table></div></div>';
    });
    container.innerHTML=h;
}
function buildInboundRecTable(vehs){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Vehicle No</th><th>LR No</th><th>Transport</th><th>Invoices</th><th>Status</th><th>Entry By</th><th>GRN</th><th>Actions</th></tr></thead><tbody>';
    if(!vehs.length)h+='<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">No records</td></tr>';
    else vehs.forEach(function(v){
        var invs=DB.filter('invoices',function(i){return i.vehicleId===v.id;});
        var grns=DB.filter('grn_records',function(g){return g.vehicleId===v.id;});
        var grnStr=grns.map(function(g){return g.grnNo;}).join(', ')||'-';
        var statusCls=v.status==='Posted'?'badge-success':(v.status==='Posting Pending Approval'?'badge-warning':(v.status==='Assigned'?'badge-info':'badge-warning'));
        h+='<tr><td><strong>'+esc(v.vehicleNo)+'</strong></td><td>'+esc(v.lrNo||'-')+'</td><td>'+esc(v.transportName||'-')+'</td><td><span class="badge badge-info">'+invs.length+'</span></td><td><span class="badge '+statusCls+'">'+esc(v.status)+'</span></td><td style="font-size:11px;color:var(--text-secondary)">'+esc(v.entryByName||'-')+'</td><td style="font-size:10px;font-family:var(--font-display);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(grnStr)+'</td><td><div class="table-actions">';
        h+='<button class="btn btn-glass btn-sm" onclick="viewUnloadingDetail(\''+v.id+'\')"><i class="bx bx-eye"></i></button>';
        h+='</div></td></tr>';
    });
    h+='</tbody></table></div>';
    return h;
}
function filterInboundRec(){
    var q=document.getElementById('inboundRecSearch').value.trim().toLowerCase();
    var vehs=DB.get('vehicles').filter(function(v){return v.vehicleType==='Unloading';}).reverse();
    if(q){
        vehs=vehs.filter(function(v){
            return (v.vehicleNo||'').toLowerCase().indexOf(q)>-1||(v.lrNo||'').toLowerCase().indexOf(q)>-1||(v.transportName||'').toLowerCase().indexOf(q)>-1||(v.entryByName||'').toLowerCase().indexOf(q)>-1;
        });
    }
    document.getElementById('inboundRecTable').innerHTML=buildInboundRecTable(vehs);
}
function exportInboundExcel(){
    var vehs=DB.get('vehicles').filter(function(v){return v.vehicleType==='Unloading';});
    var rows=[['Vehicle No','LR No','Transport','Driver','Status','Entry By','Reported At']];
    vehs.forEach(function(v){rows.push([v.vehicleNo,v.lrNo||'',v.transportName||'',v.driverName||'',v.status,v.entryByName||'',fmtDT(v.reportedAt)]);});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Inbound');XLSX.writeFile(wb,'Inbound_Record_'+today()+'.xlsx');
    showToast('Excel downloaded!','success');
}

// --- Unloading Stock (unchanged) ---
function renderUnloadingStock(){
    var grns=DB.get('grn_records').reverse();
    var h='<div class="section-header"><h2><i class="bx bx-box"></i> Unloading Stock</h2></div>';
    h+='<div class="search-box"><i class="bx bx-search"></i><input type="text" id="stockSearch" placeholder="Search GRN No or Invoice No..." oninput="filterStock()"></div>';
    h+='<div id="stockList">';
    h+=buildStockList(grns);
    h+='</div>';
    setHtml(h);
}
function buildStockList(grns){
    var h='';
    if(!grns.length){h+='<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No unloading stock</p></div></div>';return h;}
    grns.forEach(function(g){
        var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;});
        h+='<div class="inv-list-item" onclick="showStockDetail(\''+g.id+'\')">';
        h+='<div class="ili-left"><span class="ili-invno">'+esc(g.grnNo)+'</span><span class="ili-info">'+esc(g.invoiceNo)+' | '+esc(g.vehicleNo)+' | '+mats.length+' materials</span></div>';
        h+='<span class="badge badge-accent">'+fmtDate(g.postedAt)+'</span>';
        h+='</div>';
    });
    return h;
}
function filterStock(){
    var q=document.getElementById('stockSearch').value.trim().toLowerCase();
    var grns=DB.get('grn_records').reverse();
    if(q){grns=grns.filter(function(g){return (g.grnNo||'').toLowerCase().indexOf(q)>-1||(g.invoiceNo||'').toLowerCase().indexOf(q)>-1;});}
    document.getElementById('stockList').innerHTML=buildStockList(grns);
}
function showStockDetail(grnId){
    var g=DB.find('grn_records',grnId);if(!g)return;
    var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;});
    var h='<div style="margin-bottom:12px"><strong>GRN:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(g.grnNo)+'</span> | <strong>Invoice:</strong> '+esc(g.invoiceNo)+' | <strong>Vehicle:</strong> '+esc(g.vehicleNo)+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Invoice Qty</th><th>Unloaded Qty</th><th>Remaining</th></tr></thead><tbody>';
    mats.forEach(function(m){
        var remaining=m.qty-(m.unloadedQty||0);
        h+='<tr><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+m.qty+'</td><td>'+(m.unloadedQty||0)+'</td><td class="'+(remaining>0?'qty-match':'')+'">'+remaining+'</td></tr>';
    });
    h+='</tbody></table></div>';
    h+='<div class="form-actions"><button class="btn btn-glass" onclick="startPutawayFromStock(\''+g.id+'\')"><i class="bx bx-package"></i> Start Putaway</button></div>';
    showModal('Stock Detail — '+g.grnNo,h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
function startPutawayFromStock(grnId){
    closeModal();
    var g=DB.find('grn_records',grnId);if(!g)return;
    navTo('putaway');
    setTimeout(function(){
        var invNoInput=document.getElementById('putawayInvNo');
        if(invNoInput){invNoInput.value=g.invoiceNo;filterPutawayInv();}
    },200);
}

// ==================== PUTAWAY ====================
function renderPutaway(){
    window._putawayItems = window._putawayItems || [];
    var h='<div class="section-header"><h2><i class="bx bx-package"></i> Putaway</h2></div>';

    // === Pending Putaway Card ===
    var pendingMats=getPendingPutawayMaterials();
    h+='<div class="card"><div class="card-title"><i class="bx bx-time" style="color:var(--warning)"></i> Pending Putaway ('+pendingMats.length+')</div>';
    if(!pendingMats.length){
        h+='<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:12px"><i class="bx bx-check-circle" style="font-size:20px;display:block;margin-bottom:6px;color:var(--success)"></i>Sab putaway complete! Koi pending nahi.</div>';
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
    h+='<div class="form-group"><label>EAN Number <span class="req">*</span></label>';
    h+='<div style="display:flex;gap:6px"><div class="search-box" style="flex:1;max-width:100%"><i class="bx bx-barcode"></i><input type="text" id="putawayEanScan" placeholder="Scan or type EAN..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();lookupPutawayEan();}" style="font-family:var(--font-display);font-size:13px;letter-spacing:1px"></div>';
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
        var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;});
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
function doPutaway(grnId){
    var g=DB.find('grn_records',grnId);if(!g)return;
    var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;});

    // Sirf wahi materials dikhao jinka putaway baaki hai
    var pendingMats=mats.filter(function(m){return (m.putawayedQty||0)<m.qty;});
    if(!pendingMats.length){showToast('Sab materials ka putaway ho chuka hai!','success');return;}

    var rackList=DB.get('rack_master');
    var rOpts='<option value="">-- Scan ya Select --</option>';
    rackList.forEach(function(r){rOpts+='<option value="'+esc(r.rack)+'">'+esc(r.rack)+'</option>';});

    var totalRemaining=0;
    pendingMats.forEach(function(m){totalRemaining+=m.qty-(m.putawayedQty||0);});

    var h='<div style="margin-bottom:10px"><strong>GRN:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(g.grnNo)+'</span> | <strong>Invoice:</strong> '+esc(g.invoiceNo)+' | <strong>Vehicle:</strong> '+esc(g.vehicleNo)+'</div>';
    h+='<div style="background:var(--accent-dim);padding:10px;border-radius:var(--radius-sm);margin-bottom:14px;font-size:12px;color:var(--accent);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><span><i class="bx bx-info-circle"></i> Pending: <strong>'+totalRemaining+'</strong> qty in <strong>'+pendingMats.length+'</strong> materials</span><span style="font-size:11px;color:var(--text-muted)">Partial putaway allowed — remaining next time dikhega</span></div>';

    h+='<div id="putawayGRNMatList">';
    pendingMats.forEach(function(m,idx){
        var remaining=m.qty-(m.putawayedQty||0);
        var matMaster=DB.filter('material_master',function(mm){return mm.ean&&mm.ean===m.ean;});
        var desc=matMaster.length>0?(matMaster[0].description||matMaster[0].material):m.material;
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
    focusForBluetoothScanner();
}

// --- Save Putaway from GRN (Partial Allowed) ---
function savePutawayFromGRN(grnId){
    var g=DB.find('grn_records',grnId);if(!g)return;
    var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;});
    var pendingMats=mats.filter(function(m){return (m.putawayedQty||0)<m.qty;});
    var count=0, totalSaved=0;

    pendingMats.forEach(function(m,idx){
        var rackField=document.getElementById('paGRackScan_'+idx);
        var qtyField=document.getElementById('paGQty_'+idx);
        var packField=document.getElementById('paGPack_'+idx);
        var boxField=document.getElementById('paGBox_'+idx);

        if(!rackField||!qtyField)return;
        var rack=rackField.value.trim().toUpperCase();
        var qty=parseInt(qtyField.value)||0;
        var packing=packField?packField.value.trim():'';
        var box=boxField?boxField.value.trim().toUpperCase():'';
        var remaining=m.qty-(m.putawayedQty||0);

        if(!rack||qty<=0)return;

        // Qty validate — remaining se zyada nahi ho sakta
        if(qty>remaining){
            showToast(m.material+': Max '+remaining+' qty allowed','error');
            return;
        }

        // Description from material master
        var matMaster=DB.filter('material_master',function(mm){return mm.ean&&mm.ean===m.ean;});
        var desc=matMaster.length>0?(matMaster[0].description||matMaster[0].material):m.material;

        // Location master mein save
        DB.add('location_master',{date:today(),rack:rack,ean:m.ean,material:m.material,description:desc,quantity:qty,packing:packing,box:box,action:'PUTAWAY',user:APP.currentUser.name,dateTime:new Date().toISOString(),grnNo:g.grnNo,invoiceNo:g.invoiceNo,invoiceId:g.invoiceId});

        // Invoice materials mein putawayedQty update
        var newPutawayed=(m.putawayedQty||0)+qty;
        DB.update('invoice_materials',m.id,{putawayedQty:newPutawayed});

        count++;
        totalSaved+=qty;

        // Agar pura ho gaya to row hide karo visual feedback
        var row=document.getElementById('paGRow_'+idx);
        if(row&&newPutawayed>=m.qty){
            row.style.opacity='0.4';
            row.style.borderColor='var(--success)';
            rackField.disabled=true;qtyField.disabled=true;
            if(packField)packField.disabled=true;
            if(boxField)boxField.disabled=true;
        }
    });

    if(!count){showToast('Kam se kam ek material ka rack aur qty dalein','error');return;}

    // Check kya sab ho gaya
    var stillPending=getPendingPutawayMaterials().filter(function(p){return p.grnId===grnId;});

    if(stillPending.length>0){
        var remTotal=0;stillPending.forEach(function(p){remTotal+=p.totalQty-p.doneQty;});
        showToast(count+' items saved! '+remTotal+' qty pending — baad mein kar sakte ho','warning');
    } else {
        showToast(count+' items putaway complete! Sab ho gaya','success');
    }

    logAction('Putaway','GRN_SAVE',count+' items ('+totalSaved+' qty) putaway for '+g.grnNo);
    addNotif(count+' items putaway for '+g.grnNo+' ('+totalSaved+' qty) by '+APP.currentUser.name,'success');

    // Agar sab ho gaya to modal band karo
    if(stillPending.length===0){
        setTimeout(function(){closeModal();renderPutaway();},800);
    }
}

// --- EAN Scan Putaway Functions ---
function openScannerForPutawayEan(){
    APP.scanCallback=function(code){document.getElementById('putawayEanScan').value=code;lookupPutawayEan();};
    document.getElementById('scannerModal').style.display='flex';focusForBluetoothScanner();
}
function openScannerForPutawayRack(){
    APP.scanCallback=function(code){
        document.getElementById('paRackScan').value=code.toUpperCase();
        var sel=document.getElementById('paRackSelect');
        if(sel){for(var i=0;i<sel.options.length;i++){if(sel.options[i].value.toUpperCase()===code.toUpperCase()){sel.selectedIndex=i;break;}}}
        document.getElementById('paQty').focus();
    };
    document.getElementById('scannerModal').style.display='flex';focusForBluetoothScanner();
}
function lookupPutawayEan(){
    var input=document.getElementById('putawayEanScan');
    var val=input.value.trim().toUpperCase();
    if(!val){showToast('EAN scan ya type karein','error');return;}
    var mats=DB.get('material_master');
    var found=null;
    mats.forEach(function(m){if(!found&&m.ean&&m.ean.toUpperCase()===val)found=m;});
    var infoDiv=document.getElementById('putawayMatInfo');
    var msgDiv=document.getElementById('paLookupMsg');
    infoDiv.style.display='';
    if(found){
        document.getElementById('paMaterial').value=found.material||'';
        document.getElementById('paDescription').value=found.description||found.material||'';
        document.getElementById('paEan').value=found.ean||val;
        msgDiv.innerHTML='<div style="background:var(--accent-dim);padding:10px;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px"><i class="bx bx-check-circle" style="color:var(--accent);font-size:18px"></i><span style="color:var(--accent)">Material Master se mil gaya — <strong>'+esc(found.material)+'</strong></span></div>';
        document.getElementById('paRackScan').focus();
    } else {
        document.getElementById('paMaterial').value='';
        document.getElementById('paDescription').value='';
        document.getElementById('paEan').value=val;
        msgDiv.innerHTML='<div style="background:rgba(255,107,107,0.1);padding:10px;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px;border:1px solid rgba(255,107,107,0.3)"><i class="bx bx-error-circle" style="color:var(--danger);font-size:18px"></i><span style="color:var(--danger)">EAN <strong>'+esc(val)+'</strong> Material Master mein nahi mila. Manual enter karein.</span></div>';
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
    if(!material){showToast('Material name zaruri hai','error');document.getElementById('paMaterial').focus();return;}
    if(!ean){showToast('EAN zaruri hai','error');return;}
    if(!rack){showToast('Rack scan ya select karein','error');document.getElementById('paRackScan').focus();return;}
    if(qty<=0){showToast('Quantity 1 se zyada honi chahiye','error');document.getElementById('paQty').focus();return;}
    window._putawayItems.push({material:material,description:description,ean:ean,rack:rack,qty:qty,packing:packing,boxNo:boxNo,time:new Date().toISOString()});
    renderPutawayList();
    showToast('List mein add ho gaya!','success');
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
function clearPutawayList(){if(!confirm('Sab items delete karein?'))return;window._putawayItems=[];renderPutawayList();showToast('List clear','warning');}
function savePutawayScanList(){
    var items=window._putawayItems||[];
    if(!items.length){showToast('List mein koi item nahi','error');return;}
    var count=0;
    items.forEach(function(item){
        DB.add('location_master',{date:today(),rack:item.rack,ean:item.ean,material:item.material,description:item.description||item.material,quantity:item.qty,packing:item.packing,box:item.boxNo,action:'PUTAWAY',user:APP.currentUser.name,dateTime:new Date().toISOString(),grnNo:'EAN-SCAN',invoiceNo:'EAN-SCAN',invoiceId:''});
        count++;
    });
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
        var mats=DB.filter('invoice_materials',function(m){return m.invoiceId===g.invoiceId;});
        var totalQty=0,doneQty=0;mats.forEach(function(m){totalQty+=m.qty;doneQty+=(m.putawayedQty||0);});
        var pendingQty=totalQty-doneQty;
        var statusBadge=pendingQty>0?'<span class="badge badge-warning">'+pendingQty+' pending</span>':'<span class="badge badge-success">Done</span>';
        h+='<div class="inv-list-item" onclick="doPutaway(\''+g.id+'\')"><div class="ili-left"><span class="ili-invno">'+esc(g.grnNo)+'</span><span class="ili-info">'+esc(g.invoiceNo)+' | '+esc(g.vehicleNo)+' | Total: '+totalQty+' | Done: '+doneQty+'</span></div>'+statusBadge+'</div>';
    });
    if(!h)h='<div style="color:var(--text-muted);padding:20px;text-align:center">No results</div>';
    document.getElementById('putawayInvList').innerHTML=h;
}

// ==================== PIV ====================
function renderPIV(){
    var locs=DB.get('location_master').filter(function(l){return l.action==='PIV';}).reverse();
    var h='<div class="section-header"><h2><i class="bx bx-clipboard"></i> PIV (Physical Inventory Verification)</h2>';
    h+='<button class="btn btn-glass" onclick="showAddPIV()"><i class="bx bx-plus"></i> Add PIV</button></div>';

    // Quick stats
    var todayPIV=locs.filter(function(l){return l.date===today();});
    var todayQty=0;todayPIV.forEach(function(l){todayQty+=l.quantity;});
    h+='<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">';
    h+='<div style="flex:1;min-width:140px;padding:14px;background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);text-align:center"><div style="font-size:24px;font-weight:800;color:var(--accent)">'+todayPIV.length+'</div><div style="font-size:10px;color:var(--text-muted);letter-spacing:1px">TODAY ENTRIES</div></div>';
    h+='<div style="flex:1;min-width:140px;padding:14px;background:rgba(0,255,136,0.06);border:1px solid var(--success);border-radius:var(--radius-sm);text-align:center"><div style="font-size:24px;font-weight:800;color:var(--success)">'+todayQty+'</div><div style="font-size:10px;color:var(--text-muted);letter-spacing:1px">TODAY QTY</div></div>';
    h+='<div style="flex:1;min-width:140px;padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:24px;font-weight:800;color:var(--text-primary)">'+locs.length+'</div><div style="font-size:10px;color:var(--text-muted);letter-spacing:1px">TOTAL ENTRIES</div></div>';
    h+='</div>';

    // Search
    h+='<div class="search-box" style="margin-bottom:12px"><i class="bx bx-search"></i><input type="text" id="pivSearchInput" placeholder="Search rack, material, EAN..." oninput="filterPIVTable()"></div>';
    h+='<div id="pivTableWrap">';
    h+=buildPIVTable(locs);
    h+='</div>';
    setHtml(h);
}

function buildPIVTable(locs){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Date</th><th>Time</th><th>Rack</th><th>Material</th><th>Description</th><th>EAN</th><th>Qty</th><th>Packing</th><th>Box</th><th>Done By</th></tr></thead><tbody>';
    if(!locs.length)h+='<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:24px"><i class="bx bx-inbox" style="font-size:20px;display:block;margin-bottom:6px"></i>No PIV records</td></tr>';
    else locs.forEach(function(l,i){
        var timeStr=l.dateTime?new Date(l.dateTime).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'-';
        h+='<tr><td>'+(i+1)+'</td><td style="font-size:11px">'+esc(l.date)+'</td><td style="font-size:11px;color:var(--text-muted)">'+timeStr+'</td><td><span class="badge badge-accent">'+esc(l.rack)+'</span></td><td><strong>'+esc(l.material)+'</strong></td><td style="font-size:11px;color:var(--text-secondary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(l.description||'-')+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(l.ean||'-')+'</td><td><strong style="color:var(--accent)">'+l.quantity+'</strong></td><td>'+esc(l.packing||'-')+'</td><td>'+esc(l.box||'-')+'</td><td style="font-size:11px;color:var(--text-secondary)">'+esc(l.user||'-')+'</td></tr>';
    });
    h+='</tbody></table></div>';
    return h;
}

function filterPIVTable(){
    var q=document.getElementById('pivSearchInput').value.trim().toLowerCase();
    var locs=DB.get('location_master').filter(function(l){return l.action==='PIV';}).reverse();
    if(q){
        locs=locs.filter(function(l){
            return (l.rack||'').toLowerCase().indexOf(q)>-1||(l.material||'').toLowerCase().indexOf(q)>-1||(l.ean||'').toLowerCase().indexOf(q)>-1||(l.description||'').toLowerCase().indexOf(q)>-1||(l.user||'').toLowerCase().indexOf(q)>-1;
        });
    }
    document.getElementById('pivTableWrap').innerHTML=buildPIVTable(locs);
}

// --- Add PIV Modal ---
function showAddPIV(){
    var racks=DB.get('rack_master');
    var rOpts='<option value="">-- Scan ya Select --</option>';
    racks.forEach(function(r){rOpts+='<option value="'+esc(r.rack)+'">'+esc(r.rack)+'</option>';});

    var h='';

    // EAN Scan
    h+='<div class="form-group"><label>EAN Number <span class="req">*</span></label>';
    h+='<div style="display:flex;gap:6px"><div class="search-box" style="flex:1;max-width:100%"><i class="bx bx-barcode"></i><input type="text" id="pivEanScan" placeholder="Scan ya type EAN Number..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();lookupPIVEan();}" style="font-family:var(--font-display);font-size:14px;letter-spacing:1px"></div>';
    h+='<button class="btn btn-glass btn-sm" onclick="openScannerForPIVEan()" title="Camera Scan"><i class="bx bx-qr"></i></button>';
    h+='<button class="btn btn-glass btn-sm" onclick="lookupPIVEan()" title="Search"><i class="bx bx-search"></i></button></div></div>';

    // Auto-fill info (hidden initially)
    h+='<div id="pivMatInfo" style="display:none">';
    h+='<div id="pivLookupMsg"></div>';
    h+='<div class="form-row" style="margin-top:8px">';
    h+='<div class="form-group" style="flex:2"><label>Material <span class="req">*</span></label><input type="text" id="pivMaterial" class="form-input" placeholder="Auto-fill ya manual type karein"></div>';
    h+='<div class="form-group" style="flex:2"><label>Material Description</label><input type="text" id="pivDescription" class="form-input" placeholder="Auto-fill ya manual type karein"></div>';
    h+='</div>';
    h+='<div class="form-row"><div class="form-group"><label>EAN (Saved)</label><input type="text" id="pivEanSaved" class="form-input" readonly style="background:var(--bg-secondary);font-family:var(--font-display);font-size:11px;color:var(--text-muted)"></div></div>';
    h+='</div>';

    // Rack Scan
    h+='<div style="margin-top:14px" id="pivRackSection" '+(document.getElementById('pivEanScan')&&document.getElementById('pivEanScan').value?'':'')+'><div class="form-group"><label>Rack <span class="req">*</span></label>';
    h+='<div style="display:flex;gap:6px"><div class="search-box" style="flex:1;max-width:100%"><i class="bx bx-diamond"></i><input type="text" id="pivRackScan" placeholder="Scan ya type Rack..." style="text-transform:uppercase" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'pivQty\').focus();}"></div>';
    h+='<button class="btn btn-glass btn-sm" onclick="openScannerForPIVRack()" title="Scan Rack"><i class="bx bx-qr"></i></button></div>';
    h+='<select class="form-input" id="pivRackSelect" onchange="if(this.value){document.getElementById(\'pivRackScan\').value=this.value;document.getElementById(\'pivQty\').focus();}" style="margin-top:6px;font-size:12px">'+rOpts+'</select></div></div>';

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

    showModal('Add PIV Entry',h,'lg',
        '<button class="btn btn-glass" onclick="closeModal()">Cancel</button>'+
        '<button class="btn btn-glass" onclick="savePIV()"><i class="bx bx-check"></i> Save PIV</button>');

    // Focus on EAN
    setTimeout(function(){document.getElementById('pivEanScan').focus();},300);
}

// --- Scanner Callbacks ---
function openScannerForPIVEan(){
    APP.scanCallback=function(code){
        document.getElementById('pivEanScan').value=code;
        lookupPIVEan();
    };
    document.getElementById('scannerModal').style.display='flex';
    focusForBluetoothScanner();
}
function openScannerForPIVRack(){
    APP.scanCallback=function(code){
        document.getElementById('pivRackScan').value=code.toUpperCase();
        // Sync dropdown
        var sel=document.getElementById('pivRackSelect');
        if(sel){for(var i=0;i<sel.options.length;i++){if(sel.options[i].value.toUpperCase()===code.toUpperCase()){sel.selectedIndex=i;break;}}}
        document.getElementById('pivQty').focus();
    };
    document.getElementById('scannerModal').style.display='flex';
    focusForBluetoothScanner();
}

// --- EAN Lookup from Material Master ---
function lookupPIVEan(){
    var val=document.getElementById('pivEanScan').value.trim().toUpperCase();
    if(!val){showToast('EAN scan ya type karein','error');return;}

    var mats=DB.get('material_master');
    var found=null;
    mats.forEach(function(m){
        if(!found&&m.ean&&m.ean.toUpperCase()===val)found=m;
    });

    var infoDiv=document.getElementById('pivMatInfo');
    var msgDiv=document.getElementById('pivLookupMsg');
    infoDiv.style.display='';

    if(found){
        document.getElementById('pivMaterial').value=found.material||'';
        document.getElementById('pivDescription').value=found.description||found.material||'';
        document.getElementById('pivEanSaved').value=found.ean||val;
        msgDiv.innerHTML='<div style="background:var(--accent-dim);padding:10px;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px"><i class="bx bx-check-circle" style="color:var(--accent);font-size:18px"></i><span style="color:var(--accent)">Material Master se mil gaya — <strong>'+esc(found.material)+'</strong>. Edit kar sakte ho.</span></div>';
        document.getElementById('pivRackScan').focus();
    } else {
        document.getElementById('pivMaterial').value='';
        document.getElementById('pivDescription').value='';
        document.getElementById('pivEanSaved').value=val;
        msgDiv.innerHTML='<div style="background:rgba(255,107,107,0.1);padding:10px;border-radius:var(--radius-sm);margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px;border:1px solid rgba(255,107,107,0.3)"><i class="bx bx-error-circle" style="color:var(--danger);font-size:18px"></i><span style="color:var(--danger)">EAN <strong>'+esc(val)+'</strong> Material Master mein nahi mila. Manual enter karein.</span></div>';
        document.getElementById('pivMaterial').focus();
    }
}

// --- Save PIV ---
function savePIV(){
    var ean=document.getElementById('pivEanSaved')?document.getElementById('pivEanSaved').value.trim():document.getElementById('pivEanScan').value.trim().toUpperCase();
    var material=document.getElementById('pivMaterial').value.trim();
    var description=document.getElementById('pivDescription').value.trim();
    var rack=document.getElementById('pivRackScan').value.trim().toUpperCase();
    var qty=parseInt(document.getElementById('pivQty').value)||0;
    var packing=document.getElementById('pivPack').value.trim();
    var box=document.getElementById('pivBox').value.trim().toUpperCase();

    if(!ean){showToast('EAN scan ya type karein','error');document.getElementById('pivEanScan').focus();return;}
    if(!material){showToast('Material name zaruri hai','error');document.getElementById('pivMaterial').focus();return;}
    if(!rack){showToast('Rack scan ya select karein','error');document.getElementById('pivRackScan').focus();return;}
    if(qty<=0){showToast('Quantity 1 se zyada honi chahiye','error');document.getElementById('pivQty').focus();return;}

    DB.add('location_master',{
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
        dateTime:new Date().toISOString()
    });

    logAction('PIV','ADD',material+' qty:'+qty+' at '+rack+' EAN:'+ean);
    showToast('PIV entry saved!','success');
    closeModal();
    renderPIV();
}

// ==================== LOCATION MASTER ====================
function renderLocationMaster(){
    var locs=DB.get('location_master').reverse();
    var pg=paginate(locs,APP.locPage,APP.locPerPage||50);
    var h='<div class="section-header"><h2><i class="bx bx-map-pin"></i> Location Master ('+locs.length+')</h2>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
    h+='<button class="btn btn-glass" onclick="showLocBulkUpload()"><i class="bx bx-upload"></i> Bulk Upload</button>';
    h+='<button class="btn btn-glass" onclick="downloadLocTemplate()"><i class="bx bx-file"></i> Template</button>';
    h+='<button class="btn btn-glass" onclick="exportTableExcel(\'location_master\',\'Location_Master\')"><i class="bx bx-download"></i> Excel</button>';
    h+='<button class="btn btn-glass" onclick="showLocReport()"><i class="bx bx-bar-chart"></i> Report</button>';
    h+='</div></div>';

    // Quick Stats
    var putawayC=0,pivC=0,eanscanC=0,otherC=0,totalQty=0;
    locs.forEach(function(l){totalQty+=l.quantity;if(l.action==='PUTAWAY')putawayC++;else if(l.action==='PIV')pivC++;else if(l.action==='EAN-SCAN')eanscanC++;else otherC++;});
    h+='<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">';
    h+='<div style="flex:1;min-width:100px;padding:10px;background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);text-align:center"><div style="font-size:18px;font-weight:800;color:var(--accent)">'+locs.length+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">TOTAL ROWS</div></div>';
    h+='<div style="flex:1;min-width:100px;padding:10px;background:rgba(0,255,136,0.06);border:1px solid var(--success);border-radius:var(--radius-sm);text-align:center"><div style="font-size:18px;font-weight:800;color:var(--success)">'+totalQty+'</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:1px">TOTAL QTY</div></div>';
    h+='<div style="flex:1;min-width:80px;padding:10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:16px;font-weight:700;color:var(--accent)">'+putawayC+'</div><div style="font-size:9px;color:var(--text-muted)">PUTAWAY</div></div>';
    h+='<div style="flex:1;min-width:80px;padding:10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:16px;font-weight:700;color:var(--info)">'+pivC+'</div><div style="font-size:9px;color:var(--text-muted)">PIV</div></div>';
    h+='<div style="flex:1;min-width:80px;padding:10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center"><div style="font-size:16px;font-weight:700;color:var(--accent2)">'+eanscanC+'</div><div style="font-size:9px;color:var(--text-muted)">EAN SCAN</div></div>';
    h+='</div>';

    // Search + Filter
    h+='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">';
    h+='<div class="search-box" style="flex:1;min-width:200px"><i class="bx bx-search"></i><input type="text" id="locSearch" placeholder="Search rack, material, EAN, user..." oninput="searchLoc()"></div>';
    h+='<select class="form-input" id="locActionFilter" onchange="searchLoc()" style="width:auto;min-width:130px;font-size:12px"><option value="">All Actions</option><option value="PUTAWAY">PUTAWAY</option><option value="PIV">PIV</option><option value="EAN-SCAN">EAN-SCAN</option></select>';
    h+='<select class="form-input" id="locPerPageSel" onchange="APP.locPerPage=parseInt(this.value)||50;APP.locPage=1;renderLocationMaster();" style="width:auto;min-width:100px;font-size:12px"><option value="50">50/Page</option><option value="100">100/Page</option><option value="200">200/Page</option><option value="500">500/Page</option></select>';
    h+='</div>';

    h+='<div id="locTable">'+buildLocTable(pg.items)+'</div>';
    h+=renderPag(APP.locPage,pg.pages,'goLocPage');
    setHtml(h);
}

function buildLocTable(locs){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>#</th><th>Date</th><th>Rack</th><th>Material</th><th>Description</th><th>EAN</th><th>Qty</th><th>Action</th><th>Packing</th><th>Box</th><th>User</th><th></th></tr></thead><tbody>';
    if(!locs.length)h+='<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:20px"><i class="bx bx-inbox" style="font-size:20px;display:block;margin-bottom:6px"></i>No data</td></tr>';
    else {
        var startIdx=(APP.locPage-1)*(APP.locPerPage||50);
        locs.forEach(function(l,i){
            var actCls=l.action==='PUTAWAY'?'badge-accent':(l.action==='PIV'?'badge-info':(l.action==='EAN-SCAN'?'badge-success':'badge-warning'));
            h+='<tr><td>'+(startIdx+i+1)+'</td><td style="font-size:11px">'+esc(l.date)+'</td><td><span class="badge badge-accent">'+esc(l.rack)+'</span></td><td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><strong>'+esc(l.material)+'</strong></td><td style="font-size:10px;color:var(--text-secondary);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(l.description||'-')+'</td><td style="font-family:var(--font-display);font-size:9px">'+esc(l.ean||'-')+'</td><td><strong style="color:var(--accent)">'+l.quantity+'</strong></td><td><span class="badge '+actCls+'">'+esc(l.action)+'</span></td><td>'+esc(l.packing||'-')+'</td><td>'+esc(l.box||'-')+'</td><td style="font-size:10px;color:var(--text-secondary)">'+esc(l.user||'-')+'</td><td><button class="btn btn-danger btn-sm" onclick="deleteLocRow(\''+l.id+'\')" title="Delete"><i class="bx bx-trash"></i></button></td></tr>';
        });
    }
    h+='</tbody></table></div>';return h;
}

function goLocPage(p){APP.locPage=p;renderLocationMaster();}
function searchLoc(){
    var q=document.getElementById('locSearch').value.trim().toLowerCase();
    var actF=document.getElementById('locActionFilter').value;
    var locs=DB.get('location_master').reverse();
    if(q)locs=locs.filter(function(l){return(l.rack||'').toLowerCase().indexOf(q)>-1||(l.material||'').toLowerCase().indexOf(q)>-1||(l.ean||'').toLowerCase().indexOf(q)>-1||(l.description||'').toLowerCase().indexOf(q)>-1||(l.user||'').toLowerCase().indexOf(q)>-1;});
    if(actF)locs=locs.filter(function(l){return l.action===actF;});
    document.getElementById('locTable').innerHTML=buildLocTable(locs);
}

// --- Delete Single Row ---
function deleteLocRow(id){
    if(!confirm('Yeh row delete karein?'))return;
    DB.delete('location_master',id);
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
    showToast('Template downloaded! Is format mein data bharein','success');
}

// --- Bulk Upload ---
function showLocBulkUpload(){
    var h='<div style="background:var(--accent-dim);padding:12px;border-radius:var(--radius-sm);margin-bottom:14px;font-size:12px;color:var(--accent);border:1px solid var(--accent)"><i class="bx bx-info-circle" style="font-size:16px"></i> <strong>25000+ rows</strong> support hai. Upload mein thoda time lagega — please wait.</div>';
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
    if(!fi||!fi.files[0]){showToast('File select karein','error');return;}

    var progDiv=document.getElementById('locBulkProgress');
    progDiv.style.display='';
    progDiv.innerHTML='<div style="background:var(--bg-secondary);padding:10px;border-radius:var(--radius-sm);text-align:center;color:var(--accent)"><i class="bx bx-loader-circle bx-spin" style="font-size:20px;display:block;margin-bottom:6px"></i>Processing... please wait</div>';

    // Use setTimeout to allow UI to update
    setTimeout(function(){
        try{
            var reader=new FileReader();
            reader.onload=function(e){
                try{
                    var t0=performance.now();
                    var wb=XLSX.read(e.target.result,{type:'array'});
                    var ws=wb.Sheets[wb.SheetNames[0]];
                    var data=XLSX.utils.sheet_to_json(ws,{header:1,raw:false});

                    if(!data||data.length<2){showToast('File mein data nahi hai (kam se kam header + 1 row)','error');progDiv.innerHTML='';return;}

                    // Detect header row
                    var headerRow=data[0].map(function(h){return String(h||'').trim().toLowerCase();});
                    var colMap={date:-1,rack:-1,material:-1,ean:-1,qty:-1,action:-1,packing:-1,box:-1};
                    var keys=['date','rack','material','ean','qty','action','packing','box'];
                    var aliases={date:['date','dt'],rack:['rack','location','rack_no'],material:['material','material_name','item'],ean:['ean','ean_no','barcode','upc'],qty:['qty','quantity','quant'],action:['action','type','activity'],packing:['packing','pack','pack_type'],box:['box','box_no','boxno']};
                    keys.forEach(function(k){
                        aliases[k].forEach(function(a){
                            for(var ci=0;ci<headerRow.length;ci++){
                                if(headerRow[ci]===a&&colMap[k]===-1){colMap[k]=ci;break;}
                            }
                        });
                    });

                    // Validate required columns
                    var missing=[];
                    if(colMap.rack===-1)missing.push('Rack');
                    if(colMap.material===-1)missing.push('Material');
                    if(colMap.qty===-1)missing.push('Qty');
                    if(missing.length){showToast('Missing columns: '+missing.join(', '),'error');progDiv.innerHTML='';return;}

                    // Parse date helper
                    function parseDate(val){
                        if(!val)return today();
                        var s=String(val).trim();
                        // YYYY-MM-DD
                        if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
                        // DD/MM/YYYY
                        var parts=s.split(/[\/\-\.]/);
                        if(parts.length===3){
                            if(parts[0].length===4)return parts[0]+'-'+parts[1].padStart(2,'0')+'-'+parts[2].padStart(2,'0');
                            if(parts[2].length===4)return parts[2]+'-'+parts[1].padStart(2,'0')+'-'+parts[0].padStart(2,'0');
                        }
                        return today();
                    }

                    // Process rows
                    var startRow=1; // Skip header
                    var added=0,skipped=0,errorRows=[];
                    var userName=APP.currentUser?APP.currentUser.name:'Bulk Upload';
                    var userId=APP.currentUser?APP.currentUser.id:'';

                    for(var k=startRow;k<data.length;k++){
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

                        if(!rack||!material||qty<=0){skipped++;errorRows.push(k+1);continue;}

                        // Get description from material master if EAN exists
                        var desc=material;
                        if(ean){
                            var mm=DB.filter('material_master',function(m){return m.ean&&m.ean.toUpperCase()===ean.toUpperCase();});
                            if(mm.length>0)desc=mm[0].description||mm[0].material;
                        }

                        DB.add('location_master',{
                            date:date,
                            rack:rack,
                            ean:ean,
                            material:material,
                            description:desc,
                            quantity:qty,
                            packing:packing,
                            box:box,
                            action:action||'BULK',
                            user:userName,
                            userId:userId,
                            dateTime:new Date().toISOString()
                        });
                        added++;
                    }

                    var t1=performance.now();
                    var timeSec=((t1-t0)/1000).toFixed(1);

                    var resHtml='<div style="background:var(--bg-secondary);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border)">';
                    resHtml+='<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">';
                    resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--success)">'+added+'</div><div style="font-size:9px;color:var(--text-muted)">ADDED</div></div>';
                    if(skipped>0)resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--danger)">'+skipped+'</div><div style="font-size:9px;color:var(--text-muted)">SKIPPED</div></div>';
                    resHtml+='<div style="text-align:center;flex:1;min-width:80px"><div style="font-size:24px;font-weight:800;color:var(--accent)">'+timeSec+'s</div><div style="font-size:9px;color:var(--text-muted)">TIME</div></div>';
                    resHtml+='</div>';
                    if(errorRows.length>0&&errorRows.length<=20){
                        resHtml+='<div style="font-size:10px;color:var(--danger);margin-bottom:8px"><i class="bx bx-error-circle"></i> Skipped rows: '+errorRows.join(', ')+'</div>';
                    } else if(errorRows.length>20){
                        resHtml+='<div style="font-size:10px;color:var(--danger);margin-bottom:8px"><i class="bx bx-error-circle"></i> Skipped rows: '+errorRows.length+' (first 20: '+errorRows.slice(0,20).join(', ')+')</div>';
                    }
                    resHtml+='<div style="font-size:11px;color:var(--text-muted)"><i class="bx bx-check-circle" style="color:var(--success)"></i> Upload complete!</div>';
                    resHtml+='</div>';
                    progDiv.innerHTML=resHtml;

                    logAction('Location Master','BULK_UPLOAD',added+' rows added, '+skipped+' skipped in '+timeSec+'s');
                    showToast(added+' rows uploaded! ('+timeSec+'s)','success');

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
function showLocReport(){
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
function downloadLocReportPDF(){
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
function renderRackMaster(){
    var bins=DB.get('rack_master');
    var locs=DB.get('location_master');

    var h='<div class="section-header"><h2><i class="bx bx-grid-alt"></i> Bin Master ('+bins.length+')</h2>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
    h+='<button class="btn btn-glass" onclick="showAddRack()"><i class="bx bx-plus"></i> Add Bin</button>';
    h+='<button class="btn btn-glass" onclick="showBulkBinUpload()"><i class="bx bx-upload"></i> Bulk Upload</button>';
    h+='<button class="btn btn-glass" onclick="downloadBinTemplate()"><i class="bx bx-file"></i> Template</button>';
    h+='</div></div>';

    // Quick Stats
    var occMap={};var totalMats=0;
    locs.forEach(function(l){
        if(l.quantity>0){
            if(!occMap[l.rack])occMap[l.rack]={mats:0,qty:0};
            occMap[l.rack].mats++;occMap[l.rack].qty+=l.quantity;totalMats++;
        }
    });
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
        var occ=occMap[b.rack];
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
            var occ=occMap[b.rack];
            h+='<tr style="cursor:pointer" onclick="showBinMaterials(\''+esc(b.rack).replace(/'/g,"\\'")+'\')"><td>'+(startIdx+i+1)+'</td><td><strong>'+esc(b.rack)+'</strong></td><td><span class="badge '+(occ?'badge-success':'badge-danger')+'">'+(occ?'Occupied':'Empty')+'</span></td><td>'+(occ?occ.mats:0)+'</td><td>'+(occ?occ.qty:0)+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" onclick="event.stopPropagation();showBinMaterials(\''+esc(b.rack).replace(/'/g,"\\'")+'\')"><i class="bx bx-eye"></i> View</button><button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteRack(\''+b.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';
        });
    }
    h+='</tbody></table></div>';
    return h;
}

function goBinPage(p){APP.binPage=p;renderRackMaster();}

function filterBinGrid(){
    var q=(document.getElementById('binSearchInput').value||'').trim().toLowerCase();
    var statusF=document.getElementById('binStatusFilter').value;
    var bins=DB.get('rack_master');
    var locs=DB.get('location_master');
    var occMap={};
    locs.forEach(function(l){
        if(l.quantity>0){if(!occMap[l.rack])occMap[l.rack]={mats:0,qty:0};occMap[l.rack].mats++;occMap[l.rack].qty+=l.quantity;}
    });
    if(q)bins=bins.filter(function(b){return(b.rack||'').toLowerCase().indexOf(q)>-1;});
    if(statusF==='occupied')bins=bins.filter(function(b){return occMap[b.rack];});
    else if(statusF==='empty')bins=bins.filter(function(b){return !occMap[b.rack];});

    var h='<div class="rack-grid">';
    bins.forEach(function(b){
        var occ=occMap[b.rack];
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
function showBinMaterials(binName){
    var locs=DB.filter('location_master',function(l){return l.rack===binName;});
    var totalQty=0;locs.forEach(function(l){totalQty+=l.quantity;});
    var h='<div style="text-align:center;margin-bottom:14px"><div style="font-size:22px;font-weight:800;color:var(--accent);font-family:var(--font-display);letter-spacing:2px">'+esc(binName)+'</div><div style="font-size:11px;color:var(--text-muted)">'+locs.length+' materials | '+totalQty+' total qty</div></div>';
    if(!locs.length){
        h+='<div style="text-align:center;color:var(--text-muted);padding:30px"><i class="bx bx-box" style="font-size:32px;display:block;margin-bottom:10px"></i>This bin is empty</div>';
    } else {
        h+='<div class="table-wrapper" style="max-height:400px;overflow-y:auto"><table class="data-table"><thead><tr><th>#</th><th>Date</th><th>Material</th><th>Description</th><th>EAN</th><th>Qty</th><th>Action</th><th>Packing</th><th>Box</th><th>User</th></tr></thead><tbody>';
        locs.forEach(function(l,i){
            var actCls=l.action==='PUTAWAY'?'badge-accent':(l.action==='PIV'?'badge-info':(l.action==='EAN-SCAN'?'badge-success':'badge-warning'));
            h+='<tr><td>'+(i+1)+'</td><td style="font-size:11px">'+esc(l.date)+'</td><td><strong>'+esc(l.material)+'</strong></td><td style="font-size:10px;color:var(--text-secondary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(l.description||'-')+'</td><td style="font-family:var(--font-display);font-size:9px">'+esc(l.ean||'-')+'</td><td><strong style="color:var(--accent)">'+l.quantity+'</strong></td><td><span class="badge '+actCls+'">'+esc(l.action)+'</span></td><td>'+esc(l.packing||'-')+'</td><td>'+esc(l.box||'-')+'</td><td style="font-size:10px">'+esc(l.user||'-')+'</td></tr>';
        });
        h+='</tbody></table></div>';
    }
    h+='<div class="form-actions" style="margin-top:14px"><button class="btn btn-glass" onclick="closeModal()">Close</button></div>';
    showModal('Bin Details — '+binName,h,'xl','');
}

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
    showToast('Template downloaded! Sirf BIN column mein data bharein','success');
}

// --- Bulk Upload ---
function showBulkBinUpload(){
    var h='<div style="background:var(--accent-dim);padding:12px;border-radius:var(--radius-sm);margin-bottom:14px;font-size:12px;color:var(--accent);border:1px solid var(--accent)"><i class="bx bx-info-circle" style="font-size:16px"></i> <strong>15000+ bins</strong> ek saath upload kar sakte hain. Hang nahi hoga.</div>';
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
    if(!fi||!fi.files[0]){showToast('File select karein','error');return;}

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

                    if(!data||data.length<1){showToast('File empty hai','error');progDiv.innerHTML='';return;}

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

                    for(var k=startRow;k<data.length;k++){
                        var r=data[k];
                        if(!r)continue;
                        var binName=String(r[colIdx]||'').trim().toUpperCase();
                        if(!binName){skipped++;continue;}
                        if(existingBins[binName]){duplicate++;continue;}
                        DB.add('rack_master',{rack:binName});
                        existingBins[binName]=true; // Add to set so no dupes in same upload
                        added++;
                    }

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
function renderMaterialMaster(){
    var mats=DB.get('material_master');var pg=paginate(mats,APP.matPage,APP.matPerPage);
    var h='<div class="section-header"><h2><i class="bx bx-label"></i> Material Master ('+mats.length+')</h2><div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportTableExcel(\'material_master\',\'Material_Master\')"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="showAddMaterial()"><i class="bx bx-plus"></i> Add</button></div></div>';
    h+='<div class="search-box"><i class="bx bx-search"></i><input type="text" id="matSearch" placeholder="Search material, EAN..." oninput="searchMat()"></div>';
    h+='<div id="matTable">'+buildMatTable(pg.items)+'</div>';
    h+=renderPag(APP.matPage,pg.pages,'goMatPage');
    setHtml(h);
}
function buildMatTable(mats){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>Description</th><th>EAN</th><th>Division</th><th>Brand</th><th>Actions</th></tr></thead><tbody>';
    if(!mats.length)h+='<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No data</td></tr>';
    else mats.forEach(function(m){h+='<tr><td><strong>'+esc(m.material)+'</strong></td><td>'+esc(m.description)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+esc(m.division)+'</td><td>'+esc(m.brand)+'</td><td><div class="table-actions"><button class="btn btn-glass btn-sm" onclick="editMaterial(\''+m.id+'\')"><i class="bx bx-edit"></i></button><button class="btn btn-danger btn-sm" onclick="deleteMaterial(\''+m.id+'\')"><i class="bx bx-trash"></i></button></div></td></tr>';});
    h+='</tbody></table></div>';return h;
}
function goMatPage(p){APP.matPage=p;renderMaterialMaster();}
function searchMat(){
    var q=document.getElementById('matSearch').value.trim().toLowerCase();
    var mats=DB.get('material_master');
    if(q)mats=mats.filter(function(m){return(m.material||'').toLowerCase().indexOf(q)>-1||(m.ean||'').toLowerCase().indexOf(q)>-1;});
    document.getElementById('matTable').innerHTML=buildMatTable(mats);
}
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
function editMaterial(id){
    var m=DB.find('material_master',id);if(!m)return;
    var h='<div class="form-row"><div class="form-group"><label>Material Name</label><input type="text" id="emName" class="form-input" value="'+esc(m.material)+'"></div><div class="form-group"><label>EAN</label><input type="text" id="emEan" class="form-input" value="'+esc(m.ean)+'"></div></div>';
    h+='<div class="form-row"><div class="form-group"><label>Description</label><input type="text" id="emDesc" class="form-input" value="'+esc(m.description||'')+'"></div><div class="form-group"><label>Division</label><input type="text" id="emDiv" class="form-input" value="'+esc(m.division||'')+'"></div><div class="form-group"><label>Brand</label><input type="text" id="emBrand" class="form-input" value="'+esc(m.brand||'')+'"></div></div>';
    showModal('Edit Material',h,'','<button class="btn btn-glass" onclick="closeModal()">Cancel</button><button class="btn btn-glass" onclick="updateMaterial(\''+id+'\')"><i class="bx bx-check"></i> Update</button>');
}
function updateMaterial(id){
    DB.update('material_master',id,{material:document.getElementById('emName').value.trim(),ean:document.getElementById('emEan').value.trim(),description:document.getElementById('emDesc').value.trim(),division:document.getElementById('emDiv').value.trim(),brand:document.getElementById('emBrand').value.trim()});
    logAction('Material','UPDATE','Material '+id+' updated');showToast('Material updated!','success');closeModal();renderMaterialMaster();
}
function deleteMaterial(id){if(!confirm('Delete?'))return;DB.remove('material_master',id);showToast('Deleted','success');renderMaterialMaster();}

// ==================== PICKING ====================
function renderPicking(sub){
    switch(sub){
        case 'obd-upload':renderOBDUpload();break;
        case 'picking-assign':renderPickingAssign();break;
        case 'start-picking':renderStartPicking();break;
        case 'picking-done':renderPickingDone();break;
        default:renderOBDUpload();
    }
}

// --- OBD Upload ---
function renderOBDUpload(){
    var obds=DB.get('obd_data').reverse();
    var h='<div class="section-header"><h2><i class="bx bx-upload"></i> OBD Upload</h2></div>';
    h+='<div class="card"><div class="card-title"><i class="bx bx-file"></i> Upload OBD (Bulk Excel)</div>';
    h+='<label class="btn btn-glass" style="cursor:pointer;margin-bottom:12px"><i class="bx bx-upload"></i> Choose OBD File<input type="file" id="obdFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="document.getElementById(\'obdFName\').innerText=this.files[0].name"></label>';
    h+='<div id="obdFName" style="font-size:11px;color:var(--text-muted);margin-bottom:8px">No file chosen</div>';
    h+='<button class="btn btn-glass" onclick="processOBDUpload()"><i class="bx bx-check-double"></i> Upload OBDs</button>';
    h+='<div style="background:var(--bg-secondary);padding:10px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted);border:1px dashed var(--warning);margin-top:10px"><strong style="color:var(--warning)">Excel Format:</strong><br>OBD No | Material | EAN | Qty | Customer</div>';
    h+='</div>';
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-list-ul"></i> Uploaded OBDs ('+obds.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Materials</th><th>Total Qty</th><th>Status</th></tr></thead><tbody>';
    if(!obds.length)h+='<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No OBDs</td></tr>';
    else obds.forEach(function(o){
        var totalQty=0;(o.materials||[]).forEach(function(m){totalQty+=m.qty;});
        h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(o.obdNo)+'</td><td><span class="badge badge-info">'+(o.materials||[]).length+'</span></td><td><strong>'+totalQty+'</strong></td><td><span class="badge '+(o.status==='Picking Done'?'badge-success':(o.status==='Assigned'?'badge-warning':'badge-accent'))+'">'+esc(o.status||'Pending')+'</span></td></tr>';
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
            showToast(count+' OBDs uploaded!','success');
            renderOBDUpload();
        }catch(err){showToast('Excel error: '+err.message,'error');}
    };
    reader.readAsArrayBuffer(fi.files[0]);
}

// --- Picking Assign ---
function renderPickingAssign(){
    var obds=DB.get('obd_data').filter(function(o){return o.status==='Pending';});
    var assigned=DB.filter('picking_assignments',function(a){return a.status==='Assigned';});
    var h='<div class="section-header"><h2><i class="bx bx-user-plus"></i> Picking Assign</h2></div>';

    // Unassigned OBDs
    h+='<div class="card"><div class="card-title"><i class="bx bx-list-ul"></i> Unassigned OBDs ('+obds.length+')</div>';
    if(!obds.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">All OBDs assigned</div>';
    else{
        h+='<div class="form-group" style="margin-bottom:12px"><label>Select User <span class="req">*</span></label><select id="pickAssignUser" class="form-input" style="max-width:300px"><option value="">-- Select User --</option>';
        var users=DB.get('users').filter(function(u){return u.role==='Picker'||u.role==='Manager';});
        users.forEach(function(u){h+='<option value="'+u.id+'" data-name="'+esc(u.name)+'">'+esc(u.name)+' ('+esc(u.role)+')</option>';});
        h+='</select></div>';
        h+='<div class="chk-list" id="obdChkList">';
        obds.forEach(function(o){
            var totalQ=0;(o.materials||[]).forEach(function(m){totalQ+=m.qty;});
            h+='<label class="chk-list-item"><input type="checkbox" class="obd-chk" value="'+o.id+'" data-no="'+esc(o.obdNo)+'"><span><strong style="color:var(--accent);font-family:var(--font-display);font-size:11px">'+esc(o.obdNo)+'</strong> — '+(o.materials||[]).length+' mats, '+totalQ+' qty</span></label>';
        });
        h+='</div>';
        h+='<div class="form-actions"><button class="btn btn-glass" onclick="doPickingAssign()"><i class="bx bx-check-double"></i> Assign Selected</button></div>';
    }
    h+='</div>';

    // Assigned
    if(assigned.length){
        h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-user-check"></i> Assigned ('+assigned.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Assigned To</th><th>Materials</th><th>Actions</th></tr></thead><tbody>';
        assigned.forEach(function(a){
            var obd=DB.find('obd_data',a.obdId);
            h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(obd?obd.obdNo:'-')+'</td><td>'+esc(a.assignedToName)+'</td><td><span class="badge badge-info">'+(obd?obd.materials.length:0)+'</span></td><td><button class="btn btn-danger btn-sm" onclick="unassignPicking(\''+a.id+'\')"><i class="bx bx-user-minus"></i> Unassign</button></td></tr>';
        });
        h+='</tbody></table></div></div>';
    }
    setHtml(h);
}
function doPickingAssign(){
    var userSel=document.getElementById('pickAssignUser');if(!userSel.value){showToast('Select a user','error');return;}
    var userName=userSel.options[userSel.selectedIndex].getAttribute('data-name');
    var checks=document.querySelectorAll('.obd-chk:checked');
    if(!checks.length){showToast('Select at least one OBD','error');return;}
    var count=0;
    checks.forEach(function(chk){
        var obdId=chk.value,obdNo=chk.getAttribute('data-no');
        DB.add('picking_assignments',{obdId:obdId,obdNo:obdNo,assignedTo:userSel.value,assignedToName:userName,status:'Assigned',assignedAt:new Date().toISOString()});
        DB.update('obd_data',obdId,{status:'Assigned'});
        count++;
    });
    logAction('Picking','ASSIGN',count+' OBDs assigned to '+userName);
    showToast(count+' OBDs assigned to '+userName,'success');
    renderPickingAssign();
}
function unassignPicking(assignId){
    if(!confirm('Unassign?'))return;
    var a=DB.find('picking_assignments',assignId);if(!a)return;
    DB.update('picking_assignments',assignId,{status:'Unassigned'});
    DB.update('obd_data',a.obdId,{status:'Pending'});
    logAction('Picking','UNASSIGN','OBD '+a.obdNo+' unassigned');
    showToast('Unassigned','success');renderPickingAssign();
}

// --- Start Picking ---
function renderStartPicking(){
    if(!APP.currentUser)return;
    var myAssign=DB.filter('picking_assignments',function(a){return a.assignedTo===APP.currentUser.id&&a.status==='Assigned';});
    var h='<div class="section-header"><h2><i class="bx bx-box"></i> My Picking</h2></div>';
    if(!myAssign.length){h+='<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No OBDs assigned to you</p></div></div>';setHtml(h);return;}

    // Show OBD list
    h+='<div class="card"><div class="card-title"><i class="bx bx-list-ul"></i> Your OBDs ('+myAssign.length+')</div>';
    myAssign.forEach(function(a){
        var obd=DB.find('obd_data',a.obdId);if(!obd)return;
        var totalQ=0;(obd.materials||[]).forEach(function(m){totalQ+=m.qty;});
        h+='<div class="inv-list-item" onclick="openPickingOBD(\''+a.obdId+'\')"><div class="ili-left"><span class="ili-invno">'+esc(obd.obdNo)+'</span><span class="ili-info">'+(obd.materials||[]).length+' materials | '+totalQ+' total qty</span></div><span class="badge badge-warning">Pick</span></div>';
    });
    h+='</div>';
    setHtml(h);
}

function openPickingOBD(obdId){
    var obd=DB.find('obd_data',obdId);if(!obd)return;
    window._pickData={obdId:obdId,obdNo:obd.obdNo,materials:JSON.parse(JSON.stringify(obd.materials)),pickedLocations:{}};

    var h='<div style="margin-bottom:12px"><strong style="color:var(--accent);font-family:var(--font-display)">'+esc(obd.obdNo)+'</strong></div>';
    h+='<div class="card-title"><i class="bx bx-package"></i> Materials — Click to see locations</div>';
    h+='<div class="mat-cards-grid" id="pickMatCards">';
    obd.materials.forEach(function(m,idx){
        var picked=(window._pickData.pickedLocations[m.material]||[]).length>0;
        h+='<div class="mat-card '+(picked?'picked':'')+'" onclick="showPickLocations('+idx+')">';
        h+='<div class="mc-name"><i class="bx bx-box" style="color:var(--accent)"></i> '+esc(m.material)+'</div>';
        h+='<div class="mc-ean">'+esc(m.ean)+'</div>';
        h+='<div class="mc-qty">Need: <strong>'+m.qty+'</strong></div>';
        h+='<div class="mc-status">'+(picked?'<span class="status-dot green"></span> Picked':'<span class="status-dot yellow"></span> Pending')+'</div>';
        h+='</div>';
    });
    h+='</div>';
    h+='<div class="form-actions"><button class="btn btn-glass" onclick="submitPicking()"><i class="bx bx-check-double"></i> Submit Picking</button></div>';
    showModal('Picking — '+obd.obdNo,h,'xl','<button class="btn btn-glass" onclick="closeModal()">Cancel</button>');
}

function showPickLocations(matIdx){
    var pd=window._pickData;if(!pd)return;
    var mat=pd.materials[matIdx];
    // Find locations for this material
    var locs=DB.filter('location_master',function(l){return l.ean===mat.ean&&l.quantity>0;});
    if(!locs.length){
        // Ask admin to assign location
        var h='<div style="text-align:center;padding:20px"><i class="bx bx-map-pin" style="font-size:40px;color:var(--warning);opacity:.5"></i><p style="color:var(--text-muted);margin:10px 0">No stock found for <strong>'+esc(mat.material)+'</strong> at any location.</p>';
        h+='<div class="form-group"><label>Reason</label><textarea id="pickNoLocReason" class="form-input" placeholder="Why material not found?"></textarea></div>';
        h+='<div class="form-group"><label>Request Alternative Location</label><input type="text" id="pickAltLoc" class="form-input" placeholder="RACK-XXX"></div>';
        h+='</div>';
        showModal('No Location Found',h,'sm',
            '<button class="btn btn-glass" onclick="closeModal();openPickingOBD(\''+pd.obdId+'\')">Back</button>'+
            '<button class="btn btn-glass" onclick="requestAdminLocation('+matIdx+')"><i class="bx bx-send"></i> Request Admin</button>');
        return;
    }
    // Show location cards
    var totalPicked=0;
    (pd.pickedLocations[mat.material]||[]).forEach(function(p){totalPicked+=p.qty;});
    var remaining=mat.qty-totalPicked;

    var h='<div style="margin-bottom:12px"><strong>'+esc(mat.material)+'</strong> | Need: <span style="color:var(--accent)">'+mat.qty+'</span> | Already Picked: <span style="color:var(--success)">'+totalPicked+'</span> | Remaining: <span style="color:var(--warning)">'+remaining+'</span></div>';
    h+='<div class="loc-cards-grid">';
    locs.forEach(function(l,idx){
        var alreadyPicked=0;
        (pd.pickedLocations[mat.material]||[]).forEach(function(p){if(p.rack===l.rack)alreadyPicked+=p.qty;});
        var avail=l.quantity-alreadyPicked;
        if(avail<0)avail=0;
        var isPicked=alreadyPicked>0;
        h+='<div class="loc-card '+(isPicked?'lc-picked':'')+'">';
        h+='<div class="lc-rack"><i class="bx bx-map-pin"></i> '+esc(l.rack)+'</div>';
        h+='<div class="lc-mat">'+esc(l.material)+'</div>';
        h+='<div class="lc-avail">Available: <strong>'+avail+'</strong></div>';
        if(avail>0&&remaining>0){
            var maxPick=Math.min(avail,remaining);
            h+='<input type="number" id="pickQty_'+idx+'" value="'+maxPick+'" min="1" max="'+maxPick+'" placeholder="Qty to pick">';
            h+='<button class="btn btn-glass btn-sm" style="width:100%;margin-top:6px;justify-content:center" onclick="doPickFromLocation('+matIdx+','+idx+',\''+esc(l.rack)+'\','+avail+')"><i class="bx bx-check"></i> Pick</button>';
        }else if(isPicked){
            h+='<div style="text-align:center;color:var(--success);font-size:11px;margin-top:6px"><i class="bx bx-check-circle"></i> Picked '+alreadyPicked+'</div>';
        }else{
            h+='<div style="text-align:center;color:var(--text-muted);font-size:11px;margin-top:6px">Not available</div>';
        }
        h+='</div>';
    });
    h+='</div>';
    showModal('Pick Locations — '+mat.material,h,'lg',
        '<button class="btn btn-glass" onclick="closeModal();openPickingOBD(\''+pd.obdId+'\')"><i class="bx bx-arrow-back"></i> Back</button>');
}

function doPickFromLocation(matIdx,locIdx,rack,avail){
    var pd=window._pickData;if(!pd)return;
    var mat=pd.materials[matIdx];
    var qtyInput=document.getElementById('pickQty_'+locIdx);
    var qty=parseInt(qtyInput?qtyInput.value:0)||0;
    if(qty<=0){showToast('Enter quantity','error');return;}
    if(qty>avail){showToast('Cannot pick more than available','error');return;}
    var totalPicked=0;
    (pd.pickedLocations[mat.material]||[]).forEach(function(p){totalPicked+=p.qty;});
    if(totalPicked+qty>mat.qty){showToast('Exceeds required quantity','error');return;}

    if(!pd.pickedLocations[mat.material])pd.pickedLocations[mat.material]=[];
    pd.pickedLocations[mat.material].push({rack:rack,qty:qty,ean:mat.ean,material:mat.material});
    showToast('Picked '+qty+' from '+rack,'success');
    closeModal();openPickingOBD(pd.obdId);
}

function requestAdminLocation(matIdx){
    var pd=window._pickData;if(!pd)return;
    var mat=pd.materials[matIdx];
    var reason=document.getElementById('pickNoLocReason').value.trim();
    var altLoc=document.getElementById('pickAltLoc').value.trim();
    addNotif('Admin: Location needed for '+mat.material+' (OBD: '+pd.obdNo+'). Reason: '+(reason||'Not found')+'. Alt: '+(altLoc||'N/A'),'warning');
    logAction('Picking','LOCATION_REQUEST','Material '+mat.material+' location requested. Alt: '+(altLoc||'N/A'));
    showToast('Location request sent to admin','success');
    closeModal();openPickingOBD(pd.obdId);
}

function submitPicking(){
    var pd=window._pickData;if(!pd)return;
    var allPicked=true;
    pd.materials.forEach(function(m){
        var total=0;(pd.pickedLocations[m.material]||[]).forEach(function(p){total+=p.qty;});
        if(total<m.qty)allPicked=false;
    });
    if(!allPicked&&!confirm('Some materials not fully picked. Submit anyway?'))return;

    var pickingDetails=[];
    pd.materials.forEach(function(m){
        var locs=pd.pickedLocations[m.material]||[];
        var totalPicked=0;locs.forEach(function(l){totalPicked+=l.qty;});
        pickingDetails.push({material:m.material,ean:m.ean,requiredQty:m.qty,pickedQty:totalPicked,locations:locs,short:m.qty-totalPicked});
    });

    DB.add('picking_done',{obdId:pd.obdId,obdNo:pd.obdNo,pickedBy:APP.currentUser.id,pickedByName:APP.currentUser.name,pickedAt:new Date().toISOString(),details:pickingDetails,status:'Done'});
    DB.update('obd_data',pd.obdId,{status:'Picking Done'});
    // Update assignment
    var assign=DB.filter('picking_assignments',function(a){return a.obdId===pd.obdId&&a.status==='Assigned';});
    assign.forEach(function(a){DB.update('picking_assignments',a.id,{status:'Done'});});

    // Deduct from location master
    pickingDetails.forEach(function(d){
        d.locations.forEach(function(loc){
            var locRecords=DB.filter('location_master',function(l){return l.rack===loc.rack&&l.ean===loc.ean&&l.quantity>0;});
            var remaining=loc.qty;
            locRecords.forEach(function(lr){
                if(remaining<=0)return;
                var deduct=Math.min(lr.quantity,remaining);
                DB.update('location_master',lr.id,{quantity:lr.quantity-deduct});
                remaining-=deduct;
            });
            // Delete location records with 0 qty
            var zeroLocs=DB.filter('location_master',function(l){return l.rack===loc.rack&&l.ean===loc.ean&&l.quantity<=0;});
            zeroLocs.forEach(function(zl){DB.remove('location_master',zl.id);});
        });
    });

    // Create short report if any
    var shorts=pickingDetails.filter(function(d){return d.short>0;});
    if(shorts.length>0){
        DB.add('short_reports',{shortNo:DB.shortNo(),vehicleNo:pd.obdNo,lrNo:'OBD',unloadNo:pd.obdNo,items:shorts.map(function(s){return{invoiceNo:pd.obdNo,material:s.material,ean:s.ean,expected:s.requiredQty,scanned:s.pickedQty,short:s.short};}),posted:false,createdAt:new Date().toISOString()});
    }

    // Create picking report
    var reportRows=[];
    pickingDetails.forEach(function(d){
        d.locations.forEach(function(loc){
            reportRows.push({obdNo:pd.obdNo,material:d.material,ean:d.ean,rack:loc.rack,qty:loc.qty,pickedBy:APP.currentUser.name,pickedAt:new Date().toISOString()});
        });
    });
    DB.add('picking_reports',{reportNo:'PR-'+Date.now().toString(36).toUpperCase(),obdNo:pd.obdNo,rows:reportRows,createdAt:new Date().toISOString()});

    logAction('Picking','DONE','OBD '+pd.obdNo+' picked by '+APP.currentUser.name);
    addNotif('OBD '+pd.obdNo+' picking completed by '+APP.currentUser.name,'success');
    showToast('Picking completed for '+pd.obdNo,'success');
    closeModal();renderStartPicking();
}

// --- Picking Done ---
function renderPickingDone(){
    var done=DB.get('picking_done').reverse();
    var h='<div class="section-header"><h2><i class="bx bx-check-circle"></i> Picking Done ('+done.length+')</h2>';
    h+='<div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportPickingDoneExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportPickingDonePDF()"><i class="bx bx-file"></i> PDF</button></div></div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD No</th><th>Materials</th><th>Picked By</th><th>Time</th><th>Short</th><th>Actions</th></tr></thead><tbody>';
    if(!done.length)h+='<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">No picking done yet</td></tr>';
    else done.forEach(function(d){
        var shortCount=0;(d.details||[]).forEach(function(det){if(det.short>0)shortCount++;});
        h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(d.obdNo)+'</td><td><span class="badge badge-info">'+(d.details||[]).length+'</span></td><td>'+esc(d.pickedByName)+'</td><td style="font-size:11px;color:var(--text-muted)">'+fmtDT(d.pickedAt)+'</td><td>'+(shortCount?'<span class="badge badge-danger">'+shortCount+' short</span>':'<span class="badge badge-success">Complete</span>')+'</td><td><button class="btn btn-glass btn-sm" onclick="viewPickingDoneDetail(\''+d.id+'\')"><i class="bx bx-eye"></i></button></td></tr>';
    });
    h+='</tbody></table></div>';
    setHtml(h);
}
function viewPickingDoneDetail(id){
    var d=DB.find('picking_done',id);if(!d)return;
    var h='<div style="margin-bottom:12px"><strong>OBD:</strong> <span style="color:var(--accent)">'+esc(d.obdNo)+'</span> | <strong>By:</strong> '+esc(d.pickedByName)+' | <strong>Time:</strong> '+fmtDT(d.pickedAt)+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Material</th><th>EAN</th><th>Required</th><th>Picked</th><th>Short</th><th>Locations</th></tr></thead><tbody>';
    (d.details||[]).forEach(function(det){
        var locStr=(det.locations||[]).map(function(l){return l.rack+':'+l.qty;}).join(', ');
        h+='<tr class="'+(det.short>0?'scan-row-red':'scan-row-green')+'"><td>'+esc(det.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(det.ean)+'</td><td>'+det.requiredQty+'</td><td><strong>'+det.pickedQty+'</strong></td><td class="'+(det.short>0?'qty-mismatch':'qty-match')+'">'+(det.short>0?'-'+det.short:'0')+'</td><td style="font-size:11px">'+esc(locStr)+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('Picking Detail — '+d.obdNo,h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
function exportPickingDoneExcel(){
    var done=DB.get('picking_done');var rows=[['OBD No','Material','EAN','Required','Picked','Short','Picked By','Time']];
    done.forEach(function(d){(d.details||[]).forEach(function(det){rows.push([d.obnNo||d.obdNo,det.material,det.ean,det.requiredQty,det.pickedQty,det.short,det.pickedByName,fmtDT(d.pickedAt)]);});});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'PickingDone');XLSX.writeFile(wb,'Picking_Done_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}
function exportPickingDonePDF(){
    var done=DB.get('picking_done');var rows=[];
    done.forEach(function(d){(d.details||[]).forEach(function(det){rows.push([d.obdNo,det.material,det.ean,det.requiredQty,det.pickedQty,det.short,det.pickedByName,fmtDT(d.pickedAt)]);});});
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text('Picking Done Report — VIP INDUSTRIES MD20',14,15);pdf.setFontSize(8);pdf.text('Generated: '+fmtDT(new Date()),14,22);
    pdf.autoTable({startY:28,head:[['OBD No','Material','EAN','Req','Picked','Short','By','Time']],body:rows,theme:'grid',headStyles:{fillColor:[0,180,120]},styles:{fontSize:7}});
    pdf.save('Picking_Done_'+today()+'.pdf');showToast('PDF downloaded!','success');
}

// ==================== LOADING ====================
function renderLoading(sub){
    switch(sub){
        case 'loading-assign':renderLoadingAssign();break;
        case 'start-loading':renderStartLoading();break;
        case 'loading-done':renderLoadingDone();break;
        case 'qty-mismatch':renderQtyMismatch();break;
        default:renderLoadingAssign();
    }
}

// --- Loading Assign ---
function renderLoadingAssign(){
    // Get loading pending vehicles (entered by security for loading)
    var loadVehs=DB.filter('vehicles',function(v){return v.vehicleType==='Loading'&&(v.status==='Loading Pending'||v.status==='Loading Assigned');});
    // Get picking done OBDs
    var pickedOBDs=DB.get('picking_done').filter(function(p){return p.status==='Done';});
    // Get assigned loadings
    var assigned=DB.filter('loading_assignments',function(a){return a.status==='Assigned';});

    var h='<div class="section-header"><h2><i class="bx bx-truck"></i> Loading Assign</h2></div>';

    // Unassigned loading vehicles
    var unassigned=loadVehs.filter(function(v){return v.status==='Loading Pending';});
    h+='<div class="card"><div class="card-title"><i class="bx bx-clock"></i> Pending Loading Vehicles ('+unassigned.length+')</div>';
    if(!unassigned.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">No pending vehicles</div>';
    else{
        h+='<div class="form-group" style="margin-bottom:12px"><label>Select User <span class="req">*</span></label><select id="loadAssignUser" class="form-input" style="max-width:300px"><option value="">-- Select User --</option>';
        DB.get('users').filter(function(u){return u.role==='Loader'||u.role==='Manager';}).forEach(function(u){h+='<option value="'+u.id+'" data-name="'+esc(u.name)+'">'+esc(u.name)+' ('+esc(u.role)+')</option>';});
        h+='</select></div>';
        h+='<div class="form-group" style="margin-bottom:12px"><label>Vehicle Number (from Security Entry) <span class="req">*</span></label>';
        h+='<select id="loadVehSelect" class="form-input" style="max-width:300px"><option value="">-- Select Vehicle --</option>';
        unassigned.forEach(function(v){h+='<option value="'+v.id+'" data-no="'+esc(v.vehicleNo)+'">'+esc(v.vehicleNo)+' | '+esc(v.transportName||'')+'</option>';});
        h+='</select></div>';
        h+='<div class="card-title" style="margin-top:12px"><i class="bx bx-box"></i> Select OBDs to Load</div>';
        h+='<div class="chk-list" id="loadObdChkList" style="max-height:200px;overflow-y:auto">';
        if(!pickedOBDs.length)h+='<div style="padding:12px;text-align:center;color:var(--text-muted)">No picked OBDs available</div>';
        else pickedOBDs.forEach(function(o){
            var totalQ=0;(o.details||[]).forEach(function(d){totalQ+=d.pickedQty;});
            h+='<label class="chk-list-item"><input type="checkbox" class="load-obd-chk" value="'+o.id+'" data-no="'+esc(o.obdNo)+'"><span><strong style="color:var(--accent);font-family:var(--font-display);font-size:11px">'+esc(o.obdNo)+'</strong> — '+(o.details||[]).length+' mats, '+totalQ+' qty</span></label>';
        });
        h+='</div>';
        h+='<div class="form-actions"><button class="btn btn-glass" onclick="doLoadingAssign()"><i class="bx bx-check-double"></i> Assign Loading</button></div>';
    }
    h+='</div>';

    // Assigned
    if(assigned.length){
        h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-user-check"></i> Assigned Loadings ('+assigned.length+')</div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Load No</th><th>Vehicle</th><th>User</th><th>OBDs</th><th>Actions</th></tr></thead><tbody>';
        assigned.forEach(function(a){
            h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(a.loadNo)+'</td><td>'+esc(a.vehicleNo)+'</td><td>'+esc(a.assignedToName)+'</td><td><span class="badge badge-info">'+(a.obdIds||[]).length+'</span></td><td><button class="btn btn-danger btn-sm" onclick="unassignLoading(\''+a.id+'\')"><i class="bx bx-user-minus"></i> Unassign</button></td></tr>';
        });
        h+='</tbody></table></div></div>';
    }
    setHtml(h);
}
function doLoadingAssign(){
    var userSel=document.getElementById('loadAssignUser');
    var vehSel=document.getElementById('loadVehSelect');
    if(!userSel.value){showToast('Select user','error');return;}
    if(!vehSel.value){showToast('Select vehicle','error');return;}
    var userName=userSel.options[userSel.selectedIndex].getAttribute('data-name');
    var vehicleNo=vehSel.options[vehSel.selectedIndex].getAttribute('data-no');
    var checks=document.querySelectorAll('.load-obd-chk:checked');
    if(!checks.length){showToast('Select at least one OBD','error');return;}
    var loadNo=DB.loadNo();
    var obdIds=[],obdNos=[];
    checks.forEach(function(chk){obdIds.push(chk.value);obdNos.push(chk.getAttribute('data-no'));});
    DB.add('loading_assignments',{loadNo:loadNo,vehicleId:vehSel.value,vehicleNo:vehicleNo,obdIds:obdIds,obdNos:obdNos,assignedTo:userSel.value,assignedToName:userName,status:'Assigned',assignedAt:new Date().toISOString()});
    DB.update('vehicles',vehSel.value,{status:'Loading Assigned'});
    logAction('Loading','ASSIGN',loadNo+' assigned to '+userName+' for vehicle '+vehicleNo+' with '+obdIds.length+' OBDs');
    showToast('Loading assigned! '+obdIds.length+' OBDs','success');
    renderLoadingAssign();
}
function unassignLoading(assignId){
    if(!confirm('Unassign?'))return;
    var a=DB.find('loading_assignments',assignId);if(!a)return;
    DB.update('loading_assignments',assignId,{status:'Unassigned'});
    if(a.vehicleId)DB.update('vehicles',a.vehicleId,{status:'Loading Pending'});
    logAction('Loading','UNASSIGN','Loading '+a.loadNo+' unassigned');
    showToast('Unassigned','success');renderLoadingAssign();
}

// --- Start Loading ---
function renderStartLoading(){
    if(!APP.currentUser)return;
    var myAssign=DB.filter('loading_assignments',function(a){return a.assignedTo===APP.currentUser.id&&a.status==='Assigned';});
    var h='<div class="section-header"><h2><i class="bx bx-truck"></i> My Loading</h2></div>';
    if(!myAssign.length){h+='<div class="card"><div class="empty-state"><i class="bx bx-inbox"></i><p>No loading assigned to you</p></div></div>';setHtml(h);return;}
    myAssign.forEach(function(a){
        h+='<div class="card" style="margin-bottom:12px"><div class="card-title"><i class="bx bxs-truck"></i> '+esc(a.vehicleNo)+' — '+esc(a.loadNo)+'</div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">';
        (a.obdNos||[]).forEach(function(n){h+='<span class="badge badge-info">'+esc(n)+'</span>';});
        h+='</div>';
        if(chkAct('canLoad'))h+='<button class="btn btn-glass" onclick="startLoadingScan(\''+a.id+'\')"><i class="bx bx-scan"></i> Start Loading</button>';
        h+='</div>';
    });
    setHtml(h);
}
function startLoadingScan(assignId){
    var a=DB.find('loading_assignments',assignId);if(!a)return;
    // Build expected materials from all OBDs
    var expected=[];
    (a.obdIds||[]).forEach(function(oid){
        var pd=DB.find('picking_done',oid);
        if(pd){(pd.details||[]).forEach(function(d){expected.push({obdNo:d.obdNo,material:d.material,ean:d.ean,qty:d.pickedQty,scannedQty:0,scanned:false});});}
    });
    if(!expected.length){showToast('No materials to load','error');return;}
    window._loadData={assignId:assignId,loadNo:a.loadNo,vehicleNo:a.vehicleNo,expected:expected,scannedItems:[]};

    var h='<div style="margin-bottom:12px"><strong style="color:var(--accent)">'+esc(a.vehicleNo)+'</strong> — '+esc(a.loadNo)+'</div>';
    h+='<div class="search-box" style="max-width:100%;margin-bottom:12px"><i class="bx bx-search"></i><input type="text" id="scanLoadInput" placeholder="Scan material / EAN..." onkeydown="if(event.key===\'Enter\')addScanLoadItem()"></div>';
    h+='<div style="display:flex;gap:6px;margin-bottom:12px"><button class="btn btn-glass btn-sm" onclick="openScannerForLoad()"><i class="bx bx-qr"></i> Scanner</button><button class="btn btn-glass btn-sm" onclick="addScanLoadItem()"><i class="bx bx-plus"></i> Add</button></div>';
    h+='<div class="table-wrapper" style="max-height:350px;overflow-y:auto"><table class="data-table"><thead><tr><th>#</th><th>OBD</th><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Match</th></tr></thead><tbody id="scanLoadBody"></tbody></table></div>';
    h+='<div class="form-actions" style="margin-top:14px"><button class="btn btn-glass" onclick="submitLoading()"><i class="bx bx-check-double"></i> Submit Loading</button></div>';
    showModal('Loading Scan — '+a.vehicleNo,h,'xl','<button class="btn btn-glass" onclick="closeModal()">Cancel</button>');
    renderScanLoadTable();
}
function openScannerForLoad(){
    APP.scanCallback=function(code){document.getElementById('scanLoadInput').value=code;addScanLoadItem();};
    document.getElementById('scannerModal').style.display='flex';focusForBluetoothScanner();
}
function addScanLoadItem(){
    var input=document.getElementById('scanLoadInput');if(!input)return;
    var val=input.value.trim().toUpperCase();input.value='';if(!val)return;
    var ld=window._loadData;if(!ld)return;
    var found=null;
    ld.expected.forEach(function(e){if(!found&&(e.ean&&e.ean.toUpperCase()===val||e.material.toUpperCase()===val)){found=e;}});
    if(found){found.scannedQty++;found.scanned=true;ld.scannedItems.push({ean:val,material:found.material,match:true,obdNo:found.obdNo,time:new Date().toISOString()});}
    else{ld.scannedItems.push({ean:val,material:'UNKNOWN',match:false,obdNo:'-',time:new Date().toISOString()});}
    renderScanLoadTable();
}
function renderScanLoadTable(){
    var ld=window._loadData;if(!ld)return;
    var body=document.getElementById('scanLoadBody');if(!body)return;
    var h='';
    ld.expected.forEach(function(e,idx){
        var cls=e.scanned?(e.scannedQty<=e.qty?'scan-row-green':'scan-row-red'):'';
        var status=e.scanned?(e.scannedQty<=e.qty?'<span class="badge badge-success">Match</span>':'<span class="badge badge-danger">Excess</span>'):'<span class="badge badge-warning">Pending</span>';
        h+='<tr class="'+cls+'"><td>'+(idx+1)+'</td><td style="font-size:11px">'+esc(e.obdNo)+'</td><td>'+esc(e.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(e.ean)+'</td><td>'+e.qty+'</td><td><strong>'+(e.scannedQty||0)+'</strong></td><td>'+status+'</td></tr>';
    });
    ld.scannedItems.filter(function(s){return!s.match;}).forEach(function(s){
        h+='<tr class="scan-row-red"><td>-</td><td>'+esc(s.obdNo)+'</td><td>UNKNOWN</td><td style="font-family:var(--font-display);font-size:10px">'+esc(s.ean)+'</td><td>0</td><td>1</td><td><span class="badge badge-danger">Wrong</span></td></tr>';
    });
    body.innerHTML=h;
}
function submitLoading(){
    var ld=window._loadData;if(!ld)return;
    var hasScan=ld.expected.some(function(e){return e.scanned;});
    if(!hasScan){showToast('Scan at least one material','error');return;}
    var materials=[];var wrongItems=[];
    ld.expected.forEach(function(e){
        materials.push({obdNo:e.obdNo,material:e.material,ean:e.ean,expectedQty:e.qty,scannedQty:e.scannedQty,diff:e.qty-e.scannedQty});
    });
    ld.scannedItems.filter(function(s){return!s.match;}).forEach(function(s){
        materials.push({obdNo:'-',material:'UNKNOWN',ean:s.ean,expectedQty:0,scannedQty:1,diff:-1});
        wrongItems.push(s);
    });

    DB.add('loaded_vehicles',{loadNo:ld.loadNo,vehicleNo:ld.vehicleNo,loadedBy:APP.currentUser.id,loadedByName:APP.currentUser.name,loadedAt:new Date().toISOString(),materials:materials,status:'Loaded'});
    DB.update('loading_assignments',ld.assignId,{status:'Done'});
    // Update vehicle
    var vehs=DB.filter('vehicles',function(v){return v.vehicleNo===ld.vehicleNo;});
    vehs.forEach(function(v){DB.update('vehicles',v.id,{status:'Loading Done'});});
    // Qty mismatch report
    var mismatches=materials.filter(function(m){return m.diff!==0;});
    if(mismatches.length>0){
        DB.add('loading_data',{loadNo:ld.loadNo,vehicleNo:ld.vehicleNo,mismatches:mismatches,createdAt:new Date().toISOString()});
    }
    logAction('Loading','DONE',ld.loadNo+' for vehicle '+ld.vehicleNo);
    addNotif('Loading '+ld.loadNo+' completed for '+ld.vehicleNo,'success');
    showToast('Loading completed!','success');
    closeModal();renderStartLoading();
}

// --- Loading Done ---
function renderLoadingDone(){
    var loaded=DB.get('loaded_vehicles').reverse();
    var h='<div class="section-header"><h2><i class="bx bx-check-circle"></i> Loaded Vehicles ('+loaded.length+')</h2>';
    h+='<div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportLoadingExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportLoadingPDF()"><i class="bx bx-file"></i> PDF</button></div></div>';
    h+='<div class="search-box"><i class="bx bx-search"></i><input type="text" id="loadDoneSearch" placeholder="Search vehicle, load no..." oninput="searchLoadDone()"></div>';
    h+='<div id="loadDoneTable">'+buildLoadDoneTable(loaded)+'</div>';
    setHtml(h);
}
function buildLoadDoneTable(loaded){
    var h='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Load No</th><th>Vehicle</th><th>Materials</th><th>Loaded By</th><th>Time</th><th>Actions</th></tr></thead><tbody>';
    if(!loaded.length)h+='<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">No loaded vehicles</td></tr>';
    else loaded.forEach(function(l){
        h+='<tr><td style="font-family:var(--font-display);font-size:11px;color:var(--accent)">'+esc(l.loadNo)+'</td><td><strong>'+esc(l.vehicleNo)+'</strong></td><td><span class="badge badge-info">'+(l.materials||[]).length+'</span></td><td>'+esc(l.loadedByName)+'</td><td style="font-size:11px;color:var(--text-muted)">'+fmtDT(l.loadedAt)+'</td><td><button class="btn btn-glass btn-sm" onclick="viewLoadDetail(\''+l.id+'\')"><i class="bx bx-eye"></i></button></td></tr>';
    });
    h+='</tbody></table></div>';return h;
}
function searchLoadDone(){
    var q=document.getElementById('loadDoneSearch').value.trim().toLowerCase();
    var loaded=DB.get('loaded_vehicles').reverse();
    if(q)loaded=loaded.filter(function(l){return(l.vehicleNo||'').toLowerCase().indexOf(q)>-1||(l.loadNo||'').toLowerCase().indexOf(q)>-1;});
    document.getElementById('loadDoneTable').innerHTML=buildLoadDoneTable(loaded);
}
function viewLoadDetail(id){
    var l=DB.find('loaded_vehicles',id);if(!l)return;
    var h='<div style="margin-bottom:12px"><strong>Load No:</strong> <span style="color:var(--accent);font-family:var(--font-display)">'+esc(l.loadNo)+'</span> | <strong>Vehicle:</strong> '+esc(l.vehicleNo)+'</div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>OBD</th><th>Material</th><th>EAN</th><th>Expected</th><th>Scanned</th><th>Diff</th></tr></thead><tbody>';
    (l.materials||[]).forEach(function(m){
        var cls=m.diff===0?'qty-match':'qty-mismatch';
        h+='<tr class="'+(m.diff===0?'':'scan-row-red')+'"><td>'+esc(m.obdNo)+'</td><td>'+esc(m.material)+'</td><td style="font-family:var(--font-display);font-size:10px">'+esc(m.ean)+'</td><td>'+m.expectedQty+'</td><td>'+m.scannedQty+'</td><td class="'+cls+'">'+(m.diff>0?'-'+m.diff:(m.diff<0?'+'+Math.abs(m.diff):'0'))+'</td></tr>';
    });
    h+='</tbody></table></div>';
    showModal('Loading Detail — '+l.loadNo,h,'lg','<button class="btn btn-glass" onclick="closeModal()">Close</button>');
}
function exportLoadingExcel(){
    var loaded=DB.get('loaded_vehicles');var rows=[['Load No','Vehicle','Material','EAN','Expected','Scanned','Diff','By','Time']];
    loaded.forEach(function(l){(l.materials||[]).forEach(function(m){rows.push([l.loadNo,l.vehicleNo,m.material,m.ean,m.expectedQty,m.scannedQty,m.diff,l.loadedByName,fmtDT(l.loadedAt)]);});});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Loading');XLSX.writeFile(wb,'Loading_Done_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}
function exportLoadingPDF(){
    var loaded=DB.get('loaded_vehicles');var rows=[];
    loaded.forEach(function(l){(l.materials||[]).forEach(function(m){rows.push([l.loadNo,l.vehicleNo,m.material,m.ean,m.expectedQty,m.scannedQty,m.diff,l.loadedByName,fmtDT(l.loadedAt)]);});});
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text('Loading Report — VIP INDUSTRIES MD20',14,15);pdf.setFontSize(8);pdf.text('Generated: '+fmtDT(new Date()),14,22);
    pdf.autoTable({startY:28,head:[['Load No','Vehicle','Material','EAN','Exp','Scan','Diff','By','Time']],body:rows,theme:'grid',headStyles:{fillColor:[0,180,120]},styles:{fontSize:7}});
    pdf.save('Loading_Report_'+today()+'.pdf');showToast('PDF downloaded!','success');
}

// --- Qty Mismatch ---
function renderQtyMismatch(){
    var shorts=DB.get('short_reports').reverse();
    var loadMismatches=DB.get('loading_data').reverse();
    var h='<div class="section-header"><h2><i class="bx bx-error-circle"></i> Quantity Mismatch Reports</h2>';
    h+='<div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportMismatchExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportMismatchPDF()"><i class="bx bx-file"></i> PDF</button></div></div>';

    // Short reports (unloading)
    h+='<div class="card"><div class="card-title"><i class="bx bx-error" style="color:var(--danger)"></i> Unloading Short Reports ('+shorts.length+')</div>';
    if(!shorts.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">No shorts</div>';
    else{
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Short No</th><th>Vehicle/OBD</th><th>Invoice</th><th>Material</th><th>Expected</th><th>Actual</th><th>Short</th><th>Posted</th></tr></thead><tbody>';
        shorts.forEach(function(s){
            (s.items||[]).forEach(function(it){
                h+='<tr class="scan-row-red"><td style="font-family:var(--font-display);font-size:10px">'+esc(s.shortNo)+'</td><td>'+esc(s.vehicleNo)+'</td><td>'+esc(it.invoiceNo)+'</td><td>'+esc(it.material)+'</td><td>'+it.expected+'</td><td>'+it.scanned+'</td><td class="qty-mismatch">-'+it.short+'</td><td>'+(s.posted?'<span class="badge badge-success">Yes</span>':'<span class="badge badge-warning">No</span>')+'</td></tr>';
            });
        });
        h+='</tbody></table></div>';
    }
    h+='</div>';

    // Loading mismatches
    h+='<div class="card" style="margin-top:16px"><div class="card-title"><i class="bx bx-error" style="color:var(--warning)"></i> Loading Mismatches ('+loadMismatches.length+')</div>';
    if(!loadMismatches.length)h+='<div style="color:var(--text-muted);padding:16px;text-align:center">No mismatches</div>';
    else{
        h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Load No</th><th>Vehicle</th><th>Material</th><th>Expected</th><th>Scanned</th><th>Diff</th></tr></thead><tbody>';
        loadMismatches.forEach(function(lm){
            (lm.mismatches||[]).forEach(function(m){
                if(m.diff!==0){
                    h+='<tr class="'+(m.diff<0?'scan-row-red':'scan-row-red')+'"><td style="font-family:var(--font-display);font-size:10px">'+esc(lm.loadNo)+'</td><td>'+esc(lm.vehicleNo)+'</td><td>'+esc(m.material)+'</td><td>'+m.expectedQty+'</td><td>'+m.scannedQty+'</td><td class="qty-mismatch">'+(m.diff>0?'-'+m.diff:'+'+Math.abs(m.diff))+'</td></tr>';
                }
            });
        });
        h+='</tbody></table></div>';
    }
    h+='</div>';
    setHtml(h);
}
function exportMismatchExcel(){
    var shorts=DB.get('short_reports');var rows=[['Short No','Vehicle','Invoice','Material','EAN','Expected','Actual','Short','Posted']];
    shorts.forEach(function(s){(s.items||[]).forEach(function(it){rows.push([s.shortNo,s.vehicleNo,it.invoiceNo,it.material,it.ean,it.expected,it.scanned,it.short,s.posted?'Yes':'No']);});});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Mismatch');XLSX.writeFile(wb,'Qty_Mismatch_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}
function exportMismatchPDF(){
    var shorts=DB.get('short_reports');var rows=[];
    shorts.forEach(function(s){(s.items||[]).forEach(function(it){rows.push([s.shortNo,s.vehicleNo,it.invoiceNo,it.material,it.ean,it.expected,it.scanned,it.short]);});});
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text('Quantity Mismatch Report — VIP INDUSTRIES MD20',14,15);
    pdf.autoTable({startY:22,head:[['Short No','Vehicle','Invoice','Material','EAN','Exp','Act','Short']],body:rows,theme:'grid',headStyles:{fillColor:[220,38,38]},styles:{fontSize:7}});
    pdf.save('Qty_Mismatch_'+today()+'.pdf');showToast('PDF downloaded!','success');
}

// ==================== USER WORKING TIME ====================
function renderUserWorkingTime(){
    var logs=DB.get('user_work_log').reverse();
    var h='<div class="section-header"><h2><i class="bx bx-time-five"></i> User Working Time</h2>';
    h+='<div style="display:flex;gap:6px"><button class="btn btn-glass" onclick="exportWorkTimeExcel()"><i class="bx bx-download"></i> Excel</button><button class="btn btn-glass" onclick="exportWorkTimePDF()"><i class="bx bx-file"></i> PDF</button></div></div>';
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
    var logs=DB.get('user_work_log').reverse();
    if(from)logs=logs.filter(function(l){return l.dateTime&&l.dateTime.split('T')[0]>=from;});
    if(to)logs=logs.filter(function(l){return l.dateTime&&l.dateTime.split('T')[0]<=to;});
    if(userId)logs=logs.filter(function(l){return l.userId===userId;});
    document.getElementById('wtResult').innerHTML=buildWorkTimeTable(logs);
}
function exportWorkTimeExcel(){
    var logs=DB.get('user_work_log').reverse();var rows=[['User','Module','Action','Date Time']];
    logs.forEach(function(l){rows.push([l.userName,l.module,l.action,fmtDT(l.dateTime)]);});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'WorkTime');XLSX.writeFile(wb,'User_Work_Time_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}
function exportWorkTimePDF(){
    var logs=DB.get('user_work_log').reverse();var rows=[];
    logs.forEach(function(l){rows.push([l.userName,l.module,l.action,fmtDT(l.dateTime)]);});
    var pdf=new jspdf.jsPDF({orientation:'landscape'});pdf.setFontSize(14);pdf.text('User Working Time — VIP INDUSTRIES MD20',14,15);
    pdf.autoTable({startY:22,head:[['User','Module','Action','Date Time']],body:rows,theme:'grid',headStyles:{fillColor:[0,180,120]},styles:{fontSize:7}});
    pdf.save('User_Work_Time_'+today()+'.pdf');showToast('PDF downloaded!','success');
}

// ==================== ADMIN ====================
function renderAdmin(){
    var users=DB.get('users');
    var h='<div class="section-header"><h2><i class="bx bx-user-detail"></i> User Management</h2><button class="btn btn-glass" onclick="showAddUser()"><i class="bx bx-plus"></i> Add User</button></div>';
    h+='<div class="table-wrapper"><table class="data-table"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Actions</th></tr></thead><tbody>';
    users.forEach(function(u){
        h+='<tr><td><strong>'+esc(u.username)+'</strong></td><td>'+esc(u.name)+'</td><td><span class="badge badge-accent">'+esc(u.role)+'</span></td><td><div class="table-actions"><button class="btn btn-glass btn-sm" onclick="editUser(\''+u.id+'\')"><i class="bx bx-edit"></i></button>'+(u.role!=='Super Admin'?'<button class="btn btn-danger btn-sm" onclick="deleteUser(\''+u.id+'\')"><i class="bx bx-trash"></i></button>':'')+'</div></td></tr>';
    });
    h+='</tbody></table></div>';
    setHtml(h);
}
function showAddUser(){
    var h='<div class="form-row"><div class="form-group"><label>Username <span class="req">*</span></label><input type="text" id="auUser" class="form-input"></div><div class="form-group"><label>Password <span class="req">*</span></label><input type="text" id="auPass" class="form-input"></div></div>';
    h+='<div class="form-row"><div class="form-group"><label>Full Name <span class="req">*</span></label><input type="text" id="auName" class="form-input"></div><div class="form-group"><label>Role <span class="req">*</span></label><select id="auRole" class="form-input"><option>Admin</option><option>Manager</option><option>DEO</option><option>Security</option><option>Unloader</option><option>Picker</option><option>Loader</option></select></div></div>';
    h+='<div class="card-title" style="margin-top:12px"><i class="bx bx-shield"></i> Permissions</div><div class="perm-grid">';
    var perms=[['canSecurityEntry','Security Entry'],['canUploadInvoice','Upload Invoice'],['canAssignVehicle','Assign Vehicle'],['canStartUnloading','Start Unloading'],['canPostVehicle','Post Vehicle'],['canApprove','Approve'],['canViewReports','View Reports'],['canPutaway','Putaway'],['canPIV','PIV'],['canPick','Picking'],['canLoad','Loading'],['canAdmin','Admin']];
    perms.forEach(function(p){h+='<div class="perm-item"><input type="checkbox" id="au_'+p[0]+'" checked><label for="au_'+p[0]+'">'+p[1]+'</label></div>';});
    h+='</div>';
    showModal('Add User',h,'lg','<button class="btn btn-glass" onclick="closeModal()">Cancel</button><button class="btn btn-glass" onclick="saveUser()"><i class="bx bx-check"></i> Save</button>');
}
function saveUser(){
    var un=document.getElementById('auUser').value.trim(),pw=document.getElementById('auPass').value.trim(),nm=document.getElementById('auName').value.trim(),rl=document.getElementById('auRole').value;
    if(!un||!pw||!nm){showToast('Fill required fields','error');return;}
    var actions={};
    var perms=['canSecurityEntry','canUploadInvoice','canAssignVehicle','canStartUnloading','canPostVehicle','canApprove','canViewReports','canPutaway','canPIV','canPick','canLoad','canAdmin'];
    perms.forEach(function(p){actions[p]=document.getElementById('au_'+p).checked;});
    var modMap={Admin:['all'],Manager:['dashboard','inbound','reports','audit','picking','loading','user-time'],DEO:['inbound'],Security:['inbound','loading'],Unloader:['inbound'],Picker:['picking'],Loader:['loading']};
    DB.add('users',{username:un,password:pw,name:nm,role:rl,permissions:{modules:modMap[rl]||['dashboard'],actions:actions}});
    logAction('Admin','ADD_USER','User '+un+' ('+rl+') created');showToast('User created!','success');closeModal();renderAdmin();
}
function editUser(id){
    var u=DB.find('users',id);if(!u)return;
    var h='<div class="form-row"><div class="form-group"><label>Full Name</label><input type="text" id="euName" class="form-input" value="'+esc(u.name)+'"></div><div class="form-group"><label>Role</label><select id="euRole" class="form-input"><option'+(u.role==='Admin'?' selected':'')+'>Admin</option><option'+(u.role==='Manager'?' selected':'')+'>Manager</option><option'+(u.role==='DEO'?' selected':'')+'>DEO</option><option'+(u.role==='Security'?' selected':'')+'>Security</option><option'+(u.role==='Unloader'?' selected':'')+'>Unloader</option><option'+(u.role==='Picker'?' selected':'')+'>Picker</option><option'+(u.role==='Loader'?' selected':'')+'>Loader</option></select></div></div>';
    h+='<div class="form-group"><label>New Password (leave blank to keep)</label><input type="text" id="euPass" class="form-input" placeholder="New password"></div>';
    h+='<div class="card-title" style="margin-top:12px"><i class="bx bx-shield"></i> Permissions</div><div class="perm-grid">';
    var perms=['canSecurityEntry','canUploadInvoice','canAssignVehicle','canStartUnloading','canPostVehicle','canApprove','canViewReports','canPutaway','canPIV','canPick','canLoad','canAdmin'];
    var pLabels=['Security Entry','Upload Invoice','Assign Vehicle','Start Unloading','Post Vehicle','Approve','View Reports','Putaway','PIV','Picking','Loading','Admin'];
    perms.forEach(function(p,i){h+='<div class="perm-item"><input type="checkbox" id="eu_'+p+'" '+(u.permissions.actions&&u.permissions.actions[p]?'checked':'')+'><label for="eu_'+p+'">'+pLabels[i]+'</label></div>';});
    h+='</div>';
    showModal('Edit User — '+u.name,h,'lg','<button class="btn btn-glass" onclick="closeModal()">Cancel</button><button class="btn btn-glass" onclick="updateUser(\''+id+'\')"><i class="bx bx-check"></i> Update</button>');
}
function updateUser(id){
    var up={name:document.getElementById('euName').value.trim(),role:document.getElementById('euRole').value};
    var pw=document.getElementById('euPass').value.trim();if(pw)up.password=pw;
    var actions={};var perms=['canSecurityEntry','canUploadInvoice','canAssignVehicle','canStartUnloading','canPostVehicle','canApprove','canViewReports','canPutaway','canPIV','canPick','canLoad','canAdmin'];
    perms.forEach(function(p){actions[p]=document.getElementById('eu_'+p).checked;});
    var modMap={Admin:['all'],Manager:['dashboard','inbound','reports','audit','picking','loading','user-time'],DEO:['inbound'],Security:['inbound','loading'],Unloader:['inbound'],Picker:['picking'],Loader:['loading']};
    up.permissions={modules:modMap[up.role]||['dashboard'],actions:actions};
    DB.update('users',id,up);logAction('Admin','EDIT_USER','User '+id+' updated');showToast('User updated!','success');closeModal();renderAdmin();
}
function deleteUser(id){if(!confirm('Delete user?'))return;DB.remove('users',id);logAction('Admin','DELETE_USER','User '+id+' deleted');showToast('User deleted','success');renderAdmin();}

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
function showExportAll(){
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
function getGlobalData(){
    var from=document.getElementById('grFrom').value;
    var to=document.getElementById('grTo').value;
    var data={vehicles:0,posted:0,pending:0,putaway:0,piv:0,picked:0,loaded:0,shorts:0};
    var vehs=DB.get('vehicles').filter(function(v){return v.reportedAt&&v.reportedAt.split('T')[0]>=from&&v.reportedAt.split('T')[0]<=to;});
    data.vehicles=vehs.length;
    vehs.forEach(function(v){if(v.status==='Posted'||v.status==='Unloaded')data.posted++;else data.pending++;});
    var locs=DB.get('location_master').filter(function(l){return l.date>=from&&l.date<=to;});
    locs.forEach(function(l){if(l.action==='PUTAWAY')data.putaway++;else if(l.action==='PIV')data.piv++;});
    data.picked=DB.get('picking_done').filter(function(p){return p.pickedAt&&p.pickedAt.split('T')[0]>=from&&p.pickedAt.split('T')[0]<=to;}).length;
    data.loaded=DB.get('loaded_vehicles').filter(function(l){return l.loadedAt&&l.loadedAt.split('T')[0]>=from&&l.loadedAt.split('T')[0]<=to;}).length;
    data.shorts=DB.get('short_reports').filter(function(s){return s.createdAt&&s.createdAt.split('T')[0]>=from&&s.createdAt.split('T')[0]<=to;}).length;
    return data;
}
function generateGlobalReport(){
    var d=getGlobalData();
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
function exportGlobalExcel(){
    var d=getGlobalData();var rows=[['Metric','Value'],['Total Vehicles',d.vehicles],['Posted',d.posted],['Pending',d.pending],['Putaway',d.putaway],['PIV',d.piv],['Picked',d.picked],['Loaded',d.loaded],['Shorts',d.shorts]];
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Global');XLSX.writeFile(wb,'Global_Report_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}
function exportGlobalPDF(){
    var d=getGlobalData();var rows=[['Total Vehicles',d.vehicles],['Posted',d.posted],['Pending',d.pending],['Putaway',d.putaway],['PIV',d.piv],['Picked',d.picked],['Loaded',d.loaded],['Shorts',d.shorts]];
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
function doChangePassword(){
    var curr=document.getElementById('cpCurr').value,newP=document.getElementById('cpNew').value,conf=document.getElementById('cpConf').value;
    if(curr!==APP.currentUser.password){showToast('Current password incorrect','error');return;}
    if(newP!==conf){showToast('Passwords do not match','error');return;}
    if(newP.length<4){showToast('Password too short','error');return;}
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
    var logs=DB.get('audit_log').reverse();
    var pg=paginate(logs,APP.auditPage,APP.auditPerPage);
    var h='<div class="section-header"><h2><i class="bx bx-receipt"></i> Audit Log ('+logs.length+')</h2><button class="btn btn-glass" onclick="exportAuditExcel()"><i class="bx bx-download"></i> Excel</button></div>';
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
    var logs=DB.get('audit_log').reverse();
    if(q)logs=logs.filter(function(l){return(l.module||'').toLowerCase().indexOf(q)>-1||(l.action||'').toLowerCase().indexOf(q)>-1||(l.userName||'').toLowerCase().indexOf(q)>-1;});
    document.getElementById('auditTable').innerHTML=buildAuditTable(logs);
}
function exportAuditExcel(){
    var logs=DB.get('audit_log');var rows=[['Module','Action','Details','User','Date Time']];
    logs.forEach(function(l){rows.push([l.module,l.action,l.details,l.userName,fmtDT(l.dateTime)]);});
    var ws=XLSX.utils.aoa_to_sheet(rows);var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Audit');XLSX.writeFile(wb,'Audit_Log_'+today()+'.xlsx');showToast('Excel downloaded!','success');
}

// ==================== EXPORT UTILITY ====================
function exportTableExcel(tableKey,fileName){
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
        {id:'piv',icon:'bxs-clipboard',label:'PIV'},
        {id:'location',icon:'bxs-map-pin',label:'Location'},
        {id:'rack',icon:'bxs-grid-alt',label:'Rack Master'},
        {id:'material',icon:'bxs-label',label:'Material'},
        {id:'admin',icon:'bxs-user-detail',label:'Admin'},
        {id:'settings',icon:'bxs-cog',label:'Settings'},
        {id:'reports',icon:'bxs-bar-chart-alt-2',label:'Reports'},
        {id:'audit',icon:'bxs-receipt',label:'Audit Log'},
        {id:'user-time',icon:'bx-time-five',label:'Work Time'}
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
    input.addEventListener('keydown',function(e){
        if(e.key==='Enter'){
            var q=input.value.trim().toLowerCase();if(!q)return;
            // Search across all tables
            var results=[];
            DB.get('vehicles').forEach(function(v){if((v.vehicleNo||'').toLowerCase().indexOf(q)>-1||(v.lrNo||'').toLowerCase().indexOf(q)>-1)results.push({type:'Vehicle',label:v.vehicleNo,sub:v.lrNo||'',nav:'inbound',subNav:'inbound-record'});});
            DB.get('material_master').forEach(function(m){if((m.material||'').toLowerCase().indexOf(q)>-1||(m.ean||'').toLowerCase().indexOf(q)>-1)results.push({type:'Material',label:m.material,sub:m.ean||'',nav:'material'});});
            DB.get('location_master').forEach(function(l){if((l.rack||'').toLowerCase().indexOf(q)>-1||(l.material||'').toLowerCase().indexOf(q)>-1)results.push({type:'Location',label:l.rack+' - '+l.material,sub:'Qty: '+l.quantity,nav:'location'});});
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
    document.getElementById('loginForm').addEventListener('submit',function(e){
        e.preventDefault();
        if(doLogin(document.getElementById('loginUser').value.trim(),document.getElementById('loginPass').value)){
            document.getElementById('loginPage').style.display='none';
            document.getElementById('mainApp').style.display='flex';
            if(window._matrixInterval)clearInterval(window._matrixInterval);
            document.getElementById('userAvatar').textContent=APP.currentUser.name.charAt(0).toUpperCase();
            document.getElementById('userName').textContent=APP.currentUser.name;
            renderSidebar();initBottomNav();navTo('dashboard');initSessionTimeout();
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
    seedData();

    // Init login
    initMatrix();
    initEvents();

    // Check existing session
    var session=localStorage.getItem('wms_session');
    if(session){
        try{
            var s=JSON.parse(session);
            var user=DB.find('users',s.userId);
            if(user){
                APP.currentUser=user;APP.sessionStart=Date.now();
                document.getElementById('loginPage').style.display='none';
                document.getElementById('mainApp').style.display='flex';
                if(window._matrixInterval)clearInterval(window._matrixInterval);
                document.getElementById('userAvatar').textContent=user.name.charAt(0).toUpperCase();
                document.getElementById('userName').textContent=user.name;
                pullAll();
                renderSidebar();initBottomNav();navTo('dashboard');initSessionTimeout();
            }
        }catch(e){}
    }
})();