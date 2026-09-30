// Runs instances through a pluggable check and compares the baseline of its diagnostics with the oracle, byte for byte.
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  type Diagnostic as WriterDiagnostic,
  WriterPanic,
  compareDiagnostics,
  formatDiagnosticsWithColorAndContext,
  tsgoRules,
  writeFormatDiagnostics,
} from "./diagnosticwriter";
import { diagnosticsLocationPrefixGo, formatOpts, getErrorBaseline, removeTestPathPrefixes } from "./error_baseline";
import { readErrorBaseline } from "./reader";
import { type Diagnostic, type InputFile, toErrorBaseline, toWriterInput } from "./shape";

export const outcomes = [
  "pass",
  "fail",
  "skip",
  "provisional",
  "unavailable",
  "unsupported",
  "crash",
  "timeout",
] as const;

export type Outcome = (typeof outcomes)[number];

// The fields of an instance that the run reads; the instances of the enumerator carry more.
export interface Instance {
  // The configured name of the reference: "ES5For-of1(target=es2015).ts".
  name: string;
  // Anything but "run" is an instance that the reference skips.
  status: "run" | "skip";
  skipReason?: string;
  // Class E: the oracle is an error baseline. Class C: the reference has no diagnostic and writes no baseline.
  oracle: { class: "E" | "C" };
}

export interface Symlink {
  path: string;
  target: string;
}

export interface CheckInput {
  instance: Instance;
  // The directory that stands for "/" of the file system of the instance. Undefined: the run writes no file.
  root: string | undefined;
  // The current directory of the instance as the harness has it: "/.src".
  currentDirectory: string;
  // The file names of the program in order, as CompileFilesEx makes them: the operands of a compiler.
  rootFiles: string[];
  // Names of the units that newCompilerTest keeps out of the compilation: they are on the file system only.
  otherFiles: string[];
  // Every unit in the order of the sections of a baseline: configuration file, roots, other files.
  units: InputFile[];
  symlinks: Symlink[];
  // The settings of the instance from its directives and its variation: names in lower case, values as written.
  options: Readonly<Record<string, string>>;
}

export interface CheckResult {
  // A start and a length count UTF-8 bytes of the text of the unit.
  diagnostics: Diagnostic[];
  // Names of the parts that the check reached and does not implement yet: the instance is provisional.
  standIns?: string[];
  // Why the check cannot check the instance.
  unavailable?: string;
}

// The signal is aborted when the time limit is reached: a check that starts a process ends it with the signal.
export type Check = (input: CheckInput, signal: AbortSignal) => Promise<CheckResult>;

// What a check gets besides the instance and the root, or why the instance cannot be run here.
export type InputResult = { ok: true; input: Omit<CheckInput, "instance" | "root"> } | { ok: false; reason: string };

export interface RunResult {
  instance: Instance;
  outcome: Outcome;
  // One line; empty for a pass.
  reason: string;
  // The first lines that differ, the oracle's and then the baseline's, below the lines before them.
  diff?: string;
  // The baseline of the diagnostics, when it differs from the oracle.
  actual?: Uint8Array;
  standIns?: string[];
  // True: the first section equals the oracle's and the baseline does not. It is reported apart and is never a pass.
  headerOnly?: boolean;
}

export interface RunOptions {
  // The files of a run instance as newCompilerTest and CompileFilesEx lay them out; with a root, also written below it.
  input(instance: Instance, root: string | undefined): InputResult;
  // The bytes of the oracle of an instance of class E.
  oracle(instance: Instance): Uint8Array;
  // Checks in flight at one time. Absent: 1.
  concurrency?: number;
  // Time for the check of one instance. Absent: 30 seconds.
  timeoutMs?: number;
  // Directory below which each instance is written before its check and removed after it. Absent: no file is written.
  directory?: string;
  // Called once for each instance when its outcome is known; what it throws is thrown after the last instance.
  onResult?(result: RunResult): void;
}

type Ending = Omit<RunResult, "instance">;

// The oracle is the output of typescript-go, whichever project holds the file.
const rules = tsgoRules;
const model = rules.model;
const defaultTimeoutMs = 30_000;
// The longest delay that a timer takes.
const longestTimeoutMs = 2 ** 31 - 1;
const decoder = new TextDecoder();
let directories = 0;

// harnessutil.go getOptionValue: a boolean option is set when its value in lower case is "true".
function isPretty(options: Readonly<Record<string, string>>): boolean {
  return (options["pretty"] ?? "").toLowerCase() === "true";
}

function textOf(value: unknown): string {
  let text: string;
  try {
    text = String(value);
  } catch {
    text = "a value without a text";
  }
  const line = text.split("\n").find(l => l.trim() !== "") ?? "";
  return line.length > 300 ? line.slice(0, 300) + "..." : line;
}

// Text of the model as a JavaScript string, for a reason; text that is no such string stays as it is.
function shown(text: string): string {
  try {
    return model.toString(text);
  } catch {
    return text;
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(a, b) === 0;
}

function startsWith(all: Uint8Array, head: Uint8Array): boolean {
  return all.length >= head.length && Buffer.compare(all.subarray(0, head.length), head) === 0;
}

function display(line: string): string {
  const text = line.replaceAll("\x1b", "\\x1b").replaceAll("\r", "\\r").replaceAll("\n", "\\n");
  return text.length > 500 ? text.slice(0, 500) + "..." : text;
}

// Where a text parts from the oracle: the place, and the first lines that differ below the lines before them.
function difference(what: string, expected: Uint8Array, actual: Uint8Array): { reason: string; diff: string } {
  const context = 3;
  const most = Math.min(expected.length, actual.length);
  let byte = 0;
  while (byte < most && expected[byte] === actual[byte]) byte++;
  const a = decoder.decode(expected).split("\r\n");
  const b = decoder.decode(actual).split("\r\n");
  let line = 0;
  while (line < a.length && line < b.length && a[line] === b[line]) line++;
  const diff = [`@@ line ${line + 1} @@`];
  for (const l of a.slice(Math.max(0, line - context), line)) diff.push("  " + display(l));
  for (const l of a.slice(line, line + context)) diff.push("- " + display(l));
  for (const l of b.slice(line, line + context)) diff.push("+ " + display(l));
  return { reason: `${what} differs from the oracle at byte ${byte}, line ${line + 1}`, diff: diff.join("\n") };
}

// True: nothing that a baseline shows of the diagnostic is absent. The plain form shows no length of a related place.
function isComplete(d: Diagnostic, pretty: boolean, units: ReadonlySet<string>): boolean {
  const inUnit = d.location !== undefined && units.has(d.location.file);
  if (inUnit && d.location?.length === undefined) return false;
  // The plain form prints related information in the section of a unit and below a diagnostic without a file.
  if (d.relatedInformation === undefined) return !pretty && d.location !== undefined && !inUnit;
  return d.relatedInformation.every(
    r => !pretty || r.location === undefined || r.location.length !== undefined || !units.has(r.location.file),
  );
}

// Path and start, and nothing that a check without spans knows: the order of its diagnostics decides a tie.
function compareByStart(a: WriterDiagnostic, b: WriterDiagnostic): number {
  const c = model.compare(a.file?.fileName ?? "", b.file?.fileName ?? "");
  return c !== 0 ? c : a.pos - b.pos;
}

// error_baseline.go iterateErrorBaseline: the first section with the two line breaks that end it.
function topOf(sorted: WriterDiagnostic[], pretty: boolean): Uint8Array {
  let top = pretty
    ? formatDiagnosticsWithColorAndContext(rules, sorted, formatOpts)
    : writeFormatDiagnostics(rules, sorted, formatOpts);
  top = removeTestPathPrefixes(rules, top);
  top = top.replace(diagnosticsLocationPrefixGo, "$1(--,--)");
  return model.toBytes(top + "\r\n\r\n");
}

// error_baseline.go DoErrorBaseline and baseline.go writeComparison: no diagnostic and no baseline, or the same bytes.
function compare(input: CheckInput, diagnostics: Diagnostic[], oracle: RunOptions["oracle"]): Ending {
  // The reference fails a test with a diagnostic of the code -1, whatever its baseline is.
  if (diagnostics.some(d => d?.code === -1)) return { outcome: "fail", reason: "a diagnostic has the code -1" };
  const oracleClass = input.instance.oracle?.class;
  if (oracleClass === "C") {
    if (diagnostics.length === 0) return { outcome: "pass", reason: "" };
    const first = diagnostics[0];
    const label = `TS${first?.code}: ${textOf(first?.messageText)}`;
    return {
      outcome: "fail",
      reason: `${diagnostics.length} diagnostics where the oracle has none, the first is ${label}`,
    };
  }
  if (oracleClass !== "E") return { outcome: "unsupported", reason: "the instance has no oracle" };
  if (diagnostics.length === 0) return { outcome: "fail", reason: "no diagnostic where the oracle has a baseline" };
  let expected: Uint8Array;
  try {
    expected = oracle(input.instance);
  } catch (error) {
    return { outcome: "unsupported", reason: `the oracle cannot be read: ${textOf(error)}` };
  }
  const pretty = isPretty(input.options);
  try {
    const names = new Set(input.units.map(u => u.unitName));
    const whole = diagnostics.every(d => isComplete(d, pretty, names));
    const written = toWriterInput(rules, input.units, diagnostics);
    if (!whole) {
      const needs = "a baseline needs the lengths and the related information";
      // The first section of the pretty form shows the lengths.
      if (pretty) return { outcome: "fail", reason: needs, headerOnly: false };
      const top = topOf(written.diagnostics.slice().sort(compareByStart), false);
      if (startsWith(expected, top)) {
        return { outcome: "fail", reason: `the first section is the oracle's; ${needs}`, headerOnly: true };
      }
      return { outcome: "fail", ...difference("the first section", expected, top), headerOnly: false };
    }
    const result = getErrorBaseline(rules, written.files, written.diagnostics, pretty);
    const actual = model.toBytes(result.text);
    // A failed check of the writer fails the test of the reference, whatever text it wrote.
    const refused = result.failedChecks.length > 0;
    if (!refused && equalBytes(actual, expected)) return { outcome: "pass", reason: "" };
    const sorted = written.diagnostics.slice().sort((a, b) => compareDiagnostics(rules, a, b));
    const headerOnly = startsWith(expected, topOf(sorted, pretty));
    if (refused) {
      return { outcome: "fail", reason: `the writer: ${shown(result.failedChecks.join("; "))}`, actual, headerOnly };
    }
    return { outcome: "fail", ...difference("the baseline", expected, actual), actual, headerOnly };
  } catch (error) {
    // A panic of the writer of the reference fails its test; its text is in the model of the rules.
    if (error instanceof WriterPanic) return { outcome: "fail", reason: `the writer: ${textOf(shown(error.message))}` };
    return { outcome: "fail", reason: `the diagnostics do not make a baseline: ${textOf(error)}` };
  }
}

type Ended = { how: "returned"; value: unknown } | { how: "threw"; error: unknown } | { how: "timeout" };

function callWithLimit(check: Check, input: CheckInput, timeoutMs: number): Promise<Ended> {
  return new Promise(resolve => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      resolve({ how: "timeout" });
      controller.abort();
    }, timeoutMs);
    const settle = (ended: Ended) => {
      clearTimeout(timer);
      resolve(ended);
    };
    try {
      Promise.resolve(check(input, controller.signal)).then(
        value => settle({ how: "returned", value }),
        error => settle({ how: "threw", error }),
      );
    } catch (error) {
      settle({ how: "threw", error });
    }
  });
}

async function attempt(instance: Instance, check: Check, options: RunOptions): Promise<Ending> {
  if (instance.status !== "run") return { outcome: "skip", reason: instance.skipReason ?? "" };
  const root = options.directory === undefined ? undefined : join(options.directory, (directories++).toString(36));
  try {
    let built: InputResult;
    try {
      built = options.input(instance, root);
    } catch (error) {
      return { outcome: "unsupported", reason: `the input of the check cannot be built: ${textOf(error)}` };
    }
    if (!built.ok) return { outcome: "unsupported", reason: built.reason };
    const input: CheckInput = { instance, root, ...built.input };
    const wanted = options.timeoutMs;
    const timeoutMs =
      wanted !== undefined && wanted > 0 ? Math.min(Math.ceil(wanted), longestTimeoutMs) : defaultTimeoutMs;
    const started = performance.now();
    const ended = await callWithLimit(check, input, timeoutMs);
    // A check that blocks the thread, or whose process is ended at the limit, ends after the limit.
    if (ended.how === "timeout" || performance.now() - started >= timeoutMs) {
      return { outcome: "timeout", reason: `the check did not end within ${timeoutMs} ms` };
    }
    if (ended.how === "threw") return { outcome: "crash", reason: `the check threw: ${textOf(ended.error)}` };
    const value = ended.value as Partial<CheckResult> | null | undefined;
    if (typeof value !== "object" || value === null) {
      return { outcome: "crash", reason: "the check returned no result" };
    }
    const unavailable: unknown = value.unavailable;
    if (unavailable !== undefined && unavailable !== null && unavailable !== false) {
      return { outcome: "unavailable", reason: textOf(unavailable) };
    }
    if (!Array.isArray(value.diagnostics)) {
      return { outcome: "crash", reason: "the check returned no list of diagnostics" };
    }
    const standIns = Array.isArray(value.standIns) ? value.standIns.map(name => textOf(name)) : [];
    if (standIns.length > 0) {
      const names = standIns.slice(0, 5).join(", ") + (standIns.length > 5 ? ", ..." : "");
      return { outcome: "provisional", reason: `the check reached ${standIns.length} stand-ins: ${names}`, standIns };
    }
    return compare(input, value.diagnostics, options.oracle);
  } finally {
    if (root !== undefined) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  }
}

// One instance through the check and the comparison. It never throws: what goes wrong is the outcome.
export async function runInstance(instance: Instance, check: Check, options: RunOptions): Promise<RunResult> {
  let ending: Ending;
  try {
    ending = await attempt(instance, check, options);
  } catch (error) {
    ending = { outcome: "crash", reason: `the runner threw: ${textOf(error)}` };
  }
  return { instance, ...ending };
}

// One batch: at most `concurrency` checks are in flight, and the results are in the order of the instances.
export async function runInstances(
  instances: readonly Instance[],
  check: Check,
  options: RunOptions,
): Promise<RunResult[]> {
  const results = new Array<RunResult>(instances.length);
  const wanted = options.concurrency;
  const width = Math.min(instances.length, wanted !== undefined && wanted >= 1 ? Math.floor(wanted) : 1);
  let next = 0;
  let thrown: { error: unknown } | undefined;
  const worker = async () => {
    for (let index = next++; index < instances.length; index = next++) {
      const result = await runInstance(instances[index], check, options);
      results[index] = result;
      try {
        options.onResult?.(result);
      } catch (error) {
        thrown ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  if (thrown !== undefined) throw thrown.error;
  return results;
}

// A check that reports the diagnostics that the oracle holds: it proves the run, the writer and the comparison.
export function replayCheck(oracle: RunOptions["oracle"]): Check {
  return async input => {
    if (input.instance.oracle.class !== "E") return { diagnostics: [] };
    const units = input.units.map(u => ({
      unitName: model.fromString(u.unitName),
      content: model.fromString(u.content),
    }));
    const parsed = readErrorBaseline(rules, model.fromBytes(oracle(input.instance)), { units });
    return { diagnostics: toErrorBaseline(parsed).diagnostics };
  };
}

// A check that reports nothing: it passes the instances of class C and none of class E.
export const emptyCheck: Check = async () => ({ diagnostics: [] });
