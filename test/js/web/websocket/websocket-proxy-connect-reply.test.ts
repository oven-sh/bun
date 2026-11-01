import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tls as tlsCerts } from "harness";
import net from "node:net";
import { ignoreAmbientNoProxy, openOrFailure, startEchoServer, startProxy } from "./proxy-test-utils";
import { createPeer, encodeFrame, OP, response101 } from "./raw-peer";

ignoreAmbientNoProxy();

let echo: ReturnType<typeof startEchoServer>;
let echoUrl: string;

beforeAll(() => {
  echo = startEchoServer();
  echoUrl = `ws://127.0.0.1:${echo.port}/`;
});

afterAll(() => {
  echo?.stop(true);
});

/** Resolves with the first message (the echo server greets with "connected"), or the error message after "failed: ". */
const greetingOrFailure = (ws: WebSocket) => openOrFailure(ws, "message");

/**
 * A proxy that replies to every CONNECT with `reply`, then tunnels to the requested port.
 * With `firstRead`, the reply is split into two writes. Between them the proxy completes a whole
 * WebSocket handshake with the echo server on the same event loop, so the client is guaranteed to
 * read the first `firstRead` bytes separately.
 */
async function startFixedReplyProxy(reply: string, firstRead = reply.length) {
  /** Each CONNECT request's head, decoded as latin1. */
  const requests: string[] = [];
  const proxy = net.createServer(client => {
    let request = "";
    let targetPort = 0;
    let target: net.Socket | undefined;
    // The client disconnects as soon as it rejects a reply, so a later write can fail.
    client.on("error", () => {});
    client.on("close", () => target?.destroy());
    client.on("data", async chunk => {
      if (targetPort) {
        if (!target) {
          target = net.connect(targetPort, "127.0.0.1");
          target.on("data", bytes => void client.write(bytes));
          target.on("error", () => client.destroy());
          target.on("close", () => client.destroy());
        }
        return void target.write(chunk);
      }
      request += chunk.toString("latin1");
      if (!request.endsWith("\r\n\r\n")) return;
      requests.push(request);
      targetPort = Number(/^CONNECT [^ ]*:(\d+) /.exec(request)![1]);

      client.write(Buffer.from(reply.slice(0, firstRead), "latin1"));
      if (firstRead >= reply.length) return;
      await greetingOrFailure(new WebSocket(echoUrl));
      client.write(Buffer.from(reply.slice(firstRead), "latin1"));
    });
  });
  const port = await startProxy(proxy);
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    [Symbol.dispose]() {
      proxy.close();
    },
  };
}

// Interim responses count toward the response header size limit of 16 KB + 1 KB.
const CONTINUE = "HTTP/1.1 100 Continue\r\n\r\n";
const fitting = Math.floor((16384 + 1024) / CONTINUE.length);
const interim = (count: number) => Buffer.alloc(count * CONTINUE.length, CONTINUE).toString();

describe("CONNECT reply", () => {
  describe.each([
    ["200", "HTTP/1.1 200 Connection established\r\n\r\n", "connected"],
    ["200 without a reason phrase", "HTTP/1.1 200\r\n\r\n", "connected"],
    ["200 over HTTP/1.0", "HTTP/1.0 200 Connection established\r\n\r\n", "connected"],
    // RFC 9110 section 9.3.6: any 2xx reply opens the tunnel. fetch() applies the same rule.
    ["201", "HTTP/1.1 201 Created\r\n\r\n", "connected"],
    ["204", "HTTP/1.1 204 No Content\r\n\r\n", "connected"],
    ["299", "HTTP/1.1 299 Tunnel Ready\r\n\r\n", "connected"],
    ["100 Continue, then 200", "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\n\r\n", "connected"],
    [
      "101",
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      "Proxy connection failed: 101 Switching Protocols",
    ],
    [
      "300",
      "HTTP/1.1 300 Multiple Choices\r\nContent-Length: 0\r\n\r\n",
      "Proxy connection failed: 300 Multiple Choices",
    ],
    [
      "403 with a body",
      "HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\n\r\ndenied",
      "Proxy connection failed: 403 Forbidden",
    ],
    [
      "407",
      'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="proxy"\r\nContent-Length: 0\r\n\r\n',
      "Proxy authentication required: 407 Proxy Authentication Required",
    ],
    ["502 without a reason phrase", "HTTP/1.1 502\r\nContent-Length: 0\r\n\r\n", "Proxy connection failed: 502"],
    [
      "100 Continue, then 503",
      "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 503 Busy\r\n\r\n",
      "Proxy connection failed: 503 Busy",
    ],
    [
      "interim responses just under the size limit, then 200",
      interim(fitting) + "HTTP/1.1 200 OK\r\n\r\n",
      "connected",
    ],
    [
      "interim responses over the size limit, then 200",
      interim(fitting + 1) + "HTTP/1.1 200 OK\r\n\r\n",
      "Response headers too large",
    ],
    ["non-HTTP reply", "SSH-2.0-OpenSSH_9.6\r\n", "Invalid response"],
  ])("%s", (_, reply, outcome) => {
    test.each([
      ["in one read", undefined],
      ["in two reads (the first is 10 bytes)", 10],
    ])("%s", async (_, firstRead) => {
      using proxy = await startFixedReplyProxy(reply, firstRead);
      expect({
        outcome: await greetingOrFailure(new WebSocket(echoUrl, { proxy: proxy.url })),
        connects: proxy.requests.length,
      }).toEqual({ outcome, connects: 1 });
    });
  });

  test("allows any number of headers", async () => {
    const headers = Array.from({ length: 200 }, (_, i) => `x-${i}: v\r\n`).join("");
    using proxy = await startFixedReplyProxy(`HTTP/1.1 200 OK\r\n${headers}\r\n`);
    expect(await greetingOrFailure(new WebSocket(echoUrl, { proxy: proxy.url }))).toBe("connected");
  });

  test.each([
    ["in one read", undefined],
    ["in two reads (the first is under the limit)", 16000],
  ])("fails when its headers exceed the size limit, %s", async (_, firstRead) => {
    const reply = `HTTP/1.1 200 OK\r\nX-Pad: ${Buffer.alloc(21000, "a").toString()}\r\n\r\n`;
    using proxy = await startFixedReplyProxy(reply, firstRead);
    expect(await greetingOrFailure(new WebSocket(echoUrl, { proxy: proxy.url }))).toBe("Response headers too large");
  });

  test.each(["ws", "wss"])(
    "interim responses before it don't count toward the limit of the %s: target's response",
    async protocol => {
      await using server = await createPeer({
        secure: protocol === "wss",
        respond: connection => interim(fitting) + response101(connection),
        afterUpgrade: encodeFrame(OP.text, "connected"),
      });
      using proxy = await startFixedReplyProxy(interim(fitting) + "HTTP/1.1 200 OK\r\n\r\n");
      const ws = new WebSocket(server.url, { proxy: proxy.url, tls: { ca: tlsCerts.cert } });
      expect(await greetingOrFailure(ws)).toBe("connected");
    },
  );
});

describe("101 response received through a TLS tunnel", () => {
  /** A wss:// server that replies with `before101`, a 101 with the `extra` header lines, and a "connected" message. */
  function startWssServer(before101: string, extra: string[]) {
    return createPeer({
      secure: true,
      respond: connection => before101 + response101(connection, extra),
      afterUpgrade: encodeFrame(OP.text, "connected"),
    });
  }

  test.each([
    ["200 extra headers", "", Array.from({ length: 200 }, (_, i) => `x-${i}: v`), "connected"],
    [
      "an interim response before the 101",
      "HTTP/1.1 103 Early Hints\r\nLink: </a.css>; rel=preload\r\n\r\n",
      [],
      "connected",
    ],
    ["interim responses just under the size limit before the 101", interim(fitting), [], "connected"],
    ["interim responses over the size limit before the 101", interim(fitting + 1), [], "Response headers too large"],
    [
      "headers over the size limit",
      "",
      ["X-Pad: " + Buffer.alloc(21000, "a").toString()],
      "Response headers too large",
    ],
    ["an extension the client didn't offer", "", ["Sec-WebSocket-Extensions: foo"], "Unsupported websocket extension"],
  ])("%s", async (_, before101, extra, outcome) => {
    await using server = await startWssServer(before101, extra);
    using proxy = await startFixedReplyProxy("HTTP/1.1 200 OK\r\n\r\n");
    const ws = new WebSocket(server.url, { proxy: proxy.url, tls: { ca: tlsCerts.cert } });
    expect(await greetingOrFailure(ws)).toBe(outcome);
  });

  test("sets error.code for an untrusted certificate", async () => {
    await using server = await startWssServer("", []);
    using proxy = await startFixedReplyProxy("HTTP/1.1 200 OK\r\n\r\n");
    const ws = new WebSocket(server.url, { proxy: proxy.url });
    const { promise, resolve } = Promise.withResolvers<unknown>();
    ws.addEventListener("error", event => resolve((event as ErrorEvent).error.code));
    expect({ outcome: await greetingOrFailure(ws), code: await promise }).toEqual({
      outcome: "TLS handshake failed: self signed certificate",
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
  });
});

describe("CONNECT request", () => {
  /** Returns the lines of the CONNECT request that `connect` sends to a proxy that rejects it. Headers are sorted. */
  async function connectRequest(connect: (proxy: { url: string; port: number }) => Promise<unknown>) {
    using proxy = await startFixedReplyProxy("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    await connect(proxy);
    expect(proxy.requests).toHaveLength(1);
    const [requestLine, ...headers] = proxy.requests[0].split("\r\n").slice(0, -2);
    return [requestLine, ...headers.sort()];
  }

  // WebSocket and fetch() share the function that writes the CONNECT request.
  describe.each([
    [
      "WebSocket",
      (proxy: string | { url: string; headers: Record<string, string> }) =>
        greetingOrFailure(new WebSocket("wss://127.0.0.1:8443/", { proxy })),
    ],
    [
      "fetch",
      (proxy: string | { url: string; headers: Record<string, string> }) =>
        fetch("https://127.0.0.1:8443/", { proxy }).catch(() => {}),
    ],
  ])("%s", (_, connect) => {
    test("no options", async () => {
      expect(await connectRequest(({ url }) => connect(url))).toEqual([
        "CONNECT 127.0.0.1:8443 HTTP/1.1",
        "Host: 127.0.0.1:8443",
        "Proxy-Connection: Keep-Alive",
      ]);
    });

    test("credentials in the proxy URL", async () => {
      expect(await connectRequest(({ port }) => connect(`http://user:pass@127.0.0.1:${port}`))).toEqual([
        "CONNECT 127.0.0.1:8443 HTTP/1.1",
        "Host: 127.0.0.1:8443",
        `Proxy-Authorization: Basic ${btoa("user:pass")}`,
        "Proxy-Connection: Keep-Alive",
      ]);
    });

    test("a Proxy-Authorization header overrides credentials in the proxy URL", async () => {
      const headers = { "Proxy-Authorization": "Bearer token" };
      expect(
        await connectRequest(({ port }) => connect({ url: `http://user:pass@127.0.0.1:${port}`, headers })),
      ).toEqual([
        "CONNECT 127.0.0.1:8443 HTTP/1.1",
        "Host: 127.0.0.1:8443",
        "Proxy-Authorization: Bearer token",
        "Proxy-Connection: Keep-Alive",
      ]);
    });

    test("a Host or Proxy-Connection header overrides the default", async () => {
      const headers = { "Host": "other.test", "Proxy-Connection": "close" };
      expect(await connectRequest(({ url }) => connect({ url, headers }))).toEqual([
        "CONNECT 127.0.0.1:8443 HTTP/1.1",
        "Host: other.test",
        "Proxy-Connection: close",
      ]);
    });

    test("header values are sent as latin1", async () => {
      const headers = { "X-Latin1": "café" };
      expect(await connectRequest(({ url }) => connect({ url, headers }))).toEqual([
        "CONNECT 127.0.0.1:8443 HTTP/1.1",
        "Host: 127.0.0.1:8443",
        "Proxy-Connection: Keep-Alive",
        "X-Latin1: café",
      ]);
    });
  });
});
