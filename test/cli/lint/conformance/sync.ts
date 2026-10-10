// Collects the fixtures that the `extract-*.ts` scripts write, and what the cases with types need, in `bundle.zst`.
//
//   export ESLINT_DIR=.. TYPESCRIPT_ESLINT_DIR=.. REACT_DIR=.. ESLINT_PLUGIN_IMPORT_X_DIR=..
//   export ESLINT_PLUGIN_N_DIR=.. OXC_DIR=..   # the checkouts that the fixtures were recorded with
//   bun test/cli/lint/conformance/sync.ts [<fixtures>]        # `fixtures` next to this file, unless named
//   bun test/cli/lint/conformance/sync.ts --more <name> <directory>   # `more/<name>/` is what `<directory>/<plugin>/<rule>.json` are
//   bun test/cli/lint/conformance/sync.ts --oxlint <directory>        # `oxlint/` is what `extract-oxlint.ts` wrote to `<directory>`
//   bun test/cli/lint/conformance/sync.ts --extract <part of a path, or ""> <directory>
//
// Each of the first three leaves the rest of the bundle as it is.
//
// The suites of eslint-plugin-import, -react, -regexp and -prettier are recorded with the published packages and come into the bundle
// rule by rule, as a rule here does the same as the package's. None of these commands touches them: see `RECORDED`.
import { $ } from "bun";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect, extract, readBundle, writeBundle } from "../../format/bundle.ts";

const here = import.meta.dir;
const bundle = join(here, "bundle.zst");

/** What the fixtures are from: the directory in `licenses/`, the variable with the checkout, and where `package.json` is in it. */
const SOURCES = [
  ["eslint", "ESLINT_DIR", "."],
  ["typescript-eslint", "TYPESCRIPT_ESLINT_DIR", "packages/eslint-plugin"],
  ["eslint-plugin-react-hooks", "REACT_DIR", "packages/eslint-plugin-react-hooks"],
  ["eslint-plugin-import-x", "ESLINT_PLUGIN_IMPORT_X_DIR", "."],
  ["eslint-plugin-n", "ESLINT_PLUGIN_N_DIR", "."],
  ["oxc", "OXC_DIR", "npm/oxlint"],
  ["tsgolint", "TSGOLINT_DIR", "."],
] as const;

/** The packages that the project of typescript-eslint's tests finds types in, and from where each is resolved. */
const PACKAGES = [
  ["@types/node", "."],
  ["undici-types", "node_modules/@types/node"],
  ["@types/react", "packages/eslint-plugin"],
  ["@types/prop-types", "packages/eslint-plugin/node_modules/@types/react"],
  ["csstype", "packages/eslint-plugin/node_modules/@types/react"],
  ["@typescript-eslint/types", "packages/eslint-plugin"],
] as const;

/** What is in the bundle rule by rule, with the projects that the cases are files of. */
const RECORDED = ["import/", "import-project/", "react/", "regexp/", "prettier/", "prettier-project/"];

function directoryOf(variable: string): string {
  const directory = process.env[variable];
  if (!directory) throw new Error(`${variable} is not set`);
  return directory;
}

/** The directory of `name`, as Node.js finds it from `from`. */
function resolvePackage(name: string, from: string): string {
  for (let directory = realpathSync(from); ; directory = join(directory, "..")) {
    if (existsSync(join(directory, "node_modules", name, "package.json"))) return realpathSync(join(directory, "node_modules", name));
    if (directory === "/") throw new Error(`${name} is not installed`);
  }
}

/** Nothing in the bundle names a file of this machine. `local`: directories of it. */
function clean(files: Map<string, Uint8Array>, local: string[]) {
  local = local.flatMap(it => [it, realpathSync(it)]);
  for (const [path, bytes] of files) {
    if (!path.endsWith(".json")) continue;
    const text = Buffer.from(bytes).toString("latin1");
    // What Node.js says about a module that it does not find.
    const cleaned = text.replace(/\\nRequire stack:(?:[^"\\]|\\.)*/g, "");
    if (local.some(it => cleaned.includes(it))) throw new Error(`${path} has a path of this machine in it`);
    if (cleaned !== text) files.set(path, Buffer.from(cleaned, "latin1"));
  }
}

function summary(files: Map<string, Uint8Array>) {
  return `${files.size} files, ${[...files.values()].reduce((sum, it) => sum + it.length, 0)} bytes`;
}

/** What is in the bundle now, if `keeps` says so of the path. */
function kept(keeps: (path: string) => boolean): Map<string, Uint8Array> {
  return new Map(existsSync(bundle) ? [...readBundle(bundle)].filter(([path]) => keeps(path)) : []);
}

const [first, ...rest] = process.argv.slice(2);
if (first === "--extract" && rest.length === 2) {
  console.log(`${extract(bundle, rest[0], rest[1])} files in ${rest[1]}`);
} else if (first === "--more" && rest.length === 2) {
  const [name, directory] = rest;
  const files = kept(path => !path.startsWith(`more/${name}/`));
  const found = new Map<string, Uint8Array>();
  for (const plugin of ["eslint", "typescript-eslint", "n", "react"]) {
    if (existsSync(join(directory, plugin))) collect(directory, plugin, found, file => !file.endsWith(".json"));
  }
  clean(found, [directory]);
  for (const [path, bytes] of found) files.set(`more/${name}/${path}`, bytes);
  writeBundle(bundle, files);
  console.log(`more/${name}: ${summary(found)}. In all: ${summary(files)}`);
} else if (first === "--oxlint" && rest.length === 1) {
  const [directory] = rest;
  const files = kept(path => !path.startsWith("oxlint/") && !path.startsWith("oxlint-import-project/"));
  const found = new Map<string, Uint8Array>();
  for (const plugin of readdirSync(directory).sort()) {
    if (statSync(join(directory, plugin)).isDirectory()) collect(directory, plugin, found, () => false);
  }
  clean(found, [directory]);
  // The files that the cases of `import` are next to are not tests.
  for (const [path, bytes] of found) files.set(path.startsWith("import-project/") ? `oxlint-${path}` : `oxlint/${path}`, bytes);
  writeBundle(bundle, files);
  console.log(`oxlint: ${summary(found)}. In all: ${summary(files)}`);
} else if (first?.startsWith("--")) {
  console.error(
    "usage: bun sync.ts [<fixtures>] | --more <name> <directory> | --oxlint <directory> | --extract <part of a path> <directory>",
  );
  process.exit(1);
} else {
  const fixtures = first ?? join(here, "fixtures");
  const files = kept(path => path.startsWith("more/") || path.startsWith("oxlint") || RECORDED.some(it => path.startsWith(it)));
  for (const directory of ["eslint", "typescript-eslint", "react-hooks", "n", "oxc"]) {
    collect(fixtures, directory, files, () => false);
  }
  for (const directory of ["typescript-eslint-project", "n-project"]) collect(fixtures, directory, files, () => false);

  // What is not from one of `SOURCES` and `PACKAGES` stays as it is.
  const version: Record<string, { version?: string; commit?: string }> = JSON.parse(readFileSync(join(here, "version.json"), "utf8"));
  mkdirSync(join(here, "licenses"), { recursive: true });
  for (const [name, variable, manifest] of SOURCES) {
    const checkout = directoryOf(variable);
    writeFileSync(join(here, "licenses", `${name}.txt`), readFileSync(join(checkout, "LICENSE")));
    version[name] = {
      version: JSON.parse(readFileSync(join(checkout, manifest, "package.json"), "utf8")).version,
      commit: (await $`git rev-parse HEAD`.cwd(checkout).text()).trim(),
    };
  }
  for (const [name, from] of PACKAGES) {
    const directory = resolvePackage(name, join(directoryOf("TYPESCRIPT_ESLINT_DIR"), from));
    const found = new Map<string, Uint8Array>();
    collect(directory, ".", found, file => !/\.d\.[cm]?ts$|^package\.json$|^LICENSE$/.test(file));
    for (const [path, bytes] of found) {
      if (!path.includes("/node_modules/")) files.set(`node_modules/${name}/${path.slice(2)}`, bytes);
    }
    writeFileSync(join(here, "licenses", `${name.replace("/", "-")}.txt`), readFileSync(join(directory, "LICENSE")));
    version[name] = { version: JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version };
  }
  clean(files, [fixtures, ...SOURCES.map(it => directoryOf(it[1]))]);
  writeBundle(bundle, files);
  writeFileSync(join(here, "version.json"), JSON.stringify(version, null, 2) + "\n");
  console.log(summary(files));
}
