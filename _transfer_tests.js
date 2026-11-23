/* Test body executed in the app.js script scope (same lexical environment).
   Covers the Cash & Bank subcategory model of Transfer and the "Funded from" movement of records. */
(function(){
  const results=[];
  const check=(name,actual,expected)=>results.push({name,actual,expected,ok:JSON.stringify(actual)===JSON.stringify(expected)});
  state.settings={currency:'BDT',locale:'en-US',incomeYears:['2026-27','2025-26']};
  // Imported classification tree: Cash & Bank holds one subcategory per real account.
  state.categories=[
    {id:'c-cash',type:'Asset',name:'Cash & Bank',subcategories:['Cash in Hand','bKash','Basic Bank Limited','Redotpay']},
    {id:'c-property',type:'Asset',name:'Property',subcategories:['Land & Primary Residence','Vehicles']},
    {id:'c-other',type:'Asset',name:'Other Assets',subcategories:['Furniture, Electronics & Equipments']},
    {id:'c-loan',type:'Liability',name:'Bank Loan',subcategories:['Bank Loan']}
  ];

  const stamp=date=>date+'T00:00:00.000Z';
  const cash=(id,subcategory,amount,date,extra)=>Object.assign({
    id,type:'Asset',category:'Cash & Bank',subcategory,particulars:'',accountDetail:'',amount,date,
    incomeYear:fiscalYearFromDate(date),details:'',documentIds:[],createdAt:stamp(date),updatedAt:stamp(date)
  },extra||{});
  const asset=(id,category,subcategory,amount,date,extra)=>Object.assign({
    id,type:'Asset',category,subcategory,particulars:'',accountDetail:'',amount,date,
    incomeYear:fiscalYearFromDate(date),details:'',documentIds:[],createdAt:stamp(date||'2026-07-01'),updatedAt:stamp(date||'2026-07-01')
  },extra||{});
  const liability=(id,particulars,amount)=>Object.assign({
    id,type:'Liability',category:'Bank Loan',subcategory:'Bank Loan',particulars,accountDetail:'',amount,
    date:'',incomeYear:'',details:'',documentIds:[],createdAt:stamp('2026-07-01'),updatedAt:stamp('2026-07-01')
  });
  const makeTransfer=(id,source,destination,out,incoming,date)=>({
    id,kind:'transfer',type:source.type,category:source.category,subcategory:source.subcategory,
    particulars:transferAccountName(source)+' -> '+transferAccountName(destination),accountDetail:'',
    date,incomeYear:fiscalYearFromDate(date),details:'',amount:out,balance:out,documentIds:[],
    transfer:{
      version:1,
      source:{...transferAccountSnapshot(source),amount:out,currency:'BDT',status:'Paid'},
      destination:{...transferAccountSnapshot(destination),amount:incoming,currency:'BDT',status:'Paid'},
      time:'10:00',synced:out===incoming,fee:Math.max(0,out-incoming),createdAt:stamp(date)
    },
    createdAt:stamp(date),updatedAt:stamp(date)
  });
  const account=(subcategory)=>transferAccounts('').find(item=>item.subcategory===subcategory);
  const balanceOf=(subcategory,records)=>(records||effectiveRecordsForBalance(state.records,''))
    .filter(record=>record.subcategory===subcategory)
    .reduce((sum,record)=>sum+recordAmount(record),0);
  const netWorth=records=>records.filter(r=>r.type==='Asset').reduce((s,r)=>s+recordAmount(r),0)
    -records.filter(r=>r.type==='Liability').reduce((s,r)=>s+recordAmount(r),0);

  /* 1. The Transfer sheet only lists Cash & Bank subcategories (each subcategory = one account) */
  state.records=[
    cash('k1','bKash',5000,'2026-07-01'),
    cash('k2','Cash in Hand',1000,'2026-07-01',{particulars:'Wallet'}),   // same subcategory, different name
    asset('p1','Property','Vehicles',800000,'2026-07-01'),
    liability('l1','DBBL Loan',50000)
  ];
  const listed=transferAccounts('');
  check('transfer lists cash subcategories only',listed.map(item=>item.subcategory).sort(),
    ['Basic Bank Limited','Cash in Hand','Redotpay','bKash']);
  check('no property or liability rows',listed.some(item=>item.category!=='Cash & Bank'),false);
  check('subcategory snapshots are merged',listed.find(item=>item.subcategory==='Cash in Hand').balance,1000);
  check('renamed cash category is recognised',isCashRecord({type:'Asset',category:'Cash & Bank'}),true);
  check('cash and bank spelling is recognised',isCashCategoryName('cash and bank'),true);

  /* 2. Cash -> Cash transfer moves both balances and keeps net worth intact */
  const src=account('bKash'),dst=account('Cash in Hand');
  check('source balance before',src.balance,5000);
  state.records.push(makeTransfer('t1',src,dst,2000,2000,'2026-11-20'));
  check('bKash after transfer',account('bKash').balance,3000);
  check('cash after transfer',account('Cash in Hand').balance,3000);
  check('balance-neutral net worth',buildBalanceData('').net,756000);
  check('no transfer rows in balance data',effectiveRecordsForBalance(state.records,'').filter(isTransferRecord).length,0);
  check('two synthetic legs',effectiveRecordsForBalance(state.records,'').filter(r=>r.syntheticTransferLeg).length,2);

  /* 3. A transfer to a subcategory without any snapshot still shows a balance */
  state.records=[cash('r1','Cash in Hand',1000,'2026-07-01')];
  const onlyCash=account('Cash in Hand'),bare=account('Basic Bank Limited');
  check('declared subcategory starts at zero',bare.balance,0);
  state.records.push(makeTransfer('t-bare',onlyCash,bare,400,400,'2026-11-20'));
  check('empty destination receives the money',account('Basic Bank Limited').balance,400);
  check('empty destination source pays',account('Cash in Hand').balance,600);

  /* 4. A transfer dated in a later financial year must not leak into an earlier one */
  state.records=[cash('p1','Cash in Hand',1000,'2025-08-01'),cash('p2','bKash',5000,'2025-08-01')];
  state.records.push(makeTransfer('p3',account('bKash'),account('Cash in Hand'),2000,2000,'2026-11-20'));
  const prior=effectiveRecordsForBalance(state.records,'2025-26');
  check('prior-year bKash stays at snapshot',balanceOf('bKash',prior),5000);
  check('prior-year cash stays at snapshot',balanceOf('Cash in Hand',prior),1000);
  check('transfer counts in its own year',account('bKash').balance,3000);

  /* 5. Editing replaces the previous effect, deleting restores it */
  state.records=[cash('c1','Cash in Hand',1000,'2026-07-01'),cash('c2','bKash',5000,'2026-07-01')];
  state.records.push(makeTransfer('t2',account('bKash'),account('Cash in Hand'),4000,4000,'2026-11-20'));
  check('edited bKash',account('bKash').balance,1000);
  check('edited cash',account('Cash in Hand').balance,5000);
  state.records=state.records.filter(r=>r.id!=='t2');
  check('restored bKash',account('bKash').balance,5000);
  check('restored cash',account('Cash in Hand').balance,1000);

  /* 6. A fee makes the received amount smaller (money leaves the books) */
  state.records.push(makeTransfer('t3',account('bKash'),account('Cash in Hand'),2000,1950,'2026-11-20'));
  check('fee source',account('bKash').balance,3000);
  check('fee destination',account('Cash in Hand').balance,2950);
  check('fee reduces net worth',sumAmount(effectiveRecordsForBalance(state.records,'')),5950);

  /* 7. Legacy transfers that touch a Liability keep working (previously saved data) */
  state.records=[cash('c1','Cash in Hand',1000,'2026-07-01'),liability('l1','DBBL Loan',50000)];
  const legacyLoan={key:'Bank Loan::DBBL Loan::',type:'Liability',category:'Bank Loan',subcategory:'Bank Loan',particulars:'DBBL Loan',accountDetail:'',balance:50000};
  state.records.push(makeTransfer('t4',legacyLoan,account('Cash in Hand'),10000,10000,'2026-11-20'));
  check('legacy loan leg still applies',balanceOf('Bank Loan'),60000);
  check('legacy cash leg still applies',account('Cash in Hand').balance,11000);
  check('legacy transfer keeps net worth',netWorth(effectiveRecordsForBalance(state.records,'')),-49000);

  /* 8. Reports and the dashboard table */
  dashFilters.type='';dashFilters.category='';dashFilters.subcategory='';dashFilters.year='';dashFilters.from='';dashFilters.to='';dashFilters.datesAuto=false;
  check('report rows drop transfers',getFilteredRecords().filter(isTransferRecord).length,0);
  check('report rows drop legs',getFilteredRecords().filter(r=>r.syntheticTransferLeg).length,0);
  check('table shows the transfer',transferRecordsForDisplay().length,1);
  dashFilters.type='Liability';
  check('transfer matches the liability side',transferRecordsForDisplay().length,1);
  dashFilters.type='';dashFilters.category='Bank Loan';
  check('transfer matches its source category',transferRecordsForDisplay().length,1);
  dashFilters.category='Cash & Bank';dashFilters.subcategory='Cash in Hand';
  check('transfer matches the cash subcategory',transferRecordsForDisplay().length,1);
  dashFilters.category='Property';dashFilters.subcategory='';
  check('transfer hidden for an unrelated category',transferRecordsForDisplay().length,0);
  dashFilters.type='';dashFilters.category='';dashFilters.subcategory='';
  dashFilters.year='2025-26';
  check('transfer hidden for an earlier year',transferRecordsForDisplay().length,0);
  dashFilters.year='';

  /* 9. Balance sheet totals and counts */
  state.records=[cash('c1','Cash in Hand',1000,'2026-07-01'),cash('c2','bKash',5000,'2026-07-01')];
  state.records.push(makeTransfer('t6',account('bKash'),account('Cash in Hand'),2000,2000,'2026-11-20'));
  const sheet=buildBalanceData('');
  check('balance sheet count ignores legs',sheet.count,2);
  check('balance sheet net worth',sheet.net,6000);
  check('cash category total',sheet.assets.cats.find(c=>c.name==='Cash & Bank').total,6000);
  check('per-subcategory totals',sheet.assets.cats.find(c=>c.name==='Cash & Bank').subs
    .filter(s=>s.name==='bKash'||s.name==='Cash in Hand').map(s=>s.total).sort(),[3000,3000]);

  /* 10. A snapshot saved after the transfer already contains the movement */
  state.records.push(cash('c3','bKash',9000,'2026-12-01'));
  check('newer snapshot wins',account('bKash').balance,9000);
  check('other side still moves',account('Cash in Hand').balance,3000);


  /* 11. "Funded from" lists every Asset subcategory, with live balances */
  state.records=[
    cash('f1','bKash',60000,'2026-07-01'),
    asset('f2','Property','Land & Primary Residence',500000,'2026-07-01'),
    liability('f3','DBBL Loan',50000)
  ];
  const fundingAccounts=assetFundingAccounts();
  check('funding lists cash subcategories',fundingAccounts.has('Cash & Bank::bKash'),true);
  check('funding lists other assets',fundingAccounts.has('Property::Land & Primary Residence'),true);
  check('funding lists declared-only assets',fundingAccounts.has('Other Assets::Furniture, Electronics & Equipments'),true);
  check('funding excludes liabilities',[...fundingAccounts.keys()].some(key=>key.startsWith('Bank Loan::')),false);
  check('funding shows the live balance',fundingAccounts.get('Cash & Bank::bKash').balance,60000);
  const fundingHtml=assetFundingOptionsHtml(fundingAccounts);
  check('None is always offered',fundingHtml.startsWith('<option value="">None</option>'),true);
  check('options are grouped by category',fundingHtml.includes('<optgroup label="Cash &amp; Bank">'),true);

  /* 12. A record funded from Cash & Bank deducts the money (edit / delete never double-deducts) */
  state.records=[cash('g1','bKash',60000,'2026-07-01')];
  state.records.push(asset('g2','Other Assets','Furniture, Electronics & Equipments',60000,'2026-11-20',
    {funding:{category:'Cash & Bank',subcategory:'bKash'}}));
  check('funded record deducts the account',balanceOf('bKash'),0);
  check('one funding leg',effectiveRecordsForBalance(state.records,'').filter(r=>r.fundingRecordId).length,1);
  check('funded purchase keeps net worth',netWorth(effectiveRecordsForBalance(state.records,'')),60000);
  check('funding leg is not a ledger row',getFilteredRecords().filter(r=>r.fundingRecordId).length,0);
  check('funded record still listed once',getFilteredRecords().length,2);

  /* Edit the amount: the deduction follows the record instead of stacking. */
  state.records.find(r=>r.id==='g2').amount=45000;
  check('edited funding amount',balanceOf('bKash'),15000);
  /* Switching the funding account moves the money to the new account. */
  state.records.find(r=>r.id==='g2').funding={category:'Cash & Bank',subcategory:'Cash in Hand'};
  check('old funding account released',balanceOf('bKash'),60000);
  check('new funding account charged',balanceOf('Cash in Hand'),-45000);
  /* Choosing None releases the account completely. */
  delete state.records.find(r=>r.id==='g2').funding;
  check('funding removed by None',balanceOf('Cash in Hand'),0);
  check('no funding legs left',effectiveRecordsForBalance(state.records,'').filter(r=>r.fundingRecordId).length,0);

  /* 13. A newer Cash & Bank snapshot already contains the spending */
  state.records=[cash('h1','bKash',60000,'2026-07-01'),
    asset('h2','Property','Vehicles',60000,'2026-11-20',{funding:{category:'Cash & Bank',subcategory:'bKash'}})];
  check('funding applies before the snapshot',balanceOf('bKash'),0);
  state.records.push(cash('h3','bKash',500,'2026-12-01'));
  check('newer snapshot skips the funding leg',balanceOf('bKash'),500);

  /* 14. A funding row belongs to its own Income Year */
  state.records=[cash('i1','bKash',60000,'2025-08-01'),
    asset('i2','Other Assets','Furniture, Electronics & Equipments',60000,'2026-11-20',{funding:{category:'Cash & Bank',subcategory:'bKash'}})];
  check('prior year ignores later funding',balanceOf('bKash',effectiveRecordsForBalance(state.records,'2025-26')),60000);
  check('current year applies funding',balanceOf('bKash',effectiveRecordsForBalance(state.records,'2026-27')),0);

  /* 15. Funding an account that has no snapshot yet still reduces it */
  state.records=[asset('j1','Property','Vehicles',100000,'2026-11-20',{funding:{category:'Cash & Bank',subcategory:'Redotpay'}})];
  check('funding without a snapshot',balanceOf('Redotpay'),-100000);
  check('transfer sheet picks up the funding leg',account('Redotpay').balance,-100000);

  /* 16. A Cash & Bank snapshot can never fund itself */
  state.records=[cash('k3','bKash',1000,'2026-07-01')];
  check('cash snapshots are not funding rows',effectiveRecordsForBalance(state.records,'').filter(r=>r.fundingRecordId).length,0);

  /* 17. An old transfer that touched a Liability stays editable without silently changing sides */
  state.records=[cash('l2','Cash in Hand',1000,'2026-07-01'),liability('l3','DBBL Loan',50000)];
  const closedLoan={key:'Bank Loan::DBBL Loan::',type:'Liability',category:'Bank Loan',subcategory:'Bank Loan',particulars:'DBBL Loan',accountDetail:'',balance:50000};
  state.records.push(makeTransfer('t9',closedLoan,account('Cash in Hand'),10000,10000,'2026-11-20'));
  const storedTransfer=state.records.find(r=>r.id==='t9').transfer;
  const sheetRows=legacyTransferSides(transferAccounts('t9'),storedTransfer,'t9');
  const loanRow=sheetRows.find(row=>row.key==='Bank Loan::DBBL Loan::');
  check('legacy side is offered while editing',!!loanRow,true);
  check('legacy side keeps its own balance',loanRow.balance,50000);
  const sheetOptions=transferAccountOptions(sheetRows,'Bank Loan::DBBL Loan::');
  check('legacy option is labelled with its category',sheetOptions.includes('Bank Loan / DBBL Loan'),true);
  check('cash option is labelled by subcategory',sheetOptions.includes('Cash in Hand ·'),true);
  check('new transfers only offer cash',transferAccounts('').some(row=>row.key.includes('DBBL')),false);
  check('cash transfer needs no legacy rows',
    legacyTransferSides(transferAccounts(''),{source:{subcategory:'bKash',category:'Cash & Bank',type:'Asset'},destination:{subcategory:'Cash in Hand',category:'Cash & Bank',type:'Asset'}}).length,
    transferAccounts('').length);

  globalThis.__results=results;

})();

