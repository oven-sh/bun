// Where the build can't follow the path that a Worker starts from, it compiles every file of code that the program holds as a file. A package's JavaScript is among them:
// the path that `import()` answers is not followed, so a package that asks for its own worker file that way had a Worker that could not load.
// The program may only read such a file. So nothing in it stops the build, and a Worker that does start it fails as under `bun`. Each case prints what `bun` prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const ofPackage = {
  "node_modules/@made-up/screen/package.json": JSON.stringify({
    name: "@made-up/screen",
    version: "1.0.0",
    type: "module",
    exports: {
      ".": "./index.js",
      "./helper.worker": "./helper.worker.js",
      "./asset.ts": "./asset.ts",
      "./typed.js": "./typed.js",
      "./job.js": "./job.js",
      "./two.ts": "./two.ts",
    },
  }),
  "node_modules/@made-up/screen/helper.worker.js": `function climb(n) {
  return n < 2 ? n : climb(n - 1) + climb(n - 2);
}
self.onmessage = e => postMessage("climbed " + climb(e.data));\n`,
  "node_modules/@made-up/screen/asset.ts": `export const size: number = "seventy";\n`,
  "node_modules/@made-up/screen/typed.js": `interface Size { wide: number }\nconst size: number = 1;\npostMessage("climbed " + size);\n`,
  "node_modules/@made-up/screen/job.js": `import { two } from "./two.ts";\nself.onmessage = () => postMessage("climbed " + two);\n`,
  "node_modules/@made-up/screen/two.ts": `const wide: number = "wide";\nexport const two: string = wide + 2;\n`,
  "jobs/climb.js": `self.onmessage = e => postMessage("climbed " + e.data);\n`,
  "node_modules/@made-up/screen/index.js": `const world = globalThis;
function pick() {
  return typeof world.Worker === "function" ? world.Worker : class {};
}
var Starter = pick();
async function settle(load) {
  return (await load()).default;
}
const path = await settle(() => import("@made-up/screen/helper.worker", { with: { type: "file" } }));
export function start() {
  return new Starter(path);
}\n`,
};
const ask = `const ask = (w, n) =>
  new Promise((resolve, reject) => {
    w.onmessage = e => {
      resolve(e.data);
      w.terminate();
    };
    w.onerror = e => reject(new Error(e.message));
    w.postMessage(n);
  });\n`;

const cases: Record<string, string> = {
  "the package asks for its own file by its own name": `import { start } from "@made-up/screen";\n${ask}console.log(await ask(start(), 20));\n`,
  "the program asks the package for the file": `${ask}const path = (await import("@made-up/screen/helper.worker", { with: { type: "file" } })).default;
console.log(await ask(new Worker(path), 10));\n`,
  "a package's TypeScript that does not type check is only read as text": `${ask}const job = (await import("./jobs/climb.js", { with: { type: "file" } })).default;
const asset = (await import("@made-up/screen/asset.ts", { with: { type: "file" } })).default;
console.log(await ask(new Worker(job), 10), (await Bun.file(asset).text()).length);\n`,
  "a package's JavaScript with TypeScript's syntax is only read as text": `${ask}const job = (await import("./jobs/climb.js", { with: { type: "file" } })).default;
const asset = (await import("@made-up/screen/typed.js", { with: { type: "file" } })).default;
console.log(await ask(new Worker(job), 10), (await Bun.file(asset).text()).length);\n`,
  "a Worker that starts such a file fails as under bun": `${ask}const asset = (await import("@made-up/screen/typed.js", { with: { type: "file" } })).default;
console.log("climbed", await ask(new Worker(asset), 10).catch(() => "nowhere"));\n`,
  "the program loads by the package's name what such a file loads, and it does not type check": `import { two } from "@made-up/screen/two.ts";
${ask}const job = (await import("@made-up/screen/job.js", { with: { type: "file" } })).default;
console.log(await ask(new Worker(job), 1), two);\n`,
};

const holdsTyped = `${ask}const job = (await import("./jobs/climb.js", { with: { type: "file" } })).default;
const asset = (await import("@made-up/screen/typed.js", { with: { type: "file" } })).default;
console.log(await ask(new Worker(job), 10), (await Bun.file(asset).text()).length);\n`;
// What the program itself loads is held to the program's own rule, whether or not a Worker may start it too.
const stops: Record<string, { files: Record<string, string>; says: string }> = {
  "the program names by a path what such a file loads, and it does not type check": {
    files: {
      "main.mjs": `import { two } from "./node_modules/@made-up/screen/two.ts";
${ask}const job = (await import("@made-up/screen/job.js", { with: { type: "file" } })).default;
console.log(await ask(new Worker(job), 1), two);\n`,
    },
    says: "TS2322",
  },
};

// Nothing reaches these mentions of the file, so the program itself does not load it.
const mentioned: Record<string, Record<string, string>> = {
  "a start in a function that nothing reaches names the file": {
    "main.mjs": `import "./first.js";\n${holdsTyped}`,
    "first.js": `export function sure() {\n  return new Worker(new URL("./node_modules/@made-up/screen/typed.js", import.meta.url));\n}\n`,
  },
  "a require() in a function that nothing calls names the file": {
    "main.mjs": `import "./helper.cjs";\n${holdsTyped}`,
    "helper.cjs": `exports.load = () => require("@made-up/screen/typed.js");\n`,
  },
};

test.concurrent.each([...Object.keys(cases), ...Object.keys(mentioned)])("%s", async name => {
  const own = mentioned[name] ?? { "main.mjs": cases[name] };
  using sources = tempDir("aot-a-worker-file-in-a-package", { ...ofPackage, ...own });
  using elsewhere = tempDir("aot-a-worker-file-in-a-package-run", {});
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.mjs"], String(sources), bunEnv);
  expect(plain.stdout).toStartWith("climbed ");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], String(elsewhere), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});

test.concurrent.each(Object.keys(stops))("%s", async name => {
  using sources = tempDir("aot-a-worker-file-in-a-package", { ...ofPackage, ...stops[name].files });
  using elsewhere = tempDir("aot-a-worker-file-in-a-package-run", {});
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(sources),
  );
  expect(built.stderr).toContain(stops[name].says);
  expect(built.exitCode).toBe(1);
});
