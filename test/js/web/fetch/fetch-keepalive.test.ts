import { expect, test } from "bun:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { tls } from "harness";

test("keepalive", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response(JSON.stringify(req.headers.toJSON()));
    },
  });
  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: false,
    });
    const headers = await res.json();
    expect(headers.connection).toBeUndefined();
  }

  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: true,
    });
    const headers = await res.json();
    expect(headers.connection).toBe("keep-alive");
  }

  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: false,
      headers: {
        "Connection": "HELLO!",
      },
    });
    const headers = await res.json();
    expect(headers.connection).toBe("HELLO!");
  }
});

test("fetch does not reuse a pooled TLS connection for a request with a different Host header", async () => {
  using server = Bun.serve({
    port: 0,
    tls,
    fetch(req) {
      // Identify which TCP connection served this request: a reused
      // keep-alive socket keeps the same client ephemeral port, while a
      // fresh connection must get a new one (the pooled socket still
      // occupies the old 4-tuple).
      return new Response(String(server.requestIP(req)?.port));
    },
  });

  const url = `https://localhost:${server.port}/`;
  const get = async (headers?: Record<string, string>) => {
    const res = await fetch(url, {
      headers,
      tls: { rejectUnauthorized: false },
    });
    return await res.text();
  };

  // Two requests whose TLS handshake used the Host-header override
  // "wrong.example" for SNI/certificate verification share one pooled
  // connection (legitimate keep-alive still works).
  const overrideA = await get({ Host: "wrong.example" });
  const overrideB = await get({ Host: "wrong.example" });
  expect(overrideB).toBe(overrideA);

  // A request without the override expects the server identity to match
  // url.hostname ("localhost"), so it must not be handed the connection
  // that was only ever negotiated as "wrong.example". It has to open a new
  // connection, which cannot have the same client port.
  const plain = await get();
  expect(plain).not.toBe(overrideA);
});

test("fetch does not reuse a socket when the response Connection header contains a close token", async () => {
  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0);
    let closingAfterResponse = false;
    let closeTimer: Timer | undefined;

    socket.on("data", chunk => {
      if (closingAfterResponse) {
        socket.destroy();
        return;
      }

      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = undefined;
      }

      buffered = Buffer.concat([buffered, chunk]);
      while (true) {
        const headerEnd = buffered.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        buffered = buffered.subarray(headerEnd + 4);
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close, keep-alive\r\n\r\nok");
        closingAfterResponse = true;
        closeTimer = setTimeout(() => socket.end(), 50);
      }
    });

    socket.on("close", () => {
      if (closeTimer) clearTimeout(closeTimer);
    });
    socket.on("error", () => {});
  });

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    let failures = 0;
    const samples: string[] = [];
    let next = 0;

    async function one() {
      try {
        const res = await fetch(url, { method: "POST", body: "x" });
        const text = await res.text();
        if (res.status !== 200 || text !== "ok") {
          throw new Error(`bad response status=${res.status} text=${JSON.stringify(text)}`);
        }
      } catch (error) {
        failures++;
        if (samples.length < 5) {
          samples.push(String((error as Error)?.message ?? error));
        }
      }
    }

    async function worker() {
      while (next < 500) {
        next++;
        await one();
      }
    }

    await Promise.all(Array.from({ length: 25 }, worker));
    expect({ failures, samples }).toEqual({ failures: 0, samples: [] });
  } finally {
    server.close();
  }
});
