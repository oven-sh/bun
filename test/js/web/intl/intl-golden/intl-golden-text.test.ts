// See intl-golden.test.ts.
import { expect, test } from "bun:test";
import { differencesFrom, hasVersion, inParts, loadCases } from "./observe";

test.skipIf(!hasVersion).each(inParts(await loadCases(), "text"))("%s", (_, some) => {
  expect(differencesFrom(some)).toBe("");
});
