import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import "../harness/without-installing-packages";
import { dirname, join, resolve } from "path";
import { ownTemporaryFolder } from "../harness/temporary-folders";

type Outcome = { stdout: string; error: string; exitCode: number | null; signal: string | null };
type ProcessResult = { stdout: string; stderr: string; exitCode: number | null; signal: string | null };
type Arguments = { program: string; bun: string; flags: string[] };

const usage = `usage: bun test/aot/tools/bisect.ts <program> [--bun <bun>] [--flags <flag>..]
    <program>    an entry point (.ts, .tsx, .js), as passed to bun run
    --bun        the Bun that builds the program and runs the reference (default: the Bun running this script)
    --flags      every argument after it is passed to every build, before the switches`;

// Each switch takes one source of knowledge away from the compiler. A program's output must not depend on any of them.
const whereToLook: Record<string, string> = {
  "--aot-erase-types": "what lowering or the walk makes of a written type",
};
const switches = Object.keys(whereToLook);

const runTimeout = 90_000;
const buildTimeout = 600_000;
const executableSuffix = process.platform === "win32" ? ".exe" : "";

function exitWithError(message: string): never {
  console.error(message);
  process.exit(2);
}

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function resolveTool(nameOrPath: string): string {
  return Bun.which(nameOrPath) ?? resolve(nameOrPath);
}

function parseArguments(args: string[]): Arguments {
  let program: string | undefined;
  let bun = process.execPath;
  let flags: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--flags") {
      flags = args.slice(i + 1);
      break;
    }
    if (arg === "--bun") {
      const value = args[++i];
      if (value === undefined) exitWithError(usage);
      bun = resolveTool(value);
    } else if (arg.startsWith("-") || program !== undefined) exitWithError(usage);
    else program = resolve(arg);
  }
  if (program === undefined || !isFile(program)) exitWithError(usage);
  if (!isFile(bun)) exitWithError(`bisect: ${bun} is not a file`);
  return { program, bun, flags };
}

const { program, bun, flags } = parseArguments(process.argv.slice(2));
const programFolder = dirname(program);
const switchIndex = new Map<string, number>(switches.map((name, index) => [name, index]));
const answers = new Map<string, boolean>();
let reference: Outcome;
let executable: string;

async function runProcess(cmd: string[], cwd: string, timeout: number): Promise<ProcessResult> {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...process.env, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode: proc.exitCode, signal: proc.signalCode };
}

function toOutcome(result: ProcessResult): Outcome {
  const errorLine = result.stderr.split("\n").find(line => /^(error|[A-Za-z]*Error)\b/.test(line));
  return {
    stdout: result.stdout.replace(/ [0-9]+ms$/gm, ""),
    error: result.exitCode === 0 ? "" : (errorLine ?? ""),
    exitCode: result.exitCode,
    signal: result.signal,
  };
}

async function runOutcome(cmd: string[], cwd: string): Promise<Outcome> {
  return toOutcome(await runProcess(cmd, cwd, runTimeout));
}

function isSameOutcome(a: Outcome, b: Outcome): boolean {
  return a.stdout === b.stdout && a.error === b.error && a.exitCode === b.exitCode && a.signal === b.signal;
}

function buildCommand(passed: string[]): string[] {
  return [bun, "build", "--compile", "--aot", ...flags, ...passed, program, "--outfile", executable];
}

async function matchesReference(passed: string[]): Promise<boolean> {
  const sorted = passed.toSorted((a, b) => switchIndex.get(a)! - switchIndex.get(b)!);
  const key = sorted.join(" ");
  const known = answers.get(key);
  if (known !== undefined) return known;

  const build = toOutcome(await runProcess(buildCommand(sorted), programFolder, buildTimeout));
  const isBuilt = build.exitCode === 0;
  const matches = isBuilt && isSameOutcome(await runOutcome([executable], programFolder), reference);
  answers.set(key, matches);

  const verdict = !isBuilt ? "not built" : matches ? "right" : "wrong";
  const failure = isBuilt ? "" : `: ${build.error || build.signal || `exit code ${build.exitCode}`}`;
  console.log(`${answers.size} ${verdict} ${key || "as it is"}${failure}`);
  return matches;
}

async function minimize(candidates: string[], fixed: string[]): Promise<string[]> {
  if (await matchesReference(fixed)) return [];
  if (candidates.length === 1) return candidates;
  const first = candidates.slice(0, candidates.length >> 1);
  const second = candidates.slice(candidates.length >> 1);
  if (await matchesReference([...fixed, ...first])) return minimize(first, fixed);
  if (await matchesReference([...fixed, ...second])) return minimize(second, fixed);
  const fromFirst = await minimize(first, [...fixed, ...second]);
  return [...fromFirst, ...(await minimize(second, [...fixed, ...fromFirst]))];
}

function quoteForShell(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : "'" + word.replaceAll("'", "'\\''") + "'";
}

function formatResult(passed: string[]): string[] {
  return [
    ...passed.flatMap(name => [`switch  ${name}`, `look at ${whereToLook[name]}`]),
    `again   ${buildCommand(passed).map(quoteForShell).join(" ")}`,
  ];
}

async function main(): Promise<number> {
  const referenceRun = await runProcess([bun, "run", program], programFolder, runTimeout);
  if (referenceRun.signal !== null || referenceRun.exitCode !== 0) {
    console.error(`bisect: bun run itself fails\n${referenceRun.stderr}`);
    return 1;
  }
  reference = toOutcome(referenceRun);

  const folder = ownTemporaryFolder(mkdtempSync(join(tmpdir(), "aot-bisect-")));
  const removeFolder = () => rmSync(folder, { recursive: true, force: true });
  process.once("SIGINT", () => {
    removeFolder();
    process.exit(130);
  });
  executable = join(folder, "program" + executableSuffix);
  try {
    if (await matchesReference([])) {
      console.log("the compiled program behaves like bun run: nothing to bisect");
      return 1;
    }
    if (!(await matchesReference(switches))) {
      console.log(
        "it differs with every switch passed: the cause is not a written type. Look at a fact about the " +
          "whole program, at what the plan or the walk makes of one, at lowering, at the back end " +
          "(--aot-check=Validate) and at the run time",
      );
      return 1;
    }
    console.log(["", ...formatResult(await minimize(switches, []))].join("\n"));
    return 0;
  } finally {
    removeFolder();
  }
}

process.exit(await main());
