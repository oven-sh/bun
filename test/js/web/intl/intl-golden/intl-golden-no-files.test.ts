// See intl-golden.test.ts. With ICU_DATA, src/icu takes none of its shortcuts for the data that are linked in.
import { describe, expect, test } from "bun:test";
import { differencesFrom, fewerIfDebug, hasVersion, inParts, loadCases, observeIn } from "./observe";

describe.skipIf(!hasVersion).concurrent("with a directory that does not exist", async () => {
  test.each(inParts(await loadCases(), "", 400))("%s", async (_, all) => {
    const some = fewerIfDebug(all);
    const sources = some.map(([source]) => source);
    expect(differencesFrom(some, await observeIn("ICU_DATA=nowhere", sources))).toBe("");
  });
});
