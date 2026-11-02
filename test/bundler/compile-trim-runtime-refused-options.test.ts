// Options at startup and --trim. With --aot, every option in each of its forms: compile-trim-bun-options.test.ts.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { unsupported } from "../aot/harness/compiler";
import { run } from "../aot/harness/run";
import { sharedBuilds, type Build } from "../aot/harness/shared-builds";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import { canTrim, featureOf, model } from "./compile-trim-features";

const { folder, build, buildWith } = sharedBuilds("compile-trim-runtime-options", {
  "tsconfig.json": `{ "compilerOptions": { "types": ["bun"] } }`,
  "hello.ts": `
    console.log("hello world");
    if (process.argv[2] === "options") console.log(JSON.stringify(process.execArgv));
  `,
  "names-eval.ts": `console.log((0, eval)("1 + 1"));`,
  "calls-fetch.ts": `console.log(typeof fetch);\nif (process.argv.length > 9) await fetch(process.argv[9]);`,
  "api.ts": `
    for (const execArgv of JSON.parse(process.argv[2])) {
      try {
        await Bun.build({ entrypoints: ["hello.ts"], compile: { outfile: "built-by-api", trim: true, execArgv } });
        console.log("built");
      } catch (error) {
        console.log((error as Error).name + ": " + (error as Error).message);
      }
    }
  `,
});

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
const saysHello = { stdout: "hello world\n", stderr: "", exitCode: 0 };
const startedWith = async (executable: Build, options: string) => ({
  options,
  ...(await run([executable.executable], folder, { ...bunEnv, BUN_OPTIONS: options })),
});

function removedFeaturesOf(executable: Build) {
  const removed = readRemovedFeatures(executable.file);
  if (removed === undefined) throw new Error(`${executable.name} has no list of removed features`);
  return model.features.filter(feature => removed.includes(feature.index)).map(feature => feature.name);
}

(canTrim ? describe.concurrent : describe.skip)("--trim keeps what an option in --compile-exec-argv needs", () => {
  async function behavesLikeUntrimmed(command: string[], options: string) {
    const untrimmed = await buildWith(command, "hello.ts", "--compile-exec-argv=" + options);
    const trimmed = await buildWith(command, "hello.ts", "--compile-exec-argv=" + options, "--trim");
    const said = async ({ executable }: Build) => {
      const { stdout, ...rest } = await run([executable, "options"], folder);
      return { stdout: stdout.replace(packageChosenAtRandom, "$1<package> "), ...rest };
    };
    const saidUntrimmed = await said(untrimmed);
    expect(await said(trimmed)).toEqual(saidUntrimmed);
    return saidUntrimmed;
  }

  // One for each thing that an option can need. The build reads the words as an executable reads BUN_OPTIONS, where every form is tried.
  test.each([
    ["nothing", "--stack-trace-limit=3", true],
    ["every runtime feature", "--trace-exit", true],
    ["a client", "--sql-preconnect", false],
    ["the compiler", "--aot", false],
    ["the command line", "--smol --title=-h --help", false],
  ])("it needs %s: %j: the executable behaves like the untrimmed one", async (_, options, runsTheProgram) => {
    const said = await behavesLikeUntrimmed(["build", "--compile"], options);
    if (runsTheProgram)
      expect(said).toMatchObject({ stdout: `hello world\n${JSON.stringify([options])}\n`, exitCode: 0 });
  });

  test.skipIf(!!unsupported)("bun compile --trim keeps it too", async () => {
    await behavesLikeUntrimmed(["compile"], "--sql-preconnect");
  });

  test("Bun.build accepts the same options", async () => {
    const lists = [["--sql-preconnect"], ["--smol", "--title=-h", "--help"]];
    expect(await run([bunExe(), "api.ts", JSON.stringify(lists)], folder)).toEqual({
      stdout: "built\n".repeat(lists.length),
      stderr: "",
      exitCode: 0,
    });
  });
});

(canTrim && !unsupported ? describe.concurrent : describe.skip)(
  "--trim keeps the client that a preconnect option in --compile-exec-argv needs, even if the program never uses it",
  () => {
    test.each([
      ["--fetch-preconnect=http://127.0.0.1:9", "fetch"],
      ["--smol --redis-preconnect", "Bun.RedisClient"],
    ])("%s", async (options, builtin) => {
      expect(removedFeaturesOf(await build("hello.ts", "--aot", "--trim"))).toContain(featureOf(builtin));
      expect(
        removedFeaturesOf(await build("hello.ts", "--aot", "--trim", "--compile-exec-argv=" + options)),
      ).not.toContain(featureOf(builtin));
    });

    test("an executable built with --fetch-preconnect in --compile-exec-argv runs", async () => {
      for (const flags of [[], ["--aot"]]) {
        const hello = await build(
          "hello.ts",
          ...flags,
          "--trim",
          "--compile-exec-argv=--fetch-preconnect=http://127.0.0.1:9",
        );
        expect(await run([hello.executable], folder)).toEqual(saysHello);
      }
    });
  },
);

(canTrim ? describe.concurrent : describe.skip)("an executable built with --trim", () => {
  for (const flags of [[], ["--aot"]]) {
    const how = ["--compile", ...flags].join(" ");
    const isAot = flags.length > 0;
    const ignored = isAot ? needEveryRuntimeFeature.filter(([option]) => option.startsWith("--trace-")) : [];
    const rejected = isAot ? needAFeature.filter(row => !ignored.includes(row)) : needTheCli;

    test.skipIf(isAot && !!unsupported)(
      `${how}: rejects options in BUN_OPTIONS that need a removed feature`,
      async () => {
        const hello = await build("hello.ts", ...flags, "--trim");
        for (const program of [hello, await build("names-eval.ts", ...flags, "--trim")]) {
          for (const [option, options] of rejected) {
            const reason = needTheCli.some(([, theirs]) => theirs === options) ? hasNoCommandLine : wasRemoved;
            expect(await startedWith(program, options)).toEqual({
              options,
              stdout: "",
              stderr: `error: ${option} ${reason}\n`,
              exitCode: 1,
            });
          }
        }
        for (const [option, options] of ignored) {
          const stderr = `warn: ${option} is ignored by this executable because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code\n`;
          expect(await startedWith(hello, options)).toEqual({ options, ...saysHello, stderr });
        }
        for (const options of [
          ...needNothing.map(([, options]) => options),
          "--title=--help",
          "--title --help",
          "--title -h",
          "--trace-warnings",
          "--trace-deprecation",
          "--sql-preconnecting",
          "positional --help",
        ])
          expect(await startedWith(hello, options)).toEqual({ options, ...saysHello });
        expect(
          await run([hello.executable, ...needAFeature.flatMap(([, options]) => options.split(" "))], folder),
        ).toEqual(saysHello);
      },
    );

    if (!isAot)
      test(`${how}: keeps every runtime feature, so options in BUN_OPTIONS that need them work like in the untrimmed executable`, async () => {
        const [untrimmed, trimmed] = [await build("hello.ts"), await build("hello.ts", "--trim")];
        for (const [, options] of needEveryRuntimeFeature)
          expect(await startedWith(trimmed, options)).toEqual(await startedWith(untrimmed, options));
      });

    test.skipIf(isAot && !!unsupported)(
      `${how}: accepts --fetch-preconnect if fetch was kept, and rejects it if fetch was removed`,
      async () => {
        const options = "--fetch-preconnect=http://127.0.0.1:9";
        for (const [program, prints] of [
          ["hello", "hello world\n"],
          ["names-eval", "2\n"],
          ["calls-fetch", "function\n"],
        ]) {
          const removesFetch = program !== "calls-fetch" && isAot;
          expect({
            program,
            ...(await startedWith(await build(`${program}.ts`, ...flags, "--trim"), options)),
          }).toEqual({
            program,
            options,
            ...(removesFetch
              ? { stdout: "", stderr: `error: --fetch-preconnect ${wasRemoved}\n`, exitCode: 1 }
              : { stdout: prints, stderr: "", exitCode: 0 }),
          });
        }
      },
    );

    test.skipIf(isAot && !!unsupported)(
      `${how}: reports an unknown option in BUN_OPTIONS without printing the CLI help`,
      async () => {
        const [whole, trimmed] = [await build("hello.ts", ...flags), await build("hello.ts", ...flags, "--trim")];
        for (const options of ["-Z", "--title", "--smol=1", "--help=1", "-bZ"]) {
          const untrimmed = await startedWith(whole, options);
          if (isAot) expect(untrimmed.stdout).toBe("");
          else expect(untrimmed.stdout).toContain("Usage:");
          expect(untrimmed.stderr).toStartWith("error: ");
          expect(await startedWith(trimmed, options)).toEqual({ ...untrimmed, stdout: "" });
          expect(untrimmed.exitCode).toBe(1);
        }
      },
    );
  }
});
