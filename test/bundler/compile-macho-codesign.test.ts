// https://github.com/oven-sh/bun/issues/32159 — the ad-hoc signer must hash the last partial page unpadded and end the file at the signature.

import { describe, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, isArm64, isMacOS, tempDir } from "harness";
import { createHash } from "node:crypto";
import { join } from "path";

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;
const CPU_TYPE_X86_64 = 0x01000007;
const MH_EXECUTE = 2;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSSLOT_CODEDIRECTORY = 0;
const PAGE_SIZE = 0x1000;

// Not page-aligned on purpose, so the last hashed page is partial.
const TEMPLATE_SIG_OFF = 0x8100;

// Larger than the ad-hoc signature, so a missing truncate leaves a stale tail.
const TEMPLATE_SIG_SIZE = 0x2000;

const TEXT_VMADDR = 0x1_0000_0000n;

type TextSection = { name: string; offset: number; size: number; fill?: number };

// Minimal Mach-O: __TEXT (with `textSections`), __BUN with one __bun section, __LINKEDIT ending in LC_CODE_SIGNATURE.
function machoTemplate({
  cputype = CPU_TYPE_ARM64,
  textSections = [],
}: { cputype?: number; textSections?: TextSection[] } = {}): Buffer {
  const fileSize = TEMPLATE_SIG_OFF + TEMPLATE_SIG_SIZE;
  const segCmdSize = 72; // sizeof(segment_command_64)
  const sectSize = 80; // sizeof(section_64)
  const sigCmdSize = 16; // sizeof(linkedit_data_command)
  const textCmdSize = segCmdSize + textSections.length * sectSize;
  const sizeofcmds = textCmdSize + (segCmdSize + sectSize) + segCmdSize + sigCmdSize;

  // Non-zero fill so pages (especially the partial last one) hash real content.
  const buf = Buffer.alloc(fileSize, 0xc3);
  const writeName = (off: number, name: string) => {
    buf.fill(0, off, off + 16);
    buf.write(name, off, 16, "latin1");
  };

  // mach_header_64
  buf.writeUInt32LE(MH_MAGIC_64, 0);
  buf.writeInt32LE(cputype, 4);
  buf.writeInt32LE(0, 8); // cpusubtype
  buf.writeUInt32LE(MH_EXECUTE, 12);
  buf.writeUInt32LE(4, 16); // ncmds
  buf.writeUInt32LE(sizeofcmds, 20);
  buf.writeUInt32LE(0, 24); // flags
  buf.writeUInt32LE(0, 28); // reserved

  // LC_SEGMENT_64 __TEXT [0, 0x4000)
  let o = 32;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(textCmdSize, o + 4);
  writeName(o + 8, "__TEXT");
  buf.writeBigUInt64LE(TEXT_VMADDR, o + 24); // vmaddr
  buf.writeBigUInt64LE(0x4000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0n, o + 40); // fileoff
  buf.writeBigUInt64LE(0x4000n, o + 48); // filesize
  buf.writeInt32LE(5, o + 56); // maxprot r-x
  buf.writeInt32LE(5, o + 60); // initprot
  buf.writeUInt32LE(textSections.length, o + 64); // nsects

  o += segCmdSize;
  for (const { name, offset, size, fill } of textSections) {
    writeName(o, name);
    writeName(o + 16, "__TEXT");
    buf.writeBigUInt64LE(TEXT_VMADDR + BigInt(offset), o + 32); // addr
    buf.writeBigUInt64LE(BigInt(size), o + 40); // size
    buf.writeUInt32LE(offset, o + 48); // offset
    buf.fill(0, o + 52, o + sectSize); // align, reloff, nreloc, flags, reserved
    if (fill !== undefined) buf.fill(fill, offset, offset + size);
    o += sectSize;
  }

  // LC_SEGMENT_64 __BUN [0x4000, 0x8000) with one __bun section
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize + sectSize, o + 4);
  writeName(o + 8, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(0x4000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0x4000n, o + 40); // fileoff
  buf.writeBigUInt64LE(0x4000n, o + 48); // filesize
  buf.writeInt32LE(3, o + 56); // maxprot rw-
  buf.writeInt32LE(3, o + 60); // initprot
  buf.writeUInt32LE(1, o + 64); // nsects

  // section_64 __bun
  o += segCmdSize;
  writeName(o, "__bun");
  writeName(o + 16, "__BUN");
  buf.writeBigUInt64LE(0x1_0000_4000n, o + 32); // addr
  buf.writeBigUInt64LE(0x4000n, o + 40); // size
  buf.writeUInt32LE(0x4000, o + 48); // offset
  buf.writeUInt32LE(14, o + 52); // align = 2^14

  // LC_SEGMENT_64 __LINKEDIT [0x8000, fileSize)
  o += sectSize;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize, o + 4);
  writeName(o + 8, "__LINKEDIT");
  buf.writeBigUInt64LE(0x1_0000_8000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(0x3000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0x8000n, o + 40); // fileoff
  buf.writeBigUInt64LE(BigInt(fileSize - 0x8000), o + 48); // filesize
  buf.writeInt32LE(1, o + 56); // maxprot r--
  buf.writeInt32LE(1, o + 60); // initprot
  buf.writeUInt32LE(0, o + 64); // nsects

  // LC_CODE_SIGNATURE (linkedit_data_command)
  o += segCmdSize;
  buf.writeUInt32LE(LC_CODE_SIGNATURE, o);
  buf.writeUInt32LE(sigCmdSize, o + 4);
  buf.writeUInt32LE(TEMPLATE_SIG_OFF, o + 8); // dataoff
  buf.writeUInt32LE(TEMPLATE_SIG_SIZE, o + 12); // datasize

  return buf;
}

type Mismatch = { slot: number; stored: string; expected: string };

type ParsedSignature = {
  dataoff: number;
  datasize: number;
  superBlobMagic: number;
  cdMagic: number;
  codeLimit: number;
  nCodeSlots: number;
  hashSize: number;
  hashType: number;
  pageSizeLog2: number;
  mismatches: Mismatch[];
};

// Recompute every CodeDirectory slot hash the way Apple's verifier does (last page unpadded).
function parseAndVerifySignature(buf: Buffer): ParsedSignature {
  expect(buf.length).toBeGreaterThan(32);
  expect(buf.readUInt32LE(0)).toBe(MH_MAGIC_64);
  const ncmds = buf.readUInt32LE(16);

  let dataoff = 0;
  let datasize = 0;
  let p = 32;
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(p);
    const cmdsize = buf.readUInt32LE(p + 4);
    expect(cmdsize).toBeGreaterThanOrEqual(8);
    if (cmd === LC_CODE_SIGNATURE) {
      dataoff = buf.readUInt32LE(p + 8);
      datasize = buf.readUInt32LE(p + 12);
    }
    p += cmdsize;
  }
  expect(dataoff).toBeGreaterThan(0);
  // The advertised signature region must physically exist in the file.
  expect(dataoff + datasize).toBeLessThanOrEqual(buf.length);

  // SuperBlob and everything inside it is big-endian.
  const superBlobMagic = buf.readUInt32BE(dataoff);
  const blobCount = buf.readUInt32BE(dataoff + 8);
  let cd = 0;
  for (let i = 0; i < blobCount; i++) {
    const type = buf.readUInt32BE(dataoff + 12 + i * 8);
    const offset = buf.readUInt32BE(dataoff + 16 + i * 8);
    if (type === CSSLOT_CODEDIRECTORY) cd = dataoff + offset;
  }
  expect(cd).toBeGreaterThan(0);

  const cdMagic = buf.readUInt32BE(cd);
  const hashOffset = buf.readUInt32BE(cd + 16);
  const nSpecialSlots = buf.readUInt32BE(cd + 24);
  const nCodeSlots = buf.readUInt32BE(cd + 28);
  const codeLimit = buf.readUInt32BE(cd + 32);
  const hashSize = buf.readUInt8(cd + 36);
  const hashType = buf.readUInt8(cd + 37);
  const pageSizeLog2 = buf.readUInt8(cd + 39);
  expect(nSpecialSlots).toBe(0);
  expect(cd + hashOffset + nCodeSlots * hashSize).toBeLessThanOrEqual(buf.length);

  const pageSize = 1 << pageSizeLog2;
  const mismatches: Mismatch[] = [];
  for (let slot = 0; slot < nCodeSlots; slot++) {
    const stored = buf
      .subarray(cd + hashOffset + slot * hashSize, cd + hashOffset + (slot + 1) * hashSize)
      .toString("hex");
    const pageStart = slot * pageSize;
    const pageEnd = Math.min(pageStart + pageSize, codeLimit);
    const expected = createHash("sha256").update(buf.subarray(pageStart, pageEnd)).digest("hex");
    if (stored !== expected) mismatches.push({ slot, stored, expected });
  }

  return {
    dataoff,
    datasize,
    superBlobMagic,
    cdMagic,
    codeLimit,
    nCodeSlots,
    hashSize,
    hashType,
    pageSizeLog2,
    mismatches,
  };
}

// tiny fits the template's __BUN slot (size_diff == 0); large shifts __LINKEDIT forward.
const bundles = {
  tiny: `console.log("hi");`,
  large: `console.log("${Buffer.alloc(32 * 1024, "a").toString()}");`,
};

test.each(Object.entries(bundles))(
  "--compile --target=bun-darwin-arm64 stores Apple-style page hashes, including the final partial page (%s bundle)",
  async (label, source) => {
    using dir = tempDir(`compile-macho-codesign-${label}`, {
      "entry.ts": source,
    });
    const cwd = String(dir);
    const template = join(cwd, "template");
    await Bun.write(template, machoTemplate());
    const out = join(cwd, `out-${label}`);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-darwin-arm64",
        "--compile-executable-path",
        template,
        join(cwd, "entry.ts"),
        "--outfile",
        out,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const outBytes = readFileSync(out);
    const sig = parseAndVerifySignature(outBytes);
    expect(sig.superBlobMagic).toBe(CSMAGIC_EMBEDDED_SIGNATURE);
    expect(sig.cdMagic).toBe(CSMAGIC_CODEDIRECTORY);
    expect(sig.hashType).toBe(2); // SHA-256
    expect(sig.hashSize).toBe(32);
    expect(1 << sig.pageSizeLog2).toBe(PAGE_SIZE);

    // codeLimit covers everything before the signature blob.
    expect(sig.codeLimit).toBe(sig.dataoff);
    expect(sig.nCodeSlots).toBe(Math.ceil(sig.codeLimit / PAGE_SIZE));
    // The layout must end in a partial page or the test is vacuous.
    expect(sig.codeLimit % PAGE_SIZE).not.toBe(0);

    // codesign strict validation requires the signature to end at EOF.
    expect(outBytes.length).toBe(sig.dataoff + sig.datasize);

    expect(sig.mismatches).toStrictEqual([]);
  },
);

test.skipIf(!isMacOS || !isArm64)(
  "codesign verifies a natively compiled executable",
  async () => {
    using dir = tempDir("compile-macho-codesign-native", {
      "entry.ts": `console.log("hi");`,
    });
    const cwd = String(dir);
    const out = join(cwd, "out-native");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(cwd, "entry.ts"), "--outfile", out],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(buildStderr).not.toContain("error:");
    expect(buildExitCode).toBe(0);

    await using codesign = Bun.spawn({
      cmd: ["codesign", "--verify", out],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      codesign.stdout.text(),
      codesign.stderr.text(),
      codesign.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  },
  60_000,
);

// `--macos-info-plist` / `compile.macos.infoPlist`: the file becomes section `__info_plist` of the segment named
// `__TEXT`, which is where CoreFoundation and codesign read the Info.plist of an executable that is not in a bundle.
// `__TEXT` cannot grow after the link, so a darwin bun reserves a zero-filled `__TEXT,__bun_plist` section and
// `bun build --compile` renames it in place.
describe("--macos-info-plist", () => {
  const SLOT_OFFSET = 0x1000;
  const SLOT_SIZE = 0x1000;
  // What a darwin bun looks like to the Mach-O writer: the reserved section between two ordinary ones.
  const textWithSlot: TextSection[] = [
    { name: "__text", offset: 0x400, size: 0x100 },
    { name: "__bun_plist", offset: SLOT_OFFSET, size: SLOT_SIZE, fill: 0 },
    { name: "__const", offset: SLOT_OFFSET + SLOT_SIZE, size: 0x100 },
  ];
  // A base executable that reserves half as much. The file has to fit the section of the base it goes into.
  const textWithHalfSlot: TextSection[] = textWithSlot.map(s =>
    s.name === "__bun_plist" ? { ...s, size: SLOT_SIZE / 2 } : s,
  );

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>com.example.myapp</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>Records voice notes</string>
</dict>
</plist>
`;

  // An XML property list of exactly `size` bytes.
  function infoPlistOfSize(size: number): string {
    const head = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n<key>Padding</key>\n<string>`;
    const tail = `</string>\n</dict>\n</plist>\n`;
    return head + Buffer.alloc(size - head.length - tail.length, "a").toString() + tail;
  }

  // A binary property list: the magic, the objects, one offset byte per object, the 32-byte trailer.
  function binaryPlist(objects: number[][], topObject = 0): Buffer {
    const offsets: number[] = [];
    let at = 8;
    for (const object of objects) {
      offsets.push(at);
      at += object.length;
    }
    const trailer = Buffer.alloc(32);
    trailer[6] = 1; // bytes per offset
    trailer[7] = 1; // bytes per object reference
    trailer.writeBigUInt64BE(BigInt(objects.length), 8);
    trailer.writeBigUInt64BE(BigInt(topObject), 16);
    trailer.writeBigUInt64BE(BigInt(at), 24); // where the offset table starts
    return Buffer.concat([Buffer.from("bplist00"), Buffer.from(objects.flat()), Buffer.from(offsets), trailer]);
  }
  const EMPTY_DICTIONARY = [0xd0];
  const EMPTY_ARRAY = [0xa0];

  type Section = { sectname: string; segname: string; addr: bigint; size: number; offset: number };

  // The sections of the first segment named `__TEXT`: the only ones CoreFoundation and codesign search.
  function textSectionsOf(buf: Buffer): Section[] {
    const name = (off: number) => buf.toString("latin1", off, off + 16).replace(/\0.*$/, "");
    const ncmds = buf.readUInt32LE(16);
    let p = 32;
    for (let i = 0; i < ncmds; i++) {
      const cmd = buf.readUInt32LE(p);
      const cmdsize = buf.readUInt32LE(p + 4);
      if (cmd === LC_SEGMENT_64 && name(p + 8) === "__TEXT") {
        return Array.from({ length: buf.readUInt32LE(p + 64) }, (_, i) => {
          const s = p + 72 + i * 80;
          return {
            sectname: name(s),
            segname: name(s + 16),
            addr: buf.readBigUInt64LE(s + 32),
            size: Number(buf.readBigUInt64LE(s + 40)),
            offset: buf.readUInt32LE(s + 48),
          };
        });
      }
      p += cmdsize;
    }
    return [];
  }

  const section = (name: string, offset: number, size: number): Section => ({
    sectname: name,
    segname: "__TEXT",
    addr: TEXT_VMADDR + BigInt(offset),
    size,
    offset,
  });

  // The load commands as the template has them, with the reserved section now holding `plist`.
  function expectEmbedded(out: Buffer, template: Buffer, plist: Buffer) {
    expect(textSectionsOf(out)).toEqual([
      section("__text", 0x400, 0x100),
      section("__info_plist", SLOT_OFFSET, plist.length),
      section("__const", SLOT_OFFSET + SLOT_SIZE, 0x100),
    ]);
    expect(out.subarray(SLOT_OFFSET, SLOT_OFFSET + plist.length).equals(plist)).toBe(true);
    // The rest of the reserved room is zero.
    expect(
      out.subarray(SLOT_OFFSET + plist.length, SLOT_OFFSET + SLOT_SIZE).equals(Buffer.alloc(SLOT_SIZE - plist.length)),
    ).toBe(true);
    // Nothing was inserted and nothing moved: same load command count and size, same bytes after the slot.
    expect({ ncmds: out.readUInt32LE(16), sizeofcmds: out.readUInt32LE(20) }).toEqual({
      ncmds: template.readUInt32LE(16),
      sizeofcmds: template.readUInt32LE(20),
    });
    expect(
      out.subarray(SLOT_OFFSET + SLOT_SIZE, 0x4000).equals(template.subarray(SLOT_OFFSET + SLOT_SIZE, 0x4000)),
    ).toBe(true);
  }

  async function build(cwd: string, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...args, join(cwd, "entry.ts")],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const darwin = (arch: string, template: string, out: string) => [
    "--compile",
    `--target=bun-darwin-${arch}`,
    "--compile-executable-path",
    template,
    "--outfile",
    out,
  ];

  test.concurrent.each([
    ["arm64", CPU_TYPE_ARM64],
    ["x64", CPU_TYPE_X86_64],
  ] as const)("embeds the file in place of the reserved section (%s)", async (arch, cputype) => {
    using dir = tempDir(`compile-macos-info-plist-${arch}`, {
      "entry.ts": `console.log("hi");`,
      "Info.plist": infoPlist,
    });
    const cwd = String(dir);
    const template = machoTemplate({ cputype, textSections: textWithSlot });
    await Bun.write(join(cwd, "template"), template);
    const out = join(cwd, "out");

    // A relative path: it resolves against the working directory.
    const { stderr, exitCode } = await build(cwd, [
      ...darwin(arch, join(cwd, "template"), out),
      "--macos-info-plist",
      "Info.plist",
    ]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const outBytes = readFileSync(out);
    expectEmbedded(outBytes, template, Buffer.from(infoPlist));
    if (cputype === CPU_TYPE_ARM64) {
      // bun signs arm64 output itself. The page hashes include the plist, and the signature keeps its shape (no
      // special slots), so the plist is hashed but not bound.
      const sig = parseAndVerifySignature(outBytes);
      expect(sig.mismatches).toStrictEqual([]);
      expect(outBytes.length).toBe(sig.dataoff + sig.datasize);
    }
  });

  test.concurrent("without the option the reserved section is left alone", async () => {
    using dir = tempDir("compile-macos-info-plist-absent", { "entry.ts": `console.log("hi");` });
    const cwd = String(dir);
    const template = machoTemplate({ textSections: textWithSlot });
    await Bun.write(join(cwd, "template"), template);
    const out = join(cwd, "out");

    const { stderr, exitCode } = await build(cwd, darwin("arm64", join(cwd, "template"), out));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const outBytes = readFileSync(out);
    expect(textSectionsOf(outBytes)).toEqual(textSectionsOf(template));
    expect(outBytes.subarray(SLOT_OFFSET, SLOT_OFFSET + SLOT_SIZE).equals(Buffer.alloc(SLOT_SIZE))).toBe(true);
  });

  test.concurrent("a binary property list goes in as it is", async () => {
    const plist = binaryPlist([EMPTY_DICTIONARY]);
    using dir = tempDir("compile-macos-info-plist-binary", { "entry.ts": `console.log("hi");`, "Info.plist": plist });
    const cwd = String(dir);
    const template = machoTemplate({ textSections: textWithSlot });
    await Bun.write(join(cwd, "template"), template);
    const out = join(cwd, "out");

    const { stderr, exitCode } = await build(cwd, [
      ...darwin("arm64", join(cwd, "template"), out),
      `--macos-info-plist=${join(cwd, "Info.plist")}`,
    ]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expectEmbedded(readFileSync(out), template, plist);
  });

  test.concurrent("the reserved section of the base executable is the limit", async () => {
    using dir = tempDir("compile-macos-info-plist-limit", {
      "entry.ts": `console.log("hi");`,
      "fits.plist": infoPlistOfSize(SLOT_SIZE),
      "too-large.plist": infoPlistOfSize(SLOT_SIZE / 2 + 1),
    });
    const cwd = String(dir);
    const template = machoTemplate({ textSections: textWithSlot });
    await Bun.write(join(cwd, "template"), template);
    await Bun.write(join(cwd, "smaller"), machoTemplate({ textSections: textWithHalfSlot }));

    const fits = await build(cwd, [
      ...darwin("arm64", join(cwd, "template"), join(cwd, "fits")),
      "--macos-info-plist",
      "fits.plist",
    ]);
    expect(fits.stderr).not.toContain("error:");
    expect(fits.exitCode).toBe(0);
    expectEmbedded(readFileSync(join(cwd, "fits")), template, Buffer.from(infoPlistOfSize(SLOT_SIZE)));

    const tooLarge = await build(cwd, [
      ...darwin("arm64", join(cwd, "smaller"), join(cwd, "too-large")),
      "--macos-info-plist",
      "too-large.plist",
    ]);
    expect(tooLarge.stderr).toMatch(
      /failed to embed the Info\.plist in ".*smaller": the Info\.plist is 2049 bytes and the section reserved for it holds 2048\n/,
    );
    expect(tooLarge.exitCode).toBe(1);
    // No executable, and no copy of the base left behind.
    expect(readdirSync(cwd).sort()).toEqual([
      "entry.ts",
      "fits",
      "fits.plist",
      "smaller",
      "template",
      "too-large.plist",
    ]);
  });

  // File offset of the `section_64` called `name` in the template's `__TEXT` command, which is its first.
  const sectionHeader = (template: Buffer, name: string) =>
    32 + 72 + textSectionsOf(template).findIndex(s => s.sectname === name) * 80;
  const place = (template: Buffer, header: number, offset: number, size: bigint) => {
    template.writeBigUInt64LE(TEXT_VMADDR + BigInt(offset), header + 32);
    template.writeBigUInt64LE(size, header + 40);
    template.writeUInt32LE(offset, header + 48);
  };

  // The base executable is any file the user names, so what its load commands say is checked before it is used.
  // Without a check, each of these writes the plist over something else and still exits 0.
  test.concurrent.each<[string, (template: Buffer, slot: number) => void, string]>([
    ["reaches past the end of __TEXT", (t, slot) => place(t, slot, 0x3800, 0x1000n), "OffsetOutOfRange"],
    [
      "lies past the end of the file",
      (t, slot) => {
        t.writeBigUInt64LE(0x100000n, 32 + 32); // __TEXT vmsize
        t.writeBigUInt64LE(0x100000n, 32 + 48); // __TEXT filesize
        place(t, slot, 0xa000, 0x1000n);
      },
      "OffsetOutOfRange",
    ],
    [
      "has a size that wraps around",
      (t, slot) => place(t, slot, SLOT_OFFSET, 0xffff_ffff_ffff_ffffn),
      "OffsetOverflow",
    ],
    ["lies in the load commands", (t, slot) => place(t, slot, 0x40, 0x100n), "OffsetOutOfRange"],
    [
      "starts in front of __TEXT",
      t => {
        t.writeBigUInt64LE(0x2000n, 32 + 40); // __TEXT fileoff
        t.writeBigUInt64LE(0x2000n, 32 + 48); // __TEXT filesize
      },
      "OffsetOutOfRange",
    ],
    [
      "has an address that is not its file offset",
      (t, slot) => t.writeBigUInt64LE(TEXT_VMADDR + BigInt(SLOT_OFFSET) + 0x10n, slot + 32),
      "InvalidObject",
    ],
    ["is listed past the end of its load command", t => t.writeUInt32LE(100, 32 + 64), "InvalidObject"],
    ["is in a segment that is not named __TEXT", t => t.write("__TEXT.1", 32 + 8, "latin1"), "InvalidObject"],
    [
      "was filled by an earlier compile and claims less room than it uses",
      (t, slot) => {
        t.write("__info_plist\0\0\0\0", slot, "latin1");
        t.writeUInt32LE(SLOT_SIZE / 2, slot + 76); // reserved3: the room it had
      },
      "OffsetOutOfRange",
    ],
  ])("a reserved section that %s is refused", async (_, corrupt, error) => {
    using dir = tempDir("compile-macos-info-plist-geometry", {
      "entry.ts": `console.log("hi");`,
      "Info.plist": infoPlist,
    });
    const cwd = String(dir);
    const template = machoTemplate({ textSections: textWithSlot });
    corrupt(template, sectionHeader(template, "__bun_plist"));
    await Bun.write(join(cwd, "template"), template);

    const { stderr, exitCode } = await build(cwd, [
      ...darwin("arm64", join(cwd, "template"), join(cwd, "out")),
      "--macos-info-plist",
      "Info.plist",
    ]);
    expect(stderr).toMatch(new RegExp(`failed to embed the Info\\.plist in ".*template": ${error}\n`));
    expect(exitCode).toBe(1);
    expect(readdirSync(cwd).sort()).toEqual(["Info.plist", "entry.ts", "template"]);
  });

  test.concurrent("a base executable without the reserved section is an error", async () => {
    using dir = tempDir("compile-macos-info-plist-no-slot", {
      "entry.ts": `console.log("hi");`,
      "Info.plist": infoPlist,
    });
    const cwd = String(dir);
    // What a bun from before this option looks like: no `__TEXT,__bun_plist`.
    await Bun.write(
      join(cwd, "template"),
      machoTemplate({ textSections: [{ name: "__text", offset: 0x400, size: 0x100 }] }),
    );

    const { stderr, exitCode } = await build(cwd, [
      ...darwin("arm64", join(cwd, "template"), join(cwd, "out")),
      "--macos-info-plist",
      "Info.plist",
    ]);
    expect(stderr).toMatch(
      /failed to embed the Info\.plist in ".*template": it has no `__bun_plist` section in its `__TEXT` segment\. Bun for macOS reserves that section for an Info\.plist; an older Bun does not have it\n/,
    );
    expect(exitCode).toBe(1);
    expect(readdirSync(cwd).sort()).toEqual(["Info.plist", "entry.ts", "template"]);
  });

  // The Info.plist of a compiled executable describes that executable. A program compiled from it (a compiled app
  // that calls `Bun.build({ compile })`, or `--compile-executable-path`) gets the Info.plist it asks for or none:
  // either way the bytes are those of a compile from a plain bun.
  test.concurrent("a compiled executable used as the base does not pass its Info.plist on", async () => {
    using dir = tempDir("compile-macos-info-plist-compiled-base", {
      "entry.ts": `console.log("hi");`,
      "first.plist": infoPlist,
      "second.plist": infoPlistOfSize(SLOT_SIZE),
    });
    const cwd = String(dir);
    const template = machoTemplate({ textSections: textWithSlot });
    await Bun.write(join(cwd, "template"), template);
    const into = (base: string, out: string, ...plist: string[]) =>
      build(cwd, [...darwin("arm64", join(cwd, base), join(cwd, out)), ...plist]);
    const built = { stdout: expect.any(String), stderr: expect.not.stringContaining("error:"), exitCode: 0 };

    expect(await into("template", "first/out", "--macos-info-plist", "first.plist")).toEqual(built);
    expect(
      await Promise.all([
        into("first/out", "none/out"),
        into("template", "plain/out"),
        into("first/out", "second/out", "--macos-info-plist", "second.plist"),
        into("template", "direct/out", "--macos-info-plist", "second.plist"),
      ]),
    ).toEqual([built, built, built, built]);
    const read = (name: string) => readFileSync(join(cwd, name, "out"));

    expectEmbedded(read("first"), template, Buffer.from(infoPlist));
    expect(textSectionsOf(read("none"))).toEqual(textSectionsOf(template));
    expect(read("none").equals(read("plain"))).toBe(true);
    // The whole reserved section is available again, not only the bytes the first plist used.
    expectEmbedded(read("second"), template, Buffer.from(infoPlistOfSize(SLOT_SIZE)));
    expect(read("second").equals(read("direct"))).toBe(true);
  });

  test.concurrent("an Info.plist that the linker put in the base is not replaced", async () => {
    const linked = Buffer.from(infoPlistOfSize(512));
    using dir = tempDir("compile-macos-info-plist-linked", {
      "entry.ts": `console.log("hi");`,
      "Info.plist": infoPlist,
    });
    const cwd = String(dir);
    // `ld -sectcreate __TEXT __info_plist`: the section is exactly as long as the file, and other content follows.
    // The reserved section is there too, as in a bun that was linked with an Info.plist of its own.
    const template = machoTemplate({
      textSections: [{ name: "__info_plist", offset: 0x800, size: linked.length }, ...textWithSlot.slice(1)],
    });
    linked.copy(template, 0x800);
    await Bun.write(join(cwd, "template"), template);

    const [kept, refused] = await Promise.all([
      build(cwd, darwin("arm64", join(cwd, "template"), join(cwd, "kept"))),
      build(cwd, [...darwin("arm64", join(cwd, "template"), join(cwd, "refused")), "--macos-info-plist", "Info.plist"]),
    ]);

    // It is the base's own, so without the option it stays.
    expect(kept.stderr).not.toContain("error:");
    expect(kept.exitCode).toBe(0);
    const keptBytes = readFileSync(join(cwd, "kept"));
    expect(textSectionsOf(keptBytes)).toEqual(textSectionsOf(template));
    expect(keptBytes.subarray(0x800, 0x4000).equals(template.subarray(0x800, 0x4000))).toBe(true);

    // macOS reads the first `__info_plist`, so filling the reserved section would not make it the Info.plist.
    expect(refused.stderr).toMatch(
      /failed to embed the Info\.plist in ".*template": it already has an `__info_plist` section that `bun build --compile` did not write\n/,
    );
    expect(refused.exitCode).toBe(1);
    expect(readdirSync(cwd).sort()).toEqual(["Info.plist", "entry.ts", "kept", "template"]);
  });

  // The option is checked when the arguments are parsed, before the base executable is read. Every case still names
  // one, so that a build which does not know the flag never goes looking for a bun to download.
  test.concurrent.each([
    ["without --compile", [], ["--macos-info-plist", "Info.plist"], "--macos-info-plist requires --compile"],
    [
      "with a target that is not macOS",
      ["--compile", "--target=bun-linux-x64"],
      ["--macos-info-plist", "Info.plist"],
      "--macos-info-plist requires a macOS compile target",
    ],
    [
      "with a file that does not exist",
      ["--compile", "--target=bun-darwin-arm64"],
      ["--macos-info-plist", "missing.plist"],
      'failed to read the Info.plist "missing.plist": ENOENT',
    ],
    [
      "with a file that is not a property list",
      ["--compile", "--target=bun-darwin-arm64"],
      ["--macos-info-plist", "Info.json"],
      `"Info.json" is not an Info.plist: it is not an XML or binary property list: Expected the root element but found '{'`,
    ],
    [
      "with a property list whose root is not a dictionary",
      ["--compile", "--target=bun-darwin-arm64"],
      ["--macos-info-plist", "array.plist"],
      '"array.plist" is not an Info.plist: the root of the property list is not a dictionary',
    ],
    [
      "with a file that is larger than the section a macOS bun reserves",
      ["--compile", "--target=bun-darwin-arm64"],
      ["--macos-info-plist", "too-large.plist"],
      '"too-large.plist" is too large to embed: an Info.plist can be at most 4096 bytes',
    ],
  ])("the flag is refused %s", async (_, compile, flag, message) => {
    using dir = tempDir("compile-macos-info-plist-refused", {
      "entry.ts": `console.log("hi");`,
      "Info.plist": infoPlist,
      "Info.json": JSON.stringify({ CFBundleIdentifier: "com.example.myapp" }),
      "array.plist": `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<array/>\n</plist>\n`,
      "too-large.plist": infoPlistOfSize(SLOT_SIZE + 1),
    });
    const cwd = String(dir);
    await Bun.write(join(cwd, "template"), machoTemplate({ textSections: textWithSlot }));
    const base = compile.length > 0 ? ["--compile-executable-path", join(cwd, "template")] : [];

    const { stderr, exitCode } = await build(cwd, [...compile, ...base, ...flag, "--outfile", join(cwd, "out")]);
    expect(stderr).toContain(message);
    expect(exitCode).toBe(1);
    expect(existsSync(join(cwd, "out"))).toBe(false);
  });

  describe("Bun.build", () => {
    // `compile.macos.infoPlist` for a build that then stops at its missing entry point: the file is read and
    // checked when the options are, so a refused file throws from the call and an accepted one gets this far.
    function check(cwd: string, target: Bun.Build.CompileTarget, macos: unknown) {
      return Bun.build({
        entrypoints: [join(cwd, "missing-entry.ts")],
        compile: { target, outfile: join(cwd, "out"), macos: macos as { infoPlist: string } },
        throw: false,
      });
    }
    const accepted = [expect.stringMatching(/^ModuleNotFound resolving .*missing-entry\.ts/)];

    test.concurrent("compile.macos.infoPlist embeds the file", async () => {
      using dir = tempDir("compile-macos-info-plist-api", {
        "entry.ts": `console.log("hi");`,
        "Info.plist": infoPlist,
      });
      const cwd = String(dir);
      const template = machoTemplate({ textSections: textWithSlot });
      await Bun.write(join(cwd, "template"), template);
      const out = join(cwd, "out");

      const result = await Bun.build({
        entrypoints: [join(cwd, "entry.ts")],
        compile: {
          target: "bun-darwin-arm64",
          executablePath: join(cwd, "template"),
          outfile: out,
          macos: { infoPlist: join(cwd, "Info.plist") },
        },
      });
      expect(result.logs.map(String)).toEqual([]);
      expect(result.success).toBe(true);

      const outBytes = readFileSync(out);
      expectEmbedded(outBytes, template, Buffer.from(infoPlist));
      expect(parseAndVerifySignature(outBytes).mismatches).toStrictEqual([]);
    });

    test.concurrent("the reason an Info.plist cannot be embedded reaches the rejection", async () => {
      using dir = tempDir("compile-macos-info-plist-api-reject", {
        "entry.ts": `console.log("hi");`,
        "Info.plist": infoPlistOfSize(SLOT_SIZE / 2 + 1),
      });
      const cwd = String(dir);
      await Bun.write(join(cwd, "template"), machoTemplate({ textSections: textWithHalfSlot }));
      const out = join(cwd, "out");

      const result = await Bun.build({
        entrypoints: [join(cwd, "entry.ts")],
        compile: {
          target: "bun-darwin-arm64",
          executablePath: join(cwd, "template"),
          outfile: out,
          macos: { infoPlist: join(cwd, "Info.plist") },
        },
        throw: false,
      });
      expect(result.logs.map(log => log.message)).toEqual([
        expect.stringMatching(
          /^failed to embed the Info\.plist in ".*template": the Info\.plist is 2049 bytes and the section reserved for it holds 2048$/,
        ),
      ]);
      expect(result.success).toBe(false);
      expect(existsSync(out)).toBe(false);
    });

    test.concurrent("compile.macos is checked before the build starts", async () => {
      using dir = tempDir("compile-macos-info-plist-api-invalid", {
        "Info.plist": infoPlist,
        "too-large.plist": infoPlistOfSize(SLOT_SIZE + 1),
      });
      const cwd = String(dir);
      const infoPlistPath = join(cwd, "Info.plist");

      expect(() => check(cwd, "bun-darwin-arm64", 1)).toThrow("macos must be an object");
      // Only `undefined` means that the option is absent.
      for (const infoPlist of [1, 0, false, null]) {
        expect(() => check(cwd, "bun-darwin-arm64", { infoPlist })).toThrow(
          'The "compile.macos.infoPlist" property must be of type string. Received ',
        );
      }
      expect(() => check(cwd, "bun-darwin-arm64", { infoPlist: "" })).toThrow(
        'compile.macos.infoPlist: failed to read the Info.plist ""',
      );
      expect(() => check(cwd, "bun-darwin-arm64", { infoPlist: join(cwd, "missing.plist") })).toThrow(
        "compile.macos.infoPlist: failed to read the Info.plist",
      );
      expect(() => check(cwd, "bun-darwin-arm64", { infoPlist: join(cwd, "too-large.plist") })).toThrow(
        'too-large.plist" is too large to embed: an Info.plist can be at most 4096 bytes',
      );
      // The path is the one that was given: it does not end at a NUL.
      expect(() => check(cwd, "bun-darwin-arm64", { infoPlist: infoPlistPath + "\0.json" })).toThrow(
        "The property 'compile.macos.infoPlist' must be a string without null bytes",
      );
      expect((await check(cwd, "bun-darwin-arm64", { infoPlist: infoPlistPath })).logs.map(l => l.message)).toEqual(
        accepted,
      );
      expect((await check(cwd, "bun-darwin-arm64", { infoPlist: undefined })).logs.map(l => l.message)).toEqual(
        accepted,
      );
    });

    // A build script can hand the same `compile` options to every target. `compile.macos` is read and checked for
    // each of them, like `compile.windows.icon`, and goes into the executable only when the target is macOS.
    test.concurrent("compile.macos is checked for a target that is not macOS too", async () => {
      using dir = tempDir("compile-macos-info-plist-api-other-target", {
        "Info.plist": infoPlist,
        "too-large.plist": infoPlistOfSize(SLOT_SIZE + 1),
      });
      const cwd = String(dir);

      expect(() => check(cwd, "bun-linux-x64", 1)).toThrow("macos must be an object");
      expect(() => check(cwd, "bun-linux-x64", { infoPlist: 1 })).toThrow(
        'The "compile.macos.infoPlist" property must be of type string. Received number',
      );
      expect(() => check(cwd, "bun-linux-x64", { infoPlist: join(cwd, "missing.plist") })).toThrow(
        "compile.macos.infoPlist: failed to read the Info.plist",
      );
      expect(() => check(cwd, "bun-linux-x64", { infoPlist: join(cwd, "too-large.plist") })).toThrow(
        'too-large.plist" is too large to embed: an Info.plist can be at most 4096 bytes',
      );
      expect(
        (await check(cwd, "bun-linux-x64", { infoPlist: join(cwd, "Info.plist") })).logs.map(l => l.message),
      ).toEqual(accepted);
    });

    // What macOS takes as an Info.plist is a property list, XML or binary, whose root is a dictionary. `codesign`
    // refuses to sign an executable that embeds anything else, so the file is parsed, not sniffed.
    test.concurrent("the file has to be a property list with a dictionary at its root", async () => {
      const NOT_A_DICTIONARY = "the root of the property list is not a dictionary";
      const NOT_A_PLIST = "it is not an XML or binary property list: ";
      const MALFORMED = "the binary property list is malformed";
      const dict = `<dict><key>CFBundleIdentifier</key><string>com.example.myapp</string></dict>`;
      const cases: Record<string, [content: string | Buffer, expected: string]> = {
        "xml.plist": [infoPlist, "accepted"],
        "no-prolog.plist": [`<plist version="1.0">${dict}</plist>`, "accepted"],
        "comment-and-pi.plist": [`<plist version="1.0"><!-- <array/> --><?note x?>\n${dict}</plist>`, "accepted"],
        "empty-dict.plist": [`<plist><dict/></plist>`, "accepted"],
        "space-in-tag.plist": [`<plist><dict ></dict ></plist>`, "accepted"],
        "bom.plist": [`\uFEFF<?xml version="1.0" encoding="UTF-8"?><plist>${dict}</plist>`, "accepted"],
        "utf16.plist": [
          Buffer.from(`\uFEFF<?xml version="1.0" encoding="UTF-16"?><plist>${dict}</plist>`, "utf16le"),
          "accepted",
        ],
        "bare-dict.plist": [dict, "accepted"],
        "binary.plist": [binaryPlist([EMPTY_DICTIONARY]), "accepted"],
        "binary-top-is-second.plist": [binaryPlist([EMPTY_ARRAY, EMPTY_DICTIONARY], 1), "accepted"],

        "array.plist": [`<plist><array/></plist>`, NOT_A_DICTIONARY],
        "array-of-dict.plist": [`<plist><array>${dict}</array></plist>`, NOT_A_DICTIONARY],
        "string.plist": [`<plist><string>com.example.myapp</string></plist>`, NOT_A_DICTIONARY],
        "dictionary.plist": [`<plist><dictionary/></plist>`, NOT_A_DICTIONARY],
        "two-dicts.plist": [`<plist>${dict}${dict}</plist>`, NOT_A_DICTIONARY],
        "no-root-object.plist": [`<plist version="1.0"/>`, NOT_A_DICTIONARY],
        "comment-then-array.plist": [`<plist><!-- <dict/> --><array/></plist>`, NOT_A_DICTIONARY],
        "other-root.plist": [`<plistfoo>${dict}</plistfoo>`, NOT_A_DICTIONARY],
        "binary-array.plist": [binaryPlist([EMPTY_ARRAY]), NOT_A_DICTIONARY],

        "empty.plist": ["", NOT_A_PLIST + "XML document must have a root element"],
        "json.plist": [
          `{"CFBundleIdentifier":"com.example.myapp"}`,
          NOT_A_PLIST + "Expected the root element but found '{'",
        ],
        "openstep.plist": [
          `{ CFBundleIdentifier = "com.example.myapp"; }`,
          NOT_A_PLIST + "Expected the root element but found '{'",
        ],
        "unclosed.plist": [`<plist><dict>`, NOT_A_PLIST + "Missing closing tag for element 'dict'"],
        "mismatched.plist": [`<plist><dict></plist>`, NOT_A_PLIST + "Expected closing tag </dict> but found </plist>"],
        "unclosed-comment.plist": [`<plist><!-- ${dict}</plist>`, NOT_A_PLIST],
        "trailing-text.plist": [
          `<plist>${dict}</plist>trailing`,
          NOT_A_PLIST + "Unexpected 'trailing' after the root element",
        ],

        "binary-magic-only.plist": [Buffer.from("bplist00"), MALFORMED],
        "binary-garbage.plist": [Buffer.concat([Buffer.from("bplist00"), Buffer.alloc(64, 0x41)]), MALFORMED],
        "binary-trailing-byte.plist": [Buffer.concat([binaryPlist([EMPTY_DICTIONARY]), Buffer.alloc(1)]), MALFORMED],
        "binary-top-out-of-range.plist": [binaryPlist([EMPTY_DICTIONARY], 1), MALFORMED],
      };
      using dir = tempDir(
        "compile-macos-info-plist-api-shape",
        Object.fromEntries(Object.entries(cases).map(([name, [content]]) => [name, content])),
      );
      const cwd = String(dir);

      const results: Record<string, string> = {};
      for (const name of Object.keys(cases)) {
        try {
          const { logs } = await check(cwd, "bun-darwin-arm64", { infoPlist: join(cwd, name) });
          results[name] = logs.length === 1 && logs[0].message.startsWith("ModuleNotFound") ? "accepted" : String(logs);
        } catch (e) {
          results[name] = (e as Error).message.replace(/^compile\.macos\.infoPlist: ".*" is not an Info\.plist: /, "");
        }
      }
      expect(results).toEqual(
        Object.fromEntries(
          Object.entries(cases).map(([name, [, expected]]) => [
            name,
            expected === NOT_A_PLIST ? expect.stringContaining(NOT_A_PLIST) : expected,
          ]),
        ),
      );
    });
  });

  // The tests above drive the Mach-O writer with templates. These check the real thing, where the section comes
  // from bun's own link and macOS is the reader.
  describe.skipIf(!isMacOS)("on macOS", () => {
    test("bun reserves the section and has no Info.plist of its own", () => {
      const fd = openSync(bunExe(), "r");
      try {
        const header = Buffer.alloc(32);
        readSync(fd, header, 0, 32, 0);
        const commands = Buffer.alloc(32 + header.readUInt32LE(20));
        readSync(fd, commands, 0, commands.length, 0);

        const sections = textSectionsOf(commands).filter(
          s => s.sectname === "__bun_plist" || s.sectname === "__info_plist",
        );
        expect(sections.map(({ sectname, segname, size }) => ({ sectname, segname, size }))).toEqual([
          { sectname: "__bun_plist", segname: "__TEXT", size: SLOT_SIZE },
        ]);

        const slot = Buffer.alloc(SLOT_SIZE, 0xff);
        readSync(fd, slot, 0, SLOT_SIZE, sections[0].offset);
        expect(slot.equals(Buffer.alloc(SLOT_SIZE))).toBe(true);
      } finally {
        closeSync(fd);
      }
    });

    test("CoreFoundation reads the embedded Info.plist, and codesign binds it", async () => {
      using dir = tempDir("compile-macos-info-plist-native", {
        // Not `Info.plist`: CoreFoundation also reads a file of that name in the directory of the executable.
        "app.plist": infoPlist,
        // The identifier of the main bundle, which for a program that is not in a bundle comes from the
        // `__TEXT,__info_plist` section of the main executable.
        "entry.ts": `
          import { CString, dlopen, ptr } from "bun:ffi";
          const { symbols: cf } = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
            CFBundleGetMainBundle: { args: [], returns: "ptr" },
            CFBundleGetIdentifier: { args: ["ptr"], returns: "ptr" },
            CFStringGetCString: { args: ["ptr", "ptr", "i64", "u32"], returns: "bool" },
          });
          const identifier = cf.CFBundleGetIdentifier(cf.CFBundleGetMainBundle());
          const buffer = new Uint8Array(256);
          const kCFStringEncodingUTF8 = 0x08000100;
          if (identifier && cf.CFStringGetCString(identifier, buffer, buffer.length, kCFStringEncodingUTF8)) {
            console.log(new CString(ptr(buffer)).toString());
          } else {
            console.log("<no bundle identifier>");
          }
        `,
      });
      const cwd = String(dir);
      const out = join(cwd, "out");
      const plain = join(cwd, "plain");

      const [withPlist, withoutPlist] = await Promise.all([
        build(cwd, ["--compile", "--macos-info-plist", "app.plist", "--outfile", out]),
        build(cwd, ["--compile", "--outfile", plain]),
      ]);
      expect(withPlist.stderr).not.toContain("error:");
      expect(withPlist.exitCode).toBe(0);
      expect(withoutPlist.stderr).not.toContain("error:");
      expect(withoutPlist.exitCode).toBe(0);

      async function run(cmd: string[]) {
        await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      }
      const prints = (identifier: string) => ({ stdout: identifier + "\n", stderr: "", exitCode: 0 });

      expect(await run([plain])).toEqual(prints("<no bundle identifier>"));
      expect(await run([out])).toEqual(prints("com.example.myapp"));

      // A file named Info.plist beside the executable is an Info.plist to CoreFoundation as well. The embedded one
      // is used unless that file names the executable.
      const beside = (directory: string, extraKeys: string) => {
        mkdirSync(join(cwd, directory));
        linkSync(out, join(cwd, directory, "out"));
        writeFileSync(
          join(cwd, directory, "Info.plist"),
          infoPlist.replace("com.example.myapp", "com.example.beside").replace("<dict>", "<dict>" + extraKeys),
        );
        return run([join(cwd, directory, "out")]);
      };
      expect(await beside("unnamed", "")).toEqual(prints("com.example.myapp"));
      expect(await beside("named", "<key>CFBundleExecutable</key><string>out</string>")).toEqual(
        prints("com.example.beside"),
      );

      const describeSignature = async () => (await run(["codesign", "--display", "--verbose=2", out])).stderr;
      if (isArm64) {
        // bun's own ad-hoc signature hashes the plist with the rest of the file, but does not bind it, and its
        // identifier is fixed.
        expect(await run(["codesign", "--verify", out])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
        const signature = await describeSignature();
        expect(signature).toContain("Identifier=a.out\n");
        expect(signature).toContain("Info.plist=not bound\n");
      }
      // Signing with codesign binds it, and takes the identifier from CFBundleIdentifier.
      expect((await run(["codesign", "--force", "--sign", "-", out])).exitCode).toBe(0);
      expect(await run(["codesign", "--verify", out])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      const signature = await describeSignature();
      expect(signature).toContain("Identifier=com.example.myapp\n");
      expect(signature).toContain("Info.plist entries=2\n");
      expect(await run([out])).toEqual(prints("com.example.myapp"));
    }, 60_000);
  });
});
