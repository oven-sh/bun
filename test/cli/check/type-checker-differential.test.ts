// `Bun.TypeChecker` against TypeScript 7's own API, on the same directories.
//
// The API client and the native executable come from `typescript7` in test/package.json, as in differential.ts:
// `tsc` is the same executable as `tsgo`, and `typescript7/unstable/async` spawns it in API mode. Set `TSC` to use
// another executable. Without one, the tests skip.
//
// Only behavior that `Bun.TypeChecker` shares with that API is asserted. Where the two differ on purpose, or still
// differ, the tests stay away from it: the projects of a snapshot whose config file has nothing but references,
// suggestion diagnostics, syntax errors hiding semantic ones, the order and end of the diagnostics of a config file,
// the `-1` of a message chain entry that has no location, disk edits that no one announces, a config file that appears
// later, and the error model.
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug, isMacOS, isWindows, tempDir } from "harness";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { API } from "typescript7/unstable/async";
import { longLimit } from "../children";
import { tsc, writtenCases } from "./differential";

const CATEGORIES = ["warning", "error", "suggestion", "message"];

const compilerOptions = { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] };
const tsconfig = (extra: object = {}) =>
  JSON.stringify({ compilerOptions: { ...compilerOptions, skipLibCheck: true, ...extra } });

type Chain = {
  file: string | undefined;
  pos: number;
  end: number;
  code: number;
  category: string;
  text: string;
  chain: Chain[] | undefined;
};
type Diag = {
  file: string | undefined;
  pos: number;
  end: number;
  code: number;
  category: string;
  text: string;
  related: Diag[];
  chain?: Chain[] | undefined;
};

interface Update {
  openProjects?: string[];
  closeProjects?: string[];
  /** Source overrides by name, relative to the working directory. `null` removes the override. */
  sources?: Record<string, string | null>;
}
interface Project {
  /** Relative to the working directory, with `/` as the separator. */
  configFileName: string;
  diagnostics(file?: string): Promise<Diag[]>;
  /** TypeScript's: what its config file, program, global and syntactic diagnostics have, which is not about types. */
  beforeTypes?(): Promise<Diag[]>;
}
interface Snapshot {
  projects(): Project[];
  project(configFile: string): Project | undefined;
}
interface Session {
  update(update?: Update): Promise<Snapshot>;
  close(): Promise<void>;
}
type Open = () => Promise<Session>;

// The `lib.*.d.ts` files of the executable of TypeScript 7 are files next to it. Bun's are `bundled:///libs/` names.
const libraries = tsc && dirname(tsc).replaceAll("\\", "/") + "/";

function relName(cwd: string, name: string | undefined) {
  if (name === undefined || name.startsWith("bundled:")) return name;
  const slashed = name.replaceAll("\\", "/");
  if (libraries && slashed.startsWith(libraries) && /^lib\.[^/]*\.d\.ts$/.test(slashed.slice(libraries.length))) {
    return `bundled:///libs/${slashed.slice(libraries.length)}`;
  }
  return relative(cwd, name).replaceAll("\\", "/");
}

const categoryOf = (d: any) => (typeof d.category === "number" ? CATEGORIES[d.category] : d.category);

/** An entry without a location has `pos` and `end` of -1 in TypeScript and 0 here. */
function chainOf(cwd: string, chain: any[] | undefined): Chain[] | undefined {
  if (!chain?.length) return undefined;
  return chain.map(entry => ({
    file: relName(cwd, entry.fileName),
    pos: Math.max(entry.pos, 0),
    end: Math.max(entry.end, 0),
    code: entry.code,
    category: categoryOf(entry),
    text: entry.text,
    chain: chainOf(cwd, entry.messageChain),
  }));
}

function norm(cwd: string, d: any): Diag {
  return {
    file: relName(cwd, d.fileName),
    pos: d.pos,
    end: d.end,
    code: d.code,
    category: categoryOf(d),
    // Bun renders a message chain into `text`. TypeScript keeps it in `messageChain`.
    text: d.text.split("\n")[0],
    related: (d.relatedInformation ?? []).map((it: any) => norm(cwd, it)),
    chain: chainOf(cwd, d.messageChain),
  };
}

const order = (a: Diag, b: Diag) =>
  (a.file ?? "").localeCompare(b.file ?? "") || a.pos - b.pos || a.code - b.code || a.text.localeCompare(b.text);
const sorted = (diagnostics: Diag[]) => [...diagnostics].sort(order);
/** `end` of a diagnostic without a position is -1 in TypeScript and 0 here, and a config file's can be before `pos`. */
const withoutEnd = (diagnostics: Diag[]) => sorted(diagnostics).map(({ end, related, ...rest }) => rest);

function openTheirs(cwd: string): Open {
  return async () => {
    const overrides = new Map<string, string>();
    const key = (path: string) => path.replaceAll("\\", "/");
    const api = new API({
      tsserverPath: tsc!,
      cwd,
      // `undefined` falls back to the file system, which is what removing an override of `Bun.TypeChecker` does.
      fs: {
        readFile: file => overrides.get(key(file)),
        fileExists: file => (overrides.has(key(file)) ? true : undefined),
      },
    });
    const project = (p: any): Project => ({
      configFileName: relName(cwd, p.configFileName)!,
      async beforeTypes() {
        const program = p.program;
        const lists = await Promise.all([
          program.getConfigFileParsingDiagnostics(),
          program.getProgramDiagnostics(),
          program.getGlobalDiagnostics(),
          program.getSyntacticDiagnostics(),
        ]);
        return lists.flat().map((d: any) => norm(cwd, d));
      },
      async diagnostics(file) {
        const program = p.program;
        // `getDiagnostics()` is what `tsc` reports: its declaration diagnostics are only there with `declaration`.
        const lists =
          file === undefined
            ? [
                program.getConfigFileParsingDiagnostics(),
                program.getProgramDiagnostics(),
                program.getGlobalDiagnostics(),
                program.getSyntacticDiagnostics(),
                program.getSemanticDiagnostics(),
                program.getDeclarationDiagnostics(),
              ]
            : [
                program.getSyntacticDiagnostics(file),
                program.getSemanticDiagnostics(file),
                program.getDeclarationDiagnostics(file),
              ];
        // The same diagnostic is a program and a global one.
        const seen = new Map<string, Diag>();
        for (const list of await Promise.all(lists)) {
          for (const d of list) seen.set(JSON.stringify(norm(cwd, d)), norm(cwd, d));
        }
        return [...seen.values()];
      },
    });
    return {
      async update(update = {}) {
        const changed: string[] = [];
        for (const [name, text] of Object.entries(update.sources ?? {})) {
          const path = key(join(cwd, name));
          if (text === null) overrides.delete(path);
          else overrides.set(path, text);
          changed.push(path);
        }
        const snapshot = await api.updateSnapshot({
          openProjects: update.openProjects,
          closeProjects: update.closeProjects,
          ...(changed.length ? { fileChanges: { changed } } : {}),
        });
        return {
          projects: () => snapshot.getProjects().map(project),
          project: file => {
            const found = snapshot.getProject(file);
            return found && project(found);
          },
        };
      },
      close: () => api.close(),
    };
  };
}

function openOurs(cwd: string): Open {
  return async () => {
    const checker = new (Bun as any).TypeChecker({ cwd });
    const project = (p: any): Project => ({
      configFileName: relName(cwd, p.configFileName)!,
      async diagnostics(file) {
        return (await p.program.getDiagnostics(file)).map((d: any) => norm(cwd, d));
      },
    });
    return {
      async update(update = {}) {
        const snapshot = await checker.updateSnapshot({
          openProjects: update.openProjects,
          closeProjects: update.closeProjects,
          ...(update.sources ? { sourceChanges: new Map(Object.entries(update.sources)) } : {}),
        });
        return {
          projects: () => snapshot.getProjects().map(project),
          project: file => {
            const found = snapshot.getProject(file);
            return found && project(found);
          },
        };
      },
      close: () => checker.close(),
    };
  };
}

async function withSession<T>(open: Open, run: (session: Session) => Promise<T>) {
  const session = await open();
  try {
    return await run(session);
  } finally {
    await session.close();
  }
}

/** Runs one scenario against TypeScript 7 and against `Bun.TypeChecker`, on one directory. */
async function onBothSides<T>(
  files: Record<string, string>,
  scenario: (open: Open, cwd: string) => Promise<T>,
): Promise<{ theirs: T; ours: T }> {
  using dir = tempDir("bun-typechecker-differential", files);
  // TypeScript 7 and Bun name a file the way they were given it, so a symbolic link in the path would show.
  const cwd = realpathSync(String(dir));
  const theirs = await scenario(openTheirs(cwd), cwd);
  const ours = await scenario(openOurs(cwd), cwd);
  return { theirs, ours };
}

const names = (snapshot: Snapshot) => snapshot.projects().map(p => p.configFileName);

describe.skipIf(!tsc).concurrent("Bun.TypeChecker agrees with the API of TypeScript 7: projects", () => {
  test("a project is held once: a second open does nothing, one close releases it, and both lists see the old state", async () => {
    const { theirs, ours } = await onBothSides({ "tsconfig.json": tsconfig(), "a.ts": `export {};\n` }, (open, cwd) =>
      withSession(open, async session => {
        const config = "tsconfig.json";
        const counts: number[] = [];
        for (const update of [
          { openProjects: [config, config] },
          { closeProjects: [config] },
          { closeProjects: [config] },
          { openProjects: [config], closeProjects: [config] },
          { openProjects: [config], closeProjects: [config] },
        ]) {
          counts.push(names(await session.update(update)).length);
        }
        return counts;
      }),
    );

    expect(theirs).toEqual([1, 0, 0, 1, 0]);
    expect(ours).toEqual(theirs);
  });

  test("a directory is not a project, and the tsconfig.json in it is not either", async () => {
    const { theirs, ours } = await onBothSides(
      { "tsconfig.json": tsconfig(), "a.ts": `export {};\n` },
      async (open, cwd) => {
        const result: Record<string, string[]> = {};
        for (const [label, selector] of Object.entries({ dot: ".", absolute: cwd })) {
          result[label] = await withSession(open, async session =>
            names(await session.update({ openProjects: [selector] })),
          );
        }
        return result;
      },
    );

    expect(theirs).toEqual({ dot: [], absolute: [] });
    expect(ours).toEqual(theirs);
  });

  test("a relative path names a file in the working directory, whichever project it is in", async () => {
    const { theirs, ours } = await onBothSides(
      {
        "pkg/tsconfig.json": tsconfig(),
        "pkg/a.ts": `export const a: string = 1;\n`,
        "other/tsconfig.json": tsconfig(),
      },
      (open, cwd) =>
        withSession(open, async session => {
          const snapshot = await session.update({ openProjects: ["pkg/tsconfig.json"] });
          return {
            names: names(snapshot),
            relative: snapshot.project("pkg/tsconfig.json") !== undefined,
            absolute: snapshot.project(join(cwd, "pkg", "tsconfig.json")) !== undefined,
            notOpen: snapshot.project("other/tsconfig.json") !== undefined,
            codes: (await snapshot.project("pkg/tsconfig.json")!.diagnostics()).map(d => d.code),
          };
        }),
    );

    expect(theirs).toEqual({
      names: ["pkg/tsconfig.json"],
      relative: true,
      absolute: true,
      notOpen: false,
      codes: [2322],
    });
    expect(ours).toEqual(theirs);
  });

  test("a project that is only referenced is not listed until it is opened", async () => {
    const options = { ...compilerOptions, skipLibCheck: true };
    const { theirs, ours } = await onBothSides(
      {
        "tsconfig.json": JSON.stringify({
          compilerOptions: options,
          files: ["main.ts"],
          references: [{ path: "./lib" }],
        }),
        "main.ts": `export {};\n`,
        "lib/tsconfig.json": JSON.stringify({
          compilerOptions: { ...options, composite: true, declaration: true, noEmit: false, outDir: "dist" },
          include: ["*.ts"],
        }),
        "lib/a.ts": `export const a: string = 1;\n`,
      },
      (open, cwd) =>
        withSession(open, async session => {
          const rootOnly = await session.update({ openProjects: ["tsconfig.json"] });
          const result = { rootOnly: names(rootOnly), lookup: rootOnly.project("lib/tsconfig.json") !== undefined };
          const both = await session.update({ openProjects: ["lib/tsconfig.json"] });
          return {
            ...result,
            both: names(both),
            codes: (await both.project("lib/tsconfig.json")!.diagnostics()).map(d => d.code),
          };
        }),
    );

    expect(theirs).toEqual({
      rootOnly: ["tsconfig.json"],
      lookup: false,
      both: ["lib/tsconfig.json", "tsconfig.json"],
      codes: [2322],
    });
    expect(ours).toEqual(theirs);
  });

  test("an update that opens nothing gives a snapshot with no projects", async () => {
    const { theirs, ours } = await onBothSides({ "tsconfig.json": tsconfig(), "a.ts": `export {};\n` }, (open, cwd) =>
      withSession(open, async session => names(await session.update({}))),
    );

    expect(theirs).toEqual([]);
    expect(ours).toEqual(theirs);
  });
});

describe.skipIf(!tsc).concurrent("Bun.TypeChecker agrees with the API of TypeScript 7: project order", () => {
  const configs = (...dirs: string[]) =>
    Object.fromEntries(
      dirs.flatMap(dir => [
        // Only the names of the projects matter here, and a project without the library is much faster to check.
        [`${dir}/tsconfig.json`, JSON.stringify({ compilerOptions: { noLib: true, types: [] }, files: ["x.ts"] })],
        [`${dir}/x.ts`, `export {};\n`],
      ]),
    );

  // Both compare the whole path byte by byte: `a-b/` is before `a/` because `-` is before `/`, and an upper-case
  // letter and `_` are before a lower-case one.
  test("projects are in the byte order of their config file paths, whatever the order they were opened in", async () => {
    const dirs = ["b", "B2", "a", "_c", "a-b"];
    const opened = dirs.map(dir => `${dir}/tsconfig.json`);
    const { theirs, ours } = await onBothSides(configs(...dirs), async open => ({
      asGiven: await withSession(open, async session => names(await session.update({ openProjects: opened }))),
      reversed: await withSession(open, async session =>
        names(await session.update({ openProjects: [...opened].reverse() })),
      ),
    }));

    const expected = ["B2", "_c", "a-b", "a", "b"].map(dir => `${dir}/tsconfig.json`);
    expect(theirs).toEqual({ asGiven: expected, reversed: expected });
    expect(ours).toEqual(theirs);
  });

  // UTF-8 puts U+FF5E before U+1F600, and UTF-16 puts the surrogate pair before U+FF5E.
  test("projects are in the byte order of UTF-8, not the order of UTF-16 code units", async () => {
    const dirs = ["z", "～", "\u{1f600}"];
    const opened = [...dirs].reverse().map(dir => `${dir}/tsconfig.json`);
    const { theirs, ours } = await onBothSides(configs(...dirs), open =>
      withSession(open, async session => names(await session.update({ openProjects: opened }))),
    );

    expect(theirs).toEqual(dirs.map(dir => `${dir}/tsconfig.json`));
    expect(ours).toEqual(theirs);
  });
});

describe.skipIf(!tsc).concurrent("Bun.TypeChecker agrees with the API of TypeScript 7: diagnostics", () => {
  async function diagnosticsOf(files: Record<string, string>, file?: string) {
    return onBothSides({ "tsconfig.json": tsconfig(), ...files }, (open, cwd) =>
      withSession(open, async session => {
        const snapshot = await session.update({ openProjects: ["tsconfig.json"] });
        return snapshot.project("tsconfig.json")!.diagnostics(file);
      }),
    );
  }

  test("a type error has the same file, range, code, category and text", async () => {
    const { theirs, ours } = await diagnosticsOf({ "a.ts": `const a: string = 1;\n` });

    expect(theirs).toEqual([
      {
        file: "a.ts",
        pos: 6,
        end: 7,
        code: 2322,
        category: "error",
        text: "Type 'number' is not assignable to type 'string'.",
        related: [],
      },
    ]);
    expect(ours).toEqual(theirs);
  });

  test("a syntax error has the same file, range, code, category and text", async () => {
    const { theirs, ours } = await diagnosticsOf({ "a.ts": `const = ;\n` });

    expect(theirs.map(d => d.code)).toEqual([1134]);
    expect(ours).toEqual(theirs);
  });

  test("a removed compiler option is a diagnostic of the config file", async () => {
    const { theirs, ours } = await onBothSides(
      { "tsconfig.json": tsconfig({ baseUrl: "." }), "a.ts": `export {};\n` },
      (open, cwd) =>
        withSession(open, async session =>
          (await session.update({ openProjects: ["tsconfig.json"] })).project("tsconfig.json")!.diagnostics(),
        ),
    );

    expect(theirs.map(d => [d.file, d.code, d.category, d.text])).toEqual([
      ["tsconfig.json", 5102, "error", "Option 'baseUrl' has been removed. Please remove it from your configuration."],
    ]);
    expect(ours).toEqual(theirs);
  });

  test("a config file that is not JSON has the same diagnostics", async () => {
    const { theirs, ours } = await onBothSides(
      { "tsconfig.json": `{ "compilerOptions": { "strict": true, }, "x" }`, "a.ts": `export {};\n` },
      (open, cwd) =>
        withSession(open, async session =>
          (await session.update({ openProjects: ["tsconfig.json"] })).project("tsconfig.json")!.diagnostics(),
        ),
    );

    expect(theirs.map(d => d.code).sort()).toEqual([1005, 1328, 1328]);
    expect(withoutEnd(ours)).toEqual(withoutEnd(theirs));
  });

  test("related information has the same file, range, code, category and text", async () => {
    const { theirs, ours } = await diagnosticsOf({
      "a.ts": `interface A { x: { y: string } }\nconst v: A = { x: { y: 1 } };\nconst dup = 1;\nconst dup = 2;\n`,
    });

    expect(theirs[0].related).toEqual([
      {
        file: "a.ts",
        pos: 19,
        end: 20,
        code: 6500,
        category: "message",
        text: "The expected type comes from property 'y' which is declared here on type '{ y: string; }'",
        related: [],
      },
    ]);
    expect(ours).toEqual(theirs);
  });

  // The name of a library file is not compared: the executable of TypeScript 7 has them as files and Bun has
  // `bundled:///libs/` names, which typecheck.test.ts checks. relName() turns the former into the latter.
  test("a diagnostic in a library has the same position, code and text", async () => {
    const { theirs, ours } = await onBothSides(
      { "tsconfig.json": tsconfig({ skipLibCheck: false }), "a.ts": `declare class Array<T> { foo: T }\n` },
      (open, cwd) =>
        withSession(open, async session => {
          const project = (await session.update({ openProjects: ["tsconfig.json"] })).project("tsconfig.json")!;
          return sorted((await project.diagnostics()).filter(d => d.file?.startsWith("bundled:///")));
        }),
    );

    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every(d => d.file!.startsWith("bundled:///libs/lib."))).toBe(true);
    expect(ours).toEqual(theirs);
  });

  test("the elaboration of a type error is at the location of the error, and each entry has its own line", async () => {
    const { theirs, ours } = await diagnosticsOf({
      "a.ts": `const value: number = 1;\nvalue();\ndeclare function f(a: string): void;\ndeclare function f(a: number): void;\nf(true);\n`,
    });

    const [notCallable, noOverload] = theirs;
    expect(notCallable.chain).toEqual([
      {
        file: "a.ts",
        pos: 25,
        end: 30,
        code: 2757,
        category: "error",
        text: "Type 'Number' has no call signatures.",
        chain: undefined,
      },
    ]);
    expect(noOverload.code).toBe(2769);
    // The overloads are two levels deep, and every entry is where the call is.
    expect(noOverload.chain?.[0].chain?.length).toBeGreaterThan(0);
    for (const entry of noOverload.chain!) {
      expect([entry.file, entry.pos, entry.end]).toEqual([noOverload.file, noOverload.pos, noOverload.end]);
      expect(entry.text).not.toContain("\n");
    }
    expect(ours).toEqual(theirs);
  });

  test("the elaboration of what a program reports about its files and types is not located", async () => {
    // A diagnostic that has no location at all has `pos` and `end` of -1 in TypeScript and 0 here.
    const locationless = (d: Diag) =>
      d.file === undefined ? { ...d, pos: Math.max(d.pos, 0), end: Math.max(d.end, 0) } : d;
    const { theirs, ours } = await onBothSides(
      {
        "types/tsconfig.json": tsconfig({ types: ["not-installed-types"] }),
        "types/a.ts": `export {};\n`,
        "root/tsconfig.json": tsconfig({ rootDir: "src" }),
        "root/src/a.ts": `import "../other/b";\nexport {};\n`,
        "root/other/b.ts": `export {};\n`,
      },
      (open, cwd) =>
        withSession(open, async session => {
          const snapshot = await session.update({ openProjects: ["types/tsconfig.json", "root/tsconfig.json"] });
          const result: Record<string, Diag[]> = {};
          for (const project of snapshot.projects()) {
            result[project.configFileName] = sorted(await project.diagnostics()).map(locationless);
          }
          return result;
        }),
    );

    expect(Object.entries(theirs).map(([config, found]) => [config, found.map(d => d.code)])).toEqual([
      ["root/tsconfig.json", [6059]],
      ["types/tsconfig.json", [2688]],
    ]);
    // The file of the first is where the reference is, and its elaboration is nowhere, which is true of the second too.
    for (const found of Object.values(theirs)) {
      expect(found[0].chain?.length).toBeGreaterThan(0);
      expect(found[0].chain!.map(entry => [entry.file, entry.pos, entry.end])).toEqual(
        found[0].chain!.map(() => [undefined, 0, 0]),
      );
    }
    expect(theirs["root/tsconfig.json"][0].file).toBe("root/src/a.ts");
    expect(ours).toEqual(theirs);
  });

  test("a file that is not in the program is an error, and a clean one is not", async () => {
    const { theirs, ours } = await onBothSides(
      {
        "tsconfig.json": JSON.stringify({ compilerOptions: compilerOptions, include: ["a.ts"] }),
        "a.ts": `export {};\n`,
        "unlisted/b.ts": `export {};\n`,
      },
      (open, cwd) =>
        withSession(open, async session => {
          const project = (await session.update({ openProjects: ["tsconfig.json"] })).project("tsconfig.json")!;
          const result: Record<string, unknown> = {};
          for (const file of ["a.ts", "typo.ts", "unlisted/b.ts"]) {
            result[file] = await project.diagnostics(file).then(
              diagnostics => diagnostics,
              () => "rejected",
            );
          }
          return result;
        }),
    );

    expect(theirs).toEqual({ "a.ts": [], "typo.ts": "rejected", "unlisted/b.ts": "rejected" });
    expect(ours).toEqual(theirs);
  });

  test("a file filter takes a relative or an absolute path and keeps the diagnostics of that file", async () => {
    const { theirs, ours } = await onBothSides(
      {
        "tsconfig.json": tsconfig(),
        "a.ts": `const a: string = 1;\n`,
        "b.ts": `const b: number = "x";\nconst c: boolean = 1;\n`,
        "clean.ts": `export {};\n`,
      },
      (open, cwd) =>
        withSession(open, async session => {
          const project = (await session.update({ openProjects: ["tsconfig.json"] })).project("tsconfig.json")!;
          return {
            all: sorted(await project.diagnostics()),
            relative: sorted(await project.diagnostics("a.ts")),
            absolute: sorted(await project.diagnostics(join(cwd, "b.ts"))),
            clean: await project.diagnostics("clean.ts"),
          };
        }),
    );

    expect(theirs.all.map(d => d.file)).toEqual(["a.ts", "b.ts", "b.ts"]);
    expect(theirs.relative.map(d => d.file)).toEqual(["a.ts"]);
    expect(theirs.absolute.map(d => d.file)).toEqual(["b.ts", "b.ts"]);
    expect(theirs.clean).toEqual([]);
    expect(ours).toEqual(theirs);
  });
});

describe.skipIf(!tsc).concurrent("Bun.TypeChecker agrees with the API of TypeScript 7: source overrides", () => {
  const codesOf = async (snapshot: Snapshot) =>
    (await snapshot.project("tsconfig.json")!.diagnostics()).map(d => [d.file, d.code, d.text]);

  test("an override replaces the text on disk until another replaces it or it is removed, and a snapshot keeps its own", async () => {
    const { theirs, ours } = await onBothSides(
      { "tsconfig.json": tsconfig(), "a.ts": `export const a: string = "on disk";\n` },
      (open, cwd) =>
        withSession(open, async session => {
          const disk = await session.update({ openProjects: ["tsconfig.json"] });
          const first = await session.update({ sources: { "a.ts": `export const a: string = 1;\n` } });
          const second = await session.update({ sources: { "a.ts": `export const a: boolean = 1;\n` } });
          const removed = await session.update({ sources: { "a.ts": null } });
          return {
            disk: await codesOf(disk),
            first: await codesOf(first),
            second: await codesOf(second),
            removed: await codesOf(removed),
            firstAgain: await codesOf(first),
            secondAgain: await codesOf(second),
          };
        }),
    );

    expect(theirs.disk).toEqual([]);
    expect(theirs.first).toEqual([["a.ts", 2322, "Type 'number' is not assignable to type 'string'."]]);
    expect(theirs.second).toEqual([["a.ts", 2322, "Type 'number' is not assignable to type 'boolean'."]]);
    expect(theirs.removed).toEqual([]);
    expect(theirs.firstAgain).toEqual(theirs.first);
    expect(theirs.secondAgain).toEqual(theirs.second);
    expect(ours).toEqual(theirs);
  });

  test("a file that is only an override can be imported, and is gone when the override is", async () => {
    const { theirs, ours } = await onBothSides(
      { "tsconfig.json": tsconfig(), "a.ts": `import { v } from "./virtual";\nexport const n: number = v;\n` },
      (open, cwd) =>
        withSession(open, async session => {
          const without = await session.update({ openProjects: ["tsconfig.json"] });
          const with_ = await session.update({ sources: { "virtual.ts": `export const v: string = "";\n` } });
          const gone = await session.update({ sources: { "virtual.ts": null } });
          return { without: await codesOf(without), with: await codesOf(with_), gone: await codesOf(gone) };
        }),
    );

    expect(theirs.without.map(([, code]) => code)).toEqual([2307]);
    expect(theirs.with.map(([, code]) => code)).toEqual([2322]);
    expect(theirs.gone).toEqual(theirs.without);
    expect(ours).toEqual(theirs);
  });

  test("a declaration file that is only an override takes part in the check", async () => {
    const { theirs, ours } = await onBothSides(
      { "tsconfig.json": tsconfig(), "a.ts": `import { g } from "./types";\nexport const s: string = g;\n` },
      (open, cwd) =>
        withSession(open, async session => {
          await session.update({ openProjects: ["tsconfig.json"] });
          const snapshot = await session.update({ sources: { "types.d.ts": `export declare const g: number;\n` } });
          return codesOf(snapshot);
        }),
    );

    expect(theirs.map(([file, code]) => [file, code])).toEqual([["a.ts", 2322]]);
    expect(ours).toEqual(theirs);
  });
});

// Linux file systems are case-sensitive, so this runs where the working directory's file system is not: by default
// on macOS and on Windows. It checks that a name is the same project, file and override in any case, the way
// TypeScript 7 compares them.
const caseInsensitive = (() => {
  if (!(isMacOS || isWindows)) return false;
  using dir = tempDir("bun-typechecker-case", { "probe.txt": "" });
  return existsSync(join(String(dir), "PROBE.TXT"));
})();

describe
  .skipIf(!tsc || !caseInsensitive)
  .concurrent("Bun.TypeChecker agrees with the API of TypeScript 7: names that differ in case", () => {
    test("one project, one file and one override, whatever the case of the name", async () => {
      const { theirs, ours } = await onBothSides(
        {
          "tsconfig.json": tsconfig(),
          "a.ts": `export const a: string = 1;\n`,
          "b.ts": `export const b: string = 2;\n`,
        },
        (open, cwd) =>
          withSession(open, async session => {
            const snapshot = await session.update({ openProjects: ["tsconfig.json", "TSCONFIG.JSON"] });
            const project = snapshot.project("TsConfig.Json");
            const afterClose = await session.update({ closeProjects: ["TSCONFIG.json"] });
            const reopened = await session.update({ openProjects: ["tsconfig.json"] });
            const overridden = await session.update({ sources: { "A.TS": `export const a: boolean = 1;\n` } });
            return {
              opened: names(snapshot).length,
              found: project !== undefined,
              closed: names(afterClose).length,
              reopened: names(reopened).length,
              filtered: sorted(await project!.diagnostics("A.ts")).map(d => d.file?.toLowerCase()),
              overridden: (await overridden.project("tsconfig.json")!.diagnostics()).map(d => [
                d.file?.toLowerCase(),
                d.text,
              ]),
            };
          }),
      );

      expect(theirs.opened).toBe(1);
      expect(ours).toEqual(theirs);
    });
  });

// Programs where `bun check` and tsc once disagreed (differential-cases.json) are a corpus of everything that a
// checker can get wrong. Each runs as a project of one session of either side, and has to give the same diagnostics.
//
// The API of TypeScript 7 has no `--singleThreaded` and asks a pool of checkers, so on a program whose result depends
// on what is asked first it can differ from its own `tsc`, which `bun check` follows. `tsc` gives 5 diagnostics for
// this one in every mode, as `bun check` and Bun.TypeChecker do, and the API gives a sixth, TS2502.
const dependsOnTheCheckerThatTypeScriptAsks = ["85-R16a/tsconfig.json"];

describe.skipIf(!tsc)("Bun.TypeChecker agrees with the API of TypeScript 7: programs that once differed", () => {
  test(
    "the diagnostics of a sample of them are the same",
    async () => {
      using dir = tempDir("bun-typechecker-differential-cases", {});
      const cwd = realpathSync(String(dir));
      // A sample, always the same one: a debug build takes a minute for a few hundred.
      const every = 40n;
      // The same programs in every build, whatever else `writtenCases` leaves out of the list.
      const sampled = (it: { files: Record<string, string> }) =>
        BigInt(Bun.hash(JSON.stringify(it.files))) % every === 0n;
      const cases = await writtenCases(cwd, it => !it.build && !it.theirs && !it.deep && sampled(it));
      expect(cases.length).toBeGreaterThan(0);
      const configs = cases.map(([name]) => `${name}/tsconfig.json`);

      const collect = async (open: Open) =>
        withSession(open, async session => {
          const snapshot = await session.update({ openProjects: configs });
          const found: Record<string, { diagnostics: Diag[]; beforeTypes: Diag[] }> = {};
          for (const project of snapshot.projects()) {
            found[project.configFileName] = {
              diagnostics: sorted(await project.diagnostics()),
              beforeTypes: (await project.beforeTypes?.()) ?? [],
            };
          }
          return found;
        });
      const theirs = await collect(openTheirs(cwd));
      const ours = await collect(openOurs(cwd));
      expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).sort());

      // `bun check` stops before it checks types where a syntax error, an option or a missing global type is wrong, like
      // tsc. TypeScript's API has no such rule, so a program like that says nothing about the checker.
      const different: Record<string, object> = {};
      let compared = 0;
      for (const config of configs) {
        if (theirs[config].beforeTypes.length > 0 || dependsOnTheCheckerThatTypeScriptAsks.includes(config)) continue;
        compared++;
        if (!Bun.deepEquals(ours[config].diagnostics, theirs[config].diagnostics)) {
          different[config] = { theirs: theirs[config].diagnostics, ours: ours[config].diagnostics };
        }
      }
      expect(different).toEqual({});
      expect(compared).toBeGreaterThan(0);
    },
    longLimit,
  );
});
