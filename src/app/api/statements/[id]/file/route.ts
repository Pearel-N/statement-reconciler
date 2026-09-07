import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/supabase";
import { isValidWorkspaceId } from "@/lib/workspace";

// Run next to the database rather than wherever the request lands. The
// Supabase project is in ap-northeast-2, and functions were being served from
// Washington by default — so every page paid a trans-Pacific round trip for
// a query that takes milliseconds once it arrives.
export const preferredRegion = "icn1";

/**
 * Hands the browser a short-lived link to the original PDF, so the review
 * screen can show the page a row came from.
 *
 * The bucket is private and stays private. Nothing here makes the file
 * public: the browser gets a URL that expires, for one file, scoped to a
 * workspace it already proved it knows the id of.
 */

const LINK_LIFETIME_SECONDS = 300;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspace") ?? "";

  if (!isValidWorkspaceId(workspaceId)) {
    return NextResponse.json(
      { error: { code: "invalid_workspace", message: "Invalid workspace." } },
      { status: 400 },
    );
  }

  // Scoped by workspace as well as id: knowing a statement id must not be
  // enough to read a document out of someone else's workspace.
  const statement = await prisma.statement.findFirst({
    where: { id, workspaceId },
    select: { storagePath: true },
  });

  if (!statement) {
    return NextResponse.json(
      {
        error: {
          code: "statement_not_found",
          message: "That statement doesn't exist in this workspace.",
        },
      },
      { status: 404 },
    );
  }

  const { data, error } = await storage().createSignedUrl(
    statement.storagePath,
    LINK_LIFETIME_SECONDS,
  );

  if (error || !data) {
    return NextResponse.json(
      {
        error: {
          code: "storage_unavailable",
          message: "Couldn't produce a link to the original file.",
        },
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: data.signedUrl, expiresIn: LINK_LIFETIME_SECONDS });
}
