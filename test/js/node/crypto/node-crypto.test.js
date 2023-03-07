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

it("crypto.createHmac", () => {
  const result = crypto.createHmac("sha256", "key").update("message").digest("base64");

  expect(result).toBe("bp7ym3X//Ft6uuUn1Y/a2y/kLnIZARl2kXNDBl9Y7Uo=");
});

it("web crypto", async () => {
  let bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  await crypto.subtle.digest("SHA-256", bytes);
});
