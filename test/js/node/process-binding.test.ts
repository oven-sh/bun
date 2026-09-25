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
  test("process.binding('stream_wrap')", () => {
    // https://github.com/oven-sh/bun/issues/4957
    // @ts-ignore
    const sw = process.binding("stream_wrap");
    // @ts-ignore
    expect(sw).toBe(process.binding("stream_wrap"));

    expect(sw.kReadBytesOrError).toBe(0);
    expect(sw.kArrayBufferOffset).toBe(1);
    expect(sw.kBytesWritten).toBe(2);
    expect(sw.kLastWriteWasAsync).toBe(3);
    expect(Object.getOwnPropertyDescriptor(sw, "kReadBytesOrError")).toEqual({
      value: 0,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    expect(sw.streamBaseState).toBeInstanceOf(Int32Array);
    expect(sw.streamBaseState.length).toBe(4);
    // @ts-ignore
    expect(sw.streamBaseState).toBe(process.binding("stream_wrap").streamBaseState);

    expect(sw.ShutdownWrap.name).toBe("ShutdownWrap");
    expect(sw.WriteWrap.name).toBe("WriteWrap");
    expect(() => sw.ShutdownWrap()).toThrow(TypeError);
    expect(() => sw.WriteWrap()).toThrow(TypeError);
    expect(new sw.ShutdownWrap()).toEqual({ oncomplete: null, callback: null, handle: null });
    expect(Object.keys(new sw.WriteWrap())).toEqual([]);

    // The `handle-thing` npm package (required by spdy -> restify) does exactly
    // this at import time; prior to the fix it threw on the binding lookup.
    sw.streamBaseState[sw.kReadBytesOrError] = 42;
    expect(sw.streamBaseState[0]).toBe(42);
    sw.streamBaseState[sw.kReadBytesOrError] = 0;
  });
  test("process.binding('uv')", () => {
    /* @ts-ignore */
    const uv = process.binding("uv");
    expect(uv).toBeDefined();

    expect(uv).toHaveProperty("errname");
    expect(uv).toHaveProperty("UV_EACCES");
    // UV_EINTR is -4 on POSIX and a libuv-synthetic code on Windows.
    expect(uv.errname(uv.UV_EINTR)).toBe("EINTR");
    // force the number to be represented as a double
    expect(uv.errname(uv.UV_EINTR - 1.9 + Number("1.9"))).toBe("EINTR");
    expect(uv.errname(uv.UV_EINTR)).toBe("EINTR");

    expect(uv.errname(5)).toBe("Unknown system error 5");

    const map = uv.getErrorMap();
    expect(map).toBeDefined();
    expect(map.get(uv.UV_EISCONN)).toEqual(["EISCONN", "socket is already connected"]);

    // The binding object must be spreadable like a plain {} (nonzero inline
    // capacity so JSC's spread fast path does not trip hasInlineStorage()).
    expect({ ...uv }.UV_EACCES).toBe(uv.UV_EACCES);
    expect(Object.assign({}, uv).UV_EACCES).toBe(uv.UV_EACCES);
  });
});
