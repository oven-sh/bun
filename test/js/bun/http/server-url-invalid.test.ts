import { expect, test } from "bun:test";

test("server.url does not crash when unix socket path produces invalid URL", () => {
  // Passing an object as the unix socket path causes the URL formatter to produce
  // a string like "unix://[object Bun]" which is not a valid URL. Accessing
  // server.url should throw a proper JS error instead of crashing.
  const server = Bun.serve({
    // @ts-expect-error: intentionally passing invalid type
    unix: Bun,
    fetch() {
      return new Response("ok");
    },
  });
  try {
    expect(() => server.url).toThrow();
  } finally {
    server.stop(true);
  }
});
