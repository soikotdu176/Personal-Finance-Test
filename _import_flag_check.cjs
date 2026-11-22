/* Temporary runner: evaluates app.js in a stub environment for the migration-import account tests. */
const fs=require('fs');
const vm=require('vm');
const path=require('path');

let source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
source=source.replace(/init\(\)\s*\.catch\(showFatal\);\s*$/,'');

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

const sandbox={
  console:{log:()=>{},warn:()=>{},error:(...a)=>console.error('[app]',...a),info:()=>{}},
  document:anyFn,window:anyFn,navigator:anyFn,location:anyFn,localStorage:anyFn,indexedDB:anyFn,
  crypto:{randomUUID:()=>'uuid-'+Math.random().toString(16).slice(2)},
  setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},requestAnimationFrame:()=>0,
  matchMedia:()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}),
  fetch:()=>Promise.reject(new Error('offline')),
  Blob:function(){},URL:anyFn,Chart:function(){return {destroy(){}}},
  jspdf:anyFn,JSZip:anyFn,print:()=>{}
};
/* SheetJS stub: tests assign XLSX.workbook, and every sheet carries its own `aoa` grid. */
sandbox.XLSX={
  workbook:null,
  read(){return this.workbook},
  utils:{
    sheet_to_json(sheet){return (sheet&&sheet.aoa)||[]},
    book_new(){return {SheetNames:[],Sheets:{}}},
    book_append_sheet(){},aoa_to_sheet(){return {}}
  },
  writeFile(){},write(){}
};
sandbox.globalThis=sandbox;

const tests=fs.readFileSync(path.join(__dirname,process.argv[2]||'_import_flag_tests.js'),'utf8');
vm.createContext(sandbox);
(async()=>{
  try{
    await vm.runInContext(source+'\n'+tests,sandbox,{filename:'app.js+import-tests'});
  }catch(error){
    console.error('EVALUATION FAILED:',(error&&error.stack)||error);
    process.exit(1);
  }
  let failed=0;
  for(const r of sandbox.__results||[]){
    if(!r.ok)failed++;
    console.log(`${r.ok?'PASS':'FAIL'} | ${r.name} | actual=${JSON.stringify(r.actual)} expected=${JSON.stringify(r.expected)}`);
  }
  console.log(`\n${(sandbox.__results||[]).length-failed}/${(sandbox.__results||[]).length} checks passed`);
  process.exit(failed?1:0);
})();
