// Regression test for oven-sh/bun#12738: the Windows `.bin/` launcher PE
// (`bun_shim_impl.exe`) is `include_bytes!`'d into bun.exe and copied next to
// every package binary by `bun install`. Without `/Brepro` lld-link writes the
// wall-clock link time into the PE COFF `TimeDateStamp` field, and its own
// `/DEBUG` generates a `.pdb` whose content hash (which encodes absolute object
// paths) lands in the image's RSDS GUID. Either makes the shim a fresh binary
// on every build, so it can't be whitelisted by hash and trips AV heuristics.
//
// This test cross-compiles the shim twice into different target directories
// (simulating different checkout paths) and asserts byte-identity. It runs on
// any host that has the Windows cross-compile prerequisites (cargo + rust-src,
// lld-link, an xwin-style winsysroot); it's a no-op elsewhere.

import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { detectWindowsSysroot } from "../../scripts/build/config.ts";

const repoRoot = resolve(import.meta.dir, "..", "..");
const cargo = Bun.which("cargo");
const lldLink = Bun.which("lld-link");
const winsysroot = detectWindowsSysroot();
const rustSrc = (() => {
  if (cargo == null) return undefined;
  const probe = Bun.spawnSync({
    cmd: ["rustc", "--print=sysroot"],
    cwd: repoRoot,
    env: { ...process.env, RUSTUP_TOOLCHAIN: "" },
  });
  if (probe.exitCode !== 0) return undefined;
  const sysroot = probe.stdout.toString().trim();
  return existsSync(join(sysroot, "lib", "rustlib", "src", "rust")) ? sysroot : undefined;
})();

// Cross-compile from a non-Windows host only: native Windows test agents don't
// reliably run inside a VS dev shell, so kernel32.lib isn't on %LIB%.
const havePrereqs = !isWindows && cargo != null && lldLink != null && rustSrc != null && winsysroot != null;

const triple = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";

async function buildShim(targetDir: string): Promise<Uint8Array> {
  // Mirror the freestanding link flags from scripts/build/rust.ts so the
  // standalone `#![no_std]` crate links at all; the flags under test
  // (`/Brepro`, `/DEBUG:NONE`) come from the crate's own build.rs.
  const rustflags = [
    "-Zunstable-options",
    "-Cpanic=immediate-abort",
    "-Clink-arg=/ENTRY:shim_main",
    "-Clink-arg=/SUBSYSTEM:CONSOLE",
    "-Clink-arg=/NODEFAULTLIB",
    "-Clink-arg=kernel32.lib",
    "-Clink-arg=ntdll.lib",
    `-Clink-arg=/winsysroot:${winsysroot}`,
  ];
  const env: Record<string, string> = {
    ...process.env,
    CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f"),
    CARGO_TERM_COLOR: "never",
    RUSTUP_TOOLCHAIN: "",
    [`CARGO_TARGET_${triple.toUpperCase().replace(/-/g, "_")}_LINKER`]: lldLink!,
  };

  await using proc = Bun.spawn({
    cmd: [
      cargo!,
      "build",
      "-p",
      "bun_shim_impl",
      "--bin",
      "bun_shim_impl",
      "--features",
      "shim_standalone",
      "--target-dir",
      targetDir,
      "--target",
      triple,
      "--profile",
      "shim",
      "-Zbuild-std=core,compiler_builtins",
      "-Zbuild-std-features=compiler-builtins-mem",
    ],
    env,
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`cargo build failed (exit ${exitCode}) in ${targetDir}:\n${stdout}\n${stderr}`);
  }
  return await Bun.file(join(targetDir, triple, "shim", "bun_shim_impl.exe")).bytes();
}

describe.skipIf(!havePrereqs)("bun_shim_impl.exe is reproducible", () => {
  test(
    "two clean builds in different target directories are byte-identical",
    async () => {
      using a = tempDir("shim-repro-a", {});
      using b = tempDir("shim-repro-b", {});
      const [pa, pb] = [join(String(a), "t"), join(String(b), "t")];

      const exeA = await buildShim(pa);
      // Wall-clock TimeDateStamp has 1-second resolution; without /Brepro two
      // back-to-back links can still agree by accident.
      await Bun.sleep(1100);
      const exeB = await buildShim(pb);

      const hashA = Bun.SHA256.hash(exeA, "hex");
      const hashB = Bun.SHA256.hash(exeB, "hex");
      expect({ size: exeB.length, sha256: hashB }).toEqual({ size: exeA.length, sha256: hashA });

      // `/DEBUG:NONE`: no RSDS CodeView record (whose PDB-content-derived GUID
      // encodes absolute object paths) and no `.pdb` reference in the image.
      const bytes = Buffer.from(exeA);
      expect(bytes.includes(Buffer.from("RSDS"))).toBe(false);
      expect(bytes.includes(Buffer.from(".pdb"))).toBe(false);

      // `/Brepro`: lld-link stamps the PE as reproducible by adding an
      // IMAGE_DEBUG_TYPE_REPRO (16) debug-directory entry and replacing the
      // COFF TimeDateStamp with a content hash. Scan for the entry's fixed
      // tail (`MajorVersion=0, MinorVersion=0, Type=16, SizeOfData=0,
      // AddressOfRawData=0, PointerToRawData=0`); `/DEBUG:NONE` leaves it as
      // the only debug-directory entry.
      // prettier-ignore
      const reproEntryTail = Buffer.from([
        0, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]);
      expect(bytes.includes(reproEntryTail)).toBe(true);
    },
    120_000,
  );
});
