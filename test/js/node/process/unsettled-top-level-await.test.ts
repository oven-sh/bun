import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// When the entry module's top-level await never settles and nothing else refs
// the event loop, Bun used to spin `wait_for_promise` forever (100% CPU, no
// epoll park). Node prints a warning and exits 13. Issue #33283.

// Watchdog below the per-test timeout so a regression surfaces as a clean
// SIGTERM assertion instead of a suite-level timeout. The fixed path exits in
// well under a second.
const watchdog = 3_000;

async function run(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({
    cmd,
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: watchdog,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent("never-settling top-level await exits 13 with a warning", async () => {
  using dir = tempDir("tla-unsettled", {
    "a.mjs": `await new Promise(() => {});\n`,
  });
  const { stderr, exitCode, signalCode } = await run([bunExe(), "a.mjs"], String(dir));
  expect(stderr).toContain("Detected unsettled top-level await at");
  expect(stderr).toContain("a.mjs");
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 13 });
});

test.concurrent("never-settling top-level await in a dependency exits 13", async () => {
  using dir = tempDir("tla-unsettled-dep", {
    "entry.mjs": `import { ready } from "./dep.mjs";\nawait ready;\n`,
    "dep.mjs": `export const ready = new Promise(() => {});\n`,
  });
  const { stderr, exitCode, signalCode } = await run([bunExe(), "entry.mjs"], String(dir));
  expect(stderr).toContain("Detected unsettled top-level await");
  expect(stderr).toContain("entry.mjs");
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 13 });
});

test.concurrent("top-level await resolved by a ref'd timer exits 0", async () => {
  using dir = tempDir("tla-timer", {
    "a.mjs": `await new Promise(r => setTimeout(r, 50));\nconsole.log("done");\n`,
  });
  const { stdout, stderr, exitCode, signalCode } = await run([bunExe(), "a.mjs"], String(dir));
  expect(stdout).toBe("done\n");
  expect(stderr).not.toContain("Detected unsettled top-level await");
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 0 });
});

test.concurrent("top-level await resolved by a microtask exits 0", async () => {
  using dir = tempDir("tla-micro", {
    "a.mjs": `await new Promise(r => queueMicrotask(r));\nconsole.log("done");\n`,
  });
  const { stdout, stderr, exitCode, signalCode } = await run([bunExe(), "a.mjs"], String(dir));
  expect(stdout).toBe("done\n");
  expect(stderr).not.toContain("Detected unsettled top-level await");
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 0 });
});

test.concurrent("unsettled top-level await preserves a user-set process.exitCode", async () => {
  using dir = tempDir("tla-exitcode", {
    "a.mjs": `process.exitCode = 7;\nawait new Promise(() => {});\n`,
  });
  const { stderr, exitCode, signalCode } = await run([bunExe(), "a.mjs"], String(dir));
  expect(stderr).toContain("Detected unsettled top-level await");
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 7 });
});

test.concurrent("beforeExit fires with 0 before the unsettled-TLA warning", async () => {
  using dir = tempDir("tla-beforeexit", {
    "a.mjs": `process.on("beforeExit", c => console.error("beforeExit", c));\n` + `await new Promise(() => {});\n`,
  });
  const { stderr, exitCode, signalCode } = await run([bunExe(), "a.mjs"], String(dir));
  const before = stderr.indexOf("beforeExit 0");
  const warn = stderr.indexOf("Detected unsettled top-level await");
  expect(before).toBeGreaterThanOrEqual(0);
  expect(warn).toBeGreaterThan(before);
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 13 });
});

test.concurrent("bun -e with a never-settling top-level await exits 13", async () => {
  const { stderr, exitCode, signalCode } = await run([bunExe(), "-e", "await new Promise(() => {})"]);
  expect(stderr).toContain("Detected unsettled top-level await");
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 13 });
});

test.concurrent("uncaught exception during top-level await does not print a spurious TLA warning", async () => {
  using dir = tempDir("tla-uncaught", {
    "a.mjs": `setImmediate(() => { throw new Error("boom"); });\nawait new Promise(r => setTimeout(r, 100));\n`,
  });
  const { stderr, exitCode, signalCode } = await run([bunExe(), "a.mjs"], String(dir));
  expect(stderr).toContain("boom");
  expect(stderr).not.toContain("Detected unsettled top-level await");
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 1 });
});

test.concurrent("top-level await rejected during beforeExit is reported (exit 1, not swallowed)", async () => {
  using dir = tempDir("tla-reject-beforeexit", {
    "a.mjs":
      `const { promise, reject } = Promise.withResolvers();\n` +
      `process.once("beforeExit", () => setImmediate(() => reject(new Error("db never connected"))));\n` +
      `await promise;\n`,
  });
  const { stderr, exitCode, signalCode } = await run([bunExe(), "a.mjs"], String(dir));
  expect(stderr).toContain("db never connected");
  expect(stderr).not.toContain("Detected unsettled top-level await");
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 1 });
});
