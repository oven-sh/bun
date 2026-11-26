// End-to-end runtime tests for the `Bun.TypeChecker` API.
//
// The API is asynchronous only: TypeScript errors resolve a snapshot as
// diagnostics, while invalid arguments, closed roots and stale views reject
// or throw with specific error codes. Only `Bun.TypeChecker` is publicly
// constructible; snapshot, project and program objects come from their
// parents.
//
// Every test runs against small `tempDir` projects. No network, no hardcoded
// ports, no sleeps. Type-level coverage lives in
// test/integration/bun-types/fixture/type-checker.ts.
import { describe, expect, test } from "bun:test";
import { typeCheckerSnapshotDataLiveCount as live } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { bunEnv, bunExe, isRoot, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import differentialCases from "../../cli/check/differential-cases.json";

const CLOSED = "ERR_BUN_TYPE_CHECKER_CLOSED";
const DISPOSED = "ERR_BUN_TYPE_CHECKER_SNAPSHOT_DISPOSED";
const INVALID_TYPE = "ERR_INVALID_ARG_TYPE";
const INVALID_VALUE = "ERR_INVALID_ARG_VALUE";
const READ_FAILED = "ERR_BUN_TYPE_CHECKER_READ_FAILED";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
    skipLibCheck: true,
  },
});

function project(files: Record<string, string>) {
  return tempDir("bun-typecheck", {
    "tsconfig.json": tsconfig,
    "console.d.ts": `declare var console: { log(...args: unknown[]): void };\n`,
    ...files,
  });
}

function makeChecker(dir: string): any {
  return new (Bun as any).TypeChecker({ cwd: dir });
}

function normPath(fileName: string | undefined, dir: string): string | undefined {
  return fileName === undefined ? undefined : normalizeBunSnapshot(fileName, dir);
}

function normDiagnostic(diagnostic: any, dir: string): any {
  if (diagnostic === undefined) return undefined;
  const { fileName, messageChain, relatedInformation, ...rest } = diagnostic;
  return {
    ...rest,
    fileName: normPath(fileName, dir),
    messageChain: messageChain?.map((entry: any) => normDiagnostic(entry, dir)),
    relatedInformation: relatedInformation?.map((entry: any) => normDiagnostic(entry, dir)),
  };
}

function normDiagnostics(diagnostics: readonly any[], dir: string): any[] {
  return diagnostics.map(diagnostic => normDiagnostic(diagnostic, dir));
}

function configNames(snapshot: any, dir: string): string[] {
  return snapshot.getProjects().map((p: any) => normPath(p.configFileName, dir));
}

/**
 * `updateSnapshot` *rejects* for invalid arguments and a closed root; only
 * the constructor throws synchronously. This helper pins the rejection
 * channel rather than accepting either.
 */
async function expectUpdateRejected(checker: any, update: any, code: string) {
  let promise: Promise<any>;
  try {
    promise = checker.updateSnapshot(update);
  } catch {
    throw new Error("updateSnapshot threw synchronously; expected a rejected Promise");
  }
  await expect(async () => await promise).toThrowWithCodeAsync(Error, code);
}

function expectSyncCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error: any) {
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected a throw with code ${code}, but the call returned`);
}

describe.concurrent("Bun.TypeChecker: clean project and TS2322", () => {
  test("a clean project resolves with zero diagnostics", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });

    expect(configNames(snapshot, String(dir))).toEqual([normPath(join(String(dir), "tsconfig.json"), String(dir))]);
    const foundProject = snapshot.getProject("tsconfig.json");
    expect(foundProject).toBeDefined();
    expect(await foundProject.program.getDiagnostics()).toEqual([]);
    expect(await foundProject.program.getDiagnostics("a.ts")).toEqual([]);
  });

  test("a type error resolves (does not reject) with the exact TS2322 diagnostic", async () => {
    const source = `export const answer: string = 42;\n`;
    using dir = project({ "a.ts": source });
    await using checker = makeChecker(String(dir));

    // Reaching this line at all proves the snapshot resolved.
    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics();

    // The checker (like tsc) reports TS2322 on the declarator name `answer`,
    // not on the initializer `42`.
    const pos = source.indexOf("answer");
    expect(normDiagnostics(diagnostics, String(dir))).toEqual([
      {
        fileName: normPath(join(String(dir), "a.ts"), String(dir)),
        pos,
        end: pos + 6,
        line: 1,
        column: pos + 1,
        endLine: 1,
        endColumn: pos + 7,
        code: 2322,
        category: "error",
        text: "Type 'number' is not assignable to type 'string'.",
      },
    ]);
    // The UTF-16 span must slice the source back to the offending token.
    expect(source.slice(diagnostics[0].pos, diagnostics[0].end)).toBe("answer");
  });

  test("positions are UTF-16 code units, not UTF-8 bytes", async () => {
    // A non-BMP emoji is one UTF-16 code unit pair (2 units) but 4 UTF-8 bytes.
    const source = `const label = "😀";\nexport const answer: string = 42;\n`;
    using dir = project({ "a.ts": source });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const [diagnostic] = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");

    const pos = source.indexOf("answer");
    expect(diagnostic.pos).toBe(pos);
    expect(diagnostic.end).toBe(pos + 6);
    expect(new TextEncoder().encode(source.slice(0, pos)).length).not.toBe(pos);
    expect(source.slice(diagnostic.pos, diagnostic.end)).toBe("answer");
  });

  test("an update with no projects resolves to an empty snapshot", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot();
    expect(snapshot.getProjects()).toEqual([]);
    expect(snapshot.getProject("tsconfig.json")).toBeUndefined();
  });
});

describe.concurrent("Bun.TypeChecker: config diagnostics", () => {
  test("a removed compiler option resolves as a config diagnostic, not a rejection", async () => {
    using dir = project({
      "tsconfig.json": `{ "compilerOptions": { "lib": ["esnext"], "types": [], "suppressImplicitAnyIndexErrors": true } }`,
      "a.ts": `export const answer: number = 42;\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(configNames(snapshot, String(dir))).toEqual([normPath(join(String(dir), "tsconfig.json"), String(dir))]);
    const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics();

    // Config diagnostics are reported against the tsconfig itself.
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(normPath(diagnostic.fileName, String(dir))).toBe(
        normPath(join(String(dir), "tsconfig.json"), String(dir)),
      );
      expect(diagnostic.category).toBe("error");
    }
    expect(diagnostics.map((d: any) => `TS${d.code}: ${d.text}`)).toEqual([
      "TS5023: Unknown compiler option 'suppressImplicitAnyIndexErrors'.",
    ]);
  });

  test("malformed tsconfig JSON resolves as a config diagnostic, not a rejection", async () => {
    using dir = project({
      "tsconfig.json": `{ "compilerOptions": { `,
      "a.ts": `export const answer: number = 42;\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics();

    // A malformed config still matches the TypeChecker contract: diagnostics,
    // not a rejection. The config diagnostic itself is on the tsconfig; the
    // checker may also surface unrelated diagnostics (e.g. a lib conflict).
    expect(diagnostics.length).toBeGreaterThan(0);
    const configDiagnostics = diagnostics.filter(
      (d: any) => normPath(d.fileName, String(dir)) === normPath(join(String(dir), "tsconfig.json"), String(dir)),
    );
    expect(configDiagnostics.length).toBeGreaterThan(0);
    expect(configDiagnostics[0].category).toBe("error");
    expect(typeof configDiagnostics[0].code).toBe("number");
    expect(typeof configDiagnostics[0].text).toBe("string");
  });

  test("a project with zero diagnostics still appears in getProjects()", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(snapshot.getProjects()).toHaveLength(1);
    expect(await snapshot.getProjects()[0].program.getDiagnostics()).toEqual([]);
  });
});

describe.concurrent("Bun.TypeChecker: messageChain and relatedInformation", () => {
  test("nested elaboration is preserved in relatedInformation", async () => {
    using dir = project({
      "a.ts": `interface User { id: number; name: string }\nconst u: User = { id: "oops", name: "ada" };\nexport {};\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const [diagnostic] = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");

    expect(diagnostic.code).toBe(2322);
    expect(diagnostic.category).toBe("error");
    // The whole related structure, not just the top-level text. The checker
    // reports property elaboration as related info (TS6500), not a messageChain.
    expect(Array.isArray(diagnostic.relatedInformation)).toBe(true);
    expect(diagnostic.relatedInformation).toHaveLength(1);
    const related = diagnostic.relatedInformation[0];
    expect(related.code).toBe(6500);
    expect(related.category).toBe("message");
    expect(related.text).toBe("The expected type comes from property 'id' which is declared here on type 'User'");
    expect(normPath(related.fileName, String(dir))).toBe(normPath(join(String(dir), "a.ts"), String(dir)));
  });

  test("a real messageChain carries pos/end 0, code, category and text without fileName or line", async () => {
    using dir = project({
      "a.ts": `const value: number = 1;\nvalue();\nexport {};\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const [diagnostic] = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");

    expect(diagnostic.code).toBe(2349);
    expect(diagnostic.category).toBe("error");
    expect(diagnostic.text).toBe("This expression is not callable.\n  Type 'Number' has no call signatures.");
    // The entire chain entry, not just the top-level text. Like typescript-go
    // chain entries are diagnostics without a file: pos and end are 0.
    expect(diagnostic.messageChain).toEqual([
      {
        pos: 0,
        end: 0,
        code: 2757,
        category: "error",
        text: "Type 'Number' has no call signatures.",
      },
    ]);
    const entry = diagnostic.messageChain[0];
    expect("fileName" in entry).toBe(false);
    expect("line" in entry).toBe(false);
  });

  test("related information points at the declaration in another file", async () => {
    using dir = project({
      "types.ts": `export interface User {\n  id: number;\n  email: string;\n}\n`,
      "index.ts": `import type { User } from "./types";\nconst ada: User = { id: 1 };\nexport {};\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const [diagnostic] = await snapshot.getProject("tsconfig.json").program.getDiagnostics("index.ts");

    expect(diagnostic.code).toBe(2741);
    expect(diagnostic.relatedInformation?.map((entry: any) => normDiagnostic(entry, String(dir)))).toEqual([
      {
        fileName: normPath(join(String(dir), "types.ts"), String(dir)),
        pos: 40,
        end: 45,
        line: 3,
        column: 3,
        endLine: 3,
        endColumn: 8,
        code: 2728,
        category: "message",
        text: "'email' is declared here.",
      },
    ]);
  });
});

describe.concurrent("Bun.TypeChecker: file filtering and ordering", () => {
  test("filtering is stable, unfiltered order is preserved, and unmatched files return []", async () => {
    using dir = project({
      "a.ts": `export const a: string = 1;\n`,
      "b.ts": `export const b: string = 2;\n`,
      "clean.ts": `export const c: number = 3;\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const program = snapshot.getProject("tsconfig.json").program;

    const all = await program.getDiagnostics();
    expect(
      normDiagnostics(all, String(dir)).map((d: any) => `${d.fileName}:${d.line}:${d.column}:TS${d.code}`),
    ).toEqual([
      `${normPath(join(String(dir), "a.ts"), String(dir))}:1:14:TS2322`,
      `${normPath(join(String(dir), "b.ts"), String(dir))}:1:14:TS2322`,
    ]);

    // A second read returns the same order.
    expect(normDiagnostics(await program.getDiagnostics(), String(dir))).toEqual(normDiagnostics(all, String(dir)));

    const onlyA = await program.getDiagnostics("a.ts");
    expect(onlyA).toHaveLength(1);
    expect(normPath(onlyA[0].fileName, String(dir))).toBe(normPath(join(String(dir), "a.ts"), String(dir)));

    // File-URL form filters identically.
    expect(
      normDiagnostics(await program.getDiagnostics(pathToFileURL(join(String(dir), "b.ts"))), String(dir)),
    ).toEqual(normDiagnostics(await program.getDiagnostics("b.ts"), String(dir)));

    expect(await program.getDiagnostics("clean.ts")).toEqual([]);
    expect(await program.getDiagnostics("does/not/exist.ts")).toEqual([]);
  });

  test("identical messages at different positions of one file are all reported", async () => {
    using dir = project({
      "a.ts": `export const a: string = 1;\nexport const b: string = 2;\nexport const c: string = 3;\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");
    expect(diagnostics.map((d: any) => [d.line, d.code])).toEqual([
      [1, 2322],
      [2, 2322],
      [3, 2322],
    ]);
  });

  test("related information stays attached when filtering by the top-level file", async () => {
    using dir = project({
      "types.ts": `export interface User {\n  id: number;\n  email: string;\n}\n`,
      "index.ts": `import type { User } from "./types";\nconst ada: User = { id: 1 };\nexport {};\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const program = snapshot.getProject("tsconfig.json").program;

    const filtered = await program.getDiagnostics("index.ts");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].relatedInformation).toHaveLength(1);
    expect(normPath(filtered[0].relatedInformation[0].fileName, String(dir))).toBe(
      normPath(join(String(dir), "types.ts"), String(dir)),
    );
    // Filtering by the related file alone does not surface the top-level diagnostic.
    expect(await program.getDiagnostics("types.ts")).toEqual([]);
  });
});

describe.concurrent("Bun.TypeChecker: project lifecycle", () => {
  test("multiple explicit projects, duplicate opens, balanced closes, and unmatched close", async () => {
    const config = (extra: object = {}) =>
      JSON.stringify({ compilerOptions: JSON.parse(tsconfig).compilerOptions, ...extra });
    using dir = project({
      "one/tsconfig.json": config({ include: ["*.ts"] }),
      "one/a.ts": `export const a: string = 1;\n`,
      "two/tsconfig.json": config({ include: ["*.ts"] }),
      "two/b.ts": `export const b: string = 2;\n`,
    });
    await using checker = makeChecker(String(dir));
    const one = normPath(join(String(dir), "one", "tsconfig.json"), String(dir));
    const two = normPath(join(String(dir), "two", "tsconfig.json"), String(dir));

    using both = await checker.updateSnapshot({ openProjects: ["one/tsconfig.json", "two/tsconfig.json"] });
    expect(configNames(both, String(dir))).toEqual([one, two]);

    // Opening a project that is already open does nothing, in the same call or in a later one.
    using reopened = await checker.updateSnapshot({
      openProjects: ["one/tsconfig.json", "one/tsconfig.json"],
    });
    expect(configNames(reopened, String(dir))).toEqual([one, two]);

    // Like typescript-go's API session, a project is held once: one close releases it.
    using closed = await checker.updateSnapshot({ closeProjects: ["one/tsconfig.json"] });
    expect(configNames(closed, String(dir))).toEqual([two]);

    // Closing a project that is not open is an idempotent no-op.
    using noOp = await checker.updateSnapshot({ closeProjects: ["one/tsconfig.json", "never/opened/tsconfig.json"] });
    expect(configNames(noOp, String(dir))).toEqual([two]);

    // Both lists are matched against the projects open before the call: naming an open project in both
    // closes it, and naming a closed project in both opens it.
    using closedAgain = await checker.updateSnapshot({
      closeProjects: ["two/tsconfig.json"],
      openProjects: ["two/tsconfig.json"],
    });
    expect(configNames(closedAgain, String(dir))).toEqual([]);
    using openedAgain = await checker.updateSnapshot({
      closeProjects: ["two/tsconfig.json"],
      openProjects: ["two/tsconfig.json"],
    });
    expect(configNames(openedAgain, String(dir))).toEqual([two]);
    expect(
      (await openedAgain.getProject("two/tsconfig.json").program.getDiagnostics()).map((d: any) => d.code),
    ).toEqual([2322]);
  });

  test("getProject resolves relative, absolute and file-URL forms of a config file, never a directory", async () => {
    using dir = project({ "sub/tsconfig.json": tsconfig, "sub/a.ts": `export const a: number = 1;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["sub/tsconfig.json"] });
    const expected = normPath(join(String(dir), "sub", "tsconfig.json"), String(dir));

    for (const form of [
      "sub/tsconfig.json",
      join(String(dir), "sub", "tsconfig.json"),
      pathToFileURL(join(String(dir), "sub", "tsconfig.json")),
    ] as const) {
      const found = snapshot.getProject(form as any);
      expect(found).toBeDefined();
      expect(normPath(found.configFileName, String(dir))).toBe(expected);
    }
    expect(snapshot.getProject("missing/tsconfig.json")).toBeUndefined();
    // A directory does not stand for the tsconfig.json inside it.
    expect(snapshot.getProject("sub")).toBeUndefined();
  });

  test("a directory is not a project, and the tsconfig.json inside it is not checked", async () => {
    using dir = project({ "sub/tsconfig.json": tsconfig, "sub/a.ts": `export const a: string = 1;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["sub"] });
    expect(snapshot.getProjects()).toEqual([]);
    expect(snapshot.getProject("sub")).toBeUndefined();
    expect(snapshot.getProject("sub/tsconfig.json")).toBeUndefined();
  });

  test("a config file that does not exist is no project, and appears once it is created", async () => {
    using dir = project({ "a.ts": `export const a: string = 1;\n` });
    await using checker = makeChecker(String(dir));

    using missing = await checker.updateSnapshot({ openProjects: ["later.json", "tsconfig.json"] });
    expect(configNames(missing, String(dir))).toEqual([normPath(join(String(dir), "tsconfig.json"), String(dir))]);
    expect(missing.getProject("later.json")).toBeUndefined();

    writeFileSync(join(String(dir), "later.json"), tsconfig);
    using created = await checker.updateSnapshot({});
    expect(configNames(created, String(dir))).toEqual([
      normPath(join(String(dir), "later.json"), String(dir)),
      normPath(join(String(dir), "tsconfig.json"), String(dir)),
    ]);
    expect((await created.getProject("later.json").program.getDiagnostics()).map((d: any) => d.code)).toEqual([2322]);
  });

  test("referenced projects appear and a shared file is checked in each project", async () => {
    // Composite projects require `rootDir` covering the shared file; without
    // it the check stops with TS6059 before type checking (verified against
    // `bun check` on the same fixture).
    const composite = JSON.stringify({
      compilerOptions: {
        ...JSON.parse(tsconfig).compilerOptions,
        composite: true,
        declaration: true,
        outDir: "dist",
        rootDir: "..",
      },
      include: ["*.ts", "../shared/*.ts"],
    });
    using dir = project({
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./one" }, { path: "./two" }] }),
      "shared/s.ts": `export const wrong: number = "";\n`,
      "one/tsconfig.json": composite,
      "one/a.ts": `export const a: number = 1;\n`,
      "two/tsconfig.json": composite,
      "two/a.ts": `export const a: number = 1;\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const names = configNames(snapshot, String(dir));
    expect(names).toContain(normPath(join(String(dir), "tsconfig.json"), String(dir)));
    expect(names).toContain(normPath(join(String(dir), "one", "tsconfig.json"), String(dir)));
    expect(names).toContain(normPath(join(String(dir), "two", "tsconfig.json"), String(dir)));

    // The shared file's error is reported by each project that includes it.
    for (const name of ["one/tsconfig.json", "two/tsconfig.json"]) {
      const diagnostics = await snapshot.getProject(name).program.getDiagnostics("shared/s.ts");
      expect(diagnostics.map((d: any) => d.code)).toEqual([2322]);
    }
  });

  test("projects are ordered by config file path, not by the order they are built", async () => {
    const composite = JSON.stringify({
      compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, composite: true, declaration: true, outDir: "dist" },
      include: ["*.ts"],
    });
    using dir = project({
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./z" }, { path: "./a" }] }),
      "z/tsconfig.json": composite,
      "z/z.ts": `export const z: string = 1;\n`,
      "a/tsconfig.json": composite,
      "a/a.ts": `export const a: string = 1;\n`,
    });
    await using checker = makeChecker(String(dir));
    const name = (...parts: string[]) => normPath(join(String(dir), ...parts), String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(configNames(snapshot, String(dir))).toEqual([
      name("a", "tsconfig.json"),
      name("tsconfig.json"),
      name("z", "tsconfig.json"),
    ]);

    // Each project keeps its own diagnostics after the reorder.
    const fileOf = async (config: string) =>
      (await snapshot.getProject(config).program.getDiagnostics()).map((d: any) => normPath(d.fileName, String(dir)));
    expect(await fileOf("a/tsconfig.json")).toEqual([name("a", "a.ts")]);
    expect(await fileOf("z/tsconfig.json")).toEqual([name("z", "z.ts")]);
    expect(await fileOf("tsconfig.json")).toEqual([]);

    // Opening the same projects directly gives the same order whatever the open order is.
    using direct = await checker.updateSnapshot({ openProjects: ["z/tsconfig.json", "a/tsconfig.json"] });
    expect(configNames(direct, String(dir))).toEqual(configNames(snapshot, String(dir)));
  });
});

describe.concurrent("Bun.TypeChecker: diagnostics in bundled libraries", () => {
  test("getDiagnostics accepts a bundled:/// name and compares it verbatim", async () => {
    using dir = project({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, skipLibCheck: false },
      }),
      "a.ts": `declare class Array<T> { foo: T }\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const program = snapshot.getProject("tsconfig.json").program;
    const all = await program.getDiagnostics();
    const inLib = all.filter((d: any) => d.fileName === "bundled:///libs/lib.es5.d.ts");
    expect(inLib.length).toBeGreaterThan(0);

    const filtered = await program.getDiagnostics("bundled:///libs/lib.es5.d.ts");
    expect(filtered.map((d: any) => [d.fileName, d.code, d.pos])).toEqual(
      inLib.map((d: any) => [d.fileName, d.code, d.pos]),
    );
    expect(await program.getDiagnostics("bundled:///libs/lib.nope.d.ts")).toEqual([]);
    // A user file filter never matches a bundled name, and the other way around.
    expect((await program.getDiagnostics("a.ts")).every((d: any) => d.fileName === join(String(dir), "a.ts"))).toBe(
      true,
    );
  });
});

describe.concurrent("Bun.TypeChecker: source overlays", () => {
  // Only the case-sensitive behavior can run here: Linux file systems are case-sensitive, and the
  // case-insensitive canonicalization is covered by the bun_type_checker unit tests.
  test("on a case-sensitive file system, paths that differ in case are different files", async () => {
    using dir = project({ "probe.txt": "", "main.ts": `import "./Extra";\nimport "./extra";\n` });
    if (existsSync(join(String(dir), "PROBE.txt"))) return;
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({
      openProjects: ["tsconfig.json"],
      sourceChanges: new Map([
        ["Extra.ts", `export const a: string = 1;\n`],
        ["extra.ts", `export const b: number = "";\n`],
      ]),
    });
    const program = snapshot.getProject("tsconfig.json").program;
    expect((await program.getDiagnostics("Extra.ts")).map((d: any) => d.code)).toEqual([2322]);
    expect((await program.getDiagnostics("EXTRA.ts")).map((d: any) => d.code)).toEqual([]);
    expect(snapshot.getProject("TSCONFIG.json")).toBeUndefined();
  });

  test("overriding an existing file, replacing it, and removing the override reveals disk", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using clean = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(await clean.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    using errored = await checker.updateSnapshot({
      sourceChanges: new Map([["a.ts", `export const answer: string = 42;\n`]]),
    });
    const erroredDiagnostics = await errored.getProject("tsconfig.json").program.getDiagnostics("a.ts");
    expect(erroredDiagnostics.map((d: any) => d.code)).toEqual([2322]);

    // The earlier snapshot still shows the pre-override state.
    expect(await clean.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    // Replacing the override with fixed text clears the error.
    using fixed = await checker.updateSnapshot({
      sourceChanges: new Map([["a.ts", `export const answer: number = 42;\n`]]),
    });
    expect(await fixed.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    // Removing the override reveals the (clean) disk file.
    using revealed = await checker.updateSnapshot({ sourceChanges: new Map([["a.ts", null]]) });
    expect(await revealed.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);
  });

  test("a virtual-only source file exists only while its override is present", async () => {
    using dir = project({ "index.ts": `import { value } from "./virtual";\nexport const out: number = value;\n` });
    await using checker = makeChecker(String(dir));

    using missing = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(
      (await missing.getProject("tsconfig.json").program.getDiagnostics("index.ts")).map((d: any) => d.code),
    ).toContain(2307);

    using provided = await checker.updateSnapshot({
      sourceChanges: new Map([["virtual.ts", `export const value: number = 1;\n`]]),
    });
    expect(await provided.getProject("tsconfig.json").program.getDiagnostics()).toEqual([]);

    using broken = await checker.updateSnapshot({
      sourceChanges: new Map([["virtual.ts", `export const value: string = "x";\n`]]),
    });
    // The overlay's type flows to `index.ts`, which reports the mismatch there.
    expect(
      (await broken.getProject("tsconfig.json").program.getDiagnostics("index.ts")).map((d: any) => d.code),
    ).toEqual([2322]);

    // Removing the virtual-only override removes the file from the next check.
    using removed = await checker.updateSnapshot({ sourceChanges: new Map([["virtual.ts", null]]) });
    expect(
      (await removed.getProject("tsconfig.json").program.getDiagnostics("index.ts")).map((d: any) => d.code),
    ).toContain(2307);
  });

  test("declaration-file overlays participate in checking", async () => {
    using dir = project({ "a.ts": `export const out: number = answer;\n` });
    await using checker = makeChecker(String(dir));

    using declared = await checker.updateSnapshot({
      openProjects: ["tsconfig.json"],
      sourceChanges: new Map([["types.d.ts", `declare const answer: number;\n`]]),
    });
    expect(await declared.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    using redeclared = await checker.updateSnapshot({
      sourceChanges: new Map([["types.d.ts", `declare const answer: string;\n`]]),
    });
    expect(
      (await redeclared.getProject("tsconfig.json").program.getDiagnostics("a.ts")).map((d: any) => d.code),
    ).toEqual([2322]);
  });

  test("disk edits are observed by updateSnapshot({}) without a file-change hint", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using before = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(await before.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    writeFileSync(join(String(dir), "a.ts"), `export const answer: string = 42;\n`);

    using after = await checker.updateSnapshot({});
    expect((await after.getProject("tsconfig.json").program.getDiagnostics("a.ts")).map((d: any) => d.code)).toEqual([
      2322,
    ]);
    // The old snapshot still shows the old disk state.
    expect(await before.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);
  });
});

describe.concurrent("Bun.TypeChecker: immutability", () => {
  test("mutating a returned diagnostic or array does not affect later reads", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const program = snapshot.getProject("tsconfig.json").program;

    const first = await program.getDiagnostics();
    expect(first).toHaveLength(1);
    (first as any)[0].text = "mutated";
    (first as any)[0].code = 0;
    (first as any).push({ code: 9999, category: "error", text: "injected" });

    const second = await program.getDiagnostics();
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
    expect(second).toHaveLength(1);
    expect(second[0].code).toBe(2322);
    expect(second[0].text).toBe("Type 'number' is not assignable to type 'string'.");
  });

  test("later source and project changes never mutate an earlier snapshot", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    await using checker = makeChecker(String(dir));

    using first = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const firstDiagnostics = await first.getProject("tsconfig.json").program.getDiagnostics("a.ts");

    using second = await checker.updateSnapshot({
      sourceChanges: new Map([["a.ts", `export const answer: number = 42;\n`]]),
    });
    expect(await second.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    expect(await first.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual(firstDiagnostics);
    expect(firstDiagnostics.map((d: any) => d.code)).toEqual([2322]);
  });
});

describe.concurrent("Bun.TypeChecker: disposal", () => {
  test("dispose() is idempotent and stale access throws ERR_BUN_TYPE_CHECKER_SNAPSHOT_DISPOSED", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    await using checker = makeChecker(String(dir));

    const snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const foundProject = snapshot.getProject("tsconfig.json");

    snapshot.dispose();
    snapshot.dispose();
    expect(() => snapshot.dispose()).not.toThrow();

    expectSyncCode(() => snapshot.getProjects(), DISPOSED);
    expectSyncCode(() => snapshot.getProject("tsconfig.json"), DISPOSED);
    expectSyncCode(() => foundProject.configFileName, DISPOSED);
    expectSyncCode(() => foundProject.program, DISPOSED);
    await expect(async () => await foundProject.program.getDiagnostics()).toThrowWithCodeAsync(Error, DISPOSED);
  });

  test("Symbol.dispose invalidates the snapshot like dispose()", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    const snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    snapshot[Symbol.dispose]();
    // Idempotent across both spellings.
    snapshot.dispose();

    expectSyncCode(() => snapshot.getProjects(), DISPOSED);
  });

  test("disposing one snapshot leaves another usable; root close invalidates all", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    const checker = makeChecker(String(dir));

    const first = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const second = await checker.updateSnapshot({});
    first.dispose();

    expectSyncCode(() => first.getProjects(), DISPOSED);
    expect((await second.getProject("tsconfig.json").program.getDiagnostics()).map((d: any) => d.code)).toEqual([2322]);

    await checker.close();
    expectSyncCode(() => second.getProjects(), DISPOSED);
  });
});

describe.concurrent("Bun.TypeChecker: concurrent update ordering", () => {
  test("queued updates A and B are isolated per call and delivered in order", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using seed = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(await seed.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    const deliveryOrder: string[] = [];
    // Each overlay must disagree with the *other* call's disk baseline to be
    // observable: `string = 42` errors against `string`, `boolean = 1` errors
    // against `boolean`. (The original `string = "a"` / `boolean = true`
    // overlays are both clean and cannot prove isolation.)
    const promiseA = checker
      .updateSnapshot({ sourceChanges: new Map([["a.ts", `export const answer: string = 42;\n`]]) })
      .then((snapshot: any) => {
        deliveryOrder.push("a");
        return snapshot;
      });
    const promiseB = checker
      .updateSnapshot({ sourceChanges: new Map([["a.ts", `export const answer: boolean = 1;\n`]]) })
      .then((snapshot: any) => {
        deliveryOrder.push("b");
        return snapshot;
      });
    const [snapshotA, snapshotB] = await Promise.all([promiseA, promiseB]);

    expect(deliveryOrder).toEqual(["a", "b"]);
    const textA = (await snapshotA.getProject("tsconfig.json").program.getDiagnostics("a.ts")).map((d: any) => d.text);
    const textB = (await snapshotB.getProject("tsconfig.json").program.getDiagnostics("a.ts")).map((d: any) => d.text);
    expect(textA).toEqual(["Type 'number' is not assignable to type 'string'."]);
    expect(textB).toEqual(["Type 'number' is not assignable to type 'boolean'."]);
    snapshotA.dispose();
    snapshotB.dispose();
  });
});

describe.concurrent("Bun.TypeChecker: close during queued work", () => {
  test("close rejects undelivered and new updates, is repeatable, and drains", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    const checker = makeChecker(String(dir));

    using seed = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const pending1 = checker.updateSnapshot({});
    const pending2 = checker.updateSnapshot({
      sourceChanges: new Map([["a.ts", `export const answer: string = 42;\n`]]),
    });
    const closePromise = checker.close();

    await expect(async () => await pending1).toThrowWithCodeAsync(Error, CLOSED);
    await expect(async () => await pending2).toThrowWithCodeAsync(Error, CLOSED);
    // Settlement, not elapsed time: close resolves once native work has drained.
    await closePromise;

    await expectUpdateRejected(checker, {}, CLOSED);
    expect(checker.close()).toBe(closePromise);
    await checker.close();
    // Root close invalidated the seed snapshot.
    expectSyncCode(() => seed.getProjects(), DISPOSED);
  });

  test("closing an idle checker resolves without scheduling a check", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    const checker = makeChecker(String(dir));

    await checker.close();
    await checker.close();
    await expectUpdateRejected(checker, { openProjects: ["tsconfig.json"] }, CLOSED);
  });

  test("Symbol.asyncDispose delegates to close()", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    const checker = makeChecker(String(dir));

    using seed = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    await checker[Symbol.asyncDispose]();

    expectSyncCode(() => seed.getProjects(), DISPOSED);
    await expectUpdateRejected(checker, {}, CLOSED);
  });
});

describe.concurrent("Bun.TypeChecker: validation", () => {
  test("invalid constructor options throw with the exact validation code", () => {
    expectSyncCode(() => new (Bun as any).TypeChecker({ cwd: 42 }), INVALID_TYPE);
    expectSyncCode(() => new (Bun as any).TypeChecker({ cwd: new URL("https://example.invalid/x") }), INVALID_VALUE);
    expectSyncCode(() => new (Bun as any).TypeChecker({ cwd: "a\0b" }), INVALID_VALUE);
    expectSyncCode(() => new (Bun as any).TypeChecker({ cwd: new URL("node:fs") }), INVALID_VALUE);
  });

  test("a relative cwd resolves against the process cwd at construction", async () => {
    using dir = project({ "sub/a.ts": `export const answer: string = 42;\n` });
    const script = `
const checker = new Bun.TypeChecker({ cwd: "sub/.." });
using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics();
console.log(JSON.stringify(diagnostics.map(d => [d.code, require("node:path").basename(d.fileName)])));
await checker.close();
`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe('[[2322,"a.ts"]]\n');
    expect(exitCode).toBe(0);
  });

  test("invalid updates reject with the exact validation code", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    await expectUpdateRejected(checker, "nope", INVALID_TYPE);
    await expectUpdateRejected(checker, { openProjects: [42] }, INVALID_TYPE);
    await expectUpdateRejected(checker, { openProjects: [null] }, INVALID_TYPE);
    await expectUpdateRejected(checker, { openProjects: ["a\0b"] }, INVALID_VALUE);
    await expectUpdateRejected(
      checker,
      { openProjects: [new URL("https://example.invalid/tsconfig.json")] },
      INVALID_VALUE,
    );
    await expectUpdateRejected(checker, { closeProjects: [{}] }, INVALID_TYPE);
    await expectUpdateRejected(checker, { sourceChanges: { "a.ts": "x" } }, INVALID_TYPE);
    await expectUpdateRejected(checker, { sourceChanges: new Map([["a.ts", 42]]) }, INVALID_TYPE);
    // `undefined` is invalid: removal must be spelled `null`.
    await expectUpdateRejected(checker, { sourceChanges: new Map([["a.ts", undefined]]) }, INVALID_TYPE);
    await expectUpdateRejected(
      checker,
      { sourceChanges: new Map([[new URL("https://example.invalid/a.ts"), "x"]]) },
      INVALID_VALUE,
    );
    await expectUpdateRejected(checker, { sourceChanges: new Map([["a\0b", "x"]]) }, INVALID_VALUE);
  });

  test("a throwing openProjects getter rejects with that error and changes nothing", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    const boom = new Error("getter boom");
    await expect(
      checker.updateSnapshot({
        get openProjects() {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);

    using snapshot = await checker.updateSnapshot({});
    expect(snapshot.getProjects()).toEqual([]);
  });

  test("a throwing sourceChanges Map iterator rejects with that error", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    const boom = new Error("entries boom");
    const patchedEntries = new Map([["a.ts", "x"]]);
    patchedEntries.entries = () => {
      throw boom;
    };
    await expect(checker.updateSnapshot({ sourceChanges: patchedEntries })).rejects.toBe(boom);

    const patchedNext = new Map([["a.ts", "x"]]);
    patchedNext.entries = (() => ({
      next() {
        throw boom;
      },
    })) as any;
    await expect(checker.updateSnapshot({ sourceChanges: patchedNext })).rejects.toBe(boom);

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(snapshot.getProjects()).toHaveLength(1);
  });

  test("a getter that closes the checker makes the update reject as closed", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    const checker = makeChecker(String(dir));

    let closing: Promise<void> | undefined;
    await expectUpdateRejected(
      checker,
      {
        get openProjects() {
          closing = checker.close();
          return ["tsconfig.json"];
        },
      },
      CLOSED,
    );
    await closing;
  });

  test("a failed validation applies no part of the update", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using good = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(await good.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    // The first entry is a valid error-introducing override; the second is invalid.
    // Whole-update validation must not apply the valid half.
    await expectUpdateRejected(
      checker,
      {
        sourceChanges: new Map([
          ["a.ts", `export const answer: string = 42;\n`],
          ["b.ts", undefined],
        ]),
      },
      INVALID_TYPE,
    );

    using after = await checker.updateSnapshot({});
    expect(await after.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);
  });
});

describe.concurrent("Bun.TypeChecker: incomplete and read failures", () => {
  test("an ordinary missing module resolves as TS2307, never as an adapter failure", async () => {
    // `ERR_BUN_TYPE_CHECKER_READ_FAILED` and `ERR_BUN_TYPE_CHECKER_INCOMPLETE`
    // cover adapter-level I/O that would otherwise look clean. This guard pins
    // the other side of the boundary: a normal "cannot find file" must stay a
    // diagnostic.
    using dir = project({ "a.ts": `import "./does-not-exist";\nexport {};\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");
    // A side-effect import (`import "./x"`) is TS2882; a named import is TS2307.
    expect(diagnostics.map((d: any) => d.code)).toEqual([2882]);
    expect(diagnostics[0].category).toBe("error");
  });

  test.skipIf(isWindows || isRoot)(
    "a check that cannot read a source file rejects and the queue keeps going",
    async () => {
      using dir = project({ "a.ts": `export const answer: number = 42;\n`, "locked.ts": `export {};\n` });
      chmodSync(join(String(dir), "locked.ts"), 0);
      await using checker = makeChecker(String(dir));

      await expectUpdateRejected(checker, { openProjects: ["tsconfig.json"] }, READ_FAILED);

      // The failed job released its slot: later updates run and settle.
      using snapshot = await checker.updateSnapshot({ closeProjects: ["tsconfig.json"] });
      expect(snapshot.getProjects()).toEqual([]);
    },
  );

  test("filtering by an unreadable-looking path returns [] rather than a false clean project error", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(await snapshot.getProject("tsconfig.json").program.getDiagnostics("no/such/file.ts")).toEqual([]);
  });
});

describe.concurrent("Bun.TypeChecker: UTF-16 positions", () => {
  // Every case computes the expected `pos`/`end` from JavaScript string
  // indexing (UTF-16 code units). For non-ASCII cases the UTF-8 byte offset
  // differs, so a byte-offset implementation cannot pass by accident. The
  // declared name is always `answer` (see the TS2322 test above). The BOM
  // case is special: the checker strips the BOM before reporting positions,
  // so the expected `pos` is the index into the BOM-stripped source.
  const cases: ReadonlyArray<{
    name: string;
    source: string;
    stripBOM?: boolean;
  }> = [
    {
      name: "ASCII baseline",
      source: `export const answer: string = 42;\n`,
    },
    {
      name: "non-BMP emoji before the span (4 UTF-8 bytes, 2 UTF-16 units)",
      source: `const label = "😀";\nexport const answer: string = 42;\n`,
    },
    {
      name: "combining characters before the span (e + U+0301 is 2 UTF-16 units, 3 UTF-8 bytes)",
      source: `const label = "é";\nexport const answer: string = 42;\n`,
    },
    {
      name: "CRLF line endings before the span",
      source: `const label = "x";\r\nexport const answer: string = 42;\r\n`,
    },
    {
      name: "UTF-8 BOM before the span (BOM is 3 UTF-8 bytes, 1 UTF-16 unit)",
      source: `﻿const label = "x";\nexport const answer: string = 42;\n`,
      stripBOM: true,
    },
  ];

  for (const { name, source, stripBOM } of cases) {
    test(name, async () => {
      using dir = project({ "a.ts": source });
      await using checker = makeChecker(String(dir));

      using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
      const [diagnostic] = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");

      const stripped = stripBOM ? source.replace(/^﻿/, "") : source;
      const pos = stripped.indexOf("answer");
      expect(diagnostic.code).toBe(2322);
      expect(diagnostic.pos).toBe(pos);
      expect(diagnostic.end).toBe(pos + 6);
      expect(stripped.slice(diagnostic.pos, diagnostic.end)).toBe("answer");
      // For non-ASCII cases the UTF-8 byte offset must differ from the
      // UTF-16 offset: this proves the case distinguishes the two units.
      const byteOffset = new TextEncoder().encode(stripped.slice(0, pos)).length;
      if (!stripBOM && /[^\x00-\x7F]/.test(stripped.slice(0, pos))) expect(byteOffset).not.toBe(pos);
    });
  }

  test("a lone surrogate before the span goes through the WTF-8/WTF-16 path", async () => {
    const source = `const label = "\uD83D";\nexport const answer: string = 42;\n`;
    using dir = project({ "a.ts": source });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const [diagnostic] = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");

    const pos = source.indexOf("answer");
    expect(diagnostic.code).toBe(2322);
    expect(diagnostic.pos).toBe(pos);
    expect(diagnostic.end).toBe(pos + 6);
    expect(source.slice(diagnostic.pos, diagnostic.end)).toBe("answer");
  });

  test("a lone surrogate inside a string literal does not lose the error on the declared name", async () => {
    // A lone surrogate in a string literal is valid source text for the
    // checker (it round-trips through WTF-8). Assigning it to a `number`
    // declarator produces a TS2322 whose `answer` span must be at its
    // UTF-16 position; the lone surrogate must not swallow the error.
    const source = `export const answer: number = "\uD83D";\n`;
    using dir = project({ "a.ts": source });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");
    expect(diagnostics.map((d: any) => d.code)).toContain(2322);
    const [diagnostic] = diagnostics.filter((d: any) => d.code === 2322);
    expect(diagnostic.pos).toBe(source.indexOf("answer"));
    expect(source.slice(diagnostic.pos, diagnostic.end)).toBe("answer");
  });

  test("spaces and non-ASCII characters in paths", async () => {
    using dir = project({
      "my dir/ünïcode/a.ts": `export const answer: string = 42;\n`,
    });
    // Point the project at the nested file via an explicit include.
    writeFileSync(
      join(String(dir), "tsconfig.json"),
      JSON.stringify({
        compilerOptions: JSON.parse(tsconfig).compilerOptions,
        include: ["my dir/ünïcode/a.ts"],
      }),
    );
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics();
    expect(diagnostics.map((d: any) => d.code)).toEqual([2322]);
    expect(normPath(diagnostics[0].fileName, String(dir))).toBe(
      normPath(join(String(dir), "my dir/ünïcode/a.ts"), String(dir)),
    );
  });

  test("a file-URL cwd and file-URL project selectors resolve like native paths", async () => {
    using dir = project({ "sub/a.ts": `export const answer: string = 42;\n` });
    // `cwd` as a file URL must behave exactly like the native directory.
    await using checker = new (Bun as any).TypeChecker({ cwd: pathToFileURL(String(dir)) });

    using snapshot = await checker.updateSnapshot({
      openProjects: [pathToFileURL(join(String(dir), "tsconfig.json"))],
    });
    const diagnostics = await snapshot
      .getProject(pathToFileURL(join(String(dir), "tsconfig.json")))
      .program.getDiagnostics(pathToFileURL(join(String(dir), "sub/a.ts")));
    expect(diagnostics.map((d: any) => d.code)).toEqual([2322]);
    // Output fileName is always an absolute native path, never a URL.
    expect(diagnostics[0].fileName).not.toContain("file://");
  });
});

describe.concurrent("Bun.TypeChecker: platform path semantics", () => {
  test("POSIX: a backslash is a literal filename character, not a separator", async () => {
    if (process.platform === "win32") return;
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    // `no\such` names a single file with a backslash in it, not `no/such`.
    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(snapshot.getProject("no\\such/tsconfig.json")).toBeUndefined();
    expect(await snapshot.getProject("tsconfig.json").program.getDiagnostics("no\\such/a.ts")).toEqual([]);
  });

  test("Windows: both separators resolve to the same project", async () => {
    if (process.platform !== "win32") return;
    using dir = project({ "sub/a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["sub\\tsconfig.json"] });
    const expected = normPath(join(String(dir), "sub", "tsconfig.json"), String(dir));
    expect(normPath(snapshot.getProject("sub/tsconfig.json").configFileName, String(dir))).toBe(expected);
    expect(normPath(snapshot.getProject("sub\\tsconfig.json").configFileName, String(dir))).toBe(expected);
    // Absolute native form with backslashes.
    expect(normPath(snapshot.getProject(join(String(dir), "sub", "tsconfig.json")).configFileName, String(dir))).toBe(
      expected,
    );
  });

  test("Windows: a UNC path selector resolves", async () => {
    if (process.platform !== "win32") return;
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    // The temp dir itself may be UNC or drive-letter; either way the absolute
    // native form (with `\\` or `C:\`) must round-trip through getProject.
    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const configFileName: string = snapshot.getProject("tsconfig.json").configFileName;
    expect(configFileName).toBe(join(String(dir), "tsconfig.json"));
    expect(snapshot.getProject(configFileName)).toBeDefined();
  });

  test("output paths use the platform separator", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const [diagnostic] = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");
    expect(diagnostic.fileName).toBe(join(String(dir), "a.ts"));
    // No internal checker form such as `/C:/...` ever leaks to JS.
    expect(diagnostic.fileName.startsWith("/" + String(dir).slice(0, 2))).toBe(false);
    expect(normalizeBunSnapshot(diagnostic.fileName, String(dir))).not.toContain("/C:/");
  });
});

describe("Bun.TypeChecker: GC and ownership", () => {
  const counts = () => {
    const { objectTypeCounts } = heapStats();
    return {
      snapshots: objectTypeCounts.TypeCheckerSnapshot ?? 0,
      projects: objectTypeCounts.TypeCheckerProject ?? 0,
      programs: objectTypeCounts.TypeCheckerProgram ?? 0,
    };
  };

  // Each wrapper owns a native ref to its snapshot, so a leaked ref (or a
  // reference cycle between them) keeps the whole chain of wrappers alive.
  async function makeAndDrop(checker: any, n: number, dispose: boolean) {
    for (let i = 0; i < n; i++) {
      const snapshot = await checker.updateSnapshot({});
      const found = snapshot.getProject("tsconfig.json");
      await found.program.getDiagnostics();
      snapshot.getProjects();
      if (dispose) snapshot.dispose();
    }
  }

  for (const dispose of [true, false]) {
    test(`snapshot, project and program wrappers are collected (${dispose ? "disposed" : "not disposed"})`, async () => {
      using dir = project({ "a.ts": `export const answer: string = 42;\n` });
      await using checker = makeChecker(String(dir));
      using seed = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
      await makeAndDrop(checker, 1, dispose);
      Bun.gc(true);
      const before = counts();

      const created = 6;
      await makeAndDrop(checker, created, dispose);
      // Collection is the condition: a few collections may be needed before the
      // wrappers made in the loop above are unreachable.
      let after = counts();
      for (let attempt = 0; attempt < 20 && after.snapshots - before.snapshots > 2; attempt++) {
        Bun.gc(true);
        await Bun.sleep(0);
        after = counts();
      }
      expect({
        snapshots: after.snapshots - before.snapshots <= 2,
        projects: after.projects - before.projects <= 2 * 2,
        programs: after.programs - before.programs <= 2 * 2,
      }).toEqual({ snapshots: true, projects: true, programs: true });
    });
  }

  test("dispose() releases the snapshot's data at once, and only once", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    await using checker = makeChecker(String(dir));
    const snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const program = snapshot.getProject("tsconfig.json").program;
    expect((await program.getDiagnostics("a.ts")).map((d: any) => d.code)).toEqual([2322]);

    // No await between the reads: other tests' snapshots cannot change the count.
    const before = live();
    snapshot.dispose();
    const afterDispose = live();
    snapshot.dispose();
    const afterSecondDispose = live();
    expect({ released: before - afterDispose, again: afterDispose - afterSecondDispose }).toEqual({
      released: 1,
      again: 0,
    });
    // The project and program views still hold the snapshot, but not its data.
    await expect(program.getDiagnostics()).rejects.toMatchObject({ code: DISPOSED });
  });

  test("close() releases the data of every snapshot that is not yet disposed", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    await using checker = makeChecker(String(dir));
    const first = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const second = await checker.updateSnapshot({});
    const disposed = await checker.updateSnapshot({});
    disposed.dispose();

    // No await between the reads: other tests' snapshots cannot change the count.
    const before = live();
    const closing = checker.close();
    const released = before - live();
    await closing;
    expect(released).toBe(2);
    expect(() => first.getProjects()).toThrowWithCode(Error, DISPOSED);
    expect(() => second.getProjects()).toThrowWithCode(Error, DISPOSED);
  });

  test("a live snapshot survives GC and queued checks do not disturb it", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    await using checker = makeChecker(String(dir));

    using live = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const first = await live.getProject("tsconfig.json").program.getDiagnostics("a.ts");

    Bun.gc(true);
    expect(await live.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual(first);

    // Queue two updates behind the live snapshot, then GC again.
    const pending = [
      checker.updateSnapshot({ sourceChanges: new Map([["a.ts", `export const answer: number = 42;\n`]]) }),
      checker.updateSnapshot({ sourceChanges: new Map([["a.ts", `export const answer: string = 42;\n`]]) }),
    ];
    Bun.gc(true);
    expect(await live.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual(first);
    const [fixed, errored] = await Promise.all(pending);
    expect(await fixed.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);
    expect((await errored.getProject("tsconfig.json").program.getDiagnostics("a.ts")).map((d: any) => d.code)).toEqual([
      2322,
    ]);
    fixed.dispose();
    errored.dispose();
  });
});

describe.concurrent("Bun.TypeChecker: worker/realm teardown", () => {
  async function runScript(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const inWorker = (workerSource: string, after: string) => `
const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}], { type: "text/javascript" })));
const { promise, resolve, reject } = Promise.withResolvers();
worker.onmessage = event => resolve(event.data);
worker.onerror = event => reject(event.error ?? event);
const message = await promise;
${after}
`;

  test("a Worker terminated in the middle of a check leaves a process that exits cleanly", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    const workerSource = `
const checker = new Bun.TypeChecker({ cwd: ${JSON.stringify(String(dir))} });
checker.updateSnapshot({ openProjects: ["tsconfig.json"] }).then(
  () => postMessage("delivered"),
  error => postMessage("rejected " + error.code),
);
postMessage("started");
`;
    const { stdout, exitCode } = await runScript(
      inWorker(
        workerSource,
        `
const closed = new Promise(resolve => worker.addEventListener("close", resolve));
worker.terminate();
await closed;
console.log("terminated after", message);
`,
      ),
    );
    expect(stdout).toBe("terminated after started\n");
    expect(exitCode).toBe(0);
  });

  test("a checker used and closed inside a Worker delivers its result to the parent", async () => {
    using dir = project({ "a.ts": `export const answer: string = 42;\n` });
    const workerSource = `
const checker = new Bun.TypeChecker({ cwd: ${JSON.stringify(String(dir))} });
const snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
const codes = (await snapshot.getProjects()[0].program.getDiagnostics()).map(d => d.code);
await checker.close();
postMessage(codes);
`;
    const { stdout, exitCode } = await runScript(
      inWorker(workerSource, `console.log(JSON.stringify(message)); worker.terminate();`),
    );
    expect(stdout).toBe("[2322]\n");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("Bun.TypeChecker: agreement with bun check", () => {
  // The diagnostics of the API must be the diagnostics that `bun check`
  // prints for the same project: same file, position, category, code and
  // first line of the message.
  const cases = Object.entries(differentialCases as Record<string, { files: Record<string, string>; build?: boolean }>)
    .filter(([, it]) => !it.build && Object.keys(it.files).length <= 3 && it.files["a.ts"]?.includes("sentinel"))
    .slice(0, 3);

  test("the sample is not empty", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const [name, it] of cases) {
    test(name, async () => {
      using dir = tempDir("bun-typecheck-differential", it.files as any);
      const cwd = String(dir);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "check"],
        cwd,
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const header = /^(.+)\((\d+),(\d+)\): (error|warning|suggestion|message) TS(\d+): (.*)$/;
      const fromCheck = stdout
        .split("\n")
        .map(line => header.exec(line))
        .filter(match => match !== null)
        .map(
          ([, file, line, column, category, code, text]) => `${file}:${line}:${column} ${category} TS${code} ${text}`,
        )
        .sort();

      await using checker = makeChecker(cwd);
      using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
      const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics();
      const fromApi = diagnostics
        .filter((d: any) => d.fileName !== undefined)
        .map(
          (d: any) =>
            `${relative(cwd, d.fileName).replaceAll("\\", "/")}:${d.line}:${d.column} ${d.category} TS${d.code} ${d.text.split("\n")[0]}`,
        )
        .sort();

      expect(fromApi.length).toBeGreaterThan(0);
      expect(fromApi).toEqual(fromCheck);
    });
  }
});
