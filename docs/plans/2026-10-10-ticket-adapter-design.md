# Ticket recovery adapter design

Approved direction: framework-independent ticket adapter, runnable example and real process-interruption tests; no model dependency or live service calls.

## Scope

Application-authorized logical intents are immutable across recovery. New intent creation and resuming existing work are separate entry points. The adapter executes against the ReplayFence research HTTP service, not an arbitrary production ticket API. The application supplies the approved intent and ticket text; model output cannot select keys, epochs or destinations.

## Interface

`createTicket({url, journalFile, intentId, text, now, contract})` persists the operation before sending it. `resumeTicket(...)` requires an existing matching operation; missing or corrupt state returns an explicit unresolved outcome and never creates a replacement journal entry. Both return either `{status:'completed', id}` with verified matching durable receipt or `{status:'unresolved', reason}`. Invalid caller inputs throw before any network write.

`contract` supplies integer retention and arrival-bound ticks and explicit backend mode (`ordinary` or `fenced`). Logical tick values are fixture inputs, not inferred real-world timing guarantees. The first recorded time is a conservative dispatch lower bound. Unknown time guarantees must not authorize retry.

## Recovery decisions

Read the durable receipt and validate status, positive effect ID, intent and exact payload. A matching committed receipt completes. Conflicting, malformed or mismatching receipts fail closed. An ordinary backend permits the original-key retry only inside the supplied guarantee; after it expires, return unresolved. Do not equate transport failure with nonexecution.

Fenced mode is explicitly configured for this fixture only. Recover the bound generation, validate its payload, then compare-and-swap advance it to reject old requests. A committed fence result must match identity and payload before completion. A ready result allows one write under its returned epoch; subsequent durable receipt verification determines completion. Missing recovery generation is unresolved, not permission to invent one. Lost fence responses are resolved by durable reads on the next resume, not guessed epochs or unbounded retries.

## Validation

Tests cover commit-before-response-loss, precommit disconnect, expired unknown, delayed old requests, missing/corrupt journals, receipt mismatch, changed payload and independent equal-text intents. At least one test kills the caller process after the backend commit but before caller checkpointing and starts a fresh caller to recover the same operation. Verify durable effects separately from reported outcomes and count requests.

## Non-goals

No universal exactly-once guarantee, authentication gateway, multi-writer journal, LangGraph/MCP adapter or production service integration in this increment. These require separate evidence. Personal server settings and private run artifacts remain excluded from the public repository.
