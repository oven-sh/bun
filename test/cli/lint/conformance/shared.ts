// Code shared by `extract-eslint.ts` and `extract-typescript-eslint.ts`.
//
// Nothing in here knows how a RuleTester merges its configs. It only knows how
// to turn what the real `Linter` reported into the fixture format, how to
// compare that with what the upstream test asserted, and how to fan the work
// out over child processes.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Fixture format
// ---------------------------------------------------------------------------

export interface Fix {
  range: [number, number];
  text: string;
}

export interface FixtureSuggestion {
  messageId: string | null;
  desc: string;
  fix: Fix;
  /** The code after applying only this suggestion. */
  output: string;
}

export interface FixtureMessage {
  /**
   * Only present when the message does not come from the rule under test: a
   * rule enabled by an `/* eslint other-rule: 2 *\/` comment in the code, or
   * `null` for a problem ESLint itself reports about a directive comment.
   */
  ruleId?: string | null;
  messageId: string | null;
  message: string;
  line: number;
  column: number;
  endLine: number | null;
  endColumn: number | null;
  fix: Fix | null;
  suggestions: FixtureSuggestion[];
}

export interface FixtureLanguageOptions {
  parser: "espree" | "typescript" | "other";
  ecmaVersion: number | "latest" | null;
  sourceType: "module" | "script" | "commonjs" | null;
  globals: Record<string, unknown> | null;
  parserOptions: Record<string, unknown> | null;
}

export interface FixtureCase {
  valid: boolean;
  name: string | null;
  code: string;
  filename: string;
  options: unknown[];
  languageOptions: FixtureLanguageOptions;
  settings: Record<string, unknown> | null;
  typeAware: boolean;
  tsconfig: string | null;
  /** The parser with a hard-coded AST that the upstream test names, if a real one took its place. */
  upstreamParser?: string | null;
  skip: string | null;
  messages: FixtureMessage[];
  output: string | null;
}

export interface FixtureMeta {
  type: string | null;
  fixable: "code" | "whitespace" | null;
  hasSuggestions: boolean;
  deprecated: boolean;
  recommended: unknown;
  requiresTypeChecking: boolean;
  extendsBaseRule: unknown;
  messages: Record<string, string>;
  schema: unknown;
  defaultOptions: unknown;
}

export interface Fixture {
  plugin: "eslint" | "typescript-eslint";
  rule: string;
  meta: FixtureMeta;
  cases: FixtureCase[];
}

/**
 * Upstream has a few generated stress tests (a string literal of a million
 * backslashes). They would be megabytes of JSON each, so they are left out.
 */
export const MAX_CODE_LENGTH = 50_000;

/** One place where real ESLint and the upstream assertion do not agree. */
export interface Disagreement {
  rule: string;
  /** Index into `cases` of the fixture. */
  index: number;
  code: string;
  skip: string | null;
  problems: string[];
}

/** What a worker leaves behind for the parent, next to the fixture itself. */
export interface RuleReport {
  rule: string;
  disagreements: Disagreement[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// The slice of ESLint's API that is used
// ---------------------------------------------------------------------------

export interface LintMessage {
  ruleId: string | null;
  message: string;
  messageId?: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  fatal?: boolean;
  fix?: Fix;
  suggestions?: { desc: string; messageId?: string; fix: Fix }[];
}

/** `lib/linter/source-code-fixer.js` */
export interface SourceCodeFixer {
  applyFixes(code: string, messages: { fix?: Fix }[], shouldFix?: boolean): { fixed: boolean; output: string };
}

export interface RuleModule {
  meta?: Record<string, any>;
  defaultOptions?: unknown;
  create: Function;
}

// ---------------------------------------------------------------------------
// Linter result -> fixture
// ---------------------------------------------------------------------------

const copyFix = (fix: Fix): Fix => ({ range: [fix.range[0], fix.range[1]], text: fix.text });

export function toFixtureMessages(
  code: string,
  messages: LintMessage[],
  ruleId: string,
  fixer: SourceCodeFixer,
): FixtureMessage[] {
  return messages.map(m => ({
    ...(m.ruleId === ruleId ? {} : { ruleId: m.ruleId }),
    messageId: m.messageId ?? null,
    message: m.message,
    line: m.line,
    column: m.column,
    endLine: m.endLine ?? null,
    endColumn: m.endColumn ?? null,
    fix: m.fix ? copyFix(m.fix) : null,
    suggestions: (m.suggestions ?? []).map(s => ({
      messageId: s.messageId ?? null,
      desc: s.desc,
      fix: copyFix(s.fix),
      output: fixer.applyFixes(code, [s]).output,
    })),
  }));
}

/** One pass of `--fix`, or `null` if nothing is fixable. */
export function onePassOutput(code: string, messages: LintMessage[], fixer: SourceCodeFixer): string | null {
  return messages.some(m => m.fix) ? fixer.applyFixes(code, messages).output : null;
}

export function toFixtureMeta(rule: RuleModule): FixtureMeta {
  const meta = rule.meta ?? {};
  const docs = meta.docs ?? {};
  return {
    type: meta.type ?? null,
    fixable: meta.fixable ?? null,
    hasSuggestions: Boolean(meta.hasSuggestions),
    deprecated: Boolean(meta.deprecated),
    recommended: docs.recommended ?? null,
    requiresTypeChecking: Boolean(docs.requiresTypeChecking),
    extendsBaseRule: docs.extendsBaseRule ?? null,
    messages: meta.messages ?? {},
    schema: meta.schema ?? null,
    defaultOptions: meta.defaultOptions ?? rule.defaultOptions ?? null,
  };
}

/**
 * The JSON-serializable part of a value: functions, class instances (a
 * `ts.Program`, a parser object, ...) and `undefined` are dropped. `dropped`
 * collects the paths that were removed so the caller can decide to skip.
 */
export function jsonPart(value: unknown, dropped: string[] = [], path = ""): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((v, i) => jsonPart(v, dropped, `${path}[${i}]`) ?? null);
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      dropped.push(path);
      return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const part = jsonPart(v, dropped, path ? `${path}.${key}` : key);
      if (part !== undefined) out[key] = part;
    }
    return out;
  }
  if (value !== undefined) dropped.push(path);
  return undefined;
}

export const nullIfEmpty = <T extends object>(value: T | null | undefined): T | null =>
  value && Object.keys(value).length > 0 ? value : null;

// ---------------------------------------------------------------------------
// Sanity check against what upstream asserted
// ---------------------------------------------------------------------------

export interface UpstreamCase {
  code: string;
  errors?: number | unknown[];
  /** typescript-eslint allows an array: one entry per `--fix` pass. */
  output?: string | string[] | null;
}

type Interpolate = (template: string, data: Record<string, unknown>) => string;

function matches(actual: string, expected: unknown): boolean {
  return expected instanceof RegExp ? expected.test(actual) : actual === expected;
}

/**
 * Checks everything the upstream test case asserts (the same things the real
 * RuleTesters check) against the recorded result. Returns one line per
 * mismatch.
 */
export function compareWithUpstream(
  upstream: UpstreamCase,
  valid: boolean,
  result: Pick<FixtureCase, "messages" | "output">,
  rule: RuleModule,
  interpolate: Interpolate,
): string[] {
  const problems: string[] = [];
  const { messages } = result;
  const templates: Record<string, string> = rule.meta?.messages ?? {};

  if (valid) {
    if (messages.length > 0) problems.push(`valid case reported ${messages.length} message(s): ${messages[0].message}`);
    return problems;
  }

  const { errors } = upstream;
  const expectedCount = typeof errors === "number" ? errors : (errors?.length ?? 0);
  if (messages.length !== expectedCount) {
    problems.push(`expected ${expectedCount} error(s), got ${messages.length}`);
  } else if (Array.isArray(errors)) {
    errors.forEach((expected: any, i) => {
      const actual = messages[i];
      if (typeof expected === "string" || expected instanceof RegExp) {
        if (!matches(actual.message, expected)) problems.push(`errors[${i}].message: ${actual.message} != ${expected}`);
        if (actual.suggestions.length > 0) problems.push(`errors[${i}]: unexpected suggestions`);
        return;
      }
      if ("message" in expected && !matches(actual.message, expected.message)) {
        problems.push(`errors[${i}].message: ${actual.message} != ${expected.message}`);
      }
      if ("messageId" in expected) {
        if (actual.messageId !== expected.messageId) {
          problems.push(`errors[${i}].messageId: ${actual.messageId} != ${expected.messageId}`);
        } else if (expected.data) {
          const message = interpolate(templates[expected.messageId], expected.data);
          if (actual.message !== message) problems.push(`errors[${i}].data: ${actual.message} != ${message}`);
        }
      }
      for (const key of ["line", "column", "endLine", "endColumn"] as const) {
        if (key in expected && (actual[key] ?? undefined) !== expected[key]) {
          problems.push(`errors[${i}].${key}: ${actual[key]} != ${expected[key]}`);
        }
      }
      const suggestions = expected.suggestions ?? [];
      const suggestionCount = typeof suggestions === "number" ? suggestions : suggestions.length;
      if (actual.suggestions.length !== suggestionCount) {
        problems.push(`errors[${i}].suggestions: expected ${suggestionCount}, got ${actual.suggestions.length}`);
      } else if (Array.isArray(suggestions)) {
        suggestions.forEach((s: any, j: number) => {
          const got = actual.suggestions[j];
          const at = `errors[${i}].suggestions[${j}]`;
          if ("desc" in s && got.desc !== s.desc) problems.push(`${at}.desc: ${got.desc} != ${s.desc}`);
          if ("messageId" in s) {
            if (got.messageId !== s.messageId) problems.push(`${at}.messageId: ${got.messageId} != ${s.messageId}`);
            else if (s.data && got.desc !== interpolate(templates[s.messageId], s.data)) problems.push(`${at}.data`);
          }
          if ("output" in s && got.output !== s.output) problems.push(`${at}.output differs`);
        });
      }
    });
  }

  // No `output`, `output: null` and `output: <the code>` all mean "no fix".
  const firstPass = Array.isArray(upstream.output) ? upstream.output[0] : upstream.output;
  const expectedOutput = firstPass ?? upstream.code;
  if ((result.output ?? upstream.code) !== expectedOutput) problems.push("output differs");

  return problems;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** `{ "a": 1, "b": [0, 9] }` */
function inline(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${value.map(inline).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

/**
 * `JSON.stringify(value, null, 1)`, except that an array or object that fits
 * in `width` columns stays on one line. A third of the size, and a message or
 * a fix reads as one line in a diff.
 */
export function stringify(value: unknown, width = 120, indent = ""): string {
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const flat = inline(value);
  if (indent.length + flat.length <= width) return flat;
  const inner = indent + " ";
  const items = Array.isArray(value)
    ? value.map(v => inner + stringify(v, width, inner))
    : Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringify(v, width, inner)}`);
  const [open, close] = Array.isArray(value) ? "[]" : "{}";
  return `${open}\n${items.join(",\n")}\n${indent}${close}`;
}

export function writeJson(file: string, value: unknown): void {
  // The round trip drops `undefined` properties.
  const json = stringify(JSON.parse(JSON.stringify(value)));
  // ASCII only: the tests are full of BOMs, zero-width characters, U+2028 and
  // combining marks that no diff or editor would show.
  const ascii = json.replace(/[\u007f-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  writeFileSync(file, ascii + "\n");
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8"));
}

// ---------------------------------------------------------------------------
// Command line + process pool
// ---------------------------------------------------------------------------

export interface Args {
  /** Rules to (re)generate; empty means all of them. */
  rules: string[];
  jobs: number;
  /** Set in child processes: run these rules in-process. */
  worker: boolean;
  out: string;
  /** Where the per-rule `RuleReport`s and the merged `report.json` go. */
  report: string;
}

export function parseArgs(plugin: Fixture["plugin"], scriptDir: string): Args {
  const args: Args = {
    rules: [],
    jobs: availableParallelism(),
    worker: false,
    out: join(scriptDir, "fixtures", plugin),
    report: join(scriptDir, ".report", plugin),
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--worker") args.worker = true;
    else if (arg === "--jobs") args.jobs = Number(argv[++i]);
    else if (arg === "--out") args.out = resolve(argv[++i]);
    else if (arg === "--report") args.report = resolve(argv[++i]);
    else if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    else args.rules.push(arg);
  }
  return args;
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} must point at the upstream checkout. See README.md.`);
    process.exit(1);
  }
  return value;
}

/**
 * Runs `node script --worker <rule>` once per rule, `jobs` at a time. One
 * process per rule keeps a test file that touches global state
 * (`setDefaultConfig`, the TypeScript program caches) from leaking into the
 * next one.
 *
 * The workers always run on Node.js (>= 23.6, for type stripping), whatever
 * runs the parent: ESLint is developed and tested on V8, and Bun 1.4.3 loads
 * the upstream tests wrong (String.raw`👍` evaluates to "\\u{1f44d}").
 */
export async function runWorkers(script: string, rules: string[], args: Args, nodeArgs: string[] = []): Promise<void> {
  if (args.rules.length === 0) {
    rmSync(args.out, { recursive: true, force: true });
    rmSync(args.report, { recursive: true, force: true });
  }
  mkdirSync(args.out, { recursive: true });
  mkdirSync(args.report, { recursive: true });

  const queue = [...rules];
  const failed: string[] = [];
  let done = 0;
  const runOne = (rule: string) =>
    new Promise<void>(resolve => {
      const child = spawn(
        process.env.NODE ?? "node",
        [
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          ...nodeArgs,
          script,
          "--worker",
          "--out",
          args.out,
          "--report",
          args.report,
          rule,
        ],
        { stdio: ["ignore", "inherit", "inherit"] },
      );
      child.on("exit", code => {
        if (code !== 0) failed.push(rule);
        if (++done % 25 === 0 || done === rules.length) console.error(`${done}/${rules.length}`);
        resolve();
      });
    });
  await Promise.all(
    Array.from({ length: Math.min(args.jobs, rules.length) }, async () => {
      for (let rule = queue.shift(); rule !== undefined; rule = queue.shift()) await runOne(rule);
    }),
  );
  if (failed.length > 0) {
    console.error(`workers failed for: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}
