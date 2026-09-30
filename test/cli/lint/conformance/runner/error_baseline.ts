// Port of internal/testutil/tsbaseline/error_baseline.go and util.go of typescript-go 89d5d5b; rules "tsc" are those of src/harness/harnessIO.ts of TypeScript 5848bc5 where they differ.
import {
  type Diagnostic,
  type FileLike,
  type FormattedWriter,
  type FormattingOptions,
  type Rules,
  categoryName,
  compareDiagnostics,
  flattenDiagnosticMessage,
  formatDiagnosticsWithColorAndContext,
  writeErrorSummaryText,
  writeFormatDiagnostics,
  writeLocation,
  WriterPanic,
} from "./diagnosticwriter";
import {
  type ComparePathsOptions,
  comparePaths,
  ensureTrailingDirectorySeparator,
  ExtensionDts,
  getBaseFileName,
  normalizeSlashes,
  toPath,
} from "./tspath";

// tspath.ComparePaths on names of the model: its comparers fold runes, so the names are decoded first.
export function comparePathsOf(rules: Rules, a: string, b: string, options: ComparePathsOptions): number {
  return comparePaths(rules.model.toString(a), rules.model.toString(b), options);
}

// IO
export const harnessNewLine = "\r\n";

export const formatOpts: FormattingOptions = {
  newLine: harnessNewLine,
  useCaseSensitiveFileNames: false,
  currentDirectory: "",
};

// baseline.NoContent: what stands for the baseline of an instance without a diagnostic, for which the reference wants no file.
export const noContent = "<no content>";

// harnessutil.TestFile; the name and the content are text of the model.
export interface TestFile {
  unitName: string;
  content: string;
}

// (?im)^(lib.*\.d\.ts)\(\d+,\d+\): Go's ^ is the start or after LF, its dot is all but LF, its (?i) folds s with U+017F.
export const diagnosticsLocationPrefixGo = /(?<![^\n])([lL][iI][bB][^\n]*\.[dD]\.[tT](?:[sS]|\xc5\xbf))\(\d+,\d+\)/g;
// (?i)(lib.*\.d\.ts):\d+:\d+
const diagnosticsLocationPatternGo = /([lL][iI][bB][^\n]*\.[dD]\.[tT](?:[sS]|\xc5\xbf)):\d+:\d+/g;
const diagnosticsLocationPrefixTsc = /^(lib.*\.d\.ts)\(\d+,\d+\)/gim;
const diagnosticsLocationPatternTsc = /(lib.*\.d\.ts):\d+:\d+/i;

// The regular expressions of util.go; its lineDelimiter and nonWhitespace are contentLines and blankNonWhitespace of the text model.
const tsExtension = /\.tsx?$/;
const testPathCharacters = /[\^<>:"|?*%]/g;
const testPathDotDot = /\.\.\//g;

const libFolder = "built/local/";
const builtFolder = "/.ts";

// strings.NewReplacer for old strings that are not empty: at each position the first pair in argument order whose old string is there is replaced, and matches do not overlap.
function newReplacer(oldnew: readonly (readonly [string, string])[]): (text: string) => string {
  const byOld = new Map<string, string>();
  for (const [old, replacement] of oldnew) {
    if (!byOld.has(old)) byOld.set(old, replacement);
  }
  const alternatives = [...byOld.keys()].map(old => old.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"));
  const pattern = new RegExp(alternatives.join("|"), "g");
  return text => text.replace(pattern, old => byOld.get(old)!);
}

const testPathPrefixReplacer = newReplacer([
  ["/.ts/", ""],
  ["/.lib/", ""],
  ["/.src/", ""],
  ["bundled:///libs/", ""],
  ["file:///./ts/", "file:///"],
  ["file:///./lib/", "file:///"],
  ["file:///./src/", "file:///"],
]);
const testPathTrailingReplacerTrailingSeparator = newReplacer([
  ["/.ts/", "/"],
  ["/.lib/", "/"],
  ["/.src/", "/"],
  ["bundled:///libs/", "/"],
  ["file:///./ts/", "file:///"],
  ["file:///./lib/", "file:///"],
  ["file:///./src/", "file:///"],
]);
// testPathPrefixRegExp of src/harness/util.ts
const testPathPrefixRegExpTsc = /(?:(file:\/{3})|\/)\.(?:ts|lib|src)\//g;

export function removeTestPathPrefixes(rules: Rules, text: string, retainTrailingDirectorySeparator = false): string {
  if (rules.name === "tsc") {
    return text.replace(
      testPathPrefixRegExpTsc,
      (_, scheme) => scheme || (retainTrailingDirectorySeparator ? "/" : ""),
    );
  }
  if (retainTrailingDirectorySeparator) {
    return testPathTrailingReplacerTrailingSeparator(text);
  }
  return testPathPrefixReplacer(text);
}

export function isDefaultLibraryFile(filePath: string): boolean {
  const fileName = getBaseFileName(filePath);
  return fileName.startsWith("lib.") && fileName.endsWith(ExtensionDts);
}

export function isBuiltFile(filePath: string): boolean {
  return filePath.startsWith(libFolder) || filePath.startsWith(ensureTrailingDirectorySeparator(builtFolder));
}

export function isTsConfigFile(path: string): boolean {
  return path.includes("tsconfig") && path.includes("json");
}

// The name is a JavaScript string, as tspath takes it.
export function sanitizeTestFilePath(name: string): string {
  let path = name.replace(testPathCharacters, "_");
  path = normalizeSlashes(path);
  path = path.replace(testPathDotDot, "__dotdot/");
  path = toPath(path, "", false /*useCaseSensitiveFileNames*/);
  return path.startsWith("/") ? path.slice(1) : path;
}

export interface ErrorBaselineResult {
  // In the text model of the rules; rules.model.toBytes gives the bytes of the file.
  text: string;
  // The checks of the reference that did not hold: each one fails its test, and the text is written all the same.
  failedChecks: string[];
}

export interface ErrorBaselineFile extends ErrorBaselineResult {
  // The name of the baseline file: ".errors.txt" in place of the ".ts" or ".tsx" that ends the name of the instance.
  baselinePath: string;
}

// DoErrorBaseline without its baseline.Run, the comparison with the file of the reference, which is the caller's; the input files are the configuration file, the files to compile and the other files, in this order (compiler_runner.go verifyDiagnostics).
export function doErrorBaseline(
  rules: Rules,
  baselinePath: string,
  inputFiles: TestFile[],
  errors: Diagnostic[],
  pretty: boolean,
): ErrorBaselineFile {
  baselinePath = baselinePath.replace(tsExtension, ".errors.txt");
  let errorBaseline: ErrorBaselineResult;
  if (errors.length > 0) {
    errorBaseline = getErrorBaseline(rules, inputFiles, errors, pretty);
  } else {
    errorBaseline = { text: noContent, failedChecks: [] };
  }
  // The reference ends the test here, after the comparison; TypeScript has no such check.
  if (rules.name !== "tsc" && errors.some(d => d.code === -1)) {
    errorBaseline.failedChecks.push(
      "Found diagnostic with code -1, which is used to log critical assertion violations in the baseline. Inspect and fix those failures.",
    );
  }
  return { baselinePath, ...errorBaseline };
}

function minimalDiagnosticsToString(rules: Rules, diagnostics: Diagnostic[], pretty: boolean): string {
  if (pretty) {
    return formatDiagnosticsWithColorAndContext(rules, diagnostics, formatOpts);
  }
  return writeFormatDiagnostics(rules, diagnostics, formatOpts);
}

export function getErrorBaseline(
  rules: Rules,
  inputFiles: TestFile[],
  diagnostics: Diagnostic[],
  pretty: boolean,
): ErrorBaselineResult {
  const failedChecks: string[] = [];
  const outputLines = iterateErrorBaseline(rules, inputFiles, diagnostics, pretty, failedChecks);

  if (pretty) {
    const summary = removeTestPathPrefixes(rules, writeErrorSummaryText(rules, diagnostics, formatOpts));
    outputLines.push(summary);
  }
  return { text: outputLines.join(""), failedChecks };
}

function iterateErrorBaseline(
  rules: Rules,
  inputFiles: TestFile[],
  inputDiagnostics: Diagnostic[],
  pretty: boolean,
  failedChecks: string[],
): string[] {
  const model = rules.model;
  const diagnostics = inputDiagnostics.slice();
  diagnostics.sort((a, b) => compareDiagnostics(rules, a, b));

  let outputLines = "";
  // Count up all errors that were found in files other than lib.d.ts so we don't miss any
  let totalErrorsReportedInNonLibraryNonTsconfigFiles = 0;
  let errorsReported = 0;

  let firstLine = true;

  const newLine = (): string => {
    if (firstLine) {
      firstLine = false;
      return "";
    }
    return "\r\n";
  };

  const result: string[] = [];

  const outputErrorText = (diag: Diagnostic): void => {
    const message = flattenDiagnosticMessage(diag, harnessNewLine);

    const errLines: string[] = [];
    for (let line of removeTestPathPrefixes(rules, message).split("\n")) {
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length === 0) {
        continue;
      }
      errLines.push(`!!! ${categoryName(diag.category)} TS${diag.code}: ${line}`);
    }

    for (const info of diag.relatedInformation) {
      let location = "";
      if (info.file !== undefined) {
        location = " " + formatLocation(rules, info.file, info.pos, formatOpts, text => text);
      }
      location = removeTestPathPrefixes(rules, location);
      if (location.length > 0 && isDefaultLibraryFile(info.file!.fileName)) {
        location = location.replace(
          rules.name === "tsc" ? diagnosticsLocationPatternTsc : diagnosticsLocationPatternGo,
          "$1:--:--",
        );
      }
      errLines.push(`!!! related TS${info.code}${location}: ${flattenDiagnosticMessage(info, harnessNewLine)}`);
    }

    for (const e of errLines) {
      outputLines += newLine();
      outputLines += e;
    }

    errorsReported++;

    // Errors of lib.d.ts and of a tsconfig file are counted apart below: such a file can be an input file too, and its errors would count twice.
    if (diag.file === undefined || (!isDefaultLibraryFile(diag.file.fileName) && !isTsConfigFile(diag.file.fileName))) {
      totalErrorsReportedInNonLibraryNonTsconfigFiles++;
    }
  };

  let topDiagnostics = minimalDiagnosticsToString(rules, diagnostics, pretty);
  topDiagnostics = removeTestPathPrefixes(rules, topDiagnostics);
  topDiagnostics = topDiagnostics.replace(
    rules.name === "tsc" ? diagnosticsLocationPrefixTsc : diagnosticsLocationPrefixGo,
    "$1(--,--)",
  );

  result.push(topDiagnostics + harnessNewLine + harnessNewLine);

  // Report global errors
  for (const error of diagnostics) {
    if (error.file === undefined) {
      outputErrorText(error);
    }
  }

  result.push(outputLines);
  outputLines = "";
  errorsReported = 0;

  // 'merge' the lines of each input file with any errors associated with it
  const dupeCase = new Set<string>();
  for (const inputFile of inputFiles) {
    // Filter down to the errors in the file
    const fileErrors = diagnostics.filter(
      e =>
        e.file !== undefined &&
        comparePathsOf(
          rules,
          removeTestPathPrefixes(rules, e.file.fileName),
          removeTestPathPrefixes(rules, inputFile.unitName),
          { useCaseSensitiveFileNames: false, currentDirectory: "" },
        ) === 0,
    );

    // Header
    outputLines += `${newLine()}==== ${removeTestPathPrefixes(rules, inputFile.unitName)} (${fileErrors.length} errors) ====`;

    // Make sure we emit something for every error
    let markedErrorCount = 0;
    // For each line, emit the line followed by any error squiggles matching this line

    const lineStarts = model.lineStarts(inputFile.content);
    const lines = model.contentLines(inputFile.content);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      let line = lines[lineIndex];
      if (line.length > 0 && line.charCodeAt(line.length - 1) === 0x0d) {
        line = line.slice(0, -1);
      }

      const thisLineStart = lineStarts[lineIndex];
      // On the last line of the file, fake the next line start number so that we handle errors on the last character of the file correctly
      const nextLineStart = lineIndex === lines.length - 1 ? inputFile.content.length : lineStarts[lineIndex + 1];
      // Emit this line from the original file
      outputLines += newLine();
      outputLines += "    ";
      outputLines += line;
      for (const errDiagnostic of fileErrors) {
        // Does any error start or continue on to this line? Emit squiggles
        const errStart = errDiagnostic.pos;
        const end = errDiagnostic.end;
        if (end >= thisLineStart && (errStart < nextLineStart || lineIndex === lines.length - 1)) {
          // How many characters from the start of this line the error starts at (could be positive or negative)
          const relativeOffset = errStart - thisLineStart;
          // How many characters of the error are on this line (might be longer than this line in reality)
          const length = end - errStart - Math.max(0, thisLineStart - errStart);
          // Calculate the start of the squiggle
          const squiggleStart = Math.max(0, relativeOffset);
          outputLines += newLine();
          outputLines += "    ";
          if (rules.name === "tsc") {
            const count = Math.min(length, line.length - squiggleStart) + 1;
            if (count < 0) throw new WriterPanic("RangeError: Invalid array length");
            outputLines += model.blankNonWhitespace(line.substr(0, squiggleStart)) + new Array(count).join("~");
          } else {
            if (squiggleStart > line.length) {
              throw new WriterPanic(
                `slice bounds out of range [:${squiggleStart}] with length ${line.length}: ${inputFile.unitName} line ${lineIndex + 1}`,
              );
            }
            outputLines += model.blankNonWhitespace(line.slice(0, squiggleStart));
            // This was `new Array(count).join("~")`; which maps 0 to "", 1 to "", 2 to "~", 3 to "~~", etc.
            const squiggleEnd = Math.max(squiggleStart, Math.min(squiggleStart + length, line.length));
            outputLines += "~".repeat(model.squiggleCount(line.slice(squiggleStart, squiggleEnd)));
          }
          // If the error ended here, or we're at the end of the file, emit its message
          if (lineIndex === lines.length - 1 || nextLineStart > end) {
            outputErrorText(errDiagnostic);
            markedErrorCount++;
          }
        }
      }
    }

    // Verify we didn't miss any errors in this file
    if (markedErrorCount !== fileErrors.length) {
      failedChecks.push(`count of errors in ${inputFile.unitName}: ${markedErrorCount} != ${fileErrors.length}`);
    }
    // The reference looks the name up in a map that it never writes, so no file is a duplicate there; checkDuplicatedFileName of TypeScript notes every name.
    let isDupe = false;
    if (rules.name === "tsc") {
      const name = sanitizeTestFilePath(model.toString(inputFile.unitName));
      isDupe = dupeCase.has(name);
      dupeCase.add(name);
    }
    result.push(outputLines);
    if (isDupe) {
      // The errors of case-duplicated files are reported in both the dupe and the original, thanks to the case-insensitive path comparison: they count once.
      totalErrorsReportedInNonLibraryNonTsconfigFiles -= errorsReported;
    }
    outputLines = "";
    errorsReported = 0;
  }

  const numLibraryDiagnostics = diagnostics.filter(
    d => d.file !== undefined && (isDefaultLibraryFile(d.file.fileName) || isBuiltFile(d.file.fileName)),
  ).length;
  const numTsconfigDiagnostics = diagnostics.filter(
    d => d.file !== undefined && isTsConfigFile(d.file.fileName),
  ).length;
  // Verify we didn't miss any errors in total; the reference adds the diagnostics of supplemental outputs of a content mapper, which no file of a test case is.
  const total = totalErrorsReportedInNonLibraryNonTsconfigFiles + numLibraryDiagnostics + numTsconfigDiagnostics;
  if (total !== diagnostics.length) {
    failedChecks.push(`total number of errors: ${total} != ${diagnostics.length}`);
  }

  return result;
}

function formatLocation(
  rules: Rules,
  file: FileLike,
  pos: number,
  formatOpts: FormattingOptions,
  writeWithStyleAndReset: FormattedWriter,
): string {
  return writeLocation(rules, file, pos, formatOpts, writeWithStyleAndReset);
}
