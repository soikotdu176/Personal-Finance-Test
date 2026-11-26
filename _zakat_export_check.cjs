/* Temporary harness: evaluates app.js in a stub environment and exercises the Zakat
   PDF/Excel exports against the shared ledger used by the Zakat Dashboard. */
const fs=require('fs');
const vm=require('vm');
const path=require('path');

const file=path.join(__dirname,'app.js');
let source=fs.readFileSync(file,'utf8');
source=source.replace(/init\(\)\s*\.catch\(showFatal\);\s*$/,'');

const captured={sheets:[],file:null,pdf:null,errors:[]};

const anyFn=new Proxy(function(){},{
  get(target,prop){
    if(prop===Symbol.iterator)return function*(){};
    if(prop===Symbol.toPrimitive)return ()=>'';
    if(prop==='then')return undefined;
    if(prop==='length')return 0;
    return anyFn;
  },
  set(){return true},
  apply(){return anyFn},
  construct(){return anyFn},
  has(){return true}
});

const elements=new Map();
const elOf=id=>{
  if(!elements.has(id)){
    elements.set(id,{
      id,value:'',textContent:'',innerHTML:'',className:'',style:{},dataset:{},open:false,
      classList:{add(){},remove(){},toggle(){},contains:()=>false},
      appendChild(){},remove(){},querySelectorAll:()=>[],addEventListener(){},
      setAttribute(){},getAttribute:()=>null,showModal(){},close(){},scrollIntoView(){}
    });
  }
  return elements.get(id);
};

const XLSX={
  utils:{
    book_new:()=>({SheetNames:[],Sheets:{}}),
    aoa_to_sheet:aoa=>{const sheet={aoa};captured.sheets.push(sheet);return sheet},
    book_append_sheet:(workbook,sheet,name)=>{workbook.SheetNames.push(name);workbook.Sheets[name]=sheet}
  },
  writeFile:(workbook,fileName)=>{captured.file=fileName;captured.workbook=workbook}
};

class FakeDoc{
  constructor(options){
    this.options=options;this.tables=[];this.texts=[];
    this.internal={pageSize:{getHeight:()=>595.28,getWidth:()=>841.89},pages:[{}]};
  }
  setFont(){}setFontSize(){}setTextColor(){}setProperties(){}addPage(){}
  text(...args){this.texts.push(args)}
  autoTable(config){this.tables.push(config);this.lastAutoTable={finalY:(config.startY||66)+(config.body||[]).length*12}}
  save(name){captured.pdf={name,tables:this.tables,texts:this.texts,options:this.options}}
}

const documentStub={
  getElementById:elOf,
  createElement:()=>elOf('__el-'+Math.random()),
  querySelectorAll:()=>[],
  querySelector:()=>null,
  addEventListener(){},
  documentElement:elOf('__documentElement'),
  body:elOf('__body'),
  head:elOf('__head')
};

const sandbox={
  console:{log:()=>{},warn:()=>{},error:(...a)=>captured.errors.push(a.map(String).join(' ')),info:()=>{}},
  document:new Proxy(documentStub,{get(target,prop){return prop in target?target[prop]:anyFn}}),
  window:null,
  navigator:anyFn,
  location:anyFn,
  localStorage:anyFn,
  indexedDB:anyFn,
  crypto:{randomUUID:()=>'uuid-'+Math.random().toString(16).slice(2)},
  setTimeout:()=>0,
  clearTimeout:()=>{},
  setInterval:()=>0,
  clearInterval:()=>{},
  requestAnimationFrame:()=>0,
  matchMedia:()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}),
  fetch:()=>Promise.reject(new Error('offline')),
  Blob:function(){},
  URL:anyFn,
  Chart:function(){return {destroy(){}}},
  XLSX,
  jspdf:{jsPDF:FakeDoc},
  JSZip:anyFn,
  print:()=>{}
};
sandbox.window=new Proxy({
  document:sandbox.document,XLSX,jspdf:{jsPDF:FakeDoc},JSZip:anyFn,
  matchMedia:sandbox.matchMedia,localStorage:anyFn,location:anyFn,addEventListener(){},setTimeout:()=>0
},{get(target,prop){return prop in target?target[prop]:anyFn}});
sandbox.__captured=captured;
sandbox.__el=elOf;
sandbox.globalThis=sandbox;

const tests=fs.readFileSync(path.join(__dirname,'_zakat_export_tests.js'),'utf8');
vm.createContext(sandbox);
try{
  vm.runInContext(source+'\n'+tests,sandbox,{filename:'app.js+zakat-export-tests'});
}catch(error){
  console.error('EVALUATION FAILED:',(error&&error.stack)||error);
  process.exit(1);
}
const results=sandbox.__results||[];
let failed=0;
for(const result of results){
  if(!result.ok)failed++;
  console.log(`${result.ok?'PASS':'FAIL'} | ${result.name} | actual=${JSON.stringify(result.actual)} expected=${JSON.stringify(result.expected)}`);
}
console.log(`\n${results.length-failed}/${results.length} checks passed`);
process.exit(failed?1:0);
