// See intl-golden.test.ts. These cases replace or add data with ICU_DATA.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canObserveIn, differencesFrom, fewerIfDebug, hasVersion, loadCases, observeIn } from "./observe";

const environments = Object.entries((await loadCases()).environments).filter(([it]) => it.startsWith("FILES="));

describe.skipIf(!hasVersion).concurrent("with files", () => {
  for (const [environment, some] of fewerIfDebug(environments)) {
    test.skipIf(!canObserveIn(environment))(environment, async () => {
      const sources = some.map(([source]) => source);
      expect(differencesFrom(some, await observeIn(environment, sources))).toBe("");
    });
  }

  test.each(["ICU_DATA", "ICU_TIMEZONE_FILES_DIR"])("%s: a file that has no data is passed over", async variable => {
    using dir = tempDir("intl-golden", { "icudt79l/de.res": "nothing", "icudt79l/zoneinfo64.res": "nothing" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-p", `new Date(0).toLocaleString("de", { timeZone: "America/Lima", dateStyle: "long" })`],
      env: { ...bunEnv, [variable]: variable === "ICU_DATA" ? String(dir) : join(String(dir), "icudt79l") },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("31. Dezember 1969");
    expect(exitCode).toBe(0);
  });
});
