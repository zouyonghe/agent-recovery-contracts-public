# Contracts and safety boundaries

## Operation identity

`POST /operations` accepts exactly `{key, intentId, payload: {kind, value}}`. Payload kind is `ticket` or `notification`. Independent intents require independent identities even when their payloads match.

Within retention, a key binds to one intent and payload. Matching retries replay its result; conflicting reuse returns 409. At expiration, ordinary key reuse can create another effect.

`GET /operations/:key` is an eventually consistent, finite-retention lookup. `unknown` is not proof of nonexecution. `GET /receipts/:intentId` reads durable effects: a unique matching receipt can establish completion, but an empty history is not a barrier against future commits.

## Fenced mode

Start the fixture with `fenced: true`. `POST /fences` uses the operation body and `x-operation-epoch` header to atomically advance an expected generation and bind the payload. It reports an existing committed effect or a ready generation.

Fenced operations require a matching epoch at the commit boundary. Late older-generation requests return 409. `GET /fences/:intentId` recovers durable epoch and payload after response loss; it does not itself advance the generation. Do not guess an epoch after an ambiguous response.

## Persistence

Effects and key records share a snapshot written through temporary-file fsync, rename, and directory fsync. Uncertain persistence errors block subsequent requests until restart. Corrupt ledgers are rejected. A fenced ledger cannot reopen in ordinary mode.

One owner per ledger is required. No multi-writer, authentication, power-loss, cross-service transaction, or external-side-effect guarantee is provided. Request and ledger limits bound this fixture, not a production deployment.
