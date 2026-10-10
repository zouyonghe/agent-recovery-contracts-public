import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideRecovery} from '../src/recovery.js';

const operation = {key:'op-1', intentId:'intent-1', firstDispatchTick:0, payload:{kind:'ticket',value:'Repair pump'}};
const contract = {retentionTicks:5, dispatchBoundTicks:1};

test('contract-aware replay only inside guaranteed arrival window', () => {
  assert.equal(decideRecovery({policy:'contract_aware', operation, contract, now:3, observation:{status:'unknown'}}).action,'retry');
  assert.equal(decideRecovery({policy:'contract_aware', operation, contract, now:4, observation:{status:'unknown'}}).action,'reconcile');
});

test('missing dispatch history and wrong intent are never treated as safe success', () => {
  assert.equal(decideRecovery({policy:'contract_aware', operation:{...operation,firstDispatchTick:null}, contract, now:0, observation:{status:'unknown'}}).action,'reconcile');
  assert.equal(decideRecovery({policy:'contract_aware', operation, contract, now:0, observation:{status:'committed',id:1,intentId:'different'}}).action,'reconcile');
});

test('committed result for matching intent completes even after key window', () => {
  assert.deepEqual(decideRecovery({policy:'contract_aware', operation, contract, now:8, observation:{status:'committed',id:1,intentId:'intent-1',payload:operation.payload}}),{action:'complete',id:1,reason:'matching_receipt'});
});

test('baselines expose blind retry and unknown-as-absent assumptions', () => {
  for (const policy of ['naive','stable_key','verify_before_retry']) {
    assert.equal(decideRecovery({policy,operation,contract,now:10,observation:{status:'unknown'}}).action,'retry');
  }
});

test('invalid time contract is rejected instead of granting a retry', () => {
  assert.throws(()=>decideRecovery({policy:'contract_aware',operation,contract:{retentionTicks:5,dispatchBoundTicks:null},now:1,observation:{status:'unknown'}}),/invalid/);
});

test('durable receipt with wrong payload or duplicate conflict cannot complete',()=>{
  const input={policy:'contract_aware',operation,contract,now:8};
  assert.equal(decideRecovery({...input,observation:{status:'committed',id:1,intentId:operation.intentId,payload:{kind:'ticket',value:'Other pump'}}}).action,'reconcile');
  assert.equal(decideRecovery({...input,observation:{status:'conflict'}}).action,'reconcile');
});
