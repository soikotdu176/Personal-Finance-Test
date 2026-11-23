/* Temporary harness: evaluates app.js in a stub environment and exercises the transfer math. */
const fs=require('fs');
const vm=require('vm');
const path=require('path');

const file=path.join(__dirname,'app.js');
let source=fs.readFileSync(file,'utf8');
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
  document:anyFn,
  window:anyFn,
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
  XLSX:anyFn,
  jspdf:anyFn,
  JSZip:anyFn,
  print:()=>{}
};
sandbox.globalThis=sandbox;

const tests=fs.readFileSync(path.join(__dirname,'_transfer_tests.js'),'utf8');
const code=source+'\n'+tests;
vm.createContext(sandbox);
try{
  vm.runInContext(code,sandbox,{filename:'app.js+transfer-tests'});
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
