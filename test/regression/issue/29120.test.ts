// `bun build --compile --target=bun-darwin-arm64` must produce a mach-o binary
// whose `LC_CODE_SIGNATURE.datasize` matches the actual signature blob bun's
// in-process `MachoSigner` writes. Previously, `writeSection` in `src/macho.zig`
// grew the LINKEDIT segment by just `num_new_pages * HASH_SIZE`, but `MachoSigner`
// computes its SuperBlob size from the page count up to the (shifted) signature
// offset — which differs from the template's original signature layout. The
// resulting file had `datasize < SuperBlob.length`, which macOS (SIP/dyld) then
// rejects with "code object is not signed at all" and kills the process.
//
// This test runs only on darwin-arm64 hosts, where the current bun binary
// IS the cross-compile template (isDefault() in src/compile_target.zig), so
// the real MachoSigner path executes without any network. On every other
// host the template must be downloaded from npm for the canary version
// under test, and whether that download 404s, fetches-from-cache, or
// fetches-from-network depends on the CI runner's state — which made the
// test flaky on Linux aarch64 (alpine/ubuntu skipped silently via the 404
// path, debian-13 occasionally hit a stale cache and tripped on an
// unrelated download edge case). The darwin-arm64 lanes give us reliable
// regression coverage of the actual mach-o writer change.
//
// https://github.com/oven-sh/bun/issues/29120

import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isArm64, isMacOS, tempDir } from "harness";
import { join } from "path";

// Mach-O load command ID we care about.
const LC_CODE_SIGNATURE = 0x1d;

// Embedded signature magic (big-endian on disk).
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;

type CodeSig = {
  dataoff: number;
  datasize: number;
  superBlobMagic: number;
  superBlobLength: number;
};

// Read the LC_CODE_SIGNATURE load command and the SuperBlob it points at.
// Assumes a little-endian 64-bit mach-o (what --target=bun-darwin-arm64 emits).
// All offsets are validated against `buf.length` so a malformed/truncated
// binary surfaces as `null`, never as an OOB read or infinite loop on a
// zero `cmdsize`.
function readCodeSignature(buf: Buffer): CodeSig | null {
  // mach_header_64: magic(4) cputype(4) cpusubtype(4) filetype(4)
  //                 ncmds(4)  sizeofcmds(4) flags(4) reserved(4)
  if (buf.length < 32) return null;
  const magic = buf.readUInt32LE(0);
  if (magic !== 0xfeedfacf) return null; // MH_MAGIC_64
  const ncmds = buf.readUInt32LE(16);

  let p = 32; // end of mach_header_64
  for (let i = 0; i < ncmds; i++) {
    if (p + 8 > buf.length) return null;
    const cmd = buf.readUInt32LE(p);
    const cmdsize = buf.readUInt32LE(p + 4);
    if (cmdsize < 8 || p + cmdsize > buf.length) return null;
    if (cmd === LC_CODE_SIGNATURE) {
      // linkedit_data_command: cmd(4) cmdsize(4) dataoff(4) datasize(4)
      if (cmdsize < 16) return null;
      const dataoff = buf.readUInt32LE(p + 8);
      const datasize = buf.readUInt32LE(p + 12);
      // The region the header advertises must be physically present on disk —
      // a truncated signature would otherwise pass the SuperBlob checks below.
      if (dataoff + datasize > buf.length) return null;
      // SuperBlob: magic(4 BE) length(4 BE) count(4 BE)
      if (dataoff + 12 > buf.length) return null;
      const superBlobMagic = buf.readUInt32BE(dataoff);
      const superBlobLength = buf.readUInt32BE(dataoff + 4);
      // And the SuperBlob itself must fit in the file.
      if (superBlobLength < 12 || dataoff + superBlobLength > buf.length) return null;
      return { dataoff, datasize, superBlobMagic, superBlobLength };
    }
    p += cmdsize;
  }
  return null;
}

// Two bundle sizes:
//  - "tiny"  fits inside the template's 16 KiB __BUN slot → size_diff == 0 in
//    macho.zig (the linkedit/datasize resize must not be gated on size_diff)
//  - "large" exceeds 16 KiB → size_diff > 0, exercises the offset-shift path
const bundles = {
  tiny: `console.log("hi from cross-compiled bun");`,
  large: `console.log("${Buffer.alloc(32 * 1024, "a").toString()}");`,
};

// darwin-arm64 only: on darwin-x64 the arm64 template must still be downloaded
// from npm and canary builds don't have it published, bringing back the same
// fetcher-flakiness the skip was supposed to eliminate.
test.skipIf(!isMacOS || !isArm64).each(Object.entries(bundles))(
  "bun build --compile --target=bun-darwin-arm64 produces a valid code signature (%s bundle)",
  async (label, source) => {
    using dir = tempDir(`issue-29120-${label}`, {
      "app.ts": source,
    });
    const cwd = String(dir);
    const out = join(cwd, "app-darwin-arm64");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--target=bun-darwin-arm64", join(cwd, "app.ts"), "--outfile", out],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Always dump stdout+stderr: failures on CI runners are invisible without
    // this, and the logs are tiny.
    console.error(`[29120 ${label}] build exit=${exitCode}`);
    if (stdout.length) console.error(`[29120 ${label}] stdout:\n${stdout}`);
    if (stderr.length) console.error(`[29120 ${label}] stderr:\n${stderr}`);

    expect(exitCode).toBe(0);

    const buf = readFileSync(out);
    const sig = readCodeSignature(buf);
    console.error(
      `[29120 ${label}] file=${buf.length} sig=${sig ? JSON.stringify({ ...sig, superBlobMagicHex: "0x" + sig.superBlobMagic.toString(16) }) : "null"}`,
    );
    expect(sig).not.toBeNull();
    if (!sig) return;

    // 1. The magic at `dataoff` must be a valid embedded-signature SuperBlob.
    expect(sig.superBlobMagic).toBe(CSMAGIC_EMBEDDED_SIGNATURE);

    // 2. The size the header advertises must be at least as big as the actual
    //    SuperBlob — this is the exact regression from #29120 where
    //    `LC_CODE_SIGNATURE.datasize` (197,488) was smaller than
    //    `SuperBlob.length` (537,138) and macOS killed the process on startup.
    expect(sig.datasize).toBeGreaterThanOrEqual(sig.superBlobLength);
  },
);
