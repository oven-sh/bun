// The build writes down where a name that the program resolves leads, under the folder that the name is looked for from. Two ways in which such a row answered another question:
// `require.resolve(name, { paths })` looks from the listed folders in their order, and the run passed over a listed folder of which the executable knows nothing and took the row of a
// later one: another folder's package, silently. A row answers no search through `paths`: what the executable cannot say is refused aloud.
// `createRequire(__dirname)` takes the folder for a file, so it looks from the folder ABOVE. Its row stood under the own folder, and a name that the file's own require made at the run
// found the file above.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const packageIn = (folder: string) => ({
  [`${folder}/node_modules/gauge/package.json`]: `{ "name": "gauge", "exports": { ".": "./lib/main.js" } }\n`,
  [`${folder}/node_modules/gauge/lib/main.js`]: `module.exports = "main of ${folder}";\n`,
});

const ask = `const ask = find => {
  try {
    return find().split("/").slice(-5).join("/");
  } catch (error) {
    return error.code;
  }
};
`;

async function buildAndRun(files: Record<string, string>, entry: string, folders: string[]) {
  using dir = tempDir("what-the-build-wrote-down-for-a-name", files);
  using elsewhere = tempDir("what-the-build-wrote-down-for-a-name-runs", {});
  const [cwd, program] = [String(dir), join(String(elsewhere), "program")];
  const plain = await run([bunExe(), entry], cwd);
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", program], cwd);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  for (const folder of folders) rmSync(join(cwd, folder), { recursive: true });
  return { plain: plain.stdout, compiled: await run([program], String(elsewhere)) };
}

test("a row answers no search through paths", async () => {
  const { plain, compiled } = await buildAndRun(
    {
      ...packageIn("first"),
      ...packageIn("second"),
      "first/main.cjs": `const { join } = require("node:path");
${ask}const second = join(__dirname, "..", "second");
console.log("SAID", ask(() => require.resolve("gauge")));
console.log("SAID", ask(() => require.resolve("gauge", { paths: [second, __dirname] })));
`,
    },
    "first/main.cjs",
    ["first", "second"],
  );
  expect(plain).toBe("SAID first/node_modules/gauge/lib/main.js\nSAID second/node_modules/gauge/lib/main.js\n");
  expect(compiled).toEqual({
    stdout: "SAID first/node_modules/gauge/lib/main.js\nSAID MODULE_NOT_FOUND\n",
    stderr: "",
    exitCode: 0,
  });
});

test("a require made for a folder looks from the folder above", async () => {
  const { plain, compiled } = await buildAndRun(
    {
      "main.mjs": `import "./outer/inner/run.cjs";\n`,
      "outer/part.cjs": `module.exports = "above";\n`,
      "outer/inner/part.cjs": `module.exports = "own";\n`,
      "outer/inner/run.cjs": `const { createRequire } = require("node:module");
${ask.replace("-5", "-2")}const other = createRequire(__dirname);
const made = ["./part", "cjs"].join(".");
console.log("SAID", ask(() => other.resolve("./part.cjs")), other("./part.cjs"));
console.log("SAID", ask(() => require.resolve(made)), require("./part.cjs"));
`,
    },
    "main.mjs",
    ["outer"],
  );
  expect(plain).toBe("SAID outer/part.cjs above\nSAID inner/part.cjs own\n");
  expect(compiled).toEqual({ stdout: plain, stderr: "", exitCode: 0 });
});
