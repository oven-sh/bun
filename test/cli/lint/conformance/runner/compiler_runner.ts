// Port of internal/testrunner/compiler_runner.go and compiler_runner_test.go of typescript-go 89d5d5b up to the compilation, with EnumerateFiles of harnessutil.go: the test files of the two suites and the instances that the reference makes of them.
import { readdirSync } from "node:fs";
import { InvalidUtf8Error, compareStrings, toLower } from "./gostrings";
import { type TestConfiguration, getInstanceStatus, skippedEmitTests } from "./harnessutil_options";
import { HarnessFatal, type NamedTestConfiguration, getFileBasedTestConfigurations } from "./harnessutil_variations";
import {
  type ParseTestFilesResult,
  type TestUnit,
  extractCompilerSettings,
  parseTestFilesAndSymlinks,
} from "./test_case_parser";
import { optionsDeclarations } from "./tsoptions";
import {
  combinePaths,
  ensureTrailingDirectorySeparator,
  getAnyExtensionFromPath,
  getBaseFileName,
  getNormalizedAbsolutePath,
  normalizePath,
  normalizeSlashes,
} from "./tspath";
import { readFile } from "./vfs";

// compiler_runner.go:28
const compilerBaselineRegex = /\.tsx?$/;

// compiler_runner.go:36; a value is the name that String gives its type: the name of the suite and of the directory of its cases.
export const TestTypeConformance = "conformance";
export const TestTypeRegression = "compiler";
export type CompilerTestType = typeof TestTypeConformance | typeof TestTypeRegression;

// The reference stops before it runs a test: the test files cannot be listed, or two of them have one base name.
export class TestFilesError extends Error {}

// An instance as the reference makes it of a test file: a subtest of TestSubmodule, up to its compilation and without its oracle.
export interface EnumeratedInstance {
  // compiler_runner.go:250, the configured name: the stem of the baselines of the instance, "ES5For-of1(target=es2015).ts".
  name: string;
  // compiler_runner.go:195: the name that the reference gives the subtest, "ES5For-of1.ts target=es2015".
  testName: string;
  suite: CompilerTestType;
  // The path of the test file below the directory of the cases, with forward slashes.
  file: string;
  basename: string;
  // The description of the values of the options that vary, "target=es2015"; empty where no option varies.
  configName: string;
  // The settings of the instance, names in lower case. undefined: the test file has no setting and the reference passes no configuration.
  config: TestConfiguration | undefined;
  // run: the reference compiles the instance. skip: SkipUnsupportedCompilerOptions skips it. invalid: the reference fails or stops before that rule, or the test file is no UTF-8 text.
  status: "run" | "skip" | "invalid";
  // The text of t.Skipf, for status skip.
  skipReason?: string;
  // The text of the t.Fatal or of the panic, for status invalid.
  invalidReason?: string;
  // What the config reader does not model for the instance: where this is not empty, the status may not be that of the reference.
  notes: string[];
  // The test is one of skippedEmitTests: the reference skips its "output" subtest and still compares its error baseline.
  emitOnly: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// repo.TestDataPath of the reference is where its relative base paths start; here that is the working directory.
function testDataPath(): string {
  return normalizeSlashes(process.cwd());
}

// harnessutil.go:990 and :998; the error that the reference returns is thrown.
function enumerateFiles(folder: string, testRegex: RegExp | undefined, recursive: boolean): string[] {
  const files = listFilesWorker(testRegex, recursive, folder);
  return files.map(normalizeSlashes);
}

// harnessutil.go:1002; os.ReadDir gives the entries of a directory in the order of the bytes of their names, and a link to a directory is no directory.
function listFilesWorker(spec: RegExp | undefined, recursive: boolean, folder: string): string[] {
  folder = getNormalizedAbsolutePath(folder, testDataPath());
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name));
  const paths: string[] = [];
  for (const entry of entries) {
    // filepath.Join of a clean folder and the name of an entry puts one separator between them.
    const path = normalizePath(ensureTrailingDirectorySeparator(folder) + entry.name);
    if (!entry.isDirectory()) {
      if (spec === undefined || spec.test(path)) paths.push(path);
    } else if (recursive) {
      for (const subPath of listFilesWorker(spec, recursive, path)) paths.push(subPath);
    }
  }
  return paths;
}

// compiler_runner.go:86
export const skippedTests: readonly string[] = [
  // Tests that depended on typescript.d.ts in built.
  "APILibCheck.ts",
  "APISample_Watch.ts",
  "APISample_WatchWithDefaults.ts",
  "APISample_WatchWithOwnWatchHost.ts",
  "APISample_compile.ts",
  "APISample_jsdoc.ts",
  "APISample_linter.ts",
  "APISample_parseConfig.ts",
  "APISample_transform.ts",
  "APISample_watcher.ts",

  // These tests contain options that have been completely removed, so fail to parse.
  "preserveUnusedImports.ts",
  "noCrashWithVerbatimModuleSyntaxAndImportsNotUsedAsValues.ts",
  "verbatimModuleSyntaxCompat.ts",
  "verbatimModuleSyntaxCompat2.ts",
  "verbatimModuleSyntaxCompat3.ts",
  "verbatimModuleSyntaxCompat4.ts",
  "preserveValueImports.ts",
  "preserveValueImports_importsNotUsedAsValues.ts",
  "preserveValueImports_errors.ts",
  "preserveValueImports_mixedImports.ts",
  "preserveValueImports_module.ts",
  "importsNotUsedAsValues_error.ts",
  "alwaysStrictNoImplicitUseStrict.ts",
  "nonPrimitiveIndexingWithForInSupressError.ts",
  "parameterInitializerBeforeDestructuringEmit.ts",
  "mappedTypeUnionConstraintInferences.ts",
  "lateBoundConstraintTypeChecksCorrectly.ts",
  "keyofDoesntContainSymbols.ts",
  "isolatedModulesOut.ts",
  "noStrictGenericChecks.ts",
  "noImplicitUseStrict_umd.ts",
  "noImplicitUseStrict_system.ts",
  "noImplicitUseStrict_es6.ts",
  "noImplicitUseStrict_commonjs.ts",
  "noImplicitUseStrict_amd.ts",
  "noImplicitAnyIndexingSuppressed.ts",
  "excessPropertyErrorsSuppressed.ts",
  "moduleNoneDynamicImport.ts",
  "moduleNoneErrors.ts",
  "moduleNoneOutFile.ts",
  "noErrorUsingImportExportModuleAugmentationInDeclarationFile1.ts",
  "noErrorUsingImportExportModuleAugmentationInDeclarationFile2.ts",
  "noErrorUsingImportExportModuleAugmentationInDeclarationFile3.ts",
  "requireOfJsonFileWithModuleEmitNone.ts",
  "requireOfJsonFileWithModuleNodeResolutionEmitNone.ts",
];

// compiler_runner.go:161: the compiler options for which a test file may give variations, as in "// @strict: true, false".
const compilerVaryBy = getCompilerVaryByMap();

// compiler_runner.go:163
export function getCompilerVaryByMap(): Set<string> {
  const varyByOptions = [
    ...optionsDeclarations
      .filter(
        option =>
          !option.isCommandLineOnly &&
          (option.kind === "boolean" || option.kind === "enum") &&
          (option.affectsProgramStructure ||
            option.affectsEmit ||
            option.affectsModuleResolution ||
            option.affectsBindDiagnostics ||
            option.affectsSemanticDiagnostics ||
            option.affectsSourceFile ||
            option.affectsDeclarationPath ||
            option.affectsBuildInfo),
      )
      .map(option => option.name),
    // explicit variations that do not match above conditions
    "noEmit",
    "isolatedModules",
  ];
  const varyByMap = new Set<string>();
  for (const option of varyByOptions) {
    varyByMap.add(toLower(option));
  }
  return varyByMap;
}

// compiler_runner.go:226
export interface CompilerFileBasedTest {
  filename: string;
  content: string;
  configurations: NamedTestConfiguration[];
}

// The test of a file, or the text with which the reference stops at the file: that of a panic or of a t.Fatal.
export type CompilerFileBasedTestResult = { ok: true; value: CompilerFileBasedTest } | { ok: false; reason: string };

// compiler_runner.go:232
export function getCompilerFileBasedTest(filename: string): CompilerFileBasedTestResult {
  let content: string;
  try {
    const read = readFile(filename);
    if (!read.ok) return { ok: false, reason: "Could not read test file: " + filename };
    content = read.contents;
  } catch (error) {
    // Bytes that are no UTF-8 are a text to the reference and none here.
    if (!(error instanceof InvalidUtf8Error)) throw error;
    return { ok: false, reason: error.message };
  }
  const settings = extractCompilerSettings(content);
  let configurations: NamedTestConfiguration[];
  try {
    configurations = getFileBasedTestConfigurations(settings, compilerVaryBy);
  } catch (error) {
    if (!(error instanceof HarnessFatal)) throw error;
    return { ok: false, reason: error.message };
  }
  return { ok: true, value: { filename, content, configurations } };
}

// compiler_runner.go:273, the configured name of newCompilerTest: the description of the configuration goes before the extension.
export function getConfiguredName(filename: string, namedConfiguration: NamedTestConfiguration | undefined): string {
  const basename = getBaseFileName(filename);
  let configuredName = basename;
  if (namedConfiguration !== undefined && namedConfiguration.name !== "") {
    const extname = getAnyExtensionFromPath(basename, undefined, false);
    const extensionlessBasename = basename.slice(0, basename.length - extname.length);
    configuredName = `${extensionlessBasename}(${namedConfiguration.name})${extname}`;
  }
  return configuredName;
}

type Status = Pick<EnumeratedInstance, "status" | "skipReason" | "invalidReason" | "notes">;

// compiler_runner.go:50, for the tests of the submodule: the runner of the reference's own tests is not ported.
export class CompilerBaselineRunner {
  private testFiles: string[] = [];
  // The directory that holds the directory of each suite, absolute and normalized.
  readonly casesDirectory: string;
  readonly basePath: string;
  readonly testSuitName: CompilerTestType;

  // compiler_runner.go:59; the reference makes the base path from its own layout, this takes the directory of the cases.
  constructor(testType: CompilerTestType, casesDirectory: string) {
    this.testSuitName = testType;
    this.casesDirectory = getNormalizedAbsolutePath(casesDirectory, testDataPath());
    this.basePath = combinePaths(this.casesDirectory, this.testSuitName);
  }

  // compiler_runner.go:74; throws TestFilesError where the reference panics.
  enumerateTestFiles(): readonly string[] {
    if (this.testFiles.length > 0) {
      return this.testFiles;
    }
    let files: string[];
    try {
      files = enumerateFiles(this.basePath, compilerBaselineRegex, true);
    } catch (error) {
      throw new TestFilesError("Could not read compiler test files: " + messageOf(error));
    }
    this.testFiles = files;
    return files;
  }

  // True: EnumerateTestFiles lists a file of this name when it is there.
  isTestFile(filename: string): boolean {
    const below = filename.startsWith(ensureTrailingDirectorySeparator(this.basePath));
    return below && compilerBaselineRegex.test(filename);
  }

  // compiler_runner.go:137 without the run: the instances in the order in which the reference starts them. The reference first removes the baselines of an earlier run; this writes none.
  runTests(): EnumeratedInstance[] {
    const files = this.enumerateTestFiles();
    const instances: EnumeratedInstance[] = [];
    for (const filename of files) {
      if (skippedTests.includes(getBaseFileName(filename))) {
        continue;
      }
      for (const instance of this.runTest(filename)) instances.push(instance);
    }
    return instances;
  }

  // compiler_runner.go:190 without the run: an instance for each configuration of the test file, or one without a configuration. A file at which the reference stops is one instance of the status invalid.
  runTest(filename: string): EnumeratedInstance[] {
    const test = getCompilerFileBasedTest(filename);
    const basename = getBaseFileName(filename);
    if (!test.ok) {
      const status: Status = { status: "invalid", invalidReason: test.reason, notes: [] };
      return [this.instanceOf(basename, filename, undefined, status)];
    }
    // The reference parses the units again for every instance; they are the same for each.
    let parsed: ParseTestFilesResult<TestUnit> | undefined;
    const payload = () =>
      (parsed ??= parseTestFilesAndSymlinks<TestUnit>(test.value.content, test.value.filename, (name, content) => ({
        value: { content, name },
        error: undefined,
      })));
    const instances: EnumeratedInstance[] = [];
    if (test.value.configurations.length > 0) {
      for (const config of test.value.configurations) {
        let testName = basename;
        if (config.name !== "") {
          testName += " " + config.name;
        }
        instances.push(this.runSingleConfigTest(testName, test.value, config, payload));
      }
    } else {
      instances.push(this.runSingleConfigTest(basename, test.value, undefined, payload));
    }
    return instances;
  }

  // compiler_runner.go:206 up to the compilation: makeUnitsFromTest, the options of newCompilerTest and SkipUnsupportedCompilerOptions. A panic, which the reference recovers to fail the subtest, is the status invalid.
  private runSingleConfigTest(
    testName: string,
    test: CompilerFileBasedTest,
    config: NamedTestConfiguration | undefined,
    payload: () => ParseTestFilesResult<TestUnit>,
  ): EnumeratedInstance {
    let status: Status;
    try {
      const units = payload();
      if (!units.ok) {
        status = { status: "invalid", invalidReason: units.reason, notes: [] };
      } else {
        const made = getInstanceStatus(getBaseFileName(test.filename), units, config?.config);
        status = { status: made.status, notes: made.notes };
        if (made.skipReason !== undefined) status.skipReason = made.skipReason;
        if (made.invalidReason !== undefined) status.invalidReason = made.invalidReason;
      }
    } catch (error) {
      status = { status: "invalid", invalidReason: messageOf(error), notes: [] };
    }
    return this.instanceOf(testName, test.filename, config, status);
  }

  private instanceOf(
    testName: string,
    filename: string,
    config: NamedTestConfiguration | undefined,
    status: Status,
  ): EnumeratedInstance {
    const basename = getBaseFileName(filename);
    const prefix = ensureTrailingDirectorySeparator(this.casesDirectory);
    return {
      name: getConfiguredName(filename, config),
      testName,
      suite: this.testSuitName,
      file: filename.startsWith(prefix) ? filename.slice(prefix.length) : filename,
      basename,
      configName: config?.name ?? "",
      config: config?.config,
      ...status,
      emitOnly: skippedEmitTests.has(basename),
    };
  }
}

// compiler_runner_test.go:33: the runners in the order of the reference, the compiler suite before the conformance suite.
export function newCompilerBaselineRunners(casesDirectory: string): CompilerBaselineRunner[] {
  return [
    new CompilerBaselineRunner(TestTypeRegression, casesDirectory),
    new CompilerBaselineRunner(TestTypeConformance, casesDirectory),
  ];
}

// compiler_runner_test.go:20 without the run: the instances of both suites, after the assertion that no two test files have one base name. Throws TestFilesError where the reference panics or fails that assertion.
export function enumerateInstances(casesDirectory: string): EnumeratedInstance[] {
  const runners = newCompilerBaselineRunners(casesDirectory);

  const seenTests = new Set<string>();
  for (const runner of runners) {
    for (const file of runner.enumerateTestFiles()) {
      const test = getBaseFileName(file);
      if (seenTests.has(test)) throw new TestFilesError(`Duplicate test file: ${test}`);
      seenTests.add(test);
    }
  }

  const instances: EnumeratedInstance[] = [];
  for (const runner of runners) {
    for (const instance of runner.runTests()) instances.push(instance);
  }
  return instances;
}

// The instances of the test file at a path below the directory of the cases, as RunTests makes them: none where skippedTests has its name, none for a path that no runner lists.
export function enumerateCase(casesDirectory: string, casePath: string): EnumeratedInstance[] {
  for (const runner of newCompilerBaselineRunners(casesDirectory)) {
    const filename = getNormalizedAbsolutePath(casePath, runner.casesDirectory);
    if (!runner.isTestFile(filename)) continue;
    if (skippedTests.includes(getBaseFileName(filename))) return [];
    return runner.runTest(filename);
  }
  return [];
}
