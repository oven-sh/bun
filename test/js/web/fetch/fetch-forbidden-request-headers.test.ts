import { describe, expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

// Raw-socket origin that records the exact request head bytes and replies once
// `done(acc)` returns true. The returned server is disposable (`await using`).
function rawOrigin(done: (acc: Buffer) => boolean) {
  const state = { head: "" };
  const server = net.createServer(s => {
    s.on("error", () => {});
    let acc = Buffer.alloc(0);
    s.on("data", d => {
      acc = Buffer.concat([acc, d]);
      const i = acc.indexOf("\r\n\r\n");
      if (i < 0) return;
      if (!state.head) state.head = acc.subarray(0, i).toString();
      if (done(acc)) s.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
    });
  });
  return {
    state,
    listen: () =>
      new Promise<number>(r => server.listen(0, "127.0.0.1", () => r((server.address() as net.AddressInfo).port))),
    [Symbol.asyncDispose]: () => new Promise<void>(r => server.close(() => r())),
  };
}

async function recordedRequest(opts: RequestInit): Promise<{ lines: string[]; names: Set<string> }> {
  await using origin = rawOrigin(() => true);
  const port = await origin.listen();
  const res = await fetch(`http://127.0.0.1:${port}/x`, opts);
  await res.text();
  const lines = origin.state.head.split("\r\n");
  const names = new Set(lines.slice(1).map(l => l.split(":")[0].trim().toLowerCase()));
  return { lines, names };
}

function headerValue(lines: string[], name: string): string | undefined {
  const lc = name.toLowerCase();
  for (const l of lines.slice(1)) {
    const idx = l.indexOf(":");
    if (idx < 0) continue;
    if (l.slice(0, idx).trim().toLowerCase() === lc) return l.slice(idx + 1).trim();
  }
  return undefined;
}

describe("fetch() forbidden hop-by-hop request headers", () => {
  // The hop-by-hop / framing subset that must never reach the wire from fetch().
  // Undici enforces exactly this set; Cookie/Referer/Origin/Via etc. are allowed through.
  test("drops Connection, Keep-Alive, Expect, HTTP2-Settings from every setter path", async () => {
    const forbidden = {
      "Connection": "x-forwarded-for",
      "Keep-Alive": "timeout=5, max=1000",
      "Expect": "100-continue",
      "HTTP2-Settings": "AAMAAABkAARAAAAAAAIAAAAA",
    };

    const paths: Array<[string, RequestInit]> = [
      ["init headers object", { headers: { ...forbidden } }],
      ["new Headers", { headers: new Headers({ ...forbidden }) }],
      [
        "Headers.set",
        {
          headers: (() => {
            const h = new Headers();
            for (const [k, v] of Object.entries(forbidden)) h.set(k, v);
            return h;
          })(),
        },
      ],
      [
        "Headers.append",
        {
          headers: (() => {
            const h = new Headers();
            for (const [k, v] of Object.entries(forbidden)) h.append(k, v);
            return h;
          })(),
        },
      ],
    ];

    for (const [label, init] of paths) {
      const { names, lines } = await recordedRequest(init);
      expect(headerValue(lines, "connection"), `${label}: Connection value`).toBe("keep-alive");
      expect(names.has("keep-alive"), `${label}: Keep-Alive on wire`).toBe(false);
      expect(names.has("expect"), `${label}: Expect on wire`).toBe(false);
      expect(names.has("http2-settings"), `${label}: HTTP2-Settings on wire`).toBe(false);
    }
  });

  test("Connection header value is never forwarded verbatim (hop-by-hop directive injection)", async () => {
    // A relay forwarding untrusted inbound headers into fetch() and appending its own X-Forwarded-For.
    // If the caller's Connection directive reaches the upstream wire, an RFC 9110 §7.6.1 intermediary
    // strips the named header before forwarding, defeating the relay's own X-Forwarded-For.
    const cases: Array<[string, string | undefined]> = [
      ["x-forwarded-for", "keep-alive"],
      ["close, x-forwarded-for", "keep-alive"],
      ["Upgrade, HTTP2-Settings", "keep-alive"],
      ["close", undefined],
    ];
    for (const [value, expected] of cases) {
      const { lines } = await recordedRequest({ headers: { Connection: value } });
      expect(headerValue(lines, "connection")).toBe(expected);
    }
  });

  test("Upgrade: h2c (and HTTP2-Settings) are dropped", async () => {
    // The h2c-smuggling request shape. Bun already refuses the 101, but the request itself
    // must not advertise h2c upgrade on the wire. Upgrade is an RFC 9110 §7.8 token list,
    // so case and comma-delimited variants must also match.
    for (const value of ["h2c", "H2C", " h2c ", "h2c, dummy", "dummy, h2c", "h2"]) {
      const { names, lines } = await recordedRequest({
        headers: {
          "Connection": "Upgrade, HTTP2-Settings",
          "Upgrade": value,
          "HTTP2-Settings": "AAMAAABkAARAAAAAAAIAAAAA",
        },
      });
      expect(names.has("upgrade"), `Upgrade: ${JSON.stringify(value)} reached wire`).toBe(false);
      expect(names.has("http2-settings")).toBe(false);
      expect(headerValue(lines, "connection")).toBe("keep-alive");
    }
  });

  test("Upgrade: H2C with a stream body does not desync framing", async () => {
    // The JS-thread upgraded_connection check and the HTTP-thread build_request
    // drop must agree on what counts as h2c, or the wire declares chunked while
    // the body writer skips chunk framing.
    await using origin = rawOrigin(acc => acc.includes("0\r\n\r\n"));
    const port = await origin.listen();
    async function* body() {
      yield new TextEncoder().encode("hello");
    }
    const res = await fetch(`http://127.0.0.1:${port}/x`, {
      method: "POST",
      headers: { Upgrade: "H2C" },
      body: body(),
      // @ts-expect-error bun-specific
      duplex: "half",
    });
    expect(await res.text()).toBe("OK");
    const lines = origin.state.head.split("\r\n");
    expect(headerValue(lines, "upgrade")).toBeUndefined();
    expect(headerValue(lines, "transfer-encoding")).toBe("chunked");
  });

  test("Upgrade: websocket is preserved and Connection is normalized to 'Upgrade'", async () => {
    // Bun's fetch() supports protocol upgrade (PR #22390). The Upgrade token passes through,
    // but the Connection header is rewritten to exactly "Upgrade" so a caller cannot smuggle
    // extra hop-by-hop directives alongside the upgrade opt-in.
    await using origin = rawOrigin(() => true);
    const port = await origin.listen();
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: {
        "Connection": "Upgrade, x-forwarded-for",
        "Upgrade": "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    await res.text();
    const lines = origin.state.head.split("\r\n");
    expect(headerValue(lines, "upgrade")).toBe("websocket");
    expect(headerValue(lines, "connection")).toBe("Upgrade");
  });

  test("stream body: user Content-Length and Transfer-Encoding are ignored", async () => {
    // A stream body with a user-supplied Content-Length desynchronizes framing.
    // fetch() must own framing for stream bodies regardless of what the headers say.
    await using origin = rawOrigin(acc => acc.includes("0\r\n\r\n"));
    const port = await origin.listen();

    async function* body() {
      yield new TextEncoder().encode("hello");
    }

    const res = await fetch(`http://127.0.0.1:${port}/x`, {
      method: "POST",
      headers: {
        "Content-Length": "9999",
        "Transfer-Encoding": "identity",
      },
      body: body(),
      // @ts-expect-error bun-specific
      duplex: "half",
    });
    await res.text();

    const lines = origin.state.head.split("\r\n");
    expect(headerValue(lines, "content-length")).toBeUndefined();
    expect(headerValue(lines, "transfer-encoding")).toBe("chunked");
  });

  test("Request and Request.clone() paths also drop Connection", async () => {
    const req = new Request("http://placeholder/", { headers: { Connection: "x-forwarded-for" } });
    const cloned = req.clone();
    const derived = new Request(req, {});
    for (const r of [req, cloned, derived]) {
      const { lines } = await recordedRequest({ headers: r.headers });
      expect(headerValue(lines, "connection")).toBe("keep-alive");
    }
  });

  test("node:http client still owns Connection (control lane)", async () => {
    // node:http writes its request head in JS (_storeHeader) and never reaches
    // build_request, so it is unaffected by the fetch() drop arm.
    await using origin = rawOrigin(() => true);
    const port = await origin.listen();
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/", headers: { Connection: "x-custom-token" } });
      req.on("response", res => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end();
    });
    expect(/^connection:\s*x-custom-token/im.test(origin.state.head)).toBe(true);
  });
});
