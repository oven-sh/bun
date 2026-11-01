// `export *` leads round in rings and meets again behind a fork. A name that nobody behind the stars has ends the load with a SyntaxError, and a search for it ends.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const ring = (behind: string) => ({
  "package.json": `{ "name": "p" }`,
  "index.mjs": `export * from "./a.mjs";\nexport * from "./b.mjs";\n`,
  "a.mjs": `export * from "./index.mjs";\n${behind}export const a = 1;\n`,
  "b.mjs": `export * from "./index.mjs";\n${behind}export const b = 2;\n`,
  "main.mjs": `import { nothing } from "./index.mjs";\nconsole.log("SEEN main", nothing);\n`,
  "a.test.mjs": `import { test } from "bun:test";
test("t", async () => {
  try {
    await import("./main.mjs");
  } catch (error) {
    console.log("SEEN caught", error.name);
  }
});
`,
});

const projects: Record<string, Record<string, string>> = {
  "ES modules alone": ring(""),
  "a CommonJS file of the project behind two of the stars": {
    ...ring(`export * from "./c.cjs";\n`),
    "c.cjs": `exports.c = 3;\n`,
  },
  "a package behind two of the stars": {
    ...ring(`export * from "pkg";\n`),
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "./index.js" }`,
    "node_modules/pkg/index.js": `exports.c = 3;\n`,
  },
};

for (const [name, files] of Object.entries(projects)) {
  test.concurrent(
    name,
    async () => {
      using dir = tempDir("aot-star-rings", files);
      const seen = async (words: string | undefined, flags: string[]) => {
        const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
        const { stdout, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
        return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
      };
      const plain = await seen(undefined, []);
      expect(plain).toEqual({ stdout: ["SEEN caught SyntaxError"], exitCode: 0 });
      for (const words of ["TestRunLayers:0", "TestRunLayers:1", "TestRunLayers:2"])
        expect({ words, ...(await seen(words, ["--aot"])) }).toEqual({ words, ...plain });
    },
    120_000,
  );
}
