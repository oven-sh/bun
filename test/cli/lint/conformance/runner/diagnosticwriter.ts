// Port of internal/diagnosticwriter/diagnosticwriter.go of typescript-go 89d5d5b, the functions that an error baseline reaches (rules "tsgo"); rules "tsc" are the writers of program.ts and watch.ts of TypeScript 5848bc5.
import { padLeft } from "./gostrings";
import { computeLineOfPosition } from "./scanner";
import { type TextModel, utf16Model, utf8Model } from "./text_model";
import { type ComparePathsOptions, convertToRelativePath, pathIsAbsolute } from "./tspath";

// diagnostics.Category: the order of diagnostics compares these values.
export enum Category {
  Warning = 0,
  Error = 1,
  Suggestion = 2,
  Message = 3,
}

const categoryNames = ["warning", "error", "suggestion", "message"] as const;

// A panic of the reference: the test that wrote the baseline would have failed.
export class WriterPanic extends Error {}

// Category.Name
export function categoryName(category: Category): string {
  const name = categoryNames[category];
  if (name === undefined) throw new WriterPanic("Unhandled diagnostic category");
  return name;
}

export function categoryFromName(name: string): Category | undefined {
  const at = categoryNames.indexOf(name as (typeof categoryNames)[number]);
  return at < 0 ? undefined : (at as Category);
}

export interface Rules {
  readonly name: "tsgo" | "tsc";
  readonly model: TextModel;
  // Root of a default library file that is no input file.
  readonly libraryRoot: string;
  // Root of a relative name.
  readonly sourceRoot: string;
}

export const tsgoRules: Rules = {
  name: "tsgo",
  model: utf8Model,
  libraryRoot: "bundled:///libs/",
  sourceRoot: "/.src/",
};
export const tscRules: Rules = { name: "tsc", model: utf16Model, libraryRoot: "/.ts/", sourceRoot: "/.src/" };

// Text, names and positions are in the text model of the rules.
export interface FileLike {
  fileName: string;
  text: string;
  lineMap?: number[];
  // TypeScript sorts by SourceFile.path, which a configuration file does not have.
  isConfigFile?: boolean;
}

export interface Diagnostic {
  file: FileLike | undefined;
  // Without a file the reference has -1, so that the code orders such diagnostics; a caller that gives their rank keeps their order.
  pos: number;
  end: number;
  code: number;
  category: Category;
  // Stands before the code in place of "TS"; TypeScript has no such prefix.
  source?: string;
  messageText: string;
  messageChain: Diagnostic[];
  relatedInformation: Diagnostic[];
}

// The new line is text of the model; the directory is a JavaScript string, as tspath takes it.
export interface FormattingOptions extends ComparePathsOptions {
  newLine: string;
}

export function ecmaLineMap(rules: Rules, file: FileLike): number[] {
  return (file.lineMap ??= rules.model.lineStarts(file.text));
}

// scanner.GetECMALineOfPosition
export function getECMALineOfPosition(rules: Rules, file: FileLike, pos: number): number {
  return computeLineOfPosition(ecmaLineMap(rules, file), pos);
}

// scanner.GetECMALineAndUTF16CharacterOfPosition: it slices the text up to the position, where TypeScript only asserts that the position is not before the text.
export function getECMALineAndUTF16CharacterOfPosition(rules: Rules, file: FileLike, pos: number): [number, number] {
  if (!(pos >= 0 && (rules.name === "tsc" || pos <= file.text.length))) {
    throw new WriterPanic(`position ${pos} is outside ${file.fileName}`);
  }
  const lineMap = ecmaLineMap(rules, file);
  const line = computeLineOfPosition(lineMap, pos);
  return [line, rules.model.utf16Length(file.text, lineMap[line], pos)];
}

// tspath compares JavaScript strings and the options hold such strings, so a name of the model is decoded for it and its result encoded again.
function convertToRelativePathOf(rules: Rules, fileName: string, options: ComparePathsOptions): string {
  return rules.model.fromString(convertToRelativePath(rules.model.toString(fileName), options));
}

function getDiagnosticPath(rules: Rules, d: Diagnostic): string {
  if (d.file === undefined) return "";
  if (rules.name === "tsc" && d.file.isConfigFile === true) return "";
  return d.file.fileName;
}

// CompareASTDiagnostics, which is ast.CompareDiagnostics, up to the source; its later keys, the message key and its arguments, are not in a diagnostic read from text, so a tie keeps the order of the input.
export function compareDiagnostics(rules: Rules, d1: Diagnostic, d2: Diagnostic): number {
  if (d1 === d2) return 0;
  let c = rules.model.compare(getDiagnosticPath(rules, d1), getDiagnosticPath(rules, d2));
  if (c !== 0) return c;
  if (rules.name === "tsc" && (d1.file === undefined) !== (d2.file === undefined)) {
    // compareValues(undefined, start): a diagnostic without a file is before one of a configuration file.
    return d1.file === undefined ? -1 : 1;
  }
  c = d1.pos - d2.pos;
  if (c !== 0) return c;
  c = d1.end - d2.end;
  if (c !== 0) return c;
  c = d1.code - d2.code;
  if (c !== 0) return c;
  if (rules.name === "tsc") return 0;
  c = d1.category - d2.category;
  if (c !== 0) return c;
  return rules.model.compare(d1.source ?? "", d2.source ?? "");
}

const foregroundColorEscapeGrey = "\u001b[90m";
const foregroundColorEscapeRed = "\u001b[91m";
const foregroundColorEscapeYellow = "\u001b[93m";
const foregroundColorEscapeBlue = "\u001b[94m";
const foregroundColorEscapeCyan = "\u001b[96m";

const gutterStyleSequence = "\u001b[7m";
const gutterSeparator = " ";
const resetEscapeSequence = "\u001b[0m";
const ellipsis = "...";
const halfIndent = "  ";
const indent = "    ";

const fileAppearsToBeBinaryCode = 1490;

export function formatDiagnosticsWithColorAndContext(
  rules: Rules,
  diags: Diagnostic[],
  formatOpts: FormattingOptions,
): string {
  let output = "";
  for (let i = 0; i < diags.length; i++) {
    // TypeScript ends every diagnostic with a line break and puts nothing between two of them.
    if (i > 0 && rules.name !== "tsc") output += formatOpts.newLine;
    output += formatDiagnosticWithColorAndContext(rules, diags[i], formatOpts);
  }
  return output;
}

export function formatDiagnosticWithColorAndContext(
  rules: Rules,
  diagnostic: Diagnostic,
  formatOpts: FormattingOptions,
): string {
  if (rules.name === "tsc") return formatDiagnosticWithColorAndContextTsc(rules, diagnostic, formatOpts);
  let output = "";
  if (diagnostic.file !== undefined) {
    output += writeLocation(rules, diagnostic.file, diagnostic.pos, formatOpts, writeWithStyleAndReset);
    output += " - ";
  }

  output += writeWithStyleAndReset(categoryName(diagnostic.category), getCategoryFormat(diagnostic.category));
  output +=
    foregroundColorEscapeGrey + " " + diagnosticPrefix(diagnostic) + diagnostic.code + ": " + resetEscapeSequence;
  output += flattenDiagnosticMessage(diagnostic, formatOpts.newLine);

  if (diagnostic.file !== undefined && diagnostic.code !== fileAppearsToBeBinaryCode) {
    output += formatOpts.newLine;
    output += writeCodeSnippet(
      rules,
      diagnostic.file,
      diagnostic.pos,
      diagnostic.end - diagnostic.pos,
      getCategoryFormat(diagnostic.category),
      "",
      formatOpts,
    );
    output += formatOpts.newLine;
  }

  for (const relatedInformation of diagnostic.relatedInformation) {
    const file = relatedInformation.file;
    if (file !== undefined) {
      output += formatOpts.newLine;
      output += "  ";
      const pos = relatedInformation.pos;
      output += writeLocation(rules, file, pos, formatOpts, writeWithStyleAndReset);
      output += " - ";
      output += flattenDiagnosticMessage(relatedInformation, formatOpts.newLine);
      output += writeCodeSnippet(
        rules,
        file,
        pos,
        relatedInformation.end - relatedInformation.pos,
        foregroundColorEscapeCyan,
        "    ",
        formatOpts,
      );
    }
    output += formatOpts.newLine;
  }
  return output;
}

// formatDiagnosticsWithColorAndContext of src/compiler/program.ts, one diagnostic.
function formatDiagnosticWithColorAndContextTsc(rules: Rules, diagnostic: Diagnostic, host: FormattingOptions): string {
  let output = "";
  if (diagnostic.file !== undefined) {
    output += writeLocation(rules, diagnostic.file, diagnostic.pos, host, writeWithStyleAndReset);
    output += " - ";
  }

  output += writeWithStyleAndReset(categoryName(diagnostic.category), getCategoryFormatTsc(diagnostic.category));
  output += writeWithStyleAndReset(` TS${diagnostic.code}: `, foregroundColorEscapeGrey);
  output += flattenDiagnosticMessage(diagnostic, host.newLine);

  if (diagnostic.file !== undefined && diagnostic.code !== fileAppearsToBeBinaryCode) {
    output += host.newLine;
    output += formatCodeSpanTsc(
      rules,
      diagnostic.file,
      diagnostic.pos,
      diagnostic.end - diagnostic.pos,
      "",
      getCategoryFormatTsc(diagnostic.category),
      host,
    );
  }
  if (diagnostic.relatedInformation.length > 0) {
    output += host.newLine;
    for (const related of diagnostic.relatedInformation) {
      if (related.file !== undefined) {
        output += host.newLine;
        output += halfIndent + writeLocation(rules, related.file, related.pos, host, writeWithStyleAndReset);
        output += formatCodeSpanTsc(
          rules,
          related.file,
          related.pos,
          related.end - related.pos,
          indent,
          foregroundColorEscapeCyan,
          host,
        );
      }
      output += host.newLine;
      output += indent + flattenDiagnosticMessage(related, host.newLine);
    }
  }
  output += host.newLine;
  return output;
}

// getCategoryFormat of src/compiler/program.ts
function getCategoryFormatTsc(category: Category): string {
  if (category === Category.Suggestion) {
    throw new WriterPanic("Should never get an Info diagnostic on the command line.");
  }
  return getCategoryFormat(category);
}

// formatCodeSpan of src/compiler/program.ts
function formatCodeSpanTsc(
  rules: Rules,
  file: FileLike,
  start: number,
  length: number,
  indent: string,
  squiggleColor: string,
  host: FormattingOptions,
): string {
  const [firstLine, firstLineChar] = getECMALineAndUTF16CharacterOfPosition(rules, file, start);
  const [lastLine, lastLineChar] = getECMALineAndUTF16CharacterOfPosition(rules, file, start + length);
  const lastLineInFile = getECMALineOfPosition(rules, file, file.text.length);
  const lineMap = ecmaLineMap(rules, file);

  const hasMoreThanFiveLines = lastLine - firstLine >= 4;
  let gutterWidth = (lastLine + 1 + "").length;
  if (hasMoreThanFiveLines) {
    gutterWidth = Math.max(ellipsis.length, gutterWidth);
  }

  let context = "";
  for (let i = firstLine; i <= lastLine; i++) {
    context += host.newLine;
    // If the error spans over 5 lines, only the first 2 and the last 2 lines are shown: skip ahead to the second-to-last line.
    if (hasMoreThanFiveLines && firstLine + 1 < i && i < lastLine - 1) {
      context +=
        indent +
        writeWithStyleAndReset(ellipsis.padStart(gutterWidth), gutterStyleSequence) +
        gutterSeparator +
        host.newLine;
      i = lastLine - 1;
    }

    const lineStart = lineMap[i];
    const lineEnd = i < lastLineInFile ? lineMap[i + 1] : file.text.length;
    let lineContent = file.text.slice(lineStart, lineEnd);
    lineContent = lineContent.trimEnd(); // trim from end
    lineContent = lineContent.replace(/\t/g, " "); // convert tabs to single spaces

    // Output the gutter and the actual contents of the line.
    context +=
      indent + writeWithStyleAndReset((i + 1 + "").padStart(gutterWidth), gutterStyleSequence) + gutterSeparator;
    context += lineContent + host.newLine;

    // Output the gutter and the error span for the line using tildes.
    context += indent + writeWithStyleAndReset("".padStart(gutterWidth), gutterStyleSequence) + gutterSeparator;
    context += squiggleColor;
    if (i === firstLine) {
      // On the last line the squiggle ends at the last character; otherwise it runs to the end of the line.
      const lastCharForLine = i === lastLine ? lastLineChar : undefined;

      context += lineContent.slice(0, firstLineChar).replace(/\S/g, " ");
      context += lineContent.slice(firstLineChar, lastCharForLine).replace(/./g, "~");
    } else if (i === lastLine) {
      context += lineContent.slice(0, lastLineChar).replace(/./g, "~");
    } else {
      // Squiggle the entire line.
      context += lineContent.replace(/./g, "~");
    }
    context += resetEscapeSequence;
  }
  return context;
}

export function writeCodeSnippet(
  rules: Rules,
  sourceFile: FileLike,
  start: number,
  length: number,
  squiggleColor: string,
  indent: string,
  formatOpts: FormattingOptions,
): string {
  const model = rules.model;
  let writer = "";
  const [firstLine, firstLineChar] = getECMALineAndUTF16CharacterOfPosition(rules, sourceFile, start);
  let [lastLine, lastLineChar] = getECMALineAndUTF16CharacterOfPosition(rules, sourceFile, start + length);
  if (length === 0) {
    lastLineChar++; // When length is zero, squiggle the character right after the start position.
  }

  const lastLineOfFile = getECMALineOfPosition(rules, sourceFile, sourceFile.text.length);
  const lineMap = ecmaLineMap(rules, sourceFile);

  const hasMoreThanFiveLines = lastLine - firstLine >= 4;
  let gutterWidth = String(lastLine + 1).length;
  if (hasMoreThanFiveLines) {
    gutterWidth = Math.max(ellipsis.length, gutterWidth);
  }

  for (let i = firstLine; i <= lastLine; i++) {
    writer += formatOpts.newLine;

    // If the error spans over 5 lines, only the first 2 and the last 2 lines are shown: skip ahead to the second-to-last line.
    if (hasMoreThanFiveLines && firstLine + 1 < i && i < lastLine - 1) {
      writer += indent;
      writer += gutterStyleSequence;
      writer += padLeft(ellipsis, gutterWidth);
      writer += resetEscapeSequence;
      writer += gutterSeparator;
      writer += formatOpts.newLine;
      i = lastLine - 1;
    }

    const lineStart = lineMap[i];
    const lineEnd = i < lastLineOfFile ? lineMap[i + 1] : sourceFile.text.length;

    let lineContent = model.trimEnd(sourceFile.text.slice(lineStart, lineEnd)); // trim from end
    lineContent = lineContent.replaceAll("\t", " "); // convert tabs to single spaces

    // Output the gutter and the actual contents of the line.
    writer += indent;
    writer += gutterStyleSequence;
    writer += padLeft(String(i + 1), gutterWidth);
    writer += resetEscapeSequence;
    writer += gutterSeparator;
    writer += lineContent;
    writer += formatOpts.newLine;

    // Output the gutter and the error span for the line using tildes.
    writer += indent;
    writer += gutterStyleSequence;
    writer += padLeft("", gutterWidth);
    writer += resetEscapeSequence;
    writer += gutterSeparator;
    writer += squiggleColor;
    if (i === firstLine) {
      // On the last line the squiggle ends at the last character; otherwise it runs to the end of the line.
      const lastCharForLine = i === lastLine ? lastLineChar : model.utf16Length(lineContent, 0, lineContent.length);

      // Fill with spaces until the first character, then squiggle the remainder of the line.
      writer += repeat(" ", firstLineChar);
      writer += repeat("~", lastCharForLine - firstLineChar);
    } else if (i === lastLine) {
      // Squiggle until the final character.
      writer += repeat("~", lastLineChar);
    } else {
      // Squiggle the entire line.
      writer += repeat("~", model.utf16Length(lineContent, 0, lineContent.length));
    }

    writer += resetEscapeSequence;
  }
  return writer;
}

// strings.Repeat
function repeat(s: string, count: number): string {
  if (count < 0) throw new WriterPanic("strings: negative Repeat count");
  return s.repeat(count);
}

export function flattenDiagnosticMessage(d: Diagnostic, newLine: string): string {
  let output = d.messageText;
  for (const chain of d.messageChain) {
    output += flattenDiagnosticMessageChain(chain, newLine, 1 /*level*/);
  }
  return output;
}

function flattenDiagnosticMessageChain(chain: Diagnostic, newLine: string, level: number): string {
  let output = newLine;
  for (let i = 0; i < level; i++) {
    output += "  ";
  }
  output += chain.messageText;
  for (const child of chain.messageChain) {
    output += flattenDiagnosticMessageChain(child, newLine, level + 1);
  }
  return output;
}

// The prefix shown before the code of a diagnostic: "TS" for the compiler, or the source of a diagnostic that has one.
function diagnosticPrefix(diagnostic: Diagnostic): string {
  const source = diagnostic.source;
  if (source !== undefined && source !== "") {
    return source;
  }
  return "TS";
}

function getCategoryFormat(category: Category): string {
  switch (category) {
    case Category.Error:
      return foregroundColorEscapeRed;
    case Category.Warning:
      return foregroundColorEscapeYellow;
    case Category.Suggestion:
      return foregroundColorEscapeGrey;
    case Category.Message:
      return foregroundColorEscapeBlue;
  }
  throw new WriterPanic("Unhandled diagnostic category");
}

export type FormattedWriter = (text: string, formatStyle: string) => string;

export function writeWithStyleAndReset(text: string, formatStyle: string): string {
  return formatStyle + text + resetEscapeSequence;
}

export function writeLocation(
  rules: Rules,
  file: FileLike,
  pos: number,
  formatOpts: FormattingOptions | undefined,
  write: FormattedWriter,
): string {
  const [firstLine, firstChar] = getECMALineAndUTF16CharacterOfPosition(rules, file, pos);
  const relativeFileName =
    formatOpts !== undefined ? convertToRelativePathOf(rules, file.fileName, formatOpts) : file.fileName;
  let output = "";
  output += write(relativeFileName, foregroundColorEscapeCyan);
  output += ":";
  output += write(String(firstLine + 1), foregroundColorEscapeYellow);
  output += ":";
  output += write(String(firstChar + 1), foregroundColorEscapeYellow);
  return output;
}

interface ErrorSummary {
  totalErrorCount: number;
  globalErrors: Diagnostic[];
  errorsByFile: Map<FileLike, Diagnostic[]>;
  sortedFiles: FileLike[];
}

export function writeErrorSummaryText(
  rules: Rules,
  allDiagnostics: Diagnostic[],
  formatOpts: FormattingOptions,
): string {
  if (rules.name === "tsc") return getErrorSummaryTextTsc(rules, allDiagnostics, formatOpts.newLine);
  const errorSummary = getErrorSummary(rules, allDiagnostics);
  const totalErrorCount = errorSummary.totalErrorCount;
  if (totalErrorCount === 0) {
    return "";
  }

  const firstFile = errorSummary.sortedFiles.length > 0 ? errorSummary.sortedFiles[0] : undefined;
  const firstFileName = prettyPathForFileError(
    rules,
    firstFile,
    firstFile !== undefined ? (errorSummary.errorsByFile.get(firstFile) ?? []) : [],
    formatOpts,
  );
  const numErroringFiles = errorSummary.errorsByFile.size;

  let message: string;
  if (totalErrorCount === 1) {
    // Special-case a single error.
    if (errorSummary.globalErrors.length > 0 || firstFileName === "") {
      message = "Found 1 error.";
    } else {
      message = `Found 1 error in ${firstFileName}`;
    }
  } else {
    switch (numErroringFiles) {
      case 0:
        // No file-specific errors.
        message = `Found ${totalErrorCount} errors.`;
        break;
      case 1:
        // One file with errors.
        message = `Found ${totalErrorCount} errors in the same file, starting at: ${firstFileName}`;
        break;
      default:
        // Multiple files with errors.
        message = `Found ${totalErrorCount} errors in ${numErroringFiles} files.`;
    }
  }
  let output = "";
  output += formatOpts.newLine;
  output += message;
  output += formatOpts.newLine;
  output += formatOpts.newLine;
  if (numErroringFiles > 1) {
    output += writeTabularErrorsDisplay(rules, errorSummary, formatOpts);
    output += formatOpts.newLine;
  }
  return output;
}

function getErrorSummary(rules: Rules, diags: Diagnostic[]): ErrorSummary {
  let totalErrorCount = 0;
  const globalErrors: Diagnostic[] = [];
  const errorsByFile = new Map<FileLike, Diagnostic[]>();

  for (const diagnostic of diags) {
    if (diagnostic.category !== Category.Error) {
      continue;
    }

    totalErrorCount++;
    if (diagnostic.file === undefined) {
      globalErrors.push(diagnostic);
    } else {
      const list = errorsByFile.get(diagnostic.file);
      if (list === undefined) errorsByFile.set(diagnostic.file, [diagnostic]);
      else list.push(diagnostic);
    }
  }

  // The reference sorts the keys of a map, which come in no fixed order: files of one name stay here in the order of their first error.
  const sortedFiles = [...errorsByFile.keys()].sort((a, b) => rules.model.compare(a.fileName, b.fileName));

  return { totalErrorCount, globalErrors, errorsByFile, sortedFiles };
}

function writeTabularErrorsDisplay(rules: Rules, errorSummary: ErrorSummary, formatOpts: FormattingOptions): string {
  const sortedFiles = errorSummary.sortedFiles;

  let maxErrors = 0;
  for (const errorsForFile of errorSummary.errorsByFile.values()) {
    maxErrors = Math.max(maxErrors, errorsForFile.length);
  }

  const headerRow = "Errors  Files";
  const leftColumnHeadingLength = headerRow.split(" ")[0].length;
  const lengthOfBiggestErrorCount = String(maxErrors).length;
  const leftPaddingGoal = Math.max(leftColumnHeadingLength, lengthOfBiggestErrorCount);
  const headerPadding = Math.max(lengthOfBiggestErrorCount - leftColumnHeadingLength, 0);

  let output = "";
  output += " ".repeat(headerPadding);
  output += headerRow;
  output += formatOpts.newLine;

  for (const file of sortedFiles) {
    const fileErrors = errorSummary.errorsByFile.get(file) ?? [];
    const errorCount = fileErrors.length;

    output += padLeft(String(errorCount), leftPaddingGoal) + "  ";
    output += prettyPathForFileError(rules, file, fileErrors, formatOpts);
    output += formatOpts.newLine;
  }
  return output;
}

function prettyPathForFileError(
  rules: Rules,
  file: FileLike | undefined,
  fileErrors: Diagnostic[],
  formatOpts: FormattingOptions,
): string {
  if (file === undefined || fileErrors.length === 0) {
    return "";
  }
  const line = getECMALineOfPosition(rules, file, fileErrors[0].pos);
  let fileName = file.fileName;
  if (pathIsAbsolute(fileName) && pathIsAbsolute(formatOpts.currentDirectory)) {
    fileName = convertToRelativePathOf(rules, file.fileName, formatOpts);
  }
  return fileName + foregroundColorEscapeGrey + ":" + (line + 1) + resetEscapeSequence;
}

interface ReportFileInError {
  fileName: string;
  line: number;
}

// getErrorCountForSummary, getFilesInErrorForSummary and getErrorSummaryText of src/compiler/watch.ts; the directory is "".
function getErrorSummaryTextTsc(rules: Rules, diagnostics: Diagnostic[], newLine: string): string {
  const errorCount = diagnostics.filter(d => d.category === Category.Error).length;
  const filesInError: (ReportFileInError | undefined)[] = diagnostics
    .filter(d => d.category === Category.Error)
    .map(errorDiagnostic => {
      if (errorDiagnostic.file === undefined) return undefined;
      const fileName = errorDiagnostic.file.fileName;
      const diagnosticForFileName = diagnostics.find(d => d.file !== undefined && d.file.fileName === fileName);
      if (diagnosticForFileName === undefined) return undefined;
      const line = getECMALineOfPosition(rules, diagnosticForFileName.file!, diagnosticForFileName.pos);
      return { fileName, line: line + 1 };
    });
  if (errorCount === 0) return "";
  const nonNilFiles = filesInError.filter(f => f !== undefined);
  const distinctFileNamesWithLines = nonNilFiles
    .map(f => `${f.fileName}:${f.line}`)
    .filter((value, index, self) => self.indexOf(value) === index);

  const firstFileReference = nonNilFiles[0] && prettyPathForFileErrorTsc(nonNilFiles[0]);

  let message: string;
  if (errorCount === 1) {
    message = filesInError[0] !== undefined ? `Found 1 error in ${firstFileReference}` : "Found 1 error.";
  } else {
    message =
      distinctFileNamesWithLines.length === 0
        ? `Found ${errorCount} errors.`
        : distinctFileNamesWithLines.length === 1
          ? `Found ${errorCount} errors in the same file, starting at: ${firstFileReference}`
          : `Found ${errorCount} errors in ${distinctFileNamesWithLines.length} files.`;
  }
  const suffix = distinctFileNamesWithLines.length > 1 ? createTabularErrorsDisplayTsc(nonNilFiles) : "";
  return `${newLine}${message}${newLine}${newLine}${suffix}`;
}

function prettyPathForFileErrorTsc(error: ReportFileInError): string {
  const line = writeWithStyleAndReset(":" + error.line, foregroundColorEscapeGrey);
  return error.fileName + line;
}

function createTabularErrorsDisplayTsc(filesInError: ReportFileInError[]): string {
  const distinctFiles = filesInError.filter(
    (value, index, self) => index === self.findIndex(file => file.fileName === value.fileName),
  );
  if (distinctFiles.length === 0) return "";

  const numberLength = (num: number) => Math.log(num) * Math.LOG10E + 1;
  const fileToErrorCount = distinctFiles.map(
    file => [file, filesInError.filter(fileInError => fileInError.fileName === file.fileName).length] as const,
  );
  let maxErrors = 0;
  for (const [, count] of fileToErrorCount) maxErrors = Math.max(maxErrors, count);

  const headerRow = "Errors  Files";
  const leftColumnHeadingLength = headerRow.split(" ")[0].length;
  const leftPaddingGoal = Math.max(leftColumnHeadingLength, numberLength(maxErrors));
  const headerPadding = Math.max(numberLength(maxErrors) - leftColumnHeadingLength, 0);

  let tabularData = "";
  tabularData += " ".repeat(headerPadding) + headerRow + "\n";
  for (const [file, errorCount] of fileToErrorCount) {
    const errorCountDigitsLength = (Math.log(errorCount) * Math.LOG10E + 1) | 0;
    const leftPadding =
      errorCountDigitsLength < leftPaddingGoal ? " ".repeat(leftPaddingGoal - errorCountDigitsLength) : "";

    const fileRef = prettyPathForFileErrorTsc(file);
    tabularData += `${leftPadding}${errorCount}  ${fileRef}\n`;
  }
  return tabularData;
}

export function writeFormatDiagnostics(rules: Rules, diagnostics: Diagnostic[], formatOpts: FormattingOptions): string {
  let output = "";
  for (const diagnostic of diagnostics) {
    output += writeFormatDiagnostic(rules, diagnostic, formatOpts);
  }
  return output;
}

export function writeFormatDiagnostic(rules: Rules, diagnostic: Diagnostic, formatOpts: FormattingOptions): string {
  let output = "";
  if (diagnostic.file !== undefined) {
    const [line, character] = getECMALineAndUTF16CharacterOfPosition(rules, diagnostic.file, diagnostic.pos);
    const fileName = diagnostic.file.fileName;
    const relativeFileName = convertToRelativePathOf(rules, fileName, formatOpts);
    output += `${relativeFileName}(${line + 1},${character + 1}): `;
  }

  const prefix = rules.name === "tsc" ? "TS" : diagnosticPrefix(diagnostic);
  output += `${categoryName(diagnostic.category)} ${prefix}${diagnostic.code}: `;
  output += flattenDiagnosticMessage(diagnostic, formatOpts.newLine);
  output += formatOpts.newLine;
  return output;
}
