import { file } from "bun";
import { describe, expect, test } from "bun:test";
import path from "path";

// `console.log`, `Bun.inspect`, the uncaught-error printer and the `bun:test` diffs and snapshots
// print any value a program can build, so every read a printer makes on its own account is a read of
// hostile input: a getter that throws replaces the assertion error, a `length` of 2^32 or an iterator
// that never ends hangs the process, a `toString` that returns a Symbol aborts a debug build, and
// listing a Map iterator through `next()` uses up the caller's iterator.
//
// `src/jsc/formatter/reader.rs` holds the reads that run no user code (own data properties, internal
// slots, collection storage, the one property walk) and the few bounded ones that do. A printer reads
// through it. The other guard, that every nested value passes `Formatter::enter`, needs no lint: a
// printer takes the `Entered` token only `enter` can make.
//
// This is a ratchet: `formatter-reads.inventory.json` counts what is left per file and pattern, which
// is the hooks the user asked to have called (`inspect.custom`, `toJSON`, `JSON.stringify`), string
// conversions of values already known to be primitives, and the cells of `console.table`. New ones
// fail the test; removing one requires lowering its count (the test tells you). Regenerate with
// `bun test/internal/source-lints/formatter-reads.test.ts --update` (run as a script) only when removing.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/formatter-reads.inventory.json";
const PRINTERS = ["src/jsc/ConsoleObject.rs", "src/jsc/formatter/guard.rs", "src/jsc/formatter/jest.rs"];

const PATTERNS: [name: string, re: RegExp][] = [
  [
    "property read that can run a getter or a Proxy trap",
    /\.(?:get|get_own|get_own_truthy|get_truthy|fast_get|get_index|get_length|get_if_property_exists|get_stringish)\(\s*(?:self\.|this\.formatter\.|formatter\.)?global/,
  ],
  ["iterator protocol", /\.(?:for_each|is_iterable)\(\s*(?:self\.|this\.formatter\.|formatter\.)?global/],
  [
    "conversion that can run toString, valueOf or Symbol.toPrimitive",
    /\.(?:to_js_string_view|to_bun_string|to_utf8|to_object|coerce_to_\w+|json_stringify\w*)\(\s*(?:self\.|this\.formatter\.|formatter\.)?global|\bBunString::from_js\(/,
  ],
  ["call into script", /\.call\(\s*(?:self\.|this\.formatter\.|formatter\.)?global/],
];

type Inventory = Record<string, Record<string, number>>;
const found: Inventory = {};
const sites: string[] = [];

for (const source of PRINTERS) {
  const lines = (await file(path.join(root, source)).text()).split("\n");
  for (let i = 0; i < lines.length; i++) {
    // rustfmt breaks a long call after the `(`.
    const line = lines[i].trimEnd().endsWith("(") ? lines[i].trimEnd() + (lines[i + 1] ?? "").trim() : lines[i];
    if (/^\s*\/\//.test(line)) continue;
    for (const [name, re] of PATTERNS) {
      if (re.test(line)) {
        (((found[source] ??= {})[name] ??= 0), found[source][name]++);
        sites.push(`${source}:${i + 1}: ${name}: ${line.trim()}`);
      }
    }
  }
}

if (process.argv.includes("--update")) {
  const sorted: Inventory = {};
  for (const f of Object.keys(found).sort()) {
    sorted[f] = {};
    for (const n of Object.keys(found[f]).sort()) sorted[f][n] = found[f][n];
  }
  await Bun.write(INVENTORY, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Inventory = await file(INVENTORY)
  .json()
  .catch(() => ({}));

describe("reads in the value formatter's printers (ratchet)", () => {
  test("the patterns still match something", () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  test("no new read that runs user code", () => {
    const grown: string[] = [];
    for (const [f, byName] of Object.entries(found)) {
      for (const [name, count] of Object.entries(byName)) {
        const allowed = inventory[f]?.[name] ?? 0;
        if (count > allowed) {
          grown.push(`${f}: "${name}" ${allowed} → ${count}`);
          for (const s of sites) if (s.startsWith(f + ":") && s.includes(name)) grown.push("    " + s);
        }
      }
    }
    expect(grown, "read it through src/jsc/formatter/reader.rs — see the header of this test").toEqual([]);
  });

  test("inventory shrinks when a read is removed", () => {
    const stale: string[] = [];
    for (const [f, byName] of Object.entries(inventory)) {
      for (const [name, allowed] of Object.entries(byName)) {
        const count = found[f]?.[name] ?? 0;
        if (count < allowed) stale.push(`${f}: "${name}" is ${count} now, inventory says ${allowed} — lower it`);
      }
    }
    expect(stale).toEqual([]);
  });
});
