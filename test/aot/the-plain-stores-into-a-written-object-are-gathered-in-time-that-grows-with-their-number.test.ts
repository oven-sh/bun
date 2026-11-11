// A plain store under a written key joins what a written object holds. The build looked through all the stores it knew for each one more: four times the work with each
// doubling: 4.1 G instructions at 8,000 stores, 23 G at 32,000, 301 G at 128,000, where 2.7 G, 4.8 G and 13 G are enough. At half a million the build does not end within minutes.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(60_000);

test("an object that half a million plain stores fill is built", async () => {
  const indexes = Array.from({ length: 512_000 }, (_, index) => index);
  using dir = tempDir("plain-stores-into-a-written-object", {
    "main.cjs": `const held = { pick: "./one.cjs" };
${indexes.map(index => `held.s${index} = "./one.cjs";`).join("\n")}
console.log("SAID", require(held.pick).name, Object.keys(held).length);
`,
    "one.cjs": `exports.name = "one";\n`,
  });
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "out/program"], cwd);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual({
    stdout: "SAID one 512001\n",
    stderr: "",
    exitCode: 0,
  });
});
