// Every field of every cross-crate hook table must be dispatched somewhere.
//
// `bun_jsc` and `bun_sql_jsc` sit below `bun_runtime` in the crate DAG, so when
// they need a `bun_runtime` body they go through a table of fn pointers: the
// lower crate declares `pub struct FooHooks { pub bar: fn(..) }`, an
// `unsafe extern "Rust" { safe static __BUN_FOO_HOOKS: FooHooks; }`, and an
// accessor (`fn foo_hooks()`) returning that static; `bun_runtime` defines the
// `#[no_mangle]` static, naming one body per field. A field is used by calling
// it as `(hooks.bar)(..)`.
//
// rustc cannot notice when such a field stops being dispatched: the field is
// `pub`, and the body in `bun_runtime` is still referenced by the static's
// initializer, so `dead_code = "deny"` considers both live. That is how
// `LoaderHooks::resolve` kept a ~450-line copy of
// `VirtualMachine::resolve_maybe_needs_trailing_slash` alive (and drifting)
// after its only dispatch site was deleted.
//
// For each table (found from its `safe static` declaration) this lint collects
// the `(<expr>.<field>)(` call sites in the files that can reach the table,
// meaning the files that call its accessor or name its type in code, and fails
// on any field of the table without one. Attributing sites per table is what
// keeps a field name shared by two tables (`timer_insert` is on both
// `RuntimeHooks` and `SqlRuntimeHooks`) from vouching for the other table's
// field; a site in a file that can reach two tables with the same field is
// counted for neither and reported. Full-line `//` comments are stripped first
// so prose never counts as a call site.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..", "..");

// Relative path -> contents with full-line comments blanked (line numbers kept).
const sources = new Map<string, string>();
for (const abs of globAllSources().rust) {
  if (!abs.endsWith(".rs")) continue;
  const code = readFileSync(abs, "utf8").replace(/^\s*\/\/.*$/gm, "");
  sources.set(path.relative(root, abs).replaceAll(path.sep, "/"), code);
}

// `safe static __BUN_LOADER_HOOKS: LoaderHooks;` inside an `extern "Rust"` block.
const TABLE_DECL = /^\s*safe static (__BUN_\w+): (\w+);/gm;
// `(hooks.transpile_file)(`, `(h.has_blob_url)(`, `(hooks().sql_rare)(`; the
// argument list may start on the next line.
const DISPATCH = /\(\s*[\w().*&]*\.(\w+)\s*\)\s*\(/g;
// One field of the table. Parameter lists of multi-line `fn(..)` field types
// are indented further, so only the fields themselves sit at four spaces.
const FIELD = /^    pub(?:\([^)]*\))? (\w+):/gm;

interface HookTable {
  struct: string;
  declaredIn: string;
  accessor: string;
  fields: string[];
  /** Files that call the accessor or name the struct: the only places a dispatch of this table can be. */
  scope: Set<string>;
}

function structFields(struct: string): string[] {
  const header = `\npub struct ${struct} {\n`;
  const found: { file: string; fields: string[] }[] = [];
  for (const [file, code] of sources) {
    const start = code.indexOf(header);
    if (start === -1) continue;
    const bodyStart = start + header.length;
    const bodyEnd = code.indexOf("\n}\n", bodyStart);
    if (bodyEnd === -1) throw new Error(`${file}: could not find the end of \`pub struct ${struct}\``);
    found.push({ file, fields: [...code.slice(bodyStart, bodyEnd).matchAll(FIELD)].map(m => m[1]) });
  }
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one \`pub struct ${struct}\`, found ${found.length}` +
        (found.length ? ` (${found.map(f => f.file).join(", ")})` : ""),
    );
  }
  return found[0].fields;
}

const tables: HookTable[] = [];
for (const [declaredIn, code] of sources) {
  for (const [, staticName, struct] of code.matchAll(TABLE_DECL)) {
    // The zero-arg fn in the declaring file whose body returns the static.
    const accessor = code.match(new RegExp(`\\bfn (\\w+)\\(\\)[^{]*\\{[^}]*\\b${staticName}\\b`))?.[1];
    if (accessor === undefined) {
      throw new Error(
        `${declaredIn}: no accessor fn returning ${staticName} found; this lint attributes dispatch sites to ` +
          `${struct} through the files that call its accessor.`,
      );
    }
    // Both names are `\w+` captures, so they are safe to splice into a pattern.
    const reaches = new RegExp(`\\b${accessor}\\(\\)|\\b${struct}\\b`);
    const scope = new Set<string>();
    for (const [file, other] of sources) if (reaches.test(other)) scope.add(file);
    tables.push({ struct, declaredIn, accessor, fields: structFields(struct), scope });
  }
}
tables.sort((a, b) => a.struct.localeCompare(b.struct));

// file -> field name -> lines on which `(<expr>.<field>)(` occurs.
const sites = new Map<string, Map<string, number[]>>();
for (const [file, code] of sources) {
  for (const match of code.matchAll(DISPATCH)) {
    let perFile = sites.get(file);
    if (perFile === undefined) sites.set(file, (perFile = new Map()));
    const line = code.slice(0, match.index).split("\n").length;
    let lines = perFile.get(match[1]);
    if (lines === undefined) perFile.set(match[1], (lines = []));
    lines.push(line);
  }
}

function dispatchSites(table: HookTable, field: string): { counted: string[]; ambiguous: string[] } {
  const counted: string[] = [];
  const ambiguous: string[] = [];
  for (const file of table.scope) {
    const lines = sites.get(file)?.get(field);
    if (lines === undefined) continue;
    const contested = tables.some(t => t !== table && t.scope.has(file) && t.fields.includes(field));
    (contested ? ambiguous : counted).push(...lines.map(line => `${file}:${line}`));
  }
  return { counted, ambiguous };
}

test("hook tables covered by this lint", () => {
  // Inventory, so that a table whose declaration stops matching TABLE_DECL
  // fails here instead of silently dropping out of the checks below.
  expect(tables.map(t => `${t.struct} (${t.declaredIn}, ${t.accessor}())`)).toEqual([
    "LoaderHooks (src/jsc/ModuleLoader.rs, loader_hooks())",
    "RuntimeHooks (src/jsc/VirtualMachine.rs, runtime_hooks())",
    "SqlRuntimeHooks (src/sql_jsc/jsc.rs, hooks())",
  ]);
});

for (const table of tables) {
  test(`every field of ${table.struct} is dispatched`, () => {
    expect(table.fields).not.toBeEmpty();
    const problems: string[] = [];
    for (const field of table.fields) {
      const { counted, ambiguous } = dispatchSites(table, field);
      if (counted.length > 0) continue;
      problems.push(
        ambiguous.length > 0
          ? `${field} (only sites that could also belong to another table with a \`${field}\` field: ${ambiguous.join(", ")})`
          : field,
      );
    }
    if (problems.length > 0) {
      throw new Error(
        `${table.struct} (${table.declaredIn}) has hook fields that nothing dispatches:\n` +
          problems.map(p => `  ${p}\n`).join("") +
          `A hook field has to be called as \`(hooks.<field>)(..)\` in a file that calls ${table.accessor}() or names ` +
          `${table.struct}. If nothing calls it, delete the field and the body bun_runtime installs for it in the ` +
          `__BUN_* static.`,
      );
    }
  });
}
