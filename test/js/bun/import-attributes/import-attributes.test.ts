import { Database } from "bun:sqlite";
import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";
import * as path from "path";

const loaders = ["js", "jsx", "ts", "tsx", "json", "jsonc", "toml", "yaml", "text", "sqlite", "file"];
const other_loaders_do_not_crash = ["webassembly", "does_not_exist"];

async function runCmd(cmd: string[], dir: string): Promise<unknown> {
  await using proc = Bun.spawn({
    cmd: cmd,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    if (stderr.includes("panic")) {
      console.error("cmd stderr");
      console.log(stderr);
      console.error("cmd stdout");
      console.log(stdout);
      console.error("cmd args");
      console.log(JSON.stringify(cmd));
      console.error("cmd cwd");
      console.log(dir);
      throw new Error("panic");
    }
    return "error";
    // return stderr.match(/error: .+/)?.[0];
  } else {
    return JSON.parse(stdout);
  }
}

async function testBunRunRequire(dir: string, loader: string | null, filename: string): Promise<unknown> {
  if (loader != null) throw new Error("cannot use loader with require()");
  const cmd = [bunExe(), "-e", `const contents = require('./${filename}'); console.log(JSON.stringify(contents));`];
  return runCmd(cmd, dir);
}
async function testBunRun(dir: string, loader: string | null, filename: string): Promise<unknown> {
  const cmd = [
    bunExe(),
    "-e",
    `import * as contents from './${filename}'${loader != null ? ` with {type: '${loader}'}` : ""}; console.log(JSON.stringify(contents));`,
  ];
  return runCmd(cmd, dir);
}
async function testBunRunAwaitImport(dir: string, loader: string | null, filename: string): Promise<unknown> {
  const cmd = [
    bunExe(),
    "-e",
    `console.log(JSON.stringify(await import('./${filename}'${loader != null ? `, {with: {type: '${loader}'}}` : ""})));`,
  ];
  return runCmd(cmd, dir);
}
async function testBunBuild(dir: string, loader: string | null, filename: string): Promise<unknown> {
  await Bun.write(
    path.join(dir, "main_" + loader + ".js"),
    `import * as contents from './${filename}'${loader != null ? ` with {type: '${loader}'${loader === "sqlite" ? ", embed: 'true'" : ""}}` : ""}; console.log(JSON.stringify(contents));`,
  );
  const result = await Bun.build({
    entrypoints: [path.join(dir, "main_" + loader + ".js")],
    throw: false,
    target: "bun",
    outdir: path.join(dir, "out"),
  });
  if (result.success) {
    const cmd = [bunExe(), "out/main_" + loader + ".js"];
    return runCmd(cmd, dir);
  } else {
    return "error";
  }
}
async function testBunBuildRequire(dir: string, loader: string | null, filename: string): Promise<unknown> {
  if (loader != null) throw new Error("cannot use loader with require()");
  await Bun.write(
    path.join(dir, "main_" + loader + ".js"),
    `const contents = require('./${filename}'); console.log(JSON.stringify(contents));`,
  );
  const result = await Bun.build({
    entrypoints: [path.join(dir, "main_" + loader + ".js")],
    throw: false,
    target: "bun",
    outdir: path.join(dir, "out"),
  });
  if (result.success) {
    const cmd = [bunExe(), "out/main_" + loader + ".js"];
    return runCmd(cmd, dir);
  } else {
    return "error";
  }
}
type Tests = Record<
  string,
  {
    loader: string | null;
    filename: string;
  }
>;
const default_tests = Object.fromEntries(
  loaders.map(loader => [loader, { loader, filename: "no_extension" }]),
) as Tests;
async function compileAndTest(code: string, tests: Tests = default_tests): Promise<Record<string, unknown>> {
  const [v1, v2, v3] = await Promise.all([
    compileAndTest_inner(code, tests, testBunRun),
    compileAndTest_inner(code, tests, testBunRunAwaitImport),
    compileAndTest_inner(code, tests, testBunBuild),
  ]);
  if (!Bun.deepEquals(v1, v2) || !Bun.deepEquals(v2, v3)) {
    console.log("====  regular import  ====\n" + JSON.stringify(v1, null, 2) + "\n");
    console.log("====  await import  ====\n" + JSON.stringify(v2, null, 2) + "\n");
    console.log("====  build  ====\n" + JSON.stringify(v3, null, 2) + "\n");
    throw new Error("did not equal");
  }
  return v1;
}
async function compileAndTest_inner(
  code: string,
  tests: Tests,
  cb: (dir: string, loader: string | null, filename: string) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const dirs: Record<string, string> = {};
  const entries = Object.entries(tests);
  const results = await Promise.all(
    entries.map(async ([label, test]) => {
      const dir = tempDirWithFiles("import-attributes", {
        [test.filename]: code,
      });
      dirs[label] = dir;
      return [label, await cb(dir, test.loader, test.filename)] as const;
    }),
  );
  let res: Record<string, unknown> = Object.fromEntries(results);
  if (Object.hasOwn(res, "text")) {
    expect(res.text).toEqual({ default: code });
    delete res.text;
  }
  if (Object.hasOwn(res, "yaml")) {
    const yaml_res = res.yaml as Record<string, unknown>;
    delete (yaml_res as any).__esModule;

    for (const key of Object.keys(yaml_res)) {
      if (key.startsWith("//")) {
        delete (yaml_res as any)[key];
      }
    }
  }

  if (Object.hasOwn(res, "sqlite")) {
    const sqlite_res = res.sqlite;
    delete (sqlite_res as any).__esModule;
    if (cb === testBunBuild) {
      expect(sqlite_res).toStrictEqual({
        default: { filename: expect.any(String) },
      });
      expect((sqlite_res as any).default.filename.toUpperCase()).toStartWith(
        path.join(dirs.sqlite!, "out").toUpperCase(),
      );
    } else {
      expect(sqlite_res).toStrictEqual({
        db: { filename: path.join(dirs.sqlite!, tests.sqlite!.filename) },
        default: { filename: path.join(dirs.sqlite!, tests.sqlite!.filename) },
      });
    }
    delete res.sqlite;
  }
  if (Object.hasOwn(res, "file")) {
    const file_res = res.file;
    if (cb === testBunBuild) {
      expect(file_res).toEqual({
        default: expect.any(String),
      });
    } else {
      delete (file_res as any).__esModule;
      expect(file_res).toEqual({
        default: path.join(dirs.file!, tests.file!.filename),
      });
    }
    delete res.file;
  }
  const res_flipped: Record<string, [unknown, string[]]> = {};
  for (const [k, v] of Object.entries(res)) {
    (res_flipped[JSON.stringify(v)] ??= [v, []])[1].push(k);
  }
  return Object.fromEntries(Object.entries(res_flipped).map(([k, [k2, v]]) => [v.join(","), k2]));
}

test("javascript", async () => {
  expect(await compileAndTest(`export const a = "demo";`)).toMatchInlineSnapshot(`
{
  "js,jsx,ts,tsx": {
    "a": "demo",
  },
  "json,jsonc,toml": "error",
  "yaml": {
    "default": "export const a = \"demo\";",
  },
}
`);
});

test("typescript", async () => {
  expect(await compileAndTest(`export const a = (<T>() => {}).toString().replace(/\\n/g, '');`)).toMatchInlineSnapshot(`
{
  "js,jsx,tsx,json,jsonc,toml": "error",
  "ts": {
    "a": "() => {}",
  },
  "yaml": {
    "default": "export const a = (<T>() => {}).toString().replace(/\\n/g, '');",
  },
}
`);
});

test("json", async () => {
  expect(await compileAndTest(`{"key": "👩‍👧‍👧value"}`)).toMatchInlineSnapshot(`
{
  "js,jsx,ts,tsx,toml": "error",
  "json,jsonc,yaml": {
    "default": {
      "key": "👩‍👧‍👧value",
    },
    "key": "👩‍👧‍👧value",
  },
}
`);
});
test("jsonc", async () => {
  expect(
    await compileAndTest(`{
      "key": "👩‍👧‍👧value", // my json
    }`),
  ).toMatchInlineSnapshot(`
    {
      "js,jsx,ts,tsx,json,toml": "error",
      "jsonc": {
        "default": {
          "key": "👩‍👧‍👧value",
        },
        "key": "👩‍👧‍👧value",
      },
      "yaml": {
        "default": {
          "// my json": null,
          "key": "👩‍👧‍👧value",
        },
        "key": "👩‍👧‍👧value",
      },
    }
  `);
});
test("toml", async () => {
  expect(
    await compileAndTest(`[section]
    key = "👩‍👧‍👧value"`),
  ).toMatchInlineSnapshot(`
{
  "js,jsx,ts,tsx,json,jsonc,yaml": "error",
  "toml": {
    "default": {
      "section": {
        "key": "👩‍👧‍👧value",
      },
    },
    "section": {
      "key": "👩‍👧‍👧value",
    },
  },
}
`);
});

test("yaml", async () => {
  expect(
    await compileAndTest(`section:
  key: "👩‍👧‍👧value"`),
  ).toMatchInlineSnapshot(`
{
  "js,jsx,ts,tsx": {},
  "json,jsonc,toml": "error",
  "yaml": {
    "default": {
      "section": {
        "key": "👩‍👧‍👧value",
      },
    },
    "section": {
      "key": "👩‍👧‍👧value",
    },
  },
}
`);
});

test("tsconfig.json is assumed jsonc", async () => {
  const tests: Tests = {
    "tsconfig.json": { loader: null, filename: "tsconfig.json" },
    "myfile.json": { loader: null, filename: "myfile.json" },
  };
  expect(
    await compileAndTest(
      `{
        // jsonc file
        "key": "👩‍👧‍👧def",
      }`,
      tests,
    ),
  ).toMatchInlineSnapshot(`
{
  "myfile.json": "error",
  "tsconfig.json": {
    "default": {
      "key": "👩‍👧‍👧def",
    },
    "key": "👩‍👧‍👧def",
  },
}
`);
  expect(
    await compileAndTest(
      `{
        "key": "👩‍👧‍👧def"
      }`,
      tests,
    ),
  ).toMatchInlineSnapshot(`
{
  "tsconfig.json,myfile.json": {
    "default": {
      "key": "👩‍👧‍👧def",
    },
    "key": "👩‍👧‍👧def",
  },
}
`);
});

describe("other loaders do not crash", () => {
  for (const skipped_loader of other_loaders_do_not_crash) {
    test(skipped_loader, async () => {
      await compileAndTest(`export const a = "demo";`);
    });
  }
});

describe("?raw", () => {
  for (const [name, fn] of [
    ["bun run", testBunRun],
    // ["bun build", testBunBuild], // TODO: bun.build doesn't support query params at all yet
    ["bun run await import", testBunRunAwaitImport],
    ["require", testBunRunRequire],
    // ["bun build require", testBunBuildRequire], // TODO: bun.build doesn't support query params at all yet
  ] as const) {
    test(name, async () => {
      const filename = "abcd.js";
      const code = "export const a = 'demo';";
      await using question_raw = tempDir("import-attributes", {
        [filename]: code,
      });
      expect(await fn(question_raw, null, filename + "?raw")).toEqual({ default: code });
    });
  }
});

// The runtime reads the same `with { ... }` clause the parser keeps on the
// import record: every form of import carries it, `type` picks the loader, and
// the module map keys a file by (path, type).
describe.concurrent("with clause at runtime", () => {
  async function run(files: Record<string, string | Buffer>, entry = "entry.js") {
    using dir = tempDir("import-attributes-runtime", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("the same file imported with two types is two modules", async () => {
    expect(
      await run({
        "entry.js": `
          import txt from "./data.json" with { type: "text" };
          import json from "./data.json" with { type: "json" };
          import plain from "./data.json";
          const dyn = await import("./data.json", { with: { type: "text" } });
          console.log(typeof txt, typeof json, typeof plain, typeof dyn.default, json === plain);
        `,
        "data.json": `{"a":1}`,
      }),
    ).toEqual({ stdout: "string object object string false\n", stderr: "", exitCode: 0 });
  });

  test("re-exports carry the clause", async () => {
    expect(
      await run({
        "entry.js": `
          import { a, b, ns } from "./reexport.js";
          console.log(a, typeof b, JSON.stringify(ns.default));
        `,
        "reexport.js": `
          export * from "./data.json" with { type: "json" };
          export { default as b } from "./data.json" with { type: "text" };
          export * as ns from "./data.json" with { type: "json" };
        `,
        "data.json": `{"a":1}`,
      }),
    ).toEqual({ stdout: '1 string {"a":1}\n', stderr: "", exitCode: 0 });
  });

  // Without the attribute, an unknown extension gets the "file" loader.
  test("a sqlite re-export exposes both the default and db names", async () => {
    const db = new Database(":memory:");
    db.exec("create table messages (message text)");
    db.exec("insert into messages values ('Hello, world!')");
    expect(
      await run({
        "entry.js": `
          import { db, sameDb } from "./reexport.js";
          console.log(db.query("select message from messages").get().message, db === sameDb);
        `,
        "reexport.js": `export { default as db, db as sameDb } from "./app.unknownext" with { type: "sqlite" };`,
        "app.unknownext": db.serialize(),
      }),
    ).toEqual({ stdout: "Hello, world! true\n", stderr: "", exitCode: 0 });
  });

  // `bun test --isolate` builds the module record from the transpiler's
  // ModuleInfo instead of letting JSC re-parse the printed source.
  test("re-exports carry the clause under bun test --isolate", async () => {
    using dir = tempDir("import-attributes-isolate", {
      "text.unknownext": "hello from data",
      "json.unknownext": `{ "answer": 42 }`,
      "reexport.ts": `
        export { default as text } from "./text.unknownext" with { type: "text" };
        export * as ns from "./text.unknownext" with { type: "text" };
        export * from "./json.unknownext" with { type: "json" };
      `,
      "reexport.test.ts": `
        import { expect, test } from "bun:test";
        import { answer, ns, text } from "./reexport.ts";
        test("re-exports honor the type attribute", () => {
          expect([text, ns.default, answer]).toEqual(["hello from data", "hello from data", 42]);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "reexport.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });

  test("a newline before `with` is allowed and `assert` still works", async () => {
    expect(
      await run({
        "entry.js": `import a from "./data.json"\nwith { type: "text" };\nimport b from "./data.json" assert { type: "json" };\nconsole.log(typeof a, typeof b);\n`,
        "data.json": `{"a":1}`,
      }),
    ).toEqual({ stdout: "string object\n", stderr: "", exitCode: 0 });
  });

  test("keys other than type are accepted", async () => {
    expect(
      await run({
        "entry.js": `
          import a from "./data.json" with { type: "json", custom: "thing", "quoted-key": "v" };
          console.log(JSON.stringify(a));
        `,
        "data.json": `{"a":1}`,
      }),
    ).toEqual({ stdout: '{"a":1}\n', stderr: "", exitCode: 0 });
  });

  test("a duplicate key is a syntax error", async () => {
    const { stdout, stderr, exitCode } = await run({
      "entry.js": `import a from "./data.json" with { type: "json", type: "json" };\nconsole.log(a);\n`,
      "data.json": `{"a":1}`,
    });
    expect(stdout).toBe("");
    expect(stderr).toContain('Duplicate import attribute "type"');
    expect(exitCode).toBe(1);
  });

  test("an unknown type is an error", async () => {
    const { stdout, stderr, exitCode } = await run({
      "entry.js": `import a from "./data.json" with { type: "nope" };\nconsole.log(a);\n`,
      "data.json": `{"a":1}`,
    });
    expect(stdout).toBe("");
    expect(stderr).toContain('Importing with a type attribute of "nope" is not supported');
    expect(stderr).toContain("ERR_IMPORT_ATTRIBUTE_UNSUPPORTED");
    expect(exitCode).toBe(1);
  });

  test("an unknown type rejects import() and require() with ERR_IMPORT_ATTRIBUTE_UNSUPPORTED", async () => {
    expect(
      await run({
        "entry.js": `
          import { createRequire } from "node:module";
          const require = createRequire(import.meta.url);
          for (const load of [
            () => import("./data.json", { with: { type: "nope" } }),
            () => require("./data.json", { type: "nope" }),
          ]) {
            try {
              await load();
              console.log("loaded");
            } catch (err) {
              console.log(err.constructor.name, err.code);
            }
          }
        `,
        "data.json": `{"a":1}`,
      }),
    ).toEqual({
      stdout: "TypeError ERR_IMPORT_ATTRIBUTE_UNSUPPORTED\nTypeError ERR_IMPORT_ATTRIBUTE_UNSUPPORTED\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("type: bytes gives the file's bytes as a Uint8Array", async () => {
    expect(
      await run({
        "entry.js": `
          import data from "./data.bin" with { type: "bytes" };
          import empty from "./empty.bin" with { type: "bytes" };
          const dyn = await import("./data.bin", { with: { type: "bytes" } });
          console.log(
            data instanceof Uint8Array,
            data.constructor === Uint8Array,
            Array.from(data).join(","),
            empty.length,
            dyn.default === data,
            Array.from(dyn.default).join(","),
          );
        `,
        "data.bin": Buffer.from([1, 2, 3, 4, 5]),
        "empty.bin": Buffer.alloc(0),
      }),
    ).toEqual({ stdout: "true true 1,2,3,4,5 0 true 1,2,3,4,5\n", stderr: "", exitCode: 0 });
  });
});
