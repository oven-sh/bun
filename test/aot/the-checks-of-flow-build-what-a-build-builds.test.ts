import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The fuzzer and many tests build with these checks on, on the word that they change nothing of what is built.
// A cycle of ES modules behind a CommonJS entry point: the checked build held a claim that the plain one does not.
test.each(["flow-fixpoint", "verify-each-stage"])(
  "--aot-check=%s builds what a build without it builds",
  async check => {
    using dir = tempDir("the-checks-of-flow-build-what-a-build-builds", {
      "main.js": `// esm-commonjs-cycles:1793349392238 m0.js > m1 . m1.js > m2 m2 . m2.ts > m1
require("./show.cjs");
say("m0 begins");
Object.defineProperty(exports, "first", { enumerable: true, get: () => "m0.first by a getter" });
exports.second = { of: "m0" };
exports.count = 7;
tell("m0 early m1 twice", () => require("./m1.js") === require("./m1.js"));
say("m0 ends");
setTimeout(async () => {
  for (const late of globalThis.atTheEnd.splice(0)) await late();
  say("the end");
}, 1);

`,
      "m1.js": `import "./show.cjs";
import m2_0 from "./m2.ts";
export { second as secondOfm2_1 } from "./m2.ts";
export var first = "m1.first";
export let second = 2;
export let count = 0;
export const more = () => ++count;
say("m1 begins");
tell("m1 early m2 default", () => m2_0);
tell("m1 early m2 default.second", () => m2_0.second);
export default function () {
  return "m1";
}
globalThis.atTheEnd.push(() => tell("m1 late m2 default", () => m2_0));
globalThis.atTheEnd.push(() => tell("m1 late m2 default.second", () => m2_0.second));
say("m1 ends");

`,
      "m2.ts": `// @ts-nocheck
import "./show.cjs";
import m1_0 from "./m1.js";
export var first = "m2.first";
say("m2 begins");
tell("m2 early m1 default", () => m1_0);
tell("m2 early m1 default.second", () => m1_0.second);
export let second: number | string = 2;
export let count = 0;
export const more = () => ++count;
export default { of: "m2", first: "default.first" };
globalThis.atTheEnd.push(() => tell("m2 late m1 default", () => m1_0));
globalThis.atTheEnd.push(() => tell("m2 late m1 default.second", () => m1_0.second));
say("m2 ends");

`,
      "show.cjs": `globalThis.say ??= (...words) => console.log(words.join(" "));
globalThis.tell ??= (label, read) => {
  let text;
  try {
    const value = read();
    text = value === null ? "null" : typeof value === "object" || typeof value === "function" ? typeof value + "{" + Reflect.ownKeys(value).filter(key => typeof key === "string" && !["length", "name", "prototype", "arguments", "caller", "__esModule"].includes(key)).sort().join() + "}" : typeof value + ":" + String(value);
  } catch (error) {
    text = "throws " + (error && error.name);
  }
  console.log(label, text);
};
globalThis.atTheEnd ??= [];

`,
    });
    const build = async (name: string, ...flags: string[]) => {
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", ...flags, "./main.js", "--outfile", name],
        String(dir),
        bunEnv,
      );
      expect(built.stderr).not.toContain("error");
      expect(built.exitCode).toBe(0);
      const { stdout, exitCode } = await run([join(String(dir), name)], String(dir), {
        ...bunEnv,
        BUN_JSC_validateAOTRuntime: "1",
      });
      return { stdout, exitCode };
    };
    const plain = await build("plain");
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("the end");
    expect(await build("checked", `--aot-check=${check}`)).toEqual(plain);
  },
);
