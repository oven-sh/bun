import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A file writes the name of a Worker's file out, and the name goes through one more function of the library before a Worker gets it: Bun.fileURLToPath(),
// URL.parse(), a resolver that is told to look from the folder of the file. The build reads what such a function answers with, as it reads the two of node:url.
// At the constructor that is the file the Worker starts from, and the build warns of nothing. Handed to a function of another file it is a name that
// the program writes out and passes along: the start there stays nameless, and the file is compiled all the same.
// An executable tells: the sources are moved away before it runs, and a Worker without its file never answers.
type Way = [name: string, write: (file: string) => string];
const namespaced: Way = ["path.toNamespacedPath()", file => `toNamespacedPath(join(import.meta.dir, "${file}"))`];
const written: Way[] = [
  ["Bun.fileURLToPath() of a URL", file => `Bun.fileURLToPath(new URL("./${file}", import.meta.url))`],
  ['fileURLToPath() of "bun"', file => `pathOf(new URL("./${file}", import.meta.url))`],
  ["Bun.fileURLToPath() of import.meta.resolve()", file => `Bun.fileURLToPath(import.meta.resolve("./${file}"))`],
  ["Bun.pathToFileURL()", file => `Bun.pathToFileURL(import.meta.dir + "/${file}")`],
  ["URL.parse() from import.meta.url", file => `URL.parse("./${file}", import.meta.url)`],
  ["a URL made again by URL.parse()", file => `URL.parse(new URL("./${file}", import.meta.url))`],
  ["Bun.resolveSync() from import.meta.dir", file => `Bun.resolveSync("./${file}", import.meta.dir)`],
  ["Bun.resolveSync() from __dirname, no extension", file => `Bun.resolveSync("./${file.slice(0, -4)}", __dirname)`],
  ["an awaited Bun.resolve()", file => `await Bun.resolve("./${file}", import.meta.dir)`],
  ["import.meta.resolveSync()", file => `import.meta.resolveSync("./${file}")`],
  [
    "require.resolve() with the own folder as its paths",
    file => `require.resolve("./${file}", { paths: [import.meta.dir] })`,
  ],
  ["path.normalize()", file => `normalize(join(import.meta.dir, "lib", "..", "${file}"))`],
  // On Windows it answers with `\\?\` in front of the path: the build takes it for the same path on the other systems alone.
  ...(isWindows ? [] : [namespaced]),
];
const ways = written.map(([name, write], index) => [name, write(`w${index + 1}.mjs`)]);
const answers = ways.map(([name], index) => `SEEN ${name} | w${index + 1}`);

const project: Record<string, string> = {
  "main.mjs": `import "./src/starts.mjs";\n`,
  "src/ask.mjs": `export const ask = worker => new Promise(done => {
  worker.onmessage = event => { done(event.data); worker.terminate(); };
  worker.onerror = event => { event.preventDefault(); done("error"); };
});
`,
  "src/pool.mjs": `import { ask } from "./ask.mjs";\nexport const start = entry => ask(new Worker(entry));\n`,
  ...Object.fromEntries(ways.map((_, index) => [`src/w${index + 1}.mjs`, `postMessage("w${index + 1}");\n`])),
};
const starts = (helper: string, write: (code: string) => string) =>
  `import { join, normalize, toNamespacedPath } from "node:path";
import { fileURLToPath as pathOf } from "bun";
import ${helper};
const say = async (name, answer) => console.log("SEEN " + name + " | " + (await answer().catch(() => "no file")));
` + ways.map(([name, code]) => `await say(${JSON.stringify(name)}, async () => ${write(code)});\n`).join("");

const warnings = (text: string) => [...text.matchAll(/^warn: (TS\d+)/gm)].map(match => match[1]);
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN "));

async function seeInAnExecutable(program: string, warned: string[]) {
  using dir = tempDir("aot-name-of-a-workers-file", { ...project, "src/starts.mjs": program });
  const cwd = String(dir);
  expect(seenIn((await run([bunExe(), "main.mjs"], cwd, bunEnv)).stdout)).toEqual(answers);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const built = await run([bunExe(), "build", "--compile", "--aot", "--outfile", executable, "main.mjs"], cwd, bunEnv);
  expect({
    warnings: warnings(built.stderr),
    stderr: built.exitCode ? built.stderr : "",
    exitCode: built.exitCode,
  }).toEqual({ warnings: warned, stderr: "", exitCode: 0 });
  renameSync(join(cwd, "src"), join(cwd, "moved-away"));
  expect(seenIn((await run([executable], cwd, bunEnv)).stdout)).toEqual(answers);
}

test("at the constructor, the name is the file that the Worker starts from", async () => {
  const program = starts(`{ ask } from "./ask.mjs"`, code => `ask(new Worker(${code}))`);
  await seeInAnExecutable(program, []);
});

test("handed to a function of another file, the name is a file that a Worker may start from", async () => {
  const program = starts(`{ start } from "./pool.mjs"`, code => `start(${code})`);
  await seeInAnExecutable(program, ["TS100082"]);
});
