import { createCipheriv, createHmac } from "node:crypto";

/**
 * Relays one QUIC connection to `serverPort`, and sends either side stream bytes that no HTTP/3 API would write.
 * `keylog` takes the key log lines of either side.
 */
export async function tamperingRelay(serverPort: number) {
  const secrets: Record<string, Buffer> = {};
  const cids: Record<string, Buffer> = {};
  const ports: Record<string, number> = { server: serverPort };
  let version = "";
  const socket = await Bun.udpSocket({
    hostname: "127.0.0.1",
    socket: {
      data(socket, packet, port) {
        const [from, to] = port === serverPort ? ["server", "client"] : ["client", "server"];
        ports[from] = port;
        if (packet[0] & 0x80) {
          version = packet[4] === 1 ? "quic" : "quicv2";
          const scid = 6 + packet[5];
          cids[from] = Buffer.from(packet.subarray(scid + 1, scid + 1 + packet[scid]));
        }
        socket.send(packet, ports[to], "127.0.0.1");
      },
    },
  });
  return {
    port: socket.port,
    keylog(line: string) {
      const [label, , secret] = String(line).trim().split(" ");
      secrets[label] = Buffer.from(secret, "hex");
    },
    /** `bytes` and a FIN on stream 0, in a 1-RTT packet sealed with TLS_AES_128_GCM_SHA256 (RFC 9001 section 5). */
    sendStream0(to: "client" | "server", bytes: Uint8Array) {
      const secret = secrets[to === "client" ? "SERVER_TRAFFIC_SECRET_0" : "CLIENT_TRAFFIC_SECRET_0"];
      const expand = (name: string, length: number, label = Buffer.from(`tls13 ${version} ${name}`)) =>
        createHmac("sha256", secret)
          .update(Buffer.from([0, length, label.length, ...label, 0, 1]))
          .digest()
          .subarray(0, length);
      // Past every packet number the real sender has used.
      const packetNumber = [0, 0, 4, 0];
      const header = Buffer.from([0x43, ...cids[to], ...packetNumber]);
      const nonce = expand("iv", 12);
      packetNumber.forEach((byte, i) => (nonce[8 + i] ^= byte));
      const aead = createCipheriv("aes-128-gcm", expand("key", 16), nonce).setAAD(header);
      const sealed = Buffer.concat([aead.update(Buffer.from([0x09, 0, ...bytes])), aead.final(), aead.getAuthTag()]);
      const mask = createCipheriv("aes-128-ecb", expand("hp", 16), null).update(sealed.subarray(0, 16));
      // Two lsquic peers negotiate loss bits, which leaves two more bits unprotected.
      header[0] ^= mask[0] & 0x07;
      for (let i = 0; i < 4; i++) header[header.length - 4 + i] ^= mask[1 + i];
      socket.send(Buffer.concat([header, sealed]), ports[to], "127.0.0.1");
    },
    [Symbol.dispose]: () => socket.close(),
  };
}

/** HTTP/3 frames. The field lines use QPACK's static table. */
export const frames = {
  post: [0x01, 16, 0, 0, 0xd4, 0xd7, 0xc1, 0x50, 9, ...Buffer.from("localhost")],
  status200: [0x01, 3, 0, 0, 0xd9],
  wholeData: [0x00, 3, ...Buffer.from("abc")],
  dataCutInItsPayload: [0x00, 10, ...Buffer.from("abc")],
  dataThenCutFrameHeader: [0x00, 3, ...Buffer.from("abc"), 0x00],
};
