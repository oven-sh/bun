import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `require(process.env.WEBPACK_PACKAGE || "webpack")`: which file is loaded is known at run time only, but one side of the choice is
// written out. Under `bun run --aot` that file is compiled with the program, so that it is compiled code if the choice falls on it.
// BUN_JSC_crashIfInterpreterIsUsed=1 crashes the program if any of its files is interpreted.

const files = {
  "node_modules/the-default/package.json": `{ "name": "the-default", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/the-default/index.js": `exports.name = "the default package";`,
  "lib/local.cjs": `exports.name = "local";`,
  "lib/other.cjs": `exports.name = "other";`,
};

const programs: Record<string, string> = {
  "or.cjs": `console.log(require(process.env.NOBODY_SETS_THIS || "the-default").name);`,
  "nullish.cjs": `console.log(require(globalThis.nobodySetsThis ?? "./lib/local.cjs").name);`,
  "in-a-constructor.cjs": `class Cli { constructor() { this.loaded = require(process.env.NOBODY_SETS_THIS || "the-default"); } }
console.log(new Cli().loaded.name);
`,
  "three-sides.cjs": `const pick = n => require(n === 1 ? "./lib/local.cjs" : globalThis.nobodySetsThis || "./lib/other.cjs").name;
console.log(pick(1), pick(2));
`,
  "the-written-side-is-not-there.cjs": `try { require(process.env.NOBODY_SETS_THIS || "not-installed"); } catch (error) { console.log(error.code); }`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("choice-with-a-written-side", { ...files, [entry]: programs[entry] });
    const run = async (flags: string[], env: Record<string, string | undefined>) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "run", ...flags, entry], cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const plain = await run([], bunEnv);
    const aot = await run(["--aot"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
