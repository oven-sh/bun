// No CI host compiles the `#[cfg(windows)]` arms of bun_errno's unit tests
// natively (no Windows host has a cargo workspace), so scripts/rust-miri.ts
// runs the crate a second time with `--target x86_64-pc-windows-msvc`, which
// miri interprets on any host. This drives the script the way
// `bun run rust:miri -p bun_errno` does and checks that the Windows pass ran:
// it is what catches a bun_errno test that only holds on POSIX (errno_mapping
// used to pick the Win32-code overload of `SystemErrno::init` on Windows).
//
// Skipped where miri is not installed or the cargo workspace is not
// resolvable (same prerequisite check as linear-fifo.test.ts and the script).
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { existsSync } from "node:fs";
import path from "node:path";

const cargoBin = Bun.which("cargo");
const repoRoot = path.resolve(import.meta.dir, "..", "..");
const workspaceResolvable =
  existsSync(path.join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(path.join(repoRoot, "build", "debug", "codegen", "build_options.rs"));
const miriAvailable =
  !!cargoBin &&
  workspaceResolvable &&
  Bun.spawnSync({
    cmd: [cargoBin, "miri", "--version"],
    cwd: repoRoot,
    stdout: "ignore",
    stderr: "ignore",
    timeout: 30_000,
  }).exitCode === 0;

test.skipIf(!miriAvailable)(
  "bun_errno unit tests pass under miri for the Windows target",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(repoRoot, "scripts", "rust-miri.ts"), "-p", "bun_errno"],
      cwd: repoRoot,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("cargo miri test --target x86_64-pc-windows-msvc -p bun_errno");
    // Only defined under cfg(windows): proves the second pass compiled the Windows arms.
    expect(stdout).toContain("init_dispatches_on_argument_type ... ok");
    // The failing assertion (stdout) or miri diagnostic (stderr) ends up in the failure message.
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  },
  // Cold miri sysroot for the target plus the crate's dependencies, twice.
  240_000,
);
