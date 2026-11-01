import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

test("a test run that loads a file by a name made at run time and evaluates text is built once", async () => {
  using dir = tempDir("aot-text-and-files-by-name", {
    "package.json": `{ "name": "text-and-files-by-name", "type": "module" }`,
    "lib.js": `export function sumOf(pair) { return pair.x + pair.y; }\nexport function total(list) { let sum = 0; for (const item of list) sum += item; return sum; }\n`,
    "other.js": `export const name = "other";\nexport function twice(x) { return x * 2; }\n`,
    "reader.js": `import { sumOf, total } from "./lib.js";\nimport * as other from "./other.js";\nexport const read = apply => [sumOf({ x: 1, y: 2 }), total([1, 2, 3]), apply(other)];\n`,
    "a.test.js": `
import { test } from "bun:test";
import { read } from "./reader.js";
test("reads", async () => {
  globalThis.loaded = [await import(process.env.FILE_TO_LOAD)];
  const apply = new Function("module", process.env.TEXT_TO_RUN);
  console.error("SEEN " + JSON.stringify([read(apply), Object.keys(globalThis.loaded[0])]));
});
`,
  });
  const env = {
    ...bunEnv,
    FILE_TO_LOAD: "./lib.js",
    TEXT_TO_RUN: "return module.twice(21)",
    BUN_JSC_logAOTPhaseTimes: "1",
  };
  const seenWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
    const lines = (stdout + "\n" + stderr).split("\n");
    return {
      seen: lines.filter(line => line.startsWith("SEEN ")),
      startsOver: lines.filter(line => line.startsWith("AOT build starts over")),
      exitCode,
    };
  };
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain).toEqual({ seen: [`SEEN [[3,6,42],["sumOf","total"]]`], startsOver: [], exitCode: 0 });
  expect(compiled).toEqual(plain);
});
