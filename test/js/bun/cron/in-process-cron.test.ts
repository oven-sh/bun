import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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
  // This test waits for a real cron fire, which takes up to 60 seconds.
  // The cron expression "* * * * *" fires at the top of every minute.
  test("callback fires at minute boundary", async () => {
    let fired = 0;
    const { promise, resolve } = Promise.withResolvers<void>();

    using job = Bun.cron("* * * * *", () => {
      fired++;
      resolve();
    });

    await promise;
    expect(fired).toBe(1);
  }, 70_000);

  test("async callback delays next scheduling", async () => {
    // The callback returns a Promise; next fire is scheduled only after it resolves.
    // We can't easily observe the timing without waiting 2+ minutes, so we just
    // verify no crash and that stop() during the pending promise works.
    const handler = Promise.withResolvers<void>();
    const fire = Promise.withResolvers<void>();

    using job = Bun.cron("* * * * *", async () => {
      fire.resolve();
      await handler.promise;
    });

    await fire.promise;
    // Handler is now awaiting; stop while it's pending
    job.stop();
    // Let the handler complete
    handler.resolve();
    await Bun.sleep(10);
    // No crash, no second fire
  }, 70_000);

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
  }, 70_000);

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
  }, 70_000);

  test("stop() while async callback pending suppresses unhandledRejection", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        process.on("unhandledRejection", () => { console.log("LEAKED"); process.exit(1); });
        const job = Bun.cron("* * * * *", async () => {
          setTimeout(() => { console.log("ok"); process.exit(0); }, 100);
          job.stop();
          await Bun.sleep(10);
          throw new Error("after-stop");
        });
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("ok");
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
    using dir = tempDir("cron-hot", {
      "app.ts": `
        import { writeFileSync, existsSync } from "node:fs";
        writeFileSync("v1.evaluated", "");
        // A fire before the v2 reload is legitimate (not a ghost) — only
        // write the marker if v2 has already evaluated.
        Bun.cron("* * * * *", () => {
          if (existsSync("v2.evaluated")) writeFileSync("ghost.fired", "");
        });
      `,
    });
    const path = (f: string) => join(String(dir), f);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "app.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "ignore",
    });

    while (!(await Bun.file(path("v1.evaluated")).exists())) await Bun.sleep(10);

    // Delete the ghost cron; replace with a sentinel that fires on the same
    // boundary. When the sentinel fires, ghost.fired must NOT exist.
    await Bun.write(
      path("app.ts"),
      `
        import { writeFileSync, existsSync } from "node:fs";
        writeFileSync("v2.evaluated", "");
        Bun.cron("* * * * *", () => {
          writeFileSync("result", existsSync("ghost.fired") ? "GHOST_FIRED" : "ok");
          process.exit(0);
        });
      `,
    );

    while (!(await Bun.file(path("v2.evaluated")).exists())) await Bun.sleep(10);
    await proc.exited;

    expect(await Bun.file(path("result")).text()).toBe("ok");
    expect(await Bun.file(path("ghost.fired")).exists()).toBe(false);
  }, 130_000);
});
