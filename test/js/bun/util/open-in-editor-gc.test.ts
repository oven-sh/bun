import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { chmodSync, existsSync, symlinkSync, writeFileSync } from "node:fs";
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

// The fake editor appends to a file, which the child waits on, so what each call spawned is known before the next.
test.skipIf(!isLinux)("Bun.openInEditor converts its arguments to strings", async () => {
  using dir = tempDir("open-in-editor-arguments", {
    "bin/code": `#!/bin/sh\necho "$*" >> "$EDITOR_LOG"\n`,
    "run.js": `
      const { readFileSync } = require("node:fs");
      const lines = () => { try { return readFileSync(process.env.EDITOR_LOG, "utf8").split("\\n").filter(Boolean); } catch { return []; } };
      const results = [];
      for (const args of [
        ["a.ts"],
        [1],
        [new String("b.ts")],
        ["a.ts", { line: 3, column: 7 }],
        ["a.ts", { line: "3" }],
        ["a.ts", { line: 0 }],
        ["a.ts", { line: "" }],
        ["a.ts", { line: null, column: undefined, editor: "" }],
        ["a.ts", Object.create({ line: 9 })],
        ["a.ts", Object.assign([], { line: 9 })],
        ["a.ts", Object.assign(() => {}, { line: 9 })],
        ["a.ts", null],
        ["a.ts", 5],
        ["a.ts", "line"],
        [],
        [undefined],
        [null],
        [""],
        [Symbol()],
        ["a.ts", { line: Symbol() }],
      ]) {
        const before = lines().length;
        try {
          Bun.openInEditor(...args);
          for (const deadline = Date.now() + 10_000; lines().length === before && Date.now() < deadline; ) await Bun.sleep(1);
          results.push(lines()[before] ?? "<nothing was spawned>");
        } catch (e) {
          results.push(e.name + ": " + e.message);
        }
      }
      console.log(JSON.stringify(results));
    `,
  });
  chmodSync(join(String(dir), "bin/code"), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env: {
      ...bunEnv,
      PATH: join(String(dir), "bin"),
      EDITOR: "code",
      EDITOR_LOG: join(String(dir), "log"),
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual([
    "a.ts",
    "1",
    "b.ts",
    "--goto a.ts:3:7",
    "--goto a.ts:3",
    "--goto a.ts:0",
    "a.ts",
    "a.ts",
    "--goto a.ts:9",
    "--goto a.ts:9",
    "--goto a.ts:9",
    "a.ts",
    "a.ts",
    "a.ts",
    "Error: No file path specified",
    "Error: No file path specified",
    "Error: No file path specified",
    "Error: No file path specified",
    "TypeError: Cannot convert a symbol to a string",
    "TypeError: Cannot convert a symbol to a string",
  ]);
  expect(exitCode).toBe(0);
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
      // Alternate absolute editor paths so the cached editor name is replaced
      // on each call. A thread that borrowed the old one would read freed memory.
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
  // name-changed branch in open_in_editor. Keep the basename
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

test.skipIf(!isLinux)("signal handlers installed before a burst of Bun.openInEditor calls still work", async () => {
  const sleep = ["/usr/bin/sleep", "/bin/sleep"].find(p => existsSync(p));
  expect(sleep).toBeDefined();

  using dir = tempDir("open-in-editor-signal-table", {
    "run.js": `
      let fired = false;
      process.on("SIGUSR2", () => { fired = true; });

      let spawned = 0;
      for (let i = 0; i < 64; i++) {
        try { Bun.openInEditor("0.1", { editor: ${JSON.stringify(sleep)} }); spawned++; } catch {}
      }
      if (spawned === 0) { console.log("no editor threads spawned"); process.exit(2); }

      // The listener's handler is restored once the last editor thread unregisters.
      const deadline = Date.now() + 3000;
      while (!fired && Date.now() < deadline) {
        await Bun.sleep(20);
        process.kill(process.pid, "SIGUSR2");
      }
      console.log(fired ? "ok" : "handler lost");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// The three sources name three editors: bunfig.toml names `atom`, EDITOR names `subl`, and `code` is
// first on the built-in list. Each fake editor appends its name and arguments to a file, which the
// child waits on. Linux-only so PATH is the only place an editor can come from.
describe.skipIf(!isLinux)("Bun.openInEditor reads [debug] editor from bunfig.toml", () => {
  const fakeEditor = `#!/bin/sh\necho "\${0##*/} $*" >> "$EDITOR_LOG"\n`;
  const files = {
    "bin/code": fakeEditor,
    "bin/subl": fakeEditor,
    "bin/atom": fakeEditor,
    "decoy/atom": `#!/bin/sh\necho "decoy $*" >> "$EDITOR_LOG"\n`,
    "run.js": `
      const { readFileSync } = require("node:fs");
      const lines = () => { try { return readFileSync(process.env.EDITOR_LOG, "utf8").split("\\n").filter(Boolean); } catch { return []; } };
      const results = [];
      for (const options of JSON.parse(process.env.CALLS)) {
        const before = lines().length;
        try {
          if (options) Bun.openInEditor("a.ts", options);
          else Bun.openInEditor("a.ts");
          for (const deadline = Date.now() + 10_000; lines().length === before && Date.now() < deadline; ) await Bun.sleep(1);
          results.push(lines()[before] ?? "<nothing was spawned>");
        } catch (e) {
          results.push(e.name + ": " + e.message);
        }
      }
      if (Bun.isMainThread) console.log(JSON.stringify(results));
      else postMessage(JSON.stringify(results));
    `,
    "in-worker.js": `
      const worker = new Worker(new URL("run.js", import.meta.url).href);
      worker.onmessage = event => console.log(event.data);
      worker.onerror = event => { console.error(event.message); process.exit(1); };
    `,
  };

  type Row = {
    name: string;
    /** The value of `[debug] editor`. Without it there is no bunfig.toml. */
    editor?: string | ((dir: string) => string);
    /** The file that holds the setting. Any other name than bunfig.toml is passed with --config. */
    config?: string;
    entry?: string;
    EDITOR?: string;
    /** One call of Bun.openInEditor each: its options, or null for none. */
    calls: ({ editor: string } | null)[];
    expected: string[];
  };
  const rows: Row[] = [
    {
      name: "it comes before $EDITOR and the built-in list",
      editor: "atom",
      EDITOR: "subl",
      calls: [null, null],
      expected: ["atom a.ts", "atom a.ts"],
    },
    {
      name: "a call without the option does not reuse the editor that an earlier call named",
      editor: "atom",
      calls: [{ editor: "subl" }, null, { editor: "subl" }, null],
      expected: ["subl a.ts", "atom a.ts", "subl a.ts", "atom a.ts"],
    },
    {
      name: "it comes before $EDITOR when the option names an editor that Bun does not know",
      editor: "atom",
      EDITOR: "subl",
      calls: [{ editor: "notepad++" }],
      expected: ["atom a.ts"],
    },
    {
      name: "only the last component of a path is used, and the file it names is not run",
      editor: dir => join(dir, "decoy", "atom"),
      EDITOR: "subl",
      calls: [null],
      expected: ["atom a.ts"],
    },
    {
      name: "a Worker reads it",
      editor: "atom",
      entry: "in-worker.js",
      EDITOR: "subl",
      calls: [null],
      expected: ["atom a.ts"],
    },
    {
      name: "it is read from the file that --config names",
      editor: "atom",
      config: "other.toml",
      EDITOR: "subl",
      calls: [null],
      expected: ["atom a.ts"],
    },
    {
      name: "with an editor that is not found, a call without the option runs detection again",
      editor: "webstorm",
      EDITOR: "subl",
      calls: [{ editor: "atom" }, null],
      expected: ["atom a.ts", "subl a.ts"],
    },
    // The rows below pass without the fix too. They pin what the setting does not change.
    {
      name: "an editor that is not installed falls back to $EDITOR",
      editor: "webstorm",
      EDITOR: "subl",
      calls: [null],
      expected: ["subl a.ts"],
    },
    {
      name: "a name that Bun does not know falls back to $EDITOR",
      editor: "zed",
      EDITOR: "subl",
      calls: [null],
      expected: ["subl a.ts"],
    },
    {
      name: "without it, a call without the option reuses the editor that an earlier call named",
      calls: [null, { editor: "subl" }, null],
      expected: ["code a.ts", "subl a.ts", "subl a.ts"],
    },
  ];

  test.concurrent.each(rows)(
    "$name",
    async ({ editor, config = "bunfig.toml", entry = "run.js", EDITOR, calls, expected }) => {
      using dir = tempDir("open-in-editor-bunfig", files);
      for (const bin of ["bin/code", "bin/subl", "bin/atom", "decoy/atom"]) chmodSync(join(String(dir), bin), 0o755);
      if (editor !== undefined) {
        const value = typeof editor === "function" ? editor(String(dir)) : editor;
        writeFileSync(join(String(dir), config), `[debug]\neditor = ${JSON.stringify(value)}\n`);
      }

      await using proc = Bun.spawn({
        cmd: [bunExe(), ...(config === "bunfig.toml" ? [] : [`--config=${config}`]), entry],
        env: {
          ...bunEnv,
          PATH: join(String(dir), "bin"),
          EDITOR,
          VISUAL: undefined,
          EDITOR_LOG: join(String(dir), "log"),
          CALLS: JSON.stringify(calls),
        },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(expected);
      expect(exitCode).toBe(0);
    },
  );
});
