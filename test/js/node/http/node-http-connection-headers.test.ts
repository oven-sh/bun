import { expect, test } from "bun:test";
import { createServer } from "node:http";

test("should include Connection: keep-alive and Keep-Alive headers by default", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World");
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}/`);
    const text = await response.text();

    expect(text).toBe("Hello World");
    expect(response.headers.get("connection")).toBe("keep-alive");
    const keepAlive = response.headers.get("keep-alive");
    expect(keepAlive).toMatch(/timeout=\d+/);
    // Default keepAliveTimeout is 5000ms (5 seconds)
    expect(keepAlive).toMatch(/timeout=5/);
  } finally {
    server.close();
  }
});

test("should respect user-set Connection: close header", async () => {
  const server = createServer((req, res) => {
    res.setHeader("Connection", "close");
    res.writeHead(200);
    res.end("test");
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}/`);
    const text = await response.text();

    expect(text).toBe("test");
    expect(response.headers.get("connection")).toBe("close");
    expect(response.headers.get("keep-alive")).toBeNull();
  } finally {
    server.close();
  }
});

test("should respect user-set Connection: keep-alive header", async () => {
  const server = createServer((req, res) => {
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Keep-Alive", "timeout=30");
    res.writeHead(200);
    res.end("test");
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}/`);
    const text = await response.text();

    expect(text).toBe("test");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("keep-alive")).toBe("timeout=30");
  } finally {
    server.close();
  }
});

test("should use default keepAliveTimeout (5 seconds)", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end("test");
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}/`);
    const text = await response.text();

    expect(text).toBe("test");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("keep-alive")).toBe("timeout=5");
  } finally {
    server.close();
  }
});

test("should use custom keepAliveTimeout when configured", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end("test");
  });

  // Set custom keepAliveTimeout to 10 seconds
  server.keepAliveTimeout = 10000;

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}/`);
    const text = await response.text();

    expect(text).toBe("test");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("keep-alive")).toBe("timeout=10");
  } finally {
    server.close();
  }
});

test("should include Connection headers with POST requests", async () => {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          receivedData: JSON.parse(body),
        }),
      );
    });
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: "data" }),
    });

    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.receivedData.test).toBe("data");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("keep-alive")).toMatch(/timeout=\d+/);
  } finally {
    server.close();
  }
});

test("should include Connection headers when using setHeader before writeHead", async () => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("X-Custom-Header", "value");
    res.writeHead(200);
    res.end("test");
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}/`);
    const text = await response.text();

    expect(text).toBe("test");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("keep-alive")).toMatch(/timeout=\d+/);
    expect(response.headers.get("x-custom-header")).toBe("value");
  } finally {
    server.close();
  }
});

test("should include Connection headers when not calling writeHead explicitly", async () => {
  const server = createServer((req, res) => {
    // Not calling writeHead - it will be called implicitly
    res.end("test");
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}/`);
    const text = await response.text();

    expect(text).toBe("test");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(response.headers.get("keep-alive")).toMatch(/timeout=\d+/);
  } finally {
    server.close();
  }
});
