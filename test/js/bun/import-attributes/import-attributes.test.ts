import { bunExe, tempDirWithFiles } from "harness";
import * as path from "path";

// .napi is skipped (hard to make an example)
// .sh is skipped (only works from `bun somefile.sh`)
// .html, .css is skipped
const loaders = ["js", "jsx", "ts", "tsx", "json", "toml"];

const other_loaders_do_not_crash = ["webassembly", "does_not_exist"];

// ctrl+shift+f for tailwind
// next bug: ZigGlobalObject.cpp:4226
// - in the case of `with {type: "json"}`, `params.type()` is `ScriptFetchParameters::Type::JSON` so
//   the type attribute string is not set.

async function testBunRun(dir: string, loader: string): Promise<unknown> {
  const cmd = [
    bunExe(),
    "-e",
    `import * as contents from './_the_file' with {type: '${loader}'}; console.log(JSON.stringify(contents));`,
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
async function testBunRunAwaitImport(dir: string, loader: string): Promise<unknown> {
  const cmd = [
    bunExe(),
    "-e",
    `console.log(JSON.stringify(await import('./_the_file', {with: {type: '${loader}'}})));`,
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
async function testBunBuild(dir: string, loader: string): Promise<unknown> {
  await Bun.write(
    path.join(dir, "main_" + loader + ".js"),
    `import * as contents from '${dir}/_the_file' with {type: '${loader}'}; console.log(JSON.stringify(contents));`,
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
async function compileAndTest(code: string): Promise<Record<string, unknown>> {
  console.time("import {} from '';");
  const v1 = await compileAndTest_inner(code, "", testBunRun);
  console.timeEnd("import {} from '';");
  console.time("await import()");
  const v2 = await compileAndTest_inner(code, "", testBunRunAwaitImport);
  console.timeEnd("await import()");
  console.time("Bun.build()");
  const v3 = await compileAndTest_inner(code, "", testBunBuild);
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
  ext: string,
  cb: (dir: string, loader: string, ext: string) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const dir = tempDirWithFiles("import-attributes", {
    ["_the_file" + ext]: code,
  });

  let res: Record<string, unknown> = {};
  for (const loader of loaders) {
    res[loader] = await cb(dir, loader, ext);
  }
  expect(await cb(dir, "text", ext)).toEqual({ default: code });
  const sqlite_res = await cb(dir, "sqlite", ext);
  delete (sqlite_res as any).__esModule;
  expect(sqlite_res).toStrictEqual({
    db: { filename: path.join(dir, "_the_file" + ext) },
    default: { filename: path.join(dir, "_the_file" + ext) },
  });
  if (cb === testBunBuild) {
    expect(await cb(dir, "file", ext)).toEqual({
      default: expect.any(String),
    });
  } else {
    const file_res = await cb(dir, "file", ext);
    delete (file_res as any).__esModule;
    expect(file_res).toEqual({
      default: path.join(dir, "_the_file" + ext),
    });
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
  "json,toml": "error",
}
`);
});

test("typescript", async () => {
  expect(await compileAndTest(`export const a = (<T>() => {}).toString().replace(/\\n/g, '');`)).toMatchInlineSnapshot(`
{
  "js,jsx,tsx,json,toml": "error",
  "ts": {
    "a": "() => {}",
  },
}
`);
});

test("json", async () => {
  expect(await compileAndTest(`{"key": "value"}`)).toMatchInlineSnapshot(`
{
  "js,jsx,ts,tsx,toml": "error",
  "json": {
    "default": {
      "key": "value",
    },
    "key": "value",
  },
}
`);
});
test("jsonc", async () => {
  expect(
    await compileAndTest(`{
      "key": "value", // my json
    }`),
  ).toMatchInlineSnapshot(`
{
  "js,jsx,ts,tsx,toml": "error",
  "json": {
    "default": {
      "key": "value"
    },
    "key": "value"
  }
}
`);
});
test("toml", async () => {
  expect(
    await compileAndTest(`[section]
    key = "value"`),
  ).toMatchInlineSnapshot(`
{
  "js,jsx,ts,tsx,json": "error",
  "toml": {
    "default": {
      "section": {
        "key": "value",
      },
    },
    "section": {
      "key": "value",
    },
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
