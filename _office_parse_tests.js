/* Temporary harness: office workbook import parsing + export round-trip. */
var __results=[];
function check(name,actual,expected){
  const ok=JSON.stringify(actual)===JSON.stringify(expected);
  __results.push({name,ok,actual,expected});
}

/* ---- Cash & Bank accounts maintained in Settings -> Manage Categories (Asset) ----
   The office page never hardcodes an account: only these subcategories are offered, linked and
   moved. Duplicates (here "bKash" appears twice, spaced and with different casing) collapse into a
   single option, and a Liability subcategory ("Card") is not an account at all. */
state.categories=[
  {id:'c1',type:'Asset',name:'Cash',subcategories:['Cash in Hand',' bKash ','bKash','Basic Bank Limited']},
  {id:'c2',type:'Asset',name:'Cash & Bank',subcategories:['Cash in Hand','Savings Accounts']},
  {id:'c3',type:'Asset',name:'Investments',subcategories:['CPF']},
  {id:'c4',type:'Liability',name:'Loan',subcategories:['Card']}
];

/* ---- Replica of the real "Office Purchase & Bill.xlsx" sheet 2023-24 ----
   Header in row 3, opening "Balance" in row 4, inflow dates deliberately empty
   (the sheet stores serial numbers in column D instead), one inflow without detail. */
const sheet2324=[
  ['Office Purchase & Bill 2023-24','','','','','',''],
  [],
  ['Cash Outflow/Expenses','','','','Cash Inflow','',''],
  ['Date ','Detail ','Amount (Taka) ','','Date ','Detail ','Amount (Taka) '],
  [44933,'Balance ',530,7,'','Basic Bank Account',800],
  ['26/11/2023','USB Key Board',800,10,'','Basic Bank Account',997],
  [45211,'Pen',70,12,'','Basic Bank Account',610],
  ['26/12/2023','A4 Paper',900,15,'','Basic Bank Account',2330],
  ['23/01/2024','RS Ledger ',510,18,'','Basic Bank Account',1142],
  ['26/01/2023','Repair',200],
  [45475,'DGM civil',1090],
  [45475,'Printer repair',700],
  ['20/03/2024','E-Mutation',2340,25,'','',500],
  ['Total',7140,'',27,'','',6379]
];
const parsed=parseOfficeSheet(sheet2324,'2023-24');
const totals=officeTotals(parsed.entries);
const fyStart=(fiscalRange('2023-24')||{}).from||'';
check('detects FY sheet',parsed.detected,true);
check('office signature detects the real caption',officeSheetSignature(sheet2324),true);
check('office signature rejects a plain date/amount sheet',officeSheetSignature([['Date','Detail','Amount'],['01/08/2025','Paper',120]]),false);
check('normalized FY',parsed.fy,'2023-24');
check('opening balance',parsed.openingBalance,530);
check('outflow total matches sheet',totals.outflow,6610);
check('inflow total matches sheet',totals.inflow,6379);
check('entry count',parsed.entries.length,14);
check('rows without detail imported',parsed.unnamed,1);
check('balance row not imported',parsed.entries.some(e=>/^balance$/i.test(e.particulars)),false);
const inflows=parsed.entries.filter(e=>e.type==='Inflow');
check('inflow count',inflows.length,6);
check('inflow dates fall back to FY start',inflows.map(e=>e.date),[fyStart,fyStart,fyStart,fyStart,fyStart,fyStart]);
check('serial-number column never parsed as 1900 date',inflows.some(e=>e.date.startsWith('1900')),false);
const noDetail=parsed.entries.find(e=>e.particulars==='Cash Inflow');
check('detail-less inflow kept with placeholder',!!noDetail&&noDetail.amount,500);
check('import hashes unique',new Set(parsed.entries.map(e=>e.importHash)).size,parsed.entries.length);
check('dates normalized from dd/mm/yyyy',parsed.entries.find(e=>e.particulars==='A4 Paper').date,'2023-12-26');
check('serial date normalized',parsed.entries.find(e=>e.particulars==='Pen').date===normalizeExcelDate(45211),true);
check('undated rows counted',parsed.undated,6);
check('memo rows without an amount are skipped',parsed.skipped,0);
const memoSheet=[
  ['Office Purchase & Bill 2025-26'],
  ['Cash Outflow/Expenses','','','','Cash Inflow'],
  ['Date ','Detail ','Amount (Taka) ','','Date ','Detail ','Amount (Taka) '],
  [45900,'Note: pending bill'],
  ['01/08/2025','Paper',120],
  ['Total',120]
];
const memo=parseOfficeSheet(memoSheet,'2025-26');
check('memo row reported as skipped',memo.skipped,1);
check('memo row never imported',memo.entries.length,1);
check('memo import totals',officeTotals(memo.entries).outflow,120);

/* ---- Replica where the inflow dates sit one column left (column D), like 2025-26 ---- */
const sheet2526=[
  ['Office Purchase & Bill 2025-26','','','','','',''],
  [],
  ['Cash Outflow/Expenses','','','','Cash Inflow','',''],
  ['Date ','Detail ','Amount (Taka) ',18301.55,'Date ','Detail ','Amount (Taka) '],
  [45839,'Balance ',3580,45944,'','Basic Bank Account',2457],
  [45853,'Stationery goods',525,46012,'','Cash (Imran Vai)',710],
  [46015,'Entertainment Tax',1580.65],
  ['Total',5685.65,'',45990,'','',3167]
];
const p2=parseOfficeSheet(sheet2526,'2025-26');
const t2=officeTotals(p2.entries);
check('second sheet opening',p2.openingBalance,3580);
check('second sheet outflow total',t2.outflow,2105.65);
check('second sheet inflow total',t2.inflow,3167);
check('inflow date read from column D',p2.entries.find(e=>e.particulars==='Basic Bank Account').date,normalizeExcelDate(45944));
check('outflow date read from column A',p2.entries.find(e=>e.particulars==='Stationery goods').date,normalizeExcelDate(45853));

/* ---- Export layout must read back identically (idempotent import) ---- */
const roundTrip=[
  {type:'Outflow',date:'2025-08-01',particulars:'Pen',amount:70,account:'Cash',category:'Office Supplies'},
  {type:'Outflow',date:'2025-08-02',particulars:'Paper',amount:100,account:'',category:'Office Supplies'},
  {type:'Inflow',date:'2025-08-03',particulars:'Cash (Imran Vai)',amount:500,account:'Cash (Imran Vai)',category:'Capital Injection'}
];
const built=officeSheetAoa('2025-26',roundTrip,1000);
const back=parseOfficeSheet(built.aoa,'2025-26');
const backTotals=officeTotals(back.entries);
check('round-trip opening',back.openingBalance,1000);
check('round-trip entry count',back.entries.length,3);
check('round-trip outflow',backTotals.outflow,170);
check('round-trip inflow',backTotals.inflow,500);
check('round-trip closing balance',built.closing,670);
const hashesA=back.entries.map(e=>e.importHash).sort();
const hashesB=parseOfficeSheet(built.aoa,'2025-26').entries.map(e=>e.importHash).sort();
check('round-trip hashes stable (no duplicate import)',hashesA,hashesB);
check('round-trip account kept',back.entries.find(e=>e.particulars==='Cash (Imran Vai)').account,'Cash (Imran Vai)');
check('round-trip outflow account kept',back.entries.find(e=>e.particulars==='Pen').account,'Cash');
check('export sheet has 8 columns',built.aoa[5].length,8);
check('export carries account columns',built.aoa[5][3]==='Cash & Bank'&&built.aoa[5][7]==='Cash & Bank',true);
check('real sheet account guessed from detail',parsed.entries.find(e=>e.particulars==='Basic Bank Account').account,'Basic Bank Limited');

/* ---- Ledger maths: net, opening balance, running net, cash & bank effect ---- */
const ledger=[
  {id:'a',type:'Outflow',date:'2025-07-05',particulars:'Rent',amount:1200,account:'Basic Bank Limited'},
  {id:'b',type:'Outflow',date:'2025-07-02',particulars:'Pen',amount:100,account:''},
  {id:'c',type:'Inflow',date:'2025-07-09',particulars:'Top-up',amount:5000,account:'Cash in Hand'}
];
const lt=officeTotals(ledger);
check('net is outflow minus inflow',lt.net,-3700);
check('outflow ignores account',lt.outflow,1300);
check('cash effect only counts linked accounts',lt.cashEffect,3800);
check('closing balance adds the net',officeClosingBalance(ledger,1000),-2700);
const run=officeRunningMap(ledger,1000);
check('running net follows the dates',[run.get('b'),run.get('a'),run.get('c')],[1100,2300,-2700]);
check('entry order sorts by date',ledger.slice().sort(officeEntryOrder).map(e=>e.id),['b','a','c']);
state.settings=Object.assign({},state.settings,{officeOpeningBalances:{'2025-26':1500}});
check('opening balance read from settings',officeOpeningBalance('2025-26'),1500);
check('missing opening balance is zero',officeOpeningBalance('2024-25'),0);
check('migration summary uses the office account',migrationRowSummary({date:'2025-07-01',type:'Outflow',category:'Rent',account:'Cash',particulars:'Rent paid',amount:'500'},'officePurchases'),{date:'2025-07-01',type:'Outflow',category:'Rent',subcategory:'Cash',amount:500});

/* ---- Page render smoke test (fake DOM) ---- */
const officeEls={};
const fakeEl=id=>officeEls[id]||(officeEls[id]={id,innerHTML:'',textContent:'',value:'',dataset:{},
  classList:{toggle(){},add(){},remove(){}},querySelectorAll:()=>[],querySelector:()=>null,
  onclick:null,onchange:null,oninput:null,showModal(){},close(){}});
document={getElementById:fakeEl,querySelector:()=>null,querySelectorAll:()=>[]};
state.officePurchases=ledger.map(r=>Object.assign({},r,{category:'Office Supplies',incomeYear:'2025-26'}));
state.officePurchases.push({id:'d',type:'Outflow',date:'2024-08-01',particulars:'Old year',amount:999,account:'Cash',category:'Office Supplies',incomeYear:'2023-24'});
state.settings.officeOpeningBalances={'2025-26':1000};
state.settings.incomeYears=['2025-26','2023-24'];
officeFilters.year='2025-26';officeYearChosen=true;officeFilters.type='';officeFilters.account='';officeFilters.category='';officeFilters.search='';officePage=1;
renderOfficePage();
const tableHtml=officeEls['officeTable'].innerHTML;
check('render: opening balance is not a ledger row',tableHtml.includes('Opening Balance (brought forward)'),false);
check('render: total row',tableHtml.includes('Total (filtered)'),true);
check('render: only the selected FY is listed',tableHtml.includes('Old year'),false);
check('render: three ledger rows',(tableHtml.match(/data-cmd="view-office"/g)||[]).length,3);
check('render: summary shows cash effect',officeEls['officeSummaryCards'].innerHTML.includes('Cash &amp; Bank Effect'),true);
check('render: account cards derived from ledger',officeEls['officeAccountSummary'].innerHTML.includes('Basic Bank Limited'),true);
check('render: empty balances not shown for foreign FY',officeEls['officeRecordCount'].textContent.includes('3 entries shown'),true);
officeFilters.account='Cash in Hand';
renderOfficeTable();
check('render: filtered rows still show the whole-ledger balance',officeEls['officeTable'].innerHTML.includes(formatMoney(-2700)),true);

/* ---- The dropdown comes from Settings -> Manage Categories (Asset -> Cash / Cash & Bank) ---- */
check('accounts come from Settings only',officeAccountChoices(),['Cash in Hand','bKash','Basic Bank Limited','Savings Accounts']);
check('accounts deduplicated case-insensitively',officeAccountChoices().filter(name=>/bkash/i.test(name)),['bKash']);
check('subcategories outside Cash & Bank are not accounts',officeAccountChoices().includes('CPF'),false);
check('a Liability subcategory is not an account',officeAccountChoices().includes('Card'),false);
check('account lookup ignores case and spacing',(officeAccountOption('  BKASH ')||{}).label,'bKash');
check('an unknown name is not an account',officeAccountOption('Card'),null);
check('an empty name is not an account',officeAccountOption(''),null);
check('an inflow adds to the account',officeAccountDelta({type:'Inflow',amount:250}),250);
check('an outflow deducts from the account',officeAccountDelta({type:'Outflow',amount:250}),-250);

/* ---- The account effect is derived from the entries, never written into the ledger ---- */
const recordsBefore=state.records.slice();
state.officePurchases=[
  {id:'o1',type:'Outflow',date:'2025-08-10',particulars:'Paper',amount:500,account:'bKash',category:'Office Purchase',incomeYear:'2025-26'},
  {id:'o2',type:'Inflow',date:'2025-08-12',particulars:'Top-up',amount:2000,account:'BKASH',category:'Office Fund',incomeYear:'2025-26'},
  {id:'o3',type:'Outflow',date:'2025-08-13',particulars:'Pen',amount:100,account:'bKash',category:'Office Purchase',incomeYear:'2025-26',noAccountChange:true},
  {id:'o4',type:'Opening Balance (Outflow)',date:'2025-07-01',particulars:'Opening Balance',amount:3000,account:'bKash',category:'Opening Balance',incomeYear:'2025-26'},
  {id:'o5',type:'Outflow',date:'2025-08-14',particulars:'Lunch',amount:50,account:'Card',category:'Office Purchase',incomeYear:'2025-26'}
];
const legOf=id=>effectiveRecordsForBalance(state.records,'').find(record=>record.officeEntryId===id);
check('a linked entry moves its account',!!legOf('o1'),true);
check('an outflow deducts the amount',recordAmount(legOf('o1')),-500);
check('an inflow spelled differently adds to the same account',recordAmount(legOf('o2')),2000);
check('the movement lands on the Settings account',[legOf('o1').category,legOf('o1').subcategory],['Cash','bKash']);
check('the opt-out entry moves nothing',legOf('o3'),undefined);
check('an opening balance moves nothing',legOf('o4'),undefined);
check('an account outside Settings moves nothing',legOf('o5'),undefined);
check('nothing is written into the ledger',state.records.length,recordsBefore.length);
const applies=id=>officeAccountApplies(state.officePurchases.find(entry=>entry.id===id));
check('a linked entry applies',applies('o1'),true);
check('"do not change account" stops the effect',applies('o3'),false);
check('opening rows never apply',applies('o4'),false);

/* ---- Snapshot + fiscal-year gating, exactly like transfers and "Funded from" ---- */
state.records=[{id:'r1',type:'Asset',category:'Cash',subcategory:'bKash',particulars:'bKash',date:'2025-09-01',amount:10000,balance:10000,incomeYear:'2025-26'}];
const cashTotal=year=>Math.round(sumAmount(effectiveRecordsForBalance(state.records,year).filter(isCashRecord)));
check('a newer snapshot already contains older movements',cashTotal('2025-26'),10000);
state.officePurchases.push({id:'o6',type:'Outflow',date:'2025-09-05',particulars:'Toner',amount:400,account:'bKash',category:'Office Purchase',incomeYear:'2025-26'});
check('a movement after the snapshot still counts',cashTotal('2025-26'),9600);
check('movements spent in a later FY are ignored',effectiveRecordsForBalance(state.records,'2024-25').filter(record=>record.officeEntryId).length,0);
state.settings.officeOpeningBalances={'2025-26':0};

/* ---- Render: Settings accounts only, case-insensitive filter, "no change" tag ---- */
officeFilters.year='2025-26';officeFilters.type='';officeFilters.category='';officeFilters.search='';
officeFilters.account='bkash';officePage=1;
renderOfficeTable();
const filteredHtml=officeEls['officeTable'].innerHTML;
check('the account filter ignores case',(filteredHtml.match(/data-cmd="view-office"/g)||[]).length,5);
check('the table marks the entry that leaves the account alone',filteredHtml.includes('no change'),true);
renderOfficeFilters();
const filterHtml=officeEls['officeFilters'].innerHTML;
check('the account filter offers every Settings account',officeAccountChoices().every(name=>filterHtml.includes(`value="${name}"`)),true);
check('the account filter offers nothing else',filterHtml.includes('value="Card"'),false);




/* ==========================================================================
   Downloadable template — column-per-field layout + Excel dropdown rules.
   The template uses  Date * | Entry Type * | Particulars * | Category * |
   Cash & Bank | Amount (Taka) * | Notes  (helper lists sit in hidden J/K).
   ========================================================================== */

/* ---- Category dropdown = built-in office categories + every non-cash Settings category ---- */
const tplCategories=officeTemplateCategories();
check('template offers the office categories',OFFICE_CATEGORIES.every(name=>tplCategories.includes(name)),true);
check('template offers Settings categories too',tplCategories.includes('Investments')&&tplCategories.includes('Loan'),true);
check('template never offers a cash category',tplCategories.includes('Cash'),false);
check('template categories never repeat',new Set(tplCategories).size,tplCategories.length);

/* ---- The two rules SheetJS cannot write: Entry Type * (B) and Category * (D) ---- */
const tplXml=officeTemplateValidationsXml({name:'2025-26',typeRange:'B4:B203',categoryRange:'D4:D203',typeList:'$J$4:$J$7',categoryList:'$K$4:$K$11'});
check('one rule per dropdown column',(tplXml.match(/<dataValidation /g)||[]).length,2);
check('entry type dropdown covers B4:B203',tplXml.includes('sqref="B4:B203"'),true);
check('category dropdown covers D4:D203',tplXml.includes('sqref="D4:D203"'),true);
check('lists point at the hidden helper columns',tplXml.includes('<formula1>$J$4:$J$7</formula1>')&&tplXml.includes('<formula1>$K$4:$K$11</formula1>'),true);
check('a value outside the list is refused',tplXml.includes('errorStyle="stop"')&&tplXml.includes('showErrorMessage="1"'),true);
check('blank cells stay allowed',(tplXml.match(/allowBlank="1"/g)||[]).length,2);

/* ---- Injection keeps the worksheet schema order and never doubles the rules ---- */
const dvSheet='<worksheet><sheetData><row r="1"/></sheetData><ignoredErrors><ignoredError sqref="A1"/></ignoredErrors><pageMargins/><drawing r:id="rId1"/></worksheet>';
const dvInjected=officeInjectValidations(dvSheet,'<dataValidations count="2"><dataValidation/></dataValidations>');
check('rules land right after the rows',dvInjected.indexOf('<dataValidations')>dvInjected.indexOf('</sheetData>'),true);
check('rules come before ignoredErrors / pageMargins / drawing',dvInjected.indexOf('<dataValidations')<dvInjected.indexOf('<ignoredErrors')
  &&dvInjected.indexOf('<dataValidations')<dvInjected.indexOf('<pageMargins')
  &&dvInjected.indexOf('<dataValidations')<dvInjected.indexOf('<drawing'),true);
check('the sheet keeps every later element',['</sheetData>','<ignoredErrors','<pageMargins','<drawing','</worksheet>'].every(part=>dvInjected.includes(part)),true);
check('injecting twice never duplicates the rules',(officeInjectValidations(dvInjected,'<dataValidations count="9"/>').match(/<dataValidations /g)||[]).length,1);



/* ---- Flat template sheet: one row per entry, helper columns J/K ignored ---- */
const tplSheet=[
  ['Office Purchase & Bill - FY 2025-26'],
  ['Fill one row per entry. Entry Type * and Category * are dropdowns.'],
  ['Date *','Entry Type *','Particulars *','Category *','Cash & Bank','Amount (Taka) *','Notes','','','Entry Types','Categories'],
  ['05/07/2025','Office Purchase (Cash Outflow)','A4 Paper','Office Purchase','bKash',900,'Ream','','','Office Purchase (Cash Outflow)','Office Purchase'],
  ['2025-08-11','Bill Received (Cash Inflow)','Bill copy','Bill Received','bkash','1,500.50','','','','Bill Received (Cash Inflow)','Bill Received'],
  ['','','Toner','','','300','','','','Opening Balance (Outflow)','Office Fund'],
  ['2025-08-12','','Courier','Other','Dutch Bangla',200,'','','','Opening Balance (Inflow)','Other'],
  ['2025-09-01','','Memo without amount','','','','','','','',''],
  ['Total','','','','','2400.50','','','','','']
];
const tplParsed=parseOfficeSheet(tplSheet,'2025-26');
check('flat layout detected',tplParsed.detected,true);
check('flat header is an office signature',officeSheetSignature(tplSheet),true);
check('flat entry count',tplParsed.entries.length,4);
check('the Total row stops the reader',tplParsed.entries.some(e=>e.amount===2400.5),false);
check('a memo row without an amount is reported, not imported',tplParsed.skipped,1);
check('the dropdown Entry Type is kept exactly',tplParsed.entries[0].type,'Office Purchase (Cash Outflow)');
check('an Inflow label is classified as an inflow',officeTypeKind(tplParsed.entries[1].type),'Inflow');
check('dd/mm/yyyy date normalized',tplParsed.entries[0].date,'2025-07-05');
check('amount with a thousands separator parsed',tplParsed.entries[1].amount,1500.5);
check('the typed category is kept verbatim',tplParsed.entries[1].category,'Bill Received');
check('a configured account uses the Settings spelling',tplParsed.entries[1].account,'bKash');
check('an unknown account is kept for reference',tplParsed.entries[3].account,'Dutch Bangla');
check('a row without an Entry Type defaults by wording',tplParsed.entries[2].type,'Office Purchase (Cash Outflow)');
check('an empty category falls back to the office guess',tplParsed.entries[2].category,'Office Purchase');
check('untyped rows are counted',tplParsed.untyped,2);
check('an undated row is dated to the FY start',tplParsed.entries[2].date,'2025-07-01');
check('undated rows are counted',tplParsed.undated,1);
check('flat import hashes are unique',new Set(tplParsed.entries.map(e=>e.importHash)).size,tplParsed.entries.length);
check('flat import hashes stay stable on re-import',parseOfficeSheet(tplSheet,'2025-26').entries.map(e=>e.importHash),tplParsed.entries.map(e=>e.importHash));

/* ---- A CSV saved from the template has no FY sheet name, so it is derived ---- */
check('fiscal year read from the title row',officeCsvFiscalYear([['Office Purchase & Bill - FY 2025-26']],'office.csv'),'2025-26');
check('fiscal year read from the filename',officeCsvFiscalYear([['Date *','Entry Type *']],'Office Purchase & Bill 2024-25.csv'),'2024-25');
check('a filename date is not mistaken for a fiscal year',officeCsvFiscalYear([],'Office-2026-11.csv'),fiscalYearFromDate(todayISO()));
