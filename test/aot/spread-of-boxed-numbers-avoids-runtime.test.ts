// `[...list]` of a number[] allocates double storage. A list filled by `map` or `Array.from` may store its numbers as boxed values.
// The copy converts each element as it goes and does not call the runtime.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const source = `
  declare const process: { argv: string[] };
  const mapped: number[] = [1, 2, 3, 4, 5, 6, 7, 8].map(x => x + 1);
  const halves: number[] = [1, 2, 3, 4, 5, 6, 7, 8].map(x => x + 0.5);
  const made: number[] = Array.from({ length: 8 }, (_, k) => k);
  function turn(i: number): number {
    const a = [...mapped];
    const b = [...halves];
    const c = [...made];
    return (a[i & 3] ?? 0) + (b[2] ?? 0) + (c[i & 7] ?? 0);
  }
  const rounds = Number(process.argv[2]);
  let total = 0;
  for (let i = 0; i < rounds; i++) total += turn(i);
  console.log(total > rounds);
`;

test("spreading a number[] that stores boxed values does not call the runtime", async () => {
  using directory = tempDir("aot-spread-of-numbers-kept-as-values", { "main.ts": source });
  const cwd = String(directory);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv);
  expect(built.exitCode).toBe(0);
  const counted = async (rounds: number) => {
    const path = join(cwd, "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], cwd, env)).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    const counts: Record<string, number> = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  expect(Object.keys(few).length).toBeGreaterThan(0);
  expect((many.operationAOTAppendElements ?? 0) - (few.operationAOTAppendElements ?? 0)).toBeLessThan(200);
}, 240_000);
