// Reader of .errors.txt baselines: text to the files and diagnostics that the writer takes as input.
import {
  type Diagnostic,
  type FileLike,
  type Rules,
  Category,
  categoryFromName,
  categoryName,
} from "./diagnosticwriter";
import { type TestFile, comparePathsOf, isDefaultLibraryFile } from "./error_baseline";
import { getBaseFileName, getRootLength } from "./tspath";

export interface ReadOptions {
  // The files of the case, in the text model of the rules. With them the source lines are known, not read.
  units?: TestFile[];
  // Line breaks to join source lines with when the units are not given; the first that fits is taken.
  contentNewLines?: string[];
}

// Line and column as the text prints them, 1-based; both are absent where the text masks them as "--".
export interface PrintedPosition {
  line?: number;
  character?: number;
}

export interface ParsedErrorBaseline {
  rules: Rules;
  pretty: boolean;
  files: TestFile[];
  diagnostics: Diagnostic[];
  // Diagnostics, related ones too, of which the text has the printed position and no more: those of a file without a section, and related ones whose position is masked.
  printedOnly: Map<Diagnostic, PrintedPosition>;
  // Related diagnostics of which the text has the start and not the length: those of the plain form.
  withoutLength: Set<Diagnostic>;
  // Every place where the text did not determine the result, and what the reader chose.
  decisions: string[];
}

export class ReadError extends Error {}

interface Located {
  fileName: string | undefined;
  // 1-based as printed; undefined when masked as -- or without a file.
  line: number | undefined;
  character: number | undefined;
  messageLines: string[];
  snippet?: Snippet;
}

interface Entry extends Located {
  category: Category;
  code: number;
  related: RelatedEntry[];
  relatedFromTop: boolean;
  squiggles: Squiggle[];
  messageSeen: boolean;
}

interface RelatedEntry extends Located {
  code: number | undefined;
}

interface Snippet {
  firstLine: number;
  lastLine: number;
  firstLinePrefix: number;
  firstLineTildes: number;
  lastLineTildes: number;
}

interface Squiggle {
  section: number;
  lineIndex: number;
  prefix: string;
  tildes: number;
  ended: boolean;
}

interface Section {
  name: string;
  count: number;
  lines: string[];
  contentLines: string[];
  entries: Entry[];
  unit?: TestFile;
  // The places of this file that the text names, in the first section and in the related lines of every section.
  places: Required<PrintedPosition>[];
}

// A name does not start with a space: a line of a chain does.
const plainHead = /^(\S.*?)\((\d+|--),(\d+|--)\): (error|warning|suggestion|message) TS(-?\d+): (.*)$/s;
const globalHead = /^(error|warning|suggestion|message) TS(-?\d+): (.*)$/s;
const sectionHead = /^==== (.*) \((\d+) errors\) ====$/s;
const relatedLine = /^!!! related TS(-?\d+)(?: (.+?):(\d+|--):(\d+|--))?: (.*)$/s;

const summaryHead = /^Found (?:1 error|\d+ errors)(?:\.| in )/;

const esc = "\x1b";
const locationPattern = `${esc}\\[96m(.*?)${esc}\\[0m:${esc}\\[93m(\\d+)${esc}\\[0m:${esc}\\[93m(\\d+)${esc}\\[0m`;
const prettyHead = new RegExp(
  `^(?:${locationPattern} - )?${esc}\\[9[0134]m(error|warning|suggestion|message)${esc}\\[0m${esc}\\[90m TS(-?\\d+): ${esc}\\[0m(.*)$`,
  "s",
);
const prettyRelatedHeadGo = new RegExp(`^  ${locationPattern} - (.*)$`, "s");
const prettyRelatedHeadTsc = new RegExp(`^  ${locationPattern}$`, "s");
const gutterLine = new RegExp(`^( *)${esc}\\[7m *(\\d+|\\.\\.\\.)${esc}\\[0m (.*)$`, "s");
const gutterSquiggle = new RegExp(`^( *)${esc}\\[7m *${esc}\\[0m ${esc}\\[9[01346]m(\\s*)(~*)${esc}\\[0m$`, "s");

const caseInsensitive = { useCaseSensitiveFileNames: false, currentDirectory: "" };

// The most text that is made up for one file without a section.
const maxMadeUpText = 1 << 24;

// Text for a file that is no input file: every printed line has its printed columns, masked positions are the first columns of line 1.
export class MadeUpText {
  private masked = 0;
  private readonly width = new Map<number, number>();

  // Notes a printed position, or a masked one where a part is absent; the result is its offset once the text is built.
  want(line: number | undefined, character: number | undefined): (lineMap: readonly number[]) => number {
    if (line === undefined || character === undefined) {
      const rank = this.masked++;
      return () => rank;
    }
    this.width.set(line, Math.max(this.width.get(line) ?? 0, character - 1));
    return lineMap => lineMap[line - 1] + character - 1;
  }

  build(fileName: string): string {
    const width = new Map(this.width);
    width.set(1, Math.max(width.get(1) ?? 0, this.masked));
    const lines = [...width.keys()].sort((a, b) => a - b);
    let size = lines[lines.length - 1] - 1;
    for (const w of width.values()) size += w;
    if (size > maxMadeUpText) throw new ReadError(`the positions in ${fileName} are beyond any text`);
    let text = "";
    let at = 1;
    for (const line of lines) {
      text += "\n".repeat(line - at) + " ".repeat(width.get(line)!);
      at = line;
    }
    return text;
  }
}

export function readErrorBaseline(rules: Rules, text: string, options: ReadOptions = {}): ParsedErrorBaseline {
  const decisions: string[] = [];
  const pretty = text.startsWith(esc + "[");
  // The first section ends with line breaks; what follows starts with a message line, a header or the summary.
  const allLines = text.split("\r\n");
  let bodyStart = allLines.findIndex(l => l.startsWith("!!! ") || isSectionHead(l) || (pretty && summaryHead.test(l)));
  if (bodyStart < 0) bodyStart = allLines.length;
  let topEnd = bodyStart;
  while (topEnd > 0 && allLines[topEnd - 1] === "") topEnd--;
  if (topEnd === 0 || bodyStart - topEnd < (pretty ? 1 : 2)) throw new ReadError("no end of the first section");
  const topLines = allLines.slice(0, topEnd);

  const entries = pretty ? readPrettyTop(rules, topLines) : readPlainTop(topLines);

  let bodyLines = allLines.slice(bodyStart);
  if (pretty && entries.some(e => e.category === Category.Error)) {
    // The summary ends the text ("Found ...", an empty line, the table of files, an empty line); nothing is read from it, the writer derives it.
    let at = -1;
    for (let i = bodyLines.length - 2; i >= 0; i--) {
      if (bodyLines[i + 1] === "" && summaryHead.test(bodyLines[i])) {
        at = i;
        break;
      }
    }
    if (at < 0) throw new ReadError("pretty form without summary");
    bodyLines = bodyLines.slice(0, at);
  }

  let i = 0;
  const globalLines: string[] = [];
  while (i < bodyLines.length && !isSectionHead(bodyLines[i])) {
    globalLines.push(bodyLines[i]);
    i++;
  }
  readGlobalSection(globalLines, entries);

  const sections: Section[] = [];
  while (i < bodyLines.length) {
    const m = sectionHead.exec(bodyLines[i]);
    if (m === null) throw new ReadError(`expected a file header at body line ${i + 1}`);
    i++;
    const lines: string[] = [];
    while (i < bodyLines.length && !isSectionHead(bodyLines[i])) {
      lines.push(bodyLines[i]);
      i++;
    }
    sections.push({ name: m[1], count: Number(m[2]), lines, contentLines: [], entries: [], places: [] });
  }

  if (options.units !== undefined) {
    // The sections are the input files in their order; units that follow a name twice are taken in order.
    const used = new Set<number>();
    for (const section of sections) {
      const at = options.units.findIndex((u, k) => !used.has(k) && unitMatches(rules, u.unitName, section.name));
      if (at < 0) throw new ReadError(`no unit for the section ${section.name}`);
      used.add(at);
      section.unit = options.units[at];
    }
  }

  for (const section of sections) {
    // The writer takes the diagnostics whose name compares equal to the name of the file; the same name always does.
    section.entries = entries.filter(
      e =>
        e.fileName !== undefined &&
        (e.fileName === section.name || comparePathsOf(rules, e.fileName, section.name, caseInsensitive) === 0),
    );
    if (section.entries.length !== section.count) {
      throw new ReadError(
        `header of ${section.name} counts ${section.count}, the first section has ${section.entries.length}`,
      );
    }
    // A masked position does not say which line the squiggle lines follow, and a squiggle line without tildes looks like a source line.
    if (section.entries.some(e => e.line === undefined || e.character === undefined)) {
      throw new ReadError(`masked position in a section: ${section.name}`);
    }
  }

  const sectionOf = sectionLookup(rules, sections);
  const named = (fileName: string | undefined, line: number | undefined, character: number | undefined): void => {
    if (fileName === undefined || line === undefined || character === undefined) return;
    const k = sectionOf(fileName);
    if (k >= 0) sections[k].places.push({ line, character });
  };
  for (const e of entries) {
    named(e.fileName, e.line, e.character);
    for (const r of e.related) {
      named(r.fileName, r.line, r.character);
      // The span of the pretty form is read from the last line of its snippet.
      named(r.fileName, r.snippet?.lastLine, 1);
    }
  }
  for (const line of bodyLines) {
    const m = line.startsWith("!!! related TS") ? relatedLine.exec(line) : null;
    if (m !== null) named(m[2], printedNumber(m[3]), printedNumber(m[4]));
  }

  sections.forEach((section, index) => readSection(rules, section, index, decisions));

  // With the units the text of every file is known; without them the source lines are joined with the first line break that fits.
  if (options.units !== undefined) return build(rules, pretty, entries, sections, sectionOf, "", decisions);
  const given = options.contentNewLines;
  const newLines = given !== undefined && given.length > 0 ? given : ["\n", "\r\n"];
  let firstError: unknown;
  for (const contentNewLine of newLines) {
    try {
      const result = build(rules, pretty, entries, sections, sectionOf, contentNewLine, decisions.slice());
      if (contentNewLine !== newLines[0]) {
        result.decisions.push(`source lines joined with ${JSON.stringify(contentNewLine)}`);
      }
      return result;
    } catch (e) {
      if (!(e instanceof ReadError)) throw e;
      firstError ??= e;
    }
  }
  throw firstError;
}

function unitMatches(rules: Rules, unitName: string, sectionName: string): boolean {
  if (unitName === sectionName) return true;
  return comparePathsOf(rules, unitName, realName(rules, sectionName, true), caseInsensitive) === 0;
}

// The section of the file of a name: the last section of that name, else the last one whose name compares equal; -1 when there is none.
function sectionLookup(rules: Rules, sections: Section[]): (name: string) => number {
  const known = new Map<string, number>();
  return name => {
    let found = known.get(name);
    if (found === undefined) {
      found = -1;
      for (let k = 0; k < sections.length; k++) if (sections[k].name === name) found = k;
      if (found < 0) {
        for (let k = 0; k < sections.length; k++) {
          if (comparePathsOf(rules, name, sections[k].name, caseInsensitive) === 0) found = k;
        }
      }
      known.set(name, found);
    }
    return found;
  };
}

function isSectionHead(line: string): boolean {
  return line.startsWith("==== ") && sectionHead.test(line);
}

// A printed line or column; undefined when it is masked as "--" or absent.
function printedNumber(text: string | undefined): number | undefined {
  if (text === undefined || text === "--") return undefined;
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 1) throw new ReadError(`${text.slice(0, 20)} is not a line or column number`);
  return n;
}

function newEntry(
  fileName: string | undefined,
  line: string | undefined,
  character: string | undefined,
  category: string,
  code: string,
  first: string,
): Entry {
  return {
    fileName,
    line: printedNumber(line),
    character: printedNumber(character),
    category: categoryFromName(category)!,
    code: Number(code),
    messageLines: [first],
    related: [],
    relatedFromTop: false,
    squiggles: [],
    messageSeen: false,
  };
}

function readPlainTop(lines: string[]): Entry[] {
  const entries: Entry[] = [];
  for (const line of lines) {
    // A line that starts with a category has no file; else the first "(line,column): category TScode: " ends the name.
    let m = globalHead.exec(line);
    if (m !== null) {
      entries.push(newEntry(undefined, undefined, undefined, m[1], m[2], m[3]));
      continue;
    }
    m = plainHead.exec(line);
    if (m !== null) {
      entries.push(newEntry(m[1], m[2], m[3], m[4], m[5], m[6]));
      continue;
    }
    if (entries.length === 0) throw new ReadError("the first section does not start with a diagnostic");
    entries[entries.length - 1].messageLines.push(line);
  }
  return entries;
}

function readPrettyTop(rules: Rules, lines: string[]): Entry[] {
  const entries: Entry[] = [];
  let i = 0;
  // Pairs of a gutter line and a squiggle line, with an ellipsis line where lines are left out.
  const readSnippet = (indent: string): Snippet | undefined => {
    let j = i;
    const shown: { line: number; prefix: number; tildes: number }[] = [];
    while (j < lines.length) {
      const g = gutterLine.exec(lines[j]);
      if (g === null || g[1] !== indent) break;
      if (g[2] === "...") {
        j++;
        continue;
      }
      const s = j + 1 < lines.length ? gutterSquiggle.exec(lines[j + 1]) : null;
      if (s === null || s[1] !== indent) break;
      shown.push({ line: Number(g[2]), prefix: s[2].length, tildes: s[3].length });
      j += 2;
    }
    if (shown.length === 0) return undefined;
    i = j;
    const first = shown[0];
    const last = shown[shown.length - 1];
    return {
      firstLine: first.line,
      lastLine: last.line,
      firstLinePrefix: first.prefix,
      firstLineTildes: first.tildes,
      lastLineTildes: last.tildes,
    };
  };
  while (i < lines.length) {
    const m = prettyHead.exec(lines[i]);
    if (m === null) throw new ReadError(`pretty first section: no diagnostic at line ${i + 1}`);
    i++;
    const entry = newEntry(m[1], m[2], m[3], m[4], m[5], m[6]);
    entries.push(entry);
    while (
      i < lines.length &&
      lines[i] !== "" &&
      prettyHead.exec(lines[i]) === null &&
      !(rules.name === "tsgo" && prettyRelatedHeadGo.test(lines[i]))
    ) {
      entry.messageLines.push(lines[i]);
      i++;
    }
    if (entry.fileName !== undefined && lines[i] === "") {
      i++;
      entry.snippet = readSnippet("");
      if (entry.snippet === undefined) {
        // Code 1490 has no snippet.
        i--;
      }
    }
    if (rules.name === "tsc") {
      // An empty line, then per entry: "  location", the snippet, "    message" and its chain lines.
      if (i + 1 < lines.length && lines[i] === "" && isTscRelatedStart(lines[i + 1])) {
        i++;
        entry.relatedFromTop = true;
        while (i < lines.length && isTscRelatedStart(lines[i])) {
          const r = prettyRelatedHeadTsc.exec(lines[i]);
          const related: RelatedEntry = {
            fileName: r?.[1],
            line: printedNumber(r?.[2]),
            character: printedNumber(r?.[3]),
            code: undefined,
            messageLines: [],
          };
          if (r !== null) {
            i++;
            related.snippet = readSnippet("    ");
          }
          if (i >= lines.length || !lines[i].startsWith("    ")) throw new ReadError("related entry without message");
          related.messageLines.push(lines[i].slice(4));
          i++;
          while (i < lines.length && lines[i].startsWith("  ") && !isTscRelatedStart(lines[i])) {
            related.messageLines.push(lines[i]);
            i++;
          }
          entry.related.push(related);
        }
      }
    } else {
      // Per entry with a file: a line break (the end of the snippet before it, or an empty line), "  location - message", chain lines, the snippet.
      for (;;) {
        let at = i;
        while (at < lines.length && lines[at] === "") at++;
        if (at >= lines.length) break;
        const r = prettyRelatedHeadGo.exec(lines[at]);
        if (r === null) break;
        i = at + 1;
        entry.relatedFromTop = true;
        const related: RelatedEntry = {
          fileName: r[1],
          line: printedNumber(r[2]),
          character: printedNumber(r[3]),
          code: undefined,
          messageLines: [r[4]],
        };
        while (i < lines.length && lines[i] !== "" && gutterLine.exec(lines[i]) === null) {
          related.messageLines.push(lines[i]);
          i++;
        }
        related.snippet = readSnippet("    ");
        entry.related.push(related);
      }
      // The line breaks of entries without a file, and the one between two diagnostics.
      while (i < lines.length && lines[i] === "") i++;
    }
  }
  return entries;
}

function isTscRelatedStart(line: string): boolean {
  return prettyRelatedHeadTsc.test(line) || (line.startsWith("    ") && !line.startsWith("    " + esc));
}

function readGlobalSection(lines: string[], entries: Entry[]): void {
  let i = 0;
  for (const e of entries) {
    if (e.fileName !== undefined) continue;
    // No source line is here: every line without a mark is a line of a chain.
    const r = readMessageLines(lines, i, e, alternatives => alternatives.indexOf(Math.max(...alternatives)));
    i = r.next;
    e.related = mergeRelated(e, r.related);
    e.messageSeen = true;
  }
  if (i !== lines.length) throw new ReadError(`global section: ${lines.length - i} lines left over`);
}

// Chain level of a line that continues a message, 0 when it cannot be one.
function chainLevel(line: string, previousLevel: number): number {
  let indent = 0;
  while (indent < line.length && line.charCodeAt(indent) === 0x20) indent++;
  return Math.min(indent >> 1, previousLevel + 1);
}

// The same for a line that may be a source line: a chain line is 2 spaces per level, then text that is not empty and does not start with a space.
function relatedChainLevel(line: string, previousLevel: number): number {
  let indent = 0;
  while (indent < line.length && line.charCodeAt(indent) === 0x20) indent++;
  if (indent === line.length || (indent & 1) !== 0) return 0;
  const level = indent >> 1;
  return level >= 1 && level <= previousLevel + 1 ? level : 0;
}

// Reads the lines of one diagnostic at lines[i]: its message lines, then its related lines.
function readMessageLines(
  lines: string[],
  i: number,
  e: Entry,
  choose: (alternatives: number[]) => number,
): { next: number; related: RelatedEntry[] } {
  const head = `!!! ${categoryName(e.category)} TS${e.code}: `;
  // The writer cuts the message at every LF, drops a CR before it and leaves out what is empty then.
  for (let w of e.messageLines.join("\r\n").split("\n")) {
    if (w.endsWith("\r")) w = w.slice(0, -1);
    if (w.length === 0) continue;
    const line = lines[i];
    if (line !== head + w) {
      throw new ReadError(
        `message line differs from the first section: ${JSON.stringify(line)} against ${JSON.stringify(head + w)}`,
      );
    }
    i++;
  }
  const related: RelatedEntry[] = [];
  while (i < lines.length && lines[i].startsWith("!!! related TS")) {
    const m = relatedLine.exec(lines[i]);
    if (m === null) throw new ReadError(`related line not understood: ${lines[i]}`);
    const entry: RelatedEntry = {
      fileName: m[2],
      line: printedNumber(m[3]),
      character: printedNumber(m[4]),
      code: Number(m[1]),
      messageLines: [m[5]],
    };
    related.push(entry);
    i++;
    // The chain of a related message is written without a mark, and from level 2 on it looks like a source line.
    let must = 0;
    let can = 0;
    let linear = 0;
    let level = 0;
    let isLinear = true;
    for (let j = i; j < lines.length; j++) {
      const l = lines[j];
      if (l.startsWith("!!! ") || isSectionHead(l) || !l.startsWith("  ")) break;
      const next = relatedChainLevel(l, level);
      if (next === 0) break;
      if (isLinear && next === level + 1) linear = j - i + 1;
      else isLinear = false;
      level = next;
      can = j - i + 1;
      if (!l.startsWith("    ") && must === j - i) must = j - i + 1;
    }
    if (can > 0) {
      const alternatives: number[] = [];
      if (linear >= must) alternatives.push(linear);
      for (let n = can; n >= must; n--) if (n !== linear) alternatives.push(n);
      const take = alternatives[choose(alternatives)];
      for (let n = 0; n < take; n++) entry.messageLines.push(lines[i + n]);
      i += take;
    }
  }
  return { next: i, related };
}

function relatedKey(r: RelatedEntry[]): string {
  return JSON.stringify(r.map(x => [x.fileName, x.line, x.character, x.code, x.messageLines]));
}

// The related entries of a diagnostic once its lines of one section are read; it changes nothing and throws where they contradict what is known.
function mergeRelated(e: Entry, related: RelatedEntry[]): RelatedEntry[] {
  if (e.relatedFromTop) {
    // Pretty form: the first section has the entries and their spans, the lines here have the codes.
    if (e.messageSeen) return e.related;
    const merged: RelatedEntry[] = [];
    let k = 0;
    for (const r of related) {
      const t = e.related[k];
      if (
        t !== undefined &&
        t.fileName === r.fileName &&
        (r.line === undefined || (t.line === r.line && t.character === r.character))
      ) {
        merged.push({ ...t, code: r.code, messageLines: r.messageLines });
        k++;
      } else if (r.fileName === undefined) {
        merged.push(r);
      } else {
        throw new ReadError("related lines differ from the first section");
      }
    }
    if (k !== e.related.length) throw new ReadError("related entries of the first section are not all in the lines");
    return merged;
  }
  if (e.messageSeen) {
    if (relatedKey(e.related) !== relatedKey(related)) throw new ReadError("related lines differ between two sections");
    return e.related;
  }
  return related;
}

class Choices {
  picks: number[] = [];
  sizes: number[] = [];
  at = 0;
  choose = (alternatives: number[]): number => {
    const k = this.at++;
    if (k >= this.picks.length) this.picks.push(0);
    this.sizes[k] = alternatives.length;
    return this.picks[k];
  };
  // Moves to the next combination; false when there is none.
  advance(): boolean {
    for (let k = this.at - 1; k >= 0; k--) {
      if (this.picks[k] + 1 < this.sizes[k]) {
        this.picks[k]++;
        this.picks.length = k + 1;
        this.at = 0;
        return true;
      }
    }
    return false;
  }
}

interface SectionResult {
  contentLines: string[];
  squiggles: Squiggle[][];
  related: (RelatedEntry[] | undefined)[];
}

// The most ways to end the chains of related messages that are tried for one section.
const maxAttempts = 10000;

function readSection(rules: Rules, section: Section, sectionIndex: number, decisions: string[]): void {
  const choices = new Choices();
  let firstError: ReadError | undefined;
  for (let attempts = 1; ; attempts++) {
    try {
      const local: string[] = [];
      const r = readSectionOnce(rules, section, sectionIndex, choices, local);
      checkSection(rules, section, r);
      // Nothing of an attempt is kept before every check of it has passed.
      const related = section.entries.map((e, k) => mergeRelated(e, r.related[k] ?? []));
      section.contentLines = r.contentLines;
      section.entries.forEach((e, k) => {
        for (const s of r.squiggles[k]) e.squiggles.push(s);
        e.related = related[k];
        e.messageSeen = true;
      });
      decisions.push(...local);
      if (choices.at > 0) {
        decisions.push(
          section.unit !== undefined
            ? `chain of a related message in ${section.name}: its end is read with the unit`
            : `chain of a related message in ${section.name}: its end is read without the unit (attempt ${attempts})`,
        );
      }
      return;
    } catch (e) {
      if (!(e instanceof ReadError)) throw e;
      firstError ??= e;
      if (attempts >= maxAttempts || !choices.advance()) throw firstError;
    }
  }
}

// The checks of one attempt: the first squiggle line of a diagnostic is where the first section says that the diagnostic starts, and every place that the text names is in the file.
function checkSection(rules: Rules, section: Section, r: SectionResult): void {
  const model = rules.model;
  const content = section.unit !== undefined ? section.unit.content : r.contentLines.join("\n");
  const starts = model.lineStarts(content);
  section.entries.forEach((e, k) => {
    if (e.line === undefined || e.character === undefined || e.fileName !== section.name) return;
    if (e.line - 1 >= starts.length) throw new ReadError(`line ${e.line} is outside ${section.name}`);
    const pos = model.advanceUTF16(content, starts[e.line - 1], e.character - 1, content.length);
    if (pos === undefined) {
      throw new ReadError(`column ${e.character} is no position of line ${e.line} of ${section.name}`);
    }
    for (const related of r.related[k] ?? []) {
      if (related.fileName !== section.name || related.line === undefined || related.character === undefined) continue;
      if (related.line - 1 >= starts.length) throw new ReadError(`line ${related.line} is outside ${section.name}`);
      const at = model.advanceUTF16(content, starts[related.line - 1], related.character - 1, content.length);
      if (at === undefined || (related.line < starts.length && at >= starts[related.line])) {
        throw new ReadError(`column ${related.character} is no position of line ${related.line} of ${section.name}`);
      }
    }
    const first = r.squiggles[k][0];
    const line = r.contentLines[first.lineIndex];
    const squiggleStart = Math.max(0, pos - starts[first.lineIndex]);
    const prefix = model.blankNonWhitespace(line.slice(0, squiggleStart));
    if (prefix !== first.prefix) {
      throw new ReadError(
        `section ${section.name}: squiggle of ${e.line},${e.character} starts at ${first.prefix.length}, not at ${prefix.length}`,
      );
    }
  });
  // A chain that took source lines leaves the file without its last lines and puts other lines at the places that the text names. Joined with CR LF, a line has one position more than here.
  const beyond = section.unit === undefined ? 1 : 0;
  for (const { line, character } of section.places) {
    if (line > starts.length) throw new ReadError(`line ${line} is outside ${section.name}`);
    const at = model.advanceUTF16(content, starts[line - 1], character - 1, content.length);
    if (at === undefined) throw new ReadError(`column ${character} is no position of line ${line} of ${section.name}`);
    if (line < starts.length && at >= starts[line] + beyond) {
      throw new ReadError(`column ${character} is after line ${line} of ${section.name}`);
    }
  }
}

function readSectionOnce(
  rules: Rules,
  section: Section,
  sectionIndex: number,
  choices: Choices,
  decisions: string[],
): SectionResult {
  const model = rules.model;
  const lines = section.lines;
  const entries = section.entries;
  const isSquiggle = (l: string | undefined): boolean =>
    l !== undefined && l.startsWith("    ") && model.squigglePattern.test(l.slice(4));
  let unitLines: string[] | undefined;
  if (section.unit !== undefined) {
    unitLines = model.contentLines(section.unit.content).map(l => (l.endsWith("\r") ? l.slice(0, -1) : l));
  }
  // 0 not started, 1 started, 2 message written
  const state: number[] = entries.map(() => 0);
  const result: SectionResult = {
    contentLines: [],
    squiggles: entries.map(() => []),
    related: entries.map(() => undefined),
  };
  let i = 0;
  let lineIndex = 0;
  // The diagnostics before this one have their message: no line looks at them again.
  let done = 0;
  // How the line at i looks: every diagnostic that has not started asks, so the answer is kept for as long as i stays.
  let lookedAt = -1;
  let looksLikeSquiggle = false;
  let messageFollows = false;
  const look = (): void => {
    if (lookedAt === i) return;
    lookedAt = i;
    looksLikeSquiggle = isSquiggle(lines[i]);
    messageFollows = lines[i + 1] !== undefined && lines[i + 1].startsWith("!!! ");
  };

  if (lines.length === 0) throw new ReadError(`section ${section.name} has no line`);
  while (i < lines.length) {
    const contentLine = lines[i];
    if (!contentLine.startsWith("    ")) {
      throw new ReadError(`section ${section.name}: source line without indent: ${JSON.stringify(contentLine)}`);
    }
    if (unitLines !== undefined && unitLines[lineIndex] !== contentLine.slice(4)) {
      throw new ReadError(
        `section ${section.name}: line ${lineIndex + 1} is ${JSON.stringify(contentLine.slice(4))}, the unit has ${JSON.stringify(unitLines[lineIndex])}`,
      );
    }
    i++;
    result.contentLines.push(contentLine.slice(4));
    let last = unitLines !== undefined && lineIndex === unitLines.length - 1;
    while (done < entries.length && state[done] === 2) done++;
    for (let k = done; k < entries.length; k++) {
      if (state[k] === 2) continue;
      const e = entries[k];
      let expects: boolean;
      if (state[k] === 1 || last) {
        expects = true;
      } else {
        // No position of a section is masked: readErrorBaseline refuses one.
        expects = e.line! - 1 <= lineIndex;
        if (!expects) {
          look();
          if (looksLikeSquiggle && messageFollows) {
            // A message never follows a source line, so this is a squiggle line of a diagnostic of a later line, which the writer makes on the last line only.
            expects = true;
            last = true;
            decisions.push(
              `${section.name} has more line starts than lines: diagnostics of later lines are at its last line`,
            );
          }
        }
      }
      if (!expects) continue;
      look();
      const l = lines[i];
      if (!looksLikeSquiggle) {
        throw new ReadError(
          `section ${section.name}: squiggle line expected after source line ${lineIndex + 1}, found ${JSON.stringify(l)}`,
        );
      }
      i++;
      const tildeAt = l.indexOf("~");
      const prefix = tildeAt < 0 ? l.slice(4) : l.slice(4, tildeAt);
      const tildes = tildeAt < 0 ? 0 : l.length - tildeAt;
      state[k] = 1;
      const ended = i < lines.length && lines[i].startsWith("!!! ");
      result.squiggles[k].push({ section: sectionIndex, lineIndex, prefix, tildes, ended });
      if (ended) {
        const r = readMessageLines(lines, i, e, choices.choose);
        i = r.next;
        result.related[k] = r.related;
        state[k] = 2;
      }
    }
    lineIndex++;
    if (last && i < lines.length) {
      throw new ReadError(`section ${section.name}: lines after the last source line`);
    }
  }
  for (let k = 0; k < entries.length; k++) {
    if (state[k] !== 2) throw new ReadError(`section ${section.name}: a diagnostic has no message`);
  }
  if (unitLines !== undefined && lineIndex !== unitLines.length) {
    throw new ReadError(`section ${section.name}: ${lineIndex} source lines, the unit has ${unitLines.length}`);
  }
  return result;
}

interface MadeUpFile {
  file: FileLike;
  text: MadeUpText;
}

function build(
  rules: Rules,
  pretty: boolean,
  entries: Entry[],
  sections: Section[],
  sectionOf: (name: string) => number,
  contentNewLine: string,
  decisions: string[],
): ParsedErrorBaseline {
  const model = rules.model;
  const files: TestFile[] = sections.map(s => ({
    unitName: s.name,
    content: s.unit !== undefined ? s.unit.content : s.contentLines.join(contentNewLine),
  }));
  const sectionFiles: FileLike[] = sections.map((s, k) => ({
    fileName: realName(rules, s.name, true),
    text: files[k].content,
    isConfigFile: isConfigName(s.name),
  }));
  const lineStarts = sectionFiles.map(f => model.lineStarts(f.text));
  sectionFiles.forEach((f, k) => (f.lineMap = lineStarts[k]));

  const madeUp = new Map<string, MadeUpFile>();
  const namedFiles = new Map<string, FileLike>();
  const fileOf = (name: string): { file: FileLike; section: number; text?: MadeUpText } => {
    const k = sectionOf(name);
    if (k < 0) {
      let m = madeUp.get(name);
      if (m === undefined) {
        m = {
          file: { fileName: realName(rules, name, false), text: "", isConfigFile: isConfigName(name) },
          text: new MadeUpText(),
        };
        madeUp.set(name, m);
      }
      return { file: m.file, section: -1, text: m.text };
    }
    if (sections[k].name === name) return { file: sectionFiles[k], section: k };
    // The name differs from the header by case or by a leading "./": the same text under the name of the diagnostic.
    let f = namedFiles.get(name);
    if (f === undefined) {
      f = {
        fileName: realName(rules, name, true),
        text: sectionFiles[k].text,
        lineMap: lineStarts[k],
        isConfigFile: isConfigName(name),
      };
      namedFiles.set(name, f);
    }
    return { file: f, section: k };
  };

  const printedOnly = new Map<Diagnostic, PrintedPosition>();
  const withoutLength = new Set<Diagnostic>();
  const pending: (() => void)[] = [];
  const locate = (at: Located, d: Diagnostic, set: (file: FileLike, pos: number, section: number) => void): void => {
    const { file, section, text } = fileOf(at.fileName!);
    const { line, character } = at;
    if (text !== undefined) {
      // Where the position is masked, the order of appearance is all that the text has.
      printedOnly.set(d, line === undefined || character === undefined ? {} : { line, character });
      const offset = text.want(line, character);
      pending.push(() => set(file, offset(file.lineMap!), -1));
      return;
    }
    if (line === undefined || character === undefined) {
      set(file, -1, section);
      return;
    }
    const starts = lineStarts[section];
    if (line - 1 >= starts.length) throw new ReadError(`line ${line} is outside ${at.fileName}`);
    const lineStart = starts[line - 1];
    const pos = model.advanceUTF16(file.text, lineStart, character - 1, file.text.length);
    if (pos === undefined) throw new ReadError(`column ${character} is no position of line ${line} of ${at.fileName}`);
    if (line < starts.length && pos >= starts[line]) {
      throw new ReadError(`column ${character} is after line ${line} of ${at.fileName}`);
    }
    set(file, pos, section);
  };

  const diagnostics: Diagnostic[] = [];
  let rank = 0;
  for (const e of entries) {
    const d = newDiagnostic(e.code, e.category, e.messageLines);
    if (e.fileName === undefined) {
      d.pos = d.end = rank++;
    } else {
      locate(e, d, (file, pos, section) => {
        d.file = file;
        d.pos = pos;
        d.end = pos;
        if (section >= 0) {
          spanFromSquiggles(rules, e, d, section, sections, lineStarts, decisions);
        } else {
          decisions.push(
            `${e.fileName} has no section: the length and the related information of its diagnostics are not in the text`,
          );
        }
      });
    }
    for (const r of e.related) {
      const rd = newDiagnostic(r.code ?? 0, Category.Message, r.messageLines);
      if (r.fileName !== undefined) {
        locate(r, rd, (file, pos, section) => {
          rd.file = file;
          // A masked position in a file with a section: the writer masks it again wherever it is.
          if (pos < 0) printedOnly.set(rd, {});
          rd.pos = Math.max(pos, 0);
          rd.end = rd.pos;
          if (r.snippet !== undefined && section >= 0) {
            spanFromSnippet(rules, r.snippet, rd, lineStarts[section], decisions);
            return;
          }
          withoutLength.add(rd);
          if (!pretty) decisions.push("plain form: the length of related information is not in the text");
        });
      } else {
        rd.pos = rd.end = -1;
      }
      d.relatedInformation.push(rd);
    }
    diagnostics.push(d);
  }
  for (const m of madeUp.values()) {
    m.file.text = m.text.build(m.file.fileName);
    m.file.lineMap = model.lineStarts(m.file.text);
  }
  for (const p of pending) p();

  return { rules, pretty, files, diagnostics, printedOnly, withoutLength, decisions };
}

function newDiagnostic(code: number, category: Category, messageLines: string[]): Diagnostic {
  const d: Diagnostic = {
    file: undefined,
    pos: -1,
    end: -1,
    code,
    category,
    messageText: "",
    messageChain: [],
    relatedInformation: [],
  };
  chainFromLines(messageLines, d);
  return d;
}

// A configuration file: TypeScript sorts its diagnostics as those of no path.
export function isConfigName(name: string): boolean {
  const base = getBaseFileName(name).toLowerCase();
  return base === "tsconfig.json" || base === "jsconfig.json";
}

// The name that the sort compares. A rooted name is printed whole; of other names the harness cut the root.
export function realName(rules: Rules, name: string, isInputFile: boolean): string {
  if (getRootLength(name) !== 0) return name;
  if (!isInputFile && isDefaultLibraryFile(name)) return rules.libraryRoot + name;
  return rules.sourceRoot + name;
}

function chainFromLines(lines: string[], root: Diagnostic): void {
  root.messageText = lines[0];
  const stack: Diagnostic[] = [root];
  for (let k = 1; k < lines.length; k++) {
    const line = lines[k];
    const level = chainLevel(line, stack.length - 1);
    if (level === 0) {
      // A line break inside the text of a message.
      stack[stack.length - 1].messageText += "\r\n" + line;
      continue;
    }
    const node = newDiagnostic(root.code, root.category, [line.slice(2 * level)]);
    stack.length = level;
    stack[level - 1].messageChain.push(node);
    stack.push(node);
  }
}

function spanFromSquiggles(
  rules: Rules,
  e: Entry,
  d: Diagnostic,
  section: number,
  sections: Section[],
  lineStarts: number[][],
  decisions: string[],
): void {
  const model = rules.model;
  const own = e.squiggles.filter(s => s.section === section);
  if (own.length === 0) throw new ReadError(`no squiggle line for a diagnostic in ${e.fileName}`);
  const last = own[own.length - 1];
  if (!last.ended) throw new ReadError("the last squiggle line of a diagnostic has no message");
  const name = sections[section].name;
  const text = d.file!.text;
  const starts = lineStarts[section];
  const content = sections[section].contentLines;
  // A line break inside a line gives the writer more line starts than lines: the start that it takes for a later line is not where that line is.
  const shifted = starts.length > content.length;
  // Tildes that stop before the end of their line stop at the end of the span, tildes up to the end of their line stop at it or before it: the span is taken to end at the last of these stops.
  let end = d.pos;
  let determined = false;
  let displaced = false;
  for (const s of own) {
    const line = content[s.lineIndex];
    const lineStart = starts[s.lineIndex];
    const inPlace = !shifted || text.startsWith(line, lineStart);
    if (!inPlace) displaced = true;
    const squiggleStart = Math.max(0, d.pos - lineStart);
    if (squiggleStart > line.length) continue;
    const stop = model.advanceSquiggle(line, squiggleStart, s.tildes);
    if (stop === undefined) throw new ReadError("more tildes than characters");
    end = Math.max(end, lineStart + stop);
    if (inPlace && stop < line.length) determined = true;
  }
  d.end = end;
  // With shifted line starts the last squiggle line alone does not have the end: every line must be the one that the writer makes of the span.
  const lastLine = content.length - 1;
  for (const s of own) {
    const tildes = tildesOf(rules, content[s.lineIndex], starts[s.lineIndex], d.pos, end);
    if (tildes === undefined) throw new ReadError("squiggle starts after the end of its line");
    const ends = s.lineIndex === lastLine || starts[s.lineIndex + 1] > end;
    if (tildes !== s.tildes || ends !== s.ended) {
      throw new ReadError(
        `section ${name}: the squiggle lines of ${e.line},${e.character} do not agree on the end of the span`,
      );
    }
  }
  if (determined) return;
  // A later end prints the same as long as the message stays at its line.
  const limit = last.lineIndex === lastLine ? text.length : starts[last.lineIndex + 1] - 1;
  if (shifted) {
    // A slice of a line that is not where the writer takes it to be can cut a character: another end can have the same tildes.
    if (displaced || end < limit) {
      decisions.push(
        `${name} has more line starts than lines: the span of ${e.line},${e.character} is taken to end where its tildes end`,
      );
    }
  } else if (end < limit && last.tildes > 0) {
    decisions.push("tildes to the end of a line that ends in CR LF: the span is taken to end before the CR");
  }
}

// The tildes that iterateErrorBaseline writes below a line for a span; undefined where the reference panics.
function tildesOf(rules: Rules, line: string, lineStart: number, pos: number, end: number): number | undefined {
  const squiggleStart = Math.max(0, pos - lineStart);
  const length = end - pos - Math.max(0, lineStart - pos);
  if (rules.name === "tsc") {
    const count = Math.min(length, line.length - squiggleStart) + 1;
    return count < 0 ? undefined : Math.max(0, count - 1);
  }
  if (squiggleStart > line.length) return undefined;
  const squiggleEnd = Math.max(squiggleStart, Math.min(squiggleStart + length, line.length));
  return rules.model.squiggleCount(line.slice(squiggleStart, squiggleEnd));
}

function spanFromSnippet(rules: Rules, snippet: Snippet, d: Diagnostic, starts: number[], decisions: string[]): void {
  const file = d.file!;
  const lineStart = starts[snippet.lastLine - 1];
  if (lineStart === undefined) throw new ReadError("snippet line outside the file");
  const oneLine = snippet.firstLine === snippet.lastLine;
  const units = oneLine ? snippet.firstLinePrefix + snippet.firstLineTildes : snippet.lastLineTildes;
  // The tildes of the reference are counted, not cut to the line: past the end of the line they are no span.
  const lineEnd = snippet.lastLine < starts.length ? starts[snippet.lastLine] - 1 : file.text.length;
  const end = rules.model.advanceUTF16(file.text, lineStart, units, lineEnd);
  if (rules.name === "tsgo" && oneLine && snippet.firstLineTildes === 1 && end !== undefined) {
    decisions.push("snippet with one tilde: length 1 is taken, length 0 prints the same");
  }
  if (end === undefined) {
    d.end = d.pos;
    decisions.push("snippet with a tilde after the end of the text: length 0 is taken");
    return;
  }
  d.end = Math.max(d.pos, end);
}
