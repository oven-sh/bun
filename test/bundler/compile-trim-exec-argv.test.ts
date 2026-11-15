// One parser reads BUN_OPTIONS and --compile-exec-argv, and compile-trim-bun-options.test.ts takes every form of every option through it.
// Here is what the build alone does: it reads --compile-exec-argv, keeps what each option needs, and refuses what no executable can do.
import { afterAll, describe, expect, test } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/harness/compiler";
import { canTrim } from "./compile-trim-features";
import {
  built,
  builtAllowing,
  formsByAllowing,
  formsByUse,
  formsOf,
  ignoredWithAWarning,
  laidOut,
  loadCode,
  longNames,
  nameTheExecutable,
  needRemovedFeatures,
  needTheBunCommandLine,
  obeyed,
  printsTheIdOf,
  type Side,
  source,
  started,
  wasLeftOut,
} from "./compile-trim-options";

/** For each part of Bun that an option is declared to need, an option that needs it. */
const optionThatNeeds: Record<string, string> = {
  AotCompiler: "--aot",
  Bunfig: "--config",
  Check: "--check",
  Fetch: "--fetch-preconnect",
  Inspector: "--inspect",
  Install: "--install",
  InternalForTesting: "--expose-internals",
  Profilers: "--cpu-prof",
  Sql: "--sql-preconnect",
  Tools: "--help",
  Valkey: "--redis-preconnect",
};
const firstOfEachName = <Form extends readonly [string, ...unknown[]]>(forms: Form[]) =>
  forms.filter(([name], index) => forms.findIndex(([other]) => other === name) === index);
const hello = { stdout: "hello world\n", stderr: "", exitCode: 0 };

test("every part of Bun that an option is declared to need has an option here", () => {
  const declared = new Set(
    Array.from(source.matchAll(/RuntimeRequirement::Feature\(\s*Feature::(\w+)/g), ([, name]) => name),
  );
  expect(Object.keys(optionThatNeeds)).toEqual([...declared].sort());
});

(!canTrim || unsupported ? describe.skip : describe.concurrent)("--compile-exec-argv with --trim", () => {
  const dir = tempDir("compile-trim-exec-argv", {});
  afterAll(() => dir[Symbol.dispose]());
  const root = realpathSync(String(dir));
  let folders = 0;

  async function builtWith(side: Side, form: string, program?: string) {
    const folder = laidOut(join(root, String(folders++)), side);
    return { folder, build: await built(folder, side, form ? ["--compile-exec-argv=" + form] : [], program) };
  }
  const builtBothWaysWith = (form: string, program?: string) =>
    Promise.all([builtWith("whole", form, program), builtWith("trimmed", form, program)]);

  async function worksLikeInTheUntrimmedExecutable(name: string, form: string, program?: string) {
    const [whole, trimmed] = await builtBothWaysWith(form, program);
    expect([whole.build, trimmed.build]).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
    const ran = await started(whole.folder, name);
    expect(ran.stderr).not.toMatch(wasLeftOut);
    expect(await started(trimmed.folder, name)).toEqual(ran);
    return ran;
  }

  test("the options that change nothing in what a program prints work together", async () => {
    const plain = await builtWith("whole", "");
    expect(plain.build).toMatchObject({ exitCode: 0 });
    const quiet: (readonly [string, string])[] = [];
    await Promise.all(
      formsOf(obeyed).map(async ([name, form]) => {
        if (Bun.deepEquals(await started(plain.folder, name, form), hello)) quiet.push([name, form]);
      }),
    );
    expect(quiet.length).toBeGreaterThan(80);
    // An option is written once in a list, and so is one of several that exclude each other: the second goes into the second list.
    const lists: string[][] = [];
    const seen = new Map<string, number>();
    for (const [option, form] of formsOf(obeyed).filter(([, form]) => quiet.some(([, other]) => other === form))) {
      const name = /^--use-\w+-ca$/.test(option) ? "--use-*-ca" : (/^--tls-m(in|ax)-/.exec(option)?.[0] ?? option);
      const list = seen.get(name) ?? 0;
      seen.set(name, list + 1);
      (lists[list] ??= []).push(form);
    }
    for (const list of lists)
      expect({ list, ...(await worksLikeInTheUntrimmedExecutable("", list.join(" "))) }).toEqual({ list, ...hello });
  });

  const needed = Object.values(optionThatNeeds);
  test.each(
    firstOfEachName([obeyed, needRemovedFeatures, needTheBunCommandLine].flatMap(formsOf)).filter(([name]) =>
      needed.includes(name),
    ),
  )(
    "%s works, because the build keeps what it needs: %s",
    async (name, form) => void (await worksLikeInTheUntrimmedExecutable(name, form)),
  );

  test.each(firstOfEachName(formsByUse))(
    "%s works even if the program never uses the client, because the build keeps it: %s",
    async (name, form) => {
      await worksLikeInTheUntrimmedExecutable(name, form);
    },
  );

  test.each(firstOfEachName(formsByUse))(
    "%s works where the program uses that client: %s, %s",
    async (name, form, program) => {
      await worksLikeInTheUntrimmedExecutable(name, form, program);
    },
  );

  test.each(firstOfEachName(formsByAllowing))(
    "%s works, because the build keeps what it needs: %s",
    async (name, form) => {
      await worksLikeInTheUntrimmedExecutable(name, form);
    },
  );

  test.each(firstOfEachName(formsByAllowing))(
    "%s works where compile.trim.allow lists that feature: %s, %s",
    async (name, form, allow) => {
      const whole = await builtWith("whole", form);
      expect(whole.build).toMatchObject({ exitCode: 0 });
      const folder = laidOut(join(root, String(folders++)), "trimmed");
      await builtAllowing(folder, allow, [form]);
      expect(await started(folder, name)).toEqual(await started(whole.folder, name));
    },
  );

  test.each(formsOf(nameTheExecutable))(
    "%s prints what the build of that executable printed: %s",
    async (name, form) => {
      const [whole, trimmed] = await builtBothWaysWith(form);
      expect([whole.build, trimmed.build]).toMatchObject([{ exitCode: 0 }, { exitCode: 0 }]);
      expect([await started(whole.folder, name), await started(trimmed.folder, name)]).toEqual([
        printsTheIdOf(whole.build),
        printsTheIdOf(trimmed.build),
      ]);
    },
  );

  test.each(firstOfEachName([ignoredWithAWarning, loadCode].flatMap(formsOf)))(
    "%s fails the build, with and without --trim, because the executable only runs code that was compiled into it: %s",
    async (name, form) => {
      const [whole, trimmed] = await builtBothWaysWith(form);
      const failure = {
        stderr: expect.stringContaining(
          `error: --aot does not support ${longNames[name] ?? name} in --compile-exec-argv because the executable only runs code that was compiled into it`,
        ),
        exitCode: 1,
      };
      expect([whole.build, trimmed.build]).toMatchObject([failure, failure]);
    },
  );
});
