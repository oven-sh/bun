import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { join } from "path";

test.skipIf(isWindows)("server.url percent-encodes unix socket paths with special characters", () => {
  // Passing an object as the unix socket path stringifies to "[object Bun]".
  // The path is percent-encoded so server.url yields a valid URL rather than
  // a crash or parse error.
  using server = Bun.serve({
    // @ts-expect-error: intentionally passing invalid type
    unix: Bun,
    fetch() {
      return new Response("ok");
    },
  });
  expect(server.url.href).toBe("unix://%5Bobject%20Bun%5D");
});

test.skipIf(isWindows)("server.url handles unix socket paths with spaces", async () => {
  using dir = tempDir("unix-socket-space", {});
  const socketPath = join(String(dir), "my socket");

  using server = Bun.serve({
    unix: socketPath,
    fetch() {
      return new Response("ok");
    },
  });
  expect(decodeURIComponent(server.url.pathname)).toBe(socketPath);
});
