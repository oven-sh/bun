import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const bunRoot = resolve(import.meta.dir, "..", "..", "..");
const generated = process.env.AOT_BUILTINS_GENERATED;
const schemas = globAllSources().bindgen;

async function generateAgainst(prebuiltGenerated: string): Promise<{ exitCode: number; errors: string }> {
  using directory = tempDir("builtins-table", {});
  await using generator = Bun.spawn({
    cmd: [
      bunExe(),
      join(bunRoot, "src", "codegen", "builtins", "index.ts"),
      `--codegen-path=${directory}`,
      "--target=Linux",
      `--sources=${schemas.map(schema => `${crateOf(schema)}=${schema}`).join(",")}`,
      `--prebuilt-generated=${prebuiltGenerated}`,
    ],
    cwd: bunRoot,
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [errors, exitCode] = await Promise.all([generator.stderr.text(), generator.exited]);
  return { exitCode, errors };
}

function copyOfEngine(): { root: ReturnType<typeof tempDir>; generatedCopy: string } {
  const root = tempDir("prebuilt-engine", {});
  const javaScriptCore = resolve(generated!, "..", "..", "..");
  const javaScriptCoreCopy = join(String(root), "Source", "JavaScriptCore");
  for (const path of [
    "aot/ir/AOTSchema.def",
    "aot/ir/schema",
    "aot/builtins/generated",
    "aot/builtins/verified-overloads.txt",
  ]) {
    cpSync(join(javaScriptCore, path), join(javaScriptCoreCopy, path), { recursive: true });
  }
  return { root, generatedCopy: join(javaScriptCoreCopy, "aot", "builtins", "generated") };
}

test.skipIf(generated === undefined)(
  "an engine compiled with this tree's table is accepted",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    const { exitCode, errors } = await generateAgainst(generatedCopy);
    expect(errors).not.toContain("another table of built-ins");
    expect(exitCode).toBe(0);
  },
  120_000,
);

test.skipIf(generated === undefined)(
  "an engine compiled with another number for one built-in is refused by name",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    const ids = join(generatedCopy, "AOTBuiltinIDs.h");
    const text = readFileSync(ids, "utf8");
    const line = /inline constexpr NamedTableID<BuiltinID> ArrayPrototypePush \{ (\d+) \};/.exec(text)!;
    writeFileSync(
      ids,
      text.replace(line[0], `inline constexpr NamedTableID<BuiltinID> ArrayPrototypePush { ${Number(line[1]) + 1} };`),
    );
    const { exitCode, errors } = await generateAgainst(generatedCopy);
    expect(errors).toContain("AOTBuiltinIDs.h");
    expect(errors).toContain(line[0]);
    expect(errors).toContain("another table of built-ins");
    expect(exitCode).toBe(1);
  },
  120_000,
);
