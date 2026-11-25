// Does the machine code of a program depend on how the work of its build falls on the threads?
//
//   bun test/aot/tools/same-code-under-every-schedule.ts [<program or folder>..] [--bun <bun>] [--threads 1,16,64] [--again] [--jobs 8] [--from <file>] [--same <file>]
//
// A build is a function of its sources and flags. Each program is built on two threads and on each number of `--threads` (t1, t16, t64), and the code in its image is
// compared with that of the build on two.
// It prints one line for each program whose code moves: in which builds, and the first function that differs, where the compiler wrote a map of the image. It exits with 1 if there is any.
// Behind them a table: where they move first, by file, by kind, by function, and in how many of the builds.
// `--same <file>` writes the programs whose code stays the same, one path a line, from the folder of the stored programs. `--from <file>` takes the programs that such a file lists.
// `--again` builds on two threads once more: code that moves there follows something else than the number of threads.
//
// Without programs it takes the stored programs of ../parallel. A folder stands for the programs in it as scripts/runner.node.ts finds them: a folder with a main file is one.
// Left out: a program that says how it is built (`// Flags:`, `// Entry points:`, `// Alone:` and the like), and one that does not build on two threads.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
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

/** It comes first: the others are compared with it. */
export const usual: Way = { name: "usual", flags: [] };

export const threadCounts = (counts: number[]): Way[] =>
  counts.map(threads => ({ name: `t${threads}`, flags: [], threads }));

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

/**
 * Rows `T`: offset, name. Several may begin at one offset, and a row `TN` repeats the offset of a stub that never returns.
 * A stub ends where the next row behind its offset or the first function begins.
 */
export function stubsOf(map: string, code: Buffer): Pieces {
  const rows = map.split("\n").map(line => line.split("\t"));
  const starts = rows
    .filter(([kind]) => kind === "T" || kind === "TN")
    .map(([, offset, name]) => ({ offset: Number(offset), name }));
  const end = Math.min(code.length, ...rows.filter(([kind]) => kind === "F").map(fields => Number(fields[2])));
  starts.sort((a, b) => a.offset - b.offset);
  const offsets = [...new Set(starts.map(({ offset }) => offset))];
  const endOf = new Map(offsets.map((offset, index) => [offset, offsets[index + 1] ?? end]));
  const stubs: Pieces = new Map();
  for (const { offset, name } of starts) {
    if (name === undefined) continue;
    let key = name;
    for (let copy = 2; stubs.has(key); copy++) key = `${name} #${copy}`;
    const bytes = code.subarray(offset, endOf.get(offset));
    stubs.set(key, { size: bytes.length, hash: hashOf(bytes) });
  }
  return stubs;
}

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

/** The map describes one image, so which function lies in which of several is not told. */
const hasSeveralImages = new Set<string>();

/** Nothing for a build that fails, or whose executable does not hold one image. */
async function build(
  bun: string,
  root: string,
  program: string,
  work: string,
  { flags, threads = 2, env = {} }: Way,
): Promise<Code | undefined> {
  mkdirSync(work, { recursive: true });
  const executable = join(work, process.platform === "win32" ? "program.exe" : "program");
  const map = join(work, "map");
  try {
    await using child = Bun.spawn({
      cmd: [bun, "build", "--compile", "--aot", `--root=${root}`, `--aot-threads=${threads}`, ...flags, "./" + program, "--outfile", executable], // prettier-ignore
      cwd: root,
      env: { PATH: process.env.PATH, HOME: work, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_JSC_aotMapFilePath: map, ...env }, // prettier-ignore
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await child.exited) !== 0) return undefined;
    const codes = codeOfImages(readFileSync(executable));
    if (codes.length > 1) hasSeveralImages.add(program);
    if (codes.length !== 1) return undefined;
    const [code] = codes;
    const rows = existsSync(map) ? readFileSync(map, "latin1") : "";
    return { whole: hashOf(code), functions: functionsOf(rows, code), stubs: stubsOf(rows, code) };
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
 * `programs` are paths from `root`. Each is built alone in every way, and compared with the first. At most `jobs` builds run at once.
 * `notBuilt`: those that the first way does not build. `onSettled` hears of each program as soon as its builds are compared.
 */
export async function findMovedCode(
  bun: string,
  root: string,
  programs: string[],
  ways: Way[],
  work: string,
  jobs: number,
  onSettled: (program: string, verdict: Moved | "same" | "not built") => void = () => {},
) {
  free = jobs;
  const moved: Moved[] = [];
  const notBuilt: string[] = [];
  async function compare(program: string, number: number): Promise<void> {
    // Every build has a folder whose name is as long as that of any other: a path of another length is another program.
    const folder = join(work, String(number).padStart(6, "0"));
    const [first, ...others] = await Promise.all(
      ways.map((way, index) =>
        inTurn(() => build(bun, root, program, join(folder, String(index).padStart(3, "0")), way)),
      ),
    );
    rmSync(folder, { recursive: true, force: true });
    if (!first) {
      notBuilt.push(program);
      return onSettled(program, "not built");
    }
    const differences = others.map(other => (other ? firstDifference(first, other) : "it does not build"));
    const under = ways.slice(1).filter((_, index) => differences[index]).map(({ name }) => name); // prettier-ignore
    if (under.length) moved.push({ program, under, first: differences.find(Boolean)! });
    onSettled(program, under.length ? moved.at(-1)! : "same");
  }
  await Promise.all(programs.map(compare));
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
      threads: { type: "string", default: "1,16,64" },
      jobs: { type: "string", default: String(Math.min(8, availableParallelism())) },
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
    usual,
    ...threadCounts(numbersIn(options.threads)),
    ...(options.again ? [{ name: "again", flags: [] }] : []),
  ];
  // A line as soon as a program is settled: a run over thousands that is cut short has said what it knew.
  if (options.same) writeFileSync(options.same, "");
  const { moved, notBuilt } = await findMovedCode(resolve(options.bun), storedPrograms, programs, ways, work, Number(options.jobs), (program, verdict) => {
    if (verdict === "same") return void (options.same && appendFileSync(options.same, program + "\n"));
    if (verdict === "not built") return console.log(`${program}: ${hasSeveralImages.has(program) ? "its executable holds several images: not compared" : "it does not build"}`); // prettier-ignore
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
