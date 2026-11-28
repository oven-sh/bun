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

// A 32-bit read in front of the range check wraps a string, BigInt or object
// at or above 2^31 (`retry: "4294967299"` becomes 3) and reports a number as
// 2147483647. The check has to see the value that was passed.
describe("queueSize, retry and expiresIn are range-checked before they are narrowed", () => {
  const options = { ...base, region: "us-east-1" };
  const stored = (option: "retry" | "queueSize", value: unknown) =>
    Number(
      new RegExp(`${option}: (\\d+)`).exec(Bun.inspect(new Bun.S3Client({ ...options, [option]: value } as any)))![1],
    );
  const failure = (fn: () => unknown) => {
    try {
      fn();
    } catch (e: any) {
      return { name: e.name, code: e.code, message: e.message };
    }
    return "did not throw";
  };
  const forms = (n: number) => [n, String(n), BigInt(n), { valueOf: () => n }];
  const aroundTheWrap = [2 ** 31 - 1, 2 ** 31, 2 ** 32, 2 ** 32 + 3];

  test("retry above 255 throws with the value that was passed", () => {
    const outOfRange = (received: string) => ({
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: `The value of "retry" is out of range. It must be >= 0 and <= 255. Received ${received}`,
    });
    const retry = (value: unknown) => failure(() => new Bun.S3Client({ ...options, retry: value } as any));

    for (const n of aroundTheWrap) {
      expect(forms(n).map(retry)).toEqual(Array(4).fill(outOfRange(String(n))));
    }
    expect(retry("-4294967295")).toEqual(outOfRange("-4294967295"));
    expect(retry("Infinity")).toMatchObject({ name: "RangeError", code: "ERR_OUT_OF_RANGE" });

    // What was coerced before is still coerced.
    expect([NaN, "abc", "", " ", false, [], 3n, "7"].map(value => stored("retry", value))).toEqual([
      0, 0, 0, 0, 0, 0, 3, 7,
    ]);
    expect(retry(Symbol())).toMatchObject({ name: "TypeError", message: "Cannot convert a symbol to a number" });
  });

  test("queueSize above 255 stores 255 in every form", () => {
    for (const n of aroundTheWrap) {
      expect(forms(n).map(value => stored("queueSize", value))).toEqual([255, 255, 255, 255]);
    }
    expect(stored("queueSize", "Infinity")).toBe(255);
    expect(failure(() => new Bun.S3Client({ ...options, queueSize: "-4294967295" } as any))).toEqual({
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: 'The value of "queueSize" is out of range. It must be >= 1. Received -4294967295',
    });

    expect([8n, { valueOf: () => 8 }, 256, Infinity].map(value => stored("queueSize", value))).toEqual([
      8, 8, 255, 255,
    ]);
  });

  test("expiresIn above 2147483647 signs 2147483647 in every form", () => {
    for (const n of aroundTheWrap) {
      expect(forms(n).map(presignExpires)).toEqual(Array(4).fill("2147483647"));
    }
    expect(presignExpires("Infinity")).toBe("2147483647");
    expect(failure(() => presignExpires("-4294967295"))).toMatchObject({
      name: "TypeError",
      message: expect.stringContaining("expiresIn must be"),
    });

    expect([3n, { valueOf: () => 3 }].map(presignExpires)).toEqual(["3", "3"]);
  });

  test("each option is converted to a number once", () => {
    const calls = { retry: 0, queueSize: 0, expiresIn: 0 };
    const counted = (option: keyof typeof calls, n: number) => ({ valueOf: () => (calls[option]++, n) });

    expect(() => new Bun.S3Client({ ...options, retry: counted("retry", 2 ** 32 + 3) } as any)).toThrow(RangeError);
    expect(stored("queueSize", counted("queueSize", 2 ** 32 + 1))).toBe(255);
    expect(presignExpires(counted("expiresIn", 2 ** 32 + 1))).toBe("2147483647");
    expect(calls).toEqual({ retry: 1, queueSize: 1, expiresIn: 1 });
  });

  test("every entry point rejects a wrapped retry before it sends a request", async () => {
    let requests = 0;
    await using server = Bun.serve({
      port: 0,
      fetch() {
        requests++;
        return new Response("", { status: 500 });
      },
    });
    const endpoint = `http://127.0.0.1:${server.port}`;
    const client = new Bun.S3Client({ ...options, endpoint });
    const file = client.file("k");
    // 2^32 wrapped to 0 retries.
    const wrapped = { ...options, endpoint, retry: "4294967296" } as any;

    const entryPoints: Record<string, () => unknown> = {
      "new S3Client(options)": () => new Bun.S3Client(wrapped),
      "client.file(key, options)": () => client.file("k", wrapped),
      "S3Client.presign(key, options)": () => Bun.S3Client.presign("k", wrapped),
      "Bun.s3.file(key, options)": () => Bun.s3.file("k", wrapped),
      "Bun.file(url, options)": () => Bun.file("s3://b/k", wrapped),
      "s3file.presign(options)": () => file.presign(wrapped),
      "s3file.write(data, options)": () => file.write("x", wrapped),
      "fetch(url, { s3 })": () => fetch("s3://b/k", { s3: wrapped }),
    };
    const outcomes: Record<string, string> = {};
    for (const [name, run] of Object.entries(entryPoints)) {
      try {
        await run();
        outcomes[name] = "did not throw";
      } catch (e: any) {
        outcomes[name] = `${e.name} ${e.code}`;
      }
    }

    expect(outcomes).toEqual(
      Object.fromEntries(Object.keys(entryPoints).map(name => [name, "RangeError ERR_OUT_OF_RANGE"])),
    );
    expect(requests).toBe(0);
  });
});
