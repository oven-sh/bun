import { file } from "bun";
import { describe, expect, test } from "bun:test";
import path from "path";

// A module key is `<path>` or `<path>?<query>`. It is one string: also `__filename`, and the key in
// `require.cache`. A `?` is a legal byte in a file or folder name on POSIX, so `<path>` does not end at
// the first `?` of the key (https://github.com/oven-sh/bun/issues/7928).
//
// Where it ends is decided once. `VirtualMachine::_resolve` decides it from who wrote the specifier, and
// `VirtualMachine::module_key_path_len` answers it for a key (`Bun__VM__moduleKeyPathLength` in C++,
// `jsFunctionModuleKeyPathLength` in a builtin). Code that cuts a key at a `?` it found by itself loads
// the wrong file, or none.
//
// This is a ratchet over the files that make or read module keys. The inventory counts the lines of each
// file that name the `?` character. A new line fails the test: ask `module_key_path_len` instead. Raise
// a count in the same change only for a line that cannot cut a key (it asks if the key has a `?` at all,
// to skip the call). Write the inventory again with
// `bun test/internal/source-lints/module-key-query.test.ts --update` (run as a script).

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/module-key-query.inventory.json";
const FILES = [
  "src/bundler/options.rs",
  "src/js/builtins/BundlerPlugin.ts",
  "src/js/builtins/CommonJS.ts",
  "src/jsc/JSGlobalObject.rs",
  "src/jsc/ModuleLoader.rs",
  "src/jsc/NodeModuleModule.rs",
  "src/jsc/VirtualMachine.rs",
  "src/jsc/bindings/BunPlugin.cpp",
  "src/jsc/bindings/ImportMetaObject.cpp",
  "src/jsc/bindings/JSCommonJSExtensions.cpp",
  "src/jsc/bindings/JSCommonJSModule.cpp",
  "src/jsc/bindings/ModuleLoader.cpp",
  "src/jsc/bindings/ZigGlobalObject.cpp",
  "src/jsc/modules/NodeModuleModule.cpp",
  "src/jsc/resolver_jsc.rs",
  "src/resolver/resolver.rs",
  "src/runtime/api/BunObject.rs",
  "src/runtime/jsc_hooks.rs",
];
// `b'?'` in Rust, `'?'` in C++, `"?"` in TypeScript.
const QUESTION_MARK = /'\?'|"\?"/;

type Inventory = Record<string, number>;
const found: Inventory = {};
const sites: string[] = [];

for (const source of FILES) {
  const lines = (await file(path.join(root, source)).text()).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(\/\/|\/\*|\*)/.test(lines[i]) || !QUESTION_MARK.test(lines[i])) continue;
    found[source] = (found[source] ?? 0) + 1;
    sites.push(`${source}:${i + 1}: ${lines[i].trim()}`);
  }
}

if (process.argv.includes("--update")) {
  await Bun.write(INVENTORY, JSON.stringify(found, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(found).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Inventory = await file(INVENTORY).json();

describe("the `?` of a module key (ratchet)", () => {
  test("no new line looks for a `?` in the files that make or read module keys", () => {
    const grown: string[] = [];
    for (const [source, count] of Object.entries(found)) {
      const allowed = inventory[source] ?? 0;
      if (count > allowed) {
        grown.push(`${source}: ${allowed} → ${count}`);
        for (const site of sites) if (site.startsWith(source + ":")) grown.push("    " + site);
      }
    }
    expect(
      grown,
      "ask VirtualMachine::module_key_path_len where the path of a module key ends — see the header of this test",
    ).toEqual([]);
  });

  test("the inventory shrinks when a line is removed", () => {
    const stale: string[] = [];
    for (const [source, allowed] of Object.entries(inventory)) {
      const count = found[source] ?? 0;
      if (count < allowed) stale.push(`${source}: is ${count} now, the inventory says ${allowed} — lower it`);
    }
    expect(stale).toEqual([]);
  });
});
