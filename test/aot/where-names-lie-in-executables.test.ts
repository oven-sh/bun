import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { compileCommand } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const python = Bun.which("python3");
const script = join(import.meta.dir, "tools", "where_in_image.py");
if (!python) console.error("SKIPPED: test/aot/where-names-lie-in-executables.test.ts: python3 is not installed");

const sources = {
  "libraryW1.ts": `
export interface RecordW2 {
  fieldW3: number;
  optionalFieldW4?: string;
}
export class ClassW5 {
  static staticFieldW6 = 2;
  instanceFieldW7 = 1;
  methodW8() {
    return this.instanceFieldW7;
  }
}
export function functionW9(record: RecordW2) {
  const localW10 = record.fieldW3;
  return localW10 + (record.optionalFieldW4 ?? "").length;
}
export type UnionW11 = "memberW12" | "otherMemberW13";
export const exportedW14 = 5;
`,
  "main.ts": `
import * as library from "./libraryW1";
import { ClassW5, functionW9 } from "./libraryW1";
import type { RecordW2, UnionW11 } from "./libraryW1";
const nameFromOutside = process.argv[2];
const record: RecordW2 = nameFromOutside ? { fieldW3: 1, optionalFieldW4: nameFromOutside } : { fieldW3: 1 };
const instance = new ClassW5();
function isMember(given: UnionW11) {
  return given === "memberW12";
}
console.log(functionW9(record), String(functionW9).length > 0, (library as any)[nameFromOutside], (instance as any)[nameFromOutside], (ClassW5 as any)[nameFromOutside]);
console.log(instance.methodW8(), ClassW5.staticFieldW6, isMember(nameFromOutside as UnionW11), record, instance);
`,
};

const rowsOfNames: [string, string][] = [
  ["fieldW3", "layout-field:record"],
  ["optionalFieldW4", "layout-field:record:optional"],
  ["instanceFieldW7", "layout-field:instance"],
  ["methodW8", "class-method"],
  ["staticFieldW6", "static-field"],
  ["functionW9", "function-name"],
  ["ClassW5", "layout-name"],
  ["memberW12", "literal-union-member"],
  ["exportedW14", "export"],
  ["libraryW1", "module-path"],
];

// TODO: on macOS the tool finds no row in the executable.
describe.skipIf(!python || process.platform === "darwin")("compile/aot/where names lie in an executable", () => {
  const folder = String(tempDir("aot-where-names-lie", sources));
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const rows = new Map<string, string[][]>();
  let report = { stdout: "", stderr: "", exitCode: -1 };
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  beforeAll(async () => {
    built(await spawned([bunExe(), ...compileCommand, "./main.ts", "--outfile", executable], folder, bunEnv));
    const bytes = readFileSync(executable);
    const hits: string[] = [];
    for (const name of [...rowsOfNames.map(([name]) => name), "localW10"]) {
      for (let at = bytes.indexOf(name, 0, "latin1"); at >= 0; at = bytes.indexOf(name, at + 1, "latin1"))
        hits.push(`${name} ${at} ${name.length}`);
    }
    writeFileSync(join(folder, "hits.tsv"), hits.join("\n") + "\n");
    report = await spawned([python!, script, executable, join(folder, "hits.tsv")], folder, bunEnv);
    for (const line of report.stdout.split(/\r?\n/)) {
      if (line.startsWith("#") || line.startsWith("id\t") || !line) continue;
      const columns = line.split("\t");
      rows.set(columns[0], [...(rows.get(columns[0]) ?? []), columns]);
    }
  }, 300_000);

  test("the script takes the image for one of the form that it knows", () => {
    expect({
      stderr: report.stderr,
      exitCode: report.exitCode,
      refusal: /^REFUSED.*$/m.exec(report.stdout)?.[0],
    }).toEqual({
      stderr: "",
      exitCode: 0,
      refusal: undefined,
    });
  });

  test.each(rowsOfNames)("%s is named by a row of the kind %s", (name, kind) => {
    const kinds = (rows.get(name) ?? []).flatMap(columns => columns[9].split("+"));
    expect(kinds).toContain(kind);
  });

  test("a name that only the text of a function holds lies in the texts of functions", () => {
    const sections = new Set((rows.get("localW10") ?? []).map(columns => columns[2]));
    expect([...sections]).toEqual(["ProgramTables: the texts of functions"]);
  });

  test("the script refuses an executable whose run time has one table more than it knows", async () => {
    const stale = join(folder, "stale.py");
    writeFileSync(stale, readFileSync(script, "utf8").replace(" literalStringDigests:28", ""));
    const { stdout, exitCode } = await spawned([python!, stale, executable, join(folder, "hits.tsv")], folder, bunEnv);
    expect({ exitCode, rows: stdout.split(/\r?\n/).filter(line => line && !line.startsWith("REFUSED")) }).toEqual({
      exitCode: 2,
      rows: [],
    });
  });
});
