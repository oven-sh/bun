// https://github.com/oven-sh/bun/issues/19049
//
// A test file (or entry point) whose top-level await never settles used to
// make `bun test` / `bun run` busy-spin forever once nothing remained to keep
// the event loop alive. Verify we now detect the dead loop, report it, and
// exit, while an await on work that is merely unref'd (a timer, an idle
// connection, an unref'd child) still resolves, as it always has in Bun.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// Each test spawns a bun subprocess; under the ASAN debug build that's
// several seconds of startup per spawn, which can exceed the 5s default.
setDefaultTimeout(30_000);

async function run(opts: { cmd: string[]; cwd: string; env?: Record<string, string> }) {
  await using proc = Bun.spawn({
    cmd: opts.cmd,
    env: { ...bunEnv, ...opts.env },
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

// Sequential, not concurrent: each test spawns a bun-debug subprocess (the
// unfixed behaviour is a 100%-CPU busy-spin), and 9 of those at once on an
// ASAN build overwhelm the CI machine and hit the default per-test timeout.
describe("bun test: unsettled top-level await", () => {
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

  test("--bail bails out after an unsettled TLA failure", async () => {
    using dir = tempDir("issue-19049-bail", {
      "hang.test.ts": `await new Promise(() => {});`,
    });
    const r = await run({ cmd: [bunExe(), "test", "--bail", "hang.test.ts"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("Top-level await");
    expect(r.stderr).toContain("Bailed out after 1 failure");
    expect(r.exitCode).toBe(1);
  });

  test("a --preload with unsettled TLA is named in the error", async () => {
    using dir = tempDir("issue-19049-test-preload", {
      "preload.mjs": `await new Promise(() => {});`,
      "ok.test.ts": `import { test } from "bun:test"; test("unreachable", () => {});`,
    });
    const r = await run({ cmd: [bunExe(), "test", "--preload", "./preload.mjs", "ok.test.ts"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain(`Top-level await in preload "./preload.mjs" never resolved`);
    expect(r.stderr).toContain("Top-level await never resolved while loading");
    expect(r.stderr).not.toContain("unreachable");
    expect(r.exitCode).toBe(1);
  });

  test("an await on an unref'd timer still resolves", async () => {
    using dir = tempDir("issue-19049-test-unref", {
      "unref.test.ts": `
import { test, expect } from "bun:test";
const fired = await new Promise(resolve => setTimeout(() => resolve(true), 20).unref());
test("fired", () => expect(fired).toBe(true));
`,
    });
    const r = await run({ cmd: [bunExe(), "test", "unref.test.ts"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).not.toContain("Top-level await");
    expect(r.stderr).toContain("1 pass");
    expect(r.exitCode).toBe(0);
  });
});

describe("bun run: unsettled top-level await", () => {
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

  test("warning names the stalled module, not the entry", async () => {
    using dir = tempDir("issue-19049-deep", {
      "leaf.mjs": `await new Promise(() => {});`,
      "mid.mjs": `import "./leaf.mjs";`,
      "entry.mjs": `import "./mid.mjs";`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("unsettled top-level await");
    // The warning should point at leaf.mjs (the module actually suspended
    // on its own await), not the entry or the intermediate import.
    expect(r.stderr).toContain("leaf.mjs");
    expect(r.stderr).not.toContain("entry.mjs");
    expect(r.stderr).not.toContain("mid.mjs");
    expect(r.exitCode).toBe(13);
  });

  test("one warning line per stalled sibling module", async () => {
    using dir = tempDir("issue-19049-siblings", {
      "a.mjs": `await new Promise(() => {});`,
      "b.mjs": `await new Promise(() => {});`,
      "entry.mjs": `import "./a.mjs";\nimport "./b.mjs";`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    // Both siblings are stalled on their own await; each gets its own
    // warning line, like Node. (Module-map order is not source order, so
    // don't assert which comes first.)
    const warnings = r.stderr.split(/\r?\n/).filter(l => l.includes("Detected unsettled top-level await"));
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain("a.mjs");
    expect(warnings.join("\n")).toContain("b.mjs");
    expect(r.exitCode).toBe(13);
  });

  test("warns and exits with code 13 when a --preload has unsettled TLA", async () => {
    using dir = tempDir("issue-19049-preload", {
      "preload.mjs": `await new Promise(() => {});`,
      "entry.mjs": `console.log("unreachable");`,
    });
    const r = await run({ cmd: [bunExe(), "--preload", "./preload.mjs", "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    // The error should name the preload, not just the entry.
    expect(r.stderr).toContain(`Top-level await in preload "./preload.mjs" never resolved`);
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.stdout).not.toContain("unreachable");
    expect(r.exitCode).toBe(13);
  });

  test("a dynamic-import cycle that deadlocks on its own await exits 13", async () => {
    using dir = tempDir("issue-19049-cycle", {
      "a.mjs": `import "./b.mjs";`,
      "b.mjs": `console.log("B_BEFORE");\nawait import("./a.mjs");\nconsole.log("B_AFTER");`,
    });
    const r = await run({ cmd: [bunExe(), "a.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stdout).toBe("B_BEFORE\n");
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test("process.on('exit') sees code 13", async () => {
    using dir = tempDir("issue-19049-exit-listener", {
      "entry.mjs": `
process.on("exit", code => console.log("exit", code, process.exitCode));
await new Promise(() => {});
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stdout).toBe("exit 13 13\n");
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test("an explicit process.exitCode wins and there is no warning", async () => {
    // Node skips the unsettled-await check once the exit code is already decided.
    using dir = tempDir("issue-19049-exitcode", {
      "entry.mjs": `
process.on("exit", code => console.log("exit", code, process.exitCode));
process.exitCode = 42;
await new Promise(() => {});
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual({
      stdout: "exit 42 42\n",
      stderr: "",
      exitCode: 42,
    });
  });

  test("an unhandled rejection next to a dead await exits 1 without the warning", async () => {
    using dir = tempDir("issue-19049-rejection", {
      "entry.mjs": `
Promise.reject(new Error("boom"));
await new Promise(() => {});
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("boom");
    expect(r.stderr).not.toContain("unsettled top-level await");
    expect(r.exitCode).toBe(1);
  });

  test("a worker's process.exit() does not settle the main thread's await", async () => {
    using dir = tempDir("issue-19049-worker", {
      "entry.mjs": `
import { Worker, isMainThread } from "worker_threads";
if (isMainThread) {
  new Worker(new URL(import.meta.url));
  await new Promise(() => {});
} else {
  process.exit();
}
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test("beforeExit fires once when the resolved module finishes without new work", async () => {
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
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual({
      stdout: "beforeExit\nafter await\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("beforeExit fires again when the resolved module schedules more work", async () => {
    using dir = tempDir("issue-19049-beforeexit-again", {
      "entry.mjs": `
let resolve;
process.on("beforeExit", () => { console.log("beforeExit"); resolve(); });
await new Promise(r => { resolve = r; });
console.log("resumed");
await new Promise(r => setTimeout(r, 20));
console.log("done");
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual({
      stdout: "beforeExit\nresumed\ndone\nbeforeExit\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("beforeExit can reject the await and the rejection is reported", async () => {
    using dir = tempDir("issue-19049-beforeexit-reject", {
      "entry.mjs": `
let reject;
process.on("beforeExit", () => reject(new Error("Xyz")));
await new Promise((_, r) => { reject = r; });
console.log("unreachable");
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Xyz");
    expect(r.exitCode).toBe(1);
  });

  test("--print with unsettled TLA warns without printing the internal promise", async () => {
    using dir = tempDir("issue-19049-print", {});
    const r = await run({ cmd: [bunExe(), "-p", "await new Promise(() => {})"], cwd: String(dir) });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("unsettled top-level await");
    // `entry_point_result` holds the module pipeline's internal promise when
    // the module never settles; it must not leak to stdout as
    // "Promise { <pending> }".
    expect(r.stdout).toBe("");
    expect(r.exitCode).toBe(13);
  });

  test("--print still prints settled TLA values and user pending promises", async () => {
    using dir = tempDir("issue-19049-print-ok", {});
    const settled = await run({ cmd: [bunExe(), "-p", "await Promise.resolve(42)"], cwd: String(dir) });
    expect(settled.stdout).toBe("42\n");
    expect(settled.exitCode).toBe(0);
    // A pending promise the *user* evaluated to (the module itself settles)
    // still prints, matching `node -p`.
    const userPending = await run({ cmd: [bunExe(), "-p", "new Promise(() => {})"], cwd: String(dir) });
    expect(userPending.stdout).toBe("Promise { <pending> }\n");
    expect(userPending.exitCode).toBe(0);
  });
});

// Unlike Node (which exits 13 here), Bun waits for work that is registered
// but unref'd; detection only triggers when nothing at all is left that could
// fire. These pin that, and that the wait parks instead of spinning a core.
describe("bun run: awaits on unref'd work still resolve", () => {
  test("unref'd setTimeout fires, without busy-waiting", async () => {
    using dir = tempDir("issue-19049-unref-timer", {
      "entry.mjs": `
const before = process.cpuUsage();
await new Promise(resolve => setTimeout(resolve, 300).unref());
const { user, system } = process.cpuUsage(before);
console.log(JSON.stringify({ cpuMs: (user + system) / 1000 }));
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect(r.stderr).toBe("");
    // A busy-wait burns the whole 300ms of wall time as CPU; parking burns a
    // few wake-ups' worth. 50% leaves room for GC threads on a loaded ASAN
    // lane, matching the other cpuUsage()-based spin tests in the tree.
    expect(JSON.parse(r.stdout).cpuMs).toBeLessThan(150);
    expect(r.exitCode).toBe(0);
  });

  test("AbortSignal.timeout fires", async () => {
    using dir = tempDir("issue-19049-unref-abort", {
      "entry.mjs": `
const reason = await new Promise(resolve => {
  const signal = AbortSignal.timeout(10);
  signal.addEventListener("abort", () => resolve(signal.reason.name));
});
console.log(reason);
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual({
      stdout: "TimeoutError\n",
      stderr: "",
      exitCode: 0,
    });
  });

  const unrefChild = {
    "entry.mjs": `
const child = Bun.spawn({ cmd: [process.execPath, "-e", ""], stdio: ["ignore", "ignore", "ignore"] });
child.unref();
console.log("exit code", await child.exited);
`,
  };
  const resolved = { stdout: "exit code 0\n", stderr: "", exitCode: 0 };

  test("an unref'd child process's exit is still observed", async () => {
    using dir = tempDir("issue-19049-unref-child", unrefChild);
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual(resolved);
  });

  // Kernels and sandboxes without pidfd watch children from a helper thread
  // instead of a poll; the child must still count as registered there.
  test.skipIf(!isLinux)("an unref'd child watched by the waiter thread is still observed", async () => {
    using dir = tempDir("issue-19049-unref-child-waiter", unrefChild);
    const r = await run({
      cmd: [bunExe(), "entry.mjs"],
      cwd: String(dir),
      env: { BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "1" },
    });
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual(resolved);
  });

  test.skipIf(!isLinux)("reaped waiter-thread children no longer count as pending work", async () => {
    using dir = tempDir("issue-19049-waiter-balance", {
      "entry.mjs": `
for (let i = 0; i < 3; i++) {
  const child = Bun.spawn({ cmd: [process.execPath, "-e", ""], stdio: ["ignore", "ignore", "ignore"] });
  child.unref();
  await child.exited;
}
await new Promise(() => {});
`,
    });
    const r = await run({
      cmd: [bunExe(), "entry.mjs"],
      cwd: String(dir),
      env: { BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "1" },
    });
    expect(r.signalCode).toBeNull();
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test("a module resumed by beforeExit can go on to await unref'd work", async () => {
    using dir = tempDir("issue-19049-beforeexit-unref", {
      "entry.mjs": `
const { promise, resolve } = Promise.withResolvers();
process.on("beforeExit", resolve);
await promise;
await new Promise(r => setTimeout(r, 10).unref());
console.log("done");
`,
    });
    const r = await run({ cmd: [bunExe(), "entry.mjs"], cwd: String(dir) });
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual({
      stdout: "done\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
