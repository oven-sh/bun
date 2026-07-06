import { describe, expect, it } from "bun:test";
import http2 from "node:http2";
import net from "node:net";
import http2utils from "./helpers";

// A HEADERS frame carrying END_STREAM closes the writable side of the stream, so a body-less
// request (an explicit `endStream`, or the GET/HEAD/DELETE default) must not look aborted when it
// completes normally. The writable side is closed at request() time, like node does.

async function withEchoServer(fn: (client: http2.ClientHttp2Session) => Promise<void>) {
  const server = http2.createServer();
  server.on("stream", stream => {
    let body = "";
    stream.setEncoding("utf8");
    stream.on("data", chunk => (body += chunk));
    stream.on("end", () => {
      stream.respond({ ":status": 200 });
      stream.end(body);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  try {
    await fn(client);
  } finally {
    client.close();
    server.close();
  }
}

// Returns what the request stream observed over its whole lifetime, plus the state of its writable
// side the instant request() returned.
function roundtrip(client: http2.ClientHttp2Session, headers: object, options?: object, body?: string) {
  const { promise, resolve, reject } = Promise.withResolvers<object>();
  const events: string[] = [];
  const req = client.request(headers, options);
  const writableEndedAtRequest = req.writableEnded;
  for (const name of ["response", "aborted", "end"]) req.on(name, () => events.push(name));
  req.on("error", reject);
  let received = "";
  req.setEncoding("utf8");
  req.on("data", chunk => (received += chunk));
  req.on("close", () => resolve({ events, received, aborted: req.aborted, writableEndedAtRequest }));
  if (body !== undefined) req.end(body);
  return promise;
}

describe("http2 client request() endStream", () => {
  it.each([
    ["explicit endStream", { ":path": "/a" }, { endStream: true }],
    ["implicit GET", { ":path": "/b" }, undefined],
    ["implicit DELETE", { ":path": "/c", ":method": "DELETE" }, undefined],
    ["POST with endStream", { ":path": "/d", ":method": "POST" }, { endStream: true }],
  ])("%s does not emit 'aborted'", async (_name, headers, options) => {
    await withEchoServer(async client => {
      expect(await roundtrip(client, headers, options)).toEqual({
        events: ["response", "end"],
        received: "",
        aborted: false,
        writableEndedAtRequest: true,
      });
    });
  });

  // endStream only defaults from the method when the caller leaves it unset.
  it.each([
    ["GET", "GET"],
    ["DELETE", "DELETE"],
  ])("%s with an explicit endStream: false keeps the writable side open", async (_name, method) => {
    await withEchoServer(async client => {
      expect(await roundtrip(client, { ":path": "/e", ":method": method }, { endStream: false }, "hello")).toEqual({
        events: ["response", "end"],
        received: "hello",
        aborted: false,
        writableEndedAtRequest: false,
      });
    });
  });

  it("close() on a body-less request does not emit 'aborted'", async () => {
    await withEchoServer(async client => {
      const { promise, resolve } = Promise.withResolvers<void>();
      const req = client.request({ ":path": "/f" });
      let aborted = false;
      req.on("aborted", () => (aborted = true));
      req.on("error", () => {});
      req.on("close", () => resolve());
      req.close();
      await promise;
      expect({ aborted, streamAborted: req.aborted }).toEqual({ aborted: false, streamAborted: false });
    });
  });

  // The negative contract. 'aborted' must still fire for a stream that really was cut short, so
  // the writable-side-ended check stays the thing that tells the two apart, as it does in node:
  // a request whose writable half is open is abortable, a body-less one is already done writing.
  describe("a request whose writable side is still open", () => {
    // Responds but never ends, so the client can cut the stream short mid-body.
    async function withStalledServer(fn: (client: http2.ClientHttp2Session) => Promise<void>) {
      const server = http2.createServer();
      server.on("stream", (stream, headers) => {
        stream.on("error", () => {});
        stream.resume();
        stream.respond({ ":status": 200 });
        // For the peer-reset case, send RST_STREAM only once the DATA frame is on the wire, so the
        // client always observes it after 'response'. No timers.
        if (headers[":path"] === "/rst") {
          stream.write("partial", () => stream.close(http2.constants.NGHTTP2_CANCEL));
        } else {
          stream.write("partial");
        }
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
      const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
      try {
        client.on("error", () => {});
        await fn(client);
      } finally {
        client.close();
        server.close();
      }
    }

    function abortProbe(client: http2.ClientHttp2Session, method: string, path: string, useController: boolean) {
      const { promise, resolve } = Promise.withResolvers<object>();
      const controller = useController ? new AbortController() : undefined;
      const req = client.request({ ":path": path, ":method": method }, controller && { signal: controller.signal });
      let abortedEmitted = false;
      req.on("aborted", () => (abortedEmitted = true));
      req.on("error", () => {});
      // A POST that never calls end() keeps its writable half open; a GET is already ended.
      if (method === "POST") req.write("x");
      req.on("data", () => controller?.abort());
      req.on("close", () => resolve({ abortedEmitted, streamAborted: req.aborted }));
      return promise;
    }

    it.each([
      ["an AbortController firing mid-body", "/hang", true],
      ["the peer sending RST_STREAM(CANCEL)", "/rst", false],
    ])("still emits 'aborted' on %s", async (_name, path, useController) => {
      await withStalledServer(async client => {
        expect(await abortProbe(client, "POST", path, useController)).toEqual({
          abortedEmitted: true,
          streamAborted: true,
        });
      });
    });

    // ...while the same two cases on a body-less request stay quiet, exactly as in node.
    it.each([
      ["an AbortController firing mid-body", "/hang", true],
      ["the peer sending RST_STREAM(CANCEL)", "/rst", false],
    ])("a body-less request stays quiet on %s", async (_name, path, useController) => {
      await withStalledServer(async client => {
        expect(await abortProbe(client, "GET", path, useController)).toEqual({
          abortedEmitted: false,
          streamAborted: false,
        });
      });
    });
  });

  // request() already closed the writable side, so a user's end() lands on Http2Stream#end's
  // already-ended path. It still has to honour Writable#end: return the stream, and never invoke
  // the callback synchronously.
  it("end() on an already-ended request stays chainable and defers the callback", async () => {
    await withEchoServer(async client => {
      const req = client.request({ ":path": "/g" });
      expect(req.writableEnded).toBe(true);
      req.resume();

      let finishFired = false;
      req.on("finish", () => (finishFired = true));
      const { promise, resolve } = Promise.withResolvers<object>();
      let stillInsideEndCall = true;
      expect(req.end(() => resolve({ calledSynchronously: stillInsideEndCall, finishFiredFirst: finishFired }))).toBe(
        req,
      );
      stillInsideEndCall = false;
      // node runs the callback from Writable's kOnFinished queue, just before it emits 'finish'.
      expect(await promise).toEqual({ calledSynchronously: false, finishFiredFirst: false });

      await new Promise<void>(resolve => req.on("close", () => resolve()));
    });
  });

  it("end(callback) once the writable side finished reports ERR_STREAM_ALREADY_FINISHED", async () => {
    await withEchoServer(async client => {
      const req = client.request({ ":path": "/h" });
      req.resume();
      await new Promise<void>(resolve => req.on("finish", () => resolve()));
      const { promise, resolve } = Promise.withResolvers<string>();
      req.end((err?: Error & { code?: string }) => resolve(err?.code ?? "no error"));
      expect(await promise).toBe("ERR_STREAM_ALREADY_FINISHED");
      await new Promise<void>(resolve => req.on("close", () => resolve()));
    });
  });

  // A request queued behind the peer's SETTINGS_MAX_CONCURRENT_STREAMS has no stream id yet, so
  // _final parks on 'ready' and only runs once the HEADERS frame is actually submitted.
  it("requests queued behind maxConcurrentStreams end their writable side once submitted", async () => {
    const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
    server.on("stream", stream => {
      stream.on("end", () => {
        stream.respond({ ":status": 200 });
        stream.end();
      });
      stream.resume();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    try {
      await new Promise<void>(resolve => client.on("remoteSettings", () => resolve()));
      const requests: Promise<object>[] = [];
      for (let i = 0; i < 3; i++) {
        const { promise, resolve, reject } = Promise.withResolvers<object>();
        const req = client.request({ ":path": `/${i}` });
        const writableEndedAtRequest = req.writableEnded;
        let aborted = false;
        req.on("aborted", () => (aborted = true));
        req.on("error", reject);
        req.resume();
        req.on("close", () =>
          resolve({ writableEndedAtRequest, aborted, writableFinished: req.writableFinished, rstCode: req.rstCode }),
        );
        requests.push(promise);
      }
      // The first request goes out immediately; the other two sit in the pending queue.
      expect(await Promise.all(requests)).toEqual(
        Array.from({ length: 3 }, () => ({
          writableEndedAtRequest: true,
          aborted: false,
          writableFinished: true,
          rstCode: 0,
        })),
      );
    } finally {
      client.close();
      server.close();
    }
  });

  // Ending the writable side must not put an extra empty DATA frame on a stream the HEADERS frame
  // already half-closed: the native write is suppressed because the stream is HALF_CLOSED_LOCAL.
  // Conversely, endStream: false has to leave room for the body on the wire.
  it("puts a DATA frame on the wire only when the request can carry a body", async () => {
    // Decodes the frames the client sends, and answers each HEADERS with an END_STREAM response
    // carrying an HPACK-indexed ":status: 200" so the request completes.
    type Frame = { type: string | number; endStream: boolean; payload: Buffer };
    const frames: Frame[] = [];
    const server = net.createServer(socket => {
      socket.write(new http2utils.SettingsFrame().data);
      let buffer = Buffer.alloc(0);
      let sawMagic = false;
      socket.on("error", () => {});
      socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!sawMagic) {
          if (buffer.length < http2utils.kClientMagic.length) return;
          buffer = buffer.subarray(http2utils.kClientMagic.length);
          sawMagic = true;
        }
        while (buffer.length >= 9) {
          const length = buffer.readUIntBE(0, 3);
          if (buffer.length < 9 + length) return;
          const [type, flags] = [buffer[3], buffer[4]];
          const streamId = buffer.readUInt32BE(5) & 0x7fffffff;
          const payload = buffer.subarray(9, 9 + length);
          buffer = buffer.subarray(9 + length);
          if (type === 4 && !(flags & 0x1)) socket.write(new http2utils.SettingsFrame(true).data);
          if (streamId === 0) continue;
          frames.push({
            type: type === 0 ? "DATA" : type === 1 ? "HEADERS" : type,
            endStream: !!(flags & 0x1),
            payload,
          });
          if (type === 1) socket.write(new http2utils.HeadersFrame(streamId, Buffer.from([0x88]), 0, true, true).data);
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    try {
      client.on("error", () => {});
      async function wire(options: object, body?: string) {
        frames.length = 0;
        const req = client.request({ ":path": "/" }, options);
        req.on("error", () => {});
        req.resume();
        if (body !== undefined) req.end(body);
        await new Promise<void>(resolve => req.on("close", () => resolve()));
        return frames.slice();
      }

      const endStream = await wire({ endStream: true });
      expect(endStream.map(({ type, endStream }) => ({ type, endStream }))).toEqual([
        { type: "HEADERS", endStream: true },
      ]);

      const withBody = await wire({ endStream: false }, "hello");
      expect(withBody[0]).toMatchObject({ type: "HEADERS", endStream: false });
      const data = withBody.slice(1);
      expect(Buffer.concat(data.map(frame => frame.payload)).toString()).toBe("hello");
      expect(data.at(-1)!.endStream).toBe(true);
    } finally {
      client.close();
      server.close();
    }
  });
});
