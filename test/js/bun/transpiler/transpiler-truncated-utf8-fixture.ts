// Place source bytes immediately before an unmapped guard page so that an
// out-of-bounds read past the end of the input faults deterministically,
// independent of allocator layout or ASAN.
import { dlopen, ptr, toArrayBuffer } from "bun:ffi";

const isDarwin = process.platform === "darwin";
// The test passes libcPathForDlopen() from the harness (which distinguishes
// glibc from musl via process.report). Probing /usr/lib/libc.so is unreliable
// because on non-multiarch glibc distros that path is an ld linker script,
// not an ELF, and dlopen() would reject it.
const libcPath = process.env.BUN_TEST_LIBC_PATH!;
if (!libcPath) throw new Error("BUN_TEST_LIBC_PATH not set");
const MAP_ANON = isDarwin ? 0x1000 : 0x20;
const MAP_PRIVATE = 0x02;
const PROT_READ = 1;
const PROT_WRITE = 2;
const PROT_NONE = 0;

const libc = dlopen(libcPath, {
  getpagesize: { args: [], returns: "i32" },
  mmap: { args: ["ptr", "usize", "i32", "i32", "i32", "i64"], returns: "ptr" },
  mprotect: { args: ["ptr", "usize", "i32"], returns: "i32" },
});

const PAGE = libc.symbols.getpagesize();
if (PAGE <= 0) throw new Error("getpagesize() failed");

const base = libc.symbols.mmap(null, PAGE * 2, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0n);
const baseNum = Number(base);
// MAP_FAILED = (void*)-1 marshals through bun:ffi's `ptr` return as
// (double)(uintptr_t)-1 ≈ 1.8e19, which is not a safe integer; valid
// user-space addresses always are.
if (base === null || !Number.isSafeInteger(baseNum)) throw new Error("mmap failed");
if (libc.symbols.mprotect(baseNum + PAGE, PAGE, PROT_NONE) !== 0) throw new Error("mprotect failed");

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
  ["sourceMappingURL pragma + 4-byte lead", [...Buffer.from("//# sourceMappingURL=a"), 0xf0]],
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
