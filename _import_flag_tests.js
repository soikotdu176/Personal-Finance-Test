/* Temporary harness: "I Do not want to change Account" during the Excel / Budget CSV migration. */
var __results=[];
function check(name,actual,expected){
  __results.push({name,ok:JSON.stringify(actual)===JSON.stringify(expected),actual,expected});
}

state.settings={currency:'BDT',locale:'en-US',incomeYears:['2025-26']};
state.categories=[{id:'ac1',type:'Asset',name:'Cash & Bank',subcategories:['Cash in Hand','bKash']}];
state.incomeGroups=[];
state.migrationHistory=[];
state.officePurchases=[];
state.documents=[];
state.incomeExpenses=[];
state.records=[];

const snapshot=()=>({
  id:'cash1',type:'Asset',category:'Cash & Bank',subcategory:'bKash',particulars:'',accountDetail:'',
  amount:5000,balance:5000,date:'2025-07-01',incomeYear:'2025-26',details:'',documentIds:[],
  createdAt:'2025-07-01T00:00:00.000Z',updatedAt:'2025-07-01T00:00:00.000Z'
});
state.records=[snapshot()];

var __saved={};
const resetSaved=()=>{__saved={}};
putMany=async(store,items)=>{__saved[store]=(__saved[store]||[]).concat((items||[]).map(i=>Object.assign({},i)))};
put=async(store,item)=>{__saved[store]=(__saved[store]||[]).concat([Object.assign({},item)])};
remove=async()=>{};
removeMany=async()=>{};
loadState=async()=>{};
renderAll=()=>{};
toast=()=>{};
saveMigrationMeta=async function(id,isReplace,type,fileName,imported,skipped,options){
  __saved.meta={id,isReplace,type,fileName,imported,skipped,noAccountChange:!!(options&&options.noAccountChange)};
};

const cashBalance=()=>effectiveRecordsForBalance(state.records,'2025-26')
  .filter(record=>!isTransferRecord(record)&&isCashRecord(record)&&cashSubcategoryKey(record.subcategory)==='bkash')
  .reduce((sum,record)=>sum+recordAmount(record),0);

const BUDGE_AOA=[
  ['date','amount','category','subcategory','account','payment','goal','description'],
  ['01-08-2025',-500,'Food','Groceries','bKash','','','Lunch']
];
const BUDGE_CSV='date,amount,category,subcategory,account,payment,goal,description\n01-08-2025,-500,Food,Groceries,bKash,,,Lunch';
const csvFile=()=>({name:'Budge-2025.csv',size:BUDGE_CSV.length,type:'text/csv',text:async()=>BUDGE_CSV});
const xlsxFile=name=>({name,size:400,type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',arrayBuffer:async()=>new ArrayBuffer(0)});
const budgeBook=()=>({SheetNames:['Sheet1'],Sheets:{Sheet1:{aoa:BUDGE_AOA}}});
const TEMPLATE_AOA=[
  ['Date','Entry Type *','Major Head','Category *','Subcategory','Amount (Taka) *','Account / Method','Description','Income Year'],
  ['2025-08-05','Expense','Living','Food','Groceries',300,'bKash','Snacks','2025-26']
];
const templateBook=()=>({SheetNames:['Income & Expenses'],Sheets:{'Income & Expenses':{aoa:TEMPLATE_AOA}}});


(async()=>{
  /* 1. Budget CSV with the box ticked: the flag must reach the imported rows. */
  resetSaved();state.incomeExpenses=[];
  XLSX.workbook=budgeBook();
  await runImport(csvFile(),null,{noAccountChange:true});
  const csvFlagged=__saved.incomeExpenses||[];
  check('CSV import rows arrive',csvFlagged.length,1);
  check('CSV rows carry noAccountChange',csvFlagged.every(r=>r.noAccountChange===true),true);
  state.incomeExpenses=csvFlagged.map(r=>Object.assign({},r));
  check('CSV flagged expense keeps the Cash & Bank balance',cashBalance(),5000);

  /* 2. Budget CSV with the box unticked: the existing deduction must stay. */
  resetSaved();state.incomeExpenses=[];
  XLSX.workbook=budgeBook();
  await runImport(csvFile(),null,{});
  const csvPlain=__saved.incomeExpenses||[];
  check('unticked CSV rows carry no flag',csvPlain.some(r=>r.noAccountChange),false);
  state.incomeExpenses=csvPlain.map(r=>Object.assign({},r));
  check('unticked CSV expense still deducts',cashBalance(),4500);

  /* 3. Budge-style .xlsx routed through the workbook branch. */
  resetSaved();state.incomeExpenses=[];
  XLSX.workbook=budgeBook();
  await runImport(xlsxFile('Budge-2025.xlsx'),null,{noAccountChange:true});
  check('workbook Budge rows carry noAccountChange',(__saved.incomeExpenses||[]).every(r=>r.noAccountChange===true),true);

  /* 4. Filled migration template / export workbook (Income & Expenses sheet). */
  resetSaved();state.incomeExpenses=[];
  XLSX.workbook=templateBook();
  await runImport(xlsxFile('Finance-Migration-Template.xlsx'),null,{noAccountChange:true});
  const templateRows=__saved.incomeExpenses||[];
  check('template income rows arrive',templateRows.length,1);
  check('template income rows carry noAccountChange',templateRows.every(r=>r.noAccountChange===true),true);
  check('template row keeps its classification',templateRows.map(r=>[r.majorHead,r.category,r.subcategory]),[['Living','Food','Groceries']]);
  state.incomeExpenses=templateRows.map(r=>Object.assign({},r));
  check('template flagged expense keeps the Cash & Bank balance',cashBalance(),5000);

  /* 5. Unticked template import keeps deducting. */
  resetSaved();state.incomeExpenses=[];
  XLSX.workbook=templateBook();
  await runImport(xlsxFile('Finance-Migration-Template.xlsx'),null,{});
  state.incomeExpenses=(__saved.incomeExpenses||[]).map(r=>Object.assign({},r));
  check('unticked template expense deducts',cashBalance(),4700);

  /* 6. "Funded from" on an imported asset row must not move Cash & Bank when ticked. */
  state.incomeExpenses=[];
  state.records=[snapshot(),{
    id:'rec-fund',type:'Asset',category:'Electronics',subcategory:'Laptop',particulars:'Laptop',accountDetail:'',
    amount:2000,balance:2000,date:'2025-08-02',incomeYear:'2025-26',details:'',documentIds:[],
    funding:{category:'Cash & Bank',subcategory:'bKash'},noAccountChange:true,
    createdAt:'2025-08-02T00:00:00.000Z',updatedAt:'2025-08-02T00:00:00.000Z'
  }];
  check('flagged funded row leaves Cash & Bank intact',cashBalance(),5000);
  delete state.records[1].noAccountChange;
  check('unticked funded row still deducts',cashBalance(),3000);
  state.records=[snapshot()];

  /* 7. Replacing a batch keeps the account behaviour it was imported with. */
  resetSaved();state.incomeExpenses=[];
  state.incomeExpenses=[{
    id:'ie-old',type:'Expense',date:'2025-08-01',incomeYear:'2025-26',majorHead:'Living',category:'Food',
    subcategory:'Groceries',amount:500,account:'Bkash',noAccountChange:true,migrationId:'mig-1',documentIds:[]
  }];
  state.migrationHistory=[{
    id:'mig-1',fileName:'Budge-2025.csv',migrationType:'Budge CSV',timestamp:'2025-08-10T00:00:00.000Z',
    importedCount:1,skippedCount:0,status:'completed',noAccountChange:true
  }];
  XLSX.workbook=budgeBook();
  await runImport(csvFile(),'mig-1');
  check('re-imported batch rows keep noAccountChange',(__saved.incomeExpenses||[]).every(r=>r.noAccountChange===true),true);
  check('replacement batch keeps the account opt-out on record',!!(__saved.meta&&__saved.meta.noAccountChange),true);
})();
