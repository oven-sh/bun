// https://github.com/oven-sh/bun/issues/34231
// DataView getBigInt64/getBigUint64/setBigInt64/setBigUint64 are inlined by
// the DFG/FTL JITs. This exercises the optimized paths in a hot loop and
// checks the results and error paths stay correct across tier-up.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("DataView BigInt64/BigUint64 accessors stay correct under the JIT", async () => {
  const script = /* js */ `
    function check(cond, msg) {
      if (!cond) {
        console.error("FAIL: " + msg);
        process.exit(1);
      }
    }

    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);

    function roundtripUnsigned(v, o, x, le) {
      v.setBigUint64(o, x, le);
      return v.getBigUint64(o, le);
    }
    function roundtripSigned(v, o, x, le) {
      v.setBigInt64(o, x, le);
      return v.getBigInt64(o, le);
    }

    const M = 1n << 64n;
    const vals = [
      0n, 1n, -1n,
      0xffffffffffffffffn, 0x8000000000000000n, 0x7fffffffffffffffn,
      0x0102030405060708n,
      (1n << 64n) + 5n, -((1n << 100n) + 123n), // multi-digit: wraps mod 2^64
      -(1n << 63n),
    ];
    // Precompute the expected wrapped values so the hot loop only exercises
    // the DataView accessors.
    const expectedU = vals.map(x => ((x % M) + M) % M);
    const expectedS = expectedU.map(u => (u >= 1n << 63n ? u - M : u));
    for (let i = 0; i < 50000; i++) {
      const j = i % vals.length;
      const le = (i & 1) === 0;
      if (roundtripUnsigned(view, (i * 3) % 24, vals[j], le) !== expectedU[j])
        check(false, "u64 " + vals[j] + " le=" + le + " i=" + i);
      if (roundtripSigned(view, (i * 5) % 24, vals[j], le) !== expectedS[j])
        check(false, "i64 " + vals[j] + " le=" + le + " i=" + i);
    }

    // Endianness against a byte-level reference.
    view.setBigUint64(0, 0x1122334455667788n, false);
    check(view.getBigUint64(0, true) === 0x8877665544332211n, "endianness");
    check(bytes[0] === 0x11 && bytes[7] === 0x88, "big-endian byte layout");

    // Error paths must still throw after tier-up.
    let threw = false;
    try {
      view.setBigUint64(0, 42);
    } catch (e) {
      threw = e instanceof TypeError;
    }
    check(threw, "TypeError for number value");
    threw = false;
    try {
      view.getBigUint64(25);
    } catch (e) {
      threw = e instanceof RangeError;
    }
    check(threw, "RangeError for out-of-bounds get");
    threw = false;
    try {
      view.setBigInt64(31, 1n);
    } catch (e) {
      threw = e instanceof RangeError;
    }
    check(threw, "RangeError for out-of-bounds set");

    // BigInt values still work after the error-path exits.
    view.setBigUint64(0, 7n, true);
    check(view.getBigUint64(0, true) === 7n, "works after exits");

    // GC stress: results are real, independent BigInts.
    view.setBigUint64(8, 0xdeadbeefcafebaben, true);
    const keep = [];
    for (let i = 0; i < 20000; i++) {
      keep.push(view.getBigUint64(8, true));
      if (keep.length > 64) keep.shift();
      if (i % 5000 === 0) Bun.gc(true);
    }
    for (const k of keep) check(k === 0xdeadbeefcafebaben, "gc stress value");

    console.log("PASS");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("PASS");
  expect(stderr).not.toContain("FAIL");
  expect(exitCode).toBe(0);
});
