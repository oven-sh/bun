/**
 * The generator of the AoT compiler's IR schema is the engine's (JavaScriptCore/aot/ir/generator) and nothing it writes is
 * checked in. Bun's graph is written before a prebuilt engine is fetched, so scripts/build/aot.ts names what the generator
 * writes for Bun without asking it. AOT_SCHEMA is the engine's AOTSchema.def: `bun scripts/build/aot-paths.ts` prints it.
 */
import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { schemaHashHeader, schemaRustFiles } from "../../scripts/build/aot.ts";
import { run } from "../aot/harness/run";

const schema = process.env.AOT_SCHEMA;
const fileList = schema === undefined ? undefined : join(dirname(schema), "AOTSchemaFiles.cmake");

async function generate(schemaFile: string, ...options: string[]) {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    join(dirname(schemaFile), "generator", "index.ts"),
    "--schema",
    schemaFile,
    ...options,
  ]);
  return { stdout, stderr, exitCode };
}

test.skipIf(schema === undefined)("it writes for Bun the files that the build declares, and no other", async () => {
  using dir = tempDir("aot-schema-for-bun", {});
  const codegenDir = String(dir);
  expect(await generate(schema!, "--rust-out", codegenDir)).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  expect(readdirSync(codegenDir).sort()).toEqual(
    [...schemaRustFiles({ codegenDir }), schemaHashHeader({ codegenDir })].map(path => basename(path)).sort(),
  );
  const { stdout } = await generate(schema!, "--hash");
  expect(readFileSync(schemaHashHeader({ codegenDir }), "utf8")).toContain(
    `#define BUN_AOT_SCHEMA_HASH ${stdout.trim()}ull\n`,
  );
  expect(readFileSync(join(codegenDir, "aot_schema.rs"), "utf8")).toContain(
    `pub const SCHEMA_HASH: u64 = ${stdout.trim()};\n`,
  );
});

// A tarball has no list: nothing is compiled from it.
test.skipIf(fileList === undefined || !existsSync(fileList))(
  "it names what the engine's list of generated files lacks and what it has too much",
  async () => {
    using dir = tempDir("aot-schema-file-list", {});
    const ir = join(String(dir), "ir");
    for (const name of ["AOTSchema.def", "AOTSchemaFiles.cmake", "schema", "generator"])
      cpSync(join(dirname(schema!), name), join(ir, name), { recursive: true });
    const out = join(String(dir), "out");
    expect(await generate(join(ir, "AOTSchema.def"), "--engine-out", out)).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const list = join(ir, "AOTSchemaFiles.cmake");
    writeFileSync(list, readFileSync(list, "utf8").replace("/AOTWire.h", "/AOTWireOfYesterday.h"));
    const { stderr, exitCode } = await generate(join(ir, "AOTSchema.def"), "--engine-out", out);
    expect(stderr.split("\n")).toEqual([
      `${list}: JavaScriptCore_AOT_SCHEMA_GENERATED_HEADERS lacks "\${JavaScriptCore_AOT_GENERATED_DIR}/AOTWire.h"`,
      `${list}: JavaScriptCore_AOT_SCHEMA_GENERATED_HEADERS has "\${JavaScriptCore_AOT_GENERATED_DIR}/AOTWireOfYesterday.h", and there is no such file`,
      "",
    ]);
    expect(exitCode).toBe(1);
  },
);
