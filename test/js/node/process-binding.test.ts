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
    expect(uv.errname(-4)).toBe("EINTR");
    // force the number to be represented as a double
    expect(uv.errname(Number("-5.9") + 1.9)).toBe("EINTR");
    expect(uv.errname(-4)).toBe("EINTR");

    expect(uv.errname(5)).toBe("Unknown system error: 5");

    const map = uv.getErrorMap();
    expect(map).toBeDefined();
    expect(map.get(-56)).toEqual(["EISCONN", "socket is already connected"]);
  });
});
