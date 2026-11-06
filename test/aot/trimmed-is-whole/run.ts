// An executable built with --trim behaves like one built without it.
//
// A file of ./cases holds small programs on one subject: what stands above the first line `//// <name>` begins each of them. The
// programs of a file that are built with the same flags are built together, whole and trimmed: one entry point imports the
// program that a variable of the environment names, so Bun's own modules are compiled once for all of them. Each run is a process
// of its own. What --trim removes is decided behind the compiler, so one build compiles the programs and writes both executables.
// A program whose build is to fail is built twice. --trim keeps what any of them reaches, so a program whose neighbor names a feature does not show that it loses that
// feature by itself, and none of them is the entry point.
// `//@ alone` gives a program two executables of its own: it is for a program that once lost something, or that asks what an
// entry point is asked.
//
//   //@ args a b            the arguments of both runs            //@ env A=b     a variable of both runs
//   //@ stdin "text\n"      what both runs read                   //@ exit 3      what the whole executable ends with
//   //@ build --flag        more flags for both builds            //@ ext ts      the extension of the program
//   //@ file <path> "text"  a file beside the program. Below cwd/ it lies in the working directory of both runs
//   //@ removes Bun.color   the trimmed executable is without the feature of that name
//   //@ trimmed-says <text> the trimmed executable prints it and the whole one does not
//   //@ build-error <text>  both builds fail with it
//   //@ todo <why>          it does not pass today
//   //@ not-seen            the build does not see that the call reaches an evaluator: both executables end with the same EvalError
//   //@ evaluated-code-uses-removed-api   where --trim removed the feature, the call in the evaluated code throws
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canTrim, featureOf, model } from "../../bundler/compile-trim-features";
import { unsupported } from "../harness/compiler";
import { inTurn } from "../harness/shared-builds";
import { withoutDebugInformation } from "../harness/without-debug-information";
import { readRemovedFeatures } from "../trimmed-against-whole/removed-features";

interface Program {
  group: string;
  name: string;
  extension: string;
  source: string;
  args: string[];
  env: Record<string, string>;
  stdin: string;
  buildFlags: string[];
  files: Record<string, string>;
  exitCode: number;
  todo?: string;
  buildError?: string;
  evaluatedCodeUsesRemovedApi: boolean;
  isNotSeen: boolean;
  isAlone: boolean;
  removes: string[];
  trimmedSays?: string;
}

const casesFolder = join(import.meta.dir, "cases");

function programsOf(file: string): Program[] {
  const [group, defaultExtension] = file.split(".");
  const [prelude, ...sections] = readFileSync(join(casesFolder, file), "utf8").split(/^\/\/\/\/ *(.*)$/m);
  const programs: Program[] = [];
  for (let index = 0; index < sections.length; index += 2) {
    const source = prelude + sections[index + 1];
    const program: Program = {
      group,
      name: sections[index].trim(),
      extension: defaultExtension,
      source,
      args: [],
      env: {},
      stdin: "",
      buildFlags: [],
      files: {},
      exitCode: 0,
      evaluatedCodeUsesRemovedApi: false,
      isNotSeen: false,
      isAlone: false,
      removes: [],
    };
    for (const [, directive, value] of source.matchAll(/^\/\/@ *(\S+) ?(.*)$/gm)) {
      if (directive === "args") program.args.push(...value.split(" "));
      else if (directive === "env")
        program.env[value.slice(0, value.indexOf("="))] = value.slice(value.indexOf("=") + 1);
      else if (directive === "stdin") program.stdin = JSON.parse(`"${value}"`);
      else if (directive === "build") program.buildFlags.push(...value.split(" "));
      else if (directive === "file")
        program.files[value.slice(0, value.indexOf(" "))] = JSON.parse(value.slice(value.indexOf(" ") + 1));
      else if (directive === "ext") program.extension = value;
      else if (directive === "exit") program.exitCode = Number(value);
      else if (directive === "todo") program.todo = value;
      else if (directive === "build-error") program.buildError = value;
      else if (directive === "evaluated-code-uses-removed-api") program.evaluatedCodeUsesRemovedApi = true;
      else if (directive === "not-seen") program.isNotSeen = true;
      else if (directive === "alone") program.isAlone = true;
      else if (directive === "removes") program.removes.push(value);
      else if (directive === "trimmed-says") program.trimmedSays = value;
      else throw new Error(`${file}: ${program.name}: unknown directive ${directive}`);
    }
    programs.push(program);
  }
  return programs;
}

type Ran = { stdout: string; stderr: string; exitCode: number | null; signal: string | null };

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>, stdin = ""): Promise<Ran> {
  await using child = Bun.spawn({
    cmd,
    cwd,
    env,
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signal: child.signalCode };
}

/** Nor does a program share an executable that is asked what its own build saw or removed, fails to build, fails today or names further entry points. */
const sharesNoExecutable = (program: Program) =>
  program.isAlone ||
  program.isNotSeen ||
  program.removes.length > 0 ||
  program.trimmedSays !== undefined ||
  program.buildError !== undefined ||
  program.todo !== undefined ||
  program.buildFlags.some(flag => flag.startsWith("./"));

const chosen = "PROGRAM_TO_START";

/** A .cjs file that is only imported and names neither module, exports nor require is an ES module. Required, it is what it is as an entry point. */
const loadOf = (program: Program) => (program.extension === "cjs" ? "import.meta.require" : "import");

/** The programs of one pair of executables. Each has a folder of its own, for the files beside it. */
class Executables {
  #built?: Promise<{ folder: string; builds: Ran[]; removed: number[] }>;
  #left: number;
  #dir?: ReturnType<typeof tempDir>;

  constructor(readonly programs: Program[]) {
    this.#left = programs.length;
  }

  #entryOf(program: Program) {
    return `${this.programs.indexOf(program)}/program.${program.extension}`;
  }

  #build() {
    return (this.#built ??= (async () => {
      this.#dir = tempDir("trimmed-is-whole", {
        "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false, "allowJs": true, "types": ["bun"], "skipLibCheck": true } }`,
      });
      const folder = String(this.#dir);
      for (const program of this.programs)
        for (const [path, text] of Object.entries({
          ...program.files,
          [`program.${program.extension}`]: program.source,
          "cwd/.keep": "",
        })) {
          const file = join(folder, dirname(this.#entryOf(program)), path);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, text);
        }
      const [first] = this.programs;
      const isShared = this.programs.length > 1;
      if (isShared)
        writeFileSync(
          join(folder, "start.mjs"),
          `const programs = {\n${this.programs.map(program => `  ${JSON.stringify(this.#entryOf(program))}: () => ${loadOf(program)}(${JSON.stringify("./" + this.#entryOf(program))}),\n`).join("")}};\nawait programs[process.env.${chosen}]();\n`,
        );
      const build = (name: string, flags: string[], env: typeof bunEnv) =>
        inTurn(() =>
          run(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...flags,
              ...withoutDebugInformation,
              isShared ? "start.mjs" : `program.${first.extension}`,
              ...first.buildFlags,
              "--outfile",
              join(folder, name),
            ],
            isShared ? folder : join(folder, "0"),
            env,
          ),
        );
      const builds = await Promise.all(
        first.buildError === undefined
          ? [build("trimmed", ["--trim"], { ...bunEnv, BUN_DEBUG_TEST_UNTRIMMED_OUTFILE: join(folder, "whole") })]
          : [build("whole", [], bunEnv), build("trimmed", ["--trim"], bunEnv)],
      );
      const isBuilt = builds.every(build => build.exitCode === 0);
      return { folder, builds, removed: (isBuilt && readRemovedFeatures(join(folder, "trimmed"))) || [] };
    })());
  }

  /** What both builds said and, where they succeeded, what the program does in either executable. */
  async both(program: Program) {
    try {
      const { folder, builds, removed } = await this.#build();
      if (builds.some(build => build.exitCode !== 0)) return { builds, removed };
      const env = {
        ...bunEnv,
        ...program.env,
        ...(this.programs.length > 1 && { [chosen]: this.#entryOf(program) }),
      };
      const cwd = join(folder, dirname(this.#entryOf(program)), "cwd");
      const [whole, trimmed] = await inTurn(async () => [
        await run([join(folder, "whole"), ...program.args], cwd, env, program.stdin),
        await run([join(folder, "trimmed"), ...program.args], cwd, env, program.stdin),
      ]);
      return { builds, removed, whole, trimmed };
    } finally {
      if (--this.#left === 0) this.#dir?.[Symbol.dispose]();
    }
  }
}

const color = model.features.find(feature => feature.name === featureOf("Bun.color"))!.index;

async function judge(program: Program, executables: Executables) {
  const { builds, removed, whole, trimmed } = await executables.both(program);
  if (program.buildError !== undefined) {
    for (const build of builds) {
      expect(build.stderr).toContain(program.buildError);
      expect(build.exitCode).not.toBe(0);
    }
    return;
  }
  for (const build of builds)
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
  if (program.isNotSeen) {
    expect({
      exitCode: whole!.exitCode,
      stdout: whole!.stdout,
      says: whole!.stderr.includes(
        "the compiler couldn't tell at build time that this call reaches eval() or the Function constructor",
      ),
    }).toEqual({ exitCode: 1, stdout: "", says: true });
    return expect(trimmed).toEqual(whole);
  }
  expect(whole).toMatchObject({ exitCode: program.exitCode });
  if (program.exitCode === 0) expect(whole!.stdout).not.toBe("");
  const stillThere = program.removes.filter(
    api => !removed.includes(model.features.find(feature => feature.name === featureOf(api))!.index),
  );
  expect(stillThere).toEqual([]);
  if (program.trimmedSays !== undefined) {
    expect(whole!.stdout + whole!.stderr).not.toContain(program.trimmedSays);
    return expect(trimmed!.stdout + trimmed!.stderr).toContain(program.trimmedSays);
  }
  if (!program.evaluatedCodeUsesRemovedApi || !removed.includes(color)) return expect(trimmed).toEqual(whole);
  expect(whole).toEqual({ stdout: "#ff0000 function\n", stderr: "", exitCode: 0, signal: null });
  const isThrown = /^\w*rror: .*\bBun\.color\b.*\n code: "ERR_FEATURE_REMOVED"$/m.test(trimmed!.stderr);
  expect({ signal: trimmed!.signal, exitCode: trimmed!.exitCode, stdout: trimmed!.stdout, isThrown }).toEqual(
    program.source.includes('"caught"')
      ? { signal: null, exitCode: 0, stdout: "caught ERR_FEATURE_REMOVED\n", isThrown: false }
      : { signal: null, exitCode: 1, stdout: "", isThrown: true },
  );
}

/** The files of ./cases are dealt out by their place in the alphabet. */
export function testTrimmedMatchesWhole(part: number, parts: number) {
  const files = readdirSync(casesFolder)
    .sort()
    .filter((_, index) => index % parts === part - 1);
  const isSkipped = !canTrim || !!unsupported || isWindows;
  (isSkipped ? describe.skip : describe.concurrent)(
    "an executable built with --trim behaves like one built without it",
    () => {
      for (const file of files) {
        const shared = new Map<string, Program[]>();
        const pairs: Executables[] = [];
        for (const program of programsOf(file))
          if (sharesNoExecutable(program)) pairs.push(new Executables([program]));
          else shared.getOrInsertComputed(program.buildFlags.join(" "), () => []).push(program);
        for (const programs of shared.values()) pairs.push(new Executables(programs));
        for (const executables of pairs)
          for (const program of executables.programs)
            (program.todo ? test.todo : test)(
              `${program.group}: ${program.name}${program.todo ? ` (${program.todo})` : ""}`,
              () => judge(program, executables),
              600_000,
            );
      }
    },
  );
}
