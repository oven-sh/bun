// https://github.com/oven-sh/bun/issues/32159 — the ad-hoc signer must hash the last partial page unpadded and end the file at the signature.

import { describe, expect, test } from "bun:test";
import { closeSync, existsSync, openSync, readFileSync, readSync } from "fs";
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

  // `{}` as a binary property list: magic, one empty dictionary, a one-entry offset table, the 32-byte trailer.
  const binaryPlist = Buffer.concat([
    Buffer.from("bplist00"),
    Buffer.from([0xd0]), // object 0: dictionary with 0 entries
    Buffer.from([0x08]), // offset table: object 0 is at offset 8
    Buffer.from([0, 0, 0, 0, 0, 0, 1, 1]), // unused[6], offsetIntSize, objectRefSize
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), // numObjects
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]), // topObject
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 9]), // offsetTableOffset
  ]);

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
    // The rest of the reserved room stays zero, so a later compile can use all of it again.
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
      // bun signs arm64 output itself. The signature covers the plist bytes and keeps its shape (no special slots).
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
    using dir = tempDir("compile-macos-info-plist-binary", {
      "entry.ts": `console.log("hi");`,
      "Info.plist": binaryPlist,
    });
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
    expectEmbedded(readFileSync(out), template, binaryPlist);
  });

  test.concurrent("the reserved section's size is the limit", async () => {
    using dir = tempDir("compile-macos-info-plist-limit", {
      "entry.ts": `console.log("hi");`,
      "fits.plist": infoPlistOfSize(SLOT_SIZE),
      "too-large.plist": infoPlistOfSize(SLOT_SIZE + 1),
    });
    const cwd = String(dir);
    const template = machoTemplate({ textSections: textWithSlot });
    await Bun.write(join(cwd, "template"), template);

    const fits = await build(cwd, [
      ...darwin("arm64", join(cwd, "template"), join(cwd, "fits")),
      "--macos-info-plist",
      "fits.plist",
    ]);
    expect(fits.stderr).not.toContain("error:");
    expect(fits.exitCode).toBe(0);
    expectEmbedded(readFileSync(join(cwd, "fits")), template, Buffer.from(infoPlistOfSize(SLOT_SIZE)));

    const tooLarge = await build(cwd, [
      ...darwin("arm64", join(cwd, "template"), join(cwd, "too-large")),
      "--macos-info-plist",
      "too-large.plist",
    ]);
    expect(tooLarge.stderr).toContain(
      "failed to embed the Info.plist: the Info.plist is 4097 bytes, but the base Bun executable reserves 4096 bytes for it",
    );
    expect(tooLarge.exitCode).toBe(1);
    expect(existsSync(join(cwd, "too-large"))).toBe(false);
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
    const out = join(cwd, "out");

    const { stderr, exitCode } = await build(cwd, [
      ...darwin("arm64", join(cwd, "template"), out),
      "--macos-info-plist",
      "Info.plist",
    ]);
    expect(stderr).toContain(
      "failed to embed the Info.plist: the base Bun executable has no section reserved for an Info.plist",
    );
    expect(exitCode).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  test.concurrent("a compiled executable used as the base keeps its plist, or takes a new one", async () => {
    using dir = tempDir("compile-macos-info-plist-refill", {
      "entry.ts": `console.log("hi");`,
      "first.plist": infoPlist,
      "second.plist": infoPlistOfSize(SLOT_SIZE),
    });
    const cwd = String(dir);
    const template = machoTemplate({ textSections: textWithSlot });
    await Bun.write(join(cwd, "template"), template);

    const first = await build(cwd, [
      ...darwin("arm64", join(cwd, "template"), join(cwd, "first")),
      "--macos-info-plist",
      "first.plist",
    ]);
    expect(first.stderr).not.toContain("error:");
    expect(first.exitCode).toBe(0);

    const [inherited, replaced] = await Promise.all([
      build(cwd, darwin("arm64", join(cwd, "first"), join(cwd, "inherited"))),
      build(cwd, [...darwin("arm64", join(cwd, "first"), join(cwd, "replaced")), "--macos-info-plist", "second.plist"]),
    ]);
    expect(inherited.stderr).not.toContain("error:");
    expect(inherited.exitCode).toBe(0);
    expectEmbedded(readFileSync(join(cwd, "inherited")), template, Buffer.from(infoPlist));

    // The whole reserved section is available again, not only the bytes the first plist used.
    expect(replaced.stderr).not.toContain("error:");
    expect(replaced.exitCode).toBe(0);
    const replacedBytes = readFileSync(join(cwd, "replaced"));
    expectEmbedded(replacedBytes, template, Buffer.from(infoPlistOfSize(SLOT_SIZE)));
    expect(parseAndVerifySignature(replacedBytes).mismatches).toStrictEqual([]);
  });

  test.concurrent("an Info.plist the linker put there is replaced only within its own bytes", async () => {
    const linked = Buffer.from(infoPlistOfSize(512));
    using dir = tempDir("compile-macos-info-plist-linked", {
      "entry.ts": `console.log("hi");`,
      "same-size.plist": infoPlistOfSize(512).replace("Padding", "Changed"),
      "larger.plist": infoPlistOfSize(513),
    });
    const cwd = String(dir);
    // `ld -sectcreate __TEXT __info_plist`: the section is exactly as long as the file, and other content follows.
    const template = machoTemplate({
      textSections: [{ name: "__info_plist", offset: SLOT_OFFSET, size: linked.length }],
    });
    linked.copy(template, SLOT_OFFSET);
    await Bun.write(join(cwd, "template"), template);

    const [sameSize, larger] = await Promise.all([
      build(cwd, [
        ...darwin("arm64", join(cwd, "template"), join(cwd, "same-size")),
        "--macos-info-plist",
        "same-size.plist",
      ]),
      build(cwd, [
        ...darwin("arm64", join(cwd, "template"), join(cwd, "larger")),
        "--macos-info-plist",
        "larger.plist",
      ]),
    ]);

    expect(sameSize.stderr).not.toContain("error:");
    expect(sameSize.exitCode).toBe(0);
    const sameSizeBytes = readFileSync(join(cwd, "same-size"));
    expect(textSectionsOf(sameSizeBytes)).toEqual([section("__info_plist", SLOT_OFFSET, 512)]);
    expect(sameSizeBytes.toString("latin1", SLOT_OFFSET, SLOT_OFFSET + 512)).toBe(
      infoPlistOfSize(512).replace("Padding", "Changed"),
    );
    // The bytes behind it belong to something else.
    expect(sameSizeBytes.subarray(SLOT_OFFSET + 512, 0x4000).equals(template.subarray(SLOT_OFFSET + 512, 0x4000))).toBe(
      true,
    );

    expect(larger.stderr).toContain(
      "the Info.plist is 513 bytes, but the base Bun executable reserves 512 bytes for it",
    );
    expect(larger.exitCode).toBe(1);
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
      '"Info.json" is not an Info.plist: expected an XML or binary property list with a dictionary at its root',
    ],
    [
      "with a property list whose root is not a dictionary",
      ["--compile", "--target=bun-darwin-arm64"],
      ["--macos-info-plist", "array.plist"],
      '"array.plist" is not an Info.plist: expected an XML or binary property list with a dictionary at its root',
    ],
  ])("the flag is refused %s", async (_, compile, flag, message) => {
    using dir = tempDir("compile-macos-info-plist-refused", {
      "entry.ts": `console.log("hi");`,
      "Info.plist": infoPlist,
      "Info.json": JSON.stringify({ CFBundleIdentifier: "com.example.myapp" }),
      "array.plist": `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<array/>\n</plist>\n`,
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
        "Info.plist": infoPlistOfSize(SLOT_SIZE + 1),
      });
      const cwd = String(dir);
      await Bun.write(join(cwd, "template"), machoTemplate({ textSections: textWithSlot }));
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
        "failed to embed the Info.plist: the Info.plist is 4097 bytes, but the base Bun executable reserves 4096 bytes for it",
      ]);
      expect(result.success).toBe(false);
      expect(existsSync(out)).toBe(false);
    });

    test.concurrent("compile.macos is validated before the build starts", async () => {
      using dir = tempDir("compile-macos-info-plist-api-invalid", {
        "entry.ts": `console.log("hi");`,
        "Info.json": JSON.stringify({ CFBundleIdentifier: "com.example.myapp" }),
      });
      const cwd = String(dir);
      await Bun.write(join(cwd, "template"), machoTemplate({ textSections: textWithSlot }));
      const compile = (macos: any) =>
        Bun.build({
          entrypoints: [join(cwd, "entry.ts")],
          compile: {
            target: "bun-darwin-arm64",
            executablePath: join(cwd, "template"),
            outfile: join(cwd, "out"),
            macos,
          },
        });

      expect(() => compile(1)).toThrow("macos must be an object");
      expect(() => compile({ infoPlist: 1 })).toThrow(
        'The "compile.macos.infoPlist" property must be of type string. Received number',
      );
      expect(() => compile({ infoPlist: join(cwd, "missing.plist") })).toThrow(
        "compile.macos.infoPlist: failed to read the Info.plist",
      );
      expect(() => compile({ infoPlist: join(cwd, "Info.json") })).toThrow(
        "is not an Info.plist: expected an XML or binary property list with a dictionary at its root",
      );
      expect(existsSync(join(cwd, "out"))).toBe(false);
    });

    test.concurrent("compile.macos has no effect when the target is not macOS", async () => {
      using dir = tempDir("compile-macos-info-plist-api-other-target", {});
      const cwd = String(dir);

      // Only a macOS executable can take an Info.plist, so for another target the file is not read. The build gets
      // as far as its entry point, which is missing so that no executable is needed to show it.
      const result = await Bun.build({
        entrypoints: [join(cwd, "missing-entry.ts")],
        compile: {
          target: "bun-linux-x64",
          outfile: join(cwd, "out"),
          macos: { infoPlist: join(cwd, "missing.plist") },
        },
        throw: false,
      });
      expect(result.logs.map(log => log.message)).toEqual([
        expect.stringMatching(/^ModuleNotFound resolving .*missing-entry\.ts/),
      ]);
    });
  });

  // The tests above drive the Mach-O writer with templates. These two check the real thing, where the section comes
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

    test("the compiled program is its own main bundle, and codesign seals the plist", async () => {
      using dir = tempDir("compile-macos-info-plist-native", {
        "Info.plist": infoPlist,
        // CoreFoundation reads the main executable's `__TEXT,__info_plist` when the program is not in a bundle.
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

      const built = await build(cwd, ["--compile", "--macos-info-plist", "Info.plist", "--outfile", out]);
      expect(built.stderr).not.toContain("error:");
      expect(built.exitCode).toBe(0);

      async function run(cmd: string[]) {
        await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      }

      expect(await run([out])).toEqual({ stdout: "com.example.myapp\n", stderr: "", exitCode: 0 });

      // bun's own ad-hoc signature (arm64) is valid but does not cover the plist. Signing with codesign does, and
      // takes the identifier from CFBundleIdentifier.
      if (isArm64) expect(await run(["codesign", "--verify", out])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      expect((await run(["codesign", "--force", "--sign", "-", out])).exitCode).toBe(0);
      expect(await run(["codesign", "--verify", out])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      const described = await run(["codesign", "--display", "--verbose=2", out]);
      expect(described.stderr).toContain("Identifier=com.example.myapp\n");
      expect(described.stderr).toContain("Info.plist entries=2\n");
      expect(described.exitCode).toBe(0);

      expect(await run([out])).toEqual({ stdout: "com.example.myapp\n", stderr: "", exitCode: 0 });
    }, 60_000);
  });
});
