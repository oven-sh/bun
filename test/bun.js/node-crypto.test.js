import { it, expect } from "bun:test";

import crypto from "node:crypto";

it("crypto.randomBytes should return a Buffer", () => {
  expect(crypto.randomBytes(1) instanceof Buffer).toBe(true);
  expect(Buffer.isBuffer(crypto.randomBytes(1))).toBe(true);
});

// https://github.com/oven-sh/bun/issues/1839
it("crypto.createHash ", () => {
  function fn() {
    crypto.createHash("sha1").update(Math.random(), "ascii").digest("base64");
  }

  for (let i = 0; i < 10; i++) fn();
});
