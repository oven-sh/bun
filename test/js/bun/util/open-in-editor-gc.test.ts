import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, mergeWindowEnvs, tempDir } from "harness";
import { chmodSync, existsSync, symlinkSync } from "node:fs";
import { delimiter, join } from "node:path";

// Both ways of naming an editor (EDITOR in the environment, the `editor`
// option) end in a PATH lookup of the editor's binary name. The fake editors
// inherit the child's stdout, so what they print is what Bun spawned; the
// child stays alive until the test closes its stdin, after both have run.
// Linux-only so PATH is the only place an editor can come from.
test.skipIf(!isLinux)("Bun.openInEditor finds the editor's binary on PATH", async () => {
  const fakeEditor = (name: string) => `#!/bin/sh\necho "${name} $*"\n`;
  using dir = tempDir("open-in-editor-path", {
    "bin/code": fakeEditor("code"),
    "bin/subl": fakeEditor("subl"),
    "run.js": `
      Bun.openInEditor("src/app.ts", { line: 3, column: 7 });
      Bun.openInEditor("src/app.ts", { editor: "subl" });
      await Bun.stdin.text();
    `,
  });
  chmodSync(join(String(dir), "bin/code"), 0o755);
  chmodSync(join(String(dir), "bin/subl"), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env: { ...bunEnv, PATH: join(String(dir), "bin"), EDITOR: "code" },
    cwd: String(dir),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = proc.stderr.text();
  const decoder = new TextDecoder();
  let stdout = "";
  let released = false;
  for await (const chunk of proc.stdout) {
    stdout += decoder.decode(chunk, { stream: true });
    if (!released && stdout.split("\n").length > 2) {
      released = true;
      proc.stdin.end();
    }
  }

  // The two editors run on separate detached threads, so either may print first.
  expect(stdout.trim().split("\n").sort()).toEqual(["code --goto src/app.ts:3:7", "subl src/app.ts"]);
  expect(await stderr).toBe("");
  expect(await proc.exited).toBe(0);
});

// Option getters and toString run user JS that may call Bun.openInEditor
// again. The editor slot used to stay mutably borrowed across those
// callbacks, so re-entry aborted with "panic: RefCell already borrowed".
// Linux-only so editor detection stays inert: with an empty PATH and no
// EDITOR/VISUAL nothing is found (macOS would probe /Applications).
test.skipIf(!isLinux)("Bun.openInEditor survives re-entrant calls from option getters", async () => {
  using dir = tempDir("open-in-editor-reentrant", {
    "empty-path/.keep": "",
    "run.js": `
      const reenter = () => {
        try { Bun.openInEditor("/nonexistent/f.txt", { editor: "zzz_no_editor" }); } catch {}
      };
      const variants = [
        { get editor() { reenter(); return "zzz_no_editor"; } },
        { editor: { toString() { reenter(); return "zzz_no_editor"; } } },
        { line: { toString() { reenter(); return "1"; } } },
        { get column() { reenter(); return "2"; } },
      ];
      for (const opts of variants) {
        try { Bun.openInEditor("/nonexistent/f.txt", opts); console.log("opened"); } catch (e) { console.log(e.message); }
      }
    `,
  });

  const env: Record<string, string | undefined> = {
    ...bunEnv,
    PATH: join(String(dir), "empty-path"),
  };
  delete env.EDITOR;
  delete env.VISUAL;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // Nothing is found, so every call must throw rather than spawn anything.
  expect(stdout.trim().split("\n")).toEqual([
    'Could not find editor "zzz_no_editor"',
    'Could not find editor "zzz_no_editor"',
    "Failed to auto-detect editor",
    "Failed to auto-detect editor",
  ]);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// On Linux, JSC uses SIGPWR to suspend/resume threads for GC and the libpas
// scavenger. Bun.openInEditor spawns a detached thread that goes through
// bun.spawnSync, whose signal-forwarding setup must not touch SIGPWR or the
// process is terminated the next time GC/scavenger fires.
test.skipIf(!isLinux)("Bun.openInEditor does not break GC signal handling", async () => {
  const sleep = ["/usr/bin/sleep", "/bin/sleep"].find(p => existsSync(p));
  expect(sleep).toBeDefined();

  using dir = tempDir("open-in-editor-gc", {
    "run.js": `
      const a = ${JSON.stringify(sleep)};
      const b = process.argv[2];
      // Alternate absolute editor paths so the cached editor name_storage is
      // replaced each call while a detached editor thread may still be
      // reading the previous one.
      for (let i = 0; i < 8; i++) {
        try { Bun.openInEditor("0.3", { editor: i % 2 ? b : a }); } catch {}
      }
      // Wait for the detached editor threads to complete their register /
      // unregister cycle, then for the scavenger to fire SIGPWR.
      await Bun.sleep(1000);
      Bun.gc(true);
      console.log("alive");
    `,
  });
  // Second absolute path to the same binary so alternating calls take the
  // `!eql_long(prev_name, ...)` branch in open_in_editor. Keep the basename
  // `sleep` so BusyBox (Alpine) resolves the multi-call applet from argv[0].
  const sleep2 = join(String(dir), "sleep");
  symlinkSync(sleep!, sleep2);

  const runs = Array.from({ length: 5 }, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js", sleep2],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("alive");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });

  await Promise.all(runs);
});

// vim, nvim and emacs used to be launched through the platform opener, in the
// shape of macOS's `open <editor> --args ...`: `xdg-open <editor> <editor> <file>`
// on Linux, which xdg-open rejects, and `start ...` on Windows, which is a cmd.exe
// builtin that cannot be spawned. Either way the editor never opened. They are
// now run directly, like every other editor. macOS keeps the opener (it would
// open Terminal.app here), so it is skipped.
describe.skipIf(isMacOS)("Bun.openInEditor runs terminal editors directly", () => {
  // Stands in for the editor, and on Linux also for xdg-open: writes its own
  // name followed by its arguments into its last argument, which is the file
  // being opened in both argv shapes (so on Linux the old shape shows up in the
  // diff; on Windows the old shape spawned nothing at all).
  const recordArgv = isWindows
    ? [
        "@echo off",
        "setlocal enabledelayedexpansion",
        'set "last="',
        'for %%a in (%*) do set "last=%%~a"',
        "(echo %~n0",
        'for %%a in (%*) do echo %%~a) > "!last!.tmp"',
        'move /y "!last!.tmp" "!last!" >nul',
        "",
      ].join("\r\n")
    : `#!/bin/sh
for file; do :; done
printf '%s\\n' "\${0##*/}" "$@" > "$file.tmp" && mv "$file.tmp" "$file"
`;

  const cases: [editor: string, how: "$EDITOR" | "name" | "absolute path"][] = [
    ["vim", "$EDITOR"],
    ["nvim", "$EDITOR"],
    ["emacs", "$EDITOR"],
    ["vim", "name"],
  ];
  // An absolute editor path is classified by its exact basename, which the
  // .cmd stub does not have, so this form only reaches these editors on Linux.
  if (!isWindows) cases.push(["nvim", "absolute path"]);

  // Not concurrent: five debug builds starting at once on a loaded machine ran
  // past the default per-test timeout; one at a time each row takes ~0.5s.
  test.each(cases)("%s given as %s", async (editor, how) => {
    const stub = isWindows ? `${editor}.cmd` : editor;
    using dir = tempDir("open-in-editor-terminal", {
      [stub]: recordArgv,
      // In cwd as well as on PATH so it is found however argv[0] gets resolved.
      ...(isWindows ? {} : { "xdg-open": recordArgv }),
      "run.js": `
        const [file, editor] = process.argv.slice(2);
        if (editor) Bun.openInEditor(file, { editor });
        else Bun.openInEditor(file);
        const deadline = Date.now() + 3000;
        while (!(await Bun.file(file).exists())) {
          if (Date.now() > deadline) throw new Error("nothing was spawned: " + file + " was never written");
          await Bun.sleep(5);
        }
        await Bun.write(Bun.stdout, await Bun.file(file).text());
      `,
    });
    if (!isWindows) {
      chmodSync(join(String(dir), stub), 0o755);
      chmodSync(join(String(dir), "xdg-open"), 0o755);
    }
    const file = join(String(dir), "opened.txt");

    const overrides: Record<string, string> = { PATH: `${String(dir)}${delimiter}${process.env.PATH}` };
    const cmd = [bunExe(), "run.js", file];
    if (how === "$EDITOR") overrides.EDITOR = editor;
    else cmd.push(how === "name" ? editor : join(String(dir), stub));
    // bunEnv spells the variable "Path" on Windows; a second, differently
    // cased PATH key would leave it up to the spawn which one the child sees.
    const env = mergeWindowEnvs([bunEnv, overrides]);

    await using proc = Bun.spawn({ cmd, env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.split(/\r?\n/)).toEqual([editor, file, ""]);
    expect(exitCode).toBe(0);
  });
});
