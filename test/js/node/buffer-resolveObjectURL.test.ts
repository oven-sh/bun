import { Blob, resolveObjectURL } from "buffer";
import { expect, test } from "bun:test";
import { URL } from "url";

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/blob.js#L441
// https://nodejs.org/api/buffer.html#bufferresolveobjecturlid
// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/test/parallel/test-blob-createobjecturl.js#L35
test("buffer.resolveObjectURL", async () => {
  const blob = new Blob(["hello"]);
  const id = URL.createObjectURL(blob);
  expect(id).toBeString();
  const otherBlob = resolveObjectURL(id)!;
  expect(otherBlob).toBeInstanceOf(Blob);
  expect(otherBlob.constructor).toStrictEqual(Blob);
  expect(otherBlob.size).toStrictEqual(5);
  expect(await otherBlob.text()).toStrictEqual("hello");
  URL.revokeObjectURL(id);

  // should do nothing
  URL.revokeObjectURL(id);

  expect(resolveObjectURL(id)).toBeUndefined();
});

test("buffer.resolveObjectURL empty blob", async () => {
  const blob = new Blob();
  const id = URL.createObjectURL(blob);
  expect(
    resolveObjectURL(
      id.slice(0, id.length - 1) + String.fromCharCode(id.slice(id.length - 1, id.length).charCodeAt(0) + 1),
    ),
  ).toBeUndefined();
  URL.revokeObjectURL(id);
  expect(await blob.text()).toBe("");
});

test("buffer.resolveObjectURL args", async () => {
  expect(resolveObjectURL()).toBeUndefined();
  expect(resolveObjectURL(1)).toBeUndefined();
  expect(resolveObjectURL("foo")).toBeUndefined();
  const blob = new Blob(["hello"]);
  const id = URL.createObjectURL(blob);
  expect(
    resolveObjectURL(
      id.slice(0, id.length - 1) + String.fromCharCode(id.slice(id.length - 1, id.length).charCodeAt(0) + 1),
    ),
  ).toBeUndefined();
  URL.revokeObjectURL(id);
});

// The blob URL store is keyed by the URL serialized without its fragment
// (https://w3c.github.io/FileAPI/#blob-url-resolve), the same rule fetch(),
// import() and new Worker() resolve by. Node keys by pathname instead, so it
// also ignores a ?query. Bun treats a query as a different URL, like browsers.
test("buffer.resolveObjectURL ignores the URL fragment", async () => {
  const blob = new Blob(["hello"]);
  const id = URL.createObjectURL(blob);
  const uuid = id.slice("blob:".length);

  for (const url of [id + "#frag", id + "#", id + "#frag?not-a-query", id + "#frag\n"]) {
    const resolved = resolveObjectURL(url);
    expect(resolved, JSON.stringify(url)).toBeInstanceOf(Blob);
    expect(await resolved!.text(), JSON.stringify(url)).toBe("hello");
  }

  // A different scheme, path or query is a different URL.
  for (const url of [uuid, "file:" + uuid, id + "/", id + "?query", id + "?query#frag", id + "?"]) {
    expect(resolveObjectURL(url), JSON.stringify(url)).toBeUndefined();
  }

  URL.revokeObjectURL(id);
  expect(resolveObjectURL(id + "#frag")).toBeUndefined();
});

// WPT FileAPI/url: "Only exact matches should revoke URLs".
test("URL.revokeObjectURL only revokes an exact match", async () => {
  const blob = new Blob(["hello"]);
  const id = URL.createObjectURL(blob);

  for (const url of [id + "#frag", id + "#", id + "?query", id + "/"]) {
    URL.revokeObjectURL(url);
    expect(await resolveObjectURL(id)?.text(), `revokeObjectURL(${JSON.stringify(url)})`).toBe("hello");
  }

  URL.revokeObjectURL(id);
  expect(resolveObjectURL(id)).toBeUndefined();
});
