import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// `bun:main` is backed by ServerEntryPoint.contents — a slice that is
// regenerated on every hot-reload cycle. Previously the backing
// `logger.Source` defaulted to `undefined`, so any read of
// `entry_point.source.contents` that wasn't paired with a successful
// `generate()` dereferenced garbage (high non-null fault in
// toBunStringComptime). These tests exercise the read path directly and
// the regenerate path under --hot so ASAN covers the new
// free-then-reallocate on each reload.

function stripAsanWarning(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter(
      l => l.length > 0 && !l.startsWith("WARNING: ASAN interferes") && !l.startsWith("debug warn:"),
    );
}

test.concurrent("dynamic import('bun:main') returns the wrapper module", async () => {
  using dir = tempDir("bun-main-dyn", {
    // package.json disables auto-install so a regression in the bun:main alias
    // cannot silently fall through to fetching the npm `main` package.
    "package.json": "{}",
    // bun:main statically imports entry.mjs, so awaiting import("bun:main")
    // at the top level of entry.mjs is a TLA self-cycle that never resolves.
    // Defer the import to a .then() so entry.mjs (and therefore bun:main)
    // can finish evaluating first.
    "entry.mjs": `
      import("bun:main").then(m => {
        if (m[Symbol.toStringTag] !== "Module") throw new Error("expected module namespace, got " + Object.prototype.toString.call(m));
        // The wrapper has no named exports. The npm \`main\` package (what this
        // resolved to before the alias fix) exports {default,length,name,prototype}.
        const keys = Object.keys(m);
        if (keys.length !== 0) throw new Error("expected empty wrapper namespace, got keys: " + keys.join(","));
        console.log("OK");
      }).catch(e => {
        console.error(String(e));
        process.exit(1);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "./entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr: stripAsanWarning(stderr), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "OK\n",
    stderr: [],
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("import('bun:main') from a preload (before the module map is populated)", async () => {
  using dir = tempDir("bun-main-preload", {
    "package.json": "{}",
    "preload.mjs": `
      const m = await import("bun:main");
      if (m[Symbol.toStringTag] !== "Module") throw new Error("expected module namespace");
      console.log("PRELOAD_OK");
    `,
    "entry.mjs": `console.log("ENTRY_OK");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.mjs", "./entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // import("bun:main") evaluates the wrapper, which evaluates entry.mjs, so
  // ENTRY_OK prints before the preload's await resumes.
  expect({ stdout, stderr: stripAsanWarning(stderr), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "ENTRY_OK\nPRELOAD_OK\n",
    stderr: [],
    exitCode: 0,
    signalCode: null,
  });
});

// Sentry BUN-36H7 / https://github.com/oven-sh/bun/issues/27192:
// import("bun:main") inside a compiled standalone executable faulted in
// getHardcodedModule reading the stored `entry_point.contents` slice
// (SEGV at a page-aligned high address, i.e. a freed mimalloc segment).
// The wrapper source is now regenerated on demand from `vm.main` at fetch
// time, so there is no stored buffer that can go stale between
// `reload_entry_point` and the fetch. This exercises the exact crash
// scenario: the bundled entry both (a) is reached via the initial
// bun:main fetch at boot and (b) explicitly re-imports bun:main after the
// top-level evaluation has completed.
test.concurrent(
  "import('bun:main') in a compiled standalone executable",
  async () => {
    using dir = tempDir("bun-main-compile", {
      "package.json": "{}",
      "entry.mjs": `
        // bun:main statically imports this file, so awaiting it at the top
        // level would be a TLA self-cycle. Defer to a task so bun:main
        // finishes evaluating first, then re-import it from user code.
        setImmediate(async () => {
          try {
            Bun.gc(true);
            const m = await import("bun:main");
            if (m[Symbol.toStringTag] !== "Module") throw new Error("expected module namespace");
            const keys = Object.keys(m);
            if (keys.length !== 0) throw new Error("expected empty wrapper namespace, got keys: " + keys.join(","));
            console.log("OK");
          } catch (e) {
            console.error(String(e));
            process.exit(1);
          }
        });
      `,
    });
    const outfile = join(String(dir), isWindows ? "out.exe" : "out");
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "./entry.mjs", "--outfile", outfile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringContaining("error:"), exitCode: 0 });
      void stdout;
    }
    await using proc = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect({ stdout, stderr: stripAsanWarning(stderr), exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "OK\n",
      stderr: [],
      exitCode: 0,
      signalCode: null,
    });
  },
  isDebug ? 120_000 : 60_000,
);

test.concurrent(
  "ServerEntryPoint regenerates cleanly across --hot reloads",
  async () => {
    // Each reload calls ServerEntryPoint.generate() again, which now frees the
    // previous `contents` buffer before allocating a fresh one. Drive several
    // reloads and verify bun:main is re-fetched and evaluates correctly each
    // time; under ASAN this catches any use-after-free of the prior buffer.
    using dir = tempDir("bun-main-hot", {
      "entry.mjs": `globalThis.__gen = (globalThis.__gen ?? 0) + 1;\nconsole.log("GEN", 0);\n`,
    });
    const entry = join(String(dir), "entry.mjs");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", entry],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Drain stderr concurrently so a large sanitizer report can't fill the
    // pipe buffer and wedge the child while we're blocked on stdout.
    const stderrPromise = proc.stderr.text();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";

    const waitForLine = async (needle: string) => {
      while (!buffered.includes(needle)) {
        const { value, done } = await reader.read();
        if (done)
          throw new Error(`stdout closed before seeing ${JSON.stringify(needle)}; buffer=${JSON.stringify(buffered)}`);
        buffered += decoder.decode(value, { stream: true });
      }
    };

    await waitForLine("GEN 0\n");

    for (let i = 1; i <= 4; i++) {
      writeFileSync(entry, `globalThis.__gen = (globalThis.__gen ?? 0) + 1;\nconsole.log("GEN", ${i});\n`);
      await waitForLine(`GEN ${i}\n`);
    }

    proc.kill();
    reader.releaseLock();
    await proc.exited;
    await stderrPromise;

    // Reaching GEN 4 proves the wrapper was regenerated and re-read via
    // cloneUTF8 on every reload without faulting on a stale slice.
    expect(buffered).toContain("GEN 4\n");
  },
  isDebug ? 60_000 : 30_000,
);
