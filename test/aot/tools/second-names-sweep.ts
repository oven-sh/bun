// Runs ../harness/second-names.ts over stored programs, each variant built ALONE, and says what came of it, a line each:
//
//   bun test/aot/tools/second-names-sweep.ts --compiler=<bun> [--plain=<bun>] [--kind=list|object|collection] [--jobs=8] [--variants=6|all] [--taken] [--observes]
//     [--control=<sabotage word>,<word>..] [--fifth] [--keep=<folder>] <folders or files ..>
//
// refused   the compiler's own look at the end (BUN_JSC_verifyAOTProgram=1) stops the build: THE FIND, whatever the program would have printed
// aborted   the build dies
// differs   the executable does not print and exit as plain Bun does with the same text
// same      neither
// void      the text that was made is no judge: plain Bun prints something else than for the program as it was stored (only without --taken), runs into the time limit or prints
//           something else when it is asked again, or the build refuses the text as it refuses a mistake of the program's author
// Programs that are refused, aborted or differ as they are stored are left out and counted. So are, with --taken, those that import bun:jsc: they print how the engine keeps a list,
// which follows what earlier lists of the same place went through.
// --control: each variant that is the same is built once more under each of these words of --aot-sabotage: `sees` if one of those builds is refused or dies or its
// executable differs, `blind` if none. A count of `same` is worth as much as its `sees`.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { hashOf, variantsFor, withSecondNames, type Kind } from "../harness/second-names";
import { withoutInstallingPackages } from "../harness/without-installing-packages";

const words = process.argv.slice(2);
const option = (name: string) => words.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string) => words.includes(`--${name}`);
const compiler = resolve(option("compiler") ?? process.execPath);
const plain = resolve(option("plain") ?? process.execPath);
const jobs = Number(option("jobs") ?? 8);
const kind = (option("kind") ?? "list") as Kind;
const control = option("control")?.split(",");
const numberOfVariants = option("variants") === "all" ? Infinity : Number(option("variants") ?? 6);
const isProgram = (name: string) => /\.(js|mjs|cjs|ts|mts|cts)$/.test(name) && !/\.d\.ts$/.test(name);

const programs = words
  .filter(word => !word.startsWith("--"))
  .flatMap(path => (statSync(path).isDirectory() ? readdirSync(path).filter(isProgram).map(name => join(path, name)) : [path]))
  .map(path => resolve(path))
  .filter(path => !has("fifth") || hashOf(basename(path)) % 5 === 0)
  .sort();

const env = { ...process.env, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" } as Record<string, string>;
delete env.BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING;

async function run(cmd: string[], cwd: string, more: Record<string, string> = {}, seconds = 60) {
  const child = Bun.spawn(cmd, { cwd, env: { ...env, ...more }, stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: seconds * 1000, killSignal: "SIGKILL" });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  await child.exited;
  return { stdout, stderr, exitCode: child.exitCode, signal: child.signalCode };
}
const told = (ran: { stdout: string; exitCode: number | null; signal: string | null }) => `${ran.stdout}\nexit ${ran.exitCode} ${ran.signal ?? ""}`;

async function judge(name: string, text: string, flags: string[], expected?: string, more: Record<string, string> = {}) {
  // An act may put a text into a list of names that the program imports: plain Bun would ask the registry for it.
  const folder = withoutInstallingPackages(mkdtempSync(join(tmpdir(), "second-names-")));
  try {
    writeFileSync(join(folder, name), text);
    const ranPlain = await run([plain, "run", name], folder);
    const stock = told(ranPlain);
    if (expected !== undefined && stock !== expected) return { verdict: "void", detail: "plain Bun prints something else", stock };
    if (ranPlain.signal === "SIGKILL") return { verdict: "void", detail: "plain Bun runs into the time limit", stock };
    const build = await run([compiler, "build", "--compile", "--aot", "--aot-threads=1", ...flags, name, "--outfile", "app"], folder, { BUN_JSC_verifyAOTProgram: "1", ...more }, 240);
    if (build.signal || (build.exitCode ?? 0) > 128 || /panic|Stopped while compiling/.test(build.stderr))
      return { verdict: "aborted", detail: /Stopped while compiling[^\n]*/.exec(build.stderr)?.[0] ?? String(build.signal ?? build.exitCode), stock };
    if (build.exitCode) {
      const refusal = /internal compiler error[^\n]*/.exec(build.stderr)?.[0];
      return refusal ? { verdict: "refused", detail: refusal.slice(0, 200), stock } : { verdict: "void", detail: build.stderr.trim().split("\n")[0]?.slice(0, 160) ?? "", stock };
    }
    const ours = told(await run([join(folder, "app")], folder));
    if (ours !== stock && told(await run([plain, "run", name], folder)) !== stock) return { verdict: "void", detail: "plain Bun prints something else when it is asked again", stock };
    return ours === stock ? { verdict: "same", detail: "", stock } : { verdict: "differs", detail: JSON.stringify(ours.slice(0, 120)) + " for " + JSON.stringify(stock.slice(0, 120)), stock };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const counts = new Map<string, number>();
const count = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1);
const seeing = new Set<string>();
const kept = option("keep");
if (kept) mkdirSync(kept, { recursive: true });

async function sweep(path: string) {
  const text = readFileSync(path, "utf8");
  const name = basename(path);
  const flags = /^\/\/ Flags: (.*)$/m.exec(text)?.[1].split(/\s+/).filter(Boolean) ?? [];
  const laid = variantsFor(name, kind, numberOfVariants).flatMap(variant => {
    const made = withSecondNames(path, text, { ...variant, isTaken: has("taken"), observes: has("observes") });
    return made ? [{ variant, ...made }] : [];
  });
  if (!laid.length) return count(`programs without a ${kind} that a loop reads`);
  if (has("taken") && /["']bun:jsc["']/.test(text)) return count("programs left out: they print how the engine keeps a list");
  const asStored = await judge(name, text, flags);
  if (asStored.verdict !== "same") return count(`programs left out: ${asStored.verdict} as stored`);
  count("programs");
  for (const { variant, text: wrapped, lists } of laid) {
    const { verdict, detail } = await judge(name, wrapped, flags, has("taken") || has("observes") ? undefined : asStored.stock);
    count(verdict);
    if (verdict === "same" && control) {
      let sees = false;
      for (const word of control) {
        const sabotaged = await judge(name, wrapped, [...flags, `--aot-sabotage=${word}`], undefined, { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" });
        if (sabotaged.verdict === "same" || sabotaged.verdict === "void") continue;
        sees = true;
        count(`sees ${word}`);
      }
      count(sees ? "sees" : "blind");
      if (sees) seeing.add(path);
    }
    if (verdict !== "same") {
      console.log(`${verdict}\t${path}\t${variant.road}\t${variant.act}\t${lists}\t${detail}`);
      if (kept && verdict !== "void") writeFileSync(join(kept, `${variant.road}-${variant.act}-${name}`), wrapped);
    }
  }
}

let next = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < programs.length) await sweep(programs[next++]);
  }),
);
console.log(`ENDED files ${programs.length} | ${[...counts].map(([what, number]) => `${what} ${number}`).join(" | ")}${control ? ` | programs that see ${seeing.size}` : ""}`);
