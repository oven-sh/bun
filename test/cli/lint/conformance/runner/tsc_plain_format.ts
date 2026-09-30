// The plain format of tsc, as a lint run prints it on stderr when stderr is no terminal: the reader and its inverse.
import type { DiagnosticCategory } from "./shape";

export interface PlainChain {
  messageText: string;
  next?: PlainChain[];
}

export interface PlainDiagnostic extends PlainChain {
  // As printed. Absent: the diagnostic has no file.
  path?: string;
  // 1-based line, and 1-based column in UTF-16 code units. Both are there when the path is.
  line?: number;
  character?: number;
  category: DiagnosticCategory;
  // "TS2322" is the code 2322. Any other token is a name, of a rule or of the command, and the code is absent.
  code?: number;
  rule?: string;
  // 1-based line of the text where the diagnostic starts.
  at: number;
}

export type PlainParse =
  | { ok: true; diagnostics: PlainDiagnostic[] }
  | { ok: false; at: number; text: string; reason: string };

// A line that starts with a category has no file: "error TS5023: Unknown compiler option 'x'."
const globalHead = /^(error|warning|suggestion|message) (?:TS(-?\d+)|([A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$/s;
// The first "(line,column): category code: " ends the name of the file, which may hold spaces and parentheses.
const locatedHead =
  /^(\S.*?)\((\d+),(\d+)\): (error|warning|suggestion|message) (?:TS(-?\d+)|([A-Za-z@][A-Za-z0-9@/_-]*)): (.*)$/s;

// A text that has a line of no known form is refused whole: a crash report must never read as an empty list.
export function parsePlainDiagnostics(text: string): PlainParse {
  const diagnostics: PlainDiagnostic[] = [];
  if (text.length === 0) return { ok: true, diagnostics };
  const lines = text.split("\n");
  // Every diagnostic ends with a line break, so the text does.
  if (lines[lines.length - 1] !== "") {
    return { ok: false, at: lines.length, text: lines[lines.length - 1], reason: "the last line has no line break" };
  }
  lines.pop();
  // The chain that is open at each level; open[0] is the diagnostic itself.
  let open: PlainChain[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.endsWith("\r")) line = line.slice(0, -1);
    let m = globalHead.exec(line);
    if (m !== null) {
      const d: PlainDiagnostic = { category: m[1] as DiagnosticCategory, messageText: m[4], at: i + 1 };
      if (m[2] !== undefined) d.code = Number(m[2]);
      else d.rule = m[3];
      diagnostics.push(d);
      open = [d];
      continue;
    }
    m = locatedHead.exec(line);
    if (m !== null) {
      const d: PlainDiagnostic = {
        path: m[1],
        line: Number(m[2]),
        character: Number(m[3]),
        category: m[4] as DiagnosticCategory,
        messageText: m[7],
        at: i + 1,
      };
      if (m[5] !== undefined) d.code = Number(m[5]);
      else d.rule = m[6];
      if (d.line === 0 || d.character === 0) {
        return { ok: false, at: i + 1, text: line, reason: "line and column are 1-based" };
      }
      diagnostics.push(d);
      open = [d];
      continue;
    }
    let spaces = 0;
    while (spaces < line.length && line.charCodeAt(spaces) === 0x20) spaces++;
    if (spaces < 2 || spaces === line.length) {
      return { ok: false, at: i + 1, text: line, reason: "neither a diagnostic nor a line of a message chain" };
    }
    if (open.length === 0) {
      return { ok: false, at: i + 1, text: line, reason: "a line of a message chain before any diagnostic" };
    }
    // Two spaces per level, and a level is at most one below the line before: what is left belongs to the text.
    const level = Math.min(spaces >> 1, open.length);
    const node: PlainChain = { messageText: line.slice(level * 2) };
    const parent = open[level - 1];
    (parent.next ??= []).push(node);
    open = open.slice(0, level);
    open.push(node);
  }
  return { ok: true, diagnostics };
}

// The text again: the inverse of parsePlainDiagnostics for a text with LF line breaks.
export function writePlainDiagnostics(diagnostics: readonly PlainDiagnostic[]): string {
  let out = "";
  const chain = (c: PlainChain, level: number) => {
    out += "  ".repeat(level) + c.messageText + "\n";
    for (const n of c.next ?? []) chain(n, level + 1);
  };
  for (const d of diagnostics) {
    if (d.path !== undefined) out += `${d.path}(${d.line},${d.character}): `;
    out += `${d.category} ${d.rule ?? "TS" + d.code}: ${d.messageText}\n`;
    for (const n of d.next ?? []) chain(n, 1);
  }
  return out;
}
