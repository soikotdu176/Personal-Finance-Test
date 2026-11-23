/* Temporary runner: evaluates app.js in a stub environment for the office parser tests. */
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
  XLSX:anyFn,jspdf:anyFn,JSZip:anyFn,print:()=>{}
};
sandbox.globalThis=sandbox;

const tests=fs.readFileSync(path.join(__dirname,'_office_parse_tests.js'),'utf8');
vm.createContext(sandbox);
try{
  vm.runInContext(source+'\n'+tests,sandbox,{filename:'app.js+office-tests'});
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
