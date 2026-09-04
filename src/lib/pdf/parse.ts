/**
 * Reading a PDF's text layer, with positions.
 *
 * Two things matter here, and they pull in different directions.
 *
 * The model needs text it can read as a table — rows in order, columns lined
 * up, empty cells still visibly empty. Debit and credit are told apart by
 * *where* a number sits, so a representation that loses horizontal position
 * loses the distinction between money in and money out.
 *
 * Provenance needs the opposite: the exact coordinates of every fragment, so
 * a row the model returns can be matched back to the region of the page it
 * came from. A model handed plain text cannot know where anything was; any
 * coordinates it offered would be invented. So they are computed here.
 *
 * Both are produced from one pass: `items` keeps the raw positioned
 * fragments, `layout` renders them as a fixed-width table for the prompt.
 */

export interface TextItem {
  text: string;
  /** Points from the left edge of the page. */
  x: number;
  /** Points from the *top* of the page. PDF's own origin is bottom-left;
   *  converting once here means nothing downstream has to remember that. */
  y: number;
  width: number;
  height: number;
}

export interface TextLine {
  /** Distance from the top of the page, in points. */
  y: number;
  items: TextItem[];
  /** The line rendered with spacing proportional to horizontal position, so
   *  columns line up the way they do on the page. */
  layout: string;
}

export interface ParsedPage {
  pageNumber: number;
  width: number;
  height: number;
  lines: TextLine[];
}

export type ParseFailureCode =
  | "unreadable_file"
  | "password_required"
  | "incorrect_password"
  | "no_text_layer";

export type ParseResult =
  | { ok: true; pageCount: number; pages: ParsedPage[] }
  | { ok: false; code: ParseFailureCode; message: string };

/**
 * Fragments whose vertical positions differ by less than this are treated as
 * the same visual row. Generous enough to survive the sub-point jitter of
 * text placement, tight enough not to merge adjacent table rows.
 */
const LINE_TOLERANCE_PT = 2.5;

/**
 * Width of one character column when rendering a line as fixed-width text.
 * Roughly the advance width of a digit at the sizes statements use. Smaller
 * values preserve more positional detail at the cost of longer lines.
 */
const CHAR_WIDTH_PT = 4.2;

/**
 * Below this many characters across the whole document, there is effectively
 * no text layer. Not zero: a scan often carries a stray character or two from
 * a header stamp, and refusing only on exactly zero would let those through.
 */
const MIN_TEXT_CHARS = 40;

function fail(code: ParseFailureCode, message: string): ParseResult {
  return { ok: false, code, message };
}

function groupIntoLines(items: TextItem[]): TextLine[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];

  for (const item of sorted) {
    const current = lines[lines.length - 1];

    if (current && Math.abs(current.y - item.y) <= LINE_TOLERANCE_PT) {
      current.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item], layout: "" });
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.layout = renderLayout(line.items);
  }

  return lines;
}

/**
 * Renders a line as fixed-width text, each fragment starting at the column
 * its x position implies.
 *
 * This is what makes an empty cell visible. A statement row with nothing in
 * the debit column produces no fragment there at all — joining fragments with
 * single spaces would silently close the gap and make a credit look like a
 * debit. Padding to position keeps the hole where it is.
 */
function renderLayout(items: TextItem[]): string {
  let out = "";

  for (const item of items) {
    const column = Math.round(item.x / CHAR_WIDTH_PT);
    if (column > out.length) {
      out += " ".repeat(column - out.length);
    } else if (out.length > 0) {
      // The fragment's true column is already occupied — right-aligned
      // numbers in adjacent columns can overlap by a character or two. Two
      // spaces rather than one so the boundary stays visible.
      out += "  ";
    }
    out += item.text;
  }

  return out.trimEnd();
}

export async function parsePdf(
  data: Uint8Array,
  options: { password?: string } = {},
): Promise<ParseResult> {
  // Imported lazily and from the legacy build: the default build assumes
  // browser globals that don't exist in a route handler.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let doc;
  const task = pdfjs.getDocument({
    data,
    password: options.password,
    // This runs on the server against files strangers uploaded. Neither of
    // these is needed to read a text layer, and both widen the attack surface.
    isEvalSupported: false,
    useSystemFonts: false,
  });

  try {
    doc = await task.promise;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const code = (error as { code?: number })?.code;

    if (name === "PasswordException") {
      // pdfjs distinguishes "needs one" (1) from "that one was wrong" (2),
      // and so should the message the user reads.
      return code === 2
        ? fail("incorrect_password", "Incorrect password — check it and try again.")
        : fail(
            "password_required",
            "This PDF is password-protected. Enter its password to continue.",
          );
    }

    return fail(
      "unreadable_file",
      "This file couldn't be opened — it may be corrupted or not a valid PDF.",
    );
  }

  const pages: ParsedPage[] = [];
  let totalChars = 0;

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const items: TextItem[] = [];

      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        const text = raw.str;
        if (text.trim() === "") continue;

        // transform is [a, b, c, d, e, f]; e and f are the x and y of the
        // text's baseline, measured from the bottom-left of the page.
        const x = raw.transform[4];
        const baselineFromBottom = raw.transform[5];

        items.push({
          text,
          x,
          y: viewport.height - baselineFromBottom - raw.height,
          width: raw.width,
          height: raw.height,
        });

        totalChars += text.trim().length;
      }

      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        lines: groupIntoLines(items),
      });
    }
  } catch {
    return fail(
      "unreadable_file",
      "This file couldn't be read past the first few pages — it may be damaged.",
    );
  } finally {
    await task.destroy();
  }

  if (totalChars < MIN_TEXT_CHARS) {
    return fail(
      "no_text_layer",
      "This looks like a scanned image with no readable text — extraction isn't supported for scanned documents.",
    );
  }

  return { ok: true, pageCount: doc.numPages, pages };
}

/** The whole document as fixed-width text, one page after another. */
export function pagesAsText(pages: ParsedPage[]): string {
  return pages
    .map(
      (page) =>
        `--- page ${page.pageNumber} ---\n` +
        page.lines.map((line) => line.layout).join("\n"),
    )
    .join("\n\n");
}
