// `RefPtr<T>` (src/ptr/ref_count.rs) is `Send + Sync` when `T` is. The unit
// test `ref_ptr_clones_cross_threads_and_the_last_one_destroys` is the coverage
// for those impls: five threads release their refs concurrently, so only the
// count's own ordering places the destructor after the other threads' reads,
// and Miri's data-race detector is what checks that. The bun_ptr test binary
// does not link natively, so the crate's tests run under Miri only. This runs
// that test with the same Tree Borrows flags as `bun run rust:miri` and checks
// that it ran and passed. Skipped where miri is not installed or the cargo
// workspace is not resolvable (same prerequisite check as linear-fifo.test.ts).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

const cargoBin = Bun.which("cargo");
const repoRoot = path.resolve(import.meta.dir, "..", "..");
const workspaceResolvable =
  existsSync(path.join(repoRoot, "vendor", "lolhtml", "Cargo.toml")) &&
  existsSync(path.join(repoRoot, "vendor", "rust-argon2", "Cargo.toml")) &&
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
  "RefPtr cross-thread clone and drop is clean under miri's data-race detector",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "-p", "bun_ptr", "--", "ref_ptr_clones_cross_threads"],
      cwd: repoRoot,
      env: { ...process.env, MIRIFLAGS: "-Zmiri-tree-borrows", CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Surface miri's diagnostic so the gate/CI log shows the actual UB.
      console.error(stderr || stdout);
    }
    expect(stderr).not.toContain("Undefined Behavior");
    expect(stdout).toContain("test ref_count::tests::ref_ptr_clones_cross_threads_and_the_last_one_destroys ... ok");
    expect(exitCode).toBe(0);
  },
  120_000,
);
