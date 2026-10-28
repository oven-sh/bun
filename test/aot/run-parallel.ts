// Runs the programs under ./parallel: each must exit and print under `bun build --compile --aot` as it does under `bun <file>`.
//
//   bun test/aot/run-parallel.ts test/aot/parallel/classes/super-call.ts ..
//   bun test/aot/run-parallel.ts --jobs=4 --files-from=<a file with one path a line>      as scripts/runner.node.ts starts it
//   --no-erased       leaves out the second build, see below
//
// A program with a TypeScript file is built twice, the second time with --aot-erase-types: types never change what a program prints.
//
// Many programs are the entry points of one executable. Each is compiled as it is when it is built alone, and each runs in a process
// of its own, which BUN_AOT_START_AT tells where to start.
//
// A program may begin with comment lines that say how it is built and run:
//   // Flags: --aot-validate           more flags for the build. A word that begins with ./ or ../ is a path from the folder of the program
//   // Entry points: ./child.cjs       further entry points, for what the program loads under a computed name. The program is built alone and starts
//   // Alone: <why>                    what it prints depends on what else the executable holds: it is built alone
//   // Env: TZ=America/New_York        the environment of both runs, one variable a line
//   // Env of the executable: A=b       the same, for the executable alone
//   // Reference: bun build --compile  it is compared with an executable built without --aot, with the flags that do not begin with --aot
//   // Exit code: 3                    what both runs end with. Without the line a reference that does not end with 0 fails the program: two runs that
//                                      stop at the same error agree and show nothing
//   // Todo: <why>                     it does not pass today. It is run all the same and reported as skipped, and fails once it passes: the line goes out.
//                                      `// Todo: Not every time: <why>`: it is skipped either way
//   // STATISTIC: <name> (= | >= | <=) <n>   what the build must have counted
// Those lines may also stand at the end, in front of the last comment: a stored output may name lines of the program, and a line more at the top moves them.
// It may end with a comment that says what is expected where that is not what plain Bun does:
//   /* Output: .. */                   what the executable prints. Behind a line `exit code <n>` stands the line that names the error
//   /* Build errors: .. */             the build ends with exit code 1 and these `error:` lines
//   // Erased types: as plain Bun      the build with --aot-erase-types is not held to Output
//   // Erased types: not built: <why>  there is no second build: without its types the program means something else
// A program that is built alone is built as anybody builds it: in its folder, with nothing but --compile --aot, the checks and its flags.
//
// Prints a line of JSON when it takes a file ({ file, state: "compiling" }) and one when the file is through
// ({ file, state: "pass", compileMs, runMs, plainMs }, { file, state: "fail", stage, message, expected, actual } or { file, state: "skip", message }).
// One such line a file, when every way to build it is through. `ways` says how each went.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import "./harness/without-installing-packages";

type Output = { exitCode: number | null; signal: string | null; stdout: string; stderr: string };
type Bound = { name: string; relation: string; bound: number };
type Program = {
  file: string;
  path: string;
  flags: string[];
  env: Record<string, string>;
  envOfExecutable: Record<string, string>;
  entryPoints: string[];
  comparesWithCompiled: boolean;
  erasedIsAsPlain: boolean;
  isBuiltErased: boolean;
  isAlone: boolean;
  exitCode: number;
  todo?: string;
  statistics: Bound[];
  output?: string;
  buildErrors?: string;
  way: "compiled" | "erased";
};

const root = join(import.meta.dir, "parallel");
const programsInOneExecutable = 64;
const longestCommandLine = 30_000;
const longestTextShown = 16 * 1024;
const checks = "--aot-check=verify-each-stage,used-values-are-listed,flow-fixpoint,validate-references";

const option = (name: string) =>
  process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const listed = option("files-from");
const files = listed
  ? readFileSync(listed, "utf8").split(/\r?\n/).filter(Boolean)
  : process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const jobs = Number(option("jobs")) || availableParallelism();
const erases = !process.argv.includes("--no-erased");
const folder = mkdtempSync(join(tmpdir(), "aot-parallel-"));
const say = (line: object) => console.log(JSON.stringify(line));
// What a stored output and the search for `error` lines rely on. Both runs get the same environment: a program may print it.
const { FORCE_COLOR: _, ...inherited } = process.env;
const environment = {
  ...inherited,
  NO_COLOR: "1",
  TZ: "Etc/UTC",
  BUN_AOT_VERBOSE: "1",
  // Plain Bun transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
  BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
};
let hasFailed = false;

let free = jobs;
const waiting: (() => void)[] = [];
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}

async function start(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  const began = performance.now();
  const child = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const output: Output = { exitCode: child.signalCode ? null : exitCode, signal: child.signalCode, stdout, stderr };
  return { output, ms: Math.round(performance.now() - began) };
}

/** What the two runs must agree on. Below an uncaught error stand frames with paths, which differ between an executable and its sources. */
const compared = ({ exitCode, signal, stdout, stderr }: Output) => ({
  exitCode,
  signal,
  // A duration that a program measures is not part of its behavior.
  stdout: stdout.replace(/ [0-9]+ms$/gm, ""),
  stderr:
    exitCode === 0
      ? stderr
          .replace(/^\(node:[0-9]+\) /gm, "(node) ")
          .replace(/^\(Use `[^`\n]* --trace-warnings /gm, "(Use `bun --trace-warnings ")
      : (stderr.split("\n").find(line => /^(error|[A-Za-z]*Error)\b/.test(line)) ?? ""),
});
const shown = (output: Output) => ({
  ...output,
  stdout: output.stdout.slice(0, longestTextShown),
  stderr: output.stderr.slice(0, longestTextShown),
});

const waysLeft = new Map<string, number>();
const verdicts = new Map<string, Record<string, unknown>[]>();
/** A file has one verdict: the first way that fails, or else the first. */
function settle(program: Program, verdict: Record<string, unknown>) {
  const all = [...(verdicts.get(program.file) ?? []), { file: program.file, way: program.way, ...verdict }];
  verdicts.set(program.file, all);
  if (all.length < waysLeft.get(program.file)!) return;
  const sum = (name: string) => all.reduce((total, verdict) => total + Number(verdict[name] ?? 0), 0);
  const failed = all.some(({ state }) => state === "fail");
  if (program.todo !== undefined) {
    if (failed || program.todo.startsWith("Not every time:"))
      return say({ file: program.file, state: "skip", message: `todo: ${program.todo}` });
    hasFailed = true;
    return say({
      file: program.file,
      state: "fail",
      stage: "todo",
      message: "it passes: its `// Todo:` line goes out",
    });
  }
  hasFailed ||= failed;
  say({
    ...(all.find(({ state }) => state === "fail") ?? {
      ...all[0],
      compileMs: sum("compileMs"),
      runMs: sum("runMs"),
      plainMs: sum("plainMs"),
    }),
    ways: Object.fromEntries(all.map(({ way, state }) => [way, state])),
  });
}
function fail(program: Program, stage: string, message: string, actual?: Output, expected?: Output) {
  settle(program, {
    state: "fail",
    stage,
    message: program.way === "erased" ? `with --aot-erase-types: ${message}` : message,
    expected: expected && shown(expected),
    actual: actual && shown(actual),
  });
}

function read(file: string): Program {
  const path = resolve(file);
  const text = readFileSync(path, "utf8");
  const head =
    /^(?:#!.*\r?\n)?(?:\/\/.*\r?\n)*/.exec(text)![0] +
    (/\n((?:\/\/.*\r?\n)+)\/\* (?:Output|Build errors):\r?\n(?:(?!\*\/)[^])*\*\/\s*$/.exec(text)?.[1] ?? "");
  const lines = (name: string) =>
    [...head.matchAll(new RegExp(`^// ${name}:[ \\t]+(.*)$`, "gm"))].map(([, value]) => value.trim());
  const words = (name: string) => lines(name).flatMap(value => value.split(/\s+/));
  const last = (name: string) =>
    new RegExp(`(?:^|\\n)/\\* ${name}:\\r?\\n((?:(?!\\*/)[^])*)\\*/\\s*$`)
      .exec(text)?.[1]
      .replaceAll("*\\/", "*/")
      .replaceAll("\r\n", "\n");
  return {
    file,
    path,
    flags: words("Flags"),
    env: Object.fromEntries(lines("Env").map(line => line.split(/=(.*)/s).slice(0, 2))),
    envOfExecutable: Object.fromEntries(lines("Env of the executable").map(line => line.split(/=(.*)/s).slice(0, 2))),
    entryPoints: words("Entry points"),
    comparesWithCompiled: lines("Reference").includes("bun build --compile"),
    erasedIsAsPlain: lines("Erased types").includes("as plain Bun"),
    isBuiltErased: !lines("Erased types").some(line => line.startsWith("not built")),
    isAlone: lines("Alone").length > 0,
    exitCode: Number(lines("Exit code")[0] ?? 0),
    todo: lines("Todo")[0],
    statistics: Array.from(text.matchAll(/^\/\/ STATISTIC: (\w+) (=|>=|<=) (\d+)$/gm), ([, name, relation, bound]) => ({
      name,
      relation,
      bound: Number(bound),
    })),
    output: last("Output"),
    buildErrors: last("Build errors"),
    way: "compiled",
  };
}

function nearestProject(path: string) {
  for (let at = dirname(path); at.startsWith(root + sep); at = dirname(at))
    if (existsSync(join(at, "tsconfig.json"))) return at;
  return root;
}

/** The programs that the errors of a build point into. */
function findRefused(stderr: string, programs: Program[]) {
  const refused = new Map<Program, string>();
  let error: string | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    if (/^error\b/.test(line)) error = line;
    const [, file] = /^\s+at (.+):\d+:\d+$/.exec(line) ?? [];
    if (!file || error === undefined) continue;
    const named = resolve(root, file);
    const program = programs.find(
      ({ path }) => path === named || (/[\\/]main\.[a-z]+$/.test(path) && named.startsWith(dirname(path) + sep)),
    );
    if (program && !refused.has(program)) refused.set(program, error);
    error = undefined;
  }
  return refused;
}

let executables = 0;
const nextExecutable = (name: string) =>
  join(folder, `${name}-${executables++}${process.platform === "win32" ? ".exe" : ""}`);

/** As it stands in the comment Output. What is stored names the files of an executable as they are named elsewhere than on Windows. */
const asText = ({ exitCode, stdout, stderr }: ReturnType<typeof compared>) =>
  (stdout + (exitCode ? `exit code ${exitCode}\n${stderr}\n` : stderr)).replace(
    /B:\\~BUN\\root[^\s'":]*/g,
    path => "/$bunfs/root" + path.slice(12).replaceAll("\\", "/"),
  );

function unmetBounds(buildOutput: string, bounds: Bound[]) {
  const counted = new Map(
    Array.from(buildOutput.matchAll(/^(\w+) (\d+)$/gm), ([, name, value]) => [name, Number(value)] as const),
  );
  return bounds
    .filter(({ name, relation, bound }) => {
      const value = counted.get(name);
      return (
        value === undefined ||
        !(relation === "=" ? value === bound : relation === ">=" ? value >= bound : value <= bound)
      );
    })
    .map(
      ({ name, relation, bound }) =>
        `${name} ${relation} ${bound}, but the build counted ${counted.get(name) ?? "no such statistic"}`,
    );
}

async function run(programs: Program[]): Promise<void> {
  if (programs.length === 0) return;
  const halves = () =>
    Promise.all([run(programs.slice(0, programs.length >> 1)), run(programs.slice(programs.length >> 1))]);
  const [first] = programs;
  const isAlone = isBuiltAlone(first);
  const buildsIn = isAlone ? dirname(first.path) : root;
  const entryPoints = programs.map(program => "./" + relative(buildsIn, program.path).replaceAll("\\", "/"));
  if (programs.length > 1 && entryPoints.join(" ").length > longestCommandLine) return void (await halves());
  const executable = nextExecutable("programs");
  const cmd = [
    process.execPath,
    "build",
    "--compile",
    "--aot",
    ...(isAlone ? [] : ["--aot-separate-programs", `--root=${root}`]),
    checks,
    ...first.flags,
    ...(first.way === "erased" ? ["--aot-erase-types"] : []),
    ...(first.statistics.length ? ["--explain=statistics"] : []),
    ...entryPoints,
    ...first.entryPoints,
    "--outfile",
    executable,
  ];
  const build = await withSlot(() => {
    for (const { file, way } of programs) say({ file, way, state: "compiling" });
    return start(cmd, buildsIn, environment);
  });
  try {
    if (first.buildErrors !== undefined) {
      // Each distinct error counts once. A Bun built with assertions names the token behind some of the messages of the parser.
      const lines = build.output.stderr.split(/\r?\n/).filter(line => line.startsWith("error: "));
      const errors = [...new Set(lines.map(line => line.replace(/ \(token: T\w+\)$/, "")))].join("\n") + "\n";
      if (errors === first.buildErrors && build.output.exitCode === 1)
        return settle(first, { state: "pass", compileMs: build.ms });
      return fail(
        first,
        "compile",
        "the build does not end with exit code 1 and the errors that the program lists",
        build.output,
      );
    }
    if (build.output.exitCode !== 0 || /^error\b/m.test(build.output.stderr)) {
      const refused = findRefused(build.output.stderr, programs);
      if (programs.length === 1)
        return fail(
          first,
          "compile",
          refused.get(first) ?? `the build ended with ${build.output.signal ?? `exit code ${build.output.exitCode}`}`,
          build.output,
        );
      if (refused.size === 0 || refused.size === programs.length) return void (await halves());
      return void (await Promise.all([
        run(programs.filter(program => !refused.has(program))),
        ...[...refused.keys()].map(program => run([program])),
      ]));
    }
    const unmet = first.way === "compiled" ? unmetBounds(build.output.stderr, first.statistics) : [];
    if (unmet.length) return fail(first, "compile", unmet.join("; "), build.output);
    const compileMs = Math.round(build.ms / programs.length);
    await Promise.all(
      programs.map(async (program, index) => {
        const env = {
          ...environment,
          ...program.env,
          ...(!isAlone && { BUN_AOT_START_AT: entryPoints[index].slice(2) }),
        };
        const cwd = dirname(program.path);
        const stored = program.way === "erased" && program.erasedIsAsPlain ? undefined : program.output;
        const reference = async () => {
          if (stored !== undefined) return undefined;
          if (!program.comparesWithCompiled) return withSlot(() => start([process.execPath, program.path], cwd, env));
          const other = nextExecutable("reference");
          try {
            const flags = program.flags.filter(flag => !flag.startsWith("--aot"));
            const built = await withSlot(() =>
              start(
                [
                  process.execPath,
                  "build",
                  "--compile",
                  ...flags,
                  program.path,
                  ...program.entryPoints,
                  "--outfile",
                  other,
                ],
                cwd,
                environment,
              ),
            );
            if (built.output.exitCode !== 0) return built;
            return await withSlot(() => start([other], cwd, env));
          } finally {
            rmSync(other, { force: true });
          }
        };
        const [compiled, plain] = await Promise.all([
          withSlot(() => start([executable], cwd, { ...env, ...program.envOfExecutable })),
          reference(),
        ]);
        if (compiled.output.signal)
          return fail(program, "run", `it ended by ${compiled.output.signal}`, compiled.output, plain?.output);
        // The executable ran compiled code and did not fall back to the source it holds.
        if (!compiled.output.stderr.includes("[aot] module: "))
          return fail(program, "run", "it did not run compiled code", compiled.output, plain?.output);
        compiled.output.stderr = compiled.output.stderr.replace(/^\[aot\] .*\r?\n/gm, "");
        const passes = { state: "pass", compileMs, runMs: compiled.ms };
        if (stored !== undefined) {
          if (asText(compared(compiled.output)) === stored) return settle(program, passes);
          return fail(program, "compare", "it does not print what its last comment says", compiled.output, {
            exitCode: null,
            signal: null,
            stdout: stored,
            stderr: "",
          });
        }
        if (plain!.output.exitCode !== program.exitCode)
          return fail(
            program,
            "reference",
            `the reference ended with ${plain!.output.signal ?? `exit code ${plain!.output.exitCode}`}, not with ${program.exitCode}: see \`// Exit code:\``,
            compiled.output,
            plain!.output,
          );
        if (Bun.deepEquals(compared(compiled.output), compared(plain!.output)))
          settle(program, { ...passes, plainMs: plain!.ms });
        else fail(program, "compare", "it does not exit and print as plain Bun does", compiled.output, plain!.output);
      }),
    );
  } finally {
    rmSync(executable, { force: true });
  }
}

const refusal = /^error: --aot ((?:only supports|isn't available) .*)$/m.exec(
  Bun.spawnSync([process.execPath, "build", "--compile", "--aot", "./no-such-file.ts"], {
    cwd: root,
  }).stderr.toString(),
)?.[1];
const isCanary = Bun.spawnSync([process.execPath, "--revision"]).stdout.toString().includes("-canary");
/** Two programs of one line in one executable: does the second start when it is named? A Bun built with a locked environment does not read the variable. */
function startsWhereItIsTold() {
  for (const name of ["first", "second"]) writeFileSync(join(folder, `${name}.js`), `console.log("${name}");\n`);
  const probe = join(folder, `probe${process.platform === "win32" ? ".exe" : ""}`);
  Bun.spawnSync(
    [
      process.execPath,
      "build",
      "--compile",
      "--aot",
      "--aot-separate-programs",
      `--root=${folder}`,
      "./first.js",
      "./second.js",
      "--outfile",
      probe,
    ],
    { cwd: folder },
  );
  const said = Bun.spawnSync([probe], { env: { ...process.env, BUN_AOT_START_AT: "second.js" } }).stdout.toString();
  for (const name of ["first.js", "second.js", probe]) rmSync(join(folder, name), { force: true });
  return said.trim() === "second";
}
const whySkipped = refusal
  ? `--aot ${refusal}`
  : !isCanary
    ? "only a canary build of Bun reads BUN_AOT_START_AT"
    : startsWhereItIsTold()
      ? undefined
      : "this Bun does not read BUN_AOT_START_AT";
if (whySkipped) {
  for (const file of files) say({ file, state: "skip", message: whySkipped });
  process.exit(0);
}

// What a Worker starts from is compiled with the program that starts it, so such a program has a build of its own.
const startsWorkers = (program: Program) =>
  /\bWorker\b|worker_threads|\bcluster\b/.test(readFileSync(program.path, "utf8"));
// A flag of the bundler changes what the files of a build are and where they are looked for, and a flag that is a path is read in the folder of the program.
const isBuiltAlone = (program: Program) =>
  program.isAlone ||
  program.comparesWithCompiled ||
  program.entryPoints.length > 0 ||
  program.statistics.length > 0 ||
  program.buildErrors !== undefined ||
  program.flags.some(flag => !flag.startsWith("--aot")) ||
  startsWorkers(program);
const isTypeScript = (name: string) => /\.(ts|tsx|mts|cts)$/.test(name) && !/\.d\.[mc]?ts$/.test(name);
const hasTypes = ({ path }: Program) =>
  /[\\/]main\.[a-z]+$/.test(path)
    ? readdirSync(dirname(path), { recursive: true, encoding: "utf8" }).some(isTypeScript)
    : isTypeScript(path);
const asWritten = files.map(read);
const all = [
  ...asWritten,
  ...(erases
    ? asWritten
        .filter(program => program.isBuiltErased && program.buildErrors === undefined && hasTypes(program))
        .map(program => ({ ...program, way: "erased" as const }))
    : []),
];
for (const { file } of all) waysLeft.set(file, (waysLeft.get(file) ?? 0) + 1);
// Two entry points that differ in the extension alone have one name in an executable.
const withoutExtension = (path: string) => path.replace(/\.[a-z]+$/, "");
const twins = Map.groupBy(asWritten, program => withoutExtension(program.path));
const groups = Map.groupBy(all, program =>
  JSON.stringify([
    program.way,
    program.flags,
    nearestProject(program.path),
    isBuiltAlone(program) && program.path,
    twins.get(withoutExtension(program.path))!.findIndex(({ path }) => path === program.path),
  ]),
);
const batches = [...groups.values()].flatMap(group => {
  const size = Math.ceil(group.length / Math.ceil(group.length / programsInOneExecutable));
  return Array.from({ length: Math.ceil(group.length / size) }, (_, index) =>
    group.slice(index * size, (index + 1) * size),
  );
});
await Promise.all(batches.map(run));
rmSync(folder, { recursive: true, force: true });
process.exit(hasFailed ? 1 : 0);
