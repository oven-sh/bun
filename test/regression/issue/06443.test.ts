import { describe, test, expect } from "bun:test";
import { serve, file } from "bun";

describe("Bun.serve()", () => {
  const tls = {
    cert: file(new URL("../fixtures/cert.pem", import.meta.url)),
    key: file(new URL("../fixtures/cert.key", import.meta.url)),
  };

  const servers = [
    {
      port: 0,
      url: /^http:\/\/localhost:\d+\/$/,
    },
    {
      tls,
      port: 0,
      url: /^https:\/\/localhost:\d+\/$/,
    },
  ];

  test.each(servers)("%j", async ({ url, ...options }) => {
    const server = serve({
      hostname: "localhost",
      ...options,
      fetch(request) {
        return new Response(request.url);
      },
    });
    try {
      const proto = options.tls ? "https" : "http";
      const target = `${proto}://localhost:${server.port}/`;
      const response = await fetch(target, { tls: { rejectUnauthorized: false } });
      expect(response.text()).resolves.toMatch(url);
    } finally {
      server.stop(true);
    }
  });
});
