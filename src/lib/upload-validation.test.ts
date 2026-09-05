import { describe, expect, it } from "vitest";

import {
  MAX_UPLOAD_BYTES,
  checkFileMetadata,
  checkPdfSignature,
  formatBytes,
} from "./upload-validation";

const pdf = (name = "statement.pdf", size = 200_000, type = "application/pdf") => ({
  name,
  size,
  type,
});

describe("checkFileMetadata", () => {
  it("accepts an ordinary PDF", () => {
    expect(checkFileMetadata(pdf()).ok).toBe(true);
  });

  it("names an empty file rather than calling it invalid", () => {
    const result = checkFileMetadata(pdf("statement.pdf", 0));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("empty_file");
  });

  it("says how big the file is and what the limit is", () => {
    const result = checkFileMetadata(pdf("huge.pdf", MAX_UPLOAD_BYTES + 1));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("file_too_large");
    // A limit message a user can act on has to contain both numbers.
    expect(result.rejection.message).toContain(formatBytes(MAX_UPLOAD_BYTES));
  });

  it("accepts a PDF whose type the browser failed to guess", () => {
    expect(checkFileMetadata(pdf("statement.PDF", 1000, "")).ok).toBe(true);
  });

  it("rejects a document that isn't a PDF", () => {
    const result = checkFileMetadata(pdf("statement.docx", 1000, "application/msword"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("unreadable_file");
  });
});

describe("checkPdfSignature", () => {
  it("accepts a real PDF header", () => {
    expect(checkPdfSignature(new TextEncoder().encode("%PDF-1.7")).ok).toBe(true);
  });

  it("catches a file renamed to .pdf", () => {
    // A PNG's first bytes. The extension said PDF; the file disagrees.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
    const result = checkPdfSignature(png);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.message).toMatch(/renamed|corrupted/i);
  });
});

describe("formatBytes", () => {
  it("scales its unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(15_000_000)).toBe("14.3 MB");
  });
});
