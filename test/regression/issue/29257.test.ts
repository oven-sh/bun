import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/29257
//
// Bun was rewriting `text/plain` (and `text/css`, `text/html`,
// `application/json`, ...) to their charset-appended canonical forms
// (`text/plain;charset=utf-8`, etc.) when the user set the `type` on a
// Blob/File at construction time.
//
// Per the WHATWG File API (https://w3c.github.io/FileAPI/#blob), user
// agents must NOT append a charset parameter to the media type.

test("new File(..., { type: 'text/plain' }).type is preserved verbatim", () => {
  const file = new File([], "empty.txt", { type: "text/plain" });
  expect(file.type).toBe("text/plain");
});

test("new Blob([], { type: 'text/plain' }).type is preserved verbatim", () => {
  const blob = new Blob([], { type: "text/plain" });
  expect(blob.type).toBe("text/plain");
});

test("File/Blob type is preserved for other types Bun used to canonicalize", () => {
  // These are the types Compact.toMimeType() substitutes into
  // charset-appended forms for HTTP responses.
  const types = [
    "text/plain",
    "text/css",
    "text/html",
    "text/javascript",
    "application/json",
    "application/javascript",
  ];
  for (const type of types) {
    expect(new File([], "x", { type }).type).toBe(type);
    expect(new Blob([], { type }).type).toBe(type);
  }
});

test("File/Blob type with explicit charset is preserved verbatim", () => {
  const file = new File([], "x.txt", { type: "text/plain;charset=utf-8" });
  expect(file.type).toBe("text/plain;charset=utf-8");

  const blob = new Blob([], { type: "text/plain;charset=utf-8" });
  expect(blob.type).toBe("text/plain;charset=utf-8");
});

test("File/Blob type is lowercased (per WHATWG spec)", () => {
  expect(new File([], "x", { type: "TEXT/PLAIN" }).type).toBe("text/plain");
  expect(new Blob([], { type: "Text/Plain" }).type).toBe("text/plain");
});

test("uncommon MIME types still round-trip unchanged", () => {
  // Types not in the interning table take the copyLowercase path.
  const file = new File([], "x", { type: "application/x-custom-type" });
  expect(file.type).toBe("application/x-custom-type");
  const blob = new Blob([], { type: "application/x-custom-type" });
  expect(blob.type).toBe("application/x-custom-type");
});

test("Bun.file(path, { type: 'text/plain' }).type is preserved verbatim", () => {
  // Covers the `constructBunFile` path in Blob.zig.
  const file = Bun.file(import.meta.path, { type: "text/plain" });
  expect(file.type).toBe("text/plain");
});

test("Blob.prototype.slice(start, end, type) preserves the type verbatim", () => {
  // Covers the `getSlice` / `getSliceFrom` path in Blob.zig.
  const parent = new Blob(["hello world"]);
  const slice = parent.slice(0, 5, "text/plain");
  expect(slice.type).toBe("text/plain");
});

test("Bun.s3.file(path, { type: 'text/plain' }).type is preserved verbatim", () => {
  // Covers the S3File constructor paths in S3File.zig. The object is never
  // actually touched over the network.
  const file = Bun.s3.file("test.txt", { type: "text/plain" });
  expect(file.type).toBe("text/plain");
});
