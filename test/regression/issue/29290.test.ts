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
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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

// Can we write to /etc? Root-owned in typical CI containers; read-only in
// some sandboxes. Skip if we can't — the test isn't meaningful otherwise.
function canWriteEtc() {
  if (!isLinux) return false;
  if (!patchelf) return false;
  if (!existsSync(ldso)) return false;
  // Already on NixOS — /etc/NIXOS is real, test would be no-op and cleanup
  // would be wrong.
  if (existsSync("/etc/NIXOS")) return false;
  try {
    const probe = "/etc/.bun-29290-probe";
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

test.skipIf(!canWriteEtc())(
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
    expect(readInterp(readFileSync(fakeNixBun))).toBe(fakeNixInterp);

    // Mark the host as NixOS. The running bun reads `/etc/NIXOS` at
    // `bun build --compile` time to decide whether to normalize PT_INTERP.
    writeFileSync("/etc/NIXOS", "");
    try {
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
      const stderr = r.stderr.toString();
      expect(stderr).not.toContain("error:");
      expect(r.exitCode).toBe(0);

      // On a NixOS host the output must keep the /nix/store interpreter from
      // the template — rewriting to FHS would point at a stub-ld that
      // rejects generic binaries and #29290 reappears.
      const interp = readInterp(readFileSync(out));
      expect(interp).toBe(fakeNixInterp);
    } finally {
      try {
        rmSync("/etc/NIXOS", { force: true });
      } catch {}
    }
  },
  180_000,
);

// Companion: on NON-NixOS hosts, normalization from #24742 must still apply.
// If the host has no `/etc/NIXOS` AND bun's own PT_INTERP is FHS, a template
// with a /nix/store interpreter should be rewritten to the FHS path so the
// compiled output runs on generic Linux.
test.skipIf(!isLinux || !patchelf || !existsSync(ldso) || existsSync("/etc/NIXOS"))(
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
    expect(readInterp(readFileSync(out))).toBe(ldso);

    // And the binary runs on this (non-NixOS) system.
    const run = Bun.spawnSync({ cmd: [out], env: bunEnv, stderr: "pipe", stdout: "pipe" });
    expect(run.stdout.toString().trim()).toBe("hello from compiled");
    expect(run.exitCode).toBe(0);
  },
  180_000,
);
