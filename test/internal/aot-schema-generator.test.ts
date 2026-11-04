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

function copyOfSchema(folder: string) {
  const ir = join(folder, "ir");
  for (const name of ["AOTSchema.def", "AOTSchemaFiles.cmake", "schema", "generator"])
    if (existsSync(join(dirname(schema!), name))) cpSync(join(dirname(schema!), name), join(ir, name), { recursive: true });
  return ir;
}

function textsIn(folder: string) {
  return Object.fromEntries(
    readdirSync(folder)
      .sort()
      .map(name => [name, readFileSync(join(folder, name), "utf8")]),
  );
}

// The form of an operation's code (form, openUnder, closedUnder, runtimeUnder, openIn, closedIn, runtimeIn) is a matter of the code generator.
test.skipIf(fileList === undefined || !existsSync(fileList))(
  "neither the hash nor what Bun compiles changes with the form that a row names, and the engine's half does",
  async () => {
    using dir = tempDir("aot-schema-forms", {});
    const ir = copyOfSchema(String(dir));
    const generated = async (name: string) => {
      const rust = join(String(dir), `${name}-rust`);
      const engine = join(String(dir), `${name}-engine`);
      const options = ["--hash", "--rust-out", rust, "--engine-out", engine];
      const { stdout, stderr, exitCode } = await generate(join(ir, "AOTSchema.def"), ...options);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return { hash: stdout, rust: textsIn(rust), engine: textsIn(engine) };
    };
    const asWritten = await generated("as-written");

    let rowsChanged = 0;
    for (const name of readdirSync(join(ir, "schema"))) {
      const path = join(ir, "schema", name);
      const text = readFileSync(path, "utf8").replace(/ ; form = Closed\b/g, () => {
        ++rowsChanged;
        return " ; form = Runtime";
      });
      writeFileSync(path, text.replace(/ ; (closed|runtime)Under = /g, (_, form) => ` ; ${form === "closed" ? "runtime" : "closed"}Under = `));
    }
    expect(rowsChanged).toBeGreaterThan(0);
    const withOtherForms = await generated("with-other-forms");

    expect(withOtherForms.hash).toBe(asWritten.hash);
    expect(withOtherForms.rust).toEqual(asWritten.rust);
    const columns = "AOTSchemaOperationColumns.h";
    expect(asWritten.engine[columns]).toContain("constexpr Form formOf(Opcode ");
    expect(withOtherForms.engine[columns]).not.toBe(asWritten.engine[columns]);
    const { [columns]: columnsAsWritten, ...restAsWritten } = asWritten.engine;
    const { [columns]: columnsWithOtherForms, ...restWithOtherForms } = withOtherForms.engine;
    expect(restWithOtherForms).toEqual(restAsWritten);
  },
);

test.skipIf(schema === undefined)("it turns away a row that names a form twice, or by a place that is none", async () => {
  using dir = tempDir("aot-schema-faulty-forms", {});
  const ir = copyOfSchema(String(dir));
  const file = join(ir, "schema", "operations.def");
  const text = readFileSync(file, "utf8");
  const row = text
    .split("\n")
    .find(line => /^operation \w+ .* ; form = Closed$/.test(line) && !/formDependsOnLoop|(Under|In) = /.test(line))!;
  expect(row).toBeDefined();
  const name = row.split(" ")[1];
  const withoutForm = row.replace(/ ; form = Closed$/, "");

  const faults: [string, string][] = [
    [
      withoutForm,
      `${name} may stand in Code and names no form: form = Open, Closed or Runtime, or each state in one of openUnder, closedUnder, runtimeUnder`,
    ],
    [`${row} ; openUnder = Generic`, `${name} has one form and lists forms by what is known`],
    [`${withoutForm} ; openUnder = Generic ; closedUnder = Always, Generic`, `${name} lists Generic in openUnder and in closedUnder`],
    [`${row} ; openIn = Twin ; closedIn = Twin`, `${name} lists Twin in openIn and in closedIn`],
    [`${row} ; closedIn = Anywhere`, `${name} lists Anywhere, which is no place`],
    [`${row} ; openIn = Loop`, `${name} has a form of its own in loops and does not set formDependsOnLoop`],
  ];
  for (const [faultyRow, problem] of faults) {
    writeFileSync(file, text.replace(row, faultyRow));
    const { stderr, exitCode } = await generate(join(ir, "AOTSchema.def"), "--hash");
    expect({ problems: stderr.trim().split("\n").map(line => line.replace(/^.*?:\d+:\d+: /, "")), exitCode }).toEqual({
      problems: [problem],
      exitCode: 1,
    });
  }

  writeFileSync(file, text.replace(row, `${row} ; formDependsOnLoop = true ; openIn = Loop ; closedIn = Twin`));
  expect((await generate(join(ir, "AOTSchema.def"), "--hash")).exitCode).toBe(0);
});
