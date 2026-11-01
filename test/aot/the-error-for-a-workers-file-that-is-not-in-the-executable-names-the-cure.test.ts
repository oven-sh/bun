import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const cure =
  " (entry point). It isn't in this executable, which only runs code that was compiled into it. If it is a file of your project, pass ./node_modules/pkg/lib/w.js to bun compile as another entry point.";

test.each([
  ["Worker", `postMessage("answers");`, "SEEN BuildMessage: ModuleNotFound resolving "],
  [
    "threads.Worker",
    `require("node:worker_threads").parentPort.postMessage("answers");`,
    "SEEN MODULE_NOT_FOUND Cannot find module ",
  ],
])("new %s(new URL(.., import.meta.url)) in a package", async (constructor, answers, asPlain) => {
  using dir = tempDir("aot-the-error-names-the-cure", {
    "package.json": `{ "name": "p" }`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }`,
    "node_modules/pkg/index.js": `import * as threads from "node:worker_threads";
export const start = () => new ${constructor}(new URL("./lib/w.js", import.meta.url));
`,
    "node_modules/pkg/lib/w.js": answers + "\n",
    "main.js": `import { start } from "pkg";
const worker = start();
const got = await new Promise(done => {
  const take = value => done(value?.data ?? value);
  worker.onmessage = take;
  worker.on?.("message", take);
  worker.onerror = event => done(event.message);
  worker.on?.("error", error => done([error.code, error.message, "|", error.cause.message].join(" ")));
});
console.log("SEEN " + got);
process.exit(0);
`,
  });
  const cwd = String(dir);
  const seenBy = async (...entryPoints: string[]) => {
    const build = [bunExe(), "build", "--compile", "--aot", ...entryPoints, "--outfile", "compiled"];
    expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
    return (await run([join(cwd, "compiled")], cwd, bunEnv)).stdout.split("\n").filter(line => line.startsWith("SEEN"));
  };
  const [said] = await seenBy("main.js");
  expect(said).toStartWith(asPlain);
  expect(said).toEndWith(cure);
  expect(await seenBy("main.js", "./node_modules/pkg/lib/w.js")).toEqual(["SEEN answers"]);
});
