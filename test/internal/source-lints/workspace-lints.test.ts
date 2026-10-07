import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `[workspace.lints]` in the root Cargo.toml denies every warning, and much that rustc and clippy allow by default. It
// applies to a crate only if the crate says so. A crate that does not gets the defaults, under which the same findings
// are warnings, and `cargo clippy` passes.
test("every crate of the workspace has the lints of the workspace", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const root = readFileSync(path.join(repoRoot, "Cargo.toml"), "utf8");
  const members = [...(/^members = \[([^\]]*)\]/m.exec(root)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(it => it[1]);
  expect(members.length).toBeGreaterThan(100);

  const without = members.filter(member => {
    const manifest = readFileSync(path.join(repoRoot, member, "Cargo.toml"), "utf8");
    // A table of its own, like `[lints.rust]`, would replace them. Cargo refuses to have both.
    return !/^\[lints\]\r?\nworkspace = true$/m.test(manifest);
  });
  expect(without).toEqual([]);
});
