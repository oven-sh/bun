import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// A cron schedule has one-minute resolution, so a job driven by the real clock
// waits up to 60s for the next boundary. Bun.cron() anchors its schedule to the
// jest fake clock when one is active, so every firing test below advances that
// clock instead of waiting. Child processes drive their own fake clock: bun:test
// loads outside the test runner too.
const T0 = new Date("2026-01-01T12:00:00.000Z");
const minute = (n: number) => new Date(T0.getTime() + n * 60_000).toISOString();
const mockClock = `
  const { jest } = require("bun:test");
  jest.useFakeTimers({ now: new Date(${JSON.stringify(T0.toISOString())}) });
`;

async function output(proc: Bun.ReadableSubprocess) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("Bun.cron (in-process)", () => {
  test.each([
    ["invalid expr", "Invalid cron expression: expected 5 space-separated fields (minute hour day month weekday)"],
    ["* * * *", "Invalid cron expression: expected 5 space-separated fields (minute hour day month weekday)"],
    ["60 * * * *", "Invalid cron expression: value out of range for field"],
    // Feb 30 never exists
    ["0 0 30 2 *", "Cron expression '0 0 30 2 *' has no future occurrences"],
  ])("rejects %j", (expr, message) => {
    expect(() => Bun.cron(expr, () => {})).toThrow(message);
  });

  test("validates schedule is a string", () => {
    // @ts-expect-error
    expect(() => Bun.cron(123, () => {})).toThrow("Bun.cron() expects a string cron expression");
  });

  test.each(["* * * * *", "@hourly", "0 9 * JAN-DEC MON-FRI"])(
    "cron getter returns the schedule as written: %j",
    expr => {
      using job = Bun.cron(expr, () => {});
      expect(job.cron).toBe(expr);
    },
  );

  test("returns a CronJob handle, not a Promise", () => {
    // Callable 2nd arg is the in-process overload; the OS-level overload returns a Promise.
    using job = Bun.cron("* * * * *", () => {});
    expect(job).not.toBeInstanceOf(Promise);
    expect(Object.prototype.toString.call(job)).toBe("[object CronJob]");
    expect(Bun.inspect(job)).toMatchInlineSnapshot(`
      "CronJob {
        cron: "* * * * *",
        ref: [Function: ref],
        stop: [Function: stop],
        unref: [Function: unref],
        [Symbol(Symbol.dispose)]: [Function: dispose],
      }"
    `);
  });

  test("stop(), ref() and unref() return the job; stop() is idempotent", () => {
    const job = Bun.cron("* * * * *", () => {});
    expect(job.unref()).toBe(job);
    expect(job.ref()).toBe(job);
    expect(job.stop()).toBe(job);
    expect(job.stop()).toBe(job);
  });
});

describe("Bun.cron (in-process) firing under fake timers", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  // useRealTimers() drops every job still in the fake heap and stops it.
  afterEach(() => {
    jest.useRealTimers();
  });

  test("fires at each minute boundary with this === job and no arguments", () => {
    const fired: { at: string; self: boolean; args: number }[] = [];
    using job = Bun.cron("* * * * *", function (...args) {
      fired.push({ at: new Date().toISOString(), self: this === job, args: args.length });
    });

    jest.advanceTimersByTime(59_999);
    expect(fired).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(fired).toEqual([{ at: minute(1), self: true, args: 0 }]);

    // Re-arms for the next minute; never double-fires at the same boundary
    jest.advanceTimersByTime(60_000);
    expect(fired).toEqual([
      { at: minute(1), self: true, args: 0 },
      { at: minute(2), self: true, args: 0 },
    ]);
  });

  test("@hourly fires at the top of the next hour", () => {
    const firedAt: string[] = [];
    using job = Bun.cron("@hourly", () => void firedAt.push(new Date().toISOString()), { tz: "UTC" });

    jest.advanceTimersByTime(60 * 60_000 - 1);
    expect(firedAt).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(firedAt).toEqual(["2026-01-01T13:00:00.000Z"]);
  });

  test("stop() before the first fire cancels the job", () => {
    let fires = 0;
    const job = Bun.cron("* * * * *", () => void fires++);
    job.stop();

    jest.advanceTimersByTime(120_000);
    expect(fires).toBe(0);
  });

  test("stop() after a fire prevents further fires", () => {
    let fires = 0;
    const job = Bun.cron("* * * * *", () => void fires++);

    jest.advanceTimersByTime(60_000);
    expect(fires).toBe(1);

    job.stop();
    jest.advanceTimersByTime(120_000);
    expect(fires).toBe(1);
  });

  test("Symbol.dispose stops the job", () => {
    let fires = 0;
    let disposed!: Bun.CronJob;
    {
      using job = Bun.cron("* * * * *", () => void fires++);
      disposed = job;
      expect(typeof job[Symbol.dispose]).toBe("function");
    }

    jest.advanceTimersByTime(120_000);
    expect(fires).toBe(0);
    // stop() after dispose is a no-op that still returns the job
    expect(disposed.stop()).toBe(disposed);
  });

  test("stopping one job leaves another running", () => {
    const fires = { a: 0, b: 0 };
    using a = Bun.cron("* * * * *", () => void fires.a++);
    using b = Bun.cron("* * * * *", () => void fires.b++);
    expect(a).not.toBe(b);

    a.stop();
    jest.advanceTimersByTime(60_000);
    expect(fires).toEqual({ a: 0, b: 1 });
  });

  test("a pending async tick is not overlapped; the job re-arms once it settles", async () => {
    const gate = Promise.withResolvers<void>();
    const firedAt: string[] = [];
    using job = Bun.cron("* * * * *", async () => {
      firedAt.push(new Date().toISOString());
      await gate.promise;
    });

    jest.advanceTimersByTime(60_000);
    expect(firedAt).toEqual([minute(1)]);

    // Three more boundaries pass while the first tick is still pending.
    jest.advanceTimersByTime(180_000);
    expect(firedAt).toEqual([minute(1)]);

    gate.resolve();
    // setImmediate is not faked: one real turn lets the tick settle.
    await new Promise(resolve => setImmediate(resolve));

    // The next fire is the first boundary after the settle, not 60s after the first fire.
    jest.advanceTimersByTime(59_999);
    expect(firedAt).toEqual([minute(1)]);
    jest.advanceTimersByTime(1);
    expect(firedAt).toEqual([minute(1), minute(5)]);
  });

  test("async callback: stop() during await prevents reschedule", async () => {
    let fires = 0;
    const gate = Promise.withResolvers<void>();
    const job = Bun.cron("* * * * *", async () => {
      fires++;
      await gate.promise;
    });

    jest.advanceTimersByTime(60_000);
    expect(fires).toBe(1);

    job.stop();
    gate.resolve();
    await new Promise(resolve => setImmediate(resolve));

    jest.advanceTimersByTime(120_000);
    expect(fires).toBe(1);
  });

  test("unreferenced running job survives GC", () => {
    let fires = 0;
    // Nothing in JS holds the handle; the native side keeps the wrapper alive while scheduled.
    Bun.cron("* * * * *", () => void fires++).unref();
    Bun.gc(true);
    Bun.gc(true);

    jest.advanceTimersByTime(60_000);
    expect(fires).toBe(1);
  });
});

describe.concurrent("Bun.cron (in-process) subprocess", () => {
  // The unref'd 50ms timer never holds the event loop open on its own, so it
  // runs, and logs "stopped", only while the job keeps the process alive.
  test.each([
    ["a ref'd job (the default) keeps the process alive", "", "scheduled\nstopped\n"],
    ["unref() lets the process exit", "job.unref();", "scheduled\n"],
    ["ref() after unref() keeps the process alive again", "job.unref().ref();", "scheduled\nstopped\n"],
    ["ref() after stop() does not keep the process alive", "job.stop().ref();", "scheduled\n"],
  ])("%s", async (_name, setup, stdout) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const job = Bun.cron("* * * * *", () => {});
        ${setup}
        console.log("scheduled");
        setTimeout(() => { job.stop(); console.log("stopped"); }, 50).unref();
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    expect(await output(proc)).toEqual({ stdout, stderr: "", exitCode: 0 });
  });

  test("sync throw emits uncaughtException and the job keeps running", async () => {
    // Matches setTimeout: a sync throw is an uncaughtException. With a listener
    // installed the job is not stopped by the failure.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        mockClock +
          `
        const events = [];
        process.on("uncaughtException", e => events.push(e.message + "@" + new Date().toISOString()));
        const job = Bun.cron("* * * * *", () => { throw new Error("sync-boom"); });
        jest.advanceTimersByTime(120_000);
        job.stop();
        console.log(JSON.stringify(events));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    expect(await output(proc)).toEqual({
      stdout: JSON.stringify([`sync-boom@${minute(1)}`, `sync-boom@${minute(2)}`]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("async throw emits unhandledRejection with the promise and the job keeps running", async () => {
    // Matches setTimeout: a rejected returned promise is an unhandledRejection.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        mockClock +
          `
        const events = [];
        process.on("unhandledRejection", (e, p) => {
          events.push(e.message + ":" + (p instanceof Promise) + "@" + new Date().toISOString());
        });
        const job = Bun.cron("* * * * *", async () => {
          await Bun.sleep(1); // a fake timer as well
          throw new Error("async-boom");
        });
        // Fires at 12:01:00 and resolves the sleep at 12:01:00.001. The
        // rejection surfaces in the microtask drain of the next real turn,
        // and only then does the job re-arm.
        jest.advanceTimersByTime(60_001);
        await new Promise(resolve => setImmediate(resolve));
        jest.advanceTimersByTime(60_000);
        await new Promise(resolve => setImmediate(resolve));
        job.stop();
        console.log(JSON.stringify(events));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    expect(await output(proc)).toEqual({
      stdout:
        JSON.stringify(["async-boom:true@2026-01-01T12:01:00.001Z", "async-boom:true@2026-01-01T12:02:00.001Z"]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("stop() while async callback pending still surfaces unhandledRejection with promise", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        mockClock +
          `
        const events = [];
        process.on("unhandledRejection", (e, p) => events.push(e.message + ":" + (p instanceof Promise)));
        let job = Bun.cron("* * * * *", async () => {
          job.stop();
          job = null;
          Bun.gc(true);
          Bun.gc(true);
          await Bun.sleep(10);
          throw new Error("after-stop");
        });
        jest.advanceTimersByTime(60_000);
        // The tick has returned; only the pending promise keeps the wrapper
        // alive now. GC again, then resolve the sleep so the callback rejects.
        Bun.gc(true);
        jest.advanceTimersByTime(10);
        await new Promise(resolve => setImmediate(resolve));
        console.log(JSON.stringify(events));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    expect(await output(proc)).toEqual({ stdout: '["after-stop:true"]\n', stderr: "", exitCode: 0 });
  });

  test("unhandled cron error exits process like setTimeout does", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        mockClock +
          `
        Bun.cron("* * * * *", () => { throw new Error("boom"); });
        jest.advanceTimersByTime(60_000);
        // The loop does not run on after an uncaught error: this real timer never fires.
        jest.useRealTimers();
        setTimeout(() => console.log("still alive"), 10);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const { stdout, stderr, exitCode } = await output(proc);
    expect(stderr).toContain("error: boom");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test("worker terminate while async callback pending releases cleanly", async () => {
    using dir = tempDir("cron-worker", {
      "worker.ts":
        mockClock +
        `
        Bun.cron("* * * * *", async () => {
          self.postMessage("fired");
          await new Promise(() => {}); // never settles
        });
        jest.advanceTimersByTime(60_000);
      `,
    });
    // Wait for "close" before forcing GC so main-VM destruct-on-exit (ASAN
    // CI sets BUN_DESTRUCT_VM_ON_EXIT=1) does not race the worker thread's
    // own teardown: terminate() returns before the worker finishes.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const w = new Worker("./worker.ts");
        w.onmessage = () => w.terminate();
        w.addEventListener("close", () => {
          Bun.gc(true);
          console.log("ok");
        });
      `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    expect(await output(proc)).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  });

  test("worker terminate mid-callback does not report TerminationException as uncaught", async () => {
    // The callback busy-spins after postMessage so terminate() interrupts
    // cb.call() with a TerminationException while it is still on the JS stack.
    // When the VMEntryScope unwinds, JSC clears hasTerminationRequest but
    // leaves the exception pending; cron's catch block must not hand that to
    // uncaughtException(), or the lazy process-object init asserts in
    // VMTraps::deferTerminationSlow. A worker "error" event here means cron
    // routed the TerminationException through uncaughtException, the
    // regression this guards against. One worker per process: the fake clock
    // is process-wide, so several workers driving it would race each other.
    using dir = tempDir("cron-worker-term", {
      "worker.ts":
        mockClock +
        `
        Bun.cron("* * * * *", () => {
          self.postMessage("fired");
          while (true) { for (let i = 0; i < 1e6; i++); }
        });
        jest.advanceTimersByTime(60_000);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const events = [];
        const w = new Worker("./worker.ts");
        w.addEventListener("message", e => { events.push("message:" + e.data); w.terminate(); });
        w.addEventListener("error", e => events.push("error:" + e.message));
        w.addEventListener("close", () => console.log(JSON.stringify(events)));
      `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    expect(await output(proc)).toEqual({ stdout: '["message:fired"]\n', stderr: "", exitCode: 0 });
  });

  test("--hot reload clears jobs deleted from source and arms the ones that remain", async () => {
    // Markers live OUTSIDE the --hot-watched dir so inotify doesn't deliver
    // a write event that races process.exit() teardown (watcher/exit race).
    using markers = tempDir("cron-hot-markers", {});
    const m = (f: string) => join(String(markers), f);
    using dir = tempDir("cron-hot", {
      "app.ts":
        mockClock +
        `
        import { writeFileSync } from "node:fs";
        const m = process.env.MARKERS;
        writeFileSync(m + "/v1.evaluated", "");
        Bun.cron("* * * * *", () => writeFileSync(m + "/ghost.fired", ""));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "app.ts"],
      env: { ...bunEnv, MARKERS: String(markers) },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const stderrP = proc.stderr.text();
    const waitFor = async (file: string) => {
      while (!(await Bun.file(m(file)).exists())) {
        // A crashed child (SIGABRT from a panic) has exitCode null and only
        // signalCode set; without this check the loop spins to the test timeout.
        if (proc.exitCode !== null || proc.signalCode !== null)
          throw new Error(`subprocess exited ${proc.exitCode ?? proc.signalCode} before ${file}: ${await stderrP}`);
        await Bun.sleep(10);
      }
    };

    await waitFor("v1.evaluated");

    // Delete the ghost cron and register a new one. The fake clock is still
    // the one v1 set up, so v2 sees how many timers survived the reload,
    // then advances to the first boundary: its own job must fire, and v1's
    // job would fire too were it still armed.
    await Bun.write(
      join(String(dir), "app.ts"),
      `
        import { writeFileSync, existsSync } from "node:fs";
        const { jest } = require("bun:test");
        const m = process.env.MARKERS;
        writeFileSync(m + "/v2.evaluated", "");
        let result;
        try {
          const timers = jest.getTimerCount();
          let fired = null;
          Bun.cron("* * * * *", () => { fired = new Date().toISOString(); });
          jest.advanceTimersByTime(60_000);
          result = { timers, fired, ghost: existsSync(m + "/ghost.fired") };
        } catch (e) {
          result = { error: String(e) };
        }
        writeFileSync(m + "/result", JSON.stringify(result));
        process.exit(0);
      `,
    );

    await waitFor("v2.evaluated");
    const [exitCode, stderr] = await Promise.all([proc.exited, stderrP]);
    // Debug builds log "DEBUG: Reloading..." here, so stderr is shown but not asserted on.
    if (exitCode !== 0) console.error(stderr);
    const result = (await Bun.file(m("result")).exists()) ? await Bun.file(m("result")).json() : null;
    expect({ exitCode, result }).toEqual({ exitCode: 0, result: { timers: 0, fired: minute(1), ghost: false } });
  });
});
