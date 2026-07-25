// `destroy()` after the app committed AND ended a response (which, under
// `onwanttrailers`, records `trailers_pending` rather than `fin_pending`)
// must deliver it with a FIN, never retract it with a RESET_STREAM.
import { describe, expect, test } from "bun:test";
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
  const kSendRaw = Symbol.for("bun.internal.quic.sendRawHeaders");
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
    { name: "transfer-encoding", pairs: [...valid, "transfer-encoding", "chunked"] },
    { name: "connection", pairs: [...valid, "connection", "close"] },
    { name: "keep-alive", pairs: [...valid, "keep-alive", "timeout=5"] },
    { name: "upgrade", pairs: [...valid, "upgrade", "h2c"] },
    { name: "te not trailers", pairs: [...valid, "te", "gzip"] },
    { name: "missing :method", pairs: [":scheme", "https", ":authority", "localhost", ":path", "/"] },
    { name: "missing :path", pairs: [":method", "GET", ":scheme", "https", ":authority", "localhost"] },
    { name: "missing :scheme", pairs: [":method", "GET", ":authority", "localhost", ":path", "/"] },
    { name: ":protocol without CONNECT", pairs: [...valid, ":protocol", "websocket"] },
  ];

  const malformedResponses: Row[] = [
    { name: "missing :status", pairs: ["content-type", "text/plain"] },
    { name: "duplicate :status", pairs: [":status", "200", ":status", "404"] },
    { name: "non-numeric :status", pairs: [":status", "abc"] },
    { name: "request pseudo in response", pairs: [":status", "200", ":path", "/"] },
    { name: "uppercase field name", pairs: [":status", "200", "X-Upper", "v"] },
    { name: "transfer-encoding", pairs: [":status", "200", "transfer-encoding", "chunked"] },
    { name: "connection", pairs: [":status", "200", "connection", "close"] },
    { name: "pseudo after regular", pairs: ["x-ok", "v", ":status", "200"] },
  ];

  async function withH3({ onServerHeaders }: { onServerHeaders?: (this: any, h: any) => void }) {
    const seen: unknown[] = [];
    const server = await listen(
      async ss => {
        ss.onstream = (s: any) => s.closed.catch(() => {});
        await ss.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1 },
        onheaders:
          onServerHeaders ??
          function (this: any, h: any) {
            seen.push(h);
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
    return {
      server,
      client,
      seen,
      done: async () => {
        client.close();
        await server.close();
      },
    };
  }

  test.concurrent.each(malformedRequests)(
    "server rejects malformed request: $name",
    async ({ pairs }) => {
      const { client, seen, done } = await withH3({});
      const stream = await client.createBidirectionalStream();
      (stream as any)[kSendRaw](pairs, 1, 1);

      // The server resets the stream with H3_MESSAGE_ERROR; the client learns
      // it via the RESET_STREAM frame, which rejects `closed`.
      const err = await stream.closed.then(
        () => undefined,
        (e: any) => e,
      );
      await done();

      expect({ seen, code: err?.code, errorCode: err?.errorCode }).toEqual({
        seen: [],
        code: "ERR_QUIC_APPLICATION_ERROR",
        errorCode: H3_MESSAGE_ERROR,
      });
    },
  );

  test.concurrent.each(malformedResponses)(
    "client rejects malformed response: $name",
    async ({ pairs }) => {
      const clientSeen: unknown[] = [];
      const { client, done } = await withH3({
        onServerHeaders(this: any) {
          (this as any)[kSendRaw](pairs, 1, 1);
        },
      });
      const stream = await client.createBidirectionalStream({
        headers: { ":method": "GET", ":scheme": "https", ":authority": "localhost", ":path": "/" },
        onheaders(h: any) {
          clientSeen.push(h);
        },
      });
      const err = await stream.closed.then(
        () => undefined,
        (e: any) => e,
      );
      await done();

      expect({ clientSeen, code: err?.code, errorCode: err?.errorCode }).toEqual({
        clientSeen: [],
        code: "ERR_QUIC_APPLICATION_ERROR",
        errorCode: H3_MESSAGE_ERROR,
      });
    },
  );

  // Well-formed sections that live near a boundary must still be accepted.
  test.concurrent.each([
    { name: "te: trailers", pairs: [...valid, "te", "trailers"] },
    { name: "CONNECT without :scheme/:path", pairs: [":method", "CONNECT", ":authority", "localhost:443"] },
  ])("server accepts well-formed request: $name", async ({ pairs }) => {
    const { client, seen, done } = await withH3({});
    const stream = await client.createBidirectionalStream();
    (stream as any)[kSendRaw](pairs, 1, 1);
    await stream.closed.catch(() => {});
    const accepted = seen.length;
    await done();
    expect(accepted).toBe(1);
  });

  // These cases go through the public `sendHeaders` path (no raw hook), so
  // they demonstrate the gap is reachable from the documented API surface:
  // `buildNgHeaderString` does not enforce role-appropriate pseudo-headers or
  // the presence of the mandatory ones.
  test.concurrent("client rejects response missing :status (public sendHeaders)", async () => {
    const clientSeen: unknown[] = [];
    const { client, done } = await withH3({
      onServerHeaders(this: any) {
        this.sendHeaders({ "content-type": "text/plain" }, { terminal: true });
      },
    });
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":scheme": "https", ":authority": "localhost", ":path": "/" },
      onheaders: (h: any) => clientSeen.push(h),
    });
    const err = await stream.closed.then(
      () => undefined,
      (e: any) => e,
    );
    await done();
    expect({ clientSeen, code: err?.code, errorCode: err?.errorCode }).toEqual({
      clientSeen: [],
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_MESSAGE_ERROR,
    });
  });

  test.concurrent("client rejects response carrying :method (public sendHeaders)", async () => {
    const clientSeen: unknown[] = [];
    const { client, done } = await withH3({
      onServerHeaders(this: any) {
        this.sendHeaders({ ":status": "200", ":method": "GET" }, { terminal: true });
      },
    });
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":scheme": "https", ":authority": "localhost", ":path": "/" },
      onheaders: (h: any) => clientSeen.push(h),
    });
    const err = await stream.closed.then(
      () => undefined,
      (e: any) => e,
    );
    await done();
    expect({ clientSeen, code: err?.code, errorCode: err?.errorCode }).toEqual({
      clientSeen: [],
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_MESSAGE_ERROR,
    });
  });

  test.concurrent("server rejects request missing :scheme (public sendHeaders)", async () => {
    const { client, seen, done } = await withH3({});
    const stream = await client.createBidirectionalStream();
    stream.sendHeaders({ ":method": "GET", ":authority": "localhost", ":path": "/" }, { terminal: true });
    const err = await stream.closed.then(
      () => undefined,
      (e: any) => e,
    );
    await done();
    expect({ seen, code: err?.code, errorCode: err?.errorCode }).toEqual({
      seen: [],
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_MESSAGE_ERROR,
    });
  });

  test.concurrent("server rejects pseudo-header in trailers", async () => {
    let trailersSeen = 0;
    const { client, done } = await withH3({
      onServerHeaders(this: any) {
        this.ontrailers = () => trailersSeen++;
        this.sendHeaders({ ":status": "200" }, { terminal: true });
      },
    });
    const stream = await client.createBidirectionalStream();
    (stream as any)[kSendRaw](valid, 1, 0);
    (stream as any)[kSendRaw]([":path", "/t"], 2, 1);
    const err = await stream.closed.then(
      () => undefined,
      (e: any) => e,
    );
    await done();
    expect({ trailersSeen, code: err?.code, errorCode: err?.errorCode }).toEqual({
      trailersSeen: 0,
      code: "ERR_QUIC_APPLICATION_ERROR",
      errorCode: H3_MESSAGE_ERROR,
    });
  });
});
