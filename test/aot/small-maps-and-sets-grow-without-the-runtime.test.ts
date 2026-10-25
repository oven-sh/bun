import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const tables = 200;
const keysPerTable = 50;

const files = {
  "main.js": `
    function fill(keys) {
      const sets = [], maps = [];
      for (let i = 0; i < ${tables}; i++) { sets.push(new Set()); maps.push(new Map()); }
      for (let j = 0; j < ${keysPerTable}; j++) {
        const key = keys[j];
        for (let i = 0; i < ${tables}; i++) { sets[i].add(key); maps[i].set(key, key); }
      }
      return sets[${tables - 1}].size + maps[0].size;
    }
    function objects() { const keys = []; for (let i = 0; i < ${keysPerTable}; i++) keys.push({ i }); return keys; }
    function symbols() { const keys = []; for (let i = 0; i < ${keysPerTable}; i++) keys.push(Symbol()); return keys; }
    const cases = { objects: () => fill(objects()), symbols: () => fill(symbols()) };
    console.log(cases[process.argv[2]]());
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("small Maps and Sets grow without calling the runtime when their keys are objects or symbols", async () => {
  using dir = tempDir("aot-small-maps-and-sets", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const additionsInRuntime = async (name: string, expected: number) => {
    const path = join(String(dir), "counts-" + name);
    const ran = await run([executable, name], String(dir), {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      BUN_JSC_aotCountsPath: path,
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: expected + "\n", exitCode: 0 });
    let calls = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, operation] = line.split("\toperation:");
      if (
        operation === "operationAOTSetAdd" ||
        operation === "operationAOTMapSet" ||
        operation === "operationAOTReserveCollectionCapacity"
      )
        calls += Number(count);
    }
    return calls;
  };
  const calls = {
    objects: await additionsInRuntime("objects", 2 * keysPerTable),
    symbols: await additionsInRuntime("symbols", 2 * keysPerTable),
  };
  const limits = { objects: 2 * tables, symbols: 2 * tables };
  expect(Object.entries(calls).filter(([name, count]) => count > limits[name as keyof typeof limits])).toEqual([]);
}, 240_000);
