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

  test("zero-arg calls are strictly increasing", () => {
    // The implicit (Date.now()) path carries the RFC 9562 §6.2 monotonic clamp
    // and counter-rollover bump. Every call must sort after the previous one.
    let prev = "";
    let firstBreak = -1;
    for (let i = 0; i < 10000; i++) {
      const u = Bun.randomUUIDv7();
      if (i > 0 && u <= prev && firstBreak === -1) firstBreak = i;
      prev = u;
    }
    expect(firstBreak).toBe(-1);
  });

  test("explicit timestamp is embedded verbatim regardless of call order", async () => {
    // Backfill scenario: historical timestamps processed out of order. Each UUID
    // must encode the caller's timestamp exactly, never a process high-water mark.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const tsOf = u => parseInt(u.replaceAll("-", "").slice(0, 12), 16);
          const stamps = [
            Date.parse("2023-03-01T00:00:00Z"),
            Date.parse("2021-01-01T00:00:00Z"),
            Date.parse("2022-02-01T00:00:00Z"),
            Date.parse("2021-01-01T00:00:00Z"),
          ];
          console.log(JSON.stringify(stamps.map(t => tsOf(Bun.randomUUIDv7("hex", t)) - t)));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([0, 0, 0, 0]);
    expect(exitCode).toBe(0);
  });

  test("explicit and implicit calls do not share monotonic state", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const tsOf = u => parseInt(u.replaceAll("-", "").slice(0, 12), 16);
          // Park the implicit generator at "now", then ask for a 2021 timestamp.
          Bun.randomUUIDv7();
          const explicit = 1625097600000; // 2021-07-01T00:00:00.000Z
          const got = tsOf(Bun.randomUUIDv7("hex", explicit));
          // And a far-future explicit call must not drag zero-arg calls into the future.
          Bun.randomUUIDv7("hex", 4_500_000_000_000);
          const before = Date.now();
          const now = tsOf(Bun.randomUUIDv7());
          const after = Date.now();
          console.log(JSON.stringify({ got, explicit, nowOk: now >= before && now <= after }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ got: 1625097600000, explicit: 1625097600000, nowOk: true });
    expect(exitCode).toBe(0);
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
      // Subprocess: 2**48-1 would park the process-global timestamp at year 10889.
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

    test("explicit 2**48-1 stays at 2**48-1 across many calls", async () => {
      // An explicit timestamp is embedded verbatim, so 5000 calls at the max
      // 48-bit value must all encode exactly that value.
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

  // The remaining tests pass far-future explicit timestamps. Explicit calls
  // maintain their own process-global counter state, so run each in a fresh
  // subprocess to keep that state pristine.

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

  test("older explicit timestamp after a newer one is still embedded verbatim", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const latest = Bun.randomUUIDv7("hex", 4_500_000_000_000);
          const stale  = Bun.randomUUIDv7("hex", 1);
          console.log(JSON.stringify({
            latestPrefix: latest.slice(0, 13),
            stalePrefix:  stale.slice(0, 13),
          }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      latestPrefix: "0417bce6-c800",
      stalePrefix: "00000000-0001",
    });
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
