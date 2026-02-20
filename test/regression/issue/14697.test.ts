import { expect, test } from "bun:test";
import { createServer } from "node:http";

test("ServerResponse emits close event on client disconnect", async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  let requestClosed = false;
  let responseClosed = false;

  const server = createServer((req, res) => {
    req.once("close", () => {
      requestClosed = true;
    });

    res.once("close", () => {
      responseClosed = true;
      resolve();
    });

    // Don't end the response — wait for the client to disconnect.
  });

  try {
    // Await server listening before making requests
    const port = await new Promise<number>(res => {
      server.listen(0, () => res(server.address()!.port));
    });

    // Connect and immediately abort to simulate client disconnect
    const controller = new AbortController();
    fetch(`http://localhost:${port}`, { signal: controller.signal }).catch(() => {});
    // Give the server a moment to receive the request before aborting
    await Bun.sleep(50);
    controller.abort();

    // Wait for the close event on the response
    await promise;

    expect(requestClosed).toBe(true);
    expect(responseClosed).toBe(true);
  } finally {
    server.close();
  }
}, 5000);

test("ServerResponse emits close event on normal response end", async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  let responseClosed = false;

  const server = createServer((req, res) => {
    res.once("close", () => {
      responseClosed = true;
      resolve();
    });

    res.end("hello");
  });

  try {
    // Await server listening before making requests
    const port = await new Promise<number>(res => {
      server.listen(0, () => res(server.address()!.port));
    });

    const resp = await fetch(`http://localhost:${port}`);
    const text = await resp.text();
    expect(text).toBe("hello");

    await promise;
    expect(responseClosed).toBe(true);
  } finally {
    server.close();
  }
}, 5000);
