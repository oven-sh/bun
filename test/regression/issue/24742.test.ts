// On NixOS, autoPatchelfHook rewrites bun's PT_INTERP to a /nix/store/... path.
// `bun build --compile` then copies that patched binary, producing output that
// only runs on the same Nix generation. We now detect store-path interpreters
// and rewrite them back to the standard FHS path.
//
// https://github.com/oven-sh/bun/issues/24742

import { expect, test } from "bun:test";
import { chmodSync, closeSync, cpSync, existsSync, openSync, readSync } from "fs";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";

const patchelf = Bun.which("patchelf");

const ldso =
  process.arch === "arm64"
    ? isMusl
      ? "/lib/ld-musl-aarch64.so.1"
      : "/lib/ld-linux-aarch64.so.1"
    : isMusl
      ? "/lib/ld-musl-x86_64.so.1"
      : "/lib64/ld-linux-x86-64.so.2";

const ldsoBasename = ldso.split("/").pop()!;
const fakeNixInterp = `/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-glibc-2.40-1/lib/${ldsoBasename}`;

// Read PT_INTERP path from an ELF64 LE binary.
function readInterp(buf: Buffer): string | null {
  if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) return null;
  const e_phoff = Number(buf.readBigUInt64LE(32));
  const e_phnum = buf.readUInt16LE(56);
  for (let i = 0; i < e_phnum; i++) {
    const ph = e_phoff + i * 56;
    if (buf.readUInt32LE(ph) !== 3 /* PT_INTERP */) continue;
    const p_offset = Number(buf.readBigUInt64LE(ph + 8));
    const p_filesz = Number(buf.readBigUInt64LE(ph + 32));
    const region = buf.subarray(p_offset, p_offset + p_filesz);
    const nul = region.indexOf(0);
    return region.subarray(0, nul === -1 ? region.length : nul).toString("utf8");
  }
  return null;
}

// Read up to the first 4 KiB of a file (enough for PT_INTERP, which always
// lives in the first ELF page). The bun binary is ~1.3 GB in debug builds,
// so `readFileSync` on it would be wasteful; mirror what the Zig helper does.
function readHead(path: string, bytes = 4096): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

// Mirror of `hostUsesNixStoreInterpreter()` in src/elf.zig. After #29290 the
// normalization is skipped on Nix/Guix hosts — this assertion only holds on
// non-Nix hosts. (The #29290 test covers the NixOS-host branch.)
function hostLooksNix(): boolean {
  if (!isLinux) return false;
  if (existsSync("/etc/NIXOS")) return true;
  if (existsSync("/gnu/store")) return true;
  try {
    const selfInterp = readInterp(readHead(bunExe()));
    if (selfInterp && (selfInterp.startsWith("/nix/store/") || selfInterp.startsWith("/gnu/store/"))) {
      return true;
    }
  } catch {}
  return false;
}

test.skipIf(!isLinux || !patchelf || !existsSync(ldso) || hostLooksNix())(
  "bun build --compile normalizes /nix/store interpreter (#24742)",
  async () => {
    using dir = tempDir("nix-interp", {
      "in.js": `console.log("hello from compiled");`,
    });
    const cwd = String(dir);

    // Simulate a NixOS-installed bun: copy the real binary, then patchelf it.
    const fakeNixBun = join(cwd, "fake-nix-bun");
    cpSync(bunExe(), fakeNixBun);
    chmodSync(fakeNixBun, 0o755);

    {
      const r = Bun.spawnSync({
        cmd: [patchelf!, "--set-interpreter", fakeNixInterp, fakeNixBun],
        stderr: "pipe",
      });
      expect(r.stderr.toString()).toBe("");
      expect(r.exitCode).toBe(0);
    }
    expect(readInterp(readHead(fakeNixBun))).toBe(fakeNixInterp);

    // Build using the patched binary as the template via --compile-executable-path.
    // (We run the real bunExe(); only the *source* of the copy is the Nix-patched one.)
    const out = join(cwd, "out");
    {
      const r = Bun.spawnSync({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--compile-executable-path",
          fakeNixBun,
          join(cwd, "in.js"),
          "--outfile",
          out,
        ],
        env: bunEnv,
        cwd,
        stderr: "pipe",
        stdout: "pipe",
      });
      const stderr = r.stderr.toString();
      expect(stderr).not.toContain("error:");
      expect(r.exitCode).toBe(0);
    }

    // The compiled output's interpreter must be the standard FHS path,
    // not the /nix/store path baked into fake-nix-bun.
    const interp = readInterp(readHead(out));
    expect(interp).toBe(ldso);

    // And it must actually run on a stock system.
    {
      const r = Bun.spawnSync({ cmd: [out], env: bunEnv, stderr: "pipe", stdout: "pipe" });
      expect(r.stdout.toString().trim()).toBe("hello from compiled");
      expect(r.exitCode).toBe(0);
    }
  },
  180_000,
);
