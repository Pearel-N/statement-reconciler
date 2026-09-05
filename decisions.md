# Decisions

Written as the work happened, not reconstructed at the end.

Each entry is a choice that had a real alternative. What we did, why, and what
we turned down. Kept short on purpose.

---

## Day 1

### Deploy on day one, with nothing to deploy

We pushed an empty app to production before writing a feature.

Environment variables, database pooling and storage permissions are the three
things that break late in a project. Deploying early means they break on day
one, when nothing is at stake.

It paid off. Two bugs only appear in production, and we found them with time
to spare. They're at the bottom of this file.

### Money is a Decimal, never a float

In a browser console, `0.1 + 0.2` gives `0.30000000000000004`.

Computers store decimals in binary, and some decimals have no exact binary
form. Small errors creep in and add up. Over a hundred rows that is enough to
make a statement that balances look like it doesn't.

So money is `Decimal` everywhere — Postgres `numeric` in the database,
`decimal.js` in code. We write `a.plus(b)`, never `a + b`.

A test adds `0.1` ten times and demands exactly `1`. It exists so that
swapping in a plain number breaks the build.

### Debit or credit is its own column

The shortcut is to store a debit as `-1500` and a credit as `+2000`. One
column instead of two.

We didn't. Amounts are always positive, and a separate column says which
direction the money went.

The reason: a minus sign would have to be applied by the extractor — the part
reading the PDF, which is the part we trust least. One wrong sign and the
arithmetic is wrong with nothing to catch it.

Keeping direction separate means the flip happens in one small function we
control and test.

We gave up simpler summing and slightly easier filtering. Worth it.

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

The cost is real and we say it out loud: lose the link and you lose the
workspace. Anyone you send it to has access forever, and there's no way to
take it back.

That's fine for a demo and not fine for real financial data. Which is exactly
why authentication is the first thing after this.

### The same checks run twice, and only the second one counts

The browser checks a file's size, name and leading bytes so the user gets an
instant answer. The server runs the identical functions again.

That isn't distrust of the user. Anything in a browser can be bypassed — we
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

We wanted that visible on screen rather than claimed in a README.

### An unfinished feature says so

Before storage was wired up, the upload route replied "not configured" and the
screen showed "checked, but not saved".

The alternative was a green tick for a file that went nowhere. In an app built
on knowing when it's wrong, that's the worst possible thing to ship.

### Light theme only

This is a desktop tool for finance work. A deliberate light theme reads better
than a half-finished dark one, and we set it explicitly so the browser doesn't
invent one.

---

## Day 2

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
on, so rows 41 through 140 all fail too. The app tells a human that a hundred
rows are wrong — no better than saying the statement doesn't add up.

What we do instead: after each row, throw away our number and start again from
the balance the document itself printed.

Row 41 is checked against row 40's printed balance, which is correct no matter
what we misread on row 40. So exactly one row fails, and the size of the gap
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

We had five days, and the interesting problem was extraction — not the
database library.

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

**One flag per break.** We don't merge nearby breaks. Merging made sense
against the naive walk, where one bad row caused a cascade. Restarting from
the printed balance removed the cascade, so two breaks are now two real
problems.

**Silence when more than one answer fits.** If two rows equally explain a
discrepancy, the app says nothing.

Ranking them and showing the best guess would look cleverer and be worse. On
screen, a guess looks exactly like a proof. And a user sent to re-read a
correct row stops trusting every flag afterwards.

---

## Day 3

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

We already know where that line sits, because the parser recorded it. So the
highlight is looked up, not generated.

PDFs measure from the bottom-left of the page. We convert to top-left once, at
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

## Day 4

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

That isn't the multi-account aggregation we cut. That cut was about
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

We flatten every separator to a space before indexing, and do the same to the
search text. A database trigger keeps the index current, because extraction,
corrections and any future backfill all write descriptions and each would
otherwise have to remember.

Worth noting how this was found: the default setup looked like it worked. It
only failed on the one kind of text this app actually stores, and it took
someone typing a word a real user would type.

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

## Day 5 — two failures that only happen in production

Both worked perfectly on a laptop and failed on every upload in production.
Neither was a logic error. Both were about which files get packaged.

### An optional dependency that only existed for one operating system

pdfjs needs a package called `@napi-rs/canvas` to work under Node, and lists
it as *optional*.

Optional dependencies are resolved per operating system. Installing on a Mac
wrote the Mac binary into `package-lock.json` and nothing for Linux. So
production had nothing to load.

Fixed by depending on it directly and rebuilding the lockfile, which records
every platform's binary.

The lesson: a lockfile is a record of one machine's install, and optional
dependencies are where that leaks.

### A worker file the bundler couldn't see

pdfjs loads its worker by building a file path at runtime.

Bundlers work out what to ship by following references in the code. A path
built at runtime isn't a reference it can follow, so the worker was left out
of the deployment.

Every PDF then failed with "Setting up fake worker failed" — a message that
points at pdfjs rather than at packaging, which is what made it slow to find.

Fixed by resolving the worker through a static path and naming the files
explicitly for the bundler.

### What made both of them findable

The parse failure handler was returning a clean message to the user and
throwing the cause away.

Adding a server-side log of the real error — with the byte count and the
file's first eight bytes beside it — turned "it doesn't work" into
`header: '%PDF-1.4'`, 55,953 bytes. That killed two theories in one line. The
file had arrived intact and storage was fine, which left only packaging.

That logging then had a bug of its own. pdfjs hands the file buffer to its
worker, which empties it, so reading the header afterwards crashed — turning
every named parse failure into an unhandled error. A test caught it, on the
path that only runs when something else has already gone wrong.

The wider point, and the reason deploying on day one was worth it: a laptop
cannot find these. Only production has the other operating system and the
other bundler.
