import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `BuildMessage.level` / `ResolveMessage.level` are `bun_ast::Kind::string()`
// and `ResolveMessage.importKind` (also the metafile's and scanImports()' `kind`)
// is `bun_ast::ImportKind::label()`, both in src/ast/lib.rs. The bun-types
// `BuildMessageLevel` and `ImportKind` unions and the `class BuildMessage` /
// `class ResolveMessage` snippets in the docs are hand-written copies of those
// strings, and they had drifted from the runtime for years (`"warning"`,
// `"stmt"`, no `"composes"`). This lint fails when any copy differs from the
// Rust tables.
//
// A variant that is deliberately kept out of the union goes into `notPublic`
// below with the reason; every other label has to be in every copy. Deleting
// such a variant from the enum fails the first test until it is removed here too.
const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const libRs = read("src/ast/lib.rs");

const notPublic = [
  // `@import` rules with conditions have an empty label, so a ResolveMessage for
  // one currently reports `importKind: ""`. A runtime gap, not a documented value.
  "AtConditional",
  // Reported today only as the metafile `kind` of the first server-side importer
  // of an HTML file, and #38621 removes that rewrite while keeping the variant,
  // so a documented "html_manifest" would outlive its last use without this
  // lint noticing. If #38621 is dropped instead, delete this entry.
  "HtmlManifest",
];

/** The variants of `pub enum <name> { A = 0, B = 1, … }` in src/ast/lib.rs. */
function enumVariants(name: string): string[] {
  const body = libRs.match(new RegExp(`^pub enum ${name} \\{([^}]*)\\}`, "m"))?.[1];
  expect(body).toBeDefined();
  return [...body!.matchAll(/^\s*([A-Z][A-Za-z0-9]*)(?:\s*=\s*\d+)?,/gm)].map(([, variant]) => variant);
}

/**
 * `variant -> string` for each arm of `pub fn <fn>(self) -> &'static [u8] { match self { … } }`
 * in src/ast/lib.rs. Empty when the function was not found; the first test
 * below compares the arms with the enum's variants, which catches that.
 */
function matchArms(enumName: string, fn: string): Map<string, string> {
  const body =
    libRs.match(new RegExp(`pub fn ${fn}\\(self\\) -> &'static \\[u8\\] \\{\\s*match self \\{([^}]*)\\}`))?.[1] ?? "";
  const arms = new Map<string, string>();
  for (const [, variant, label] of body.matchAll(new RegExp(`^\\s*${enumName}::([A-Za-z0-9]+) => b"([^"]*)",`, "gm"))) {
    arms.set(variant, label);
  }
  return arms;
}

const levelArms = matchArms("Kind", "string");
const labelArms = matchArms("ImportKind", "label");

/** What every copy of the level union has to list, sorted. */
const levels = [...levelArms.values()].sort();

/** What every copy of the import kind union has to list, sorted. */
const importKinds = [...labelArms]
  .filter(([variant]) => !notPublic.includes(variant))
  .map(([, label]) => label)
  .sort();

/**
 * The members of the string-literal union that follows each match of `prefix`
 * in `source`, sorted, one entry per match. Comments between the members are
 * ignored. A match followed by something other than a string-literal union
 * (for example `importKind: ImportKind;`) yields `null`.
 */
function unionsAfter(source: string, prefix: RegExp): (string[] | null)[] {
  return [...source.matchAll(prefix)].map(match => {
    const body = source
      .slice(match.index! + match[0].length)
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
      .match(/^([^;]*);/)?.[1];
    expect(body).toBeDefined();
    const members = [...body!.matchAll(/"([^"]*)"/g)].map(([, name]) => name);
    return members.length > 0 && body!.replace(/"[^"]*"|\||\s/g, "") === "" ? members.sort() : null;
  });
}

const typeAlias = (name: string) => new RegExp(`^\\s*type ${name}\\s*=`, "gm");
const property = (name: string) => new RegExp(`^\\s*(?:readonly\\s+)?${name}:`, "gm");

test("src/ast/lib.rs: Kind::string() and ImportKind::label() were parsed for every variant", () => {
  expect([...levelArms.keys()].sort()).toEqual(enumVariants("Kind").sort());
  expect([...labelArms.keys()].sort()).toEqual(enumVariants("ImportKind").sort());
  expect(notPublic.filter(variant => !labelArms.has(variant))).toEqual([]);
  expect(levels.length).toBeGreaterThanOrEqual(5);
  expect(importKinds.length).toBeGreaterThanOrEqual(10);
  expect(new Set(levels).size).toBe(levels.length);
  expect(new Set(importKinds).size).toBe(importKinds.length);
});

test("src/ast/lib.rs: a variant without a label is listed in `notPublic`", () => {
  const unlabeled = [...labelArms].filter(([, label]) => label === "").map(([variant]) => variant);
  expect(unlabeled.filter(variant => !notPublic.includes(variant))).toEqual([]);
  expect(importKinds).not.toContain("");
});

test("packages/bun-types/bun.d.ts: BuildMessageLevel lists Kind::string()", () => {
  expect(unionsAfter(read("packages/bun-types/bun.d.ts"), typeAlias("BuildMessageLevel"))).toEqual([levels]);
});

test("packages/bun-types/bun.d.ts: ImportKind lists ImportKind::label()", () => {
  expect(unionsAfter(read("packages/bun-types/bun.d.ts"), typeAlias("ImportKind"))).toEqual([importKinds]);
});

test("docs: every BuildMessage / ResolveMessage snippet lists the same strings", () => {
  // docs/runtime/transpiler.mdx lists the kinds scanImports() returns, which is
  // deliberately a subset of ImportKind (no CSS or HTML kinds); it declares
  // neither class, so it is not picked up here.
  const snippets: [file: string, body: string][] = [];
  for (const rel of [...new Glob("**/*.mdx").scanSync({ cwd: path.join(repoRoot, "docs") })].sort()) {
    const file = `docs/${rel.replaceAll("\\", "/")}`;
    for (const [, body] of read(file).matchAll(
      /^(?:declare )?class (?:BuildMessage|ResolveMessage)\b[^{]*\{([^}]*)\}/gm,
    )) {
      snippets.push([file, body]);
    }
  }
  // Currently the two snippets under "Logs and errors" and the reference block
  // in docs/bundler/index.mdx. An empty scan means the glob or pattern broke.
  expect(snippets.length).toBeGreaterThan(0);

  const levelCopies = snippets.flatMap(([file, body]) =>
    unionsAfter(body, property("level")).map(copy => [file, copy]),
  );
  expect(levelCopies.length).toBeGreaterThan(0);
  expect(levelCopies).toEqual(levelCopies.map(([file]) => [file, levels]));

  // `importKind: ImportKind;` (a reference rather than a copy) is fine; a
  // spelled-out union has to match.
  const importKindCopies = snippets
    .flatMap(([file, body]) => unionsAfter(body, property("importKind")).map(copy => [file, copy]))
    .filter(([, copy]) => copy !== null);
  expect(importKindCopies.length).toBeGreaterThan(0);
  expect(importKindCopies).toEqual(importKindCopies.map(([file]) => [file, importKinds]));
});
