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

  function rangeErrorMessage(opts: Record<string, unknown>): string {
    let err: unknown;
    try {
      make(opts);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RangeError);
    return (err as RangeError).message;
  }

  // The range check runs on the coerced number, before it is narrowed to the
  // native field, so the message reports what the caller passed.
  test("retry above 2^31 reports the received value, not the saturated i32", () => {
    expect(rangeErrorMessage({ retry: 2 ** 32 + 3 })).toBe(
      'The value of "retry" is out of range. It must be >= 0 and <= 255. Received 4294967299',
    );
    expect(rangeErrorMessage({ retry: 2 ** 31 })).toContain("Received 2147483648");
    expect(rangeErrorMessage({ retry: Infinity })).toContain("Received Infinity");
    expect(rangeErrorMessage({ retry: -1 })).toContain("Received -1");
  });

  test("retry: NaN throws instead of silently meaning 0 retries", () => {
    expect(rangeErrorMessage({ retry: NaN })).toBe(
      'The value of "retry" is out of range. It must be an integer. Received NaN',
    );
    expect(rangeErrorMessage({ retry: "not a number" })).toContain("Received NaN");
    expect(rangeErrorMessage({ retry: Number(undefined) })).toContain("Received NaN");
  });

  test("queueSize and partSize report NaN as NaN, not as 0", () => {
    expect(rangeErrorMessage({ queueSize: NaN })).toBe(
      'The value of "queueSize" is out of range. It must be an integer. Received NaN',
    );
    expect(rangeErrorMessage({ partSize: NaN })).toBe(
      'The value of "partSize" is out of range. It must be an integer. Received NaN',
    );
    expect(rangeErrorMessage({ pageSize: NaN })).toContain('"pageSize"');
  });

  test("queueSize below 1 reports the value before truncation", () => {
    expect(rangeErrorMessage({ queueSize: 0.5 })).toBe(
      'The value of "queueSize" is out of range. It must be >= 1. Received 0.5',
    );
    expect(rangeErrorMessage({ queueSize: -0.5 })).toContain("Received -0.5");
    expect(rangeErrorMessage({ queueSize: -Infinity })).toContain("Received -Infinity");
  });

  test("pageSize and partSize are both validated, and partSize is kept", () => {
    expect(Bun.inspect(make({ pageSize: 10485760, partSize: 20971520 }))).toContain("partSize: 20971520");
    expect(Bun.inspect(make({ pageSize: 20971520, partSize: 10485760 }))).toContain("partSize: 10485760");
    expect(rangeErrorMessage({ pageSize: 1024, partSize: 10485760 })).toContain('"pageSize"');
  });

  test("queueSize above 255 still clamps to 255", () => {
    for (const queueSize of [256, 2 ** 32 + 3, Infinity, "1000"]) {
      expect(Bun.inspect(make({ queueSize }))).toContain("queueSize: 255");
    }
  });

  test("in-range floats still truncate", () => {
    const inspected = Bun.inspect(make({ retry: 255.9, queueSize: 1.9, partSize: 5242880.9 }));
    expect(inspected).toContain("retry: 255");
    expect(inspected).toContain("queueSize: 1");
    expect(inspected).toContain("partSize: 5242880");
  });
});
