import { expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "path";

it("setInterval", async () => {
  var counter = 0;
  var start;
  const result = await new Promise((resolve, reject) => {
    start = performance.now();

    var id = setInterval(
      (...args) => {
        counter++;
        if (counter === 10) {
          resolve(counter);
          clearInterval(id);
        }
        try {
          expect(args).toStrictEqual(["foo"]);
        } catch (err) {
          reject(err);
          clearInterval(id);
        }
      },
      1,
      "foo",
    );
  });

  expect(result).toBe(10);
  expect(performance.now() - start).toBeGreaterThanOrEqual(9);
});

it("clearInterval", async () => {
  var called = false;
  const id = setInterval(() => {
    called = true;
    expect.unreachable();
  }, 1);
  clearInterval(id);
  await new Promise(resolve => {
    const id2 = setInterval(() => {
      clearInterval(id2);
      resolve();
    }, 10);
  });
  expect(called).toBe(false);
});

it("async setInterval", async () => {
  var remaining = 5;
  await new Promise((resolve, reject) => {
    queueMicrotask(() => {
      var id = setInterval(async () => {
        await 1;
        remaining--;
        if (remaining === 0) {
          clearInterval(id);
          resolve();
        }
      }, 1);
    });
  });
  expect(remaining).toBe(0);
});

it("refreshed setInterval should not reschedule again", async () => {
  let relative = performance.now();
  let runCount = 0;
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      let end = performance.now();

      // spin for 100ms so the next scheduled tick is already due by the time we return
      const spinloop = end;
      while (performance.now() - spinloop < 100) {
        end = performance.now();
      }

      timer.refresh();

      const elapsed = Math.round(end - relative);
      runCount++;

      try {
        switch (runCount) {
          case 1:
            // initial 100ms delay + 100ms spinloop
            expect(elapsed).toBeGreaterThanOrEqual(180);
            break;
          case 2:
          case 3:
            // refresh() inside the callback must not push the next tick out: since the
            // spinloop already consumed the interval, the next fire happens immediately
            expect(elapsed).toBeLessThan(180);
            break;
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
        return;
      }

      relative = end;

      if (runCount === 3) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
  expect(runCount).toBe(3);
});

async function runFixture(args) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

it.concurrent(
  "setInterval runs with at least the delay time",
  async () => {
    const { stdout, stderr, exitCode } = await runFixture(["run", join(import.meta.dir, "setInterval-fixture.js")]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  },
  30_000,
);

it.concurrent(
  "setInterval canceling with unref, close, _idleTimeout, and _onTimeout",
  async () => {
    const { stdout, stderr, exitCode } = await runFixture([
      join(import.meta.dir, "timers-fixture-unref.js"),
      "setInterval",
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  },
  30_000,
);

it.concurrent(
  "setInterval doesn't leak memory",
  async () => {
    const { stdout, stderr, exitCode } = await runFixture([
      "run",
      join(import.meta.dir, "setInterval-leak-fixture.js"),
    ]);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^RSS \d+ MB\nDelta -?\d+ MB\nTimeout object count: \d+\n$/);
    expect(exitCode).toBe(0);
  },
  !isWindows ? 30_000 : 90_000,
);

it.concurrent(
  "setInterval doesn't run when cancelled after being scheduled",
  async () => {
    const { stdout, stderr, exitCode } = await runFixture([
      "run",
      join(import.meta.dir, "setinterval-cancel-fixture.js"),
    ]);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^RSS: \d+ MB\n$/);
    expect(exitCode).toBe(0);
  },
  30_000,
);
