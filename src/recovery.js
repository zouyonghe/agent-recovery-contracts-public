const policies = new Set(['naive', 'stable_key', 'verify_before_retry', 'contract_aware']);

export function decideRecovery({policy, operation, contract, now, observation}) {
  if (!policies.has(policy)) throw Error('invalid policy');
  if (!operation || typeof operation.key !== 'string' || typeof operation.intentId !== 'string' ||
      (operation.firstDispatchTick !== null && (!Number.isSafeInteger(operation.firstDispatchTick) || operation.firstDispatchTick < 0))) throw Error('invalid operation');
  if (!contract || !Number.isSafeInteger(contract.retentionTicks) || contract.retentionTicks < 1 ||
      !Number.isSafeInteger(contract.dispatchBoundTicks) || contract.dispatchBoundTicks < 0 ||
      !Number.isSafeInteger(now) || now < 0) throw Error('invalid contract/time');
  if (!observation || !['unknown', 'committed','conflict'].includes(observation.status)) throw Error('invalid observation');
  const samePayload=observation.payload && operation.payload && observation.payload.kind===operation.payload.kind && observation.payload.value===operation.payload.value;
  if (observation.status === 'committed' && observation.intentId === operation.intentId && samePayload && Number.isSafeInteger(observation.id)) {
    return {action: 'complete', id: observation.id, reason: 'matching_receipt'};
  }
  if (observation.status === 'committed' || observation.status === 'conflict') return {action: 'reconcile', reason: 'receipt_identity_mismatch'};
  if (policy === 'contract_aware') {
    if (operation.firstDispatchTick === null) return {action: 'reconcile', reason: 'missing_dispatch_history'};
    const within = now + contract.dispatchBoundTicks < operation.firstDispatchTick + contract.retentionTicks;
    return {action: within ? 'retry' : 'reconcile', reason: within ? 'inside_contract_window' : 'outside_contract_window'};
  }
  return {action: 'retry', reason: policy === 'naive' ? 'blind_retry' : 'unknown_treated_as_absent'};
}
