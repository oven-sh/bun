// See intl-golden.test.ts. These cases depend on the locale and the time zone of the process.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { differencesFrom, fewerIfDebug, hasVersion, loadCases, localeFiles, observeIn } from "./observe";

const canSetLocale = isGlibc && existsSync(localeFiles);
const canSet = (variable: string) =>
  variable.startsWith("SETLOCALE=") ? canSetLocale : !isWindows || !/^(LANG|LC_\w+|TZ)=/.test(variable);

const all = Object.entries((await loadCases()).environments);
const setsLocale = ([environment]: (typeof all)[number]) => environment.includes("SETLOCALE=");
const environments = [...all.filter(it => !setsLocale(it)), ...fewerIfDebug(all.filter(setsLocale))];

describe.skipIf(!hasVersion).concurrent("in the environment", () => {
  for (const [environment, some] of environments) {
    test.skipIf(!environment.split(" ").every(canSet))(environment, async () => {
      const sources = some.map(([source]) => source);
      expect(differencesFrom(some, await observeIn(environment, sources))).toBe("");
    });
  }

  test("ICU_DATA has no effect", async () => {
    using dir = tempDir("intl-golden", {
      "icudt79l/zoneinfo64.res": readFileSync(join(import.meta.dir, "zone-files", "zoneinfo64.res")),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-p", `Intl.supportedValuesOf("timeZone").join()`],
      env: { ...bunEnv, ICU_DATA: String(dir) },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(Intl.supportedValuesOf("timeZone").join());
    expect(exitCode).toBe(0);
  });
});
