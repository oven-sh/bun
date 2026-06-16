import { expect, test } from "bun:test";
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
