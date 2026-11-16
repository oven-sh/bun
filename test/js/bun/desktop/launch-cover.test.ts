import { hasLibrary } from "./library";

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";

test.skipIf(!hasLibrary || isWindows)(
  "launch cover",
  async () => {
    using dir = tempDir("launch-cover", { "package.json": JSON.stringify({ name: "covered" }) });
    const home = String(dir);
    const env = { ...bunEnv, HOME: home, XDG_CONFIG_HOME: join(home, "config"), BUN_DESKTOP_HEADLESS: "1" };
    const run = async (cmd: string[], STEP = "") => {
      await using proc = Bun.spawn({ cmd, cwd: home, env: { ...env, STEP }, stderr: "inherit" });
      return (await proc.stdout.text()).trim();
    };
    await Bun.write(join(home, "app.ts"), Bun.file(join(import.meta.dir, "launch-cover.fixture.ts")));
    await run([bunExe(), "build", "--compile", "--desktop", "app.ts", "--outfile=covered"]);
    const executable = join(home, isMacOS ? "covered.app/Contents/MacOS/covered" : "covered.AppDir/AppRun");
    const seen: string[] = [];
    const launch = async (step: string, ...args: string[]) =>
      seen.push(`${[step, ...args].join(" ")}: ${await run([executable, ...args], step)}`);

    await launch("save");
    const data = join(home, isMacOS ? "Library/Application Support" : "config", "covered");
    expect(["LaunchCover", "LaunchCover.json"].map(name => statSync(join(data, name)).mode & 0o777)).toEqual([
      0o600, 0o600,
    ]);
    for (const step of ["type", "early", "discarded", "keep", "unfocused", "click", "changed", "wider"])
      await launch(step);
    await launch("type", "--hidden");
    for (const step of ["crash", "type", "save", "part", "changed", "clear", "type", "uncovered"]) await launch(step);
    expect(seen).toEqual([
      "save: false [] [] true",
      "type: true [] waits [b]",
      "early: true [] waits [s]",
      "discarded: false [] []",
      "keep: true [] waits [bc] true click [bc]",
      "unfocused: true [] waits []",
      "click: true [] waits click []",
      "changed: true [] []",
      "wider: false [] []",
      "type --hidden: false [b] [b]",
      "crash: ",
      "type: false [b] [b]",
      "save: false [] [] true",
      "part: true [] [] true",
      "changed: true [] waits click []",
      "clear: true [] []",
      "type: false [b] [b]",
      "uncovered: false b c [bc] [bc]",
    ]);
  },
  isDebug || isASAN ? 240_000 : 60_000,
);
