// Every field of every cross-crate hook table must be dispatched somewhere.
//
// `bun_jsc` and `bun_sql_jsc` sit below `bun_runtime` in the crate DAG, so when
// they need a `bun_runtime` body they go through a table of fn pointers: the
// lower crate declares `pub struct FooHooks { pub bar: fn(..) }` together with
// `unsafe extern "Rust" { safe static __BUN_FOO_HOOKS: FooHooks; }`, and
// `bun_runtime` defines the `#[no_mangle]` static, naming one body per field.
// A field is used by calling it as `(hooks.bar)(..)`.
//
// rustc cannot notice when such a field stops being dispatched: the field is
// `pub`, and the body in `bun_runtime` is still referenced by the static's
// initializer, so `dead_code = "deny"` considers both live. That is how
// `LoaderHooks::resolve` kept a ~450-line copy of
// `VirtualMachine::resolve_maybe_needs_trailing_slash` alive (and drifting)
// after its only dispatch site was deleted. This lint finds every hook table
// from its `safe static` declaration and fails on any field that no
// `(<expr>.<field>)(` call site in src/ names.
//
// Two tables may share a field name (`timer_insert` exists on both
// `RuntimeHooks` and `SqlRuntimeHooks`); such a field only has to be dispatched
// through one of them to pass here.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..", "..");

const sources = new Map<string, string>();
for (const abs of globAllSources().rust) {
  if (!abs.endsWith(".rs")) continue;
  sources.set(path.relative(root, abs).replaceAll(path.sep, "/"), readFileSync(abs, "utf8"));
}

// `safe static __BUN_LOADER_HOOKS: LoaderHooks;` inside an `extern "Rust"` block.
const TABLE_DECL = /^\s*safe static __BUN_\w+: (\w+);/gm;
// `(hooks.transpile_file)(`, `(h.has_blob_url)(`, `(hooks().sql_rare)(`; the
// argument list may start on the next line.
const DISPATCH = /\(\s*[\w().*&]*\.(\w+)\s*\)\s*\(/g;
// One field of the table. Parameter lists of multi-line `fn(..)` field types
// are indented further, so only the fields themselves sit at four spaces.
const FIELD = /^    pub (\w+):/gm;

interface HookTable {
  struct: string;
  declaredIn: string;
  fields: string[];
}

function structFields(struct: string): string[] {
  const header = `\npub struct ${struct} {\n`;
  const found: { file: string; fields: string[] }[] = [];
  for (const [file, content] of sources) {
    const start = content.indexOf(header);
    if (start === -1) continue;
    const bodyStart = start + header.length;
    const bodyEnd = content.indexOf("\n}\n", bodyStart);
    if (bodyEnd === -1) throw new Error(`${file}: could not find the end of \`pub struct ${struct}\``);
    found.push({ file, fields: [...content.slice(bodyStart, bodyEnd).matchAll(FIELD)].map(m => m[1]) });
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
for (const [declaredIn, content] of sources) {
  for (const [, struct] of content.matchAll(TABLE_DECL)) {
    tables.push({ struct, declaredIn, fields: structFields(struct) });
  }
}
tables.sort((a, b) => a.struct.localeCompare(b.struct));

const dispatched = new Set<string>();
for (const content of sources.values()) {
  for (const [, field] of content.matchAll(DISPATCH)) dispatched.add(field);
}

test("hook tables covered by this lint", () => {
  // Inventory, so that a table whose declaration stops matching TABLE_DECL
  // fails here instead of silently dropping out of the checks below.
  expect(tables.map(t => `${t.struct} (${t.declaredIn})`)).toEqual([
    "LoaderHooks (src/jsc/ModuleLoader.rs)",
    "RuntimeHooks (src/jsc/VirtualMachine.rs)",
    "SqlRuntimeHooks (src/sql_jsc/jsc.rs)",
  ]);
});

for (const { struct, declaredIn, fields } of tables) {
  test(`every field of ${struct} is dispatched`, () => {
    expect(fields).not.toBeEmpty();
    const undispatched = fields.filter(field => !dispatched.has(field));
    if (undispatched.length > 0) {
      throw new Error(
        `${struct} (${declaredIn}) has hook fields that nothing dispatches: ${undispatched.join(", ")}\n` +
          `A hook field has to be called somewhere as \`(hooks.${undispatched[0]})(..)\`. If nothing calls it, ` +
          `delete the field and the body that bun_runtime installs for it in the __BUN_* static.`,
      );
    }
  });
}
