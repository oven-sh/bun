// https://github.com/oven-sh/bun/issues/19111
// stream.Readable's `readable` event not firing in Bun 1.2.6+
import assert from "node:assert";
import { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough, Readable } from "node:stream";
import { test } from "node:test";

// Helper to create mock IncomingMessage
function createMockIncomingMessage(url: string): IncomingMessage {
  return Object.assign(Readable.from([]), {
    url,
    method: "GET",
    headers: {},
  }) as IncomingMessage;
}

// Focused regression test: Standalone ServerResponse.writableNeedDrain should be false
test("Standalone ServerResponse.writableNeedDrain is false", () => {
  const mockReq = createMockIncomingMessage("/need-drain");
  const res = new ServerResponse(mockReq);

  // Regression for #19111: previously true due to defaulting bufferedAmount to 1
  assert.strictEqual(res.writableNeedDrain, false);
});

// Helper function for connect-to-web pattern
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
        readable: passThrough,
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

  res.writeHead = function writeHead(statusCode: number, statusMessage?: string | any, headers?: any): ServerResponse {
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

test("Readable.pipe(ServerResponse) flows without stalling (regression for #19111)", async () => {
  const mockReq = createMockIncomingMessage("/pipe");
  const { res, onReadable } = createServerResponse(mockReq);

  // Pipe a readable source into ServerResponse; should not stall
  const src = Readable.from(["Hello, ", "world!"]);
  res.writeHead(200, { "Content-Type": "text/plain" });
  src.pipe(res);

  const out = await onReadable;
  assert.strictEqual(out.statusCode, 200);
  assert.strictEqual(out.headers["content-type"], "text/plain");
});
