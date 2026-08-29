import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A constant must never replace an assignment target. `"foo".length = 4` is a
// run-time TypeError (strict) or a no-op (sloppy), but `3 = 4` is an early
// SyntaxError. The same holds for `--define X=0` turning `X = 1` into `0 = 1`.
// esbuild leaves every case below untouched; so does bun now.

type Case = [name: string, source: string, printed: string];

// The printed output is the source itself unless the row says otherwise.
function unchanged(rows: [name: string, source: string, printed?: string][]): Case[] {
  return rows.map(([name, source, printed]) => [name, source, printed ?? source]);
}

const stringLengthTargets = unchanged([
  ["assignment", `"foo".length = 4;`],
  ["compound assignment", `"foo".length += 1;`],
  ["nullish assignment", `"foo".length ??= 1;`],
  ["logical or assignment", `"foo".length ||= 1;`],
  ["logical and assignment", `"foo".length &&= 1;`],
  ["postfix increment", `"foo".length++;`],
  ["prefix increment", `++"foo".length;`],
  ["postfix decrement", `"foo".length--;`],
  ["prefix decrement", `--"foo".length;`],
  ["for-of head", `for ("ab".length of [1]);`, `for ("ab".length of [1])\n  ;`],
  ["for-in head", `for ("ab".length in { a: 1 });`, `for ("ab".length in { a: 1 })\n  ;`],
  ["array destructuring", `["ab".length] = [1];`],
  ["nested array destructuring", `[["ab".length]] = [[1]];`],
  ["array destructuring with default", `["ab".length = 5] = [];`],
  ["object destructuring", `({ x: "ab".length } = {});`],
  ["nested object destructuring", `({ x: { y: "ab".length } } = { x: {} });`],
  ["object destructuring with default", `({ x: "ab".length = 5 } = {});`],
  ["bracket access", `"foo"["length"] = 4;`, `"foo".length = 4;`],
]);

// Reads of `"str".length` still fold.
const stringLengthReads: Case[] = [
  ["assigned value", `y = "foo".length;`, `y = 3;`],
  ["destructuring default value", `[y = "ab".length] = [];`, `[y = 2] = [];`],
  ["for-of iterable", `for (y of "ab".length);`, `for (y of 2)\n  ;`],
];

const defineTargets = unchanged([
  ["assignment", `X = 1;`],
  ["compound assignment", `X += 1;`],
  ["nullish assignment", `X ??= 1;`],
  ["logical or assignment", `X ||= 1;`],
  ["logical and assignment", `X &&= 1;`],
  ["postfix increment", `X++;`],
  ["prefix increment", `++X;`],
  ["postfix decrement", `X--;`],
  ["prefix decrement", `--X;`],
  ["for-of head", `for (X of y);`, `for (X of y)\n  ;`],
  ["for-in head", `for (X in y);`, `for (X in y)\n  ;`],
  ["array destructuring", `[X] = [1];`],
  ["nested array destructuring", `[[X]] = [[1]];`],
  ["array destructuring with default", `[X = 2] = [];`],
  ["array rest", `[...X] = [1];`],
  ["object destructuring", `({ x: X } = {});`],
  ["object shorthand", `({ X } = {});`],
  ["object shorthand with default", `({ X = 2 } = {});`],
  ["nested object destructuring", `({ x: { y: X } } = { x: {} });`],
  ["object destructuring with default", `({ x: X = 2 } = {});`],
  ["object rest", `({ ...X } = {});`],
]);

// Reads of `X` are still replaced by the define.
const defineReads: Case[] = [
  ["argument", `console.log(X);`, `console.log(0);`],
  ["destructuring default value", `[y = X] = [];`, `[y = 0] = [];`],
  ["object destructuring default value", `({ x: y = X } = {});`, `({ x: y = 0 } = {});`],
  ["for-of iterable", `for (y of X);`, `for (y of 0)\n  ;`],
];

// An identifier is a valid target, so `--define X=FOO` still applies there.
const defineIdentifierTargets: Case[] = [
  ["assignment", `X = 1;`, `FOO = 1;`],
  ["compound assignment", `X += 1;`, `FOO += 1;`],
  ["nullish assignment", `X ??= 1;`, `FOO ??= 1;`],
  ["postfix increment", `X++;`, `FOO++;`],
  ["for-of head", `for (X of y);`, `for (FOO of y)\n  ;`],
  ["array destructuring", `[X] = [1];`, `[FOO] = [1];`],
  ["object destructuring", `({ x: X } = {});`, `({ x: FOO } = {});`],
  ["object shorthand", `({ X } = {});`, `({ X: FOO } = {});`],
];

describe("Bun.Transpiler", () => {
  const minify = new Bun.Transpiler({ minify: { syntax: true } });
  const define = new Bun.Transpiler({ define: { X: "0" } });
  const defineIdentifier = new Bun.Transpiler({ define: { X: "FOO" } });

  // trim() on both ends: the printer puts a space before a prefix `++` or `--`
  // that starts the output.
  const transform = (transpiler: Bun.Transpiler, source: string) => transpiler.transformSync(source, "js").trim();

  test.each(stringLengthTargets)(`keeps "str".length as an assignment target: %s`, (_name, source, printed) => {
    expect(transform(minify, source)).toBe(printed);
  });

  test.each(stringLengthReads)(`folds "str".length when read: %s`, (_name, source, printed) => {
    expect(transform(minify, source)).toBe(printed);
  });

  test.each(defineTargets)("keeps a defined identifier as an assignment target: %s", (_name, source, printed) => {
    expect(transform(define, source)).toBe(printed);
  });

  test.each(defineReads)("substitutes a defined identifier when read: %s", (_name, source, printed) => {
    expect(transform(define, source)).toBe(printed);
  });

  test.each(defineIdentifierTargets)(
    "substitutes an identifier define in an assignment target: %s",
    (_name, source, printed) => {
      expect(transform(defineIdentifier, source)).toBe(printed);
    },
  );
});

const join = (cases: Case[]) => ({
  source: cases.map(c => c[1]).join("\n") + "\n",
  printed: cases.map(c => c[2]).join("\n") + "\n",
});

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd,
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("bun build", () => {
  test.concurrent("--minify-syntax keeps every assignment target", async () => {
    const { source, printed } = join([...stringLengthTargets, ...stringLengthReads]);
    using dir = tempDir("length-target-build", { "entry.js": source });

    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "build", "--no-bundle", "--minify-syntax", "entry.js"],
      String(dir),
    );

    expect(stderr).toBe("");
    expect(stdout).toBe(printed);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([["--no-bundle"], ["bundled"]])("--define keeps every assignment target (%s)", async mode => {
    const { source, printed } = join([...defineTargets, ...defineReads]);
    using dir = tempDir("define-target-build", { "entry.js": source });

    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "build", ...(mode === "--no-bundle" ? ["--no-bundle"] : []), "--define", "X=0", "entry.js"],
      String(dir),
    );

    expect(stderr).toBe("");
    expect(stdout).toBe(mode === "--no-bundle" ? printed : `// entry.js\n${printed}`);
    expect(exitCode).toBe(0);
  });

  // In a bundle, a read of `import.meta.main` in a non-entry module inlines to
  // `false` and a read of `import.meta.hot` inlines to `undefined`. A write or
  // delete keeps the property reference.
  test.concurrent("keeps import.meta as an assignment or delete target in a bundle", async () => {
    const lib = join(
      unchanged([
        ["assignment", `import.meta.main = 1;`],
        ["postfix increment", `import.meta.main++;`],
        ["array destructuring", `[import.meta.main] = [1];`],
        ["delete", `delete import.meta.main;`],
        ["hot", `import.meta.hot = 1;`],
        ["read", `console.log(import.meta.main, import.meta.hot);`, `console.log(false, undefined);`],
      ]),
    );
    using dir = tempDir("import-meta-target-build", {
      "entry.js": `import "./lib.js";\nimport.meta.hot = 2;\nconsole.log(import.meta.hot);\n`,
      "lib.js": lib.source,
    });

    const { stdout, stderr, exitCode } = await run([bunExe(), "build", "entry.js"], String(dir));

    expect(stderr).toBe("");
    expect(stdout).toBe(`// lib.js\n${lib.printed}\n// entry.js\nimport.meta.hot = 2;\nconsole.log(undefined);\n`);
    expect(exitCode).toBe(0);
  });

  // In a bundle, a read of `module.id`, `module.filename` or `module.path`
  // inlines to a string. A delete keeps the property reference.
  test.concurrent("keeps module.id, module.filename and module.path as delete targets in a bundle", async () => {
    using dir = tempDir("module-id-target-build", {
      "entry.js": `import "./lib.cjs";\n`,
      "lib.cjs": `
        delete module.id;
        delete module.filename;
        delete module.path;
        module.id = 1;
        console.log(module.id, module.filename, module.path);
      `,
    });

    const { stdout, stderr, exitCode } = await run([bunExe(), "build", "entry.js"], String(dir));

    expect(stderr).toBe("");
    // The module body is printed inside the CommonJS wrapper.
    expect(stdout).toContain(
      [
        `  delete module.id;`,
        `  delete module.filename;`,
        `  delete module.path;`,
        `  module.id = 1;`,
        `  console.log("lib.cjs", "lib.cjs", "lib.cjs");`,
      ].join("\n"),
    );
    expect(exitCode).toBe(0);
  });
});

describe("bun run", () => {
  // The runtime transpiler folds `"str".length`. The module must load; each
  // write is a run-time TypeError in strict mode, as in node. `??=` and `||=`
  // never write because `"foo".length` is 3.
  test.concurrent(`"str".length as an assignment target is a run-time TypeError`, async () => {
    const shortCircuits = new Set(["nullish assignment", "logical or assignment"]);
    const writes = stringLengthTargets.map(c => c[1]);
    const expected = stringLengthTargets.map(([name]) => (shortCircuits.has(name) ? "ok" : "TypeError"));
    using dir = tempDir("length-target-run", {
      "entry.mjs": `
        const results = [];
        for (const write of [${writes.map(w => `() => { ${w} }`).join(", ")}]) {
          try { write(); results.push("ok"); } catch (e) { results.push(e.constructor.name); }
        }
        console.log(results.join(","));
        console.log("foo".length);
      `,
    });

    const { stdout, stderr, exitCode } = await run([bunExe(), "entry.mjs"], String(dir));

    expect(stderr).toBe("");
    expect(stdout).toBe(`${expected.join(",")}\n3\n`);
    expect(exitCode).toBe(0);
  });

  // In sloppy mode the writes create a real global. Reads still see the define.
  test.concurrent("--define keeps writes to the defined identifier", async () => {
    using dir = tempDir("define-target-run", {
      "entry.cjs": `
        X = 1;
        X += 1;
        X++;
        for (X of [5]);
        [X] = [6];
        ({ x: X } = { x: 7 });
        console.log(X, globalThis.X);
      `,
    });

    const { stdout, stderr, exitCode } = await run([bunExe(), "--define", "X=0", "entry.cjs"], String(dir));

    expect(stderr).toBe("");
    expect(stdout).toBe("0 7\n");
    expect(exitCode).toBe(0);
  });
});
