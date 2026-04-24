/**
 * Regression test for #29681 — the prebuilt `bun-linux-*-musl` binaries
 * linked `libstdc++.so.6` and `libgcc_s.so.1` dynamically, forcing users
 * on clean Alpine images to `apk add libstdc++ libgcc` before bun would
 * launch. PR #15186 introduced the dynamic linking; earlier Bun releases
 * linked these statically (as glibc builds still do).
 *
 * The fix (scripts/build/flags.ts) collapses the separate musl branch and
 * always emits `-static-libstdc++ -static-libgcc` on Linux. This test
 * evaluates the linker-flag table directly so a future regression that
 * reintroduces `-lstdc++ -lgcc` for musl — or drops the static flags —
 * fails here instead of at distro-install time.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { linkerFlags } from "../../../scripts/build/flags.ts";

// Minimal Config shape covering every field referenced by linkerFlags
// predicates. We don't import resolveConfig — it would require a real
// toolchain/cwd — and we don't need the unrelated fields.
interface FakeConfig {
  linux: boolean;
  darwin: boolean;
  windows: boolean;
  unix: boolean;
  x64: boolean;
  arm64: boolean;
  debug: boolean;
  release: boolean;
  abi: "gnu" | "musl" | undefined;
  lto: boolean;
  asan: boolean;
  smol: boolean;
  assertions: boolean;
  valgrind: boolean;
  fuzzilli: boolean;
  ci: boolean;
  pgoGenerate: string | undefined;
  pgoUse: string | undefined;
  osxDeploymentTarget: string | undefined;
  osxSysroot: string | undefined;
  cwd: string;
  buildDir: string;
  ld: string;
}

function makeLinuxConfig(abi: "gnu" | "musl", arch: "x64" | "aarch64"): FakeConfig {
  const cwd = join(import.meta.dir, "..", "..", "..");
  return {
    linux: true,
    darwin: false,
    windows: false,
    unix: true,
    x64: arch === "x64",
    arm64: arch === "aarch64",
    debug: false,
    release: true,
    abi,
    lto: false,
    asan: false,
    smol: false,
    assertions: false,
    valgrind: false,
    fuzzilli: false,
    ci: false,
    pgoGenerate: undefined,
    pgoUse: undefined,
    osxDeploymentTarget: undefined,
    osxSysroot: undefined,
    cwd,
    buildDir: join(cwd, "build", "release"),
    ld: "/usr/bin/ld.lld",
  };
}

function resolveLinkerFlags(cfg: FakeConfig): string[] {
  const out: string[] = [];
  for (const f of linkerFlags) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (f.when && !f.when(cfg as any)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = typeof f.flag === "function" ? f.flag(cfg as any) : f.flag;
    out.push(...(Array.isArray(v) ? v : [v]));
  }
  return out;
}

test.each([
  ["musl", "x64"],
  ["musl", "aarch64"],
  ["gnu", "x64"],
  ["gnu", "aarch64"],
] as const)("linux-%s-%s links libstdc++/libgcc statically", (abi, arch) => {
  const flags = resolveLinkerFlags(makeLinuxConfig(abi, arch));

  // Must opt into static C++ runtime.
  expect(flags).toContain("-static-libstdc++");
  expect(flags).toContain("-static-libgcc");

  // Must NOT fall back to dynamic `-lstdc++` / `-lgcc` — that is what
  // caused #29681 ("symbol not found" on clean Alpine until
  // `apk add libstdc++ libgcc`).
  expect(flags).not.toContain("-lstdc++");
  expect(flags).not.toContain("-lgcc");
});
