// `bun build --compile` for darwin-arm64 ad-hoc signs the output in-process
// (MachoSigner in src/exe_format/macho.rs). Apple's verifier hashes the final
// partial page of the code region truncated to `codeLimit % pageSize` bytes,
// NOT zero-padded to a full page, so the signer must do the same. Padding the
// last page produced a wrong hash in the last CodeDirectory slot: `codesign -v`
// reported "invalid signature (code or signature have been modified)" and the
// macOS 27 beta kills such binaries on launch.
// https://github.com/oven-sh/bun/issues/32159
//
// The cross-platform tests below build a minimal synthetic arm64 Mach-O
// template (same approach as the --compile-executable-path test in
// bundler_compile.test.ts) so the signer runs hermetically on every host with
// no template download, then re-derive every page hash the way Apple does and
// compare against the stored CodeDirectory slots.

import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isArm64, isMacOS, tempDir } from "harness";
import { createHash } from "node:crypto";
import { join } from "path";

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;
const MH_EXECUTE = 2;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSSLOT_CODEDIRECTORY = 0;
const PAGE_SIZE = 0x1000;

// Where the template claims its existing code signature starts. Deliberately
// NOT page-aligned (0x100 bytes into a page): `codeLimit` of the re-signed
// output equals this offset (plus any section-growth shift, which is
// page-aligned), so the final hashed page is a partial one — the case the bug
// corrupts. Real bun templates are never page-aligned here either.
const TEMPLATE_SIG_OFF = 0x8100;

// Minimal arm64 Mach-O "base executable": __TEXT, a __BUN segment with one
// 16 KiB __bun section, and __LINKEDIT whose tail is an LC_CODE_SIGNATURE
// region. That is everything MachoFile::write_section and MachoSigner need.
function machoTemplate(): Buffer {
  const fileSize = 0x8200;
  const segCmdSize = 72; // sizeof(segment_command_64)
  const sectSize = 80; // sizeof(section_64)
  const sigCmdSize = 16; // sizeof(linkedit_data_command)
  const sizeofcmds = segCmdSize + (segCmdSize + sectSize) + segCmdSize + sigCmdSize;

  // Non-zero fill so pages (especially the partial last one) hash real content.
  const buf = Buffer.alloc(fileSize, 0xc3);
  const writeName = (off: number, name: string) => {
    buf.fill(0, off, off + 16);
    buf.write(name, off, 16, "latin1");
  };

  // mach_header_64
  buf.writeUInt32LE(MH_MAGIC_64, 0);
  buf.writeInt32LE(CPU_TYPE_ARM64, 4);
  buf.writeInt32LE(0, 8); // cpusubtype
  buf.writeUInt32LE(MH_EXECUTE, 12);
  buf.writeUInt32LE(4, 16); // ncmds
  buf.writeUInt32LE(sizeofcmds, 20);
  buf.writeUInt32LE(0, 24); // flags
  buf.writeUInt32LE(0, 28); // reserved

  // LC_SEGMENT_64 __TEXT [0, 0x4000)
  let o = 32;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize, o + 4);
  writeName(o + 8, "__TEXT");
  buf.writeBigUInt64LE(0x1_0000_0000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(0x4000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0n, o + 40); // fileoff
  buf.writeBigUInt64LE(0x4000n, o + 48); // filesize
  buf.writeInt32LE(5, o + 56); // maxprot r-x
  buf.writeInt32LE(5, o + 60); // initprot
  buf.writeUInt32LE(0, o + 64); // nsects

  // LC_SEGMENT_64 __BUN [0x4000, 0x8000) with one __bun section
  o += segCmdSize;
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

  // LC_SEGMENT_64 __LINKEDIT [0x8000, 0x8200); the last 0x100 bytes are the
  // template's signature region (TEMPLATE_SIG_OFF..fileSize).
  o += sectSize;
  buf.writeUInt32LE(LC_SEGMENT_64, o);
  buf.writeUInt32LE(segCmdSize, o + 4);
  writeName(o + 8, "__LINKEDIT");
  buf.writeBigUInt64LE(0x1_0000_8000n, o + 24); // vmaddr
  buf.writeBigUInt64LE(0x1000n, o + 32); // vmsize
  buf.writeBigUInt64LE(0x8000n, o + 40); // fileoff
  buf.writeBigUInt64LE(0x200n, o + 48); // filesize
  buf.writeInt32LE(1, o + 56); // maxprot r--
  buf.writeInt32LE(1, o + 60); // initprot
  buf.writeUInt32LE(0, o + 64); // nsects

  // LC_CODE_SIGNATURE (linkedit_data_command)
  o += segCmdSize;
  buf.writeUInt32LE(LC_CODE_SIGNATURE, o);
  buf.writeUInt32LE(sigCmdSize, o + 4);
  buf.writeUInt32LE(TEMPLATE_SIG_OFF, o + 8); // dataoff
  buf.writeUInt32LE(fileSize - TEMPLATE_SIG_OFF, o + 12); // datasize

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

// Parse LC_CODE_SIGNATURE -> SuperBlob -> CodeDirectory out of a little-endian
// 64-bit Mach-O and recompute every code slot hash the way Apple's verifier
// does: SHA-256 over each 4096-byte page of [0, codeLimit), where the final
// page is truncated to `codeLimit % pageSize` bytes (not zero-padded).
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

// Two bundle sizes (mirrors test/regression/issue/29120.test.ts):
//  - "tiny" fits in the template's 16 KiB __BUN slot -> size_diff == 0, the
//    signature offset stays at TEMPLATE_SIG_OFF
//  - "large" exceeds the slot -> __LINKEDIT and LC_CODE_SIGNATURE.dataoff are
//    shifted forward by a page-aligned amount
// Either way codeLimit stays page-misaligned, so the last page is partial.
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

    const sig = parseAndVerifySignature(readFileSync(out));
    expect(sig.superBlobMagic).toBe(CSMAGIC_EMBEDDED_SIGNATURE);
    expect(sig.cdMagic).toBe(CSMAGIC_CODEDIRECTORY);
    expect(sig.hashType).toBe(2); // SHA-256
    expect(sig.hashSize).toBe(32);
    expect(1 << sig.pageSizeLog2).toBe(PAGE_SIZE);

    // codeLimit covers everything before the signature blob.
    expect(sig.codeLimit).toBe(sig.dataoff);
    expect(sig.nCodeSlots).toBe(Math.ceil(sig.codeLimit / PAGE_SIZE));
    // Guard: this layout must exercise a partial final page, else the test
    // cannot catch last-page padding bugs.
    expect(sig.codeLimit % PAGE_SIZE).not.toBe(0);

    // Every stored slot hash matches the hash Apple's verifier computes.
    // Before the fix exactly the last slot mismatched: it was the SHA-256 of
    // the partial page zero-padded to 4096 bytes.
    expect(sig.mismatches).toEqual([]);
  },
);

// On a darwin-arm64 host the running executable itself is the compile template
// (no download), and codesign(1) is the authoritative verifier — this is the
// exact repro from the issue.
test.skipIf(!isMacOS || !isArm64)("codesign verifies a natively compiled executable", async () => {
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
  // codesign --verify is silent on success; on the unfixed signer it printed
  // "invalid signature (code or signature have been modified)" and exited 1.
  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
