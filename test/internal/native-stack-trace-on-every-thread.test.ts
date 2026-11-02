import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// The report of a failed assertion holds the native stack as WTF writes it. WTF asks the C library for the names of the
// frames (backtrace_symbols), in a block that the library allocates and the caller releases. The library allocates for
// each thread in a place of its own, so every thread writes its stack here, many times, and goes on.
test.skipIf(isWindows)("each thread writes its native stack and goes on", async () => {
  using folder = tempDir("native-stack-trace-on-every-thread", {
    "main.js": `
      const { nativeStackTrace } = require("bun:internal-for-testing");
      const write = () => {
        const kinds = new Set();
        for (let i = 0; i < 100; i++) kinds.add(typeof nativeStackTrace());
        return [...kinds].join();
      };
      if (Bun.isMainThread) {
        (async () => {
          const answers = [write()];
          for (let i = 0; i < 8; i++) {
            const worker = new Worker(__filename);
            answers.push(await new Promise(resolve => (worker.onmessage = event => resolve(event.data))));
            await worker.terminate();
          }
          console.log(answers.join(" "));
        })();
      } else postMessage(write());
    `,
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), join(String(folder), "main.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: Array(9).fill("string").join(" ") + "\n",
    stderr: "",
    exitCode: 0,
  });
});
