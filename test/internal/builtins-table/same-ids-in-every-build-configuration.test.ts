import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { engineDirectory, engineFiles as generated } from "./engine-files.ts";

const bunRoot = resolve(import.meta.dir, "..", "..", "..");
const schemas = globAllSources().bindgen;
const testSchemas = schemas.filter(schema => schema.endsWith("_test.bind.ts")).map(schema => basename(schema));

type Build = "withoutAssertions" | "withAssertions";

async function generateInto(directory: string, typesOnly: readonly string[]) {
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
    // The ASAN lane sets BUN_JSC_dumpSimulatedThrows, which nearly doubles a run's time. The exception checks stay on.
    env: { ...bunEnv, BUN_JSC_dumpSimulatedThrows: undefined },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([generator.stderr.text(), generator.exited]);
  // Every run prints summaries that begin with "builtins table:". Any other line says what went wrong.
  const errors = stderr.split("\n").filter(line => line !== "" && !line.startsWith("builtins table:"));
  return { errors, exitCode, signalCode: generator.signalCode };
}

// BunAOTHostBindings.cpp names the list of native calls that its build numbers: generate-js2native.ts stamps each list.
const nativeCallListsOf = (hostBindings: string) => new Set(hostBindings.match(/\bBun__js2nativeList_[0-9a-f]{8}\b/g));

test.skipIf(generated === undefined)(
  "one prebuilt engine serves a build with and a build without assertions",
  async () => {
    using directory = tempDir("builtins-table", { withoutAssertions: {}, withAssertions: {} });
    const written = (build: Build, file: string) => readFileSync(join(String(directory), build, file), "utf8");
    const [withoutAssertions, withAssertions] = await Promise.all([
      generateInto(join(String(directory), "withoutAssertions"), testSchemas),
      generateInto(join(String(directory), "withAssertions"), []),
    ]);
    const accepted = { errors: [], exitCode: 0, signalCode: null };
    expect({ withoutAssertions, withAssertions }).toEqual({ withoutAssertions: accepted, withAssertions: accepted });

    // The two are not one build: only with assertions does Bun number the native calls of the *_test.bind.ts schemas.
    expect(nativeCallListsOf(written("withAssertions", "BunAOTHostBindings.cpp"))).not.toEqual(
      nativeCallListsOf(written("withoutAssertions", "BunAOTHostBindings.cpp")),
    );
    expect(written("withAssertions", "aot_builtin_ids.rs")).toBe(written("withoutAssertions", "aot_builtin_ids.rs"));
  },
  // One run of the generator takes about 7 minutes with a debug build.
  isDebug ? 1_800_000 : 120_000,
);
