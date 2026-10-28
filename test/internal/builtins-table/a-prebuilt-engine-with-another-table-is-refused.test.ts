import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { engineDirectory, engineFiles as generated } from "./engine-files.ts";

const bunRoot = resolve(import.meta.dir, "..", "..", "..");
const schemas = globAllSources().bindgen;

// Each test runs the generator once. A run writes into its --codegen-path and nowhere else, and each test has folders of its own, so the
// four runs overlap. With AddressSanitizer one run takes about a minute by itself, and four at once take as long as four in a row on a
// machine with few free CPUs. So there a run has the time that the four tests had one after the other.
const limitOfRun = isASAN ? 4 * 120_000 : 120_000;
// A concurrent test that runs out of time does not end what it started. So the run has the shorter limit, and its test reports the end.
const limitOfTest = limitOfRun + 10_000;

interface Generated {
  exitCode: number;
  /** The lines that the generator wrote to stderr, without the summary that every run prints. A run that a signal ended says so last. */
  errors: string[];
}

async function generateAgainst(
  prebuiltGenerated: string,
  codegen: string,
  sources: readonly string[] = schemas,
): Promise<Generated> {
  await using generator = Bun.spawn({
    cmd: [
      bunExe(),
      join(bunRoot, "src", "codegen", "builtins", "index.ts"),
      `--codegen-path=${codegen}`,
      "--target=Linux",
      `--sources=${sources.map((schema, index) => `${crateOf(schemas[index])}=${schema}`).join(",")}`,
      `--prebuilt-generated=${prebuiltGenerated}`,
      `--engine-directory=${engineDirectory}`,
    ],
    cwd: bunRoot,
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
    timeout: limitOfRun,
  });
  const [stderr, exitCode] = await Promise.all([generator.stderr.text(), generator.exited]);
  const errors = stderr.split("\n").filter(line => line !== "" && !line.startsWith("builtins table:"));
  if (generator.signalCode !== null) errors.push(`the generator was ended by ${generator.signalCode}`);
  return { exitCode, errors };
}

// What a prebuilt engine was compiled with, and an empty folder for what a build against it generates. The generators and the schema are
// those of the engine that src/codegen/engine-directory.ts finds.
function copyOfEngine(): { root: ReturnType<typeof tempDir>; generatedCopy: string; codegen: string } {
  const root = tempDir("prebuilt-engine", { codegen: {} });
  const generatedCopy = join(String(root), "generated");
  cpSync(generated!, generatedCopy, { recursive: true });
  return { root, generatedCopy, codegen: join(String(root), "codegen") };
}

test.skipIf(generated === undefined).concurrent(
  "an engine compiled with this tree's table is accepted",
  async () => {
    const { root, generatedCopy, codegen } = copyOfEngine();
    using _ = root;
    const { exitCode, errors } = await generateAgainst(generatedCopy, codegen);
    expect(errors).toEqual([]);
    expect(exitCode).toBe(0);
  },
  limitOfTest,
);

test.skipIf(generated === undefined).concurrent(
  "an engine compiled with another position for one built-in that it names is refused by name",
  async () => {
    const { root, generatedCopy, codegen } = copyOfEngine();
    using _ = root;
    const ids = join(generatedCopy, "AOTBuiltinIDs.h");
    const text = readFileSync(ids, "utf8");
    const line = /inline constexpr NamedTableID<BuiltinID> ArrayPrototypePush \{ (\d+) \};/.exec(text)!;
    const lineNumber = text.slice(0, line.index).split("\n").length;
    const moved = `inline constexpr NamedTableID<BuiltinID> ArrayPrototypePush { ${Number(line[1]) + 1} };`;
    writeFileSync(ids, text.replace(line[0], moved));
    const { exitCode, errors } = await generateAgainst(generatedCopy, codegen);
    expect(errors).toEqual([
      `error: ${ids}: line ${lineNumber} is \`${moved}\`, and this tree writes \`${line[0]}\``,
      expect.stringContaining("another list of the built-ins"),
    ]);
    expect(exitCode).toBe(1);
  },
  limitOfTest,
);

test.skipIf(generated === undefined).concurrent(
  "the table that the engine's own programs were linked with is not compared",
  async () => {
    const { root, generatedCopy, codegen } = copyOfEngine();
    using _ = root;
    const fromOtherNatives = "// Written from other natives.\n";
    writeFileSync(join(generatedCopy, "AOTBuiltinTableBuiltins.cpp"), fromOtherNatives);
    const { exitCode, errors } = await generateAgainst(generatedCopy, codegen);
    expect(errors).toEqual([]);
    // This tree writes another text under that name: a comparison would have refused the engine.
    expect(readFileSync(join(codegen, "AOTBuiltinTableBuiltins.cpp"), "utf8")).not.toBe(fromOtherNatives);
    expect(exitCode).toBe(0);
  },
  limitOfTest,
);

test.skipIf(generated === undefined).concurrent(
  "a native method that a schema gains needs no other engine",
  async () => {
    const { root, generatedCopy, codegen } = copyOfEngine();
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
    const { exitCode, errors } = await generateAgainst(generatedCopy, codegen, sources);
    expect(errors).toEqual([]);
    const names = readFileSync(join(codegen, "AOTBuiltinTableNames.cpp"), "utf8");
    expect(names.match(/\baMethodNobodyHasYet\b/g)).toEqual(["aMethodNobodyHasYet"]);
    expect(exitCode).toBe(0);
  },
  limitOfTest,
);
