import { test, expect } from "bun:test";

test("Listener.getsockname() works without arguments", () => {
  const listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });

  try {
    // Calling getsockname() without arguments should return an object
    // with family, address, and port properties (not crash).
    const result = listener.getsockname();
    expect(result).toBeObject();
    expect(result.family).toMatch(/^IPv[46]$/);
    expect(result.address).toBeString();
    expect(result.port).toBeNumber();

    // Calling with an object argument should still work (existing behavior).
    const obj: Record<string, unknown> = {};
    listener.getsockname(obj);
    expect(obj.family).toMatch(/^IPv[46]$/);
    expect(obj.address).toBeString();
    expect(obj.port).toBeNumber();

    // Calling with a non-object argument should return a new object (not crash).
    const result2 = listener.getsockname(42 as any);
    expect(result2).toBeObject();
    expect(result2.family).toMatch(/^IPv[46]$/);
  } finally {
    listener.stop();
  }
});
