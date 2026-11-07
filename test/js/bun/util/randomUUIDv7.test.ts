import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("randomUUIDv7", () => {
  test("basic", () => {
    expect(Bun.randomUUIDv7()).toBeTypeOf("string");

    // "0192ce01-8345-7e10-36a8-2f220ca9e4c7"
    expect(Bun.randomUUIDv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Version number:
    expect(Bun.randomUUIDv7()["0192ce01-8345-".length]).toBe("7");
  });

  test("base64 format", () => {
    const uuid = Bun.randomUUIDv7("base64");
    expect(uuid).toMatch(/^[0-9a-zA-Z+/=]+$/);
  });

  test("buffer output encoding", () => {
    const uuid = Bun.randomUUIDv7("buffer");
    expect(uuid).toBeInstanceOf(Buffer);
    expect(uuid.byteLength).toBe(16);
    console.log(uuid.toString("hex"));
  });

  test("monotonic", () => {
    const customTimestamp = 1625097600000; // 2021-07-01T00:00:00.000Z
    const input = Array.from({ length: 100 }, () => Bun.randomUUIDv7("hex", customTimestamp));
    const sorted = input.slice().sort();
    expect(sorted).toEqual(input);
  });

  test("monotonic across 12-bit counter rollover", () => {
    // 10000 UUIDs at a pinned millisecond forces at least two rollovers of the
    // 12-bit rand_a counter. The sequence must still be strictly increasing.
    const ts = 1750000000000;
    let prev = "";
    let firstBreak = -1;
    for (let i = 0; i < 10000; i++) {
      const u = Bun.randomUUIDv7("hex", ts);
      if (i > 0 && u <= prev && firstBreak === -1) firstBreak = i;
      prev = u;
    }
    expect(firstBreak).toBe(-1);
  });

  test("default path is monotonic", () => {
    // No explicit timestamp: the RFC 9562 §6.2 clamp must keep Date.now()-driven
    // calls strictly increasing regardless of how many land in one millisecond.
    let prev = "";
    let firstBreak = -1;
    for (let i = 0; i < 10000; i++) {
      const u = Bun.randomUUIDv7();
      if (i > 0 && u <= prev && firstBreak === -1) firstBreak = i;
      prev = u;
    }
    expect(firstBreak).toBe(-1);
  });

  describe("timestamp range validation", () => {
    test.each([
      ["2**48", 2 ** 48],
      ["2**53 - 1", 2 ** 53 - 1],
      ["NaN", NaN],
      ["Date(-1)", new Date(-1)],
      ["Date(2**48)", new Date(2 ** 48)],
      ["Date(8.64e15)", new Date(8.64e15)],
      ["Invalid Date", new Date(NaN)],
    ])("rejects %s", (_, ts) => {
      expect(() => Bun.randomUUIDv7("hex", ts)).toThrow(RangeError);
      expect(() => Bun.randomUUIDv7(undefined, ts)).toThrow(RangeError);
      // @ts-expect-error single-arg timestamp overload
      expect(() => Bun.randomUUIDv7(ts)).toThrow(RangeError);
    });

    test("RangeError message advertises the 48-bit bound", () => {
      const err = (() => {
        try {
          Bun.randomUUIDv7("hex", 2 ** 48);
        } catch (e) {
          return e as RangeError;
        }
        throw new Error("did not throw");
      })();
      expect(err).toBeInstanceOf(RangeError);
      expect(err.message).toContain("281474976710655");
      expect(err.message).not.toContain("9007199254740991");
    });

    test("accepts 2**48 - 1 (max 48-bit value)", async () => {
      // Subprocess: keep the explicit-timestamp counter state isolated.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const tsOf = u => parseInt(u.replaceAll("-", "").slice(0, 12), 16);
            const max = 2 ** 48 - 1;
            console.log(JSON.stringify([
              tsOf(Bun.randomUUIDv7("hex", max)),
              tsOf(Bun.randomUUIDv7(undefined, max)),
              tsOf(Bun.randomUUIDv7("hex", new Date(max))),
            ]));
          `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const max = 2 ** 48 - 1;
      expect(JSON.parse(stdout)).toEqual([max, max, max]);
      expect(exitCode).toBe(0);
    });

    test("counter rollover at 2**48-1 clamps instead of wrapping to epoch 0", async () => {
      // 5000 calls at the max 48-bit timestamp forces the 12-bit counter to roll
      // over at least once; the bumped timestamp must clamp at 2**48-1, not wrap.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const tsOf = u => parseInt(u.replaceAll("-", "").slice(0, 12), 16);
            const max = 2 ** 48 - 1;
            let bad = -1;
            for (let i = 0; i < 5000; i++) {
              if (tsOf(Bun.randomUUIDv7("hex", max)) !== max) { bad = i; break; }
            }
            console.log(bad);
          `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("-1");
      expect(exitCode).toBe(0);
    });
  });

  // The remaining tests pass explicit timestamps far from now. Explicit calls
  // track their own counter state, so run each in a fresh subprocess to keep
  // that state isolated across tests.

  test("custom timestamp", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const ts = 4099680000000; // 2099-11-30T00:00:00.000Z
          console.log(Bun.randomUUIDv7("hex", ts));
          console.log(Bun.randomUUIDv7("hex", new Date(ts + 1)));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const [a, b] = stdout.trim().split("\n");
    expect(a).toStartWith("03ba87f8-5800-");
    expect(b).toStartWith("03ba87f8-5801-");
    expect(exitCode).toBe(0);
  });

  test("explicit timestamp is encoded verbatim", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const tsOf = u => parseInt(u.replaceAll("-", "").slice(0, 12), 16);
          // Prior default call must not cause a later explicit past timestamp
          // to be clamped to now.
          Bun.randomUUIDv7();
          const past = 1625097600000; // 2021-07-01T00:00:00.000Z
          // A second explicit call at a different, older timestamp must also be
          // encoded verbatim (explicit calls never clamp to the previous one).
          const older = 1;
          console.log(JSON.stringify({
            hex:    tsOf(Bun.randomUUIDv7("hex", past)),
            single: tsOf(Bun.randomUUIDv7(past)),
            date:   tsOf(Bun.randomUUIDv7("hex", new Date(past))),
            older:  tsOf(Bun.randomUUIDv7("hex", older)),
          }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      hex: 1625097600000,
      single: 1625097600000,
      date: 1625097600000,
      older: 1,
    });
    expect(exitCode).toBe(0);
  });

  test("explicit timestamp does not rebase later default calls", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const tsOf = u => parseInt(u.replaceAll("-", "").slice(0, 12), 16);
          // One far-future explicit call must not move the default path's
          // monotonic state; subsequent default calls still encode ~now.
          Bun.randomUUIDv7("hex", Date.now() + 86_400_000);
          console.log(tsOf(Bun.randomUUIDv7()) - Date.now());
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // On the regression this is ~86_400_000. A 60s bound absorbs clock-source
    // jitter between JS Date.now() and the native millisecond clock on Windows.
    const skew = Number(stdout.trim());
    expect(Math.abs(skew)).toBeLessThan(60_000);
    expect(exitCode).toBe(0);
  });

  test("counter is seeded pseudo-randomly on a new millisecond", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          // Sample the first UUID of several fresh milliseconds. The 12-bit rand_a
          // field (bytes 6-7, low 12 bits) should not be the same constant every time.
          const seen = new Set();
          let ts = 5_000_000_000_000;
          for (let i = 0; i < 64; i++) {
            ts += 1_000_000;
            const buf = Bun.randomUUIDv7("buffer", ts);
            seen.add(((buf[6] & 0x0f) << 8) | buf[7]);
          }
          console.log(seen.size);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // With an 11-bit random seed, 64 independent draws collapsing to one value
    // has probability 2^-693. A fixed reset (the old behavior) yields size 1.
    expect(Number(stdout.trim())).toBeGreaterThan(1);
    expect(exitCode).toBe(0);
  });

  // Bun.randomUUIDv7() keeps its last timestamp and its counter for the whole
  // process, so each script below runs in a process of its own.
  async function run(cmd: string[], cwd?: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("node:crypto randomUUIDv7() leaves the counter of Bun.randomUUIDv7() alone", async () => {
    const { stdout, stderr, exitCode } = await run([
      "-e",
      `
        import { randomUUIDv7 } from "node:crypto";
        // The 12 bits after the version digit count the UUIDs of one millisecond.
        const counter = uuid => parseInt(uuid.slice(15, 18), 16);
        const steps = [undefined, { disableEntropyCache: true }].map(options => {
          for (let i = 0; i < 100_000; i++) {
            const before = Bun.randomUUIDv7();
            randomUUIDv7(options);
            const after = Bun.randomUUIDv7();
            // Same 48-bit timestamp: the two are in one millisecond.
            if (before.slice(0, 13) === after.slice(0, 13)) return counter(after) - counter(before);
          }
          return "no two calls in one millisecond";
        });
        console.log(JSON.stringify(steps));
      `,
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([1, 1]);
    expect(exitCode).toBe(0);
  });

  // bun:test mocks the time of one global. It must not get into the state that
  // the whole process shares: other Workers and later test files read it.
  describe("a time mocked by bun:test", () => {
    // stamp(uuid) is "real" when the timestamp in the UUID is within a minute of the real time.
    const prelude = `
      import { jest, setSystemTime, vi } from "bun:test";
      import { randomUUIDv7 } from "node:crypto";
      const DAY = 86_400_000;
      const real = Date.now();
      const stamp = uuid => {
        const skew = parseInt(uuid.replaceAll("-", "").slice(0, 12), 16) - real;
        return Math.abs(skew) < 60_000 ? "real" : skew + " ms from the real time";
      };
      const dateNow = () => (Math.abs(Date.now() - real) < 60_000 ? "real" : "mocked");
    `;

    test.concurrent.each([
      ["setSystemTime(real + DAY)", "setSystemTime()"],
      ["setSystemTime(Date.UTC(2000, 0, 1))", "setSystemTime()"],
      // Past the 48 bits of the timestamp field, and past a u64.
      ["setSystemTime(2 ** 48 + 5)", "setSystemTime()"],
      ["setSystemTime(1e300)", "setSystemTime()"],
      ["jest.useFakeTimers({ now: real + DAY }); jest.advanceTimersByTime(3_600_000)", "jest.useRealTimers()"],
      ["vi.useFakeTimers({ now: real + DAY }); vi.advanceTimersByTime(3_600_000)", "vi.useRealTimers()"],
    ])("the default timestamp is the real time under %s, and after it", async (mock, restore) => {
      const { stdout, stderr, exitCode } = await run([
        "-e",
        `${prelude}
          ${mock};
          const mocked = {
            dateNow: dateNow(),
            node: stamp(randomUUIDv7()),
            nodeWithoutCache: stamp(randomUUIDv7({ disableEntropyCache: true })),
            bun: stamp(Bun.randomUUIDv7()),
          };
          ${restore};
          const restored = { dateNow: dateNow(), node: stamp(randomUUIDv7()), bun: stamp(Bun.randomUUIDv7()) };
          console.log(JSON.stringify({ mocked, restored }));
        `,
      ]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        mocked: { dateNow: "mocked", node: "real", nodeWithoutCache: "real", bun: "real" },
        restored: { dateNow: "real", node: "real", bun: "real" },
      });
      expect(exitCode).toBe(0);
    });

    // docs/test/dates-times.mdx gives this call as the way to get a UUID at the mocked time.
    test.concurrent("an explicit timestamp gives a UUID at the mocked time", async () => {
      const { stdout, stderr, exitCode } = await run([
        "-e",
        `
          import { setSystemTime } from "bun:test";
          const timestamp = uuid => parseInt(uuid.replaceAll("-", "").slice(0, 12), 16);
          setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
          const whole = timestamp(Bun.randomUUIDv7("hex", new Date()));
          // Date.now() has the fraction. A Date does not.
          setSystemTime(1577836800000.5);
          const fraction = timestamp(Bun.randomUUIDv7("hex", new Date()));
          console.log(JSON.stringify({ whole, fraction }));
        `,
      ]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ whole: 1577836800000, fraction: 1577836800000 });
      expect(exitCode).toBe(0);
    });

    // The tests from here on are not concurrent. A Worker and a test run take the
    // longest to start in a debug build, and more so with other processes beside them.
    test("a Worker that starts after the mock gets the real time", async () => {
      const { stdout, stderr, exitCode } = await run([
        "-e",
        `${prelude}
          import { once } from "node:events";
          import { Worker } from "node:worker_threads";
          setSystemTime(real + DAY);
          randomUUIDv7();
          setSystemTime();
          const worker = new Worker(
            "require('node:worker_threads').parentPort.postMessage(Bun.randomUUIDv7())",
            { eval: true },
          );
          const [uuid] = await once(worker, "message");
          console.log(stamp(uuid));
          await worker.terminate();
        `,
      ]);
      expect(stderr).toBe("");
      expect(stdout).toBe("real\n");
      expect(exitCode).toBe(0);
    });

    test.each([
      ["without --isolate", []],
      ["with --isolate", ["--isolate"]],
    ])("the next test file gets the real time %s", async (_, flags) => {
      using dir = tempDir("uuidv7-mocked-time", {
        "a.test.ts": `
          import { setSystemTime, test } from "bun:test";
          import { randomUUIDv7 } from "node:crypto";
          test("a mocks the time", () => {
            setSystemTime(Date.now() + 86_400_000);
            try {
              randomUUIDv7();
            } finally {
              setSystemTime();
            }
          });
        `,
        "b.test.ts": `
          import { expect, test } from "bun:test";
          test("b gets the real time", () => {
            const skew = parseInt(Bun.randomUUIDv7().replaceAll("-", "").slice(0, 12), 16) - Date.now();
            expect(Math.abs(skew)).toBeLessThan(60_000);
          });
        `,
      });
      const { stderr, exitCode } = await run(["test", ...flags, "./a.test.ts", "./b.test.ts"], String(dir));
      expect(stderr).toContain("(pass) b gets the real time");
      expect(exitCode).toBe(0);
    });
  });
});
