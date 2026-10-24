import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

type Outcome = { stdout: string; error: string; exitCode: number | null; signal: string | null };
type Range = { first: number; count: number } | undefined;
type ProcessResult = { stdout: string; stderr: string; exitCode: number | null; signal: string | null };
type Arguments = { program: string; bun: string; testaot: string; flags: string[] };

const usage = `usage: bun test/aot/tools/bisect.ts <program> [--bun <bun>] [--testaot <testaot>] [--flags <flag>..]
    <program>    an entry point (.ts, .tsx, .js), as passed to bun run
    --bun        the Bun that builds the program and runs the reference (default: the Bun running this script)
    --testaot    the testaot that lists the switch names (default: $TESTAOT, else testaot next to that Bun)
    --flags      every argument after it is passed to every build, before the switches`;

const runTimeout = 90_000;
const buildTimeout = 600_000;
const maxIDCount = 2 ** 31;
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
  let testaot = process.env.TESTAOT;
  let flags: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--flags") {
      flags = args.slice(i + 1);
      break;
    }
    if (arg === "--bun" || arg === "--testaot") {
      const value = args[++i];
      if (value === undefined) exitWithError(usage);
      if (arg === "--bun") bun = resolveTool(value);
      else testaot = value;
    } else if (arg.startsWith("-") || program !== undefined) exitWithError(usage);
    else program = resolve(arg);
  }
  if (program === undefined || !isFile(program)) exitWithError(usage);
  if (!isFile(bun)) exitWithError(`bisect: ${bun} is not a file`);
  const testaotPath = resolveTool(testaot || join(dirname(bun), "testaot" + executableSuffix));
  if (!isFile(testaotPath)) exitWithError(`bisect: ${testaotPath} is not a file: pass --testaot or set $TESTAOT`);
  return { program, bun, testaot: testaotPath, flags };
}

function listSwitches(testaot: string): string[] {
  // testaot exits without destroying its VM, which LeakSanitizer would report: shell_environment in shell/toolchain.py.
  const asanOptions = [process.env.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":");
  const listing = Bun.spawnSync([testaot, "list", "options"], {
    env: { ...process.env, ASAN_OPTIONS: asanOptions },
    stderr: "inherit",
  });
  if (listing.exitCode !== 0) {
    exitWithError(`bisect: "testaot list options" failed: ${listing.signalCode ?? `exit code ${listing.exitCode}`}`);
  }
  const names: string[] = [];
  let isInBlock = false;
  for (const line of listing.stdout.toString().split("\n")) {
    if (!isInBlock) isInBlock = line.startsWith("disable=");
    else if (line.startsWith("  ")) names.push(line.trim());
    else break;
  }
  return names.filter(name => name !== "flow-results");
}

const { program, bun, testaot, flags } = parseArguments(process.argv.slice(2));
const programFolder = dirname(program);
const switches = listSwitches(testaot);
if (switches.length === 0) exitWithError(`bisect: "testaot list options" lists no switches`);
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

function formatRange(range: Range): string {
  return range ? `${range.first}:${range.count}` : "";
}

function buildCommand(off: string[], range: Range): string[] {
  return [
    bun,
    "build",
    "--compile",
    "--aot",
    ...flags,
    ...(off.length ? ["--aot-disable=" + off.join(",")] : []),
    ...(range ? ["--aot-disable-in=" + formatRange(range)] : []),
    program,
    "--outfile",
    executable,
  ];
}

async function matchesReference(off: string[], range?: Range): Promise<boolean> {
  const sorted = off.toSorted((a, b) => switchIndex.get(a)! - switchIndex.get(b)!);
  const key = sorted.join(",") + "|" + formatRange(range);
  const known = answers.get(key);
  if (known !== undefined) return known;

  const build = toOutcome(await runProcess(buildCommand(sorted, range), programFolder, buildTimeout));
  const isBuilt = build.exitCode === 0;
  const matches = isBuilt && isSameOutcome(await runOutcome([executable], programFolder), reference);
  answers.set(key, matches);

  const verdict = !isBuilt ? "not built" : matches ? "right" : "wrong";
  const failure = isBuilt ? "" : `: ${build.error || build.signal || `exit code ${build.exitCode}`}`;
  console.log(`${answers.size} ${verdict} ${sorted.length}${range ? ` in ${formatRange(range)}` : ""}${failure}`);
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

async function narrowRange(off: string[]): Promise<Range | "whole program"> {
  // A switch that is not tested per id stays on under any range, so the widest range settles that in one build.
  if (!(await matchesReference(off, { first: 0, count: maxIDCount }))) return "whole program";
  let count = 1;
  while (count < maxIDCount && !(await matchesReference(off, { first: 0, count }))) count *= 2;

  let first = 0;
  while (count > 1) {
    const half = count >>> 1;
    if (await matchesReference(off, { first, count: half })) count = half;
    else if (await matchesReference(off, { first: first + half, count: count - half })) {
      first += half;
      count -= half;
    } else break;
  }
  return { first, count };
}

function quoteForShell(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : "'" + word.replaceAll("'", "'\\''") + "'";
}

function formatResult(off: string[], narrowed: Range | "whole program"): string[] {
  const range = narrowed === "whole program" ? undefined : narrowed;
  const lines = off.map(name => `switch  ${name}`);
  if (range) {
    const { first, count } = range;
    const printCommand = `testaot print <program bytes> --function=f${first}`;
    lines.push(count === 1 ? `id      ${first}` : `ids     ${first} to ${first + count - 1}`);
    if (off.some(name => name.startsWith("flow:"))) {
      lines.push("the id is the index of the function, layout or variable that the result is about");
    }
    if (off.some(name => !name.startsWith("flow:"))) {
      lines.push(`the id is a function: ${printCommand} (bun build .. --aot-out=<file> writes the bytes)`);
    }
  } else {
    lines.push("id      none: it acts on the program as a whole");
  }
  lines.push(`again   ${buildCommand(off, range).map(quoteForShell).join(" ")}`);
  return lines;
}

async function main(): Promise<number> {
  const referenceRun = await runProcess([bun, "run", program], programFolder, runTimeout);
  if (referenceRun.signal !== null || referenceRun.exitCode !== 0) {
    console.error(`bisect: bun run itself fails\n${referenceRun.stderr}`);
    return 1;
  }
  reference = toOutcome(referenceRun);

  const folder = mkdtempSync(join(tmpdir(), "aot-bisect-"));
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
        "it differs with every switch off: the cause is not a flow result, an optional pass, an optional selection " +
          "rule or a B3 switch. Look at lowering (--aot-erase-types), at required passes and code generation " +
          "(--aot-validate, --aot-check=verify-each-pass), and at the run time",
      );
      return 1;
    }
    const off = await minimize(switches, []);
    console.log(["", ...formatResult(off, await narrowRange(off))].join("\n"));
    return 0;
  } finally {
    removeFolder();
  }
}

process.exit(await main());
