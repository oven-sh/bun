// https://github.com/oven-sh/bun/issues/30757
// Set/Map iteration corrupted oversized integer-valued doubles to INT32_MIN.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("Set iteration preserves numeric values outside Int32 range", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const values = [
        1751241600000,          // epoch-ms timestamp from the bug report
        2147483648,             // INT32_MAX + 1
        -2147483649,            // INT32_MIN - 1
        4294967296,             // 2^32
        Number.MAX_SAFE_INTEGER,
        -Number.MAX_SAFE_INTEGER,
        1e15,
      ];
      const out = {};
      for (const v of values) {
        out[String(v)] = [...new Set([v])][0];
      }
      // ±Infinity and NaN can't round-trip through JSON (all three serialize
      // to null), so do identity checks in-subprocess and ship the booleans.
      out.posInfPreserved = [...new Set([Infinity])][0] === Infinity;
      out.negInfPreserved = [...new Set([-Infinity])][0] === -Infinity;
      out.nanPreserved = Number.isNaN([...new Set([NaN])][0]);
      console.log(JSON.stringify(out));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "1751241600000": 1751241600000,
    "2147483648": 2147483648,
    "-2147483649": -2147483649,
    "4294967296": 4294967296,
    "9007199254740991": Number.MAX_SAFE_INTEGER,
    "-9007199254740991": -Number.MAX_SAFE_INTEGER,
    "1000000000000000": 1e15,
    posInfPreserved: true,
    negInfPreserved: true,
    nanPreserved: true,
  });
  expect(exitCode).toBe(0);
});

test.concurrent("Set.has does not match the INT32_MIN corruption target after normalization", async () => {
  // Before the fix, `add(1751241600000)` normalized the key to INT32_MIN,
  // so `s.has(-2147483648)` spuriously returned true. Size was 1 either
  // way, but adding multiple oversized doubles collapsed them all into a
  // single bucket.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const s = new Set();
      s.add(1);
      s.add(2);
      s.add(1751241600000);
      s.add(9007199254740991);
      console.log(JSON.stringify({
        size: s.size,
        iterated: [...s],
        hasOriginal: s.has(1751241600000),
        hasCorruptionTarget: s.has(-2147483648),
      }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    size: 4,
    iterated: [1, 2, 1751241600000, 9007199254740991],
    hasOriginal: true,
    hasCorruptionTarget: false,
  });
  expect(exitCode).toBe(0);
});

test.concurrent("Map iteration preserves numeric keys outside Int32 range", async () => {
  // Map shares normalizeMapKey with Set via OrderedHashTable. Cover it
  // too so the fix is locked in for both.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const m = new Map();
      m.set(1751241600000, "a");
      m.set(9007199254740991, "b");
      m.set(1, "c");
      console.log(JSON.stringify({
        size: m.size,
        keys: [...m.keys()],
        values: [...m.values()],
        getOriginal: m.get(1751241600000),
        getCorruptionTarget: m.get(-2147483648) ?? null,
      }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    size: 3,
    keys: [1751241600000, 9007199254740991, 1],
    values: ["a", "b", "c"],
    getOriginal: "a",
    getCorruptionTarget: null,
  });
  expect(exitCode).toBe(0);
});
