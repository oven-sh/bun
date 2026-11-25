import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// A file may take the function that loads other files off its module object under a key that it puts together while it runs, and swallow the error where there is none: it then goes
// another way, and nobody is told. The test file is built by itself: beside a file that keeps the loader it works anyway. As executables:
// parallel/commonjs/loading-functions-under-keys-put-together.
test("a test file reads require off its module object under a name that it puts together", async () => {
  using dir = tempDir("aot-react-require", {
    "forms.test.cjs": `const { test, vi } = require("vitest");
const key = [String(Date.now()), "require"].sort().pop();
test("under a key put together", () => {
  console.log("SAY", typeof module[key].call(module, "os").cpus);
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
