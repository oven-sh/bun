import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

describe("Bun.cron (in-process)", () => {
  test("validates cron expression", () => {
    expect(() => Bun.cron("x", "invalid expr", () => {})).toThrow(/Invalid cron expression/);
    expect(() => Bun.cron("x", "* * * *", () => {})).toThrow(/Invalid cron expression/);
    expect(() => Bun.cron("x", "60 * * * *", () => {})).toThrow(/Invalid cron expression/);
  });

  test("validates name is non-empty string", () => {
    expect(() => Bun.cron("", "* * * * *", () => {})).toThrow(/name must not be empty/);
    // @ts-expect-error
    expect(() => Bun.cron(123, "* * * * *", () => {})).toThrow(/string name/);
  });

  test("rejects expressions with no future occurrences", () => {
    // Feb 30 never exists
    expect(() => Bun.cron("x", "0 0 30 2 *", () => {})).toThrow(/no future occurrences/);
  });

  test("invalid replacement expression does not kill existing job", () => {
    const job1 = Bun.cron("keep-me", "* * * * *", () => {});
    try {
      // Feb 30 has no future occurrence — should throw WITHOUT stopping job1
      expect(() => Bun.cron("keep-me", "0 0 30 2 *", () => {})).toThrow(/no future occurrences/);
      // job1 should still be registered and active
      expect(job1.name).toBe("keep-me");
      // Registering a valid replacement should still work after the failed attempt
      const job2 = Bun.cron("keep-me", "@daily", () => {});
      expect(job2.cron).toBe("@daily");
      job2.stop();
    } finally {
      job1.stop();
    }
  });

  test("returns CronJob with name and cron getters", () => {
    const job = Bun.cron("test-getters", "* * * * *", () => {});
    try {
      expect(job.name).toBe("test-getters");
      expect(job.cron).toBe("* * * * *");
    } finally {
      job.stop();
    }
  });

  test("stop() cancels before first fire", () => {
    let called = false;
    const job = Bun.cron("test-stop", "* * * * *", () => {
      called = true;
    });
    job.stop();
    // stop() returns immediately; callback was never scheduled to run
    expect(called).toBe(false);
  });

  test("stop() is idempotent", () => {
    const job = Bun.cron("test-stop-idem", "* * * * *", () => {});
    expect(() => {
      job.stop();
      job.stop();
      job.stop();
    }).not.toThrow();
  });

  test("ref()/unref() are chainable", () => {
    const job = Bun.cron("test-chain", "* * * * *", () => {});
    try {
      expect(job.unref()).toBe(job);
      expect(job.ref()).toBe(job);
      expect(job.stop()).toBe(job);
    } finally {
      job.stop();
    }
  });

  test("same name replaces previous job", () => {
    let calls1 = 0;
    let calls2 = 0;
    const job1 = Bun.cron("replace-test", "* * * * *", () => {
      calls1++;
    });
    // Registering again with same name should stop job1
    const job2 = Bun.cron("replace-test", "* * * * *", () => {
      calls2++;
    });
    try {
      // Both handles exist but only job2 is active
      expect(job1.name).toBe("replace-test");
      expect(job2.name).toBe("replace-test");
      // Stopping job2 is what matters now; job1 was already stopped by replacement
      job1.stop(); // no-op, already stopped
      job2.stop();
    } finally {
      job2.stop();
    }
    expect(calls1).toBe(0);
    expect(calls2).toBe(0);
  });

  test("accepts @nicknames", () => {
    const job = Bun.cron("test-nickname", "@hourly", () => {});
    try {
      expect(job.cron).toBe("@hourly");
    } finally {
      job.stop();
    }
  });

  test("supports named weekdays and months", () => {
    const job = Bun.cron("test-names", "0 9 * JAN-DEC MON-FRI", () => {});
    try {
      expect(job.cron).toBe("0 9 * JAN-DEC MON-FRI");
    } finally {
      job.stop();
    }
  });

  test("keeps process alive by default; unref() allows exit", async () => {
    // ref'd: process stays alive (would block forever), so we spawn with timeout via cron
    // unref'd: process exits immediately
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const job = Bun.cron("x", "* * * * *", () => {});
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
        const job = Bun.cron("x", "* * * * *", () => {});
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

  test("distinguishes callback overload from OS-level overload", () => {
    // Callable 3rd arg → in-process; string 3rd arg → OS-level.
    // We only verify the callback path here; the string path is covered elsewhere.
    const job = Bun.cron("overload-test", "* * * * *", () => {});
    try {
      // CronJob has stop(); Promise would not
      expect(typeof job.stop).toBe("function");
      expect(job).not.toBeInstanceOf(Promise);
    } finally {
      job.stop();
    }
  });
});

// These use ._fire() to trigger immediately instead of waiting for the minute boundary.
describe("Bun.cron (in-process) — firing", () => {
  test("callback fires via _fire()", async () => {
    let fired = 0;
    const { promise, resolve } = Promise.withResolvers<void>();

    const job = Bun.cron("fire-test", "* * * * *", () => {
      fired++;
      resolve();
    });

    try {
      // @ts-expect-error test-only
      job._fire();
      await promise;
      expect(fired).toBe(1);
    } finally {
      job.stop();
    }
  });

  test("stop() during pending async callback prevents reschedule", async () => {
    const { promise: handlerPromise, resolve: resolveHandler } = Promise.withResolvers<void>();
    const { promise: firePromise, resolve: fireResolve } = Promise.withResolvers<void>();

    const job = Bun.cron("async-test", "* * * * *", async () => {
      fireResolve();
      await handlerPromise;
    });

    try {
      // @ts-expect-error test-only
      job._fire();
      await firePromise;
      // Handler is awaiting; stop while pending
      job.stop();
      resolveHandler();
      await Bun.sleep(10);
      // No crash, no reschedule (stopped before promise settled)
    } finally {
      job.stop();
    }
  });

  test("sync throw in callback emits uncaughtException", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let caught;
        process.on("uncaughtException", e => { caught = e.message; });
        const job = Bun.cron("err-sync", "* * * * *", () => {
          setTimeout(() => { job.stop(); console.log("caught=" + caught); process.exit(0); }, 100);
          throw new Error("sync-boom");
        });
        job._fire();
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("caught=sync-boom");
    expect(exitCode).toBe(0);
  });

  test("async throw in callback emits unhandledRejection", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let caught;
        process.on("unhandledRejection", e => { caught = e.message; });
        const job = Bun.cron("err-async", "* * * * *", async () => {
          setTimeout(() => { job.stop(); console.log("caught=" + caught); process.exit(0); }, 100);
          await Bun.sleep(1);
          throw new Error("async-boom");
        });
        job._fire();
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("caught=async-boom");
    expect(exitCode).toBe(0);
  });

  test("unhandled cron error exits process like setTimeout does", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const job = Bun.cron("x", "* * * * *", () => { throw new Error("boom"); });
        setTimeout(() => console.log("still alive"), 1000);
        job._fire();
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("boom");
    expect(exitCode).toBe(1);
  });

  test("fires repeatedly and reschedules after each callback", async () => {
    let fires = 0;
    const job = Bun.cron("repeat-test", "* * * * *", () => {
      fires++;
    });
    try {
      for (let i = 0; i < 3; i++) {
        const { promise, resolve } = Promise.withResolvers<void>();
        const prev = fires;
        const check = setInterval(() => {
          if (fires > prev) {
            clearInterval(check);
            resolve();
          }
        }, 5);
        // @ts-expect-error test-only
        job._fire();
        await promise;
      }
      expect(fires).toBe(3);
    } finally {
      job.stop();
    }
  });
});
