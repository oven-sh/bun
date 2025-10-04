import { expect, test } from "bun:test";

test.concurrent("fetch aborts when connect() returns EINPROGRESS but never completes", async () => {
  // Use TEST-NET-1 (192.0.2.0/24) from RFC 5737
  // These IPs are reserved for documentation and testing.
  // Connecting to them will cause connect() to return EINPROGRESS
  // but the connection will never complete because there's no route.
  const nonRoutableIP = "192.0.2.1";
  const port = 80;

  const start = performance.now();
  try {
    await fetch(`http://${nonRoutableIP}:${port}/`, {
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
  const nonRoutableIP = "192.0.2.1";
  const port = 80;

  // Start the fetch
  const fetchPromise = fetch(`http://${nonRoutableIP}:${port}/`, {
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
  const nonRoutableIP = "192.0.2.1";
  const port = 80;

  const start = performance.now();
  try {
    await fetch(`http://${nonRoutableIP}:${port}/`, {
      signal: AbortSignal.abort(),
    });
    expect.unreachable("Fetch should have aborted");
  } catch (e: any) {
    const elapsed = performance.now() - start;
    expect(e.name).toBe("AbortError");
    expect(elapsed).toBeLessThan(10); // Should fail immediately
  }
});
