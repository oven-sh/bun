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

// RFC 9114 s4.1.2: a malformed HTTP/3 message MUST be a *stream* error
// (H3_MESSAGE_ERROR, 0x10e). lsquic's content-length verifier used to call
// ci_abort_error on the whole connection instead, so one malformed request
// tore down every concurrent stream and surfaced on the server session's
// `closed` as ERR_QUIC_TRANSPORT_ERROR code 1.
describe("HTTP/3 malformed request (content-length mismatch)", () => {
  test("resets only the offending stream; sibling streams and the session survive", async () => {
    const resets: bigint[] = [];
    const serverClosed = Promise.withResolvers<any>();
    const sawReset = Promise.withResolvers<void>();
    await using server = await listen(
      async serverSession => {
        serverSession.onstream = (stream: any) => {
          stream.onreset = (err: any) => {
            resets.push(typeof err?.code === "bigint" ? err.code : -1n);
            sawReset.resolve();
          };
          stream.closed.catch(() => {});
        };
        await serverSession.closed.then(
          () => serverClosed.resolve(null),
          (e: any) => serverClosed.resolve(e),
        );
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 2 },
        onheaders(this: any, headers: Record<string, string>) {
          if (headers[":path"] === "/good") {
            this.sendHeaders({ ":status": "200" });
            this.writer.writeSync("ok");
            this.writer.endSync();
          }
        },
      },
    );

    const client = await connect(server.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 2 },
    });
    await client.opened;
    client.closed.catch(() => {});

    // content-length says 1000, body ends at 3 bytes.
    const short = await client.createBidirectionalStream({
      headers: {
        ":method": "POST",
        ":path": "/short",
        ":scheme": "https",
        ":authority": "localhost",
        "content-length": "1000",
      },
      body: new TextEncoder().encode("abc"),
    });
    short.closed.catch(() => {});

    // content-length says 3, body is 1000 bytes.
    const over = await client.createBidirectionalStream({
      headers: {
        ":method": "POST",
        ":path": "/over",
        ":scheme": "https",
        ":authority": "localhost",
        "content-length": "3",
      },
      body: new Uint8Array(Buffer.alloc(1000, "x")),
    });
    over.closed.catch(() => {});

    // A sibling request on the SAME connection, AFTER the malformed ones,
    // proves the connection survived.
    const goodAnswered = Promise.withResolvers<string>();
    const good = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": "/good", ":scheme": "https", ":authority": "localhost" },
      onheaders(h: Record<string, string>) {
        goodAnswered.resolve(h[":status"]);
      },
    });
    good.closed.catch(() => {});

    // Before: the malformed request triggers CONNECTION_CLOSE, so the server
    // session errors and the sibling request never sees a response.
    const status = await Promise.race([goodAnswered.promise, serverClosed.promise.then(e => e ?? "closed")]);
    expect(status).toBe("200");

    // Server surfaces the rejection as stream.onreset with H3_MESSAGE_ERROR.
    await sawReset.promise;
    expect(resets.every(c => c === 0x10en)).toBe(true);
    expect(resets.length).toBeGreaterThanOrEqual(1);

    client.close();
    expect(await serverClosed.promise).toBe(null);
  });
});
