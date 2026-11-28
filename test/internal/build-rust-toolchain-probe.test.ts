/**
 * probeRustToolchain() (scripts/build/tools.ts) queries rustc at configure time.
 * rustc is normally a rustup proxy, and a proxy invoked in the repo root
 * applies rust-toolchain.toml in full, which includes installing every
 * component and target the file lists that happens to be missing (~2.4 GB;
 * measured 36s per CI job, silently, because the proxy's output is piped).
 * The probe must therefore pin the proxy to the channel with RUSTUP_TOOLCHAIN.
 *
 * The rustc here is a shell script that folds the RUSTUP_TOOLCHAIN it was
 * given into its sysroot path and into its host triple, so both probes are
 * covered. PATH holds only the fixture's `bin` directory, so no real rustup
 * runs a pre-flight.
 */
import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { probeRustToolchain } from "../../scripts/build/tools.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(join(repoRoot, "rust-toolchain.toml"), "utf8"))![1];

const savedEnv = { CARGO_HOME: process.env.CARGO_HOME, PATH: process.env.PATH };
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// The real-executable alias uses a file symlink, which requires extra privileges on Windows.
test.skipIf(isWindows)(
  "codegen keeps its selected Bun when another real installation has the same version",
  async () => {
    const tools = pathToFileURL(join(repoRoot, "scripts/build/tools.ts")).href;
    using dir = tempDir("build-selected-bun", {
      ".bun/bin/.keep": "",
      "probe.mjs": ({ root }) => /* js */ `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      import * as os from "node:os";
      const originalOS = { ...os };
      mock.module("node:os", () => ({ ...originalOS, homedir: () => ${JSON.stringify(root)} }));
      const { findBun } = await import(${JSON.stringify(tools)});
      assert.equal(findBun(process.platform), process.execPath);
      console.log("selected runtime preserved");
    `,
    });
    // Both candidates are the real executable, with identical bytes and versions.
    symlinkSync(bunExe(), join(String(dir), ".bun/bin/bun"));
    await using proc = Bun.spawn({
      cmd: [bunExe(), "probe.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "selected runtime preserved\n", stderr: "" });
    expect(exitCode).toBe(0);
  },
);

test.skipIf(isWindows)("the configure-time rustc probe pins the rustup proxy to the pinned channel", () => {
  using dir = tempDir("build-rustc-probe", {
    "bin/rustc": ({ root }) =>
      [
        "#!/bin/sh",
        'case "$1" in',
        `  --print) printf "%s\\n" "${root}/sysroot-for-\${RUSTUP_TOOLCHAIN:-unset}" ;;`,
        '  -vV) printf "host: host-for-%s\\nLLVM version: 23.1.1\\n" "${RUSTUP_TOOLCHAIN:-unset}" ;;',
        "esac",
        "",
      ].join("\n"),
  });
  chmodSync(join(String(dir), "bin/rustc"), 0o755);
  process.env.CARGO_HOME = String(dir);
  process.env.PATH = join(String(dir), "bin");

  expect(probeRustToolchain("linux")).toEqual({
    rustLlvmVersion: "23.1.1",
    rustSysroot: join(String(dir), `sysroot-for-${channel}`),
    rustHostTriple: `host-for-${channel}`,
  });
});
