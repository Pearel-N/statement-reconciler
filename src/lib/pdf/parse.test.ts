import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pagesAsText, parsePdf } from "./parse";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`fixtures/${name}`));

describe("parsePdf", () => {
  it("reads a statement's pages and lines", async () => {
    const result = await parsePdf(fixture("clean.pdf"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pageCount).toBe(3);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0].lines.length).toBeGreaterThan(10);
  });

  it("records positions measured from the top of the page", async () => {
    const result = await parsePdf(fixture("clean.pdf"));
    if (!result.ok) throw new Error("expected a parse");

    const page = result.pages[0];
    const [firstLine] = page.lines;

    // PDF's own origin is bottom-left. Converting once at the boundary means
    // nothing downstream has to remember which way up the page is — so the
    // first line of a page must be near the top, not near the bottom.
    expect(firstLine.y).toBeLessThan(page.height / 2);
    expect(firstLine.items[0].x).toBeGreaterThanOrEqual(0);
  });

  it("puts debits and credits in different columns", async () => {
    const result = await parsePdf(fixture("clean.pdf"));
    if (!result.ok) throw new Error("expected a parse");

    const lines = pagesAsText(result.pages).split("\n");

    // A salary credit and a loan-EMI debit, from the same statement.
    const credit = lines.find((line) => line.includes("96,400.00"));
    const debit = lines.find((line) => line.includes("18,740.00"));

    expect(credit).toBeDefined();
    expect(debit).toBeDefined();

    // This is the whole reason the layout is padded rather than joined. A
    // credit row has nothing at all in the debit column — no fragment, not
    // even an empty string. Joining with single spaces would close the gap
    // and a credit would read as a debit, which is the field reconciliation
    // depends on. The credit must therefore sit further right.
    expect(credit!.indexOf("96,400.00")).toBeGreaterThan(
      debit!.indexOf("18,740.00"),
    );
  });

  it("starts every dated row in the same column", async () => {
    const result = await parsePdf(fixture("clean.pdf"));
    if (!result.ok) throw new Error("expected a parse");

    const dated = result.pages[0].lines
      .map((line) => line.layout)
      .filter((line) => /^\s*\d{2}\/\d{2}\/2026/.test(line));

    expect(dated.length).toBeGreaterThan(5);

    const starts = dated.map((line) => line.search(/\S/));
    // Rounding to character columns can shift a fragment by one; anything
    // more than that means the alignment the model relies on has been lost.
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThanOrEqual(1);
  });

  it("refuses a scan by name rather than guessing at it", async () => {
    const result = await parsePdf(fixture("scanned-no-text-layer.pdf"));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("no_text_layer");
    expect(result.message).toMatch(/scanned/i);
  });

  it("refuses a file that isn't a PDF at all", async () => {
    const result = await parsePdf(new TextEncoder().encode("not a pdf"));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("unreadable_file");
  });
});
