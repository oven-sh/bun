import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { engineDirectory, engineFiles as generated } from "./engine-files.ts";

const bunRoot = resolve(import.meta.dir, "..", "..", "..");
const schemas = globAllSources().bindgen;

interface Generated {
  exitCode: number;
  errors: string;
  tableOfBuiltins: string;
}

async function generateAgainst(prebuiltGenerated: string, sources: readonly string[] = schemas): Promise<Generated> {
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
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [errors, exitCode] = await Promise.all([generator.stderr.text(), generator.exited]);
  const written = join(String(directory), "AOTBuiltinTableNames.cpp");
  return { exitCode, errors, tableOfBuiltins: existsSync(written) ? readFileSync(written, "utf8") : "" };
}

// What a prebuilt engine was compiled with. The generators and the schema are those of the engine that src/codegen/engine-directory.ts finds.
function copyOfEngine(): { root: ReturnType<typeof tempDir>; generatedCopy: string } {
  const root = tempDir("prebuilt-engine", {});
  const generatedCopy = join(String(root), "generated");
  cpSync(generated!, generatedCopy, { recursive: true });
  return { root, generatedCopy };
}

test.skipIf(generated === undefined)(
  "an engine compiled with this tree's table is accepted",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    const { exitCode, errors } = await generateAgainst(generatedCopy);
    expect(errors).not.toContain("another list of the built-ins");
    expect(exitCode).toBe(0);
  },
  120_000,
);

test.skipIf(generated === undefined)(
  "an engine compiled with another position for one built-in that it names is refused by name",
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
    expect(errors).toContain("another list of the built-ins");
    expect(exitCode).toBe(1);
  },
  120_000,
);

test.skipIf(generated === undefined)(
  "the table that the engine's own programs were linked with is not compared",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    writeFileSync(join(generatedCopy, "AOTBuiltinTableBuiltins.cpp"), "// Written from other natives.\n");
    const { exitCode, errors } = await generateAgainst(generatedCopy);
    expect(errors).not.toContain("AOTBuiltinTableBuiltins.cpp");
    expect(exitCode).toBe(0);
  },
  120_000,
);

test.skipIf(generated === undefined)(
  "a native method that a schema gains needs no other engine",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    const schema = schemas.find(path => path.endsWith("sourcemap.bind.ts"))!;
    const text = readFileSync(schema, "utf8");
    const member = "    findEntry: {";
    expect(text).toContain(member);
    using changed = tempDir("schema-with-one-more-method", {
      "sourcemap.bind.ts": text
        // It lands in a string literal, where a backslash begins an escape.
        .replace(
          "../../codegen/bindgen-lib.ts",
          join(bunRoot, "src", "codegen", "bindgen-lib.ts").replaceAll("\\", "/"),
        )
        .replace(member, `    aMethodNobodyHasYet: { ...find, args: { lineOffset: b.any } },\n${member}`),
    });
    const sources = schemas.map(path => (path === schema ? join(String(changed), "sourcemap.bind.ts") : path));
    const { exitCode, errors, tableOfBuiltins } = await generateAgainst(generatedCopy, sources);
    expect(errors).not.toContain("another list of the built-ins");
    expect(exitCode).toBe(0);
    expect(tableOfBuiltins).toContain("aMethodNobodyHasYet");
  },
  120_000,
);
