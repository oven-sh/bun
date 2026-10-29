// Does a program compile to the same machine code however its property names are spelled? `x.name`, `x["name"]` and x[`name`] are one access; `{ name: 1 }`, `{ "name": 1 }` and `{ ["name"]: 1 }` are one property.
//
//   bun test/aot/tools/same-code-in-every-spelling.ts [--bun <bun>] [--jobs 16] [--show 20] [--build-flag <flag>].. <program or folder>..
//
// A program is one file, or a folder with a `main.*`. ./respell-property-names.ts writes it in each spelling, each is built in a folder of the same name, and the machine code is compared function by function:
// the n-th function of a name in a file with the n-th of that name, because the text moves and so do the positions. Tables of positions and the text of functions are data, and are not compared.
// It prints one line for each program that differs, with the first functions that do, and exits with 1 if there is any.
// To find the place: `respell-property-names.ts computed --only=<form>` respells one form of name, `--names=` one name, `--in= --places=` one place.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import "../harness/without-installing-packages";
import { basename, join, resolve } from "path";
import { parseArgs } from "util";
import { packedFiles, writeProgram } from "../generate";
import { respellFiles, spellings, type Spelling } from "./respell-property-names";
import { codeOfImage } from "./same-output";

type Built = { functions: Map<string, { size: number; hash: string }>; output: string; failure?: string };
/** One way to write a program: `rewrite` changes the files of a folder in place. */
export type Form = { name: string; rewrite(folder: string): void };
export type Difference = { program: string; form: string; what: string; functions: string[] };
/** `entry`: the file to build, where the program is a folder without a `main.*`. `runs: false`: the code alone is compared, not what the program prints. */
export type Comparison = { flags?: string[]; entry?: string; runs?: boolean };

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

/** Where the program `<topic>/<file or folder>` of ../programs lies. One that a `*.programs` file of its topic holds is written into `folder`. */
export function storedProgram(program: string, folder: string) {
  const stored = join(import.meta.dir, "..", "parallel", program);
  if (existsSync(stored)) return stored;
  const [topic, name] = [program.slice(0, program.indexOf("/")), program.slice(program.indexOf("/") + 1)];
  const packed = packedFiles(topic);
  const paths = Object.keys(packed).filter(path => path === name || path.startsWith(`${name}/`));
  writeProgram(join(folder, "stored"), {
    entry: "",
    files: Object.fromEntries(paths.map(path => [path, packed[path]])),
  });
  return join(folder, "stored", name);
}

const entryOf = (folder: string) => readdirSync(folder).find(name => /^main\.([cm]?[jt]s|tsx)$/.test(name));

async function build(bun: string, program: string, form: Form, work: string, comparison: Comparison): Promise<Built> {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const source = join(work, "source");
  const isFolder = statSync(program).isDirectory();
  cpSync(program, isFolder ? source : join(source, basename(program)), { recursive: true });
  form.rewrite(source);
  const entry = comparison.entry ?? (isFolder ? entryOf(source)! : basename(program));
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
    const flags = comparison.flags ?? [];
    const built = await run([bun, "build", "--compile", "--aot", ...flags, entry, "--outfile", executable], {
      BUN_JSC_aotMapFilePath: map,
    });
    if (built.exitCode !== 0) return { functions: new Map(), output: "", failure: built.text.replaceAll(work, "") };
    const ran = comparison.runs === false ? undefined : await run([executable]);
    return {
      functions: functionsByOrder(readFileSync(map, "latin1"), codeOfImage(readFileSync(executable))),
      output: ran ? `${ran.text}exit ${ran.exitCode}` : "",
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Builds the program in each form and compares each with the first. */
export async function compareForms(
  bun: string,
  program: string,
  work: string,
  forms: readonly Form[],
  comparison: Comparison = {},
) {
  const differences: Difference[] = [];
  // Every build uses a folder of the same name, one after the other: a path of another length is another program.
  const first = await build(bun, program, forms[0], join(work, "build"), comparison);
  for (const form of forms.slice(1)) {
    const other = await build(bun, program, form, join(work, "build"), comparison);
    const differs = (what: string, functions: string[] = []) =>
      differences.push({ program, form: form.name, what, functions });
    if (first.failure || other.failure) {
      if (!first.failure !== !other.failure)
        differs(
          `builds only as ${first.failure ? form.name : forms[0].name}: ${(first.failure ?? other.failure)!.trim().split("\n")[0]}`,
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
      differs(`${functions.length} of ${other.functions.size} functions differ from ${forms[0].name}`, functions);
    else if (first.output !== other.output) differs(`prints something else than ${forms[0].name}`);
  }
  return differences;
}

export const compareSpellings = (
  bun: string,
  program: string,
  work: string,
  flags: string[] = [],
  asked: readonly Spelling[] = spellings,
) =>
  compareForms(
    bun,
    program,
    work,
    asked.map(spelling => ({ name: spelling, rewrite: folder => void respellFiles(folder, spelling) })),
    { flags },
  );

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

/** The command line of a tool that compares forms: `[--bun <bun>] [--jobs 16] [--show 20] [--build-flag <flag>].. <program or folder>..` */
export async function compareFromCommandLine(tool: string, forms: readonly Form[], same: string, runs = true) {
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
    console.error(`usage: bun test/aot/tools/${tool} [--bun <bun>] <program or folder>..`);
    process.exit(2);
  }
  const programs = positionals.flatMap(path => programsIn(resolve(path)));
  const work = mkdtempSync(join(tmpdir(), "every-form-"));
  const differences: Difference[] = [];
  const waiting = [...programs.entries()];
  await Promise.all(
    Array.from({ length: Number(options.jobs) }, async () => {
      for (let next = waiting.shift(); next; next = waiting.shift())
        differences.push(
          ...(await compareForms(resolve(options.bun), next[1], join(work, String(next[0]).padStart(6, "0")), forms, {
            flags: options["build-flag"],
            runs,
          })),
        );
    }),
  );
  rmSync(work, { recursive: true, force: true });
  for (const { program, form, what, functions } of differences.sort((a, b) => (a.program < b.program ? -1 : 1))) {
    console.log(`${program}: ${form}: ${what}`);
    for (const name of functions.slice(0, Number(options.show))) console.log(`    ${name}`);
  }
  const differing = new Set(differences.map(difference => difference.program)).size;
  console.log(
    differing ? `${differing} of ${programs.length} programs differ` : `${same}: ${programs.length} programs`,
  );
  process.exit(differing ? 1 : 0);
}

if (import.meta.main)
  await compareFromCommandLine(
    "same-code-in-every-spelling.ts",
    spellings.map(spelling => ({ name: spelling, rewrite: folder => void respellFiles(folder, spelling) })),
    "THE SAME CODE IN EVERY SPELLING",
  );
