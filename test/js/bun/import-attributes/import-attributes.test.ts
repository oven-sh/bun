import { bunExe, tempDirWithFiles } from "harness";
import * as path from "path";

const loaders = ["js", "jsx", "ts", "tsx", "json", "jsonc", "toml", "text", "sqlite", "file"];
const other_loaders_do_not_crash = ["webassembly", "does_not_exist"];

async function testBunRun(dir: string, loader: string | null, filename: string): Promise<unknown> {
  const cmd = [
    bunExe(),
    "-e",
    `import * as contents from './${filename}'${loader != null ? ` with {type: '${loader}'}` : ""}; console.log(JSON.stringify(contents));`,
  ];
  const result = Bun.spawnSync({
    cmd: cmd,
    cwd: dir,
  });
  if (result.exitCode !== 0) {
    if (result.stderr.toString().includes("panic")) {
      console.error("cmd stderr");
      console.log(result.stderr.toString());
      console.error("cmd stdout");
      console.log(result.stdout.toString());
      console.error("cmd args");
      console.log(JSON.stringify(cmd));
      console.error("cmd cwd");
      console.log(dir);
      throw new Error("panic");
    }
    return "error";
    // return result.stderr.toString().match(/error: .+/)?.[0];
  } else {
    return JSON.parse(result.stdout.toString());
  }
}
async function testBunRunAwaitImport(dir: string, loader: string | null, filename: string): Promise<unknown> {
  const cmd = [
    bunExe(),
    "-e",
    `console.log(JSON.stringify(await import('./${filename}'${loader != null ? `, {with: {type: '${loader}'}}` : ""})));`,
  ];
  const result = Bun.spawnSync({
    cmd: cmd,
    cwd: dir,
  });
  console.timeEnd("testBunRunAwaitImport: " + dir + " " + loader);
  if (result.exitCode !== 0) {
    if (result.stderr.toString().includes("panic")) {
      console.error("cmd stderr");
      console.log(result.stderr.toString());
      console.error("cmd stdout");
      console.log(result.stdout.toString());
      console.error("cmd args");
      console.log(JSON.stringify(cmd));
      console.error("cmd cwd");
      console.log(dir);
      throw new Error("panic");
    }
    return "error";
    // return result.stderr.toString().match(/error: .+/)?.[0];
  } else {
    return JSON.parse(result.stdout.toString());
  }
}
async function testBunBuild(dir: string, loader: string | null, filename: string): Promise<unknown> {
  await Bun.write(
    path.join(dir, "main_" + loader + ".js"),
    `import * as contents from '${dir}/${filename}'${loader != null ? ` with {type: '${loader}'}` : ""}; console.log(JSON.stringify(contents));`,
  );
  const result = await Bun.build({
    entrypoints: [path.join(dir, "main_" + loader + ".js")],
    throw: false,
    target: "bun",
    outdir: path.join(dir, "out"),
  });
  if (result.success) {
    const cmd = [bunExe(), "out/main_" + loader + ".js"];
    const result = Bun.spawnSync({
      cmd: cmd,
      cwd: dir,
    });
    if (result.exitCode !== 0) {
      if (result.stderr.toString().includes("panic")) {
        console.error("cmd stderr");
        console.log(result.stderr.toString());
        console.error("cmd stdout");
        console.log(result.stdout.toString());
        console.error("cmd args");
        console.log(JSON.stringify(cmd));
        console.error("cmd cwd");
        console.log(dir);
        throw new Error("panic");
      }
      // return result.stderr.toString().match(/error: .+/)?.[0];
      return "error";
    } else {
      return JSON.parse(result.stdout.toString());
    }
  } else {
    return "error";
    // return result.logs;
  }
}
type Tests = Record<
  string,
  {
    loader: string | null;
    filename: string;
    dir?: string;
  }
>;
const default_tests = Object.fromEntries(
  loaders.map(loader => [loader, { loader, filename: "no_extension" }]),
) as Tests;
async function compileAndTest(code: string, tests: Tests = default_tests): Promise<Record<string, unknown>> {
  console.time("import {} from '';");
  const v1 = await compileAndTest_inner(code, tests, testBunRun);
  console.timeEnd("import {} from '';");
  console.time("await import()");
  const v2 = await compileAndTest_inner(code, tests, testBunRunAwaitImport);
  console.timeEnd("await import()");
  console.time("Bun.build()");
  const v3 = await compileAndTest_inner(code, tests, testBunBuild);
  console.timeEnd("Bun.build()");
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
  let res: Record<string, unknown> = {};
  for (const [label, test] of Object.entries(tests)) {
    test.dir = tempDirWithFiles("import-attributes", {
      [test.filename]: code,
    });
    res[label] = await cb(test.dir!, test.loader, test.filename);
  }
  if (Object.hasOwn(res, "text")) {
    expect(res.text).toEqual({ default: code });
    delete res.text;
  }
  if (Object.hasOwn(res, "sqlite")) {
    const sqlite_res = res.sqlite;
    delete (sqlite_res as any).__esModule;
    expect(sqlite_res).toStrictEqual({
      db: { filename: path.join(tests.sqlite!.dir!, tests.sqlite!.filename) },
      default: { filename: path.join(tests.sqlite!.dir!, tests.sqlite!.filename) },
    });
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
        default: path.join(tests.file!.dir!, tests.file!.filename),
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
}
`);
});

test("json", async () => {
  expect(await compileAndTest(`{"key": "👩‍👧‍👧value"}`)).toMatchInlineSnapshot(`
{
  "js,jsx,ts,tsx,toml": "error",
  "json,jsonc": {
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
}
`);
});
test("toml", async () => {
  expect(
    await compileAndTest(`[section]
    key = "👩‍👧‍👧value"`),
  ).toMatchInlineSnapshot(`
{
  "js,jsx,ts,tsx,json,jsonc": "error",
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
