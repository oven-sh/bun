import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import vm from "node:vm";

// JSC caps a BigInt at 2^30 bits, like V8, and multiplies, divides, parses and formats them in
// sub-quadratic time, so BigInt workloads that run on Node also run here. A termination request
// (here a vm timeout) stops the operation from inside the algorithm.

const fibonacciSource = /* js */ `
  function mulMatrix(a, b) {
    const x = a[0] * b[0] + a[1] * b[2];
    const y = a[0] * b[1] + a[1] * b[3];
    const z = a[2] * b[0] + a[3] * b[2];
    const w = a[2] * b[1] + a[3] * b[3];
    a[0] = x; a[1] = y; a[2] = z; a[3] = w;
  }
  function power(f, n) {
    if (n <= 1) return;
    power(f, Math.floor(n / 2));
    mulMatrix(f, f.slice());
    if (n % 2) mulMatrix(f, [1n, 1n, 1n, 0n]);
  }
  function fibonacci(n) {
    const f = [1n, 1n, 1n, 0n];
    power(f, n - 1);
    return f[0];
  }
`;

describe("large BigInt", () => {
  // The issue computes the 5,000,000th number; the 1,600,000th is the smallest round figure past
  // the old 2^20-bit cap, and runs in a few seconds even in a debug build.
  test.concurrent("a Fibonacci number past the old cap (oven-sh/bun#39964)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `${fibonacciSource}
        const s = String(fibonacci(1_600_000));
        console.log(s.length, s.slice(0, 20), s.slice(-20));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("334380 74974739211622868033 21494169961451746875\n");
    expect(exitCode).toBe(0);
  });

  test("values up to 2^30 bits are representable", () => {
    const bits = 1 << 30;
    const max = (1n << BigInt(bits - 1)) | 12345n;
    expect(max >> BigInt(bits - 1)).toBe(1n);
    expect(max & 0xffffn).toBe(12345n);
    expect(() => 1n << BigInt(bits)).toThrow(RangeError);
    expect(() => max * 2n).toThrow(RangeError);
    // A 2^28-bit value round-trips through its 64M-character hexadecimal form.
    const value = (1n << BigInt((1 << 28) - 1)) | 0xabcdefn;
    const hex = value.toString(16);
    expect(hex.length).toBe(1 << 26);
    expect(BigInt("0x" + hex)).toBe(value);
  });

  test("multiplication, division and remainder agree at millions of bits", () => {
    const x = (1n << 1_000_003n) - 0xdeadbeefn;
    const y = (1n << 699_999n) + 0xcafen;
    const product = x * y;
    expect(product / y).toBe(x);
    expect(product % y).toBe(0n);
    expect((product + 1n) % y).toBe(1n);
    expect((product + y - 1n) / y).toBe(x);
    // The division paths are independent of the multiplication paths, so an exact inverse is a
    // strong check; the quotient of a deliberately shifted value is too.
    expect((x << 500_000n) / x).toBe(1n << 500_000n);
  });

  test("decimal formatting and parsing are each other's inverse past the old cap", () => {
    const value = (1n << 1_100_000n) - 0x1234567n;
    const decimal = value.toString();
    expect(decimal.length).toBe(331133);
    expect(BigInt(decimal)).toBe(value);
    expect(BigInt(" -" + decimal + " ")).toBe(-value);
    expect((10n ** 100_000n).toString()).toBe("1" + Buffer.alloc(100_000, "0").toString());
    expect(BigInt(Buffer.alloc(100_000, "9").toString())).toBe(10n ** 100_000n - 1n);
  });

  // The algorithm dispatch is by digit count (64-bit digits): Karatsuba multiplication from 44
  // digits, Toom-3 from 480, FFT from 2300 combined, Burnikel-Ziegler division at divisor and
  // quotient >= 57, Barrett at 13000, divide-and-conquer toString from 14, balanced-tree parsing
  // from 4 digit-sized chunks. The grids below straddle every crossover so each algorithm and each
  // handoff between them runs on every platform, verified by identities instead of fixtures.
  const seededValue = (bits: number, seed: bigint): bigint => {
    let s = seed | 1n;
    const lanes: string[] = [];
    for (let generated = 0; generated < bits; generated += 64) {
      s ^= (s << 13n) & 0xffffffffffffffffn;
      s ^= s >> 7n;
      s ^= (s << 17n) & 0xffffffffffffffffn;
      lanes.push(s.toString(16).padStart(16, "0"));
    }
    return (BigInt("0x" + lanes.join("")) | (1n << BigInt(bits - 1))) & ((1n << BigInt(bits)) - 1n);
  };

  test("multiplication agrees with its own splittings at every algorithm crossover", () => {
    // Splitting x at k must not change the product: a mismatch means two size regimes disagree.
    const checkSplits = (x: bigint, y: bigint) => {
      const product = x * y;
      for (const denominator of [2n, 3n, 16n]) {
        const k = (BigInt(bitLength(x)) / denominator) | 1n;
        const [high, low] = [x >> k, x & ((1n << k) - 1n)];
        expect(((high * y) << k) + low * y).toBe(product);
      }
      expect(-x * y).toBe(-product);
      expect((x + 1n) * y - y).toBe(product);
    };
    const bitLength = (v: bigint) => v.toString(16).length * 4;
    let seed = 0x9e3779b97f4a7c15n;
    for (const [xDigits, yDigits] of [
      [43, 43],
      [44, 44],
      [45, 45],
      [64, 44],
      [479, 479],
      [480, 480],
      [481, 480],
      [599, 599],
      [601, 601],
      [1149, 1151],
      [1200, 1200],
      [1000, 43],
      [1000, 45],
      [2000, 57],
      [4000, 480],
    ]) {
      checkSplits(seededValue(xDigits * 64, seed++), seededValue(yDigits * 64 - 7, seed++));
    }
    // All-ones and single-bit operands have closed forms, independent of any multiplication.
    for (const digits of [44, 480, 600, 1200, 2400]) {
      const n = BigInt(digits * 64);
      const y = seededValue(digits * 32, seed++);
      expect(((1n << n) - 1n) * y).toBe((y << n) - y);
      expect((1n << n) * y).toBe(y << n);
    }
    // (2^n - a)(2^m - b) = 2^(n+m) - a 2^m - b 2^n + ab covers the FFT and its chunked form
    // (x > 100y) with only shifts and small products as the reference.
    for (const [xDigits, yDigits] of [
      [1600, 1400],
      [2400, 2400],
      [130000, 1200],
    ]) {
      const [n, m] = [BigInt(xDigits * 64), BigInt(yDigits * 64)];
      const [a, b] = [0x1234567n, 0xfedcba9n];
      expect(((1n << n) - a) * ((1n << m) - b)).toBe((1n << (n + m)) - ((a << m) + (b << n)) + a * b);
    }
  });

  test("division satisfies the Euclidean identity at every algorithm crossover", () => {
    const checkDivision = (x: bigint, y: bigint) => {
      const [quotient, remainder] = [x / y, x % y];
      expect(quotient * y + remainder).toBe(x);
      expect(remainder >= 0n).toBe(true);
      expect(remainder < y).toBe(true);
      // ECMAScript division truncates toward zero.
      expect(-x / y).toBe(-quotient);
      expect(-x % y).toBe(-remainder);
      expect(x / -y).toBe(-quotient);
      expect(x % -y).toBe(remainder);
    };
    let seed = 0xdeadbeefcafen;
    for (const [xDigits, yDigits] of [
      [56, 28],
      [57, 56],
      [58, 57],
      [113, 57],
      [114, 57],
      [115, 58],
      [300, 57],
      [512, 256],
      [1024, 57],
      [2000, 1000],
      [4000, 3999],
      [26002, 13001], // Barrett
    ]) {
      checkDivision(seededValue(xDigits * 64, seed++), seededValue(yDigits * 64 - 13, seed++));
    }
    // Exact multiples, and remainders at both ends of their range.
    for (const [qDigits, yDigits] of [
      [57, 57],
      [56, 58],
      [400, 130],
      [13001, 13001],
    ]) {
      const q = seededValue(qDigits * 64, seed++);
      const y = seededValue(yDigits * 64, seed++);
      const exact = q * y;
      expect(exact / y).toBe(q);
      expect(exact % y).toBe(0n);
      expect((exact + 1n) % y).toBe(1n);
      expect((exact - 1n) % y).toBe(y - 1n);
      expect((exact + y - 1n) / y).toBe(q);
    }
  });

  test("toString and parsing cross-check across radixes, thresholds and digit boundaries", () => {
    // An independent reference: parse radix chunks with Number and combine with verified arithmetic.
    const hornerParse = (text: string, radix: number): bigint => {
      let value = 0n;
      for (let i = 0; i < text.length; i += 7) {
        const chunk = text.slice(i, i + 7);
        value = value * BigInt(radix ** chunk.length) + BigInt(parseInt(chunk, radix));
      }
      return value;
    };
    let seed = 0x5eed5eed5eedn;
    for (const digits of [13, 14, 15, 30, 64, 200, 1000]) {
      const value = seededValue(digits * 64, seed++);
      for (const radix of [3, 10, 16, 36]) {
        expect(hornerParse(value.toString(radix), radix)).toBe(value);
      }
    }
    for (const bits of [63, 64, 65, 830, 1979, 1980, 1981, 64_000, 1_200_000]) {
      const value = seededValue(bits, seed++);
      // Power-of-two radixes pack bits directly; 10 goes through the balanced tree both ways.
      expect(BigInt("0b" + value.toString(2))).toBe(value);
      expect(BigInt("0o" + value.toString(8))).toBe(value);
      expect(BigInt("0x" + value.toString(16))).toBe(value);
      expect(BigInt(value.toString(10))).toBe(value);
    }
    // The dispatch by input length must not be confused by leading zeros or whitespace.
    const small = seededValue(190, seed++);
    expect(BigInt("0".repeat(1000) + small.toString(10))).toBe(small);
    expect(BigInt("0x" + "0".repeat(1000) + small.toString(16))).toBe(small);
    expect(BigInt("  " + small.toString(10) + "\n\t")).toBe(small);
    expect(BigInt("0".repeat(4321))).toBe(0n);
    // Invalid characters are rejected wherever they sit relative to the chunk boundaries.
    for (const position of [0, 18, 19, 20, 57, 58, 500]) {
      const good = "1".repeat(501);
      expect(() => BigInt(good.slice(0, position) + "!" + good.slice(position + 1))).toThrow(SyntaxError);
    }
    expect(() => BigInt("0x" + "c".repeat(400) + "g")).toThrow(SyntaxError);
    // Closed forms for the formatter.
    expect((10n ** 5000n - 1n).toString()).toBe("9".repeat(5000));
    expect(((1n << 40_000n) - 1n).toString(16)).toBe("f".repeat(10_000));
    expect((36n ** 900n).toString(36)).toBe("1" + "0".repeat(900));
  });

  test("exponentiation composes with multiplication at the crossovers", () => {
    let seed = 0xabcdef012345n;
    for (const digits of [22, 44, 240, 1200]) {
      const x = seededValue(digits * 64, seed++);
      expect(x ** 2n).toBe(x * x);
      expect(x ** 3n).toBe(x * x * x);
    }
    expect(2n ** 1_000_000n).toBe(1n << 1_000_000n);
    expect(3n ** 100_000n).toBe((3n ** 50_000n) ** 2n);
    // Mixed magnitudes and trivial operands stay exact.
    const huge = seededValue(2400 * 64, seed++);
    expect(huge * 0n).toBe(0n);
    expect(huge * 1n).toBe(huge);
    expect(huge * -1n).toBe(-huge);
    expect(huge % 1n).toBe(0n);
    expect(huge / huge).toBe(1n);
    expect((huge * 7n) / 7n).toBe(huge);
    expect(huge ** 1n).toBe(huge);
    expect(huge ** 0n).toBe(1n);
  });

  test("a vm timeout stops a long multiplication inside the algorithm", () => {
    const bits = 1 << 29;
    const x = (1n << BigInt(bits)) - 12345n;
    const y = (1n << BigInt(bits - 1)) + 777n;
    const start = performance.now();
    expect(() => vm.runInNewContext("x * y", { x, y }, { timeout: 50 })).toThrow(
      expect.objectContaining({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT" }),
    );
    // Without the interrupt check the product takes seconds; with it the run stops within a
    // few million digit multiplications of the deadline.
    expect(performance.now() - start).toBeLessThan(isDebug || isASAN ? 5000 : 1000);
    // The VM is usable afterwards and the operands are intact.
    expect(vm.runInNewContext("(x % 1000n) + (y % 1000n)", { x, y })).toBe((x % 1000n) + (y % 1000n));
  });

  test("terminated operations do not leak their scratch buffers", () => {
    const x = (1n << BigInt(1 << 26)) - 12345n;
    const y = (1n << BigInt((1 << 26) - 1)) + 777n;
    const run = () => {
      try {
        vm.runInNewContext("x * y", { x, y }, { timeout: 5 });
      } catch (error) {
        expect(error.code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
      }
    };
    // The allocator does not return freed pages promptly, so compare two steady-state batches
    // instead of a fresh baseline: a leak grows every batch, arena expansion only the first.
    const batch = (runs: number) => {
      for (let i = 0; i < runs; i++) run();
      Bun.gc(true);
      return process.memoryUsage().rss;
    };
    batch(3);
    const first = batch(8);
    const second = batch(8);
    // Each terminated multiplication allocates about 40MB of transform buffers and scratch, so
    // eight leaked ones would grow the second batch by 320MB.
    expect(second - first).toBeLessThan(160 * 1024 * 1024);
  });
});
