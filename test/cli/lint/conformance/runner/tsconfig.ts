// The smallest config reader that the skip rule needs, after internal/tsoptions and internal/core of typescript-go 89d5d5b: compiler options, JSON with comments, the extends chain.
import { toLower, trimFunc, trimSpace } from "./gostrings";
import { isLineBreak, isWhiteSpaceLike } from "./stringutil";
import { type CommandLineOption, elements, enumMap, optionsDeclarations } from "./tsoptions";
import {
  combinePaths,
  getBaseFileName,
  getDirectoryPath,
  getNormalizedAbsolutePath,
  isRootedDiskPath,
  normalizePath,
  normalizeSlashes,
  toPath,
} from "./tspath";

// core/tristate.go
export type Tristate = 0 | 1 | 2;
export const TSUnknown = 0;
export const TSFalse = 1;
export const TSTrue = 2;

// parsinghelpers.go:279: the keys of the switch in its order, by what fills them: ParseTristate, ParseString, ParseStringArray, floatOrInt32ToFlag, parseNumber.
const tristateOptions = [
  "allowJs",
  "allowImportingTsExtensions",
  "allowSyntheticDefaultImports",
  "allowNonTsExtensions",
  "allowUmdGlobalAccess",
  "allowUnreachableCode",
  "allowUnusedLabels",
  "allowArbitraryExtensions",
  "alwaysStrict",
  "assumeChangesOnlyAffectDirectDependencies",
  "build",
  "checkJs",
  "composite",
  "deduplicatePackages",
  "diagnostics",
  "disableSizeLimit",
  "disableSourceOfProjectReferenceRedirect",
  "disableSolutionSearching",
  "disableReferencedProjectLoad",
  "declarationMap",
  "declaration",
  "downlevelIteration",
  "erasableSyntaxOnly",
  "emitDeclarationOnly",
  "extendedDiagnostics",
  "emitDecoratorMetadata",
  "emitBOM",
  "esModuleInterop",
  "exactOptionalPropertyTypes",
  "explainFiles",
  "experimentalDecorators",
  "forceConsistentCasingInFileNames",
  "isolatedModules",
  "ignoreConfig",
  "importHelpers",
  "incremental",
  "init",
  "inlineSourceMap",
  "inlineSources",
  "isolatedDeclarations",
  "libReplacement",
  "listEmittedFiles",
  "listFiles",
  "listFilesOnly",
  "noCheck",
  "noFallthroughCasesInSwitch",
  "noEmitForJsFiles",
  "noErrorTruncation",
  "noImplicitAny",
  "noImplicitThis",
  "noLib",
  "noPropertyAccessFromIndexSignature",
  "noUncheckedIndexedAccess",
  "noEmitHelpers",
  "noEmitOnError",
  "noImplicitReturns",
  "noUnusedLocals",
  "noUnusedParameters",
  "noImplicitOverride",
  "noUncheckedSideEffectImports",
  "noResolve",
  "preserveWatchOutput",
  "preserveConstEnums",
  "preserveSymlinks",
  "pretty",
  "resolveJsonModule",
  "resolvePackageJsonExports",
  "resolvePackageJsonImports",
  "rewriteRelativeImportExtensions",
  "removeComments",
  "stableTypeOrdering",
  "strict",
  "strictBindCallApply",
  "strictBuiltinIteratorReturn",
  "strictFunctionTypes",
  "strictNullChecks",
  "strictPropertyInitialization",
  "skipDefaultLibCheck",
  "sourceMap",
  "stripInternal",
  "suppressOutputPathCheck",
  "traceResolution",
  "useDefineForClassFields",
  "useUnknownInCatchVariables",
  "verbatimModuleSyntax",
  "version",
  "help",
  "all",
  "skipLibCheck",
  "noEmit",
  "showConfig",
  "noDtsResolution",
  "watch",
  "singleThreaded",
  "quiet",
  "runExternalCode",
] as const;

const stringOptions = [
  "baseUrl",
  "declarationDir",
  "generateCpuProfile",
  "generateTrace",
  "ignoreDeprecations",
  "jsxFactory",
  "jsxFragmentFactory",
  "jsxImportSource",
  "locale",
  "mapRoot",
  "outFile",
  "project",
  "reactNamespace",
  "rootDir",
  "sourceRoot",
  "tsBuildInfoFile",
  "configFilePath",
  "pathsBasePath",
  "outDir",
  "pprofDir",
] as const;

const stringArrayOptions = ["customConditions", "lib", "moduleSuffixes", "rootDirs", "typeRoots", "types"] as const;

const enumOptions = ["jsx", "module", "moduleResolution", "moduleDetection", "target", "newLine"] as const;

const numberOptions = ["maxNodeModuleJsDepth", "checkers"] as const;

// core/compileroptions.go:17 under its JSON names; paths is the one field of parseStringMap; undefined stands for a nil slice, map or pointer.
export type CompilerOptions = { [K in (typeof tristateOptions)[number]]: Tristate } & {
  [K in (typeof stringOptions)[number]]: string;
} & { [K in (typeof stringArrayOptions)[number]]: string[] | undefined } & {
  [K in (typeof enumOptions)[number]]: number;
} & { [K in (typeof numberOptions)[number]]: number | undefined } & {
  paths: Map<string, string[] | undefined> | undefined;
};

type FieldKind = "tristate" | "string" | "stringArray" | "enum" | "number" | "stringMap";

const fieldKinds = new Map<string, FieldKind>();
for (const name of tristateOptions) fieldKinds.set(name, "tristate");
for (const name of stringOptions) fieldKinds.set(name, "string");
for (const name of stringArrayOptions) fieldKinds.set(name, "stringArray");
for (const name of enumOptions) fieldKinds.set(name, "enum");
for (const name of numberOptions) fieldKinds.set(name, "number");
fieldKinds.set("paths", "stringMap");

function zeroValue(kind: FieldKind): unknown {
  return kind === "tristate" || kind === "enum" ? 0 : kind === "string" ? "" : undefined;
}

const zeroCompilerOptions: Record<string, unknown> = {};
for (const [name, kind] of fieldKinds) zeroCompilerOptions[name] = zeroValue(kind);

// The zero value of core.CompilerOptions.
export function newCompilerOptions(): CompilerOptions {
  return { ...zeroCompilerOptions } as CompilerOptions;
}

// core/compileroptions.go:176, a shallow copy.
export function cloneCompilerOptions(options: CompilerOptions): CompilerOptions {
  return { ...options };
}

// A JSON value of a config; null stands for the nil interface of upstream.
export type JsonValue = null | boolean | number | string | JsonValue[] | Map<string, JsonValue>;

// A nil slice inside an interface: ParseCompilerOptions takes it for a value and sets the field to nil.
export const nilSlice: JsonValue[] = [];
Object.freeze(nilSlice);

interface ConfigOption extends CommandLineOption {
  readonly elementOptions?: ReadonlyMap<string, CommandLineOption>;
}

// tsconfigparsing.go:615
function commandLineOptionsToMap(options: readonly CommandLineOption[]): Map<string, CommandLineOption> {
  const result = new Map<string, CommandLineOption>();
  for (const option of options) {
    result.set(option.name, option);
    result.set(toLower(option.name), option);
  }
  return result;
}

// tsconfigparsing.go:598
function getOption(m: ReadonlyMap<string, CommandLineOption>, name: string): CommandLineOption | undefined {
  return m.get(name) ?? m.get(toLower(name));
}

// tsconfigparsing.go:624
const commandLineCompilerOptionsMap = commandLineOptionsToMap(optionsDeclarations);

// parsinghelpers.go:30
function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value === nilSlice) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

// parsinghelpers.go:46
function parseStringMap(value: unknown): Map<string, string[] | undefined> | undefined {
  if (!(value instanceof Map)) return undefined;
  const result = new Map<string, string[] | undefined>();
  for (const [k, v] of value) result.set(k, parseStringArray(v));
  return result;
}

// parsinghelpers.go:268 and :279; upstream returns an error list that is always empty.
export function parseCompilerOptions(key: string, value: unknown, allOptions: CompilerOptions | undefined): void {
  if (value === null || value === undefined || allOptions === undefined) return;
  const option = getOption(commandLineCompilerOptionsMap, key);
  if (option !== undefined) key = option.name;
  if (key === "moduleDetectionKind") key = "moduleDetection";
  const fields = allOptions as Record<string, unknown>;
  switch (fieldKinds.get(key)) {
    case "tristate":
      fields[key] = value === true ? TSTrue : TSFalse;
      break;
    case "string":
      fields[key] = typeof value === "string" ? value : "";
      break;
    case "stringArray":
      fields[key] = parseStringArray(value);
      break;
    case "enum":
      if (typeof value === "number") fields[key] = Math.trunc(value);
      break;
    case "number":
      fields[key] = typeof value === "number" ? Math.trunc(value) : undefined;
      break;
    case "stringMap":
      fields[key] = parseStringMap(value);
      break;
  }
}

function isZero(kind: FieldKind, value: unknown): boolean {
  return kind === "tristate" || kind === "enum" ? value === 0 : kind === "string" ? value === "" : value === undefined;
}

// parsinghelpers.go:648
function mergeCompilerOptions(
  targetOptions: CompilerOptions,
  sourceOptions: CompilerOptions | undefined,
  rawSource: JsonValue | undefined,
): CompilerOptions {
  if (sourceOptions === undefined) return targetOptions;
  const explicitNullFields = new Set<string>();
  if (rawSource instanceof Map) {
    const compilerOptionsRaw = rawSource.get("compilerOptions");
    if (compilerOptionsRaw instanceof Map) {
      for (const [key, value] of compilerOptionsRaw) if (value === null) explicitNullFields.add(key);
    }
  }
  const target = targetOptions as Record<string, unknown>;
  const source = sourceOptions as Record<string, unknown>;
  for (const [field, kind] of fieldKinds) {
    if (explicitNullFields.has(field)) {
      target[field] = zeroValue(kind);
      continue;
    }
    if (!isZero(kind, source[field])) target[field] = source[field];
  }
  return targetOptions;
}

// commandlineparser.go:392; error is set where upstream returns a diagnostic.
function convertJsonOptionOfEnumType(opt: CommandLineOption, value: string): { value: JsonValue; error: boolean } {
  if (value === "") return { value: null, error: false };
  const typeMap = enumMap(opt);
  if (typeMap === undefined) return { value: null, error: false };
  const val = typeMap.get(toLower(value));
  if (val !== undefined) return { value: val, error: false };
  return { value: null, error: true };
}

export type ListTypeOption = { values: JsonValue[]; errors: number; panic?: undefined } | { panic: string };

// commandlineparser.go:347; errors counts the diagnostics, panic is the text of a panic; no list option that reaches it has extra validation.
export function parseListTypeOption(opt: CommandLineOption, value: string): ListTypeOption {
  value = trimSpace(value);
  if (value.startsWith("-")) return { values: [], errors: 0 };
  if (opt.kind === "listOrElement" && !value.includes(",")) return { values: [value], errors: 0 };
  if (value === "") return { values: [], errors: 0 };
  const values = value.split(",");
  const element = elements(opt);
  if (element === undefined) return { panic: "runtime error: invalid memory address or nil pointer dereference" };
  switch (element.kind) {
    case "string": {
      const result = values.filter(v => v !== "");
      return { values: result.length === 0 ? nilSlice : result, errors: 0 };
    }
    case "boolean":
    case "object":
    case "number":
      return { panic: "List of " + element.kind + " is not yet supported." };
    default: {
      const result: JsonValue[] = [];
      let errors = 0;
      for (const v of values) {
        const converted = convertJsonOptionOfEnumType(element, trimFunc(v, isWhiteSpaceLike));
        if (typeof converted.value === "string" && !converted.error && converted.value !== "") {
          result.push(converted.value);
        } else if (converted.error) {
          errors++;
        }
      }
      return { values: result.length === 0 ? nilSlice : result, errors };
    }
  }
}

export type JsonNode =
  | { kind: "object"; properties: { key: string; value: JsonNode }[] }
  | { kind: "array"; elements: JsonNode[] }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "null" };

const maxJsonDepth = 200;
const jsonNumber = /(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const jsonEscapes = new Map([
  ['"', '"'],
  ["\\", "\\"],
  ["/", "/"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
]);

// The end of the white space and comments that start at i; -1 for a block comment that does not end.
function skipJsonTrivia(text: string, i: number): number {
  for (;;) {
    while (i < text.length && isWhiteSpaceLike(text.charCodeAt(i))) i++;
    if (text[i] !== "/") return i;
    if (text[i + 1] === "/") {
      while (i < text.length && !isLineBreak(text.charCodeAt(i))) i++;
    } else if (text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return -1;
      i = end + 2;
    } else {
      return i;
    }
  }
}

// True when the text holds only white space and comments: the reference parses it to a file without a value.
export function isBlankJsonc(text: string): boolean {
  return skipJsonTrivia(text, 0) === text.length;
}

// JSON with comments and trailing commas, where the reference's parser reports nothing; undefined for any other text.
export function parseJsonc(text: string): JsonNode | undefined {
  let i = 0;
  let depth = 0;

  function skip(): boolean {
    i = skipJsonTrivia(text, i);
    return i >= 0;
  }

  function endsToken(): boolean {
    if (i >= text.length) return true;
    const ch = text.charCodeAt(i);
    return ch === 0x2c || ch === 0x7d || ch === 0x5d || ch === 0x2f || isWhiteSpaceLike(ch);
  }

  function string(): string | undefined {
    let out = "";
    for (i++; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\n" || c === "\r") return undefined;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = text[++i];
      if (e === "u") {
        const hex = text.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return undefined;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        continue;
      }
      const escaped = e === undefined ? undefined : jsonEscapes.get(e);
      if (escaped === undefined) return undefined;
      out += escaped;
    }
    return undefined;
  }

  function number(negative: boolean): JsonNode | undefined {
    jsonNumber.lastIndex = i;
    const m = jsonNumber.exec(text);
    if (m === null) return undefined;
    i += m[0].length;
    if (!endsToken()) return undefined;
    return { kind: "number", value: negative ? -Number(m[0]) : Number(m[0]) };
  }

  function value(): JsonNode | undefined {
    if (!skip() || i >= text.length || depth >= maxJsonDepth) return undefined;
    const c = text[i];
    if (c === "{") {
      const properties: { key: string; value: JsonNode }[] = [];
      i++;
      depth++;
      for (;;) {
        if (!skip()) return undefined;
        if (text[i] === "}") break;
        if (text[i] !== '"') return undefined;
        const key = string();
        if (key === undefined || !skip() || text[i] !== ":") return undefined;
        i++;
        const v = value();
        if (v === undefined || !skip()) return undefined;
        properties.push({ key, value: v });
        if (text[i] === ",") i++;
        else if (text[i] !== "}") return undefined;
      }
      i++;
      depth--;
      return { kind: "object", properties };
    }
    if (c === "[") {
      const elements: JsonNode[] = [];
      i++;
      depth++;
      for (;;) {
        if (!skip()) return undefined;
        if (text[i] === "]") break;
        const v = value();
        if (v === undefined || !skip()) return undefined;
        elements.push(v);
        if (text[i] === ",") i++;
        else if (text[i] !== "]") return undefined;
      }
      i++;
      depth--;
      return { kind: "array", elements };
    }
    if (c === '"') {
      const s = string();
      return s === undefined ? undefined : { kind: "string", value: s };
    }
    if (c === "-") {
      i++;
      return skip() ? number(true) : undefined;
    }
    if (c >= "0" && c <= "9") return number(false);
    for (const keyword of ["true", "false", "null"] as const) {
      if (text.startsWith(keyword, i)) {
        i += keyword.length;
        return endsToken() ? { kind: keyword } : undefined;
      }
    }
    return undefined;
  }

  const root = value();
  if (root === undefined || !skip() || i < text.length) return undefined;
  return root;
}

type PropertySetNotifier = (
  keyText: string,
  value: JsonValue,
  parentOption: ConfigOption | undefined,
  option: CommandLineOption | undefined,
) => void;

// tsconfigparsing.go:36
const compilerOptionsDeclaration: ConfigOption = {
  name: "compilerOptions",
  kind: "object",
  elementOptions: commandLineCompilerOptionsMap,
};

// tsconfigparsing.go:48
const extendsCommandLineOption: ConfigOption = { name: "extends", kind: "listOrElement" };

// tsconfigparsing.go:57, with the two root options that reach the compiler options.
const tsconfigRootOptionsMap: ConfigOption = {
  name: "undefined",
  kind: "object",
  elementOptions: commandLineOptionsToMap([compilerOptionsDeclaration, extendsCommandLineOption]),
};

// tsconfigparsing.go:742
function convertObjectLiteralExpressionToJson(
  node: { properties: { key: string; value: JsonNode }[] },
  objectOption: ConfigOption | undefined,
  notifier: PropertySetNotifier | undefined,
): Map<string, JsonValue> {
  const result = new Map<string, JsonValue>();
  for (const { key: keyText, value: initializer } of node.properties) {
    let option: CommandLineOption | undefined;
    if (keyText !== "" && objectOption?.elementOptions !== undefined) {
      option = getOption(objectOption.elementOptions, keyText);
      if (option !== undefined && option.name !== keyText) option = undefined;
    }
    const value = convertPropertyValueToJson(initializer, option, notifier);
    if (keyText !== "") {
      result.set(keyText, value);
      notifier?.(keyText, value, objectOption, option);
    }
  }
  return result;
}

// tsconfigparsing.go:664
function convertArrayLiteralExpressionToJson(
  elements: JsonNode[],
  elementOption: ConfigOption | undefined,
): JsonValue[] {
  if (elements.length === 0) return [];
  const value: JsonValue[] = [];
  for (const element of elements) {
    const convertedValue = convertPropertyValueToJson(element, elementOption, undefined);
    if (convertedValue !== null) value.push(convertedValue);
  }
  return value.length === 0 ? nilSlice : value;
}

// tsconfigparsing.go:818
function convertPropertyValueToJson(
  valueExpression: JsonNode,
  option: ConfigOption | undefined,
  notifier: PropertySetNotifier | undefined,
): JsonValue {
  switch (valueExpression.kind) {
    case "true":
      return true;
    case "false":
      return false;
    case "null":
      return null;
    case "string":
    case "number":
      return valueExpression.value;
    case "object":
      return convertObjectLiteralExpressionToJson(valueExpression, option, notifier);
    case "array":
      return convertArrayLiteralExpressionToJson(valueExpression.elements, option);
  }
}

// tsconfigparsing.go:311; undefined stands for the value of a file without a root expression, which is no map.
function convertConfigFileToObject(root: JsonNode | undefined, notifier: PropertySetNotifier): JsonValue | undefined {
  if (root === undefined) return undefined;
  if (root.kind !== "object") {
    const firstObject = root.kind === "array" ? root.elements.find(e => e.kind === "object") : undefined;
    if (firstObject === undefined) return new Map();
    return convertPropertyValueToJson(firstObject, tsconfigRootOptionsMap, notifier);
  }
  return convertPropertyValueToJson(root, tsconfigRootOptionsMap, notifier);
}

// tsconfigparsing.go:341
function isCompilerOptionsValue(option: CommandLineOption | undefined, value: JsonValue): boolean {
  if (option === undefined) return false;
  if (value === null) return option.name !== "extends";
  switch (option.kind) {
    case "list":
      return Array.isArray(value);
    case "listOrElement":
      return Array.isArray(value) || isCompilerOptionsValue(elements(option), value);
    case "string":
    case "enum":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "object":
      return value instanceof Map;
  }
  return false;
}

// tsconfigparsing.go:404
function convertJsonOptionOfListType(option: CommandLineOption, values: JsonValue, basePath: string): JsonValue[] {
  if (!Array.isArray(values) || values === nilSlice) return nilSlice;
  const element = elements(option);
  const mappedValues = values.map(v => (element === undefined ? null : convertJsonOption(element, v, basePath)));
  if (option.listPreserveFalsyValues) return mappedValues;
  return mappedValues.filter(v => v !== null && v !== false && v !== "");
}

const configDirTemplate = "${configDir}";

// tsconfigparsing.go:436
function startsWithConfigDirTemplate(value: unknown): boolean {
  return typeof value === "string" && toLower(value).startsWith(toLower(configDirTemplate));
}

// tsconfigparsing.go:444
function normalizeNonListOptionValue(option: CommandLineOption, basePath: string, value: JsonValue): JsonValue {
  if (option.isFilePath && typeof value === "string") {
    value = normalizeSlashes(value);
    if (!startsWithConfigDirTemplate(value)) value = getNormalizedAbsolutePath(value, basePath);
    if (value === "") value = ".";
  }
  return value;
}

// tsconfigparsing.go:457; null stands for nil, with or without a diagnostic.
function convertJsonOption(opt: CommandLineOption, value: JsonValue, basePath: string): JsonValue {
  if (opt.isCommandLineOnly) return null;
  if (!isCompilerOptionsValue(opt, value)) return null;
  switch (opt.kind) {
    case "list":
      return convertJsonOptionOfListType(opt, value, basePath);
    case "listOrElement": {
      if (Array.isArray(value)) return convertJsonOptionOfListType(opt, value, basePath);
      const element = elements(opt);
      return element === undefined ? null : convertJsonOption(element, value, basePath);
    }
    case "enum":
      return typeof value === "string" ? convertJsonOptionOfEnumType(opt, value).value : null;
  }
  return value === null ? null : normalizeNonListOptionValue(opt, basePath, value);
}

// The file system that tsoptions.ParseConfigHost gives to the extends chain; readFile is undefined for what is no file.
export interface ParseConfigHost {
  fileExists(path: string): boolean;
  readFile(path: string): string | undefined;
  readonly useCaseSensitiveFileNames: boolean;
  // module.ResolveConfig: the file that a name resolves to, "" for none; absent or undefined where the resolver is not known.
  resolveConfig?(moduleName: string, containingFile: string): string | undefined;
}

// tsconfigparsing.go:694
function directoryOfCombinedPath(fileName: string, basePath: string): string {
  return getDirectoryPath(getNormalizedAbsolutePath(fileName, basePath));
}

// tsconfigparsing.go:553; a name that upstream resolves like a module goes to the resolver of the host, and without one it is noted and gives no path.
function getExtendsConfigPath(
  extendedConfig: string,
  host: ParseConfigHost,
  basePath: string,
  notes: string[],
): string {
  extendedConfig = normalizeSlashes(extendedConfig);
  if (isRootedDiskPath(extendedConfig) || extendedConfig.startsWith("./") || extendedConfig.startsWith("../")) {
    let extendedConfigPath = getNormalizedAbsolutePath(extendedConfig, basePath);
    if (!host.fileExists(extendedConfigPath) && !extendedConfigPath.endsWith(".json")) {
      extendedConfigPath += ".json";
      if (!host.fileExists(extendedConfigPath)) return "";
    }
    return extendedConfigPath;
  }
  const resolved = host.resolveConfig?.(extendedConfig, combinePaths(basePath, "tsconfig.json"));
  if (resolved !== undefined) return resolved;
  notes.push(
    `extends ${JSON.stringify(extendedConfig)} from ${basePath} resolves like a module in the reference: not read`,
  );
  return "";
}

// tsconfigparsing.go:504
function getExtendsConfigPathOrArray(
  value: JsonValue,
  host: ParseConfigHost,
  basePath: string,
  configFileName: string,
  notes: string[],
): string[] {
  const extendedConfigPathArray: string[] = [];
  const newBase = configFileName !== "" ? directoryOfCombinedPath(configFileName, basePath) : basePath;
  for (const fileName of typeof value === "string" ? [value] : Array.isArray(value) ? value : []) {
    if (typeof fileName !== "string") continue;
    const val = getExtendsConfigPath(fileName, host, newBase, notes);
    if (val !== "") extendedConfigPathArray.push(val);
  }
  return extendedConfigPathArray;
}

// tsconfigparsing.go:927
function getDefaultCompilerOptions(configFileName: string): CompilerOptions {
  const options = newCompilerOptions();
  if (configFileName !== "" && getBaseFileName(configFileName) === "jsconfig.json") {
    options.allowJs = TSTrue;
    options.maxNodeModuleJsDepth = 2;
    options.skipLibCheck = TSTrue;
    options.noEmit = TSTrue;
  }
  return options;
}

// tsconfigparsing.go:170; options is undefined for a config that extends itself.
interface ParsedTsconfig {
  raw: JsonValue | undefined;
  options: CompilerOptions | undefined;
  extendedConfigPath: string[] | undefined;
}

// tsconfigparsing.go:178
function parseOwnConfigOfJsonSourceFile(
  root: JsonNode | undefined,
  host: ParseConfigHost,
  basePath: string,
  configFileName: string,
  notes: string[],
): ParsedTsconfig {
  const compilerOptions = getDefaultCompilerOptions(configFileName);
  let extendedConfigPath: string[] | undefined;
  const onPropertySet: PropertySetNotifier = (keyText, value, parentOption, option) => {
    if (option !== undefined && option !== extendsCommandLineOption) value = convertJsonOption(option, value, basePath);
    if (parentOption !== undefined && parentOption.name !== "undefined" && value !== null) {
      if (option !== undefined && parentOption.name === "compilerOptions") {
        parseCompilerOptions(option.name, value, compilerOptions);
      }
    } else if (parentOption === tsconfigRootOptionsMap && option === extendsCommandLineOption) {
      extendedConfigPath = getExtendsConfigPathOrArray(value, host, basePath, configFileName, notes);
    }
  };
  const raw = convertConfigFileToObject(root, onPropertySet);
  return { raw, options: compilerOptions, extendedConfigPath };
}

// The root expression of a config text: undefined for a blank text; modelled is false for a text that this reader does not take.
function parseConfigText(text: string): { root: JsonNode | undefined; modelled: boolean } {
  if (isBlankJsonc(text)) return { root: undefined, modelled: true };
  const root = parseJsonc(text);
  return { root, modelled: root !== undefined };
}

// tsconfigparsing.go:1015 and :1052; undefined where upstream has no extended config.
function getExtendedConfig(
  extendedConfigFileName: string,
  host: ParseConfigHost,
  resolutionStack: readonly string[],
  notes: string[],
): ParsedTsconfig | undefined {
  const text = host.readFile(extendedConfigFileName);
  if (text === undefined) return undefined;
  const source = parseConfigText(text);
  if (!source.modelled) {
    notes.push(`${extendedConfigFileName} is not JSON with comments and trailing commas: not read`);
    return undefined;
  }
  return parseConfig(
    source.root,
    host,
    getDirectoryPath(extendedConfigFileName),
    getBaseFileName(extendedConfigFileName),
    resolutionStack,
    notes,
  );
}

// tsconfigparsing.go:1082, for the compiler options.
function parseConfig(
  root: JsonNode | undefined,
  host: ParseConfigHost,
  basePath: string,
  configFileName: string,
  resolutionStack: readonly string[],
  notes: string[],
): ParsedTsconfig {
  basePath = normalizeSlashes(basePath);
  const resolvedPath = toPath(configFileName, basePath, host.useCaseSensitiveFileNames);
  if (resolutionStack.includes(resolvedPath)) {
    return { raw: undefined, options: undefined, extendedConfigPath: undefined };
  }

  const ownConfig = parseOwnConfigOfJsonSourceFile(root, host, basePath, configFileName, notes);
  if (ownConfig.options?.paths !== undefined) ownConfig.options.pathsBasePath = basePath;

  if (ownConfig.extendedConfigPath !== undefined) {
    const stack = [...resolutionStack, resolvedPath];
    const result = newCompilerOptions();
    for (const extendedConfigPath of ownConfig.extendedConfigPath) {
      const extendedConfig = getExtendedConfig(extendedConfigPath, host, stack, notes);
      if (extendedConfig !== undefined && extendedConfig.options !== undefined) {
        mergeCompilerOptions(result, extendedConfig.options, extendedConfig.raw);
      }
    }
    ownConfig.options = mergeCompilerOptions(result, ownConfig.options, ownConfig.raw);
  }
  return ownConfig;
}

// tsconfigparsing.go:1797
function getSubstitutedPathWithConfigDirTemplate(value: string, basePath: string): string {
  return getNormalizedAbsolutePath(value.replace(configDirTemplate, "./"), basePath);
}

// tsconfigparsing.go:1801
function getSubstitutedStringArrayWithConfigDirTemplate(
  list: string[] | undefined,
  basePath: string,
): string[] | undefined {
  if (list === undefined) return undefined;
  let result: string[] | undefined;
  for (let i = 0; i < list.length; i++) {
    if (startsWithConfigDirTemplate(list[i])) {
      result ??= list.slice();
      result[i] = getSubstitutedPathWithConfigDirTemplate(list[i], basePath);
    }
  }
  return result;
}

const configDirTemplatePathOptions = [
  "generateCpuProfile",
  "generateTrace",
  "outFile",
  "outDir",
  "rootDir",
  "tsBuildInfoFile",
  "baseUrl",
  "declarationDir",
] as const;

// tsconfigparsing.go:1817
function handleOptionConfigDirTemplateSubstitution(compilerOptions: CompilerOptions, basePath: string): void {
  let paths: Map<string, string[] | undefined> | undefined;
  for (const [k, v] of compilerOptions.paths ?? []) {
    const substitution = getSubstitutedStringArrayWithConfigDirTemplate(v, basePath);
    if (substitution !== undefined) {
      if (paths === undefined) {
        paths = new Map(compilerOptions.paths);
        compilerOptions.paths = paths;
      }
      paths.set(k, substitution);
    }
  }
  const rootDirs = getSubstitutedStringArrayWithConfigDirTemplate(compilerOptions.rootDirs, basePath);
  if (rootDirs !== undefined) compilerOptions.rootDirs = rootDirs;
  const typeRoots = getSubstitutedStringArrayWithConfigDirTemplate(compilerOptions.typeRoots, basePath);
  if (typeRoots !== undefined) compilerOptions.typeRoots = typeRoots;
  for (const name of configDirTemplatePathOptions) {
    if (startsWithConfigDirTemplate(compilerOptions[name])) {
      compilerOptions[name] = getSubstitutedPathWithConfigDirTemplate(compilerOptions[name], basePath);
    }
  }
}

// tsconfigparsing.go:1283: upstream reports an empty files list at its node, which is nil when the root of the text is no object.
function reportsEmptyFilesListAtNil(root: JsonNode | undefined, raw: JsonValue | undefined): boolean {
  if (root === undefined || root.kind === "object" || !(raw instanceof Map)) return false;
  const files = raw.get("files");
  const references = raw.get("references");
  const hasZeroOrNoReferences = !Array.isArray(references) || references.length === 0;
  const hasExtends = raw.get("extends") ?? null;
  return (
    Array.isArray(files) && files !== nilSlice && files.length === 0 && hasZeroOrNoReferences && hasExtends === null
  );
}

// The part of tsoptions.ParsedCommandLine that the skip rule needs.
export interface ParsedCommandLine {
  options: CompilerOptions;
  // The config as JSON values; undefined for a text without a value.
  raw: JsonValue | undefined;
  // The text of the panic with which upstream leaves the config; undefined when it returns.
  panic: string | undefined;
  // What this reader does not model of the config; empty when the options are those of the reference.
  notes: string[];
}

// tsconfigparsing.go:726 and :1237 up to the compiler options: no file names, references or content mappers.
export function parseJsonSourceFileConfigFileContent(
  text: string,
  host: ParseConfigHost,
  basePath: string,
  existingOptions: CompilerOptions | undefined,
  configFileName: string,
): ParsedCommandLine {
  const basePathForFileNames = normalizePath(
    configFileName !== "" ? directoryOfCombinedPath(configFileName, basePath) : basePath,
  );
  const notes: string[] = [];
  const source = parseConfigText(text);
  if (!source.modelled) notes.push(`${configFileName} is not JSON with comments and trailing commas: not read`);
  const parsedConfig = parseConfig(source.root, host, basePath, configFileName, [], notes);
  const options = parsedConfig.options ?? newCompilerOptions();
  mergeCompilerOptions(options, existingOptions, undefined);
  handleOptionConfigDirTemplateSubstitution(options, basePathForFileNames);
  if (configFileName !== "") options.configFilePath = normalizeSlashes(configFileName);
  const panic = reportsEmptyFilesListAtNil(source.root, parsedConfig.raw)
    ? "runtime error: invalid memory address or nil pointer dereference"
    : undefined;
  return { options, raw: parsedConfig.raw, panic, notes };
}
