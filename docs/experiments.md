# ReplayFence experiments

## Ordinary service

```sh
node bin/experiment.js --output baseline.json --durable-receipts
```

The 96-cell matrix combines two payload kinds, two disconnect points, three resume times, two visibility delays, and four deterministic recovery policies. The oracle reads actual ledger effects, not a model-generated success judgment. The selected reference is `results/matrix-v03.json`.

## Fenced service

```sh
node bin/fenced-experiment.js --output fenced.json
```

The 12-cell matrix combines before/after-commit disconnects, service lifecycle conditions, and three recovery controls. The reference is `results/fenced-matrix-v01.json`. Service instance starts are counted separately from HTTP requests; they are not child-process counts. Process-level SIGKILL coverage lives in separate tests.

These are synthetic deterministic experiments. Neither matrix estimates production failure frequency or LLM reliability. Epoch advancement and durable history strengthen the service contract; comparisons to ordinary retries are not policy-only ablations.

## Reproduction

Generate into new paths and compare JSON with the references using `cmp`. Historical reference outputs are preserved; changes to scenario semantics require new result versions and an explanation. Safety, completion, unresolved work, and request costs must be reported separately.
