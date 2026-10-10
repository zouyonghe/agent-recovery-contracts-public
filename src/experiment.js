import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startTool} from './tool.js';
import {decideRecovery} from './recovery.js';
import {prepareOperation} from './journal.js';

const policies=['naive','stable_key','verify_before_retry','contract_aware'];

export async function runMatrix(directory,{durableReceipts=false}={}) {
  const episodes=[];
  for (const kind of ['ticket','notification']) for (const fault of ['before_commit','after_commit'])
    for (const resumeTick of [1,4,6]) for (const visibilityDelay of [0,10]) for (const policy of policies) {
      const index=episodes.length;
      const dir=join(directory,`episode-${index}`);
      await mkdir(dir); // Refuse reused evidence directories.
      const file=join(dir,'ledger.json');
      let tick=0;
      const tool=await startTool({file,clock:()=>tick,retentionTicks:5,visibilityDelay,fault:call=>call===1?fault:null});
      try {
        const journal=join(dir,'journal.json');
        const operation=prepareOperation({file:journal,intentId:'intent-1',now:0,payload:{kind,value:'Research fixture'}});
        const post=async key=> {
          const {firstDispatchTick,...body}=operation;
          const response=await fetch(`${tool.url}/operations`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,key}),signal:AbortSignal.timeout(3000)});
          if (!response.ok) throw Error(`tool status ${response.status}`);
          return response.json();
        };
        let ambiguous=false;
        try {await post(operation.key);} catch (error) {
          if (!(error instanceof TypeError) || !error.message.includes('fetch failed')) throw error;
          ambiguous=true;
        }
        if (!ambiguous) throw Error('configured initial fault did not produce ambiguous observation');
        tick=resumeTick;
        const restored=prepareOperation({file:journal,intentId:operation.intentId,payload:operation.payload,now:tick});
        if(restored.key!==operation.key||restored.firstDispatchTick!==operation.firstDispatchTick)throw Error('operation journal identity drift');
        let observation={status:'unknown'},queries=0;
        if (policy==='verify_before_retry'||policy==='contract_aware') {
          const response=await fetch(`${tool.url}/operations/${operation.key}`,{signal:AbortSignal.timeout(3000)});
          if (!response.ok) throw Error(`query status ${response.status}`);
          observation=await response.json();queries++;
          if(durableReceipts && policy==='contract_aware' && observation.status==='unknown'){
            const receipt=await fetch(`${tool.url}/receipts/${operation.intentId}`,{signal:AbortSignal.timeout(3000)});
            if(!receipt.ok)throw Error(`receipt status ${receipt.status}`);
            observation=await receipt.json();queries++;
          }
        }
        const decision=decideRecovery({policy,operation,contract:{retentionTicks:5,dispatchBoundTicks:1},now:tick,observation});
        let result=null,retries=0;
        if (decision.action==='retry') {result=await post(policy==='naive'?'new-attempt-key':operation.key);retries++;}
        const state=JSON.parse(await readFile(file,'utf8').catch(error=>{
          if(error.code==='ENOENT')return '{"effects":[]}';throw error;
        }));
        const effects=state.effects.filter(e=>e.intentId===operation.intentId);
        const completed=decision.action==='complete'||result!==null;
        const claimedId=result?.id??decision.id??null;
        episodes.push({index,kind,fault,resumeTick,visibilityDelay,policy,decision,queries,retries,
          effects:effects.length,exactlyOne:effects.length===1,completed,
          falseSuccess:completed&&(effects.length!==1||effects[0].id!==claimedId)});
      } finally {await tool.close();}
    }
  const summary={};
  for(const policy of policies){
    const rows=episodes.filter(e=>e.policy===policy);
    summary[policy]={episodes:rows.length,duplicates:rows.filter(e=>e.effects>1).length,
      missed:rows.filter(e=>e.effects===0).length,exactlyOne:rows.filter(e=>e.exactlyOne).length,
      completed:rows.filter(e=>e.completed).length,unresolved:rows.filter(e=>!e.completed).length,
      falseSuccess:rows.filter(e=>e.falseSuccess).length,queries:rows.reduce((s,e)=>s+e.queries,0),retries:rows.reduce((s,e)=>s+e.retries,0)};
  }
  return {protocol:durableReceipts?'recovery-matrix-v0.3-durable-receipts':'recovery-matrix-v0.2-durable-journal',policyType:'deterministic_controls_not_llm',episodes,summary};
}
