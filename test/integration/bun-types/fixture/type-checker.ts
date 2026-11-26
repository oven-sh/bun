import { expectType } from "./utilities";

// -- Bun.TypeChecker --

// The checker is created with `await using`; its snapshots and
// project/program views are disposed with `using`.
{
  await using checker = new Bun.TypeChecker({ cwd: process.cwd() });
  expectType(checker).is<Bun.TypeChecker>();

  // An empty update opens nothing and resolves to an empty snapshot.
  using empty = await checker.updateSnapshot({});
  expectType(empty).is<Bun.TypeCheckerSnapshot>();
  expectType(empty.getProjects()).is<readonly Bun.TypeCheckerProject[]>();
  expectType(empty.getProject("tsconfig.json")).is<Bun.TypeCheckerProject | undefined>();

  // A cwd may be a file URL.
  await using urlChecker = new Bun.TypeChecker({ cwd: new URL("file:///tmp/project/") });
  void urlChecker;

  // A checker closes itself when its scope ends; close() is idempotent.
  await checker.close();
  checker.close();

  const closed: Promise<void> = checker.close();
  void closed;
}

{
  await using checker = new Bun.TypeChecker();
  using snapshot = await checker.updateSnapshot({ openProjects: ["tsconfig.json"] });

  const project = snapshot.getProject("tsconfig.json");
  if (project === undefined) {
    throw new Error("The requested project did not produce a result");
  }
  expectType(project).is<Bun.TypeCheckerProject>();
  expectType(project.configFileName).is<string>();
  expectType(project.program).is<Bun.TypeCheckerProgram>();

  const diagnostics = await project.program.getDiagnostics();
  expectType(diagnostics).is<readonly Bun.TypeCheckerDiagnostic[]>();

  // `pos` and `end` are always present; the line and column fields are optional.
  for (const diagnostic of diagnostics) {
    expectType(diagnostic.fileName).is<string | undefined>();
    expectType(diagnostic.pos).is<number>();
    expectType(diagnostic.end).is<number>();
    expectType(diagnostic.line).is<number | undefined>();
    expectType(diagnostic.column).is<number | undefined>();
    expectType(diagnostic.endLine).is<number | undefined>();
    expectType(diagnostic.endColumn).is<number | undefined>();
    expectType(diagnostic.code).is<number>();
    expectType(diagnostic.category).is<Bun.TypeCheckerDiagnosticCategory>();
    expectType(diagnostic.text).is<string>();
    expectType(diagnostic.messageChain).is<readonly Bun.TypeCheckerDiagnostic[] | undefined>();
    expectType(diagnostic.relatedInformation).is<readonly Bun.TypeCheckerDiagnostic[] | undefined>();

    const category: "error" | "warning" | "suggestion" | "message" = diagnostic.category;
    void category;

    // Message chain entries are diagnostics.
    diagnostic.messageChain?.forEach(child => {
      expectType(child).is<Bun.TypeCheckerDiagnostic>();
      expectType(child.category).is<Bun.TypeCheckerDiagnosticCategory>();
      expectType(child.code).is<number>();
      expectType(child.text).is<string>();
      expectType(child.pos).is<number>();
      child.messageChain?.forEach(nested => {
        expectType(nested).is<Bun.TypeCheckerDiagnostic>();
      });
    });

    // Related information is recursive diagnostics with full fields.
    diagnostic.relatedInformation?.forEach(related => {
      expectType(related).is<Bun.TypeCheckerDiagnostic>();
      expectType(related.text).is<string>();
      expectType(related.fileName).is<string | undefined>();
    });

    const span: number = diagnostic.end - diagnostic.pos;
    void span;
    if (diagnostic.line !== undefined && diagnostic.column !== undefined) {
      console.log(diagnostic.fileName, diagnostic.line, diagnostic.column);
    }
  }

  // Filtering by file accepts a path string or a file URL.
  await project.program.getDiagnostics("src/index.ts");
  await project.program.getDiagnostics(new URL("file:///tmp/project/src/index.ts"));

  // dispose() is idempotent and needs no await.
  snapshot.dispose();
  snapshot.dispose();
}

// Persistent source overrides: a Map of path to source text, or null to
// remove the override and reveal the file on disk.
{
  await using checker = new Bun.TypeChecker({ cwd: "/tmp/project" });

  using next = await checker.updateSnapshot({
    openProjects: ["tsconfig.json"],
    sourceChanges: new Map<Bun.TypeCheckerPath, string | null>([
      ["src/index.ts", `const answer: string = 42;\n`],
      [new URL("file:///tmp/project/src/removed.ts"), null],
    ]),
  });

  const project = next.getProject(new URL("file:///tmp/project/tsconfig.json"));
  if (project !== undefined) {
    await project.program.getDiagnostics("src/index.ts");
  }

  // Project open refcounts: opening twice and closing once keeps the
  // project; closing an unopened project is a no-op. Updates serialize.
  using twice = await checker.updateSnapshot({
    openProjects: ["tsconfig.json", "."],
  });
  using once = await checker.updateSnapshot({
    closeProjects: ["tsconfig.json"],
  });
  using unopened = await checker.updateSnapshot({
    closeProjects: ["never-opened/tsconfig.json"],
  });
  void twice;
  void once;
  void unopened;

  // Snapshot views are local: projects are listed without running a check.
  for (const listed of next.getProjects()) {
    expectType(listed).is<Bun.TypeCheckerProject>();
    expectType(listed.configFileName).is<string>();
  }
}

// Path inputs are strings or file URLs; URLs are the only other accepted form.
{
  const path: Bun.TypeCheckerPath = "tsconfig.json";
  const fileUrl: Bun.TypeCheckerPath = new URL("file:///tmp/project/tsconfig.json");
  void path;
  void fileUrl;

  await using checker = new Bun.TypeChecker({ cwd: fileUrl });
  using snapshot = await checker.updateSnapshot({ openProjects: [fileUrl] });
  snapshot.getProject(fileUrl);
}

// @ts-expect-error source overrides must be strings or null
new Bun.TypeChecker().updateSnapshot({ sourceChanges: new Map([["src/index.ts", 42]]) });
// @ts-expect-error undefined is not a valid source override
new Bun.TypeChecker().updateSnapshot({ sourceChanges: new Map([["src/index.ts", undefined]]) });
// @ts-expect-error source changes need a Map, not a plain object
new Bun.TypeChecker().updateSnapshot({ sourceChanges: { "src/index.ts": "const x = 1;" } });
// @ts-expect-error project selectors must be paths
new Bun.TypeChecker().updateSnapshot({ openProjects: [42] });
// @ts-expect-error cwd must be a path
new Bun.TypeChecker({ cwd: 42 });
// @ts-expect-error no synchronous checking variant
new Bun.TypeChecker().updateSnapshotSync({});
// @ts-expect-error no compiler options are accepted
new Bun.TypeChecker({ compilerOptions: { strict: true } });
// @ts-expect-error snapshots are not publicly constructible
new Bun.TypeCheckerSnapshot();
// @ts-expect-error projects are not publicly constructible
new Bun.TypeCheckerProject();
// @ts-expect-error programs are not publicly constructible
new Bun.TypeCheckerProgram();
