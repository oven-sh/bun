import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/26811
// On macOS, kqueue filter values (EVFILT_READ=-1, EVFILT_WRITE=-2) were compared
// using bitwise AND instead of ==, causing EVFILT_WRITE events to be misidentified
// as readable, leading to excessive CPU usage with network requests.
test("concurrent HTTPS POST requests complete without excessive CPU usage", async () => {
  using server = Bun.serve({
    port: 0,
    tls: {
      cert: Bun.file(new URL("../../js/bun/http/fixtures/cert.pem", import.meta.url)),
      key: Bun.file(new URL("../../js/bun/http/fixtures/cert.key", import.meta.url)),
    },
    fetch(req) {
      return new Response("ok");
    },
  });

  const url = `https://localhost:${server.port}/`;
  const concurrency = 10;

  // Make concurrent POST requests - on the buggy version, this would cause
  // 100% CPU due to EVFILT_WRITE events being continuously dispatched
  const results = await Promise.all(
    Array.from({ length: concurrency }, () =>
      fetch(url, {
        method: "POST",
        body: JSON.stringify({ test: "data" }),
        headers: { "Content-Type": "application/json" },
        tls: { rejectUnauthorized: false },
      }).then(r => r.text()),
    ),
  );

  expect(results).toHaveLength(concurrency);
  for (const result of results) {
    expect(result).toBe("ok");
  }
}, 15_000);
