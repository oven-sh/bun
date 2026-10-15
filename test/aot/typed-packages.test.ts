import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./run-programs";

const host = join(import.meta.dir, "typed-packages", "react-reconciler-host");
const typedVersion = join(import.meta.dir, "..", "..", "packages", "bun-sound", "react-reconciler", "0.33.0", "lay");
const typedFile = "node_modules/react-reconciler/cjs/react-reconciler.production.ts";
const flags = ["--define", `process.env.NODE_ENV="production"`, "--outfile", "app"];

describe.skipIf(!!unsupported)("compile/aot/typed-packages", () => {
  const folders: string[] = [];
  afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));

  function project(name: string) {
    const folder = String(tempDir(name, {}));
    folders.push(folder);
    for (const file of ["main.ts", "with-look-alikes.ts", "modules.d.ts", "tsconfig.json"]) cpSync(join(host, file), join(folder, file));
    mkdirSync(join(folder, "node_modules"));
    for (const name of ["react", "scheduler"]) cpSync(join(host, "stand-ins", name), join(folder, "node_modules", name), { recursive: true });
    cpSync(typedVersion, join(folder, "node_modules", "react-reconciler"), { recursive: true });
    writeFileSync(join(folder, "node_modules", "react-reconciler", "package.json"), JSON.stringify({ name: "react-reconciler", version: "0.33.0", main: "index.js" }));
    return folder;
  }

  function compiledOf(map: string, file: string) {
    const found = { typed: { bytes: 0, names: new Set<string>() }, untyped: { bytes: 0, names: new Set<string>() } };
    for (const line of readFileSync(map, "utf8").split("\n")) {
      const fields = line.split("\t");
      if (fields[0] !== "F" || fields[10] !== file || fields[8] === "module") continue;
      const kind = fields[8].includes("untyped") ? found.untyped : found.typed;
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
    "reconcileChildFibersImpl",
    "commitRoot",
    "commitMutationEffectsOnFiber",
    "commitHookEffectListMount",
    "commitHookEffectListUnmount",
  ];
  function expectTyped(map: string) {
    const { typed, untyped } = compiledOf(map, typedFile);
    expect(typed.bytes).toBeGreaterThan(200_000);
    expect(untyped.bytes).toBeLessThan(typed.bytes / 50);
    expect(hot.filter(name => !typed.names.has(name) || untyped.names.has(name))).toEqual([]);
  }

  test("the typed react-reconciler is compiled typed", () =>
    slot(async () => {
      const folder = project("aot-typed-reconciler");
      const map = join(folder, "app.map");
      const build = await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "main.ts"], folder, { ...bunEnv, BUN_JSC_aotMapFilePath: map });
      built(build);
      expect(build.stdout + build.stderr).not.toContain("compiled untyped");
      expectTyped(map);
      const compiled = await spawned([join(folder, "app")], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled.signal).toBeNull();
      const plain = await spawned([bunExe(), "run", "main.ts"], folder, bunEnv);
      expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
      expect(plain.stdout).toContain("commit <root><app>count 4<list 1,3>");
      expect(told(compiled)).toEqual(told(plain));
    }), 600_000);

  test("the records that an update walks admit no object from outside, whatever the program is given", () =>
    slot(async () => {
      const folder = project("aot-typed-reconciler-records");
      const build = await spawned([bunExe(), "build", "--compile", "--aot", "--aot-explain=foreign", ...flags, "with-look-alikes.ts"], folder, bunEnv);
      built(build);
      expect(build.stdout + build.stderr).not.toContain("compiled untyped");
      const open = (build.stdout + build.stderr).split("\n").flatMap(line => /^aot: foreign: ([A-Za-z]+):/.exec(line)?.[1] ?? []);
      expect(open).toContain("ConcurrentQueue");
      const walked = ["Fiber", "FiberRoot", "Hook", "HookQueue", "Effect", "FunctionComponentUpdateQueue", "Update", "UpdateQueue", "SharedQueue", "ContextDependency", "StackCursor"];
      expect(walked.filter(name => open.includes(name))).toEqual([]);
      const compiled = await spawned([join(folder, "app")], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled.signal).toBeNull();
      expect(told(compiled)).toEqual(told(await spawned([bunExe(), "run", "with-look-alikes.ts"], folder, bunEnv)));
    }), 600_000);

  test("a package of TypeScript files that has no typed version falls back to untyped, says why, and the compile line counts it", () =>
    slot(async () => {
      const folder = project("aot-typed-reconciler-falls");
      appendFileSync(join(folder, typedFile), `\nexport const wrong: number = "a string";\n`);
      const map = join(folder, "app.map");
      const build = await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "main.ts"], folder, { ...bunEnv, BUN_JSC_aotMapFilePath: map });
      built(build);
      const said = build.stdout + build.stderr;
      expect(said).toContain("TS100009: 'react-reconciler' has 1 type errors");
      expect(said).toContain("TS2322: Type 'string' is not assignable to type 'number'.");
      expect(said).toMatch(/compile +app +1 compiled untyped/);
      const { typed, untyped } = compiledOf(map, typedFile);
      expect(untyped.bytes).toBeGreaterThan(typed.bytes * 50);
      const compiled = await spawned([join(folder, "app")], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled.signal).toBeNull();
      expect(told(compiled)).toEqual(told(await spawned([bunExe(), "run", "main.ts"], folder, bunEnv)));
    }), 600_000);
});
