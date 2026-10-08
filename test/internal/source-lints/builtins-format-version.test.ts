// The private names a builtin module may use, by builtins format version.
//
// `bun build --compile --bytecode --target=<a bun of another version>` parses
// the builtin modules of the target executable in the host's VM, and JSC's
// lexer crashes on a private name (`@name`) that VM does not have. The one
// thing a host checks before it parses them is the format version of the
// target's builtins section: BUILTINS_FORMAT_VERSION in
// src/codegen/bundle-modules.ts writes it, FORMAT_VERSION in
// src/exe_format/builtins.rs reads it. So every bun that reads a version has
// to have every Bun private name that the modules of that version use.
//
// The inventory is the rows of BunBuiltinNames.h when the version last
// changed: every bun that reads the version has them. A builtin module may use
// those rows, and none of them may go away.
//
// If this fails because a builtin module uses a newer row, or because a row of
// the inventory is gone: bump both versions, then regenerate the inventory:
//   bun ./test/internal/source-lints/builtins-format-version.test.ts --update

import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/builtins-format-version.inventory.json";
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const writer = Number(read("src/codegen/bundle-modules.ts").match(/^const BUILTINS_FORMAT_VERSION = (\d+);$/m)?.[1]);
const reader = Number(read("src/exe_format/builtins.rs").match(/^const FORMAT_VERSION: u32 = (\d+);$/m)?.[1]);
const rows = [...read("src/js/builtins/BunBuiltinNames.h").matchAll(/^\s*macro\(([\w$]+)\)/gm)].map(m => m[1]);

// A bare use of a name in globalsToPrefix is a use of the private name too: the builtin bundler rewrites it.
const prefixedList = read("src/codegen/replacements.ts").match(/globalsToPrefix = \[([^\]]*)\]/)?.[1] ?? "";
const prefixed = [...prefixedList.matchAll(/"([^"]+)"/g)].map(m => m[1]);

// The module list of src/codegen/internal-module-registry-scanner.ts.
const modules = ["internal-for-testing.ts"];
for (const dir of ["bun", "node", "thirdparty", "internal"]) {
  for (const file of new Glob("**/*.{ts,js}").scanSync({ cwd: path.join(root, "src", "js", dir) })) {
    if (!file.endsWith(".d.ts")) modules.push(dir + "/" + file);
  }
}
const sources = modules.map(file => read("src/js/" + file)).join("\n");
// One pass for every `$name`, one for the bare names. The character before is captured, not matched by a
// lookbehind, which is slow on this much text.
const used = new Set<string>();
for (const match of sources.matchAll(/(^|[^\w$])\$([A-Za-z_][\w$]*)/gm)) used.add(match[2]);
for (const match of sources.matchAll(new RegExp(`(^|[^\\w$.])(${prefixed.join("|")})(?![\\w$])`, "gm"))) {
  used.add(match[2]);
}

type Inventory = { formatVersion: number; privateNames: string[] };
const inventory: Inventory = await Bun.file(INVENTORY).json();

if (process.argv.includes("--update")) {
  if (writer !== reader || !(writer > inventory.formatVersion)) {
    console.error(
      `BUILTINS_FORMAT_VERSION is ${writer} and FORMAT_VERSION is ${reader}: ` +
        `set both to ${inventory.formatVersion + 1} first. The rows of version ${inventory.formatVersion} do not change.`,
    );
    process.exit(1);
  }
  await Bun.write(INVENTORY, JSON.stringify({ formatVersion: writer, privateNames: rows }, null, 2) + "\n");
  console.log(`Wrote ${rows.length} private names of version ${writer} to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

test("the scan finds the private names, the rewritten globals and the builtin modules", () => {
  expect({ rows: rows.length > 100, prefixed: prefixed.length > 10, modules: modules.length > 100 }).toEqual({
    rows: true,
    prefixed: true,
    modules: true,
  });
});

test("builtin modules use only the private names that every reader of the builtins format version has", () => {
  const known = new Set(inventory.privateNames);
  expect(
    {
      "BUILTINS_FORMAT_VERSION (src/codegen/bundle-modules.ts)": writer,
      "FORMAT_VERSION (src/exe_format/builtins.rs)": reader,
      "rows newer than the version that a builtin module uses": rows.filter(row => !known.has(row) && used.has(row)),
      "rows of the version that BunBuiltinNames.h no longer has": inventory.privateNames.filter(
        row => !rows.includes(row),
      ),
    },
    "Bump BUILTINS_FORMAT_VERSION and FORMAT_VERSION, then run " +
      "`bun ./test/internal/source-lints/builtins-format-version.test.ts --update`.",
  ).toEqual({
    "BUILTINS_FORMAT_VERSION (src/codegen/bundle-modules.ts)": inventory.formatVersion,
    "FORMAT_VERSION (src/exe_format/builtins.rs)": inventory.formatVersion,
    "rows newer than the version that a builtin module uses": [],
    "rows of the version that BunBuiltinNames.h no longer has": [],
  });
});
