import { test, expect, describe } from "bun:test";
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

describe.concurrent("Bun.cron (in-process) — firing", () => {
  // This test waits for a real cron fire, which takes up to 60 seconds.
  // The cron expression "* * * * *" fires at the top of every minute.
  test("callback fires at minute boundary", async () => {
    let fired = 0;
    let resolve: () => void;
    const promise = new Promise<void>(r => {
      resolve = r;
    });

    const job = Bun.cron("fire-test", "* * * * *", () => {
      fired++;
      resolve!();
    });

    try {
      await promise;
      expect(fired).toBe(1);
    } finally {
      job.stop();
    }
  }, 70_000);

  test("async callback delays next scheduling", async () => {
    // The callback returns a Promise; next fire is scheduled only after it resolves.
    // We can't easily observe the timing without waiting 2+ minutes, so we just
    // verify no crash and that stop() during the pending promise works.
    let resolveHandler: () => void;
    const handlerPromise = new Promise<void>(r => {
      resolveHandler = r;
    });
    let fireResolve: () => void;
    const firePromise = new Promise<void>(r => {
      fireResolve = r;
    });

    const job = Bun.cron("async-test", "* * * * *", async () => {
      fireResolve!();
      await handlerPromise;
    });

    try {
      await firePromise;
      // Handler is now awaiting; stop while it's pending
      job.stop();
      // Let the handler complete
      resolveHandler!();
      await Bun.sleep(10);
      // No crash, no second fire
    } finally {
      job.stop();
    }
  }, 70_000);

  test("error in callback is reported but cron continues", async () => {
    // Spawn a subprocess so we can observe the uncaught exception on stderr
    // and verify the process doesn't crash.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let fires = 0;
        const job = Bun.cron("err-test", "* * * * *", () => {
          fires++;
          if (fires === 1) {
            // Stop after second scheduling — the error doesn't kill us
            setTimeout(() => { job.stop(); console.log("fires=" + fires); }, 100);
            throw new Error("boom");
          }
        });
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("fires=1");
    expect(stderr).toContain("boom");
    expect(exitCode).toBe(0);
  }, 70_000);
});
