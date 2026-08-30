import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// TypeScript removes an import whose bindings are only used as types. Three
// tsconfig settings change that: `verbatimModuleSyntax`, `preserveValueImports`
// and `importsNotUsedAsValues: "preserve"`. Like esbuild, Bun folds them into
// two behaviors: keep unused value bindings, and keep the statement (as a bare
// import) once every binding is gone. `verbatimModuleSyntax` does both.

const fixture = {
  "b.ts": `
    console.log("b side effect");
    export const unused = 1;
    export const used = 2;
  `,
  "uv.ts": `
    console.log("uv side effect");
    export type T = number;
    export const v = 3;
  `,
  "entry.ts": `
    import { unused } from "./b";
    import { type T, v } from "./uv";
    import * as ns from "./b";
    console.log("a");
  `,
};

const entrySource = fixture["entry.ts"];

const keepValuesOutput = `import { unused } from "./b";
import { v } from "./uv";
import * as ns from "./b";
console.log("a");
`;

const keepStmtOutput = `import"./b";
import"./uv";
import"./b";
console.log("a");
`;

const settings = [
  {
    name: "verbatimModuleSyntax",
    compilerOptions: { verbatimModuleSyntax: true },
    transformed: keepValuesOutput,
  },
  {
    name: "preserveValueImports",
    compilerOptions: { preserveValueImports: true },
    transformed: keepValuesOutput,
  },
  {
    name: 'importsNotUsedAsValues: "preserve"',
    compilerOptions: { importsNotUsedAsValues: "preserve" },
    transformed: keepStmtOutput,
  },
];

async function spawnBun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.each(settings)("tsconfig $name", ({ compilerOptions, transformed }) => {
  const tsconfig = JSON.stringify({ compilerOptions });

  test.concurrent("bun run evaluates the imported modules", async () => {
    using dir = tempDir("ts-unused-imports-run", { ...fixture, "tsconfig.json": tsconfig });
    const { stdout, stderr, exitCode } = await spawnBun(String(dir), "entry.ts");
    expect(stderr).toBe("");
    expect(stdout).toBe("b side effect\nuv side effect\na\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun build includes the imported modules", async () => {
    using dir = tempDir("ts-unused-imports-bundle", { ...fixture, "tsconfig.json": tsconfig });
    const { stdout, stderr, exitCode } = await spawnBun(String(dir), "build", "--minify-whitespace", "entry.ts");
    expect(stderr).toBe("");
    expect(stdout).toBe('console.log("b side effect");console.log("uv side effect");console.log("a");\n');
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun build --no-bundle keeps the imports", async () => {
    using dir = tempDir("ts-unused-imports-no-bundle", { ...fixture, "tsconfig.json": tsconfig });
    const { stdout, stderr, exitCode } = await spawnBun(String(dir), "build", "--no-bundle", "entry.ts");
    expect(stderr).toBe("");
    expect(stdout).toBe(transformed);
    expect(exitCode).toBe(0);
  });

  test("Bun.Transpiler keeps the imports", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts", trimUnusedImports: true, tsconfig });
    expect(transpiler.transformSync(entrySource)).toBe(transformed);
    expect(transpiler.scanImports(entrySource)).toEqual([
      { kind: "import-statement", path: "./b" },
      { kind: "import-statement", path: "./uv" },
      { kind: "import-statement", path: "./b" },
    ]);
  });

  test.concurrent("the setting is inherited through extends", async () => {
    using dir = tempDir("ts-unused-imports-extends", {
      ...fixture,
      "base.json": tsconfig,
      // No "compilerOptions" key at all: the value must come from the parent.
      "tsconfig.json": JSON.stringify({ extends: "./base.json" }),
    });
    const { stdout, stderr, exitCode } = await spawnBun(String(dir), "build", "--no-bundle", "entry.ts");
    expect(stderr).toBe("");
    expect(stdout).toBe(transformed);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a child tsconfig can turn the setting off again", async () => {
    const off = Object.fromEntries(
      Object.entries(compilerOptions).map(([key, value]) => [key, value === true ? false : "remove"]),
    );
    using dir = tempDir("ts-unused-imports-extends-off", {
      ...fixture,
      "base.json": tsconfig,
      "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: off }),
    });
    const { stdout, stderr, exitCode } = await spawnBun(String(dir), "entry.ts");
    expect(stderr).toBe("");
    expect(stdout).toBe("a\n");
    expect(exitCode).toBe(0);
  });
});

// The four rows of esbuild's TSUnusedImportFlags table (internal/config/config.go).
describe("Bun.Transpiler unused import table", () => {
  const inputs = [
    "import 'foo'",
    "import * as unused from 'foo'",
    "import { unused } from 'foo'",
    "import { type unused } from 'foo'",
  ];
  const bare = 'import"foo";\n';
  const star = 'import * as unused from "foo";\n';
  const named = 'import { unused } from "foo";\n';
  const empty = 'import {} from "foo";\n';

  test.each([
    [{}, [bare, "", "", ""]],
    [{ importsNotUsedAsValues: "preserve" }, [bare, bare, bare, bare]],
    [{ importsNotUsedAsValues: "error" }, [bare, bare, bare, bare]],
    [{ preserveValueImports: true }, [bare, star, named, ""]],
    [{ importsNotUsedAsValues: "preserve", preserveValueImports: true }, [bare, star, named, empty]],
    [{ verbatimModuleSyntax: true }, [bare, star, named, empty]],
  ])("%j", (compilerOptions, expected) => {
    const transpiler = new Bun.Transpiler({
      loader: "ts",
      trimUnusedImports: true,
      tsconfig: JSON.stringify({ compilerOptions }),
    });
    expect(inputs.map(input => transpiler.transformSync(input))).toEqual(expected);
  });
});

describe("without a tsconfig setting", () => {
  test.concurrent("bun run drops imports that are unused as values", async () => {
    using dir = tempDir("ts-unused-imports-default", {
      ...fixture,
      "tsconfig.json": JSON.stringify({ compilerOptions: { importsNotUsedAsValues: "remove" } }),
    });
    const { stdout, stderr, exitCode } = await spawnBun(String(dir), "entry.ts");
    expect(stderr).toBe("");
    expect(stdout).toBe("a\n");
    expect(exitCode).toBe(0);
  });

  // tsc treats a clause with no value bindings as type-only, so the module
  // is not evaluated. `import 'x'` (no clause) still is.
  test.concurrent("bun run drops an empty import clause like tsc does", async () => {
    using dir = tempDir("ts-unused-imports-empty-clause", {
      ...fixture,
      "entry.ts": `
        import {} from "./b";
        import { type as } from "./uv";
        export {} from "./uv";
        console.log("a");
      `,
    });
    const { stdout, stderr, exitCode } = await spawnBun(String(dir), "entry.ts");
    expect(stderr).toBe("");
    expect(stdout).toBe("a\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("verbatimModuleSyntax keeps an empty import clause", async () => {
    using dir = tempDir("ts-unused-imports-empty-clause-verbatim", {
      ...fixture,
      "tsconfig.json": JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } }),
      "entry.ts": `
        import {} from "./b";
        import { type as } from "./uv";
        export {} from "./uv";
        console.log("a");
      `,
    });
    const run = await spawnBun(String(dir), "entry.ts");
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("b side effect\nuv side effect\na\n");
    expect(run.exitCode).toBe(0);

    const build = await spawnBun(String(dir), "build", "--no-bundle", "entry.ts");
    expect(build.stderr).toBe("");
    expect(build.stdout).toBe(`import {} from "./b";
import {} from "./uv";
export {} from "./uv";
console.log("a");
`);
    expect(build.exitCode).toBe(0);
  });
});
