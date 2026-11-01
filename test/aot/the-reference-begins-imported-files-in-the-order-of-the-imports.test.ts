import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { referenceEnv } from "./harness/shares";
import { test } from "./supported";

// What an executable prints is held to what `bun run` prints, so `bun run` has to print one thing. Here a module imports two bundles in the CommonJS format of
// `bun build`, and the first takes far longer to read than the second.
const bundle = (statements: string) =>
  `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {${statements}\n})\n`;
const files = {
  "main.mjs": `import "./long.mjs";\nimport "./short.js";\n`,
  "long.mjs": bundle(`console.log("long");\n` + `// ${"x".repeat(96)}\n`.repeat(210_000)),
  "short.js": bundle(`console.log("short");`),
  "package.json": `{ "type": "module" }\n`,
};

test("the reference and the executable begin imported files in the order of the imports", async () => {
  using dir = tempDir("aot-order-of-the-reference", files);
  const cwd = String(dir);
  const printed: string[] = [];
  for (let run = 0; run < 5; run++)
    printed.push((await spawned([bunExe(), "run", "main.mjs"], cwd, referenceEnv)).stdout);
  const executable = join(cwd, isWindows ? "program.exe" : "program");
  built(await spawned([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], cwd, bunEnv));
  printed.push((await spawned([executable], cwd, bunEnv)).stdout);
  expect(printed).toEqual(Array(6).fill("long\nshort\n"));
}, 240_000);
