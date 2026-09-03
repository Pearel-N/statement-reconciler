# Statement Reconciler

Extracts transactions from bank statement PDFs and then **checks its own work**.

LLM extraction is non-deterministic and will get things wrong. Bank statements
carry their own correctness proof: the transactions must reconcile against the
declared opening and closing balances. This app uses that arithmetic as an
oracle — it extracts, reconciles, localises where it likely failed, and asks a
human to resolve exactly that and nothing else.

The product is not extraction. It's *trustworthy* extraction.

See [`SPEC.md`](./SPEC.md) for scope and [`decisions.md`](./decisions.md) for
the reasoning behind each engineering choice.

---

## Setup

Requires Node 20+ and a Supabase project (free tier is enough).

```bash
git clone <repo-url>
cd statement-reconciler
npm install
cp .env.example .env
# fill in .env from your Supabase project settings — see notes in the file
npm run db:migrate
npm run dev
```

Open http://localhost:3000. A workspace is created for you and its ID goes in
the URL. That URL is your key — there is no login (see `decisions.md`).

### Supabase, once

1. Create a project.
2. **Storage → New bucket** named `statements`, **private**.
3. **Project Settings → Database** for the two connection strings.
4. **Project Settings → API** for the URL and the service role key.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:studio` | Browse the database |
| `npm run lint` | Lint |
