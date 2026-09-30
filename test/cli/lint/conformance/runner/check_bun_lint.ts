// The default check: it starts a command with --lint and the files of the program as operands, and reads the plain format of tsc from stderr.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tsgoRules } from "./diagnosticwriter";
import { isDefaultLibraryFile } from "./error_baseline";
import { makeTemporaryDirectory, mapRealPaths, toRealPath, toVirtualName } from "./materialise";
import type { Check, CheckResult } from "./run";
import type { Diagnostic, DiagnosticLocation, DiagnosticMessageChain } from "./shape";
import { type PlainChain, type PlainDiagnostic, parsePlainDiagnostics } from "./tsc_plain_format";
import { getBaseFileName, getNormalizedAbsolutePath } from "./tspath";

export interface SpawnCheckOptions {
  // The command without the flag and the operands: [bunExe()].
  command: string[];
  // The environment of the caller: bunEnv. Every run gets the flag of the feature besides.
  env: Readonly<Record<string, string | undefined>>;
  // Time for each of the two runs of the probe. Absent: 60 seconds.
  probeTimeoutMs?: number;
  // Directory for the two files of the probe, which stay there. Absent: a new directory of temporary files, removed after the probe.
  probeDirectory?: string;
  // Names of rules whose diagnostics are left out. Absent: a diagnostic whose code is a name makes the run a crash.
  ignoreRules?: readonly string[];
}

export interface ProbeResult {
  ok: boolean;
  // Why the command is no linter; empty when it is one.
  reason: string;
}

// What the first file of the probe writes to stdout when a command runs it. The file holds the two parts apart: a command that prints its lines does not print this.
const probeSays = ["bun-lint-probe: ", "the file ran"] as const;
// A line with this code names a part that the checker reached and does not have yet.
const standInCode = "internal-stand-in";
// A line with this code is an error of the command itself, not of a file.
const internalErrorCode = "internal-error";
const defaultProbeTimeoutMs = 60_000;
// The longest delay that a timer takes.
const longestTimeoutMs = 2 ** 31 - 1;

// The environment of every run: the flag of the feature, and nothing that adds a debug log, a colour or an option.
function spawnEnvironment(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined) out[name] = value;
  out.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT = "1";
  out.BUN_DEBUG_QUIET_LOGS = "1";
  out.NO_COLOR = "1";
  delete out.FORCE_COLOR;
  delete out.BUN_OPTIONS;
  return out;
}

interface Ended {
  // Null: a signal ended the command, or no process started.
  exitCode: number | null;
  // The name of the signal, or its number where it has no name.
  signal: string | number | null;
  // The limit was reached and the command was ended for it.
  timedOut: boolean;
  stdout: string;
  stderr: string;
  // Why no process started.
  notStarted?: string;
}

// One process, ended when the limit is aborted. stdin is closed; stdout and stderr are read to their end.
async function spawnCommand(
  cmd: string[],
  cwd: string,
  env: Record<string, string>,
  limit: AbortSignal,
): Promise<Ended> {
  const none = { exitCode: null, signal: null, stdout: "", stderr: "" };
  if (limit.aborted) return { ...none, timedOut: true };
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn({
      cmd,
      cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: limit,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    return { ...none, timedOut: false, notStarted: String(error) };
  }
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const signal = proc.signalCode;
  // A command that ended by itself before the limit did not run out of time.
  return { exitCode: proc.exitCode, signal, timedOut: limit.aborted && signal !== null, stdout, stderr };
}

// One process with a limit of its own, for the probe: the limit of an instance comes from the runner.
async function spawnWithin(
  cmd: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number | undefined,
): Promise<Ended> {
  const wanted = timeoutMs !== undefined && timeoutMs > 0 ? Math.ceil(timeoutMs) : defaultProbeTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(wanted, longestTimeoutMs));
  try {
    return await spawnCommand(cmd, cwd, env, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// The first line of a text that holds more than white space, for a reason.
function head(text: string): string {
  const line = text.split(/\r?\n/).find(l => l.trim() !== "") ?? "";
  return line.length > 200 ? line.slice(0, 200) + "..." : line;
}

type Reading = { ok: true; diagnostics: PlainDiagnostic[] } | { ok: false; reason: string };

// What a run says before any name is mapped. Exit code 0 is no error, 2 is one or more, 1 is a refusal; stdout stays empty.
function readRun(run: Ended): Reading {
  const no = (reason: string): Reading => ({ ok: false, reason });
  if (run.notStarted !== undefined) return no(`the command did not start: ${head(run.notStarted)}`);
  if (run.timedOut) return no("the command did not end in time");
  if (run.signal !== null) return no(`the command ended by the signal ${run.signal}`);
  if (run.exitCode === 1) return no(`the command refused: ${head(run.stderr)}`);
  if (run.exitCode !== 0 && run.exitCode !== 2) return no(`the command ended with the exit code ${run.exitCode}`);
  if (run.stdout !== "") return no(`the command wrote to stdout: ${head(run.stdout)}`);
  // A text with one line of no known form is refused whole: a crash report never reads as an empty list.
  const parsed = parsePlainDiagnostics(run.stderr);
  if (!parsed.ok) return no(`stderr line ${parsed.at} is ${parsed.reason}: ${head(parsed.text)}`);
  const errors = parsed.diagnostics.filter(d => d.category === "error").length;
  if (run.exitCode === 0 && errors > 0) return no(`the exit code is 0 and stderr has ${errors} errors`);
  if (run.exitCode === 2 && errors === 0) return no("the exit code is 2 and stderr has no error");
  return { ok: true, diagnostics: parsed.diagnostics };
}

function chainOf(
  next: readonly PlainChain[] | undefined,
  text: (printed: string) => string,
): DiagnosticMessageChain[] | undefined {
  return next?.map(c => ({ messageText: text(c.messageText), next: chainOf(c.next, text) }));
}

// The diagnostics of a run with the names of the instance: a real path below the root becomes the name that the harness has.
function toCheckResult(
  plain: readonly PlainDiagnostic[],
  root: string,
  currentDirectory: string,
  ignoreRules: readonly string[],
): CheckResult {
  const diagnostics: Diagnostic[] = [];
  const standIns: string[] = [];
  const text = (printed: string) => mapRealPaths(root, printed);
  for (const p of plain) {
    if (p.code === undefined) {
      if (p.rule === standInCode) standIns.push(p.messageText);
      else if (p.rule === internalErrorCode) {
        throw new Error(`the command reports an error of its own: ${p.messageText}`);
      } else if (p.rule === undefined || !ignoreRules.includes(p.rule)) {
        // The name of a rule or a name of the command: no baseline holds it, and without it the list would say less than the run.
        throw new Error(`stderr line ${p.at} has the code ${p.rule}, which is no code of TypeScript`);
      }
      continue;
    }
    let location: DiagnosticLocation | undefined;
    if (p.path !== undefined) {
      let file = toVirtualName(root, currentDirectory, p.path);
      if (file === undefined) {
        if (!isDefaultLibraryFile(p.path)) {
          throw new Error(`stderr line ${p.at} names a file that is not of the instance: ${p.path}`);
        }
        // A default library of the command, wherever it keeps it, is the bundled library of the reference.
        file = tsgoRules.libraryRoot + getBaseFileName(p.path);
      }
      location = { file, line: p.line, character: p.character };
    }
    // The plain format has no length and no related information: both stay absent, which is "not known".
    diagnostics.push({
      category: p.category,
      code: p.code,
      messageText: text(p.messageText),
      next: chainOf(p.next, text),
      location,
    });
  }
  return { diagnostics, standIns };
}

function remove(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch {}
}

async function probeIn(directory: string, options: SpawnCheckOptions): Promise<ProbeResult> {
  const no = (reason: string): ProbeResult => ({ ok: false, reason });
  const ran = no("the command ran the file that it was to check");
  mkdirSync(directory, { recursive: true });
  const mark = join(directory, "ran.txt");
  const clean = join(directory, "ok.ts");
  const broken = join(directory, "bad.ts");
  rmSync(mark, { force: true });
  // No import and no name that a checker without type packages lacks: TypeScript 6.0.2 and typescript-go 7.1.0-dev report nothing.
  writeFileSync(
    clean,
    "const probe = globalThis as any;\n" +
      `probe.process.stdout.write(${JSON.stringify(probeSays[0])} + ${JSON.stringify(probeSays[1] + "\n")});\n` +
      `void probe.Bun.write(${JSON.stringify(mark)}, "ran");\n` +
      "export {};\n",
  );
  writeFileSync(broken, "const = ;\n");
  const env = spawnEnvironment(options.env);

  const first = await spawnWithin([...options.command, "--lint", clean], directory, env, options.probeTimeoutMs);
  if (existsSync(mark) || first.stdout.includes(probeSays.join(""))) return ran;
  const firstRead = readRun(first);
  if (!firstRead.ok) return no(`a file without an error: ${firstRead.reason}`);
  // A stand-in is no diagnostic of the file: a checker that lacks a part is a linter all the same.
  const found = firstRead.diagnostics.filter(d => d.rule !== standInCode).length;
  if (found > 0) return no(`a file without an error gave ${found} diagnostics and the exit code ${first.exitCode}`);

  const second = await spawnWithin([...options.command, "--lint", broken], directory, env, options.probeTimeoutMs);
  if (existsSync(mark)) return ran;
  const secondRead = readRun(second);
  if (!secondRead.ok) return no(`a file with a syntax error: ${secondRead.reason}`);
  const hit = secondRead.diagnostics.some(
    d => d.category === "error" && d.path !== undefined && toVirtualName(directory, "/", d.path) === "/bad.ts",
  );
  if (!hit) return no(`a file with a syntax error gave no error in it (exit code ${second.exitCode})`);
  return { ok: true, reason: "" };
}

// Tells a linter from a command that runs its operand, refuses the flag or stays silent, with two files that harm nothing. It does not throw.
export async function probe(options: SpawnCheckOptions): Promise<ProbeResult> {
  let made: string | undefined;
  try {
    const directory = options.probeDirectory ?? (made = makeTemporaryDirectory("bun-lint-probe-"));
    return await probeIn(resolve(directory), options);
  } catch (error) {
    return { ok: false, reason: `the probe could not run: ${head(String(error))}` };
  } finally {
    if (made !== undefined) remove(made);
  }
}

// The check that the runner uses by default. The command is probed once, before any file of an instance is an operand.
export function createSpawnCheck(options: SpawnCheckOptions): Check {
  const command = [...options.command];
  const env = spawnEnvironment(options.env);
  const ignoreRules = [...(options.ignoreRules ?? [])];
  const unavailable = (reason: string): CheckResult => ({ diagnostics: [], unavailable: reason });
  let probed: Promise<ProbeResult> | undefined;
  return async (input, signal) => {
    const verdict = await (probed ??= probe({ ...options, command, env }));
    if (!verdict.ok) return unavailable(`the command is no linter: ${verdict.reason}`);
    if (input.root === undefined) return unavailable("the run wrote no file for the command to read");
    const root = resolve(input.root);
    const currentDirectory = getNormalizedAbsolutePath(input.currentDirectory, "/");
    // The operands and the current directory are all that the command takes: the options of the instance do not reach it.
    const operands = input.rootFiles.map(name => toRealPath(root, getNormalizedAbsolutePath(name, currentDirectory)));
    if (operands.length === 0) return unavailable("the instance has no file of a program to be an operand");
    const cwd = toRealPath(root, currentDirectory);
    const read = readRun(await spawnCommand([...command, "--lint", ...operands], cwd, env, signal));
    // A signal, an exit without a list of diagnostics and a text of no known form are a crash of the instance.
    if (!read.ok) throw new Error(read.reason);
    return toCheckResult(read.diagnostics, root, currentDirectory, ignoreRules);
  };
}
