/**
 * Upload validation.
 *
 * Pure functions, no framework imports, no I/O - so the same rules run on the
 * client (instant feedback, no wasted round trip) and on the server (the only
 * place a rule is actually enforced). A client-side check is a courtesy; the
 * server repeats every one of them.
 *
 * Every rejection carries a named code and a message a human can act on.
 * There is no generic "invalid file" anywhere in here - that is the standard
 * the whole project is held to, starting at the front door.
 */

/**
 * Codes that overlap with the Prisma `ErrorCode` enum use the same spelling
 * deliberately, so an upload rejection and a pipeline failure are the same
 * vocabulary end to end.
 */
export type UploadRejectionCode =
  | "file_too_large"
  | "empty_file"
  | "unreadable_file";

export interface UploadRejection {
  code: UploadRejectionCode;
  message: string;
}

export type UploadCheck =
  | { ok: true }
  | { ok: false; rejection: UploadRejection };

const OK: UploadCheck = { ok: true };

function reject(code: UploadRejectionCode, message: string): UploadCheck {
  return { ok: false, rejection: { code, message } };
}

/**
 * 15 MB. Chosen against the constraint, not picked at random: uploads go
 * straight to object storage rather than through a serverless function, and
 * anything larger is a scanned document in practice - which this app declines
 * for a different, honest reason further down the pipeline.
 */
export const MAX_UPLOAD_BYTES = 15_000_000;

/** The first five bytes of every valid PDF. */
const PDF_MAGIC = "%PDF-";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Checks what can be known from the file's metadata alone - instant, before
 * a single byte is read.
 */
export function checkFileMetadata(file: {
  name: string;
  size: number;
  type: string;
}): UploadCheck {
  if (file.size === 0) {
    return reject(
      "empty_file",
      "This file is empty - it may not have finished downloading.",
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return reject(
      "file_too_large",
      `This file is ${formatBytes(file.size)}. The limit is ${formatBytes(
        MAX_UPLOAD_BYTES,
      )} - a statement this large is usually a scan, which isn't supported.`,
    );
  }

  const looksLikePdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (!looksLikePdf) {
    return reject(
      "unreadable_file",
      "Only PDF statements are supported. This file isn't a PDF.",
    );
  }

  return OK;
}

/**
 * Checks the file's actual leading bytes.
 *
 * Extensions and MIME types are claims, not facts - a renamed .docx will pass
 * `checkFileMetadata` and then fail deep in the parser with something
 * unhelpful. Reading five bytes here turns that into a clear answer before
 * anything is uploaded.
 */
export function checkPdfSignature(header: Uint8Array): UploadCheck {
  const magic = new TextDecoder().decode(header.subarray(0, PDF_MAGIC.length));

  if (magic !== PDF_MAGIC) {
    return reject(
      "unreadable_file",
      "This file couldn't be opened as a PDF - it may be corrupted, or renamed from another format.",
    );
  }

  return OK;
}
