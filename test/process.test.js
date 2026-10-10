import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareOperation} from '../src/journal.js';

async function launch(t,file,fault){
  const child=fork(new URL('../fixtures/tool-worker.js',import.meta.url),[file,fault],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',data=>{stderr+=data;});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}});
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('worker startup timeout '+stderr));},3000);
    child.once('message',message=>{clearTimeout(timer);resolve(message.url);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('worker exited '+code+' '+stderr));});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  return {child,url};
}

async function launchFenced(t,file,mode){
  const child=fork(new URL('../fixtures/fenced-worker.js',import.meta.url),[file,mode],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',data=>{stderr+=data;});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}});
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('fenced worker startup timeout '+stderr));},3000);
    child.once('message',message=>{clearTimeout(timer);resolve(message.url);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('fenced worker exited '+code+' '+stderr));});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  return {child,url};
}

test('SIGKILL and separate worker restart preserve journal key and committed effect',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'process-recovery-'));
  // Hooks close processes before directory cleanup by explicit shutdown below.
  const file=join(dir,'ledger.json'),journal=join(dir,'journal.json');
  const operation=prepareOperation({file:journal,intentId:'intent-1',payload:{kind:'ticket',value:'Repair pump'},now:0});
  const post=url=>{const {firstDispatchTick,...body}=operation;return fetch(url+'/operations',{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});};
  let first,second;
  try{
    first=await launch(t,file,'after_commit');
    await assert.rejects(post(first.url));
    assert.equal(JSON.parse(await readFile(file,'utf8')).effects.length,1);
    const stopped=once(first.child,'exit');first.child.kill('SIGKILL');await stopped;
    const restored=prepareOperation({file:journal,intentId:'intent-1',payload:operation.payload,now:1});
    assert.deepEqual(restored,operation);
    second=await launch(t,file,'none');
    const response=await post(second.url);
    assert.equal(response.status,200);
    assert.equal((await response.json()).disposition,'replayed');
    assert.equal(JSON.parse(await readFile(file,'utf8')).effects.length,1);
  }finally{
    for(const worker of [first,second])if(worker&&worker.child.exitCode===null&&worker.child.signalCode===null){const done=once(worker.child,'exit');worker.child.kill('SIGKILL');await done;}
    await rm(dir,{recursive:true});
  }
});

test('independent controller recovers durable fence after worker response loss',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fenced-process-recovery-'));
  const file=join(dir,'ledger.json');const body={key:'op-1',intentId:'intent-1',payload:{kind:'ticket',value:'Repair pump'}};
  const fence=(url,epoch)=>fetch(url+'/fences',{method:'POST',headers:{'x-operation-epoch':String(epoch)},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
  let first,second;
  try{
    first=await launchFenced(t,file,'response_lost');
    await assert.rejects(fence(first.url,0));
    const stopped=once(first.child,'exit');first.child.kill('SIGKILL');await stopped;
    second=await launchFenced(t,file,'none');
    const recovered=await (await fetch(second.url+'/fences/intent-1')).json();
    assert.equal(recovered.epoch,1);assert.equal(recovered.intentId,'intent-1');
    assert.equal((await fence(second.url,0)).status,409);
    const committed=await fetch(second.url+'/operations',{method:'POST',headers:{'x-operation-epoch':'1'},body:JSON.stringify(body)});
    assert.equal(committed.status,201);assert.equal(JSON.parse(await readFile(file,'utf8')).effects.length,1);
  }finally{
    for(const worker of [first,second])if(worker&&worker.child.exitCode===null&&worker.child.signalCode===null){const done=once(worker.child,'exit');worker.child.kill('SIGKILL');await done;}
    await rm(dir,{recursive:true});
  }
});
