// A store to a prototype costs the same however many cached Object.assign plans depend on that prototype.
//
// Object.assign caches one plan per target structure and source shape. Each plan depends on the objects of the target's prototype
// chain, under each name that it adds, so that a later setter or read-only property there drops it. A store to such an object has
// to find the plans that depend on the stored name. Looking through all of the object's dependents made every store slower as the
// program copied more shapes: 929 instructions with none, 245,000 with 1,600 shapes.
//
// The program measures itself with process.cpuUsage(), around the loop alone, so the test needs no counters.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { describe, test } from "./measures";

const program = (shapes: number) => `
  const Kind: any = { tag: "kind", get lazy() { return 1; }, pipe() { return 2; } };
  const sink: unknown[] = [];
  function onFunction(options: object) { function Made() {} return Object.assign(Object.setPrototypeOf(Made, Kind), options); }
  function onObject(options: object) { return Object.assign(Object.create(Kind), options); }
  ${Array.from({ length: shapes }, (_, index) => `for (let round = 0; round < 4; round++) sink.push(onFunction({ shared: round, only${index}: ${index} }), onObject({ shared: round, only${index}: ${index} }));`).join("\n")}
  const start = process.cpuUsage();
  for (let turn = 0; turn < 20_000; turn++) {
    Kind.unrelated = turn;
    delete Kind.unrelated;
  }
  const spent = process.cpuUsage(start);
  console.log(JSON.stringify({ made: sink.length, milliseconds: (spent.user + spent.system) / 1000 }));`;

const programs = { few: 20, many: 1_600 };
type Program = keyof typeof programs;
const dir = tempDir(
  "aot-prototype-stores",
  Object.fromEntries(Object.entries(programs).map(([name, shapes]) => [`${name}.ts`, program(shapes)])),
);
afterAll(() => dir[Symbol.dispose]());
const folder = String(dir);
const pathOf = (name: Program) => join(folder, isWindows ? `${name}.exe` : name);

describe("a store to a prototype", () => {
  test("costs with 1,600 copied shapes what it costs with 20", async () => {
    const measure = async (name: Program) => {
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", `./${name}.ts`, "--outfile", pathOf(name)],
          folder,
          bunEnv,
        ),
      );
      let least = Infinity;
      for (let run = 0; run < 4; run++) {
        const ran = await spawned([pathOf(name)], folder, bunEnv, 200_000);
        expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
        const { made, milliseconds } = JSON.parse(ran.stdout);
        expect(made).toBe(programs[name] * 8);
        least = Math.min(least, milliseconds);
      }
      return least;
    };
    const [few, many] = await Promise.all([measure("few"), measure("many")]);
    console.error(
      `STORES 20,000 stores to the prototype: ${few.toFixed(1)} ms with 20 shapes | ${many.toFixed(1)} ms with 1,600`,
    );
    expect(many).toBeLessThan(3 * few + 60);
  }, 480_000);
});
