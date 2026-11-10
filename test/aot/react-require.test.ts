import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// React's enqueueTask() reads `require` off the module object under a key that it puts together, "to get around the bundlers", and swallows an error: act() then takes
// MessageChannel instead of setImmediate, and nobody is told. The test file is built by itself: beside a file that keeps the loader it works anyway. As executables:
// fixed/roads-to-the-loader.txt and parallel/commonjs/react-require.
test("a test file reads require off its module object under a name that it puts together", async () => {
  using dir = tempDir("aot-react-require", {
    "forms.test.cjs": `const { test, vi } = require("vitest");
const name = ("require" + Math.random()).slice(0, 7);
test("as React", () => {
  console.log("SAY", typeof (module && module[name]).call(module, "timers").setImmediate);
});`,
  });
  const printed = (text: string) => text.split("\n").filter(line => line.startsWith("SAY"));
  const plain = await run([bunExe(), "test"], String(dir), bunEnv);
  expect({ printed: printed(plain.stdout), exitCode: plain.exitCode }).toEqual({
    printed: ["SAY function"],
    exitCode: 0,
  });
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect({ printed: printed(compiled.stdout), exitCode: compiled.exitCode }).toEqual({
    printed: ["SAY function"],
    exitCode: 0,
  });
});
