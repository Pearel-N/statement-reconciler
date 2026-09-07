# Statement Reconciler

**Live: https://statement-reconciler-topaz.vercel.app**

Extracts transactions from bank statement PDFs, and then checks its own work.

---

## The idea

Extraction with a language model is not deterministic. It will misread a
digit, drop a row, or read a credit as a debit. For most documents there is no
way to tell — the only way to verify an invoice is to read it yourself, which
defeats the point of extracting it.

Bank statements are the exception. A statement declares an opening balance and
a closing balance, and the transactions between them must account for the
difference exactly. So the document carries its own proof.

This app uses that arithmetic as an oracle. It extracts, checks the result
against the declared balances, works out **which rows are responsible** when
they disagree, and asks a person to fix only those.

The product is not extraction. It's *trustworthy* extraction.

---

## Try it in two minutes

**A workspace with all four already processed:**
https://statement-reconciler-topaz.vercel.app/w/decade00-0000-4000-8000-000000000001

Or open the live app and drop in a file from [`fixtures/`](./fixtures) yourself:

| File | What you'll see |
|---|---|
| `clean.pdf` | 70 transactions, reconciles exactly. "Nothing needs your attention." |
| `missing-row.pdf` | The same statement with one ₹1,499 debit missing from the printed table. Doesn't reconcile — **one row flagged out of 69**, diagnosed as a row lost at a page boundary, with that region of the page shown beside it. |
| `carry-forward.pdf` | Each page opens with a "balance brought forward" line dressed up as a transaction. Extraction correctly ignores them, so this one reconciles — it's evidence the decoy is handled. |
| `scanned-no-text-layer.pdf` | Refused by name before any model call. Scans are declined, not run through OCR. |

Then hit **Browse all transactions** to search across every statement in the
workspace.

`missing-row.pdf` is the one to look at. It fails because the *document*
contradicts its own arithmetic, so the demonstration doesn't depend on the
model misbehaving on cue.

---

## How it works

**1. Upload.** Size, type and the file's leading `%PDF-` bytes are checked in
the browser, then again on the server. The file goes straight to object
storage via a signed URL — it never passes through the server, because
serverless request bodies cap around 4.5MB and statements are bigger than
that. The database row is written afterwards, once the server has confirmed
with storage that the bytes actually landed.

**2. Read.** The PDF is parsed with positions kept. Each line is also rendered
as fixed-width text so columns line up and an empty debit column stays
visibly empty — which is what lets the model tell money in from money out.
Encrypted, corrupt and scanned files are refused here, before any tokens are
spent.

**3. Extract.** The model returns transactions against a Zod schema that also
generates the contract it's given, so the two can't drift. Money crosses as
strings and becomes `Decimal` at the boundary — it is never a float.

**4. Locate.** The model cites the numbered line it read each row from, never
a position. Coordinates come from the parser. The citation is then *checked*
against the page, so a model pointing at the wrong row is caught rather than
trusted.

**5. Reconcile.** Credits minus debits, compared to the declared difference.
Where statements print a running balance, each check restarts from the
balance the **document** printed rather than an accumulated total — which
isolates a misread row to that one row instead of flagging every row after
it.

**6. Review.** The verdict, then only the flagged rows, each beside the region
of the page it came from. Corrections re-run the arithmetic instantly from
stored rows — no second model call — so the discrepancy shrinks while you
work.

**7. Query.** Filters and full-text search across every verified statement in
the workspace, with each row clicking back to its page.

---

## Running it yourself

Needs Node 20+ and a free Supabase project.

```bash
git clone <repo-url>
cd statement-reconciler
npm install
cp .env.example .env      # six values, each documented in the file
npm run db:migrate
npm run dev
```

Open http://localhost:3000. A workspace is created and its ID goes in the URL.
That URL is the key — there is no login.

**Supabase, once:** create a project, add a **private** bucket named
`statements`, then copy the two connection strings and the API URL and secret
key into `.env`. The comments in `.env.example` say which is which.

**And one key for extraction:** `ANTHROPIC_API_KEY` from console.anthropic.com.

Everything else in `.env.example` has a working default.

### Commands

| | |
|---|---|
| `npm test` | 42 tests — reconciliation, parsing, provenance, validation |
| `npm run inspect -- fixtures/clean.pdf` | Prints what the parser sees, no model call |
| `npm run extract -- fixtures/missing-row.pdf` | Runs the whole pipeline in the terminal and prints the verdict. Results are cached by file hash; `--fresh` re-runs the model |
| `npm run db:studio` | Browse the database |
| `npm run seed` | Fills the demo workspace with all four fixtures |

`npm run extract` is the fastest way to see the interesting part without a
browser.

---

## Deliberately not built

| Cut | Why |
|---|---|
| Authentication | Five scored days; demonstrates nothing being evaluated. Workspace IDs are 122 bits of randomness and nothing enumerates them. **The cost is real: a shared link can't be revoked.** First thing after this. |
| OCR for scans | Doing it badly is worse than declining honestly. A misread digit would break the oracle — you could no longer tell a misreading from a genuine imbalance. |
| Multiple currencies | Reconciliation across FX is a different problem. |
| Spend categories, charts | Charts are not the product. This would become a database with graphs on top and the hard part would disappear. |
| Natural-language querying | Mostly a wrapper around a model call, and it can't cite anything. Provenance is the more defensible engineering. |
| Combining accounts | Searching across statements is supported; totalling across them isn't. A debit on a card statement and a debit on a bank statement are not the same quantity. |
| Mobile layout | A desktop review tool. Stated, not hidden. |

---

## Where it's weak

- A workspace link can't be revoked. Unacceptable for real financial data.
- The page-boundary diagnosis is a heuristic. A misread row that happens to be
  first on a page gets the wrong label.
- Re-anchoring assumes the *printed* balance is trustworthy. If the extractor
  misreads a balance rather than an amount, you get two breaks instead of one.
- Extraction has been tested against a handful of layouts. It fails *visibly*
  on an unfamiliar one, because the arithmetic catches it — but how often is
  unknown.
- `npm audit` reports three advisories, all reaching the tree through the
  Prisma CLI, all dev-only and not present at runtime.

---

## Reading the code

Everything interesting is in `src/lib`:

| | |
|---|---|
| `reconcile.ts` | The arithmetic and the localisation. Pure functions, no database, no model. **Start here.** |
| `pdf/parse.ts` | Reading a PDF's text layer with positions |
| `extract/` | The schema, the prompt, and provenance matching |
| `pipeline.ts` | One processing stage per request |

[`SPEC.md`](./SPEC.md) is the scope document written before any code.
[`decisions.md`](./decisions.md) has the reasoning behind every choice,
written as the work happened — including two bugs that only appeared in
production and how they were tracked down.

Built in three days.
