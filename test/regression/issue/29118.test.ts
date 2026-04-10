// https://github.com/oven-sh/bun/issues/29118

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const PNG_8x8 = Buffer.from(
  // Minimal 8x8 RGB PNG — smallest valid encoding this test cares about.
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4//8/w38GIAX" +
    "DPw/RgAAAAABJRU5ErkJggg==",
  "base64",
);

// JFIF (JPEG) header — a 2-byte SOI + APP0 segment is all this test needs.
// The bytes aren't a playable JPEG; the renderer only peeks the first 8.
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

test("image without hyperlinks shows URL in dim parens after alt text", () => {
  const out = Bun.markdown.ansi("![an image](https://example.com/img.jpg)\n", {
    colors: true,
    hyperlinks: false,
  });
  // Alt text visible.
  expect(out).toContain("an image");
  // URL must now be shown in the fallback — this is the bug fix.
  expect(out).toContain("https://example.com/img.jpg");
  // No OSC 8 (hyperlinks off).
  expect(out).not.toContain("\x1b]8;;");
});

test("image without hyperlinks uses empty alt falls back to (image) + URL", () => {
  const out = Bun.markdown.ansi("![](https://example.com/pic.gif)\n", {
    colors: true,
    hyperlinks: false,
  });
  expect(out).toContain("(image)");
  expect(out).toContain("https://example.com/pic.gif");
});

test("hyperlinks:true still uses OSC 8 and does NOT emit the URL parens", () => {
  // When the terminal supports OSC 8 we wrap the alt text in the
  // hyperlink escape instead of printing the URL inline — keeps the
  // output compact for users whose terminal honours hyperlinks.
  const out = Bun.markdown.ansi("![alt](https://example.com/img.png)\n", {
    colors: true,
    hyperlinks: true,
  });
  expect(out).toContain("\x1b]8;;https://example.com/img.png\x1b\\");
  // URL should not ALSO appear as plain-text parens after the alt.
  expect(out).not.toContain(" (https://example.com/img.png)");
});

test("data: URI does not get expanded in fallback parens", () => {
  // data:image/jpeg;base64,... payloads are megabytes of base64 and would
  // dominate the output — the fallback path skips them and only shows
  // the alt text.
  const out = Bun.markdown.ansi("![alt](data:image/jpeg;base64,/9j/4AAQSkZJRg==)\n", {
    colors: true,
    hyperlinks: false,
  });
  expect(out).toContain("alt");
  // The data: URI must NOT be emitted as a dim paren suffix.
  expect(out).not.toContain("(data:");
});

test("uppercase DATA: URI is also suppressed in the fallback parens", () => {
  // Case-insensitive per RFC 3986 §3.1. Previously `DATA:` slipped the
  // lowercase-only check and dumped the payload via the URL fallback.
  const out = Bun.markdown.ansi("![alt](DATA:image/jpeg;base64,/9j/4AAQSkZJRg==)\n", {
    colors: true,
    hyperlinks: false,
  });
  expect(out).toContain("alt");
  expect(out).not.toContain("DATA:");
  expect(out).not.toContain("/9j/4AAQSkZJRg==");
});

test("image inside a link keeps the enclosing link URL (no nested parens)", () => {
  // `[![alt](img.jpg)](https://outer.example.com/)` — the outer link's
  // URL is already shown in parens via the link-fallback path. The inner
  // image must NOT also emit its own `(img.jpg)` or we get nested noise.
  const out = Bun.markdown.ansi("[![inner](https://cdn.example.com/img.jpg)](https://outer.example.com/page)\n", {
    colors: true,
    hyperlinks: false,
  });
  expect(out).toContain("inner");
  expect(out).toContain("https://outer.example.com/page");
  // The inner image URL must not appear in a second paren pair.
  expect(out).not.toContain("(https://cdn.example.com/img.jpg)");
});

test("colors:false shows URL in plain parens after [img] marker", () => {
  // When colors are off the marker becomes `[img] ` and the URL still
  // needs to be shown (there's no dim escape, but the text goes through
  // writeStyled with an empty prefix so nothing breaks).
  const out = Bun.markdown.ansi("![alt](https://example.com/img.jpg)\n", {
    colors: false,
    hyperlinks: false,
  });
  expect(out).toContain("[img] alt");
  expect(out).toContain("https://example.com/img.jpg");
  // No ANSI escapes leak through.
  expect(out).not.toContain("\x1b[");
});

test("Kitty APC includes c=<cols> to cap image width at the column budget", async () => {
  // Render a local PNG with kittyGraphics:true + an explicit columns
  // budget — the APC payload must advertise the column cap so big
  // images get scaled down to fit the terminal.
  using dir = tempDir("md-kitty-cols-", {});
  const pngPath = join(String(dir), "pic.png");
  writeFileSync(pngPath, PNG_8x8);

  const out = Bun.markdown.ansi(`![](./pic.png)\n`, {
    colors: true,
    kittyGraphics: true,
    columns: 40,
    // Pre-existing file-lookup arg: tell the renderer where to resolve
    // relative paths. Without this, ./pic.png resolves against the cwd
    // and the file isn't found.
    cwd: String(dir),
  });
  // APC opener must include the column cap.
  expect(out).toContain("\x1b_Ga=T,t=f,f=100,q=2,c=40;");
});

test("Kitty APC omits c= when columns is 0 (wrapping disabled)", async () => {
  using dir = tempDir("md-kitty-nocols-", {});
  const pngPath = join(String(dir), "pic.png");
  writeFileSync(pngPath, PNG_8x8);

  const out = Bun.markdown.ansi(`![](./pic.png)\n`, {
    colors: true,
    kittyGraphics: true,
    columns: 0,
    cwd: String(dir),
  });
  // No `c=` field in the APC header.
  expect(out).toContain("\x1b_Ga=T,t=f,f=100,q=2;");
  expect(out).not.toMatch(/\x1b_Ga=T,t=f,f=100,q=2,c=/);
});

test("Kitty APC for data:image/png payload also carries c=<cols>", () => {
  const dataUrl = "data:image/png;base64," + PNG_8x8.toString("base64");
  const out = Bun.markdown.ansi(`![](${dataUrl})\n`, {
    colors: true,
    kittyGraphics: true,
    columns: 50,
  });
  // t=d direct-transmit path also includes the column cap.
  expect(out).toContain("\x1b_Ga=T,t=d,f=100,q=2,c=50;");
});

test("non-PNG file does NOT get sent to Kitty — falls through to URL label", async () => {
  // A JPEG file on disk — the current code happily base64'd the path
  // and handed it to Kitty under f=100 (PNG), so the terminal showed
  // the broken-image indicator. The fix: verify the PNG signature
  // before calling emitKittyImageFile.
  using dir = tempDir("md-kitty-nonpng-", {});
  const jpegPath = join(String(dir), "photo.jpg");
  writeFileSync(jpegPath, JPEG_HEADER);

  const out = Bun.markdown.ansi("![photo](./photo.jpg)\n", {
    colors: true,
    kittyGraphics: true,
    columns: 80,
    cwd: String(dir),
  });
  // No Kitty APC sequence — the JPEG fell through the PNG check.
  expect(out).not.toContain("\x1b_Ga=T");
  // The fallback path ran: alt text visible.
  expect(out).toContain("photo");
  // And the URL is now shown (hyperlinks default is false in the JS API).
  expect(out).toContain("./photo.jpg");
});

test("PNG file IS sent to Kitty — signature matches", async () => {
  using dir = tempDir("md-kitty-png-", {});
  const pngPath = join(String(dir), "logo.png");
  writeFileSync(pngPath, PNG_8x8);

  const out = Bun.markdown.ansi("![logo](./logo.png)\n", {
    colors: true,
    kittyGraphics: true,
    columns: 80,
    cwd: String(dir),
  });
  // Kitty APC opener present.
  expect(out).toContain("\x1b_Ga=T,t=f,f=100,q=2");
  // Closed with the ST.
  expect(out).toContain("\x1b\\");
});

test("image without a src still works (doesn't crash, doesn't print URL)", () => {
  // Edge case: empty src.
  const out = Bun.markdown.ansi("![alt]()\n", { colors: true, hyperlinks: false });
  expect(out).toContain("alt");
  // No parens suffix — covers both " ()" (dim-space variant) and bare "()"
  // so a regression emitting an empty URL pair in any form fails here.
  expect(out).not.toContain("()");
});

test("inline image after text caps Kitty c= to the remaining line width", async () => {
  // Paragraph like `prefix ![](./img.png)` puts the image mid-line, so the
  // Kitty cap must be (columns - visible prefix width), not (columns -
  // block indent) or the image overflows to the right of the terminal.
  using dir = tempDir("md-kitty-inline-", {});
  writeFileSync(join(String(dir), "pic.png"), PNG_8x8);

  const out = Bun.markdown.ansi("Check out ![](./pic.png) here.\n", {
    colors: true,
    kittyGraphics: true,
    columns: 40,
    cwd: String(dir),
  });
  // "Check out " is 10 visible columns, so the remaining budget is 30.
  expect(out).toContain("\x1b_Ga=T,t=f,f=100,q=2,c=30;");
  // And the original full-width cap MUST NOT appear — it'd overflow.
  expect(out).not.toContain("\x1b_Ga=T,t=f,f=100,q=2,c=40;");
});

test("image inside a table cell doesn't emit the URL-parens fallback", () => {
  // `| ![alt](https://example.com/img.jpg) |` — the URL string must not
  // end up inside the cell buffer or flushTable will count it against the
  // column width and blow the table layout past the terminal width.
  const source = [
    "| Col |",
    "|:---:|",
    "| ![logo](https://cdn.example.com/long-image-url-that-would-wreck-layout.jpg) |",
    "",
  ].join("\n");
  const out = Bun.markdown.ansi(source, {
    colors: true,
    hyperlinks: false,
    columns: 40,
  });
  // The URL must NOT appear anywhere in the cell rendering — the fallback
  // path has to stay inert inside in_cell.
  expect(out).not.toContain("long-image-url-that-would-wreck-layout.jpg");
  // Alt text still visible.
  expect(out).toContain("logo");
  // Every rendered line stays within the column budget.
  const maxLineWidth = Math.max(0, ...out.split("\n").map(l => Bun.stringWidth(l)));
  expect(maxLineWidth).toBeLessThanOrEqual(40);
});

test("image inside a heading doesn't emit the URL-parens fallback", () => {
  // Same layout concern as tables: headings buffer their content and
  // re-measure visible width for the underline row, so the URL string
  // must not get written into heading_buf.
  const out = Bun.markdown.ansi("# Title ![logo](https://cdn.example.com/very-long-url-that-breaks-headings.jpg)\n", {
    colors: true,
    hyperlinks: false,
    columns: 40,
  });
  expect(out).not.toContain("very-long-url-that-breaks-headings.jpg");
  expect(out).toContain("Title");
  expect(out).toContain("logo");
  const maxLineWidth = Math.max(0, ...out.split("\n").map(l => Bun.stringWidth(l)));
  expect(maxLineWidth).toBeLessThanOrEqual(40);
});
