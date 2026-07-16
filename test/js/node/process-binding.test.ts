import { getSystemErrorName } from "node:util";

describe("process.binding", () => {
  test("process.binding('constants')", () => {
    /* @ts-ignore */
    const constants = process.binding("constants");
    expect(constants).toBeDefined();
    expect(constants).toHaveProperty("os");
    expect(constants).toHaveProperty("crypto");
    expect(constants).toHaveProperty("fs");
    expect(constants).toHaveProperty("trace");
    expect(constants).toHaveProperty("zlib");
  });
  test("process.binding('uv')", () => {
    /* @ts-ignore */
    const uv = process.binding("uv");
    expect(uv).toBeDefined();

    expect(uv).toHaveProperty("errname");
    expect(uv).toHaveProperty("UV_EACCES");
    // UV_EINTR is the negated host errno on POSIX and a libuv-synthetic -4072
    // on Windows, so don't hardcode -4 here.
    expect(uv.errname(uv.UV_EINTR)).toBe("EINTR");
    // force the number to be represented as a double
    expect(uv.errname(Number(uv.UV_EINTR - 1.9) + 1.9)).toBe("EINTR");

    expect(uv.errname(5)).toBe("Unknown system error 5");

    const map = uv.getErrorMap();
    expect(map).toBeDefined();
    expect(map.get(uv.UV_EISCONN)).toEqual(["EISCONN", "socket is already connected"]);
  });

  test("process.binding('uv') UV_E* constants match libuv and round-trip through util.getSystemErrorName()", () => {
    /* @ts-ignore */
    const uv = process.binding("uv");

    // Every UV_E* constant this binding exports must be the value Node.js /
    // libuv export on this platform, and must round-trip through both the
    // C++ errname() and the Rust-backed util.getSystemErrorName().
    const results: Record<string, [number, string, string]> = {};
    const expected: Record<string, [number, string, string]> = {};
    for (const [key, val] of Object.entries(uv) as [string, number][]) {
      if (!key.startsWith("UV_") || typeof val !== "number") continue;
      const name = key.slice(3);
      results[key] = [val, uv.errname(val), getSystemErrorName(val)];
      expected[key] = [val, name, name];
    }
    // First assert on the whole object so a failure shows every broken entry.
    expect(results).toEqual(expected);
    // Then pin the shape: libuv ships 85 entries as of UV__ENOEXEC.
    expect(Object.keys(results).length).toBe(85);

    // getErrorMap() is keyed by the same values.
    const map = uv.getErrorMap();
    expect(map.get(uv.UV_ENOBUFS)).toEqual(["ENOBUFS", "no buffer space available"]);
    expect(map.get(uv.UV_EFTYPE)).toEqual(["EFTYPE", "inappropriate file type or format"]);
    expect(map.get(uv.UV_ENOEXEC)).toEqual(["ENOEXEC", "exec format error"]);

    // Spot-check platform-specific values exactly against Node's numbers.
    if (process.platform === "win32") {
      expect(uv.UV_ENOBUFS).toBe(-4060);
      expect(uv.UV_ENOENT).toBe(-4058);
      expect(uv.UV_EFTYPE).toBe(-4028);
    } else if (process.platform === "linux") {
      expect(uv.UV_ENOBUFS).toBe(-105);
      expect(uv.UV_EFTYPE).toBe(-4028);
      expect(uv.UV_ECHARSET).toBe(-4080);
    } else if (process.platform === "darwin") {
      expect(uv.UV_ENOBUFS).toBe(-55);
      expect(uv.UV_EFTYPE).toBe(-79);
    }
  });
});
