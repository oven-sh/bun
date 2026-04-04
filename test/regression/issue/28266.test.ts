import { expect, test } from "bun:test";
import { basename, join, normalize } from "path";

// https://github.com/oven-sh/bun/issues/28266
// path.basename (and other path functions) internally converts Latin-1 strings
// to UTF-16, which previously caused header validation to reject them.

test("path.basename result with non-ASCII Latin-1 chars can be used as header value", () => {
  const original = "ý.txt";
  const fromBasename = basename(original);

  expect(original).toBe(fromBasename);

  const res = new Response("hello", {
    headers: {
      "X-Original": original,
      "X-Basename": fromBasename,
    },
  });

  expect(res.headers.get("X-Original")).toBe("ý.txt");
  expect(res.headers.get("X-Basename")).toBe("ý.txt");
});

test("path.join result with non-ASCII Latin-1 chars can be used as header value", () => {
  const result = join("ý.txt");
  const res = new Response("hello", {
    headers: { "X-Test": result },
  });
  expect(res.headers.get("X-Test")).toBe("ý.txt");
});

test("path.normalize result with non-ASCII Latin-1 chars can be used as header value", () => {
  const result = normalize("ý.txt");
  const res = new Response("hello", {
    headers: { "X-Test": result },
  });
  expect(res.headers.get("X-Test")).toBe("ý.txt");
});

test("various Latin-1 extended chars work as header values after path functions", () => {
  // Test multiple Latin-1 extended characters (0x80-0xFF range)
  const chars = ["\x80", "é", "ñ", "ü", "ß", "ø", "å", "ý", "\xFF"];
  for (const ch of chars) {
    const filename = `${ch}.txt`;
    const result = basename(filename);
    const res = new Response("hello", {
      headers: { "X-Test": result },
    });
    expect(res.headers.get("X-Test")).toBe(filename);
  }
});
