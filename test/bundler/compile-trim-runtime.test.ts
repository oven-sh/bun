import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/run-programs";

const sizeOf = (executable: string) => statSync(executable + (isWindows ? ".exe" : "")).size;

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using child = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

const programs = {
  "hello.ts": `console.log("hello world");`,
  "helper.ts": `export function double(x: number): number { return x * 2; }`,
  "entry.ts": `import { double } from "./helper"; console.log(double(21));`,
  "on-disk.ts": `export const fromDisk: string = [1, 2, 3].map((x: number) => x * 2).join(",");`,
  "near-the-doors.ts": `
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
    for (const options of [{ check: true }, { dts: true }, { compile: { aot: true } }]) {
      try {
        await Bun.build({ entrypoints, ...options });
      } catch (error) {
        console.log((error as Error).message);
      }
    }
    console.log((await Bun.build({ entrypoints, target: "bun" })).success);
  `,
  "names-no-way-to-make-code.ts": `
    function made(): string {
      try {
        return "made " + (function () {}).constructor("return 1 + 1")();
      } catch (error) {
        return (error as Error).name + ": " + (error as Error).message;
      }
    }
    console.log(made());
    console.log(JSON.stringify(process.execArgv));
  `,
  "names-eval.ts": `
    console.log((0, eval)("1 + 1"), (function () {}).constructor("return 1 + 1")());
    console.log(JSON.stringify(process.execArgv));
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
  "api.ts": `
    const built = await Bun.build({
      entrypoints: [process.argv[2]],
      compile: { outfile: process.argv[3], trimRuntime: true },
    });
    console.log(built.success);
  `,
};

using probe = tempDir("compile-trim-runtime-probe", { "hello.ts": programs["hello.ts"] });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stdout: "pipe",
  stderr: "pipe",
});
const hasIslands = !probed.stderr.toString().includes("nothing can be left out of this Bun");

test.skipIf(hasIslands)("a Bun that was linked without islands says that nothing can be left out", () => {
  expect(probed.stderr.toString()).toContain("--compile-trim-runtime: nothing can be left out of this Bun: ");
  expect(probed.exitCode).not.toBe(0);
});

test("--compile-trim-runtime requires --compile", async () => {
  using dir = tempDir("compile-trim-runtime-flag", { "hello.ts": programs["hello.ts"] });
  const built = await run([bunExe(), "build", "--compile-trim-runtime", "hello.ts"], String(dir));
  expect(built.stderr).toContain("--compile-trim-runtime requires --compile");
  expect(built.exitCode).not.toBe(0);
});

describe.skipIf(!hasIslands)("--compile-trim-runtime", () => {
  for (const flags of [[], ["--aot"]]) {
    const how = ["--compile", ...flags].join(" ");

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: the executable is much smaller and prints the same`,
      async () => {
        using dir = tempDir("compile-trim-runtime", programs);
        const folder = String(dir);
        const env = { ...bunEnv, FOLDER: folder };
        for (const program of ["hello", "near-the-doors", "everything-by-name"]) {
          const build = [bunExe(), "build", "--compile", ...flags, `${program}.ts`, "--outfile"];
          expect(await run([...build, `${program}-whole`], folder)).toMatchObject({ exitCode: 0 });
          expect(await run([...build, `${program}-trimmed`, "--compile-trim-runtime"], folder)).toMatchObject({
            exitCode: 0,
          });
          const whole = await run([join(folder, `${program}-whole`)], folder, env);
          expect(await run([join(folder, `${program}-trimmed`)], folder, env)).toEqual(whole);
          expect(whole.exitCode).toBe(0);
          const saved = sizeOf(join(folder, `${program}-whole`)) - sizeOf(join(folder, `${program}-trimmed`));
          expect(saved).toBeGreaterThan(30_000_000);
        }
      },
    );

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: a part that was left out says so when it is asked for`,
      async () => {
        using dir = tempDir("compile-trim-runtime-door", programs);
        const folder = String(dir);
        const build = [
          bunExe(),
          "build",
          "--compile",
          ...flags,
          "--compile-trim-runtime",
          "hello.ts",
          "--outfile",
          "hello",
        ];
        expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
        const asked = await run([join(folder, "hello"), "install"], folder, { ...bunEnv, BUN_BE_BUN: "1" });
        expect(asked.stderr).toStartWith(
          "error: BUN_BE_BUN is set, but this executable was built with --compile-trim-runtime, without the Bun command line",
        );
        expect(asked).toMatchObject({ stdout: "", exitCode: 70 });
        const version = await run([join(folder, "hello"), "--version"], folder, { ...bunEnv, BUN_BE_BUN: "1" });
        expect(version).toEqual({ stdout: Bun.version + "\n", stderr: "", exitCode: 0 });
        const help = await run([join(folder, "hello")], folder, { ...bunEnv, BUN_OPTIONS: "--help" });
        expect(help.stderr).toContain("BUN_OPTIONS is set: an option in it may be what asked.");
        expect(help).toMatchObject({ stdout: "", exitCode: 70 });
      },
    );
  }

  describe.skipIf(!!unsupported)("--compile --aot: a program in which nothing is seen to make or load code", () => {
    const refusal =
      "EvalError: Code generation from strings disallowed for this context: this executable was built with --compile-trim-runtime, " +
      "and nothing in the program was seen to turn a string into code or to load code at run time";

    async function built(program: string, folder: string) {
      const build = [bunExe(), "build", "--compile", "--aot", `${program}.ts`, "--outfile"];
      expect(await run([...build, `${program}-whole`], folder)).toMatchObject({ exitCode: 0 });
      expect(await run([...build, `${program}-trimmed`, "--compile-trim-runtime"], folder)).toMatchObject({
        exitCode: 0,
      });
      return { whole: join(folder, `${program}-whole`), trimmed: join(folder, `${program}-trimmed`) };
    }

    test("runs only its own code, and says why", async () => {
      using dir = tempDir("compile-trim-runtime-closed", programs);
      const folder = String(dir);
      const { whole, trimmed } = await built("names-no-way-to-make-code", folder);
      expect(await run([whole], folder)).toEqual({ stdout: "made 2\n[]\n", stderr: "", exitCode: 0 });
      expect(await run([trimmed], folder)).toEqual({ stdout: refusal + "\n[]\n", stderr: "", exitCode: 0 });
    });

    test("loads nothing that BUN_OPTIONS names, and starts no debugger", async () => {
      using dir = tempDir("compile-trim-runtime-closed-options", programs);
      const folder = String(dir);
      const { whole, trimmed } = await built("names-no-way-to-make-code", folder);
      const preloads = { ...bunEnv, BUN_OPTIONS: "--preload ./preloaded.js" };
      expect((await run([whole], folder, preloads)).stdout).toStartWith("preloaded\nmade 2\n");
      const refused = await run([trimmed], folder, preloads);
      expect(refused.stderr).toContain(
        "preloaded.js': it was not compiled into this executable, which was built with --compile-trim-runtime and loads nothing else",
      );
      expect(refused).toMatchObject({ stdout: "", exitCode: 1 });
      const inspected = await run([trimmed], folder, { ...bunEnv, BUN_INSPECT: "ws://127.0.0.1:0/trimmed" });
      expect(inspected.stderr).toContain(
        "BUN_INSPECT cannot be used with an executable built with --compile-trim-runtime: the inspector evaluates code from strings",
      );
      expect(inspected).toMatchObject({ stdout: "", exitCode: 1 });
      const inAnEditor = await run([trimmed], folder, { ...bunEnv, BUN_INSPECT_CONNECT_TO: "unix:///nowhere.sock" });
      expect(inAnEditor).toEqual({ stdout: refusal + "\n[]\n", stderr: "", exitCode: 0 });
    });

    test("a part of Bun stays when the program names it, and goes when it does not", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", programs);
      const folder = String(dir);
      const without = { ...bunEnv, BUN_TRIM_RUNTIME_WITHOUT: "htmlrewriter" };
      const size = (name: string) => sizeOf(join(folder, name));
      const { whole, trimmed } = await built("names-html-rewriter", folder);
      expect(await run([whole], folder)).toEqual({ stdout: '<p class="seen">hello</p>\n', stderr: "", exitCode: 0 });
      expect(await run([trimmed], folder)).toEqual({ stdout: '<p class="seen">hello</p>\n', stderr: "", exitCode: 0 });

      const trim = [bunExe(), "build", "--compile", "--aot", "--compile-trim-runtime"];
      expect(await run([...trim, "names-html-rewriter.ts", "--outfile", "taken-away"], folder, without)).toMatchObject({
        exitCode: 0,
      });
      expect(size("names-html-rewriter-trimmed") - size("taken-away")).toBeGreaterThanOrEqual(65536);
      const asked = await run([join(folder, "taken-away")], folder);
      expect(asked.stderr).toStartWith(
        "error: this executable was built with --compile-trim-runtime, without HTMLRewriter, and something has just asked for it.",
      );
      expect(asked).toMatchObject({ stdout: "", exitCode: 70 });

      expect(await run([...trim, "hello.ts", "--outfile", "hello-by-use"], folder)).toMatchObject({ exitCode: 0 });
      expect(await run([...trim, "hello.ts", "--outfile", "hello-taken-away"], folder, without)).toMatchObject({
        exitCode: 0,
      });
      expect(size("hello-by-use")).toBe(size("hello-taken-away"));
      expect(await run([join(folder, "hello-by-use")], folder)).toEqual({
        stdout: "hello world\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("a program that names eval goes on making code", async () => {
      using dir = tempDir("compile-trim-runtime-open", programs);
      const folder = String(dir);
      const { whole, trimmed } = await built("names-eval", folder);
      expect(await run([whole], folder)).toEqual({ stdout: "2 2\n[]\n", stderr: "", exitCode: 0 });
      expect(await run([trimmed], folder)).toEqual({ stdout: "2 2\n[]\n", stderr: "", exitCode: 0 });
    });
  });

  test("Bun.build({ check }), ({ dts }) and ({ compile: { aot } }) called by a trimmed executable throw", async () => {
    using dir = tempDir("compile-trim-runtime-checker", programs);
    const folder = String(dir);
    const build = [
      bunExe(),
      "build",
      "--compile",
      "--compile-trim-runtime",
      "asks-for-the-checker.ts",
      "--outfile",
      "asks",
    ];
    expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
    expect(await run([join(folder, "asks")], folder, { ...bunEnv, FOLDER: folder })).toEqual({
      stdout:
        "check: this executable was built with --compile-trim-runtime, without the type checker\n" +
        "dts: this executable was built with --compile-trim-runtime, without the type checker\n" +
        "compile.aot: this build of Bun does not include the ahead-of-time compiler\n" +
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
        await run([bunExe(), "build", "--compile", "--compile-trim-runtime", "waits.ts", "--outfile", "waits"], folder),
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

  test("compile: { trimRuntime: true }", async () => {
    using dir = tempDir("compile-trim-runtime-api", programs);
    const folder = String(dir);
    expect(await run([bunExe(), "api.ts", join(folder, "hello.ts"), join(folder, "hello")], folder)).toMatchObject({
      stdout: "true\n",
      exitCode: 0,
    });
    expect(await run([join(folder, "hello")], folder)).toMatchObject({ stdout: "hello world\n", exitCode: 0 });
    expect(statSync(process.execPath).size - sizeOf(join(folder, "hello"))).toBeGreaterThan(30_000_000);
  });
});
