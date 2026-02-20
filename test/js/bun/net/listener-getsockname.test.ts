import { test, expect } from "bun:test";

test("Listener.getsockname with non-object argument does not crash", () => {
  const listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });
  try {
    // Calling getsockname with a non-object argument should not crash
    const result = (listener as any).getsockname(13);
    expect(result).toBeObject();
    expect(result.family).toMatch(/^IPv[46]$/);
    expect(result.address).toBeString();
    expect(typeof result.port).toBe("number");
  } finally {
    listener.stop(true);
  }
});

test("Listener.getsockname with no arguments does not crash", () => {
  const listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });
  try {
    // Calling getsockname with no arguments should not crash
    const result = (listener as any).getsockname();
    expect(result).toBeObject();
    expect(result.family).toMatch(/^IPv[46]$/);
    expect(result.address).toBeString();
    expect(typeof result.port).toBe("number");
  } finally {
    listener.stop(true);
  }
});

test("Listener.getsockname with object argument still works", () => {
  const listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });
  try {
    const obj: any = {};
    const result = (listener as any).getsockname(obj);
    // When passed an object, it should populate that same object
    expect(obj.family).toMatch(/^IPv[46]$/);
    expect(obj.address).toBeString();
    expect(typeof obj.port).toBe("number");
    // And the return value should be the same object
    expect(result).toBe(obj);
  } finally {
    listener.stop(true);
  }
});
