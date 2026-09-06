import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir, tempDirWithFiles } from "harness";
import { join, relative } from "node:path";

const ext = isWindows ? ".exe" : "";

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd,
    env: bunEnv,
    cwd,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Every program in the standalone fixture prints one `[name, value]` JSON line.
function parseLabeledLines(stdout: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    const [name, value] = JSON.parse(line);
    result[name] = value;
  }
  return result;
}

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

const b_files = [
  {
    name: "export from",
    value: `export { my_string, my_value, my_only } from "./a.ts";`,
  },
  {
    name: "import then export",
    value: `
      import { my_string, my_value, my_only } from "./a.ts";
      export { my_string, my_value, my_only };
    `,
  },
  {
    name: "export star",
    value: `export * from "./a.ts";`,
  },
  {
    name: "export merge",
    value: `export * from "./a_no_value.ts"; export * from "./a_with_value.ts"`,
  },
];

const c_files = [
  { name: "require", value: (label: string) => `console.log(JSON.stringify([${label}, require("./b")]));` },
  {
    name: "import star",
    value: (label: string) => `import * as b from "./b"; console.log(JSON.stringify([${label}, b]));`,
  },
  {
    name: "await import",
    value: (label: string) => `console.log(JSON.stringify([${label}, await import("./b")]));`,
  },
  {
    name: "import individual",
    value: (label: string) => `
      import { my_string, my_value, my_only } from "./b";
      console.log(JSON.stringify([${label}, { my_only, my_value }]));
    `,
  },
];

// One fixture tree holds every program that is bundled or compiled. Each
// program lives in its own directory, so the module graphs do not share files
// and the bundler treats each one exactly as it did when they were separate
// projects. `index.ts` imports every entry so a single `--compile` covers all
// of them.
const standalone: { entries: string[]; files: Record<string, string>; expected: Record<string, unknown> } = {
  entries: [],
  files: {},
  expected: {},
};

for (const b_file of b_files) {
  for (const c_file of c_files) {
    const name = `re-export with ${b_file.name}, import with ${c_file.name}`;
    const dir = `re-export/${b_file.name.replaceAll(" ", "_")}/${c_file.name.replaceAll(" ", "_")}`;
    standalone.files[`${dir}/a.ts`] = a_file;
    standalone.files[`${dir}/a_no_value.ts`] = a_no_value;
    standalone.files[`${dir}/a_with_value.ts`] = a_with_value;
    standalone.files[`${dir}/b.ts`] = b_file.value;
    standalone.files[`${dir}/c.ts`] = c_file.value(JSON.stringify(name));
    standalone.entries.push(`${dir}/c.ts`);
    standalone.expected[name] = { my_value: "2", my_only: "3" };
  }
}

standalone.files["ownkeys-star-import/main.ts"] = `
  import * as ns from './a';
  console.log(JSON.stringify(["check ownkeys from a star import", {
    keys: Object.keys(ns).sort(),
    ns,
    has_sometype: Object.hasOwn(ns, 'sometype'),
  }]));
`;
standalone.files["ownkeys-star-import/a.ts"] = "export * from './b'; export {sometype} from './b';";
standalone.files["ownkeys-star-import/b.ts"] =
  "export const value = 'b'; export const anotherValue = 'another'; export type sometype = 'sometype';";
standalone.entries.push("ownkeys-star-import/main.ts");
standalone.expected["check ownkeys from a star import"] = {
  keys: ["anotherValue", "value"],
  ns: {
    anotherValue: "another",
    value: "b",
  },
  has_sometype: false,
};

// #8439: an import that is only referenced by decorator metadata.
standalone.files["import-only-used-in-decorator/index.ts"] = /*js*/ `
  import { TestInterface } from "./interface.ts";

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

  console.log(JSON.stringify(["import only used in decorator (#8439)", [TestClass.name, OtherClass.name]]));

  export {TestInterface};
`;
standalone.files["import-only-used-in-decorator/interface.ts"] = "export interface TestInterface {};";
standalone.files["import-only-used-in-decorator/tsconfig.json"] = JSON.stringify({
  compilerOptions: {
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  },
});
standalone.entries.push("import-only-used-in-decorator/index.ts");
standalone.expected["import only used in decorator (#8439)"] = ["TestClass", "OtherClass"];

standalone.files["index.ts"] = standalone.entries.map(entry => `import "./${entry}";\n`).join("");

describe("standalone programs", () => {
  let tmp: ReturnType<typeof tempDir>;
  let dir: string;
  beforeAll(() => {
    tmp = tempDir("type-export", standalone.files);
    dir = String(tmp);
  });
  afterAll(() => {
    tmp[Symbol.dispose]();
  });

  // The runtime transpiler does not generate ESM module_info yet, so
  // `export { my_string } from "./a.ts"` fails with "export 'my_string' not
  // found" when the files run unbundled. module_info is only generated for
  // standalone ESM bytecode (--compile). Enable this once the runtime does it.
  test.skip("run", async () => {
    const result = await run([bunExe(), "run", "index.ts"], dir);

    expect(result.stderr).toBe("");
    expect(parseLabeledLines(result.stdout)).toEqual(standalone.expected);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("compile", async () => {
    const outfile = join(dir, `compiled${ext}`);
    const buildResult = await run(
      [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "index.ts", "--outfile", outfile],
      dir,
    );
    expect(buildResult.stderr).toBe("");
    expect(buildResult.exitCode).toBe(0);

    const result = await run([outfile], dir);
    expect(result.stderr).toBe("");
    expect(parseLabeledLines(result.stdout)).toEqual(standalone.expected);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("build", async () => {
    const build_result = await Bun.build({
      entrypoints: standalone.entries.map(entry => join(dir, entry)),
      outdir: join(dir, "dist"),
      root: dir,
    });
    expect(build_result.success).toBe(true);
    const bundles = standalone.entries.map(entry => entry.replace(/\.ts$/, ".js"));
    expect(
      build_result.outputs
        .map(output => [relative(join(dir, "dist"), output.path).replaceAll("\\", "/"), output.kind])
        .sort(),
    ).toEqual(bundles.map(bundle => [bundle, "entry-point"]).sort());

    // Each entry is its own bundle. Run them all in one process, in order.
    const runner = bundles.map(bundle => `import "./dist/${bundle}";\n`).join("");
    await Bun.write(join(dir, "run-dist.js"), runner);
    const result = await run([bunExe(), "run", "run-dist.js"], dir);
    expect(result.stderr).toBe("");
    expect(parseLabeledLines(result.stdout)).toEqual(standalone.expected);
    expect(result.exitCode).toBe(0);
  });
});

describe("import not found", () => {
  test.concurrent("none", async () => {
    await using dir = tempDir("type-export", {
      "a.ts": "",
      "b.ts": /*js*/ `
        import { not_found } from "./a";
        console.log(not_found);
      `,
    });

    const result = await run([bunExe(), "run", "b.ts"], dir);

    expect(normalizeBunSnapshot(result.stderr, dir)).toMatchInlineSnapshot(`
      "SyntaxError: Export named 'not_found' not found in module '<dir>/a.ts'.

      Bun v<bun-version>"
    `);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("default with same name", async () => {
    await using dir = tempDir("type-export", {
      "a.ts": "export default function not_found() {};",
      "b.ts": /*js*/ `
        import { not_found } from "./a";
        console.log(not_found);
      `,
    });

    const result = await run([bunExe(), "run", "b.ts"], dir);

    expect(normalizeBunSnapshot(result.stderr, dir)).toMatchInlineSnapshot(`
      "SyntaxError: Export named 'not_found' not found in module '<dir>/a.ts'. Did you mean to import default?

      Bun v<bun-version>"
    `);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("type", async () => {
    await using dir = tempDir("type-export", {
      "a.ts": `export type not_found = "not_found";`,
      "b.ts": /*js*/ `
        import { not_found } from "./a";
        console.log(not_found);
      `,
    });

    const result = await run([bunExe(), "run", "b.ts"], dir);

    expect(normalizeBunSnapshot(result.stderr, dir)).toMatchInlineSnapshot(`
      "SyntaxError: Export named 'not_found' not found in module '<dir>/a.ts'.

      Bun v<bun-version>"
    `);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });
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
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file type import", async () => {
  await using dir = tempDir("type-import", {
    "b.js": "import {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only';",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(normalizeBunSnapshot(result.stderr, dir)).toMatchInlineSnapshot(`
    "SyntaxError: Export named 'type_only' not found in module '<dir>/ts.ts'.

    Bun v<bun-version>"
  `);
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file type import with default export", async () => {
  await using dir = tempDir("type-import", {
    "b.js": "import {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(normalizeBunSnapshot(result.stderr, dir)).toMatchInlineSnapshot(`
    "SyntaxError: Export named 'type_only' not found in module '<dir>/ts.ts'. Did you mean to import default?

    Bun v<bun-version>"
  `);
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file with through export", async () => {
  await using dir = tempDir("type-import", {
    "b.js": "export {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(normalizeBunSnapshot(result.stderr, dir)).toMatchInlineSnapshot(`
    "SyntaxError: export 'type_only' not found in './ts.ts'

    Bun v<bun-version>"
  `);
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file with through export 2", async () => {
  await using dir = tempDir("type-import", {
    "b.js": "import {type_only} from './ts.ts'; export {type_only};",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(normalizeBunSnapshot(result.stderr, dir)).toMatchInlineSnapshot(`
    "SyntaxError: export 'type_only' not found in './ts.ts'

    Bun v<bun-version>"
  `);
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(1);
});

describe("through export merge", () => {
  // this isn't allowed, even in typescript (tsc emits "Duplicate identifier 'value'.")
  // The columns are where the parser points: the duplicate export, then the
  // original one.
  const cases = [
    { name: "through", source: "export {value} from './b'; export {value} from './c';", duplicate: 36, original: 9 },
    { name: "direct", source: "export {value} from './b'; export const value = 'abc';", duplicate: 41, original: 9 },
    { name: "direct2", source: "export const value = 'abc'; export {value};", duplicate: 37, original: 14 },
    {
      name: "ns",
      source: "export * as value from './c'; export * as value from './c';",
      duplicate: 43,
      original: 13,
    },
  ];

  for (const fmt of ["js", "ts"]) {
    describe(fmt, () => {
      for (const { name, source, duplicate, original } of cases) {
        describe(name, () => {
          const dir = tempDirWithFiles("type-import", {
            ["main." + fmt]: "import {value} from './a'; console.log(value);",
            ["a." + fmt]: source,
            ["b." + fmt]: fmt === "ts" ? "export type value = 'b';" : "",
            ["c." + fmt]: "export const value = 'c';",
          });

          // Both the entry point and a file it imports report the parser's
          // error. The import path used to hand the file to JSC, which
          // reported "Cannot export a duplicate name 'value'." instead.
          for (const file of ["main." + fmt, "a." + fmt]) {
            test.concurrent(file, async () => {
              const result = await run([bunExe(), file], dir);

              const stderr = normalizeBunSnapshot(result.stderr, dir);
              expect(stderr).toContain(
                `error: Multiple exports with the same name "value"\n    at <dir>/a.${fmt}:1:${duplicate}\n`,
              );
              expect(stderr).toContain(
                `note: "value" was originally exported here\n   at <dir>/a.${fmt}:1:${original}\n`,
              );
              expect(result.stdout).toBe("");
              expect(result.exitCode).toBe(1);
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
  const result = await run([bunExe(), "main.ts"], dir);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe("my_value undefined\n");
  expect(result.exitCode).toBe(0);
});

test.concurrent("check merge", async () => {
  await using dir = tempDir("merge", {
    ["main.ts"]: "import {value} from './a'; console.log(value);",
    ["a.ts"]: "export * from './b'; export * from './c';",
    ["b.ts"]: "export const value = 'b';",
    ["c.ts"]: "export const value = 'c';",
  });
  const result = await run([bunExe(), "main.ts"], dir);
  expect(normalizeBunSnapshot(result.stderr, dir)).toMatchInlineSnapshot(`
    "SyntaxError: Export named 'value' cannot be resolved due to ambiguous multiple bindings in module '<dir>/a.ts'.

    Bun v<bun-version>"
  `);
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(1);
});

describe("export * from './module'", () => {
  for (const fmt of ["js", "ts"]) {
    describe(fmt, () => {
      const dir = tempDirWithFiles("export-star", {
        ["main." + fmt]: "import {value} from './a'; console.log(value);",
        ["a." + fmt]: "export * from './b';",
        ["b." + fmt]: "export const value = 'b';",
      });
      for (const [file, stdout] of [
        ["main." + fmt, "b\n"],
        ["a." + fmt, ""],
      ]) {
        test.concurrent(file, async () => {
          const result = await run([bunExe(), file], dir);
          expect(result.stderr).toBe("");
          expect(result.stdout).toBe(stdout);
          expect(result.exitCode).toBe(0);
        });
      }
    });
  }
});

describe("export * as ns from './module'", () => {
  for (const fmt of ["js", "ts"]) {
    describe(fmt, () => {
      const dir = tempDirWithFiles("export-star-as", {
        ["main." + fmt]: "import {ns} from './a'; console.log(ns.value);",
        ["a." + fmt]: "export * as ns from './b';",
        ["b." + fmt]: "export const value = 'b';",
      });
      for (const [file, stdout] of [
        ["main." + fmt, "b\n"],
        ["a." + fmt, ""],
      ]) {
        test.concurrent(file, async () => {
          const result = await run([bunExe(), file], dir);
          expect(result.stderr).toBe("");
          expect(result.stdout).toBe(stdout);
          expect(result.exitCode).toBe(0);
        });
      }
    });
  }
});

describe("export type {Type} from './module'", () => {
  const dir = tempDirWithFiles("export-type", {
    "main.ts": "import {Type} from './a'; const x: Type = 'test'; console.log(x);",
    "a.ts": "export type {Type} from './b';",
    "b.ts": "export type Type = string;",
  });
  for (const [file, stdout] of [
    ["main.ts", "test\n"],
    ["a.ts", ""],
  ]) {
    test.concurrent(file, async () => {
      const result = await run([bunExe(), file], dir);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(stdout);
      expect(result.exitCode).toBe(0);
    });
  }
});
