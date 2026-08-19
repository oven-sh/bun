/**
 * findRustLld() (scripts/build/tools.ts) queries rustc at configure time.
 * rustc is normally a rustup proxy, and a proxy invoked in the repo root
 * applies rust-toolchain.toml in full, which includes installing every
 * component and target the file lists that happens to be missing (~2.4 GB;
 * measured 36s per CI job, silently, because the proxy's output is piped).
 * The probe must therefore pin the proxy to the channel with RUSTUP_TOOLCHAIN.
 *
 * The rustc here is a shell script that reports the RUSTUP_TOOLCHAIN it was
 * given as its sysroot and as its host triple, and the fixture only contains
 * a rust-lld under the names spelled with the pinned channel, so rust-lld is
 * found only when both probes carried the pin; PATH is emptied so no real
 * rustup runs a pre-flight.
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
  const rustLld = join(`sysroot-for:${channel}`, "lib", "rustlib", `host-for:${channel}`, "bin", "gcc-ld", "ld.lld");
  using dir = tempDir("build-rustc-probe", {
    "bin/rustc": ({ root }) =>
      [
        "#!/bin/sh",
        'case "$1" in',
        `  --print) printf "%s\\n" "${root}/sysroot-for:\${RUSTUP_TOOLCHAIN:-unset}" ;;`,
        '  -vV) printf "host: host-for:%s\\nLLVM version: 22.1.4\\n" "${RUSTUP_TOOLCHAIN:-unset}" ;;',
        "esac",
        "",
      ].join("\n"),
    [rustLld]: "",
  });
  chmodSync(join(String(dir), "bin", "rustc"), 0o755);
  chmodSync(join(String(dir), rustLld), 0o755);
  process.env.CARGO_HOME = String(dir);
  process.env.PATH = join(String(dir), "bin");

  expect(findRustLld("linux")).toEqual({
    rustLlvmVersion: "22.1.4",
    rustLld: join(String(dir), rustLld),
  });
});
