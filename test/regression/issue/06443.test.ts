import { file, serve } from "bun";
import { describe, expect, test } from "bun:test";

describe("Bun.serve()", () => {
  const tls = {
    cert: file(new URL("../fixtures/cert.pem", import.meta.url)),
    key: file(new URL("../fixtures/cert.key", import.meta.url)),
  };

  const servers = [
    {
      port: 0,
      url: /^http:\/\/127\.0\.0\.1:\d+\/$/,
    },
    {
      tls,
      port: 0,
      url: /^https:\/\/127\.0\.0\.1:\d+\/$/,
    },
  ];

  test.each(servers)("%j", async ({ url, ...options }) => {
    // 127.0.0.1, not "localhost": on v6-preferring hosts Bun.serve binds ::1
    // while fetch's resolver picks 127.0.0.1 (or vice versa) → ConnectionRefused.
    const server = serve({
      hostname: "127.0.0.1",
      ...options,
      fetch(request) {
        return new Response(request.url);
      },
    });
    try {
      const proto = options.tls ? "https" : "http";
      const target = `${proto}://127.0.0.1:${server.port}/`;
      const response = await fetch(target, { tls: { rejectUnauthorized: false } });
      await expect(response.text()).resolves.toMatch(url);
    } finally {
      server.stop(true);
    }
  });
});
