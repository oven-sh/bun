import { expect, it } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

async function rejection(promise) {
  return promise.then(
    value => {
      throw new Error(`expected a rejection, got ${String(value)}`);
    },
    error => error,
  );
}

it("importValue rejects with a TypeError of the caller's realm when the module throws", async () => {
  using dir = tempDir("shadow-realm-import-value", {
    // The thrown value has no message, and converting it to one runs realm code
    // that throws the realm's globalThis.
    "throws-unconvertible.mjs": `
      globalThis.ran = false;
      throw { toString() { globalThis.ran = true; throw globalThis; } };
      export const value = 1;
    `,
    "throws-error.mjs": `throw new Error("boom");\nexport const value = 1;`,
  });
  const red = new ShadowRealm();

  const error = await rejection(red.importValue(path.join(String(dir), "throws-unconvertible.mjs"), "value"));
  expect(error).toBeInstanceOf(TypeError);
  // A leak of the realm's globalThis would answer with the realm's Array.
  expect(error.Array).toBeUndefined();
  expect(error.message).toBe("Error encountered during evaluation");
  expect(red.evaluate(`globalThis.ran`)).toBe(false);

  const errorWithMessage = await rejection(red.importValue(path.join(String(dir), "throws-error.mjs"), "value"));
  expect(errorWithMessage).toBeInstanceOf(TypeError);
  expect(errorWithMessage.message).toBe("boom");
});
