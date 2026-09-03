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
