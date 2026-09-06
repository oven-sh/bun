/**
 * findRustLld() (scripts/build/tools.ts) queries rustc at configure time.
 * rustc is normally a rustup proxy, and a proxy invoked in the repo root
 * applies rust-toolchain.toml in full, which includes installing every
 * component and target the file lists that happens to be missing (~2.4 GB;
 * measured 36s per CI job, silently, because the proxy's output is piped).
 * The probe must therefore pin the proxy to the channel with RUSTUP_TOOLCHAIN.
 *
 * The rustc here is a shell script that folds the RUSTUP_TOOLCHAIN it was
 * given into its sysroot path and into its host triple, so both probes are
 * covered. The fake sysroot has a `gcc-ld/ld.lld` only under the pinned
 * names: an unpinned probe resolves to a path that does not exist and
 * `rustLld` comes back undefined. PATH holds only the fixture's `bin`
 * directory, so no real rustup runs a pre-flight.
 */
import { afterEach, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findRustLld } from "../../scripts/build/tools.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(join(repoRoot, "rust-toolchain.toml"), "utf8"))![1];

const savedEnv = { CARGO_HOME: process.env.CARGO_HOME, PATH: process.env.PATH };
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test.skipIf(isWindows)("the configure-time rustc probe pins the rustup proxy to the pinned channel", () => {
  const ldLld = join(`sysroot-for-${channel}`, "lib", "rustlib", `host-for-${channel}`, "bin", "gcc-ld", "ld.lld");
  using dir = tempDir("build-rustc-probe", {
    "bin/rustc": ({ root }) =>
      [
        "#!/bin/sh",
        'case "$1" in',
        `  --print) printf "%s\\n" "${root}/sysroot-for-\${RUSTUP_TOOLCHAIN:-unset}" ;;`,
        '  -vV) printf "host: host-for-%s\\nLLVM version: 22.1.4\\n" "${RUSTUP_TOOLCHAIN:-unset}" ;;',
        "esac",
        "",
      ].join("\n"),
    [ldLld]: "",
  });
  for (const executable of ["bin/rustc", ldLld]) chmodSync(join(String(dir), executable), 0o755);
  process.env.CARGO_HOME = String(dir);
  process.env.PATH = join(String(dir), "bin");

  expect(findRustLld("linux")).toEqual({
    rustLld: join(String(dir), ldLld),
    rustLlvmVersion: "22.1.4",
  });
});
