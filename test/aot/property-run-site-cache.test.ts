import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const rounds = 1000;
const expectedTotal = String((rounds * (rounds - 1)) / 2 + 3 * rounds) + "\n";

function program(allocation: string) {
  return `
    const proto = { inherited: true };
    function fill(target, i) {
      target.first = i;
      target.second = i + 1;
      target.third = i + 2;
      target.fourth = i + 3;
      return target;
    }
    let total = 0;
    for (let round = 0; round < ${rounds}; round++) total += fill(${allocation}, round).fourth;
    console.log(total);
  `;
}

async function countTryPutProperties(allocation: string) {
  using dir = tempDir("aot-property-run-site-cache", { "main.js": program(allocation) });
  const cwd = String(dir);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], cwd, bunEnv);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });

  const path = join(cwd, "counts");
  const env = {
    ...bunEnv,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    BUN_JSC_aotCountsPath: path,
  };
  expect(await run([executable], cwd, env)).toEqual({ stdout: expectedTotal, stderr: "", exitCode: 0 });
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [count, name] = line.split("\toperation:");
    if (name === "operationAOTTryPutProperties") return Number(count);
  }
  return 0;
}

test("stores to a fresh object hit the site cache", async () => {
  expect(await countTryPutProperties("{}")).toBeLessThanOrEqual(2);
}, 240_000);

test("stores under another prototype hit the site cache", async () => {
  expect(await countTryPutProperties("Object.create(proto)")).toBeLessThanOrEqual(2);
}, 240_000);
