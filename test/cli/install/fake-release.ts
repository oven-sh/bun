import { isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

// Build a minimal ZIP archive with a single stored (uncompressed) entry.
// `unzip -o` on POSIX restores the mode from the Unix external-attrs field;
// Expand-Archive on Windows ignores it.
export function makeZipStored(entryName: string, data: Buffer, unixMode: number): Buffer {
  const nameBytes = Buffer.from(entryName, "utf8");
  const crc = Bun.hash.crc32(data);
  const size = data.length;

  const lfhLen = 30 + nameBytes.length;
  const cdhLen = 46 + nameBytes.length;
  const cdOffset = lfhLen + size;

  const buf = Buffer.alloc(lfhLen + size + cdhLen + 22);
  let p = 0;
  const u16 = (v: number) => {
    buf.writeUInt16LE(v, p);
    p += 2;
  };
  const u32 = (v: number) => {
    buf.writeUInt32LE(v >>> 0, p);
    p += 4;
  };
  const raw = (b: Buffer) => {
    b.copy(buf, p);
    p += b.length;
  };

  // Local file header
  u32(0x04034b50);
  u16(20); // version needed
  u16(0); // flags
  u16(0); // method: stored
  u16(0); // mtime
  u16(0); // mdate
  u32(crc);
  u32(size);
  u32(size);
  u16(nameBytes.length);
  u16(0);
  raw(nameBytes);
  raw(data);

  // Central directory header
  u32(0x02014b50);
  u16((3 << 8) | 20); // made by: Unix, spec 2.0
  u16(20);
  u16(0);
  u16(0);
  u16(0);
  u16(0);
  u32(crc);
  u32(size);
  u32(size);
  u16(nameBytes.length);
  u16(0);
  u16(0);
  u16(0);
  u16(0);
  u32((0o100000 | unixMode) << 16);
  u32(0); // LFH offset
  raw(nameBytes);

  // End of central directory
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(1);
  u16(1);
  u32(cdhLen);
  u32(cdOffset);
  u16(0);

  return buf;
}

export type RestrictedPath = string & Disposable;

// Build a PATH that holds only the named programs (those found on this host),
// so a test can run the installer or `bun upgrade` on a host that appears to
// lack `curl` or `unzip`. Returns null on Windows, when a required program is
// missing, or when `probe` does not exit 0 under that PATH (a pyenv shim for
// python3, a busybox without the unzip applet).
export function restrictedPathDir(programs: string[], required: string[], probe?: string[]): RestrictedPath | null {
  if (isWindows) return null;
  const dir = tempDir("bun-restricted-path", {});
  for (const name of programs) {
    const found = Bun.which(name);
    if (!found) {
      if (required.includes(name)) {
        dir[Symbol.dispose]();
        return null;
      }
      continue;
    }
    symlinkSync(found, join(dir, name));
  }
  if (probe) {
    const { exitCode } = Bun.spawnSync({ cmd: probe, env: { PATH: dir }, stdout: "ignore", stderr: "ignore" });
    if (exitCode !== 0) {
      dir[Symbol.dispose]();
      return null;
    }
  }
  return dir;
}
