import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const count = 200;
const textsOf = (prefix: string) => Array.from({ length: count }, (_, index) => `${prefix} text number ${index}`);
const storesOf = (prefix: string, first: number) =>
  textsOf(prefix)
    .map((text, index) => `list[${first + index}] = ${JSON.stringify(text)};`)
    .join("\n      ");
const files = {
  "main.js": `
    const list = [];
    // Runs once.
    ${storesOf("once", 0)}
    function fill() {
      ${storesOf("again", count)}
    }
    for (let round = 0; round < 3; round++) fill();
    // A text that is used as a key still finds its property.
    const record = { "once text number 7": 1 };
    console.log(list.length, list.join("").length, record[list[7]], Object.hasOwn(record, "once text number 7"));
  `,
};

const creating = ["operationAOTStringConstant", "operationAOTNewStringConstant"];

test("the first use of a string constant stored under an index stays in compiled code", async () => {
  using dir = tempDir("aot-string-constants", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  const length = textsOf("once").join("").length + textsOf("again").join("").length;
  expect(await run([executable], String(dir), env)).toEqual({
    stdout: `${2 * count} ${length} 1 true\n`,
    stderr: "",
    exitCode: 0,
  });
  let calls = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [number, name] = line.split("\toperation:");
    if (name !== undefined && creating.includes(name)) calls += Number(number);
  }
  // 400 constants. A few calls are left: a free list that has run out, and the text that is also a key.
  expect(calls).toBeLessThan(count / 10);
}, 240_000);
