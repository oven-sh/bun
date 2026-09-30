// The input side of newCompilerTest (compiler_runner.go) and CompileFilesEx (harnessutil.go) of typescript-go 89d5d5b, and the writer of an instance to disk.
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { compareStrings, equalFold, toLower, trimSpace } from "./gostrings";
import { isLineBreak, isWhiteSpaceLike } from "./stringutil";
import {
  AllSupportedExtensions,
  AllSupportedExtensionsWithJson,
  type ComparePathsOptions,
  ExtensionDts,
  ExtensionJs,
  ExtensionJson,
  ExtensionJsx,
  ExtensionTs,
  ExtensionTsBuildInfo,
  SupportedTSExtensions,
  SupportedTSExtensionsWithJson,
  changeExtension,
  combinePaths,
  containsPath,
  convertToRelativePath,
  fileExtensionIs,
  fileExtensionIsOneOf,
  getBaseFileName,
  getCanonicalFileName,
  getComparer,
  getDirectoryPath,
  getNormalizedAbsolutePath,
  getNormalizedPathComponents,
  getRootLength,
  hasExtension,
  isRootedDiskPath,
  normalizePath,
  normalizeSlashes,
  removeTrailingDirectorySeparator,
  toPath,
} from "./tspath";
import { MemFs, MemFsPanic, type MemInput, decodeBytes } from "./vfs";

// compiler_runner.go:34
export const srcFolder = "/.src";
// harnessutil.go:41
export const testLibFolder = "/.lib";
// compiler_runner.go:29
const requireStr = "require(";
// compiler_runner.go:30; \s of Go is [\t\n\f\r ]
const referencesRegex = /reference[\t\n\f\r ]path/;

// core/tristate.go
export const TSUnknown = 0;
export const TSFalse = 1;
export const TSTrue = 2;
export type Tristate = typeof TSUnknown | typeof TSFalse | typeof TSTrue;

// core/compileroptions.go:478
export const NewLineKindNone = 0;
export const NewLineKindCRLF = 1;
export const NewLineKindLF = 2;

export type ObstacleReason =
  | "dos-root"
  | "other-root"
  | "windows-name"
  | "null-character"
  | "case-collision"
  | "case-insensitive-requested"
  | "unicode-normalisation"
  | "link-not-permitted"
  | "entry-below-link"
  | "path-too-long"
  | "absolute-path-in-text"
  | "lib-directory-missing"
  | "ancestor-has-project-files"
  | "config-not-json"
  | "config-extends-package"
  | "config-content-mappers"
  | "write-failed";

export interface Obstacle {
  reason: ObstacleReason;
  detail: string;
}

// "invalid": the reference panics or fatals on the instance, with this reason. "unsupported": this port or this disk cannot hold it.
export interface Refusal {
  ok: false;
  status: "invalid" | "unsupported";
  reason: string;
  obstacles: Obstacle[];
}

export type Result<T> = { ok: true; value: T } | Refusal;

// A panic or a t.Fatalf of the reference.
class HarnessStop extends Error {}

// Something the reference decides in code that is not ported here.
class Undecided extends Error {
  constructor(
    readonly obstacle: ObstacleReason,
    detail: string,
  ) {
    super(detail);
  }
}

function refusalOf(error: unknown): Refusal {
  if (error instanceof HarnessStop || error instanceof MemFsPanic) {
    return { ok: false, status: "invalid", reason: error.message, obstacles: [] };
  }
  if (error instanceof Undecided) return unsupported([{ reason: error.obstacle, detail: error.message }]);
  // The port walks directories and JSON by recursion: names that nest deeper than its stack are beyond it.
  if (error instanceof RangeError) return unsupported([{ reason: "path-too-long", detail: error.message }]);
  throw error;
}

function unsupported(obstacles: Obstacle[]): Refusal {
  const reason = obstacles.map(o => (o.detail === "" ? o.reason : `${o.reason}: ${o.detail}`)).join("; ");
  return { ok: false, status: "unsupported", reason, obstacles };
}

// fmt %q for the names of a test case.
function quote(s: string): string {
  return JSON.stringify(s);
}

// internal.go:150: the text of a file of the host of the config parser
function readFileText(fs: MemFs, path: string): string | undefined {
  const bytes = fs.readFile(path);
  return bytes === undefined ? undefined : Buffer.from(decodeBytes(bytes)).toString("utf8");
}

// The bytes of the text of a unit, as []byte(content) of the reference.
function bytesOf(content: string): Uint8Array {
  return Buffer.from(content, "utf8");
}

// vfsmatch.go:20
type Usage = "files" | "directories" | "exclude";

// The host of the config parser is case sensitive (test_case_parser.go:69): the folding branches of vfsmatch.go are not ported.
const matchOptions = (currentDirectory: string): ComparePathsOptions => ({
  currentDirectory,
  useCaseSensitiveFileNames: true,
});

// vfsmatch.go:38
function isImplicitGlob(lastPathComponent: string): boolean {
  return !/[.*?]/.test(lastPathComponent);
}

// vfsmatch.go:44
function getIncludeBasePath(absolute: string): string {
  const wildcardOffset = absolute.search(/[*?]/);
  if (wildcardOffset < 0) {
    if (!hasExtension(absolute)) return absolute;
    return removeTrailingDirectorySeparator(getDirectoryPath(absolute));
  }
  return absolute.slice(0, Math.max(absolute.slice(0, wildcardOffset).lastIndexOf("/"), 0));
}

// vfsmatch.go:58
function getBasePaths(path: string, includes: readonly string[]): string[] {
  const basePaths = [path];
  if (includes.length > 0) {
    const comparePathsOptions = matchOptions(path);
    const stringComparer = getComparer(comparePathsOptions);
    const includeBasePaths: string[] = [];
    for (const include of includes) {
      const absolute = isRootedDiskPath(include) ? include : normalizePath(combinePaths(path, include));
      includeBasePaths.push(getIncludeBasePath(absolute));
    }
    includeBasePaths.sort(stringComparer);
    for (const includeBasePath of includeBasePaths) {
      if (basePaths.every(basepath => !containsPath(basepath, includeBasePath, comparePathsOptions))) {
        basePaths.push(includeBasePath);
      }
    }
  }
  return basePaths;
}

type Segment = { kind: "literal"; literal: string } | { kind: "star" } | { kind: "question" };

type Component =
  | { kind: "literal"; literal: string }
  | { kind: "wildcard"; segments: Segment[]; skipPackageFolders: boolean }
  | { kind: "doubleAsterisk" };

interface GlobPattern {
  components: Component[];
  isExclude: boolean;
  excludeMinJs: boolean;
}

// vfsmatch.go:141; undefined stands for a pattern that matches nothing
function compileGlobPattern(spec: string, basePath: string, usage: Usage): GlobPattern | undefined {
  const parts = getNormalizedPathComponents(spec, basePath);
  if (usage !== "exclude" && parts[parts.length - 1] === "**") return undefined;
  parts[0] = removeTrailingDirectorySeparator(parts[0]);
  if (isImplicitGlob(parts[parts.length - 1])) parts.push("**", "*");
  const p: GlobPattern = { isExclude: usage === "exclude", excludeMinJs: usage === "files", components: [] };
  for (const part of parts) p.components.push(parseComponent(part, usage !== "exclude"));
  return p;
}

// vfsmatch.go:172
function parseComponent(s: string, isInclude: boolean): Component {
  if (s === "**") return { kind: "doubleAsterisk" };
  if (!/[*?]/.test(s)) return { kind: "literal", literal: s };
  return { kind: "wildcard", segments: parseSegments(s), skipPackageFolders: isInclude };
}

// vfsmatch.go:187
function parseSegments(s: string): Segment[] {
  const result: Segment[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "*" || s[i] === "?") {
      if (i > start) result.push({ kind: "literal", literal: s.slice(start, i) });
      result.push(s[i] === "*" ? { kind: "star" } : { kind: "question" });
      start = i + 1;
    }
  }
  if (start < s.length) result.push({ kind: "literal", literal: s.slice(start) });
  return result;
}

// vfsmatch.go:295; a part and the offset after it, undefined at the end of the path
function nextPathPart(s: string, offset: number): [part: string, nextOffset: number] | undefined {
  if (offset >= s.length) return undefined;
  if (offset === 0 && s[0] === "/") return ["", 1];
  while (offset < s.length && s[offset] === "/") offset++;
  if (offset >= s.length) return undefined;
  const idx = s.indexOf("/", offset);
  return idx >= 0 ? [s.slice(offset, idx), idx] : [s.slice(offset), s.length];
}

// vfsmatch.go:236 on the joined path; the reference scans the directory and the name without joining them
function matchPath(p: GlobPattern, path: string, pathOffset: number, compIdx: number, prefixOnly: boolean): boolean {
  for (;;) {
    const next = nextPathPart(path, pathOffset);
    if (next === undefined) return prefixOnly ? true : patternSatisfied(p, compIdx);
    const [pathPart, nextOffset] = next;
    if (compIdx >= p.components.length) return p.isExclude && !prefixOnly;
    const comp = p.components[compIdx];
    if (comp.kind === "doubleAsterisk") {
      if (matchPath(p, path, pathOffset, compIdx + 1, prefixOnly)) return true;
      if (!p.isExclude && (isHiddenPath(pathPart) || isPackageFolder(pathPart))) return false;
      pathOffset = nextOffset;
      continue;
    }
    if (comp.kind === "literal") {
      if (comp.literal !== pathPart) return false;
    } else {
      if (comp.skipPackageFolders && isPackageFolder(pathPart)) return false;
      if (!matchWildcard(p, comp.segments, pathPart)) return false;
    }
    pathOffset = nextOffset;
    compIdx++;
  }
}

// vfsmatch.go:283
function patternSatisfied(p: GlobPattern, compIdx: number): boolean {
  for (let i = compIdx; i < p.components.length; i++) if (p.components[i].kind !== "doubleAsterisk") return false;
  return true;
}

// vfsmatch.go:361
function matchWildcard(p: GlobPattern, segs: Segment[], s: string): boolean {
  if (!p.isExclude && segs.length > 0 && isHiddenPath(s) && segs[0].kind !== "literal") return false;
  const last = segs[1];
  if (segs.length === 2 && segs[0].kind === "star" && last.kind === "literal") {
    if (!s.endsWith(last.literal)) return false;
    return shouldIncludeMinJs(p, s, segs);
  }
  return matchSegments(segs, s) && shouldIncludeMinJs(p, s, segs);
}

// One step of the reference is one rune.
function runeSize(s: string, i: number): number {
  return s.codePointAt(i)! > 0xffff ? 2 : 1;
}

// vfsmatch.go:382
function matchSegments(segs: Segment[], s: string): boolean {
  let segIdx = 0;
  let sIdx = 0;
  let starSegIdx = -1;
  let starSIdx = 0;
  while (sIdx < s.length) {
    if (segIdx < segs.length) {
      const seg = segs[segIdx];
      if (seg.kind === "literal") {
        if (s.startsWith(seg.literal, sIdx)) {
          sIdx += seg.literal.length;
          segIdx++;
          continue;
        }
      } else if (seg.kind === "question") {
        if (s[sIdx] !== "/") {
          sIdx += runeSize(s, sIdx);
          segIdx++;
          continue;
        }
      } else {
        starSegIdx = segIdx;
        starSIdx = sIdx;
        segIdx++;
        continue;
      }
    }
    if (starSegIdx >= 0 && starSIdx < s.length && s[starSIdx] !== "/") {
      starSIdx += runeSize(s, starSIdx);
      sIdx = starSIdx;
      segIdx = starSegIdx + 1;
      continue;
    }
    return false;
  }
  while (segIdx < segs.length && segs[segIdx].kind === "star") segIdx++;
  return segIdx >= segs.length;
}

// vfsmatch.go:433 with :451 and :463
function shouldIncludeMinJs(p: GlobPattern, filename: string, segs: Segment[]): boolean {
  if (!p.excludeMinJs) return true;
  if (!filename.endsWith(".min.js")) return true;
  for (const seg of segs) {
    if (seg.kind === "literal" && (seg.literal.includes(".min.js") || seg.literal.includes(".min."))) return true;
  }
  return false;
}

// vfsmatch.go:488
function isHiddenPath(name: string): boolean {
  return name.length > 0 && name[0] === ".";
}

// vfsmatch.go:493; the lengths are counts of bytes
function isPackageFolder(name: string): boolean {
  switch (Buffer.byteLength(name, "utf8")) {
    case 12:
      return equalFold(name, "node_modules");
    case 13:
      return equalFold(name, "jspm_packages");
    case 16:
      return equalFold(name, "bower_components");
  }
  return false;
}

// vfsmatch.go:505
function ensureTrailingSlash(s: string): string {
  return s.length > 0 && s[s.length - 1] !== "/" ? s + "/" : s;
}

interface GlobMatcher {
  includes: GlobPattern[];
  excludes: GlobPattern[];
  hadIncludes: boolean;
}

// vfsmatch.go:519
function newGlobMatcher(
  includeSpecs: readonly string[],
  excludeSpecs: readonly string[],
  basePath: string,
  usage: Usage,
): GlobMatcher {
  const m: GlobMatcher = { hadIncludes: includeSpecs.length > 0, includes: [], excludes: [] };
  for (const spec of includeSpecs) {
    const p = compileGlobPattern(spec, basePath, usage);
    if (p !== undefined) m.includes.push(p);
  }
  for (const spec of excludeSpecs) {
    const p = compileGlobPattern(spec, basePath, "exclude");
    if (p !== undefined) m.excludes.push(p);
  }
  return m;
}

// vfsmatch.go:541; the index of the include that matches, -1 for none
function matchesFile(m: GlobMatcher, path: string): number {
  for (const exclude of m.excludes) if (matchPath(exclude, path, 0, 0, false)) return -1;
  if (m.includes.length === 0) return m.hadIncludes ? -1 : 0;
  for (let i = 0; i < m.includes.length; i++) if (matchPath(m.includes[i], path, 0, 0, false)) return i;
  return -1;
}

// vfsmatch.go:562
function matchesDirectory(m: GlobMatcher, path: string): boolean {
  for (const exclude of m.excludes) if (matchPath(exclude, path, 0, 0, false)) return false;
  if (m.includes.length === 0) return !m.hadIncludes;
  for (const include of m.includes) if (matchPath(include, path, 0, 0, true)) return true;
  return false;
}

// vfsmatch.go:31 and :648 for the one depth that the config parser passes, UnlimitedDepth
function readDirectory(
  host: MemFs,
  currentDir: string,
  path: string,
  extensions: readonly string[],
  excludes: readonly string[],
  includes: readonly string[],
): string[] {
  path = normalizePath(path);
  const currentDirectory = normalizePath(currentDir);
  const absolutePath = combinePaths(currentDirectory, path);
  const fileMatcher = newGlobMatcher(includes, excludes, absolutePath, "files");
  const directoryMatcher = newGlobMatcher(includes, excludes, absolutePath, "directories");
  const results: string[][] = [];
  for (let i = 0; i < Math.max(fileMatcher.includes.length, 1); i++) results.push([]);
  const visited = new Set<string>();

  // vfsmatch.go:594
  const visit = (path: string, absolutePath: string, resolvedRealPath: string): void => {
    const realPath = resolvedRealPath !== "" ? resolvedRealPath : host.realpath(absolutePath);
    if (visited.has(realPath)) return;
    visited.add(realPath);
    const entries = host.getAccessibleEntries(absolutePath);
    const pathPrefix = ensureTrailingSlash(path);
    const absPrefix = ensureTrailingSlash(absolutePath);
    for (const file of entries.files) {
      if (extensions.length > 0 && !fileExtensionIsOneOf(file, extensions)) continue;
      const idx = matchesFile(fileMatcher, absPrefix + file);
      if (idx >= 0) results[idx].push(pathPrefix + file);
    }
    for (const dir of entries.directories) {
      if (!matchesDirectory(directoryMatcher, absPrefix + dir)) continue;
      const childRealPath = entries.symlinks.has(dir) ? "" : combinePaths(realPath, dir);
      visit(pathPrefix + dir, absPrefix + dir, childRealPath);
    }
  };

  for (const basePath of getBasePaths(path, includes)) visit(basePath, combinePaths(currentDirectory, basePath), "");
  return results.flat();
}

// vfsmatch.go:703 with MatchIndex; undefined stands for the nil matcher
function newSpecMatcher(
  specs: readonly string[],
  basePath: string,
  usage: Usage,
): ((path: string) => number) | undefined {
  if (specs.length === 0) return undefined;
  const patterns: GlobPattern[] = [];
  for (const spec of specs) {
    const p = compileGlobPattern(spec, basePath, usage);
    if (p !== undefined) patterns.push(p);
  }
  if (patterns.length === 0) return undefined;
  return path => patterns.findIndex(p => matchPath(p, path, 0, 0, false));
}

type JsonNode =
  | { kind: "object"; properties: { key: string; value: JsonNode }[] }
  | { kind: "array"; elements: JsonNode[] }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "null" };

const jsonNumber = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const jsonWordEnd = /[A-Za-z0-9_$]/;
const maxJsonDepth = 200;

// White space and comments as the scanner of the reference skips them; -1 for a comment that does not end.
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
    } else return i;
  }
}

// True for a text of white space and comments: the parser of the reference gives a file without a statement.
function isBlankJson(text: string): boolean {
  return skipJsonTrivia(text, 0) === text.length;
}

// JSON with comments and trailing commas; undefined for any other text, which the parser of the reference reads with recovery.
function parseJsonc(text: string): JsonNode | undefined {
  let i = 0;
  const skip = (): boolean => {
    i = skipJsonTrivia(text, i);
    if (i < 0) i = text.length + 1;
    return i <= text.length;
  };
  const string = (): string | undefined => {
    const start = i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") i++;
      else if (text[i] === "\n" || text[i] === "\r") return undefined;
      i++;
    }
    if (i >= text.length) return undefined;
    i++;
    try {
      const value: unknown = JSON.parse(text.slice(start, i));
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const value = (depth: number): JsonNode | undefined => {
    if (!skip() || i >= text.length || depth > maxJsonDepth) return undefined;
    const c = text[i];
    if (c === "{") {
      i++;
      const properties: { key: string; value: JsonNode }[] = [];
      for (;;) {
        if (!skip()) return undefined;
        if (text[i] === "}") break;
        if (text[i] !== '"') return undefined;
        const key = string();
        if (key === undefined || !skip() || text[i] !== ":") return undefined;
        i++;
        const v = value(depth + 1);
        if (v === undefined || !skip()) return undefined;
        properties.push({ key, value: v });
        if (text[i] === ",") i++;
        else if (text[i] !== "}") return undefined;
      }
      i++;
      return { kind: "object", properties };
    }
    if (c === "[") {
      i++;
      const elements: JsonNode[] = [];
      for (;;) {
        if (!skip()) return undefined;
        if (text[i] === "]") break;
        const v = value(depth + 1);
        if (v === undefined || !skip()) return undefined;
        elements.push(v);
        if (text[i] === ",") i++;
        else if (text[i] !== "]") return undefined;
      }
      i++;
      return { kind: "array", elements };
    }
    if (c === '"') {
      const s = string();
      return s === undefined ? undefined : { kind: "string", value: s };
    }
    jsonNumber.lastIndex = i;
    const number = jsonNumber.exec(text);
    if (number !== null && number[0].length > 0) {
      i += number[0].length;
      return { kind: "number", value: Number(number[0]) };
    }
    for (const word of ["true", "false", "null"] as const) {
      if (text.startsWith(word, i) && !jsonWordEnd.test(text[i + word.length] ?? "")) {
        i += word.length;
        return { kind: word };
      }
    }
    return undefined;
  };
  const root = value(0);
  if (root === undefined || !skip() || i < text.length) return undefined;
  return root;
}

// A value of the raw config of the reference: nil, bool, float64, string, []any or an ordered map.
type Raw = null | boolean | number | string | Raw[] | Map<string, Raw>;

// A nil []any, which an array becomes when every element converts to nil: not null, and absent where the reference tests a slice.
const nilSlice: Raw[] = [];

// tsconfigparsing.go:818 with :742 and :664
function toRaw(node: JsonNode): Raw {
  switch (node.kind) {
    case "true":
      return true;
    case "false":
      return false;
    case "null":
      return null;
    case "string":
    case "number":
      return node.value;
    case "array": {
      if (node.elements.length === 0) return [];
      const value: Raw[] = [];
      for (const element of node.elements) {
        const converted = toRaw(element);
        if (converted !== null) value.push(converted);
      }
      return value.length === 0 ? nilSlice : value;
    }
    case "object": {
      const result = new Map<string, Raw>();
      for (const property of node.properties) {
        if (property.key !== "") result.set(property.key, toRaw(property.value));
      }
      return result;
    }
  }
}

// The fields of core.CompilerOptions that the harness reads or writes before it compiles, with the values and zero values of Go.
export interface CompilerOptions {
  allowJs: Tristate;
  checkJs: Tristate;
  resolveJsonModule: Tristate;
  module: number;
  moduleResolution: number;
  target: number;
  newLine: number;
  skipDefaultLibCheck: Tristate;
  noErrorTruncation: Tristate;
  noLib: Tristate;
  outDir: string;
  declarationDir: string;
  project: string;
  rootDir: string;
  tsBuildInfoFile: string;
  baseUrl: string;
  rootDirs: string[] | undefined;
  typeRoots: string[] | undefined;
}

type TristateName = "allowJs" | "checkJs" | "resolveJsonModule" | "skipDefaultLibCheck" | "noErrorTruncation" | "noLib";
type EnumName = "module" | "moduleResolution" | "target" | "newLine";
type PathName = "outDir" | "declarationDir" | "project" | "rootDir" | "tsBuildInfoFile" | "baseUrl";
type ListName = "rootDirs" | "typeRoots";

type OptionDeclaration =
  | { name: TristateName; kind: "boolean" }
  | { name: EnumName; kind: "enum"; enumMap: ReadonlyMap<string, number> }
  | { name: PathName; kind: "string" }
  | { name: ListName; kind: "list" };

// enummaps.go:145, :154, :171 and :202
const moduleResolutionOptionMap = new Map([
  ["node16", 3],
  ["nodenext", 99],
  ["bundler", 100],
  ["classic", 1],
  ["node", 2],
  ["node10", 2],
]);
const targetOptionMap = new Map([
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
const moduleOptionMap = new Map([
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
const newLineOptionMap = new Map([
  ["crlf", NewLineKindCRLF],
  ["lf", NewLineKindLF],
]);

// declscompiler.go for the fields above: every string is a file path, and so is every element of the two lists.
const optionDeclarations: readonly OptionDeclaration[] = [
  { name: "allowJs", kind: "boolean" },
  { name: "checkJs", kind: "boolean" },
  { name: "resolveJsonModule", kind: "boolean" },
  { name: "skipDefaultLibCheck", kind: "boolean" },
  { name: "noErrorTruncation", kind: "boolean" },
  { name: "noLib", kind: "boolean" },
  { name: "module", kind: "enum", enumMap: moduleOptionMap },
  { name: "moduleResolution", kind: "enum", enumMap: moduleResolutionOptionMap },
  { name: "target", kind: "enum", enumMap: targetOptionMap },
  { name: "newLine", kind: "enum", enumMap: newLineOptionMap },
  { name: "outDir", kind: "string" },
  { name: "declarationDir", kind: "string" },
  { name: "project", kind: "string" },
  { name: "rootDir", kind: "string" },
  { name: "tsBuildInfoFile", kind: "string" },
  { name: "baseUrl", kind: "string" },
  { name: "rootDirs", kind: "list" },
  { name: "typeRoots", kind: "list" },
];
const optionByName = new Map(optionDeclarations.map(o => [o.name as string, o]));

function emptyCompilerOptions(): CompilerOptions {
  return {
    allowJs: TSUnknown,
    checkJs: TSUnknown,
    resolveJsonModule: TSUnknown,
    module: 0,
    moduleResolution: 0,
    target: 0,
    newLine: NewLineKindNone,
    skipDefaultLibCheck: TSUnknown,
    noErrorTruncation: TSUnknown,
    noLib: TSUnknown,
    outDir: "",
    declarationDir: "",
    project: "",
    rootDir: "",
    tsBuildInfoFile: "",
    baseUrl: "",
    rootDirs: undefined,
    typeRoots: undefined,
  };
}

function cloneCompilerOptions(options: CompilerOptions): CompilerOptions {
  return { ...options, rootDirs: options.rootDirs?.slice(), typeRoots: options.typeRoots?.slice() };
}

// tsconfigparsing.go:927
function getDefaultCompilerOptions(configFileName: string): CompilerOptions {
  const options = emptyCompilerOptions();
  if (configFileName !== "" && getBaseFileName(configFileName) === "jsconfig.json") options.allowJs = TSTrue;
  return options;
}

// core/compileroptions.go:195, :202 and :223
function getEmitModuleKind(options: CompilerOptions): number {
  if (options.module !== 0) return options.module;
  const target = options.target !== 0 ? options.target : 12;
  if (target === 99) return 99;
  if (target >= 9) return 7;
  if (target >= 7) return 6;
  if (target >= 2) return 5;
  return 1;
}

function getModuleResolutionKind(options: CompilerOptions): number {
  if (options.moduleResolution > 2) return options.moduleResolution;
  const moduleKind = getEmitModuleKind(options);
  if (moduleKind >= 100 && moduleKind <= 102) return 3;
  return moduleKind === 199 ? 99 : 100;
}

// core/compileroptions.go:266
function getResolveJsonModule(options: CompilerOptions): boolean {
  if (options.resolveJsonModule !== TSUnknown) return options.resolveJsonModule === TSTrue;
  const moduleKind = getEmitModuleKind(options);
  if (moduleKind === 102 || moduleKind === 199) return true;
  return getModuleResolutionKind(options) === 100;
}

// core/compileroptions.go:282
function getAllowJS(options: CompilerOptions): boolean {
  if (options.allowJs !== TSUnknown) return options.allowJs === TSTrue;
  return options.checkJs === TSTrue;
}

const configDirTemplate = "${configDir}";

// tsconfigparsing.go:436
function startsWithConfigDirTemplate(value: string): boolean {
  return toLower(value).startsWith(toLower(configDirTemplate));
}

// tsconfigparsing.go:1797
function getSubstitutedPathWithConfigDirTemplate(value: string, basePath: string): string {
  const at = value.indexOf(configDirTemplate);
  const replaced = at < 0 ? value : value.slice(0, at) + "./" + value.slice(at + configDirTemplate.length);
  return getNormalizedAbsolutePath(replaced, basePath);
}

// tsconfigparsing.go:1801; undefined stands for nil
function getSubstitutedStringArrayWithConfigDirTemplate(
  list: readonly string[],
  basePath: string,
): string[] | undefined {
  let result: string[] | undefined;
  list.forEach((element, i) => {
    if (startsWithConfigDirTemplate(element)) {
      result ??= list.slice();
      result[i] = getSubstitutedPathWithConfigDirTemplate(element, basePath);
    }
  });
  return result;
}

// tsconfigparsing.go:1817 for the fields above
function handleOptionConfigDirTemplateSubstitution(options: CompilerOptions | undefined, basePath: string): void {
  if (options === undefined) return;
  for (const name of ["rootDirs", "typeRoots"] as const) {
    const list = options[name];
    if (list !== undefined) options[name] = getSubstitutedStringArrayWithConfigDirTemplate(list, basePath) ?? list;
  }
  for (const name of ["outDir", "rootDir", "tsBuildInfoFile", "baseUrl", "declarationDir"] as const) {
    if (startsWithConfigDirTemplate(options[name])) {
      options[name] = getSubstitutedPathWithConfigDirTemplate(options[name], basePath);
    }
  }
}

// tsconfigparsing.go:444 for a file path
function normalizeFilePathOption(value: string, basePath: string): string {
  value = normalizeSlashes(value);
  if (!startsWithConfigDirTemplate(value)) value = getNormalizedAbsolutePath(value, basePath);
  return value === "" ? "." : value;
}

// tsconfigparsing.go:457 followed by parsinghelpers.go:268: a value of the config that converts to nil sets nothing
function setOptionFromJson(options: CompilerOptions, option: OptionDeclaration, value: Raw, basePath: string): void {
  switch (option.kind) {
    case "boolean":
      if (typeof value === "boolean") options[option.name] = value ? TSTrue : TSFalse;
      return;
    case "enum": {
      if (typeof value !== "string" || value === "") return;
      const converted = option.enumMap.get(toLower(value));
      if (converted !== undefined) options[option.name] = converted;
      return;
    }
    case "string":
      if (typeof value === "string") options[option.name] = normalizeFilePathOption(value, basePath);
      return;
    case "list": {
      // A list that is null, or whose every element is, converts to a nil slice, which is not nil for the setter.
      if (value === null || value === nilSlice) options[option.name] = undefined;
      if (value === null || value === nilSlice || !Array.isArray(value)) return;
      const list: string[] = [];
      for (const element of value)
        if (typeof element === "string") list.push(normalizeFilePathOption(element, basePath));
      options[option.name] = list;
      return;
    }
  }
}

function isZero(value: CompilerOptions[keyof CompilerOptions]): boolean {
  return value === 0 || value === "" || value === undefined;
}

// parsinghelpers.go:648; rawSource names the fields that the config sets to null
function mergeCompilerOptions(
  targetOptions: CompilerOptions,
  sourceOptions: CompilerOptions | undefined,
  rawSource: Map<string, Raw> | undefined,
): CompilerOptions {
  if (sourceOptions === undefined) return targetOptions;
  const compilerOptionsRaw = rawSource?.get("compilerOptions");
  const target = targetOptions as unknown as Record<string, CompilerOptions[keyof CompilerOptions]>;
  for (const { name } of optionDeclarations) {
    if (compilerOptionsRaw instanceof Map && compilerOptionsRaw.get(name) === null) {
      target[name] = typeof target[name] === "number" ? 0 : typeof target[name] === "string" ? "" : undefined;
      continue;
    }
    const value = sourceOptions[name];
    if (!isZero(value)) target[name] = Array.isArray(value) ? value.slice() : value;
  }
  return targetOptions;
}

// module.ResolveConfig for an "extends" that names a package: the file name, "" when it does not resolve, undefined when not known.
export type ResolveExtendedConfig = (extendedConfig: string, containingFile: string) => string | undefined;

interface ParseConfigHost {
  fs: MemFs;
  currentDirectory: string;
  resolveExtendedConfig: ResolveExtendedConfig | undefined;
}

interface ParsedTsconfig {
  // undefined: the raw value of the reference is no ordered map
  raw: Map<string, Raw> | undefined;
  // undefined stands for nil
  options: CompilerOptions | undefined;
  extendedConfigPath: string[] | undefined;
}

// The resolver of the reference finds a package only below node_modules or through a package.json.
function hasPackages(fs: MemFs): boolean {
  for (const entry of fs.m.values()) {
    const name = getBaseFileName(entry.realpath);
    if (name === "node_modules" || name === "package.json") return true;
  }
  return false;
}

// tsconfigparsing.go:553
function getExtendsConfigPath(extendedConfig: string, host: ParseConfigHost, basePath: string): string {
  extendedConfig = normalizeSlashes(extendedConfig);
  if (isRootedDiskPath(extendedConfig) || extendedConfig.startsWith("./") || extendedConfig.startsWith("../")) {
    let extendedConfigPath = getNormalizedAbsolutePath(extendedConfig, basePath);
    if (!host.fs.fileExists(extendedConfigPath) && !extendedConfigPath.endsWith(ExtensionJson)) {
      extendedConfigPath = extendedConfigPath + ExtensionJson;
      if (!host.fs.fileExists(extendedConfigPath)) return "";
    }
    return extendedConfigPath;
  }
  const relative = extendedConfig === "." || extendedConfig === "..";
  if (!relative && !hasPackages(host.fs)) return "";
  const resolved = host.resolveExtendedConfig?.(extendedConfig, combinePaths(basePath, "tsconfig.json"));
  if (resolved !== undefined) return resolved;
  throw new Undecided("config-extends-package", `extends ${quote(extendedConfig)} is resolved like a module`);
}

// tsconfigparsing.go:504
function getExtendsConfigPathOrArray(
  value: Raw,
  host: ParseConfigHost,
  basePath: string,
  configFileName: string,
): string[] {
  const extendedConfigPathArray: string[] = [];
  const newBase =
    configFileName !== "" ? getDirectoryPath(getNormalizedAbsolutePath(configFileName, basePath)) : basePath;
  for (const fileName of typeof value === "string" ? [value] : Array.isArray(value) ? value : []) {
    if (typeof fileName !== "string") continue;
    const extendedConfigPath = getExtendsConfigPath(fileName, host, newBase);
    if (extendedConfigPath !== "") extendedConfigPathArray.push(extendedConfigPath);
  }
  return extendedConfigPathArray;
}

// tsconfigparsing.go:178 with :311
function parseOwnConfigOfJsonSourceFile(
  text: string,
  host: ParseConfigHost,
  basePath: string,
  configFileName: string,
): ParsedTsconfig {
  const options = getDefaultCompilerOptions(configFileName);
  let extendedConfigPath: string[] | undefined;
  if (isBlankJson(text)) return { raw: undefined, options, extendedConfigPath };
  let root = parseJsonc(text);
  if (root === undefined) {
    throw new Undecided("config-not-json", `${configFileName} is not JSON with comments and trailing commas`);
  }
  if (root.kind !== "object") {
    const elements = root.kind === "array" ? root.elements : [];
    root = elements.find(element => element.kind === "object");
    if (root === undefined) return { raw: new Map(), options, extendedConfigPath };
  }
  const raw = new Map<string, Raw>();
  for (const property of root.kind === "object" ? root.properties : []) {
    if (property.key === "") continue;
    const value = toRaw(property.value);
    raw.set(property.key, value);
    if (property.key === "extends") {
      extendedConfigPath = getExtendsConfigPathOrArray(value, host, basePath, configFileName);
    } else if (property.key === "compilerOptions" && property.value.kind === "object") {
      for (const { key, value: node } of property.value.properties) {
        const option = optionByName.get(key);
        if (option !== undefined) setOptionFromJson(options, option, toRaw(node), basePath);
      }
    }
  }
  return { raw, options, extendedConfigPath };
}

// tsconfigparsing.go:1082 for a config that is read from its text
function parseConfig(
  text: string,
  host: ParseConfigHost,
  basePath: string,
  configFileName: string,
  resolutionStack: readonly string[],
): ParsedTsconfig {
  basePath = normalizeSlashes(basePath);
  const resolvedPath = toPath(configFileName, basePath, host.fs.useCaseSensitiveFileNames);
  if (resolutionStack.includes(resolvedPath))
    return { raw: undefined, options: undefined, extendedConfigPath: undefined };
  const ownConfig = parseOwnConfigOfJsonSourceFile(text, host, basePath, configFileName);
  if (ownConfig.extendedConfigPath === undefined) return ownConfig;
  const ownRaw = ownConfig.raw;
  const stack = [...resolutionStack, resolvedPath];
  const resultOptions = emptyCompilerOptions();
  const result: { include?: Raw[]; exclude?: Raw[]; files?: Raw[]; contentMappers?: Raw[] } = {};
  for (const extendedConfigPath of ownConfig.extendedConfigPath) {
    // tsconfigparsing.go:1015, :1052 and :996: a file that cannot be read gives no config
    const extendedText = readFileText(host.fs, extendedConfigPath);
    if (extendedText === undefined) continue;
    const extendedConfig = parseConfig(
      extendedText,
      host,
      getDirectoryPath(extendedConfigPath),
      getBaseFileName(extendedConfigPath),
      stack,
    );
    if (extendedConfig.options === undefined) continue;
    const extendsRaw = extendedConfig.raw;
    let relativeDifference = "";
    for (const propertyName of ["include", "exclude", "files"] as const) {
      if (ownRaw !== undefined && ownRaw.has(propertyName)) continue;
      const slice = extendsRaw?.get(propertyName);
      if (!Array.isArray(slice) || slice === nilSlice) continue;
      result[propertyName] = slice.map(path => {
        if (typeof path !== "string") return path;
        if (startsWithConfigDirTemplate(path) || isRootedDiskPath(path)) return path;
        if (relativeDifference === "") {
          relativeDifference = convertToRelativePath(getDirectoryPath(extendedConfigPath), {
            useCaseSensitiveFileNames: host.fs.useCaseSensitiveFileNames,
            currentDirectory: basePath,
          });
        }
        return combinePaths(relativeDifference, path);
      });
    }
    const contentMappers = extendsRaw?.get("contentMappers");
    if (extendsRaw?.has("contentMappers") === true) {
      result.contentMappers = Array.isArray(contentMappers) && contentMappers !== nilSlice ? contentMappers : undefined;
    }
    mergeCompilerOptions(resultOptions, extendedConfig.options, extendsRaw);
  }
  if (ownRaw !== undefined) {
    if (result.include !== undefined) ownRaw.set("include", result.include);
    if (result.exclude !== undefined) ownRaw.set("exclude", result.exclude);
    if (result.files !== undefined) ownRaw.set("files", result.files);
    if (result.contentMappers !== undefined && !ownRaw.has("contentMappers")) {
      ownRaw.set("contentMappers", result.contentMappers);
    }
  }
  ownConfig.options = mergeCompilerOptions(resultOptions, ownConfig.options, ownRaw);
  return ownConfig;
}

// With --runExternalCode the extensions of content mappers join those of the files, after a package lookup that is not ported.
function contentMappersUndecided(configFileName: string): Undecided {
  return new Undecided(
    "config-content-mappers",
    `${configFileName} has content mappers and the case runs external code`,
  );
}

// tsconfigparsing.go:1576
function invalidTrailingRecursion(spec: string): boolean {
  const s = spec.endsWith("/") ? spec.slice(0, -1) : spec;
  return s === "**" || s.endsWith("/**");
}

// tsconfigparsing.go:1583
function invalidDotDotAfterRecursiveWildcard(s: string): boolean {
  const wildcardIndex = s.startsWith("**/") ? 0 : s.indexOf("/**/");
  if (wildcardIndex === -1) return false;
  const lastDotIndex = s.endsWith("/..") ? s.length : s.lastIndexOf("/../");
  return lastDotIndex > wildcardIndex;
}

// tsconfigparsing.go:1540
function validateSpecs(specs: readonly Raw[], disallowTrailingRecursion: boolean): string[] {
  const finalSpecs: string[] = [];
  for (const spec of specs) {
    if (typeof spec !== "string") continue;
    if (disallowTrailingRecursion && invalidTrailingRecursion(spec)) continue;
    if (invalidDotDotAfterRecursiveWildcard(spec)) continue;
    finalSpecs.push(spec);
  }
  return finalSpecs;
}

// tsconfigparsing.go:1869
function hasFileWithHigherPriorityExtension(
  file: string,
  extensions: readonly (readonly string[])[],
  hasFile: (fileName: string) => boolean,
): boolean {
  const extensionGroup: string[] = [];
  for (const group of extensions) if (fileExtensionIsOneOf(file, group)) extensionGroup.push(...group);
  for (const ext of extensionGroup) {
    if (fileExtensionIs(file, ext) && (ext !== ExtensionTs || !fileExtensionIs(file, ExtensionDts))) return false;
    if (hasFile(changeExtension(file, ext))) {
      if (ext === ExtensionDts && (fileExtensionIs(file, ExtensionJs) || fileExtensionIs(file, ExtensionJsx))) continue;
      return true;
    }
  }
  return false;
}

// tsconfigparsing.go:1901
function removeWildcardFilesWithLowerPriorityExtension(
  file: string,
  wildcardFiles: Map<string, string>,
  extensions: readonly (readonly string[])[],
  keyMapper: (value: string) => string,
): void {
  const extensionGroup: string[] = [];
  for (const group of extensions) if (fileExtensionIsOneOf(file, group)) extensionGroup.push(...group);
  for (let i = extensionGroup.length - 1; i >= 0; i--) {
    const ext = extensionGroup[i];
    if (fileExtensionIs(file, ext)) return;
    wildcardFiles.delete(keyMapper(changeExtension(file, ext)));
  }
}

interface ConfigFileSpecs {
  validatedFilesSpec: string[];
  validatedIncludeSpecs: string[];
  validatedExcludeSpecs: string[];
}

// tsconfigparsing.go:1928 without the extensions of content mappers
function getFileNamesFromConfigSpecs(
  configFileSpecs: ConfigFileSpecs,
  basePath: string,
  options: CompilerOptions | undefined,
  host: MemFs,
): string[] {
  basePath = normalizePath(basePath);
  const keyMapper = (value: string) => getCanonicalFileName(value, host.useCaseSensitiveFileNames);
  const literalFileMap = new Map<string, string>();
  const wildcardFileMap = new Map<string, string>();
  const wildCardJsonFileMap = new Map<string, string>();
  const { validatedFilesSpec, validatedIncludeSpecs, validatedExcludeSpecs } = configFileSpecs;
  // tsconfigparsing.go:2020 and :2044; the options are never nil when the harness parses a config
  const effective = options ?? emptyCompilerOptions();
  const needJSExtensions = getAllowJS(effective);
  const supportedExtensions = needJSExtensions ? AllSupportedExtensions : SupportedTSExtensions;
  const supportedExtensionsWithJsonIfResolveJsonModule = !getResolveJsonModule(effective)
    ? supportedExtensions
    : needJSExtensions
      ? AllSupportedExtensionsWithJson
      : SupportedTSExtensionsWithJson;
  for (const fileName of validatedFilesSpec) {
    literalFileMap.set(keyMapper(fileName), getNormalizedAbsolutePath(fileName, basePath));
  }
  if (validatedIncludeSpecs.length > 0) {
    const files = readDirectory(
      host,
      basePath,
      basePath,
      supportedExtensionsWithJsonIfResolveJsonModule.flat(),
      validatedExcludeSpecs,
      validatedIncludeSpecs,
    );
    // The reference makes this matcher lazily, at the first .json file: the result is the same.
    const jsonIncludes = validatedIncludeSpecs.filter(include => include.endsWith(ExtensionJson));
    const jsonOnlyIncludeMatchers = newSpecMatcher(jsonIncludes, basePath, "files");
    for (const file of files) {
      if (fileExtensionIs(file, ExtensionJson)) {
        const includeIndex = jsonOnlyIncludeMatchers === undefined ? -1 : jsonOnlyIncludeMatchers(file);
        if (includeIndex !== -1) {
          const key = keyMapper(file);
          if (!literalFileMap.has(key) && !wildCardJsonFileMap.has(key)) wildCardJsonFileMap.set(key, file);
        }
        continue;
      }
      const hasFile = (fileName: string) => {
        const canonicalFileName = keyMapper(fileName);
        return literalFileMap.has(canonicalFileName) || wildcardFileMap.has(canonicalFileName);
      };
      if (hasFileWithHigherPriorityExtension(file, supportedExtensions, hasFile)) continue;
      removeWildcardFilesWithLowerPriorityExtension(file, wildcardFileMap, supportedExtensions, keyMapper);
      const key = keyMapper(file);
      if (!literalFileMap.has(key) && !wildcardFileMap.has(key)) wildcardFileMap.set(key, file);
    }
  }
  return [...literalFileMap.values(), ...wildcardFileMap.values(), ...wildCardJsonFileMap.values()];
}

// The parts of tsoptions.ParsedCommandLine that the harness reads before it compiles.
export interface ParsedCommandLine {
  // ParsedConfig.FileNames
  fileNames: string[];
  // ParsedConfig.CompilerOptions for the fields of CompilerOptions; undefined stands for nil
  compilerOptions: CompilerOptions | undefined;
}

// tsconfigparsing.go:1221: a value that is no array counts as a property that is absent
function getPropFromRaw(rawConfig: Map<string, Raw>, prop: string): { sliceValue: Raw[] | undefined; noProp: boolean } {
  const value = rawConfig.get(prop);
  if (!Array.isArray(value)) return { sliceValue: undefined, noProp: true };
  return { sliceValue: value === nilSlice ? undefined : value, noProp: false };
}

// tsconfigparsing.go:726 and :1237, up to the file names
function parseJsonSourceFileConfigFileContent(
  text: string,
  host: ParseConfigHost,
  basePath: string,
  runExternalCode: boolean,
  configFileName: string,
): ParsedCommandLine {
  const directory =
    configFileName !== "" ? getDirectoryPath(getNormalizedAbsolutePath(configFileName, basePath)) : basePath;
  const basePathForFileNames = normalizePath(directory);
  const parsedConfig = parseConfig(text, host, basePath, configFileName, []);
  handleOptionConfigDirTemplateSubstitution(parsedConfig.options, basePathForFileNames);
  const rawConfig = parsedConfig.raw ?? new Map<string, Raw>();
  const fileSpecs = getPropFromRaw(rawConfig, "files");
  let includeSpecs = getPropFromRaw(rawConfig, "include");
  let excludeSpecs = getPropFromRaw(rawConfig, "exclude");
  if (excludeSpecs.noProp && parsedConfig.options !== undefined) {
    const { outDir, declarationDir } = parsedConfig.options;
    const values: Raw[] = [];
    if (outDir !== "") values.push(outDir);
    if (declarationDir !== "") values.push(declarationDir);
    if (values.length > 0) excludeSpecs = { sliceValue: values, noProp: false };
  }
  if (fileSpecs.sliceValue === undefined && includeSpecs.sliceValue === undefined) {
    includeSpecs = { sliceValue: ["**/*"], noProp: false };
  }
  let validatedIncludeSpecs: string[] = [];
  let validatedExcludeSpecs: string[] = [];
  let validatedFilesSpec: string[] = [];
  const substituted = (list: string[]) =>
    getSubstitutedStringArrayWithConfigDirTemplate(list, basePathForFileNames) ?? list;
  if (includeSpecs.sliceValue !== undefined)
    validatedIncludeSpecs = substituted(validateSpecs(includeSpecs.sliceValue, true));
  if (excludeSpecs.sliceValue !== undefined)
    validatedExcludeSpecs = substituted(validateSpecs(excludeSpecs.sliceValue, false));
  if (fileSpecs.sliceValue !== undefined) {
    validatedFilesSpec = substituted(fileSpecs.sliceValue.filter((spec): spec is string => typeof spec === "string"));
  }
  // tsconfigparsing.go:1385: without the flag the reference drops the content mappers of a config
  if (runExternalCode && getPropFromRaw(rawConfig, "contentMappers").sliceValue?.length) {
    throw contentMappersUndecided(configFileName);
  }
  const fileNames = getFileNamesFromConfigSpecs(
    { validatedFilesSpec, validatedIncludeSpecs, validatedExcludeSpecs },
    basePathForFileNames,
    parsedConfig.options,
    host.fs,
  );
  return { fileNames, compilerOptions: parsedConfig.options };
}

// test_case_parser.go:28
export interface TestUnit {
  name: string;
  content: string;
}

// harnessutil.go:45
export interface TestFile {
  unitName: string;
  content: string;
}

// Settings by name, as a map or as an object: links, global options, the configuration of an instance.
export type Settings = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

// The results of ParseTestFilesAndSymlinks (test_case_parser.go:130): all units in order, links, @currentDirectory, global options.
export interface ParsedTestFiles {
  units: readonly TestUnit[];
  symlinks: Settings;
  currentDirectory: string;
  globalOptions?: Settings;
}

// test_case_parser.go:33
export interface TestCaseContent {
  testUnitData: TestUnit[];
  tsConfig: ParsedCommandLine | undefined;
  tsConfigFileUnitData: TestUnit | undefined;
  symlinks: Map<string, string>;
}

// harnessutil.go:64
export interface HarnessOptions {
  useCaseSensitiveFileNames: boolean;
  baselineFile: string;
  includeBuiltFile: string;
  fileName: string;
  libFiles: string[];
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

// An entry of the file system that vfstest.FromMap makes for the program, with its real path.
export type FileSystemEntry =
  | { kind: "dir"; path: string }
  | { kind: "file"; path: string; data: Uint8Array }
  | { kind: "symlink"; path: string; target: string };

// compiler_runner.go:246 without the result of the compilation, and what CompileFilesEx makes before it compiles.
export interface CompilerTest {
  currentDirectory: string;
  // The configuration after compiler_runner.go:320.
  harnessConfig: Map<string, string>;
  options: CompilerOptions;
  harnessOptions: HarnessOptions;
  tsConfig: ParsedCommandLine | undefined;
  tsConfigFiles: TestFile[];
  toBeCompiled: TestFile[];
  otherFiles: TestFile[];
  hasNonDtsFiles: boolean;
  programFileNames: string[];
  includeLibDir: boolean;
  // Link to target, both absolute (harnessutil.go:208).
  symlinks: Map<string, string>;
  // Directories before what they hold.
  fileSystem: FileSystemEntry[];
}

// The files of tests/lib by their names below /.lib, as testLibFolderMap holds them (harnessutil.go:267).
export type TestLibFolder = ReadonlyMap<string, Uint8Array>;

function entriesOf(settings: Settings | undefined): [string, string][] {
  if (settings === undefined) return [];
  return settings instanceof Map ? [...settings] : Object.entries(settings);
}

// harnessutil.go:1228
function getConfigNameFromFileName(filename: string): string {
  const basenameLower = toLower(getBaseFileName(filename));
  return basenameLower === "tsconfig.json" || basenameLower === "jsconfig.json" ? basenameLower : "";
}

// test_case_parser.go:51 after ParseTestFilesAndSymlinks: the config file leaves the units and its file names are read.
export function makeTestCaseContent(
  parsed: ParsedTestFiles,
  resolveExtendedConfig?: ResolveExtendedConfig,
): Result<TestCaseContent> {
  try {
    const testUnits = parsed.units.slice();
    const symlinks = new Map(entriesOf(parsed.symlinks));
    const currentDirectory = parsed.currentDirectory === "" ? srcFolder : parsed.currentDirectory;
    // vfsparseconfighost.go:45: the host is made for every case, and a link replaces a file of its name
    const entries = new Map<string, MemInput>();
    for (const data of testUnits) {
      entries.set(getNormalizedAbsolutePath(data.name, currentDirectory), {
        kind: "file",
        data: bytesOf(data.content),
      });
    }
    for (const [link, target] of symlinks) {
      const name = getNormalizedAbsolutePath(link, currentDirectory);
      entries.set(name, { kind: "symlink", target: getNormalizedAbsolutePath(target, currentDirectory) });
    }
    const fs = new MemFs(entries, true);
    const index = testUnits.findIndex(data => getConfigNameFromFileName(data.name) !== "");
    if (index < 0) {
      return {
        ok: true,
        value: { testUnitData: testUnits, tsConfig: undefined, tsConfigFileUnitData: undefined, symlinks },
      };
    }
    const runExternalCode = entriesOf(parsed.globalOptions).some(
      ([name, value]) => name === "runexternalcode" && value === "true",
    );
    const data = testUnits[index];
    const configFileName = getNormalizedAbsolutePath(data.name, currentDirectory);
    const tsConfig = parseJsonSourceFileConfigFileContent(
      data.content,
      { fs, currentDirectory, resolveExtendedConfig },
      getDirectoryPath(configFileName),
      runExternalCode,
      configFileName,
    );
    testUnits.splice(index, 1);
    return { ok: true, value: { testUnitData: testUnits, tsConfig, tsConfigFileUnitData: data, symlinks } };
  } catch (error) {
    return refusalOf(error);
  }
}

type HarnessOptionDeclaration = { name: keyof HarnessOptions; kind: "boolean" | "string" | "list" };

// harnessutil.go:341
const harnessCommandLineOptions: readonly HarnessOptionDeclaration[] = [
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

// harnessutil.go:443 for a boolean
function getBooleanOptionValue(name: string, value: string): boolean {
  const lower = toLower(value);
  if (lower === "true") return true;
  if (lower === "false") return false;
  throw new HarnessStop(`Value for option '${name}' must be a boolean, got: ${value}`);
}

// commandlineparser.go:347 for a list of strings: the elements are not trimmed and an empty one is dropped
function parseListTypeOption(value: string): string[] {
  value = trimSpace(value);
  if (value.startsWith("-") || value === "") return [];
  return value.split(",").filter(element => element !== "");
}

// harnessutil.go:292 for the options declared here; the port of the whole option table is the one that tells an unknown name.
function setOptionsFromTestConfig(
  testConfig: ReadonlyMap<string, string>,
  compilerOptions: CompilerOptions,
  harnessOptions: HarnessOptions,
  currentDirectory: string,
): void {
  // The reference walks a Go map, whose order changes from run to run: here the names are in the order of their bytes.
  for (const name of [...testConfig.keys()].sort(compareStrings)) {
    const value = testConfig.get(name)!;
    if (name === "typescriptversion") continue;
    const commandLineOption = optionDeclarations.find(option => equalFold(option.name, name));
    if (commandLineOption !== undefined) {
      switch (commandLineOption.kind) {
        case "boolean":
          compilerOptions[commandLineOption.name] = getBooleanOptionValue(commandLineOption.name, value)
            ? TSTrue
            : TSFalse;
          break;
        case "enum": {
          const enumVal = commandLineOption.enumMap.get(toLower(value));
          if (enumVal === undefined) {
            const keys = [...commandLineOption.enumMap.keys()].join(",");
            throw new HarnessStop(`Value for option '${commandLineOption.name}' must be one of ${keys}, got: ${value}`);
          }
          compilerOptions[commandLineOption.name] = enumVal;
          break;
        }
        case "string":
          compilerOptions[commandLineOption.name] = getNormalizedAbsolutePath(value, currentDirectory);
          break;
        case "list":
          compilerOptions[commandLineOption.name] = parseListTypeOption(value).map(item =>
            getNormalizedAbsolutePath(item, currentDirectory),
          );
          break;
      }
      continue;
    }
    const harnessOption = harnessCommandLineOptions.find(option => equalFold(option.name, name));
    if (harnessOption === undefined) continue;
    // harnessutil.go:405
    const target = harnessOptions as unknown as Record<string, boolean | string | string[]>;
    if (harnessOption.kind === "boolean") target[harnessOption.name] = getBooleanOptionValue(harnessOption.name, value);
    else if (harnessOption.kind === "list") target[harnessOption.name] = parseListTypeOption(value);
    else target[harnessOption.name] = value;
  }
}

// harnessutil.go:81
function compileFiles(
  inputFiles: TestFile[],
  otherFiles: TestFile[],
  testConfig: ReadonlyMap<string, string> | undefined,
  tsconfig: ParsedCommandLine | undefined,
  currentDirectory: string,
  symlinks: ReadonlyMap<string, string>,
  testLibFolderMap: TestLibFolder | undefined,
) {
  const compilerOptions =
    tsconfig?.compilerOptions !== undefined ? cloneCompilerOptions(tsconfig.compilerOptions) : emptyCompilerOptions();
  if (compilerOptions.newLine === NewLineKindNone) compilerOptions.newLine = NewLineKindCRLF;
  if (compilerOptions.skipDefaultLibCheck === TSUnknown) compilerOptions.skipDefaultLibCheck = TSTrue;
  compilerOptions.noErrorTruncation = TSTrue;
  const harnessOptions: HarnessOptions = {
    useCaseSensitiveFileNames: true,
    baselineFile: "",
    includeBuiltFile: "",
    fileName: "",
    libFiles: [],
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
  if (testConfig !== undefined) setOptionsFromTestConfig(testConfig, compilerOptions, harnessOptions, currentDirectory);
  const made = compileFilesEx(
    inputFiles,
    otherFiles,
    harnessOptions,
    compilerOptions,
    currentDirectory,
    symlinks,
    testLibFolderMap,
  );
  return { ...made, options: compilerOptions, harnessOptions };
}

// harnessutil.go:115, up to the file system of the program
function compileFilesEx(
  inputFiles: TestFile[],
  otherFiles: TestFile[],
  harnessOptions: HarnessOptions,
  compilerOptions: CompilerOptions,
  currentDirectory: string,
  symlinks: ReadonlyMap<string, string>,
  testLibFolderMap: TestLibFolder | undefined,
) {
  const programFileNames: string[] = [];
  for (const file of inputFiles) {
    const fileName = getNormalizedAbsolutePath(file.unitName, currentDirectory);
    if (!fileExtensionIs(fileName, ExtensionJson) && !fileExtensionIs(fileName, ExtensionTsBuildInfo)) {
      programFileNames.push(fileName);
    }
  }
  let includeLibDir = inputFiles.some(file => file.content.includes(testLibFolder + "/"));
  for (const libFile of harnessOptions.libFiles) {
    if (libFile === "lib.d.ts" && compilerOptions.noLib !== TSTrue) continue;
    programFileNames.push(combinePaths(testLibFolder, libFile));
    includeLibDir = true;
  }
  // harnessutil.go:158: the reference skips the test when it has no copy of tests/lib
  if (includeLibDir && testLibFolderMap === undefined) throw new Undecided("lib-directory-missing", "");

  for (const name of ["outDir", "project", "rootDir", "tsBuildInfoFile", "baseUrl", "declarationDir"] as const) {
    if (compilerOptions[name] !== "") {
      compilerOptions[name] = getNormalizedAbsolutePath(compilerOptions[name], currentDirectory);
    }
  }
  for (const name of ["rootDirs", "typeRoots"] as const) {
    compilerOptions[name] = compilerOptions[name]?.map(dir => getNormalizedAbsolutePath(dir, currentDirectory));
  }

  const testfs = new Map<string, MemInput>();
  const absoluteSymlinks = new Map<string, string>();
  for (const file of [...inputFiles, ...otherFiles]) {
    testfs.set(getNormalizedAbsolutePath(file.unitName, currentDirectory), {
      kind: "file",
      data: bytesOf(file.content),
    });
  }
  for (const [src, target] of symlinks) {
    const srcFileName = getNormalizedAbsolutePath(src, currentDirectory);
    const targetFileName = getNormalizedAbsolutePath(target, currentDirectory);
    testfs.set(srcFileName, { kind: "symlink", target: targetFileName });
    absoluteSymlinks.set(srcFileName, targetFileName);
  }
  if (includeLibDir && testLibFolderMap !== undefined) {
    for (const [path, data] of testLibFolderMap) testfs.set(testLibFolder + "/" + path, { kind: "file", data });
  }
  const fs = new MemFs(testfs, harnessOptions.useCaseSensitiveFileNames);
  const fileSystem: FileSystemEntry[] = [];
  for (const entry of fs.m.values()) {
    // vfstest.go:645
    const path = getRootLength(entry.realpath) !== 0 ? entry.realpath : "/" + entry.realpath;
    if (entry.kind === "dir") fileSystem.push({ kind: "dir", path });
    else if (entry.kind === "file") fileSystem.push({ kind: "file", path, data: entry.data });
    else fileSystem.push({ kind: "symlink", path, target: absoluteSymlinks.get(path) ?? "/" + entry.target });
  }
  return { programFileNames, includeLibDir, symlinks: absoluteSymlinks, fileSystem };
}

export interface NewCompilerTestOptions {
  // Needed by an instance that mounts /.lib; see readTestLibFolder.
  testLibFolder?: TestLibFolder;
}

// compiler_runner.go:266, up to the compilation
export function newCompilerTest(
  testContent: TestCaseContent,
  configuration: Settings | undefined,
  options: NewCompilerTestOptions = {},
): Result<CompilerTest> {
  try {
    const harnessConfig = configuration === undefined ? undefined : new Map(entriesOf(configuration));
    const currentDirectory = getNormalizedAbsolutePath(harnessConfig?.get("currentdirectory") ?? "", srcFolder);
    const units = testContent.testUnitData;
    let toBeCompiled: TestFile[] = [];
    const otherFiles: TestFile[] = [];
    const tsConfig = testContent.tsConfig;
    const hasNonDtsFiles = units.some(unit => !fileExtensionIs(unit.name, ExtensionDts));
    const tsConfigFiles: TestFile[] = [];
    if (tsConfig !== undefined && testContent.tsConfigFileUnitData !== undefined) {
      tsConfigFiles.push(createHarnessTestFile(testContent.tsConfigFileUnitData, currentDirectory));
      for (const unit of units) {
        if (tsConfig.fileNames.includes(getNormalizedAbsolutePath(unit.name, currentDirectory))) {
          toBeCompiled.push(createHarnessTestFile(unit, currentDirectory));
        } else {
          otherFiles.push(createHarnessTestFile(unit, currentDirectory));
        }
      }
    } else {
      const baseUrl = harnessConfig?.get("baseurl");
      if (harnessConfig !== undefined && baseUrl !== undefined && !isRootedDiskPath(baseUrl)) {
        harnessConfig.set("baseurl", getNormalizedAbsolutePath(baseUrl, currentDirectory));
      }
      // The reference indexes the last unit: a case whose only unit is its config file would end it there.
      if (units.length === 0) throw new HarnessStop("runtime error: index out of range [-1]");
      const lastUnit = units[units.length - 1];
      if (
        (harnessConfig?.get("noimplicitreferences") ?? "") !== "" ||
        lastUnit.content.includes(requireStr) ||
        referencesRegex.test(lastUnit.content)
      ) {
        toBeCompiled.push(createHarnessTestFile(lastUnit, currentDirectory));
        for (const unit of units.slice(0, -1)) otherFiles.push(createHarnessTestFile(unit, currentDirectory));
      } else {
        toBeCompiled = units.map(unit => createHarnessTestFile(unit, currentDirectory));
      }
    }
    const made = compileFiles(
      toBeCompiled,
      otherFiles,
      harnessConfig,
      tsConfig,
      currentDirectory,
      testContent.symlinks,
      options.testLibFolder,
    );
    const test: CompilerTest = {
      currentDirectory,
      harnessConfig: harnessConfig ?? new Map(),
      tsConfig,
      tsConfigFiles,
      toBeCompiled,
      otherFiles,
      hasNonDtsFiles,
      ...made,
    };
    return { ok: true, value: test };
  } catch (error) {
    return refusalOf(error);
  }
}

// compiler_runner.go:569
export function createHarnessTestFile(unit: TestUnit, currentDirectory: string): TestFile {
  return { unitName: getNormalizedAbsolutePath(unit.name, currentDirectory), content: unit.content };
}

// What the disk below a directory does with names and links.
export interface Platform {
  os: typeof process.platform;
  // The disk tells a.ts from A.ts.
  caseSensitive: boolean;
  // The disk lists a name with the code points that it was made with.
  preservesNames: boolean;
  // A link to a file can be made; a link to a directory is a junction on Windows, which needs no right.
  fileLinks: boolean;
}

export interface ObstacleOptions {
  // True, the default: the check opens the absolute names in the texts on the real disk, not below the root.
  readsAbsolutePaths?: boolean;
}

const windowsBadCharacter = /[<>:"|?*\x00-\x1f]/;
const windowsReserved = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\..*)?$/i;
const referenceDirective = /<reference\s+(?:path|types|lib)\s*=\s*["']([^"']+)["']/g;
const rootedSpecifier =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+|\bmodule\s+)(["'])((?:\/|[a-zA-Z]:[\\/]|\\)[^"']*)\1/g;
const rootedJsonString = /"((?:\/|[a-zA-Z]:[\\/])[^"\n]*)"/g;

// What keeps the file system of a test from a disk, found before anything is written. The scan of the texts for absolute names is a heuristic.
export function findObstacles(test: CompilerTest, platform: Platform, options: ObstacleOptions = {}): Obstacle[] {
  const out: Obstacle[] = [];
  const links = test.fileSystem.filter(entry => entry.kind === "symlink");
  const paths = new Set<string>();
  for (const entry of test.fileSystem) paths.add(entry.path);
  for (const target of test.symlinks.values()) paths.add(target);
  for (const name of test.programFileNames) paths.add(name);
  paths.add(test.currentDirectory);
  const lower = new Map<string, string>();
  for (const p of paths) {
    const root = p.slice(0, getRootLength(p));
    if (root !== "/") {
      out.push({ reason: /^[a-zA-Z]:/.test(root) ? "dos-root" : "other-root", detail: p });
      continue;
    }
    if (p.includes("\0")) out.push({ reason: "null-character", detail: p });
    if (!platform.preservesNames && (p.normalize("NFC") !== p || p.normalize("NFD") !== p)) {
      out.push({ reason: "unicode-normalisation", detail: p });
    }
    const segments = p.slice(1).split("/");
    if (platform.os === "win32") {
      for (const segment of segments) {
        if (windowsBadCharacter.test(segment) || windowsReserved.test(segment) || /[. ]$/.test(segment)) {
          out.push({ reason: "windows-name", detail: p });
        }
      }
    }
    if (!platform.caseSensitive) {
      let prefix = "";
      for (const segment of segments) {
        prefix += "/" + segment;
        const other = lower.get(prefix.toLowerCase());
        if (other !== undefined && other !== prefix)
          out.push({ reason: "case-collision", detail: `${other} and ${prefix}` });
        else lower.set(prefix.toLowerCase(), prefix);
      }
    }
  }
  if (!test.harnessOptions.useCaseSensitiveFileNames && platform.caseSensitive) {
    out.push({ reason: "case-insensitive-requested", detail: "" });
  }
  for (const entry of test.fileSystem) {
    if (entry.kind === "dir") continue;
    const above = links.find(link => entry.path.length > link.path.length && entry.path.startsWith(link.path + "/"));
    if (above !== undefined) out.push({ reason: "entry-below-link", detail: `${entry.path} below ${above.path}` });
  }
  if (!platform.fileLinks) {
    for (const link of links) {
      if (linkKind(test.fileSystem, link.path) === "file")
        out.push({ reason: "link-not-permitted", detail: link.path });
    }
  }
  if (options.readsAbsolutePaths ?? true) {
    for (const file of [...test.toBeCompiled, ...test.otherFiles]) {
      if (/\.json$/i.test(file.unitName)) {
        for (const m of file.content.matchAll(rootedJsonString)) {
          out.push({ reason: "absolute-path-in-text", detail: `${file.unitName}: ${m[1]}` });
        }
        continue;
      }
      for (const m of file.content.matchAll(referenceDirective)) {
        if (getRootLength(normalizeSlashes(m[1])) > 0) {
          out.push({ reason: "absolute-path-in-text", detail: `${file.unitName}: ${m[1]}` });
        }
      }
      for (const m of file.content.matchAll(rootedSpecifier)) {
        out.push({ reason: "absolute-path-in-text", detail: `${file.unitName}: ${m[2]}` });
      }
    }
  }
  return out;
}

const maxLinkDepth = 64;

// What a link leads to: a link to a link is followed, and so is a path below a link.
function linkKind(fileSystem: readonly FileSystemEntry[], path: string): "file" | "dir" | undefined {
  const byPath = new Map(fileSystem.map(entry => [entry.path, entry]));
  for (let steps = 0; steps < maxLinkDepth; steps++) {
    const entry = byPath.get(path);
    if (entry?.kind === "symlink") {
      path = entry.target;
      continue;
    }
    if (entry !== undefined) return entry.kind;
    const above = fileSystem.find(e => e.kind === "symlink" && path.startsWith(e.path + "/"));
    if (above === undefined || above.kind !== "symlink") return undefined;
    path = above.target + path.slice(above.path.length);
  }
  return undefined;
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

const platforms = new Map<string, Platform>();

// Probes the disk below a directory, once for each directory. It leaves nothing behind.
export function probePlatform(directory: string): Platform {
  let platform = platforms.get(directory);
  if (platform !== undefined) return platform;
  mkdirSync(directory, { recursive: true });
  const probe = mkdtempSync(join(directory, ".probe-"));
  try {
    writeFileSync(join(probe, "Case"), "");
    const caseSensitive = !exists(join(probe, "case"));
    writeFileSync(join(probe, "\u00e9"), "");
    const preservesNames = readdirSync(probe).includes("\u00e9") && !exists(join(probe, "e\u0301"));
    let fileLinks = true;
    try {
      symlinkSync(join(probe, "Case"), join(probe, "link"), "file");
    } catch {
      fileLinks = false;
    }
    platform = { os: process.platform, caseSensitive, preservesNames, fileLinks };
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
  platforms.set(directory, platform);
  return platform;
}

const projectFileNames = ["node_modules", "package.json", "tsconfig.json", "jsconfig.json"];
const ancestors = new Map<string, string | undefined>();

// A file that a resolver finds on its way up from the root of an instance, where the instance has nothing.
export function ancestorProjectFile(directory: string): string | undefined {
  if (ancestors.has(directory)) return ancestors.get(directory);
  let found: string | undefined;
  for (let dir = resolve(directory); found === undefined; dir = dirname(dir)) {
    found = projectFileNames.map(name => join(dir, name)).find(exists);
    if (dirname(dir) === dir) break;
  }
  ancestors.set(directory, found);
  return found;
}

const libFolders = new Map<string, TestLibFolder | undefined>();

// harnessutil.go:267: the files of a copy of tests/lib, read once. undefined: there is no such directory.
export function readTestLibFolder(libDirectory: string): TestLibFolder | undefined {
  if (libFolders.has(libDirectory)) return libFolders.get(libDirectory);
  let folder: Map<string, Uint8Array> | undefined = new Map();
  const walk = (directory: string, prefix: string, into: Map<string, Uint8Array>) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(directory, entry.name), prefix + entry.name + "/", into);
      else into.set(prefix + entry.name, readFileSync(join(directory, entry.name)));
    }
  };
  try {
    walk(libDirectory, "", folder);
  } catch {
    folder = undefined;
  }
  libFolders.set(libDirectory, folder);
  return folder;
}

// The real path of a name of an instance below the directory that stands for its "/".
export function toRealPath(root: string, virtualName: string): string {
  if (virtualName === "/" || virtualName === "") return root;
  return root + (sep === "/" ? virtualName : virtualName.replaceAll("/", sep));
}

let spellingsOf: { root: string; spellings: string[] } | undefined;

// The ways a process prints the root: as given and with links resolved. Longest first, with forward slashes.
function rootSpellings(root: string): string[] {
  if (spellingsOf?.root === root) return spellingsOf.spellings;
  const spellings = [normalizeSlashes(root)];
  try {
    const real = normalizeSlashes(realpathSync.native(root));
    if (real !== spellings[0]) spellings.push(real);
    spellings.sort((a, b) => b.length - a.length);
    spellingsOf = { root, spellings };
  } catch {}
  return spellings;
}

// Windows prints a path with either separator and in any case of its ASCII letters. The length stays.
function foldPath(text: string): string {
  if (sep === "/") return text;
  return text.replace(/[A-Z\\]/g, c => (c === "\\" ? "/" : c.toLowerCase()));
}

// The harness name of a path that a process printed, absolute below the root or relative to the current directory; undefined elsewhere.
export function toVirtualName(root: string, currentDirectory: string, printedPath: string): string | undefined {
  const path = normalizeSlashes(printedPath);
  const folded = foldPath(path);
  for (const spelling of rootSpellings(root)) {
    if (!folded.startsWith(foldPath(spelling))) continue;
    const rest = path.slice(spelling.length);
    if (rest === "") return "/";
    if (rest[0] === "/") return getNormalizedAbsolutePath(rest, "/");
  }
  if (getRootLength(path) !== 0) return undefined;
  return getNormalizedAbsolutePath(path, currentDirectory);
}

const nameCharacter = /[\p{L}\p{N}_$~.-]/u;

// A text with every real path below the root as the harness names it; on Windows the separators of such a path turn.
export function mapRealPaths(root: string, text: string): string {
  for (const spelling of rootSpellings(root)) {
    const needle = foldPath(spelling);
    let from = 0;
    for (;;) {
      const at = foldPath(text).indexOf(needle, from);
      if (at < 0) break;
      let end = at + needle.length;
      const next = text[end] ?? "";
      const separator = next === "/" || (sep === "\\" && next === "\\");
      const before = at === 0 ? "" : text[at - 1];
      // A longer name that starts or ends like the root is another directory.
      if ((!separator && nameCharacter.test(next)) || before === "/" || nameCharacter.test(before)) {
        from = at + 1;
        continue;
      }
      let tail = "";
      if (separator && sep === "\\") {
        // No name of Windows holds one of these characters; a line and a column follow a name after "(" or ":".
        while (end < text.length && !/['"<>|?*\r\n\t:]/.test(text[end]) && !/^\(\d/.test(text.slice(end, end + 2))) {
          tail += text[end] === "\\" ? "/" : text[end];
          end++;
        }
      }
      const replacement = separator ? tail : "/" + tail;
      text = text.slice(0, at) + replacement + text.slice(end);
      from = at + replacement.length;
    }
  }
  return text;
}

// The fields of CheckInput of run.ts besides the instance and the root; names as the harness has them.
export interface InstanceInput {
  currentDirectory: string;
  // The file names of the program in order: roots that are no .json and no .tsbuildinfo, then the files of @libFiles.
  rootFiles: string[];
  otherFiles: string[];
  // The sections of a baseline in order: configuration file, roots, other files.
  units: TestFile[];
  symlinks: { path: string; target: string }[];
  // The configuration as the harness compiles it: names in lower case, values as written but for a relative baseUrl.
  options: Record<string, string>;
}

export function inputOf(test: CompilerTest): InstanceInput {
  return {
    currentDirectory: test.currentDirectory,
    rootFiles: test.programFileNames.slice(),
    otherFiles: test.otherFiles.map(file => file.unitName),
    units: [...test.tsConfigFiles, ...test.toBeCompiled, ...test.otherFiles],
    symlinks: [...test.symlinks].map(([path, target]) => ({ path, target })),
    options: Object.fromEntries(test.harnessConfig),
  };
}

export interface MaterialiseOptions extends ObstacleOptions {
  // What the disk below the root does. Absent: the parent directory of the root is probed.
  platform?: Platform;
}

export interface Materialised {
  // The directory that stands for "/" of the instance.
  root: string;
  // Real path of the current directory; it exists.
  currentDirectory: string;
  // Real paths of the file names of the program, in order.
  rootFiles: string[];
}

function obstacleOf(error: unknown, path: string, link: boolean): Obstacle {
  const code = String((error as { code?: unknown } | null)?.code ?? error);
  if (code === "ENAMETOOLONG") return { reason: "path-too-long", detail: path };
  if (link && code !== "EEXIST" && code !== "ENOENT")
    return { reason: "link-not-permitted", detail: `${path}: ${code}` };
  return { reason: "write-failed", detail: `${path}: ${code}` };
}

// Writes the file system of a test below root, which is absent or empty. A test that the disk cannot hold is unsupported and leaves nothing.
export function materialise(test: CompilerTest, root: string, options: MaterialiseOptions = {}): Result<Materialised> {
  const parent = dirname(resolve(root));
  let platform = options.platform;
  try {
    platform ??= probePlatform(parent);
  } catch (error) {
    return unsupported([obstacleOf(error, parent, false)]);
  }
  const obstacles = findObstacles(test, platform, options);
  const above = ancestorProjectFile(parent);
  if (above !== undefined) obstacles.push({ reason: "ancestor-has-project-files", detail: above });
  if (obstacles.length > 0) return unsupported(obstacles);
  let at = root;
  let link = false;
  try {
    mkdirSync(root, { recursive: true });
    for (const entry of test.fileSystem) {
      at = toRealPath(root, entry.path);
      if (entry.kind === "dir") mkdirSync(at, { recursive: true });
      else if (entry.kind === "file") writeFileSync(at, entry.data);
    }
    link = true;
    for (const entry of test.fileSystem) {
      if (entry.kind !== "symlink") continue;
      at = toRealPath(root, entry.path);
      const kind = linkKind(test.fileSystem, entry.path);
      // An absolute target: a junction takes no other, and a relative one would move with its link.
      symlinkSync(toRealPath(root, entry.target), at, kind === "file" ? "file" : sep === "\\" ? "junction" : "dir");
    }
    link = false;
    at = toRealPath(root, test.currentDirectory);
    mkdirSync(at, { recursive: true });
  } catch (error) {
    removeInstanceDirectory(root);
    return unsupported([obstacleOf(error, at, link)]);
  }
  const rootFiles = test.programFileNames.map(name => toRealPath(root, getNormalizedAbsolutePath(name, "/")));
  return { ok: true, value: { root, currentDirectory: at, rootFiles } };
}

// Removes the directory of an instance after its check. It does not throw.
export function removeInstanceDirectory(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}
}

// A new directory for instances below the directory of temporary files, with its links resolved.
export function makeTemporaryDirectory(prefix = "bun-lint-conformance-"): string {
  return mkdtempSync(join(realpathSync.native(tmpdir()), prefix));
}

export interface InstanceInputOptions extends MaterialiseOptions {
  // A copy of tests/lib, which an instance that mounts /.lib needs.
  libDirectory?: string;
  resolveExtendedConfig?: ResolveExtendedConfig;
}

export type InstanceInputResult =
  | { ok: true; input: InstanceInput; test: CompilerTest; materialised: Materialised | undefined }
  | Refusal;

// The input of an instance of a parsed case, for the input option of run.ts. With a root the files are written; the caller removes it.
export function instanceInput(
  parsed: ParsedTestFiles,
  configuration: Settings | undefined,
  root: string | undefined,
  options: InstanceInputOptions = {},
): InstanceInputResult {
  try {
    const content = makeTestCaseContent(parsed, options.resolveExtendedConfig);
    if (!content.ok) return content;
    const libFolder = options.libDirectory === undefined ? undefined : readTestLibFolder(options.libDirectory);
    const made = newCompilerTest(content.value, configuration, { testLibFolder: libFolder });
    if (!made.ok) return made;
    let materialised: Materialised | undefined;
    if (root !== undefined) {
      const written = materialise(made.value, root, options);
      if (!written.ok) return written;
      materialised = written.value;
    }
    return { ok: true, input: inputOf(made.value), test: made.value, materialised };
  } catch (error) {
    return refusalOf(error);
  }
}
