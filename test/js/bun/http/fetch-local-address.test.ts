import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("fetch() with localAddress option", async () => {
  // Test that localAddress is parsed and passed through without error
  const testServer = Bun.serve({
    port: 0,
    fetch(request) {
      return new Response("Hello from server");
    },
  });

  try {
    const response = await fetch(`http://localhost:${testServer.port}`, {
      localAddress: "127.0.0.1",
    });
    
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("Hello from server");
  } finally {
    testServer.stop();
  }
});

test("fetch() with invalid localAddress should not crash", async () => {
  // Test that an invalid local address doesn't crash Bun but may fail gracefully
  const testServer = Bun.serve({
    port: 0,
    fetch(request) {
      return new Response("Hello from server");
    },
  });

  try {
    // Use an invalid local address that shouldn't be bindable
    try {
      const response = await fetch(`http://localhost:${testServer.port}`, {
        localAddress: "192.168.999.999",
      });
      // If it succeeds, that's okay - it might have fallen back
    } catch (error) {
      // If it fails, that's expected for an invalid address
      expect(error).toBeDefined();
    }
  } finally {
    testServer.stop();
  }
});

test("fetch() without localAddress works normally", async () => {
  // Test that normal fetch still works when localAddress is not provided
  const testServer = Bun.serve({
    port: 0,
    fetch(request) {
      return new Response("Hello without local address");
    },
  });

  try {
    const response = await fetch(`http://localhost:${testServer.port}`);
    
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("Hello without local address");
  } finally {
    testServer.stop();
  }
});