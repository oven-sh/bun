import { describe, expect, test } from "bun:test";

const payload = Buffer.alloc(9000);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + (i % 7)) & 255;

describe.each(["gzipSync", "deflateSync"] as const)("Bun.%s level option", name => {
  const fn = Bun[name];
  const defaultLen = fn(payload).length;
  const storedLen = fn(payload, { level: 0 }).length;

  test("baseline: level 0 (STORED) is larger than the default", () => {
    expect(storedLen).toBeGreaterThan(payload.length);
    expect(defaultLen).toBeLessThan(payload.length);
  });

  test.each([undefined, NaN])("level %p falls back to the default", level => {
    // @ts-expect-error
    expect(fn(payload, { level }).length).toBe(defaultLen);
  });

  test.each([null, {}, "6", "abc", true, false])("level %p throws ERR_INVALID_ARG_TYPE (not silent STORED)", level => {
    let thrown: any;
    try {
      // @ts-expect-error
      fn(payload, { level });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(thrown.message).toContain("options.level");
  });

  test.each([Infinity, -Infinity, -2, 10, 100])("level %p throws ERR_OUT_OF_RANGE", level => {
    let thrown: any;
    try {
      // @ts-expect-error
      fn(payload, { level });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.code).toBe("ERR_OUT_OF_RANGE");
    expect(thrown.message).toContain("options.level");
  });

  test.each([-1, 0, 1, 6, 9])("level %p is accepted and round-trips", level => {
    const out = fn(payload, { level });
    const back = name === "gzipSync" ? Bun.gunzipSync(out) : Bun.inflateSync(out);
    expect(Buffer.from(back).equals(payload)).toBe(true);
  });

  test.each(["windowBits", "memLevel", "strategy"] as const)("%s: non-number throws ERR_INVALID_ARG_TYPE", key => {
    for (const bad of [null, {}, "6", true]) {
      let thrown: any;
      try {
        fn(payload, { [key]: bad } as any);
      } catch (e) {
        thrown = e;
      }
      expect(thrown?.code).toBe("ERR_INVALID_ARG_TYPE");
      expect(thrown.message).toContain(`options.${key}`);
    }
  });

  test("valid memLevel/strategy are accepted", () => {
    const out = fn(payload, { memLevel: 8, strategy: 0 });
    const back = name === "gzipSync" ? Bun.gunzipSync(out) : Bun.inflateSync(out);
    expect(Buffer.from(back).equals(payload)).toBe(true);
  });

  describe("library: libdeflate", () => {
    test("level NaN falls back to the default", () => {
      // @ts-expect-error
      const out = fn(payload, { level: NaN, library: "libdeflate" });
      expect(out.length).toBeLessThan(payload.length);
    });

    test.each([null, {}, true])("level %p throws ERR_INVALID_ARG_TYPE", level => {
      // @ts-expect-error
      expect(() => fn(payload, { level, library: "libdeflate" })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    });

    test.each([-1, 13])("level %p throws ERR_OUT_OF_RANGE", level => {
      // @ts-expect-error
      expect(() => fn(payload, { level, library: "libdeflate" })).toThrow(
        expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      );
    });

    test.each([0, 6, 12])("level %p is accepted and round-trips", level => {
      const out = fn(payload, { level, library: "libdeflate" });
      const back =
        name === "gzipSync"
          ? Bun.gunzipSync(out, { library: "libdeflate" })
          : Bun.inflateSync(out, { library: "libdeflate" });
      expect(Buffer.from(back).equals(payload)).toBe(true);
    });
  });
});

describe.each(["gunzipSync", "inflateSync"] as const)("Bun.%s numeric options", name => {
  const fn = Bun[name];
  const compressed = name === "gunzipSync" ? Bun.gzipSync(payload) : Bun.deflateSync(payload);

  test.each(["windowBits", "level", "memLevel", "strategy"] as const)(
    "%s: non-number throws ERR_INVALID_ARG_TYPE",
    key => {
      for (const bad of [null, {}, "6", true]) {
        let thrown: any;
        try {
          fn(compressed, { [key]: bad } as any);
        } catch (e) {
          thrown = e;
        }
        expect(thrown?.code).toBe("ERR_INVALID_ARG_TYPE");
        expect(thrown.message).toContain(`options.${key}`);
      }
    },
  );

  test("NaN options fall through to defaults and decode correctly", () => {
    const out = fn(compressed, { level: NaN, memLevel: NaN, strategy: NaN } as any);
    expect(Buffer.from(out).equals(payload)).toBe(true);
  });

  test("accepts the same libdeflate options object the compress side accepts", () => {
    const opts = { level: 12, library: "libdeflate" } as const;
    const encoded = (name === "gunzipSync" ? Bun.gzipSync : Bun.deflateSync)(payload, opts);
    const out = fn(encoded, opts);
    expect(Buffer.from(out).equals(payload)).toBe(true);
  });
});
