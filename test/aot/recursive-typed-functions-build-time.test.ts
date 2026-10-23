import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const functionCount = isDebug || isASAN ? 400 : 4_000;
const timeout = isDebug || isASAN ? 240_000 : 20_000;

const callees = (index: number) => [
  (index * 7 + 1) % functionCount,
  (index * 13 + 5) % functionCount,
  (index * 29 + 11) % functionCount,
];

const shapes: Record<string, (index: number) => string> = {
  "calls assigned to variables": index => {
    const [a, b, c] = callees(index);
    return `function f${index}(x: number) { let a = 0, b = 0, c = 0; if (x > 0) { a = f${a}(x - 1); b = f${b}(x - 1); c = f${c}(x - 1); } return a + b + c + 1; }`;
  },
  "calls added to a variable": index => {
    const [a, b, c] = callees(index);
    return `function f${index}(x: number) { let sum = 1; if (x > 0) { sum += f${a}(x - 1); sum += f${b}(x - 1) * f${c}(x - 1); } return sum; }`;
  },
};

for (const [shape, write] of Object.entries(shapes)) {
  test(
    `build time is linear in the number of mutually recursive functions with inferred return types: ${shape}`,
    async () => {
      using dir = tempDir("aot-recursive-typed", {
        "main.ts": `${Array.from({ length: functionCount }, (_, index) => write(index)).join("\n")}\nexport const result = f0(3);\n`,
      });
      const { stdout, stderr, exitCode } = await run([bunExe(), "check", "--aot", "./main.ts"], String(dir));
      expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
    },
    timeout,
  );
}
