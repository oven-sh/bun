import { spawnSync } from "bun";
import { timerInternals } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, bunRun, isASAN, isLinux, isWindows, tempDirWithFiles } from "harness";
import path from "node:path";

it("setTimeout", async () => {
  var lastID = -1;
  const result = await new Promise((resolve, reject) => {
    var numbers = [];

    for (let i = 0; i < 10; i++) {
      const id = setTimeout(
        (...args) => {
          numbers.push(i);
          if (i === 9) {
            resolve(numbers);
          }
          try {
            expect(args).toStrictEqual(["foo"]);
          } catch (err) {
            reject(err);
          }
        },
        i,
        "foo",
      );
      expect(+id > lastID).toBe(true);
      lastID = id;
    }
  });

  for (let j = 0; j < result.length; j++) {
    expect(result[j]).toBe(j);
  }
  expect(result.length).toBe(10);
});

it("clearTimeout", async () => {
  var called = false;

  // as object
  {
    const id = setTimeout(() => {
      called = true;
      expect.unreachable();
    }, 0);
    clearTimeout(id);

    // assert it doesn't crash if you call clearTimeout twice
    clearTimeout(id);
  }

  // as number
  {
    const id = setTimeout(() => {
      called = true;
      expect.unreachable();
    }, 0);
    clearTimeout(+id);

    // assert it doesn't crash if you call clearTimeout twice
    clearTimeout(+id);
  }

  await new Promise((resolve, reject) => {
    setTimeout(resolve, 10);
  });
  expect(called).toBe(false);
});

it.todo("setImmediate runs after setTimeout cb", async () => {
  var ranFirst = -1;
  setTimeout(() => {
    if (ranFirst === -1) ranFirst = 1;
  }, 0);
  setImmediate(() => {
    if (ranFirst === -1) ranFirst = 0;
  });

  await Bun.sleep(5);

  expect(ranFirst).toBe(1);
});

it("setTimeout(() => {}, 0)", async () => {
  var called = false;
  setTimeout(() => {
    called = true;
  }, 0);
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(called).toBe(true);
  var ranFirst = -1;
  setTimeout(() => {
    if (ranFirst === -1) ranFirst = 0;
  }, 1);
  setTimeout(() => {
    if (ranFirst === -1) ranFirst = 1;
  }, 0);

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(ranFirst).toBe(0);

  ranFirst = -1;

  const id = setTimeout(() => {
    ranFirst = 0;
  }, 0);
  clearTimeout(id);
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(ranFirst).toBe(-1);
});

it("Bun.sleep", async () => {
  var sleeps = 0;
  await Bun.sleep(0);
  const start = performance.now();
  sleeps++;
  await Bun.sleep(1);
  sleeps++;
  await Bun.sleep(2);
  sleeps++;
  const end = performance.now();
  expect((end - start) * 1000).toBeGreaterThan(2);

  expect(sleeps).toBe(3);
});

it("Bun.sleep propagates exceptions", async () => {
  try {
    await Bun.sleep(1).then(a => {
      throw new Error("TestPassed");
    });
    throw "Should not reach here";
  } catch (err) {
    expect(err.message).toBe("TestPassed");
  }
});

const tolerance = 8;
it("Bun.sleep works with a Date object", async () => {
  const offset = isWindows ? 100 : 10;
  const init = performance.now();
  var ten_ms = new Date();
  ten_ms.setMilliseconds(ten_ms.getMilliseconds() + offset);
  await Bun.sleep(ten_ms);
  expect(Math.ceil(performance.now() - init + tolerance)).toBeGreaterThanOrEqual(offset);
});

it("Bun.sleep(Date) fulfills after Date", async () => {
  const offset = isWindows ? 100 : 50;
  let ten_ms = new Date();
  const init = performance.now();
  ten_ms.setMilliseconds(ten_ms.getMilliseconds() + offset);
  await Bun.sleep(ten_ms);
  expect(Math.ceil(performance.now() - init + tolerance)).toBeGreaterThanOrEqual(offset);
});

it("node.js timers/promises setTimeout propagates exceptions", async () => {
  const { setTimeout } = require("timers/promises");
  try {
    await setTimeout(1).then(a => {
      throw new Error("TestPassed");
    });
    throw "Should not reach here";
  } catch (err) {
    expect(err.message).toBe("TestPassed");
  }
});

it("order of setTimeouts", done => {
  var nums = [];
  var maybeDone = cb => {
    return () => {
      cb();
      if (nums.length === 4) {
        try {
          expect(nums).toEqual([1, 2, 3, 4]);
          done();
        } catch (e) {
          done(e);
        }
      }
    };
  };
  setTimeout(maybeDone(() => nums.push(2)));
  setTimeout(maybeDone(() => nums.push(3), 0));
  setTimeout(maybeDone(() => nums.push(4), 1));
  Promise.resolve().then(maybeDone(() => nums.push(1)));
});

// The tests below that spawn a process are it.concurrent so their children start together;
// the CPU and latency measurements further down stay sequential so nothing runs alongside them.

it.concurrent(
  "setTimeout -> ref/unref/refresh decide which timers run and whether the process stays alive",
  async () => {
    // The fixture arms every scenario at once and reports how often each callback ran when the
    // process exits, which it must do on its own once the ref'd timers have run.
    const result = await bunRun(path.join(import.meta.dir, "setTimeout-unref-fixture.js"));
    expect(result).toSpawn();
    expect(JSON.parse(result.stdout)).toEqual({
      "unref()": 0,
      "ref().unref()": 0,
      "refresh() inside the callback": 2,
      "this is the Timeout": 1,
      "callback returning a pending promise": 1,
      "unref'd callback returning a pending promise": 1,
    });
  },
);

it.concurrent("setTimeout -> unref -> ref works", async () => {
  // The re-ref'd timer is the only thing in the process, so the process only lives long enough
  // for the callback to flip the exit code if ref() really keeps the event loop alive again.
  const result = await bunRun([
    "-e",
    `process.exitCode = 1;
     setTimeout(() => { process.exitCode = 0; }, 1).unref().ref();`,
  ]);
  expect(result).toSpawn("");
});

it.concurrent("setTimeout -> fire -> unref -> ref does not keep the event loop alive", async () => {
  // After a one-shot timer has fired it is destroyed; calling .unref() then .ref()
  // must not leak an event-loop ref. Previously this would hang forever.
  const src = `
    const t = setTimeout(() => {}, 1);
    setTimeout(() => {
      t.unref();
      t.ref();
      console.log("destroyed=" + t._destroyed);
    }, 20);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 4_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("destroyed=true\n");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

it.concurrent("setImmediate -> fire -> unref -> ref does not keep the event loop alive", async () => {
  const src = `
    const im = setImmediate(() => {});
    setTimeout(() => {
      im.unref();
      im.ref();
      console.log("destroyed=" + im._destroyed);
    }, 20);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 4_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("destroyed=true\n");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

it.concurrent("setTimeout should refresh N times", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const refreshReturnedTimer = [];
  let count = 0;
  const timer = setTimeout(() => {
    if (++count === 5) return resolve();
    refreshReturnedTimer.push(timer.refresh() === timer);
  }, 10);
  await promise;
  expect(count).toBe(5);
  expect(refreshReturnedTimer).toEqual([true, true, true, true]);
});

it.concurrent("setTimeout if refreshed before run, should reschedule to run later", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const timer = setTimeout(() => resolve(performance.now()), 100);
  let refreshedAt;
  setTimeout(() => {
    refreshedAt = performance.now();
    timer.refresh();
  }, 50);
  const firedAt = await promise;
  // Without the refresh the timer fires at its original deadline, ~50ms after refreshedAt.
  expect(firedAt - refreshedAt).toBeGreaterThanOrEqual(95);
});

it.concurrent("setTimeout should refresh after already been run", async () => {
  let fired = 0;
  let onFire = () => {};
  const nextFire = () => new Promise(resolve => (onFire = resolve));
  const timer = setTimeout(() => {
    fired++;
    onFire();
  }, 10);

  await nextFire();
  expect(fired).toBe(1);

  // Refresh from a later macrotask, once the fired timer has been fully torn down (refreshing
  // from inside the callback is the separate path covered by the leak fixture below).
  await new Promise(resolve => setImmediate(resolve));
  const refired = nextFire();
  expect(timer.refresh()).toBe(timer);
  await refired;
  expect(fired).toBe(2);

  // The refreshed one-shot must not keep firing. A wrong third fire would be due 10ms after
  // the second one, so it would run before this 20ms timer does.
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(fired).toBe(2);
});

it.concurrent("setTimeout should not refresh after clearTimeout", async () => {
  let fired = 0;
  const timer = setTimeout(() => fired++, 10);
  clearTimeout(timer);
  expect(timer.refresh()).toBe(timer);
  // Had refresh() re-armed the cleared timer, it would be due before this 20ms timer.
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(fired).toBe(0);
});

it("setTimeout Timeout objects are unprotected after called", async () => {
  let { promise, resolve } = Promise.withResolvers();

  const initial = heapStats().protectedObjectTypeCounts;
  let remaining = 2;
  setTimeout(() => {
    remaining--;
    if (remaining === 0) resolve();
  }, 0);
  setTimeout(() => {
    remaining--;
    if (remaining === 0) resolve();
  }, 0);
  expect(heapStats().protectedObjectTypeCounts.Timeout || 0).toEqual((initial.Timeout || 0) + 2);

  // Assert it's unprotected.
  await promise;

  expect(heapStats().protectedObjectTypeCounts.Timeout || 0).toEqual(initial.Timeout || 0);

  Bun.gc(true);
  remaining = 5;
  ({ promise, resolve } = Promise.withResolvers());
  setInterval(function () {
    remaining--;
    if (remaining === 0) {
      clearInterval(this);
      queueMicrotask(resolve);
    }
  });
  Bun.gc(true);
  await promise;
  expect(heapStats().protectedObjectTypeCounts.Timeout || 0).toEqual(initial.Timeout || 0);
});

it("setTimeout CPU usage #7790", async () => {
  // A pending setTimeout used to make the event loop spin at 100% CPU until it fired. The child
  // measures its own CPU over a 300ms window during which a far-off timer is pending; the window
  // opens after a setImmediate so that startup work is not counted.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const pending = setTimeout(() => {}, 200_000);
       setImmediate(() => {
         const wall0 = process.hrtime.bigint();
         const cpu0 = process.cpuUsage();
         setTimeout(() => {
           const { user, system } = process.cpuUsage(cpu0);
           const wallUs = Number((process.hrtime.bigint() - wall0) / 1000n);
           clearTimeout(pending);
           const lifetime = process.cpuUsage();
           console.log(JSON.stringify({ cpuUs: user + system, wallUs, lifetimeCpuUs: lifetime.user + lifetime.system }));
         }, 300);
       });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { cpuUs, wallUs, lifetimeCpuUs } = JSON.parse(stdout);
  expect(wallUs).toBeGreaterThanOrEqual(250_000);
  // Spinning reads ~100%. Sleeping properly it reads ~0.2% on release and ~3% on debug+ASAN.
  expect((cpuUs / wallUs) * 100, `cpuUs=${cpuUs} wallUs=${wallUs}`).toBeLessThan(50);
  expect(exitCode).toBe(0);

  // Subprocess.resourceUsage() was added together with this test (#7792) and this is where it is
  // exercised: the child's whole-lifetime CPU time in microseconds, which cannot be less than
  // what the child itself read via process.cpuUsage() just before exiting.
  const { cpuTime } = proc.resourceUsage();
  expect(cpuTime.total).toBe(cpuTime.user + cpuTime.system);
  expect(Number(cpuTime.total)).toBeGreaterThanOrEqual(lifetimeCpuUs);
});

// The epoll_pwait(2) fallback (kernels <5.11, gVisor, seccomp-blocked
// environments) used to truncate the ns-resolution timespec to ms, so any
// sub-ms timer deadline became a 0 ms timeout and the loop busy-spun at
// 100% CPU until the deadline passed. Force the fallback and assert
// setInterval(1) spends most of the window asleep.
// https://man7.org/linux/man-pages/man2/epoll_wait.2.html
it.skipIf(!isLinux)("epoll_pwait fallback does not busy-spin on sub-ms timers", async () => {
  const result = await bunRun(
    [
      "-e",
      `const wall0 = process.hrtime.bigint();
       const cpu0 = process.cpuUsage();
       let ticks = 0;
       const id = setInterval(() => {
         ticks++;
         if (process.hrtime.bigint() - wall0 >= 300_000_000n) {
           clearInterval(id);
           const cpu = process.cpuUsage(cpu0);
           const cpuUs = cpu.user + cpu.system;
           const wallUs = Number((process.hrtime.bigint() - wall0) / 1000n);
           console.log(JSON.stringify({ ticks, cpuUs, wallUs }));
         }
       }, 1);`,
    ],
    { BUN_FEATURE_FLAG_DISABLE_EPOLL_PWAIT2: "1" },
  );
  expect(result).toSpawn();
  const { ticks, cpuUs, wallUs } = JSON.parse(result.stdout);
  const cpuPercent = (cpuUs / wallUs) * 100;
  // Busy-spinning puts cpuUs ~= wallUs (100%). Sleeping properly it is a
  // small fraction (~5% release, ~23% debug+ASAN, where each tick costs more).
  expect(cpuPercent, `ticks=${ticks} cpuUs=${cpuUs} wallUs=${wallUs}`).toBeLessThan(50);
  expect(ticks).toBeGreaterThan(0);
});

// EINTR retry used to re-issue the full timeout (on both epoll_pwait and
// epoll_pwait2), so a signal stream faster than the timer period could
// delay the timer far past its deadline. We LD_PRELOAD a constructor that
// installs a no-op SIGALRM handler and a 20 ms ITIMER_REAL (not via
// process.on(), which wakes the loop via eventfd and masks the bug), and
// assert a 200 ms setTimeout still fires roughly on time.
// https://man7.org/linux/man-pages/man7/signal.7.html (epoll_*wait is never
// restarted by SA_RESTART)
describe.skipIf(!isLinux)("epoll EINTR retry accounts for elapsed time", () => {
  const src = `
#include <signal.h>
#include <string.h>
#include <sys/time.h>
static void noop(int s) { (void) s; }
__attribute__((constructor)) static void arm(void) {
    struct sigaction sa; memset(&sa, 0, sizeof sa);
    sa.sa_handler = noop; sigemptyset(&sa.sa_mask); sa.sa_flags = 0;
    sigaction(SIGALRM, &sa, 0);
    struct itimerval itv;
    itv.it_interval.tv_sec = 0; itv.it_interval.tv_usec = 20000;
    itv.it_value = itv.it_interval;
    setitimer(ITIMER_REAL, &itv, 0);
}`;
  let soPath = "";
  let built = false;
  if (isLinux) {
    const dir = tempDirWithFiles("epoll-eintr", { "itimer.c": src });
    soPath = path.join(dir, "itimer.so");
    try {
      const cc = spawnSync({
        cmd: ["cc", "-shared", "-fPIC", "-O0", "-o", soPath, path.join(dir, "itimer.c")],
        stdout: "pipe",
        stderr: "pipe",
      });
      built = cc.exitCode === 0;
    } catch {}
  }

  it.skipIf(!built).each([
    ["epoll_pwait2", {}],
    ["epoll_pwait fallback", { BUN_FEATURE_FLAG_DISABLE_EPOLL_PWAIT2: "1" }],
  ])("%s: setTimeout fires on time under signal storm", async (_name, extraEnv) => {
    const result = await bunRun(
      [
        "-e",
        `const s = process.hrtime.bigint();
         setTimeout(() => {
           console.log(JSON.stringify({ ms: Number((process.hrtime.bigint() - s) / 1_000_000n) }));
           process.exit(0);
         }, 200);`,
      ],
      { ...extraEnv, LD_PRELOAD: soPath },
    );
    expect(result).toSpawn();
    const { ms } = JSON.parse(result.stdout);
    // Without the fix this lands ~900-1000 ms; with it, ~200-210 ms.
    expect(ms).toBeWithin(200, 500);
  });
});

it.concurrent("setTimeout canceling with unref, close, _idleTimeout, and _onTimeout", async () => {
  // The fixture exits non-zero and names the callback if any of them ran the wrong number of times.
  expect(await bunRun([path.join(import.meta.dir, "timers-fixture-unref.js"), "setTimeout"])).toSpawn("");
});

// On builds without ASAN (release, and debug builds on Windows and x64 macOS) RSS is the leak
// signal: over the fixture's 100 batches the delta is 0-2 MB when the TimeoutObjects are freed and
// ~20 MB or more when they leak (see the fixture), at ~0.3s per mode on release and ~8-10s on a
// debug build. Under ASAN the freed blocks stay resident in the quarantine, so 200k timers grow RSS
// by the same ~140 MB whether or not they are freed. ASAN builds therefore run a single batch and
// rely on LeakSanitizer instead: a TimeoutObject still allocated when the child exits is reported
// on stderr and fails the exit code. The CI runner sets the same three variables for the whole ASAN
// lane (scripts/runner.node.mjs), in which case they are inherited through bunEnv; the fallbacks
// below give a plain `bun bd test` the same setup, so it catches the leak too. print_suppressions=0
// matters for the exact-empty-stderr assertion: structural leaks covered by test/leaksan.supp would
// otherwise be listed on stderr. BUN_DESTRUCT_VM_ON_EXIT frees the JS heap before the scan, as CI
// does, which keeps the scan at ~0.1s instead of ~3s.
const leakFixtureBatches = isASAN ? 1 : 100;
const leakFixtureEnv = isASAN
  ? {
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
      LSAN_OPTIONS:
        bunEnv.LSAN_OPTIONS ??
        `print_suppressions=0:suppressions=${path.join(import.meta.dir, "../../../leaksan.supp")}`,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
    }
  : {};
for (const mode of ["clear", "refresh", "repeat"]) {
  it.concurrent(
    `setTimeout doesn't leak when ${mode} is called inside its own callback`,
    async () => {
      const result = await bunRun(
        [path.join(import.meta.dir, "setTimeout-clear-in-callback-leak-fixture.js"), mode, String(leakFixtureBatches)],
        leakFixtureEnv,
      );
      expect(result).toSpawn();
      const { liveTimeouts, rssDeltaMB, ...report } = JSON.parse(result.stdout);
      expect(report).toEqual({ mode, timers: leakFixtureBatches * 2000, protectedTimeouts: 0 });
      // A few wrappers survive the final GC via conservative stack scanning (2-4 observed);
      // retaining the fired timers would leave thousands.
      expect(liveTimeouts).toBeLessThan(100);
      if (!isASAN) expect(rssDeltaMB).toBeLessThan(10);
    },
    // ~1.5s on debug+ASAN, 8-10s on a debug build without ASAN. When the fixture does leak under
    // ASAN, symbolizing the LeakSanitizer report against a debug binary takes another ~5s, and that
    // report is the failure output worth waiting for.
    60_000,
  );
}

it.concurrent("setTimeout does not leak a pending exception when emitting a timeout warning throws", async () => {
  // The out-of-range timeout warning queues a process.nextTick, which reads process._exiting.
  // If that read throws, the exception must not be left pending on the VM when setTimeout
  // returns, otherwise debug builds hit releaseAssertNoException(). The throw also aborts the
  // warning itself, so stderr stays empty.
  const result = await bunRun([
    "-e",
    `
      process.nextTick(() => {});
      Object.defineProperty(process, "_exiting", {
        get() { throw new TypeError("boom"); },
        configurable: true,
      });
      const t = setTimeout(() => {}, 1e100);
      clearTimeout(t);
      console.log("survived");
    `,
  ]);
  expect(result).toSpawn("survived");
});

it.concurrent(
  "clearTimeout with a numeric id is a no-op after a timeout promoted to an interval is cleared and collected",
  async () => {
    // A setTimeout whose numeric id has been observed via `+timer` registers itself in the
    // setTimeout id map. Assigning `_repeat` promotes it to a setInterval after its first
    // fire. Once the timer is cleared and its wrapper is collected, the id-map entry must be
    // gone from whichever map it was inserted into, so that a later clearTimeout(id) with the
    // raw number is a harmless no-op instead of resolving to the freed timer.
    const result = await bunRun([
      "-e",
      `
        async function main() {
          let fires = 0;
          let resolveSecondFire;
          const secondFire = new Promise(resolve => {
            resolveSecondFire = resolve;
          });
          let t = setTimeout(() => {
            fires++;
            if (fires === 2) resolveSecondFire();
          }, 1);
          const id = +t; // register the numeric id in the setTimeout id map
          t._repeat = 1; // promoted to an interval after the first fire

          // The second fire only happens because the timer became an interval.
          await secondFire;
          console.log("converted:", fires >= 2 ? "ok" : fires);

          clearInterval(t);
          t = null;
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
          Bun.gc(true);

          // The numeric id must no longer resolve to the collected timer.
          clearTimeout(id);
          clearTimeout(id);
          clearInterval(id);
          console.log("survived");
        }
        main().then(
          () => {},
          err => {
            console.error(err);
            process.exit(1);
          },
        );
      `,
    ]);
    expect(result).toSpawn("converted: ok\nsurvived");
  },
);

it("setTimeout(1) is not quantized to the ~15.6ms Windows system tick", async () => {
  // Subprocess so no other in-process work has raised the Windows tick
  // resolution; median of 50 so a single scheduler hiccup on a busy CI
  // runner does not fail the assertion.
  const result = await bunRun([
    "-e",
    `
      const samples = [];
      for (let i = 0; i < 50; i++) {
        const t0 = process.hrtime.bigint();
        await new Promise(r => setTimeout(r, 1));
        samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      samples.sort((a, b) => a - b);
      const median = samples[samples.length >> 1];
      console.log(JSON.stringify({ median, min: samples[0] }));
    `,
  ]);
  expect(result).toSpawn();
  const { median, min } = JSON.parse(result.stdout);
  // Before: median ~15.6ms. After: median ~1-2ms. 8ms splits the two with
  // plenty of headroom for CI jitter. Also assert we never fire early.
  expect(median).toBeLessThan(8);
  expect(min).toBeGreaterThanOrEqual(1);
});

// Reading a timer's numeric id (`+t`, `${t}`, obj[t]=x, any Symbol.toPrimitive
// use) registers it in the id->timer map. Finalize removed that entry with the
// ordered ArrayHashMap.remove(), which is three O(n) vec shifts plus a full
// hash-index rebuild per timer, so a GC sweep of n id-accessed timers was
// O(n^2). 20k such timers froze the loop for ~2-3 s on release, tens of
// seconds at 30k+. Node: ~5 ms for 200k. With swap_remove() the sweep is O(n).
it("GC of many id-accessed timers is not quadratic", async () => {
  // Creating the 20k timers is itself ~4s on debug+ASAN, hence the raised timeout.
  const result = await bunRun([
    "-e",
    `
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const t = setTimeout(() => {}, 3_600_000);
        Number(t);          // mint the id-map entry via Symbol.toPrimitive
        clearTimeout(t);
      }
      const t0 = performance.now();
      Bun.gc(true);
      const ms = performance.now() - t0;
      console.log(JSON.stringify({ ms: Math.round(ms) }));
    `,
  ]);
  expect(result).toSpawn();
  const { ms } = JSON.parse(result.stdout);
  // Before: ~2100-3400 ms release, far more on debug+ASAN (quadratic in N).
  // After: <10 ms release, ~100-170 ms debug+ASAN (linear). 1500 ms splits
  // the two with ~9x headroom over the fixed debug+ASAN number.
  expect(ms).toBeLessThan(1500);
}, 30_000);

it("timer heap clock is monotonic, not wall-clock", () => {
  // The clock that schedules setTimeout/setInterval deadlines must be monotonic
  // (boot-relative) on every platform so NTP steps / user clock changes can't
  // stall or mass-fire timers. A wall-clock reading here would be ~= Date.now().
  const t0 = timerInternals.timerClockMs();
  const t1 = timerInternals.timerClockMs();
  const wallNow = Date.now();
  expect(t0).toBeGreaterThan(0);
  expect(t1).toBeGreaterThanOrEqual(t0);
  expect(t1).toBeLessThan(wallNow / 2);
});
