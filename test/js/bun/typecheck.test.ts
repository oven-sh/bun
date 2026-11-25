// End-to-end runtime tests for the `Bun.TypeChecker` API (see
// tmp/ts7-js-api-survey/implementation-plan.md §§2.2–2.3, 3, 4, 7.1).
//
// The API is asynchronous only: TypeScript errors resolve a snapshot as
// diagnostics, while invalid arguments, closed roots and stale views reject
// or throw with the plan's exact error codes. Only `Bun.TypeChecker` is
// publicly constructible; snapshot, project and program objects come from
// their parents.
//
// Every test runs in-process against small `tempDir` projects. No network,
// no hardcoded ports, no sleeps. Type-level coverage lives in
// test/integration/bun-types/fixture/type-checker.ts.
import { describe, expect, test } from "bun:test";
import { normalizeBunSnapshot, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLOSED = "ERR_BUN_TYPE_CHECKER_CLOSED";
const DISPOSED = "ERR_BUN_TYPE_CHECKER_SNAPSHOT_DISPOSED";
const INVALID_TYPE = "ERR_INVALID_ARG_TYPE";
const INVALID_VALUE = "ERR_INVALID_ARG_VALUE";

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
  // `any` until packages/bun-types declares the surface; the runtime shape is
  // pinned here so a declaration/runtime mismatch fails loudly, not silently.
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
  return snapshot
    .getProjects()
    .map((p: any) => normPath(p.configFileName, dir))
    .sort();
}

/** `updateSnapshot` may reject or throw synchronously for invalid shapes; either must carry the exact code. */
async function expectUpdateRejected(checker: any, update: any, code: string) {
  let promise: Promise<any>;
  try {
    promise = checker.updateSnapshot(update);
  } catch (error: any) {
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    return;
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

describe("Bun.TypeChecker: clean project and TS2322", () => {
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

    const pos = source.indexOf("42");
    expect(normDiagnostics(diagnostics, String(dir))).toEqual([
      {
        fileName: normPath(join(String(dir), "a.ts"), String(dir)),
        pos,
        end: pos + 2,
        line: 1,
        column: pos + 1,
        endLine: 1,
        endColumn: pos + 3,
        code: 2322,
        category: "error",
        text: "Type 'number' is not assignable to type 'string'.",
      },
    ]);
    // The UTF-16 span must slice the source back to the offending token.
    expect(source.slice(diagnostics[0].pos, diagnostics[0].end)).toBe("42");
  });

  test("positions are UTF-16 code units, not UTF-8 bytes", async () => {
    // A non-BMP emoji is one UTF-16 code unit pair (2 units) but 4 UTF-8 bytes.
    const source = `const label = "😀";\nexport const answer: string = 42;\n`;
    using dir = project({ "a.ts": source });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const [diagnostic] = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");

    const pos = source.indexOf("42");
    expect(diagnostic.pos).toBe(pos);
    expect(diagnostic.end).toBe(pos + 2);
    expect(new TextEncoder().encode(source.slice(0, pos)).length).not.toBe(pos);
    expect(source.slice(diagnostic.pos, diagnostic.end)).toBe("42");
  });

  test("an update with no projects resolves to an empty snapshot", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot();
    expect(snapshot.getProjects()).toEqual([]);
    expect(snapshot.getProject("tsconfig.json")).toBeUndefined();
  });
});

describe("Bun.TypeChecker: config diagnostics", () => {
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
      expect(normPath(diagnostic.fileName, String(dir))).toBe(normPath(join(String(dir), "tsconfig.json"), String(dir)));
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

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].category).toBe("error");
    expect(typeof diagnostics[0].code).toBe("number");
    expect(typeof diagnostics[0].text).toBe("string");
    expect(normPath(diagnostics[0].fileName, String(dir))).toBe(normPath(join(String(dir), "tsconfig.json"), String(dir)));
  });

  test("a project with zero diagnostics still appears in getProjects()", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(snapshot.getProjects()).toHaveLength(1);
    expect(await snapshot.getProjects()[0].program.getDiagnostics()).toEqual([]);
  });
});

describe("Bun.TypeChecker: messageChain and relatedInformation", () => {
  test("nested elaboration is preserved as a full messageChain", async () => {
    using dir = project({
      "a.ts": `interface User { id: number; name: string }\nconst u: User = { id: "oops", name: "ada" };\nexport {};\n`,
    });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const [diagnostic] = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");

    expect(diagnostic.code).toBe(2322);
    expect(diagnostic.category).toBe("error");
    // The whole nested structure, not just the top-level text.
    expect(diagnostic.messageChain?.map((entry: any) => normDiagnostic(entry, String(dir)))).toEqual([
      {
        code: 2322,
        category: "error",
        text: "Types of property 'id' are incompatible.",
        messageChain: [
          {
            code: 2322,
            category: "error",
            text: "Type 'string' is not assignable to type 'number'.",
          },
        ],
      },
    ]);
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
        line: 3,
        column: 3,
        code: 2741,
        category: "message",
        text: "'email' is declared here.",
      },
    ]);
  });
});

describe("Bun.TypeChecker: file filtering and ordering", () => {
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
    expect(normDiagnostics(all, String(dir)).map((d: any) => `${d.fileName}:${d.line}:${d.column}:TS${d.code}`)).toEqual([
      `${normPath(join(String(dir), "a.ts"), String(dir))}:1:24:TS2322`,
      `${normPath(join(String(dir), "b.ts"), String(dir))}:1:24:TS2322`,
    ]);

    // A second read returns the same order.
    expect(normDiagnostics(await program.getDiagnostics(), String(dir))).toEqual(normDiagnostics(all, String(dir)));

    const onlyA = await program.getDiagnostics("a.ts");
    expect(onlyA).toHaveLength(1);
    expect(normPath(onlyA[0].fileName, String(dir))).toBe(normPath(join(String(dir), "a.ts"), String(dir)));

    // File-URL form filters identically.
    expect(normDiagnostics(await program.getDiagnostics(pathToFileURL(join(String(dir), "b.ts"))), String(dir))).toEqual(
      normDiagnostics(await program.getDiagnostics("b.ts"), String(dir)),
    );

    expect(await program.getDiagnostics("clean.ts")).toEqual([]);
    expect(await program.getDiagnostics("does/not/exist.ts")).toEqual([]);
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

describe("Bun.TypeChecker: project lifecycle", () => {
  test("multiple explicit projects, duplicate opens, balanced closes, and unmatched close", async () => {
    const config = (extra: object = {}) => JSON.stringify({ compilerOptions: JSON.parse(tsconfig).compilerOptions, ...extra });
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
    expect(configNames(both, String(dir))).toEqual([one, two].sort());

    // Opening the same project again does not duplicate it.
    using reopened = await checker.updateSnapshot({ openProjects: ["one/tsconfig.json"] });
    expect(configNames(reopened, String(dir))).toEqual([one, two].sort());

    // Duplicate opens in one call are reference-counted: one close leaves it open.
    using stillOpen = await checker.updateSnapshot({ closeProjects: ["one/tsconfig.json"] });
    expect(configNames(stillOpen, String(dir))).toEqual([one, two].sort());

    using closed = await checker.updateSnapshot({ closeProjects: ["one/tsconfig.json"] });
    expect(configNames(closed, String(dir))).toEqual([two]);

    // Closing an unopened project is an idempotent no-op.
    using noOp = await checker.updateSnapshot({ closeProjects: ["never/opened/tsconfig.json"] });
    expect(configNames(noOp, String(dir))).toEqual([two]);

    // Close-and-reopen in one call reloads the desired project.
    using reloaded = await checker.updateSnapshot({
      closeProjects: ["two/tsconfig.json"],
      openProjects: ["two/tsconfig.json"],
    });
    expect(configNames(reloaded, String(dir))).toEqual([two]);
    expect((await reloaded.getProject("two/tsconfig.json").program.getDiagnostics()).map((d: any) => d.code)).toEqual([2322]);
  });

  test("getProject resolves relative, absolute, directory and file-URL forms", async () => {
    using dir = project({ "sub/tsconfig.json": tsconfig, "sub/a.ts": `export const a: number = 1;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["sub/tsconfig.json"] });
    const expected = normPath(join(String(dir), "sub", "tsconfig.json"), String(dir));

    for (const form of [
      "sub/tsconfig.json",
      join(String(dir), "sub", "tsconfig.json"),
      "sub",
      join(String(dir), "sub"),
      pathToFileURL(join(String(dir), "sub", "tsconfig.json")),
      pathToFileURL(join(String(dir), "sub")),
    ] as const) {
      const found = snapshot.getProject(form as any);
      expect(found).toBeDefined();
      expect(normPath(found.configFileName, String(dir))).toBe(expected);
    }
    expect(snapshot.getProject("missing/tsconfig.json")).toBeUndefined();
  });

  test("referenced projects appear and a shared file is checked in each project", async () => {
    const composite = JSON.stringify({
      compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, composite: true, outDir: "dist" },
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
});

describe("Bun.TypeChecker: source overlays", () => {
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
    expect((await missing.getProject("tsconfig.json").program.getDiagnostics("index.ts")).map((d: any) => d.code)).toContain(
      2307,
    );

    using provided = await checker.updateSnapshot({
      sourceChanges: new Map([["virtual.ts", `export const value: number = 1;\n`]]),
    });
    expect(await provided.getProject("tsconfig.json").program.getDiagnostics()).toEqual([]);

    using broken = await checker.updateSnapshot({
      sourceChanges: new Map([["virtual.ts", `export const value: string = "x";\n`]]),
    });
    expect((await broken.getProject("tsconfig.json").program.getDiagnostics("virtual.ts")).map((d: any) => d.code)).toEqual([
      2322,
    ]);

    // Removing the virtual-only override removes the file from the next check.
    using removed = await checker.updateSnapshot({ sourceChanges: new Map([["virtual.ts", null]]) });
    expect((await removed.getProject("tsconfig.json").program.getDiagnostics("index.ts")).map((d: any) => d.code)).toContain(
      2307,
    );
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
    expect((await redeclared.getProject("tsconfig.json").program.getDiagnostics("a.ts")).map((d: any) => d.code)).toEqual([
      2322,
    ]);
  });

  test("disk edits are observed by updateSnapshot({}) without a file-change hint", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using before = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(await before.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    writeFileSync(join(String(dir), "a.ts"), `export const answer: string = 42;\n`);

    using after = await checker.updateSnapshot({});
    expect((await after.getProject("tsconfig.json").program.getDiagnostics("a.ts")).map((d: any) => d.code)).toEqual([2322]);
    // The old snapshot still shows the old disk state.
    expect(await before.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);
  });
});

describe("Bun.TypeChecker: immutability", () => {
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

describe("Bun.TypeChecker: disposal", () => {
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

describe("Bun.TypeChecker: concurrent update ordering", () => {
  test("queued updates A and B are isolated per call and delivered in order", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using seed = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(await seed.getProject("tsconfig.json").program.getDiagnostics("a.ts")).toEqual([]);

    const deliveryOrder: string[] = [];
    const promiseA = checker
      .updateSnapshot({ sourceChanges: new Map([["a.ts", `export const answer: string = "a";\n`]]) })
      .then((snapshot: any) => {
        deliveryOrder.push("a");
        return snapshot;
      });
    const promiseB = checker
      .updateSnapshot({ sourceChanges: new Map([["a.ts", `export const answer: boolean = true;\n`]]) })
      .then((snapshot: any) => {
        deliveryOrder.push("b");
        return snapshot;
      });
    const [snapshotA, snapshotB] = await Promise.all([promiseA, promiseB]);

    expect(deliveryOrder).toEqual(["a", "b"]);
    const textA = (await snapshotA.getProject("tsconfig.json").program.getDiagnostics("a.ts")).map((d: any) => d.text);
    const textB = (await snapshotB.getProject("tsconfig.json").program.getDiagnostics("a.ts")).map((d: any) => d.text);
    expect(textA).toEqual(["Type 'string' is not assignable to type 'number'."]);
    expect(textB).toEqual(["Type 'boolean' is not assignable to type 'number'."]);
    snapshotA.dispose();
    snapshotB.dispose();
  });
});

describe("Bun.TypeChecker: close during queued work", () => {
  test("close rejects undelivered and new updates, is repeatable, and drains", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    const checker = makeChecker(String(dir));

    using seed = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const pending1 = checker.updateSnapshot({});
    const pending2 = checker.updateSnapshot({ sourceChanges: new Map([["a.ts", `export const answer: string = 42;\n`]]) });
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

describe("Bun.TypeChecker: validation", () => {
  test("invalid constructor options throw with the exact validation code", () => {
    expectSyncCode(() => new (Bun as any).TypeChecker({ cwd: 42 }), INVALID_TYPE);
    expectSyncCode(() => new (Bun as any).TypeChecker({ cwd: new URL("https://example.invalid/x") }), INVALID_VALUE);
    expectSyncCode(() => new (Bun as any).TypeChecker({ cwd: "a\0b" }), INVALID_VALUE);
    expectSyncCode(() => new (Bun as any).TypeChecker({ cwd: new URL("node:fs") }), INVALID_VALUE);
  });

  test("invalid updates reject with the exact validation code", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    await expectUpdateRejected(checker, "nope", INVALID_TYPE);
    await expectUpdateRejected(checker, { openProjects: [42] }, INVALID_TYPE);
    await expectUpdateRejected(checker, { openProjects: [null] }, INVALID_TYPE);
    await expectUpdateRejected(checker, { openProjects: ["a\0b"] }, INVALID_VALUE);
    await expectUpdateRejected(checker, { openProjects: [new URL("https://example.invalid/tsconfig.json")] }, INVALID_VALUE);
    await expectUpdateRejected(checker, { closeProjects: [{}] }, INVALID_TYPE);
    await expectUpdateRejected(checker, { sourceChanges: { "a.ts": "x" } }, INVALID_TYPE);
    await expectUpdateRejected(checker, { sourceChanges: new Map([["a.ts", 42]]) }, INVALID_TYPE);
    // `undefined` is invalid: removal must be spelled `null`.
    await expectUpdateRejected(checker, { sourceChanges: new Map([["a.ts", undefined]]) }, INVALID_TYPE);
    await expectUpdateRejected(checker, { sourceChanges: new Map([[new URL("https://example.invalid/a.ts"), "x"]]) }, INVALID_VALUE);
    await expectUpdateRejected(checker, { sourceChanges: new Map([["a\0b", "x"]]) }, INVALID_VALUE);
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

describe("Bun.TypeChecker: incomplete and read failures", () => {
  test("an ordinary missing module resolves as TS2307, never as an adapter failure", async () => {
    // §4.1/§7.1 item 12: `ERR_BUN_TYPE_CHECKER_READ_FAILED` and
    // `ERR_BUN_TYPE_CHECKER_INCOMPLETE` cover adapter-level I/O that would
    // otherwise look clean. They are unit-tested at the native adapter layer
    // (deterministic across platforms); this end-to-end guard pins the other
    // side of the boundary — a normal "cannot find file" must stay a diagnostic.
    using dir = project({ "a.ts": `import "./does-not-exist";\nexport {};\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    const diagnostics = await snapshot.getProject("tsconfig.json").program.getDiagnostics("a.ts");
    expect(diagnostics.map((d: any) => d.code)).toEqual([2307]);
    expect(diagnostics[0].category).toBe("error");
  });

  test("filtering by an unreadable-looking path returns [] rather than a false clean project error", async () => {
    using dir = project({ "a.ts": `export const answer: number = 42;\n` });
    await using checker = makeChecker(String(dir));

    using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });
    expect(await snapshot.getProject("tsconfig.json").program.getDiagnostics("no/such/file.ts")).toEqual([]);
  });
});
