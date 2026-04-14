// On NixOS, `bun build --compile` produced a binary whose PT_INTERP had been
// rewritten to the FHS path `/lib64/ld-linux-x86-64.so.2`. That path is a
// stub-ld on NixOS and refuses to run generic binaries, so the compiled
// output failed with:
//
//   Could not start dynamically linked executable: ./test
//   NixOS cannot run dynamically linked executables intended for generic
//   linux environments out of the box.
//
// Regression from #28987 (fix for #24742): the normalization was unconditional
// whenever PT_INTERP in the source template started with `/nix/store/` or
// `/gnu/store/`. We now skip the rewrite when the host bun is running on is
// managed by Nix or Guix — detected via `/proc/self/exe`'s own PT_INTERP,
// `/etc/NIXOS`, or `/gnu/store/`.
//
// https://github.com/oven-sh/bun/issues/29290

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
// Shape of a real /nix/store/ entry: 32-char hash + -<pname>.
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

// Mirror of `hostUsesNixStoreInterpreter()` in src/elf.zig: true iff the
// running bun would skip the FHS rewrite for this host. Test decisions must
// stay in lockstep with the runtime's — if these two drift, tests pass/fail
// for the wrong reason.
function hostLooksNix(): boolean {
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
  "bun build --compile preserves /nix/store PT_INTERP on NixOS hosts (#29290)",
  async () => {
    using dir = tempDir("nix-host-interp", {
      "in.js": `console.log("hello from compiled");`,
    });
    const cwd = String(dir);

    // Simulate a NixOS-patched bun template: copy bun, then patchelf its
    // interpreter to a /nix/store path. (This is what autoPatchelfHook does.)
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

    // Force the spawned bun's host-detection to say "yes, Nix" without
    // mutating the shared rootfs. `BUN_DEBUG_FORCE_NIX_HOST=1` is a
    // test-only hook in `hostUsesNixStoreInterpreter()` that short-circuits
    // to true; scope is this one child process via the env map.
    const out = join(cwd, "out");
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
      env: { ...bunEnv, BUN_DEBUG_FORCE_NIX_HOST: "1" },
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stderr = r.stderr.toString();
    expect(stderr).not.toContain("error:");
    expect(r.exitCode).toBe(0);

    // On a NixOS host the output must keep the /nix/store interpreter from
    // the template — rewriting to FHS would point at a stub-ld that rejects
    // generic binaries and #29290 reappears.
    const interp = readInterp(readHead(out));
    expect(interp).toBe(fakeNixInterp);
  },
  180_000,
);

// Companion: on NON-Nix/Guix hosts, normalization from #24742 must still
// apply. If the host has no Nix/Guix markers AND bun's own PT_INTERP is FHS,
// a template with a /nix/store interpreter should be rewritten to the FHS
// path so the compiled output runs on generic Linux.
test.skipIf(!isLinux || !patchelf || !existsSync(ldso) || hostLooksNix())(
  "bun build --compile still normalizes /nix/store -> FHS on non-Nix hosts",
  async () => {
    using dir = tempDir("fhs-host-interp", {
      "in.js": `console.log("hello from compiled");`,
    });
    const cwd = String(dir);

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

    const out = join(cwd, "out");
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
    expect(r.stderr.toString()).not.toContain("error:");
    expect(r.exitCode).toBe(0);

    // Non-NixOS host → normalization kicks in → FHS path.
    expect(readInterp(readHead(out))).toBe(ldso);

    // And the binary runs on this (non-NixOS) system.
    const run = Bun.spawnSync({ cmd: [out], env: bunEnv, stderr: "pipe", stdout: "pipe" });
    expect(run.stdout.toString().trim()).toBe("hello from compiled");
    expect(run.exitCode).toBe(0);
  },
  180_000,
);
