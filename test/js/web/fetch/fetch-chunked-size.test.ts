import { describe, expect, it } from "bun:test";
import net from "node:net";

async function serveChunked(body: string) {
  const { promise, resolve } = Promise.withResolvers<net.AddressInfo>();
  const server = net
    .createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", () => {
        socket.end(`HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${body}`);
      });
    })
    .listen(0, "127.0.0.1", () => resolve(server.address() as net.AddressInfo));
  const address = await promise;
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

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
      const result = await fetch(url)
        .then(res => res.text())
        .then(body => ({ resolved: body }))
        .catch(e => e);
      expect(result?.code).toBe("InvalidHTTPResponse");
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
});
