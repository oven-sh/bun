import { describe, expect, it } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

describe("importValue", () => {
  // https://tc39.es/proposal-shadowrealm/#sec-export-getter-functions checks HasOwnProperty(exports, name), then reads
  // the value. An export whose value is undefined exists.
  it("resolves an export whose value is undefined", async () => {
    using dir = tempDir("shadow-realm-import-value", {
      "mod.mjs": `
        export const undefinedValue = undefined;
        export let notYet;
        export function setNotYet(v) { notYet = v; }
        export const nullValue = null;
      `,
    });
    const mod = join(String(dir), "mod.mjs");
    const realm = new ShadowRealm();
    expect(await realm.importValue(mod, "undefinedValue")).toBe(undefined);
    expect(await realm.importValue(mod, "nullValue")).toBe(null);
    // A live binding that is still undefined reads its current value each time.
    expect(await realm.importValue(mod, "notYet")).toBe(undefined);
    (await realm.importValue(mod, "setNotYet"))("now");
    expect(await realm.importValue(mod, "notYet")).toBe("now");
    // A name that is not exported still rejects. That includes names an ordinary object would inherit, and __esModule,
    // which Bun's module namespace objects inherit from their prototype: the check is HasOwnProperty.
    for (const name of ["missing", "toString", "__proto__", "constructor", "then", "__esModule"]) {
      let error;
      try {
        await realm.importValue(mod, name);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe("%ShadowRealm%.importValue requires |exportName| to exist in the |specifier|");
    }
  });
});
