import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

// fetch() must compute request-body framing itself. A caller-supplied
// Content-Length or Transfer-Encoding on a ReadableStream body would let the
// body bytes diverge from the declared length, which is the primitive behind
// HTTP request smuggling (CL.0 desync) through any front end that frames by
// Content-Length. Both header names are forbidden request-header names in the
// Fetch spec; undici rejects the same shapes with
// RequestContentLengthMismatchError / InvalidArgumentError.
describe("fetch() with a ReadableStream body ignores caller framing headers", () => {
  async function roundTrip(opts: { headers?: Record<string, string>; streamPayload: string; terminator: string }) {
    const sockets: net.Socket[] = [];
    let raw = "";
    const { promise: sawTerminator, resolve } = Promise.withResolvers<void>();
    const server = net.createServer(socket => {
      sockets.push(socket);
      socket.on("error", () => {});
      socket.on("data", chunk => {
        raw += chunk.toString("latin1");
        if (raw.includes(opts.terminator)) resolve();
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(opts.streamPayload));
          c.close();
        },
      });
      const resP = fetch(`http://127.0.0.1:${port}/upload`, {
        method: "POST",
        body,
        // @ts-expect-error duplex not yet in lib types
        duplex: "half",
        headers: opts.headers,
      });
      await sawTerminator;
      for (const s of sockets) s.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
      const res = await resP;
      await res.arrayBuffer();
      return raw;
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
      await once(server, "close");
    }
  }

  function head(raw: string) {
    return raw.slice(0, raw.indexOf("\r\n\r\n")).toLowerCase();
  }

  test("caller Content-Length is dropped; body is chunked", async () => {
    const injected = "GET /admin HTTP/1.1\r\nHost: origin.internal\r\n\r\n";
    const raw = await roundTrip({
      headers: { "content-length": "4" },
      streamPayload: "abcd" + injected,
      terminator: "origin.internal",
    });
    const h = head(raw);
    expect(h).toContain("transfer-encoding: chunked");
    expect(h).not.toContain("content-length:");
    expect(raw.startsWith("POST /upload HTTP/1.1\r\n")).toBe(true);
  });

  test("caller Transfer-Encoding is dropped; body is still engine-chunked", async () => {
    const raw = await roundTrip({
      headers: { "transfer-encoding": "chunked" },
      streamPayload: "abcd",
      terminator: "0\r\n\r\n",
    });
    const h = head(raw);
    expect(h.match(/transfer-encoding:/g)?.length).toBe(1);
    expect(h).not.toContain("content-length:");
    expect(raw).toEndWith("0\r\n\r\n");
  });

  test("caller Content-Length + Transfer-Encoding both present: still chunked, no CL", async () => {
    const raw = await roundTrip({
      headers: { "content-length": "4", "transfer-encoding": "chunked" },
      streamPayload: "abcdEXTRA",
      terminator: "0\r\n\r\n",
    });
    const h = head(raw);
    expect(h).toContain("transfer-encoding: chunked");
    expect(h.match(/transfer-encoding:/g)?.length).toBe(1);
    expect(h).not.toContain("content-length:");
  });

  // End-to-end: a keep-alive front end delimits each inbound message by its
  // declared framing (Content-Length, or Transfer-Encoding: chunked) and
  // records the request line of every message it parses. If fetch honored the
  // caller's CL:4 for a longer stream body, the surplus bytes would be parsed
  // here as a SECOND request (`GET /admin`).
  test("a CL-trusting front end cannot be desynced", async () => {
    function chunkedLen(s: string): number | null {
      let i = 0;
      for (;;) {
        const nl = s.indexOf("\r\n", i);
        if (nl < 0) return null;
        const n = parseInt(s.slice(i, nl), 16);
        if (!Number.isFinite(n)) return null;
        i = nl + 2 + n + 2;
        if (n === 0) return i <= s.length ? i : null;
        if (i > s.length) return null;
      }
    }

    const seen: string[] = [];
    const frontend = net.createServer(s => {
      let buf = "";
      s.on("error", () => {});
      s.on("data", b => {
        buf += b.toString("latin1");
        for (;;) {
          const he = buf.indexOf("\r\n\r\n");
          if (he < 0) break;
          const headText = buf.slice(0, he);
          let bodyLen: number;
          if (/transfer-encoding:\s*chunked/i.test(headText)) {
            const len = chunkedLen(buf.slice(he + 4));
            if (len === null) break;
            bodyLen = len;
          } else {
            const m = /content-length:\s*(\d+)/i.exec(headText);
            bodyLen = m ? Number(m[1]) : 0;
            if (buf.length - (he + 4) < bodyLen) break;
          }
          seen.push(headText.split("\r\n")[0]);
          buf = buf.slice(he + 4 + bodyLen);
          s.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        }
      });
    });
    await once(frontend.listen(0, "127.0.0.1"), "listening");
    const port = (frontend.address() as net.AddressInfo).port;
    const sockets = new Set<net.Socket>();
    frontend.on("connection", s => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });

    try {
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("abcd" + "GET /admin HTTP/1.1\r\nHost: origin.internal\r\n\r\n"));
          c.close();
        },
      });
      const res = await fetch(`http://127.0.0.1:${port}/upload`, {
        method: "POST",
        body,
        // @ts-expect-error
        duplex: "half",
        headers: { "content-length": "4" },
      });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
      expect(seen).toEqual(["POST /upload HTTP/1.1"]);
    } finally {
      for (const s of sockets) s.destroy();
      frontend.close();
      await once(frontend, "close");
    }
  });
});

// node:http's ClientRequest is a raw HTTP/1.1 API where the caller owns
// framing; an explicit Content-Length there MUST be honored (Node.js parity).
test("node:http request() still honors an explicit Content-Length with a streamed body", async () => {
  let raw = "";
  const { promise: done, resolve } = Promise.withResolvers<void>();
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.on("data", chunk => {
      raw += chunk.toString("latin1");
      if (raw.endsWith("abcd")) {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        resolve();
      }
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/upload",
      headers: { "content-length": "4" },
    });
    req.write("ab");
    req.write("cd");
    req.end();
    await done;
    const h = raw.slice(0, raw.indexOf("\r\n\r\n")).toLowerCase();
    expect(h).toContain("content-length: 4");
    expect(h).not.toContain("transfer-encoding");
    expect(raw.slice(raw.indexOf("\r\n\r\n") + 4)).toBe("abcd");
  } finally {
    server.close();
    await once(server, "close");
  }
});
