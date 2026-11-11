import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test writes a file that spies on a module and loads it. The text of the file is put together: the code stands in a second `const`, or nobody can tell the
// build which module the text imports.
const spies = `export function lay(name) { return spyOn(lib, name).mockReturnValue("spied"); }`;
const imports = 'import { spyOn } from "bun:test"; import * as lib from ${JSON.stringify(lib)};';
const testFile = (declares: string, text: string) => `import { test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask } from "../src/user";
${declares}
const name = ["ans", "wer"].join("");
test("t", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "written-")), "late.ts");
  writeFileSync(file, ${text});
  const { lay } = await import(file);
  lay(name);
  console.log("SEEN " + ask());
});`;
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "src/lib.ts": `export function answer(): string { return "real"; }`,
  "src/user.ts": `import { answer } from "./lib"; export const ask = () => answer();`,
  "test/paths.ts": `import { join } from "node:path"; export const lib = join(import.meta.dir, "../src/lib.ts");`,
};

async function printed(dir: string, flags: string[], words: string) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr } = await run([bunExe(), "test", ...flags], dir, env);
  return (stdout + "\n" + stderr).split("\n");
}
const seen = (lines: string[]) => lines.filter(line => line.startsWith("SEEN"));

const ways = {
  "the code stands in a second const": [
    `const lib = join(import.meta.dir, "../src/lib.ts");\nconst spies = ${JSON.stringify(spies)};`,
    "`" + imports + " ${spies}`",
  ],
  "the path is a const of another file": [`import { lib } from "./paths";`, "`" + imports + " " + spies + "`"],
};
test.each(Object.keys(ways))(
  "%s",
  async way => {
    const [declares, text] = ways[way as keyof typeof ways];
    using dir = tempDir("aot-spies-in-joined-text", { ...files, "test/a.test.ts": testFile(declares, text) });
    expect(seen(await printed(String(dir), [], ""))).toEqual(["SEEN spied"]);
    expect(seen(await printed(String(dir), ["--aot"], "TestRunLayers:0"))).toEqual(["SEEN spied"]);
  },
  600000,
);
