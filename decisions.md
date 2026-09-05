# Decisions

Written as the work happens, not reconstructed at the end. Each entry is a
choice that had a real alternative, and why this side was picked.

---

## Day 1

### Deploy before there is anything to deploy

The pipeline (repo → CI → hosted URL) is proven while the app is empty and
nothing is at stake. Environment, connection pooling and storage permissions
are the three things that bite late in a project, so they get to bite on day
one instead. From then on production is never more than a few hours behind
local, and day 5 is tests and docs rather than a first-ever deploy.

### Money is `Decimal`, never a float

Postgres `numeric`, Prisma `Decimal`. Reconciliation arithmetic uses
`Decimal.js` methods, never `+` or `-`. An app whose entire claim is
"the arithmetic proves the extraction" cannot afford `0.1 + 0.2`.

### `direction` is its own column, not the sign of `amount`

Two reasons. Filtering by debit/credit stays a plain equality check instead of
a sign predicate. And reconciliation arithmetic reads as what it is —
`credits.minus(debits)` — rather than a sum whose correctness depends on every
row having been signed correctly at extraction time. Sign-encoding pushes a
correctness assumption into the extractor, which is the component least
trusted here.

### Provenance columns exist in the first migration

`source_page` and `source_bbox` are on `transactions` before anything writes
to them. Retrofitting provenance after the extractor is built means changing
the extractor's output contract, its tests, and a migration, all at once, on
the day the review UI is due.

### Bounding boxes are derived in code, not asked of the model

A model handed plain text cannot know where on the page that text was; any
coordinates it returns are invented. So the PDF is parsed with positioned text
extraction (per-item transform, width, height), the model receives text, and
each returned row is matched back to its source text items to *derive* a
bounding box. Provenance is therefore computed, not generated — which is the
same principle as the reconciliation oracle itself, applied to layout.

Fallback if row-to-item matching proves unreliable on some layouts: page
number plus the matched text span, highlighted by re-finding the string. Still
honest provenance, and it degrades visibly rather than silently.

### No auth; the workspace ID in the URL is the key

Five scored days, and access control demonstrates nothing this project is
being judged on. Workspace IDs are 122-bit random UUIDs generated server-side
with `crypto.randomUUID()` — unguessable, and no dependency needed. There is
no endpoint that lists or enumerates workspaces.

This is a deliberate trade, not an oversight: once workspaces have real users,
auth is exactly where access control belongs.

### Validation runs twice, and only the second one counts

The browser checks size, extension and the file's leading bytes so a wrong
file is rejected instantly with a specific reason, before anything is
uploaded. The route handler runs the same checks again, from the same pure
module in `src/lib/upload-validation.ts`. A client-side check is a courtesy to
the user; it is not a control, and treating it as one is how size limits get
bypassed.

### The extension is a claim; the first five bytes are a fact

`report.pdf` is frequently a renamed `.docx`, and a MIME type is whatever the
browser guessed. Reading the leading `%PDF-` turns "failed somewhere in the
parser" into "this file isn't a PDF" at the moment of selection, for the cost
of five bytes.

### Uploads in a batch are independent, and the UI proves it

Files are processed with `Promise.allSettled`, not sequentially and not with a
short-circuit on first failure. Drop three valid statements and one garbage
file and you get three accepted and one specifically-rejected — visible in the
summary line rather than asserted in a README.

### Unconfigured storage says so instead of pretending

Until the Supabase environment variables are present, the upload route returns
`upload.mode: "unconfigured"` and the UI shows "checked but not saved" on the
row. The alternative — a success state for a file that went nowhere — is the
exact class of quiet lie this project exists to eliminate. The client branch
for the real signed-URL response is already written next to it.

### Light theme only

A desktop tool for finance ops. A deliberate light theme reads better than a
half-finished dark one, and `color-scheme: light` is set explicitly so the
browser doesn't invent one.

---

## Day 2

### The reconciliation engine was built before the extractor

It is pure functions over a typed shape — no PDF, no database, no model, no
React — so it can be proven correct while extraction doesn't exist yet.
Building continuity handling first would have meant debugging two unproven
layers against each other. Extraction now only has to produce a shape that is
already known to reconcile.

For the same reason the engine depends on `decimal.js` directly rather than on
Prisma's re-export of it. Nothing in `src/lib/reconcile.ts` knows the database
exists.

### Each running-balance check re-anchors on the printed balance

The obvious implementation accumulates a running total and compares it to each
row. It is also useless: if row 40's amount is misread, every row after it
fails too, and the app tells a human "100 rows are wrong."

Instead each check starts from the *document's* previous printed balance. Row
41 is checked against row 40's printed balance, which is correct regardless of
what was misread on row 40 — so exactly one row fails, and the human is
pointed at exactly one row. Rows with no printed balance carry the last anchor
forward and accumulate onto it, so gaps in that column reduce the precision of
localisation instead of breaking it.

That single choice is the difference between "the statement doesn't add up"
and "row 40 is wrong, by 1,800."

### Prisma 6, not Prisma 7

Prisma 7 moves the connection URL out of the schema into a config file and
requires a driver adapter at runtime — two more moving parts — and has known
friction with Next.js 16's Turbopack, which is this project's stack.

Prisma 6 supports Supabase's two-URL setup (pooled for queries, direct for
migrations) directly in the schema, and is the version most of the ecosystem
is currently running against.

The risk budget for five days belongs to extraction and reconciliation. The
ORM is not the interesting problem here, so it gets the boring, stable choice.

### The database row is created after the bytes land, not before

Registering an upload writes nothing. If a row were created up front and the
upload then failed — network drop, closed tab — the row would sit there
claiming a file exists that doesn't, and every later stage would have to
defend against it.

So `/api/statements` only issues a signed URL, and `/api/statements/confirm`
creates the row. Confirm doesn't take the browser's word either: it asks
storage whether the object exists and records storage's byte count, not the
one the browser claimed. It also refuses any storage path outside the
requesting workspace's own prefix, so a crafted request can't attach someone
else's file to a workspace.

### Localisation reports one flag per break, and stays silent when unsure

Two rules govern what the review screen is allowed to say.

One flag per break, with no merging of consecutive breaks. Merging made sense
against an accumulating walk, where a single misread row produced a cascade of
identical gaps. Re-anchoring removed the cascade, so two breaks are now two
genuinely separate problems and grouping them would hide real errors.

And residual explanations only fire on a unique match. If two rows equally
explain a discrepancy, the arithmetic cannot say which is wrong, and naming
both would send a human to re-read a correct row as often as an incorrect one.
Ranking the candidates and showing the best guess would look more capable and
be strictly worse: to the user a ranked guess is indistinguishable from a
proven answer. In an app whose claim is knowing when it is wrong, a confident
wrong explanation costs more than silence.

---

## Day 3

### The PDF is parsed once, for two different consumers

The model needs text it can read as a table: rows in order, columns aligned,
empty cells still visibly empty. Debit and credit are distinguished by *where*
a number sits, so any representation that collapses horizontal position
destroys the difference between money in and money out — which is precisely
the field the reconciliation arithmetic depends on.

Provenance needs the opposite: exact coordinates for every fragment, so a row
the model returns can be traced back to a region of the page.

`parsePdf` produces both from one pass. `items` keeps raw positioned
fragments; `layout` renders each line as fixed-width text, padding to the
column each fragment's x position implies. Padding rather than joining is the
point: a row with an empty debit column produces no fragment there at all, and
joining with single spaces would silently close the gap and make a credit read
as a debit.

### Coordinates are computed, never requested from the model

A model handed plain text cannot know where on the page that text was. Any
coordinates it returned would be invented, and invented provenance in an app
built on verified correctness is worse than none. So the parser records
positions and the model is asked only for values.

PDF measures from the bottom-left; this converts to top-left once, at the
boundary, so nothing downstream has to remember which way up the page is.

### "No text layer" is a threshold, not a zero check

A scanned page often carries a stray character from a header stamp or a
watermark. Refusing only on exactly zero characters would let those through
into extraction, where the model would hallucinate a statement out of nothing.
Forty characters across the whole document is the line.

### The stored model output is what corrections replay against

`statements.raw_extraction` holds the model's unedited answer. Re-running
reconciliation after a human corrects a row must never call the model again —
it replays that stored output with the correction applied.

That is what makes the discrepancy shrink live as someone works, rather than
after a wait and another API charge. It also means a bad extraction can be
debugged, and the downstream code re-run against it, without paying to
reproduce it.

---

## Day 4

### Processing advances one stage per request

Extraction takes longer than a serverless function is allowed to live, so the
work cannot happen inside the upload request. `POST /api/statements/:id/process`
does one stage and returns; the browser polls until it reports done.

Three consequences, all of them the point rather than side effects.

Every request finishes well inside the time limit, so nothing depends on a
platform being generous. A crash loses only the stage that was running, and
the next poll retries it rather than restarting from the file. And the
`status` column becomes the actual machine — "Extracting transactions" is
shown because the row genuinely is in `extracting`, so the progress a user
watches is true rather than a spinner's guess.

Reading the file is its own stage, before extraction, so a file that cannot be
read costs nothing. Encrypted, corrupted and scanned documents are all refused
before a single token is spent.

### No lock, and that is a decision rather than an omission

Two simultaneous calls would at worst repeat a stage. Parsing is pure.
Extraction deletes the rows it wrote before writing again, so it cannot
double a transaction list. Reconciliation appends a run, which is what it is
designed to do. The cost of a collision is one wasted model call, not corrupt
data, and one polling browser makes collisions unlikely.

A queue is the right answer under real concurrency. It is not the right answer
for five days, and pretending otherwise would have spent the budget on
infrastructure rather than on the problem being judged.

### Flags are replaced on each run; reconciliation runs are appended

Flags describe the present state — stale ones would send someone to re-check a
row that has already been fixed. The reconciliation history is kept because
watching the discrepancy shrink toward zero as corrections land is the
feedback the review screen is built around.

### Querying spans the workspace; verification never does

Each statement proves itself against its own declared balances, and
statements are never merged to do arithmetic — combining two would destroy the
oracle, because there would no longer be declared balances bounding the rows.

Querying is the opposite case. Twelve months of one account, or a bank
statement beside a card statement, is exactly what someone wants to search
across. That is not the multi-account aggregation this project cut: the cut
was about *combining* accounts, and combining is still refused. On a bank
statement a debit means money left the account; on a card statement it means a
charge incurred. Adding them produces a number that means nothing, so no
total spans statements.

Results exclude unreconciled statements by default. A search returning forty
rows, three of them from a statement that is off by ₹1,499, would be the same
quiet lie the project exists to prevent. Including them is a deliberate
toggle, and every such row is labelled.

### Filters live in the URL

The query form submits by GET, so every result set is a link — shareable,
bookmarkable, correct under the back button — with no client state to keep in
sync. It also matches how the rest of the app works: the URL is the thing you
keep.

### Search uses the 'simple' text configuration, not 'english'

Statement descriptions are not prose. They are merchant names, payment rails
and reference codes. English stemming folds distinct tokens together and
English stop-word removal drops terms that carry meaning here. The tsvector is
maintained by a database trigger rather than by application code, because
extraction, corrections and any future backfill all write descriptions and
each would otherwise have to remember.

### The source page is rendered in the browser

A flagged row is a claim about a document. Showing the document, with the
exact strip the value was read from outlined, turns checking it from "open the
PDF and hunt for the row" into a glance — which is the difference between a
review screen someone uses and one they work around.

Rendering happens client-side. The alternative is a canvas implementation
inside a serverless function rasterising a page per request, to produce
something the browser can draw itself from a file it is already permitted to
fetch. The bucket stays private throughout: the browser is handed a signed
link that expires in five minutes, for one file, scoped to a workspace whose
id it already had.

The rectangle is not a guess. It is the bounding box of the positioned
fragments on the exact line the model cited — the same lookup that produced
the provenance record, drawn.

The pdfjs worker is copied into `public/` on install rather than committed, so
it can never drift out of step with the installed version, and so nothing is
fetched from a CDN at runtime.
