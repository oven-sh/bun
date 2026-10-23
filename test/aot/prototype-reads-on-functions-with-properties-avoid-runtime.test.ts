import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    const rounds = Number(process.argv[2]);
    const named = (f, name) => { f.displayName = name; return f; };
    class Component { isComponent() { return true; } }
    const holder = { method() {} };
    const types = [
      named(() => 1, "arrow"),
      named(async () => 1, "async arrow"),
      named(holder.method, "method"),
      named(function () {}, "function"),
      named(class extends Component {}, "class"),
    ];
    function constructs(type) {
      return type.displayName + " " + !!(type.prototype && type.prototype.isComponent) + " " + ("prototype" in type) + " " + Object.hasOwn(type, "prototype");
    }
    const seen = new Set();
    for (let round = 0; round < rounds; round++) seen.add(constructs(types[round % types.length]));
    console.log([...seen].join(" | "));
    types[0].prototype = new Component();
    Object.setPrototypeOf(types[1], Object.create(Function.prototype, { prototype: { value: new Component() } }));
    console.log(types.map(constructs).join(" | "), "|", constructs(named(() => 2, "another arrow")), "|", constructs(named(async () => 2, "another async arrow")));
  `,
};

const operations = [
  "operationAOTGetById",
  "operationAOTGetByIdAndCache",
  "operationAOTGetGeneric",
  "operationAOTInByIdAndCache",
  "operationAOTHasOwnByIdAndCache",
];

// TODO: hasOwn and `in` ask the run time at each visit.
test.todo(
  "a read of `prototype` off a function that cannot construct and has a property of its own stops asking the run time",
  async () => {
    using dir = tempDir("aot-prototype-reads-on-functions-with-properties", files);
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
    const counted = async (rounds: number) => {
      const path = join(String(dir), "counts" + rounds);
      const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
      expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
        stdout:
          "arrow false false false | async arrow false false false | method false false false | function false true true | class true true true\n" +
          "arrow true true true | async arrow true true false | method false false false | function false true true | class true true true | another arrow false false false | another async arrow false false false\n",
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
    const few = await counted(500);
    const many = await counted(2500);
    // The first question to each kind of function misses its cache. A renamed operation would count none.
    expect(operations.some(name => few[name]! > 0)).toBe(true);
    const more = Object.fromEntries(
      operations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
    );
    expect(more).toEqual(Object.fromEntries(operations.map(name => [name, "level"])));
  },
  240_000,
);
