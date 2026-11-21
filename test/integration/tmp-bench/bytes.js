// Usage: bun bytes.js   The code around an address.
const b = require("fs").readFileSync(process.env.PROFILE_EXE), pe = b.readUInt32LE(0x3c), first = pe + 24 + b.readUInt16LE(pe + 20);
for (let i = 0; i < b.readUInt16LE(pe + 6); i++) {
  const at = first + i * 40, [size, rva, raw] = [b.readUInt32LE(at + 8), b.readUInt32LE(at + 12), b.readUInt32LE(at + 20)];
  for (let it = 0x7c55000; process.arch === "x64" && it < 0x7c56400; it += 64) if (it >= rva && it < rva + size) console.log(it === 0x7c55000 ? "cond hot" : "cond", it.toString(16), b.toString("hex", it - rva + raw, it - rva + raw + 64));
}
