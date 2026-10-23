import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    const rounds = Number(process.argv[2]);
    const styles = Object.defineProperties(function () {}, {
      level: { get() { return this.depth; } },
      kind: { value: "style" },
    });
    function build(depth) {
      const builder = text => text + depth;
      Object.setPrototypeOf(builder, styles);
      builder.depth = depth;
      return builder;
    }
    const builders = [build(1), build(2)];
    let sum = 0;
    for (let round = 0; round < rounds; round++) {
      const builder = builders[round & 1];
      sum += builder.level + builder.kind.length + ("level" in builder ? 1 : 0) + ("missing" in builder ? 1 : 0) + (builder.missing === undefined ? 1 : 0);
    }
    console.log(sum);
  `,
};

const operations = [
  "operationAOTGetById",
  "operationAOTGetByIdAndCache",
  "operationAOTGetGeneric",
  "operationAOTInByIdAndCache",
];

test("a read and an `in` that go through a function with properties on the prototype chain stop asking the run time", async () => {
  using dir = tempDir("aot-reads-through-functions-with-properties", files);
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
    const path = join(String(dir), "counts-" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: String(rounds * 8.5) + "\n",
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
  // The first questions miss their caches. A renamed operation would count none.
  expect(operations.some(name => few[name]! > 0)).toBe(true);
  const more = Object.fromEntries(
    operations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(operations.map(name => [name, "level"])));
}, 240_000);
