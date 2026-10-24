// Buffers that the compiler follows from where they are made, beside plain Uint8Arrays, handed to the same functions: the members that Buffer.prototype has of its own (slice is a view there and a copy on a Uint8Array; toString, indexOf, includes, fill take texts) must be the Buffer's, whoever was seen first; own properties, another prototype and classes below change what is found.
function sliceOf(b: Uint8Array): number { const part = b.slice(1, 3); part[0] = 99; return b[1]!; }
function textOf(b: Uint8Array): string { return b.toString(); }
function whereIs(b: Uint8Array, x: any): number { return b.indexOf(x); }
function hasIt(b: Uint8Array, x: any): boolean { return b.includes(x); }
function filled(b: Uint8Array, x: any): string { return Array.from(b.fill(x)).join(); }
function sizes(b: Uint8Array): string { return [b.length, b.byteLength, b.byteOffset, b.buffer.byteLength > 0, b.BYTES_PER_ELEMENT].join(); }
function partOf(b: Uint8Array): string { const part = b.subarray(1, 3); return part.constructor.name + part.length; }
function mapped(b: Uint8Array): string { const m = b.map(v => v + 1); return m.constructor.name + Array.from(m).join(); }
function kind(b: Uint8Array): string { return [b instanceof Buffer, Buffer.isBuffer(b), b instanceof Uint8Array, ArrayBuffer.isView(b), Object.prototype.toString.call(b), b.constructor.name].join(); }
function reads(b: Buffer): number { return b.readUInt8(0) + b.readUInt16LE(1) + b.readInt32BE(0) + b.readDoubleLE(0) + Number(b.readBigUInt64LE(0) & 255n); }
function writes(b: Buffer): string { b.writeUInt8(1, 0); b.writeUInt16BE(515, 1); b.writeInt32LE(-2, 3); return b.toString("hex"); }
const made = { alloc: () => Buffer.alloc(8, 97), from: () => Buffer.from("abcdefgh"), unsafe: () => Buffer.allocUnsafe(8).fill(98), concat: () => Buffer.concat([Buffer.from("abcd"), Buffer.from("efgh")]), bytes: () => new Uint8Array([97, 98, 99, 100, 101, 102, 103, 104]), view: () => Buffer.from(new Uint8Array([97, 98, 99, 100, 101, 102, 103, 104]).buffer), sliced: () => Buffer.from("xabcdefghx").subarray(1, 9) };
class Below extends Uint8Array {} class BelowBuffer extends (Buffer as any) {}
const odd = { below: () => new Below(8).fill(97), own: () => Object.assign(Buffer.alloc(8, 97), { slice() { return new Uint8Array(4); }, extra: 1 }), ownLength: () => Object.defineProperty(Buffer.alloc(8, 97), "length", { value: 3 }), reparented: () => Object.setPrototypeOf(Buffer.alloc(8, 97), Uint8Array.prototype), bytesAsBuffer: () => Object.setPrototypeOf(new Uint8Array(8).fill(97), Buffer.prototype), bare: () => Object.setPrototypeOf(Buffer.alloc(8, 97), { __proto__: Buffer.prototype, toString() { return "mine"; } }) };
function attempt(run: () => unknown): string { try { return String(run()); } catch (e: any) { return e.constructor.name; } }
for (const group of [made, odd] as Record<string, () => any>[]) for (const name in group) {
  let line = "";
  for (let round = 0; round < 30; round++) { const m = group[name]!; line = [attempt(() => sliceOf(m())), attempt(() => textOf(m())), attempt(() => whereIs(m(), "c")), attempt(() => whereIs(m(), 99)), attempt(() => hasIt(m(), "de")), attempt(() => filled(m(), "z")), attempt(() => sizes(m())), attempt(() => partOf(m())), attempt(() => mapped(m())), attempt(() => kind(m())), attempt(() => reads(m())), attempt(() => writes(m()))].join(" | "); }
  console.log(name + ": " + line);
}
const kept: Buffer = Buffer.alloc(16, 1); const keptBytes = new Uint8Array(16).fill(1);
let sum = 0; for (let i = 0; i < 2000; i++) sum += kept.readUInt8(i & 15) + kept.slice(0, 2).length + keptBytes.slice(0, 2).length + kept.length + keptBytes.length;
console.log(sum, sliceOf(kept), sliceOf(keptBytes), kept[1], keptBytes[1]);
(kept as any).readUInt8 = () => 1000; console.log(kept.readUInt8(0)); delete (kept as any).readUInt8; console.log(kept.readUInt8(0));
