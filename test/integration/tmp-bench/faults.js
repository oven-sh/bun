// Temporary: makes system calls of this process fail. `fail(name, result, lastError)` returns what undoes it.
const { dlopen, ptr, read, toArrayBuffer } = require("bun:ffi");
const k = dlopen("kernel32.dll", {
  GetModuleHandleW: { args: ["ptr"], returns: "ptr" },
  GetProcAddress: { args: ["ptr", "ptr"], returns: "ptr" },
  VirtualAlloc: { args: ["ptr", "u64", "u32", "u32"], returns: "ptr" },
  VirtualProtect: { args: ["ptr", "u64", "u32", "ptr"], returns: "i32" },
  FlushInstructionCache: { args: ["i64", "ptr", "u64"], returns: "i32" },
}).symbols;
const arm = process.arch === "arm64", base = k.GetModuleHandleW(null);
const text = at => { let s = ""; for (let c; (c = read.u8(at)); at++) s += String.fromCharCode(c); return s; };
const slots = new Map(), directories = base + read.u32(base, 0x3c) + 24 + 112;
for (const [index, size, names, table] of [[1, 20, 0, 16], [13, 32, 16, 12]])
  for (let d = base + read.u32(directories, index * 8); d > base && read.u32(d, table); d += size)
    for (let i = 0, entry; (entry = read.u64(base + read.u32(d, names), i * 8)); i++)
      if (!(entry >> 63n)) slots.set(text(base + Number(entry) + 2), base + read.u32(d, table) + i * 8);
const u32 = (...words) => Buffer.from(new Uint32Array(words).buffer), u64 = n => Buffer.from(new BigUint64Array([BigInt(n)]).buffer), bytes = (...b) => Buffer.from(b);
function returns(result, lastError) {
  if (arm) return u32(...(lastError ? [0x52800009 | (lastError << 5), 0xb9006a49] : []), ...(result === -1 ? [0x92800000] : [0x52800000 | ((result & 0xffff) << 5), 0x72a00000 | ((result >>> 16) << 5)]), 0xd65f03c0);
  return Buffer.concat([...(lastError ? [bytes(0x65, 0xc7, 0x04, 0x25, 0x68, 0, 0, 0), u32(lastError)] : []), result === -1 ? bytes(0x48, 0x83, 0xc8, 0xff) : Buffer.concat([bytes(0xb8), u32(result)]), bytes(0xc3)]);
}
function write(at, data) {
  const old = new Uint32Array(1), before = Buffer.from(toArrayBuffer(at, 0, data.length).slice(0));
  k.VirtualProtect(at, data.length, 0x40, old);
  new Uint8Array(toArrayBuffer(at, 0, data.length)).set(data);
  k.VirtualProtect(at, data.length, old[0], old), k.FlushInstructionCache(-1n, at, data.length);
  return () => void write(at, before);
}
function place(code) {
  const at = k.VirtualAlloc(null, 4096, 0x3000, 0x40);
  new Uint8Array(toArrayBuffer(at, 0, code.length)).set(code), k.FlushInstructionCache(-1n, at, code.length);
  return at;
}
function slot(name) {
  if (!slots.has(name)) throw new Error("not imported: " + name);
  return slots.get(name);
}
exports.fail = (name, result, lastError) => write(slot(name), u64(place(returns(result, lastError))));
// Only when the fifth argument has this value.
exports.failIfFifth = (name, value, result) => {
  const real = read.u64(slot(name)), refuse = returns(result);
  const code = arm
    ? Buffer.concat([u32(0x7100009f | (value << 10), 0x54000001 | ((refuse.length / 4 + 1) << 5)), refuse, u32(0x58000050, 0xd61f0200), u64(real)])
    : Buffer.concat([bytes(0x83, 0x7c, 0x24, 0x28, value, 0x75, refuse.length), refuse, bytes(0x48, 0xb8), u64(real), bytes(0xff, 0xe0)]);
  return write(slot(name), u64(place(code)));
};
exports.failTimes = (name, times, result, lastError) => {
  const real = read.u64(slot(name)), refuse = returns(result, lastError), n = refuse.length;
  const code = arm
    ? Buffer.concat([u32(0x10000009 | (((20 + n + 16) >> 2) << 5), 0xb940012a, 0x3400000a | ((3 + n / 4) << 5), 0x5100054a, 0xb900012a), refuse, u32(0x58000050, 0xd61f0200), u64(real), u32(times)])
    : Buffer.concat([bytes(0x83, 0x3d), u32(8 + n + 12), bytes(0, 0x7e, 6 + n, 0xff, 0x0d), u32(n + 12), refuse, bytes(0x48, 0xb8), u64(real), bytes(0xff, 0xe0), u32(times)]);
  return write(slot(name), u64(place(code)));
};
// For what is looked up with GetProcAddress.
exports.failInPlace = (module, name, result, lastError) => write(k.GetProcAddress(k.GetModuleHandleW(Buffer.from(module + "\0", "utf16le")), Buffer.from(name + "\0")), returns(result, lastError));
