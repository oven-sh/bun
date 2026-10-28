import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const tsconfig = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    types: [],
  },
});

const declarations = `declare const console: { log(...values: unknown[]): void };
declare const require: (specifier: string) => unknown;
`;

// TODO: node:timers/promises holds typed functions.
(unsupported ? test.skip : test.todo)(
  "the written types of Bun's own modules are predictions: only the program holds typed functions",
  async () => {
    const specifiers = builtinModules
      .filter(name => name !== "bun:test" && name !== "bun")
      .map(name => (name.includes(":") || name === "undici" || name === "ws" ? name : "node:" + name))
      .concat("node:test");
    const required = [...new Set(specifiers)].sort().map(specifier => `require(${JSON.stringify(specifier)})`);
    using dir = tempDir("aot-builtin-modules", {
      "tsconfig.json": tsconfig,
      "main.ts": `${declarations}function addInProgram(a: number, b: number): number {\n  return a + b;\n}\nconsole.log(addInProgram, [${required.join(", ")}]);\n`,
    });
    const map = join(String(dir), "image.map");
    const { stderr, exitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "main"],
      String(dir),
      { ...bunEnv, BUN_JSC_aotMapFilePath: map },
    );
    expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
      stderr: [],
      exitCode: 0,
    });
    const functions = readFileSync(map, "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(fields => fields[0] === "F")
      .map(fields => ({ name: fields[7], kind: fields[8], module: fields[10] }));
    const modulesOf = (selected: typeof functions) => [...new Set(selected.map(({ module }) => module))].sort();
    const programModules = modulesOf(functions.filter(({ name }) => name === "addInProgram"));
    expect(programModules.length).toBe(1);
    const libraryModules = modulesOf(functions.filter(({ kind }) => kind === "library" || kind === "generic-library"));
    expect(libraryModules.length).toBeGreaterThan(100);
    for (const specifier of ["node:fs", "node:http", "node:events"]) expect(libraryModules).toContain(specifier);
    expect(libraryModules).not.toContain(programModules[0]);
    expect(
      modulesOf(functions.filter(({ kind }) => kind === "typed" || kind === "generic-typed")).filter(
        module => !programModules.includes(module),
      ),
    ).toEqual([]);
  },
  120_000,
);
