import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Coverage for oven-sh/WebKit#565 (oven-sh/bun#41399). On x64, ToInt32 of a
// double outside [-2^31, 2^31) left the JIT for a C++ call on every operand.
// A table of 32 bit constants such as the aes-js T1..T4 tables is stored as
// doubles, so half of its entries took that call. The fix keeps every |x| < 2^63
// in JIT code, so the table with large values costs the same as the table with
// small values. The unfixed engine is 8x to 10x slower on the large table.

test("ToInt32 of a double outside the int32 range stays on the JIT fast path", async () => {
  const source = `
    const N = 4_000_000;
    // Both tables are Float64Array, so both loops load a double and convert it
    // with ToInt32. Only the magnitude of the values differs.
    const small = new Float64Array(256);
    const large = new Float64Array(256);
    for (let i = 0; i < 256; i++) {
      small[i] = 0x0c66363a + i;
      large[i] = i % 2 ? 0xc66363a5 + i : 0x0c66363a + i;
    }
    // A data dependent index, so the unfixed slow path branch mispredicts too.
    const index = new Uint8Array(N);
    let state = 0x6d2b79f5;
    for (let i = 0; i < N; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      index[i] = state & 0xff;
    }

    function xorAll(table) {
      let s = 0;
      for (let i = 0; i < N; i++) s ^= table[index[i]];
      return s;
    }

    function best(table) {
      let result = Infinity;
      for (let run = 0; run < 7; run++) {
        const start = performance.now();
        xorAll(table);
        result = Math.min(result, performance.now() - start);
      }
      return result;
    }

    // Warm up: reach the optimizing tiers on both tables before timing.
    for (let run = 0; run < 3; run++) {
      xorAll(small);
      xorAll(large);
    }
    console.log(JSON.stringify({ small: best(small), large: best(large) }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const { small, large } = JSON.parse(stdout);
  expect(small).toBeGreaterThan(0);
  expect(large / small).toBeLessThan(3);
});
