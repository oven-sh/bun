// package.json says `"sideEffects": false`, and a test file imports a file for what it does: `import "./setup.mjs"`.
// No executable holds a test file or a preload, so what one of them imports runs, as under `bun test`, however the run is cut into programs.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;
const ready = `console.log("ready:", globalThis.ready);`;
const shared = {
  "package.json": `{ "name": "z", "sideEffects": false }`,
  "setup.mjs": `console.log("setup runs");\nglobalThis.ready = true;\nexport default 1;\n`,
};
const forms: Record<string, { files: Record<string, string>; flags?: string[] }> = {
  "a bare import": { files: { "a.test.mjs": testFile(`import "./setup.mjs";\n${ready}`) } },
  "a bare import in TypeScript": {
    files: { "a.test.ts": testFile(`import "./setup.mjs";\nconsole.log("ready:", (globalThis as any).ready);`) },
  },
  "a name that nothing reads": { files: { "a.test.mjs": testFile(`import unread from "./setup.mjs";\n${ready}`) } },
  "no name at all": { files: { "a.test.mjs": testFile(`import {} from "./setup.mjs";\n${ready}`) } },
  "a name that the file only hands on": {
    files: {
      "made.mjs": `export const made = 1;\n`,
      "setup.mjs": `export * from "./made.mjs";\n${shared["setup.mjs"]}`,
      "a.test.mjs": testFile(`import { made } from "./setup.mjs";\nconsole.log("made:", made);\n${ready}`),
    },
  },
  "two test files": {
    files: {
      "a.test.mjs": testFile(`import "./setup.mjs";\n${ready}`),
      "b.test.mjs": testFile(`import "./setup.mjs";\n${ready}`),
    },
  },
  "a package": {
    files: {
      "package.json": `{ "name": "z" }`,
      "node_modules/lib/package.json": `{ "name": "lib", "type": "module", "sideEffects": false, "main": "./index.js" }`,
      "node_modules/lib/index.js": shared["setup.mjs"],
      "a.test.mjs": testFile(`import "lib";\n${ready}`),
    },
  },
  "in a preload": {
    files: { "pre.mjs": `import "./setup.mjs";\nconsole.log("the preload runs");\n`, "a.test.mjs": testFile(ready) },
    flags: ["--preload", "./pre.mjs"],
  },
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

// Over layers what a test file imports is an entry point of the layer below, and runs whatever package.json says. A preload lies in that layer itself:
// the one form that has failed there.
const failedOverLayers = "in a preload";
const atDefaultFlags = ["at default flags", [], ""] as const;
const others = [
  ["as one program under --isolate", ["--isolate"], "TestRunLayers:0"],
  ["over two layers", ["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
] as const;

for (const [form, { files, flags = [] }] of Object.entries(forms))
  for (const [way, more, words] of [atDefaultFlags, ...waysFor(others, form === failedOverLayers)])
    test.concurrent(
      `${form}, ${way}`,
      async () => {
        using dir = tempDir("test-setup-import", { ...shared, ...files });
        const plain = await runTests(String(dir), [...flags, ...more]);
        expect(plain.printed).toContain("setup runs");
        expect(plain.printed).toContain("ready: true");
        expect(await runTests(String(dir), ["--aot", ...flags, ...more], words)).toEqual(plain);
      },
      240_000,
    );
