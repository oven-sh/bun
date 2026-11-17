// Where the disposal of a `using` declaration throws, the frame of the function around it points at the name that is declared.
//
// `bun run` has no such rule. Its transpiler writes a `try` statement for the scope and means the first `using` as the place of the
// call that disposes, and its source map gives another: the brace that ends a bare block, the last `)` in the block of an `if`, a place
// in the `finally` behind the block of a `try`, the brace of the outer block for a block in a block. So nothing here is held to it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { describe, test } from "./supported";

const thrower = `{ [Symbol.dispose]() { throw new Error("disposed"); } }`;
const throwerLater = `{ async [Symbol.asyncDispose]() { throw new Error("disposed"); } }`;
const quiet = `{ [Symbol.dispose]() {} }`;

// In each the resource whose disposal throws is `resource`.
const scopes: Record<string, string> = {
  "a block": `function disposes() {\n  {\n    using resource = ${thrower};\n    Object(resource);\n  }\n}`,
  "the body of a function": `function disposes() {\n  using resource = ${thrower};\n  Object(resource);\n}`,
  "the block of a try": `function disposes() {\n  try {\n    using resource = ${thrower};\n    Object(resource);\n  } finally {\n    Object(2);\n  }\n}`,
  "a block in a block": `function disposes() {\n  {\n    {\n      using resource = ${thrower};\n      Object(resource);\n    }\n    Object(2);\n  }\n}`,
  "a block left by return": `function disposes() {\n  {\n    using resource = ${thrower};\n    if (Object(resource)) return 1;\n    Object(2);\n  }\n}`,
  "the second of two": `function disposes() {\n  {\n    using other = ${quiet};\n    using resource = ${thrower};\n    Object(other, resource);\n  }\n}`,
  "the head of for-of": `function disposes() {\n  for (using resource of [${thrower}]) {\n    Object(resource);\n  }\n}`,
  "await using": `async function disposes() {\n  {\n    await using resource = ${throwerLater};\n    Object(resource);\n  }\n}`,
};
const tail = `
try {
  await disposes();
} catch (error) {
  console.log(error.stack.split("\\n").find(line => line.includes("at disposes")).replace(/^.*?(\\d+:\\d+)\\)?$/, "$1"));
}
`;
const fileOf = (name: string) => name.replaceAll(" ", "-");
function placeOfResource(text: string) {
  const lines = text.slice(0, text.indexOf("resource")).split("\n");
  return `${lines.length}:${lines.at(-1)!.length + 1}`;
}

const dir = tempDir(
  "aot-frame-around-a-disposal",
  Object.fromEntries(Object.entries(scopes).map(([name, text]) => [`${fileOf(name)}.mjs`, text + tail])),
);
afterAll(() => dir[Symbol.dispose]());
const folder = String(dir);

describe.concurrent("the frame around a disposal that throws", () => {
  for (const [name, text] of Object.entries(scopes)) {
    test(
      name,
      async () => {
        const file = fileOf(name);
        const executable = join(folder, isWindows ? `${file}.exe` : file);
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", `./${file}.mjs`, "--outfile", executable],
            folder,
            bunEnv,
            200_000,
          ),
        );
        const ran = await spawned([executable], folder, bunEnv, 90_000);
        expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
          stdout: placeOfResource(text) + "\n",
          stderr: "",
          exitCode: 0,
        });
      },
      300_000,
    );
  }
});
