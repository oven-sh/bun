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

test.skipIf(generated === undefined)(
  "a pointer to a member of a removable class is recorded as its feature's",
  async () => {
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
    const removableClasses = new Set(
      entries
        .filter(
          ({ kind, uses }) => (kind === "Constructor" || kind === "Prototype") && uses.some(use => !use.isConditional),
        )
        .map(nameOfClass),
    );
    expect(removableClasses.size).toBeGreaterThan(20);

    const bindings = readFileSync(join(String(directory), "BunAOTHostBindings.cpp"), "utf8");
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
