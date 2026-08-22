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

// Whichever way a file reaches the text loader (.txt extension, type: "text",
// ?raw, require), a file that is not valid UTF-8 must decode the way
// `Bun.file().text()`, `fs.readFileSync(path, "utf8")` and `TextDecoder` decode
// it: one U+FFFD per ill-formed subsequence, keeping the well-formed bytes
// around it.
// https://github.com/oven-sh/bun/issues/12981
describe("text loader with ill-formed UTF-8", () => {
  const R = 0xfffd;
  const cases: [name: string, bytes: number[], codePoints: number[]][] = [
    ["bad lead byte keeps the bytes after it", [0xe2, 0x41, 0x42], [R, 0x41, 0x42]],
    ["invalid lead bytes", [0xf5, 0x41, 0xff, 0x42], [R, 0x41, R, 0x42]],
    ["lone continuation byte", [0x80, 0x41], [R, 0x41]],
    ["overlong 2-byte sequence", [0xc0, 0xaf, 0x41], [R, R, 0x41]],
    ["overlong 3-byte sequence", [0xe0, 0x80, 0x80, 0x41], [R, R, R, 0x41]],
    ["overlong 4-byte sequence", [0xf0, 0x80, 0x80, 0x80, 0x41], [R, R, R, R, 0x41]],
    ["UTF-8 encoded surrogate", [0xed, 0xa0, 0x80, 0x41], [R, R, R, 0x41]],
    ["code point above U+10FFFF", [0xf4, 0x90, 0x80, 0x80, 0x41], [R, R, R, R, 0x41]],
    ["truncated 3-byte sequence", [0xe2, 0x82, 0x41], [R, 0x41]],
    ["truncated 4-byte sequence, 2 bytes", [0xf0, 0x9f, 0x41], [R, 0x41]],
    ["truncated 4-byte sequence, 3 bytes", [0xf0, 0x9f, 0x98, 0x41], [R, 0x41]],
    ["lead byte at end of file", [0x41, 0xe2], [0x41, R]],
    ["truncated sequence at end of file", [0x41, 0xe2, 0x82], [0x41, R]],
    ["well-formed U+FFFD is left alone", [0xef, 0xbf, 0xbd, 0x41], [R, 0x41]],
    [
      "well-formed text is byte-exact",
      [0x41, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0x00, 0x0d, 0x0a, 0x42],
      [0x41, 0xe9, 0x20ac, 0x1f600, 0x00, 0x0d, 0x0a, 0x42],
    ],
  ];
  const codePointsOf = (text: string) => [...text].map(c => c.codePointAt(0));

  const expected = Object.fromEntries(cases.map(([name, , codePoints]) => [name, codePoints]));

  test("the expected code points are what TextDecoder produces", () => {
    expect(
      Object.fromEntries(
        cases.map(([name, bytes]) => [name, codePointsOf(new TextDecoder().decode(Uint8Array.from(bytes)))]),
      ),
    ).toEqual(expected);
  });

  test("import, require, ?raw and type: 'text' decode like TextDecoder", async () => {
    const [, badLeadByte, badLeadByteDecoded] = cases[0];
    const files: Record<string, string | Buffer> = {
      "raw.js": Buffer.from(badLeadByte),
      "attr.bin": Buffer.from(badLeadByte),
    };
    cases.forEach(([, bytes], i) => (files[`case${i}.txt`] = Buffer.from(bytes)));
    files["entry.ts"] = `
      ${cases.map((_, i) => `import case${i} from "./case${i}.txt";`).join("\n")}
      import raw from "./raw.js?raw";
      import attr from "./attr.bin" with { type: "text" };
      const required = require("./case0.txt").default;
      const codePointsOf = (text: string) => [...text].map(c => c.codePointAt(0));
      console.log(JSON.stringify({
        ${cases.map(([name], i) => `${JSON.stringify(name)}: codePointsOf(case${i}),`).join("\n")}
        "?raw": codePointsOf(raw),
        "type: text": codePointsOf(attr),
        "require": codePointsOf(required),
      }));
    `;
    using dir = tempDir("import-attributes-ill-formed-utf8", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ...expected,
      "?raw": badLeadByteDecoded,
      "type: text": badLeadByteDecoded,
      "require": badLeadByteDecoded,
    });
    expect(exitCode).toBe(0);
  });
});
