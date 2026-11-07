// Two builds of a program that imports WebAssembly modules give the same executable, byte for byte. Each build is a process of its own, with
// its own addresses: an address of the compiling process that is left in the code of a module (a callee, a type, a function of the run time,
// a table of jumps, the base of the structures) differs between the two. The modules are those of parallel/webassembly, one for each feature.
import { describe, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const stored = join(import.meta.dir, "parallel", "webassembly");
const modules = [
  "branch-tables/module",
  "bulk-operations/module",
  "exceptions/legacy",
  "exceptions/tables",
  "gc-objects/module",
  "javascript-imports/module",
  "several-memories/module",
  "shared-memory-atomics/module",
  "start-and-globals/module",
  "tail-calls-between-instances/module",
  "vectors/module",
];

const sources = {
  "entry.ts": `/// <reference path=${JSON.stringify(join(stored, "wasm-files.d.ts"))} />
${modules.map((name, index) => `import path${index} from ${JSON.stringify(join(stored, name + ".wasm"))};`).join("\n")}
console.log([${modules.map((_, index) => "path" + index).join(", ")}].length);
`,
};

describe.skipIf(!!unsupported)("compile/aot/wasm-same-bytes", () => {
  const folder = String(tempDir("aot-wasm-same-bytes", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test("two builds are equal", async () => {
    await slot(async () => {
      const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
      const hashes: string[] = [];
      for (let build = 0; build < 2; build++) {
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...withoutDebugInformation,
              "--aot",
              "./entry.ts",
              "--outfile",
              executable,
            ],
            folder,
            bunEnv,
          ),
        );
        hashes.push(Bun.hash(readFileSync(executable)).toString(16));
        rmSync(executable);
      }
      expect(hashes[1]).toBe(hashes[0]);
    });
  }, 600_000);
});
