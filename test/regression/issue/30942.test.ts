// https://github.com/oven-sh/bun/issues/30942
//
// `ServerHttp2Stream.pushStream` used to throw `ERR_HTTP2_PUSH_DISABLED`
// synchronously from inside the 'stream' event handler, which killed user
// code following Node's `(err, pushStream) => {}` callback pattern. Node
// routes the same error through the callback instead (async). The stub
// now matches that contract so callers can observe the error and recover
// until real PUSH_PROMISE support lands (see #28713).

import { expect, test } from "bun:test";
import http2 from "node:http2";

test("pushStream delivers ERR_HTTP2_PUSH_DISABLED through the callback, not a sync throw", async () => {
  const server = http2.createServer();
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  server.on("stream", stream => {
    try {
      stream.pushStream({ ":path": "/x.js" }, (err, pushStream) => {
        try {
          expect(err).toBeInstanceOf(Error);
          expect((err as any).code).toBe("ERR_HTTP2_PUSH_DISABLED");
          expect(err!.message).toBe("HTTP/2 client has disabled push streams");
          expect(pushStream).toBeUndefined();
          stream.respond({ ":status": 200 });
          stream.end("ok");
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(new Error(`pushStream threw synchronously: ${(e as any)?.code ?? (e as Error).message}`));
    }
  });

  server.listen(0, () => {
    const port = (server.address() as any).port;
    const client = http2.connect(`http://localhost:${port}`);
    const req = client.request({ ":path": "/" });
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        expect(body).toBe("ok");
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        client.close();
        server.close();
      }
    });
    req.on("error", reject);
    req.end();
  });

  await promise;
});

test("pushStream callback fires asynchronously (next tick), not synchronously", async () => {
  const server = http2.createServer();
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  server.on("stream", stream => {
    let callbackInvoked = false;
    try {
      stream.pushStream({ ":path": "/x.js" }, err => {
        callbackInvoked = true;
        try {
          expect((err as any)?.code).toBe("ERR_HTTP2_PUSH_DISABLED");
        } catch (e) {
          reject(e);
        }
      });
      if (callbackInvoked) {
        reject(new Error("pushStream callback fired synchronously"));
        return;
      }
    } catch (e) {
      reject(new Error(`pushStream threw synchronously: ${(e as any)?.code ?? (e as Error).message}`));
      return;
    }
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });

  server.listen(0, () => {
    const port = (server.address() as any).port;
    const client = http2.connect(`http://localhost:${port}`);
    const req = client.request({ ":path": "/" });
    req.resume();
    req.on("end", () => {
      client.close();
      server.close();
      resolve();
    });
    req.on("error", reject);
    req.end();
  });

  await promise;
});

test("pushStream accepts the (headers, callback) shape with options omitted", async () => {
  const server = http2.createServer();
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  server.on("stream", stream => {
    try {
      stream.pushStream({ ":path": "/x.js" }, (err, pushStream) => {
        try {
          expect((err as any)?.code).toBe("ERR_HTTP2_PUSH_DISABLED");
          expect(pushStream).toBeUndefined();
        } catch (e) {
          reject(e);
        }
      });
      stream.respond({ ":status": 200 });
      stream.end("ok");
    } catch (e) {
      reject(e);
    }
  });

  server.listen(0, () => {
    const port = (server.address() as any).port;
    const client = http2.connect(`http://localhost:${port}`);
    const req = client.request({ ":path": "/" });
    req.resume();
    req.on("end", () => {
      client.close();
      server.close();
      resolve();
    });
    req.on("error", reject);
    req.end();
  });

  await promise;
});

test("pushStream rejects a non-function callback synchronously (ERR_INVALID_ARG_TYPE)", async () => {
  const server = http2.createServer();
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  server.on("stream", stream => {
    try {
      expect(() => (stream as any).pushStream({ ":path": "/x.js" }, "not-a-function")).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
      expect(() => (stream as any).pushStream({ ":path": "/x.js" })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
      stream.respond({ ":status": 200 });
      stream.end("ok");
      resolve();
    } catch (e) {
      reject(e);
    }
  });

  server.listen(0, () => {
    const port = (server.address() as any).port;
    const client = http2.connect(`http://localhost:${port}`);
    const req = client.request({ ":path": "/" });
    req.resume();
    req.on("end", () => {
      client.close();
      server.close();
    });
    req.on("error", () => {});
    req.end();
  });

  await promise;
});

test("Http2ServerResponse.createPushResponse delivers the error via its callback", async () => {
  const server = http2.createServer((req, res) => {
    res.createPushResponse({ ":path": "/x.js" }, (err, pushRes) => {
      expect((err as any)?.code).toBe("ERR_HTTP2_PUSH_DISABLED");
      expect(pushRes).toBeUndefined();
      res.end("ok");
    });
  });
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  server.listen(0, () => {
    const port = (server.address() as any).port;
    const client = http2.connect(`http://localhost:${port}`);
    const req = client.request({ ":path": "/" });
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        expect(body).toBe("ok");
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        client.close();
        server.close();
      }
    });
    req.on("error", reject);
    req.end();
  });

  await promise;
});
