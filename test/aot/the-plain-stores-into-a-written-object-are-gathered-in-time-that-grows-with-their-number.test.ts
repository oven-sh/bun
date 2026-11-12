// A plain store under a written key joins what a written object holds. The build looked through all the stores it knew for each one more: four times the work with each
// doubling: 4.1 G instructions at 8,000 stores, 23 G at 32,000, 301 G at 128,000, where 2.7 G, 4.8 G and 13 G are enough. At half a million the build does not end within minutes.
//
// The stores stand in a function that nothing calls. The build gathers them there as anywhere, and then leaves the function out of the program: the engine compiles
// none of the stores and the executable runs none of them. That work grows with the stores too, and it is not what this file asks.
// The last store puts a second file under the key that is read, so the build bundles that file only if it has gathered what the function stores. If a build ever stops
// gathering there, it bundles two modules: then the stores belong where they run again.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(60_000);

test("half a million plain stores into a written object are gathered, down to the last", async () => {
  const indexes = Array.from({ length: 512_000 }, (_, index) => index);
  using dir = tempDir("plain-stores-into-a-written-object", {
    "main.cjs": `const held = { pick: "./one.cjs" };
function fill() {
${indexes.map(index => `  held.s${index} = "./one.cjs";`).join("\n")}
  held.pick = "./two.cjs";
}
console.log("SAID", require(held.pick).name, Object.keys(held).length);
`,
    "one.cjs": `exports.name = "one";\n`,
    "two.cjs": `exports.name = "two";\n`,
  });
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "out/program"], cwd);
  // The program, the file that the literal names and the file that the last store names.
  expect({
    modules: Number(/\bbundle +(\d+) modules\b/.exec(built.stdout)?.[1]),
    stderr: built.exitCode ? built.stderr : "",
    exitCode: built.exitCode,
  }).toEqual({ modules: 3, stderr: "", exitCode: 0 });
  // Nothing has called the function, so the object holds the one name that is written in it.
  expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual({
    stdout: "SAID one 1\n",
    stderr: "",
    exitCode: 0,
  });
});
