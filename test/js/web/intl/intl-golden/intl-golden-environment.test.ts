// See intl-golden.test.ts. These cases depend on the locale and the time zone of the process.
import { describe, expect, test } from "bun:test";
import { canObserveIn, differencesFrom, fewerIfDebug, hasVersion, loadCases, observeIn } from "./observe";

const all = Object.entries((await loadCases()).environments).filter(([it]) => !it.startsWith("FILES="));
const setsLocale = ([environment]: (typeof all)[number]) => environment.includes("SETLOCALE=");
const environments = [...all.filter(it => !setsLocale(it)), ...fewerIfDebug(all.filter(setsLocale))];

describe.skipIf(!hasVersion).concurrent("in the environment", () => {
  for (const [environment, some] of environments) {
    test.skipIf(!canObserveIn(environment))(environment, async () => {
      const sources = some.map(([source]) => source);
      expect(differencesFrom(some, await observeIn(environment, sources))).toBe("");
    });
  }
});
