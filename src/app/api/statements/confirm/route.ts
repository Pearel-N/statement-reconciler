import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isStorageConfigured, storage } from "@/lib/supabase";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-validation";
import { isValidWorkspaceId } from "@/lib/workspace";

// Run next to the database rather than wherever the request lands. The
// Supabase project is in ap-northeast-2, and functions were being served from
// Washington by default — so every page paid a trans-Pacific round trip for
// a query that takes milliseconds once it arrives.
export const preferredRegion = "icn1";

/**
 * Step two of an upload: the browser says the bytes are in storage.
 *
 * The browser is not taken at its word. Before any row is written, this route
 * asks storage whether the object actually exists and how big it really is —
 * and uses storage's own number, not the browser's. Otherwise anyone could
 * create statement rows for files that were never uploaded.
 */

const ConfirmUploadBody = z.object({
  statementId: z.string().uuid(),
  workspaceId: z.string(),
  filename: z.string().min(1).max(255),
  storagePath: z.string().min(1).max(512),
});

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "malformed_request", "The request body wasn't valid JSON.");
  }

  const parsed = ConfirmUploadBody.safeParse(json);
  if (!parsed.success) {
    return fail(
      400,
      "malformed_request",
      "The confirmation request was missing required fields.",
    );
  }

  const { statementId, workspaceId, filename, storagePath } = parsed.data;

  if (!isValidWorkspaceId(workspaceId)) {
    return fail(400, "invalid_workspace", "That workspace link doesn't look valid.");
  }

  // A workspace may only confirm files under its own prefix. Without this,
  // a crafted request could attach someone else's file to this workspace.
  if (!storagePath.startsWith(`${workspaceId}/`)) {
    return fail(
      400,
      "invalid_storage_path",
      "That file doesn't belong to this workspace.",
    );
  }

  if (!isStorageConfigured()) {
    return fail(503, "storage_unconfigured", "File storage isn't configured.");
  }

  // Ask storage what is actually there.
  const folder = storagePath.slice(0, storagePath.lastIndexOf("/"));
  const name = storagePath.slice(storagePath.lastIndexOf("/") + 1);

  const { data: listed, error: listError } = await storage().list(folder, {
    search: name,
  });

  if (listError) {
    return fail(
      502,
      "storage_unavailable",
      "Couldn't verify the upload with storage — try again.",
    );
  }

  const object = listed?.find((entry) => entry.name === name);

  if (!object) {
    return fail(
      409,
      "upload_not_found",
      "The upload didn't complete — the file isn't in storage. Try uploading it again.",
    );
  }

  const actualBytes = Number(object.metadata?.size ?? 0);

  if (actualBytes === 0) {
    return fail(422, "empty_file", "The uploaded file is empty.");
  }

  if (actualBytes > MAX_UPLOAD_BYTES) {
    return fail(
      422,
      "file_too_large",
      "The uploaded file is larger than the limit and was rejected.",
    );
  }

  const statement = await prisma.statement.create({
    data: {
      id: statementId,
      workspaceId,
      filename,
      storagePath,
      fileBytes: actualBytes,
      status: "uploaded",
    },
  });

  return NextResponse.json({
    statementId: statement.id,
    status: statement.status,
    fileBytes: statement.fileBytes,
  });
}
