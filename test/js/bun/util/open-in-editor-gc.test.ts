import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { chmodSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

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

// `[debug] editor` in bunfig.toml is the documented way to pick the editor
// Bun.openInEditor() uses when no `editor` option is passed. It was parsed
// but never read, so only $EDITOR/$VISUAL and the built-in list applied.
// Linux-only like the tests above: PATH holds only the fake editors, so
// nothing real can be detected (macOS would also probe /Applications).
describe.skipIf(!isLinux)("Bun.openInEditor reads [debug] editor from bunfig.toml", () => {
  // Records its own name and its arguments. Shell builtins only, since PATH
  // has nothing else on it; the trailing "done" line marks the record complete.
  const fakeEditor = ({ root }: { root: string }) => `#!/bin/sh
printf '%s\\n' "\${0##*/}" "$@" done > "${join(root, "argv.txt")}"
`;

  const fixture = `
    import { existsSync, readFileSync } from "node:fs";
    const [file, editor] = process.argv.slice(2);
    if (editor) Bun.openInEditor(file, { editor });
    else Bun.openInEditor(file);
    let text = "";
    while (!text.endsWith("\\ndone\\n")) {
      await Bun.sleep(5);
      if (existsSync("argv.txt")) text = readFileSync("argv.txt", "utf8");
    }
    process.stdout.write(text);
  `;

  const absoluteMyEditor = ({ root }: { root: string }) => `[debug]\neditor = "${join(root, "my-editor")}"\n`;

  test.concurrent.each([
    {
      name: "an absolute path is used as the editor",
      bunfig: absoluteMyEditor,
      editors: ["my-editor"],
      opens: "my-editor",
    },
    {
      name: "an editor name is looked up on PATH and beats $EDITOR",
      bunfig: `[debug]\neditor = "code"\n`,
      editors: ["code", "subl"],
      EDITOR: "subl",
      opens: "code",
    },
    {
      name: "an editor name that is not installed falls back to $EDITOR",
      bunfig: `[debug]\neditor = "code"\n`,
      editors: ["subl"],
      EDITOR: "subl",
      opens: "subl",
    },
    {
      name: "the editor option beats bunfig",
      bunfig: absoluteMyEditor,
      editors: ["my-editor", "other-editor"],
      option: "other-editor",
      opens: "other-editor",
    },
  ])("$name", async ({ bunfig, editors, EDITOR, option, opens }) => {
    using dir = tempDir("open-in-editor-bunfig", {
      "bunfig.toml": bunfig,
      "run.js": fixture,
      ...Object.fromEntries(editors.map(name => [name, fakeEditor])),
    });
    for (const name of editors) chmodSync(join(String(dir), name), 0o755);
    const file = join(String(dir), "opened.ts");

    const cmd = [bunExe(), "run.js", file];
    if (option) cmd.push(join(String(dir), option));

    await using proc = Bun.spawn({
      cmd,
      env: { ...bunEnv, PATH: String(dir), EDITOR, VISUAL: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.split("\n")).toEqual([opens, file, "done", ""]);
    expect(exitCode).toBe(0);
  });
});
