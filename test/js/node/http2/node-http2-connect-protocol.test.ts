import { describe, expect, mock, test } from "bun:test";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { duplexPair } from "node:stream";

// node accepts more than @types/node declares: a plain-object authority, and options it ignores.
const connect = http2.connect as (...args: any[]) => http2.ClientHttp2Session;

type PseudoHeaders = { scheme: string; authority: string };

// An http2 server that reports the :scheme and :authority of each request it receives.
function echoServer() {
  const server = http2.createServer();
  server.on("stream", (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
    stream.respond({ ":status": 200 });
    stream.end(JSON.stringify({ scheme: headers[":scheme"], authority: headers[":authority"] }));
  });
  return server;
}

// The same server, answering on one side of an in-memory duplex pair.
function echoServerOverDuplexPair() {
  const [clientSide, serverSide] = duplexPair();
  const server = echoServer();
  server.emit("connection", serverSide);
  return { server, clientSide };
}

function requestJSON(
  client: http2.ClientHttp2Session,
  headers: http2.OutgoingHttpHeaders | string[],
  requestOptions?: object,
): Promise<PseudoHeaders> {
  return new Promise<string>((resolve, reject) => {
    const req = client.request(headers, requestOptions);
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => (body += chunk));
    req.on("error", reject);
    req.on("end", () => resolve(body));
    req.end();
  }).then(JSON.parse);
}

// One request with an object of headers, one with a raw [name, value, ...] array.
function pseudoHeadersSeenByServer(client: http2.ClientHttp2Session, requestOptions?: object) {
  const failed = new Promise<never>((_, reject) => client.on("error", reject));
  const seen = Promise.all([
    requestJSON(client, { ":path": "/" }, requestOptions),
    requestJSON(client, [":path", "/"], requestOptions),
  ]);
  return Promise.race([seen, failed]);
}

describe("http2.connect() authority protocol", () => {
  test("throws ERR_HTTP2_UNSUPPORTED_PROTOCOL with Node's message", () => {
    function thrownBy(...args: unknown[]) {
      let session: http2.ClientHttp2Session;
      try {
        session = connect(...args);
      } catch (e: any) {
        return { name: e.name, code: e.code, message: e.message };
      }
      session.on("error", () => {});
      session.destroy();
      return "no throw";
    }
    const unsupported = (protocol: string) => ({
      name: "Error",
      code: "ERR_HTTP2_UNSUPPORTED_PROTOCOL",
      message: `protocol "${protocol}" is unsupported.`,
    });

    expect(thrownBy("ftp://127.0.0.1:1")).toEqual(unsupported("ftp:"));
    expect(thrownBy(new URL("ssh://localhost"))).toEqual(unsupported("ssh:"));
    expect(thrownBy({ protocol: "gopher:", hostname: "localhost", port: 1 })).toEqual(unsupported("gopher:"));
    expect(thrownBy({ port: 1 }, { protocol: "ws:" })).toEqual(unsupported("ws:"));
    // Not a function, so connect() still opens the socket itself.
    expect(thrownBy("ftp://127.0.0.1:1", { createConnection: true })).toEqual(unsupported("ftp:"));
  });

  // node only reaches its protocol switch when it opens the socket itself:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L3629-L3643
  test("is not checked when options.createConnection opens the socket", async () => {
    const { server, clientSide } = echoServerOverDuplexPair();
    const createConnection = mock((_authority: URL) => clientSide);
    let client: http2.ClientHttp2Session | undefined;
    try {
      client = connect("ftp://example.test", { createConnection });
      expect(createConnection).toHaveBeenCalledTimes(1);
      expect(createConnection.mock.calls[0][0].protocol).toBe("ftp:");
      expect(await pseudoHeadersSeenByServer(client)).toEqual([
        { scheme: "ftp", authority: "example.test:443" },
        { scheme: "ftp", authority: "example.test:443" },
      ]);
    } finally {
      client?.close();
      server.close();
    }
  });

  test("from options.protocol is the default :scheme of a request", async () => {
    const server = echoServer();
    let client: http2.ClientHttp2Session | undefined;
    try {
      const port = await new Promise<number>(resolve =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
      );
      client = connect({ hostname: "127.0.0.1", port }, { protocol: "http:" });
      expect(await pseudoHeadersSeenByServer(client)).toEqual([
        { scheme: "http", authority: `127.0.0.1:${port}` },
        { scheme: "http", authority: `127.0.0.1:${port}` },
      ]);
    } finally {
      client?.close();
      server.close();
    }
  });

  // node has no `protocol` request option: only the connect-time protocol names the scheme.
  test("is not overridden by a protocol in the request() options", async () => {
    const { server, clientSide } = echoServerOverDuplexPair();
    let client: http2.ClientHttp2Session | undefined;
    try {
      client = connect({ hostname: "example.test", port: 443 }, { createConnection: () => clientSide });
      expect(await pseudoHeadersSeenByServer(client, { protocol: "http:" })).toEqual([
        { scheme: "https", authority: "example.test:443" },
        { scheme: "https", authority: "example.test:443" },
      ]);
    } finally {
      client?.close();
      server.close();
    }
  });
});
