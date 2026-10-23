// Readable.prototype.pipe ends its destination when the source ends, unless the destination is what process.stdout or
// process.stderr holds at that moment. It finds that out without making either stream: one that nobody has read yet cannot be
// the destination. A program that puts a stream of its own in the place of process.stdout sees that stream spared.
import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { join } from "node:path";
import { run } from "../../../aot/harness/run";

const cases: Record<string, string> = {
  "other-stream": "other: ended true\n",
  "end-false": "end-false: ended false\n",
  "real-stdout": "ab\nstdout: ended false\n",
  "real-stderr": "ab\nstderr: ended false\n",
  "stdout-read-first": "ab\nstdout: ended false\nother: ended true\n",
  "replaced-by-value-before-any-read": "replacement: ended false\n",
  "replaced-by-value-after-a-read": "abreplacement: ended false\n\noriginal: ended true\n",
  "replaced-by-getter": "replacement: ended false, getter ran true\n",
  "replaced-by-assignment": "replacement: ended false, holds it true\n",
  "deleted": "other: ended true\n",
  "process-replaced": "replacement: ended false\n",
  "getter-throws": "RangeError: no stdout\n",
  "process-deleted": "ReferenceError: process is not defined\n",
  "process-undefined": "TypeError\n",
  "process-shadowed-by-a-global-let": "other: ended true\n",
  "deleted-and-no-destination": "TypeError, on end: unpipe\n",
  "equal-strings": "TypeError, on end: unpipe\n",
  "order-of-reads": "end,stdout,stderr\n",
  "first-getter-matches": "stdout\n",
  "end-false-reads-nothing": "reads: \n",
  "worker": "w\nworker: true,false\n",
};

for (const [name, expected] of Object.entries(cases)) {
  test.concurrent(`pipe: ${name}`, async () => {
    const { stdout, stderr, exitCode } = await run([
      bunExe(),
      join(import.meta.dir, "pipe-spares-stdio-fixture.js"),
      name,
    ]);
    expect({ output: stdout + stderr, exitCode }).toEqual({ output: expected, exitCode: 0 });
  });
}
