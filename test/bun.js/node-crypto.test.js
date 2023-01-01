import { it, expect } from "bun:test";

const nodeCrypto = require("node:crypto");

it("crypto.randomBytes should return a Buffer", () => {
  expect(nodeCrypto.randomBytes(1) instanceof Buffer).toBe(true);
  expect(Buffer.isBuffer(nodeCrypto.randomBytes(1))).toBe(true);
});
