// Under --unhandled-rejections the run time warns of a promise that is rejected without a handler, by code of Bun's library. The option that is written into the executable brings
// that code, whatever makes the promises: async functions, generators and import() name no `Promise`. With --aot the program says what plain Bun says under the option, and the
// table below states what that is.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

// Both modes warn alike. The second also makes the exit code 1.
const exitCodes: Record<string, number> = { "warn": 0, "warn-with-error-code": 1 };
const modes = Object.keys(exitCodes);

// The compiler is told that the option is written, never which mode: either brings the same code. So a program is built once, with one mode written into the executable, and takes
// the other as an option of the run, which an executable accepts where its build has brought the code. The modes take turns down the list, so each is written into half of the
// executables, and a mode that ever needs code of its own fails the runs that cross.
const writtenInto = (entry: string) => modes[entries.indexOf(entry) % 2];
const leftToTheRun = (entry: string) => modes[(entries.indexOf(entry) + 1) % 2];

// The process has a number of its own and the program a name of its own.
const withoutWhatDiffers = (text: string) =>
  text.replace(/\((node|bun):\d+\)/g, "($1:N)").replace(/`\S+ --trace-warnings/g, "`program --trace-warnings");

/** What the run time writes to stderr for rejections with these reasons that nothing handles, as `withoutWhatDiffers` leaves it. */
function warningsOf(...reasons: string[]) {
  const lines = reasons.flatMap(reason => [
    `(node:N) UnhandledPromiseRejectionWarning: ${reason}`,
    "(node:N) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). To terminate the bun process on unhandled promise rejection, use the CLI flag `--unhandled-rejections=strict`.",
  ]);
  // A process says once, below its first warning, where to read more.
  lines.splice(1, 0, "(Use `program --trace-warnings ...` to show where the warning was created)");
  return lines.map(line => line + "\n").join("");
}
const handledLater = "(node:N) PromiseRejectionHandledWarning: Promise rejection was handled asynchronously\n";

// What each program prints in either mode. A program without a row fails its tests.
const printed: Record<string, { stdout: string; stderr: string }> = {
  "function.mjs": { stdout: "started\n", stderr: warningsOf("cannot load settings") },
  "number.mjs": { stdout: "started\n", stderr: warningsOf("42") },
  "arrow.mjs": { stdout: "started\n", stderr: warningsOf("cannot load settings") },
  "method.mjs": { stdout: "started\n", stderr: warningsOf("cannot load settings") },
  "behind-an-await.mjs": { stdout: "started\n", stderr: warningsOf("cannot load settings") },
  "generator.mjs": { stdout: "started\n", stderr: warningsOf("cannot load more") },
  "import-call.mjs": { stdout: "started\n", stderr: warningsOf("cannot load the file") },
  "many.mjs": {
    stdout: "started\n",
    stderr: warningsOf(...Array.from({ length: 300 }, (_, n) => `cannot load ${n % 3}`)),
  },
  "handled-afterwards.mjs": {
    stdout: "started\nhandled\n",
    stderr: warningsOf("cannot load settings") + handledLater,
  },
  "typed.ts": { stdout: "started\n", stderr: warningsOf("cannot load settings") },
};

describe
  .skipIf(!!unsupported)
  .concurrent("the warnings of a rejection without a handler are printed with --aot as without", () => {
    const { folder, build } = sharedBuilds("warnings-of-rejections", programs);

    async function answerOf(cmd: string[], optionOfTheRun?: string) {
      const env = { ...bunEnv, NO_COLOR: "1", BUN_OPTIONS: optionOfTheRun };
      const { stdout, stderr, exitCode } = await run(cmd, folder, env);
      return { stdout, stderr: withoutWhatDiffers(stderr), exitCode };
    }

    // Plain Bun is what a program says without --aot: it takes the option on its command line and needs no build.
    async function saysWhatIsStated(entry: string, mode: string) {
      const option = "--unhandled-rejections=" + mode;
      const expected = { ...printed[entry], exitCode: exitCodes[mode] };
      expect(await answerOf([bunExe(), option, entry])).toEqual(expected);
      const written = "--unhandled-rejections=" + writtenInto(entry);
      const { executable } = await build(entry, "--aot", "--compile-exec-argv=" + written);
      expect(await answerOf([executable], option === written ? undefined : option)).toEqual(expected);
    }

    // Each of these starts the build of its program. They stand first, so that the tests that are under way at a time wait for different builds.
    test.each(entries.map(entry => [entry, writtenInto(entry)]))(
      "%s --unhandled-rejections=%s, written into the executable",
      saysWhatIsStated,
    );

    test.each(entries.map(entry => [entry, leftToTheRun(entry)]))(
      "%s --unhandled-rejections=%s, an option of the run",
      saysWhatIsStated,
    );

    // An executable without --aot reads the mode that is written into it too. How the program makes its promise changes nothing there, so one program asks.
    test.each(modes)("function.mjs --unhandled-rejections=%s, written into an executable without --aot", async mode => {
      const { executable } = await build("function.mjs", "--compile-exec-argv=--unhandled-rejections=" + mode);
      expect(await answerOf([executable])).toEqual({ ...printed["function.mjs"], exitCode: exitCodes[mode] });
    });
  });
