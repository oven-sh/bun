// Simulates an antivirus / search-indexer process that opens a freshly
// extracted file for scanning without FILE_SHARE_DELETE. On NTFS, an open
// handle lacking FILE_SHARE_DELETE on any file inside a directory causes a
// rename of that directory to fail with STATUS_ACCESS_DENIED.
//
// argv: <tmpDir> <holdMs>
//
// Spin-polls tmpDir for a new `.*-*` extraction directory, opens the first
// regular file inside it via CreateFileW with dwShareMode =
// FILE_SHARE_READ | FILE_SHARE_WRITE (no DELETE), prints "HELD", holds the
// handle for holdMs, closes it, prints "RELEASED", exits 0.
// Prints "MISSED" and exits 0 if no extraction dir appears within 30s.

import { dlopen, FFIType, ptr } from "bun:ffi";
import { readdirSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32") {
  console.log("MISSED");
  process.exit(0);
}

const [, , tmpDir, holdMsStr] = process.argv;
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
  const h = symbols.CreateFileW(
    ptr(toWide(path)),
    GENERIC_READ,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    null,
    OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL,
    0n,
  ) as bigint;
  return h;
}

console.log("READY");

const deadline = Date.now() + 15_000;
let handle: bigint = INVALID_HANDLE_VALUE;
let heldPath = "";
outer: while (Date.now() < deadline) {
  let entries: string[];
  try {
    entries = readdirSync(tmpDir);
  } catch {
    continue;
  }
  for (const name of entries) {
    // Temp extraction dirs look like `.{hex}-{counter}.{pkgbasename}`.
    if (!name.startsWith(".") || name.indexOf("-") === -1) continue;
    let inner: string[];
    try {
      inner = readdirSync(join(tmpDir, name));
    } catch {
      continue;
    }
    for (const f of inner) {
      const target = join(tmpDir, name, f);
      const h = tryOpenNoShareDelete(target);
      if (h !== INVALID_HANDLE_VALUE && h !== 0n) {
        handle = h;
        heldPath = target;
        break outer;
      }
    }
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
