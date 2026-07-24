import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";

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

// Cap in-flight `--compile` builds: each one reads + rewrites a full standalone
// executable, and running all of them at once exhausts CI memory/IO
// (see the note at the top of test/bundler/bundler_compile.test.ts).
const maxConcurrentCompiles = 4;
let activeCompiles = 0;
const compileWaiters: (() => void)[] = [];
async function withCompileSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (activeCompiles >= maxConcurrentCompiles) {
    const { promise, resolve } = Promise.withResolvers<void>();
    compileWaiters.push(resolve);
    await promise;
  }
  activeCompiles++;
  try {
    return await fn();
  } finally {
    activeCompiles--;
    compileWaiters.shift()?.();
  }
}

async function compileAndRun(dir: string, entrypoint: string) {
  const outfile = dir + `/compiled${ext}`;
  return await withCompileSlot(async () => {
    const buildResult = await run(
      [bunExe(), "build", "--compile", "--bytecode", "--format=esm", entrypoint, "--outfile", outfile],
      dir,
    );
    expect(buildResult.stderr).toBe("");
    expect(buildResult.exitCode).toBe(0);

    return run([outfile], dir);
  });
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
  { name: "require", value: `console.log(JSON.stringify(require("./b")));` },
  { name: "import star", value: `import * as b from "./b"; console.log(JSON.stringify(b));` },
  { name: "await import", value: `console.log(JSON.stringify(await import("./b")));` },
  {
    name: "import individual",
    value: `
      import { my_string, my_value, my_only } from "./b";
      console.log(JSON.stringify({ my_only, my_value }));
    `,
  },
];

for (const b_file of b_files) {
  describe(`re-export with ${b_file.name}`, () => {
    for (const c_file of c_files) {
      describe(`import with ${c_file.name}`, () => {
        const dir = tempDirWithFiles("type-export", {
          "a.ts": a_file,
          "b.ts": b_file.value,
          "c.ts": c_file.value,
          "a_no_value.ts": a_no_value,
          "a_with_value.ts": a_with_value,
        });

        describe.each(["run", "compile", "build"])("%s", mode => {
          // TODO: "run" is skipped until ESM module_info is enabled in the runtime transpiler.
          // Currently module_info is only generated for standalone ESM bytecode (--compile).
          // Once enabled, flip this to include "run".
          const testFn = mode === "run" ? test.skip : test.concurrent;
          testFn("works", async () => {
            let result: { stdout: string; stderr: string; exitCode: number };
            if (mode === "compile") {
              result = await compileAndRun(dir, dir + "/c.ts");
            } else if (mode === "build") {
              const build_result = await Bun.build({
                entrypoints: [dir + "/c.ts"],
                outdir: dir + "/dist",
              });
              expect(build_result.success).toBe(true);
              result = await run([bunExe(), "run", dir + "/dist/c.js"], dir);
            } else {
              result = await run([bunExe(), "run", "c.ts"], dir);
            }

            const parsedOutput = JSON.parse(result.stdout.trim());
            expect(parsedOutput).toEqual({ my_value: "2", my_only: "3" });
            expect(result.exitCode).toBe(0);
          });
        });
      });
    }
  });
}

describe("import not found", () => {
  for (const [ccase, target_value, name] of [
    [``, /SyntaxError: Export named 'not_found' not found in module '[^']+?'\./, "none"],
    [
      `export default function not_found() {};`,
      /SyntaxError: Export named 'not_found' not found in module '[^']+?'\. Did you mean to import default\?/,
      "default with same name",
    ],
    [
      `export type not_found = "not_found";`,
      /SyntaxError: Export named 'not_found' not found in module '[^']+?'\./,
      "type",
    ],
  ] as const)
    test.concurrent(`${name}`, async () => {
      const dir = tempDirWithFiles("type-export", {
        "a.ts": ccase,
        "b.ts": /*js*/ `
          import { not_found } from "./a";
          console.log(not_found);
        `,
        "nf.ts": "",
      });

      const result = await run([bunExe(), "run", "b.ts"], dir);

      expect(result.stderr.trim()).toMatch(target_value);
      expect({
        exitCode: result.exitCode,
        stdout: result.stdout.trim(),
      }).toEqual({
        exitCode: 1,
        stdout: "",
      });
    });
});

test.concurrent("js file type export", async () => {
  const dir = tempDirWithFiles("type-export", {
    "a.js": "export {not_found};",
  });

  const result = await run([bunExe(), "a.js"], dir);

  expect(result.stderr.trim()).toInclude('error: "not_found" is not declared in this file');
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file type import", async () => {
  const dir = tempDirWithFiles("type-import", {
    "b.js": "import {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only';",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(result.stderr.trim()).toInclude("Export named 'type_only' not found in module '");
  expect(result.stderr.trim()).not.toInclude("Did you mean to import default?");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file type import with default export", async () => {
  const dir = tempDirWithFiles("type-import", {
    "b.js": "import {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(result.stderr.trim()).toInclude("Export named 'type_only' not found in module '");
  expect(result.stderr.trim()).toInclude("Did you mean to import default?");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file with through export", async () => {
  const dir = tempDirWithFiles("type-import", {
    "b.js": "export {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(result.stderr.trim()).toInclude("SyntaxError: export 'type_only' not found in './ts.ts'");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file with through export 2", async () => {
  const dir = tempDirWithFiles("type-import", {
    "b.js": "import {type_only} from './ts.ts'; export {type_only};",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(result.stderr.trim()).toInclude("SyntaxError: export 'type_only' not found in './ts.ts'");
  expect(result.exitCode).toBe(1);
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

          for (const file of ["main." + fmt, "a." + fmt]) {
            test.concurrent(file, async () => {
              const result = await run([bunExe(), file], dir);

              // Bun's parser error surfaces whether `a` is the entrypoint or
              // reached via import (the async transpile path now propagates
              // parser log errors instead of handing the broken output to JSC).
              expect(result.stderr.trim()).toInclude('error: Multiple exports with the same name "value"\n');

              expect(result.exitCode).toBe(1);
            });
          }
        });
      }
    });
  }
});

describe("check ownkeys from a star import", () => {
  const dir = tempDirWithFiles("ownkeys-star-import", {
    ["main.ts"]: `
      import * as ns from './a';
      console.log(JSON.stringify({
        keys: Object.keys(ns).sort(),
        ns,
        has_sometype: Object.hasOwn(ns, 'sometype'),
      }));
    `,
    ["a.ts"]: "export * from './b'; export {sometype} from './b';",
    ["b.ts"]: "export const value = 'b'; export const anotherValue = 'another'; export type sometype = 'sometype';",
  });

  const expected = {
    keys: ["anotherValue", "value"],
    ns: {
      anotherValue: "another",
      value: "b",
    },
    has_sometype: false,
  };

  describe.each(["run", "compile"] as const)("%s", mode => {
    const testFn = mode === "run" ? test.skip : test.concurrent;

    testFn("works", async () => {
      const result =
        mode === "compile" ? await compileAndRun(dir, dir + "/main.ts") : await run([bunExe(), "main.ts"], dir);

      expect(result.stderr.trim()).toBe("");
      expect(JSON.parse(result.stdout.trim())).toEqual(expected);
      expect(result.exitCode).toBe(0);
    });
  });
});

test.concurrent("check commonjs", async () => {
  const dir = tempDirWithFiles("commonjs", {
    ["main.ts"]: "const {my_value, my_type} = require('./a'); console.log(my_value, my_type);",
    ["a.ts"]: "module.exports = require('./b');",
    ["b.ts"]: "export const my_value = 'my_value'; export type my_type = 'my_type';",
  });
  const result = await run([bunExe(), "main.ts"], dir);
  expect(result.stderr.trim()).toBe("");
  expect(result.stdout.trim()).toBe("my_value undefined");
  expect(result.exitCode).toBe(0);
});

test.concurrent("check merge", async () => {
  const dir = tempDirWithFiles("merge", {
    ["main.ts"]: "import {value} from './a'; console.log(value);",
    ["a.ts"]: "export * from './b'; export * from './c';",
    ["b.ts"]: "export const value = 'b';",
    ["c.ts"]: "export const value = 'c';",
  });
  const result = await run([bunExe(), "main.ts"], dir);
  expect(result.stderr.trim()).toInclude(
    "SyntaxError: Export named 'value' cannot be resolved due to ambiguous multiple bindings in module",
  );
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
      for (const file of ["main." + fmt, "a." + fmt]) {
        test.concurrent(file, async () => {
          const result = await run([bunExe(), file], dir);
          expect(result.stderr.trim()).toBe("");
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
      for (const file of ["main." + fmt, "a." + fmt]) {
        test.concurrent(file, async () => {
          const result = await run([bunExe(), file], dir);
          expect(result.stderr.trim()).toBe("");
          expect(result.exitCode).toBe(0);
        });
      }
    });
  }
});

describe("export type {Type} from './module'", () => {
  for (const fmt of ["ts"]) {
    describe(fmt, () => {
      const dir = tempDirWithFiles("export-type", {
        ["main." + fmt]: "import {Type} from './a'; const x: Type = 'test'; console.log(x);",
        ["a." + fmt]: "export type {Type} from './b';",
        ["b." + fmt]: "export type Type = string;",
      });
      for (const file of ["main." + fmt, "a." + fmt]) {
        test.concurrent(file, async () => {
          const result = await run([bunExe(), file], dir);
          expect(result.stderr.trim()).toBe("");
          expect(result.exitCode).toBe(0);
        });
      }
    });
  }
});

describe("import only used in decorator (#8439)", () => {
  const dir = tempDirWithFiles("import-only-used-in-decorator", {
    ["index.ts"]: /*js*/ `
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

      export {TestInterface};
    `,
    ["interface.ts"]: "export interface TestInterface {};",
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }),
  });

  describe.each(["run", "compile"] as const)("%s", mode => {
    const testFn = mode === "run" ? test.skip : test.concurrent;

    testFn("works", async () => {
      const result =
        mode === "compile" ? await compileAndRun(dir, dir + "/index.ts") : await run([bunExe(), "index.ts"], dir);

      expect(result.stderr.trim()).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});
