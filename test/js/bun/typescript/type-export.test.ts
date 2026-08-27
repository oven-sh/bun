import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir, tempDirWithFiles } from "harness";

const ext = isWindows ? ".exe" : "";
// `bun build --compile --bytecode` reads + rewrites a full standalone
// executable (~1 GB under debug+ASAN) and the 18 compile cases queue behind a
// 4-slot semaphore, so the tail tests' wall clock is (queue depth × per-compile
// time) and easily clears the 5s default.
const compileTimeout = isDebug ? 180_000 : undefined;

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
    try {
      const buildResult = await run(
        [bunExe(), "build", "--compile", "--bytecode", "--format=esm", entrypoint, "--outfile", outfile],
        dir,
      );
      expect(buildResult.stderr).toBe("");
      expect(buildResult.exitCode).toBe(0);

      return await run([outfile], dir);
    } finally {
      // A debug+ASAN standalone executable is ~1 GB; 18 of them exhaust disk.
      await Bun.file(outfile)
        .delete()
        .catch(() => {});
    }
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
          test.concurrent(
            "works",
            async () => {
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
            },
            mode === "compile" ? compileTimeout : undefined,
          );
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
      await using dir = tempDir("type-export", {
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
  await using dir = tempDir("type-export", {
    "a.js": "export {not_found};",
  });

  const result = await run([bunExe(), "a.js"], dir);

  expect(result.stderr.trim()).toInclude('error: "not_found" is not declared in this file');
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file type import", async () => {
  await using dir = tempDir("type-import", {
    "b.js": "import {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only';",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(result.stderr.trim()).toInclude("Export named 'type_only' not found in module '");
  expect(result.stderr.trim()).not.toInclude("Did you mean to import default?");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file type import with default export", async () => {
  await using dir = tempDir("type-import", {
    "b.js": "import {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(result.stderr.trim()).toInclude("Export named 'type_only' not found in module '");
  expect(result.stderr.trim()).toInclude("Did you mean to import default?");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file with through export", async () => {
  await using dir = tempDir("type-import", {
    "b.js": "export {type_only} from './ts.ts';",
    "ts.ts": "export type type_only = 'type_only'; export default function type_only() {};",
  });

  const result = await run([bunExe(), "b.js"], dir);

  expect(result.stderr.trim()).toInclude("SyntaxError: export 'type_only' not found in './ts.ts'");
  expect(result.exitCode).toBe(1);
});

test.concurrent("js file with through export 2", async () => {
  await using dir = tempDir("type-import", {
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

          // Both the entry point and a file it imports report the parser's
          // error. The import path used to hand the file to JSC, which
          // reported "Cannot export a duplicate name 'value'." instead.
          for (const file of ["main." + fmt, "a." + fmt]) {
            test.concurrent(file, async () => {
              const result = await run([bunExe(), file], dir);

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
    test.concurrent(
      "works",
      async () => {
        const result =
          mode === "compile" ? await compileAndRun(dir, dir + "/main.ts") : await run([bunExe(), "main.ts"], dir);

        expect(result.stderr.trim()).toBe("");
        expect(JSON.parse(result.stdout.trim())).toEqual(expected);
        expect(result.exitCode).toBe(0);
      },
      mode === "compile" ? compileTimeout : undefined,
    );
  });
});

test.concurrent("check commonjs", async () => {
  await using dir = tempDir("commonjs", {
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
  await using dir = tempDir("merge", {
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
    test.concurrent(
      "works",
      async () => {
        const result =
          mode === "compile" ? await compileAndRun(dir, dir + "/index.ts") : await run([bunExe(), "index.ts"], dir);

        expect(result.stderr.trim()).toBe("");
        expect(result.exitCode).toBe(0);
      },
      mode === "compile" ? compileTimeout : undefined,
    );
  });
});

// https://github.com/oven-sh/bun/issues/7384
describe("re-export of type alongside value at runtime (#7384)", () => {
  const dir = tempDirWithFiles("reexport-type-7384", {
    "EventTypes.ts": `
      export type ValueOf<T> = T[keyof T];
      export const BUEvents = { A: "a", B: "b" } as const;
    `,
    "utils.ts": `export { ValueOf, BUEvents } from "./EventTypes";`,
    "index.ts": `
      import { ValueOf, BUEvents } from "./utils";
      type X = ValueOf<typeof BUEvents>;
      const x: X = BUEvents.A;
      console.log(JSON.stringify({ x, keys: Object.keys(BUEvents).sort() }));
    `,
  });

  // BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER routes through the sync
  // transpile in jsc_hooks.rs; without it the async RuntimeTranspilerStore path
  // is taken. Both must attach module_info.
  for (const disableAsync of [false, true]) {
    test.concurrent(disableAsync ? "sync transpiler" : "async transpiler", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.ts"],
        env: disableAsync ? { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" } : bunEnv,
        cwd: dir,
        stdio: ["inherit", "pipe", "pipe"],
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr.trim()).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({ x: "a", keys: ["A", "B"] });
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent("BUN_FEATURE_FLAG_DISABLE_RUNTIME_MODULE_INFO restores the old error", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_RUNTIME_MODULE_INFO: "1" },
      cwd: dir,
      stdio: ["inherit", "pipe", "pipe"],
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("export 'ValueOf' not found");
    expect(exitCode).toBe(1);
  });

  // The on-disk RuntimeTranspilerCache stores the serialized ModuleInfo as
  // esm_record. bunEnv disables the cache and the fixtures above are under the
  // 4 KiB minimum, so cover the cache-HIT path explicitly: pad utils.ts past
  // the floor, point BUN_RUNTIME_TRANSPILER_CACHE_PATH at a real dir, and run
  // twice per transpile path so the second run hits create_from_cached_record.
  const padding = Array.from({ length: 400 }, (_, i) => `const pad_${i} = ${i};`).join("\n");
  const cacheDir = tempDirWithFiles("reexport-type-7384-cache", {
    "EventTypes.ts": `
      export type ValueOf<T> = T[keyof T];
      export const BUEvents = { A: "a", B: "b" } as const;
    `,
    "utils.ts": `${padding}\nexport { ValueOf, BUEvents } from "./EventTypes";`,
    "index.ts": `
      import { ValueOf, BUEvents } from "./utils";
      const x: ValueOf<typeof BUEvents> = BUEvents.A;
      console.log(JSON.stringify({ x, keys: Object.keys(BUEvents).sort() }));
    `,
    ".cache-async/.keep": "",
    ".cache-sync/.keep": "",
  });
  for (const disableAsync of [false, true]) {
    test(`${disableAsync ? "sync" : "async"} transpiler (runtime transpiler cache hit)`, async () => {
      const env = {
        ...bunEnv,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: `${cacheDir}/.cache-${disableAsync ? "sync" : "async"}`,
        BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
        ...(disableAsync ? { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" } : {}),
      };
      for (const which of ["miss", "hit"]) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "index.ts"],
          env,
          cwd: cacheDir,
          stdio: ["inherit", "pipe", "pipe"],
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ which, stderr: stderr.trim(), out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
          which,
          stderr: "",
          out: { x: "a", keys: ["A", "B"] },
          exitCode: 0,
        });
      }
    });
  }
});

// Marking the JSModuleRecord m_isTypeScript means *every* unresolved indirect
// export in a .ts file is tolerated at link time, not just type-only ones: the
// re-exporting file has no local signal for which is which. A direct import of
// the missing name still errors; a namespace import just omits the key. This
// matches what `bun build` / `--compile` already produced and what
// ts-node/tsx do. Pin it so the trade-off is explicit.
test.concurrent("ts barrel re-exporting a missing value name links without error", async () => {
  await using dir = tempDir("reexport-missing-value", {
    "lib.ts": "export const foo = 1;",
    "barrel.ts": `export { foo, fooo } from "./lib";`,
    "via-ns.ts": `
      import * as b from "./barrel";
      console.log(JSON.stringify({ keys: Object.keys(b).sort(), fooo: (b as any).fooo }));
    `,
    "via-named.ts": `import { fooo } from "./barrel"; console.log(fooo);`,
  });
  {
    const ns = await run([bunExe(), "via-ns.ts"], dir);
    expect(ns.stderr.trim()).toBe("");
    expect(JSON.parse(ns.stdout.trim())).toEqual({ keys: ["foo"], fooo: undefined });
    expect(ns.exitCode).toBe(0);
  }
  {
    const named = await run([bunExe(), "via-named.ts"], dir);
    expect(named.stderr).toContain("Export named 'fooo' not found");
    expect(named.exitCode).toBe(1);
  }
});

// require(esm) replays part of the load synchronously and JSC hands the same
// fetched source to the module analyzer a second time. The prebuilt module
// record attached to runtime ESM must survive that second call; when it was
// freed after the first one, the shared dependency `a` failed with
// "module_info is null" for the whole graph.
describe.each([
  { name: "js", esm: "mjs", cjs: "cjs" },
  { name: "ts", esm: "ts", cjs: "cts" },
])("cjs entry requiring an esm graph with a shared dep ($name)", ({ esm, cjs }) => {
  test.concurrent("loads and evaluates the shared dep once", async () => {
    await using dir = tempDir("require-esm-diamond", {
      [`entry.${cjs}`]: `require("./app.${esm}");`,
      [`app.${esm}`]: `
        import * as P from "./a.${esm}";
        import Q from "./mid.${cjs}";
        console.log(JSON.stringify({ P: P.value, Q, aEval: globalThis.aEval }));
      `,
      [`mid.${cjs}`]: `const y = require("./y.${esm}"); module.exports = { mid: y.y };`,
      [`y.${esm}`]: `import { value } from "./a.${esm}"; export const y = "y:" + value;`,
      [`a.${esm}`]: `export const value = "a"; globalThis.aEval = (globalThis.aEval ?? 0) + 1;`,
    });
    const result = await run([bunExe(), `entry.${cjs}`], String(dir));
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.trim())).toEqual({ P: "a", Q: { mid: "y:a" }, aEval: 1 });
    expect(result.exitCode).toBe(0);
  });
});
