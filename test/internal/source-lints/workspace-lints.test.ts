import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
const cargo = Bun.which("cargo");
test.skipIf(!cargo)("every crate outside the workspace loads on its own", () => {
  const tracked = Bun.spawnSync({
    cmd: ["git", "ls-files", "-z", "--", ":(glob)**/Cargo.toml", ":(exclude)Cargo.toml", ":(exclude)src"],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({ stderr: tracked.stderr.toString(), exitCode: tracked.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const manifests = tracked.stdout.toString().split("\0").filter(Boolean);
  // Guards against a pathspec that matches nothing making the check below vacuous.
  expect(manifests.length).toBeGreaterThan(0);

  const refused: Record<string, string> = {};
  for (const manifest of manifests) {
    // `--no-deps` stops once the workspace is loaded: it reads no registry and no Cargo.lock, and writes nothing.
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [cargo!, "metadata", "--no-deps", "--offline", "--format-version", "1", "--manifest-path", manifest],
      cwd: repoRoot,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      stdout: "ignore",
      stderr: "pipe",
    });
    if (exitCode !== 0) refused[manifest] = stderr.toString();
  }
  expect(refused).toEqual({});
});
