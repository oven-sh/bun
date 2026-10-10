import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { chmodSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

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

// `[debug] editor` in bunfig.toml picks the editor Bun.openInEditor() uses when
// no `editor` option is passed. It used to be parsed but never read, and an
// absolute path used to be spawned without checking that it exists, which
// silently did nothing. Linux-only like the tests above: PATH holds only the
// fake editors, so nothing real can be detected (macOS also probes /Applications).
describe.skipIf(!isLinux)("Bun.openInEditor reads [debug] editor from bunfig.toml", () => {
  // Records its own name and its arguments. Shell builtins only, since PATH
  // has nothing else on it; the trailing "done" line marks the record complete.
  const fakeEditor = ({ root }: { root: string }) => `#!/bin/sh
printf '%s\\n' "\${0##*/}" "$@" done > "${join(root, "argv.txt")}"
`;

  // Polls with a fresh BunFile each time, since a BunFile keeps the size it
  // first saw. Bun.file and console.write are used instead of node:fs and
  // process.stdout because those are noticeably slower to load in a debug build.
  const readRecord = `
    let record = "";
    while (!record.endsWith("\\ndone\\n")) {
      await Bun.sleep(5);
      const argv = Bun.file("argv.txt");
      if (await argv.exists()) record = await argv.text();
    }
  `;

  // Prints the editor's record when a call is expected to open something, and
  // otherwise just how the call ended, so a call that wrongly opens nothing
  // fails instead of waiting for a record that never comes.
  const fixture = `
    const [file, expectation, editor] = process.argv.slice(2);
    let outcome = "returned";
    try {
      if (editor) Bun.openInEditor(file, { editor });
      else Bun.openInEditor(file);
    } catch (e) {
      outcome = "threw: " + e.message;
    }
    if (outcome !== "returned" || expectation !== "opens") {
      console.log(outcome);
    } else {
      ${readRecord}
      console.write(record);
    }
  `;

  const bunfigMyEditor = ({ root }: { root: string }) => `[debug]\neditor = "${join(root, "my-editor")}"\n`;
  const bunfigMovedCode = ({ root }: { root: string }) => `[debug]\neditor = "${join(root, "gone", "code")}"\n`;

  // `code` is first on the built-in preference list, so a case that installs
  // both `code` and `subl` and sets EDITOR=subl can tell the three sources apart:
  // the bunfig entry, $EDITOR, and the built-in list would each pick differently.
  test.concurrent.each([
    {
      name: "an absolute path is used as the editor",
      bunfig: bunfigMyEditor,
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
      bunfig: `[debug]\neditor = "webstorm"\n`,
      editors: ["code", "subl"],
      EDITOR: "subl",
      opens: "subl",
    },
    {
      name: "an absolute path that does not exist falls back to $EDITOR",
      bunfig: bunfigMyEditor,
      editors: ["code", "subl"],
      EDITOR: "subl",
      opens: "subl",
    },
    {
      name: "an absolute path that does not exist is looked up on PATH by name first",
      bunfig: bunfigMovedCode,
      editors: ["code", "subl"],
      EDITOR: "subl",
      opens: "code",
    },
    {
      name: "an absolute path that does not exist throws when nothing else is found",
      bunfig: bunfigMyEditor,
      editors: [],
      throws: () => "Failed to auto-detect editor",
    },
    {
      name: "the editor option beats bunfig",
      bunfig: bunfigMyEditor,
      editors: ["my-editor", "other-editor"],
      option: "other-editor",
      opens: "other-editor",
    },
    {
      name: "an editor option whose path does not exist throws instead of opening nothing",
      bunfig: bunfigMyEditor,
      editors: ["my-editor"],
      option: "missing-editor",
      throws: (dir: string) => `Could not find editor "${join(dir, "missing-editor")}"`,
    },
  ])("$name", async ({ bunfig, editors, EDITOR, option, opens, throws }) => {
    using dir = tempDir("open-in-editor-bunfig", {
      "bunfig.toml": bunfig,
      "run.js": fixture,
      ...Object.fromEntries(editors.map(name => [name, fakeEditor])),
    });
    for (const name of editors) chmodSync(join(String(dir), name), 0o755);
    const file = join(String(dir), "opened.ts");

    const cmd = [bunExe(), "run.js", file, opens ? "opens" : "throws"];
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
    expect(stdout.split("\n")).toEqual(throws ? [`threw: ${throws(String(dir))}`, ""] : [opens, file, "done", ""]);
    expect(exitCode).toBe(0);
  });

  // An `editor` option equal to the current name reuses the cached editor. A
  // bunfig editor that auto-detection failed to find must not be reused that
  // way: the explicit request gets its own lookup, and succeeds once the editor
  // is installed.
  test.concurrent("an editor option is looked up again after the bunfig editor was not found", async () => {
    using dir = tempDir("open-in-editor-bunfig-retry", {
      "bunfig.toml": `[debug]\neditor = "code"\n`,
      "bin/.keep": "",
      "code": fakeEditor,
      "run.js": `
        import { renameSync } from "node:fs";
        const file = process.argv[2];
        const attempt = options => {
          try {
            Bun.openInEditor(file, options);
            return "opened";
          } catch (e) {
            return e.message;
          }
        };
        const outcomes = [attempt(), attempt({ editor: "code" })];
        renameSync("code", "bin/code");
        outcomes.push(attempt({ editor: "code" }));
        ${readRecord}
        console.write(outcomes.join("\\n") + "\\n" + record);
      `,
    });
    chmodSync(join(String(dir), "code"), 0o755);
    const file = join(String(dir), "opened.ts");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js", file],
      env: { ...bunEnv, PATH: join(String(dir), "bin"), EDITOR: undefined, VISUAL: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.split("\n")).toEqual([
      "Failed to auto-detect editor",
      'Could not find editor "code"',
      "opened",
      "code",
      file,
      "done",
      "",
    ]);
    expect(exitCode).toBe(0);
  });
});
