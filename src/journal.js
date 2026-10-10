import {randomUUID} from 'node:crypto';
import {readFileSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';

function validate(operation){
  return operation && /^[a-zA-Z0-9_-]{1,128}$/.test(operation.intentId) && typeof operation.intentId==='string' &&
    typeof operation.key==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(operation.key) &&
    Number.isSafeInteger(operation.firstDispatchTick)&&operation.firstDispatchTick>=0 &&
    operation.payload && Object.keys(operation.payload).sort().join(',')==='kind,value' &&
    ['ticket','notification'].includes(operation.payload.kind) && typeof operation.payload.value==='string' &&
    operation.payload.value.trim() && Buffer.byteLength(operation.payload.value)<=1024;
}

// Single-writer journal: each intent binds to one durable operation before dispatch.
export function prepareOperation({file,intentId,payload,now}){
  const candidate={key:'validation',intentId,payload,firstDispatchTick:now};
  if(!validate(candidate))throw Error('invalid operation');
  let state;
  try{state=JSON.parse(readFileSync(file,'utf8'));}catch(error){
    if(error.code!=='ENOENT')throw error;
    state={version:1,operations:[]};
  }
  if(state?.version!==1||!Array.isArray(state.operations)||state.operations.length>1000||
    state.operations.some(op=>!validate(op))||new Set(state.operations.map(op=>op.intentId)).size!==state.operations.length||
    new Set(state.operations.map(op=>op.key)).size!==state.operations.length)throw Error('invalid journal');
  const prior=state.operations.find(op=>op.intentId===intentId);
  if(prior){
    if(prior.payload.kind!==payload.kind||prior.payload.value!==payload.value)throw Error('intent conflict');
    return prior;
  }
  if(state.operations.length===1000)throw Error('journal limit');
  const operation={key:randomUUID(),intentId,payload:{kind:payload.kind,value:payload.value},firstDispatchTick:now};
  state.operations.push(operation);
  const temp=`${file}.tmp`;
  const fd=openSync(temp,'w',0o600);
  try{writeFileSync(fd,JSON.stringify(state));fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,file);
  const directory=openSync(dirname(file),'r');
  try{fsyncSync(directory);}finally{closeSync(directory);}
  return operation;
}
