// https://github.com/oven-sh/bun/issues/19111
// stream.Readable's `readable` event not firing in Bun 1.2.6+
import { expect, test } from "bun:test";
import { IncomingMessage, ServerResponse } from "http";
import { PassThrough, Readable } from "stream";

test("PassThrough stream 'readable' event should fire when data is written", async () => {
  const passThrough = new PassThrough();

  let readableEventFired = false;
  const promise = new Promise<void>(resolve => {
    passThrough.once("readable", () => {
      readableEventFired = true;
      resolve();
    });
  });

  // Write data to the stream
  passThrough.write("Hello, world!");
  passThrough.end();

  await promise;
  expect(readableEventFired).toBe(true);
});

test("ServerResponse with PassThrough pattern (connect-to-web pattern)", async () => {
  // This reproduces the pattern from connect-to-web.ts
  function createServerResponse(incomingMessage: IncomingMessage) {
    const res = new ServerResponse(incomingMessage);
    const passThrough = new PassThrough();
    let resolved = false;

    const onReadable = new Promise<{
      readable: Readable;
      headers: Record<string, any>;
      statusCode: number;
    }>((resolve, reject) => {
      const handleReadable = () => {
        if (resolved) return;
        resolved = true;
        resolve({
          readable: Readable.from(passThrough),
          headers: res.getHeaders(),
          statusCode: res.statusCode,
        });
      };

      const handleError = (err: Error) => {
        reject(err);
      };

      passThrough.once("readable", handleReadable);
      passThrough.once("end", handleReadable);
      passThrough.once("error", handleError);
      res.once("error", handleError);
    });

    res.once("finish", () => {
      passThrough.end();
    });

    passThrough.on("drain", () => {
      res.emit("drain");
    });

    res.write = passThrough.write.bind(passThrough);
    res.end = (passThrough as any).end.bind(passThrough);

    res.writeHead = function writeHead(
      statusCode: number,
      statusMessage?: string | any,
      headers?: any,
    ): ServerResponse {
      res.statusCode = statusCode;
      if (typeof statusMessage === "object") {
        headers = statusMessage;
        statusMessage = undefined;
      }
      if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
          if (value !== undefined) {
            res.setHeader(key, value);
          }
        });
      }
      return res;
    };

    return { res, onReadable };
  }

  // Create a mock IncomingMessage
  const mockReq = Object.assign(Readable.from([]), {
    url: "/test",
    method: "GET",
    headers: {},
  }) as IncomingMessage;

  const { res, onReadable } = createServerResponse(mockReq);

  // Simulate a middleware writing to the response
  setTimeout(() => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("Hello, world!");
    res.end();
  }, 10);

  // The promise should resolve when the readable event fires
  const result = await onReadable;
  expect(result.statusCode).toBe(200);
  expect(result.headers["content-type"]).toBe("text/plain");
}, 1000);

test("PassThrough readable event fires immediately if data written before listener", async () => {
  const passThrough = new PassThrough();

  // Write data BEFORE adding the listener
  passThrough.write("Hello, world!");

  let readableEventFired = false;
  const promise = new Promise<void>(resolve => {
    passThrough.once("readable", () => {
      readableEventFired = true;
      resolve();
    });
  });

  await promise;
  expect(readableEventFired).toBe(true);
});
