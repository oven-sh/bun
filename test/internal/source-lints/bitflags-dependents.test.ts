import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `bun_core::bitflags!` (src/bitflags) is the crates.io macro and a check: two flags of one set that are written as the
// same bit do not compile. A crate that depends on crates.io `bitflags` itself has the macro without the check, and
// rustc's hint for a `bitflags::bitflags!` that no longer resolves is `cargo add bitflags`.
test("only bun_bitflags and the vendored lol_html depend on crates.io bitflags", () => {
  const lock = readFileSync(path.resolve(import.meta.dir, "..", "..", "..", "Cargo.lock"), "utf8");
  // A package from a path has no `source`. With two versions in the lockfile, the dependency reads "bitflags 2.11.1".
  const dependents = lock
    .split("\n[[package]]\n")
    .filter(pkg => !/^source = /m.test(pkg) && /^ "bitflags(?: [^"]*)?",$/m.test(pkg))
    .map(pkg => /^name = "([^"]+)"$/m.exec(pkg)![1]);
  expect(dependents).toEqual(["bun_bitflags", "lol_html"]);
});
