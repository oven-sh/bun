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
  listener.getsockname(out);
  expect(out.family).toBeDefined();
  expect(out.address).toBeDefined();
  expect(out.port).toBeDefined();
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
