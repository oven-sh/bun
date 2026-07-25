// RFC 9114 sec 4.1.2: a malformed HTTP/3 message is a *stream* error
// (H3_MESSAGE_ERROR on RESET_STREAM + STOP_SENDING), not a CONNECTION_CLOSE.
// lsquic's stock behavior wires every such failure to `ci_abort_error`, so one
// bad request tore down every concurrent request on the same connection.
import { describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen } from "node:quic";

const keysDir = join(import.meta.dir, "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

// A well-formed concurrent request must still COMPLETE when a malformed request
// on the same connection is rejected: the connection has to survive the poison.
// The innocent stream's headers are sent first so its HEADERS frame is in
// lsquic's hands before the poison is parsed; whether the response body (and
// hence its FIN) arrives is the connection-survival signal.
async function blastRadius(
  poison: (client: any) => Promise<any>,
  describeBody?: (stream: any) => Promise<void>,
): Promise<{ completed: number; poisonedReset: unknown; sessionClose: unknown }> {
  let sessionClose: unknown = null;
  await using server = await listen(
    async (s: any) => {
      s.onstream = (st: any) => {
        st.closed.catch(() => {});
      };
      await s.closed.catch((e: unknown) => {
        sessionClose = e;
      });
    },
    {
      sni: { "*": { keys: [key], certs: [cert] } },
      transportParams: { maxIdleTimeout: 2 },
      onheaders(this: any, headers: Record<string, string>) {
        if (headers[":path"] === "/innocent") {
          this.sendHeaders({ ":status": "200" });
          // A non-empty body moves the FIN past the response HEADERS frame,
          // so a CONNECTION_CLOSE arriving after the poison is parsed (but
          // before the tick that would have flushed this FIN) aborts the
          // innocent iterator instead of letting it drain.
          this.writer.writeSync(new TextEncoder().encode("ok"));
          this.writer.endSync();
        } else if (describeBody) {
          void describeBody(this);
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

  const innocent = await client.createBidirectionalStream({
    headers: { ":method": "GET", ":path": "/innocent", ":scheme": "https", ":authority": "localhost" },
  });

  const poisoned = await poison(client);
  const poisonedReset = await poisoned.closed.then(
    () => null,
    (e: unknown) => e,
  );

  let completed = 0;
  try {
    for await (const _ of innocent) completed++;
  } catch {}

  client.close();
  return { completed, poisonedReset, sessionClose };
}

describe("HTTP/3 malformed message is a stream error, not a connection error", () => {
  // verify_cl_on_fin / verify_cl_on_new_data_frame in lsquic_stream.c call
  // ci_abort_error(HEC_MESSAGE_ERROR) when the DATA-frame byte count disagrees
  // with content-length, which the stock library converts to CONNECTION_CLOSE.
  test("request content-length mismatch resets that stream, innocent completes", async () => {
    const { completed, poisonedReset, sessionClose } = await blastRadius(async client =>
      client.createBidirectionalStream({
        headers: {
          ":method": "POST",
          ":path": "/poison",
          ":scheme": "https",
          ":authority": "localhost",
          "content-length": "1000",
        },
        // The three-byte body FINs the request at 3 bytes; the server's lsquic
        // detects the mismatch in verify_cl_on_fin() once it reads that FIN.
        body: new TextEncoder().encode("abc"),
      }),
    );
    // The innocent request must still deliver its body; before the fix, the
    // server's CONNECTION_CLOSE terminated the iterator with zero chunks.
    expect(completed).toBeGreaterThan(0);
    expect(sessionClose).toBeNull();
    // RFC 9114 sec 4.1.2: H3_MESSAGE_ERROR (0x10e) on the poisoned stream.
    expect((poisonedReset as any)?.errorCode).toBe(0x10en);
  });

  // verify_cl_on_new_data_frame fires while DATA is still arriving (no FIN
  // yet), so lsquic_stream_msg_error must queue STOP_SENDING and let the
  // peer's RESET_STREAM reply finish the stream instead of leaking it.  The
  // write side is left open (no endSync) so the server's lsquic sees the
  // oversize DATA frame before STREAM_FIN_RECVD can mask the pre-FIN branch.
  test("request body exceeding content-length resets that stream, innocent completes", async () => {
    const { completed, poisonedReset, sessionClose } = await blastRadius(async client => {
      const st = await client.createBidirectionalStream();
      st.sendHeaders(
        {
          ":method": "POST",
          ":path": "/poison",
          ":scheme": "https",
          ":authority": "localhost",
          "content-length": "3",
        },
        { terminal: false },
      );
      st.writer.writeSync(new TextEncoder().encode(Buffer.alloc(100, "a").toString()));
      return st;
    });
    expect(completed).toBeGreaterThan(0);
    expect(sessionClose).toBeNull();
    expect((poisonedReset as any)?.errorCode).toBe(0x10en);
  });

  test("response content-length mismatch resets that stream, innocent completes", async () => {
    const { completed, poisonedReset } = await blastRadius(
      client =>
        client.createBidirectionalStream({
          headers: { ":method": "GET", ":path": "/poison", ":scheme": "https", ":authority": "localhost" },
        }),
      async stream => {
        stream.sendHeaders({ ":status": "200", "content-length": "1000" });
        stream.writer.writeSync(new TextEncoder().encode("abc"));
        stream.writer.endSync();
      },
    );
    expect(completed).toBeGreaterThan(0);
    expect((poisonedReset as any)?.errorCode).toBe(0x10en);
  });
});
