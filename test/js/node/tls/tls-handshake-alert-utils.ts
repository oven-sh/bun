/**
 * Shared by the tests that check which TLS alert a client sends when its
 * handshake fails: node-tls-connect.test.ts, node-tls-namedpipes.test.ts,
 * proxy.test.ts and websocket-proxy.test.ts.
 */

import { once } from "node:events";
import net from "node:net";

export interface TLSRecord {
  type: number;
  /** The record body, as hex. */
  body: string;
}

/** The complete TLS records in `bytes`. */
export function tlsRecords(bytes: Buffer): TLSRecord[] {
  const records: TLSRecord[] = [];
  for (let rest = bytes; rest.length >= 5 && rest.length >= 5 + rest.readUInt16BE(3); ) {
    const end = 5 + rest.readUInt16BE(3);
    records.push({ type: rest[0], body: rest.subarray(5, end).toString("hex") });
    rest = rest.subarray(end);
  }
  return records;
}

/** What a TLS client sends after `startMalformedServerHelloServer` answered it: one alert record (21), level fatal (2), description decode_error (50). */
export const decodeErrorAlert: TLSRecord[] = [{ type: 21, body: "0232" }];

/**
 * Starts a server that answers the ClientHello of each connection with a
 * handshake record whose ServerHello has a one-byte body. Both BoringSSL and
 * OpenSSL clients fail the handshake on it with a fatal decode_error alert.
 *
 * `afterClientHello` resolves when the first connection closes, with the
 * records the client sent after its ClientHello. Listens on `path` (a named
 * pipe or a unix socket) when given, on a 127.0.0.1 port otherwise.
 */
export async function startMalformedServerHelloServer(path?: string) {
  const malformedServerHello = Buffer.from([0x16, 0x03, 0x03, 0x00, 0x05, 0x02, 0x00, 0x00, 0x01, 0x00]);
  const afterClientHello = Promise.withResolvers<TLSRecord[]>();
  const server = net.createServer(socket => {
    let received = Buffer.alloc(0);
    let answered = false;
    socket.on("data", chunk => {
      received = Buffer.concat([received, chunk]);
      if (!answered && tlsRecords(received).length > 0) {
        answered = true;
        socket.write(malformedServerHello);
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => afterClientHello.resolve(tlsRecords(received).slice(1)));
  });
  await once(path === undefined ? server.listen(0, "127.0.0.1") : server.listen(path), "listening");
  return {
    port: path === undefined ? (server.address() as net.AddressInfo).port : 0,
    afterClientHello: afterClientHello.promise,
    [Symbol.dispose]() {
      server.close();
    },
  };
}
