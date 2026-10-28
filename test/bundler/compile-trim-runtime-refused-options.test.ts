import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import { canTrim, featureOf, model } from "./compile-trim-features";

const programs = {
  "hello.ts": `console.log("hello world");`,
  "names-eval.ts": `console.log((0, eval)("1 + 1"));`,
  "calls-fetch.ts": `console.log(typeof fetch);\nif (process.argv.length > 9) await fetch(process.argv[9]);`,
  "tells-its-options.ts": `console.log(JSON.stringify(process.execArgv));`,
};

const wasRemoved = "can't be used with this executable because --trim removed the feature it needs";
const hasNoCommandLine =
  "can't be used with this executable because it doesn't include the Bun command line. Run bun instead";
const needNothing = [
  ["--stack-trace-limit", "--stack-trace-limit=3"],
  ["--stack-trace-limit", "--stack-trace-limit 3"],
  ["--stack-trace-limited", "--stack-trace-limited"],
  ["--trace-env-native-stack", "--trace-env-native-stack"],
];
const needEveryRuntimeFeature = [
  ["--trace-env", "--trace-env"],
  ["--trace-env-js-stack", "--trace-env-js-stack"],
  ["--trace-exit", "--trace-exit"],
  ["--trace-exits", "--trace-exits=1"],
  ["--trace-events-enabled", "--trace-events-enabled"],
  ["--trace-event-categories", "--trace-event-categories=node"],
  ["--trace-event-categories", "--trace-event-categories node"],
  ["--trace-event-file-pattern", "--trace-event-file-pattern=trace.log"],
  ["--sql-preconnect", "--sql-preconnect"],
];
const needTheCli = [
  ["--help", "--help"],
  ["--help", "-h"],
  ["--help", "-bh"],
  ["--aot", "--aot"],
  ["--aot-log-type-mismatches", "--aot-log-type-mismatches"],
  ["--help", "--smol --title=-h --help"],
];
const needAFeature = [...needEveryRuntimeFeature, ...needTheCli];
const packageChosenAtRandom = /^( +(?:x|add|remove|update|info|why|create) +)\S+ +/gm;

function removedFeaturesOf(executable: string) {
  const removed = readRemovedFeatures(executable + (isWindows ? ".exe" : ""));
  if (removed === undefined) throw new Error(`${executable} has no list of removed features`);
  return model.features.filter(feature => removed.includes(feature.index)).map(feature => feature.name);
}

describe.skipIf(!canTrim)("--trim keeps what an option in --compile-exec-argv needs", () => {
  async function behavesLikeUntrimmed(build: string[], folder: string) {
    expect(await run([...build, "hello.ts", "--outfile", join("untrimmed", "hello")], folder)).toMatchObject({
      exitCode: 0,
    });
    expect(await run([...build, "--trim", "hello.ts", "--outfile", join("trimmed", "hello")], folder)).toMatchObject({
      exitCode: 0,
    });
    const said = async (executable: string) => {
      const { stdout, ...rest } = await run([executable], folder);
      return { stdout: stdout.replace(packageChosenAtRandom, "$1<package> "), ...rest };
    };
    expect(await said(join(folder, "trimmed", "hello"))).toEqual(await said(join(folder, "untrimmed", "hello")));
  }

  test.each([...needNothing, ...needAFeature])(
    "%s in %j: the executable behaves like the untrimmed one",
    async (_, options) => {
      using dir = tempDir("compile-trim-runtime-exec-argv", { "hello.ts": programs["hello.ts"] });
      await behavesLikeUntrimmed([bunExe(), "build", "--compile", "--compile-exec-argv=" + options], String(dir));
    },
  );

  test.skipIf(!!unsupported)("bun compile --trim keeps it too", async () => {
    using dir = tempDir("compile-trim-runtime-exec-argv", { "hello.ts": programs["hello.ts"] });
    await behavesLikeUntrimmed([bunExe(), "compile", "--compile-exec-argv=--sql-preconnect"], String(dir));
  });

  test("Bun.build accepts the same options", async () => {
    using dir = tempDir("compile-trim-runtime-exec-argv", {
      "hello.ts": programs["hello.ts"],
      "api.ts": `
        for (const execArgv of ${JSON.stringify(needAFeature.map(([, options]) => options.split(" ")))}) {
          try {
            await Bun.build({ entrypoints: ["hello.ts"], compile: { outfile: "hello", trim: true, execArgv } });
            console.log("built");
          } catch (error) {
            console.log((error as Error).name + ": " + (error as Error).message);
          }
        }
      `,
    });
    expect(await run([bunExe(), "api.ts"], String(dir))).toEqual({
      stdout: "built\n".repeat(needAFeature.length),
      stderr: "",
      exitCode: 0,
    });
  });

  test("without --trim the same options work", async () => {
    using dir = tempDir("compile-trim-runtime-exec-argv", programs);
    const folder = String(dir);
    for (const options of [
      "--stack-trace-limit=3",
      "--trace-exit",
      "--trace-event-categories=node",
      "--aot-log-type-mismatches",
    ]) {
      expect(
        await run(
          [
            bunExe(),
            "build",
            "--compile",
            "--compile-exec-argv=" + options,
            "tells-its-options.ts",
            "--outfile",
            "untrimmed",
          ],
          folder,
        ),
      ).toMatchObject({ exitCode: 0 });
      expect(await run([join(folder, "untrimmed")], folder)).toMatchObject({
        stdout: JSON.stringify([options]) + "\n",
        exitCode: 0,
      });
    }
  });
});

describe.skipIf(!canTrim || !!unsupported)(
  "--trim keeps the client that a preconnect option in --compile-exec-argv needs, even if the program never uses it",
  () => {
    test.each([
      ["--fetch-preconnect=http://127.0.0.1:9", "fetch"],
      ["--smol --redis-preconnect", "Bun.RedisClient"],
    ])("%s", async (options, builtin) => {
      using dir = tempDir("compile-trim-runtime-exec-argv", { "hello.ts": programs["hello.ts"] });
      const folder = String(dir);
      const build = [bunExe(), "build", "--compile", "--aot", "--trim", "hello.ts", "--outfile"];
      expect(await run([...build, "without-the-option"], folder)).toMatchObject({ exitCode: 0 });
      expect(await run([...build, "with-the-option", "--compile-exec-argv=" + options], folder)).toMatchObject({
        exitCode: 0,
      });
      expect(removedFeaturesOf(join(folder, "without-the-option"))).toContain(featureOf(builtin));
      expect(removedFeaturesOf(join(folder, "with-the-option"))).not.toContain(featureOf(builtin));
    });

    test("an executable built with --fetch-preconnect in --compile-exec-argv runs", async () => {
      using dir = tempDir("compile-trim-runtime-exec-argv", { "hello.ts": programs["hello.ts"] });
      const folder = String(dir);
      for (const flags of [[], ["--aot"]]) {
        const build = [
          bunExe(),
          "build",
          "--compile",
          ...flags,
          "--trim",
          "--compile-exec-argv=--fetch-preconnect=http://127.0.0.1:9",
          "hello.ts",
          "--outfile",
          "hello",
        ];
        expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
        expect(await run([join(folder, "hello")], folder)).toEqual({
          stdout: "hello world\n",
          stderr: "",
          exitCode: 0,
        });
      }
    });
  },
);

describe.skipIf(!canTrim)("an executable built with --trim", () => {
  for (const flags of [[], ["--aot"]]) {
    const how = ["--compile", ...flags].join(" ");
    const ignored = flags.length > 0 ? needEveryRuntimeFeature.filter(([option]) => option.startsWith("--trace-")) : [];
    const rejected = flags.length > 0 ? needAFeature.filter(row => !ignored.includes(row)) : needTheCli;

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: rejects options in BUN_OPTIONS that need a removed feature`,
      async () => {
        using dir = tempDir("compile-trim-runtime-options", programs);
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", ...flags, "--trim"];
        for (const program of ["hello", "names-eval"]) {
          expect(await run([...build, `${program}.ts`, "--outfile", program], folder)).toMatchObject({ exitCode: 0 });
          for (const [option, options] of rejected) {
            const answer = await run([join(folder, program)], folder, { ...bunEnv, BUN_OPTIONS: options });
            const reason = needTheCli.some(([, theirs]) => theirs === options) ? hasNoCommandLine : wasRemoved;
            expect({ options, ...answer }).toEqual({
              options,
              stdout: "",
              stderr: `error: ${option} ${reason}\n`,
              exitCode: 1,
            });
          }
        }
        const hello = { stdout: "hello world\n", stderr: "", exitCode: 0 };
        for (const [option, options] of ignored) {
          const stderr = `warn: ${option} is ignored by this executable because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code\n`;
          expect({
            options,
            ...(await run([join(folder, "hello")], folder, { ...bunEnv, BUN_OPTIONS: options })),
          }).toEqual({ options, ...hello, stderr });
        }
        for (const [, options] of needNothing) {
          expect({
            options,
            ...(await run([join(folder, "hello")], folder, { ...bunEnv, BUN_OPTIONS: options })),
          }).toEqual({ options, ...hello });
        }
        for (const options of [
          "--title=--help",
          "--title --help",
          "--title -h",
          "--trace-warnings",
          "--trace-deprecation",
          "--sql-preconnecting",
          "positional --help",
        ]) {
          expect({
            options,
            ...(await run([join(folder, "hello")], folder, { ...bunEnv, BUN_OPTIONS: options })),
          }).toEqual({ options, ...hello });
        }
        expect(
          await run([join(folder, "hello"), ...needAFeature.flatMap(([, options]) => options.split(" "))], folder),
        ).toEqual(hello);
      },
    );

    test.skipIf(flags.length > 0)(
      `${how}: keeps every runtime feature, so options in BUN_OPTIONS that need them work like in the untrimmed executable`,
      async () => {
        using dir = tempDir("compile-trim-runtime-options", programs);
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", "hello.ts", "--outfile"];
        expect(await run([...build, join("untrimmed", "hello")], folder)).toMatchObject({ exitCode: 0 });
        expect(await run([...build, join("trimmed", "hello"), "--trim"], folder)).toMatchObject({ exitCode: 0 });
        for (const [, options] of needEveryRuntimeFeature) {
          const env = { ...bunEnv, BUN_OPTIONS: options };
          expect({ options, ...(await run([join(folder, "trimmed", "hello")], folder, env)) }).toEqual({
            options,
            ...(await run([join(folder, "untrimmed", "hello")], folder, env)),
          });
        }
      },
    );

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: accepts --fetch-preconnect if fetch was kept, and rejects it if fetch was removed`,
      async () => {
        using dir = tempDir("compile-trim-runtime-options", programs);
        const folder = String(dir);
        const env = { ...bunEnv, BUN_OPTIONS: "--fetch-preconnect=http://127.0.0.1:9" };
        const rejection = { stdout: "", stderr: `error: --fetch-preconnect ${wasRemoved}\n`, exitCode: 1 };
        for (const [program, prints] of [
          ["hello", "hello world\n"],
          ["names-eval", "2\n"],
          ["calls-fetch", "function\n"],
        ]) {
          const build = [bunExe(), "build", "--compile", ...flags, "--trim", `${program}.ts`, "--outfile", program];
          expect(await run(build, folder)).toMatchObject({ exitCode: 0 });
          const removesFetch = program !== "calls-fetch" && flags.length > 0;
          expect({ program, ...(await run([join(folder, program)], folder, env)) }).toEqual({
            program,
            ...(removesFetch ? rejection : { stdout: prints, stderr: "", exitCode: 0 }),
          });
        }
      },
    );

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: reports an unknown option in BUN_OPTIONS without printing the CLI help`,
      async () => {
        using dir = tempDir("compile-trim-runtime-options", programs);
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", ...flags, "hello.ts", "--outfile"];
        expect(await run([...build, "untrimmed"], folder)).toMatchObject({ exitCode: 0 });
        expect(await run([...build, "trimmed", "--trim"], folder)).toMatchObject({ exitCode: 0 });
        for (const options of ["-Z", "--title", "--smol=1", "--help=1", "-bZ"]) {
          const env = { ...bunEnv, BUN_OPTIONS: options };
          const untrimmed = await run([join(folder, "untrimmed")], folder, env);
          if (flags.length > 0) expect(untrimmed.stdout).toBe("");
          else expect(untrimmed.stdout).toContain("Usage:");
          expect(untrimmed.stderr).toStartWith("error: ");
          expect({ options, ...(await run([join(folder, "trimmed")], folder, env)) }).toEqual({
            options,
            ...untrimmed,
            stdout: "",
          });
          expect(untrimmed.exitCode).toBe(1);
        }
      },
    );
  }
});
