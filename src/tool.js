import {createServer} from 'node:http';
import {readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync} from 'node:fs';
import {dirname} from 'node:path';

async function readBody(req) {
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)throw Object.assign(Error('body_limit'),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('invalid_json'),{status:400});}
}
const own=(object,key)=>object&&Object.hasOwn(object,key)?object[key]:undefined;
const setOwn=(object,key,value)=>Object.defineProperty(object,key,{value,enumerable:true,configurable:true,writable:true});

function persist(file, state, fault = () => {}) {
  const temp = `${file}.tmp`;
  const fd = openSync(temp, 'w', 0o600);
  try {writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd);} finally {closeSync(fd);}
  fault('before_rename');
  renameSync(temp, file);
  fault('after_rename');
  const directory = openSync(dirname(file), 'r');
  try {fsyncSync(directory);} finally {closeSync(directory);}
}

function load(file) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.effects) || !state.keys ||
        typeof state.keys !== 'object' || Array.isArray(state.keys) || state.effects.length > 1000) throw Error('invalid ledger');
    for (const [index,effect] of state.effects.entries()) {
      if (effect?.id!==index+1 || !Number.isSafeInteger(effect.createdAt)||effect.createdAt<0 || typeof effect.intentId !== 'string' || !valid({key:'x', intentId:effect.intentId, payload:effect.payload})) throw Error('invalid ledger');
    }
    for (const record of Object.values(state.keys)) {
      if (!Number.isSafeInteger(record?.id) || typeof record.intentId !== 'string' || typeof record.binding !== 'string' ||
          !Number.isSafeInteger(record.createdAt) || !Number.isSafeInteger(record.expiresAt)) throw Error('invalid ledger');
      const effect=state.effects[record.id-1];
      if(!effect||record.intentId!==effect.intentId||record.createdAt!==effect.createdAt||record.expiresAt<=record.createdAt||
        record.binding!==JSON.stringify([effect.intentId,effect.payload.kind,effect.payload.value]))throw Error('invalid ledger');
    }
    if(state.fenced!==undefined&&typeof state.fenced!=='boolean')throw Error('invalid ledger');
    if(state.fenced){
      const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
      if(!object(state.epochs)||!object(state.bindings)||Object.keys(state.epochs).length>1000||
        Object.keys(state.epochs).sort().join(',')!==Object.keys(state.bindings).sort().join(','))throw Error('invalid ledger');
      for(const [intentId,epoch]of Object.entries(state.epochs)){
        if(!Number.isSafeInteger(epoch)||epoch<1||!Number.isSafeInteger(epoch+1))throw Error('invalid ledger');
        let binding;try{binding=JSON.parse(own(state.bindings,intentId));}catch{throw Error('invalid ledger');}
        if(!Array.isArray(binding)||binding.length!==3||binding[0]!==intentId||
          !valid({key:'validation',intentId,payload:{kind:binding[1],value:binding[2]}}))throw Error('invalid ledger');
      }
      const intents=new Set();
      for(const effect of state.effects){if(intents.has(effect.intentId)||own(state.bindings,effect.intentId)!==JSON.stringify([effect.intentId,effect.payload.kind,effect.payload.value]))throw Error('invalid ledger');intents.add(effect.intentId);}
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return {version: 1, effects: [], keys: {}};
    throw error;
  }
}

function valid(body) {
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.sort().join(',');
  return exact(body, ['key', 'intentId', 'payload']) && exact(body.payload, ['kind', 'value']) &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(body.key) && typeof body.key === 'string' &&
    typeof body.intentId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(body.intentId) &&
    ['ticket', 'notification'].includes(body.payload.kind) && typeof body.payload.value === 'string' &&
    body.payload.value.trim() && Buffer.byteLength(body.payload.value) <= 1024;
}

export async function startTool({file, clock = () => 0, retentionTicks = 100, visibilityDelay = 0, fault = () => null, persistenceFault = () => {}, responseFault = () => {}, fenced = false}) {
  if (!Number.isSafeInteger(retentionTicks) || retentionTicks < 1 ||
      !Number.isSafeInteger(visibilityDelay) || visibilityDelay < 0) throw Error('invalid time contract');
  let state = load(file), calls = 0;
  if (state.fenced !== undefined && state.fenced !== fenced) throw Error('mode mismatch');
  if (state.fenced === undefined) {if(fenced&&state.effects.length)throw Error('mode migration requires empty ledger');state.fenced=fenced;if(fenced){state.epochs={};state.bindings={};} persist(file,state,persistenceFault);}
  let failed=false;
  const persistChecked=(next)=>{try{persist(file,next,persistenceFault);state=next;}catch(error){failed=true;throw error;}};
  const server = createServer(async (req, res) => {
    const send = (status, body) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(body));};
    try {
      if(failed){send(503,{error:'persistence_uncertain'});return;}
      let now = clock();
      if (!Number.isSafeInteger(now) || now < 0) throw Error('invalid clock');
      if (req.method === 'GET' && /^\/operations\/[a-zA-Z0-9_-]{1,128}$/.test(req.url)) {
        const record = Object.hasOwn(state.keys, req.url.slice(12)) ? state.keys[req.url.slice(12)] : null;
        const visible = record && now < record.expiresAt && now >= record.createdAt + visibilityDelay;
        send(200, {status: visible ? 'committed' : 'unknown', consistency: 'eventual', watermark: now - visibilityDelay,
          ...(visible ? {id: record.id, intentId: record.intentId,payload:state.effects[record.id-1].payload} : {})});
        return;
      }
      if (req.method === 'GET' && /^\/receipts\/[a-zA-Z0-9_-]{1,128}$/.test(req.url)) {
        const intentId=req.url.slice(10);
        const effects=state.effects.filter(effect=>effect.intentId===intentId);
        if(effects.length===0){send(200,{status:'unknown',consistency:'durable_history'});return;}
        if(effects.length>1){send(200,{status:'conflict',consistency:'durable_history',count:effects.length});return;}
        const effect=effects[0];
        send(200,{status:'committed',consistency:'durable_history',id:effect.id,intentId,payload:effect.payload});
        return;
      }
      if (fenced && req.method === 'GET' && /^\/fences\/[a-zA-Z0-9_-]{1,128}$/.test(req.url)) {
        const intentId=req.url.slice(8);
        const epoch=own(state.epochs,intentId);
        if(epoch===undefined){send(200,{status:'unknown',consistency:'durable_history'});return;}
        const binding=JSON.parse(state.bindings[intentId]);
        send(200,{status:'active',consistency:'durable_history',epoch,intentId,payload:{kind:binding[1],value:binding[2]}});return;
      }
      if (fenced && req.method === 'POST' && req.url === '/fences') {
        const body=await readBody(req);
        if(failed){send(503,{error:'persistence_uncertain'});return;}
        if (!valid(body)) {send(400,{error:'invalid_operation'});return;}
        const expected=Number(req.headers['x-operation-epoch']);
        if (!Number.isSafeInteger(expected)||expected<0||expected>=Number.MAX_SAFE_INTEGER||expected!==Number(own(state.epochs,body.intentId)??0)){send(409,{error:'epoch_conflict'});return;}
        const binding=JSON.stringify([body.intentId,body.payload.kind,body.payload.value]);
        const prior=own(state.bindings,body.intentId);
        if(!prior&&Object.keys(state.epochs).length>=1000){send(429,{error:'fixture_limit'});return;}
        if(prior&&prior!==binding){send(409,{error:'intent_conflict'});return;}
        const epoch=expected+1;const next=structuredClone(state);next.epochs??={};next.bindings??={};setOwn(next.epochs,body.intentId,epoch);setOwn(next.bindings,body.intentId,binding);
        const effect=next.effects.find(item=>item.intentId===body.intentId);
        persistChecked(next);
        responseFault('fence_commit');
        send(201,effect?{epoch,status:'committed',id:effect.id,intentId:body.intentId,payload:effect.payload}:{epoch,status:'ready'});return;
      }
      if (req.method !== 'POST' || req.url !== '/operations') {send(404, {error: 'not_found'}); return;}
      const body=await readBody(req);
      if(failed){send(503,{error:'persistence_uncertain'});return;}
      if (!valid(body)) {send(400, {error: 'invalid_operation'}); return;}
      // Body arrival may cross TTL; use processing time at the atomic decision boundary.
      now=clock();
      if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+retentionTicks))throw Error('invalid clock');
      const mode = fault(++calls);
      if (mode === 'before_commit') {req.socket.destroy(); return;}
      const {key, intentId, payload} = body;
      if(fenced){
        const epoch=Number(req.headers['x-operation-epoch']);
        if(!Number.isSafeInteger(epoch)||epoch<1||epoch!==own(state.epochs,intentId)){send(409,{error:'epoch_conflict'});return;}
        if(own(state.bindings,intentId)!==JSON.stringify([intentId,payload.kind,payload.value])){send(409,{error:'intent_conflict'});return;}
        const effect=state.effects.find(item=>item.intentId===intentId);
        if(effect){send(200,{id:effect.id,intentId,disposition:'replayed'});return;}
      }
      const record = Object.hasOwn(state.keys, key) ? state.keys[key] : null;
      const binding = JSON.stringify([intentId, payload.kind, payload.value]);
      if (record && now < record.expiresAt) {
        if (record.binding !== binding) {send(409, {error: 'intent_conflict'}); return;}
        send(200, {id: record.id, intentId, disposition: 'replayed'}); return;
      }
      if (state.effects.length >= 1000) {send(429, {error: 'fixture_limit'}); return;}
      const id = state.effects.length + 1;
      const next = structuredClone(state);
      next.effects.push({id, intentId, payload, createdAt: now});
      Object.defineProperty(next.keys, key, {value: {id, intentId, binding, createdAt: now, expiresAt: now + retentionTicks}, enumerable: true, configurable: true, writable: true});
      persistChecked(next);
      if (mode === 'after_commit') {req.socket.destroy(); return;}
      send(201, {id, intentId, disposition: 'created'});
    } catch(error) {if (error.message==='response_lost') res.destroy(); else if (!res.headersSent) send(error.status??500, {error:error.status?error.message:'tool_failure'}); else res.destroy();}
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  let closed = false;
  return {url: `http://127.0.0.1:${server.address().port}`, close: () => {
    if (closed) return Promise.resolve();
    closed = true;
     return new Promise((resolve, reject) => {server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());server.closeAllConnections();});
  }};
}
