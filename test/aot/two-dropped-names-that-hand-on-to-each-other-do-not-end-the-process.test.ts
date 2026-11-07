// one.mjs and two.mjs each name `round` out of a CommonJS file that lacks it, so the stars of each answer for the name.
// The first star of one.mjs leads to a file that hands `round` on from two.mjs, and the first star of two.mjs to a file that hands it on from one.mjs.
// Only the second star of two.mjs comes to the file that has the name. A read of `round` went from namespace to namespace round that ring until the stack ended: the process died of a fault.
// A read that comes back to a name that is being read now goes to the file that the resolution names.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { testOneByOne as test } from "./supported";

const files = {
  "package.json": `{ "name": "made-up", "type": "module" }`,
  "one.mjs": `export * from "./from-two.mjs";\nexport { round } from "./lacks-one.cjs";`,
  "from-two.mjs": `export { round } from "./two.mjs";`,
  "two.mjs": `export * from "./from-one.mjs";\nexport * from "./has.cjs";\nexport { round } from "./lacks-two.cjs";`,
  "from-one.mjs": `export { round } from "./one.mjs";`,
  "lacks-one.cjs": `exports.first = 1;`,
  "lacks-two.cjs": `exports.second = 2;`,
  "has.cjs": `exports.round = 5;`,
};

const readers = [
  [
    "off the namespace",
    `import * as one from "./one.mjs";\nconst key = JSON.parse('"round"');\ntry {\n  console.log("SAID", one[key]);\n} catch (error) {\n  console.log("SAID", error.name);\n}`,
  ],
  [
    "by name",
    `try {\n  console.log("SAID", (await import("./by-name.mjs")).got);\n} catch (error) {\n  console.log("SAID", error.name);\n}`,
  ],
];

for (const [how, main] of readers) {
  test(how, async () => {
    using dir = tempDir("two-dropped-names-hand-on-to-each-other", {
      ...files,
      "by-name.mjs": `import { round } from "./one.mjs";\nexport const got = round;`,
      "main.mjs": main,
    });
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "made"],
      String(dir),
      bunEnv,
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const { stdout, exitCode } = await run([join(String(dir), "made")], String(dir), bunEnv);
    expect({ said: stdout.trim(), exitCode }).toEqual({ said: "SAID 5", exitCode: 0 });
  });
}
