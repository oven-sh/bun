import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { engineDirectory, engineFiles as generated } from "./engine-files.ts";

const bunRoot = resolve(import.meta.dir, "..", "..", "..");
const schemas = globAllSources().bindgen;
const testSchemas = schemas.filter(schema => schema.endsWith("_test.bind.ts")).map(schema => basename(schema));

interface Entry {
  path: string;
  kind: string;
  uses: { feature: string; isConditional?: boolean }[];
}

const nameOfClass = ({ path, kind }: Entry) =>
  (kind === "Prototype" ? path.replace(/\.prototype$/, "") : path).split(".").at(-1)!.replaceAll("%", "");

async function generate(): Promise<{ entries: Entry[]; bindings: string }> {
  using directory = tempDir("builtins-table", {});
  await using generator = Bun.spawn({
    cmd: [
      bunExe(),
      join(bunRoot, "src", "codegen", "builtins", "index.ts"),
      `--codegen-path=${directory}`,
      "--target=Linux",
      `--sources=${schemas.map(schema => `${crateOf(schema)}=${schema}`).join(",")}`,
      `--prebuilt-generated=${generated}`,
      `--engine-directory=${engineDirectory}`,
      `--types-only=${testSchemas.join(",")}`,
    ],
    cwd: bunRoot,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await generator.exited).toBe(0);
  const { entries } = JSON.parse(readFileSync(join(String(directory), "builtin-uses.json"), "utf8")) as {
    entries: Entry[];
  };
  return { entries, bindings: readFileSync(join(String(directory), "BunAOTHostBindings.cpp"), "utf8") };
}

test.skipIf(generated === undefined)(
  "a pointer to a member of a removable class is recorded as its feature's",
  async () => {
    const { entries, bindings } = await generate();
    const removableClasses = new Set(
      entries
        .filter(
          ({ kind, uses }) => (kind === "Constructor" || kind === "Prototype") && uses.some(use => !use.isConditional),
        )
        .map(nameOfClass),
    );
    expect(removableClasses.size).toBeGreaterThan(20);

    const pointers = Array.from(
      bindings.matchAll(/reinterpret_cast<const void\*>\((\w+?)Prototype__(\w+)\)/g),
      ([, className, member]) => ({
        className,
        symbol: `${className}Prototype__${member}`,
      }),
    );
    const recorded = new Set(
      Array.from(
        bindings.matchAll(
          /recordRemovableTableEntry<Bun::AOTHostBindings::directFunctions, [\w:]+, [\w:]+, (\w+)[,>]/g,
        ),
        ([, symbol]) => symbol,
      ),
    );
    expect(pointers.length).toBeGreaterThan(500);
    expect(
      pointers
        .filter(({ className, symbol }) => removableClasses.has(className) && !recorded.has(symbol))
        .map(({ symbol }) => symbol),
    ).toEqual([]);
  },
  120_000,
);

test.skipIf(generated === undefined)(
  "a pointer to a function of a namespace is recorded as the feature's of the $bindgen that hands the namespace out",
  async () => {
    const { entries, bindings } = await generate();
    const featureOfBinding = new Map(
      entries.flatMap(({ path, uses }) => {
        const [, file, name] = /^native:Bindgen:(\w+)\.bind\.ts:(\w+)$/.exec(path) ?? [];
        const feature = uses.find(use => !use.isConditional)?.feature;
        return file === undefined || feature === undefined ? [] : [[`${file} ${name}`, feature] as const];
      }),
    );
    const cppNamespaceOf = (file: string) => file.replace(/(?:^|_)(\w)/g, (_, letter: string) => letter.toUpperCase());
    const expected: string[] = [];
    for (const schema of schemas) {
      const file = basename(schema, ".bind.ts");
      const text = readFileSync(schema, "utf8");
      for (const [, name] of text.matchAll(/^export const (\w+) = b\.namespace\(/gm)) {
        const feature = featureOfBinding.get(`${file} ${name}`);
        if (feature !== undefined) expected.push(`${feature} ${cppNamespaceOf(file)}`);
      }
    }
    expect(expected).toContain("InternalForTesting InstallBinding");
    expect(expected.length).toBeGreaterThan(5);

    const held = new Set(
      Array.from(bindings.matchAll(/\.function = (Bun::Bindgen::Generated::\w+::\w+)/g), ([, symbol]) => symbol),
    );
    const recorded = new Set(
      Array.from(
        bindings.matchAll(
          /recordRemovableTableEntry<Bun::AOTHostBindings::nativeFunctions, Bun::Feature::(\w+), [\w:]+, ([\w:]+)[,>]/g,
        ),
        ([, feature, symbol]) => `${feature} ${symbol}`,
      ),
    );
    for (const line of expected) {
      const [feature, cppNamespace] = line.split(" ");
      const functions = [...held].filter(symbol => symbol.startsWith(`Bun::Bindgen::Generated::${cppNamespace}::`));
      expect(functions.filter(symbol => !recorded.has(`${feature} ${symbol}`))).toEqual([]);
    }
  },
  120_000,
);
