import { expect, it } from "bun:test";
import http2 from "node:http2";
import tls from "node:tls";
import { TLS_CERT } from "./http2-helpers";

// Opens a raw TLS/http-1.1 connection to the allowHTTP1 fallback, writes
// requestText, and resolves with the full response once the socket ends.
// onData(buf, socket) fires per chunk so callers can send the body on 100 Continue.
async function sendRawHttp1Request(server, requestText, onData) {
  await new Promise<void>(resolve => server.listen(0, resolve));
  try {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const socket = tls.connect(
      { host: "127.0.0.1", port: server.address().port, ca: TLS_CERT.cert, ALPNProtocols: ["http/1.1"] },
      () => socket.write(requestText),
    );
    const chunks: Buffer[] = [];
    socket.on("error", reject);
    socket.on("data", chunk => {
      chunks.push(chunk);
      onData?.(Buffer.concat(chunks), socket);
    });
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
    return await promise;
  } finally {
    server.close();
  }
}

function statusLinesOf(raw: string) {
  return raw
    .split("\r\n\r\n")
    .map(block => block.split("\r\n")[0])
    .filter(Boolean);
}

function bodyOf(raw: string) {
  return raw.slice(raw.lastIndexOf("\r\n\r\n") + 4);
}

// Sends the body once the 100 Continue line arrives, guarding the double send.
function sendBodyOnContinue() {
  let bodySent = false;
  return (buf: Buffer, socket: tls.TLSSocket) => {
    if (!bodySent && buf.includes("100 Continue")) {
      bodySent = true;
      socket.write("hello");
    }
  };
}

const EXPECT_CONTINUE_REQUEST =
  "POST /x HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 5\r\nExpect: 100-continue\r\n\r\n";

it("http2 allowHTTP1 fallback emits checkContinue and writes 100 Continue for Expect: 100-continue", async () => {
  const events: string[] = [];
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true });
  server.on("request", (req, res) => {
    events.push("request:hv=" + req.httpVersion);
    req.on("data", () => {});
    req.on("end", () => res.end("done"));
  });
  server.on("checkContinue", (req, res) => {
    events.push("checkContinue:hv=" + req.httpVersion);
    res.writeContinue();
    req.on("data", () => {});
    req.on("end", () => res.end("cc-done"));
  });
  const raw = await sendRawHttp1Request(server, EXPECT_CONTINUE_REQUEST, sendBodyOnContinue());
  const statusLines = statusLinesOf(raw);
  expect(statusLines[0]).toBe("HTTP/1.1 100 Continue");
  expect(statusLines[1]).toStartWith("HTTP/1.1 200 ");
  expect(bodyOf(raw)).toBe("cc-done");
  // The request must be dispatched through checkContinue, not straight to 'request'.
  expect(events).toEqual(["checkContinue:hv=1.1"]);
});

it("http2 allowHTTP1 fallback auto-writes 100 Continue and emits request when no checkContinue listener", async () => {
  const events: string[] = [];
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true });
  server.on("request", (req, res) => {
    events.push("request:hv=" + req.httpVersion);
    req.on("data", () => {});
    req.on("end", () => res.end("done"));
  });
  const raw = await sendRawHttp1Request(server, EXPECT_CONTINUE_REQUEST, sendBodyOnContinue());
  const statusLines = statusLinesOf(raw);
  expect(statusLines[0]).toBe("HTTP/1.1 100 Continue");
  expect(statusLines[1]).toStartWith("HTTP/1.1 200 ");
  expect(bodyOf(raw)).toBe("done");
  expect(events).toEqual(["request:hv=1.1"]);
});

it("http2 allowHTTP1 fallback answers an unsupported expectation with 417 and no request event", async () => {
  const events: string[] = [];
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true });
  server.on("request", (req, res) => {
    events.push("request");
    res.end("should-not-happen");
  });
  const raw = await sendRawHttp1Request(
    server,
    "POST /x HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 5\r\nExpect: something-else\r\n\r\n",
  );
  expect(raw).toStartWith("HTTP/1.1 417 ");
  expect(events).toEqual([]);
});

it("http2 allowHTTP1 fallback ignores Expect: 100-continue on an HTTP/1.0 request", async () => {
  const events: string[] = [];
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true });
  server.on("checkContinue", () => events.push("checkContinue"));
  server.on("request", (req, res) => {
    events.push("request:hv=" + req.httpVersion);
    req.on("data", () => {});
    req.on("end", () => res.end("done"));
  });
  // HTTP/1.0 request line: per RFC 7231 5.1.1 the 100-continue expectation
  // must be ignored and no 100 written, so send the body up front.
  const raw = await sendRawHttp1Request(
    server,
    "POST /x HTTP/1.0\r\nHost: localhost\r\nContent-Length: 5\r\nExpect: 100-continue\r\n\r\nhello",
  );
  expect(raw).not.toContain("100 Continue");
  expect(bodyOf(raw)).toBe("done");
  expect(events).toEqual(["request:hv=1.0"]);
});
