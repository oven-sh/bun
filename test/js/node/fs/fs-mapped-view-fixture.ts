// Windows only. Holds a mapped view of a file from a separate process so a
// shrink of that file fails with STATUS_USER_MAPPED_FILE.
// Usage: bun fs-mapped-view-fixture.ts <path>
// Prints "mapped" once the view exists, then waits for stdin to close.
import { dlopen, ptr } from "bun:ffi";

const kernel32 = dlopen("kernel32.dll", {
  CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "i64" },
  CreateFileMappingW: { args: ["i64", "ptr", "u32", "u32", "u32", "ptr"], returns: "i64" },
  MapViewOfFile: { args: ["i64", "u32", "u32", "u32", "u64"], returns: "i64" },
  CloseHandle: { args: ["i64"], returns: "i32" },
});

const GENERIC_READ = 0x80000000;
const FILE_SHARE_ALL = 7;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const PAGE_READONLY = 0x02;
const FILE_MAP_READ = 0x04;

const path = process.argv[2];
const file = kernel32.symbols.CreateFileW(
  ptr(Buffer.from(`${path}\0`, "utf16le")),
  GENERIC_READ,
  FILE_SHARE_ALL,
  null,
  OPEN_EXISTING,
  FILE_ATTRIBUTE_NORMAL,
  null,
) as bigint;
if (file === -1n) throw new Error("CreateFileW failed");
const section = kernel32.symbols.CreateFileMappingW(file, null, PAGE_READONLY, 0, 0, null) as bigint;
const view = kernel32.symbols.MapViewOfFile(section, FILE_MAP_READ, 0, 0, 0n) as bigint;
kernel32.symbols.CloseHandle(section);
kernel32.symbols.CloseHandle(file);
if (view === 0n) throw new Error("MapViewOfFile failed");
console.log("mapped");
await Bun.stdin.text();
