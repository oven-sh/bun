// Under --unhandled-rejections the run time warns of a promise that is rejected without a handler, by code of Bun's library. The option that is written into the executable brings
// that code, whatever makes the promises: async functions, generators and import() name no `Promise`. With --aot the program says what it says without.
import { describe, expect, test } from "bun:test";
import { bunEnv } from "harness";
import { unsupported } from "./harness/compiler";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

// The reason is no Error: `new Error` brings the code in by itself.
const programs = {
  "function.mjs": `async function load(name) { throw "cannot load " + name; }\nload("settings");\nconsole.log("started");\n`,
  "number.mjs": `async function load() { throw 42; }\nload();\nconsole.log("started");\n`,
  "arrow.mjs": `const load = async name => { throw "cannot load " + name; };\nload("settings");\nconsole.log("started");\n`,
  "method.mjs": `class Loader { async load(name) { throw "cannot load " + name; } }\nnew Loader().load("settings");\nconsole.log("started");\n`,
  "behind-an-await.mjs": `async function inner() { return 1; }\nasync function load(name) { await inner(); throw "cannot load " + name; }\nload("settings");\nconsole.log("started");\n`,
  "generator.mjs": `async function* each() { throw "cannot load more"; }\neach().next();\nconsole.log("started");\n`,
  "import-call.mjs": `import("./thrower.mjs");\nconsole.log("started");\n`,
  "thrower.mjs": `throw "cannot load the file";\n`,
  "many.mjs": `async function load(n) { throw "cannot load " + n; }\nfor (let n = 0; n < 300; n++) load(n % 3);\nconsole.log("started");\n`,
  "handled-afterwards.mjs": `async function load(name) { throw "cannot load " + name; }\nconst pending = load("settings");\nsetTimeout(() => pending.catch(() => console.log("handled")), 20);\nconsole.log("started");\n`,
  "typed.ts": `async function load(name: string): Promise<number> { throw "cannot load " + name; }\nload("settings");\nconsole.log("started");\n`,
};
const entries = Object.keys(programs).filter(name => name !== "thrower.mjs");

// The process has a number of its own and the executable a name of its own.
const withoutWhatDiffers = (text: string) =>
  text.replace(/\((node|bun):\d+\)/g, "($1:N)").replace(/`\S+ --trace-warnings/g, "`program --trace-warnings");

describe
  .skipIf(!!unsupported)
  .concurrent("the warnings of a rejection without a handler are printed with --aot as without", () => {
    const { folder, build } = sharedBuilds("warnings-of-rejections", programs);

    test.each(entries.flatMap(entry => ["warn", "warn-with-error-code"].map(mode => [entry, mode])))(
      "%s --unhandled-rejections=%s",
      async (entry, mode) => {
        const embedded = "--compile-exec-argv=--unhandled-rejections=" + mode;
        const answerOf = async ({ executable }: { executable: string }) => {
          const { stdout, stderr, exitCode } = await run([executable], folder, { ...bunEnv, NO_COLOR: "1" });
          return { stdout, stderr: withoutWhatDiffers(stderr), exitCode };
        };
        const without = await answerOf(await build(entry, embedded));
        expect(without.stderr).toContain("UnhandledPromiseRejectionWarning");
        expect(await answerOf(await build(entry, "--aot", embedded))).toEqual(without);
      },
    );
  });
