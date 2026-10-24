import { compareCodeResolution } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { tempDir } from "harness";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "../supported";
import { expectNoDifferences, formatDifferences } from "./compare";

const repository = join(import.meta.dir, "..", "..", "..");

function findPackageDirectories(parent: string): string[] {
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => join(parent, entry.name));
}

const directories = [join(repository, "node_modules"), join(repository, "test", "node_modules")].flatMap(tree =>
  [...findPackageDirectories(tree), ...findPackageDirectories(join(tree, ".bun"))].sort(),
);
const namedDirectories = directories.map((directory): [string, string] => [relative(repository, directory), directory]);

let total = 0;

test("a difference is reported", () => {
  using dir = tempDir("aot-resolver-stale", { "importer.js": 'import "./late.js";' });
  const root = String(dir);
  expect(compareCodeResolution(root)).toEqual({ sites: 2, differences: [] });

  // bun_resolver keeps the directory listing it read above. The code question reads the disk again.
  writeFileSync(join(root, "late.js"), "");
  const { differences } = compareCodeResolution(root);

  const site = {
    importer: join(root, "importer.js"),
    specifier: "./late.js",
    bunRun: "not found",
    compile: join(root, "late.js"),
  };
  expect(differences).toEqual([
    { ...site, kind: "import" },
    { ...site, kind: "require" },
  ]);
  expect(formatDifferences(root, differences)[0]).toBe(
    'importer.js: import "./late.js"\n  bun run:     not found\n  bun compile: ' + join(root, "late.js"),
  );
});

test.each(namedDirectories)("%s", (_, directory) => {
  total += expectNoDifferences(directory);
});

test("enough sites were compared", () => {
  console.log(`${total} sites in ${directories.length} directories`);
  expect(total).toBeGreaterThan(50_000);
});
