import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request} from 'node:http';
import {startTool} from '../src/tool.js';

const body={key:'op-1',intentId:'intent-1',payload:{kind:'ticket',value:'Repair pump'}};
const post=(tool,data=body)=>fetch(tool.url+'/operations',{method:'POST',body:JSON.stringify(data),signal:AbortSignal.timeout(3000)});

test('uncertain persistence failure blocks stale reads and subsequent writes until restart',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'persist-failure-'));const file=join(dir,'ledger.json');
 let tool,reopened;
 try{
  let writes=0;
  tool=await startTool({file,persistenceFault:stage=>{if(stage==='after_rename'&&++writes===2)throw Error('simulated directory fsync failure');}});
  assert.equal((await post(tool)).status,500);
  assert.equal(JSON.parse(await readFile(file,'utf8')).effects.length,1);
  assert.equal((await fetch(tool.url+'/receipts/intent-1')).status,503);
  assert.equal((await post(tool,{...body,key:'op-2',intentId:'intent-2'})).status,503);
  assert.equal(JSON.parse(await readFile(file,'utf8')).effects.length,1);
  await tool.close();
  reopened=await startTool({file});
  assert.equal((await post(reopened)).status,200);
  assert.equal((await post(reopened,{...body,key:'op-2',intentId:'intent-2'})).status,201);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).effects.map(e=>e.intentId),['intent-1','intent-2']);
 }finally{await tool?.close();await reopened?.close();await rm(dir,{recursive:true});}
});

test('failure before rename preserves old ledger and still requires restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'persist-before-'));const file=join(dir,'ledger.json');let tool,reopened;
 try{
  let writes=0;
  tool=await startTool({file,persistenceFault:stage=>{if(stage==='before_rename'&&++writes===2)throw Error('arbitrary storage failure');}});
  assert.equal((await post(tool)).status,500);
  assert.equal(JSON.parse(await readFile(file,'utf8')).effects.length,0);
  assert.equal((await post(tool)).status,503);
  await tool.close();reopened=await startTool({file});assert.equal((await post(reopened)).status,201);
  assert.equal(JSON.parse(await readFile(file,'utf8')).effects.length,1);
 }finally{await tool?.close();await reopened?.close();await rm(dir,{recursive:true});}
});

test('request already awaiting a body cannot write after another request poisons persistence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'persist-inflight-'));const file=join(dir,'ledger.json');let tool,pending,finished;
 try{
  let writes=0;tool=await startTool({file,persistenceFault:stage=>{if(stage==='after_rename'&&++writes===2)throw Error('arbitrary persistence error');}});
  const text=JSON.stringify({...body,key:'old-request',intentId:'other-intent'});
  finished=new Promise((resolve,reject)=>{pending=request(tool.url+'/operations',{method:'POST',headers:{'content-length':Buffer.byteLength(text)}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});pending.once('error',reject);});
  pending.write(text.slice(0,-1));
  await fetch(tool.url+'/receipts/other-intent').then(r=>r.arrayBuffer());
  assert.equal((await post(tool)).status,500);
  pending.end(text.slice(-1));assert.equal(await finished,503);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')).effects.map(e=>e.intentId),['intent-1']);
 }finally{pending?.destroy();if(finished)await finished.catch(()=>{});await tool?.close();await rm(dir,{recursive:true});}
});
