// When only unref'd timers remain but a driver is still spinning the event
// loop waiting on a JS-visible condition (bun:test awaiting a test body,
// wait_for_promise, top-level await in the entrypoint, the --hot/--watch
// loaders), those drivers hold a uSockets-loop ref for their duration so
// auto_tick takes its active branch and parks on the next timer-heap
// deadline. Without that ref the idle branch is a non-blocking pump that
// busy-spins the driver on POSIX and on Windows never runs due timers
// (uv_run skips them when the loop has no ref'd handles).
//
// Every test here spawns a child: the behavior under test is the *child's*
// drive loop, and a regression is a child that hangs (Windows) or burns CPU
// (POSIX), neither of which an in-process test could report — bun:test's own
// per-test timeout lives in the same timer heap that stops draining.
import { expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A child that reports the CPU it burned across an await of an unref'd timer.
// Unfixed, the driver busy-spins for the whole wait (CPU tracks wall time);
// fixed, it parks and CPU stays near zero. Measuring CPU (not wall time) keeps
// the assertion meaningful on both POSIX (spin) and Windows (hang).
const CPU_PROBE = (body: string) => `const cpu0 = process.cpuUsage();
${body}
const cpu = process.cpuUsage(cpu0);
console.log(JSON.stringify({ fired, cpuMs: Math.round((cpu.user + cpu.system) / 1000) }));`;

const AWAIT_UNREFD_TIMER = `const fired = await new Promise(resolve => {
  setTimeout(() => resolve(true), 2000).unref();
});`;

async function run(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

// Parses the JSON line the CPU probe printed and asserts the timer fired
// without the driver spinning. A hung child (the Windows regression) produces
// no such line and a non-null signalCode once the parent tears it down.
function expectParkedNotSpun({ stdout, exitCode, signalCode }: Awaited<ReturnType<typeof run>>) {
  expect({ signalCode, exitCode }).toEqual({ signalCode: null, exitCode: 0 });
  const line = stdout.trim().split("\n").at(-1) ?? "";
  const { fired, cpuMs } = JSON.parse(line || "null") ?? {};
  expect(fired).toBe(true);
  expect(cpuMs).toBeLessThan(1000);
}

// `bun test` children print their banner on stdout and their report on stderr.
function expectTestRunnerPassed({ stderr }: Awaited<ReturnType<typeof run>>) {
  expect({ pass: stderr.includes("1 pass"), fail: stderr.includes("0 fail") }).toEqual({ pass: true, fail: true });
}

it.concurrent("bun:test drive loop: unref'd setTimeout fires without spinning", async () => {
  using dir = tempDir("unref-timer-buntest", {
    "x.test.ts": `import { test, expect } from "bun:test";
      test("unref'd setTimeout", async () => {
        ${CPU_PROBE(AWAIT_UNREFD_TIMER)}
        expect(fired).toBe(true);
      });`,
  });
  const res = await run([bunExe(), "test", "x.test.ts"], String(dir));
  expectTestRunnerPassed(res);
  expectParkedNotSpun(res);
});

it.concurrent("bun:test drive loop: unref'd setInterval fires without spinning", async () => {
  using dir = tempDir("unref-interval-buntest", {
    "x.test.ts": `import { test, expect } from "bun:test";
      test("unref'd setInterval", async () => {
        ${CPU_PROBE(`const fired = await new Promise(resolve => {
          const t = setInterval(() => { clearInterval(t); resolve(true); }, 2000);
          t.unref();
        });`)}
        expect(fired).toBe(true);
      });`,
  });
  const res = await run([bunExe(), "test", "x.test.ts"], String(dir));
  expectTestRunnerPassed(res);
  expectParkedNotSpun(res);
});

it.concurrent("wait_for_promise: unref'd setTimeout fires under top-level await", async () => {
  // Divergence from Node >= 22, tracked in https://github.com/oven-sh/bun/issues/33283:
  // Node prints "Detected unsettled top-level await" and exits 13 instead of waiting.
  // Flip the stderr/exitCode assertions below when Bun implements that detection.
  const res = await run([bunExe(), "-e", CPU_PROBE(AWAIT_UNREFD_TIMER)]);
  expect(res.stderr).toBe("");
  expectParkedNotSpun(res);
});

it.concurrent("--hot entry loader: unref'd setTimeout fires without spinning", async () => {
  // The watcher branch of `load_entry_point` is its own inlined drive loop.
  // `bun test --watch` uses a byte-identical loop, so this covers both.
  using dir = tempDir("unref-timer-hot", {
    "entry.ts": `${CPU_PROBE(AWAIT_UNREFD_TIMER)}
      process.exit(0);`,
  });
  const res = await run([bunExe(), "--hot", "entry.ts"], String(dir));
  expect(res.stderr).toBe("");
  expectParkedNotSpun(res);
});

it.concurrent("--preload loader: unref'd setTimeout fires without spinning", async () => {
  // `load_preloads`' watcher branch is a third copy of the same drive loop.
  using dir = tempDir("unref-timer-preload", {
    "p.ts": CPU_PROBE(AWAIT_UNREFD_TIMER),
    "main.ts": `process.exit(0);`,
  });
  const res = await run([bunExe(), "--hot", "--preload", "./p.ts", "main.ts"], String(dir));
  expect(res.stderr).toBe("");
  expectParkedNotSpun(res);
});

it.concurrent("Worker: the loop ref does not defeat unsettled-TLA exit", async () => {
  // wait_for_promise_with_termination breaks on !is_event_loop_alive(), which
  // reads the same counter ref_loop_scoped bumps; the guard is scoped to
  // auto_tick so that check reads the real ref state. A Worker whose module
  // promise never settles must still exit promptly, not park indefinitely.
  // (Node 26.3 exits 13 here; see worker-top-level-await.test.ts.)
  using dir = tempDir("unref-timer-worker", {
    "worker.ts": `setTimeout(() => {}, 60_000).unref();
      await new Promise(() => {});`,
    "main.ts": `const t0 = performance.now();
      const w = new Worker(new URL("./worker.ts", import.meta.url).href);
      w.addEventListener("close", () => {
        console.log(JSON.stringify({ ms: Math.round(performance.now() - t0) }));
        process.exit(0);
      });`,
  });
  const res = await run([bunExe(), "main.ts"], String(dir));
  expect({ signalCode: res.signalCode, exitCode: res.exitCode }).toEqual({ signalCode: null, exitCode: 0 });
  const { ms } = JSON.parse(res.stdout.trim().split("\n").at(-1) ?? "null") ?? {};
  expect(ms).toBeLessThan(5000);
});

// The loop ref also makes is_event_loop_alive*() true for the driver's scope.
// That is JS-visible: an unref'd setImmediate is dropped without running only
// when the loop looks dead, so one scheduled inside a guarded driver now runs.
// Node's node:test runner refs the loop and behaves the same way.
it.concurrent("unref'd setImmediate runs inside a bun:test test body", async () => {
  using dir = tempDir("unref-immediate-buntest", {
    "x.test.ts": `import { test, expect } from "bun:test";
      test("unref'd setImmediate", async () => {
        const ran = await new Promise(resolve => {
          setImmediate(() => resolve(true)).unref();
          // unref'd so it cannot itself keep the loop alive and mask the gate
          setTimeout(() => resolve(false), 1000).unref();
        });
        expect(ran).toBe(true);
      });`,
  });
  const res = await run([bunExe(), "test", "x.test.ts"], String(dir));
  expectTestRunnerPassed(res);
  expect(res.exitCode).toBe(0);
});

it.concurrent("unref'd setImmediate runs inside a preload", async () => {
  using dir = tempDir("unref-immediate-preload", {
    "p.ts": `const ran = await new Promise(resolve => {
      setImmediate(() => resolve(true)).unref();
      // unref'd so it cannot itself keep the loop alive and mask the gate
      setTimeout(() => resolve(false), 1000).unref();
    });
    console.log(ran ? "ran" : "dropped");`,
    "main.ts": `process.exit(0);`,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "--preload", "./p.ts", "main.ts"], String(dir));
  expect(stderr).toBe("");
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ran", exitCode: 0 });
});

it.concurrent("awaiting setImmediate exits promptly with a long unref'd timer pending", async () => {
  // The driver's ref keeps the loop active after the setImmediate drops its
  // own ref, so the wait ends on the immediate rather than parking until the
  // unrelated 60s deadline. Matches Node.
  const { stdout, stderr, exitCode, signalCode } = await run([
    bunExe(),
    "-e",
    `setTimeout(() => {}, 60000).unref();
     await new Promise(resolve => setImmediate(resolve));
     console.log("done");`,
  ]);
  expect(stderr).toBe("");
  expect({ stdout: stdout.trim(), exitCode, signalCode }).toEqual({ stdout: "done", exitCode: 0, signalCode: null });
});

it.concurrent("unref'd timers still do not keep the process alive", async () => {
  // The guard is scoped to the driver, so exit semantics are unchanged.
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    "-e",
    `process.on("beforeExit", () => console.log("beforeExit"));
     setTimeout(() => console.log("BAD: unref'd timer kept the loop alive"), 1000000).unref();
     setInterval(() => console.log("BAD: unref'd interval kept the loop alive"), 1000000).unref();`,
  ]);
  expect(stderr).toBe("");
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "beforeExit", exitCode: 0 });
});
