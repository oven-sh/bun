import { file } from "bun";
import { expect, test } from "bun:test";
import path from "node:path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A command that edits a package.json writes it with `package_json_text::print`, which copies
// what the edit does not touch from the text of the file: comments, blank lines, line endings,
// how a string or a number is spelled. `bun_js_printer::print_json` knows the tree and nothing
// of the text, so a writer that calls it drops all of that (#11536).
//
// These files print JSON that is not the text of a package.json on disk. A new caller that
// writes a user's package.json goes through `package_json_text::print` instead.
const callers = [
  // the members that the text does not have yet, and a file that is new
  "src/install/PackageManager/package_json_text.rs",
  // the package.json inside a tarball, which is strict JSON
  "src/runtime/cli/pack_command.rs",
  "src/runtime/cli/publish_command.rs",
  // to stdout
  "src/runtime/cli/pm_diff_command.rs",
  "src/runtime/cli/pm_diff_normalize.rs",
  "src/runtime/cli/pm_pkg_command.rs",
  "src/runtime/cli/pm_view_command.rs",
  "src/runtime/server/server_body.rs",
];

const root = path.resolve(import.meta.dir, "..", "..", "..");
const call = /\b(?:bun_js_printer|js_printer|JSPrinter)::print_json\b|\buse bun_js_printer::[^;]*\bprint_json\b/;

const found: string[] = [];
let scanned = 0;
for (const abs of globAllSources().rust) {
  const rel = path.relative(root, abs).replaceAll(path.sep, "/");
  if (!rel.endsWith(".rs") || rel.startsWith("src/js_printer/")) continue;
  scanned++;
  if (call.test(await file(abs).text())) found.push(rel);
}

test("scans a non-empty set of Rust sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("print_json is called by the files that print JSON which is not a package.json on disk", () => {
  expect(found.sort()).toEqual(callers.toSorted());
});
