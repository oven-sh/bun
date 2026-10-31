// One parser reads BUN_OPTIONS and --compile-exec-argv, and compile-trim-bun-options.test.ts takes every form of every option through it.
// Here is what the build alone does: it reads --compile-exec-argv, keeps what each option needs, and refuses what no executable can do.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/harness/compiler";
import { inTurn } from "../aot/harness/shared-builds";
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
  neverEnd,
  obeyed,
  printsTheIdOf,
  type Side,
  source,
  spawned,
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

type Build = Awaited<ReturnType<typeof built>>;
type Start = Awaited<ReturnType<typeof started>>;

/** What an executable says that prints `stdout` and ends by itself. */
const prints = (stdout: string): Start => ({ stdout, stderr: "", exitCode: 0 });
const hello = prints("hello world\n");
/**
 * How a start with the option `name` may end where the program prints `stdout`. An executable that waits for a server
 * never ends where there is none: `started` ends it with SIGKILL after its first words.
 */
const waysToEnd = (name: string, stdout: string): Start[] =>
  neverEnd.includes(name) ? [prints(stdout), { ...prints(stdout), exitCode: "SIGKILL" }] : [prints(stdout)];

/** What a build says, with a name in place of each time, each size and the id of the build. */
const saidBy = ({ stdout, stderr, exitCode }: Build) => ({
  stdout: stdout
    .replace(/^ *\[[\d.]+m?s\]/gm, "[time]")
    .replace(/\d+\.\d MB/g, "<size>")
    .replace(/[0-9a-f]{32}$/m, "<id>"),
  stderr,
  exitCode,
});
const leftOut = { whole: "", trimmed: "  <size> (<size> of unused Bun APIs removed)" };
/** What a build that wrote its executable says. Only one with --trim says what it left out. */
const wrote = (side: Side, stderr = "") => ({
  stdout: `[time]  bundle  1 modules\n[time] compile  program${leftOut[side]}\n        build id  <id>\n`,
  stderr,
  exitCode: 0,
});
// An executable with the inspector runs code that no build has seen. --trim keeps for it what the program never calls, and says so.
const keptForCodeLoadedAtRunTime =
  "--trim kept APIs your code doesn't call because a build option lets the executable load code at run time\n";

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
  const builds = new Map<string, Promise<{ folder: string; build: Build }>>();

  /** One build for each command line: the tests that ask for the same executable share it. */
  const builtWith = (side: Side, form: string, program?: string) =>
    builds.getOrInsertComputed(JSON.stringify([side, form, program]), async () => {
      const folder = laidOut(join(root, String(folders++)), side);
      return { folder, build: await built(folder, side, form ? ["--compile-exec-argv=" + form] : [], program) };
    });
  const builtBothWaysWith = (form: string, program?: string) =>
    Promise.all([builtWith("whole", form, program), builtWith("trimmed", form, program)]);
  /** What the Bun under test prints for `option`, read as `started` reads what an executable prints. */
  const printedByBun = (option: string) => inTurn(() => spawned([bunExe(), option], root, bunEnv, 60_000));

  /**
   * What the untrimmed executable does. The trimmed one does the same. CI lets only a few tests of this file run side by
   * side (`--max-concurrency` in scripts/runner.node.ts), and a test keeps its place while it waits. So its two builds
   * run at the same time, and then its two executables.
   */
  async function worksLikeInTheUntrimmedExecutable(name: string, form: string, program?: string) {
    const [whole, trimmed] = await builtBothWaysWith(form, program);
    expect([saidBy(whole.build), saidBy(trimmed.build)]).toEqual([
      wrote("whole"),
      wrote("trimmed", name === optionThatNeeds.Inspector ? keptForCodeLoadedAtRunTime : ""),
    ]);
    const [inWhole, inTrimmed] = await Promise.all([started(whole.folder, name), started(trimmed.folder, name)]);
    expect(inWhole.stderr).not.toMatch(wasLeftOut);
    expect(inTrimmed).toEqual(inWhole);
    return inWhole;
  }

  test("the options that change nothing in what a program prints work together", async () => {
    const plain = await builtWith("whole", "");
    expect(saidBy(plain.build)).toEqual(wrote("whole"));
    const forms = formsOf(obeyed);
    const ran = await Promise.all(forms.map(([name, form]) => started(plain.folder, name, form)));
    const quiet = forms.filter((_, index) => Bun.deepEquals(ran[index], hello));
    expect(quiet.length).toBeGreaterThan(80);
    // An option is written once in a list, and so is one of several that exclude each other: the second goes into the second list.
    const lists: string[][] = [];
    const seen = new Map<string, number>();
    for (const [option, form] of quiet) {
      const name = /^--use-\w+-ca$/.test(option) ? "--use-*-ca" : (/^--tls-m(in|ax)-/.exec(option)?.[0] ?? option);
      const list = seen.get(name) ?? 0;
      seen.set(name, list + 1);
      (lists[list] ??= []).push(form);
    }
    // No list waits for another: each has two executables of its own.
    const worked = await Promise.all(lists.map(list => worksLikeInTheUntrimmedExecutable("", list.join(" "))));
    expect(lists.map((list, index) => ({ list, ...worked[index] }))).toEqual(lists.map(list => ({ list, ...hello })));
  });

  const needed = Object.values(optionThatNeeds);
  test.each(
    firstOfEachName([obeyed, needRemovedFeatures, needTheBunCommandLine].flatMap(formsOf)).filter(([name]) =>
      needed.includes(name),
    ),
  )("%s works, because the build keeps what it needs: %s", async (name, form) => {
    const ran = await worksLikeInTheUntrimmedExecutable(name, form);
    // The Bun command line is one of these parts: with --help the executable prints what Bun prints.
    expect(ran).toEqual(name === "--help" ? await printedByBun(name) : hello);
  });

  test.each(firstOfEachName(formsByUse))(
    "%s works even if the program never uses the client, because the build keeps it: %s",
    async (name, form) => {
      expect(waysToEnd(name, hello.stdout)).toContainEqual(await worksLikeInTheUntrimmedExecutable(name, form));
    },
  );

  test.each(firstOfEachName(formsByUse))(
    "%s works where the program uses that client: %s, %s",
    async (name, form, program) => {
      const ran = await worksLikeInTheUntrimmedExecutable(name, form, program);
      expect(waysToEnd(name, "hello world function\n")).toContainEqual(ran);
    },
  );

  test.each(firstOfEachName(formsByAllowing))(
    "%s works, because the build keeps what it needs: %s",
    async (name, form) => {
      expect(await worksLikeInTheUntrimmedExecutable(name, form)).toEqual(hello);
    },
  );

  test.each(firstOfEachName(formsByAllowing))(
    "%s works where compile.trim.allow lists that feature: %s, %s",
    async (name, form, allow) => {
      const folder = laidOut(join(root, String(folders++)), "trimmed");
      const [whole, { success, logs }] = await Promise.all([
        builtWith("whole", form),
        builtAllowing(folder, allow, [form]),
      ]);
      expect(saidBy(whole.build)).toEqual(wrote("whole"));
      expect({ success, logs }).toEqual({ success: true, logs: [] });
      expect(await Promise.all([started(whole.folder, name), started(folder, name)])).toEqual([hello, hello]);
    },
  );

  test.each(formsOf(nameTheExecutable))(
    "%s prints what the build of that executable printed: %s",
    async (name, form) => {
      const [whole, trimmed] = await builtBothWaysWith(form);
      expect([saidBy(whole.build), saidBy(trimmed.build)]).toEqual([wrote("whole"), wrote("trimmed")]);
      const printed = await Promise.all([started(whole.folder, name), started(trimmed.folder, name)]);
      expect(printed).toEqual([printsTheIdOf(whole.build), printsTheIdOf(trimmed.build)]);
      // Each build has an id of its own.
      expect(printed[1].stdout).not.toBe(printed[0].stdout);
    },
  );

  test.each(firstOfEachName([ignoredWithAWarning, loadCode].flatMap(formsOf)))(
    "%s fails the build, with and without --trim, because the executable only runs code that was compiled into it: %s",
    async (name, form) => {
      const [whole, trimmed] = await builtBothWaysWith(form);
      const failure = {
        stdout: "",
        stderr: `error: --aot does not support ${longNames[name] ?? name} in --compile-exec-argv because the executable only runs code that was compiled into it\n`,
        exitCode: 1,
      };
      expect([whole.build, trimmed.build]).toEqual([failure, failure]);
    },
  );
});
