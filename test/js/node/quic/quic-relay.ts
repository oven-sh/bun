// A UDP relay between one QUIC client endpoint and one QUIC server on loopback.
// A test decides what happens to each datagram. It runs under Bun and Node.js.
import { createSocket, type Socket } from "node:dgram";
import { once } from "node:events";

export type Direction = "toServer" | "toClient";
export type Verdict =
  | "forward"
  | "drop"
  // Forward this datagram and every later one for the server from a second source port.
  | "rebind"
  // Send these to the server first, then forward the datagram.
  | { before: Buffer[] };

/**
 * A datagram with a QUIC v1 long header of `type` and a payload that no key decrypts.
 * `ids` are its destination and source connection IDs.
 */
export function undecryptable(
  type: "initial" | "0rtt" | "handshake",
  ids: { dcid: Buffer; scid?: Buffer },
  size = 1200,
): Buffer {
  const bits = { initial: 0, "0rtt": 1, handshake: 2 }[type];
  const scid = ids.scid ?? Buffer.alloc(0);
  const head = [0xc0 | (bits << 4), 0, 0, 0, 1, ids.dcid.length, ...ids.dcid, scid.length, ...scid];
  // Only an Initial has a token length.
  if (type === "initial") head.push(0);
  const rest = size - head.length - 2;
  // A 2-byte varint: the packet fills the datagram.
  head.push(0x40 | (rest >> 8), rest & 0xff);
  return Buffer.concat([Buffer.from(head), Buffer.alloc(rest, 0x5a)], size);
}

/** The destination and source connection IDs of a long-header datagram. */
export function connectionIds(datagram: Buffer): { dcid: Buffer; scid: Buffer } {
  const scidAt = 6 + datagram[5];
  return {
    dcid: datagram.subarray(6, scidAt),
    scid: datagram.subarray(scidAt + 1, scidAt + 1 + datagram[scidAt]),
  };
}

async function bound(): Promise<Socket> {
  const socket = createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  return socket;
}

export async function startRelay(
  serverPort: number,
  decide: (direction: Direction, nth: number, datagram: Buffer) => Verdict,
) {
  // Clients dial `front`. The server sees `upstream`, then `rebound` after a "rebind".
  const [front, upstream, rebound] = await Promise.all([bound(), bound(), bound()]);
  const count = { toServer: 0, toClient: 0 };
  let client: { address: string; port: number } | undefined;
  let source = upstream;
  let open = true;
  const toServer = (datagram: Buffer) => {
    if (open) source.send(datagram, serverPort, "127.0.0.1");
  };

  front.on("message", (datagram, from) => {
    client = from;
    const verdict = decide("toServer", ++count.toServer, datagram);
    if (verdict === "drop") return;
    if (verdict === "rebind") source = rebound;
    if (typeof verdict === "object") verdict.before.forEach(toServer);
    toServer(datagram);
  });
  const fromServer = (datagram: Buffer) => {
    if (decide("toClient", ++count.toClient, datagram) === "drop" || !client || !open) return;
    front.send(datagram, client.port, client.address);
  };
  upstream.on("message", fromServer);
  rebound.on("message", fromServer);

  return {
    /** What a client dials. */
    address: `127.0.0.1:${front.address().port}`,
    /** Stops the relay. A datagram for a closed port comes back as a socket error, so it sends no more. */
    async [Symbol.asyncDispose]() {
      open = false;
      for (const socket of [front, upstream, rebound]) {
        socket.close();
        await once(socket, "close");
      }
    },
  };
}
