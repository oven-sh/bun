// Every error baseline read and written again from its parsed form: the bytes must be the same.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { type Rules, tscRules, tsgoRules, WriterPanic } from "./diagnosticwriter";
import { getErrorBaseline } from "./error_baseline";
import { compareStrings } from "./gostrings";
import { ReadError, readErrorBaseline } from "./reader";
import { type ErrorBaseline, toErrorBaseline, toWriterInput } from "./shape";

// The harness that wrote a baseline: typescript-go's, or TypeScript's own, whose format differs in places.
export type Origin = "typescript" | "typescript-go";

export const origins: readonly Origin[] = ["typescript", "typescript-go"];

export function rulesOf(origin: Origin): Rules {
  return origin === "typescript" ? tscRules : tsgoRules;
}

interface RoundTripFacts {
  pretty: boolean;
  // The codes of the diagnostics in the order of the first section.
  codes: number[];
}

// equal: the text written from the parsed form has the bytes that were read; else the reason says what the reader or the writer refused, or where the texts part.
export type RoundTrip = RoundTripFacts & ({ equal: true } | { equal: false; reason: string });

// Text of the model as a JavaScript string, for a message; text that is no such string stays as it is.
function shown(rules: Rules, text: string): string {
  try {
    return rules.model.toString(text);
  } catch {
    return text;
  }
}

// The steps of a round trip, for the reason of an error that is neither the reader's nor the writer's own.
type Step = "bytes" | "reader" | "plain form" | "writer";

function reasonOf(rules: Rules, step: Step, e: unknown): string {
  if (e instanceof ReadError) return "reader: " + shown(rules, e.message);
  if (e instanceof WriterPanic) return "writer panic: " + shown(rules, e.message);
  return `${step}: ${e instanceof Error ? shown(rules, e.message) : String(e)}`;
}

function firstDifference(rules: Rules, expected: string, actual: string): string {
  const a = expected.split("\r\n");
  const b = actual.split("\r\n");
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  const excerpt = (line: string | undefined) =>
    line === undefined ? "the end of the text" : JSON.stringify(shown(rules, line).slice(0, 160));
  return `line ${k + 1} differs: the baseline has ${excerpt(a[k])}, the text written has ${excerpt(b[k])}`;
}

// Reads the bytes of a baseline with the rules of its origin and writes them again; it never throws on what the bytes hold.
export function roundTrip(bytes: Uint8Array, rules: Rules = tsgoRules): RoundTrip {
  const model = rules.model;
  const facts: RoundTripFacts = { pretty: false, codes: [] };
  let step: Step = "bytes";
  try {
    const text = model.fromBytes(bytes);
    step = "reader";
    const parsed = readErrorBaseline(rules, text);
    facts.pretty = parsed.pretty;
    facts.codes = parsed.diagnostics.map(d => d.code);
    // Through the plain form and JSON: the writer gets what the parsed form holds as data and nothing else.
    step = "plain form";
    const data = JSON.parse(JSON.stringify(toErrorBaseline(parsed))) as ErrorBaseline;
    const input = toWriterInput(rules, data.files, data.diagnostics);
    step = "writer";
    const written = getErrorBaseline(rules, input.files, input.diagnostics, data.pretty);
    if (written.failedChecks.length > 0) {
      return { ...facts, equal: false, reason: "writer: " + shown(rules, written.failedChecks.join("; ")) };
    }
    if (Buffer.compare(model.toBytes(written.text), bytes) === 0) return { ...facts, equal: true };
    return { ...facts, equal: false, reason: firstDifference(rules, text, written.text) };
  } catch (e) {
    return { ...facts, equal: false, reason: reasonOf(rules, step, e) };
  }
}

export interface BaselineFile {
  path: string;
  // The name in its directory: the stem of the instance and ".errors.txt".
  name: string;
  origin: Origin;
}

// From U+D800 on the order of the code units of two strings is not the order of their bytes.
const beyondCodeUnitOrder = /[\ud800-\uffff]/;

// Sorts in the order of the bytes; the sort of the engine without a comparer gives that order below U+D800 and costs a debug build a fraction of a comparer.
function sortNames(names: string[]): string[] {
  return names.some(name => beyondCodeUnitOrder.test(name)) ? names.sort(compareStrings) : names.sort();
}

// The error baselines that are directly in a directory, in the order of their names.
export function listErrorBaselines(directory: string, origin: Origin): BaselineFile[] {
  const names = readdirSync(directory).filter(name => name.endsWith(".errors.txt"));
  // The path is put together here: path.join for every name of the corpus costs a debug build a second.
  return sortNames(names).map(name => ({ path: `${directory}/${name}`, name, origin }));
}

export interface SampleOptions {
  // Names that are in the sample wherever they fall in the order, for each origin that has them.
  always?: readonly string[];
  // A file above this size is not taken at a distance: the next one in the order stands in for it.
  maxBytes?: number;
}

export interface SampledBaseline extends BaselineFile {
  bytes: number;
}

// A sample that is the same on every machine: the named files, then files at even distances in the order of names and origins.
export function sampleErrorBaselines(
  files: readonly BaselineFile[],
  count: number,
  options: SampleOptions = {},
): SampledBaseline[] {
  const order = [...files].sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.origin, b.origin));
  const always = new Set(options.always ?? []);
  const maxBytes = options.maxBytes ?? Infinity;
  const sizes = new Map<number, number>();
  const size = (k: number): number => {
    let bytes = sizes.get(k);
    if (bytes === undefined) sizes.set(k, (bytes = statSync(order[k].path).size));
    return bytes;
  };
  const taken = new Set<number>();
  order.forEach((file, k) => {
    if (taken.size < count && always.has(file.name)) taken.add(k);
  });
  const atDistance = Math.min(count, order.length) - taken.size;
  for (let n = 0; n < atDistance; n++) {
    const from = Math.floor((n * order.length) / atDistance);
    for (let step = 0; step < order.length; step++) {
      const k = (from + step) % order.length;
      if (taken.has(k) || size(k) > maxBytes) continue;
      taken.add(k);
      break;
    }
  }
  return [...taken].sort((a, b) => a - b).map(k => ({ ...order[k], bytes: size(k) }));
}

export interface RoundTripCount {
  files: number;
  same: number;
  pretty: number;
}

export interface RoundTripFailure {
  path: string;
  origin: Origin;
  reason: string;
}

export interface RoundTripReport extends RoundTripCount {
  origins: Record<Origin, RoundTripCount>;
  // Every file whose bytes are not the same after a read and a write, with the reason.
  failures: RoundTripFailure[];
}

export function roundTripFiles(files: readonly BaselineFile[]): RoundTripReport {
  const report: RoundTripReport = {
    files: 0,
    same: 0,
    pretty: 0,
    origins: { "typescript": { files: 0, same: 0, pretty: 0 }, "typescript-go": { files: 0, same: 0, pretty: 0 } },
    failures: [],
  };
  for (const file of files) {
    let result: RoundTrip;
    try {
      result = roundTrip(readFileSync(file.path), rulesOf(file.origin));
    } catch (e) {
      result = {
        equal: false,
        pretty: false,
        codes: [],
        reason: `not read: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    for (const count of [report, report.origins[file.origin]]) {
      count.files++;
      if (result.equal) count.same++;
      if (result.pretty) count.pretty++;
    }
    if (!result.equal) report.failures.push({ path: file.path, origin: file.origin, reason: result.reason });
  }
  return report;
}

// The report as lines: the count of each origin, then every file that is not the same, with its reason.
export function roundTripReportLines(report: RoundTripReport): string[] {
  const lines: string[] = [];
  for (const origin of origins) {
    const count = report.origins[origin];
    lines.push(
      `${origin}: ${count.same} of ${count.files} error baselines are the same bytes after a read and a write, ${count.pretty} in the pretty form`,
    );
  }
  for (const failure of report.failures) lines.push(`differs: ${failure.path}: ${failure.reason}`);
  return lines;
}
