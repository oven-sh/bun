import { describe, expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

// Raw-socket origin that records the exact request head bytes fetch() put on
// the wire, so we can assert which hop-by-hop / framing headers were dropped.
async function recordedRequest(opts: RequestInit): Promise<{ head: string; lines: string[]; names: Set<string> }> {
  let captured = "";
  const origin = net.createServer(s => {
    let acc = Buffer.alloc(0);
    s.on("data", d => {
      acc = Buffer.concat([acc, d]);
      const i = acc.indexOf("\r\n\r\n");
      if (i < 0) return;
      captured = acc.subarray(0, i).toString();
      s.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
    });
  });
  await new Promise<void>(r => origin.listen(0, "127.0.0.1", r));
  const { port } = origin.address() as net.AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/x`, opts);
    await res.text();
  } finally {
    await new Promise<void>(r => origin.close(() => r()));
  }
  const lines = captured.split("\r\n");
  const names = new Set(lines.slice(1).map(l => l.split(":")[0].trim().toLowerCase()));
  return { head: captured, lines, names };
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
      // Connection defaults to keep-alive; the user's arbitrary directive must not appear.
      expect(headerValue(lines, "connection"), `${label}: Connection value`).not.toContain("x-forwarded-for");
      expect(names.has("keep-alive"), `${label}: Keep-Alive on wire`).toBe(false);
      expect(names.has("expect"), `${label}: Expect on wire`).toBe(false);
      expect(names.has("http2-settings"), `${label}: HTTP2-Settings on wire`).toBe(false);
    }
  });

  test("Connection header value is never forwarded verbatim (hop-by-hop directive injection)", async () => {
    // A relay forwarding untrusted inbound headers into fetch() and appending its own X-Forwarded-For.
    // If the caller's Connection directive reaches the upstream wire, an RFC 9110 §7.6.1 intermediary
    // strips the named header before forwarding, defeating the relay's own X-Forwarded-For.
    for (const value of ["x-forwarded-for", "close, x-forwarded-for", "Upgrade, HTTP2-Settings"]) {
      const { lines } = await recordedRequest({ headers: { Connection: value } });
      const wire = headerValue(lines, "connection");
      expect(wire).not.toBe(value);
      expect(wire === undefined || wire === "keep-alive").toBe(true);
    }
  });

  test("Upgrade: h2c (and HTTP2-Settings) are dropped", async () => {
    // The h2c-smuggling request shape. Bun already refuses the 101, but the request itself
    // must not advertise h2c upgrade on the wire.
    const { names, lines } = await recordedRequest({
      headers: {
        "Connection": "Upgrade, HTTP2-Settings",
        "Upgrade": "h2c",
        "HTTP2-Settings": "AAMAAABkAARAAAAAAAIAAAAA",
      },
    });
    expect(names.has("upgrade")).toBe(false);
    expect(names.has("http2-settings")).toBe(false);
    expect(headerValue(lines, "connection")).toBe("keep-alive");
  });

  test("Upgrade: websocket is preserved and Connection is normalized to 'Upgrade'", async () => {
    // Bun's fetch() supports protocol upgrade (PR #22390). The Upgrade token passes through,
    // but the Connection header is rewritten to exactly "Upgrade" so a caller cannot smuggle
    // extra hop-by-hop directives alongside the upgrade opt-in.
    let captured = "";
    const origin = net.createServer(s => {
      let acc = Buffer.alloc(0);
      s.on("data", d => {
        acc = Buffer.concat([acc, d]);
        const i = acc.indexOf("\r\n\r\n");
        if (i < 0) return;
        captured = acc.subarray(0, i).toString();
        // Deliberately return 200, not 101: we only care what hit the wire.
        s.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
      });
    });
    await new Promise<void>(r => origin.listen(0, "127.0.0.1", r));
    const { port } = origin.address() as net.AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: {
        "Connection": "Upgrade, x-forwarded-for",
        "Upgrade": "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    await res.text();
    await new Promise<void>(r => origin.close(() => r()));

    const lines = captured.split("\r\n");
    const conn = headerValue(lines, "connection");
    const upgrade = headerValue(lines, "upgrade");
    expect(upgrade).toBe("websocket");
    expect(conn).toBe("Upgrade");
  });

  test("stream body: user Content-Length and Transfer-Encoding are ignored", async () => {
    // #3610 face: a stream body with a user-supplied Content-Length desynchronizes framing.
    // fetch() must own framing for stream bodies regardless of what the headers say.
    let captured = "";
    const origin = net.createServer(s => {
      let acc = Buffer.alloc(0);
      s.on("data", d => {
        acc = Buffer.concat([acc, d]);
        const i = acc.indexOf("\r\n\r\n");
        if (i < 0) return;
        if (!captured) captured = acc.subarray(0, i).toString();
      });
      // Wait for the chunked terminator before replying so the client finishes writing.
      s.on("data", d => {
        if (acc.includes("0\r\n\r\n")) {
          s.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
        }
      });
    });
    await new Promise<void>(r => origin.listen(0, "127.0.0.1", r));
    const { port } = origin.address() as net.AddressInfo;

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
    await new Promise<void>(r => origin.close(() => r()));

    const lines = captured.split("\r\n");
    expect(headerValue(lines, "content-length")).toBeUndefined();
    expect(headerValue(lines, "transfer-encoding")).toBe("chunked");
  });

  test("Request and Request.clone() paths also drop Connection", async () => {
    const req = new Request("http://placeholder/", { headers: { Connection: "x-forwarded-for" } });
    const cloned = req.clone();
    const derived = new Request(req, {});
    for (const r of [req, cloned, derived]) {
      const { lines } = await recordedRequest({ headers: r.headers });
      expect(headerValue(lines, "connection")).not.toContain("x-forwarded-for");
    }
  });

  test("node:http client still owns Connection (control lane)", async () => {
    // The drop is fetch()-only; node:http writes its own request line and must keep full control.
    let head = "";
    const origin = net.createServer(s => {
      let acc = Buffer.alloc(0);
      s.on("data", d => {
        acc = Buffer.concat([acc, d]);
        const i = acc.indexOf("\r\n\r\n");
        if (i < 0) return;
        head = acc.subarray(0, i).toString();
        s.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
      });
    });
    await new Promise<void>(r => origin.listen(0, "127.0.0.1", r));
    const { port } = origin.address() as net.AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/", headers: { Connection: "x-custom-token" } });
      req.on("response", res => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end();
    });
    await new Promise<void>(r => origin.close(() => r()));
    expect(/^connection:\s*x-custom-token/im.test(head)).toBe(true);
  });
});
