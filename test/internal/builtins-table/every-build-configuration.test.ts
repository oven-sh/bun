import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename, join, resolve } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const bunRoot = resolve(import.meta.dir, "..", "..", "..");
const generated = process.env.AOT_BUILTINS_GENERATED;
const schemas = globAllSources().bindgen;
const testSchemas = schemas.filter(schema => schema.endsWith("_test.bind.ts")).map(schema => basename(schema));

async function generateInto(directory: string, typesOnly: readonly string[]) {
  await using generator = Bun.spawn({
    cmd: [
      bunExe(),
      join(bunRoot, "src", "codegen", "builtins", "index.ts"),
      `--codegen-path=${directory}`,
      "--target=Linux",
      `--sources=${schemas.map(schema => `${crateOf(schema)}=${schema}`).join(",")}`,
      `--prebuilt-generated=${generated}`,
      `--types-only=${typesOnly.join(",")}`,
    ],
    cwd: bunRoot,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([generator.stderr.text(), generator.exited]);
  return { errors: stderr.split("\n").filter(line => line !== "" && !line.startsWith("builtins table:")), exitCode };
}

test.skipIf(generated === undefined).each([
  ["without assertions", testSchemas],
  ["with assertions", []],
])(
  "the table of built-ins is generated for a build %s",
  async (_, typesOnly) => {
    using directory = tempDir("builtins-table", {});
    expect(await generateInto(String(directory), typesOnly)).toEqual({ errors: [], exitCode: 0 });
  },
  120_000,
);
