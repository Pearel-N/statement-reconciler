import { NextResponse } from "next/server";

import { advance } from "@/lib/pipeline";

// Run next to the database rather than wherever the request lands. The
// Supabase project is in ap-northeast-2, and functions were being served from
// Washington by default — so every page paid a trans-Pacific round trip for
// a query that takes milliseconds once it arrives.
export const preferredRegion = "icn1";

/**
 * Advances one statement by one stage.
 *
 * The client calls this repeatedly until `done`. Each call does one piece of
 * work and returns, which is what keeps every request inside the serverless
 * time limit and makes the reported progress true rather than decorative.
 */

// Extraction is the long pole. This is the ceiling a single stage is allowed;
// the staging exists so no stage comes close to it.
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const result = await advance(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "statement not found") {
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

    console.error("[process] stage threw", {
      statementId: id,
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });

    // A stage crashed in a way it didn't anticipate. The statement keeps its
    // current status so the next poll retries that stage rather than skipping
    // it — but the caller is told plainly rather than left polling forever.
    return NextResponse.json(
      {
        error: {
          code: "stage_failed",
          message:
            "A processing step failed unexpectedly. Retrying may work; if it doesn't, the file may be unusable.",
        },
      },
      { status: 500 },
    );
  }
}
