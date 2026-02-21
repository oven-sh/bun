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
  const result = listener.getsockname(out);
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
