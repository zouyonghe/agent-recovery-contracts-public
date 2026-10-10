# Development

Node.js 24+ and its standard library are the only requirements. Run `npm test` for the complete suite. Tests create isolated temporary ledgers and close their HTTP services and child processes.

`src/tool.js` owns the local HTTP fixture. `src/journal.js` persists operation identity before dispatch. `src/recovery.js` selects recovery actions. The two experiment modules execute scenarios and score durable effects independently of response claims.

CLI entry points belong in `bin/`; reusable logic belongs in `src/`. Keep private fixture controls out of public request bodies. Do not add machine-specific setup to this repository.
