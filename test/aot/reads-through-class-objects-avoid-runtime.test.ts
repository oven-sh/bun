import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    class Model {}
    class User extends Model {}
    class Admin extends User { static displayName = "admin"; }
    class Plain { render() { return 1; } }
    const rounds = Number(process.argv[2]);
    Model["table" + process.argv[3]] = "models";
    function reads(type) {
      return (type.tableName ?? "none") + " " + (type.defaultProps === undefined) + " " + (type.displayName ?? "none");
    }
    function asks(type) {
      return ("tableName" in type) + " " + ("defaultProps" in type) + " " + ("displayName" in type);
    }
    const names = "tableName defaultProps displayName".split(" ");
    function readsByValue(type) {
      return (type[names[0]] ?? "none") + " " + (type[names[1]] === undefined) + " " + (type[names[2]] ?? "none");
    }
    const describe = { read: reads, in: asks, value: readsByValue }[process.argv[4]];
    const types = [Model, User, Admin, Plain];
    const seen = new Set();
    for (let round = 0; round < rounds; round++) seen.add(describe(types[round & 3]));
    console.log([...seen].join(" | "));
    User.tableName = "users";
    Admin.defaultProps = {};
    delete Model.tableName;
    console.log(types.map(describe).join(" | "));
  `,
};

const operations = [
  "operationAOTGetById",
  "operationAOTGetByIdAndCache",
  "operationAOTGetGeneric",
  "operationAOTInByIdAndCache",
  "operationAOTGetByVal",
  "operationAOTGetByValAndCache",
  "operationAOTGetByValGeneric",
];
const values =
  "models true none | models true admin | none true none\n" +
  "none true none | users true none | users false admin | none true none\n";
const ways = {
  read: values,
  value: values,
  in:
    "true false false | true false true | false false false\n" +
    "false false false | true false false | true true true | false false false\n",
};

test("a read by name, a read by value and an `in` that go through class objects stop asking the run time", async () => {
  using dir = tempDir("aot-reads-through-class-objects", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counted = async (way: keyof typeof ways, rounds: number) => {
    const path = join(String(dir), "counts-" + way + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds), "Name", way], String(dir), env)).toEqual({
      stdout: ways[way],
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(operations.map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  for (const way of ["read", "value", "in"] as const) {
    const few = await counted(way, 500);
    const many = await counted(way, 2500);
    // The first question to each kind of receiver misses its cache. A renamed operation would count none.
    expect(operations.some(name => few[name]! > 0)).toBe(true);
    const more = Object.fromEntries(
      operations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
    );
    expect({ way, more }).toEqual({ way, more: Object.fromEntries(operations.map(name => [name, "level"])) });
  }
}, 240_000);
