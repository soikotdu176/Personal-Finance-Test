/* Zakat PDF/Excel export checks: the exports must reuse the Zakat Dashboard ledger. */
(function(){
  const results=[];
  const check=(name,actual,expected)=>results.push({name,actual,expected,ok:JSON.stringify(actual)===JSON.stringify(expected)});
  const near=(name,actual,expected)=>results.push({name,actual,expected,ok:Math.abs(Number(actual)-Number(expected))<0.005});
  const captured=__captured;
  const el=__el;
  state.settings={currency:'BDT',locale:'en-US',incomeYears:['2026-27','2025-26']};

  const payment=(id,date,amount)=>({id,date,category:'Zakat',amount,note:''});
  const saved=(id,holder,year,payable,paid,payments)=>({
    id,savedAt:`${year}-06-01T00:00:00.000Z`,holder,
    hijriStart:`${year}-01-01`,hijriEnd:`${year}-12-30`,hijriYear:year,
    gregorianStart:year==='1445'?'2023-07-19':'2024-07-07',
    gregorianEnd:year==='1445'?'2024-07-07':'2025-06-26',
    nisab:500000,nisabReference:'Nisab reference',wealth:payable/0.025,payable,paid,balance:payable-paid,
    meetsNisab:true,gold:[{name:'Ring',carat:'22',grams:10,rate:1000,zakatPercent:100}],
    payments:payments||[],calculation:{},referencePdf:null
  });

  zakatRecords=[
    saved('own-1445','Own','1445',15000,20000,[payment('p1','2024-01-10',20000)]),  // overpaid 5,000
    saved('own-1446','Own','1446',40000,0,[]),
    saved('wife-1445','Wife','1445',8000,0,[]),
    saved('wife-1446','Wife','1446',12000,15000,[payment('p2','2025-03-05',15000)])
  ];

  /* 1. The ledger carries overpayments and outstanding forward. */
  const ledger=computeZakatLedger();
  const own1446=ledger.byId.get('own-1446');
  near('Own 1446 carries prior overpayment',own1446.openingOverpayment,5000);
  near('Own 1446 prior outstanding is zero',own1446.openingOutstanding,0);
  near('Own 1446 net payable nets the credit',own1446.netPayable,35000);
  near('Own 1446 remaining due',own1446.outstanding,35000);
  const wife1446=ledger.byId.get('wife-1446');
  near('Wife 1446 carries prior outstanding',wife1446.openingOutstanding,8000);
  near('Wife 1446 net payable includes the carry',wife1446.netPayable,20000);
  near('Wife 1446 remaining due',wife1446.outstanding,5000);

  const rows=zakatLedgerReportRows(getFilteredZakatRecords());
  check('report rows follow holder chronology',rows.map(row=>row.holder+':'+row.hijriYear),
    ['Own:1445','Own:1446','Wife:1445','Wife:1446']);
  const totals=zakatLedgerTotals(rows);
  near('report totals net payable',totals.netPayable,78000);
  near('report totals prior outstanding',totals.priorOutstanding,8000);
  near('report totals prior overpayment',totals.priorOverpayment,5000);
  near('report totals paid',totals.paid,35000);
  near('report totals remaining',totals.remaining,48000);
  const summary=zakatHolderSummaryRows(rows);
  near('Own final remaining balance',summary.find(group=>group.holder==='Own').finalOutstanding,35000);
  near('Wife final remaining balance',summary.find(group=>group.holder==='Wife').finalOutstanding,5000);

  /* 2. Dashboard renders the very same ledger figures. */
  renderZakatDashboard();
  const dashboardHTML=el('zakatDashboardTable').innerHTML+el('zakatDashboardCards').innerHTML;
  check('dashboard shows net payable total',dashboardHTML.includes('78,000.00'),true);
  check('dashboard shows remaining due total',dashboardHTML.includes('48,000.00'),true);
  check('dashboard shows carried overpayment',dashboardHTML.includes('5,000.00'),true);

  /* 3. Excel export matches the ledger. */
  captured.sheets.length=0;captured.file=null;captured.errors.length=0;
  exportZakatExcel();
  check('excel file name',!!captured.file&&captured.file.startsWith('Zakat-Report-'),true);
  check('excel sheets',captured.workbook.SheetNames,['Zakat Records','Holder Summary','Payments']);
  const sheet=captured.sheets[0].aoa;
  check('excel ledger headers',[sheet[0][9],sheet[0][10],sheet[0][11],sheet[0][12],sheet[0][13],sheet[0][14]],
    ['Prior Outstanding (BDT)','Prior Overpayment (BDT)','Net Payable (BDT)','Paid (BDT)','Net Remaining Due (BDT)','Overpayment Carried (BDT)']);
  const excelOwn=sheet.find(row=>row[0]==='Own'&&row[1]==='1446');
  near('excel Own 1446 prior overpayment',excelOwn[10],5000);
  near('excel Own 1446 net payable',excelOwn[11],35000);
  near('excel Own 1446 remaining',excelOwn[13],35000);
  const excelWife=sheet.find(row=>row[0]==='Wife'&&row[1]==='1446');
  near('excel Wife 1446 prior outstanding',excelWife[9],8000);
  near('excel Wife 1446 net payable',excelWife[11],20000);
  near('excel Wife 1446 remaining',excelWife[13],5000);
  const excelTotal=sheet[sheet.length-1];
  check('excel total row',excelTotal[0],'Total');
  near('excel total net payable',excelTotal[11],78000);
  near('excel total paid',excelTotal[12],35000);
  near('excel total remaining',excelTotal[13],48000);
  const excelSummary=captured.sheets[1].aoa;
  check('excel summary header',excelSummary[4][10],'Final Remaining Due (BDT)');
  const ownSummaryRow=excelSummary.slice(5).find(row=>row[0]==='Own');
  const wifeSummaryRow=excelSummary.slice(5).find(row=>row[0]==='Wife');
  near('excel Own final remaining',ownSummaryRow[10],35000);
  near('excel Wife final remaining',wifeSummaryRow[10],5000);
  const excelPayments=captured.sheets[2].aoa;
  check('excel payment header',excelPayments[0][0],'Nisab Holder');
  check('excel payment rows',excelPayments.length-1,2);

  /* 4. PDF export matches the ledger and lays out inside the page. */
  captured.pdf=null;captured.errors.length=0;
  exportZakatPdf();
  check('pdf file name',!!captured.pdf&&captured.pdf.name.endsWith('.pdf'),true);
  const main=captured.pdf.tables[0];
  check('pdf main table columns',main.head[0].length,14);
  check('pdf main monetary headers use BDT',main.head[0].slice(5).every(label=>label.includes('(BDT)')),true);
  check('pdf Own 1446 ledger row',[main.body[1][1],main.body[1][8],main.body[1][9],main.body[1][10],main.body[1][11],main.body[1][12]],
    ['1446','0.00','5,000.00','35,000.00','0.00','35,000.00']);
  check('pdf Wife 1445 ledger row',[main.body[2][8],main.body[2][10],main.body[2][12]],['0.00','8,000.00','8,000.00']);
  check('pdf Wife 1446 ledger row',[main.body[3][8],main.body[3][10],main.body[3][11],main.body[3][12]],
    ['8,000.00','20,000.00','15,000.00','5,000.00']);
  check('pdf totals row',[main.foot[0][10],main.foot[0][12]],['78,000.00','48,000.00']);
  check('pdf width fits landscape page',
    Object.keys(main.columnStyles).reduce((sum,key)=>sum+main.columnStyles[key].cellWidth,0)<=841.89-56,true);
  const tableWidth=table=>Object.keys(table.columnStyles).reduce((sum,key)=>sum+table.columnStyles[key].cellWidth,0);
  check('pdf every table fits the page width',
    captured.pdf.tables.every(table=>tableWidth(table)<=841.89-56),true);
  const holderTable=captured.pdf.tables[1];
  check('pdf holder summary header',holderTable.head[0][6],'Final Remaining Due (BDT)');
  check('pdf holder summary monetary headers use BDT',holderTable.head[0].slice(2).every(label=>label.includes('(BDT)')),true);
  check('pdf holder summary rows',[holderTable.body[0][0],holderTable.body[0][6],holderTable.body[1][0],holderTable.body[1][6]],
    ['Own','35,000.00','Wife','5,000.00']);
  const paymentTable=captured.pdf.tables[2];
  check('pdf payment table header',paymentTable.head[0][0],'Nisab Holder');
  check('pdf payment rows',paymentTable.body.length,2);
  check('pdf prints the active filter',
    captured.pdf.texts.some(text=>String(text[0]).includes('Hijri Year: All Hijri years')),true);

  /* 5. A filtered export keeps the same ledger values with fewer rows. */
  el('zakatFilterHijriYear').value='1446';
  captured.sheets.length=0;captured.pdf=null;captured.errors.length=0;
  exportZakatExcel();
  const filteredSheet=captured.sheets[0].aoa;
  check('filtered excel rows',filteredSheet.slice(1,-1).map(row=>row[0]+':'+row[1]),['Own:1446','Wife:1446']);
  const filteredTotal=filteredSheet[filteredSheet.length-1];
  near('filtered excel prior outstanding kept',filteredTotal[9],8000);
  near('filtered excel prior overpayment kept',filteredTotal[10],5000);
  near('filtered excel net payable',filteredTotal[11],55000);
  near('filtered excel remaining',filteredTotal[13],40000);
  exportZakatPdf();
  check('filtered pdf rows',captured.pdf.tables[0].body.length,2);
  check('filtered pdf keeps carried outstanding',captured.pdf.tables[0].body[1][8],'8,000.00');
  check('filtered pdf prints the filter line',
    captured.pdf.texts.some(text=>String(text[0]).includes('Hijri Year: 1446')),true);
  el('zakatFilterHijriYear').value='';
  check('no console errors during exports',captured.errors,[]);

  /* 6. Detail exports follow the currently opened record, not dashboard filters. */
  zakatRecords[0].referencePdf={name:'nisab-guidance.pdf',size:123,type:'application/pdf'};
  viewZakatRecord('own-1445');
  captured.sheets.length=0;captured.file=null;captured.errors.length=0;
  exportZakatDetailExcel();
  check('detail excel filename identifies viewed record',captured.file,'Zakat-Record-Own-1445.xlsx');
  check('detail excel uses a single record sheet',captured.workbook.SheetNames,['Zakat Record']);
  const detailSheet=captured.sheets[0].aoa;
  check('detail excel has displayed sections',
    detailSheet.filter(row=>row.length===1).map(row=>row[0]),
    ['Zakat Record','Own · 1445-01-01 – 1445-12-30','Assets & Cash','Gold Ornaments','Distribution / Payment Ledger']);
  check('detail excel includes displayed attachment metadata',
    detailSheet.find(row=>row[0]==='Reference PDF')[1],'nisab-guidance.pdf');
  check('detail excel matches displayed gold row',
    detailSheet.find(row=>row[0]==='Ring'),['Ring','22','10','৳1,000.00','10000%','৳1,000,000.00']);
  captured.pdf=null;captured.errors.length=0;
  exportZakatDetailPdf();
  check('detail pdf filename identifies viewed record',
    captured.pdf&&captured.pdf.name,'Zakat-Record-Own-1445.pdf');
  check('detail pdf includes each displayed table',
    captured.pdf&&captured.pdf.tables.length,4);
  const detailPdfText=JSON.stringify([captured.pdf.tables,captured.pdf.texts]);
  check('detail pdf replaces Bengali currency with BDT',
    detailPdfText.includes('BDT 1,000.00')&&!/[৳]|টাকা/.test(detailPdfText),true);
  check('detail pdf includes attachment metadata',
    captured.pdf&&captured.pdf.tables[0].body.find(row=>row[0]==='Reference PDF')[1],'nisab-guidance.pdf');
  check('detail pdf matches displayed payment empty state',
    captured.pdf&&captured.pdf.tables[3].body[0][0],'2024-01-10');
  viewZakatRecord('wife-1445');
  captured.sheets.length=0;captured.pdf=null;captured.errors.length=0;
  exportZakatDetailExcel();
  check('detail excel includes empty payment state',
    captured.sheets[0].aoa.find(row=>row[0]==='No payments recorded.'),['No payments recorded.','','','']);
  exportZakatDetailPdf();
  check('detail pdf includes empty payment state',
    captured.pdf&&captured.pdf.tables[3].body[0][0],'No payments recorded.');
  check('no console errors during detail exports',captured.errors,[]);

  globalThis.__results=results;
})();
