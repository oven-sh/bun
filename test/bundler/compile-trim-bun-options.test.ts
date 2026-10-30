import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/harness/compiler";
import { canTrim } from "./compile-trim-features";
import {
  built,
  builtAllowing,
  featureWasRemoved,
  formsByAllowing,
  formsByUse,
  formsOf,
  hasNoCommandLine,
  hasNoFunctionSource,
  ignoredWithAWarning,
  laidOut,
  loadCode,
  longNames,
  nameTheExecutable,
  namesInTheSource,
  needRemovedFeatures,
  needTheBunCommandLine,
  neverEnd,
  obeyed,
  obeyedWhereTheFeatureIsAllowed,
  obeyedWhereTheProgramUsesTheFeature,
  printsTheIdOf,
  runsOnlyCompiledCode,
  started,
  type Side,
} from "./compile-trim-options";

test("every option that a compiled executable reads is in one of the lists: it works like in the untrimmed executable, it is ignored with a warning, or it fails at startup", () => {
  const sorted = [
    obeyed,
    obeyedWhereTheProgramUsesTheFeature,
    obeyedWhereTheFeatureIsAllowed,
    nameTheExecutable,
    needRemovedFeatures,
    needTheBunCommandLine,
    ignoredWithAWarning,
    loadCode,
  ]
    .flatMap(Object.keys)
    .sort();
  expect(sorted).toEqual(namesInTheSource);
});

(!canTrim || unsupported ? describe.skip : describe.concurrent)(
  "BUN_OPTIONS, in an executable built with --trim",
  () => {
    const dir = tempDir("compile-trim-runtime-options", {});
    afterAll(() => dir[Symbol.dispose]());
    const root = realpathSync(String(dir));
    const bothSides = (folder: string) => ({ whole: laidOut(folder, "whole"), trimmed: laidOut(folder, "trimmed") });
    const { whole, trimmed } = bothSides(root);
    const withoutFunctionSource = bothSides(join(root, "without-function-source"));
    type Build = Awaited<ReturnType<typeof built>>;
    // The forms of an option start the same executables: a pair for each program that uses a client, and one for each feature that compile.trim.allow lists.
    const thatUse = new Map<string, { whole: string; trimmed: string; builds: Build[] }>();
    for (const [, , program] of formsByUse)
      thatUse.getOrInsertComputed(program, () => ({
        ...bothSides(join(root, `uses-a-client-${thatUse.size}`)),
        builds: [],
      }));
    const thatAllow = new Map<
      Bun.Build.TrimFeature,
      { folder: string; build?: PromiseSettledResult<Bun.BuildOutput> }
    >();
    for (const [, , allow] of formsByAllowing)
      thatAllow.getOrInsertComputed(allow, () => ({ folder: laidOut(join(root, `allows-${allow}`), "trimmed") }));
    let finished: Build[] = [];

    /**
     * What a build that wrote its executable has printed. Only one with --trim says what it left out.
     * For toEqual: toMatchObject puts a matcher that matched into the object it checked, and tests read these builds later.
     */
    const wrote = (side: Side) => ({
      stdout:
        side === "trimmed"
          ? expect.stringContaining("of unused Bun APIs removed")
          : expect.not.stringContaining("of unused Bun APIs removed"),
      stderr: expect.any(String),
      exitCode: 0,
    });

    // Every executable of this file is built here, once, and all of them at the same time: a test only starts them.
    // A new executable costs its build and a slow first start (see `started`), so no two of them are alike.
    beforeAll(async () => {
      const builds = [
        built(whole, "whole"),
        built(trimmed, "trimmed"),
        built(withoutFunctionSource.whole, "whole", ["--no-compile-function-source"]),
        built(withoutFunctionSource.trimmed, "trimmed", ["--no-compile-function-source"]),
      ];
      // A test that starts one of these says what became of its build. The other tests run without them.
      const ofFewTests = [
        ...Array.from(thatUse, async ([program, pair]) => {
          pair.builds = await Promise.all([
            built(pair.whole, "whole", [], program),
            built(pair.trimmed, "trimmed", [], program),
          ]);
        }),
        ...Array.from(thatAllow, async ([allow, one]) => {
          [one.build] = await Promise.allSettled([builtAllowing(one.folder, allow)]);
        }),
      ];
      [finished] = await Promise.all([Promise.all(builds), Promise.all(ofFewTests)]);
      expect(finished).toEqual([wrote("whole"), wrote("trimmed"), wrote("whole"), wrote("trimmed")]);
    });

    /**
     * What the executable in each folder does with an option. They start at the same time: CI lets only a few tests of this
     * file run side by side (`--max-concurrency` in scripts/runner.node.ts), and a test keeps its place while it waits.
     */
    const startedIn = (folders: string[], name: string, form: string) =>
      Promise.all(folders.map(folder => started(folder, name, form)));

    test.each(formsOf(obeyed))("%s works like in the untrimmed executable: %s", async (name, form) => {
      const [inTrimmed, inWhole] = await startedIn([trimmed, whole], name, form);
      expect(inTrimmed).toEqual(inWhole);
      // Two that a signal ended are alike too: at the time limit of a start, or in a crash.
      expect(inWhole).toEqual({ ...inWhole, exitCode: expect.any(Number) });
    });

    test.each(formsOf(nameTheExecutable))(
      "%s prints what the build of that executable printed, which isn't what the untrimmed one prints: %s",
      async (name, form) => {
        const printed = await startedIn([whole, trimmed], name, form);
        expect(printed).toEqual([printsTheIdOf(finished[0]), printsTheIdOf(finished[1])]);
        expect(printed[1].stdout).not.toBe(printed[0].stdout);
      },
    );

    test.each(formsOf(needRemovedFeatures))("%s fails at startup: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual({
        stdout: "",
        stderr: `error: ${longNames[name] ?? name} ${featureWasRemoved}\n`,
        exitCode: 1,
      });
    });

    test.each(formsOf(needTheBunCommandLine))(
      "%s fails at startup, with and without --trim, because no executable built with --aot includes the Bun command line: %s",
      async (name, form) => {
        const failure = { stdout: "", stderr: `error: ${longNames[name] ?? name} ${hasNoCommandLine}\n`, exitCode: 1 };
        expect(await startedIn([trimmed, whole], name, form)).toEqual([failure, failure]);
      },
    );

    test.each(formsOf(ignoredWithAWarning))(
      "%s is ignored with a warning, with and without --trim, and the program runs: %s",
      async (name, form) => {
        const ran = (reason: string) => ({
          stdout: "hello world\n",
          stderr: `warn: ${name} is ignored by this executable because ${reason}\n`,
          exitCode: 0,
        });
        const ofDefaultBuild = ran(
          "it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code",
        );
        const withoutSource = ran(
          "it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag",
        );
        expect(
          await startedIn([trimmed, whole, withoutFunctionSource.trimmed, withoutFunctionSource.whole], name, form),
        ).toEqual([ofDefaultBuild, ofDefaultBuild, withoutSource, withoutSource]);
      },
    );

    test.each(formsOf(loadCode))(
      "%s fails at startup, with and without --trim, because the executable only runs code that was compiled into it: %s",
      async (name, form) => {
        const failure = {
          stdout: "",
          stderr: `error: ${longNames[name] ?? name} ${runsOnlyCompiledCode}\n`,
          exitCode: 1,
        };
        expect(await startedIn([trimmed, whole], name, form)).toEqual([failure, failure]);
      },
    );

    test.each(formsOf(loadCode))(
      "%s fails at startup in an executable built with --no-compile-function-source, with and without --trim: %s",
      async (name, form) => {
        const failure = {
          stdout: "",
          stderr: `error: ${longNames[name] ?? name} ${hasNoFunctionSource}\n`,
          exitCode: 1,
        };
        expect(await startedIn([withoutFunctionSource.trimmed, withoutFunctionSource.whole], name, form)).toEqual([
          failure,
          failure,
        ]);
      },
    );

    test.each(formsByUse)(
      "%s fails at startup where the program doesn't use the client that it connects: %s",
      async (name, form) => {
        expect(await started(trimmed, name, form)).toEqual({
          stdout: "",
          stderr: `error: ${name} ${featureWasRemoved}\n`,
          exitCode: 1,
        });
      },
    );

    test.each(formsByUse)("%s works where the program uses that client: %s, %s", async (name, form, program) => {
      const pair = thatUse.get(program)!;
      expect(pair.builds).toEqual([wrote("whole"), wrote("trimmed")]);
      const [inTrimmed, inWhole] = await startedIn([pair.trimmed, pair.whole], name, form);
      expect(inTrimmed).toEqual(inWhole);
      // The program runs. One that waits for a server never ends where there is none, and `started` ends it.
      const ran = { stdout: "hello world function\n" };
      expect(inWhole).toMatchObject(neverEnd.includes(name) ? ran : { ...ran, stderr: "", exitCode: 0 });
    });

    test.each(formsByAllowing)(
      "%s fails at startup, with and without --trim, because the feature that it needs is part of the Bun command line: %s",
      async (name, form) => {
        const failure = { stdout: "", stderr: `error: ${name} ${hasNoCommandLine}\n`, exitCode: 1 };
        expect(await startedIn([trimmed, whole], name, form)).toEqual([failure, failure]);
      },
    );

    test.each(formsByAllowing)(
      "%s is read where compile.trim.allow lists that feature: %s, %s",
      async (name, form, allow) => {
        const { folder, build } = thatAllow.get(allow)!;
        expect(build).toMatchObject({ status: "fulfilled", value: { success: true } });
        const ran = await started(folder, name, form);
        if (form.endsWith("=nonsense"))
          expect(ran).toEqual({
            stdout: "",
            stderr: expect.stringMatching(new RegExp(`^error: Invalid value for ${name}: "nonsense"\\. [^\\n]+\\n$`)),
            exitCode: 1,
          });
        else expect(ran).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
      },
    );

    test("as arguments of the executable they all belong to the program", async () => {
      const args = [
        ...[
          obeyed,
          nameTheExecutable,
          needRemovedFeatures,
          needTheBunCommandLine,
          ignoredWithAWarning,
          loadCode,
        ].flatMap(formsOf),
        ...formsByUse,
        ...formsByAllowing,
      ].flatMap(([, form]) => form.split(" "));
      expect(await started(trimmed, "", undefined, args)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });
  },
);
