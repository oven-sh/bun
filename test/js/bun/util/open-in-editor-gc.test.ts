import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// When no editor can be detected (no bunfig editor, no EDITOR/VISUAL, nothing
// in PATH), Bun.openInEditor must throw instead of spawning a detached editor
// thread with an empty argv[0]. Repeated calls used to fork a doomed child per
// call, which let fuzzed scripts create thousands of threads/processes and
// stress the GC/scavenger thread-suspension signal until the process died.
test.skipIf(!isLinux)("Bun.openInEditor throws when no editor can be found", async () => {
  using dir = tempDir("open-in-editor-none", {
    "empty-path/.keep": "",
  });

  const env: Record<string, string | undefined> = {
    ...bunEnv,
    PATH: join(String(dir), "empty-path"),
  };
  delete env.EDITOR;
  delete env.VISUAL;

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function f0(a1, a2, a3) {}
      let threw = 0;
      let silent = 0;
      let lastError = "";
      for (let i = 0; i < 50; i++) {
        try {
          Bun.openInEditor(i % 2 ? "foo.js" : f0);
          silent++;
        } catch (e) {
          threw++;
          lastError = e.message;
        }
      }
      Bun.gc(true);
      console.log(JSON.stringify({ threw, silent, lastError }));
      `,
    ],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ threw: 50, silent: 0, lastError: "Failed to auto-detect editor" });
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
