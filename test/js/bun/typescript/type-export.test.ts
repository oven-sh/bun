import { describe, test, expect } from "bun:test" with { todo: "true" };
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

/*
Potential solutions:
- Option 1: Make a fake export `export const my_string = undefined;` and make sure it is not enumerable
- Option 2: In b.ts, make javascriptcore skip re-exporting something if it is not found rather than SyntaxErroring
  - this won't work because in the import {} export {} case, the error will be on the import
*/

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

        const runAndVerify = (filename: string) => {
          const result = Bun.spawnSync({
            cmd: [bunExe(), "run", filename],
            cwd: dir,
            env: bunEnv,
            stdio: ["inherit", "pipe", "inherit"],
          });

          expect(result.exitCode).toBe(0);
          expect(JSON.parse(result.stdout.toString().trim())).toEqual({ my_value: "2", my_only: "3" });
        };

        test("run", () => {
          runAndVerify("c.ts");
        });

        test("build", async () => {
          const build_result = await Bun.build({
            entrypoints: [dir + "/c.ts"],
            outdir: dir + "/dist",
          });
          expect(build_result.success).toBe(true);
          runAndVerify(dir + "/dist/c.js");
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
    test(`${name}`, () => {
      const dir = tempDirWithFiles("type-export", {
        "a.ts": ccase,
        "b.ts": /*js*/ `
          import { not_found } from "./a";
          console.log(not_found);
        `,
        "nf.ts": "",
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), "run", "b.ts"],
        cwd: dir,
        env: bunEnv,
        stdio: ["inherit", "pipe", "pipe"],
      });

      expect(result.stderr?.toString().trim()).toMatch(target_value);
      expect({
        exitCode: result.exitCode,
        stdout: result.stdout?.toString().trim(),
      }).toEqual({
        exitCode: 1,
        stdout: "",
      });
    });
});

test("js file type export", () => {
  const dir = tempDirWithFiles("type-export", {
    "a.js": "export {not_found};",
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "a.js"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(result.stderr?.toString().trim()).toInclude('error: "not_found" is not declared in this file');
  expect(result.exitCode).toBe(1);
});
test("js file type import", () => {
  const dir = tempDirWithFiles("type-import", {
    "b.js": "import {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only';",
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "b.js"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(result.stderr?.toString().trim()).toInclude("Export named 'type_only' not found in module '");
  expect(result.stderr?.toString().trim()).not.toInclude("Did you mean to import default?");
  expect(result.exitCode).toBe(1);
});
test("js file type import with default export", () => {
  const dir = tempDirWithFiles("type-import", {
    "b.js": "import {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "b.js"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(result.stderr?.toString().trim()).toInclude("Export named 'type_only' not found in module '");
  expect(result.stderr?.toString().trim()).toInclude("Did you mean to import default?");
  expect(result.exitCode).toBe(1);
});

test("js file with through export", () => {
  const dir = tempDirWithFiles("type-import", {
    "b.js": "export {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "b.js"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(result.stderr?.toString().trim()).toInclude("SyntaxError: export 'type_only' not found in './ts.ts'\n");
  expect(result.exitCode).toBe(1);
});

test("js file with through export 2", () => {
  const dir = tempDirWithFiles("type-import", {
    "b.js": "import {type_only} from './ts.ts'; export {type_only};",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "b.js"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(result.stderr?.toString().trim()).toInclude("SyntaxError: export 'type_only' not found in './ts.ts'\n");
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
            test(file, () => {
              const result = Bun.spawnSync({
                cmd: [bunExe(), file],
                cwd: dir,
                env: bunEnv,
                stdio: ["inherit", "pipe", "pipe"],
              });
              expect(result.stderr?.toString().trim()).toInclude(
                file === "a." + fmt
                  ? 'error: Multiple exports with the same name "value"\n' // bun's syntax error
                  : "SyntaxError: Cannot export a duplicate name 'value'.\n", // jsc's syntax error
              );
              expect(result.exitCode).toBe(1);
            });
          }
        });
      }
    });
  }
});

// TODO:
test("check ownkeys from a star import", () => {
  const dir = tempDirWithFiles("ownkeys-star-import", {
    ["main.ts"]: `
            import * as ns from './a';
            console.log(JSON.stringify({
              keys: Object.keys(ns),
              ns,
              has_sometype: Object.hasOwn(ns, 'sometype'),
            }));
          `,
    ["a.ts"]: "export * from './b'; export {sometype} from './b';",
    ["b.ts"]: "export const value = 'b'; export const anotherValue = 'another'; export type sometype = 'sometype';",
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "main.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(result.stderr?.toString().trim()).toBe("");
  expect(JSON.parse(result.stdout?.toString().trim())).toEqual({
    keys: ["anotherValue", "value"],
    ns: {
      anotherValue: "another",
      value: "b",
    },
    has_sometype: false,
  });
  expect(result.exitCode).toBe(0);
});
test("check commonjs", () => {
  const dir = tempDirWithFiles("commonjs", {
    ["main.ts"]: "const {my_value, my_type} = require('./a'); console.log(my_value, my_type);",
    ["a.ts"]: "module.exports = require('./b');",
    ["b.ts"]: "export const my_value = 'my_value'; export type my_type = 'my_type';",
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "main.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(result.stderr?.toString().trim()).toBe("");
  expect(result.stdout?.toString().trim()).toBe("my_value undefined");
  expect(result.exitCode).toBe(0);
});
test("check merge", () => {
  const dir = tempDirWithFiles("merge", {
    ["main.ts"]: "import {value} from './a'; console.log(value);",
    ["a.ts"]: "export * from './b'; export * from './c';",
    ["b.ts"]: "export const value = 'b';",
    ["c.ts"]: "export const value = 'c';",
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "main.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(result.stderr?.toString().trim()).toInclude(
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
        test(file, () => {
          const result = Bun.spawnSync({
            cmd: [bunExe(), file],
            cwd: dir,
            env: bunEnv,
            stdio: ["inherit", "pipe", "pipe"],
          });
          expect(result.stderr?.toString().trim()).toBe("");
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
        test(file, () => {
          const result = Bun.spawnSync({
            cmd: [bunExe(), file],
            cwd: dir,
            env: bunEnv,
            stdio: ["inherit", "pipe", "pipe"],
          });
          expect(result.stderr?.toString().trim()).toBe("");
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
        test(file, () => {
          const result = Bun.spawnSync({
            cmd: [bunExe(), file],
            cwd: dir,
            env: bunEnv,
            stdio: ["inherit", "pipe", "pipe"],
          });
          expect(result.stderr?.toString().trim()).toBe("");
          expect(result.exitCode).toBe(0);
        });
      }
    });
  }
});

test("import only used in decorator (#8439)", () => {
  const dir = tempDirWithFiles("import-only-used-in-decorator", {
    ["index.ts"]: /*js*/ `
      // index.ts
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
      "compilerOptions": {
        "experimentalDecorators": true,
        "emitDecoratorMetadata": true,
      },
    }),
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(result.stderr?.toString().trim()).toBe("");
  expect(result.exitCode).toBe(0);
});
