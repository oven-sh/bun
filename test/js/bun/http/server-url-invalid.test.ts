import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("server.url does not crash when unix socket path produces invalid URL", () => {
  // Non-string values for `unix` are rejected at construction time, so the
  // URL formatter is never asked to render something like "[object Bun]".
  expect(() =>
    Bun.serve({
      // @ts-expect-error: intentionally passing invalid type
      unix: Bun,
      fetch() {
        return new Response("ok");
      },
    }),
  ).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));

  // For a valid path that happens to contain URL-hostile bytes, server.url
  // must return a URL object instead of throwing (the path is percent-encoded).
  using dir = tempDir("server-url-invalid", {});
  const prev = process.cwd();
  process.chdir(String(dir));
  try {
    using server = Bun.serve({
      unix: "[weird name].sock",
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.url).toBeInstanceOf(URL);
    expect(server.url.protocol).toBe("unix:");
    expect(decodeURIComponent(server.url.hostname)).toBe("[weird name].sock");
  } finally {
    process.chdir(prev);
  }
});
