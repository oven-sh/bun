import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

// Test for issue #22353 - Segfault when handling request greater than maxRequestBodySize
// https://github.com/oven-sh/bun/issues/22353
test("should handle 413 errors without segfaulting on subsequent requests", async () => {
  const serverCode = `
    const server = Bun.serve({
      port: 0,
      maxRequestBodySize: 1024, // 1KB limit
      fetch(req) {
        return new Response("OK");
      },
    });
    
    console.log(JSON.stringify({ port: server.port }));
    
    // Keep server running
    await Bun.sleep(10000);
  `;
  
  // Start server
  await using serverProc = Bun.spawn({
    cmd: [bunExe(), "-e", serverCode],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  
  // Get port from server output
  const reader = serverProc.stdout.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  const { port } = JSON.parse(text);
  
  // Send oversized request (2KB to 1KB limit)
  const oversizedData = Buffer.alloc(2048);
  const response1 = await fetch(`http://localhost:${port}`, {
    method: "POST",
    body: oversizedData,
    headers: {
      "Content-Length": oversizedData.length.toString()
    }
  });
  
  expect(response1.status).toBe(413);
  
  // Send normal request - this should not segfault
  const response2 = await fetch(`http://localhost:${port}`, {
    method: "POST",
    body: "Normal request"
  });
  
  expect(response2.status).toBe(200);
  const body = await response2.text();
  expect(body).toBe("OK");
  
  // Check that server didn't crash
  expect(serverProc.exitCode).toBeNull();
});

// Test with keep-alive connections (the actual issue scenario)
test("should handle 413 errors with keep-alive connections", async () => {
  const server = Bun.serve({
    port: 0,
    maxRequestBodySize: 1024, // 1KB limit
    fetch(req) {
      return new Response("OK");
    },
  });
  
  try {
    // Use the same connection for both requests (keep-alive)
    const oversizedData = Buffer.alloc(2048);
    
    // First request with oversized body
    const response1 = await fetch(`http://localhost:${server.port}`, {
      method: "POST",
      body: oversizedData,
      headers: {
        "Content-Length": oversizedData.length.toString(),
        "Connection": "keep-alive"
      }
    });
    
    expect(response1.status).toBe(413);
    
    // Second request on same connection
    const response2 = await fetch(`http://localhost:${server.port}`, {
      method: "POST",
      body: "Normal request",
      headers: {
        "Connection": "keep-alive"
      }
    });
    
    expect(response2.status).toBe(200);
    const body = await response2.text();
    expect(body).toBe("OK");
  } finally {
    server.stop();
  }
});

// Test with user routes (where the issue originally occurred with Elysia)
test("should handle 413 errors with user routes", async () => {
  const server = Bun.serve({
    port: 0,
    maxRequestBodySize: 1024, // 1KB limit
    routes: {
      "/test": {
        POST: ({ body }) => body
      }
    },
    fetch(req) {
      return new Response("404", { status: 404 });
    },
  });
  
  try {
    const oversizedData = Buffer.alloc(2048);
    
    // First request with oversized body to user route
    const response1 = await fetch(`http://localhost:${server.port}/test`, {
      method: "POST",
      body: oversizedData,
      headers: {
        "Content-Length": oversizedData.length.toString()
      }
    });
    
    expect(response1.status).toBe(413);
    
    // Second request to same route - this should not segfault
    const response2 = await fetch(`http://localhost:${server.port}/test`, {
      method: "POST",
      body: "Normal request"
    });
    
    expect(response2.status).toBe(200);
    const body = await response2.text();
    expect(body).toBe("Normal request");
  } finally {
    server.stop();
  }
});