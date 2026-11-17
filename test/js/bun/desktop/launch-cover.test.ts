import { hasLibrary } from "./library";

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { hasScreen, openScreen } from "./screen";

const hasKeyring = isLinux && ["dbus-run-session", "gnome-keyring-daemon"].every(it => Bun.which(it));
test.skipIf(!hasLibrary || !hasKeyring)(
  "safeStorage makes its key in an empty keyring, and finds it again",
  async () => {
    using dir = tempDir("first-launch", {
      "package.json": JSON.stringify({ name: "fresh" }),
      "app.ts": `import { app, safeStorage } from "bun:desktop";
      await app.whenReady();
      const file = Bun.file("encrypted");
      if (await file.exists()) console.log((await safeStorage.decryptStringAsync(await file.bytes())).result);
      else await file.write(await safeStorage.encryptStringAsync("kept"));
      app.quit();`,
    });
    const home = String(dir);
    const script = `printf test | gnome-keyring-daemon --unlock --components=secrets >/dev/null; "$0" app.ts && "$0" app.ts`;
    await using proc = Bun.spawn({
      cmd: ["dbus-run-session", "--", "sh", "-c", script, bunExe()],
      cwd: home,
      env: {
        ...bunEnv,
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_RUNTIME_DIR: home,
        BUN_DESKTOP_HEADLESS: "1",
      },
      stderr: "inherit",
    });
    expect(await proc.stdout.text()).toBe("kept\n");
    expect(await proc.exited).toBe(0);
  },
);

test.skipIf(!hasLibrary || isWindows).each(hasScreen ? ["memory", "a screen"] : ["memory"])(
  "launch cover, painted to %s",
  async where => {
    await using screen = where === "a screen" ? await openScreen() : null;
    using dir = tempDir("launch-cover", { "package.json": JSON.stringify({ name: "covered" }) });
    const home = String(dir);
    const env = {
      ...bunEnv,
      HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      BUN_DESKTOP_HEADLESS: "1",
      ...screen?.env,
    };
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
    for (const step of ["type", "second", "early", "discarded", "keep", "unfocused", "click", "changed", "wider"])
      await launch(step);
    await launch("type", "--hidden");
    for (const step of ["crash", "type", "save", "part", "changed", "clear", "type", "uncovered"]) await launch(step);
    expect(seen).toEqual([
      "save: false [] [] true",
      "type: true [] waits [b]",
      "second: true [] [] 1 2 false 1",
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
