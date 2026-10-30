import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A Worker's process.stdout posts each batch to the parent, which allocates. A batch that could not be posted goes out later.
test.each([
  ["once", "1", ""],
  ["five times in a row", "5", ""],
  ["in a listener of 'exit'", "0", "1"],
])("no line of a Worker is lost when posting runs out of memory %s", async (_, failures, atExit) => {
  using folder = tempDir("worker-stdout-out-of-memory", {
    "main.mjs": `import { Worker } from "node:worker_threads";
const worker = new Worker(new URL("./worker.mjs", import.meta.url));
worker.on("exit", code => console.log("exit", code));
`,
    "worker.mjs": `const from = Buffer.from;
let failures = Number(process.env.FAILURES);
Buffer.from = function (value, encoding) {
  if (failures > 0) {
    failures--;
    throw new RangeError("Out of memory");
  }
  return from.call(this, value, encoding);
};
console.log("first");
console.log("second");
process.stdout.write("third\\n");
if (process.env.AT_EXIT) {
  process.on("exit", () => {
    failures = 1;
    console.log("at exit");
  });
}
setTimeout(() => console.log("from a timer"), 10);
`,
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(folder),
    env: { ...bunEnv, FAILURES: failures, AT_EXIT: atExit },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "first\nsecond\nthird\nfrom a timer\n" + (atExit ? "at exit\n" : "") + "exit 0\n",
    stderr: "",
    exitCode: 0,
  });
});
