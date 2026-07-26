// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { quicSendRawHeaders as kSendRaw } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

describe("QuicStream.destroy after the app ended the send side", () => {
  test("delivers the committed response instead of retracting it with RESET_STREAM", async () => {
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          // `onwanttrailers` throwing destroys this stream; its `closed`
          // rejects with that error. Swallow it -- the client is the subject.
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders(this: any) {
          this.sendHeaders({ ":status": "200" });
          this.writer.writeSync(new TextEncoder().encode("body"));
          this.writer.endSync();
        },
        onwanttrailers() {
          throw new Error("onwanttrailers error");
        },
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    });
    await client.opened;

    const gotHeaders = Promise.withResolvers<string>();
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders(headers: Record<string, string>) {
        gotHeaders.resolve(headers[":status"]);
      },
    });

    // Read the response body to completion. This must end with the server's
    // FIN; a RESET_STREAM here makes the iterator throw ERR_QUIC_STREAM_RESET.
    let readError: any;
    let chunks = 0;
    try {
      for await (const _ of stream) chunks++;
    } catch (e) {
      readError = e;
    }

    client.close();
    expect(readError).toBeUndefined();
    expect(chunks).toBeGreaterThan(0);
    expect(await gotHeaders.promise).toBe("200");
  });
});

// H3 header octets are latin1 on the wire (as node's StringBytes LATIN1 write
// does), not UTF-8. The send and receive halves must be exact inverses, or any
// header value >= U+0080 comes back mojibake ("é" -> "Ã©").
describe("HTTP/3 header encoding", () => {
  test("round-trips non-ASCII header values byte-for-byte", async () => {
    const VALUE = "café-ÿ";
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders(this: any, headers: Record<string, string>) {
          // Echo what the server decoded straight back to the client.
          this.sendHeaders({ ":status": "200", "x-echo": headers["x-name"] });
          this.writer.endSync();
        },
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    });
    await client.opened;

    const echoed = Promise.withResolvers<string>();
    await client.createBidirectionalStream({
      headers: {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": "localhost",
        "x-name": VALUE,
      },
      onheaders(headers: Record<string, string>) {
        echoed.resolve(headers["x-echo"]);
      },
    });

    expect(await echoed.promise).toBe(VALUE);
    client.close();
  });

  // U+0100 truncates to 0x00 under that same latin1 write, so a plain
  // `value.indexOf("\0")` guard never fires: the encoded value carries the
  // `name\0value\0flags` delimiters itself and splices an extra header out of
  // one user-supplied string. The declared pair count is what rejects it
  // (node/src/node_http_common-inl.h bails the same way on `n >= count_`).
  test("rejects a value whose latin1 encoding splices in an extra header", async () => {
    const seen: Record<string, string>[] = [];
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.closed.catch(() => {});
        };
        await serverSession.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders(this: any, headers: Record<string, string>) {
          seen.push(headers);
          this.sendHeaders({ ":status": "200" });
          this.writer.endSync();
        },
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
    });
    await client.opened;

    const attacker = await client.createBidirectionalStream();
    expect(
      attacker.sendHeaders({
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": "localhost",
        // Each Ā becomes a delimiter; the Z is eaten as the first field's
        // flags byte, aligning `authorization` onto a name boundary.
        "x-name": "safeĀZauthorizationĀBearer stolenĀ",
      }),
    ).toBe(false);

    // A benign request on the same connection proves the guard is narrow and
    // orders the assertion below: h3 delivers it after anything the attacker
    // stream managed to put on the wire.
    const answered = Promise.withResolvers<void>();
    await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
      onheaders() {
        answered.resolve();
      },
    });
    await answered.promise;
    client.close();

    expect(seen.length).toBe(1);
    expect(Object.keys(seen[0])).not.toContain("authorization");
  });
});

// RFC 9114 §4.1.2/§4.2/§4.3: a peer that sends a malformed field section MUST
// receive a stream error of type H3_MESSAGE_ERROR (0x10e). Bun's own client
// validates outbound headers in `buildNgHeaderString`, so the receive-side
// checks have to be exercised through a raw send hook that bypasses it.
describe("HTTP/3 inbound field-section validation (RFC 9114)", () => {
  const H3_MESSAGE_ERROR = 0x10en;

  const valid = [":method", "GET", ":scheme", "https", ":authority", "localhost", ":path", "/"];

  type Row = { name: string; pairs: string[] };
  // Each of these is a MUST-reject per §4.1.2/§4.2/§4.3.
  const malformedRequests: Row[] = [
    { name: "duplicate :path", pairs: [...valid, ":path", "/b"] },
    { name: "duplicate :method", pairs: [":method", "GET", ...valid] },
    { name: "unknown pseudo-header", pairs: [...valid, ":foo", "bar"] },
    { name: ":status in request", pairs: [...valid, ":status", "200"] },
    { name: "pseudo-header after regular", pairs: [...valid, "x-ok", "v", ":path", "/c"] },
    { name: "uppercase field name", pairs: [...valid, "X-Upper", "v"] },
    { name: "non-token field name", pairs: [...valid, "bad name", "v"] },
    { name: "CR in field value", pairs: [...valid, "x-crlf", "a\r\nb"] },
    { name: "C0 control in field value", pairs: [...valid, "x-ctl", "a\x01b"] },
    { name: "DEL in field value", pairs: [...valid, "x-ctl", "a\x7fb"] },
    { name: "leading SP in field value", pairs: [...valid, "x-ws", " v"] },
    { name: "trailing HTAB in field value", pairs: [...valid, "x-ws", "v\t"] },
    { name: "transfer-encoding", pairs: [...valid, "transfer-encoding", "chunked"] },
    { name: "connection", pairs: [...valid, "connection", "close"] },
    { name: "keep-alive", pairs: [...valid, "keep-alive", "timeout=5"] },
    { name: "upgrade", pairs: [...valid, "upgrade", "h2c"] },
    { name: "te not trailers", pairs: [...valid, "te", "gzip"] },
    { name: "missing :method", pairs: [":scheme", "https", ":authority", "localhost", ":path", "/"] },
    { name: "missing :path", pairs: [":method", "GET", ":scheme", "https", ":authority", "localhost"] },
    { name: "missing :scheme", pairs: [":method", "GET", ":authority", "localhost", ":path", "/"] },
    { name: "empty :path", pairs: [":method", "GET", ":scheme", "https", ":authority", "localhost", ":path", ""] },
    { name: ":protocol without CONNECT", pairs: [...valid, ":protocol", "websocket"] },
    { name: "CONNECT without :authority", pairs: [":method", "CONNECT"] },
    { name: "plain CONNECT with :path", pairs: [":method", "CONNECT", ":authority", "h", ":path", "/"] },
    { name: "no :authority and no Host", pairs: [":method", "GET", ":scheme", "https", ":path", "/"] },
    { name: "empty Host without :authority", pairs: [":method", "GET", ":scheme", "https", ":path", "/", "host", ""] },
    { name: "empty Host with :authority", pairs: [...valid, "host", ""] },
    { name: "non-numeric content-length", pairs: [...valid, "content-length", "abc"] },
    { name: "conflicting content-length", pairs: [...valid, "content-length", "5", "content-length", "100"] },
    { name: "content-length overflow", pairs: [...valid, "content-length", "99999999999999999999"] },
    { name: ":method with space", pairs: [":method", "GET POST", ":scheme", "https", ":authority", "h", ":path", "/"] },
    { name: ":scheme with space", pairs: [":method", "GET", ":scheme", "ht tp", ":authority", "h", ":path", "/"] },
  ];

  const malformedResponses: Row[] = [
    { name: "missing :status", pairs: ["content-type", "text/plain"] },
    { name: "duplicate :status", pairs: [":status", "200", ":status", "404"] },
    { name: "non-numeric :status", pairs: [":status", "abc"] },
    { name: ":status < 100", pairs: [":status", "050"] },
    { name: "request pseudo in response", pairs: [":status", "200", ":path", "/"] },
    { name: "uppercase field name", pairs: [":status", "200", "X-Upper", "v"] },
    { name: "transfer-encoding", pairs: [":status", "200", "transfer-encoding", "chunked"] },
    { name: "connection", pairs: [":status", "200", "connection", "close"] },
    { name: "pseudo after regular", pairs: ["x-ok", "v", ":status", "200"] },
  ];

  const publicBadResponses = [
    { name: "missing :status", headers: { "content-type": "text/plain" } },
    { name: ":method in response", headers: { ":status": "200", ":method": "GET" } },
  ];

  const wellFormedRequests: Row[] = [
    { name: "te: trailers", pairs: [...valid, "te", "trailers"] },
    { name: "te: Trailers (mixed case)", pairs: [...valid, "te", "Trailers"] },
    { name: "repeated content-length (same value)", pairs: [...valid, "content-length", "0", "content-length", "0"] },
    {
      name: "Host without :authority",
      pairs: [":method", "GET", ":scheme", "https", ":path", "/", "host", "localhost"],
    },
    { name: "CONNECT without :scheme/:path", pairs: [":method", "CONNECT", ":authority", "localhost:443"] },
    {
      name: "extended CONNECT",
      pairs: [":method", "CONNECT", ":protocol", "websocket", ":scheme", "https", ":authority", "h", ":path", "/"],
    },
  ];

  // One shared session: a fresh handshake per row is what made this flake under
  // concurrent load. The server dispatches on x-case so response-side rows can
  // pick their own malformed reply.
  const serverSeen: Record<string, unknown[]> = {};
  let server: any, client: any, serverSession: any;
  beforeAll(async () => {
    server = await listen(
      ss => {
        serverSession = ss;
        ss.closed.catch(() => {});
        ss.onstream = (s: any) => s.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 30 },
        onheaders(this: any, h: any) {
          this.closed.catch(() => {});
          const tag = h["x-case"];
          if (tag?.startsWith("resp/")) {
            (this as any)[kSendRaw](malformedResponses[+tag.slice(5)].pairs, 1, 1);
          } else if (tag?.startsWith("pub/")) {
            this.sendHeaders(publicBadResponses[+tag.slice(4)].headers, { terminal: true });
          } else {
            (serverSeen[tag ?? h[":path"]] ??= []).push(h);
            this.sendHeaders({ ":status": "200" }, { terminal: true });
          }
        },
      },
    );
    client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 30 },
    });
    client.closed.catch(() => {});
    await client.opened;
  });
  afterAll(() => {
    client?.close();
    serverSession?.close();
    server?.close().catch(() => {});
  });

  const closedErr = (s: any) =>
    s.closed.then(
      () => undefined,
      (e: any) => e,
    );

  test.concurrent.each(malformedRequests)("server rejects malformed request: $name", async ({ pairs }) => {
    const stream = await client.createBidirectionalStream();
    (stream as any)[kSendRaw](pairs, 1, 1);
    const err = await closedErr(stream);
    // The RESET_STREAM from the server is the observable proof: onheaders and
    // the reset path are mutually exclusive in on_stream_read.
    expect({ code: err?.code, errorCode: err?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_MESSAGE_ERROR,
    });
  });

  test.concurrent.each(malformedResponses.map((r, i) => ({ ...r, i })))(
    "client rejects malformed response: $name",
    async ({ i }) => {
      const clientSeen: unknown[] = [];
      const stream = await client.createBidirectionalStream({
        headers: { ":method": "GET", ":scheme": "https", ":authority": "h", ":path": "/", "x-case": `resp/${i}` },
        onheaders: (h: any) => clientSeen.push(h),
      });
      const err = await closedErr(stream);
      expect({ clientSeen, code: err?.code, errorCode: err?.errorCode }).toEqual({
        clientSeen: [],
        code: "ERR_QUIC_APPLICATION_ERROR",
        errorCode: H3_MESSAGE_ERROR,
      });
    },
  );

  test.concurrent.each(wellFormedRequests)("server accepts well-formed request: $name", async ({ name, pairs }) => {
    const stream = await client.createBidirectionalStream();
    (stream as any)[kSendRaw]([...pairs, "x-case", name], 1, 1);
    const err = await closedErr(stream);
    expect({ seen: serverSeen[name]?.length, err }).toEqual({ seen: 1, err: undefined });
  });

  // These reach the server through public `sendHeaders`, which does not enforce
  // role-appropriate or mandatory pseudo-headers: the gap was on the API surface.
  test.concurrent.each(publicBadResponses.map((r, i) => ({ ...r, i })))(
    "client rejects response via public sendHeaders: $name",
    async ({ i }) => {
      const clientSeen: unknown[] = [];
      const stream = await client.createBidirectionalStream({
        headers: { ":method": "GET", ":scheme": "https", ":authority": "h", ":path": "/", "x-case": `pub/${i}` },
        onheaders: (h: any) => clientSeen.push(h),
      });
      const err = await closedErr(stream);
      expect({ clientSeen, code: err?.code, errorCode: err?.errorCode }).toEqual({
        clientSeen: [],
        code: "ERR_QUIC_APPLICATION_ERROR",
        errorCode: H3_MESSAGE_ERROR,
      });
    },
  );

  test.concurrent("server rejects request missing :scheme (public sendHeaders)", async () => {
    const stream = await client.createBidirectionalStream();
    stream.sendHeaders({ ":method": "GET", ":authority": "localhost", ":path": "/" }, { terminal: true });
    const err = await closedErr(stream);
    expect({ code: err?.code, errorCode: err?.errorCode }).toEqual({
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_MESSAGE_ERROR,
    });
  });

  test.concurrent("server rejects pseudo-header in trailers", async () => {
    // Dedicated session: the assertion is on the server's stream lifetime,
    // which the shared session does not surface.
    const serverStreamDone = Promise.withResolvers<void>();
    const trailersSeen: unknown[] = [];
    await using server = await listen(
      async ss => {
        ss.onerror = () => {};
        ss.onstream = (s: any) => s.closed.then(serverStreamDone.resolve, serverStreamDone.resolve);
        await ss.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        onheaders(this: any) {
          this.ontrailers = (t: any) => trailersSeen.push(t);
        },
      },
    );
    const c = await connect(server.address, { servername: "localhost", verifyPeer: "manual" });
    c.onerror = () => {};
    await c.opened;
    try {
      const stream = await c.createBidirectionalStream();
      stream.closed.catch(() => {});
      (stream as any)[kSendRaw](valid, 1, 0);
      (stream as any)[kSendRaw]([":path", "/t"], 2, 1);
      await serverStreamDone.promise;
    } finally {
      c.close();
    }
    expect(trailersSeen).toEqual([]);
  });
});
