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
