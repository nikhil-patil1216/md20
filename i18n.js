/* ============================================================
   VIP WMS — i18n MULTI-LANGUAGE MODULE (COMPLETE)
   Load AFTER ui-enterprise.js
   English | Hindi | Marathi | Gujarati
   UI-only translation — business logic untouched.
   ============================================================ */
(function () {
  'use strict';

  var LANGS = {
    en: { name: 'English',  native: 'English',  flag: '🌐' },
    hi: { name: 'Hindi',    native: 'हिन्दी',   flag: '🇮🇳' },
    mr: { name: 'Marathi',  native: 'मराठी',    flag: '🚩' },
    gu: { name: 'Gujarati', native: 'ગુજરાતી',  flag: '🦁' }
  };

  /* ---------- DICTIONARIES (key = English UI text) ---------- */
  var DICT = {

  /* ================= HINDI ================= */
  hi: {
    /* Nav groups */
    'Dashboard':'डैशबोर्ड','Inbound':'इनबाउंड','Warehouse':'वेयरहाउस','Master Data':'मास्टर डेटा',
    'Outbound':'आउटबाउंड','Insights':'इनसाइट्स','Administration':'प्रशासन',
    /* Nav items + subs */
    'Vehicle Entry':'वाहन प्रवेश','Unloading Pending':'अनलोडिंग लंबित','Goods Receipt / Unloading':'गुड्स रिसीव / अनलोडिंग',
    'Posting Pending':'पोस्टिंग लंबित','Inbound History':'इनबाउंड इतिहास','Unloading Stock':'अनलोडिंग स्टॉक',
    'Putaway':'पुटअवे','Storage Locations':'स्टोरेज लोकेशन','Storage Bins':'स्टोरेज बिन','Materials':'सामग्री',
    'Picking':'पिकिंग','Outbound Deliveries (OBD)':'आउटबाउंड डिलीवरी (OBD)','Assign Picking':'पिकिंग असाइन करें',
    'Execute Picking':'पिकिंग निष्पादित करें','Picking Records':'पिकिंग रिकॉर्ड','Pick & Load':'पिक और लोड',
    'Loading':'लोडिंग','Assign Loading':'लोडिंग असाइन करें','Execute Loading':'लोडिंग निष्पादित करें',
    'Loading Records':'लोडिंग रिकॉर्ड','Quantity Differences':'मात्रा अंतर','Reports':'रिपोर्ट्स',
    'User Working Time':'यूज़र कार्य समय','Audit Log':'ऑडिट लॉग','User Management':'यूज़र मैनेजमेंट','Settings':'सेटिंग्स',
    /* Original script.js labels (backup aliases) */
    'Overview':'ओवरव्यू','Inbound Process':'इनबाउंड प्रक्रिया','Create Vehicle Entry':'वाहन एंट्री बनाएं',
    'Pending Vehicles':'लंबित वाहन','Inbound Records':'इनबाउंड रिकॉर्ड','Outbound Picking':'आउटबाउंड पिकिंग',
    'Outbound Loading':'आउटबाउंड लोडिंग','User Activity Log':'यूज़र गतिविधि लॉग','Reports / Analytics':'रिपोर्ट्स / एनालिटिक्स',
    'Create Outbound Delivery':'आउटबाउंड डिलीवरी बनाएं','Assign Picking Tasks':'पिकिंग कार्य असाइन करें',
    'Picking with Loading':'लोडिंग के साथ पिकिंग','Assign Loading Tasks':'लोडिंग कार्य असाइन करें',
    'Security Gate Entry':'सुरक्षा गेट एंट्री','Vehicle Reporting':'वाहन रिपोर्टिंग',
    /* Header */
    'Home':'होम','Notifications':'सूचनाएं','Clear All':'सभी हटाएं','Profile':'प्रोफाइल',
    'Change Password':'पासवर्ड बदलें','Logout':'लॉगआउट','Language':'भाषा','Refresh':'रीफ्रेश','Print':'प्रिंट',
    'Help':'सहायता','More':'और','All Modules':'सभी मॉड्यूल',
    'Search material, EAN, OBD, vehicle, invoice...':'सामग्री, EAN, OBD, वाहन, इनवॉइस खोजें...',
    /* Login */
    'Username':'यूज़रनेम','Password':'पासवर्ड','Enter username':'यूज़रनेम दर्ज करें','Enter password':'पासवर्ड दर्ज करें',
    'Sign In':'साइन इन','Warehouse Management System':'वेयरहाउस मैनेजमेंट सिस्टम',
    'Secured Enterprise Access Portal':'सुरक्षित एंटरप्राइज़ एक्सेस पोर्टल',
    /* Buttons */
    'Save':'सेव करें','Cancel':'रद्द करें','Search':'खोजें','Clear':'साफ़ करें','Close':'बंद करें','Submit':'सबमिट करें',
    'Approve':'स्वीकृत करें','Reject':'अस्वीकृत करें','Edit':'संपादित करें','Delete':'हटाएं','View':'देखें','Add':'जोड़ें',
    'Update':'अपडेट करें','Assign':'असाइन करें','Scan':'स्कैन करें','Upload':'अपलोड करें','Download':'डाउनलोड करें',
    'Start':'शुरू करें','Complete':'पूर्ण करें','Export':'एक्सपोर्ट','Import':'इंपोर्ट','Filters':'फ़िल्टर',
    'Yes':'हां','No':'नहीं','OK':'ठीक है','Confirm':'पुष्टि करें','Back':'वापस','Apply':'लागू करें','Reset':'रीसेट',
    'Select':'चुनें','All':'सभी','Reason':'कारण','Remarks':'टिप्पणी',
    /* Table headers */
    'Status':'स्थिति','Date':'तारीख','Time':'समय','Actions':'कार्रवाई','Action':'कार्रवाई','User':'यूज़र','Module':'मॉड्यूल',
    'Vehicle':'वाहन','Transport':'ट्रांसपोर्ट','LR No':'LR नं.','LR Number':'LR नंबर','Invoice No.':'इनवॉइस नं.',
    'Invoice No':'इनवॉइस नं.','Material':'सामग्री','Description':'विवरण','Quantity':'मात्रा','Location':'लोकेशन',
    'Picker':'पिकर','Customer':'ग्राहक','Order Qty':'ऑर्डर मात्रा','Picked Qty':'पिक मात्रा','Required Qty':'आवश्यक मात्रा',
    'Scanned Qty':'स्कैन मात्रा','Available Qty':'उपलब्ध मात्रा','Difference':'अंतर','Created Date':'बनाई गई तारीख',
    'Vehicle No.':'वाहन नं.','Vehicle Number':'वाहन नंबर','Driver Name':'ड्राइवर का नाम','Driver Mobile':'ड्राइवर मोबाइल',
    'Transporter Name':'ट्रांसपोर्टर नाम','Reporting Time':'रिपोर्टिंग समय','Entry By':'प्रवेशकर्ता',
    'Vehicle Type':'वाहन प्रकार','UNLOADING':'अनलोडिंग','LOADING':'लोडिंग','Rack':'रैक','Bin':'बिन',
    'Capacity':'क्षमता','Utilization':'उपयोग','Role':'भूमिका','Login Time':'लॉगिन समय','Logout Time':'लॉगआउट समय','Duration':'अवधि',
    /* Statuses */
    'Pending':'लंबित','Completed':'पूर्ण','In Progress':'प्रगति में','Approved':'स्वीकृत','Rejected':'अस्वीकृत',
    'Cancelled':'रद्द','Assigned':'असाइन','Posted':'पोस्टेड','Unloaded':'अनलोडेड','Loaded':'लोडेड',
    'Unload Pending':'अनलोड लंबित','Loading Done':'लोडिंग पूर्ण','Posting Pending Approval':'पोस्टिंग अनुमोदन लंबित',
    'Active':'सक्रिय','Logged Out':'लॉग आउट','Mismatch':'बेमेल','Available':'उपलब्ध','Locked':'लॉक','Unlocked':'अनलॉक',
    'Partial':'आंशिक','Done':'पूर्ण','Failed':'असफल','Draft':'ड्राफ्ट',
    /* Dashboard */
    'Recent Activity':'हाल की गतिविधि','Total Vehicles':'कुल वाहन','Pending Unload':'लंबित अनलोड',
    'Today Putaway':'आज का पुटअवे','Today PIV':'आज का PIV','Occupied Racks':'भरे रैक','Empty Racks':'खाली रैक',
    'Posted GRN':'पोस्टेड GRN','Pending Approval':'लंबित अनुमोदन','Loaded Vehicles':'लोडेड वाहन',
    'No activity yet':'अभी कोई गतिविधि नहीं','No pending vehicles':'कोई लंबित वाहन नहीं',
    /* Language/Settings/Help */
    'Language Settings':'भाषा सेटिंग्स','Choose display language for the application.':'ऐप की प्रदर्शन भाषा चुनें।',
    'Language changed':'भाषा बदल गई','Help & Shortcuts':'सहायता और शॉर्टकट','Global Search':'ग्लोबल सर्च',
    'Sidebar':'साइडबार','Density':'डेंसिटी','Support':'सहयोग',
    /* Scanner */
    'Scan Code':'कोड स्कैन करें','Camera':'कैमरा','Device':'डिवाइस',
    'Hold the barcode in front of the camera.':'बारकोड को कैमरे के सामने रखें।',
    /* Misc */
    'Loading...':'लोड हो रहा है...','Access Denied!':'प्रवेश अस्वीकृत!',
    'Invalid username or password':'अमान्य यूज़रनेम या पासवर्ड','Logged out successfully':'सफलतापूर्वक लॉग आउट',
    'Module coming soon...':'मॉड्यूल जल्द आ रहा है...','PIV — Pick & Issue Verification':'PIV — पिक एवं इशू सत्यापन',
    'Reports & Analytics':'रिपोर्ट्स और विश्लेषण','System Settings':'सिस्टम सेटिंग्स',
    /* Page descriptions (main pages) */
    'Warehouse overview — inventory, inbound, picking and loading at a glance.':'वेयरहाउस का अवलोकन — इन्वेंटरी, इनबाउंड, पिकिंग और लोडिंग एक नज़र में।',
    'Register vehicles reporting at the security gate.':'सुरक्षा गेट पर आए वाहनों का विवरण दर्ज करें।',
    'Vehicles waiting to be assigned for unloading.':'अनलोडिंग के लिए प्रतीक्षारत वाहन।',
    'Scan EAN / material codes and verify quantities against invoices.':'EAN / मटेरियल कोड स्कैन करें और इनवॉइस से मात्रा मिलाएं।',
    'Complete record of inbound transactions.':'इनबाउंड ट्रांज़ैक्शन का पूरा रिकॉर्ड।',
    'Location master — stock, capacity and utilization.':'लोकेशन मास्टर — स्टॉक, क्षमता और उपयोग।',
    'Material master records and EAN catalog.':'मटेरियल मास्टर रिकॉर्ड और EAN सूची।',
    'Create or import OBD orders for picking.':'पिकिंग के लिए OBD ऑर्डर बनाएं या इंपोर्ट करें।',
    'Assign pickers to outbound delivery tasks.':'आउटबाउंड डिलीवरी कार्य पिकर को असाइन करें।',
    'Pick materials against assigned OBDs.':'असाइन किए गए OBD के अनुसार मटेरियल पिक करें।',
    'Review loading mismatches and approvals.':'लोडिंग बेमेल और अनुमोदन की समीक्षा करें।',
    'Operational, inventory and user reports.':'परिचालन, इन्वेंटरी और यूज़र रिपोर्ट।'
  },

  /* ================= MARATHI ================= */
  mr: {
    'Dashboard':'डॅशबोर्ड','Inbound':'इनबाउंड','Warehouse':'गोदाम','Master Data':'मास्टर डेटा',
    'Outbound':'आउटबाउंड','Insights':'विश्लेषण','Administration':'प्रशासन',
    'Vehicle Entry':'वाहन प्रवेश','Unloading Pending':'अनलोडिंग प्रलंबित','Goods Receipt / Unloading':'गुड्स रिसीव्ह / अनलोडिंग',
    'Posting Pending':'पोस्टिंग प्रलंबित','Inbound History':'इनबाउंड इतिहास','Unloading Stock':'अनलोडिंग स्टॉक',
    'Putaway':'पुटअवे','Storage Locations':'साठा ठिकाणे','Storage Bins':'साठा बिन','Materials':'साहित्य',
    'Picking':'पिकिंग','Outbound Deliveries (OBD)':'आउटबाउंड डिलिव्हरी (OBD)','Assign Picking':'पिकिंग सोपा',
    'Execute Picking':'पिकिंग कार्यान्वित करा','Picking Records':'पिकिंग रेकॉर्ड','Pick & Load':'पिक आणि लोड',
    'Loading':'लोडिंग','Assign Loading':'लोडिंग सोपा','Execute Loading':'लोडिंग कार्यान्वित करा',
    'Loading Records':'लोडिंग रेकॉर्ड','Quantity Differences':'प्रमाण फरक','Reports':'अहवाल',
    'User Working Time':'वापरकर्ता कामाची वेळ','Audit Log':'ऑडिट लॉग','User Management':'वापरकर्ता व्यवस्थापन','Settings':'सेटिंग्ज',
    'Overview':'आढावा','Inbound Process':'इनबाउंड प्रक्रिया','Create Vehicle Entry':'वाहन एंट्री तयार करा',
    'Pending Vehicles':'प्रलंबित वाहने','Inbound Records':'इनबाउंड रेकॉर्ड','Outbound Picking':'आउटबाउंड पिकिंग',
    'Outbound Loading':'आउटबाउंड लोडिंग','User Activity Log':'वापरकर्ता क्रियाकलाप लॉग','Reports / Analytics':'अहवाल / विश्लेषण',
    'Create Outbound Delivery':'आउटबाउंड डिलिव्हरी तयार करा','Assign Picking Tasks':'पिकिंग कामे सोपा',
    'Picking with Loading':'लोडिंगसह पिकिंग','Assign Loading Tasks':'लोडिंग कामे सोपा',
    'Security Gate Entry':'सुरक्षा गेट एंट्री','Vehicle Reporting':'वाहन रिपोर्टिंग',
    'Home':'होम','Notifications':'सूचना','Clear All':'सर्व साफ़ करा','Profile':'प्रोफाइल',
    'Change Password':'पासवर्ड बदला','Logout':'लॉगआउट','Language':'भाषा','Refresh':'रिफ्रेश','Print':'प्रिंट',
    'Help':'मदत','More':'अधिक','All Modules':'सर्व मॉड्यूल',
    'Search material, EAN, OBD, vehicle, invoice...':'साहित्य, EAN, OBD, वाहन, बिल शोधा...',
    'Username':'वापरकर्तानाव','Password':'पासवर्ड','Enter username':'वापरकर्तानाव टाका','Enter password':'पासवर्ड टाका',
    'Sign In':'साइन इन','Warehouse Management System':'गोदाम व्यवस्थापन प्रणाली',
    'Secured Enterprise Access Portal':'सुरक्षित एंटरप्राइझ प्रवेश पोर्टल',
    'Save':'जतन करा','Cancel':'रद्द करा','Search':'शोधा','Clear':'साफ़ करा','Close':'बंद करा','Submit':'सबमिट करा',
    'Approve':'मंजूर करा','Reject':'नाकारा','Edit':'संपादित करा','Delete':'हटवा','View':'पहा','Add':'जोडा',
    'Update':'अपडेट करा','Assign':'सोपा','Scan':'स्कॅन करा','Upload':'अपलोड करा','Download':'डाउनलोड करा',
    'Start':'सुरू करा','Complete':'पूर्ण करा','Export':'निर्यात','Import':'आयात','Filters':'फिल्टर',
    'Yes':'होय','No':'नाही','OK':'ठीक','Confirm':'पुष्टी करा','Back':'मागे','Apply':'लागू करा','Reset':'रीसेट',
    'Select':'निवडा','All':'सर्व','Reason':'कारण','Remarks':'टिप्पणी',
    'Status':'स्थिती','Date':'दिनांक','Time':'वेळ','Actions':'कृती','Action':'कृती','User':'वापरकर्ता','Module':'मॉड्यूल',
    'Vehicle':'वाहन','Transport':'वाहतूक','LR No':'LR क्र.','LR Number':'LR क्रमांक','Invoice No.':'बिल क्र.',
    'Invoice No':'बिल क्र.','Material':'साहित्य','Description':'तपशील','Quantity':'प्रमाण','Location':'ठिकाण',
    'Picker':'पिकर','Customer':'ग्राहक','Order Qty':'ऑर्डर प्रमाण','Picked Qty':'पिक प्रमाण','Required Qty':'आवश्यक प्रमाण',
    'Scanned Qty':'स्कॅन प्रमाण','Available Qty':'उपलब्ध प्रमाण','Difference':'फरक','Created Date':'निर्मिती दिनांक',
    'Vehicle No.':'वाहन क्र.','Vehicle Number':'वाहन क्रमांक','Driver Name':'चालकाचे नाव','Driver Mobile':'चालक मोबाइल',
    'Transporter Name':'वाहतूकदाराचे नाव','Reporting Time':'रिपोर्टिंग वेळ','Entry By':'प्रवेशकर्ता',
    'Vehicle Type':'वाहन प्रकार','UNLOADING':'अनलोडिंग','LOADING':'लोडिंग','Rack':'रॅक','Bin':'बिन',
    'Capacity':'क्षमता','Utilization':'वापर','Role':'भूमिका','Login Time':'लॉगिन वेळ','Logout Time':'लॉगआउट वेळ','Duration':'कालावधी',
    'Pending':'प्रलंबित','Completed':'पूर्ण','In Progress':'प्रगतीत','Approved':'मंजूर','Rejected':'नाकारले',
    'Cancelled':'रद्द','Assigned':'सोपले','Posted':'पोस्ट झाले','Unloaded':'अनलोड झाले','Loaded':'लोड झाले',
    'Unload Pending':'अनलोड प्रलंबित','Loading Done':'लोडिंग पूर्ण','Posting Pending Approval':'पोस्टिंग मंजुरी प्रलंबित',
    'Active':'सक्रिय','Logged Out':'लॉग आउट','Mismatch':'तफावत','Available':'उपलब्ध','Locked':'लॉक','Unlocked':'अनलॉक',
    'Partial':'अंशतः','Done':'पूर्ण','Failed':'अयशस्वी','Draft':'मसुदा',
    'Recent Activity':'अलीकडील क्रियाकलाप','Total Vehicles':'एकूण वाहने','Pending Unload':'प्रलंबित अनलोड',
    'Today Putaway':'आजचे पुटअवे','Today PIV':'आजचे PIV','Occupied Racks':'वापरलेले रॅक','Empty Racks':'रिकामे रॅक',
    'Posted GRN':'पोस्टेड GRN','Pending Approval':'प्रलंबित मंजुरी','Loaded Vehicles':'लोडेड वाहने',
    'No activity yet':'अजून क्रियाकलाप नाही','No pending vehicles':'प्रलंबित वाहने नाहीत',
    'Language Settings':'भाषा सेटिंग्ज','Choose display language for the application.':'अ‍ॅपची दिसण्याची भाषा निवडा.',
    'Language changed':'भाषा बदलली','Help & Shortcuts':'मदत आणि शॉर्टकट','Global Search':'ग्लोबल शोध',
    'Sidebar':'साइडबार','Density':'घनता','Support':'सहाय्य',
    'Scan Code':'कोड स्कॅन करा','Camera':'कॅमेरा','Device':'डिव्हाइस',
    'Hold the barcode in front of the camera.':'बारकोड कॅमेऱ्यासमोर धरा.',
    'Loading...':'लोड होत आहे...','Access Denied!':'प्रवेश नाकारला!',
    'Invalid username or password':'अवैध वापरकर्तानाव किंवा पासवर्ड','Logged out successfully':'यशस्वीरित्या लॉग आउट',
    'Module coming soon...':'मॉड्यूल लवकरच येत आहे...','PIV — Pick & Issue Verification':'PIV — पिक व इशू पडताळणी',
    'Reports & Analytics':'अहवाल व विश्लेषण','System Settings':'सिस्टम सेटिंग्ज',
    'Warehouse overview — inventory, inbound, picking and loading at a glance.':'गोदामाचे एकूण चित्र — साठा, इनबाउंड, पिकिंग आणि लोडिंग एका दृष्टीत.',
    'Register vehicles reporting at the security gate.':'सुरक्षा गेटवर आलेल्या वाहनांची नोंद करा.',
    'Vehicles waiting to be assigned for unloading.':'अनलोडिंगसाठी वाट पाहत असलेली वाहने.',
    'Scan EAN / material codes and verify quantities against invoices.':'EAN / साहित्य कोड स्कॅन करा आणि बिलाशी प्रमाण तपासा.',
    'Complete record of inbound transactions.':'इनबाउंड व्यवहारांचा संपूर्ण रेकॉर्ड.',
    'Location master — stock, capacity and utilization.':'ठिकाण मास्टर — साठा, क्षमता आणि वापर.',
    'Material master records and EAN catalog.':'साहित्य मास्टर रेकॉर्ड आणि EAN यादी.',
    'Create or import OBD orders for picking.':'पिकिंगसाठी OBD ऑर्डर तयार करा किंवा आयात करा.',
    'Assign pickers to outbound delivery tasks.':'आउटबाउंड डिलिव्हरी कामे पिकरना सोपा.',
    'Pick materials against assigned OBDs.':'सोपलेल्या OBD नुसार साहित्य पिक करा.',
    'Review loading mismatches and approvals.':'लोडिंग तफावत आणि मंजुरींचे पुनरावलोकन करा.',
    'Operational, inventory and user reports.':'ऑपरेशनल, साठा आणि वापरकर्ता अहवाल.'
  },

  /* ================= GUJARATI ================= */
  gu: {
    'Dashboard':'ડેશબોર્ડ','Inbound':'ઇનબાઉન્ડ','Warehouse':'વેરહાઉસ','Master Data':'માસ્ટર ડેટા',
    'Outbound':'આઉટબાઉન્ડ','Insights':'વિશ્લેષણ','Administration':'વહીવટ',
    'Vehicle Entry':'વાહન પ્રવેશ','Unloading Pending':'અનલોડિંગ બાકી','Goods Receipt / Unloading':'ગુડ્સ રીસીવ / અનલોડિંગ',
    'Posting Pending':'પોસ્ટિંગ બાકી','Inbound History':'ઇનબાઉન્ડ ઇતિહાસ','Unloading Stock':'અનલોડિંગ સ્ટોક',
    'Putaway':'પુટઅવે','Storage Locations':'સ્ટોરેજ લોકેશન','Storage Bins':'સ્ટોરેજ બિન','Materials':'સામગ્રી',
    'Picking':'પિકિંગ','Outbound Deliveries (OBD)':'આઉટબાઉન્ડ ડિલિવરી (OBD)','Assign Picking':'પિકિંગ સોંપો',
    'Execute Picking':'પિકિંગ અમલ કરો','Picking Records':'પિકિંગ રેકોર્ડ','Pick & Load':'પિક અને લોડ',
    'Loading':'લોડિંગ','Assign Loading':'લોડિંગ સોંપો','Execute Loading':'લોડિંગ અમલ કરો',
    'Loading Records':'લોડિંગ રેકોર્ડ','Quantity Differences':'જથ્થા તફાવત','Reports':'રિપોર્ટ',
    'User Working Time':'વપરાશકર્તા કાર્ય સમય','Audit Log':'ઓડિટ લોગ','User Management':'વપરાશકર્તા મેનેજમેન્ટ','Settings':'સેટિંગ્સ',
    'Overview':'ઝાંખી','Inbound Process':'ઇનબાઉન્ડ પ્રક્રિયા','Create Vehicle Entry':'વાહન એન્ટ્રી બનાવો',
    'Pending Vehicles':'બાકી વાહનો','Inbound Records':'ઇનબાઉન્ડ રેકોર્ડ','Outbound Picking':'આઉટબાઉન્ડ પિકિંગ',
    'Outbound Loading':'આઉટબાઉન્ડ લોડિંગ','User Activity Log':'વપરાશકર્તા પ્રવૃત્તિ લોગ','Reports / Analytics':'રિપોર્ટ / વિશ્લેષણ',
    'Create Outbound Delivery':'આઉટબાઉન્ડ ડિલિવરી બનાવો','Assign Picking Tasks':'પિકિંગ કામ સોંપો',
    'Picking with Loading':'લોડિંગ સાથે પિકિંગ','Assign Loading Tasks':'લોડિંગ કામ સોંપો',
    'Security Gate Entry':'સુરક્ષા ગેટ એન્ટ્રી','Vehicle Reporting':'વાહન રિપોર્ટિંગ',
    'Home':'હોમ','Notifications':'સૂચનાઓ','Clear All':'બધું સાફ કરો','Profile':'પ્રોફાઇલ',
    'Change Password':'પાસવર્ડ બદલો','Logout':'લોગઆઉટ','Language':'ભાષા','Refresh':'રિફ્રેશ','Print':'પ્રિન્ટ',
    'Help':'સહાય','More':'વધુ','All Modules':'બધા મોડ્યુલ',
    'Search material, EAN, OBD, vehicle, invoice...':'સામગ્રી, EAN, OBD, વાહન, ઇન્વોઇસ શોધો...',
    'Username':'વપરાશકર્તા નામ','Password':'પાસવર્ડ','Enter username':'વપરાશકર્તા નામ લખો','Enter password':'પાસવર્ડ લખો',
    'Sign In':'સાઇન ઇન','Warehouse Management System':'વેરહાઉસ મેનેજમેન્ટ સિસ્ટમ',
    'Secured Enterprise Access Portal':'સુરક્ષિત એન્ટરપ્રાઇઝ એક્સેસ પોર્ટલ',
    'Save':'સાચવો','Cancel':'રદ કરો','Search':'શોધો','Clear':'સાફ કરો','Close':'બંધ કરો','Submit':'સબમિટ કરો',
    'Approve':'મંજૂર કરો','Reject':'નકારો','Edit':'સંપાદિત કરો','Delete':'કાઢી નાખો','View':'જુઓ','Add':'ઉમેરો',
    'Update':'અપડેટ કરો','Assign':'સોંપો','Scan':'સ્કેન કરો','Upload':'અપલોડ કરો','Download':'ડાઉનલોડ કરો',
    'Start':'શરૂ કરો','Complete':'પૂર્ણ કરો','Export':'એક્સપોર્ટ','Import':'ઇમ્પોર્ટ','Filters':'ફિલ્ટર',
    'Yes':'હા','No':'ના','OK':'ઠીક','Confirm':'પુષ્ટિ કરો','Back':'પાછળ','Apply':'લાગુ કરો','Reset':'રીસેટ',
    'Select':'પસંદ કરો','All':'બધા','Reason':'કારણ','Remarks':'નોંધ',
    'Status':'સ્થિતિ','Date':'તારીખ','Time':'સમય','Actions':'ક્રિયા','Action':'ક્રિયા','User':'વપરાશકર્તા','Module':'મોડ્યુલ',
    'Vehicle':'વાહન','Transport':'પરિવહન','LR No':'LR નં.','LR Number':'LR નંબર','Invoice No.':'ઇન્વોઇસ નં.',
    'Invoice No':'ઇન્વોઇસ નં.','Material':'સામગ્રી','Description':'વર્ણન','Quantity':'જથ્થો','Location':'લોકેશન',
    'Picker':'પિકર','Customer':'ગ્રાહક','Order Qty':'ઓર્ડર જથ્થો','Picked Qty':'પિક જથ્થો','Required Qty':'જરૂરી જથ્થો',
    'Scanned Qty':'સ્કેન જથ્થો','Available Qty':'ઉપલબ્ધ જથ્થો','Difference':'તફાવત','Created Date':'બનાવ્યાની તારીખ',
    'Vehicle No.':'વાહન નં.','Vehicle Number':'વાહન નંબર','Driver Name':'ડ્રાઇવરનું નામ','Driver Mobile':'ડ્રાઇવર મોબાઇલ',
    'Transporter Name':'ટ્રાન્સપોર્ટરનું નામ','Reporting Time':'રિપોર્ટિંગ સમય','Entry By':'પ્રવેશકર્તા',
    'Vehicle Type':'વાહન પ્રકાર','UNLOADING':'અનલોડિંગ','LOADING':'લોડિંગ','Rack':'રેક','Bin':'બિન',
    'Capacity':'ક્ષમતા','Utilization':'ઉપયોગ','Role':'ભૂમિકા','Login Time':'લોગિન સમય','Logout Time':'લોગઆઉટ સમય','Duration':'સમયગાળો',
    'Pending':'બાકી','Completed':'પૂર્ણ','In Progress':'પ્રગતિમાં','Approved':'મંજૂર','Rejected':'નકારેલ',
    'Cancelled':'રદ','Assigned':'સોંપેલ','Posted':'પોસ્ટ થયું','Unloaded':'અનલોડ થયું','Loaded':'લોડ થયું',
    'Unload Pending':'અનલોડ બાકી','Loading Done':'લોડિંગ પૂર્ણ','Posting Pending Approval':'પોસ્ટિંગ મંજૂરી બાકી',
    'Active':'સક્રિય','Logged Out':'લોગ આઉટ','Mismatch':'તફાવત','Available':'ઉપલબ્ધ','Locked':'લોક','Unlocked':'અનલોક',
    'Partial':'આંશિક','Done':'પૂર્ણ','Failed':'નિષ્ફળ','Draft':'ડ્રાફ્ટ',
    'Recent Activity':'તાજી પ્રવૃત્તિ','Total Vehicles':'કુલ વાહનો','Pending Unload':'બાકી અનલોડ',
    'Today Putaway':'આજનું પુટઅવે','Today PIV':'આજનું PIV','Occupied Racks':'ભરેલા રેક','Empty Racks':'ખાલી રેક',
    'Posted GRN':'પોસ્ટેડ GRN','Pending Approval':'બાકી મંજૂરી','Loaded Vehicles':'લોડેડ વાહનો',
    'No activity yet':'હજુ કોઈ પ્રવૃત્તિ નથી','No pending vehicles':'કોઈ બાકી વાહન નથી',
    'Language Settings':'ભાષા સેટિંગ્સ','Choose display language for the application.':'એપ્લિકેશનની ડિસ્પ્લે ભાષા પસંદ કરો.',
    'Language changed':'ભાષા બદલાઈ','Help & Shortcuts':'સહાય અને શોર્ટકટ','Global Search':'ગ્લોબલ સર્ચ',
    'Sidebar':'સાઇડબાર','Density':'ઘનતા','Support':'સપોર્ટ',
    'Scan Code':'કોડ સ્કેન કરો','Camera':'કેમેરા','Device':'ડિવાઇસ',
    'Hold the barcode in front of the camera.':'બારકોડ કેમેરા સામે રાખો.',
    'Loading...':'લોડ થઈ રહ્યું છે...','Access Denied!':'પ્રવેશ નકારેલ!',
    'Invalid username or password':'ખોટું વપરાશકર્તા નામ અથવા પાસવર્ડ','Logged out successfully':'સફળતાપૂર્વક લોગ આઉટ',
    'Module coming soon...':'મોડ્યુલ ટૂંક સમયમાં...','PIV — Pick & Issue Verification':'PIV — પિક અને ઇશુ ચકાસણી',
    'Reports & Analytics':'રિપોર્ટ અને વિશ્લેષણ','System Settings':'સિસ્ટમ સેટિંગ્સ',
    'Warehouse overview — inventory, inbound, picking and loading at a glance.':'વેરહાઉસની ઝાંખી — ઇન્વેન્ટરી, ઇનબાઉન્ડ, પિકિંગ અને લોડિંગ એક નજરમાં.',
    'Register vehicles reporting at the security gate.':'સુરક્ષા ગેટ પર આવેલા વાહનોની નોંધણી કરો.',
    'Vehicles waiting to be assigned for unloading.':'અનલોડિંગ માટે રાહ જોતા વાહનો.',
    'Scan EAN / material codes and verify quantities against invoices.':'EAN / સામગ્રી કોડ સ્કેન કરો અને ઇન્વોઇસ સાથે જથ્થો ચકાસો.',
    'Complete record of inbound transactions.':'ઇનબાઉન્ડ ટ્રાન્ઝેક્શનનો સંપૂર્ણ રેકોર્ડ.',
    'Location master — stock, capacity and utilization.':'લોકેશન માસ્ટર — સ્ટોક, ક્ષમતા અને ઉપયોગ.',
    'Material master records and EAN catalog.':'સામગ્રી માસ્ટર રેકોર્ડ અને EAN યાદી.',
    'Create or import OBD orders for picking.':'પિકિંગ માટે OBD ઓર્ડર બનાવો અથવા ઇમ્પોર્ટ કરો.',
    'Assign pickers to outbound delivery tasks.':'આઉટબાઉન્ડ ડિલિવરી કામ પિકરને સોંપો.',
    'Pick materials against assigned OBDs.':'સોંપેલ OBD મુજબ સામગ્રી પિક કરો.',
    'Review loading mismatches and approvals.':'લોડિંગ તફાવત અને મંજૂરીઓની સમીક્ષા કરો.',
    'Operational, inventory and user reports.':'ઓપરેશનલ, ઇન્વેન્ટરી અને વપરાશકર્તા રિપોર્ટ.'
  }
  };

  /* ---------- CORE ---------- */
  var cur = 'en';
  try { cur = localStorage.getItem('wms_lang') || 'en'; if (!LANGS[cur]) cur = 'en'; } catch (e) {}

  function t(s) { return (cur !== 'en' && DICT[cur] && DICT[cur][s]) ? DICT[cur][s] : s; }
  window.t = t;
  window.getLang = function () { return cur; };

  /* ---------- TRANSLATION ENGINE (text nodes + placeholders) ---------- */
  function translateTree(root) {
    if (!root || cur === 'en') return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false), n, v, tr;
    while ((n = w.nextNode())) {
      v = n.nodeValue; if (!v) continue;
      var key = v.trim(); if (!key) continue;
      tr = t(key);
      if (tr !== key) n.nodeValue = v.replace(key, tr);
    }
    if (root.querySelectorAll) {
      var ph = root.querySelectorAll('[placeholder]');
      for (var i = 0; i < ph.length; i++) {
        var p = ph[i].getAttribute('placeholder'), tp = t(p);
        if (tp !== p) ph[i].setAttribute('placeholder', tp);
      }
    }
  }

  var CONTAINERS = ['loginPage','sidebarNav','shellBar','notifPanel','modalContainer','scannerModal',
                    'toastContainer','bottomNav','morePanel','contentArea','userDropdown'];
  function applyAll() {
    if (cur === 'en') return;
    applying = true;
    for (var i = 0; i < CONTAINERS.length; i++) {
      var el = document.getElementById(CONTAINERS[i]);
      if (el) translateTree(el);
    }
    applying = false;
  }
  window.applyLang = applyAll;

  /* Auto-translate: jab bhi UI re-render ho, turant translate */
  var applying = false, pend = null;
  new MutationObserver(function () {
    if (applying) return;
    clearTimeout(pend);
    pend = setTimeout(applyAll, 80);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  /* ---------- LANGUAGE PICKER MODAL ---------- */
  window.openLanguagePicker = function () {
    var h = '<div style="display:grid;gap:8px">';
    Object.keys(LANGS).forEach(function (code) {
      h += '<button class="btn ' + (code === cur ? 'btn-primary' : 'btn-secondary') + '"' +
           ' style="justify-content:flex-start;height:44px;font-size:14px"' +
           ' onclick="setLang(\'' + code + '\')">' +
           '<span style="font-size:18px">' + LANGS[code].flag + '</span>' +
           '<span style="font-weight:700">' + LANGS[code].native + '</span>' +
           '<span style="margin-left:auto;font-size:11px;color:var(--text-muted)">' + LANGS[code].name + '</span></button>';
    });
    h += '</div>';
    showModal('🌐 ' + t('Language'), h, 'sm',
      '<button class="btn btn-secondary" onclick="closeModal()">' + t('Close') + '</button>');
  };

  /* ---------- SET LANGUAGE (save + full re-render) ---------- */
  window.setLang = function (code) {
    if (!LANGS[code]) return;
    cur = code;
    try { localStorage.setItem('wms_lang', code); } catch (e) {}
    document.documentElement.setAttribute('lang', code);

    if (window.APP && APP.currentUser) {
      if (typeof renderSidebar === 'function') renderSidebar();
      if (typeof navTo === 'function' && APP.currentSection) {
        navTo(APP.currentSection, APP.currentSub);
      }
    }
    closeModal();
    setTimeout(applyAll, 50);
    var ls = document.getElementById('loginLangSelect');
    if (ls) ls.value = code;
    showToast(t('Language changed') + ': ' + LANGS[code].native, 'success');
  };

  /* ---------- USER DROPDOWN mein "Language" item ---------- */
  (function () {
    var dd = document.getElementById('userDropdown');
    if (!dd || document.getElementById('ddLanguage')) return;
    var a = document.createElement('a');
    a.href = '#'; a.id = 'ddLanguage';
    a.innerHTML = '<i class="bx bx-globe"></i> ' + t('Language');
    a.addEventListener('click', function (e) { e.preventDefault(); openLanguagePicker(); });
    var hr = dd.querySelector('hr');
    dd.insertBefore(a, hr || null);
  })();

  /* ---------- LOGIN PAGE selector ---------- */
  (function () {
    var card = document.querySelector('#loginPage .login-card');
    if (!card || document.getElementById('loginLangWrap')) return;
    var opts = '';
    Object.keys(LANGS).forEach(function (code) {
      opts += '<option value="' + code + '"' + (code === cur ? ' selected' : '') + '>' +
              LANGS[code].flag + ' ' + LANGS[code].native + '</option>';
    });
    var wrap = document.createElement('div');
    wrap.id = 'loginLangWrap';
    wrap.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-bottom:12px;font-size:11px;color:var(--text-muted)';
    wrap.innerHTML = '<i class="bx bx-globe"></i><select id="loginLangSelect" style="padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:#fff;font-size:12px;cursor:pointer">' + opts + '</select>';
    var form = card.querySelector('form');
    card.insertBefore(wrap, form || card.firstChild.nextSibling);
    wrap.querySelector('select').addEventListener('change', function () { setLang(this.value); });
  })();

  /* ---------- SETTINGS PAGE mein Language card (auto-inject) ---------- */
  function injectLangCard() {
    var host = document.getElementById('sec-content');
    if (!host || document.getElementById('langSettingsCard')) return;
    var btns = '';
    Object.keys(LANGS).forEach(function (code) {
      btns += '<button class="btn ' + (code === cur ? 'btn-primary' : 'btn-secondary') + '"' +
              ' onclick="setLang(\'' + code + '\')">' +
              LANGS[code].flag + ' ' + LANGS[code].native + '</button>';
    });
    host.insertAdjacentHTML('afterbegin',
      '<div class="card" id="langSettingsCard" style="margin-bottom:14px">' +
      '<div class="card-title"><i class="bx bx-globe"></i> ' + t('Language Settings') + '</div>' +
      '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">' + t('Choose display language for the application.') + '</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + btns + '</div></div>');
  }
  if (typeof window.renderSettings === 'function') {
    var _rs = window.renderSettings;
    window.renderSettings = function () { _rs(); setTimeout(injectLangCard, 30); };
  }

  /* ---------- INITIAL ---------- */
  document.documentElement.setAttribute('lang', cur);
  if (cur !== 'en') setTimeout(applyAll, 100);
})();