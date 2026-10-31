import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `new Worker(entry)`, where `entry` is a parameter, its default, or what a function of another file answers: the build doesn't follow the value to its end.
// The program still says where the file lies, as `new URL("./worker.ts", import.meta.url)`, somewhere else. A file that the build doesn't find runs from its
// text in a test run, in the interpreter, so nobody notices. An executable tells: the sources are moved away before it runs, and a Worker without its file never answers.
const ways: Record<string, string> = {
  "a default of a parameter, a call of an imported arrow, a choice": `spawn.byDefaultOfParameter()`,
  "a call of an imported arrow": `spawn.byCallOfImportedArrow()`,
  "a call of an imported function": `spawn.byCallOfImportedFunction()`,
  "an imported constant": `spawn.byImportedConstant()`,
  "a parameter, the URL written by the caller": `spawn.byParameter(new URL("./src/worker/w5.ts", import.meta.url))`,
  "written at the site": `spawn.written()`,
  "through a barrel": `spawn.throughBarrel()`,
};

const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "src/worker/helper.ts": `export const double = (n: number): number => n * 2;\n`,
  "src/spawning/url/url.ts": `const embedded = (path: string): string => "/never/" + path;
const macro: { URL?: string } = {};
export const url1 = (): string | URL => (macro.URL ? embedded(macro.URL) : new URL("../../worker/w1.ts", import.meta.url));
export const url2 = (): URL => new URL("../../worker/w2.ts", import.meta.url);
export function url3(): URL { return new URL("../../worker/w3.ts", import.meta.url); }
export const url4 = new URL("../../worker/w4.ts", import.meta.url);
`,
  "src/spawning/barrel/inner.ts": `export const url7 = (): string | URL => new URL("../../worker/w7.ts", import.meta.url);\n`,
  "src/spawning/barrel/index.ts": `export * from "./inner.js";\n`,
  "src/spawning/spawn.ts": `import { url1, url2, url3, url4 } from "./url/url";
import { url7 } from "./barrel";
const ask = (worker: Worker): Promise<string> => new Promise(resolve => { worker.onmessage = event => { resolve(event.data); worker.terminate(); }; worker.postMessage(21); });
export const byDefaultOfParameter = (entry: string | URL = url1()) => ask(new Worker(entry, { name: "n" }));
export const byCallOfImportedArrow = () => ask(new Worker(url2()));
export const byCallOfImportedFunction = () => ask(new Worker(url3()));
export const byImportedConstant = () => ask(new Worker(url4));
export const byParameter = (entry: URL) => ask(new Worker(entry));
export const written = () => ask(new Worker(new URL("../worker/w6.ts", import.meta.url)));
export const throughBarrel = () => ask(new Worker(url7()));
`,
  "main.ts":
    `import * as spawn from "./src/spawning/spawn";
const say = async (name: string, ask: () => Promise<string>) => console.log("SEEN " + name + " | " + (await Promise.race([ask(), new Promise<string>(r => setTimeout(() => r("no answer"), 5000))])));
` +
    Object.entries(ways)
      .map(([name, code]) => `await say(${JSON.stringify(name)}, () => ${code});\n`)
      .join("") +
    `process.exit(0);\n`,
};
for (let n = 1; n <= 7; n++) {
  files[`src/worker/w${n}.ts`] = `import { double } from "./helper";
declare var self: any;
self.onmessage = (event: any) => { self.postMessage("w${n} " + double(event.data)); };
`;
}

// In a test run a file that was compiled answers with what it said when the build read it: the test writes over each Worker's file before it starts the Workers.
const testFiles: Record<string, string> = {
  "workers.test.ts":
    `import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import * as spawn from "./src/spawning/spawn";
test("the Workers run as they were compiled", async () => {
  for (let n = 1; n <= 7; n++) {
    const file = new URL("./src/worker/w" + n + ".ts", import.meta.url);
    writeFileSync(file, readFileSync(file, "utf8").replace('"w' + n + ' "', '"from disk "'));
  }
` +
    Object.entries(ways)
      .map(([name, code]) => `  console.log("SEEN " + ${JSON.stringify(name)} + " | " + (await ${code}));\n`)
      .join("") +
    `  expect(1).toBe(1);
});
`,
  "other.test.ts": `import { expect, test } from "bun:test";\ntest("another file", () => { expect(1).toBe(1); });\n`,
};

for (const words of ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"]) {
  test(`a test run runs the file of each Worker compiled (${words})`, async () => {
    using dir = tempDir("aot-worker-named-by-a-url", { ...files, ...testFiles });
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const ran = await run([bunExe(), "test", "--timeout=60000", "--aot", "--isolate"], String(dir), env);
    const seen = ran.stdout.split("\n").filter(line => line.startsWith("SEEN "));
    const expected = Object.keys(ways).map((name, index) => `SEEN ${name} | w${index + 1} 42`);
    const said = ran.exitCode === 0 ? "" : ran.stderr;
    expect({ seen, exitCode: ran.exitCode, said }).toEqual({ seen: expected, exitCode: 0, said: "" });
  }, 120_000);
}

test("the file of each Worker is in the executable", async () => {
  using dir = tempDir("aot-worker-named-by-a-url", files);
  const seenBy = async (...command: string[]) => {
    const { stdout, stderr, exitCode } = await run(command, String(dir), bunEnv);
    return {
      seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")),
      stderr: exitCode ? stderr : "",
      exitCode,
    };
  };
  const plain = await seenBy(bunExe(), "main.ts");
  expect(plain.seen).toEqual(Object.keys(ways).map((name, index) => `SEEN ${name} | w${index + 1} 42`));
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  expect(await seenBy(bunExe(), "build", "--compile", "--aot", "--outfile", executable, "main.ts")).toEqual({
    seen: [],
    stderr: "",
    exitCode: 0,
  });
  renameSync(join(String(dir), "src"), join(String(dir), "moved-away"));
  expect(await seenBy(executable)).toEqual(plain);
}, 120_000);
