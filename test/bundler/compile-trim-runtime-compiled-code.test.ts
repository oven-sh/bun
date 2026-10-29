// --compile --aot --trim: what an executable that only runs code that was compiled into it keeps, removes and says.
// What it says without --trim: ../aot/cli/admitted-code.test.ts.
import { describe, expect, test } from "bun:test";
import { bunEnv, isArm64, isWindows } from "harness";
import { join } from "node:path";
import { unsupported } from "../aot/harness/compiler";
import { run } from "../aot/harness/run";
import { sharedBuilds, sizeOf, type Build } from "../aot/harness/shared-builds";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import {
  canTrim,
  describeBytesRemovedWith,
  featureOf,
  model,
  saysFeatureWasRemoved,
  withoutFeatures,
} from "./compile-trim-features";

const callsLate = (call: string) => `
    {
      const a = { run: () => ${call} };
      const b = { run: () => a.run() };
      const c = { run: () => b.run() };
      const d = { run: () => c.run() };
      const e = { run: () => d.run() };
      const f = { run: () => e.run() };
      const g = { run: () => f.run() };
      const h = { run: () => g.run() };
      setTimeout(() => queueMicrotask(() => Promise.resolve().then(() => console.log(h.run()))), 0);
    }
`;

const shared = sharedBuilds("compile-trim-runtime-compiled-code", {
  "tsconfig.json": `{ "compilerOptions": { "types": ["bun"] } }`,
  "hello.ts": `
    console.log("hello world");
    if (process.argv[2] === "options") console.log(JSON.stringify(process.execArgv));
  `,
  "reads-the-constructor-of-a-function.ts": `
    function made(): string {
      try {
        return "made " + (function () {}).constructor("return 1 + 1")();
      } catch (error) {
        return (error as { code?: string }).code + ": " + (error as Error).message;
      }
    }
    console.log(made());
    console.log(JSON.stringify(process.execArgv));
  `,
  "names-eval.ts": `
    console.log((0, eval)("1 + 1"), (function () {}).constructor("return 1 + 1")());
    console.log(JSON.stringify(process.execArgv));
  `,
  "calls-built-ins-late.ts": `
    const globals = globalThis as unknown as Record<string, unknown>;
    globals[process.argv[2] ?? "nothing"] = JSON.parse(process.argv[3] ?? "0");
    globals.held = Bun.escapeHTML;
    console.log(new Function("return typeof held")());
    ${callsLate(`Bun.escapeHTML("<late>")`)}
    globals.heldToo = Bun.deepEquals;
    const areEqual = Bun.deepEquals;
    const { stringWidth } = Bun;
    globals.alsoHeld = stringWidth;
    ${callsLate(`String(areEqual([1], [1])) + stringWidth("four")`)}
  `,
  "preloaded.js": `console.log("preloaded");`,
  "names-html-rewriter.ts": `
    const rewriter = new HTMLRewriter().on("p", {
      element(element: { setAttribute(name: string, value: string): unknown }) {
        element.setAttribute("class", "seen");
      },
    });
    console.log(await rewriter.transform(new Response("<p>hello</p>")).text());
  `,
  "catches-removed-features.ts": `
    for (const use of [() => Bun.color("red", "hex"), () => encodeURI("a b")]) {
      try {
        console.log(use());
      } catch (error) {
        console.log((error as { code?: string }).code + ": " + (error as Error).message);
      }
    }
    const name = process.argv[2];
    for (const load of [() => require(name), () => import(name)]) {
      try {
        console.log(typeof (await load()));
      } catch (error) {
        console.log((error as { code?: string }).code);
      }
    }
  `,
  "evaluates-and-requires.ts": `
    for (const evaluate of [() => new Function(""), () => eval("")]) {
      try {
        console.log(typeof evaluate());
      } catch (error) {
        console.log((error as Error).name);
      }
    }
    if (process.argv[2]) console.log(typeof require(process.argv[2]));
  `,
  "own.toml": `preload = ["./preloaded.js"]\n`,
  "preloads/bunfig.toml": `preload = ["./preloaded.js"]\n`,
  "preloads/preloaded.js": `console.log("preloaded");`,
  "installs/bunfig.toml": `[install]\nauto = "force"\n`,
});
const { folder } = shared;
const build = (entry: string, ...flags: string[]) => shared.build(entry, "--aot", ...flags);
const saysHello = { stdout: "hello world\n", stderr: "", exitCode: 0 };

function removedFeaturesOf(executable: Build) {
  const removed = readRemovedFeatures(executable.file);
  if (removed === undefined) throw new Error(`${executable.name} has no list of removed features`);
  return model.features.filter(feature => removed.includes(feature.index)).map(feature => feature.name);
}

(canTrim && !unsupported ? describe.concurrent : describe.skip)(
  "--compile --aot: a program that never calls eval() or new Function() and loads no code at run time",
  () => {
    const cantBeUsed = "can't be used with this executable";
    const runsOnlyCompiledCode = `${cantBeUsed} because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code`;
    const noDebugger = {
      stdout: "",
      stderr: `error: BUN_INSPECT ${cantBeUsed}. Rebuild it with --compile-inspector\n`,
      exitCode: 1,
    };
    const withoutEvaluation = "--disallow-code-generation-from-strings";

    test("a program that reads the constructor of a function can still run code from strings; with the interpreter forced out, the error says why", async () => {
      const byUse = await build("reads-the-constructor-of-a-function.ts", "--trim");
      expect(await run([byUse.executable], folder)).toEqual({ stdout: "made 2\n[]\n", stderr: "", exitCode: 0 });
      const forced = await build(
        "reads-the-constructor-of-a-function.ts",
        "--trim",
        ...withoutFeatures(["Interpreter"]),
      );
      const asked = await run([forced.executable], folder);
      expect(asked).toMatchObject({ stderr: "", exitCode: 0 });
      expect(asked.stdout).toStartWith("ERR_FEATURE_REMOVED: Function was removed by --trim ");
    });

    test.each([
      ["BUN_JSC_functionOverrides", isWindows ? "NUL" : "/dev/null"],
      ["BUN_JSC_validateBytecode", "true"],
    ])("without the interpreter, %s in the environment changes nothing", async (name, value) => {
      for (const trims of [[], ["--trim"]]) {
        const { executable } = await build("hello.ts", withoutEvaluation, ...trims);
        expect(await run([executable, "options"], folder, { ...bunEnv, [name]: value })).toEqual({
          ...saysHello,
          stdout: `hello world\n["${withoutEvaluation}"]\n`,
        });
      }
    });

    test("--preload in BUN_OPTIONS and BUN_INSPECT fail at startup: both need --compile-inspector", async () => {
      const { executable } = await build("hello.ts", "--trim");
      expect(await run([executable], folder, { ...bunEnv, BUN_OPTIONS: "--preload ./preloaded.js" })).toEqual({
        stdout: "",
        stderr: `error: --preload ${runsOnlyCompiledCode}\n`,
        exitCode: 1,
      });
      expect(await run([executable], folder, { ...bunEnv, BUN_INSPECT: "ws://127.0.0.1:0/own" })).toEqual(noDebugger);
      const inAnEditor = { ...bunEnv, BUN_INSPECT_CONNECT_TO: "unix:///nowhere.sock" };
      expect(await run([executable, "options"], folder, inAnEditor)).toEqual({
        ...saysHello,
        stdout: "hello world\n[]\n",
      });
    });

    test("built with --disallow-code-generation-from-strings, it starts no debugger either", async () => {
      const { executable } = await build("hello.ts", withoutEvaluation, "--trim");
      expect(await run([executable], folder, { ...bunEnv, BUN_INSPECT: "ws://127.0.0.1:0/trimmed" })).toEqual(
        noDebugger,
      );
      expect(await run([executable], folder, { ...bunEnv, BUN_INSPECT_CONNECT_TO: "unix:///nowhere.sock" })).toEqual(
        saysHello,
      );
    });

    // Every option in each of its forms: compile-trim-bun-options.test.ts.
    test.each([
      ["--preload", "-r ./preloaded.js"],
      ["--eval", "--eval 1"],
      ["--import", "--smol --title=-r --import ./preloaded.js"],
    ])(
      "%s in %j fails at startup in BUN_OPTIONS and fails the build in --compile-exec-argv; as arguments it belongs to the program",
      async (option, options) => {
        const hello = await build("hello.ts", "--trim");
        expect(await run([hello.executable], folder, { ...bunEnv, BUN_OPTIONS: options })).toEqual({
          stdout: "",
          stderr: `error: ${option} ${runsOnlyCompiledCode}\n`,
          exitCode: 1,
        });
        expect(await shared.tryBuild("hello.ts", "--aot", "--trim", "--compile-exec-argv=" + options)).toMatchObject({
          stderr: expect.stringContaining(
            `error: --aot does not support ${option} in --compile-exec-argv because the executable only runs code that was compiled into it`,
          ),
          exitCode: 1,
        });
        expect(await run([hello.executable, ...options.split(" ")], folder)).toEqual(saysHello);
      },
    );

    test("in a bunfig.toml that the executable was built to read, preload is ignored and install.auto fails at startup", async () => {
      const readsIt = await build("hello.ts", "--trim", "--compile-autoload-bunfig");
      // The file may be there for `bun run`.
      expect(await run([readsIt.executable], join(folder, "preloads"))).toEqual(saysHello);
      expect(await run([readsIt.executable], join(folder, "installs"))).toEqual({
        stdout: "",
        stderr: `error: "install.auto" in bunfig.toml ${cantBeUsed} because it doesn't include the Bun command line. Run bun instead\n`,
        exitCode: 1,
      });
      const hello = await build("hello.ts", "--trim");
      for (const besideTheFile of ["preloads", "installs"])
        expect(await run([hello.executable], join(folder, besideTheFile))).toEqual(saysHello);
    });

    test("BUN_INSPECT_PRELOAD fails at startup, and a preload in the file that --config points to is ignored", async () => {
      const { executable } = await build("hello.ts", "--trim");
      const startedWith = (env: Record<string, string>) => run([executable], folder, { ...bunEnv, ...env });
      expect(await startedWith({ BUN_OPTIONS: "--smol", BUN_INSPECT_PRELOAD: "./preloaded.js" })).toEqual({
        stdout: "",
        stderr: `error: BUN_INSPECT_PRELOAD ${runsOnlyCompiledCode}\n`,
        exitCode: 1,
      });
      expect(await startedWith({ BUN_OPTIONS: "--config=own.toml" })).toEqual(saysHello);
      expect(await startedWith({ BUN_INSPECT_PRELOAD: "./preloaded.js" })).toEqual(saysHello);
    });

    test("a program that calls eval() can still run code from strings, and fails the same options: eval() runs text that the program made, not files that the compiler never saw", async () => {
      const { executable } = await build("names-eval.ts", "--trim");
      expect(await run([executable], folder)).toEqual({ stdout: "2 2\n[]\n", stderr: "", exitCode: 0 });
      for (const [option, options] of [
        ["--preload", "--preload ./preloaded.js"],
        ["--require", "--require ./preloaded.js"],
        ["--import", "--import ./preloaded.js"],
        ["--eval", "-e 1"],
        ["--print", "-p 1"],
      ])
        expect(await run([executable], folder, { ...bunEnv, BUN_OPTIONS: options })).toEqual({
          stdout: "",
          stderr: `error: ${option} ${runsOnlyCompiledCode}\n`,
          exitCode: 1,
        });
    });

    const savesLittleToday = isWindows && isArm64;
    if (savesLittleToday) test.todo("removing HTMLRewriter makes the executable at least 64 KB smaller");

    test("a feature is kept when the program uses it and removed when it doesn't", async () => {
      const trimmed = await build("names-html-rewriter.ts", "--trim");
      expect(await run([trimmed.executable], folder)).toEqual({
        stdout: '<p class="seen">hello</p>\n',
        stderr: "",
        exitCode: 0,
      });
      expect(removedFeaturesOf(trimmed)).not.toContain(featureOf("HTMLRewriter"));

      const takenAway = await build(
        "names-html-rewriter.ts",
        "--trim",
        ...withoutFeatures([featureOf("HTMLRewriter")]),
      );
      const saved = sizeOf(trimmed) - sizeOf(takenAway);
      // No machine that runs one of these lanes can be asked afterwards.
      if (saved < 65536) {
        const removed = readRemovedFeatures(takenAway.file) ?? [];
        console.error(`${saved} bytes saved\n${describeBytesRemovedWith(featureOf("HTMLRewriter"), removed)}`);
      }
      if (!savesLittleToday) expect(saved).toBeGreaterThanOrEqual(65536);
      const asked = await run([takenAway.executable], folder);
      expect({
        stderr: asked.stderr,
        saysSo: saysFeatureWasRemoved(asked.stderr, featureOf("HTMLRewriter")),
      }).toEqual({ stderr: asked.stderr, saysSo: true });
      expect(asked.stdout).toBe("");
      expect([70, 1]).toContain(asked.exitCode);

      const hello = await build("hello.ts", "--trim");
      expect(removedFeaturesOf(hello)).toContain(featureOf("HTMLRewriter"));
      expect(await run([hello.executable], folder)).toEqual(saysHello);
    });

    test("the error for a removed feature says how to keep it: by compile.trim.allow if the feature has a public name, by using it otherwise; loading a removed built-in module fails like a package that is not installed", async () => {
      const catches = await build(
        "catches-removed-features.ts",
        "--trim",
        ...withoutFeatures([featureOf("Bun.color"), "URICoding", featureOf("bun:sqlite")]),
      );
      // The build follows a name that the program puts together out of constants, so the name comes from outside.
      expect(await run([catches.executable, "bun:sqlite"], folder)).toEqual({
        stdout:
          'ERR_FEATURE_REMOVED: Bun.color was removed by --trim because your code never uses it by name. A name known only at run time, as in object[key]() or eval(text), does not count. To keep it, add "color" to compile.trim.allow in Bun.build().\n' +
          "ERR_FEATURE_REMOVED: encodeURI was removed by --trim because your code never uses it by name. A name known only at run time, as in object[key]() or eval(text), does not count. To keep it, use it by name somewhere in your code.\n" +
          "MODULE_NOT_FOUND\nERR_MODULE_NOT_FOUND\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("a built-in that the program calls by name stays, also where any global may have been replaced and evaluated text holds the built-in long before the compiler comes to the call; so does one that the program reads by name into a variable and calls from another function", async () => {
      const { executable } = await build("calls-built-ins-late.ts", "--trim");
      expect(await run([executable], folder)).toEqual({
        stdout: "function\n&lt;late&gt;\ntrue4\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("with --disallow-code-generation-from-strings, calls to Function and eval and a dynamic require keep no unused feature, and the require of a built-in module that the program never imports fails like a package that is not installed", async () => {
      const evaluates = await build("evaluates-and-requires.ts", "--trim", withoutEvaluation);
      expect(removedFeaturesOf(evaluates)).toContain(featureOf("bun:sqlite"));
      expect(await run([evaluates.executable], folder)).toEqual({
        stdout: "EvalError\nEvalError\n",
        stderr: "",
        exitCode: 0,
      });
      const asked = await run([evaluates.executable, "bun:sqlite"], folder);
      expect(asked.stderr).toContain('code: "MODULE_NOT_FOUND"');
      expect(asked).toMatchObject({ stdout: "EvalError\nEvalError\n", exitCode: 1 });
    });
  },
);
