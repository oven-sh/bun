import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { openTypesFlags } from "./open-types";
import { built, slot, spawned, told, unsupported } from "./run-programs";

const host = join(import.meta.dir, "typed-packages", "react-reconciler-host");
const typedVersion = join(host, "typed-bundle");
const typedFile = "node_modules/react-reconciler/cjs/react-reconciler.production.ts";
const typedModulePath = (isWindows ? "B:/~BUN/root/" : "/$bunfs/root/") + typedFile;
const flags = ["--define", `process.env.NODE_ENV="production"`, "--outfile", "app"];

describe.skipIf(!!unsupported)("compile/aot/typed-packages", () => {
  const folders: string[] = [];
  afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));

  function project(name: string) {
    const folder = String(tempDir(name, {}));
    folders.push(folder);
    for (const file of ["main.ts", "with-look-alikes.ts", "modules.d.ts", "tsconfig.json"])
      cpSync(join(host, file), join(folder, file));
    mkdirSync(join(folder, "node_modules"));
    for (const name of ["react", "scheduler"])
      cpSync(join(host, "stand-ins", name), join(folder, "node_modules", name), { recursive: true });
    cpSync(typedVersion, join(folder, "node_modules", "react-reconciler"), { recursive: true });
    writeFileSync(
      join(folder, "node_modules", "react-reconciler", "package.json"),
      JSON.stringify({ name: "react-reconciler", version: "0.33.0", main: "index.js" }),
    );
    return folder;
  }

  function compiledOf(map: string, modulePath: string) {
    const found = { typed: { bytes: 0, names: new Set<string>() }, untyped: { bytes: 0, names: new Set<string>() } };
    for (const line of readFileSync(map, "utf8").split("\n")) {
      const fields = line.split("\t");
      // A function as it is written is "typed" or "untyped", its general entry "generic-typed" or "generic-untyped". What the compiler makes of one (a result worker, a construct body ..) says neither.
      const [, word] = /^(?:generic-)?(typed|untyped)$/.exec(fields[8] ?? "") ?? [];
      if (fields[0] !== "F" || fields[10] !== modulePath || word === undefined) continue;
      const kind = word === "untyped" ? found.untyped : found.typed;
      kind.bytes += Number(fields[3]);
      kind.names.add(fields[7]);
    }
    return found;
  }
  const hot = [
    "beginWork",
    "completeWork",
    "bubbleProperties",
    "createWorkInProgress",
    "markUpdateLaneFromFiberToRoot",
    "getRootForUpdatedFiber",
    "propagateParentContextChanges",
    "propagateContextChanges",
    "checkIfContextChanged",
    "areHookInputsEqual",
    "updateWorkInProgressHook",
    "renderWithHooks",
    "commitRoot",
    "commitMutationEffectsOnFiber",
    "commitHookEffectListMount",
    "commitHookEffectListUnmount",
  ];
  function expectTyped(map: string) {
    const { typed, untyped } = compiledOf(map, typedModulePath);
    expect(typed.bytes).toBeGreaterThan(200_000);
    expect(untyped.bytes).toBeLessThan(typed.bytes / 50);
    expect(hot.filter(name => !typed.names.has(name) || untyped.names.has(name))).toEqual([]);
  }

  test(
    "the typed react-reconciler is compiled typed",
    () =>
      slot(async () => {
        const folder = project("aot-typed-reconciler");
        const map = join(folder, "app.map");
        const build = await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "main.ts"], folder, {
          ...bunEnv,
          BUN_JSC_aotMapFilePath: map,
        });
        built(build);
        expect(build.stdout + build.stderr).not.toMatch(/compiled (untyped|without (its |their )?types)/);
        expectTyped(map);
        const compiled = await spawned([join(folder, "app")], folder, {
          ...bunEnv,
          BUN_JSC_crashIfInterpreterIsUsed: "1",
        });
        expect(compiled.signal).toBeNull();
        const plain = await spawned([bunExe(), "run", "main.ts"], folder, bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        expect(plain.stdout).toContain("commit <root><app>count 4<list 1,3>");
        expect(told(compiled)).toEqual(told(plain));
      }),
    600_000,
  );

  const typesInstalled: Record<string, (folder: string) => object> = {
    "a bun-types without int32": folder => {
      const types = join(folder, "node_modules", "@types", "bun");
      mkdirSync(types, { recursive: true });
      writeFileSync(
        join(types, "package.json"),
        JSON.stringify({ name: "@types/bun", version: "1.0.0", types: "index.d.ts" }),
      );
      writeFileSync(join(types, "index.d.ts"), `declare module "bun" { function inspect(value: unknown): string; }\n`);
      return { types: ["bun"] };
    },
    "the bun-types of this repository": () => ({
      typeRoots: [join(import.meta.dir, "..", "..", "packages")],
      types: ["bun-types"],
    }),
  };
  for (const [installedTypes, install] of Object.entries(typesInstalled))
    test(
      `the typed react-reconciler is compiled typed with ${installedTypes}`,
      () =>
        slot(async () => {
          expect(readFileSync(join(typedVersion, "cjs", "react-reconciler.production.ts"), "utf8")).toContain(
            `type int32 = import("bun").int32;`,
          );
          const folder = project("aot-typed-reconciler-types");
          const options = JSON.parse(readFileSync(join(folder, "tsconfig.json"), "utf8"));
          Object.assign(options.compilerOptions, install(folder));
          writeFileSync(join(folder, "tsconfig.json"), JSON.stringify(options));
          const map = join(folder, "app.map");
          const build = await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "main.ts"], folder, {
            ...bunEnv,
            BUN_JSC_aotMapFilePath: map,
          });
          built(build);
          expect(build.stdout + build.stderr).not.toMatch(/compiled (untyped|without (its |their )?types)/);
          expectTyped(map);
        }),
      600_000,
    );

  test(
    "the reconciler runs as plain Bun beside look-alikes of its records",
    () =>
      slot(async () => {
        const folder = project("aot-typed-reconciler-look-alikes");
        const build = await spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, "with-look-alikes.ts"],
          folder,
          bunEnv,
        );
        built(build);
        expect(build.stdout + build.stderr).not.toMatch(/compiled (untyped|without (its |their )?types)/);
        const compiled = await spawned([join(folder, "app")], folder, {
          ...bunEnv,
          BUN_JSC_crashIfInterpreterIsUsed: "1",
        });
        expect(compiled.signal).toBeNull();
        expect(told(compiled)).toEqual(told(await spawned([bunExe(), "run", "with-look-alikes.ts"], folder, bunEnv)));
      }),
    600_000,
  );

  // TODO: the records are open as soon as the look-alikes are in the program.
  test.todo(
    "the records that an update walks stay closed in a program with look-alikes",
    () =>
      slot(async () => {
        const folder = project("aot-typed-reconciler-records");
        const build = await spawned(
          [bunExe(), "build", "--compile", "--aot", ...openTypesFlags, ...flags, "with-look-alikes.ts"],
          folder,
          bunEnv,
        );
        built(build);
        const said = build.stdout + build.stderr;
        // `aot: unknown-code: read-from-shared-object at main.ts:1:2, 1 access, types 'Hook', why written-by-runtime-code`
        const explained =
          /^aot: (?:unknown-code|unproven-type): [a-z-]+ at .+?:\d+:\d+, [\d,]+ access(?:es)?, types ('.+?'(?:, '.+?')*)/gm;
        const open = new Set(
          [...said.matchAll(explained)].flatMap(([, names]) => names.split(", ").map(name => name.slice(1, -1))),
        );
        // The data from outside is explained, which shows that the report is read.
        expect(said).toMatch(/^aot: unproven-type: unexpected-shape at with-look-alikes\.ts:/m);
        const walked = [
          "FiberNode",
          "FiberRootNode",
          "Hook",
          "HookQueue",
          "Effect",
          "FunctionComponentUpdateQueue",
          "Update",
          "UpdateQueue",
          "SharedQueue",
          "ContextDependency",
          "StackCursor",
        ];
        expect(walked.filter(name => open.has(name))).toEqual([]);
      }),
    600_000,
  );

  test(
    "a package of TypeScript files that has no typed version falls back to untyped, says why, and the compile line counts it",
    () =>
      slot(async () => {
        const folder = project("aot-typed-reconciler-falls");
        appendFileSync(join(folder, typedFile), `\nexport const wrong: number = "a string";\n`);
        const map = join(folder, "app.map");
        const build = await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "main.ts"], folder, {
          ...bunEnv,
          BUN_JSC_aotMapFilePath: map,
        });
        built(build);
        const said = build.stdout + build.stderr;
        expect(said).toContain("TS100009: 'react-reconciler' has 1 type error (");
        expect(said).toContain("TS2322: Type 'string' is not assignable to type 'number'.");
        expect(said).toMatch(/compile +app(\.exe)? +1 file compiled without types/);
        const { typed, untyped } = compiledOf(map, typedModulePath);
        expect(untyped.bytes).toBeGreaterThan(typed.bytes * 50);
        const compiled = await spawned([join(folder, "app")], folder, {
          ...bunEnv,
          BUN_JSC_crashIfInterpreterIsUsed: "1",
        });
        expect(compiled.signal).toBeNull();
        expect(told(compiled)).toEqual(told(await spawned([bunExe(), "run", "main.ts"], folder, bunEnv)));
      }),
    600_000,
  );
});
