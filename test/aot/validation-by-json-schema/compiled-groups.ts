// Turns groups of (JSON Schema, JSON texts) into a TypeScript program, compiles it with `bun build --compile --aot`, runs it and judges the verdicts.
// Each group is a module of its own, so a build error says which group it refuses. Nothing that is generated here is kept.
import { bunExe, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { run } from "../harness/run";
import { type Draft, type Refusals, isPlaceOf, whatTheBuildRefuses } from "./what-the-build-refuses";

/** `"closed"`: the value is refused, or the check throws something else. It is never accepted. */
export type Expected = boolean | "closed" | "RangeError";

export interface Case {
  description: string;
  text: string;
  expected: Expected;
}

/** A value that no JSON text spells. `source` is a TypeScript expression. Only `validate` can be given it. */
export interface ValueCase {
  description: string;
  source: string;
  expected: Expected;
}

/** A type that is written by hand, in place of a schema. A build error about it holds one of the names. */
export interface WrittenType {
  type: string;
  declarations?: string;
  must?: string[];
  may?: string[];
}

export interface Group {
  name: string;
  schema?: unknown;
  written?: WrittenType;
  draft: Draft;
  documents?: Record<string, unknown>;
  /** The build may also refuse the schema for its size, if the error holds one of these. */
  may?: string[];
  cases: Case[];
  values?: ValueCase[];
}

export interface Outcome {
  group: Group;
  /** What the build said about the group's module, if it refused it. */
  refusedWith?: string;
  /** `verdicts[case][way]`: "accepted", "accepted, and handed back another value", "refused" or "threw <name>". The values come after the texts. */
  verdicts: Record<string, string>[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** TypeScript source of a JSON value. `"__proto__": x` in an object literal would set the prototype, so that key is computed. */
export function literalOf(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(literalOf).join(", ") + "]";
  if (isObject(value)) {
    const members = Object.entries(value).map(
      ([key, inner]) => `${key === "__proto__" ? '["__proto__"]' : JSON.stringify(key)}: ${literalOf(inner)}`,
    );
    return "{ " + members.join(", ") + " }";
  }
  if (value === Infinity || value === -Infinity) return value > 0 ? "1e400" : "-1e400";
  return Object.is(value, -0) ? "-0" : JSON.stringify(value);
}

/** The same JSON value with each whole number written as `1.0`. To JSON Schema it is the same value. */
export function withWholeNumbersAsFloats(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(withWholeNumbersAsFloats).join(",") + "]";
  if (isObject(value)) {
    return "{" + Object.entries(value).map(([key, inner]) => JSON.stringify(key) + ":" + withWholeNumbersAsFloats(inner)).join(",") + "}";
  }
  if (value === Infinity || value === -Infinity) return value > 0 ? "1e400" : "-1e400";
  const text = JSON.stringify(value);
  return typeof value === "number" && /^-?\d+$/.test(text) ? text + ".0" : text;
}

/** A type has no option for the draft: the schema says it. */
function withDialect(schema: unknown, draft: Draft): unknown {
  if (draft !== "draft-07" || !isObject(schema) || Object.hasOwn(schema, "$schema")) return schema;
  return { $schema: "http://json-schema.org/draft-07/schema#", ...schema };
}

/** The one place that spells the type of a group. */
function typeOf(group: Group): string {
  if (group.written) return group.written.type;
  return group.documents ? "Schema.FromJSONSchema<typeof schema, typeof documents>" : "Schema.FromJSONSchema<typeof schema>";
}

// The reader of an accepted value tests nothing further, so an accept is right only if it hands back what was handed in:
// the same own keys in the same order, as data, on an ordinary prototype, and the same values, `-0` and `"__proto__"` too.
const reportModule = `
function isSame(result: unknown, expected: unknown): boolean {
  if (typeof expected !== "object" || expected === null) return Object.is(result, expected);
  if (typeof result !== "object" || result === null) return false;
  if (Object.getPrototypeOf(result) !== Object.getPrototypeOf(expected)) return false;
  const keys = Reflect.ownKeys(expected);
  const found = Reflect.ownKeys(result);
  if (keys.length !== found.length) return false;
  for (let index = 0; index < keys.length; index++) {
    if (keys[index] !== found[index]) return false;
    const held = Object.getOwnPropertyDescriptor(result, keys[index])!;
    const wanted = Object.getOwnPropertyDescriptor(expected, keys[index])!;
    if (!("value" in held) || held.enumerable !== wanted.enumerable || !isSame(held.value, wanted.value)) return false;
  }
  return true;
}

function verdictOf(check: () => unknown, expected: () => unknown): string {
  let result: unknown;
  try {
    result = check();
  } catch (error) {
    if (error instanceof TypeError) {
      const issues = (error as TypeError & { issues?: unknown }).issues;
      if (Array.isArray(issues) && issues.length > 0) return "refused";
    }
    return "threw " + (error instanceof Error ? error.name : typeof error);
  }
  return isSame(result, expected()) ? "accepted" : "accepted, and handed back another value";
}

export function report(
  group: number,
  texts: string[],
  asFloats: (string | null)[],
  values: (() => unknown)[],
  byValue: (value: unknown) => unknown,
  byText: (text: string) => unknown,
) {
  const parse = globalThis.JSON.parse;
  for (let index = 0; index < texts.length; index++) {
    const text = texts[index];
    console.log(group + "\\t" + index + "\\tvalidate\\t" + verdictOf(() => byValue(parse(text)), () => parse(text)));
    console.log(group + "\\t" + index + "\\tparse\\t" + verdictOf(() => byText(text), () => parse(text)));
    const other = asFloats[index];
    if (other !== null) console.log(group + "\\t" + index + "\\tparse 1.0\\t" + verdictOf(() => byText(other), () => parse(other)));
  }
  for (let index = 0; index < values.length; index++) {
    const value = values[index]();
    console.log(group + "\\t" + (texts.length + index) + "\\tvalidate\\t" + verdictOf(() => byValue(value), () => value));
  }
}
`;

function moduleOf(group: Group, index: number): string {
  const asFloats = group.cases.map(({ text }) => {
    const other = withWholeNumbersAsFloats(JSON.parse(text));
    return other === JSON.stringify(JSON.parse(text)) ? null : other;
  });
  return [
    `import { JSON, type Schema } from "bun";`,
    `import { validate } from "bun:bundle";`,
    `import { report } from "./report";`,
    ...(group.written
      ? [group.written.declarations ?? ""]
      : [`const schema = ${literalOf(withDialect(group.schema, group.draft))} as const;`]),
    ...(group.documents ? [`const documents = ${literalOf(group.documents)} as const;`] : []),
    `type Accepted = ${typeOf(group)};`,
    `export function run() {`,
    `  report(${index}, ${JSON.stringify(group.cases.map(({ text }) => text))}, ${JSON.stringify(asFloats)},`,
    `    [${(group.values ?? []).map(({ source }) => `() => (${source})`).join(", ")}],`,
    `    value => validate<Accepted>(value), text => JSON.parse<Accepted>(text));`,
    `}`,
    ``,
  ].join("\n");
}

function mainOf(indices: number[]): string {
  return [
    ...indices.map(index => `import { run as run${index} } from "./group-${index}";`),
    ...indices.map(index => `run${index}();`),
    `console.log("done");`,
    ``,
  ].join("\n");
}

function whatIsSaidOfEachGroup(output: string): Map<number, string> {
  const lines = output.split("\n");
  const said = new Map<number, string>();
  lines.forEach((line, at) => {
    for (const [, index] of line.matchAll(/group-(\d+)\.ts/g)) {
      const about = lines.slice(Math.max(0, at - 4), at + 3).join("\n");
      said.set(Number(index), (said.get(Number(index)) ?? "") + about + "\n");
    }
  });
  return said;
}

const width = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4)));
let active = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (active >= width) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

export function compileAndRun(name: string, groups: Group[]): Promise<Outcome[]> {
  return inTurn(async () => {
    const outcomes: Outcome[] = groups.map(group => ({ group, verdicts: [...group.cases, ...(group.values ?? [])].map(() => ({})) }));
    if (groups.length === 0) return outcomes;
    const files: Record<string, string> = { "report.ts": reportModule };
    groups.forEach((group, index) => (files[`group-${index}.ts`] = moduleOf(group, index)));
    using dir = tempDir("json-schema-" + name.replaceAll(/[^A-Za-z0-9-]/g, "-"), files);
    const executable = join(String(dir), process.platform === "win32" ? "program.exe" : "program");

    let remaining = groups.map((_, index) => index);
    for (;;) {
      if (remaining.length === 0) return outcomes;
      writeFileSync(join(String(dir), "main.ts"), mainOf(remaining));
      const built = await run([bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", executable], String(dir));
      if (built.exitCode === 0) break;
      const output = built.stdout + "\n" + built.stderr;
      if (/panic|Segmentation fault|SIGSEGV|SIGABRT|SIGBUS|SIGILL|ASSERTION FAILED|AddressSanitizer|oh no: Bun has crashed/.test(output)) {
        throw new Error(`the build of ${name} crashed (exit code ${built.exitCode}):\n${output.slice(-4000)}`);
      }
      const said = whatIsSaidOfEachGroup(output);
      const refused = remaining.filter(index => said.has(index));
      if (refused.length === 0) {
        throw new Error(`the build of ${name} failed (exit code ${built.exitCode}) and names no group:\n${output.slice(-4000)}`);
      }
      for (const index of refused) outcomes[index].refusedWith = said.get(index)!;
      remaining = remaining.filter(index => !said.has(index));
    }

    const ran = await run([executable], String(dir));
    const lines = ran.stdout.split("\n").filter(line => line !== "");
    if (ran.exitCode !== 0 || lines.at(-1) !== "done") {
      throw new Error(`the program of ${name} ended with exit code ${ran.exitCode} after ${lines.length} lines:\n${ran.stderr.slice(-4000)}`);
    }
    for (const line of lines.slice(0, -1)) {
      const [group, index, way, verdict] = line.split("\t");
      outcomes[Number(group)].verdicts[Number(index)][way] = verdict;
    }
    return outcomes;
  });
}

const errorLinesOf = (said: string) => said.split("\n").filter(line => /error/i.test(line));
const inExpression = (text: string) => text.replace(/[$/\\.*+?()[\]{}|^-]/g, "\\$&");

/**
 * The places that the lines of the error itself give for a name, `""` where they give none, and nothing if they do not name it.
 * A name ends a quotation: 'keyword', 'member: keyword', 'keyword at #/properties/a', 'keyword at http://x.test/a#'. The source of a regular expression may stand between slashes.
 * The excerpt of the source beside the error holds every keyword of the schema, and so may the text of a type.
 */
export function placesNamed(said: string, name: string): string[] {
  const quote = /^[\w$ ]+$/.test(name) ? "[\"'`]" : "[\"'`/]";
  const named = new RegExp("(?:" + quote + "|: )" + inExpression(name) + "(?: at ([^\"'`]*))?" + quote, "g");
  return errorLinesOf(said).flatMap(line => [...line.matchAll(named)].map(([, place]) => place ?? ""));
}

export const names = (said: string, name: string) => placesNamed(said, name).length > 0;

/** For a type that is written by hand the error may also spell the alias as the program does: `Schema.Message`. */
export function mentions(said: string, name: string): boolean {
  const word = new RegExp("(?<![A-Za-z0-9_])" + inExpression(name) + "(?![A-Za-z0-9_])");
  return errorLinesOf(said).some(line => word.test(line));
}

export function refusalsOf({ written, schema, draft, documents, may = [] }: Group): Refusals {
  if (written) return { must: new Set(written.must), may: new Set(written.may), places: new Map() };
  const refusals = whatTheBuildRefuses(schema, draft, documents);
  for (const name of may) if (!refusals.must.has(name)) refusals.may.add(name);
  return refusals;
}

function isRight(expected: Expected, verdict: string | undefined): boolean {
  if (expected === true) return verdict === "accepted";
  if (expected === false) return verdict === "refused";
  if (expected === "closed") return verdict === "refused" || verdict?.startsWith("threw ") === true;
  return verdict === "threw RangeError";
}

function kindOf(expected: Expected, verdict: string | undefined): string {
  if (verdict?.startsWith("accepted")) return expected === true ? "HANDS BACK ANOTHER VALUE" : "ACCEPTS WHAT IS INVALID";
  if (verdict === "refused" && expected === true) return "REFUSES WHAT IS VALID";
  return verdict === undefined ? "NO VERDICT" : "ENDS ANOTHER WAY";
}

/**
 * What is wrong, one line each. `notYet` excuses a build error at a group that has a translation, by the group's name.
 * Nothing excuses a wrong verdict, and nothing excuses a build that takes a keyword it cannot translate.
 */
export function judge(outcomes: Outcome[], notYet: Record<string, string> = {}): string[] {
  const wrong: string[] = [];
  for (const { group, refusedWith, verdicts } of outcomes) {
    const refusals = refusalsOf(group);
    const { must, may } = refusals;
    if (refusedWith !== undefined) {
      const reasons = [...must, ...may];
      const summary = errorLinesOf(refusedWith)[0]?.trim() ?? refusedWith.slice(0, 200);
      const isNamed = (name: string) =>
        names(refusedWith, name) || ((group.written !== undefined || group.may?.includes(name) === true) && mentions(refusedWith, name));
      if (reasons.length === 0) {
        if (!Object.hasOwn(notYet, group.name)) wrong.push(`REFUSED AT BUILD TIME, THOUGH EACH KEYWORD HAS A TRANSLATION | ${group.name} | ${summary}`);
      } else if (!reasons.some(isNamed)) {
        wrong.push(`THE BUILD ERROR NAMES NONE OF ${reasons.join(", ")} | ${group.name} | ${summary}`);
      } else if (!group.written) {
        for (const name of reasons) {
          for (const place of placesNamed(refusedWith, name)) {
            if (place.startsWith("#") && !isPlaceOf(refusals, name, place)) wrong.push(`THE BUILD ERROR NAMES A PLACE WHERE ${name} IS NOT AT FAULT | ${group.name} | ${summary}`);
          }
        }
      }
      continue;
    }
    if (Object.hasOwn(notYet, group.name)) wrong.push(`LISTED AS NOT YET COMPILED, BUT IT IS | ${group.name}`);
    if (must.size > 0) wrong.push(`COMPILED, THOUGH ${[...must].join(", ")} HAS NO TRANSLATION | ${group.name}`);
    const cases = [
      ...group.cases.map(({ description, text, expected }) => ({ description, shown: text, expected, isText: true })),
      ...(group.values ?? []).map(({ description, source, expected }) => ({ description, shown: source, expected, isText: false })),
    ];
    cases.forEach(({ description, shown, expected, isText }, index) => {
      const ways = verdicts[index];
      for (const way of isText ? ["validate", "parse", ...("parse 1.0" in ways ? ["parse 1.0"] : [])] : ["validate"]) {
        if (isRight(expected, ways[way])) continue;
        wrong.push(`${kindOf(expected, ways[way])} | ${group.name} | ${description.slice(0, 120)} | ${shown.slice(0, 120)} | ${way}: ${ways[way]}, expected ${expected}`);
      }
    });
  }
  return wrong;
}

/** One line for the log: how much of the groups is machine code, and which keywords stand in the way of the rest. */
export function summaryOf(name: string, outcomes: Outcome[]): string {
  const compiled = outcomes.filter(outcome => outcome.refusedWith === undefined);
  const byKeyword = new Map<string, number>();
  for (const { group, refusedWith } of outcomes) {
    if (refusedWith === undefined) continue;
    const { must, may } = refusalsOf(group);
    const keyword = [...must, ...may].find(keyword => names(refusedWith, keyword)) ?? "?";
    byKeyword.set(keyword, (byKeyword.get(keyword) ?? 0) + 1);
  }
  const cases = compiled.reduce((sum, { group }) => sum + group.cases.length + (group.values ?? []).length, 0);
  const refused = [...byKeyword].sort((a, b) => b[1] - a[1]).map(([keyword, count]) => `${keyword} ${count}`);
  return `${name}: ${compiled.length} of ${outcomes.length} groups compiled (${cases} cases); refused at build time by keyword: ${refused.join(", ") || "none"}`;
}
