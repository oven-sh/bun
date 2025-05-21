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
