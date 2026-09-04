import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  absoluteStorageUrl,
  isStorageConfigured,
  storage,
} from "@/lib/supabase";
import { checkFileMetadata } from "@/lib/upload-validation";
import { isValidWorkspaceId } from "@/lib/workspace";

/**
 * Step one of an upload: register the intent and hand back somewhere to put
 * the bytes.
 *
 * The file itself never passes through this route. Serverless request bodies
 * are capped around 4.5 MB, so the browser uploads straight to storage with a
 * short-lived signed URL and this route only decides whether it may.
 *
 * No database row is written here. A row would represent a statement that may
 * never arrive — if the upload fails or the tab closes, the row would sit
 * there claiming a file exists. The row is created in /confirm, once the
 * bytes are provably in storage.
 */

const RegisterUploadBody = z.object({
  workspaceId: z.string(),
  filename: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  contentType: z.string().max(255).default("application/pdf"),
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

  const parsed = RegisterUploadBody.safeParse(json);
  if (!parsed.success) {
    return fail(
      400,
      "malformed_request",
      "The upload request was missing required fields.",
    );
  }

  const { workspaceId, filename, size, contentType } = parsed.data;

  if (!isValidWorkspaceId(workspaceId)) {
    return fail(
      400,
      "invalid_workspace",
      "That workspace link doesn't look valid. Open the app again to start a new one.",
    );
  }

  // The browser ran these same checks for instant feedback. This is where they
  // are enforced — a client-side check is a courtesy, not a control.
  const check = checkFileMetadata({ name: filename, size, type: contentType });
  if (!check.ok) {
    return fail(422, check.rejection.code, check.rejection.message);
  }

  if (!isStorageConfigured()) {
    return fail(
      503,
      "storage_unconfigured",
      "File storage isn't configured on this server, so uploads can't be accepted.",
    );
  }

  // Each statement gets its own id and its own path, so one file in a batch
  // can never collide with or block another.
  const statementId = randomUUID();
  const storagePath = `${workspaceId}/${statementId}.pdf`;

  const { data, error } = await storage().createSignedUploadUrl(storagePath);

  if (error || !data) {
    return fail(
      502,
      "storage_unavailable",
      "Couldn't prepare an upload slot. Storage didn't respond — try again.",
    );
  }

  return NextResponse.json({
    statementId,
    storagePath,
    upload: {
      mode: "signed-url" as const,
      url: absoluteStorageUrl(data.signedUrl),
    },
  });
}
