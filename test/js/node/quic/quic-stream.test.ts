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

// A 0-RTT H3 request the server rejects must not reach it at 1-RTT, and
// must not crash the client decoding a response on the destroyed stream.
// lsquic's transparent stash-and-retransmit would deliver the request after
// node:quic already tore the stream down; the server's HEADERS then hit
// lsquic_qdh_header_in_begin's `!STREAM_U_READ_DONE` assert.
describe("0-RTT rejected on HTTP/3", () => {
  const H = (path: string) => ({ ":method": "GET", ":path": path, ":scheme": "https", ":authority": "localhost" });

  const makeServer = async (paths: string[], tp: Record<string, number> = {}) => {
    const ready = Promise.withResolvers<void>();
    const ep = await listen(
      async s => {
        s.onstream = (st: any) => st.closed.catch(() => {});
        await s.closed.catch(() => {});
      },
      {
        sni: { "*": { keys: [key], certs: [cert] } },
        transportParams: { maxIdleTimeout: 1, ...tp },
        onheaders(this: any, headers: Record<string, string>) {
          paths.push(headers[":path"]);
          this.sendHeaders({ ":status": "200" });
          this.writer.endSync();
          ready.resolve();
        },
      },
    );
    return { ep, ready, [Symbol.asyncDispose]: () => ep.close() };
  };

  async function getTicket(tp: Record<string, number> = {}) {
    const gotTicket = Promise.withResolvers<Buffer>();
    let token: Buffer | undefined;
    await using a = await makeServer([], tp);
    const ca = await connect(a.ep.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
      onsessionticket: (t: Buffer) => gotTicket.resolve(t),
      onnewtoken: (t: Buffer) => (token = t),
    });
    await ca.opened;
    const answered = Promise.withResolvers<void>();
    await ca.createBidirectionalStream({ headers: H("/warm"), onheaders: () => answered.resolve() });
    await answered.promise;
    const ticket = await gotTicket.promise;
    ca.close();
    return { ticket, token };
  }

  test("a rejected early request is elided, not retransmitted at 1-RTT", async () => {
    const { ticket, token } = await getTicket();

    // Fresh server B: A's ticket keys are gone, so 0-RTT is rejected.
    const paths: string[] = [];
    await using b = await makeServer(paths);
    const c = await connect(b.ep.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
      sessionTicket: ticket,
      token,
    });
    c.closed.catch(() => {});

    // The 0-RTT request: opened before the handshake is known rejected.
    const early = await c.createBidirectionalStream({ headers: H("/early"), onheaders() {} });
    const earlyClose = early.closed.catch((e: any) => e);

    const info = await c.opened;
    expect(info.earlyDataAttempted).toBe(true);
    expect(info.earlyDataAccepted).toBe(false);

    const err = await earlyClose;
    expect(err?.code).toBe("ERR_QUIC_APPLICATION_ERROR");

    // The documented re-open: this is the one request the server must see.
    const retried = Promise.withResolvers<string>();
    await c.createBidirectionalStream({
      headers: H("/retry"),
      onheaders: (h: Record<string, string>) => retried.resolve(h[":status"]),
    });
    expect(await retried.promise).toBe("200");

    // /retry reached the server; any retransmitted /early headers that were
    // going to arrive have arrived by now (same path, lower stream id).
    await b.ready.promise;
    expect(paths).toEqual(["/retry"]);
    c.close();
  });

  // The second 0-RTT request exceeds the cached initial_max_streams_bidi
  // budget, so lsquic defers creating it; the wrapper has raw==null and
  // its headers sit in pending_headers when the rejection fires. bind_raw
  // must propagate the cancel instead of sending the queued request when
  // handshake_ok creates the delayed stream.
  test("a delayed early request past the cached stream limit is also cancelled", async () => {
    const { ticket, token } = await getTicket({ initialMaxStreamsBidi: 1 });

    const paths: string[] = [];
    await using b = await makeServer(paths, { initialMaxStreamsBidi: 4 });
    const c = await connect(b.ep.address, {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 1 },
      sessionTicket: ticket,
      token,
    });
    c.closed.catch(() => {});

    const a = await c.createBidirectionalStream({ headers: H("/a"), onheaders() {} });
    const d = await c.createBidirectionalStream({ headers: H("/delayed"), onheaders() {} });
    const [aErr, dErr] = await Promise.all([a.closed.catch((e: any) => e), d.closed.catch((e: any) => e)]);

    const info = await c.opened;
    expect(info.earlyDataAccepted).toBe(false);
    expect(aErr?.code).toBe("ERR_QUIC_APPLICATION_ERROR");
    expect(dErr?.code).toBe("ERR_QUIC_APPLICATION_ERROR");

    const retried = Promise.withResolvers<string>();
    await c.createBidirectionalStream({
      headers: H("/retry"),
      onheaders: (h: Record<string, string>) => retried.resolve(h[":status"]),
    });
    expect(await retried.promise).toBe("200");
    await b.ready.promise;
    expect(paths).toEqual(["/retry"]);
    c.close();
  });
});
