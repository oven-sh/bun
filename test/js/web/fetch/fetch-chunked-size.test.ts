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

  // The server sends the head, and `rest(socket)` runs once a read of the body is pending.
  async function readUntilError(rest: (socket: net.Socket) => void, headers = "") {
    const reading = Promise.withResolvers<void>();
    const { server, url } = await serveChunked(async socket => {
      socket.write(head.replace("\r\n\r\n", `\r\n${headers}\r\n`));
      await reading.promise;
      rest(socket);
    });
    await using _s = server;
    const reader = (await fetch(url)).body!.getReader();
    const chunks: Uint8Array[] = [];
    try {
      let read = reader.read();
      reading.resolve();
      for (let result = await read; !result.done; result = await reader.read()) chunks.push(result.value);
      return { body: Buffer.concat(chunks).toString(), code: "(stream ended)" };
    } catch (e: any) {
      return { body: Buffer.concat(chunks).toString(), code: e?.code };
    }
  }
  // "C" is a hex digit, so this line is chunk-size 0xC followed by junk.
  const malformed = "Connection: close\r\n\r\n";

  // Node gives the reader the same bytes before its read rejects.
  describe("a pending read gets the body bytes that arrived in the same read as", () => {
    it.each<[string, (socket: net.Socket) => void, string]>([
      ["a malformed chunk-size", socket => socket.write(`5\r\nhello\r\n${malformed}`), "InvalidHTTPResponse"],
      ["the FIN that cuts the body short", socket => socket.end("5\r\nhello\r\n"), "ECONNRESET"],
    ])("%s", async (_what, rest, code) => {
      expect(await readUntilError(rest)).toEqual({ body: "hello", code });
    });

    it("a malformed chunk-size, after a chunk larger than one read", async () => {
      const payload = Buffer.alloc(256 * 1024, "abcdefghijklmnopqrstuvwxyz").toString();
      const { body, code } = await readUntilError(socket =>
        socket.write(`${payload.length.toString(16)}\r\n${payload}\r\n${malformed}`),
      );
      expect({ length: body.length, same: body === payload, code }).toEqual({
        length: payload.length,
        same: true,
        code: "InvalidHTTPResponse",
      });
    });
  });

  // Node delivers nothing here either: the error tears its gunzip down before it emits.
  it.each([
    ["a malformed chunk-size", (gz: Buffer) => gz, malformed, "InvalidHTTPResponse"],
    [
      "corrupt gzip data",
      (gz: Buffer) => {
        gz[gz.length >> 1] ^= 0xff;
        gz[(gz.length >> 1) + 1] ^= 0xff;
        return gz;
      },
      "0\r\n\r\n",
      "ZlibError",
    ],
  ])("a pending read of a gzip body gets nothing ahead of %s", async (_what, damage, end, code) => {
    const text = Buffer.alloc(8192, "the quick brown fox jumps over the lazy dog ");
    const gz = damage(Buffer.from(Bun.gzipSync(text, { level: 1 })));
    const rest = Buffer.concat([Buffer.from(`${gz.length.toString(16)}\r\n`), gz, Buffer.from(`\r\n${end}`)]);
    expect(await readUntilError(socket => socket.write(rest), "Content-Encoding: gzip\r\n")).toEqual({
      body: "",
      code,
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
