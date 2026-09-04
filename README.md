# Statement Reconciler

Extracts transactions from bank statement PDFs and then **checks its own work**.

LLM extraction is non-deterministic and will get things wrong. Bank statements
carry their own correctness proof: the transactions must reconcile against the
declared opening and closing balances. This app uses that arithmetic as an
oracle — it extracts, reconciles, localises where it likely failed, and asks a
human to resolve exactly that and nothing else.

The product is not extraction. It's *trustworthy* extraction.

See [`decisions.md`](./decisions.md) for the reasoning behind each choice.

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000. A workspace is created and its ID goes in the URL.
That URL is the key — there is no login.

## Where this is

Upload only. Files are validated (size, type, PDF signature) but not yet
stored: the upload route reports `unconfigured` and the UI says so rather than
showing a success state for a file that went nowhere.

Extraction, reconciliation and review are not built yet.
