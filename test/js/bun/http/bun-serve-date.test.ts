import { describe, expect, test } from "bun:test";

test("Date header is not updated every request", async () => {
  const twoSecondsAgo = new Date(Date.now() - 2 * 1000);
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  // Make multiple requests in quick succession
  const responses = await Promise.all([
    fetch(server.url),
    fetch(server.url),
    fetch(server.url),
    fetch(server.url),
    fetch(server.url),
  ]);

  // All responses should have the same Date header since they were made within the same second
  const dates = responses.map(r => r.headers.get("Date"));
  const uniqueDates = new Set(dates);

  // Should only have 1 unique date value since all requests were made rapidly
  expect(uniqueDates.size).toBe(1);
  expect(dates[0]).toBeTruthy();

  for (const delay of [250, 250, 250, 250, 250]) {
    await Bun.sleep(delay);
    const laterResponses = await Promise.all([
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
    ]);
    const laterDates = laterResponses.map(r => r.headers.get("Date"));
    const laterUniqueDates = new Set(laterDates);
    expect(laterUniqueDates.size).toBe(1);
    uniqueDates.add([...laterUniqueDates][0]);
  }

  // There should only really be two, but I don't trust timers to be SUPER accurate.
  expect(uniqueDates.size).toBeLessThan(4);

  for (const date of [...uniqueDates]) {
    const d = new Date(date!);
    const stamp = d.getTime();
    expect(Number.isFinite(stamp)).toBe(true);
    expect(stamp).toBeGreaterThan(0);
    expect(stamp).toBeGreaterThan(twoSecondsAgo.getTime());
    expect(stamp).toBeLessThan(Date.now() + 100);
  }
});

// RFC 9110 6.6.1: an origin server with a clock sends Date in every response.
// The bodiless ones terminate through a different path than a normal body write,
// which used to skip it entirely.
describe.concurrent("Date header on bodiless responses", () => {
  async function drain(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    await res.arrayBuffer();
    return res;
  }

  function expectFreshDate(res: Response, label: string) {
    const date = res.headers.get("date");
    expect(date, `${label} must carry a Date header`).toBeTruthy();
    const stamp = new Date(date!).getTime();
    expect(Number.isFinite(stamp), `${label} Date must parse`).toBe(true);
    // Date has one-second resolution and the server caches it, so allow a window.
    expect(stamp).toBeGreaterThan(Date.now() - 60_000);
    expect(stamp).toBeLessThan(Date.now() + 60_000);
  }

  test("HEAD responses carry Date", async () => {
    using server = Bun.serve({
      port: 0,
      static: { "/static": new Response("hello") },
      fetch: () => new Response("hello"),
    });

    const dynamic = await drain(new URL("/dynamic", server.url).href, { method: "HEAD" });
    expect(dynamic.status).toBe(200);
    expectFreshDate(dynamic, "dynamic HEAD");

    const staticRoute = await drain(new URL("/static", server.url).href, { method: "HEAD" });
    expect(staticRoute.status).toBe(200);
    expectFreshDate(staticRoute, "static HEAD");
  });

  test("304 responses carry Date", async () => {
    using server = Bun.serve({
      port: 0,
      static: { "/static": new Response("hello") },
      fetch: () => new Response("fallback"),
    });
    const url = new URL("/static", server.url).href;

    const first = await drain(url);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    for (const method of ["GET", "HEAD"]) {
      const notModified = await drain(url, { method, headers: { "if-none-match": etag! } });
      expect(notModified.status).toBe(304);
      expectFreshDate(notModified, `${method} 304`);
    }
  });

  // https://github.com/oven-sh/bun/issues/27512
  test("413 responses carry Date", async () => {
    using server = Bun.serve({
      port: 0,
      maxRequestBodySize: 1,
      fetch: () => new Response("Hello Bun"),
    });

    const tooLarge = await drain(server.url.href, { method: "POST", body: "12" });
    expect(tooLarge.status).toBe(413);
    expectFreshDate(tooLarge, "413");
  });
});
