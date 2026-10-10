import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request} from 'node:http';
import {startTool} from '../src/tool.js';
const body={key:'op-1',intentId:'intent-1',payload:{kind:'ticket',value:'Repair pump'}};
const post=(tool,path,epoch)=>fetch(tool.url+path,{method:'POST',headers:{'x-operation-epoch':String(epoch)},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'fenced-tool-'));const file=join(dir,'ledger.json');let tick=0;const tool=await startTool({file,fenced:true,retentionTicks:2,clock:()=>tick});t.after(async()=>{await tool.close();await rm(dir,{recursive:true});});return {...tool,file,advance:()=>{tick=3;}};}
test('fence rejects old in-flight generation after new generation commits',async t=>{
 const tool=await fixture(t);
 assert.equal((await post(tool,'/fences',0)).status,201);
 const text=JSON.stringify(body);let pending;
 const finished=new Promise((resolve,reject)=>{pending=request(tool.url+'/operations',{method:'POST',headers:{'x-operation-epoch':'1','content-length':Buffer.byteLength(text)}},r=>{r.resume();r.once('end',()=>resolve(r.statusCode));});pending.once('error',reject);});
 pending.write(text.slice(0,-1));
 try{const fence=await post(tool,'/fences',1);assert.equal(fence.status,201);assert.deepEqual(await fence.json(),{epoch:2,status:'ready'});assert.equal((await post(tool,'/operations',2)).status,201);pending.end(text.slice(-1));assert.equal(await finished,409);assert.equal(JSON.parse(await readFile(tool.file,'utf8')).effects.length,1);}finally{pending.destroy();await finished.catch(()=>{});}
});
test('committed intent stays one effect after key expiry and fencing',async t=>{
 const tool=await fixture(t);await post(tool,'/fences',0);assert.equal((await post(tool,'/operations',1)).status,201);tool.advance();assert.equal((await post(tool,'/operations',1)).status,200);const response=await post(tool,'/fences',1);assert.equal((await response.json()).status,'committed');assert.equal((await post(tool,'/operations',1)).status,409);assert.equal((await post(tool,'/operations',2)).status,200);assert.equal(JSON.parse(await readFile(tool.file,'utf8')).effects.length,1);
});
test('fenced service cannot be reopened without fencing',async t=>{
 const tool=await fixture(t);await post(tool,'/fences',0);await tool.close();await assert.rejects(startTool({file:tool.file}),/mode/);
});

test('restart rejects corrupted epoch, binding, effect identity and key linkage',async t=>{
 const tool=await fixture(t);await post(tool,'/fences',0);await post(tool,'/operations',1);await tool.close();
 const original=JSON.parse(await readFile(tool.file,'utf8'));
 for(const corrupt of [s=>{s.epochs['intent-1']=0;},s=>{s.bindings['intent-1']='wrong';},s=>{s.effects[0].id=99;},s=>{s.keys['op-1'].id=99;},s=>{delete s.epochs;}]){
  const state=structuredClone(original);corrupt(state);await writeFile(tool.file,JSON.stringify(state));
  await assert.rejects(startTool({file:tool.file,fenced:true}),/invalid ledger/);
 }
});

test('lost fence response preserves epoch and recovery read prevents blind epoch advance',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fence-response-loss-'));const file=join(dir,'ledger.json');let tool,reopened;
 try{
  tool=await startTool({file,fenced:true,responseFault:stage=>{if(stage==='fence_commit')throw Object.assign(Error('response_lost'),{status:599});}});
  await assert.rejects(fetch(tool.url+'/fences',{method:'POST',headers:{'x-operation-epoch':'0'},body:JSON.stringify(body)}));
  assert.equal((await fetch(tool.url+'/fences',{method:'POST',headers:{'x-operation-epoch':'0'},body:JSON.stringify(body)})).status,409);
  assert.equal((await fetch(tool.url+'/fences/intent-1')).status,200);
  assert.deepEqual(await (await fetch(tool.url+'/fences/intent-1')).json(),{status:'active',consistency:'durable_history',epoch:1,intentId:'intent-1',payload:body.payload});
  await tool.close();reopened=await startTool({file,fenced:true});
  const recovered=await (await fetch(reopened.url+'/fences/intent-1')).json();assert.equal(recovered.epoch,1);
  assert.equal((await post(reopened,'/operations',1)).status,201);
  assert.equal(JSON.parse(await readFile(file,'utf8')).effects.length,1);
 }finally{await tool?.close();await reopened?.close();await rm(dir,{recursive:true});}
});
