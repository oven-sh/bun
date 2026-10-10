import { blackholeListener, type Blackhole } from "blackhole";
import { afterAll, beforeAll, expect, test } from "bun:test";

// The connect to `url` returns EINPROGRESS and never completes, so each fetch
// below is still connecting when its signal fires.
let blackhole: Blackhole;
let url: string;

beforeAll(async () => {
  blackhole = await blackholeListener();
  url = `http://${blackhole.hostname}:${blackhole.port}/`;
});

afterAll(() => {
  blackhole?.[Symbol.dispose]();
});

test.concurrent("fetch aborts when connect() returns EINPROGRESS but never completes", async () => {
  const start = performance.now();
  try {
    await fetch(url, {
      signal: AbortSignal.timeout(50),
    });
    expect.unreachable("Fetch should have aborted");
  } catch (e: any) {
    const elapsed = performance.now() - start;
    expect(e.name).toBe("TimeoutError");
    expect(elapsed).toBeLessThan(1000); // But not more than 1000ms
  }
});

test.concurrent("fetch aborts immediately during EINPROGRESS connect", async () => {
  // Start the fetch
  const fetchPromise = fetch(url, {
    signal: AbortSignal.timeout(1),
  });

  const start = performance.now();
  try {
    await fetchPromise;
    expect.unreachable("Fetch should have aborted");
  } catch (e: any) {
    const elapsed = performance.now() - start;
    expect(e.name).toBe("TimeoutError");
    expect(elapsed).toBeLessThan(1000); // Should reject very quickly after abort
  }
});

test.concurrent("pre-aborted signal prevents connection attempt", async () => {
  const start = performance.now();
  try {
    await fetch(url, {
      signal: AbortSignal.abort(),
    });
    expect.unreachable("Fetch should have aborted");
  } catch (e: any) {
    const elapsed = performance.now() - start;
    expect(e.name).toBe("AbortError");
    expect(elapsed).toBeLessThan(10); // Should fail immediately
  }
});
