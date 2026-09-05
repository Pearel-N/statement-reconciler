import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Querying verified transactions across a whole workspace.
 *
 * Two rules shape this.
 *
 * Verification stays per statement — each one proves itself against its own
 * declared balances, and statements are never merged to do arithmetic.
 * Querying is the opposite: twelve months of the same account, or a bank
 * statement beside a card statement, are exactly what someone wants to search
 * across.
 *
 * But results must never quietly mix proven and unproven rows. A search that
 * returned forty results, three of them from a statement that is off by
 * ₹1,499, would be the same quiet lie this project exists to prevent. So
 * unverified statements are excluded by default, and any row from one is
 * labelled when they are included.
 *
 * Written as SQL rather than assembled through the query builder because the
 * text search needs `websearch_to_tsquery` against the maintained tsvector,
 * and splitting the filters across two mechanisms would be harder to read
 * than one statement.
 */

export interface TransactionQuery {
  workspaceId: string;
  /** Free text over descriptions. Supports quoted phrases and OR. */
  text?: string;
  from?: string;
  to?: string;
  minAmount?: string;
  maxAmount?: string;
  direction?: "debit" | "credit";
  statementId?: string;
  includeUnverified?: boolean;
  limit?: number;
  offset?: number;
}

export interface TransactionHit {
  id: string;
  date: Date;
  description: string;
  amount: Prisma.Decimal;
  direction: "debit" | "credit";
  running_balance: Prisma.Decimal | null;
  source_page: number | null;
  is_corrected: boolean;
  statement_id: string;
  filename: string;
  bank_name: string | null;
  status: string;
  currency: string | null;
}

function conditions(query: TransactionQuery): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [
    Prisma.sql`s.workspace_id = ${query.workspaceId}::uuid`,
  ];

  if (!query.includeUnverified) {
    parts.push(Prisma.sql`s.status = 'verified'`);
  } else {
    // Even when unproven rows are wanted, statements that failed outright
    // have no trustworthy rows to offer.
    parts.push(Prisma.sql`s.status IN ('verified', 'needs_review')`);
  }

  if (query.text && query.text.trim() !== "") {
    parts.push(
      Prisma.sql`t.search_vector @@ websearch_to_tsquery('simple', ${query.text})`,
    );
  }

  if (query.from) parts.push(Prisma.sql`t.date >= ${query.from}::date`);
  if (query.to) parts.push(Prisma.sql`t.date <= ${query.to}::date`);
  if (query.minAmount)
    parts.push(Prisma.sql`t.amount >= ${query.minAmount}::numeric`);
  if (query.maxAmount)
    parts.push(Prisma.sql`t.amount <= ${query.maxAmount}::numeric`);
  if (query.direction)
    parts.push(Prisma.sql`t.direction = ${query.direction}::"Direction"`);
  if (query.statementId)
    parts.push(Prisma.sql`t.statement_id = ${query.statementId}::uuid`);

  return parts;
}

export async function searchTransactions(query: TransactionQuery): Promise<{
  rows: TransactionHit[];
  total: number;
}> {
  const where = Prisma.join(conditions(query), " AND ");
  const limit = Math.min(query.limit ?? 100, 500);
  const offset = query.offset ?? 0;

  const rows = await prisma.$queryRaw<TransactionHit[]>`
    SELECT t.id, t.date, t.description, t.amount, t.direction,
           t.running_balance, t.source_page, t.is_corrected,
           s.id AS statement_id, s.filename, s.bank_name, s.status, s.currency
    FROM transactions t
    JOIN statements s ON s.id = t.statement_id
    WHERE ${where}
    ORDER BY t.date DESC, t.row_index DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [{ count }] = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count
    FROM transactions t
    JOIN statements s ON s.id = t.statement_id
    WHERE ${where}
  `;

  return { rows, total: Number(count) };
}
