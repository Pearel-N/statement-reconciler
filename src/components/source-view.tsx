"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The page a row came from, with the row highlighted.
 *
 * This is what makes provenance real to a reviewer. A flagged row is a claim
 * about a document; being shown the document, with the exact strip of the
 * page the value was read from outlined, turns checking it from "open the PDF
 * and hunt" into a glance.
 *
 * Rendered in the browser rather than on the server. The alternative would
 * mean a canvas implementation in a serverless function, rasterising a page
 * per request, to produce something the browser can draw itself from a file
 * it is already allowed to fetch.
 *
 * The rectangle drawn here is not decoration and not a guess: it comes from
 * the positions the parser recorded for the exact line the model cited.
 */

export interface SourceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Points of page either side of the row, so it has visible context. */
const CONTEXT_PT = 26;

export function SourceView({
  statementId,
  workspaceId,
  page,
  box,
}: {
  statementId: string;
  workspaceId: string;
  page: number;
  box: SourceBox;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const response = await fetch(
          `/api/statements/${statementId}/file?workspace=${workspaceId}`,
        );
        if (!response.ok) throw new Error("no link");
        const { url } = await response.json();

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const doc = await pdfjs.getDocument({ url }).promise;
        const pdfPage = await doc.getPage(page);

        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;

        // Rendered at 2x and displayed at 1x so the text stays crisp on the
        // high-density screens this tool is used on.
        const scale = 2;
        const viewport = pdfPage.getViewport({ scale });

        const top = Math.max(0, box.y - CONTEXT_PT);
        const height = Math.min(
          box.height + CONTEXT_PT * 2,
          viewport.height / scale - top,
        );

        canvas.width = viewport.width;
        canvas.height = height * scale;
        canvas.style.width = "100%";

        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");

        // Shift the page up so the cited row sits in the visible strip: the
        // whole page is drawn, but only the band around the row is kept.
        context.translate(0, -top * scale);
        await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;

        if (cancelled) return;

        context.strokeStyle = "rgba(217, 119, 6, 0.9)";
        context.lineWidth = 2;
        context.fillStyle = "rgba(251, 191, 36, 0.18)";
        context.fillRect(
          (box.x - 4) * scale,
          (box.y - 2) * scale,
          (box.width + 8) * scale,
          (box.height + 4) * scale,
        );
        context.strokeRect(
          (box.x - 4) * scale,
          (box.y - 2) * scale,
          (box.width + 8) * scale,
          (box.height + 4) * scale,
        );

        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [statementId, workspaceId, page, box]);

  if (state === "failed") {
    return (
      <p className="text-xs text-stone-500">
        Couldn&apos;t load page {page} of the original file. The link may have
        expired — reload to try again.
      </p>
    );
  }

  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
        <canvas ref={canvasRef} className="block w-full" />
      </div>
      <figcaption className="mt-1 text-[11px] text-stone-400">
        {state === "loading" ? "Loading page…" : `Page ${page} of the original`}
      </figcaption>
    </figure>
  );
}
