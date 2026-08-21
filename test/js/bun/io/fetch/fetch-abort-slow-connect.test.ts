import { expect, test } from "bun:test";

// TEST-NET-1 (192.0.2.0/24, RFC 5737) is unrouted: connect() returns EINPROGRESS and never completes.
const nonRoutableIP = "192.0.2.1";
const port = 80;

// A host with no default route fails the connect at once, so it cannot exercise the EINPROGRESS path.
const blackholed = await fetch(`http://${nonRoutableIP}:${port}/`, { signal: AbortSignal.timeout(250) }).then(
  () => false,
  (e: any) => e.name === "TimeoutError",
);

test.skipIf(!blackholed).concurrent("fetch aborts when connect() returns EINPROGRESS but never completes", async () => {
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

test.skipIf(!blackholed).concurrent("fetch aborts immediately during EINPROGRESS connect", async () => {
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
