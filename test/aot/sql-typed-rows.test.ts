import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("a callback converts plain rows of another adapter in place", async () => {
  using dir = tempDir("aot-sql-plain-rows", {});
  const folder = join(import.meta.dir, "programs", "data-from-outside");
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "./sql-plain-rows-in-callbacks.ts", "--outfile", executable], folder, bunEnv);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const path = join(String(dir), "counts");
  const ran = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_JSC_useAOTOperationCounters: "1", BUN_JSC_aotTypeCoverageCountsPath: path });
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const counts = new Map(readFileSync(path + ".operations", "utf8").split("\n").map(line => line.split("\t").reverse() as [string, string]));
  expect(Number(counts.get("operationAOTTypedTryConvertRow"))).toBe(6);
}, 240_000);

test("sql<Row[]> decodes matching rows into typed objects", async () => {
  using dir = tempDir("aot-sql-typed-rows", {});
  const folder = join(import.meta.dir, "programs", "data-from-outside");
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "./sql-typed-rows.ts", "--outfile", executable], folder, bunEnv);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const path = join(String(dir), "counts");
  const ran = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1", BUN_JSC_useAOTOperationCounters: "1", BUN_JSC_aotTypeCoverageCountsPath: path });
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const counts = new Map(readFileSync(path + ".operations", "utf8").split("\n").map(line => line.split("\t").reverse() as [string, string]));
  expect(Number(counts.get("JSC__AOT__RowDecoder__appendRow"))).toBe(25);
  expect(Number(counts.get("RowDecoder::literalText"))).toBe(18);
}, 240_000);
