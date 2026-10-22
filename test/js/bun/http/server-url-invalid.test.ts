import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("server.url percent-encodes a unix socket path that isn't a valid URL host", () => {
  // An object passed as the unix socket path is coerced to "[object Bun]".
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
    expect(server.url.href).toBe("unix://%5Bobject%20Bun%5D");
  } finally {
    process.chdir(prev);
  }
});
