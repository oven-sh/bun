// package.json says `"sideEffects": false`, and a test file imports a file for what it does: `import "./setup.mjs"`.
// No executable holds a test file or a preload, so what one of them imports runs, as under `bun test`, however the run is cut into programs.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;
const ready = `console.log("ready:", globalThis.ready);`;
const shared = {
  "package.json": `{ "name": "z", "sideEffects": false }`,
  "setup.mjs": `console.log("setup runs");\nglobalThis.ready = true;\nexport default 1;\n`,
};
const forms: Record<string, { files: Record<string, string>; flags?: string[] }> = {
  "a bare import": { files: { "a.test.mjs": testFile(`import "./setup.mjs";\n${ready}`) } },
  "in a preload": {
    files: { "pre.mjs": `import "./setup.mjs";\nconsole.log("the preload runs");\n`, "a.test.mjs": testFile(ready) },
    flags: ["--preload", "./pre.mjs"],
  },
};

async function runTests(folder: string, flags: string[]) {
  const env = { ...bunEnv, NO_COLOR: "1" };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

// Each project stands alone: in the company of many test files the fault did not show. Over layers the file always ran.
for (const [form, { files, flags = [] }] of Object.entries(forms))
  test.concurrent(
    `${form}, at default flags`,
    async () => {
      using dir = tempDir("test-setup-import", { ...shared, ...files });
      const plain = await runTests(String(dir), flags);
      expect(plain.printed).toContain("setup runs");
      expect(plain.printed).toContain("ready: true");
      expect(await runTests(String(dir), ["--aot", ...flags])).toEqual(plain);
    },
    240_000,
  );
