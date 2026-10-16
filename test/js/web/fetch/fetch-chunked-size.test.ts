import { describe, expect, it } from "bun:test";
import net from "node:net";

const head = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n";

async function serveChunked(body: string | ((socket: net.Socket) => void)) {
  const { promise, resolve } = Promise.withResolvers<net.AddressInfo>();
  const server = net
    .createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", () => {
        if (typeof body === "string") socket.end(head + body);
        else body(socket);
      });
    })
    .listen(0, "127.0.0.1", () => resolve(server.address() as net.AddressInfo));
  const address = await promise;
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

const fetchText = (url: string) =>
  fetch(url)
    .then(res => res.text())
    .then(
      body => ({ resolved: body }),
      e => e,
    );

describe("fetch: chunked chunk-size token validation", () => {
  // RFC 9112 7.1: chunk-size is 1*HEXDIG followed by ";" (chunk-ext) or CRLF.
  // node/llhttp rejects every token below with HPE_INVALID_CHUNK_SIZE.
  describe("rejects malformed chunk-size", () => {
    it.each([
      ["0x5", ""], // was misread as size 0: resolved 200 with empty body, data dropped
      ["5g", "hello"], // was misread as size 5
      ["5 ", "hello"],
      ["5\t", "hello"],
      ["5.0", "hello"],
      ["5-", "hello"],
    ])("token %j", async (token, _previouslyResolvedAs) => {
      const { server, url } = await serveChunked(`${token}\r\nhello\r\n0\r\n\r\n`);
      await using _s = server;
      expect((await fetchText(url))?.code).toBe("InvalidHTTPResponse");
    });
  });

  describe("accepts well-formed chunk-size", () => {
    it.each([
      ["5", "hello"],
      ["5;ext", "hello"],
      ["5;ext=1", "hello"],
      ["05", "hello"],
      ["A", "0123456789"],
    ])("token %j", async (token, payload) => {
      const { server, url } = await serveChunked(`${token}\r\n${payload}\r\n0\r\n\r\n`);
      await using _s = server;
      const res = await fetch(url);
      expect(await res.text()).toBe(payload);
      expect(res.status).toBe(200);
    });
  });

  // A close only ends the body once the decoder is in the trailers, and llhttp
  // accepts neither a bare LF nor CR CR LF as a chunk line ending.
  it.each([
    ["ends inside chunk data", "5\r\nHel", "ECONNRESET"],
    ["ends between chunk data and its CRLF", "5\r\nHello", "ECONNRESET"],
    ["ends between CR and LF after chunk data", "5\r\nHello\r", "ECONNRESET"],
    ["ends inside the next chunk-size", "5\r\nHello\r\n0", "ECONNRESET"],
    ["has a bare LF after chunk-size", "5\nhello\r\n0\r\n\r\n", "InvalidHTTPResponse"],
    ["has a bare LF after chunk data", "5\r\nhello\n0\r\n\r\n", "InvalidHTTPResponse"],
    ["has CR CR LF after chunk data", "5\r\nhello\r\r\n0\r\n\r\n", "InvalidHTTPResponse"],
  ])("rejects a body that %s", async (_what, body, code) => {
    const { server, url } = await serveChunked(body);
    await using _s = server;
    expect((await fetchText(url))?.code).toBe(code);
  });

  // picohttpparser fails a decode once chunk framing passes 100 KB and 75% of
  // the bytes read; that limit is meant for servers and is patched out. It is
  // only evaluated on a decode that ends mid-body, so the terminator is held
  // back until the client has consumed every chunk.
  it("accepts a long body made of one-byte chunks", async () => {
    const count = 34_000; // 170 KB of framing around 34 KB of data
    const allRead = Promise.withResolvers<void>();
    const { server, url } = await serveChunked(async socket => {
      socket.write(head);
      socket.write(Buffer.alloc(count * 6, "1\r\nx\r\n"));
      await allRead.promise;
      socket.end("0\r\n\r\n");
    });
    await using _s = server;

    const res = await fetch(url);
    let received = 0;
    for await (const part of res.body!) {
      received += part.length;
      if (received === count) allRead.resolve();
    }
    expect(received).toBe(count);
  });
});
