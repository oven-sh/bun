import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("server.url does not crash when unix socket path produces invalid URL", () => {
  // Passing an object as the unix socket path causes the URL formatter to produce
  // a string like "unix://[object Bun]" which is not a valid URL. Accessing
  // server.url should throw a proper JS error instead of crashing.
  //
  // The socket path is relative, so run inside a fresh temp dir to avoid
  // EADDRINUSE from a stale socket file left in cwd by an earlier run.
  using dir = tempDir("server-url-invalid", {});
  const prev = process.cwd();
  process.chdir(String(dir));
  try {
    using server = Bun.serve({
      // @ts-expect-error: intentionally passing invalid type
      unix: Bun,
      fetch() {
        return new Response("ok");
      },
    });
    expect(() => server.url).toThrow();
  } finally {
    process.chdir(prev);
  }
});
