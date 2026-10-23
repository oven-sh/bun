import { $, SQL } from "bun";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

describe("Bun.cron (in-process)", () => {
  test("validates cron expression", () => {
    expect(() => Bun.cron("invalid expr", () => {})).toThrow(/Invalid cron expression/);
    expect(() => Bun.cron("* * * *", () => {})).toThrow(/Invalid cron expression/);
    expect(() => Bun.cron("60 * * * *", () => {})).toThrow(/Invalid cron expression/);
  });

  test("validates schedule is a string", () => {
    // @ts-expect-error
    expect(() => Bun.cron(123, () => {})).toThrow(/string cron expression/);
  });

  test("rejects expressions with no future occurrences", () => {
    // Feb 30 never exists
    expect(() => Bun.cron("0 0 30 2 *", () => {})).toThrow(/no future occurrences/);
  });

  test("returns CronJob with cron getter", () => {
    using job = Bun.cron("* * * * *", () => {});
    expect(job.cron).toBe("* * * * *");
  });

  test("is Disposable", () => {
    let j!: Bun.CronJob;
    {
      using job = Bun.cron("* * * * *", () => {});
      j = job;
      expect(typeof job[Symbol.dispose]).toBe("function");
    }
    // Disposed at scope exit; stop() is idempotent so this is just a smoke check
    expect(() => j.stop()).not.toThrow();
  });

  test("[Symbol.dispose] is named [Symbol.dispose], and is writable, configurable and not enumerable", () => {
    using job = Bun.cron("* * * * *", () => {});
    const { value, ...attributes } = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(job), Symbol.dispose)!;
    expect({ name: value.name, length: value.length, ...attributes }).toEqual({
      name: "[Symbol.dispose]",
      length: 0,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  test("stop() cancels before first fire", () => {
    let called = false;
    const job = Bun.cron("* * * * *", () => {
      called = true;
    });
    job.stop();
    // stop() returns immediately; callback was never scheduled to run
    expect(called).toBe(false);
  });

  test("stop() is idempotent", () => {
    const job = Bun.cron("* * * * *", () => {});
    expect(() => {
      job.stop();
      job.stop();
      job.stop();
    }).not.toThrow();
  });

  test("ref()/unref() are chainable", () => {
    using job = Bun.cron("* * * * *", () => {});
    expect(job.unref()).toBe(job);
    expect(job.ref()).toBe(job);
    expect(job.stop()).toBe(job);
  });

  test("multiple jobs coexist independently", () => {
    using a = Bun.cron("* * * * *", () => {});
    using b = Bun.cron("* * * * *", () => {});
    expect(a).not.toBe(b);
    a.stop();
    // b is still a valid handle after stopping a
    expect(typeof b.stop).toBe("function");
  });

  test("accepts @nicknames", () => {
    using job = Bun.cron("@hourly", () => {});
    expect(job.cron).toBe("@hourly");
  });

  test("supports named weekdays and months", () => {
    using job = Bun.cron("0 9 * JAN-DEC MON-FRI", () => {});
    expect(job.cron).toBe("0 9 * JAN-DEC MON-FRI");
  });

  test("keeps process alive by default; unref() allows exit", async () => {
    // ref'd: process stays alive (would block forever), so we spawn with timeout via cron
    // unref'd: process exits immediately
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const job = Bun.cron("* * * * *", () => {});
        job.unref();
        console.log("scheduled");
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stdout)).toBe("scheduled");
    expect(exitCode).toBe(0);
  });

  test("ref'd job prevents process exit", async () => {
    // The cron keeps the loop alive; we stop it after a short delay to let the process exit.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const job = Bun.cron("* * * * *", () => {});
        console.log("scheduled");
        setTimeout(() => { job.stop(); console.log("stopped"); }, 50);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stdout)).toBe("scheduled\nstopped");
    expect(exitCode).toBe(0);
  });

  test("honors jest fake timers", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
      const firedAt: number[] = [];
      using job = Bun.cron("* * * * *", () => void firedAt.push(Date.now()));

      jest.advanceTimersByTime(59_999);
      expect(firedAt).toEqual([]);

      jest.advanceTimersByTime(1);
      expect(firedAt).toEqual([new Date("2026-01-01T12:01:00.000Z").getTime()]);

      // Re-arms for the next minute; never double-fires at the same boundary
      jest.advanceTimersByTime(60_000);
      expect(firedAt).toEqual([
        new Date("2026-01-01T12:01:00.000Z").getTime(),
        new Date("2026-01-01T12:02:00.000Z").getTime(),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("stop() under fake timers prevents further fires", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
      let fires = 0;
      const job = Bun.cron("* * * * *", () => void fires++);

      jest.advanceTimersByTime(60_000);
      expect(fires).toBe(1);

      job.stop();
      jest.advanceTimersByTime(120_000);
      expect(fires).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("distinguishes callback overload from OS-level overload", () => {
    // Callable 2nd arg → in-process; 3-string-arg → OS-level.
    // We only verify the callback path here; the string path is covered elsewhere.
    using job = Bun.cron("* * * * *", () => {});
    // CronJob has stop(); Promise would not
    expect(typeof job.stop).toBe("function");
    expect(job).not.toBeInstanceOf(Promise);
  });
});

describe.concurrent("Bun.cron (in-process) — firing", () => {
  test("callback fires at minute boundary, this === job", async () => {
    let fired = 0;
    let thisInCallback: unknown;
    const { promise, resolve } = Promise.withResolvers<void>();

    using job = Bun.cron("* * * * *", function () {
      fired++;
      thisInCallback = this;
      resolve();
    });

    await promise;
    expect(fired).toBe(1);
    expect(thisInCallback).toBe(job);
  }, 70_000);

  test("async callback: stop() during await prevents reschedule", async () => {
    let fires = 0;
    const handler = Promise.withResolvers<void>();
    const fire = Promise.withResolvers<void>();

    using job = Bun.cron("* * * * *", async () => {
      fires++;
      fire.resolve();
      await handler.promise;
    });

    await fire.promise;
    expect(fires).toBe(1);
    job.stop();
    handler.resolve();
    await Promise.resolve();
    expect(fires).toBe(1);
  }, 70_000);

  test("unreferenced running job survives GC", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        Bun.cron("* * * * *", () => { console.log("fired"); process.exit(0); });
        Bun.gc(true);
        Bun.gc(true);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("fired");
    expect(exitCode).toBe(0);
  }, 70_000);

  test("ref() after stop() does not keep process alive", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const job = Bun.cron("* * * * *", () => {});
        job.stop();
        job.ref();
        console.log("done");
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("done");
    expect(exitCode).toBe(0);
  });

  test("worker terminate while async callback pending releases cleanly", async () => {
    using dir = tempDir("cron-worker", {
      "worker.ts": `
        let fired = false;
        Bun.cron("* * * * *", async () => {
          fired = true;
          self.postMessage("fired");
          await new Promise(() => {}); // never settles
        });
      `,
    });
    // Wait for "close" before forcing GC so main-VM destruct-on-exit (ASAN
    // CI sets BUN_DESTRUCT_VM_ON_EXIT=1) does not race the worker thread's
    // own teardown — terminate() returns before the worker finishes.
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
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  }, 130_000);

  test("worker terminate mid-callback does not report TerminationException as uncaught", async () => {
    // The callback busy-spins after postMessage so terminate() interrupts
    // cb.call() with a TerminationException while it's still on the JS stack.
    // When the VMEntryScope unwinds, JSC clears hasTerminationRequest but
    // leaves the exception pending; cron's catch block must not hand that to
    // uncaughtException(), or the lazy process-object init asserts in
    // VMTraps::deferTerminationSlow. Use several workers so the timing lines
    // up at least once per minute-boundary.
    using dir = tempDir("cron-worker-term", {
      "worker.ts": `
        Bun.cron("* * * * *", () => {
          self.postMessage("fired");
          while (true) { for (let i = 0; i < 1e6; i++); }
        });
      `,
      "main.ts": `
        const N = 20;
        let closed = 0, errors = 0;
        for (let i = 0; i < N; i++) {
          const w = new Worker("./worker.ts");
          w.addEventListener("message", () => w.terminate());
          // Any worker 'error' here means cron routed the TerminationException
          // through uncaughtException → WebWorker__dispatchError — the
          // regression this test guards against, independent of whether
          // VMTraps asserts are compiled in.
          w.addEventListener("error", () => errors++);
          w.addEventListener("close", () => {
            if (++closed === N) console.log("errors=" + errors);
          });
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    expect(stdout.trim()).toBe("errors=0");
    expect(exitCode).toBe(0);
  }, 130_000);

  test("sync throw in callback emits uncaughtException", async () => {
    // Matches setTimeout: sync throw → uncaughtException. Process exits 1 without a handler.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let caught;
        process.on("uncaughtException", e => { caught = e.message; });
        const job = Bun.cron("* * * * *", () => {
          setTimeout(() => { job.stop(); console.log("caught=" + caught); process.exit(0); }, 100);
          throw new Error("sync-boom");
        });
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("caught=sync-boom");
    expect(exitCode).toBe(0);
  }, 130_000);

  test("async throw in callback emits unhandledRejection", async () => {
    // Matches setTimeout: rejected promise → unhandledRejection.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let caught;
        process.on("unhandledRejection", (e, p) => { caught = e.message + ":" + (p instanceof Promise); });
        const job = Bun.cron("* * * * *", async () => {
          setTimeout(() => { job.stop(); console.log("caught=" + caught); process.exit(0); }, 100);
          await Bun.sleep(1);
          throw new Error("async-boom");
        });
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("caught=async-boom:true");
    expect(exitCode).toBe(0);
  }, 130_000);

  test("stop() while async callback pending still surfaces unhandledRejection with promise", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        process.on("unhandledRejection", (e, p) => {
          console.log("caught=" + e.message + ":" + (p instanceof Promise));
          process.exit(0);
        });
        let job = Bun.cron("* * * * *", async () => {
          job.stop();
          job = null;
          Bun.gc(true);
          Bun.gc(true);
          await Bun.sleep(10);
          throw new Error("after-stop");
        });
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("caught=after-stop:true");
    expect(exitCode).toBe(0);
  }, 70_000);

  test("unhandled cron error exits process like setTimeout does", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        Bun.cron("* * * * *", () => { throw new Error("boom"); });
        setTimeout(() => console.log("still alive"), 61000);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("boom");
    expect(exitCode).toBe(1);
  }, 70_000);

  test("--hot reload clears jobs deleted from source", async () => {
    // Markers live OUTSIDE the --hot-watched dir so inotify doesn't deliver
    // a write event that races process.exit() teardown (watcher/exit race).
    using markers = tempDir("cron-hot-markers", {});
    const m = (f: string) => join(String(markers), f);
    using dir = tempDir("cron-hot", {
      "app.ts": `
        import { writeFileSync, existsSync } from "node:fs";
        const m = process.env.MARKERS;
        writeFileSync(m + "/v1.evaluated", "");
        // A fire before the v2 reload is legitimate (not a ghost) — only
        // write the marker if v2 has already evaluated.
        Bun.cron("* * * * *", () => {
          if (existsSync(m + "/v2.evaluated")) writeFileSync(m + "/ghost.fired", "");
        });
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
        if (proc.exitCode !== null)
          throw new Error(`subprocess exited ${proc.exitCode} before ${file}: ${await stderrP}`);
        await Bun.sleep(10);
      }
    };

    await waitFor("v1.evaluated");

    // Delete the ghost cron; replace with a sentinel that fires on the same
    // boundary. When the sentinel fires, ghost.fired must NOT exist.
    await Bun.write(
      join(String(dir), "app.ts"),
      `
        import { writeFileSync, existsSync } from "node:fs";
        const m = process.env.MARKERS;
        writeFileSync(m + "/v2.evaluated", "");
        Bun.cron("* * * * *", () => {
          writeFileSync(m + "/result", existsSync(m + "/ghost.fired") ? "GHOST_FIRED" : "ok");
          process.exit(0);
        });
      `,
    );

    await waitFor("v2.evaluated");
    const [exitCode, stderr] = await Promise.all([proc.exited, stderrP]);

    if (exitCode !== 0) console.error(stderr);
    expect(exitCode).toBe(0);
    expect(await Bun.file(m("result")).text()).toBe("ok");
    expect(await Bun.file(m("ghost.fired")).exists()).toBe(false);
  }, 130_000);
});

describe("Bun.cron (in-process) — the returned value is awaited as `await` does", () => {
  // setImmediate is not faked: one real turn of the event loop runs every pending microtask.
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));
  // One minute on the fake clock, then the jobs that the tick queued.
  async function nextMinute() {
    jest.advanceTimersByTime(60_000);
    await turn();
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-01-01T12:00:00.000Z") });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a thenable: then is read in the tick, and called once in a job after the tick's own microtasks", async () => {
    const log: string[] = [];
    using job = Bun.cron("* * * * *", () => {
      log.push("fire");
      queueMicrotask(() => log.push("microtask"));
      return {
        get then() {
          log.push("get then");
          return (resolve: () => void, reject: unknown) => {
            log.push(`then(${typeof resolve}, ${typeof reject})`);
            resolve();
          };
        },
      };
    });

    await nextMinute();
    expect(log).toEqual(["fire", "get then", "microtask", "then(function, function)"]);
  });

  test("a thenable that has not settled: the next fire waits for it", async () => {
    const firedAt: string[] = [];
    let settle!: () => void;
    using job = Bun.cron("* * * * *", () => {
      firedAt.push(new Date().toISOString());
      return { then: (resolve: () => void) => void (settle = resolve) };
    });

    await nextMinute();
    await nextMinute();
    await nextMinute();
    expect(firedAt).toEqual(["2026-01-01T12:01:00.000Z"]);

    settle();
    await turn();
    await nextMinute();
    expect(firedAt).toEqual(["2026-01-01T12:01:00.000Z", "2026-01-01T12:04:00.000Z"]);
  });

  test("only a promise or a thenable that has not settled holds the next fire", async () => {
    // `await` does not call then() on a promise of its own realm.
    const ownThenCalls = { fulfilled: 0, pending: 0 };
    const returned: Record<string, () => unknown> = {
      "undefined": () => undefined,
      "a plain object": () => ({}),
      "a then that is not callable": () => ({ then: 1 }),
      "a fulfilled promise": () => Promise.resolve(),
      "a fulfilled promise with an own then()": () =>
        Object.assign(Promise.resolve(), { then: () => ownThenCalls.fulfilled++ }),
      "a pending promise with an own then()": () =>
        Object.assign(new Promise<void>(resolve => queueMicrotask(resolve)), { then: () => ownThenCalls.pending++ }),
      "a fulfilled promise of another realm": () => runInNewContext("Promise.resolve()"),
      "an async function": async () => {},
      "a thenable that never settles": () => ({ then() {} }),
    };
    const fires: Record<string, number> = {};
    const jobs = Object.entries(returned).map(([name, value]) =>
      Bun.cron("* * * * *", () => {
        fires[name] = (fires[name] ?? 0) + 1;
        return value();
      }),
    );
    try {
      await nextMinute();
      await nextMinute();
      await nextMinute();
      expect({ fires, ownThenCalls }).toEqual({
        fires: {
          "undefined": 3,
          "a plain object": 3,
          "a then that is not callable": 3,
          "a fulfilled promise": 3,
          "a fulfilled promise with an own then()": 3,
          "a pending promise with an own then()": 3,
          "a fulfilled promise of another realm": 3,
          "an async function": 3,
          "a thenable that never settles": 1,
        },
        ownThenCalls: { fulfilled: 0, pending: 0 },
      });
    } finally {
      for (const job of jobs) job.stop();
    }
  });

  test("a Promise subclass: then() is called once, pending or settled, and the next fire waits for it", async () => {
    class Lazy extends Promise<void> {
      thenCalls = 0;
      static get [Symbol.species]() {
        return Promise;
      }
      then(...args: any[]) {
        this.thenCalls++;
        return super.then(...args);
      }
    }
    let finish!: () => void;
    const returned: Lazy[] = [];
    using job = Bun.cron("* * * * *", () => {
      // The first tick returns a pending one, the second tick a settled one.
      const lazy = returned.length === 0 ? new Lazy(resolve => void (finish = resolve)) : (Lazy.resolve() as Lazy);
      returned.push(lazy);
      return lazy;
    });

    await nextMinute();
    await nextMinute();
    expect(returned.map(lazy => lazy.thenCalls)).toEqual([1]);

    finish();
    await turn();
    await nextMinute();
    expect(returned.map(lazy => lazy.thenCalls)).toEqual([1, 1]);
  });

  test("a Bun.$ command: it runs, and the next fire waits for it", async () => {
    const commands: ReturnType<typeof $>[] = [];
    using job = Bun.cron("* * * * *", () => {
      const command = $`echo tick`;
      // The command starts in a later job, as with `await`: this microtask can still configure it.
      queueMicrotask(() => command.quiet());
      commands.push(command);
      return command;
    });

    await nextMinute();
    expect(commands.length).toBe(1);
    // A command that has started refuses configuration.
    expect(() => void commands[0].cwd(".")).toThrow("Shell is already running");
    expect((await commands[0]).text()).toBe("tick\n");

    await turn();
    await nextMinute();
    expect(commands.length).toBe(2);
    expect((await commands[1]).text()).toBe("tick\n");
  });

  test("a Bun.SQL query: it runs", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`create table ticks (n integer)`;
    let fires = 0;
    using job = Bun.cron("* * * * *", () => sql`insert into ticks values (${++fires})`);

    await nextMinute();
    await nextMinute();
    const rows = await sql`select n from ticks order by n`;
    expect(rows.map((row: { n: number }) => row.n)).toEqual([1, 2]);
  });

  test("stop() inside then(): the job does not fire again", async () => {
    let fires = 0;
    const job = Bun.cron("* * * * *", () => {
      fires++;
      return {
        then(resolve: () => void) {
          job.stop();
          resolve();
        },
      };
    });

    await nextMinute();
    await nextMinute();
    await nextMinute();
    expect(fires).toBe(1);
  });

  test("stop() inside the handler ends the schedule, not the tick: the returned value is still awaited", async () => {
    const log: string[] = [];
    Bun.cron("* * * * *", function () {
      log.push("fire");
      this.stop();
      return {
        then(resolve: () => void) {
          log.push("then");
          resolve();
        },
      };
    });
    const commands: ReturnType<typeof $>[] = [];
    Bun.cron("* * * * *", function () {
      this.stop();
      const command = $`echo once`.quiet();
      commands.push(command);
      return command;
    });

    await nextMinute();
    await nextMinute();
    expect(log).toEqual(["fire", "then"]);
    expect(commands.length).toBe(1);
    expect(() => void commands[0].cwd(".")).toThrow("Shell is already running");
    expect((await commands[0]).text()).toBe("once\n");
  });

  test("then is read and called in the AsyncLocalStorage store that the handler was registered in", async () => {
    const storage = new AsyncLocalStorage<string>();
    const seen: Record<string, string | undefined> = {};
    using job = storage.run("handler", () =>
      Bun.cron("* * * * *", () => {
        seen["tick"] = storage.getStore();
        return {
          get then() {
            seen["get then"] = storage.getStore();
            return (resolve: () => void) => {
              seen["then()"] = storage.getStore();
              resolve();
            };
          },
        };
      }),
    );

    // The code that drives the timer has another store, and has it again after the tick.
    const after = storage.run("timer", () => {
      jest.advanceTimersByTime(60_000);
      return storage.getStore();
    });
    await turn();
    expect({ ...seen, after }).toEqual({
      "tick": "handler",
      "get then": "handler",
      "then()": "handler",
      after: "timer",
    });
  });
});

// Inside `bun test` a tick's rejection goes to the test runner, so these run in a child process
// that drives its own fake clock.
describe.concurrent("Bun.cron (in-process) — the returned value is awaited as `await` does, child process", () => {
  const clock = `
    const { jest } = require("bun:test");
    jest.useFakeTimers({ now: new Date("2026-01-01T12:00:00.000Z") });
  `;

  // `script` declares `job`. Two ticks, then what the process listeners received.
  async function twoTicks(script: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        clock +
          `
        const events = [];
        let fires = 0;
        let returned;
        process.on("unhandledRejection", (error, promise) =>
          events.push(["unhandledRejection", error.message, promise instanceof Promise, promise === returned]),
        );
        process.on("uncaughtException", error => events.push(["uncaughtException", error.message]));
        ${script}
        for (let i = 0; i < 2; i++) {
          jest.advanceTimersByTime(60_000);
          await new Promise(resolve => setImmediate(resolve));
        }
        job.stop();
        console.log(JSON.stringify({ fires, events }));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.each([
    // The last column: is the promise that the listener receives the returned value itself?
    ["a thenable that rejects", `{ then(_, reject) { reject(new Error("boom")); } }`, false],
    ["a thenable whose then() throws", `{ then() { throw new Error("boom"); } }`, false],
    ["a thenable whose then getter throws", `{ get then() { throw new Error("boom"); } }`, false],
    ["a rejected Promise subclass", `(class extends Promise {}).reject(new Error("boom"))`, false],
    [
      "a Promise subclass that rejects later",
      `new (class extends Promise {})((_, reject) => queueMicrotask(() => reject(new Error("boom"))))`,
      false,
    ],
    [
      "a rejected promise of another realm",
      `require("node:vm").runInNewContext("Promise.reject(new Error('boom'))")`,
      false,
    ],
    ["a rejected Promise", `Promise.reject(new Error("boom"))`, true],
    [
      "a Promise that rejects later",
      `new Promise((_, reject) => queueMicrotask(() => reject(new Error("boom"))))`,
      true,
    ],
  ])("%s: one unhandledRejection per tick with a promise, and the job keeps running", async (_, value, same) => {
    const script = `const job = Bun.cron("* * * * *", () => { fires++; return (returned = ${value}); });`;
    expect(await twoTicks(script)).toEqual({
      stdout:
        JSON.stringify({
          fires: 2,
          events: [
            ["unhandledRejection", "boom", true, same],
            ["unhandledRejection", "boom", true, same],
          ],
        }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a promise whose constructor getter throws: uncaughtException, and the job keeps running", async () => {
    const script = `const job = Bun.cron("* * * * *", () => {
      fires++;
      return Object.defineProperty(new Promise(() => {}), "constructor", { get() { throw new Error("boom"); } });
    });`;
    expect(await twoTicks(script)).toEqual({
      stdout:
        JSON.stringify({
          fires: 2,
          events: [
            ["uncaughtException", "boom"],
            ["uncaughtException", "boom"],
          ],
        }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("stop() inside a then getter: a later rejection is still reported with a promise", async () => {
    // After stop() only the tick that is pending keeps the job's wrapper alive.
    const script = `let job = Bun.cron("* * * * *", () => {
      fires++;
      return {
        get then() {
          job.stop();
          job = { stop() {} };
          Bun.gc(true);
          return (_, reject) => setImmediate(() => { Bun.gc(true); reject(new Error("boom")); });
        },
      };
    });`;
    expect(await twoTicks(script)).toEqual({
      stdout: JSON.stringify({ fires: 1, events: [["unhandledRejection", "boom", true, false]] }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("one advance over three fires: a job that waits on the returned value fires once", async () => {
    // No microtask runs inside advanceTimersByTime() here, so a value that needs one to settle holds the job.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        clock +
          `
        const returned = {
          "undefined": () => undefined,
          "a fulfilled promise": () => Promise.resolve(),
          "an async function that awaits": async () => { await null; },
          "a thenable": () => ({ then(resolve) { resolve(); } }),
          "a fulfilled Promise subclass": () => (class extends Promise {}).resolve(),
        };
        const fires = {};
        const jobs = Object.entries(returned).map(([name, value]) =>
          Bun.cron("* * * * *", () => { fires[name] = (fires[name] ?? 0) + 1; return value(); }),
        );
        jest.advanceTimersByTime(180_000);
        const first = { ...fires };
        await new Promise(resolve => setImmediate(resolve));
        jest.advanceTimersByTime(180_000);
        for (const job of jobs) job.stop();
        console.log(JSON.stringify([first, fires]));
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const fires = (a: number, b: number) => ({
      "undefined": a,
      "a fulfilled promise": a,
      "an async function that awaits": b,
      "a thenable": b,
      "a fulfilled Promise subclass": b,
    });
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify([fires(3, 1), fires(6, 2)]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a thenable that rejects, with no listener: the process exits with code 1", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        clock +
          `
        Bun.cron("* * * * *", () => ({ then(_, reject) { reject(new Error("boom")); } })).unref();
        jest.advanceTimersByTime(60_000);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("error: boom");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });
});
