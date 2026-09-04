# Test fixtures

Generated bank statements for developing against and for the demo workspace.
Everything in them is invented — `Northwind Bank` is not a real institution,
the account holder and merchants don't exist, and no real financial data is
involved.

Regenerate with `python3 generate.py && python3 render.py`. They're committed
rather than generated at build time so an evaluator can clone and upload
immediately.

| File | Pages | What it's for |
|---|---|---|
| `clean.pdf` | 3 | Reconciles exactly. Opening 84,250.00, closing 1,23,857.14, 70 transactions. The "nothing needs your attention" path, and the multi-page continuity case. |
| `carry-forward.pdf` | 3 | Same statement, but each page after the first opens with a `B/F BALANCE BROUGHT FORWARD` line formatted like a transaction, with the carried balance repeated in the credit column. Extraction that treats those as transactions inflates the total and the statement stops reconciling. |
| `scanned-no-text-layer.pdf` | 3 | `clean.pdf` rasterised at 150dpi with slight skew and reduced contrast. No text layer at all. Must be refused by name (`no_text_layer`), never OCR'd. |

## Deliberate difficulties in the text layer

These are in the fixtures on purpose, because real statements have them:

- **Indian digit grouping** — `1,23,857.14`, not `123,857.14`.
- **Wrapped descriptions** — long salary credit lines break across two visual
  lines within one logical row.
- **Debit and credit as separate columns**, either of which may be empty.
- **An opening-balance row** that looks like a transaction but isn't.
- **Repeated merchants and repeated amounts**, so duplicate detection has to
  be more careful than "same amount twice".

## Still to build (day 5)

The rest of the failure table: password-protected, corrupted, not-a-statement,
two-statements-in-one-file, oversized.

## Note on the generator

`generate.py` is Python rather than TypeScript because it's a build-time
authoring tool, not application code — it renders HTML through headless
Chromium to get a real text layer with controllable page breaks. Nothing in
`src/` depends on it.
