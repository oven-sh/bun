// Does a program compile to the same machine code however its property names are spelled? `x.name`, `x["name"]` and x[`name`] are one access; `{ name: 1 }`, `{ "name": 1 }` and `{ ["name"]: 1 }` are one property.
//
//   bun test/aot/tools/same-code-in-every-spelling.ts [--bun <bun>] [--jobs 16] [--show 20] [--build-flag <flag>].. <program or folder>..
//
// A program is one file, or a folder with a `main.*`. ./respell-property-names.ts writes it in each spelling, each is built in a folder of the same name, and the machine code is compared function by function:
// the n-th function of a name in a file with the n-th of that name, because the text moves and so do the positions. Tables of positions and the text of functions are data, and are not compared.
// It prints one line for each program that differs, with the first functions that do, and exits with 1 if there is any.
// To find the place: `respell-property-names.ts computed --only=<form>` respells one form of name, `--names=` one name, `--in= --places=` one place.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import { basename, join, resolve } from "path";
import { parseArgs } from "util";
import { respellFiles, spellings, type Spelling } from "./respell-property-names";
import { codeOfImage } from "./same-output";

type Built = { functions: Map<string, { size: number; hash: string }>; output: string; failure?: string };
export type Difference = { program: string; spelling: Spelling; what: string; functions: string[] };

const hashOf = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);

/** Rows `F` of the map: number, offset, size, .., name (7), role (8), .., path (10), position (11). The position is left out of the key. */
export function functionsByOrder(map: string, code: Buffer) {
  const functions = new Map<string, { size: number; hash: string }>();
  const seen = new Map<string, number>();
  for (const line of map.split("\n")) {
    if (!line.startsWith("F\t")) continue;
    const fields = line.split("\t");
    const [offset, size] = [Number(fields[2]), Number(fields[3])];
    const name = `${fields[7] || "-"} (${fields[8]}) ${basename(fields[10] ?? "")}`;
    const copy = (seen.get(name) ?? 0) + 1;
    seen.set(name, copy);
    functions.set(copy === 1 ? name : `${name} #${copy}`, { size, hash: hashOf(code.subarray(offset, offset + size)) });
  }
  return functions;
}

const entryOf = (folder: string) => readdirSync(folder).find(name => /^main\.([cm]?[jt]s|tsx)$/.test(name));

async function build(bun: string, program: string, spelling: Spelling, work: string, flags: string[]): Promise<Built> {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const source = join(work, "source");
  const isFolder = statSync(program).isDirectory();
  cpSync(program, isFolder ? source : join(source, basename(program)), { recursive: true });
  respellFiles(source, spelling);
  const entry = isFolder ? entryOf(source)! : basename(program);
  const executable = join(work, process.platform === "win32" ? "program.exe" : "program");
  const map = join(work, "program.map");
  const env = { PATH: process.env.PATH, HOME: work, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1" };
  const run = async (cmd: string[], more: Record<string, string> = {}) => {
    await using child = Bun.spawn({
      cmd,
      cwd: source,
      env: { ...env, ...more },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    return { text: stdout + stderr, exitCode };
  };
  try {
    const built = await run([bun, "build", "--compile", "--aot", ...flags, entry, "--outfile", executable], {
      BUN_JSC_aotMapFilePath: map,
    });
    if (built.exitCode !== 0) return { functions: new Map(), output: "", failure: built.text.replaceAll(work, "") };
    const ran = await run([executable]);
    return {
      functions: functionsByOrder(readFileSync(map, "latin1"), codeOfImage(readFileSync(executable))),
      output: `${ran.text}exit ${ran.exitCode}`,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Builds the program in each spelling and compares each with the first. */
export async function compareSpellings(
  bun: string,
  program: string,
  work: string,
  flags: string[] = [],
  asked: readonly Spelling[] = spellings,
) {
  const differences: Difference[] = [];
  // Every build uses a folder of the same name, one after the other: a path of another length is another program.
  const first = await build(bun, program, asked[0], join(work, "build"), flags);
  for (const spelling of asked.slice(1)) {
    const other = await build(bun, program, spelling, join(work, "build"), flags);
    const differs = (what: string, functions: string[] = []) =>
      differences.push({ program, spelling, what, functions });
    if (first.failure || other.failure) {
      if (!first.failure !== !other.failure)
        differs(
          `builds only as ${first.failure ? spelling : asked[0]}: ${(first.failure ?? other.failure)!.trim().split("\n")[0]}`,
        );
      continue;
    }
    const functions: string[] = [];
    for (const [name, { size, hash }] of other.functions) {
      const written = first.functions.get(name);
      if (!written) functions.push(`new: ${name}`);
      else if (written.size !== size) functions.push(`${written.size} > ${size} bytes: ${name}`);
      else if (written.hash !== hash) functions.push(`bytes only: ${name}`);
    }
    for (const name of first.functions.keys()) if (!other.functions.has(name)) functions.push(`gone: ${name}`);
    if (functions.length)
      differs(`${functions.length} of ${other.functions.size} functions differ from ${asked[0]}`, functions);
    else if (first.output !== other.output) differs(`prints something else than ${asked[0]}`);
  }
  return differences;
}

function programsIn(path: string): string[] {
  if (!statSync(path).isDirectory() || entryOf(path)) return [path];
  return readdirSync(path)
    .filter(
      name =>
        statSync(join(path, name)).isDirectory() || (/\.([cm]?[jt]s|tsx)$/.test(name) && !/\.d\.[cm]?ts$/.test(name)),
    )
    .flatMap(name => programsIn(join(path, name)))
    .sort();
}

if (import.meta.main) {
  const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      bun: { type: "string", default: process.execPath },
      jobs: { type: "string", default: String(availableParallelism()) },
      show: { type: "string", default: "20" },
      "build-flag": { type: "string", multiple: true, default: [] },
    },
  });
  if (!positionals.length) {
    console.error("usage: bun test/aot/tools/same-code-in-every-spelling.ts [--bun <bun>] <program or folder>..");
    process.exit(2);
  }
  const programs = positionals.flatMap(path => programsIn(resolve(path)));
  const work = mkdtempSync(join(tmpdir(), "every-spelling-"));
  const differences: Difference[] = [];
  const waiting = [...programs.entries()];
  await Promise.all(
    Array.from({ length: Number(options.jobs) }, async () => {
      for (let next = waiting.shift(); next; next = waiting.shift())
        differences.push(
          ...(await compareSpellings(
            resolve(options.bun),
            next[1],
            join(work, String(next[0]).padStart(6, "0")),
            options["build-flag"],
          )),
        );
    }),
  );
  rmSync(work, { recursive: true, force: true });
  for (const { program, spelling, what, functions } of differences.sort((a, b) => (a.program < b.program ? -1 : 1))) {
    console.log(`${program}: ${spelling}: ${what}`);
    for (const name of functions.slice(0, Number(options.show))) console.log(`    ${name}`);
  }
  const differing = new Set(differences.map(difference => difference.program)).size;
  console.log(
    differing
      ? `${differing} of ${programs.length} programs differ`
      : `THE SAME CODE IN EVERY SPELLING: ${programs.length} programs`,
  );
  process.exit(differing ? 1 : 0);
}
