import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isASAN,
  isCI,
  isLinux,
  isMacOS,
  isWindows,
  readElf64ProgramHeaders,
  tempDirWithBunTypes as tempDir,
} from "harness";
import { closeSync, constants, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import {
  canTrim,
  featureNamed,
  featureOf,
  followedRequirements,
  model,
  saysFeatureWasRemoved,
  tempDirForAotBuilds,
  textOf,
  trimFeatures,
  trimProbe,
  withoutFeatures,
} from "./compile-trim-features";

type Compile = Exclude<Bun.BuildConfig["compile"], boolean | string | undefined>;

const fileOf = (executable: string) => executable + (isWindows ? ".exe" : "");
const sizeOf = (executable: string) => statSync(fileOf(executable)).size;

function removedFeaturesOf(executable: string) {
  const removed = readRemovedFeatures(fileOf(executable));
  if (removed === undefined) throw new Error(`${executable} has no list of removed features`);
  return model.features.filter(feature => removed.includes(feature.index)).map(feature => feature.name);
}

const programs = {
  "hello.ts": `console.log("hello world");`,
  "helper.ts": `export function double(x: number): number { return x * 2; }`,
  "entry.ts": `import { double } from "./helper"; console.log(double(21));`,
  "on-disk.ts": `export const fromDisk: string = [1, 2, 3].map((x: number) => x * 2).join(",");`,
  "near-removed-features.ts": `
    const built = await Bun.build({ entrypoints: [process.env.FOLDER + "/entry.ts"], target: "bun" });
    console.log(built.success, built.outputs.length);
    console.log(new Bun.Transpiler({ loader: "ts" }).transformSync("const x: number = 1; export default x;").trim());
    console.log(new Function("a", "b", "return a * b")(6, 7), (0, eval)("1 + 1"));
    console.log((await import(process.env.FOLDER + "/on-disk.ts")).fromDisk);
    console.log(new RegExp(process.env.FOLDER ? "(a+)b" : "x").exec("caab")![1]);
    let sum = 0;
    for (let i = 0; i < 3_000_000; i++) sum = (sum + i) | 0;
    console.log(sum);
  `,
  "everything-by-name.ts": `
    import { builtinModules } from "node:module";
    process.noDeprecation = true;
    const names: string[] = [...builtinModules, "bun", "bun:test", "bun:jsc", "bun:ffi", "bun:sqlite", "node:test", "node:sqlite"];
    for (const name of [...new Set(names)].sort()) {
      try {
        console.log(name, Object.keys(require(name) as object).length);
      } catch (error) {
        console.log(name, "throws", (error as Error).message);
      }
    }
    for (const object of [Bun, globalThis, process] as unknown as Record<string, unknown>[]) {
      const kinds: string[] = [];
      for (const key of Object.getOwnPropertyNames(object).sort()) {
        try {
          kinds.push(key + ":" + typeof object[key]);
        } catch {
          kinds.push(key + ":throws");
        }
      }
      console.log(kinds.join(" "));
    }
  `,
  "asks-for-the-checker.ts": `
    const entrypoints = [process.env.FOLDER + "/entry.ts"];
    for (const options of [{ check: true }, { compile: { aot: true } }]) {
      try {
        await Bun.build({ entrypoints, ...options });
      } catch (error) {
        console.log(((error as AggregateError).errors?.[0] ?? (error as Error)).message);
      }
    }
    console.log((await Bun.build({ entrypoints, target: "bun" })).success);
  `,
  "names-nothing.ts": `console.log(JSON.stringify(process.execArgv));`,
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
  "calls-a-built-in-that-evaluated-text-holds.ts": `
    const globals = globalThis as unknown as Record<string, unknown>;
    globals[process.argv[2] ?? "nothing"] = JSON.parse(process.argv[3] ?? "0");
    globals.held = Bun.escapeHTML;
    console.log(new Function("return typeof held")());
    const a = { run: () => Bun.escapeHTML("<late>") };
    const b = { run: () => a.run() };
    const c = { run: () => b.run() };
    const d = { run: () => c.run() };
    const e = { run: () => d.run() };
    const f = { run: () => e.run() };
    const g = { run: () => f.run() };
    const h = { run: () => g.run() };
    setTimeout(() => queueMicrotask(() => Promise.resolve().then(() => console.log(h.run()))), 0);
  `,
  "calls-a-built-in-through-a-variable.ts": `
    const globals = globalThis as unknown as Record<string, unknown>;
    globals[process.argv[2] ?? "nothing"] = JSON.parse(process.argv[3] ?? "0");
    globals.held = Bun.escapeHTML;
    console.log(new Function("return typeof held")());
    const escapeText = Bun.escapeHTML;
    const { stringWidth } = Bun;
    globals.alsoHeld = stringWidth;
    const a = { run: () => escapeText("<late>") + stringWidth("four") };
    const b = { run: () => a.run() };
    const c = { run: () => b.run() };
    const d = { run: () => c.run() };
    const e = { run: () => d.run() };
    const f = { run: () => e.run() };
    const g = { run: () => f.run() };
    const h = { run: () => g.run() };
    setTimeout(() => queueMicrotask(() => Promise.resolve().then(() => console.log(h.run()))), 0);
  `,
  "preloaded.js": `console.log("preloaded");`,
  "prints-deep.ts": `console.log({ a: { b: { c: 1 } } });`,
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
  `,
  "loads-a-removed-module.ts": `
    const name = ["bun", "sqlite"].join(":");
    for (const load of [() => require(name), () => import(name)]) {
      try {
        console.log(typeof (await load()));
      } catch (error) {
        console.log((error as { code?: string }).code);
      }
    }
  `,
  "function-constructor-and-dynamic-require.ts": `
    try {
      new Function("");
    } catch {}
    console.log(typeof require(process.argv[2]));
  `,
  "function-constructor-and-direct-eval.ts": `
    for (const evaluate of [() => new Function(""), () => eval("")]) {
      try {
        console.log(typeof evaluate());
      } catch (error) {
        console.log((error as Error).name);
      }
    }
  `,
  "api.ts": `
    const built = await Bun.build({
      entrypoints: [process.argv[2]],
      compile: { outfile: process.argv[3], trim: true, ...JSON.parse(process.argv[4] ?? "{}") },
    });
    console.log(built.success);
  `,
};

async function buildWithApi(folder: string, entry: string, outfile: string, compile: Compile) {
  const built = await Bun.build({
    entrypoints: [join(folder, entry)],
    compile: { outfile: join(folder, outfile, "program"), ...compile },
  });
  const bytes = readFileSync(fileOf(join(folder, outfile, "program")));
  const logged = built.logs.map(log => log.message).filter(message => message.startsWith("compile.trim: "));
  return {
    size: bytes.length,
    contents: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    removed: logged.slice(0, 1).flatMap(message => message.slice(message.lastIndexOf(": ") + 2).split(", ")),
    logged,
  };
}

async function failureOf(compile: Compile) {
  using dir = tempDir("compile-trim-runtime-invalid", { "hello.ts": programs["hello.ts"] });
  try {
    await Bun.build({
      entrypoints: [join(String(dir), "hello.ts")],
      compile: { outfile: join(String(dir), "hello"), ...compile },
    });
  } catch (error) {
    return [error, ...((error as AggregateError).errors ?? [])].map(each => (each as Error).message).join("\n");
  }
  return "it was built";
}

const featuresOfName = (name: string) => trimFeatures.find(each => each.name === name)?.features ?? [];
const namesCoveredBy = (names: string[]) =>
  trimFeatures
    .filter(each => names.some(name => each.features.every(feature => featuresOfName(name).includes(feature))))
    .map(each => each.name);

test.skipIf(canTrim)("a Bun that can't trim says so", () => {
  expect(trimProbe.stderr).toContain("error: this build of Bun doesn't support --trim (");
  expect(trimProbe.exitCode).not.toBe(0);
});

test.skipIf(!isCI || isASAN)("every Bun that CI builds can trim, except the one with AddressSanitizer", () => {
  expect({ stderr: trimProbe.stderr, exitCode: trimProbe.exitCode }).toEqual({ stderr: "", exitCode: 0 });
});

test.skipIf(canTrim)("Bun.build rejects compile.trim on a Bun that can't trim", async () => {
  expect(await failureOf({ trim: true })).toContain("this build of Bun doesn't support --trim");
});

test.each([
  [5],
  ["sqlite"],
  [[]],
  [["sqlite"]],
  [{ auto: false }],
  [{ deny: ["sqlite"] }],
  [{ keep: ["sqlite"] }],
  [{ allow: [{}] }],
  [{ remove: [{}] }],
  [{ locales: [1] }],
])("compile.trim: %j is not a valid value", async trim => {
  expect(await failureOf({ trim: trim as never })).toContain(
    "compile.trim must be true, false or an object: { allow, remove, locales, log }",
  );
});

test.each([
  ["allow", { allow: "sqlite" }],
  ["remove", { remove: "sqlite" }],
  ["locales", { locales: "en" }],
])("compile.trim.%s must be an array", async (key, trim) => {
  expect(await failureOf({ trim: trim as never })).toContain(`${key} must be an array`);
});

test("compile.trim: false and undefined don't change the executable", async () => {
  using dir = tempDir("compile-trim-runtime-api", programs);
  const folder = String(dir);
  const untrimmed = await buildWithApi(folder, "hello.ts", "untrimmed", {});
  for (const trim of [false, undefined])
    expect(await buildWithApi(folder, "hello.ts", "same", { trim })).toEqual(untrimmed);
});

test("--trim requires --compile", async () => {
  using dir = tempDir("compile-trim-runtime-flag", { "hello.ts": programs["hello.ts"] });
  const built = await run([bunExe(), "build", "--trim", "hello.ts"], String(dir));
  expect(built.stderr).toContain("--trim requires --compile");
  expect(built.exitCode).not.toBe(0);
});

describe.skipIf(!canTrim)("--trim", () => {
  test("--trim-without rejects an unknown feature name", async () => {
    using dir = tempDir("compile-trim-runtime-unknown-feature", { "hello.ts": programs["hello.ts"] });
    const built = await run(
      [bunExe(), "build", "--compile", "--trim", "--trim-without=NoSuchFeature", "hello.ts", "--outfile", "hello"],
      String(dir),
    );
    expect(built.stderr).toContain("NoSuchFeature");
    expect(built.stderr).not.toContain("this build of Bun doesn't support --trim");
    expect(built.exitCode).toBe(1);
  });

  for (const flags of [[], ["--aot"]]) {
    const how = ["--compile", ...flags].join(" ");

    async function isSmallerAndPrintsTheSame(program: string) {
      using dir = tempDir("compile-trim-runtime", programs);
      const folder = String(dir);
      const env = { ...bunEnv, FOLDER: folder };
      const loadsCodeFromDisk = flags.length > 0 && program === "near-removed-features" ? ["--compile-inspector"] : [];
      const build = [bunExe(), "build", "--compile", ...flags, ...loadsCodeFromDisk, `${program}.ts`, "--outfile"];
      expect(await run([...build, `${program}-whole`], folder)).toMatchObject({ exitCode: 0 });
      expect(await run([...build, `${program}-trimmed`, "--trim"], folder)).toMatchObject({ exitCode: 0 });
      const whole = await run([join(folder, `${program}-whole`)], folder, env);
      expect(await run([join(folder, `${program}-trimmed`)], folder, env)).toEqual(whole);
      expect(whole).toMatchObject({ exitCode: 0 });
      const saved = sizeOf(join(folder, `${program}-whole`)) - sizeOf(join(folder, `${program}-trimmed`));
      expect(saved).toBeGreaterThan(flags.length > 0 ? 15_000_000 : 30_000_000);
    }

    test.skipIf(flags.length > 0 && !!unsupported).each(["hello", "near-removed-features"])(
      `${how}: %s: the trimmed executable is much smaller and prints the same output`,
      isSmallerAndPrintsTheSame,
    );

    (flags.length > 0 ? test.todo : test)(
      `${how}: a program that loads every built-in module from a dynamic path: the trimmed executable is much smaller and prints the same output` +
        (flags.length > 0
          ? " (loading a built-in module from a dynamic path should fail like a package that is not installed, with and without --trim)"
          : ""),
      () => isSmallerAndPrintsTheSame("everything-by-name"),
    );

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: the build prints the executable's size and how much was removed`,
      async () => {
        using dir = tempDir("compile-trim-runtime-size", programs);
        const folder = String(dir);
        const whole = await run([bunExe(), "build", "--compile", ...flags, "hello.ts", "--outfile", "whole"], folder);
        expect(whole.stdout).not.toContain(" MB");
        const trimmed = await run(
          [bunExe(), "build", "--compile", ...flags, "--trim", "hello.ts", "--outfile", "trimmed"],
          folder,
        );
        const [, size, removed] =
          / compile +trimmed(?:\.exe)? +(\d+\.\d) MB \((\d+\.\d) MB of unused Bun APIs removed\)\n/.exec(
            trimmed.stdout,
          ) ?? [];
        expect({ size, stdout: trimmed.stdout }).toEqual({
          size: (sizeOf(join(folder, "trimmed")) / 1e6).toFixed(1),
          stdout: trimmed.stdout,
        });
        expect(Number(removed)).toBeGreaterThan(30);
      },
    );

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: bunfig.toml is read only by an executable that was built to read it`,
      async () => {
        using dir = tempDir("compile-trim-runtime", { ...programs, "bunfig.toml": "[console]\ndepth = 1\n" });
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", ...flags, "prints-deep.ts", "--trim", "--outfile"];
        expect(await run([...build, "by-default"], folder)).toMatchObject({ exitCode: 0 });
        expect(await run([...build, "asked", "--compile-autoload-bunfig"], folder)).toMatchObject({ exitCode: 0 });
        expect(await run([join(folder, "by-default")], folder)).toEqual({
          stdout: "{\n  a: {\n    b: {\n      c: 1,\n    },\n  },\n}\n",
          stderr: "",
          exitCode: 0,
        });
        expect(await run([join(folder, "asked")], folder)).toEqual({
          stdout: "{\n  a: {\n    b: [Object ...],\n  },\n}\n",
          stderr: "",
          exitCode: 0,
        });
      },
    );

    test.skipIf(!isLinux || (flags.length > 0 && !!unsupported))(
      `${how}: the program is mapped past the end of Bun's image, never where a feature was removed, and the zeros of .bss are not in the file`,
      async () => {
        using dir = tempDir("compile-trim-runtime-bss", programs);
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", ...flags, "--trim", "hello.ts", "--outfile", "hello"];
        expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
        const segments = readElf64ProgramHeaders(join(folder, "hello")).filter(header => header.type === 1);
        for (const [index, segment] of segments.entries()) {
          if (index)
            expect(segment.vaddr).toBeGreaterThanOrEqual(segments[index - 1].vaddr + segments[index - 1].memsz);
        }
        const endOfBun = segments.findLastIndex(segment => segment.filesz < segment.memsz);
        expect(endOfBun).toBeGreaterThanOrEqual(0);
        const program = segments.slice(endOfBun + 1);
        expect(program.length).toBeGreaterThan(0);
        expect(await run([join(folder, "hello")], folder)).toEqual({
          stdout: "hello world\n",
          stderr: "",
          exitCode: 0,
        });
      },
    );

    test.skipIf(isWindows || (flags.length > 0 && !!unsupported))(
      `${how}: using a removed feature ends the program even when file descriptor 2 takes no more bytes`,
      async () => {
        using dir = tempDir("compile-trim-runtime-removed", programs);
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", ...flags, "--trim", "hello.ts", "--outfile", "hello"];
        expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
        expect(Bun.spawnSync(["mkfifo", join(folder, "pipe")]).exitCode).toBe(0);
        const readerThatNeverReads = openSync(join(folder, "pipe"), constants.O_RDWR | constants.O_NONBLOCK);
        const descriptor2 = openSync(join(folder, "pipe"), constants.O_WRONLY);
        try {
          expect(() => {
            while (true) writeSync(readerThatNeverReads, Buffer.alloc(512, "y"));
          }).toThrow(expect.objectContaining({ code: "EAGAIN" }));
          await using asked = Bun.spawn({
            cmd: [join(folder, "hello"), "install"],
            cwd: folder,
            env: { ...bunEnv, BUN_BE_BUN: "1" },
            stdout: "pipe",
            stderr: descriptor2,
          });
          expect(await Promise.race([asked.exited, Bun.sleep(20_000).then(() => "it hangs")])).toBe(70);
        } finally {
          closeSync(descriptor2);
          closeSync(readerThatNeverReads);
        }
      },
    );

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: BUN_BE_BUN=1 fails with the name of the removed feature`,
      async () => {
        using dir = tempDir("compile-trim-runtime-removed", programs);
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", ...flags, "--trim", "hello.ts", "--outfile", "hello"];
        expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
        const asked = await run([join(folder, "hello"), "install"], folder, { ...bunEnv, BUN_BE_BUN: "1" });
        // It is written to C's descriptor 2, which translates line ends on Windows.
        expect(asked.stderr).toBe(
          `error: BUN_BE_BUN is set, but this executable doesn't include ${textOf(featureNamed("Tools"))}. Run bun instead.${isWindows ? "\r\n" : "\n"}`,
        );
        expect(asked).toMatchObject({ stdout: "", exitCode: 70 });
        const version = await run([join(folder, "hello"), "--version"], folder, { ...bunEnv, BUN_BE_BUN: "1" });
        expect(version).toEqual({ stdout: Bun.version + "\n", stderr: "", exitCode: 0 });
      },
    );
  }

  describe.skipIf(!!unsupported)(
    "--compile --aot: a program that never calls eval() or new Function() and loads no code at run time",
    () => {
      const cantBeUsed = "can't be used with this executable";
      const runsOnlyCompiledCode = `${cantBeUsed} because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code`;
      const hasNoFunctionSource = `${cantBeUsed} because it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag`;
      const noDebugger = {
        stdout: "",
        stderr: `error: BUN_INSPECT ${cantBeUsed}. Rebuild it with --compile-inspector\n`,
        exitCode: 1,
      };

      async function built(program: string, folder: string, flags: string[] = []) {
        const build = [bunExe(), "build", "--compile", "--aot", ...flags, `${program}.ts`, "--outfile"];
        expect(await run([...build, `${program}-whole`], folder)).toMatchObject({ exitCode: 0 });
        expect(await run([...build, `${program}-trimmed`, "--trim"], folder)).toMatchObject({ exitCode: 0 });
        return { whole: join(folder, `${program}-whole`), trimmed: join(folder, `${program}-trimmed`) };
      }

      test("a program that reads the constructor of a function can still run code from strings; with the interpreter forced out, the error says why", async () => {
        using dir = tempDir("compile-trim-runtime-closed", programs);
        const folder = String(dir);
        const { whole, trimmed } = await built("reads-the-constructor-of-a-function", folder);
        expect(await run([whole], folder)).toEqual({ stdout: "made 2\n[]\n", stderr: "", exitCode: 0 });
        expect(await run([trimmed], folder)).toEqual({ stdout: "made 2\n[]\n", stderr: "", exitCode: 0 });
        const forced = [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--trim",
          ...withoutFeatures(["Interpreter"]),
          "reads-the-constructor-of-a-function.ts",
          "--outfile",
          "forced",
        ];
        expect(await run(forced, folder)).toMatchObject({ exitCode: 0 });
        const asked = await run([join(folder, "forced")], folder);
        expect(asked).toMatchObject({ stderr: "", exitCode: 0 });
        expect(asked.stdout).toStartWith("ERR_FEATURE_REMOVED: Function was removed by --trim ");
      });

      test.each([
        ["BUN_JSC_functionOverrides", isWindows ? "NUL" : "/dev/null"],
        ["BUN_JSC_validateBytecode", "true"],
      ])("without the interpreter, %s in the environment changes nothing", async (name, value) => {
        using dir = tempDir("compile-trim-runtime-engine-options", programs);
        const folder = String(dir);
        const build = [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--disallow-code-generation-from-strings",
          "names-nothing.ts",
          "--outfile",
        ];
        expect(await run([...build, "whole"], folder)).toMatchObject({ exitCode: 0 });
        expect(await run([...build, "trimmed", "--trim"], folder)).toMatchObject({ exitCode: 0 });
        const answers = { stdout: `["--disallow-code-generation-from-strings"]\n`, stderr: "", exitCode: 0 };
        expect(await run([join(folder, "whole")], folder, { ...bunEnv, [name]: value })).toEqual(answers);
        expect(await run([join(folder, "trimmed")], folder, { ...bunEnv, [name]: value })).toEqual(answers);
      });

      test("--preload in BUN_OPTIONS and BUN_INSPECT fail at startup, with and without --trim: both need --compile-inspector", async () => {
        using dir = tempDir("compile-trim-runtime-closed-options", programs);
        const folder = String(dir);
        const { whole, trimmed } = await built("names-nothing", folder);
        const preloads = { ...bunEnv, BUN_OPTIONS: "--preload ./preloaded.js" };
        for (const executable of [whole, trimmed]) {
          expect(await run([executable], folder, preloads)).toEqual({
            stdout: "",
            stderr: `error: --preload ${runsOnlyCompiledCode}\n`,
            exitCode: 1,
          });
          expect(await run([executable], folder, { ...bunEnv, BUN_INSPECT: "ws://127.0.0.1:0/own" })).toEqual(
            noDebugger,
          );
          const inAnEditor = await run([executable], folder, {
            ...bunEnv,
            BUN_INSPECT_CONNECT_TO: "unix:///nowhere.sock",
          });
          expect(inAnEditor).toEqual({ stdout: "[]\n", stderr: "", exitCode: 0 });
        }
      });

      test("built with --compile-inspector, --preload in BUN_OPTIONS runs the file first, with and without --trim", async () => {
        using dir = tempDir("compile-trim-runtime-closed-options", programs);
        const folder = String(dir);
        const { whole, trimmed } = await built("hello", folder, ["--compile-inspector"]);
        const plain = await run([bunExe(), "run", "--preload", "./preloaded.js", "hello.ts"], folder);
        expect(plain).toEqual({ stdout: "preloaded\nhello world\n", stderr: "", exitCode: 0 });
        for (const executable of [whole, trimmed])
          expect(await run([executable], folder, { ...bunEnv, BUN_OPTIONS: "--preload ./preloaded.js" })).toEqual(
            plain,
          );
      });

      test("built with --no-compile-function-source, --preload in BUN_OPTIONS fails at startup with and without --trim", async () => {
        using dir = tempDir("compile-trim-runtime-closed-options", programs);
        const folder = String(dir);
        const { whole, trimmed } = await built("names-nothing", folder, ["--no-compile-function-source"]);
        for (const executable of [whole, trimmed]) {
          const started = await run([executable], folder, { ...bunEnv, BUN_OPTIONS: "--preload ./preloaded.js" });
          expect(started).toEqual({ stdout: "", stderr: `error: --preload ${hasNoFunctionSource}\n`, exitCode: 1 });
        }
      });

      test("built with --disallow-code-generation-from-strings, it starts no debugger either", async () => {
        using dir = tempDir("compile-trim-runtime-closed-options", programs);
        const folder = String(dir);
        expect(
          await run(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              "--trim",
              "--disallow-code-generation-from-strings",
              "hello.ts",
              "--outfile",
              "hello",
            ],
            folder,
          ),
        ).toMatchObject({ exitCode: 0 });
        expect(
          await run([join(folder, "hello")], folder, { ...bunEnv, BUN_INSPECT: "ws://127.0.0.1:0/trimmed" }),
        ).toEqual(noDebugger);
        expect(
          await run([join(folder, "hello")], folder, { ...bunEnv, BUN_INSPECT_CONNECT_TO: "unix:///nowhere.sock" }),
        ).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
      });

      test.each([
        ["--preload", "--preload ./preloaded.js"],
        ["--preload", "--preload=./preloaded.js"],
        ["--preload", "-r ./preloaded.js"],
        ["--require", "--require ./preloaded.js"],
        ["--import", "--import ./preloaded.js"],
        ["--eval", "--eval 1"],
        ["--eval", "-e 1"],
        ["--print", "--print 1"],
        ["--print", "-p 1"],
        ["--import", "--smol --title=-r --import ./preloaded.js"],
      ])(
        "%s in %j fails at startup in BUN_OPTIONS and fails the build in --compile-exec-argv; as arguments it belongs to the program",
        async (option, options) => {
          using dir = tempDir("compile-trim-runtime-closed-options", programs);
          const folder = String(dir);
          const failure = { stdout: "", stderr: `error: ${option} ${runsOnlyCompiledCode}\n`, exitCode: 1 };
          const build = [bunExe(), "build", "--compile", "--aot", "--trim", "hello.ts", "--outfile"];
          expect(await run([...build, "hello"], folder)).toMatchObject({ exitCode: 0 });
          expect(await run([join(folder, "hello")], folder, { ...bunEnv, BUN_OPTIONS: options })).toEqual(failure);
          expect(await run([...build, "hello-with-options", "--compile-exec-argv=" + options], folder)).toMatchObject({
            stderr: expect.stringContaining(
              `error: --aot does not support ${option} in --compile-exec-argv because the executable only runs code that was compiled into it`,
            ),
            exitCode: 1,
          });
          expect(await run([join(folder, "hello"), ...options.split(" ")], folder)).toEqual({
            stdout: "hello world\n",
            stderr: "",
            exitCode: 0,
          });
        },
      );

      test("in a bunfig.toml that the executable was built to read, preload is ignored and install.auto fails at startup", async () => {
        using dir = tempDir("compile-trim-runtime-closed-options", {
          ...programs,
          "bunfig.toml": `preload = ["./preloaded.js"]\n`,
          "installs/bunfig.toml": `[install]\nauto = "force"\n`,
        });
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", "--aot", "--trim", "hello.ts", "--outfile"];
        expect(await run([...build, "reads-it", "--compile-autoload-bunfig"], folder)).toMatchObject({ exitCode: 0 });
        // The file may be there for `bun run`.
        expect(await run([join(folder, "reads-it")], folder)).toEqual({
          stdout: "hello world\n",
          stderr: "",
          exitCode: 0,
        });
        expect(await run([join(folder, "reads-it")], join(folder, "installs"))).toEqual({
          stdout: "",
          stderr: `error: "install.auto" in bunfig.toml ${cantBeUsed} because it doesn't include the Bun command line. Run bun instead\n`,
          exitCode: 1,
        });
        expect(await run([...build, "hello"], folder)).toMatchObject({ exitCode: 0 });
        expect(await run([join(folder, "hello")], folder)).toEqual({
          stdout: "hello world\n",
          stderr: "",
          exitCode: 0,
        });
      });

      test("BUN_INSPECT_PRELOAD fails at startup, and a preload in the file that --config points to is ignored", async () => {
        using dir = tempDir("compile-trim-runtime-closed-options", {
          ...programs,
          "own.toml": `preload = ["./preloaded.js"]\n`,
        });
        const folder = String(dir);
        expect(
          await run([bunExe(), "build", "--compile", "--aot", "--trim", "hello.ts", "--outfile", "hello"], folder),
        ).toMatchObject({ exitCode: 0 });
        const startedWith = (env: Record<string, string>) =>
          run([join(folder, "hello")], folder, { ...bunEnv, ...env });
        expect(await startedWith({ BUN_OPTIONS: "--smol", BUN_INSPECT_PRELOAD: "./preloaded.js" })).toEqual({
          stdout: "",
          stderr: `error: BUN_INSPECT_PRELOAD ${runsOnlyCompiledCode}\n`,
          exitCode: 1,
        });
        expect(await startedWith({ BUN_OPTIONS: "--config=own.toml" })).toEqual({
          stdout: "hello world\n",
          stderr: "",
          exitCode: 0,
        });
        expect(
          await run([join(folder, "hello")], folder, { ...bunEnv, BUN_INSPECT_PRELOAD: "./preloaded.js" }),
        ).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
      });

      test("an executable that calls eval() fails the same options, with and without --trim: eval() runs text that the program made, not files that the compiler never saw", async () => {
        using dir = tempDir("compile-trim-runtime-open-options", programs);
        const folder = String(dir);
        const { whole, trimmed } = await built("names-eval", folder);
        for (const [option, options] of [
          ["--preload", "--preload ./preloaded.js"],
          ["--require", "--require ./preloaded.js"],
          ["--import", "--import ./preloaded.js"],
          ["--eval", "-e 1"],
          ["--print", "-p 1"],
        ]) {
          const env = { ...bunEnv, BUN_OPTIONS: options };
          for (const executable of [whole, trimmed])
            expect(await run([executable], folder, env)).toEqual({
              stdout: "",
              stderr: `error: ${option} ${runsOnlyCompiledCode}\n`,
              exitCode: 1,
            });
        }
      });

      test("a feature is kept when the program uses it and removed when it doesn't", async () => {
        using dir = tempDir("compile-trim-runtime-by-use", programs);
        const folder = String(dir);
        const without = withoutFeatures([featureOf("HTMLRewriter")]);
        const size = (name: string) => sizeOf(join(folder, name));
        const { whole, trimmed } = await built("names-html-rewriter", folder);
        expect(await run([whole], folder)).toEqual({ stdout: '<p class="seen">hello</p>\n', stderr: "", exitCode: 0 });
        expect(await run([trimmed], folder)).toEqual({
          stdout: '<p class="seen">hello</p>\n',
          stderr: "",
          exitCode: 0,
        });

        const trim = [bunExe(), "build", "--compile", "--aot", "--trim"];
        expect(
          await run([...trim, ...without, "names-html-rewriter.ts", "--outfile", "taken-away"], folder),
        ).toMatchObject({ exitCode: 0 });
        expect(size("names-html-rewriter-trimmed") - size("taken-away")).toBeGreaterThanOrEqual(65536);
        const asked = await run([join(folder, "taken-away")], folder);
        expect({
          stderr: asked.stderr,
          saysSo: saysFeatureWasRemoved(asked.stderr, featureOf("HTMLRewriter")),
        }).toEqual({ stderr: asked.stderr, saysSo: true });
        expect(asked.stdout).toBe("");
        expect([70, 1]).toContain(asked.exitCode);

        expect(await run([...trim, "hello.ts", "--outfile", "hello-by-use"], folder)).toMatchObject({ exitCode: 0 });
        expect(await run([...trim, ...without, "hello.ts", "--outfile", "hello-taken-away"], folder)).toMatchObject({
          exitCode: 0,
        });
        expect(size("hello-by-use")).toBe(size("hello-taken-away"));
        expect(await run([join(folder, "hello-by-use")], folder)).toEqual({
          stdout: "hello world\n",
          stderr: "",
          exitCode: 0,
        });
      });

      test("the error for a removed feature says how to keep it: by compile.trim.allow if the feature has a public name, by using it otherwise", async () => {
        using dir = tempDir("compile-trim-runtime-removed-feature", programs);
        const folder = String(dir);
        const build = [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--trim",
          ...withoutFeatures([featureOf("Bun.color"), "URICoding"]),
          "catches-removed-features.ts",
          "--outfile",
          "catches",
        ];
        expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
        expect(await run([join(folder, "catches")], folder)).toEqual({
          stdout:
            'ERR_FEATURE_REMOVED: Bun.color was removed by --trim because your code never uses it. To keep it, add "color" to compile.trim.allow in Bun.build().\n' +
            "ERR_FEATURE_REMOVED: encodeURI was removed by --trim because your code never uses it. To keep it, use it somewhere in your code.\n",
          stderr: "",
          exitCode: 0,
        });
      });

      test("loading a removed built-in module fails like a package that is not installed", async () => {
        using dir = tempDir("compile-trim-runtime-removed-module", programs);
        const folder = String(dir);
        const build = [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--trim",
          ...withoutFeatures([featureOf("bun:sqlite")]),
          "loads-a-removed-module.ts",
          "--outfile",
          "loads",
        ];
        expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
        expect(await run([join(folder, "loads")], folder)).toEqual({
          stdout: "MODULE_NOT_FOUND\nERR_MODULE_NOT_FOUND\n",
          stderr: "",
          exitCode: 0,
        });
      });

      test("a program that calls eval() can still run code from strings", async () => {
        using dir = tempDir("compile-trim-runtime-open", programs);
        const folder = String(dir);
        const { whole, trimmed } = await built("names-eval", folder);
        expect(await run([whole], folder)).toEqual({ stdout: "2 2\n[]\n", stderr: "", exitCode: 0 });
        expect(await run([trimmed], folder)).toEqual({ stdout: "2 2\n[]\n", stderr: "", exitCode: 0 });
      });

      test("a built-in that the program calls by name stays, also where any global may have been replaced and evaluated text holds the built-in long before the compiler comes to the call", async () => {
        using dir = tempDir("compile-trim-runtime-late-call", programs);
        const folder = String(dir);
        const { whole, trimmed } = await built("calls-a-built-in-that-evaluated-text-holds", folder);
        expect(await run([whole], folder)).toEqual({ stdout: "function\n&lt;late&gt;\n", stderr: "", exitCode: 0 });
        expect(await run([trimmed], folder)).toEqual({ stdout: "function\n&lt;late&gt;\n", stderr: "", exitCode: 0 });
      });

      test("so does a built-in that the program reads by name into a variable and calls from another function", async () => {
        using dir = tempDir("compile-trim-runtime-late-call-through-variable", programs);
        const folder = String(dir);
        const { whole, trimmed } = await built("calls-a-built-in-through-a-variable", folder);
        expect(await run([whole], folder)).toEqual({ stdout: "function\n&lt;late&gt;4\n", stderr: "", exitCode: 0 });
        expect(await run([trimmed], folder)).toEqual({ stdout: "function\n&lt;late&gt;4\n", stderr: "", exitCode: 0 });
      });

      async function buildDisallowingCodeGeneration(program: string, folder: string) {
        const options = JSON.stringify({ aot: true, disallowCodeGenerationFromStrings: true });
        expect(
          await run([bunExe(), "api.ts", join(folder, `${program}.ts`), join(folder, program), options], folder),
        ).toMatchObject({ stdout: "true\n", exitCode: 0 });
        return join(folder, program);
      }

      test("with disallowCodeGenerationFromStrings, a dynamic require keeps no built-in module", async () => {
        using dir = tempDir("compile-trim-runtime-dynamic-require", programs);
        const folder = String(dir);
        const executable = await buildDisallowingCodeGeneration("function-constructor-and-dynamic-require", folder);
        expect(removedFeaturesOf(executable)).toContain(featureOf("bun:sqlite"));
      });

      test("a dynamic require of a built-in module that the program never imports fails like a package that is not installed", async () => {
        using dir = tempDir("compile-trim-runtime-dynamic-require", programs);
        const folder = String(dir);
        const executable = await buildDisallowingCodeGeneration("function-constructor-and-dynamic-require", folder);
        const asked = await run([executable, "bun:sqlite"], folder);
        expect(asked.stderr).toContain('code: "MODULE_NOT_FOUND"');
        expect(asked).toMatchObject({ stdout: "", exitCode: 1 });
      });

      test("with disallowCodeGenerationFromStrings, calls to Function and eval keep no unused feature", async () => {
        using dir = tempDir("compile-trim-runtime-direct-eval", programs);
        const folder = String(dir);
        const executable = await buildDisallowingCodeGeneration("function-constructor-and-direct-eval", folder);
        expect(removedFeaturesOf(executable)).toContain(featureOf("bun:sqlite"));
        expect(await run([executable], folder)).toEqual({ stdout: "EvalError\nEvalError\n", stderr: "", exitCode: 0 });
      });
    },
  );

  test("Bun.build({ check }) and ({ compile: { aot } }) called by a trimmed executable throw", async () => {
    using dir = tempDir("compile-trim-runtime-checker", programs);
    const folder = String(dir);
    const build = [bunExe(), "build", "--compile", "--trim", "asks-for-the-checker.ts", "--outfile", "asks"];
    expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
    expect(await run([join(folder, "asks")], folder, { ...bunEnv, FOLDER: folder })).toEqual({
      stdout:
        "check: this executable doesn't include the type checker\n" +
        "compile.aot isn't available in this build of Bun\n" +
        "true\n",
      stderr: "",
      exitCode: 0,
    });
  });

  const canSeeMemory =
    isMacOS &&
    Bun.spawnSync({ cmd: ["vmmap", String(process.pid)], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

  test.skipIf(!canSeeMemory)(
    "macOS: no piece of the constants that hold addresses can be written while the program runs",
    async () => {
      using dir = tempDir("compile-trim-runtime-constants", {
        "waits.ts": `console.log("ready"); for await (const _ of Bun.stdin.stream()) break;`,
      });
      const folder = String(dir);
      expect(
        await run([bunExe(), "build", "--compile", "--trim", "waits.ts", "--outfile", "waits"], folder),
      ).toMatchObject({ exitCode: 0 });
      await using child = Bun.spawn({
        cmd: [join(folder, "waits")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      expect(new TextDecoder().decode((await child.stdout.getReader().read()).value)).toBe("ready\n");
      const map = await run(["vmmap", String(child.pid)], folder);
      const pieces = map.stdout.split("\n").filter(line => line.startsWith("__DATA_CONST") && line.endsWith("/waits"));
      expect(pieces.length).toBeGreaterThan(0);
      expect(pieces.filter(line => !line.includes("] r--/"))).toEqual([]);
      child.stdin.end();
    },
  );

  test("compile: { trim: true }", async () => {
    using dir = tempDir("compile-trim-runtime-api", programs);
    const folder = String(dir);
    expect(await run([bunExe(), "api.ts", join(folder, "hello.ts"), join(folder, "hello")], folder)).toMatchObject({
      stdout: "true\n",
      exitCode: 0,
    });
    expect(await run([join(folder, "hello")], folder)).toMatchObject({ stdout: "hello world\n", exitCode: 0 });
    expect(statSync(process.execPath).size - sizeOf(join(folder, "hello"))).toBeGreaterThan(30_000_000);
  });

  describe("compile.trim", () => {
    const started = (folder: string, outfile: string) => run([join(folder, outfile, "program")], folder);

    test("an untrimmed build after a trimmed one is the same as before it", async () => {
      using dir = tempDir("compile-trim-runtime-api", programs);
      const folder = String(dir);
      const untrimmed = await buildWithApi(folder, "hello.ts", "untrimmed", {});
      await buildWithApi(folder, "hello.ts", "trimmed", { trim: true });
      expect(await buildWithApi(folder, "hello.ts", "again", {})).toEqual(untrimmed);
    });

    test.each([[true], [{ allow: ["color"] }], [{ log: false }]] as [true | Bun.TrimOptions][])(
      "%j: the build logs nothing about it unless log is true",
      async trim => {
        using dir = tempDir("compile-trim-runtime-api", programs);
        const folder = String(dir);
        const silent = await Bun.build({
          entrypoints: [join(folder, "hello.ts")],
          compile: { outfile: join(folder, "silent", "program"), trim },
        });
        expect(silent.logs.map(log => log.message)).toEqual([]);
        const logging = await buildWithApi(folder, "hello.ts", "logging", {
          trim: { ...(trim === true ? {} : trim), log: true },
        });
        expect(logging.logged.length).toBeGreaterThanOrEqual(1);
        expect(
          new Bun.CryptoHasher("sha256").update(readFileSync(fileOf(join(folder, "silent", "program")))).digest("hex"),
        ).toBe(logging.contents);
      },
    );

    test("log: true lists how much was removed and the names of the removed features", async () => {
      using dir = tempDir("compile-trim-runtime-api", programs);
      const folder = String(dir);
      const untrimmed = await buildWithApi(folder, "hello.ts", "untrimmed", {});
      const trimmed = await buildWithApi(folder, "hello.ts", "trimmed", { trim: { log: true } });
      expect(trimmed.logged[0]).toMatch(
        /^compile\.trim: removed \d+\.\d MB of the runtime, \d+\.\d MB of it from the file: /,
      );
      expect(trimmed.removed.filter(name => !trimFeatures.some(each => each.name === name))).toEqual([]);
      expect(trimmed.size).toBeLessThan(untrimmed.size - 10_000_000);
      expect(await started(folder, "trimmed")).toEqual(await started(folder, "untrimmed"));
    });

    test("an unknown name in allow fails the build with the closest name, or with every valid name", async () => {
      const validNames = trimFeatures.map(each => `"${each.name}"`).join(", ");
      expect(await failureOf({ trim: { allow: ["htmlrewriter" as never] } })).toContain(
        `compile.trim: unknown name "htmlrewriter". Did you mean "html-rewriter"?`,
      );
      expect(await failureOf({ trim: { allow: ["no-such-feature" as never] } })).toContain(
        `compile.trim: unknown name "no-such-feature". Valid names are ${validNames}`,
      );
      expect(await failureOf({ trim: { allow: ["nothing", "color", "nobody", "nothing"] as never } })).toContain(
        `compile.trim: unknown names "nothing" and "nobody". Valid names are ${validNames}`,
      );
    });

    describe.skipIf(!!unsupported)("with aot", () => {
      test("allow keeps a feature that the code never uses, and what that feature needs", async () => {
        using dir = tempDirForAotBuilds("compile-trim-runtime-api", programs);
        const folder = String(dir);
        const byUse = await buildWithApi(folder, "hello.ts", "by-use", { aot: true, trim: { log: true } });
        const removedByUse = namesCoveredBy(byUse.removed);
        const [requirement] = followedRequirements.filter(
          ({ name, requiredName }) => removedByUse.includes(name) && removedByUse.includes(requiredName),
        );
        expect(requirement).toBeDefined();
        const { name, requiredName } = requirement!;
        const allowed = await buildWithApi(folder, "hello.ts", "allowed", {
          aot: true,
          trim: { allow: [name as Bun.Build.TrimFeature], log: true },
        });
        expect(namesCoveredBy(allowed.removed)).not.toContain(name);
        expect(namesCoveredBy(allowed.removed)).not.toContain(requiredName);
        expect(allowed.removed).toContain("html-rewriter");
        expect(allowed.size).toBeGreaterThan(byUse.size);
        expect(await started(folder, "allowed")).toEqual(await started(folder, "by-use"));
      });
    });
  });
});
