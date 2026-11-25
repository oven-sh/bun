// What a build says of itself (how many files of Workers its load took in, that the run is one program, what the image is made of, which code it does not see) is there for whoever
// asks for the stage log. A run that does not ask gets not one line of it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": `{ "type": "module" }`,
  "worker.js": `self.onmessage = event => self.postMessage(event.data + 1);\n`,
  "a.test.js": `import { test, expect } from "bun:test";
test("a Worker answers", async () => {
  const worker = new Worker(new URL("./worker.js", import.meta.url));
  const answer = new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
  worker.postMessage(1);
  expect(await answer).toBe(2);
  worker.terminate();
});
`,
};

async function linesOfTheBuild(env: Record<string, string>) {
  using dir = tempDir("aot-report-of-a-build", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), { ...bunEnv, ...env });
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("AOT "));
}

test("with the stage log each line comes once", async () => {
  const lines = await linesOfTheBuild({ BUN_JSC_logAOTPhaseTimes: "1" });
  for (const head of [
    "AOT load goes on | with 1 more files that Workers start from",
    "AOT test run | one program | test files 1",
    "AOT flow | code that the build does not see | loads code by name ",
    "AOT size of the image: | functions emitted ",
    "AOT size of the tables: | program tables ",
    "AOT size of the program tables: | functions ",
  ])
    expect({ head, times: lines.filter(line => line.startsWith(head)).length }).toEqual({ head, times: 1 });
}, 120_000);

test("without it none comes", async () => {
  expect(await linesOfTheBuild({})).toEqual([]);
}, 120_000);
