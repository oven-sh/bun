import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("[test] snapshotFloatPrecision", () => {
  // Reads the single `exports[...] = ...` value out of a generated .snap file.
  function readSnapshotValue(dir: string, file: string): string {
    const snap = readFileSync(path.join(dir, "__snapshots__", `${file}.snap`), "utf8");
    const m = snap.match(/exports\[`[^`]*`\] = `([\s\S]*?)`;/);
    if (!m) throw new Error(`no snapshot value found in:\n${snap}`);
    return m[1];
  }

  async function generateSnapshot(precision: number | null, value: string) {
    using dir = tempDir("snap-float-precision", {
      "bunfig.toml": precision === null ? `[test]\n` : `[test]\nsnapshotFloatPrecision = ${precision}\n`,
      "a.test.ts": `import { test, expect } from "bun:test";\ntest("v", () => { expect(${value}).toMatchSnapshot(); });\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const exitCode = await proc.exited;
    return { value: readSnapshotValue(String(dir), "a.test.ts"), exitCode };
  }

  test("rounds non-integer doubles to the configured significant figures", async () => {
    // Math.sin(1) = 0.8414709848078965 (16 sig figs); rounding to 15 drops the
    // architecture-sensitive final digit.
    const { value, exitCode } = await generateSnapshot(15, "Math.sin(1)");
    expect(value).toBe((0.8414709848078965).toPrecision(15));
    expect(value).not.toBe("0.8414709848078965");
    expect(exitCode).toBe(0);
  });

  test("rounds large-magnitude doubles by significant figures (not decimal places)", async () => {
    const { value, exitCode } = await generateSnapshot(13, "435.64026096753474");
    expect(value).toBe((435.64026096753474).toPrecision(13));
    expect(exitCode).toBe(0);
  });

  test("trims trailing zeros (unlike toPrecision's padding)", async () => {
    const { value, exitCode } = await generateSnapshot(15, "0.5");
    // toPrecision would pad to "0.500000000000000"; snapshots keep it clean.
    expect((0.5).toPrecision(15)).toBe("0.500000000000000");
    expect(value).toBe("0.5");
    expect(exitCode).toBe(0);
  });

  test("does not round integer-valued doubles", async () => {
    // A large integer (beyond int32) is stored as a double; rounding it to 15
    // significant figures would mangle it into scientific notation, so the
    // precision setting must leave it identical to the default serialization.
    const big = "123456789012345680";
    const [withPrecision, withoutPrecision] = await Promise.all([
      generateSnapshot(15, big),
      generateSnapshot(null, big),
    ]);
    expect(withPrecision.value).toBe(withoutPrecision.value);
    expect(withPrecision.exitCode).toBe(0);
    expect(withoutPrecision.exitCode).toBe(0);
  });

  test("is disabled by default (full-precision round-trip)", async () => {
    const { value, exitCode } = await generateSnapshot(null, "Math.sin(1)");
    expect(value).toBe("0.8414709848078965");
    expect(exitCode).toBe(0);
  });

  test("rejects an out-of-range precision in bunfig", async () => {
    using dir = tempDir("snap-float-precision-bad", {
      "bunfig.toml": `[test]\nsnapshotFloatPrecision = 0\n`,
      "a.test.ts": `import { test, expect } from "bun:test";\ntest("v", () => { expect(Math.sin(1)).toMatchSnapshot(); });\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("snapshotFloatPrecision");
    expect(exitCode).not.toBe(0);
  });
});

test("it will create a snapshot file if it doesn't exist", () => {
  expect({ a: { b: { c: false } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Boolean) } } });
  expect({ a: { b: { c: "string" } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(String) } } });
  expect({ a: { b: { c: 4 } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Number) } } });
  expect({ a: { b: { c: 2n } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(BigInt) } } });
  expect({ a: new Date() }).toMatchSnapshot({ a: expect.any(Date) });
  expect({ j: 2, a: "any", b: "any2" }).toMatchSnapshot({ j: expect.any(Number), a: "any", b: expect.any(String) });
  expect({ j: /regex/, a: "any", b: "any2" }).toMatchSnapshot({
    j: expect.any(RegExp),
    a: "any",
    b: expect.any(String),
  });
});

describe("toMatchSnapshot errors", () => {
  it("should throw if property matchers exist and received is not an object", () => {
    expect(() => {
      expect(1).toMatchSnapshot({ a: 1 });
    }).toThrow();
  });
  it("should throw if property matchers don't match", () => {
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: 1 });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(Date) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(String) });
    }).toThrow();
    expect(() => {
      expect({ a: 4n }).toMatchSnapshot({ a: expect.any(Number) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(BigInt) });
    }).toThrow();
  });
  it("should throw if arguments are in the wrong order", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: "oops" }).toMatchSnapshot("wrong spot", { a: "oops" });
    }).toThrow();
    expect(() => {
      expect({ a: "oops" }).toMatchSnapshot({ a: "oops" }, "right spot");
    }).not.toThrow();
  });

  it("should throw if expect.any() doesn't received a constructor", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any() });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 5 }).toMatchSnapshot({ a: expect.any(5) });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any("not a constructor") });
    }).toThrow();
  });
});
