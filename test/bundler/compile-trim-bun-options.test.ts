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
  obeyed,
  obeyedWhereTheFeatureIsAllowed,
  obeyedWhereTheProgramUsesTheFeature,
  printsTheIdOf,
  runsOnlyCompiledCode,
  started,
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
    const whole = laidOut(root, "whole");
    const trimmed = laidOut(root, "trimmed");
    const withoutFunctionSource = {
      whole: laidOut(join(root, "without-function-source"), "whole"),
      trimmed: laidOut(join(root, "without-function-source"), "trimmed"),
    };
    let folders = 0;
    let finished: Awaited<ReturnType<typeof built>>[] = [];

    beforeAll(async () => {
      const builds = [
        built(whole, "whole"),
        built(trimmed, "trimmed"),
        built(withoutFunctionSource.whole, "whole", ["--no-compile-function-source"]),
        built(withoutFunctionSource.trimmed, "trimmed", ["--no-compile-function-source"]),
      ];
      finished = await Promise.all(builds);
      expect(finished).toMatchObject(builds.map(() => ({ exitCode: 0 })));
    });

    test.each(formsOf(obeyed))("%s works like in the untrimmed executable: %s", async (name, form) => {
      expect(await started(trimmed, name, form)).toEqual(await started(whole, name, form));
    });

    test.each(formsOf(nameTheExecutable))(
      "%s prints what the build of that executable printed, which isn't what the untrimmed one prints: %s",
      async (name, form) => {
        const printed = [await started(whole, name, form), await started(trimmed, name, form)];
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
        expect(await started(trimmed, name, form)).toEqual(failure);
        expect(await started(whole, name, form)).toEqual(failure);
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
        expect(await started(trimmed, name, form)).toEqual(ofDefaultBuild);
        expect(await started(whole, name, form)).toEqual(ofDefaultBuild);
        const withoutSource = ran(
          "it was built with --no-compile-function-source, so it only runs code that was compiled into it. Rebuild without that flag",
        );
        expect(await started(withoutFunctionSource.trimmed, name, form)).toEqual(withoutSource);
        expect(await started(withoutFunctionSource.whole, name, form)).toEqual(withoutSource);
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
        expect(await started(trimmed, name, form)).toEqual(failure);
        expect(await started(whole, name, form)).toEqual(failure);
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
        expect(await started(withoutFunctionSource.trimmed, name, form)).toEqual(failure);
        expect(await started(withoutFunctionSource.whole, name, form)).toEqual(failure);
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
      const folder = join(root, String(folders++));
      const sides = [laidOut(folder, "whole"), laidOut(folder, "trimmed")];
      expect(
        await Promise.all([built(sides[0], "whole", [], program), built(sides[1], "trimmed", [], program)]),
      ).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
      expect(await started(sides[1], name, form)).toEqual(await started(sides[0], name, form));
    });

    test.each(formsByAllowing)(
      "%s fails at startup, with and without --trim, because the feature that it needs is part of the Bun command line: %s",
      async (name, form) => {
        const failure = { stdout: "", stderr: `error: ${name} ${hasNoCommandLine}\n`, exitCode: 1 };
        expect(await started(trimmed, name, form)).toEqual(failure);
        expect(await started(whole, name, form)).toEqual(failure);
      },
    );

    test.each(formsByAllowing)(
      "%s is read where compile.trim.allow lists that feature: %s, %s",
      async (name, form, allow) => {
        const folder = laidOut(join(root, String(folders++)), "trimmed");
        await builtAllowing(folder, allow);
        const ran = await started(folder, name, form);
        if (form.endsWith("=nonsense"))
          expect(ran).toMatchObject({
            stdout: "",
            stderr: expect.stringContaining(`error: Invalid value for ${name}: "nonsense".`),
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
