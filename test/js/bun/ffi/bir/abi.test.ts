import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { lines, run, runFixtures, supported } from "./run-fixtures";

// Calling conventions: what is sent is what arrives, between C functions, between C and the C library, and between
// C and JavaScript.
runFixtures("abi");

describe.skipIf(!supported)("abi", () => {
  test.concurrent("a worker that imports a C file has that file's objects to itself", async () => {
    using dir = tempDir("bir-worker", {
      "counter.c": "static int counter;\nint bump(void) { return ++counter; }\nint current(void) { return counter; }\n",
      "worker.ts": `import { bump, current } from "./counter.c";
declare var self: Worker;
self.postMessage([current(), bump(), bump()]);
`,
      "main.ts": `import { bump, current } from "./counter.c";
bump(); bump(); bump();
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
const fromWorker = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
worker.terminate();
console.log(String(fromWorker), current());
`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["main.ts"]);
    expect(lines(stdout).split("\n"), stderr).toEqual(["0,1,2 3", ""]);
    expect(exitCode, stderr).toEqual(0);
  });
});
