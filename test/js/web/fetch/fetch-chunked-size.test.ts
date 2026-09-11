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

  // The chunks ahead of the malformed one are body: a reader that is waiting gets them, then the
  // read rejects. node v26.3.0: chunks ["x"], then `TypeError: terminated` (HPE_INVALID_CHUNK_SIZE).
  describe("delivers the chunks ahead of a malformed chunk-size to a streaming reader", () => {
    const head = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n";
    // "C" is a hex digit, so this line is chunk-size 0xC followed by junk.
    const malformed = "Connection: close\r\n\r\n";

    // Writes `first` when the request arrives and keeps the socket open, so the failure can
    // only come from the parser. `send()` writes one more piece.
    async function serveParts(first: string | Buffer) {
      const { promise, resolve } = Promise.withResolvers<net.AddressInfo>();
      const accepted = Promise.withResolvers<net.Socket>();
      const server = net
        .createServer(socket => {
          socket.on("error", () => {});
          socket.once("data", () => {
            socket.write(first);
            accepted.resolve(socket);
          });
        })
        .listen(0, "127.0.0.1", () => resolve(server.address() as net.AddressInfo));
      const address = await promise;
      return {
        server,
        url: `http://127.0.0.1:${address.port}/`,
        send: async (part: string | Buffer) => void (await accepted.promise).write(part),
      };
    }

    async function readUntilError(reader: ReadableStreamDefaultReader<Uint8Array>) {
      const chunks: Buffer[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return { body: Buffer.concat(chunks).toString(), code: "(stream ended)" };
          chunks.push(Buffer.from(value));
        }
      } catch (e: any) {
        return { body: Buffer.concat(chunks).toString(), code: e?.code };
      }
    }

    it("in one read", async () => {
      const { server, url, send } = await serveParts(`${head}\r\n`);
      await using _s = server;
      const res = await fetch(url);
      // A read is pending before the server writes the rest.
      const result = readUntilError(res.body!.getReader());
      await send(`1\r\nx\r\n${malformed}`);
      expect(await result).toEqual({ body: "x", code: "InvalidHTTPResponse" });
    });

    it("in a chunk larger than one read", async () => {
      const payload = Buffer.alloc(256 * 1024, "abcdefghijklmnopqrstuvwxyz").toString();
      const { server, url, send } = await serveParts(`${head}\r\n`);
      await using _s = server;
      const res = await fetch(url);
      const result = readUntilError(res.body!.getReader());
      await send(`${payload.length.toString(16)}\r\n${payload}\r\n${malformed}`);
      const { body, code } = await result;
      expect(code).toBe("InvalidHTTPResponse");
      expect(body.length).toBe(payload.length);
      expect(body).toBe(payload);
    });

    // node v26.3.0 delivers nothing here: the error tears its gunzip down before it emits.
    it("but not of a compressed body", async () => {
      const gz = Bun.gzipSync("hello hello hello hello");
      const { server, url, send } = await serveParts(`${head}Content-Encoding: gzip\r\n\r\n`);
      await using _s = server;
      const res = await fetch(url);
      const result = readUntilError(res.body!.getReader());
      await send(Buffer.concat([Buffer.from(`${gz.length.toString(16)}\r\n`), gz, Buffer.from(`\r\n${malformed}`)]));
      expect(await result).toEqual({ body: "", code: "InvalidHTTPResponse" });
    });

    it("and no inflater output ahead of a corrupted gzip body's error", async () => {
      const text = Buffer.alloc(8192, "the quick brown fox jumps over the lazy dog ").toString();
      const gz = Buffer.from(Bun.gzipSync(text, { level: 1 }));
      gz[gz.length >> 1] ^= 0xff;
      gz[(gz.length >> 1) + 1] ^= 0xff;
      const { server, url, send } = await serveParts(`${head}Content-Encoding: gzip\r\n\r\n`);
      await using _s = server;
      const res = await fetch(url);
      const result = readUntilError(res.body!.getReader());
      await send(Buffer.concat([Buffer.from(`${gz.length.toString(16)}\r\n`), gz, Buffer.from("\r\n0\r\n\r\n")]));
      expect(await result).toEqual({ body: "", code: "ZlibError" });
    });

    // With the response head in the same read the Response is built from the failure, so every
    // way of reading the body rejects. (node v26.3.0 gives a reader that reads at once "x" first.)
    describe("when the response head shares the read, the body rejects", () => {
      const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));
      it.each([
        ["a reader that reads at once", async (res: Response) => readUntilError(res.body!.getReader())],
        [
          "a body stream made before a later first read",
          async (res: Response) => {
            const body = res.body!;
            await yieldToEventLoop();
            return readUntilError(body.getReader());
          },
        ],
        [
          "a body stream made before a later arrayBuffer()",
          async (res: Response) => {
            const body = res.body!;
            await yieldToEventLoop();
            return new Response(body).arrayBuffer().then(
              bytes => ({ body: Buffer.from(bytes).toString(), code: "(resolved)" }),
              e => ({ body: "", code: e?.code }),
            );
          },
        ],
        [
          "text()",
          async (res: Response) =>
            res.text().then(
              body => ({ body, code: "(resolved)" }),
              e => ({ body: "", code: e?.code }),
            ),
        ],
      ])("%s", async (_, consume) => {
        const { server, url } = await serveParts(`${head}\r\n1\r\nx\r\n${malformed}`);
        await using _s = server;
        expect(await consume(await fetch(url))).toEqual({ body: "", code: "InvalidHTTPResponse" });
      });
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
