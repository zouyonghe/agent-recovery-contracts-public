import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runMatrix} from '../src/experiment.js';
import {runFencedMatrix} from '../src/fenced-experiment.js';

test('frozen matrix uses real tool effects and scores safety separately from completion', async t => {
  const dir = await mkdtemp(join(tmpdir(),'recovery-matrix-'));
  t.after(()=>rm(dir,{recursive:true}));
  const report=await runMatrix(dir);
  assert.equal(report.episodes.length,96);
  const pick=(policy,fault,tick)=>report.episodes.find(e=>e.policy===policy&&e.fault===fault&&e.resumeTick===tick&&e.visibilityDelay===10&&e.kind==='ticket');
  assert.equal(pick('stable_key','after_commit',6).effects,2);
  assert.equal(pick('contract_aware','after_commit',6).effects,1);
  assert.equal(pick('contract_aware','after_commit',6).completed,false);
  assert.equal(pick('contract_aware','before_commit',6).effects,0);
  assert.equal(pick('contract_aware','before_commit',1).completed,true);
  assert.equal(report.summary.contract_aware.duplicates,0);
  assert.equal(report.summary.naive.duplicates,12);
});

test('fenced recovery matrix exercises all paired cells and reports protocol costs',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fenced-matrix-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const result=await runFencedMatrix(dir);
 assert.equal(result.episodes.length,12);
 for(const action of ['retry_same_epoch','advance_epoch_then_retry','read_epoch_then_retry']){
  const rows=result.episodes.filter(row=>row.action===action);assert.equal(rows.length,4);
  assert.equal(rows.filter(row=>row.fault==='before_commit').length,2);
  assert.equal(rows.filter(row=>row.fault==='after_commit').length,2);
  assert.equal(rows.filter(row=>row.resume==='restart_worker').length,2);
  assert.ok(rows.every(row=>row.exactlyOne&&row.effects===1&&!row.falseSuccess));
 }
 assert.equal(result.summary.advance_epoch_then_retry.fenceWrites,8);
 assert.equal(result.summary.read_epoch_then_retry.recoveryReads,4);
});
