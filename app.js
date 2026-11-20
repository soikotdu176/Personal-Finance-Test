/* ==========================================================================
   Personal Finance - Personal Assets & Liabilities Management System
   Vanilla JS · IndexedDB (AssetBookDB) · Chart.js · JSZip · SheetJS · jsPDF
   Data safety rules enforced here:
     - a new release never deletes local data (see checkDataVersion)
     - PDF blobs live in their own store, so start-up never loads megabytes of PDFs
   ========================================================================== */

const DB_NAME = 'AssetBookDB';
const DB_VERSION = 4;                       // v4: migration history batches (migrationId on imported rows)
const APP_VERSION = '2026-11-20-v8';
const DATA_VERSION_KEY = 'assetbook-data-version';
let db;
let state = { records: [], categories: [], documents: [], settings: {}, backupHistory: [], incomeExpenses: [], incomeGroups: [], migrationHistory: [] };
let charts = {};
let editingRecordId = null;
let savingRecord = false;
let confirmAction = null;
let restoreFile = null;
let dashboardPage = 1;
let replacingDocumentId = null;
let currentPage = 'dashboard';
let deferredInstallPrompt = null;
let editingIncomeId = null;
let savingIncome = false;
let incomePage = 1;
let incomeTab = 'transactions';
const incomeFilters = { search: '', year: '', month: '', type: '', majorHead: '', category: '', subcategory: '' };
const incomeDocDraft = { existing: [], removed: new Set(), replaced: new Map(), added: [] };

const defaultCategories = [
  {id:'c-cash',type:'Asset',name:'Cash',subcategories:['Savings Accounts','Cash in Hand']},
  {id:'c-investments',type:'Asset',name:'Investments',subcategories:['CPF','Group Insurance & Welfare Fund (GI&WF)','Other Investment / Co-operation']},
  {id:'c-property',type:'Asset',name:'Property',subcategories:['Land & Primary Residence','Vehicles','Jewelry','Other Property']},
  {id:'c-retirement',type:'Asset',name:'Retirement',subcategories:['Gratuity']},
  {id:'c-other-assets',type:'Asset',name:'Other Assets',subcategories:['Furniture, Electronics & Equipments','Accounts Receivable']},
  {id:'c-payable',type:'Liability',name:'Accounts Payable',subcategories:['Accounts Payable']},
  {id:'c-bank-loan',type:'Liability',name:'Bank Loan',subcategories:['Bank Loan']},
  {id:'c-other-liabilities',type:'Liability',name:'Other Liabilities',subcategories:['Other Liabilities']}
];

/* Master Income / Expense classification tree (mapped to "Income & Expenses.xlsx"). */
const defaultIncomeGroups = [
  {id:'ig-salary',type:'Income',majorHead:'Income From Salary (PGCL)',categories:[
    {name:'Salary & Bonuses',subcategories:['Basic and Allowances','Incentive Bonus','Profit Bonus','LFA','Festival Bonus','Ex-gratia']}
  ]},
  {id:'ig-other-receive',type:'Income',majorHead:'Income From Other Receive (PGCL)',categories:[
    {name:'Allowances & Other Receives',subcategories:['Lunch Subsidy','Leverage','TA+DA','Training Allowance','Honorarium','Previous Year Profit Bonus']}
  ]},
  {id:'ig-other-income',type:'Income',majorHead:'Other Income',categories:[
    {name:'General Income',subcategories:['Bank Interest / Profit','Gift / Refund','Other Income']}
  ]},
  {id:'ig-food',type:'Expense',majorHead:'Expenses for Food, Clothing and Other Essentials',categories:[
    {name:'Food',subcategories:['Grocery items','Snacks items','Dining/Eating Out','Mess']},
    {name:'Clothing',subcategories:['Own','Spouse','Family','Offspring','Laundry']},
    {name:'Personal Supplies',subcategories:['Own','Spouse','Offspring','Family']},
    {name:'Medicine & Doctor',subcategories:['Own','Spouse','Offspring','Family']},
    {name:'Pocket Money',subcategories:['Spouse','Offspring','Family']},
    {name:'Contribution For Family',subcategories:['Regular']}
  ]},
  {id:'ig-accommodation',type:'Expense',majorHead:'Accommodation Expense',categories:[
    {name:'Accommodation',subcategories:['Household Rent']}
  ]},
  {id:'ig-auto',type:'Expense',majorHead:'Auto and Transportation Expenses',categories:[
    {name:'Fuel and Maintenance',subcategories:['Fuel and Maintenance']},
    {name:'Other Transportation',subcategories:['Auto','Bus','Train','Others']}
  ]},
  {id:'ig-utility',type:'Expense',majorHead:'Household and Utility Expenses',categories:[
    {name:'Utilities & Home Support',subcategories:['Electricity','Gas, Water, Sewer and Garbage','Phone, Internet, TV channels and Subscription','Home-Support Staff and Other Expenses']}
  ]},
  {id:'ig-education',type:'Expense',majorHead:'Education Expenses',categories:[
    {name:'Education',subcategories:['Education Expenses']}
  ]},
  {id:'ig-festival',type:'Expense',majorHead:'Festival And Other Special Expenses',categories:[
    {name:'Special & Events',subcategories:['Festival, Party, Events','Domestic and Overseas Tour, Holiday, Etc.','Philanthropy, Etc','Other Special Expenses']}
  ]},
  {id:'ig-misc',type:'Expense',majorHead:'Any Other Expenses',categories:[
    {name:'Miscellaneous',subcategories:['Any Other Expenses']}
  ]},
  {id:'ig-tax',type:'Expense',majorHead:'Tax, Charges, Etc. Paid',categories:[
    {name:'Tax & Surcharge',subcategories:['Payment of Tax at Source & Advance Tax','Payment of Tax, Surcharge or Other Amounts']}
  ]},
  {id:'ig-loss',type:'Expense',majorHead:'Loss, Deduction, Other Expense',categories:[
    {name:'Special Contribution For Family',subcategories:['Small Amount','Big Amount','Spouse','Offspring']},
    {name:'Office Purchase & Bill',subcategories:['Office Purchase','Bill Received','Personal Print']}
  ]}
];

/* Payment methods offered by the Add / Edit form and recognised by imports. */
const ACCOUNTS = ['Cash in Hand','bKash','Basic Bank Limited','Card','Other'];

/* Workbooks kept in the local Project/ folder. They are loaded once into an empty
   database (same pipeline as Settings -> Import) so the Dashboard shows the complete
   finances on first launch. Existing local data is never replaced. */
const PROJECT_DATASET = [
  'Project/Assets & Liabilities.xlsx',
  'Project/Income & Expenses.xlsx',
  'Project/budge-01-07-2026-31-07-2026_1795143633525.csv'
];
const PROJECT_DATASET_FLAG = 'assetbook-project-dataset';

/* ---------- IndexedDB helpers ---------- */
function openDB() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=event=>{
      const database=event.target.result;
      if(!database.objectStoreNames.contains('records')) database.createObjectStore('records',{keyPath:'id'});
      if(!database.objectStoreNames.contains('categories')) database.createObjectStore('categories',{keyPath:'id'});
      if(!database.objectStoreNames.contains('documents')) database.createObjectStore('documents',{keyPath:'id'});
      if(!database.objectStoreNames.contains('settings')) database.createObjectStore('settings',{keyPath:'key'});
      if(!database.objectStoreNames.contains('backupHistory')) database.createObjectStore('backupHistory',{keyPath:'id'});
      // v2: PDF bytes get their own store, so loading document metadata stays cheap.
      if(!database.objectStoreNames.contains('documentBlobs')) database.createObjectStore('documentBlobs',{keyPath:'id'});
      // v3: income & expense transactions and their editable classification tree.
      if(!database.objectStoreNames.contains('incomeExpenses')){
        const ie=database.createObjectStore('incomeExpenses',{keyPath:'id'});
        ['date','incomeYear','type','majorHead','category','importHash'].forEach(k=>ie.createIndex(k,k,{unique:false}));
      }
      if(!database.objectStoreNames.contains('incomeGroups')) database.createObjectStore('incomeGroups',{keyPath:'id'});
      // v4: migration batch metadata (Settings → Excel & Budge CSV Migration history).
      if(!database.objectStoreNames.contains('migrationHistory')) database.createObjectStore('migrationHistory',{keyPath:'id'});
      if(event.oldVersion<2&&event.target.transaction) migrateDocumentBlobs(event.target.transaction);
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>console.warn('Database upgrade is waiting for other tabs to close');
  });
}
/**
 * v1 -> v2 migration: copy documents[i].blob into "documentBlobs", then strip it from the metadata
 * record. The blob is only removed after the copy succeeded, so a failed copy keeps the original.
 */
function migrateDocumentBlobs(transaction){
  const documents=transaction.objectStore('documents');
  const blobs=transaction.objectStore('documentBlobs');
  const cursorRequest=documents.openCursor();
  cursorRequest.onsuccess=()=>{
    const cursor=cursorRequest.result;
    if(!cursor)return;
    const record=cursor.value;
    const next=()=>cursor.continue();
    if(!record||!record.blob){next();return}
    const copy=blobs.put({id:record.id,blob:record.blob});
    copy.onsuccess=()=>{
      const metadata=Object.assign({},record);
      delete metadata.blob;
      const strip=documents.put(metadata);
      strip.onsuccess=next;
      strip.onerror=next;
    };
    copy.onerror=next;                                  // keep the original blob for a later retry
  };
}

function tx(store,mode='readonly'){
  return db.transaction(store,mode).objectStore(store);
}
function getAll(store){
  return new Promise((resolve,reject)=>{
    const request=tx(store).getAll();
    request.onsuccess=()=>resolve(request.result||[]);
    request.onerror=()=>reject(request.error);
  });
}
function put(store,value){
  return new Promise((resolve,reject)=>{
    const request=tx(store,'readwrite').put(value);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
function putMany(store,items){
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(store,'readwrite');
    const objectStore=transaction.objectStore(store);
    items.forEach(item=>objectStore.put(item));
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });
}
function remove(store,key){
  return new Promise((resolve,reject)=>{
    const request=tx(store,'readwrite').delete(key);
    request.onsuccess=()=>resolve();
    request.onerror=()=>reject(request.error);
  });
}
function removeMany(store,keys){
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(store,'readwrite');
    const objectStore=transaction.objectStore(store);
    (keys||[]).forEach(key=>objectStore.delete(key));
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });
}
function getOne(store,key){
  return new Promise((resolve,reject)=>{
    const request=tx(store).get(key);
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error);
  });
}
/** Clears a store and writes the new contents in ONE transaction, so a failure never leaves it half empty. */
function replaceStore(store,items){
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(store,'readwrite');
    const objectStore=transaction.objectStore(store);
    objectStore.clear();
    (items||[]).forEach(item=>objectStore.put(item));
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error||new Error('Could not write to the database.'));
    transaction.onabort=()=>reject(transaction.error||new Error('The database rejected the write (is the disk full?).'));
  });
}
/** PDF bytes are loaded on demand only - they are never part of the in-memory state. */
async function getDocBlob(id){
  const stored=await getOne('documentBlobs',id).catch(()=>null);
  if(stored&&stored.blob)return stored.blob;
  // Fallback for a document whose v1 -> v2 copy failed: the bytes are still in "documents".
  const legacy=await getOne('documents',id).catch(()=>null);
  return legacy&&legacy.blob?legacy.blob:null;
}
/** Missing elements (e.g. a stale cached index.html) must never abort start-up. */
const $el=id=>document.getElementById(id)||document.createElement('div');
const uid=prefix=>`${prefix}-${crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(16).slice(2)}`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const pad2=n=>String(n).padStart(2,'0');
const reducedMotion=()=>window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function todayISO(){const d=new Date();return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`}
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso){
  const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m?`${m[3]} ${MONTHS[+m[2]-1]} ${m[1]}`:'';
}

/* ==========================================================================
   Bangladesh fiscal year helpers (Income Year: 1 July -> 30 June)
   ========================================================================== */
function parseIncomeYear(value){
  const s=String(value??'').trim();
  if(!s)return null;
  let m=s.match(/^(\d{4})\s*[-\u2013\u2014\/]\s*(\d{4}|\d{2})$/);
  if(m)return {start:+m[1],plain:false};
  m=s.match(/^(\d{4})$/);
  if(m)return {start:+m[1],plain:true};
  return null;
}
/** '2025-26' | '2025-2026' -> { from:'2025-07-01', to:'2026-06-30' } */
function fiscalRange(value){
  const p=parseIncomeYear(value);
  if(!p)return null;
  return {from:`${p.start}-07-01`,to:`${p.start+1}-06-30`};
}
/** Canonical label so '2025-2026' and '2025-26' compare equal. */
function normIncomeYear(value){
  const p=parseIncomeYear(value);
  if(!p||p.plain)return String(value??'').trim();
  return `${p.start}-${pad2((p.start+1)%100)}`;
}
function fiscalYearFromDate(iso){
  const m=String(iso||'').match(/^(\d{4})-(\d{2})/);
  if(!m)return '';
  const start=+m[2]>=7?+m[1]:+m[1]-1;
  return `${start}-${pad2((start+1)%100)}`;
}

/* ==========================================================================
   Record schemas - strictly mapped to the sheets of "Assets & Liabilities.xlsx"
   Common fields on every form: Type, Category, Subcategory, Date, Details,
   Amount / Balance, Document (PDF).  Everything else comes from the schema.
   ========================================================================== */
const ACQUISITIONS=['Purchased','Gift','Inheritance'];
const LAND_CATEGORIES=['Non-Agricultural','Advance Made for Non-Agricultural Property','Agricultural'];
const ITEM_CATEGORIES=['Furniture','Electronics','Equipments'];
const choice=rules=>value=>{
  const s=String(value??'').trim();
  for(const [re,out] of rules) if(re.test(s)) return out;
  return s;
};
const normLand=choice([[/advance/i,LAND_CATEGORIES[1]],[/non/i,LAND_CATEGORIES[0]],[/agri/i,LAND_CATEGORIES[2]]]);
const normAcquisition=choice([[/purch/i,'Purchased'],[/gift/i,'Gift'],[/inherit/i,'Inheritance']]);
const normItemCategory=choice([[/furn/i,'Furniture'],[/elec/i,'Electronics'],[/equip/i,'Equipments']]);

function field(key,label,type,excel,extra={}){
  return Object.assign({key,label,type,excel,required:false},extra);
}
const F_INCOME_YEAR=()=>field('incomeYear','Income Year','year',['income year'],{required:true});

function makeSchema(category,subcategory,sheet,fields,opts={}){
  return {
    category,subcategory,sheet,fields,
    type:opts.type||'Asset',
    hasDate:!!opts.hasDate,                       // Excel sheet has its own Date column
    detailsLabel:opts.detailsLabel||'Details / Description',
    detailsExcel:opts.detailsExcel||null,         // Excel header aliases for details
    detailsHint:opts.detailsHint||'',
    detailsAfter:opts.detailsAfter??fields.length,// position among report columns
    detailsRequired:!!opts.detailsRequired,
    amountExcel:opts.amountExcel||[],
    amountHint:opts.amountHint||'',
    amountSync:opts.amountSync||null              // 'market' | 'purchase'
  };
}

const SCHEMAS=[
  makeSchema('Cash','Cash in Hand','Cash-CIH',[
    field('particulars','Cash Asset Name','text',['cash asset name'],{required:true,placeholder:'e.g. Cash In Hand, Bkash'})
  ],{amountExcel:['balance'],amountHint:'Excel: Balance',detailsHint:'Optional note (not a separate column in this sheet)'}),

  makeSchema('Cash','Savings Accounts','Cash-Savings Accounts',[
    field('particulars','Bank Name','text',['bank name'],{required:true,placeholder:'e.g. BASIC Bank Limited'}),
    field('accountDetail','Account Detail','text',['account detail'],{placeholder:'Account number / branch'})
  ],{amountExcel:['balance'],amountHint:'Excel: Balance',detailsHint:'Optional note (not a separate column in this sheet)'}),

  makeSchema('Investments','CPF','Investment-CPF',[
    field('particulars','Particulars','text',['particulars'],{required:true,placeholder:'e.g. CPF Own, CPF Company'}),
    field('detailRef','Detail','text',['detail'],{placeholder:'e.g. Employee / PF ID #1089'}),
    F_INCOME_YEAR()
  ],{hasDate:true,amountExcel:['balance'],amountHint:'Excel: Balance',detailsHint:'Optional extra notes'}),

  makeSchema('Investments','Group Insurance & Welfare Fund (GI&WF)','Investment-GI&WF',[
    field('particulars','Particulars','text',['particulars'],{required:true,placeholder:'e.g. Group Insurance Premium'}),
    field('detailRef','Detail','text',['detail'],{placeholder:'e.g. #1089'}),
    F_INCOME_YEAR()
  ],{hasDate:true,amountExcel:['balance'],amountHint:'Excel: Balance',detailsHint:'Optional extra notes'}),

  makeSchema('Investments','Other Investment / Co-operation','Investment-Co-oP',[
    field('particulars','Particulars','text',['particulars'],{required:true,placeholder:'e.g. 2022-23 Batch Co-op'}),
    F_INCOME_YEAR()
  ],{amountExcel:['balance'],amountHint:'Excel: Balance',detailsExcel:['details'],detailsHint:'Excel: Details',detailsAfter:1}),

  makeSchema('Property','Land & Primary Residence','Property-Land',[
    field('propertyCategory','Property Category','select',['category'],{required:true,options:LAND_CATEGORIES,normalize:normLand}),
    field('acquisition','Type of Acquisition','select',['type of acquisition'],{required:true,options:ACQUISITIONS,normalize:normAcquisition}),
    F_INCOME_YEAR(),
    field('area','Area of the Property','text',['area of the property'],{placeholder:'e.g. 5 Decimal / 3 Katha'}),
    field('purchaseValue','Purchase Value','money',['purchase value']),
    field('currentMarketValue','Current Market Value','money',['current market value'])
  ],{hasDate:true,detailsExcel:['description and location'],detailsLabel:'Details / Description',detailsHint:'Excel: Description and Location',detailsRequired:true,detailsAfter:0,
     amountHint:'Syncs with Current Market Value (or Purchase Value) - editable',amountSync:'market'}),

  makeSchema('Property','Vehicles','Property-Vehicles',[
    field('registrationNo','Registration No.','text',['registration no.','registration no']),
    field('particulars','Type and Particulars','text',['type and particulars'],{required:true,placeholder:'e.g. Motorcycle, Car',list:['Motorcycle','Car','Any other']}),
    field('engineCapacity','Engine Capacity (CC)','text',['engine capacity'],{placeholder:'e.g. 150'}),
    F_INCOME_YEAR()
  ],{hasDate:true,amountExcel:['amount'],amountHint:'Excel: Amount',detailsHint:'Optional extra notes'}),

  makeSchema('Property','Jewelry','Property-Jewelry',[
    field('particulars','Particulars','text',['particulars'],{required:true,placeholder:'e.g. Gold Ring, Chain'}),
    field('quantity','Amount (Gram & Karat)','text',['amount (gram)','amount (gram & karat)'],{placeholder:'e.g. 2.75 Gram (21)'}),
    F_INCOME_YEAR()
  ],{amountExcel:['purchase value'],amountHint:'Excel: Purchase Value',amountSync:'purchase',detailsHint:'Optional extra notes'}),

  makeSchema('Property','Other Property','Property-Other Property',[
    field('particulars','Particulars','text',['particulars'],{required:true}),
    F_INCOME_YEAR()
  ],{amountExcel:['purchase value'],amountHint:'Excel: Purchase Value',amountSync:'purchase',detailsExcel:['description'],detailsHint:'Excel: Description',detailsAfter:1}),

  makeSchema('Retirement','Gratuity','Retirement-Gratuity',[
    field('particulars','Institution','text',['institution'],{required:true,placeholder:'e.g. PGCL'})
  ],{amountExcel:['balance'],amountHint:'Excel: Balance',detailsExcel:['detail'],detailsHint:'Excel: Detail',detailsAfter:1}),

  makeSchema('Other Assets','Furniture, Electronics & Equipments','Other Assets-Furniture',[
    field('particulars','Particulars','text',['particulars'],{required:true,placeholder:'e.g. Laptop, Box Bed'}),
    field('itemCategory','Item Category','select',['category'],{required:true,options:ITEM_CATEGORIES,normalize:normItemCategory}),
    field('acquisition','Type of Acquisition','select',['type of acquisition'],{required:true,options:ACQUISITIONS,normalize:normAcquisition}),
    F_INCOME_YEAR(),
    field('quantity','Quantity (Amount/Units)','text',['amount'],{placeholder:'e.g. 1'})
  ],{hasDate:true,amountExcel:['balance'],amountHint:'Excel: Balance',detailsHint:'Optional extra notes'}),

  makeSchema('Other Assets','Accounts Receivable','Other Assets-Accounts Receivable',[
    field('particulars','Debtor','text',['debtor'],{required:true,placeholder:'Person / organization'}),
    F_INCOME_YEAR()
  ],{amountExcel:['balance'],amountHint:'Excel: Balance',detailsExcel:['detail'],detailsHint:'Excel: Detail',detailsAfter:1}),

  makeSchema('Accounts Payable','Accounts Payable','Liabilities-Payable',[
    field('particulars','Payee','text',['payee'],{required:true,placeholder:'Person / organization'}),
    F_INCOME_YEAR()
  ],{type:'Liability',amountExcel:['balance'],amountHint:'Excel: Balance',detailsExcel:['detail'],detailsHint:'Excel: Detail',detailsAfter:1}),

  makeSchema('Bank Loan','Bank Loan','Liabilities-Bank Loan',[
    field('particulars','Bank','text',['bank'],{required:true,placeholder:'Bank name'}),
    F_INCOME_YEAR()
  ],{type:'Liability',amountExcel:['balance'],amountHint:'Excel: Balance',detailsExcel:['detail'],detailsHint:'Excel: Detail',detailsAfter:1}),

  makeSchema('Other Liabilities','Other Liabilities','Liabilities-Other Liabilities',[
    field('particulars','Particulars','text',['particulars'],{required:true}),
    F_INCOME_YEAR()
  ],{type:'Liability',amountExcel:['balance'],amountHint:'Excel: Balance',detailsExcel:['detail'],detailsHint:'Excel: Detail',detailsAfter:1})
];

/** Used for custom categories created in "Manage Categories". */
const GENERIC_SCHEMA=makeSchema('','','',[
  field('particulars','Particulars / Name','text',['particulars']),
  F_INCOME_YEAR()
],{amountHint:'',detailsHint:''});
GENERIC_SCHEMA.fields[0].required=true;

/** Every key that a schema may manage - cleared on save so stale values never survive a subcategory change. */
const MANAGED_KEYS=['particulars','accountDetail','detailRef','propertyCategory','acquisition','itemCategory','area','purchaseValue','currentMarketValue','registrationNo','engineCapacity','quantity','incomeYear'];

function getSchema(category,subcategory){
  return SCHEMAS.find(s=>s.category===category&&s.subcategory===subcategory)||GENERIC_SCHEMA;
}
function schemaForRecord(r){return getSchema(r.category,r.subcategory)}
function recordTitle(r){
  return String(r.particulars||r.name||r.details||r.description||r.registrationNo||r.area||'').trim()||'Unnamed Record';
}
/** Compact secondary line built from schema-specific values. */
function recordMeta(r){
  const parts=[];
  if(r.accountDetail)parts.push(r.accountDetail);
  if(r.detailRef)parts.push(r.detailRef);
  if(r.registrationNo)parts.push('Reg: '+r.registrationNo);
  if(r.engineCapacity)parts.push(r.engineCapacity+' CC');
  if(r.propertyCategory)parts.push(r.propertyCategory);
  if(r.itemCategory)parts.push(r.itemCategory);
  if(r.acquisition)parts.push(r.acquisition);
  if(r.area)parts.push(r.area);
  if(r.quantity)parts.push('Qty/Wt: '+r.quantity);
  return parts.join(' · ');
}

/* ==========================================================================
   Init, theme, toast, confirm
   ========================================================================== */
/**
 * A release must never destroy local data. An older build wiped the database whenever its
 * reset token changed, which silently deleted every record on update. Now the stored data
 * version is only compared, and the user is told to take a backup - nothing is deleted.
 */
async function checkDataVersion(){
  let stored=null;
  try{stored=localStorage.getItem(DATA_VERSION_KEY)}catch(e){}
  if(stored===APP_VERSION)return;
  let hasData=false;
  try{hasData=(await getAll('records')).length>0||(await getAll('documents')).length>0||(await getAll('incomeExpenses')).length>0}catch(e){}
  try{localStorage.setItem(DATA_VERSION_KEY,APP_VERSION)}catch(e){}
  if(!hasData)return;
  toast('App updated. All saved records were kept - create a backup from Data Backup & Restore.');
}

function deleteDatabase(){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('The database is in use by another tab or window. Close every other Personal Finance tab and try again.')),10000);
    const request=indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess=()=>{clearTimeout(timer);resolve()};
    request.onerror=()=>{clearTimeout(timer);reject(request.error)};
    request.onblocked=()=>console.warn('Database delete is waiting for other tabs to close');
  });
}
async function clearAppCaches(){
  try{
    if('serviceWorker' in navigator){(await navigator.serviceWorker.getRegistrations()).forEach(r=>r.unregister())}
    if(window.caches){(await caches.keys()).forEach(k=>caches.delete(k))}
  }catch(e){console.warn(e)}
}
/** Explicit, user-triggered data deletion (Settings page). Never runs automatically. */
async function deleteAllLocalData(){
  const ok=await confirm('Delete every record, category and PDF stored in this browser? This cannot be undone. Create a backup first.','Delete All Local Data');
  if(!ok)return;
  try{
    db=null;
    await deleteDatabase();
    try{localStorage.removeItem(DATA_VERSION_KEY);localStorage.removeItem('assetbook-data-token')}catch(e){}
    await clearAppCaches();
    location.reload();
  }catch(error){toast(error.message||'Unable to delete the local database.',true)}
}
/** Ask the browser to keep this data out of automatic eviction. */
async function requestPersistentStorage(){
  try{
    if(!navigator.storage||!navigator.storage.persist)return;
    if(await navigator.storage.persisted())return;
    await navigator.storage.persist();
  }catch(e){console.warn('Persistent storage request failed',e)}
}
/** Full-screen recovery panel shown when start-up fails. */
function showFatal(error){
  console.error(error);
  document.getElementById('fatalScreen')?.remove();
  const box=document.createElement('div');
  box.id='fatalScreen';box.className='fatal';
  box.innerHTML=`<div class="fatal-card"><h2>Unable to start Personal Finance</h2><p>The local database or the cached app files could not be loaded.</p><pre>${esc(error&&error.message||String(error))}</pre>
    <div class="fatal-actions"><button class="btn btn-primary" id="fatalRetry">Retry</button><button class="btn" id="fatalCache">Clear app cache &amp; reload</button><button class="btn btn-danger" id="fatalReset">Delete local database &amp; reload</button></div>
    <p class="fatal-note">Deleting the local database removes all data stored in this browser. Restore it afterwards from your backup ZIP.</p></div>`;
  document.body.appendChild(box);
  document.getElementById('fatalRetry').onclick=()=>location.reload();
  document.getElementById('fatalCache').onclick=async()=>{await clearAppCaches();location.reload()};
  document.getElementById('fatalReset').onclick=async()=>{
    try{await deleteDatabase();await clearAppCaches();location.reload()}catch(e){alert(e.message)}
  };
}

/**
 * First-run convenience: an empty database is filled from the workbooks kept in Project/.
 * The files go through the normal import pipeline, so categories, fiscal years and duplicate
 * detection behave exactly like Settings -> Import Excel / CSV. Existing records always win,
 * a missing Project/ folder (for example a deployment without the private workbooks) is
 * skipped silently, and the one-time flag stops the app from re-seeding data the user deleted.
 */
async function loadProjectDataset(){
  if(!window.XLSX)return 0;
  if(state.records.length||state.incomeExpenses.length)return 0;
  try{if(localStorage.getItem(PROJECT_DATASET_FLAG))return 0}catch(e){}
  let imported=0;
  for(const path of PROJECT_DATASET){
    try{
      const response=await fetch(encodeURI(path),{cache:'no-cache'});
      if(!response.ok)continue;
      const blob=await response.blob();
      const name=decodeURIComponent(path.split('/').pop());
      const file=new File([blob],name,{type:blob.type||(/\.csv$/i.test(name)?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')});
      const before=state.records.length+state.incomeExpenses.length;
      await runImport(file,null);
      imported+=Math.max(0,state.records.length+state.incomeExpenses.length-before);
    }catch(error){console.info('[dataset] skipped',path,error)}
  }
  try{localStorage.setItem(PROJECT_DATASET_FLAG,'1')}catch(e){}
  if(imported)toast(`Loaded ${imported} entries from the Project folder`);
  return imported;
}

async function init(){
  initTheme();
  // Self-heal: an old cached index.html without the new elements -> drop caches once and reload.
  if(!document.getElementById('generatePdfReport')||!document.getElementById('pdfViewerModal')||!document.getElementById('incomeTrendChart')){
    if(!sessionStorage.getItem('assetbook-healed')){
      sessionStorage.setItem('assetbook-healed','1');
      await clearAppCaches();location.reload();return;
    }
  }
  renderTableSkeleton();
  setupPWA();
  db=await openDB();
  await checkDataVersion();
  const existingCategories=await getAll('categories');
  if(!existingCategories.length){
    for(const category of defaultCategories) await put('categories',category);
  }
  const existingGroups=await getAll('incomeGroups');
  if(!existingGroups.length){
    for(const group of defaultIncomeGroups) await put('incomeGroups',group);
  }
  await loadState();
  const settings=await getAll('settings');
  state.settings=settings.reduce((out,item)=>(out[item.key]=item.value,out),{});
  state.settings.currency ||= 'BDT';
  state.settings.locale ||= 'en-BD';
  state.settings.incomeYears ||= ['2026-27','2025-26','2024-25','2023-24','2022-23'];
  // Fill an empty database from Project/ before the first render so the Dashboard is complete.
  await loadProjectDataset();
  bindNavigation();
  bindGlobalActions();
  bindDelegatedActions();
  renderAll();
  updateMobileMode();
  playEnter(document.getElementById('dashboardPage'));
  placePills(true);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>placePills(true));
  if(new URLSearchParams(location.search).get('action')==='add')openRecordModal();
  requestPersistentStorage();
}

async function loadState(){
  state.records=await getAll('records');
  state.categories=await getAll('categories');
  state.documents=await getAll('documents');
  state.backupHistory=await getAll('backupHistory');
  state.incomeExpenses=await getAll('incomeExpenses');
  state.incomeGroups=await getAll('incomeGroups');
  state.migrationHistory=await getAll('migrationHistory');
  if(!state.incomeGroups.length){for(const group of defaultIncomeGroups) state.incomeGroups.push(group)}
}

function toast(message,error=false){
  const el=document.createElement('div');
  el.className='toast'+(error?' error':'');
  el.textContent=message;
  document.getElementById('toastRegion').appendChild(el);
  setTimeout(()=>{el.style.transition='opacity .3s,transform .3s';el.style.opacity='0';el.style.transform='translateY(8px)';setTimeout(()=>el.remove(),320)},3500);
}
function confirm(message,title='Confirm Action'){
  return new Promise(resolve=>{
    // Never leave an earlier confirmation hanging: resolve it as "cancel".
    if(confirmAction){const previous=confirmAction;confirmAction=null;previous(false)}
    document.getElementById('confirmTitle').textContent=title;
    document.getElementById('confirmMessage').textContent=message;
    confirmAction=resolve;
    const modal=document.getElementById('confirmModal');
    if(!modal.open)modal.showModal();
  });
}

function initTheme(){
  const btn=$el('themeToggle');
  btn.onclick=()=>{
    const next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',next);
    try{localStorage.setItem('assetbook-theme',next)}catch(e){}
    const meta=document.getElementById('metaThemeColor');
    if(meta)meta.setAttribute('content',next==='dark'?'#0b1020':'#4f46e5');
    if(db&&currentPage==='dashboard')renderCharts(dashboardBalanceRecords());
  };
}

/* ==========================================================================
   Navigation (sidebar + mobile bottom bar) with animated active pill
   ========================================================================== */
const PAGE_TITLES={dashboard:['Dashboard','Financial overview'],records:['Assets & Liabilities','Manage financial records'],incomeExpenses:['Income & Expenses','Track cash flow, income and spending'],balance:['Balance Sheet','Consolidated financial position'],backup:['Data Backup & Restore','Portable data management'],settings:['Settings','Application preferences']};

function playEnter(panel){
  if(!panel)return;
  [...panel.children].forEach((c,i)=>c.style.setProperty('--i',i));
  panel.classList.remove('enter');
  void panel.offsetWidth;
  panel.classList.add('enter');
}
function restartAnimation(el){
  if(!el||reducedMotion())return;
  el.style.animation='none';
  void el.offsetWidth;
  el.style.animation='';
}
function placePill(nav,instant){
  const pill=nav&&nav.querySelector('.nav-pill'),active=nav&&nav.querySelector('.active');
  if(!pill||!active||!active.offsetWidth)return;
  if(instant){pill.style.transition='none'}
  pill.style.width=active.offsetWidth+'px';
  pill.style.height=active.offsetHeight+'px';
  pill.style.transform=`translate(${active.offsetLeft}px,${active.offsetTop}px)`;
  if(instant){void pill.offsetWidth;pill.style.transition=''}
  pill.classList.add('ready');
}
function placePills(instant=false){
  placePill(document.getElementById('sideNav'),instant);
  placePill(document.getElementById('bottomNav'),instant);
}
function closeDrawer(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('scrim').classList.remove('show');
  ['menuToggle','mobileMoreAction','mobileCalendarMore'].forEach(id=>{
    const button=document.getElementById(id);
    if(button){
      button.setAttribute('aria-expanded','false');
      if(id!=='menuToggle')button.setAttribute('aria-label','Open navigation menu');
    }
  });
}
function setDrawerOpen(open){
  if(open)closeMobileSpeedDial();
  document.getElementById('sidebar').classList.toggle('open',open);
  document.getElementById('scrim').classList.toggle('show',open);
  ['menuToggle','mobileMoreAction','mobileCalendarMore'].forEach(id=>{
    const button=document.getElementById(id);
    if(button){
      button.setAttribute('aria-expanded',String(open));
      if(id!=='menuToggle')button.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');
    }
  });
}
function toggleDrawer(){
  setDrawerOpen(!document.getElementById('sidebar').classList.contains('open'));
}
function showPage(page){
  if(!PAGE_TITLES[page])return;
  currentPage=page;
  mobileCalendarOpen=false;
  document.getElementById('mobileCalendarPage').classList.add('hidden');
  document.getElementById('mobileCalendarNav').classList.remove('active');
  document.getElementById('mobileCalendarNav').removeAttribute('aria-current');
  document.body.classList.toggle('mobile-dashboard',isMobileViewport()&&page==='dashboard');
  document.body.classList.remove('mobile-calendar-view');
  document.body.classList.remove('mobile-analytics');
  document.getElementById('mobileOverview').classList.toggle('hidden',!isMobileViewport()||page!=='dashboard');
  document.querySelectorAll('[data-page]').forEach(b=>{
    const active=b.dataset.page===page;
    b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-page-panel]').forEach(p=>p.classList.add('hidden'));
  const panel=document.getElementById(page+'Page');
  panel.classList.remove('hidden');
  document.getElementById('pageTitle').textContent=PAGE_TITLES[page][0];
  document.getElementById('pageSubtitle').textContent=PAGE_TITLES[page][1];
  closeDrawer();
  if(page==='dashboard'){kpiPrev.length=0;renderDashboard()}
  if(page==='records')renderRecordSections();
  if(page==='incomeExpenses')renderIncomePage();
  if(page==='balance')renderBalance();
  if(page==='backup')renderBackupHistory();
  if(page==='settings')renderSettings();
  if(page==='dashboard'&&isMobileViewport())renderMobileDashboard();
  playEnter(panel);
  placePills();
  window.scrollTo({top:0,behavior:reducedMotion()?'auto':'smooth'});
}
function bindNavigation(){
  document.querySelectorAll('[data-page]').forEach(button=>{
    button.onclick=()=>showPage(button.dataset.page);
  });
  $el('menuToggle').onclick=toggleDrawer;
  $el('mobileMoreAction').onclick=toggleDrawer;
  $el('mobileCalendarMore').onclick=toggleDrawer;
  $el('scrim').onclick=closeDrawer;
  window.addEventListener('resize',()=>{
    updateMobileMode();
    placePills(true);
  });
}

function bindGlobalActions(){
  const debounce=(fn,wait=180)=>{let timer=null;return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait)}};
  $el('quickAdd').onclick=()=>openRecordModal();
  $el('addRecordBtn').onclick=()=>openRecordModal();
  $el('recordSearch').oninput=debounce(renderRecordSections);
  $el('recordTypeFilter').onchange=renderRecordSections;
  $el('recordCategoryFilter').onchange=renderRecordSections;
  $el('recordSubcategoryFilter').onchange=renderRecordSections;
  $el('recordYearFilter').onchange=renderRecordSections;
  $el('recordClearFilters').onclick=()=>{
    const search=$el('recordSearch');if(search)search.value='';
    const type=$el('recordTypeFilter');if(type)type.value='';
    const category=$el('recordCategoryFilter');if(category)category.value='';
    const subcategory=$el('recordSubcategoryFilter');if(subcategory)subcategory.value='';
    const year=$el('recordYearFilter');if(year)year.value='';
    renderRecordSections();
  };
  $el('dashboardSearch').oninput=debounce(()=>{dashboardPage=1;renderDashboardTable()});
  $el('exportFiltered').onclick=exportFilteredExcel;
  $el('printDashboard').onclick=()=>window.print();
  $el('generatePdfReport').onclick=e=>runWithLoading(e.currentTarget,generatePdfReport);
  $el('generateExcelReport').onclick=e=>runWithLoading(e.currentTarget,generateExcelReport);
  $el('printBalance').onclick=()=>window.print();
  $el('exportBalanceExcel').onclick=exportBalanceExcel;
  $el('balanceYear').onchange=e=>{balanceYear=e.target.value;balanceYearChosen=true;renderBalance()};
  $el('balanceClear').onclick=()=>{balanceYear='';balanceYearChosen=true;renderBalance()};
  document.querySelectorAll('[data-close-modal]').forEach(button=>{
    button.onclick=()=>button.closest('dialog').close();
  });
  $el('confirmCancel').onclick=()=>{$el('confirmModal').close();if(confirmAction){const resolve=confirmAction;confirmAction=null;resolve(false)}};
  $el('confirmOk').onclick=()=>{$el('confirmModal').close();if(confirmAction){const resolve=confirmAction;confirmAction=null;resolve(true)}};
  $el('confirmModal').addEventListener('cancel',()=>{if(confirmAction){const resolve=confirmAction;confirmAction=null;resolve(false)}});
  $el('recordForm').onsubmit=saveRecord;
  $el('incomeForm').onsubmit=saveIncomeRecord;
  $el('addIncomeBtn').onclick=()=>openIncomeModal();
  $el('mobileQuickAction').onclick=openMobileSpeedDial;
  $el('mobileSpeedToggle').onclick=toggleMobileSpeedDial;
  $el('mobileSpeedBackdrop').onclick=closeMobileSpeedDial;
  $el('mobilePeriodSelect').onchange=e=>{mobilePeriodKey=e.target.value;mobilePeriodChosen=true;renderMobileDashboard()};
  $el('mobilePeriodStrip').onclick=e=>{
    const period=e.target.closest('[data-mobile-period]');
    if(!period)return;
    mobilePeriodKey=period.dataset.mobilePeriod;
    mobilePeriodChosen=true;
    renderMobileDashboard();
  };
  $el('mobileDashboardYear').onchange=e=>{
    mobileDashboardYear=normIncomeYear(e.target.value);
    mobilePeriodKey='';
    mobilePeriodChosen=false;
    renderMobileDashboard();
  };
  $el('mobileChartsAction').onclick=()=>{
    const grid=document.querySelector('#dashboardPage > .charts-grid');
    if(grid)grid.scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});
  };
  $el('mobileAllTransactions').onclick=()=>showPage('incomeExpenses');
  $el('mobileCalendarNav').onclick=openMobileCalendar;
  $el('mobileCalendarYear').onchange=e=>{
    mobileCalendarYear=normIncomeYear(e.target.value);
    mobileCalendarMonth=initialMobileCalendarMonth(mobileCalendarYear);
    mobileCalendarDay='';
    renderMobileCalendar();
  };
  $el('mobileCalendarMonths').onclick=e=>{
    const month=e.target.closest('[data-calendar-month]');
    if(!month)return;
    setMobileCalendarMonth(month.dataset.calendarMonth);
  };
  $el('mobileCalendarPrev').onclick=()=>navigateMobileCalendarMonth(-1);
  $el('mobileCalendarNext').onclick=()=>navigateMobileCalendarMonth(1);
  $el('mobileCalendarGrid').onclick=e=>{
    const day=e.target.closest('[data-calendar-date]');
    if(!day)return;
    mobileCalendarDay=mobileCalendarDay===day.dataset.calendarDate?'':day.dataset.calendarDate;
    renderMobileCalendar();
  };
  $el('mobileCalendarAllDays').onclick=()=>{mobileCalendarDay='';renderMobileCalendar()};
  $el('mobileShortcuts').onclick=e=>{
    const dismiss=e.target.closest('[data-dismiss-shortcut]');
    if(dismiss){
      e.stopPropagation();
      dismissedMobileShortcuts.add(dismiss.dataset.dismissShortcut);
      renderMobileShortcuts();
      return;
    }
    const action=e.target.closest('[data-mobile-shortcut]');
    if(!action)return;
    const shortcut=mobileQuickShortcuts[Number(action.dataset.mobileShortcut)];
    closeMobileSpeedDial();
    if(shortcut)openIncomeModal(null,shortcut);
  };
  $el('mobileSpeedPanel').onclick=e=>{
    const action=e.target.closest('[data-mobile-action]')?.dataset.mobileAction;
    if(!action)return;
    closeMobileSpeedDial();
    if(action==='settings'){showPage('settings');return}
    if(action==='Income'||action==='Expense'){openIncomeModal(null,{type:action});return}
    if(action==='transfer'){showPage('records');openRecordModal()}
  };
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMobileSpeedDial()});
  $el('exportIncomeExcel').onclick=e=>runWithLoading(e.currentTarget,exportIncomeExcel);
  $el('exportIncomePdf').onclick=e=>runWithLoading(e.currentTarget,exportIncomePdf);
  $el('goIncomePage').onclick=()=>showPage('incomeExpenses');
  const incomeTabs=$el('incomeTabs');
  if(incomeTabs)incomeTabs.onclick=e=>{
    const tab=e.target.closest('[data-income-tab]');if(!tab)return;
    incomeTab=tab.dataset.incomeTab;
    incomeTabs.querySelectorAll('[data-income-tab]').forEach(t=>{t.classList.toggle('active',t===tab);t.setAttribute('aria-selected',t===tab?'true':'false')});
    renderIncomeView();
  };
  const categoryType=$el('categoryType');
  if(categoryType)categoryType.onchange=()=>{renderCategoryMajorHeads();renderCategoryFormFields();renderCategoryNameOptions();renderCategoryTree()};
  const majorHeadSel=$el('categoryMajorHead');
  if(majorHeadSel)majorHeadSel.onchange=()=>{const isNew=majorHeadSel.value==='__new__';$el('newMajorHeadField').classList.toggle('hidden',!isNew);renderCategoryNameOptions();renderCategoryTree()};
  $el('categoryName').onchange=renderCategoryTree;
  $el('showNewCategory').onclick=()=>{$el('newCategoryRow').classList.remove('hidden');$el('newCategoryName').focus()};
  $el('cancelNewCategory').onclick=()=>{$el('newCategoryRow').classList.add('hidden');$el('newCategoryName').value=''};
  $el('saveNewCategory').onclick=saveNewCategory;
  $el('replaceDocumentFile').onchange=replaceDocumentFile;
  $el('createBackup').onclick=createBackup;
  $el('restoreBackup').onclick=()=>$el('restoreFile').click();
  $el('restoreFile').onchange=e=>{restoreFile=e.target.files[0];if(restoreFile)$el('restoreModal').showModal()};
  $el('confirmRestore').onclick=performRestore;
  $el('saveSettings').onclick=saveSettings;
  $el('addYear').onclick=addIncomeYear;
  $el('manageCategories').onclick=()=>openCategoryModal();
  $el('categoryForm').onsubmit=addCategory;
  $el('importExcel').onclick=()=>$el('excelImport').click();
  $el('excelImport').onchange=importExcel;
  $el('migrationChooseFile').onclick=()=>$el('migrationReplaceFile').click();
  $el('migrationReplaceFile').onchange=replaceMigrationFile;
  $el('migrationEditModal').addEventListener('close',()=>{replaceMigrationId=null});
  const wipe=$el('deleteAllData');
  if(wipe)wipe.onclick=deleteAllLocalData;
  bindPdfViewer();
}

/**
 * One delegated listener for every generated action, instead of inline onclick attributes.
 * Inline handlers had to embed user text inside a JavaScript string, which let a crafted
 * category / income-year name break out of the string and run code. Data attributes keep the
 * value in plain HTML-attribute position, where esc() is sufficient.
 */
function bindDelegatedActions(){
  document.addEventListener('click',async event=>{
    const trigger=event.target.closest('[data-cmd]');
    if(!trigger)return;
    const command=trigger.dataset.cmd,id=trigger.dataset.id||'',name=trigger.dataset.name||'',cat=trigger.dataset.cat||'',store=trigger.dataset.store||'',mig=trigger.dataset.mig||'';
    switch(command){
      case 'view-record': viewRecord(id); break;
      case 'edit-record': openRecordModal(id); break;
      case 'delete-record': await deleteRecord(id); break;
      case 'open-pdf': await openPdfViewer(id); break;
      case 'download-pdf': await downloadDocument(id); break;
      case 'rename-category': await renameCategory(id); break;
      case 'rename-subcategory': await renameSubcategory(id,name); break;
      case 'delete-subcategory': await deleteSubcategory(id,name); break;
      case 'delete-category': await deleteCategory(id); break;
      case 'delete-year': await deleteIncomeYear(id); break;
      case 'page': dashboardPage=Number(id)||1; renderDashboardTable(); break;
      case 'edit-income': openIncomeModal(id); break;
      case 'delete-income': await deleteIncomeRecord(id); break;
      case 'view-income': viewIncomeRecord(id); break;
      case 'income-page': incomePage=Number(id)||1; renderIncomeTable(); break;
      case 'rename-income-group': await renameIncomeGroup(id); break;
      case 'delete-income-group': await deleteIncomeGroup(id); break;
      case 'rename-income-category': await renameIncomeCategory(id,name); break;
      case 'delete-income-category': await deleteIncomeCategory(id,name); break;
      case 'rename-income-subcategory': await renameIncomeSubcategory(id,cat,name); break;
      case 'delete-income-subcategory': await deleteIncomeSubcategory(id,cat,name); break;
      case 'edit-migration': editMigration(id); break;
      case 'delete-migration': await deleteMigration(id); break;
      case 'remove-migration-row': await removeMigrationRow(mig,store,id); break;
    }
  });
}

async function runWithLoading(button,task){
  if(button.classList.contains('loading'))return;
  button.classList.add('loading');
  await new Promise(r=>setTimeout(r,60)); // let the shimmer paint before heavy work
  try{await task()}catch(error){console.error(error);toast(error.message||'Unable to generate the report.',true)}
  finally{button.classList.remove('loading')}
}

function renderAll(){
  renderDashboardFilters();
  renderDashboard();
  renderRecordSections();
  renderIncomePage();
  renderSettings();
  renderBackupHistory();
  renderBalance();
}

/* ==========================================================================
   Formatting / amounts
   ========================================================================== */
function getCurrencySymbol(){
  return {BDT:'৳',USD:'$',EUR:'€',GBP:'£'}[state.settings.currency||'BDT']||'৳';
}
function formatMoney(value){
  const number=Number(value)||0;
  const locale=state.settings.locale||'en-BD';
  return `${getCurrencySymbol()}${number.toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
/**
 * Resolves the primary value of any record.
 * An explicit `amount` always wins - even when it is 0 - so a deliberately zeroed record can no
 * longer resurrect an old Purchase / Market value. The legacy chain only runs when `amount` is
 * missing entirely (records created before the amount field existed, or imported rows).
 */
function recordAmount(record){
  if(!record)return 0;
  if(record.amount!==undefined&&record.amount!==null&&record.amount!==''){
    const explicit=Number(record.amount);
    return Number.isFinite(explicit)?explicit:0;
  }
  const candidates=[record.balance,record.currentMarketValue,record.outstandingBalance,record.purchaseValue];
  for(const c of candidates){
    const n=Number(c);
    if(c!==undefined&&c!==null&&c!==''&&Number.isFinite(n)&&n!==0)return n;
  }
  return 0;
}

/* ==========================================================================
   Income-year balance logic
   - Non-cash assets and Liabilities carry forward: a record counts up to the
     selected Income Year, accumulating from all previous years (sum of records
     whose income year is <= the selected year).
   - Cash is a snapshot: only its latest value is shown, latest per item as of the
     selected Income Year's end (so a newer balance outside that year is ignored),
     then the latest balances of different items are added together.
   ========================================================================== */
/** Cash & Bank = an Asset whose category is "Cash" (Savings Accounts / Cash in Hand). The label is
 *  also recognised as "Cash & Bank" / "Cash and Bank" so a renamed category keeps snapshot semantics. */
const isCashRecord=r=>!!r&&r.type==='Asset'&&/^(cash|cash\s*&\s*bank|cash\s+and\s+bank)$/i.test(String(r.category||'').trim());
/** Start year of a fiscal label so '2024-25' < '2025-26' orders correctly. */
function fiscalStartOf(year){
  const p=parseIncomeYear(year);
  return p?p.start:null;
}
/** Whether a non-cash record is carried forward into `year` ('' = all years). */
function carriesIntoYear(r,year){
  if(!year)return true;
  const ys=fiscalStartOf(year);
  if(ys===null)return true;
  const rs=fiscalStartOf(r.incomeYear);
  if(rs===null)return true;            // legacy record without an income year: keep it
  return rs<=ys;
}
/** Normalized "as of" date for a cash snapshot. Parses any stored date format (ISO, DD-MM-YYYY,
 *  Excel serial, JS Date) into ISO via normalizeExcelDate, and falls back to the end of the record's
 *  Income Year only when the Date is genuinely missing/invalid — so the snapshot is always compared
 *  correctly against financial-year boundaries. */
function cashEffectiveDate(r){
  const iso=normalizeExcelDate(r.date);
  if(iso)return iso;
  const range=fiscalRange(r.incomeYear);
  return range?range.to:'';
}
/** Cash keeps one value per item (subcategory + particulars + account detail); the most recent
 *  record wins. For a selected Income Year, only snapshots dated on/before that year's end count,
 *  so the shown value is the latest one *as of* that year — a newer balance outside the year is
 *  ignored (e.g. 28-06-2023 = 3000 stays 3000 for 2022-23 even when a later 5000 exists). */
function latestCashRecords(records, year){
  const range=year?fiscalRange(year):null;
  const cutoff=range?range.to:null;
  const latest=new Map();
  for(const r of records){
    const eff=cashEffectiveDate(r);
    if(cutoff&&eff&&eff>cutoff)continue;   // snapshot is newer than this financial year
    const key=[r.subcategory,r.particulars,r.accountDetail].map(v=>String(v??'').trim()).join('::');
    const prev=latest.get(key);
    if(!prev){latest.set(key,r);continue}
    const prevEff=cashEffectiveDate(prev);
    const newer=eff>prevEff||(eff===prevEff&&String(r.updatedAt||'')>String(prev.updatedAt||''));
    if(newer)latest.set(key,r);
  }
  return [...latest.values()];
}
/** Reduce a record set to its effective balance records for `year`. */
function effectiveRecordsForBalance(records,year){
  const cash=latestCashRecords(records.filter(isCashRecord), year);
  const carried=records.filter(r=>!isCashRecord(r)&&carriesIntoYear(r,year));
  return [...carried,...cash];
}
const sumAmount=records=>records.reduce((s,r)=>s+recordAmount(r),0);

/* ==========================================================================
   Dashboard filters (with automatic Bangladesh fiscal-year dates)
   ========================================================================== */
const dashFilters={type:'',category:'',subcategory:'',year:'',from:'',to:'',datesAuto:false};

function dashCategoryNames(type){
  return state.categories
    .filter(c=>!type||c.type===type)
    .map(c=>c.name)
    .filter((v,i,a)=>a.indexOf(v)===i);
}
function dashSubcategoryNames(type,category){
  return state.categories
    .filter(c=>(!type||c.type===type)&&(!category||c.name===category))
    .flatMap(c=>c.subcategories||[])
    .filter((v,i,a)=>a.indexOf(v)===i);
}
function dashYearOptions(){
  return [...new Set([...(state.settings.incomeYears||[]),...state.records.map(r=>String(r.incomeYear||'')).filter(Boolean)])]
    .sort((a,b)=>String(b).localeCompare(String(a)));
}

function renderDashboardFilters(){
  const host=document.getElementById('dashboardFilters');
  const categories=dashCategoryNames(dashFilters.type);
  if(!categories.includes(dashFilters.category)) dashFilters.category='';
  const subcategories=dashSubcategoryNames(dashFilters.type,dashFilters.category);
  if(!subcategories.includes(dashFilters.subcategory)) dashFilters.subcategory='';
  const years=dashYearOptions();
  if(dashFilters.year&&!years.includes(dashFilters.year)) {dashFilters.year='';if(dashFilters.datesAuto){dashFilters.from='';dashFilters.to='';dashFilters.datesAuto=false}}
  const option=(value,label,selected,disabled=false)=>`<option value="${esc(value)}" ${selected?'selected':''} ${disabled?'disabled':''}>${esc(label)}</option>`;
  const range=dashFilters.year?fiscalRange(dashFilters.year):null;
  const hint=range&&dashFilters.datesAuto?`<span class="fy-hint">Fiscal year ${esc(dashFilters.year)} · ${esc(fmtDate(range.from))} to ${esc(fmtDate(range.to))}</span>`:'';
  const anyFilter=dashFilters.type||dashFilters.category||dashFilters.subcategory||dashFilters.year||dashFilters.from||dashFilters.to;

  host.innerHTML=`<div class="filter-row">
    <select id="dashType" aria-label="Financial type">${option('','All Financial Types',!dashFilters.type)}${option('Asset','Assets',dashFilters.type==='Asset')}${option('Liability','Liabilities',dashFilters.type==='Liability')}</select>
    <select id="dashCategory" aria-label="Category" ${categories.length?'':'disabled'}>${option('',dashFilters.type?'All '+dashFilters.type+' Categories':'All Categories',!dashFilters.category)}${categories.map(c=>option(c,c,dashFilters.category===c)).join('')}</select>
    <select id="dashSubcategory" aria-label="Subcategory" ${subcategories.length?'':'disabled'}>${option('','All Subcategories',!dashFilters.subcategory)}${subcategories.map(s=>option(s,s,dashFilters.subcategory===s)).join('')}</select>
    <select id="dashYear" aria-label="Income year">${option('','All Income Years',!dashFilters.year)}${years.map(y=>option(y,y,dashFilters.year===y)).join('')}</select>
    <label class="date-field">Start Date<input id="dashDateFrom" type="date" value="${esc(dashFilters.from)}"></label>
    <label class="date-field">End Date<input id="dashDateTo" type="date" value="${esc(dashFilters.to)}"></label>
    <button type="button" class="btn filter-reset" id="dashReset" ${anyFilter?'':'disabled'}>Clear Filters</button>
    ${hint}
  </div>`;

  // Accent every control that actually narrows the results (mobile compact filter card).
  host.querySelectorAll('select').forEach(el=>el.classList.toggle('is-active',!!el.value));
  host.querySelectorAll('.date-field').forEach(field=>field.classList.toggle('is-active',!!field.querySelector('input')?.value));

  const rerender=()=>{dashboardPage=1;renderDashboardFilters();renderDashboard()};
  const bind=(id,key,followUp)=>{
    const el=document.getElementById(id);
    el.onchange=()=>{dashFilters[key]=el.value;if(followUp)followUp();rerender()};
  };
  bind('dashType','type',()=>{dashFilters.category='';dashFilters.subcategory=''});
  bind('dashCategory','category',()=>{dashFilters.subcategory=''});
  bind('dashSubcategory','subcategory');
  bind('dashYear','year',()=>{
    const range=dashFilters.year?fiscalRange(dashFilters.year):null;
    if(range){dashFilters.from=range.from;dashFilters.to=range.to;dashFilters.datesAuto=true}
    else{dashFilters.from='';dashFilters.to='';dashFilters.datesAuto=false}
  });
  bind('dashDateFrom','from',()=>{dashFilters.datesAuto=false});
  bind('dashDateTo','to',()=>{dashFilters.datesAuto=false});
  const reset=document.getElementById('dashReset');
  if(reset)reset.onclick=()=>{Object.assign(dashFilters,{type:'',category:'',subcategory:'',year:'',from:'',to:'',datesAuto:false});rerender()};
}

const inRange=(date,from,to)=>(!from||date>=from)&&(!to||date<=to);

/**
 * Filtering rules (Financial Records table, PDF & Excel reports)
 *  - Income Year: non-cash assets and Liabilities carry forward - every record up to and
 *    including the selected year stays in (accumulated from previous years). Cash is a
 *    snapshot and keeps only its latest value per item.
 *  - Date range: only enforced when the user edits a date manually (datesAuto is off); a year
 *    selection auto-fills the range, and the Income Year is then the source of truth.
 */
function getFilteredRecords(){
  const {year,from,to,datesAuto}=dashFilters;
  let records=effectiveRecordsForBalance(dashboardBaseRecords(),year);
  if(!datesAuto&&(from||to)){
    records=records.filter(r=>r.date&&inRange(r.date,from,to));
  }
  return records;
}

/** Records after the type / category / subcategory filters (no year or date handling). */
function dashboardBaseRecords(){
  const {type,category,subcategory}=dashFilters;
  return state.records.filter(r=>{
    if(type&&r.type!==type)return false;
    if(category&&r.category!==category)return false;
    if(subcategory&&r.subcategory!==subcategory)return false;
    return true;
  });
}
/** Dashboard aggregate records: carry-forward + cash last value for the selected Income Year. */
function dashboardBalanceRecords(){
  return effectiveRecordsForBalance(dashboardBaseRecords(),dashFilters.year);
}

/* ==========================================================================
   Dashboard rendering
   ========================================================================== */
const kpiPrev=[];
let mobilePeriodKey='';
let mobilePeriodChosen=false;
let mobileDashboardYear='';
let mobileQuickShortcuts=[];
let mobileCalendarOpen=false;
let mobileCalendarYear='';
let mobileCalendarMonth='';
let mobileCalendarDay='';
const dismissedMobileShortcuts=new Set();
const isMobileViewport=()=>window.matchMedia('(max-width: 768px)').matches;

function updateMobileMode(){
  const mobile=isMobileViewport();
  if(!mobile)closeDrawer();
  if(!mobile&&mobileCalendarOpen){
    mobileCalendarOpen=false;
    document.getElementById('mobileCalendarPage').classList.add('hidden');
  }
  const dashboardVisible=mobile&&currentPage==='dashboard'&&!mobileCalendarOpen;
  const calendarVisible=mobile&&currentPage==='dashboard'&&mobileCalendarOpen;
  document.body.classList.toggle('mobile-dashboard',dashboardVisible);
  document.body.classList.toggle('mobile-calendar-view',calendarVisible);
  document.getElementById('mobileOverview').classList.toggle('hidden',!dashboardVisible);
  document.getElementById('mobileCalendarPage').classList.toggle('hidden',!calendarVisible);
  document.querySelectorAll('#bottomNav .bn-item[data-page]').forEach(button=>{
    const active=mobile&&currentPage===button.dataset.page&&!mobileCalendarOpen;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  const calendarNav=document.getElementById('mobileCalendarNav');
  calendarNav.classList.toggle('active',calendarVisible);
  if(calendarVisible)calendarNav.setAttribute('aria-current','page');else calendarNav.removeAttribute('aria-current');
  const speedDial=document.getElementById('mobileSpeedDial');
  if(mobile)speedDial.classList.remove('hidden');
  else{closeMobileSpeedDial();speedDial.classList.add('hidden')}
  if(dashboardVisible)renderMobileDashboard();
  if(calendarVisible)renderMobileCalendar();
}
function openMobileCalendar(){
  if(!isMobileViewport())return;
  if(currentPage!=='dashboard')showPage('dashboard');
  mobileCalendarOpen=true;
  closeMobileSpeedDial();
  document.body.classList.remove('mobile-dashboard');
  document.body.classList.add('mobile-calendar-view');
  document.getElementById('mobileOverview').classList.add('hidden');
  document.getElementById('mobileCalendarPage').classList.remove('hidden');
  document.querySelectorAll('#bottomNav .bn-item').forEach(button=>{
    button.classList.remove('active');
    button.removeAttribute('aria-current');
  });
  const calendarNav=document.getElementById('mobileCalendarNav');
  calendarNav.classList.add('active');
  calendarNav.setAttribute('aria-current','page');
  renderMobileCalendar();
  window.scrollTo({top:0,behavior:reducedMotion()?'auto':'smooth'});
}
function mobileCalendarEntryYear(record){
  const dateYear=fiscalYearFromDate(record.date);
  if(dateYear)return dateYear;
  const year=parseIncomeYear(record.incomeYear);
  return year&&!year.plain?normIncomeYear(record.incomeYear):'';
}
function mobileCalendarAvailableYears(){
  const current=fiscalYearFromDate(todayISO());
  const years=new Set();
  const entryYears=new Set();
  const add=(value,isEntry=false)=>{
    const parsed=parseIncomeYear(value);
    if(!parsed||parsed.plain)return;
    const year=normIncomeYear(value);
    years.add(year);
    if(isEntry)entryYears.add(year);
  };
  (state.settings.incomeYears||[]).forEach(year=>add(year));
  [...state.records,...state.incomeExpenses].forEach(record=>add(mobileCalendarEntryYear(record),true));
  add(current);
  const currentStart=parseIncomeYear(current)?.start||new Date().getFullYear();
  for(let offset=1;offset<=4;offset++)add(`${currentStart-offset}-${pad2((currentStart-offset+1)%100)}`);
  const sorted=[...years].sort((a,b)=>(parseIncomeYear(b)?.start||0)-(parseIncomeYear(a)?.start||0));
  const defaultYear=entryYears.has(current)?current:([...entryYears].sort((a,b)=>(parseIncomeYear(b)?.start||0)-(parseIncomeYear(a)?.start||0))[0]||current);
  return {years:sorted,defaultYear,entryYears};
}
function mobileCalendarMonths(year){
  const start=parseIncomeYear(year)?.start;
  if(!start)return [];
  return Array.from({length:12},(_,i)=>{
    const date=new Date(start,6+i,1);
    const y=date.getFullYear(),m=date.getMonth()+1;
    const key=`${y}-${String(m).padStart(2,'0')}`;
    const lastDay=new Date(y,m,0).getDate();
    return {
      key,from:`${key}-01`,to:`${key}-${String(lastDay).padStart(2,'0')}`,
      label:date.toLocaleDateString('en',{month:'short',year:'2-digit'}),
      title:date.toLocaleDateString(undefined,{month:'long',year:'numeric'})
    };
  });
}
function initialMobileCalendarMonth(year){
  const months=mobileCalendarMonths(year);
  if(!months.length)return '';
  const current=fiscalYearFromDate(todayISO());
  if(year===current)return months.find(month=>month.key===todayISO().slice(0,7))?.key||months[0].key;
  const {from,to}=fiscalRange(year)||{};
  const dates=[...state.incomeExpenses,...state.records]
    .map(record=>String(record.date||'').slice(0,10))
    .filter(date=>date>=from&&date<=to)
    .sort();
  return dates.length?dates[dates.length-1].slice(0,7):months[0].key;
}
function setMobileCalendarMonth(key){
  const month=mobileCalendarMonths(mobileCalendarYear).find(item=>item.key===key);
  if(!month)return;
  mobileCalendarMonth=key;
  mobileCalendarDay='';
  renderMobileCalendar();
}
function navigateMobileCalendarMonth(offset){
  const months=mobileCalendarMonths(mobileCalendarYear);
  const index=months.findIndex(month=>month.key===mobileCalendarMonth);
  const next=months[index+offset];
  if(next)setMobileCalendarMonth(next.key);
}
function renderMobileCalendar(){
  if(!isMobileViewport()||!mobileCalendarOpen)return;
  const available=mobileCalendarAvailableYears();
  if(!available.years.includes(mobileCalendarYear))mobileCalendarYear=available.defaultYear;
  const months=mobileCalendarMonths(mobileCalendarYear);
  if(!months.length)return;
  if(!months.some(month=>month.key===mobileCalendarMonth))mobileCalendarMonth=initialMobileCalendarMonth(mobileCalendarYear);
  const selected=months.find(month=>month.key===mobileCalendarMonth)||months[0];
  const fySelect=document.getElementById('mobileCalendarYear');
  fySelect.innerHTML=available.years.map(year=>`<option value="${esc(year)}">${esc(year)}</option>`).join('');
  fySelect.value=mobileCalendarYear;
  const fyStart=parseIncomeYear(mobileCalendarYear)?.start||new Date().getFullYear();
  const fyLabel=`${fyStart}-${pad2((fyStart+1)%100)}`;
  document.getElementById('mobileCalendarMonthTitle').textContent=selected.title;
  document.getElementById('mobileCalendarMonths').innerHTML=months.map(month=>`<button type="button" class="mobile-calendar-month ${month.key===selected.key?'active':''}" data-calendar-month="${month.key}" aria-pressed="${month.key===selected.key}">${esc(month.label)}</button>`).join('');
  const prevIndex=months.findIndex(month=>month.key===selected.key);
  document.getElementById('mobileCalendarPrev').disabled=prevIndex===0;
  document.getElementById('mobileCalendarNext').disabled=prevIndex===months.length-1;
  const monthRecords=state.incomeExpenses.filter(record=>{
    const date=String(record.date||'').slice(0,10);
    return date>=selected.from&&date<=selected.to&&mobileCalendarEntryYear(record)===mobileCalendarYear;
  });
  const income=monthRecords.filter(record=>record.type==='Income').reduce((sum,record)=>sum+(Number(record.amount)||0),0);
  const expenses=monthRecords.filter(record=>record.type==='Expense').reduce((sum,record)=>sum+(Number(record.amount)||0),0);
  document.getElementById('mobileCalendarIncome').textContent=formatMoney(income);
  document.getElementById('mobileCalendarExpenses').textContent=formatMoney(expenses);
  document.getElementById('mobileCalendarNet').textContent=formatMoney(income-expenses);
  const totalsByDay=new Map();
  monthRecords.forEach(record=>{
    const date=String(record.date||'').slice(0,10);
    if(!totalsByDay.has(date))totalsByDay.set(date,[]);
    totalsByDay.get(date).push(record);
  });
  const [yearText,monthText]=selected.key.split('-');
  const year=Number(yearText),month=Number(monthText);
  const firstDay=new Date(year,month-1,1).getDay();
  const daysInMonth=new Date(year,month,0).getDate();
  const cellCount=Math.ceil((firstDay+daysInMonth)/7)*7;
  const today=todayISO();
  const days=Array.from({length:cellCount},(_,i)=>{
    const day=i-firstDay+1;
    if(day<1||day>daysInMonth)return '<span class="calendar-day empty" aria-hidden="true"></span>';
    const date=`${selected.key}-${String(day).padStart(2,'0')}`;
    const hasTransactions=totalsByDay.has(date);
    const classes=['calendar-day',date===today?'today':'',date===mobileCalendarDay?'selected':'',hasTransactions?'has-transactions':''].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-calendar-date="${date}" aria-label="${esc(new Date(year,month-1,day).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}))}${hasTransactions?', has transactions':''}" aria-pressed="${date===mobileCalendarDay}">${day}</button>`;
  }).join('');
  document.getElementById('mobileCalendarGrid').innerHTML=days;
  const selectedDay=mobileCalendarDay&&mobileCalendarDay.slice(0,7)===selected.key?mobileCalendarDay:'';
  if(mobileCalendarDay&&!selectedDay)mobileCalendarDay='';
  const visibleRecords=selectedDay?monthRecords.filter(record=>String(record.date||'').slice(0,10)===selectedDay):monthRecords;
  const selectedDateLabel=selectedDay?new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'}):`${selected.title} · FY ${fyLabel}`;
  document.getElementById('mobileCalendarTransactionTitle').textContent=selectedDay?`Transactions · ${selectedDateLabel}`:`Transactions · ${selectedDateLabel}`;
  document.getElementById('mobileCalendarAllDays').disabled=!selectedDay;
  document.getElementById('mobileCalendarTransactions').innerHTML=visibleRecords
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
    .map(record=>{
      const type=record.type==='Income'?'income':'expense';
      const category=String(record.category||'Other');
      const date=String(record.date||'').slice(0,10);
      const dayLabel=new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
      const note=[record.account,record.description].filter(Boolean).join(' · ')||record.majorHead||'';
      const amount=(type==='income'?'+':'−')+formatMoney(Math.abs(Number(record.amount)||0));
      return `<article class="mobile-transaction-card ${type}"><span class="mobile-transaction-icon" aria-hidden="true">${esc([...category][0]||'•')}</span><span class="mobile-transaction-copy"><strong>${esc(category)} &gt; ${esc(record.subcategory||'Other')}</strong><span>${esc(dayLabel)}${note?' · '+esc(note):''}</span></span><strong class="mobile-transaction-amount">${esc(amount)}</strong><span class="mobile-transaction-status" aria-label="Completed">✓</span></article>`;
    }).join('')||'<div class="mobile-calendar-empty">No transactions for this selection.</div>';
  const activeMonth=document.querySelector(`#mobileCalendarMonths [data-calendar-month="${selected.key}"]`);
  if(activeMonth)requestAnimationFrame(()=>activeMonth.scrollIntoView({block:'nearest',inline:'center',behavior:reducedMotion()?'auto':'smooth'}));
}
/** Net worth (assets - liabilities) as of the end of `year`, honouring the dashboard filters. */
function mobileYearBalance(year){
  const records=effectiveRecordsForBalance(dashboardBaseRecords(),year);
  return sumAmount(records.filter(record=>record.type==='Asset'))-sumAmount(records.filter(record=>record.type==='Liability'));
}
/** Months of the selected Financial Year (July -> June) with a 2-digit year label (JUL 26 ... JUN 27). */
function mobileYearMonths(year){
  return mobileCalendarMonths(year).map(month=>({...month,label:String(month.label||'').toUpperCase()}));
}
/** Default month inside a Financial Year: latest with activity, else the current month, else July. */
function mobileDefaultMonthKey(months){
  const current=todayISO().slice(0,7);
  const active=[...months].reverse().find(month=>state.incomeExpenses.some(record=>record.date&&record.date>=month.from&&record.date<=month.to));
  if(active)return active.key;
  return months.find(month=>month.key===current)?.key||months[0].key;
}
function renderMobileDashboard(){
  if(!isMobileViewport())return;
  const available=mobileCalendarAvailableYears();
  if(!available.years.includes(mobileDashboardYear))mobileDashboardYear=available.defaultYear;
  const months=mobileYearMonths(mobileDashboardYear);
  if(!months.length)return;
  const yearSelect=document.getElementById('mobileDashboardYear');
  yearSelect.innerHTML=available.years.map(year=>`<option value="${esc(year)}">${esc(year)}</option>`).join('');
  yearSelect.value=mobileDashboardYear;
  document.getElementById('mobileDashboardYearRange').textContent=`${months[0].label} – ${months[months.length-1].label}`;
  // Until the user picks a month, follow the latest month with activity so the summary is not
  // left on an empty month while transactions exist elsewhere in the Financial Year.
  if(!mobilePeriodChosen||!months.some(month=>month.key===mobilePeriodKey))mobilePeriodKey=mobileDefaultMonthKey(months);
  const selected=months.find(month=>month.key===mobilePeriodKey)||months[0];
  mobilePeriodKey=selected.key;
  const periodSelect=document.getElementById('mobilePeriodSelect');
  periodSelect.innerHTML=months.map(month=>`<option value="${month.key}">${esc(month.title)}</option>`).join('');
  periodSelect.value=selected.key;
  document.getElementById('mobileNetBalance').textContent=formatMoney(mobileYearBalance(mobileDashboardYear));
  const strip=document.getElementById('mobilePeriodStrip');
  strip.innerHTML=months.map(month=>`<button type="button" class="mobile-period-item ${month.key===selected.key?'active':''}" data-mobile-period="${month.key}" aria-pressed="${month.key===selected.key}">${esc(month.label)}</button>`).join('');
  const activeItem=strip.querySelector('.mobile-period-item.active');
  if(activeItem)requestAnimationFrame(()=>{
    // Keep the selected month centred without scrolling the page itself (offsetLeft can be
    // relative to a positioned ancestor, so measure both boxes).
    const offset=activeItem.getBoundingClientRect().left-strip.getBoundingClientRect().left;
    const target=strip.scrollLeft+offset-(strip.clientWidth-activeItem.offsetWidth)/2;
    strip.scrollTo({left:Math.max(0,target),behavior:reducedMotion()?'auto':'smooth'});
  });
  const transactions=state.incomeExpenses.filter(r=>r.date&&r.date>=selected.from&&r.date<=selected.to);
  const income=transactions.filter(r=>r.type==='Income').reduce((sum,r)=>sum+(Number(r.amount)||0),0);
  const expenses=transactions.filter(r=>r.type==='Expense').reduce((sum,r)=>sum+(Number(r.amount)||0),0);
  document.getElementById('mobileIncomeTotal').textContent=`+${formatMoney(income)}`;
  document.getElementById('mobileExpenseTotal').textContent=`−${formatMoney(expenses)}`;
  const grouped=new Map();
  transactions.forEach(r=>{
    if(!grouped.has(r.date))grouped.set(r.date,[]);
    grouped.get(r.date).push(r);
  });
  // "Recent activity" is a preview of the latest day only: the complete dashboard below must
  // never be pushed off the screen by a long period. "View all" opens Income & Expenses.
  const groups=[...grouped.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,1);
  const rows=groups.map(([date,records])=>{
    const dailyNet=records.reduce((sum,r)=>sum+(r.type==='Income'?1:-1)*Math.abs(Number(r.amount)||0),0);
    const dateValue=new Date(`${date}T12:00:00`);
    const dateLabel=dateValue.toLocaleDateString(undefined,{month:'short',day:'numeric'});
    const weekday=dateValue.toLocaleDateString(undefined,{weekday:'long'});
    const cards=records.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map(r=>{
      const type=r.type==='Income'?'income':'expense';
      const category=String(r.category||'Other');
      const subtitle=[r.account,r.description].filter(Boolean).join(' · ')||r.majorHead||'';
      const signedAmount=(type==='income'?'+':'−')+formatMoney(Math.abs(Number(r.amount)||0));
      return `<article class="mobile-transaction-card ${type}"><span class="mobile-transaction-icon" aria-hidden="true">${esc([...category][0]||'•')}</span><span class="mobile-transaction-copy"><strong>${esc(category)} &gt; ${esc(r.subcategory||'Other')}</strong><span>${esc(subtitle)}</span></span><strong class="mobile-transaction-amount">${esc(signedAmount)}</strong><span class="mobile-transaction-status" aria-label="Completed">✓</span></article>`;
    }).join('');
    return `<section class="mobile-day-group"><div class="mobile-day-heading"><span><strong>${esc(dateLabel)}</strong> ${esc(weekday)}</span><strong class="mobile-day-total ${dailyNet>=0?'positive':''}">${esc(formatMoney(dailyNet))}</strong></div>${cards}</section>`;
  }).join('');
  document.getElementById('mobileDailyTransactions').innerHTML=rows||'<div class="mobile-transaction-empty">No transactions for this period yet.</div>';
}
function renderMobileShortcuts(){
  const recent=[...state.incomeExpenses].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const entries=[];
  const seen=new Set();
  const add=(type,majorHead,category,subcategory)=>{
    if(!category)return;
    const key=[type,majorHead,category,subcategory||''].join('|');
    if(seen.has(key)||dismissedMobileShortcuts.has(key))return;
    seen.add(key);entries.push({type,majorHead,category,subcategory,key});
  };
  recent.forEach(r=>add(r.type,r.majorHead,r.category,r.subcategory));
  if(entries.length<4){
    state.incomeGroups.forEach(g=>(g.categories||[]).forEach(c=>(c.subcategories||[]).forEach(sub=>add(g.type,g.majorHead,c.name,sub))));
  }
  mobileQuickShortcuts=entries.slice(0,4);
  document.getElementById('mobileShortcuts').innerHTML=mobileQuickShortcuts.map((shortcut,i)=>`<div class="mobile-shortcut-row" style="--action-index:${i}"><button type="button" class="speed-action mobile-shortcut-action" data-mobile-shortcut="${i}" title="${esc(shortcut.category)} > ${esc(shortcut.subcategory||'')}"><span class="speed-action-icon">${shortcut.type==='Income'?'↗':'↘'}</span><span>${esc(shortcut.category)} &gt; ${esc(shortcut.subcategory||'Other')}</span></button><button type="button" class="mobile-shortcut-dismiss" data-dismiss-shortcut="${esc(shortcut.key)}" aria-label="Dismiss ${esc(shortcut.category)} shortcut">×</button></div>`).join('');
}
function openMobileSpeedDial(){
  if(!isMobileViewport())return;
  renderMobileShortcuts();
  const dial=document.getElementById('mobileSpeedDial');
  dial.classList.remove('hidden');
  const backdrop=document.getElementById('mobileSpeedBackdrop');
  const panel=document.getElementById('mobileSpeedPanel');
  backdrop.removeAttribute('inert');
  backdrop.setAttribute('aria-hidden','false');
  panel.removeAttribute('inert');
  panel.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>dial.classList.add('open'));
  document.getElementById('mobileSpeedToggle').setAttribute('aria-expanded','true');
  document.getElementById('mobileSpeedToggle').setAttribute('aria-label','Close quick actions');
}
function closeMobileSpeedDial(){
  const dial=document.getElementById('mobileSpeedDial');
  if(!dial)return;
  const toggle=document.getElementById('mobileSpeedToggle');
  if(dial.classList.contains('hidden')&&!dial.classList.contains('open'))return;
  const backdrop=document.getElementById('mobileSpeedBackdrop');
  const panel=document.getElementById('mobileSpeedPanel');
  if(backdrop===document.activeElement||panel.contains(document.activeElement))toggle.focus({preventScroll:true});
  dial.classList.remove('open');
  backdrop.setAttribute('aria-hidden','true');
  backdrop.setAttribute('inert','');
  panel.setAttribute('aria-hidden','true');
  panel.setAttribute('inert','');
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-label','Open quick actions');
}
function toggleMobileSpeedDial(){
  if(document.getElementById('mobileSpeedDial').classList.contains('open'))closeMobileSpeedDial();
  else openMobileSpeedDial();
}
function renderDashboard(){
  const balance=dashboardBalanceRecords();
  const assets=sumAmount(balance.filter(r=>r.type==='Asset'));
  const liabilities=sumAmount(balance.filter(r=>r.type==='Liability'));
  const assetCategories=new Set(balance.filter(r=>r.type==='Asset').map(r=>r.category)).size;
  const liabilityCategories=new Set(balance.filter(r=>r.type==='Liability').map(r=>r.category)).size;
  const documentCount=new Set(balance.flatMap(r=>r.documentIds||[])).size;
  const incomeRecords=dashboardIncomeExpenses();
  const totalIncome=incomeRecords.filter(r=>r.type==='Income').reduce((s,r)=>s+(Number(r.amount)||0),0);
  const totalExpenses=incomeRecords.filter(r=>r.type==='Expense').reduce((s,r)=>s+(Number(r.amount)||0),0);
  const netCash=totalIncome-totalExpenses;
  const cards=[
    ['up','Total Assets',assets,'money'],['down','Total Liabilities',liabilities,'money'],['scale','Net Worth',assets-liabilities,'money'],
    ['layers','Asset Categories',assetCategories,'int'],['layers','Liability Categories',liabilityCategories,'int'],['file','PDF Documents',documentCount,'int'],
    ['up','Total Income',totalIncome,'money'],['down','Total Expenses',totalExpenses,'money'],['scale','Net Cash Flow',netCash,'money',netCash>=0?'kpi-pos':'kpi-neg']
  ];
  document.getElementById('summaryCards').innerHTML=cards.map((c,i)=>`<div class="summary-card" style="--i:${i}"><div class="summary-icon">${icon(c[0])}</div><div><p>${c[1]}</p><strong class="kpi-value ${c[4]||''}" data-kind="${c[3]}" data-to="${c[2]}">${c[3]==='money'?formatMoney(c[2]):c[2]}</strong></div></div>`).join('');
  animateKpis();
  document.querySelectorAll('.chart-card').forEach((el,i)=>{el.style.setProperty('--i',i);restartAnimation(el)});
  renderCharts(balance);
  renderIncomeCharts(incomeRecords);
  markEmptyCharts();
  renderRecentIncome(incomeRecords);
  renderDashboardTable();
  renderMobileDashboard();
}

function animateKpis(){
  document.querySelectorAll('#summaryCards .kpi-value').forEach((el,i)=>{
    const to=Number(el.dataset.to)||0,kind=el.dataset.kind;
    const from=kpiPrev[i]??0;
    kpiPrev[i]=to;
    const fmt=v=>kind==='money'?formatMoney(v):String(Math.round(v));
    if(reducedMotion()||from===to){el.textContent=fmt(to);return}
    const duration=900,start=performance.now();
    const step=now=>{
      const t=Math.min(1,(now-start)/duration);
      const eased=1-Math.pow(1-t,4);
      el.textContent=fmt(from+(to-from)*eased);
      if(t<1)requestAnimationFrame(step);else el.textContent=fmt(to);
    };
    el.textContent=fmt(from);
    requestAnimationFrame(step);
  });
}

function renderTableSkeleton(){
  const rows=Array.from({length:5},()=>`<tr class="sk-row"><td colspan="10"><div class="sk"></div></td></tr>`).join('');
  document.getElementById('dashboardTable').innerHTML=`<tbody>${rows}</tbody>`;
}

function destroyChart(id){if(charts[id]){charts[id].destroy();delete charts[id]}}
/** Marks chart cards whose series are all zero, so an empty chart explains itself. */
function markEmptyCharts(){
  ['comparisonChart','assetsChart','liabilitiesChart','netWorthChart','incomeTrendChart','expenseCategoryChart'].forEach(id=>{
    const canvas=document.getElementById(id),card=canvas&&canvas.closest('.chart-card');
    if(!card)return;
    const chart=charts[id];
    const hasValues=!!chart&&!!chart.data&&(chart.data.datasets||[]).some(dataset=>(dataset.data||[]).some(value=>Number(value)>0));
    if(hasValues)card.removeAttribute('data-empty');else card.setAttribute('data-empty','');
  });
}
function chartTheme(){
  const dark=document.documentElement.getAttribute('data-theme')==='dark';
  return {text:dark?'#a8b3d1':'#64748b',grid:dark?'rgba(148,163,184,.14)':'rgba(15,23,42,.07)'};
}
const CHART_COLORS=['#6366f1','#10b981','#f59e0b','#0ea5e9','#ec4899','#8b5cf6','#14b8a6','#f97316'];
const LIABILITY_COLORS=['#f43f5e','#fb923c','#a78bfa','#38bdf8','#facc15'];

function renderCharts(records){
  const assets=sumAmount(records.filter(r=>r.type==='Asset'));
  const liabilities=sumAmount(records.filter(r=>r.type==='Liability'));
  destroyChart('comparisonChart');destroyChart('assetsChart');destroyChart('liabilitiesChart');destroyChart('netWorthChart');
  if(!window.Chart)return;
  const theme=chartTheme();
  Chart.defaults.color=theme.text;
  Chart.defaults.borderColor=theme.grid;
  Chart.defaults.font.family="'Plus Jakarta Sans','Inter',system-ui,sans-serif";
  const anim={duration:reducedMotion()?0:900,easing:'easeOutQuart'};
  const legend={position:'bottom',labels:{usePointStyle:true,boxWidth:8,color:theme.text}};
  const scales={x:{grid:{display:false},ticks:{color:theme.text}},y:{grid:{color:theme.grid},ticks:{color:theme.text}}};
  charts.comparisonChart=new Chart(document.getElementById('comparisonChart'),{type:'doughnut',data:{labels:['Assets','Liabilities'],datasets:[{data:[assets,liabilities],backgroundColor:['#10b981','#f43f5e'],borderWidth:0,hoverOffset:6}]},options:{maintainAspectRatio:false,cutout:'66%',animation:anim,plugins:{legend}}});
  const group=(type)=>Object.entries(records.filter(r=>r.type===type).reduce((out,r)=>{out[r.category]=(out[r.category]||0)+recordAmount(r);return out},{}));
  const assetsGroup=group('Asset'),liabilitiesGroup=group('Liability');
  charts.assetsChart=new Chart(document.getElementById('assetsChart'),{type:'bar',data:{labels:assetsGroup.map(x=>x[0]),datasets:[{data:assetsGroup.map(x=>x[1]),backgroundColor:assetsGroup.map((x,i)=>CHART_COLORS[i%CHART_COLORS.length]),borderRadius:8,maxBarThickness:42}]},options:{maintainAspectRatio:false,animation:anim,scales,plugins:{legend:{display:false}}}});
  charts.liabilitiesChart=new Chart(document.getElementById('liabilitiesChart'),{type:'pie',data:{labels:liabilitiesGroup.map(x=>x[0]),datasets:[{data:liabilitiesGroup.map(x=>x[1]),backgroundColor:LIABILITY_COLORS,borderWidth:0}]},options:{maintainAspectRatio:false,animation:anim,plugins:{legend}}});
  const trendSource=dashboardBaseRecords();
  const byYear=[...new Set(trendSource.map(r=>normIncomeYear(r.incomeYear||'')).filter(Boolean))].sort();
  const trend=byYear.map(year=>{
    const recs=effectiveRecordsForBalance(trendSource,year);
    return sumAmount(recs.filter(r=>r.type==='Asset'))-sumAmount(recs.filter(r=>r.type==='Liability'));
  });
  charts.netWorthChart=new Chart(document.getElementById('netWorthChart'),{type:'line',data:{labels:byYear,datasets:[{label:'Net Worth',data:trend,borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,.16)',fill:true,tension:.38,pointRadius:4,pointBackgroundColor:'#6366f1',borderWidth:2.5}]},options:{maintainAspectRatio:false,animation:anim,scales,plugins:{legend:{display:false}}}});
}

function docsOf(record){
  return (record.documentIds||[]).map(id=>state.documents.find(d=>d.id===id)).filter(Boolean);
}
function shortName(name,max=16){
  const base=String(name||'document.pdf');
  return base.length>max?base.slice(0,max-4)+'…pdf':base;
}
/** Clickable PDF badges shown on table rows / record cards. */
function docChips(record,max=2){
  const docs=docsOf(record);
  if(!docs.length)return '';
  const shown=docs.slice(0,max).map(d=>`<button type="button" class="doc-chip" data-cmd="open-pdf" data-id="${esc(d.id)}" title="View ${esc(d.name||d.title||'PDF')}">${icon('file')}<span>${esc(shortName(d.name||d.title))}</span></button>`).join('');
  const more=docs.length>max?`<button type="button" class="doc-chip more" data-cmd="view-record" data-id="${esc(record.id)}" title="Show all documents">+${docs.length-max} more</button>`:'';
  return shown+more;
}

function renderDashboardTable(){
  let records=getFilteredRecords();
  const search=document.getElementById('dashboardSearch').value.toLowerCase();
  if(search) records=records.filter(r=>Object.values(r).some(v=>String(v).toLowerCase().includes(search)));
  records.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||recordTitle(a).localeCompare(recordTitle(b)));
  const pageSize=10, pages=Math.max(1,Math.ceil(records.length/pageSize));
  dashboardPage=Math.min(dashboardPage,pages);
  const pageRecords=records.slice((dashboardPage-1)*pageSize,dashboardPage*pageSize);
  document.getElementById('recordCount').textContent=`${records.length} record${records.length===1?'':'s'} found`;
  document.getElementById('dashboardTable').innerHTML=`<thead><tr><th scope="col">Type</th><th scope="col">Date</th><th scope="col">Category</th><th scope="col">Subcategory</th><th scope="col">Particulars</th><th scope="col">Details</th><th scope="col">Income Year</th><th scope="col" class="num">Balance / Amount</th><th scope="col">Documents</th><th scope="col">Action</th></tr></thead><tbody>${pageRecords.map((r,i)=>{
    const meta=recordMeta(r);
    const id=esc(r.id);
    return `<tr style="--i:${i}"><td><span class="badge ${r.type.toLowerCase()}">${esc(r.type)}</span></td><td>${esc(fmtDate(r.date)||'—')}</td><td>${esc(r.category)}</td><td>${esc(r.subcategory)}</td><td><strong>${esc(recordTitle(r))}</strong>${meta?`<span class="muted-sub">${esc(meta)}</span>`:''}</td><td>${esc(r.details||'—')}</td><td>${esc(r.incomeYear||'—')}</td><td class="num"><strong>${formatMoney(recordAmount(r))}</strong></td><td><div class="doc-cell">${docChips(r)||'<span class="doc-none">—</span>'}</div></td><td class="actions-cell"><button type="button" class="action-link" data-cmd="view-record" data-id="${id}">View</button><button type="button" class="action-link" data-cmd="edit-record" data-id="${id}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-record" data-id="${id}">Delete</button></td></tr>`;
  }).join('')||'<tr><td colspan="10"><div class="empty-state">No financial records match these filters.</div></td></tr>'}</tbody>`;
  document.getElementById('dashboardPagination').innerHTML=pages>1?Array.from({length:pages},(_,i)=>`<button type="button" class="${i+1===dashboardPage?'active':''}" data-cmd="page" data-id="${i+1}" aria-label="Page ${i+1}">${i+1}</button>`).join(''):'';
}

/* ==========================================================================
   PDF documents: viewer modal, download, staged edit operations
   ========================================================================== */
let viewerUrl=null;
let viewerDoc=null;
let viewerTimer=null;

const isPdfFile=file=>!!file&&(file.type==='application/pdf'||/\.pdf$/i.test(file.name||''));
/**
 * Resolves a document id (or an already-loaded {blob,name,size}) into {blob,name,size}.
 * PDF bytes are read from IndexedDB only here, on demand - they never sit in the app state.
 */
async function resolveDocSource(source){
  if(typeof source!=='string')return source||null;
  const meta=state.documents.find(d=>d.id===source);
  if(!meta)return null;
  const blob=await getDocBlob(source);
  if(!blob)return null;
  return {blob,name:meta.name||meta.title||'document.pdf',size:meta.size||blob.size};
}
function asPdfBlob(blob){
  return blob&&blob.type==='application/pdf'?blob:new Blob([blob],{type:'application/pdf'});
}
function downloadBlob(blob,fileName){
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download=fileName;link.rel='noopener';link.style.display='none';
  document.body.appendChild(link);link.click();
  setTimeout(()=>{link.remove();URL.revokeObjectURL(url)},60000);   // keep the URL alive long enough for large files
}
/** Saves a file: native share sheet on iOS home-screen apps (anchor downloads are blocked there), normal download elsewhere. */
async function saveFile(blob,fileName){
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  if(ios&&standalone&&navigator.canShare){
    try{
      const file=new File([blob],fileName,{type:blob.type||'application/octet-stream'});
      if(navigator.canShare({files:[file]})){await navigator.share({files:[file],title:fileName});return}
    }catch(e){if(e&&e.name==='AbortError')return}
  }
  downloadBlob(blob,fileName);
}
function releaseViewerUrl(){
  clearTimeout(viewerTimer);
  if(viewerUrl){URL.revokeObjectURL(viewerUrl);viewerUrl=null}
  const frame=document.getElementById('pdfFrame');
  if(frame){frame.onload=null;frame.removeAttribute('src')}
}
function bindPdfViewer(){
  const modal=$el('pdfViewerModal');
  modal.addEventListener('close',()=>{releaseViewerUrl();viewerDoc=null});
  modal.addEventListener('click',e=>{if(e.target===modal)modal.close()});
  const download=()=>{if(viewerDoc)downloadBlob(asPdfBlob(viewerDoc.blob),viewerDoc.name)};
  const tab=async()=>{if(viewerDoc)await openDocumentInTab(viewerDoc)};
  $el('pdfDownloadBtn').onclick=download;
  $el('pdfFallbackDownload').onclick=download;
  $el('pdfNewTabBtn').onclick=tab;
  $el('pdfFallbackTab').onclick=tab;
}
/** Embedded viewer. `source` is a document id or { blob, name, size }. */
async function openPdfViewer(source){
  const doc=await resolveDocSource(source);
  if(!doc||!doc.blob){toast('This document file is not available on this device.',true);return}
  releaseViewerUrl();
  viewerDoc=doc;
  const modal=document.getElementById('pdfViewerModal');
  const stage=document.getElementById('pdfStage');
  const frame=document.getElementById('pdfFrame');
  const fallback=document.getElementById('pdfFallback');
  document.getElementById('pdfViewerTitle').textContent=doc.name||'Document';
  document.getElementById('pdfViewerMeta').textContent=doc.size?formatFileSize(doc.size):'PDF document';
  stage.classList.remove('loaded');
  fallback.classList.add('hidden');
  if(navigator.pdfViewerEnabled===false){
    fallback.classList.remove('hidden');
    stage.classList.add('loaded');
  }else{
    viewerUrl=URL.createObjectURL(asPdfBlob(doc.blob));
    frame.onload=()=>stage.classList.add('loaded');
    frame.src=viewerUrl+'#toolbar=1&navpanes=0';
    viewerTimer=setTimeout(()=>stage.classList.add('loaded'),4000);
  }
  if(!modal.open)modal.showModal();
}
/** Opens in a new tab with its own Blob URL (revoked after 5 minutes). */
async function openDocumentInTab(source){
  const doc=await resolveDocSource(source);
  if(!doc||!doc.blob){toast('This document file is not available on this device.',true);return}
  const url=URL.createObjectURL(asPdfBlob(doc.blob));
  const win=window.open(url,'_blank','noopener');
  if(!win)toast('Pop-up blocked. Allow pop-ups or use Download.',true);
  setTimeout(()=>URL.revokeObjectURL(url),5*60*1000);
}
async function downloadDocument(source){
  const doc=await resolveDocSource(source);
  if(!doc||!doc.blob){toast('This document file is not available on this device.',true);return}
  downloadBlob(asPdfBlob(doc.blob),doc.name);
}
function formatFileSize(bytes){
  if(!bytes)return '0 B';
  const units=['B','KB','MB','GB'];const i=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),units.length-1);
  return `${(bytes/Math.pow(1024,i)).toFixed(i?1:0)} ${units[i]}`;
}

/* Staged document operations for the Add / Edit modal (committed on Save, discarded on Cancel). */
let docDraft={existing:[],removed:new Set(),replaced:new Map(),added:[]};
function resetDocDraft(record){
  docDraft={existing:record?docsOf(record):[],removed:new Set(),replaced:new Map(),added:[]};
}
function renderDocManager(){
  const host=document.getElementById('docManagerList');
  if(!host)return;
  const rows=[];
  docDraft.existing.forEach(d=>{
    const removed=docDraft.removed.has(d.id),replacement=docDraft.replaced.get(d.id);
    const name=replacement?replacement.name:(d.name||d.title||'document.pdf');
    const size=replacement?replacement.size:d.size;
    const tag=removed?'<span class="tag warn">Will be removed</span>':replacement?`<span class="tag">Will replace "${esc(shortName(d.name||d.title,24))}"</span>`:'';
    rows.push(`<div class="doc-row ${removed?'removed':''}"><div class="doc-info"><strong>${esc(name)}</strong><span>${formatFileSize(size)}</span>${tag}</div><div class="doc-actions">
      ${removed?'':`<button type="button" class="action-link" data-act="view" data-id="${esc(d.id)}">View</button><button type="button" class="action-link" data-act="download" data-id="${esc(d.id)}">Download</button><button type="button" class="action-link" data-act="replace" data-id="${esc(d.id)}">Replace</button>`}
      <button type="button" class="action-link ${removed?'':'danger'}" data-act="${removed?'undo':'remove'}" data-id="${esc(d.id)}">${removed?'Undo remove':'Remove'}</button></div></div>`);
  });
  docDraft.added.forEach((file,i)=>{
    rows.push(`<div class="doc-row"><div class="doc-info"><strong>${esc(file.name)}</strong><span>${formatFileSize(file.size)}</span><span class="tag new">New · saved with record</span></div><div class="doc-actions"><button type="button" class="action-link" data-act="view-new" data-idx="${i}">View</button><button type="button" class="action-link danger" data-act="remove-new" data-idx="${i}">Remove</button></div></div>`);
  });
  host.innerHTML=rows.join('')||'<div class="doc-empty">No PDF attached yet.</div>';
}
async function docDraftSource(id){
  const meta=docDraft.existing.find(x=>x.id===id);if(!meta)return null;
  const replacement=docDraft.replaced.get(id);
  if(replacement)return {blob:replacement,name:replacement.name,size:replacement.size};
  const blob=await getDocBlob(id);
  if(!blob)return null;
  return {blob,name:meta.name||meta.title||'document.pdf',size:meta.size||blob.size};
}
function bindDocManager(){
  const host=document.getElementById('docManager');
  host.onclick=async event=>{
    const btn=event.target.closest('[data-act]');if(!btn)return;
    const {act,id,idx}=btn.dataset;
    if(act==='view')await openPdfViewer(await docDraftSource(id));
    else if(act==='download'){const source=await docDraftSource(id);if(source)downloadBlob(asPdfBlob(source.blob),source.name)}
    else if(act==='replace')replaceDocument(id);
    else if(act==='remove'){docDraft.removed.add(id);docDraft.replaced.delete(id);renderDocManager()}
    else if(act==='undo'){docDraft.removed.delete(id);renderDocManager()}
    else if(act==='view-new'){const f=docDraft.added[+idx];if(f)await openPdfViewer({blob:f,name:f.name,size:f.size})}
    else if(act==='remove-new'){docDraft.added.splice(+idx,1);renderDocManager()}
  };
  document.getElementById('recordDocument').onchange=event=>{
    const files=[...event.target.files];
    const bad=files.filter(f=>!isPdfFile(f));
    docDraft.added.push(...files.filter(isPdfFile));
    if(bad.length)toast('Only PDF files can be attached.',true);
    const total=docDraft.added.reduce((sum,f)=>sum+(f.size||0),0);
    if(total>30*1024*1024)toast('Attached PDFs total over 30 MB — browser storage may be exceeded.',true);
    event.target.value='';
    renderDocManager();
  };
}
function replaceDocument(id){
  replacingDocumentId=id;
  document.getElementById('replaceDocumentFile').click();
}
async function replaceDocumentFile(event){
  const file=event.target.files[0];
  const targetId=replacingDocumentId;
  event.target.value='';
  if(!file||!targetId)return;
  if(!isPdfFile(file)){toast('Please select a PDF file.',true);return}
  replacingDocumentId=null;
  if(document.getElementById('recordModal').open&&docDraft.existing.some(d=>d.id===targetId)){
    docDraft.replaced.set(targetId,file);
    docDraft.removed.delete(targetId);
    renderDocManager();
    return;
  }
  if(document.getElementById('incomeModal').open&&incomeDocDraft.existing.some(d=>d.id===targetId)){
    incomeDocDraft.replaced.set(targetId,file);
    incomeDocDraft.removed.delete(targetId);
    renderIncomeDocManager();
    return;
  }
  const documentRecord=state.documents.find(d=>d.id===targetId);
  if(!documentRecord)return;
  await put('documentBlobs',{id:targetId,blob:file});
  Object.assign(documentRecord,{name:file.name,title:file.name,type:file.type||'application/pdf',size:file.size,updatedAt:new Date().toISOString()});
  await put('documents',documentRecord);
  await loadState();renderAll();toast('PDF document replaced');
}

/* ==========================================================================
   Add / Edit record modal - fields adapt to Type > Category > Subcategory
   ========================================================================== */
let formState={draft:{},schema:GENERIC_SCHEMA,amountTouched:false,yearTouched:false};

function yearOptionsFor(current){
  const list=[...(state.settings.incomeYears||[])];
  if(current&&!list.includes(current))list.push(current);
  return list.sort((a,b)=>String(b).localeCompare(String(a)));
}
function fieldHtml(f){
  const value=formState.draft[f.key]??'';
  const req=f.required?'required':'';
  const star=f.required?' *':'';
  const base=`id="f_${f.key}" data-key="${f.key}" ${req}`;
  if(f.type==='select'){
    const options=[...f.options];
    if(value&&!options.includes(value))options.push(value);
    const selected=value||options[0];
    formState.draft[f.key]=selected;
    return `<label>${esc(f.label)}${star}<select ${base}>${options.map(o=>`<option value="${esc(o)}" ${o===selected?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
  }
  if(f.type==='year'){
    const dateValue=document.getElementById('recordDate')?.value||'';
    const selected=value||fiscalYearFromDate(dateValue)||state.settings.incomeYears?.[0]||'';
    formState.draft[f.key]=selected;
    return `<label>${esc(f.label)}${star}<select ${base}>${yearOptionsFor(selected).map(y=>`<option value="${esc(y)}" ${String(y)===String(selected)?'selected':''}>${esc(y)}</option>`).join('')}</select></label>`;
  }
  if(f.type==='money'){
    return `<label>${esc(f.label)}${star}<input ${base} type="number" step="0.01" min="0" inputmode="decimal" value="${esc(value===0?'0':value)}" placeholder="0.00"></label>`;
  }
  const listAttr=f.list?`list="dl_${f.key}"`:'';
  const dataList=f.list?`<datalist id="dl_${f.key}">${f.list.map(o=>`<option value="${esc(o)}"></option>`).join('')}</datalist>`:'';
  return `<label>${esc(f.label)}${star}<input ${base} ${listAttr} value="${esc(value)}" placeholder="${esc(f.placeholder||'')}" autocomplete="off">${dataList}</label>`;
}

function renderSubFields(){
  const category=document.getElementById('recordCategory').value;
  const subcategory=document.getElementById('recordSubcategory').value;
  const schema=getSchema(category,subcategory);
  formState.schema=schema;
  const host=document.getElementById('subFields');
  host.innerHTML=schema.fields.map(fieldHtml).join('');
  const details=document.getElementById('recordDetails');
  details.required=schema.detailsRequired;
  document.getElementById('detailsLabelText').textContent=schema.detailsRequired?'Details / Description *':'Details / Description';
  document.getElementById('detailsHint').textContent=schema.detailsHint||'';
  document.getElementById('amountHint').textContent=schema.amountHint||'';
  document.getElementById('subSectionTitle').textContent=schema.fields.length?`${subcategory||'Subcategory'} details`:'Details';
  host.oninput=event=>{
    const key=event.target.dataset.key;if(!key)return;
    formState.draft[key]=event.target.value;
    if(key==='incomeYear')formState.yearTouched=true;
    if(schema.amountSync==='market'&&(key==='currentMarketValue'||key==='purchaseValue'))syncAmountFromValues();
  };
  if(schema.amountSync==='market')syncAmountFromValues();
}
/** Land: Amount / Balance follows Current Market Value (fallback Purchase Value) until edited by hand. */
function syncAmountFromValues(){
  if(formState.amountTouched)return;
  const market=Number(formState.draft.currentMarketValue)||0,purchase=Number(formState.draft.purchaseValue)||0;
  const value=market||purchase;
  document.getElementById('recordAmount').value=value?String(value):'';
}

function openRecordModal(id=null){
  editingRecordId=id;
  const record=id?state.records.find(r=>r.id===id):null;
  resetDocDraft(record);
  formState={draft:{},schema:GENERIC_SCHEMA,amountTouched:false,yearTouched:!!record?.incomeYear};
  if(record)MANAGED_KEYS.forEach(k=>{if(record[k]!==undefined)formState.draft[k]=record[k]});
  document.querySelector('#recordForm .modal-foot').innerHTML='<button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn btn-primary">Save Record</button>';
  document.querySelectorAll('#recordForm [data-close-modal]').forEach(button=>button.onclick=()=>document.getElementById('recordModal').close());
  document.getElementById('recordModalTitle').textContent=record?'Edit Financial Record':'Add Financial Record';
  document.getElementById('recordModalSubtitle').textContent=record?`${record.category} / ${record.subcategory}`:'Fields adapt to the selected category and subcategory';
  const startType=record?.type||'Asset';
  const amountValue=record?recordAmount(record):'';
  document.getElementById('recordFormFields').innerHTML=`<div class="form-grid">
    <label>Financial Type *<select id="recordType" required><option value="Asset" ${startType==='Asset'?'selected':''}>Asset</option><option value="Liability" ${startType==='Liability'?'selected':''}>Liability</option></select></label>
    <label>Category *<select id="recordCategory" required></select></label>
    <label>Subcategory *<select id="recordSubcategory" required></select></label>
    <label>Date<input id="recordDate" type="date" value="${esc(record?record.date||'':todayISO())}"></label>
    <div class="form-section" id="subSectionTitle">Details</div>
    <div class="sub-fields" id="subFields"></div>
    <label class="full"><span id="detailsLabelText">Details / Description</span><textarea id="recordDetails" rows="3">${esc(record?.details||record?.description||'')}</textarea><span class="hint" id="detailsHint"></span></label>
    <label>Amount / Balance *<input id="recordAmount" type="number" step="0.01" inputmode="decimal" required value="${esc(amountValue===0?'0':amountValue)}" placeholder="0.00"><span class="hint" id="amountHint"></span></label>
    <label>Document (PDF)<input id="recordDocument" type="file" accept=".pdf,application/pdf" multiple><span class="hint">You can attach more than one PDF.</span></label>
    <div class="doc-manager" id="docManager"><h4>Attached documents</h4><div class="doc-list" id="docManagerList"></div></div>
  </div>`;

  const typeSelect=document.getElementById('recordType'),categorySelect=document.getElementById('recordCategory'),subSelect=document.getElementById('recordSubcategory');
  const dateInput=document.getElementById('recordDate'),amountInput=document.getElementById('recordAmount');

  const updateCategories=(keepCategory)=>{
    const filtered=state.categories.filter(c=>c.type===typeSelect.value);
    const wanted=keepCategory||categorySelect.value;
    categorySelect.innerHTML=filtered.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    if(filtered.some(c=>c.name===wanted))categorySelect.value=wanted;
    updateSubcategories(keepCategory===record?.category?record?.subcategory:undefined);
  };
  const updateSubcategories=(keepSub)=>{
    const category=state.categories.find(c=>c.type===typeSelect.value&&c.name===categorySelect.value);
    // A category without subcategories must not make the form impossible to submit:
    // fall back to the category name so the record can still be saved.
    const subs=(category?.subcategories||[]).length?category.subcategories:[categorySelect.value].filter(Boolean);
    subSelect.innerHTML=subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if(keepSub&&subs.includes(keepSub))subSelect.value=keepSub;
    renderSubFields();
  };
  typeSelect.onchange=()=>updateCategories();
  categorySelect.onchange=()=>updateSubcategories();
  subSelect.onchange=renderSubFields;
  dateInput.onchange=()=>{
    if(formState.yearTouched||!formState.schema.fields.some(f=>f.key==='incomeYear'))return;
    const derived=fiscalYearFromDate(dateInput.value);
    const select=document.getElementById('f_incomeYear');
    if(!derived||!select)return;
    if(![...select.options].some(o=>o.value===derived))select.add(new Option(derived,derived));
    select.value=derived;formState.draft.incomeYear=derived;
  };
  amountInput.oninput=()=>{formState.amountTouched=true};
  if(record&&schemaForRecord(record).amountSync==='market'){
    // An amount that differs from Market/Purchase Value was typed by hand: don't auto-overwrite it.
    const linked=Number(record.currentMarketValue)||Number(record.purchaseValue)||0;
    formState.amountTouched=Number(record.amount)!==0&&Number(record.amount)!==linked;
  }
  updateCategories(record?.category);
  bindDocManager();
  renderDocManager();
  document.getElementById('recordModal').showModal();
}

async function saveRecord(event){
  event.preventDefault();
  if(savingRecord)return;                       // a double click must not create two records
  const form=event.target;
  if(form.querySelector('select:invalid,input:invalid,textarea:invalid')){form.reportValidity();return}
  savingRecord=true;
  try{
  const type=document.getElementById('recordType').value;
  const category=document.getElementById('recordCategory').value;
  const subcategory=document.getElementById('recordSubcategory').value;
  const schema=getSchema(category,subcategory);
  const old=editingRecordId?state.records.find(r=>r.id===editingRecordId):null;
  const isNew=!old;
  const record=Object.assign({},old||{});
  MANAGED_KEYS.forEach(k=>delete record[k]);        // stale schema values never survive a subcategory change
  const amount=Number(document.getElementById('recordAmount').value||0);
  Object.assign(record,{
    id:old?old.id:uid('record'),type,category,subcategory,
    date:document.getElementById('recordDate').value,
    details:document.getElementById('recordDetails').value.trim(),
    amount,balance:amount
  });
  for(const f of schema.fields){
    const el=document.getElementById('f_'+f.key);
    const value=el?el.value:'';
    record[f.key]=f.type==='money'?Number(value||0):String(value).trim();
  }
  if(schema.amountSync==='purchase')record.purchaseValue=amount;      // Jewelry / Other Property: Amount = Purchase Value
  if(schema.amountSync==='market'&&!record.currentMarketValue&&!record.purchaseValue){record.currentMarketValue=amount}
  if(!record.incomeYear){const derived=fiscalYearFromDate(record.date);if(derived)record.incomeYear=derived}
  record.updatedAt=new Date().toISOString();

  // Commit staged document operations
  let documentIds=[...(old?.documentIds||[])];
  for(const docId of docDraft.removed){
    await remove('documents',docId);
    await remove('documentBlobs',docId);
    documentIds=documentIds.filter(x=>x!==docId);
  }
  for(const [docId,file] of docDraft.replaced){
    const existing=state.documents.find(d=>d.id===docId);
    if(!existing||docDraft.removed.has(docId))continue;
    await put('documentBlobs',{id:docId,blob:file});
    Object.assign(existing,{name:file.name,title:file.name,type:file.type||'application/pdf',size:file.size,updatedAt:new Date().toISOString()});
    await put('documents',existing);
  }
  for(const file of docDraft.added){
    const docId=uid('doc');
    await put('documentBlobs',{id:docId,blob:file});
    await put('documents',{id:docId,recordId:record.id,title:file.name,name:file.name,type:file.type||'application/pdf',size:file.size,category,subcategory,financialType:type,incomeYear:record.incomeYear||'',createdAt:new Date().toISOString()});
    documentIds.push(docId);
  }
  record.documentIds=documentIds;
  for(const d of state.documents.filter(x=>x.recordId===record.id&&documentIds.includes(x.id)&&!docDraft.replaced.has(x.id))){
    if(d.category!==category||d.subcategory!==subcategory||d.financialType!==type||d.incomeYear!==(record.incomeYear||'')){
      await put('documents',Object.assign(d,{category,subcategory,financialType:type,incomeYear:record.incomeYear||''}));
    }
  }
  await put('records',record);
  await loadState();
  document.getElementById('recordModal').close();
  editingRecordId=null;
  renderAll();
  toast(isNew?'Record created successfully':'Record saved successfully');
  }catch(error){
    console.error(error);
    const quota=error&&error.name==='QuotaExceededError';
    const detail=error&&error.message?` — ${error.message}`:'';
    toast(quota?'Could not save — browser storage is full. Delete some data or attach a smaller PDF.':`Could not save the record${detail}`,true);
  }finally{
    savingRecord=false;
  }
}

async function deleteRecord(id){
  if(await confirm('Delete this financial record? Any linked document relationships will also be removed.','Delete Record')){
    const record=state.records.find(r=>r.id===id);
    const linked=new Set([...(record?.documentIds||[]),...state.documents.filter(d=>d.recordId===id).map(d=>d.id)]);
    for(const documentId of linked){
      await remove('documents',documentId);
      await remove('documentBlobs',documentId);
    }
    await remove('records',id);
    await loadState();renderAll();toast('Record deleted');
  }
}

function viewRecord(id){
  const r=state.records.find(x=>x.id===id);if(!r)return;
  editingRecordId=null;
  const schema=schemaForRecord(r);
  document.getElementById('recordModalTitle').textContent=recordTitle(r);
  document.getElementById('recordModalSubtitle').textContent=`${r.category} / ${r.subcategory}`;
  const documents=docsOf(r);
  const documentSection=documents.length?`
    <label class="full document-view-section">Attached PDF Documents
      <div class="document-view-list">${documents.map(doc=>`
        <div class="document-view-item">
          <div class="document-info">
            <strong>${esc(doc.name||doc.title||'document.pdf')}</strong>
            <span>${formatFileSize(doc.size)}</span>
          </div>
          <div class="document-actions">
            <button type="button" class="btn" data-cmd="open-pdf" data-id="${esc(doc.id)}">View PDF</button>
            <button type="button" class="btn btn-primary" data-cmd="download-pdf" data-id="${esc(doc.id)}">Download PDF</button>
          </div>
        </div>`).join('')}
      </div>
    </label>`:'';
  const show=(label,value,full=false)=>`<label${full?' class="full"':''}><span class="k">${esc(label)}</span><strong class="view-field">${value===''||value===undefined||value===null?'—':esc(value)}</strong></label>`;
  const rows=[show('Type',r.type),show('Category',r.category),show('Subcategory',r.subcategory),show('Date',fmtDate(r.date))];
  schema.fields.forEach(f=>rows.push(show(f.label,f.type==='money'?(r[f.key]?formatMoney(r[f.key]):''):r[f.key])));
  const shown=new Set(schema.fields.map(f=>f.key));
  ['purchaseValue','currentMarketValue'].forEach(k=>{if(!shown.has(k)&&r[k])rows.push(show(k==='purchaseValue'?'Purchase Value':'Current Market Value',formatMoney(r[k])))});
  rows.push(show('Amount / Balance',formatMoney(recordAmount(r))));
  rows.push(show('Details / Description',r.details||r.description||'',true));
  if(r.remarks)rows.push(show('Remarks',r.remarks,true));
  document.getElementById('recordFormFields').innerHTML=`<div class="form-grid">${rows.join('')}${documentSection}</div>`;
  document.querySelector('#recordForm .modal-foot').innerHTML='<button type="button" class="btn" data-close-modal>Close</button>';
  document.querySelectorAll('#recordForm [data-close-modal]').forEach(button=>button.onclick=()=>document.getElementById('recordModal').close());
  document.getElementById('recordModal').showModal();
}

/* ==========================================================================
   Records page & balance sheet
   ========================================================================== */
function renderRecordFilters(){
  const typeSelect=document.getElementById('recordTypeFilter');
  const categorySelect=document.getElementById('recordCategoryFilter');
  const subcategorySelect=document.getElementById('recordSubcategoryFilter');
  const yearSelect=document.getElementById('recordYearFilter');
  const clearBtn=document.getElementById('recordClearFilters');
  if(!categorySelect||!subcategorySelect)return;
  const type=typeSelect?.value||'';
  const option=(value,label,selected)=>`<option value="${esc(value)}" ${selected?'selected':''}>${esc(label)}</option>`;
  const selectedYear=isMobileViewport()?(yearSelect?.value||''):'';
  const years=recordYearOptions();
  const year=years.includes(normIncomeYear(selectedYear))?normIncomeYear(selectedYear):'';
  const categories=dashCategoryNames(type);
  if(!categories.includes(categorySelect.value))categorySelect.value='';
  categorySelect.disabled=categories.length===0;
  categorySelect.innerHTML=option('',type?`All ${type} Categories`:'All Categories',!categorySelect.value)+categories.map(c=>option(c,c,categorySelect.value===c)).join('');
  const subcategories=dashSubcategoryNames(type,categorySelect.value);
  if(!subcategories.includes(subcategorySelect.value))subcategorySelect.value='';
  subcategorySelect.disabled=subcategories.length===0;
  subcategorySelect.innerHTML=option('','All Subcategories',!subcategorySelect.value)+subcategories.map(s=>option(s,s,subcategorySelect.value===s)).join('');
  if(yearSelect){
    yearSelect.innerHTML=option('','All Financial Years',!year)+years.map(y=>option(y,y,y===year)).join('');
    yearSelect.value=isMobileViewport()?year:'';
  }
  if(clearBtn){
    const active=!!((typeSelect?.value||'')||categorySelect.value||subcategorySelect.value||year||(document.getElementById('recordSearch')?.value||'').trim());
    clearBtn.disabled=!active;
  }
  // Mobile compact filter card: tint the dropdowns that are actually applied.
  [typeSelect,categorySelect,subcategorySelect,yearSelect].forEach(select=>{
    if(select)select.classList.toggle('is-active',!!select.value);
  });
}

function recordFinancialYear(record){
  const stored=String(record.incomeYear||'').trim();
  if(stored)return normIncomeYear(stored);
  return fiscalYearFromDate(normalizeExcelDate(record.date)||record.date);
}
function recordYearOptions(){
  return [...new Set([...(state.settings.incomeYears||[]),...state.records.map(recordFinancialYear)]
    .map(year=>normIncomeYear(year)).filter(Boolean))]
    .sort((a,b)=>String(b).localeCompare(String(a)));
}

function renderRecordSections(){
  renderRecordFilters();
  const search=(document.getElementById('recordSearch')?.value||'').toLowerCase();
  const type=document.getElementById('recordTypeFilter')?.value||'';
  const category=document.getElementById('recordCategoryFilter')?.value||'';
  const subcategory=document.getElementById('recordSubcategoryFilter')?.value||'';
  const year=isMobileViewport()?(document.getElementById('recordYearFilter')?.value||''):'';
  let records=state.records.filter(r=>!search||Object.values(r).some(v=>String(v).toLowerCase().includes(search)));
  if(year)records=records.filter(r=>recordFinancialYear(r)===year);
  if(type)records=records.filter(r=>r.type===type);
  if(category)records=records.filter(r=>r.category===category);
  if(subcategory)records=records.filter(r=>r.subcategory===subcategory);
  records.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const render=(items)=>items.map((r,i)=>{
    const meta=recordMeta(r);
    const id=esc(r.id);
    return `<div class="record-item" style="--i:${Math.min(i,14)}"><div><h4>${esc(recordTitle(r))}</h4><p>${esc(r.category)} · ${esc(r.subcategory)}${r.incomeYear?' · <span class="record-income-year">'+esc(r.incomeYear)+'</span>':''}</p>${meta?`<p>${esc(meta)}</p>`:''}</div><div class="record-amount"><strong>${formatMoney(recordAmount(r))}</strong><p>${esc(fmtDate(r.date))}</p></div>${docsOf(r).length?`<div class="record-docs">${docChips(r,3)}</div>`:''}<div class="record-actions"><button type="button" class="action-link" data-cmd="view-record" data-id="${id}">View</button><button type="button" class="action-link" data-cmd="edit-record" data-id="${id}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-record" data-id="${id}">Delete</button></div></div>`;
  }).join('');
  const assets=records.filter(r=>r.type==='Asset'),liabilities=records.filter(r=>r.type==='Liability');
  document.getElementById('assetRecordCount').textContent=`${assets.length} records`;
  document.getElementById('liabilityRecordCount').textContent=`${liabilities.length} records`;
  document.getElementById('assetList').innerHTML=render(assets)||'<div class="empty-state">No asset records.</div>';
  document.getElementById('liabilityList').innerHTML=render(liabilities)||'<div class="empty-state">No liability records.</div>';
}

/** Income Year match used by the Balance Sheet: incomeYear equality ('2025-26' == '2025-2026'),
 *  or - for records without an Income Year - a date inside that fiscal year. */
function recordMatchesYear(r,year){
  if(!year)return true;
  if(r.incomeYear)return normIncomeYear(r.incomeYear)===normIncomeYear(year);
  const fy=fiscalRange(year);
  return !!(r.date&&fy&&inRange(r.date,fy.from,fy.to));
}
let balanceYear='';          // '' = All Income Years
let balanceYearChosen=false; // until the user picks a year, default to the newest year that has data

function orderedCategories(type){
  // Only live categories count: a category the user deleted must not reappear on the balance sheet.
  // Defaults are used solely as a fallback before the classification tree has been created.
  const source=state.categories.length?state.categories.filter(c=>c.type===type):defaultCategories.filter(c=>c.type===type);
  const names=[...new Set(source.map(c=>c.name))];
  return names.map(name=>{
    const found=source.find(c=>c.name===name);
    return {name,subcategories:[...(found?.subcategories||[])]};
  });
}
/** Category -> Subcategory structure of the balance sheet for one Income Year. */
function buildBalanceData(year){
  const source=state.records.filter(r=>r.type==='Asset'||r.type==='Liability');
  const records=effectiveRecordsForBalance(source,year);
  const section=type=>{
    const cats=orderedCategories(type).map(c=>{
      const recs=records.filter(r=>r.type===type&&r.category===c.name);
      const subNames=[...c.subcategories];
      recs.forEach(r=>{if(!subNames.includes(r.subcategory))subNames.push(r.subcategory)});
      const subs=subNames.map(n=>{
        const list=recs.filter(r=>r.subcategory===n);
        return {name:n,count:list.length,total:list.reduce((s,r)=>s+recordAmount(r),0)};
      });
      return {name:c.name,subs,count:recs.length,total:subs.reduce((s,x)=>s+x.total,0)};
    });
    return {cats,total:cats.reduce((s,c)=>s+c.total,0)};
  };
  const assets=section('Asset'),liabilities=section('Liability');
  return {assets,liabilities,net:assets.total-liabilities.total,count:records.length};
}

function renderBalance(){
  const yearSelect=document.getElementById('balanceYear');
  const years=dashYearOptions();
  if(!balanceYearChosen){
    balanceYear=years.find(y=>state.records.some(r=>recordMatchesYear(r,y)))||'';
  }
  if(balanceYear&&!years.includes(balanceYear))balanceYear='';
  yearSelect.innerHTML=`<option value="">All Income Years</option>${years.map(y=>`<option value="${esc(y)}" ${y===balanceYear?'selected':''}>${esc(y)}</option>`).join('')}`;
  yearSelect.value=balanceYear;
  yearSelect.classList.toggle('is-active',!!balanceYear);
  const clearBtn=document.getElementById('balanceClear');
  if(clearBtn)clearBtn.disabled=!balanceYear;
  const data=buildBalanceData(balanceYear);
  const range=balanceYear?fiscalRange(balanceYear):null;
  const section=(title,sec)=>{
    const rows=sec.cats.map(c=>`<tr class="cat-row"><td>${esc(c.name)}</td><td>${formatMoney(c.total)}</td></tr>`+
      c.subs.map(sub=>`<tr class="sub-row"><td>${esc(sub.name)}</td><td>${formatMoney(sub.total)}</td></tr>`).join('')).join('');
    return `<table class="balance-table"><tbody><tr class="total section-title"><td>${title}</td><td></td></tr>${rows}<tr class="total"><td>Total ${title}</td><td>${formatMoney(sec.total)}</td></tr></tbody></table>`;
  };
  document.getElementById('balanceSheet').innerHTML=`<div class="balance-header"><h2>Personal Balance Sheet</h2><p>${balanceYear?`Income Year ${esc(balanceYear)}${range?` · ${esc(fmtDate(range.from))} to ${esc(fmtDate(range.to))}`:''}`:'All Income Years'}</p></div>
    ${section('ASSETS',data.assets)}
    ${section('LIABILITIES',data.liabilities)}
    <table class="balance-table"><tbody><tr class="total net-worth-row"><td>NET WORTH</td><td>${formatMoney(data.net)}</td></tr></tbody></table>`;
}

function openCategoryModal(){
  document.getElementById('categoryModal').showModal();
  renderCategoryMajorHeads();
  renderCategoryFormFields();
  renderCategoryNameOptions();
  renderCategoryTree();
}
function renderCategoryNameOptions(){
  const type=document.getElementById('categoryType').value;
  const majorHead=document.getElementById('categoryMajorHead').value;
  const selected=document.getElementById('categoryName').value;
  const names=[];
  state.categories.filter(c=>!type||c.type===type).forEach(c=>names.push(c.name));
  state.incomeGroups.filter(g=>(!type||g.type===type)&&
    (!(type==='Income'||type==='Expense')||majorHead==='__new__'||!majorHead||g.majorHead===majorHead))
    .forEach(g=>(g.categories||[]).forEach(c=>names.push(c.name)));
  const unique=[...new Set(names)].sort((a,b)=>a.localeCompare(b));
  const select=document.getElementById('categoryName');
  select.innerHTML=`<option value="">All Categories</option>${unique.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
  select.value=unique.includes(selected)?selected:'';
}
function renderCategoryTree(){
  renderCategoryNameOptions();
  const type=document.getElementById('categoryType').value;
  const selectedCategory=document.getElementById('categoryName').value;
  const majorHead=document.getElementById('categoryMajorHead').value;
  const tree=state.categories.filter(c=>(!type||c.type===type)&&(!selectedCategory||c.name===selectedCategory)).map(c=>{
    const id=esc(c.id);
    const subs=c.subcategories.map(s=>`<span>${esc(s)} <button type="button" class="action-link" data-cmd="rename-subcategory" data-id="${id}" data-name="${esc(s)}">Edit</button> <button type="button" class="action-link danger" data-cmd="delete-subcategory" data-id="${id}" data-name="${esc(s)}" aria-label="Delete subcategory ${esc(s)}">×</button></span>`).join('');
    return `<div class="category-group"><strong>${esc(c.type)} · ${esc(c.name)} <button type="button" class="action-link" data-cmd="rename-category" data-id="${id}">Edit</button></strong>${subs}<button type="button" class="action-link danger" data-cmd="delete-category" data-id="${id}">Delete Category</button></div>`;
  }).join('');
  const incomeTree=state.incomeGroups.filter(g=>(!type||g.type===type)&&
    (!(type==='Income'||type==='Expense')||majorHead==='__new__'||!majorHead||g.majorHead===majorHead)).map(g=>{
    const gid=esc(g.id);
    const cats=(g.categories||[]).filter(cat=>!selectedCategory||cat.name===selectedCategory).map(cat=>{
      const cname=esc(cat.name);
      const subs=(cat.subcategories||[]).map(s=>`<span>${esc(s)} <button type="button" class="action-link" data-cmd="rename-income-subcategory" data-id="${gid}" data-cat="${cname}" data-name="${esc(s)}">Edit</button> <button type="button" class="action-link danger" data-cmd="delete-income-subcategory" data-id="${gid}" data-cat="${cname}" data-name="${esc(s)}" aria-label="Delete subcategory ${esc(s)}">×</button></span>`).join('');
      return `<div class="category-group"><strong>${esc(cat.name)} <button type="button" class="action-link" data-cmd="rename-income-category" data-id="${gid}" data-name="${cname}">Edit</button></strong>${subs}<button type="button" class="action-link danger" data-cmd="delete-income-category" data-id="${gid}" data-name="${cname}">Delete Category</button></div>`;
    }).join('');
    if(!cats)return '';
    return `<div class="category-group income-group"><strong>${esc(g.type)} · ${esc(g.majorHead)} <button type="button" class="action-link" data-cmd="rename-income-group" data-id="${gid}">Edit</button></strong>${cats}<button type="button" class="action-link danger" data-cmd="delete-income-group" data-id="${gid}">Delete Major Head</button></div>`;
  }).join('');
  document.getElementById('categoryTree').innerHTML=tree+(incomeTree?`<div class="cat-section-title">Income &amp; Expenses</div>`+incomeTree:'')||'<p class="hint">No categories match these filters.</p>';
}
async function addCategory(event){
  event.preventDefault();
  const type=document.getElementById('categoryType').value;
  const name=document.getElementById('categoryName').value.trim();
  const subcategory=document.getElementById('subcategoryName').value.trim();
  if(!type){toast('Select a financial type before adding a subcategory.',true);return}
  if(!name){toast('Select a category or use + Add to create one first.',true);return}
  if(type==='Income'||type==='Expense'){
    await addIncomeGroupCategory(type,name,subcategory);
    return;
  }
  if(!subcategory){toast('Enter a subcategory name.',true);return}
  let category=state.categories.find(c=>c.type===type&&c.name===name);
  if(category){
    if(!category.subcategories.includes(subcategory))category.subcategories.push(subcategory);
  }
  if(category)await put('categories',category);
  else{toast('Create the category first using + Add.',true);return}
  await loadState();
  document.getElementById('subcategoryName').value='';
  renderCategoryNameOptions();renderCategoryTree();renderDashboardFilters();renderAll();toast('Category structure updated');
}
async function saveNewCategory(){
  const type=document.getElementById('categoryType').value;
  const name=document.getElementById('newCategoryName').value.trim();
  let selectedName=name;
  let selectedMajorHead='';
  if(!type){toast('Select a financial type before adding a category.',true);return}
  if(!name){toast('Enter a category name.',true);return}
  if(type==='Income'||type==='Expense'){
    let majorHead=document.getElementById('categoryMajorHead').value;
    if(majorHead==='__new__')majorHead=normClass(document.getElementById('newMajorHead').value);
    if(!majorHead){toast('Select or enter a Major Head before adding a category.',true);return}
    let group=state.incomeGroups.find(g=>g.type===type&&g.majorHead===majorHead);
    if(!group){group={id:uid('ig'),type,majorHead,categories:[]};state.incomeGroups.push(group)}
    let category=group.categories.find(c=>c.name.toLowerCase()===name.toLowerCase());
    if(!category){category={name,subcategories:[]};group.categories.push(category)}
    selectedName=category.name;
    selectedMajorHead=majorHead;
    await putMany('incomeGroups',state.incomeGroups);
  }else{
    let category=state.categories.find(c=>c.type===type&&c.name.toLowerCase()===name.toLowerCase());
    if(!category){category={id:uid('category'),type,name,subcategories:[]};await put('categories',category)}
    else selectedName=category.name;
  }
  await loadState();
  document.getElementById('newCategoryRow').classList.add('hidden');
  document.getElementById('newCategoryName').value='';
  if(selectedMajorHead){
    renderCategoryMajorHeads();
    document.getElementById('categoryMajorHead').value=selectedMajorHead;
  }
  renderCategoryNameOptions();
  document.getElementById('categoryName').value=selectedName;
  renderCategoryTree();renderDashboardFilters();renderAll();renderIncomePage();
  toast(`Category "${selectedName}" is ready for subcategories.`);
}
async function deleteCategory(id){
  const category=state.categories.find(c=>c.id===id);
  if(!category)return;
  const linked=state.records.some(r=>r.type===category.type&&r.category===category.name);
  if(linked){toast('This category has linked records and cannot be deleted.',true);return}
  if(await confirm(`Delete category "${category.name}" and all of its subcategories?`,`Delete Category`)){
    await remove('categories',id);await loadState();renderCategoryTree();renderAll();toast('Category deleted');
  }
}

async function renameCategory(id){
  const category=state.categories.find(c=>c.id===id);if(!category)return;
  const name=prompt('Edit category name:',category.name);
  if(!name||name.trim()===category.name)return;
  const newName=name.trim(),oldName=category.name;
  category.name=newName;
  await put('categories',category);
  for(const record of state.records.filter(r=>r.type===category.type&&r.category===oldName)){record.category=newName;await put('records',record)}
  // keep the PDF metadata in step, or a backup would file the document under the old category
  for(const doc of state.documents.filter(d=>d.financialType===category.type&&d.category===oldName)){doc.category=newName;await put('documents',doc)}
  await loadState();renderCategoryTree();renderAll();toast('Category renamed');
}
async function renameSubcategory(categoryId,oldName){
  const category=state.categories.find(c=>c.id===categoryId);if(!category||!oldName)return;
  const name=prompt('Edit subcategory name:',oldName);
  if(!name||name.trim()===oldName)return;
  const newName=name.trim();
  category.subcategories=category.subcategories.map(s=>s===oldName?newName:s);
  await put('categories',category);
  for(const record of state.records.filter(r=>r.type===category.type&&r.category===category.name&&r.subcategory===oldName)){record.subcategory=newName;await put('records',record)}
  for(const doc of state.documents.filter(d=>d.financialType===category.type&&d.category===category.name&&d.subcategory===oldName)){doc.subcategory=newName;await put('documents',doc)}
  await loadState();renderCategoryTree();renderAll();toast('Subcategory renamed');
}
async function deleteSubcategory(categoryId,name){
  const category=state.categories.find(c=>c.id===categoryId);if(!category||!name)return;
  if(category.subcategories.length<=1){toast('A category needs at least one subcategory. Add another one first.',true);return}
  const linked=state.records.some(r=>r.type===category.type&&r.category===category.name&&r.subcategory===name);
  if(linked){toast('This subcategory has linked records and cannot be deleted.',true);return}
  if(await confirm(`Delete subcategory "${name}"?`,`Delete Subcategory`)){
    category.subcategories=category.subcategories.filter(s=>s!==name);
    await put('categories',category);await loadState();renderCategoryTree();renderAll();toast('Subcategory deleted');
  }
}

function renderSettings(){
  document.getElementById('currencySetting').value=state.settings.currency||'BDT';
  document.getElementById('localeSetting').value=state.settings.locale||'en-BD';
  renderYearList();
  renderMigrationHistory();
  renderStorageInfo();
}
function renderYearList(){
  document.getElementById('yearList').innerHTML=(state.settings.incomeYears||[]).map(y=>`<span class="chip">${esc(y)} <button type="button" class="action-link danger" data-cmd="delete-year" data-id="${esc(y)}" aria-label="Delete income year ${esc(y)}">×</button></span>`).join('');
}
/** Storage pressure is the main long-term risk for an offline-first app; show it honestly. */
async function renderStorageInfo(){
  const label=document.getElementById('storageInfo'),bar=document.getElementById('storageBar');
  if(!label)return;
  const counts=`${state.records.length} record${state.records.length===1?'':'s'} · ${state.documents.length} PDF${state.documents.length===1?'':'s'}`;
  if(!navigator.storage||!navigator.storage.estimate){label.textContent=counts;return}
  try{
    const {usage=0,quota=0}=await navigator.storage.estimate();
    label.textContent=`${formatFileSize(usage)} of ${formatFileSize(quota)} used · ${counts}`;
    if(bar)bar.style.width=`${quota?Math.min(100,(usage/quota)*100):0}%`;
  }catch(e){label.textContent=counts}
}
async function saveSettings(){
  state.settings.currency=document.getElementById('currencySetting').value;
  state.settings.locale=document.getElementById('localeSetting').value;
  await put('settings',{key:'currency',value:state.settings.currency});
  await put('settings',{key:'locale',value:state.settings.locale});
  await put('settings',{key:'incomeYears',value:state.settings.incomeYears||[]});
  renderAll();toast('Settings saved');
}
async function addIncomeYear(){
  const year=document.getElementById('newYear').value.trim();
  if(!year)return;
  state.settings.incomeYears=[...new Set([...(state.settings.incomeYears||[]),year])].sort((a,b)=>String(b).localeCompare(String(a)));
  await put('settings',{key:'incomeYears',value:state.settings.incomeYears});
  document.getElementById('newYear').value='';
  renderSettings();renderDashboardFilters();toast('Income year added');
}
async function deleteIncomeYear(year){
  if(await confirm(`Delete income year ${year}?`,'Delete Income Year')){
    state.settings.incomeYears=(state.settings.incomeYears||[]).filter(y=>String(y)!==String(year));
    await put('settings',{key:'incomeYears',value:state.settings.incomeYears});
    renderSettings();renderDashboardFilters();toast('Income year deleted');
  }
}

async function createBackup(){
  if(!window.JSZip){toast('ZIP library is unavailable. Check your internet connection.',true);return}
  try{
    await loadState();
    const settings=await getAll('settings');
    const zip=new JSZip();
    const backup={
      records:state.records,
      categories:state.categories,
      incomeExpenses:state.incomeExpenses,
      incomeGroups:state.incomeGroups,
      migrationHistory:state.migrationHistory,
      documents:state.documents.map(({blob,...doc})=>doc),
      settings:settings.reduce((out,s)=>(out[s.key]=s.value,out),{}),
      backupDate:new Date().toISOString(),
      version:'1.1'
    };
    zip.file('backup.json',JSON.stringify(backup,null,2));
    zip.file('metadata.json',JSON.stringify({name:'Personal Finance Management System',version:'1.1',database:DB_NAME,createdAt:backup.backupDate,records:state.records.length,incomeExpenses:state.incomeExpenses.length,documents:state.documents.length},null,2));
    const folder=zip.folder('documents');
    for(const doc of state.documents){
      const bytes=await getDocBlob(doc.id);                 // read each PDF only while it is being written
      const kind={Income:'income',Expense:'expenses',Liability:'liabilities'}[doc.financialType]||'assets';
      if(bytes)folder.file(`${kind}/${doc.id}-${doc.name||'document.pdf'}`,bytes);
    }
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
    const fileName=`Personal-Finance-Backup-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`;
    await saveFile(blob,fileName);                         // deliver the file first - history is secondary
    try{                                                   // metadata only: storing every ZIP again would exhaust browser storage
      await put('backupHistory',{id:uid('backup'),date:backup.backupDate,fileName,size:blob.size,recordCount:state.records.length,documentCount:state.documents.length});
      await loadState();renderBackupHistory();
    }catch(historyError){console.warn('Backup history not saved',historyError)}
    toast('Full backup created and downloaded');
  }catch(error){
    console.error(error);toast(`Backup failed: ${error.message||error}`,true);
  }
}
function renderBackupHistory(){
  const history=state.backupHistory.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  document.getElementById('backupTable').innerHTML=`<thead><tr><th scope="col">Backup Date</th><th scope="col">File Name</th><th scope="col">Records</th><th scope="col">Documents</th><th scope="col">File Size</th></tr></thead><tbody>${history.map(b=>`<tr><td>${esc(new Date(b.date).toLocaleString())}</td><td>${esc(b.fileName)}</td><td>${b.recordCount||0}</td><td>${b.documentCount||0}</td><td>${formatFileSize(b.size)}</td></tr>`).join('')||'<tr><td colspan="5"><div class="empty-state">No backups created in this browser yet.</div></td></tr>'}</tbody>`;
}
const MAX_RESTORE_BYTES=250*1024*1024;
async function performRestore(){
  if(!restoreFile)return;
  const mode=document.querySelector('input[name="restoreMode"]:checked')?.value||'replace';
  document.getElementById('restoreModal').close();
  if(!window.JSZip){toast('ZIP library is unavailable.',true);return}
  if(restoreFile.size>MAX_RESTORE_BYTES){toast('That backup file is too large to restore safely.',true);restoreFile=null;document.getElementById('restoreFile').value='';return}
  try{
    const zip=await JSZip.loadAsync(restoreFile);
    const backupFile=zip.file('backup.json');if(!backupFile)throw new Error('Missing backup.json');
    const backup=JSON.parse(await backupFile.async('text'));
    if(!backup.records||!backup.categories||backup.version!==undefined&&Number.parseFloat(backup.version)<1)throw new Error('Unsupported or invalid backup format');
    const incomeExpenses=backup.incomeExpenses||[];
    const incomeGroups=backup.incomeGroups||[];
    const migrationHistory=backup.migrationHistory||[];
    const documents=(backup.documents||[]).map(doc=>{const clean=Object.assign({},doc);delete clean.blob;return clean});
    // Read every PDF into memory BEFORE touching the database, so a broken archive cannot
    // destroy good local data.
    const blobs=[];
    const paths=Object.keys(zip.files).filter(p=>p.startsWith('documents/')&&!zip.files[p].dir);
    for(const path of paths){
      const entry=documents.find(d=>path.includes(d.id));
      if(!entry)continue;
      const bytes=await zip.files[path].async('blob');
      blobs.push({id:entry.id,blob:new Blob([bytes],{type:'application/pdf'})});
    }

    if(mode==='replace'){
      // One transaction per store: a quota failure leaves that store untouched instead of half written.
      await replaceStore('categories',backup.categories||[]);
      await replaceStore('records',backup.records||[]);
      await replaceStore('incomeGroups',incomeGroups);
      await replaceStore('incomeExpenses',incomeExpenses);
      await replaceStore('migrationHistory',migrationHistory);
      await replaceStore('documents',documents);
      await replaceStore('documentBlobs',blobs);
    }else{
      for(const category of backup.categories||[]){if(!await getOne('categories',category.id))await put('categories',category)}
      for(const record of backup.records||[]){if(!await getOne('records',record.id))await put('records',record)}
      for(const group of incomeGroups){if(!await getOne('incomeGroups',group.id))await put('incomeGroups',group)}
      for(const entry of incomeExpenses){if(!await getOne('incomeExpenses',entry.id))await put('incomeExpenses',entry)}
      for(const mig of migrationHistory){if(!await getOne('migrationHistory',mig.id))await put('migrationHistory',mig)}
      for(const document of documents){if(!await getOne('documents',document.id))await put('documents',document)}
      for(const blob of blobs){if(!await getOne('documentBlobs',blob.id))await put('documentBlobs',blob)}
    }
    for(const [key,value] of Object.entries(backup.settings||{}))await put('settings',{key,value});
    await loadState();
    state.settings=(await getAll('settings')).reduce((out,s)=>(out[s.key]=s.value,out),state.settings||{});
    renderAll();
    toast(`Backup restored: ${backup.records?.length||0} record(s), ${incomeExpenses.length} transaction(s) and ${blobs.length} document(s)`);
  }catch(error){
    console.error(error);toast(error.message||'Unable to restore backup.',true);
  }finally{
    restoreFile=null;document.getElementById('restoreFile').value='';
  }
}


function exportBalanceExcel(){
  if(!window.XLSX){toast('Excel library is unavailable.',true);return}
  const year=balanceYear||'';
  const data=buildBalanceData(year);
  const rows=[['Personal Balance Sheet'],[year?`Income Year: ${year}`:'All Income Years'],[`Generated ${generatedStamp()}`],[],['Particulars','Amount / Balance']];
  const bold=[];
  const block=(title,sec)=>{
    rows.push([title,'']);
    sec.cats.forEach(c=>{
      rows.push([c.name,c.total]);
      c.subs.forEach(sub=>rows.push([`      ${sub.name}`,sub.total]));
    });
    rows.push([`Total ${title}`,sec.total]);
    const idx=rows.length-1;rows.push([]);return idx;
  };
  const aRow=block('ASSETS',data.assets),lRow=block('LIABILITIES',data.liabilities);
  rows.push(['NET WORTH',data.net]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  rows.forEach((r,i)=>{if(typeof r[1]==='number'){const addr=XLSX.utils.encode_cell({r:i,c:1});ws[addr].z='#,##0.00'}});
  const netAddr=XLSX.utils.encode_cell({r:rows.length-1,c:1});
  ws[netAddr]={t:'n',v:data.net,f:`B${aRow+1}-B${lRow+1}`,z:'#,##0.00'};
  ws['!cols']=[{wch:48},{wch:22}];
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,ws,'Balance Sheet');
  XLSX.writeFile(workbook,`Balance-Sheet-${year||'All-Years'}-${todayISO()}.xlsx`);
  toast('Balance Sheet exported');
}

/* ==========================================================================
   Excel: flat export + schema-driven import (header rows detected per sheet)
   ========================================================================== */
function exportFilteredExcel(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const records=getFilteredRecords();
  const rows=records.map(r=>({
    Type:r.type,Category:r.category,Subcategory:r.subcategory,Date:r.date||'',Particulars:r.particulars||r.name||'',
    Details:r.details||r.description||'','Detail / Account':r.detailRef||r.accountDetail||'','Income Year':r.incomeYear||'',
    'Property Category':r.propertyCategory||'','Item Category':r.itemCategory||'','Type of Acquisition':r.acquisition||'',
    'Area':r.area||'','Registration No.':r.registrationNo||'','Engine Capacity':r.engineCapacity||'','Quantity / Weight':r.quantity||'',
    'Purchase Value':Number(r.purchaseValue||0),'Current Market Value':Number(r.currentMarketValue||0),
    'Amount / Balance':recordAmount(r),Remarks:r.remarks||'',Documents:(r.documentIds||[]).length
  }));
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),'Filtered Records');
  XLSX.writeFile(workbook,`Financial-Records-${todayISO()}.xlsx`);
  toast('Excel data exported');
}

const nrm=s=>String(s??'').replace(/\s+/g,' ').trim().toLowerCase();

function parseExcelNumber(value){
  if(typeof value==='number')return Number.isFinite(value)?value:0;
  if(!value)return 0;
  const cleaned=String(value).replace(/[,৳$€£\s]/g,'').trim();
  const number=Number(cleaned);
  return Number.isFinite(number)?number:0;
}
function normalizeExcelDate(value){
  if(value===''||value===null||value===undefined)return '';
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return `${value.getFullYear()}-${pad2(value.getMonth()+1)}-${pad2(value.getDate())}`;
  if(typeof value==='number'){
    if(value<=0)return '';
    // Excel's date part is the integer portion of the serial; rounding a timestamp would shift the day.
    const serial=Math.floor(value);
    const date=new Date(Math.round((serial-25569)*86400*1000));
    return Number.isNaN(date.getTime())?'':date.toISOString().slice(0,10);
  }
  const s=String(value).trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  // 3-part loose dates: d/m/yyyy is the local convention, but a value above 12 can only be
  // the day, so m/d/yyyy files are detected instead of silently swapping day and month.
  m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if(m){
    let day=+m[1],month=+m[2];
    if(month>12&&day<=12){const swap=day;day=month;month=swap}
    if(day<1||day>31||month<1||month>12)return '';
    return `${m[3]}-${pad2(month)}-${pad2(day)}`;
  }
  const date=new Date(s);
  return Number.isNaN(date.getTime())?'':`${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
}

function findSchemaBySheet(sheetName){
  const n=nrm(sheetName);
  return SCHEMAS.find(s=>{const target=nrm(s.sheet);return target===n||(n.length>=28&&target.startsWith(n))});
}
function schemaImportColumns(schema){
  const cols=[];
  if(schema.hasDate)cols.push({key:'date',aliases:['date']});
  schema.fields.forEach(f=>cols.push({key:f.key,aliases:f.excel||[],type:f.type,norm:f.normalize}));
  if(schema.detailsExcel)cols.push({key:'details',aliases:schema.detailsExcel});
  if(schema.amountExcel.length)cols.push({key:'amount',aliases:schema.amountExcel,type:'money'});
  return cols;
}
function findLastUpdated(aoa){
  for(const row of aoa){
    for(let c=0;c<(row||[]).length;c++){
      if(nrm(row[c])==='last updated'){
        for(let k=c+1;k<row.length;k++){const d=normalizeExcelDate(row[k]);if(d)return d}
      }
    }
  }
  return '';
}

/**
 * Pure mapping of one worksheet (array-of-arrays) to records.
 * The header row is located by matching the schema's column names (rows 11-14 depending on the sheet);
 * only the leftmost occurrence of each header is used, so helper tables on the right are ignored,
 * and reading stops at the "Total" row.
 */
function mapSheetToRecords(schema,aoa){
  const cols=schemaImportColumns(schema);
  let headerRow=-1,map=null;
  for(let i=0;i<Math.min(aoa.length,40);i++){
    const cells=(aoa[i]||[]).map(nrm),found={};let hits=0;
    cols.forEach(c=>{const idx=cells.findIndex(x=>c.aliases.includes(x));if(idx>=0){found[c.key]=idx;hits++}});
    if(hits>=2){headerRow=i;map=found;break}
  }
  if(headerRow<0)return {records:[],headerRow:-1};
  const idxs=Object.values(map),minC=Math.min(...idxs),maxC=Math.max(...idxs);
  const lastUpdated=findLastUpdated(aoa);
  const records=[];
  for(let r=headerRow+1;r<aoa.length;r++){
    const row=aoa[r]||[];
    let isTotal=false;
    for(let c=Math.max(0,minC-1);c<=maxC;c++){if(nrm(row[c])==='total'){isTotal=true;break}}
    if(isTotal)break;
    const raw={};let meaningful=false;
    for(const c of cols){
      if(!(c.key in map))continue;
      const value=row[map[c.key]];
      if(c.key==='date'){raw.date=normalizeExcelDate(value)}
      else if(c.type==='money'){const n=parseExcelNumber(value);raw[c.key]=n;if(n!==0)meaningful=true}
      else{
        let s=String(value??'').trim();
        if(/^#(VALUE|REF|N\/A|NAME|DIV)/i.test(s))s='';
        if(c.norm)s=c.norm(s);
        raw[c.key]=s;
        if(s&&c.key!=='incomeYear')meaningful=true;
      }
    }
    if(!meaningful)continue;
    const date=schema.hasDate?(raw.date||''):lastUpdated;
    const record={
      type:schema.type,category:schema.category,subcategory:schema.subcategory,date,
      details:raw.details||'',documentIds:[],sourceSheet:schema.sheet,sourceRow:r+1
    };
    for(const f of schema.fields){
      if(f.type==='money')record[f.key]=raw[f.key]||0;
      else if(raw[f.key]!==undefined)record[f.key]=raw[f.key];
    }
    let amount=raw.amount||0;
    if(schema.amountSync==='market')amount=record.currentMarketValue||record.purchaseValue||0;
    if(schema.amountSync==='purchase')record.purchaseValue=amount;
    record.amount=amount;record.balance=amount;
    if(!record.incomeYear){const fy=fiscalYearFromDate(date);if(fy)record.incomeYear=fy}
    records.push(record);
  }
  return {records,headerRow};
}

const MAX_IMPORT_BYTES=30*1024*1024;      // bounds the work an untrusted workbook can cause
const MAX_IMPORT_ROWS=20000;
let replaceMigrationId=null;              // set while replacing a migration batch (Edit action)

/** Shared import pipeline: route a file to the right worker. `replaceId` re-imports into an existing batch. */
async function runImport(file,replaceId){
  if(!file)return;
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  if(file.size>MAX_IMPORT_BYTES){toast('That file is larger than 30 MB. Split it and import the parts.',true);return}
  try{
    const isCsv=/\.csv$/i.test(file.name||'');
    if(!isCsv){
      const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'});
      const first=workbook.SheetNames[0];
      const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[first],{header:1,defval:'',raw:true});
      if(detectBudgeHeader(aoa)>=0){
        await importBudgeFile(aoa,file.name,replaceId);
      }else if(isIncomeExpensesWorkbook(workbook)){
        await importIncomeExpensesWorkbook(workbook,replaceId,file.name);
      }else{
        await importAssetsLiabilitiesWorkbook(workbook,replaceId,file.name);
      }
    }else{
      const text=(await file.text()).replace(/^\uFEFF/,'');
      const wb=XLSX.read(text,{type:'string',raw:true});
      const aoa=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:true});
      if(detectBudgeHeader(aoa)>=0){
        await importBudgeFile(aoa,file.name,replaceId);
      }else{
        toast('That CSV file is not a recognised Budge export.',true);
      }
    }
  }catch(error){
    console.error(error);toast(error.message||'Unable to import file.',true);
  }
}

async function importExcel(event){
  const file=event.target.files[0];
  try{await runImport(file,null)}finally{event.target.value='';}
}
/** File chosen via the migration editor's "Replace" button: re-import into the same batch. */
async function replaceMigrationFile(event){
  const file=event.target.files[0],migId=replaceMigrationId;
  event.target.value='';
  if(!file||!migId)return;
  const mig=state.migrationHistory.find(m=>m.id===migId);
  if(mig)document.getElementById('migrationEditModal').close();
  await runImport(file,migId);
  replaceMigrationId=null;
}

/* ==========================================================================
   Filter-wise reports (PDF via jsPDF + AutoTable, Excel via SheetJS)
   ========================================================================== */
function describeFilters(){
  const f=dashFilters;
  const range=(f.from||f.to)?`${fmtDate(f.from)||'Any'} to ${fmtDate(f.to)||'Any'}`:'All dates';
  return [
    ['Type',f.type||'All'],['Category',f.category||'All'],['Subcategory',f.subcategory||'All'],
    ['Income Year',f.year||'All'],['Date Range',range]
  ];
}
const filterText=()=>describeFilters().map(([k,v])=>`${k}: ${v}`).join('   |   ');
function generatedStamp(){
  const d=new Date();
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function reportDetailsLabel(schema){
  return /^Excel:/.test(schema.detailsHint||'')?schema.detailsHint.replace(/^Excel:\s*/,''):'Details / Description';
}

/** Records -> [{type,category,tables:[{name,records,cols}],total,count,orient}] (Assets first, then Liabilities). */
function groupRecordsForReport(records){
  const order=[...defaultCategories,...state.categories].map(c=>`${c.type}|${c.name}`);
  const map=new Map();
  records.forEach(r=>{
    const key=`${r.type}|${r.category}`;
    if(!map.has(key))map.set(key,{type:r.type,category:r.category,records:[]});
    map.get(key).records.push(r);
  });
  const rank=g=>{const i=order.indexOf(`${g.type}|${g.category}`);return i<0?999:i};
  const groups=[...map.values()].sort((a,b)=>(a.type===b.type?0:a.type==='Asset'?-1:1)||rank(a)-rank(b)||a.category.localeCompare(b.category));
  groups.forEach(g=>{
    const catDef=state.categories.find(c=>c.type===g.type&&c.name===g.category);
    const subOrder=catDef?.subcategories||[];
    const subs=new Map();
    g.records.forEach(r=>{if(!subs.has(r.subcategory))subs.set(r.subcategory,[]);subs.get(r.subcategory).push(r)});
    g.tables=[...subs.entries()]
      .sort((a,b)=>{const ia=subOrder.indexOf(a[0]),ib=subOrder.indexOf(b[0]);return (ia<0?999:ia)-(ib<0?999:ib)||a[0].localeCompare(b[0])})
      .map(([name,recs])=>{
        recs.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||recordTitle(a).localeCompare(recordTitle(b)));
        return {name,records:recs,schema:getSchema(g.category,name),cols:reportColumns(getSchema(g.category,name),recs),total:recs.reduce((s,r)=>s+recordAmount(r),0)};
      });
    g.total=g.tables.reduce((s,t)=>s+t.total,0);
    g.count=g.records.length;
    g.orient=Math.max(...g.tables.map(t=>t.cols.length))>5?'l':'p';
  });
  return groups;
}
/** Date first · schema columns (only those with data) in the middle · Amount / Balance last. */
function reportColumns(schema,recs){
  const mids=schema.fields.map(f=>({key:f.key,label:f.label,kind:f.type==='money'?'money':'text',required:f.required}));
  mids.splice(Math.min(schema.detailsAfter,mids.length),0,{key:'details',label:reportDetailsLabel(schema),kind:'text',required:schema.detailsRequired});
  const keep=mids.filter(c=>c.required||recs.some(r=>c.kind==='money'?Number(r[c.key])>0:String(r[c.key]??'').trim()!==''));
  return [{key:'date',label:'Date',kind:'date'},...keep,{key:'amount',label:'Amount / Balance',kind:'amount'}];
}
function pdfMoney(value){
  const prefix={BDT:'BDT ',USD:'$',EUR:'EUR ',GBP:'GBP '}[state.settings.currency||'BDT']||'BDT ';  // built-in PDF fonts cannot draw the taka sign
  return prefix+(Number(value)||0).toLocaleString(state.settings.locale||'en-BD',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function reportCell(r,col){
  if(col.key==='date')return fmtDate(r.date)||'-';
  if(col.key==='amount')return pdfMoney(recordAmount(r));
  if(col.kind==='money')return Number(r[col.key])?pdfMoney(r[col.key]):'-';
  const v=String(r[col.key]??'').trim();
  return v||'-';
}

async function generatePdfReport(){
  const records=getFilteredRecords();
  if(!records.length){toast('No records match the current filters.',true);return}
  const JsPDF=window.jspdf&&window.jspdf.jsPDF;
  if(!JsPDF){toast('PDF library is unavailable. Check your internet connection.',true);return}
  const groups=groupRecordsForReport(records);
  const doc=new JsPDF({orientation:groups[0].orient,unit:'pt',format:'a4',compress:true});
  if(typeof doc.autoTable!=='function'){toast('PDF table plugin is unavailable. Check your internet connection.',true);return}
  doc.setProperties({title:'Personal Finance - Financial Report',subject:filterText(),creator:'SOIKOT RAIHAN'});

  const M=36,HEAD_H=132,FOOT_H=34;
  let orient=groups[0].orient;
  const nativeAddPage=doc.addPage.bind(doc);
  doc.addPage=(format,o)=>nativeAddPage(format||'a4',o||orient);   // AutoTable's own page breaks keep this category's orientation
  const drawn=new Set();
  const pageNo=()=>doc.internal.getCurrentPageInfo().pageNumber;
  const size=()=>({W:doc.internal.pageSize.getWidth(),H:doc.internal.pageSize.getHeight()});
  const stamp=generatedStamp();
  const palette={
    Asset:{fill:[236,253,245],accent:[16,185,129],ink:[6,95,70]},
    Liability:{fill:[255,241,242],accent:[244,63,94],ink:[159,18,57]},
    Summary:{fill:[238,242,255],accent:[79,70,229],ink:[49,46,129]}
  };

  function drawHeader(banner){
    const {W}=size();
    doc.setFillColor(79,70,229);doc.rect(0,0,W,42,'F');
    doc.setFillColor(16,185,129);doc.rect(0,42,W,3,'F');
    doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(14);
    doc.setDrawColor(255,255,255);doc.setLineWidth(1.3);doc.circle(M+14,22,14,'S');   // SR monogram
    doc.setFont('times','bold');doc.setFontSize(12);doc.text('SR',M+14,26.5,{align:'center'});
    doc.setFont('helvetica','bold');doc.setFontSize(14);
    doc.text('Personal Finance  |  Financial Report',M+38,27);
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);
    doc.text(`Generated ${stamp}`,W-M,27,{align:'right'});
    doc.setTextColor(100,116,139);doc.setFontSize(8);
    doc.text(doc.splitTextToSize(filterText(),W-2*M).slice(0,2),M,62);
    const p=palette[banner.kind];
    doc.setFillColor(...p.fill);doc.roundedRect(M,80,W-2*M,40,6,6,'F');
    doc.setFillColor(...p.accent);doc.roundedRect(M,80,5,40,2,2,'F');
    doc.setTextColor(...p.ink);doc.setFont('helvetica','bold');doc.setFontSize(13);
    doc.text(banner.title,M+16,98);
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(71,85,105);
    doc.text(doc.splitTextToSize(banner.sub||'',W-2*M-170)[0]||'',M+16,112);
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(...p.ink);
    doc.text(banner.tag||'',W-M-12,98,{align:'right'});
    drawn.add(pageNo());
  }
  const bannerFor=(g,continued)=>({
    kind:g.type,title:`${g.type.toUpperCase()}  >  ${g.category}`,
    sub:g.tables.map(t=>`${t.name} (${t.records.length})`).join('  |  '),
    tag:continued?'(continued)':`${g.count} record${g.count===1?'':'s'}`
  });
  const baseStyles={font:'helvetica',fontSize:8.5,cellPadding:{top:5,bottom:5,left:6,right:6},lineColor:[226,232,240],lineWidth:.5,textColor:[30,41,59],valign:'middle',overflow:'linebreak'};
  const margin={top:HEAD_H,left:M,right:M,bottom:FOOT_H};

  groups.forEach((g,gi)=>{
    orient=g.orient;
    if(gi>0)doc.addPage('a4',g.orient);
    drawHeader(bannerFor(g,false));
    let y=HEAD_H;
    const onPage=()=>{if(!drawn.has(pageNo()))drawHeader(bannerFor(g,true))};
    g.tables.forEach(t=>{
      if(y>size().H-FOOT_H-120){doc.addPage();drawHeader(bannerFor(g,true));y=HEAD_H}
      const n=t.cols.length,single=g.tables.length===1;
      const numeric=c=>c.kind==='amount'||c.kind==='money';
      const columnStyles={};
      t.cols.forEach((c,i)=>{
        if(c.kind==='date')columnStyles[i]={cellWidth:62};
        if(c.kind==='amount')columnStyles[i]={halign:'right',fontStyle:'bold',cellWidth:96};
        if(c.kind==='money')columnStyles[i]={halign:'right',cellWidth:86};
      });
      doc.autoTable({
        startY:y,theme:'grid',margin,styles:baseStyles,columnStyles,
        head:[
          [{content:`${t.name}   -   ${t.records.length} record${t.records.length===1?'':'s'}`,colSpan:n,styles:{halign:'left',fillColor:[238,242,255],textColor:[49,46,129],fontStyle:'bold',fontSize:9,cellPadding:{top:6,bottom:6,left:8,right:6}}}],
          t.cols.map(c=>({content:c.label,styles:{halign:numeric(c)?'right':'left'}}))
        ],
        body:t.records.map(r=>t.cols.map(c=>reportCell(r,c))),
        foot:[[{content:single?`Category Subtotal - ${g.category}`:`Subtotal - ${t.name}`,colSpan:n-1,styles:{halign:'right'}},{content:pdfMoney(t.total),styles:{halign:'right'}}]],
        headStyles:{fillColor:[15,23,42],textColor:[255,255,255],fontStyle:'bold',fontSize:8.5},
        footStyles:{fillColor:[241,245,249],textColor:[15,23,42],fontStyle:'bold',lineColor:[99,102,241],lineWidth:.8},
        alternateRowStyles:{fillColor:[248,250,252]},
        showHead:'everyPage',showFoot:'lastPage',rowPageBreak:'avoid',
        didDrawPage:onPage
      });
      y=doc.lastAutoTable.finalY+14;
    });
    if(g.tables.length>1){
      if(y>size().H-FOOT_H-60){doc.addPage();drawHeader(bannerFor(g,true));y=HEAD_H}
      const {W}=size();
      doc.autoTable({
        startY:y,theme:'grid',margin,tableWidth:W-2*M,didDrawPage:onPage,
        body:[[{content:`Category Subtotal - ${g.category}`,styles:{halign:'right'}},{content:pdfMoney(g.total),styles:{halign:'right'}}]],
        columnStyles:{1:{cellWidth:140}},
        styles:{...baseStyles,fontStyle:'bold',fontSize:10,fillColor:[238,242,255],textColor:[49,46,129],lineColor:[99,102,241],lineWidth:1}
      });
    }
  });

  // Grand summary (always portrait, last page)
  orient='p';
  doc.addPage('a4','p');
  const assetTotal=groups.filter(g=>g.type==='Asset').reduce((s,g)=>s+g.total,0);
  const liabTotal=groups.filter(g=>g.type==='Liability').reduce((s,g)=>s+g.total,0);
  const hasA=groups.some(g=>g.type==='Asset'),hasL=groups.some(g=>g.type==='Liability');
  drawHeader({kind:'Summary',title:'GRAND SUMMARY',sub:`${groups.length} categor${groups.length===1?'y':'ies'} · ${records.length} record${records.length===1?'':'s'}`,tag:pdfMoney(hasA&&hasL?assetTotal-liabTotal:hasA?assetTotal:liabTotal)});
  const totalRow=(label,value,fill,ink)=>[{content:label,colSpan:3,styles:{halign:'right',fontStyle:'bold',fillColor:fill,textColor:ink}},{content:pdfMoney(value),styles:{halign:'right',fontStyle:'bold',fillColor:fill,textColor:ink}}];
  const body=[];
  ['Asset','Liability'].forEach(type=>{
    const list=groups.filter(g=>g.type===type);
    list.forEach(g=>body.push([type,g.category,String(g.count),{content:pdfMoney(g.total),styles:{halign:'right'}}]));
    if(list.length)body.push(totalRow(type==='Asset'?'Total Assets':'Total Liabilities',type==='Asset'?assetTotal:liabTotal,type==='Asset'?[209,250,229]:[255,228,230],type==='Asset'?[6,95,70]:[159,18,57]));
  });
  if(hasA&&hasL)body.push(totalRow('NET WORTH',assetTotal-liabTotal,[49,46,129],[255,255,255]));
  doc.autoTable({
    startY:HEAD_H,theme:'grid',margin,styles:{...baseStyles,fontSize:9.5,cellPadding:7},
    head:[['Type','Category','Records',{content:'Amount / Balance',styles:{halign:'right'}}]],
    body,headStyles:{fillColor:[15,23,42],textColor:[255,255,255],fontStyle:'bold'},
    alternateRowStyles:{fillColor:[248,250,252]},
    columnStyles:{2:{halign:'center',cellWidth:60},3:{cellWidth:130}},
    didDrawPage:()=>{if(!drawn.has(pageNo()))drawHeader({kind:'Summary',title:'GRAND SUMMARY',sub:'(continued)',tag:''})}
  });

  // Footers: "Page X of Y"
  const total=doc.getNumberOfPages();
  for(let i=1;i<=total;i++){
    doc.setPage(i);
    const {W,H}=size();
    doc.setDrawColor(226,232,240);doc.setLineWidth(.6);doc.line(M,H-26,W-M,H-26);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,116,139);
    doc.text('Personal Finance  ·  SOIKOT RAIHAN',M,H-13);
    doc.text(`Page ${i} of ${total}`,W-M,H-13,{align:'right'});
  }
  doc.save(`Personal-Finance-Report-${dashFilters.year||'All-Years'}-${todayISO()}.pdf`);
  toast(`PDF report generated (${total} page${total===1?'':'s'})`);
}

const excelSerial=iso=>{
  const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m?Math.round((Date.UTC(+m[1],+m[2]-1,+m[3])-Date.UTC(1899,11,30))/86400000):null;
};
function safeSheetName(name,used){
  const base=String(name).replace(/[\\\/\?\*\[\]:]/g,' ').replace(/\s+/g,' ').trim().slice(0,27)||'Sheet';
  let candidate=base,i=2;
  while(used.has(candidate.toLowerCase()))candidate=`${base.slice(0,24)} ${i++}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
const MONEY_FMT='#,##0.00';
/** Builds a worksheet from a plain array-of-arrays, then applies number formats / formulas / merges. */
function makeSheet(rows,{widths=[],merges=[],money=[],dates=[],formulas=[]}={}){
  const ws=XLSX.utils.aoa_to_sheet(rows);
  const addr=(r,c)=>XLSX.utils.encode_cell({r,c});
  money.forEach(([r,c])=>{const a=addr(r,c);if(ws[a]){ws[a].t='n';ws[a].z=MONEY_FMT}});
  dates.forEach(([r,c])=>{const a=addr(r,c);if(ws[a]){ws[a].t='n';ws[a].z='dd-mmm-yyyy'}});
  formulas.forEach(([r,c,f,v])=>{ws[addr(r,c)]={t:'n',v,f,z:MONEY_FMT}});
  ws['!cols']=widths.map(w=>({wch:w}));
  if(merges.length)ws['!merges']=merges.map(([r1,c1,r2,c2])=>({s:{r:r1,c:c1},e:{r:r2,c:c2}}));
  return ws;
}
const plainMoney=v=>Number(v)||0;
const reportCellValue=(r,c)=>{
  if(c.key==='date')return excelSerial(r.date)||'';
  if(c.key==='amount')return recordAmount(r);
  if(c.kind==='money')return Number(r[c.key])||'';
  return String(r[c.key]??'').trim();
};

/**
 * Excel report - same structure as the PDF report:
 *  Summary sheet + one sheet per Category. Each sheet: subcategory banner -> column header row
 *  (Date first, specific columns in the middle, Amount / Balance last) -> data rows -> SUM subtotal,
 *  then a Category Subtotal.
 */
function generateExcelReport(){
  const records=getFilteredRecords();
  if(!records.length){toast('No records match the current filters.',true);return}
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const groups=groupRecordsForReport(records);
  const used=new Set(['summary']);
  const stamp=generatedStamp();
  const q=name=>`'${name.replace(/'/g,"''")}'`;
  const colName=XLSX.utils.encode_col;
  const sheets=[];                 // [{name, ws}] category sheets
  const refs=[];                   // cell references for the Summary sheet

  groups.forEach(g=>{
    const maxCols=Math.max(...g.tables.map(t=>t.cols.length));
    const rows=[
      ['Personal Finance - Financial Report'],
      [`${g.type} > ${g.category}`],
      [filterText()],
      [`Generated ${stamp}`],
      []
    ];
    const opts={widths:new Array(maxCols).fill(12),merges:[],money:[],dates:[],formulas:[]};
    const subtotalRefs=[],subRefs=[];
    const single=g.tables.length===1;
    const sheetName=safeSheetName(g.category,used);

    g.tables.forEach(t=>{
      const n=t.cols.length,amountIdx=n-1,letter=colName(amountIdx);
      // banner row
      const bannerRow=rows.length;
      rows.push([`${t.name}  -  ${t.records.length} record${t.records.length===1?'':'s'}`]);
      opts.merges.push([bannerRow,0,bannerRow,Math.max(n-1,1)]);
      // header row
      rows.push(t.cols.map(c=>c.label));
      const firstData=rows.length;           // 0-based index of the first data row
      t.records.forEach(r=>{
        const rowIndex=rows.length;
        rows.push(t.cols.map((c,ci)=>{
          const v=reportCellValue(r,c);
          if(c.key==='date'&&v!=='')opts.dates.push([rowIndex,ci]);
          if((c.kind==='money'||c.kind==='amount')&&v!=='')opts.money.push([rowIndex,ci]);
          return v;
        }));
      });
      const lastData=rows.length-1;
      // subtotal row (formula + cached value)
      const subRow=new Array(n).fill('');
      subRow[n-2>=0?n-2:0]=single?`Category Subtotal - ${g.category}`:`Subtotal - ${t.name}`;
      const subIndex=rows.length;
      rows.push(subRow);
      opts.formulas.push([subIndex,amountIdx,`SUM(${letter}${firstData+1}:${letter}${lastData+1})`,plainMoney(t.total)]);
      subtotalRefs.push(`${letter}${subIndex+1}`);
      subRefs.push({name:t.name,count:t.records.length,cell:`${letter}${subIndex+1}`});
      rows.push([]);
      // column widths: widest content per column index across all tables of this sheet
      t.cols.forEach((c,ci)=>{
        const longest=Math.max(c.label.length,...t.records.map(r=>{const v=reportCellValue(r,c);return c.key==='date'?11:String(v).length}));
        const cap=c.kind==='amount'||c.kind==='money'?22:48;
        opts.widths[ci]=Math.max(opts.widths[ci],Math.min(cap,longest+3));
      });
    });

    let totalCellRef;
    if(single){
      totalCellRef=subtotalRefs[0];
    }else{
      const lastCol=maxCols-1;
      const totalRow=new Array(maxCols).fill('');
      totalRow[Math.max(lastCol-1,0)]=`Category Subtotal - ${g.category}`;
      const idx=rows.length;
      rows.push(totalRow);
      // amount column of the category total = last column of the widest table; subtotals sit in each table's own last column
      opts.formulas.push([idx,lastCol,subtotalRefs.join('+'),plainMoney(g.total)]);
      totalCellRef=`${colName(lastCol)}${idx+1}`;
    }
    sheets.push({name:sheetName,ws:makeSheet(rows,opts)});
    refs.push({g,sheet:sheetName,total:totalCellRef,subs:subRefs.map(s=>({...s,sheet:sheetName}))});
  });

  // ---- Summary sheet ----
  const rows=[['Personal Finance - Financial Report'],['Applied filters'],...describeFilters().map(([k,v])=>[k,v]),[`Generated ${stamp}`],[],
    ['Type','Category','Subcategory','Records','Amount / Balance']];
  const opts={widths:[12,26,46,10,22],money:[],formulas:[]};
  const catRowIndex=[];
  refs.forEach(({g,sheet,total,subs})=>{
    const idx=rows.length;
    rows.push([g.type,g.category,'All subcategories',g.count,'']);
    opts.formulas.push([idx,4,`${q(sheet)}!${total}`,plainMoney(g.total)]);
    catRowIndex.push({type:g.type,idx});
    subs.forEach(s=>{
      const si=rows.length;
      rows.push(['','','   '+s.name,s.count,'']);
      opts.formulas.push([si,4,`${q(sheet)}!${s.cell}`,plainMoney(g.tables.find(t=>t.name===s.name).total)]);
    });
  });
  const assetTotal=groups.filter(g=>g.type==='Asset').reduce((s,g)=>s+g.total,0);
  const liabTotal=groups.filter(g=>g.type==='Liability').reduce((s,g)=>s+g.total,0);
  const hasA=groups.some(g=>g.type==='Asset'),hasL=groups.some(g=>g.type==='Liability');
  const sumOf=type=>catRowIndex.filter(c=>c.type===type).map(c=>`E${c.idx+1}`).join('+');
  rows.push([]);
  let assetIdx=-1,liabIdx=-1;
  if(hasA){assetIdx=rows.length;rows.push(['','','Total Assets','','']);opts.formulas.push([assetIdx,4,sumOf('Asset'),plainMoney(assetTotal)])}
  if(hasL){liabIdx=rows.length;rows.push(['','','Total Liabilities','','']);opts.formulas.push([liabIdx,4,sumOf('Liability'),plainMoney(liabTotal)])}
  if(hasA&&hasL){const i=rows.length;rows.push(['','','NET WORTH','','']);opts.formulas.push([i,4,`E${assetIdx+1}-E${liabIdx+1}`,plainMoney(assetTotal-liabTotal)])}

  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,makeSheet(rows,opts),'Summary');
  sheets.forEach(s=>XLSX.utils.book_append_sheet(workbook,s.ws,s.name));
  XLSX.writeFile(workbook,`Personal-Finance-Report-${dashFilters.year||'All-Years'}-${todayISO()}.xlsx`);
  toast(`Excel report generated (${sheets.length+1} sheets)`);
}

/* ==========================================================================
   Income & Expenses — classification helpers, import, page, modal, exports
   ========================================================================== */
const normClass=s=>String(s??'').replace(/\s+/g,' ').trim();
const normKey=s=>normClass(s).toLowerCase().replace(/\.+$/,'');
let incomeYearInit=false;
let incomeKpiPrev=[];
const FISCAL_MONTHS=['July','August','September','October','November','December','January','February','March','April','May','June'];
const fiscalMonthName=n=>FISCAL_MONTHS[(Number(n)||0)-1]||'';

function groupForMajorHead(majorHead){return state.incomeGroups.find(g=>g.majorHead===majorHead)||null}
function incomeMajorHeads(type){return (type?state.incomeGroups.filter(g=>g.type===type):state.incomeGroups).map(g=>g.majorHead)}
function incomeCategoriesFor(majorHead){const g=groupForMajorHead(majorHead);return g?g.categories.map(c=>c.name):[]}
function incomeSubcategoriesFor(majorHead,category){const g=groupForMajorHead(majorHead);const c=g&&g.categories.find(c=>c.name===category);return c?c.subcategories:[]}

/** Ensure a type > majorHead > category > subcategory path exists in the tree, auto-registering as needed. */
function ensureIncomeClass(type,majorHead,category,subcategory){
  majorHead=normClass(majorHead)||(type==='Income'?'Other Income':'Any Other Expenses');
  category=normClass(category);
  let group=state.incomeGroups.find(g=>g.type===type&&g.majorHead===majorHead);
  if(!group){group={id:uid('ig'),type,majorHead,categories:[]};state.incomeGroups.push(group)}
  let catDef=group.categories.find(c=>normKey(c.name)===normKey(category));
  if(!catDef){
    if(!category)category=type==='Income'?'General Income':'Miscellaneous';
    catDef=group.categories.find(c=>normKey(c.name)===normKey(category));
    if(!catDef){catDef={name:category,subcategories:[]};group.categories.push(catDef)}
  }
  let sub=normClass(subcategory);
  if(sub){
    const existing=catDef.subcategories.find(s=>normKey(s)===normKey(sub));
    if(existing)sub=existing;
    else catDef.subcategories.push(sub);
  }else{
    sub=catDef.subcategories[0]||'Any Other Expenses';
    if(!catDef.subcategories.length)catDef.subcategories.push(sub);
  }
  return {majorHead:group.majorHead,category:catDef.name,subcategory:sub};
}

/* --- Budge import normalization --- */
const BUDGE_CAT_ALIASES={
  Income:{
    'pgcl':{majorHead:'Income From Salary (PGCL)',category:'Salary & Bonuses'},
    'income from salary (pgcl)':{majorHead:'Income From Salary (PGCL)',category:'Salary & Bonuses'},
    'income from salary pgcl':{majorHead:'Income From Salary (PGCL)',category:'Salary & Bonuses'},
    'other receive (pgcl)':{majorHead:'Income From Other Receive (PGCL)',category:'Allowances & Other Receives'},
    'income from other receive (pgcl)':{majorHead:'Income From Other Receive (PGCL)',category:'Allowances & Other Receives'},
    'income from other receive pgcl':{majorHead:'Income From Other Receive (PGCL)',category:'Allowances & Other Receives'}
  },
  Expense:{
    'auto and transportation expenses':{majorHead:'Auto and Transportation Expenses'},
    'regular contribution for family':{majorHead:'Expenses for Food, Clothing and Other Essentials',category:'Contribution For Family',sub:'Regular'},
    'mobile recharge, internet etc':{majorHead:'Household and Utility Expenses',category:'Utilities & Home Support',sub:'Phone, Internet, TV channels and Subscription'},
    'mobile recharge, internate etc':{majorHead:'Household and Utility Expenses',category:'Utilities & Home Support',sub:'Phone, Internet, TV channels and Subscription'},
    'electricity bill':{majorHead:'Household and Utility Expenses',category:'Utilities & Home Support',sub:'Electricity'},
    'gas, water, sewer and garbage':{majorHead:'Household and Utility Expenses',category:'Utilities & Home Support',sub:'Gas, Water, Sewer and Garbage'},
    'wifi':{majorHead:'Household and Utility Expenses',category:'Utilities & Home Support',sub:'Phone, Internet, TV channels and Subscription'},
    'home-support stuff and other expenses':{majorHead:'Household and Utility Expenses',category:'Utilities & Home Support',sub:'Home-Support Staff and Other Expenses'},
    'home-support staff and other expenses':{majorHead:'Household and Utility Expenses',category:'Utilities & Home Support',sub:'Home-Support Staff and Other Expenses'},
    'any other expenses':{majorHead:'Any Other Expenses',category:'Miscellaneous',sub:'Any Other Expenses'},
    'other special expenses':{majorHead:'Festival And Other Special Expenses',category:'Special & Events',sub:'Other Special Expenses'},
    'philanthropy, etc':{majorHead:'Festival And Other Special Expenses',category:'Special & Events',sub:'Philanthropy, Etc'},
    'philanthropy, etc.':{majorHead:'Festival And Other Special Expenses',category:'Special & Events',sub:'Philanthropy, Etc'},
    'festival, party, events':{majorHead:'Festival And Other Special Expenses',category:'Special & Events',sub:'Festival, Party, Events'},
    'domestic and overseas tour, holiday, etc':{majorHead:'Festival And Other Special Expenses',category:'Special & Events'},
    'domestic and overseas tour, holiday, etc.':{majorHead:'Festival And Other Special Expenses',category:'Special & Events'},
    'tax, charges etc':{majorHead:'Tax, Charges, Etc. Paid',category:'Tax & Surcharge'},
    'tax, charges etc.':{majorHead:'Tax, Charges, Etc. Paid',category:'Tax & Surcharge'},
    'accommodation expense':{majorHead:'Accommodation Expense',category:'Accommodation',sub:'Household Rent'},
    'pocket money':{majorHead:'Expenses for Food, Clothing and Other Essentials',category:'Pocket Money'},
    'education expenses':{majorHead:'Education Expenses',category:'Education',sub:'Education Expenses'}
  }
};
const BUDGE_SUB_ALIASES={
  'eating out':'Dining/Eating Out',
  'snacks':'Snacks items',
  'grocery':'Grocery items',
  'payment of tds & ait':'Payment of Tax at Source & Advance Tax',
  'payment of tax at source & advance tax':'Payment of Tax at Source & Advance Tax'
};
function normalizeBudgeClassification(type,category,subcategory){
  const cat=normClass(category);
  let sub=normClass(subcategory);
  const lcat=normKey(cat),lsub=normKey(sub);
  const alias=(BUDGE_CAT_ALIASES[type]||{})[lcat];
  let majorHead='',resolvedCategory='';
  if(alias){majorHead=alias.majorHead;resolvedCategory=alias.category||'';if(alias.sub)sub=alias.sub}
  if(!majorHead){
    for(const g of state.incomeGroups){
      if(g.type!==type)continue;
      if(normKey(g.majorHead)===lcat){majorHead=g.majorHead;resolvedCategory=(g.categories[0]&&g.categories[0].name)||'';break}
      const cd=g.categories.find(c=>normKey(c.name)===lcat);
      if(cd){majorHead=g.majorHead;resolvedCategory=cd.name;break}
      for(const c of g.categories){
        const sm=c.subcategories.find(s=>normKey(s)===lcat);
        if(sm){majorHead=g.majorHead;resolvedCategory=c.name;if(!sub)sub=sm;break}
      }
      if(majorHead)break;
    }
  }
  if(majorHead==='Auto and Transportation Expenses'&&!resolvedCategory){
    resolvedCategory=(lsub==='fuel and maintenance'||lsub==='fuel'||lsub==='maintenance')?'Fuel and Maintenance':'Other Transportation';
  }
  if(!majorHead){
    if(type==='Income'){majorHead='Other Income';resolvedCategory='General Income'}
    else{majorHead='Any Other Expenses';resolvedCategory='Miscellaneous'}
  }
  if(BUDGE_SUB_ALIASES[lsub])sub=BUDGE_SUB_ALIASES[lsub];
  return ensureIncomeClass(type,majorHead,resolvedCategory,sub);
}
function hashString(str){
  let h1=0xdeadbeef>>>0,h2=0x41c6ce57>>>0;
  for(let i=0;i<str.length;i++){
    const ch=str.charCodeAt(i);
    h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);
  }
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return (h2>>>0).toString(16).padStart(8,'0')+(h1>>>0).toString(16).padStart(8,'0');
}
function incomeFingerprint(date,amount,account,majorHead,category,subcategory,description){
  const parts=[String(date||''),Number(amount||0).toFixed(2),normClass(account).toLowerCase(),normClass(majorHead).toLowerCase(),normClass(category).toLowerCase(),normClass(subcategory).toLowerCase(),normClass(description).toLowerCase()];
  return hashString(parts.join('|'));
}
function normalizeAccount(value){
  const s=normClass(value);
  const found=ACCOUNTS.find(a=>a.toLowerCase()===s.toLowerCase());
  return found||'Other';
}
function parseBudgeDate(value){
  const s=String(value??'').trim();
  const m=s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if(m)return `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
  return normalizeExcelDate(s);
}
function buildBudgeDescription(desc,payment,goal,category,subcategory){
  if(desc)return desc;
  const parts=[];
  const catSub=normClass(`${category} > ${subcategory}`);
  const paymentLower=normClass(payment).toLowerCase();
  if(payment&&paymentLower!==normClass(catSub).toLowerCase()&&paymentLower!==normClass(category).toLowerCase())parts.push(payment);
  if(goal)parts.push(goal);
  return parts.join(' · ');
}
function detectBudgeHeader(aoa){
  for(let i=0;i<Math.min(aoa.length,15);i++){
    const cells=(aoa[i]||[]).map(c=>normKey(String(c??'')));
    if(cells[0]==='date'&&cells.includes('amount')&&cells.includes('category')&&cells.includes('account'))return i;
  }
  return -1;
}

/* --- Income & Expenses.xlsx import --- */
function isIncomeExpensesWorkbook(workbook){
  const names=workbook.SheetNames.map(n=>n.toLowerCase());
  const hasMonthly=workbook.SheetNames.some(n=>/^\(\d{2}\)\s+(july|august|september|october|november|december|january|february|march|april|may|june)/i.test(n));
  return hasMonthly||names.includes('cash flow')||names.includes('total');
}
function findFiscalStart(workbook){
  for(const name of workbook.SheetNames){
    const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:true});
    for(const row of (aoa||[]).slice(0,2)){
      const cell=normClass(String((row||[])[0]||''));
      const m=cell.match(/fiscal year\s+(\d{4})/i);
      if(m)return +m[1];
    }
  }
  return +(String(fiscalYearFromDate(todayISO())).split('-')[0]||new Date().getFullYear());
}
function monthEndDate(fiscalStart,monthNum){
  const calMonth=monthNum<=6?monthNum+6:monthNum-6;
  const calYear=monthNum<=6?fiscalStart:fiscalStart+1;
  const last=new Date(calYear,calMonth,0).getDate();
  return `${calYear}-${pad2(calMonth)}-${pad2(last)}`;
}
function makeIeRecord(type,cls,amount,date,sourceSheet,sourceRow,description){
  return {id:uid('ie'),type,date,incomeYear:fiscalYearFromDate(date),majorHead:cls.majorHead,category:cls.category,subcategory:cls.subcategory,amount,account:'Other',description:description||'',documentIds:[],sourceSheet,sourceRow,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function findIncomeMajorHead(type,label){
  const lower=normKey(label);
  if(lower.startsWith('tax, charges, etc. paid'))return 'Tax, Charges, Etc. Paid';
  const group=state.incomeGroups.find(g=>g.type===type&&normKey(g.majorHead)===lower);
  return group?group.majorHead:null;
}
function findIncomeCategoryName(type,majorHead,label){
  if(!majorHead)return null;
  const g=state.incomeGroups.find(x=>x.type===type&&x.majorHead===majorHead);
  if(!g)return null;
  const lower=normKey(label);
  const c=g.categories.find(c=>normKey(c.name)===lower);
  return c?c.name:null;
}
function findIncomeSubcategoryName(type,majorHead,category,label){
  if(!majorHead||!category)return null;
  const g=state.incomeGroups.find(x=>x.type===type&&x.majorHead===majorHead);
  const c=g&&g.categories.find(x=>x.name===category);
  if(!c)return null;
  const lower=normKey(label);
  const s=c.subcategories.find(s=>normKey(s)===lower);
  return s||null;
}
function parseIncomeExpensesSheet(aoa,monthNum,sheetName,fiscalStart){
  const records=[];
  let pCol=-1,aCol=-1;
  for(let i=0;i<Math.min(aoa.length,6);i++){
    const row=aoa[i]||[];
    for(let c=0;c<row.length;c++){
      const t=normKey(String(row[c]||''));
      if(t==='particulars'&&pCol<0)pCol=c;
      if(/^amount\s*\(taka\)/.test(t)&&aCol<0)aCol=c;
    }
  }
  if(pCol<0)return records;
  const date=monthEndDate(fiscalStart,monthNum);
  let mode='income',curMajor=null,curCat=null,curSub=null;
  for(let r=0;r<aoa.length;r++){
    const row=aoa[r]||[];
    const label=normClass(String(row[pCol]||''));
    const amount=aCol>=0?parseExcelNumber(row[aCol]):0;
    if(!label)continue;
    const lower=normKey(label);
    if(lower==='income'){mode='income';curMajor=curCat=curSub=null;continue}
    if(/^expenses?\s*(\(.*\))?$/.test(lower)){mode='expense';curMajor=curCat=curSub=null;continue}
    if(lower==='assets purchased'||lower==='investment'){mode='skip';continue}
    if(mode==='skip')continue;
    if(lower==='other outflow'||/^total/.test(lower)||/^(balance|total income|total expenses|particulars|amount \(taka\)|total amount \(taka\))$/.test(lower))continue;
    if(/^(fiscal year.*|notes.*|bank accounts|previous balance)$/.test(lower))continue;
    const type=mode==='income'?'Income':'Expense';
    const major=findIncomeMajorHead(type,label);
    if(major){
      curMajor=major;curCat=null;curSub=null;
      const g=state.incomeGroups.find(x=>x.type===type&&x.majorHead===major);
      if(g&&g.categories.length===1)curCat=g.categories[0].name;
      if(amount>0){const cls=ensureIncomeClass(type,major,curCat,label);records.push(makeIeRecord(type,cls,amount,date,sheetName,r+1,''))}
      continue;
    }
    const catName=findIncomeCategoryName(type,curMajor,label);
    if(catName){
      curCat=catName;curSub=null;
      if(amount>0){const cls=ensureIncomeClass(type,curMajor,catName,label);records.push(makeIeRecord(type,cls,amount,date,sheetName,r+1,''))}
      continue;
    }
    const subName=findIncomeSubcategoryName(type,curMajor,curCat,label);
    if(subName){
      curSub=subName;
      if(amount>0){const cls=ensureIncomeClass(type,curMajor,curCat,subName);records.push(makeIeRecord(type,cls,amount,date,sheetName,r+1,''))}
      continue;
    }
    if(curMajor&&amount>0){
      if(curSub){const cls=ensureIncomeClass(type,curMajor,curCat,curSub);records.push(makeIeRecord(type,cls,amount,date,sheetName,r+1,label))}
      else{const cls=ensureIncomeClass(type,curMajor,curCat,label);records.push(makeIeRecord(type,cls,amount,date,sheetName,r+1,''))}
    }
  }
  return records;
}

/* --- Dashboard income/expense data + charts + recent widget --- */
function dashboardIncomeExpenses(){
  const {from,to}=dashFilters;
  let list=state.incomeExpenses;
  if(from||to)list=list.filter(r=>r.date&&inRange(r.date,from,to));
  return list;
}
function fiscalMonthFromDate(iso){
  const m=String(iso||'').match(/^(\d{4})-(\d{2})/);
  if(!m)return 0;
  const mm=+m[2];
  return mm>=7?mm-6:mm+6;
}
function renderIncomeCharts(records){
  destroyChart('incomeTrendChart');destroyChart('expenseCategoryChart');
  if(!window.Chart||!document.getElementById('incomeTrendChart')||!document.getElementById('expenseCategoryChart'))return;
  const theme=chartTheme();
  const anim={duration:reducedMotion()?0:900,easing:'easeOutQuart'};
  const legend={position:'bottom',labels:{usePointStyle:true,boxWidth:8,color:theme.text}};
  const scales={x:{grid:{display:false},ticks:{color:theme.text}},y:{grid:{color:theme.grid},ticks:{color:theme.text}}};
  const months=['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];
  const incomeBy=[],expenseBy=[];
  for(let m=1;m<=12;m++){
    incomeBy.push(records.filter(r=>r.type==='Income'&&fiscalMonthFromDate(r.date)===m).reduce((s,r)=>s+(Number(r.amount)||0),0));
    expenseBy.push(records.filter(r=>r.type==='Expense'&&fiscalMonthFromDate(r.date)===m).reduce((s,r)=>s+(Number(r.amount)||0),0));
  }
  charts.incomeTrendChart=new Chart(document.getElementById('incomeTrendChart'),{type:'bar',data:{labels:months,datasets:[
    {label:'Income',data:incomeBy,backgroundColor:'#10b981',borderRadius:6,maxBarThickness:26},
    {label:'Expenses',data:expenseBy,backgroundColor:'#f43f5e',borderRadius:6,maxBarThickness:26}
  ]},options:{maintainAspectRatio:false,animation:anim,scales,plugins:{legend}}});
  const group=Object.entries(records.filter(r=>r.type==='Expense').reduce((out,r)=>{out[r.majorHead]=(out[r.majorHead]||0)+(Number(r.amount)||0);return out},{}));
  charts.expenseCategoryChart=new Chart(document.getElementById('expenseCategoryChart'),{type:'doughnut',data:{labels:group.map(x=>x[0]),datasets:[{data:group.map(x=>x[1]),backgroundColor:group.map((x,i)=>CHART_COLORS[i%CHART_COLORS.length]),borderWidth:0,hoverOffset:6}]},options:{maintainAspectRatio:false,cutout:'58%',animation:anim,plugins:{legend}}});
}
function renderRecentIncome(records){
  const countEl=document.getElementById('recentIncomeCount'),tableEl=document.getElementById('recentIncomeTable');
  if(!countEl||!tableEl)return;
  const list=records.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,8);
  countEl.textContent=`${list.length} of ${records.length} recent`;
  tableEl.innerHTML=`<thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Category</th><th scope="col">Subcategory</th><th scope="col">Description</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${list.map(r=>{
    const sign=r.type==='Income'?'+':'−';
    return `<tr><td>${esc(fmtDate(r.date)||'—')}</td><td><span class="badge ${r.type.toLowerCase()}">${esc(r.type)}</span></td><td>${esc(r.category)}</td><td>${esc(r.subcategory)}</td><td>${esc(r.description||'—')}</td><td class="num"><strong class="amount ${r.type.toLowerCase()}">${sign}${formatMoney(r.amount)}</strong></td></tr>`;
  }).join('')||'<tr><td colspan="6"><div class="empty-state">No income or expense records in this range.</div></td></tr>'}</tbody>`;
}

/* --- Income & Expenses page --- */
function incomeYearOptionsList(){
  const years=[...new Set([...(state.settings.incomeYears||[]),...state.incomeExpenses.map(r=>String(r.incomeYear||'')).filter(Boolean)])];
  return years.sort((a,b)=>String(b).localeCompare(String(a)));
}
function getFilteredIncomeExpenses(){
  const f=incomeFilters;
  const search=f.search.toLowerCase();
  return state.incomeExpenses.filter(r=>{
    if(f.type&&r.type!==f.type)return false;
    if(f.year&&normIncomeYear(r.incomeYear)!==normIncomeYear(f.year))return false;
    if(f.month&&fiscalMonthFromDate(r.date)!==+f.month)return false;
    if(f.majorHead&&r.majorHead!==f.majorHead)return false;
    if(f.category&&r.category!==f.category)return false;
    if(f.subcategory&&r.subcategory!==f.subcategory)return false;
    if(search){const hay=[r.description,r.category,r.subcategory,r.account,r.majorHead].map(v=>String(v??'').toLowerCase()).join(' ');if(!hay.includes(search))return false}
    return true;
  });
}
function renderIncomeFilters(){
  if(!incomeYearInit){incomeFilters.year=fiscalYearFromDate(todayISO());incomeYearInit=true}
  const host=document.getElementById('incomeFilters');
  if(!host)return;
  const years=incomeYearOptionsList();
  const current=fiscalYearFromDate(todayISO());
  if(!years.includes(current))years.unshift(current);
  if(incomeFilters.year&&!years.includes(incomeFilters.year))incomeFilters.year='';
  const option=(value,label,selected,disabled=false)=>`<option value="${esc(value)}" ${selected?'selected':''} ${disabled?'disabled':''}>${esc(label)}</option>`;
  const heads=incomeMajorHeads(incomeFilters.type);
  if(incomeFilters.majorHead&&!heads.includes(incomeFilters.majorHead))incomeFilters.majorHead='';
  const g=incomeFilters.majorHead?groupForMajorHead(incomeFilters.majorHead):null;
  const cats=g?g.categories.map(c=>c.name):[];
  if(incomeFilters.category&&!cats.includes(incomeFilters.category))incomeFilters.category='';
  const cat=g&&g.categories.find(c=>c.name===incomeFilters.category);
  const subs=cat?cat.subcategories:[];
  if(incomeFilters.subcategory&&!subs.includes(incomeFilters.subcategory))incomeFilters.subcategory='';
  const anyFilter=incomeFilters.search||incomeFilters.year||incomeFilters.month||incomeFilters.type||incomeFilters.majorHead||incomeFilters.category||incomeFilters.subcategory;
  host.innerHTML=`<div class="filter-row">
    <input class="search" id="incomeSearch" placeholder="Search income and expenses…" aria-label="Search income and expenses" value="${esc(incomeFilters.search)}">
    <select id="incomeYear" aria-label="Income year">${option('','All Years',!incomeFilters.year)}${years.map(y=>option(y,y,incomeFilters.year===y)).join('')}</select>
    <select id="incomeMonth" aria-label="Month">${option('','All Months',!incomeFilters.month)}${FISCAL_MONTHS.map((m,i)=>option(String(i+1),m,String(i+1)===incomeFilters.month)).join('')}</select>
    <select id="incomeType" aria-label="Type">${option('','All Types',!incomeFilters.type)}${option('Income','Income',incomeFilters.type==='Income')}${option('Expense','Expense',incomeFilters.type==='Expense')}</select>
    <select id="incomeMajorHead" aria-label="Major head" ${heads.length?'':'disabled'}>${option('','All Major Heads',!incomeFilters.majorHead)}${heads.map(h=>option(h,h,incomeFilters.majorHead===h)).join('')}</select>
    <select id="incomeCategory" aria-label="Category" ${cats.length?'':'disabled'}>${option('','All Categories',!incomeFilters.category)}${cats.map(c=>option(c,c,incomeFilters.category===c)).join('')}</select>
    <select id="incomeSubcategory" aria-label="Subcategory" ${subs.length?'':'disabled'}>${option('','All Subcategories',!incomeFilters.subcategory)}${subs.map(s=>option(s,s,incomeFilters.subcategory===s)).join('')}</select>
    <button type="button" class="btn filter-reset" id="incomeClear" ${anyFilter?'':'disabled'}>Clear Filters</button>
  </div>`;
  // Same accent treatment as the Dashboard filter card.
  host.querySelectorAll('select').forEach(el=>el.classList.toggle('is-active',!!el.value));
  const rerender=()=>{incomePage=1;renderIncomePage()};
  const bind=(id,key,followUp)=>{const el=document.getElementById(id);el.onchange=()=>{incomeFilters[key]=el.value;if(followUp)followUp();rerender()}};
  const searchEl=document.getElementById('incomeSearch');
  searchEl.oninput=(()=>{let t=null;return ()=>{clearTimeout(t);t=setTimeout(()=>{incomeFilters.search=searchEl.value;incomePage=1;const c=document.getElementById('incomeClear');if(c)c.disabled=!(incomeFilters.search||incomeFilters.year||incomeFilters.month||incomeFilters.type||incomeFilters.majorHead||incomeFilters.category||incomeFilters.subcategory);renderIncomeSummary();renderIncomeView()},180)}})();
  bind('incomeYear','year');
  bind('incomeMonth','month');
  bind('incomeType','type',()=>{incomeFilters.majorHead='';incomeFilters.category='';incomeFilters.subcategory=''});
  bind('incomeMajorHead','majorHead',()=>{incomeFilters.category='';incomeFilters.subcategory=''});
  bind('incomeCategory','category',()=>{incomeFilters.subcategory=''});
  bind('incomeSubcategory','subcategory');
  const clear=document.getElementById('incomeClear');
  if(clear)clear.onclick=()=>{Object.assign(incomeFilters,{search:'',year:'',month:'',type:'',majorHead:'',category:'',subcategory:''});rerender()};
}
function renderIncomeSummary(){
  const list=getFilteredIncomeExpenses();
  const income=list.filter(r=>r.type==='Income').reduce((s,r)=>s+(Number(r.amount)||0),0);
  const expenses=list.filter(r=>r.type==='Expense').reduce((s,r)=>s+(Number(r.amount)||0),0);
  const net=income-expenses;
  const rate=income>0?(net/income)*100:0;
  const card=(i,iconName,label,value,kind,kpi,kpiInk,cls)=>`<div class="summary-card" style="--i:${i};--kpi:${kpi};--kpi-ink:${kpiInk}"><div class="summary-icon">${icon(iconName)}</div><div><p>${label}</p><strong class="kpi-value ${cls||''}" data-kind="${kind}" data-to="${value}">${kind==='money'?formatMoney(value):kind==='percent'?(Number(value).toFixed(1)+'%'):value}</strong></div></div>`;
  document.getElementById('incomeSummaryCards').innerHTML=[
    card(0,'up','Total Income',income,'money','var(--emerald-soft)','#059669'),
    card(1,'down','Total Expenses',expenses,'money','var(--rose-soft)','#e11d48'),
    card(2,'scale','Net Savings',net,'money','var(--primary-soft)','var(--primary-2)',net>=0?'kpi-pos':'kpi-neg'),
    card(3,'layers','Savings Rate',rate,'percent','rgba(245,158,11,.13)','#d97706')
  ].join('');
  animateIncomeKpis();
}
function animateIncomeKpis(){
  document.querySelectorAll('#incomeSummaryCards .kpi-value').forEach((el,i)=>{
    const to=Number(el.dataset.to)||0,kind=el.dataset.kind;
    const from=incomeKpiPrev[i]??0;
    incomeKpiPrev[i]=to;
    const fmt=v=>kind==='money'?formatMoney(v):kind==='percent'?(Number(v).toFixed(1)+'%'):String(Math.round(v));
    if(reducedMotion()||from===to){el.textContent=fmt(to);return}
    const duration=900,start=performance.now();
    const step=now=>{const t=Math.min(1,(now-start)/duration);const eased=1-Math.pow(1-t,4);el.textContent=fmt(from+(to-from)*eased);if(t<1)requestAnimationFrame(step);else el.textContent=fmt(to)};
    el.textContent=fmt(from);requestAnimationFrame(step);
  });
}
function renderIncomeTable(){
  const records=getFilteredIncomeExpenses().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const pageSize=10,pages=Math.max(1,Math.ceil(records.length/pageSize));
  incomePage=Math.min(incomePage,pages);
  const pageRecords=records.slice((incomePage-1)*pageSize,incomePage*pageSize);
  document.getElementById('incomeRecordCount').textContent=`${records.length} transaction${records.length===1?'':'s'} found`;
  document.getElementById('incomeExpensesTable').innerHTML=`<thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Major Head</th><th scope="col">Category</th><th scope="col">Subcategory</th><th scope="col">Account / Method</th><th scope="col">Description</th><th scope="col" class="num">Amount</th><th scope="col">Actions</th></tr></thead><tbody>${pageRecords.map((r,i)=>{
    const id=esc(r.id);
    const sign=r.type==='Income'?'+':'−';
    const receipt=(r.documentIds||[]).length?`<button type="button" class="action-link" data-cmd="open-pdf" data-id="${esc(r.documentIds[0])}">Receipt</button>`:'';
    return `<tr style="--i:${i}"><td>${esc(fmtDate(r.date)||'—')}</td><td><span class="badge ${r.type.toLowerCase()}">${esc(r.type)}</span></td><td>${esc(r.majorHead)}</td><td>${esc(r.category)}</td><td>${esc(r.subcategory)}</td><td>${esc(r.account||'—')}</td><td>${esc(r.description||'—')}</td><td class="num"><strong class="amount ${r.type.toLowerCase()}">${sign}${formatMoney(r.amount)}</strong></td><td class="actions-cell"><button type="button" class="action-link" data-cmd="view-income" data-id="${id}">View</button><button type="button" class="action-link" data-cmd="edit-income" data-id="${id}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-income" data-id="${id}">Delete</button>${receipt}</td></tr>`;
  }).join('')||'<tr><td colspan="9"><div class="empty-state">No income or expense records match these filters.</div></td></tr>'}</tbody>`;
  document.getElementById('incomePagination').innerHTML=pages>1?Array.from({length:pages},(_,i)=>`<button type="button" class="${i+1===incomePage?'active':''}" data-cmd="income-page" data-id="${i+1}" aria-label="Page ${i+1}">${i+1}</button>`).join(''):'';
}
function orderIdx(arr,name){const i=arr.indexOf(name);return i<0?999:i}
function buildIncomeBreakdown(list){
  const build=(type)=>{
    const recs=list.filter(r=>r.type===type);
    const headMap=new Map();
    for(const r of recs){
      if(!headMap.has(r.majorHead))headMap.set(r.majorHead,{name:r.majorHead,cats:new Map()});
      const head=headMap.get(r.majorHead);
      if(!head.cats.has(r.category))head.cats.set(r.category,{name:r.category,subs:new Map()});
      const cat=head.cats.get(r.category);
      if(!cat.subs.has(r.subcategory))cat.subs.set(r.subcategory,{name:r.subcategory,count:0,total:0});
      const sub=cat.subs.get(r.subcategory);
      sub.count++;sub.total+=(Number(r.amount)||0);
    }
    const heads=[];
    for(const head of headMap.values()){
      const cats=[];
      for(const cat of head.cats.values()){
        cats.push({name:cat.name,count:[...cat.subs.values()].reduce((s,x)=>s+x.count,0),total:[...cat.subs.values()].reduce((s,x)=>s+x.total,0),subs:[...cat.subs.values()]});
      }
      heads.push({name:head.name,count:[...head.cats.values()].reduce((s,x)=>s+[...x.subs.values()].reduce((a,y)=>a+y.count,0),0),total:[...head.cats.values()].reduce((s,x)=>s+[...x.subs.values()].reduce((a,y)=>a+y.total,0),0),cats});
    }
    const orderHeads=state.incomeGroups.filter(g=>g.type===type).map(g=>g.majorHead);
    heads.sort((a,b)=>orderIdx(orderHeads,a.name)-orderIdx(orderHeads,b.name));
    heads.forEach(h=>{
      const g=state.incomeGroups.find(x=>x.type===type&&x.majorHead===h.name);
      const orderCats=g?g.categories.map(c=>c.name):[];
      h.cats.sort((a,b)=>orderIdx(orderCats,a.name)-orderIdx(orderCats,b.name));
      h.cats.forEach(c=>{
        const cd=g&&g.categories.find(x=>x.name===c.name);
        const orderSubs=cd?cd.subcategories:[];
        c.subs.sort((a,b)=>orderIdx(orderSubs,a.name)-orderIdx(orderSubs,b.name));
      });
    });
    return {heads,total:recs.reduce((s,r)=>s+(Number(r.amount)||0),0),count:recs.length};
  };
  return {income:build('Income'),expense:build('Expense')};
}
function renderIncomeBreakdown(){
  const data=buildIncomeBreakdown(getFilteredIncomeExpenses());
  const renderSection=(title,sec,isExpense)=>{
    if(!sec.heads.length)return '';
    const rows=sec.heads.map(h=>`<tr class="bd-major"><td>${esc(h.name)}</td><td>${formatMoney(h.total)}</td></tr>`+
      h.cats.map(c=>`<tr class="bd-cat"><td>${esc(c.name)}</td><td>${formatMoney(c.total)}</td></tr>`+
        c.subs.map(s=>`<tr class="bd-sub"><td>${esc(s.name)}</td><td>${formatMoney(s.total)}</td></tr>`).join('')).join('')).join('');
    return `<div class="breakdown-section"><div class="breakdown-title"><span class="pill ${isExpense?'expense':'income'}">${title}</span><span>${sec.count} transaction${sec.count===1?'':'s'} · ${formatMoney(sec.total)}</span></div><div class="table-wrap"><table class="breakdown-table"><thead><tr><th>Particulars</th><th>Amount</th></tr></thead><tbody>${rows}<tr class="bd-total ${isExpense?'expense-total':''}"><td>Total ${title}</td><td>${formatMoney(sec.total)}</td></tr></tbody></table></div></div>`;
  };
  const net=data.income.total-data.expense.total;
  const netHtml=`<div class="breakdown-section"><div class="breakdown-title"><span class="pill income">NET SAVINGS</span></div><div class="table-wrap"><table class="breakdown-table"><tbody><tr class="bd-total"><td>Income − Expenses</td><td class="${net>=0?'kpi-pos':'kpi-neg'}">${formatMoney(net)}</td></tr></tbody></table></div></div>`;
  document.getElementById('incomeBreakdown').innerHTML=renderSection('INCOME',data.income,false)+renderSection('EXPENSES',data.expense,true)+netHtml;
}
function renderIncomeView(){
  document.getElementById('incomeTableTitle').textContent=incomeTab==='transactions'?'Transactions':'Category Summary';
  document.getElementById('incomeTransactionsWrap').classList.toggle('hidden',incomeTab!=='transactions');
  document.getElementById('incomeBreakdown').classList.toggle('hidden',incomeTab!=='breakdown');
  document.getElementById('incomePagination').classList.toggle('hidden',incomeTab!=='transactions');
  if(incomeTab==='transactions')renderIncomeTable();else renderIncomeBreakdown();
}
function renderIncomePage(){
  renderIncomeFilters();
  renderIncomeSummary();
  renderIncomeView();
}

/* --- Income / Expense modal --- */
function resetIncomeDocDraft(record){
  incomeDocDraft.existing=record?(record.documentIds||[]).map(id=>state.documents.find(d=>d.id===id)).filter(Boolean):[];
  incomeDocDraft.removed=new Set();incomeDocDraft.replaced=new Map();incomeDocDraft.added=[];
}
function renderIncomeDocManager(){
  const host=document.getElementById('incomeDocManagerList');if(!host)return;
  const rows=[];
  incomeDocDraft.existing.forEach(d=>{
    const removed=incomeDocDraft.removed.has(d.id),replacement=incomeDocDraft.replaced.get(d.id);
    const name=replacement?replacement.name:(d.name||d.title||'receipt.pdf');
    const tag=removed?'<span class="tag warn">Will be removed</span>':replacement?'<span class="tag">Will replace</span>':'';
    rows.push(`<div class="doc-row ${removed?'removed':''}"><div class="doc-info"><strong>${esc(name)}</strong><span>${formatFileSize(replacement?replacement.size:d.size)}</span>${tag}</div><div class="doc-actions">${removed?'':`<button type="button" class="action-link" data-iact="view" data-id="${esc(d.id)}">View</button><button type="button" class="action-link" data-iact="replace" data-id="${esc(d.id)}">Replace</button>`}<button type="button" class="action-link ${removed?'':'danger'}" data-iact="${removed?'undo':'remove'}" data-id="${esc(d.id)}">${removed?'Undo remove':'Remove'}</button></div></div>`);
  });
  incomeDocDraft.added.forEach((f,i)=>{
    rows.push(`<div class="doc-row"><div class="doc-info"><strong>${esc(f.name)}</strong><span>${formatFileSize(f.size)}</span><span class="tag new">New</span></div><div class="doc-actions"><button type="button" class="action-link" data-iact="view-new" data-idx="${i}">View</button><button type="button" class="action-link danger" data-iact="remove-new" data-idx="${i}">Remove</button></div></div>`);
  });
  host.innerHTML=rows.join('')||'<div class="doc-empty">No receipt PDF attached yet.</div>';
}
async function incomeDocDraftSource(id){
  const meta=incomeDocDraft.existing.find(x=>x.id===id);if(!meta)return null;
  const rep=incomeDocDraft.replaced.get(id);
  if(rep)return {blob:rep,name:rep.name,size:rep.size};
  const blob=await getDocBlob(id);if(!blob)return null;
  return {blob,name:meta.name||meta.title||'receipt.pdf',size:meta.size||blob.size};
}
function replaceIncomeDocument(id){replacingDocumentId=id;document.getElementById('replaceDocumentFile').click()}
function bindIncomeDocManager(){
  const host=document.getElementById('incomeDocManager');if(!host)return;
  host.onclick=async e=>{
    const btn=e.target.closest('[data-iact]');if(!btn)return;
    const {iact,id,idx}=btn.dataset;
    if(iact==='view'){const src=await incomeDocDraftSource(id);if(src)await openPdfViewer(src)}
    else if(iact==='replace'){replaceIncomeDocument(id)}
    else if(iact==='remove'){incomeDocDraft.removed.add(id);incomeDocDraft.replaced.delete(id);renderIncomeDocManager()}
    else if(iact==='undo'){incomeDocDraft.removed.delete(id);renderIncomeDocManager()}
    else if(iact==='view-new'){const f=incomeDocDraft.added[+idx];if(f)await openPdfViewer({blob:f,name:f.name,size:f.size})}
    else if(iact==='remove-new'){incomeDocDraft.added.splice(+idx,1);renderIncomeDocManager()}
  };
  const input=document.getElementById('incomeDocument');
  if(input)input.onchange=e=>{
    const files=[...e.target.files];
    incomeDocDraft.added.push(...files.filter(isPdfFile));
    if(files.some(f=>!isPdfFile(f)))toast('Only PDF files can be attached.',true);
    e.target.value='';
    renderIncomeDocManager();
  };
}
function openIncomeModal(id=null,defaults={}){
  editingIncomeId=id;
  const record=id?state.incomeExpenses.find(r=>r.id===id):null;
  resetIncomeDocDraft(record);
  document.getElementById('incomeModalTitle').textContent=record?'Edit Transaction':'Add Income / Expense';
  document.getElementById('incomeModalSubtitle').textContent=record?`${record.type} · ${record.majorHead}`:'Fields adapt to the selected type and classification';
  const startType=record?.type||defaults.type||'Expense';
  const dateValue=record?record.date||todayISO():todayISO();
  document.getElementById('incomeFormFields').innerHTML=`<div class="income-form-grid">
    <label>Transaction Type *<select id="incomeTypeSelect" required><option value="Income" ${startType==='Income'?'selected':''}>Income</option><option value="Expense" ${startType==='Expense'?'selected':''}>Expense</option></select></label>
    <label>Date *<input id="incomeDate" type="date" required value="${esc(dateValue)}"></label>
    <label>Major Head *<select id="incomeMajorHeadSelect" required></select></label>
    <label>Category *<select id="incomeCategorySelect" required></select></label>
    <label>Subcategory *<select id="incomeSubcategorySelect" required></select></label>
    <label>Account / Payment Method<select id="incomeAccount">${ACCOUNTS.map(a=>`<option value="${esc(a)}" ${a===(record?.account||'Cash in Hand')?'selected':''}>${esc(a)}</option>`).join('')}</select></label>
    <label>Amount (BDT) *<input id="incomeAmount" type="number" step="0.01" min="0" inputmode="decimal" required value="${esc(record?record.amount:'')}" placeholder="0.00"></label>
    <label class="full">Description / Notes<textarea id="incomeDescription" rows="2">${esc(record?.description||'')}</textarea></label>
    <label class="full">Receipt / Voucher (PDF)<input id="incomeDocument" type="file" accept=".pdf,application/pdf"><span class="hint">Optional receipt or voucher PDF.</span></label>
    <div class="doc-manager full" id="incomeDocManager"><h4>Attached receipt</h4><div class="doc-list" id="incomeDocManagerList"></div></div>
  </div>`;
  document.querySelector('#incomeForm .modal-foot').innerHTML='<button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn btn-primary">Save Transaction</button>';
  document.querySelectorAll('#incomeForm [data-close-modal]').forEach(b=>b.onclick=()=>document.getElementById('incomeModal').close());
  const typeSel=document.getElementById('incomeTypeSelect'),majorSel=document.getElementById('incomeMajorHeadSelect'),catSel=document.getElementById('incomeCategorySelect'),subSel=document.getElementById('incomeSubcategorySelect');
  const updateMajor=()=>{
    const heads=incomeMajorHeads(typeSel.value);
    majorSel.innerHTML=heads.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join('');
    if(record&&record.type===typeSel.value&&heads.includes(record.majorHead))majorSel.value=record.majorHead;
    else if(defaults.majorHead&&heads.includes(defaults.majorHead))majorSel.value=defaults.majorHead;
    updateCategory();
  };
  const updateCategory=()=>{
    const cats=incomeCategoriesFor(majorSel.value);
    catSel.innerHTML=cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if(record&&record.majorHead===majorSel.value&&cats.includes(record.category))catSel.value=record.category;
    else if(defaults.category&&cats.includes(defaults.category))catSel.value=defaults.category;
    updateSubcategory();
  };
  const updateSubcategory=()=>{
    const subs=incomeSubcategoriesFor(majorSel.value,catSel.value);
    subSel.innerHTML=(subs.length?subs:[catSel.value].filter(Boolean)).map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if(record&&record.category===catSel.value&&subs.includes(record.subcategory))subSel.value=record.subcategory;
    else if(defaults.subcategory&&subs.includes(defaults.subcategory))subSel.value=defaults.subcategory;
  };
  typeSel.onchange=updateMajor;
  majorSel.onchange=updateCategory;
  catSel.onchange=updateSubcategory;
  updateMajor();
  bindIncomeDocManager();
  renderIncomeDocManager();
  document.getElementById('incomeModal').showModal();
}
async function saveIncomeRecord(event){
  event.preventDefault();
  if(savingIncome)return;
  const form=event.target;
  if(form.querySelector('select:invalid,input:invalid,textarea:invalid')){form.reportValidity();return}
  savingIncome=true;
  try{
    const type=document.getElementById('incomeTypeSelect').value;
    const majorHead=document.getElementById('incomeMajorHeadSelect').value;
    const category=document.getElementById('incomeCategorySelect').value;
    const subcategory=document.getElementById('incomeSubcategorySelect').value;
    const date=document.getElementById('incomeDate').value;
    const amount=Math.abs(Number(document.getElementById('incomeAmount').value||0));
    const account=document.getElementById('incomeAccount').value;
    const description=document.getElementById('incomeDescription').value.trim();
    const old=editingIncomeId?state.incomeExpenses.find(r=>r.id===editingIncomeId):null;
    const record=Object.assign({},old||{});
    Object.assign(record,{id:old?old.id:uid('ie'),type,date,incomeYear:fiscalYearFromDate(date),majorHead,category,subcategory,amount,account,description});
    if(!record.createdAt)record.createdAt=new Date().toISOString();
    record.updatedAt=new Date().toISOString();

    let documentIds=[...(old?.documentIds||[])];
    for(const docId of incomeDocDraft.removed){await remove('documents',docId);await remove('documentBlobs',docId);documentIds=documentIds.filter(x=>x!==docId)}
    for(const [docId,file] of incomeDocDraft.replaced){
      const existing=state.documents.find(d=>d.id===docId);
      if(!existing||incomeDocDraft.removed.has(docId))continue;
      await put('documentBlobs',{id:docId,blob:file});
      Object.assign(existing,{name:file.name,title:file.name,type:file.type||'application/pdf',size:file.size,updatedAt:new Date().toISOString()});
      await put('documents',existing);
    }
    for(const file of incomeDocDraft.added){
      const docId=uid('doc');
      await put('documentBlobs',{id:docId,blob:file});
      await put('documents',{id:docId,recordId:record.id,title:file.name,name:file.name,type:file.type||'application/pdf',size:file.size,category,subcategory,financialType:type,incomeYear:record.incomeYear||'',createdAt:new Date().toISOString()});
      documentIds.push(docId);
    }
    record.documentIds=documentIds;

    await put('incomeExpenses',record);
    await loadState();
    document.getElementById('incomeModal').close();
    editingIncomeId=null;
    renderIncomePage();renderDashboard();
    toast(old?'Transaction saved':'Transaction created');
  }catch(error){
    console.error(error);
    const quota=error&&error.name==='QuotaExceededError';
    toast(quota?'Could not save — browser storage is full.':'Could not save the transaction'+(error.message?` — ${error.message}`:''),true);
  }finally{
    savingIncome=false;
  }
}
async function deleteIncomeRecord(id){
  if(await confirm('Delete this income / expense transaction? Any attached receipt will also be removed.','Delete Transaction')){
    const record=state.incomeExpenses.find(r=>r.id===id);
    const linked=new Set([...(record?.documentIds||[]),...state.documents.filter(d=>d.recordId===id).map(d=>d.id)]);
    for(const docId of linked){await remove('documents',docId);await remove('documentBlobs',docId)}
    await remove('incomeExpenses',id);
    await loadState();renderIncomePage();renderDashboard();toast('Transaction deleted');
  }
}
function viewIncomeRecord(id){
  const r=state.incomeExpenses.find(x=>x.id===id);if(!r)return;
  editingIncomeId=null;
  document.getElementById('incomeModalTitle').textContent=`${r.type} · ${r.category}`;
  document.getElementById('incomeModalSubtitle').textContent=r.majorHead;
  const docs=(r.documentIds||[]).map(id=>state.documents.find(d=>d.id===id)).filter(Boolean);
  const docSection=docs.length?`<label class="full document-view-section">Attached Receipt<div class="document-view-list">${docs.map(d=>`<div class="document-view-item"><div class="document-info"><strong>${esc(d.name||d.title||'receipt.pdf')}</strong><span>${formatFileSize(d.size)}</span></div><div class="document-actions"><button type="button" class="btn" data-cmd="open-pdf" data-id="${esc(d.id)}">View PDF</button><button type="button" class="btn btn-primary" data-cmd="download-pdf" data-id="${esc(d.id)}">Download</button></div></div>`).join('')}</div></label>`:'';
  const show=(label,value)=>`<label><span class="k">${esc(label)}</span><strong class="view-field">${value===''||value===undefined||value===null?'—':esc(value)}</strong></label>`;
  document.getElementById('incomeFormFields').innerHTML=`<div class="income-form-grid">${show('Type',r.type)}${show('Date',fmtDate(r.date))}${show('Major Head',r.majorHead)}${show('Category',r.category)}${show('Subcategory',r.subcategory)}${show('Account / Method',r.account)}${show('Amount',formatMoney(r.amount))}${show('Income Year',r.incomeYear)}${show('Description',r.description)}${docSection}</div>`;
  document.querySelector('#incomeForm .modal-foot').innerHTML='<button type="button" class="btn" data-close-modal>Close</button>';
  document.querySelectorAll('#incomeForm [data-close-modal]').forEach(b=>b.onclick=()=>document.getElementById('incomeModal').close());
  document.getElementById('incomeModal').showModal();
}

/* --- Income page exports --- */
function incomeFilterText(){
  const f=incomeFilters;
  return ['Year',f.year||'All','Month',f.month?fiscalMonthName(f.month):'All','Type',f.type||'All','Search',f.search||'All'].join('  |  ');
}
function exportIncomeExcel(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const list=getFilteredIncomeExpenses();
  if(!list.length){toast('No income / expense records match the current filters.',true);return}
  const data=buildIncomeBreakdown(list);
  const totalIncome=data.income.total,totalExpenses=data.expense.total,net=totalIncome-totalExpenses,rate=totalIncome>0?(net/totalIncome)*100:0;
  const summaryRows=[['Income & Expenses Report'],[`Generated ${generatedStamp()}`],[],
    ['Total Income',totalIncome],['Total Expenses',totalExpenses],['Net Savings',net],['Savings Rate (%)',rate],[],
    ['Type','Major Head','Category','Subcategory','Amount']];
  const block=(type,sec)=>sec.heads.forEach(h=>{
    summaryRows.push([type,h.name,'','',h.total]);
    h.cats.forEach(c=>{
      summaryRows.push([type,'',c.name,'',c.total]);
      c.subs.forEach(s=>summaryRows.push([type,'','',s.name,s.total]));
    });
  });
  block('Income',data.income);block('Expense',data.expense);
  const summaryWs=XLSX.utils.aoa_to_sheet(summaryRows);
  summaryRows.forEach((r,i)=>{
    if(typeof r[4]==='number'){const a=XLSX.utils.encode_cell({r:i,c:4});if(summaryWs[a])summaryWs[a].z=MONEY_FMT}
    if(typeof r[1]==='number'){const a=XLSX.utils.encode_cell({r:i,c:1});if(summaryWs[a])summaryWs[a].z=MONEY_FMT}
  });
  summaryWs['!cols']=[{wch:12},{wch:30},{wch:26},{wch:30},{wch:16}];
  const monthRows=[['Month','Income','Expenses','Net']];
  for(let m=1;m<=12;m++){
    const inc=list.filter(r=>r.type==='Income'&&fiscalMonthFromDate(r.date)===m).reduce((s,r)=>s+(Number(r.amount)||0),0);
    const exp=list.filter(r=>r.type==='Expense'&&fiscalMonthFromDate(r.date)===m).reduce((s,r)=>s+(Number(r.amount)||0),0);
    monthRows.push([FISCAL_MONTHS[m-1],inc,exp,inc-exp]);
  }
  const monthWs=XLSX.utils.aoa_to_sheet(monthRows);
  monthRows.forEach((r,i)=>{for(let c=1;c<=3;c++){const a=XLSX.utils.encode_cell({r:i,c});if(monthWs[a])monthWs[a].z=MONEY_FMT}});
  monthWs['!cols']=[{wch:14},{wch:16},{wch:16},{wch:16}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,summaryWs,'Summary');
  XLSX.utils.book_append_sheet(wb,monthWs,'Monthly Breakdown');
  XLSX.writeFile(wb,`Income-Expenses-${incomeFilters.year||'All-Years'}-${todayISO()}.xlsx`);
  toast('Income & Expenses Excel exported');
}
async function exportIncomePdf(){
  const list=getFilteredIncomeExpenses();
  if(!list.length){toast('No income / expense records match the current filters.',true);return}
  const JsPDF=window.jspdf&&window.jspdf.jsPDF;
  if(!JsPDF){toast('PDF library is unavailable. Check your internet connection.',true);return}
  const data=buildIncomeBreakdown(list);
  const doc=new JsPDF({orientation:'p',unit:'pt',format:'a4',compress:true});
  if(typeof doc.autoTable!=='function'){toast('PDF table plugin is unavailable. Check your internet connection.',true);return}
  doc.setProperties({title:'Personal Finance - Income & Expenses Report',creator:'SOIKOT RAIHAN'});
  const M=36,HEAD_H=110,FOOT_H=34;
  const stamp=generatedStamp();
  const pageW=()=>doc.internal.pageSize.getWidth();
  const drawHeader=()=>{
    const W=pageW();
    doc.setFillColor(79,70,229);doc.rect(0,0,W,42,'F');
    doc.setFillColor(16,185,129);doc.rect(0,42,W,3,'F');
    doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(14);
    doc.text('Personal Finance  |  Income & Expenses Report',M,27);
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);
    doc.text(`Generated ${stamp}`,W-M,27,{align:'right'});
    doc.setTextColor(100,116,139);doc.setFontSize(8);
    doc.text(incomeFilterText(),M,56);
  };
  drawHeader();
  const totalIncome=data.income.total,totalExpenses=data.expense.total,net=totalIncome-totalExpenses;
  const kpi=[
    [{content:'Total Income',styles:{fillColor:[236,253,245],textColor:[6,95,70],fontStyle:'bold'}},{content:pdfMoney(totalIncome),styles:{halign:'right',fillColor:[236,253,245],textColor:[6,95,70],fontStyle:'bold'}}],
    [{content:'Total Expenses',styles:{fillColor:[255,241,242],textColor:[159,18,57],fontStyle:'bold'}},{content:pdfMoney(totalExpenses),styles:{halign:'right',fillColor:[255,241,242],textColor:[159,18,57],fontStyle:'bold'}}],
    [{content:'Net Savings',styles:{fillColor:[238,242,255],textColor:[49,46,129],fontStyle:'bold'}},{content:pdfMoney(net),styles:{halign:'right',fillColor:[238,242,255],textColor:[49,46,129],fontStyle:'bold'}}],
    [{content:'Savings Rate',styles:{fillColor:[255,251,235],textColor:[146,64,14],fontStyle:'bold'}},{content:(totalIncome>0?(net/totalIncome)*100:0).toFixed(1)+'%',styles:{halign:'right',fillColor:[255,251,235],textColor:[146,64,14],fontStyle:'bold'}}]
  ];
  doc.autoTable({startY:HEAD_H,theme:'grid',margin:{left:M,right:M},styles:{fontSize:9},body:kpi,columnStyles:{1:{cellWidth:120}}});
  let y=doc.lastAutoTable.finalY+16;
  const section=(title,sec,accent)=>{
    if(!sec.heads.length)return;
    const body=[];
    sec.heads.forEach(h=>{
      body.push([{content:h.name,styles:{fontStyle:'bold',fillColor:accent[1],textColor:accent[2]}},{content:pdfMoney(h.total),styles:{halign:'right'}}]);
      h.cats.forEach(c=>{
        body.push([{content:'  '+c.name,styles:{fontStyle:'bold'}},{content:pdfMoney(c.total),styles:{halign:'right'}}]);
        c.subs.forEach(s=>body.push([{content:'      '+s.name,styles:{textColor:[71,85,105]}},{content:pdfMoney(s.total),styles:{halign:'right'}}]));
      });
    });
    body.push([{content:`Total ${title}`,styles:{fontStyle:'bold',fillColor:accent[1],textColor:accent[2]}},{content:pdfMoney(sec.total),styles:{halign:'right',fillColor:accent[1],textColor:accent[2]}}]);
    if(y>doc.internal.pageSize.getHeight()-FOOT_H-80){doc.addPage();drawHeader();y=HEAD_H}
    doc.autoTable({startY:y,theme:'grid',margin:{left:M,right:M,top:HEAD_H,bottom:FOOT_H},
      head:[['Particulars',{content:'Amount',styles:{halign:'right'}}]],
      body,
      headStyles:{fillColor:[15,23,42],textColor:[255,255,255],fontStyle:'bold',fontSize:8.5},
      styles:{fontSize:8.5},
      columnStyles:{1:{cellWidth:110,halign:'right'}},
      didDrawPage:data=>{if(data.pageNumber>1)drawHeader()}
    });
    y=doc.lastAutoTable.finalY+16;
  };
  section('INCOME',data.income,['Income',[236,253,245],[6,95,70]]);
  section('EXPENSES',data.expense,['Expenses',[255,241,242],[159,18,57]]);
  const total=doc.getNumberOfPages();
  for(let i=1;i<=total;i++){
    doc.setPage(i);
    const W=pageW(),H=doc.internal.pageSize.getHeight();
    doc.setDrawColor(226,232,240);doc.setLineWidth(.6);doc.line(M,H-26,W-M,H-26);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,116,139);
    doc.text('Personal Finance  ·  SOIKOT RAIHAN',M,H-13);
    doc.text(`Page ${i} of ${total}`,W-M,H-13,{align:'right'});
  }
  doc.save(`Income-Expenses-Report-${incomeFilters.year||'All-Years'}-${todayISO()}.pdf`);
  toast(`Income & Expenses PDF report generated (${total} page${total===1?'':'s'})`);
}

/* --- Income / Expense category management (Settings) --- */
function renderCategoryFormFields(){
  const type=document.getElementById('categoryType').value;
  const isIncome=type==='Income'||type==='Expense';
  document.getElementById('majorHeadField').classList.toggle('hidden',!isIncome);
  const newMajorHidden=isIncome&&document.getElementById('categoryMajorHead').value==='__new__';
  document.getElementById('newMajorHeadField').classList.toggle('hidden',!newMajorHidden);
  document.getElementById('subcategoryName').placeholder=isIncome?'e.g. Grocery items':'e.g. Cash in Hand';
}
function renderCategoryMajorHeads(){
  const type=document.getElementById('categoryType').value;
  const sel=document.getElementById('categoryMajorHead');
  if(type==='Income'||type==='Expense'){
    const selected=sel.value;
    const heads=state.incomeGroups.filter(g=>g.type===type).map(g=>g.majorHead);
    sel.innerHTML=heads.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join('')+`<option value="__new__">＋ New Major Head…</option>`;
    sel.value=heads.includes(selected)||selected==='__new__'?selected:(heads[0]||'__new__');
  }
}
async function addIncomeGroupCategory(type,name,subcategory){
  if(!name||!subcategory){toast('Enter both a category and a subcategory name.',true);return}
  let majorHead=document.getElementById('categoryMajorHead').value;
  if(majorHead==='__new__'){
    majorHead=normClass(document.getElementById('newMajorHead').value);
    if(!majorHead){toast('Enter a name for the new major head.',true);return}
  }
  if(!majorHead){toast('Select or create a major head first.',true);return}
  majorHead=normClass(majorHead);
  const cls=ensureIncomeClass(type,majorHead,name,subcategory);
  await putMany('incomeGroups',state.incomeGroups);
  await loadState();
  document.getElementById('subcategoryName').value='';
  renderCategoryMajorHeads();
  document.getElementById('categoryMajorHead').value=cls.majorHead;
  renderCategoryFormFields();renderCategoryNameOptions();
  document.getElementById('categoryName').value=cls.category;
  renderCategoryTree();renderIncomePage();
  toast(`Added under ${cls.majorHead} → ${cls.category} → ${cls.subcategory}`);
}
async function renameIncomeGroup(id){
  const g=state.incomeGroups.find(x=>x.id===id);if(!g)return;
  const name=prompt('Edit major head name:',g.majorHead);
  if(!name||normClass(name)===g.majorHead)return;
  const newName=normClass(name),old=g.majorHead;
  g.majorHead=newName;
  for(const r of state.incomeExpenses.filter(r=>r.type===g.type&&r.majorHead===old)){r.majorHead=newName;await put('incomeExpenses',r)}
  await putMany('incomeGroups',state.incomeGroups);
  await loadState();renderCategoryTree();renderIncomePage();toast('Major head renamed');
}
async function deleteIncomeGroup(id){
  const g=state.incomeGroups.find(x=>x.id===id);if(!g)return;
  const linked=state.incomeExpenses.some(r=>r.type===g.type&&r.majorHead===g.majorHead);
  if(linked){toast('This major head has linked transactions and cannot be deleted.',true);return}
  if(await confirm(`Delete major head "${g.majorHead}" and all of its categories?`,'Delete Major Head')){
    await remove('incomeGroups',id);
    await loadState();renderCategoryTree();renderIncomePage();toast('Major head deleted');
  }
}
async function renameIncomeCategory(id,name){
  const g=state.incomeGroups.find(x=>x.id===id);if(!g)return;
  const cat=g.categories.find(c=>c.name===name);if(!cat)return;
  const newName=normClass(prompt('Edit category name:',cat.name)||'');
  if(!newName||newName===cat.name)return;
  const old=cat.name;cat.name=newName;
  for(const r of state.incomeExpenses.filter(r=>r.type===g.type&&r.majorHead===g.majorHead&&r.category===old)){r.category=newName;await put('incomeExpenses',r)}
  await putMany('incomeGroups',state.incomeGroups);
  await loadState();renderCategoryTree();renderIncomePage();toast('Category renamed');
}
async function deleteIncomeCategory(id,name){
  const g=state.incomeGroups.find(x=>x.id===id);if(!g)return;
  const cat=g.categories.find(c=>c.name===name);if(!cat)return;
  const linked=state.incomeExpenses.some(r=>r.type===g.type&&r.majorHead===g.majorHead&&r.category===name);
  if(linked){toast('This category has linked transactions and cannot be deleted.',true);return}
  if(await confirm(`Delete category "${name}" and all of its subcategories?`,'Delete Category')){
    g.categories=g.categories.filter(c=>c.name!==name);
    await putMany('incomeGroups',state.incomeGroups);
    await loadState();renderCategoryTree();renderIncomePage();toast('Category deleted');
  }
}
async function renameIncomeSubcategory(id,catName,name){
  const g=state.incomeGroups.find(x=>x.id===id);if(!g)return;
  const cat=g.categories.find(c=>c.name===catName);if(!cat)return;
  const newName=normClass(prompt('Edit subcategory name:',name)||'');
  if(!newName||newName===name)return;
  cat.subcategories=cat.subcategories.map(s=>s===name?newName:s);
  for(const r of state.incomeExpenses.filter(r=>r.type===g.type&&r.majorHead===g.majorHead&&r.category===catName&&r.subcategory===name)){r.subcategory=newName;await put('incomeExpenses',r)}
  await putMany('incomeGroups',state.incomeGroups);
  await loadState();renderCategoryTree();renderIncomePage();toast('Subcategory renamed');
}
async function deleteIncomeSubcategory(id,catName,name){
  const g=state.incomeGroups.find(x=>x.id===id);if(!g)return;
  const cat=g.categories.find(c=>c.name===catName);if(!cat)return;
  const linked=state.incomeExpenses.some(r=>r.type===g.type&&r.majorHead===g.majorHead&&r.category===catName&&r.subcategory===name);
  if(linked){toast('This subcategory has linked transactions and cannot be deleted.',true);return}
  if(await confirm(`Delete subcategory "${name}"?`,'Delete Subcategory')){
    cat.subcategories=cat.subcategories.filter(s=>s!==name);
    await putMany('incomeGroups',state.incomeGroups);
    await loadState();renderCategoryTree();renderIncomePage();toast('Subcategory deleted');
  }
}

/* --- Import workers (called by importExcel dispatcher) --- */
async function importAssetsLiabilitiesWorkbook(workbook,replaceId,fileName){
  const migrationId=replaceId||uid('mig');
  const seen=replaceId?new Set():new Set(state.records.filter(r=>r.sourceSheet).map(r=>`${r.sourceSheet}|${r.sourceRow}`));
  const toSave=[],years=new Set();
  let skippedDuplicates=0,manual=0,truncated=0;
  const summary=[];
  for(const sheetName of workbook.SheetNames){
    if(/balance sheet/i.test(sheetName))continue;
    const schema=findSchemaBySheet(sheetName);
    if(!schema){manual++;continue}
    const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true});
    if(aoa.length>MAX_IMPORT_ROWS){aoa.length=MAX_IMPORT_ROWS;truncated++}
    const {records,headerRow}=mapSheetToRecords(schema,aoa);
    if(headerRow<0){manual++;continue}
    let count=0;
    for(const record of records){
      const key=`${record.sourceSheet}|${record.sourceRow}`;
      if(seen.has(key)){skippedDuplicates++;continue}
      seen.add(key);
      record.id=uid('record');record.updatedAt=new Date().toISOString();
      record.migrationId=migrationId;
      if(record.incomeYear)years.add(record.incomeYear);
      toSave.push(record);count++;
    }
    summary.push(`${schema.subcategory}: ${count}`);
  }
  if(replaceId&&!toSave.length){toast('The replacement file produced no valid rows — the existing batch was left unchanged.',true);return}
  const newCategories=[];
  for(const r of toSave){
    let category=state.categories.find(c=>c.type===r.type&&c.name===r.category)||newCategories.find(c=>c.type===r.type&&c.name===r.category);
    if(!category){category={id:uid('category'),type:r.type,name:r.category,subcategories:[]};newCategories.push(category)}
    if(!category.subcategories.includes(r.subcategory)){category.subcategories.push(r.subcategory);if(!newCategories.includes(category))newCategories.push(category)}
  }
  if(newCategories.length)await putMany('categories',newCategories);
  if(replaceId)await removeMigrationRows(replaceId);
  if(toSave.length)await putMany('records',toSave);
  const knownYears=new Set(state.settings.incomeYears||[]);
  if([...years].some(y=>!knownYears.has(y))){
    state.settings.incomeYears=[...new Set([...knownYears,...years])].sort((a,b)=>String(b).localeCompare(String(a)));
    await put('settings',{key:'incomeYears',value:state.settings.incomeYears});
  }
  await saveMigrationMeta(migrationId,replaceId,'Assets & Liabilities',fileName,toSave.length,skippedDuplicates);
  await loadState();renderAll();
  const truncatedNote=truncated?` ${truncated} sheet(s) were read up to ${MAX_IMPORT_ROWS} rows.`:'';
  toast(`${replaceId?'Replaced':'Import complete'}: ${toSave.length} imported, ${skippedDuplicates} duplicate(s) skipped, ${manual} sheet(s) need manual review.${truncatedNote}`,manual>0&&!toSave.length);
  console.info('Excel import summary',summary);
}
async function importIncomeExpensesWorkbook(workbook,replaceId,fileName){
  const migrationId=replaceId||uid('mig');
  const fiscalStart=findFiscalStart(workbook);
  const months=['july','august','september','october','november','december','january','february','march','april','may','june'];
  const monthSheets=[];
  for(const name of workbook.SheetNames){
    const m=name.match(/\((\d{2})\)\s*(.+)/i);
    if(!m)continue;
    const mi=months.findIndex(mo=>String(m[2]).toLowerCase().startsWith(mo.slice(0,3)));
    if(mi>=0)monthSheets.push({name,num:+m[1]});
  }
  monthSheets.sort((a,b)=>a.num-b.num);
  const seen=replaceId?new Set():new Set(state.incomeExpenses.filter(r=>r.sourceSheet).map(r=>`${r.sourceSheet}|${r.sourceRow}`));
  const toSave=[];let skipped=0;
  for(const ms of monthSheets){
    const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[ms.name],{header:1,defval:'',raw:true});
    if(aoa.length>MAX_IMPORT_ROWS)aoa.length=MAX_IMPORT_ROWS;
    const rows=parseIncomeExpensesSheet(aoa,ms.num,ms.name,fiscalStart);
    for(const rec of rows){
      const key=`${ms.name}|${rec.sourceRow}`;
      if(seen.has(key)){skipped++;continue}
      seen.add(key);
      rec.migrationId=migrationId;
      toSave.push(rec);
    }
  }
  if(replaceId&&!toSave.length){toast('The replacement file produced no valid rows — the existing batch was left unchanged.',true);return}
  if(replaceId)await removeMigrationRows(replaceId);
  if(toSave.length)await putMany('incomeExpenses',toSave);
  await putMany('incomeGroups',state.incomeGroups);
  const years=new Set(toSave.map(r=>r.incomeYear).filter(Boolean));
  const known=new Set(state.settings.incomeYears||[]);
  if([...years].some(y=>!known.has(y))){
    state.settings.incomeYears=[...new Set([...known,...years])].sort((a,b)=>String(b).localeCompare(String(a)));
    await put('settings',{key:'incomeYears',value:state.settings.incomeYears});
  }
  await saveMigrationMeta(migrationId,replaceId,'Income & Expenses',fileName,toSave.length,skipped);
  await loadState();renderAll();
  toast(`${replaceId?'Replaced':'Imported'} ${toSave.length} income/expense entries from Income & Expenses.xlsx (Skipped ${skipped} duplicates)`);
}
async function importBudgeFile(aoa,sourceName,replaceId){
  const migrationId=replaceId||uid('mig');
  const headerRow=detectBudgeHeader(aoa);
  if(headerRow<0){toast('No Budge header row found in this file.',true);return}
  const headerCells=(aoa[headerRow]||[]).map(c=>normKey(String(c??'')));
  const cols={};headerCells.forEach((c,i)=>{if(c)cols[c]=i});
  const get=(row,key)=>row[cols[key]];
  const existingHashes=replaceId?new Set():new Set(state.incomeExpenses.map(r=>r.importHash).filter(Boolean));
  const toSave=[];let skipped=0;
  for(let i=headerRow+1;i<aoa.length;i++){
    const row=aoa[i]||[];
    const rawDate=get(row,'date');
    if(!rawDate)continue;
    const firstCell=normClass(String(row[0]||''));
    if(!firstCell||firstCell.startsWith('###')||firstCell.startsWith('format version'))continue;
    const date=parseBudgeDate(rawDate);
    if(!date)continue;
    let amount=parseExcelNumber(get(row,'amount'));
    if(!amount)continue;
    const type=amount<0?'Expense':'Income';
    amount=Math.abs(amount);
    const account=normalizeAccount(get(row,'account'));
    const category=String(get(row,'category')||'').trim();
    const subcategory=String(get(row,'subcategory')||'').trim();
    const payment=String(get(row,'payment')||'').trim();
    const goal=String(get(row,'goal')||'').trim();
    const descRaw=String(get(row,'description')||'').trim();
    const description=buildBudgeDescription(descRaw,payment,goal,category,subcategory);
    const cls=normalizeBudgeClassification(type,category,subcategory);
    // Row-level identity, not a content hash: two legitimate transactions that happen to share
    // the same date, amount, account and category/subcategory are NOT duplicates. The source file
    // name plus the source row number uniquely identifies each exported row, so re-importing the
    // same file still skips already-imported rows without silently dropping valid entries.
    const hash=hashString(`${sourceName||'budge'}|${i+1}`);
    if(existingHashes.has(hash)){skipped++;continue}
    existingHashes.add(hash);
    toSave.push({id:uid('ie'),type,date,incomeYear:fiscalYearFromDate(date),majorHead:cls.majorHead,category:cls.category,subcategory:cls.subcategory,amount,account,description,documentIds:[],importHash:hash,migrationId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  if(replaceId&&!toSave.length){toast('The replacement file produced no valid rows — the existing batch was left unchanged.',true);return}
  if(replaceId)await removeMigrationRows(replaceId);
  if(toSave.length)await putMany('incomeExpenses',toSave);
  await putMany('incomeGroups',state.incomeGroups);
  const years=new Set(toSave.map(r=>r.incomeYear).filter(Boolean));
  const known=new Set(state.settings.incomeYears||[]);
  if([...years].some(y=>!known.has(y))){
    state.settings.incomeYears=[...new Set([...known,...years])].sort((a,b)=>String(b).localeCompare(String(a)));
    await put('settings',{key:'incomeYears',value:state.settings.incomeYears});
  }
  await saveMigrationMeta(migrationId,replaceId,'Budge CSV',sourceName,toSave.length,skipped);
  await loadState();renderAll();
  toast(`${replaceId?'Replaced':'Imported'} ${toSave.length} transactions (Skipped ${skipped} already imported)`);
}

/* --- Migration batch tracking (Settings → Excel & Budge CSV Migration history) --- */
async function saveMigrationMeta(id,isReplace,type,fileName,imported,skipped){
  if(isReplace){
    const existing=state.migrationHistory.find(m=>m.id===id)||{id};
    await put('migrationHistory',Object.assign({},existing,{id,fileName,migrationType:type,timestamp:new Date().toISOString(),importedCount:imported,skippedCount:skipped,status:'completed'}));
  }else if(imported>0){
    await put('migrationHistory',{id,fileName,migrationType:type,timestamp:new Date().toISOString(),importedCount:imported,skippedCount:skipped,status:'completed'});
  }
}
/** Delete every record and PDF linked to one migration batch (used by both Delete and Replace). */
async function removeMigrationRows(migrationId){
  const recordIds=state.records.filter(r=>r.migrationId===migrationId).map(r=>r.id);
  const ieIds=state.incomeExpenses.filter(r=>r.migrationId===migrationId).map(r=>r.id);
  const docIds=new Set();
  for(const r of state.records)if(r.migrationId===migrationId)(r.documentIds||[]).forEach(d=>docIds.add(d));
  for(const r of state.incomeExpenses)if(r.migrationId===migrationId)(r.documentIds||[]).forEach(d=>docIds.add(d));
  for(const d of state.documents)if(recordIds.includes(d.recordId)||ieIds.includes(d.recordId))docIds.add(d.id);
  if(recordIds.length)await removeMany('records',recordIds);
  if(ieIds.length)await removeMany('incomeExpenses',ieIds);
  if(docIds.size){await removeMany('documents',[...docIds]);await removeMany('documentBlobs',[...docIds])}
}
function renderMigrationHistory(){
  const host=document.getElementById('migrationHistoryList');
  if(!host)return;
  const history=state.migrationHistory.slice().sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
  host.innerHTML=history.length
    ? `<div class="table-wrap"><table class="migration-history-table"><thead><tr><th scope="col">Date &amp; Time</th><th scope="col">File Name</th><th scope="col">Migration Type</th><th scope="col" class="num">Records Imported</th><th scope="col">Actions</th></tr></thead><tbody>${history.map(m=>`<tr><td>${esc(new Date(m.timestamp).toLocaleString())}</td><td>${esc(m.fileName||'—')}</td><td><span class="badge migration-badge">${esc(m.migrationType||'—')}</span></td><td class="num">${Number(m.importedCount)||0}</td><td class="actions-cell"><button type="button" class="action-link" data-cmd="edit-migration" data-id="${esc(m.id)}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-migration" data-id="${esc(m.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state">No migrations recorded in this browser yet.</div>';
}
function migrationRowSummary(r,store){
  return store==='records'
    ? {date:r.date,type:r.type,category:r.category,subcategory:r.subcategory,amount:recordAmount(r)}
    : {date:r.date,type:r.type,category:r.category,subcategory:r.subcategory,amount:Number(r.amount)||0};
}
function renderMigrationEditor(id){
  const mig=state.migrationHistory.find(m=>m.id===id);
  if(!mig)return;
  const recRows=state.records.filter(r=>r.migrationId===id).map(r=>({r,store:'records'}));
  const ieRows=state.incomeExpenses.filter(r=>r.migrationId===id).map(r=>({r,store:'incomeExpenses'}));
  const rows=[...recRows,...ieRows];
  document.getElementById('migrationEditTitle').textContent='Edit Migration';
  document.getElementById('migrationEditSubtitle').textContent=`${mig.migrationType} · ${mig.fileName}`;
  document.getElementById('migrationEditMeta').textContent=`${rows.length} record(s) in this batch · imported ${new Date(mig.timestamp).toLocaleString()}`;
  const cells=rows.map(({r,store})=>{
    const s=migrationRowSummary(r,store);
    return `<tr><td>${esc(fmtDate(s.date)||'—')}</td><td><span class="badge ${esc(s.type.toLowerCase())}">${esc(s.type)}</span></td><td>${esc(s.category)}</td><td>${esc(s.subcategory)}</td><td class="num">${formatMoney(s.amount)}</td><td class="actions-cell"><button type="button" class="action-link danger" data-cmd="remove-migration-row" data-mig="${esc(id)}" data-store="${store}" data-id="${esc(r.id)}">Remove</button></td></tr>`;
  }).join('');
  document.getElementById('migrationEditRows').innerHTML=rows.length
    ? `<div class="table-wrap"><table class="migration-edit-table"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Category</th><th scope="col">Subcategory</th><th scope="col" class="num">Amount</th><th scope="col">Action</th></tr></thead><tbody>${cells}</tbody></table></div>`
    : '<div class="empty-state">No records in this batch. Choose a replacement file to re-import.</div>';
}
function editMigration(id){
  const mig=state.migrationHistory.find(m=>m.id===id);
  if(!mig)return;
  replaceMigrationId=id;
  renderMigrationEditor(id);
  document.getElementById('migrationEditModal').showModal();
}
async function removeMigrationRow(migId,store,id){
  let docIds=[];
  if(store==='incomeExpenses'){
    const r=state.incomeExpenses.find(x=>x.id===id);
    docIds=[...(r?.documentIds||[]),...state.documents.filter(d=>d.recordId===id).map(d=>d.id)];
    await remove('incomeExpenses',id);
  }else{
    const r=state.records.find(x=>x.id===id);
    docIds=[...(r?.documentIds||[]),...state.documents.filter(d=>d.recordId===id).map(d=>d.id)];
    await remove('records',id);
  }
  for(const did of new Set(docIds)){await remove('documents',did);await remove('documentBlobs',did)}
  await loadState();
  const mig=state.migrationHistory.find(m=>m.id===migId);
  if(mig){
    mig.importedCount=state.records.filter(r=>r.migrationId===migId).length+state.incomeExpenses.filter(r=>r.migrationId===migId).length;
    await put('migrationHistory',mig);
    renderMigrationEditor(migId);
  }
  renderAll();toast('Row removed from migration batch');
}
async function deleteMigration(id){
  const mig=state.migrationHistory.find(m=>m.id===id);
  if(!mig)return;
  const count=state.records.filter(r=>r.migrationId===id).length+state.incomeExpenses.filter(r=>r.migrationId===id).length;
  if(!(await confirm(`Delete migration "${mig.fileName}" and the ${count} record(s) it imported? This cannot be undone.`,'Delete Migration')))return;
  await removeMigrationRows(id);
  await remove('migrationHistory',id);
  await loadState();renderAll();
  toast(`Migration deleted (${count} record(s) removed)`);
}

/* ==========================================================================
   PWA: service worker + install prompt
   ========================================================================== */
/** Persistent "new version" bar: a toast disappears before the user can act on it. */
function showUpdateBanner(worker){
  let banner=document.getElementById('updateBanner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='updateBanner';
    banner.className='update-banner';
    banner.setAttribute('role','status');
    const text=document.createElement('span');
    text.textContent='A new version is available.';
    const reload=document.createElement('button');
    reload.type='button';reload.className='btn btn-primary';reload.textContent='Reload';
    reload.onclick=()=>{try{worker.postMessage('SKIP_WAITING')}catch(e){}setTimeout(()=>location.reload(),150)};
    const dismiss=document.createElement('button');
    dismiss.type='button';dismiss.className='update-dismiss';dismiss.setAttribute('aria-label','Dismiss update notice');dismiss.textContent='×';
    dismiss.onclick=()=>banner.remove();
    banner.append(text,reload,dismiss);
    document.body.appendChild(banner);
  }
}
function setupPWA(){
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)){
    navigator.serviceWorker.register('sw.js').then(reg=>{
      reg.addEventListener('updatefound',()=>{
        const worker=reg.installing;
        if(worker)worker.addEventListener('statechange',()=>{
          if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdateBanner(worker);
        });
      });
    }).catch(error=>console.warn('Service worker registration failed',error));
  }
  const buttons=[$el('installBtn'),$el('installBtnSettings')];
  const setVisible=v=>buttons.forEach(b=>b.classList.toggle('hidden',!v));
  const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();deferredInstallPrompt=event;setVisible(true);
  });
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;setVisible(false);toast('Personal Finance installed')});
  const install=async()=>{
    if(deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(()=>null);
      deferredInstallPrompt=null;setVisible(false);
    }else if(ios){
      toast('On iPhone/iPad: tap Share, then "Add to Home Screen".');
    }
  };
  buttons.forEach(b=>b.onclick=install);
  if(standalone){
    $el('installHint').textContent='Personal Finance is running as an installed app.';
  }else if(ios){
    setVisible(true);
    $el('installHint').textContent='On iPhone/iPad: tap the Share button in Safari, then choose "Add to Home Screen".';
  }
}

init().catch(showFatal);
