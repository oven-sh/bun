import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import type {
  Check,
  CheckResult,
  Diagnostic,
  Expectations,
  InputFile,
  InputResult,
  Instance,
} from "./conformance/runner";
import * as runner from "./conformance/runner";
import { tsgoRules } from "./conformance/runner/diagnosticwriter";
import { getErrorBaseline } from "./conformance/runner/error_baseline";
import {
  InvalidUtf8Error,
  compareStrings,
  foldKey,
  isSpace,
  unicodeToLower,
  utf8String,
  utf8ToByteString,
} from "./conformance/runner/gostrings";
import { type Origin, listErrorBaselines, roundTripFiles, sampleErrorBaselines } from "./conformance/runner/roundtrip";
import { skipTrivia } from "./conformance/runner/scanner";
import { toWriterInput } from "./conformance/runner/shape";
import { isLineBreak, isWhiteSpaceLike, isWhiteSpaceSingleLine } from "./conformance/runner/stringutil";
import {
  extractCompilerSettings,
  getConfigNameFromFileName,
  parseTestFilesAndSymlinksWithOptions,
} from "./conformance/runner/test_case_parser";
import { decodeBytes } from "./conformance/runner/vfs";

const home = join(import.meta.dir, "conformance");
const fixtures = join(home, "fixtures");
// Where sync.sh puts the cases, the test library, the baselines and the lists of the two projects.
const corpusRoot = join(home, "corpus");

// A debug or sanitizer build runs this file's JavaScript about a hundred times slower: it takes the samples and leaves the whole corpus to release builds.
const small = isDebug || isASAN;
// A debug build needs more than the default time of a test for the processes that a test starts.
const spawnTimeout = small ? 60_000 : undefined;

// One of every n names, the same on every platform and without an order of the directory entries.
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;

// Groups of at most n: a debug build gets through one group within the time of one test.
function groupsOf<T>(all: readonly T[], n: number, weight: (x: T) => number = () => 1): T[][] {
  const out: T[][] = [];
  let sum = Infinity;
  for (const x of all) {
    if (sum + weight(x) > n) {
      out.push([]);
      sum = 0;
    }
    out[out.length - 1].push(x);
    sum += weight(x);
  }
  return out;
}

function lazy<T>(make: () => T): () => T {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// The base name of every case to its path below the cases, from the names of the directories alone.
const cases = lazy(() => {
  const out = new Map<string, string>();
  const walk = (rel: string) => {
    for (const entry of readdirSync(`${corpusRoot}/cases/${rel}`, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
      else if (/\.tsx?$/.test(entry.name)) out.set(entry.name, `${rel}/${entry.name}`);
    }
  };
  walk("compiler");
  walk("conformance");
  return out;
});
// "a(target=es2015).ts" is an instance of the case "a.ts".
const caseBaseName = (instanceName: string) => {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(instanceName);
  return m === null ? instanceName : m[1] + m[3];
};

// The enumerator, the oracle and the files of an instance, bound to the corpus.
const corpus = lazy(() => runner.openCorpus(corpusRoot));
type CorpusInstance = ReturnType<ReturnType<typeof runner.openCorpus>["enumerateCase"]>[number];
const corpusRun = {
  input: (instance: Instance, root: string | undefined) => corpus().input(instance, root),
  oracle: (instance: Instance) => corpus().oracle(instance),
};
const instanceOf = (name: string) => {
  const path = cases().get(caseBaseName(name));
  const instances = path === undefined ? [] : corpus().enumerateCase(path);
  return instances.find(i => i.name === name);
};

// The answers of the reference at the pinned commits: counts, digests and the commits themselves.
const reference = lazy(() => JSON.parse(readFileSync(join(home, "reference_counts.json"), "utf8")));
// Every instance of the reference's run of its suite, one line each: the name, then E or C, or "skipped" and the reason.
const listText = lazy(() => readFileSync(join(fixtures, "instances.tsv"), "utf8"));
const listLines = lazy(() => listText().split("\n").slice(0, -1));
const nameOfLine = (line: string) => line.slice(0, line.indexOf("\t"));
const lineOf = (i: CorpusInstance) =>
  i.status === "run" ? `${i.name}\t${i.oracle.class}` : `${i.name}\tskipped\t${i.skipReason}`;
// The lines of the list by the path of their case; a line without a case is under "".
const linesOfCase = lazy(() => {
  const out = new Map<string, string[]>();
  for (const line of listLines()) {
    const path = cases().get(caseBaseName(nameOfLine(line))) ?? "";
    const lines = out.get(path);
    if (lines === undefined) out.set(path, [line]);
    else lines.push(line);
  }
  return out;
});
// The name of a subtest as the reference's test runner prints it: "a.ts_target=es2015" for "a(target=es2015).ts".
const goName = (name: string) => {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(name);
  return m === null ? name : `${m[1]}${m[3]}_${m[2]}`;
};

// The baseline that the reference writes for diagnostics in units, spans included.
function baselineOf(units: InputFile[], diagnostics: Diagnostic[]): Uint8Array {
  const written = toWriterInput(tsgoRules, units, diagnostics);
  return tsgoRules.model.toBytes(getErrorBaseline(tsgoRules, written.files, written.diagnostics, false).text);
}

// The input of an instance that is no case of the corpus: one unit, written below the root that a run gives.
const unitInput =
  (unit: InputFile) =>
  (_instance: Instance, root: string | undefined): InputResult => {
    if (root !== undefined) {
      mkdirSync(dirname(root + unit.unitName), { recursive: true });
      writeFileSync(root + unit.unitName, unit.content);
    }
    return {
      ok: true,
      input: {
        currentDirectory: "/.src",
        rootFiles: [unit.unitName],
        otherFiles: [],
        units: [unit],
        symlinks: [],
        options: {},
      },
    };
  };

// What the tests compare of the result of a run; headerOnly is there when the run compared a first section.
type Ending = { outcome: string; reason: string; headerOnly?: boolean };
const endingOf = ({ outcome, reason, headerOnly }: Ending): Ending =>
  headerOnly === undefined ? { outcome, reason } : { outcome, reason, headerOnly };

// One batch of listed names through a check: the names that are no run instance of their list or that do not pass.
async function failuresOf(batch: readonly { name: string; list: "E" | "C" }[], check: Check, directory: string) {
  const failures: { name: string; outcome: string; reason: string }[] = [];
  const instances: CorpusInstance[] = [];
  for (const { name, list } of batch) {
    const instance = instanceOf(name);
    if (instance === undefined) {
      failures.push({ name, outcome: "unsupported", reason: "the corpus has no instance of this name" });
    } else if (instance.status === "run" && instance.oracle.class !== list) {
      failures.push({
        name,
        outcome: "fail",
        reason: `the oracle of the instance is of class ${instance.oracle.class}`,
      });
    } else {
      instances.push(instance);
    }
  }
  const results = await runner.runInstances(instances, check, {
    ...corpusRun,
    directory,
    concurrency: Math.min(8, availableParallelism()),
    timeoutMs: small ? 60_000 : 10_000,
  });
  for (const r of results) {
    if (r.outcome === "pass") continue;
    const reason = r.diff === undefined ? r.reason : `${r.reason}\n${r.diff}`;
    failures.push({ name: r.instance.name, outcome: r.outcome, reason });
  }
  return failures;
}

describe("reference", () => {
  test("the pinned answers are those of the commits that UPSTREAM names", () => {
    const commits = readFileSync(join(home, "UPSTREAM"), "utf8").match(/\b[0-9a-f]{40}\b/g) ?? [];
    expect(commits).toContain(reference().upstream["typescript-go"]);
    expect(commits).toContain(reference().upstream.TypeScript);
    // The run of the reference's suite is evidence for one commit only.
    if (reference().suiteRun !== undefined) {
      expect(reference().suiteRun["typescript-go"]).toBe(reference().upstream["typescript-go"]);
    }
  });

  test("the corpus holds the cases, the baselines and the lists of the pinned commits", () => {
    const names = (directory: string) => readdirSync(directory).filter(name => name.endsWith(".errors.txt")).length;
    // A list names a file once however often the line is there; "#" starts a comment.
    const lines = (file: string) => {
      const all = readFileSync(file, "utf8")
        .split("\n")
        .map(line => line.trim());
      return new Set(all.filter(line => line !== "" && !line.startsWith("#"))).size;
    };
    expect({
      files: cases().size,
      typescriptBaselines: names(`${corpusRoot}/baselines/typescript`),
      typescriptGoBaselines: {
        compiler: names(`${corpusRoot}/baselines/typescript-go/compiler`),
        conformance: names(`${corpusRoot}/baselines/typescript-go/conformance`),
      },
      expectsNoErrors: lines(`${corpusRoot}/baselines/typescript-go/NO_ERRORS.txt`),
      accepted: lines(`${corpusRoot}/submoduleAccepted.txt`),
      triaged: lines(`${corpusRoot}/submoduleTriaged.txt`),
    }).toEqual({
      files: reference().cases.files,
      typescriptBaselines: reference().corpus.typescriptBaselines,
      typescriptGoBaselines: reference().corpus.typescriptGoBaselines,
      expectsNoErrors: reference().corpus.expectsNoErrors,
      accepted: reference().corpus.accepted,
      triaged: reference().corpus.triaged,
    });
  });

  test("the list has the instances of the reference's run: 14,915, of which 12,797 run and 2,118 are skipped", () => {
    expect(sha256(listText())).toBe(reference().instances.sha256);
    expect(new Set(listLines().map(nameOfLine)).size).toBe(listLines().length);
    expect(linesOfCase().get("") ?? []).toEqual([]);
    const kinds = { compiler: { E: 0, C: 0, skipped: 0 }, conformance: { E: 0, C: 0, skipped: 0 } };
    const reasons: Record<string, number> = {};
    for (const [path, lines] of linesOfCase()) {
      const suite = path.startsWith("compiler/") ? "compiler" : "conformance";
      for (const line of lines) {
        const [, kind, reason] = line.split("\t");
        kinds[suite][kind as "E" | "C" | "skipped"]++;
        if (kind !== "skipped") continue;
        const key = reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1");
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
    }
    const E = kinds.compiler.E + kinds.conformance.E;
    const C = kinds.compiler.C + kinds.conformance.C;
    expect({
      instances: listLines().length,
      run: E + C,
      skipped: kinds.compiler.skipped + kinds.conformance.skipped,
      E,
      compilerE: kinds.compiler.E,
      conformanceE: kinds.conformance.E,
      C,
    }).toEqual({
      instances: 14915,
      run: 12797,
      skipped: 2118,
      E: 7027,
      compilerE: 3187,
      conformanceE: 3840,
      C: 5770,
    });
    expect(reasons).toEqual(reference().instances.skippedBecause);
  });

  test("the case and space tables are those of Go", () => {
    const parts: Record<string, string[]> = { lower: [], foldKey: [], space: [], white: [] };
    for (let r = 0; r <= 0x10ffff; r++) {
      const l = unicodeToLower(r);
      if (l !== r) parts.lower.push(`${r.toString(16)} ${l.toString(16)}\n`);
      const k = foldKey(r);
      if (k !== r) parts.foldKey.push(`${r.toString(16)} ${k.toString(16)}\n`);
      if (isSpace(r)) parts.space.push(`${r.toString(16)}\n`);
      if (isWhiteSpaceLike(r)) {
        parts.white.push(`${r.toString(16)} ${isWhiteSpaceSingleLine(r)} ${isLineBreak(r)}\n`);
      }
    }
    expect(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, sha256(v.join(""))]))).toEqual(
      reference().go.tables,
    );
  });
});

describe("directives", () => {
  const obj = (m: Map<string, string>) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));

  test("the vectors of the reference parser", () => {
    const inputs: any[] = JSON.parse(readFileSync(join(fixtures, "directives-inputs.json"), "utf8"));
    const expected: any[] = JSON.parse(readFileSync(join(fixtures, "directives-expected.json"), "utf8"));
    const got = inputs.map(i => {
      const raw = Buffer.from(i.bytes, "base64");
      let content: string;
      try {
        content = raw.length === 0 ? "" : utf8String(decodeBytes(raw));
      } catch (e) {
        if (!(e instanceof InvalidUtf8Error)) throw e;
        return { name: i.name, refused: "not valid UTF-8" };
      }
      const bytes = utf8ToByteString(content);
      const o: any = {
        name: i.name,
        decoded: content,
        lines: content.split(/\r?\n/),
        settings: obj(extractCompilerSettings(content)),
        panic: "",
        units: [],
        configUnit: null,
        symlinks: {},
        currentDirectory: "",
        globalOptions: {},
        skipTrivia: skipTrivia(bytes, 0),
        error: "",
        decodedByteLen: bytes.length,
      };
      const failOn = i.failOn ?? "";
      const r = parseTestFilesAndSymlinksWithOptions(
        content,
        i.fileName,
        (name, content, fileOptions) =>
          failOn !== "" && name === failOn
            ? {
                value: { name: "FAILED:" + name, content, fileOptions: obj(fileOptions) },
                error: "cannot parse " + name,
              }
            : { value: { name, content, fileOptions: obj(fileOptions) }, error: undefined },
        { allowImplicitFirstFile: !!i.allowImplicitFirstFile },
      );
      if (!r.ok) o.panic = r.reason;
      else {
        let units: any[] = r.units;
        o.error = r.error ?? "";
        o.symlinks = obj(r.symlinks);
        o.currentDirectory = r.currentDirectory;
        o.globalOptions = obj(r.globalOptions);
        if (!i.allowImplicitFirstFile) {
          const k = units.findIndex((u: any) => getConfigNameFromFileName(u.name) !== "");
          if (k >= 0) {
            o.configUnit = units[k];
            units = units.filter((_: unknown, x: number) => x !== k);
          }
        }
        o.units = units;
      }
      return o;
    });
    // The port refuses bytes that are no UTF-8; the reference reads them as they are.
    const refused = got.filter(o => "refused" in o).map(o => o.name);
    expect(refused).toEqual(["decode: one byte 0xFF", "decode: two bytes of a utf-8 BOM"]);
    expect(got.filter(o => !("refused" in o))).toEqual(expected.filter(o => !refused.includes(o.name)));
    expect(inputs.length).toBe(120);
  });
});

describe("variations", () => {
  const { getCompilerVaryByMap, getFileBasedTestConfigurations } = runner;
  const vary = lazy(() => getCompilerVaryByMap());
  const names = (text: string) =>
    getFileBasedTestConfigurations(extractCompilerSettings(text), vary()).map(c => c.name);

  test("72 of the 126 declared options vary", () => {
    const counts = { declared: runner.optionsDeclarations.length, varying: vary().size };
    expect(counts).toEqual({ declared: 126, varying: 72 });
  });

  // The reference walks Go maps, whose order is not fixed: the names are compared as a set.
  test.each([
    ["no setting", "let x;\n", []],
    ["one value", "// @target: es2015\n", [""]],
    ["two values", "// @target: es5, es2015\n", ["target=es5", "target=es2015"]],
    ["a value twice", "// @strict: true, true, false\n", ["strict=true", "strict=false"]],
    [
      "one value by two names keeps the first name",
      "// @target: esnext, es2015, es6\n",
      ["target=esnext", "target=es2015"],
    ],
    [
      "the cross product, keys sorted in the name",
      "// @target: es5,esnext\n// @strict: true,false\n",
      ["strict=true,target=es5", "strict=false,target=es5", "strict=true,target=esnext", "strict=false,target=esnext"],
    ],
    ["the last occurrence wins", "// @strict: true, false\n// @strict: false\n", [""]],
    ["every value", "// @strict: *\n", ["strict=true", "strict=false"]],
    ["every value but one", "// @moduleDetection: *, -legacy\n", ["moduledetection=auto", "moduledetection=force"]],
    ["every value but one leaves nothing to vary", "// @strict: *, -false\n", [""]],
    ["a value that is taken out again", "// @module: commonjs, esnext, !commonjs\n", [""]],
    ["a name in upper case", "// @STRICT: true, false\n", ["strict=true", "strict=false"]],
    ["an option that does not vary", "// @lib: es5, dom\n", [""]],
  ] as [string, string, string[]][])("%s", (_label, text, want) => {
    expect(names(text).sort()).toEqual(want.slice().sort());
  });

  test("a set of variations that is empty stops the case", () => {
    expect(() => names("// @strict: -true, -false, *\n")).toThrow("resulted in an empty set");
  });

  test("25 variations are the most", () => {
    const five = "// @target: es2015, es2016, es2017, es2018, es2019\n";
    const most = names(five + "// @module: commonjs, es2015, es2020, es2022, esnext\n");
    expect(new Set(most).size).toBe(25);
    expect(most).toContain("module=commonjs,target=es2015");
    expect(most).toContain("module=esnext,target=es2019");
    // Every target is 13 values, and one option more makes 26.
    expect(names("// @target: *\n").length).toBe(13);
    const tooMany = "exceeded the maximum number of variations";
    expect(() => names("// @target: *\n// @strict: true, false\n")).toThrow(tooMany);
    const booleans = ["strict", "noEmit", "declaration", "alwaysStrict", "noImplicitAny"];
    expect(() => names(booleans.map(name => `// @${name}: true,false\n`).join(""))).toThrow(tooMany);
  });
});

describe("enumerator", () => {
  const { skippedEmitTests, skippedTests } = runner;
  const sample = [...cases().values()].filter(path => sampled(path, 40)).sort();

  test("the sample holds cases of both suites", () => {
    expect({
      compiler: sample.filter(p => p.startsWith("compiler/")).length > 100,
      conformance: sample.filter(p => p.startsWith("conformance/")).length > 100,
    }).toEqual({ compiler: true, conformance: true });
  });

  test.each(groupsOf(sample, 40).map((g, k) => [k + 1, g] as const))(
    "the instances of one of 40 cases are their lines of the list: group %d",
    (_k, group) => {
      const got = group.flatMap(path => corpus().enumerateCase(path).map(lineOf));
      const want = group.flatMap(path => linesOfCase().get(path) ?? []);
      expect(got.sort()).toEqual(want.sort());
    },
  );

  test("45 cases are left out by name and 8 are run for their diagnostics alone", () => {
    const emitOnly = [...skippedEmitTests.keys()];
    expect({ leftOut: skippedTests.length, emitOnly: emitOnly.length }).toEqual({ leftOut: 45, emitOnly: 8 });
    expect([...skippedTests, ...emitOnly].filter(name => !cases().has(name))).toEqual([]);
    // A case that is left out gives no instance, so the list has no line for it.
    expect(skippedTests.flatMap(name => corpus().enumerateCase(cases().get(name)!))).toEqual([]);
    expect(skippedTests.filter(name => linesOfCase().has(cases().get(name)!))).toEqual([]);
    expect(
      emitOnly.map(name => {
        const instances = corpus().enumerateCase(cases().get(name)!);
        return {
          name,
          run: instances.some(i => i.status === "run"),
          flagged: instances.every(i => i.emitOnly === true),
        };
      }),
    ).toEqual(emitOnly.map(name => ({ name, run: true, flagged: true })));
  });

  // The whole corpus is a second of work in a release build and minutes in a debug build; the time limit is for a machine under load.
  test.skipIf(small)(
    "every instance is its line of the list, and the counts are those of the reference",
    () => {
      const instances = corpus().enumerateInstances();
      // The lines that differ, not two lists of 14,915 lines.
      const got = new Set(instances.map(lineOf));
      const want = new Set(listLines());
      expect({
        notInTheList: [...got].filter(l => !want.has(l)).slice(0, 20),
        notEnumerated: [...want].filter(l => !got.has(l)).slice(0, 20),
      }).toEqual({ notInTheList: [], notEnumerated: [] });
      const count = (f: (i: CorpusInstance) => boolean) => instances.filter(f).length;
      const run = (i: CorpusInstance) => i.status === "run";
      expect({
        instances: instances.length,
        run: count(run),
        skipped: count(i => !run(i)),
        E: count(i => run(i) && i.oracle.class === "E"),
        C: count(i => run(i) && i.oracle.class === "C"),
      }).toEqual({ instances: 14915, run: 12797, skipped: 2118, E: 7027, C: 5770 });
      const suite = (s: string) => {
        const of = (f: (i: CorpusInstance) => boolean) => count(i => i.suite === s && f(i));
        return {
          instances: of(() => true),
          run: of(run),
          skipped: of(i => !run(i)),
          E: of(i => run(i) && i.oracle.class === "E"),
          C: of(i => run(i) && i.oracle.class === "C"),
        };
      };
      expect({
        cases: new Set(instances.map(i => caseBaseName(i.name))).size,
        compiler: suite("compiler"),
        conformance: suite("conformance"),
        accepted: count(i => run(i) && i.accepted),
        triaged: count(i => run(i) && i.triaged),
        typescriptGo: count(i => run(i) && i.oracle.source === "typescript-go"),
        typescript: count(i => run(i) && i.oracle.source === "typescript"),
      }).toEqual({
        cases: reference().cases.files - reference().cases.droppedByName,
        compiler: reference().instances.compiler,
        conformance: reference().instances.conformance,
        accepted: reference().instances.accepted,
        triaged: reference().instances.triaged,
        typescriptGo: reference().oracle["typescript-go"],
        typescript: reference().oracle.typescript,
      });
      // The subtests and the skip reasons as the reference's own run printed them.
      const suiteRun = reference().suiteRun;
      if (suiteRun !== undefined) {
        const subtests = instances
          .map(i => `${run(i) ? "PASS" : "SKIP"}\t${goName(i.name)}`)
          .sort((a, b) => compareStrings(a.slice(5), b.slice(5)))
          .map(l => l + "\n")
          .join("");
        const reasons = instances
          .filter(i => !run(i))
          .map(i => `${goName(i.name)}\t${i.skipReason}`)
          .sort(compareStrings)
          .map(l => l + "\n")
          .join("");
        expect({ subtests: instances.length, sha256: sha256(subtests), skipReasonsSha256: sha256(reasons) }).toEqual({
          subtests: suiteRun.subtests,
          sha256: suiteRun.sha256,
          skipReasonsSha256: suiteRun.skipReasonsSha256,
        });
      }
    },
    30_000,
  );
});

describe("error baselines", () => {
  // Two of the 14 baselines in the pretty form: one with related information, one with tabs.
  const pretty = ["deeplyNestedAssignabilityIssue.errors.txt", "prettyFileWithErrorsAndTabs.errors.txt"];
  // 200 files at even distances in the order of the names of both tools, with the two files in the pretty form of each; a file above 64 KB stays out, a debug build needs seconds for it.
  const sample = sampleErrorBaselines(
    [
      ...listErrorBaselines(`${corpusRoot}/baselines/typescript`, "typescript"),
      ...listErrorBaselines(`${corpusRoot}/baselines/typescript-go/compiler`, "typescript-go"),
      ...listErrorBaselines(`${corpusRoot}/baselines/typescript-go/conformance`, "typescript-go"),
    ],
    200,
    { always: pretty, maxBytes: 64 * 1024 },
  );

  test("the sample is 200 files of both tools, and holds the files in the pretty form", () => {
    const of = (origin: Origin) => sample.filter(f => f.origin === origin);
    expect({
      files: sample.length,
      typescript: of("typescript").length > 150,
      typescriptGo: of("typescript-go").length > 5,
      pretty: sample.filter(f => pretty.includes(f.name)).map(f => `${f.origin}: ${f.name}`),
    }).toEqual({
      files: 200,
      typescript: true,
      typescriptGo: true,
      pretty: pretty.flatMap(name => [`typescript: ${name}`, `typescript-go: ${name}`]),
    });
  });

  test.each(groupsOf(sample, 48 * 1024, f => f.bytes).map((g, k) => [k + 1, g] as const))(
    "read and written again, the bytes are the same: group %d",
    (_k, group) => {
      const report = roundTripFiles(group);
      expect(report.failures).toEqual([]);
      expect({ files: report.files, same: report.same, pretty: report.pretty }).toEqual({
        files: group.length,
        same: group.length,
        pretty: group.filter(f => pretty.includes(f.name)).length,
      });
    },
  );
});

describe("run", () => {
  const { emptyCheck, replayCheck, runInstance, runInstances } = runner;
  const unit: InputFile = { unitName: "/.src/a.ts", content: 'const x: number = "s";\n' };
  const known: Diagnostic = {
    category: "error",
    code: 2322,
    messageText: "Type 'string' is not assignable to type 'number'.",
    location: { file: unit.unitName, start: 6, length: 1 },
    relatedInformation: [],
  };
  const printed = { file: unit.unitName, line: 1, character: 7 };
  const options = { input: unitInput(unit), oracle: () => baselineOf([unit], [known]) };
  const E: Instance = { name: "a.ts", status: "run", oracle: { class: "E" } };
  const C: Instance = { name: "a.ts", status: "run", oracle: { class: "C" } };
  function reports(result: CheckResult): Check {
    return async () => result;
  }
  const ending = async (instance: Instance, check: Check, more: Partial<typeof options> = {}) =>
    endingOf(await runInstance(instance, check, { ...options, ...more }));

  test("the bytes of the baseline are the bytes of the oracle, or it is no pass", async () => {
    expect(await ending(E, replayCheck(options.oracle))).toEqual({ outcome: "pass", reason: "" });
    expect(await ending(E, reports({ diagnostics: [known] }))).toEqual({ outcome: "pass", reason: "" });
    const other = await ending(
      E,
      reports({ diagnostics: [{ ...known, location: { ...known.location!, length: 5 } }] }),
    );
    expect({ outcome: other.outcome, headerOnly: other.headerOnly }).toEqual({ outcome: "fail", headerOnly: true });
    expect(other.reason).toStartWith("the baseline differs from the oracle at byte ");
  });

  test("a check that reports nothing passes no instance with errors, and a diagnostic fails an instance without", async () => {
    expect(await ending(C, emptyCheck)).toEqual({ outcome: "pass", reason: "" });
    expect(await ending(E, emptyCheck)).toEqual({
      outcome: "fail",
      reason: "no diagnostic where the oracle has a baseline",
    });
    expect(await ending(C, reports({ diagnostics: [known] }))).toEqual({
      outcome: "fail",
      reason:
        "1 diagnostics where the oracle has none, the first is TS2322: Type 'string' is not assignable to type 'number'.",
    });
  });

  test("the first section alone, which is all that the plain format holds, is reported apart and is never a pass", async () => {
    const reason = "the first section is the oracle's; a baseline needs the lengths and the related information";
    expect(await ending(E, reports({ diagnostics: [{ ...known, location: printed }] }))).toEqual({
      outcome: "fail",
      reason,
      headerOnly: true,
    });
    expect(await ending(E, reports({ diagnostics: [{ ...known, relatedInformation: undefined }] }))).toEqual({
      outcome: "fail",
      reason,
      headerOnly: true,
    });
    const other = await ending(E, reports({ diagnostics: [{ ...known, location: printed, messageText: "Other." }] }));
    expect({ outcome: other.outcome, headerOnly: other.headerOnly }).toEqual({ outcome: "fail", headerOnly: false });
    expect(other.reason).toStartWith("the first section differs from the oracle at byte ");
  });

  test("what is no list of diagnostics of the instance is no pass", async () => {
    const skipped: Instance = { ...C, status: "skip", skipReason: "unsupported target ES5" };
    expect(await ending(skipped, emptyCheck)).toEqual({ outcome: "skip", reason: "unsupported target ES5" });
    const refuses = () => ({ ok: false as const, reason: "the instance has a drive root" });
    expect(await ending(C, emptyCheck, { input: refuses })).toEqual({
      outcome: "unsupported",
      reason: "the instance has a drive root",
    });
    expect(await ending(C, reports({ diagnostics: [], unavailable: "the command is no linter" }))).toEqual({
      outcome: "unavailable",
      reason: "the command is no linter",
    });
    expect(await ending(C, reports({ diagnostics: [], standIns: ["checker.getTypeOfExpression"] }))).toEqual({
      outcome: "provisional",
      reason: "the check reached 1 stand-ins: checker.getTypeOfExpression",
    });
    expect(await ending(C, reports({ diagnostics: [{ ...known, code: -1 }] }))).toEqual({
      outcome: "fail",
      reason: "a diagnostic has the code -1",
    });
    const throws: Check = async () => {
      throw new Error("the command ended by the signal SIGSEGV");
    };
    expect(await ending(C, throws)).toEqual({
      outcome: "crash",
      reason: "the check threw: Error: the command ended by the signal SIGSEGV",
    });
  });

  const sample = [...cases().values()].filter(path => sampled(path, 250)).sort();
  const seen = { E: 0, C: 0 };

  test.each(groupsOf(sample, 8).map((g, k) => [k + 1, g] as const))(
    "replayed oracles pass and a check that reports nothing passes no instance with errors: group %d",
    async (_k, group) => {
      const instances = group.flatMap(path => corpus().enumerateCase(path)).filter(i => i.status === "run");
      const replayed = await runInstances(instances, replayCheck(corpusRun.oracle), corpusRun);
      // An instance whose files cannot be laid out is unsupported, whatever the check is.
      const laid = replayed.filter(r => r.outcome !== "unsupported");
      expect(laid.map(r => `${r.instance.name}: ${r.outcome} ${r.reason}`)).toEqual(
        laid.map(r => `${r.instance.name}: pass `),
      );
      const silent = await runInstances(
        laid.map(r => r.instance),
        emptyCheck,
        corpusRun,
      );
      expect(silent.map(r => `${r.instance.name}: ${r.outcome}`)).toEqual(
        laid.map(r => `${r.instance.name}: ${r.instance.oracle.class === "E" ? "fail" : "pass"}`),
      );
      for (const r of laid) seen[r.instance.oracle.class]++;
    },
  );

  test("the sample had instances with errors and without", () => {
    expect({ E: seen.E > 10, C: seen.C > 10 }).toEqual({ E: true, C: true });
  });
});

describe("expectations", () => {
  const { checkLists, formatExpectations, parseExpectations, plan, reportText, verify } = runner;
  // What the lists know of an instance: its case, that it runs, and the class of its oracle.
  const fact = (name: string, kind: "E" | "C") => {
    const casePath = "compiler/" + caseBaseName(name);
    const tags: string[] = [];
    const known = { name, directory: "compiler", casePath, status: "run" as const, reason: "", kind, tags };
    return [name, { ...known, platformLimited: undefined }] as const;
  };
  const facts = new Map([fact("e1.ts", "E"), fact("e2(strict=true).ts", "E"), fact("c1.ts", "C")]);
  // What a run says of an instance.
  const outcome = (name: string, status: "pass" | "fail") =>
    [name, { name, status, level: "baseline", detail: status === "pass" ? "" : "line 1" }] as const;
  const outcomes = (status: "pass" | "fail") => new Map([...facts.keys()].map(name => outcome(name, status)));
  const empty: Expectations = { level: "baseline", E: [], C: [] };

  test("the file has one form", () => {
    const x: Expectations = { level: "baseline", E: ["e1.ts", "e2(strict=true).ts"], C: ["c1.ts"] };
    expect(formatExpectations(x)).toBe(
      '{\n  "level": "baseline",\n  "E": [\n    "e1.ts",\n    "e2(strict=true).ts"\n  ],\n  "C": [\n    "c1.ts"\n  ]\n}\n',
    );
    expect(parseExpectations(formatExpectations(x))).toEqual(x);
    expect(() => parseExpectations(formatExpectations({ ...x, E: ["e2(strict=true).ts", "e1.ts"] }))).toThrow(
      "comes after",
    );
    expect(() => parseExpectations(JSON.stringify(x))).toThrow("form");
  });

  test("a listed name that does not pass is a failure, and a name that passes enters and never leaves", () => {
    const listed: Expectations = { level: "baseline", E: ["e1.ts"], C: [] };
    expect(verify(listed, outcomes("pass"))).toEqual([]);
    expect(verify(listed, outcomes("fail")).map(f => [f.name, f.list, f.reason])).toEqual([["e1.ts", "E", "fail"]]);
    const grown = plan(empty, facts, outcomes("pass"));
    expect(grown.added).toEqual({ E: ["e1.ts", "e2(strict=true).ts"], C: ["c1.ts"] });
    expect(plan(grown.next, facts, outcomes("fail")).next).toEqual(grown.next);
    expect(
      checkLists({ level: "baseline", E: ["c1.ts", "gone.ts"], C: [] }, facts).map(f => [f.name, f.reason]),
    ).toEqual([
      ["c1.ts", "wrong-list"],
      ["gone.ts", "not-an-instance"],
    ]);
  });

  test("the names that pass and are not listed are printed with the one command that adds them", () => {
    expect(reportText(plan(empty, facts, outcomes("pass")), "bun sweep.ts --update")).toBe(
      "3 instances pass and are not listed (E 2, C 1):\n  E e1.ts\n  E e2(strict=true).ts\n  C c1.ts\nAdd them with:\n  bun sweep.ts --update",
    );
  });

  test("a check that reports nothing adds no name: list C takes no more names of a directory than list E has", () => {
    const silent = new Map([outcome("e1.ts", "fail"), outcome("e2(strict=true).ts", "fail"), outcome("c1.ts", "pass")]);
    const planned = plan(empty, facts, silent);
    expect(planned.added).toEqual({ E: [], C: [] });
    expect(planned.refused.map(r => [r.name, r.reason])).toEqual([["c1.ts", "quota"]]);
  });
});

describe("plain format", () => {
  const { parsePlainDiagnostics, writePlainDiagnostics } = runner;

  test("one located diagnostic", () => {
    expect(
      parsePlainDiagnostics("a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n"),
    ).toEqual({
      ok: true,
      diagnostics: [
        {
          path: "a.ts",
          line: 1,
          character: 7,
          category: "error",
          code: 2322,
          messageText: "Type 'string' is not assignable to type 'number'.",
          at: 1,
        },
      ],
    });
  });

  test("empty text is an empty list", () => {
    expect(parsePlainDiagnostics("")).toEqual({ ok: true, diagnostics: [] });
  });

  test("a chain: two spaces per level, siblings and a way back up", () => {
    const text =
      "src/a.ts(3,1): error TS2345: top\n" +
      "  one\n" +
      "    two\n" +
      "      three\n" +
      "    two again\n" +
      "  one again\n" +
      "error TS5023: Unknown compiler option 'x'.\n";
    const r = parsePlainDiagnostics(text);
    expect(r).toEqual({
      ok: true,
      diagnostics: [
        {
          path: "src/a.ts",
          line: 3,
          character: 1,
          category: "error",
          code: 2345,
          messageText: "top",
          at: 1,
          next: [
            {
              messageText: "one",
              next: [{ messageText: "two", next: [{ messageText: "three" }] }, { messageText: "two again" }],
            },
            { messageText: "one again" },
          ],
        },
        { category: "error", code: 5023, messageText: "Unknown compiler option 'x'.", at: 7 },
      ],
    });
    expect(r.ok && writePlainDiagnostics(r.diagnostics)).toBe(text);
  });

  test("a line that is deeper than one level below the line before keeps its spaces", () => {
    const text = "a.ts(1,1): error TS1: top\n      deep\n";
    const r = parsePlainDiagnostics(text);
    expect(r).toEqual({
      ok: true,
      diagnostics: [
        {
          path: "a.ts",
          line: 1,
          character: 1,
          category: "error",
          code: 1,
          messageText: "top",
          at: 1,
          next: [{ messageText: "    deep" }],
        },
      ],
    });
    expect(r.ok && writePlainDiagnostics(r.diagnostics)).toBe(text);
  });

  test("names: spaces, parentheses, a drive, a line break of Windows", () => {
    const r = parsePlainDiagnostics(
      "C:\\my dir\\(group)\\a.ts(10,20): warning TS6133: 'x' is declared but its value is never read.\r\n" +
        "../lib (1)/b.d.ts(2,3): suggestion TS80001: text (4,5): error TS1: inside\r\n",
    );
    expect(r.ok && r.diagnostics.map(d => [d.path, d.line, d.character, d.category, d.code, d.messageText])).toEqual([
      ["C:\\my dir\\(group)\\a.ts", 10, 20, "warning", 6133, "'x' is declared but its value is never read."],
      ["../lib (1)/b.d.ts", 2, 3, "suggestion", 80001, "text (4,5): error TS1: inside"],
    ]);
  });

  test("a line that starts with a category has no file", () => {
    const r = parsePlainDiagnostics("error TS-1: Not ported: checker.getTypeOfExpression (1,2): error TS2: x\n");
    expect(r.ok && r.diagnostics).toEqual([
      {
        category: "error",
        code: -1,
        messageText: "Not ported: checker.getTypeOfExpression (1,2): error TS2: x",
        at: 1,
      },
    ]);
  });

  test("the code of a rule", () => {
    const r = parsePlainDiagnostics("a.js(1,1): error no-debugger: Unexpected 'debugger' statement.\n");
    expect(r.ok && r.diagnostics).toEqual([
      {
        path: "a.js",
        line: 1,
        character: 1,
        category: "error",
        rule: "no-debugger",
        messageText: "Unexpected 'debugger' statement.",
        at: 1,
      },
    ]);
  });

  test.each([
    ["a crash report", "panic: index out of bounds\n", 1],
    ["a code frame", "a.ts(1,1): error TS1005: ';' expected.\n1 | const = ;\n", 2],
    ["an empty line", "a.ts(1,1): error TS1005: ';' expected.\n\nb.ts(1,1): error TS1005: ';' expected.\n", 2],
    ["a chain line first", "  Type 'a' is not assignable to type 'b'.\n", 1],
    ["one space", "a.ts(1,1): error TS1: x\n y\n", 2],
    ["spaces only", "a.ts(1,1): error TS1: x\n    \n", 2],
    ["no line break at the end", "a.ts(1,1): error TS1: x", 1],
    ["no code", "a.ts(1,1): error: x\n", 1],
    ["a summary", "a.ts(1,1): error TS1: x\nFound 1 error in a.ts:1\n", 2],
    ["line zero", "a.ts(0,1): error TS1: x\n", 1],
    ["an unknown category", "a.ts(1,1): fatal TS1: x\n", 1],
    ["a debug log", "[SYS] open(a.ts) = 3\na.ts(1,1): error TS1: x\n", 1],
  ] as [string, string, number][])("a text with %s is refused whole", (_label, text, at) => {
    const r = parsePlainDiagnostics(text);
    expect({ ok: r.ok, at: r.ok ? undefined : r.at }).toEqual({ ok: false, at });
  });

  test("the first section of the baselines of one of 250 cases is the plain format", () => {
    const differ: string[] = [];
    let read = 0;
    for (const path of [...cases().values()].filter(path => sampled(path, 250)).sort()) {
      for (const instance of corpus().enumerateCase(path)) {
        if (instance.status !== "run" || instance.oracle.class !== "E") continue;
        const text = Buffer.from(corpus().oracle(instance)).toString("latin1");
        if (text.startsWith("\x1b[")) continue;
        const lines = text.split("\r\n");
        let end = lines.findIndex(l => l.startsWith("!!! ") || /^==== .* \(\d+ errors\) ====$/s.test(l));
        if (end < 0) end = lines.length;
        while (end > 0 && lines[end - 1] === "") end--;
        // The harness masks the position in a library file, which no tool prints.
        const top = lines
          .slice(0, end)
          .map(l => l.replace(/^(lib.*\.d\.ts)\(--,--\)/i, "$1(1,1)") + "\n")
          .join("");
        const parsed = parsePlainDiagnostics(top);
        read++;
        if (!parsed.ok) differ.push(`${instance.name}: line ${parsed.at}: ${parsed.reason}`);
        else if (writePlainDiagnostics(parsed.diagnostics) !== top) differ.push(`${instance.name}: not written back`);
      }
    }
    expect(differ).toEqual([]);
    expect(read).toBeGreaterThan(10);
  });
});

describe("default check", () => {
  const { createSpawnCheck, probe, runInstance } = runner;
  // Commands that stand for a linter: the fixture reads its operands and does what their lines "//~ " say.
  const command = (fixture: string) => [bunExe(), join(fixtures, fixture)];
  const linter = lazy(() => createSpawnCheck({ command: command("lints-fixture.ts"), env: bunEnv }));
  const C: Instance = { name: "a.ts", status: "run", oracle: { class: "C" } };
  const E: Instance = { name: "a.ts", status: "run", oracle: { class: "E" } };
  // One unit through a check that starts a command: the unit is written below the directory and is the operand.
  const ending = async (instance: Instance, check: Check, content: string, oracle?: () => Uint8Array) => {
    using dir = tempDir("lint-conformance", {});
    const input = unitInput({ unitName: "/.src/a.ts", content });
    const options = { input, oracle: oracle ?? (() => new Uint8Array()), directory: join(String(dir), "instances") };
    return endingOf(await runInstance(instance, check, options));
  };

  test.concurrent.each([
    ["a command that lints", "lints-fixture.ts", { ok: true, reason: "" }],
    [
      "a command that runs its operand",
      "runs-fixture.ts",
      { ok: false, reason: "the command ran the file that it was to check" },
    ],
    [
      "a command that takes the flag and does nothing",
      "silent-fixture.ts",
      { ok: false, reason: "a file with a syntax error gave no error in it (exit code 0)" },
    ],
  ] as [string, string, { ok: boolean; reason: string }][])(
    "the probe: %s",
    async (_label, fixture, verdict) => {
      using dir = tempDir("lint-conformance-probe", {});
      expect(await probe({ command: command(fixture), env: bunEnv, probeDirectory: String(dir) })).toEqual(verdict);
    },
    spawnTimeout,
  );

  test.concurrent(
    "the probe: a command that dies",
    async () => {
      using dir = tempDir("lint-conformance-probe", {});
      const verdict = await probe({ command: command("crashes-fixture.ts"), env: bunEnv, probeDirectory: String(dir) });
      // Windows has no signals: the death of the command is an exit code there.
      const reason = isWindows
        ? "a file without an error: "
        : "a file without an error: the command ended by the signal SIGKILL";
      expect({ ok: verdict.ok, reason: verdict.reason.slice(0, reason.length) }).toEqual({ ok: false, reason });
    },
    spawnTimeout,
  );

  test.concurrent("the probe: a command that is no file", async () => {
    using dir = tempDir("lint-conformance-probe", {});
    const verdict = await probe({
      command: [join(String(dir), "no-such-command")],
      env: bunEnv,
      probeDirectory: String(dir),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toStartWith("a file without an error: the command did not start: ");
  });

  test.concurrent(
    "a command that lints gets the written unit as its operand, and no diagnostic passes an instance without errors",
    async () => {
      expect(await ending(C, linter(), "const x: number = 1;\n")).toEqual({ outcome: "pass", reason: "" });
    },
    spawnTimeout,
  );

  test.concurrent(
    "stderr is read in the plain format, chain lines too: the first section is the oracle's, and that is no pass",
    async () => {
      const unit: InputFile = {
        unitName: "/.src/a.ts",
        content:
          'const x: number = "s";\n' +
          "//~ print {file}(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n" +
          "//~ print   A line of the chain.\n",
      };
      const expected = baselineOf(
        [unit],
        [
          {
            category: "error",
            code: 2322,
            messageText: "Type 'string' is not assignable to type 'number'.",
            next: [{ messageText: "A line of the chain." }],
            location: { file: unit.unitName, start: 6, length: 1 },
            relatedInformation: [],
          },
        ],
      );
      expect(await ending(E, linter(), unit.content, () => expected)).toEqual({
        outcome: "fail",
        reason: "the first section is the oracle's; a baseline needs the lengths and the related information",
        headerOnly: true,
      });
    },
    spawnTimeout,
  );

  test.concurrent(
    "a command that runs its operand gets no instance",
    async () => {
      using dir = tempDir("lint-conformance", {});
      const mark = join(String(dir), "the-instance-ran");
      const runs = createSpawnCheck({
        command: command("runs-fixture.ts"),
        env: bunEnv,
        probeDirectory: join(String(dir), "probe"),
      });
      const result = await ending(C, runs, `require("node:fs").writeFileSync(${JSON.stringify(mark)}, "");\n`);
      expect(result.outcome).toBe("unavailable");
      expect(result.reason).toContain("the command ran the file that it was to check");
      expect(readdirSync(String(dir))).toEqual(["probe"]);
    },
    spawnTimeout,
  );

  test.concurrent.each([
    ["an exit code that is none of 0, 1 and 2", "//~ exit 7\n", "the command ended with the exit code 7"],
    ["the exit code of a refusal", "//~ print error: no\n//~ exit 1\n", "the command refused: error: no"],
    [
      "a line of no form",
      "//~ print Bun has crashed\n//~ exit 0\n",
      "stderr line 1 is neither a diagnostic nor a line of a message chain: Bun has crashed",
    ],
    [
      "an error and the exit code 0",
      "//~ print {file}(1,1): error TS1: x\n//~ exit 0\n",
      "the exit code is 0 and stderr has 1 errors",
    ],
    ["no error and the exit code 2", "//~ exit 2\n", "the exit code is 2 and stderr has no error"],
    ["text on stdout", "//~ stdout hello\n", "the command wrote to stdout: hello"],
    [
      "a file that is not of the instance",
      "//~ print /etc/passwd(1,1): error TS1: x\n",
      "stderr line 1 names a file that is not of the instance: /etc/passwd",
    ],
    [
      "an error of the command",
      "//~ print error internal-error: an assertion of the checker\n",
      "the command reports an error of its own: an assertion of the checker",
    ],
    // Windows has no signals.
    ...(isWindows ? [] : [["a signal", "//~ kill SIGKILL\n", "the command ended by the signal SIGKILL"]]),
  ] as [string, string, string][])(
    "a run that breaks the rules is never an empty list of diagnostics: %s",
    async (_label, orders, reason) => {
      const result = await ending(C, linter(), orders);
      expect(result.outcome).not.toBe("pass");
      expect(result.reason).toContain(reason);
    },
    spawnTimeout,
  );

  test.concurrent.each([
    [
      "a stand-in",
      "//~ print error internal-stand-in: checker.getTypeOfExpression\n",
      { outcome: "provisional", reason: "the check reached 1 stand-ins: checker.getTypeOfExpression" },
    ],
    [
      "the code -1",
      "//~ print error TS-1: Pre-emit (1) and post-emit (2) diagnostic counts do not match!\n",
      { outcome: "fail", reason: "a diagnostic has the code -1" },
    ],
  ] as [string, string, { outcome: string; reason: string }][])(
    "never equal to an oracle without errors: %s",
    async (_label, orders, want) => {
      expect(await ending(C, linter(), orders)).toEqual(want);
    },
    spawnTimeout,
  );
});

describe("listed instances", () => {
  const { emptyCheck, replayCheck } = runner;
  const E = [
    "ArrowFunctionExpression1.ts",
    "ClassDeclaration10.ts",
    "abstractPropertyNegative(target=es2015).ts",
    "castingTuple.ts",
  ];
  const batch = [...E.map(name => ({ name, list: "E" as const })), { name: "2dArrays.ts", list: "C" as const }];

  test("a batch passes when the oracle is replayed, and fails its names of list E when nothing is reported", async () => {
    using dir = tempDir("lint-conformance", {});
    expect(await failuresOf(batch, replayCheck(corpusRun.oracle), String(dir))).toEqual([]);
    const silent = await failuresOf(batch, emptyCheck, String(dir));
    expect(silent.map(f => [f.name, f.outcome])).toEqual(E.map(name => [name, "fail"]));
  });

  test("a name in the list of the other class, a skipped instance and a name of no instance are failures", async () => {
    using dir = tempDir("lint-conformance", {});
    const wrong = [
      { name: "2dArrays.ts", list: "E" as const },
      { name: "abstractPropertyNegative(target=es5).ts", list: "E" as const },
      { name: "noSuchCase.ts", list: "C" as const },
    ];
    const failures = await failuresOf(wrong, emptyCheck, String(dir));
    expect(failures.map(f => [f.name, f.outcome]).sort()).toEqual([
      ["2dArrays.ts", "fail"],
      ["abstractPropertyNegative(target=es5).ts", "skip"],
      ["noSuchCase.ts", "unsupported"],
    ]);
  });
});

describe("expectations.json", () => {
  const { createSpawnCheck, formatExpectations, parseExpectations, sampleListed } = runner;
  const text = readFileSync(join(home, "expectations.json"), "utf8");
  const lists: Expectations = parseExpectations(text);
  // A debug or sanitizer build starts a process in about a second: it runs a sample of the lists, a release build runs them all.
  const listed = sampleListed(lists, small ? 16 : Infinity);
  const check = lazy(() => createSpawnCheck({ command: [bunExe()], env: bunEnv }));

  test("is in the form that the update writes", () => {
    expect(formatExpectations(lists)).toBe(text);
  });

  // One batch at a time: a batch keeps as many processes in flight as it may, and a second batch beside it would double them.
  test.each(groupsOf(listed, small ? 8 : 64).map((g, k) => [k + 1, g] as const))(
    "every listed instance is a run instance of its list and passes: batch %d",
    async (_k, batch) => {
      using dir = tempDir("lint-conformance", {});
      const failures = await failuresOf(batch, check(), String(dir));
      // The first failures in full and the number of all: a binary that cannot lint fails every name for one reason.
      expect({ failed: failures.length, first: failures.slice(0, 5) }).toEqual({ failed: 0, first: [] });
    },
    small ? 120_000 : 30_000,
  );
});
