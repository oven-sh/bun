import { expect, test } from "bun:test";

test("Listener.getsockname() works without arguments", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });

  const result = listener.getsockname();
  expect(result).toEqual({
    family: expect.stringMatching(/^IPv[46]$/),
    address: expect.any(String),
    port: expect.any(Number),
  });
  expect(result.port).toBeGreaterThan(0);
});

test("Listener.getsockname() works with an object argument", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data() {},
    },
  });

  const out: Record<string, unknown> = {};
  const err = listener.getsockname(out);
  expect(err).toBeUndefined();
  expect(out).toEqual({
    family: expect.stringMatching(/^IPv[46]$/),
    address: expect.any(String),
    port: expect.any(Number),
  });
  expect(out.port).toBeGreaterThan(0);
});
