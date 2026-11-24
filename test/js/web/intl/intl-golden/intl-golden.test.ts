// Expressions that use src/icu, with what they evaluate to. See record.ts. The results are those of ICU4C 79.1. A case is
// here because it tells src/icu from a version with one small mistake, takes a branch that no other takes, or reads an
// item of the data that no other reads.
import { expect, test } from "bun:test";
import { isCI, isMacOS } from "harness";
import { differencesFrom, hasVersion, inParts, loadCases, version } from "./observe";

const cases = await loadCases();

// A build with a local WebKit can have the ICU of the system.
test.skipIf(isMacOS || !isCI)("the cases were recorded with this version", () => {
  expect(process.versions.icu).toBe(version);
});

// The other files of this directory have the others.
test.skipIf(!hasVersion).each(inParts(cases, "locale"))("%s", (_, some) => {
  expect(differencesFrom(some)).toBe("");
});
