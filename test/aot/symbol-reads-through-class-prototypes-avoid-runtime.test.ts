import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    import { EventEmitter } from "node:events";
    class Source extends EventEmitter {
      constructor() { super(); this.open = true; }
      close() { this.open = false; }
    }
    function Legacy() { this.old = true; }
    Legacy.prototype.run = function () { return 1; };
    class Heir extends Legacy {
      walk() { return 2; }
    }
    class Plain {
      walk() { return 3; }
    }
    const rounds = Number(process.argv[2]);
    function describe(value) {
      return typeof value[Symbol.iterator] + " " + typeof value[Symbol.asyncIterator] + " " + (value[Symbol.toStringTag] ?? "none");
    }
    const values = [new Source(), new Heir(), Plain.prototype, new Plain()];
    const seen = new Set();
    for (let round = 0; round < rounds; round++) seen.add(describe(values[round & 3]));
    console.log([...seen].join(" | "));
    Source.prototype[Symbol.asyncIterator] = function () {};
    Legacy.prototype[Symbol.iterator] = function () {};
    Object.defineProperty(Plain.prototype, Symbol.toStringTag, { get() { return "plain"; } });
    console.log(values.map(describe).join(" | "));
    console.log(values[0].open, values[1].walk() + values[1].run(), values[3].walk(), Object.prototype.toString.call(values[3]));
  `,
};

const reads = ["operationAOTGetById", "operationAOTGetByIdAndCache", "operationAOTGetGeneric"];

test("a read under a symbol that no class on the way declares stops asking the run time", async () => {
  using dir = tempDir("aot-symbol-reads-through-class-prototypes", files);
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
        "undefined undefined none\n" +
        "undefined function none | function undefined none | undefined undefined plain | undefined undefined plain\n" +
        "true 3 3 [object plain]\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(reads.map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  // The first read of each kind of receiver misses its cache. A renamed operation would count none.
  expect(reads.some(name => few[name]! > 0)).toBe(true);
  const more = Object.fromEntries(
    reads.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(reads.map(name => [name, "level"])));
}, 240_000);
