// On NixOS, autoPatchelfHook rewrites bun's PT_INTERP to a /nix/store/... path.
// `bun build --compile` then copies that patched binary, producing output that
// only runs on the same Nix generation. We now detect store-path interpreters
// and rewrite them back to the standard FHS path.
//
// https://github.com/oven-sh/bun/issues/24742

import { expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync } from "fs";
import { bunEnv, bunExe, hostLooksNix, isLinux, isMusl, readElfInterp, tempDir } from "harness";
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

// The normalization is skipped on Nix/Guix hosts (#29290, covered by its own
// test), so this assertion only holds elsewhere.
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
    expect(readElfInterp(fakeNixBun)?.interp).toBe(fakeNixInterp);

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
    const interp = readElfInterp(out)?.interp;
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
