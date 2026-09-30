// The plain data that the runner and a check function exchange (JavaScript strings, no identity of objects), and its conversion to the input of the writer.
import {
  type FileLike,
  type Rules,
  type Diagnostic as WriterDiagnostic,
  Category,
  categoryFromName,
  categoryName,
  ecmaLineMap,
} from "./diagnosticwriter";
import { type TestFile, comparePathsOf, isDefaultLibraryFile, removeTestPathPrefixes } from "./error_baseline";
import { type ParsedErrorBaseline, MadeUpText, isConfigName } from "./reader";
import { computeLineOfPosition } from "./scanner";

export type DiagnosticCategory = "warning" | "error" | "suggestion" | "message";

export interface DiagnosticMessageChain {
  messageText: string;
  next?: DiagnosticMessageChain[];
}

export interface DiagnosticLocation {
  // Name of the file as the harness has it: "/.src/a.ts", "bundled:///libs/lib.es5.d.ts".
  file: string;
  // 1-based line and 1-based column in UTF-16 code units, as tsc prints them. Absent: not known (masked).
  line?: number;
  character?: number;
  // Offset and length in UTF-8 bytes (tsgo) or UTF-16 code units (tsc); start is absent when the text of the file is not known, length when it is not known.
  start?: number;
  length?: number;
}

export interface RelatedInformation extends DiagnosticMessageChain {
  code: number;
  location?: DiagnosticLocation;
}

export interface Diagnostic extends DiagnosticMessageChain {
  category: DiagnosticCategory;
  code: number;
  // Absent: a diagnostic without a file. Such diagnostics keep the order of the array.
  location?: DiagnosticLocation;
  // Absent: not known. The plain format of tsc does not print it.
  relatedInformation?: RelatedInformation[];
}

export interface InputFile {
  unitName: string;
  content: string;
}

export interface ErrorBaseline {
  rules: "tsgo" | "tsc";
  pretty: boolean;
  files: InputFile[];
  diagnostics: Diagnostic[];
}

function chainOut(rules: Rules, chain: WriterDiagnostic[]): DiagnosticMessageChain[] | undefined {
  if (chain.length === 0) return undefined;
  return chain.map(c => ({ messageText: rules.model.toString(c.messageText), next: chainOut(rules, c.messageChain) }));
}

function locationOut(parsed: ParsedErrorBaseline, d: WriterDiagnostic): DiagnosticLocation | undefined {
  const rules = parsed.rules;
  const file = d.file;
  if (file === undefined) return undefined;
  const name = rules.model.toString(file.fileName);
  // Where the text has the printed position and no more, the offset in the file of the parsed form means nothing.
  const printed = parsed.printedOnly.get(d);
  if (printed !== undefined) return { file: name, ...printed };
  const lineMap = ecmaLineMap(rules, file);
  const line = computeLineOfPosition(lineMap, d.pos);
  const character = rules.model.utf16Length(file.text, lineMap[line], d.pos);
  return {
    file: name,
    line: line + 1,
    character: character + 1,
    start: d.pos,
    length: parsed.withoutLength.has(d) ? undefined : d.end - d.pos,
  };
}

export function toErrorBaseline(parsed: ParsedErrorBaseline): ErrorBaseline {
  const rules = parsed.rules;
  return {
    rules: rules.name,
    pretty: parsed.pretty,
    files: parsed.files.map(f => ({
      unitName: rules.model.toString(f.unitName),
      content: rules.model.toString(f.content),
    })),
    diagnostics: parsed.diagnostics.map(d => ({
      category: categoryName(d.category) as DiagnosticCategory,
      code: d.code,
      messageText: rules.model.toString(d.messageText),
      next: chainOut(rules, d.messageChain),
      location: locationOut(parsed, d),
      // The lines of a diagnostic are in the section of its file: without a section its related information is not known.
      relatedInformation:
        d.relatedInformation.length === 0 && parsed.printedOnly.has(d)
          ? undefined
          : d.relatedInformation.map(r => ({
              code: r.code,
              messageText: rules.model.toString(r.messageText),
              next: chainOut(rules, r.messageChain),
              location: locationOut(parsed, r),
            })),
    })),
  };
}

export interface WriterInput {
  files: TestFile[];
  diagnostics: WriterDiagnostic[];
}

const caseInsensitive = { useCaseSensitiveFileNames: false, currentDirectory: "" };

function isCount(n: number | undefined, least: number): boolean {
  return n === undefined || (Number.isSafeInteger(n) && n >= least);
}

// Builds the files and diagnostics of the writer. One FileLike stands for one name.
export function toWriterInput(rules: Rules, files: InputFile[], diagnostics: Diagnostic[]): WriterInput {
  const model = rules.model;
  const inputs: TestFile[] = files.map(f => ({
    unitName: model.fromString(f.unitName),
    content: model.fromString(f.content),
  }));
  const known = new Map<string, FileLike>();
  const madeUp = new Map<string, { file: FileLike; text: MadeUpText }>();
  const pending: (() => void)[] = [];

  // The input file of a name: the last one of that name, else the last one whose name compares equal.
  const inputOf = (name: string): TestFile | undefined => {
    let found: TestFile | undefined;
    const shown = removeTestPathPrefixes(rules, name);
    for (const f of inputs) if (f.unitName === name || removeTestPathPrefixes(rules, f.unitName) === shown) found = f;
    if (found !== undefined) return found;
    for (const f of inputs) {
      if (comparePathsOf(rules, shown, removeTestPathPrefixes(rules, f.unitName), caseInsensitive) === 0) found = f;
    }
    return found;
  };

  const place = (at: DiagnosticLocation | undefined, d: WriterDiagnostic, related: boolean): void => {
    if (at === undefined) return;
    if (!isCount(at.line, 1) || !isCount(at.character, 1) || !isCount(at.start, 0) || !isCount(at.length, 0)) {
      throw new Error(`${at.file}: a location of ${JSON.stringify({ ...at, file: undefined })} is no position`);
    }
    const name = model.fromString(at.file);
    let file = known.get(name);
    if (file === undefined && !madeUp.has(name)) {
      const input = inputOf(name);
      if (input !== undefined) {
        file = { fileName: name, text: input.content, isConfigFile: isConfigName(name) };
        file.lineMap = model.lineStarts(file.text);
        known.set(name, file);
      }
    }
    if (file !== undefined) {
      d.file = file;
      if (at.start !== undefined) {
        d.pos = at.start;
      } else if (at.line !== undefined && at.character !== undefined) {
        const starts = ecmaLineMap(rules, file);
        const pos =
          at.line - 1 < starts.length
            ? model.advanceUTF16(file.text, starts[at.line - 1], at.character - 1, file.text.length)
            : undefined;
        if (pos === undefined) throw new Error(`${at.file}(${at.line},${at.character}) is no position`);
        d.pos = pos;
      } else if (related && isDefaultLibraryFile(name)) {
        // The writer masks where related information is in a default library file: every position prints the same.
        d.pos = 0;
      } else {
        throw new Error(`${at.file}: a diagnostic in an input file needs a position`);
      }
      d.end = d.pos + (at.length ?? 0);
      return;
    }
    let m = madeUp.get(name);
    if (m === undefined) {
      m = { file: { fileName: name, text: "", isConfigFile: isConfigName(name) }, text: new MadeUpText() };
      madeUp.set(name, m);
    }
    const made = m.file;
    d.file = made;
    const offset = m.text.want(at.line, at.character);
    pending.push(() => (d.pos = d.end = offset(ecmaLineMap(rules, made))));
  };

  const chainIn = (next: DiagnosticMessageChain[] | undefined, code: number, category: Category): WriterDiagnostic[] =>
    (next ?? []).map(c => ({
      file: undefined,
      pos: -1,
      end: -1,
      code,
      category,
      messageText: model.fromString(c.messageText),
      messageChain: chainIn(c.next, code, category),
      relatedInformation: [],
    }));

  let rank = 0;
  const out: WriterDiagnostic[] = diagnostics.map(d => {
    const category = categoryFromName(d.category);
    if (category === undefined) throw new Error(`${JSON.stringify(d.category)} is no category`);
    const w: WriterDiagnostic = {
      file: undefined,
      pos: -1,
      end: -1,
      code: d.code,
      category,
      messageText: model.fromString(d.messageText),
      messageChain: chainIn(d.next, d.code, category),
      relatedInformation: [],
    };
    if (d.location === undefined) w.pos = w.end = rank++;
    else place(d.location, w, false);
    for (const r of d.relatedInformation ?? []) {
      const rw: WriterDiagnostic = {
        file: undefined,
        pos: -1,
        end: -1,
        code: r.code,
        category: Category.Message,
        messageText: model.fromString(r.messageText),
        messageChain: chainIn(r.next, r.code, Category.Message),
        relatedInformation: [],
      };
      place(r.location, rw, true);
      w.relatedInformation.push(rw);
    }
    return w;
  });
  for (const m of madeUp.values()) {
    m.file.text = m.text.build(m.file.fileName);
    m.file.lineMap = model.lineStarts(m.file.text);
  }
  for (const p of pending) p();
  return { files: inputs, diagnostics: out };
}
