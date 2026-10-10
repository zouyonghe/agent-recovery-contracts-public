import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startTool} from './tool.js';

export async function runFencedMatrix(directory){
 const episodes=[];
  for(const fault of ['before_commit','after_commit'])for(const resume of ['same_worker','restart_worker'])for(const action of ['retry_same_epoch','advance_epoch_then_retry','read_epoch_then_retry']){
  const index=episodes.length,dir=join(directory,`fenced-${index}`);await mkdir(dir);
  const file=join(dir,'ledger.json'),body={key:'op-1',intentId:'intent-1',payload:{kind:'ticket',value:'Research fixture'}};
  let worker,workerStarts=0,tick=0;
  const start=async injectFault=>{let calls=0;worker=await startTool({file,fenced:true,clock:()=>tick,retentionTicks:5,fault:()=>++calls===1&&injectFault?fault:null});workerStarts++;return worker;};
  let fences=0,recoveryReads=0,operationWrites=0,failed=false,claimed=false,claimId=null;
  const fence=async epoch=>{fences++;return fetch(worker.url+'/fences',{method:'POST',headers:{'x-operation-epoch':String(epoch)},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});};
  const write=async epoch=>{operationWrites++;return fetch(worker.url+'/operations',{method:'POST',headers:{'x-operation-epoch':String(epoch)},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});};
  try{
   await start(false);const admitted=await fence(0);if(!admitted.ok)throw Error(`initial fence ${admitted.status}`);const epoch=(await admitted.json()).epoch;
   if(resume==='restart_worker'){await worker.close();worker=null;await start(true);}
   else {let calls=0;const first=worker;worker=await startTool({file,fenced:true,clock:()=>tick,retentionTicks:5,fault:()=>++calls===1?fault:null});workerStarts++;await first.close();}
   try{await write(epoch);}catch(error){if(!(error instanceof TypeError))throw error;failed=true;}
   if(!failed)throw Error('fault did not produce ambiguous request');
   tick=1;
   if(action==='advance_epoch_then_retry'){
    const next=await fence(epoch);if(next.status===201){const result=await next.json();if(result.status==='committed'){claimed=true;claimId=result.id;}else{
      const response=await write(result.epoch);if(!response.ok)throw Error(`replacement write ${response.status}`);claimed=true;claimId=(await response.json()).id;
    }}else throw Error(`fence ${next.status}`);
   }else if(action==='read_epoch_then_retry'){
     if(resume==='restart_worker'){await worker.close();worker=null;await start(false);}
    recoveryReads++;const state=await (await fetch(worker.url+'/fences/intent-1')).json();
    if(state.status==='active'){
      const response=await write(state.epoch);
      if(!response.ok)throw Error(`recovery write ${response.status}`);
      claimed=true;claimId=(await response.json()).id;
    }else throw Error(`recovery state ${state.status}`);
   }else{
     if(resume==='restart_worker'){await worker.close();worker=null;await start(false);}
    const response=await write(epoch);
    if(response.ok){claimed=true;claimId=(await response.json()).id;}
    else if(response.status!==409)throw Error(`retry ${response.status}`);
   }
   const state=JSON.parse(await readFile(file,'utf8')),effects=state.effects.filter(e=>e.intentId===body.intentId);
   episodes.push({index,fault,resume,action,fences,recoveryReads,operationWrites,workerStarts,effects:effects.length,completed:claimed,exactlyOne:effects.length===1,falseSuccess:claimed&&(effects.length!==1||effects[0].id!==claimId)});
  }finally{await worker?.close();}
 }
 const summary={};for(const action of ['retry_same_epoch','advance_epoch_then_retry','read_epoch_then_retry']){const rows=episodes.filter(e=>e.action===action);summary[action]={episodes:rows.length,duplicates:rows.filter(e=>e.effects>1).length,missed:rows.filter(e=>e.effects===0).length,completed:rows.filter(e=>e.completed).length,unresolved:rows.filter(e=>!e.completed).length,falseSuccess:rows.filter(e=>e.falseSuccess).length,fenceWrites:rows.reduce((n,e)=>n+e.fences,0),recoveryReads:rows.reduce((n,e)=>n+e.recoveryReads,0),operationWrites:rows.reduce((n,e)=>n+e.operationWrites,0),workerStarts:rows.reduce((n,e)=>n+e.workerStarts,0)};}
 return {protocol:'fenced-recovery-v0.1',policyType:'deterministic_service_contract_controls_not_llm',costUnits:'HTTP fence/query/operation requests; excludes bytes, latency and storage fsync cost',episodes,summary};
}
