import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The names users spell for a loader (`bun build --loader .ext:name`,
// `Bun.build({ loader })`, an onLoad result) and read back (`BuildArtifact.loader`,
// `OnLoadArgs.loader`) are the snake_case variant names of `bun_ast::Loader` in
// src/ast/loader.rs. The `Loader` union in bun-types and the `type Loader =`
// snippets the docs copy from it are hand-written lists of those names, and
// new loaders kept shipping with some of the copies stale. This lint fails when
// any copy differs from the enum.
//
// A new variant therefore either goes into every copy, or into `notPublic`
// below with the reason it is left out of the union. Removing an entry from
// `notPublic` (because the loader was added to the union) makes the docs copies
// fail until they list it too.
const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const notPublic = [
  // The bundler emits an empty module for these (src/bundler/ParseTask.rs);
  // they are not implemented loaders yet.
  "base64",
  "dataurl",
  // Backs `bun run script.sh`; in a build it does nothing useful (the CLI's
  // "sh" name ends up as `file`), so it is not offered as a loader.
  "bunsh",
  // `with { type: "sqlite" }` imports; not declared in the union yet (#38247
  // adds both).
  "sqlite",
  "sqlite_embedded",
];

const loaderRs = read("src/ast/loader.rs");

/** How `#[strum(serialize_all = "snake_case")]` spells a variant: `SqliteEmbedded` -> `sqlite_embedded`. */
function snakeCase(variant: string): string {
  return variant.replace(/(?<=[a-z0-9])([A-Z])/g, "_$1").toLowerCase();
}

/** `base64 -> "Base64", css -> "Css", …`: every variant of `pub enum Loader { Jsx = 0, … }` under its public name. */
const variantByName = new Map<string, string>();
const enumBody = loaderRs.match(/pub enum Loader \{([^}]*)\}/)?.[1] ?? "";
for (const [, variant] of enumBody.matchAll(/^\s*([A-Z][A-Za-z0-9]*)\s*(?:=\s*\d+\s*)?,/gm)) {
  variantByName.set(snakeCase(variant), variant);
}

/** The names every copy of the public list must contain, sorted. */
const publicNames = [...variantByName.keys()].filter(name => !notPublic.includes(name)).sort();

/**
 * The members of every `type Loader = "a" | "b" | …;` in `source`, one sorted
 * array per declaration. JSDoc between the members is ignored.
 */
function loaderUnions(source: string): string[][] {
  const unions: string[][] = [];
  for (const match of source.matchAll(/^\s*(?:export\s+)?type Loader\s*=/gm)) {
    const body = source
      .slice(match.index! + match[0].length)
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
      .match(/^([^;]*);/)?.[1];
    expect(body).toBeDefined();
    // Anything but string literals and `|` left over means the declaration is
    // no longer a plain string-literal union and this parser needs updating.
    expect(body!.replace(/"[^"]*"|\||\s/g, "")).toBe("");
    unions.push([...body!.matchAll(/"([^"]*)"/g)].map(([, name]) => name).sort());
  }
  return unions;
}

test("src/ast/loader.rs: notPublic only names variants of the Loader enum", () => {
  expect(variantByName.size).toBeGreaterThan(10);
  expect(notPublic.filter(name => !variantByName.has(name))).toEqual([]);
});

test("src/ast/loader.rs: LOADER_NAMES accepts every public loader under its own name", () => {
  const table = loaderRs.match(/pub static LOADER_NAMES: Loader = \{([^}]*)\}/)?.[1];
  expect(table).toBeDefined();
  const accepted = new Map(
    [...table!.matchAll(/^\s*b"([^"]+)" => Loader::([A-Za-z0-9]+),/gm)].map(([, name, variant]) => [name, variant]),
  );
  expect(accepted.size).toBeGreaterThan(10);

  expect(Object.fromEntries(publicNames.map(name => [name, accepted.get(name)]))).toEqual(
    Object.fromEntries(publicNames.map(name => [name, variantByName.get(name)])),
  );
});

test("packages/bun-types/bun.d.ts: the Loader union lists the public loaders", () => {
  const unions = loaderUnions(read("packages/bun-types/bun.d.ts"));
  expect(unions).toHaveLength(1);
  expect(unions[0]).toEqual(publicNames);
});

test("docs: every `type Loader` snippet lists the public loaders", () => {
  // docs/runtime/transpiler.mdx declares Bun.Transpiler's `JavaScriptLoader`
  // subset under the same name; it is not a copy of this union.
  const skip = new Set(["docs/runtime/transpiler.mdx"]);

  const snippets: [file: string, names: string[]][] = [];
  for (const rel of [...new Glob("**/*.mdx").scanSync({ cwd: path.join(repoRoot, "docs") })].sort()) {
    const file = `docs/${rel.replaceAll("\\", "/")}`;
    if (skip.has(file)) continue;
    for (const union of loaderUnions(read(file))) snippets.push([file, union]);
  }
  // Currently docs/bundler/index.mdx, docs/bundler/plugins.mdx and
  // docs/runtime/plugins.mdx. If the docs stop copying the union, delete this
  // test; an empty scan otherwise means the glob or the pattern broke.
  expect(snippets.length).toBeGreaterThan(0);

  expect(snippets).toEqual(snippets.map(([file]) => [file, publicNames]));
});
