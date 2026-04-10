// `bun build --compile --target=bun-darwin-arm64` must produce a mach-o binary
// whose `LC_CODE_SIGNATURE.datasize` matches the actual signature blob bun's
// in-process `MachoSigner` writes. Previously, `writeSection` in `src/macho.zig`
// grew the LINKEDIT segment by just `num_new_pages * HASH_SIZE`, but `MachoSigner`
// computes its SuperBlob size from the page count up to the (shifted) signature
// offset — which differs from the template's original signature layout. The
// resulting file had `datasize < SuperBlob.length`, which macOS (SIP/dyld) then
// rejects with "code object is not signed at all" and kills the process.
//
// https://github.com/oven-sh/bun/issues/29120

import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Mach-O load command IDs we care about.
const LC_SEGMENT_64 = 0x19;
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
      // SuperBlob: magic(4 BE) length(4 BE) count(4 BE)
      if (dataoff + 8 > buf.length) return null;
      const superBlobMagic = buf.readUInt32BE(dataoff);
      const superBlobLength = buf.readUInt32BE(dataoff + 4);
      return { dataoff, datasize, superBlobMagic, superBlobLength };
    }
    p += cmdsize;
  }
  return null;
}

// Sanity: __LINKEDIT must extend at least through the signature the header
// claims. A truncated file where LINKEDIT ends before dataoff+datasize means
// the cross-compile produced a binary macOS will refuse.
function linkeditCoversSignature(buf: Buffer, sig: CodeSig): boolean {
  if (buf.length < 32) return false;
  const ncmds = buf.readUInt32LE(16);
  let p = 32;
  for (let i = 0; i < ncmds; i++) {
    if (p + 8 > buf.length) return false;
    const cmd = buf.readUInt32LE(p);
    const cmdsize = buf.readUInt32LE(p + 4);
    if (cmdsize < 8 || p + cmdsize > buf.length) return false;
    if (cmd === LC_SEGMENT_64) {
      // segment_command_64 layout:
      //   cmd(4)  cmdsize(4)  segname[16]  vmaddr(8)  vmsize(8)  fileoff(8)  filesize(8) ...
      //   |0      |4          |8           |24        |32        |40         |48
      if (cmdsize < 56) return false;
      const segname = buf
        .subarray(p + 8, p + 8 + 16)
        .toString("ascii")
        .replace(/\0+$/, "");
      if (segname === "__LINKEDIT") {
        const fileoff = Number(buf.readBigUInt64LE(p + 40));
        const filesize = Number(buf.readBigUInt64LE(p + 48));
        return sig.dataoff + sig.datasize <= fileoff + filesize;
      }
    }
    p += cmdsize;
  }
  return false;
}

// Two bundle sizes:
//  - "tiny"  fits inside the template's 16 KiB __BUN slot → size_diff == 0 in
//    macho.zig (the linkedit/datasize resize must not be gated on size_diff)
//  - "large" exceeds 16 KiB → size_diff > 0, exercises the offset-shift path
const bundles = {
  tiny: `console.log("hi from cross-compiled bun");`,
  large: `console.log("${Buffer.alloc(32 * 1024, "a").toString()}");`,
};

test.each(Object.entries(bundles))(
  "bun build --compile --target=bun-darwin-arm64 produces a valid code signature (%s bundle) (#29120)",
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
    void stdout;

    // If the cross-compile target can't be downloaded (e.g. this PR's build
    // hasn't been published to npm yet, or the CI runner is offline), skip
    // rather than fail — this test is about the mach-o writer, not the
    // fetcher. A successful build is a prerequisite.
    //
    // The error strings below match the `error.TargetNotFound` / `NetworkError`
    // / `UnsupportedTarget` paths in `src/StandaloneModuleGraph.zig` and
    // `src/compile_target.zig`. On macOS hosts the target is usually the local
    // bun binary (no download) so the test runs inline; on Linux/Windows PR
    // builds, the download 404s and we skip.
    if (exitCode !== 0) {
      const looksLikeDownloadFailure =
        /Does this target and version of Bun exist/i.test(stderr) ||
        /is not available for download/i.test(stderr) ||
        /is not supported/i.test(stderr) ||
        /Failed to download/i.test(stderr) ||
        /Network error downloading/i.test(stderr) ||
        /404 downloading/i.test(stderr) ||
        /ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(stderr);
      if (looksLikeDownloadFailure) {
        console.warn(`[29120] cross-compile target unavailable, skipping test:\n${stderr}`);
        return;
      }
      console.error(`[29120] build failed:\n${stderr}`);
    }
    expect(exitCode).toBe(0);

    const buf = readFileSync(out);
    const sig = readCodeSignature(buf);
    expect(sig).not.toBeNull();
    if (!sig) return;

    // 1. The magic at `dataoff` must be a valid embedded-signature SuperBlob.
    //    If signing was skipped or the wrong bytes ended up there, this won't
    //    match and macOS would reject the binary outright.
    expect(sig.superBlobMagic).toBe(CSMAGIC_EMBEDDED_SIGNATURE);

    // 2. The size the header advertises must be at least as big as the actual
    //    SuperBlob — otherwise the signature is truncated on disk. This is the
    //    exact failure mode from #29120 where `LC_CODE_SIGNATURE.datasize`
    //    (197,488) was smaller than `SuperBlob.length` (537,138) and macOS
    //    killed the process with SIGKILL on startup.
    expect(sig.datasize).toBeGreaterThanOrEqual(sig.superBlobLength);

    // 3. And the signature must actually fit inside the __LINKEDIT segment.
    //    Otherwise `MachoSigner.sign`'s final truncation chops trailing hashes.
    expect(linkeditCoversSignature(buf, sig)).toBe(true);
  },
);
