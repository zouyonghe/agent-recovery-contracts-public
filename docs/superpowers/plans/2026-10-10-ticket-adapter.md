# Ticket Recovery Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an application-owned ticket tool boundary that preserves identity across interruption and reports ambiguous recovery honestly.

**Architecture:** Reuse the operation journal and policy implementation. Add a read-only resume lookup and an HTTP ticket adapter with separate create/resume entry points. Fencing remains a declared backend capability, not a client-side guarantee.

**Tech Stack:** Node.js >=24, standard library, node:test.

## Global Constraints

- No model dependency or live service calls.
- No personal environment configuration or private run artifacts in the public repository.
- Single journal owner and local simulated side effects only.
- Preserve existing experiment protocols and reference results.
- Invalid caller input throws; ambiguous remote results return unresolved.

## Task 1: Read-only journal recovery

Files: modify `src/journal.js`; test `test/journal.test.js`.

Interface: export `lookupOperation({file,intentId,payload})`, returning a validated matching operation or null for missing file/intent. Malformed journals and changed payload throw. It never persists or allocates a key. Extract shared ledger validation from `prepareOperation` rather than duplicating it.

- [ ] Add failing tests: existing lookup preserves key/time; missing lookup does not create a file; corrupt lookup throws; changed payload throws.

```js
assert.equal(lookupOperation({file, intentId:'new-intent', payload}), null);
await assert.rejects(readFile(file), {code:'ENOENT'});
```

- [ ] Run `node --test test/journal.test.js`; confirm failure for missing export.
- [ ] Implement read-only loading with existing schema validation; handle only ENOENT as missing.
- [ ] Run journal tests and `npm test`; commit the independently verified change.

## Task 2: Ordinary ticket adapter

Files: create `src/ticket-adapter.js`, `test/ticket-adapter.test.js`.

Interfaces: `createTicket({url,journalFile,intentId,text,now,contract})` and `resumeTicket` with identical argument shape; outcomes completed/id or unresolved/reason. Contract includes `mode`, `retentionTicks`, `dispatchBoundTicks`. Create calls prepareOperation; resume calls lookupOperation without writes. HTTP bodies contain only key, intentId and payload, not firstDispatchTick.

- [ ] Write failing fixture tests for after-commit disconnect, precommit failure, expiration, missing/corrupt state, mismatching receipt and equal-text independent intents. Assert actual ledger effect counts separately.

```js
const result = await resumeTicket(options);
assert.equal(result.status, 'unresolved');
assert.equal(JSON.parse(await readFile(ledger,'utf8')).effects.length, 0);
```

- [ ] Run `node --test test/ticket-adapter.test.js`; confirm missing module failure.
- [ ] Implement caller validation, bounded HTTP requests and strict receipt validation. Use contract-aware policy for ordinary retry decisions. Verify receipts after writes; do not treat successful HTTP alone as proof. Return unresolved on transport/query failure; no recursive retry loop.
- [ ] Run adapter tests and all existing tests; check reference matrices remain unchanged; commit.

## Task 3: Fenced ticket recovery

Files: extend `src/ticket-adapter.js` and `test/ticket-adapter.test.js`.

Consumes: read-only lookup and outcome contract from Tasks 1–2. Produces: fenced mode recovery with durable generation validation and CAS barrier.

- [ ] Add failing tests for lost initial fence response, stale generation, incomplete old HTTP body and changed payload binding.

```js
const outcome = await resumeTicket(fencedOptions);
assert.equal(outcome.status, 'completed');
assert.equal(JSON.parse(await readFile(ledger,'utf8')).effects.length, 1);
```

- [ ] Confirm failures before adding fenced implementation.
- [ ] On fresh create, admit via epoch 0 CAS; on resume, require matching durable generation and advance it before replacement write. Validate epoch as a positive safe integer, returned status and committed identity. Never downgrade, guess an epoch or use ordinary fallback.
- [ ] Run late-request and response-loss tests plus `npm test`; commit.

## Task 4: Caller interruption and user example

Files: create `fixtures/ticket-caller.js`, `test/ticket-process.test.js`, `examples/ticket-recovery.js`, `docs/ticket-adapter.md`; update `README.md`.

- [ ] Write a failing process test: caller prepares journal and submits; backend commits; kill caller before checkpointing; start a fresh caller using resume; assert original key retained and one effect. Use IPC synchronization, not guessed sleeps.
- [ ] Implement caller fixture and example against local fixture only. Exit nonzero for unexpected fixture assertions; clean up temporary files and services in finally.
- [ ] Run `node examples/ticket-recovery.js` and `npm test`; verify explicit unresolved cases are not logged as success.
- [ ] Document application-owned authorization/intent, mode guarantees, request costs and production gaps. Keep commands portable and record no machine setup.
- [ ] Run both experiment CLIs into new files and compare with references; run privacy scan and `git diff --check`; commit and push.

## Coverage audit

Task 1 covers lost/corrupt recovery state; Task 2 covers ordinary retries, identity binding and verified receipts; Task 3 covers service fencing and delayed requests; Task 4 covers actual caller interruption and a runnable integration boundary. Framework-specific integration and deployment correctness remain explicitly unachieved.
