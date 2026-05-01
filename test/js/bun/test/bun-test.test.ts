import { expect, test } from "bun:test";

test("Bun.version", () => {
  expect(process.versions.bun).toBe(Bun.version);
  expect(process.revision).toBe(Bun.revision);
});

test("expect().not.not", () => {
  // bun supports this but jest doesn't
  expect(1).not.not.toBe(1);
  expect(1).not.not.not.toBe(2);
});
