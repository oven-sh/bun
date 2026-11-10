import { expect, test } from "bun:test";

test("Listener.getsockname works with an object argument", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });

  const out: Record<string, unknown> = {};
  const result = (listener as any).getsockname(out);
  expect(result).toBeUndefined(); // returns undefined, populates object in-place
  expect(out).toEqual(
    expect.objectContaining({
      family: expect.any(String),
      address: expect.any(String),
      port: expect.any(Number),
    }),
  );
});

test("Listener.getsockname throws with non-object argument", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });

  expect(() => (listener as any).getsockname(123)).toThrow();
  expect(() => (listener as any).getsockname("foo")).toThrow();
});

test("Listener.getsockname throws with no argument", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });

  // Previously crashed with null pointer dereference in BunString.cpp
  // when called without an object argument. Now it should throw a TypeError.
  expect(() => (listener as any).getsockname()).toThrow();
});

test("Listener.getsockname handles an argument that rejects property writes", () => {
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data() {},
    },
  });

  const frozen = Object.freeze({});
  expect((listener as any).getsockname(frozen)).toBeUndefined();
  expect(Reflect.ownKeys(frozen)).toEqual([]);

  // (module (type $s (struct (field (mut i32)))) (func (export "mk") (result (ref null $s)) struct.new_default $s))
  // prettier-ignore
  const bytes = new Uint8Array([0,0x61,0x73,0x6d,1,0,0,0, 1,10,2, 0x5f,1,0x7f,1, 0x60,0,1,0x63,0, 3,2,1,1, 7,6,1,2,0x6d,0x6b,0,0, 10,7,1,5,0,0xfb,1,0,0x0b]);
  const struct = (new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.mk as Function)();
  expect(() => (listener as any).getsockname(struct)).toThrow("Cannot set property for WebAssembly GC object");
});
