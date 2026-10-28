// A QUIC v1 client that stops after the first flight: it sends one Initial
// packet with a TLS 1.3 ClientHello split into out-of-order CRYPTO frames and
// reads the server's Initial reply. Initial packets are protected with keys
// that both sides derive from the destination connection id (RFC 9001 section
// 5.2), so no TLS state is needed to build or read them.
import { createCipheriv, createDecipheriv, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";

const INITIAL_SALT = Buffer.from("38762cf7f55934b34d179ae6a4c80cadccbb7f0a", "hex");

const FRAME_PING = 0x01;
const FRAME_ACK = 0x02;
const FRAME_ACK_ECN = 0x03;
const FRAME_CRYPTO = 0x06;
const FRAME_CONNECTION_CLOSE = 0x1c;
const FRAME_CONNECTION_CLOSE_APP = 0x1d;

interface Keys {
  key: Buffer;
  iv: Buffer;
  hp: Buffer;
}

function hkdfExpandLabel(prk: Buffer, label: string, len: number): Buffer {
  const full = Buffer.from("tls13 " + label);
  const info = Buffer.concat([Buffer.from([len >> 8, len & 0xff, full.length]), full, Buffer.from([0, 1])]);
  // len <= 32, so the first HMAC-SHA256 block is the whole output.
  return createHmac("sha256", prk).update(info).digest().subarray(0, len);
}

function initialKeys(dcid: Buffer, side: "client" | "server"): Keys {
  const initialSecret = createHmac("sha256", INITIAL_SALT).update(dcid).digest();
  const secret = hkdfExpandLabel(initialSecret, side + " in", 32);
  return {
    key: hkdfExpandLabel(secret, "quic key", 16),
    iv: hkdfExpandLabel(secret, "quic iv", 12),
    hp: hkdfExpandLabel(secret, "quic hp", 16),
  };
}

function varint(n: number): Buffer {
  if (n < 0x40) return Buffer.from([n]);
  if (n < 0x4000) return Buffer.from([0x40 | (n >> 8), n & 0xff]);
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  b[0] |= 0x80;
  return b;
}

function readVarint(b: Buffer, pos: { i: number }): number {
  const first = b[pos.i];
  const len = 1 << (first >> 6);
  let v = first & 0x3f;
  for (let k = 1; k < len; k++) v = v * 256 + b[pos.i + k];
  pos.i += len;
  return v;
}

function u16(n: number): Buffer {
  return Buffer.from([n >> 8, n & 0xff]);
}

function extension(type: number, body: Buffer): Buffer {
  return Buffer.concat([u16(type), u16(body.length), body]);
}

function transportParam(id: number, value: Buffer): Buffer {
  return Buffer.concat([varint(id), varint(value.length), value]);
}

/** A TLS 1.3 ClientHello handshake message with ALPN h3 and an x25519 key share. */
function clientHello(scid: Buffer, serverName: string): Buffer {
  const { publicKey } = generateKeyPairSync("x25519");
  const keyShare = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const host = Buffer.from(serverName);
  const signatureAlgorithms = [0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0806, 0x0601];
  const extensions = Buffer.concat([
    extension(0, Buffer.concat([u16(host.length + 3), Buffer.from([0]), u16(host.length), host])),
    extension(10, Buffer.concat([u16(4), u16(0x001d), u16(0x0017)])),
    extension(13, Buffer.concat([u16(signatureAlgorithms.length * 2), ...signatureAlgorithms.map(u16)])),
    extension(43, Buffer.concat([Buffer.from([2]), u16(0x0304)])),
    extension(45, Buffer.from([1, 1])),
    extension(51, Buffer.concat([u16(36), u16(0x001d), u16(32), keyShare])),
    extension(16, Buffer.concat([u16(3), Buffer.from([2]), Buffer.from("h3")])),
    extension(
      0x39,
      Buffer.concat([
        transportParam(0x0f, scid),
        transportParam(0x04, varint(1 << 20)),
        transportParam(0x05, varint(1 << 20)),
        transportParam(0x06, varint(1 << 20)),
        transportParam(0x07, varint(1 << 20)),
        transportParam(0x08, varint(100)),
        transportParam(0x09, varint(100)),
      ]),
    ),
  ]);
  const body = Buffer.concat([
    u16(0x0303),
    randomBytes(32),
    Buffer.from([0]),
    u16(6),
    u16(0x1301),
    u16(0x1302),
    u16(0x1303),
    Buffer.from([1, 0]),
    u16(extensions.length),
    extensions,
  ]);
  return Buffer.concat([Buffer.from([1, body.length >> 16, (body.length >> 8) & 0xff, body.length & 0xff]), body]);
}

/** Split `data` into `parts` CRYPTO frames. The frame at offset 0 goes last. */
function cryptoFrames(data: Buffer, parts: number): Buffer[] {
  const frames: Buffer[] = [];
  const size = Math.ceil(data.length / parts);
  for (let off = 0; off < data.length; off += size) {
    const chunk = data.subarray(off, Math.min(off + size, data.length));
    frames.push(Buffer.concat([Buffer.from([FRAME_CRYPTO]), varint(off), varint(chunk.length), chunk]));
  }
  frames.push(frames.shift()!);
  return frames;
}

function headerProtectionMask(hp: Buffer, sample: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", hp, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(sample), cipher.final()]);
}

/** One Initial packet with a one-byte packet number, padded to 1200 bytes. */
function initialPacket(dcid: Buffer, scid: Buffer, keys: Keys, pn: number, frames: Buffer[]): Buffer {
  let payload = Buffer.concat(frames);
  const headerLength = 1 + 4 + 1 + dcid.length + 1 + scid.length + 1 + 2 + 1;
  const padding = 1200 - headerLength - payload.length - 16;
  if (padding > 0) payload = Buffer.concat([payload, Buffer.alloc(padding)]);
  const length = 1 + payload.length + 16;
  const header = Buffer.concat([
    Buffer.from([0xc0, 0, 0, 0, 1, dcid.length]),
    dcid,
    Buffer.from([scid.length]),
    scid,
    Buffer.from([0, 0x40 | (length >> 8), length & 0xff, pn & 0xff]),
  ]);
  const nonce = Buffer.from(keys.iv);
  nonce[11] ^= pn & 0xff;
  const cipher = createCipheriv("aes-128-gcm", keys.key, nonce);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  const mask = headerProtectionMask(keys.hp, ciphertext.subarray(3, 19));
  header[0] ^= mask[0] & 0x0f;
  header[header.length - 1] ^= mask[1];
  return Buffer.concat([header, ciphertext]);
}

export interface Frame {
  type: number;
  errorCode?: number;
  reason?: string;
}

function parseFrames(payload: Buffer): Frame[] {
  const frames: Frame[] = [];
  const pos = { i: 0 };
  while (pos.i < payload.length) {
    const type = readVarint(payload, pos);
    switch (type) {
      case 0x00:
        break;
      case FRAME_PING:
        frames.push({ type });
        break;
      case FRAME_ACK:
      case FRAME_ACK_ECN: {
        readVarint(payload, pos);
        readVarint(payload, pos);
        const rangeCount = readVarint(payload, pos);
        readVarint(payload, pos);
        for (let k = 0; k < rangeCount; k++) {
          readVarint(payload, pos);
          readVarint(payload, pos);
        }
        if (type === FRAME_ACK_ECN) for (let k = 0; k < 3; k++) readVarint(payload, pos);
        frames.push({ type });
        break;
      }
      case FRAME_CRYPTO: {
        readVarint(payload, pos);
        pos.i += readVarint(payload, pos);
        frames.push({ type });
        break;
      }
      case FRAME_CONNECTION_CLOSE:
      case FRAME_CONNECTION_CLOSE_APP: {
        const errorCode = readVarint(payload, pos);
        if (type === FRAME_CONNECTION_CLOSE) readVarint(payload, pos);
        const len = readVarint(payload, pos);
        frames.push({ type, errorCode, reason: payload.subarray(pos.i, pos.i + len).toString() });
        pos.i += len;
        break;
      }
      default:
        throw new Error("unexpected frame type 0x" + type.toString(16));
    }
  }
  return frames;
}

/** The frames of every Initial packet in one datagram from the server. */
function initialFrames(datagram: Buffer, serverKeys: Keys): Frame[] {
  const frames: Frame[] = [];
  let i = 0;
  while (i < datagram.length) {
    if (!(datagram[i] & 0x80)) break; // a short header packet ends the datagram
    const type = (datagram[i] >> 4) & 3;
    if (datagram.readUInt32BE(i + 1) === 0 || type === 3) break; // version negotiation or Retry
    const pos = { i: i + 5 };
    pos.i += 1 + datagram[pos.i]; // dcid
    pos.i += 1 + datagram[pos.i]; // scid
    if (type === 0) {
      const tokenLength = readVarint(datagram, pos);
      pos.i += tokenLength;
    }
    const length = readVarint(datagram, pos);
    const pnOffset = pos.i;
    const end = pnOffset + length;
    if (type === 0) {
      const header = Buffer.from(datagram.subarray(i, pnOffset + 4));
      const mask = headerProtectionMask(serverKeys.hp, datagram.subarray(pnOffset + 4, pnOffset + 20));
      header[0] ^= mask[0] & 0x0f;
      const pnLength = (header[0] & 3) + 1;
      let pn = 0;
      for (let k = 0; k < pnLength; k++) {
        header[pnOffset - i + k] ^= mask[1 + k];
        pn = pn * 256 + header[pnOffset - i + k];
      }
      const nonce = Buffer.from(serverKeys.iv);
      for (let k = 0; k < 4; k++) nonce[8 + k] ^= (pn >>> (8 * (3 - k))) & 0xff;
      const body = datagram.subarray(pnOffset + pnLength, end);
      const decipher = createDecipheriv("aes-128-gcm", serverKeys.key, nonce);
      decipher.setAAD(header.subarray(0, pnOffset - i + pnLength));
      decipher.setAuthTag(body.subarray(body.length - 16));
      frames.push(
        ...parseFrames(Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()])),
      );
    }
    i = end;
  }
  return frames;
}

export type FirstFlightResult = { outcome: "crypto" } | { outcome: "close"; errorCode: number; reason: string };

/**
 * Send a ClientHello to the QUIC server on `port`, split into `parts` CRYPTO
 * frames with the frame at offset 0 last, so the server has to stash every
 * other frame. Resolves with what the server's Initial packets carry first: a
 * CRYPTO frame (the handshake goes on) or a CONNECTION_CLOSE.
 */
export async function firstFlight(port: number, parts: number, serverName = "localhost"): Promise<FirstFlightResult> {
  const dcid = randomBytes(8);
  const scid = randomBytes(8);
  const serverKeys = initialKeys(dcid, "server");
  const frames = cryptoFrames(clientHello(scid, serverName), parts);
  const { promise, resolve, reject } = Promise.withResolvers<FirstFlightResult>();
  const socket = await Bun.udpSocket({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(_socket, data) {
        try {
          for (const frame of initialFrames(Buffer.from(data), serverKeys)) {
            if (frame.type === FRAME_CONNECTION_CLOSE || frame.type === FRAME_CONNECTION_CLOSE_APP) {
              return resolve({ outcome: "close", errorCode: frame.errorCode!, reason: frame.reason! });
            }
            if (frame.type === FRAME_CRYPTO) return resolve({ outcome: "crypto" });
          }
        } catch (error) {
          reject(error);
        }
      },
    },
  });
  try {
    socket.send(initialPacket(dcid, scid, initialKeys(dcid, "client"), 0, frames), port, "127.0.0.1");
    return await promise;
  } finally {
    socket.close();
  }
}
