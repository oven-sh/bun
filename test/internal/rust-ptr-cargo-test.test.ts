// bun_ptr's tests reach two things a plain `cargo test` binary does not get
// from the Rust dependency graph: `type_base_name` (src/ptr/ref_count.rs) goes
// through bun_core::strings, i.e. the highway C++ kernels, and `RefCount`'s
// ThreadLock pulls in bun_core's OutputSink interface, whose only arm is in
// bun_sys. src/ptr/native_test_shims.rs defines both for the test binary;
// without it the link fails with
//   ld.lld: error: undefined symbol: highway_memrmem
//   ld.lld: error: undefined symbol: __bun_dispatch__OutputSink__Sys__stderr
// and a COFF link forced through instead crashes in
// type_base_name_strips_module_path, so this runs the tests rather than
// stopping at --no-run. Miri (scripts/rust-miri.ts) never links and so cannot
// notice either; the CI guard for the whole crate set is scripts/rust-test.ts
// in rust-lints.yml's miri job, and this is the bun_ptr slice of it.
//
// Same prerequisites as rust-windows-sys-link.test.ts: cargo on PATH and a
// configured checkout (cargo needs vendor/lolhtml to resolve the workspace,
// bun_core/build.rs needs build_options.rs). The test-only CI lanes have
// neither and skip.
import { which } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cargo = which("cargo");
const repoRoot = join(import.meta.dir, "..", "..");
const workspaceResolvable =
  existsSync(join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(join(repoRoot, "build", "debug", "codegen", "build_options.rs"));

test.skipIf(!cargo || !workspaceResolvable)(
  "cargo test -p bun_ptr links and passes as a plain host binary",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "scripts/rust-test.ts", "-p", "bun_ptr"],
      cwd: repoRoot,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("undefined symbol");
    // The test that reaches the shimmed kernels must have actually run.
    expect(stdout).toContain("test ref_count::tests::type_base_name_strips_module_path ... ok");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  },
  // `bun bd` builds into build/<profile>/rust-target, so on a fresh checkout
  // this compiles bun_core's closure first (about 10s on 16 cores); the 5s
  // default cannot hold that. Same ceiling as the miri test in linear-fifo.test.ts.
  120_000,
);
