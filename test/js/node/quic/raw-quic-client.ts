// A QUIC v1 client (RFC 9000, RFC 9001, TLS 1.3 with TLS_AES_128_GCM_SHA256 and
// X25519) that does one thing node:quic's own client cannot: it puts raw bytes
// on a stream of an "h3" connection, and it chooses which datagram carries
// them. It does not validate the server's certificate, retransmit, or
// acknowledge anything.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { createSocket } from "node:dgram";

export interface RawQuicStream {
  /** 0, 4, 8... are client bidirectional streams. 2, 6, 10... are client unidirectional streams. */
  id: number;
  data: Uint8Array;
}

export interface RawQuicOptions {
  port: number;
  alpn: string;
  /** One STREAM frame each, in this order, in one 1-RTT packet. */
  streams: RawQuicStream[];
  /**
   * "with-finished": that packet shares a datagram with the client's Finished,
   * so the server reads the end of the handshake and the streams together.
   * "after-handshake-done": that packet leaves only once the server's
   * HANDSHAKE_DONE frame arrived, so the server reported the handshake before.
   */
  send: "with-finished" | "after-handshake-done";
}

export interface RawQuicClose {
  /** CONNECTION_CLOSE of type 0x1d (application error) rather than 0x1c. */
  application: boolean;
  code: number;
  reason: string;
}

type Space = "initial" | "handshake" | "application";
interface Keys {
  key: Buffer;
  iv: Buffer;
  hp: Buffer;
}

const empty = Buffer.alloc(0);
const bytes = (...values: number[]) => Buffer.from(values);
const u16 = (v: number) => bytes(v >> 8, v & 0xff);
const u24 = (v: number) => bytes(v >> 16, (v >> 8) & 0xff, v & 0xff);
const u32 = (v: number) => bytes(v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
const vec8 = (body: Uint8Array) => Buffer.concat([bytes(body.length), body]);
const vec16 = (body: Uint8Array) => Buffer.concat([u16(body.length), body]);

// RFC 9000 section 16.
function varint(v: number): Buffer {
  if (v < 0x40) return bytes(v);
  if (v < 0x4000) return u16(0x4000 | v);
  if (v < 0x40000000) return u32((0x80000000 | v) >>> 0);
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(0xc000000000000000n | BigInt(v));
  return out;
}

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}
  get remaining() {
    return this.buf.length - this.pos;
  }
  bytes(n: number) {
    if (n > this.remaining) throw new Error(`raw quic: wanted ${n} bytes, have ${this.remaining}`);
    return this.buf.subarray(this.pos, (this.pos += n));
  }
  uint(n: number) {
    let v = 0;
    for (const byte of this.bytes(n)) v = v * 256 + byte;
    return v;
  }
  varint() {
    const length = 1 << (this.bytes(1)[0] >> 6);
    this.pos -= 1;
    const raw = this.bytes(length);
    let v = BigInt(raw[0] & 0x3f);
    for (let i = 1; i < length; i++) v = (v << 8n) | BigInt(raw[i]);
    return Number(v);
  }
}

const sha256 = (...parts: Uint8Array[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};
const hmac = (key: Uint8Array, data: Uint8Array) => createHmac("sha256", key).update(data).digest();
const hkdfExtract = (salt: Uint8Array, ikm: Uint8Array) => hmac(salt, ikm);
// RFC 8446 section 7.1. Every output here is at most one SHA-256 block, so
// HKDF-Expand is its first iteration.
function hkdfExpandLabel(secret: Uint8Array, label: string, context: Uint8Array, length: number) {
  const info = Buffer.concat([u16(length), vec8(Buffer.from("tls13 " + label)), vec8(context), bytes(1)]);
  return hmac(secret, info).subarray(0, length);
}
// RFC 9001 section 5.1.
const packetKeys = (secret: Uint8Array): Keys => ({
  key: hkdfExpandLabel(secret, "quic key", empty, 16),
  iv: hkdfExpandLabel(secret, "quic iv", empty, 12),
  hp: hkdfExpandLabel(secret, "quic hp", empty, 16),
});

function headerProtectionMask(keys: Keys, sample: Uint8Array) {
  const cipher = createCipheriv("aes-128-ecb", keys.hp, null);
  cipher.setAutoPadding(false);
  return cipher.update(sample);
}
function nonce(keys: Keys, packetNumber: number) {
  const out = Buffer.from(keys.iv);
  for (let i = 0; i < 4; i++) out[11 - i] ^= (packetNumber >>> (8 * i)) & 0xff;
  return out;
}

/** `header` ends with a 4-byte packet number. */
function seal(keys: Keys, header: Buffer, packetNumber: number, payload: Uint8Array) {
  const cipher = createCipheriv("aes-128-gcm", keys.key, nonce(keys, packetNumber));
  cipher.setAAD(header);
  const packet = Buffer.concat([header, cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  const pnOffset = header.length - 4;
  const mask = headerProtectionMask(keys, packet.subarray(pnOffset + 4, pnOffset + 20));
  packet[0] ^= mask[0] & (packet[0] & 0x80 ? 0x0f : 0x1f);
  for (let i = 0; i < 4; i++) packet[pnOffset + i] ^= mask[1 + i];
  return packet;
}

// RFC 9000 appendix A.3.
function decodePacketNumber(largest: number, truncated: number, bits: number) {
  const expected = largest + 1;
  const window = 2 ** bits;
  const candidate = expected - (expected % window) + truncated;
  if (candidate <= expected - window / 2) return candidate + window;
  if (candidate > expected + window / 2 && candidate >= window) return candidate - window;
  return candidate;
}

function open(keys: Keys, packet: Uint8Array, pnOffset: number, largest: number) {
  if (packet.length < pnOffset + 20) return undefined;
  const mask = headerProtectionMask(keys, packet.subarray(pnOffset + 4, pnOffset + 20));
  const first = packet[0] ^ (mask[0] & (packet[0] & 0x80 ? 0x0f : 0x1f));
  const pnLength = (first & 3) + 1;
  const header = Buffer.from(packet.subarray(0, pnOffset + pnLength));
  header[0] = first;
  let truncated = 0;
  for (let i = 0; i < pnLength; i++) {
    header[pnOffset + i] ^= mask[1 + i];
    truncated = truncated * 256 + header[pnOffset + i];
  }
  const packetNumber = decodePacketNumber(largest, truncated, pnLength * 8);
  const decipher = createDecipheriv("aes-128-gcm", keys.key, nonce(keys, packetNumber));
  decipher.setAAD(header);
  decipher.setAuthTag(packet.subarray(packet.length - 16));
  try {
    const body = packet.subarray(pnOffset + pnLength, packet.length - 16);
    return { packetNumber, payload: Buffer.concat([decipher.update(body), decipher.final()]) };
  } catch {
    return undefined;
  }
}

interface FrameVisitor {
  crypto(offset: number, data: Uint8Array): void;
  close(close: RawQuicClose): void;
  handshakeDone(): void;
}

// RFC 9000 section 19. Only the three frames in FrameVisitor matter here, but
// a frame has no length of its own, so each type has to be stepped over.
function walkFrames(payload: Uint8Array, visitor: FrameVisitor) {
  const r = new Reader(payload);
  const skip = (count: number) => {
    for (let i = 0; i < count; i++) r.varint();
  };
  while (r.remaining > 0) {
    const type = r.varint();
    if (type === 0x00 || type === 0x01) {
      // PADDING, PING
    } else if (type === 0x02 || type === 0x03) {
      skip(2);
      const ranges = r.varint();
      skip(1 + 2 * ranges + (type === 0x03 ? 3 : 0));
    } else if (type === 0x04) {
      skip(3);
    } else if (type === 0x06) {
      const offset = r.varint();
      visitor.crypto(offset, r.bytes(r.varint()));
    } else if (type === 0x07) {
      r.bytes(r.varint());
    } else if (type >= 0x08 && type <= 0x0f) {
      skip(type & 0x04 ? 2 : 1);
      r.bytes(type & 0x02 ? r.varint() : r.remaining);
    } else if (type === 0x05 || type === 0x11 || type === 0x15) {
      skip(2);
    } else if ((type >= 0x10 && type <= 0x17) || type === 0x19) {
      skip(1);
    } else if (type === 0x18) {
      skip(2);
      r.bytes(r.uint(1) + 16);
    } else if (type === 0x1a || type === 0x1b) {
      r.bytes(8);
    } else if (type === 0x1c || type === 0x1d) {
      const code = r.varint();
      if (type === 0x1c) skip(1);
      const reason = Buffer.from(r.bytes(r.varint())).toString("latin1");
      visitor.close({ application: type === 0x1d, code, reason });
    } else if (type === 0x1e) {
      visitor.handshakeDone();
    } else if (type === 0x30 || type === 0x31) {
      r.bytes(type === 0x31 ? r.varint() : r.remaining);
    } else {
      throw new Error(`raw quic: frame type 0x${type.toString(16)} is not handled`);
    }
  }
}

/** Reassembles one encryption level's CRYPTO stream into TLS handshake messages. */
class CryptoStream {
  #received = Buffer.alloc(0);
  #consumed = 0;
  #ahead: [number, Uint8Array][] = [];

  push(offset: number, data: Uint8Array) {
    this.#ahead.push([offset, Buffer.from(data)]);
    for (let progressed = true; progressed; ) {
      progressed = false;
      for (const [at, chunk] of this.#ahead) {
        const have = this.#received.length;
        if (at <= have && at + chunk.length > have) {
          this.#received = Buffer.concat([this.#received, chunk.subarray(have - at)]);
          progressed = true;
        }
      }
    }
  }

  /** The next complete handshake message, with its 4-byte header. */
  next() {
    const pending = this.#received.subarray(this.#consumed);
    if (pending.length < 4) return undefined;
    const length = 4 + pending.readUIntBE(1, 3);
    if (pending.length < length) return undefined;
    this.#consumed += length;
    return pending.subarray(0, length);
  }
}

const tlsMessage = (type: number, body: Uint8Array) => Buffer.concat([bytes(type), u24(body.length), body]);
const tlsExtension = (type: number, body: Uint8Array) => Buffer.concat([u16(type), vec16(body)]);
const transportParameter = (id: number, value: Uint8Array) => Buffer.concat([varint(id), vec8(value)]);
// RFC 8410: the SubjectPublicKeyInfo of an X25519 key is this prefix and the 32 key bytes.
const x25519SpkiPrefix = Buffer.from("302a300506032b656e032100", "hex");
/** The `max_datagram_frame_size` transport parameter this client sends. */
export const maxDatagramFrameSize = 1000;

function clientHello(alpn: string, keyShare: Uint8Array, sourceConnectionId: Uint8Array) {
  const transportParameters = Buffer.concat([
    transportParameter(0x01, varint(30_000)), // max_idle_timeout, in milliseconds
    transportParameter(0x04, varint(1 << 20)), // initial_max_data
    transportParameter(0x05, varint(1 << 18)), // initial_max_stream_data_bidi_local
    transportParameter(0x06, varint(1 << 18)), // initial_max_stream_data_bidi_remote
    transportParameter(0x07, varint(1 << 18)), // initial_max_stream_data_uni
    transportParameter(0x08, varint(16)), // initial_max_streams_bidi
    transportParameter(0x09, varint(16)), // initial_max_streams_uni
    transportParameter(0x0f, sourceConnectionId), // initial_source_connection_id
    transportParameter(0x20, varint(maxDatagramFrameSize)), // max_datagram_frame_size (RFC 9221)
  ]);
  const extensions = Buffer.concat([
    tlsExtension(0x0000, vec16(Buffer.concat([bytes(0), vec16(Buffer.from("localhost"))]))), // server_name
    tlsExtension(0x000a, vec16(u16(0x001d))), // supported_groups: x25519
    // signature_algorithms: rsa_pss_rsae_sha256/384/512, ecdsa_secp256r1_sha256, ecdsa_secp384r1_sha384
    tlsExtension(0x000d, vec16(bytes(0x08, 0x04, 0x08, 0x05, 0x08, 0x06, 0x04, 0x03, 0x05, 0x03))),
    tlsExtension(0x0010, vec16(vec8(Buffer.from(alpn)))), // application_layer_protocol_negotiation
    tlsExtension(0x002b, vec8(u16(0x0304))), // supported_versions: TLS 1.3
    tlsExtension(0x0033, vec16(Buffer.concat([u16(0x001d), vec16(keyShare)]))), // key_share
    tlsExtension(0x0039, transportParameters), // quic_transport_parameters
  ]);
  return tlsMessage(
    1,
    Buffer.concat([
      u16(0x0303), // legacy_version
      randomBytes(32),
      vec8(empty), // legacy_session_id: RFC 9001 section 8.4 forbids the compatibility mode
      vec16(u16(0x1301)), // cipher_suites: TLS_AES_128_GCM_SHA256
      vec8(bytes(0)), // legacy_compression_methods
      vec16(extensions),
    ]),
  );
}

function serverKeyShare(serverHello: Uint8Array) {
  const r = new Reader(serverHello);
  r.bytes(4 + 2 + 32);
  r.bytes(r.uint(1));
  if (r.uint(2) !== 0x1301) throw new Error("raw quic: the server chose another cipher suite");
  r.bytes(1);
  const extensions = new Reader(r.bytes(r.uint(2)));
  while (extensions.remaining > 0) {
    const type = extensions.uint(2);
    const body = new Reader(extensions.bytes(extensions.uint(2)));
    if (type !== 0x0033) continue;
    if (body.uint(2) !== 0x001d) throw new Error("raw quic: the server chose another key share group");
    return body.bytes(body.uint(2));
  }
  throw new Error("raw quic: ServerHello has no key_share");
}

/**
 * Connects, sends `streams` as `send` says, and resolves with the
 * CONNECTION_CLOSE the server answers with.
 */
export async function rawQuicExchange({ port, alpn, streams, send }: RawQuicOptions): Promise<RawQuicClose> {
  const socket = createSocket("udp4");
  const closed = Promise.withResolvers<RawQuicClose>();
  socket.on("error", closed.reject);

  const sourceConnectionId = randomBytes(8);
  let destinationConnectionId: Uint8Array = randomBytes(8);

  // RFC 9001 section 5.2: both Initial secrets come from the client's first
  // Destination Connection ID.
  const initialSecret = hkdfExtract(
    Buffer.from("38762cf7f55934b34d179ae6a4c80cadccbb7f0a", "hex"),
    destinationConnectionId,
  );
  const sendKeys: Partial<Record<Space, Keys>> = {
    initial: packetKeys(hkdfExpandLabel(initialSecret, "client in", empty, 32)),
  };
  const receiveKeys: Partial<Record<Space, Keys>> = {
    initial: packetKeys(hkdfExpandLabel(initialSecret, "server in", empty, 32)),
  };
  const largestReceived: Record<Space, number> = { initial: -1, handshake: -1, application: -1 };
  const crypto = { initial: new CryptoStream(), handshake: new CryptoStream() };
  // Packets that arrived before the keys of their level.
  let undecrypted: [Space, Uint8Array, number][] = [];

  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const hello = clientHello(alpn, publicKey.export({ type: "spki", format: "der" }).subarray(-32), sourceConnectionId);
  const transcript: Uint8Array[] = [hello];
  let handshakeSecret: Buffer;
  let clientHandshakeSecret: Buffer;
  let streamsSent = false;

  const longHeaderPacket = (type: 0 | 2, keys: Keys, payload: Uint8Array) =>
    seal(
      keys,
      Buffer.concat([
        bytes(0xc3 | (type << 4)),
        u32(1), // QUIC version 1
        vec8(destinationConnectionId),
        vec8(sourceConnectionId),
        type === 0 ? bytes(0) : empty, // an Initial packet has a token length
        u16(0x4000 | (4 + payload.length + 16)),
        u32(0), // packet number: this client sends one packet per level
      ]),
      0,
      payload,
    );
  const cryptoFrame = (data: Uint8Array) => Buffer.concat([bytes(0x06, 0), varint(data.length), data]);
  const streamsPacket = () =>
    seal(
      sendKeys.application!,
      Buffer.concat([bytes(0x43), destinationConnectionId, u32(0)]),
      0,
      // STREAM frames with a length and no offset.
      Buffer.concat(streams.flatMap(({ id, data }) => [bytes(0x0a), varint(id), varint(data.length), data])),
    );
  const sendDatagram = (datagram: Uint8Array) => socket.send(datagram, port, "127.0.0.1");

  function onServerHello(serverHello: Uint8Array) {
    transcript.push(serverHello);
    const sharedSecret = diffieHellman({
      privateKey,
      publicKey: createPublicKey({
        key: Buffer.concat([x25519SpkiPrefix, serverKeyShare(serverHello)]),
        format: "der",
        type: "spki",
      }),
    });
    // RFC 8446 section 7.1, with no PSK.
    const zeros = Buffer.alloc(32);
    const earlySecret = hkdfExtract(zeros, zeros);
    handshakeSecret = hkdfExtract(hkdfExpandLabel(earlySecret, "derived", sha256(), 32), sharedSecret);
    const helloHash = sha256(...transcript);
    clientHandshakeSecret = hkdfExpandLabel(handshakeSecret, "c hs traffic", helloHash, 32);
    sendKeys.handshake = packetKeys(clientHandshakeSecret);
    receiveKeys.handshake = packetKeys(hkdfExpandLabel(handshakeSecret, "s hs traffic", helloHash, 32));
  }

  function onServerFinished() {
    const zeros = Buffer.alloc(32);
    const masterSecret = hkdfExtract(hkdfExpandLabel(handshakeSecret, "derived", sha256(), 32), zeros);
    const finishedHash = sha256(...transcript);
    sendKeys.application = packetKeys(hkdfExpandLabel(masterSecret, "c ap traffic", finishedHash, 32));
    receiveKeys.application = packetKeys(hkdfExpandLabel(masterSecret, "s ap traffic", finishedHash, 32));
    const verifyData = hmac(hkdfExpandLabel(clientHandshakeSecret, "finished", empty, 32), finishedHash);
    const finished = longHeaderPacket(2, sendKeys.handshake!, cryptoFrame(tlsMessage(20, verifyData)));
    if (send === "with-finished") {
      streamsSent = true;
      sendDatagram(Buffer.concat([finished, streamsPacket()]));
    } else {
      sendDatagram(finished);
    }
  }

  function onPacket(space: Space, packet: Uint8Array, pnOffset: number) {
    const keys = receiveKeys[space];
    if (!keys) {
      undecrypted.push([space, Buffer.from(packet), pnOffset]);
      return;
    }
    const opened = open(keys, packet, pnOffset, largestReceived[space]);
    if (!opened) return;
    largestReceived[space] = Math.max(largestReceived[space], opened.packetNumber);
    walkFrames(opened.payload, {
      crypto(offset, data) {
        if (space !== "application") crypto[space].push(offset, data);
      },
      close: closed.resolve,
      handshakeDone() {
        if (streamsSent) return;
        streamsSent = true;
        sendDatagram(streamsPacket());
      },
    });
    for (let message; (message = crypto.initial.next()); ) {
      if (message[0] !== 2) throw new Error(`raw quic: expected ServerHello, got TLS message ${message[0]}`);
      onServerHello(message);
    }
    for (let message; (message = crypto.handshake.next()); ) {
      transcript.push(message);
      if (message[0] === 20) onServerFinished();
    }
    const retry = undecrypted;
    undecrypted = [];
    for (const earlier of retry) onPacket(...earlier);
  }

  // RFC 9000 section 12.2: a datagram holds several packets. Every long header
  // packet has a length. A short header packet runs to the end of the datagram.
  function onDatagram(datagram: Uint8Array) {
    for (let start = 0; start < datagram.length; ) {
      const first = datagram[start];
      if ((first & 0x40) === 0) return; // not a QUIC v1 packet: padding
      if ((first & 0x80) === 0) {
        onPacket("application", datagram.subarray(start), 1 + sourceConnectionId.length);
        return;
      }
      const r = new Reader(datagram.subarray(start));
      const type = (r.uint(1) >> 4) & 3;
      if (type !== 0 && type !== 2) throw new Error(`raw quic: long header packet type ${type} is not handled`);
      r.bytes(4);
      r.bytes(r.uint(1));
      // Each later packet of this client goes to the connection ID the server chose.
      destinationConnectionId = Buffer.from(r.bytes(r.uint(1)));
      if (type === 0) r.bytes(r.varint());
      const length = r.varint();
      const pnOffset = r.pos;
      r.bytes(length);
      onPacket(type === 0 ? "initial" : "handshake", r.buf.subarray(0, r.pos), pnOffset);
      start += r.pos;
    }
  }

  socket.on("message", datagram => {
    try {
      onDatagram(datagram);
    } catch (error) {
      closed.reject(error);
    }
  });

  try {
    // RFC 9000 section 14.1: the datagram of a client's Initial is at least
    // 1200 bytes. PADDING frames (zeros) after the CRYPTO frame fill it.
    const frame = cryptoFrame(hello);
    const header = 1 + 4 + 1 + destinationConnectionId.length + 1 + sourceConnectionId.length + 1 + 2 + 4;
    const payload = Buffer.alloc(1200 - header - 16);
    frame.copy(payload);
    sendDatagram(longHeaderPacket(0, sendKeys.initial!, payload));
    return await closed.promise;
  } finally {
    socket.close();
  }
}
