import { createHash, randomBytes } from "node:crypto";

// RFC 6455 magic GUID
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function makeKey() {
  return randomBytes(16).toString("base64");
}

function acceptFor(key) {
  return createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
}

export function encodeCloseFrame(code = 1000, reason = "") {
  const reasonBuf = Buffer.from(reason, "utf8");
  const payloadLen = 2 + reasonBuf.length; // 2 bytes for code + reason
  const header = [];
  let headerLen = 2;
  if (payloadLen < 126) {
    // masked bit (0x80) + length
    header.push(0x88, 0x80 | payloadLen);
  } else if (payloadLen <= 0xffff) {
    headerLen += 2;
    header.push(0x88, 0x80 | 126, payloadLen >> 8, payloadLen & 0xff);
  } else {
    throw new Error("Close reason too long");
  }

  const mask = randomBytes(4);
  const buf = Buffer.alloc(headerLen + 4 + payloadLen);
  Buffer.from(header).copy(buf, 0);
  mask.copy(buf, headerLen);

  // write code + reason
  const unmasked = Buffer.alloc(payloadLen);
  unmasked.writeUInt16BE(code, 0);
  reasonBuf.copy(unmasked, 2);

  // apply mask
  for (let i = 0; i < payloadLen; i++) {
    buf[headerLen + 4 + i] = unmasked[i] ^ mask[i & 3];
  }

  return buf;
}
export function* decodeFrames(buffer) {
  let i = 0;
  while (i + 2 <= buffer.length) {
    const b0 = buffer[i++];
    const b1 = buffer[i++];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;

    if (len === 126) {
      if (i + 2 > buffer.length) break;
      len = buffer.readUInt16BE(i);
      i += 2;
    } else if (len === 127) {
      if (i + 8 > buffer.length) break;
      const big = buffer.readBigUInt64BE(i);
      i += 8;
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame too large");
      len = Number(big);
    }

    let mask;
    if (masked) {
      if (i + 4 > buffer.length) break;
      mask = buffer.subarray(i, i + 4);
      i += 4;
    }

    if (i + len > buffer.length) break;
    let payload = buffer.subarray(i, i + len);
    i += len;

    if (masked && mask) {
      const unmasked = Buffer.alloc(len);
      for (let j = 0; j < len; j++) unmasked[j] = payload[j] ^ mask[j & 3];
      payload = unmasked;
    }

    if (!fin) throw new Error("fragmentation not supported in this demo");
    if (opcode === 0x1) {
      // text
      yield payload.toString("utf8");
    } else if (opcode === 0x8) {
      // CLOSE
      yield { type: "close" };
      return;
    } else if (opcode === 0x9) {
      // PING -> respond with PONG if you implement writes here
      yield { type: "ping", data: payload };
    } else if (opcode === 0xa) {
      // PONG
      yield { type: "pong", data: payload };
    } else {
      // ignore other opcodes for brevity
    }
  }
}

// Encode a single unfragmented TEXT frame (client -> server must be masked)
export function encodeTextFrame(str) {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;

  let headerLen = 2;
  if (len >= 126 && len <= 0xffff) headerLen += 2;
  else if (len > 0xffff) headerLen += 8;
  const maskKeyLen = 4;

  const buf = Buffer.alloc(headerLen + maskKeyLen + len);
  // FIN=1, RSV=0, opcode=0x1 (text)
  buf[0] = 0x80 | 0x1;

  // Set masked bit and length field(s)
  let offset = 1;
  if (len < 126) {
    buf[offset++] = 0x80 | len; // mask bit + length
  } else if (len <= 0xffff) {
    buf[offset++] = 0x80 | 126;
    buf.writeUInt16BE(len, offset);
    offset += 2;
  } else {
    buf[offset++] = 0x80 | 127;
    buf.writeBigUInt64BE(BigInt(len), offset);
    offset += 8;
  }

  // Mask key
  const mask = randomBytes(4);
  mask.copy(buf, offset);
  offset += 4;

  // Mask the payload
  for (let i = 0; i < len; i++) {
    buf[offset + i] = payload[i] ^ mask[i & 3];
  }

  return buf;
}

export function upgradeHeaders() {
  const secWebSocketKey = makeKey();
  return {
    "Connection": "Upgrade",
    "Upgrade": "websocket",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": secWebSocketKey,
  };
}
