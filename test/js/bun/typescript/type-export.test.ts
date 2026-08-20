import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir, tempDirWithFiles } from "harness";

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd,
    env: bunEnv,
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** The `error:` / `SomeError:` line of a failed run, with the fixture directory replaced by `<dir>`. */
function errorLine(stderr: string, dir: string) {
  const normalized = normalizeBunSnapshot(stderr, dir);
  return normalized.split("\n").find(line => /^(?:\w*Error|error):/.test(line)) ?? normalized;
}

// Fixtures whose entry point prints one JSON line when type-only exports are handled correctly. Each one is run
// three ways (see the describe block below) by a generated runner that imports every fixture in turn and reports
// each result under the fixture's name as it goes, so one process (and, for `compile`, one standalone executable)
// covers all of them while a failure, or a crash part way through, still names the fixture responsible.
type Fixture = { files: Record<string, string>; entry: string; expected: unknown };
const fixtures: Record<string, Fixture> = {};

const a_file = `
  export type my_string = "1";

  export type my_value = "2";
  export const my_value = "2";

  export const my_only = "3";
`;

const a_no_value = `
  export type my_string = "1";
  export type my_value = "2";
  export const my_only = "3";
`;

const a_with_value = `
  export type my_string = "1";
  export const my_value = "2";
`;

// How `b` re-exports `a`.
const b_files = {
  "export-from": `export { my_string, my_value, my_only } from "./a.ts";`,
  "import-then-export": `
    import { my_string, my_value, my_only } from "./a.ts";
    export { my_string, my_value, my_only };
  `,
  "export-star": `export * from "./a.ts";`,
  "export-merge": `export * from "./a_no_value.ts"; export * from "./a_with_value.ts"`,
};

// How `c` imports `b`.
const c_files = {
  "require": `console.log(JSON.stringify(require("./b")));`,
  "import-star": `import * as b from "./b"; console.log(JSON.stringify(b));`,
  "await-import": `console.log(JSON.stringify(await import("./b")));`,
  "import-individual": `
    import { my_string, my_value, my_only } from "./b";
    console.log(JSON.stringify({ my_only, my_value }));
  `,
};

for (const [b_name, b_file] of Object.entries(b_files)) {
  for (const [c_name, c_file] of Object.entries(c_files)) {
    fixtures[`${b_name}/${c_name}`] = {
      files: {
        "a.ts": a_file,
        "a_no_value.ts": a_no_value,
        "a_with_value.ts": a_with_value,
        "b.ts": b_file,
        "c.ts": c_file,
      },
      entry: "c.ts",
      expected: { my_value: "2", my_only: "3" },
    };
  }
}

fixtures["ownkeys-of-star-import"] = {
  files: {
    "main.ts": `
      import * as ns from './a';
      console.log(JSON.stringify({
        keys: Object.keys(ns).sort(),
        ns,
        has_sometype: Object.hasOwn(ns, 'sometype'),
      }));
    `,
    "a.ts": "export * from './b'; export {sometype} from './b';",
    "b.ts": "export const value = 'b'; export const anotherValue = 'another'; export type sometype = 'sometype';",
  },
  entry: "main.ts",
  expected: {
    keys: ["anotherValue", "value"],
    ns: { anotherValue: "another", value: "b" },
    has_sometype: false,
  },
};

// https://github.com/oven-sh/bun/issues/8439: an interface imported without `import type`, used only in
// emitDecoratorMetadata output and re-exported. tsc emits `design:type` metadata of `Object` for it.
fixtures["import-only-used-in-decorator"] = {
  files: {
    "index.ts": `
      import { TestInterface } from "./interface.ts";

      const metadata = {};
      Reflect.metadata = (key, value) => () => {
        metadata[key] = value;
      };

      function Decorator(): PropertyDecorator {
        return () => {};
      }

      class TestClass {
        @Decorator()
        test?: TestInterface;
      }
      class OtherClass {
        other?: TestInterface;
      }
      delete Reflect.metadata;

      export { TestInterface };

      console.log(JSON.stringify({ design_type: metadata["design:type"] === Object ? "Object" : metadata }));
    `,
    "interface.ts": "export interface TestInterface {};",
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }),
  },
  entry: "index.ts",
  expected: { design_type: "Object" },
};

const fixtureFiles = Object.fromEntries(
  Object.entries(fixtures).flatMap(([name, { files }]) =>
    Object.entries(files).map(([file, contents]) => [`fixtures/${name}/${file}`, contents]),
  ),
);
const sourceEntries = Object.fromEntries(
  Object.entries(fixtures).map(([name, { entry }]) => [name, `./fixtures/${name}/${entry}`]),
);
const builtEntries = Object.fromEntries(
  Object.entries(fixtures).map(([name, { entry }]) => [name, `./dist/${name}/${entry.replace(/\.ts$/, ".js")}`]),
);
const allFixturesPass = {
  results: Object.fromEntries(Object.entries(fixtures).map(([name, { expected }]) => [name, expected])),
  stderr: "",
  exitCode: 0,
};

// One `import()` with a literal specifier per fixture, so that `bun build --compile --splitting` gives every
// fixture its own chunk, bytecode and module record.
function runnerSource(entries: Record<string, string>) {
  const imports = Object.entries(entries).map(
    ([name, specifier]) => `[${JSON.stringify(name)}, () => import(${JSON.stringify(specifier)})],`,
  );
  return `
    const log = console.log;
    for (const [name, load] of [
      ${imports.join("\n")}
    ]) {
      const lines = [];
      console.log = (...args) => lines.push(args.join(" "));
      let result;
      try {
        await load();
        result = lines.length === 1 ? JSON.parse(lines[0]) : { lines };
      } catch (error) {
        result = { error: String(error), lines };
      } finally {
        console.log = log;
      }
      console.log(JSON.stringify([name, result]));
    }
  `;
}

/** The runner's output as `{ [fixture]: result }`; a fixture that took the process down is simply missing. */
async function runFixtures(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await run(cmd, cwd);
  let results: unknown = stdout;
  try {
    results = Object.fromEntries(
      stdout
        .trim()
        .split("\n")
        .map(line => JSON.parse(line)),
    );
  } catch {
    // Whatever was printed instead is the best report there is.
  }
  return { results, stderr, exitCode };
}

// describe.concurrent rather than test.concurrent: a non-concurrent test (a skipped one included) ends the batch
// of tests that run together, which is what used to serialize every compile in this file.
describe.concurrent("type-only exports through re-exports", () => {
  // The runtime transpiler does not hand JSC a module record for the modules it transpiles yet (only the bundler
  // does, for --compile ESM bytecode), so JSC's own linker still rejects the re-exported types (#7384).
  test.skip("run", async () => {
    await using dir = tempDir("type-export-run", { ...fixtureFiles, "runner.ts": runnerSource(sourceEntries) });

    expect(await runFixtures([bunExe(), "runner.ts"], dir)).toEqual(allFixturesPass);
  });

  test("build", async () => {
    await using dir = tempDir("type-export-build", { ...fixtureFiles, "runner.ts": runnerSource(builtEntries) });

    // One build of every entry point. Without splitting each of them still gets its own self-contained bundle,
    // written to dist/<fixture>/<entry>.js, which is where the runner imports it from.
    const { logs } = await Bun.build({
      entrypoints: Object.entries(fixtures).map(([name, { entry }]) => `${dir}/fixtures/${name}/${entry}`),
      root: `${dir}/fixtures`,
      outdir: `${dir}/dist`,
      throw: false,
    });
    expect(logs.map(String)).toEqual([]);

    expect(await runFixtures([bunExe(), "runner.ts"], dir)).toEqual(allFixturesPass);
  });

  test("compile", async () => {
    await using dir = tempDir("type-export-compile", { ...fixtureFiles, "runner.ts": runnerSource(sourceEntries) });
    const outfile = `${dir}/runner${isWindows ? ".exe" : ""}`;

    const build = await run(
      [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "--splitting", "runner.ts", "--outfile", outfile],
      dir,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });

    expect(await runFixtures([outfile], dir)).toEqual(allFixturesPass);
  });
});

describe.concurrent("importing a name that is not exported as a value", () => {
  const import_not_found = `
    import { not_found } from "./a";
    console.log(not_found);
  `;
  const type_only = "export type type_only = 'type_only';";
  const type_only_and_default = "export type type_only = 'type_only'; export default function type_only() {};";

  const cases: Record<string, { files: Record<string, string>; entry: string; error: string }> = {
    "import not found": {
      files: { "a.ts": "", "b.ts": import_not_found },
      entry: "b.ts",
      error: "SyntaxError: Export named 'not_found' not found in module '<dir>/a.ts'.",
    },
    "import not found, default export with the same name": {
      files: { "a.ts": "export default function not_found() {};", "b.ts": import_not_found },
      entry: "b.ts",
      error: "SyntaxError: Export named 'not_found' not found in module '<dir>/a.ts'. Did you mean to import default?",
    },
    "import not found, type with the same name": {
      files: { "a.ts": `export type not_found = "not_found";`, "b.ts": import_not_found },
      entry: "b.ts",
      error: "SyntaxError: Export named 'not_found' not found in module '<dir>/a.ts'.",
    },
    "js file type import": {
      files: { "b.js": "import {type_only} from './ts.ts';", "ts.ts": type_only },
      entry: "b.js",
      error: "SyntaxError: Export named 'type_only' not found in module '<dir>/ts.ts'.",
    },
    "js file type import with default export": {
      files: { "b.js": "import {type_only} from './ts.ts';", "ts.ts": type_only_and_default },
      entry: "b.js",
      error: "SyntaxError: Export named 'type_only' not found in module '<dir>/ts.ts'. Did you mean to import default?",
    },
    "js file with through export": {
      files: { "b.js": "export {type_only} from './ts.ts';", "ts.ts": type_only_and_default },
      entry: "b.js",
      error: "SyntaxError: export 'type_only' not found in './ts.ts'",
    },
    "js file with through export 2": {
      files: { "b.js": "import {type_only} from './ts.ts'; export {type_only};", "ts.ts": type_only_and_default },
      entry: "b.js",
      error: "SyntaxError: export 'type_only' not found in './ts.ts'",
    },
    "ambiguous export star merge": {
      files: {
        "main.ts": "import {value} from './a'; console.log(value);",
        "a.ts": "export * from './b'; export * from './c';",
        "b.ts": "export const value = 'b';",
        "c.ts": "export const value = 'c';",
      },
      entry: "main.ts",
      error:
        "SyntaxError: Export named 'value' cannot be resolved due to ambiguous multiple bindings in module '<dir>/a.ts'.",
    },
  };

  for (const [name, { files, entry, error }] of Object.entries(cases)) {
    test(name, async () => {
      await using dir = tempDir("type-export", files);

      const result = await run([bunExe(), entry], dir);

      expect({
        error: errorLine(result.stderr, dir),
        stdout: result.stdout,
        exitCode: result.exitCode,
      }).toEqual({ error, stdout: "", exitCode: 1 });
    });
  }
});

test.concurrent("js file type export", async () => {
  await using dir = tempDir("type-export", {
    "a.js": "export {not_found};",
  });

  const result = await run([bunExe(), "a.js"], dir);

  expect(normalizeBunSnapshot(result.stderr, dir)).toMatchInlineSnapshot(`
    "1 | export {not_found};
                ^
    error: "not_found" is not declared in this file
        at <dir>/a.js:1:9

    Bun v<bun-version>"
  `);
  expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

describe("through export merge", () => {
  // this isn't allowed, even in typescript (tsc emits "Duplicate identifier 'value'.")
  for (const fmt of ["js", "ts"]) {
    describe(fmt, () => {
      for (const [name, mode] of [
        ["through", "export {value} from './b'; export {value} from './c';"],
        ["direct", "export {value} from './b'; export const value = 'abc';"],
        ["direct2", "export const value = 'abc'; export {value};"],
        ["ns", "export * as value from './c'; export * as value from './c';"],
      ]) {
        describe(name, () => {
          const dir = tempDirWithFiles("type-import", {
            ["main." + fmt]: "import {value} from './a'; console.log(value);",
            ["a." + fmt]: mode,
            ["b." + fmt]: fmt === "ts" ? "export type value = 'b';" : "",
            ["c." + fmt]: "export const value = 'c';",
          });

          for (const [file, expected_stderr] of [
            // jsc's syntax error, from linking a while running main
            ["main." + fmt, "SyntaxError: Cannot export a duplicate name 'value'.\n"],
            // bun's syntax error, which points at the duplicate
            ["a." + fmt, `error: Multiple exports with the same name "value"\n    at <dir>/a.${fmt}:1:`],
          ]) {
            test.concurrent(file, async () => {
              const result = await run([bunExe(), file], dir);

              expect(normalizeBunSnapshot(result.stderr, dir)).toContain(expected_stderr);
              expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "", exitCode: 1 });
            });
          }
        });
      }
    });
  }
});

test.concurrent("check commonjs", async () => {
  await using dir = tempDir("commonjs", {
    ["main.ts"]: "const {my_value, my_type} = require('./a'); console.log(my_value, my_type);",
    ["a.ts"]: "module.exports = require('./b');",
    ["b.ts"]: "export const my_value = 'my_value'; export type my_type = 'my_type';",
  });

  expect(await run([bunExe(), "main.ts"], dir)).toEqual({ stdout: "my_value undefined\n", stderr: "", exitCode: 0 });
});

// Each re-export form is run both through an importer (`main`, which prints what it imported) and as the entry
// point itself (`a`, which prints nothing).
describe.concurrent("re-export forms", () => {
  const forms = [
    {
      name: "export * from './module'",
      fmts: ["js", "ts"],
      main: "import {value} from './a'; console.log(value);",
      a: "export * from './b';",
      b: "export const value = 'b';",
      stdout: "b\n",
    },
    {
      name: "export * as ns from './module'",
      fmts: ["js", "ts"],
      main: "import {ns} from './a'; console.log(ns.value);",
      a: "export * as ns from './b';",
      b: "export const value = 'b';",
      stdout: "b\n",
    },
    {
      name: "export type {Type} from './module'",
      fmts: ["ts"],
      main: "import {Type} from './a'; const x: Type = 'test'; console.log(x);",
      a: "export type {Type} from './b';",
      b: "export type Type = string;",
      stdout: "test\n",
    },
  ];

  for (const form of forms) {
    describe(form.name, () => {
      for (const fmt of form.fmts) {
        for (const [file, stdout] of [
          [`main.${fmt}`, form.stdout],
          [`a.${fmt}`, ""],
        ]) {
          test(file, async () => {
            await using dir = tempDir("re-export", {
              [`main.${fmt}`]: form.main,
              [`a.${fmt}`]: form.a,
              [`b.${fmt}`]: form.b,
            });

            expect(await run([bunExe(), file], dir)).toEqual({ stdout, stderr: "", exitCode: 0 });
          });
        }
      }
    });
  }
});
