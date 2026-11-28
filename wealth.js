/* ==========================================================================
   Wealth Purification  (Zakat page -> "Wealth Purification" -> Dubious Income | Haram Income)

   Loaded after app.js and uses its globals (state, put, remove, $el, esc, toast, confirm, ...).
   - Data lives in the protected `settings` store: key "wealthPurification" holds both ledgers,
     every attached PDF is a separate settings key (so saving a row never rewrites old PDFs).
   - Payments never write to the asset records. Their Cash & Bank movement is derived at read time
     (applyWealthPurificationLegs, called from effectiveRecordsForBalance) exactly like transfers,
     Income & Expenses and Office entries - editing / deleting a payment restores the account.
   - Outstanding = Due - Paid. It is recalculated on every render, so a payment lowers it at once.
   ========================================================================== */

const WP_KINDS={
  dubious:{key:'dubious',label:'Dubious Income',pct:'Dubious Income (%)',amt:'Dubious Income (BDT)',file:'Dubious-Income',
    blurb:'Part of an income that is doubtful (for example the interest share of a fund) - purify it by paying that share away.'},
  haram:{key:'haram',label:'Haram Income',pct:'Haram Income (%)',amt:'Haram Income (BDT)',file:'Haram-Income',
    blurb:'Income that is haram - the whole haram share must be given away as charity without expecting reward.'}
};
let wpView='zakat';          // 'zakat' | 'wealth'
let wpKind='dubious';        // 'dubious' | 'haram'
const wpFilter={year:'',search:''};
let wpShellReady=false;
let wpEntryDraft=null;       // modal state for the income row being edited
let wpPaymentDraft=null;     // modal state for the payment being edited

/* ---------- data ---------- */
function wpRoot(){
  const settings=state.settings||(state.settings={});
  if(!settings.wealthPurification||typeof settings.wealthPurification!=='object')settings.wealthPurification={};
  const root=settings.wealthPurification;
  Object.keys(WP_KINDS).forEach(kind=>{
    if(!root[kind]||typeof root[kind]!=='object')root[kind]={};
    if(!Array.isArray(root[kind].entries))root[kind].entries=[];
    if(!Array.isArray(root[kind].payments))root[kind].payments=[];
  });
  return root;
}
const wpData=(kind=wpKind)=>wpRoot()[kind];
async function wpSave(){await put('settings',{key:'wealthPurification',value:wpRoot()})}
const wpNum=value=>{const n=Number(value);return Number.isFinite(n)?n:0};
const wpMoney=value=>formatMoney(value);
const wpPlain=value=>(Number(value)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
/** Percent is stored as a fraction (0.2012 = 20.12%), the same as the Excel sheet. */
const wpPercentText=fraction=>`${Number((wpNum(fraction)*100).toFixed(2))}%`;
const wpEntryAmount=entry=>wpNum(entry.totalIncome)*wpNum(entry.percent);
const wpYearStart=year=>{const parsed=parseIncomeYear(year);return parsed?parsed.start:9999};
const wpYearSort=(a,b)=>wpYearStart(a)-wpYearStart(b)||String(a).localeCompare(String(b));
const wpEntryYear=entry=>String(entry.financialYear||fiscalYearFromDate(normalizeExcelDate(entry.date))||'').trim();
const wpPaymentYear=payment=>String(payment.financialYear||'').trim();
const wpDate=iso=>{const v=normalizeExcelDate(iso);return v?fmtDate(v):''};
function wpSortedEntries(kind){
  return wpData(kind).entries.slice().sort((a,b)=>String(normalizeExcelDate(a.date)).localeCompare(String(normalizeExcelDate(b.date)))||String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
}

/**
 * Due / paid / outstanding per Financial Year.
 *  - a payment tagged with a year reduces that year first;
 *  - an untagged ("General") payment, and any excess of a tagged one, clears the OLDEST unpaid year first;
 *  - what is left after every year is cleared is shown as an overpayment (not lost).
 */
function wpLedger(kind){
  const data=wpData(kind);
  const years=new Map();
  const yearRow=year=>{
    if(!years.has(year))years.set(year,{year,count:0,income:0,due:0,direct:0,auto:0});
    return years.get(year);
  };
  data.entries.forEach(entry=>{
    const row=yearRow(wpEntryYear(entry)||'—');
    row.count+=1;row.income+=wpNum(entry.totalIncome);row.due+=wpEntryAmount(entry);
  });
  let pool=0,paidTotal=0;
  data.payments.forEach(payment=>{
    const amount=Math.abs(wpNum(payment.amount));
    paidTotal+=amount;
    const year=wpPaymentYear(payment);
    if(year&&years.has(year))yearRow(year).direct+=amount;
    else pool+=amount;
  });
  const rows=[...years.values()].sort((a,b)=>wpYearSort(a.year,b.year));
  rows.forEach(row=>{
    const applied=Math.min(row.direct,row.due);
    pool+=row.direct-applied;
    row.direct=applied;
  });
  rows.forEach(row=>{
    const take=Math.min(Math.max(row.due-row.direct,0),pool);
    row.auto=take;pool-=take;
    row.paid=row.direct+row.auto;
    row.outstanding=Math.max(row.due-row.paid,0);
  });
  const sum=key=>rows.reduce((total,row)=>total+row[key],0);
  return {rows,totals:{count:sum('count'),income:sum('income'),due:sum('due'),paid:paidTotal,outstanding:sum('outstanding'),overpaid:Math.max(pool,0)}};
}

/* ---------- PDF attachments (one settings key per file) ---------- */
function wpFileData(meta){
  const stored=meta&&state.settings&&state.settings[meta.id];
  return stored&&typeof stored.data==='string'&&stored.data?stored:null;
}
async function wpStoreFile(file){
  const id=uid('wpfile');
  const value={name:file.name,type:file.type||'application/pdf',size:file.size,data:await blobToBase64(file)};
  await put('settings',{key:id,value});
  state.settings[id]=value;
  return {id,name:file.name,size:file.size};
}
async function wpDropFile(meta){
  if(!meta||!meta.id)return;
  try{await remove('settings',meta.id)}catch(error){console.warn('Attachment could not be removed',error)}
  delete state.settings[meta.id];
}
function wpFileDoc(source,fallbackName){
  try{
    let blob,name,size;
    if(source instanceof File){blob=asPdfBlob(source);name=source.name;size=source.size}
    else{
      const stored=wpFileData(source);
      if(!stored)return null;
      blob=asPdfBlob(base64ToBlob(String(stored.data).replace(/^data:[^,]*;base64,/i,'').replace(/\s/g,''),'application/pdf'));
      name=stored.name||fallbackName;size=Number(stored.size)||blob.size;
    }
    if(!blob||!blob.size)return null;
    const clean=String(name||fallbackName||'Document').split(/[\\/]/).pop().replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').replace(/\s+/g,'-')||'Document';
    return {blob,name:`${clean}.pdf`,size};
  }catch(error){console.error(error);return null}
}
async function wpOpenFile(source,download){
  const doc=wpFileDoc(source,'Wealth-Purification');
  if(!doc){toast('This PDF is not available on this device.',true);return}
  if(download)await saveFile(doc.blob,doc.name);else await openPdfViewer(doc);
}
function wpFileCell(meta,entryId,slot){
  if(!meta||!wpFileData(meta))return '<span class="hint">—</span>';
  return `<button type="button" class="action-link" data-wp-cmd="view-file" data-id="${esc(entryId)}" data-slot="${slot}" title="View ${esc(meta.name||'PDF')}">View</button> <button type="button" class="action-link" data-wp-cmd="download-file" data-id="${esc(entryId)}" data-slot="${slot}">Download</button>`;
}
const WP_SLOTS={income:{field:'incomeFile',label:'Income (File)'},statement:{field:'statementFile',label:'Income Statement (File)'}};

/* ---------- Cash & Bank accounts ---------- */
function wpAccountOptions(){
  const balances=new Map();
  try{transferAccounts().forEach(account=>balances.set(cashSubcategoryKey(account.subcategory),account.balance))}catch(error){console.warn(error)}
  return officeAccountChoices().map(label=>({label,balance:balances.has(cashSubcategoryKey(label))?balances.get(cashSubcategoryKey(label)):null}));
}

/**
 * Cash & Bank movement of every Wealth Purification payment: a payment deducts its amount from the
 * account it was paid from. Derived on the fly (same snapshot rules as the Income & Expenses legs),
 * so nothing is written into state.records and editing / deleting a payment restores the account.
 */
function applyWealthPurificationLegs(balanceRecords,year){
  const payments=[];
  Object.keys(WP_KINDS).forEach(kind=>wpData(kind).payments.forEach(payment=>{if(payment.account&&!payment.noAccountChange&&Math.abs(wpNum(payment.amount)))payments.push(payment)}));
  if(!payments.length)return balanceRecords;
  const index=officeAccountIndex();
  if(!index.size)return balanceRecords;
  const range=year?fiscalRange(year):null;
  const cutoff=range?range.to:'';
  const snapshots=new Map(),spelling=new Map();
  (balanceRecords||[]).forEach(record=>{
    if(!isCashRecord(record)||record.syntheticTransferLeg)return;
    const key=cashSubcategoryKey(record.subcategory);
    if(!spelling.has(key))spelling.set(key,String(record.subcategory||'').trim());
    const effective=cashEffectiveDate(record);
    const snapshot=snapshots.get(key);
    if(!snapshot||effective>snapshot.date)snapshots.set(key,{date:effective,savedAt:String(record.updatedAt||record.createdAt||'')});
  });
  const legs=[];
  for(const payment of payments){
    const account=index.get(officeAccountKey(payment.account));
    if(!account)continue;
    const date=normalizeExcelDate(payment.date)||String(payment.date||'').slice(0,10);
    if(cutoff&&date&&date>cutoff)continue;
    const key=cashSubcategoryKey(account.label);
    const snapshot=snapshots.get(key);
    if(snapshot&&snapshot.date&&date){
      if(date<snapshot.date)continue;
      if(date===snapshot.date&&snapshot.savedAt>=String(payment.updatedAt||payment.createdAt||''))continue;
    }
    const amount=-Math.abs(wpNum(payment.amount));
    legs.push({
      id:`${payment.id}::wealth`,syntheticTransferLeg:true,wealthPaymentId:payment.id,
      type:'Asset',category:account.category,subcategory:spelling.get(key)||account.label,
      particulars:'',accountDetail:'',date,incomeYear:fiscalYearFromDate(date)||'',
      amount,balance:amount,details:'',documentIds:[]
    });
  }
  return legs.length?[...balanceRecords,...legs]:balanceRecords;
}

/* ---------- shell: tabs on the Zakat page + the Wealth Purification view ---------- */
function wpEnsureShell(){
  const page=document.getElementById('zakatPage');
  if(!page||wpShellReady)return;
  const main=document.createElement('div');
  main.id='zakatMainView';
  while(page.firstChild)main.appendChild(page.firstChild);
  const tabs=document.createElement('div');
  tabs.className='wp-top-tabs';
  tabs.innerHTML=`<div class="income-tabs" role="tablist" aria-label="Wealth Purification">
    <button type="button" class="tab" data-wp-tab="zakat" role="tab">Zakat</button>
    <button type="button" class="tab" data-wp-tab="dubious" role="tab">Dubious Income</button>
    <button type="button" class="tab" data-wp-tab="haram" role="tab">Haram Income</button></div>`;
  const wealth=document.createElement('div');
  wealth.id='wealthView';
  wealth.className='hidden';
  page.append(tabs,main,wealth);
  wpBuildModals();
  page.addEventListener('click',wpHandleClick);
  page.addEventListener('input',wpHandleInput);
  page.addEventListener('change',wpHandleInput);
  wpShellReady=true;
}
function wpBuildModals(){
  if(document.getElementById('wpEntryModal'))return;
  const host=document.createElement('div');
  host.innerHTML=`
  <dialog id="wpEntryModal" class="modal modal-xl" aria-labelledby="wpEntryTitle">
    <form id="wpEntryForm" method="dialog" novalidate>
      <div class="modal-head"><div><h2 id="wpEntryTitle">Add Income</h2><p id="wpEntrySubtitle"></p></div><button type="button" class="close-btn" data-wp-close aria-label="Close">×</button></div>
      <div class="modal-body"><div class="zakat-form-grid" id="wpEntryFields"></div></div>
      <div class="modal-foot"><button type="button" class="btn" data-wp-close>Cancel</button><button type="submit" class="btn btn-primary" id="wpEntrySave">Save</button></div>
    </form>
  </dialog>
  <dialog id="wpPaymentModal" class="modal" aria-labelledby="wpPaymentTitle">
    <form id="wpPaymentForm" method="dialog" novalidate>
      <div class="modal-head"><div><h2 id="wpPaymentTitle">Make Payment</h2><p id="wpPaymentSubtitle"></p></div><button type="button" class="close-btn" data-wp-close aria-label="Close">×</button></div>
      <div class="modal-body"><div class="zakat-form-grid" id="wpPaymentFields"></div></div>
      <div class="modal-foot"><button type="button" class="btn" data-wp-close>Cancel</button><button type="submit" class="btn btn-primary" id="wpPaymentSave">Save Payment</button></div>
    </form>
  </dialog>
  <input type="file" id="wpImportFile" accept=".xlsx,.xls,.csv" hidden>`;
  while(host.firstChild)document.body.appendChild(host.firstChild);
  document.querySelectorAll('#wpEntryModal [data-wp-close],#wpPaymentModal [data-wp-close]').forEach(button=>{
    button.onclick=()=>button.closest('dialog').close();
  });
  document.getElementById('wpEntryForm').addEventListener('submit',event=>{event.preventDefault();wpSaveEntry()});
  document.getElementById('wpPaymentForm').addEventListener('submit',event=>{event.preventDefault();wpSavePayment()});
  document.getElementById('wpImportFile').onchange=wpImportChosen;
}

/* ---------- rendering ---------- */
function renderWealth(){
  wpEnsureShell();
  const page=document.getElementById('zakatPage');
  if(!page||!wpShellReady)return;
  page.querySelectorAll('[data-wp-tab]').forEach(tab=>{
    const active=tab.dataset.wpTab===(wpView==='zakat'?'zakat':wpKind);
    tab.classList.toggle('active',active);
    tab.setAttribute('aria-selected',String(active));
  });
  document.getElementById('zakatMainView').classList.toggle('hidden',wpView!=='zakat');
  const view=document.getElementById('wealthView');
  view.classList.toggle('hidden',wpView!=='wealth');
  if(wpView!=='wealth')return;
  const kind=WP_KINDS[wpKind];
  const years=[...new Set([...wpData().entries.map(wpEntryYear),...wpData().payments.map(wpPaymentYear)].filter(Boolean))].sort(wpYearSort);
  if(wpFilter.year&&!years.includes(wpFilter.year))wpFilter.year='';
  view.innerHTML=`
    <div class="zakat-dashboard-toolbar">
      <div><h3>${esc(kind.label)} Dashboard</h3><p>${esc(kind.blurb)}</p></div>
      <div class="tt-actions">
        <button type="button" class="btn" data-wp-cmd="import"><svg class="ic" aria-hidden="true"><use href="#i-sheet"/></svg><span>Import Excel</span></button>
        <button type="button" class="btn" data-wp-cmd="add-payment"><svg class="ic" aria-hidden="true"><use href="#i-up"/></svg><span>Make Payment</span></button>
        <button type="button" class="btn btn-primary" data-wp-cmd="add-entry"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg><span>Add ${esc(kind.label)}</span></button>
      </div>
    </div>
    <div class="filters card zakat-dashboard-filters"><div class="filter-row">
      <label>Financial Year<select id="wpFilterYear"><option value="">All Financial Years</option>${years.map(year=>`<option value="${esc(year)}"${year===wpFilter.year?' selected':''}>${esc(year)}</option>`).join('')}</select></label>
      <label>Search<input id="wpFilterSearch" type="search" placeholder="Income name or comment" value="${esc(wpFilter.search)}"></label>
      <button type="button" class="btn" data-wp-cmd="clear-filters">Clear filters</button>
    </div></div>
    <div id="wpBody"></div>`;
  wpRenderBody();
}
function wpFilteredEntries(){
  const needle=wpFilter.search.trim().toLowerCase();
  return wpSortedEntries(wpKind).filter(entry=>{
    if(wpFilter.year&&wpEntryYear(entry)!==wpFilter.year)return false;
    return !needle||`${entry.name||''} ${entry.comment||''}`.toLowerCase().includes(needle);
  });
}
function wpFilteredPayments(){
  return wpData().payments.filter(payment=>{
    if(!wpFilter.year)return true;
    return (wpPaymentYear(payment)||fiscalYearFromDate(normalizeExcelDate(payment.date)))===wpFilter.year;
  }).sort((a,b)=>String(normalizeExcelDate(b.date)).localeCompare(String(normalizeExcelDate(a.date)))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
function wpRenderBody(){
  const body=document.getElementById('wpBody');
  if(!body)return;
  const kind=WP_KINDS[wpKind];
  const ledger=wpLedger(wpKind);
  const entries=wpFilteredEntries();
  const payments=wpFilteredPayments();
  const rows=wpFilter.year?ledger.rows.filter(row=>row.year===wpFilter.year):ledger.rows;
  const sum=key=>rows.reduce((total,row)=>total+row[key],0);
  const totals=wpFilter.year
    ?{count:sum('count'),income:sum('income'),due:sum('due'),paid:sum('paid'),outstanding:sum('outstanding'),overpaid:0}
    :ledger.totals;
  const cards=[
    ['Income Entries',totals.count,'var(--primary-soft)','var(--primary-2)',false],
    ['Total Income',totals.income,'rgba(14,165,233,.12)','#0284c7',true],
    [`Total ${kind.label}`,totals.due,'rgba(245,158,11,.14)','#d97706',true],
    ['Paid',totals.paid,'var(--emerald-soft)','#059669',true],
    ['Outstanding',totals.outstanding,'var(--rose-soft)','#e11d48',true]
  ];
  if(totals.overpaid>0.004)cards.push(['Overpaid (advance)',totals.overpaid,'rgba(124,58,237,.14)','#7c3aed',true]);
  const card=(item,index)=>`<div class="summary-card" style="--i:${index};--kpi:${item[2]};--kpi-ink:${item[3]}"><div class="summary-icon">${icon(item[4]?'scale':'list')}</div><div><p>${esc(item[0])}</p><strong class="kpi-value">${item[4]?wpMoney(item[1]):item[1]}</strong></div></div>`;
  const yearRows=rows.map(row=>`<tr><td>${esc(row.year)}</td><td class="num">${row.count}</td><td class="num">${wpMoney(row.income)}</td><td class="num">${wpMoney(row.due)}</td><td class="num">${wpMoney(row.paid)}</td><td class="num"><b>${wpMoney(row.outstanding)}</b></td><td>${row.outstanding<0.005&&row.due>0?'<span class="badge income">Cleared</span>':row.due>0?'<span class="badge expense">Due</span>':''}</td></tr>`).join('');
  const entryRows=entries.map((entry,index)=>`<tr>
    <td>${index+1}</td><td>${esc(wpDate(entry.date))}</td><td>${esc(wpEntryYear(entry))}</td><td>${esc(entry.name||'')}</td>
    <td>${wpFileCell(entry.incomeFile,entry.id,'income')}</td>
    <td class="num">${wpMoney(entry.totalIncome)}</td><td class="num">${esc(wpPercentText(entry.percent))}</td><td class="num"><b>${wpMoney(wpEntryAmount(entry))}</b></td>
    <td class="wp-comment">${esc(entry.comment||'')}</td>
    <td>${wpFileCell(entry.statementFile,entry.id,'statement')}</td>
    <td class="wp-actions"><button type="button" class="action-link" data-wp-cmd="edit-entry" data-id="${esc(entry.id)}">Edit</button> <button type="button" class="action-link danger" data-wp-cmd="delete-entry" data-id="${esc(entry.id)}">Delete</button></td></tr>`).join('');
  const entryTotal=entries.reduce((total,entry)=>({income:total.income+wpNum(entry.totalIncome),amount:total.amount+wpEntryAmount(entry)}),{income:0,amount:0});
  const paymentRows=payments.map(payment=>`<tr>
    <td>${esc(wpDate(payment.date))}</td><td>${payment.noAccountChange?`${esc(payment.account||'')} <span class="hint">(account not changed)</span>`:`${esc(payment.account||'')}${officeAccountOption(payment.account)?'':' <span class="hint">(account removed)</span>'}`}</td>
    <td>${esc(wpPaymentYear(payment)||'General (oldest due first)')}</td><td class="num"><b>${wpMoney(payment.amount)}</b></td>
    <td class="wp-comment">${esc(payment.note||'')}</td><td>${wpFileCell(payment.receipt,payment.id,'receipt')}</td>
    <td class="wp-actions"><button type="button" class="action-link" data-wp-cmd="edit-payment" data-id="${esc(payment.id)}">Edit</button> <button type="button" class="action-link danger" data-wp-cmd="delete-payment" data-id="${esc(payment.id)}">Delete</button></td></tr>`).join('');
  const paymentTotal=payments.reduce((total,payment)=>total+Math.abs(wpNum(payment.amount)),0);
  body.innerHTML=`
    <div class="cards-grid zakat-dashboard-cards">${cards.map(card).join('')}</div>

    <div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>${esc(kind.label)} by Financial Year</h3><p>Payments lower the outstanding amount automatically</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Financial Year</th><th class="num">Entries</th><th class="num">Total Income</th><th class="num">${esc(kind.amt)}</th><th class="num">Paid</th><th class="num">Outstanding</th><th>Status</th></tr></thead>
      <tbody>${yearRows||`<tr><td colspan="7"><div class="empty-state">No ${esc(kind.label)} entries yet.</div></td></tr>`}</tbody></table></div></div>

    <div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>${esc(kind.label)} Statement</h3><p>${entries.length} entr${entries.length===1?'y':'ies'} match the filters</p></div>
      <div class="tt-actions">
        <button type="button" class="btn btn-xls" data-wp-cmd="export-excel"><svg class="ic" aria-hidden="true"><use href="#i-sheet"/></svg><span>Export Excel</span></button>
        <button type="button" class="btn btn-pdf" data-wp-cmd="export-pdf"><svg class="ic" aria-hidden="true"><use href="#i-file"/></svg><span>Export PDF Report</span></button></div></div>
      <div class="table-wrap"><table class="wp-table"><thead><tr><th>SL</th><th>Date</th><th>Financial Year</th><th>Income Name</th><th>Income (File)</th><th class="num">Total Income</th><th class="num">${esc(kind.pct)}</th><th class="num">${esc(kind.amt)}</th><th>Comment</th><th>Income Statement (File)</th><th>Actions</th></tr></thead>
      <tbody>${entryRows||`<tr><td colspan="11"><div class="empty-state">No ${esc(kind.label)} entries match the selected filters.</div></td></tr>`}</tbody>
      ${entries.length?`<tfoot><tr><th colspan="5">Total</th><th class="num">${wpMoney(entryTotal.income)}</th><th></th><th class="num">${wpMoney(entryTotal.amount)}</th><th colspan="3"></th></tr></tfoot>`:''}</table></div></div>

    <div class="card table-card"><div class="table-toolbar"><div class="tt-title"><h3>${esc(kind.label)} Payments</h3><p>${payments.length} payment${payments.length===1?'':'s'} · each one is deducted from the Cash &amp; Bank account it was paid from</p></div>
      <div class="tt-actions"><button type="button" class="btn btn-primary" data-wp-cmd="add-payment"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg><span>Make Payment</span></button></div></div>
      <div class="table-wrap"><table class="wp-table"><thead><tr><th>Date</th><th>Paid From (Cash &amp; Bank)</th><th>Against Financial Year</th><th class="num">Amount</th><th>Note</th><th>Receipt (PDF)</th><th>Actions</th></tr></thead>
      <tbody>${paymentRows||'<tr><td colspan="7"><div class="empty-state">No payments recorded.</div></td></tr>'}</tbody>
      ${payments.length?`<tfoot><tr><th colspan="3">Total Paid</th><th class="num">${wpMoney(paymentTotal)}</th><th colspan="3"></th></tr></tfoot>`:''}</table></div></div>`;
}

/* ---------- events ---------- */
function wpHandleInput(event){
  const target=event.target;
  if(target.id==='wpFilterYear'){wpFilter.year=target.value;wpRenderBody()}
  else if(target.id==='wpFilterSearch'&&event.type==='input'){wpFilter.search=target.value;wpRenderBody()}
}
async function wpHandleClick(event){
  const tab=event.target.closest('[data-wp-tab]');
  if(tab){
    const target=tab.dataset.wpTab;
    if(target==='zakat')wpView='zakat';
    else{wpView='wealth';if(wpKind!==target){wpKind=target;wpFilter.year='';wpFilter.search=''}}
    renderWealth();return;
  }
  const button=event.target.closest('[data-wp-cmd]');
  if(!button)return;
  const id=button.dataset.id;
  try{
    switch(button.dataset.wpCmd){
      case 'add-entry':wpOpenEntry();break;
      case 'edit-entry':wpOpenEntry(id);break;
      case 'delete-entry':await wpDeleteEntry(id);break;
      case 'add-payment':wpOpenPayment();break;
      case 'edit-payment':wpOpenPayment(id);break;
      case 'delete-payment':await wpDeletePayment(id);break;
      case 'view-file':case 'download-file':{
        const slot=button.dataset.slot;
        const owner=slot==='receipt'?wpData().payments.find(item=>item.id===id):wpData().entries.find(item=>item.id===id);
        const meta=owner&&(slot==='receipt'?owner.receipt:owner[WP_SLOTS[slot].field]);
        await wpOpenFile(meta,button.dataset.wpCmd==='download-file');
        break;
      }
      case 'clear-filters':wpFilter.year='';wpFilter.search='';renderWealth();break;
      case 'import':document.getElementById('wpImportFile').click();break;
      case 'export-excel':await runWithLoading(button,wpExportExcel);break;
      case 'export-pdf':await runWithLoading(button,wpExportPdf);break;
    }
  }catch(error){console.error(error);toast(error.message||'Something went wrong.',true)}
}
function bindWealthEvents(){wpEnsureShell();renderWealth()}

/* ---------- income entry modal ---------- */
function wpYearChoices(extra){
  const years=new Set((state.settings.incomeYears||[]).map(normIncomeYear).filter(Boolean));
  Object.keys(WP_KINDS).forEach(kind=>wpData(kind).entries.forEach(entry=>{const y=wpEntryYear(entry);if(y&&y!=='—')years.add(y)}));
  if(extra)years.add(extra);
  return [...years].sort(wpYearSort);
}
function wpFileField(slot,label,meta){
  return `<div class="wp-file-field" data-wp-file="${slot}"><span class="wp-file-label">${esc(label)}</span>
    <input type="file" accept="application/pdf,.pdf" hidden data-wp-file-input="${slot}">
    <div class="wp-file-row"><button type="button" class="btn" data-wp-pick="${slot}">Upload PDF</button>
      <span class="hint" data-wp-file-info="${slot}"></span>
      <button type="button" class="btn" data-wp-file-view="${slot}">View</button>
      <button type="button" class="btn" data-wp-file-remove="${slot}">Remove</button></div></div>`;
}
function wpOpenEntry(id){
  const kind=WP_KINDS[wpKind];
  const existing=id?wpData().entries.find(entry=>entry.id===id):null;
  if(id&&!existing){toast('Entry not found.',true);return}
  wpEntryDraft={id:existing?existing.id:null,yearTouched:!!existing,files:{}};
  Object.keys(WP_SLOTS).forEach(slot=>{wpEntryDraft.files[slot]={meta:existing?existing[WP_SLOTS[slot].field]||null:null,file:null,removed:false}});
  document.getElementById('wpEntryTitle').textContent=existing?`Edit ${kind.label}`:`Add ${kind.label}`;
  document.getElementById('wpEntrySubtitle').textContent=`Financial Year based ${kind.label} Statement`;
  const date=existing?normalizeExcelDate(existing.date):todayISO();
  const year=existing?wpEntryYear(existing):fiscalYearFromDate(date);
  const names=[...new Set(Object.keys(WP_KINDS).flatMap(key=>wpData(key).entries.map(entry=>entry.name)).filter(Boolean))];
  document.getElementById('wpEntryFields').innerHTML=`
    <label>Date<input id="wpfDate" type="date" value="${esc(date)}"></label>
    <label>Financial Year<select id="wpfYear">${wpYearChoices(year).map(item=>`<option value="${esc(item)}"${item===year?' selected':''}>${esc(item)}</option>`).join('')}</select></label>
    <label>Income Name<input id="wpfName" list="wpNameList" value="${esc(existing?existing.name:'')}" placeholder="e.g. BPPF (80)"><datalist id="wpNameList">${names.map(name=>`<option value="${esc(name)}">`).join('')}</datalist></label>
    <label>Total Income<input id="wpfTotal" type="number" min="0" step="0.01" value="${existing?wpNum(existing.totalIncome):''}"></label>
    <label>${esc(kind.pct)} - percent<input id="wpfPercent" type="number" min="0" max="100" step="0.0001" value="${existing?Number((wpNum(existing.percent)*100).toFixed(4)):''}" placeholder="e.g. 20.12"></label>
    <label>${esc(kind.amt)} (auto)<input id="wpfAmount" type="text" readonly value="${existing?wpPlain(wpEntryAmount(existing)):'0.00'}"></label>
    <label style="grid-column:1/-1">Comment<textarea id="wpfComment" rows="3" placeholder="e.g. Total Net Profit: 1,409,709,912/-  Interest Income: 283,680,449/- (20.12%)">${esc(existing?existing.comment||'':'')}</textarea></label>
    ${wpFileField('income',WP_SLOTS.income.label)}${wpFileField('statement',WP_SLOTS.statement.label)}`;
  const fields=document.getElementById('wpEntryFields');
  const refreshAmount=()=>{
    document.getElementById('wpfAmount').value=wpPlain(wpNum(document.getElementById('wpfTotal').value)*wpNum(document.getElementById('wpfPercent').value)/100);
  };
  fields.querySelector('#wpfTotal').oninput=refreshAmount;
  fields.querySelector('#wpfPercent').oninput=refreshAmount;
  fields.querySelector('#wpfYear').onchange=()=>{wpEntryDraft.yearTouched=true};
  fields.querySelector('#wpfDate').onchange=event=>{
    if(wpEntryDraft.yearTouched)return;
    const derived=fiscalYearFromDate(event.target.value);
    const select=document.getElementById('wpfYear');
    if(derived&&![...select.options].some(option=>option.value===derived))select.add(new Option(derived,derived));
    if(derived)select.value=derived;
  };
  Object.keys(WP_SLOTS).forEach(slot=>wpBindFileField(fields,wpEntryDraft.files[slot],slot));
  document.getElementById('wpEntryModal').showModal();
}
/** Wires one PDF slot (upload / view / remove) of a form; `state` is the staged {meta,file,removed}. */
function wpBindFileField(root,staged,slot){
  const input=root.querySelector(`[data-wp-file-input="${slot}"]`);
  const info=root.querySelector(`[data-wp-file-info="${slot}"]`);
  const viewButton=root.querySelector(`[data-wp-file-view="${slot}"]`);
  const removeButton=root.querySelector(`[data-wp-file-remove="${slot}"]`);
  const refresh=()=>{
    const hasNew=!!staged.file;
    const hasOld=!!staged.meta&&!staged.removed;
    info.textContent=hasNew?`${staged.file.name} · ${formatFileSize(staged.file.size)} (will be saved)`:hasOld?`${staged.meta.name} · ${formatFileSize(Number(staged.meta.size)||0)}`:'No PDF attached';
    viewButton.classList.toggle('hidden',!(hasNew||hasOld&&wpFileData(staged.meta)));
    removeButton.classList.toggle('hidden',!(hasNew||hasOld));
  };
  root.querySelector(`[data-wp-pick="${slot}"]`).onclick=()=>input.click();
  input.onchange=()=>{
    const file=input.files&&input.files[0];if(!file)return;
    if(file.type!=='application/pdf'&&!String(file.name).toLowerCase().endsWith('.pdf')){toast('Please choose a PDF file.',true);input.value='';return}
    if(file.size>25*1024*1024){toast('The PDF must be 25 MB or smaller.',true);input.value='';return}
    staged.file=file;staged.removed=false;refresh();
  };
  viewButton.onclick=async()=>{try{await wpOpenFile(staged.file||staged.meta)}catch(error){console.error(error);toast('The PDF could not be opened.',true)}};
  removeButton.onclick=()=>{staged.file=null;staged.removed=true;input.value='';refresh()};
  refresh();
}
async function wpSaveEntry(){
  const kind=WP_KINDS[wpKind];
  const date=normalizeExcelDate(document.getElementById('wpfDate').value);
  const name=document.getElementById('wpfName').value.trim();
  const total=wpNum(document.getElementById('wpfTotal').value);
  const percentRaw=document.getElementById('wpfPercent').value;
  const percent=wpNum(percentRaw)/100;
  if(!date){toast('Please choose a date.',true);return}
  if(!name){toast('Please enter the income name.',true);return}
  if(!(total>0)){toast('Total income must be greater than zero.',true);return}
  if(percentRaw===''||percent<0||percent>1){toast(`${kind.pct} must be between 0 and 100.`,true);return}
  const button=document.getElementById('wpEntrySave');
  button.disabled=true;
  try{
    const data=wpData();
    const existing=wpEntryDraft.id?data.entries.find(entry=>entry.id===wpEntryDraft.id):null;
    const entry=existing||{id:uid('wp-entry'),createdAt:new Date().toISOString()};
    for(const slot of Object.keys(WP_SLOTS)){
      const staged=wpEntryDraft.files[slot];
      const field=WP_SLOTS[slot].field;
      if(staged.file){
        const meta=await wpStoreFile(staged.file);
        if(entry[field])await wpDropFile(entry[field]);
        entry[field]=meta;
      }else if(staged.removed&&entry[field]){await wpDropFile(entry[field]);entry[field]=null}
    }
    Object.assign(entry,{
      date,financialYear:document.getElementById('wpfYear').value||fiscalYearFromDate(date),name,totalIncome:total,percent,
      comment:document.getElementById('wpfComment').value.trim(),updatedAt:new Date().toISOString()
    });
    if(!existing)data.entries.push(entry);
    await wpSave();
    document.getElementById('wpEntryModal').close();
    toast(existing?`${kind.label} updated`:`${kind.label} added`);
    renderWealth();
  }catch(error){console.error(error);toast('The entry could not be saved.',true)}
  finally{button.disabled=false}
}
async function wpDeleteEntry(id){
  const data=wpData();
  const entry=data.entries.find(item=>item.id===id);
  if(!entry)return;
  if(!await confirm(`Delete "${entry.name}" (${wpDate(entry.date)})? Its attached PDFs are deleted too.`,'Delete Entry'))return;
  await wpDropFile(entry.incomeFile);await wpDropFile(entry.statementFile);
  data.entries=data.entries.filter(item=>item.id!==id);
  wpRoot()[wpKind]=data;
  await wpSave();
  toast('Entry deleted');
  renderWealth();
}

/* ---------- payment modal ---------- */
function wpOpenPayment(id){
  const kind=WP_KINDS[wpKind];
  const existing=id?wpData().payments.find(payment=>payment.id===id):null;
  if(id&&!existing){toast('Payment not found.',true);return}
  const accounts=wpAccountOptions();
  if(!accounts.length){toast('Add a Cash & Bank account (Settings → Categories) before making a payment.',true);return}
  wpPaymentDraft={id:existing?existing.id:null,receipt:{meta:existing?existing.receipt||null:null,file:null,removed:false}};
  const ledger=wpLedger(wpKind);
  document.getElementById('wpPaymentTitle').textContent=existing?`Edit ${kind.label} Payment`:`Pay ${kind.label}`;
  document.getElementById('wpPaymentSubtitle').textContent=`Outstanding now: ${wpMoney(ledger.totals.outstanding)}`;
  const selectedAccount=existing?officeAccountKey(existing.account):'';
  const years=wpYearChoices(existing?wpPaymentYear(existing):'').filter(year=>wpData().entries.some(entry=>wpEntryYear(entry)===year)||year===(existing&&wpPaymentYear(existing)));
  document.getElementById('wpPaymentFields').innerHTML=`
    <label>Date<input id="wppDate" type="date" value="${esc(existing?normalizeExcelDate(existing.date):todayISO())}"></label>
    <label>Amount (BDT)<input id="wppAmount" type="number" min="0" step="0.01" value="${existing?Math.abs(wpNum(existing.amount)):''}" placeholder="${esc(String(Math.round(ledger.totals.outstanding*100)/100))}"></label>
    <label style="grid-column:1/-1">Paid From (Cash &amp; Bank Account)<select id="wppAccount"${existing&&existing.noAccountChange?' disabled':''}><option value="">Select account…</option>${accounts.map(account=>`<option value="${esc(account.label)}"${officeAccountKey(account.label)===selectedAccount?' selected':''}>${esc(account.label)}${account.balance===null?'':` — ${esc(wpMoney(account.balance))}`}</option>`).join('')}</select></label>
    <label class="office-account-check" style="grid-column:1/-1"><span class="office-check-row"><input type="checkbox" id="wppNoAccount"${existing&&existing.noAccountChange?' checked':''}><span>I Do not want to change Account</span></span><span class="hint">Unticked: this payment is deducted from the selected Cash &amp; Bank account. Ticked: only the outstanding ${esc(kind.label)} goes down; no account balance changes.</span></label>
    <label>Against Financial Year<select id="wppYear"><option value="">General (oldest due first)</option>${years.map(year=>`<option value="${esc(year)}"${existing&&wpPaymentYear(existing)===year?' selected':''}>${esc(year)}</option>`).join('')}</select></label>
    <label>Note<input id="wppNote" value="${esc(existing?existing.note||'':'')}" placeholder="Recipient / purpose"></label>
    ${wpFileField('receipt','Receipt (PDF, optional)')}
    <p class="hint" style="grid-column:1/-1">Saving deducts this amount from the selected account and lowers the outstanding ${esc(kind.label)}. Editing or deleting the payment restores both.</p>`;
  wpBindFileField(document.getElementById('wpPaymentFields'),wpPaymentDraft.receipt,'receipt');
  document.getElementById('wppNoAccount').onchange=event=>{document.getElementById('wppAccount').disabled=event.target.checked};
  document.getElementById('wpPaymentModal').showModal();
}
async function wpSavePayment(){
  const kind=WP_KINDS[wpKind];
  const date=normalizeExcelDate(document.getElementById('wppDate').value);
  const amount=wpNum(document.getElementById('wppAmount').value);
  const accountLabel=document.getElementById('wppAccount').value;
  if(!date){toast('Please choose a date.',true);return}
  if(!(amount>0)){toast('Enter a payment amount greater than zero.',true);return}
  const noAccount=document.getElementById('wppNoAccount').checked;
  if(!noAccount&&!accountLabel){toast('Select the Cash & Bank account the money was paid from.',true);return}
  const data=wpData();
  const existing=wpPaymentDraft.id?data.payments.find(payment=>payment.id===wpPaymentDraft.id):null;
  const ledger=wpLedger(wpKind);
  
  const option=wpAccountOptions().find(item=>item.label===accountLabel);
  if(!noAccount&&option&&option.balance!==null&&amount>option.balance+(existing&&officeAccountKey(existing.account)===officeAccountKey(accountLabel)?Math.abs(wpNum(existing.amount)):0)+0.004){
    if(!await confirm(`${accountLabel} only has ${wpMoney(option.balance)}. Record the payment anyway?`,'Insufficient Balance'))return;
  }
  const button=document.getElementById('wpPaymentSave');
  button.disabled=true;
  try{
    const payment=existing||{id:uid('wp-pay'),createdAt:new Date().toISOString()};
    const staged=wpPaymentDraft.receipt;
    if(staged.file){
      const meta=await wpStoreFile(staged.file);
      if(payment.receipt)await wpDropFile(payment.receipt);
      payment.receipt=meta;
    }else if(staged.removed&&payment.receipt){await wpDropFile(payment.receipt);payment.receipt=null}
    Object.assign(payment,{date,amount,account:noAccount?'':accountLabel,noAccountChange:noAccount,financialYear:document.getElementById('wppYear').value,note:document.getElementById('wppNote').value.trim(),updatedAt:new Date().toISOString()});
    if(!existing)data.payments.push(payment);
    await wpSave();
    document.getElementById('wpPaymentModal').close();
    const after=wpLedger(wpKind).totals;
    toast(`Payment saved · ${kind.label} outstanding ${wpMoney(after.outstanding)}`);
    renderAll();
  }catch(error){console.error(error);toast('The payment could not be saved.',true)}
  finally{button.disabled=false}
}
async function wpDeletePayment(id){
  const data=wpData();
  const payment=data.payments.find(item=>item.id===id);
  if(!payment)return;
  if(!await confirm(`Delete this ${wpMoney(payment.amount)} payment? ${payment.noAccountChange?'':`${payment.account||'The account'} gets the money back and `}The outstanding amount goes up again.`,'Delete Payment'))return;
  await wpDropFile(payment.receipt);
  data.payments=data.payments.filter(item=>item.id!==id);
  await wpSave();
  toast('Payment deleted');
  renderAll();
}

/* ---------- Excel import (same layout as the Dubious Income Statement sheet) ---------- */
const wpHeaderKey=value=>String(value??'').toLowerCase().replace(/[^a-z0-9%]+/g,' ').trim();
function wpParseSheetRows(aoa){
  let headerIndex=-1;
  for(let i=0;i<Math.min(aoa.length,30);i++){
    if((aoa[i]||[]).some(cell=>wpHeaderKey(cell)==='income name')){headerIndex=i;break}
  }
  if(headerIndex<0)throw new Error('Header row with "Income Name" was not found in this file.');
  const header=(aoa[headerIndex]||[]).map(wpHeaderKey);
  const find=test=>header.findIndex(text=>text&&test(text));
  const col={
    date:find(text=>text==='date'),
    year:find(text=>text.startsWith('financial year')),
    name:find(text=>text==='income name'),
    total:find(text=>text==='total income'),
    percent:find(text=>/(dubious|haram).*%|^percent/.test(text)),
    amount:find(text=>/(dubious|haram).*(bdt|amount)/.test(text)),
    comment:find(text=>/^comm/.test(text))
  };
  if(col.name<0||col.total<0)throw new Error('The sheet needs "Income Name" and "Total Income" columns.');
  const rows=[];
  for(let i=headerIndex+1;i<aoa.length;i++){
    const row=aoa[i]||[];
    const name=String(row[col.name]??'').trim();
    const total=Number(row[col.total]);
    if(!name||!Number.isFinite(total)||total<=0)continue;      // blank rows and the "Total" row
    const date=col.date>=0?normalizeExcelDate(row[col.date]):'';
    let percent=col.percent>=0&&row[col.percent]!==''?Number(row[col.percent]):NaN;
    if(Number.isFinite(percent)&&percent>1)percent/=100;
    if(!Number.isFinite(percent)&&col.amount>=0&&Number(row[col.amount])>0)percent=Number(row[col.amount])/total;
    if(!Number.isFinite(percent)||percent<0||percent>1)continue;
    const year=col.year>=0?normIncomeYear(String(row[col.year]??'').trim()):'';
    rows.push({date,financialYear:year||fiscalYearFromDate(date),name,totalIncome:total,percent,comment:col.comment>=0?String(row[col.comment]??'').trim():''});
  }
  return rows;
}
const wpEntryHash=entry=>[normalizeExcelDate(entry.date),wpEntryYear(entry),String(entry.name||'').trim().toLowerCase(),Math.round(wpNum(entry.totalIncome)*100)].join('|');
async function wpImportChosen(event){
  const input=event.target;
  const file=input.files&&input.files[0];
  input.value='';
  if(!file)return;
  try{
    if(!window.XLSX)throw new Error('Excel library is unavailable. Check your internet connection.');
    if(file.size>30*1024*1024)throw new Error('The workbook must be 30 MB or smaller.');
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'});
    const kind=WP_KINDS[wpKind];
    const sheetName=workbook.SheetNames.find(name=>name.toLowerCase().includes(kind.key))||workbook.SheetNames[0];
    const parsed=wpParseSheetRows(XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,raw:true,defval:''}));
    if(!parsed.length)throw new Error('No income rows were found in this file.');
    const data=wpData();
    const seen=new Set(data.entries.map(wpEntryHash));
    const fresh=parsed.filter(row=>{const hash=wpEntryHash(row);if(seen.has(hash))return false;seen.add(hash);return true});
    if(!fresh.length){toast(`Nothing new: all ${parsed.length} row(s) are already in ${kind.label}.`);return}
    if(!await confirm(`Import ${fresh.length} row(s) from "${sheetName}" into ${kind.label}?${parsed.length>fresh.length?` ${parsed.length-fresh.length} duplicate row(s) are skipped.`:''} PDFs are not part of an Excel file - attach them to each row afterwards.`,'Import Excel'))return;
    const now=new Date().toISOString();
    fresh.forEach(row=>data.entries.push({id:uid('wp-entry'),...row,incomeFile:null,statementFile:null,createdAt:now,updatedAt:now,imported:true}));
    await wpSave();
    toast(`Imported ${fresh.length} row(s)`);
    renderWealth();
  }catch(error){console.error(error);toast(error.message||'The file could not be imported.',true)}
}

/* ---------- reports ---------- */
function wpFilterText(){
  return [`${WP_KINDS[wpKind].label}`,`Financial Year: ${wpFilter.year||'All'}`,wpFilter.search?`Search: ${wpFilter.search}`:''].filter(Boolean).join(' | ');
}
function wpExportExcel(){
  const kind=WP_KINDS[wpKind];
  const entries=wpFilteredEntries(),payments=wpFilteredPayments();
  if(!entries.length&&!payments.length){toast('Nothing to export for the current filters.',true);return}
  if(!window.XLSX){toast('Excel library is unavailable. Check your internet connection.',true);return}
  const ledger=wpLedger(wpKind);
  const rows=wpFilter.year?ledger.rows.filter(row=>row.year===wpFilter.year):ledger.rows;
  const workbook=XLSX.utils.book_new();
  const head=['SL. No','Date','Financial Year','Income Name','Total Income',kind.pct,kind.amt,'Comment','Income (File)','Income Statement (File)'];
  const aoa=[[`Financial Year Base ${kind.label} Statement`],head];
  entries.forEach((entry,index)=>{
    const r=index+3;
    aoa.push([index+1,wpDate(entry.date),wpEntryYear(entry),entry.name||'',wpNum(entry.totalIncome),wpNum(entry.percent),{f:`E${r}*F${r}`,v:wpEntryAmount(entry)},entry.comment||'',entry.incomeFile?entry.incomeFile.name:'',entry.statementFile?entry.statementFile.name:'']);
  });
  const last=entries.length+2;
  aoa.push(['Total','','','',{f:`SUM(E3:E${last})`,v:entries.reduce((t,e)=>t+wpNum(e.totalIncome),0)},'',{f:`SUM(G3:G${last})`,v:entries.reduce((t,e)=>t+wpEntryAmount(e),0)},'','','']);
  const sheet=XLSX.utils.aoa_to_sheet(aoa);
  for(let r=3;r<=last;r++){
    if(sheet[`F${r}`])sheet[`F${r}`].z='0.00%';
    ['E','G'].forEach(c=>{if(sheet[`${c}${r}`])sheet[`${c}${r}`].z='#,##0.00'});
  }
  ['E','G'].forEach(c=>{if(sheet[`${c}${last+1}`])sheet[`${c}${last+1}`].z='#,##0.00'});
  sheet['!cols']=[{wch:8},{wch:12},{wch:14},{wch:20},{wch:16},{wch:16},{wch:20},{wch:60},{wch:30},{wch:30}];
  XLSX.utils.book_append_sheet(workbook,sheet,kind.label.slice(0,31));
  const summary=XLSX.utils.aoa_to_sheet([
    [`${kind.label} Summary`],[`Generated ${generatedStamp()}`],[wpFilterText()],[],
    ['Financial Year','Entries','Total Income',kind.amt,'Paid','Outstanding'],
    ...rows.map(row=>[row.year,row.count,row.income,row.due,row.paid,row.outstanding]),
    ['Total',rows.reduce((t,r)=>t+r.count,0),rows.reduce((t,r)=>t+r.income,0),rows.reduce((t,r)=>t+r.due,0),rows.reduce((t,r)=>t+r.paid,0),rows.reduce((t,r)=>t+r.outstanding,0)]
  ]);
  summary['!cols']=[{wch:16},{wch:10},{wch:18},{wch:22},{wch:18},{wch:18}];
  XLSX.utils.book_append_sheet(workbook,summary,'Summary');
  const paySheet=XLSX.utils.aoa_to_sheet([
    ['Date','Paid From (Cash & Bank)','Against Financial Year','Amount (BDT)','Note','Receipt (File)'],
    ...payments.map(payment=>[wpDate(payment.date),payment.account||'',wpPaymentYear(payment)||'General',Math.abs(wpNum(payment.amount)),payment.note||'',payment.receipt?payment.receipt.name:'']),
    ['Total','','',payments.reduce((t,p)=>t+Math.abs(wpNum(p.amount)),0),'','']
  ]);
  paySheet['!cols']=[{wch:12},{wch:26},{wch:22},{wch:16},{wch:40},{wch:30}];
  XLSX.utils.book_append_sheet(workbook,paySheet,'Payments');
  XLSX.writeFile(workbook,`${kind.file}-Report-${todayISO()}.xlsx`);
  toast(`${kind.label} Excel report exported`);
}
function wpExportPdf(){
  const kind=WP_KINDS[wpKind];
  const entries=wpFilteredEntries(),payments=wpFilteredPayments();
  if(!entries.length&&!payments.length){toast('Nothing to export for the current filters.',true);return}
  const JsPDF=window.jspdf&&window.jspdf.jsPDF;
  if(!JsPDF){toast('PDF library is unavailable. Check your internet connection.',true);return}
  const doc=new JsPDF({orientation:'landscape',unit:'pt',format:'a4',compress:true});
  if(typeof doc.autoTable!=='function'){toast('PDF table plugin is unavailable. Check your internet connection.',true);return}
  const ledger=wpLedger(wpKind);
  const rows=wpFilter.year?ledger.rows.filter(row=>row.year===wpFilter.year):ledger.rows;
  const sum=key=>rows.reduce((total,row)=>total+row[key],0);
  const margin=28,FOOT=26;
  const pageH=()=>doc.internal.pageSize.getHeight();
  doc.setProperties({title:`${kind.label} Report`,subject:wpFilterText(),creator:'Personal Finance'});
  doc.setFont('helvetica','bold');doc.setFontSize(16);doc.setTextColor(31,41,55);doc.text(`${kind.label} Statement`,margin,30);
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,116,139);
  doc.text(`Generated ${generatedStamp()} · ${entries.length} entr${entries.length===1?'y':'ies'}`,margin,44);
  doc.text(wpFilterText().replace(/\s*\|\s*/g,'   |   '),margin,56);
  const style={styles:{fontSize:7,cellPadding:3,overflow:'linebreak'},alternateRowStyles:{fillColor:[248,250,252]}};
  const entryTotal=entries.reduce((t,e)=>({income:t.income+wpNum(e.totalIncome),amount:t.amount+wpEntryAmount(e)}),{income:0,amount:0});
  doc.autoTable(Object.assign({
    startY:66,theme:'grid',margin:{left:margin,right:margin,top:66,bottom:FOOT},
    head:[['SL','Date','Financial Year','Income Name','Total Income (BDT)',kind.pct,`${kind.amt}`,'Comment','Income File','Statement File']],
    headStyles:{fillColor:[79,70,229],textColor:255,fontStyle:'bold',fontSize:7},
    body:entries.map((entry,index)=>[index+1,wpDate(entry.date),wpEntryYear(entry),entry.name||'',wpPlain(entry.totalIncome),wpPercentText(entry.percent),wpPlain(wpEntryAmount(entry)),entry.comment||'',entry.incomeFile?'Attached':'-',entry.statementFile?'Attached':'-']),
    foot:[['Total','','','',wpPlain(entryTotal.income),'',wpPlain(entryTotal.amount),'','','']],
    footStyles:{fillColor:[238,242,255],textColor:[30,41,59],fontStyle:'bold',fontSize:7},
    columnStyles:{0:{cellWidth:24},1:{cellWidth:52},2:{cellWidth:54},3:{cellWidth:78},4:{cellWidth:70,halign:'right'},5:{cellWidth:44,halign:'right'},6:{cellWidth:72,halign:'right'},7:{cellWidth:'auto'},8:{cellWidth:44},9:{cellWidth:48}}
  },style));
  let y=doc.lastAutoTable.finalY+20;
  if(y+90>pageH()-FOOT){doc.addPage();y=44}
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(31,41,55);doc.text('Summary by Financial Year',margin,y);
  doc.autoTable(Object.assign({
    startY:y+8,theme:'grid',margin:{left:margin,right:margin,top:66,bottom:FOOT},
    head:[['Financial Year','Entries','Total Income (BDT)',`${kind.amt}`,'Paid (BDT)','Outstanding (BDT)']],
    headStyles:{fillColor:[245,158,11],textColor:255,fontStyle:'bold',fontSize:7},
    body:rows.map(row=>[row.year,row.count,wpPlain(row.income),wpPlain(row.due),wpPlain(row.paid),wpPlain(row.outstanding)]),
    foot:[['Total',sum('count'),wpPlain(sum('income')),wpPlain(sum('due')),wpPlain(sum('paid')),wpPlain(sum('outstanding'))]],
    footStyles:{fillColor:[255,247,237],textColor:[30,41,59],fontStyle:'bold',fontSize:7},
    columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'}}
  },style));
  if(payments.length){
    y=doc.lastAutoTable.finalY+20;
    if(y+80>pageH()-FOOT){doc.addPage();y=44}
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(31,41,55);doc.text('Payments',margin,y);
    doc.autoTable(Object.assign({
      startY:y+8,theme:'grid',margin:{left:margin,right:margin,top:66,bottom:FOOT},
      head:[['Date','Paid From (Cash & Bank)','Against Financial Year','Amount (BDT)','Note','Receipt']],
      headStyles:{fillColor:[16,185,129],textColor:255,fontStyle:'bold',fontSize:7},
      body:payments.map(payment=>[wpDate(payment.date),payment.account||'',wpPaymentYear(payment)||'General',wpPlain(Math.abs(wpNum(payment.amount))),payment.note||'',payment.receipt?'Attached':'-']),
      foot:[['Total','','',wpPlain(payments.reduce((t,p)=>t+Math.abs(wpNum(p.amount)),0)),'','']],
      footStyles:{fillColor:[236,253,245],textColor:[30,41,59],fontStyle:'bold',fontSize:7},
      columnStyles:{3:{halign:'right'}}
    },style));
  }
  doc.save(`${kind.file}-Report-${todayISO()}.pdf`);
  toast(`${kind.label} PDF report exported`);
}
