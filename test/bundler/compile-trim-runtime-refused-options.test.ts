import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/run-programs";

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using child = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

const programs = {
  "hello.ts": `console.log("hello world");`,
  "names-eval.ts": `console.log((0, eval)("1 + 1"));`,
  "names-fetch.ts": `console.log(typeof fetch);`,
  "tells-its-options.ts": `console.log(JSON.stringify(process.execArgv));`,
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

const isLeftOut = "cannot be used with an executable built with --compile-trim-runtime: the part of Bun that it needs is left out";
const leftOut = [
  ["--stack-trace-limit", "--stack-trace-limit=3"],
  ["--stack-trace-limit", "--stack-trace-limit 3"],
  ["--stack-trace-limited", "--stack-trace-limited"],
  ["--trace-env", "--trace-env"],
  ["--trace-env-js-stack", "--trace-env-js-stack"],
  ["--trace-env-native-stack", "--trace-env-native-stack"],
  ["--trace-exit", "--trace-exit"],
  ["--trace-exits", "--trace-exits=1"],
  ["--trace-events-enabled", "--trace-events-enabled"],
  ["--trace-event-categories", "--trace-event-categories=node"],
  ["--trace-event-categories", "--trace-event-categories node"],
  ["--trace-event-file-pattern", "--trace-event-file-pattern=trace.log"],
  ["--sql-preconnect", "--sql-preconnect"],
  ["--help", "--help"],
  ["-h", "-h"],
  ["-h", "-bh"],
  ["--aot", "--aot"],
  ["--aot-audit", "--aot-audit"],
  ["--help", "--smol --title=-h --help"],
  ["--trace-exit", "--smol --help --trace-exit"],
];

describe("--compile-trim-runtime with an option in --compile-exec-argv that needs a part of Bun that is always left out", () => {
  test.each(leftOut)("%s in %j: nothing is built", async (option, options) => {
    using dir = tempDir("compile-trim-runtime-exec-argv", { "hello.ts": programs["hello.ts"] });
    const folder = String(dir);
    const built = await run([bunExe(), "build", "--compile", "--compile-trim-runtime", "--compile-exec-argv=" + options, "hello.ts", "--outfile", "hello"], folder);
    expect(built).toEqual({ stdout: "", stderr: `error: ${option} ${isLeftOut}\n`, exitCode: 1 });
    expect(readdirSync(folder)).toEqual(["hello.ts"]);
  });

  test.skipIf(!!unsupported)("bun compile --trim says the same", async () => {
    using dir = tempDir("compile-trim-runtime-exec-argv", { "hello.ts": programs["hello.ts"] });
    const folder = String(dir);
    const built = await run([bunExe(), "compile", "--trim", "--compile-exec-argv=--trace-exit", "hello.ts", "--outfile", "hello"], folder);
    expect(built).toEqual({ stdout: "", stderr: `error: --trace-exit ${isLeftOut}\n`, exitCode: 1 });
    expect(readdirSync(folder)).toEqual(["hello.ts"]);
  });

  test("Bun.build throws the same words", async () => {
    using dir = tempDir("compile-trim-runtime-exec-argv", {
      "hello.ts": programs["hello.ts"],
      "api.ts": `
        for (const execArgv of ${JSON.stringify(leftOut.map(([, options]) => options.split(" ")))}) {
          try {
            await Bun.build({ entrypoints: ["hello.ts"], compile: { outfile: "hello", trimRuntime: true, execArgv } });
            console.log("built");
          } catch (error) {
            console.log((error as Error).name + ": " + (error as Error).message);
          }
        }
      `,
    });
    const folder = String(dir);
    const thrown = leftOut.map(([option]) => `TypeError: ${option} ${isLeftOut}\n`).join("");
    expect(await run([bunExe(), "api.ts"], folder)).toEqual({ stdout: thrown, stderr: "", exitCode: 0 });
    expect(readdirSync(folder).sort()).toEqual(["api.ts", "hello.ts"]);
  });

  test("without the flag the same options are built in and obeyed", async () => {
    using dir = tempDir("compile-trim-runtime-exec-argv", programs);
    const folder = String(dir);
    for (const options of ["--stack-trace-limit=3", "--trace-exit", "--trace-event-categories=node", "--aot-audit"]) {
      expect(await run([bunExe(), "build", "--compile", "--compile-exec-argv=" + options, "tells-its-options.ts", "--outfile", "whole"], folder)).toMatchObject({ exitCode: 0 });
      expect(await run([join(folder, "whole")], folder)).toMatchObject({ stdout: JSON.stringify([options]) + "\n", exitCode: 0 });
    }
  });
});

describe.skipIf(!hasIslands || !!unsupported)("--compile-trim-runtime with an option in --compile-exec-argv that connects for a part that the program does not use", () => {
  test.each(["--fetch-preconnect=http://127.0.0.1:9", "--smol --redis-preconnect"])("%s: nothing is built", async options => {
    using dir = tempDir("compile-trim-runtime-exec-argv", { "hello.ts": programs["hello.ts"] });
    const folder = String(dir);
    const option = /--\w+-preconnect/.exec(options)![0];
    const built = await run([bunExe(), "build", "--compile", "--aot", "--compile-trim-runtime", "--compile-exec-argv=" + options, "hello.ts", "--outfile", "hello"], folder);
    expect(built.stderr).toEndWith(`error: ${option} ${isLeftOut}\n`);
    expect(built.exitCode).toBe(1);
    expect(readdirSync(folder)).toEqual(["hello.ts"]);
  });

  test("Bun.build fails with the same words", async () => {
    using dir = tempDir("compile-trim-runtime-exec-argv", {
      "hello.ts": programs["hello.ts"],
      "api.ts": `
        try {
          await Bun.build({ entrypoints: ["hello.ts"], compile: { outfile: "hello", aot: true, trimRuntime: true, execArgv: ["--redis-preconnect"] } });
          console.log("built");
        } catch (error) {
          console.log(((error as AggregateError).errors ?? [error]).map(each => each.message).join("\\n"));
        }
      `,
    });
    const folder = String(dir);
    const failed = await run([bunExe(), "api.ts"], folder);
    expect(failed.stdout).toEndWith(`--redis-preconnect ${isLeftOut}\n`);
    expect(failed.exitCode).toBe(0);
    expect(readdirSync(folder).sort()).toEqual(["api.ts", "hello.ts"]);
  });

  test("without --aot everything stays, and they are built in", async () => {
    using dir = tempDir("compile-trim-runtime-exec-argv", { "hello.ts": programs["hello.ts"] });
    const folder = String(dir);
    const build = [bunExe(), "build", "--compile", "--compile-trim-runtime", "--compile-exec-argv=--fetch-preconnect=http://127.0.0.1:9", "hello.ts", "--outfile", "hello"];
    expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
    expect(await run([join(folder, "hello")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });
});

describe.skipIf(!hasIslands)("an executable built with --compile-trim-runtime", () => {
  for (const flags of [[], ["--aot"]]) {
    const how = ["--compile", ...flags].join(" ");

    test.skipIf(flags.length > 0 && !!unsupported)(`${how}: refuses such an option at start too, should it have been built in`, async () => {
      using dir = tempDir("compile-trim-runtime-options", programs);
      const folder = String(dir);
      for (const [option, options] of [
        ["--stack-trace-limit", "--stack-trace-limit=3"],
        ["--sql-preconnect", "--smol --sql-preconnect"],
        ["-h", "-bh"],
      ]) {
        const build = [bunExe(), "build", "--compile", ...flags, "--compile-exec-argv=" + options, "hello.ts", "--outfile", "hello"];
        expect(await run(build, folder, { ...bunEnv, BUN_FEATURE_FLAG_TRIM_RUNTIME: "1" })).toMatchObject({ exitCode: 0 });
        expect({ options, ...(await run([join(folder, "hello")], folder)) }).toEqual({ options, stdout: "", stderr: `error: ${option} ${isLeftOut}\n`, exitCode: 1 });
      }
    });

    test.skipIf(flags.length > 0 && !!unsupported)(`${how}: refuses the options in BUN_OPTIONS that need a part of Bun that is always left out`, async () => {
      using dir = tempDir("compile-trim-runtime-options", programs);
      const folder = String(dir);
      const build = [bunExe(), "build", "--compile", ...flags, "--compile-trim-runtime"];
      for (const program of ["hello", "names-eval"]) {
        expect(await run([...build, `${program}.ts`, "--outfile", program], folder)).toMatchObject({ exitCode: 0 });
        for (const [option, options] of leftOut) {
          const refused = await run([join(folder, program)], folder, { ...bunEnv, BUN_OPTIONS: options });
          expect({ options, ...refused }).toEqual({ options, stdout: "", stderr: `error: ${option} ${isLeftOut}\n`, exitCode: 1 });
        }
      }
      const hello = { stdout: "hello world\n", stderr: "", exitCode: 0 };
      for (const options of ["--title=--help", "--title --help", "--title -h", "--trace-warnings", "--trace-deprecation", "--sql-preconnecting", "positional --help"]) {
        expect({ options, ...(await run([join(folder, "hello")], folder, { ...bunEnv, BUN_OPTIONS: options })) }).toEqual({ options, ...hello });
      }
      expect(await run([join(folder, "hello"), ...leftOut.flatMap(([, options]) => options.split(" "))], folder)).toEqual(hello);
    });

    test.skipIf(flags.length > 0 && !!unsupported)(`${how}: obeys --fetch-preconnect where it keeps fetch, and refuses it where it does not`, async () => {
      using dir = tempDir("compile-trim-runtime-options", programs);
      const folder = String(dir);
      const env = { ...bunEnv, BUN_OPTIONS: "--fetch-preconnect=http://127.0.0.1:9" };
      const refusal = { stdout: "", stderr: `error: --fetch-preconnect ${isLeftOut}\n`, exitCode: 1 };
      for (const [program, prints] of [
        ["hello", "hello world\n"],
        ["names-eval", "2\n"],
        ["names-fetch", "function\n"],
      ]) {
        const build = [bunExe(), "build", "--compile", ...flags, "--compile-trim-runtime", `${program}.ts`, "--outfile", program];
        expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
        const leavesFetchOut = program === "hello" && flags.length > 0;
        expect({ program, ...(await run([join(folder, program)], folder, env)) }).toEqual({ program, ...(leavesFetchOut ? refusal : { stdout: prints, stderr: "", exitCode: 0 }) });
      }
    });

    test.skipIf(flags.length > 0 && !!unsupported)(`${how}: reports an option in BUN_OPTIONS that Bun does not accept, without the help of the Bun command line`, async () => {
      using dir = tempDir("compile-trim-runtime-options", programs);
      const folder = String(dir);
      const build = [bunExe(), "build", "--compile", ...flags, "hello.ts", "--outfile"];
      expect(await run([...build, "whole"], folder)).toMatchObject({ exitCode: 0 });
      expect(await run([...build, "trimmed", "--compile-trim-runtime"], folder)).toMatchObject({ exitCode: 0 });
      for (const options of ["-Z", "--title", "--smol=1", "--help=1", "-bZ"]) {
        const env = { ...bunEnv, BUN_OPTIONS: options };
        const whole = await run([join(folder, "whole")], folder, env);
        expect(whole.stdout).toContain("Usage:");
        expect(whole.stderr).toStartWith("error: ");
        expect({ options, ...(await run([join(folder, "trimmed")], folder, env)) }).toEqual({ options, ...whole, stdout: "" });
        expect(whole.exitCode).toBe(1);
      }
    });
  }
});
