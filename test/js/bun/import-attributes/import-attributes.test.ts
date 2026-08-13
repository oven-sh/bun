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

describe("unsupported import attributes (#28510)", () => {
  test.concurrent("dynamic import with unsupported attribute throws ERR_IMPORT_ATTRIBUTE_UNSUPPORTED", async () => {
    using dir = tempDir("28510", {
      "data.json": JSON.stringify({ life: 42 }),
      "test.mjs": `
        const result = await import('./data.json', { with: { type: 'json', notARealAssertion: 'value' } })
          .then(() => 'should not reach')
          .catch(err => ({ code: err.code, name: err.name }));
        console.log(JSON.stringify(result));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim());
    expect(result).toEqual({
      code: "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED",
      name: "TypeError",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "dynamic import with only unsupported attribute (no type) throws ERR_IMPORT_ATTRIBUTE_UNSUPPORTED",
    async () => {
      using dir = tempDir("28510-no-type", {
        "data.json": JSON.stringify({ life: 42 }),
        "test.mjs": `
        const result = await import('./data.json', { with: { notARealAssertion: 'value' } })
          .then(() => 'should not reach')
          .catch(err => ({ code: err.code, name: err.name }));
        console.log(JSON.stringify(result));
      `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const result = JSON.parse(stdout.trim());
      expect(result).toEqual({
        code: "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED",
        name: "TypeError",
      });
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("dynamic import with only type attribute succeeds", async () => {
    using dir = tempDir("28510-valid", {
      "data.json": JSON.stringify({ life: 42 }),
      "test.mjs": `
        const ns = await import('./data.json', { with: { type: 'json' } });
        console.log(JSON.stringify(ns.default));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(JSON.parse(stdout.trim())).toEqual({ life: 42 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("static import with unsupported attribute fails", async () => {
    using dir = tempDir("28510-static", {
      "data.json": JSON.stringify({ life: 42 }),
      "test.mjs": `import data from './data.json' with { type: 'json', notARealAssertion: 'value' };`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain('Import attribute "notARealAssertion" with value "value" is not supported');
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("error message includes attribute key and value", async () => {
    using dir = tempDir("28510-msg", {
      "data.json": JSON.stringify({ x: 1 }),
      "test.mjs": `
        const result = await import('./data.json', { with: { type: 'json', myAttr: 'myVal' } })
          .catch(err => err.message);
        console.log(result);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe('Import attribute "myAttr" with value "myVal" is not supported');
    expect(exitCode).toBe(0);
  });

  test.concurrent("TypeScript type-only imports and exports allow arbitrary attributes (resolution-mode)", async () => {
    using dir = tempDir("28510-type-only", {
      "test.ts": `
        import type { Foo } from "some-pkg" with { "resolution-mode": "require" };
        import type * as Bar from "some-pkg" with { "resolution-mode": "import" };
        import type Baz from "some-pkg" with { "resolution-mode": "require" };
        export { type Qux } from "some-pkg" with { "resolution-mode": "require" };
        export type { Quux } from "some-pkg" with { "resolution-mode": "require" };
        export type * from "some-pkg" with { "resolution-mode": "import" };
        console.log("ok");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "ambient `declare module` allows arbitrary import attribute keys (entire block is erased)",
    async () => {
      using dir = tempDir("28510-declare-module", {
        "test.ts": `
        declare module "some-pkg" {
          import X from "pkg-a" with { "resolution-mode": "require" };
          export * from "pkg-b" with { arbitrary: "val" };
          export * as ns from "pkg-c" with { another: "val" };
          export { Foo } from "pkg-d" with { resolutionMode: "import" };
          import defer * as D from "pkg-e" with { someKey: "v" };
        }
        console.log("ok");
      `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("dynamic import rejection fires unhandledRejection", async () => {
    using dir = tempDir("28510-unhandled", {
      "data.json": JSON.stringify({ x: 1 }),
      "test.mjs": `
        process.on('unhandledRejection', (err) => {
          console.log('UNHANDLED:' + err.code);
          process.exit(0);
        });
        setTimeout(() => { console.log('NONE'); process.exit(1); }, 1000);
        import('./data.json', { with: { bad: 'val' } });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("UNHANDLED:ERR_IMPORT_ATTRIBUTE_UNSUPPORTED");
    expect(exitCode).toBe(0);
  });
});
