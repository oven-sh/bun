import { expect } from "bun:test";
import { bunExe, isASAN, isLinux, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The atom that native code makes of a string constant of compiled code is held by the atom table of its thread, so that it lives as long as the constant does for that thread.
// A Worker's thread has a table of its own: what it holds has to go when the Worker ends. Held for ever, 4,000 texts cost 128 KB a Worker: 38 MB here.
// A guard from one side: about one run in five reads 2 MB whatever was leaked (why is not known), and then a leak passes. The exact test is the native one:
// image/text/atom-table-gives-back-the-atoms-of-constants (Source/JavaScriptCore/aot/tests/AOTImageTextTests.cpp in the WebKit fork).
const numberOfTexts = 4000;
const numberOfWorkers = 300;
const program = `
import { readFileSync } from "node:fs";
declare var self: Worker;

function texts(): string[] {
  return [${Array.from({ length: numberOfTexts }, (_, index) => `"only_a_text_${index}"`).join(", ")}];
}

// Not the private memory: the part of it that is the mapped executable comes and goes by tens of MB as the kernel pleases.
function anonymousKB(): number {
  for (const line of readFileSync("/proc/self/smaps_rollup", "utf8").split("\\n")) if (line.startsWith("Anonymous:")) return parseInt(line.split(/\\s+/)[1]);
  return -1;
}

if (Bun.isMainThread) {
  let found = 0;
  for (let round = 0; round < ${numberOfWorkers}; round++) {
    const worker = new Worker(import.meta.url);
    found += await new Promise<number>(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.postMessage(0);
    });
    await worker.terminate();
  }
  Bun.gc(true);
  console.log(JSON.stringify({ found, anonymousKB: anonymousKB() }));
} else {
  self.onmessage = () => {
    const probe = { only_a_text_7: 1 };
    let found = 0;
    for (const text of texts()) if (Reflect.has(probe, text)) found++;
    self.postMessage(found);
  };
}
`;

// A sanitizer keeps freed memory back, and its own memory is anonymous too.
test.skipIf(!isLinux || isASAN)(
  "what a Worker's atom table holds of the program's texts goes with the Worker",
  async () => {
    using dir = tempDir("atoms-of-a-worker", { "workers.ts": program });
    const { stdout, stderr, exitCode } = await run([bunExe(), "run", "--debug-aot", "workers.ts"], String(dir));
    expect({
      stderr: stderr.split("\n").filter(line => line.startsWith("error") || line.startsWith("panic")),
      exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const { found, anonymousKB } = JSON.parse(stdout);
    expect(found).toBe(numberOfWorkers);
    expect(anonymousKB).toBeGreaterThan(0);
    expect(anonymousKB).toBeLessThan(25 * 1024);
  },
  120_000,
);
