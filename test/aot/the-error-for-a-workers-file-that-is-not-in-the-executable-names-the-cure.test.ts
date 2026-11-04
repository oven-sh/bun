import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// One executable for all cases. Two packages with the same text start the workers: the build gets the files of `passed` the way
// the error for those of `left-out` says to pass them.
const cure = (file: string) =>
  ` (entry point). It isn't in this executable, which only runs code that was compiled into it. If it is a file of your project, pass ${file} to bun compile as another entry point.`;

const startsWorkers = `import * as threads from "node:worker_threads";
export const starts = {
  "Worker": () => new Worker(new URL("./lib/web.js", import.meta.url)),
  "threads.Worker": () => new threads.Worker(new URL("./lib/node.js", import.meta.url)),
};
`;
const packageOf = (name: string) => ({
  [`node_modules/${name}/package.json`]: `{ "name": "${name}", "type": "module", "main": "index.js" }`,
  [`node_modules/${name}/index.js`]: startsWorkers,
  [`node_modules/${name}/lib/web.js`]: `postMessage("answers");\n`,
  [`node_modules/${name}/lib/node.js`]: `require("node:worker_threads").parentPort.postMessage("answers");\n`,
});

let seen: Promise<string[]> | undefined;
const whatTheProgramSaw = () =>
  (seen ??= (async () => {
    using dir = tempDir("aot-the-error-names-the-cure", {
      "package.json": `{ "name": "p" }`,
      ...packageOf("left-out"),
      ...packageOf("passed"),
      "main.js": `import * as leftOut from "left-out";
import * as passed from "passed";
for (const [name, { starts }] of [["left-out", leftOut], ["passed", passed]])
  for (const constructor in starts) {
    const worker = starts[constructor]();
    const got = await new Promise(done => {
      const take = value => done(value?.data ?? value);
      worker.onmessage = take;
      worker.on?.("message", take);
      worker.onerror = event => done(event.message);
      worker.on?.("error", error => done([error.code, error.message, "|", error.cause.message].join(" ")));
    });
    console.log(["SEEN", name, constructor, got].join(" "));
  }
process.exit(0);
`,
    });
    const cwd = String(dir);
    const entryPoints = ["main.js", "./node_modules/passed/lib/web.js", "./node_modules/passed/lib/node.js"];
    const build = [bunExe(), "build", "--compile", "--aot", ...entryPoints, "--outfile", "compiled"];
    expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
    return (await run([join(cwd, "compiled")], cwd, bunEnv)).stdout.split("\n").filter(line => line.startsWith("SEEN"));
  })());

test.each([
  ["Worker", "web.js", "BuildMessage: ModuleNotFound resolving "],
  ["threads.Worker", "node.js", "MODULE_NOT_FOUND Cannot find module "],
])("new %s(new URL(.., import.meta.url)) in a package", async (constructor, file, asPlain) => {
  const [said, ...more] = (await whatTheProgramSaw()).filter(line => line.startsWith(`SEEN left-out ${constructor} `));
  expect(more).toEqual([]);
  expect(said).toStartWith(`SEEN left-out ${constructor} ${asPlain}`);
  expect(said).toEndWith(cure(`./node_modules/left-out/lib/${file}`));
  expect(await whatTheProgramSaw()).toContain(`SEEN passed ${constructor} answers`);
});
