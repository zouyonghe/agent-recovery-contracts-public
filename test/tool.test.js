import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request as httpRequest} from 'node:http';
import {startTool} from '../src/tool.js';

const request = {key: 'op-1', intentId: 'intent-1', payload: {kind: 'ticket', value: 'Repair pump'}};

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'recovery-tool-'));
  const file = join(dir, 'ledger.json');
  const tool = await startTool({file, ...options});
  t.after(async () => {await tool.close(); await rm(dir, {recursive: true});});
  return {...tool, file};
}

function post(tool, body = request) {
  return fetch(`${tool.url}/operations`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
  });
}

test('lost response after commit replays exactly one persisted effect', async t => {
  const tool = await fixture(t, {fault: call => call === 1 ? 'after_commit' : null});
  await assert.rejects(post(tool), /fetch failed/);
  const state = JSON.parse(await readFile(tool.file, 'utf8'));
  assert.equal(state.effects.length, 1);
  const replay = await post(tool);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), {id: 1, intentId: 'intent-1', disposition: 'replayed'});
  assert.equal(JSON.parse(await readFile(tool.file, 'utf8')).effects.length, 1);
});

test('same key changed intent fails closed; equal payload new intent stays independent', async t => {
  const tool = await fixture(t);
  assert.equal((await post(tool)).status, 201);
  assert.equal((await post(tool, {...request, intentId: 'intent-2'})).status, 409);
  assert.equal((await post(tool, {...request, key: 'op-2', intentId: 'intent-2'})).status, 201);
  assert.equal(JSON.parse(await readFile(tool.file, 'utf8')).effects.length, 2);
});

test('precommit disconnect leaves no effect, retry creates one', async t => {
  const tool = await fixture(t, {fault: call => call === 1 ? 'before_commit' : null});
  await assert.rejects(post(tool));
  assert.equal((await post(tool)).status, 201);
  assert.equal(JSON.parse(await readFile(tool.file, 'utf8')).effects.length, 1);
});

test('stale query says unknown despite committed effect; expiry permits duplicate', async t => {
  let tick = 0;
  const tool = await fixture(t, {clock: () => tick, retentionTicks: 5, visibilityDelay: 2});
  assert.equal((await post(tool)).status, 201);
  const query = () => fetch(`${tool.url}/operations/op-1`).then(r => r.json());
  assert.equal((await query()).status, 'unknown');
  tick = 2;
  assert.equal((await query()).status, 'committed');
  tick = 4;
  assert.equal((await post(tool)).status, 200);
  tick = 5;
  assert.equal((await query()).status, 'unknown');
  assert.equal((await post(tool)).status, 201);
  assert.equal(JSON.parse(await readFile(tool.file, 'utf8')).effects.length, 2);
});

test('concurrent requests in one owner produce one effect and replay after reopen', async t => {
  const tool = await fixture(t);
  const responses = await Promise.all(Array.from({length: 10}, () => post(tool)));
  assert.equal(responses.filter(r => r.status === 201).length, 1);
  assert.equal(responses.filter(r => r.status === 200).length, 9);
  await tool.close();
  const reopened = await startTool({file: tool.file});
  t.after(() => reopened.close());
  assert.equal((await post(reopened)).status, 200);
  assert.equal(JSON.parse(await readFile(tool.file, 'utf8')).effects.length, 1);
});

test('bad payload and unknown fields never mutate ledger', async t => {
  const tool = await fixture(t);
  for (const body of [null, {}, {...request, extra: true}, {...request, key: 123},
    {...request, payload: {...request.payload, value: 'x'.repeat(1025)}}]) {
    assert.equal((await post(tool, body)).status, 400);
  }
  assert.equal((await post(tool)).status, 201);
  assert.equal(JSON.parse(await readFile(tool.file, 'utf8')).effects.length, 1);
});

test('structurally parseable corrupt ledger fails startup rather than allowing false replay', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bad-ledger-'));
  t.after(() => rm(dir, {recursive: true}));
  const file = join(dir, 'ledger.json');
  await writeFile(file, JSON.stringify({version: 1, effects: [], keys: {'op-1': {id: 42}}}));
  await assert.rejects(startTool({file}), /invalid ledger/);
});

test('durable receipt survives key expiry and detects duplicate intent effects',async t=>{
  let tick=0;
  const tool=await fixture(t,{clock:()=>tick,retentionTicks:5});
  await post(tool);
  tick=6;
  const receipt=()=>fetch(`${tool.url}/receipts/intent-1`).then(r=>r.json());
  assert.deepEqual(await receipt(),{status:'committed',consistency:'durable_history',id:1,intentId:'intent-1',payload:request.payload});
  await post(tool);
  assert.equal((await receipt()).status,'conflict');
  const absent=await fetch(`${tool.url}/receipts/missing`).then(r=>r.json());
  assert.equal(absent.status,'unknown');
});

test('empty durable query is not a barrier against an in-flight HTTP dispatch',async t=>{
  const tool=await fixture(t);
  const body=JSON.stringify(request);
  let pending;
  const finished=new Promise((resolve,reject)=>{
    pending=httpRequest(`${tool.url}/operations`,{method:'POST',headers:{'content-length':Buffer.byteLength(body)}},res=>{
      res.resume();res.once('end',()=>resolve(res.statusCode));res.once('error',reject);
    });
    pending.once('error',reject);
  });
  t.after(()=>pending.destroy());
  // Send an incomplete real request: handler cannot commit until body completes.
  pending.write(body.slice(0,-1));
  try{
    const observation=await fetch(`${tool.url}/receipts/intent-1`).then(r=>r.json());
    assert.equal(observation.status,'unknown');
    // An unsafe reconciler interprets absence as permission for a fresh key.
    assert.equal((await post(tool,{...request,key:'replacement-key'})).status,201);
    pending.end(body.slice(-1));
    assert.equal(await finished,201);
    const effects=JSON.parse(await readFile(tool.file,'utf8')).effects;
    assert.equal(effects.filter(e=>e.intentId==='intent-1').length,2);
    assert.equal((await fetch(`${tool.url}/receipts/intent-1`).then(r=>r.json())).status,'conflict');
  }finally{pending.destroy();await finished.catch(()=>{});}
});

test('retention is evaluated at processing, not before a delayed body arrives',async t=>{
  let tick=0;
  const tool=await fixture(t,{clock:()=>tick,retentionTicks:5});
  await post(tool);
  const body=JSON.stringify(request);
  let pending;
  const finished=new Promise((resolve,reject)=>{
    pending=httpRequest(`${tool.url}/operations`,{method:'POST',headers:{'content-length':Buffer.byteLength(body)}},res=>{
      res.resume();res.once('end',()=>resolve(res.statusCode));res.once('error',reject);
    });pending.once('error',reject);
  });
  pending.write(body.slice(0,-1));
  try{
    // Allow the handler to start at tick0, then finish request at the expiry boundary.
    await fetch(`${tool.url}/receipts/intent-1`).then(r=>r.arrayBuffer());
    tick=5;
    pending.end(body.slice(-1));
    assert.equal(await finished,201);
  }finally{pending.destroy();await finished.catch(()=>{});}
});
