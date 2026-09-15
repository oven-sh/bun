import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isWindows, tempDir } from "harness";
import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
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

const NOBODY = "65534";
const canDropPrivs =
  isLinux && typeof process.getuid === "function" && process.getuid() === 0 && Bun.which("setpriv") != null;

async function runAsNobody(scriptPath: string) {
  using childHome = tempDir("bun-main-nobody-home", {});
  chmodSync(String(childHome), 0o777);
  await using proc = Bun.spawn({
    cmd: ["setpriv", `--reuid=${NOBODY}`, `--regid=${NOBODY}`, "--clear-groups", bunExe(), scriptPath],
    cwd: String(childHome),
    env: { ...bunEnv, HOME: String(childHome) },
    stdout: "pipe",
    stderr: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

test.skipIf(!canDropPrivs).concurrent("runs an entry point in a searchable-but-not-listable directory", async () => {
  using dir = tempDir("bun-main-nolist", {
    "sub/entry.js": `console.log("RAN_OK");`,
  });
  const root = String(dir);
  chmodSync(root, 0o755);
  // 0711: nobody can traverse sub and open entry.js by name, but not readdir it.
  chmodSync(join(root, "sub"), 0o711);
  chmodSync(join(root, "sub", "entry.js"), 0o644);

  const [stdout, _stderr, exitCode] = await runAsNobody(join(root, "sub", "entry.js"));
  expect(stdout).toBe("RAN_OK\n");
  if (exitCode !== 0) expect(_stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.skipIf(!canDropPrivs).concurrent("control: runs an entry point in a listable directory as nobody", async () => {
  using dir = tempDir("bun-main-list", {
    "sub/entry.js": `console.log("RAN_OK");`,
  });
  const root = String(dir);
  chmodSync(root, 0o755);
  chmodSync(join(root, "sub"), 0o755);
  chmodSync(join(root, "sub", "entry.js"), 0o644);

  const [stdout, _stderr, exitCode] = await runAsNobody(join(root, "sub", "entry.js"));
  expect(stdout).toBe("RAN_OK\n");
  if (exitCode !== 0) expect(_stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows).concurrent("resolves a symlinked entry point relative to its real directory", async () => {
  using dir = tempDir("bun-main-symlink", {
    "real/main.js": `import { dep } from "./dep.js";\nconsole.log("SYM_OK", dep);`,
    "real/dep.js": `export const dep = "from-real";`,
  });
  const root = String(dir);
  symlinkSync(join(root, "real", "main.js"), join(root, "link.js"));

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(root, "link.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr: stripAsanWarning(stderr), exitCode }).toEqual({
    stdout: "SYM_OK from-real\n",
    stderr: [],
    exitCode: 0,
  });
});

test.concurrent("imports the entry point's own directory (incomplete-cache upgrade)", async () => {
  using dir = tempDir("bun-main-dirimport", {
    "pkg/package.json": `{"type":"commonjs"}`,
    "pkg/index.js": `module.exports = "PKG_INDEX";`,
    "pkg/entry.js": `require("../consumer/consume.js");`,
    "consumer/consume.js": `console.log("RESOLVED:", require("../pkg"));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "pkg", "entry.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr: stripAsanWarning(stderr), exitCode }).toEqual({
    stdout: "RESOLVED: PKG_INDEX\n",
    stderr: [],
    exitCode: 0,
  });
});

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
