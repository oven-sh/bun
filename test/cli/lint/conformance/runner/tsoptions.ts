// Port of the option tables of internal/tsoptions of typescript-go 89d5d5b (declscompiler.go, commandlineoption.go, enummaps.go), with the fields that the test harness reads, and of the two tables that internal/testutil/harnessutil/harnessutil.go adds to them.

// commandlineoption.go:9
export type CommandLineOptionKind = "string" | "number" | "boolean" | "object" | "list" | "listOrElement" | "enum";

// commandlineoption.go:21
export interface CommandLineOption {
  readonly name: string;
  readonly kind: CommandLineOptionKind;
  readonly isFilePath?: boolean;
  readonly isCommandLineOnly?: boolean;
  readonly affectsDeclarationPath?: boolean;
  readonly affectsProgramStructure?: boolean;
  readonly affectsSemanticDiagnostics?: boolean;
  readonly affectsBuildInfo?: boolean;
  readonly affectsBindDiagnostics?: boolean;
  readonly affectsSourceFile?: boolean;
  readonly affectsModuleResolution?: boolean;
  readonly affectsEmit?: boolean;
  readonly listPreserveFalsyValues?: boolean;
}

// declscompiler.go:11: commonOptionsWithBuild (:13), then optionsForCompiler (:263).
export const optionsDeclarations: readonly CommandLineOption[] = [
  { name: "help", kind: "boolean", isCommandLineOnly: true },
  { name: "help", kind: "boolean", isCommandLineOnly: true },
  { name: "watch", kind: "boolean", isCommandLineOnly: true },
  { name: "preserveWatchOutput", kind: "boolean" },
  { name: "listFiles", kind: "boolean" },
  { name: "explainFiles", kind: "boolean" },
  { name: "listEmittedFiles", kind: "boolean" },
  { name: "pretty", kind: "boolean" },
  { name: "traceResolution", kind: "boolean" },
  { name: "diagnostics", kind: "boolean" },
  { name: "extendedDiagnostics", kind: "boolean" },
  { name: "generateCpuProfile", kind: "string", isFilePath: true },
  { name: "generateTrace", kind: "string", isFilePath: true },
  { name: "incremental", kind: "boolean" },
  { name: "declaration", kind: "boolean", affectsBuildInfo: true },
  { name: "declarationMap", kind: "boolean", affectsBuildInfo: true },
  { name: "emitDeclarationOnly", kind: "boolean", affectsBuildInfo: true },
  { name: "sourceMap", kind: "boolean", affectsBuildInfo: true },
  { name: "inlineSourceMap", kind: "boolean", affectsBuildInfo: true },
  { name: "noCheck", kind: "boolean" },
  { name: "deduplicatePackages", kind: "boolean", affectsProgramStructure: true },
  { name: "noEmit", kind: "boolean" },
  {
    name: "assumeChangesOnlyAffectDirectDependencies",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  { name: "locale", kind: "string", isCommandLineOnly: true },
  { name: "quiet", kind: "boolean" },
  { name: "singleThreaded", kind: "boolean" },
  { name: "pprofDir", kind: "string", isFilePath: true },
  { name: "checkers", kind: "number" },
  { name: "runExternalCode", kind: "boolean", isCommandLineOnly: true },
  { name: "all", kind: "boolean" },
  { name: "version", kind: "boolean" },
  { name: "init", kind: "boolean" },
  { name: "project", kind: "string", isFilePath: true },
  { name: "showConfig", kind: "boolean", isCommandLineOnly: true },
  { name: "listFilesOnly", kind: "boolean", isCommandLineOnly: true },
  { name: "ignoreConfig", kind: "boolean", isCommandLineOnly: true },
  {
    name: "target",
    kind: "enum",
    affectsBuildInfo: true,
    affectsSourceFile: true,
    affectsModuleResolution: true,
    affectsEmit: true,
  },
  { name: "module", kind: "enum", affectsBuildInfo: true, affectsModuleResolution: true, affectsEmit: true },
  { name: "lib", kind: "list", affectsProgramStructure: true },
  { name: "allowJs", kind: "boolean", affectsBuildInfo: true },
  {
    name: "checkJs",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsModuleResolution: true,
  },
  {
    name: "jsx",
    kind: "enum",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsSourceFile: true,
    affectsModuleResolution: true,
    affectsEmit: true,
  },
  {
    name: "outFile",
    kind: "string",
    isFilePath: true,
    affectsDeclarationPath: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  {
    name: "outDir",
    kind: "string",
    isFilePath: true,
    affectsDeclarationPath: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  {
    name: "rootDir",
    kind: "string",
    isFilePath: true,
    affectsDeclarationPath: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  { name: "composite", kind: "boolean", affectsBuildInfo: true },
  { name: "tsBuildInfoFile", kind: "string", isFilePath: true, affectsBuildInfo: true, affectsEmit: true },
  { name: "removeComments", kind: "boolean", affectsBuildInfo: true, affectsEmit: true },
  { name: "importHelpers", kind: "boolean", affectsBuildInfo: true, affectsSourceFile: true, affectsEmit: true },
  { name: "downlevelIteration", kind: "boolean", affectsBuildInfo: true, affectsEmit: true },
  { name: "isolatedModules", kind: "boolean" },
  {
    name: "verbatimModuleSyntax",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  { name: "isolatedDeclarations", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "erasableSyntaxOnly", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "libReplacement", kind: "boolean", affectsProgramStructure: true },
  { name: "strict", kind: "boolean", affectsBuildInfo: true },
  { name: "noImplicitAny", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "strictNullChecks", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "strictFunctionTypes", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "strictBindCallApply", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "strictPropertyInitialization", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "strictBuiltinIteratorReturn", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "noImplicitThis", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "useUnknownInCatchVariables", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "alwaysStrict", kind: "boolean", affectsBuildInfo: true, affectsSourceFile: true, affectsEmit: true },
  { name: "stableTypeOrdering", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "noUnusedLocals", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "noUnusedParameters", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "exactOptionalPropertyTypes", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "noImplicitReturns", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  {
    name: "noFallthroughCasesInSwitch",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsBindDiagnostics: true,
  },
  { name: "noUncheckedIndexedAccess", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "noImplicitOverride", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  {
    name: "noPropertyAccessFromIndexSignature",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
  },
  { name: "moduleResolution", kind: "enum", affectsModuleResolution: true },
  { name: "baseUrl", kind: "string", isFilePath: true, affectsModuleResolution: true },
  { name: "paths", kind: "object", affectsModuleResolution: true },
  { name: "rootDirs", kind: "list", affectsModuleResolution: true },
  { name: "typeRoots", kind: "list", affectsModuleResolution: true },
  { name: "types", kind: "list", affectsProgramStructure: true },
  { name: "allowSyntheticDefaultImports", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  {
    name: "esModuleInterop",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  { name: "preserveSymlinks", kind: "boolean" },
  { name: "allowUmdGlobalAccess", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "moduleSuffixes", kind: "list", affectsModuleResolution: true, listPreserveFalsyValues: true },
  { name: "allowImportingTsExtensions", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  {
    name: "rewriteRelativeImportExtensions",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
  },
  { name: "resolvePackageJsonExports", kind: "boolean", affectsModuleResolution: true },
  { name: "resolvePackageJsonImports", kind: "boolean", affectsModuleResolution: true },
  { name: "customConditions", kind: "list", affectsModuleResolution: true },
  { name: "noUncheckedSideEffectImports", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "sourceRoot", kind: "string", affectsBuildInfo: true, affectsEmit: true },
  { name: "mapRoot", kind: "string", affectsBuildInfo: true, affectsEmit: true },
  { name: "inlineSources", kind: "boolean", affectsBuildInfo: true, affectsEmit: true },
  {
    name: "experimentalDecorators",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  {
    name: "emitDecoratorMetadata",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  { name: "jsxFactory", kind: "string" },
  { name: "jsxFragmentFactory", kind: "string" },
  {
    name: "jsxImportSource",
    kind: "string",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsSourceFile: true,
    affectsModuleResolution: true,
    affectsEmit: true,
  },
  { name: "resolveJsonModule", kind: "boolean", affectsModuleResolution: true },
  { name: "allowArbitraryExtensions", kind: "boolean", affectsProgramStructure: true },
  { name: "reactNamespace", kind: "string", affectsBuildInfo: true, affectsEmit: true },
  { name: "skipDefaultLibCheck", kind: "boolean", affectsBuildInfo: true },
  { name: "emitBOM", kind: "boolean", affectsBuildInfo: true, affectsEmit: true },
  { name: "newLine", kind: "enum", affectsBuildInfo: true, affectsEmit: true },
  { name: "noErrorTruncation", kind: "boolean", affectsSemanticDiagnostics: true, affectsBuildInfo: true },
  { name: "noLib", kind: "boolean", affectsProgramStructure: true },
  { name: "noResolve", kind: "boolean", affectsModuleResolution: true },
  { name: "stripInternal", kind: "boolean", affectsBuildInfo: true, affectsEmit: true },
  { name: "disableSizeLimit", kind: "boolean", affectsProgramStructure: true },
  { name: "disableSourceOfProjectReferenceRedirect", kind: "boolean" },
  { name: "disableSolutionSearching", kind: "boolean" },
  { name: "disableReferencedProjectLoad", kind: "boolean" },
  { name: "noEmitHelpers", kind: "boolean", affectsBuildInfo: true, affectsEmit: true },
  { name: "noEmitOnError", kind: "boolean", affectsBuildInfo: true, affectsEmit: true },
  { name: "preserveConstEnums", kind: "boolean", affectsBuildInfo: true, affectsEmit: true },
  {
    name: "declarationDir",
    kind: "string",
    isFilePath: true,
    affectsDeclarationPath: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  { name: "skipLibCheck", kind: "boolean", affectsBuildInfo: true },
  {
    name: "allowUnusedLabels",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsBindDiagnostics: true,
  },
  {
    name: "allowUnreachableCode",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsBindDiagnostics: true,
  },
  { name: "forceConsistentCasingInFileNames", kind: "boolean", affectsModuleResolution: true },
  { name: "maxNodeModuleJsDepth", kind: "number", affectsModuleResolution: true },
  {
    name: "useDefineForClassFields",
    kind: "boolean",
    affectsSemanticDiagnostics: true,
    affectsBuildInfo: true,
    affectsEmit: true,
  },
  { name: "plugins", kind: "list" },
  { name: "moduleDetection", kind: "enum", affectsSourceFile: true, affectsModuleResolution: true },
  { name: "ignoreDeprecations", kind: "string" },
];

// harnessutil.go:319: the declarations, then the four options of the harness; noErrorTruncation and noCheck are declarations too, and a search by name finds those first.
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

// enummaps.go:11; a value is the name of a lib file.
export const libMap: ReadonlyMap<string, string> = new Map([
  ["es5", "lib.es5.d.ts"],
  ["es6", "lib.es2015.d.ts"],
  ["es2015", "lib.es2015.d.ts"],
  ["es7", "lib.es2016.d.ts"],
  ["es2016", "lib.es2016.d.ts"],
  ["es2017", "lib.es2017.d.ts"],
  ["es2018", "lib.es2018.d.ts"],
  ["es2019", "lib.es2019.d.ts"],
  ["es2020", "lib.es2020.d.ts"],
  ["es2021", "lib.es2021.d.ts"],
  ["es2022", "lib.es2022.d.ts"],
  ["es2023", "lib.es2023.d.ts"],
  ["es2024", "lib.es2024.d.ts"],
  ["es2025", "lib.es2025.d.ts"],
  ["esnext", "lib.esnext.d.ts"],
  ["dom", "lib.dom.d.ts"],
  ["dom.iterable", "lib.dom.iterable.d.ts"],
  ["dom.asynciterable", "lib.dom.asynciterable.d.ts"],
  ["webworker", "lib.webworker.d.ts"],
  ["webworker.importscripts", "lib.webworker.importscripts.d.ts"],
  ["webworker.iterable", "lib.webworker.iterable.d.ts"],
  ["webworker.asynciterable", "lib.webworker.asynciterable.d.ts"],
  ["scripthost", "lib.scripthost.d.ts"],
  ["es2015.core", "lib.es2015.core.d.ts"],
  ["es2015.collection", "lib.es2015.collection.d.ts"],
  ["es2015.generator", "lib.es2015.generator.d.ts"],
  ["es2015.iterable", "lib.es2015.iterable.d.ts"],
  ["es2015.promise", "lib.es2015.promise.d.ts"],
  ["es2015.proxy", "lib.es2015.proxy.d.ts"],
  ["es2015.reflect", "lib.es2015.reflect.d.ts"],
  ["es2015.symbol", "lib.es2015.symbol.d.ts"],
  ["es2015.symbol.wellknown", "lib.es2015.symbol.wellknown.d.ts"],
  ["es2016.array.include", "lib.es2016.array.include.d.ts"],
  ["es2016.intl", "lib.es2016.intl.d.ts"],
  ["es2017.arraybuffer", "lib.es2017.arraybuffer.d.ts"],
  ["es2017.date", "lib.es2017.date.d.ts"],
  ["es2017.object", "lib.es2017.object.d.ts"],
  ["es2017.sharedmemory", "lib.es2017.sharedmemory.d.ts"],
  ["es2017.string", "lib.es2017.string.d.ts"],
  ["es2017.intl", "lib.es2017.intl.d.ts"],
  ["es2017.typedarrays", "lib.es2017.typedarrays.d.ts"],
  ["es2018.asyncgenerator", "lib.es2018.asyncgenerator.d.ts"],
  ["es2018.asynciterable", "lib.es2018.asynciterable.d.ts"],
  ["es2018.intl", "lib.es2018.intl.d.ts"],
  ["es2018.promise", "lib.es2018.promise.d.ts"],
  ["es2018.regexp", "lib.es2018.regexp.d.ts"],
  ["es2019.array", "lib.es2019.array.d.ts"],
  ["es2019.object", "lib.es2019.object.d.ts"],
  ["es2019.string", "lib.es2019.string.d.ts"],
  ["es2019.symbol", "lib.es2019.symbol.d.ts"],
  ["es2019.intl", "lib.es2019.intl.d.ts"],
  ["es2020.bigint", "lib.es2020.bigint.d.ts"],
  ["es2020.date", "lib.es2020.date.d.ts"],
  ["es2020.promise", "lib.es2020.promise.d.ts"],
  ["es2020.sharedmemory", "lib.es2020.sharedmemory.d.ts"],
  ["es2020.string", "lib.es2020.string.d.ts"],
  ["es2020.symbol.wellknown", "lib.es2020.symbol.wellknown.d.ts"],
  ["es2020.intl", "lib.es2020.intl.d.ts"],
  ["es2020.number", "lib.es2020.number.d.ts"],
  ["es2021.promise", "lib.es2021.promise.d.ts"],
  ["es2021.string", "lib.es2021.string.d.ts"],
  ["es2021.weakref", "lib.es2021.weakref.d.ts"],
  ["es2021.intl", "lib.es2021.intl.d.ts"],
  ["es2022.array", "lib.es2022.array.d.ts"],
  ["es2022.error", "lib.es2022.error.d.ts"],
  ["es2022.intl", "lib.es2022.intl.d.ts"],
  ["es2022.object", "lib.es2022.object.d.ts"],
  ["es2022.string", "lib.es2022.string.d.ts"],
  ["es2022.regexp", "lib.es2022.regexp.d.ts"],
  ["es2023.array", "lib.es2023.array.d.ts"],
  ["es2023.collection", "lib.es2023.collection.d.ts"],
  ["es2023.intl", "lib.es2023.intl.d.ts"],
  ["es2024.arraybuffer", "lib.es2024.arraybuffer.d.ts"],
  ["es2024.collection", "lib.es2024.collection.d.ts"],
  ["es2024.object", "lib.es2024.object.d.ts"],
  ["es2024.promise", "lib.es2024.promise.d.ts"],
  ["es2024.regexp", "lib.es2024.regexp.d.ts"],
  ["es2024.sharedmemory", "lib.es2024.sharedmemory.d.ts"],
  ["es2024.string", "lib.es2024.string.d.ts"],
  ["es2025.collection", "lib.es2025.collection.d.ts"],
  ["es2025.float16", "lib.es2025.float16.d.ts"],
  ["es2025.intl", "lib.es2025.intl.d.ts"],
  ["es2025.iterator", "lib.es2025.iterator.d.ts"],
  ["es2025.promise", "lib.es2025.promise.d.ts"],
  ["es2025.regexp", "lib.es2025.regexp.d.ts"],
  ["esnext.asynciterable", "lib.es2018.asynciterable.d.ts"],
  ["esnext.symbol", "lib.es2019.symbol.d.ts"],
  ["esnext.bigint", "lib.es2020.bigint.d.ts"],
  ["esnext.weakref", "lib.es2021.weakref.d.ts"],
  ["esnext.object", "lib.es2024.object.d.ts"],
  ["esnext.regexp", "lib.es2024.regexp.d.ts"],
  ["esnext.string", "lib.es2024.string.d.ts"],
  ["esnext.float16", "lib.es2025.float16.d.ts"],
  ["esnext.iterator", "lib.es2025.iterator.d.ts"],
  ["esnext.promise", "lib.es2025.promise.d.ts"],
  ["esnext.array", "lib.esnext.array.d.ts"],
  ["esnext.collection", "lib.esnext.collection.d.ts"],
  ["esnext.date", "lib.esnext.date.d.ts"],
  ["esnext.decorators", "lib.esnext.decorators.d.ts"],
  ["esnext.disposable", "lib.esnext.disposable.d.ts"],
  ["esnext.error", "lib.esnext.error.d.ts"],
  ["esnext.intl", "lib.esnext.intl.d.ts"],
  ["esnext.sharedmemory", "lib.esnext.sharedmemory.d.ts"],
  ["esnext.temporal", "lib.esnext.temporal.d.ts"],
  ["esnext.typedarrays", "lib.esnext.typedarrays.d.ts"],
  ["decorators", "lib.decorators.d.ts"],
  ["decorators.legacy", "lib.decorators.legacy.d.ts"],
]);

// enummaps.go:145; the values of this map and of the five after it are those of core/compileroptions.go.
export const moduleResolutionOptionMap: ReadonlyMap<string, number> = new Map([
  ["node16", 3],
  ["nodenext", 99],
  ["bundler", 100],
  ["classic", 1],
  ["node", 2],
  ["node10", 2],
]);

// enummaps.go:154
export const targetOptionMap: ReadonlyMap<string, number> = new Map([
  ["es5", 1],
  ["es6", 2],
  ["es2015", 2],
  ["es2016", 3],
  ["es2017", 4],
  ["es2018", 5],
  ["es2019", 6],
  ["es2020", 7],
  ["es2021", 8],
  ["es2022", 9],
  ["es2023", 10],
  ["es2024", 11],
  ["es2025", 12],
  ["esnext", 99],
]);

// enummaps.go:171
export const moduleOptionMap: ReadonlyMap<string, number> = new Map([
  ["commonjs", 1],
  ["amd", 2],
  ["system", 4],
  ["umd", 3],
  ["es6", 5],
  ["es2015", 5],
  ["es2020", 6],
  ["es2022", 7],
  ["esnext", 99],
  ["node16", 100],
  ["node18", 101],
  ["node20", 102],
  ["nodenext", 199],
  ["preserve", 200],
]);

// enummaps.go:188
export const moduleDetectionOptionMap: ReadonlyMap<string, number> = new Map([
  ["auto", 1],
  ["legacy", 2],
  ["force", 3],
]);

// enummaps.go:194
export const jsxOptionMap: ReadonlyMap<string, number> = new Map([
  ["preserve", 1],
  ["react-native", 2],
  ["react-jsx", 4],
  ["react-jsxdev", 5],
  ["react", 3],
]);

// enummaps.go:202
export const newLineOptionMap: ReadonlyMap<string, number> = new Map([
  ["crlf", 1],
  ["lf", 2],
]);

// enummaps.go:234; the values of this map and of the two after it are those of core/watchoptions.go.
export const watchFileEnumMap: ReadonlyMap<string, number> = new Map([
  ["fixedpollinginterval", 1],
  ["prioritypollinginterval", 2],
  ["dynamicprioritypolling", 3],
  ["fixedchunksizepolling", 4],
  ["usefsevents", 5],
  ["usefseventsonparentdirectory", 6],
]);

// enummaps.go:243
export const watchDirectoryEnumMap: ReadonlyMap<string, number> = new Map([
  ["usefsevents", 1],
  ["fixedpollinginterval", 2],
  ["dynamicprioritypolling", 3],
  ["fixedchunksizepolling", 4],
]);

// enummaps.go:250
export const fallbackEnumMap: ReadonlyMap<string, number> = new Map([
  ["fixedinterval", 1],
  ["priorityinterval", 2],
  ["dynamicpriority", 3],
  ["fixedchunksize", 4],
]);

// commandlineoption.go:183; the last three are the maps of the watch options (declswatch.go), which no table of this file declares.
const commandLineOptionEnumMap = new Map<string, ReadonlyMap<string, number | string>>([
  ["lib", libMap],
  ["moduleResolution", moduleResolutionOptionMap],
  ["module", moduleOptionMap],
  ["target", targetOptionMap],
  ["moduleDetection", moduleDetectionOptionMap],
  ["jsx", jsxOptionMap],
  ["newLine", newLineOptionMap],
  ["watchFile", watchFileEnumMap],
  ["watchDirectory", watchDirectoryEnumMap],
  ["fallbackPolling", fallbackEnumMap],
]);

// commandlineoption.go:105: the entries of the list options that a test directive or the compilerOptions of a config names.
const commandLineOptionElements = new Map<string, CommandLineOption>([
  ["lib", { name: "lib", kind: "enum" }],
  ["rootDirs", { name: "rootDirs", kind: "string", isFilePath: true }],
  ["typeRoots", { name: "typeRoots", kind: "string", isFilePath: true }],
  ["types", { name: "types", kind: "string" }],
  ["moduleSuffixes", { name: "moduleSuffixes", kind: "string" }],
  ["customConditions", { name: "condition", kind: "string" }],
  ["plugins", { name: "plugin", kind: "object" }],
  ["libFiles", { name: "libFiles", kind: "string" }],
]);

// commandlineoption.go:86
export function enumMap(o: CommandLineOption): ReadonlyMap<string, number | string> | undefined {
  if (o.kind !== "enum") return undefined;
  return commandLineOptionEnumMap.get(o.name);
}

// commandlineoption.go:93
export function elements(o: CommandLineOption): CommandLineOption | undefined {
  if (o.kind !== "list" && o.kind !== "listOrElement") return undefined;
  return commandLineOptionElements.get(o.name);
}
