import { spawnSync } from "bun";
import { timerInternals } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDirWithFiles } from "harness";
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

it("setTimeout -> refresh", () => {
  const { exitCode, stdout } = spawnSync({
    cmd: [bunExe(), path.join(import.meta.dir, "setTimeout-unref-fixture.js")],
    env: bunEnv,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe("SUCCESS\n");
});

it("setTimeout -> unref -> ref works", () => {
  const { exitCode, stdout } = spawnSync({
    cmd: [bunExe(), path.join(import.meta.dir, "setTimeout-unref-fixture-4.js")],
    env: bunEnv,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe("TEST PASSED!\n");
});

it("setTimeout -> ref -> unref works, even if there is another timer", () => {
  const { exitCode, stdout } = spawnSync({
    cmd: [bunExe(), path.join(import.meta.dir, "setTimeout-unref-fixture-2.js")],
    env: bunEnv,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe("");
});

it("setTimeout -> ref -> unref works", () => {
  const { exitCode, stdout } = spawnSync({
    cmd: [bunExe(), path.join(import.meta.dir, "setTimeout-unref-fixture-5.js")],
    env: bunEnv,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe("");
});

it("setTimeout -> unref doesn't keep event loop alive forever", () => {
  const { exitCode, stdout } = spawnSync({
    cmd: [bunExe(), path.join(import.meta.dir, "setTimeout-unref-fixture-3.js")],
    env: bunEnv,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe("");
});

it("setTimeout -> fire -> unref -> ref does not keep the event loop alive", async () => {
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

it("setImmediate -> fire -> unref -> ref does not keep the event loop alive", async () => {
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

it("setTimeout should refresh N times", done => {
  let count = 0;
  let timer = setTimeout(() => {
    count++;
    expect(timer.refresh()).toBe(timer);
  }, 50);

  setTimeout(() => {
    clearTimeout(timer);
    try {
      expect(count).toBeGreaterThanOrEqual(isWindows ? 4 : 5);
    } finally {
      done();
    }
  }, 300);
});

it("setTimeout if refreshed before run, should reschedule to run later", done => {
  let start = Date.now();
  let timer = setTimeout(() => {
    let end = Date.now();
    expect(end - start).toBeGreaterThan(120);
    done();
  }, 100);

  setTimeout(() => {
    timer.refresh();
  }, 50);
});

it("setTimeout should refresh after already been run", done => {
  let count = 0;
  let timer = setTimeout(() => {
    count++;
  }, 50);

  setTimeout(() => {
    timer.refresh();
  }, 100);

  setTimeout(() => {
    expect(count).toBe(2);
    done();
  }, 300);
});

it("setTimeout should not refresh after clearTimeout", done => {
  let count = 0;
  let timer = setTimeout(() => {
    count++;
  }, 50);

  clearTimeout(timer);

  timer.refresh();

  setTimeout(() => {
    expect(count).toBe(0);
    done();
  }, 100);
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
  const process = Bun.spawn({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "setTimeout-cpu-fixture.js")],
    env: bunEnv,
    stdout: "inherit",
  });
  const code = await process.exited;
  expect(code).toBe(0);
  const stats = process.resourceUsage();
  expect(stats.cpuTime.total / BigInt(1e6)).toBeLessThan(1);
});

// The epoll_pwait(2) fallback (kernels <5.11, gVisor, seccomp-blocked
// environments) used to truncate the ns-resolution timespec to ms, so any
// sub-ms timer deadline became a 0 ms timeout and the loop busy-spun at
// 100% CPU until the deadline passed. Force the fallback and assert
// setInterval(1) spends most of the window asleep.
// https://man7.org/linux/man-pages/man2/epoll_wait.2.html
it.skipIf(!isLinux)("epoll_pwait fallback does not busy-spin on sub-ms timers", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
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
    env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_EPOLL_PWAIT2: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  const { ticks, cpuUs, wallUs } = JSON.parse(stdout);
  const cpuPercent = (cpuUs / wallUs) * 100;
  // Busy-spinning puts cpuUs ~= wallUs (100%). Sleeping properly it is a
  // small fraction (~5% release). 50% gives wide headroom for ASAN/debug.
  expect(cpuPercent, `ticks=${ticks} cpuUs=${cpuUs} wallUs=${wallUs}`).toBeLessThan(50);
  expect(ticks).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
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
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const s = process.hrtime.bigint();
         setTimeout(() => {
           console.log(JSON.stringify({ ms: Number((process.hrtime.bigint() - s) / 1_000_000n) }));
           process.exit(0);
         }, 200);`,
      ],
      env: { ...bunEnv, ...extraEnv, LD_PRELOAD: soPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const filteredStderr = stderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(filteredStderr).toBe("");
    const { ms } = JSON.parse(stdout);
    // Without the fix this lands ~900-1000 ms; with it, ~200-210 ms.
    expect(ms).toBeWithin(200, 500);
    expect(exitCode).toBe(0);
  });
});

it("Returning a Promise in setTimeout doesnt keep the event loop alive forever", async () => {
  expect([path.join(import.meta.dir, "setTimeout-unref-fixture-6.js")]).toRun();
});

it("Returning a Promise in setTimeout (unref'd) doesnt keep the event loop alive forever", async () => {
  expect([path.join(import.meta.dir, "setTimeout-unref-fixture-7.js")]).toRun();
});

it("setTimeout canceling with unref, close, _idleTimeout, and _onTimeout", () => {
  expect([path.join(import.meta.dir, "timers-fixture-unref.js"), "setTimeout"]).toRun();
});

for (const mode of ["clear", "refresh", "repeat"]) {
  it(`setTimeout doesn't leak when ${mode} is called inside its own callback`, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "setTimeout-clear-in-callback-leak-fixture.js"), mode],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const filteredStderr = stderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(filteredStderr).toBe("");
    expect(stdout).toContain("delta:");
    expect(exitCode).toBe(0);
  }, 90_000);
}

it("setTimeout does not leak a pending exception when emitting a timeout warning throws", async () => {
  // The out-of-range timeout warning queues a process.nextTick, which reads process._exiting.
  // If that read throws, the exception must not be left pending on the VM when setTimeout
  // returns — otherwise debug builds hit releaseAssertNoException().
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
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
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("boom");
  expect(stdout.trim()).toBe("survived");
  expect(exitCode).toBe(0);
});

it("clearTimeout with a numeric id is a no-op after a timeout promoted to an interval is cleared and collected", async () => {
  // A setTimeout whose numeric id has been observed via `+timer` registers itself in the
  // setTimeout id map. Assigning `_repeat` promotes it to a setInterval after its first
  // fire. Once the timer is cleared and its wrapper is collected, the id-map entry must be
  // gone from whichever map it was inserted into, so that a later clearTimeout(id) with the
  // raw number is a harmless no-op instead of resolving to the freed timer.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
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
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const stderrLines = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(stderrLines).toBe("");
  expect(stdout).toBe("converted: ok\nsurvived\n");
  expect(exitCode).toBe(0);
});

it("setTimeout(1) is not quantized to the ~15.6ms Windows system tick", async () => {
  // Subprocess so no other in-process work has raised the Windows tick
  // resolution; median of 50 so a single scheduler hiccup on a busy CI
  // runner does not fail the assertion.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
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
        process.stdout.write(JSON.stringify({ median, min: samples[0] }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  const { median, min } = JSON.parse(stdout);
  // Before: median ~15.6ms. After: median ~1-2ms. 8ms splits the two with
  // plenty of headroom for CI jitter. Also assert we never fire early.
  expect(median).toBeLessThan(8);
  expect(min).toBeGreaterThanOrEqual(1);
  expect(exitCode).toBe(0);
});

// Reading a timer's numeric id (`+t`, `${t}`, obj[t]=x, any Symbol.toPrimitive
// use) registers it in the id->timer map. Finalize removed that entry with the
// ordered ArrayHashMap.remove(), which is three O(n) vec shifts plus a full
// hash-index rebuild per timer, so a GC sweep of n id-accessed timers was
// O(n^2). 20k such timers froze the loop for ~2-3 s on release, tens of
// seconds at 30k+. Node: ~5 ms for 200k. With swap_remove() the sweep is O(n).
it("GC of many id-accessed timers is not quadratic", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
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
          process.stdout.write(JSON.stringify({ ms: Math.round(ms) }));
        `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  const { ms } = JSON.parse(stdout);
  // Before: ~2100-3400 ms release, far more on debug+ASAN (quadratic in N).
  // After: <10 ms release, ~100-170 ms debug+ASAN (linear). 1500 ms splits
  // the two with ~9x headroom over the fixed debug+ASAN number.
  expect(ms).toBeLessThan(1500);
  expect(exitCode).toBe(0);
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
