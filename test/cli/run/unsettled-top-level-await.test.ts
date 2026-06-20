import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/32528
//
// A top-level `await` on a promise that can never settle (e.g. the entry module
// awaits `new Promise(() => {})`, or reads from an empty ReadableStream) used to
// hang Bun at 100% CPU. Node.js detects the drained event loop, prints a
// "Detected unsettled top-level await" warning, and exits with code 13. These
// tests lock in that behavior.

// Watchdog for a regressed hang. A healthy process exits in well under a second,
// so this never kills one that made progress; it only bounds an infinite spin.
// The per-test timeout below is larger so the watchdog kill surfaces as a clean
// assertion failure rather than a test-runner timeout.
const WATCHDOG_MS = 12_000;
const TEST_TIMEOUT_MS = 30_000;

async function run(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({
    cmd,
    env: bunEnv,
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: WATCHDOG_MS,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  // `signalCode === null` means the process exited on its own. A regressed hang
  // is killed by the watchdog and reports "SIGKILL" instead.
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent(
  "file entry: an unsettled top-level await warns and exits 13",
  async () => {
    using dir = tempDir("unsettled-tla-file", {
      "entry.mjs": `await new Promise(() => {});\n`,
    });
    const { stderr, exitCode, signalCode } = await run([bunExe(), "entry.mjs"], String(dir));
    expect(signalCode).toBe(null);
    expect(stderr).toContain("Detected unsettled top-level await");
    expect(exitCode).toBe(13);
  },
  TEST_TIMEOUT_MS,
);

test.concurrent(
  "issue repro: reading an empty ReadableStream deadlocks and exits 13",
  async () => {
    using dir = tempDir("unsettled-tla-stream", {
      "entry.mjs": `
        import { ReadableStream } from 'node:stream/web';
        const reader = new ReadableStream().getReader();
        console.log(await reader.read());
      `,
    });
    const { stdout, stderr, exitCode, signalCode } = await run([bunExe(), "entry.mjs"], String(dir));
    expect(stdout).toBe("");
    expect(signalCode).toBe(null);
    expect(stderr).toContain("Detected unsettled top-level await");
    expect(exitCode).toBe(13);
  },
  TEST_TIMEOUT_MS,
);

test.concurrent(
  "-e: an unsettled top-level await warns and exits 13",
  async () => {
    const { stderr, exitCode, signalCode } = await run([bunExe(), "-e", "await new Promise(() => {})"]);
    expect(signalCode).toBe(null);
    expect(stderr).toContain("Detected unsettled top-level await");
    expect(exitCode).toBe(13);
  },
  TEST_TIMEOUT_MS,
);

test.concurrent(
  "-p: an unsettled top-level await exits 13 instead of printing a value",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await run([bunExe(), "-p", "await new Promise(() => {})"]);
    expect(stdout).toBe("");
    expect(signalCode).toBe(null);
    expect(stderr).toContain("Detected unsettled top-level await");
    expect(exitCode).toBe(13);
  },
  TEST_TIMEOUT_MS,
);

test.concurrent(
  "an imported module with an unsettled top-level await exits 13",
  async () => {
    using dir = tempDir("unsettled-tla-import", {
      "entry.mjs": `await import('./child.mjs');\nconsole.log("never");\n`,
      "child.mjs": `await new Promise(() => {});\n`,
    });
    const { stdout, stderr, exitCode, signalCode } = await run([bunExe(), "entry.mjs"], String(dir));
    expect(stdout).toBe("");
    expect(signalCode).toBe(null);
    expect(stderr).toContain("Detected unsettled top-level await");
    expect(exitCode).toBe(13);
  },
  TEST_TIMEOUT_MS,
);

// Negative cases: genuine pending work must still resolve, and a pending promise
// that is never awaited must not be mistaken for an unsettled top-level await.
test.concurrent(
  "a top-level await that settles via a timer exits 0",
  async () => {
    using dir = tempDir("settling-tla", {
      "entry.mjs": `await new Promise(r => setTimeout(r, 1));\nconsole.log("done");\n`,
    });
    const { stdout, stderr, exitCode, signalCode } = await run([bunExe(), "entry.mjs"], String(dir));
    expect(stdout).toBe("done\n");
    expect(stderr).not.toContain("unsettled");
    expect(signalCode).toBe(null);
    expect(exitCode).toBe(0);
  },
  TEST_TIMEOUT_MS,
);

test.concurrent(
  "an un-awaited pending promise does not trigger the warning",
  async () => {
    using dir = tempDir("pending-no-await", {
      "entry.mjs": `const p = new Promise(() => {});\np.then(() => {});\nconsole.log("done");\n`,
    });
    const { stdout, stderr, exitCode, signalCode } = await run([bunExe(), "entry.mjs"], String(dir));
    expect(stdout).toBe("done\n");
    expect(stderr).not.toContain("unsettled");
    expect(signalCode).toBe(null);
    expect(exitCode).toBe(0);
  },
  TEST_TIMEOUT_MS,
);
