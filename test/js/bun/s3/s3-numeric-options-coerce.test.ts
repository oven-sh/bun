import { describe, expect, test } from "bun:test";

// Bun 1.3.x accepted these options via a coercing reader (ToNumber → truncate),
// so numeric strings (from env vars), floats, and Infinity all worked. The Rust
// port initially swapped in a strict validator; these tests pin the 1.3.x
// coercing behaviour.

const base = { accessKeyId: "AK", secretAccessKey: "SK", bucket: "b" } as const;

function presignExpires(expiresIn: unknown): string | null {
  const url = Bun.s3.presign("k", { ...base, expiresIn: expiresIn as number });
  return new URL(url).searchParams.get("X-Amz-Expires");
}

describe("presign expiresIn coercion", () => {
  test.each([
    ["3600", "3600"],
    ["60", "60"],
    [1.5, "1"],
    [3599.9999, "3599"],
    [Infinity, String(2 ** 31 - 1)],
    [2 ** 31, String(2 ** 31 - 1)],
  ] as const)("expiresIn: %p -> X-Amz-Expires=%s", (input, expected) => {
    expect(presignExpires(input)).toBe(expected);
  });

  test("expiresIn: null is ignored (default 86400)", () => {
    expect(presignExpires(null)).toBe("86400");
  });

  test("expiresIn: 0 still throws (field-specific validation)", () => {
    expect(() => presignExpires(0)).toThrow("expiresIn must be greather than 0");
  });
});

describe("S3Client upload options coercion", () => {
  function make(opts: Record<string, unknown>) {
    return new Bun.S3Client({ ...base, region: "us-east-1", ...opts } as any);
  }

  test("partSize accepts numeric strings and floats", () => {
    expect(Bun.inspect(make({ partSize: "10485760" }))).toContain("partSize: 10485760");
    expect(Bun.inspect(make({ partSize: 10485760.5 }))).toContain("partSize: 10485760");
  });

  test("partSize string above 2^31 does not wrap to 32 bits", () => {
    expect(Bun.inspect(make({ partSize: "5000000000" }))).toContain("partSize: 5000000000");
    expect(Bun.inspect(make({ partSize: "5368709120" }))).toContain("partSize: 5368709120");
  });

  test("partSize string out of range reports the received value, not a wrapped negative", () => {
    let err: unknown;
    try {
      make({ partSize: "6000000000" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RangeError);
    const message = (err as RangeError).message;
    expect(message).toContain(">= 5242880 and <= 5368709120");
    expect(message).toContain("Received 6000000000");
  });

  test("pageSize (legacy alias) accepts a numeric string", () => {
    expect(Bun.inspect(make({ pageSize: "10485760" }))).toContain("partSize: 10485760");
  });

  test("queueSize accepts numeric strings and floats", () => {
    expect(Bun.inspect(make({ queueSize: "8" }))).toContain("queueSize: 8");
    expect(Bun.inspect(make({ queueSize: 8.9 }))).toContain("queueSize: 8");
  });

  test("retry accepts numeric strings and floats", () => {
    expect(Bun.inspect(make({ retry: "3" }))).toContain("retry: 3");
    expect(Bun.inspect(make({ retry: 3.7 }))).toContain("retry: 3");
  });

  test("null upload options are ignored", () => {
    const inspected = Bun.inspect(make({ partSize: null, queueSize: null, retry: null }));
    expect(inspected).toContain("partSize: 5242880");
    expect(inspected).toContain("queueSize: 5");
    expect(inspected).toContain("retry: 3");
  });

  test("partSize out of range reports the partSize-specific bounds", () => {
    let err: unknown;
    try {
      make({ partSize: 1e18 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RangeError);
    expect((err as RangeError).message).toContain(">= 5242880 and <= 5368709120");
  });

  test("field-specific range checks still apply after coercion", () => {
    expect(() => make({ retry: "300" })).toThrow(RangeError);
    expect(() => make({ queueSize: "0" })).toThrow(RangeError);
    expect(() => make({ partSize: "1024" })).toThrow(RangeError);
  });
});
