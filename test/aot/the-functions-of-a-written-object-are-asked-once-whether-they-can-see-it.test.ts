// The name of a module that comes out of the keys of a written object is followed where the object stays as it is written. A call of a member leaves it so where every
// property is a function written there that mentions neither this nor super. The build asked that anew at every call of a member, and each asking walked the whole file once
// for every property: eight times the work with each doubling: 2.8 G instructions at 200 members, 49.5 G at 800. At four thousand the build does not end within minutes.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(60_000);

test("an object of four thousand functions each of which is called once is built", async () => {
  const indexes = Array.from({ length: 4000 }, (_, index) => index);
  using dir = tempDir("functions-of-a-written-object", {
    "main.cjs": `const uses = {
${indexes.map(index => `  m${index}(x) { return (x + ${index}) | 0; },`).join("\n")}
};
let sum = 0;
${indexes.map(index => `sum = (sum + uses.m${index}(${index})) | 0;`).join("\n")}
if (sum < 0) for (const name in uses) { try { sum += require("./" + name + ".node").length; } catch {} }
console.log("SAID", sum);
`,
  });
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "program"], cwd);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run([join(cwd, "program")], cwd)).toEqual({ stdout: "SAID 15996000\n", stderr: "", exitCode: 0 });
});
