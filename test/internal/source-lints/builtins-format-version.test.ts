import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `bun build --compile --bytecode` compiles the builtin modules of the target executable in the host's VM, which
// knows the host's private names (`@name`) and no others. A host older than the target crashes in JSC's lexer on a
// name the target's modules started to use since. The version of the target's builtins section is the one thing such
// a host checks before it parses that source, so the first use of a Bun private name in a builtin module has to
// come with a bump of the version: the writer is BUILTINS_FORMAT_VERSION in src/codegen/bundle-modules.ts, the
// reader is FORMAT_VERSION in src/exe_format/builtins.rs. This lint holds the two equal and pins the names.
const PINNED = {
  formatVersion: 2,
  privateNamesInModules: [
    "AbortSignal",
    "Buffer",
    "ReadableByteStreamController",
    "ReadableStream",
    "ReadableStreamBYOBReader",
    "ReadableStreamBYOBRequest",
    "ReadableStreamDefaultController",
    "ReadableStreamDefaultReader",
    "TransformStream",
    "TransformStreamDefaultController",
    "WritableStream",
    "WritableStreamDefaultController",
    "WritableStreamDefaultWriter",
    "bunNativePtr",
    "clearImmediate",
    "createFIFO",
    "data",
    "fastPath",
    "kResistStopPropagation",
    "makeAbortError",
    "min",
    "peekPromiseSettledValue",
    "peekPromiseStatus",
    "pokePromiseAsHandled",
    "processBindingConstants",
    "queueMicrotask",
    "requireMap",
    "setImmediate",
    "size",
    "start",
    "toClass",
    "webStreamClosedPromise",
    "webStreamControllerError",
    "write",
  ],
};

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

test("the builtins section format version covers the private names builtin modules use", () => {
  const writer = Number(read("src/codegen/bundle-modules.ts").match(/^const BUILTINS_FORMAT_VERSION = (\d+);$/m)?.[1]);
  const reader = Number(read("src/exe_format/builtins.rs").match(/^const FORMAT_VERSION: u32 = (\d+);$/m)?.[1]);

  // Bun's private names: the rows of BunBuiltinNames.h. A bare use of a name in globalsToPrefix is a use of the
  // private name too, because the builtin bundler rewrites it.
  const registered = [...read("src/js/builtins/BunBuiltinNames.h").matchAll(/^\s*macro\(([\w$]+)\)/gm)].map(m => m[1]);
  const prefixedList = read("src/codegen/replacements.ts").match(/globalsToPrefix = \[([^\]]*)\]/)?.[1] ?? "";
  const prefixed = new Set([...prefixedList.matchAll(/"([^"]+)"/g)].map(m => m[1]));

  let modules = "";
  let moduleCount = 0;
  for (const dir of ["node", "internal", "bun", "thirdparty"]) {
    const cwd = path.join(repoRoot, "src", "js", dir);
    for (const rel of new Glob("**/*.{ts,js}").scanSync({ cwd })) {
      if (rel.endsWith(".d.ts")) continue;
      modules += readFileSync(path.join(cwd, rel), "utf8") + "\n";
      moduleCount++;
    }
  }
  // One pass for every `$name`, one for the bare names. The leading character is captured instead of using a
  // lookbehind, which is slow on this much text.
  const uses = new Set<string>();
  for (const match of modules.matchAll(/(^|[^\w$])\$([A-Za-z_][\w$]*)/gm)) uses.add(match[2]);
  const bare = new RegExp(`(^|[^\\w$.])(${[...prefixed].join("|")})(?![\\w$])`, "gm");
  for (const match of modules.matchAll(bare)) uses.add(match[2]);
  const used = registered.filter(name => uses.has(name)).sort();

  // Guards against the scan going vacuous if these files move.
  expect({ registered: registered.length > 100, prefixed: prefixed.size > 10, modules: moduleCount > 100 }).toEqual({
    registered: true,
    prefixed: true,
    modules: true,
  });
  expect({
    "names builtin modules started to use: bump both format versions, then update PINNED": used.filter(
      name => !PINNED.privateNamesInModules.includes(name),
    ),
    "names builtin modules no longer use: update PINNED": PINNED.privateNamesInModules.filter(
      name => !used.includes(name),
    ),
    "BUILTINS_FORMAT_VERSION (src/codegen/bundle-modules.ts)": writer,
    "FORMAT_VERSION (src/exe_format/builtins.rs)": reader,
  }).toEqual({
    "names builtin modules started to use: bump both format versions, then update PINNED": [],
    "names builtin modules no longer use: update PINNED": [],
    "BUILTINS_FORMAT_VERSION (src/codegen/bundle-modules.ts)": PINNED.formatVersion,
    "FORMAT_VERSION (src/exe_format/builtins.rs)": PINNED.formatVersion,
  });
});
