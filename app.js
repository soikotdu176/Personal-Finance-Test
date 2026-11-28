/* ==========================================================================
   Personal Finance - Personal Assets & Liabilities Management System
   Vanilla JS · IndexedDB (AssetBookDB) · Chart.js · JSZip · SheetJS · jsPDF
   Data safety rules enforced here:
     - a new release never deletes local data (see checkDataVersion)
     - PDF blobs live in their own store, so start-up never loads megabytes of PDFs
   ========================================================================== */

/* =====================================================================================
   SITE PROFILE - the SAME files run as the Test site and as the Main site.
   The profile is chosen from the URL, so copying files between the two folders needs NO edits:
     .../Personal-Finance-Test/  (path contains "test")  ->  Test profile
     .../Personal-Finance/       (anything else)         ->  Main profile
   Both sites share the origin soikotdu176.github.io, so every browser-side name must differ.
   The ONLY thing to fill in once: main.clientId = Client ID of the "Personal Finance" Google Cloud project.
   ===================================================================================== */
const SITE_PROFILES = {
  test: {
    prefix: 'assetbook',                          // localStorage / sessionStorage / cache-name prefix
    dbName: 'AssetBookDB',                        // IndexedDB database
    driveFolder: 'PersonalFinance_Backups',       // Google Drive folder
    clientId: '232563199720-sn7bke2332p585r4jlcaflvjhjfk0ut8.apps.googleusercontent.com',
    seedProject: true                             // Test only: import the Project/ workbooks into an empty database
  },
  main: {
    prefix: 'pf',
    dbName: 'PF',
    driveFolder: 'PF_Backup',
    clientId: '587017846090-evhpra2iegie48q2t49fv71invkumte8.apps.googleusercontent.com',
    seedProject: false                            // never auto-import (private workbooks must not be deployed)
  }
};
const SITE = /test/i.test(location.pathname) ? SITE_PROFILES.test : SITE_PROFILES.main;

const DB_NAME = SITE.dbName;
const DB_VERSION = 6;                       // v6: protected settingsStore keeps the Major Head / Category / Subcategory tree
const APP_VERSION = '2026-11-27-v18';
const DATA_VERSION_KEY = SITE.prefix + '-data-version';
let db;
let state = { records: [], categories: [], documents: [], settings: {}, backupHistory: [], incomeExpenses: [], deductedRecords: [], incomeGroups: [], migrationHistory: [], officePurchases: [], categoryStructureMeta: {} };
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
/* Settings sub-pages (tab bar inside #settingsPage). The active tab is remembered in
   localStorage so a reload or a trip to another page keeps the user where they were. */
const SETTINGS_TABS = ['general', 'categories', 'migration', 'drive', 'storage'];
let settingsTab = 'general';
const incomeFilters = { search: '', year: '', month: '', type: '', majorHead: '', category: '', subcategory: '' };
const incomeDocDraft = { existing: [], removed: new Set(), replaced: new Map(), added: [] };
/* Office Purchase & Bill page state (kept separate from the Dashboard / Income state). */
let editingOfficeId = null;
let savingOffice = false;
let officePage = 1;
let officeYearChosen = false;
const officeFilters = { years: null, type: '', account: '', category: '', search: '' };
let officeYearMenuOpen = false;
const officeDocDraft = { existing: [], removed: new Set(), added: [] };
let zakatState = {
  holder:'',
  hijriStart:'',gregorianStart:'',hijriEnd:'',gregorianEnd:'',
  nisab:189000,nisabReference:'',cash:0,bank:0,investments:0,roi:0,receivables:0,liabilities:0,
  referencePdf:null,
  gold:[],
  payments:[]
};
let zakatRecords = [];
let activeSavedZakatId = null;

const ASSET_DEDUCTIONS=['Gift','Loss','Damage'];
const DEDUCTION_MAJOR_HEAD='Loss Deduction';
const DEDUCTION_ITEM_LABEL='Furniture, Electronics & Equipments';
const DEDUCTION_CATEGORY='Other Expense - '+DEDUCTION_ITEM_LABEL;

const defaultCategories = [
  {id:'c-bank-loan',type:'Liability',name:'Bank Loan',subcategories:['Bank Loan'],order:0},
  {id:'c-cash',type:'Asset',name:'Cash & Bank Account',subcategories:['Cash In Hand','Basic Bank PLC','DBBL','Bkash','Rocket','Nagad','Redotpay'],order:1},
  {id:'c-investments',type:'Asset',name:'Investments',subcategories:['CPF (Own)','CPF (Company)','Group Insurance','Welfare Fund','Other Investment / Co-operation'],order:2},
  {id:'c-property',type:'Asset',name:'Property',subcategories:['Land & Primary Residence','Vehicles','Jewelry','Other Property'],order:3},
  {id:'c-other-liabilities',type:'Liability',name:'Other Liabilities',subcategories:['Other Liabilities'],order:4},
  {id:'c-payable',type:'Liability',name:'Accounts Payable',subcategories:['Accounts Payable'],order:5},
  {id:'c-retirement',type:'Asset',name:'Retirement',subcategories:['Gratuity'],order:6},
  {id:'c-other-assets',type:'Asset',name:'Other Assets',subcategories:['Furniture, Electronics & Equipments','Accounts Receivable'],order:7}
];

/* Master Income / Expense classification tree (mapped to "Income & Expenses.xlsx"). */
const defaultIncomeGroups = [
  {id:'ig-food',type:'Expense',majorHead:'Expenses for Food, Clothing and Other Essentials',categories:[
    {name:'Food',subcategories:['Grocery items','Snacks items','Dining/Eating Out','Mess']},
    {name:'Clothing',subcategories:['Own','Spouse','Family','Offspring','Laundry']},
    {name:'Personal Supplies',subcategories:['Own','Spouse','Offspring','Family']},
    {name:'Medicine & Doctor',subcategories:['Own','Spouse','Offspring','Family']},
    {name:'Pocket Money',subcategories:['Spouse','Offspring','Family']},
    {name:'Contribution For Family',subcategories:['Regular']}
  ],order:0},
  {id:'ig-accommodation',type:'Expense',majorHead:'Accommodation Expense',categories:[
    {name:'Accommodation',subcategories:['Household Rent']}
  ],order:1},
  {id:'ig-auto',type:'Expense',majorHead:'Auto and Transportation Expenses',categories:[
    {name:'Fuel and Maintenance',subcategories:['Fuel and Maintenance']},
    {name:'Other Transportation',subcategories:['Auto','Bus','Train','Others']}
  ],order:2},
  {id:'ig-utility',type:'Expense',majorHead:'Household and Utility Expenses',categories:[
    {name:'Electricity',subcategories:['Rent House','Own House']},
    {name:'Gas, Water, Sewer & Garbage',subcategories:['Gas','Water','Sewer','Garbage']},
    {name:'Phone, Internet, TV channels and Subscription',subcategories:['Mobile Internet','Mobile Recharge','Wifi Bill']},
    {name:'Home-Support Staff and Other Expenses',subcategories:['Maid','Small Kitchen Appliances','Small Home Appliances','Toiletries','Others']}
  ],order:3},
  {id:'ig-education',type:'Expense',majorHead:'Education Expenses',categories:[
    {name:'Education',subcategories:['Books & Others','School Fees','Tution Fees','Islamic Books','Online Courses']}
  ],order:4},
  {id:'ig-festival',type:'Expense',majorHead:'Festival And Other Special Expenses',categories:[
    {name:'Festival, Party, Events',subcategories:['Eid Festivals','Events','Party']},
    {name:'Domestic and Overseas Tour, Holiday, Etc.',subcategories:['Transportation Cost','Hotel Cost','Shopping']},
    {name:'Philanthropy, Etc',subcategories:['Zakat','Sadka','Other Donation']},
    {name:'Other Special Expenses',subcategories:['Own','Spouse','Offspring','Family']}
  ],order:5},
  {id:'ig-misc',type:'Expense',majorHead:'Any Other Expenses',categories:[
    {name:'Miscellaneous',subcategories:['Any Other Expenses']},
    {name:'Bank/ATM Charge',subcategories:['Bank Charge','ATM Charge']},
    {name:'Mobile Banking Charge',subcategories:['Bkash','Rocket','Nagad','Others']}
  ],order:6},
  {id:'ig-salary',type:'Income',majorHead:'Income From Employment',categories:[
    {name:'Salary',subcategories:['Basic Salary']},
    {name:'Allowances',subcategories:['House Rent Allowance','Conveyance Allowance','Medical Allowance','Gas Subsidy','Tiffin Allowance','Dearness Allowance','Education Allowance','Noboborso Allowance','Recreation Leave','Enterainment allowance','Washing Allowance','Shifting Allowance','Domestic Aid Allowance','Subsistence Allowance','Staff Over Allance','Honorarium']},
    {name:'Bonus',subcategories:['Incentive/other Bonus','Festival Bonus']}
  ],order:7},
  {id:'ig-fcf29151-3744-4dbe-ba17-31c20c63532b',type:'Income',majorHead:'Income from Other Sources',categories:[
    {name:'WPPF',subcategories:['Payment from WPPF']}
  ],order:8},
  {id:'ig-loss-deduction',type:'Expense',majorHead:DEDUCTION_MAJOR_HEAD,categories:[
    {name:DEDUCTION_CATEGORY,subcategories:[...ASSET_DEDUCTIONS]}
  ],order:9},
  {id:'ig-tax',type:'Expense',majorHead:'Tax, Charges, Etc. Paid',categories:[
    {name:'Tax & Surcharge',subcategories:['Payment of Tax at Source & Advance Tax','Payment of Tax, Surcharge or Other Amounts']}
  ],order:9},
  {id:'ig-73e7dce6-fe71-41ae-8ea4-20c06f05e559',type:'Income',majorHead:'Income With CPF',categories:[
    {name:'CPF (Company)',subcategories:['CPF (Company)']}
  ],order:10},
  {id:'ig-5618cd06-4c98-44cf-b57d-9ae43e112bba',type:'Income',majorHead:'Income From Financial Assets',categories:[
    {name:'Interest',subcategories:['Basic Bank PLC','DBBL','Bkash']}
  ],order:11},
  {id:'ig-other-receive',type:'Income',majorHead:'Income From Other Receive (PGCL)',categories:[
    {name:'Allowances & Other Receives',subcategories:['Lunch Subsidy','Leverage','TA+DA','Training Allowance','Previous Year Profit Bonus']}
  ],order:12}
];

/* Payment methods offered by the Add / Edit form and recognised by imports. */
const ACCOUNTS = ['Cash In Hand','Basic Bank PLC','DBBL','Bkash','Rocket','Nagad','Redotpay','Card','Other'];

/* Workbooks kept in the local Project/ folder. They are loaded once into an empty
   database (same pipeline as Settings -> Import) so the Dashboard shows the complete
   finances on first launch. Existing local data is never replaced. */
const PROJECT_DATASET = !SITE.seedProject ? [] : [
  'Project/Assets & Liabilities.xlsx',
  'Project/Income & Expenses.xlsx',
  'Project/Office Purchase & Bill.xlsx',
  'Project/budge-01-07-2026-31-07-2026_1795143633525.csv'
];
const PROJECT_DATASET_FLAG = SITE.prefix + '-project-dataset';

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
      // v6: protected settings store. Holds the full Major Head / Category / Subcategory tree;
      // it is seeded once and is never cleared by an import or a backup restore.
      if(!database.objectStoreNames.contains('settingsStore')) database.createObjectStore('settingsStore',{keyPath:'key'});
      // v5: Office Purchase & Bill ledger - completely separate from the Dashboard records.
      if(!database.objectStoreNames.contains('officePurchases')){
        const op=database.createObjectStore('officePurchases',{keyPath:'id'});
        ['date','incomeYear','type','account','category','migrationId','importHash'].forEach(k=>op.createIndex(k,k,{unique:false}));
      }
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
function isDriveSyncMetadata(store,value){
  if(store==='backupHistory')return true;
  if(store!=='settings')return false;
  const key=typeof value==='string'?value:value&&value.key;
  return typeof key==='string'&&/^drive/i.test(key);
}
function scheduleDriveBackupAfterMutation(store,value){
  if(!isDriveSyncMetadata(store,value))scheduleDriveAutoBackup();
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
    request.onsuccess=()=>{scheduleDriveBackupAfterMutation(store,value);resolve(request.result)};
    request.onerror=()=>reject(request.error);
  });
}
function putMany(store,items){
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(store,'readwrite');
    const objectStore=transaction.objectStore(store);
    items.forEach(item=>objectStore.put(item));
    transaction.oncomplete=()=>{if(items.some(item=>!isDriveSyncMetadata(store,item)))scheduleDriveAutoBackup();resolve()};
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });
}
function remove(store,key){
  return new Promise((resolve,reject)=>{
    const request=tx(store,'readwrite').delete(key);
    request.onsuccess=()=>{scheduleDriveBackupAfterMutation(store,key);resolve()};
    request.onerror=()=>reject(request.error);
  });
}
function removeMany(store,keys){
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(store,'readwrite');
    const objectStore=transaction.objectStore(store);
    (keys||[]).forEach(key=>objectStore.delete(key));
    transaction.oncomplete=()=>{if((keys||[]).some(key=>!isDriveSyncMetadata(store,key)))scheduleDriveAutoBackup();resolve()};
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
    transaction.oncomplete=()=>{if(store!=='backupHistory'&&(store!=='settings'||(items||[]).some(item=>!isDriveSyncMetadata(store,item))))scheduleDriveAutoBackup();resolve()};
    transaction.onerror=()=>reject(transaction.error||new Error('Could not write to the database.'));
    transaction.onabort=()=>reject(transaction.error||new Error('The database rejected the write (is the disk full?).'));
  });
}

/* ==========================================================================
   Protected category structure (settingsStore)
   The whole Major Head -> Category -> Subcategory tree is mirrored into one record
   in the dedicated "settingsStore" object store. Rules:
     - it is seeded exactly once per browser, guarded by the settingsStore record
       'masterCategoryListExists' (written together with the tree in one transaction)
     - imports / migrations and backup restores may only ADD to it (never clear,
       overwrite or re-seed it), so a reload can never lose the user's structure
     - every Manage Categories save / edit / delete writes it immediately
   ========================================================================== */
const SETTINGS_STORE = 'settingsStore';
const CATEGORY_STRUCTURE_KEY = 'categoryStructure';
const CATEGORY_INIT_KEY = 'masterCategoryListExists';   // one-time guard: structure already seeded
const CATEGORY_STRUCTURE_VERSION = 2;       // revision 2: definitive Major Head / Category / Subcategory tree
const cloneStructure = value => JSON.parse(JSON.stringify(value));
const structureName = value => String(value ?? '').trim().toLowerCase();

function defaultCategoryStructure(){
  return {categories:cloneStructure(defaultCategories),incomeGroups:cloneStructure(defaultIncomeGroups)};
}

/** Reads the protected record; null means "not initialized yet". */
async function readCategoryStructure(){
  try{
    const stored = await getOne(SETTINGS_STORE, CATEGORY_STRUCTURE_KEY);
    if(stored && Array.isArray(stored.categories) && Array.isArray(stored.incomeGroups)) return stored;
  }catch(error){console.warn('Category structure could not be read', error)}
  return null;
}

/** Writes the supplied tree to settingsStore and refreshes the "System/Custom Data" badge. */
async function writeCategoryStructure(categories, incomeGroups, source){
  const record = {
    key: CATEGORY_STRUCTURE_KEY,
    version: CATEGORY_STRUCTURE_VERSION,
    source: source === 'default' ? 'default' : 'user',
    updatedAt: new Date().toISOString(),
    categories: cloneStructure(categories || []),
    incomeGroups: cloneStructure(incomeGroups || [])
  };
  await put(SETTINGS_STORE, record);
  state.categoryStructureMeta = {source: record.source, updatedAt: record.updatedAt};
  updateCategoryStructureBadge();
  return record;
}

/** Called by every Manage Categories handler so the UI change is durable immediately.
 *  Writes the `categories` and `incomeGroups` arrays of the protected settingsStore record. */
async function persistCategoryStructure(source = 'user'){
  const record = await writeCategoryStructure(state.categories, state.incomeGroups, source);
  scheduleDriveAutoBackup();
  return record;
}

/** Public surface of the category module (Manage Categories UI + backup/restore hooks). */
const CategoryManager = {
  read: readCategoryStructure,
  persist: persistCategoryStructure,
  merge: mergeCategoryStructure,
  refreshBadge: updateCategoryStructureBadge
};

/** Union merge: adds anything missing from `source`, never removes or renames existing rows. */
function mergeStructureInto(target, source){
  let changed = false;
  if(!Array.isArray(target.categories)) target.categories = [];
  if(!Array.isArray(target.incomeGroups)) target.incomeGroups = [];
  const addSubs = (holder, list) => {
    if(!Array.isArray(holder.subcategories)) holder.subcategories = [];
    (list || []).forEach(name => {
      const value = String(name ?? '').trim();
      if(!value) return;
      if(!holder.subcategories.some(existing => structureName(existing) === structureName(value))){
        holder.subcategories.push(value);
        changed = true;
      }
    });
  };
  ((source && source.categories) || []).forEach(incoming => {
    if(!incoming) return;
    const match = target.categories.find(item => (incoming.id && item.id === incoming.id) ||
      (item.type === incoming.type && structureName(item.name) === structureName(incoming.name)));
    if(!match){
      target.categories.push(cloneStructure(incoming));
      changed = true;
      return;
    }
    addSubs(match, incoming.subcategories);
  });
  ((source && source.incomeGroups) || []).forEach(incoming => {
    if(!incoming) return;
    const group = target.incomeGroups.find(item => (incoming.id && item.id === incoming.id) ||
      (item.type === incoming.type && structureName(item.majorHead) === structureName(incoming.majorHead)));
    if(!group){
      target.incomeGroups.push(cloneStructure(incoming));
      changed = true;
      return;
    }
    if(!Array.isArray(group.categories)) group.categories = [];
    (incoming.categories || []).forEach(cat => {
      if(!cat) return;
      const match = group.categories.find(item => structureName(item.name) === structureName(cat.name));
      if(!match){
        const copy = {name: cat.name, subcategories: []};
        if(Array.isArray(cat.subcategories)) copy.subcategories = cloneStructure(cat.subcategories);
        group.categories.push(copy);
        changed = true;
        return;
      }
      addSubs(match, cat.subcategories);
    });
  });
  return changed;
}

/**
 * Writes the definitive tree as the base system state. The legacy stores are re-written from the
 * same tree, so the loadState() merge cannot put removed rows back into the protected record.
 */
async function seedCategoryStructure(source = 'default'){
  const structure = defaultCategoryStructure();
  await replaceStore('categories', structure.categories).catch(error => console.warn('Legacy category store could not be synced', error));
  await replaceStore('incomeGroups', structure.incomeGroups).catch(error => console.warn('Legacy income group store could not be synced', error));
  return writeCategoryStructure(structure.categories, structure.incomeGroups, source);
}

/**
 * Initializes the persistent category structure ONCE, inside a single settingsStore transaction:
 * the guard record ('masterCategoryListExists') and the record that holds the `categories` /
 * `incomeGroups` arrays from the definitive JSON are written together. Because the guard is
 * checked first, a reload, an Excel / Budge import or a backup restore can never re-seed or
 * overwrite the saved tree. A record that is already at the current revision is left untouched
 * (only the guard is added), so the user's Manage Categories edits always survive an upgrade.
 * @returns {Promise<boolean>} true when this call wrote the definitive tree.
 */
function initializePersistentCategories(){
  return new Promise((resolve,reject)=>{
    const structure = defaultCategoryStructure();
    const updatedAt = new Date().toISOString();
    let seeded = false;
    const transaction = db.transaction(SETTINGS_STORE,'readwrite');
    const store = transaction.objectStore(SETTINGS_STORE);
    const guard = store.get(CATEGORY_INIT_KEY);
    guard.onsuccess = () => {
      if(guard.result) return;                                   // already initialized once
      const existing = store.get(CATEGORY_STRUCTURE_KEY);
      existing.onsuccess = () => {
        const stored = existing.result;
        const current = !!stored && Number(stored.version || 1) >= CATEGORY_STRUCTURE_VERSION;
        store.put({key: CATEGORY_INIT_KEY, value: true, version: CATEGORY_STRUCTURE_VERSION, createdAt: updatedAt});
        if(current) return;                                      // keep the saved (Custom Data) tree
        store.put({
          key: CATEGORY_STRUCTURE_KEY,
          version: CATEGORY_STRUCTURE_VERSION,
          source: 'default',
          updatedAt,
          categories: structure.categories,
          incomeGroups: structure.incomeGroups
        });
        seeded = true;
      };
      existing.onerror = () => reject(existing.error);
    };
    guard.onerror = () => reject(guard.error);
    transaction.oncomplete = () => resolve(seeded);
    transaction.onerror = () => reject(transaction.error || new Error('Could not initialize the category store.'));
    transaction.onabort = () => reject(transaction.error || new Error('The database rejected the category initialization.'));
  });
}

/**
 * One-time companion of the revision upgrade: records saved under the old "Cash" / "Cash & Bank"
 * labels are renamed to "Cash & Bank Account" (and "Cash in Hand" -> "Cash In Hand"), so their
 * amounts stay inside the definitive category. Ids, amounts and documents are never touched.
 */
async function migrateLegacyCashRecords(){
  const records = await getAll('records').catch(() => []);
  const updates = [];
  for(const record of records){
    if(!record || record.type !== 'Asset' || !isCashCategoryName(record.category)) continue;
    const category = 'Cash & Bank Account';
    const subcategory = /^cash in hand$/i.test(String(record.subcategory || '').trim()) ? 'Cash In Hand' : record.subcategory;
    if(String(record.category || '').trim() === category && String(record.subcategory || '').trim() === String(subcategory || '').trim()) continue;
    updates.push(Object.assign({}, record, {category, subcategory}));
  }
  if(updates.length) await putMany('records', updates);
  return updates.length;
}

/** Runs once at start-up: seeds the protected record only when the store has never been initialized. */
async function ensureCategoryStructure(){
  const seeded = await initializePersistentCategories();
  if(seeded){
    // Mirror the definitive tree into the legacy stores, so the loadState() merge cannot put
    // rows from an older build back into the protected record.
    const structure = defaultCategoryStructure();
    await replaceStore('categories', structure.categories).catch(error => console.warn('Legacy category store could not be synced', error));
    await replaceStore('incomeGroups', structure.incomeGroups).catch(error => console.warn('Legacy income group store could not be synced', error));
    const renamed = await migrateLegacyCashRecords();
    if(renamed) console.info(`Renamed ${renamed} Cash record(s) to "Cash & Bank Account"`);
  }
  const stored = await readCategoryStructure();
  if(stored){
    if(Number(stored.version || 1) < CATEGORY_STRUCTURE_VERSION){
      // Safety net for a record written by a build that predates the definitive tree.
      const renamed = await migrateLegacyCashRecords();
      if(renamed) console.info(`Renamed ${renamed} Cash record(s) to "Cash & Bank Account"`);
      return seedCategoryStructure('default');
    }
    state.categoryStructureMeta = {source: stored.source === 'default' ? 'default' : 'user', updatedAt: stored.updatedAt || ''};
    updateCategoryStructureBadge();
    return stored;
  }
  // The guard exists but the tree is missing (older build or a manual clear): write it once.
  const renamed = await migrateLegacyCashRecords();
  if(renamed) console.info(`Renamed ${renamed} Cash record(s) to "Cash & Bank Account"`);
  return seedCategoryStructure('default');
}

/** Merge-only restore/import hook: the protected record absorbs new rows and keeps the old ones. */
async function mergeCategoryStructure(structure){
  const stored = await readCategoryStructure();
  if(!stored) return ensureCategoryStructure();
  const merged = {categories: cloneStructure(stored.categories || []), incomeGroups: cloneStructure(stored.incomeGroups || [])};
  const changed = mergeStructureInto(merged, structure || {});
  if(!changed) return stored;
  return writeCategoryStructure(merged.categories, merged.incomeGroups, 'user');
}

/** Visual cue in Settings > Manage Categories: System Data vs Custom Data. */
function updateCategoryStructureBadge(){
  const badge = document.getElementById('categoryStructureBadge');
  const hint = document.getElementById('categoryStructureHint');
  if(!badge) return;
  const custom = (state.categoryStructureMeta || {}).source !== 'default';
  badge.textContent = custom ? 'Custom Data' : 'System Data';
  badge.classList.toggle('category-data-badge-custom', custom);
  badge.title = 'Stored in the protected settings store — never cleared by an import, reload or backup restore.';
  if(hint){
    hint.textContent = custom
      ? 'Saved as Custom Data in the protected settings store — preserved across reloads, imports and backup restores.'
      : 'System Data — your first edit is saved to the protected settings store and preserved across reloads, imports and backup restores.';
  }
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

/* ==========================================================================
   Category / subcategory icons
   Every category and subcategory renders a related inline-SVG glyph (symbols
   live in index.html). Default names resolve through an exact map, names the
   user adds fall back to keyword rules, and anything unmatched gets a default
   for its financial type. Reports, Excel/PDF exports and print suppress the
   glyphs, so generated documents stay text-only.
   ========================================================================== */
const CATEGORY_ICON_EXACT={
  // Assets / liabilities
  'cash':'ci-wallet','cash in hand':'ci-wallet','savings accounts':'ci-bank',
  'investments':'ci-chart','cpf':'ci-shield','group insurance and welfare fund gi and wf':'ci-shield',
  'other investment co operation':'ci-chart','property':'ci-land','land and primary residence':'ci-land',
  'vehicles':'ci-car','jewelry':'ci-gem','other property':'ci-home','retirement':'ci-shield','gratuity':'ci-coins',
  'other assets':'ci-box','furniture electronics and equipments':'ci-box','accounts receivable':'ci-file',
  'accounts payable':'ci-file','bank loan':'ci-bank','other liabilities':'ci-file',
  // Income
  'salary and bonuses':'ci-coins','basic and allowances':'ci-coins','incentive bonus':'ci-coins','profit bonus':'ci-coins',
  'lfa':'ci-plane','festival bonus':'ci-gift','ex gratia':'ci-gift','allowances and other receives':'ci-coins',
  'lunch subsidy':'ci-food','leverage':'ci-chart','ta da':'ci-transit','training allowance':'ci-education',
  'honorarium':'ci-coins','previous year profit bonus':'ci-coins','general income':'ci-coins',
  'bank interest profit':'ci-bank','gift refund':'ci-gift','other income':'ci-coins',
  // Expenses
  'food':'ci-food','grocery items':'ci-cart','snacks items':'ci-food','dining eating out':'ci-food','mess':'ci-food',
  'clothing':'ci-shirt','laundry':'ci-shirt','personal supplies':'ci-box','medicine and doctor':'ci-medical',
  'pocket money':'ci-gift','contribution for family':'ci-users','special contribution for family':'ci-users',
  'regular':'ci-users','small amount':'ci-users','big amount':'ci-users',
  'accommodation':'ci-home','household rent':'ci-home','fuel and maintenance':'ci-fuel','other transportation':'ci-transit',
  'auto':'ci-car','bus':'ci-transit','train':'ci-transit','others':'ci-tag',
  'utilities and home support':'ci-bolt','electricity':'ci-bolt','gas water sewer and garbage':'ci-flame',
  'phone internet tv channels and subscription':'ci-wifi','home support staff and other expenses':'ci-users',
  'education':'ci-education','education expenses':'ci-education','special and events':'ci-party',
  'festival party events':'ci-party','domestic and overseas tour holiday etc':'ci-plane','philanthropy etc':'ci-heart',
  'other special expenses':'ci-sparkle','miscellaneous':'ci-tag','any other expenses':'ci-tag',
  'tax and surcharge':'ci-percent','payment of tax at source and advance tax':'ci-percent',
  'payment of tax surcharge or other amounts':'ci-percent',
  'office purchase and bill':'ci-briefcase','office purchase':'ci-box','bill received':'ci-receipt','personal print':'ci-printer',
  // Shared subcategories (Own / Spouse / Family / Offspring repeat under many categories)
  'own':'ci-user','spouse':'ci-users','family':'ci-users','offspring':'ci-users'
};
const CATEGORY_ICON_RULES=[
  {icon:'ci-food',test:/\b(food|grocery|groceries|dining|dinner|lunch|breakfast|snack|snacks|restaurant|cafe|mess|meal|meals|kitchen)\b/},
  {icon:'ci-shirt',test:/\b(cloth|clothes|clothing|apparel|garment|uniform|laundry|tailor|shoe|shoes)\b/},
  {icon:'ci-medical',test:/\b(medicine|medical|doctor|hospital|health|clinic|dental|nurse|pharmacy|treatment)\b/},
  {icon:'ci-gift',test:/\b(gift|pocket money|ex gratia|refund|reward)\b/},
  {icon:'ci-party',test:/\b(party|event|events|celebration)\b/},
  {icon:'ci-plane',test:/\b(tour|travel|trip|holiday|vacation|flight|air ticket)\b|\blfa\b/},
  {icon:'ci-heart',test:/\b(philanthropy|charity|donation|donations|zakat|sadaqah)\b/},
  {icon:'ci-users',test:/\b(family|spouse|offspring|children|child|kids|dependent|dependents|staff|maid|caregiver)\b/},
  {icon:'ci-user',test:/\b(self|own|myself|personal)\b/},
  {icon:'ci-printer',test:/\b(print|printing|photocopy|printer)\b/},
  {icon:'ci-cart',test:/\b(shopping|supplies|supply|supermarket|bazar|bazaar)\b/},
  {icon:'ci-briefcase',test:/\b(office|official)\b/},
  {icon:'ci-receipt',test:/\b(bill|bills|invoice|voucher|receipt)\b/},
  {icon:'ci-percent',test:/\b(tax|surcharge|vat|duty)\b/},
  {icon:'ci-fuel',test:/\b(fuel|petrol|diesel|octane|refuel)\b/},
  {icon:'ci-flame',test:/\b(gas|lpg|cylinder|flame)\b/},
  {icon:'ci-droplet',test:/\b(water|sewer|sewage|drain|drainage)\b/},
  {icon:'ci-trash',test:/\b(garbage|trash|waste|dust)\b/},
  {icon:'ci-bolt',test:/\b(electricity|electric|power|utility|utilities)\b/},
  {icon:'ci-wifi',test:/\b(internet|broadband|wifi|wi fi|subscription|phone|mobile|tv|television|cable)\b/},
  {icon:'ci-education',test:/\b(education|school|college|university|tuition|admission|exam|training|book|books)\b/},
  {icon:'ci-shield',test:/\b(insurance|welfare|provident|cpf|retirement|pension|protection)\b/},
  {icon:'ci-bank',test:/\b(savings|saving|bank|interest|profit)\b/},
  {icon:'ci-card',test:/\b(card|credit|debit|visa|mastercard)\b/},
  {icon:'ci-wallet',test:/\b(cash|bkash|nagad|rocket|wallet)\b/},
  {icon:'ci-chart',test:/\b(investment|investments|invest|share|shares|stock|stocks|mutual fund|leverage)\b/},
  {icon:'ci-land',test:/\b(land|plot|real estate)\b/},
  {icon:'ci-home',test:/\b(property|house|housing|residence|rent|rental|accommodation)\b/},
  {icon:'ci-gem',test:/\b(jewel|jewelry|jewellery|gold|silver|diamond|gem)\b/},
  {icon:'ci-car',test:/\b(car|cars|vehicle|vehicles|auto|automobile|motorcycle|bike)\b/},
  {icon:'ci-transit',test:/\b(transport|transportation|ta da|fare|fares|bus|train|transit|taxi|rickshaw|uber)\b/},
  {icon:'ci-box',test:/\b(furniture|electronics|equipment|equipments|appliance|appliances|box|package)\b/},
  {icon:'ci-scale',test:/\b(loan|loans|liability|liabilities|debt|payable|receivable)\b/},
  {icon:'ci-file',test:/\b(accounts|account|deduction|deductions|loss|losses|penalty|fine|fines)\b/},
  {icon:'ci-coins',test:/\b(salary|bonus|allowance|allowances|honorarium|gratuity|income|receive|receives|earning|earnings)\b/},
  {icon:'ci-sparkle',test:/\b(special|festival)\b/},
  {icon:'ci-tag',test:/\b(misc|miscellaneous|other|others|general)\b/}
];
const CATEGORY_ICON_TONES={
  'ci-food':'amber','ci-cart':'amber','ci-fuel':'amber','ci-bolt':'amber','ci-flame':'amber',
  'ci-shirt':'violet','ci-user':'indigo','ci-users':'violet','ci-education':'indigo','ci-chart':'indigo',
  'ci-briefcase':'indigo','ci-sparkle':'violet','ci-card':'violet',
  'ci-medical':'rose','ci-heart':'rose','ci-scale':'rose','ci-percent':'rose',
  'ci-gift':'pink','ci-party':'pink','ci-gem':'pink',
  'ci-home':'teal','ci-land':'teal','ci-plane':'sky','ci-car':'sky','ci-transit':'sky','ci-droplet':'sky','ci-wifi':'sky',
  'ci-wallet':'emerald','ci-bank':'emerald','ci-coins':'emerald','ci-shield':'emerald',
  'ci-box':'slate','ci-receipt':'slate','ci-printer':'slate','ci-file':'slate','ci-tag':'slate','ci-trash':'slate'
};
const CATEGORY_ICON_DEFAULT={Income:'ci-coins',Expense:'ci-cart',Asset:'ci-wallet',Liability:'ci-scale',Office:'ci-briefcase'};
const categoryIconCache=new Map();
/** Normalises a name for lookup: "TA+DA" -> "ta da", "Medicine & Doctor" -> "medicine and doctor". */
const categoryIconKey=value=>String(value??'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
function resolveCategoryIcon(label,type){
  const key=categoryIconKey(label);
  const kind=type?String(type)[0].toUpperCase()+String(type).slice(1).toLowerCase():'';
  const cacheKey=`${kind}|${key}`;
  const cached=categoryIconCache.get(cacheKey);
  if(cached)return cached;
  let icon=CATEGORY_ICON_EXACT[key];
  if(!icon)icon=(CATEGORY_ICON_RULES.find(rule=>rule.test.test(key))||{}).icon;
  const result={icon:icon||CATEGORY_ICON_DEFAULT[kind]||'ci-tag'};
  categoryIconCache.set(cacheKey,result);
  return result;
}
/** True while printing or rendering a report: glyphs are skipped entirely, not just hidden. */
function categoryIconsSuppressed(){
  if(typeof document==='undefined'||!document.documentElement)return true;
  const root=document.documentElement;
  return root.classList.contains('is-printing')||!!(document.body&&document.body.classList.contains('report-mode'));
}
/** Inline SVG glyph for a category / subcategory label. `opts.size` overrides the CSS size (px). */
function catIcon(label,type,opts={}){
  if(categoryIconsSuppressed())return '';
  const {icon:name}=resolveCategoryIcon(label,type);
  const tone=CATEGORY_ICON_TONES[name]||'indigo';
  const size=Number(opts.size)>0?` style="--ci-size:${Math.round(Number(opts.size))}px"`:'';
  const extra=opts.className?` ${esc(opts.className)}`:'';
  return `<i class="cat-icon tone-${tone}${extra}" data-cat-icon="${name}"${size} aria-hidden="true"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#${name}"/></svg></i>`;
}
/** Glyph + escaped label, for tables, cards and read-only view sheets. */
function catLabel(label,type,opts={}){
  const text=String(label??'').trim();
  if(!text)return '—';
  return `<span class="cat-label">${catIcon(text,type,opts)}<span class="cat-label-text">${esc(text)}</span></span>`;
}
/** Puts a small glyph inside a form label (select fields) and keeps it in sync with the value. */
function setFieldIcon(selectId,value,type){
  const select=document.getElementById(selectId);
  const label=select&&select.closest('label');
  if(!label)return;
  let chip=label.querySelector('.field-icon-chip');
  if(!chip){
    const target=label.querySelector('.lbl');
    if(!target)return;
    chip=document.createElement('span');
    chip.className='field-icon-chip';
    chip.setAttribute('aria-hidden','true');
    target.prepend(chip);
  }
  chip.innerHTML=catIcon(value||'',type,{size:15});
}
/** Strips icon markup from any string that reaches a generated report or export. */
const REPORT_ICON_MARKUP=/<i[^>]*data-cat-icon[\s\S]*?<\/i>/gi;
function reportPlainText(value){
  return String(value??'').replace(REPORT_ICON_MARKUP,'').replace(/\s+/g,' ').trim();
}
/** Print the current view with category glyphs suppressed (browser print / Save as PDF). */
function printCurrentView(){
  const root=document.documentElement;
  root.classList.add('is-printing');
  const done=()=>root.classList.remove('is-printing');
  window.addEventListener('afterprint',done,{once:true});
  try{window.print()}finally{setTimeout(done,1500)}
}



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
  makeSchema('Cash & Bank Account','Cash In Hand','Cash-CIH',[
    field('particulars','Cash Asset Name','text',['cash asset name'],{required:true,placeholder:'e.g. Cash In Hand, Bkash'})
  ],{amountExcel:['balance'],amountHint:'Excel: Balance',detailsHint:'Optional note (not a separate column in this sheet)'}),

  makeSchema('Cash & Bank Account','Savings Accounts','Cash-Savings Accounts',[
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
  try{
    const settings=await getAll('settings');
    hasData=(await getAll('records')).length>0||(await getAll('documents')).length>0||(await getAll('incomeExpenses')).length>0||settings.some(item=>item.key==='zakat'||item.key==='zakatRecords'&&Array.isArray(item.value)&&item.value.length>0);
  }catch(e){}
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
    // Only this site's service worker and caches: the other site lives on the same origin.
    const ownScope=new URL('./',location.href).href;
    if('serviceWorker' in navigator){(await navigator.serviceWorker.getRegistrations()).filter(r=>r.scope===ownScope).forEach(r=>r.unregister())}
    if(window.caches){(await caches.keys()).filter(k=>k.startsWith(SITE.prefix+'-')).forEach(k=>caches.delete(k))}
  }catch(e){console.warn(e)}
}
/** Explicit, user-triggered data deletion (Settings page). Never runs automatically. */
async function deleteAllLocalData(){
  const ok=await confirm('Delete every record, category and PDF stored in this browser? This cannot be undone. Create a backup first.','Delete All Local Data');
  if(!ok)return;
  try{
    db=null;
    await deleteDatabase();
    try{localStorage.removeItem(DATA_VERSION_KEY);localStorage.removeItem(SITE.prefix+'-data-token')}catch(e){}
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
  if(state.records.length||state.incomeExpenses.length||hasZakatData())return 0;
  try{if(localStorage.getItem(PROJECT_DATASET_FLAG))return 0}catch(e){}
  let imported=0;
  for(const path of PROJECT_DATASET){
    try{
      const response=await fetch(encodeURI(path),{cache:'no-cache'});
      if(!response.ok)continue;
      const blob=await response.blob();
      const name=decodeURIComponent(path.split('/').pop());
      const file=new File([blob],name,{type:blob.type||(/\.csv$/i.test(name)?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')});
      const before=state.records.length+state.incomeExpenses.length+state.officePurchases.length;
      await runImport(file,null);
      imported+=Math.max(0,state.records.length+state.incomeExpenses.length+state.officePurchases.length-before);
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
    if(!sessionStorage.getItem(SITE.prefix+'-healed')){
      sessionStorage.setItem(SITE.prefix+'-healed','1');
      await clearAppCaches();location.reload();return;
    }
  }
  renderTableSkeleton();
  setupPWA();
  db=await openDB();
  await checkDataVersion();
  // Seed / read the protected Major Head -> Category -> Subcategory record before any render.
  await ensureCategoryStructure();
  await loadState();
  const settings=await getAll('settings');
  state.settings=settings.reduce((out,item)=>(out[item.key]=item.value,out),{});
  state.settings.currency ||= 'BDT';
  state.settings.locale ||= 'en-BD';
  state.settings.incomeYears ||= ['2026-27','2025-26','2024-25','2023-24','2022-23'];
  loadZakatState();
  // Google Drive: silent sign-in; restores the newest backup only when the local database is empty.
  await initGoogleDriveSync();
  // Fill an empty database from Project/ before the first render so the Dashboard is complete.
  await loadProjectDataset();
  await reconcileOfficeCarryForwards();
  bindNavigation();
  bindGlobalActions();
  bindZakatEvents();
  if(typeof bindWealthEvents==='function')bindWealthEvents();
  bindIncomeTaxEvents();
  bindDelegatedActions();
  bindDashboardChartToggles();
  renderAll();
  appReady=true;
  updateMobileMode();
  playEnter(document.getElementById('dashboardPage'));
  placePills(true);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>placePills(true));
  if(new URLSearchParams(location.search).get('action')==='add')openRecordModal();
  requestPersistentStorage();
}

/** Serial order saved by the Manage Categories drag & drop ("order" lives on the record).
 *  getAll() returns rows in key order, so the explicit index is what keeps the user's order. */
function sortBySavedOrder(items){
  return items.slice().sort((a,b)=>{
    const ao=a&&Number.isFinite(a.order)?a.order:Infinity;
    const bo=b&&Number.isFinite(b.order)?b.order:Infinity;
    if(ao===bo)return 0;
    return ao<bo?-1:1;
  });
}
async function loadState(){
  const allRecords=await getAll('records');
  state.records=allRecords.filter(r=>!r.assetDeduction);
  state.deductedRecords=allRecords.filter(r=>r.assetDeduction);
  state.documents=await getAll('documents');
  state.backupHistory=await getAll('backupHistory');
  state.incomeExpenses=await getAll('incomeExpenses');
  state.migrationHistory=await getAll('migrationHistory');
  state.officePurchases=await getAll('officePurchases');
  // settingsStore owns the Major Head / Category / Subcategory tree. Legacy stores and
  // imports are merged IN only, so a reload, import or restore can never shrink it.
  const storedStructure=await readCategoryStructure();
  if(storedStructure){
    const merged={categories:sortBySavedOrder(storedStructure.categories),incomeGroups:sortBySavedOrder(storedStructure.incomeGroups)};
    const changed=mergeStructureInto(merged,{
      categories:await getAll('categories'),
      incomeGroups:sortBySavedOrder(await getAll('incomeGroups'))
    });
    state.categories=merged.categories;
    state.incomeGroups=merged.incomeGroups;
    state.categoryStructureMeta={source:storedStructure.source==='default'?'default':'user',updatedAt:storedStructure.updatedAt||''};
    if(changed){
      state.categories.forEach((entry,index)=>{entry.order=index});
      state.incomeGroups.forEach((entry,index)=>{entry.order=index});
      await writeCategoryStructure(state.categories,state.incomeGroups,state.categoryStructureMeta.source);
    }
    updateCategoryStructureBadge();
  }else{
    state.categories=sortBySavedOrder(await getAll('categories'));
    state.incomeGroups=sortBySavedOrder(await getAll('incomeGroups'));
    if(!state.incomeGroups.length){for(const group of defaultIncomeGroups) state.incomeGroups.push(group)}
  }
  scheduleDriveAutoBackup();
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
    try{localStorage.setItem(SITE.prefix+'-theme',next)}catch(e){}
    const meta=document.getElementById('metaThemeColor');
    if(meta)meta.setAttribute('content',next==='dark'?'#0b1020':'#4f46e5');
    if(db&&currentPage==='dashboard')refreshDashboardCharts();
  };
}

/* ==========================================================================
   Navigation (sidebar + mobile bottom bar) with animated active pill
   ========================================================================== */
const PAGE_TITLES={dashboard:['Dashboard','Financial overview'],records:['Assets & Liabilities','Manage financial records'],incomeExpenses:['Income & Expenses','Track cash flow, income and spending'],balance:['Balance Sheet','Consolidated financial position'],zakat:['Wealth Purification','Zakat, Dubious Income and Haram Income'],officialAccount:['Official Account','Office purchases, bills and advance adjustments'],incomeTax:['Income Tax Calculation','FY-wise income, rebate, assets and tax deducted'],backup:['Data Backup & Restore','Portable data management'],settings:['Settings','Application preferences']};

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
  // The Financial Year list may live in the body-level overlay: never let it survive a page change.
  if(page!=='officialAccount')closeOfficeYearMenu();
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
  if(page==='zakat')renderZakat();
  if(page==='incomeTax')renderIncomeTax();
  if(page==='officialAccount')renderOfficialAccount();
  if(page==='backup')renderBackupHistory();
  if(page==='settings')renderSettings();
  if(page==='dashboard'&&isMobileViewport())renderMobileDashboard();
  playEnter(panel);
  placePills();
  window.scrollTo({top:0,behavior:reducedMotion()?'auto':'smooth'});
}
/* ==========================================================================
   Official Account  >  Advanced Adjustment (FY-wise official advance adjustment)
   Screen is English; the Excel / PDF report is Bengali, laid out like "2025-26.xlsx".
   Rows live in the `settings` store (key `advancedAdjustments`), so ZIP backup / restore
   and the Drive snapshot carry them with no schema change.
   ========================================================================== */
const ADV_KEY='advancedAdjustments';
const ADV_OFFICER='জনাব সৈকত রায়হান, সহকারী ব্যবস্থাপক';          // title line of the Bengali report
const ADV_HEAD=['ক্রমিক নং','অগ্রিম গ্রহণের তারিখ','অগ্রিম গ্রহণের বিবরণ','গৃহিত অগ্রিম অর্থ','ব্যয়কৃত অর্থ','কমব্যয়কৃত অর্থ','খসড়া ফাইল','ফাইল'];
const ADV_TOTAL_LABEL='মোট';
const ADV_NUM_FMT={sl:'[$-5000445]00',date:'[$-5000845]dd/mm/yyyy;@'};
let officialSub='office',advYear='',editingAdvId=null;
const ADV_SLOTS=[{key:'advance',field:'advanceDocId',slot:'advSlotAdvance',label:'Submit Advance File'},{key:'cost',field:'costDocId',slot:'advSlotCost',label:'Real Cost'}];
const advDraft={};   // per slot: {existing:docMeta|null, removed:bool, added:File|null}
const advDocMeta=id=>id?state.documents.find(d=>d.id===id)||null:null;

const bnNum=v=>String(v).replace(/\d/g,d=>'০১২৩৪৫৬৭৮৯'[d]);
const bnDate=iso=>{const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?bnNum(`${m[3]}/${m[2]}/${m[1]}`):''};
const bnMoney=n=>bnNum((Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2}))+'/-';
const advRows=()=>Array.isArray(state.settings[ADV_KEY])?state.settings[ADV_KEY]:[];
function advSorted(fy){
  return advRows().filter(r=>normIncomeYear(r.fy)===fy).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
}
function advYears(){
  const set=new Set(advRows().map(r=>normIncomeYear(r.fy)).filter(Boolean));
  (state.settings.incomeYears||[]).forEach(y=>{const n=normIncomeYear(y);if(n&&!parseIncomeYear(n).plain)set.add(n)});
  set.add(fiscalYearFromDate(todayISO()));
  return [...set].filter(Boolean).sort().reverse();
}
const advTotals=list=>list.reduce((t,r)=>{t.advance+=Number(r.advance)||0;t.spent+=Number(r.spent)||0;return t},{advance:0,spent:0});
async function advSave(rows){state.settings[ADV_KEY]=rows;await put('settings',{key:ADV_KEY,value:rows})}

/* --- sub-page switching (sidebar sub-items and the tab strip share data-official-sub) --- */
function setOfficialSub(sub,focus){
  officialSub=sub==='advanced'?'advanced':'office';
  try{localStorage.setItem(SITE.prefix+'-official-sub',officialSub)}catch(e){}
  if(currentPage!=='officialAccount'){showPage('officialAccount');return}
  applyOfficialSub(focus);
}
function applyOfficialSub(focus){
  const page=document.getElementById('officialAccountPage');
  if(!page)return;
  page.querySelectorAll('[data-official-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.officialPanel!==officialSub));
  page.querySelectorAll('#officialTabs [data-official-sub]').forEach(b=>{
    const on=b.dataset.officialSub===officialSub;
    b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;
    if(on&&focus)b.focus();
  });
  document.getElementById('pageSubtitle').textContent=officialSub==='advanced'?'FY-wise advance taken, spent and adjusted':'FY-wise office outflow, inflow and cash & bank effects';
  if(officialSub==='advanced'){closeOfficeYearMenu();renderAdvanced()}else renderOfficePage();
}
function renderOfficialAccount(){applyOfficialSub(false)}
function bindOfficialNav(){
  try{const saved=localStorage.getItem(SITE.prefix+'-official-sub');if(saved==='advanced'||saved==='office')officialSub=saved}catch(e){}
  document.querySelectorAll('[data-official-sub]').forEach(b=>{b.onclick=()=>setOfficialSub(b.dataset.officialSub)});
  const tabs=document.getElementById('officialTabs');
  if(tabs)tabs.onkeydown=e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();setOfficialSub(officialSub==='office'?'advanced':'office',true);
  };
  const T=id=>document.getElementById(id);
  T('advYearSelect').onchange=e=>{advYear=e.target.value;renderAdvanced()};
  T('advAddBtn').onclick=()=>openAdvModal();
  T('advExportExcel').onclick=exportAdvExcel;
  T('advExportPdf').onclick=printAdvReport;
  T('advImportBtn').onclick=()=>T('advImportFile').click();
  T('advImportFile').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)importAdvWorkbook(f)};
  T('advTable').onclick=e=>{
    const b=e.target.closest('[data-adv-act]');if(!b)return;
    if(b.dataset.advAct==='edit')openAdvModal(b.dataset.id);
    else if(b.dataset.advAct==='view')openPdfViewer(b.dataset.doc);
    else deleteAdv(b.dataset.id);
  };
  T('advFormSave').onclick=saveAdvForm;
  bindAdvSlots();
  ['advFormAdvance','advFormSpent'].forEach(id=>{T(id).oninput=updateAdvUnder});
  T('advForm').onsubmit=e=>{e.preventDefault();saveAdvForm()};
}


function advFileCell(id){
  const m=advDocMeta(id);
  return m?`<button type="button" class="action-link" data-adv-act="view" data-doc="${esc(m.id)}" title="${esc(m.name||'')}">View PDF</button>`:'—';
}
function renderAdvSlots(){
  ADV_SLOTS.forEach(sl=>{
    const d=advDraft[sl.key]||{},host=document.querySelector(`#${sl.slot} .adv-file-body`);
    if(!host)return;
    const cur=d.added?{name:d.added.name,size:d.added.size,isNew:true}:(d.existing&&!d.removed?{name:d.existing.name||d.existing.title,size:d.existing.size}:null);
    host.innerHTML=cur
      ?`<span class="adv-fname">${esc(cur.name)}</span><span class="hint">${formatFileSize(cur.size)}${cur.isNew?' · new':''}</span><button type="button" class="action-link" data-adv-slot="${sl.key}" data-slot-act="view">View</button><button type="button" class="action-link" data-adv-slot="${sl.key}" data-slot-act="pick">Replace</button><button type="button" class="action-link danger" data-adv-slot="${sl.key}" data-slot-act="remove">Remove</button>`
      :`<button type="button" class="btn" data-adv-slot="${sl.key}" data-slot-act="pick">${icon('backup')}<span>Upload PDF</span></button>${d.removed?'<span class="hint">Will be removed on save</span>':''}`;
  });
}
function bindAdvSlots(){
  document.getElementById('advModal').addEventListener('click',async e=>{
    const b=e.target.closest('[data-slot-act]');if(!b)return;
    const sl=ADV_SLOTS.find(x=>x.key===b.dataset.advSlot),d=advDraft[sl.key];
    const act=b.dataset.slotAct;
    if(act==='pick')document.querySelector(`#${sl.slot} input[type=file]`).click();
    else if(act==='remove'){d.added=null;d.removed=true;renderAdvSlots()}
    else if(act==='view'){
      if(d.added)await openPdfViewer({blob:d.added,name:d.added.name,size:d.added.size});
      else if(d.existing){const blob=await getDocBlob(d.existing.id);if(blob)await openPdfViewer({blob,name:d.existing.name||'file.pdf',size:d.existing.size||blob.size});else toast('This file is not available on this device.',true)}
    }
  });
  document.querySelectorAll('[data-adv-input]').forEach(input=>{
    input.onchange=e=>{
      const file=e.target.files[0];e.target.value='';
      if(!file)return;
      if(!isPdfFile(file)){toast('Only PDF files can be attached.',true);return}
      const d=advDraft[input.dataset.advInput];d.added=file;d.removed=false;renderAdvSlots();
    };
  });
}

/* --- screen --- */
function renderAdvanced(){
  const years=advYears();
  if(!advYear||!years.includes(advYear))advYear=years.includes('2025-26')&&advRows().some(r=>normIncomeYear(r.fy)==='2025-26')?'2025-26':years[0];
  document.getElementById('advYearSelect').innerHTML=years.map(y=>`<option value="${esc(y)}" ${y===advYear?'selected':''}>${esc(y)}</option>`).join('');
  const range=fiscalRange(advYear);
  document.getElementById('advYearRange').textContent=range?`${fmtDate(range.from)} to ${fmtDate(range.to)}`:'';
  const list=advSorted(advYear),t=advTotals(list),under=t.advance-t.spent;
  const card=(i,ic,label,value,kpi,ink,meta)=>`<div class="summary-card" style="--i:${i};--kpi:${kpi};--kpi-ink:${ink}"><div class="summary-icon">${icon(ic)}</div><div><p>${label}</p><strong class="kpi-value">${formatMoney(value)}</strong><span class="office-card-meta">${meta}</span></div></div>`;
  document.getElementById('advSummaryCards').innerHTML=[
    card(0,'down','Advance Received',t.advance,'var(--primary-soft)','var(--primary-2)',`${list.length} advance(s) · ${esc(advYear)}`),
    card(1,'up','Amount Spent',t.spent,'var(--rose-soft)','#e11d48','Adjusted against the advances'),
    card(2,'scale','Under-spent (to return)',under,'var(--emerald-soft)','#059669',under===0?'Fully adjusted':'Advance received − amount spent')
  ].join('');
  document.getElementById('advRecordCount').textContent=`${list.length} advance${list.length===1?'':'s'} in ${advYear}`;
  const rows=list.map((r,i)=>{
    const out=range&&(r.date<range.from||r.date>range.to);
    return `<tr><td>${i+1}</td><td>${esc(fmtDate(r.date)||'—')}${out?'<span class="tag warn" title="This date falls outside the selected Financial Year">Outside FY</span>':''}</td><td class="adv-desc">${esc(r.description)}</td><td class="num">${formatMoney(r.advance)}</td><td class="num">${formatMoney(r.spent)}</td><td class="num"><strong>${formatMoney((Number(r.advance)||0)-(Number(r.spent)||0))}</strong></td><td>${advFileCell(r.advanceDocId)}</td><td>${advFileCell(r.costDocId)}</td><td class="actions-cell"><button type="button" class="action-link" data-adv-act="edit" data-id="${esc(r.id)}">Edit</button><button type="button" class="action-link danger" data-adv-act="delete" data-id="${esc(r.id)}">Delete</button></td></tr>`;
  });
  document.getElementById('advTable').innerHTML=`<thead><tr><th>Sl.</th><th>Advance Date</th><th>Description</th><th class="num">Advance Received</th><th class="num">Amount Spent</th><th class="num">Under-spent</th><th>Submit Advance File</th><th>Real Cost</th><th>Actions</th></tr></thead><tbody>${rows.join('')||`<tr><td colspan="9" class="empty">No advances recorded for ${esc(advYear)} yet. Use “Add Advance” or “Import Excel”.</td></tr>`}</tbody>${list.length?`<tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="num"><strong>${formatMoney(t.advance)}</strong></td><td class="num"><strong>${formatMoney(t.spent)}</strong></td><td class="num"><strong>${formatMoney(under)}</strong></td><td colspan="3"></td></tr></tfoot>`:''}`;
}

/* --- add / edit --- */
function updateAdvUnder(){
  const a=Number(document.getElementById('advFormAdvance').value)||0,s=Number(document.getElementById('advFormSpent').value)||0;
  document.getElementById('advFormUnder').textContent=`Under-spent: ${formatMoney(a-s)}${s>a?' (spent more than the advance)':''}`;
}
function openAdvModal(id=null){
  editingAdvId=id;
  const r=id?advRows().find(x=>x.id===id):null;
  const years=advYears();
  const fy=r?normIncomeYear(r.fy):advYear||years[0];
  if(!years.includes(fy))years.unshift(fy);
  const T=i=>document.getElementById(i);
  T('advModalTitle').textContent=r?'Edit Advance':'Add Advance';
  T('advFormYear').innerHTML=years.map(y=>`<option value="${esc(y)}" ${y===fy?'selected':''}>${esc(y)}</option>`).join('');
  T('advFormDate').value=r?r.date:'';
  T('advFormDesc').value=r?r.description:'';
  T('advFormAdvance').value=r?r.advance:'';
  T('advFormSpent').value=r?r.spent:'';
  ADV_SLOTS.forEach(sl=>{advDraft[sl.key]={existing:r?advDocMeta(r[sl.field]):null,removed:false,added:null}});
  renderAdvSlots();
  updateAdvUnder();
  T('advModal').showModal();
}
async function saveAdvForm(){
  const T=i=>document.getElementById(i);
  const fy=normIncomeYear(T('advFormYear').value),date=T('advFormDate').value,description=T('advFormDesc').value.trim();
  const advance=Number(T('advFormAdvance').value),spent=Number(T('advFormSpent').value);
  if(!fy||!date||!description){toast('Financial Year, date and description are required.',true);return}
  if(!(advance>=0)||!(spent>=0)||T('advFormAdvance').value===''||T('advFormSpent').value===''){toast('Enter the advance and spent amounts (0 or more).',true);return}
  const rows=advRows().map(r=>Object.assign({},r));
  const rec={fy,date,description,advance,spent};
  let target;
  if(editingAdvId){const i=rows.findIndex(r=>r.id===editingAdvId);if(i<0)return;target=rows[i]=Object.assign(rows[i],rec)}
  else{target=Object.assign({id:uid('adv'),createdAt:new Date().toISOString()},rec);rows.push(target)}
  try{
    for(const sl of ADV_SLOTS){
      const d=advDraft[sl.key]||{};
      if((d.removed||d.added)&&d.existing){await remove('documents',d.existing.id);await remove('documentBlobs',d.existing.id);delete target[sl.field]}
      if(d.added){
        const docId=uid('doc');
        await put('documentBlobs',{id:docId,blob:d.added});
        await put('documents',{id:docId,recordId:target.id,title:d.added.name,name:d.added.name,type:d.added.type||'application/pdf',size:d.added.size,category:'Advanced Adjustment',subcategory:sl.label,financialType:'Advance',incomeYear:fy,createdAt:new Date().toISOString()});
        target[sl.field]=docId;
      }
    }
    state.documents=await getAll('documents');
    await advSave(rows);advYear=fy;T('advModal').close();renderAdvanced();toast(editingAdvId?'Advance updated':'Advance added');
  }catch(error){console.error(error);toast('Could not save the advance.',true)}
}
async function deleteAdv(id){
  const r=advRows().find(x=>x.id===id);if(!r)return;
  if(!(await confirm(`Delete this advance (${formatMoney(r.advance)}) from ${normIncomeYear(r.fy)}?`,'Delete Advance')))return;
  try{
    for(const sl of ADV_SLOTS)if(r[sl.field]){await remove('documents',r[sl.field]);await remove('documentBlobs',r[sl.field])}
    await advSave(advRows().filter(x=>x.id!==id));state.documents=await getAll('documents');renderAdvanced();toast('Advance deleted');
  }
  catch(error){console.error(error);toast('Could not delete the advance.',true)}
}

/* --- Excel import (sheets named like 2025-26, columns exactly as in the Bengali sheet) --- */
function advCellText(ws,r,c){
  const cell=ws[XLSX.utils.encode_cell({r,c})];
  if(!cell||cell.t==='e'||cell.v==null)return '';          // '#VALUE!' link cells import as empty
  return String(cell.v).trim();
}
function advCellDate(ws,r,c){
  const cell=ws[XLSX.utils.encode_cell({r,c})];
  if(!cell||cell.t==='e'||cell.v==null||cell.v==='')return '';
  if(cell.v instanceof Date)return `${cell.v.getFullYear()}-${pad2(cell.v.getMonth()+1)}-${pad2(cell.v.getDate())}`;
  if(typeof cell.v==='number'){const d=XLSX.SSF.parse_date_code(cell.v);return d?`${d.y}-${pad2(d.m)}-${pad2(d.d)}`:''}
  const s=String(cell.v).trim().replace(/[০-৯]/g,d=>'০১২৩৪৫৬৭৮৯'.indexOf(d));
  let m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);if(m)return `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';
}
function advCellNumber(ws,r,c){
  const cell=ws[XLSX.utils.encode_cell({r,c})];
  if(!cell||cell.t==='e')return 0;
  const n=typeof cell.v==='number'?cell.v:parseFloat(String(cell.v??'').replace(/,/g,'').replace(/[০-৯]/g,d=>'০১২৩৪৫৬৭৮৯'.indexOf(d)));
  return Number.isFinite(n)?n:0;
}
async function importAdvWorkbook(file){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  if(file.size>30*1024*1024){toast('This file is too large to import (30 MB limit).',true);return}
  try{
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    const rows=advRows().map(r=>Object.assign({},r));
    const key=r=>[normIncomeYear(r.fy),r.date,r.description,Number(r.advance)||0].join('|');
    const seen=new Set(rows.map(key));
    let added=0,skipped=0,sheets=0;
    for(const name of wb.SheetNames){
      const p=parseIncomeYear(name);
      if(!p||p.plain)continue;
      const fy=normIncomeYear(name),ws=wb.Sheets[name];
      if(!ws||!ws['!ref'])continue;
      const range=XLSX.utils.decode_range(ws['!ref']);
      let head=-1;
      for(let r=range.s.r;r<=Math.min(range.e.r,range.s.r+12);r++){if(/ক্রমিক|অগ্রিম/.test(advCellText(ws,r,0)+advCellText(ws,r,1))){head=r;break}}
      if(head<0)continue;
      sheets++;
      for(let r=head+1;r<=Math.min(range.e.r,head+2000);r++){
        const description=advCellText(ws,r,2),date=advCellDate(ws,r,1);
        if(!description&&!date)continue;
        if(!date||!description)continue;
        const rec={id:uid('adv'),createdAt:new Date().toISOString(),fy,date,description,advance:advCellNumber(ws,r,3),spent:advCellNumber(ws,r,4)};
        const k=key(rec);
        if(seen.has(k)){skipped++;continue}
        seen.add(k);rows.push(rec);added++;
      }
    }
    if(!sheets){toast('No Financial Year sheet (like 2025-26) with the Bengali advance table was found.',true);return}
    if(added){await advSave(rows);const first=rows[rows.length-1];advYear=normIncomeYear(first.fy)}
    renderAdvanced();
    toast(`Imported ${added} advance${added===1?'':'s'} from ${sheets} sheet${sheets===1?'':'s'}${skipped?` (skipped ${skipped} duplicate${skipped===1?'':'s'})`:''}`);
  }catch(error){console.error(error);toast('Could not read this workbook.',true)}
}

/* --- Bengali Excel report: same cells, merged title and number formats as 2025-26.xlsx --- */
function advTitle(fy){return `${ADV_OFFICER}-এর ${fy} অর্থ বছরে দাপ্তরিক কাজে অগ্রিম অর্থ সমন্বয়`}
function exportAdvExcel(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const list=advSorted(advYear);
  if(!list.length){toast(`There are no advances in ${advYear} to export.`,true);return}
  const whole=list.every(r=>Number.isInteger(Number(r.advance))&&Number.isInteger(Number(r.spent)));
  const moneyFmt=whole?'#,##0"/-"':'#,##0.00"/-"';
  const ws={},set=(a,cell)=>{ws[a]=cell};
  set('A1',{t:'s',v:advTitle(advYear)});
  ADV_HEAD.forEach((h,i)=>set(XLSX.utils.encode_cell({r:2,c:i}),{t:'s',v:h}));
  list.forEach((r,i)=>{
    const row=3+i,n=row+1,adv=Number(r.advance)||0,sp=Number(r.spent)||0;
    set('A'+n,{t:'n',v:i+1,z:ADV_NUM_FMT.sl});
    const m=String(r.date).match(/^(\d{4})-(\d{2})-(\d{2})/);
    set('B'+n,{t:'n',v:m?Math.round((Date.UTC(+m[1],+m[2]-1,+m[3])-Date.UTC(1899,11,30))/86400000):0,z:ADV_NUM_FMT.date});
    set('C'+n,{t:'s',v:r.description});
    set('D'+n,{t:'n',v:adv,z:moneyFmt});
    set('E'+n,{t:'n',v:sp,z:moneyFmt});
    set('F'+n,{t:'n',f:`D${n}-E${n}`,v:adv-sp,z:moneyFmt});
    set('G'+n,{t:'s',v:(advDocMeta(r.advanceDocId)||{}).name||''});
    set('H'+n,{t:'s',v:(advDocMeta(r.costDocId)||{}).name||''});
  });
  const first=4,last=3+list.length,tot=last+1,t=advTotals(list);
  set('A'+tot,{t:'s',v:ADV_TOTAL_LABEL});
  [['D',t.advance],['E',t.spent],['F',t.advance-t.spent]].forEach(([c,v])=>set(`${c}${tot}`,{t:'n',f:`SUM(${c}${first}:${c}${last})`,v,z:moneyFmt}));
  ws['!ref']=`A1:H${tot}`;
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:6}},{s:{r:tot-1,c:0},e:{r:tot-1,c:2}}];
  ws['!cols']=[{wch:10},{wch:16},{wch:60},{wch:16},{wch:14},{wch:16},{wch:14},{wch:14}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,advYear);
  XLSX.writeFile(wb,`Advanced-Adjustment-${advYear}-${todayISO()}.xlsx`);
  toast('Bengali report exported to Excel');
}

/* --- Bengali PDF report: jsPDF cannot shape Bengali conjuncts, so the browser prints an HTML report instead --- */
function printAdvReport(){
  const list=advSorted(advYear);
  if(!list.length){toast(`There are no advances in ${advYear} to print.`,true);return}
  const t=advTotals(list),under=t.advance-t.spent,cols=ADV_HEAD.slice(0,6);
  const body=list.map((r,i)=>`<tr><td class="c">${bnNum(String(i+1).padStart(2,'0'))}</td><td class="c">${bnDate(r.date)}</td><td>${esc(r.description)}</td><td class="n">${bnMoney(r.advance)}</td><td class="n">${bnMoney(r.spent)}</td><td class="n">${bnMoney((Number(r.advance)||0)-(Number(r.spent)||0))}</td></tr>`).join('');
  const now=new Date(),stamp=bnNum(`${pad2(now.getDate())}/${pad2(now.getMonth()+1)}/${now.getFullYear()}, ${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
  // Same look as the app's other PDF reports: dark header band on every page, dark table head,
  // indigo total row and a "Personal Finance · SOIKOT RAIHAN" footer with page numbers.
  const html=`<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>${esc(advTitle(advYear))}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap">
<style>
@page{size:A4 landscape;margin:11mm 11mm 15mm;
  @bottom-left{content:"Personal Finance  ·  SOIKOT RAIHAN  ·  Advanced Adjustment";font:8pt sans-serif;color:#64748b}
  @bottom-right{content:"পৃষ্ঠা " counter(page,bengali) " / " counter(pages,bengali);font:8pt 'Noto Sans Bengali','Nirmala UI',sans-serif;color:#64748b}}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:'Noto Sans Bengali','Nirmala UI','Kalpurush','SolaimanLipi','Vrinda','Shonar Bangla',sans-serif;color:#0f172a;font-size:9.5pt;line-height:1.5}
table{width:100%;border-collapse:collapse}
thead{display:table-header-group}tfoot{display:table-row-group}
th,td{border:1px solid #cbd5e1;padding:5px 7px;vertical-align:top}
thead tr.band th{background:#0f172a;color:#fff;border:0;text-align:left;padding:11px 14px;font-weight:400}
.band .row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.band .t{font-size:12.5pt;font-weight:700;line-height:1.4}.band .s{font-size:8.5pt;color:#cbd5e1;margin-top:3px}
.band .r{font-size:10pt;font-weight:700;white-space:nowrap}
thead tr.cols th{background:#0f172a;color:#fff;font-weight:700;font-size:8.5pt;text-align:center;border-color:#334155}
tbody tr:nth-child(even) td{background:#f8fafc}
td.c{text-align:center;white-space:nowrap}td.n{text-align:right;white-space:nowrap}
tr{page-break-inside:avoid}
tfoot td{background:#eef2ff;color:#312e81;font-weight:700}
</style></head><body>
<table><thead>
<tr class="band"><th colspan="6"><div class="row"><div><div class="t">${esc(advTitle(advYear))}</div><div class="s">${esc(advYear)}  ·  প্রস্তুতের সময় ${stamp}</div></div><div class="r">কমব্যয়কৃত অর্থ ${bnMoney(under)}</div></div></th></tr>
<tr class="cols">${cols.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
<tbody>${body}</tbody>
<tfoot><tr><td colspan="3" class="n">${ADV_TOTAL_LABEL}  ·  ${esc(advYear)}</td><td class="n">${bnMoney(t.advance)}</td><td class="n">${bnMoney(t.spent)}</td><td class="n">${bnMoney(under)}</td></tr></tfoot></table>
</body></html>`;
  const frame=document.createElement('iframe');
  frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc=frame.contentDocument;
  doc.open();doc.write(html);doc.close();
  const go=()=>{try{frame.contentWindow.focus();frame.contentWindow.print()}finally{setTimeout(()=>frame.remove(),60000)}};
  const ready=doc.fonts&&doc.fonts.ready?Promise.race([doc.fonts.ready,new Promise(r=>setTimeout(r,2500))]):Promise.resolve();
  ready.then(()=>setTimeout(go,150));
  toast('In the print dialog choose “Save as PDF”.');
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
  bindSettingsTabs();
  bindOfficialNav();
}

/* ==========================================================================
   Settings sub-pages (General, Categories, Migration, Cloud Sync, Storage)
   ========================================================================== */
function showSettingsTab(tab,{focus=false}={}){
  const next=SETTINGS_TABS.includes(tab)?tab:'general';
  settingsTab=next;
  try{localStorage.setItem(SITE.prefix+'-settings-tab',next)}catch(e){}
  const page=document.getElementById('settingsPage');
  if(!page)return;
  page.dataset.settingsTab=next;
  page.querySelectorAll('[data-settings-tab]').forEach(button=>{
    const active=button.dataset.settingsTab===next;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',active?'true':'false');
    button.tabIndex=active?0:-1;
    if(active&&focus)button.focus();
  });
  page.querySelectorAll('[data-settings-panel]').forEach(panel=>{
    panel.classList.toggle('hidden',panel.dataset.settingsPanel!==next);
  });
  /* Keep the active pill visible when the bar scrolls horizontally on phones. */
  const bar=document.getElementById('settingsTabs');
  const active=bar&&bar.querySelector('.settings-tab.active');
  if(bar&&active&&active.offsetWidth){
    bar.scrollLeft=Math.max(0,active.offsetLeft-(bar.clientWidth-active.offsetWidth)/2);
  }
  applySettingsMobileLayout();
}
function bindSettingsTabs(){
  const tabs=document.getElementById('settingsTabs');
  if(!tabs)return;
  tabs.onclick=e=>{
    const tab=e.target.closest('[data-settings-tab]');
    if(!tab)return;
    showSettingsTab(tab.dataset.settingsTab,{focus:true});
  };
  /* Roving tabindex: Left/Right/Home/End move between the sub-pages. */
  tabs.onkeydown=e=>{
    const current=e.target.closest('[data-settings-tab]');
    if(!current)return;
    const index=SETTINGS_TABS.indexOf(current.dataset.settingsTab);
    if(index<0)return;
    let nextIndex=null;
    if(e.key==='ArrowRight')nextIndex=(index+1)%SETTINGS_TABS.length;
    else if(e.key==='ArrowLeft')nextIndex=(index-1+SETTINGS_TABS.length)%SETTINGS_TABS.length;
    else if(e.key==='Home')nextIndex=0;
    else if(e.key==='End')nextIndex=SETTINGS_TABS.length-1;
    if(nextIndex===null)return;
    e.preventDefault();
    showSettingsTab(SETTINGS_TABS[nextIndex],{focus:true});
  };
  let saved='';
  try{saved=localStorage.getItem(SITE.prefix+'-settings-tab')||''}catch(e){}
  showSettingsTab(SETTINGS_TABS.includes(saved)?saved:settingsTab);
}

function bindGlobalActions(){
  const debounce=(fn,wait=180)=>{let timer=null;return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait)}};
  $el('quickAdd').onclick=()=>openRecordModal();
  $el('addRecordBtn').onclick=()=>openRecordModal();
  $el('transferBtn').onclick=()=>openTransferModal();
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
  /* Report / export actions live on the Assets & Liabilities page and read its active filters. */
  $el('exportFiltered').onclick=exportFilteredExcel;
  $el('printDashboard').onclick=printCurrentView;
  $el('generatePdfReport').onclick=e=>runWithLoading(e.currentTarget,generatePdfReport);
  $el('generateExcelReport').onclick=e=>runWithLoading(e.currentTarget,generateExcelReport);
  $el('printBalance').onclick=printCurrentView;
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
  bindTransferForm();
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
    if(action==='transfer'){openTransferModal();return}
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
  /* Google Drive sync card (Settings) */
  $el('driveConnectBtn').onclick=e=>runWithLoading(e.currentTarget,connectGoogleDrive);
  $el('driveDisconnectBtn').onclick=e=>runWithLoading(e.currentTarget,disconnectGoogleDrive);
  $el('driveSyncBtn').onclick=e=>runWithLoading(e.currentTarget,()=>syncGoogleDrive({interactive:true}));
  $el('driveRestoreBtn').onclick=e=>runWithLoading(e.currentTarget,openDriveRestoreDialog);
  $el('driveRestoreConfirm').onclick=restoreSelectedGoogleDriveBackup;
  $el('saveSettings').onclick=saveSettings;
  $el('addYear').onclick=addIncomeYear;
  $el('manageCategories').onclick=()=>openCategoryModal();
  $el('categoryForm').onsubmit=addCategory;
  /* Excel & Budge CSV Migration card: popup-based import, template + export */
  $el('excelImportBtn').onclick=()=>openExcelImportModal();
  $el('excelImportChoose').onclick=()=>$el('excelImport').click();
  $el('excelImport').onchange=excelImportFileChosen;
  $el('excelImportClear').onclick=clearExcelImportFile;
  $el('excelImportConfirm').onclick=confirmExcelImport;
  $el('excelImportNoAccount').onchange=updateExcelImportAccountHint;
  $el('excelImportModal').addEventListener('close',resetExcelImportDraft);
  $el('migrationPdfChoose').onclick=()=>$el('migrationPdf').click();
  $el('migrationPdf').onchange=migrationPdfChosen;
  $el('migrationPdfClear').onclick=clearMigrationPdf;
  $el('excelTemplateBtn').onclick=e=>runWithLoading(e.currentTarget,downloadMigrationTemplate);
  $el('excelExportBtn').onclick=e=>runWithLoading(e.currentTarget,exportMigrationWorkbook);
  $el('migrationChooseFile').onclick=()=>$el('migrationReplaceFile').click();
  $el('migrationReplaceFile').onchange=replaceMigrationFile;
  $el('migrationEditModal').addEventListener('close',()=>{replaceMigrationId=null});
  const wipe=$el('deleteAllData');
  if(wipe)wipe.onclick=deleteAllLocalData;
  /* Office Purchase & Bill page + its Settings migration card */
  $el('addOfficeBtn').onclick=()=>openOfficeModal();
  $el('officeForm').onsubmit=saveOfficeEntry;
  $el('officeExportExcel').onclick=e=>runWithLoading(e.currentTarget,exportOfficeExcel);
  $el('officeExportPdf').onclick=e=>runWithLoading(e.currentTarget,exportOfficePdf);
  $el('officeImportBtn').onclick=()=>openOfficeImportModal();
  $el('officeImportChoose').onclick=()=>$el('officeImport').click();
  $el('officeImport').onchange=officeImportFileChosen;
  $el('officeImportClear').onclick=clearOfficeImportFile;
  $el('officeImportConfirm').onclick=confirmOfficeImport;
  $el('officeImportNoAccount').onchange=updateOfficeImportAccountHint;
  $el('officeImportModal').addEventListener('close',resetOfficeImportDraft);
  $el('officeTemplateBtn').onclick=e=>runWithLoading(e.currentTarget,downloadOfficeTemplate);
  $el('officeExportBtn').onclick=e=>runWithLoading(e.currentTarget,exportOfficeWorkbook);
  $el('itImportBtn').onclick=()=>openITImportModal();
  $el('itImportChoose').onclick=()=>$el('itImport').click();
  $el('itImport').onchange=itImportFileChosen;
  $el('itImportClear').onclick=()=>{itImportDraft={file:null};setITImportFileLabel(null)};
  $el('itImportConfirm').onclick=confirmITImport;
  $el('itImportOverride').onchange=updateITImportHints;
  $el('itImportReplace').onchange=updateITImportHints;
  $el('itImportModal').addEventListener('close',resetITImportDraft);
  $el('itMigrationChooseFile').onclick=()=>{const id=itEditingMigrationId;$el('itMigrationEditModal').close();itReplaceMigrationId=id;openITImportModal()};
  $el('itMigrationEditModal').addEventListener('close',()=>{itEditingMigrationId=null});
  $el('itTemplateBtn').onclick=e=>runWithLoading(e.currentTarget,downloadITTemplate);
  $el('itExportBtn').onclick=e=>runWithLoading(e.currentTarget,exportITWorkbook);
  bindPdfViewer();
  bindCalculator();
}

/**
 * One delegated listener for every generated action, instead of inline onclick attributes.
 * Inline handlers had to embed user text inside a JavaScript string, which let a crafted
 * category / income-year name break out of the string and run code. Data attributes keep the
 * value in plain HTML-attribute position, where esc() is sufficient.
 */
function bindDelegatedActions(){
  document.addEventListener('change',event=>{
    const sel=event.target.closest&&event.target.closest('select[data-deduct-id]');
    if(sel&&sel.value)deductAssetItem(sel.dataset.deductId,sel.value);
  });
  document.addEventListener('click',async event=>{
    const trigger=event.target.closest('[data-cmd]');
    if(!trigger)return;
    const command=trigger.dataset.cmd,id=trigger.dataset.id||'',name=trigger.dataset.name||'',cat=trigger.dataset.cat||'',store=trigger.dataset.store||'',mig=trigger.dataset.mig||'';
    switch(command){
      case 'view-record': viewRecord(id); break;
      case 'edit-record': openRecordModal(id); break;
      case 'delete-record': await deleteRecord(id); break;
      case 'recover-asset': await recoverDeductedAsset(id); break;
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
      case 'edit-it-migration': editITMigration(id); break;
      case 'delete-it-migration': await deleteITMigration(id); break;
      case 'remove-it-migration-row': await removeITMigrationRow(mig,cat,store,id); break;
      case 'edit-office': openOfficeModal(id); break;
      case 'view-office': viewOfficeEntry(id); break;
      case 'delete-office': await deleteOfficeEntry(id); break;
      case 'office-page': officePage=Number(id)||1; renderOfficeTable(); break;
      case 'delete-zakat-gold': zakatState.gold.splice(Number(id),1); await saveZakatState(); break;
      case 'delete-zakat-payment': zakatState.payments=(zakatState.payments||[]).filter(payment=>payment.id!==id); await saveZakatState(); break;
      case 'edit-zakat-record': loadSavedZakatRecord(id); break;
      case 'view-zakat-record': viewZakatRecord(id); break;
      case 'delete-zakat-record': await deleteSavedZakatRecord(id); break;
      case 'filter-zakat-year': filterZakatByYear(id); break;
      case 'view-zakat-pdf': {
        const record=zakatRecords.find(item=>item.id===id);
        if(!record){toast('Zakat record not found.',true);break}
        try{await viewZakatReferencePdf(zakatRecordReferencePdf(record),zakatRecordReferenceFileName(record))}
        catch(error){console.error(error);toast('The Reference PDF could not be opened.',true)}
        break;
      }
      case 'download-zakat-pdf': {
        const record=zakatRecords.find(item=>item.id===id);
        if(!record){toast('Zakat record not found.',true);break}
        try{await downloadZakatReferencePdf(zakatRecordReferencePdf(record),zakatRecordReferenceFileName(record))}
        catch(error){console.error(error);toast('The Reference PDF could not be downloaded.',true)}
        break;
      }
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
  renderOfficePage();
  renderSettings();
  renderBackupHistory();
  renderBalance();
  renderZakat();
  if(currentPage==='incomeTax')renderIncomeTax();
}

const ZAKAT_CATEGORIES=[
  ['Fakir','A person who has no nisab-level wealth and lacks the means to meet basic needs.'],
  ['Miskeen','A person with no food or essential means, or whose hardship prevents basic needs from being met.'],
  ['Amileen','Officials authorized to collect, safeguard and distribute Zakat; payment may come from Zakat funds as compensation.'],
  ['Muallafat al-Qulub','New Muslims or people whose hearts may be won toward Islam.'],
  ['Kritadas / Enslaved Persons','People unlawfully captive or enslaved, including captives who need rescue and release.'],
  ['Debtors','People burdened with debt who lack sufficient means to repay; the debt must not fund prohibited conduct.'],
  ['Fi Sabilillah','Eligible disadvantaged travelers, mujahideen needing necessary equipment, and needy students or sincere Islamic workers unable to earn.'],
  ['Ibn al-Sabil','A traveler in hardship who has insufficient means and cannot reach support.']
];

function loadZakatState(){
  try{
    if(state.settings&&state.settings.zakat&&typeof state.settings.zakat==='object'){
      zakatState=Object.assign(zakatState,state.settings.zakat);
    }
    zakatRecords=(Array.isArray(state.settings&&state.settings.zakatRecords)?state.settings.zakatRecords:[]).map(record=>{
      if(!record||typeof record!=='object')return record;
      const reference=zakatRecordReferencePdf(record);
      record.referencePdf=reference?{
        name:String(reference.name||'Zakat-Reference.pdf'),
        type:reference.type||'application/pdf',
        size:Number(reference.size)||0,
        data:zakatReferenceBase64(reference)
      }:null;
      if(record.calculation&&typeof record.calculation==='object')delete record.calculation.referencePdf;
      return record;
    });
    activeSavedZakatId=zakatState.activeSavedRecordId||null;
    delete zakatState.silverGrams;
    delete zakatState.silverRate;
    delete zakatState.silverBhori;
    delete zakatState.basis;
    if(!zakatState.nisabReference)zakatState.nisabReference='';
    if(!hasZakatReferencePdf(zakatState.referencePdf))zakatState.referencePdf=null;
    else zakatState.referencePdf={name:String(zakatState.referencePdf.name||'Zakat-Reference.pdf'),type:zakatState.referencePdf.type||'application/pdf',size:Number(zakatState.referencePdf.size)||0,data:zakatReferenceBase64(zakatState.referencePdf)};
    if(typeof zakatState.holder!=='string')zakatState.holder='';
    if(!Array.isArray(zakatState.gold))zakatState.gold=[];
    zakatState.gold=zakatState.gold.map(normalizeZakatGoldRow);
    if(!Array.isArray(zakatState.payments))zakatState.payments=[];
  }catch(error){console.warn('Zakat settings could not be loaded',error)}
}
function gregorianToHijri(dateValue){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue||''));
  if(!match)return '';
  const [,yearText,monthText,dayText]=match;
  const date=new Date(0);
  date.setUTCHours(0,0,0,0);
  date.setUTCFullYear(Number(yearText),Number(monthText)-1,Number(dayText));
  if(date.getUTCFullYear()!==Number(yearText)||date.getUTCMonth()!==Number(monthText)-1||date.getUTCDate()!==Number(dayText))return '';
  const months=['Muharram','Safar','Rabi al-Awwal','Rabi al-Thani','Jumada al-Awwal','Jumada al-Thani','Rajab','Shaban','Ramadan','Shawwal','Dhu al-Qadah','Dhu al-Hijjah'];
  for(const calendar of ['islamic-umalqura','islamic']){
    try{
      const formatter=new Intl.DateTimeFormat(`en-u-ca-${calendar}-nu-latn`,{day:'numeric',month:'numeric',year:'numeric',timeZone:'UTC'});
      if(formatter.resolvedOptions().calendar!==calendar)continue;
      const parts=formatter.formatToParts(date);
      const part=type=>parts.find(item=>item.type===type)?.value;
      const day=part('day'),month=Number(part('month')),year=part('year');
      if(day&&month>=1&&month<=months.length&&Number(year)>0)return `${day} ${months[month-1]} ${year}`;
    }catch(error){
      continue;
    }
  }
  return '';
}
function zakatHijriYearOf(source){
  const text=String((source&&(source.hijriEnd||source.hijriStart))||'');
  const match=text.match(/\b(\d{4})\b/);
  return match?match[1]:'';
}
function zakatHijriYear(record){
  return String((record&&record.hijriYear)||zakatHijriYearOf(record)||'');
}
function zakatHolderOf(record){
  if(record&&typeof record.holder==='string'&&record.holder.trim())return record.holder.trim();
  if(record&&record.calculation&&typeof record.calculation.holder==='string')return record.calculation.holder.trim();
  return '';
}
async function saveZakatState(render=true){
  state.settings.zakat=JSON.parse(JSON.stringify(zakatState));
  await put('settings',{key:'zakat',value:state.settings.zakat});
  if(render)renderZakat();
}
function zakatNumber(value){const number=Number(value);return Number.isFinite(number)?number:0}
/* Gold row "Zakatable Percent": stored as a decimal fraction (0.83 = 83%). Rows saved before
   this field existed fall back to 0.83, so old records keep their previous Zakatable value. */
function zakatPercentOf(row){
  const raw=row&&row.zakatPercent;
  if(raw===undefined||raw===null||raw==='')return 0.83;
  return zakatNumber(raw);
}
/* Percentage shown in the "Zakatable Percent" input (83 for 0.83). */
function zakatPercentInputValue(row){
  const percent=zakatPercentOf(row)*100;
  return Number.isFinite(percent)?Number(percent.toFixed(4)):83;
}
function zakatPercentText(row){
  return `${Number((zakatPercentOf(row)*100).toFixed(2))}%`;
}
/* Normalises a saved gold row so every record has the current field shape. */
function normalizeZakatGoldRow(row){
  const source=(row&&typeof row==='object')?row:{};
  return {
    name:typeof source.name==='string'?source.name:'',
    carat:source.carat==null||source.carat===''?'21':String(source.carat),
    grams:zakatNumber(source.grams),
    rate:zakatNumber(source.rate),
    zakatPercent:zakatPercentOf(source)
  };
}
function getZakatValues(){
  const cash=zakatNumber(zakatState.cash)+zakatNumber(zakatState.bank)+zakatNumber(zakatState.investments)+zakatNumber(zakatState.roi)+zakatNumber(zakatState.receivables)-zakatNumber(zakatState.liabilities);
  const gold=(zakatState.gold||[]).reduce((sum,row)=>sum+zakatNumber(row.grams)*zakatNumber(row.rate)*zakatPercentOf(row),0);
  const wealth=cash+gold;
  const payable=wealth>=zakatNumber(zakatState.nisab)?wealth*0.025:0;
  const paid=(zakatState.payments||[]).reduce((sum,payment)=>sum+zakatNumber(payment.amount),0);
  return {cash,gold,wealth,payable,paid,balance:Math.max(0,payable-paid)};
}
function updateZakatCalculations(){
  const values=getZakatValues();
  (zakatState.gold||[]).forEach((row,index)=>{
    const cell=document.querySelector(`[data-zakat-value="${index}"]`);
    if(cell)cell.textContent=formatMoney(zakatNumber(row.grams)*zakatNumber(row.rate)*zakatPercentOf(row));
  });
  $el('zakatNetCashLabel').textContent=`Net Cash: ${formatMoney(values.cash)}`;
  $el('zakatGoldLabel').textContent=`Zakatable: ${formatMoney(values.gold)}`;
  $el('zakatWealth').textContent=formatMoney(values.wealth);
  $el('zakatPayable').textContent=formatMoney(values.payable);
  $el('zakatPaid').textContent=formatMoney(values.paid);
  $el('zakatBalance').textContent=formatMoney(values.balance);
  const status=$el('zakatStatus');
  if(status){
    const meets=zakatNumber(zakatState.nisab)>0&&values.wealth>=zakatNumber(zakatState.nisab);
    status.textContent=meets?'Meets Nisab':'Below Nisab';
    status.className='zakat-status '+(meets?'met':'');
  }
}
function renderZakat(){
  if(!document.getElementById('zakatPage'))return;
  const fields={
    zakatHolder:zakatState.holder,
    zakatHijriStart:zakatState.hijriStart,zakatGregorianStart:zakatState.gregorianStart,
    zakatHijriEnd:zakatState.hijriEnd,zakatGregorianEnd:zakatState.gregorianEnd,
    zakatNisab:zakatState.nisab,zakatNisabReference:zakatState.nisabReference,zakatCash:zakatState.cash,zakatBank:zakatState.bank,
    zakatInvestments:zakatState.investments,zakatRoi:zakatState.roi,
    zakatReceivables:zakatState.receivables,zakatLiabilities:zakatState.liabilities
  };
  Object.entries(fields).forEach(([id,value])=>{const el=document.getElementById(id);if(el&&document.activeElement!==el)el.value=value==null?'':value});
  updateZakatCalculations();
  const reference=zakatState.referencePdf;
  const referenceInfo=$el('zakatReferencePdfInfo');
  const referenceActions=$el('zakatReferencePdfActions');
  if(reference&&reference.name){
    referenceInfo.textContent=reference.data
      ?`${reference.name} · ${formatFileSize(Number(reference.size)||0)}`
      :`${reference.name} · PDF data unavailable`;
    referenceActions.classList.toggle('hidden',!reference.data);
  }else{
    referenceInfo.textContent='No PDF attached';
    referenceActions.classList.add('hidden');
  }
  $el('zakatGoldRows').innerHTML=(zakatState.gold||[]).map((row,index)=>{
    const value=zakatNumber(row.grams)*zakatNumber(row.rate)*zakatPercentOf(row);
    return `<tr><td><input type="text" data-zakat-gold="${index}" data-zakat-field="name" value="${esc(row.name||'')}" aria-label="Ornament name"></td><td><select data-zakat-gold="${index}" data-zakat-field="carat"><option ${row.carat==='22'?'selected':''}>22</option><option ${row.carat==='21'?'selected':''}>21</option><option ${row.carat==='18'?'selected':''}>18</option><option ${row.carat==='Traditional'?'selected':''}>Traditional</option></select></td><td><input type="number" min="0" step="0.01" data-zakat-gold="${index}" data-zakat-field="grams" value="${esc(row.grams)}"></td><td><input type="number" min="0" step="0.01" data-zakat-gold="${index}" data-zakat-field="rate" value="${esc(row.rate)}"></td><td><input type="number" min="0" max="100" step="0.01" data-zakat-gold="${index}" data-zakat-field="zakatPercent" value="${zakatPercentInputValue(row)}" aria-label="Zakatable percent">%</td><td><span data-zakat-value="${index}">${formatMoney(value)}</span> <button type="button" class="action-link danger" data-cmd="delete-zakat-gold" data-id="${index}" aria-label="Delete gold row">×</button></td></tr>`;
  }).join('')||'<tr><td colspan="6"><div class="empty-state">No gold ornaments added.</div></td></tr>';
  $el('zakatPaymentRows').innerHTML=(zakatState.payments||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(payment=>{
    return `<tr><td>${esc(payment.date||'')}</td><td>${esc(payment.category||'')}</td><td>${formatMoney(payment.amount)}</td><td>${esc(payment.note||'')}</td><td><button type="button" class="action-link danger" data-cmd="delete-zakat-payment" data-id="${esc(payment.id)}" aria-label="Delete payment">×</button></td></tr>`;
  }).join('')||'<tr><td colspan="5"><div class="empty-state">No Zakat payments recorded.</div></td></tr>';
  $el('zakatCategoryGuide').innerHTML=ZAKAT_CATEGORIES.map((item,index)=>`<div class="zakat-guide-item"><strong>${index+1}. ${esc(item[0])}</strong><p>${esc(item[1])}</p></div>`).join('');
  renderZakatFilters();
  renderZakatDashboard();
  if(typeof renderWealth==='function')renderWealth();
}

function zakatRecordDate(record){
  return String(record.gregorianEnd||record.gregorianStart||record.savedAt||'').slice(0,10);
}
/* Orders a Nisab Holder's saved records chronologically (Hijri year, then period) so
   unpaid balances and excess payments can carry across the years. */
function zakatRecordsChronological(records){
  return (records||[]).slice().sort((a,b)=>{
    const ah=Number(zakatHijriYear(a))||0;
    const bh=Number(zakatHijriYear(b))||0;
    if(ah!==bh)return ah-bh;
    const ad=zakatRecordDate(a),bd=zakatRecordDate(b);
    if(ad!==bd)return String(ad).localeCompare(String(bd));
    return String(a.savedAt||'').localeCompare(String(b.savedAt||''));
  });
}
/* Groups records by Nisab Holder and orders them chronologically for the ledger view. */
function sortZakatRecordsByLedger(records){
  const grouped=new Map();
  (records||[]).forEach(record=>{
    const holder=zakatHolderOf(record)||'—';
    if(!grouped.has(holder))grouped.set(holder,[]);
    grouped.get(holder).push(record);
  });
  return [...grouped.keys()].sort((a,b)=>a.localeCompare(b)).flatMap(holder=>zakatRecordsChronological(grouped.get(holder)));
}
/* Running Zakat ledger, computed per Nisab Holder in chronological order.
   Net Payable = Current Year Zakat + Prior Outstanding - Prior Overpayment.
   A payment first settles carried-forward outstanding, then any excess is carried
   forward as an overpayment credit into subsequent Hijri years. */
function computeZakatLedger(){
  const byId=new Map();
  const holderMap=new Map();
  const grouped=new Map();
  zakatRecords.forEach(record=>{
    const holder=zakatHolderOf(record)||'—';
    if(!grouped.has(holder))grouped.set(holder,[]);
    grouped.get(holder).push(record);
  });
  grouped.forEach((list,holder)=>{
    let running=0;                     // net carry-forward (+ outstanding / - overpayment credit)
    zakatRecordsChronological(list).forEach(record=>{
      const currentZakat=zakatNumber(record.payable);
      const openingOutstanding=Math.max(0,running);
      const openingOverpayment=Math.max(0,-running);
      const netPayable=currentZakat+openingOutstanding-openingOverpayment;
      const paid=zakatNumber(record.paid);
      const closing=netPayable-paid;
      const entry={
        holder,currentZakat,openingOutstanding,openingOverpayment,
        netPayable,paid,closing,
        outstanding:Math.max(0,closing),
        overpayment:Math.max(0,-closing)
      };
      byId.set(record.id,entry);
      running=closing;
    });
    holderMap.set(holder,{
      holder,
      finalBalance:running,
      finalOutstanding:Math.max(0,running),
      finalOverpayment:Math.max(0,-running)
    });
  });
  return {byId,holderMap};
}
function getFilteredZakatRecords(){
  const holder=$el('zakatFilterHolder')?.value||'';
  const status=$el('zakatFilterStatus')?.value||'';
  const hijriYear=$el('zakatFilterHijriYear')?.value||'';
  const filtered=zakatRecords.filter(record=>{
    if(holder&&zakatHolderOf(record)!==holder)return false;
    if(status==='met'&&!record.meetsNisab)return false;
    if(status==='below'&&record.meetsNisab)return false;
    if(hijriYear&&zakatHijriYear(record)!==hijriYear)return false;
    return true;
  });
  return sortZakatRecordsByLedger(filtered);
}
function renderZakatFilters(){
  const holderSelect=$el('zakatFilterHolder');
  const yearSelect=$el('zakatFilterHijriYear');
  if(!holderSelect||!yearSelect)return;
  const holders=[...new Set(zakatRecords.map(zakatHolderOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const years=[...new Set(zakatRecords.map(zakatHijriYear).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
  const currentHolder=holderSelect.value;
  const currentYear=yearSelect.value;
  holderSelect.innerHTML='<option value="">All Holders</option>'+holders.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join('');
  if(holders.includes(currentHolder))holderSelect.value=currentHolder;else holderSelect.value='';
  yearSelect.innerHTML='<option value="">All Hijri Years</option>'+years.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');
  if(years.includes(currentYear))yearSelect.value=currentYear;else yearSelect.value='';
}
function renderZakatDashboard(){
  const table=$el('zakatDashboardTable');
  const cards=$el('zakatDashboardCards');
  if(!table||!cards)return;
  const records=getFilteredZakatRecords();
  const ledger=computeZakatLedger();
  const entryOf=record=>ledger.byId.get(record.id)||{currentZakat:zakatNumber(record.payable),openingOutstanding:0,openingOverpayment:0,netPayable:zakatNumber(record.payable),paid:zakatNumber(record.paid),outstanding:zakatNumber(record.balance),overpayment:0};
  const total=(key)=>records.reduce((sum,record)=>sum+zakatNumber(entryOf(record)[key]),0);
  const data=[
    ['Saved Records',records.length,'var(--primary-soft)','var(--primary-2)','records'],
    ['Net Zakat Wealth',records.reduce((sum,record)=>sum+zakatNumber(record.wealth),0),'rgba(14,165,233,.12)','#0284c7','money'],
    ['Net Payable',total('netPayable'),'rgba(245,158,11,.14)','#d97706','money'],
    ['Payments Made',total('paid'),'var(--emerald-soft)','#059669','money'],
    ['Net Remaining Due',total('outstanding'),'var(--rose-soft)','#e11d48','money'],
    ['Overpayment Carried',total('overpayment'),'rgba(124,58,237,.14)','#7c3aed','money']
  ];
  cards.innerHTML=data.map((item,index)=>`<div class="summary-card" style="--i:${index};--kpi:${item[2]};--kpi-ink:${item[3]}"><div class="summary-icon">${icon(item[4]==='records'?'list':'scale')}</div><div><p>${item[0]}</p><strong class="kpi-value">${item[4]==='money'?formatMoney(item[1]):item[1]}</strong></div></div>`).join('');
  const count=$el('zakatDashboardRecordCount');
  if(count)count.textContent=`${records.length} saved record${records.length===1?'':'s'} match the filters`;
  renderZakatHijriYearTable(ledger);
  table.innerHTML=`<thead><tr><th>Nisab Holder</th><th>Hijri Period</th><th>Gregorian Period</th><th>Status</th><th class="num">Nisab</th><th class="num">Wealth</th><th class="num">Current Zakat</th><th class="num">Prior Outstanding</th><th class="num">Prior Overpayment</th><th class="num">Net Payable</th><th class="num">Paid</th><th class="num">Net Remaining Due</th><th class="num">Overpayment</th><th>Gold</th><th>Payments</th><th>PDF</th><th>Actions</th></tr></thead><tbody>${records.map(record=>{
    const holder=zakatHolderOf(record);
    const referencePdf=zakatRecordReferencePdf(record);
    const pdfName=referencePdf&&referencePdf.name?esc(referencePdf.name):'Reference PDF';
    const pdf=referencePdf?`<button type="button" class="action-link" data-cmd="view-zakat-pdf" data-id="${esc(record.id)}" title="View ${pdfName}">View</button> <button type="button" class="action-link" data-cmd="download-zakat-pdf" data-id="${esc(record.id)}" title="Download ${pdfName}">Download</button>`:(record.referencePdf&&record.referencePdf.name?esc(record.referencePdf.name):'—');
    const entry=entryOf(record);
    return `<tr><td>${esc(holder||'—')}</td><td>${esc([record.hijriStart,record.hijriEnd].filter(Boolean).join(' – ')||'—')}</td><td>${esc([record.gregorianStart,record.gregorianEnd].filter(Boolean).join(' – ')||zakatRecordDate(record)||'—')}</td><td>${record.meetsNisab?'Meets Nisab':'Below Nisab'}</td><td class="num">${formatMoney(record.nisab)}</td><td class="num">${formatMoney(record.wealth)}</td><td class="num">${formatMoney(entry.currentZakat)}</td><td class="num">${formatMoney(entry.openingOutstanding)}</td><td class="num">${formatMoney(entry.openingOverpayment)}</td><td class="num">${formatMoney(entry.netPayable)}</td><td class="num">${formatMoney(entry.paid)}</td><td class="num">${formatMoney(entry.outstanding)}</td><td class="num">${formatMoney(entry.overpayment)}</td><td>${(record.gold||[]).length}</td><td>${(record.payments||[]).length}</td><td>${pdf}</td><td><button type="button" class="action-link" data-cmd="view-zakat-record" data-id="${esc(record.id)}">View</button> <button type="button" class="action-link" data-cmd="edit-zakat-record" data-id="${esc(record.id)}">Edit</button> <button type="button" class="action-link danger" data-cmd="delete-zakat-record" data-id="${esc(record.id)}">Delete</button></td></tr>`;
  }).join('')||'<tr><td colspan="17"><div class="empty-state">No saved Zakat records match the selected filters.</div></td></tr>'}</tbody>`;
}
function renderZakatHijriYearTable(ledger=computeZakatLedger()){
  const table=$el('zakatHijriYearTable');
  if(!table)return;
  const groups=new Map();
  zakatRecords.forEach(record=>{
    const year=zakatHijriYear(record)||'—';
    if(!groups.has(year))groups.set(year,{year,records:[],holders:new Set(),wealth:0,payable:0,paid:0,outstanding:0,overpayment:0});
    const group=groups.get(year);
    const entry=ledger.byId.get(record.id)||{netPayable:zakatNumber(record.payable),paid:zakatNumber(record.paid),outstanding:zakatNumber(record.balance),overpayment:0};
    group.records.push(record);
    const holder=zakatHolderOf(record);if(holder)group.holders.add(holder);
    group.wealth+=zakatNumber(record.wealth);
    group.payable+=zakatNumber(entry.netPayable);
    group.paid+=zakatNumber(entry.paid);
    group.outstanding+=zakatNumber(entry.outstanding);
    group.overpayment+=zakatNumber(entry.overpayment);
  });
  const rows=[...groups.values()].sort((a,b)=>String(a.year).localeCompare(String(b.year)));
  const count=$el('zakatHijriYearCount');
  if(count)count.textContent=`${rows.length} Hijri year${rows.length===1?'':'s'} recorded`;
  table.innerHTML=`<thead><tr><th>Hijri Year</th><th>Nisab Holders</th><th class="num">Records</th><th class="num">Wealth</th><th class="num">Net Payable</th><th class="num">Paid</th><th class="num">Net Remaining Due</th><th class="num">Overpayment</th><th>Actions</th></tr></thead><tbody>${rows.map(group=>`<tr><td>${esc(group.year)}</td><td>${esc([...group.holders].join(', ')||'—')}</td><td class="num">${group.records.length}</td><td class="num">${formatMoney(group.wealth)}</td><td class="num">${formatMoney(group.payable)}</td><td class="num">${formatMoney(group.paid)}</td><td class="num">${formatMoney(group.outstanding)}</td><td class="num">${formatMoney(group.overpayment)}</td><td><button type="button" class="action-link" data-cmd="filter-zakat-year" data-id="${esc(group.year)}">Edit</button></td></tr>`).join('')||'<tr><td colspan="9"><div class="empty-state">No Zakat records saved yet. Save a calculation to keep a dated record.</div></td></tr>'}</tbody>`;
}
function filterZakatByYear(year){
  const select=$el('zakatFilterHijriYear');
  if(select)select.value=year||'';
  renderZakatDashboard();
  const target=document.getElementById('zakatFilteredCard')||$el('zakatDashboardTable');
  if(target)setTimeout(()=>{try{target.scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'})}catch(e){}},80);
}
function openZakatModal(mode='new'){
  const modal=document.getElementById('zakatModal');
  if(!modal)return;
  if(mode==='new'){
    activeSavedZakatId=null;
    delete zakatState.activeSavedRecordId;
  }
  $el('zakatModalTitle').textContent=activeSavedZakatId?'Edit Zakat Record':'Calculate & Record Zakat';
  $el('zakatModalSubtitle').textContent=activeSavedZakatId?'Update the saved Zakat record':'Nisab, assets, gold and distribution ledger';
  renderZakat();
  modal.showModal();
}
function closeZakatModal(){
  const modal=document.getElementById('zakatModal');
  if(modal&&modal.open)modal.close();
}
let activeZakatDetailId=null;
function zakatDetailExportData(record){
  const referencePdf=(record.referencePdf&&record.referencePdf.name?record.referencePdf:null)
    ||(record.calculation&&record.calculation.referencePdf&&record.calculation.referencePdf.name?record.calculation.referencePdf:null);
  const gold=(record.gold||(record.calculation&&record.calculation.gold))||[];
  const payments=(record.payments||(record.calculation&&record.calculation.payments))||[];
  const calc=record.calculation||{};
  const ledgerEntry=computeZakatLedger().byId.get(record.id)||{currentZakat:zakatNumber(record.payable),openingOutstanding:0,openingOverpayment:0,netPayable:zakatNumber(record.payable),paid:zakatNumber(record.paid),outstanding:zakatNumber(record.balance),overpayment:0};
  const money=value=>formatMoney(zakatNumber(value));
  const fields=[
    ['Nisab Holder',zakatHolderOf(record)||'—'],
    ['Nisab Status',record.meetsNisab?'Meets Nisab':'Below Nisab'],
    ['Hijri Period',[record.hijriStart,record.hijriEnd].filter(Boolean).join(' – ')||'—'],
    ['Gregorian Period',[record.gregorianStart,record.gregorianEnd].filter(Boolean).join(' – ')||'—'],
    ['Nisab Threshold',money(record.nisab)],
    ['Nisab Reference',record.nisabReference||calc.nisabReference||'—'],
    ['Net Zakat Wealth',money(record.wealth)],
    ['Current Year Zakat (2.5%)',money(ledgerEntry.currentZakat)],
    ['Prior Outstanding',money(ledgerEntry.openingOutstanding)],
    ['Prior Overpayment',money(ledgerEntry.openingOverpayment)],
    ['Net Payable',money(ledgerEntry.netPayable)],
    ['Paid',money(ledgerEntry.paid)],
    ['Net Remaining Due',money(ledgerEntry.outstanding)],
    ['Overpayment',money(ledgerEntry.overpayment)],
    ['Reference PDF',referencePdf&&referencePdf.name?referencePdf.name:'—']
  ];
  const assets=[
    ['Cash in hand',money(calc.cash)],
    ['Bank deposits',money(calc.bank)],
    ['Investments',money(calc.investments)],
    ['ROI',money(calc.roi)],
    ['Receivables',money(calc.receivables)],
    ['Liabilities',money(calc.liabilities)]
  ];
  const goldHeaders=['Ornament','Carat','Grams','Per Gram Selling Price','Zakatable Percent','Zakatable value'];
  const goldRows=gold.length?gold.map(row=>[
    row.name||'—',row.carat||'',String(zakatNumber(row.grams)),money(row.rate),
    zakatPercentText(row),money(zakatNumber(row.grams)*zakatNumber(row.rate)*zakatPercentOf(row))
  ]):[['No gold ornaments recorded.','','','','','']];
  const paymentHeaders=['Date','Distribution category','Amount','Note'];
  const sortedPayments=payments.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const paymentRows=sortedPayments.length?sortedPayments.map(payment=>[
    payment.date||'—',payment.category||'—',money(payment.amount),payment.note||'—'
  ]):[['No payments recorded.','','','']];
  const subtitle=`${zakatHolderOf(record)||'Nisab Holder'} · ${[record.hijriStart,record.hijriEnd].filter(Boolean).join(' – ')||zakatRecordDate(record)||''}`;
  return {record,subtitle,fields,assets,goldHeaders,goldRows,paymentHeaders,paymentRows};
}
function hasZakatReferencePdf(reference){
  return !!(reference&&typeof reference==='object'&&typeof reference.data==='string'&&reference.data.trim());
}
function zakatReferenceBase64(reference){
  return String(reference&&reference.data||'').trim().replace(/^data:[^,]*;base64,/i,'').replace(/\s/g,'');
}
/** Reads the attachment from a saved record, including records saved by older versions. */
function zakatRecordReferencePdf(record){
  if(!record||typeof record!=='object')return null;
  if(hasZakatReferencePdf(record.referencePdf))return record.referencePdf;
  const legacy=record.calculation&&record.calculation.referencePdf;
  return hasZakatReferencePdf(legacy)?legacy:null;
}
function zakatReferenceCleanName(name,fallback='Zakat-Reference'){
  const clean=value=>String(value||'').trim().split(/[\\/]/).pop()
    .replace(/\.pdf$/i,'')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g,'-')
    .replace(/\s+/g,'-')
    .replace(/-{2,}/g,'-')
    .replace(/^[-._]+|[-._]+$/g,'')
    .slice(0,120);
  return clean(name)||clean(fallback)||'Zakat-Reference';
}
function zakatReferenceFileName(reference,fallbackName){
  return `${zakatReferenceCleanName(reference&&reference.name,fallbackName)}.pdf`;
}
function zakatRecordReferenceFileName(record){
  const holder=zakatHolderOf(record||{})||'Zakat';
  const year=zakatHijriYear(record||{});
  return zakatReferenceCleanName(`${holder}${year?`-${year}`:''}`,'Zakat-Reference');
}
function zakatReferenceDocument(reference,fallbackName){
  if(!hasZakatReferencePdf(reference))return null;
  let blob=null;
  try{blob=asPdfBlob(base64ToBlob(zakatReferenceBase64(reference),'application/pdf'))}
  catch(error){return null}
  if(!blob||!blob.size)return null;
  return {blob,name:zakatReferenceFileName(reference,fallbackName),size:Number(reference.size)||blob.size};
}
async function viewZakatReferencePdf(reference,fallbackName){
  const documentSource=zakatReferenceDocument(reference,fallbackName);
  if(!documentSource){toast('No Reference PDF is available for this Zakat record.',true);return}
  await openPdfViewer(documentSource);
}
async function downloadZakatReferencePdf(reference,fallbackName){
  const documentSource=zakatReferenceDocument(reference,fallbackName);
  if(!documentSource){toast('No Reference PDF is available for this Zakat record.',true);return}
  await saveFile(documentSource.blob,documentSource.name);
}
function renderZakatDetail(record){
  $el('zakatDetailTitle').textContent='Zakat Record';
  const data=zakatDetailExportData(record);
  const referencePdf=zakatRecordReferencePdf(record);
  const hasReferenceData=hasZakatReferencePdf(referencePdf);
  const referenceInfo=$el('zakatDetailReferencePdfInfo');
  const referenceActions=$el('zakatDetailReferencePdfActions');
  const referenceButtons=[$el('zakatDetailViewReferencePdf'),$el('zakatDetailDownloadReferencePdf')];
  if(referenceInfo){
    referenceInfo.textContent=referencePdf&&referencePdf.name
      ?(hasReferenceData
        ?`${referencePdf.name} · ${formatFileSize(Number(referencePdf.size)||0)}`
        :`${referencePdf.name} · PDF data unavailable`)
      :'No PDF attached';
  }
  if(referenceActions)referenceActions.classList.toggle('hidden',!hasReferenceData);
  referenceButtons.forEach(button=>{if(button)button.disabled=!hasReferenceData});
  $el('zakatDetailSubtitle').textContent=data.subtitle;
  const field=(label,value,full)=>`<div class="detail-field${full?' full':''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const fieldsHtml=data.fields.map(([label,value])=>field(label,label==='Reference PDF'&&!referencePdf?'No PDF attached':value,label==='Nisab Reference'||label==='Reference PDF')).join('');
  const assetsHtml=data.assets.map(([label,value])=>field(label,value)).join('');
  const goldRows=data.goldRows.map(row=>`<tr>${row.map((value,index)=>`<td${index>=2?' class="num"':''}>${esc(value)}</td>`).join('')}</tr>`).join('');
  const paymentRows=data.paymentRows.map(row=>`<tr>${row.map((value,index)=>`<td${index===2?' class="num"':''}>${esc(value)}</td>`).join('')}</tr>`).join('');
  $el('zakatDetailBody').innerHTML=`
    <div class="zakat-detail-grid">
      ${fieldsHtml}
    </div>
    <h4 class="zakat-detail-section">Assets &amp; Cash</h4>
    <div class="zakat-detail-grid">
      ${assetsHtml}
    </div>
    <h4 class="zakat-detail-section">Gold Ornaments</h4>
    <div class="zakat-table-wrap"><table class="zakat-table"><thead><tr>${data.goldHeaders.map((header,index)=>`<th${index>=2?' class="num"':''}>${esc(header)}</th>`).join('')}</tr></thead><tbody>${goldRows}</tbody></table></div>
    <h4 class="zakat-detail-section">Distribution / Payment Ledger</h4>
    <div class="zakat-table-wrap"><table class="zakat-table"><thead><tr>${data.paymentHeaders.map((header,index)=>`<th${index===2?' class="num"':''}>${esc(header)}</th>`).join('')}</tr></thead><tbody>${paymentRows}</tbody></table></div>`;
  document.getElementById('zakatDetailModal').showModal();
}
function viewZakatRecord(id){
  const record=zakatRecords.find(item=>item.id===id);
  if(!record){toast('Zakat record not found.',true);return}
  activeZakatDetailId=id;
  renderZakatDetail(record);
}
async function saveZakatRecord(){
  if(!String(zakatState.holder||'').trim()){toast('Please enter the Nisab Holder.',true);return}
  const values=getZakatValues();
  const id=activeSavedZakatId||uid('zakat-record');
  const calculation=JSON.parse(JSON.stringify(zakatState));
  delete calculation.activeSavedRecordId;
  const referencePdf=calculation.referencePdf||null;
  delete calculation.referencePdf;
  const record={
    id,savedAt:new Date().toISOString(),
    holder:String(zakatState.holder||'').trim(),
    hijriStart:String(zakatState.hijriStart||''),hijriEnd:String(zakatState.hijriEnd||''),
    gregorianStart:String(zakatState.gregorianStart||''),gregorianEnd:String(zakatState.gregorianEnd||''),
    hijriYear:zakatHijriYearOf(zakatState),
    nisab:zakatNumber(zakatState.nisab),nisabReference:String(zakatState.nisabReference||''),
    wealth:values.wealth,payable:values.payable,
    paid:values.paid,balance:values.balance,meetsNisab:zakatNumber(zakatState.nisab)>0&&values.wealth>=zakatNumber(zakatState.nisab),
    gold:JSON.parse(JSON.stringify(zakatState.gold||[])),
    payments:JSON.parse(JSON.stringify(zakatState.payments||[])),
    referencePdf:referencePdf?JSON.parse(JSON.stringify(referencePdf)):null,
    calculation
  };
  const index=zakatRecords.findIndex(item=>item.id===id);
  if(index<0)zakatRecords.push(record);else zakatRecords[index]=record;
  activeSavedZakatId=null;
  delete zakatState.activeSavedRecordId;
  state.settings.zakatRecords=JSON.parse(JSON.stringify(zakatRecords));
  state.settings.zakat=JSON.parse(JSON.stringify(zakatState));
  await putMany('settings',[
    {key:'zakat',value:state.settings.zakat},
    {key:'zakatRecords',value:state.settings.zakatRecords}
  ]);
  renderZakat();
  closeZakatModal();
  toast(index<0?'Zakat record saved':'Zakat record updated');
}
function loadSavedZakatRecord(id){
  const record=zakatRecords.find(item=>item.id===id);
  if(!record||!record.calculation)return;
  const referencePdf=record.referencePdf||record.calculation.referencePdf||null;
  zakatState=Object.assign({},zakatState,JSON.parse(JSON.stringify(record.calculation)),{referencePdf,activeSavedRecordId:record.id});
  if(typeof zakatState.holder!=='string')zakatState.holder=record.holder||'';
  if(!Array.isArray(zakatState.gold))zakatState.gold=[];
  zakatState.gold=zakatState.gold.map(normalizeZakatGoldRow);
  activeSavedZakatId=record.id;
  saveZakatState();
  openZakatModal('edit');
  toast('Saved Zakat record loaded for editing');
}
async function deleteSavedZakatRecord(id){
  zakatRecords=zakatRecords.filter(record=>record.id!==id);
  if(activeSavedZakatId===id){
    activeSavedZakatId=null;
    delete zakatState.activeSavedRecordId;
    await saveZakatState(false);
  }
  state.settings.zakatRecords=JSON.parse(JSON.stringify(zakatRecords));
  await put('settings',{key:'zakatRecords',value:state.settings.zakatRecords});
  renderZakat();
}
/* Fallback ledger entry when a record is not part of the running ledger (kept so an
   export never breaks); it mirrors computeZakatLedger()'s closing-balance rules. */
function zakatLedgerFallback(record){
  const netPayable=zakatNumber(record.payable);
  const paid=zakatNumber(record.paid);
  const closing=netPayable-paid;
  return {currentZakat:netPayable,openingOutstanding:0,openingOverpayment:0,netPayable,paid,closing,
    outstanding:Math.max(0,closing),overpayment:Math.max(0,-closing)};
}
/* Ledger-aware report rows shared by the Zakat Excel & PDF exports. They reuse
   computeZakatLedger() so the exported figures always match the Zakat Dashboard:
   carried-forward prior-year outstanding, overpayment credits applied to prior and
   subsequent Hijri years, net payable, paid and the final remaining/overpaid balance. */
function zakatLedgerReportRows(records){
  const ledger=computeZakatLedger();
  return (records||[]).map(record=>{
    const entry=ledger.byId.get(record.id)||zakatLedgerFallback(record);
    return {
      holder:zakatHolderOf(record)||'—',
      hijriYear:zakatHijriYear(record)||'—',
      hijriPeriod:[record.hijriStart,record.hijriEnd].filter(Boolean).join(' – ')||zakatRecordDate(record)||'—',
      gregorianPeriod:[record.gregorianStart,record.gregorianEnd].filter(Boolean).join(' – ')||zakatRecordDate(record)||'—',
      gregorianStart:record.gregorianStart||'',
      gregorianEnd:record.gregorianEnd||'',
      status:record.meetsNisab?'Meets Nisab':'Below Nisab',
      nisab:zakatNumber(record.nisab),
      wealth:zakatNumber(record.wealth),
      currentZakat:zakatNumber(entry.currentZakat),
      priorOutstanding:zakatNumber(entry.openingOutstanding),
      priorOverpayment:zakatNumber(entry.openingOverpayment),
      netPayable:zakatNumber(entry.netPayable),
      paid:zakatNumber(entry.paid),
      remaining:zakatNumber(entry.outstanding),
      overpayment:zakatNumber(entry.overpayment),
      closing:zakatNumber(entry.closing),
      paymentCount:(record.payments||[]).length,
      goldCount:(record.gold||[]).length
    };
  });
}
/* Column totals of the exported rows - the same sums the Dashboard KPI cards show. */
function zakatLedgerTotals(rows){
  return (rows||[]).reduce((totals,row)=>{
    ['nisab','wealth','currentZakat','priorOutstanding','priorOverpayment','netPayable','paid','remaining','overpayment','paymentCount']
      .forEach(key=>{totals[key]+=row[key]||0});
    return totals;
  },{nisab:0,wealth:0,currentZakat:0,priorOutstanding:0,priorOverpayment:0,netPayable:0,paid:0,remaining:0,overpayment:0,paymentCount:0});
}
/* Per Nisab Holder summary: the flows of the exported rows plus the final carried-forward
   balance of the holder's last exported period (the ledger's closing running balance). */
function zakatHolderSummaryRows(rows){
  const groups=new Map();
  (rows||[]).forEach(row=>{
    if(!groups.has(row.holder))groups.set(row.holder,{
      holder:row.holder,records:0,wealth:0,currentZakat:0,priorOutstanding:0,priorOverpayment:0,
      netPayable:0,paid:0,remaining:0,overpayment:0,closing:0
    });
    const group=groups.get(row.holder);
    group.records++;
    ['wealth','currentZakat','priorOutstanding','priorOverpayment','netPayable','paid','remaining','overpayment']
      .forEach(key=>{group[key]+=row[key]||0});
    group.closing=row.closing;
  });
  return [...groups.values()].map(group=>Object.assign(group,{
    finalOutstanding:Math.max(0,group.closing),
    finalOverpayment:Math.max(0,-group.closing)
  }));
}
function zakatReportRows(records){
  return zakatLedgerReportRows(records).map(row=>[
    row.holder,row.hijriYear,row.hijriPeriod,row.gregorianStart,row.gregorianEnd,row.status,
    row.nisab,row.wealth,row.currentZakat,row.priorOutstanding,row.priorOverpayment,
    row.netPayable,row.paid,row.remaining,row.overpayment,row.paymentCount,row.goldCount
  ]);
}
function zakatHolderSummaryTable(rows){
  return zakatHolderSummaryRows(rows).map(group=>[
    group.holder,group.records,group.wealth,group.currentZakat,group.priorOutstanding,
    group.priorOverpayment,group.netPayable,group.paid,group.remaining,group.overpayment,
    group.finalOutstanding,group.finalOverpayment
  ]);
}
function zakatPaymentRows(records){
  return records.flatMap(record=>(record.payments||[]).map(payment=>[
    zakatHolderOf(record)||'—',
    [record.hijriStart,record.hijriEnd].filter(Boolean).join(' – ')||zakatHijriYear(record)||'—',
    payment.date||'',payment.category||'',Number(payment.amount)||0,payment.note||''
  ]));
}
/* Filter line printed in the exports so a filtered report is self-explanatory. */
function zakatReportFilterText(){
  const holder=$el('zakatFilterHolder')?.value||'';
  const status=$el('zakatFilterStatus')?.value||'';
  const year=$el('zakatFilterHijriYear')?.value||'';
  const statusText=status==='met'?'Meets Nisab':status==='below'?'Below Nisab':'All statuses';
  return `Nisab Holder: ${holder||'All holders'}   |   Status: ${statusText}   |   Hijri Year: ${year||'All Hijri years'}`;
}
function exportZakatExcel(){
  const records=getFilteredZakatRecords();
  if(!records.length){toast('No saved Zakat records match the current filters.',true);return}
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const rows=zakatLedgerReportRows(records);
  const totals=zakatLedgerTotals(rows);
  const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([
    ['Nisab Holder','Hijri Year','Hijri Period','Gregorian Start','Gregorian End','Nisab Status','Nisab (BDT)','Wealth (BDT)','Current Zakat (BDT)','Prior Outstanding (BDT)','Prior Overpayment (BDT)','Net Payable (BDT)','Paid (BDT)','Net Remaining Due (BDT)','Overpayment Carried (BDT)','Payment Count','Gold Count'],
    ...zakatReportRows(records),
    ['Total','','','','','',totals.nisab,totals.wealth,totals.currentZakat,totals.priorOutstanding,totals.priorOverpayment,totals.netPayable,totals.paid,totals.remaining,totals.overpayment,totals.paymentCount,'']
  ]);
  sheet['!cols']=[{wch:20},{wch:12},{wch:26},{wch:16},{wch:16},{wch:14},{wch:16},{wch:16},{wch:20},{wch:22},{wch:22},{wch:18},{wch:16},{wch:22},{wch:24},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(workbook,sheet,'Zakat Records');
  const summarySheet=XLSX.utils.aoa_to_sheet([
    ['Zakat Ledger Summary'],
    [`Generated ${generatedStamp()}`],
    [zakatReportFilterText()],
    [],
    ['Nisab Holder','Records','Wealth (BDT)','Current Zakat (BDT)','Prior Outstanding (BDT)','Prior Overpayment (BDT)','Net Payable (BDT)','Paid (BDT)','Net Remaining Due (BDT)','Overpayment Carried (BDT)','Final Remaining Due (BDT)','Final Overpayment Carried (BDT)'],
    ...zakatHolderSummaryTable(rows)
  ]);
  summarySheet['!cols']=[{wch:20},{wch:10},{wch:16},{wch:20},{wch:22},{wch:22},{wch:18},{wch:16},{wch:22},{wch:24},{wch:24},{wch:28}];
  XLSX.utils.book_append_sheet(workbook,summarySheet,'Holder Summary');
  const paymentSheet=XLSX.utils.aoa_to_sheet([
    ['Nisab Holder','Hijri Period','Date','Distribution Category','Amount (BDT)','Note'],
    ...zakatPaymentRows(records)
  ]);
  paymentSheet['!cols']=[{wch:20},{wch:26},{wch:14},{wch:28},{wch:18},{wch:42}];
  XLSX.utils.book_append_sheet(workbook,paymentSheet,'Payments');
  XLSX.writeFile(workbook,`Zakat-Report-${todayISO()}.xlsx`);
  toast('Zakat Excel report exported');
}
function exportZakatPdf(){
  const records=getFilteredZakatRecords();
  if(!records.length){toast('No saved Zakat records match the current filters.',true);return}
  const JsPDF=window.jspdf&&window.jspdf.jsPDF;
  if(!JsPDF){toast('PDF library is unavailable. Check your internet connection.',true);return}
  const doc=new JsPDF({orientation:'landscape',unit:'pt',format:'a4',compress:true});
  if(typeof doc.autoTable!=='function'){toast('PDF table plugin is unavailable. Check your internet connection.',true);return}
  const rows=zakatLedgerReportRows(records);
  const totals=zakatLedgerTotals(rows);
  const margin=28,FOOT=26;
  const pageH=()=>doc.internal.pageSize.getHeight();
  const money=value=>(Number(value)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  doc.setProperties({title:'Zakat Dashboard Report',subject:zakatReportFilterText(),creator:'Personal Finance'});
  doc.setFont('helvetica','bold');doc.setFontSize(16);doc.setTextColor(31,41,55);doc.text('Zakat Dashboard Report',margin,30);
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,116,139);
  doc.text(`Generated ${generatedStamp()} · ${records.length} saved record(s)`,margin,44);
  doc.text(zakatReportFilterText().replace(/\s*\|\s*/g,'   |   '),margin,56);
  const tableStyle={styles:{fontSize:6.5,cellPadding:3,overflow:'linebreak'},alternateRowStyles:{fillColor:[248,250,252]}};
  doc.autoTable(Object.assign({
    startY:66,theme:'grid',margin:{left:margin,right:margin,top:66,bottom:FOOT},
    head:[['Nisab Holder','Hijri Yr','Hijri Period','Gregorian Period','Status','Nisab (BDT)','Wealth (BDT)','Current Zakat (BDT)','Prior Outstanding (BDT)','Prior Overpayment (BDT)','Net Payable (BDT)','Paid (BDT)','Net Remaining Due (BDT)','Overpayment (BDT)']],
    headStyles:{fillColor:[79,70,229],textColor:255,fontStyle:'bold',fontSize:6.5},
    body:rows.map(row=>[
      row.holder,row.hijriYear,row.hijriPeriod,row.gregorianPeriod,row.status,
      money(row.nisab),money(row.wealth),money(row.currentZakat),money(row.priorOutstanding),
      money(row.priorOverpayment),money(row.netPayable),money(row.paid),money(row.remaining),money(row.overpayment)
    ]),
    foot:[['Total','','','','',money(totals.nisab),money(totals.wealth),money(totals.currentZakat),money(totals.priorOutstanding),money(totals.priorOverpayment),money(totals.netPayable),money(totals.paid),money(totals.remaining),money(totals.overpayment)]],
    footStyles:{fillColor:[238,242,255],textColor:[30,41,59],fontStyle:'bold',fontSize:6.5},
    columnStyles:{
      0:{cellWidth:54},1:{cellWidth:34},2:{cellWidth:74},3:{cellWidth:88},4:{cellWidth:46},
      5:{cellWidth:44,halign:'right'},6:{cellWidth:50,halign:'right'},7:{cellWidth:48,halign:'right'},
      8:{cellWidth:50,halign:'right'},9:{cellWidth:46,halign:'right'},10:{cellWidth:46,halign:'right'},
      11:{cellWidth:42,halign:'right'},12:{cellWidth:54,halign:'right'},13:{cellWidth:46,halign:'right'}
    }
  },tableStyle));
  let y=doc.lastAutoTable.finalY+20;
  if(y+110>pageH()-FOOT){doc.addPage();y=44}
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(31,41,55);
  doc.text('Per Nisab Holder - Carried-Forward Balance',margin,y);
  doc.autoTable(Object.assign({
    startY:y+8,theme:'grid',margin:{left:margin,right:margin,top:66,bottom:FOOT},
    head:[['Nisab Holder','Records','Net Payable (BDT)','Paid (BDT)','Net Remaining Due (BDT)','Overpayment Carried (BDT)','Final Remaining Due (BDT)','Final Overpayment (BDT)']],
    headStyles:{fillColor:[79,70,229],textColor:255,fontStyle:'bold',fontSize:6.5},
    body:zakatHolderSummaryRows(rows).map(group=>[
      group.holder,String(group.records),money(group.netPayable),money(group.paid),
      money(group.remaining),money(group.overpayment),money(group.finalOutstanding),money(group.finalOverpayment)
    ]),
    columnStyles:{
      0:{cellWidth:90},1:{cellWidth:50,halign:'right'},2:{cellWidth:90,halign:'right'},
      3:{cellWidth:90,halign:'right'},4:{cellWidth:96,halign:'right'},5:{cellWidth:90,halign:'right'},
      6:{cellWidth:100,halign:'right'},7:{cellWidth:100,halign:'right'}
    }
  },tableStyle));
  const payments=zakatPaymentRows(records);
  if(payments.length){
    y=doc.lastAutoTable.finalY+20;
    if(y+90>pageH()-FOOT){doc.addPage();y=44}
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(31,41,55);
    doc.text('Distribution / Payment Details',margin,y);
    doc.autoTable(Object.assign({
      startY:y+8,theme:'grid',margin:{left:margin,right:margin,top:66,bottom:FOOT},
      head:[['Nisab Holder','Hijri Period','Date','Distribution Category','Amount (BDT)','Note']],
      body:payments.map(row=>[row[0],row[1],row[2],row[3],money(row[4]),row[5]]),
      headStyles:{fillColor:[16,185,129],textColor:255,fontStyle:'bold',fontSize:6.5},
      columnStyles:{0:{cellWidth:90},1:{cellWidth:120},2:{cellWidth:70},3:{cellWidth:190},4:{cellWidth:100,halign:'right'},5:{cellWidth:210}}
    },tableStyle));
  }
  doc.save(`Zakat-Report-${todayISO()}.pdf`);
  toast('Zakat PDF report exported');
}
function zakatDetailFilename(record,extension){
  const holder=zakatHolderOf(record)||'record';
  const safeHolder=String(holder).replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').trim().replace(/\s+/g,'-');
  return `Zakat-Record-${safeHolder}-${zakatHijriYear(record)||todayISO()}.${extension}`;
}
function exportZakatDetailExcel(){
  const record=zakatRecords.find(item=>item.id===activeZakatDetailId);
  if(!record){toast('Open a Zakat record before exporting.',true);return}
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const data=zakatDetailExportData(record);
  const aoa=[
    ['Zakat Record'],
    [data.subtitle],
    [],
    ...data.fields,
    [],
    ['Assets & Cash'],
    ['Field','Value'],
    ...data.assets,
    [],
    ['Gold Ornaments'],
    data.goldHeaders,
    ...data.goldRows,
    [],
    ['Distribution / Payment Ledger'],
    data.paymentHeaders,
    ...data.paymentRows
  ];
  const sheet=XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols']=[{wch:30},{wch:42},{wch:24},{wch:24},{wch:24},{wch:24}];
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,sheet,'Zakat Record');
  XLSX.writeFile(workbook,zakatDetailFilename(record,'xlsx'));
  toast('Zakat record Excel exported');
}
function exportZakatDetailPdf(){
  const record=zakatRecords.find(item=>item.id===activeZakatDetailId);
  if(!record){toast('Open a Zakat record before exporting.',true);return}
  const JsPDF=window.jspdf&&window.jspdf.jsPDF;
  if(!JsPDF){toast('PDF library is unavailable. Check your internet connection.',true);return}
  const doc=new JsPDF({orientation:'landscape',unit:'pt',format:'a4',compress:true});
  if(typeof doc.autoTable!=='function'){toast('PDF table plugin is unavailable. Check your internet connection.',true);return}
  const data=zakatDetailExportData(record);
  const pdfText=value=>typeof value==='string'?value.replace(/৳\s*/g,'BDT ').replace(/টাকা\s*/g,'BDT ').trim():value;
  const pdfRows=rows=>rows.map(row=>row.map(pdfText));
  data.subtitle=pdfText(data.subtitle);
  data.fields=pdfRows(data.fields);
  data.assets=pdfRows(data.assets);
  data.goldHeaders=pdfRows([data.goldHeaders])[0];
  data.goldRows=pdfRows(data.goldRows);
  data.paymentHeaders=pdfRows([data.paymentHeaders])[0];
  data.paymentRows=pdfRows(data.paymentRows);
  const margin=36,foot=32,pageHeight=()=>doc.internal.pageSize.getHeight();
  const tableStyle={theme:'grid',styles:{fontSize:8,cellPadding:4,overflow:'linebreak'},headStyles:{fillColor:[79,70,229],textColor:255,fontStyle:'bold'},alternateRowStyles:{fillColor:[248,250,252]},margin:{left:margin,right:margin,bottom:foot}};
  doc.setProperties({title:'Zakat Record',subject:data.subtitle,creator:'Personal Finance'});
  doc.setFont('helvetica','bold');doc.setFontSize(16);doc.setTextColor(31,41,55);doc.text('Zakat Record',margin,32);
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(100,116,139);doc.text(data.subtitle,margin,48);
  doc.autoTable(Object.assign({startY:60,head:[['Field','Value']],body:data.fields,columnStyles:{0:{cellWidth:180},1:{cellWidth:565}}},tableStyle));
  let y=doc.lastAutoTable.finalY+20;
  const section=(title,head,body,columnStyles)=>{
    if(y+70>pageHeight()-foot){doc.addPage();y=40}
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(31,41,55);doc.text(title,margin,y);
    doc.autoTable(Object.assign({startY:y+8,head:[head],body,columnStyles},tableStyle));
    y=doc.lastAutoTable.finalY+20;
  };
  section('Assets & Cash',['Field','Value'],data.assets,{0:{cellWidth:180},1:{cellWidth:565}});
  section('Gold Ornaments',data.goldHeaders,data.goldRows,{});
  section('Distribution / Payment Ledger',data.paymentHeaders,data.paymentRows,{});
  doc.save(zakatDetailFilename(record,'pdf'));
  toast('Zakat record PDF exported');
}
function bindZakatEvents(){
  const modal=document.getElementById('zakatModal');
  if(modal){
    $el('zakatOpenModal').onclick=()=>openZakatModal('new');
    modal.querySelectorAll('[data-close-modal]').forEach(button=>button.onclick=()=>modal.close());
  }
  const detailModal=document.getElementById('zakatDetailModal');
  if(detailModal){
    detailModal.querySelectorAll('[data-close-modal]').forEach(button=>button.onclick=()=>detailModal.close());
    $el('zakatDetailEdit').onclick=()=>{
      if(!activeZakatDetailId)return;
      detailModal.close();
      loadSavedZakatRecord(activeZakatDetailId);
    };
  }
  const detailViewPdf=$el('zakatDetailViewReferencePdf');
  if(detailViewPdf)detailViewPdf.onclick=async()=>{
    const record=zakatRecords.find(item=>item.id===activeZakatDetailId);
    const referencePdf=zakatRecordReferencePdf(record);
    if(!hasZakatReferencePdf(referencePdf)){toast('No Reference PDF is available for this Zakat record.',true);return}
    try{await viewZakatReferencePdf(referencePdf,zakatRecordReferenceFileName(record))}
    catch(error){console.error(error);toast('The Reference PDF could not be opened.',true)}
  };
  const detailDownloadPdf=$el('zakatDetailDownloadReferencePdf');
  if(detailDownloadPdf)detailDownloadPdf.onclick=async()=>{
    const record=zakatRecords.find(item=>item.id===activeZakatDetailId);
    const referencePdf=zakatRecordReferencePdf(record);
    if(!hasZakatReferencePdf(referencePdf)){toast('No Reference PDF is available for this Zakat record.',true);return}
    try{await downloadZakatReferencePdf(referencePdf,zakatRecordReferenceFileName(record))}
    catch(error){console.error(error);toast('The Reference PDF could not be downloaded.',true)}
  };
  $el('exportZakatDetailPdf').onclick=exportZakatDetailPdf;
  $el('exportZakatDetailExcel').onclick=exportZakatDetailExcel;
  $el('saveZakatRecord').onclick=()=>saveZakatRecord().catch(error=>{console.error(error);toast(error.message||'Zakat record could not be saved.',true)});
  ['zakatFilterHolder','zakatFilterStatus','zakatFilterHijriYear'].forEach(id=>{
    const input=$el(id);
    if(input)input.onchange=renderZakatDashboard;
  });
  $el('zakatFilterClear').onclick=()=>{
    $el('zakatFilterHolder').value='';$el('zakatFilterStatus').value='';$el('zakatFilterHijriYear').value='';
    renderZakatDashboard();
  };
  $el('exportZakatExcel').onclick=exportZakatExcel;
  $el('exportZakatPdf').onclick=exportZakatPdf;
  const fields={
    zakatHolder:'holder',
    zakatHijriStart:'hijriStart',zakatGregorianStart:'gregorianStart',zakatHijriEnd:'hijriEnd',
    zakatGregorianEnd:'gregorianEnd',zakatNisab:'nisab',zakatNisabReference:'nisabReference',zakatCash:'cash',zakatBank:'bank',
    zakatInvestments:'investments',zakatRoi:'roi',zakatReceivables:'receivables',
    zakatLiabilities:'liabilities'
  };
  Object.entries(fields).forEach(([id,key])=>{
    const el=document.getElementById(id);if(!el)return;
    if(key==='gregorianStart'||key==='gregorianEnd'){
      const hijriKey=key==='gregorianStart'?'hijriStart':'hijriEnd';
      const hijriInput=$el(key==='gregorianStart'?'zakatHijriStart':'zakatHijriEnd');
      const updateDates=()=>{
        const gregorianValue=el.value;
        const hijriValue=gregorianToHijri(gregorianValue);
        if(zakatState[key]===gregorianValue&&zakatState[hijriKey]===hijriValue)return;
        zakatState[key]=gregorianValue;
        zakatState[hijriKey]=hijriValue;
        hijriInput.value=hijriValue;
        saveZakatState();
      };
      el.addEventListener('input',updateDates);
      el.addEventListener('change',updateDates);
      return;
    }
    el.oninput=()=>{zakatState[key]=el.type==='number'?zakatNumber(el.value):el.value;saveZakatState()};
  });
  $el('zakatReferencePdf').onchange=async e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    if(file.type!=='application/pdf'&&!String(file.name).toLowerCase().endsWith('.pdf')){toast('Please choose a PDF file.',true);e.target.value='';return}
    if(file.size>25*1024*1024){toast('The Reference PDF must be 25 MB or smaller.',true);e.target.value='';return}
    try{
      zakatState.referencePdf={name:file.name,type:file.type||'application/pdf',size:file.size,data:await blobToBase64(file)};
      await saveZakatState();
      toast('Reference PDF attached');
    }catch(error){console.error(error);toast('Reference PDF could not be attached.',true)}
  };
  const draftViewPdf=$el('zakatViewReferencePdf');
  if(draftViewPdf)draftViewPdf.onclick=async()=>{
    try{await viewZakatReferencePdf(zakatState.referencePdf)}
    catch(error){console.error(error);toast('The Reference PDF could not be opened.',true)}
  };
  const draftDownloadPdf=$el('zakatDownloadReferencePdf');
  if(draftDownloadPdf)draftDownloadPdf.onclick=async()=>{
    try{await downloadZakatReferencePdf(zakatState.referencePdf)}
    catch(error){console.error(error);toast('The Reference PDF could not be downloaded.',true)}
  };
  $el('zakatRemoveReferencePdf').onclick=async()=>{
    zakatState.referencePdf=null;
    const input=$el('zakatReferencePdf');if(input)input.value='';
    await saveZakatState();
    toast('Reference PDF removed');
  };
  $el('zakatAddGold').onclick=()=>{zakatState.gold=zakatState.gold||[];zakatState.gold.push({name:'',carat:'21',grams:0,rate:20205,zakatPercent:0.83});saveZakatState()};
  $el('zakatAddPayment').onclick=async()=>{
    const date=window.prompt('Payment date (YYYY-MM-DD)',new Date().toISOString().slice(0,10));if(!date)return;
    const category=window.prompt('Distribution category',ZAKAT_CATEGORIES[0][0]);if(category===null)return;
    const amountText=window.prompt('Payment amount','0');if(amountText===null)return;
    const note=window.prompt('Payment note','')||'';
    zakatState.payments=zakatState.payments||[];
    zakatState.payments.push({id:uid('zakat-payment'),date,category,note,amount:zakatNumber(amountText)});
    await saveZakatState();
  };
  const updateGoldField=e=>{
    const input=e.target.closest('[data-zakat-gold]');if(!input)return;
    const index=Number(input.dataset.zakatGold),key=input.dataset.zakatField;
    const row=zakatState.gold&&zakatState.gold[index];if(!row)return;
    if(key==='zakatPercent')row.zakatPercent=input.type==='number'?zakatNumber(input.value)/100:input.value;
    else row[key]=input.type==='number'?zakatNumber(input.value):input.value;
    updateZakatCalculations();
    saveZakatState(false);
  };
  $el('zakatGoldRows').oninput=updateGoldField;
  $el('zakatGoldRows').onchange=updateGoldField;
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
/** Cash & Bank = an Asset whose category is "Cash" or "Cash & Bank Account" (Cash In Hand / bank
 *  accounts / mobile wallets). Also recognised as "Cash & Bank" / "Cash and Bank", so a renamed
 *  category keeps snapshot semantics. */
const isCashCategoryName=name=>/^(cash|cash\s*(?:&|\band\b)\s*bank(?:\s*account)?)$/i.test(String(name||'').trim());
/** "Cash & Bank" exactly (also spelled "Cash and Bank"). The built-in Cash category keeps its own
 *  schemas (Cash Asset Name / Bank Name), so auto-naming Particulars only applies to this label. */
const isCashBankCategoryName=name=>/^cash\s*(?:&|\band\b)\s*bank$/i.test(String(name||'').trim());
const isCashRecord=r=>!!r&&r.type==='Asset'&&isCashCategoryName(r.category);
/** Identity of a Cash & Bank subcategory (bKash, Cash in Hand, Basic Bank Limited, ...). Cash is a
 *  snapshot per item and the item name lives on the subcategory, so transfers and record funding
 *  work on the subcategory as a whole and every snapshot that belongs to it is aggregated. */
const cashSubcategoryKey=subcategory=>String(subcategory||'').trim().toLowerCase();
/** Identity of any Asset subcategory for the "Funded from" picker (category + subcategory). */
const assetFundingKey=(category,subcategory)=>`${String(category||'').trim()}::${String(subcategory||'').trim()}`;
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
/* ---------- Transfers between two accounts ---------------------------------
   A transfer is stored as ONE record that carries both sides. It never lives in the income /
   expense world and it is never counted as a ledger row of its own: the balance of each side is
   rebuilt at read time (see applyTransferLegs), so editing or deleting a transfer instantly
   restores both accounts without rewriting any other record.
   -------------------------------------------------------------------------- */
const TRANSFER_KIND='transfer';
/** Transfers are recognised by kind, with a structural fallback for imported / older data. */
const isTransferRecord=r=>!!r&&(r.kind===TRANSFER_KIND||!!(r.transfer&&r.transfer.source&&r.transfer.destination));
/** Identity of a balance account. Cash snapshots group on these three fields, so transfers use the
 *  exact same key and always land on the account the user picked. */
const transferAccountKey=account=>account?[account.subcategory,account.particulars,account.accountDetail].map(v=>String(v??'').trim()).join('::'):'';
/** Compact, self-contained copy of an account stored on both sides of the transfer. */
function transferAccountSnapshot(account){
  return {
    key:transferAccountKey(account),
    type:account.type||'',category:account.category||'',subcategory:account.subcategory||'',
    particulars:account.particulars||'',accountDetail:account.accountDetail||''
  };
}
/** Display name of a stored account snapshot ("bKash · 01712345678"). */
function transferAccountName(account){
  if(!account)return '';
  const primary=String(account.particulars||'').trim();
  const detail=String(account.accountDetail||'').trim();
  if(primary&&detail&&!primary.includes(detail))return `${primary} · ${detail}`;
  return primary||detail||String(account.subcategory||'').trim();
}
/** "Cash / bKash → Cash / Cash in Hand · 14:30 · Fee / difference ৳15.00" for cards and table rows. */
function transferMetaLabel(record){
  const t=record&&record.transfer;
  if(!t)return '';
  const side=account=>`${(account&&account.category)||''} / ${(account&&account.subcategory)||''}`;
  const parts=[`${side(t.source)} → ${side(t.destination)}`];
  if(t.time)parts.push(t.time);
  const fee=Number(t.fee)||0;
  if(fee>0)parts.push(`Fee / difference ${formatMoney(fee)}`);
  if(t.source&&t.source.status&&t.source.status!=='Paid')parts.push(String(t.source.status));
  return parts.join(' · ');
}
/** Money leaving the source and money arriving at the destination (they differ when a fee applies). */
function transferAmounts(transfer){
  const t=transfer||{};
  return {out:Math.abs(Number(t.source&&t.source.amount)||0),incoming:Math.abs(Number(t.destination&&t.destination.amount)||0)};
}
/**
 * Movement of one side, in the sign convention of the account's stored amount.
 * A transfer moves value FROM the source TO the destination, so the destination's value grows and
 * the source's shrinks. Account amounts are Asset = +value, Liability = -value, which is why a
 * Liability source (new loan money) grows and a Liability destination (a repayment) shrinks - and
 * why a transfer leaves Net Worth unchanged.
 */
function transferLegDelta(account,amount,isSource){
  const value=Math.abs(Number(amount)||0);
  const sign=account&&account.type==='Liability'?-1:1;
  return (isSource?-1:1)*value*sign;
}
/** Both sides of a transfer as {direction,account,amount,delta}. */
function transferBalanceLegs(transfer){
  const t=transfer&&transfer.transfer;
  if(!t||!t.source||!t.destination)return [];
  const {out,incoming}=transferAmounts(t);
  return [
    {direction:'source',account:t.source,amount:out,delta:transferLegDelta(t.source,out,true)},
    {direction:'destination',account:t.destination,amount:incoming,delta:transferLegDelta(t.destination,incoming,false)}
  ];
}
/**
 * Balance key used while applying transfer / funding movements. Cash legs are anchored on the
 * subcategory (the account name the user picks) so every snapshot of that account is moved;
 * legacy non-cash legs keep the exact account identity so old data still resolves.
 */
function transferAnchorKey(account){
  return isCashRecord(account)?`cash:${cashSubcategoryKey(account.subcategory)}`:`acct:${transferAccountKey(account)}`;
}
/**
 * Applies every transfer to the accounts it touches and returns balance rows for them.
 * The rows are flagged `syntheticTransferLeg` so record lists, reports and the paginated table can
 * skip them while every balance computation (KPIs, charts, balance sheet, mobile summary) keeps
 * counting them.
 * Cash is a snapshot: a side only counts while it is newer than the account's own snapshot,
 * otherwise the entered balance already reflects the movement.
 */
function applyTransferLegs(balanceRecords,transfers,year){
  if(!transfers||!transfers.length)return balanceRecords;
  const range=year?fiscalRange(year):null;
  const cutoff=range?range.to:'';
  const anchors=new Map();
  balanceRecords.forEach(record=>{
    const key=transferAnchorKey(record);
    let anchor=anchors.get(key);
    if(!anchor){anchor={snapshot:'',savedAt:''};anchors.set(key,anchor)}
    if(!isCashRecord(record))return;
    const effective=cashEffectiveDate(record);
    if(!anchor.snapshot||effective>anchor.snapshot){
      anchor.snapshot=effective;
      anchor.savedAt=String(record.updatedAt||record.createdAt||'');
    }
  });
  const legs=[];
  for(const transfer of transfers){
    const date=normalizeExcelDate(transfer.date)||String(transfer.date||'').slice(0,10);
    if(cutoff&&date&&date>cutoff)continue;                    // belongs to a later Income Year
    const incomeYear=transfer.incomeYear||fiscalYearFromDate(date)||'';
    for(const leg of transferBalanceLegs(transfer)){
      const key=transferAnchorKey(leg.account);
      let anchor=anchors.get(key);
      // A Cash & Bank subcategory without any snapshot can still receive a transfer: the movement
      // itself becomes the shown balance instead of silently disappearing.
      if(!anchor&&isCashRecord(leg.account)){anchor={snapshot:'',savedAt:''};anchors.set(key,anchor)}
      if(!anchor||!leg.delta)continue;                        // account not in this scope
      if(anchor.snapshot&&date){
        if(date<anchor.snapshot)continue;                                                     // snapshot is newer
        if(date===anchor.snapshot&&anchor.savedAt&&anchor.savedAt>=String(transfer.updatedAt||transfer.createdAt||''))continue;
      }
      legs.push({
        id:`${transfer.id}::${leg.direction}`,
        syntheticTransferLeg:true,transferId:transfer.id,transferDirection:leg.direction,
        type:leg.account.type,category:leg.account.category,subcategory:leg.account.subcategory,
        particulars:leg.account.particulars||'',accountDetail:leg.account.accountDetail||'',
        date,incomeYear,amount:leg.delta,balance:leg.delta,details:'',documentIds:[]
      });
    }
  }
  return legs.length?[...balanceRecords,...legs]:balanceRecords;
}
/**
 * "Funded from" movements of ordinary records (see the Add / Edit record sheet).
 * A non-cash record may say which Asset subcategory paid for it. Instead of writing a second hidden
 * record, the movement is derived from the stored record here - exactly like a transfer leg - so
 * editing the amount, changing the funding account or deleting the record can never double-deduct:
 * the record itself is the single source of truth.
 * The same snapshot rule as transfers applies: a funding row only counts while it is newer than the
 * funding account's own snapshot, otherwise that snapshot already reflects the spending.
 */
function applyFundingLegs(balanceRecords,records,year){
  const fundingRecords=(records||[]).filter(record=>!isTransferRecord(record)&&!record.noAccountChange&&record.funding&&record.funding.subcategory);
  if(!fundingRecords.length)return balanceRecords;
  const range=year?fiscalRange(year):null;
  const cutoff=range?range.to:'';
  const snapshots=new Map();
  balanceRecords.forEach(record=>{
    // Only user-entered snapshots gate a funding movement - transfer / funding legs must not.
    if(!isCashRecord(record)||record.syntheticTransferLeg)return;
    const key=cashSubcategoryKey(record.subcategory);
    const effective=cashEffectiveDate(record);
    const snapshot=snapshots.get(key);
    if(!snapshot||effective>snapshot.date)snapshots.set(key,{date:effective,savedAt:String(record.updatedAt||record.createdAt||'')});
  });
  const legs=[];
  for(const record of fundingRecords){
    const date=normalizeExcelDate(record.date)||String(record.date||'').slice(0,10);
    if(cutoff&&date&&date>cutoff)continue;                    // funded in a later Income Year
    const amount=Math.abs(recordAmount(record));
    if(!amount)continue;
    const category=String(record.funding.category||'').trim();
    const subcategory=String(record.funding.subcategory||'').trim();
    const snapshot=snapshots.get(cashSubcategoryKey(subcategory));
    if(snapshot&&snapshot.date&&date){
      if(date<snapshot.date)continue;                                              // snapshot is newer
      if(date===snapshot.date&&snapshot.savedAt>=String(record.updatedAt||record.createdAt||''))continue;
    }
    legs.push({
      id:`${record.id}::funding`,syntheticTransferLeg:true,fundingRecordId:record.id,
      type:'Asset',category,subcategory,particulars:'',accountDetail:'',
      date,incomeYear:record.incomeYear||fiscalYearFromDate(date)||'',
      amount:-amount,balance:-amount,details:'',documentIds:[]
    });
  }
  return legs.length?[...balanceRecords,...legs]:balanceRecords;
}
/** Reduce a record set to its effective balance records for `year`. Transfers and office Cash &
 *  Bank movements never appear as records here - only as signed movements on the accounts they
 *  belong to. */
function effectiveRecordsForBalance(records,year){
  const base=records.filter(r=>!isTransferRecord(r));
  const cash=latestCashRecords(base.filter(isCashRecord), year);
  const carried=base.filter(r=>!isCashRecord(r)&&carriesIntoYear(r,year));
  const withTransfers=applyTransferLegs([...carried,...cash],(state.records||[]).filter(isTransferRecord),year);
  const withFunding=applyFundingLegs(withTransfers,carried,year);
  const withIncome=applyIncomeAccountLegs(applyOfficeAccountLegs(withFunding,year),year);
  return typeof applyWealthPurificationLegs==='function'?applyWealthPurificationLegs(withIncome,year):withIncome;
}

const sumAmount=records=>records.reduce((s,r)=>s+recordAmount(r),0);

/* ---------- "Funded from" picker (Add / Edit record) ------------------------
   Every Asset subcategory can pay for a record. Cash & Bank entries are the usual source, but the
   list also offers the other Asset subcategories (a vehicle bought by selling land, for example).
   -------------------------------------------------------------------------- */
function assetFundingGroups(){
  const groups=new Map();
  const add=(category,subcategory)=>{
    const cat=String(category||'').trim(),sub=String(subcategory||'').trim();
    if(!cat||!sub)return;
    if(!groups.has(cat))groups.set(cat,[]);
    const list=groups.get(cat);
    if(!list.some(name=>name.toLowerCase()===sub.toLowerCase()))list.push(sub);
  };
  orderedCategories('Asset').forEach(category=>(category.subcategories||[]).forEach(subcategory=>add(category.name,subcategory)));
  state.records.forEach(record=>{
    if(record.type==='Asset')add(record.category,record.subcategory);
    if(record.funding)add(record.funding.category,record.funding.subcategory);
  });
  return [...groups.entries()].map(([category,subcategories])=>({category,subcategories}));
}
/** Live balance of every Asset subcategory after transfers and funding (shown next to the option). */
function assetSubcategoryBalances(){
  const balances=new Map();
  effectiveRecordsForBalance(state.records,'').forEach(record=>{
    if(record.type!=='Asset'||!record.subcategory)return;
    const key=assetFundingKey(record.category,record.subcategory);
    balances.set(key,(balances.get(key)||0)+recordAmount(record));
  });
  return balances;
}
/** The selectable funding accounts, keyed by category + subcategory, with their live balance. */
function assetFundingAccounts(){
  const balances=assetSubcategoryBalances(),accounts=new Map();
  assetFundingGroups().forEach(group=>group.subcategories.forEach(subcategory=>{
    const key=assetFundingKey(group.category,subcategory);
    accounts.set(key,{key,category:group.category,subcategory,balance:balances.get(key)||0});
  }));
  return accounts;
}
/** <option> list: None + every Asset subcategory, grouped by category and showing its balance. */
function assetFundingOptionsHtml(accounts){
  const groups=new Map();
  (accounts||new Map()).forEach(account=>{
    if(!groups.has(account.category))groups.set(account.category,[]);
    groups.get(account.category).push(account);
  });
  return `<option value="">None</option>`+[...groups.entries()].map(([category,list])=>
    `<optgroup label="${esc(category)}">${list.map(account=>
      `<option value="${esc(account.key)}">${esc(account.subcategory)} · ${esc(formatMoney(account.balance))}</option>`
    ).join('')}</optgroup>`
  ).join('');
}

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
  updateDashQuickState();
}

/** Keeps the dashboard hero chips + subtitle in sync with the active filters (display only). */
function updateDashQuickState(){
  const host=document.getElementById('dashQuickActions');
  const meta=document.getElementById('dashHeroMeta');
  if(meta){
    const parts=[dashFilters.year?`Fiscal year ${dashFilters.year}`:'All financial years'];
    if(dashFilters.type)parts.push(dashFilters.type==='Asset'?'assets only':'liabilities only');
    if(dashFilters.category)parts.push(dashFilters.category);
    if(dashFilters.from||dashFilters.to)parts.push(`${dashFilters.from?fmtDate(dashFilters.from):'Start'} → ${dashFilters.to?fmtDate(dashFilters.to):'Today'}`);
    meta.textContent=parts.join(' · ');
  }
  if(!host)return;
  const mode=dashFilters.type==='Asset'?'asset':dashFilters.type==='Liability'?'liability':(dashFilters.year?'year':'all');
  host.querySelectorAll('[data-quick]').forEach(btn=>{
    const on=btn.dataset.quick===mode;
    btn.classList.toggle('is-active',on);
    btn.setAttribute('aria-pressed',on?'true':'false');
  });
}

/** Shared active-state handling for the chart option pills. */
function setSegmentedState(group,active){
  if(!group)return;
  group.querySelectorAll('.seg-btn').forEach(btn=>{
    const on=btn===active;
    btn.classList.toggle('is-active',on);
    btn.setAttribute('aria-pressed',on?'true':'false');
  });
}

function refreshDashboardCharts(){
  renderCharts(dashboardBalanceRecords());
  renderIncomeCharts(dashboardIncomeExpenses());
  markEmptyCharts();
}

/**
 * Hero quick filters + per-chart view toggles.
 * Presentation only: every filter still flows through dashFilters -> renderDashboard(), and the
 * calculation functions are untouched, so totals keep matching the rest of the app.
 */
function bindDashboardChartToggles(){
  const quick=document.getElementById('dashQuickActions');
  if(quick)quick.addEventListener('click',event=>{
    const chip=event.target.closest('[data-quick]');
    if(!chip)return;
    const mode=chip.dataset.quick;
    if(mode==='all'){
      Object.assign(dashFilters,{type:'',category:'',subcategory:'',year:'',from:'',to:'',datesAuto:false});
    }else if(mode==='year'){
      const current=fiscalYearFromDate(todayISO());
      const years=dashYearOptions();
      const year=years.includes(current)?current:(years[0]||'');
      Object.assign(dashFilters,{type:'',category:'',subcategory:'',year});
      const range=year?fiscalRange(year):null;
      dashFilters.from=range?range.from:'';
      dashFilters.to=range?range.to:'';
      dashFilters.datesAuto=!!range;
    }else{
      Object.assign(dashFilters,{type:mode==='asset'?'Asset':'Liability',category:'',subcategory:''});
    }
    dashboardPage=1;
    renderDashboardFilters();
    renderDashboard();
  });
  const grid=document.querySelector('#dashboardPage .charts-grid');
  if(!grid)return;
  grid.addEventListener('click',event=>{
    const typeBtn=event.target.closest('[data-chart-type]');
    if(typeBtn){
      const id=typeBtn.dataset.chartType,value=typeBtn.dataset.chartValue;
      if(id==='assetsChart')dashboardChartState.assetType=value;
      else if(id==='liabilitiesChart')dashboardChartState.liabilityType=value;
      else if(id==='netWorthChart')dashboardChartState.netWorthType=value;
      setSegmentedState(typeBtn.parentElement,typeBtn);
      refreshDashboardCharts();
      return;
    }
    const trendBtn=event.target.closest('[data-trend-months]');
    if(trendBtn){
      dashboardChartState.trendMonths=Number(trendBtn.dataset.trendMonths)||12;
      setSegmentedState(trendBtn.parentElement,trendBtn);
      refreshDashboardCharts();
      return;
    }
    const groupBtn=event.target.closest('[data-expense-group]');
    if(groupBtn){
      dashboardChartState.expenseGrouping=groupBtn.dataset.expenseGroup==='category'?'category':'majorHead';
      setSegmentedState(groupBtn.parentElement,groupBtn);
      refreshDashboardCharts();
    }
  });
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
  // Transfer movements are balance adjustments, not ledger rows: reports and the record count must
  // only ever see real records, otherwise totals would be counted twice.
  let records=effectiveRecordsForBalance(dashboardBaseRecords(),year).filter(r=>!r.syntheticTransferLeg);
  if(!datesAuto&&(from||to)){
    records=records.filter(r=>r.date&&inRange(r.date,from,to));
  }
  return records;
}

/** Transfers shown in the Financial Records table. They are deliberately excluded from
 *  getFilteredRecords() (see the balance-neutral note there), so the table merges them back in
 *  themselves - a transfer matches when either side matches the active filters. */
function transferRecordsForDisplay(){
  const {type,category,subcategory,year,from,to,datesAuto}=dashFilters;
  return state.records.filter(isTransferRecord).filter(record=>{
    const sides=[record.transfer&&record.transfer.source,record.transfer&&record.transfer.destination].filter(Boolean);
    if(type&&!sides.some(side=>side.type===type))return false;
    if(category&&!sides.some(side=>side.category===category))return false;
    if(subcategory&&!sides.some(side=>side.subcategory===subcategory))return false;
    if(year&&!recordMatchesYear(record,year))return false;
    if(!datesAuto&&(from||to))return !!(record.date&&inRange(record.date,from,to));
    return true;
  });
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
      return `<article class="mobile-transaction-card ${type}"><span class="mobile-transaction-icon" aria-hidden="true">${catIcon(record.subcategory||category,record.type)}</span><span class="mobile-transaction-copy"><strong>${esc(category)} &gt; ${esc(record.subcategory||'Other')}</strong><span>${esc(dayLabel)}${note?' · '+esc(note):''}</span></span><strong class="mobile-transaction-amount">${esc(amount)}</strong><span class="mobile-transaction-status" aria-label="Completed">✓</span></article>`;
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
      return `<article class="mobile-transaction-card ${type}"><span class="mobile-transaction-icon">${catIcon(r.subcategory||category,r.type)}</span><span class="mobile-transaction-copy"><strong>${esc(category)} &gt; ${esc(r.subcategory||'Other')}</strong><span>${esc(subtitle)}</span></span><strong class="mobile-transaction-amount">${esc(signedAmount)}</strong><span class="mobile-transaction-status" aria-label="Completed">✓</span></article>`;
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
  document.getElementById('mobileShortcuts').innerHTML=mobileQuickShortcuts.map((shortcut,i)=>`<div class="mobile-shortcut-row" style="--action-index:${i}"><button type="button" class="speed-action mobile-shortcut-action" data-mobile-shortcut="${i}" title="${esc(shortcut.category)} > ${esc(shortcut.subcategory||'')}"><span class="speed-action-icon">${shortcut.type==='Income'?'↗':'↘'}</span><span>${catIcon(shortcut.subcategory||shortcut.category,shortcut.type,{size:16})}${esc(shortcut.category)} &gt; ${esc(shortcut.subcategory||'Other')}</span></button><button type="button" class="mobile-shortcut-dismiss" data-dismiss-shortcut="${esc(shortcut.key)}" aria-label="Dismiss ${esc(shortcut.category)} shortcut">×</button></div>`).join('');
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
/* Dashboard chart view state - presentation only, never touches financial data. */
const dashboardChartState={assetType:'bar',liabilityType:'pie',netWorthType:'line',trendMonths:12,expenseGrouping:'majorHead'};
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
  return {dark,text:dark?'#a8b3d1':'#64748b',grid:dark?'rgba(148,163,184,.14)':'rgba(15,23,42,.07)'};
}
const CHART_COLORS=['#6366f1','#10b981','#f59e0b','#0ea5e9','#ec4899','#8b5cf6','#14b8a6','#f97316'];
const LIABILITY_COLORS=['#f43f5e','#fb923c','#a78bfa','#38bdf8','#facc15'];

/** Rich, theme-aware tooltip shared by every dashboard chart; values reuse formatMoney(). */
function chartTooltip(theme,{share=false}={}){
  return {
    backgroundColor:theme.dark?'rgba(8,12,26,.96)':'rgba(15,23,42,.94)',
    titleColor:'#fff',bodyColor:theme.dark?'#dbe3f5':'#e9eefb',
    borderColor:theme.dark?'rgba(148,163,184,.3)':'rgba(255,255,255,.16)',borderWidth:1,
    padding:12,cornerRadius:12,boxPadding:5,usePointStyle:true,displayColors:true,
    titleFont:{weight:'700',size:12},bodyFont:{weight:'600',size:12},bodySpacing:6,
    callbacks:{
      label:ctx=>{
        const parsed=ctx.parsed;
        const raw=parsed&&typeof parsed==='object'?(parsed.y??parsed.x??0):parsed;
        const value=Number(raw)||0;
        const values=Array.isArray(ctx.dataset&&ctx.dataset.data)?ctx.dataset.data:[];
        const total=values.reduce((sum,v)=>sum+(Number(v)||0),0);
        const suffix=share&&total>0?` · ${((value/total)*100).toFixed(1)}%`:'';
        return `${ctx.dataset.label?ctx.dataset.label+': ':''}${formatMoney(value)}${suffix}`;
      }
    }
  };
}
/** Soft vertical gradient used by the net-worth line/bar fill. */
function areaFill(ctx,rgb){
  const chart=ctx&&ctx.chart;
  const area=chart&&chart.chartArea;
  if(!area)return `rgba(${rgb},.16)`;
  const gradient=chart.ctx.createLinearGradient(0,area.top,0,area.bottom);
  gradient.addColorStop(0,`rgba(${rgb},.34)`);
  gradient.addColorStop(1,`rgba(${rgb},0)`);
  return gradient;
}
function baseChartOptions(theme){
  return {
    maintainAspectRatio:false,responsive:true,
    animation:{duration:reducedMotion()?0:900,easing:'easeOutQuart'},
    interaction:{mode:'index',intersect:false},
    layout:{padding:{top:2,right:2,bottom:0,left:0}},
    plugins:{tooltip:chartTooltip(theme)}
  };
}
function chartLegend(theme){
  return {position:'bottom',labels:{usePointStyle:true,boxWidth:8,boxHeight:8,padding:14,color:theme.text,font:{weight:'600'}}};
}
function chartScales(theme){
  return {
    x:{grid:{display:false},border:{display:false},ticks:{color:theme.text,maxRotation:0,autoSkipPadding:8}},
    y:{beginAtZero:true,grid:{color:theme.grid,drawTicks:false},border:{display:false},ticks:{color:theme.text,padding:8,maxTicksLimit:6}}
  };
}

function renderCharts(records){
  const assets=sumAmount(records.filter(r=>r.type==='Asset'));
  const liabilities=sumAmount(records.filter(r=>r.type==='Liability'));
  destroyChart('comparisonChart');destroyChart('assetsChart');destroyChart('liabilitiesChart');destroyChart('netWorthChart');
  if(!window.Chart)return;
  const theme=chartTheme();
  Chart.defaults.color=theme.text;
  Chart.defaults.borderColor=theme.grid;
  Chart.defaults.font.family="'Plus Jakarta Sans','Inter',system-ui,sans-serif";
  const base=baseChartOptions(theme);
  const legend=chartLegend(theme);
  const scales=chartScales(theme);
  const circleInteraction={mode:'nearest',intersect:true};

  charts.comparisonChart=new Chart(document.getElementById('comparisonChart'),{type:'doughnut',data:{labels:['Assets','Liabilities'],datasets:[{data:[assets,liabilities],backgroundColor:['#10b981','#f43f5e'],hoverBackgroundColor:['#34d399','#fb7185'],borderWidth:0,spacing:3,hoverOffset:10}]},options:Object.assign({},base,{cutout:'68%',interaction:circleInteraction,plugins:{legend,tooltip:chartTooltip(theme)}})});

  const group=(type)=>Object.entries(records.filter(r=>r.type===type).reduce((out,r)=>{out[r.category]=(out[r.category]||0)+recordAmount(r);return out},{}));
  const assetsGroup=group('Asset'),liabilitiesGroup=group('Liability');
  const categoryChart=(id,type,entries,colors)=>{
    const canvas=document.getElementById(id);
    if(!canvas)return;
    const isCircle=type==='doughnut'||type==='pie';
    const rows=entries.slice().sort((a,b)=>b[1]-a[1]);
    const options=Object.assign({},base,isCircle
      ?{cutout:type==='doughnut'?'64%':undefined,interaction:circleInteraction,plugins:{legend,tooltip:chartTooltip(theme,{share:true})}}
      :{scales,plugins:{legend:{display:false},tooltip:chartTooltip(theme,{share:true})}});
    charts[id]=new Chart(canvas,{type,data:{labels:rows.map(x=>x[0]),datasets:[{
      data:rows.map(x=>x[1]),
      backgroundColor:rows.map((x,i)=>colors[i%colors.length]),
      borderWidth:0,borderSkipped:false,
      hoverOffset:isCircle?9:0,
      borderRadius:isCircle?0:10,
      maxBarThickness:isCircle?undefined:52
    }]},options});
  };
  categoryChart('assetsChart',dashboardChartState.assetType==='doughnut'?'doughnut':'bar',assetsGroup,CHART_COLORS);
  categoryChart('liabilitiesChart',dashboardChartState.liabilityType==='bar'?'bar':'pie',liabilitiesGroup,LIABILITY_COLORS);

  const trendSource=dashboardBaseRecords();
  const byYear=[...new Set(trendSource.map(r=>normIncomeYear(r.incomeYear||'')).filter(Boolean))].sort();
  const trend=byYear.map(year=>{
    const recs=effectiveRecordsForBalance(trendSource,year);
    return sumAmount(recs.filter(r=>r.type==='Asset'))-sumAmount(recs.filter(r=>r.type==='Liability'));
  });
  const netType=dashboardChartState.netWorthType==='bar'?'bar':'line';
  const netDataset=netType==='bar'
    ?{label:'Net Worth',data:trend,backgroundColor:ctx=>areaFill(ctx,'99,102,241'),hoverBackgroundColor:'#818cf8',borderRadius:10,borderSkipped:false,maxBarThickness:46}
    :{label:'Net Worth',data:trend,borderColor:'#6366f1',backgroundColor:ctx=>areaFill(ctx,'99,102,241'),fill:true,tension:.4,borderWidth:2.5,pointRadius:4,pointHoverRadius:7,pointBackgroundColor:'#6366f1',pointBorderColor:'#ffffff',pointBorderWidth:2};
  charts.netWorthChart=new Chart(document.getElementById('netWorthChart'),{type:netType,data:{labels:byYear,datasets:[netDataset]},options:Object.assign({},base,{scales,plugins:{legend:{display:false},tooltip:chartTooltip(theme)}})});
}

function docsOf(record){
  return (record.documentIds||[]).map(id=>state.documents.find(d=>d.id===id)).filter(Boolean);
}
/** PDFs for any record; a transfer also honours the legacy recordId link. */
function docsFor(record){
  return isTransferRecord(record)?transferDocsOf(record):docsOf(record);
}
function shortName(name,max=16){
  const base=String(name||'document.pdf');
  return base.length>max?base.slice(0,max-4)+'…pdf':base;
}
/** Clickable PDF badges shown on table rows / record cards. Transfers carry an explicit PDF tag. */
function docChips(record,max=2){
  const docs=docsFor(record);
  if(!docs.length)return '';
  const transfer=isTransferRecord(record);
  const shown=docs.slice(0,max).map(d=>`<button type="button" class="doc-chip${transfer?' transfer-pdf-chip':''}" data-cmd="open-pdf" data-id="${esc(d.id)}" title="View ${esc(d.name||d.title||'PDF')}">${icon('file')}${transfer?'<span class="pdf-chip-tag">PDF</span>':''}<span>${esc(shortName(d.name||d.title))}</span></button>`).join('');
  const more=docs.length>max?`<button type="button" class="doc-chip more" data-cmd="view-record" data-id="${esc(record.id)}" title="Show all documents">+${docs.length-max} more</button>`:'';
  return shown+more;
}
/** Attached-PDF block shared by the record and transfer detail views. */
function documentViewSection(record){
  const documents=docsFor(record);
  if(!documents.length)return '';
  return `<label class="full document-view-section">Attached PDF Documents
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
    </label>`;
}

function renderDashboardTable(){
  let records=getFilteredRecords();
  const transfers=transferRecordsForDisplay();
  if(transfers.length)records=[...records,...transfers];
  const search=document.getElementById('dashboardSearch').value.toLowerCase();
  if(search) records=records.filter(r=>Object.values(r).some(v=>String(v).toLowerCase().includes(search)));
  records.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||recordTitle(a).localeCompare(recordTitle(b)));
  const pageSize=10, pages=Math.max(1,Math.ceil(records.length/pageSize));
  dashboardPage=Math.min(dashboardPage,pages);
  const pageRecords=records.slice((dashboardPage-1)*pageSize,dashboardPage*pageSize);
  document.getElementById('recordCount').textContent=`${records.length} record${records.length===1?'':'s'} found`;
  document.getElementById('dashboardTable').innerHTML=`<thead><tr><th scope="col">Type</th><th scope="col">Date</th><th scope="col">Category</th><th scope="col">Subcategory</th><th scope="col">Particulars</th><th scope="col">Details</th><th scope="col">Income Year</th><th scope="col" class="num">Balance / Amount</th><th scope="col">Documents</th><th scope="col">Action</th></tr></thead><tbody>${pageRecords.map((r,i)=>{
    const meta=isTransferRecord(r)?transferMetaLabel(r):recordMeta(r);
    const id=esc(r.id);
    return `<tr style="--i:${i}"><td><span class="badge ${r.type.toLowerCase()}">${esc(r.type)}</span>${isTransferRecord(r)?' <span class="badge transfer">Transfer</span>':''}</td><td>${esc(fmtDate(r.date)||'—')}</td><td>${catLabel(r.category,r.type)}</td><td>${catLabel(r.subcategory,r.type)}</td><td><strong>${esc(recordTitle(r))}</strong>${meta?`<span class="muted-sub">${esc(meta)}</span>`:''}</td><td>${esc(r.details||'—')}</td><td>${esc(r.incomeYear||'—')}</td><td class="num"><strong>${formatMoney(recordAmount(r))}</strong></td><td><div class="doc-cell">${docChips(r)||'<span class="doc-none">—</span>'}</div></td><td class="actions-cell"><button type="button" class="action-link" data-cmd="view-record" data-id="${id}">View</button><button type="button" class="action-link" data-cmd="edit-record" data-id="${id}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-record" data-id="${id}">Delete</button></td></tr>`;
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
   Amount calculator - explicit tokenizer + recursive-descent parser.
   Every amount keystroke is parsed here; eval() is never used, so a bad
   expression can only produce an inline error message, never run code.
   ========================================================================== */
class CalcError extends Error {}

/* ---------- Safe arithmetic core (pure functions, DOM-free) ---------- */
/** Evaluates +,-,*,/ with normal precedence. Incomplete input ("12+") previews as 12. */
function calcEvaluate(expression){
  const source=String(expression??'').replace(/\s+/g,'');
  if(!source)return {ok:true,value:0};
  const tokens=[];
  for(let index=0;index<source.length;){
    const char=source[index];
    if((char>='0'&&char<='9')||char==='.'){
      let literal='';
      while(index<source.length&&((source[index]>='0'&&source[index]<='9')||source[index]==='.'))literal+=source[index++];
      if((literal.match(/\./g)||[]).length>1)return {ok:false,error:'Invalid number'};
      const value=Number(literal);
      if(!Number.isFinite(value))return {ok:false,error:'Invalid number'};
      tokens.push({type:'number',value});
      continue;
    }
    if(char==='+'||char==='-'||char==='*'||char==='/'||char==='×'||char==='÷'){
      tokens.push({type:'operator',value:char==='×'?'*':char==='÷'?'/':char});
      index++;
      continue;
    }
    return {ok:false,error:'Unsupported character'};
  }
  if(!tokens.length)return {ok:true,value:0};
  let position=0;
  const peek=()=>tokens[position];
  const parseFactor=()=>{
    const token=tokens[position];
    if(!token)throw new CalcError('Incomplete expression');
    if(token.type==='operator'&&(token.value==='-'||token.value==='+')){
      position++;
      const value=parseFactor();
      return token.value==='-'?-value:value;
    }
    if(token.type!=='number')throw new CalcError('Incomplete expression');
    position++;
    return token.value;
  };
  const parseTerm=()=>{
    let value=parseFactor();
    while(peek()&&peek().type==='operator'&&(peek().value==='*'||peek().value==='/')){
      const operator=tokens[position++].value;
      if(!peek())return value;
      const operand=parseFactor();
      if(operator==='/'){if(operand===0)throw new CalcError('Cannot divide by zero');value/=operand}
      else value*=operand;
    }
    return value;
  };
  const parseExpression=()=>{
    let value=parseTerm();
    while(peek()&&peek().type==='operator'&&(peek().value==='+'||peek().value==='-')){
      const operator=tokens[position++].value;
      if(!peek())return value;
      const operand=parseTerm();
      value=operator==='+'?value+operand:value-operand;
    }
    return value;
  };
  try{
    const value=parseExpression();
    if(peek())return {ok:false,error:'Incomplete expression'};
    if(!Number.isFinite(value))return {ok:false,error:'Result is too large'};
    return {ok:true,value};
  }catch(error){
    return {ok:false,error:error instanceof CalcError?error.message:'Invalid expression'};
  }
}
/** Rounds to 2 decimals (both amount inputs use step="0.01") and drops trailing zeros. */
function calcFormat(value){
  if(!Number.isFinite(value))return '0';
  const rounded=Math.round((value+Number.EPSILON)*100)/100;
  if(rounded===0)return '0';
  return rounded.toFixed(2).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1');
}

/* ---------- Calculator popover (UI) ---------- */
const calcState={target:'',expression:'',result:0,evaluated:false,equalsShown:false};

function calcTargetInput(){
  return calcState.target?document.getElementById(calcState.target):null;
}
/** Grouped number for the display only - the field always receives a plain numeric string. */
function calcDisplay(value){
  const plain=calcFormat(value);
  const number=Number(plain);
  if(!Number.isFinite(number))return '0';
  try{return number.toLocaleString(state.settings.locale||'en-BD',{maximumFractionDigits:2})}
  catch(error){return plain}
}
function calcPrettyExpression(expression){
  return String(expression).replace(/\//g,' ÷ ').replace(/\*/g,' × ').replace(/\+/g,' + ').replace(/-/g,' − ').replace(/\s+/g,' ').trim();
}
function updateCalcDisplay(){
  const pop=document.getElementById('calcPopover');
  const expressionEl=document.getElementById('calcExpression');
  const valueEl=document.getElementById('calcValue');
  if(!pop||!expressionEl||!valueEl)return;
  let expressionText='';
  let valueText='0';
  let error='';
  if(calcState.evaluated){
    expressionText=calcState.expression?`${calcPrettyExpression(calcState.expression)}${calcState.equalsShown?' =':''}`:'';
    valueText=calcDisplay(calcState.result);
  }else if(calcState.expression){
    const outcome=calcEvaluate(calcState.expression);
    expressionText=calcPrettyExpression(calcState.expression);
    if(outcome.ok)valueText=calcDisplay(outcome.value);
    else if(outcome.error==='Incomplete expression')valueText='0';   // "12+" previews as 12
    else{valueText=outcome.error;error=outcome.error}
  }
  expressionEl.textContent=expressionText;
  valueEl.textContent=valueText;
  valueEl.classList.toggle('error',!!error);
  const apply=document.getElementById('calcApply');
  if(apply)apply.disabled=!!error;
}
/** Keeps the pad attached to its field and inside the visible viewport (mobile included). */
function positionCalcPopover(){
  const pop=document.getElementById('calcPopover');
  const input=calcTargetInput();
  if(!pop||!pop.open||!input)return;
  const viewport=window.visualViewport;
  const viewWidth=viewport?viewport.width:window.innerWidth;
  const viewHeight=viewport?viewport.height:window.innerHeight;
  const viewLeft=viewport?viewport.offsetLeft:0;
  const viewTop=viewport?viewport.offsetTop:0;
  const margin=8;
  const width=pop.offsetWidth||268;
  const height=pop.offsetHeight||340;
  const rect=input.getBoundingClientRect();
  const left=Math.min(Math.max(rect.right-width,viewLeft+margin),viewLeft+viewWidth-width-margin);
  let top=rect.bottom+margin;
  if(top+height>viewTop+viewHeight-margin){
    const above=rect.top-height-margin;
    top=above>=viewTop+margin?above:viewTop+margin;
  }
  // Final clamp: a field near the bottom can otherwise leave the pad half off-screen.
  const maxTop=viewTop+viewHeight-height-margin;
  top=maxTop>=viewTop+margin?Math.min(top,maxTop):viewTop+margin;
  pop.style.left=`${Math.round(left)}px`;
  pop.style.top=`${Math.round(top)}px`;
}
function openCalculator(targetId,trigger){
  const pop=document.getElementById('calcPopover');
  const input=document.getElementById(targetId);
  if(!pop||!input)return;
  if(pop.open&&calcState.target===targetId){closeCalculator();return}
  if(pop.open)pop.close();
  const button=trigger||document.querySelector(`[data-calc-target="${targetId}"]`);
  const current=input.value.trim();
  const numeric=Number(current);
  const hasValue=current!==''&&Number.isFinite(numeric);
  calcState.target=targetId;
  calcState.expression=hasValue?calcFormat(numeric):'';
  calcState.result=hasValue?Number(calcFormat(numeric)):0;
  calcState.evaluated=hasValue;              // a first digit replaces the stored amount
  calcState.equalsShown=false;
  document.querySelectorAll('.calc-trigger[aria-expanded="true"]').forEach(item=>item.setAttribute('aria-expanded','false'));
  if(button)button.setAttribute('aria-expanded','true');
  updateCalcDisplay();
  // A field near the bottom of a scrolling modal must be visible before the pad is anchored.
  try{input.scrollIntoView({block:'nearest',inline:'nearest'})}catch(error){}
  pop.showModal();
  positionCalcPopover();
  pop.focus({preventScroll:true});
}
function closeCalculator(){
  const pop=document.getElementById('calcPopover');
  if(pop&&pop.open)pop.close();
}

/* ---------- Calculator input handling ---------- */
function applyCalcValue(){
  const input=calcTargetInput();
  if(!input)return;
  let value;
  if(calcState.evaluated)value=calcState.result;
  else{
    const outcome=calcEvaluate(calcState.expression);
    if(!outcome.ok)return;                   // divide-by-zero stays visible, nothing is written
    value=outcome.value;
  }
  if(!Number.isFinite(value))return;
  const text=calcFormat(value);
  closeCalculator();
  input.value=text;
  // Dependent form logic listens for these: amountTouched, validation, summaries...
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
  window.setTimeout(()=>{try{input.focus({preventScroll:true})}catch(error){input.focus()}},0);
}
function calcPress(key){
  if(key==='clear'){
    Object.assign(calcState,{expression:'',result:0,evaluated:false,equalsShown:false});
    updateCalcDisplay();
    return;
  }
  if(key==='back'){
    if(calcState.evaluated){calcState.expression=calcFormat(calcState.result);calcState.evaluated=false}
    calcState.expression=calcState.expression.slice(0,-1);
    calcState.equalsShown=false;
    updateCalcDisplay();
    return;
  }
  if(key==='equals'){
    const outcome=calcEvaluate(calcState.expression);
    if(!outcome.ok){calcState.evaluated=false;calcState.equalsShown=false;updateCalcDisplay();return}
    calcState.result=outcome.value;
    calcState.evaluated=true;
    calcState.equalsShown=!!calcState.expression;
    updateCalcDisplay();
    return;
  }
  if(key==='.'){
    if(calcState.evaluated){calcState.expression='0.';calcState.evaluated=false}
    else{
      const segment=(calcState.expression.match(/(?:^|[+\-*/])(\d*\.?\d*)$/)||[])[1]||'';
      if(segment.includes('.'))return;
      calcState.expression+=segment===''?'0.':'.';
    }
    calcState.equalsShown=false;
    updateCalcDisplay();
    return;
  }
  if(/^[0-9]$/.test(key)){
    if(calcState.evaluated){calcState.expression='';calcState.evaluated=false}
    if(calcState.expression.length>=32)return;
    if(calcState.expression==='0')calcState.expression='';
    calcState.expression+=key;
    calcState.equalsShown=false;
    updateCalcDisplay();
    return;
  }
  if(key==='+'||key==='-'||key==='*'||key==='/'){
    if(calcState.evaluated){calcState.expression=calcFormat(calcState.result);calcState.evaluated=false}
    if(!calcState.expression){if(key==='-'){calcState.expression='-';calcState.equalsShown=false;updateCalcDisplay()}return}
    if(calcState.expression==='-'&&key!=='-')return;
    const last=calcState.expression.slice(-1);
    if(last==='+'||last==='-'||last==='*'||last==='/'){
      if(key==='-'&&(last==='*'||last==='/'))calcState.expression+='-';
      else calcState.expression=calcState.expression.slice(0,-1)+key;
    }else{
      calcState.expression+=key;
    }
    calcState.equalsShown=false;
    updateCalcDisplay();
  }
}
function handleCalcKeydown(event){
  if(event.key==='Enter'){
    if(event.target.closest&&event.target.closest('button'))return;   // the focused button applies itself
    event.preventDefault();
    applyCalcValue();
    return;
  }
  if(event.key==='Backspace'){event.preventDefault();calcPress('back');return}
  if(event.key==='Delete'){event.preventDefault();calcPress('clear');return}
  if(event.key==='Escape')return;                                    // the dialog closes itself
  if(/^[0-9]$/.test(event.key)){event.preventDefault();calcPress(event.key);return}
  if(event.key==='.'||event.key===','){event.preventDefault();calcPress('.');return}
  if(event.key==='='){event.preventDefault();calcPress('equals');return}
  if(event.key==='+'||event.key==='-'||event.key==='*'||event.key==='/'||event.key==='x'||event.key==='X'){
    event.preventDefault();
    calcPress(event.key==='x'||event.key==='X'?'*':event.key);
  }
}
function bindCalculator(){
  const pop=document.getElementById('calcPopover');
  if(!pop)return;
  // Delegated so the trigger works on every generated form.
  document.addEventListener('click',event=>{
    const trigger=event.target.closest('[data-calc-target]');
    if(!trigger)return;
    event.preventDefault();
    openCalculator(trigger.dataset.calcTarget,trigger);
  });
  pop.addEventListener('click',event=>{
    if(event.target.closest('[data-calc-close]')){closeCalculator();return}
    if(event.target===pop){closeCalculator();return}                 // backdrop click
    if(event.target.closest('#calcApply')){applyCalcValue();return}
    const key=event.target.closest('[data-calc-key]');
    if(key)calcPress(key.dataset.calcKey);
  });
  pop.addEventListener('keydown',handleCalcKeydown);
  pop.addEventListener('close',()=>{
    if(pop.open)return;                       // a close() used for re-targeting must not clear the new state
    document.querySelectorAll('.calc-trigger[aria-expanded="true"]').forEach(item=>item.setAttribute('aria-expanded','false'));
  });
  const reposition=()=>{if(pop.open)positionCalcPopover()};
  window.addEventListener('resize',reposition);
  window.addEventListener('scroll',reposition,true);                 // capture: the modal body scrolls
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',reposition);
    window.visualViewport.addEventListener('scroll',reposition);
  }
  ['recordModal','incomeModal'].forEach(id=>{
    const modal=document.getElementById(id);
    if(modal)modal.addEventListener('close',()=>closeCalculator());
  });
}

/* ==========================================================================
   Add / Edit record modal - fields adapt to Type > Category > Subcategory
   ========================================================================== */
let formState={draft:{},schema:GENERIC_SCHEMA,amountTouched:false,yearTouched:false,particularsAuto:''};

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
    return `<label>${esc(f.label)}${star}<select ${base}>${options.map(o=>`<option value="${esc(o)}" ${o===selected?'selected':''}>${o===''?'— None —':esc(o)}</option>`).join('')}</select></label>`;
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
/**
 * Cash & Bank keeps the account name in the Subcategory, so Particulars / Name follows it.
 * `overwrite` is only true when the Subcategory was just chosen by the user; re-renders (opening
 * the sheet, switching category) keep a name that was typed by hand. A value that we auto-filled
 * ourselves, or that is still empty, is always refreshed so validation and form state stay in sync.
 */
function syncCashBankParticulars(overwrite=false){
  const typeSelect=document.getElementById('recordType');
  const categorySelect=document.getElementById('recordCategory');
  const subSelect=document.getElementById('recordSubcategory');
  const input=document.getElementById('f_particulars');
  const active=!!typeSelect&&!!categorySelect&&typeSelect.value==='Asset'&&isCashBankCategoryName(categorySelect.value);
  const subcategory=active&&subSelect?String(subSelect.value||'').trim():'';
  // Away from Cash & Bank (or with no subcategory) nothing is written: manual input stays as it is.
  if(!active||!subcategory||!input)return;
  const current=String(input.value??'');
  const auto=String(formState.particularsAuto||'');
  // A custom name is never replaced until the Subcategory itself is chosen again.
  if(!overwrite&&current.trim()&&current!==auto)return;
  formState.particularsAuto=subcategory;
  formState.draft.particulars=subcategory;
  if(current===subcategory)return;                 // already in sync: nothing to apply
  input.value=subcategory;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}
/** Land: Amount / Balance follows Current Market Value (fallback Purchase Value) until edited by hand. */
function syncAmountFromValues(){
  if(formState.amountTouched)return;
  const market=Number(formState.draft.currentMarketValue)||0,purchase=Number(formState.draft.purchaseValue)||0;
  const value=market||purchase;
  document.getElementById('recordAmount').value=value?String(value):'';
}

function openRecordModal(id=null){
  const existing=id?state.records.find(r=>r.id===id):null;
  if(existing&&isTransferRecord(existing)){openTransferModal(existing.id);return}   // transfers have their own sheet
  editingRecordId=id;
  const record=existing;
  resetDocDraft(record);
  formState={draft:{},schema:GENERIC_SCHEMA,amountTouched:false,yearTouched:!!record?.incomeYear,particularsAuto:'',fundingAccounts:assetFundingAccounts()};
  if(record)MANAGED_KEYS.forEach(k=>{if(record[k]!==undefined)formState.draft[k]=record[k]});
  document.querySelector('#recordForm .modal-foot').innerHTML='<button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn btn-primary">Save Record</button>';
  document.querySelectorAll('#recordForm [data-close-modal]').forEach(button=>button.onclick=()=>document.getElementById('recordModal').close());
  document.getElementById('recordModalTitle').textContent=record?'Edit Financial Record':'Add Financial Record';
  document.getElementById('recordModalSubtitle').textContent=record?`${record.category} / ${record.subcategory}`:'Fields adapt to the selected category and subcategory';
  const startType=record?.type||'Asset';
  const amountValue=record?recordAmount(record):'';
  document.getElementById('recordFormFields').innerHTML=`<div class="form-grid">
    <label><span class="lbl">Financial Type *</span><select id="recordType" required><option value="Asset" ${startType==='Asset'?'selected':''}>Asset</option><option value="Liability" ${startType==='Liability'?'selected':''}>Liability</option></select></label>
    <label><span class="lbl">Category *</span><select id="recordCategory" required></select></label>
    <label><span class="lbl">Subcategory *</span><select id="recordSubcategory" required></select></label>
    <label><span class="lbl">Date</span><input id="recordDate" type="date" value="${esc(record?record.date||'':todayISO())}"></label>
    <div class="form-section" id="subSectionTitle">Details</div>
    <div class="sub-fields" id="subFields"></div>
    <label class="full"><span id="detailsLabelText">Details / Description</span><textarea id="recordDetails" rows="3">${esc(record?.details||record?.description||'')}</textarea><span class="hint" id="detailsHint"></span></label>
    <label><span class="lbl">Amount / Balance *</span><span class="calc-field"><input id="recordAmount" type="number" step="0.01" inputmode="decimal" required value="${esc(amountValue===0?'0':amountValue)}" placeholder="0.00"><button type="button" class="calc-trigger" data-calc-target="recordAmount" aria-label="Open calculator for Amount / Balance" aria-haspopup="dialog" aria-controls="calcPopover" aria-expanded="false" title="Calculator"><svg class="ic" aria-hidden="true"><use href="#i-calc"/></svg></button></span><span class="hint" id="amountHint"></span></label>
    <label class="full record-funding-field" id="recordFundingField">Funded from Asset Subcategory
      <select id="recordFunding">${assetFundingOptionsHtml(formState.fundingAccounts)}</select>
      <span class="hint" id="recordFundingHint"></span>
    </label>
    <div class="full record-funding-field" id="recordNoAccountField"><label class="office-account-check"><span class="office-check-row"><input type="checkbox" id="recordNoAccountChange" ${record?.noAccountChange?'checked':''}><span>I Do not want to change Account</span></span></label></div>
    <label><span class="lbl">Document (PDF)</span><input id="recordDocument" type="file" accept=".pdf,application/pdf" multiple><span class="hint">You can attach more than one PDF.</span></label>
    <div class="doc-manager" id="docManager"><h4>Attached documents</h4><div class="doc-list" id="docManagerList"></div></div>
  </div>`;

  const typeSelect=document.getElementById('recordType'),categorySelect=document.getElementById('recordCategory'),subSelect=document.getElementById('recordSubcategory');
  const dateInput=document.getElementById('recordDate'),amountInput=document.getElementById('recordAmount');
  const fundingField=document.getElementById('recordFundingField'),fundingSelect=document.getElementById('recordFunding'),fundingHint=document.getElementById('recordFundingHint');
  const noAccountField=document.getElementById('recordNoAccountField'),noAccountBox=document.getElementById('recordNoAccountChange');
  const fundingDefaultHint='Optional — the amount is deducted from this Asset subcategory. Leave None for no change.';
  const describeFunding=()=>{
    const account=fundingSelect.value?formState.fundingAccounts.get(fundingSelect.value):null;
    // The "do not change" tick only makes sense once a funding source is chosen.
    if(noAccountField)noAccountField.classList.toggle('hidden',!account||fundingField.classList.contains('hidden'));
    if(!account){fundingHint.textContent=fundingDefaultHint;return}
    fundingHint.innerHTML=`${catIcon(account.subcategory,'Asset')}${esc(account.category)} / ${esc(account.subcategory)} · Balance ${formatMoney(account.balance)} — ${noAccountBox&&noAccountBox.checked?'kept for reference only; the balance is not changed.':'the record amount is deducted here.'}`;
  };
  const syncFunding=()=>{
    // Cash & Bank records are already the money itself, so they never get a funding source.
    const cash=typeSelect.value==='Asset'&&isCashCategoryName(categorySelect.value);
    fundingField.classList.toggle('hidden',cash);
    fundingSelect.disabled=cash;
    if(cash)fundingSelect.value='';
    describeFunding();
  };
  if(record?.funding?.subcategory)fundingSelect.value=assetFundingKey(record.funding.category,record.funding.subcategory);
  fundingSelect.onchange=describeFunding;
  if(noAccountBox)noAccountBox.onchange=describeFunding;

  const updateCategories=(keepCategory)=>{
    const filtered=state.categories.filter(c=>c.type===typeSelect.value);
    const wanted=keepCategory||categorySelect.value;
    categorySelect.innerHTML=filtered.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    if(filtered.some(c=>c.name===wanted))categorySelect.value=wanted;
    setFieldIcon('recordCategory',categorySelect.value,typeSelect.value);
    updateSubcategories(keepCategory===record?.category?record?.subcategory:undefined);
  };
  const updateSubcategories=(keepSub)=>{
    const category=state.categories.find(c=>c.type===typeSelect.value&&c.name===categorySelect.value);
    // A category without subcategories must not make the form impossible to submit:
    // fall back to the category name so the record can still be saved.
    const subs=(category?.subcategories||[]).length?category.subcategories:[categorySelect.value].filter(Boolean);
    subSelect.innerHTML=subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if(keepSub&&subs.includes(keepSub))subSelect.value=keepSub;
    setFieldIcon('recordSubcategory',subSelect.value,typeSelect.value);
    renderSubFields();
    syncCashBankParticulars();
    syncFunding();
  };
  typeSelect.onchange=()=>updateCategories();
  categorySelect.onchange=()=>updateSubcategories();
  // Choosing a Cash & Bank subcategory renames Particulars / Name (a hand-typed name is kept for
  // every other category and for subcategory moves made by reopening the sheet).
  subSelect.onchange=()=>{
    renderSubFields();
    syncCashBankParticulars(true);
  };
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

/** Assets Deduction (Gift / Loss / Damage): the item leaves Assets and is booked as an Expense under
 *  Loss Deduction -> Other Expense -> Furniture, Electronics & Equipments -> Gift / Loss / Damage. */
function isDeductibleAsset(r){return !!r&&r.type==='Asset'&&r.category==='Other Assets'&&r.subcategory===DEDUCTION_ITEM_LABEL&&!isTransferRecord(r)}
async function deductAssetItem(id,deduction){
  const r=state.records.find(x=>x.id===id);
  if(!r||!ASSET_DEDUCTIONS.includes(deduction))return;
  if(!await confirm(`Deduct "${recordTitle(r)}" (${formatMoney(recordAmount(r))}) from Assets as ${deduction}? It will be recorded under Expenses -> ${DEDUCTION_MAJOR_HEAD}.`,'Assets Deduction')){renderRecordSections();return}
  try{
    await applyAssetDeduction(Object.assign({},r),deduction,r);
    await loadState();renderAll();
    toast(`Moved to Expenses -> ${DEDUCTION_MAJOR_HEAD} (${deduction})`);
  }catch(error){console.error(error);toast('Could not deduct the item'+(error.message?` — ${error.message}`:''),true);renderRecordSections()}
}
async function applyAssetDeduction(record,deduction,old){
  const cls=ensureIncomeClass('Expense',DEDUCTION_MAJOR_HEAD,DEDUCTION_CATEGORY,deduction);
  await putMany('incomeGroups',state.incomeGroups);
  await persistCategoryStructure();
  const date=todayISO();
  const amount=Math.abs(recordAmount(record));
  // The record leaves the Assets totals, which would refund its funding account, so the same account is charged by the expense.
  const fundingName=record.funding&&!record.noAccountChange?record.funding.subcategory:'';
  const configured=fundingName?officeAccountOption(fundingName):null;
  const expense={
    id:uid('ie'),type:'Expense',date,incomeYear:fiscalYearFromDate(date),
    majorHead:cls.majorHead,category:cls.category,subcategory:cls.subcategory,
    amount,account:configured?configured.label:'',
    description:[recordTitle(record),record.itemCategory,deduction].filter(Boolean).join(' · ')+(record.details?` — ${record.details}`:''),
    assetDeduction:{reason:deduction,date,recordId:record.id},
    documentIds:[],
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
  };
  if(!configured)expense.noAccountChange=true;
  await put('incomeExpenses',expense);
  // The record (and its PDFs) is kept, only flagged, so it can be viewed or recovered later.
  record.assetDeduction={reason:deduction,date,expenseId:expense.id};
  record.updatedAt=new Date().toISOString();
  await put('records',record);
}
async function recoverDeductedAsset(id){
  const r=(state.deductedRecords||[]).find(x=>x.id===id);
  if(!r)return;
  if(!await confirm(`Recover "${recordTitle(r)}" back to Assets? The ${r.assetDeduction.reason} expense entry will be removed.`,'Recover Asset'))return;
  try{
    const expense=state.incomeExpenses.find(e=>e.id===r.assetDeduction.expenseId||(e.assetDeduction&&e.assetDeduction.recordId===id));
    if(expense)await remove('incomeExpenses',expense.id);
    const restored=Object.assign({},r);
    delete restored.assetDeduction;
    restored.updatedAt=new Date().toISOString();
    await put('records',restored);
    await loadState();renderAll();
    toast('Item recovered to Assets');
  }catch(error){console.error(error);toast('Could not recover the item'+(error.message?` — ${error.message}`:''),true)}
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
  const deduction=ASSET_DEDUCTIONS.includes(record.assetDeduction)&&type==='Asset'&&subcategory==='Furniture, Electronics & Equipments'?record.assetDeduction:'';
  delete record.assetDeduction;
  if(schema.amountSync==='purchase')record.purchaseValue=amount;      // Jewelry / Other Property: Amount = Purchase Value
  if(schema.amountSync==='market'&&!record.currentMarketValue&&!record.purchaseValue){record.currentMarketValue=amount}
  if(!record.incomeYear){const derived=fiscalYearFromDate(record.date);if(derived)record.incomeYear=derived}
  // "Funded from" only applies to records whose category is not Cash & Bank: a Cash & Bank
  // snapshot already *is* the money, so it must never deduct itself.
  const fundingEl=document.getElementById('recordFunding');
  const fundingAccount=fundingEl&&!fundingEl.disabled&&fundingEl.value?formState.fundingAccounts?.get(fundingEl.value):null;
  if(fundingAccount&&!(type==='Asset'&&isCashCategoryName(category))){
    record.funding={category:fundingAccount.category,subcategory:fundingAccount.subcategory};
  }else{
    delete record.funding;
  }
  // "I Do not want to change Account": keep the funding source for reference but never deduct it.
  const noAccountEl=document.getElementById('recordNoAccountChange');
  if(record.funding&&noAccountEl&&noAccountEl.checked)record.noAccountChange=true;else delete record.noAccountChange;
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
  if(deduction){
    await applyAssetDeduction(record,deduction,old);
  }else{
    await put('records',record);
  }
  await loadState();
  document.getElementById('recordModal').close();
  editingRecordId=null;
  renderAll();
  toast(deduction?`Moved to Expenses -> ${DEDUCTION_MAJOR_HEAD} (${deduction})`:isNew?'Record created successfully':'Record saved successfully');
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
  const record=state.records.find(r=>r.id===id);
  const transfer=isTransferRecord(record);
  const question=transfer
    ?'Delete this transfer? Both account balances go back to what they were before the transfer.'
    :'Delete this financial record? Any linked document relationships will also be removed.';
  if(await confirm(question,transfer?'Delete Transfer':'Delete Record')){
    const linked=new Set([...(record?.documentIds||[]),...state.documents.filter(d=>d.recordId===id).map(d=>d.id)]);
    for(const documentId of linked){
      await remove('documents',documentId);
      await remove('documentBlobs',documentId);
    }
    await remove('records',id);
    await loadState();renderAll();toast(transfer?'Transfer deleted':'Record deleted');
  }
}

function viewRecord(id){
  const r=state.records.find(x=>x.id===id)||(state.deductedRecords||[]).find(x=>x.id===id);if(!r)return;
  if(isTransferRecord(r)){viewTransferRecord(r);return}
  editingRecordId=null;
  const schema=schemaForRecord(r);
  document.getElementById('recordModalTitle').textContent=recordTitle(r);
  document.getElementById('recordModalSubtitle').textContent=`${r.category} / ${r.subcategory}`;
  const documentSection=documentViewSection(r);
  const show=(label,value,full=false)=>`<label${full?' class="full"':''}><span class="k">${esc(label)}</span><strong class="view-field">${value===''||value===undefined||value===null?'—':esc(value)}</strong></label>`;
  const showCat=(label,value,type)=>`<label><span class="k">${esc(label)}</span><strong class="view-field">${catLabel(value,type)}</strong></label>`;
  const showRaw=(label,html)=>`<label><span class="k">${esc(label)}</span><strong class="view-field">${html||'—'}</strong></label>`;
  const rows=[show('Type',r.type),showCat('Category',r.category,r.type),showCat('Subcategory',r.subcategory,r.type),show('Date',fmtDate(r.date))];
  schema.fields.filter(f=>!f.transient).forEach(f=>rows.push(show(f.label,f.type==='money'?(r[f.key]?formatMoney(r[f.key]):''):r[f.key])));
  const shown=new Set(schema.fields.map(f=>f.key));
  ['purchaseValue','currentMarketValue'].forEach(k=>{if(!shown.has(k)&&r[k])rows.push(show(k==='purchaseValue'?'Purchase Value':'Current Market Value',formatMoney(r[k])))});
  rows.push(show('Amount / Balance',formatMoney(recordAmount(r))));
  if(r.assetDeduction)rows.push(show('Assets Deduction',`${r.assetDeduction.reason} · ${fmtDate(r.assetDeduction.date)}`));
  if(r.funding&&r.funding.subcategory)rows.push(showRaw('Funded From',`${catIcon(r.funding.subcategory,'Asset')}${esc(r.funding.category||'Asset')} / ${esc(r.funding.subcategory)}`),show('Funding Impact',r.noAccountChange?'Not deducted (I Do not want to change Account)':`${formatMoney(Math.abs(recordAmount(r)))} deducted from that subcategory`));
  rows.push(show('Details / Description',r.details||r.description||'',true));
  if(r.remarks)rows.push(show('Remarks',r.remarks,true));
  document.getElementById('recordFormFields').innerHTML=`<div class="form-grid">${rows.join('')}${documentSection}</div>`;
  document.querySelector('#recordForm .modal-foot').innerHTML='<button type="button" class="btn" data-close-modal>Close</button>';
  document.querySelectorAll('#recordForm [data-close-modal]').forEach(button=>button.onclick=()=>document.getElementById('recordModal').close());
  document.getElementById('recordModal').showModal();
}

/* ==========================================================================
   Transfer sheet (Assets & Liabilities -> Transfer)
   ========================================================================== */
let editingTransferId=null;
let savingTransfer=false;

/** Every Cash & Bank subcategory with the balance it currently shows. Cash resolves to its latest
 *  snapshot per item, so each row matches the Balance Sheet exactly; transfers and "Funded from"
 *  movements already applied are included. The Transfer sheet only ever offers these subcategories.
 *  `ignoreTransferId` leaves out the legs of the transfer being edited, so the sheet starts from
 *  the balances the accounts had before that transfer. */
function transferAccounts(ignoreTransferId=''){
  const accounts=new Map();
  const accountFor=(category,subcategory)=>{
    const key=cashSubcategoryKey(subcategory);
    if(!key)return null;
    let account=accounts.get(key);
    if(!account){
      account={key,type:'Asset',category:String(category||'').trim(),subcategory:String(subcategory||'').trim(),particulars:'',accountDetail:'',balance:0};
      accounts.set(key,account);
    }else if(!account.category&&category)account.category=String(category).trim();
    return account;
  };
  // Subcategories declared under Cash & Bank are offered even before they hold a balance.
  state.categories.filter(category=>category.type==='Asset'&&isCashCategoryName(category.name))
    .forEach(category=>(category.subcategories||[]).forEach(subcategory=>accountFor(category.name,subcategory)));
  effectiveRecordsForBalance(state.records,'').forEach(record=>{
    if(!isCashRecord(record))return;
    if(ignoreTransferId&&record.syntheticTransferLeg&&record.transferId===ignoreTransferId)return;
    const account=accountFor(record.category,record.subcategory);
    if(account)account.balance+=recordAmount(record);
  });
  return [...accounts.values()].sort((a,b)=>a.subcategory.localeCompare(b.subcategory)||a.category.localeCompare(b.category));
}
/**
 * Older transfers could start or end on a non-cash account (a loan that paid money into the bank,
 * for example). The Transfer sheet only offers Cash & Bank subcategories now, so those stored sides
 * are added back to the list - for that one sheet only - instead of being silently replaced by a
 * Cash & Bank account when the transfer is saved again.
 */
function legacyTransferSides(accounts,transfer,ignoreTransferId=''){
  const rows=[...(accounts||[])];
  // Nothing to add for the usual Cash & Bank -> Cash & Bank transfer.
  const sides=[transfer&&transfer.source,transfer&&transfer.destination].filter(side=>side&&!isCashRecord(side));
  if(!sides.length)return rows;
  const balances=new Map();
  effectiveRecordsForBalance(state.records,'').forEach(record=>{
    if(isCashRecord(record))return;
    if(ignoreTransferId&&record.syntheticTransferLeg&&record.transferId===ignoreTransferId)return;
    const key=transferAccountKey(record);
    balances.set(key,(balances.get(key)||0)+recordAmount(record));
  });
  sides.forEach(side=>{
    if(!side||isCashRecord(side))return;
    const key=transferAccountKey(side);
    if(!key||rows.some(row=>row.key===key))return;
    rows.push({
      key,legacy:true,type:side.type||'',category:side.category||'',subcategory:side.subcategory||'',
      particulars:side.particulars||'',accountDetail:side.accountDetail||'',balance:balances.get(key)||0
    });
  });
  return rows;
}
/** The account rows of the transfer sheet currently open (see legacyTransferSides). */
function transferSheetAccounts(){
  const record=editingTransferId?state.records.find(r=>r.id===editingTransferId):null;
  return legacyTransferSides(transferAccounts(editingTransferId||''),record&&record.transfer,editingTransferId||'');
}
/** Flat <option> list of Cash & Bank subcategories (one row per account, with its live balance). */
function transferAccountOptions(accounts,selectedKey,excludeKey=''){
  const label=account=>isCashCategoryName(account.category)
    ?account.subcategory
    :`${account.category} / ${transferAccountName(account)||account.subcategory}`;
  const options=accounts.filter(account=>account.key!==excludeKey).map(account=>
    `<option value="${esc(account.key)}" ${account.key===selectedKey?'selected':''}>${esc(label(account))} · ${esc(formatMoney(account.balance))}</option>`
  ).join('');
  return `<option value="">Select a Cash &amp; Bank subcategory</option>${options}`;
}
function currentTimeValue(){
  const now=new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}
function syncTransferStatusLabels(){
  const source=$el('transferSourceStatus'),destination=$el('transferDestinationStatus');
  if(source)$el('transferSourceStatusText').textContent=source.checked?'Paid':'Pending';
  if(destination)$el('transferDestinationStatusText').textContent=destination.checked?'Paid':'Pending';
}
function updateTransferHints(){
  const accounts=transferSheetAccounts();
  const hint=key=>{
    const account=accounts.find(item=>item.key===key);
    return account?`${catIcon(account.subcategory,account.type)}${esc(account.category)} / ${esc(account.subcategory)} · Balance ${formatMoney(account.balance)}`:'';
  };
  $el('transferSourceHint').innerHTML=hint($el('transferSourceAccount').value);
  $el('transferDestinationHint').innerHTML=hint($el('transferDestinationAccount').value);
}
/** Live "before -> after" preview of both accounts, plus fee / negative-balance warnings. */
function updateTransferPreview(){
  const accounts=transferSheetAccounts();
  const source=accounts.find(account=>account.key===$el('transferSourceAccount').value);
  const destination=accounts.find(account=>account.key===$el('transferDestinationAccount').value);
  const synced=$el('transferSyncAmount').checked;
  const sourceAmount=Math.abs(Number($el('transferSourceAmount').value)||0);
  const destinationInput=$el('transferDestinationAmount');
  if(synced){
    const mirrored=sourceAmount?String(sourceAmount):'';
    if(destinationInput.value!==mirrored)destinationInput.value=mirrored;
  }
  destinationInput.disabled=synced;
  const destinationAmount=synced?sourceAmount:Math.abs(Number(destinationInput.value)||0);
  const row=(account,amount,isSource)=>{
    if(!account)return '';
    const before=account.balance;
    const after=before+transferLegDelta(account,amount,isSource);
    return `<div class="transfer-preview-row"><span>${catIcon(account.subcategory,account.type)}${esc(transferAccountName(account)||account.subcategory)}</span><strong class="${after<before?'down':after>before?'up':''}">${esc(formatMoney(before))} → ${esc(formatMoney(after))}</strong></div>`;
  };
  const rows=[];
  if(source&&sourceAmount)rows.push(row(source,sourceAmount,true));
  if(destination&&destinationAmount)rows.push(row(destination,destinationAmount,false));
  const difference=sourceAmount-destinationAmount;
  if(sourceAmount&&destinationAmount&&difference>0){
    rows.push(`<div class="transfer-preview-note">Difference ${esc(formatMoney(difference))} stays behind as a cash-out charge.</div>`);
  }
  if(source&&sourceAmount>0&&source.type==='Asset'&&source.balance<sourceAmount){
    rows.push(`<div class="transfer-preview-note warn">This is more than the source balance (${esc(formatMoney(source.balance))}).</div>`);
  }
  if(!rows.length)rows.push('<div class="transfer-preview-note">Choose both accounts and enter an amount to preview the new balances.</div>');
  $el('transferPreview').innerHTML=rows.join('');
}

/* ---------- Optional PDF attachment for a transfer -------------------------
   A transfer carries at most one supporting PDF. The file lives in the existing
   "documentBlobs" store and its small metadata record in "documents", both linked to the
   transfer through documentIds / recordId. Changes are staged until the transfer is saved,
   so Cancel never touches the stored PDF.
   -------------------------------------------------------------------------- */
let transferDocDraft={existing:null,removed:false,replacement:null,added:null};

/** PDFs linked to a transfer: documentIds first, then the recordId fallback for older data. */
function transferDocsOf(record){
  if(!record)return [];
  const linked=(record.documentIds||[]).map(id=>state.documents.find(d=>d.id===id)).filter(Boolean);
  return linked.length?linked:state.documents.filter(d=>d.recordId===record.id);
}
function resetTransferDocDraft(record){
  transferDocDraft={existing:transferDocsOf(record)[0]||null,removed:false,replacement:null,added:null};
}
/** Small metadata record for the "documents" store (the bytes stay in "documentBlobs"). */
function transferDocumentRecord({id,recordId,file,existing,category,subcategory,financialType,incomeYear}){
  const now=new Date().toISOString();
  const base=existing?Object.assign({},existing):{createdAt:now};
  return Object.assign(base,{
    id,recordId,
    name:file.name,title:file.name,
    type:'application/pdf',mimeType:'application/pdf',
    size:Number(file.size)||0,
    category:category||'',subcategory:subcategory||'',
    financialType:financialType||'',incomeYear:incomeYear||'',
    uploadedAt:now,updatedAt:now
  });
}
function stagedTransferDoc(){
  return transferDocDraft.added||transferDocDraft.replacement||null;
}
/** Compact preview chip shown inside the sheet before saving. */
function renderTransferDocManager(){
  const host=$el('transferDocManagerList');
  if(!host)return;
  const chip=(name,size,note,actions,extra='')=>`<div class="transfer-doc-chip ${extra}">
      ${icon('file')}
      <div class="transfer-doc-meta"><strong title="${esc(name)}">${esc(name)}</strong><span>${esc(formatFileSize(size))}${note?` · ${esc(note)}`:''}</span></div>
      <div class="transfer-doc-actions">${actions}</div>
    </div>`;
  const draft=transferDocDraft,rows=[];
  if(draft.existing){
    const savedName=draft.existing.name||draft.existing.title||'document.pdf';
    const staged=stagedTransferDoc();
    if(draft.removed){
      rows.push(chip(savedName,draft.existing.size,'will be removed on save',
        '<button type="button" class="action-link" data-tact="undo-existing">Undo</button>','removed'));
    }else if(staged){
      rows.push(chip(staged.name,staged.size,draft.replacement?'replaces the saved PDF':'new attachment',
        '<button type="button" class="action-link" data-tact="view-new">Preview</button><button type="button" class="action-link danger transfer-doc-remove" data-tact="remove-new" title="Remove PDF" aria-label="Remove selected PDF">×</button>'));
    }else{
      rows.push(chip(savedName,draft.existing.size,'attached',
        '<button type="button" class="action-link" data-tact="view-existing">Preview</button><button type="button" class="action-link" data-tact="download-existing">Download</button><button type="button" class="action-link" data-tact="replace-existing">Replace</button><button type="button" class="action-link danger transfer-doc-remove" data-tact="remove-existing" title="Remove PDF" aria-label="Remove attached PDF">×</button>'));
    }
  }else if(draft.added){
    rows.push(chip(draft.added.name,draft.added.size,'new · saved with this transfer',
      '<button type="button" class="action-link" data-tact="view-new">Preview</button><button type="button" class="action-link danger transfer-doc-remove" data-tact="remove-new" title="Remove PDF" aria-label="Remove selected PDF">×</button>'));
  }else{
    rows.push('<div class="doc-empty">No PDF attached yet.</div>');
  }
  host.innerHTML=rows.join('');
}

/** Opens the transfer sheet. Without an id it starts a new transfer, with an id it edits that one. */
function openTransferModal(id=null){
  const record=id?state.records.find(r=>r.id===id):null;
  if(id&&!record)return;
  editingTransferId=record?record.id:null;
  const transfer=record&&record.transfer?record.transfer:null;
  const accounts=transferSheetAccounts();
  if(accounts.length<2){
    editingTransferId=null;
    toast('A transfer needs two Cash & Bank subcategories. Add a second one (for example Cash in Hand and bKash) first.',true);
    return;
  }
  /** A stored side keeps its exact identity, so an old transfer that used a non-cash account
   *  (added back by legacyTransferSides) stays editable instead of being re-pointed on save. */
  const findSide=side=>side
    ?accounts.find(account=>account.key===cashSubcategoryKey(side.subcategory)||account.key===transferAccountKey(side))
    :undefined;
  const sourceAccount=findSide(transfer&&transfer.source)||accounts[0];
  const destinationAccount=(()=>{
    const stored=findSide(transfer&&transfer.destination);
    if(stored&&stored.key!==sourceAccount.key)return stored;
    return accounts.find(account=>account.key!==sourceAccount.key);
  })();
  $el('transferModalTitle').textContent=record?'Edit Transfer':'New Transfer';
  $el('transferModalSubtitle').textContent=record
    ?'Update the Cash & Bank subcategories, the amounts or the date of this transfer'
    :'Move money between two Cash & Bank subcategories without touching income or expenses';
  $el('transferSubmitBtn').textContent=record?'Save Transfer':'Create Transfer';
  $el('transferSourceAccount').innerHTML=transferAccountOptions(accounts,sourceAccount.key);
  $el('transferDestinationAccount').innerHTML=transferAccountOptions(accounts,destinationAccount?destinationAccount.key:'',sourceAccount.key);
  const amountValue=side=>side&&Number(side.amount)?String(Number(side.amount)):'';
  $el('transferSourceAmount').value=transfer?amountValue(transfer.source):'';
  $el('transferDestinationAmount').value=transfer?amountValue(transfer.destination):'';
  $el('transferSyncAmount').checked=transfer?transfer.synced!==false:true;
  const currency=(transfer&&transfer.source&&transfer.source.currency)||state.settings.currency||'BDT';
  $el('transferSourceCurrency').value=currency;
  $el('transferDestinationCurrency').value=(transfer&&transfer.destination&&transfer.destination.currency)||currency;
  $el('transferSourceStatus').checked=!transfer||!transfer.source||transfer.source.status!=='Pending';
  $el('transferDestinationStatus').checked=!transfer||!transfer.destination||transfer.destination.status!=='Pending';
  $el('transferDate').value=(record&&normalizeExcelDate(record.date))||todayISO();
  $el('transferTime').value=(transfer&&transfer.time)||currentTimeValue();
  $el('transferNotes').value=(record&&(record.details||record.description))||'';
  syncTransferStatusLabels();
  updateTransferHints();
  updateTransferPreview();
  resetTransferDocDraft(record);
  $el('transferDocument').value='';
  renderTransferDocManager();
  $el('transferModal').showModal();
  const amountField=$el('transferSourceAmount');
  setTimeout(()=>{
    try{amountField.focus({preventScroll:true});if(amountField.select)amountField.select()}catch(error){}
  },80);
}

/** Creates or updates a transfer from the sheet. Both sides live on the single record. */
async function saveTransfer(event){
  event.preventDefault();
  if(savingTransfer)return;
  const accounts=transferSheetAccounts();
  const source=accounts.find(account=>account.key===$el('transferSourceAccount').value);
  const destination=accounts.find(account=>account.key===$el('transferDestinationAccount').value);
  if(!source||!destination){
    toast('Choose the Cash & Bank subcategory the money leaves and the one it arrives in.',true);
    return;
  }
  if(source.key===destination.key){
    toast('The source and the destination must be different Cash & Bank subcategories.',true);
    return;
  }
  const synced=$el('transferSyncAmount').checked;
  const sourceAmount=Math.abs(Number($el('transferSourceAmount').value)||0);
  const destinationAmount=synced?sourceAmount:Math.abs(Number($el('transferDestinationAmount').value)||0);
  if(!(sourceAmount>0)){
    toast('Enter how much leaves the source account.',true);
    $el('transferSourceAmount').focus();
    return;
  }
  if(!(destinationAmount>0)){
    toast('Enter how much arrives in the destination account.',true);
    $el('transferDestinationAmount').focus();
    return;
  }
  const date=$el('transferDate').value||todayISO();
  const time=$el('transferTime').value||'';
  const existing=editingTransferId?state.records.find(r=>r.id===editingTransferId):null;
  const now=new Date().toISOString();
  const sourceName=transferAccountName(source)||source.subcategory;
  const destinationName=transferAccountName(destination)||destination.subcategory;
  const record={
    id:existing?existing.id:uid('record'),
    kind:TRANSFER_KIND,
    // The record keeps the source side's classification so the existing filters keep working;
    // the destination side is matched from transfer.destination.
    type:source.type,category:source.category,subcategory:source.subcategory,
    particulars:`${sourceName} → ${destinationName}`,
    accountDetail:'',
    date,
    incomeYear:fiscalYearFromDate(date)||(existing&&existing.incomeYear)||'',
    details:$el('transferNotes').value.trim(),
    amount:sourceAmount,balance:sourceAmount,
    documentIds:existing?(existing.documentIds||[]):[],
    transfer:{
      version:1,
      source:{...transferAccountSnapshot(source),amount:sourceAmount,currency:$el('transferSourceCurrency').value,status:$el('transferSourceStatus').checked?'Paid':'Pending'},
      destination:{...transferAccountSnapshot(destination),amount:destinationAmount,currency:$el('transferDestinationCurrency').value,status:$el('transferDestinationStatus').checked?'Paid':'Pending'},
      time,synced,fee:Math.max(0,sourceAmount-destinationAmount),
      createdAt:(existing&&existing.transfer&&existing.transfer.createdAt)||now
    },
    createdAt:(existing&&existing.createdAt)||now,
    updatedAt:now
  };
  savingTransfer=true;
  try{
    // Commit the staged PDF before the record, so a saved transfer never points at a missing file.
    let documentIds=[...(record.documentIds||[])];
    const draft=transferDocDraft;
    if(draft.existing&&draft.removed&&!draft.replacement){
      await remove('documentBlobs',draft.existing.id);
      await remove('documents',draft.existing.id);
      documentIds=documentIds.filter(id=>id!==draft.existing.id);
    }
    if(draft.existing&&draft.replacement){
      const documentId=draft.existing.id;
      await put('documentBlobs',{id:documentId,blob:draft.replacement});
      await put('documents',transferDocumentRecord({id:documentId,recordId:record.id,file:draft.replacement,existing:draft.existing,category:record.category,subcategory:record.subcategory,financialType:record.type,incomeYear:record.incomeYear}));
      if(!documentIds.includes(documentId))documentIds.push(documentId);
    }
    if(!draft.existing&&draft.added){
      const documentId=draft.addedId||uid('doc');
      draft.addedId=documentId;
      await put('documentBlobs',{id:documentId,blob:draft.added});
      await put('documents',transferDocumentRecord({id:documentId,recordId:record.id,file:draft.added,existing:null,category:record.category,subcategory:record.subcategory,financialType:record.type,incomeYear:record.incomeYear}));
      if(!documentIds.includes(documentId))documentIds.push(documentId);
    }
    if(draft.existing&&!draft.removed&&!draft.replacement){
      // The PDF stays as it is, but the transfer may now sit in another category / income year.
      // Metadata follows the record so category renames and backups stay consistent.
      const saved=draft.existing;
      const fresh={category:record.category||'',subcategory:record.subcategory||'',financialType:record.type||'',incomeYear:record.incomeYear||''};
      if(Object.keys(fresh).some(key=>saved[key]!==fresh[key])){
        await put('documents',Object.assign({},saved,fresh,{updatedAt:now}));
      }
    }
    record.documentIds=documentIds;
    await put('records',record);
    await loadState();
    $el('transferModal').close();
    editingTransferId=null;
    renderAll();
    toast(existing?'Transfer updated':'Transfer created');
  }catch(error){
    console.error(error);
    const full=error&&error.name==='QuotaExceededError';
    toast(full?'Could not save the transfer — browser storage is full.':`Could not save the transfer${error&&error.message?' — '+error.message:''}`,true);
  }finally{
    savingTransfer=false;
  }
}

/** Read-only view of a transfer inside the shared record dialog, with a shortcut to edit it. */
function viewTransferRecord(record){
  editingRecordId=null;
  const transfer=record.transfer||{};
  const source=transfer.source||{},destination=transfer.destination||{};
  const amounts=transferAmounts(transfer);
  const show=(label,value,full=false)=>`<label${full?' class="full"':''}><span class="k">${esc(label)}</span><strong class="view-field">${value===''||value===undefined||value===null?'—':esc(value)}</strong></label>`;
  const accountRow=(label,acc)=>{
    const text=[acc.category,acc.subcategory].filter(Boolean).join(' / ');
    return `<label><span class="k">${esc(label)}</span><strong class="view-field">${catIcon(acc.subcategory||acc.category,'Asset')}${text?esc(text):'—'}</strong></label>`;
  };
  const rows=[
    show('Transfer',`${transferAccountName(source)||source.subcategory||''} → ${transferAccountName(destination)||destination.subcategory||''}`,true),
    show('Date',fmtDate(record.date)),show('Time',transfer.time||''),
    accountRow('From Account',source),
    show('From Amount',amounts.out?formatMoney(amounts.out):''),
    accountRow('To Account',destination),
    show('To Amount',amounts.incoming?formatMoney(amounts.incoming):''),
    show('Currency',source.currency||''),
    show('Status',`${source.status||'Paid'} → ${destination.status||'Paid'}`),
    show('Income Year',record.incomeYear||''),
    show('Notes',record.details||record.description||'',true)
  ];
  const meta=transferMetaLabel(record);
  document.getElementById('recordModalTitle').textContent='Transfer';
  document.getElementById('recordModalSubtitle').textContent=`${record.type||''} · not counted as income or expense`;
  document.getElementById('recordFormFields').innerHTML=`<div class="form-grid">${rows.join('')}
    ${documentViewSection(record)}
    <div class="transfer-preview full"><div class="transfer-preview-note">A transfer only moves a balance between the two accounts, so Net Worth and the Income / Expense totals stay exactly the same.</div>${meta?`<div class="transfer-preview-note">${esc(meta)}</div>`:''}</div></div>`;
  document.querySelector('#recordForm .modal-foot').innerHTML='<button type="button" class="btn" data-close-modal>Close</button><button type="button" class="btn btn-primary" id="editTransferFromView">Edit Transfer</button>';
  document.querySelectorAll('#recordForm [data-close-modal]').forEach(button=>button.onclick=()=>document.getElementById('recordModal').close());
  const edit=$el('editTransferFromView');
  if(edit)edit.onclick=()=>{document.getElementById('recordModal').close();openTransferModal(record.id)};
  document.getElementById('recordModal').showModal();
}

/** Wires the transfer sheet once; its fields are re-populated on every open. */
function bindTransferForm(){
  const modal=$el('transferModal');
  if(!modal||!modal.showModal)return;
  $el('transferForm').onsubmit=saveTransfer;
  $el('transferSourceAccount').onchange=()=>{
    const accounts=transferSheetAccounts();
    const sourceKey=$el('transferSourceAccount').value;
    const current=$el('transferDestinationAccount').value;
    $el('transferDestinationAccount').innerHTML=transferAccountOptions(accounts,current,sourceKey);
    if(!$el('transferDestinationAccount').value){
      const fallback=accounts.find(account=>account.key!==sourceKey);
      if(fallback)$el('transferDestinationAccount').value=fallback.key;
    }
    updateTransferHints();
    updateTransferPreview();
  };
  ['transferDestinationAccount','transferSourceAmount','transferDestinationAmount','transferSyncAmount','transferDate','transferTime','transferSourceStatus','transferDestinationStatus','transferSourceCurrency','transferDestinationCurrency'].forEach(id=>{
    const field=$el(id);
    const handler=()=>{syncTransferStatusLabels();updateTransferHints();updateTransferPreview()};
    field.oninput=handler;
    field.onchange=handler;
  });
  // Optional PDF attachment — staged here and written by saveTransfer, so Cancel leaves the saved file untouched.
  $el('transferDocument').onchange=event=>{
    const input=event.target;
    const file=input.files&&input.files[0];
    input.value='';
    if(!file)return;
    if(!isPdfFile(file)){
      toast('Only PDF files can be attached. Please choose a .pdf file.',true);
      return;
    }
    if(file.size>30*1024*1024)toast('This PDF is larger than 30 MB — saving may exceed the browser storage limit.',true);
    if(transferDocDraft.existing){
      transferDocDraft.replacement=file;
      transferDocDraft.added=null;
      transferDocDraft.removed=false;
    }else{
      transferDocDraft.added=file;
      transferDocDraft.replacement=null;
    }
    renderTransferDocManager();
  };
  $el('transferDocManager').onclick=async event=>{
    const button=event.target.closest('[data-tact]');
    if(!button)return;
    const tact=button.dataset.tact;
    if(tact==='view-existing'&&transferDocDraft.existing)await openPdfViewer(transferDocDraft.existing.id);
    else if(tact==='download-existing'&&transferDocDraft.existing)await downloadDocument(transferDocDraft.existing.id);
    else if(tact==='replace-existing')$el('transferDocument').click();
    else if(tact==='remove-existing'){transferDocDraft.removed=true;transferDocDraft.replacement=null;renderTransferDocManager()}
    else if(tact==='undo-existing'){transferDocDraft.removed=false;renderTransferDocManager()}
    else if(tact==='view-new'){const file=stagedTransferDoc();if(file)await openPdfViewer({blob:file,name:file.name,size:file.size})}
    else if(tact==='remove-new'){transferDocDraft.added=null;transferDocDraft.replacement=null;renderTransferDocManager()}
  };
  // The sheet always reopens from the live balances, so a stored edit id must not leak out.
  modal.addEventListener('close',()=>{
    editingTransferId=null;
    transferDocDraft={existing:null,removed:false,replacement:null,added:null};
    const input=$el('transferDocument');
    if(input)input.value='';
  });
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
  const selectedYear=normIncomeYear(yearSelect?.value||'');
  const years=recordYearOptions();
  const year=years.includes(selectedYear)?selectedYear:'';
  const categories=dashCategoryNames(type);
  if(!categories.includes(categorySelect.value))categorySelect.value='';
  categorySelect.disabled=categories.length===0;
  categorySelect.innerHTML=option('',type?`All ${type} Categories`:'All Categories',!categorySelect.value)+categories.map(c=>option(c,c,categorySelect.value===c)).join('');
  const subcategories=dashSubcategoryNames(type,categorySelect.value);
  if(!subcategories.includes(subcategorySelect.value))subcategorySelect.value='';
  subcategorySelect.disabled=subcategories.length===0;
  subcategorySelect.innerHTML=option('','All Subcategories',!subcategorySelect.value)+subcategories.map(s=>option(s,s,subcategorySelect.value===s)).join('');
  if(yearSelect){
    yearSelect.innerHTML=option('','All Income Years',!year)+years.map(y=>option(y,y,y===year)).join('');
    yearSelect.value=year;
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

/** Active filter criteria of the Assets & Liabilities page (search, Type, Category,
 *  Subcategory and Income Year). Reports and exports are triggered from this page, so they
 *  must read the same values. */
function recordsPageFilterState(){
  const yearSelect=document.getElementById('recordYearFilter');
  return {
    search:(document.getElementById('recordSearch')?.value||'').trim(),
    type:document.getElementById('recordTypeFilter')?.value||'',
    category:document.getElementById('recordCategoryFilter')?.value||'',
    subcategory:document.getElementById('recordSubcategoryFilter')?.value||'',
    year:normIncomeYear(yearSelect?.value||'')
  };
}
/** The Assets & Liabilities records matching the active filters - exactly the rows the page
 *  displays. Transfers are rendered on the page too, so reports and exports must not silently drop
 *  them; they are only kept out of the money totals (see groupRecordsForReport) because a transfer
 *  moves existing money instead of adding to it. Synthetic balance movements never live in
 *  state.records - they are filtered out defensively. */
function recordsPageFilteredRecords(filters){
  const f=filters||recordsPageFilterState();
  const search=String(f.search||'').toLowerCase();
  let records=state.records.filter(r=>!r.syntheticTransferLeg);
  if(search)records=records.filter(r=>Object.values(r).some(v=>String(v).toLowerCase().includes(search)));
  if(f.year)records=records.filter(r=>recordFinancialYear(r)===f.year);
  if(f.type)records=records.filter(r=>r.type===f.type);
  if(f.category)records=records.filter(r=>r.category===f.category);
  if(f.subcategory)records=records.filter(r=>r.subcategory===f.subcategory);
  return records;
}

let recordKpiPrev=[];
/** Summary cards of the Assets & Liabilities page - mirrors the Income & Expenses page layout.
 *  Transfers are listed on the page but kept out of the totals: they move existing money. */
function renderRecordSummary(records){
  const host=document.getElementById('recordSummaryCards');
  if(!host)return;
  const list=(records||recordsPageFilteredRecords()).filter(r=>!isTransferRecord(r));
  const assets=list.filter(r=>r.type==='Asset').reduce((s,r)=>s+recordAmount(r),0);
  const liabilities=list.filter(r=>r.type==='Liability').reduce((s,r)=>s+recordAmount(r),0);
  const net=assets-liabilities;
  const ratio=assets>0?(liabilities/assets)*100:0;
  const card=(i,iconName,label,value,kind,kpi,kpiInk,cls)=>`<div class="summary-card" style="--i:${i};--kpi:${kpi};--kpi-ink:${kpiInk}"><div class="summary-icon">${icon(iconName)}</div><div><p>${label}</p><strong class="kpi-value ${cls||''}" data-kind="${kind}" data-to="${value}">${kind==='money'?formatMoney(value):kind==='percent'?(Number(value).toFixed(1)+'%'):value}</strong></div></div>`;
  host.innerHTML=[
    card(0,'up','Total Assets',assets,'money','var(--emerald-soft)','#059669'),
    card(1,'down','Total Liabilities',liabilities,'money','var(--rose-soft)','#e11d48'),
    card(2,'scale','Net Worth',net,'money','var(--primary-soft)','var(--primary-2)',net>=0?'kpi-pos':'kpi-neg'),
    card(3,'layers','Debt Ratio',ratio,'percent','rgba(245,158,11,.13)','#d97706')
  ].join('');
  animateRecordKpis();
}
function animateRecordKpis(){
  document.querySelectorAll('#recordSummaryCards .kpi-value').forEach((el,i)=>{
    const to=Number(el.dataset.to)||0,kind=el.dataset.kind;
    const from=recordKpiPrev[i]??0;
    recordKpiPrev[i]=to;
    const fmt=v=>kind==='money'?formatMoney(v):kind==='percent'?(Number(v).toFixed(1)+'%'):String(Math.round(v));
    if(reducedMotion()||from===to){el.textContent=fmt(to);return}
    const duration=900,start=performance.now();
    const step=now=>{const t=Math.min(1,(now-start)/duration);const eased=1-Math.pow(1-t,4);el.textContent=fmt(from+(to-from)*eased);if(t<1)requestAnimationFrame(step);else el.textContent=fmt(to)};
    el.textContent=fmt(from);requestAnimationFrame(step);
  });
}
function renderRecordSections(){
  renderRecordFilters();
  const {search,type,category,subcategory,year}=recordsPageFilterState();
  const records=recordsPageFilteredRecords({search,type,category,subcategory,year})
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  renderRecordSummary(records);
  const render=(items)=>items.map((r,i)=>{
    const transfer=isTransferRecord(r);
    const meta=transfer?transferMetaLabel(r):recordMeta(r);
    const id=esc(r.id);
    return `<div class="record-item${transfer?' transfer-record':''}" style="--i:${Math.min(i,14)}"><div><h4>${esc(recordTitle(r))}</h4><p>${transfer?'<span class="badge transfer">Transfer</span> ':''}${catLabel(r.category,r.type)} · ${catLabel(r.subcategory,r.type)}${r.incomeYear?' · <span class="record-income-year">'+esc(r.incomeYear)+'</span>':''}</p>${meta?`<p>${esc(meta)}</p>`:''}</div><div class="record-amount"><strong>${formatMoney(recordAmount(r))}</strong><p>${esc(fmtDate(r.date))}</p></div>${docsFor(r).length?`<div class="record-docs">${docChips(r,3)}</div>`:''}<div class="record-actions">${isDeductibleAsset(r)?`<label class="asset-deduction-field"><span>Assets Deduction</span><select class="asset-deduction-select" data-deduct-id="${id}" aria-label="Assets Deduction"><option value="">— Select —</option>${ASSET_DEDUCTIONS.map(o=>`<option value="${o}">${o}</option>`).join('')}</select></label>`:''}<button type="button" class="action-link" data-cmd="view-record" data-id="${id}">View</button><button type="button" class="action-link" data-cmd="edit-record" data-id="${id}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-record" data-id="${id}">Delete</button></div></div>`;
  }).join('');
  const assets=records.filter(r=>r.type==='Asset'),liabilities=records.filter(r=>r.type==='Liability');
  document.getElementById('assetRecordCount').textContent=`${assets.length} records`;
  document.getElementById('liabilityRecordCount').textContent=`${liabilities.length} records`;
  document.getElementById('assetList').innerHTML=render(assets)||'<div class="empty-state">No asset records.</div>';
  const deducted=(state.deductedRecords||[]).filter(r=>!search||Object.values(r).some(v=>String(v).toLowerCase().includes(String(search).toLowerCase()))).sort((a,b)=>String(b.assetDeduction.date||'').localeCompare(String(a.assetDeduction.date||'')));
  const deductedHost=document.getElementById('deductedList');
  if(deductedHost){
    document.getElementById('deductedRecordCount').textContent=`${deducted.length} items`;
    deductedHost.innerHTML=deducted.map((r,i)=>{const id=esc(r.id);return `<div class="record-item" style="--i:${Math.min(i,14)}"><div><h4>${esc(recordTitle(r))}</h4><p><span class="badge expense">${esc(r.assetDeduction.reason)}</span> ${esc(fmtDate(r.assetDeduction.date))}</p>${recordMeta(r)?`<p>${esc(recordMeta(r))}</p>`:''}</div><div class="record-amount"><strong>${formatMoney(recordAmount(r))}</strong><p>${esc(fmtDate(r.date))}</p></div>${docsFor(r).length?`<div class="record-docs">${docChips(r,3)}</div>`:''}<div class="record-actions"><button type="button" class="action-link" data-cmd="view-record" data-id="${id}">View</button><button type="button" class="action-link" data-cmd="recover-asset" data-id="${id}">Recover</button></div></div>`}).join('')||'<div class="empty-state">No deducted items.</div>';
  }
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
        return {name:n,count:list.filter(r=>!r.syntheticTransferLeg).length,total:list.reduce((s,r)=>s+recordAmount(r),0)};
      });
      return {name:c.name,subs,count:recs.filter(r=>!r.syntheticTransferLeg).length,total:subs.reduce((s,x)=>s+x.total,0)};
    });
    return {cats,total:cats.reduce((s,c)=>s+c.total,0)};
  };
  const assets=section('Asset'),liabilities=section('Liability');
  return {assets,liabilities,net:assets.total-liabilities.total,count:records.filter(r=>!r.syntheticTransferLeg).length};
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
  const section=(title,sec,kind)=>{
    const rows=sec.cats.map(c=>`<tr class="cat-row"><td>${catLabel(c.name,kind)}</td><td>${formatMoney(c.total)}</td></tr>`+
      c.subs.map(sub=>`<tr class="sub-row"><td>${catLabel(sub.name,kind)}</td><td>${formatMoney(sub.total)}</td></tr>`).join('')).join('');
    return `<table class="balance-table"><tbody><tr class="total section-title"><td>${title}</td><td></td></tr>${rows}<tr class="total"><td>Total ${title}</td><td>${formatMoney(sec.total)}</td></tr></tbody></table>`;
  };
  document.getElementById('balanceSheet').innerHTML=`<div class="balance-header"><h2>Personal Balance Sheet</h2><p>${balanceYear?`Income Year ${esc(balanceYear)}${range?` · ${esc(fmtDate(range.from))} to ${esc(fmtDate(range.to))}`:''}`:'All Income Years'}</p></div>
    ${section('ASSETS',data.assets,'Asset')}
    ${section('LIABILITIES',data.liabilities,'Liability')}
    <table class="balance-table"><tbody><tr class="total net-worth-row"><td>NET WORTH</td><td>${formatMoney(data.net)}</td></tr></tbody></table>`;
}

function openCategoryModal(){
  document.getElementById('categoryModal').showModal();
  updateCategoryStructureBadge();
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
/** Drag handle markup shared by every reorderable row (Major Head, Category, Subcategory). */
const CATEGORY_DRAG_HANDLE='<span class="drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>';
function renderCategoryTree(){
  renderCategoryNameOptions();
  const type=document.getElementById('categoryType').value;
  const selectedCategory=document.getElementById('categoryName').value;
  const majorHead=document.getElementById('categoryMajorHead').value;
  const tree=state.categories.filter(c=>(!type||c.type===type)&&(!selectedCategory||c.name===selectedCategory)).map(c=>{
    const id=esc(c.id);
    const subs=c.subcategories.map(s=>`<span class="cat-sub" draggable="true" data-drag="subcategory" data-id="${id}" data-name="${esc(s)}">${CATEGORY_DRAG_HANDLE}${catIcon(s,c.type)}${esc(s)} <button type="button" class="action-link" data-cmd="rename-subcategory" data-id="${id}" data-name="${esc(s)}">Edit</button> <button type="button" class="action-link danger" data-cmd="delete-subcategory" data-id="${id}" data-name="${esc(s)}" aria-label="Delete subcategory ${esc(s)}">×</button></span>`).join('');
    return `<div class="category-group cat-drag" draggable="true" data-drag="category" data-id="${id}"><div class="cat-drag-head">${CATEGORY_DRAG_HANDLE}<strong>${catIcon(c.name,c.type)}${esc(c.type)} · ${esc(c.name)}</strong><button type="button" class="action-link" data-cmd="rename-category" data-id="${id}">Edit</button></div><div class="category-subs">${subs}</div><button type="button" class="action-link danger" data-cmd="delete-category" data-id="${id}">Delete Category</button></div>`;
  }).join('');
  const incomeTree=state.incomeGroups.filter(g=>(!type||g.type===type)&&
    (!(type==='Income'||type==='Expense')||majorHead==='__new__'||!majorHead||g.majorHead===majorHead)).map(g=>{
    const gid=esc(g.id);
    const cats=(g.categories||[]).filter(cat=>!selectedCategory||cat.name===selectedCategory).map(cat=>{
      const cname=esc(cat.name);
      const subs=(cat.subcategories||[]).map(s=>`<span class="cat-sub" draggable="true" data-drag="income-subcategory" data-id="${gid}" data-cat="${cname}" data-name="${esc(s)}">${CATEGORY_DRAG_HANDLE}${catIcon(s,g.type)}${esc(s)} <button type="button" class="action-link" data-cmd="rename-income-subcategory" data-id="${gid}" data-cat="${cname}" data-name="${esc(s)}">Edit</button> <button type="button" class="action-link danger" data-cmd="delete-income-subcategory" data-id="${gid}" data-cat="${cname}" data-name="${esc(s)}" aria-label="Delete subcategory ${esc(s)}">×</button></span>`).join('');
      return `<div class="category-group income-cat cat-drag" draggable="true" data-drag="income-category" data-id="${gid}" data-cat="${cname}"><div class="cat-drag-head">${CATEGORY_DRAG_HANDLE}<strong>${catIcon(cat.name,g.type)}${esc(cat.name)}</strong><button type="button" class="action-link" data-cmd="rename-income-category" data-id="${gid}" data-name="${cname}">Edit</button></div><div class="category-subs">${subs}</div><button type="button" class="action-link danger" data-cmd="delete-income-category" data-id="${gid}" data-name="${cname}">Delete Category</button></div>`;
    }).join('');
    if(!cats)return '';
    return `<div class="category-group income-group cat-drag" draggable="true" data-drag="group" data-id="${gid}"><div class="cat-drag-head">${CATEGORY_DRAG_HANDLE}<strong>${catIcon(g.majorHead,g.type)}${esc(g.type)} · ${esc(g.majorHead)}</strong><button type="button" class="action-link" data-cmd="rename-income-group" data-id="${gid}">Edit</button></div><div class="category-children">${cats}</div><button type="button" class="action-link danger" data-cmd="delete-income-group" data-id="${gid}">Delete Major Head</button></div>`;
  }).join('');
  const assetBlock=tree?`<div class="category-groups" data-drag-list="category">${tree}</div>`:'';
  const incomeBlock=incomeTree?`<div class="cat-section-title">Income &amp; Expenses</div><div class="category-groups" data-drag-list="group">${incomeTree}</div>`:'';
  document.getElementById('categoryTree').innerHTML=assetBlock+incomeBlock||'<p class="hint">No categories match these filters.</p>';
  initCategoryDragAndDrop();
}
/* ==========================================================================
   Manage Categories - drag & drop ordering
   Every Major Head, Category and Subcategory row is draggable ("draggable=true")
   and shows a "⋮⋮" handle. On drop the rows are re-ordered in the DOM first, then
   the new serial order is written to IndexedDB (AssetBookDB):
     - Asset / Liability categories -> categories[i].order
     - Income / Expense major heads -> incomeGroups[i].order
     - categories inside a head     -> incomeGroups[i].categories array order
     - subcategories                -> categories[i].subcategories array order
   Touch / pen screens use the pointer fallback below, because HTML5 drag events
   never fire on touch.
   ========================================================================== */
const CATEGORY_DRAG_KEY={category:'id',group:'id','income-category':'cat',subcategory:'name','income-subcategory':'name'};
let categoryDragItem=null;
let categoryTouchDragId=null;

/** Rows may only trade places with the same kind of row in the same list. */
function categoryDropAllowed(item,target){
  if(!item||!target||item===target)return false;
  if(item.dataset.drag!==target.dataset.drag)return false;
  if(item.parentElement!==target.parentElement)return false;
  return !item.contains(target);
}
function clearCategoryDropCues(host){
  host.querySelectorAll('.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));
}
/** Puts the visible rows into `keys` order; rows hidden by the filters keep their slot. */
function applyDomSequence(items,keys,keyOf){
  if(!Array.isArray(items)||!keys.length)return false;
  const ordered=keys.map(key=>items.find(item=>keyOf(item)===key)).filter(Boolean);
  if(ordered.length!==keys.length)return false;
  const slots=[];
  items.forEach((item,index)=>{if(keys.includes(keyOf(item)))slots.push(index)});
  if(slots.length!==ordered.length)return false;
  slots.forEach((slot,index)=>{items[slot]=ordered[index]});
  return true;
}
/** Reads the new DOM order of one list and persists it to IndexedDB. */
async function persistCategoryOrder(item){
  const kind=item.dataset.drag;
  const keyAttr=CATEGORY_DRAG_KEY[kind];
  const list=item.parentElement;
  if(!keyAttr||!list)return;
  const keys=[...list.children].filter(el=>el.dataset&&el.dataset.drag===kind).map(el=>el.dataset[keyAttr]).filter(Boolean);
  let changed=false;
  if(kind==='category'){
    changed=applyDomSequence(state.categories,keys,entry=>entry.id);
    if(changed){
      state.categories.forEach((entry,index)=>{entry.order=index});
      await putMany('categories',state.categories);
    }
  }else if(kind==='group'){
    changed=applyDomSequence(state.incomeGroups,keys,entry=>entry.id);
    if(changed){
      state.incomeGroups.forEach((entry,index)=>{entry.order=index});
      await putMany('incomeGroups',state.incomeGroups);
    }
  }else if(kind==='income-category'){
    const group=state.incomeGroups.find(entry=>entry.id===item.dataset.id);
    if(group){
      changed=applyDomSequence(group.categories||[],keys,entry=>entry.name);
      if(changed)await put('incomeGroups',group);
    }
  }else if(kind==='subcategory'){
    const category=state.categories.find(entry=>entry.id===item.dataset.id);
    if(category){
      changed=applyDomSequence(category.subcategories||[],keys,name=>name);
      if(changed)await put('categories',category);
    }
  }else if(kind==='income-subcategory'){
    const group=state.incomeGroups.find(entry=>entry.id===item.dataset.id);
    const category=group&&(group.categories||[]).find(entry=>entry.name===item.dataset.cat);
    if(category){
      changed=applyDomSequence(category.subcategories||[],keys,name=>name);
      if(changed)await put('incomeGroups',group);
    }
  }
  if(changed){
    await persistCategoryStructure();
    renderCategoryNameOptions();
    toast('Category order saved');
  }
}

function initCategoryDragAndDrop(){
  const host=document.getElementById('categoryTree');
  if(!host||host.dataset.dragReady==='1')return;
  host.dataset.dragReady='1';
  const startDrag=item=>{
    categoryDragItem=item;
    item.classList.add('dragging');
    host.classList.add('drag-active');
  };
  const endDrag=()=>{
    const item=categoryDragItem;
    categoryDragItem=null;
    categoryTouchDragId=null;
    host.classList.remove('drag-active');
    clearCategoryDropCues(host);
    if(item)item.classList.remove('dragging','touch-dragging');
    return item;
  };
  const saveOrder=async item=>{
    if(!item)return;
    try{await persistCategoryOrder(item)}catch(error){console.error(error);toast('Could not save the new order.',true)}
  };

  host.addEventListener('dragstart',event=>{
    const item=event.target.closest('[data-drag]');
    if(!item||!host.contains(item))return;
    // Buttons inside a row must stay clickable instead of starting a drag.
    if(event.target.closest('button,input,select,textarea,a')){event.preventDefault();return}
    startDrag(item);
    if(event.dataTransfer){
      event.dataTransfer.effectAllowed='move';
      try{event.dataTransfer.setData('text/plain',item.dataset.drag||'item')}catch(error){}
    }
  });
  host.addEventListener('dragover',event=>{
    if(!categoryDragItem)return;
    clearCategoryDropCues(host);
    const target=event.target.closest('[data-drag]');
    if(!categoryDropAllowed(categoryDragItem,target))return;
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='move';
    const rect=target.getBoundingClientRect();
    target.classList.add(event.clientY>rect.top+rect.height/2?'drop-after':'drop-before');
  });
  host.addEventListener('drop',event=>{
    const item=categoryDragItem;
    const target=event.target.closest('[data-drag]');
    if(!item||!categoryDropAllowed(item,target))return;
    event.preventDefault();
    const rect=target.getBoundingClientRect();
    target.parentElement.insertBefore(item,event.clientY>rect.top+rect.height/2?target.nextSibling:target);
    saveOrder(endDrag());
  });
  host.addEventListener('dragend',()=>{endDrag()});

  /* Touch / pen fallback: the handle drives a pointer drag (no drag events on touch). */
  host.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse')return;
    const handle=event.target.closest('.drag-handle');
    if(!handle)return;
    const item=handle.closest('[data-drag]');
    if(!item||!host.contains(item))return;
    event.preventDefault();
    categoryTouchDragId=event.pointerId;
    startDrag(item);
    // The dragged row must not sit under the finger, or elementFromPoint() only ever finds itself.
    item.classList.add('touch-dragging');
  });
  document.addEventListener('pointermove',event=>{
    if(!categoryDragItem||categoryTouchDragId===null||categoryTouchDragId!==event.pointerId)return;
    event.preventDefault();
    const under=document.elementFromPoint(event.clientX,event.clientY);
    const target=under&&under.closest?under.closest('[data-drag]'):null;
    if(!categoryDropAllowed(categoryDragItem,target))return;
    const rect=target.getBoundingClientRect();
    target.parentElement.insertBefore(categoryDragItem,event.clientY>rect.top+rect.height/2?target.nextSibling:target);
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(categoryTouchDragId===null||categoryTouchDragId!==event.pointerId)return;
    saveOrder(endDrag());
  });
  document.addEventListener('pointercancel',event=>{
    if(categoryTouchDragId===null||categoryTouchDragId!==event.pointerId)return;
    endDrag();
  });
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
  await persistCategoryStructure();
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
    if(!category){category={id:uid('category'),type,name,subcategories:[]};await put('categories',category);state.categories.push(category)}
    else selectedName=category.name;
  }
  await persistCategoryStructure();
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
    state.categories=state.categories.filter(c=>c.id!==id);
    await remove('categories',id);await persistCategoryStructure();await loadState();renderCategoryTree();renderAll();toast('Category deleted');
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
  await persistCategoryStructure();
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
  await persistCategoryStructure();
  await loadState();renderCategoryTree();renderAll();toast('Subcategory renamed');
}
async function deleteSubcategory(categoryId,name){
  const category=state.categories.find(c=>c.id===categoryId);if(!category||!name)return;
  if(category.subcategories.length<=1){toast('A category needs at least one subcategory. Add another one first.',true);return}
  const linked=state.records.some(r=>r.type===category.type&&r.category===category.name&&r.subcategory===name);
  if(linked){toast('This subcategory has linked records and cannot be deleted.',true);return}
  if(await confirm(`Delete subcategory "${name}"?`,`Delete Subcategory`)){
    category.subcategories=category.subcategories.filter(s=>s!==name);
    await put('categories',category);await persistCategoryStructure();await loadState();renderCategoryTree();renderAll();toast('Subcategory deleted');
  }
}

function renderSettings(){
  document.getElementById('currencySetting').value=state.settings.currency||'BDT';
  document.getElementById('localeSetting').value=state.settings.locale||'en-BD';
  renderYearList();
  renderMigrationHistory();
  renderITMigrationHistory();
  renderStorageInfo();
  renderDriveSyncCard();
  showSettingsTab(settingsTab);
}
/* Settings sub-pages share one responsive container. Desktop keeps the two-column
   .settings-grid inside every panel; on phones each panel turns into one full-width
   column (.settings-mobile-wrap) with 12px gutters and 100%-wide fields. */
let settingsLayoutBound=false;
function applySettingsMobileLayout(){
  const page=document.getElementById('settingsPage');
  if(!page)return;
  const mobile=!!(window.matchMedia&&window.matchMedia('(max-width: 768px)').matches);
  page.classList.toggle('settings-page-mobile',mobile);
  page.querySelectorAll('.settings-grid').forEach(wrap=>wrap.classList.toggle('settings-mobile-wrap',mobile));
  if(!settingsLayoutBound&&window.matchMedia){
    settingsLayoutBound=true;
    const query=window.matchMedia('(max-width: 768px)');
    const sync=()=>applySettingsMobileLayout();
    if(query.addEventListener)query.addEventListener('change',sync);
    else if(query.addListener)query.addListener(sync);
  }
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
  await reconcileOfficeCarryForwards();
  renderSettings();renderDashboardFilters();renderOfficePage();toast('Income year added');
}
async function deleteIncomeYear(year){
  if(await confirm(`Delete income year ${year}?`,'Delete Income Year')){
    state.settings.incomeYears=(state.settings.incomeYears||[]).filter(y=>String(y)!==String(year));
    await put('settings',{key:'incomeYears',value:state.settings.incomeYears});
    await reconcileOfficeCarryForwards();
    renderSettings();renderDashboardFilters();renderOfficePage();toast('Income year deleted');
  }
}

async function createBackup(){
  if(!window.JSZip){toast('ZIP library is unavailable. Check your internet connection.',true);return}
  try{
    await loadState();
    const settings=await getAll('settings');
    const zip=new JSZip();
    const backup={
      records:[...state.records,...(state.deductedRecords||[])],
      categories:state.categories,
      incomeExpenses:state.incomeExpenses,
      officePurchases:state.officePurchases,
      incomeGroups:state.incomeGroups,
      categoryStructure:await readCategoryStructure(),
      migrationHistory:state.migrationHistory,
      documents:state.documents.map(({blob,...doc})=>doc),
      settings:settings.reduce((out,s)=>(out[s.key]=s.value,out),{}),
      backupDate:new Date().toISOString(),
      version:'1.1'
    };
    zip.file('backup.json',JSON.stringify(backup,null,2));
    zip.file('metadata.json',JSON.stringify({name:'Personal Finance Management System',version:'1.1',database:DB_NAME,createdAt:backup.backupDate,records:state.records.length,incomeExpenses:state.incomeExpenses.length,officePurchases:state.officePurchases.length,documents:state.documents.length},null,2));
    const folder=zip.folder('documents');
    for(const doc of state.documents){
      const bytes=await getDocBlob(doc.id);                 // read each PDF only while it is being written
      const kind={Income:'income',Expense:'expenses',Liability:'liabilities',Inflow:'office',Outflow:'office'}[doc.financialType]||'assets';
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
  let restoreOk=false;
  try{
    isRestoring=true;                                      // no auto-backup may start while the database is rewritten
    clearTimeout(googleDriveBackupTimer);googleDriveBackupTimer=null;
    const zip=await JSZip.loadAsync(restoreFile);
    const backupFile=zip.file('backup.json');if(!backupFile)throw new Error('Missing backup.json');
    const backup=JSON.parse(await backupFile.async('text'));
    if(!backup.records||!backup.categories||backup.version!==undefined&&Number.parseFloat(backup.version)<1)throw new Error('Unsupported or invalid backup format');
    const incomeExpenses=backup.incomeExpenses||[];
    const officePurchases=backup.officePurchases||[];
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

    // The file is valid: keep a safety copy of the current data in Drive before replacing it.
    let safetySaved=false;
    if(mode==='replace')safetySaved=await saveDriveSafetySnapshot('before manual restore');
    if(mode==='replace'){
      // One transaction per store: a quota failure leaves that store untouched instead of half written.
      await replaceStore('categories',backup.categories||[]);
      await replaceStore('records',backup.records||[]);
      await replaceStore('incomeGroups',incomeGroups);
      await replaceStore('incomeExpenses',incomeExpenses);
      await replaceStore('officePurchases',officePurchases);
      await replaceStore('migrationHistory',migrationHistory);
      await replaceStore('documents',documents);
      await replaceStore('documentBlobs',blobs);
    }else{
      for(const category of backup.categories||[]){if(!await getOne('categories',category.id))await put('categories',category)}
      for(const record of backup.records||[]){if(!await getOne('records',record.id))await put('records',record)}
      for(const group of incomeGroups){if(!await getOne('incomeGroups',group.id))await put('incomeGroups',group)}
      for(const entry of incomeExpenses){if(!await getOne('incomeExpenses',entry.id))await put('incomeExpenses',entry)}
      for(const entry of officePurchases){if(!await getOne('officePurchases',entry.id))await put('officePurchases',entry)}
      for(const mig of migrationHistory){if(!await getOne('migrationHistory',mig.id))await put('migrationHistory',mig)}
      for(const document of documents){if(!await getOne('documents',document.id))await put('documents',document)}
      for(const blob of blobs){if(!await getOne('documentBlobs',blob.id))await put('documentBlobs',blob)}
    }
    // Protected structure: the backup may only ADD rows, never replace or clear the saved tree.
    await mergeCategoryStructure(backup.categoryStructure||{categories:backup.categories||[],incomeGroups});
    // Old backups still use the "Cash" labels: align them with the definitive Cash & Bank Account.
    await migrateLegacyCashRecords();
    for(const [key,value] of Object.entries(backup.settings||{})){
      if(/^drive/i.test(key))continue;
      const restoredValue=mode==='merge'&&key==='zakatRecords'
        ?mergeZakatRecordLists((await getOne('settings',key))?.value,value)
        :(mode==='merge'&&key==='incomeTax'?mergeIncomeTaxData((await getOne('settings',key))?.value,value):value);
      await put('settings',{key,value:restoredValue});
    }   // Drive sync state stays local
    await loadState();
    state.settings=(await getAll('settings')).reduce((out,s)=>(out[s.key]=s.value,out),state.settings||{});
    loadZakatState();
    renderAll();
    toast(`Backup restored: ${backup.records?.length||0} record(s), ${incomeExpenses.length} transaction(s), ${officePurchases.length} office entr${officePurchases.length===1?'y':'ies'} and ${blobs.length} document(s)${safetySaved?' · Drive safety copy of the previous data saved':''}`);
    restoreOk=true;
  }catch(error){
    console.error(error);toast(error.message||'Unable to restore backup.',true);
  }finally{
    restoreFile=null;document.getElementById('restoreFile').value='';
    isRestoring=false;
    if(restoreOk)scheduleDriveAutoBackup();                // the restored data becomes the newest Drive backup
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
  const filters=recordsPageFilterState();
  const records=recordsPageFilteredRecords(filters);
  if(!records.length){toast('No records match the current filters.',true);return}
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
  XLSX.writeFile(workbook,`Financial-Records-${filters.year||'All-Years'}-${todayISO()}.xlsx`);
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
  schema.fields.filter(f=>!f.transient).forEach(f=>cols.push({key:f.key,aliases:f.excel||[],type:f.type,norm:f.normalize}));
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
    for(const f of schema.fields.filter(f=>!f.transient)){
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
async function runImport(file,replaceId,options={}){
  if(!file)return;
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  if(file.size>MAX_IMPORT_BYTES){toast('That file is larger than 30 MB. Split it and import the parts.',true);return}
  try{
    const isCsv=/\.csv$/i.test(file.name||'');
    if(!isCsv){
      const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'});
      const first=workbook.SheetNames[0];
      const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[first],{header:1,defval:'',raw:true});
      // A filled migration template / export is a flat two-sheet workbook, so it is routed first.
      if(isMigrationTemplateWorkbook(workbook)){
        return await importMigrationTemplateWorkbook(workbook,replaceId,file.name,options);
      // The dedicated office ledger has its own FY-sheet shape, so route it before the asset/income readers.
      }else if(isOfficeWorkbook(workbook)){
        // Never move Cash & Bank balances without asking: the popup carries the "I Do not want to
        // change Account" confirmation for this file (and keeps the replace batch id).
        openOfficeImportModal({file,workbook,replaceId,noAccountChange:!!options.noAccountChange,pdfFile:options.pdfFile||null});
      }else if(detectBudgeHeader(aoa)>=0){
        return await importBudgeFile(aoa,file.name,replaceId,options);
      }else if(isIncomeExpensesWorkbook(workbook)){
        return await importIncomeExpensesWorkbook(workbook,replaceId,file.name,options);
      }else{
        return await importAssetsLiabilitiesWorkbook(workbook,replaceId,file.name,options);
      }
    }else{
      const text=(await file.text()).replace(/^\uFEFF/,'');
      const wb=XLSX.read(text,{type:'string',raw:true});
      const aoa=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:true});
      if(detectBudgeHeader(aoa)>=0){
        return await importBudgeFile(aoa,file.name,replaceId,options);
      }else{
        const officeBook=officeWorkbookFromCsv(text,file.name);
        if(officeBook&&isOfficeWorkbook(officeBook)){
          openOfficeImportModal({file,workbook:officeBook,replaceId,noAccountChange:!!options.noAccountChange,pdfFile:options.pdfFile||null});
        }else{
          toast('That CSV file is not a recognised Budge export.',true);
        }
      }
    }
  }catch(error){
    console.error(error);toast(error.message||'Unable to import file.',true);
  }
}

async function importExcel(event){
  const file=event.target.files[0];
  const pdfFile=migrationPdfDraft;
  try{
    const pdfAttached=await runImport(file,null,{pdfFile});
    if(pdfFile&&pdfAttached>0)clearMigrationPdf();
  }finally{event.target.value='';}
}
/** File chosen via the migration editor's "Replace" button: re-import into the same batch. */
async function replaceMigrationFile(event){
  const file=event.target.files[0],migId=replaceMigrationId;
  event.target.value='';
  if(!file||!migId)return;
  const mig=state.migrationHistory.find(m=>m.id===migId);
  if(mig)document.getElementById('migrationEditModal').close();
  // The editor has no checkbox: keep the choice the batch was originally imported with.
  const batchRows=[...(state.incomeExpenses||[]),...(state.officePurchases||[]).filter(r=>!isOfficeOpeningType(r.type))].filter(r=>r.migrationId===migId);
  const noAccountChange=batchRows.length>0&&batchRows.every(r=>r.noAccountChange);
  const pdfFile=migrationPdfDraft;
  const pdfAttached=await runImport(file,migId,{noAccountChange,pdfFile});
  if(pdfFile&&pdfAttached>0)clearMigrationPdf();
  replaceMigrationId=null;
}

/* ==========================================================================
   Filter-wise reports (PDF via jsPDF + AutoTable, Excel via SheetJS)
   ========================================================================== */
function describeFilters(){
  const f=recordsPageFilterState();
  return [
    ['Type',f.type||'All'],['Category',f.category||'All'],['Subcategory',f.subcategory||'All'],
    ['Income Year',f.year||'All'],['Search',f.search||'All']
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
        // Transfers are listed (they are visible records) but their amount is not money held, so it
        // never enters the subtotal - otherwise the same balance would be counted twice.
        const total=recs.reduce((s,r)=>s+(isTransferRecord(r)?0:recordAmount(r)),0);
        return {name,records:recs,schema:getSchema(g.category,name),cols:reportColumns(getSchema(g.category,name),recs),total};
      });
    g.total=g.tables.reduce((s,t)=>s+t.total,0);
    g.count=g.records.length;
    g.orient=Math.max(...g.tables.map(t=>t.cols.length))>5?'l':'p';
  });
  return groups;
}
/** Date first · schema columns (only those with data) in the middle · Amount / Balance last. */
function reportColumns(schema,recs){
  const mids=schema.fields.filter(f=>!f.transient).map(f=>({key:f.key,label:f.label,kind:f.type==='money'?'money':'text',required:f.required}));
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
  const v=reportPlainText(r[col.key]);
  return v||'-';
}

async function generatePdfReport(){
  const filters=recordsPageFilterState();
  const records=recordsPageFilteredRecords(filters);
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
        foot:[[{content:`${single?`Category Subtotal - ${g.category}`:`Subtotal - ${t.name}`}${t.records.some(isTransferRecord)?' (excl. transfers)':''}`,colSpan:n-1,styles:{halign:'right'}},{content:pdfMoney(t.total),styles:{halign:'right'}}]],
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
  doc.save(`Personal-Finance-Report-${filters.year||'All-Years'}-${todayISO()}.pdf`);
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
  const filters=recordsPageFilterState();
  const records=recordsPageFilteredRecords(filters);
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
      const transferCells=[];                // amounts that must stay out of the SUM (see groupRecordsForReport)
      t.records.forEach(r=>{
        const rowIndex=rows.length;
        rows.push(t.cols.map((c,ci)=>{
          const v=reportCellValue(r,c);
          if(c.key==='date'&&v!=='')opts.dates.push([rowIndex,ci]);
          if((c.kind==='money'||c.kind==='amount')&&v!=='')opts.money.push([rowIndex,ci]);
          return v;
        }));
        if(isTransferRecord(r))transferCells.push(`${letter}${rowIndex+1}`);
      });
      const lastData=rows.length-1;
      // subtotal row (formula + cached value)
      const subRow=new Array(n).fill('');
      const hasTransfer=t.records.some(isTransferRecord);
      subRow[n-2>=0?n-2:0]=`${single?`Category Subtotal - ${g.category}`:`Subtotal - ${t.name}`}${hasTransfer?' (excl. transfers)':''}`;
      const subIndex=rows.length;
      rows.push(subRow);
      const sumRange=`${letter}${firstData+1}:${letter}${lastData+1}`;
      const sumFormula=transferCells.length?`SUM(${sumRange})-SUM(${transferCells.join(',')})`:`SUM(${sumRange})`;
      opts.formulas.push([subIndex,amountIdx,sumFormula,plainMoney(t.total)]);
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
  XLSX.writeFile(workbook,`Personal-Finance-Report-${filters.year||'All-Years'}-${todayISO()}.xlsx`);
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
  const trendCanvas=document.getElementById('incomeTrendChart'),expenseCanvas=document.getElementById('expenseCategoryChart');
  if(!window.Chart||!trendCanvas||!expenseCanvas)return;
  const theme=chartTheme();
  const base=baseChartOptions(theme);
  const legend=chartLegend(theme);
  const scales=chartScales(theme);
  const months=['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];
  const incomeBy=[],expenseBy=[];
  for(let m=1;m<=12;m++){
    incomeBy.push(records.filter(r=>r.type==='Income'&&fiscalMonthFromDate(r.date)===m).reduce((s,r)=>s+(Number(r.amount)||0),0));
    expenseBy.push(records.filter(r=>r.type==='Expense'&&fiscalMonthFromDate(r.date)===m).reduce((s,r)=>s+(Number(r.amount)||0),0));
  }
  // FY view = all 12 fiscal months; 3M/6M show the tail of the fiscal year.
  const span=Math.min(12,Math.max(1,dashboardChartState.trendMonths||12));
  const offset=12-span;
  charts.incomeTrendChart=new Chart(trendCanvas,{type:'bar',data:{labels:months.slice(offset),datasets:[
    {label:'Income',data:incomeBy.slice(offset),backgroundColor:'#10b981',hoverBackgroundColor:'#34d399',borderRadius:8,borderSkipped:false,maxBarThickness:30},
    {label:'Expenses',data:expenseBy.slice(offset),backgroundColor:'#f43f5e',hoverBackgroundColor:'#fb7185',borderRadius:8,borderSkipped:false,maxBarThickness:30}
  ]},options:Object.assign({},base,{scales,plugins:{legend,tooltip:chartTooltip(theme)}})});
  const groupKey=dashboardChartState.expenseGrouping==='category'?'category':'majorHead';
  const group=Object.entries(records.filter(r=>r.type==='Expense').reduce((out,r)=>{const label=r[groupKey]||'Unassigned';out[label]=(out[label]||0)+(Number(r.amount)||0);return out},{})).sort((a,b)=>b[1]-a[1]);
  charts.expenseCategoryChart=new Chart(expenseCanvas,{type:'doughnut',data:{labels:group.map(x=>x[0]),datasets:[{data:group.map(x=>x[1]),backgroundColor:group.map((x,i)=>CHART_COLORS[i%CHART_COLORS.length]),borderWidth:0,hoverOffset:9}]},options:Object.assign({},base,{cutout:'62%',interaction:{mode:'nearest',intersect:true},plugins:{legend,tooltip:chartTooltip(theme,{share:true})}})});
}
function renderRecentIncome(records){
  const countEl=document.getElementById('recentIncomeCount'),tableEl=document.getElementById('recentIncomeTable');
  if(!countEl||!tableEl)return;
  const list=records.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,8);
  countEl.textContent=`${list.length} of ${records.length} recent`;
  tableEl.innerHTML=`<thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Category</th><th scope="col">Subcategory</th><th scope="col">Description</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${list.map(r=>{
    const sign=r.type==='Income'?'+':'−';
    return `<tr><td>${esc(fmtDate(r.date)||'—')}</td><td><span class="badge ${r.type.toLowerCase()}">${esc(r.type)}</span></td><td>${catLabel(r.category,r.type)}</td><td>${catLabel(r.subcategory,r.type)}</td><td>${esc(r.description||'—')}</td><td class="num"><strong class="amount ${r.type.toLowerCase()}">${sign}${formatMoney(r.amount)}</strong></td></tr>`;
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
    return `<tr style="--i:${i}"><td>${esc(fmtDate(r.date)||'—')}</td><td><span class="badge ${r.type.toLowerCase()}">${esc(r.type)}</span></td><td>${catLabel(r.majorHead,r.type)}</td><td>${catLabel(r.category,r.type)}</td><td>${catLabel(r.subcategory,r.type)}</td><td>${esc(r.account||'—')}</td><td>${esc(r.description||'—')}</td><td class="num"><strong class="amount ${r.type.toLowerCase()}">${sign}${formatMoney(r.amount)}</strong></td><td class="actions-cell"><button type="button" class="action-link" data-cmd="view-income" data-id="${id}">View</button><button type="button" class="action-link" data-cmd="edit-income" data-id="${id}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-income" data-id="${id}">Delete</button>${receipt}</td></tr>`;
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
    const kind=isExpense?'Expense':'Income';
    const rows=sec.heads.map(h=>`<tr class="bd-major"><td>${catLabel(h.name,kind)}</td><td>${formatMoney(h.total)}</td></tr>`+
      h.cats.map(c=>`<tr class="bd-cat"><td>${catLabel(c.name,kind)}</td><td>${formatMoney(c.total)}</td></tr>`+
        c.subs.map(s=>`<tr class="bd-sub"><td>${catLabel(s.name,kind)}</td><td>${formatMoney(s.total)}</td></tr>`).join('')).join('')).join('');
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
  // Account / Payment Method is sourced strictly from Manage Categories -> Asset · Cash & Bank
  // subcategories (deduplicated case-insensitively, so "bKash" / "bkash" is one option).
  const savedAccount=record?String(record.account||'').replace(/\s+/g,' ').trim():'';
  const configuredAccount=officeAccountOption(savedAccount);
  const accountLabel=configuredAccount?configuredAccount.label:savedAccount;
  const accountChoices=officeAccountChoices();
  const defaultAccount=accountLabel||accountChoices.find(name=>name.toLowerCase()==='cash in hand')||accountChoices[0]||'';
  const extraAccount=accountLabel&&!accountChoices.some(name=>name.toLowerCase()===accountLabel.toLowerCase())?accountLabel:'';
  const incomeAccountOptions=[
    ...(accountChoices.length
      ?accountChoices.map(a=>`<option value="${esc(a)}" ${a===defaultAccount?'selected':''}>${esc(a)}</option>`)
      :['<option value="">No Cash &amp; Bank account in Settings</option>']),
    ...(extraAccount?[`<option value="${esc(extraAccount)}" selected>${esc(extraAccount)} (not in Cash &amp; Bank)</option>`]:[])
  ].join('');
  document.getElementById('incomeFormFields').innerHTML=`<div class="income-form-grid">
    <label><span class="lbl">Transaction Type *</span><select id="incomeTypeSelect" required><option value="Income" ${startType==='Income'?'selected':''}>Income</option><option value="Expense" ${startType==='Expense'?'selected':''}>Expense</option></select></label>
    <label><span class="lbl">Date *</span><input id="incomeDate" type="date" required value="${esc(dateValue)}"></label>
    <label><span class="lbl">Major Head *</span><select id="incomeMajorHeadSelect" required></select></label>
    <label><span class="lbl">Category *</span><select id="incomeCategorySelect" required></select></label>
    <label><span class="lbl">Subcategory *</span><select id="incomeSubcategorySelect" required></select></label>
    <div class="income-account-field"><label><span class="lbl">Account / Payment Method</span><select id="incomeAccount">${incomeAccountOptions}</select></label><label class="office-account-check income-account-check"><span class="office-check-row"><input type="checkbox" id="incomeNoAccountChange" ${record?.noAccountChange?'checked':''}><span>I Do not want to change Account</span></span></label></div>
    <label><span class="lbl">Amount (BDT) *</span><span class="calc-field"><input id="incomeAmount" type="number" step="0.01" min="0" inputmode="decimal" required value="${esc(record?record.amount:'')}" placeholder="0.00"><button type="button" class="calc-trigger" data-calc-target="incomeAmount" aria-label="Open calculator for Amount (BDT)" aria-haspopup="dialog" aria-controls="calcPopover" aria-expanded="false" title="Calculator"><svg class="ic" aria-hidden="true"><use href="#i-calc"/></svg></button></span></label>
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
    setFieldIcon('incomeMajorHeadSelect',majorSel.value,typeSel.value);
    updateCategory();
  };
  const updateCategory=()=>{
    const cats=incomeCategoriesFor(majorSel.value);
    catSel.innerHTML=cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if(record&&record.majorHead===majorSel.value&&cats.includes(record.category))catSel.value=record.category;
    else if(defaults.category&&cats.includes(defaults.category))catSel.value=defaults.category;
    setFieldIcon('incomeCategorySelect',catSel.value,typeSel.value);
    updateSubcategory();
  };
  const updateSubcategory=()=>{
    const subs=incomeSubcategoriesFor(majorSel.value,catSel.value);
    subSel.innerHTML=(subs.length?subs:[catSel.value].filter(Boolean)).map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if(record&&record.category===catSel.value&&subs.includes(record.subcategory))subSel.value=record.subcategory;
    else if(defaults.subcategory&&subs.includes(defaults.subcategory))subSel.value=defaults.subcategory;
    setFieldIcon('incomeSubcategorySelect',subSel.value,typeSel.value);
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
    const accountPick=document.getElementById('incomeAccount').value;
    // Store the Manage Categories spelling, so "bkash" saved earlier merges with "bKash".
    const configuredAccount=officeAccountOption(accountPick);
    const account=configuredAccount?configuredAccount.label:String(accountPick||'').replace(/\s+/g,' ').trim();
    const noAccountChange=!!(document.getElementById('incomeNoAccountChange')?.checked);
    const description=document.getElementById('incomeDescription').value.trim();
    const old=editingIncomeId?state.incomeExpenses.find(r=>r.id===editingIncomeId):null;
    const record=Object.assign({},old||{});
    Object.assign(record,{id:old?old.id:uid('ie'),type,date,incomeYear:fiscalYearFromDate(date),majorHead,category,subcategory,amount,account,description});
    if(noAccountChange)record.noAccountChange=true;else delete record.noAccountChange;
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
    // A form save can move a Cash & Bank balance, so every page that shows a balance refreshes.
    renderAll();
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
    const linked2=record&&record.assetDeduction&&(state.deductedRecords||[]).find(x=>x.id===record.assetDeduction.recordId);
    if(linked2){const restored=Object.assign({},linked2);delete restored.assetDeduction;restored.updatedAt=new Date().toISOString();await put('records',restored)}
    await loadState();renderAll();toast(linked2?'Transaction deleted, item recovered to Assets':'Transaction deleted');
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
  const showCat=(label,value,type)=>`<label><span class="k">${esc(label)}</span><strong class="view-field">${catLabel(value,type)}</strong></label>`;
  document.getElementById('incomeFormFields').innerHTML=`<div class="income-form-grid">${show('Type',r.type)}${show('Date',fmtDate(r.date))}${showCat('Major Head',r.majorHead,r.type)}${showCat('Category',r.category,r.type)}${showCat('Subcategory',r.subcategory,r.type)}${show('Account / Method',r.account)}${show('Amount',formatMoney(r.amount))}${show('Income Year',r.incomeYear)}${show('Description',r.description)}${docSection}</div>`;
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

/* ==========================================================================
   Office Purchase & Bill - a standalone fiscal-year ledger.

   The ledger stays separate: nothing here writes to state.records or
   state.incomeExpenses, so an office entry never becomes a ledger row of its
   own and the Income & Expenses pages are unaffected.

   Cash & Bank effect: an entry linked to a Cash & Bank account reduces that
   account on Outflow and increases it on Inflow. The effect is DERIVED from the
   office ledger itself (see applyOfficeAccountLegs) and never written into the
   global Cash & Bank records, so editing the amount, re-linking the account or
   deleting the entry can never double-count the movement - and the "I Do not
   want to change Account" checkbox simply opts one entry out.
   ========================================================================== */
const OFFICE_CATEGORIES=['Office Purchase','Bill Received','Personal Print','Office Fund','Reimbursement','Opening Balance','Other'];

function isOfficeOpeningType(type){
  return /^(Opening Balance)/i.test(String(type||''));
}
/** Any type that says "Inflow" (or the legacy bare 'Inflow') credits the account; everything else
 *  is a payment. This keeps the four template Entry Type * labels — e.g. "Bill Received (Cash
 *  Inflow)" — classified correctly while plain Outflow/Inflow imports keep working. */
function officeTypeKind(type){
  const value=String(type||'');
  if(/inflow/i.test(value))return 'Inflow';
  return 'Outflow';
}
function normalizeOfficeType(type){
  const value=String(type||'');
  if(/Opening Balance.*Inflow/i.test(value)||/^inflow$/i.test(value))return /Opening/i.test(value)?'Opening Balance (Inflow)':'Inflow';
  if(/Opening Balance.*Outflow/i.test(value)||/^outflow$/i.test(value))return /Opening/i.test(value)?'Opening Balance (Outflow)':'Outflow';
  if(/Bill Received/i.test(value))return 'Bill Received (Cash Inflow)';
  if(/Office Purchase/i.test(value))return 'Office Purchase (Cash Outflow)';
  return value;
}

/** Income Years strictly from Settings (never auto-generated or derived from office entries). */
function officeIncomeYears(){
  return [...new Set((state.settings&&state.settings.incomeYears||[]).map(y=>normIncomeYear(y)).filter(Boolean))]
    .sort((a,b)=>String(b).localeCompare(String(a)));
}
/** Active/default selector: today's fiscal year when configured in Settings, else the newest configured year. */
function officeCurrentYear(){
  const years=officeIncomeYears();
  if(!years.length)return '';
  const current=fiscalYearFromDate(todayISO())||'';
  return years.includes(current)?current:years[0];
}
function officeEntryYear(entry){
  return normIncomeYear(entry&&entry.incomeYear)||fiscalYearFromDate(entry&&entry.date)||'';
}
/** Office FY dropdown: exactly the Settings -> Income Years list. */
function officeYearList(){
  return officeIncomeYears();
}
/* --------------------------------------------------------------------------
   Multi-year Financial Year selection (Office Purchase & Bill)
   "All Financial Years" (or any combination of years) aggregates the ledger
   into one continuous period: the opening balance is the earliest selected
   year's opening, and the closing balance is recalculated from every entry in
   that period, so carry-forwards are never counted twice.
   -------------------------------------------------------------------------- */
function ensureOfficeYearSelection(){
  const years=officeYearList();
  if(!officeYearChosen){
    if(years.length){officeFilters.years=years.slice();officeYearChosen=true}
    else if(!Array.isArray(officeFilters.years))officeFilters.years=[];
    return;
  }
  if(!Array.isArray(officeFilters.years)){officeFilters.years=years.slice();return}
  const valid=officeFilters.years.filter(y=>years.includes(y));
  if(valid.length!==officeFilters.years.length)officeFilters.years=valid;
}
/** Selected years in the Settings order (newest first). Empty = nothing selected. */
function officeSelectedYears(){
  ensureOfficeYearSelection();
  const years=officeYearList();
  return years.filter(y=>(officeFilters.years||[]).includes(y));
}
function officeYearSelectionAll(){
  const years=officeYearList();
  if(!years.length)return true;
  return officeSelectedYears().length===years.length;
}
/** Selected years oldest -> newest, which is the order a period is read in. */
function officePeriodYears(){
  return officeSelectedYears().slice().sort(officeYearSort);
}
/** Human label for the active period, e.g. "FY 2024-25 → 2025-26". */
function officePeriodLabel(){
  const years=officePeriodYears();
  if(!years.length)return 'No Financial Year selected';
  if(years.length===1)return `FY ${years[0]}`;
  return `FY ${years[0]} → ${years[years.length-1]}`;
}
/** Opening balance carry-forward of the whole selected period: the oldest year's opening. */
function officePeriodOpening(){
  const years=officePeriodYears();
  return years.length?officeOpeningBalance(years[0]):0;
}
/**
 * Every entry inside the selected period. Opening-balance rows of later years are
 * carry-forwards already represented by officePeriodOpening(), so they are skipped -
 * that is what keeps a multi-year total from double counting the same money.
 */
function officePeriodEntries(){
  const years=officePeriodYears();
  if(!years.length)return [];
  const first=years[0];
  return (state.officePurchases||[]).filter(entry=>{
    const year=officeEntryYear(entry);
    if(!years.includes(year))return false;
    if(isOfficeOpeningType(entry.type)&&year!==first)return false;
    return true;
  });
}
/** Closing balance of the selected period: oldest opening + every Outflow / Inflow in it. */
function officePeriodClosing(){
  return officePeriodOpening()+officeTotals(officePeriodEntries().filter(r=>!isOfficeOpeningType(r.type))).net;
}
/** Identity of a Cash & Bank account name: trimmed, single-spaced and case-insensitive, so
 *  " bKash ", "Bkash" and "bKASH" are one and the same account everywhere on this page. */
const officeAccountKey=value=>String(value??'').replace(/\s+/g,' ').trim().toLowerCase();
/**
 * Every Cash & Bank account the user maintains in Settings -> Manage Categories: the subcategories
 * of each Asset category named "Cash" / "Cash & Bank". Nothing is hardcoded - add or rename an
 * account in Settings and the dropdown follows. Duplicates across categories (and case variants such
 * as "bKash" / "bkash") collapse into one option; the spelling that appears first wins.
 * @returns {Map<string,{label:string,category:string}>} keyed by officeAccountKey()
 */
function officeAccountIndex(){
  const index=new Map();
  for(const category of state.categories||[]){
    if(category.type!=='Asset'||!isCashCategoryName(category.name))continue;
    for(const raw of category.subcategories||[]){
      const label=String(raw??'').replace(/\s+/g,' ').trim();
      if(!label)continue;
      const key=officeAccountKey(label);
      if(!index.has(key))index.set(key,{label,category:category.name});
    }
  }
  return index;
}
/** Deduplicated Cash & Bank account labels for every account dropdown on the page. */
function officeAccountChoices(){
  return [...officeAccountIndex().values()].map(account=>account.label);
}
/** The configured account behind a stored name (matched case-insensitively), or null. */
function officeAccountOption(name){
  const key=officeAccountKey(name);
  return key?officeAccountIndex().get(key)||null:null;
}
/** An entry moves its Cash & Bank account unless it is an opening-balance row, the user ticked
 *  "I Do not want to change Account", or the account is not configured in Settings any more. */
function officeAccountApplies(entry){
  return !!entry&&!isOfficeOpeningType(entry.type)&&!entry.noAccountChange&&!!officeAccountOption(entry.account);
}
/** Signed Cash & Bank movement of one entry: an inflow adds to the account, an outflow deducts. */
function officeAccountDelta(entry){
  const amount=Math.abs(Number(entry&&entry.amount)||0);
  return officeTypeKind(entry&&entry.type)==='Inflow'?amount:-amount;
}
function officeCategoryChoices(){
  const names=[...OFFICE_CATEGORIES,...(state.officePurchases||[]).map(r=>r.category).filter(Boolean)];
  return [...new Set(names.map(n=>String(n||'').trim()).filter(Boolean))];
}
function officeOpeningBalances(){
  const map=state.settings&&state.settings.officeOpeningBalances;
  return map&&typeof map==='object'&&!Array.isArray(map)?map:{};
}
function officeOpeningBalance(year){
  const entries=(state.officePurchases||[]).filter(r=>isOfficeOpeningType(r.type)&&officeEntryYear(r)===normIncomeYear(year));
  if(entries.length){
    return entries.reduce((sum,r)=>sum+(officeTypeKind(r.type)==='Inflow'?-1:1)*Math.abs(Number(r.amount)||0),0);
  }
  const value=Number(officeOpeningBalances()[year]);
  return Number.isFinite(value)?value:0;
}
/** Outflow is money spent (deducts cash), inflow is money received (adds cash). */
function officeTotals(entries){
  const index=officeAccountIndex();
  const movesAccount=entry=>!isOfficeOpeningType(entry.type)&&!entry.noAccountChange&&index.has(officeAccountKey(entry.account));
  let outflow=0,inflow=0,cashOutflow=0,cashInflow=0;
  for(const entry of entries||[]){
    const amount=Math.abs(Number(entry.amount)||0);
    const kind=officeTypeKind(entry.type);
    if(kind==='Inflow'){inflow+=amount;if(movesAccount(entry))cashInflow+=amount}
    else{outflow+=amount;if(movesAccount(entry))cashOutflow+=amount}
  }
  return {outflow,inflow,net:outflow-inflow,cashOutflow,cashInflow,cashEffect:cashInflow-cashOutflow,count:(entries||[]).length};
}
function officeClosingBalance(entries,opening){
  const regular=(entries||[]).filter(entry=>!isOfficeOpeningType(entry.type));
  return (Number(opening)||0)+officeTotals(regular).net;
}
/**
 * Cash & Bank movements of the office ledger - derived on the fly, exactly like the transfer and
 * funding legs above. Nothing is ever written into state.records, so saving, re-linking, opting out
 * ("I Do not want to change Account") or deleting an entry always leaves the account with the right
 * balance and can never double-count a movement. An opening-balance row is a carried-forward figure,
 * not a payment, so it never touches an account.
 * The same snapshot rule as funding applies: a movement older than the account's newest snapshot is
 * already baked into that snapshot and is therefore skipped; a movement in a later Income Year than
 * the one being reported is ignored for that year.
 */
function applyOfficeAccountLegs(balanceRecords,year){
  const entries=(state.officePurchases||[]).filter(entry=>!isOfficeOpeningType(entry.type)&&!entry.noAccountChange&&entry.account);
  if(!entries.length)return balanceRecords;
  const index=officeAccountIndex();
  if(!index.size)return balanceRecords;
  const range=year?fiscalRange(year):null;
  const cutoff=range?range.to:'';
  const snapshots=new Map();
  const spelling=new Map();
  (balanceRecords||[]).forEach(record=>{
    // Only user-entered snapshots gate a movement - transfer / funding / office legs must not.
    if(!isCashRecord(record)||record.syntheticTransferLeg)return;
    const key=cashSubcategoryKey(record.subcategory);
    if(!spelling.has(key))spelling.set(key,String(record.subcategory||'').trim());
    const effective=cashEffectiveDate(record);
    const snapshot=snapshots.get(key);
    if(!snapshot||effective>snapshot.date)snapshots.set(key,{date:effective,savedAt:String(record.updatedAt||record.createdAt||'')});
  });
  const legs=[];
  for(const entry of entries){
    const account=index.get(officeAccountKey(entry.account));
    if(!account)continue;                                        // account no longer in Settings
    const amount=officeAccountDelta(entry);
    if(!amount)continue;
    const date=normalizeExcelDate(entry.date)||String(entry.date||'').slice(0,10);
    if(cutoff&&date&&date>cutoff)continue;                       // spent in a later Income Year
    const key=cashSubcategoryKey(account.label);
    const snapshot=snapshots.get(key);
    if(snapshot&&snapshot.date&&date){
      if(date<snapshot.date)continue;                            // the snapshot is newer
      if(date===snapshot.date&&snapshot.savedAt>=String(entry.updatedAt||entry.createdAt||''))continue;
    }
    legs.push({
      id:`${entry.id}::office`,syntheticTransferLeg:true,officeEntryId:entry.id,
      // Reuse the spelling the ledger already uses, so a leg merges into its account row instead
      // of creating a second row that differs only by capitalisation.
      type:'Asset',category:account.category,subcategory:spelling.get(key)||account.label,
      particulars:'',accountDetail:'',date,incomeYear:entry.incomeYear||fiscalYearFromDate(date)||'',
      amount,balance:amount,details:'',documentIds:[]
    });
  }
  return legs.length?[...balanceRecords,...legs]:balanceRecords;
}

/**
 * Cash & Bank movements of the Income & Expenses ledger - derived on the fly, the same way as the
 * transfer, funding and office legs. An Expense deducts its amount from the selected Cash & Bank
 * account and an Income adds it; ticking "I Do not want to change Account" (noAccountChange) skips
 * the movement. Nothing extra is written into state.records, so editing the amount, switching the
 * account or deleting the transaction always leaves every account with the right balance.
 * The snapshot rule matches funding: a movement older than the account's newest snapshot is already
 * baked into that snapshot, and a movement in a later Income Year is ignored for the reported year.
 */
function incomeAccountDelta(entry){
  const amount=Math.abs(Number(entry&&entry.amount)||0);
  return String(entry&&entry.type||'').toLowerCase()==='income'?amount:-amount;
}
function applyIncomeAccountLegs(balanceRecords,year){
  const entries=(state.incomeExpenses||[]).filter(entry=>!entry.noAccountChange&&entry.account);
  if(!entries.length)return balanceRecords;
  const index=officeAccountIndex();
  if(!index.size)return balanceRecords;
  const range=year?fiscalRange(year):null;
  const cutoff=range?range.to:'';
  const snapshots=new Map();
  const spelling=new Map();
  (balanceRecords||[]).forEach(record=>{
    // Only user-entered snapshots gate a movement - transfer / funding / office / income legs must not.
    if(!isCashRecord(record)||record.syntheticTransferLeg)return;
    const key=cashSubcategoryKey(record.subcategory);
    if(!spelling.has(key))spelling.set(key,String(record.subcategory||'').trim());
    const effective=cashEffectiveDate(record);
    const snapshot=snapshots.get(key);
    if(!snapshot||effective>snapshot.date)snapshots.set(key,{date:effective,savedAt:String(record.updatedAt||record.createdAt||'')});
  });
  const legs=[];
  for(const entry of entries){
    const account=index.get(officeAccountKey(entry.account));
    if(!account)continue;                                        // account no longer in Settings
    const amount=incomeAccountDelta(entry);
    if(!amount)continue;
    const date=normalizeExcelDate(entry.date)||String(entry.date||'').slice(0,10);
    if(cutoff&&date&&date>cutoff)continue;                       // booked in a later Income Year
    const key=cashSubcategoryKey(account.label);
    const snapshot=snapshots.get(key);
    if(snapshot&&snapshot.date&&date){
      if(date<snapshot.date)continue;                            // the snapshot is newer
      if(date===snapshot.date&&snapshot.savedAt>=String(entry.updatedAt||entry.createdAt||''))continue;
    }
    legs.push({
      id:`${entry.id}::income`,syntheticTransferLeg:true,incomeExpenseId:entry.id,
      // Reuse the spelling the ledger already uses, so a leg merges into its account row.
      type:'Asset',category:account.category,subcategory:spelling.get(key)||account.label,
      particulars:'',accountDetail:'',date,incomeYear:entry.incomeYear||fiscalYearFromDate(date)||'',
      amount,balance:amount,details:'',documentIds:[]
    });
  }
  return legs.length?[...balanceRecords,...legs]:balanceRecords;
}

function officeFiscalYearStart(year){
  const start=parseInt(String(normIncomeYear(year)).slice(0,4),10);
  return Number.isFinite(start)?`${start}-07-01`:'';
}

function officeYearSort(a,b){
  const ay=parseInt(String(a).slice(0,4),10)||0;
  const by=parseInt(String(b).slice(0,4),10)||0;
  return ay-by;
}
async function reconcileOfficeCarryForwards(){
  let changed=false;
  for(const entry of state.officePurchases||[]){
    const normalized=normalizeOfficeType(entry.type);
    if(normalized!==entry.type){entry.type=normalized;changed=true}
  }
  const removeIds=(state.officePurchases||[]).filter(r=>r.openingAuto&&!r.openingOverride).map(r=>r.id);
  if(removeIds.length){
    await removeMany('officePurchases',removeIds);
    changed=true;
  }
  state.officePurchases=(state.officePurchases||[]).filter(r=>!(r.openingAuto&&!r.openingOverride));

  const legacy=officeOpeningBalances();
  // Carry-forward stays strictly inside the ordered Income Years configured in Settings:
  // each year can only carry its closing balance into the *next configured* year, never a phantom year.
  const ordered=[...new Set((state.settings.incomeYears||[]).map(y=>normIncomeYear(y)).filter(Boolean))].sort(officeYearSort);
  const add=[];
  for(let i=0;i<ordered.length;i++){
    const year=ordered[i];
    let openings=(state.officePurchases||[]).filter(r=>isOfficeOpeningType(r.type)&&officeEntryYear(r)===year);
    if(!openings.length){
      const legacyValue=Number(legacy[year]);
      if(Number.isFinite(legacyValue)&&legacyValue!==0){
        const record={
          id:uid('office'),type:legacyValue<0?'Opening Balance (Inflow)':'Opening Balance (Outflow)',
          date:officeFiscalYearStart(year),particulars:'Opening Balance',category:'Opening Balance',
          account:'',notes:'Migrated opening balance',amount:Math.abs(legacyValue),
          incomeYear:year,openingOverride:true,openingImported:true,
          createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
        };
        add.push(record);state.officePurchases.push(record);changed=true;
        openings=[record];
      }
    }
    const opening=openings.reduce((sum,r)=>sum+(officeTypeKind(r.type)==='Inflow'?-1:1)*Math.abs(Number(r.amount)||0),0);
    const regular=(state.officePurchases||[]).filter(r=>officeEntryYear(r)===year&&!isOfficeOpeningType(r.type));
    const close=opening+officeTotals(regular).net;
    if(close!==0){
      const next=ordered[i+1];          // only the next configured Income Year
      if(next){
        const nextManual=(state.officePurchases||[]).filter(r=>isOfficeOpeningType(r.type)&&officeEntryYear(r)===next);
        if(!nextManual.length){
          const record={
            id:uid('office'),type:close>0?'Opening Balance (Outflow)':'Opening Balance (Inflow)',
            date:officeFiscalYearStart(next),particulars:'Opening Balance',category:'Opening Balance',
            account:'',notes:'Automatically carried forward',amount:Math.abs(close),
            incomeYear:next,openingAuto:true,openingOverride:false,
            createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
          };
          add.push(record);state.officePurchases.push(record);changed=true;
        }
      }
    }
  }
  if(add.length)await putMany('officePurchases',add);
  if(changed){
    await loadState();
  }
  return changed;
}
/** Stable chronological order: date, then creation time, then id (so the running net never flickers). */
function officeEntryOrder(a,b){
  return String(a.date||'').localeCompare(String(b.date||''))
    ||String(a.createdAt||'').localeCompare(String(b.createdAt||''))
    ||String(a.id||'').localeCompare(String(b.id||''));
}
/** Running net per entry id, starting from the FY opening balance. */
function officeRunningMap(entries,opening){
  const map=new Map();
  let run=Number(opening)||0;
  for(const entry of [...(entries||[])].sort(officeEntryOrder)){
    run+=(officeTypeKind(entry.type)==='Inflow'?-1:1)*(Math.abs(Number(entry.amount)||0));
    map.set(entry.id,run);
  }
  return map;
}
/** Guesses the Cash & Bank account from the workbook wording (used only while importing).
 *  Only accounts configured in Settings are ever returned, so an import can never invent an
 *  account that does not exist in Manage Categories. */
function guessOfficeAccount(particulars){
  const text=String(particulars||'');
  if(!text.trim())return '';
  const options=officeAccountChoices();
  const exact=options.find(name=>text.toLowerCase().includes(name.toLowerCase()));
  if(exact)return exact;
  const pick=re=>options.find(name=>re.test(name))||'';
  if(/basic\s*bank|basic\s*a\/c/i.test(text))return pick(/basic/i);
  if(/bkash|bikash/i.test(text))return pick(/bkash/i);
  if(/\bcash\b/i.test(text))return pick(/cash/i);
  if(/\bcard\b/i.test(text))return pick(/card/i);
  return '';
}
/** Import classification: inflows become office funds / print income, outflows are purchases. */
function guessOfficeCategory(type,particulars){
  const text=String(particulars||'');
  if(officeTypeKind(type)==='Inflow'){
    if(/print/i.test(text))return 'Personal Print';
    if(/bill/i.test(text))return 'Bill Received';
    return 'Office Fund';
  }
  return 'Office Purchase';
}

/**
 * Header map for the column-per-field template / CSV layout:
 * Date * | Entry Type * | Particulars * | Category * | Cash & Bank | Amount (Taka) * | Notes.
 * Returns null when the row is not that layout (e.g. the legacy side-by-side export).
 */
function officeFlatColumns(headerRow){
  const keys=(Array.isArray(headerRow)?headerRow:[]).map(cell=>nrm(cell).replace(/\*/g,'').trim());
  const find=test=>keys.findIndex(key=>test(key));
  const type=find(key=>key==='entry type'||key==='type');
  const amount=find(key=>/^amount\b/.test(key));
  if(type<0||amount<0)return null;
  return {
    date:find(key=>/^date\b/.test(key)),
    type,
    particulars:find(key=>/^(particulars|detail|description)\b/.test(key)),
    category:find(key=>/^category\b/.test(key)),
    account:find(key=>/^(cash\s*&\s*bank|account|cash and bank)\b/.test(key)),
    amount,
    notes:find(key=>/^(notes|reference)\b/.test(key))
  };
}
/** Finds the flat header anywhere in the first 10 rows (the template uses row 3). */
function officeFlatLayout(rows){
  for(let r=0;r<Math.min(rows.length,10);r++){
    const cols=officeFlatColumns(rows[r]);
    if(cols)return {headerIndex:r,cols};
  }
  return null;
}
/** Exact Entry Type * label chosen from the template dropdown; empty cells fall back to a guess. */
function officeFlatType(value,detail){
  const text=String(value??'').replace(/\s+/g,' ').trim();
  if(!text)return /bill|fund|top-?up|reimburs/i.test(String(detail||''))
    ? 'Bill Received (Cash Inflow)':'Office Purchase (Cash Outflow)';
  if(/^opening balance\b/i.test(text))return /inflow/i.test(text)?'Opening Balance (Inflow)':'Opening Balance (Outflow)';
  if(/bill received|inflow/i.test(text))return 'Bill Received (Cash Inflow)';
  if(/office purchase|outflow/i.test(text))return 'Office Purchase (Cash Outflow)';
  return text;
}
/** A configured account keeps its Settings spelling; any other name is preserved verbatim. */
function officeFlatAccount(value){
  const text=String(value??'').replace(/\s+/g,' ').trim();
  if(!text||!/[a-z]/i.test(text)||normalizeExcelDate(value))return '';
  const configured=officeAccountOption(text);
  return configured?configured.label:text;
}
/** Column-per-field sheet reader (the downloadable template and its CSV export). */
function parseOfficeFlatSheet(rows,sheetName,fy,layout){
  const {headerIndex,cols}=layout;
  const fallbackDate=(fiscalRange(fy)||{}).from||'';
  const cell=(row,index)=>index>=0?row[index]:'';
  const mapped=[cols.date,cols.type,cols.particulars,cols.category,cols.account,cols.amount,cols.notes].filter(index=>index>=0);
  const entries=[];
  const occurrences=new Map();
  let skipped=0,unnamed=0,undated=0,untyped=0;
  for(let r=headerIndex+1;r<rows.length;r++){
    const row=rows[r]||[];
    // The hidden dropdown lists live in columns J/K; only mapped columns make a row meaningful.
    if(!mapped.some(index=>String(row[index]??'').trim()))continue;
    const lead=nrm(cell(row,cols.date)||cell(row,cols.particulars));
    if(/^(total|grand total|closing balance|carried forward)\b/.test(lead))break;
    const detail=String(cell(row,cols.particulars)??'').replace(/\s+/g,' ').trim();
    const amount=Math.abs(parseExcelNumber(cell(row,cols.amount)));
    if(!amount){
      // A detail line without a readable amount is a memo/note row — reported, never imported.
      if(detail)skipped++;
      continue;
    }
    const rawType=String(cell(row,cols.type)??'').trim();
    if(!rawType)untyped++;
    const type=officeFlatType(rawType,detail);
    let date=normalizeExcelDate(cell(row,cols.date));
    if(date&&(Number(date.slice(0,4))<1990||Number(date.slice(0,4))>2100))date='';
    if(!date)undated++;
    const iso=date||fallbackDate;
    const particulars=detail||(officeTypeKind(type)==='Inflow'?'Cash Inflow':'Cash Outflow');
    if(!detail)unnamed++;
    const category=String(cell(row,cols.category)??'').replace(/\s+/g,' ').trim()||guessOfficeCategory(type,particulars);
    const account=officeFlatAccount(cell(row,cols.account));
    const base=[sheetName,type,iso,particulars,amount.toFixed(2)].join('|');
    const seen=(occurrences.get(base)||0)+1;
    occurrences.set(base,seen);
    entries.push({type,date:iso,particulars,amount,category,account,
      sourceSheet:sheetName,sourceRow:r+1,
      importHash:hashString(['office',base,seen].join('|'))});
  }
  return {fy,entries,openingBalance:null,skipped,unnamed,undated,untyped,detected:true};
}

/**
 * Reads one FY sheet of "Office Purchase & Bill.xlsx".
 * Layout: left block A-C = Date / Detail / Amount (cash outflow), right block E-G =
 * Date / Detail / Amount (cash inflow), row 4 holds the brought-forward "Balance".
 * The downloadable template (and a CSV of it) uses the flat Date / Entry Type / Particulars /
 * Category / Cash & Bank / Amount layout instead and is read by parseOfficeFlatSheet().
 * Parsing stops at the "Total" row; blank rows and the Print footer are ignored.
 * @returns {{fy:string,entries:Array,openingBalance:number|null,skipped:number,detected:boolean}}
 */
function parseOfficeSheet(aoa,sheetName){
  const fy=normIncomeYear(sheetName);
  const rows=Array.isArray(aoa)?aoa:[];
  const flat=officeFlatLayout(rows);
  if(flat)return parseOfficeFlatSheet(rows,sheetName,fy,flat);
  const headerIndex=rows.slice(0,8).findIndex(row=>{
    const cells=(row||[]).map(cell=>nrm(cell));
    return cells.includes('cash outflow')||cells.includes('cash inflow')
      ||(cells.includes('date')&&cells.some(cell=>cell.includes('amount')));
  });
  if(headerIndex<0)return {fy,entries:[],openingBalance:null,skipped:0,unnamed:0,undated:0,untyped:0,detected:false};
  const fallbackDate=(fiscalRange(fy)||{}).from||'';
  const entries=[];
  const occurrences=new Map();
  let openingBalance=null,skipped=0,unnamed=0,undated=0;
  /**
   * The real workbook keeps the inflow block in E-G, but several sheets have the inflow dates
   * typed one column left (D). A numeric serial such as the row's serial number would look like
   * January 1900, so only plausible calendar years are accepted.
   */
  const plausibleDate=(value)=>{
    const iso=normalizeExcelDate(value);
    if(!iso)return '';
    const year=Number(iso.slice(0,4));
    return year>=1990&&year<=2100?iso:'';
  };
  /** Exported workbooks carry a "Cash & Bank" column (D on the outflow side, H on the inflow side). */
  const carriesAccounts=rows.slice(0,8).some(row=>{
    const cells=(row||[]).map(cell=>nrm(cell));
    return (cells[3]&&cells[3].includes('cash'))||(cells[7]&&cells[7].includes('cash'));
  });
  /** A configured account is stored with its Settings spelling; anything else is kept verbatim so
   *  re-importing an export never loses an account that was removed from Settings meanwhile. */
  const accountCell=(value)=>{
    const text=String(value??'').replace(/\s+/g,' ').trim();
    if(!text||!/[a-z]/i.test(text)||plausibleDate(value))return '';
    const configured=officeAccountOption(text);
    if(configured)return configured.label;
    return carriesAccounts?text:'';
  };
  const push=(type,date,detail,amount,rowNumber,account)=>{
    if(!detail||!amount)return;
    if(!date)undated++;
    const iso=date||fallbackDate;
    const value=Math.abs(amount);
    const base=[sheetName,type,iso,detail,value.toFixed(2)].join('|');
    const seen=(occurrences.get(base)||0)+1;
    occurrences.set(base,seen);
    entries.push({type,date:iso,particulars:detail,amount:value,
      category:guessOfficeCategory(type,detail),account:account||guessOfficeAccount(detail),
      sourceSheet:sheetName,sourceRow:rowNumber,
      importHash:hashString(['office',base,seen].join('|'))});
  };
  for(let r=headerIndex+1;r<rows.length;r++){
    const row=rows[r]||[];
    if(/^(total|grand total)\b/.test(nrm(row[0])))break;
    if(nrm(row[0])==='date'&&nrm(row[1])==='detail')continue;
    if(!row.some(cell=>String(cell??'').trim()))continue;
    const leftDetail=String(row[1]??'').trim();
    const leftAmount=parseExcelNumber(row[2]);
    if(/^(balance|opening balance|brought forward)$/i.test(leftDetail)){
      if(leftAmount!==0||openingBalance===null)openingBalance=leftAmount;
    }else if(leftDetail&&leftAmount){
      push('Outflow',plausibleDate(row[0]),leftDetail,leftAmount,r+1,accountCell(row[3]));
    }else if(leftAmount&&!leftDetail){
      // The sheet totals include these rows, so import them instead of silently dropping cash.
      push('Outflow',plausibleDate(row[0]),'Cash Outflow',leftAmount,r+1);
      unnamed++;
    }else if(leftDetail&&nrm(row[0])!=='total'){
      // A detail line without a readable amount (memo/note row) — reported, never imported.
      skipped++;
    }
    const rightDetail=String(row[5]??'').trim();
    const rightAmount=parseExcelNumber(row[6]);
    const rightDate=plausibleDate(row[4])||plausibleDate(row[3]);
    const rightAccount=accountCell(row[7]);
    if(/^(balance|closing balance|carried forward)$/i.test(rightDetail))continue;
    if(rightDetail&&rightAmount){
      push('Inflow',rightDate,rightDetail,rightAmount,r+1,rightAccount);
    }else if(rightAmount&&!rightDetail){
      push('Inflow',rightDate,'Cash Inflow',rightAmount,r+1,rightAccount);
      unnamed++;
    }
  }
  return {fy,entries,openingBalance,skipped,unnamed,undated,untyped:0,detected:true};
}
/** A sheet belongs to an office ledger only when it carries the Cash Outflow / Cash Inflow caption
 *  or the template's Entry Type * / Amount * header. */
function officeSheetSignature(aoa){
  const rows=(Array.isArray(aoa)?aoa:[]).slice(0,10);
  return rows.some(row=>{
    const cells=(row||[]).map(cell=>nrm(cell));
    return cells.some(cell=>/^cash (outflow|inflow)\b/.test(cell));
  })||!!officeFlatLayout(rows);
}
/** A CSV saved from the template has no FY sheet name, so the title row (then the filename) is
 *  used; anything that is not a real data range falls back to the current fiscal year. */
function officeCsvFiscalYear(aoa,fileName){
  const candidates=[...(Array.isArray(aoa)?aoa:[]).slice(0,6).flat().map(value=>String(value??'')),String(fileName||'')];
  for(const text of candidates){
    const match=text.match(/(\d{4})\s*[-–]\s*(\d{2,4})/);
    if(!match)continue;
    const fy=normIncomeYear(match[0]);
    if(!/^\d{4}-\d{2}$/.test(fy))continue;
    // Reject date fragments such as a filename's "2026-11" — a FY ends in start+1.
    if(Number(fy.slice(5))===(Number(fy.slice(0,4))+1)%100)return fy;
  }
  return fiscalYearFromDate(todayISO())||officeCurrentYear()||'';
}
/** Wraps a CSV export of the template into a one-sheet workbook keyed by its fiscal year, so the
 *  normal office import (and its duplicate protection) can read it. */
function officeWorkbookFromCsv(text,fileName){
  if(!window.XLSX)return null;
  const workbook=XLSX.read(String(text||'').replace(/^\uFEFF/,''),{type:'string',raw:true});
  const first=workbook.SheetNames[0];
  if(!first)return null;
  const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[first],{header:1,defval:'',raw:true});
  const fy=officeCsvFiscalYear(aoa,fileName);
  if(!fy)return null;
  workbook.Sheets={[fy]:workbook.Sheets[first]};
  workbook.SheetNames=[fy];
  return workbook;
}
/** A workbook is treated as an office ledger when it has fiscal-year sheets with the outflow/inflow header. */
function isOfficeWorkbook(workbook){
  if(!workbook||!workbook.SheetNames||!window.XLSX)return false;
  return workbook.SheetNames.some(name=>{
    if(!/^\d{4}\s*[-–]\s*\d{2,4}$/.test(String(name).trim()))return false;
    const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:true});
    return officeSheetSignature(aoa)&&parseOfficeSheet(aoa,name).detected;
  });
}

/**
 * Imports every FY sheet of an office workbook. Rows already stored (same sheet/type/row) are
 * skipped, so importing the same file twice never duplicates the ledger. When the import replaces
 * an existing office batch, that batch's rows and PDFs are removed first.
 * @param {{noAccountChange?:boolean}} [options] Choosing "I Do not want to change Account" in the
 *   import popup stamps every imported entry with noAccountChange, so no Cash & Bank balance moves
 *   (the flag can be cleared later on any row to restore the effect).
 */
async function importOfficeWorkbook(workbook,replaceId,fileName,options={}){
  const keepAccounts=!!options.noAccountChange;
  const target=replaceId?state.migrationHistory.find(m=>m.id===replaceId):null;
  const replacing=!!target&&target.migrationType==='Office Purchase & Bill';
  const migrationId=replacing?target.id:uid('mig');
  const seen=new Set(replacing?[]:state.officePurchases.map(r=>r.importHash).filter(Boolean));
  const rows=[],years=new Set(),openings=Object.assign({},officeOpeningBalances());
  let skipped=0,unnamed=0,undated=0,untyped=0,openingCount=0,duplicates=0;
  for(const sheetName of workbook.SheetNames){
    if(!/^\d{4}\s*[-–]\s*\d{2,4}$/.test(String(sheetName).trim()))continue;
    const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true});
    const parsed=parseOfficeSheet(aoa,sheetName);
    if(!parsed.detected){skipped++;continue}
    if(parsed.openingBalance!==null&&openings[parsed.fy]===undefined){
      openings[parsed.fy]=parsed.openingBalance;
      openingCount++;
      const base=[sheetName,'opening',officeFiscalYearStart(parsed.fy),Math.abs(parsed.openingBalance).toFixed(2)].join('|');
      rows.push({
        id:uid('office'),migrationId,incomeYear:parsed.fy,date:officeFiscalYearStart(parsed.fy),
        particulars:'Opening Balance',category:'Opening Balance',
        type:parsed.openingBalance<0?'Opening Balance (Inflow)':'Opening Balance (Outflow)',
        account:'',notes:'Imported from Office Purchase & Bill workbook',
        amount:Math.abs(parsed.openingBalance),openingOverride:true,openingImported:true,
        sourceSheet:sheetName,sourceRow:4,importHash:hashString(['office',base].join('|')),
        createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
      });
    }
    for(const entry of parsed.entries){
      if(seen.has(entry.importHash)){duplicates++;continue}
      seen.add(entry.importHash);
      const record=Object.assign({id:uid('office'),migrationId,incomeYear:parsed.fy,
        createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},entry);
      // "I Do not want to change Account": keep the account name for reference but stop the entry
      // from moving that Cash & Bank balance. Openings never touch an account anyway.
      if(keepAccounts&&!isOfficeOpeningType(record.type))record.noAccountChange=true;
      rows.push(record);
      years.add(parsed.fy);
    }
    skipped+=parsed.skipped;
    unnamed+=parsed.unnamed||0;
    undated+=parsed.undated||0;
    untyped+=parsed.untyped||0;
  }
  if(!rows.length&&!openingCount){
    toast(duplicates?'These office rows are already imported — nothing new to add.':'No Office Purchase & Bill rows were found in that workbook.',!duplicates);
    return {rows:0,pdf:0};
  }
  if(replacing)await removeMigrationRows(migrationId);
  const pdfAttached=await attachMigrationPdf(rows,options.pdfFile);
  if(rows.length)await putMany('officePurchases',rows);
  if(openingCount){
    state.settings.officeOpeningBalances=openings;
    await put('settings',{key:'officeOpeningBalances',value:openings});
  }
  if(years.size){
    const list=[...new Set([...(state.settings.incomeYears||[]),...years])].sort((a,b)=>String(b).localeCompare(String(a)));
    state.settings.incomeYears=list;
    await put('settings',{key:'incomeYears',value:list});
  }
  await saveMigrationMeta(migrationId,replacing?target.id:null,'Office Purchase & Bill',fileName,rows.length,skipped+duplicates);
  await loadState();
  await reconcileOfficeCarryForwards();
  // Show the newest imported FY straight away instead of an empty current-year ledger.
  const newestFy=[...years].sort((a,b)=>String(b).localeCompare(String(a)))[0];
  if(newestFy){officeFilters.years=[newestFy];officeYearChosen=true}
  renderAll();
  const bits=[`${rows.length} row${rows.length===1?'':'s'} imported`];
  if(duplicates)bits.push(`${duplicates} duplicate${duplicates===1?'':'s'} skipped`);
  if(unnamed)bits.push(`${unnamed} row${unnamed===1?'':'s'} had no detail (imported as Cash Inflow/Outflow)`);
  if(skipped)bits.push(`${skipped} row${skipped===1?'':'s'} skipped (no readable amount)`);
  if(undated)bits.push(`${undated} row${undated===1?'':'s'} had no date (dated to the FY start)`);
  if(untyped)bits.push(`${untyped} row${untyped===1?'':'s'} had no Entry Type (defaulted)`);
  if(openingCount)bits.push(`${openingCount} opening balance${openingCount===1?'':'s'} recorded`);
  if(keepAccounts)bits.push('Cash & Bank left unchanged');
  if(pdfAttached)bits.push(`PDF attached to ${pdfAttached} row${pdfAttached===1?'':'s'}`);
  toast(`Office Purchase & Bill: ${bits.join(', ')}.`);
  return {rows:rows.length,pdf:pdfAttached};
}

/* --- Import Office Workbook popup: pick a file, confirm the account behaviour, then import --- */
const OFFICE_IMPORT_HINT_UNCHECKED='Unticked: every row linked to a Cash & Bank account moves that balance.';
const OFFICE_IMPORT_HINT_CHECKED='Ticked: rows are recorded in this ledger only — no Cash & Bank balance changes.';
let officeImportDraft=null;

function setOfficeImportFileLabel(file){
  const label=$el('officeImportFileName');
  const clear=$el('officeImportClear');
  const confirm=$el('officeImportConfirm');
  if(label){
    if(file){
      label.textContent=`${file.name} · ${formatFileSize(file.size)}`;
      label.title=file.name;
      label.classList.add('has-file');
    }else{
      label.textContent='No file chosen';
      label.removeAttribute('title');
      label.classList.remove('has-file');
    }
  }
  if(clear)clear.classList.toggle('hidden',!file);
  if(confirm)confirm.disabled=!file;
}
function updateOfficeImportAccountHint(){
  const box=$el('officeImportNoAccount');
  const hint=$el('officeImportAccountHint');
  if(hint)hint.textContent=box&&box.checked?OFFICE_IMPORT_HINT_CHECKED:OFFICE_IMPORT_HINT_UNCHECKED;
}
function resetOfficeImportDraft(){
  officeImportDraft=null;
  const input=$el('officeImport');
  if(input)input.value='';
  const box=$el('officeImportNoAccount');
  if(box)box.checked=false;
  updateOfficeImportAccountHint();
  setOfficeImportFileLabel(null);
}
/** Opens the confirmation popup. A file can arrive already picked (Settings button or drag/drop). */
function openOfficeImportModal(options={}){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const file=options.file||null;
  officeImportDraft=file
    ?{file,workbook:options.workbook||null,replaceId:options.replaceId||null,pdfFile:options.pdfFile||null}
    :{file:null,workbook:null,replaceId:options.replaceId||null,pdfFile:null};
  const box=$el('officeImportNoAccount');
  if(box)box.checked=!!options.noAccountChange;
  const input=$el('officeImport');
  if(input)input.value='';
  updateOfficeImportAccountHint();
  setOfficeImportFileLabel(file);
  $el('officeImportModal').showModal();
}
function officeImportFileChosen(event){
  const input=event.target;
  const file=input.files&&input.files[0];
  input.value='';
  if(!file)return;
  officeImportDraft={file,workbook:null,replaceId:(officeImportDraft&&officeImportDraft.replaceId)||null,pdfFile:(officeImportDraft&&officeImportDraft.pdfFile)||null};
  setOfficeImportFileLabel(file);
  updateOfficeImportAccountHint();
}
function clearOfficeImportFile(){
  const replaceId=officeImportDraft?officeImportDraft.replaceId||null:null;
  const pdfFile=officeImportDraft?officeImportDraft.pdfFile||null:null;
  officeImportDraft={file:null,workbook:null,replaceId,pdfFile};
  setOfficeImportFileLabel(null);
}
async function readOfficeImportWorkbook(draft){
  if(draft.workbook)return draft.workbook;
  if(/\.csv$/i.test(draft.file.name||''))return officeWorkbookFromCsv(await draft.file.text(),draft.file.name);
  return XLSX.read(await draft.file.arrayBuffer(),{type:'array'});
}
async function confirmOfficeImport(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const draft=officeImportDraft;
  if(!draft||!draft.file){toast('Choose an .xlsx, .xls or .csv workbook first.',true);return}
  if(draft.file.size>MAX_IMPORT_BYTES){toast('That file is larger than 30 MB. Split it and import the parts.',true);return}
  const button=$el('officeImportConfirm');
  if(button){button.disabled=true;button.classList.add('loading')}
  try{
    const workbook=await readOfficeImportWorkbook(draft);
    if(!workbook||!isOfficeWorkbook(workbook)){
      toast('No office ledger was found. Use FY sheets (e.g. 2025-26) with the Cash Outflow / Cash Inflow columns, or the downloaded template.',true);
      return;
    }
    const noAccountChange=!!($el('officeImportNoAccount')&&$el('officeImportNoAccount').checked);
    const pdfFile=migrationPdfDraft||draft.pdfFile||null;
    const result=await importOfficeWorkbook(workbook,draft.replaceId,draft.file.name,{noAccountChange,pdfFile});
    // Keep the popup open when nothing was imported so the message stays next to the chosen file.
    if(result.rows>0)$el('officeImportModal').close();
    if(pdfFile&&result.pdf>0)clearMigrationPdf();
  }catch(error){
    console.error(error);
    toast('Could not read that workbook'+(error.message?` — ${error.message}`:''),true);
  }finally{
    if(button){
      button.classList.remove('loading');
      button.disabled=!(officeImportDraft&&officeImportDraft.file);
    }
  }
}

/* --- Office Purchase & Bill page --- */
function officeFilterText(){
  const f=officeFilters;
  return ['FY',officePeriodLabel(),'Type',f.type||'All','Cash & Bank',f.account==='__none__'?'Not linked':(f.account||'All'),'Category',f.category||'All','Search',f.search||'All'].join('  |  ');
}
function getFilteredOfficeEntries(){
  const f=officeFilters;
  const search=String(f.search||'').toLowerCase();
  return officePeriodEntries().filter(r=>{
    if(f.type&&r.type!==f.type)return false;
    if(f.account==='__none__'){if(r.account)return false}
    else if(f.account&&officeAccountKey(r.account)!==officeAccountKey(f.account))return false;
    if(f.category&&r.category!==f.category)return false;
    if(search){
      const hay=[r.particulars,r.category,r.account,r.notes,r.date].map(v=>String(v??'').toLowerCase()).join(' ');
      if(!hay.includes(search))return false;
    }
    return true;
  });
}
/** Entries inside the selected period (ignores the type/account/search filters). */
function officeYearEntries(){
  return officePeriodEntries();
}
function officeHasFilters(){
  const f=officeFilters;
  return !officeYearSelectionAll()||!!(f.type||f.account||f.category||f.search);
}
/* --- Financial Year multi-select (dropdown with checkboxes + "All Financial Years") --- */
/* The list itself lives inside the filter card, which is a glass `.card`: `backdrop-filter`
   plus the following ledger card used to paint it underneath the table. `styles.css` raises the
   filter bar / picker z-index, and on desktop the open list is moved into a body-level fixed
   layer so no transform, backdrop-filter, sticky topbar or overflow box can clip it. */
const officeYearDesktopQuery=window.matchMedia?window.matchMedia('(min-width: 769px)'):{matches:true,addEventListener:null};
/** Body-level, viewport-sized layer the open list is portaled into (declared in index.html). */
function officeYearOverlay(){
  let layer=document.getElementById('officeYearOverlay');
  if(!layer){
    layer=document.createElement('div');
    layer.id='officeYearOverlay';
    layer.className='office-overlay-layer';
    document.body.appendChild(layer);
  }
  return layer;
}
/** Places the portaled list under its trigger (above it when there is no room) inside the viewport. */
function placeOfficeYearMenu(){
  const menu=document.getElementById('officeYearMenu');
  const trigger=document.getElementById('officeYearFilter');
  if(!menu||!trigger||!menu.classList.contains('office-portal'))return;
  const rect=trigger.getBoundingClientRect();
  const gap=6;
  const margin=10;
  const viewportW=window.innerWidth||document.documentElement.clientWidth;
  const viewportH=window.innerHeight||document.documentElement.clientHeight;
  const maxWidth=Math.max(168,Math.min(320,viewportW-margin*2));
  menu.style.width='max-content';
  menu.style.minWidth=`${Math.round(Math.min(Math.max(rect.width,168),maxWidth))}px`;
  menu.style.maxWidth=`${Math.round(maxWidth)}px`;
  const spaceBelow=viewportH-rect.bottom-gap-margin;
  const spaceAbove=rect.top-gap-margin;
  const openUp=spaceBelow<180&&spaceAbove>spaceBelow;
  const available=Math.max(140,openUp?spaceAbove:spaceBelow);
  menu.style.maxHeight=`${Math.round(Math.min(320,available))}px`;
  const width=Math.min(maxWidth,Math.max(rect.width,menu.offsetWidth||0));
  const left=Math.min(Math.max(margin,rect.left),Math.max(margin,viewportW-margin-width));
  menu.style.left=`${Math.round(left)}px`;
  const height=menu.offsetHeight||0;
  const top=openUp?rect.top-gap-height:rect.bottom+gap;
  menu.style.top=`${Math.round(Math.min(Math.max(margin,top),Math.max(margin,viewportH-margin-height)))}px`;
}
function closeOfficeYearMenu(){
  if(!officeYearMenuOpen)return;
  officeYearMenuOpen=false;
  applyOfficeYearMenuState();
}
function applyOfficeYearMenuState(){
  const multi=document.getElementById('officeYearMulti');
  const menu=document.getElementById('officeYearMenu');
  const trigger=document.getElementById('officeYearFilter');
  const portal=!!(officeYearMenuOpen&&menu&&trigger&&officeYearDesktopQuery.matches);
  if(multi)multi.classList.toggle('open',officeYearMenuOpen);
  if(menu){
    if(portal){
      const overlay=officeYearOverlay();
      if(menu.parentElement!==overlay)overlay.appendChild(menu);
      menu.classList.add('office-portal');
      menu.classList.remove('hidden');
      document.body.classList.add('office-fy-open');
      placeOfficeYearMenu();
    }else{
      menu.classList.remove('office-portal');
      menu.style.cssText='';
      if(multi&&menu.parentElement!==multi)multi.appendChild(menu);
      menu.classList.toggle('hidden',!officeYearMenuOpen);
      document.body.classList.remove('office-fy-open');
    }
  }else{
    document.body.classList.remove('office-fy-open');
  }
  if(trigger)trigger.setAttribute('aria-expanded',officeYearMenuOpen?'true':'false');
}
if(officeYearDesktopQuery.addEventListener){
  officeYearDesktopQuery.addEventListener('change',()=>{if(officeYearMenuOpen)applyOfficeYearMenuState()});
}
/* Keep the fixed list glued to its trigger while the page or an inner box scrolls. */
window.addEventListener('scroll',()=>{if(officeYearMenuOpen)placeOfficeYearMenu()},{passive:true,capture:true});
window.addEventListener('resize',()=>{if(officeYearMenuOpen)placeOfficeYearMenu()},{passive:true});

function renderOfficeYearFilter(){
  ensureOfficeYearSelection();
  const trigger=document.getElementById('officeYearFilter');
  const value=document.getElementById('officeYearValue');
  const menu=document.getElementById('officeYearMenu');
  const years=officeYearList();
  const selected=officeSelectedYears();
  const all=officeYearSelectionAll();
  if(value){
    value.textContent=!years.length
      ?'No Financial Years configured'
      :all
        ?'All Financial Years'
        :selected.length===1
          ?`FY ${selected[0]}`
          :selected.length
            ?`${selected.length} Financial Years`
            :'Select a Financial Year';
    value.title=years.length?(selected.slice().sort(officeYearSort).map(y=>`FY ${y}`).join(', ')||'None selected'):'';
  }
  if(trigger)trigger.disabled=!years.length;
  if(menu){
    menu.innerHTML=years.length
      ?[`<label class="multi-select-option all"><input type="checkbox" data-office-year="__all__" ${all?'checked':''}><span>All Financial Years</span></label>`]
        .concat(years.map(y=>`<label class="multi-select-option"><input type="checkbox" data-office-year="${esc(y)}" ${selected.includes(y)?'checked':''}><span>FY ${esc(y)}</span></label>`))
        .join('')
      :'<div class="multi-select-empty">Add Financial Years in Settings to filter this ledger.</div>';
    menu.onchange=event=>{
      const input=event.target.closest('input[data-office-year]');
      if(input)applyOfficeYearToggle(input);
    };
  }
  if(trigger)trigger.onclick=()=>{officeYearMenuOpen=!officeYearMenuOpen;applyOfficeYearMenuState()};
  applyOfficeYearMenuState();
}
/** Ticking "All Financial Years" selects every year; unticking it clears the selection. */
function applyOfficeYearToggle(input){
  const raw=input.getAttribute('data-office-year');
  if(raw===null)return;
  const years=officeYearList();
  const selected=officeSelectedYears();
  if(raw==='__all__'){
    officeFilters.years=input.checked?years.slice():[];
  }else{
    const set=new Set(selected);
    if(input.checked)set.add(raw);else set.delete(raw);
    officeFilters.years=years.filter(y=>set.has(y));
  }
  officeYearChosen=true;
  officePage=1;
  renderOfficePage();
}
document.addEventListener('click',event=>{
  if(!officeYearMenuOpen)return;
  const multi=document.getElementById('officeYearMulti');
  const menu=document.getElementById('officeYearMenu');
  if(multi&&multi.contains(event.target))return;
  // The open list can be portaled to the body-level overlay, so it is checked separately.
  if(menu&&menu.contains(event.target))return;
  officeYearMenuOpen=false;
  applyOfficeYearMenuState();
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!officeYearMenuOpen)return;
  officeYearMenuOpen=false;
  applyOfficeYearMenuState();
});

function renderOfficeFilters(){
  ensureOfficeYearSelection();
  const host=document.getElementById('officeFilters');
  if(!host)return;
  // Safety net for a stale cached index.html: rebuild the year picker shell if it is missing.
  if(!document.getElementById('officeYearFilter')){
    // A list portaled by a previous render would survive the rebuild as a visible duplicate.
    const stale=document.getElementById('officeYearMenu');
    if(stale&&stale.classList.contains('office-portal'))stale.remove();
    const multi=document.createElement('div');
    multi.className='multi-select office-year-multi';
    multi.id='officeYearMulti';
    multi.innerHTML='<button type="button" class="multi-select-trigger" id="officeYearFilter" aria-haspopup="true" aria-expanded="false" aria-controls="officeYearMenu" aria-label="Financial Year — choose one or more years"><span class="multi-select-value" id="officeYearValue">All Financial Years</span><svg class="ic" aria-hidden="true"><use href="#i-down"/></svg></button><div class="multi-select-menu hidden" id="officeYearMenu" role="group" aria-label="Financial Years"></div>';
    host.insertBefore(multi,host.firstChild);
  }
  renderOfficeYearFilter();
  let controls=host.querySelector('.office-filter-controls');
  if(!controls){
    controls=document.createElement('div');
    controls.className='office-filter-controls';
    host.appendChild(controls);
  }
  const f=officeFilters;
  const option=(value,label,selected)=>`<option value="${esc(value)}" ${selected?'selected':''}>${esc(label)}</option>`;
  const accounts=officeAccountChoices();
  const categories=officeCategoryChoices();
  const anyFilter=officeHasFilters();
  controls.innerHTML=`
    <select id="officeTypeFilter" aria-label="Entry type">${option('','All Types',!f.type)}${option('Office Purchase (Cash Outflow)','Office Purchase (Cash Outflow)',f.type==='Office Purchase (Cash Outflow)')}${option('Bill Received (Cash Inflow)','Bill Received (Cash Inflow)',f.type==='Bill Received (Cash Inflow)')}${option('Opening Balance (Outflow)','Opening Balance (Outflow)',f.type==='Opening Balance (Outflow)')}${option('Opening Balance (Inflow)','Opening Balance (Inflow)',f.type==='Opening Balance (Inflow)')}</select>
    <select id="officeAccountFilter" aria-label="Cash and bank account">${option('','All Cash & Bank Accounts',!f.account)}${option('__none__','Not linked to an account',f.account==='__none__')}${accounts.map(a=>option(a,a,f.account===a)).join('')}</select>
    <select id="officeCategoryFilter" aria-label="Category">${option('','All Categories',!f.category)}${categories.map(c=>option(c,c,f.category===c)).join('')}</select>
    <input class="search" id="officeSearch" placeholder="Search office entries…" aria-label="Search office entries" value="${esc(f.search)}">
    <button type="button" class="btn filter-reset" id="officeClear" ${anyFilter?'':'disabled'}>Clear Filters</button>`;
  host.querySelectorAll('select').forEach(el=>el.classList.toggle('is-active',!!el.value));
  const rerender=()=>{officePage=1;renderOfficePage()};
  const bind=(id,key)=>{const el=document.getElementById(id);if(el)el.onchange=()=>{officeFilters[key]=el.value;rerender()}};
  bind('officeTypeFilter','type');
  bind('officeAccountFilter','account');
  bind('officeCategoryFilter','category');
  const searchEl=document.getElementById('officeSearch');
  if(searchEl){let timer=null;searchEl.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{
    officeFilters.search=searchEl.value;officePage=1;
    const clear=document.getElementById('officeClear');
    if(clear)clear.disabled=!officeHasFilters();
    renderOfficeSummary();renderOfficeTable();renderOfficeAccounts();
  },180)}}
  const clear=document.getElementById('officeClear');
  if(clear)clear.onclick=()=>{
    officeFilters.years=officeYearList();
    officeYearChosen=true;
    officeFilters.type='';officeFilters.account='';officeFilters.category='';officeFilters.search='';
    officeYearMenuOpen=false;
    rerender();
  };
}

function renderOfficeSummary(){
  const period=officePeriodLabel();
  const entries=officePeriodEntries();
  const opening=officePeriodOpening();
  const totals=officeTotals(entries);
  const closing=officePeriodClosing();
  const card=(i,iconName,label,value,kpi,kpiInk,cls,meta)=>`<div class="summary-card" style="--i:${i};--kpi:${kpi};--kpi-ink:${kpiInk}"><div class="summary-icon">${icon(iconName)}</div><div><p>${label}</p><strong class="kpi-value ${cls||''}">${formatMoney(value)}</strong><span class="office-card-meta">${meta}</span></div></div>`;
  const cashMeta=totals.cashOutflow||totals.cashInflow
    ?`Paid ${formatMoney(totals.cashOutflow)} · Received ${formatMoney(totals.cashInflow)}`
    :'No entries linked to an account';
  document.getElementById('officeSummaryCards').innerHTML=[
    card(0,'down','Total Outflow',totals.outflow,'var(--rose-soft)','#e11d48','',`${entries.filter(r=>r.type!=='Inflow').length} payment(s) · ${period}`),
    card(1,'up','Total Inflow',totals.inflow,'var(--emerald-soft)','#059669','',`${entries.filter(r=>officeTypeKind(r.type)==='Inflow').length} receipt(s) · ${period}`),
    card(2,'scale','Closing Balance',closing,'var(--primary-soft)','var(--primary-2)',closing>=0?'kpi-pos':'kpi-neg',`Opening ${formatMoney(opening)} · Net ${formatMoney(totals.net)}`),
    card(3,'layers','Cash &amp; Bank Effect',totals.cashEffect,'rgba(245,158,11,.14)','#d97706',totals.cashEffect>=0?'kpi-pos':'kpi-neg',cashMeta)
  ].join('');
}
function renderOfficeTable(){
  const period=officePeriodLabel();
  const yearEntries=officePeriodEntries();
  const records=getFilteredOfficeEntries().sort(officeEntryOrder);
  const opening=officePeriodOpening();
  const closing=officePeriodClosing();
  // The balance column always reflects the whole selected period, even when type/account filters hide rows.
  const runMap=officeRunningMap(yearEntries.filter(r=>!isOfficeOpeningType(r.type)),opening);
  const pageSize=25,pages=Math.max(1,Math.ceil(records.length/pageSize));
  officePage=Math.min(Math.max(1,officePage),pages);
  const start=(officePage-1)*pageSize;
  const pageRows=records.slice(start,start+pageSize);
  const title=document.getElementById('officeTableTitle');
  if(title)title.textContent=`Office Purchase & Bill · ${period}`;
  const count=document.getElementById('officeRecordCount');
  if(count)count.textContent=`${records.length} entr${records.length===1?'y':'ies'} shown · ${yearEntries.length} in ${period} · page ${officePage} of ${pages}`;
  const table=document.getElementById('officeTable');
  if(!table)return;
  const openingRow='';
  const body=pageRows.map((r,i)=>{
    const id=esc(r.id);
    const doc=(r.documentIds||[]).length
      ?`<button type="button" class="action-link" data-cmd="open-pdf" data-id="${esc(r.documentIds[0])}">Bill</button>`
      :'<span class="doc-none">—</span>';
    const kind=officeTypeKind(r.type);
    return `<tr style="--i:${Math.min(i,12)}"><td>${esc(fmtDate(r.date)||'—')}</td><td><strong>${esc(r.particulars)}</strong>${r.notes?`<span class="muted-sub">${esc(r.notes)}</span>`:''}${isOfficeOpeningType(r.type)?'<span class="tag">Opening Balance</span>':''}</td><td>${catLabel(r.category,'Office')}</td><td>${esc(r.account||'None')}${r.noAccountChange&&!isOfficeOpeningType(r.type)?'<span class="tag">no change</span>':''}</td><td class="num">${kind==='Inflow'?'—':`<strong class="amount expense">${formatMoney(r.amount)}</strong>`}</td><td class="num">${kind==='Inflow'?`<strong class="amount income">${formatMoney(r.amount)}</strong>`:'—'}</td><td class="num"><strong>${formatMoney(runMap.has(r.id)?runMap.get(r.id):opening)}</strong></td><td>${doc}</td><td class="actions-cell"><button type="button" class="action-link" data-cmd="view-office" data-id="${id}">View</button><button type="button" class="action-link" data-cmd="edit-office" data-id="${id}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-office" data-id="${id}">Delete</button></td></tr>`;
  }).join('');
  const totals=officeTotals(records);
  const totalRow=records.length
    ?`<tr class="office-total-row"><td colspan="4">Total · ${esc(period)}</td><td class="num">${formatMoney(totals.outflow)}</td><td class="num">${formatMoney(totals.inflow)}</td><td class="num" title="Closing balance of the selected period">${formatMoney(closing)}</td><td colspan="2"></td></tr>`
    :'';
  const emptyMessage=officePeriodYears().length
    ?'No office entries match these filters. Add an entry or import the FY workbook from Settings.'
    :'Select at least one Financial Year (or All Financial Years) to view this ledger.';
  table.innerHTML=`<thead><tr><th scope="col">Date</th><th scope="col">Particulars</th><th scope="col">Category</th><th scope="col">Cash &amp; Bank</th><th scope="col" class="num">Outflow</th><th scope="col" class="num">Inflow</th><th scope="col" class="num">Balance</th><th scope="col">Bill</th><th scope="col">Actions</th></tr></thead><tbody>${openingRow}${body||`<tr><td colspan="9"><div class="empty-state">${emptyMessage}</div></td></tr>`}${totalRow}</tbody>`;
  const pager=document.getElementById('officePagination');
  if(pager)pager.innerHTML=pages>1?Array.from({length:pages},(_,i)=>`<button type="button" class="${i+1===officePage?'active':''}" data-cmd="office-page" data-id="${i+1}" aria-label="Page ${i+1}">${i+1}</button>`).join(''):'';
}

function renderOfficeAccounts(){
  const host=document.getElementById('officeAccountSummary');
  if(!host)return;
  const period=officePeriodLabel();
  const entries=officePeriodEntries();
  if(!entries.length){host.innerHTML='';return}
  const index=officeAccountIndex();
  const groups=new Map();
  for(const entry of entries){
    if(isOfficeOpeningType(entry.type))continue;
    const configured=index.get(officeAccountKey(entry.account));
    const key=officeAccountKey(entry.account)||'__none__';
    if(!groups.has(key))groups.set(key,{name:configured?configured.label:(String(entry.account||'').trim()||'Not linked to an account'),outflow:0,inflow:0,count:0,skipped:0});
    const g=groups.get(key);
    g.count++;
    if(!officeAccountApplies(entry)){g.skipped++;continue}
    if(officeTypeKind(entry.type)==='Inflow')g.inflow+=Math.abs(Number(entry.amount)||0);
    else g.outflow+=Math.abs(Number(entry.amount)||0);
  }
  const cards=[...groups.entries()].sort((a,b)=>{
    if(a[0]==='__none__')return 1;
    if(b[0]==='__none__')return -1;
    return a[1].name.localeCompare(b[1].name);
  }).map(([key,g])=>{
    const effect=g.inflow-g.outflow;
    const meta=`${g.count} entr${g.count===1?'y':'ies'}${g.skipped?` · ${g.skipped} no change`:''}`;
    return `<div class="office-account-card"><div class="office-account-top"><strong>${esc(g.name)}</strong><span>${meta}</span></div><div class="office-account-figures"><span class="out">−${formatMoney(g.outflow)}</span><span class="in">+${formatMoney(g.inflow)}</span></div><div class="office-account-net ${effect>=0?'kpi-pos':'kpi-neg'}">Net effect ${effect>=0?'+':'−'}${formatMoney(Math.abs(effect))}</div></div>`;
  }).join('');
  host.innerHTML=`<div class="office-account-head"><h3>Cash &amp; Bank Effect · ${esc(period)}</h3><p>Each linked account moves by these amounts on the Dashboard and Balance Sheet — nothing is written twice.</p></div><div class="office-account-grid">${cards}</div>`;
}
function renderOfficePage(){
  renderOfficeFilters();
  renderOfficeSummary();
  renderOfficeTable();
  renderOfficeAccounts();
}

/* --- Office entry modal --- */
function resetOfficeDocDraft(record){
  officeDocDraft.existing=record?(record.documentIds||[]).map(id=>state.documents.find(d=>d.id===id)).filter(Boolean):[];
  officeDocDraft.removed=new Set();officeDocDraft.added=[];
}
function renderOfficeDocManager(){
  const host=document.getElementById('officeDocManagerList');
  if(!host)return;
  const rows=[];
  officeDocDraft.existing.forEach(d=>{
    const removed=officeDocDraft.removed.has(d.id);
    const name=d.name||d.title||'bill.pdf';
    rows.push(`<div class="doc-row ${removed?'removed':''}"><div class="doc-info"><strong>${esc(name)}</strong><span>${formatFileSize(d.size)}</span>${removed?'<span class="tag warn">Will be removed</span>':''}</div><div class="doc-actions">${removed?'':`<button type="button" class="action-link" data-oact="view" data-id="${esc(d.id)}">View</button>`}<button type="button" class="action-link ${removed?'':'danger'}" data-oact="${removed?'undo':'remove'}" data-id="${esc(d.id)}">${removed?'Undo remove':'Remove'}</button></div></div>`);
  });
  officeDocDraft.added.forEach((f,i)=>{
    rows.push(`<div class="doc-row"><div class="doc-info"><strong>${esc(f.name)}</strong><span>${formatFileSize(f.size)}</span><span class="tag new">New</span></div><div class="doc-actions"><button type="button" class="action-link" data-oact="view-new" data-idx="${i}">View</button><button type="button" class="action-link danger" data-oact="remove-new" data-idx="${i}">Remove</button></div></div>`);
  });
  host.innerHTML=rows.join('')||'<div class="doc-empty">No bill PDF attached yet.</div>';
}
async function officeDocDraftSource(id){
  const meta=officeDocDraft.existing.find(d=>d.id===id);
  if(!meta)return null;
  const blob=await getDocBlob(id);
  if(!blob)return null;
  return {blob,name:meta.name||meta.title||'bill.pdf',size:meta.size||blob.size};
}
function bindOfficeDocManager(){
  const host=document.getElementById('officeDocManager');
  if(host)host.onclick=async event=>{
    const btn=event.target.closest('[data-oact]');
    if(!btn)return;
    const {oact,id,idx}=btn.dataset;
    if(oact==='view'){const src=await officeDocDraftSource(id);if(src)await openPdfViewer(src)}
    else if(oact==='remove'){officeDocDraft.removed.add(id);renderOfficeDocManager()}
    else if(oact==='undo'){officeDocDraft.removed.delete(id);renderOfficeDocManager()}
    else if(oact==='view-new'){const f=officeDocDraft.added[+idx];if(f)await openPdfViewer({blob:f,name:f.name,size:f.size})}
    else if(oact==='remove-new'){officeDocDraft.added.splice(+idx,1);renderOfficeDocManager()}
  };
  const input=document.getElementById('officeDocument');
  if(input)input.onchange=event=>{
    const files=[...event.target.files];
    officeDocDraft.added.push(...files.filter(isPdfFile));
    if(files.some(f=>!isPdfFile(f)))toast('Only PDF files can be attached.',true);
    event.target.value='';
    renderOfficeDocManager();
  };
}

function openOfficeModal(id=null){
  editingOfficeId=id;
  const record=id?state.officePurchases.find(r=>r.id===id):null;
  resetOfficeDocDraft(record);
  document.getElementById('officeModalTitle').textContent=record?'Edit Office Entry':'Add Office Entry';
  document.getElementById('officeModalSubtitle').textContent=record?`${record.type} · ${record.particulars}`:'Outflow reduces Cash & Bank, inflow adds to it';
  const dateValue=record?record.date||todayISO():todayISO();
  const typeValue=record?normalizeOfficeType(record.type):'Office Purchase (Cash Outflow)';
  const account=record?record.account||'':'';
  const category=record?record.category||'':'Office Purchase';
  const accounts=officeAccountChoices();
  // An account that is no longer in Settings (or one whose spelling changed) stays selectable while
  // editing, so saving an old entry can never silently drop or re-link its Cash & Bank account.
  const configuredAccount=officeAccountOption(account);
  const accountLabel=configuredAccount?configuredAccount.label:String(account||'').trim();
  const extraAccount=accountLabel&&!accounts.some(name=>name===accountLabel)?accountLabel:'';
  const noAccountChange=!!(record&&record.noAccountChange);
  const option=(value,label,selected)=>`<option value="${esc(value)}" ${selected?'selected':''}>${esc(label)}</option>`;
  document.getElementById('officeFormFields').innerHTML=`<div class="income-form-grid">
    <label><span class="lbl">Entry Type *</span><select id="officeTypeSelect" required>${option('Office Purchase (Cash Outflow)','Office Purchase (Cash Outflow)',typeValue==='Office Purchase (Cash Outflow)'||typeValue==='Outflow')}${option('Bill Received (Cash Inflow)','Bill Received (Cash Inflow)',typeValue==='Bill Received (Cash Inflow)'||typeValue==='Inflow')}${option('Opening Balance (Outflow)','Opening Balance (Outflow)',typeValue==='Opening Balance (Outflow)')}${option('Opening Balance (Inflow)','Opening Balance (Inflow)',typeValue==='Opening Balance (Inflow)')}</select></label>
    <label><span class="lbl">Date *</span><input id="officeDate" type="date" required value="${esc(dateValue)}"></label>
    <label class="full">Particulars *<input id="officeParticulars" type="text" required maxlength="200" value="${esc(record?record.particulars:'')}" placeholder="e.g. Office stationery purchase"></label>
    <label><span class="lbl">Category *</span><select id="officeCategory" required>${officeCategoryChoices().map(c=>option(c,c,category===c)).join('')}</select></label>
    <label><span class="lbl">Cash &amp; Bank Account</span><select id="officeAccount">${option('','None',!accountLabel)}${accounts.map(a=>option(a,a,accountLabel===a)).join('')}${extraAccount?option(extraAccount,`${extraAccount} (not in Settings)`,true):''}</select></label>
    <label class="office-account-check full"><span class="office-check-row"><input type="checkbox" id="officeNoAccountChange" ${noAccountChange?'checked':''}><span>I Do not want to change Account</span></span><span class="hint" id="officeNoAccountHint">Records the entry here only — the Cash &amp; Bank balance stays exactly as it is.</span></label>
    <label><span class="lbl">Amount (BDT) *</span><span class="calc-field"><input id="officeAmount" type="number" step="0.01" min="0" inputmode="decimal" required value="${esc(record?record.amount:'')}" placeholder="0.00"><button type="button" class="calc-trigger" data-calc-target="officeAmount" aria-label="Open calculator for Amount (BDT)" aria-haspopup="dialog" aria-controls="calcPopover" aria-expanded="false" title="Calculator">${icon('calc')}</button></span></label>
    <label><span class="lbl">Balance effect</span><span class="hint" id="officeEffectHint"></span></label>
    <label class="full">Reference / Notes<textarea id="officeNotes" rows="2" placeholder="Bill number, vendor, purpose…">${esc(record?record.notes||'':'')}</textarea></label>
    <label class="full">Bill / Voucher (PDF)<input id="officeDocument" type="file" accept=".pdf,application/pdf"><span class="hint">Optional bill or voucher PDF, stored on this device only.</span></label>
    <div class="doc-manager full" id="officeDocManager"><h4>Attached bill</h4><div class="doc-list" id="officeDocManagerList"></div></div>
  </div>`;
  const accountHint=document.getElementById('officeNoAccountHint');
  if(accountHint&&!accounts.length)accountHint.textContent='No Cash & Bank accounts yet — add them in Settings → Manage Categories to link one.';
  document.querySelector('#officeForm .modal-foot').innerHTML='<button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn btn-primary">Save Entry</button>';
  document.querySelectorAll('#officeForm [data-close-modal]').forEach(b=>b.onclick=()=>document.getElementById('officeModal').close());
  const updateHint=()=>{
    const hint=document.getElementById('officeEffectHint');
    const typeEl=document.getElementById('officeTypeSelect');
    const accEl=document.getElementById('officeAccount');
    const dateEl=document.getElementById('officeDate');
    const skipEl=document.getElementById('officeNoAccountChange');
    if(!hint||!typeEl)return;
    const fy=fiscalYearFromDate(dateEl&&dateEl.value)||officeCurrentYear();
    const opening=isOfficeOpeningType(typeEl.value);
    // Opening-balance rows are carried-forward figures, so they never touch an account.
    if(skipEl)skipEl.disabled=opening;
    if(accEl)accEl.disabled=opening;
    if(opening){
      if(accEl)accEl.value='';
      if(skipEl)skipEl.checked=false;
      hint.textContent=`No Cash & Bank adjustment · FY ${fy}`;
      return;
    }
    const label=accEl?accEl.value:'';
    if(!label){hint.textContent=`No Cash & Bank adjustment · FY ${fy}`;return}
    if(skipEl&&skipEl.checked){hint.textContent=`${label} stays as it is · FY ${fy}`;return}
    const effect=officeTypeKind(typeEl.value)==='Inflow'?'adds to':'reduces';
    hint.textContent=`${effect} ${label} · FY ${fy}`;
  };
  ['officeTypeSelect','officeAccount','officeDate','officeNoAccountChange'].forEach(elId=>{const el=document.getElementById(elId);if(el)el.onchange=updateHint});
  const officeCategoryEl=document.getElementById('officeCategory');
  if(officeCategoryEl){
    const syncOfficeIcon=()=>setFieldIcon('officeCategory',officeCategoryEl.value,'Office');
    officeCategoryEl.onchange=syncOfficeIcon;
    syncOfficeIcon();
  }
  updateHint();
  bindOfficeDocManager();
  renderOfficeDocManager();
  document.getElementById('officeModal').showModal();
}

async function saveOfficeEntry(event){
  event.preventDefault();
  if(savingOffice)return;
  const form=event.target;
  if(form.querySelector('select:invalid,input:invalid,textarea:invalid')){form.reportValidity();return}
  const amount=Math.abs(Number(document.getElementById('officeAmount').value||0));
  if(!amount){toast('Enter an amount greater than zero.',true);return}
  savingOffice=true;
  try{
    const date=document.getElementById('officeDate').value||todayISO();
    const type=normalizeOfficeType(document.getElementById('officeTypeSelect').value);
    const opening=isOfficeOpeningType(type);
    const particulars=document.getElementById('officeParticulars').value.trim();
    const category=opening?'Opening Balance':document.getElementById('officeCategory').value;
    // Store the Settings spelling of the account, so "bkash" picked earlier merges with "bKash".
    const accountPick=opening?'':document.getElementById('officeAccount').value;
    const configuredAccount=officeAccountOption(accountPick);
    const account=opening?'':(configuredAccount?configuredAccount.label:String(accountPick||'').trim());
    const skipEl=document.getElementById('officeNoAccountChange');
    const noAccountChange=!opening&&!!(skipEl&&skipEl.checked);
    const notes=document.getElementById('officeNotes').value.trim();
    const old=editingOfficeId?state.officePurchases.find(r=>r.id===editingOfficeId):null;
    const record=Object.assign({},old||{});
    Object.assign(record,{id:old?old.id:uid('office'),type,date,particulars,category,account,notes,amount,
      incomeYear:fiscalYearFromDate(date)||(old&&old.incomeYear)||officeCurrentYear()});
    // Opting out is stored on the entry itself: the Cash & Bank effect is derived from this flag, so
    // ticking or un-ticking it later restores the balance without any manual reversal.
    if(noAccountChange)record.noAccountChange=true;else delete record.noAccountChange;
    if(opening){
      record.openingOverride=true;
      record.openingImported=false;
      record.openingAuto=false;
    }else{
      delete record.openingOverride;
      delete record.openingImported;
      delete record.openingAuto;
    }
    if(!record.createdAt)record.createdAt=new Date().toISOString();
    record.updatedAt=new Date().toISOString();

    let documentIds=[...(old&&old.documentIds||[])];
    for(const docId of officeDocDraft.removed){
      await remove('documents',docId);await remove('documentBlobs',docId);
      documentIds=documentIds.filter(x=>x!==docId);
    }
    for(const file of officeDocDraft.added){
      const docId=uid('doc');
      await put('documentBlobs',{id:docId,blob:file});
      await put('documents',{id:docId,recordId:record.id,title:file.name,name:file.name,type:file.type||'application/pdf',size:file.size,category,subcategory:account||'',financialType:type,incomeYear:record.incomeYear||'',createdAt:new Date().toISOString()});
      documentIds.push(docId);
    }
    record.documentIds=documentIds;

    await put('officePurchases',record);
    await loadState();
    await reconcileOfficeCarryForwards();
    document.getElementById('officeModal').close();
    editingOfficeId=null;
    // The entry may have just moved a Cash & Bank account, so refresh every page - not just this one.
    renderAll();
    toast(old?'Office entry saved':'Office entry added');
  }catch(error){
    console.error(error);
    const quota=error&&error.name==='QuotaExceededError';
    toast(quota?'Could not save — browser storage is full.':'Could not save the office entry'+(error.message?` — ${error.message}`:''),true);
  }finally{
    savingOffice=false;
  }
}
async function deleteOfficeEntry(id){
  const record=state.officePurchases.find(r=>r.id===id);
  if(!record)return;
  if(!(await confirm(`Delete "${record.particulars}" (${formatMoney(record.amount)})? Any attached bill PDF will also be removed.`,'Delete Office Entry')))return;
  try{
    const docIds=new Set([...(record.documentIds||[]),...state.documents.filter(d=>d.recordId===id).map(d=>d.id)]);
    for(const docId of docIds){await remove('documents',docId);await remove('documentBlobs',docId)}
    await remove('officePurchases',id);
    await loadState();
    await reconcileOfficeCarryForwards();
    // Deleting the entry also removes its derived Cash & Bank movement, so refresh every page.
    renderAll();
    toast('Office entry deleted');
  }catch(error){
    console.error(error);
    toast('Could not delete the office entry.',true);
  }
}
function viewOfficeEntry(id){
  const record=state.officePurchases.find(r=>r.id===id);
  if(!record)return;
  editingOfficeId=null;
  document.getElementById('officeModalTitle').textContent=`${record.type} · ${record.category||'Office'}`;
  document.getElementById('officeModalSubtitle').textContent=record.particulars;
  const docs=(record.documentIds||[]).map(docId=>state.documents.find(d=>d.id===docId)).filter(Boolean);
  const docSection=docs.length?`<label class="full document-view-section">Attached Bill<div class="document-view-list">${docs.map(d=>`<div class="document-view-item"><div class="document-info"><strong>${esc(d.name||d.title||'bill.pdf')}</strong><span>${formatFileSize(d.size)}</span></div><div class="document-actions"><button type="button" class="btn" data-cmd="open-pdf" data-id="${esc(d.id)}">View PDF</button><button type="button" class="btn btn-primary" data-cmd="download-pdf" data-id="${esc(d.id)}">Download</button></div></div>`).join('')}</div></label>`:'';
  const show=(label,value)=>`<label><span class="k">${esc(label)}</span><strong class="view-field">${value===''||value===undefined||value===null?'—':esc(value)}</strong></label>`;
  const configured=officeAccountOption(record.account);
  const accountName=configured?configured.label:String(record.account||'').trim();
  const accountEffect=!accountName
    ?'No account linked'
    :isOfficeOpeningType(record.type)
      ?'Opening balance — no adjustment'
      :record.noAccountChange
        ?'Account left unchanged'
        :`${officeTypeKind(record.type)==='Inflow'?'Adds':'Deducts'} ${formatMoney(record.amount)} ${officeTypeKind(record.type)==='Inflow'?'to':'from'} ${accountName}`;
  document.getElementById('officeFormFields').innerHTML=`<div class="income-form-grid">${show('Type',record.type)}${show('Date',fmtDate(record.date))}${show('Particulars',record.particulars)}<label><span class="k">Category</span><strong class="view-field">${catLabel(record.category,'Office')}</strong></label>${show('Cash & Bank Account',accountName||'Not linked')}${show('Amount',formatMoney(record.amount))}${show('Account effect',accountEffect)}${show('Financial Year',officeEntryYear(record))}${show('Reference / Notes',record.notes)}${docSection}</div>`;
  const footer=document.querySelector('#officeForm .modal-foot');
  footer.innerHTML='<button type="button" class="btn" data-close-modal>Close</button><button type="button" class="btn btn-primary" id="officeViewEdit">Edit Entry</button>';
  footer.querySelector('[data-close-modal]').onclick=()=>document.getElementById('officeModal').close();
  const editBtn=document.getElementById('officeViewEdit');
  if(editBtn)editBtn.onclick=()=>{document.getElementById('officeModal').close();openOfficeModal(id)};
  document.getElementById('officeModal').showModal();
}

/* --- Office page exports --- */
/** Side-by-side FY sheet layout that parseOfficeSheet() can read back without duplicates. */
function officeSheetAoa(fy,entries,opening){
  const rows=entries.filter(r=>!isOfficeOpeningType(r.type)).slice().sort(officeEntryOrder);
  const outflow=rows.filter(r=>officeTypeKind(r.type)==='Outflow');
  const inflow=rows.filter(r=>officeTypeKind(r.type)==='Inflow');
  const totals=officeTotals(rows);
  const openingSigned=Number.isFinite(Number(opening))?Number(opening):officeOpeningBalance(fy);
  const closing=(Number(openingSigned)||0)+totals.net;
  // The caption parses back as the opening balance and the closing "Balance" row is ignored, so an
  // exported sheet re-imports to the same position. A negative opening is written as-is (a credit
  // position) instead of losing its sign in an "(Inflow)" caption.
  const aoa=[[`Office Purchase & Bill - FY ${fy}`,'','','','','','',''],[],['Cash Outflow','','','','Cash Inflow'],[],
    ['','Opening Balance',openingSigned,'','','Balance',closing,''],['Date','Detail','Amount','Cash & Bank','Date','Detail','Amount','Cash & Bank']];
  const lines=Math.max(outflow.length,inflow.length);
  for(let i=0;i<lines;i++){
    const out=outflow[i],inn=inflow[i];
    aoa.push([out?out.date:'',out?out.particulars:'',out?(Number(out.amount)||0):'',out?(out.account||''):'',
      inn?inn.date:'',inn?inn.particulars:'',inn?(Number(inn.amount)||0):'',inn?(inn.account||''):'']);
  }
  aoa.push(['Total','',totals.outflow,'','','',totals.inflow,'']);
  return {aoa,totals,closing};
}
function officeExcelWorkbook(){
  const workbook=XLSX.utils.book_new();
  const years=officeYearList();
  for(const fy of years.slice().reverse()){
    const entries=(state.officePurchases||[]).filter(r=>officeEntryYear(r)===fy);
    const {aoa}=officeSheetAoa(fy,entries,officeOpeningBalance(fy));
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols']=[{wch:12},{wch:38},{wch:14},{wch:18},{wch:12},{wch:38},{wch:14},{wch:18}];
    XLSX.utils.book_append_sheet(workbook,ws,`${fy}`.slice(0,31));
  }
  return workbook;
}
function exportOfficeExcel(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const period=officePeriodLabel();
  const periodSlug=officePeriodYears().length===1?officePeriodYears()[0]:'All-FY';
  const list=getFilteredOfficeEntries().sort(officeEntryOrder);
  if(!list.length){toast('No office entries match the current filters.',true);return}
  const opening=officePeriodOpening();
  const closing=officePeriodClosing();
  const totals=officeTotals(list);
  // Balances stay on the whole selected period, so a filtered export still shows the true position.
  const runMap=officeRunningMap(officeYearEntries().filter(r=>!isOfficeOpeningType(r.type)),opening);
  const runBalance=r=>runMap.has(r.id)?runMap.get(r.id):opening;
  const rows=[['Office Purchase & Bill'],[`Financial Year: ${period}`],[`Generated ${generatedStamp()}`],[],
    ['Filter',officeFilterText()],['Opening Balance',opening],[],['Date','Particulars','Category','Cash & Bank Account','Outflow','Inflow','Balance','Bill Attached','Notes']];
  rows.push(['','Opening Balance'+(opening<0?' (Inflow)':' (Outflow)'),'','','','',opening,'','']);
  for(const r of list){
    rows.push([r.date||'',r.particulars||'',r.category||'',r.account||'',
      officeTypeKind(r.type)==='Inflow'?'':Number(r.amount)||0,officeTypeKind(r.type)==='Inflow'?Number(r.amount)||0:'',
      runBalance(r),(r.documentIds||[]).length?'Yes':'No',r.notes||'']);
  }
  rows.push(['Total (filtered)','','','',totals.outflow,totals.inflow,totals.net,'','']);
  rows.push(['Closing Balance','','','','','',closing,'','']);
  rows.push([]);rows.push(['Cash & Bank Effect (derived from this ledger only)']);
  rows.push(['Account','Outflow','Inflow','Net Effect','Entries']);
  const byAccount=new Map();
  for(const r of list){
    if(isOfficeOpeningType(r.type))continue;
    const key=r.account||'Not linked to an account';
    if(!byAccount.has(key))byAccount.set(key,{outflow:0,inflow:0,count:0});
    const g=byAccount.get(key);g.count++;
    if(officeTypeKind(r.type)==='Inflow')g.inflow+=Math.abs(Number(r.amount)||0);else g.outflow+=Math.abs(Number(r.amount)||0);
  }
  for(const [name,g] of byAccount)rows.push([name,g.outflow,g.inflow,g.inflow-g.outflow,g.count]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:12},{wch:38},{wch:18},{wch:22},{wch:14},{wch:14},{wch:14},{wch:12},{wch:28}];
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,ws,`Office ${periodSlug}`.slice(0,31));
  XLSX.writeFile(workbook,`Office-Purchase-Bill-${periodSlug}-${todayISO()}.xlsx`);
  toast('Office ledger exported to Excel');
}
function exportOfficeWorkbook(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  if(!(state.officePurchases||[]).length){toast('There are no office entries to export yet.',true);return}
  XLSX.writeFile(officeExcelWorkbook(),`Office-Purchase-Bill-Workbook-${todayISO()}.xlsx`);
  toast('Office workbook exported');
}
const OFFICE_TEMPLATE_ROWS=200;
/** The four Entry Type * labels the page already understands (officeTypeKind reads the Inflow part). */
const OFFICE_TEMPLATE_TYPES=['Office Purchase (Cash Outflow)','Bill Received (Cash Inflow)','Opening Balance (Outflow)','Opening Balance (Inflow)'];
/** Category dropdown: the built-in office categories plus every non-cash category from Settings. */
function officeTemplateCategories(){
  const configured=(state.categories||[])
    .filter(category=>!isCashCategoryName(category.name))
    .map(category=>String(category.name||'').replace(/\s+/g,' ').trim());
  return [...new Set([...OFFICE_CATEGORIES,...configured].filter(Boolean))];
}
/**
 * One FY sheet in the column-per-field layout read by parseOfficeFlatSheet(). The dropdown lists
 * live in the hidden helper columns J/K (Entry Types / Categories) and the validations point at
 * that range, so the lists stay valid even though SheetJS cannot write <dataValidation> itself.
 */
function officeTemplateSheet(fy){
  const categories=officeTemplateCategories();
  const rows=[
    [`Office Purchase & Bill - FY ${fy}`],
    ['Fill one row per entry. Entry Type * and Category * are dropdowns. Leave Cash & Bank blank when the entry must not move an account. Re-importing skips rows with the same Date, Entry Type, Particulars and Amount.'],
    ['Date *','Entry Type *','Particulars *','Category *','Cash & Bank','Amount (Taka) *','Notes','','','Entry Types','Categories']
  ];
  for(let i=0;i<OFFICE_TEMPLATE_ROWS;i++){
    const row=new Array(11).fill('');
    if(i<OFFICE_TEMPLATE_TYPES.length)row[9]=OFFICE_TEMPLATE_TYPES[i];
    if(i<categories.length)row[10]=categories[i];
    rows.push(row);
  }
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:12},{wch:26},{wch:40},{wch:24},{wch:18},{wch:16},{wch:30},{wch:2,hidden:true},{wch:2,hidden:true},{wch:28,hidden:true},{wch:30,hidden:true}];
  return {ws,categories};
}
function officeXmlEscape(value){
  return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
/** <dataValidations> block for one sheet, built from explicit dropdown rules. */
function templateValidationsXml(rules){
  const rule=({range,listRef,title,prompt,error})=>`<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="stop" errorTitle="${officeXmlEscape(title)}" error="${officeXmlEscape(error||'Please pick a value from the dropdown list.')}" promptTitle="${officeXmlEscape(title)}" prompt="${officeXmlEscape(prompt)}" sqref="${range}"><formula1>${officeXmlEscape(listRef)}</formula1></dataValidation>`;
  return `<dataValidations count="${rules.length}">${rules.map(rule).join('')}</dataValidations>`;
}
/** <dataValidations> for one sheet: a stop-error dropdown on Entry Type * (B) and Category * (D). */
function officeTemplateValidationsXml(spec){
  if(Array.isArray(spec.rules)&&spec.rules.length)return templateValidationsXml(spec.rules);
  return templateValidationsXml([
    {range:spec.typeRange,listRef:spec.typeList,title:spec.typeTitle||'Entry Type',prompt:spec.typePrompt||'Pick how this entry affects the office ledger.'},
    {range:spec.categoryRange,listRef:spec.categoryList,title:spec.categoryTitle||'Category',prompt:spec.categoryPrompt||'Pick an office category or one from Settings.'}
  ]);
}
/** Injects the block in schema order: dataValidations must precede hyperlinks/ignoredErrors/drawing. */
function officeInjectValidations(xml,block){
  if(!xml||!block||xml.includes('<dataValidations'))return xml;
  const anchors=['<hyperlinks','<printOptions','<pageMargins','<pageSetup','<headerFooter',
    '<rowBreaks','<colBreaks','<customProperties','<cellWatches','<ignoredErrors','<smartTags',
    '<drawing','<legacyDrawing','<legacyDrawingHF','<picture','<oleObjects','<controls',
    '<webPublishItems','<tableParts','<extLst'];
  let at=-1;
  for(const anchor of anchors){
    const index=xml.indexOf(anchor);
    if(index>=0&&(at<0||index<at))at=index;
  }
  if(at<0)at=xml.lastIndexOf('</worksheet>');
  if(at<0)return xml;
  return xml.slice(0,at)+block+xml.slice(at);
}
/** SheetJS writes no data validations, so the generated .xlsx is reopened and each FY sheet XML is
 *  patched with its dropdowns. Any failure keeps a working (just plain) template. */
async function officeTemplateBytesWithValidations(bytes,specs){
  if(!window.JSZip||!specs.length)return bytes;
  const zip=await JSZip.loadAsync(bytes);
  const workbookFile=zip.file('xl/workbook.xml');
  const relsFile=zip.file('xl/_rels/workbook.xml.rels');
  if(!workbookFile||!relsFile)return bytes;
  const workbookXml=await workbookFile.async('string');
  const relsXml=await relsFile.async('string');
  const targets=new Map();
  for(const tag of relsXml.match(/<Relationship\b[^>]*>/g)||[]){
    const id=(tag.match(/\bId="([^"]+)"/)||[])[1];
    const target=(tag.match(/\bTarget="([^"]+)"/)||[])[1];
    if(id&&target)targets.set(id,target);
  }
  const byName=new Map(specs.map(spec=>[spec.name,spec]));
  const patched=new Set();
  for(const tag of workbookXml.match(/<sheet\b[^>]*>/g)||[]){
    const rawName=(tag.match(/\bname="([^"]*)"/)||[])[1];
    // Sheet names are XML-escaped in workbook.xml, so "Assets & Liabilities" arrives as
    // "Assets &amp; Liabilities" and would never match spec.name without decoding.
    const name=rawName?rawName.replace(/&amp;/g,'&').replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>'):rawName;
    const rid=(tag.match(/\br:id="([^"]+)"/)||[])[1];
    const spec=name?byName.get(name):null;
    if(!spec||!rid)continue;
    let target=targets.get(rid);
    if(!target)continue;
    target=target.startsWith('/')?target.slice(1):(target.startsWith('xl/')?target:`xl/${target}`);
    const file=zip.file(target);
    if(!file||patched.has(target))continue;
    patched.add(target);
    zip.file(target,officeInjectValidations(await file.async('string'),officeTemplateValidationsXml(spec)));
  }
  return patched.size?zip.generateAsync({type:'arraybuffer'}):bytes;
}
async function downloadOfficeTemplate(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const years=officeYearList();
  const selected=officePeriodYears();
  const fy=(selected.length===1?selected[0]:officeCurrentYear())||years[0]||'';
  const current=parseInt(String(fy).slice(0,4),10)||new Date().getFullYear();
  const targets=[`${current}-${String((current+1)%100).padStart(2,'0')}`,`${current+1}-${String((current+2)%100).padStart(2,'0')}`];
  const workbook=XLSX.utils.book_new();
  const specs=[];
  for(const year of targets){
    const {ws,categories}=officeTemplateSheet(year);
    XLSX.utils.book_append_sheet(workbook,ws,year);
    specs.push({
      name:year,
      typeRange:`B4:B${3+OFFICE_TEMPLATE_ROWS}`,
      categoryRange:`D4:D${3+OFFICE_TEMPLATE_ROWS}`,
      typeList:`$J$4:$J$${3+OFFICE_TEMPLATE_TYPES.length}`,
      categoryList:`$K$4:$K$${3+categories.length}`
    });
  }
  let bytes=XLSX.write(workbook,{bookType:'xlsx',type:'array'});
  let dropdowns=false;
  if(window.JSZip){
    try{
      bytes=await officeTemplateBytesWithValidations(bytes,specs);
      dropdowns=true;
    }catch(error){
      console.warn('Office template dropdowns could not be added',error);
    }
  }
  downloadBlob(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`Office-Purchase-Bill-Template-${todayISO()}.xlsx`);
  if(dropdowns){
    toast('Template downloaded — Entry Type * and Category * are dropdowns in every FY sheet');
  }else{
    toast('Template downloaded, but the dropdown lists need the ZIP library — reload while online to add them',true);
  }
}

async function exportOfficePdf(){
  const JsPDF=window.jspdf&&window.jspdf.jsPDF;
  if(!JsPDF){toast('PDF library is unavailable. Check your internet connection.',true);return}
  const period=officePeriodLabel();
  const pdfPeriod=period.replace(/\s*→\s*/,' to ');
  const periodSlug=officePeriodYears().length===1?officePeriodYears()[0]:'All-FY';
  const list=getFilteredOfficeEntries().sort(officeEntryOrder);
  if(!list.length){toast('No office entries match the current filters.',true);return}
  const opening=officePeriodOpening();
  const totals=officeTotals(list);
  const runMap=officeRunningMap(officeYearEntries().filter(r=>!isOfficeOpeningType(r.type)),opening);
  const doc=new JsPDF({orientation:'landscape',unit:'pt',format:'a4',compress:true});
  if(typeof doc.autoTable!=='function'){toast('PDF table plugin is unavailable. Check your internet connection.',true);return}
  doc.setProperties({title:`Office Purchase & Bill - ${pdfPeriod}`,subject:officeFilterText().replace(/\s*→\s*/,' to '),creator:'SOIKOT RAIHAN'});
  const M=32,FOOT=30;
  const pageW=()=>doc.internal.pageSize.getWidth();
  const pageH=()=>doc.internal.pageSize.getHeight();
  const drawHeader=()=>{
    const W=pageW();
    doc.setFillColor(15,23,42);doc.rect(0,0,W,74,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(15);doc.setTextColor(255,255,255);
    doc.text('Office Purchase & Bill',M,32);
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(203,213,225);
    doc.text(`${pdfPeriod}  ·  Generated ${generatedStamp()}`,M,48);
    doc.text(officeFilterText().replace(/\s*→\s*/,' to '),M,61);
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(255,255,255);
    doc.text(`Balance ${pdfMoney(officePeriodClosing())}`,W-M,40,{align:'right'});
  };
  drawHeader();
  const body=[];
  body.push([{content:opening<0?'Opening Balance (Inflow)':'Opening Balance (Outflow)',colSpan:4,styles:{fontStyle:'bold',fillColor:[241,245,249]}},{content:'',styles:{fillColor:[241,245,249]}},{content:'',styles:{fillColor:[241,245,249]}},{content:pdfMoney(Math.abs(opening)),styles:{halign:'right',fontStyle:'bold',fillColor:[241,245,249]}}]);
  for(const r of list){
    body.push([fmtDate(r.date)||'-',r.particulars||'-',r.category||'-',r.account||'-',
      officeTypeKind(r.type)==='Inflow'?'-':pdfMoney(r.amount),officeTypeKind(r.type)==='Inflow'?pdfMoney(r.amount):'-',
      pdfMoney(runMap.has(r.id)?runMap.get(r.id):opening)]);
  }
  doc.autoTable({
    startY:86,theme:'grid',margin:{left:M,right:M,top:86,bottom:FOOT},
    head:[['Date','Particulars','Category','Cash & Bank','Outflow','Inflow','Balance']],
    body,
    foot:[[{content:`Total · ${pdfPeriod}`,colSpan:4,styles:{halign:'right'}},{content:pdfMoney(totals.outflow),styles:{halign:'right'}},{content:pdfMoney(totals.inflow),styles:{halign:'right'}},{content:pdfMoney(officePeriodClosing()),styles:{halign:'right'}}]],
    headStyles:{fillColor:[15,23,42],textColor:[255,255,255],fontStyle:'bold',fontSize:8.5},
    footStyles:{fillColor:[238,242,255],textColor:[49,46,129],fontStyle:'bold'},
    styles:{fontSize:8,cellPadding:5,overflow:'linebreak'},
    columnStyles:{0:{cellWidth:62},1:{cellWidth:'auto'},2:{cellWidth:90},3:{cellWidth:96},4:{cellWidth:76,halign:'right'},5:{cellWidth:76,halign:'right'},6:{cellWidth:80,halign:'right'}},
    didDrawPage:data=>{if(data.pageNumber>1)drawHeader()}
  });
  let y=doc.lastAutoTable.finalY+16;
  if(y>pageH()-FOOT-60){doc.addPage();drawHeader();y=100}
  const cashRows=[['Account','Outflow','Inflow','Net Effect','Entries']];
  const byAccount=new Map();
  for(const r of list){
    if(isOfficeOpeningType(r.type))continue;
    const key=r.account||'Not linked to an account';
    if(!byAccount.has(key))byAccount.set(key,{outflow:0,inflow:0,count:0});
    const g=byAccount.get(key);g.count++;
    if(officeTypeKind(r.type)==='Inflow')g.inflow+=Math.abs(Number(r.amount)||0);else g.outflow+=Math.abs(Number(r.amount)||0);
  }
  for(const [name,g] of byAccount)cashRows.push([name,pdfMoney(g.outflow),pdfMoney(g.inflow),pdfMoney(g.inflow-g.outflow),String(g.count)]);
  doc.autoTable({
    startY:y,theme:'grid',margin:{left:M,right:M,top:86,bottom:FOOT},
    head:[cashRows[0]],body:cashRows.slice(1),
    headStyles:{fillColor:[71,85,105],textColor:[255,255,255],fontStyle:'bold',fontSize:8},
    styles:{fontSize:8,cellPadding:5},
    columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'}},
    didDrawPage:data=>{if(data.pageNumber>1)drawHeader()}
  });
  const total=doc.getNumberOfPages();
  for(let i=1;i<=total;i++){
    doc.setPage(i);
    const W=pageW(),H=pageH();
    doc.setDrawColor(226,232,240);doc.setLineWidth(.6);doc.line(M,H-26,W-M,H-26);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,116,139);
    doc.text('Personal Finance  ·  SOIKOT RAIHAN  ·  Office Purchase & Bill',M,H-13);
    doc.text(`Page ${i} of ${total}`,W-M,H-13,{align:'right'});
  }
  doc.save(`Office-Purchase-Bill-${periodSlug}-${todayISO()}.pdf`);
  toast(`Office ledger PDF generated (${total} page${total===1?'':'s'})`);
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
  await persistCategoryStructure();
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
  await persistCategoryStructure();
  await loadState();renderCategoryTree();renderIncomePage();toast('Major head renamed');
}
async function deleteIncomeGroup(id){
  const g=state.incomeGroups.find(x=>x.id===id);if(!g)return;
  const linked=state.incomeExpenses.some(r=>r.type===g.type&&r.majorHead===g.majorHead);
  if(linked){toast('This major head has linked transactions and cannot be deleted.',true);return}
  if(await confirm(`Delete major head "${g.majorHead}" and all of its categories?`,'Delete Major Head')){
    state.incomeGroups=state.incomeGroups.filter(entry=>entry.id!==id);
    await remove('incomeGroups',id);
    await persistCategoryStructure();
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
  await persistCategoryStructure();
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
    await persistCategoryStructure();
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
  await persistCategoryStructure();
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
    await persistCategoryStructure();
    await loadState();renderCategoryTree();renderIncomePage();toast('Subcategory deleted');
  }
}

/* --- Optional PDF staged in the Settings migration card ----------------------
   One PDF can be attached to a whole migration batch. Every imported record gets its own
   copy in the same "documents" + "documentBlobs" stores and is linked through documentIds,
   so the PDF badges, viewer, download, delete and Drive backup behave exactly like a PDF
   attached in the Add/Edit form. With no PDF selected the import runs unchanged.
   -------------------------------------------------------------------------- */
let migrationPdfDraft=null;

function setMigrationPdfLabel(file){
  const label=$el('migrationPdfFileName');
  const clear=$el('migrationPdfClear');
  if(label){
    if(file){
      label.textContent=`${file.name} · ${formatFileSize(file.size)}`;
      label.title=file.name;
      label.classList.add('has-file');
    }else{
      label.textContent='No PDF selected';
      label.removeAttribute('title');
      label.classList.remove('has-file');
    }
  }
  if(clear)clear.classList.toggle('hidden',!file);
}
function migrationPdfChosen(event){
  const input=event.target;
  const file=input.files&&input.files[0];
  input.value='';
  if(!file)return;
  if(!isPdfFile(file)){toast('That file is not a PDF. Choose a .pdf file.',true);return}
  if(file.size>MAX_IMPORT_BYTES){toast('That PDF is larger than 30 MB. Choose a smaller file.',true);return}
  migrationPdfDraft=file;
  setMigrationPdfLabel(file);
}
function clearMigrationPdf(){
  migrationPdfDraft=null;
  const input=$el('migrationPdf');
  if(input)input.value='';
  setMigrationPdfLabel(null);
}
/** Small metadata record shaped exactly like the ones the record / transaction forms write. */
function migrationPdfRecord(id,record,file){
  return {
    id,recordId:record.id,
    title:file.name,name:file.name,
    type:file.type||'application/pdf',size:Number(file.size)||0,
    category:record.category||'',subcategory:record.subcategory||'',
    financialType:record.type||'',incomeYear:record.incomeYear||'',
    createdAt:new Date().toISOString()
  };
}
/** Stores one copy of the staged PDF per imported row and links it through documentIds. */
async function attachMigrationPdf(rows,file){
  if(!file||!Array.isArray(rows)||!rows.length)return 0;
  const docs=[],blobs=[],linked=[];
  try{
    for(const row of rows){
      if(!row)continue;
      const docId=uid('doc');
      const previous=Array.isArray(row.documentIds)?[...row.documentIds]:[];
      blobs.push({id:docId,blob:file});
      docs.push(migrationPdfRecord(docId,row,file));
      row.documentIds=[...previous,docId];
      linked.push({row,previous});
    }
    if(!docs.length)return 0;
    await putMany('documentBlobs',blobs);
    await putMany('documents',docs);
    return docs.length;
  }catch(error){
    // Never leave a record pointing at a document that was not stored: the rows still import.
    for(const entry of linked)entry.row.documentIds=entry.previous;
    console.warn('The migration PDF could not be attached',error);
    toast('The rows were imported, but the PDF could not be attached.',true);
    return 0;
  }
}
const migrationPdfNote=count=>count?` · PDF attached to ${count} record${count===1?'':'s'}`:'';

/* --- Import workers (called by importExcel dispatcher) --- */
async function importAssetsLiabilitiesWorkbook(workbook,replaceId,fileName,options={}){
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
  const pdfAttached=await attachMigrationPdf(toSave,options.pdfFile);
  if(toSave.length)await putMany('records',toSave);
  const knownYears=new Set(state.settings.incomeYears||[]);
  if([...years].some(y=>!knownYears.has(y))){
    state.settings.incomeYears=[...new Set([...knownYears,...years])].sort((a,b)=>String(b).localeCompare(String(a)));
    await put('settings',{key:'incomeYears',value:state.settings.incomeYears});
  }
  await saveMigrationMeta(migrationId,replaceId,'Assets & Liabilities',fileName,toSave.length,skippedDuplicates);
  await loadState();renderAll();
  const truncatedNote=truncated?` ${truncated} sheet(s) were read up to ${MAX_IMPORT_ROWS} rows.`:'';
  toast(`${replaceId?'Replaced':'Import complete'}: ${toSave.length} imported, ${skippedDuplicates} duplicate(s) skipped, ${manual} sheet(s) need manual review.${truncatedNote}${migrationPdfNote(pdfAttached)}`,manual>0&&!toSave.length);
  console.info('Excel import summary',summary);
  return pdfAttached;
}
async function importIncomeExpensesWorkbook(workbook,replaceId,fileName,options={}){
  const keepAccounts=!!options.noAccountChange;
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
  const priorByKey=new Map();
  if(!replaceId)state.incomeExpenses.forEach(r=>{if(r.sourceSheet)priorByKey.set(`${r.sourceSheet}|${r.sourceRow}`,r)});
  const reflagged=[];
  const toSave=[];let skipped=0;
  for(const ms of monthSheets){
    const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[ms.name],{header:1,defval:'',raw:true});
    if(aoa.length>MAX_IMPORT_ROWS)aoa.length=MAX_IMPORT_ROWS;
    const rows=parseIncomeExpensesSheet(aoa,ms.num,ms.name,fiscalStart);
    // "I Do not want to change Account": the row keeps its account label but never moves a balance.
    if(keepAccounts)rows.forEach(rec=>{rec.noAccountChange=true});
    for(const rec of rows){
      const key=`${ms.name}|${rec.sourceRow}`;
      if(seen.has(key)){
        skipped++;
        const prior=priorByKey.get(key);
        if(keepAccounts&&prior&&!prior.noAccountChange){prior.noAccountChange=true;prior.updatedAt=new Date().toISOString();reflagged.push(prior)}
        continue;
      }
      seen.add(key);
      rec.migrationId=migrationId;
      toSave.push(rec);
    }
  }
  if(replaceId&&!toSave.length){toast('The replacement file produced no valid rows — the existing batch was left unchanged.',true);return}
  if(replaceId)await removeMigrationRows(replaceId);
  const pdfAttached=await attachMigrationPdf(toSave,options.pdfFile);
  if(toSave.length)await putMany('incomeExpenses',toSave);
  if(reflagged.length)await putMany('incomeExpenses',reflagged);
  await putMany('incomeGroups',state.incomeGroups);
  const years=new Set(toSave.map(r=>r.incomeYear).filter(Boolean));
  const known=new Set(state.settings.incomeYears||[]);
  if([...years].some(y=>!known.has(y))){
    state.settings.incomeYears=[...new Set([...known,...years])].sort((a,b)=>String(b).localeCompare(String(a)));
    await put('settings',{key:'incomeYears',value:state.settings.incomeYears});
  }
  await saveMigrationMeta(migrationId,replaceId,'Income & Expenses',fileName,toSave.length,skipped);
  await loadState();renderAll();
  toast(`${replaceId?'Replaced':'Imported'} ${toSave.length} income/expense entries from Income & Expenses.xlsx (Skipped ${skipped} duplicates)${reflagged.length?` · ${reflagged.length} earlier row(s) no longer change Cash & Bank`:''}${migrationPdfNote(pdfAttached)}`);
  return pdfAttached;
}
async function importBudgeFile(aoa,sourceName,replaceId,options={}){
  const keepAccounts=!!options.noAccountChange;
  const migrationId=replaceId||uid('mig');
  const headerRow=detectBudgeHeader(aoa);
  if(headerRow<0){toast('No Budge header row found in this file.',true);return}
  const headerCells=(aoa[headerRow]||[]).map(c=>normKey(String(c??'')));
  const cols={};headerCells.forEach((c,i)=>{if(c)cols[c]=i});
  const get=(row,key)=>row[cols[key]];
  const existingHashes=replaceId?new Set():new Set(state.incomeExpenses.map(r=>r.importHash).filter(Boolean));
  // Rows imported earlier are skipped as duplicates, but a ticked "I Do not want to change Account" still applies to them.
  const priorByHash=new Map();
  if(!replaceId)state.incomeExpenses.forEach(r=>{if(r.importHash)priorByHash.set(r.importHash,r)});
  const reflagged=[];
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
    if(existingHashes.has(hash)){
      skipped++;
      const prior=priorByHash.get(hash);
      if(keepAccounts&&prior&&!prior.noAccountChange){prior.noAccountChange=true;prior.updatedAt=new Date().toISOString();reflagged.push(prior)}
      continue;
    }
    existingHashes.add(hash);
    toSave.push({id:uid('ie'),type,date,incomeYear:fiscalYearFromDate(date),majorHead:cls.majorHead,category:cls.category,subcategory:cls.subcategory,amount,account,description,...(keepAccounts?{noAccountChange:true}:{}),documentIds:[],importHash:hash,migrationId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  if(replaceId&&!toSave.length){toast('The replacement file produced no valid rows — the existing batch was left unchanged.',true);return}
  if(replaceId)await removeMigrationRows(replaceId);
  const pdfAttached=await attachMigrationPdf(toSave,options.pdfFile);
  if(toSave.length)await putMany('incomeExpenses',toSave);
  if(reflagged.length)await putMany('incomeExpenses',reflagged);
  await putMany('incomeGroups',state.incomeGroups);
  const years=new Set(toSave.map(r=>r.incomeYear).filter(Boolean));
  const known=new Set(state.settings.incomeYears||[]);
  if([...years].some(y=>!known.has(y))){
    state.settings.incomeYears=[...new Set([...known,...years])].sort((a,b)=>String(b).localeCompare(String(a)));
    await put('settings',{key:'incomeYears',value:state.settings.incomeYears});
  }
  await saveMigrationMeta(migrationId,replaceId,'Budge CSV',sourceName,toSave.length,skipped);
  await loadState();renderAll();
  toast(`${replaceId?'Replaced':'Imported'} ${toSave.length} transactions (Skipped ${skipped} already imported)${reflagged.length?` · ${reflagged.length} earlier row(s) no longer change Cash & Bank`:''}${migrationPdfNote(pdfAttached)}`);
  return pdfAttached;
}

/* ==========================================================================
   Excel & Budge CSV Migration: template, export and flat template import
   The Settings migration card mirrors the Office card: Import (with the
   "I Do not want to change Account" confirmation), a downloadable template
   whose Type / Entry Type * and Category * cells are dropdowns sourced from
   Manage Categories, and an export that keeps the template layout so the file
   can be re-imported without duplicates.
   ========================================================================== */
const MIGRATION_TEMPLATE_ROWS=500;
const MIGRATION_TEMPLATE_SHEETS={assets:'Assets & Liabilities',income:'Income & Expenses'};
const MIGRATION_TEMPLATE_HEADERS={
  assets:['Date','Type','Category *','Subcategory','Particulars *','Amount / Balance *','Currency','Status','Income Year','Details','Funded from Asset Subcategory'],
  income:['Date','Entry Type *','Major Head','Category *','Subcategory','Amount (Taka) *','Account / Method','Description','Income Year']
};
const MIGRATION_TEMPLATE_TYPES={assets:['Asset','Liability'],income:['Income','Expense']};
/* Assets & Liabilities: every dropdown is resolved from the hidden Lists sheet. */
const ASSET_TEMPLATE_LISTS_SHEET='Lists';
const ASSET_TEMPLATE_FUNDING_HEADER='Funded from Asset Subcategory';
const ASSET_TEMPLATE_FUNDING_KEY='FUND';
const ASSET_TEMPLATE_EMPTY_NAME='PF_AT_NONE';

/* --- Income & Expenses template: real Excel dropdowns driven by the classification tree --- */
const INCOME_TEMPLATE_HELPER_SHEETS={lists:'Meta - Simple Lists',meta:'Meta - Hierarchies'};

/**
 * Unique Major Heads -> Categories -> Subcategories, in the order saved in Manage Categories.
 * The same tree fills both hidden helper sheets and the four validations.
 */
function incomeTemplateStructure(){
  const majors=[],catsByHead=new Map(),subsByKey=new Map(),metaRows=[];
  for(const group of state.incomeGroups||[]){
    const head=normClass(group&&group.majorHead);
    if(!head)continue;
    if(!catsByHead.has(head)){catsByHead.set(head,[]);majors.push(head)}
    const categories=catsByHead.get(head);
    for(const category of group.categories||[]){
      const name=normClass(typeof category==='string'?category:category&&category.name);
      if(!name)continue;
      if(!categories.includes(name))categories.push(name);
      const key=`${head}||${name}`;
      if(!subsByKey.has(key))subsByKey.set(key,[]);
      const subs=subsByKey.get(key);
      const before=metaRows.length;
      const list=typeof category==='string'?[]:(category.subcategories||[]);
      for(const value of list){
        const sub=normClass(value);
        if(!sub||subs.includes(sub))continue;
        subs.push(sub);
        metaRows.push([head,name,sub]);
      }
      if(metaRows.length===before)metaRows.push([head,name,'']);
    }
  }
  return {majors,catsByHead,subsByKey,metaRows};
}

/**
 * "Meta - Simple Lists" layout: column A holds the unique Major Heads and every column from C
 * on holds one unique list under a row-1 key - the Major Head for categories, or
 * "Major Head||Category" for subcategories. Column B is a spacer so the C-based ranges stay valid.
 * Each column also becomes a workbook-level defined name (PF_MH_n / PF_SUB_n) so the dependent
 * validations can reach it with INDIRECT.
 */
function incomeTemplateListsSheet(structure){
  const columns=[];
  for(const head of structure.majors)columns.push({title:head,values:structure.catsByHead.get(head)||[],prefix:'PF_MH_'});
  for(const [title,values] of structure.subsByKey)columns.push({title,values,prefix:'PF_SUB_'});
  const height=Math.max(1,structure.majors.length,...columns.map(column=>column.values.length));
  const rows=[['Major Heads','',...columns.map(column=>column.title)]];
  for(let i=0;i<height;i++){
    rows.push([structure.majors[i]||'','',...columns.map(column=>column.values[i]??'')]);
  }
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:44},{wch:2,hidden:true},...columns.map(()=>({wch:30,hidden:true}))];
  // PF_SUB_0 is the fallback the Subcategory dropdown uses before a Category is picked: the first
  // real subcategory list when one exists, otherwise the blank spacer cell B2.
  const firstSub=columns.findIndex(column=>column.prefix==='PF_SUB_');
  const fallbackLetter=firstSub>=0?XLSX.utils.encode_col(2+firstSub):'B';
  const fallbackLastRow=firstSub>=0?Math.max(2,1+columns[firstSub].values.length):2;
  const names=[{Name:'PF_SUB_0',Ref:`'${INCOME_TEMPLATE_HELPER_SHEETS.lists}'!$${fallbackLetter}$2:$${fallbackLetter}$${fallbackLastRow}`}];
  columns.forEach((column,index)=>{
    const letter=XLSX.utils.encode_col(2+index);
    const lastRow=Math.max(2,1+column.values.length);
    names.push({Name:`${column.prefix}${index+1}`,Ref:`'${INCOME_TEMPLATE_HELPER_SHEETS.lists}'!$${letter}$2:$${letter}$${lastRow}`});
  });
  const lastColumn=XLSX.utils.encode_col(2+Math.max(1,columns.length)-1);
  return {ws,names,lastColumn};
}

/** "Meta - Hierarchies": the flat Major Head -> Category -> Subcategory table (one row per path). */
function incomeTemplateMetaSheet(structure){
  const ws=XLSX.utils.aoa_to_sheet([['Major Head','Category','Subcategory'],...structure.metaRows]);
  ws['!cols']=[{wch:46},{wch:34},{wch:34}];
  return ws;
}

function incomeTemplateListRef(range){return `'${INCOME_TEMPLATE_HELPER_SHEETS.lists}'!${range}`}

/**
 * Dependent-list formula: MATCH finds the column of the picked parent in the key row, and
 * INDIRECT resolves the defined name that points at exactly the filled cells below it.
 * IFERROR falls back to `fallback` while the parent cell is still empty.
 */
function incomeTemplateDependentFormula(prefix,keyExpr,headerRange,fallback){
  return `INDIRECT("${prefix}"&IFERROR(MATCH(${keyExpr},${headerRange},0),${fallback}))`;
}

/** Income & Expenses sheet with real dropdowns, backed by the two hidden helper sheets. */
function incomeMigrationTemplateSheet(dataRows=[]){
  const headers=MIGRATION_TEMPLATE_HEADERS.income;
  const structure=incomeTemplateStructure();
  if(!structure.majors.length){structure.majors.push('Other Income');structure.catsByHead.set('Other Income',[])}
  const total=Math.max(MIGRATION_TEMPLATE_ROWS,(dataRows||[]).length);
  const rows=[
    [`${MIGRATION_TEMPLATE_SHEETS.income} - Migration Template`],
    ['Fill one row per income or expense. Entry Type * is Income/Expense; pick Major Head, then Category *, then Subcategory - each dropdown filters the next one. Re-importing skips rows that are already imported.'],
    headers
  ];
  for(let i=0;i<total;i++){
    const row=new Array(headers.length).fill('');
    const data=(dataRows||[])[i];
    if(data)data.forEach((value,c)=>{if(c<headers.length)row[c]=value??''});
    rows.push(row);
  }
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:12},{wch:18},{wch:40},{wch:30},{wch:30},{wch:16},{wch:22},{wch:36},{wch:14}];
  const lists=incomeTemplateListsSheet(structure);
  const keys=incomeTemplateListRef(`$C$1:$${lists.lastColumn}$1`);
  const lastRow=3+total;
  const spec={
    name:MIGRATION_TEMPLATE_SHEETS.income,
    rules:[
      {range:`B4:B${lastRow}`,listRef:'"Income,Expense"',title:'Entry Type',prompt:'Pick Income or Expense.'},
      {range:`C4:C${lastRow}`,listRef:incomeTemplateListRef(`$A$2:$A$${1+structure.majors.length}`),title:'Major Head',prompt:'Pick a Major Head - it filters the Category dropdown.'},
      {range:`D4:D${lastRow}`,listRef:incomeTemplateDependentFormula('PF_MH_','$C4',keys,1),title:'Category',prompt:'The list follows the Major Head you picked.'},
      {range:`E4:E${lastRow}`,listRef:incomeTemplateDependentFormula('PF_SUB_','$C4&"||"&$D4',keys,0),title:'Subcategory',prompt:'The list follows the Category you picked.'}
    ]
  };
  return {
    ws,
    spec,
    extraSheets:[
      {name:INCOME_TEMPLATE_HELPER_SHEETS.lists,ws:lists.ws,names:lists.names},
      {name:INCOME_TEMPLATE_HELPER_SHEETS.meta,ws:incomeTemplateMetaSheet(structure)}
    ]
  };
}

/* --- Assets & Liabilities template: hidden "Lists" sheet + dependent dropdowns --- */

/** Excel defined names may not hold spaces or '&', so every list key is sanitized first. */
function templateNameToken(value,used){
  const base=String(value??'').replace(/[^A-Za-z0-9_.]/g,'_').replace(/_{2,}/g,'_').replace(/^_+|_+$/g,'')||'LIST';
  let name=`PF_AT_${base}`,suffix=2;
  while(used.has(name.toLowerCase()))name=`PF_AT_${base}_${suffix++}`;
  used.add(name.toLowerCase());
  return name;
}

/**
 * Category -> Subcategory tree of the Assets & Liabilities sheet, read from the same
 * state.categories the Add Record form renders (Manage Categories), split by Financial Type.
 */
function assetsTemplateStructure(){
  const catsByType=new Map(),subsByKey=new Map();
  for(const type of MIGRATION_TEMPLATE_TYPES.assets){
    const categories=[];
    catsByType.set(type,categories);
    for(const category of orderedCategories(type)){
      const name=normClass(category.name);
      if(!name||categories.includes(name))continue;
      categories.push(name);
      const key=`${type}||${name}`;
      if(subsByKey.has(key))continue;
      const subs=[...new Set((category.subcategories||[]).map(sub=>normClass(sub)).filter(Boolean))];
      // Add Record falls back to the category name when a category has no subcategory yet.
      subsByKey.set(key,subs.length?subs:[name]);
    }
  }
  const funding=[...new Set([...subsByKey].filter(([key])=>key.startsWith('Asset||')).flatMap(([,subs])=>subs))];
  return {catsByType,subsByKey,funding};
}

/**
 * Hidden "Lists" sheet: column A holds the Financial Types and every column from C on holds one
 * dropdown list. Row 1 keeps the lookup key (Type, "Type||Category", "FUND||Type||Category"),
 * row 2 its sanitized defined name and row 3+ the values, so a dependent validation only needs
 * MATCH + INDIRECT. Cash & Bank categories get an empty funding column: that empty list is what
 * blocks the Funded from cell, while every other category lists the Asset subcategories.
 */
function assetsTemplateListsSheet(structure){
  const columns=[];
  for(const type of MIGRATION_TEMPLATE_TYPES.assets)columns.push({key:type,values:structure.catsByType.get(type)||[]});
  for(const [key,values] of structure.subsByKey)columns.push({key,values});
  for(const [key] of structure.subsByKey){
    const [type,category]=key.split('||');
    // Same rule as the Add Record form: only an Asset/Cash category loses its funding source.
    const values=type==='Asset'&&isCashCategoryName(category)?[]:structure.funding;
    columns.push({key:`${ASSET_TEMPLATE_FUNDING_KEY}||${key}`,values});
  }
  const used=new Set();
  for(const column of columns)column.name=templateNameToken(column.key,used);
  const height=Math.max(1,MIGRATION_TEMPLATE_TYPES.assets.length,...columns.map(column=>column.values.length));
  const rows=[
    ['Type','',...columns.map(column=>column.key)],
    ['','',...columns.map(column=>column.name)]
  ];
  for(let i=0;i<height;i++)rows.push([MIGRATION_TEMPLATE_TYPES.assets[i]||'','',...columns.map(column=>column.values[i]??'')]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:14},{wch:2,hidden:true},...columns.map(()=>({wch:38,hidden:true}))];
  const names=columns.map((column,index)=>{
    const letter=XLSX.utils.encode_col(2+index);
    return {Name:column.name,Ref:`'${ASSET_TEMPLATE_LISTS_SHEET}'!$${letter}$3:$${letter}$${Math.max(3,2+column.values.length)}`};
  });
  // Blank spacer cell: fallback list while the parent cell is still empty, and the blocked list.
  names.push({Name:ASSET_TEMPLATE_EMPTY_NAME,Ref:`'${ASSET_TEMPLATE_LISTS_SHEET}'!$B$3`});
  return {ws,names,lastColumn:XLSX.utils.encode_col(2+columns.length-1)};
}

/** MATCH finds the list column for the picked parent key, INDEX returns its defined name. */
function assetsTemplateDependentList(keysRange,namesRange,matchExpr){
  return `IFERROR(INDIRECT(INDEX(${namesRange},MATCH(${matchExpr},${keysRange},0))),${ASSET_TEMPLATE_EMPTY_NAME})`;
}

/** Assets & Liabilities sheet: every dropdown resolves through the hidden Lists sheet. */
function assetsMigrationTemplateSheet(dataRows=[]){
  const headers=MIGRATION_TEMPLATE_HEADERS.assets;
  const structure=assetsTemplateStructure();
  const total=Math.max(MIGRATION_TEMPLATE_ROWS,(dataRows||[]).length);
  const rows=[
    [`${MIGRATION_TEMPLATE_SHEETS.assets} - Migration Template`],
    ['One row per asset or liability. Type, Category *, Subcategory and Funded from Asset Subcategory are dependent dropdowns fed by the hidden Lists sheet (Manage Categories); Funded from stays blank - and rejects input - on Cash & Bank Account rows. Re-importing skips rows that are already imported.'],
    headers
  ];
  for(let i=0;i<total;i++){
    const row=new Array(headers.length).fill('');
    const data=(dataRows||[])[i];
    if(data)data.forEach((value,c)=>{if(c<headers.length)row[c]=value??''});
    rows.push(row);
  }
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[12,14,26,30,40,18,10,12,14,34,28].map(wch=>({wch}));
  const lists=assetsTemplateListsSheet(structure);
  const ref=range=>`'${ASSET_TEMPLATE_LISTS_SHEET}'!${range}`;
  const keys=ref(`$C$1:$${lists.lastColumn}$1`);
  const names=ref(`$C$2:$${lists.lastColumn}$2`);
  const lastRow=3+total;
  const fundingCol=XLSX.utils.encode_col(headers.indexOf(ASSET_TEMPLATE_FUNDING_HEADER));
  return {
    ws,
    spec:{
      name:MIGRATION_TEMPLATE_SHEETS.assets,
      rules:[
        {range:`B4:B${lastRow}`,listRef:ref(`$A$3:$A$${2+MIGRATION_TEMPLATE_TYPES.assets.length}`),title:'Type',prompt:'Pick Asset or Liability - it filters the Category dropdown.'},
        {range:`C4:C${lastRow}`,listRef:assetsTemplateDependentList(keys,names,'$B4'),title:'Category',prompt:'The list follows the Type you picked.'},
        {range:`D4:D${lastRow}`,listRef:assetsTemplateDependentList(keys,names,'$B4&"||"&$C4'),title:'Subcategory',prompt:'The list follows the Category you picked.'},
        {range:`${fundingCol}4:${fundingCol}${lastRow}`,listRef:assetsTemplateDependentList(keys,names,`"${ASSET_TEMPLATE_FUNDING_KEY}||"&$B4&"||"&$C4`),title:ASSET_TEMPLATE_FUNDING_HEADER,prompt:'Pick the Asset subcategory that funded this record. Cash & Bank Account rows keep it blank.',error:'Funded from applies to every category except Cash & Bank Account - leave this cell blank.'}
      ]
    },
    extraSheets:[{name:ASSET_TEMPLATE_LISTS_SHEET,ws:lists.ws,names:lists.names}]
  };
}

/**
 * One flat sheet in the exact layout read by importMigrationTemplateWorkbook(). Both sheets carry
 * real dropdowns: Income & Expenses uses its hierarchy helper sheets, Assets & Liabilities the
 * hidden Lists sheet. SheetJS cannot write <dataValidation> itself, so the rules in spec.rules are
 * injected by officeTemplateBytesWithValidations.
 */
function migrationTemplateSheet(kind,dataRows=[]){
  return kind==='assets'?assetsMigrationTemplateSheet(dataRows):incomeMigrationTemplateSheet(dataRows);
}
/* --- ExcelJS migration template: hidden "Lists" sheet + row-relative dependent dropdowns --------
   The community SheetJS build cannot write <dataValidation>, so the downloadable template is built
   with ExcelJS instead. Every option list owns one column on the hidden "Lists" sheet: row 1 holds
   the header (the parent value), row 2+ the options, and each column gets one Named Range that
   covers only its filled cells. A dropdown resolves its list with a row-relative
   INDIRECT(SUBSTITUTE(...)) that mirrors sanitizeName(), so the parent cell drives the options. */

const TEMPLATE_EXCELJS_URL='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const TEMPLATE_CATEGORY_HEADER='Category';
const TEMPLATE_MAJOR_HEADER='Major Head';
/** Funded from Asset Subcategory stays blocked for these even if Manage Categories has no match. */
const TEMPLATE_CASH_CATEGORIES=['Cash','Bank Account'];
const TEMPLATE_VALIDATION_FLAGS={allowBlank:true,showInputMessage:true,showErrorMessage:true,errorStyle:'stop'};

let templateExcelJsLoader=null;

/** ExcelJS is only needed for the dropdown templates, so it is fetched on first use. */
function loadTemplateExcelJS(){
  if(window.ExcelJS)return Promise.resolve(window.ExcelJS);
  if(!templateExcelJsLoader){
    templateExcelJsLoader=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=TEMPLATE_EXCELJS_URL;
      script.async=true;
      script.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(new Error('ExcelJS could not be loaded.'));
      script.onerror=()=>reject(new Error('ExcelJS could not be loaded.'));
      document.head.appendChild(script);
    }).catch(error=>{templateExcelJsLoader=null;throw error});
  }
  return templateExcelJsLoader;
}

/**
 * Single source of truth for a Named Range name and for the text INDIRECT() resolves it from:
 * every non-alphanumeric becomes "_", a leading digit is prefixed with "_", and reserved or
 * cell-like names (A1, R1C1, R, C, TRUE, FALSE) are prefixed so Excel reads them as a name.
 */
function sanitizeName(value){
  let name=String(value??'').replace(/[^A-Za-z0-9]/g,'_');
  if(!name)name='_';
  if(/^[0-9]/.test(name))name=`_${name}`;
  if(/^(?:[A-Za-z]{1,3}[0-9]{1,7}|[Rr][0-9]*[Cc][0-9]*|TRUE|FALSE|[RC])$/i.test(name))name=`_${name}`;
  return name;
}

/**
 * Excel formula text (no leading "=") that reproduces sanitizeName() for the parent cell: one
 * SUBSTITUTE per character the parent values actually contain, plus the same "_" prefix rules.
 */
function sanitizeFormula(cellRef,values){
  const characters=[...new Set(values.flatMap(value=>[...String(value??'')]).filter(character=>!/[A-Za-z0-9]/.test(character)))];
  if(!characters.length)characters.push(' ','-');
  let expression=cellRef;
  for(const character of characters)expression=`SUBSTITUTE(${expression},"${character.replace(/"/g,'""')}","_")`;
  const conditions=[];
  if(values.some(value=>/^[0-9]/.test(String(value??''))))conditions.push(`ISNUMBER(VALUE(LEFT(${cellRef},1)))`);
  for(const value of values){
    const text=String(value??'');
    const plain=text.replace(/[^A-Za-z0-9]/g,'_');
    if(plain&&!/^[0-9]/.test(plain)&&sanitizeName(text)!==plain)conditions.push(`${cellRef}="${text.replace(/"/g,'""')}"`);
  }
  return conditions.length?`IF(OR(${conditions.join(',')}),"_","")&${expression}`:expression;
}

/** 0-based column index -> spreadsheet letter (A, B ... Z, AA). */
function templateColumnLetter(index){
  let letter='',value=index+1;
  while(value>0){const rest=(value-1)%26;letter=String.fromCharCode(65+rest)+letter;value=Math.floor((value-1)/26);}
  return letter;
}

function mergeTemplateListValues(column,values){
  for(const value of values){
    const text=String(value??'');
    if(text&&!column.values.includes(text))column.values.push(text);
  }
}

/**
 * Column-per-list registry of the hidden Lists sheet. The first list added owns column A, so the
 * Categories stay the plain "Lists!$A$2:$A$n" range. A name that is already taken (Excel names
 * ignore case) reuses that column and merges the options instead of duplicating the list.
 */
function templateListBook(){
  const columns=[],byName=new Map();
  return {
    columns,
    add(header,values,name){
      const key=name?String(name).toLowerCase():'';
      const existing=key?byName.get(key):null;
      if(existing){mergeTemplateListValues(existing,values);return existing;}
      const column={header:String(header??''),name:name||'',values:[],index:columns.length};
      mergeTemplateListValues(column,values);
      if(key)byName.set(key,column);
      columns.push(column);
      return column;
    }
  };
}

/** Absolute range of one list column - filled cells only, e.g. "Lists!$B$2:$B$8". */
function templateListRef(column){
  const letter=templateColumnLetter(column.index);
  return `${ASSET_TEMPLATE_LISTS_SHEET}!$${letter}$2:$${letter}$${Math.max(2,column.values.length+1)}`;
}

/** Writes the hidden Lists sheet and registers one Named Range per filled list column. */
function writeTemplateListsSheet(workbook,columns){
  const ws=workbook.addWorksheet(ASSET_TEMPLATE_LISTS_SHEET,{state:'hidden'});
  columns.forEach(column=>{
    const letter=templateColumnLetter(column.index);
    ws.getCell(`${letter}1`).value=column.header;
    column.values.forEach((value,index)=>{ws.getCell(`${letter}${index+2}`).value=value;});
    if(!column.name)return;
    // A list without options still owns one blank cell, so INDIRECT(name) never errors.
    workbook.definedNames.add(`${ASSET_TEMPLATE_LISTS_SHEET}!$${letter}$2:$${letter}$${Math.max(2,column.values.length+1)}`,column.name);
  });
  ws.getColumn(1).width=32;
  columns.forEach((column,index)=>{
    if(index)ws.getColumn(index+1).width=Math.max(18,Math.min(42,column.header.length+6));
  });
  return ws;
}

/** Named Range holding the Category list of one Type, e.g. "Asset_Categories". */
function templateTypeListName(type){
  return sanitizeName(`${type}_Categories`);
}
/**
 * Named Range of one Income list. The "_Income" suffix keeps the user's Major Head / Category
 * names from colliding with an Asset category of the same name (Excel names ignore case).
 */
function templateIncomeListName(...parts){
  return sanitizeName([...parts].filter(Boolean).join('_')+'_Income');
}
/** Column A = Categories, then one column per Category holding its Subcategory options. */
function assetsTemplateListBook(structure){
  const book=templateListBook();
  const categories=[],subsByCategory=new Map();
  for(const type of MIGRATION_TEMPLATE_TYPES.assets){
    for(const category of structure.catsByType.get(type)||[]){
      const key=category.toLowerCase();
      if(!subsByCategory.has(key)){subsByCategory.set(key,{name:category,values:[]});categories.push(category);}
      mergeTemplateListValues(subsByCategory.get(key),structure.subsByKey.get(`${type}||${category}`)||[]);
    }
  }
  const categoryColumn=book.add(TEMPLATE_CATEGORY_HEADER,categories);
  for(const category of categories)book.add(category,subsByCategory.get(category.toLowerCase()).values,sanitizeName(category));
  const fundingColumn=book.add(ASSET_TEMPLATE_FUNDING_HEADER,structure.funding,sanitizeName(ASSET_TEMPLATE_FUNDING_HEADER));
  // One extra list per Type, so Category can follow the Type cell instead of showing every category.
  const typeColumns=new Map();
  for(const type of MIGRATION_TEMPLATE_TYPES.assets){
    const values=[];
    for(const category of structure.catsByType.get(type)||[]){
      const name=normClass(category);
      if(name&&!values.includes(name))values.push(name);
    }
    typeColumns.set(type,book.add(`${type} Categories`,values,templateTypeListName(type)));
  }
  return {book,categories,categoryColumn,fundingColumn,typeColumns};
}

/** Major Heads list, then one column per Major Head (its Categories) and one per Category. */
function incomeTemplateListBook(book,structure){
  const majorColumn=book.add(TEMPLATE_MAJOR_HEADER,structure.majors);
  for(const head of structure.majors)book.add(head,structure.catsByHead.get(head)||[],templateIncomeListName(head));
  for(const [key,values] of structure.subsByKey){
    const [head,category]=key.split('||');
    book.add(category,values,templateIncomeListName(head,category));
  }
  return {majorColumn};
}

function templateListValidation(formulae,title,prompt,error){
  return Object.assign({type:'list',formulae},TEMPLATE_VALIDATION_FLAGS,{errorTitle:title,promptTitle:title,prompt,error:error||'Please pick a value from the dropdown list.'});
}
function templateCustomValidation(formulae,title,prompt,error){
  return Object.assign({type:'custom',formulae},TEMPLATE_VALIDATION_FLAGS,{errorTitle:title,promptTitle:title,prompt,error});
}
/** One validation per row, so the row-relative parent reference inside the formula stays exact. */
function applyTemplateValidationRows(ws,column,firstRow,lastRow,makeValidation){
  for(let row=firstRow;row<=lastRow;row++)ws.getCell(row,column+1).dataValidation=makeValidation(row);
}
/** Same rule for a whole column: one entry, no duplicated (overlapping) ranges in the file. */
function applyTemplateValidationRange(ws,column,firstRow,lastRow,validation){
  const letter=templateColumnLetter(column);
  ws.dataValidations.add(`${letter}${firstRow}:${letter}${lastRow}`,validation);
}
function writeTemplateSheetHeader(ws,title,description,headers){
  ws.getCell('A1').value=title;
  ws.getCell('A1').font={bold:true,size:13};
  ws.getCell('A2').value=description;
  headers.forEach((header,index)=>{
    const cell=ws.getCell(3,index+1);
    cell.value=header;
    cell.font={bold:true};
  });
  ws.views=[{state:'frozen',ySplit:3}];
}
function writeTemplateSheetRows(ws,headers,dataRows){
  (dataRows||[]).forEach((data,index)=>{
    data.forEach((value,column)=>{
      if(column<headers.length)ws.getCell(4+index,column+1).value=value??'';
    });
  });
}
function setTemplateSheetWidths(ws,widths){widths.forEach((width,index)=>{ws.getColumn(index+1).width=width;});}

/** Categories whose Funded from cell must stay blank: Cash and Bank Account variants. */
function assetFundingBlockedCategories(structure){
  const blocked=new Set(TEMPLATE_CASH_CATEGORIES);
  for(const type of MIGRATION_TEMPLATE_TYPES.assets){
    for(const category of structure.catsByType.get(type)||[]){
      if(isCashCategoryName(category))blocked.add(category);
    }
  }
  return [...blocked];
}


/**
 * Assets & Liabilities sheet: Type, Category, Subcategory and Funded from are real dropdowns.
 * Category resolves the Named Range built from the Type cell, Subcategory the one built from the
 * picked Category, and Funded from is a custom rule that only accepts Asset subcategories and
 * rejects Cash & Bank Account rows.
 */
function writeAssetsTemplateSheet(workbook,structure,lists,dataRows=[]){
  const headers=MIGRATION_TEMPLATE_HEADERS.assets;
  const ws=workbook.addWorksheet(MIGRATION_TEMPLATE_SHEETS.assets);
  writeTemplateSheetHeader(ws,`${MIGRATION_TEMPLATE_SHEETS.assets} - Migration Template`,
    'One row per asset or liability. Type filters Category *, Category filters Subcategory, and Funded from Asset Subcategory only accepts Asset subcategories (blank for Cash & Bank Account rows). Lists come from the hidden Lists sheet (Manage Categories); re-importing skips rows that are already imported.',headers);
  setTemplateSheetWidths(ws,[12,14,26,30,40,18,10,12,14,34,28]);
  const total=Math.max(MIGRATION_TEMPLATE_ROWS,(dataRows||[]).length);
  const firstRow=4,lastRow=3+total;
  writeTemplateSheetRows(ws,headers,dataRows);
  const blocked=assetFundingBlockedCategories(structure);
  const types=[...MIGRATION_TEMPLATE_TYPES.assets];
  applyTemplateValidationRange(ws,1,firstRow,lastRow,templateListValidation([`"${types.join(',')}"`],'Type','Pick Asset or Liability - it filters the Category dropdown.'));
  applyTemplateValidationRows(ws,2,firstRow,lastRow,row=>templateListValidation(
    [`INDIRECT((${sanitizeFormula(`$B${row}`,types)})&"_Categories")`],
    TEMPLATE_CATEGORY_HEADER,'Pick a Type first - it filters the Category dropdown.'));
  applyTemplateValidationRows(ws,3,firstRow,lastRow,row=>templateListValidation([`INDIRECT(${sanitizeFormula(`$C${row}`,lists.categories)})`],'Subcategory','The list follows the Category you picked.'));
  applyTemplateValidationRows(ws,10,firstRow,lastRow,row=>templateCustomValidation(
    [`OR($K${row}="",AND(${blocked.map(name=>`$C${row}<>"${name.replace(/"/g,'""')}"`).join(',')},COUNTIF(${templateListRef(lists.fundingColumn)},$K${row})>0))`],
    ASSET_TEMPLATE_FUNDING_HEADER,
    'Leave this cell blank for Cash & Bank Account rows.',
    'Funded from only accepts an Asset subcategory from the list, and stays blank for Cash & Bank Account rows.'));
  return ws;
}

/** Income & Expenses sheet: Major Head -> Category -> Subcategory, each list feeding the next. */
function writeIncomeTemplateSheet(workbook,structure,lists,dataRows=[]){
  const headers=MIGRATION_TEMPLATE_HEADERS.income;
  const ws=workbook.addWorksheet(MIGRATION_TEMPLATE_SHEETS.income);
  writeTemplateSheetHeader(ws,`${MIGRATION_TEMPLATE_SHEETS.income} - Migration Template`,
    'Fill one row per income or expense. Entry Type * is Income/Expense; pick Major Head, then Category *, then Subcategory - each dropdown filters the next one. Re-importing skips rows that are already imported.',headers);
  setTemplateSheetWidths(ws,[12,18,40,30,30,16,22,36,14]);
  const total=Math.max(MIGRATION_TEMPLATE_ROWS,(dataRows||[]).length);
  const firstRow=4,lastRow=3+total;
  writeTemplateSheetRows(ws,headers,dataRows);
  const categoryValues=[...structure.catsByHead.values()].flat();
  applyTemplateValidationRange(ws,1,firstRow,lastRow,templateListValidation(['"Income,Expense"'],'Entry Type','Pick Income or Expense.'));
  applyTemplateValidationRange(ws,2,firstRow,lastRow,templateListValidation([templateListRef(lists.majorColumn)],TEMPLATE_MAJOR_HEADER,'Pick a Major Head - it filters the Category dropdown.'));
  applyTemplateValidationRows(ws,3,firstRow,lastRow,row=>templateListValidation([`INDIRECT((${sanitizeFormula(`$C${row}`,structure.majors)})&"_Income")`],'Category','The list follows the Major Head you picked.'));
  applyTemplateValidationRows(ws,4,firstRow,lastRow,row=>templateListValidation([
    `INDIRECT((${sanitizeFormula(`$C${row}`,structure.majors)})&"_"&(${sanitizeFormula(`$D${row}`,categoryValues)})&"_Income")`
  ],'Subcategory','The list follows the Category you picked.'));
  return ws;
}

/** Whole downloadable workbook: the two entry sheets first, then the hidden Lists sheet behind them. */
function buildMigrationTemplateWorkbook(ExcelJSEngine){
  const workbook=new ExcelJSEngine.Workbook();
  workbook.creator='Personal Finance';
  const assets=assetsTemplateStructure();
  const income=incomeTemplateStructure();
  if(!income.majors.length){income.majors.push('Other Income');income.catsByHead.set('Other Income',[])}
  const assetLists=assetsTemplateListBook(assets);
  const incomeLists=incomeTemplateListBook(assetLists.book,income);
  writeAssetsTemplateSheet(workbook,assets,assetLists);
  writeIncomeTemplateSheet(workbook,income,incomeLists);
  // Added last so the active tab is a visible sheet; Excel unhides a hidden sheet that owns activeTab 0.
  writeTemplateListsSheet(workbook,assetLists.book.columns);
  workbook.views=[{x:0,y:0,width:10000,height:20000,firstSheet:0,activeTab:0,visibility:'visible'}];
  return workbook;
}

function migrationTemplateHeader(aoa){
  for(let i=0;i<Math.min(aoa.length,8);i++){
    const cells=(aoa[i]||[]).map(c=>nrm(String(c??'')).replace(/\*/g,' ').replace(/\s+/g,' ').trim());
    const typeAt=cells.findIndex(c=>c==='type'||c==='entry type');
    const categoryAt=cells.findIndex(c=>c==='category');
    if(typeAt<0||categoryAt<0)continue;
    const dateAt=cells.findIndex(c=>c==='date');
    const amountAt=cells.findIndex(c=>/^(amount|balance)\b/.test(c));
    if(dateAt<0||amountAt<0)continue;
    return {headerRow:i,cells,typeAt,categoryAt,dateAt,amountAt};
  }
  return null;
}
function migrationTemplateSheetName(workbook,kind){
  const wanted=nrm(MIGRATION_TEMPLATE_SHEETS[kind]);
  return workbook.SheetNames.find(name=>nrm(name)===wanted)||'';
}
function isMigrationTemplateWorkbook(workbook){
  return ['assets','income'].some(kind=>{
    const name=migrationTemplateSheetName(workbook,kind);
    if(!name)return false;
    const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:true});
    return !!migrationTemplateHeader(aoa);
  });
}

/**
 * The sheet only carries the funding subcategory, so its Asset category is resolved from the same
 * Manage Categories tree the Add Record form uses. A value that no longer matches is ignored.
 */
function assetFundingFromSheet(value){
  const subcategory=normClass(value);
  if(!subcategory)return null;
  const wanted=subcategory.toLowerCase();
  for(const category of orderedCategories('Asset')){
    const match=(category.subcategories||[]).map(sub=>normClass(sub)).find(sub=>sub.toLowerCase()===wanted);
    if(match)return {category:normClass(category.name),subcategory:match};
  }
  return null;
}

/**
 * Imports the flat migration template / export (one Assets & Liabilities sheet and one
 * Income & Expenses sheet). A row-signature hash is stored on every imported row, so the
 * same file - or an exported workbook - can be re-imported without creating duplicates.
 * @param {{noAccountChange?:boolean}} [options] "I Do not want to change Account".
 */
async function importMigrationTemplateWorkbook(workbook,replaceId,fileName,options={}){
  const keepAccounts=!!options.noAccountChange;
  const target=replaceId?state.migrationHistory.find(m=>m.id===replaceId):null;
  const replacing=!!target;
  const migrationId=replacing?target.id:uid('mig');
  const seen=new Set(replacing?[]:[...state.records,...state.incomeExpenses].map(r=>r.importHash).filter(Boolean));
  const priorIncome=new Map(),priorAssets=new Map();
  if(!replacing){
    state.incomeExpenses.forEach(r=>{if(r.importHash)priorIncome.set(r.importHash,r)});
    state.records.forEach(r=>{if(r.importHash)priorAssets.set(r.importHash,r)});
  }
  const reflagged=[],reflaggedAssets=[];
  const recordRows=[],incomeRows=[],newCategories=[],years=new Set();
  let duplicates=0,invalid=0;
  for(const kind of ['assets','income']){
    const sheetName=migrationTemplateSheetName(workbook,kind);
    if(!sheetName)continue;
    const aoa=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true});
    if(aoa.length>MAX_IMPORT_ROWS)aoa.length=MAX_IMPORT_ROWS;
    const header=migrationTemplateHeader(aoa);
    if(!header)continue;
    const col=aliases=>{for(const alias of aliases){const index=header.cells.indexOf(alias);if(index>=0)return index}return -1};
    const cols={
      majorHead:col(['major head']),
      subcategory:col(['subcategory']),
      particulars:col(['particulars','particular','details','description']),
      account:col(['account','account / method','account method','account/method','method']),
      description:col(['description','notes','details']),
      currency:col(['currency']),
      status:col(['status']),
      incomeYear:col(['income year']),
      funding:col(['funded from asset subcategory','funded from subcategory','funded from','funding source','funding'])
    };
    const cell=(row,index)=>index>=0&&index<row.length?row[index]:'';
    for(let r=header.headerRow+1;r<aoa.length;r++){
      const row=aoa[r]||[];
      if(![header.dateAt,header.typeAt,header.categoryAt,header.amountAt,cols.majorHead,cols.subcategory,cols.particulars,cols.description,cols.account].map(index=>String(cell(row,index)??'').trim()).some(Boolean))continue;
      const typeRaw=nrm(String(cell(row,header.typeAt)??''));
      const kindType=kind==='assets'
        ?(typeRaw==='asset'?'Asset':typeRaw==='liability'?'Liability':'')
        :(typeRaw==='income'?'Income':typeRaw==='expense'?'Expense':'');
      const category=normClass(cell(row,header.categoryAt));
      const amount=Math.abs(parseExcelNumber(cell(row,header.amountAt)));
      const date=normalizeExcelDate(cell(row,header.dateAt));
      const subcategory=normClass(cell(row,cols.subcategory));
      const particulars=normClass(cell(row,cols.particulars));
      if(!kindType||!category||!amount){invalid++;continue}
      const description=normClass(cell(row,cols.description));
      const hash=hashString([kind,kindType,date,category,subcategory,kind==='assets'?particulars:description,amount.toFixed(2)].join('|'));
      if(seen.has(hash)){
        duplicates++;
        if(keepAccounts){
          if(kind==='income'){
            const prior=priorIncome.get(hash);
            if(prior&&!prior.noAccountChange){prior.noAccountChange=true;prior.updatedAt=new Date().toISOString();reflagged.push(prior)}
          }else{
            const prior=priorAssets.get(hash);
            if(prior&&prior.funding&&!prior.noAccountChange){prior.noAccountChange=true;prior.updatedAt=new Date().toISOString();reflaggedAssets.push(prior)}
          }
        }
        continue;
      }
      seen.add(hash);
      if(kind==='assets'){
        const record={
          id:uid('record'),type:kindType,category,subcategory:subcategory||category,
          particulars:particulars||category,date,details:description,
          currency:normClass(cell(row,cols.currency)).toUpperCase(),
          status:normClass(cell(row,cols.status))||'Active',
          amount,balance:amount,
          incomeYear:normClass(cell(row,cols.incomeYear))||fiscalYearFromDate(date),
          documentIds:[],sourceSheet:sheetName,sourceRow:r+1,importHash:hash,migrationId,
          updatedAt:new Date().toISOString()
        };
        // Optional "Funded from Asset Subcategory" column; templates without it simply skip this.
        const funding=assetFundingFromSheet(cell(row,cols.funding));
        if(funding&&!(kindType==='Asset'&&isCashCategoryName(category))){
          record.funding=funding;
          if(keepAccounts)record.noAccountChange=true;        // funding source kept for reference, balance untouched
        }
        recordRows.push(record);
        if(record.incomeYear)years.add(record.incomeYear);
        let definition=newCategories.find(c=>c.type===kindType&&c.name===category)||state.categories.find(c=>c.type===kindType&&c.name===category);
        if(!definition){definition={id:uid('category'),type:kindType,name:category,subcategories:[]};newCategories.push(definition)}
        if(!Array.isArray(definition.subcategories))definition.subcategories=[];
        if(record.subcategory&&!definition.subcategories.includes(record.subcategory))definition.subcategories.push(record.subcategory);
      }else{
        const cls=ensureIncomeClass(kindType,normClass(cell(row,cols.majorHead)),category,subcategory);
        const record={
          id:uid('ie'),type:kindType,date,
          incomeYear:normClass(cell(row,cols.incomeYear))||fiscalYearFromDate(date),
          majorHead:cls.majorHead,category:cls.category,subcategory:cls.subcategory,
          amount,account:normClass(cell(row,cols.account))||'Other',description,
          documentIds:[],sourceSheet:sheetName,sourceRow:r+1,importHash:hash,migrationId,
          createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
        };
        if(keepAccounts)record.noAccountChange=true;
        incomeRows.push(record);
        if(record.incomeYear)years.add(record.incomeYear);
      }
    }
  }
  if(replaceId&&!recordRows.length&&!incomeRows.length){toast('The replacement file produced no valid rows — the existing batch was left unchanged.',true);return}
  if(newCategories.length)await putMany('categories',newCategories);
  if(replaceId)await removeMigrationRows(migrationId);
  const pdfAttached=await attachMigrationPdf([...recordRows,...incomeRows],options.pdfFile);
  if(recordRows.length)await putMany('records',recordRows);
  if(incomeRows.length)await putMany('incomeExpenses',incomeRows);
  if(incomeRows.length)await putMany('incomeGroups',state.incomeGroups);
  if(reflagged.length)await putMany('incomeExpenses',reflagged);
  if(reflaggedAssets.length)await putMany('records',reflaggedAssets);
  if(years.size){
    const list=[...new Set([...(state.settings.incomeYears||[]),...years])].sort((a,b)=>String(b).localeCompare(String(a)));
    state.settings.incomeYears=list;
    await put('settings',{key:'incomeYears',value:list});
  }
  const imported=recordRows.length+incomeRows.length;
  if(!imported&&(reflagged.length||reflaggedAssets.length)){
    await loadState();renderAll();
    toast(`These rows are already imported. ${reflagged.length+reflaggedAssets.length} earlier row(s) no longer change Cash & Bank.`);
    return 0;
  }
  if(!imported){toast(duplicates?'These rows are already imported — nothing new to add.':'No importable rows were found in that file.',!duplicates);return 0}
  await saveMigrationMeta(migrationId,replacing?target.id:null,'Excel & Budge CSV',fileName,imported,duplicates+invalid);
  await loadState();renderAll();
  const bits=[`${recordRows.length} asset/liability row${recordRows.length===1?'':'s'}`,`${incomeRows.length} income/expense row${incomeRows.length===1?'':'s'}`];
  if(duplicates)bits.push(`${duplicates} duplicate${duplicates===1?'':'s'} skipped`);
  if(invalid)bits.push(`${invalid} incomplete row${invalid===1?'':'s'} skipped`);
  const reflaggedAll=reflagged.length+reflaggedAssets.length;
  if(reflaggedAll)bits.push(`${reflaggedAll} earlier row${reflaggedAll===1?'':'s'} set to leave Cash & Bank unchanged`);
  if(keepAccounts)bits.push('Cash & Bank left unchanged');
  if(pdfAttached)bits.push(`PDF attached to ${pdfAttached} row${pdfAttached===1?'':'s'}`);
  toast(`Import complete: ${bits.join(', ')}.`);
  return pdfAttached;
}

/* --- Import Workbook / CSV popup (Settings migration card) --- */
const EXCEL_IMPORT_HINT_UNCHECKED='Unticked: rows linked to a Cash & Bank account also move that balance.';
const EXCEL_IMPORT_HINT_CHECKED='Ticked: rows are recorded in this ledger only — no Cash & Bank balance changes (rows of this file imported earlier are updated too). This includes "Funded from Asset Subcategory".';
let excelImportDraft=null;

function setExcelImportFileLabel(file){
  const label=$el('excelImportFileName');
  const clear=$el('excelImportClear');
  const confirm=$el('excelImportConfirm');
  if(label){
    if(file){
      label.textContent=`${file.name} · ${formatFileSize(file.size)}`;
      label.title=file.name;
      label.classList.add('has-file');
    }else{
      label.textContent='No file chosen';
      label.removeAttribute('title');
      label.classList.remove('has-file');
    }
  }
  if(clear)clear.classList.toggle('hidden',!file);
  if(confirm)confirm.disabled=!file;
}
function updateExcelImportAccountHint(){
  const box=$el('excelImportNoAccount');
  const hint=$el('excelImportAccountHint');
  if(hint)hint.textContent=box&&box.checked?EXCEL_IMPORT_HINT_CHECKED:EXCEL_IMPORT_HINT_UNCHECKED;
}
function resetExcelImportDraft(){
  excelImportDraft=null;
  const input=$el('excelImport');
  if(input)input.value='';
  const box=$el('excelImportNoAccount');
  if(box)box.checked=false;
  updateExcelImportAccountHint();
  setExcelImportFileLabel(null);
}
function openExcelImportModal(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const input=$el('excelImport');
  if(input)input.value='';
  excelImportDraft=null;
  const box=$el('excelImportNoAccount');
  if(box)box.checked=false;
  updateExcelImportAccountHint();
  setExcelImportFileLabel(null);
  $el('excelImportModal').showModal();
}
function excelImportFileChosen(event){
  const input=event.target;
  const file=input.files&&input.files[0];
  input.value='';
  if(!file)return;
  excelImportDraft={file};
  setExcelImportFileLabel(file);
}
function clearExcelImportFile(){
  excelImportDraft=null;
  setExcelImportFileLabel(null);
}
async function confirmExcelImport(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const draft=excelImportDraft;
  if(!draft||!draft.file){toast('Choose an .xlsx, .xls or .csv file first.',true);return}
  if(draft.file.size>MAX_IMPORT_BYTES){toast('That file is larger than 30 MB. Split it and import the parts.',true);return}
  const noAccountChange=!!($el('excelImportNoAccount')&&$el('excelImportNoAccount').checked);
  const file=draft.file;
  const pdfFile=migrationPdfDraft;
  const button=$el('excelImportConfirm');
  if(button){button.disabled=true;button.classList.add('loading')}
  try{
    $el('excelImportModal').close();
    const pdfAttached=await runImport(file,null,{noAccountChange,pdfFile});
    if(pdfFile&&pdfAttached>0)clearMigrationPdf();
  }finally{
    if(button){
      button.classList.remove('loading');
      button.disabled=!(excelImportDraft&&excelImportDraft.file);
    }
  }
}

/** Downloadable .xlsx template: Type / Category / Subcategory / Funded from are real dependent dropdowns. */
async function downloadMigrationTemplate(){
  let ExcelJS;
  try{
    ExcelJS=await loadTemplateExcelJS();
  }catch(error){
    toast('The dropdown template needs the ExcelJS library. Check your internet connection and try again.',true);
    return;
  }
  try{
    const workbook=buildMigrationTemplateWorkbook(ExcelJS);
    const bytes=await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`Finance-Migration-Template-${todayISO()}.xlsx`);
    toast('Template downloaded — Type → Category → Subcategory and Funded from Asset Subcategory are dependent dropdowns');
  }catch(error){
    console.warn('Migration template could not be built',error);
    toast('The template could not be built. Please try again.',true);
  }
}

/** Export in the exact template layout, so the workbook can be re-imported without duplicates. */
function exportMigrationWorkbook(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const records=(state.records||[]).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  const income=(state.incomeExpenses||[]).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  if(!records.length&&!income.length){toast('There is nothing to export yet.',true);return}
  const assetRows=records.map(r=>[r.date||'',r.type||'',r.category||'',r.subcategory||'',r.particulars||r.name||'',recordAmount(r),r.currency||'',r.status||'Active',r.incomeYear||'',r.details||r.description||'',r.funding?.subcategory||'']);
  const incomeRows=income.map(r=>[r.date||'',r.type||'',r.majorHead||'',r.category||'',r.subcategory||'',Number(r.amount)||0,r.account||'',r.description||'',r.incomeYear||'']);
  const workbook=XLSX.utils.book_new();
  const assets=migrationTemplateSheet('assets',assetRows);
  const incomes=migrationTemplateSheet('income',incomeRows);
  XLSX.utils.book_append_sheet(workbook,assets.ws,assets.spec.name);
  XLSX.utils.book_append_sheet(workbook,incomes.ws,incomes.spec.name);
  XLSX.writeFile(workbook,`Finance-Migration-Workbook-${todayISO()}.xlsx`);
  toast(`Exported ${records.length} asset/liability and ${income.length} income/expense row(s)`);
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
  const officeIds=(state.officePurchases||[]).filter(r=>r.migrationId===migrationId).map(r=>r.id);
  const docIds=new Set();
  for(const r of state.records)if(r.migrationId===migrationId)(r.documentIds||[]).forEach(d=>docIds.add(d));
  for(const r of state.incomeExpenses)if(r.migrationId===migrationId)(r.documentIds||[]).forEach(d=>docIds.add(d));
  for(const r of state.officePurchases||[])if(r.migrationId===migrationId)(r.documentIds||[]).forEach(d=>docIds.add(d));
  for(const d of state.documents)if(recordIds.includes(d.recordId)||ieIds.includes(d.recordId)||officeIds.includes(d.recordId))docIds.add(d.id);
  if(recordIds.length)await removeMany('records',recordIds);
  if(ieIds.length)await removeMany('incomeExpenses',ieIds);
  if(officeIds.length)await removeMany('officePurchases',officeIds);
  if(docIds.size){await removeMany('documents',[...docIds]);await removeMany('documentBlobs',[...docIds])}
}
function renderMigrationHistory(){
  const host=document.getElementById('migrationHistoryList');
  if(!host)return;
  const history=state.migrationHistory.filter(m=>m.migrationType!==IT_MIGRATION_TYPE).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
  host.innerHTML=history.length
    ? `<div class="table-wrap migration-history-wrap"><table class="migration-history-table"><thead><tr><th scope="col">Date &amp; Time</th><th scope="col">File Name</th><th scope="col">Migration Type</th><th scope="col" class="num">Records Imported</th><th scope="col">Actions</th></tr></thead><tbody>${history.map(m=>`<tr><td>${esc(new Date(m.timestamp).toLocaleString())}</td><td>${esc(m.fileName||'—')}</td><td><span class="badge migration-badge">${esc(m.migrationType||'—')}</span></td><td class="num">${Number(m.importedCount)||0}</td><td class="actions-cell"><button type="button" class="action-link" data-cmd="edit-migration" data-id="${esc(m.id)}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-migration" data-id="${esc(m.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state">No migrations recorded in this browser yet.</div>';
}
function migrationRowSummary(r,store){
  if(store==='officePurchases')return {date:r.date,type:r.type,category:r.category,subcategory:r.account||r.particulars||'',amount:Number(r.amount)||0};
  return store==='records'
    ? {date:r.date,type:r.type,category:r.category,subcategory:r.subcategory,amount:recordAmount(r)}
    : {date:r.date,type:r.type,category:r.category,subcategory:r.subcategory,amount:Number(r.amount)||0};
}
function renderMigrationEditor(id){
  const mig=state.migrationHistory.find(m=>m.id===id);
  if(!mig)return;
  const recRows=state.records.filter(r=>r.migrationId===id).map(r=>({r,store:'records'}));
  const ieRows=state.incomeExpenses.filter(r=>r.migrationId===id).map(r=>({r,store:'incomeExpenses'}));
  const officeRows=(state.officePurchases||[]).filter(r=>r.migrationId===id).map(r=>({r,store:'officePurchases'}));
  const rows=[...recRows,...ieRows,...officeRows];
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
  }else if(store==='officePurchases'){
    const r=(state.officePurchases||[]).find(x=>x.id===id);
    docIds=[...(r?.documentIds||[]),...state.documents.filter(d=>d.recordId===id).map(d=>d.id)];
    await remove('officePurchases',id);
  }else{
    const r=state.records.find(x=>x.id===id);
    docIds=[...(r?.documentIds||[]),...state.documents.filter(d=>d.recordId===id).map(d=>d.id)];
    await remove('records',id);
  }
  for(const did of new Set(docIds)){await remove('documents',did);await remove('documentBlobs',did)}
  await loadState();
  const mig=state.migrationHistory.find(m=>m.id===migId);
  if(mig){
    mig.importedCount=state.records.filter(r=>r.migrationId===migId).length+state.incomeExpenses.filter(r=>r.migrationId===migId).length+(state.officePurchases||[]).filter(r=>r.migrationId===migId).length;
    await put('migrationHistory',mig);
    renderMigrationEditor(migId);
  }
  renderAll();toast('Row removed from migration batch');
}
async function deleteMigration(id){
  const mig=state.migrationHistory.find(m=>m.id===id);
  if(!mig)return;
  const count=state.records.filter(r=>r.migrationId===id).length+state.incomeExpenses.filter(r=>r.migrationId===id).length+(state.officePurchases||[]).filter(r=>r.migrationId===id).length;
  if(!(await confirm(`Delete migration "${mig.fileName}" and the ${count} record(s) it imported? This cannot be undone.`,'Delete Migration')))return;
  await removeMigrationRows(id);
  await remove('migrationHistory',id);
  await loadState();renderAll();
  toast(`Migration deleted (${count} record(s) removed)`);
}

/* ==========================================================================
   Google Drive sync (Google Identity Services token client + Drive v3 REST)
   - Backups live in the "PersonalFinance_Backups" folder as
     assetbook-backup-YYYY-MM-DDTHH-mm-ss.json; only the latest 15 are kept.
   - A snapshot is the full AssetBookDB: the protected settingsStore (category
     tree), userCustomizedCategories, records, income/expense, office entries,
     settings, document metadata and every stored PDF (base64 encoded).
   - Auto-backup is debounced after local mutations. Auto-restore at launch is
     guarded by isRestoring and only fills an EMPTY database, so launching never
     overwrites data that already exists on this device.
   ========================================================================== */
const GOOGLE_DRIVE_CLIENT_ID=SITE.clientId;
const GOOGLE_DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
const GOOGLE_DRIVE_FOLDER=SITE.driveFolder;
const GOOGLE_DRIVE_BACKUP_LIMIT=15;
const GOOGLE_DRIVE_KEEP_DAILY=7;     // plus the newest backup of each of the last 7 older days
const GOOGLE_DRIVE_KEEP_WEEKLY=4;    // plus the newest backup of each of the last 4 older weeks
const GOOGLE_DRIVE_KEEP_SAFETY=5;    // pre-restore safety copies (assetbook-keep-*.json)
const GOOGLE_DRIVE_API='https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD='https://www.googleapis.com/upload/drive/v3';
const GOOGLE_DRIVE_AUTO_BACKUP_DELAY=5000;
const GOOGLE_DRIVE_AUTO_SYNC_INTERVAL=30000;
const GOOGLE_DRIVE_RESUME_CHECK_INTERVAL=60000;
const GOOGLE_DRIVE_FOLDER_KEY=SITE.prefix+'-drive-folder-id';
let appReady=false;
let isRestoring=false;
let googleDriveTokenClientInstance=null;
let googleDriveAccessToken='';
let googleDriveTokenExpiry=0;
let googleDriveFolderId='';
let googleDriveBusy=false;
let googleDriveBackupTimer=null;
let googleDriveStatus='';
let googleDriveDirty=false;
let googleDriveChangeVersion=0;
let googleDriveLastAutoSyncAt=0;
let googleDriveAutoSyncPromise=null;

function driveSyncEnabled(){return !!(state.settings&&state.settings.driveSyncEnabled)}
function driveConnected(){return !!(googleDriveAccessToken&&Date.now()<googleDriveTokenExpiry-60000)}

/** Compact status block: Connect / Disconnect / Sync Now + Last Synced. */
function renderDriveSyncCard(){
  const connect=document.getElementById('driveConnectBtn');
  const disconnect=document.getElementById('driveDisconnectBtn');
  const sync=document.getElementById('driveSyncBtn');
  const driveRestore=document.getElementById('driveRestoreBtn');
  const status=document.getElementById('driveSyncStatus');
  const last=document.getElementById('driveLastSynced');
  if(!connect&&!status)return;
  const enabled=driveSyncEnabled();
  const connected=driveConnected();
  if(connect)connect.classList.toggle('hidden',enabled);
  if(disconnect)disconnect.classList.toggle('hidden',!enabled);
  if(sync)sync.classList.toggle('hidden',!enabled);
  if(driveRestore)driveRestore.classList.toggle('hidden',!enabled);
  if(status){
    status.textContent=!enabled
      ?'Not connected — connect Google Drive to enable automatic backups.'
      :googleDriveStatus||(connected?'Connected to Google Drive.':'Sign-in expired — click Sync Now to renew access.');
  }
  if(last){
    const stamp=state.settings&&state.settings.driveLastSyncedAt;
    last.textContent=`Last synced: ${stamp?new Date(stamp).toLocaleString():'never'}`;
  }
}
function setDriveStatus(text){
  googleDriveStatus=text||'';
  renderDriveSyncCard();
}

/** The GIS script loads async/defer, so start-up may run before window.google exists. */
function waitForGoogleIdentity(timeout=6000){
  if(window.google&&google.accounts&&google.accounts.oauth2)return Promise.resolve(true);
  return new Promise(resolve=>{
    const started=Date.now();
    const tick=()=>{
      if(window.google&&google.accounts&&google.accounts.oauth2)return resolve(true);
      if(Date.now()-started>=timeout)return resolve(false);
      setTimeout(tick,200);
    };
    setTimeout(tick,200);
  });
}

/** Google Identity Services token client (created lazily; the script loads async). */
let googleDriveTokenHandler=null;
function driveTokenClient(){
  if(/PASTE_YOUR_NEW_CLIENT_ID/.test(GOOGLE_DRIVE_CLIENT_ID))throw new Error('Set main.clientId in SITE_PROFILES (top of app.js) to your Google Cloud Client ID first.');
  if(!(window.google&&google.accounts&&google.accounts.oauth2))return null;
  if(!googleDriveTokenClientInstance){
    googleDriveTokenClientInstance=google.accounts.oauth2.initTokenClient({
      client_id:GOOGLE_DRIVE_CLIENT_ID,
      scope:GOOGLE_DRIVE_SCOPE,
      callback:response=>{const handler=googleDriveTokenHandler;if(handler)handler(response,null)},
      error_callback:error=>{const handler=googleDriveTokenHandler;if(handler)handler(null,error)}
    });
  }
  return googleDriveTokenClientInstance;
}
/** Interactive = consent / account picker; silent = attempt without UI. */
function requestDriveToken(interactive){
  const client=driveTokenClient();
  if(!client)return Promise.reject(new Error('Google sign-in is still loading. Check your connection and try again.'));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,token)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      googleDriveTokenHandler=null;
      if(token)resolve(token);
      else reject(error||new Error('Google sign-in was cancelled.'));
    };
    const timer=setTimeout(()=>finish(new Error('Google sign-in timed out.')),interactive?120000:6000);
    googleDriveTokenHandler=(response,error)=>{
      if(error)return finish(new Error(error.message||error.type||'Google sign-in was cancelled.'));
      if(response&&response.access_token)return finish(null,response.access_token);
      finish(new Error((response&&(response.error_description||response.error))||'Google sign-in was cancelled.'));
    };
    try{
      client.requestAccessToken({prompt:interactive?'select_account':'none'});
    }catch(error){
      finish(error);
    }
  });
}
async function ensureDriveToken(interactive=false){
  if(driveConnected())return googleDriveAccessToken;
  const token=await requestDriveToken(!!interactive);
  googleDriveAccessToken=token;
  googleDriveTokenExpiry=Date.now()+3500*1000;      // GIS tokens last ~1 hour; re-checked by driveConnected()
  googleDriveStatus='Connected to Google Drive.';
  renderDriveSyncCard();
  return token;
}


/* --- Drive v3 REST helpers (drive.file: only files this app creates are visible) --- */
async function googleDriveError(response){
  let detail='';
  try{const text=await response.text();detail=text?` ${text.slice(0,200)}`:''}catch(error){}
  if(response.status===401)return new Error('Google Drive authorisation expired. Click Sync Now to sign in again.');
  if(response.status===403)return new Error(`Google Drive refused the request (permission or quota).${detail}`);
  if(response.status===404)return new Error('The Google Drive backup could not be found.');
  return new Error(`Google Drive request failed (${response.status}).${detail}`);
}
async function googleDriveFetch(url,init={},interactive=false){
  const token=await ensureDriveToken(!!interactive);
  const send=authToken=>fetch(url,Object.assign({},init,{headers:Object.assign({},init.headers||{},{Authorization:`Bearer ${authToken}`})}));
  const response=await send(token);
  if(response.status!==401)return response;
  googleDriveAccessToken='';
  googleDriveTokenExpiry=0;
  return send(await ensureDriveToken(!!interactive));
}
async function googleDriveJson(url,init={},interactive=false){
  const response=await googleDriveFetch(url,init,interactive);
  if(!response.ok)throw await googleDriveError(response);
  return response.json();
}
function rememberDriveFolder(id){
  googleDriveFolderId=id;
  try{localStorage.setItem(GOOGLE_DRIVE_FOLDER_KEY,id)}catch(error){}
}
async function googleDriveFolder(interactive=false){
  if(googleDriveFolderId)return googleDriveFolderId;
  try{googleDriveFolderId=localStorage.getItem(GOOGLE_DRIVE_FOLDER_KEY)||''}catch(error){}
  if(googleDriveFolderId)return googleDriveFolderId;
  const query=encodeURIComponent(`name='${GOOGLE_DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found=await googleDriveJson(`${GOOGLE_DRIVE_API}/files?q=${query}&spaces=drive&pageSize=10&fields=files(id,name)`,{},interactive);
  const folder=(found.files||[])[0];
  if(folder){rememberDriveFolder(folder.id);return folder.id}
  const created=await googleDriveJson(`${GOOGLE_DRIVE_API}/files?fields=id`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:GOOGLE_DRIVE_FOLDER,mimeType:'application/vnd.google-apps.folder'})
  },interactive);
  rememberDriveFolder(created.id);
  return created.id;
}
async function googleDriveListMatching(pattern,interactive=false){
  const folderId=await googleDriveFolder(interactive);
  const query=encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType='application/json'`);
  const data=await googleDriveJson(`${GOOGLE_DRIVE_API}/files?q=${query}&orderBy=createdTime desc&pageSize=100&fields=files(id,name,createdTime,size)`,{},interactive);
  return (data.files||[]).filter(file=>pattern.test(file.name||''));
}
/** Regular auto/manual backups, newest first. */
function googleDriveList(interactive=false){return googleDriveListMatching(/^assetbook-backup-.*\.json$/i,interactive)}
/** Pre-restore safety copies, newest first. Never used by auto-restore. */
function googleDriveSafetyList(interactive=false){return googleDriveListMatching(/^assetbook-keep-.*\.json$/i,interactive)}
async function googleDriveDelete(file,interactive=false){
  const response=await googleDriveFetch(`${GOOGLE_DRIVE_API}/files/${encodeURIComponent(file.id)}`,{method:'DELETE'},interactive);
  if(!response.ok&&response.status!==404)throw await googleDriveError(response);
}
/**
 * Smart retention (files are newest first). Keeps:
 *   - the newest GOOGLE_DRIVE_BACKUP_LIMIT (15) backups,
 *   - the newest backup of each of the last 7 OLDER days,
 *   - the newest backup of each of the last 4 OLDER weeks.
 * Returns the files that may be deleted. A burst of edits can therefore never push yesterday's
 * or last week's good copy out of Drive.
 */
function googleDriveRetentionPlan(files){
  const list=files||[];
  const recent=list.slice(0,GOOGLE_DRIVE_BACKUP_LIMIT);
  const older=list.slice(GOOGLE_DRIVE_BACKUP_LIMIT);
  const keep=new Set(recent.map(file=>file.id));
  const dayKey=file=>String(file.createdTime||'').slice(0,10);
  const weekKey=file=>{
    const date=new Date(file.createdTime);
    if(isNaN(date))return '';
    const days=Math.floor(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())/86400000);
    return String(Math.floor((days+3)/7));              // weeks start on Monday
  };
  const seenDays=new Set(recent.map(dayKey));
  const seenWeeks=new Set(recent.map(weekKey));
  let dailyKept=0;
  for(const file of older){
    if(dailyKept>=GOOGLE_DRIVE_KEEP_DAILY)break;
    const day=dayKey(file);
    if(!day||seenDays.has(day))continue;
    seenDays.add(day);seenWeeks.add(weekKey(file));keep.add(file.id);dailyKept++;
  }
  let weeklyKept=0;
  for(const file of older){
    if(weeklyKept>=GOOGLE_DRIVE_KEEP_WEEKLY)break;
    if(keep.has(file.id))continue;
    const week=weekKey(file);
    if(!week||seenWeeks.has(week))continue;
    seenWeeks.add(week);keep.add(file.id);weeklyKept++;
  }
  return list.filter(file=>!keep.has(file.id));
}
async function googleDrivePrune(files,interactive=false){
  const extras=googleDriveRetentionPlan(files);
  for(const file of extras)await googleDriveDelete(file,interactive);
  return extras.length;
}
/** Keeps only the newest GOOGLE_DRIVE_KEEP_SAFETY safety copies. */
async function googleDrivePruneSafety(interactive=false){
  const extras=(await googleDriveSafetyList(interactive)).slice(GOOGLE_DRIVE_KEEP_SAFETY);
  for(const file of extras)await googleDriveDelete(file,interactive);
  return extras.length;
}
async function googleDriveUpload(snapshot,fileName,interactive=true){
  const pdfsUploaded=await ensureSnapshotPdfsInDrive(snapshot,interactive);   // PDFs first, so a backup never points at a PDF Drive lacks
  const folderId=await googleDriveFolder(interactive);
  const json=JSON.stringify(snapshot);
  const form=new FormData();
  form.append('metadata',new Blob([JSON.stringify({name:fileName,mimeType:'application/json',parents:[folderId]})],{type:'application/json'}));
  form.append('file',new Blob([json],{type:'application/json'}),fileName);
  const data=await googleDriveJson(`${GOOGLE_DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,size`,{method:'POST',body:form},interactive);
  return {file:data,size:new Blob([json]).size,pdfsUploaded};
}
async function googleDriveDownload(fileId,interactive=true){
  const response=await googleDriveFetch(`${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,{},interactive);
  if(!response.ok)throw await googleDriveError(response);
  return response.json();
}
/** assetbook-backup-YYYY-MM-DDTHH-mm-ss.json */
function googleDriveBackupName(date=new Date()){
  return `assetbook-backup-${date.toISOString().slice(0,19).replace(/:/g,'-')}.json`;
}

/* --- Snapshot / restore of the complete AssetBookDB --- */
function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const result=String(reader.result||'');
      const comma=result.indexOf(',');
      resolve(comma>=0?result.slice(comma+1):result);
    };
    reader.onerror=()=>reject(reader.error||new Error('A stored PDF could not be read.'));
    reader.readAsDataURL(blob);
  });
}
function base64ToBlob(data,type){
  const binary=atob(data||'');
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:type||'application/pdf'});
}
/* --- Drive PDF storage -------------------------------------------------------------------------
   PDF attachments are NOT embedded in the backup JSON. Each distinct PDF is stored once in a sub-folder
   of the Drive backup folder, named after the page it belongs to:
       <backup folder> / Assets & Liabilities | Income & Expenses | Official Account | Income Tax Calculation
   The file keeps its readable name; its SHA-256 is kept in the file's appProperties. The backup JSON only
   lists the PDFs (pdfIndex: id, name, folder, sha256), so a sync uploads a few hundred KB of data, identical
   PDFs are stored once per folder, and a PDF is uploaded / downloaded only when it is missing.
   Backups made by older versions (PDF bytes inside the JSON) are still restored. */
const DRIVE_FP_VERSION=3;
const DRIVE_PDF_FOLDERS={record:'Assets & Liabilities',ie:'Income & Expenses',office:'Official Account',adv:'Official Account',tax:'Income Tax Calculation'};
/** Page folder for a document, from the record it is attached to (documents.recordId = "<kind>-<uuid>"). */
function drivePdfFolderName(doc){
  const kind=String(doc&&doc.recordId||'').split('-')[0];
  if(DRIVE_PDF_FOLDERS[kind])return DRIVE_PDF_FOLDERS[kind];
  const type=String(doc&&doc.financialType||'');
  if(type==='Income'||type==='Expense')return 'Income & Expenses';
  if(type==='Asset'||type==='Liability')return 'Assets & Liabilities';
  if(type==='Advance')return 'Official Account';
  if(type==='Tax Deduction')return 'Income Tax Calculation';
  return 'Other';
}
async function pdfSha256(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(window.crypto&&crypto.subtle){
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  let h1=0xdeadbeef,h2=0x41c6ce57;                    // fallback when SubtleCrypto is unavailable
  for(let i=0;i<bytes.length;i++){h1=Math.imul(h1^bytes[i],2654435761);h2=Math.imul(h2^bytes[i],1597334677)}
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return `x${bytes.length.toString(16)}-${(h1>>>0).toString(16)}${(h2>>>0).toString(16)}`;
}
async function googleDriveWithRetry(task,attempts=3){
  let lastError;
  for(let i=0;i<attempts;i++){
    try{return await task()}
    catch(error){
      lastError=error;
      if(/authoris|refused/i.test(String(error&&error.message||'')))break;
      await new Promise(resolve=>setTimeout(resolve,700*(i+1)));
    }
  }
  throw lastError;
}
/** Sub-folder of the backup folder for one page; created on demand when create=true (oldest wins if two exist). */
let googleDrivePageFolderIds=new Map();
async function googleDrivePageFolder(name,interactive=false,create=true){
  const parentId=await googleDriveFolder(interactive);
  const key=`${parentId}/${name}`;
  if(googleDrivePageFolderIds.has(key))return googleDrivePageFolderIds.get(key);
  const query=encodeURIComponent(`name='${String(name).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
  const found=await googleDriveJson(`${GOOGLE_DRIVE_API}/files?q=${query}&orderBy=createdTime&pageSize=10&fields=files(id,name)`,{},interactive);
  let id=((found.files||[])[0]||{}).id||'';
  if(!id&&create){
    const created=await googleDriveJson(`${GOOGLE_DRIVE_API}/files?fields=id`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:[parentId]})
    },interactive);
    id=created.id;
  }
  if(id)googleDrivePageFolderIds.set(key,id);
  return id;
}
/** Map: sha256 -> Drive file id of every PDF in one folder (hash from appProperties, or from a legacy file name). */
async function googleDriveListPdfs(folderId,interactive=false){
  const found=new Map();
  if(!folderId)return found;
  const query=encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType='application/pdf'`);
  let pageToken='';
  do{
    const page=pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:'';
    const data=await googleDriveJson(`${GOOGLE_DRIVE_API}/files?q=${query}&pageSize=1000&fields=nextPageToken,files(id,name,appProperties)${page}`,{},interactive);
    for(const file of data.files||[]){
      const legacy=/^assetbook-pdf-(.+)\.pdf$/i.exec(file.name||'');
      const hash=(file.appProperties&&file.appProperties.sha256)||(legacy&&legacy[1])||'';
      if(hash&&!found.has(hash))found.set(hash,file.id);
    }
    pageToken=data.nextPageToken||'';
  }while(pageToken);
  return found;
}
async function googleDriveUploadPdf(blob,hash,name,folderId,interactive=false){
  let fileName=String(name||'document.pdf').replace(/[\\/]/g,'-').trim()||'document.pdf';
  if(!/\.pdf$/i.test(fileName))fileName+='.pdf';
  const form=new FormData();
  form.append('metadata',new Blob([JSON.stringify({name:fileName,mimeType:'application/pdf',parents:[folderId],appProperties:{sha256:hash}})],{type:'application/json'}));
  form.append('file',new Blob([blob],{type:'application/pdf'}),fileName);
  return googleDriveJson(`${GOOGLE_DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name`,{method:'POST',body:form},interactive);
}
async function googleDriveDownloadPdf(fileId,interactive=false){
  const response=await googleDriveFetch(`${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,{},interactive);
  if(!response.ok)throw await googleDriveError(response);
  return response.blob();
}
/** Uploads the PDFs a snapshot refers to that their page folder in Drive does not have yet. Returns how many. */
async function ensureSnapshotPdfsInDrive(snapshot,interactive=false){
  const items=snapshot&&snapshot.__pdfBlobs;
  if(!items||!items.size)return 0;
  googleDrivePageFolderIds=new Map();                   // a folder deleted in Drive must not stay cached
  const byFolder=new Map();
  for(const item of items.values()){
    if(!byFolder.has(item.folder))byFolder.set(item.folder,[]);
    byFolder.get(item.folder).push(item);
  }
  const queue=[];
  for(const [folder,list] of byFolder){
    const folderId=await googleDrivePageFolder(folder,interactive,true);
    const listed=await googleDriveListPdfs(folderId,interactive);
    for(const item of list)if(!listed.has(item.hash))queue.push(Object.assign({folderId},item));
  }
  const total=queue.length;
  if(!total)return 0;
  let done=0;
  setDriveStatus(`Uploading PDFs 0/${total}…`);
  const worker=async()=>{
    while(queue.length){
      const item=queue.shift();
      await googleDriveWithRetry(()=>googleDriveUploadPdf(item.blob,item.hash,item.name,item.folderId,interactive));
      done++;
      setDriveStatus(`Uploading PDFs ${done}/${total}…`);
    }
  };
  await Promise.all([worker(),worker(),worker()]);
  return total;
}
/**
 * Bytes of every PDF a snapshot needs, as [{id,blob}]. Reuses bytes this device already has, downloads only
 * the rest. Runs BEFORE anything is written, so a failed download leaves the database untouched.
 */
async function resolveSnapshotBlobs(snapshot,mode='replace',options={}){
  const inline=(Array.isArray(snapshot&&snapshot.pdfs)?snapshot.pdfs:[]).filter(entry=>entry&&entry.id&&entry.data);
  if(inline.length)return inline.map(entry=>({id:entry.id,blob:base64ToBlob(entry.data,entry.type)}));
  let wanted=(Array.isArray(snapshot&&snapshot.pdfIndex)?snapshot.pdfIndex:[]).filter(entry=>entry&&entry.id&&entry.hash);
  if(mode==='merge'){
    const keep=[];
    for(const entry of wanted){if(!await getOne('documentBlobs',entry.id))keep.push(entry)}
    wanted=keep;
  }
  if(!wanted.length)return [];
  const interactive=!!options.interactive;
  const need=new Set(wanted.map(entry=>entry.hash));
  const sizes=new Set(wanted.map(entry=>Number(entry.size)||0));
  const byHash=new Map();
  for(const doc of await getAll('documents')){
    if(byHash.size===need.size)break;
    const blob=await getDocBlob(doc.id).catch(()=>null);
    if(!blob||(sizes.size&&!sizes.has(blob.size)))continue;
    const hash=await pdfSha256(blob);
    if(need.has(hash)&&!byHash.has(hash))byHash.set(hash,blob);
  }
  const missing=[...need].filter(hash=>!byHash.has(hash));
  if(missing.length){
    googleDrivePageFolderIds=new Map();
    const listings=new Map();                           // folder name -> Map(hash -> file id)
    const listing=async folder=>{
      if(!listings.has(folder)){
        const folderId=folder?await googleDrivePageFolder(folder,interactive,false):await googleDriveFolder(interactive);
        listings.set(folder,await googleDriveListPdfs(folderId,interactive));
      }
      return listings.get(folder);
    };
    let done=0;
    for(const hash of missing){
      const entries=wanted.filter(entry=>entry.hash===hash);
      let fileId='';
      for(const entry of entries){fileId=(await listing(entry.folder||'')).get(hash)||'';if(fileId)break}
      if(!fileId)fileId=(await listing('')).get(hash)||'';          // PDFs stored directly in the backup folder
      const label=entries[0].name||'a PDF';
      if(!fileId)throw new Error(`"${label}" is missing from Google Drive, so nothing was changed on this device.`);
      setDriveStatus(`Downloading PDFs ${done+1}/${missing.length}…`);
      const blob=await googleDriveWithRetry(()=>googleDriveDownloadPdf(fileId,interactive));
      const check=await pdfSha256(blob);
      if(check!==hash)throw new Error(`"${label}" arrived damaged from Google Drive, so nothing was changed on this device.`);
      byHash.set(hash,blob);
      done++;
    }
  }
  return wanted.map(entry=>({id:entry.id,blob:new Blob([byHash.get(entry.hash)],{type:entry.type||'application/pdf'})}));
}
function mergeZakatRecordLists(local=[],incoming=[]){
  const records=new Map();
  [...(Array.isArray(local)?local:[]),...(Array.isArray(incoming)?incoming:[])].forEach(record=>{
    if(!record||!record.id)return;
    const existing=records.get(record.id);
    if(!existing){records.set(record.id,record);return}
    // A restore/merge must never drop an attached Reference PDF that the other copy has.
    if(!zakatRecordReferencePdf(existing)&&zakatRecordReferencePdf(record)){
      const merged=Object.assign({},existing,{referencePdf:record.referencePdf||(record.calculation&&record.calculation.referencePdf)||null});
      records.set(record.id,merged);
    }
  });
  return [...records.values()];
}
function hasZakatData(settings=state.settings){
  const records=settings&&Array.isArray(settings.zakatRecords)?settings.zakatRecords:zakatRecords;
  return !!((Array.isArray(records)&&records.length)||(settings&&settings.zakat));
}
function snapshotHasZakatData(snapshot){
  const rows=Array.isArray(snapshot&&snapshot.settings)
    ?snapshot.settings
    :Object.entries(snapshot&&snapshot.settings||{}).map(([key,value])=>({key,value}));
  return rows.some(row=>row&&row.key==='zakat')||rows.some(row=>row&&row.key==='zakatRecords'&&Array.isArray(row.value)&&row.value.length>0);
}
function snapshotHasData(snapshot){
  return !!(snapshot&&(snapshot.records&&snapshot.records.length||snapshot.incomeExpenses&&snapshot.incomeExpenses.length||snapshot.officePurchases&&snapshot.officePurchases.length||snapshotHasZakatData(snapshot)));
}
const AssetBookDB={
  name:DB_NAME,
  stores:['records','categories','documents','documentBlobs','settings','backupHistory','incomeExpenses','incomeGroups','migrationHistory','officePurchases',SETTINGS_STORE],
  /** Full database snapshot. PDFs are listed (pdfIndex: sha256 + page folder); their bytes travel as separate Drive files. */
  async snapshot(){
    const [records,incomeExpenses,officePurchases,incomeGroups,migrationHistory,documents,settingsRows,settingsStore]=await Promise.all([
      getAll('records'),
      getAll('incomeExpenses'),
      getAll('officePurchases'),
      getAll('incomeGroups'),
      getAll('migrationHistory'),
      getAll('documents'),
      getAll('settings'),
      getAll(SETTINGS_STORE)
    ]);
    const structure=settingsStore.find(row=>row&&row.key===CATEGORY_STRUCTURE_KEY)||null;
    const pdfIndex=[];
    const pdfBlobs=new Map();                           // "folder|sha256" -> {folder,hash,name,blob} (kept off the JSON: not enumerable)
    for(const doc of documents){
      const blob=await getDocBlob(doc.id).catch(()=>null);
      if(!blob)continue;
      const hash=await pdfSha256(blob);
      const folder=drivePdfFolderName(doc);
      const name=doc.name||doc.title||'document.pdf';
      if(!pdfBlobs.has(`${folder}|${hash}`))pdfBlobs.set(`${folder}|${hash}`,{folder,hash,name,blob});
      pdfIndex.push({id:doc.id,name,type:blob.type||'application/pdf',size:blob.size,hash,folder});
    }
    const snapshot={
      app:'Personal Finance',
      format:'assetbook-drive-backup',
      version:3,
      database:DB_NAME,
      createdAt:new Date().toISOString(),
      settingsStore,
      userCustomizedCategories:{
        source:structure?(structure.source||'default'):'default',
        updatedAt:structure?(structure.updatedAt||''):'',
        categories:structure?cloneStructure(structure.categories||[]):[],
        incomeGroups:structure?cloneStructure(structure.incomeGroups||[]):[]
      },
      records,
      incomeExpenses,
      officePurchases,
      incomeGroups,
      migrationHistory,
      settings:settingsRows,
      documents:documents.map(doc=>{const clean=Object.assign({},doc);delete clean.blob;return clean}),
      pdfIndex
    };
    Object.defineProperty(snapshot,'__pdfBlobs',{value:pdfBlobs,enumerable:false});
    return snapshot;
  },

  /** Writes a snapshot back. settingsStore is merge-only and is never cleared. */
  async restore(snapshot,mode='replace',options={}){
    if(!snapshot||!Array.isArray(snapshot.records))throw new Error('Unsupported Google Drive backup format.');
    const records=snapshot.records||[];
    const incomeExpenses=Array.isArray(snapshot.incomeExpenses)?snapshot.incomeExpenses:[];
    const officePurchases=Array.isArray(snapshot.officePurchases)?snapshot.officePurchases:[];
    const incomeGroups=Array.isArray(snapshot.incomeGroups)?snapshot.incomeGroups:[];
    const migrationHistory=Array.isArray(snapshot.migrationHistory)?snapshot.migrationHistory:[];
    const documents=(Array.isArray(snapshot.documents)?snapshot.documents:[]).map(doc=>{const clean=Object.assign({},doc);delete clean.blob;return clean});
    const blobs=await resolveSnapshotBlobs(snapshot,mode,options);   // old backups: inline base64; new: Drive PDF files
    if(mode==='replace'){
      await replaceStore('records',records);
      await replaceStore('incomeExpenses',incomeExpenses);
      await replaceStore('officePurchases',officePurchases);
      await replaceStore('incomeGroups',incomeGroups);
      await replaceStore('migrationHistory',migrationHistory);
      await replaceStore('documents',documents);
      await replaceStore('documentBlobs',blobs);
    }else{
      for(const record of records){if(!await getOne('records',record.id))await put('records',record)}
      for(const entry of incomeExpenses){if(!await getOne('incomeExpenses',entry.id))await put('incomeExpenses',entry)}
      for(const entry of officePurchases){if(!await getOne('officePurchases',entry.id))await put('officePurchases',entry)}
      for(const group of incomeGroups){if(!await getOne('incomeGroups',group.id))await put('incomeGroups',group)}
      for(const row of migrationHistory){if(!await getOne('migrationHistory',row.id))await put('migrationHistory',row)}
      for(const doc of documents){if(!await getOne('documents',doc.id))await put('documents',doc)}
      for(const blob of blobs){if(!await getOne('documentBlobs',blob.id))await put('documentBlobs',blob)}
    }
    // Protected store: only ADD missing records; the category tree is merged, never replaced.
    for(const row of Array.isArray(snapshot.settingsStore)?snapshot.settingsStore:[]){
      if(!row||!row.key||row.key===CATEGORY_STRUCTURE_KEY)continue;
      if(!await getOne(SETTINGS_STORE,row.key))await put(SETTINGS_STORE,Object.assign({},row));
    }
    const custom=snapshot.userCustomizedCategories||null;
    if(custom&&(custom.categories||custom.incomeGroups))await mergeCategoryStructure({categories:custom.categories||[],incomeGroups:custom.incomeGroups||[]});
    else if(snapshot.categoryStructure)await mergeCategoryStructure(snapshot.categoryStructure);
    if(!await readCategoryStructure())await seedCategoryStructure('default');
    const settingsRows=Array.isArray(snapshot.settings)
      ?snapshot.settings
      :Object.entries(snapshot.settings||{}).map(([key,value])=>({key,value}));
    for(const row of settingsRows){
      if(!row||!row.key)continue;
      if(/^drive/i.test(String(row.key)))continue;    // Drive connection/bookkeeping stays local to this device
      const value=mode==='merge'&&row.key==='zakatRecords'
        ?mergeZakatRecordLists((await getOne('settings',row.key))?.value,row.value)
        :(mode==='merge'&&row.key==='incomeTax'?mergeIncomeTaxData((await getOne('settings',row.key))?.value,row.value):row.value);
      await put('settings',{key:row.key,value});
    }
    return {records:records.length,incomeExpenses:incomeExpenses.length,officePurchases:officePurchases.length,documents:blobs.length};
  }
};

/** One [id:sha256] entry per stored PDF - identical for a v2 backup (inline base64) and a v3 backup (pdfIndex). */
async function snapshotPdfDigest(snapshot){
  if(Array.isArray(snapshot&&snapshot.pdfIndex))return snapshot.pdfIndex.map(entry=>`${entry.id}:${entry.hash}`).sort();
  const out=[];
  for(const entry of Array.isArray(snapshot&&snapshot.pdfs)?snapshot.pdfs:[]){
    if(entry&&entry.id&&entry.data)out.push(`${entry.id}:${await pdfSha256(base64ToBlob(entry.data,entry.type))}`);
  }
  return out.sort();
}
/** SHA-256 of the snapshot content, ignoring the timestamp, the file format and the local Drive bookkeeping rows. */
async function snapshotFingerprint(snapshot){
  try{
    if(!(window.crypto&&crypto.subtle&&window.TextEncoder))return '';
    const copy=Object.assign({},snapshot);
    delete copy.createdAt;delete copy.format;delete copy.version;delete copy.safetyReason;
    copy.settings=(Array.isArray(copy.settings)?copy.settings:[]).filter(row=>!(row&&/^drive/i.test(String(row.key||''))));
    copy.pdfDigest=await snapshotPdfDigest(snapshot);
    delete copy.pdfs;delete copy.pdfIndex;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(copy)));
    return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }catch(error){return ''}
}
/** A stored hash is only comparable when it came from the same fingerprint algorithm. */
function driveStoredHash(){
  return state.settings.driveFpVersion===DRIVE_FP_VERSION?(state.settings.driveLastSnapshotHash||''):'';
}
async function waitForDriveIdle(timeoutMs=20000){
  const started=Date.now();
  while(googleDriveBusy&&Date.now()-started<timeoutMs)await new Promise(resolve=>setTimeout(resolve,250));
}
/** assetbook-keep-YYYY-MM-DDTHH-mm-ss.json (pre-restore safety copy; not matched by the backup list) */
function googleDriveSafetyName(date=new Date()){
  return `assetbook-keep-${date.toISOString().slice(0,19).replace(/:/g,'-')}.json`;
}
/**
 * Best-effort safety copy of the CURRENT data, saved right before it is replaced by a restore.
 * Silent (no popup) and never blocks or fails the restore itself. Returns true when saved.
 */
async function saveDriveSafetySnapshot(reason,options={}){
  if(!driveSyncEnabled())return false;
  let locked=false;
  try{
    if(!options.holdsLock){
      clearTimeout(googleDriveBackupTimer);googleDriveBackupTimer=null;
      await waitForDriveIdle();
      googleDriveBusy=true;locked=true;
    }
    await ensureDriveToken(false);
    const snapshot=await AssetBookDB.snapshot();
    if(!snapshotHasData(snapshot))return false;
    snapshot.safetyReason=reason||'before restore';
    await googleDriveUpload(snapshot,googleDriveSafetyName(),false);
    await googleDrivePruneSafety(false);
    return true;
  }catch(error){
    console.info('[drive] safety snapshot skipped',error);
    return false;
  }finally{
    if(locked)googleDriveBusy=false;
  }
}

/** Local-only bookkeeping: "this device is now in step with Drive backup <fileName>". */
async function markDriveInSync(fileName){
  const fingerprint=await snapshotFingerprint(await AssetBookDB.snapshot());
  const now=new Date().toISOString();
  state.settings.driveLastBackupName=fileName;
  state.settings.driveLastSnapshotHash=fingerprint;
  state.settings.driveLastSyncedAt=now;
  await put('settings',{key:'driveLastBackupName',value:fileName});
  state.settings.driveFpVersion=DRIVE_FP_VERSION;
  await put('settings',{key:'driveLastSnapshotHash',value:fingerprint});
  await put('settings',{key:'driveFpVersion',value:DRIVE_FP_VERSION});
  await put('settings',{key:'driveLastSyncedAt',value:now});
}
async function reloadSettingsState(){
  await loadState();
  state.settings=(await getAll('settings')).reduce((out,item)=>(out[item.key]=item.value,out),state.settings||{});
  loadZakatState();
}
/** Replaces this device's data with a Drive backup and records that the device is now in step with it. */
async function pullDriveBackup(file,interactive){
  isRestoring=true;                                   // no auto-backup while the database is rewritten
  try{
    const snapshot=await googleDriveDownload(file.id,interactive);
    const summary=await AssetBookDB.restore(snapshot,'replace',{interactive});
    await reloadSettingsState();
    await markDriveInSync(file.name);
    if(appReady)renderAll();
    return summary;
  }finally{isRestoring=false}
}
/** Server-side copy of a Drive backup into the protected safety set (assetbook-keep-*). */
async function googleDriveCopyAsSafety(file,interactive){
  const folderId=await googleDriveFolder(interactive);
  await googleDriveJson(`${GOOGLE_DRIVE_API}/files/${encodeURIComponent(file.id)}/copy?fields=id`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:googleDriveSafetyName(),parents:[folderId]})
  },interactive);
  await googleDrivePruneSafety(interactive);
}
/** Asks which data to keep when both Drive (other device) and this device changed. */
function askDriveConflict(latest){
  return new Promise(resolve=>{
    const modal=$el('driveConflictModal');
    const when=latest&&latest.createdTime?new Date(latest.createdTime).toLocaleString():'';
    $el('driveConflictText').textContent=`Google Drive has newer data${when?` (${when})` :''} saved from another device, and this device also has changes that Drive does not have yet. Nothing has been overwritten. Choose what to keep.`;
    let done=false;
    const finish=choice=>{
      if(done)return;done=true;
      modal.onclose=null;
      if(modal.open)modal.close();
      resolve(choice);
    };
    modal.querySelectorAll('[data-drive-choice]').forEach(button=>{button.onclick=()=>finish(button.dataset.driveChoice)});
    modal.onclose=()=>finish('later');
    modal.showModal();
  });
}
/**
 * Multi-device safety check, run BEFORE every upload. Drive's newest backup is compared with the
 * last backup this device uploaded/loaded:
 *   same            -> nothing new in Drive, go ahead.
 *   newer in Drive, this device unchanged  -> silently load Drive's data (action 'pulled').
 *   newer in Drive AND changed here        -> ask: merge / use Drive / keep this device / later.
 * Returns {action:'proceed'|'upload'|'pulled'|'cancel', files}.
 */
async function reconcileWithDrive(interactive){
  const files=await googleDriveList(interactive);
  const latest=files[0];
  if(!latest)return {action:'proceed',files};
  const base=state.settings.driveLastBackupName||'';
  if(base&&latest.name===base)return {action:'proceed',files};
  const snapshot=await AssetBookDB.snapshot();
  const hasData=snapshotHasData(snapshot);
  let localUnchanged=!hasData;
  if(!localUnchanged&&base){
    const fingerprint=await snapshotFingerprint(snapshot);
    if(fingerprint&&driveStoredHash()){
      localUnchanged=driveStoredHash()===fingerprint;
    }else if(fingerprint){
      // Older app version never stored a fingerprint: compare with the backup this device last uploaded.
      const baseFile=files.find(file=>file.name===base);
      if(baseFile){
        try{localUnchanged=(await snapshotFingerprint(await googleDriveDownload(baseFile.id,interactive)))===fingerprint}catch(error){localUnchanged=false}
      }
    }
  }
  if(localUnchanged){
    const summary=await pullDriveBackup(latest,interactive);
    toast(`Loaded newer data from Google Drive (saved on another device): ${summary.records} record(s)`);
    return {action:'pulled',files};
  }
  const choice=await askDriveConflict(latest);
  if(choice==='drive'){
    const kept=await saveDriveSafetySnapshot('before using Drive data',{holdsLock:true,interactive});
    await pullDriveBackup(latest,interactive);
    toast(`This device now uses the data from Google Drive.${kept?' Your previous data is kept as a safety copy in Drive.':''}`);
    return {action:'pulled',files};
  }
  if(choice==='merge'){
    await saveDriveSafetySnapshot('before merging with Drive',{holdsLock:true,interactive});
    isRestoring=true;
    try{
      await AssetBookDB.restore(await googleDriveDownload(latest.id,interactive),'merge',{interactive});
      await reloadSettingsState();
      if(appReady)renderAll();
    }finally{isRestoring=false}
    toast('Merged: records from Google Drive were added to this device. Uploading the combined data…');
    return {action:'upload',files};
  }
  if(choice==='local'){
    try{await googleDriveCopyAsSafety(latest,interactive)}catch(error){console.info('[drive] could not keep a copy of the Drive backup',error)}
    return {action:'upload',files};
  }
  return {action:'cancel',files};
}

/** Creates a new backup, uploads it, then prunes everything past the newest 15. */
async function syncGoogleDrive(options={}){
  const interactive=options.interactive!==false;
  const silent=!!options.silent;
  if(isRestoring){if(!silent)toast('A restore is in progress. Try again in a moment.',true);return false}
  if(!driveSyncEnabled()){if(!silent)toast('Connect Google Drive first.',true);return false}
  if(googleDriveBusy)return false;
  googleDriveBusy=true;
  setDriveStatus(silent?'Auto-backing up…':'Syncing…');
  let saved=false;
  try{
    // Several devices share one Drive folder: look at Drive BEFORE uploading, so an older device
    // can never overwrite data that another device saved later.
    const reconciled=await reconcileWithDrive(interactive);
    if(reconciled.action==='cancel'){
      googleDriveStatus='Paused — Google Drive has newer data from another device. Click Sync Now to choose what to keep.';
      if(!silent)toast('Nothing was uploaded. Drive has newer data from another device.',true);
      return false;
    }
    if(reconciled.action==='pulled'){
      googleDriveStatus='Connected — loaded the newer data from Google Drive.';
      return true;
    }
    const forceUpload=!!options.force||reconciled.action==='upload';
    const snapshot=await AssetBookDB.snapshot();
    const fingerprint=await snapshotFingerprint(snapshot);
    if(fingerprint&&!forceUpload&&driveStoredHash()===fingerprint&&state.settings.driveLastBackupName){
      // Nothing changed since the last upload: only skip while that backup still exists in Drive.
      const existing=reconciled.files;
      if(existing.some(file=>file.name===state.settings.driveLastBackupName)){
        const stamp=new Date().toISOString();
        state.settings.driveLastSyncedAt=stamp;
        await put('settings',{key:'driveLastSyncedAt',value:stamp});
        googleDriveStatus='Connected — Google Drive is already up to date.';
        if(!silent)toast('Google Drive is already up to date (no changes since the last backup).');
        return true;
      }
    }
    const fileName=googleDriveBackupName();
    const result=await googleDriveUpload(snapshot,fileName,interactive);
    const files=await googleDriveList(interactive);
    const removed=await googleDrivePrune(files,interactive);
    const now=new Date().toISOString();
    state.settings.driveLastSyncedAt=now;
    state.settings.driveLastBackupName=fileName;
    await put('settings',{key:'driveLastSyncedAt',value:now});
    await put('settings',{key:'driveLastBackupName',value:fileName});
    state.settings.driveLastSnapshotHash=fingerprint;
    state.settings.driveFpVersion=DRIVE_FP_VERSION;
    await put('settings',{key:'driveLastSnapshotHash',value:fingerprint});
    await put('settings',{key:'driveFpVersion',value:DRIVE_FP_VERSION});
    googleDriveStatus='Connected to Google Drive.';
    saved=true;
    if(!silent)toast(`Google Drive backup saved (${formatFileSize(result.size)})${result.pdfsUploaded?` · ${result.pdfsUploaded} new PDF(s) uploaded`:''}${removed?` · ${removed} older backup(s) removed`:''}`);
  }catch(error){
    googleDriveStatus=error.message||'Google Drive sync failed.';
    throw error;
  }finally{
    googleDriveBusy=false;
    renderDriveSyncCard();
  }
  return saved;
}

async function connectGoogleDrive(){
  if(!await waitForGoogleIdentity(8000)){
    toast('Google sign-in could not load. Check your connection and try again.',true);
    return;
  }
  setDriveStatus('Connecting to Google Drive…');
  try{
    await ensureDriveToken(true);
    await googleDriveFolder(true);
    state.settings.driveSyncEnabled=true;
    await put('settings',{key:'driveSyncEnabled',value:true});
    googleDriveStatus='Connected to Google Drive.';
    renderDriveSyncCard();
    toast('Google Drive connected');
    // New device / cleared browser: restore the newest cloud backup before uploading anything.
    const hasLocalData=state.records.length||state.incomeExpenses.length||state.officePurchases.length||hasZakatData();
    if(!hasLocalData)await restoreLatestGoogleDriveBackup(true);
    try{
      await syncGoogleDrive({silent:true,interactive:false});
    }catch(syncError){
      toast(`Connected, but the first backup failed: ${syncError.message||syncError}`,true);
    }
  }catch(error){
    googleDriveStatus='Not connected';
    toast(error.message||'Google Drive could not be connected.',true);
  }finally{
    googleDriveBusy=false;
    renderDriveSyncCard();
  }
}

async function disconnectGoogleDrive(){
  if(!await confirm('Disconnect Google Drive? Automatic backups stop until you connect again.','Disconnect Google Drive'))return;
  const token=googleDriveAccessToken;
  googleDriveAccessToken='';
  googleDriveTokenExpiry=0;
  googleDriveFolderId='';
  clearTimeout(googleDriveBackupTimer);
  googleDriveBackupTimer=null;
  try{localStorage.removeItem(GOOGLE_DRIVE_FOLDER_KEY)}catch(error){}
  if(token&&window.google&&google.accounts&&google.accounts.oauth2&&google.accounts.oauth2.revoke){
    try{google.accounts.oauth2.revoke(token,()=>{})}catch(error){}
  }
  state.settings.driveSyncEnabled=false;
  await put('settings',{key:'driveSyncEnabled',value:false});
  googleDriveStatus='';
  renderDriveSyncCard();
  toast('Google Drive disconnected');
}

/**
 * Restores the newest Drive backup. Guarded by isRestoring, so no backup can be scheduled or
 * started while the database is being rewritten. Never touches the protected category tree.
 */
async function restoreLatestGoogleDriveBackup(interactive=false){
  if(isRestoring)return false;
  isRestoring=true;
  try{
    const files=await googleDriveList(interactive);
    if(!files.length)return false;
    const snapshot=await googleDriveDownload(files[0].id,interactive);
    const summary=await AssetBookDB.restore(snapshot,'replace',{interactive});
    await loadState();
    state.settings=(await getAll('settings')).reduce((out,item)=>(out[item.key]=item.value,out),state.settings||{});
    loadZakatState();
    await markDriveInSync(files[0].name);
    googleDriveStatus=`Restored the latest backup (${files[0].name}).`;
    if(appReady)renderAll();
    toast(`Restored Google Drive backup: ${summary.records} record(s), ${summary.documents} PDF(s)`);
    return true;
  }catch(error){
    console.info('[drive] restore skipped',error);
    googleDriveStatus='The latest backup could not be restored automatically.';
    return false;
  }finally{
    isRestoring=false;
    renderDriveSyncCard();
  }
}

/**
 * Auto-restore at launch. Refused when local data exists, so a launch can never replace
 * records that are already on this device. Only an empty database (new browser, new phone,
 * reinstall) is filled from the newest Drive backup.
 */
async function googleDriveAutoRestore(){
  if(isRestoring)return false;
  if(!driveSyncEnabled())return false;
  const hasLocalData=state.records.length||state.incomeExpenses.length||state.officePurchases.length||hasZakatData();
  if(hasLocalData)return false;
  return restoreLatestGoogleDriveBackup(false);
}

/** Settings → Google Drive Sync → "Restore from Drive": pick any backup or safety copy. */
async function openDriveRestoreDialog(){
  if(!driveSyncEnabled()){toast('Connect Google Drive first.',true);return}
  await ensureDriveToken(true);
  const [backups,safety]=await Promise.all([googleDriveList(true),googleDriveSafetyList(true)]);
  const select=$el('driveRestoreSelect');
  select.textContent='';
  const add=(file,label)=>{
    const option=document.createElement('option');
    option.value=file.id;
    option.textContent=`${label} · ${new Date(file.createdTime).toLocaleString()} · ${formatFileSize(Number(file.size)||0)}`;
    select.appendChild(option);
  };
  backups.forEach(file=>add(file,'Backup'));
  safety.forEach(file=>add(file,'Safety copy'));
  if(!select.options.length){toast('No backups were found in Google Drive.',true);return}
  $el('driveRestoreModal').showModal();
}
async function restoreSelectedGoogleDriveBackup(){
  const fileId=$el('driveRestoreSelect').value;
  if(!fileId||isRestoring)return;
  $el('driveRestoreModal').close();
  isRestoring=true;
  clearTimeout(googleDriveBackupTimer);googleDriveBackupTimer=null;
  let restoreOk=false;
  try{
    await ensureDriveToken(true);
    const snapshot=await googleDriveDownload(fileId,true);
    if(!snapshot||!Array.isArray(snapshot.records))throw new Error('Unsupported Google Drive backup format.');
    const safetySaved=await saveDriveSafetySnapshot('before Drive restore');
    const summary=await AssetBookDB.restore(snapshot,'replace',{interactive:true});
    await loadState();
    state.settings=(await getAll('settings')).reduce((out,item)=>(out[item.key]=item.value,out),state.settings||{});
    loadZakatState();
    renderAll();
    restoreOk=true;
    toast(`Restored from Google Drive: ${summary.records} record(s), ${summary.documents} PDF(s)${safetySaved?' · safety copy of the previous data saved':''}`);
  }catch(error){
    console.error(error);
    toast(error.message||'Unable to restore from Google Drive.',true);
  }finally{
    isRestoring=false;
    renderDriveSyncCard();
    if(restoreOk)scheduleDriveAutoBackup();
  }
}

/** Called from init(): paints the card, then silently reconnects and restores an empty database. */
async function initGoogleDriveSync(){
  renderDriveSyncCard();
  setupDriveResumeCheck();
  if(!driveSyncEnabled())return;
  if(navigator.onLine===false){
    googleDriveStatus='Offline — Google Drive sync resumes when you are back online.';
    renderDriveSyncCard();
    return;
  }
  if(!await waitForGoogleIdentity(3000)){
    googleDriveStatus='Google sign-in could not load. Check your connection, then click Sync Now.';
    renderDriveSyncCard();
    return;
  }
  try{
    await ensureDriveToken(false);
  }catch(error){
    console.info('[drive] silent sign-in unavailable',error);
    googleDriveStatus='Click Sync Now to sign in to Google Drive again.';
    renderDriveSyncCard();
    return;
  }
  await googleDriveAutoRestore();
  renderDriveSyncCard();
  // Pick up (or safely reconcile with) data another device saved while this one was closed.
  driveLastResumeCheck=Date.now();
  try{await syncGoogleDrive({silent:true,interactive:false})}catch(error){console.info('[drive] startup sync skipped',error)}
  renderDriveSyncCard();
}
let driveLastResumeCheck=0;
/** A phone app that stays open in the background wakes up with old data: check Drive when it returns to the foreground. */
function setupDriveResumeCheck(){
  if(setupDriveResumeCheck.done)return;
  setupDriveResumeCheck.done=true;
  const onLifecycle=(checkDrive)=>{
    if(!driveSyncEnabled()||!appReady||isRestoring)return;
    if(navigator.onLine===false){
      googleDriveStatus='Offline — Google Drive sync resumes when you are back online.';
      renderDriveSyncCard();
      return;
    }
    if(checkDrive&&document.querySelector('dialog[open]')&&!googleDriveDirty)return;
    if(googleDriveDirty){
      clearTimeout(googleDriveBackupTimer);
      googleDriveBackupTimer=null;
      runDriveAutoSync();
    }else if(checkDrive){
      runDriveAutoSync(true);
    }
  };
  document.addEventListener('visibilitychange',()=>onLifecycle(document.visibilityState==='visible'));
  window.addEventListener('pagehide',()=>onLifecycle(false));
  window.addEventListener('online',()=>onLifecycle(document.visibilityState==='visible'));
  window.addEventListener('focus',()=>onLifecycle(true));
  window.addEventListener('resume',()=>onLifecycle(true));
  document.addEventListener('resume',()=>onLifecycle(true));
}

/** Debounced backup after persisted local mutations; Drive metadata writes are excluded. */
function scheduleDriveAutoBackup(){
  if(isRestoring||!appReady||!driveSyncEnabled())return;
  googleDriveDirty=true;
  googleDriveChangeVersion++;
  queueDriveAutoBackup(Math.max(GOOGLE_DRIVE_AUTO_BACKUP_DELAY,GOOGLE_DRIVE_AUTO_SYNC_INTERVAL-(Date.now()-googleDriveLastAutoSyncAt)));
}
function queueDriveAutoBackup(delay){
  clearTimeout(googleDriveBackupTimer);
  googleDriveBackupTimer=setTimeout(()=>{
    googleDriveBackupTimer=null;
    runDriveAutoSync();
  },Math.max(0,delay));
}
async function runDriveAutoSync(checkDrive=false){
  if(isRestoring||!appReady||!driveSyncEnabled()||navigator.onLine===false)return false;
  if(!googleDriveDirty&&!checkDrive)return false;
  if(!googleDriveDirty&&Date.now()-driveLastResumeCheck<GOOGLE_DRIVE_RESUME_CHECK_INTERVAL)return false;
  if(googleDriveAutoSyncPromise)return googleDriveAutoSyncPromise;
  if(googleDriveBusy){
    if(googleDriveDirty)queueDriveAutoBackup(GOOGLE_DRIVE_AUTO_BACKUP_DELAY);
    return false;
  }
  const wait=GOOGLE_DRIVE_AUTO_SYNC_INTERVAL-(Date.now()-googleDriveLastAutoSyncAt);
  if(wait>0){
    if(googleDriveDirty)queueDriveAutoBackup(wait);
    return false;
  }
  const changeVersion=googleDriveChangeVersion;
  googleDriveLastAutoSyncAt=Date.now();
  if(checkDrive)driveLastResumeCheck=Date.now();
  const task=(async()=>{
    try{
      await ensureDriveToken(false);
      const synced=await syncGoogleDrive({silent:true,interactive:false});
      if(synced&&changeVersion===googleDriveChangeVersion)googleDriveDirty=false;
      return synced;
    }catch(error){
      googleDriveStatus=error.message||'Google Drive auto-sync failed.';
      renderDriveSyncCard();
      console.info('[drive] auto-sync skipped',error);
      return false;
    }finally{
      googleDriveAutoSyncPromise=null;
      if(googleDriveDirty&&changeVersion!==googleDriveChangeVersion)queueDriveAutoBackup(GOOGLE_DRIVE_AUTO_BACKUP_DELAY);
    }
  })();
  googleDriveAutoSyncPromise=task;
  return task;
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

/* ==========================================================================
   Income Tax Calculation (Bangladesh individual return, FY 1 Jul - 30 Jun)
   All tax-only edits live in ONE settings row ("incomeTax") keyed by Financial Year, so
   Records, Income & Expenses and other years are never modified. The row travels with
   Backup / Restore and Google Drive sync like every other settings key.
   ========================================================================== */
const TAX_KEY='incomeTax';
const TAX_TABS=['dashboard','income','expenses','rebate','assets','deduction'];
const TAX_INV=[['cpfOwn','C.P.F (Own)','CPF (Own)'],['cpfCompany','C.P.F (Company)','CPF (Company)'],['groupIns','Group Insurance Premium','Group Insurance'],['pension','Contribution To Pension Fund',null],['welfare','Subcription To Welfare Fund (Own)','Welfare Fund']];
const TAX_SECTIONS=['Adjustment of Tax Refund','IT Deducted at Source from Salary','IT Deducted at Source from WPPF','IT Deducted at Source from Honorarium','Bank TDS','Advance Tax / Other'];
const TAX_DEFAULTS={taxFree:375000,minTax:5000};
const TAX_SLABS=[[300000,.10],[400000,.15],[500000,.20],[2000000,.25],[Infinity,.30]];
let taxTab='dashboard';
let taxYear='';
const taxNum=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const taxHas=v=>v!==undefined&&v!==null&&v!=='';
const taxSameFY=(a,b)=>normIncomeYear(a)===normIncomeYear(b);
const taxFyOf=r=>r.incomeYear||fiscalYearFromDate(r.date);
const taxSum=(list,fn)=>list.reduce((s,x)=>s+fn(x),0);
function taxPrevYear(fy){const p=parseIncomeYear(fy);return p?`${p.start-1}-${pad2(p.start%100)}`:''}
function taxYears(){
  const set=new Map();
  [...(state.settings.incomeYears||[]),...state.incomeExpenses.map(taxFyOf),...state.records.map(r=>r.incomeYear||''),...Object.keys((state.settings[TAX_KEY]||{}).years||{})]
    .filter(Boolean).forEach(y=>{const n=normIncomeYear(y);if(parseIncomeYear(n))set.set(n,n)});
  return [...set.values()].sort((a,b)=>b.localeCompare(a));
}
function taxYr(fy){
  const s=state.settings;
  if(!s[TAX_KEY]||typeof s[TAX_KEY]!=='object')s[TAX_KEY]={years:{}};
  const d=s[TAX_KEY];d.years=d.years||{};
  const y=d.years[fy]=d.years[fy]||{};
  ['incomeOv','expenseOv','assetOv','rebate','params'].forEach(k=>y[k]=y[k]||{});
  ['incomeAdj','expenseAdj','assetAdj','deductions','excluded'].forEach(k=>y[k]=y[k]||[]);
  return y;
}
let taxDirty=false;
function taxMarkSaved(){taxDirty=false;updateTaxSaveBtn()}
function updateTaxSaveBtn(){
  const b=document.getElementById('taxSaveBtn');
  if(!b)return;
  b.classList.toggle('dirty',taxDirty);
  const label=b.querySelector('span');
  if(label)label.textContent=taxDirty?'Save Change *':'Save Change';
}
window.addEventListener('beforeunload',e=>{if(taxDirty){e.preventDefault();e.returnValue=''}});
async function taxSave(){await put('settings',{key:TAX_KEY,value:state.settings[TAX_KEY]});taxMarkSaved()}
/** Imported IT Summary workbook values for a Financial Year (null when absent or switched off). */
function taxIT(fy){const r=taxYr(fy).itReturn;return r&&r.apply!==false?r:null}
function taxITRows(fy,type){const r=taxIT(fy),list=r&&r[type==='Income'?'income':'expenses'];return Array.isArray(list)&&list.length?list:null}
function taxITList(fy,type){const r=taxIT(fy),list=r&&r[type==='Asset'?'assets':'liabilities'];return Array.isArray(list)?list:null}
function taxITGroups(rows,ov,txs){
  const heads=new Map();
  rows.forEach(r=>{
    if(!heads.has(r.head))heads.set(r.head,[]);
    const key=r.head+'|'+r.label;
    const same=txs.filter(x=>String(x.category||'').trim().toLowerCase()===String(r.label).trim().toLowerCase());
    const o=ov[key],val=taxHas(o)?taxNum(o):taxNum(r.amount);
    heads.get(r.head).push({name:r.label,key,app:taxSum(same,x=>taxNum(x.amount)),count:same.length,ov:val,eff:val,meta:r});
  });
  return [...heads.entries()].map(([majorHead,cats])=>({majorHead,cats,app:taxSum(cats,c=>c.app),total:taxSum(cats,c=>c.eff)}));
}
function taxITSection(list,type,t){
  const by=new Map();
  list.forEach(r=>{if(!by.has(r.cat))by.set(r.cat,[]);by.get(r.cat).push(r)});
  const cats=[...by.entries()].map(([name,rows])=>{
    const subs=rows.map(r=>{const o=t.assetOv[r.key],v=taxHas(o)?taxNum(o):taxNum(r.amount);return {name:r.label,key:r.key,app:0,ov:v,eff:v,src:r}});
    return {name,subs,total:taxSum(subs,x=>x.eff)};
  });
  const adj=t.assetAdj.filter(a=>(a.kind||'Asset')===type),adjTotal=taxSum(adj,a=>taxNum(a.amount));
  return {cats,adj,adjTotal,total:taxSum(cats,c=>c.total)+adjTotal};
}
/** Merge mode of a restore: keep local values, add what only the backup has (arrays by id). */
function mergeIncomeTaxData(local,incoming){
  const out=JSON.parse(JSON.stringify(local&&local.years?local:{years:{}}));
  for(const [fy,inc] of Object.entries((incoming&&incoming.years)||{})){
    const cur=out.years[fy];
    if(!cur){out.years[fy]=inc;continue}
    for(const k of ['incomeAdj','expenseAdj','assetAdj','deductions']){
      const have=new Set((cur[k]||[]).map(x=>x.id));
      cur[k]=[...(cur[k]||[]),...(inc[k]||[]).filter(x=>!have.has(x.id))];
    }
    for(const k of ['incomeOv','expenseOv','assetOv','rebate','params'])cur[k]=Object.assign({},inc[k]||{},cur[k]||{});
    if(!cur.itReturn&&inc.itReturn)cur.itReturn=inc.itReturn;
    cur.excluded=[...new Set([...(cur.excluded||[]),...(inc.excluded||[])])];
  }
  return out;
}

/* ---------- Data builders ---------- */
function taxLedger(fy,type){
  const t=taxYr(fy),ov=type==='Income'?t.incomeOv:t.expenseOv,adj=type==='Income'?t.incomeAdj:t.expenseAdj;
  const txs=state.incomeExpenses.filter(r=>r.type===type&&taxSameFY(taxFyOf(r),fy)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const order=h=>{const i=state.incomeGroups.findIndex(g=>g.type===type&&g.majorHead===h);return i<0?999:i};
  const heads=new Map();
  txs.forEach(r=>{
    const h=r.majorHead||'Other',c=r.category||'Other';
    if(!heads.has(h))heads.set(h,new Map());
    const m=heads.get(h);
    if(!m.has(c))m.set(c,{name:c,app:0,count:0});
    const x=m.get(c);x.app+=taxNum(r.amount);x.count++;
  });
  const itRows=taxITRows(fy,type);
  const groups=itRows?taxITGroups(itRows,ov,txs):[...heads.entries()].sort((a,b)=>order(a[0])-order(b[0])).map(([majorHead,m])=>{
    const cats=[...m.values()].map(c=>{const key=majorHead+'|'+c.name,o=ov[key];return {...c,key,ov:taxHas(o)?taxNum(o):null,eff:taxHas(o)?taxNum(o):c.app}});
    return {majorHead,cats,app:taxSum(cats,c=>c.app),total:taxSum(cats,c=>c.eff)};
  });
  const total=taxSum(groups,g=>g.total),adjTotal=taxSum(adj,a=>taxNum(a.amount));
  return {txs,groups,app:taxSum(groups,g=>g.app),total,adj,adjTotal,grand:total+adjTotal};
}
function taxAssets(fy){
  const t=taxYr(fy),data=buildBalanceData(fy);
  const sec=(s,type)=>{
    const itl=taxITList(fy,type);
    if(itl)return taxITSection(itl,type,t);
    const cats=s.cats.map(c=>{
      const subs=c.subs.map(x=>{const key=`${type}|${c.name}|${x.name}`,o=t.assetOv[key];return {name:x.name,key,app:x.total,ov:taxHas(o)?taxNum(o):null,eff:taxHas(o)?taxNum(o):x.total}}).filter(x=>x.app||x.ov!==null);
      return {name:c.name,subs,total:taxSum(subs,x=>x.eff)};
    }).filter(c=>c.subs.length);
    const adj=t.assetAdj.filter(a=>(a.kind||'Asset')===type);
    return {cats,adj,adjTotal:taxSum(adj,a=>taxNum(a.amount)),total:taxSum(cats,c=>c.total)+taxSum(adj,a=>taxNum(a.amount))};
  };
  const assets=sec(data.assets,'Asset'),liabilities=sec(data.liabilities,'Liability');
  return {assets,liabilities,net:assets.total-liabilities.total};
}
function taxRebateRows(fy){
  const t=taxYr(fy);
  return TAX_INV.map(([key,label,sub])=>{
    const auto=sub?taxSum(state.records.filter(r=>r.type==='Asset'&&r.category==='Investments'&&String(r.subcategory||'').trim().toLowerCase()===sub.toLowerCase()&&recordMatchesYear(r,fy)),recordAmount):null;
    const o=t.rebate[key];
    return {key,label,auto,ov:taxHas(o)?taxNum(o):null,value:taxHas(o)?taxNum(o):(auto||0)};
  });
}
function taxDeductions(fy){
  const t=taxYr(fy);
  const linked=state.incomeExpenses.filter(r=>r.type==='Expense'&&r.majorHead==='Tax, Charges, Etc. Paid'&&r.category==='Tax & Surcharge'&&taxSameFY(taxFyOf(r),fy))
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)))
    .map(r=>({id:r.id,date:r.date,label:r.subcategory||'',note:r.description||'',amount:taxNum(r.amount),included:!t.excluded.includes(r.id)}));
  const linkedTotal=taxSum(linked.filter(x=>x.included),x=>x.amount),manualTotal=taxSum(t.deductions,x=>taxNum(x.claimed));
  return {linked,manual:t.deductions,linkedTotal,manualTotal,total:linkedTotal+manualTotal};
}
function taxSlabTax(income,free){
  let left=Math.max(0,income-free),tax=0;
  for(const [size,rate] of TAX_SLABS){if(left<=0)break;const part=Math.min(left,size);tax+=part*rate;left-=part}
  return tax;
}
function taxCompute(fy){
  const t=taxYr(fy),p=t.params;
  const inc=taxLedger(fy,'Income'),exp=taxLedger(fy,'Expense'),as=taxAssets(fy),ded=taxDeductions(fy),reb=taxRebateRows(fy);
  const free=taxHas(p.taxFree)?taxNum(p.taxFree):TAX_DEFAULTS.taxFree;
  const minTax=taxHas(p.minTax)?taxNum(p.minTax):TAX_DEFAULTS.minTax;
  const salary=taxSum(inc.groups.filter(g=>g.majorHead==='Income From Employment'),g=>g.total);
  const exemptDefault=Math.min(salary/3,500000);
  const exempt=taxHas(p.exempt)?taxNum(p.exempt):exemptDefault;
  const taxable=Math.max(0,inc.grand-exempt);
  const grossTax=taxSlabTax(taxable,free);
  const eligible=taxSum(reb,r=>r.value);
  const rebate=Math.min(0.15*Math.min(eligible,0.2*taxable,10000000),0.03*taxable,1000000);
  const afterRebate=Math.max(0,grossTax-rebate);
  const netTax=taxable>free?Math.max(afterRebate,minTax):0;
  const prev=taxPrevYear(fy);
  const prevNetDefault=prev?buildBalanceData(prev).net:0;
  const prevNet=taxHas(p.prevNet)?taxNum(p.prevNet):prevNetDefault;
  const outflow=exp.grand,source=inc.grand;
  const grossWealth=as.assets.total,liabilities=as.liabilities.total,netWealth=as.net;
  const totalOutflow=(netWealth-prevNet)+outflow;
  return {inc,exp,as,ded,reb,free,minTax,salary,exempt,exemptDefault,taxable,grossTax,eligible,rebate,afterRebate,netTax,deducted:ded.total,payable:netTax-ded.total,
    prev,prevNet,prevNetDefault,grossWealth,liabilities,netWealth,change:netWealth-prevNet,outflow,totalOutflow,source,difference:totalOutflow-source};
}

/* ---------- PDF attachments on Tax Deduction rows (same documents/documentBlobs stores as receipts) ---------- */
function taxDocs(item){
  const ids=new Set(item.documentIds||[]);
  return state.documents.filter(d=>ids.has(d.id)||d.recordId===item.id);
}
async function taxRemoveDocs(item){
  const ids=[...new Set(taxDocs(item).map(d=>d.id))];
  if(ids.length){await removeMany('documents',ids);await removeMany('documentBlobs',ids);state.documents=state.documents.filter(d=>!ids.includes(d.id))}
  item.documentIds=[];
}
async function taxAttachPdf(item,file){
  const id=uid('doc');
  const meta={id,recordId:item.id,title:file.name,name:file.name,type:file.type||'application/pdf',size:Number(file.size)||0,category:item.section||'Tax Deduction',subcategory:'',financialType:'Tax Deduction',incomeYear:taxYear,createdAt:new Date().toISOString()};
  await put('documentBlobs',{id,blob:file});
  await put('documents',meta);
  state.documents.push(meta);
  item.documentIds=[id];
}
const taxDocButtons=item=>taxDocs(item).map(d=>`<button type="button" class="btn" data-cmd="open-pdf" data-id="${esc(d.id)}" title="${esc(d.name||'PDF')}">View PDF</button> <button type="button" class="btn" data-cmd="download-pdf" data-id="${esc(d.id)}">Download</button>`).join(' ');

/* ---------- Entry dialog (adjustments, deduction rows) ---------- */
function taxPrompt(title,fields,values={}){
  return new Promise(resolve=>{
    const modal=$el('taxEntryModal'),form=$el('taxEntryForm');
    $el('taxEntryTitle').textContent=title;
    $el('taxEntryFields').innerHTML='<div class="form-grid">'+fields.map(f=>{
      const v=values[f.key]??'';
      const docs=f.type==='pdf'?(values.__docs||[]):[];
      const control=f.type==='pdf'
        ?`<input data-f="${f.key}" type="file" accept="application/pdf,.pdf">${docs.map(d=>`<span class="hint">Attached: ${esc(d.name||'document.pdf')} \u00b7 ${esc(formatFileSize(d.size||0))}</span><label class="check-line"><input type="checkbox" data-f-remove="${f.key}"> Remove attached PDF</label>`).join('')}<span class="hint">Optional. PDF only${docs.length?' \u2014 choosing a new file replaces the attached one':''}.</span>`
        :f.options
        ?`<select data-f="${f.key}">${f.options.map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select>`
        :`<input data-f="${f.key}" type="${f.type||'text'}" ${f.type==='number'?'step="0.01" inputmode="decimal"':''} value="${esc(v)}" ${f.required?'required':''}>`;
      return `<label class="${f.full?'full':''}"><span class="lbl">${esc(f.label)}${f.required?' *':''}</span>${control}</label>`;
    }).join('')+'</div>';
    let done=false;
    const finish=value=>{if(done)return;done=true;if(modal.open)modal.close();resolve(value)};
    form.onsubmit=e=>{
      e.preventDefault();
      if(!form.reportValidity())return;
      const out={};
      let bad=false;
      fields.forEach(f=>{
        const el=form.querySelector(`[data-f="${f.key}"]`);
        if(f.type==='pdf'){
          const file=el.files&&el.files[0]||null;
          if(file&&!isPdfFile(file)){bad=true;return}
          out.pdfFile=file;
          const rm=form.querySelector(`[data-f-remove="${f.key}"]`);
          out.removePdf=!!(rm&&rm.checked);
          return;
        }
        out[f.key]=f.type==='number'?(el.value===''?0:Number(el.value)):el.value.trim();
      });
      if(bad){toast('Only PDF files can be attached.',true);return}
      finish(out);
    };
    modal.onclose=()=>finish(null);
    modal.showModal();
  });
}
const TAX_ADJ_FIELDS=[{key:'label',label:'Description',required:true,full:true},{key:'amount',label:'Amount (use - to reduce)',type:'number',required:true}];
const TAX_DED_FIELDS=[
  {key:'section',label:'Section / Particulars',options:TAX_SECTIONS,full:true},
  {key:'particulars',label:'Month / Particulars',full:true},
  {key:'authority',label:'Depositing Authority',full:true},
  {key:'docType',label:'Payment Document Type'},
  {key:'ref',label:'Challan / Certificate Ref. No.'},
  {key:'date',label:'Challan / Certificate Date',type:'date'},
  {key:'certAmount',label:'Challan / Certificate Amount',type:'number'},
  {key:'claimed',label:'Claimed Amount',type:'number',required:true},
  {key:'pdf',label:'Attach PDF (optional)',type:'pdf',full:true}
];
async function taxEditItem(list,id,kind){
  const t=taxYr(taxYear),arr=t[list],old=id?arr.find(x=>x.id===id):null;
  let fields=TAX_ADJ_FIELDS,title=old?'Edit Adjustment':'Add Adjustment',defaults={};
  if(list==='assetAdj')fields=[{key:'kind',label:'Type',options:['Asset','Liability']},...TAX_ADJ_FIELDS],defaults={kind:kind||'Asset'};
  if(list==='deductions'){fields=TAX_DED_FIELDS;title=old?'Edit Tax Deduction':'Add Tax Deduction';defaults={section:TAX_SECTIONS[1],docType:'Challan'}}
  const docs=old&&list==='deductions'?taxDocs(old):[];
  const value=await taxPrompt(title,fields,Object.assign({},old||defaults,{__docs:docs}));
  if(!value)return;
  const {pdfFile,removePdf,...data}=value;
  let item=old;
  if(old)Object.assign(old,data);else{item={id:uid('tax'),...data};arr.push(item)}
  if(list==='deductions'){
    try{
      if(pdfFile||removePdf)await taxRemoveDocs(item);
      if(pdfFile)await taxAttachPdf(item,pdfFile);
    }catch(error){console.warn(error);toast('The row was saved, but the PDF could not be attached.',true)}
  }
  await taxSave();renderIncomeTax();toast('Saved for '+taxYear);
}

/* ---------- Views ---------- */
const taxMoneyCell=v=>`<td class="num">${formatMoney(v)}</td>`;
const taxCard=(i,ic,label,value,cls)=>`<div class="summary-card" style="--i:${i}"><div class="summary-icon">${icon(ic)}</div><div><p>${label}</p><strong class="kpi-value ${cls||''}">${formatMoney(value)}</strong></div></div>`;
const taxInput=(set,key,placeholder,value)=>`<input class="tax-input" type="number" step="0.01" inputmode="decimal" data-tax-set="${set}" data-tax-key="${esc(key)}" placeholder="${esc(placeholder)}" value="${value===null||value===undefined?'':value}" aria-label="Override value">`;
const taxAct=(act,label,extra='',cls='btn')=>`<button type="button" class="${cls}" data-tax-act="${act}" ${extra}>${label}</button>`;
function taxAdjTable(list,adj,kind){
  const rows=adj.map(a=>`<tr><td>${esc(a.label)}${list==='assetAdj'?` <span class="badge">${esc(a.kind||'Asset')}</span>`:''}</td>${taxMoneyCell(taxNum(a.amount))}<td class="num">${taxAct('editItem','Edit',`data-tax-list="${list}" data-id="${esc(a.id)}"`)} ${taxAct('delItem','Delete',`data-tax-list="${list}" data-id="${esc(a.id)}"`,'btn btn-danger')}</td></tr>`).join('');
  return `<div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>Tax-only adjustments</h3><p>Apply to ${esc(taxYear)} only; real transactions are not changed.</p></div><div class="tt-actions">${taxAct('addItem','+ Add Adjustment',`data-tax-list="${list}" data-kind="${kind||''}"`,'btn btn-primary')}</div></div><div class="table-wrap"><table><thead><tr><th>Description</th><th class="num">Amount</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="3" class="hint">No adjustments</td></tr>'}</tbody></table></div></div>`;
}
function taxViewDashboard(fy){
  const c=taxCompute(fy),refund=c.payable<0;
  const cards=[taxCard(0,'up','Total Income',c.inc.grand),taxCard(1,'file','Taxable Income',c.taxable),taxCard(2,'scale','Allowable Rebate / Investment Credit',c.rebate),taxCard(3,'calc','Gross Tax',c.grossTax),taxCard(4,'list','Net Tax Liability',c.netTax),taxCard(5,'down','Tax Deducted / Paid',c.deducted),taxCard(6,'scale',refund?'Net Tax Refundable':'Net Tax Payable',Math.abs(c.payable),refund?'positive':'')].join('');
  const row=(n,label,val,cls='')=>`<tr class="${cls}"><td>${n}</td><td>${label}</td>${taxMoneyCell(val)}</tr>`;
  const computation=`<table class="balance-table tax-table"><thead><tr><th>Sl.</th><th>Particulars</th><th class="num">Amount</th></tr></thead><tbody>
    ${row(1,'Total Income (Fiscal Year Income)',c.inc.grand)}
    ${row(2,'Less: Exempt Income',-c.exempt)}
    ${row(3,'Total Taxable Income',c.taxable,'total')}
    ${row(4,'Gross Tax (slab rates, tax-free limit '+formatMoney(c.free)+')',c.grossTax)}
    ${row(5,'Less: Allowable Rebate / Investment Credit',-c.rebate)}
    ${row(6,'Tax after Rebate (minimum tax '+formatMoney(c.minTax)+' applies)',c.afterRebate)}
    ${row(7,'Net Tax Liability',c.netTax,'total')}
    ${row(8,'Less: Tax Deducted / Paid (Tax Deduction page)',-c.deducted)}
    ${row(9,refund?'Net Tax Refundable':'Net Tax Payable',Math.abs(c.payable),'total')}
  </tbody></table>`;
  const wealth=`<table class="balance-table tax-table"><thead><tr><th>Sl.</th><th>Wealth Statement</th><th class="num">Amount</th></tr></thead><tbody>
    ${row(1,'Gross Wealth',c.grossWealth)}${row(2,'Total Liabilities Outside Business',c.liabilities)}${row('3=1-2','Net Wealth',c.netWealth,'total')}
    ${row(4,'Net Wealth at the Last Date of Previous Income Year ('+esc(c.prev)+')',c.prevNet)}${row('5=3-4','Change in Net Wealth',c.change)}
    ${row(6,'Other Fund Outflow During Income Year',c.outflow)}${row('7=5+6','Total Fund Outflow',c.totalOutflow,'total')}
    ${row(8,'Source of Fund',c.source)}${row(9,'Difference',c.difference,'total')}
  </tbody></table>`;
  const param=(key,label,def,note)=>`<tr><td>${label}<div class="hint">${note}</div></td><td class="num">${taxInput('params',key,String(def),taxYr(fy).params[key]??null)}</td></tr>`;
  const params=`<table class="tax-table"><tbody>${param('taxFree','Tax-free income limit',c.free,'Slabs after it: 10% / 15% / 20% / 25% / 30%')}${param('minTax','Minimum tax',c.minTax,'Applies when taxable income exceeds the limit')}${param('exempt','Exempt income',c.exemptDefault,'Default: 1/3 of salary income, up to '+formatMoney(500000))}${param('prevNet','Net wealth, previous year end',c.prevNetDefault,'Default: Balance Sheet of '+esc(c.prev))}</tbody></table>`;
  return `<div class="cards-grid tax-cards">${cards}</div>
  <div class="charts-grid tax-grid"><div class="card"><div class="section-heading"><h3>Tax Computation ${esc(fy)}</h3></div><div class="table-wrap">${computation}</div></div>
  <div class="card"><div class="section-heading"><h3>Income Tax Summary ${esc(fy)}</h3></div><div class="table-wrap">${wealth}</div></div></div>
  <div class="card"><div class="section-heading"><h3>Tax Parameters (${esc(fy)})</h3><span class="hint">Leave empty to use the default. Rebate = lowest of 15% of eligible investment, 3% of taxable income and ${formatMoney(1000000)}.</span></div><div class="table-wrap">${params}</div></div>`;
}
function taxViewLedger(fy,type){
  const L=taxLedger(fy,type),set=type==='Income'?'incomeOv':'expenseOv',list=type==='Income'?'incomeAdj':'expenseAdj';
  const body=L.groups.map(g=>`<tr class="cat-row"><td colspan="2">${esc(g.majorHead)}</td>${taxMoneyCell(g.app)}<td class="num">${formatMoney(g.total)}</td></tr>`+g.cats.map(c=>`<tr class="sub-row"><td>${esc(c.name)}</td><td class="num">${c.count}</td>${taxMoneyCell(c.app)}<td class="num">${taxInput(set,c.key,c.app.toFixed(2),c.ov)}</td></tr>`).join('')).join('');
  const txRows=L.txs.map(r=>`<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.category||'')} › ${esc(r.subcategory||'')}</td><td>${esc(r.description||'')}</td>${taxMoneyCell(taxNum(r.amount))}<td class="num">${taxAct('editTx','Edit',`data-id="${esc(r.id)}"`)}</td></tr>`).join('');
  return `<div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>${type==='Income'?'Fiscal Year Income':'Fiscal Year Expenses'} ${esc(fy)}</h3><p>Enter a tax-return value to override a category total for this year only.</p></div><div class="tt-actions">${taxAct('addTx','+ Add '+type,`data-type="${type}"`,'btn btn-primary')}</div></div>
    <div class="table-wrap"><table class="tax-table"><thead><tr><th>Head / Category</th><th class="num">Entries</th><th class="num">Per records</th><th class="num">Tax return value</th></tr></thead><tbody>${body||'<tr><td colspan="4" class="hint">No entries in this Financial Year</td></tr>'}
    <tr class="total"><td colspan="3">Total ${type}</td><td class="num">${formatMoney(L.total)}</td></tr>
    <tr class="total"><td colspan="3">Total incl. adjustments (${formatMoney(L.adjTotal)})</td><td class="num">${formatMoney(L.grand)}</td></tr></tbody></table></div></div>
    ${taxAdjTable(list,L.adj)}
    <div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>Transactions</h3><p>${L.txs.length} entr${L.txs.length===1?'y':'ies'}</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Details</th><th class="num">Amount</th><th></th></tr></thead><tbody>${txRows||'<tr><td colspan="5" class="hint">No transactions</td></tr>'}</tbody></table></div></div>`;
}
function taxViewRebate(fy){
  const c=taxCompute(fy);
  const rows=c.reb.map((r,i)=>`<tr><td>4.${i}</td><td>${esc(r.label)}</td><td class="num">${r.auto===null?'<span class="hint">Manual</span>':formatMoney(r.auto)}</td><td class="num">${taxInput('rebate',r.key,r.auto===null?'0.00':r.auto.toFixed(2),r.ov)}</td>${taxMoneyCell(r.value)}</tr>`).join('');
  return `<div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>Rebate ${esc(fy)} · Investment From Company</h3><p>Auto-filled from Assets & Liabilities › Investments for this Financial Year; type a value to override.</p></div></div>
  <div class="table-wrap"><table class="tax-table"><thead><tr><th>Sl.</th><th>Particulars</th><th class="num">Per records</th><th class="num">Override</th><th class="num">Eligible</th></tr></thead><tbody>${rows}<tr class="total"><td colspan="4">Total Eligible Investment</td><td class="num">${formatMoney(c.eligible)}</td></tr><tr class="total"><td colspan="4">Tax Rebate (15%, capped at 3% of taxable income)</td><td class="num">${formatMoney(c.rebate)}</td></tr></tbody></table></div></div>`;
}
function taxViewAssets(fy){
  const A=taxAssets(fy);
  const section=(title,s,type)=>`<div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>${title} · ${esc(fy)}</h3></div><div class="tt-actions">${taxAct('addItem','+ Add',`data-tax-list="assetAdj" data-kind="${type}"`)}</div></div><div class="table-wrap"><table class="tax-table"><thead><tr><th>Category / Subcategory</th><th class="num">Per records</th><th class="num">Tax return value</th></tr></thead><tbody>`+
    s.cats.map(c=>`<tr class="cat-row"><td colspan="2">${esc(c.name)}</td><td class="num">${formatMoney(c.total)}</td></tr>`+c.subs.map(x=>`<tr class="sub-row"><td>${esc(x.name)}</td>${taxMoneyCell(x.app)}<td class="num">${taxInput('assetOv',x.key,x.app.toFixed(2),x.ov)}</td></tr>`).join('')).join('')+
    s.adj.map(a=>`<tr class="sub-row"><td>${esc(a.label)} <span class="badge">Adjustment</span></td><td></td><td class="num">${formatMoney(taxNum(a.amount))} ${taxAct('editItem','Edit',`data-tax-list="assetAdj" data-id="${esc(a.id)}"`)} ${taxAct('delItem','×',`data-tax-list="assetAdj" data-id="${esc(a.id)}" aria-label="Delete adjustment"`,'btn btn-danger')}</td></tr>`).join('')+
    `<tr class="total"><td colspan="2">Total ${title}</td><td class="num">${formatMoney(s.total)}</td></tr></tbody></table></div></div>`;
  return section('Assets',A.assets,'Asset')+section('Liabilities',A.liabilities,'Liability')+`<div class="card"><table class="balance-table"><tbody><tr class="total net-worth-row"><td>NET WEALTH</td><td>${formatMoney(A.net)}</td></tr></tbody></table></div>`;
}
function taxViewDeduction(fy){
  const D=taxDeductions(fy);
  const linked=D.linked.map(x=>`<tr><td><input type="checkbox" data-tax-excl="${esc(x.id)}" ${x.included?'checked':''} aria-label="Include in tax deducted"></td><td>${esc(fmtDate(x.date))}</td><td>${esc(x.label)}</td><td>${esc(x.note)}</td>${taxMoneyCell(x.amount)}<td class="num">${taxAct('editTx','Edit',`data-id="${esc(x.id)}"`)}</td></tr>`).join('');
  const manual=TAX_SECTIONS.map(sec=>{
    const items=D.manual.filter(x=>(x.section||TAX_SECTIONS[5])===sec);
    if(!items.length)return '';
    return `<tr class="cat-row"><td colspan="7">${esc(sec)}</td></tr>`+items.map(x=>`<tr><td>${x.particulars?`<b>${esc(x.particulars)}</b> \u00b7 `:''}${esc(x.authority||'')}</td><td>${esc(x.docType||'')}</td><td>${esc(x.ref||'')}</td><td>${esc(fmtDate(x.date))}</td>${taxMoneyCell(taxNum(x.certAmount))}${taxMoneyCell(taxNum(x.claimed))}<td class="num">${taxDocButtons(x)} ${taxAct('editItem','Edit',`data-tax-list="deductions" data-id="${esc(x.id)}"`)} ${taxAct('delItem','Delete',`data-tax-list="deductions" data-id="${esc(x.id)}"`,'btn btn-danger')}</td></tr>`).join('');
  }).join('');
  return `<div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>Tax Deduction ${esc(fy)}</h3><p>Total deducted: <b>${formatMoney(D.total)}</b> (feeds the Income Tax Dashboard)</p></div><div class="tt-actions">${taxAct('addItem','+ Add Deduction','data-tax-list="deductions"','btn btn-primary')}</div></div>
  <div class="table-wrap"><table class="tax-table"><thead><tr><th>Authority</th><th>Document</th><th>Challan / Ref.</th><th>Date</th><th class="num">Challan Amount</th><th class="num">Claimed</th><th></th></tr></thead><tbody>${manual||'<tr><td colspan="7" class="hint">No manual rows</td></tr>'}<tr class="total"><td colspan="5">Total manual rows</td><td class="num">${formatMoney(D.manualTotal)}</td><td></td></tr></tbody></table></div></div>
  <div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>Linked from Income & Expenses</h3><p>Tax, Charges, Etc. Paid › Tax & Surcharge. Untick a row to leave it out of the total.</p></div></div>
  <div class="table-wrap"><table class="tax-table"><thead><tr><th>Use</th><th>Date</th><th>Type</th><th>Details</th><th class="num">Amount</th><th></th></tr></thead><tbody>${linked||'<tr><td colspan="6" class="hint">No linked entries in this Financial Year</td></tr>'}<tr class="total"><td colspan="4">Total linked</td><td class="num">${formatMoney(D.linkedTotal)}</td><td></td></tr></tbody></table></div></div>`;
}
function renderIncomeTax(){
  const page=document.getElementById('incomeTaxPage');
  if(!page)return;
  const years=taxYears();
  if(!taxYear||!years.includes(taxYear)){
    let saved='';try{saved=localStorage.getItem(SITE.prefix+'-tax-year')||''}catch(e){}
    taxYear=years.includes(saved)?saved:(years.includes('2025-26')?'2025-26':years[0]||'');
  }
  $el('taxYearSelect').innerHTML=years.map(y=>`<option value="${esc(y)}" ${y===taxYear?'selected':''}>${esc(y)}</option>`).join('');
  const range=fiscalRange(taxYear);
  $el('taxYearRange').textContent=range?`${fmtDate(range.from)} to ${fmtDate(range.to)}`:'';
  page.querySelectorAll('[data-tax-tab]').forEach(b=>{const on=b.dataset.taxTab===taxTab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1});
  ['taxFullExcelBtn','taxFullPdfBtn'].forEach(id=>$el(id).classList.toggle('hidden',taxTab!=='dashboard'));
  updateTaxSaveBtn();
  const views={dashboard:taxViewDashboard,income:f=>taxViewLedger(f,'Income'),expenses:f=>taxViewLedger(f,'Expense'),rebate:taxViewRebate,assets:taxViewAssets,deduction:taxViewDeduction};
  $el('taxBody').innerHTML=taxYear?(views[taxTab]||views.dashboard)(taxYear):'<div class="card"><p class="hint">Add an Income Year in Settings first.</p></div>';
}
/* ---------- Excel / PDF export (every tab, plus a full Dashboard summary) ---------- */
const TAX_TAB_LABELS={dashboard:'Income Tax Dashboard',income:'Fiscal Year Income',expenses:'Fiscal Year Expenses',rebate:'Rebate',assets:'Asset & Liabilities',deduction:'Tax Deduction'};
function taxSections(tab,fy){
  const B=r=>{r.b=true;return r};
  if(tab==='dashboard'){
    const c=taxCompute(fy),refund=c.payable<0;
    return [
      {title:'Tax Computation',head:['Sl.','Particulars','Amount'],money:[2],rows:[
        [1,'Total Income (Fiscal Year Income)',c.inc.grand],[2,'Less: Exempt Income',-c.exempt],B([3,'Total Taxable Income',c.taxable]),
        [4,'Gross Tax',c.grossTax],[5,'Less: Allowable Rebate / Investment Credit',-c.rebate],[6,'Tax after Rebate (minimum tax applied below)',c.afterRebate],
        B([7,'Net Tax Liability',c.netTax]),[8,'Less: Tax Deducted / Paid',-c.deducted],B([9,refund?'Net Tax Refundable':'Net Tax Payable',Math.abs(c.payable)])]},
      {title:'Income Tax Summary (Wealth Statement)',head:['Sl.','Particulars','Amount'],money:[2],rows:[
        [1,'Gross Wealth',c.grossWealth],[2,'Total Liabilities Outside Business',c.liabilities],B(['3=1-2','Net Wealth',c.netWealth]),
        [4,'Net Wealth at the Last Date of Previous Income Year ('+c.prev+')',c.prevNet],['5=3-4','Change in Net Wealth',c.change],
        [6,'Other Fund Outflow During Income Year',c.outflow],B(['7=5+6','Total Fund Outflow',c.totalOutflow]),[8,'Source of Fund',c.source],B([9,'Difference',c.difference])]},
      {title:'Tax Parameters Used',head:['Parameter','Value'],money:[1],rows:[['Tax-free income limit',c.free],['Minimum tax',c.minTax],['Exempt income',c.exempt],['Eligible investment',c.eligible]]}
    ];
  }
  if(tab==='income'||tab==='expenses'){
    const type=tab==='income'?'Income':'Expense',L=taxLedger(fy,type),rows=[];
    L.groups.forEach(g=>{rows.push(B([g.majorHead,'','',g.app,g.total]));g.cats.forEach(c=>rows.push(['',c.name,c.count,c.app,c.eff]))});
    rows.push(B(['Total '+type,'','',L.app,L.total]),B(['Total incl. adjustments','','','',L.grand]));
    return [
      {title:TAX_TAB_LABELS[tab],catSummary:type,head:['Head','Category','Entries','Per records','Tax return value'],money:[3,4],rows},
      {title:type+' Tax-only Adjustments',head:['Description','Amount'],money:[1],rows:[...L.adj.map(a=>[a.label,taxNum(a.amount)]),B(['Total adjustments',L.adjTotal])]},
      {title:type+' Transactions',pdfFullSkip:true,head:['Date','Category','Subcategory','Details','Amount'],money:[4],rows:L.txs.map(r=>[fmtDate(r.date),r.category||'',r.subcategory||'',r.description||'',taxNum(r.amount)])}
    ];
  }
  if(tab==='rebate'){
    const c=taxCompute(fy);
    return [{title:'Rebate - Investment From Company',head:['Sl.','Particulars','Per records','Override','Eligible'],money:[2,3,4],rows:[
      ...c.reb.map((r,i)=>['4.'+i,r.label,r.auto===null?'':r.auto,r.ov===null?'':r.ov,r.value]),
      B(['','Total Eligible Investment','','',c.eligible]),B(['','Tax Rebate','','',c.rebate])]}];
  }
  if(tab==='assets'){
    const A=taxAssets(fy);
    const sec=(title,s)=>{
      const rows=[];
      s.cats.forEach(c=>{rows.push(B([c.name,'','',c.total]));c.subs.forEach(x=>rows.push(['',x.name,x.app,x.eff]))});
      s.adj.forEach(a=>rows.push(['Adjustment: '+a.label,'','',taxNum(a.amount)]));
      rows.push(B(['Total '+title,'','',s.total]));
      return {title,head:['Category','Subcategory','Per records','Tax return value'],money:[2,3],rows};
    };
    return [sec('Assets',A.assets),sec('Liabilities',A.liabilities),{title:'Net Wealth',head:['Particulars','Amount'],money:[1],rows:[B(['Net Wealth',A.net])]}];
  }
  const D=taxDeductions(fy);
  return [
    {title:'Tax Deduction Ledger',head:['Section','Authority','Document','Challan / Ref.','Date','Challan Amount','Claimed'],money:[5,6],rows:[
      ...D.manual.map(x=>[x.section||TAX_SECTIONS[5],(x.particulars?x.particulars+' \u00b7 ':'')+(x.authority||''),x.docType||'',x.ref||'',fmtDate(x.date),taxNum(x.certAmount),taxNum(x.claimed)]),
      B(['Total manual rows','','','','','',D.manualTotal])]},
    {title:'Linked Tax Entries (Income & Expenses)',head:['Date','Type','Details','Amount','Included'],money:[3],rows:[
      ...D.linked.map(x=>[fmtDate(x.date),x.label,x.note,x.amount,x.included?'Yes':'No']),B(['Total linked (included)','','',D.linkedTotal,''])]},
    {title:'Total Tax Deducted',head:['Particulars','Amount'],money:[1],rows:[B(['Total Tax Deducted / Paid',D.total])]}
  ];
}
function taxExportGroups(tab){
  const tabs=tab==='all'?TAX_TABS:[tab];
  return tabs.map(t=>({tab:t,label:TAX_TAB_LABELS[t],sections:taxSections(t,taxYear)}));
}
function taxFileName(tab,ext){
  const slug=tab==='all'?'Full-Summary':TAX_TAB_LABELS[tab].replace(/[^A-Za-z0-9]+/g,'-');
  return `Income-Tax-${slug}-${taxYear}-${todayISO()}.${ext}`;
}
function taxExportExcel(tab){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  if(!taxYear)return;
  const wb=XLSX.utils.book_new(),used=new Set(),range=fiscalRange(taxYear);
  taxExportGroups(tab).forEach(g=>g.sections.forEach(s=>{
    const aoa=[[`Income Tax ${taxYear} - ${s.title}`],[range?`Financial Year ${fmtDate(range.from)} to ${fmtDate(range.to)}`:''],[],s.head,...s.rows.map(r=>[...r])];
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    s.rows.forEach((r,ri)=>s.money.forEach(ci=>{const cell=ws[XLSX.utils.encode_cell({r:4+ri,c:ci})];if(cell&&cell.t==='n')cell.z='#,##0.00'}));
    ws['!cols']=s.head.map((h,ci)=>({wch:Math.min(48,Math.max(String(h).length,...s.rows.map(r=>String(r[ci]??'').length))+2)}));
    let name=(tab==='all'?`${g.label} - ${s.title}`:s.title).replace(/[\\\/?*\[\]:]/g,' ').slice(0,31),n=2;
    while(used.has(name.toLowerCase())){name=name.slice(0,28)+' '+n++}
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb,ws,name);
  }));
  XLSX.writeFile(wb,taxFileName(tab,'xlsx'));
  toast('Excel report generated');
}
function taxCatSummary(type,fy){
  const L=taxLedger(fy,type),sec=buildIncomeBreakdown(L.txs)[type==='Income'?'income':'expense'];
  const acc=type==='Income'?[[236,253,245],[6,95,70]]:[[255,241,242],[159,18,57]];
  const R={halign:'right'},body=[];
  const subsOf=(head,cat)=>{const h=sec.heads.find(x=>x.name===head),c=h&&h.cats.find(x=>x.name===cat);return c?c.subs:[]};
  L.groups.forEach(g=>{
    body.push([{content:g.majorHead,styles:{fontStyle:'bold',fillColor:acc[0],textColor:acc[1]}},{content:pdfMoney(taxNum(g.app)),styles:{...R,fontStyle:'bold',fillColor:acc[0],textColor:acc[1]}},{content:pdfMoney(taxNum(g.total)),styles:{...R,fontStyle:'bold',fillColor:acc[0],textColor:acc[1]}}]);
    g.cats.forEach(c=>{
      body.push([{content:'  '+c.name,styles:{fontStyle:'bold'}},{content:pdfMoney(taxNum(c.app)),styles:R},{content:pdfMoney(taxNum(c.eff)),styles:R}]);
      subsOf(g.majorHead,c.name).forEach(x=>body.push([{content:'      '+x.name,styles:{textColor:[71,85,105]}},{content:pdfMoney(taxNum(x.total)),styles:{...R,textColor:[71,85,105]}},{content:'',styles:R}]));
    });
  });
  if(L.adjTotal)body.push([{content:'Tax-only adjustments',styles:{fontStyle:'bold'}},{content:pdfMoney(0),styles:R},{content:pdfMoney(L.adjTotal),styles:R}]);
  const tot={fontStyle:'bold',fillColor:acc[0],textColor:acc[1]};
  body.push([{content:`Total ${type==='Income'?'INCOME':'EXPENSES'}`,styles:tot},{content:pdfMoney(taxNum(L.app)),styles:{...tot,...R}},{content:pdfMoney(taxNum(L.grand)),styles:{...tot,...R}}]);
  return {body,total:L.grand,perRecord:L.app,empty:!L.groups.length&&!L.adjTotal};
}
function taxExportPdf(tab){
  const JsPDF=window.jspdf&&window.jspdf.jsPDF;
  if(!JsPDF){toast('PDF library is unavailable. Check your internet connection.',true);return}
  if(!taxYear)return;
  const doc=new JsPDF({orientation:'p',unit:'pt',format:'a4',compress:true});
  if(typeof doc.autoTable!=='function'){toast('PDF table plugin is unavailable. Check your internet connection.',true);return}
  const M=36,W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),range=fiscalRange(taxYear),stamp=generatedStamp();
  const title=tab==='all'?'Income Tax Full Summary':TAX_TAB_LABELS[tab];
  doc.setProperties({title:`Personal Finance - ${title} ${taxYear}`,creator:'SOIKOT RAIHAN'});
  const header=()=>{
    doc.setFillColor(79,70,229);doc.rect(0,0,W,42,'F');doc.setFillColor(16,185,129);doc.rect(0,42,W,3,'F');
    doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(13);
    doc.text(`Personal Finance  |  ${title}  |  ${taxYear}`,M,27);
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.text(`Generated ${stamp}`,W-M,27,{align:'right'});
  };
  header();
  doc.setTextColor(100,116,139);doc.setFontSize(8.5);
  doc.text(range?`Financial Year ${fmtDate(range.from)} to ${fmtDate(range.to)}`:'',M,60);
  let y=76,kpiDone=false;
  taxExportGroups(tab).forEach(g=>{
    if(tab==='all'){
      if(y>H-110){doc.addPage();y=64}
      doc.setTextColor(49,46,129);doc.setFont('helvetica','bold');doc.setFontSize(12.5);doc.text(g.label,M,y);y+=14;
    }
    g.sections.filter(s=>!(tab==='all'&&s.pdfFullSkip)).forEach(s=>{
      if(y>H-100){doc.addPage();y=64}
      if(s.catSummary){
        const inc=taxCatSummary('Income',taxYear),exp=taxCatSummary('Expense',taxYear),mine=s.catSummary==='Income'?inc:exp;
        if(tab==='all'&&!kpiDone){
          kpiDone=true;
          const net=inc.total-exp.total,cell=(t,v,f,c)=>[{content:t,styles:{fillColor:f,textColor:c,fontStyle:'bold'}},{content:v,styles:{halign:'right',fillColor:f,textColor:c,fontStyle:'bold'}}];
          doc.autoTable({startY:y,theme:'grid',margin:{left:M,right:M,top:56,bottom:40},styles:{fontSize:9},columnStyles:{1:{cellWidth:120}},didDrawPage:()=>header(),body:[
            cell('Total Income',pdfMoney(inc.total),[236,253,245],[6,95,70]),cell('Total Expenses',pdfMoney(exp.total),[255,241,242],[159,18,57]),
            cell('Net Savings',pdfMoney(net),[238,242,255],[49,46,129]),cell('Savings Rate',(inc.total>0?net/inc.total*100:0).toFixed(1)+'%',[255,251,235],[146,64,14])]});
          y=doc.lastAutoTable.finalY+16;
        }
        if(mine.empty)return;
        if(y>H-100){doc.addPage();y=64}
        doc.autoTable({startY:y,theme:'grid',margin:{left:M,right:M,top:56,bottom:40},
          head:[['Particulars',{content:'Per records',styles:{halign:'right'}},{content:'Tax return value',styles:{halign:'right'}}]],body:mine.body,
          headStyles:{fillColor:[15,23,42],textColor:[255,255,255],fontStyle:'bold',fontSize:8.5},styles:{fontSize:8.5},
          columnStyles:{1:{cellWidth:100,halign:'right'},2:{cellWidth:110,halign:'right'}},didDrawPage:()=>header()});
        y=doc.lastAutoTable.finalY+16;
        return;
      }
      doc.setTextColor(30,41,59);doc.setFont('helvetica','bold');doc.setFontSize(10.5);doc.text(s.title,M,y);
      const body=s.rows.map(r=>r.map((v,i)=>{
        const isMoney=s.money.includes(i);
        const styles={halign:isMoney?'right':'left'};
        if(r.b){styles.fontStyle='bold';styles.fillColor=[238,242,255]}
        return {content:isMoney&&typeof v==='number'?pdfMoney(v):String(v??''),styles};
      }));
      doc.autoTable({startY:y+6,theme:'grid',margin:{left:M,right:M,top:56,bottom:40},head:[s.head],body:body.length?body:[[{content:'No data',colSpan:s.head.length}]],
        styles:{fontSize:8.5,cellPadding:4},headStyles:{fillColor:[79,70,229],textColor:255},
        didDrawPage:()=>header()});
      y=doc.lastAutoTable.finalY+20;
    });
  });
  const pages=doc.internal.getNumberOfPages();
  for(let i=1;i<=pages;i++){doc.setPage(i);doc.setTextColor(100,116,139);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(`Page ${i} of ${pages}`,W-M,H-18,{align:'right'})}
  doc.save(taxFileName(tab,'pdf'));
  toast('PDF report generated');
}

function bindIncomeTaxEvents(){
  const page=document.getElementById('incomeTaxPage');
  if(!page)return;
  $el('taxYearSelect').onchange=e=>{taxYear=e.target.value;try{localStorage.setItem(SITE.prefix+'-tax-year',taxYear)}catch(err){}renderIncomeTax()};
  $el('taxSaveBtn').onclick=async e=>{
    if(!taxDirty){toast('No changes to save');return}
    await runWithLoading(e.currentTarget,async()=>{await taxSave();renderIncomeTax();toast('Changes saved for '+taxYear)});
  };
  $el('taxExcelBtn').onclick=()=>taxExportExcel(taxTab);
  $el('taxPdfBtn').onclick=()=>taxExportPdf(taxTab);
  $el('taxFullExcelBtn').onclick=()=>taxExportExcel('all');
  $el('taxFullPdfBtn').onclick=()=>taxExportPdf('all');
  $el('taxTabs').onclick=e=>{const b=e.target.closest('[data-tax-tab]');if(b&&TAX_TABS.includes(b.dataset.taxTab)){taxTab=b.dataset.taxTab;renderIncomeTax()}};
  page.addEventListener('change',async e=>{
    const t=taxYr(taxYear);
    const input=e.target.closest('[data-tax-set]');
    if(input){
      const bucket=t[input.dataset.taxSet];
      if(input.value==='')delete bucket[input.dataset.taxKey];else bucket[input.dataset.taxKey]=Number(input.value);
      taxDirty=true;renderIncomeTax();return;
    }
    const box=e.target.closest('[data-tax-excl]');
    if(box){
      const id=box.dataset.taxExcl;
      t.excluded=t.excluded.filter(x=>x!==id);
      if(!box.checked)t.excluded.push(id);
      taxDirty=true;renderIncomeTax();
    }
  });
  page.addEventListener('click',async e=>{
    const b=e.target.closest('[data-tax-act]');
    if(!b)return;
    const act=b.dataset.taxAct,id=b.dataset.id,list=b.dataset.taxList;
    if(act==='editTx')openIncomeModal(id);
    else if(act==='addTx'){
      openIncomeModal(null,{type:b.dataset.type});
      const r=fiscalRange(taxYear),today=todayISO();
      if(r)$el('incomeDate').value=today>=r.from&&today<=r.to?today:r.to;
    }
    else if(act==='addItem')await taxEditItem(list,null,b.dataset.kind);
    else if(act==='editItem')await taxEditItem(list,id);
    else if(act==='delItem'){
      if(!await confirm('Delete this row for '+taxYear+'?','Delete Row'))return;
      const t=taxYr(taxYear);
      if(list==='deductions'){const it=t.deductions.find(x=>x.id===id);if(it)await taxRemoveDocs(it)}
      t[list]=t[list].filter(x=>x.id!==id);
      await taxSave();renderIncomeTax();
    }
  });
}

/* ==========================================================================
   Income Tax workbook (IT Summary): import / template / export.
   Imported figures live in taxYr(fy).itReturn inside the single "incomeTax" settings row
   (IndexedDB "settings" store), so they persist across reloads and travel with Backup /
   Restore and Google Drive sync. Sheets: Summary, Exependiture, Source of Fund, Rebate,
   Assets, Liabilities, Tax Deduction - one FY per workbook (title "... 2025-26"), FY-suffixed
   sheets ("Summary 2025-26") or a "Fiscal Year" / "Income Year" column.
   ========================================================================== */
const IT_KINDS=[['summary',/^summary/],['expenses',/^(exependiture|expenditure|expenses?)/],['income',/^(sourceoffund|sourceofincome|income)/],['rebate',/^rebate/],['assets',/^assets/],['liabilities',/^liabilit/],['deduction',/^(taxdeduction|deduction)/]];
const IT_SHEET_NAMES={summary:'Summary',expenses:'Exependiture',income:'Source of Fund',rebate:'Rebate',assets:'Assets',liabilities:'Liabilities',deduction:'Tax Deduction'};
const IT_EMPLOYMENT='Income From Employment';
const IT_LIFESTYLE='Lifestyle Expenses';
const IT_TAXPAY='Tax at Source, Surcharge and Other Payments';
const IT_DED_TITLES={'Adjustment of Tax Refund':'Adjustment of Tax Refund','IT Deducted at Source from Salary':'IT Deducted at Source from Salary [Section-86]','IT Deducted at Source from WPPF':'IT Deducted at Source from WPPF [Section-88]','IT Deducted at Source from Honorarium':'IT Deducted at Source from Honorarium [Section-90]','Bank TDS':'Bank TDS','Advance Tax / Other':'Advance Tax / Other'};
const IT_DED_HEAD=['Month/Particulars','Depositing Authority','Payment Document Type','Challan/ Certificate Reference No.','Challan/ Certificate Date','Challan/ Certificate Amount','Claimed Amount'];
const IT_DED_HEADS={'Adjustment of Tax Refund':['Assessment Year','Return Register No. / Reference No.','Date of Submission of Return','Return Filling Zone','Return Filling Circle','Refund Amount','Adjustment Claim Amount'],'Bank TDS':['Bank Name','Account Type','Branch Name','Account Number','Interest Amount','TDS']};
const IT_MAX_ROWS_NOTE='Add a Financial Year first.';

const itBlank=v=>v===null||v===undefined||(typeof v==='string'&&!v.trim());
const itIsNum=v=>typeof v==='number'?Number.isFinite(v):(typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v.replace(/,/g,''))));
const itNum=v=>itIsNum(v)?(typeof v==='number'?v:Number(v.replace(/,/g,''))):0;
const itText=v=>itBlank(v)?'':String(v).replace(/\s+/g,' ').trim();
const itRound=n=>Math.round(n*100)/100;
const itSum=(list,fn)=>itRound(list.reduce((s,x)=>s+taxNum(fn(x)),0));
function itKind(name){
  const n=String(name||'').toLowerCase().replace(/\d{4}\s*[-\u2013_/]\s*\d{2,4}/g,'').replace(/[^a-z]/g,'');
  const hit=IT_KINDS.find(([,re])=>re.test(n));
  return hit?hit[0]:'';
}
function itYearIn(text){
  const m=/(\d{4})\s*[-\u2013_/]\s*(\d{4}|\d{2})/.exec(String(text||''));
  if(!m)return '';
  const y=normIncomeYear(`${m[1]}-${m[2]}`),p=parseIncomeYear(y);
  return p&&!p.plain?y:'';
}
function itDateISO(v){
  if(itBlank(v))return '';
  if(v instanceof Date&&!isNaN(v))return `${v.getFullYear()}-${pad2(v.getMonth()+1)}-${pad2(v.getDate())}`;
  if(typeof v==='number'&&v>20000&&v<90000)return new Date(Math.round((v-25569)*86400)*1000).toISOString().slice(0,10);
  const s=String(v).trim();
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if(m)return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
  return '';
}
const itTitleRow=r=>{
  const a=r[0];
  return typeof a==='string'&&!itBlank(a)&&!/^(sl\.?\s*n[o0]|no\b|date|reference|month|purpose|assessment|bank name|total)/i.test(a.trim())&&r.slice(1,7).every(itBlank);
};
function itBody(rows){
  const list=rows.map(r=>r||[]);
  const i=list.findIndex(r=>r.some(c=>!itBlank(c)));
  if(i<0)return [];
  const first=list[i],one=first.filter(c=>!itBlank(c)).length===1&&typeof first[0]==='string'&&itYearIn(first[0]);
  return list.slice(one?i+1:i);
}

/* ---------- Reading ---------- */
async function itReadWorkbook(file){
  if(/\.csv$/i.test(file.name||''))return XLSX.read(await file.text(),{type:'string',raw:true});
  return XLSX.read(await file.arrayBuffer(),{type:'array'});
}
function itCollect(workbook,fileName,forced){
  const out=new Map(),fileYear=itYearIn(fileName),single=workbook.SheetNames.length===1;
  workbook.SheetNames.forEach(sheetName=>{
    let kind=itKind(sheetName);
    if(!kind&&single)kind=itKind(String(fileName||'').replace(/\.[^.]+$/,''));
    if(!kind)return;
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,raw:true,defval:null,blankrows:true});
    const title=rows.slice(0,3).map(r=>(r||[]).find(c=>typeof c==='string'&&itYearIn(c))||'').find(Boolean)||'';
    const strong=itYearIn(sheetName)||itYearIn(title);
    const store=(fy,list)=>{if(!fy)return;if(!out.has(fy))out.set(fy,{});out.get(fy)[kind]=list};
    let fyCol=-1,head=-1;
    for(let i=0;i<Math.min(rows.length,8)&&fyCol<0;i++)(rows[i]||[]).forEach((c,j)=>{if(fyCol<0&&typeof c==='string'&&/^(fiscal year|income year|financial year|fy)$/i.test(c.trim())){fyCol=j;head=i}});
    if(fyCol>=0){
      const groups=new Map();let cur='';
      rows.slice(head+1).forEach(r=>{
        r=(r||[]).slice();
        const y=itYearIn(r[fyCol]);
        if(y)cur=y;
        r.splice(fyCol,1);
        if(cur&&(!forced||cur===forced)){if(!groups.has(cur))groups.set(cur,[]);groups.get(cur).push(r)}
      });
      groups.forEach((list,fy)=>store(fy,list));
      return;
    }
    store(forced?(strong&&strong!==forced?'':forced):(strong||fileYear),rows);
  });
  return out;
}

/* ---------- Sheet parsers ---------- */
function itParseSummary(rows){
  const s={};
  itBody(rows).forEach(r=>{
    const label=itText(r[1]).toLowerCase();
    if(!label||!itIsNum(r[2]))return;
    const v=itNum(r[2]);
    if(/previous/.test(label))s.prevNet=v;
    else if(/change/.test(label))s.change=v;
    else if(/other fund outflow/.test(label))s.otherOutflow=v;
    else if(/total fund outflow/.test(label))s.totalOutflow=v;
    else if(/source of fund/.test(label))s.source=v;
    else if(/difference/.test(label))s.difference=v;
    else if(/liabilit/.test(label))s.liabilities=v;
    else if(/net wealth/.test(label))s.netWealth=v;
    else if(/gross wealth/.test(label))s.grossWealth=v;
  });
  return s;
}
function itParseIncome(rows){
  const out=[];let head=IT_EMPLOYMENT;
  itBody(rows).forEach(r=>{
    if(itTitleRow(r)){head=itText(r[0]);return}
    if(/^total/i.test(itText(r[0]))||/^total/i.test(itText(r[1])))return;
    const label=itText(r[1]);
    if(!label||!itIsNum(r[2]))return;
    out.push({sl:itText(r[0]),head,label,amount:itNum(r[2])});
  });
  return out;
}
function itParseExpenses(rows){
  const data=[];let head=IT_LIFESTYLE;
  itBody(rows).forEach(r=>{
    const first=itText(r[0]);
    if(itTitleRow(r)){head=first;return}
    if(/^total/i.test(first)){if(/lifestyle/i.test(first))head=IT_TAXPAY;return}
    if(/^sl\.?\s*n[o0]/i.test(first))return;
    const label=itText(r[1]);
    if(!label)return;
    data.push({sl:first,head,label,c:itIsNum(r[2])?itNum(r[2]):null,d:itIsNum(r[3])?itNum(r[3]):null});
  });
  const isChild=d=>/^\d+\.\d+$/.test(d.sl);
  const out=[];
  [...new Set(data.map(d=>d.head))].forEach(h=>{
    const list=data.filter(d=>d.head===h);
    list.forEach(d=>{
      if(isChild(d)){
        const parentSl=d.sl.split('.')[0],parent=list.find(p=>!isChild(p)&&p.sl===parentSl);
        if(d.c===null&&d.d===null)return;
        out.push({sl:d.sl,head:h,parent:parent?parent.label:'',label:d.label,amount:d.c!==null?d.c:d.d});
      }else{
        const kids=list.some(k=>isChild(k)&&k.sl.split('.')[0]===d.sl);
        if(kids||(d.c===null&&d.d===null))return;
        out.push({sl:d.sl,head:h,parent:'',label:d.label,amount:d.d!==null?d.d:d.c});
      }
    });
  });
  return out;
}
function itParseRebate(rows){
  const out={};
  itBody(rows).forEach(r=>{
    const label=itText(r[1]).toLowerCase();
    if(!label||!itIsNum(r[2]))return;
    const key=/group/.test(label)?'groupIns':/pension/.test(label)?'pension':/welfare/.test(label)?'welfare':/c\.?p\.?f/.test(label)?(/company/.test(label)?'cpfCompany':'cpfOwn'):'';
    if(key)out[key]=itNum(r[2]);
  });
  return out;
}
function itUniqueKey(seen,key){
  const n=seen.get(key)||0;
  seen.set(key,n+1);
  return n?`${key}#${n+1}`:key;
}
function itParseAssets(rows){
  const out=[],seen=new Map();let cat='';
  itBody(rows).forEach(r=>{
    if(itTitleRow(r)){cat=itText(r[0]);return}
    if(!cat||/^total/i.test(itText(r[0]))||!itIsNum(r[6]))return;
    const raw=r.slice(0,6).map(v=>itBlank(v)?null:v);
    while(raw.length<6)raw.push(null);
    const acq=itText(/gold|diamond/i.test(cat)?raw[3]:/furniture|equipment|electronic/i.test(cat)?raw[4]:raw[2]);
    const name=itText(raw[1])||(/gold|diamond/i.test(cat)?`Gold, Diamond, Gems${raw[4]!==null?` (${raw[4]} ${itText(raw[5])})`:''}`:cat);
    const label=name+(acq?` (${acq})`:'');
    out.push({cat,name,label,key:itUniqueKey(seen,`Asset|${cat}|${label}`),amount:itNum(r[6]),raw});
  });
  return out;
}
function itParseLiabilities(rows){
  const out=[],seen=new Map();let cat='';
  itBody(rows).forEach(r=>{
    if(itTitleRow(r)){cat=itText(r[0]);return}
    if(!cat||/^total/i.test(itText(r[0]))||!itIsNum(r[4]))return;
    const raw=r.slice(0,4).map(v=>itBlank(v)?null:v);
    while(raw.length<4)raw.push(null);
    const name=itText(raw[1])||itText(raw[2])||cat;
    out.push({cat,name,label:name,key:itUniqueKey(seen,`Liability|${cat}|${name}`),amount:itNum(r[4]),raw});
  });
  return out;
}
function itDedSection(text){
  return /refund/i.test(text)?'Adjustment of Tax Refund':/salary/i.test(text)?'IT Deducted at Source from Salary':/wppf|bppf|section-?88/i.test(text)?'IT Deducted at Source from WPPF':/honorarium/i.test(text)?'IT Deducted at Source from Honorarium':/bank/i.test(text)?'Bank TDS':/advance|other/i.test(text)?'Advance Tax / Other':'';
}
function itParseDeductions(rows){
  const out=[];let sec='',auth='',part='';
  itBody(rows).forEach(r=>{
    const first=itText(r[0]);
    if(itTitleRow(r)){sec=itDedSection(first);auth='';part='';return}
    if(!sec||/^total/i.test(first)||/^(assessment year|month|purpose|bank name)/i.test(first))return;
    if(sec==='Adjustment of Tax Refund'){
      if(itBlank(r[1]))return;
      out.push({section:sec,particulars:first,authority:[itText(r[3]),itText(r[4])].filter(Boolean).join(' \u00b7 '),docType:'Tax Return',ref:itText(r[1]),date:itDateISO(r[2]),certAmount:itNum(r[5]),claimed:itNum(r[6])});
      return;
    }
    if(sec==='Bank TDS'){
      if(itBlank(r[3])&&!itIsNum(r[5]))return;
      out.push({section:sec,particulars:first,authority:itText(r[2]),docType:itText(r[1]),ref:itText(r[3]),date:'',certAmount:itNum(r[4]),claimed:itNum(r[5])});
      return;
    }
    if(!itBlank(r[0]))part=first;
    if(!itBlank(r[1]))auth=itText(r[1]);
    if(itBlank(r[3])&&!itIsNum(r[6]))return;
    out.push({section:sec,particulars:part,authority:auth,docType:itText(r[2]),ref:itText(r[3]),date:itDateISO(r[4]),certAmount:itNum(r[5]),claimed:itNum(r[6])});
  });
  return out;
}
function itParseWorkbook(workbook,fileName,forced){
  const out=new Map();
  itCollect(workbook,fileName,forced).forEach((b,fy)=>{
    const d={};
    if(b.summary)d.summary=itParseSummary(b.summary);
    if(b.income)d.income=itParseIncome(b.income);
    if(b.expenses)d.expenses=itParseExpenses(b.expenses);
    if(b.rebate)d.rebate=itParseRebate(b.rebate);
    if(b.assets)d.assets=itParseAssets(b.assets);
    if(b.liabilities)d.liabilities=itParseLiabilities(b.liabilities);
    if(b.deduction)d.deductions=itParseDeductions(b.deduction);
    out.set(fy,d);
  });
  return out;
}

/* ---------- Applying imported values to the FY ---------- */
function itMerge(oldList,newList,keyFn){
  const keys=new Set(newList.map(keyFn));
  return [...(oldList||[]).filter(x=>!keys.has(keyFn(x))),...newList];
}
async function itApplyYear(fy,d,opts){
  const t=taxYr(fy),old=t.itReturn||{},ret=opts.replace?{}:{...old};
  const mid=opts.migrationId||'';
  if(mid){['income','expenses','assets','liabilities'].forEach(k=>{if(Array.isArray(d[k]))d[k].forEach(x=>{x.migrationId=mid})});if(Array.isArray(d.deductions))d.deductions.forEach(x=>{x.migrationId=mid})}
  ret.version=1;ret.apply=!!opts.override;ret.source=opts.source;ret.updatedAt=new Date().toISOString();
  const keyed={income:r=>r.head+'|'+r.label,expenses:r=>r.head+'|'+r.label,assets:r=>r.key,liabilities:r=>r.key};
  Object.keys(keyed).forEach(k=>{if(d[k]!==undefined)ret[k]=opts.replace?d[k]:itMerge(old[k],d[k],keyed[k])});
  if(d.summary){ret.summary=opts.replace?d.summary:{...(old.summary||{}),...d.summary};if(mid)ret.summaryMig=mid}
  if(d.rebate){ret.rebate=opts.replace?d.rebate:{...(old.rebate||{}),...d.rebate};if(mid)ret.rebateMig=mid}
  t.itReturn=ret;
  if(d.rebate&&opts.override){
    if(opts.replace)TAX_INV.forEach(([k])=>{delete t.rebate[k]});
    Object.entries(d.rebate).forEach(([k,v])=>{t.rebate[k]=v});
  }
  if(d.deductions){
    const sig=x=>[x.section,x.particulars||'',x.ref||'',x.date||'',taxNum(x.claimed)].join('|');
    if(opts.replace)t.deductions=t.deductions.filter(x=>x.src!=='it');
    if(opts.override){
      const have=new Set(t.deductions.map(sig));
      d.deductions.forEach(x=>{if(!have.has(sig(x))){have.add(sig(x));t.deductions.push({id:uid('tax'),src:'it',...x})}});
      taxDeductions(fy).linked.forEach(x=>{if(!t.excluded.includes(x.id))t.excluded.push(x.id)});
    }
  }
  if(opts.override&&d.summary&&d.summary.prevNet!==undefined)t.params.prevNet=d.summary.prevNet;
  await taxSave();
}

/* ---------- Import popup ---------- */
const IT_HINT_OVERRIDE_ON='Ticked: imported lines become the Tax Return values on the Income Tax pages (Fiscal Year Income / Expenses, Rebate, Asset & Liabilities, Tax Deduction). Records are not changed.';
const IT_HINT_OVERRIDE_OFF='Unticked: the values are stored with the FY for reference only; the Income Tax pages keep using live app data.';
let itImportDraft=null;
let itReplaceMigrationId=null;   // set while re-importing into an existing IT migration batch
let itEditingMigrationId=null;   // batch open in the IT migration editor
const IT_MIGRATION_TYPE='Income Tax Workbook';
function setITImportFileLabel(file){
  const label=$el('itImportFileName'),clear=$el('itImportClear'),confirm=$el('itImportConfirm');
  if(label){
    if(file){label.textContent=`${file.name} \u00b7 ${formatFileSize(file.size)}`;label.title=file.name;label.classList.add('has-file')}
    else{label.textContent='No file chosen';label.removeAttribute('title');label.classList.remove('has-file')}
  }
  if(clear)clear.classList.toggle('hidden',!file);
  if(confirm)confirm.disabled=!file;
}
function updateITImportHints(){
  const box=$el('itImportOverride'),hint=$el('itImportOverrideHint');
  if(hint)hint.textContent=box&&box.checked?IT_HINT_OVERRIDE_ON:IT_HINT_OVERRIDE_OFF;
  const rep=$el('itImportReplace'),rh=$el('itImportReplaceHint');
  if(rh)rh.textContent=rep&&rep.checked?'Ticked: the FY\u2019s earlier imported tax-return values and imported deduction rows are replaced.':'Unticked: the file is merged into the FY; matching lines are updated, other lines are kept.';
}
function resetITImportDraft(){
  itImportDraft=null;itReplaceMigrationId=null;
  const input=$el('itImport');
  if(input)input.value='';
  setITImportFileLabel(null);
}
function openITImportModal(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  itImportDraft={file:null};
  const d=new Date(),start=d.getMonth()>=6?d.getFullYear():d.getFullYear()-1;
  const set=new Set(taxYears());
  for(let y=start+1;y>=start-2;y--)set.add(`${y}-${pad2((y+1)%100)}`);
  const years=[...set].sort((a,b)=>b.localeCompare(a));
  $el('itImportYear').innerHTML='<option value="">Auto-detect from sheet names / title</option>'+years.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');
  $el('itImportReplace').checked=true;
  $el('itImportOverride').checked=true;
  updateITImportHints();
  setITImportFileLabel(null);
  $el('itImportModal').showModal();
}
function itImportFileChosen(event){
  const input=event.target,file=input.files&&input.files[0];
  input.value='';
  if(!file)return;
  itImportDraft={file};
  setITImportFileLabel(file);
}
async function confirmITImport(){
  const draft=itImportDraft;
  if(!draft||!draft.file){toast('Choose an .xlsx, .xls or .csv IT workbook first.',true);return}
  if(draft.file.size>MAX_IMPORT_BYTES){toast('That file is larger than 30 MB. Split it and import the parts.',true);return}
  const button=$el('itImportConfirm');
  if(button){button.disabled=true;button.classList.add('loading')}
  try{
    const workbook=await itReadWorkbook(draft.file);
    const parsed=itParseWorkbook(workbook,draft.file.name,$el('itImportYear').value);
    if(!parsed.size){
      toast('No Income Tax sheets were found. Use the IT Summary sheets (Summary, Exependiture, Source of Fund, Rebate, Assets, Liabilities, Tax Deduction) with a 2025-26 style title, FY-suffixed names or a Fiscal Year column \u2014 or pick the Financial Year in this window.',true);
      return;
    }
    const replaceId=itReplaceMigrationId&&state.migrationHistory.find(m=>m.id===itReplaceMigrationId)?itReplaceMigrationId:null;
    const migrationId=replaceId||uid('mig');
    const opts={replace:$el('itImportReplace').checked,override:$el('itImportOverride').checked,source:draft.file.name,migrationId};
    if(replaceId)await itRemoveBatchData(replaceId);
    for(const [fy,data] of parsed)await itApplyYear(fy,data,opts);
    const years=[...parsed.keys()].sort();
    await itSaveMigrationMeta(migrationId,draft.file.name,years);
    taxYear=years[years.length-1];
    try{localStorage.setItem(SITE.prefix+'-tax-year',taxYear)}catch(e){}
    $el('itImportModal').close();
    renderITMigrationHistory();
    if(currentPage==='incomeTax')renderIncomeTax();
    toast(`Income Tax workbook imported for ${years.join(', ')}`);
  }catch(error){
    console.error(error);
    toast('Could not read that workbook'+(error.message?` \u2014 ${error.message}`:''),true);
  }finally{
    if(button){button.classList.remove('loading');button.disabled=!(itImportDraft&&itImportDraft.file)}
  }
}

/* ---------- IT migration batches (Settings → Income Tax Workbook history) ---------- */
function itBatchRows(id){
  const rows=[],years=(state.settings[TAX_KEY]||{}).years||{};
  Object.keys(years).sort().forEach(fy=>{
    const t=years[fy],r=t.itReturn;
    if(r){
      (r.income||[]).filter(x=>x.migrationId===id).forEach(x=>rows.push({fy,kind:'income',key:x.head+'|'+x.label,type:'Income',category:x.head,name:x.label,amount:taxNum(x.amount)}));
      (r.expenses||[]).filter(x=>x.migrationId===id).forEach(x=>rows.push({fy,kind:'expenses',key:x.head+'|'+x.label,type:'Expense',category:x.head,name:x.label,amount:taxNum(x.amount)}));
      (r.assets||[]).filter(x=>x.migrationId===id).forEach(x=>rows.push({fy,kind:'assets',key:x.key,type:'Asset',category:x.cat||'',name:x.label,amount:taxNum(x.amount)}));
      (r.liabilities||[]).filter(x=>x.migrationId===id).forEach(x=>rows.push({fy,kind:'liabilities',key:x.key,type:'Liability',category:x.cat||'',name:x.label,amount:taxNum(x.amount)}));
      if(r.rebateMig===id)Object.entries(r.rebate||{}).forEach(([k,v])=>rows.push({fy,kind:'rebate',key:k,type:'Rebate',category:'Rebate',name:(TAX_INV.find(i=>i[0]===k)||[k,k])[1],amount:taxNum(v)}));
      if(r.summaryMig===id)Object.entries(r.summary||{}).forEach(([k,v])=>rows.push({fy,kind:'summary',key:k,type:'Summary',category:'Summary',name:k,amount:taxNum(v)}));
    }
    (t.deductions||[]).filter(x=>x.src==='it'&&x.migrationId===id).forEach(x=>rows.push({fy,kind:'deductions',key:x.id,type:'Deduction',category:x.section||'',name:[x.particulars,x.authority].filter(Boolean).join(' \u00b7 '),amount:taxNum(x.claimed)}));
  });
  return rows;
}
function itRemoveRowData(fy,kind,key,id){
  const t=taxYr(fy),r=t.itReturn;
  if(kind==='deductions'){t.deductions=t.deductions.filter(x=>x.id!==key);return}
  if(!r)return;
  const keyed={income:x=>x.head+'|'+x.label,expenses:x=>x.head+'|'+x.label,assets:x=>x.key,liabilities:x=>x.key};
  if(keyed[kind])r[kind]=(r[kind]||[]).filter(x=>!(x.migrationId===id&&keyed[kind](x)===key));
  else if(kind==='rebate'&&r.rebate){delete r.rebate[key];delete t.rebate[key]}
  else if(kind==='summary'&&r.summary)delete r.summary[key];
}
function itTidyYear(fy){
  const t=taxYr(fy),r=t.itReturn;
  if(!r)return;
  const empty=['income','expenses','assets','liabilities'].every(k=>!(r[k]&&r[k].length))&&!Object.keys(r.rebate||{}).length&&!Object.keys(r.summary||{}).length;
  if(empty)delete t.itReturn;
}
async function itRemoveBatchData(id){
  const rows=itBatchRows(id);
  rows.forEach(x=>itRemoveRowData(x.fy,x.kind,x.key,id));
  new Set(rows.map(x=>x.fy)).forEach(itTidyYear);
  await taxSave();
}
async function itSaveMigrationMeta(id,fileName,years){
  const count=itBatchRows(id).length;
  const existing=state.migrationHistory.find(m=>m.id===id)||{id};
  await put('migrationHistory',Object.assign({},existing,{id,fileName,migrationType:IT_MIGRATION_TYPE,timestamp:new Date().toISOString(),importedCount:count,skippedCount:0,status:'completed',years}));
  await itRecountBatches();
}
async function itRecountBatches(){
  state.migrationHistory=await getAll('migrationHistory');
  for(const m of state.migrationHistory.filter(x=>x.migrationType===IT_MIGRATION_TYPE)){
    const n=itBatchRows(m.id).length;
    if(m.importedCount!==n){m.importedCount=n;await put('migrationHistory',m)}
  }
}
function renderITMigrationHistory(){
  const host=document.getElementById('itMigrationHistoryList');
  if(!host)return;
  const history=state.migrationHistory.filter(m=>m.migrationType===IT_MIGRATION_TYPE).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
  host.innerHTML=history.length
    ? `<div class="table-wrap migration-history-wrap"><table class="migration-history-table"><thead><tr><th scope="col">Date &amp; Time</th><th scope="col">File Name</th><th scope="col">Migration Type</th><th scope="col" class="num">Records Imported</th><th scope="col">Actions</th></tr></thead><tbody>${history.map(m=>`<tr><td>${esc(new Date(m.timestamp).toLocaleString())}</td><td>${esc(m.fileName||'\u2014')}</td><td><span class="badge migration-badge">${esc(m.migrationType||'\u2014')}</span></td><td class="num">${Number(m.importedCount)||0}</td><td class="actions-cell"><button type="button" class="action-link" data-cmd="edit-it-migration" data-id="${esc(m.id)}">Edit</button><button type="button" class="action-link danger" data-cmd="delete-it-migration" data-id="${esc(m.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state">No migrations recorded in this browser yet.</div>';
}
function renderITMigrationEditor(id){
  const mig=state.migrationHistory.find(m=>m.id===id);
  if(!mig)return;
  const rows=itBatchRows(id);
  $el('itMigrationEditTitle').textContent='Edit Migration';
  $el('itMigrationEditSubtitle').textContent=`${mig.migrationType} \u00b7 ${mig.fileName}`;
  $el('itMigrationEditMeta').textContent=`${rows.length} line(s) in this batch \u00b7 imported ${new Date(mig.timestamp).toLocaleString()}`;
  const cells=rows.map(x=>`<tr><td>${esc(x.fy)}</td><td><span class="badge">${esc(x.type)}</span></td><td>${esc(x.category)}</td><td>${esc(x.name)}</td><td class="num">${formatMoney(x.amount)}</td><td class="actions-cell"><button type="button" class="action-link danger" data-cmd="remove-it-migration-row" data-mig="${esc(id)}" data-cat="${esc(x.fy)}" data-store="${esc(x.kind)}" data-id="${esc(x.key)}">Remove</button></td></tr>`).join('');
  $el('itMigrationEditRows').innerHTML=rows.length
    ? `<div class="table-wrap"><table class="migration-edit-table"><thead><tr><th scope="col">FY</th><th scope="col">Type</th><th scope="col">Category</th><th scope="col">Particulars</th><th scope="col" class="num">Amount</th><th scope="col">Action</th></tr></thead><tbody>${cells}</tbody></table></div>`
    : '<div class="empty-state">No lines in this batch. Choose a replacement file to re-import.</div>';
}
function editITMigration(id){
  if(!state.migrationHistory.find(m=>m.id===id))return;
  itEditingMigrationId=id;
  renderITMigrationEditor(id);
  $el('itMigrationEditModal').showModal();
}
async function removeITMigrationRow(migId,fy,kind,key){
  itRemoveRowData(fy,kind,key,migId);
  itTidyYear(fy);
  await taxSave();
  await itRecountBatches();
  renderITMigrationEditor(migId);renderITMigrationHistory();
  if(currentPage==='incomeTax')renderIncomeTax();
  toast('Line removed from migration batch');
}
async function deleteITMigration(id){
  const mig=state.migrationHistory.find(m=>m.id===id);
  if(!mig)return;
  const count=itBatchRows(id).length;
  if(!(await confirm(`Delete migration "${mig.fileName}" and the ${count} line(s) it imported? This cannot be undone.`,'Delete Migration')))return;
  await itRemoveBatchData(id);
  await remove('migrationHistory',id);
  state.migrationHistory=await getAll('migrationHistory');
  renderITMigrationHistory();
  if(currentPage==='incomeTax')renderIncomeTax();
  toast(`Migration deleted (${count} line(s) removed)`);
}

/* ---------- Workbook model -> sheets (shared by Export and Template) ---------- */
const itAssetHead=name=>/furniture|equipment|electronic/i.test(name)?['Date','Particulars',null,null,'Type of Acquisition','Quantity','Value']
  :/provident|fund/i.test(name)&&!/cash/i.test(name)?['No','Particulars of the Fund',null,null,null,'Account No.','Balance Amount']
  :/cash/i.test(name)?['Date','Particulars',null,null,null,null,'Amount in BDT']
  :/gold|diamond|gem/i.test(name)?['Date','Particulars',null,'Type of Acquisition','Quantity at the End of the Income Year','Unit','Value']
  :/property/i.test(name)?['Date','Description and Location','Type of Acquisition','Area of the Property','Unit','Value at the Start of Income Year','Value at the End of Income Year']
  :['Date','Particulars',null,null,null,null,'Amount in BDT'];
const itLiabHead=name=>/unsecured/i.test(name)?['Date','Name of the Lender','TIN of the Lender','Purpose','Balance Amount']
  :/other/i.test(name)?['Date','Particulars of the Lender','Type of Loan','Other Detail','Balance Amount']
  :['Date','Name of the Bank/FI','Account Number','Purpose','Balance Amount'];
function itSheetAoas(fy,m){
  const out=[],sm=m.summary||{};
  out.push(['summary',[['Income Tax Summary '+fy],['Sl N0.','Particulars','Amount'],
    [1,'Gross Wealth',sm.grossWealth||0],[2,'Total Liabilities Outside Business',sm.liabilities||0],['3=1-2','Net Wealth',sm.netWealth||0],
    [4,'Net Wealth at the Last Date of Previous Income Year',sm.prevNet||0],['5=3-4','Change in Net Wealth',sm.change||0],
    [6,'Other Fund Outflow During Income Year',sm.otherOutflow||0],['7=5+6','Total Fund Outflow',sm.totalOutflow||0],
    [8,'Source of Fund',sm.source||0],[9,'Difference',sm.difference||0]]]);
  const inc=[['Income '+fy],['Sl. No','Income Head','Amount']],groups=m.income||[],main=groups.find(g=>g.head===IT_EMPLOYMENT);
  if(main){main.rows.forEach(r=>inc.push([r.sl||'',r.label,r.amount]));inc.push(['Total Income',null,itSum(main.rows,r=>r.amount)])}
  groups.filter(g=>g!==main).forEach(g=>{
    inc.push([],[g.head],['Sl. No','Income Head','Amount']);
    g.rows.forEach(r=>inc.push([r.sl||'',r.label,r.amount]));
    inc.push(['Total',null,itSum(g.rows,r=>r.amount)]);
  });
  inc.push([],['Total Source of Income',null,itSum(groups.flatMap(g=>g.rows),r=>r.amount)]);
  out.push(['income',inc]);
  const exp=[['Exependiture '+fy]];
  (m.expenses||[]).forEach(g=>{
    exp.push([],[g.head],['Sl. No','Particulars','Amount','Amount']);
    let n=0,last=null,pn=0,sub=0;
    g.rows.forEach(r=>{
      if(r.parent){
        if(r.parent!==last){
          n++;last=r.parent;sub=0;pn=r.sl?String(r.sl).split('.')[0]:n;
          exp.push([pn,r.parent,null,itSum(g.rows.filter(x=>x.parent===r.parent),x=>x.amount)]);
        }
        sub++;exp.push([r.sl||`${pn}.${sub}`,r.label,r.amount,null]);
      }else{last=null;n++;exp.push([r.sl||n,r.label,null,r.amount])}
    });
    exp.push(['Total '+g.head,null,null,itSum(g.rows,r=>r.amount)]);
  });
  exp.push([],['Total Fund Outflow',null,null,itSum((m.expenses||[]).flatMap(g=>g.rows),r=>r.amount)]);
  out.push(['expenses',exp]);
  const reb=[['Rebate '+fy],['Investment From Company'],['Sl. No','Particulars','Amount']];
  (m.rebate||[]).forEach((r,i)=>reb.push(['4.'+i,r.label,r.amount]));
  reb.push(['Total',null,itSum(m.rebate||[],r=>r.amount)]);
  out.push(['rebate',reb]);
  const as=[['Assets '+fy]];
  (m.assets||[]).forEach(c=>{
    as.push([],[c.name],itAssetHead(c.name));
    c.rows.forEach(r=>{const row=Array.from({length:7},(_,i)=>i<6?(r.raw[i]??null):null);row[6]=r.amount;as.push(row)});
    as.push(['Total',null,null,null,null,null,itSum(c.rows,r=>r.amount)]);
  });
  as.push([],['Total Assets',null,null,null,null,null,itSum((m.assets||[]).flatMap(c=>c.rows),r=>r.amount)]);
  out.push(['assets',as]);
  const li=[['Liabilities '+fy]];
  (m.liabilities||[]).forEach(c=>{
    li.push([],[c.name],itLiabHead(c.name));
    c.rows.forEach(r=>li.push([r.raw[0]??null,r.raw[1]??null,r.raw[2]??null,r.raw[3]??null,r.amount]));
    li.push(['Total',null,null,null,itSum(c.rows,r=>r.amount)]);
  });
  li.push([],['Total Liabilities',null,null,null,itSum((m.liabilities||[]).flatMap(c=>c.rows),r=>r.amount)]);
  out.push(['liabilities',li]);
  const ded=m.deductions||[],bySec=s=>ded.filter(x=>(x.section||TAX_SECTIONS[5])===s);
  const dd=[['Tax Deduction '+fy],['Sl. No','Particulars',null,null,'Amount']];
  TAX_SECTIONS.forEach((s,i)=>dd.push(['5.'+(i+1),s,null,null,itSum(bySec(s),x=>x.claimed)]));
  dd.push(['Total',null,null,null,itSum(ded,x=>x.claimed)]);
  TAX_SECTIONS.forEach(s=>{
    const items=bySec(s);
    dd.push([],[IT_DED_TITLES[s]||s],IT_DED_HEADS[s]||IT_DED_HEAD);
    items.forEach(x=>{
      if(s==='Adjustment of Tax Refund'){const [z,c]=String(x.authority||'').split(' \u00b7 ');dd.push([x.particulars||'',x.ref||'',x.date||'',z||'',c||'',taxNum(x.certAmount),taxNum(x.claimed)])}
      else if(s==='Bank TDS')dd.push([x.particulars||'',x.docType||'',x.authority||'',x.ref||'',taxNum(x.certAmount),taxNum(x.claimed)]);
      else dd.push([x.particulars||'',x.authority||'',x.docType||'',x.ref||'',x.date||'',taxNum(x.certAmount),taxNum(x.claimed)]);
    });
    if(s==='Bank TDS')dd.push(['Total',null,null,null,itSum(items,x=>x.certAmount),itSum(items,x=>x.claimed)]);
    else dd.push(['Total',null,null,null,null,itSum(items,x=>x.certAmount),itSum(items,x=>x.claimed)]);
  });
  out.push(['deduction',dd]);
  return out;
}
function itAppendSheets(wb,fy,model,suffixed){
  itSheetAoas(fy,model).forEach(([key,aoa])=>{
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    const width=Math.max(...aoa.map(r=>r.length));
    ws['!cols']=Array.from({length:width},(_,i)=>({wch:i===1?44:(i===0?30:20)}));
    XLSX.utils.book_append_sheet(wb,ws,suffixed?`${IT_SHEET_NAMES[key]} ${fy}`:IT_SHEET_NAMES[key]);
  });
}
function itDefaultYear(){
  const years=taxYears();
  if(taxYear&&years.includes(taxYear))return taxYear;
  let saved='';
  try{saved=localStorage.getItem(SITE.prefix+'-tax-year')||''}catch(e){}
  return years.includes(saved)?saved:(years.includes('2025-26')?'2025-26':years[0]||'');
}

/* ---------- Export: live app data + FY tax overrides / manual entries ---------- */
function itModelFromApp(fy){
  const c=taxCompute(fy),D=taxDeductions(fy);
  const ledger=L=>{
    const groups=L.groups.map(g=>({head:g.majorHead,rows:g.cats.map(x=>({sl:(x.meta&&x.meta.sl)||'',parent:(x.meta&&x.meta.parent)||'',label:x.name,amount:x.eff}))}));
    if(L.adj.length)groups.push({head:'Tax-only Adjustments',rows:L.adj.map(a=>({sl:'',parent:'',label:a.label,amount:taxNum(a.amount)}))});
    return groups;
  };
  const section=(s,width,prefix)=>{
    const cats=s.cats.map(cat=>({name:cat.name,rows:cat.subs.map(x=>({raw:x.src?x.src.raw:[null,x.name],amount:x.eff}))}));
    if(s.adj.length)cats.push({name:'Tax-only Adjustments',rows:s.adj.map(a=>({raw:[null,a.label],amount:taxNum(a.amount)}))});
    return cats;
  };
  return {
    summary:{grossWealth:c.grossWealth,liabilities:c.liabilities,netWealth:c.netWealth,prevNet:c.prevNet,change:c.change,otherOutflow:c.outflow,totalOutflow:c.totalOutflow,source:c.source,difference:c.difference},
    income:ledger(c.inc),
    expenses:ledger(c.exp),
    rebate:c.reb.map(r=>({label:r.label,amount:r.value})),
    assets:section(c.as.assets),
    liabilities:section(c.as.liabilities),
    deductions:[...D.manual,...D.linked.filter(x=>x.included).map(x=>({section:'Advance Tax / Other',particulars:x.label,authority:'Income & Expenses',docType:'Linked',ref:'Linked',date:x.date,certAmount:x.amount,claimed:x.amount}))]
  };
}
function exportITWorkbook(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const fy=itDefaultYear();
  if(!fy){toast(IT_MAX_ROWS_NOTE,true);return}
  const wb=XLSX.utils.book_new();
  itAppendSheets(wb,fy,itModelFromApp(fy),false);
  XLSX.writeFile(wb,`IT-Summary-${fy}-${todayISO()}.xlsx`);
  toast(`IT Summary workbook exported for ${fy}`);
}

/* ---------- Template: FY-suffixed sheets with the standard line items ---------- */
function itTemplateModel(){
  const L=(sl,label,extra)=>({sl,parent:'',label,amount:0,...(extra||{})});
  const C=(parent,sl,label)=>({sl,parent,label,amount:0});
  const A=(raw,name)=>({raw:[null,name,...raw],amount:0});
  return {
    summary:{},
    income:[
      {head:IT_EMPLOYMENT,rows:[['1.0','Basic Salary'],['1.1','House Rent Allowance'],['1.2','Conveyance Allowance'],['1.3','Medical Allowance'],['1.4','Gas Subsidy'],['1.5','Tiffin Allowance'],['1.6','Dearness Allowance'],['1.7','Education Allowance'],['1.8','Incentive/other Bonus'],['1.9','Festival Bonus'],['2.0','Noboborso Allowance'],['2.1','Recreation Leave'],['2.2','Entertainment Allowance'],['2.3','Washing Allowance'],['2.4','Shifting Allowance'],['2.5','Domestic Aid Allowance'],['2.6','Subsistence Allowance'],['2.7','Staff Over Allowance'],['2.8','Honorarium']].map(([sl,label])=>L(sl,label))},
      {head:'Income from Other Sources',rows:[L('','Payment from WPPF')]},
      {head:'Income From Financial Assets',rows:[L('','Basic Bank Interest')]},
      {head:'Income With CPF (Company)',rows:[L('','CPF (Company)')]},
      {head:'Other Receipts',rows:[L('','Other Income')]}
    ],
    expenses:[
      {head:IT_LIFESTYLE,rows:[L('1','Expenses for Food, Clothing and Other Essentials'),L('2','Accommodation Expense'),
        C('Auto and Transportation Expenses','3.1',"Driver's Salary, Fuel and Maintenance"),C('Auto and Transportation Expenses','3.2','Other Transportation'),
        C('Household and Utility Expenses','4.1','Electricity'),C('Household and Utility Expenses','4.2','Gas, Water, Sewer and Garbage'),C('Household and Utility Expenses','4.3','Phone, Internet, TV channels and Subscription'),C('Household and Utility Expenses','4.4','Home-Support Stuff and Other Expenses'),
        L('5','Education Expenses'),
        C('Festival And Other Special Expenses','6.1','Festival, Party, Events'),C('Festival And Other Special Expenses','6.2','Domestic and Overseas Tour, Holiday, Etc.'),C('Festival And Other Special Expenses','6.3','Philanthropy, Etc'),C('Festival And Other Special Expenses','6.4','Other Special Expenses'),
        L('7','Any Other Expenses')]},
      {head:IT_TAXPAY,rows:[L('8','Payment of Tax at Source'),L('9','Payment of Tax, Surcharge or Other Amounts'),L('10','Interest Payment of Personal Loan'),L('11','Environmental Surcharge')]},
      {head:'Loss, Deduction, Other Expense',rows:[L('1','Office Purchase & Bill')]},
      {head:'Gift, Donation and Contribution',rows:[L('1','Contribution For Family'),L('2','Gift For Wife')]}
    ],
    rebate:TAX_INV.map(([,label])=>({label,amount:0})),
    assets:[
      {name:'Furniture, Equipments and Electronic Items',rows:[A([null,null,'Purchased',null],'Electronic Items'),A([null,null,'Purchased',null],'Furniture'),A([null,null,'Purchased',null],'Equipments')]},
      {name:'Provident Fund and Other Fund',rows:[A([null,null,null,'#Account No.'],'C.P.F (Company)'),A([null,null,null,'#Account No.'],'C.P.F (Own)'),A([null,null,null,'#Account No.'],'Group Insurance Premium'),A([null,null,null,'#Account No.'],'Subscription to Welfare Fund (Own)')]},
      {name:'Cash and Fund outside Business',rows:[A([],'Notes, Currencies, Banks, Cards and Other Electronic Cash'),A([],'Cash in Hand Amount at the End of Income Year')]},
      {name:'Gold, Diamond, Gems and Other Items',rows:[A([null,'Purchased',null,'Gram'],'Gold')]},
      {name:'Non-Agricultural Property',rows:[]},
      {name:'Other Deposits, Balance and Advance',rows:[A([],'Deposit')]}
    ],
    liabilities:[{name:'Borrowing from Bank or Other FI',rows:[]},{name:'Unsecured Loan',rows:[]},{name:'Other Loan or Overdraft',rows:[]}],
    deductions:[]
  };
}
async function downloadITTemplate(){
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const base=itDefaultYear()||fiscalYearFromDate(todayISO())||'2025-26',p=parseIncomeYear(base),start=p?p.start:new Date().getFullYear();
  const wb=XLSX.utils.book_new();
  [`${start}-${pad2((start+1)%100)}`,`${start+1}-${pad2((start+2)%100)}`].forEach(fy=>itAppendSheets(wb,fy,itTemplateModel(),true));
  XLSX.writeFile(wb,`IT-Summary-Template-${todayISO()}.xlsx`);
  toast('Template downloaded \u2014 one set of FY-suffixed sheets per Financial Year');
}


init().catch(showFatal);
