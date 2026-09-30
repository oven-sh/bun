// Port of internal/tspath (path.go, extension.go) of typescript-go 89d5d5b: the functions that the runner reaches.
import { isAscii, toLower, unicodeToLower, utf8Bytes, utf8String } from "./gostrings";
import {
  compareStringsCaseInsensitive,
  equateStringCaseInsensitive,
  getStringComparer,
  getStringEqualityComparer,
} from "./stringutil";

const urlSchemeSeparator = "://";

function isAnyDirectorySeparator(char: string): boolean {
  return char === "/" || char === "\\";
}

export function isRootedDiskPath(path: string): boolean {
  return getEncodedRootLength(path) > 0;
}

export function pathIsAbsolute(path: string): boolean {
  return getEncodedRootLength(path) !== 0;
}

export function hasTrailingDirectorySeparator(path: string): boolean {
  return path.length > 0 && isAnyDirectorySeparator(path[path.length - 1]);
}

export function combinePaths(firstPath: string, ...paths: string[]): string {
  let result = normalizeSlashes(firstPath);
  for (let trailingPath of paths) {
    if (trailingPath === "") continue;
    trailingPath = normalizeSlashes(trailingPath);
    if (result === "" || getRootLength(trailingPath) !== 0) {
      result = trailingPath;
    } else {
      if (!hasTrailingDirectorySeparator(result)) result += "/";
      result += trailingPath;
    }
  }
  return result;
}

export function getPathComponents(path: string, currentDirectory: string): string[] {
  path = combinePaths(currentDirectory, path);
  return pathComponents(path, getRootLength(path));
}

function pathComponents(path: string, rootLength: number): string[] {
  const root = path.slice(0, rootLength);
  const rest = path.slice(rootLength).split("/");
  if (rest.length > 0 && rest[rest.length - 1] === "") rest.pop();
  return [root, ...rest];
}

export function isVolumeCharacter(char: number): boolean {
  return (char >= 0x61 && char <= 0x7a) || (char >= 0x41 && char <= 0x5a);
}

function getFileUrlVolumeSeparatorEnd(url: string, start: number): number {
  if (url.length <= start) return -1;
  const ch0 = url[start];
  if (ch0 === ":") return start + 1;
  if (ch0 === "%" && url.length > start + 2 && url[start + 1] === "3") {
    const ch2 = url[start + 2];
    if (ch2 === "a" || ch2 === "A") return start + 3;
  }
  return -1;
}

// The length is in the units of the string: code units of a JavaScript string, bytes of a byte string.
export function getEncodedRootLength(path: string): number {
  const ln = path.length;
  if (ln === 0) return 0;
  const ch0 = path[0];

  // POSIX or UNC
  if (ch0 === "/" || ch0 === "\\") {
    if (ln === 1 || path[1] !== ch0) return 1;
    const offset = 2;
    const p1 = path.indexOf(ch0, offset);
    if (p1 < 0) return ln;
    return p1 + 1;
  }

  // DOS
  if (isVolumeCharacter(path.charCodeAt(0)) && ln > 1 && path[1] === ":") {
    if (ln === 2) return 2;
    const ch2 = path[2];
    if (ch2 === "/" || ch2 === "\\") return 3;
  }

  // Untitled paths
  if (ch0 === "^" && ln > 1 && path[1] === "/") return 2;

  // URL
  const schemeEnd = path.indexOf(urlSchemeSeparator);
  if (schemeEnd !== -1) {
    const authorityStart = schemeEnd + urlSchemeSeparator.length;
    const authorityEnd = path.indexOf("/", authorityStart);
    if (authorityEnd !== -1) {
      const scheme = path.slice(0, schemeEnd);
      const authority = path.slice(authorityStart, authorityEnd);
      if (
        scheme === "file" &&
        (authority === "" || authority === "localhost") &&
        path.length > authorityEnd + 2 &&
        isVolumeCharacter(path.charCodeAt(authorityEnd + 1))
      ) {
        const volumeSeparatorEnd = getFileUrlVolumeSeparatorEnd(path, authorityEnd + 2);
        if (volumeSeparatorEnd !== -1) {
          if (volumeSeparatorEnd === path.length) return ~volumeSeparatorEnd;
          if (path[volumeSeparatorEnd] === "/") return ~(volumeSeparatorEnd + 1);
        }
      }
      return ~(authorityEnd + 1);
    }
    return ~ln;
  }

  // relative
  return 0;
}

export function getRootLength(path: string): number {
  const rootLength = getEncodedRootLength(path);
  return rootLength < 0 ? ~rootLength : rootLength;
}

export function getDirectoryPath(path: string): string {
  path = normalizeSlashes(path);
  const rootLength = getRootLength(path);
  if (rootLength === path.length) return path;
  path = removeTrailingDirectorySeparator(path);
  return path.slice(0, Math.max(rootLength, path.lastIndexOf("/")));
}

export function getPathFromPathComponents(components: string[]): string {
  if (components.length === 0) return "";
  let root = components[0];
  if (root !== "") root = ensureTrailingDirectorySeparator(root);
  return root + components.slice(1).join("/");
}

export function normalizeSlashes(path: string): string {
  return path.replaceAll("\\", "/");
}

export function reducePathComponents(components: string[]): string[] {
  if (components.length === 0) return [];
  const reduced = [components[0]];
  for (let i = 1; i < components.length; i++) {
    const component = components[i];
    if (component === "") continue;
    if (component === ".") continue;
    if (component === "..") {
      if (reduced.length > 1) {
        if (reduced[reduced.length - 1] !== "..") {
          reduced.pop();
          continue;
        }
      } else if (reduced[0] !== "") {
        continue;
      }
    }
    reduced.push(component);
  }
  return reduced;
}

export function getNormalizedPathComponents(path: string, currentDirectory: string): string[] {
  return getNormalizedPathComponentsFromCombined(combinePaths(currentDirectory, path));
}

function getNormalizedPathComponentsFromCombined(combined: string): string[] {
  const rootLength = getRootLength(combined);
  const components = [combined.slice(0, rootLength)];
  for (let i = rootLength; i < combined.length; ) {
    while (i < combined.length && combined[i] === "/") i++;
    if (i >= combined.length) break;
    const start = i;
    while (i < combined.length && combined[i] !== "/") i++;
    const component = combined.slice(start, i);
    if (component === "" || component === ".") continue;
    if (component === "..") {
      if (components.length > 1) {
        if (components[components.length - 1] !== "..") {
          components.pop();
          continue;
        }
      } else if (components[0] !== "") {
        continue;
      }
    }
    components.push(component);
  }
  return components;
}

export function getNormalizedAbsolutePath(fileName: string, currentDirectory: string): string {
  let rootLength = getRootLength(fileName);
  if (rootLength === 0 && currentDirectory !== "") {
    fileName = combinePaths(currentDirectory, fileName);
  } else {
    fileName = normalizeSlashes(fileName);
  }
  rootLength = getRootLength(fileName);

  const simpleNormalized = simpleNormalizePath(fileName);
  if (simpleNormalized !== undefined) {
    const length = simpleNormalized.length;
    if (length > rootLength) return removeTrailingDirectorySeparator(simpleNormalized);
    if (length === rootLength && rootLength !== 0) return ensureTrailingDirectorySeparator(simpleNormalized);
    return simpleNormalized;
  }

  const length = fileName.length;
  const root = fileName.slice(0, rootLength);
  let changed = false;
  let normalized = "";
  let segmentStart = 0;
  let index = rootLength;
  let normalizedUpTo = index;
  let seenNonDotDotSegment = rootLength !== 0;
  while (index < length) {
    segmentStart = index;
    let ch = fileName[index];
    while (ch === "/") {
      index++;
      if (index < length) ch = fileName[index];
      else break;
    }
    if (index > segmentStart) {
      if (!changed) {
        normalized = fileName.slice(0, Math.max(rootLength, segmentStart - 1));
        changed = true;
      }
      if (index === length) break;
      segmentStart = index;
    }
    let segmentEnd = fileName.indexOf("/", index + 1);
    if (segmentEnd === -1) segmentEnd = length;
    const segmentLength = segmentEnd - segmentStart;
    if (segmentLength === 1 && fileName[index] === ".") {
      if (!changed) {
        normalized = fileName.slice(0, normalizedUpTo);
        changed = true;
      }
    } else if (segmentLength === 2 && fileName[index] === "." && fileName[index + 1] === ".") {
      if (!seenNonDotDotSegment) {
        if (changed) {
          normalized += normalized.length === rootLength ? ".." : "/..";
        } else {
          normalizedUpTo = index + 2;
        }
      } else if (!changed) {
        if (normalizedUpTo - 1 >= 0) {
          normalized = fileName.slice(0, Math.max(rootLength, fileName.slice(0, normalizedUpTo - 1).lastIndexOf("/")));
        } else {
          normalized = fileName.slice(0, normalizedUpTo);
        }
        changed = true;
        seenNonDotDotSegment =
          (normalized.length !== rootLength || rootLength !== 0) && normalized !== ".." && !normalized.endsWith("/..");
      } else {
        const lastSlash = normalized.lastIndexOf("/");
        if (lastSlash !== -1) normalized = normalized.slice(0, Math.max(rootLength, lastSlash));
        else normalized = root;
        seenNonDotDotSegment =
          (normalized.length !== rootLength || rootLength !== 0) && normalized !== ".." && !normalized.endsWith("/..");
      }
    } else if (changed) {
      if (normalized.length !== rootLength) normalized += "/";
      seenNonDotDotSegment = true;
      normalized += fileName.slice(segmentStart, segmentEnd);
    } else {
      seenNonDotDotSegment = true;
      normalizedUpTo = segmentEnd;
    }
    index = segmentEnd + 1;
  }
  if (changed) return normalized;
  if (length > rootLength) return removeTrailingDirectorySeparators(fileName);
  if (length === rootLength) return ensureTrailingDirectorySeparator(fileName);
  return fileName;
}

// undefined stands for ok == false.
function simpleNormalizePath(path: string): string | undefined {
  if (!hasRelativePathSegment(path)) return path;
  const simplified = path.replaceAll("/./", "/");
  const trimmed = simplified.startsWith("./") ? simplified.slice(2) : simplified;
  if (trimmed !== path && !hasRelativePathSegment(trimmed) && !(trimmed !== simplified && trimmed.startsWith("/"))) {
    return trimmed;
  }
  return undefined;
}

function hasRelativePathSegment(p: string): boolean {
  const n = p.length;
  if (n === 0) return false;
  if (p === "." || p === "..") return true;
  if (p[0] === ".") {
    if (n >= 2 && p[1] === "/") return true;
    if (n >= 3 && p[1] === "." && p[2] === "/") return true;
  }
  if (p[n - 1] === ".") {
    if (n >= 2 && p[n - 2] === "/") return true;
    if (n >= 3 && p[n - 2] === "." && p[n - 3] === "/") return true;
  }
  let prevSlash = false;
  let segLen = 0;
  let dotCount = 0;
  for (let i = 0; i < n; i++) {
    const c = p[i];
    if (c === "/") {
      if (prevSlash) return true;
      if ((segLen === 1 && dotCount === 1) || (segLen === 2 && dotCount === 2)) return true;
      prevSlash = true;
      segLen = 0;
      dotCount = 0;
      continue;
    }
    if (c === ".") {
      if (dotCount >= 0) dotCount++;
    } else {
      dotCount = -1;
    }
    segLen++;
    prevSlash = false;
  }
  return (segLen === 1 && dotCount === 1) || (segLen === 2 && dotCount === 2);
}

export function normalizePath(path: string): string {
  path = normalizeSlashes(path);
  const simple = simpleNormalizePath(path);
  if (simple !== undefined) return simple;
  let normalized = getNormalizedAbsolutePath(path, "");
  if (normalized !== "" && hasTrailingDirectorySeparator(path))
    normalized = ensureTrailingDirectorySeparator(normalized);
  return normalized;
}

export function getCanonicalFileName(fileName: string, useCaseSensitiveFileNames: boolean): string {
  return useCaseSensitiveFileNames ? fileName : toFileNameLowerCase(fileName);
}

// U+0130 stays, every other rune takes unicode.ToLower.
export function toFileNameLowerCase(fileName: string): string {
  if (isAscii(fileName)) return toLower(fileName);
  let out = "";
  for (let i = 0; i < fileName.length; ) {
    const c = fileName.codePointAt(i)!;
    out += String.fromCodePoint(c === 0x130 ? c : unicodeToLower(c));
    i += c > 0xffff ? 2 : 1;
  }
  return out;
}

export function toPath(fileName: string, basePath: string, useCaseSensitiveFileNames: boolean): string {
  const nonCanonicalizedPath = isRootedDiskPath(fileName)
    ? normalizePath(fileName)
    : getNormalizedAbsolutePath(fileName, basePath);
  return getCanonicalFileName(nonCanonicalizedPath, useCaseSensitiveFileNames);
}

export function removeTrailingDirectorySeparator(path: string): string {
  return hasTrailingDirectorySeparator(path) ? path.slice(0, path.length - 1) : path;
}

export function removeTrailingDirectorySeparators(path: string): string {
  while (hasTrailingDirectorySeparator(path)) path = removeTrailingDirectorySeparator(path);
  return path;
}

export function ensureTrailingDirectorySeparator(path: string): string {
  return hasTrailingDirectorySeparator(path) ? path : path + "/";
}

export function getPathComponentsRelativeTo(from: string, to: string, options: ComparePathsOptions): string[] {
  const fromComponents = reducePathComponents(getPathComponents(from, options.currentDirectory));
  const toComponents = reducePathComponents(getPathComponents(to, options.currentDirectory));
  let start = 0;
  const maxCommonComponents = Math.min(fromComponents.length, toComponents.length);
  const stringEqualer = getEqualityComparer(options);
  for (; start < maxCommonComponents; start++) {
    const fromComponent = fromComponents[start];
    const toComponent = toComponents[start];
    if (start === 0) {
      if (!equateStringCaseInsensitive(fromComponent, toComponent)) break;
    } else if (!stringEqualer(fromComponent, toComponent)) break;
  }
  if (start === 0) return toComponents;
  const result = [""];
  for (let i = start; i < fromComponents.length; i++) result.push("..");
  for (const component of toComponents.slice(start)) result.push(component);
  return result;
}

// With GetRelativePathToDirectoryOrUrl for isAbsolutePathAnUrl == false.
export function convertToRelativePath(absoluteOrRelativePath: string, options: ComparePathsOptions): string {
  if (!isRootedDiskPath(absoluteOrRelativePath)) return absoluteOrRelativePath;
  return getPathFromPathComponents(
    getPathComponentsRelativeTo(options.currentDirectory, absoluteOrRelativePath, options),
  );
}

export function getBaseFileName(path: string): string {
  path = normalizeSlashes(path);
  // if the path provided is itself the root, then it has no file name.
  const rootLength = getRootLength(path);
  if (rootLength === path.length) return "";
  path = removeTrailingDirectorySeparator(path);
  return path.slice(Math.max(getRootLength(path), path.lastIndexOf("/") + 1));
}

export function getAnyExtensionFromPath(
  path: string,
  extensions: readonly string[] | undefined,
  ignoreCase: boolean,
): string {
  if (extensions !== undefined && extensions.length > 0) {
    return getAnyExtensionFromPathWorker(
      removeTrailingDirectorySeparator(path),
      extensions,
      getStringEqualityComparer(ignoreCase),
    );
  }
  const baseFileName = getBaseFileName(path);
  const extensionIndex = baseFileName.lastIndexOf(".");
  return extensionIndex >= 0 ? baseFileName.slice(extensionIndex) : "";
}

function getAnyExtensionFromPathWorker(
  path: string,
  extensions: readonly string[],
  stringEqualityComparer: (a: string, b: string) => boolean,
): string {
  for (const extension of extensions) {
    const result = tryGetExtensionFromPath(path, extension, stringEqualityComparer);
    if (result !== "") return result;
  }
  return "";
}

// Upstream cuts the path at a count of bytes: text that is not ASCII takes that cut on its UTF-8 form.
function tryGetExtensionFromPath(
  path: string,
  extension: string,
  stringEqualityComparer: (a: string, b: string) => boolean,
): string {
  if (!extension.startsWith(".")) extension = "." + extension;
  let pathExtension: string;
  if (isAscii(extension) && isAscii(path.slice(-extension.length))) {
    if (!(path.length >= extension.length && path[path.length - extension.length] === ".")) return "";
    pathExtension = path.slice(path.length - extension.length);
  } else {
    const pathBytes = utf8Bytes(path);
    const size = utf8Bytes(extension).length;
    if (!(pathBytes.length >= size && pathBytes[pathBytes.length - size] === 0x2e)) return "";
    pathExtension = utf8String(pathBytes.subarray(pathBytes.length - size));
  }
  return stringEqualityComparer(pathExtension, extension) ? pathExtension : "";
}

export interface ComparePathsOptions {
  useCaseSensitiveFileNames: boolean;
  currentDirectory: string;
}

export function getComparer(o: ComparePathsOptions): (a: string, b: string) => number {
  return getStringComparer(!o.useCaseSensitiveFileNames);
}

function getEqualityComparer(o: ComparePathsOptions): (a: string, b: string) => boolean {
  return getStringEqualityComparer(!o.useCaseSensitiveFileNames);
}

export function comparePaths(a: string, b: string, options: ComparePathsOptions): number {
  a = combinePaths(options.currentDirectory, a);
  b = combinePaths(options.currentDirectory, b);
  if (a === b) return 0;
  if (a === "") return -1;
  if (b === "") return 1;
  const aRoot = a.slice(0, getRootLength(a));
  const bRoot = b.slice(0, getRootLength(b));
  const result = compareStringsCaseInsensitive(aRoot, bRoot);
  if (result !== 0) return result;
  const aRest = a.slice(aRoot.length);
  const bRest = b.slice(bRoot.length);
  if (!hasRelativePathSegment(aRest) && !hasRelativePathSegment(bRest)) {
    return getComparer(options)(aRest, bRest);
  }
  const aComponents = reducePathComponents(getPathComponents(a, ""));
  const bComponents = reducePathComponents(getPathComponents(b, ""));
  const sharedLength = Math.min(aComponents.length, bComponents.length);
  for (let i = 1; i < sharedLength; i++) {
    const r = getComparer(options)(aComponents[i], bComponents[i]);
    if (r !== 0) return r;
  }
  return aComponents.length < bComponents.length ? -1 : aComponents.length > bComponents.length ? 1 : 0;
}

export function containsPath(parent: string, child: string, options: ComparePathsOptions): boolean {
  parent = combinePaths(options.currentDirectory, parent);
  child = combinePaths(options.currentDirectory, child);
  if (parent === "" || child === "") return false;
  if (parent === child) return true;
  const parentComponents = reducePathComponents(getPathComponents(parent, ""));
  const childComponents = reducePathComponents(getPathComponents(child, ""));
  if (childComponents.length < parentComponents.length) return false;
  const componentComparer = getEqualityComparer(options);
  for (let i = 0; i < parentComponents.length; i++) {
    const comparer = i === 0 ? equateStringCaseInsensitive : componentComparer;
    if (!comparer(parentComponents[i], childComponents[i])) return false;
  }
  return true;
}

export function fileExtensionIs(path: string, extension: string): boolean {
  return path.length > extension.length && path.endsWith(extension);
}

export function hasExtension(fileName: string): boolean {
  return getBaseFileName(fileName).includes(".");
}

export const ExtensionTs = ".ts";
export const ExtensionTsx = ".tsx";
export const ExtensionDts = ".d.ts";
export const ExtensionJs = ".js";
export const ExtensionJsx = ".jsx";
export const ExtensionJson = ".json";
export const ExtensionTsBuildInfo = ".tsbuildinfo";
export const ExtensionMjs = ".mjs";
export const ExtensionMts = ".mts";
export const ExtensionDmts = ".d.mts";
export const ExtensionCjs = ".cjs";
export const ExtensionCts = ".cts";
export const ExtensionDcts = ".d.cts";

export const AllSupportedExtensions: readonly (readonly string[])[] = [
  [ExtensionTs, ExtensionTsx, ExtensionDts, ExtensionJs, ExtensionJsx],
  [ExtensionCts, ExtensionDcts, ExtensionCjs],
  [ExtensionMts, ExtensionDmts, ExtensionMjs],
];
export const SupportedTSExtensions: readonly (readonly string[])[] = [
  [ExtensionTs, ExtensionTsx, ExtensionDts],
  [ExtensionCts, ExtensionDcts],
  [ExtensionMts, ExtensionDmts],
];
export const AllSupportedExtensionsWithJson = [...AllSupportedExtensions, [ExtensionJson]];
export const SupportedTSExtensionsWithJson = [...SupportedTSExtensions, [ExtensionJson]];

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

export function fileExtensionIsOneOf(path: string, extensions: readonly string[]): boolean {
  for (const ext of extensions) if (fileExtensionIs(path, ext)) return true;
  return false;
}

export function changeAnyExtension(
  path: string,
  ext: string,
  extensions: readonly string[],
  ignoreCase: boolean,
): string {
  const pathext = getAnyExtensionFromPath(path, extensions, ignoreCase);
  if (pathext !== "") {
    const result = path.slice(0, path.length - pathext.length);
    if (ext === "") return result;
    if (ext.startsWith(".")) return result + ext;
    return result + "." + ext;
  }
  return path;
}

export function changeExtension(path: string, newExtension: string): string {
  return changeAnyExtension(path, newExtension, extensionsToRemove, false);
}
