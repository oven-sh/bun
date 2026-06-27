import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

// RFC 9112 3.2.4: the asterisk-form request-target (`OPTIONS * HTTP/1.1`).
// Node (llhttp) delivers it verbatim as `req.url === "*"` for any method.

async function writeAndCollect(port: number, requestLine: string) {
  const client = net.connect(port);
  try {
    client.on("error", () => {});
    const chunks: Buffer[] = [];
    client.on("data", chunk => chunks.push(chunk));
    const closed = once(client, "close");
    client.write(`${requestLine}\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    await closed;
    return Buffer.concat(chunks).toString();
  } finally {
    client.destroy();
  }
}

describe("node:http server", () => {
  // llhttp accepts asterisk-form for any method, not only OPTIONS.
  test.each(["OPTIONS", "GET"])("delivers `%s * HTTP/1.1` to the handler with url '*'", async method => {
    const { promise: handled, resolve } = Promise.withResolvers<{ method: string; url: string }>();
    await using server = http
      .createServer((req, res) => {
        resolve({ method: req.method!, url: req.url! });
        res.end("hi");
      })
      .listen(0);
    await once(server, "listening");

    const wire = await writeAndCollect((server.address() as net.AddressInfo).port, `${method} * HTTP/1.1`);
    expect(wire).toStartWith("HTTP/1.1 200 OK\r\n");
    expect(wire).toEndWith("\r\n\r\nhi");
    expect(await handled).toEqual({ method, url: "*" });
  });

  test("an asterisk-form target with a query is delivered verbatim, like Node", async () => {
    const { promise: handled, resolve } = Promise.withResolvers<string>();
    await using server = http
      .createServer((req, res) => {
        resolve(req.url!);
        res.end();
      })
      .listen(0);
    await once(server, "listening");

    const wire = await writeAndCollect((server.address() as net.AddressInfo).port, "OPTIONS *?a=1 HTTP/1.1");
    expect(wire).toStartWith("HTTP/1.1 200 OK\r\n");
    expect(await handled).toBe("*?a=1");
  });
});

describe("Bun.serve", () => {
  // Bun.serve shares the same request-line parser as node:http.
  test("delivers `OPTIONS * HTTP/1.1` to fetch()", async () => {
    const { promise: handled, resolve } = Promise.withResolvers<string>();
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        resolve(req.method);
        return new Response("hi");
      },
    });

    const wire = await writeAndCollect(server.port, "OPTIONS * HTTP/1.1");
    expect(wire).toStartWith("HTTP/1.1 200 OK\r\n");
    expect(await handled).toBe("OPTIONS");
  });
});
