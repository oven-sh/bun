// Port of the options half of internal/testutil/harnessutil/harnessutil.go and of the skip rules of internal/testrunner/compiler_runner.go, typescript-go 89d5d5b.
import { atoi, compareStrings, equalFold, toLower } from "./gostrings";
import {
  type CompilerOptions,
  type JsonValue,
  type ParseConfigHost,
  type ParsedCommandLine,
  TSFalse,
  TSTrue,
  TSUnknown,
  cloneCompilerOptions,
  newCompilerOptions,
  nilSlice,
  parseCompilerOptions,
  parseJsonSourceFileConfigFileContent,
  parseListTypeOption,
} from "./tsconfig";
import { type CommandLineOption, elements, enumMap, optionsDeclarations } from "./tsoptions";
import {
  ExtensionDts,
  fileExtensionIs,
  getBaseFileName,
  getDirectoryPath,
  getNormalizedAbsolutePath,
  isRootedDiskPath,
} from "./tspath";

// compiler_runner.go:34
const srcFolder = "/.src";

// core/compileroptions.go: the values that CompileFiles and the skip rule name.
const ModuleKindAMD = 2;
const ModuleKindUMD = 3;
const ModuleKindSystem = 4;
const ModuleResolutionKindClassic = 1;
const ModuleResolutionKindNode10 = 2;
const NewLineKindNone = 0;
const NewLineKindCRLF = 1;
const ScriptTargetES5 = 1;

// harnessutil.go:57
export type TestConfiguration = ReadonlyMap<string, string>;

// harnessutil.go:64; undefined stands for a nil slice.
export interface HarnessOptions {
  useCaseSensitiveFileNames: boolean;
  baselineFile: string;
  includeBuiltFile: string;
  fileName: string;
  libFiles: string[] | undefined;
  noImplicitReferences: boolean;
  currentDirectory: string;
  symlink: string;
  link: string;
  noTypesAndSymbols: boolean;
  fullEmitPaths: boolean;
  reportDiagnostics: boolean;
  captureSuggestions: boolean;
  typescriptVersion: string;
}

// harnessutil.go:105
function newHarnessOptions(currentDirectory: string): HarnessOptions {
  return {
    useCaseSensitiveFileNames: true,
    baselineFile: "",
    includeBuiltFile: "",
    fileName: "",
    libFiles: undefined,
    noImplicitReferences: false,
    currentDirectory,
    symlink: "",
    link: "",
    noTypesAndSymbols: false,
    fullEmitPaths: false,
    reportDiagnostics: false,
    captureSuggestions: false,
    typescriptVersion: "",
  };
}

// harnessutil.go:319
export const compilerOptions: readonly CommandLineOption[] = [
  ...optionsDeclarations,
  { name: "allowNonTsExtensions", kind: "boolean" },
  { name: "noErrorTruncation", kind: "boolean" },
  { name: "suppressOutputPathCheck", kind: "boolean" },
  { name: "noCheck", kind: "boolean" },
];

// harnessutil.go:341
export const harnessCommandLineOptions: readonly CommandLineOption[] = [
  { name: "useCaseSensitiveFileNames", kind: "boolean" },
  { name: "baselineFile", kind: "string" },
  { name: "includeBuiltFile", kind: "string" },
  { name: "fileName", kind: "string" },
  { name: "libFiles", kind: "list" },
  { name: "noImplicitReferences", kind: "boolean" },
  { name: "currentDirectory", kind: "string" },
  { name: "symlink", kind: "string" },
  { name: "link", kind: "string" },
  { name: "noTypesAndSymbols", kind: "boolean" },
  { name: "fullEmitPaths", kind: "boolean" },
  { name: "reportDiagnostics", kind: "boolean" },
  { name: "captureSuggestions", kind: "boolean" },
];

// harnessutil.go:1182
export function getCommandLineOption(option: string): CommandLineOption | undefined {
  return compilerOptions.find(optionDecl => equalFold(optionDecl.name, option));
}

// harnessutil.go:399
export function getHarnessOption(name: string): CommandLineOption | undefined {
  return harnessCommandLineOptions.find(option => equalFold(option.name, name));
}

// harnessutil.go:405; returns the text of t.Fatalf, undefined when the option is set.
export function parseHarnessOption(key: string, value: unknown, harnessOptions: HarnessOptions): string | undefined {
  switch (key) {
    case "useCaseSensitiveFileNames":
    case "noImplicitReferences":
    case "noTypesAndSymbols":
    case "fullEmitPaths":
    case "reportDiagnostics":
    case "captureSuggestions":
      harnessOptions[key] = value === true;
      break;
    case "baselineFile":
    case "includeBuiltFile":
    case "fileName":
    case "currentDirectory":
    case "symlink":
    case "link":
    case "typescriptVersion":
      harnessOptions[key] = typeof value === "string" ? value : "";
      break;
    case "libFiles":
      harnessOptions.libFiles = Array.isArray(value) ? value.filter(v => typeof v === "string") : [];
      break;
    default:
      return `Unknown harness option '${key}'.`;
  }
  return undefined;
}

// A value of tsoptions.CompilerOptionsValue, or the text with which the reference fails the test.
export type OptionValue = { value: JsonValue; fatal?: undefined } | { fatal: string };

// harnessutil.go:443; fatal is the text of t.Fatalf, or of the panic of ParseListTypeOption.
export function getOptionValue(option: CommandLineOption, value: string, cwd: string): OptionValue {
  switch (option.kind) {
    case "string":
      return { value: option.isFilePath ? getNormalizedAbsolutePath(value, cwd) : value };
    case "number": {
      const numVal = atoi(value);
      if (numVal === undefined) return { fatal: `Value for option '${option.name}' must be a number, got: ${value}` };
      return { value: numVal };
    }
    case "boolean":
      switch (toLower(value)) {
        case "true":
          return { value: true };
        case "false":
          return { value: false };
      }
      return { fatal: `Value for option '${option.name}' must be a boolean, got: ${value}` };
    case "enum": {
      const map = enumMap(option);
      const enumVal = map?.get(toLower(value));
      if (enumVal === undefined) {
        const keys = [...(map?.keys() ?? [])].join(",");
        return { fatal: `Value for option '${option.name}' must be one of ${keys}, got: ${value}` };
      }
      return { value: enumVal };
    }
    case "list":
    case "listOrElement": {
      const list = parseListTypeOption(option, value);
      if (list.panic !== undefined) return { fatal: list.panic };
      if (elements(option)?.isFilePath) {
        if (list.values === nilSlice) return { value: nilSlice };
        return {
          value: list.values.map(item => (typeof item === "string" ? getNormalizedAbsolutePath(item, cwd) : item)),
        };
      }
      if (list.errors > 0) return { fatal: `Unknown value '${value}' for compiler option '${option.name}'` };
      return { value: list.values };
    }
    case "object":
      return { fatal: `Object type options like '${option.name}' are not supported` };
  }
  return { value: null };
}

// harnessutil.go:292; returns the text of t.Fatalf, undefined when every entry is set. The reference walks a Go map, this walks the sorted names.
export function setOptionsFromTestConfig(
  testConfig: TestConfiguration,
  options: CompilerOptions,
  harnessOptions: HarnessOptions,
  currentDirectory: string,
  allowUnknownOptions: boolean,
): string | undefined {
  for (const [name, value] of [...testConfig].sort(([a], [b]) => compareStrings(a, b))) {
    if (name === "typescriptversion") continue;

    const commandLineOption = getCommandLineOption(name);
    if (commandLineOption !== undefined) {
      const parsedValue = getOptionValue(commandLineOption, value, currentDirectory);
      if (parsedValue.fatal !== undefined) return parsedValue.fatal;
      parseCompilerOptions(commandLineOption.name, parsedValue.value, options);
      continue;
    }
    const harnessOption = getHarnessOption(name);
    if (harnessOption !== undefined) {
      const parsedValue = getOptionValue(harnessOption, value, currentDirectory);
      if (parsedValue.fatal !== undefined) return parsedValue.fatal;
      const fatal = parseHarnessOption(harnessOption.name, parsedValue.value, harnessOptions);
      if (fatal !== undefined) return fatal;
      continue;
    }
    if (!allowUnknownOptions) return `Unknown compiler option '${name}'.`;
  }
  return undefined;
}

export interface CompileOptions {
  options: CompilerOptions;
  harnessOptions: HarnessOptions;
  // The text with which the reference fails the test before it compiles; the options are then those set so far.
  fatal: string | undefined;
}

// harnessutil.go:81 and :115: the options that CompileFiles and CompileFilesEx hand to the program.
export function compileFilesOptions(
  testConfig: TestConfiguration | undefined,
  tsconfigOptions: CompilerOptions | undefined,
  currentDirectory: string,
): CompileOptions {
  const options = tsconfigOptions !== undefined ? cloneCompilerOptions(tsconfigOptions) : newCompilerOptions();
  if (options.newLine === NewLineKindNone) options.newLine = NewLineKindCRLF;
  if (options.skipDefaultLibCheck === TSUnknown) options.skipDefaultLibCheck = TSTrue;
  options.noErrorTruncation = TSTrue;
  const harnessOptions = newHarnessOptions(currentDirectory);

  if (testConfig !== undefined) {
    const fatal = setOptionsFromTestConfig(testConfig, options, harnessOptions, currentDirectory, false);
    if (fatal !== undefined) return { options, harnessOptions, fatal };
  }

  for (const name of ["outDir", "project", "rootDir", "tsBuildInfoFile", "baseUrl", "declarationDir"] as const) {
    if (options[name] !== "") options[name] = getNormalizedAbsolutePath(options[name], currentDirectory);
  }
  options.rootDirs = options.rootDirs?.map(rootDir => getNormalizedAbsolutePath(rootDir, currentDirectory));
  options.typeRoots = options.typeRoots?.map(typeRoot => getNormalizedAbsolutePath(typeRoot, currentDirectory));
  return { options, harnessOptions, fatal: undefined };
}

// The stringers of core.ModuleKind and core.ScriptTarget, for the values that the skip rule prints.
const moduleKindNames = new Map([
  [ModuleKindAMD, "AMD"],
  [ModuleKindUMD, "UMD"],
  [ModuleKindSystem, "System"],
]);

// harnessutil.go:1236; returns the text of t.Skipf, undefined when the instance runs.
export function skipUnsupportedCompilerOptions(options: CompilerOptions): string | undefined {
  switch (options.module) {
    case ModuleKindAMD:
    case ModuleKindUMD:
    case ModuleKindSystem:
      return `unsupported module kind ${moduleKindNames.get(options.module)}`;
  }
  switch (options.moduleResolution) {
    case ModuleResolutionKindNode10:
    case ModuleResolutionKindClassic:
      return `unsupported module resolution kind ${options.moduleResolution}`;
  }
  if (options.esModuleInterop === TSFalse) return "esModuleInterop=false is unsupported";
  if (options.allowSyntheticDefaultImports === TSFalse) return "allowSyntheticDefaultImports=false is unsupported";
  if (options.baseUrl !== "") return `unsupported baseUrl ${options.baseUrl}`;
  if (options.outFile !== "") return `unsupported outFile ${options.outFile}`;
  switch (options.target) {
    case ScriptTargetES5:
      return "unsupported target ES5";
  }
  if (options.alwaysStrict === TSFalse) return "alwaysStrict=false is unsupported";
  return undefined;
}

// compiler_runner.go:441: the "output" subtest of these is skipped with this text, their error baseline is still compared.
export const skippedEmitTests: ReadonlyMap<string, string> = new Map([
  [
    "filesEmittingIntoSameOutput.ts",
    "Output order nondeterministic due to collision on filename during parallel emit.",
  ],
  [
    "jsFileCompilationWithJsEmitPathSameAsInput.ts",
    "Output order nondeterministic due to collision on filename during parallel emit.",
  ],
  ["grammarErrors.ts", "Output order nondeterministic due to collision on filename during parallel emit."],
  [
    "jsFileCompilationEmitBlockedCorrectly.ts",
    "Output order nondeterministic due to collision on filename during parallel emit.",
  ],
  ["jsDeclarationsReexportAliasesEsModuleInterop.ts", "cls.d.ts is missing statements when run concurrently."],
  ["jsFileCompilationWithoutJsExtensions.ts", "No files are emitted."],
  ["typeOnlyMerge2.ts", "Nondeterministic contents when run concurrently."],
  ["typeOnlyMerge3.ts", "Nondeterministic contents when run concurrently."],
]);

// harnessutil.go:1228
function getConfigNameFromFileName(filename: string): string {
  const basenameLower = toLower(getBaseFileName(filename));
  if (basenameLower === "tsconfig.json" || basenameLower === "jsconfig.json") return basenameLower;
  return "";
}

// Settings by name, as a map or as an object: the configuration of an instance, the global options and the links of a case.
export type Settings = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

function entriesOf(settings: Settings | undefined): [string, string][] {
  if (settings === undefined) return [];
  return settings instanceof Map ? [...settings] : Object.entries(settings);
}

// What ParseTestFilesAndSymlinks (test_case_parser.go:130) returns for a case: every unit in order, the links, @currentDirectory, the global options.
export interface TestFiles {
  readonly units: readonly { readonly name: string; readonly content: string }[];
  readonly symlinks: Settings;
  readonly currentDirectory: string;
  readonly globalOptions?: Settings;
}

export interface InstanceStatus {
  // run: the reference compiles the instance; skip: SkipUnsupportedCompilerOptions skips it; invalid: the reference fails it before that rule.
  status: "run" | "skip" | "invalid";
  // The text of t.Skipf, for status skip.
  skipReason?: string;
  // The text of t.Fatalf or of the panic, for status invalid.
  invalidReason?: string;
  // The reference skips the "output" subtest of the instance by name and still compares its error baseline.
  emitOnly: boolean;
  // The options that the skip rule reads: those of the compilation.
  options: CompilerOptions;
  harnessOptions: HarnessOptions;
  currentDirectory: string;
  // What the config reader does not model for this instance; empty when status and options are those of the reference.
  notes: string[];
}

// test_case_parser.go:65: the units of a case as the file system of its config; it checks no path, follows no link and records that it was asked.
function newUnitsHost(test: TestFiles, currentDirectory: string): ParseConfigHost & { asked: boolean } {
  const allFiles = new Map<string, string>();
  for (const data of test.units) allFiles.set(getNormalizedAbsolutePath(data.name, currentDirectory), data.content);
  const host = {
    asked: false,
    useCaseSensitiveFileNames: true,
    fileExists(path: string): boolean {
      host.asked = true;
      return allFiles.has(path);
    },
    readFile(path: string): string | undefined {
      host.asked = true;
      return allFiles.get(path);
    },
  };
  return host;
}

// compiler_runner.go:206 up to SkipUnsupportedCompilerOptions, without the file systems and the compilation: makeUnitsFromTest, newCompilerTest, CompileFiles. host stands for the file system of the case where its config extends another file.
export function getInstanceStatus(
  basename: string,
  test: TestFiles,
  configuration: Settings | undefined,
  host?: ParseConfigHost,
): InstanceStatus {
  const notes: string[] = [];
  const unitsDirectory = test.currentDirectory === "" ? srcFolder : test.currentDirectory;
  const configUnit = test.units.find(unit => getConfigNameFromFileName(unit.name) !== "");
  let tsConfig: ParsedCommandLine | undefined;
  if (configUnit !== undefined) {
    const unitsHost = newUnitsHost(test, unitsDirectory);
    let existingOptions: CompilerOptions | undefined;
    if (new Map(entriesOf(test.globalOptions)).get("runexternalcode") === "true") {
      existingOptions = newCompilerOptions();
      existingOptions.runExternalCode = TSTrue;
    }
    const configFileName = getNormalizedAbsolutePath(configUnit.name, unitsDirectory);
    const configDir = getDirectoryPath(configFileName);
    tsConfig = parseJsonSourceFileConfigFileContent(
      configUnit.content,
      host ?? unitsHost,
      configDir,
      existingOptions,
      configFileName,
    );
    notes.push(...tsConfig.notes);
    if (unitsHost.asked && entriesOf(test.symlinks).length > 0) {
      notes.push(`the extends chain of ${configFileName} is read without the symbolic links of the case`);
    }
  }

  const harnessConfig = configuration === undefined ? undefined : new Map(entriesOf(configuration));
  const currentDirectory = getNormalizedAbsolutePath(harnessConfig?.get("currentdirectory") ?? "", srcFolder);
  if (tsConfig === undefined && harnessConfig !== undefined) {
    const baseUrl = harnessConfig.get("baseurl");
    if (baseUrl !== undefined && !isRootedDiskPath(baseUrl)) {
      harnessConfig.set("baseurl", getNormalizedAbsolutePath(baseUrl, currentDirectory));
    }
  }

  const { options, harnessOptions, fatal } = compileFilesOptions(harnessConfig, tsConfig?.options, currentDirectory);
  const result = { emitOnly: false, options, harnessOptions, currentDirectory, notes };
  const invalidReason = tsConfig?.panic ?? fatal;
  if (invalidReason !== undefined) return { status: "invalid", invalidReason, ...result };
  const skipReason = skipUnsupportedCompilerOptions(options);
  if (skipReason !== undefined) return { status: "skip", skipReason, ...result };
  const hasNonDtsFiles = test.units.some(unit => unit !== configUnit && !fileExtensionIs(unit.name, ExtensionDts));
  return { status: "run", ...result, emitOnly: hasNonDtsFiles && skippedEmitTests.has(basename) };
}
