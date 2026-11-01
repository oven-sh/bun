// Does the machine code of a program hang on the order in which the rules of flow analysis run?
//
//   bun test/aot/tools/same-code-under-every-schedule.ts [<program or folder>..] [--bun <bun>] [--schedules 8] [--numberings 0] [--threads 1,8] [--checker-passes 2,3] [--again] [--jobs 8] [--together 40] [--from <file>] [--same <file>] [--listed]
//
// What flow analysis finds is meant to follow from the program alone. `--aot-testing=DelayFlowRules:<n>` is another valid schedule of its rules for every n.
// Each program is built under the usual schedule and under the first `--schedules` others, and the code of every function is compared with that of the usual schedule.
// It prints one line for each program whose code moves: under which schedules, and the first function that differs. It exits with 1 if there is any.
// Behind them a table: where they move first, by file, by kind, by function, and under how many of the schedules.
// `--same <file>` writes the programs whose code stays the same, one path a line, from the folder of the stored programs.
// `--from <file>` takes the programs that a file lists, as `--same` writes them. Two such files lie beside the tests:
//   ../programs-with-the-same-code-under-every-schedule.txt   held under 255 schedules. The test beside it holds them.
//   ../programs-with-the-same-code-under-nine-schedules.txt   held under the usual schedule and eight others, on x64 and on arm64. Nothing holds them: the number of a
//                                                             schedule seeds a hash over the statements of the whole build, so each change to the compiler or the library
//                                                             deals new schedules, and of 404 of these programs 10 moved under 64. They are the ones to ask next.
// `--numberings <n>`: as many builds more in which flow analysis numbers the objects that the program makes in another order (`--aot-testing=ShuffleObjects:<n>`), named n0, n1 ..
// `--threads 1,8`: a build more on each of so many threads (t1, t8; every other build has two). `--checker-passes 2,3`: one in which the checker goes over the files in so many passes (p2, p3).
// `--again` builds under the usual schedule once more: code that moves there follows something else than the schedule.
//
// Without programs it takes the stored programs of ../parallel. A folder stands for the programs in it as scripts/runner.node.ts finds them: a folder with a main file is one.
// `--together` programs are the entry points of one executable (--aot-separate-programs): each is compiled as it is when it is built alone, and has an image and a map of its own.
// Left out: a program that says how it is built (`// Flags:`, `// Entry points:`, `// Alone:` and the like), and one that does not build under the usual schedule.
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import { join, relative, resolve } from "path";
import { parseArgs } from "util";
import { ownTemporaryFolder } from "../harness/temporary-folders";
import "../harness/without-installing-packages";
import { functionsOf } from "./same-output";

type Pieces = ReturnType<typeof functionsOf>;
type Code = { whole: string; functions: Pieces; stubs: Pieces };
export type Way = { name: string; flags: string[]; threads?: number; env?: Record<string, string> };
export type Moved = { program: string; under: string[]; first: string };

export const storedPrograms = resolve(import.meta.dir, "..", "parallel");

const programsListedIn = (file: string) =>
  readFileSync(resolve(import.meta.dir, "..", file), "utf8")
    .split("\n")
    .filter(Boolean);

/** The stored programs that are known to have the same code in every way, as paths from their folder. */
export const listedPrograms = () => programsListedIn("programs-with-the-same-code-under-every-schedule.txt");

export const programsAskedUnderNineSchedules = () =>
  programsListedIn("programs-with-the-same-code-under-nine-schedules.txt");

/** The usual schedule comes first: the others are compared with it. */
export const schedules = (others: number): Way[] => [
  { name: "usual", flags: [] },
  ...Array.from({ length: others }, (_, n) => ({ name: String(n), flags: [`--aot-testing=DelayFlowRules:${n}`] })),
];

export const numberings = (count: number): Way[] =>
  Array.from({ length: count }, (_, n) => ({ name: `n${n}`, flags: [`--aot-testing=ShuffleObjects:${n}`] }));

export const threadCounts = (counts: number[]): Way[] =>
  counts.map(threads => ({ name: `t${threads}`, flags: [], threads }));

export const checkerPasses = (counts: number[]): Way[] =>
  counts.map(passes => ({
    name: `p${passes}`,
    flags: [],
    env: { BUN_DEBUG_TEST_AOT_WORDS: `TestRunCheckerPasses:${passes}` },
  }));

const hashOf = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);

/** The machine code of each image inside an executable, in their order. An image begins with eight known bytes; its header holds its size and where its code lies. */
export function codeOfImages(executable: Buffer): Buffer[] {
  const found: Buffer[] = [];
  for (
    let at = executable.indexOf("BUNAOT01", 0, "latin1");
    at >= 0;
    at = executable.indexOf("BUNAOT01", at + 1, "latin1")
  ) {
    if (at + 64 > executable.length) break;
    const [imageSize, codeOffset, codeSize] = [32, 40, 48].map(field => Number(executable.readBigUInt64LE(at + field)));
    if (!(imageSize > 0 && codeOffset > 0 && codeOffset + codeSize <= imageSize && at + imageSize <= executable.length))
      continue;
    found.push(executable.subarray(at + codeOffset, at + codeOffset + codeSize));
    at += imageSize - 1;
  }
  return found;
}

/** Rows `T`: offset, name. A stub ends where the next stub, a row `TN` or the first function begins. */
export function stubsOf(map: string, code: Buffer): Pieces {
  const rows = map.split("\n").map(line => line.split("\t"));
  const starts = rows
    .filter(([kind]) => kind === "T" || kind === "TN")
    .map(([, offset, name]) => ({ offset: Number(offset), name }));
  const end = Math.min(code.length, ...rows.filter(([kind]) => kind === "F").map(fields => Number(fields[2])));
  starts.sort((a, b) => a.offset - b.offset);
  const stubs: Pieces = new Map();
  for (const [index, { offset, name }] of starts.entries()) {
    if (name === undefined) continue;
    let key = name;
    for (let copy = 2; stubs.has(key); copy++) key = `${name} #${copy}`;
    const bytes = code.subarray(offset, starts[index + 1]?.offset ?? end);
    stubs.set(key, { size: bytes.length, hash: hashOf(bytes) });
  }
  return stubs;
}

/** A row `F` ends with the path of the file as the program sees it, the position in it and a letter. Row `R`: where the functions end. */
const describes = (map: string, program: string, code: Buffer) =>
  map.includes(`/root/${program}\t`) && Number(/^R\t(\d+)$/m.exec(map)?.[1]) <= code.length;

let free = 1;
const waiting: (() => void)[] = [];
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
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

/** A file that a Worker starts from is a program with an image of its own, so which image is whose is not told. */
const hasSeveralImages = new Set<string>();

/** Nothing for a build that fails, or that does not give each program an image of its own. */
async function build(
  bun: string,
  root: string,
  programs: string[],
  work: string,
  { flags, threads = 2, env = {} }: Way,
): Promise<Map<string, Code> | undefined> {
  mkdirSync(work, { recursive: true });
  const executable = join(work, process.platform === "win32" ? "programs.exe" : "programs");
  const map = join(work, "map");
  try {
    await using child = Bun.spawn({
      cmd: [bun, "build", "--compile", "--aot", "--aot-separate-programs", `--root=${root}`, `--aot-threads=${threads}`, ...flags, ...programs.map(program => "./" + program), "--outfile", executable], // prettier-ignore
      cwd: root,
      env: { PATH: process.env.PATH, HOME: work, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_JSC_aotMapFilePath: map, ...env }, // prettier-ignore
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await child.exited) !== 0) return undefined;
    const codes = codeOfImages(readFileSync(executable));
    if (codes.length > 1 && programs.length === 1) hasSeveralImages.add(programs[0]);
    if (codes.length !== programs.length) return undefined;
    // The images lie in the order of the command line. The maps are numbered as the programs were compiled.
    const maps = codes.map((_, index) => readFileSync(index ? `${map}.${index}` : map, "latin1"));
    return new Map(
      programs.map((program, index) => {
        const code = codes[index];
        // A file that another program imports too stands in two maps. Built alone the program has one.
        const own = maps.filter(rows => describes(rows, program, code));
        const rows = own.length === 1 ? own[0] : "";
        return [program, { whole: hashOf(code), functions: functionsOf(rows, code), stubs: stubsOf(rows, code) }];
      }),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Behind one function that grew, many call their neighbors at other distances: one of another size comes first, and only those are counted. */
function firstDifference(usual: Code, other: Code): string | undefined {
  if (usual.whole === other.whole) return undefined;
  const first = firstPieceThatDiffers(usual, other);
  const names = new Set([...usual.functions.keys(), ...other.functions.keys()]);
  const resized = [...names].filter(name => usual.functions.get(name)?.size !== other.functions.get(name)?.size).length;
  return resized > 1 ? `${first}; ${resized} of ${names.size} functions are new, gone or of another size` : first;
}

function firstPieceThatDiffers(usual: Code, other: Code): string {
  for (const [what, was, is] of [
    ["", usual.functions, other.functions],
    ["stub ", usual.stubs, other.stubs],
  ] as const) {
    for (const [name, { size }] of was) {
      const now = is.get(name);
      if (!now) return `gone: ${what}${name}`;
      if (now.size !== size) return `${size} > ${now.size} bytes: ${what}${name}`;
    }
    for (const name of is.keys()) if (!was.has(name)) return `new: ${what}${name}`;
  }
  for (const [name, { hash }] of usual.functions)
    if (other.functions.get(name)!.hash !== hash) return `bytes only: ${name}`;
  for (const [name, { hash }] of usual.stubs)
    if (other.stubs.get(name)!.hash !== hash) return `bytes only: stub ${name}`;
  return usual.functions.size ? "the constants behind the code" : "no map tells which function";
}

/**
 * `programs` are paths from `root`. Each is built in every way, and compared with the first. At most `jobs` builds run at once.
 * `notBuilt`: those that the first way does not build. `onSettled` hears of each program as soon as its builds are compared.
 */
export async function findMovedCode(
  bun: string,
  root: string,
  programs: string[],
  ways: Way[],
  work: string,
  jobs: number,
  together = programs.length,
  onSettled: (program: string, verdict: Moved | "same" | "not built") => void = () => {},
) {
  free = jobs;
  const moved: Moved[] = [];
  const notBuilt: string[] = [];
  let folders = 0;
  async function compare(group: string[]): Promise<void> {
    // Every build has a folder whose name is as long as that of any other: a path of another length is another program.
    const folder = join(work, String(folders++).padStart(6, "0"));
    const built = await Promise.all(
      ways.map((way, index) =>
        inTurn(() => build(bun, root, group, join(folder, String(index).padStart(3, "0")), way)),
      ),
    );
    rmSync(folder, { recursive: true, force: true });
    if (built.includes(undefined) && group.length > 1) {
      const half = Math.ceil(group.length / 2);
      return void (await Promise.all([compare(group.slice(0, half)), compare(group.slice(half))]));
    }
    const [usual, ...others] = built;
    if (!usual) {
      notBuilt.push(group[0]);
      return onSettled(group[0], "not built");
    }
    for (const program of group) {
      const differences = others.map(other => (other ? firstDifference(usual.get(program)!, other.get(program)!) : "it does not build")); // prettier-ignore
      const under = ways.slice(1).filter((_, index) => differences[index]).map(({ name }) => name); // prettier-ignore
      if (under.length) moved.push({ program, under, first: differences.find(Boolean)! });
      onSettled(program, under.length ? moved.at(-1)! : "same");
    }
  }
  const groups = Array.from({ length: Math.ceil(programs.length / together) }, (_, index) =>
    programs.slice(index * together, (index + 1) * together),
  );
  await Promise.all(groups.map(compare));
  return { moved: moved.sort((a, b) => (a.program < b.program ? -1 : 1)), notBuilt: notBuilt.sort() };
}

/** The ruler while causes are stacked: not how many programs hold, but where the others move first. */
export function whereItMovesFirst(moved: Moved[], others: number): string {
  const count = (keys: string[], most = 12) => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    const sorted = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const rest = sorted.slice(most).reduce((sum, [, n]) => sum + n, 0);
    return sorted.slice(0, most).map(([key, n]) => `${n} ${key}`).join(" . ") + (rest ? ` . ${rest} in ${sorted.length - most} more` : ""); // prettier-ignore
  };
  // "132 > 161 bytes: set (generic-untyped) main.js:2397; 4 of 522 functions ..", "gone: stub BuiltinCell#84", "bytes only: .."
  const sites = moved.map(({ first }) => /^(?:[^:]*: )?(.*?)(?:; \d+ of \d+ functions.*)?$/.exec(first)![1]);
  const parts = sites.map(site => /^(.*) \(([\w -]+)\) (.*):(\d*)(?: #\d+)?$/.exec(site));
  const isOfLibrary = (role: string, file: string) => role.includes("library") || /^(?:internal|node|bun):/.test(file);
  return [
    `WHERE THE ${moved.length} MOVE FIRST`,
    `by file: ${count(parts.map((part, index) => (part ? part[3] : sites[index].startsWith("stub ") ? "stubs" : sites[index])))}`,
    `by kind: ${count(parts.map((part, index) => (part ? (isOfLibrary(part[2], part[3]) ? "the library" : "the program's own code") : sites[index].startsWith("stub ") ? "stubs" : "other")))}`,
    `by how: ${count(moved.map(({ first }) => (/^\d+ > \d+ bytes: /.test(first) ? "another size" : /^(gone|new|bytes only): /.exec(first)?.[1] ?? "other")))}`,
    `by function: ${count(sites, 20)}`,
    `under how many of the ${others} others: ${Array.from({ length: others }, (_, index) => `${index + 1}: ${moved.filter(({ under }) => under.length === index + 1).length}`).join(" . ")}`,
  ].join("\n"); // prettier-ignore
}

const isProgram = (name: string) => /\.[cm]?[jt]sx?$/.test(name) && !/\.d\.[cm]?ts$/.test(name);

function programsIn(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  const entries = readdirSync(path, { withFileTypes: true });
  const main = entries.find(entry => entry.isFile() && /^main\.[^.]+$/.test(entry.name) && isProgram(entry.name));
  if (main) return [join(path, main.name)];
  return entries
    .filter(({ name }) => !name.startsWith(".") && name !== "node_modules")
    .flatMap(entry =>
      entry.isDirectory() ? programsIn(join(path, entry.name)) : isProgram(entry.name) ? [join(path, entry.name)] : [],
    )
    .sort();
}

export function saysHowItIsBuilt(text: string) {
  const head = /^(?:#!.*\r?\n)?(?:\/\/.*\r?\n)*/.exec(text)![0];
  return (
    /^\/\/ (Flags|Entry points|Alone|Runs by itself|Env of the build|Todo[^:]*):/m.test(head) ||
    /\n\/\* Build errors:\r?\n/.test(text)
  );
}

if (import.meta.main) {
  const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      bun: { type: "string", default: process.execPath },
      schedules: { type: "string", default: "8" },
      numberings: { type: "string", default: "0" },
      threads: { type: "string", default: "" },
      "checker-passes": { type: "string", default: "" },
      jobs: { type: "string", default: String(Math.min(8, availableParallelism())) },
      together: { type: "string", default: "40" },
      again: { type: "boolean", default: false },
      from: { type: "string" },
      same: { type: "string" },
    },
  });
  const named = options.from
    ? readFileSync(options.from, "utf8").split("\n").filter(Boolean).map(program => join(storedPrograms, program)) // prettier-ignore
    : positionals;
  const all = (named.length ? named : [storedPrograms]).flatMap(path => programsIn(resolve(path)));
  const programs = all
    .filter(path => !saysHowItIsBuilt(readFileSync(path, "utf8")))
    .map(path => relative(storedPrograms, path));
  const work = ownTemporaryFolder(mkdtempSync(join(tmpdir(), "same-code-")));
  const numbersIn = (list: string) => list.split(",").filter(Boolean).map(Number);
  const ways = [
    ...schedules(Number(options.schedules)),
    ...numberings(Number(options.numberings)),
    ...threadCounts(numbersIn(options.threads)),
    ...checkerPasses(numbersIn(options["checker-passes"])),
    ...(options.again ? [{ name: "again", flags: [] }] : []),
  ];
  // A line as soon as a program is settled: a run over thousands that is cut short has said what it knew.
  if (options.same) writeFileSync(options.same, "");
  const { moved, notBuilt } = await findMovedCode(resolve(options.bun), storedPrograms, programs, ways, work, Number(options.jobs), Number(options.together), (program, verdict) => {
    if (verdict === "same") return void (options.same && appendFileSync(options.same, program + "\n"));
    if (verdict === "not built") return console.log(`${program}: ${hasSeveralImages.has(program) ? "it starts a Worker from a file, which has an image too: not compared" : "it does not build"}`); // prettier-ignore
    console.log(`${program}: under ${verdict.under.length} of ${ways.length - 1} (${verdict.under.join(" ")}): ${verdict.first}`);
  }); // prettier-ignore
  rmSync(work, { recursive: true, force: true });
  const unlike = new Set([...moved.map(({ program }) => program), ...notBuilt]);
  if (options.same) writeFileSync(options.same, programs.filter(program => !unlike.has(program)).map(program => program + "\n").join("")); // prettier-ignore
  const compared = programs.length - notBuilt.length;
  console.log(
    `${compared - moved.length} of ${compared} programs have the same code in ${ways.length} builds (${ways.map(({ name }) => name).join(" ")}); ` +
      `${all.length - programs.length} say how they are built and ${notBuilt.length} do not build: not compared`,
  );
  if (moved.length > 1) console.log(whereItMovesFirst(moved, ways.length - 1));
  process.exit(moved.length ? 1 : 0);
}
