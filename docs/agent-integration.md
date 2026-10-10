# Applying ReplayFence to agent workflows

Status: integration research and proposed acceptance criteria, not a shipped framework adapter. Sources accessed 2026-10-10. ReplayFence currently supplies a local experimental service, not middleware that makes arbitrary third-party tools safe.

## Start with ticket creation

Consider an operations agent asked to create a maintenance ticket. The backend creates it, but the connection drops before the agent saves the result. On restart, replaying the tool call may create another ticket. Replaying a graph checkpoint does not by itself make the backend operation idempotent.

Use a durable logical intent for this particular authorized request. Persist its identity and payload before dispatch. Reuse that identity when recovering this request; a separately authorized request with identical text is a different intent. Conversation thread IDs and model tool-call IDs are not automatically suitable business operation identities.

## Put recovery at the execution boundary

```text
Agent proposes a task
  -> application validates authorization and binds an intent
  -> durable operation journal
  -> tool execution / backend
  -> receipt validation
  -> checkpointed result or explicit unresolved status
```

The model may select tools or explain an unresolved operation. It must not manufacture a replacement intent, key or execution epoch to get around an ambiguous result. The application owns authorization and recovery metadata; the backend owns the commit decision.

|Backend capability|Recovery boundary|
|---|---|
|Finite key retention only|Use the original key only within a justified retry guarantee. Outside it, reconcile; timeout does not imply cancellation.|
|Durable receipt history|A unique identity/payload-matching receipt can confirm completion. Empty history is not a barrier against late requests.|
|Atomic fencing and effect history|Advance the generation at the backend commit boundary, inspect prior effects, and reject stale requests. A client-only proxy cannot impose this guarantee on an unrelated API.|
|No deduplication or reliable lookup|Do not promise automatic safe recovery. Escalate ambiguous writes to an operator or domain-specific reconciliation.|

## LangGraph integration point

LangGraph's checkpointer documentation describes graph-state snapshots, pending writes and checkpoint replay. It explicitly states that nodes after a replayed checkpoint execute again, including API requests. Persistent checkpointers support restart recovery; in-memory state does not survive a process restart.

Proposed integration: wrap the side-effecting node's tool execution, preserve its logical operation identity in durable application state, and validate backend receipts before returning success to the graph. A graph checkpoint and a backend commit are separate persistence boundaries. This project has not yet tested this integration with a LangGraph runtime.

Source: [LangGraph checkpointers — Replay and durability modes](https://docs.langchain.com/oss/python/langgraph/checkpointers).

## MCP integration point

MCP specifies tool discovery, `tools/call`, tool schemas and results. Its request ID correlates protocol messages; the cited tool interface does not establish a durable business-operation deduplication contract. An `isError` result or transport failure should not be mapped to safe nonexecution without a backend guarantee.

Proposed integration: expose a business tool backed by an execution controller. Validate inputs and structured results, preserve application-assigned operation identity, and return unresolved outcomes explicitly. Tool annotations are untrusted unless supplied by a trusted server. Human approval remains distinct from idempotency: approval authorizes an operation but does not make retries safe.

Source: [MCP tools specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

## Proposed first implementation and evidence

Build a framework-independent ticket execution adapter first, then exercise it from a framework example. No model service should be required for the core recovery tests.

Acceptance evidence should include:

1. Interrupted caller after backend commit: restart recovers one matching ticket effect.
2. Interruption before commit: recover without inventing a new business intent.
3. Late old request: a fenced backend rejects it after generation advancement.
4. Missing or corrupt recovery state: return unresolved, not silently initialize a new operation.
5. Same payload, different authorized intent: two distinct effects.
6. Payload or receipt mismatch: refuse completion and do not dispatch a replacement write.
7. Lost fence response: recover authoritative generation; never guess it.
8. Count completion, duplicate effects, unresolved work, false success and request costs separately.

These are proposed integration gates. Existing fixture tests cover several protocol boundaries but do not establish a working real-world ticket service or a tested LangGraph/MCP adapter.
