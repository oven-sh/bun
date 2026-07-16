import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
});
