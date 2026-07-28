// Windows SSPI (Negotiate/NTLM) proxy authentication. The mock proxy below
// speaks just enough of MS-NLMP to let secur32.dll run the handshake against
// the current user's logon session, so these tests only run on Windows.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls as tlsCert } from "harness";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import net from "node:net";

// MS-NLMP §2.2.1.2 CHALLENGE_MESSAGE, 48-byte minimum:
//   Signature        "NTLMSSP\0"
//   MessageType      0x00000002
//   TargetNameFields len=0 maxlen=0 offset=48
//   NegotiateFlags   UNICODE | NTLM | ALWAYS_SIGN | TARGET_TYPE_SERVER
//   ServerChallenge  8 bytes
//   Reserved         8 zero bytes
//   TargetInfoFields len=0 maxlen=0 offset=48
function ntlmType2(): Buffer {
  const b = Buffer.alloc(48);
  b.write("NTLMSSP\0", 0, "binary");
  b.writeUInt32LE(2, 8);
  b.writeUInt16LE(0, 12);
  b.writeUInt16LE(0, 14);
  b.writeUInt32LE(48, 16);
  b.writeUInt32LE(0x00028201, 20);
  Buffer.from([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]).copy(b, 24);
  // Reserved (8 bytes at 32) already zero
  b.writeUInt16LE(0, 40);
  b.writeUInt16LE(0, 42);
  b.writeUInt32LE(48, 44);
  return b;
}

type Leg = { method: string; path: string; auth: string | null };

function parseHead(head: string): Leg {
  const [reqLine, ...headerLines] = head.split("\r\n");
  const [method, path] = reqLine.split(" ");
  let auth: string | null = null;
  for (const line of headerLines) {
    const i = line.indexOf(":");
    if (i > 0 && line.slice(0, i).toLowerCase() === "proxy-authorization") {
      auth = line.slice(i + 1).trim();
    }
  }
  return { method, path, auth };
}

function ntlmMessageType(authHeader: string | null): number | null {
  if (!authHeader) return null;
  const sp = authHeader.indexOf(" ");
  const scheme = sp === -1 ? authHeader : authHeader.slice(0, sp);
  if (scheme.toLowerCase() !== "ntlm") return null;
  const blob = sp === -1 ? "" : authHeader.slice(sp + 1);
  if (!blob) return 0;
  const raw = Buffer.from(blob, "base64");
  if (raw.length < 12 || raw.toString("binary", 0, 8) !== "NTLMSSP\0") return null;
  return raw.readUInt32LE(8);
}

// A raw TCP proxy that runs the NTLM handshake before forwarding. `forward`
// handles the authenticated request (CONNECT tunnel vs absolute-form GET);
// the test inspects `conns` to assert every leg happened on one connection.
async function ntlmProxy(opts: { bodyLen?: number; forward: (sock: net.Socket, leg: Leg, rest: Buffer) => void }) {
  const bodyLen = opts.bodyLen ?? 0;
  const body = Buffer.alloc(bodyLen, "x");
  const conns: Leg[][] = [];

  const server = net.createServer(sock => {
    const legs: Leg[] = [];
    conns.push(legs);
    let buf = Buffer.alloc(0);
    let done = false;
    const onData = (chunk: Buffer) => {
      if (done) return;
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const eoh = buf.indexOf("\r\n\r\n");
        if (eoh < 0) return;
        const head = buf.subarray(0, eoh).toString("latin1");
        const rest = buf.subarray(eoh + 4);
        const leg = parseHead(head);
        legs.push(leg);

        const msgType = ntlmMessageType(leg.auth);
        if (msgType === 3) {
          done = true;
          sock.removeListener("data", onData);
          opts.forward(sock, leg, rest);
          return;
        }
        const challenge = msgType === 1 ? `NTLM ${ntlmType2().toString("base64")}` : `NTLM`;
        sock.write(
          `HTTP/1.1 407 Proxy Authentication Required\r\n` +
            `Proxy-Authenticate: ${challenge}\r\n` +
            `Proxy-Connection: Keep-Alive\r\n` +
            `Content-Length: ${bodyLen}\r\n\r\n`,
        );
        if (bodyLen > 0) sock.write(body);
        buf = Buffer.from(rest);
      }
    };
    sock.on("data", onData);
    sock.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    conns,
    [Symbol.dispose]() {
      server.close();
    },
  };
}

describe.skipIf(!isWindows)("proxy NTLM/Negotiate via SSPI", () => {
  test("CONNECT tunnel to https target", async () => {
    await using target = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: () => new Response("tunneled"),
    });

    using proxy = await ntlmProxy({
      forward(sock, leg, rest) {
        expect(leg.method).toBe("CONNECT");
        const [host, port] = leg.path.split(":");
        const upstream = net.connect(Number(port), host, () => {
          sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (rest.length) upstream.write(rest);
          sock.pipe(upstream);
          upstream.pipe(sock);
        });
        upstream.on("error", () => sock.end());
        sock.on("close", () => upstream.end());
      },
    });

    const res = await fetch(`https://localhost:${target.port}/hello`, {
      proxy: proxy.url,
      tls: { ca: tlsCert.cert },
    });
    expect(await res.text()).toBe("tunneled");
    expect(res.status).toBe(200);

    expect(proxy.conns.length).toBe(1);
    const legs = proxy.conns[0];
    expect(legs.map(l => [l.method, ntlmMessageType(l.auth)])).toEqual([
      ["CONNECT", null],
      ["CONNECT", 1],
      ["CONNECT", 3],
    ]);
  });

  test("absolute-form http target, 407 body drained before retry", async () => {
    await using target = Bun.serve({
      port: 0,
      fetch: req => new Response(`got ${new URL(req.url).pathname}`),
    });

    using proxy = await ntlmProxy({
      bodyLen: 1500,
      forward(sock, leg) {
        expect(leg.method).toBe("GET");
        const url = new URL(leg.path);
        const upstream = net.connect(Number(url.port), url.hostname, () => {
          upstream.write(`GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
          upstream.pipe(sock);
        });
        upstream.on("error", () => sock.end());
      },
    });

    const res = await fetch(`http://127.0.0.1:${target.port}/hello`, {
      proxy: proxy.url,
    });
    expect(await res.text()).toBe("got /hello");
    expect(res.status).toBe(200);

    expect(proxy.conns.length).toBe(1);
    const legs = proxy.conns[0];
    expect(legs.map(l => [l.method, ntlmMessageType(l.auth)])).toEqual([
      ["GET", null],
      ["GET", 1],
      ["GET", 3],
    ]);
  });

  test("bun install registry client through NTLM proxy", async () => {
    await using registry = Bun.serve({
      port: 0,
      fetch: req => {
        const p = new URL(req.url).pathname;
        if (p === "/proxy-sspi-pkg") {
          return Response.json({
            name: "proxy-sspi-pkg",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "proxy-sspi-pkg",
                version: "1.0.0",
                dist: { tarball: "http://127.0.0.1/x.tgz", shasum: "0".repeat(40) },
              },
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    using proxy = await ntlmProxy({
      forward(sock, leg) {
        const url = new URL(leg.path);
        const upstream = net.connect(Number(url.port), url.hostname, () => {
          upstream.write(`GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
          upstream.pipe(sock);
        });
        upstream.on("error", () => sock.end());
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "view", "proxy-sspi-pkg", "--registry", `http://127.0.0.1:${registry.port}/`],
      env: { ...bunEnv, HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("407");
    expect(stdout).toContain("proxy-sspi-pkg");
    expect(exitCode).toBe(0);

    expect(proxy.conns.length).toBeGreaterThan(0);
    expect(proxy.conns[0].map(l => ntlmMessageType(l.auth))).toEqual([null, 1, 3]);
  });
});

// On non-Windows there is no SSPI; the 407 must reach the caller unchanged.
test.skipIf(isWindows)("407 with Proxy-Authenticate: NTLM surfaces unchanged", async () => {
  const server = net.createServer(sock => {
    sock.once("data", () => {
      sock.end(
        "HTTP/1.1 407 Proxy Authentication Required\r\n" + "Proxy-Authenticate: NTLM\r\n" + "Content-Length: 0\r\n\r\n",
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch("http://example.invalid/", {
      proxy: `http://127.0.0.1:${port}`,
    });
    expect(res.status).toBe(407);
    expect(res.headers.get("proxy-authenticate")).toBe("NTLM");
  } finally {
    server.close();
  }
});
