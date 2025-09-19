import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createServer } from "net";

test("fetch aborts during slow DNS resolution", async () => {
  // Test with a non-routable IP that causes connection to hang
  const startTime = performance.now();

  try {
    await fetch("http://10.255.255.254:8080", {
      signal: AbortSignal.timeout(1000),
    });
    expect.unreachable("Fetch should have been aborted");
  } catch (error: any) {
    const duration = performance.now() - startTime;

    // Should abort within 1.5 seconds (1s timeout + some overhead)
    expect(duration).toBeLessThan(1500);
    expect(error.name).toBe("TimeoutError");
    expect(error.message).toContain("timed out");
  }
}, 10000);

test("fetch aborts during DNS resolution with explicit abort", async () => {
  const controller = new AbortController();

  // Start fetch to a non-routable address
  const fetchPromise = fetch("http://203.0.113.1:8080", {
    signal: controller.signal,
  });

  // Abort after 500ms
  const timeoutId = setTimeout(() => controller.abort(), 500);

  const startTime = performance.now();

  try {
    await fetchPromise;
    expect.unreachable("Fetch should have been aborted");
  } catch (error: any) {
    clearTimeout(timeoutId);
    const duration = performance.now() - startTime;

    // Should abort within 1 second
    expect(duration).toBeLessThan(1000);
    expect(error.name).toBe("AbortError");
  }
}, 10000);

test("fetch aborts when server accepts but doesn't respond", async () => {
  // Create a server that accepts connections but never responds
  const server = createServer((socket) => {
    // Just keep the connection open, don't send any data
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;

  const startTime = performance.now();

  try {
    await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(1000),
    });
    expect.unreachable("Fetch should have timed out");
  } catch (error: any) {
    const duration = performance.now() - startTime;

    // Should timeout within 1.5 seconds
    expect(duration).toBeLessThan(1500);
    expect(error.name).toBe("TimeoutError");
  } finally {
    server.close();
  }
}, 10000);

test("fetch respects abort signal during redirect to slow host", async () => {
  // Create a server that redirects to a non-routable address
  const server = createServer((socket) => {
    socket.write(
      "HTTP/1.1 302 Found\r\n" +
      "Location: http://10.255.255.254:8080/redirected\r\n" +
      "Content-Length: 0\r\n" +
      "\r\n"
    );
    socket.end();
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;

  const startTime = performance.now();

  try {
    await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(1000),
      redirect: "follow",
    });
    expect.unreachable("Fetch should have been aborted during redirect");
  } catch (error: any) {
    const duration = performance.now() - startTime;

    // Should abort within 1.5 seconds
    expect(duration).toBeLessThan(1500);
    expect(error.name).toBe("TimeoutError");
  } finally {
    server.close();
  }
}, 10000);