# Test fixtures

Generated bank statements for developing against and for the demo workspace.
Everything in them is invented — `Northwind Bank` is not a real institution,
the account holder and merchants don't exist, and no real financial data is
involved.

Regenerate with `python3 generate.py && python3 render.py`. They're committed
rather than generated at build time so an evaluator can clone and upload
immediately.

All four share the same underlying account: opening `84,250.00`, closing
`1,23,857.14`, 70 transactions over three pages.

| File | What it proves |
|---|---|
| `clean.pdf` | Reconciles exactly. The "nothing needs your attention" path, and the multi-page continuity case. |
| `carry-forward.pdf` | Every page after the first opens with a `B/F BALANCE BROUGHT FORWARD` line formatted like a transaction, with the carried balance repeated in the credit column. Extraction that swallows those inflates the total. It currently doesn't — so this fixture is evidence the decoy is handled, not a failure case. |
| `missing-row.pdf` | A `1,499.00` debit is absent from the printed table while every balance after it, and the declared closing balance, still account for it. The document contradicts its own arithmetic. |
| `scanned-no-text-layer.pdf` | `clean.pdf` rasterised at 150dpi with slight skew. No text layer at all. Must be refused by name (`no_text_layer`), never OCR'd. |

## Why `missing-row.pdf` is the important one

It fails **regardless of how well extraction performs**, because the failure
is in the document rather than in the reading of it. That makes it a stable
demonstration of the reconciliation oracle rather than a bet on the model
misbehaving on cue.

The omitted row is the last on page 2, so the running-balance walk breaks on
the *first row of page 3* — a page boundary, which is diagnosed as a lost row
rather than a misread one. It exercises the walk, the classifier, the flags
and the review screen in one file.

## Deliberate difficulties in the text layer

These are in the fixtures on purpose, because real statements have them:

- **Indian digit grouping** — `1,23,857.14`, not `123,857.14`.
- **Wrapped descriptions** — long salary credit lines break across two visual
  lines within one logical row.
- **Debit and credit as separate columns**, either of which may be empty.
- **An opening-balance row** that looks like a transaction but isn't.
- **Repeated merchants and repeated amounts**, so duplicate detection has to
  be more careful than "same amount twice".

## Still to build

The rest of the failure table: password-protected, corrupted, not-a-statement,
two-statements-in-one-file, oversized.

## Note on the generator

`generate.py` is Python rather than TypeScript because it's a build-time
authoring tool, not application code — it renders HTML through headless
Chromium to get a real text layer with controllable page breaks. Nothing in
`src/` depends on it.
