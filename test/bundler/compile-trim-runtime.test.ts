import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/run-programs";

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
          const saved =
            statSync(join(folder, `${program}-whole`)).size - statSync(join(folder, `${program}-trimmed`)).size;
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

  test("compile: { trimRuntime: true }", async () => {
    using dir = tempDir("compile-trim-runtime-api", programs);
    const folder = String(dir);
    expect(await run([bunExe(), "api.ts", join(folder, "hello.ts"), join(folder, "hello")], folder)).toMatchObject({
      stdout: "true\n",
      exitCode: 0,
    });
    expect(await run([join(folder, "hello")], folder)).toMatchObject({ stdout: "hello world\n", exitCode: 0 });
    expect(statSync(process.execPath).size - statSync(join(folder, "hello")).size).toBeGreaterThan(30_000_000);
  });
});
