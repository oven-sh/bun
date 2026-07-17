import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

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

  // The remaining tests pass far-future timestamps. UUID_V7_LAST_TIMESTAMP is a
  // process-global that never moves backward, so run each in a fresh subprocess
  // to avoid leaving the test process parked in the year 2100+.

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

  test("older explicit timestamps do not move UUIDs backward", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const latest = Bun.randomUUIDv7("hex", 4_500_000_000_000);
          const stale  = Bun.randomUUIDv7("hex", 1);
          console.log(JSON.stringify({
            increasing: stale > latest,
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
      increasing: true,
      latestPrefix: "0417bce6-c800",
      stalePrefix: "0417bce6-c800",
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

  // https://github.com/oven-sh/WebKit/pull/304
  test.skipIf(!isWindows)("Date.now() is never ahead of performance.timeOrigin + performance.now()", async () => {
    // Subprocess so timeOrigin is captured milliseconds before the loop and
    // w32tm slew between VM init and test cannot drift the two clocks apart.
    // Before, Date.now() ran ~0.4ms ahead in ~72% of samples.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const origin = performance.timeOrigin;
          // origin + perf.now() at ~1.8e12 has ~0.0004ms double ULP; the old
          // skew was ~0.4ms, so a 0.01ms threshold separates the two cleanly.
          let firstAhead = null;
          for (let i = 0; i < 50_000; i++) {
            const d = Date.now();
            const p = origin + performance.now();
            if (d - p > 0.01 && firstAhead === null) firstAhead = { i, d, p, diff: +(d - p).toFixed(4) };
          }
          console.log(JSON.stringify(firstAhead));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toBe(null);
    expect(exitCode).toBe(0);
  });

  test("default timestamp is never behind Date.now()", async () => {
    // All three default to js_date_now() (== Date.now()). UUID7::init may bump
    // the embedded ts on 12-bit counter rollover (RFC 9562 §6.2), so only the
    // lower bound is asserted for UUIDs; File.lastModified has no counter.
    const N = isWindows ? 50_000 : 5_000;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const crypto = require("node:crypto");
          const tsOf = buf => buf.readUIntBE(0, 6);
          const tsOfHex = s => parseInt(s.replaceAll("-", "").slice(0, 12), 16);
          let bad = { bun: null, node: null, file: null };
          for (let i = 0; i < ${N}; i++) {
            const before = Date.now();
            const b = tsOf(Bun.randomUUIDv7("buffer"));
            const c = tsOfHex(crypto.randomUUIDv7());
            const f = new File([], "x").lastModified;
            const after = Date.now();
            if (bad.bun  === null && !(before <= b)) bad.bun  = { i, before, b };
            if (bad.node === null && !(before <= c)) bad.node = { i, before, c };
            if (bad.file === null && !(before <= f && f <= after)) bad.file = { i, before, f, after };
            if (bad.bun && bad.node && bad.file) break;
          }
          console.log(JSON.stringify(bad));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ bun: null, node: null, file: null });
    expect(exitCode).toBe(0);
  });

  test("default timestamp respects setSystemTime()", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { setSystemTime } = require("bun:test");
          const crypto = require("node:crypto");
          const tsOf = s => parseInt(s.replaceAll("-", "").slice(0, 12), 16);
          const pin = 1_700_000_000_000;
          setSystemTime(pin);
          console.log(JSON.stringify({
            dateNow: Date.now(),
            bun: tsOf(Bun.randomUUIDv7()),
            node: tsOf(crypto.randomUUIDv7()),
            file: new File([], "x").lastModified,
          }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      dateNow: 1_700_000_000_000,
      bun: 1_700_000_000_000,
      node: 1_700_000_000_000,
      file: 1_700_000_000_000,
    });
    expect(exitCode).toBe(0);
  });
});
