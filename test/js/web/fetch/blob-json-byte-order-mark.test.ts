import { expect, test } from "bun:test";

test("a Blob that begins with a byte order mark keeps it as a part of another Blob after json()", async () => {
  const marked = new Blob([new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])]);
  expect(await marked.json()).toEqual({});
  const text = await new Blob(["x", marked]).text();
  expect([text.length, text.charCodeAt(1).toString(16)]).toEqual([4, "feff"]);
});

test("the same without json()", async () => {
  const marked = new Blob([new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])]);
  const text = await new Blob(["x", marked]).text();
  expect([text.length, text.charCodeAt(1).toString(16)]).toEqual([4, "feff"]);
});
