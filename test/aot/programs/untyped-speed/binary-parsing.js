// Records written and read through DataView and Uint8Array: a checksum, variable-length integers, hexadecimal text, subarray, and a Buffer made from one.
function writeRecords(count) {
  const bytes = new Uint8Array(count * 12 + 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, count, true);
  let at = 4;
  for (let i = 0; i < count; i++) {
    bytes[at] = i & 3;
    bytes[at + 1] = (i * 7) & 255;
    view.setUint16(at + 2, (i * 31) & 65535, true);
    view.setInt32(at + 4, i * 1000 - 5000, true);
    view.setFloat32(at + 8, i / 4, true);
    at += 12;
  }
  return bytes;
}

function readVarint(bytes, state) {
  let value = 0;
  let shift = 0;
  let byte;
  do {
    byte = bytes[state.at++];
    value |= (byte & 127) << shift;
    shift += 7;
  } while (byte & 128);
  return value >>> 0;
}

function checksum(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function parse(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const out = [];
  for (let i = 0, at = 4; i < count; i++, at += 12) {
    out.push({ kind: bytes[at], flags: bytes[at + 1], port: view.getUint16(at + 2, true), offset: view.getInt32(at + 4, true), ratio: view.getFloat32(at + 8, true) });
  }
  return out;
}

function toHex(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return text;
}

function run(rounds) {
  const bytes = writeRecords(400);
  const varints = new Uint8Array([1, 172, 2, 255, 255, 3, 128, 128, 128, 8]);
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    for (const record of parse(bytes)) total += record.kind + record.flags + (record.port & 15) + (record.offset & 7) + record.ratio;
    total += checksum(bytes) & 1023;
    const state = { at: 0 };
    while (state.at < varints.length) total += readVarint(varints, state) & 255;
    total += toHex(bytes.subarray(0, 32)).length + Buffer.from(bytes.subarray(4, 16)).readUInt16LE(2);
  }
  return total;
}

console.log(run(3000));
