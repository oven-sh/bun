import { describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

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

// A Worker keeps no list of its jobs: they stop with the Worker's context, as on a main thread without --hot.
describe.concurrent("Bun.cron (in-process) in a Worker", () => {
  // process.threadCpuUsage() advances in ticks of about 15.6 ms on Windows.
  test.skipIf(isWindows).each([
    ["", []],
    [" under --hot", ["--hot", "--no-clear-screen"]],
  ])("to stop many jobs in a Worker%s costs less than to schedule them", async (_, flags) => {
    using dir = tempDir("cron-stop-cost", {
      "stop-cost-fixture.js": `
        const cpuTime = run => {
          const before = process.threadCpuUsage();
          const result = run();
          const { user, system } = process.threadCpuUsage(before);
          return [user + system, result];
        };
        // The CPU time of this thread to stop the jobs, as a fraction of its CPU time to schedule them.
        const cost = (count, stop) => {
          const [schedule, jobs] = cpuTime(() => Array.from({ length: count }, () => Bun.cron("* * * * *", () => {})));
          return cpuTime(() => stop(jobs))[0] / schedule;
        };

        if (Bun.isMainThread) {
          const worker = new Worker(import.meta.url);
          worker.onmessage = ({ data }) => {
            console.log(JSON.stringify(data));
            worker.terminate();
          };
          // With --hot the main thread does not end by itself.
          worker.addEventListener("close", () => process.exit(0));
          worker.postMessage(Number(process.argv[2]));
        } else {
          self.onmessage = ({ data: count }) =>
            postMessage({
              oldestFirst: cost(count, jobs => {
                for (let i = 0; i < count; i++) jobs[i].stop();
              }),
              newestFirst: cost(count, jobs => {
                for (let i = count - 1; i >= 0; i--) jobs[i].stop();
              }),
            });
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "stop-cost-fixture.js", String(isDebug ? 10_000 : 100_000)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    // Without output the costs are undefined, and the assertion shows the exit code.
    const { oldestFirst, newestFirst } = stdout === "" ? {} : JSON.parse(stdout);
    // A stop costs about a tenth of a schedule. When each stop searched a list of the Worker's jobs,
    // to stop this many cost up to 3 (debug) or 39 (release) times as much as to schedule them.
    // A cost that is not below 1 stays in the result, so that a failure shows it.
    expect({
      oldestFirst: oldestFirst < 1 || oldestFirst,
      newestFirst: newestFirst < 1 || newestFirst,
      exitCode,
    }).toEqual({ oldestFirst: true, newestFirst: true, exitCode: 0 });
  });

  // process.cpuUsage() has the same ticks on Windows. A debug build cannot schedule enough jobs in time for the
  // search to stand out: 3.5 against 0.8 at 10,000 jobs.
  test.skipIf(isWindows || isDebug)(
    "to end a Worker that has many jobs costs less than 8 times their schedule",
    async () => {
      using dir = tempDir("cron-worker-end-cost", {
        "end-cost-fixture.js": `
          if (Bun.isMainThread) {
            const worker = new Worker(import.meta.url);
            worker.onmessage = ({ data: schedule }) => {
              const before = process.cpuUsage();
              worker.addEventListener("close", () => {
                const { user, system } = process.cpuUsage(before);
                console.log((user + system) / schedule);
              });
              worker.terminate();
            };
            worker.postMessage(Number(process.argv[2]));
          } else {
            self.onmessage = ({ data: count }) => {
              const before = process.threadCpuUsage();
              for (let i = 0; i < count; i++) Bun.cron("* * * * *", () => {});
              const { user, system } = process.threadCpuUsage(before);
              // No collection is in progress when the Worker ends.
              Bun.gc(true);
              postMessage(user + system);
            };
          }
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "end-cost-fixture.js", "100000"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) console.error(stderr);
      // Not a number without output, so that the assertion fails.
      const cost = parseFloat(stdout);
      // The CPU time of the process to end the Worker, over the CPU time of the Worker to schedule its jobs: 0.4 to 1.1.
      // It was about 30 when each job searched the list for itself. Bun 1.4.2 did not search at the end of a Worker.
      expect({ cost: cost < 8 || cost, exitCode }).toEqual({ cost: true, exitCode: 0 });
    },
  );

  test.each([
    ["worker.terminate()", "scheduled\nclosed\n"],
    ["process.exit() in a tick", "closed\n"],
  ])("a Worker that ends with %s stops its jobs", async (how, output) => {
    using dir = tempDir("cron-worker-end", {
      "worker-fixture.js": `
        // LeakSanitizer does not report what a module body allocates (test/leaksan.supp), so the jobs start in a handler.
        self.onmessage = ({ data: how }) => {
          const { jest } = Bun.jest();
          jest.useFakeTimers();
          jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
          const never = new Promise(() => {});
          Bun.cron("* * * * *", () => {});
          Bun.cron("* * * * *", () => never);
          const stoppedInTick = Bun.cron("* * * * *", () => never);
          Bun.cron("* * * * *", () => {}).stop();
          jest.advanceTimersByTime(60_000);
          stoppedInTick.stop();
          // The Worker ends with a job that waits for its next tick, two whose tick is pending
          // (one of them stopped), and one that was stopped before its first tick.
          if (how === "worker.terminate()") {
            postMessage("scheduled");
          } else {
            Bun.cron("* * * * *", () => process.exit(0));
            jest.advanceTimersByTime(60_000);
          }
        };
      `,
      "main-fixture.js": `
        const worker = new Worker("./worker-fixture.js");
        worker.onmessage = ({ data }) => {
          console.log(data);
          worker.terminate();
        };
        worker.addEventListener("close", () => {
          Bun.gc(true);
          console.log("closed");
        });
        worker.postMessage(process.argv[2]);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main-fixture.js", how],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    // A debug build asserts that the Worker listed no job. A build with LeakSanitizer reports a job that was not released.
    expect({ stdout, exitCode }).toEqual({ stdout: output, exitCode: 0 });
  });
});
