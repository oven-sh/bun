import { preview, build } from "astro";
import { expect, test } from "bun:test";
import { join } from "path";
test("is able todo a POST request to an astro action", async () => {
  await build({
    root: join(import.meta.dirname, "fixtures"),
    devOutput: false,
    logLevel: "error",
  });
  const previewServer = await preview({
    root: join(import.meta.dirname, "fixtures"),
    port: 0,
    logLevel: "error",
  });

  try {
    const r = await fetch(`http://localhost:${previewServer.port}/_actions/getGreeting/`, {
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9,es;q=0.8",
        "content-type": "application/json",
        "sec-ch-ua": '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        Referer: "http://localhost:4321/",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
      body: '{"name":"World"}',
      method: "POST",
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toBe('["Hello, World!"]');
  } finally {
    // Stop the server if needed
    await previewServer.stop();
  }
});
