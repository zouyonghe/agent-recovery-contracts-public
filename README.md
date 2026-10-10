# ReplayFence

Recover interrupted agent tool calls without mistaking a missing response for a missing side effect.

ReplayFence is a reproducible research toolkit for studying safe retries and recovery boundaries.

Use this project to explore idempotency expiration, durable receipts, late requests, and server-side fencing. It provides a local HTTP fixture, deterministic recovery policies, persistent operation journals, fault injection, and effect-count checks.

**Research software, not a production tool gateway.** Effects are simulated in a local ledger. The service assumes one writer and does not provide transactions for external payments, notifications, or other real-world effects.

## Quick start

Requires Node.js 24 or newer. No dependencies or model service required.

```sh
npm test
node bin/experiment.js --output baseline.json --durable-receipts
node bin/fenced-experiment.js --output fenced.json
```

Output files must not already exist. Temporary experiment ledgers are cleaned up after execution. Check command exit status before using generated results.

## What you can investigate

- **Finite idempotency:** stable keys stop protecting retries after their retention window.
- **Durable receipts:** a matching positive receipt can establish completion; an empty query cannot stop a late request.
- **Fencing:** a persisted execution epoch rejects requests from older generations.
- **Persistence failures:** uncertain writes put the fixture into fail-stop mode until restart.
- **Recovery tradeoffs:** report completion, unresolved operations, duplicate effects, and false success separately.

## Project layout

```text
src/       HTTP fixture, journals, policies, experiment runners
bin/       Command-line experiment entry points
test/      Protocol, persistence, and process-restart tests
fixtures/  Child-process helpers used by tests
results/   Selected deterministic experiment outputs
docs/      Development and methodology documentation
```

Selected results are deterministic controls, not LLM performance measurements. Fenced and non-fenced experiments use different service contracts; their outcomes must not be attributed solely to agent intelligence.

## Documentation

- [Development guide](docs/development.md)
- [Tool contracts and safety boundaries](docs/contracts.md)
- [Experiment methodology](docs/experiments.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT. See [LICENSE](LICENSE). Maintainer: [zouyonghe](https://github.com/zouyonghe).
