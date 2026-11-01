import { expect } from "bun:test";
import { test } from "../../aot/harness/declare";
import { bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { run } from "../../aot/harness/run";
import { engineDirectory, engineFiles as generated } from "./engine-files.ts";

const bunRoot = resolve(import.meta.dir, "..", "..", "..");
const schemas = globAllSources().bindgen;
const testSchemas = schemas.filter(schema => schema.endsWith("_test.bind.ts")).map(schema => basename(schema));

async function generate(typesOnly: readonly string[]) {
  using directory = tempDir("builtins-table", {});
  const { stderr, exitCode } = await run(
    [
      bunExe(),
      join(bunRoot, "src", "codegen", "builtins", "index.ts"),
      `--codegen-path=${directory}`,
      "--target=Linux",
      `--sources=${schemas.map(schema => `${crateOf(schema)}=${schema}`).join(",")}`,
      `--prebuilt-generated=${generated}`,
      `--engine-directory=${engineDirectory}`,
      `--types-only=${typesOnly.join(",")}`,
    ],
    bunRoot,
  );
  return {
    errors: stderr.split("\n").filter(line => line !== "" && !line.startsWith("builtins table:")),
    exitCode,
    ids: exitCode === 0 ? readFileSync(join(String(directory), "aot_builtin_ids.rs"), "utf8") : "",
  };
}

// A run of the generator takes many seconds: each configuration is generated once, side by side, for all that is asked of it.
let generating: Promise<Awaited<ReturnType<typeof generate>>[]> | undefined;
const configurations = () => (generating ??= Promise.all([generate(testSchemas), generate([])]));

test.skipIf(generated === undefined).each([
  ["without assertions", 0],
  ["with assertions", 1],
])(
  "the table of built-ins is generated for a build %s",
  async (_, configuration) => {
    const { errors, exitCode } = (await configurations())[configuration];
    expect({ errors, exitCode }).toEqual({ errors: [], exitCode: 0 });
  },
  120_000,
);

test.skipIf(generated === undefined)(
  "one prebuilt engine serves a build with and a build without assertions",
  async () => {
    const [withoutAssertions, withAssertions] = await configurations();
    expect(withAssertions.ids).not.toBe("");
    expect(withAssertions.ids === withoutAssertions.ids).toBe(true);
  },
  120_000,
);
