// Place source bytes immediately before an unmapped guard page so that an
// out-of-bounds read past the end of the input faults deterministically,
// independent of allocator layout or ASAN.
import { dlopen, ptr, toArrayBuffer } from "bun:ffi";

const libcPath =
  process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";
const MAP_ANON = process.platform === "darwin" ? 0x1000 : 0x20;
const MAP_PRIVATE = 0x02;
const PROT_READ = 1;
const PROT_WRITE = 2;
const PROT_NONE = 0;
const _SC_PAGESIZE = process.platform === "darwin" ? 29 : 30;

const libc = dlopen(libcPath, {
  sysconf: { args: ["i32"], returns: "i64" },
  mmap: { args: ["ptr", "usize", "i32", "i32", "i32", "i64"], returns: "ptr" },
  mprotect: { args: ["ptr", "usize", "i32"], returns: "i32" },
});

const PAGE = Number(libc.symbols.sysconf(_SC_PAGESIZE));
if (PAGE <= 0) throw new Error("sysconf(_SC_PAGESIZE) failed");

const base = libc.symbols.mmap(
  null,
  PAGE * 2,
  PROT_READ | PROT_WRITE,
  MAP_PRIVATE | MAP_ANON,
  -1,
  0n,
);
const baseNum = typeof base === "bigint" ? Number(base) : Number(base);
if (baseNum <= 0 || baseNum === -1) throw new Error("mmap failed");
if (libc.symbols.mprotect(baseNum + PAGE, PAGE, PROT_NONE) !== 0)
  throw new Error("mprotect failed");

function atGuard(bytes: number[]): Uint8Array {
  const ab = toArrayBuffer(baseNum, 0, PAGE);
  new Uint8Array(ab).fill(0x20);
  const off = PAGE - bytes.length;
  new Uint8Array(ab).set(bytes, off);
  return new Uint8Array(ab, off, bytes.length);
}

const tp = new Bun.Transpiler({ loader: "js" });

// Each case ends in a truncated multi-byte UTF-8 lead with no continuation
// bytes. Before the fix, CodepointIterator.next() read past the end of the
// buffer into the PROT_NONE page and crashed with SIGSEGV. After the fix,
// the truncated sequence is treated as U+FFFD and transformSync either
// returns or throws a normal parse error.
const cases: Array<[string, number[]]> = [
  ["1@ + 4-byte lead", [0x31, 0x40, 0xf0]],
  ["1@ + 3-byte lead", [0x31, 0x40, 0xe0]],
  ["1@ + 2-byte lead", [0x31, 0x40, 0xc2]],
  ["4-byte lead + 1 continuation", [0x31, 0x40, 0xf0, 0x90]],
  ["4-byte lead + 2 continuations", [0x31, 0x40, 0xf0, 0x90, 0x80]],
  [
    "sourceMappingURL pragma + 4-byte lead",
    [...Buffer.from("//# sourceMappingURL=a"), 0xf0],
  ],
];

for (const [name, bytes] of cases) {
  const src = atGuard(bytes);
  try {
    tp.transformSync(src);
    console.log(`ok: ${name} (addr=0x${ptr(src).toString(16)})`);
  } catch (e) {
    console.log(`ok: ${name} (threw: ${(e as Error).name})`);
  }
}

console.log("DONE");
