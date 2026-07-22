// Verifies that the `#[cfg(test)]` code in a fixed set of Rust crates compiles.
//
// `bun bd`, `rust:check`, and `rust:clippy` all build with the default cfg only,
// so a workspace-wide refactor that removes a symbol whose sole caller sits
// behind `#[cfg(test)]` is invisible to every other CI lane. That is exactly how
// #35002 broke `cargo test -p bun_parsers` (removed `Expr::get_boolean`) and
// `cargo test -p bun_sys` (removed `File::stderr`).
//
// This does not try to link or run the unit tests (linking needs the C/C++ dep
// archive assembled by `scripts/bench-json-rust.sh`); `cargo check --tests` is
// enough to catch the class of breakage above and is fast on a warm build tree.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..");

// Crates whose `#[cfg(test)]` modules are worth guarding here. Keep this list
// small: each entry costs a `cargo check` of its dependency closure.
const CRATES = ["bun_parsers", "bun_sys"];

const cargo = Bun.which("cargo");
// `cargo check` resolves the workspace, which requires the codegen dir that
// `bun bd` / `bun run build --configure-only` populates.
const workspaceReady = existsSync(join(repo, "build", "debug", "codegen", "build_options.rs"));

test.skipIf(!cargo || !workspaceReady)(
  `cargo check --tests compiles: ${CRATES.join(", ")}`,
  async () => {
    await using proc = Bun.spawn({
      cmd: [cargo!, "check", ...CRATES.flatMap(c => ["-p", c]), "--tests", "--keep-going", "--message-format=short"],
      cwd: repo,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const errors = stderr
      .split("\n")
      .filter(l => l.includes(": error[") || l.includes(": error:"))
      .join("\n");
    expect(errors).toBe("");
    expect(exitCode).toBe(0);
  },
  120_000,
);
