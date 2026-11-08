import { bunExe, isASAN, tempDir } from "harness";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { engineDirectory, engineFiles as generated, generatorEnv } from "./engine-files.ts";

export const bunRoot = resolve(import.meta.dir, "..", "..", "..");
export const schemas = globAllSources().bindgen;
export const hasNoPrebuiltEngine = generated === undefined;
export const timeLimitOfOneRun = isASAN ? 300_000 : 120_000;

interface Generated {
  exitCode: number;
  errors: string;
  tableOfBuiltins: string;
}

export async function generateAgainst(
  prebuiltGenerated: string,
  sources: readonly string[] = schemas,
): Promise<Generated> {
  using directory = tempDir("builtins-table", {});
  await using generator = Bun.spawn({
    cmd: [
      bunExe(),
      join(bunRoot, "src", "codegen", "builtins", "index.ts"),
      `--codegen-path=${directory}`,
      "--target=Linux",
      `--sources=${sources.map((schema, index) => `${crateOf(schemas[index])}=${schema}`).join(",")}`,
      `--prebuilt-generated=${prebuiltGenerated}`,
      `--engine-directory=${engineDirectory}`,
    ],
    cwd: bunRoot,
    env: generatorEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [errors, exitCode] = await Promise.all([generator.stderr.text(), generator.exited]);
  const written = join(String(directory), "AOTBuiltinTableNames.cpp");
  return { exitCode, errors, tableOfBuiltins: existsSync(written) ? readFileSync(written, "utf8") : "" };
}

// What a prebuilt engine was compiled with. The generators and the schema are those of the engine that src/codegen/engine-directory.ts finds.
export function copyOfEngine(): { root: ReturnType<typeof tempDir>; generatedCopy: string } {
  const root = tempDir("prebuilt-engine", {});
  const generatedCopy = join(String(root), "generated");
  cpSync(generated!, generatedCopy, { recursive: true });
  return { root, generatedCopy };
}
