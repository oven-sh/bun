// https://github.com/oven-sh/bun/issues/19049
//
// A test file (or entry point) whose top-level await never settles used to
// make `bun test` / `bun run` busy-spin forever once nothing remained to keep
// the event loop alive. Verify we now detect the dead loop, report it, and
// exit.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(opts: { cmd: string[]; cwd: string }) {
  await using proc = Bun.spawn({
    cmd: opts.cmd,
    env: bunEnv,
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    // Guard against regressions: the bug manifested as a hang that never
    // exits. `await using` will still kill the process if the test itself
    // times out, but this keeps the failure fast and self-contained.
    timeout: 15_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

describe.concurrent("bun test: unsettled top-level await", () => {
  test("reports an error instead of hanging (never-resolving Promise)", async () => {
    using dir = tempDir("issue-19049-test", {
      "hang.test.ts": `await new Promise(() => {});`,
    });
    const r = await run({ cmd: [bunExe(), "test", "hang.test.ts"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("Top-level await");
    expect(r.stderr).toContain("never resolved");
    expect(r.stderr).toContain("hang.test.ts");
    expect(r.stderr).toContain("1 fail");
    expect(r.exitCode).toBe(1);
  });

  test("reports an error after a pending timer fires without resolving", async () => {
    using dir = tempDir("issue-19049-timer", {
      "timer.test.ts": `await new Promise(() => setTimeout(() => {}, 50));`,
    });
    const r = await run({ cmd: [bunExe(), "test", "timer.test.ts"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("Top-level await");
    expect(r.stderr).toContain("never resolved");
    expect(r.exitCode).toBe(1);
  });

  test("continues to the next file", async () => {
    using dir = tempDir("issue-19049-multi", {
      "a.test.ts": `await new Promise(() => {});`,
      "b.test.ts": `import { test, expect } from "bun:test"; test("ok", () => expect(1).toBe(1));`,
    });
    const r = await run({ cmd: [bunExe(), "test", "a.test.ts", "b.test.ts"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("Top-level await");
    expect(r.stderr).toContain("1 pass");
    expect(r.stderr).toContain("1 fail");
    expect(r.exitCode).toBe(1);
  });

  test("an unhandled rejection in one file does not taint async TLA in a later file", async () => {
    // unhandled_error_counter persists across files; the liveness check in
    // waitForModulePromise must not short-circuit on it or b's perfectly
    // valid `await setTimeout` is misreported as "never resolved".
    using dir = tempDir("issue-19049-crossfile", {
      "a.test.ts": `import { test } from "bun:test"; Promise.reject(new Error("boom")); test("a", () => {});`,
      "b.test.ts": `import { test, expect } from "bun:test"; await new Promise(r => setTimeout(r, 10)); test("b", () => expect(1).toBe(1));`,
    });
    const r = await run({ cmd: [bunExe(), "test", "./a.test.ts", "./b.test.ts"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    // b's TLA must complete; only a's unhandled rejection is the error.
    expect(r.stderr).not.toContain("Top-level await");
    expect(r.stderr).toContain("(pass) b");
    expect(r.stderr).toContain("error: boom");
    expect(r.exitCode).toBe(1);
  });

  test("original repro: mock.module + preload", async () => {
    using dir = tempDir("issue-19049-original", {
      "preload.ts": `
import { mock } from "bun:test";
mock.module("node:http2", () => ({ default: { connect: mock() } }));
`,
      "bad.test.ts": `
import { mock } from "bun:test";
import http2 from "node:http2";

mock.module("node:http2", () => ({
  default: {
    connect: mock().mockReturnValue({
      request: mock(() => setTimeout(() => {}, 50)),
    }),
  },
}));

await new Promise(() => http2.connect("foo").request());
`,
    });
    const r = await run({
      cmd: [bunExe(), "test", "--preload", "./preload.ts", "bad.test.ts"],
      cwd: String(dir),
    });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("Top-level await");
    expect(r.stderr).toContain("never resolved");
    expect(r.exitCode).toBe(1);
  });
});

describe.concurrent("bun run: unsettled top-level await", () => {
  test("warns and exits with code 13", async () => {
    using dir = tempDir("issue-19049-run", {
      "entry.mjs": `await new Promise(() => {});\nconsole.log("unreachable");`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.stdout).not.toContain("unreachable");
    expect(r.exitCode).toBe(13);
  });

  test("warns and exits with code 13 when a sub-import has unsettled TLA", async () => {
    using dir = tempDir("issue-19049-subimport", {
      "sub.mjs": `await new Promise(() => {});`,
      "entry.mjs": `import "./sub.mjs";\nconsole.log("unreachable");`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.stdout).not.toContain("unreachable");
    expect(r.exitCode).toBe(13);
  });

  test("warns and exits with code 13 when a --preload has unsettled TLA", async () => {
    using dir = tempDir("issue-19049-preload", {
      "preload.mjs": `await new Promise(() => {});`,
      "entry.mjs": `console.log("unreachable");`,
    });
    const r = await run({ cmd: [bunExe(), "--preload", "./preload.mjs", "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.stdout).not.toContain("unreachable");
    expect(r.exitCode).toBe(13);
  });

  test("beforeExit fires first and can resolve the await", async () => {
    using dir = tempDir("issue-19049-beforeexit", {
      "entry.mjs": `
let resolve;
const p = new Promise(r => { resolve = r; });
process.on("beforeExit", () => { console.log("beforeExit"); resolve(); });
await p;
console.log("after await");
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stdout).toContain("beforeExit");
    expect(r.stdout).toContain("after await");
    expect(r.exitCode).toBe(0);
  });
});
