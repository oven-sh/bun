// Do two builds of Bun compile programs to the same thing? For a change that is meant to change nothing: a refactoring, a clean-up, a faster analysis.
//
//   bun test/aot/tools/same-output.ts --before <bun> --after <bun> [<program or folder>..] [--jobs 16] [--build-flag <flag>].. [--show 20]
//
// Each program is built with both Buns, from the same folder. Compared are
//   the IR         what the front end hands to the engine (`--aot-out`). If it differs, the change is in src/aot or src/sema.
//   the code       the machine code in the executable's image, function by function (the compiler's map says where each one lies).
// It prints one line for each program that differs, with the first functions that do, and exits with 1 if there is any.
// Without programs it takes the small benchmarks of ../perf/idioms, 260 programs in a minute on sixteen cores. A folder stands for every .ts, .tsx, .js and .mjs file in it.
// Give it large programs too (a server with its packages): most of the compiler's decisions depend on the size of the program.
//
// What the answer means:
//   - A function whose code moved calls its neighbors at other distances. So behind one function that grew, many differ "in bytes only": the list puts those that changed size first.
//   - The same output on these programs is no proof that a change is sound. Deleting the "I don't know" case of an analysis leaves all output the same if no program here reaches it.
//   - x64 and arm64, ELF and Mach-O: the image is found by its first bytes.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";
import { parseArgs } from "util";

type Built = { ir: string; functions: Map<string, { size: number; hash: string }>; failure?: string };
export type Difference = { program: string; what: string; functions: string[] };

const hashOf = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);

/** The machine code of the image inside an executable. The image begins with eight known bytes; its header holds its size and where its code lies. */
export function codeOfImage(executable: Buffer): Buffer {
  for (let at = executable.indexOf("BUNAOT01", 0, "latin1"); at >= 0; at = executable.indexOf("BUNAOT01", at + 1, "latin1")) {
    if (at + 64 > executable.length) break;
    const imageSize = Number(executable.readBigUInt64LE(at + 32));
    const codeOffset = Number(executable.readBigUInt64LE(at + 40));
    const codeSize = Number(executable.readBigUInt64LE(at + 48));
    if (imageSize > 0 && codeOffset > 0 && codeOffset + codeSize <= imageSize && at + imageSize <= executable.length)
      return executable.subarray(at + codeOffset, at + codeOffset + codeSize);
  }
  throw new Error("The executable holds no compiled image");
}

/** Rows `F` of the map: number, offset, size, .., name (7), role (8), .., path (10), position (11). */
export function functionsOf(map: string, code: Buffer) {
  const functions = new Map<string, { size: number; hash: string }>();
  for (const line of map.split("\n")) {
    if (!line.startsWith("F\t")) continue;
    const fields = line.split("\t");
    const [offset, size] = [Number(fields[2]), Number(fields[3])];
    let key = `${fields[7] || "-"} (${fields[8]}) ${basename(fields[10] ?? "")}:${fields[11] ?? ""}`;
    for (let copy = 2; functions.has(key); copy++) key = `${key.replace(/ #\d+$/, "")} #${copy}`;
    functions.set(key, { size, hash: hashOf(code.subarray(offset, offset + size)) });
  }
  return functions;
}

async function build(bun: string, program: string, work: string, flags: string[]): Promise<Built> {
  mkdirSync(work, { recursive: true });
  const [executable, ir, map] = ["program", "program.ir", "program.map"].map(name => join(work, name));
  await using child = Bun.spawn({
    cmd: [bun, "build", "--compile", "--aot", ...flags, `--aot-out=${ir}`, program, "--outfile", executable],
    cwd: dirname(program),
    env: { PATH: process.env.PATH, HOME: work, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", BUN_JSC_aotMapFilePath: map },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  try {
    // A build that fails the same way on both sides is the same output.
    if (exitCode !== 0) return { ir: "", functions: new Map(), failure: hashOf((stdout + stderr).replaceAll(work, "")) };
    const parts = readdirSync(work).filter(name => name.startsWith("program.ir")).sort(); // prettier-ignore
    return {
      ir: hashOf(parts.map(name => hashOf(readFileSync(join(work, name)))).join()),
      functions: functionsOf(readFileSync(map, "latin1"), codeOfImage(readFileSync(executable))),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function compareProgram(before: string, after: string, program: string, work: string, flags: string[] = []): Promise<Difference | undefined> {
  // Both builds use a folder of the same name, one after the other: a path of another length is another program.
  const was = await build(before, program, join(work, "build"), flags);
  const is = await build(after, program, join(work, "build"), flags);
  if (was.failure || is.failure)
    return was.failure === is.failure ? undefined : { program, what: was.failure && is.failure ? "fails with another message" : was.failure ? "builds now" : "no longer builds", functions: [] }; // prettier-ignore
  const resized: string[] = [];
  const rewritten: string[] = [];
  for (const [name, { size, hash }] of is.functions) {
    const then = was.functions.get(name);
    if (!then) resized.push(`new: ${name}`);
    else if (then.size !== size) resized.push(`${then.size} > ${size} bytes: ${name}`);
    else if (then.hash !== hash) rewritten.push(`bytes only: ${name}`);
  }
  for (const name of was.functions.keys()) if (!is.functions.has(name)) resized.push(`gone: ${name}`);
  if (was.ir === is.ir && !resized.length && !rewritten.length) return undefined;
  const what = `${was.ir === is.ir ? "the same IR" : "another IR"}; of ${is.functions.size} functions ${resized.length} new, gone or of another size, ${rewritten.length} of the same size with other bytes`;
  return { program, what, functions: [...resized, ...rewritten] };
}

function programsIn(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { recursive: true })
    .map(String)
    .filter(name => /\.(ts|tsx|js|mjs)$/.test(name) && !/\.d\.ts$|(^|\/)(node_modules|host\.ts)/.test(name))
    .map(name => join(path, name))
    .sort();
}

if (import.meta.main) {
  const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      before: { type: "string" },
      after: { type: "string" },
      jobs: { type: "string", default: String(availableParallelism()) },
      show: { type: "string", default: "20" },
      "build-flag": { type: "string", multiple: true, default: [] },
    },
  });
  if (!options.before || !options.after) {
    console.error("usage: bun test/aot/tools/same-output.ts --before <bun> --after <bun> [<program or folder>..]");
    process.exit(2);
  }
  const programs = (positionals.length ? positionals : [join(import.meta.dir, "..", "perf", "idioms")]).flatMap(path => programsIn(resolve(path)));
  const work = mkdtempSync(join(tmpdir(), "same-output-"));
  const differences: Difference[] = [];
  const waiting = [...programs.entries()];
  await Promise.all(
    Array.from({ length: Number(options.jobs) }, async () => {
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const difference = await compareProgram(resolve(options.before!), resolve(options.after!), next[1], join(work, String(next[0]).padStart(6, "0")), options["build-flag"]); // prettier-ignore
        if (difference) differences.push(difference);
      }
    }),
  );
  rmSync(work, { recursive: true, force: true });
  for (const { program, what, functions } of differences.sort((a, b) => (a.program < b.program ? -1 : 1))) {
    console.log(`${program}: ${what}`);
    for (const name of functions.slice(0, Number(options.show))) console.log(`    ${name}`);
  }
  console.log(differences.length ? `${differences.length} of ${programs.length} programs differ` : `IDENTICAL: ${programs.length} programs`);
  process.exit(differences.length ? 1 : 0);
}
