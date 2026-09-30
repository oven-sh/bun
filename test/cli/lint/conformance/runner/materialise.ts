// The input side of newCompilerTest (compiler_runner.go) and CompileFilesEx (harnessutil.go) of typescript-go 89d5d5b, and the writer of an instance to disk.
//
// The writer puts the units of an instance below a directory: the file system of the program as the reference makes it, and beside it the
// config file of the instance, which the reference reads before and keeps out of that file system (Materialised.configFiles).
//
// Where the reference decides in code that is not ported here, the instance is refused as unsupported with the reason, and nothing is
// guessed. These deviations from the reference remain:
// - config-not-json: a config file whose text is not JSON with comments and trailing commas. The reference reads a config file with the
//   parser of TypeScript, which recovers from any text and goes on with the tree that it made; that recovery is not ported.
// - config-content-mappers: a config file with content mappers in a case that runs external code. The reference then looks the packages
//   of the mappers up and adds their extensions to those of the file names (tsconfigparsing.go:1430); that lookup is not ported. Without
//   the flag the reference drops the mappers, and so does the port.
// - config-extends-package: an "extends" that is resolved like a module, where "exports" or "imports" of a package.json has more than
//   twelve keys with a "*" or a last "/" and two keys of one rank match the name. The reference sorts the keys with slices.SortFunc, which
//   keeps the order of such keys up to twelve keys only; its order beyond is not ported. resolveConfig resolves every other such "extends".
// - path-too-long, where no name is too long for the disk: directories, the JSON of a config or the targets of imports of a package.json
//   nest deeper than the stack of the port, which is less deep than the one of the reference.
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
  ExtensionCjs,
  ExtensionCts,
  ExtensionDcts,
  ExtensionDmts,
  ExtensionDts,
  ExtensionJs,
  ExtensionJson,
  ExtensionJsx,
  ExtensionMjs,
  ExtensionMts,
  ExtensionTs,
  ExtensionTsBuildInfo,
  ExtensionTsx,
  SupportedTSExtensions,
  SupportedTSExtensionsWithJson,
  changeExtension,
  combinePaths,
  comparePaths,
  containsPath,
  convertToRelativePath,
  ensureTrailingDirectorySeparator,
  fileExtensionIs,
  fileExtensionIsOneOf,
  getBaseFileName,
  getCanonicalFileName,
  getComparer,
  getDirectoryPath,
  getNormalizedAbsolutePath,
  getNormalizedPathComponents,
  getPathComponents,
  getPathComponentsRelativeTo,
  getPathFromPathComponents,
  getRootLength,
  hasExtension,
  hasTrailingDirectorySeparator,
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
  // The port walks directories, JSON and the targets of imports by recursion: what nests deeper than its stack is beyond it.
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

// Stands in for module.ResolveConfig on an "extends" that is resolved like a module: the file name, "" when it does not resolve.
// undefined leaves the name to resolveConfig below, the port of that function, which is what resolves it when no such function is given.
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

// A value of a package.json as packagejson.JSONValue holds it (jsonvalue.go:41); a value that is not present is undefined here.
// The number of a number is not kept: no lookup reads it, and IsFalsy (jsonvalue.go:57) compares it as a float64 with an int, which never holds.
type PackageValue =
  | { kind: "null" | "number" }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "array"; elements: PackageValue[] }
  | { kind: "object"; entries: Map<string, PackageValue> };

// The fields of a package.json that the lookup of a config reads (packagejson.go:8 and :14).
interface PackageFields {
  // The string of "name" and the one of "tsconfig"; undefined: the field is absent or holds no string.
  name: string | undefined;
  tsconfig: string | undefined;
  typesVersions: PackageValue | undefined;
  imports: PackageValue | undefined;
  exports: PackageValue | undefined;
}

// packagejson/cache.go:123 for a package.json that is there
interface PackageInfo {
  packageDirectory: string;
  contents: PackageFields;
}

// jsontext of go-json-experiment, which reads a package.json for the reference, opens no more arrays and objects inside one another (state.go:53).
const maxPackageJsonDepth = 10000;

// The JSON of jsontext: RFC 8259 and nothing beside it, and a surrogate in an escape only as one of a pair. undefined for any other text.
// The text of a unit is UTF-8, so no byte of a file of the host is outside it.
function parseJson(text: string): JsonNode | undefined {
  let i = 0;
  const skip = (): void => {
    while (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n") i++;
  };
  const string = (): string | undefined => {
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (i >= text.length) return undefined;
    i++;
    try {
      const value: unknown = JSON.parse(text.slice(start, i));
      return typeof value === "string" && value.isWellFormed() ? value : undefined;
    } catch {
      return undefined;
    }
  };
  // The depth is the count of the arrays and objects that are open.
  const value = (depth: number): JsonNode | undefined => {
    const c = text[i];
    if (c === "{") {
      if (depth >= maxPackageJsonDepth) return undefined;
      i++;
      const properties: { key: string; value: JsonNode }[] = [];
      skip();
      if (text[i] === "}") {
        i++;
        return { kind: "object", properties };
      }
      for (;;) {
        if (text[i] !== '"') return undefined;
        const key = string();
        if (key === undefined) return undefined;
        skip();
        if (text[i] !== ":") return undefined;
        i++;
        skip();
        const v = value(depth + 1);
        if (v === undefined) return undefined;
        properties.push({ key, value: v });
        skip();
        if (text[i] === "}") {
          i++;
          return { kind: "object", properties };
        }
        if (text[i] !== ",") return undefined;
        i++;
        skip();
      }
    }
    if (c === "[") {
      if (depth >= maxPackageJsonDepth) return undefined;
      i++;
      const elements: JsonNode[] = [];
      skip();
      if (text[i] === "]") {
        i++;
        return { kind: "array", elements };
      }
      for (;;) {
        const v = value(depth + 1);
        if (v === undefined) return undefined;
        elements.push(v);
        skip();
        if (text[i] === "]") {
          i++;
          return { kind: "array", elements };
        }
        if (text[i] !== ",") return undefined;
        i++;
        skip();
      }
    }
    if (c === '"') {
      const s = string();
      return s === undefined ? undefined : { kind: "string", value: s };
    }
    jsonNumber.lastIndex = i;
    const number = jsonNumber.exec(text);
    if (number !== null) {
      i += number[0].length;
      return { kind: "number", value: Number(number[0]) };
    }
    for (const word of ["true", "false", "null"] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return { kind: word };
      }
    }
    return undefined;
  };
  skip();
  const root = value(0);
  skip();
  return i === text.length ? root : undefined;
}

// jsonvalue.go:125; undefined for a number beyond float64, an error that ends the reading of the whole text
function toPackageValue(node: JsonNode): PackageValue | undefined {
  switch (node.kind) {
    case "null":
      return { kind: "null" };
    case "true":
    case "false":
      return { kind: "boolean", value: node.kind === "true" };
    case "string":
      return { kind: "string", value: node.value };
    case "number":
      return Number.isFinite(node.value) ? { kind: "number" } : undefined;
    case "array": {
      const elements: PackageValue[] = [];
      for (const element of node.elements) {
        const converted = toPackageValue(element);
        if (converted === undefined) return undefined;
        elements.push(converted);
      }
      return { kind: "array", elements };
    }
    case "object": {
      // collections/ordered_map.go:60: a name that comes again keeps its place and takes the later value
      const entries = new Map<string, PackageValue>();
      for (const property of node.properties) {
        const converted = toPackageValue(property.value);
        if (converted === undefined) return undefined;
        entries.set(property.key, converted);
      }
      return { kind: "object", entries };
    }
  }
}

const noPackageFields: PackageFields = {
  name: undefined,
  tsconfig: undefined,
  typesVersions: undefined,
  imports: undefined,
  exports: undefined,
};

// packagejson.go:127: a text that json.Unmarshal gives an error for leaves a package without a field, as does one that is null.
// The names of the fields are matched as they are written, and a name may come again.
function parsePackageJson(text: string): PackageFields {
  const root = parseJson(text);
  if (root === undefined || root.kind !== "object") return noPackageFields;
  const fields = { ...noPackageFields };
  // The kind of the Go value that a field holds from the last time that its name came
  const held = new Map<string, PackageValue["kind"]>();
  for (const { key, value } of root.properties) {
    if (key === "name" || key === "tsconfig") {
      // expected.go:16: a string makes the field valid, null empties it, and a value of any other type leaves it as it is
      if (value.kind === "string") fields[key] = value.value;
      else if (value.kind === "null") fields[key] = undefined;
    } else if (key === "typesVersions" || key === "imports" || key === "exports") {
      const converted = toPackageValue(value);
      if (converted === undefined) return noPackageFields;
      // jsonvalue.go:136, :165 and :170 decode a string, a boolean and a number into the value that the field holds, and a held
      // value of another type is an error. null, an array and an object take the place of what is held.
      const before = held.get(key);
      const scalar = converted.kind === "string" || converted.kind === "boolean" || converted.kind === "number";
      if (scalar && before !== undefined && before !== converted.kind) return noPackageFields;
      if (converted.kind === "null") held.delete(key);
      else held.set(key, converted.kind);
      fields[key] = converted;
    }
  }
  return fields;
}

// jsonvalue.go:50
function isFalsy(value: PackageValue | undefined): boolean {
  if (value === undefined || value.kind === "null") return true;
  if (value.kind === "string") return value.value === "";
  return value.kind === "boolean" && !value.value;
}

// exportsorimports.go:58
function objectKind(entries: ReadonlyMap<string, PackageValue>): "subpaths" | "imports" | "conditions" | "invalid" {
  let seenDot = false;
  let seenHash = false;
  let seenOther = false;
  for (const key of entries.keys()) {
    if (key.length === 0) continue;
    seenDot ||= key[0] === ".";
    seenHash ||= key[0] === "#";
    seenOther ||= key[0] !== "." && key[0] !== "#";
    if (seenOther && (seenDot || seenHash)) return "invalid";
  }
  return seenDot ? "subpaths" : seenHash ? "imports" : "conditions";
}

// len of a Go string
function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

// semver/version.go:44 without the build, which has no part in the order of versions
interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface VersionComparator {
  operator: string;
  operand: Version;
}

// core/version.go:8 as semver.MustParse reads it (module/util.go:13, packagejson/cache.go:13)
const typeScriptVersion: Version = { major: 7, minor: 1, patch: 0, prerelease: ["dev"] };

// semver/version_range.go:28, :33 and :41, and version.go:42. \s of Go is [\t\n\f\r ], and its (?i) folds as the flags i and u do together.
const partialRegExp =
  /^([x*0]|[1-9][0-9]*)(?:\.([x*0]|[1-9][0-9]*)(?:\.([x*0]|[1-9][0-9]*)(?:-([a-z0-9\-.]+))?(?:\+([a-z0-9\-.]+))?)?)?$/iu;
const hyphenRegExp = /^[\t\n\f\r ]*([a-z0-9\-+.*]+)[\t\n\f\r ]+-[\t\n\f\r ]+([a-z0-9\-+.*]+)[\t\n\f\r ]*$/iu;
const rangeRegExp = /^([~^<>=]|<=|>=)?[\t\n\f\r ]*([a-z0-9\-+.*]+)$/iu;
const numericIdentifierRegExp = /^(?:0|[1-9][0-9]*)$/;

// version.go:271 for digits; undefined for a number beyond uint32
function getUintComponent(text: string): number | undefined {
  const n = Number(text);
  return n <= 0xffffffff ? n : undefined;
}

// version.go:56, :62 and :69: the numbers are uint32
function incrementMajor(v: Version): Version {
  return { major: (v.major + 1) >>> 0, minor: 0, patch: 0, prerelease: [] };
}

function incrementMinor(v: Version): Version {
  return { major: v.major, minor: (v.minor + 1) >>> 0, patch: 0, prerelease: [] };
}

function incrementPatch(v: Version): Version {
  return { major: v.major, minor: v.minor, patch: (v.patch + 1) >>> 0, prerelease: [] };
}

// version.go:83
function compareVersions(a: Version, b: Version): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    comparePreReleaseIdentifiers(a.prerelease, b.prerelease)
  );
}

// version.go:123
function comparePreReleaseIdentifiers(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0) return right.length === 0 ? 0 : 1;
  if (right.length === 0) return -1;
  for (let i = 0; i < left.length && i < right.length; i++) {
    const result = comparePreReleaseIdentifier(left[i], right[i]);
    if (result !== 0) return result;
  }
  return left.length - right.length;
}

// version.go:143
function comparePreReleaseIdentifier(left: string, right: string): number {
  const compareResult = compareStrings(left, right);
  if (compareResult === 0) return 0;
  const leftIsNumeric = numericIdentifierRegExp.test(left);
  const rightIsNumeric = numericIdentifierRegExp.test(right);
  if (!leftIsNumeric && !rightIsNumeric) return compareResult;
  if (!rightIsNumeric) return -1;
  if (!leftIsNumeric) return 1;
  const leftAsNumber = getUintComponent(left);
  const rightAsNumber = getUintComponent(right);
  if (leftAsNumber === undefined || rightAsNumber === undefined) return left.length - right.length || compareResult;
  return leftAsNumber - rightAsNumber;
}

// version_range.go:436
function isWildcard(text: string): boolean {
  return text === "*" || text === "x" || text === "X";
}

// version_range.go:243; undefined for a text that is no partial version
function parsePartial(
  text: string,
): { version: Version; majorStr: string; minorStr: string; patchStr: string } | undefined {
  const match = partialRegExp.exec(text);
  if (match === null) return undefined;
  const majorStr = match[1];
  const minorStr = match[2] || "*";
  const patchStr = match[3] || "*";
  const version: Version = { major: 0, minor: 0, patch: 0, prerelease: match[4] ? match[4].split(".") : [] };
  if (!isWildcard(majorStr)) {
    const major = getUintComponent(majorStr);
    if (major === undefined) return undefined;
    version.major = major;
    if (!isWildcard(minorStr)) {
      const minor = getUintComponent(minorStr);
      if (minor === undefined) return undefined;
      version.minor = minor;
      if (!isWildcard(patchStr)) {
        const patch = getUintComponent(patchStr);
        if (patch === undefined) return undefined;
        version.patch = patch;
      }
    }
  }
  return { version, majorStr, minorStr, patchStr };
}

// version_range.go:188
function parseHyphen(left: string, right: string): VersionComparator[] | undefined {
  const leftResult = parsePartial(left);
  if (leftResult === undefined) return undefined;
  const rightResult = parsePartial(right);
  if (rightResult === undefined) return undefined;
  const comparators: VersionComparator[] = [];
  if (!isWildcard(leftResult.majorStr)) comparators.push({ operator: ">=", operand: leftResult.version });
  if (!isWildcard(rightResult.majorStr)) {
    if (isWildcard(rightResult.minorStr)) {
      comparators.push({ operator: "<", operand: incrementMajor(rightResult.version) });
    } else if (isWildcard(rightResult.patchStr)) {
      comparators.push({ operator: "<", operand: incrementMinor(rightResult.version) });
    } else {
      comparators.push({ operator: "<=", operand: rightResult.version });
    }
  }
  return comparators;
}

// version_range.go:321
function parseComparator(operator: string, text: string): VersionComparator[] | undefined {
  const result = parsePartial(text);
  if (result === undefined) return undefined;
  const { version, majorStr, minorStr, patchStr } = result;
  const withZero = (v: Version): Version => ({ ...v, prerelease: ["0"] });
  if (isWildcard(majorStr)) {
    // < 0.0.0-0
    if (operator !== "<" && operator !== ">") return [];
    return [{ operator: "<", operand: { major: 0, minor: 0, patch: 0, prerelease: ["0"] } }];
  }
  switch (operator) {
    case "~":
      return [
        { operator: ">=", operand: version },
        { operator: "<", operand: isWildcard(minorStr) ? incrementMajor(version) : incrementMinor(version) },
      ];
    case "^": {
      const next =
        version.major > 0 || isWildcard(minorStr)
          ? incrementMajor(version)
          : version.minor > 0 || isWildcard(patchStr)
            ? incrementMinor(version)
            : incrementPatch(version);
      return [
        { operator: ">=", operand: version },
        { operator: "<", operand: next },
      ];
    }
    case "<":
    case ">=":
      return [{ operator, operand: isWildcard(minorStr) || isWildcard(patchStr) ? withZero(version) : version }];
    case "<=":
    case ">": {
      const other = operator === "<=" ? "<" : ">=";
      if (isWildcard(minorStr)) return [{ operator: other, operand: withZero(incrementMajor(version)) }];
      if (isWildcard(patchStr)) return [{ operator: other, operand: withZero(incrementMinor(version)) }];
      return [{ operator, operand: version }];
    }
    default:
      // "=" and no operator
      if (!isWildcard(minorStr) && !isWildcard(patchStr)) return [{ operator: "=", operand: version }];
      return [
        { operator: ">=", operand: withZero(version) },
        {
          operator: "<",
          operand: withZero(isWildcard(minorStr) ? incrementMajor(version) : incrementMinor(version)),
        },
      ];
  }
}

// version_range.go:143 and :148; undefined for a text that is no range
function parseVersionRange(text: string): VersionComparator[][] | undefined {
  const alternatives: VersionComparator[][] = [];
  for (let range of trimSpace(text).split("||")) {
    range = trimSpace(range);
    if (range === "") continue;
    const comparators: VersionComparator[] = [];
    const hyphenMatch = hyphenRegExp.exec(range);
    if (hyphenMatch !== null) {
      const parsed = parseHyphen(hyphenMatch[1], hyphenMatch[2]);
      if (parsed === undefined) return undefined;
      comparators.push(...parsed);
    } else {
      for (const simple of range.split(/[\t\n\f\r ]+/)) {
        const match = rangeRegExp.exec(trimSpace(simple));
        if (match === null) return undefined;
        const parsed = parseComparator(match[1] ?? "", match[2]);
        if (parsed === undefined) return undefined;
        comparators.push(...parsed);
      }
    }
    alternatives.push(comparators);
  }
  return alternatives;
}

// version_range.go:97: whether the range holds the version of the reference
function testVersionRange(alternatives: readonly VersionComparator[][]): boolean {
  if (alternatives.length === 0) return true;
  return alternatives.some(alternative =>
    alternative.every(({ operator, operand }) => {
      const cmp = compareVersions(typeScriptVersion, operand);
      if (operator === "<") return cmp < 0;
      if (operator === "<=") return cmp <= 0;
      if (operator === "=") return cmp === 0;
      return operator === ">=" ? cmp >= 0 : cmp > 0;
    }),
  );
}

// module/util.go:17
function isApplicableVersionedTypesKey(key: string): boolean {
  if (!key.startsWith("types@")) return false;
  const range = parseVersionRange(key.slice("types@".length));
  return range !== undefined && testVersionRange(range);
}

// packagejson/cache.go:28 with :94 and :98: the paths of the first entry of "typesVersions" whose range holds the version; undefined for none
function getVersionPaths(fields: PackageFields): Map<string, string[]> | undefined {
  if (fields.typesVersions?.kind !== "object") return undefined;
  for (const [key, value] of fields.typesVersions.entries) {
    const range = parseVersionRange(key);
    if (range === undefined || !testVersionRange(range)) continue;
    // An empty key holds every version and ends the search, and an entry without a version does not count.
    if (value.kind !== "object" || key === "") return undefined;
    const paths = new Map<string, string[]>();
    for (const [pattern, substitutions] of value.entries) {
      if (substitutions.kind !== "array") continue;
      paths.set(
        pattern,
        substitutions.elements.map(path => (path.kind === "string" ? path.value : "")),
      );
    }
    return paths;
  }
  return undefined;
}

// module/resolver.go:2011 and :2046 over core/pattern.go: the key that a name takes among the keys of a map of paths, and what its "*" stands for
function matchPatternOrExact(keys: Iterable<string>, candidate: string): { text: string; star: string } | undefined {
  let best: { text: string; star: string } | undefined;
  let longestMatchPrefixLength = -1;
  for (const text of keys) {
    const starIndex = text.indexOf("*");
    if (starIndex < 0) {
      if (text === candidate) return { text, star: "" };
      continue;
    }
    // A key with a second "*" is no pattern.
    if (text.includes("*", starIndex + 1)) continue;
    const prefix = text.slice(0, starIndex);
    const suffix = text.slice(starIndex + 1);
    if (byteLength(prefix) <= longestMatchPrefixLength) continue;
    if (candidate.length < text.length - 1 || !candidate.startsWith(prefix) || !candidate.endsWith(suffix)) continue;
    best = { text, star: candidate.slice(prefix.length, candidate.length - suffix.length) };
    longestMatchPrefixLength = byteLength(prefix);
  }
  return best;
}

// tspath/extension.go:43
const extensionsToRemove = [
  ExtensionDts,
  ExtensionDmts,
  ExtensionDcts,
  ExtensionMjs,
  ExtensionMts,
  ExtensionCjs,
  ExtensionCts,
  ExtensionTs,
  ExtensionJs,
  ExtensionTsx,
  ExtensionJsx,
  ExtensionJson,
];

// tspath/extension.go:45
function removeFileExtension(path: string): string {
  for (const ext of extensionsToRemove) if (path.endsWith(ext)) return path.slice(0, path.length - ext.length);
  return path;
}

// tspath/extension.go:66
function tryGetExtensionFromPath(path: string): string {
  return extensionsToRemove.find(ext => fileExtensionIs(path, ext)) ?? "";
}

// tspath/path.go:954
function pathIsRelative(path: string): boolean {
  return /^\.\.?(?:$|[\\/])/.test(path);
}

// tspath/path.go:981
function isExternalModuleNameRelative(moduleName: string): boolean {
  return pathIsRelative(moduleName) || isRootedDiskPath(moduleName);
}

// tspath/path.go:809
function getRelativePathFromDirectory(fromDirectory: string, to: string, options: ComparePathsOptions): string {
  if (getRootLength(fromDirectory) > 0 !== getRootLength(to) > 0) {
    throw new HarnessStop("paths must either both be absolute or both be relative");
  }
  return getPathFromPathComponents(getPathComponentsRelativeTo(fromDirectory, to, options));
}

// module/util.go:43
function parsePackageName(moduleName: string): [packageName: string, rest: string] {
  let idx = moduleName.indexOf("/");
  if (moduleName.startsWith("@")) {
    const offset = idx + 1;
    idx = moduleName.indexOf("/", offset);
  }
  if (idx === -1) return [moduleName, ""];
  return [moduleName.slice(0, idx), moduleName.slice(idx + 1)];
}

// module/util.go:89: below zero when a comes before b. The reference sorts by that alone, so keys of which neither comes before the other are of one rank.
function comparePatternKeys(a: string, b: string): number {
  const aPatternIndex = a.indexOf("*");
  const bPatternIndex = b.indexOf("*");
  const baseLenA = aPatternIndex === -1 ? byteLength(a) : byteLength(a.slice(0, aPatternIndex)) + 1;
  const baseLenB = bPatternIndex === -1 ? byteLength(b) : byteLength(b.slice(0, bPatternIndex)) + 1;
  if (baseLenA > baseLenB) return -1;
  if (baseLenB > baseLenA) return 1;
  if (aPatternIndex === -1) return 1;
  if (bPatternIndex === -1) return -1;
  if (byteLength(a) > byteLength(b)) return -1;
  if (byteLength(b) > byteLength(a)) return 1;
  return 0;
}

// module/resolver.go:2064
function normalizePathForCJSResolution(containingDirectory: string, moduleName: string): string {
  const combined = combinePaths(containingDirectory, moduleName);
  const parts = getPathComponents(combined, "");
  const lastPart = parts[parts.length - 1];
  if (lastPart === "." || lastPart === "..") return ensureTrailingDirectorySeparator(normalizePath(combined));
  return normalizePath(combined);
}

// module/resolver.go:20: undefined stands for a search that goes on, and an empty path for a name that is known not to resolve
interface Resolved {
  path: string;
  originalPath: string;
}

// module/resolver.go:45; the flag tells whether the extensions of the lookup hold .json, the one extension of a config
type Loader = (json: boolean, candidate: string) => Resolved | undefined;

// slices.SortFunc of Go sorts up to this many elements by insertion, which keeps the order of equal ones.
const maxInsertionSort = 12;

// module/resolver.go:2093 with :375: the file that an "extends" names when it is resolved like a module, "" for none.
// The state of this lookup in the reference is the one of node-next for a require: every feature of a package.json, the conditions
// "require", "types" and "node", no ESM mode, and .json as the one extension. Paths, root directories, suffixes and type roots come
// from compiler options that the lookup has none of. The package id of a result is read from no config, so it is not made, and the
// package.json files that only it would read stay unread: the cache by the path of a package.json hides no read that gives another answer.
function resolveConfig(moduleName: string, containingFile: string, host: ParseConfigHost): string {
  const { fs, currentDirectory } = host;
  const caseSensitive = fs.useCaseSensitiveFileNames;
  // The name and the directory of the lookup; the target of an import takes their place for a lookup of its own.
  let name = moduleName;
  let containingDirectory = getDirectoryPath(containingFile);
  const lookupKey = () => `${containingDirectory}\0${name}`;
  const active = new Set([lookupKey()]);
  const packages = new Map<string, PackageFields | undefined>();
  const found = (path: string): Resolved => ({ path, originalPath: "" });
  const unresolved: Resolved = { path: "", originalPath: "" };

  // resolver.go:1777
  const getPackageJsonInfo = (packageDirectory: string): PackageInfo | undefined => {
    const packageJsonPath = combinePaths(packageDirectory, "package.json");
    const key = toPath(packageJsonPath, currentDirectory, caseSensitive);
    if (!packages.has(key)) {
      const exists = fs.directoryExists(packageDirectory) && fs.fileExists(packageJsonPath);
      packages.set(key, exists ? parsePackageJson(readFileText(fs, packageJsonPath) ?? "") : undefined);
    }
    const contents = packages.get(key);
    return contents === undefined ? undefined : { packageDirectory, contents };
  };

  // resolver.go:501 with tspath/path.go:1101; the reference has no global cache here, whose name is ""
  const getPackageScopeForPath = (directory: string): PackageInfo | undefined => {
    for (;;) {
      const info = getPackageJsonInfo(directory);
      if (info !== undefined || directory === "") return info;
      const parent = getDirectoryPath(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  };

  // resolver.go:1586 and :1598
  const tryExtension = (extensionless: string): Resolved | undefined => {
    const fileName = extensionless + ExtensionJson;
    return fs.fileExists(fileName) ? found(fileName) : undefined;
  };

  // resolver.go:1462: a config is looked for as a .json file alone, under its own name or in the place of .ts, .d.ts, .js and no extension
  const tryAddingExtensions = (
    extensionless: string,
    json: boolean,
    originalExtension: string,
  ): Resolved | undefined => {
    const directory = getDirectoryPath(extensionless);
    if (directory !== "" && !fs.directoryExists(directory)) return undefined;
    switch (originalExtension) {
      case ExtensionJson:
        return json ? tryExtension(extensionless) : undefined;
      case ExtensionTs:
      case ExtensionDts:
      case ExtensionJs:
      case "":
        return tryExtension(extensionless);
    }
    return undefined;
  };

  // resolver.go:1440; the reference has no extra extensions here
  const loadModuleFromFileNoImplicitExtensions = (json: boolean, candidate: string): Resolved | undefined => {
    if (!getBaseFileName(candidate).includes(".")) return undefined;
    let extensionless = removeFileExtension(candidate);
    if (extensionless === candidate) extensionless = candidate.slice(0, candidate.lastIndexOf("."));
    return tryAddingExtensions(extensionless, json, candidate.slice(extensionless.length));
  };

  // resolver.go:1425
  const loadModuleFromFile: Loader = (json, candidate) =>
    loadModuleFromFileNoImplicitExtensions(json, candidate) ?? tryAddingExtensions(candidate, json, "");

  // resolver.go:1724
  const loadFileNameFromPackageJSONField: Loader = (json, candidate) => {
    if (json && fileExtensionIs(candidate, ExtensionJson) && fs.fileExists(candidate)) return found(candidate);
    return loadModuleFromFileNoImplicitExtensions(json, candidate);
  };

  // resolver.go:1388 with :1626
  const nodeLoadModuleByRelativeName = (
    json: boolean,
    candidate: string,
    considerPackageJson: boolean,
  ): Resolved | undefined => {
    if (!hasTrailingDirectorySeparator(candidate)) {
      if (!fs.directoryExists(getDirectoryPath(candidate))) return undefined;
      const resolvedFromFile = loadModuleFromFile(json, candidate);
      if (resolvedFromFile !== undefined) return resolvedFromFile;
    }
    if (!fs.directoryExists(candidate)) return undefined;
    const packageInfo = considerPackageJson ? getPackageJsonInfo(candidate) : undefined;
    return loadNodeModuleFromDirectoryWorker(json, candidate, packageInfo);
  };

  // resolver.go:1275
  const tryLoadModuleUsingPaths = (
    json: boolean,
    lookup: string,
    directory: string,
    paths: ReadonlyMap<string, string[]>,
    loader: Loader,
  ): Resolved | undefined => {
    const matched = matchPatternOrExact(paths.keys(), lookup);
    if (matched === undefined) return undefined;
    for (const subst of paths.get(matched.text) ?? []) {
      const star = subst.indexOf("*");
      const path = star < 0 ? subst : subst.slice(0, star) + matched.star + subst.slice(star + 1);
      const candidate = normalizePath(combinePaths(directory, path));
      // A substitution with an extension may name the file as it is.
      if (tryGetExtensionFromPath(subst) !== "" && fs.fileExists(candidate)) return found(candidate);
      const resolved = loader(json, candidate);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  };

  // resolver.go:1635 with :1756 and :1904: the file of a directory is the one of "tsconfig" of its package.json, then tsconfig.json
  const loadNodeModuleFromDirectoryWorker = (
    json: boolean,
    candidate: string,
    packageInfo: PackageInfo | undefined,
  ): Resolved | undefined => {
    let packageFile = "";
    let versionPaths: Map<string, string[]> | undefined;
    if (packageInfo !== undefined) {
      versionPaths = getVersionPaths(packageInfo.contents);
      const sameDirectory =
        comparePaths(candidate, packageInfo.packageDirectory, {
          useCaseSensitiveFileNames: caseSensitive,
          currentDirectory: "",
        }) === 0;
      if (sameDirectory && packageInfo.contents.tsconfig) {
        packageFile = normalizePath(combinePaths(packageInfo.packageDirectory, packageInfo.contents.tsconfig));
      }
    }
    const loader: Loader = (json, candidate) =>
      loadFileNameFromPackageJSONField(json, candidate) ?? nodeLoadModuleByRelativeName(json, candidate, false);
    const indexPath = combinePaths(candidate, "tsconfig");
    // The reference compares these paths without regard to case.
    const anyCase = { useCaseSensitiveFileNames: false, currentDirectory: "" };
    if (versionPaths !== undefined && (packageFile === "" || containsPath(candidate, packageFile, anyCase))) {
      const lookup = getRelativePathFromDirectory(candidate, packageFile !== "" ? packageFile : indexPath, anyCase);
      const result = tryLoadModuleUsingPaths(json, lookup, candidate, versionPaths, loader);
      if (result !== undefined) return result;
    }
    if (packageFile !== "") {
      const packageFileResult = loader(json, packageFile);
      if (packageFileResult !== undefined) return packageFileResult;
    }
    if (!fs.directoryExists(candidate)) return undefined;
    return loadModuleFromFile(json, indexPath);
  };

  // resolver.go:1921
  const conditionMatches = (condition: string): boolean =>
    condition === "default" ||
    condition === "require" ||
    condition === "types" ||
    condition === "node" ||
    isApplicableVersionedTypesKey(condition);

  // resolver.go:747; what the reference traces with is left out
  const loadModuleFromTargetExportOrImport = (
    json: boolean,
    scope: PackageInfo,
    isImports: boolean,
    target: PackageValue,
    subpath: string,
    isPattern: boolean,
  ): Resolved | undefined => {
    switch (target.kind) {
      case "string": {
        const targetString = target.value;
        if (!isPattern && subpath.length > 0 && !targetString.endsWith("/")) return undefined;
        if (!targetString.startsWith("./")) {
          if (
            !isImports ||
            targetString.startsWith("../") ||
            targetString.startsWith("/") ||
            isRootedDiskPath(targetString)
          ) {
            return undefined;
          }
          // The target of an import that is no path is a name, looked up from the directory of the package.
          const combinedLookup = isPattern ? targetString.split("*").join(subpath) : targetString + subpath;
          const saved = [name, containingDirectory] as const;
          [name, containingDirectory] = [combinedLookup, ensureTrailingDirectorySeparator(scope.packageDirectory)];
          const key = lookupKey();
          // A lookup that leads back to itself never ends in the reference, whose stack overflows.
          if (active.has(key)) throw new HarnessStop("fatal error: stack overflow");
          active.add(key);
          const result = resolveNodeLike();
          active.delete(key);
          [name, containingDirectory] = saved;
          return result.path !== "" ? result : undefined;
        }
        // The components after the "." of "./" and the one that follows it
        const partsAfterFirst = getPathComponents(targetString, "").slice(2);
        const invalid = (part: string) => part === ".." || part === "." || part === "node_modules";
        if (partsAfterFirst.some(invalid)) return undefined;
        const resolvedTarget = combinePaths(scope.packageDirectory, targetString);
        if (getPathComponents(subpath, "").some(invalid)) return undefined;
        const finalPath = getNormalizedAbsolutePath(
          isPattern ? resolvedTarget.split("*").join(subpath) : resolvedTarget + subpath,
          currentDirectory,
        );
        // resolver.go:895 looks for an input file of an output only when the lookup is of no config
        return loadFileNameFromPackageJSONField(json, finalPath);
      }
      case "object":
        for (const [condition, subTarget] of target.entries) {
          if (!conditionMatches(condition)) continue;
          const result = loadModuleFromTargetExportOrImport(json, scope, isImports, subTarget, subpath, isPattern);
          if (result !== undefined) return result;
        }
        return undefined;
      case "array":
        for (const element of target.elements) {
          const result = loadModuleFromTargetExportOrImport(json, scope, isImports, element, subpath, isPattern);
          if (result !== undefined) return result;
        }
        return undefined;
      case "null":
        return unresolved;
    }
    return undefined;
  };

  // resolver.go:706
  const loadModuleFromExportsOrImports = (
    json: boolean,
    lookup: string,
    lookupTable: ReadonlyMap<string, PackageValue>,
    scope: PackageInfo,
    isImports: boolean,
  ): Resolved | undefined => {
    if (!lookup.endsWith("/") && !lookup.includes("*")) {
      const target = lookupTable.get(lookup);
      if (target !== undefined) return loadModuleFromTargetExportOrImport(json, scope, isImports, target, "", false);
    }
    // 1: the key has a "*" inside it and the name has what is before and after it (resolver.go:2074). 2: the key ends with "*" and the
    // name starts with the rest of it. 3: the name starts with the key. 0: none of them.
    const matchKind = (key: string): 0 | 1 | 2 | 3 => {
      const starPos = key.indexOf("*");
      if (starPos >= 0 && !key.endsWith("*")) {
        if (lookup.startsWith(key.slice(0, starPos)) && lookup.endsWith(key.slice(starPos + 1))) return 1;
      }
      if (key.endsWith("*") && lookup.startsWith(key.slice(0, -1))) return 2;
      return lookup.startsWith(key) ? 3 : 0;
    };
    const comesBefore = (a: string, b: string) => comparePatternKeys(a, b) < 0;
    const expandingKeys = [...lookupTable.keys()]
      .filter(key => key.split("*").length === 2 || key.endsWith("/"))
      .sort((a, b) => (comesBefore(a, b) ? -1 : comesBefore(b, a) ? 1 : 0));
    for (const [at, potentialTarget] of expandingKeys.entries()) {
      const kind = matchKind(potentialTarget);
      if (kind === 0) continue;
      // Beyond that many keys slices.SortFunc leaves keys of one rank in an order that is not ported.
      for (let i = at + 1; expandingKeys.length > maxInsertionSort && i < expandingKeys.length; i++) {
        if (comesBefore(potentialTarget, expandingKeys[i])) break;
        if (matchKind(expandingKeys[i]) === 0) continue;
        throw new Undecided(
          "config-extends-package",
          `${quote(lookup)} has the keys ${quote(potentialTarget)} and ${quote(expandingKeys[i])} among ${expandingKeys.length} of a package.json, and the order in which the reference tries the two is not ported`,
        );
      }
      const target = lookupTable.get(potentialTarget)!;
      if (kind === 3) {
        const subpath = lookup.slice(potentialTarget.length);
        return loadModuleFromTargetExportOrImport(json, scope, isImports, target, subpath, false);
      }
      if (kind === 2) {
        const subpath = lookup.slice(potentialTarget.length - 1);
        return loadModuleFromTargetExportOrImport(json, scope, isImports, target, subpath, true);
      }
      const starPos = potentialTarget.indexOf("*");
      const end = lookup.length - (potentialTarget.length - 1 - starPos);
      if (starPos > end) {
        // The reference slices the name from the end of the one part to the start of the other, and panics when the two overlap.
        const low = byteLength(potentialTarget.slice(0, starPos));
        const high = byteLength(lookup) - byteLength(potentialTarget.slice(starPos + 1));
        throw new HarnessStop(`runtime error: slice bounds out of range [${low}:${high}]`);
      }
      return loadModuleFromTargetExportOrImport(json, scope, isImports, target, lookup.slice(starPos, end), true);
    }
    return undefined;
  };

  // resolver.go:673
  const loadModuleFromExports = (packageInfo: PackageInfo, json: boolean, subpath: string): Resolved | undefined => {
    const exports = packageInfo.contents.exports;
    if (exports === undefined || isFalsy(exports)) return undefined;
    if (subpath === ".") {
      let mainExport: PackageValue | undefined;
      if (exports.kind === "string" || exports.kind === "array") mainExport = exports;
      else if (exports.kind === "object") {
        mainExport = objectKind(exports.entries) === "conditions" ? exports : exports.entries.get(".");
      }
      if (mainExport === undefined) return undefined;
      return loadModuleFromTargetExportOrImport(json, packageInfo, false, mainExport, "", false);
    }
    if (exports.kind !== "object" || objectKind(exports.entries) !== "subpaths") return undefined;
    return loadModuleFromExportsOrImports(json, subpath, exports.entries, packageInfo, false);
  };

  // resolver.go:639; the lookup of node-next takes "#/" as it takes any other name of an import
  const loadModuleFromImports = (): Resolved | undefined => {
    if (name === "#") return undefined;
    const scope = getPackageScopeForPath(getNormalizedAbsolutePath(containingDirectory, currentDirectory));
    const imports = scope?.contents.imports;
    if (scope === undefined || imports?.kind !== "object") return undefined;
    return loadModuleFromExportsOrImports(true, name, imports.entries, scope, true);
  };

  // resolver.go:592
  const loadModuleFromSelfNameReference = (): Resolved | undefined => {
    const scope = getPackageScopeForPath(getNormalizedAbsolutePath(containingDirectory, currentDirectory));
    if (scope === undefined || isFalsy(scope.contents.exports) || scope.contents.name === undefined) return undefined;
    const parts = getPathComponents(name, "");
    const nameParts = getPathComponents(scope.contents.name, "");
    if (parts.length < nameParts.length || nameParts.some((part, i) => part !== parts[i])) return undefined;
    const trailingParts = parts.slice(nameParts.length);
    const subpath = trailingParts.length > 0 ? combinePaths(".", ...trailingParts) : ".";
    // Two passes, as below node_modules: the first is for the extensions of TypeScript, and a lookup of a config has none of them.
    return loadModuleFromExports(scope, false, subpath) ?? loadModuleFromExports(scope, true, subpath);
  };

  // resolver.go:1061
  const loadModuleFromSpecificNodeModulesDirectory = (nodeModulesDirectory: string): Resolved | undefined => {
    const candidate = removeTrailingDirectorySeparator(normalizePath(combinePaths(nodeModulesDirectory, name)));
    const [packageName, rest] = parsePackageName(name);
    const packageDirectory = packageName === "" ? candidate : combinePaths(nodeModulesDirectory, packageName);
    let rootPackageInfo: PackageInfo | undefined;
    // First a package.json of the name itself, as node_modules/foo/bar/package.json, unless "exports" of the package may lead around it.
    let packageInfo = getPackageJsonInfo(candidate);
    if (rest !== "" && packageInfo !== undefined) {
      rootPackageInfo = getPackageJsonInfo(packageDirectory);
      if (rootPackageInfo === undefined || rootPackageInfo.contents.exports === undefined) {
        const fromFile = loadModuleFromFile(true, candidate);
        if (fromFile !== undefined) return fromFile;
        const fromDirectory = loadNodeModuleFromDirectoryWorker(true, candidate, packageInfo);
        if (fromDirectory !== undefined) return fromDirectory;
      }
    }
    // The loader reads packageInfo when it is called: by then it is the one of the root of the package.
    const loader: Loader = (json, candidate) =>
      loadModuleFromFile(json, candidate) ?? loadNodeModuleFromDirectoryWorker(json, candidate, packageInfo);
    if (rest !== "") packageInfo = rootPackageInfo ?? getPackageJsonInfo(packageDirectory);
    if (packageInfo !== undefined) {
      if (!isFalsy(packageInfo.contents.exports)) {
        return loadModuleFromExports(packageInfo, true, combinePaths(".", rest));
      }
      const versionPaths = rest !== "" ? getVersionPaths(packageInfo.contents) : undefined;
      if (versionPaths !== undefined) {
        const fromPaths = tryLoadModuleUsingPaths(true, rest, packageDirectory, versionPaths, loader);
        if (fromPaths !== undefined) return fromPaths;
      }
    }
    return loader(true, candidate);
  };

  // resolver.go:985, :1017 and :1032: of the two passes over the directories above, a config is found in the second alone
  const loadModuleFromNearestNodeModulesDirectory = (): Resolved | undefined => {
    for (let directory = containingDirectory; ; ) {
      if (getBaseFileName(directory) !== "node_modules") {
        const nodeModulesFolder = combinePaths(directory, "node_modules");
        if (fs.directoryExists(nodeModulesFolder)) {
          const result = loadModuleFromSpecificNodeModulesDirectory(nodeModulesFolder);
          if (result !== undefined) return result;
        }
      }
      const parent = getDirectoryPath(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  };

  // resolver.go:1161 and :1216: a file below node_modules is named by its real path
  const createResolvedModuleHandlingSymlink = (resolved: Resolved): Resolved => {
    if (
      !resolved.path.includes("/node_modules/") ||
      resolved.originalPath !== "" ||
      isExternalModuleNameRelative(name)
    ) {
      return resolved;
    }
    const resolvedFileName = normalizePath(fs.realpath(resolved.path));
    const options = { useCaseSensitiveFileNames: caseSensitive, currentDirectory };
    if (comparePaths(resolved.path, resolvedFileName, options) === 0) return resolved;
    return { path: resolvedFileName, originalPath: resolved.path };
  };

  // resolver.go:515 and :548
  function resolveNodeLike(): Resolved {
    if (isExternalModuleNameRelative(name)) {
      const candidate = normalizePathForCJSResolution(containingDirectory, name);
      return nodeLoadModuleByRelativeName(true, candidate, true) ?? unresolved;
    }
    if (name.startsWith("#")) {
      const fromImports = loadModuleFromImports();
      if (fromImports !== undefined) return createResolvedModuleHandlingSymlink(fromImports);
    }
    const fromSelfName = loadModuleFromSelfNameReference();
    if (fromSelfName !== undefined) return createResolvedModuleHandlingSymlink(fromSelfName);
    // A name that looks like a URI is looked for in no node_modules.
    if (name.includes(":")) return unresolved;
    const fromNodeModules = loadModuleFromNearestNodeModulesDirectory();
    return fromNodeModules === undefined ? unresolved : createResolvedModuleHandlingSymlink(fromNodeModules);
  }

  return resolveNodeLike().path;
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
  // A path that is neither rooted nor relative is resolved like a module.
  const containingFile = combinePaths(basePath, "tsconfig.json");
  return (
    host.resolveExtendedConfig?.(extendedConfig, containingFile) ?? resolveConfig(extendedConfig, containingFile, host)
  );
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
  // The config file of the instance, none or one: the first section of a baseline, and no entry of the file system below.
  tsConfigFiles: TestFile[];
  toBeCompiled: TestFile[];
  otherFiles: TestFile[];
  hasNonDtsFiles: boolean;
  programFileNames: string[];
  includeLibDir: boolean;
  // Link to target, both absolute (harnessutil.go:208).
  symlinks: Map<string, string>;
  // The file system of the program (harnessutil.go:195): the roots, the other files, the links and the files of /.lib. Directories before what they hold.
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

// What materialise writes: the file system of the program, and the config file of the instance where that file system has nothing
// of its name. CompileFilesEx keeps the config file out of the file system (harnessutil.go:195): the reference reads it before, from the
// host of the config parser. A later unit or a link of the name of the config file is in the file system, and stays in its place.
function entriesToWrite(test: CompilerTest): { entries: FileSystemEntry[]; configFiles: TestFile[] } {
  const taken = new Set(test.fileSystem.map(entry => entry.path));
  const configFiles = test.tsConfigFiles.filter(file => !taken.has(file.unitName));
  const entries = test.fileSystem.slice();
  for (const file of configFiles) entries.push({ kind: "file", path: file.unitName, data: bytesOf(file.content) });
  return { entries, configFiles };
}

// What keeps the files of a test from a disk, found before anything is written. The scan of the texts for absolute names is a heuristic.
export function findObstacles(test: CompilerTest, platform: Platform, options: ObstacleOptions = {}): Obstacle[] {
  const out: Obstacle[] = [];
  const { entries, configFiles } = entriesToWrite(test);
  const links = test.fileSystem.filter(entry => entry.kind === "symlink");
  const paths = new Set<string>();
  for (const entry of entries) paths.add(entry.path);
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
  for (const entry of entries) {
    if (entry.kind === "dir") continue;
    const above = links.find(link => entry.path.length > link.path.length && entry.path.startsWith(link.path + "/"));
    if (above !== undefined) out.push({ reason: "entry-below-link", detail: `${entry.path} below ${above.path}` });
  }
  if (!platform.fileLinks) {
    for (const link of links) {
      if (linkKind(entries, link.path) === "file") out.push({ reason: "link-not-permitted", detail: link.path });
    }
  }
  if (options.readsAbsolutePaths ?? true) {
    // The name of a config file ends in .json, so its text is read as the text of any other .json unit.
    for (const file of [...configFiles, ...test.toBeCompiled, ...test.otherFiles]) {
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
  // The sections of a baseline in order: configuration file, roots, other files. The configuration file is no file of the program of the
  // reference: it is neither a root nor an other file, and materialise writes it beside the file system (Materialised.configFiles).
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

// What is below the root: the file system of the program as the reference makes it, and the config file of the instance beside it.
export interface Materialised {
  // The directory that stands for "/" of the instance.
  root: string;
  // Real path of the current directory; it exists.
  currentDirectory: string;
  // Real paths of the file names of the program, in order.
  rootFiles: string[];
  // Real path of the config file of the instance, which the program of the reference has no file for: its options and its file names
  // are read before the file system is made. Empty: the instance has no config file, or a later unit or a link has its name.
  configFiles: string[];
}

function obstacleOf(error: unknown, path: string, link: boolean): Obstacle {
  const code = String((error as { code?: unknown } | null)?.code ?? error);
  if (code === "ENAMETOOLONG") return { reason: "path-too-long", detail: path };
  if (link && code !== "EEXIST" && code !== "ENOENT")
    return { reason: "link-not-permitted", detail: `${path}: ${code}` };
  return { reason: "write-failed", detail: `${path}: ${code}` };
}

// Writes the units of a test below root, which is absent or empty: the file system of the program, then the config file of the instance
// where that file system has nothing of its name. A test that the disk cannot hold is unsupported and leaves nothing.
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
  const { entries, configFiles } = entriesToWrite(test);
  const written: string[] = [];
  let at = root;
  let link = false;
  try {
    mkdirSync(root, { recursive: true });
    for (const entry of test.fileSystem) {
      at = toRealPath(root, entry.path);
      if (entry.kind === "dir") mkdirSync(at, { recursive: true });
      else if (entry.kind === "file") writeFileSync(at, entry.data);
    }
    // The directory of a config file may hold no file of the program.
    for (const file of configFiles) {
      at = toRealPath(root, file.unitName);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, bytesOf(file.content));
      written.push(at);
    }
    link = true;
    for (const entry of test.fileSystem) {
      if (entry.kind !== "symlink") continue;
      at = toRealPath(root, entry.path);
      const kind = linkKind(entries, entry.path);
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
  return { ok: true, value: { root, currentDirectory: at, rootFiles, configFiles: written } };
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
