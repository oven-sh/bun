import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { join } from "path";

test.skipIf(isWindows)("server.url percent-encodes unix socket paths with special characters", () => {
  // Passing an object as the unix socket path stringifies to "[object Bun]".
  // The path is percent-encoded so server.url yields a valid URL rather than
  // a crash or parse error.
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

test.skipIf(isWindows)("server.url escapes special characters in unix socket paths so pathname round-trips", () => {
  using dir = tempDir("unix-socket-special", {});
  // "#" and "?" would otherwise truncate the URL (start of fragment/query),
  // and a space must be encoded too. After escaping, decodeURIComponent of
  // the pathname yields the original socket path.
  const socketPath = join(String(dir), "a b#c?d");

  using server = Bun.serve({
    unix: socketPath,
    fetch() {
      return new Response("ok");
    },
  });
  expect(decodeURIComponent(server.url.pathname)).toBe(socketPath);
});
