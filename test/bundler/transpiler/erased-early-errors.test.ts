// An early error is a syntax error that stops a program before any of it runs. Bun's parser reports some early errors
// itself. It leaves the others to the engine: it prints the code as written, and JavaScriptCore refuses the printed
// text. Where a pass removes the code or prints it differently, nothing reports the error, and the program runs.
//
// This test records where that happens. It transpiles each program inside `if (1) { }`, where the program stays, and
// inside `if (0) { }`, where dead code elimination removes it. Bun refuses a text if its parser has an error for it,
// or if the engine has one for what Bun printed.
//
//   if (0)   Bun refuses the program under `if (1)` and accepts it under `if (0)`.
//   if (1)   Bun accepts the program under `if (1)`, where the engine refuses the program as it is written.
//
// erased-early-errors.txt lists the programs. It says what Bun does, not what Bun should do. Two of its rules have a
// position in the tree:
//
//   an invalid RegExp literal in removed code   test/aot/parallel/language/invalid-regexp-in-dropped-code.js expects it to run
//   `new.target` outside a function             src/js_parser/visit/visit_expr.rs: the parser's error "is intentionally not emitted"
//
// When the test fails, it prints what changed for each line. To write the list again:
//
//   ERASED_EARLY_ERRORS_UPDATE=1 bun bd test test/bundler/transpiler/erased-early-errors.test.ts
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const listPath = join(import.meta.dir, "erased-early-errors.txt");
const writeList = "ERASED_EARLY_ERRORS_UPDATE=1 bun bd test test/bundler/transpiler/erased-early-errors.test.ts";
const listHeader =
  "# Early errors that nothing reports where a pass removes the code or prints it differently: `<place> <list> <program>`.\n" +
  "# `if (0)`: Bun refuses the program under `if (1)` and accepts it under `if (0)`.\n" +
  "# `if (1)`: Bun accepts the program under `if (1)`, where the engine refuses the program as it is written.\n" +
  "# This is what Bun does, not what it should do: see test/bundler/transpiler/erased-early-errors.test.ts.\n" +
  `# Written by: ${writeList}\n`;

const readList = () =>
  readFileSync(listPath, "utf8")
    .split(/\r?\n/)
    .filter(line => line !== "" && !line.startsWith("#"));

type Row = { list: string; isRejected: boolean; extension: string; program: string };

/** `<rule>.rejected.<extension>` or `<rule>.accepted.<extension>`, as the AOT suite names its lists. */
function rowsOf(list: string, programs: string[]): Row[] {
  const [, verdict, extension] = list.match(/\.(rejected|accepted)\.(\w+)$/)!;
  return programs.map(program => ({ list, isRejected: verdict === "rejected", extension, program }));
}

/**
 * The lists of the AOT suite, read where they are: a line of a `.rejected.` list has an early error, a line of an
 * `.accepted.` list has none. test/aot/checker-queries.ts describes the `.programs` files that hold them.
 */
function rowsOfTheAotSuite(): Row[] {
  const folder = join(import.meta.dir, "../../aot/checker-queries");
  const rows: Row[] = [];
  for (const pack of readdirSync(folder).sort()) {
    if (!pack.endsWith(".programs")) continue;
    const text = readFileSync(join(folder, pack), "utf8").replaceAll("\r\n", "\n");
    const marks = [...text.matchAll(/^\/\/\/\/([ !:]) ?([^\n]*)\n/gm)];
    for (const [index, { 0: line, 2: name, index: start }] of marks.entries()) {
      if (!/^early-errors\/.+\.(rejected|accepted)\.\w+$/.test(name)) continue;
      const lines = text.slice(start + line.length, marks[index + 1]?.index).split("\n");
      if (lines.some(it => it.startsWith("////"))) throw new Error(`${name} has a mark that this test can't read`);
      const programs = lines.filter(it => it !== "" && !it.startsWith("//")).map(it => it.replaceAll("⏎", "\n"));
      rows.push(...rowsOf(name, programs));
    }
  }
  if (rows.length === 0) throw new Error(`No early-errors list in ${folder}`);
  return rows;
}

/** Rules that those lists lack. Every line has an early error. */
const more: Record<string, string[]> = {
  "missing-initializers.rejected.js": [
    "let [a];",
    "let { a };",
    "var [a];",
    "var { a };",
    "for (let [a]; ; ) {}",
    "for (using a; ; ) {}",
  ],
  "new-with-optional-chain.rejected.js": ["new a?.b();", "new a?.b.c();", "new a?.();"],
  "regexp-literals.rejected.js": ["x = /(/;", "x = /a**/;", "x = /(?<a>)(?<a>)/;", "f(/[b-a]/);"],
  "reserved-names.rejected.js": [
    "let { enum } = a;",
    "let { class } = a;",
    "let { static } = a;",
    "({ implements } = a);",
    "let [let] = a;",
    "const { let } = a;",
    "class let {}",
    "let: ;",
    "yield: ;",
    "var f = (yield) => 1;",
    "try {} catch (eval) {}",
    "try {} catch (arguments) {}",
    "function* g() { class yield {} }",
    "function* g() { let { yield } = a; }",
    "async function f() { let { await } = a; }",
  ],
  "reserved-names.rejected.ts": ["function* g() { enum yield {} }", "async function f() { enum await {} }"],
  "static-blocks.rejected.js": [
    "class C { static { function await() {} } }",
    "class C { static { var { await } = a; } }",
  ],
  "using-declarations.rejected.js": [
    "switch (a) { case 1: using b = c; }",
    "switch (a) { default: await using b = c; }",
    "for (await using a in b);",
    "await\nusing a = b;",
  ],
  // Code that is removed where it stays: an expression that nothing reads, a branch that is never taken, and the
  // statements after a `return`.
  "unused-code.rejected.js": [
    "/(/;",
    "/\\P{assigned}/u;",
    "void /(/;",
    "[/(/];",
    "0 && /(/;",
    "1 ? 0 : /(/;",
    "function f() { return; x = /(/; }",
    "({ set a(...b) {} });",
    "0 && class { constructor() {} constructor() {} };",
    "function f() { return; class C { constructor() {} constructor() {} } }",
  ],
};

/** The loader that the runtime uses for an extension. */
const loaders: Record<string, Bun.JavaScriptLoader> = {
  js: "jsx",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  ts: "ts",
  mts: "ts",
  cts: "ts",
  tsx: "tsx",
};

/**
 * The error of the engine for a text. A `.cjs` or `.cts` file is the body of a CommonJS function. Any other file is a
 * module, as in a package with `"type": "module"`: that is how the AOT suite reads its lists.
 */
function engineErrorOf(extension: string, text: string): string | undefined {
  try {
    if (extension === "cjs" || extension === "cts") {
      new Function("exports", "require", "module", "__filename", "__dirname", text);
    } else new vm.SourceTextModule(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return error.message;
  }
}

/** The error for a text: from Bun's parser, or from the engine when it reads what Bun printed. */
function errorOf(transpiler: Bun.Transpiler, extension: string, text: string): string | undefined {
  let printed: string;
  try {
    printed = transpiler.transformSync(text);
  } catch (error) {
    const first = error instanceof AggregateError ? error.errors[0] : error;
    if (!(first instanceof BuildMessage)) throw error;
    return first.message;
  }
  return engineErrorOf(extension, printed);
}

/**
 * Asks for three readings of a program, each only if the one before it found no error: Bun's under `if (0)`, Bun's
 * under `if (1)`, and the engine's of the text under `if (1)` as it is written. `place` is where the program is
 * accepted although `error` refuses it.
 */
function erasedPlaceOf(
  underIf0: () => string | undefined,
  underIf1: () => string | undefined,
  asWritten: () => string | undefined,
): { place?: "if (0)" | "if (1)"; error?: string } {
  let error = underIf0();
  if (error !== undefined) return { error };
  if ((error = underIf1()) !== undefined) return { place: "if (0)", error };
  if ((error = asWritten()) !== undefined) return { place: "if (1)", error };
  return {};
}

test("a program is erased where Bun accepts it and the next reading of it has an error", () => {
  const none = () => undefined;
  const notAsked = () => {
    throw new Error("This reading isn't needed");
  };
  expect([
    erasedPlaceOf(() => "under if (0)", notAsked, notAsked),
    erasedPlaceOf(none, () => "under if (1)", notAsked),
    erasedPlaceOf(none, none, () => "as written"),
    erasedPlaceOf(none, none, none),
  ]).toEqual([
    { error: "under if (0)" },
    { place: "if (0)", error: "under if (1)" },
    { place: "if (1)", error: "as written" },
    {},
  ]);
});

test("the engine reads a .cjs text as the body of a CommonJS function and any other text as a module", () => {
  const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });
  // The words of the engine's errors are its own: a WebKit upgrade can change them.
  const refused = expect.any(String);
  expect({
    aModule: engineErrorOf("js", "var a; delete a;"),
    aCommonJsFunction: engineErrorOf("cjs", "var a; delete a; return;"),
    aTypeScriptModule: engineErrorOf("mts", "return;"),
    whatBunRefuses: errorOf(transpiler, "js", "let a; let a;"),
    whatBunPrintsForAModule: errorOf(transpiler, "js", "var a; delete a;"),
    whatBunPrintsForCommonJs: errorOf(transpiler, "cjs", "var a; delete a;"),
  }).toEqual({
    aModule: refused,
    aCommonJsFunction: undefined,
    aTypeScriptModule: refused,
    whatBunRefuses: '"a" has already been declared',
    whatBunPrintsForAModule: refused,
    whatBunPrintsForCommonJs: undefined,
  });
});

test("erased-early-errors.txt lists the early errors that nothing reports under `if (0)` or under `if (1)`", () => {
  const rows = [...rowsOfTheAotSuite(), ...Object.entries(more).flatMap(([list, programs]) => rowsOf(list, programs))];
  const transpilers = new Map<string, Bun.Transpiler>();
  /** By line: the error that nothing reports there. */
  const erased = new Map<string, string>();
  /** By line without its place: what happens to the program now. */
  const now = new Map<string, string>();
  const validButRefusedUnderIf1: string[] = [];
  const noEarlyError: string[] = [];
  for (const { list, isRejected, extension, program } of rows) {
    const loader = loaders[extension];
    if (!loader) throw new Error(`No loader for ${list}`);
    // Like the runtime, this doesn't lower `using`, so the engine sees it.
    if (!transpilers.has(loader)) transpilers.set(loader, new Bun.Transpiler({ loader, target: "bun" }));
    const transpiler = transpilers.get(loader)!;
    const underIf1 = `if (1) {\n${program}\n}\n`;
    // The engine reads neither TypeScript nor JSX. It isn't asked about a line of an `.accepted.` list: some have a
    // decorator, which it doesn't read, and some are there because `bun run` starts them although ECMAScript doesn't.
    const canAskTheEngine = isRejected && ["js", "mjs", "cjs"].includes(extension);
    const { place, error } = erasedPlaceOf(
      () => errorOf(transpiler, extension, `if (0) {\n${program}\n}\n`),
      () => errorOf(transpiler, extension, underIf1),
      () => (canAskTheEngine ? engineErrorOf(extension, underIf1) : undefined),
    );

    const line = `${list} ${JSON.stringify(program)}`;
    if (place === undefined) {
      now.set(line, error === undefined ? "accepted under `if (1)` too" : `refused under \`if (0)\`: ${error}`);
      if (error === undefined && list in more) noEarlyError.push(line);
    } else if (isRejected) {
      erased.set(`${place} ${line}`, error!);
      now.set(line, `erased under \`${place}\``);
    } else validButRefusedUnderIf1.push(`${line}: ${error}`);
  }
  const lines = [...erased.keys()].sort();

  if (process.env.ERASED_EARLY_ERRORS_UPDATE) writeFileSync(listPath, listHeader + lines.map(it => it + "\n").join(""));
  const listed = readList();

  // A line of an `.accepted.` list is valid, so the bug is under `if (1)`. A line of `more` has to be an early error.
  expect({ validButRefusedUnderIf1, noEarlyError }).toEqual({ validButRefusedUnderIf1: [], noEarlyError: [] });
  expect(
    {
      erasedAndNotListed: lines.filter(it => !listed.includes(it)).map(it => `${it}: ${erased.get(it)}`),
      listedAndNotErased: listed
        .filter(it => !erased.has(it))
        .map(it => `${it}: ${now.get(it.slice("if (0) ".length)) ?? "the program is in no list"}`),
    },
    `To write erased-early-errors.txt again: ${writeList}`,
  ).toEqual({ erasedAndNotListed: [], listedAndNotErased: [] });
  expect(listed).toEqual(lines);
});

// The test above asks `Bun.Transpiler`. This one loads each listed program as a file, the way a program is run.
test("every line of erased-early-errors.txt is what `bun` does with a file", async () => {
  const listed = readList().map(line => {
    const [, place, list, program] = line.match(/^(if \([01]\)) (\S+) (.+)$/)!;
    return { line, place, extension: list.slice(list.lastIndexOf(".") + 1), program: JSON.parse(program) as string };
  });
  const files: Record<string, string> = {};
  listed.forEach(({ extension, program }, index) => {
    // `if (1)` would run the program. The engine reads this, and nothing runs it.
    files[`kept/${index}.${extension}`] = `if (globalThis.never) {\n${program}\n}\n`;
    files[`dead/${index}.${extension}`] = `if (0) {\n${program}\n}\n`;
  });
  using dir = tempDir("erased-early-errors", {
    ...files,
    "package.json": JSON.stringify({ type: "module" }),
    "main.mjs": `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const errors = {};
      for (const file of ${JSON.stringify(Object.keys(files))}) {
        try {
          if (/[.]c[jt]s$/.test(file)) require("./" + file);
          else await import("./" + file);
        } catch (error) {
          errors[file] = error.name;
        }
      }
      console.log(JSON.stringify(errors));
    `,
  });
  // Without --no-install, a program that needs a package would make Bun look for it on the network.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-install", "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const errors: Record<string, string> = JSON.parse(stdout);
  // The engine throws a SyntaxError. Bun's parser throws a BuildMessage, or an AggregateError of them.
  const whatHappensTo = (file: string) =>
    !(file in errors)
      ? "loads"
      : /^(SyntaxError|BuildMessage|AggregateError)$/.test(errors[file])
        ? "is refused"
        : errors[file];
  expect(
    Object.fromEntries(
      listed.map(({ line, extension }, index) => [
        line,
        { kept: whatHappensTo(`kept/${index}.${extension}`), underIf0: whatHappensTo(`dead/${index}.${extension}`) },
      ]),
    ),
  ).toEqual(
    Object.fromEntries(
      listed.map(({ line, place }) => [line, { kept: place === "if (0)" ? "is refused" : "loads", underIf0: "loads" }]),
    ),
  );
  expect(exitCode).toBe(0);
});
