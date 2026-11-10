import { expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isLinux,
  isMacOS,
  isWindows,
  readElf64ProgramHeaders,
  tempDir,
} from "harness";
import {
  closeSync,
  copyFileSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  truncateSync,
  writeSync,
} from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

// Huge, but adding small offsets to it doesn't overflow.
const HUGE_LENGTH = 0x0000ffffffffffffn;

// `bun build --compile` copies the whole bun binary, about 1 GB for a debug build.
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

type ElfSection = { name: string; type: number; flags: bigint; vaddr: bigint; fileOffset: number; size: number };

const SHT_PROGBITS = 1;
const SHF_ALLOC = 2n;

function elfSections(fd: number): ElfSection[] {
  const ehdr = readAt(fd, 0, 64);
  if (ehdr.readUInt32BE(0) !== 0x7f454c46) throw new Error("not an ELF file");
  const e_shoff = Number(ehdr.readBigUInt64LE(0x28));
  const e_shentsize = ehdr.readUInt16LE(0x3a);
  const e_shnum = ehdr.readUInt16LE(0x3c);
  const e_shstrndx = ehdr.readUInt16LE(0x3e);

  const shstrtab = readAt(fd, e_shoff + e_shstrndx * e_shentsize, e_shentsize);
  const names = readAt(fd, Number(shstrtab.readBigUInt64LE(0x18)), Number(shstrtab.readBigUInt64LE(0x20)));

  const sections: ElfSection[] = [];
  for (let i = 0; i < e_shnum; i++) {
    const sh = readAt(fd, e_shoff + i * e_shentsize, e_shentsize);
    const nameStart = sh.readUInt32LE(0);
    sections.push({
      name: names.toString("latin1", nameStart, names.indexOf(0, nameStart)),
      type: sh.readUInt32LE(4),
      flags: sh.readBigUInt64LE(8),
      vaddr: sh.readBigUInt64LE(0x10),
      fileOffset: Number(sh.readBigUInt64LE(0x18)),
      size: Number(sh.readBigUInt64LE(0x20)),
    });
  }
  return sections;
}

/// In bun itself, the ".bun" section is the BUN_COMPILED header. `bun build --compile` points the section header at
/// the embedded payload instead, so sh_addr and sh_offset locate `[u64 LE length][payload]`.
function elfFindBunSection(fd: number): { fileOffset: number; vaddr: bigint } {
  const section = elfSections(fd).find(section => section.name === ".bun");
  if (!section) throw new Error("no .bun section");
  return { fileOffset: section.fileOffset, vaddr: section.vaddr };
}

/// Overwrites the payload's u64 length prefix.
function elfStompLength(path: string): void {
  const fd = openSync(path, "r+");
  try {
    const { fileOffset } = elfFindBunSection(fd);
    writeU64At(fd, fileOffset, HUGE_LENGTH);
  } finally {
    closeSync(fd);
  }
}

/// Overwrites the payload vaddr in the BUN_COMPILED header, which stays at the file offset it has in bun itself.
function elfStompVaddr(path: string, newVaddr: bigint): void {
  const bun = openSync(bunExe(), "r");
  const fd = openSync(path, "r+");
  try {
    const position = elfFindBunSection(bun).fileOffset;
    expect(readAt(fd, position, 8).readBigUInt64LE()).toBe(elfFindBunSection(fd).vaddr);
    writeU64At(fd, position, newVaddr);
  } finally {
    closeSync(fd);
    closeSync(bun);
  }
}

/// Overwrites the length prefix. The ".bun" PE section's raw data is `[u64 LE length][payload]`.
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

async function compileApp(dir: string, flags: string[] = []): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", ...flags, "./app.js", "--outfile", "app"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  // `--aot` reports on stderr what it compiled.
  expect(stderr.split("\n").filter(line => /^(warn|error)\b/.test(line))).toEqual([]);
  if (flags.length === 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return join(dir, isWindows ? "app.exe" : "app");
}

async function run(exe: string, args: string[] = [], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [exe, ...args],
    // BUN_BE_BUN would skip loading the embedded graph, so unset it.
    env: { ...bunEnv, BUN_BE_BUN: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Without its graph, the executable behaves like plain `bun`.
async function expectGracefulFallback(exe: string) {
  expect(await run(exe, ["-e", "console.log('fallback-ok')"])).toEqual({
    stdout: "fallback-ok\n",
    stderr: "",
    exitCode: 0,
  });
  rmSync(exe);
}

function corruptedCopy(exe: string, suffix: string, stomp: (path: string) => void): string {
  const corrupted = isWindows ? exe.replace(/\.exe$/, `-${suffix}.exe`) : `${exe}-${suffix}`;
  copyFileSync(exe, corrupted);
  stomp(corrupted);
  return corrupted;
}

// macOS is skipped because a patched Mach-O needs a new signature.
test.skipIf(isMacOS)(
  "doesn't crash at startup when the graph length or address points outside mapped memory",
  async () => {
    using dir = tempDir("compile-corrupted-length", {
      "app.js": `console.log("hello from standalone");`,
    });
    const exe = await compileApp(String(dir));
    expect(await run(exe)).toEqual({ stdout: "hello from standalone\n", stderr: "", exitCode: 0 });

    await expectGracefulFallback(corruptedCopy(exe, "length", isWindows ? peStompLength : elfStompLength));
    if (!isWindows) {
      await expectGracefulFallback(corruptedCopy(exe, "vaddr", path => elfStompVaddr(path, 0x4141414141414141n)));
    }
  },
  TIMEOUT,
);

// The graph ends with `Offsets`, then the trailer. `Offsets` is byte_count u64, modules_ptr { offset u32, length u32 },
// entry_point_id u32, compile_exec_argv_ptr { offset u32, length u32 }, flags u32.
// macOS is skipped because a patched Mach-O needs a new signature. Every platform uses the same reader.
test.skipIf(isMacOS)(
  "reports an out-of-range entry point ID at startup",
  async () => {
    using dir = tempDir("compile-corrupted-graph", {
      "app.js": `console.log("should not run");`,
    });
    const exe = await compileApp(String(dir));

    const bytes = readFileSync(exe);
    const offsetsAt = bytes.lastIndexOf("\n---- Bun! ----\n") - 32;
    // There's one 52-byte module, so entry point ID 1 is one past the end.
    expect(bytes.readUInt32LE(offsetsAt + 12)).toBe(52);

    const corrupted = corruptedCopy(exe, "field", path => {
      const fd = openSync(path, "r+");
      try {
        const u32 = Buffer.alloc(4);
        u32.writeUInt32LE(1);
        writeSync(fd, u32, 0, 4, offsetsAt + 16);
      } finally {
        closeSync(fd);
      }
    });
    expect(await run(corrupted)).toEqual({
      stdout: "",
      stderr: expect.stringContaining("Corrupted module graph: entry point ID is greater than module list count"),
      exitCode: 1,
    });
    rmSync(corrupted);
  },
  TIMEOUT,
);

// The kernel maps the payload's segment without checking the file's length, so a truncated executable still starts.
// The check needs MADV_POPULATE_READ (Linux 5.14).
const [kernelMajor, kernelMinor] = release().split(".").map(Number);
const reportsTruncation = isLinux && (kernelMajor > 5 || (kernelMajor === 5 && kernelMinor >= 14));
test.if(reportsTruncation)(
  "exits with an error when a standalone executable is truncated",
  async () => {
    using dir = tempDir("compile-truncated", {
      "big.txt": Buffer.alloc(1024 * 1024, "x").toString(),
      "app.js": `import big from "./big.txt" with { type: "text" }; console.log("intact-" + big.length);`,
    });
    const exe = await compileApp(String(dir));
    expect(await run(exe)).toEqual({ stdout: "intact-1048576\n", stderr: "", exitCode: 0 });

    const fd = openSync(exe, "r");
    const { fileOffset } = elfFindBunSection(fd);
    closeSync(fd);

    // The first cut keeps the length header's page but drops the trailer. The second drops the whole payload.
    for (const length of [fileOffset + 64 * 1024, fileOffset]) {
      const cut = corruptedCopy(exe, "cut", path => truncateSync(path, length));
      // At exit, LeakSanitizer would scan mapped pages that are past the end of the file.
      const ASAN_OPTIONS = [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":");
      expect(await run(cut, [], { ASAN_OPTIONS })).toEqual({
        stdout: "",
        stderr:
          `error: "${realpathSync(cut)}" is truncated. Part of its embedded program is missing.\n` +
          "note: The download or copy was probably interrupted. Download or install it again.\n",
        exitCode: 1,
      });
      rmSync(cut);
    }
  },
  TIMEOUT,
);

function pageSize(): number {
  // Pairs of u64: a type, then its value.
  const auxiliaryVector = readFileSync("/proc/self/auxv");
  const AT_PAGESZ = 6n;
  for (let at = 0; at + 16 <= auxiliaryVector.length; at += 16) {
    if (auxiliaryVector.readBigUInt64LE(at) === AT_PAGESZ) return Number(auxiliaryVector.readBigUInt64LE(at + 8));
  }
  throw new Error("no AT_PAGESZ");
}

test.if(reportsTruncation)(
  "a truncated standalone executable says so unless part of the payload's last page is left",
  async () => {
    using dir = tempDir("compile-truncated-lengths", {
      "big.txt": Buffer.alloc(1024 * 1024, "x").toString(),
      "app.js": `import big from "./big.txt" with { type: "text" }; console.log("intact-" + big.length);`,
    });
    const exe = await compileApp(String(dir));

    const fd = openSync(exe, "r");
    const { fileOffset } = elfFindBunSection(fd);
    const payloadLength = Number(readAt(fd, fileOffset, 8).readBigUInt64LE());
    closeSync(fd);
    const end = fileOffset + 8 + payloadLength;
    const lastPage = end - 1 - ((end - 1) % pageSize());

    const lengths = [
      end,
      end - 1,
      // Inside the trailer.
      end - 8,
      // Inside `Offsets`.
      end - 32,
      lastPage + 1,
      lastPage,
      fileOffset + 8 + Math.floor(payloadLength / 2),
      fileOffset + pageSize(),
      fileOffset + 8,
      // Inside the length header. What is left of it still holds every nonzero byte.
      fileOffset + 4,
    ].sort((a, b) => b - a);

    // Every length is shorter than the one before it, so one copy is enough.
    const cut = corruptedCopy(exe, "cut", () => {});
    const ASAN_OPTIONS = [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":");
    for (const length of lengths) {
      truncateSync(cut, length);
      const payloadBytesLeft = length - fileOffset;
      expect({
        payloadBytesLeft,
        ...(await run(cut, ["-e", "console.log('fallback-ok')"], { ASAN_OPTIONS })),
      }).toEqual({
        payloadBytesLeft,
        ...(length >= end
          ? { stdout: "intact-1048576\n", stderr: "", exitCode: 0 }
          : length > lastPage
            ? // The rest of the page reads as zeros, so there's no trailer.
              { stdout: "fallback-ok\n", stderr: isDebug ? expect.any(String) : "", exitCode: 0 }
            : {
                stdout: "",
                stderr:
                  `error: "${realpathSync(cut)}" is truncated. Part of its embedded program is missing.\n` +
                  "note: The download or copy was probably interrupted. Download or install it again.\n",
                exitCode: 1,
              }),
      });
    }
    rmSync(cut);
  },
  TIMEOUT,
);

/// The word that holds the payload's address: the ".bun" section of bun itself, or ".bun.pointer" of a bun that is a compiled executable already.
function elfFindPointerWord(fd: number): { fileOffset: number; vaddr: bigint } {
  const pointer = elfSections(fd).find(section => section.name === ".bun.pointer");
  return pointer ? { fileOffset: pointer.fileOffset, vaddr: pointer.vaddr } : elfFindBunSection(fd);
}

// GNU strip and objcopy write a new file from the section headers. Bytes that no section covers are lost. The word
// that holds the payload's address stays where bun itself has its ".bun" section, which the compile points at the payload.
test.skipIf(!isLinux)(
  "a section header covers the word that holds the payload's address",
  async () => {
    using dir = tempDir("compile-pointer-section", {
      "app.js": `console.log("hello from standalone");`,
    });
    const exe = await compileApp(String(dir));

    const bun = openSync(bunExe(), "r");
    const fd = openSync(exe, "r");
    try {
      const word = elfFindPointerWord(bun);
      const payload = elfFindBunSection(fd);
      expect(readAt(fd, word.fileOffset, 8).readBigUInt64LE()).toBe(payload.vaddr);

      const coveringSections = elfSections(fd).filter(
        section =>
          (section.flags & SHF_ALLOC) !== 0n &&
          section.fileOffset <= word.fileOffset &&
          word.fileOffset + 8 <= section.fileOffset + section.size,
      );
      expect(coveringSections).toEqual([
        {
          name: ".bun.pointer",
          type: SHT_PROGBITS,
          flags: expect.any(BigInt),
          vaddr: word.vaddr,
          fileOffset: word.fileOffset,
          size: 8,
        },
      ]);
    } finally {
      closeSync(fd);
      closeSync(bun);
    }
  },
  TIMEOUT,
);

const gnuStrip = isLinux && Bun.which("strip");
const hasGnuStrip =
  !!gnuStrip &&
  Bun.spawnSync({ cmd: [gnuStrip, "--version"], stdout: "pipe" })
    .stdout.toString()
    .includes("GNU");

/// An executable whose payload has segments of its own (`--aot`, `--trim`, or a bun that is such an executable) has its program header table
/// inside a note. GNU strip refuses that layout: it exits with an error and leaves the file as it was.
function hasOwnSegments(exe: string): boolean {
  const PT_BUN_RESERVED = 0x6fb00001;
  const PT_BUN_PAYLOAD = 0x6fb00002;
  return readElf64ProgramHeaders(exe).some(ph => ph.type === PT_BUN_RESERVED || ph.type === PT_BUN_PAYLOAD);
}

test.if(hasGnuStrip)(
  "runs its program after GNU strip",
  async () => {
    using dir = tempDir("compile-stripped", {
      "app.js": `console.log("hello from standalone");`,
    });
    const exe = await compileApp(String(dir));
    const stripAccepts = !hasOwnSegments(exe);
    const stripped = corruptedCopy(exe, "stripped", path => {
      const { stderr, exitCode } = Bun.spawnSync({ cmd: [gnuStrip!, path], stderr: "pipe" });
      if (stripAccepts) {
        expect(stderr.toString()).toBe("");
        expect(exitCode).toBe(0);
      }
    });
    expect(await run(stripped)).toEqual({ stdout: "hello from standalone\n", stderr: "", exitCode: 0 });
    rmSync(stripped);
  },
  TIMEOUT,
);

// Not every build of Bun includes the compiler. One without it says so before it looks for the entry point.
const hasAot =
  hasGnuStrip &&
  !/^error: --aot /m.test(
    Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", "--aot", "./no-such-file.ts"],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    }).stderr.toString(),
  );

// Whatever a version of binutils does with the layout of an `--aot` executable, the program stays.
// An `--aot` build takes a minute with a sanitizer, and the layout is the same there.
test.if(hasAot && !isASAN)(
  "GNU strip never turns an --aot executable into the Bun CLI",
  async () => {
    using dir = tempDir("compile-aot-stripped", {
      "app.js": `console.log("hello from standalone");`,
    });
    const exe = await compileApp(String(dir), ["--aot"]);
    const stripped = corruptedCopy(exe, "stripped", path => {
      Bun.spawnSync({ cmd: [gnuStrip!, path], stderr: "pipe" });
    });
    expect(await run(stripped)).toEqual({ stdout: "hello from standalone\n", stderr: "", exitCode: 0 });
    rmSync(stripped);
  },
  TIMEOUT,
);
