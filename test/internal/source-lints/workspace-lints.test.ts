import { expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const root = readFileSync(path.join(repoRoot, "Cargo.toml"), "utf8");
const members = [...(/^members = \[([^\]]*)\]/m.exec(root)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(it => it[1]);

// `[workspace.lints]` in the root Cargo.toml denies every warning, and much that rustc and clippy allow by default. It
// applies to a crate only if the crate says so. A crate that does not gets the defaults, under which the same findings
// are warnings, and `cargo clippy` passes.
test("every crate of the workspace has the lints of the workspace", () => {
  expect(members.length).toBeGreaterThan(100);

  const without = members.filter(member => {
    const manifest = readFileSync(path.join(repoRoot, member, "Cargo.toml"), "utf8");
    // A table of its own, like `[lints.rust]`, would replace them. Cargo refuses to have both.
    return !/^\[lints\]\r?\nworkspace = true$/m.test(manifest);
  });
  expect(without).toEqual([]);
});

// The workspace is the crates below src/: the build takes only those manifests as its inputs (scripts/glob-sources.ts).
// A crate anywhere else is a tool, a fixture or a published package with a Cargo.lock and a profile of its own. As a
// member it would put its dependencies into the root Cargo.lock and take the profile and the lints of the workspace.
test("every member of the workspace is below src/", () => {
  expect(members.length).toBeGreaterThan(100);
  expect(members.filter(member => !member.startsWith("src/"))).toEqual([]);
});

// Cargo walks up from a manifest to the nearest `[workspace]` table. For a crate outside src/ that is the root
// Cargo.toml, which does not list the crate, and every cargo command in it then fails with "current package believes
// it's in a workspace when it's not". Such a crate needs an empty `[workspace]` table of its own, or a parent crate
// whose `[workspace]` table names it in `members`. Cargo decides here: a regex does not know its rules for the root.
//
// The `cargo` on PATH is a rustup proxy on most machines, and a proxy downloads what the machine lacks: the toolchain,
// or in the repo root each component and target that rust-toolchain.toml names (scripts/build/tools.ts: about 2.4 GB).
// A lint must install nothing, so this one runs no proxy. `rustup which --toolchain` gives the cargo of a toolchain
// that is installed. RUSTUP_AUTO_INSTALL stops rustup 1.28.1 and later from installing one there, and earlier versions
// never do. The test is skipped where that gives no cargo.
const toolchain =
  process.env.RUSTUP_TOOLCHAIN ||
  /^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(path.join(repoRoot, "rust-toolchain.toml"), "utf8"))![1];
const cargoEnv = { ...process.env, CARGO_TERM_COLOR: "never", RUSTUP_TOOLCHAIN: toolchain, RUSTUP_AUTO_INSTALL: "0" };
const cargo = (() => {
  const rustup = Bun.which("rustup");
  // Without rustup, a `cargo` on PATH is not a proxy.
  if (rustup === null) return Bun.which("cargo");
  const which = Bun.spawnSync({
    cmd: [rustup, "which", "--toolchain", toolchain, "cargo"],
    env: cargoEnv,
    stdout: "pipe",
    stderr: "ignore",
  });
  return which.exitCode === 0 ? which.stdout.toString().trim() : null;
})();

test.skipIf(cargo === null)("every crate outside the workspace loads on its own", () => {
  const tracked = Bun.spawnSync({
    cmd: ["git", "ls-files", "-z", "--", ":(glob)**/Cargo.toml", ":(exclude)Cargo.toml", ":(exclude)src"],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (tracked.exitCode !== 0)
    throw new Error(`git ls-files failed (${tracked.exitCode}): ${tracked.stderr.toString()}`);
  const listed = tracked.stdout.toString().split("\0").filter(Boolean);
  // Guards against a pathspec that matches nothing making the check below vacuous.
  expect(listed.length).toBeGreaterThan(0);
  // The index also lists a manifest that a sparse checkout leaves out, or that is deleted and not yet staged.
  const manifests = listed.filter(manifest => existsSync(path.join(repoRoot, manifest)));

  const rootDir = realpathSync(repoRoot);
  const refused: Record<string, string> = {};
  for (const manifest of manifests) {
    // `--no-deps` stops once the workspace is loaded: it reads no registry and no Cargo.lock, and writes nothing.
    const { exitCode, stdout, stderr } = Bun.spawnSync({
      cmd: [cargo!, "metadata", "--no-deps", "--offline", "--format-version", "1", "--manifest-path", manifest],
      cwd: repoRoot,
      env: cargoEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (exitCode !== 0) refused[manifest] = stderr.toString();
    // A path dependency of a member makes a crate below the root a member too, with no entry in `members`.
    else if (realpathSync(JSON.parse(stdout.toString()).workspace_root) === rootDir)
      refused[manifest] = "is a member of the root workspace";
  }
  expect(refused).toEqual({});
});
