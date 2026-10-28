// Text that is evaluated at run time has import(). Under any name it finds an entry point of the build, which then works on whatever the text hands it.
// It finds a data file of the executable only in a program that itself loads files by a dynamic name, as in an executable built without --aot.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    resolveJsonModule: true,
  },
});

const prelude = `declare var process: { argv: string[] };
async function evaluate(source: string) {
  try {
    console.log(String(await (0, eval)(process.argv.length > 99 ? "1" : source)));
  } catch (error) {
    console.log("threw " + (error as { code?: string }).code);
  }
}
`;
const computedRequire = `declare var require: (name: string) => unknown;\ntry {\n  console.log(typeof require(process.argv[5] ?? "node:path"));\n} catch {}\n`;

const library = `export function twice(x: number) {\n  return x * 2;\n}\nexport const table = {\n  size: 3,\n  grow(by: number) {\n    this.size += by;\n    return this.size;\n  },\n};\n`;
const callsEntryPoint = `import { table, twice } from "./library";
${prelude}console.log(twice(2), table.grow(1));
const path = JSON.stringify(import.meta.resolve("./library"));
await evaluate(\`import(\${path}).then(m => m.twice("ab"))\`);
await evaluate(\`import(\${path}).then(m => m.twice({ valueOf() { return 4; } }))\`);
await evaluate(\`import(\${path}).then(m => m.table.grow("x"))\`);
await evaluate(\`import(\${path}).then(m => Object.keys(m).join())\`);
console.log(table.size, twice(5));
`;
const changesData = `import data from "./data.json";
${prelude}function sum() {
  let total: unknown = 0;
  for (const each of data.list) total = (total as number) + each;
  return total;
}
console.log(sum(), data.name);
const path = JSON.stringify(import.meta.resolve("./data.json"));
await evaluate(\`import(\${path}).then(m => { m.default.list[0] = "changed"; m.default.name = 7; m.default.extra = 1; return Object.keys(m.default).join(); })\`);
console.log(sum(), data.name, Object.keys(data).join());
`;

const cases: Record<string, { main: string; entryPoints?: string[]; output: string }> = {
  "an entry point, in a program with no dynamic name": {
    main: callsEntryPoint,
    entryPoints: ["library.ts"],
    output: "4 4\nNaN\n8\n4x\ntable,twice\n4x 10\n",
  },
  "an entry point, in a program with a dynamic require": {
    main: callsEntryPoint + computedRequire,
    entryPoints: ["library.ts"],
    output: "4 4\nNaN\n8\n4x\ntable,twice\n4x 10\nobject\n",
  },
  "no data file, in a program with no dynamic name": {
    main: changesData,
    output: "6 first\nthrew ERR_MODULE_NOT_FOUND\n6 first list,name\n",
  },
  "a data file, in a program with a dynamic require": {
    main: changesData + computedRequire,
    output: "6 first\nlist,name,extra\n0changed23 7 list,name,extra\nobject\n",
  },
};

describe.concurrent("compile/aot/what evaluated text loads by name", () => {
  for (const [name, { main, entryPoints = [], output }] of Object.entries(cases)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-what-evaluated-text-loads-by-name", {
            "main.ts": main,
            "library.ts": library,
            "data.json": `{ "list": [1, 2, 3], "name": "first" }\n`,
            "tsconfig.json": tsconfig,
          });
          const folder = String(dir);
          const executable = join(folder, isWindows ? "program.exe" : "program");
          built(
            await spawned(
              [bunExe(), ...compileCommand, "main.ts", ...entryPoints, "--outfile", executable],
              folder,
              bunEnv,
            ),
          );
          const ran = await spawned([executable], folder, bunEnv);
          expect({ signal: ran.signal, exitCode: ran.exitCode, stdout: ran.stdout }).toEqual({
            signal: null,
            exitCode: 0,
            stdout: output,
          });
        }),
      600_000,
    );
  }
});
