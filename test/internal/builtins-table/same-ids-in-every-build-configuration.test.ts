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

async function idsFor(typesOnly: readonly string[]): Promise<string> {
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
      `--types-only=${typesOnly.join(",")}`,
    ],
    cwd: bunRoot,
    env: bunEnv,
    stdout: "ignore",
    stderr: "inherit",
  });
  expect(await generator.exited).toBe(0);
  return readFileSync(join(String(directory), "aot_builtin_ids.rs"), "utf8");
}

test.skipIf(generated === undefined)(
  "one prebuilt engine serves a build with and a build without assertions",
  async () => {
    const [withoutAssertions, withAssertions] = await Promise.all([idsFor(testSchemas), idsFor([])]);
    expect(withAssertions === withoutAssertions).toBe(true);
  },
  120_000,
);
