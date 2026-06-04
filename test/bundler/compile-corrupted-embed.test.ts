import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { closeSync, copyFileSync, openSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

// A standalone executable whose embedded module-graph payload got corrupted
// after the build (truncated download, AV rewriting, hex editing, ...) must
// not crash at startup: the runtime validates the embedded length field
// against what is actually mapped and falls back to the plain CLI instead of
// reading out of bounds. Regression test for a startup ACCESS_VIOLATION in
// StandaloneModuleGraph.fromExecutable on Windows; the same unvalidated
// length pattern existed for ELF and Mach-O.

// FF FF FF FF FF FF 00 00 — huge, but doesn't overflow when small offsets are added.
const HUGE_LENGTH = 0x0000ffffffffffffn;

// Higher per-test timeout because `bun build --compile` copies + rewrites
// the entire bun binary (~1GB under debug+ASAN), which blows the 5s default;
// the corruption step then copies the produced executable again.
const TIMEOUT = 120_000;

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const n = readSync(fd, buf, total, length - total, position + total);
    if (n === 0) throw new Error(`unexpected EOF at ${position + total}`);
    total += n;
  }
  return buf;
}

function writeU64At(fd: number, position: number, value: bigint): void {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  writeSync(fd, buf, 0, 8, position);
}

/// The compile-time ELF writer repoints the ".bun" section header at the
/// embedded payload: sh_addr/sh_offset locate `[u64 LE length][payload]`.
function elfFindPayload(fd: number): { fileOffset: number; vaddr: bigint } {
  const ehdr = readAt(fd, 0, 64);
  if (ehdr.readUInt32BE(0) !== 0x7f454c46) throw new Error("not an ELF file");
  const e_shoff = Number(ehdr.readBigUInt64LE(0x28));
  const e_shentsize = ehdr.readUInt16LE(0x3a);
  const e_shnum = ehdr.readUInt16LE(0x3c);
  const e_shstrndx = ehdr.readUInt16LE(0x3e);

  const shstrtab = readAt(fd, e_shoff + e_shstrndx * e_shentsize, e_shentsize);
  const shstrOff = Number(shstrtab.readBigUInt64LE(0x18));

  for (let i = 0; i < e_shnum; i++) {
    const sh = readAt(fd, e_shoff + i * e_shentsize, e_shentsize);
    const name = readAt(fd, shstrOff + sh.readUInt32LE(0), 5);
    if (name.toString("latin1") === ".bun\0") {
      return {
        fileOffset: Number(sh.readBigUInt64LE(0x18)),
        vaddr: sh.readBigUInt64LE(0x10),
      };
    }
  }
  throw new Error("no .bun section");
}

/// Stomp the payload's u64 length prefix.
function elfStompLength(path: string): void {
  const fd = openSync(path, "r+");
  try {
    const { fileOffset } = elfFindPayload(fd);
    writeU64At(fd, fileOffset, HUGE_LENGTH);
  } finally {
    closeSync(fd);
  }
}

/// Stomp the payload vaddr stored at the BUN_COMPILED blob header: the only
/// 16 KiB-aligned u64 inside a PT_LOAD's file-backed range holding the
/// payload's vaddr.
function elfStompVaddr(path: string): void {
  const fd = openSync(path, "r+");
  try {
    const { vaddr } = elfFindPayload(fd);
    const ehdr = readAt(fd, 0, 64);
    const e_phoff = Number(ehdr.readBigUInt64LE(0x20));
    const e_phentsize = ehdr.readUInt16LE(0x36);
    const e_phnum = ehdr.readUInt16LE(0x38);
    const BLOB_ALIGN = 16384n;

    for (let i = 0; i < e_phnum; i++) {
      const ph = readAt(fd, e_phoff + i * e_phentsize, e_phentsize);
      if (ph.readUInt32LE(0) !== 1 /* PT_LOAD */) continue;
      const p_offset = ph.readBigUInt64LE(0x08);
      const p_vaddr = ph.readBigUInt64LE(0x10);
      const p_filesz = ph.readBigUInt64LE(0x20);
      for (
        let v = ((p_vaddr + BLOB_ALIGN - 1n) / BLOB_ALIGN) * BLOB_ALIGN;
        v + 8n <= p_vaddr + p_filesz;
        v += BLOB_ALIGN
      ) {
        const off = Number(p_offset + (v - p_vaddr));
        if (readAt(fd, off, 8).readBigUInt64LE(0) === vaddr) {
          writeU64At(fd, off, 0x4141414141414141n);
          return;
        }
      }
    }
    throw new Error("BUN_COMPILED blob header not found");
  } finally {
    closeSync(fd);
  }
}

/// The ".bun" PE section's raw data is `[u64 LE length][payload]`.
function peStompLength(path: string): void {
  const fd = openSync(path, "r+");
  try {
    const dos = readAt(fd, 0, 64);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not a PE file");
    const lfanew = dos.readUInt32LE(0x3c);
    const head = readAt(fd, lfanew, 24);
    if (head.readUInt32LE(0) !== 0x00004550) throw new Error("bad PE signature");
    const numberOfSections = head.readUInt16LE(6);
    const sizeOfOptionalHeader = head.readUInt16LE(20);
    const sectionTable = lfanew + 24 + sizeOfOptionalHeader;

    for (let i = 0; i < numberOfSections; i++) {
      const sh = readAt(fd, sectionTable + i * 40, 40);
      if (sh.toString("latin1", 0, 8) === ".bun\0\0\0\0") {
        writeU64At(fd, sh.readUInt32LE(20) /* PointerToRawData */, HUGE_LENGTH);
        return;
      }
    }
    throw new Error("no .bun section");
  } finally {
    closeSync(fd);
  }
}

/// The `__BUN,__bun` Mach-O section holds `[u64 LE length][payload]`.
function machoStompLength(path: string): void {
  const fd = openSync(path, "r+");
  try {
    const header = readAt(fd, 0, 32);
    if (header.readUInt32LE(0) !== 0xfeedfacf) throw new Error("not a 64-bit Mach-O file");
    const ncmds = header.readUInt32LE(0x10);
    let cmdOffset = 32;
    for (let i = 0; i < ncmds; i++) {
      const cmd = readAt(fd, cmdOffset, 8);
      const cmdsize = cmd.readUInt32LE(4);
      if (cmd.readUInt32LE(0) === 0x19 /* LC_SEGMENT_64 */) {
        const seg = readAt(fd, cmdOffset, 72);
        // Exact 16-byte segment/section names, as written by src/exe_format/macho.rs.
        if (seg.subarray(8, 24).equals(Buffer.from("__BUN\0\0\0\0\0\0\0\0\0\0\0", "latin1"))) {
          const nsects = seg.readUInt32LE(64);
          for (let s = 0; s < nsects; s++) {
            const sect = readAt(fd, cmdOffset + 72 + s * 80, 80);
            if (sect.subarray(0, 16).equals(Buffer.from("__bun\0\0\0\0\0\0\0\0\0\0\0", "latin1"))) {
              writeU64At(fd, sect.readUInt32LE(48) /* offset */, HUGE_LENGTH);
              return;
            }
          }
        }
      }
      cmdOffset += cmdsize;
    }
    throw new Error("no __BUN,__bun section");
  } finally {
    closeSync(fd);
  }
}

async function compileApp(dir: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "./app.js", "--outfile", "app"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return join(dir, isWindows ? "app.exe" : "app");
}

async function run(exe: string, args: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [exe, ...args],
    // BUN_BE_BUN would skip loading the embedded graph entirely; make sure
    // the corrupted payload is actually exercised.
    env: { ...bunEnv, BUN_BE_BUN: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function expectGracefulFallback(exe: string) {
  // With the embedded graph rejected, the binary behaves like a plain `bun`.
  const { stdout, exitCode } = await run(exe, ["-e", "console.log('fallback-ok')"]);
  expect(stdout).toContain("fallback-ok");
  expect(exitCode).toBe(0);
}

function corruptedCopy(exe: string, suffix: string, stomp: (path: string) => void): string {
  const corrupted = isWindows ? exe.replace(/\.exe$/, `-${suffix}.exe`) : `${exe}-${suffix}`;
  copyFileSync(exe, corrupted);
  stomp(corrupted);
  return corrupted;
}

test.if(isLinux)(
  "corrupted standalone executable does not crash at startup (ELF)",
  async () => {
    using dir = tempDir("compile-corrupted-elf", {
      "app.js": `console.log("hello from standalone");`,
    });
    const exe = await compileApp(String(dir));

    const healthy = await run(exe);
    expect(healthy.stdout).toContain("hello from standalone");
    expect(healthy.exitCode).toBe(0);

    await expectGracefulFallback(corruptedCopy(exe, "lenbad", elfStompLength));
    await expectGracefulFallback(corruptedCopy(exe, "vaddrbad", elfStompVaddr));
  },
  TIMEOUT,
);

test.if(isWindows)(
  "corrupted standalone executable does not crash at startup (PE)",
  async () => {
    using dir = tempDir("compile-corrupted-pe", {
      "app.js": `console.log("hello from standalone");`,
    });
    const exe = await compileApp(String(dir));

    const healthy = await run(exe);
    expect(healthy.stdout).toContain("hello from standalone");
    expect(healthy.exitCode).toBe(0);

    await expectGracefulFallback(corruptedCopy(exe, "lenbad", peStompLength));
  },
  TIMEOUT,
);

test.if(isMacOS)(
  "corrupted standalone executable does not crash at startup (Mach-O)",
  async () => {
    using dir = tempDir("compile-corrupted-macho", {
      "app.js": `console.log("hello from standalone");`,
    });
    const exe = await compileApp(String(dir));

    const healthy = await run(exe);
    expect(healthy.stdout).toContain("hello from standalone");
    expect(healthy.exitCode).toBe(0);

    const corrupted = corruptedCopy(exe, "lenbad", machoStompLength);
    // Editing the file invalidates the ad-hoc code signature and the kernel
    // would kill the process before it runs; re-sign so startup is reached.
    await using codesign = Bun.spawn({
      cmd: ["codesign", "--force", "--sign", "-", corrupted],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await codesign.exited).toBe(0);

    await expectGracefulFallback(corrupted);
  },
  TIMEOUT,
);
