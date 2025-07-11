import { describe, expect, test, afterEach } from "bun:test";

describe("Bun HTTP server", () => {
  const servers: any[] = [];

  afterEach(() => {
    // Clean up servers after each test
    servers.forEach(server => {
      try {
        server.stop();
      } catch (e) {
        // Ignore errors during cleanup
      }
    });
    servers.length = 0;
  });

  test("Bun.serve() creates a working HTTP server", async () => {
    using server = Bun.serve({
      port: 0, // Use random port
      fetch(request) {
        return new Response("Hello from Bun server!");
      },
    });

    const response = await fetch(server.url);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe("Hello from Bun server!");
  });

  test("Bun.serve() can handle JSON responses", async () => {
    const testData = { message: "Hello", timestamp: Date.now() };

    using server = Bun.serve({
      port: 0,
      fetch(request) {
        return Response.json(testData);
      },
    });

    const response = await fetch(server.url);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(data).toEqual(testData);
  });

  test("Bun.serve() can handle different HTTP methods", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        return new Response(`Method: ${request.method}`);
      },
    });

    const getResponse = await fetch(server.url, { method: "GET" });
    const postResponse = await fetch(server.url, { method: "POST" });
    const putResponse = await fetch(server.url, { method: "PUT" });

    expect(await getResponse.text()).toBe("Method: GET");
    expect(await postResponse.text()).toBe("Method: POST");
    expect(await putResponse.text()).toBe("Method: PUT");
  });

  test("Bun.serve() can handle request bodies", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.method === "POST") {
          const body = await request.text();
          return new Response(`Received: ${body}`);
        }
        return new Response("Send POST request");
      },
    });

    const testBody = "Hello server!";
    const response = await fetch(server.url, {
      method: "POST",
      body: testBody,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`Received: ${testBody}`);
  });

  test("Bun.serve() can handle URL parameters", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const name = url.searchParams.get("name") || "World";
        return new Response(`Hello, ${name}!`);
      },
    });

    const response1 = await fetch(`${server.url}?name=Bun`);
    const response2 = await fetch(server.url);

    expect(await response1.text()).toBe("Hello, Bun!");
    expect(await response2.text()).toBe("Hello, World!");
  });

  test("Bun.serve() can handle headers", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const userAgent = request.headers.get("user-agent") || "Unknown";
        return new Response(`User-Agent: ${userAgent}`, {
          headers: {
            "X-Custom-Header": "Bun-Server",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    const response = await fetch(server.url, {
      headers: {
        "User-Agent": "Bun-Test-Client",
      },
    });

    expect(response.headers.get("X-Custom-Header")).toBe("Bun-Server");
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(await response.text()).toBe("User-Agent: Bun-Test-Client");
  });

  test("Bun.serve() can handle different status codes", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (path === "/ok") {
          return new Response("OK", { status: 200 });
        } else if (path === "/notfound") {
          return new Response("Not Found", { status: 404 });
        } else if (path === "/error") {
          return new Response("Server Error", { status: 500 });
        }
        return new Response("Default", { status: 200 });
      },
    });

    const okResponse = await fetch(`${server.url}/ok`);
    const notFoundResponse = await fetch(`${server.url}/notfound`);
    const errorResponse = await fetch(`${server.url}/error`);

    expect(okResponse.status).toBe(200);
    expect(notFoundResponse.status).toBe(404);
    expect(errorResponse.status).toBe(500);
  });

  test("Bun.serve() provides server info", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        return new Response("OK");
      },
    });

    expect(typeof server.port).toBe("number");
    expect(server.port).toBeGreaterThan(0);
    expect(typeof server.hostname).toBe("string");
    expect(server.url).toBeTruthy();
    expect(server.url.toString()).toContain(String(server.port));
  });

  test("Bun.serve() can handle async fetch functions", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 1));
        return new Response("Async response");
      },
    });

    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Async response");
  });

  test("Server can handle multiple concurrent requests", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const delay = parseInt(url.searchParams.get("delay") || "0");
        
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        return new Response(`Response after ${delay}ms`);
      },
    });

    // Make multiple requests concurrently
    const promises = [
      fetch(`${server.url}?delay=10`),
      fetch(`${server.url}?delay=5`),
      fetch(`${server.url}?delay=0`),
    ];

    const responses = await Promise.all(promises);
    const texts = await Promise.all(responses.map(r => r.text()));

    expect(texts[0]).toBe("Response after 10ms");
    expect(texts[1]).toBe("Response after 5ms");
    expect(texts[2]).toBe("Response after 0ms");
    
    // All should be successful
    responses.forEach(response => {
      expect(response.status).toBe(200);
    });
  });
});