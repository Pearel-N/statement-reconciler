# Decisions

**A Next.js and Supabase application, built in three days, that extracts
transactions from bank statement PDFs with Claude and then proves the
extraction correct — reconciling it against the statement's own declared
balances, and naming the exact rows responsible when it doesn't add up.**

Live at https://statement-reconciler-topaz.vercel.app ·
[`README.md`](./README.md) for how to run it ·
[`SPEC.md`](./SPEC.md) for the scope set before any code was written.

---

Written as the work happened, not reconstructed at the end.

Each entry is a choice that had a real alternative. What I did, why, and what
I turned down. Kept short on purpose.

Three days: Thursday 3rd to Saturday 5th September.

---

## The problem, and why this shape

### The brief, and what I narrowed it to

The brief was to turn messy documents into structured, queryable data. That's
enormous. Any document type, any structure.

I narrowed it to one document type: bank statements. Not because they're the
hardest to read, but because of one property almost no other document has.

### Language models get things wrong, and usually you can't tell

Extraction with a model is not deterministic. Ask it to read the same
statement twice and you can get two different answers. It will misread a
digit, drop a row, or read a credit as a debit.

For most documents there's no way to know. Extract data from a contract or an
invoice and the only way to check is to read the document yourself — which
defeats the point of extracting it.

So the interesting question isn't *how do you extract*. It's *how do you know
the extraction is right*.

### Bank statements carry their own proof

A statement declares an opening balance and a closing balance. The
transactions between them must account for the difference. Exactly.

That makes the document self-verifying. If the extracted rows don't produce
the declared difference, the extraction is wrong. Not probably wrong — wrong.

That arithmetic is the whole foundation of this app. It extracts, checks its
own work, works out which rows are responsible, and asks a person to fix
exactly those.

**The product is not extraction. It's trustworthy extraction.**

### What I deliberately did not build

No charts, no spending categories, no dashboard. Charts are not the product.
If this became a visualisation tool, the hard part disappears and it's a
database with graphs on top.

No login, no OCR for scans, no multiple currencies, no natural-language
querying. Each has a reason, and each reason is somewhere below.

The rule I set myself: if a new feature idea appears, it goes in the cut list
with a reason, rather than into the build. I broke it zero times, including
once when I wanted to.

---

## The stack, and why each piece

**Next.js, App Router.** One deployable thing. Server work and screens live in
the same project, so there's no separate API to keep in step.

**Supabase.** Postgres and file storage in one hosted service. Hosted matters:
an evaluator gets a working URL rather than a docker-compose file.

**Prisma.** A typed database client, with migrations committed to the repo. So
anyone can clone this and rebuild the same database with one command. The
schema file doubles as documentation.

**Zod.** Validates whatever the model returns before anything downstream
touches it. One schema definition does two jobs — it validates the answer, and
it generates the contract the model is given. They can't drift apart, because
there's only one of them.

**Claude, for extraction.** Used as a component, not an authority. It's given
text, asked for values, and its answer is validated, then checked against
arithmetic. Nothing assumes it's right.

**decimal.js, for money.** Explained below. Money is never a float.

**pdf.js, for reading PDFs.** The only library that gives text *with positions*
on the page, which is what makes provenance possible.

**Vercel, for hosting.** Deploys from the repo, and its serverless model
shaped two real decisions below about file size and processing time.

**Vitest, for tests.** Runs in plain Node, because the logic worth testing has
no database, no framework and no model in it.

---

## Day 1 — Thursday

### Deploy on day one, with nothing to deploy

I pushed an empty app to production before writing a feature.

Environment variables, database pooling and storage permissions are the three
things that break late in a project. Deploying early means they break on day
one, when nothing is at stake.

It paid off. Two bugs only appear in production, and I found them with time to
spare. They're at the bottom of this file.

### Money is a Decimal, never a float

In a browser console, `0.1 + 0.2` gives `0.30000000000000004`.

Computers store decimals in binary, and some decimals have no exact binary
form. Small errors creep in and add up. Over a hundred rows that is enough to
make a statement that balances look like it doesn't.

So money is `Decimal` everywhere — Postgres `numeric` in the database,
`decimal.js` in code. I write `a.plus(b)`, never `a + b`.

A test adds `0.1` ten times and demands exactly `1`. It exists so that
swapping in a plain number breaks the build.

### Debit or credit is its own column

The shortcut is to store a debit as `-1500` and a credit as `+2000`. One
column instead of two.

I didn't. Amounts are always positive, and a separate column says which
direction the money went.

The reason: a minus sign would have to be applied by the extractor — the part
reading the PDF, which is the part I trust least. One wrong sign and the
arithmetic is wrong with nothing to catch it.

Keeping direction separate means the flip happens in one small function I
control and test.

I gave up simpler summing and slightly easier filtering. Worth it.

### Provenance columns exist in the first migration

`source_page` and `source_bbox` were in the database before anything wrote to
them.

Adding them later would mean changing the extractor's output, its tests and
the database schema all at once — on the day the review screen was due.

### Bounding boxes are worked out in code, not asked of the model

Give a model plain text and it has no idea where that text sat on the page.
Any coordinates it offered would be invented.

So the PDF is read with positions kept, the model gets text, and each row it
returns is matched back to the fragments it came from. Provenance is
calculated, not generated.

Which is the same principle as the reconciliation itself, applied to layout.

### No login. The URL is the key

Landing on the app creates a workspace and puts a random ID in the address
bar. That address is the only way back.

Five scored days, and access control demonstrates nothing this project is
being judged on. The IDs are 122 bits of randomness, so they can't be guessed,
and nothing in the app lists them.

The cost is real and I say it out loud: lose the link and you lose the
workspace. Anyone you send it to has access forever, and there's no way to
take it back.

That's fine for a demo and not fine for real financial data. Which is exactly
why authentication is the first thing after this.

### The same checks run twice, and only the second one counts

The browser checks a file's size, name and leading bytes so the user gets an
instant answer. The server runs the identical functions again.

That isn't distrust of the user. Anything in a browser can be bypassed — I
proved it with a `curl` command that the server correctly rejected.

The browser check is a courtesy. The server check is the control.

Both call the same module, so they can't drift apart.

### The extension is a claim. The first five bytes are a fact

`report.pdf` is often a renamed `.docx`, and the file type the browser reports
is just a guess.

Every real PDF starts with the characters `%PDF-`. Reading five bytes turns
"failed somewhere in the parser" into "this isn't a PDF" at the moment of
selection.

### Files in a batch are processed independently, and the screen shows it

Uploads run in parallel and none of them can stop another.

Drop three good statements and one junk file and you get three accepted and
one specifically rejected, with a summary line saying so.

I wanted that visible on screen rather than claimed in a README.

### An unfinished feature says so

Before storage was wired up, the upload route replied "not configured" and the
screen showed "checked, but not saved".

The alternative was a green tick for a file that went nowhere. In an app built
on knowing when it's wrong, that's the worst possible thing to ship.

### Light theme only

This is a desktop tool for finance work. A deliberate light theme reads better
than a half-finished dark one, and I set it explicitly so the browser doesn't
invent one.

---

## Day 2 — Friday

### The reconciliation engine was built before the extractor

It's pure functions — no PDF, no database, no model, no React. So it could be
proven correct while extraction didn't exist yet.

Building the harder page-handling logic first would have meant debugging two
unproven layers against each other.

For the same reason it depends on `decimal.js` directly rather than on
Prisma's version of it. Nothing in the engine knows a database exists.

### Each balance check restarts from the printed balance

This is the most important decision in the project.

Most statements print a balance after every row. The obvious approach is to
keep your own running total and compare it to each one.

That approach is useless. If row 40 is misread, your total is wrong from then
on, so rows 41 through 140 all fail too. The app tells a person that a hundred
rows are wrong — no better than saying the statement doesn't add up.

What I do instead: after each row, throw away my number and start again from
the balance the document itself printed.

Row 41 is checked against row 40's printed balance, which is correct no matter
what was misread on row 40. So exactly one row fails, and the size of the gap
is exactly the amount that was wrong.

That is the difference between "this statement doesn't add up" and "row 40 is
wrong, by ₹1,800".

It finds missing rows too. If a row vanished, the next row's check fails by
exactly the missing amount.

### Prisma 6, not Prisma 7

Prisma 7 moves the connection settings into a separate file, needs an extra
database adapter at runtime, and has known problems with Next.js 16.

It would give this project nothing it uses.

The general rule, which is the real answer: adopt a new major version when it
gives you something you need. "It's newer" isn't a reason.

I had five days, and the interesting problem was extraction — not the database
library.

### The database row is written after the file arrives, not before

Asking for an upload slot writes nothing.

If a row were created first and the upload then failed, the row would sit
there claiming a file exists that doesn't. Everything downstream would have to
defend against that.

So a second call creates the row, and only after the server asks storage
whether the bytes really landed. The server records storage's byte count, not
the browser's, and refuses any file path outside the workspace asking for it.

### One flag per problem, and silence when unsure

Two rules about what the review screen is allowed to say.

**One flag per break.** I don't merge nearby breaks. Merging made sense
against the naive walk, where one bad row caused a cascade. Restarting from
the printed balance removed the cascade, so two breaks are now two real
problems.

**Silence when more than one answer fits.** If two rows equally explain a
discrepancy, the app says nothing.

Ranking them and showing the best guess would look cleverer and be worse. On
screen, a guess looks exactly like a proof. And a user sent to re-read a
correct row stops trusting every flag afterwards.

### The PDF is read once, for two different purposes

A PDF doesn't store rows and columns. It stores fragments of text, each with a
position. Tables are an illusion made by where things sit.

The model needs text it can read as a table — columns lined up, empty cells
still visibly empty. Which column a number sits in is what decides whether
it's money in or money out.

Provenance needs the opposite: exact coordinates, so a row can be traced back
to a region of the page.

One pass produces both. Raw positions are kept, and each line is also rendered
as fixed-width text, padded to the column each fragment's position implies.

The padding is the point. On a credit row there is nothing at all in the debit
column — no fragment, not even an empty string. Joining fragments with spaces
would close the gap and make a credit read as a debit.

### The model is never asked where anything is

It's asked which numbered line it read a row from.

I already know where that line sits, because the parser recorded it. So the
highlight is looked up, not generated.

PDFs measure from the bottom-left of the page. I convert to top-left once, at
the edge of the system, so nothing after that has to remember which way up the
page is.

### "No text layer" is a threshold, not a zero check

Scanned pages often carry a stray character from a watermark or a stamp.

Refusing only on exactly zero characters would let those through to
extraction, where the model would invent a statement out of nothing.

Forty characters across the whole document is the line.

### Corrections replay the stored answer, never a new model call

`raw_extraction` holds the model's unedited output.

When someone fixes a row, reconciliation re-runs from the stored rows. No
second model call, no charge, no wait.

That's what lets the discrepancy shrink while a person works. It also means a
bad extraction can be debugged later without paying to reproduce it.

---

## Day 3 — Saturday

### Processing moves one step per request

Extraction takes longer than a serverless function is allowed to live, so it
can't happen inside the upload request.

Instead, one endpoint does a single step and returns. The browser calls it
again and again until it reports finished.

Three things follow. Every request finishes well inside the time limit. A
crash loses only the step that was running, and the next call retries it. And
the status column becomes the real state machine, so "Extracting transactions"
appears because the row genuinely is extracting — not because a spinner is
guessing.

Reading the file is its own step, before extraction. So a file that can't be
read costs nothing. Encrypted, corrupt and scanned files are all refused
before a single token is spent.

### There is no lock, and that's deliberate

Two calls arriving at once would at worst repeat a step.

Reading the file changes nothing. Extraction deletes its own rows before
writing again, so it can't double anything. Reconciliation adds a new run,
which is what it's meant to do.

So a collision costs one wasted model call, not corrupt data. And one browser
polling makes collisions unlikely anyway.

A proper queue is the right answer with real concurrency. It's the wrong
answer for a five-day build, and pretending otherwise would have spent the
time on infrastructure instead of the problem being judged.

### Flags are replaced; reconciliation runs are kept

Flags describe how things stand now. A stale one would send someone to
re-check a row they already fixed.

The history of reconciliation runs is kept, because watching the discrepancy
shrink toward zero is the feedback the review screen is built around.

### Search spans the workspace. Verification never does

Each statement proves itself against its own declared balances. Statements are
never merged to do arithmetic — combining two would destroy the proof, because
there'd be no declared balances bounding the rows.

Searching is the opposite case. Twelve months of one account, or a bank
statement beside a card statement, is exactly what someone wants to look
across.

That isn't the multi-account aggregation I cut. That cut was about
*combining* accounts, and combining is still refused. On a bank statement a
debit means money left the account. On a card statement it means a charge you
now owe. Adding them gives a number that means nothing.

Rows from statements that don't reconcile are hidden by default. A search
returning forty rows, three from a statement that's off by ₹1,499, would be
the same quiet lie this project exists to prevent. Including them is a
deliberate toggle, and every such row is labelled.

### Filters live in the URL

The search form submits by GET, so every result set is a link — shareable,
bookmarkable, and correct under the back button. No client state to keep in
sync.

It also matches how the rest of the app works. The URL is the thing you keep.

### Search treats descriptions as codes, not prose

Postgres's default English text search stems words and drops stop-words. That
suits prose. Statement descriptions are merchant names, payment rails and
reference numbers.

Worse, Postgres's parser recognises structured tokens. It read
`UPI/DR/741520749048/Lumen Broadband/NWBK` as file paths and indexed
`Broadband/NWBK` as one token — so searching `broadband` found nothing.

I flatten every separator to a space before indexing, and do the same to the
search text. A database trigger keeps the index current, because extraction,
corrections and any future backfill all write descriptions and each would
otherwise have to remember.

Worth noting how this was found: the default setup looked like it worked. It
only failed on the one kind of text this app actually stores, and it took
typing a word a real user would type.

### The source page is drawn in the browser

A flagged row is a claim about a document. Showing the document, with the
exact line outlined, turns checking it from "open the PDF and hunt" into a
glance.

Rendering happens in the browser. The alternative is a serverless function
rasterising a page per request, to produce something the browser can draw
itself from a file it's already allowed to fetch.

The bucket stays private throughout. The browser gets a link that expires in
five minutes, for one file, in a workspace it already had the ID for.

The rectangle is not a guess. It's the box around the fragments on the exact
line the model cited.

---

## Two failures that only happen in production

Both worked perfectly on my laptop and failed on every upload in production.
Neither was a logic error. Both were about which files get packaged.

### An optional dependency that only existed for one operating system

pdf.js needs a package called `@napi-rs/canvas` to work under Node, and lists
it as *optional*.

Optional dependencies are resolved per operating system. Installing on a Mac
wrote the Mac binary into `package-lock.json` and nothing for Linux. So
production had nothing to load.

Fixed by depending on it directly and rebuilding the lockfile, which records
every platform's binary.

The lesson: a lockfile is a record of one machine's install, and optional
dependencies are where that leaks.

### A worker file the bundler couldn't see

pdf.js loads its worker by building a file path at runtime.

Bundlers work out what to ship by following references in the code. A path
built at runtime isn't a reference it can follow, so the worker was left out
of the deployment.

Every PDF then failed with "Setting up fake worker failed" — a message that
points at pdf.js rather than at packaging, which is what made it slow to find.

Fixed by resolving the worker through a static path and naming the files
explicitly for the bundler.

### What made both of them findable

The parse failure handler was returning a clean message to the user and
throwing the cause away.

Adding a server-side log of the real error — with the byte count and the
file's first eight bytes beside it — turned "it doesn't work" into
`header: '%PDF-1.4'`, 55,953 bytes. That killed two theories in one line. The
file had arrived intact and storage was fine, which left only packaging.

That logging then had a bug of its own. pdf.js hands the file buffer to its
worker, which empties it, so reading the header afterwards crashed — turning
every named parse failure into an unhandled error. A test caught it, on the
path that only runs when something else has already gone wrong.

The wider point, and the reason deploying on day one was worth it: a laptop
cannot find these. Only production has the other operating system and the
other bundler.

---

## After the first end-to-end pass

### Functions run next to the database

Every page reads the database on each request, and the Supabase project is in
Seoul. Vercel was serving the functions from Washington by default, so each
page paid a trans-Pacific round trip for a query that takes milliseconds once
it arrives. Navigation took two to three seconds.

Pinning the functions to the same region removes the round trip.

Seoul was itself a compromise — Mumbai would be closer to the user — but the
region was fixed when the project was created, and moving the database late
would have been a bigger risk than the latency it saves.

### Every page has a loading state

The App Router fetches a page from the server before it transitions. Without a
`loading.tsx` the previous screen simply sits there until the new one arrives,
so a click looks like nothing happened.

That reads as broken rather than slow, which is a worse impression than the
delay itself. Each route now paints a skeleton of its own shape immediately.

Worth noting that the region fix and this one solve different problems. One
makes it faster; the other makes it honest about what it's doing. The second
matters more, because a user who can see that something is happening will wait
and a user who can't will click again.

---

## A real statement, after submitting

### The "is this a statement" check was too strict about dates

I described this check as deliberately permissive, on the grounds that
wrongly turning away a real statement is far worse than letting an invoice
through — an invoice costs one model call, which the schema and the
arithmetic then reject.

It wasn't permissive enough. It matched dates separated by `/` or `-` only.
An ICICI transaction export writes `08.06.2026` with dots, so not one of its
214 rows matched, and a genuine bank statement was refused with a confident
message saying it didn't look like a bank statement.

The pattern now accepts `.`, `/` and `-`, and month names. A false positive
here is cheap and a false negative is not, so it errs wide on purpose. There
are tests for each format, including the one that failed.

Found by testing with a real statement rather than the fixtures I generated —
which is exactly why that was on the list.

### Some statements declare no opening or closing balance at all

The same document is a *transaction history* rather than a statement. It
prints a running balance on every row but never declares an opening or
closing figure, so there is nothing for the reconciliation oracle to check
against.

The app already handles this honestly: it keeps the rows and reports that the
statement cannot be verified, rather than claiming success. That is the right
behaviour and it is tested.

But it is weaker than it needs to be. Where a running-balance column exists,
the row-to-row walk is still a genuine independent check — each printed
balance must equal the previous one plus or minus that row's amount — and it
catches misread amounts and dropped rows without any declared totals. What it
cannot catch is rows missing from the very start or the very end, which is
precisely what the declared balances bound.

Running the walk in that case, and saying plainly which class of error is
still being checked and which isn't, is the next thing I would build. It is
not in this version.

### The layout renderer assumed every PDF uses the same units

A real statement arrived whose pages are 2125 points wide rather than A4's
595 — generated at roughly three and a half times the usual scale.

The fixed-width renderer pads each fragment to the column its x position
implies, using a character width measured in points. On a page that size,
every line was padded out to 438 characters and two thirds of the prompt was
whitespace. Three pages produced 131,000 characters, and the request outlived
the function making it. The user saw "couldn't reach the server".

The character width is now scaled to the page. An A4 document is completely
unaffected; the oversized one shrinks by 54%. A test pins the A4 case so the
regression can't come back quietly.

### A step that runs out of time now says so

When a processing step exceeds its limit, the platform kills it and answers
with a gateway error page rather than the JSON the client expects. Parsing
that threw, the throw was caught by the outer network handler, and the user
was told the server couldn't be reached — which was untrue and sent them to
check their wifi.

The client now distinguishes a response it can't parse from a request that
never arrived, and says the step ran out of time.

### Very large statements are still a limitation

The scaling fix halves the prompt but doesn't remove the ceiling. A statement
with several hundred transactions produces enough output that generation alone
can exceed the time a single function is allowed.

The real fix follows the architecture already here: extraction is one stage of
a pipeline that advances one step per request, so it can become one step *per
page*, with each call doing a page and returning. Nothing about the staging
would need to change — only the unit of work.

That isn't in this version. What is in this version is that the failure is now
reported accurately rather than blamed on the network.
