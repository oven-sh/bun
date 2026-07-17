import { WASI } from "node:wasi";

// Byte-crafts a minimal wasi_snapshot_preview1 module that re-exports each
// import as f0, f1, ... plus a no-op _start and a 1-page memory.
function craft(imps) {
  const u = x => {
    const a = [];
    do {
      let c = x & 127;
      x >>>= 7;
      if (x) c |= 128;
      a.push(c);
    } while (x);
    return a;
  };
  const str = s => [...u(s.length), ...[...s].map(c => c.charCodeAt(0))];
  const sec = (id, b) => [id, ...u(b.length), ...b];
  const N = imps.length;
  const T = { i: 0x7f, j: 0x7e };
  const types = [
    ...u(N + 1),
    ...imps.flatMap(([, s]) => [0x60, s.length, ...[...s].map(c => T[c]), 1, 0x7f]),
    0x60,
    0,
    0,
  ];
  const imports = [...u(N), ...imps.flatMap(([n], k) => [...str("wasi_snapshot_preview1"), ...str(n), 0, k])];
  const funcs = [...u(N + 1), ...imps.map((_, k) => k), N];
  const exps = [
    ...u(N + 2),
    ...imps.flatMap((_, k) => [...str("f" + k), 0, N + k]),
    ...str("_start"),
    0,
    2 * N,
    ...str("memory"),
    2,
    0,
  ];
  const codes = imps.map(([, s], k) => {
    const c = [0, ...[...s].flatMap((_, j) => [0x20, j]), 0x10, k, 0x0b];
    return [...u(c.length), ...c];
  });
  const sb = [0, 0x0b];
  const code = [...u(N + 1), ...codes.flat(), ...u(sb.length), ...sb];
  return new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...sec(1, types),
    ...sec(2, imports),
    ...sec(3, funcs),
    ...sec(5, [1, 0, 1]),
    ...sec(7, exps),
    ...sec(10, code),
  ]);
}

const dir = process.argv[2];
const BYTES = craft([
  ["path_open", "iiiiijjii"],
  ["fd_pread", "iiiji"],
]);

const w = new WASI({ version: "preview1", preopens: { "/p": dir } });
const inst = new WebAssembly.Instance(new WebAssembly.Module(BYTES), { wasi_snapshot_preview1: w.wasiImport });
w.start(inst);

const mem = inst.exports.memory;
const view = new DataView(mem.buffer);

// path_open(preopen=3, dirflags=0, path="f.txt", oflags=0, fs_rights_base=fd_read|fd_seek, fs_rights_inheriting=0, fdflags=0, &fd)
new Uint8Array(mem.buffer, 1024, 5).set(new TextEncoder().encode("f.txt"));
inst.exports.f0(3, 0, 1024, 5, 0, 0x2000006n, 0n, 0, 2048);
const fd = view.getUint32(2048, true);

// Single iovec: read 6 bytes at offset 0 from an 8-byte file.
view.setUint32(0, 4096, true);
view.setUint32(4, 6, true);
let errno = inst.exports.f1(fd, 0, 1, 0n, 128);
let nread = view.getUint32(128, true);
let data = Buffer.from(mem.buffer, 4096, 6).toString();
console.log(JSON.stringify({ case: "single-iovec", errno, nread, data }));

// Two iovecs totalling 6 bytes at offset 0.
new Uint8Array(mem.buffer, 4096, 16).fill(0);
view.setUint32(0, 4096, true);
view.setUint32(4, 3, true);
view.setUint32(8, 4099, true);
view.setUint32(12, 3, true);
errno = inst.exports.f1(fd, 0, 2, 0n, 128);
nread = view.getUint32(128, true);
data = Buffer.from(mem.buffer, 4096, 3).toString() + Buffer.from(mem.buffer, 4099, 3).toString();
console.log(JSON.stringify({ case: "two-iovecs", errno, nread, data }));

// Single iovec larger than the file: read 16 bytes at offset 0 from an 8-byte file.
new Uint8Array(mem.buffer, 4096, 16).fill(0);
view.setUint32(0, 4096, true);
view.setUint32(4, 16, true);
errno = inst.exports.f1(fd, 0, 1, 0n, 128);
nread = view.getUint32(128, true);
data = Buffer.from(mem.buffer, 4096, nread).toString();
console.log(JSON.stringify({ case: "short-read", errno, nread, data }));
