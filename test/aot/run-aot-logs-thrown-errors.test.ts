import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { test } from "./supported";

const files = {
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true, "types": [] } }`,
  "main.ts": `declare const console: { log(...values: unknown[]): void };
function double(n: number): number { return n * 2; }
const untyped: any = double;
for (let i = 0; i < 3; i++) { try { untyped("x"); } catch {} }
try { const given: any = "text"; const n: number = given; console.log(n); } catch {}
console.log("done");
`,
};

async function run(dir: string, log: string | undefined) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "run", "--aot", "main.ts"], cwd: dir, env: { ...bunEnv, BUN_AOT_TYPE_ERROR_LOG: log }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A TypeError of --aot that the program catches leaves a line in the log, as in an executable.
test("BUN_AOT_TYPE_ERROR_LOG=stderr", async () => {
  using dir = tempDir("run-aot-logs-thrown-errors", files);
  const { stdout, stderr, exitCode } = await run(String(dir), "stderr");
  const lines = stderr.split("\n").filter(line => line.startsWith("[aot] type-error "));
  expect(lines.map(line => line.replace(/^\[aot\] type-error [0-9a-f]{12} /, ""))).toEqual([
    "enter-function main.ts:2:1 (double): expected number, got string; threw; count 1; from main.ts:4",
    expect.stringMatching(/^[a-z-]+ main\.ts:5:52 \(module\): expected number, got string; threw; count 1$/),
  ]);
  expect({ stdout, exitCode }).toEqual({ stdout: "done\n", exitCode: 0 });
});

test("a file", async () => {
  using dir = tempDir("run-aot-logs-thrown-errors", files);
  const { stdout, stderr, exitCode } = await run(String(dir), join(String(dir), "log.jsonl"));
  const lines = readFileSync(join(String(dir), "log.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(lines).toEqual([
    expect.objectContaining({ aot: "type-error", kind: "enter-function", file: "main.ts", line: 2, col: 1, fn: "double", expected: "number", got: "string", action: "threw", count: 1 }),
    expect.objectContaining({ aot: "type-error", file: "main.ts", line: 5, col: 52, expected: "number", got: "string", action: "threw", count: 1 }),
  ]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "done\n", stderr: "", exitCode: 0 });
});

test.each([undefined, "off"])("no log: %p", async log => {
  using dir = tempDir("run-aot-logs-thrown-errors", files);
  expect(await run(String(dir), log)).toEqual({ stdout: "done\n", stderr: "", exitCode: 0 });
});
