"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import {
  MAX_UPLOAD_BYTES,
  checkFileMetadata,
  checkPdfSignature,
  formatBytes,
} from "@/lib/upload-validation";

/**
 * What the UI shows when a file is refused.
 *
 * Wider than the validation module's own code union on purpose: rejections
 * can also come from storage, the network, or a processing stage, and those
 * carry their own named codes. Every one of them still arrives with a code
 * and a human message — that is the invariant, not the specific set of codes.
 */
interface DisplayRejection {
  code: string;
  message: string;
}

/** The pipeline's own vocabulary, rendered for a person. */
const STAGE_LABEL: Record<string, string> = {
  uploaded: "Queued",
  parsing: "Reading the file",
  extracting: "Extracting transactions",
  reconciling: "Checking the arithmetic",
  verified: "Reconciles exactly",
  needs_review: "Needs review",
  failed: "Failed",
};

type ItemState =
  | { kind: "checking" }
  | { kind: "uploading" }
  | { kind: "processing"; stage: string }
  | {
      kind: "settled";
      statementId: string;
      status: string;
      discrepancy?: string | null;
      flagCount?: number;
      detail?: string | null;
    }
  | { kind: "rejected"; rejection: DisplayRejection };

interface UploadItem {
  id: string;
  name: string;
  size: number;
  state: ItemState;
}

/** Server errors already carry a named code and a human message. Use them. */
function toRejection(payload: unknown): DisplayRejection {
  const error = (payload as { error?: { code?: string; message?: string } })?.error;
  return {
    code: error?.code ?? "unreadable_file",
    message: error?.message ?? "The server rejected this file but didn't say why.",
  };
}

function stateLabel(state: ItemState): string {
  switch (state.kind) {
    case "checking":
      return "Checking";
    case "uploading":
      return "Uploading";
    case "processing":
      return STAGE_LABEL[state.stage] ?? state.stage;
    case "settled":
      return STAGE_LABEL[state.status] ?? state.status;
    case "rejected":
      return "Rejected";
  }
}

function stateStyle(state: ItemState): string {
  if (state.kind === "rejected") return "bg-red-50 text-red-700";
  if (state.kind === "settled") {
    if (state.status === "verified") return "bg-emerald-50 text-emerald-700";
    if (state.status === "needs_review") return "bg-amber-50 text-amber-700";
    return "bg-red-50 text-red-700";
  }
  if (state.kind === "processing") return "bg-blue-50 text-blue-700";
  return "bg-stone-100 text-stone-600";
}

export function UploadPanel({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // Drag events fire for every nested element. Counting enter/leave keeps the
  // highlight from flickering as the pointer crosses children.
  const dragDepth = useRef(0);

  const patch = useCallback((id: string, state: ItemState) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, state } : item)),
    );
  }, []);

  /**
   * Drives one statement through the pipeline.
   *
   * Each call advances a single stage and returns, which is what keeps every
   * request inside the serverless time limit. The stage names shown to the
   * user are the statement's real status, not a guess — "Extracting
   * transactions" appears because the row genuinely is mid-extraction.
   */
  const runPipeline = useCallback(
    async (id: string, statementId: string) => {
      // Generous, but finite: a pipeline that somehow never settles must stop
      // rather than poll this workspace forever.
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await fetch(`/api/statements/${statementId}/process`, {
          method: "POST",
        });

        const payload = await response.json();

        if (!response.ok) {
          patch(id, { kind: "rejected", rejection: toRejection(payload) });
          return;
        }

        if (payload.done) {
          patch(id, {
            kind: "settled",
            statementId,
            status: payload.status,
            discrepancy: payload.discrepancy ?? null,
            flagCount: payload.flagCount,
            detail: payload.errorDetail ?? null,
          });
          router.refresh();
          return;
        }

        patch(id, { kind: "processing", stage: payload.status });
      }

      patch(id, {
        kind: "rejected",
        rejection: {
          code: "processing_stalled",
          message: "Processing didn't finish. Reload to see where it stopped.",
        },
      });
    },
    [patch, router],
  );

  const process = useCallback(
    async (id: string, file: File) => {
      const metadata = checkFileMetadata(file);
      if (!metadata.ok) {
        patch(id, { kind: "rejected", rejection: metadata.rejection });
        return;
      }

      // Read only the first five bytes. An extension is a claim; this is the
      // file actually saying what it is.
      const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      const signature = checkPdfSignature(header);
      if (!signature.ok) {
        patch(id, { kind: "rejected", rejection: signature.rejection });
        return;
      }

      patch(id, { kind: "uploading" });

      try {
        // Step one: ask the server for somewhere to put the bytes.
        const registration = await fetch("/api/statements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            filename: file.name,
            size: file.size,
            contentType: file.type || "application/pdf",
          }),
        });

        const registered = await registration.json();

        if (!registration.ok) {
          patch(id, { kind: "rejected", rejection: toRejection(registered) });
          return;
        }

        // Step two: send the file straight to storage. It never goes through
        // our server, so the request-size limit never applies.
        const put = await fetch(registered.upload.url, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });

        if (!put.ok) {
          patch(id, {
            kind: "rejected",
            rejection: {
              code: "upload_failed",
              message: `Storage refused the upload (${put.status}). Try again.`,
            },
          });
          return;
        }

        // Step three: tell the server it landed. The server checks storage
        // itself before recording anything.
        const confirmation = await fetch("/api/statements/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            statementId: registered.statementId,
            workspaceId,
            filename: file.name,
            storagePath: registered.storagePath,
          }),
        });

        const confirmed = await confirmation.json();

        if (!confirmation.ok) {
          patch(id, { kind: "rejected", rejection: toRejection(confirmed) });
          return;
        }

        patch(id, { kind: "processing", stage: "uploaded" });
        router.refresh();

        await runPipeline(id, confirmed.statementId);
      } catch {
        patch(id, {
          kind: "rejected",
          rejection: {
            code: "network_error",
            message: "Couldn't reach the server. Check your connection and try again.",
          },
        });
      }
    },
    [patch, router, runPipeline, workspaceId],
  );

  const accept = useCallback(
    (fileList: FileList | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;

      const queued = files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        state: { kind: "checking" } as ItemState,
      }));

      setItems((current) => [...current, ...queued]);

      // Every file runs its own pipeline. One bad PDF in a batch must not
      // block or slow the others, so these are deliberately not sequential
      // and deliberately not short-circuited on the first failure.
      void Promise.allSettled(
        queued.map((item, index) => process(item.id, files[index])),
      );
    },
    [process],
  );

  const settled = items.filter(
    (i) => i.state.kind === "settled" || i.state.kind === "rejected",
  ).length;

  return (
    <section>
      <label
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setIsDragging(false);
          accept(event.dataTransfer.files);
        }}
        className={[
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center transition",
          isDragging
            ? "border-blue-400 bg-blue-50/60"
            : "border-stone-300 bg-white hover:border-stone-400 hover:bg-stone-50",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files);
            // Reset so selecting the same file twice still fires a change.
            event.target.value = "";
          }}
        />
        <p className="text-sm font-medium text-stone-800">
          Drop bank statement PDFs here, or click to choose
        </p>
        <p className="mt-1.5 text-xs text-stone-500">
          PDFs with a text layer · up to {formatBytes(MAX_UPLOAD_BYTES)} each ·
          several at once is fine
        </p>
      </label>

      {items.length > 0 && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-stone-500">
              This upload
            </h2>
            {settled === items.length && items.length > 1 && (
              <p className="text-xs text-stone-500">
                each file was processed independently
              </p>
            )}
          </div>

          <ul className="mt-2 divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
            {items.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-stone-800">
                    {item.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-stone-400">
                    {formatBytes(item.size)}
                  </span>
                  <span
                    className={[
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      stateStyle(item.state),
                    ].join(" ")}
                  >
                    {stateLabel(item.state)}
                  </span>
                </div>

                {item.state.kind === "rejected" && (
                  <p className="mt-1.5 text-xs leading-relaxed text-red-700">
                    {item.state.rejection.message}
                    <code className="ml-1.5 font-mono text-[11px] text-red-400">
                      {item.state.rejection.code}
                    </code>
                  </p>
                )}

                {item.state.kind === "settled" &&
                  item.state.status === "needs_review" && (
                    <p className="mt-1.5 text-xs leading-relaxed text-amber-700">
                      Off by {item.state.discrepancy}
                      {typeof item.state.flagCount === "number" &&
                        ` · ${item.state.flagCount} row${item.state.flagCount === 1 ? "" : "s"} to check`}
                    </p>
                  )}

                {item.state.kind === "settled" &&
                  item.state.status === "failed" &&
                  item.state.detail && (
                    <p className="mt-1.5 text-xs leading-relaxed text-red-700">
                      {item.state.detail}
                    </p>
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
