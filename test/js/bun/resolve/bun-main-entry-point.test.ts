import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
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
  return stderr.split("\n").filter(l => l.length > 0 && !l.startsWith("WARNING: ASAN interferes"));
}

test.concurrent("dynamic import('bun:main') returns the wrapper module", async () => {
  using dir = tempDir("bun-main-dyn", {
    "entry.mjs": `
      const m = await import("bun:main");
      if (typeof m !== "object" || m === null) throw new Error("expected module namespace");
      console.log("OK");
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
  expect(stdout).toBe("OK\n");
  expect(stripAsanWarning(stderr)).toEqual([]);
  expect(exitCode).toBe(0);
});

test.concurrent("import('bun:main') from a preload (before the module map is populated)", async () => {
  using dir = tempDir("bun-main-preload", {
    "preload.mjs": `
      const m = await import("bun:main");
      if (typeof m !== "object" || m === null) throw new Error("expected module namespace");
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
  expect(stdout).toBe("PRELOAD_OK\nENTRY_OK\n");
  expect(stripAsanWarning(stderr)).toEqual([]);
  expect(exitCode).toBe(0);
});

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
