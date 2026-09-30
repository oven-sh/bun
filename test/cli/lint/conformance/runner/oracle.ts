// The oracle of an instance of the corpus; port of readFileNameSet and of the diff key of Run of internal/testutil/baseline/baseline.go, and of the baseline name of DoErrorBaseline of internal/testutil/tsbaseline, typescript-go 89d5d5b.
import { readdirSync, readFileSync } from "node:fs";
import {
  type ByteString,
  decodeRune,
  isAscii,
  isSpace,
  toByteString,
  trimRightSpace,
  utf8ToByteString,
} from "./gostrings";

// E: the oracle is an error baseline. C: the oracle is no diagnostic, and no baseline. The classes are counted apart and never summed: a check that reports nothing passes all of C and none of E.
export type OracleClass = "E" | "C";

// The project whose directory of the corpus holds the baseline; none for class C.
export type OracleSource = "typescript-go" | "typescript" | "none";

export interface Oracle {
  class: OracleClass;
  source: OracleSource;
  // The file that holds the expected bytes; absent for class C.
  path?: string;
}

// The places of a corpus that the oracle reads. This module knows no path below a corpus root: corpusPaths of paths.ts gives these for one.
export interface OraclePaths {
  // For each suite, the directory of typescript-go's error baselines: those whose bytes are not TypeScript's or that TypeScript lacks.
  typescriptGoBaselines: Readonly<Record<string, string>>;
  // The list NO_ERRORS.txt: a line "<suite>/<name>.errors.txt" where typescript-go reports no error and TypeScript has a baseline.
  noErrors: string;
  // The directory of TypeScript's error baselines, both suites in one.
  typescriptBaselines: string;
  // The list submoduleAccepted.txt of typescript-go.
  submoduleAccepted: string;
  // The list submoduleTriaged.txt of typescript-go.
  submoduleTriaged: string;
}

// A panic of baseline.go, with its text.
export class BaselinePanic extends Error {}

// strings.TrimSpace of a byte string: the runes of unicode.IsSpace leave both ends, and a byte that is no UTF-8 is no space.
function trimSpaceOfBytes(s: ByteString): ByteString {
  let start = 0;
  while (start < s.length) {
    const [r, size] = decodeRune(s, start);
    if (!isSpace(r)) break;
    start += size;
  }
  return trimRightSpace(s.slice(start));
}

// baseline.go:112, the loop of readFileNameSet over the bytes of a list; a name is a byte string.
export function parseFileNameSet(content: Uint8Array): Set<ByteString> {
  const set = new Set<ByteString>();
  for (const rawLine of toByteString(content).split("\n")) {
    const line = trimSpaceOfBytes(rawLine);
    if (line === "" || line.charCodeAt(0) === 0x23) {
      continue;
    }
    set.add(line);
  }
  return set;
}

// baseline.go:108; throws BaselinePanic with the text of the panic when the file cannot be read.
export function readFileNameSet(path: string): Set<ByteString> {
  let content: Uint8Array;
  try {
    content = readFileSync(path);
  } catch (error) {
    throw new BaselinePanic(`failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseFileNameSet(content);
}

// The names of the error baselines of a directory, by listing: a file system that ignores case cannot answer for a name of another case.
export interface BaselineDirectory {
  directory: string;
  names: ReadonlySet<string>;
}

export interface OracleTable {
  // By suite: typescript-go's error baselines that the corpus holds.
  typescriptGoBaselines: ReadonlyMap<string, BaselineDirectory>;
  typescriptBaselines: BaselineDirectory;
  // The names of the three lists are byte strings, as the reference holds them.
  noErrors: ReadonlySet<ByteString>;
  submoduleAccepted: ReadonlySet<ByteString>;
  submoduleTriaged: ReadonlySet<ByteString>;
}

function listBaselines(directory: string, mayBeAbsent: boolean): BaselineDirectory {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    if (!mayBeAbsent || (error as { code?: unknown } | null)?.code !== "ENOENT") throw error;
    entries = [];
  }
  return { directory, names: new Set(entries.filter(name => name.endsWith(".errors.txt"))) };
}

// Reads the three lists and the names of the baselines, once for a corpus. It throws when a list or the directory of TypeScript's baselines cannot be read.
export function loadOracleTable(paths: OraclePaths): OracleTable {
  const typescriptGoBaselines = new Map<string, BaselineDirectory>();
  for (const [suite, directory] of Object.entries(paths.typescriptGoBaselines)) {
    // The corpus has no directory for a suite where no baseline of typescript-go differs from TypeScript's.
    typescriptGoBaselines.set(suite, listBaselines(directory, true));
  }
  return {
    typescriptGoBaselines,
    typescriptBaselines: listBaselines(paths.typescriptBaselines, false),
    noErrors: readFileNameSet(paths.noErrors),
    submoduleAccepted: readFileNameSet(paths.submoduleAccepted),
    submoduleTriaged: readFileNameSet(paths.submoduleTriaged),
  };
}

// A list holds a name as its UTF-8 bytes; a string with a lone surrogate has no such bytes and is in no list.
function hasName(list: ReadonlySet<ByteString>, name: string): boolean {
  if (isAscii(name)) return list.has(name);
  return name.isWellFormed() && list.has(utf8ToByteString(name));
}

// tsbaseline/util.go:13
const tsExtension = /\.tsx?$/;

// tsbaseline/error_baseline.go:36: the file name of the error baseline of an instance, from its configured name.
export function errorBaselineName(configuredName: string): string {
  return configuredName.replace(tsExtension, ".errors.txt");
}

// The rules that give the oracle of a run instance, in order: the first that applies decides.
export type OracleStep = 1 | 2 | 3 | 4;

// 1: typescript-go's directory of the suite has the baseline. 2: NO_ERRORS.txt names it, so typescript-go reports no error where TypeScript has a baseline. 3: TypeScript's directory has the baseline, whose bytes typescript-go wrote too. 4: no baseline.
export function oracleStepOf(table: OracleTable, suite: string, configuredName: string): OracleStep {
  const fileName = errorBaselineName(configuredName);
  if (table.typescriptGoBaselines.get(suite)?.names.has(fileName)) return 1;
  if (hasName(table.noErrors, suite + "/" + fileName)) return 2;
  if (table.typescriptBaselines.names.has(fileName)) return 3;
  return 4;
}

// The oracle of a run instance of a suite, from its configured name: "ES5For-of1(target=es2015).ts".
export function oracleOf(table: OracleTable, suite: string, configuredName: string): Oracle {
  const fileName = errorBaselineName(configuredName);
  switch (oracleStepOf(table, suite, configuredName)) {
    case 1:
      return {
        class: "E",
        source: "typescript-go",
        path: `${table.typescriptGoBaselines.get(suite)!.directory}/${fileName}`,
      };
    case 3:
      return { class: "E", source: "typescript", path: `${table.typescriptBaselines.directory}/${fileName}` };
    case 2:
    case 4:
      return { class: "C", source: "none" };
  }
}

// The expected bytes of an oracle of class E. An oracle of class C has no file: it throws.
export function readOracle(oracle: Oracle): Uint8Array {
  if (oracle.path === undefined) throw new Error(`an oracle of class ${oracle.class} has no baseline file`);
  return readFileSync(oracle.path);
}

// baseline.go:62: the name of the diff of a baseline as the two lists hold it, "<suite>/<name>.errors.txt.diff" for an error baseline.
export function diffKey(subfolder: string, fileName: string): string {
  const diffFileName = fileName + ".diff";
  return subfolder + "/" + diffFileName;
}

export interface DiffRoot {
  // submoduleAccepted.txt names the diff of the error baseline against TypeScript's: the difference is accepted.
  accepted: boolean;
  // submoduleTriaged.txt names it: the difference is known and is to be fixed.
  triaged: boolean;
  // The text of t.Fatalf where both lists name it: the reference fails the instance there.
  fatal?: string;
}

// baseline.go:62 to :69 for the error baseline of an instance. No caller of the reference sets the options IsSubmoduleAccepted and IsSubmoduleTriaged: the lists alone decide.
export function diffRootOf(table: OracleTable, suite: string, configuredName: string): DiffRoot {
  const key = diffKey(suite, errorBaselineName(configuredName));
  const isSubmoduleAccepted = hasName(table.submoduleAccepted, key);
  const isSubmoduleTriaged = hasName(table.submoduleTriaged, key);

  if (isSubmoduleAccepted && isSubmoduleTriaged) {
    return {
      accepted: true,
      triaged: true,
      fatal: `diff file ${key} is in both submoduleAccepted and submoduleTriaged; it should only be in one`,
    };
  }
  return { accepted: isSubmoduleAccepted, triaged: isSubmoduleTriaged };
}
