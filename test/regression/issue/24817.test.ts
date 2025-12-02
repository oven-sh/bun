// https://github.com/oven-sh/bun/issues/24817
// Unicode not working with static route
import { expect, test } from "bun:test";

test("static routes should handle unicode correctly", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/dynamic": () => new Response("▲"),
      "/static": new Response("▲"),
      "/unicode-string": new Response("こんにちは世界"),
      "/emoji": new Response("🎉🚀✨"),
    },
  });

  const baseUrl = server.url.href;

  // Test basic unicode character
  {
    const staticResp = await fetch(`${baseUrl}/static`);

    const staticText = await staticResp.text();
    expect(staticText).toBe("▲");
    expect(staticResp.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  }

  // Test Japanese characters
  {
    const resp = await fetch(`${baseUrl}/unicode-string`);
    const text = await resp.text();

    expect(text).toBe("こんにちは世界");
    expect(resp.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  }

  // Test emoji
  {
    const resp = await fetch(`${baseUrl}/emoji`);
    const text = await resp.text();

    expect(text).toBe("🎉🚀✨");
    expect(resp.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  }
});

test("static routes with explicit content-type should not override", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/custom": new Response("▲", { headers: { "content-type": "text/html" } }),
    },
  });

  const baseUrl = server.url.href;

  const resp = await fetch(`${baseUrl}/custom`);
  const text = await resp.text();

  expect(text).toBe("▲");
  // Should respect the explicit content-type
  expect(resp.headers.get("content-type")).toBe("text/html");
});
