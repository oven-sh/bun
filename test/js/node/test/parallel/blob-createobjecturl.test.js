//#FILE: test-blob-createobjecturl.js
//#SHA1: d2030ca0ad6757dd9d338bc2e65cd3ff8917009d
//-----------------
// Flags: --no-warnings
"use strict";

// Because registering a Blob URL requires generating a random
// UUID, it can only be done if crypto support is enabled.
if (typeof crypto === "undefined") {
  test.skip("missing crypto");
}

const { URL } = require("url");
const { Blob, resolveObjectURL } = require("buffer");

test("Blob URL creation and resolution", async () => {
  const blob = new Blob(["hello"]);
  const id = URL.createObjectURL(blob);
  expect(typeof id).toBe("string");
  const otherBlob = resolveObjectURL(id);
  expect(otherBlob).toBeInstanceOf(Blob);
  expect(otherBlob.constructor).toBe(Blob);
  expect(otherBlob.size).toBe(5);
  expect(Buffer.from(await otherBlob.arrayBuffer()).toString()).toBe("hello");
  URL.revokeObjectURL(id);

  // should do nothing
  URL.revokeObjectURL(id);

  expect(resolveObjectURL(id)).toBeUndefined();

  // Leaving a Blob registered should not cause an assert
  // when Node.js exists
  URL.createObjectURL(new Blob());
});

test("resolveObjectURL with invalid inputs", () => {
  ["not a url", undefined, 1, "blob:nodedata:1:wrong", {}].forEach(i => {
    expect(resolveObjectURL(i)).toBeUndefined();
  });
});

test("createObjectURL with invalid inputs", () => {
  [undefined, 1, "", false, {}].forEach(i => {
    expect(() => URL.createObjectURL(i)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-blob-createobjecturl.js
