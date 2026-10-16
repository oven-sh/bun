// Simulates an antivirus / search-indexer process scanning files that
// `bun install` has just written. On NTFS, an open handle that lacks
// FILE_SHARE_DELETE on any file inside a directory makes a rename of that
// directory fail with STATUS_ACCESS_DENIED.
//
// argv: <watchDir> <subdirFilter> <holdMs>
//
// Spin-polls watchDir until a subdirectory whose name contains subdirFilter
// ("" matches any) contains a regular file, opens that file via CreateFileW
// with dwShareMode = FILE_SHARE_READ | FILE_SHARE_WRITE (no DELETE), prints
// "HELD <path>", keeps the handle open for holdMs, closes it, prints
// "RELEASED" and exits 0. Prints "MISSED" and exits 0 if nothing shows up
// within 15s.

import { dlopen, FFIType, ptr } from "bun:ffi";
import { readdirSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32") {
  console.log("MISSED");
  process.exit(0);
}

const [, , watchDir, subdirFilter, holdMsStr] = process.argv;
const holdMs = Number(holdMsStr);

const { symbols } = dlopen("kernel32.dll", {
  CreateFileW: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
    returns: FFIType.u64,
  },
  CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
});

const GENERIC_READ = 0x80000000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
// Deliberately omitting FILE_SHARE_DELETE (0x00000004).
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;

function toWide(s: string): Uint8Array {
  const buf = Buffer.alloc((s.length + 1) * 2);
  for (let i = 0; i < s.length; i++) buf.writeUInt16LE(s.charCodeAt(i), i * 2);
  return buf;
}

function tryOpenNoShareDelete(path: string): bigint {
  return symbols.CreateFileW(
    ptr(toWide(path)),
    GENERIC_READ,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL,
    0n,
  ) as bigint;
}

// Returns a handle to the first regular file found at most `depth` levels
// below `dir`, or INVALID_HANDLE_VALUE. Directories fail to open with
// FILE_ATTRIBUTE_NORMAL, which is what lets this tell them apart.
function grabFileBelow(dir: string, depth: number): [bigint, string] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [INVALID_HANDLE_VALUE, ""];
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isFile()) {
      const h = tryOpenNoShareDelete(path);
      if (h !== INVALID_HANDLE_VALUE && h !== 0n) return [h, path];
    } else if (entry.isDirectory() && depth > 0) {
      const found = grabFileBelow(path, depth - 1);
      if (found[0] !== INVALID_HANDLE_VALUE) return found;
    }
  }
  return [INVALID_HANDLE_VALUE, ""];
}

console.log("READY");

const deadline = Date.now() + 15_000;
let handle: bigint = INVALID_HANDLE_VALUE;
let heldPath = "";
outer: while (Date.now() < deadline) {
  let names: string[];
  try {
    names = readdirSync(watchDir);
  } catch {
    continue;
  }
  for (const name of names) {
    if (!name.includes(subdirFilter)) continue;
    [handle, heldPath] = grabFileBelow(join(watchDir, name), 4);
    if (handle !== INVALID_HANDLE_VALUE) break outer;
  }
}

if (handle === INVALID_HANDLE_VALUE) {
  console.log("MISSED");
  process.exit(0);
}

console.log("HELD " + heldPath);
await Bun.sleep(holdMs);
symbols.CloseHandle(handle);
console.log("RELEASED");
process.exit(0);
