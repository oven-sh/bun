// The result type of a function without annotations is inferred from the functions that it calls. Where those call one another, the inference goes around
// a cycle, and it must come to an end however long the cycle is.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const count = 1_000;

function functionsThatCallOneAnotherAtRandom() {
  let seed = 7;
  const nextCallee = () => (seed = (seed * 48_271) % 2_147_483_647) % count;
  const functions = Array.from({ length: count }, (_, index) => {
    const calls = [0, 1, 2].map(
      tag => `  if (node.tag === ${tag}) return f${nextCallee()}(node.next, depth + ${tag});\n`,
    );
    return `function f${index}(node, depth) {\n${calls.join("")}  return node.value;\n}\n`;
  });
  return `${functions.join("")}export const result = f0({ tag: 9, value: 1, next: null }, 0);\n`;
}

function methodsInARing() {
  const methods = Array.from(
    { length: count },
    (_, index) =>
      `  member${index}(steps) {\n    return steps > 0 ? object.member${(index + 1) % count}(steps - 1) : captured + ${index};\n  },\n`,
  );
  return `const captured = 1;\nconst object = {\n${methods.join("")}};\nexport const result = object.member0(3);\n`;
}

async function check(source: string) {
  using dir = tempDir("aot-recursive-untyped", {
    "recursive.js": source,
    "main.ts": `import { result } from "./recursive.js";\nexport const total = result;\n`,
  });
  await using checked = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "./main.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([checked.stdout.text(), checked.stderr.text(), checked.exited]);
  expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
}

test.concurrent("functions that call one another at random", () => check(functionsThatCallOneAnotherAtRandom()));
test.concurrent("methods that call one another in a ring", () => check(methodsInARing()));
