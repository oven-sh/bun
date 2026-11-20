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
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NoAnswer } from "../../scripts/build/probe.ts";
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

// A rustc that exits with an error is no rustc to the build: every field is undefined. A rustc that a signal killed,
// or that ran out of time, has given no answer, and that fails configure (scripts/build/probe.ts).
test.skipIf(isWindows)("a rustc that fails is no rustc, and one that gives no answer fails configure", () => {
  using dir = tempDir("build-rustc-no-answer", {
    // What it printed before it failed is not read.
    "fails/bin/rustc": "#!/bin/sh\necho /a/sysroot\necho 'host: a-host'\necho 'LLVM version: 23.1.1'\nexit 1\n",
    // `kill` is not a builtin of every shell, and PATH is the fixture's.
    "killed/bin/rustc": "#!/bin/sh\nPATH=/bin:/usr/bin\nkill -KILL $$\n",
  });
  const probe = (name: string) => {
    chmodSync(join(String(dir), name, "bin/rustc"), 0o755);
    process.env.CARGO_HOME = join(String(dir), name);
    process.env.PATH = join(String(dir), name, "bin");
    return probeRustToolchain("linux");
  };

  expect(probe("fails")).toEqual({ rustLlvmVersion: undefined, rustSysroot: undefined, rustHostTriple: undefined });
  expect(() => probe("killed")).toThrow(NoAnswer);
  expect(() => probe("killed")).toThrow(
    `\`${join(String(dir), "killed/bin/rustc")} --print sysroot\` was killed by SIGKILL`,
  );
});

// The asks pipe only stdout: when the rustup proxy cannot provide the toolchain, what it writes to stderr is the
// explanation, and it has to reach the terminal. A process of its own, to read what went to its stderr.
test.skipIf(isWindows)("what rustc writes to stderr reaches the terminal", async () => {
  using dir = tempDir("build-rustc-stderr", {
    "bin/rustc": "#!/bin/sh\necho 'the proxy says why' >&2\nexit 1\n",
  });
  chmodSync(join(String(dir), "bin/rustc"), 0o755);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { probeRustToolchain } = require(${JSON.stringify(join(repoRoot, "scripts/build/tools.ts"))});
       console.log(JSON.stringify(probeRustToolchain("linux")));`,
    ],
    env: { ...bunEnv, CARGO_HOME: String(dir), PATH: join(String(dir), "bin"), BUN_TOOLCHAIN_RUST: undefined },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Both asks, of the sysroot and of the version, and neither has an answer. An ask that took 5 seconds says so on
  // stderr too (probe.ts), and a busy machine is not what this is about.
  const said = stderr.replace(/^`.+` took \d+s to answer\n/gm, "");
  expect({ stdout: stdout.trim(), stderr: said }).toEqual({
    stdout: "{}",
    stderr: "the proxy says why\nthe proxy says why\n",
  });
  expect(exitCode).toBe(0);
});
