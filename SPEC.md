# Statement Reconciler — Project Spec

Working spec for the Zamp engineering project round (Problem 1: turn messy documents into structured, queryable data).

This file is the source of truth for scope. If something isn't here, it's out of scope. Re-read before starting any new work session.

---

## One-line thesis

LLM extraction is non-deterministic and will get things wrong. Bank statements contain their own correctness proof — the transactions must reconcile against the declared opening and closing balances. This app uses that arithmetic as a correctness oracle: it extracts, checks its own work, localises where it likely failed, and asks a human to resolve exactly that.

The product is not extraction. It's **trustworthy** extraction.

---

## Why this problem, and why this shape

**Document type: bank statements.** Finance operations — Zamp's domain. Multi-page transaction tables, varied issuer layouts, and critically a built-in verification signal. Most document types give you no way to know whether extraction succeeded. This one does.

**The hard part being claimed: reconciliation-driven extraction confidence.** Not a confidence score from a model. Arithmetic validation, page-boundary continuity, and discrepancy localisation — pointing at the specific rows that break the maths.

**Deliberately not:** a dashboard. Charts are not the product. If this becomes a visualisation tool, the hard part disappears and it's a CRUD app with graphs.

---

## What the user does

1. **Lands on the app** — a workspace is created, its ID lives in the URL. No login. The URL is the key.
2. **Uploads a statement PDF** — direct to storage, then async processing. Sees real progress states (parsing → extracting → reconciling), not an opaque spinner.
3. **Sees the reconciliation verdict** — the key screen. Either *"reconciles exactly, nothing needs your attention"* or *"142 transactions extracted, sum differs from declared balances by ₹Z, 3 rows need review."*
4. **Reviews only what's flagged** — extracted values beside the source page region, so they can see what the document actually says. Corrects fields. Discrepancy recomputes live and shrinks toward zero.
5. **Queries verified data** — filter by date range, amount range, direction, counterparty; full-text search on descriptions. Results click through to source page and region.
6. **Hits a failure and gets a real answer** — password-protected PDF, scanned image with no text layer, unsupported layout, not-a-statement. Each fails specifically and honestly.

---

## Scope boundaries

### In

- Single-currency statements
- PDF upload with a text layer
- LLM extraction with Zod-validated structured output
- Page-boundary continuity handling
- Reconciliation engine + discrepancy localisation
- Flag-driven review and correction UI with source provenance
- Structured filters + Postgres full-text search
- Graceful degradation on the failure modes listed above
- Tests concentrated on reconciliation and continuity logic

### Out — deliberately

| Cut | Why |
|---|---|
| User auth | Five days of scored work; demonstrates nothing being evaluated; adds signup friction for evaluators. URL-as-key instead. |
| Multi-currency | Reconciliation arithmetic across FX is a different problem; would dilute the hard part. |
| Multi-account aggregation | Breadth, not depth. |
| Categorisation / spend analytics | This is the "bells and whistles" trap the brief warns about. |
| Natural-language querying | Mostly a wrapper around a model call; the brief explicitly warns against that. Provenance is the more defensible engineering. |
| OCR for scanned PDFs | Detect and fail clearly instead. Doing OCR badly is worse than declining honestly. |
| Mobile layout | Desktop review tool. Stated, not hidden. |

**Auth and spend analytics are natural next features, not oversights.** Once workspaces have real users, auth is where access control belongs, and spend analytics is a reasonable layer on top of verified transaction data. Both are cut here because they don't touch the hard part of this project — reconciliation-driven trust — and five days is better spent going deep on that than broad across features the brief doesn't ask for.

---

## Architecture

**Next.js (App Router)** — one deployable artifact. Route handlers for server work, server components for data-heavy views.

**Supabase** — Postgres + Storage in one service. Hosted, so evaluators get a working URL.

**Prisma** — typed client, committed migrations, schema file doubles as documentation.

**LLM extraction** — model returns candidate transactions against a Zod schema. Code validates. The model is a component that isn't trusted blindly.

### Constraints designed around, not discovered late

- **Serverless function timeouts** — extraction won't fit in a request cycle. Upload and processing are separate; client polls for status.
- **Request body limits (~4.5MB)** — upload goes direct to Supabase Storage via signed URL, then processing reads from there.
- **No persistent filesystem** — files in Storage, data in Postgres. Nothing written to disk.
- **Access pattern** — Supabase reached through route handlers, not the browser SDK. Keeps extraction server-side, keeps keys out of the client.

---

## Data model

### `statements`
`id`, `workspace_id`, `filename`, `storage_path`, `status`, `error_code`, `error_detail`, `page_count`, `bank_name`, `account_number_masked`, `period_start`, `period_end`, `opening_balance`, `closing_balance`, `currency`, `raw_extraction` (JSONB), `created_at`, `processed_at`

`status`: `uploaded` | `parsing` | `extracting` | `reconciling` | `needs_review` | `verified` | `failed`

The status enum is load-bearing — it drives the progress UI and makes async processing explicit.

`raw_extraction` keeps the model's unedited output so extraction can be debugged and re-run without another model call.

### `transactions`
`id`, `statement_id`, `row_index`, `date`, `description`, `amount` (Decimal), `direction` (`debit` | `credit`), `running_balance` (Decimal, nullable)

Provenance: `source_page`, `source_bbox` (JSONB), `extraction_confidence` (nullable)

Correction tracking: `is_corrected`, `original_values` (JSONB), `corrected_at`

Search: `search_vector` (tsvector, raw migration)

### `reconciliations`
`id`, `statement_id`, `expected_delta`, `actual_delta`, `discrepancy`, `is_reconciled`, `run_at`

One row per run, not per statement — recomputes as corrections land. History lets the UI show the discrepancy shrinking.

### `flags`
`id`, `statement_id`, `transaction_id` (nullable — some flags are statement-level), `flag_type`, `severity`, `detail`, `is_resolved`, `resolved_at`

`flag_type`: `running_balance_break` | `page_boundary_gap` | `low_confidence` | `arithmetic_mismatch` | `duplicate_suspect` | `missing_field`

This table is where the hard part lives. Discrepancy localisation writes rows here; the review UI reads from it.

### Two non-negotiables

- **Money is `Decimal` / Postgres `numeric`, never float.** Prisma returns Decimal.js instances — reconciliation arithmetic uses its methods, not `+`.
- **`direction` is its own column**, not encoded in the sign of `amount`. Cleaner filtering, more explicit reconciliation arithmetic.

---

## Day plan

| Day | Work |
|---|---|
| 1 | Upload to Storage, page rendering, extraction returning Zod-validated output, data model + migrations with provenance fields present from the first migration |
| 2 | Page-boundary continuity — the actual hard part |
| 3 | Reconciliation engine + discrepancy localisation |
| 4 | Review/correction UI + query surface |
| 5 | Tests on reconciliation logic, `decisions.md` finalised, setup docs, deploy |

Retrofitting provenance on day three is painful. Get those fields in the first migration.

---

## Evaluation criteria, mapped

| Their criterion | Where this project answers it |
|---|---|
| Problem framing | Narrowed from "any document" to one type with a verifiable success condition, with cuts stated and justified |
| Product thinking | User is an ops person who needs to trust output; the product is trust, not extraction |
| UX decisions | Review only what's suspect, with source context beside it; live discrepancy feedback |
| Code quality | Typed end to end; extraction, reconciliation, and presentation separated |
| Tests | Concentrated on reconciliation and continuity — the logic that would actually break |
| Documentation | This file + `decisions.md` + one-shot setup |
| Setup experience | Hosted URL, seeded demo workspace, `.env.example`, single install command |
| Velocity | Five days, one hard problem solved properly |
| Above and beyond | Arithmetic reconciliation as a correctness oracle — the sub-problem most candidates route around, because it requires caring whether the output is actually right |

---

## Failure modes

Every failure has a specific, named cause and a message a human can act on. No generic "processing failed" anywhere in the pipeline — that's the standard being held to, and it's directly what the brief means by "handling the real world, not the happy path."

| Input | Detection point | Behavior |
|---|---|---|
| Not a bank statement | Cheap pre-check before full extraction: does the document contain a recognizable transaction list and account/balance info? | `status: failed`, `error_code: not_a_statement`. Message: "This doesn't look like a bank statement — I couldn't find a transaction list or account balances." No full extraction attempted, so no wasted model call and no hallucinated fit. |
| Password-protected PDF | Parsing stage, on decrypt failure | Prompt for a password at upload (or on retry). Decrypt before parsing — stays inside the PDF-with-text-layer pipeline, no OCR needed. Wrong password: "Incorrect password — check and try again." |
| Scanned PDF / image, no text layer | Check for extractable text before calling the model | `error_code: no_text_layer`. Message: "This looks like a scanned image with no readable text — extraction isn't supported for scanned documents." Explicitly not handled via OCR (see Out of scope). |
| Corrupted file / wrong extension | Parsing stage | `error_code: unreadable_file`. Message: "This file couldn't be opened — it may be corrupted or not a valid PDF." |
| Balances missing or unreadable | After extraction, before reconciliation | Statement still saved with extracted transactions, but `status: needs_review` with a top-level flag: "Can't verify this statement — balance data missing or unreadable." Never silently reports false reconciliation success. |
| Multiple distinct statements in one PDF | Post-extraction check: more than one distinct account number/bank name found | `error_code: multiple_statements`. Message: "This file appears to contain more than one statement — please upload each separately." Deliberately not auto-split — too ambiguous to do reliably. |
| Oversized file | Upload stage, before processing starts | Explicit size limit, rejected with a clear message before it ever reaches a serverless timeout. |
| Multiple valid uploads at once | Batch upload | Each statement gets its own row and its own pipeline run. One failing must not block or slow the others — worth a deliberate test: 3 valid + 1 garbage PDF uploaded together, confirm 3 succeed independently. |

**Deliberately not handled:** image upload as a workaround for password-protected or scanned documents. Both routes require OCR, which was cut from scope — OCR quality is worse than text-layer parsing, and unclear digits from OCR are a real risk in a system whose entire value proposition is verified correctness. The password-entry flow above solves the actual underlying case without reopening that scope.



- Write `decisions.md` **as you go**. Reconstructed on day five it reads retrofitted, and it's the file that shows judgment best.
- Depth over breadth. If a new feature idea appears, it goes in the Out table with a reason, not into the build.
- Every failure mode gets a specific error message. Generic failures are the thing being explicitly avoided.
- Don't trust the model's output anywhere in the code. Validate, then reconcile, then flag.
