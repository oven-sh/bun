import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { chmodSync, symlinkSync } from "node:fs";
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

// Each Bun.openInEditor call hands its argv to a detached thread. Alternating
// between two absolute editor paths replaces the cached editor name on every
// call while earlier threads may still be reading theirs, and the forced GC
// afterwards suspends whatever threads are still around. Every editor must
// actually run and the process must come out alive.
test.concurrent.skipIf(isWindows)("alternating editors on live editor threads, then GC", async () => {
  using dir = tempDir("open-in-editor-gc", {
    "fake-editor.sh": '#!/bin/sh\necho opened > "$1"\n',
    "run.js": `
      import { existsSync } from "node:fs";
      const editors = process.argv.slice(2);
      const markers = [];
      for (let i = 0; i < 8; i++) {
        markers.push(\`opened-\${process.pid}-\${i}\`);
        Bun.openInEditor(markers[i], { editor: editors[i % 2] });
      }
      while (!markers.every(m => existsSync(m))) await Bun.sleep(5);
      Bun.gc(true);
      console.log("alive");
    `,
  });
  const editor = join(String(dir), "fake-editor.sh");
  chmodSync(editor, 0o755);
  // Second absolute path to the same script, so consecutive calls take the
  // name-replacing branch of openInEditor.
  const editor2 = join(String(dir), "fake-editor-2.sh");
  symlinkSync(editor, editor2);

  const runs = Array.from({ length: 5 }, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js", editor, editor2],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("alive\n");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });

  await Promise.all(runs);
});

// The editor thread used to go through bun.spawnSync, which installs the
// process-wide signal-forwarding handlers meant for `bun run` (they redirect
// SIGINT/SIGTERM/SIGUSR2/... to the child) for as long as the editor runs,
// while the user's program keeps running on the main thread. The fixtures
// below open a fake editor that records its pid in the "file" it is asked to
// open and then stays alive until the test kills it, so the assertions run
// while the editor is definitely up.
const fakeEditorFiles = {
  // Bun.openInEditor(file, { editor }) runs `editor file`; after the exec the
  // sleep keeps the shell's pid, so the recorded pid is the one to kill.
  "fake-editor.sh": '#!/bin/sh\necho $$ > "$1"\nexec sleep 30\n',
  "wait-for-editor.js": `
    import { readFileSync } from "node:fs";
    export async function waitForEditorPid(pidFile) {
      for (;;) {
        let text = "";
        try { text = readFileSync(pidFile, "utf8"); } catch {}
        if (/^\\d+\\n$/.test(text)) return Number(text);
        await Bun.sleep(5);
      }
    }
  `,
};

// https://github.com/oven-sh/bun/issues/31194
test.concurrent.skipIf(!isLinux)("Bun.openInEditor does not change the process's signal dispositions", async () => {
  using dir = tempDir("open-in-editor-sigcgt", {
    ...fakeEditorFiles,
    "run.js": `
      import { readFileSync } from "node:fs";
      import { waitForEditorPid } from "./wait-for-editor.js";
      // SigCgt is the bitmask of signals this process has a handler for.
      const caught = () => readFileSync("/proc/self/status", "utf8").match(/^SigCgt:\\s*([0-9a-f]+)/m)[1];
      const [editor, pidFile] = process.argv.slice(2);

      const before = caught();
      Bun.openInEditor(pidFile, { editor });
      const pid = await waitForEditorPid(pidFile);
      const during = caught();
      process.kill(pid, "SIGTERM");
      console.log(JSON.stringify({ before, during }));
    `,
  });
  const editor = join(String(dir), "fake-editor.sh");
  chmodSync(editor, 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js", editor, join(String(dir), "editor.pid")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { before, during } = JSON.parse(stdout);
  const changed = BigInt("0x" + before) ^ BigInt("0x" + during);
  const changedSignals = Array.from({ length: 64 }, (_, i) => i + 1).filter(sig => changed & (1n << BigInt(sig - 1)));
  expect(changedSignals).toEqual([]);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/31194
test.concurrent.skipIf(isWindows)(
  "a process.on signal handler still runs while an editor opened by Bun.openInEditor is up",
  async () => {
    using dir = tempDir("open-in-editor-signal-handler", {
      ...fakeEditorFiles,
      "run.js": `
      import { waitForEditorPid } from "./wait-for-editor.js";
      const [editor, pidFile] = process.argv.slice(2);
      const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

      const handled = new Promise(resolve => process.on("SIGUSR2", () => resolve("handler ran")));
      Bun.openInEditor(pidFile, { editor });
      const pid = await waitForEditorPid(pidFile);

      process.kill(process.pid, "SIGUSR2");
      // Forwarding would deliver the signal to the editor instead, and sleep
      // dies from SIGUSR2; otherwise our handler runs. Wait for either.
      const forwarded = (async () => {
        while (alive(pid)) await Bun.sleep(5);
        return "signal was forwarded to the editor";
      })();
      const outcome = await Promise.race([handled, forwarded]);
      if (alive(pid)) process.kill(pid, "SIGTERM");
      console.log(outcome);
    `,
    });
    const editor = join(String(dir), "fake-editor.sh");
    chmodSync(editor, 0o755);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js", editor, join(String(dir), "editor.pid")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("handler ran\n");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  },
);

// Terminal editors are opened through `xdg-open` on Linux, with the editor
// binary as the first argument and the file as the last. The opener is a bare
// name, so the editor spawn has to look it up on PATH; the spawnSync path
// exec'd it relative to cwd and silently failed.
test.concurrent.skipIf(!isLinux)("Bun.openInEditor finds the xdg-open opener on PATH", async () => {
  using dir = tempDir("open-in-editor-opener", {
    // Records the editor binary into the file argument; never runs the editor.
    "bin/xdg-open": '#!/bin/sh\nfor file; do :; done\necho "opened $1" > "$file"\n',
    // Only its basename matters: it selects the vim (opener-based) argv shape.
    "vim": "",
    "run.js": `
      import { readFileSync } from "node:fs";
      const [editor, marker] = process.argv.slice(2);
      Bun.openInEditor(marker, { editor });
      for (;;) {
        let text = "";
        try { text = readFileSync(marker, "utf8"); } catch {}
        if (text.endsWith("\\n")) break;
        await Bun.sleep(5);
      }
      process.stdout.write(readFileSync(marker, "utf8"));
    `,
  });
  chmodSync(join(String(dir), "bin", "xdg-open"), 0o755);
  const editor = join(String(dir), "vim");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js", editor, join(String(dir), "opened.txt")],
    env: { ...bunEnv, PATH: `${join(String(dir), "bin")}:${bunEnv.PATH}` },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe(`opened ${editor}\n`);
  expect(exitCode).toBe(0);
});

// The editor must start with only stdio open. fs.openSync() descriptors are
// not close-on-exec, so a spawn that does not scrub the fd table (macOS
// posix_spawn without POSIX_SPAWN_CLOEXEC_DEFAULT) hands them to the editor.
// The "editor" here is bun itself running probe.js, which checks whether the
// parent's descriptor number still refers to the sentinel file.
test.concurrent.skipIf(isWindows)(
  "Bun.openInEditor does not pass the process's file descriptors to the editor",
  async () => {
    using dir = tempDir("open-in-editor-fds", {
      "sentinel.txt": "sentinel",
      "run.js": `
      import { openSync, readFileSync, writeFileSync } from "node:fs";
      const fd = openSync("sentinel.txt", "r");
      writeFileSync(
        "probe.js",
        \`
          import { fstatSync, statSync, writeFileSync } from "node:fs";
          const sentinel = statSync("sentinel.txt");
          let inherited = false;
          try {
            const got = fstatSync(\${fd});
            inherited = got.ino === sentinel.ino && got.dev === sentinel.dev;
          } catch {}
          writeFileSync("result.txt", inherited ? "fd \${fd} inherited\\\\n" : "fd \${fd} not inherited\\\\n");
        \`,
      );
      Bun.openInEditor(\`\${process.cwd()}/probe.js\`, { editor: process.execPath });
      let result = "";
      while (!result.endsWith("\\n")) {
        try { result = readFileSync("result.txt", "utf8"); } catch {}
        if (!result.endsWith("\\n")) await Bun.sleep(5);
      }
      process.stdout.write(result.replace(/\\d+/, "N"));
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
    expect(stdout).toBe("fd N not inherited\n");
    expect(exitCode).toBe(0);
  },
);
