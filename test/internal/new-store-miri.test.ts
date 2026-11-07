/**
 * The AST allocators (src/ast/new_store.rs and src/bun_alloc/ast_alloc.rs) hand
 * out nodes and lists that the parser writes long after later allocations.
 * An allocation that invalidates an earlier one has no runtime-observable
 * effect, so the discriminator is miri.
 *
 * `bun run rust:miri` runs the unit tests under Tree Borrows in CI. This test
 * clears MIRIFLAGS to run them under miri's default Stacked Borrows model, which
 * CI does not cover. Skipped where miri is not installed, or where the cargo
 * workspace is not resolvable (see linear-fifo.test.ts and scripts/rust-miri.ts).
 */
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
  "AST allocator unit tests are clean under Stacked Borrows miri",
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargoBin!, "miri", "test", "--locked", "-p", "bun_ast", "--lib", "--", "new_store"],
      cwd: repoRoot,
      env: { ...process.env, MIRIFLAGS: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Surface miri's diagnostic so the log shows the actual UB.
      console.error(stderr || stdout);
    }
    expect(stderr).not.toContain("Undefined Behavior");
    // A filter that matches nothing must not pass: one node test and one list test ran.
    expect(stdout).toContain("test new_store::tests::earlier_nodes_survive_later_appends ... ok");
    expect(stdout).toContain("test new_store::tests::front_end::child_list_is_written_after_a_later_list ... ok");
    expect(exitCode).toBe(0);
  },
  120_000,
);
