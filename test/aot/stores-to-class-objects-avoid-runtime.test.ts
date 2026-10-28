import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    class Registry {
      static make() { return "declared"; }
    }
    class Below extends Registry {}
    function Legacy() {}
    const rounds = Number(process.argv[2]);
    Registry["co" + process.argv[3]] = 0;
    Legacy["co" + process.argv[3]] = 0;
    function countInClass() { Registry.count++; }
    function countInFunction() { Legacy.count++; }
    function callMake() { return Registry.make() + " " + Below.make(); }
    for (let round = 0; round < rounds; round++) {
      countInClass();
      countInFunction();
    }
    const before = callMake();
    Registry.make = () => "first";
    const first = callMake();
    Registry.make = () => "second";
    const second = callMake();
    Object.freeze(Registry);
    let refused = "stored";
    try {
      countInClass();
    } catch (error) {
      refused = error.constructor.name;
    }
    console.log(Registry.count === rounds, Below.count === rounds, Legacy.count === rounds, before, "|", first, "|", second, "|", refused);
  `,
};

const stores = ["operationAOTPutById", "operationAOTPutByIdAndCache"];

test("a store that replaces a property that a class does not declare stops asking the run time", async () => {
  using dir = tempDir("aot-stores-to-class-objects", files);
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
    expect(await run([executable, String(rounds), "unt"], String(dir), env)).toEqual({
      stdout: "true true true declared declared | first first | second second | TypeError\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(stores.map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  // The first store of each site misses its cache. A renamed operation would count none.
  expect(stores.some(name => few[name]! > 0)).toBe(true);
  const more = Object.fromEntries(
    stores.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(stores.map(name => [name, "level"])));
}, 240_000);
