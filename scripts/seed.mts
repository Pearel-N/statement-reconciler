/**
 * Fills a fixed demo workspace with the fixtures, so anyone opening the app
 * sees a statement that reconciles and one that doesn't, without having to
 * upload anything first.
 *
 *   npm run seed
 *
 * Idempotent: it clears the demo workspace and rebuilds it. The workspace ID
 * is fixed so the link in the README keeps working.
 *
 * Costs three model calls. The scanned fixture is refused before extraction,
 * so it costs nothing — which is the point of that stage boundary.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { advance } from "@/lib/pipeline";
import { prisma } from "@/lib/prisma";
import { STORAGE_BUCKET, isStorageConfigured, storage } from "@/lib/supabase";

try {
  process.loadEnvFile(".env");
} catch {
  // Fine if the values are already exported.
}

/**
 * Fixed, so the README's link survives a reseed.
 *
 * Every character must be valid hex, and it has to satisfy the same v4 shape
 * the app validates against — a memorable-looking ID that isn't a real UUID
 * gets rejected by Postgres and 404s in the app.
 */
const DEMO_WORKSPACE = "decade00-0000-4000-8000-000000000001";

const FIXTURES = [
  "clean.pdf",
  "missing-row.pdf",
  "carry-forward.pdf",
  "scanned-no-text-layer.pdf",
];

if (!isStorageConfigured()) {
  console.error("Storage isn't configured — fill in .env first.");
  process.exit(1);
}

const bucket = storage();

console.log(`seeding workspace ${DEMO_WORKSPACE}\n`);

// Start clean so reseeding doesn't stack duplicates.
const existing = await prisma.statement.findMany({
  where: { workspaceId: DEMO_WORKSPACE },
  select: { id: true, storagePath: true },
});

if (existing.length > 0) {
  await bucket.remove(existing.map((s) => s.storagePath));
  await prisma.statement.deleteMany({ where: { workspaceId: DEMO_WORKSPACE } });
  console.log(`cleared ${existing.length} existing statement(s)\n`);
}

for (const filename of FIXTURES) {
  const statementId = randomUUID();
  const storagePath = `${DEMO_WORKSPACE}/${statementId}.pdf`;
  const bytes = readFileSync(`fixtures/${filename}`);

  process.stdout.write(`${filename.padEnd(28)} uploading…`);

  const { error } = await bucket.upload(storagePath, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });

  if (error) {
    console.log(` failed: ${error.message}`);
    continue;
  }

  await prisma.statement.create({
    data: {
      id: statementId,
      workspaceId: DEMO_WORKSPACE,
      filename,
      storagePath,
      fileBytes: bytes.byteLength,
      status: "uploaded",
    },
  });

  // Drive it through exactly the same stages the browser would.
  let guard = 0;
  let result = await advance(statementId);

  while (!result.done && guard < 10) {
    process.stdout.write(` ${result.status}…`);
    result = await advance(statementId);
    guard += 1;
  }

  const summary =
    result.status === "needs_review"
      ? `off by ${result.discrepancy}, ${result.flagCount} flagged`
      : result.status === "failed"
        ? (result.errorCode ?? "failed")
        : "reconciles exactly";

  console.log(` ${result.status} — ${summary}`);
}

const base = process.env.APP_URL ?? "http://localhost:3000";
console.log(`\ndone. open ${base}/w/${DEMO_WORKSPACE}`);
console.log(`bucket: ${STORAGE_BUCKET}`);

await prisma.$disconnect();
