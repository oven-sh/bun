// What a call gives is expected to be a number. Where it is none, the function goes on as written from that call, with all values computed before. Each such
// way in hands the values on to the next, and each held places of its own in the stack frame: the frame grew with the square of their number.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

setDefaultTimeout(600_000);

const count = 800;
const lines = (make: (index: number) => string) => Array.from({ length: count }, (_, index) => make(index)).join("\n");
const program = `function sumOf(o, texts) {
  let s = 0;
${lines(index => `  const v${index} = (o.a * JSON.parse(texts.t${index % 8})) | 0;`)}
${lines(index => `  s = (s * 3 + v${count - 1 - index}) | 0;`)}
  return s;
}
const sums = [];
for (let turn = 0; turn < 20; turn++) {
  const texts = {};
  for (let index = 0; index < 8; index++) texts["t" + index] = turn % 10 === index ? ['"7"', "null", "true", "[3]"][index & 3] : String(index * turn);
  sums.push(sumOf({ a: turn + 1 }, texts));
}
console.log(sums.join(" "));
`;

test("values held across many calls that may give no number", async () => {
  using folder = tempDir("aot-values-held-across-many-calls", { "main.js": program });
  const cwd = String(folder);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  built(await spawned([bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", executable], cwd, bunEnv));
  const compiled = await spawned([executable], cwd, bunEnv);
  const plain = await spawned([bunExe(), "./main.js"], cwd, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  expect(plain.stdout.trim().split(" ")).toHaveLength(20);
});
