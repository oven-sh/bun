// Extracts what the compiler's own fixtures expect. Parses the printed errors (`## Error`) and the logged ones
// (`## Logs`) in the `.expect.md` files back into reasons, descriptions and locations.
//
//   bun frames.ts <fixtures> <out.jsonl>
//
// Writes one line for each `.expect.md` that has errors (`Expected` below). A @babel/code-frame code frame has a
// location's start (`file:line:column`, with 0-based columns), and its `^` marks show the end:
//
//   > 4 |   const value = ref.current;          one line: one `^` per UTF-16 unit, but also one for an empty span
//       |                 ^^^^^^^^^^^ message
//
//   >  7 |   const object = useMemo(() => {     several lines: the last line has one more `^` than its end column
//        |                          ^^^^^^^
//   >  8 |     return identity({
//        …                                     eleven lines or more: the middle is omitted
//   > 18 |   }, [x.a.b?.c.d?.e]);
//        | ^^^^ message
//
// The fixtures are compiled with the pragmas on their first line, and every function is compiled. A linter does
// neither, so this tells you a diagnostic's location and text, not whether a linter reports it.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JsonlWriter, options, table } from "./shared.ts";

export type Place = {
  kind: "error";
  /** 1-based lines, 0-based columns in UTF-16 units, exclusive end, as in Babel's `loc`. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  /** UTF-8 byte offsets into the input. */
  start: number;
  end: number;
  message: string | null;
  /** Set for a single `^` on one line, because the span may be empty. */
  maybeEmpty?: true;
  abbreviated?: true;
};
export type Hint = { kind: "hint"; message: string };
export type ExpectedError = {
  /** `Error`, `Todo`, `Invariant`, `Compilation Skipped`. */
  heading: string | null;
  /** Only logged errors have one. */
  category: string | null;
  reason: string;
  /** Without the period that the printer appends. */
  description: string | null;
  details: (Place | Hint)[];
};
export type Expected = {
  path: string;
  /** The input's first line, if it's a comment with an `@`. */
  pragma: string | null;
  /** The N in `Found N errors`. Null if the section isn't the compiler's error list. `other` then has its text. */
  found: number | null;
  other?: string;
  errors: ExpectedError[];
  logged: ExpectedError[];
};

const HEADING = /^(Error|Todo|Invariant|Compilation Skipped): (.*)$/s;
const WHERE = /^(.+):(\d+):(\d+)$/;
const SOURCE = /^([> ]) *(\d+) \|(?: (.*))?$/;
const MARKER = /^ +\| ([ \t]*)(\^+)(?: (.*))?$/s;
const ELLIPSIS = /^ +…$/;

export class Source {
  #text: string;
  #starts: number[] = [0];
  readonly lines: string[];
  constructor(text: string) {
    this.#text = text;
    for (const match of text.matchAll(/\r\n|[\n\r\u2028\u2029]/g)) this.#starts.push(match.index + match[0].length);
    this.lines = text.split(/\r\n|[\n\r\u2028\u2029]/);
  }
  /** Converts a byte offset to a UTF-16 index. */
  index(offset: number): number {
    return Buffer.from(this.#text).subarray(0, offset).toString().length;
  }
  /** Converts a byte offset to a 1-based line and a 0-based column in UTF-16 units. */
  position(offset: number): { line: number; column: number } {
    const index = this.index(offset);
    let line = this.#starts.length;
    while (line > 1 && this.#starts[line - 1] > index) line--;
    return { line, column: index - this.#starts[line - 1] };
  }
  /** Converts a 1-based line and a 0-based column in UTF-16 units to a byte offset. */
  offset(line: number, column: number): number {
    const start = this.#starts[line - 1];
    if (start === undefined) return -1;
    return Buffer.byteLength(this.#text.slice(0, start + column));
  }
}

export const problems: string[] = [];

function frame(
  path: string,
  source: Source,
  where: RegExpExecArray | null,
  lines: string[],
  firstColumn: 0 | 1,
): Place | null {
  let first: { line: number; spacing: number; carets: number } | null = null;
  let last: { line: number; carets: number } | null = null;
  let marked = -1;
  let message: string | null = null;
  let abbreviated = false;
  for (const line of lines) {
    let match: RegExpExecArray | null;
    if (message !== null && SOURCE.exec(line) === null) {
      message += "\n" + line;
    } else if ((match = SOURCE.exec(line)) !== null) {
      const number = Number(match[2]);
      if ((match[3] ?? "") !== source.lines[number - 1]) problems.push(`${path}: line ${number} is not the input's`);
      if (match[1] === ">") marked = number;
    } else if ((match = MARKER.exec(line)) !== null) {
      first ??= { line: marked, spacing: match[1].length, carets: match[2].length };
      last = { line: marked, carets: match[2].length };
      if (match[3] !== undefined) message = match[3];
    } else if (ELLIPSIS.test(line)) {
      abbreviated = true;
    } else {
      problems.push(`${path}: not a line of a code frame: ${line}`);
      return null;
    }
  }
  if (first === null || last === null) {
    problems.push(`${path}: a code frame that marks nothing`);
    return null;
  }
  const line = where === null ? first.line : Number(where[2]);
  const column = where === null ? first.spacing : Number(where[3]) - firstColumn;
  if (line !== first.line || column !== first.spacing)
    problems.push(`${path}: ${line}:${column} is not where the ^ start`);
  const oneLine = last.line === line;
  const endColumn = oneLine ? column + last.carets : last.carets - 1;
  const place: Place = {
    kind: "error",
    line,
    column,
    endLine: last.line,
    endColumn,
    start: source.offset(line, column),
    end: source.offset(last.line, endColumn),
    message: message === null || message === "" ? null : message,
  };
  if (oneLine && last.carets === 1) place.maybeEmpty = true;
  if (abbreviated) place.abbreviated = true;
  return place;
}

/** Splits `text` into paragraphs at blank lines. */
function paragraphs(text: string): string[][] {
  const found: string[][] = [];
  let current: string[] = [];
  for (const line of text.split("\n")) {
    if (line === "") {
      if (current.length > 0) found.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) found.push(current);
  return found;
}

/**
 * Parses the errors printed in `text`. `firstColumn` is the number of the first column in `file:line:column`, which is
 * 1 in the ESLint plugin's messages.
 */
export function printed(path: string, source: Source, text: string, firstColumn: 0 | 1 = 0): ExpectedError[] {
  const errors: ExpectedError[] = [];
  let description: string[] = [];
  const flush = () => {
    const error = errors.at(-1);
    if (error === undefined || description.length === 0) return;
    error.description = description.join("\n\n").replace(/\.$/, "");
    description = [];
  };
  for (const lines of paragraphs(text)) {
    const heading = HEADING.exec(lines.join("\n"));
    const error = errors.at(-1);
    if (heading !== null) {
      flush();
      errors.push({ heading: heading[1], category: null, reason: heading[2], description: null, details: [] });
    } else if (error === undefined) {
      problems.push(`${path}: text before the first error: ${lines[0]}`);
    } else if (lines.length > 1 && WHERE.test(lines[0]) && SOURCE.test(lines[1])) {
      flush();
      const place = frame(path, source, WHERE.exec(lines[0]), lines.slice(1), firstColumn);
      if (place !== null) error.details.push(place);
    } else if (SOURCE.test(lines[0])) {
      flush();
      const place = frame(path, source, null, lines, firstColumn);
      if (place !== null) error.details.push(place);
    } else if (error.details.length === 0) {
      description.push(lines.join("\n"));
    } else {
      error.details.push({ kind: "hint", message: lines.join("\n") });
    }
  }
  flush();
  return errors;
}

type Loc = { start: { line: number; column: number }; end: { line: number; column: number } };
type LoggedDetail = { kind: "error"; loc: Loc | null; message: string | null } | { kind: "hint"; message: string };
type Logged = {
  kind: string;
  detail?: {
    category: string;
    reason: string;
    description?: string | null;
    details?: LoggedDetail[];
    loc?: Loc | null;
  };
};

function placeOf(source: Source, loc: Loc, message: string | null): Place {
  return {
    kind: "error",
    line: loc.start.line,
    column: loc.start.column,
    endLine: loc.end.line,
    endColumn: loc.end.column,
    start: source.offset(loc.start.line, loc.start.column),
    end: source.offset(loc.end.line, loc.end.column),
    message,
  };
}

function logged(path: string, source: Source, text: string): ExpectedError[] {
  const errors: ExpectedError[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith('{"kind":"CompileError"')) continue;
    let event: Logged;
    try {
      event = JSON.parse(line);
    } catch {
      problems.push(`${path}: a logged error that is not JSON`);
      continue;
    }
    const detail = event.detail;
    if (detail === undefined) continue;
    const details: (Place | Hint)[] = [];
    for (const item of detail.details ?? []) {
      if (item.kind === "hint") details.push(item);
      else if (item.loc != null && typeof item.loc === "object") details.push(placeOf(source, item.loc, item.message));
    }
    if (detail.details === undefined && detail.loc != null && typeof detail.loc === "object") {
      details.push(placeOf(source, detail.loc, null));
    }
    errors.push({
      heading: null,
      category: detail.category,
      reason: detail.reason,
      description: detail.description ?? null,
      details,
    });
  }
  return errors;
}

/** Returns the text in the code fence after `## <title>`. The last section extends to the file's last fence. */
function section(markdown: string, title: string): string | null {
  const at = markdown.indexOf(`\n## ${title}\n`);
  if (at < 0) return null;
  const open = markdown.indexOf("```\n", at);
  if (open < 0) return null;
  const next = /\n##+ /.exec(markdown.slice(open));
  const until = next === null ? markdown.length : open + next.index;
  const close = markdown.lastIndexOf("\n```", until);
  return close <= open ? null : markdown.slice(open + 4, close);
}

function inputOf(dir: string, base: string): string | null {
  for (const extension of ["js", "jsx", "ts", "tsx", "mjs"]) {
    if (existsSync(join(dir, `${base}.${extension}`))) return `${base}.${extension}`;
  }
  return null;
}

if (import.meta.main) {
  const { rest } = options(process.argv.slice(2));
  if (rest.length !== 2) throw new Error("usage: bun frames.ts <fixtures> <out.jsonl>");
  const fixtures = resolve(rest[0]);
  const writer = new JsonlWriter(resolve(rest[1]));
  const counts = { files: 0, sections: 0, other: 0, errors: 0, places: 0, hints: 0, abbreviated: 0, maybeEmpty: 0 };
  const log = { files: 0, errors: 0, places: 0 };
  const headings = new Map<string, number>();
  const names = (readdirSync(fixtures, { recursive: true }) as string[]).filter(name => name.endsWith(".expect.md"));
  for (const name of names.sort()) {
    counts.files++;
    const markdown = readFileSync(join(fixtures, name), "utf8");
    const error = section(markdown, "Error");
    const logs = section(markdown, "Logs");
    if (error === null && logs === null) continue;
    const path = inputOf(fixtures, name.slice(0, -".expect.md".length));
    if (path === null) {
      problems.push(`${name}: no input`);
      continue;
    }
    const text = readFileSync(join(fixtures, path), "utf8");
    const source = new Source(text);
    const expected: Expected = {
      path,
      pragma: /^(?:\/\/|\/\*).*@/.test(source.lines[0]) ? source.lines[0] : null,
      found: null,
      errors: [],
      logged: logs === null ? [] : logged(path, source, logs),
    };
    if (error !== null) {
      counts.sections++;
      const found = /^Found (\d+) errors?:\n\n/.exec(error);
      if (found === null) {
        counts.other++;
        expected.other = error;
      } else {
        expected.found = Number(found[1]);
        expected.errors = printed(path, source, error.slice(found[0].length));
        if (expected.errors.length !== expected.found) {
          problems.push(`${path}: Found ${expected.found} errors, ${expected.errors.length} were read`);
        }
      }
    }
    if (expected.found === null && expected.other === undefined && expected.logged.length === 0) continue;
    for (const item of expected.errors) {
      counts.errors++;
      headings.set(item.heading!, (headings.get(item.heading!) ?? 0) + 1);
      for (const detail of item.details) {
        if (detail.kind === "hint") counts.hints++;
        else {
          counts.places++;
          if (detail.abbreviated) counts.abbreviated++;
          if (detail.maybeEmpty) counts.maybeEmpty++;
          if (detail.start < 0 || detail.end < detail.start) problems.push(`${path}: a place that is not in the input`);
        }
      }
    }
    if (expected.logged.length > 0) log.files++;
    for (const item of expected.logged) {
      log.errors++;
      log.places += item.details.filter(detail => detail.kind === "error").length;
    }
    writer.write(expected);
  }
  writer.close();
  console.log(
    table(
      [
        "Expectations",
        "With ## Error",
        "Not a list of errors",
        "Errors",
        "Code frames",
        "Abbreviated",
        "One ^",
        "Hints",
      ],
      [
        [
          counts.files,
          counts.sections,
          counts.other,
          counts.errors,
          counts.places,
          counts.abbreviated,
          counts.maybeEmpty,
          counts.hints,
        ],
      ],
    ),
  );
  console.log();
  console.log(
    table(
      ["Heading", "Errors"],
      [...headings].sort((a, b) => b[1] - a[1]),
    ),
  );
  console.log();
  console.log(table(["Files with logged errors", "Errors", "Places"], [[log.files, log.errors, log.places]]));
  console.log();
  console.log(`${problems.length} problems`);
  for (const problem of problems.slice(0, 40)) console.log(`  ${problem}`);
}
