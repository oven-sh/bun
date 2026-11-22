// The type of a list with objects of more than 1,001 classes is more than the checker computes. A file that is lowered in parts
// and holds such a list is lowered as a whole: each part gave up, and the build did not end.
import { describe, expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

const numbers = (count: number) => Array.from({ length: count }, (_, i) => i);
function program(count: number, item: (i: number) => string, use: string) {
  const classes = numbers(count).map(
    i => `class Item${i} { constructor() { this.part${i} = ${i}; } take${i}() { return this.part${i} + 2; } }`,
  );
  return `${classes.join("\n")}
function fill() { const items = [];
${numbers(count)
  .map(i => `  items.push(${item(i)});`)
  .join("\n")}
  return items; }
${use}
`;
}
const count = (list: string) => `let total = 0;
for (const item of ${list}) total += Object.keys(item).length;
console.log(total);`;
const object = (i: number) => `new Item${i}()`;
const programs: [name: string, file: string, text: string][] = [
  ["1,001 classes", "main.js", program(1001, object, `const kept = fill();\n${count("kept")}`)],
  ["1,002 classes", "main.js", program(1002, object, `const kept = fill();\n${count("kept")}`)],
  ["1,002 classes in a CommonJS file", "main.cjs", program(1002, object, `const kept = fill();\n${count("kept")}`)],
  [
    "in a local variable",
    "main.mjs",
    program(1002, object, `function main() { const kept = fill();\n${count("kept")} }\nmain();`),
  ],
  ["without a variable", "main.js", program(1002, object, count("fill()"))],
  ["the classes themselves", "main.js", program(1002, i => `Item${i}`, `const kept = fill();\n${count("kept")}`)],
  ["object literals", "main.js", program(1002, i => `{ part${i}: ${i} }`, `const kept = fill();\n${count("kept")}`)],
];

describe.skipIf(unsupported)("a list of objects of many classes in a file that is lowered in parts", () => {
  test.each(programs)("%s", async (_, file, text) => {
    await slot(async () => {
      using dir = tempDir("wide-lists-in-parts", { [file]: text });
      const executable = join(String(dir), "main");
      const plain = await run([bunExe(), "--no-install", file], String(dir));
      const images = [];
      for (const threads of [1, 8]) {
        const flags = ["--compile", "--aot", "--aot-testing=LowersInParts", `--aot-threads=${threads}`];
        const cmd = [bunExe(), "build", ...flags, file, "--outfile", executable];
        const built = await run(cmd, String(dir), undefined, 60_000);
        expect(built.exitCode, built.stderr).toBe(0);
        expect((await run([executable], String(dir))).stdout).toBe(plain.stdout);
        images.push(Bun.hash(readFileSync(executable)));
      }
      expect(images[1]).toBe(images[0]);
    });
  });
});
