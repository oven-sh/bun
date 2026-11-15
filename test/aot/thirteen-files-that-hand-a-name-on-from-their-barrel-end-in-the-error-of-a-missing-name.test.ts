// index.mjs holds stars over two CommonJS files, which lack `round`, and over thirteen files that each hand `round` on from index.mjs by a statement.
// Nobody has the name, so the program ends in a SyntaxError at the link. A statement is followed in the same walk as the stars, with one memory of who was asked for what,
// so each file is asked once. With a walk and a memory of its own for every statement the questions went through the orders of the thirteen, and the executable did not end.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { testOneByOne as test } from "./supported";

test("the executable ends, and in the error that bun gives for the file", async () => {
  const hands = Array.from({ length: 13 }, (_, index) => `f${index}`);
  const files: Record<string, string> = {
    "package.json": `{ "name": "made-up", "type": "module" }`,
    "index.mjs": ["first.cjs", "second.cjs", ...hands.map(name => `${name}.mjs`)]
      .map(path => `export * from "./${path}";`)
      .join("\n"),
    "first.cjs": `exports.one = 1;`,
    "second.cjs": `exports.two = 2;`,
    "reader.mjs": `import * as all from "./index.mjs";\nexport const count = Object.keys(all).length;`,
    "main.mjs": `try {\n  console.log("SAID", (await import("./reader.mjs")).count);\n} catch (error) {\n  console.log("SAID", error.name);\n}`,
  };
  for (const [index, name] of hands.entries())
    files[`${name}.mjs`] = `export { round } from "./index.mjs";\nexport const own${index} = ${index};`;
  using dir = tempDir("thirteen-files-hand-a-name-on-from-their-barrel", files);
  const plain = await run([bunExe(), "./main.mjs"], String(dir), bunEnv);
  expect({ said: plain.stdout.trim(), exitCode: plain.exitCode }).toEqual({ said: "SAID SyntaxError", exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "made"],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { stdout, exitCode } = await run([join(String(dir), "made")], String(dir), bunEnv);
  expect({ said: stdout.trim(), exitCode }).toEqual({ said: "SAID SyntaxError", exitCode: 0 });
}, 30_000);
