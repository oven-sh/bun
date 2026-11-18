// https://github.com/oven-sh/bun/issues/32159 — the ad-hoc signer must hash the last partial page unpadded and end the file at the signature.

import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isArm64, isMacOS, tempDir } from "harness";
import { createHash } from "node:crypto";
import { join } from "path";
import { machoTemplate } from "./executable-templates";

const MH_MAGIC_64 = 0xfeedfacf;
const LC_CODE_SIGNATURE = 0x1d;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSSLOT_CODEDIRECTORY = 0;
const PAGE_SIZE = 0x1000;

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
