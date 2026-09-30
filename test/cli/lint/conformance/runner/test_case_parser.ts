// Port of internal/testrunner/test_case_parser.go of typescript-go 89d5d5b: the directive grammar of a test case.
import { RE2, toLower, trimSpace, trimSuffix, utf8ToByteString } from "./gostrings";
import { skipTrivia } from "./scanner";
import { getBaseFileName } from "./tspath";

const lineDelimiter = /\r?\n/;

// A compiler setting, its name in lower case, to its value as written in the test file: "target" to "esnext, es2015".
export type RawCompilerSettings = Map<string, string>;

// All the necessary information to turn a multi file test into useful units for later compilation
export interface TestUnit {
  content: string;
  name: string;
}

export interface TestCaseContent {
  testUnitData: TestUnit[];
  tsConfigFileUnitData: TestUnit | undefined;
  symlinks: Map<string, string>;
  // The reference parses the config file here: the current directory and the global options are what that parse reads.
  currentDirectory: string;
  globalOptions: Map<string, string>;
}

// Regex for parsing options in the format "@Alpha: Value of any sort"; RE2 has the line start and the classes of Go.
const optionRegex = new RegExp(
  `${RE2.LINE_START}\\/{2}${RE2.SPACE}*@(${RE2.WORD}+)${RE2.SPACE}*:${RE2.SPACE}*([^\\r\\n]*)`,
);

// optionRegex for FindAllStringSubmatch: every match of a text, each search from the end of the match before it.
const optionRegexAll = new RegExp(optionRegex, "g");

// Regex for parsing @link option
const linkRegex = new RegExp(
  `${RE2.LINE_START}\\/{2}${RE2.SPACE}*@link${RE2.SPACE}*:${RE2.SPACE}*([^\\r\\n]*)${RE2.SPACE}*->${RE2.SPACE}*([^\\r\\n]*)`,
);

// File-specific directives used by fourslash tests
const fourslashDirectives = ["emitthisfile", "noopen"];

// compiler_runner.go:34
export const srcFolder = "/.src";

// harnessutil.go:1228
export function getConfigNameFromFileName(filename: string): string {
  const basenameLower = toLower(getBaseFileName(filename));
  if (basenameLower === "tsconfig.json" || basenameLower === "jsconfig.json") {
    return basenameLower;
  }
  return "";
}

// The content of a case, or the text of the panic that ends the reference on it.
export type MakeUnitsResult = { ok: true; value: TestCaseContent } | { ok: false; reason: string };

// Given a test file containing // @FileName directives, return the named units of code of a compiler instance.
export function makeUnitsFromTest(code: string, fileName: string): MakeUnitsResult {
  const parsed = parseTestFilesAndSymlinks<TestUnit>(code, fileName, (filename, content) => ({
    value: { content, name: filename },
    error: undefined,
  }));
  if (!parsed.ok) {
    return parsed;
  }
  const testUnits = parsed.units;
  let currentDirectory = parsed.currentDirectory;
  if (currentDirectory === "") {
    currentDirectory = srcFolder;
  }

  // check if project has tsconfig.json in the list of files
  let tsConfigFileUnitData: TestUnit | undefined;
  for (let i = 0; i < testUnits.length; i++) {
    const data = testUnits[i];
    if (getConfigNameFromFileName(data.name) !== "") {
      tsConfigFileUnitData = data;

      // delete tsconfig file entry from the list
      testUnits.splice(i, 1);
      break;
    }
  }

  return {
    ok: true,
    value: {
      testUnitData: testUnits,
      tsConfigFileUnitData,
      symlinks: parsed.symlinks,
      currentDirectory,
      globalOptions: parsed.globalOptions,
    },
  };
}

export interface ParseTestFilesOptions {
  // If true, content before the first @Filename directive goes into an implicit first file named by fileName.
  allowImplicitFirstFile: boolean;
}

// The callback of the reference returns a unit and an error: undefined stands for nil.
export type ParseFile<T> = (
  filename: string,
  content: string,
  fileOptions: Map<string, string>,
) => { value: T; error: string | undefined };

// The five results of the reference, or the text of its panic.
export type ParseTestFilesResult<T> =
  | {
      ok: true;
      units: T[];
      symlinks: Map<string, string>;
      currentDirectory: string;
      globalOptions: Map<string, string>;
      error: string | undefined;
    }
  | { ok: false; reason: string };

// Given a test file containing // @FileName and // @symlink directives, return the units, the symlinks and the directory.
export function parseTestFilesAndSymlinks<T>(
  code: string,
  fileName: string,
  parseFile: ParseFile<T>,
): ParseTestFilesResult<T> {
  return parseTestFilesAndSymlinksWithOptions(code, fileName, parseFile, { allowImplicitFirstFile: false });
}

export function parseTestFilesAndSymlinksWithOptions<T>(
  code: string,
  fileName: string,
  parseFile: ParseFile<T>,
  options: ParseTestFilesOptions,
): ParseTestFilesResult<T> {
  // List of all the subfiles we've parsed out
  const testUnits: T[] = [];

  const lines = code.split(lineDelimiter);

  // Stuff related to the subfile we're parsing
  let currentFileContent = "";
  let currentFileName = "";
  let seenContentLine = false;
  let hasSeenFile = false;
  if (options.allowImplicitFirstFile) {
    // For fourslash tests, content before the first @Filename directive goes into an implicit first file
    currentFileName = fileName;
  }
  let currentDirectory = "";
  let parseError: string | undefined;
  let currentFileOptions = new Map<string, string>();
  const symlinks = new Map<string, string>();
  const globalOptions = new Map<string, string>();

  for (const line of lines) {
    const ok = parseSymlinkFromTest(line, symlinks);
    if (ok) {
      continue;
    }
    const testMetaData = optionRegex.exec(line);
    if (testMetaData !== null) {
      // Comment line, check for global/file @options and record them
      const metaDataName = toLower(testMetaData[1]);
      const metaDataValue = trimSpace(testMetaData[2]);
      if (metaDataName === "currentdirectory") {
        currentDirectory = metaDataValue;
      }
      if (metaDataName !== "filename") {
        if (metaDataName === "symlink" && currentFileName !== "") {
          for (let link of metaDataValue.split(",")) {
            link = trimSpace(link);
            if (link !== "") {
              symlinks.set(link, currentFileName);
            }
          }
        } else if (fourslashDirectives.includes(metaDataName)) {
          // File-specific option
          currentFileOptions.set(metaDataName, metaDataValue);
        } else {
          // Global option; the reference takes a second value for a name, and the last one stays
          globalOptions.set(metaDataName, metaDataValue);
        }
        continue;
      }

      // New metadata statement after having collected some code to go with the previous metadata
      if (currentFileName !== "") {
        // Store result file - always save for regular tests, but skip empty implicit first file for fourslash
        const shouldSaveFile = !options.allowImplicitFirstFile || currentFileContent.length !== 0 || hasSeenFile;
        if (shouldSaveFile) {
          hasSeenFile = true;
          const newTestFile = parseFile(currentFileName, currentFileContent, currentFileOptions);
          if (newTestFile.error !== undefined) {
            parseError = newTestFile.error;
            break;
          }
          testUnits.push(newTestFile.value);
        }

        // Reset local data
        currentFileContent = "";
        seenContentLine = false;
        currentFileName = metaDataValue;
        currentFileOptions = new Map();
      } else {
        // First metadata marker in the file
        let hasContentBeforeFirstFilename = false;
        if (currentFileContent.length !== 0) {
          // The scanner counts bytes of UTF-8; a lone surrogate has none and counts as U+FFFD, which is no trivia.
          const text = utf8ToByteString(currentFileContent.toWellFormed());
          hasContentBeforeFirstFilename = skipTrivia(text, 0) !== text.length;
        }
        if (hasContentBeforeFirstFilename && !options.allowImplicitFirstFile) {
          // The reference panics with this text.
          return { ok: false, reason: "Non-comment test content appears before the first '// @Filename' directive" };
        }

        // The reference saves an implicit first file here, in a branch that nothing reaches: the file name is empty.
        if (hasContentBeforeFirstFilename && options.allowImplicitFirstFile && currentFileName !== "") {
          // Store the implicit first file
          hasSeenFile = true;
          const newTestFile = parseFile(currentFileName, currentFileContent, currentFileOptions);
          if (newTestFile.error !== undefined) {
            parseError = newTestFile.error;
            break;
          }
          testUnits.push(newTestFile.value);
        }

        // Reset for the new file
        currentFileContent = "";
        seenContentLine = false;
        currentFileName = trimSpace(testMetaData[2]);
        currentFileOptions = new Map();
      }
    } else {
      // Subfile content line: fourslash tests keep leading blank lines, compiler tests drop them by the length test.
      if (options.allowImplicitFirstFile) {
        if (seenContentLine) {
          currentFileContent += "\n";
        }
        seenContentLine = true;
      } else {
        if (currentFileContent.length !== 0) {
          currentFileContent += "\n";
        }
      }
      currentFileContent += line;
    }
  }

  // normalize the fileName for the single file case
  if (testUnits.length === 0 && currentFileName.length === 0) {
    currentFileName = getBaseFileName(fileName);
  }

  // if there are no parse errors so far, parse the rest of the file
  if (parseError === undefined) {
    // EOF, push whatever remains
    const newTestFile2 = parseFile(currentFileName, currentFileContent, currentFileOptions);

    parseError = newTestFile2.error;
    testUnits.push(newTestFile2.value);
  }

  return { ok: true, units: testUnits, symlinks, currentDirectory, globalOptions, error: parseError };
}

export function extractCompilerSettings(content: string): RawCompilerSettings {
  const opts: RawCompilerSettings = new Map();

  for (const match of content.matchAll(optionRegexAll)) {
    opts.set(toLower(match[1]), trimSuffix(trimSpace(match[2]), ";"));
  }

  return opts;
}

export function parseSymlinkFromTest(line: string, symlinks: Map<string, string>): boolean {
  const linkMetaData = linkRegex.exec(line);
  if (linkMetaData === null) {
    return false;
  }

  symlinks.set(trimSpace(linkMetaData[2]), trimSpace(linkMetaData[1]));
  return true;
}
