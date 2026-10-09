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

describe("?url", () => {
  for (const [name, fn] of [
    ["bun run", testBunRun],
    ["bun run await import", testBunRunAwaitImport],
    ["require", testBunRunRequire],
  ] as const) {
    test.concurrent.each(["abcd.js", "abcd.ts", "abcd.json", "abcd.txt", "abcd.css", "abcd.module.css", "abcd.html"])(
      `${name} %s`,
      async filename => {
        await using dir = tempDir("import-attributes", { [filename]: "{}" });
        const url = path.join(String(dir), filename);
        // As for an asset: require() gives the path itself.
        expect(await fn(dir, null, filename + "?url")).toEqual(
          fn === testBunRunRequire ? url : { __esModule: true, default: url },
        );
      },
    );
  }
});

describe.concurrent("suffixes of an import path", () => {
  /** Runs `main.ts`, which prints one JSON value. */
  async function runMain(files: Record<string, string | Buffer>, args: string[] = ["main.ts"]) {
    using dir = tempDir("import-suffixes", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const printed = stdout.split("\n").find(line => line.startsWith("@"));
    return {
      printed:
        printed &&
        JSON.parse(printed.slice(1).replaceAll(JSON.stringify(String(dir) + path.sep).slice(1, -1), "<dir>/")),
      stderr: printed ? "" : stderr,
      exitCode,
    };
  }

  const describeDefaults = `
    const results = {};
    for (const specifier of specifiers) {
      const { default: value } = await import(specifier);
      results[specifier] = typeof value === "function" ? "function " + value.name : value;
    }
    console.log("@" + JSON.stringify(results));
  `;

  test("which one wins, and what is not one", async () => {
    const code = `globalThis.evaluated = (globalThis.evaluated ?? 0) + 1;\nexport default "evaluated";\n`;
    const expected = {
      "./code.ts": "evaluated",
      "./code.ts?raw": code,
      "./code.ts?url": "<dir>/code.ts",
      "./code.ts?worker": "function WorkerWrapper",
      "./code.ts?sharedworker": "function WorkerWrapper",
      "./code.ts?worker&url": "<dir>/code.ts",
      "./code.ts?url&worker": "<dir>/code.ts",
      "./code.ts?sharedworker&url": "<dir>/code.ts",
      "./code.ts?worker&inline": "function WorkerWrapper",
      "./code.ts?worker&raw": "function WorkerWrapper",
      "./code.ts?raw&worker": "function WorkerWrapper",
      "./code.ts?raw&url": code,
      "./code.ts?url&raw": code,
      "./code.ts?raw&other": code,
      "./code.ts?other=1&raw": code,
      "./code.ts?url&other": "<dir>/code.ts",
      "./code.ts?&raw": code,
      "./code.ts?raw&": code,
      "./code.ts?url&no-inline": "<dir>/code.ts",
      "./code.ts?raw=1": "evaluated",
      "./code.ts?raw=": "evaluated",
      "./code.ts?url=1": "evaluated",
      "./code.ts?worker=1": "evaluated",
      "./code.ts?rawx": "evaluated",
      "./code.ts?xraw": "evaluated",
      "./code.ts?a=raw": "evaluated",
      "./code.ts?RAW": "evaluated",
      "./code.ts?URL": "evaluated",
      "./code.ts?Worker": "evaluated",
      "./code.ts?inline": "evaluated",
      "./code.ts?no-inline": "evaluated",
      "./code.ts?init": "evaluated",
      "./code.ts?": "evaluated",
    };
    const evaluated = Object.values(expected).filter(value => value === "evaluated").length;
    expect(
      await runMain({
        "code.ts": code,
        "main.ts": `
          const specifiers = ${JSON.stringify(Object.keys(expected))};
          ${describeDefaults.replace("JSON.stringify(results)", "JSON.stringify({ ...results, evaluated })")}
        `,
      }),
    ).toEqual({ printed: { ...expected, evaluated }, stderr: "", exitCode: 0 });
  });

  test("other kinds of files", async () => {
    const expected = {
      "./style.css?raw": ".a { color: red }\n",
      "./style.css?inline": ".a { color: red }\n",
      "./style.css?url": "<dir>/style.css",
      "./style.css?no-inline": {},
      "./style.module.css?inline": ".a { color: red }\n",
      "./style.module.css?url": "<dir>/style.module.css",
      "./data.json?raw": `{ "key": 1 }\n`,
      "./data.json?url": "<dir>/data.json",
      "./data.json?inline": { key: 1 },
      "./data.json?worker": "function WorkerWrapper",
      "./icon.svg": "<dir>/icon.svg",
      "./icon.svg?url": "<dir>/icon.svg",
      "./icon.svg?inline": "<dir>/icon.svg",
      "./icon.svg?no-inline": "<dir>/icon.svg",
      "./icon.svg?raw": "<svg></svg>\n",
      "./note.txt": "note\n",
      "./note.txt?raw": "note\n",
      "./note.txt?url": "<dir>/note.txt",
      "./note.txt?inline": "note\n",
      "./page.html?url": "<dir>/page.html",
      "./page.html?raw": "<p></p>\n",
      "./add.wasm": "<dir>/add.wasm",
      "./add.wasm?url": "<dir>/add.wasm",
      "./add.wasm?init": "function init",
      "./add.wasm?init&url": "<dir>/add.wasm",
    };
    expect(
      await runMain({
        "style.css": ".a { color: red }\n",
        "style.module.css": ".a { color: red }\n",
        "data.json": `{ "key": 1 }\n`,
        "icon.svg": "<svg></svg>\n",
        "note.txt": "note\n",
        "page.html": "<p></p>\n",
        "add.wasm": Buffer.alloc(0),
        "main.ts": `const specifiers = ${JSON.stringify(Object.keys(expected))}; ${describeDefaults}`,
      }),
    ).toEqual({ printed: expected, stderr: "", exitCode: 0 });
  });

  const echoWorker = `
    globalThis.startedHere = true;
    self.onmessage = event => postMessage({ echo: event.data, isMainThread: Bun.isMainThread });
  `;
  const talkToWorker = `
    const { promise, resolve, reject } = Promise.withResolvers();
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => reject(new Error(event.message));
    worker.postMessage("ping");
    const reply = await promise;
    worker.terminate();
  `;

  test.each([
    ["import", `import EchoWorker from "./echo.ts?worker";`],
    ["import()", `const { default: EchoWorker } = await import("./echo.ts?worker");`],
    ["require()", `const { default: EchoWorker } = require("./echo.ts?worker");`],
    ["?worker&inline", `import EchoWorker from "./echo.ts?worker&inline";`],
  ])("?worker starts the file as a Worker: %s", async (_, statement) => {
    expect(
      await runMain({
        "echo.ts": echoWorker,
        "main.ts": `
          ${statement}
          const worker = new EchoWorker({ name: "echo" });
          ${talkToWorker}
          console.log("@" + JSON.stringify({ reply, isWorker: worker instanceof Worker, length: EchoWorker.length, startedHere: globalThis.startedHere }));
        `,
      }),
    ).toEqual({
      printed: { reply: { echo: "ping", isMainThread: false }, isWorker: true, length: 1 },
      stderr: "",
      exitCode: 0,
    });
  });

  // On Windows these are paths with a drive letter and backslashes.
  test("the path of ?url is the native one, which fs, pathToFileURL and Worker take", async () => {
    expect(
      await runMain({
        "nested/echo.ts": echoWorker,
        "main.ts": `
          import { existsSync } from "node:fs";
          import path from "node:path";
          import { fileURLToPath, pathToFileURL } from "node:url";
          import url from "./nested/echo.ts?url";
          import workerURL from "./nested/echo.ts?worker&url";
          const replies = [];
          for (const entry of [url, pathToFileURL(url).href, pathToFileURL(url)]) {
            const worker = new Worker(entry);
            ${talkToWorker}
            replies.push(reply.echo);
          }
          console.log("@" + JSON.stringify({
            isNative: url === path.join(import.meta.dir, "nested", "echo.ts"),
            isAbsolute: path.isAbsolute(url),
            exists: existsSync(url),
            isSameAsWorkerURL: url === workerURL,
            isFileURLOfTheModule: pathToFileURL(url).href === new URL("./nested/echo.ts", import.meta.url).href,
            isResolved: fileURLToPath(import.meta.resolve("./nested/echo.ts")) === url,
            replies,
          }));
        `,
      }),
    ).toEqual({
      printed: {
        isNative: true,
        isAbsolute: true,
        exists: true,
        isSameAsWorkerURL: true,
        isFileURLOfTheModule: true,
        isResolved: true,
        replies: ["ping", "ping", "ping"],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("a suffix on an absolute native path, a relative native path and a path with forward slashes", async () => {
    expect(
      await runMain({
        "nested/echo.ts": echoWorker,
        "main.ts": `
          import path from "node:path";
          const file = path.join(import.meta.dir, "nested", "echo.ts");
          const spellings = {
            native: file,
            forwardSlashes: file.replaceAll(path.sep, "/"),
            relativeNative: "." + path.sep + path.join("nested", "echo.ts"),
          };
          const results = {};
          for (const [name, spelling] of Object.entries(spellings)) {
            const { default: EchoWorker } = await import(spelling + "?worker");
            const worker = new EchoWorker();
            ${talkToWorker}
            results[name] = [
              reply.echo,
              (await import(spelling + "?url")).default === file,
              (await import(spelling + "?worker&url")).default === file,
              (await import(spelling + "?raw")).default.includes("startedHere"),
            ];
          }
          console.log("@" + JSON.stringify(results));
        `,
      }),
    ).toEqual({
      printed: {
        native: ["ping", true, true, true],
        forwardSlashes: ["ping", true, true, true],
        relativeNative: ["ping", true, true, true],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("?worker without new, without options, in a directory with a name that needs escaping", async () => {
    expect(
      await runMain({
        "it's a ünï code dir/echo.ts": echoWorker,
        "main.ts": `
          import EchoWorker from "./it's a ünï code dir/echo.ts?worker";
          const worker = EchoWorker();
          ${talkToWorker}
          console.log("@" + JSON.stringify(reply));
        `,
      }),
    ).toEqual({ printed: { echo: "ping", isMainThread: false }, stderr: "", exitCode: 0 });
  });

  test("?worker and ?sharedworker construct what the global is when they are called, as Vite's wrapper does", async () => {
    expect(
      await runMain({
        "echo.ts": echoWorker,
        "main.ts": `
          import EchoWorker from "./echo.ts?worker";
          import EchoSharedWorker from "./echo.ts?sharedworker";
          let missing;
          try {
            new EchoSharedWorker();
          } catch (error) {
            missing = error.name + ": " + error.message;
          }
          class Recorder {
            constructor(...args) {
              this.args = args;
            }
          }
          globalThis.Worker = class FakeWorker extends Recorder {};
          globalThis.SharedWorker = class FakeSharedWorker extends Recorder {};
          const made = [new EchoWorker(), new EchoWorker({ name: "n", type: "classic", smol: true }), new EchoSharedWorker({ name: "s" })];
          console.log("@" + JSON.stringify({ missing, made: made.map(worker => [worker.constructor.name, ...worker.args]) }));
        `,
      }),
    ).toEqual({
      printed: {
        missing: "ReferenceError: SharedWorker is not defined",
        made: [
          ["FakeWorker", "<dir>/echo.ts", { type: "module" }],
          ["FakeWorker", "<dir>/echo.ts", { type: "module", name: "n" }],
          ["FakeSharedWorker", "<dir>/echo.ts", { type: "module", name: "s" }],
        ],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test.each(["echo.cjs", "echo.cts", "echo.mjs", "echo.js", "echo.jsx", "echo.tsx"])(
    "?worker of %s in a CommonJS package",
    async filename => {
      expect(
        await runMain(
          {
            "package.json": JSON.stringify({ type: "commonjs" }),
            [filename]: echoWorker,
            "main.mjs": `
            import EchoWorker from "./${filename}?worker";
            const worker = new EchoWorker();
            ${talkToWorker}
            console.log("@" + JSON.stringify(reply.echo));
          `,
          },
          ["main.mjs"],
        ),
      ).toEqual({ printed: "ping", stderr: "", exitCode: 0 });
    },
  );

  test("?init instantiates a WebAssembly module", async () => {
    // (module (import "env" "base" (global i32)) (func (export "add") (param i32) (result i32) global.get 0 local.get 0 i32.add))
    const wasm = Buffer.from(
      "0061736d0100000001060160017f017f020d0103656e760462617365037f00030201000707010361646400000a09010700230020006a0b",
      "hex",
    );
    expect(
      await runMain({
        "add.wasm": wasm,
        "main.ts": `
          import init from "./add.wasm?init";
          const instance = await init({ env: { base: 40 } });
          let withoutImports;
          try {
            await init();
          } catch (error) {
            withoutImports = error.name;
          }
          console.log("@" + JSON.stringify([instance instanceof WebAssembly.Instance, instance.exports.add(2), withoutImports]));
        `,
      }),
    ).toEqual({ printed: [true, 42, "TypeError"], stderr: "", exitCode: 0 });
  });

  test("an import attribute decides over the suffix", async () => {
    expect(
      await runMain({
        "data.json": `{ "key": 1 }\n`,
        "main.ts": `
          import asURL from "./data.json?url";
          import asText from "./data.json?url&1" with { type: "text" };
          import asJSON from "./data.json?raw" with { type: "json" };
          import asFile from "./data.json?raw&1" with { type: "file" };
          import workerAsText from "./data.json?worker" with { type: "text" };
          import unknownAttribute from "./data.json?url&2" with { type: "no such loader" };
          console.log("@" + JSON.stringify([asURL, asText, asJSON, asFile, workerAsText, unknownAttribute]));
        `,
      }),
    ).toEqual({
      printed: [
        "<dir>/data.json",
        `{ "key": 1 }\n`,
        { key: 1 },
        "<dir>/data.json",
        `{ "key": 1 }\n`,
        "<dir>/data.json",
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  test("in the query of import.meta.glob", async () => {
    expect(
      await runMain({
        "workers/a.ts": echoWorker,
        "workers/b.ts": echoWorker,
        "style.css": ".a { color: red }\n",
        "main.ts": `
          const workers = import.meta.glob("./workers/*.ts", { query: "?worker", import: "default", eager: true });
          const urls = import.meta.glob("./workers/*.ts", { query: "?worker&url", import: "default" });
          const styles = import.meta.glob("./*.css", { query: "?inline", import: "default", eager: true });
          console.log("@" + JSON.stringify([
            Object.entries(workers).map(([key, value]) => [key, value.name]),
            await Promise.all(Object.values(urls).map(load => load())),
            styles,
          ]));
        `,
      }),
    ).toEqual({
      printed: [
        [
          ["./workers/a.ts", "WorkerWrapper"],
          ["./workers/b.ts", "WorkerWrapper"],
        ],
        [`<dir>/workers${path.sep}a.ts`, `<dir>/workers${path.sep}b.ts`],
        { "./style.css": ".a { color: red }\n" },
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  test("a plugin sees the path with its suffix first", async () => {
    expect(
      await runMain({
        "echo.ts": echoWorker,
        "main.ts": `
          const seen = [];
          Bun.plugin({
            name: "suffixes",
            setup(build) {
              build.onResolve({ filter: /echo/ }, ({ path }) => void seen.push("onResolve " + path));
              build.onLoad({ filter: /echo\\.ts\\?(url|sharedworker)$/ }, ({ path }) => void seen.push("onLoad " + path));
              build.onLoad({ filter: /\\?worker$/ }, ({ path }) => {
                seen.push("onLoad " + path);
                return { contents: "export default 'from the plugin'", loader: "js" };
              });
            },
          });
          const results = [];
          for (const suffix of ["worker", "url", "sharedworker"]) results.push(typeof (await import("./echo.ts?" + suffix)).default);
          results.push((await import("./echo.ts?worker")).default);
          console.log("@" + JSON.stringify({ seen, results }));
        `,
      }),
    ).toEqual({
      printed: {
        seen: [
          "onResolve ./echo.ts?worker",
          "onLoad <dir>/echo.ts?worker",
          "onResolve ./echo.ts?url",
          "onLoad <dir>/echo.ts?url",
          "onResolve ./echo.ts?sharedworker",
          "onLoad <dir>/echo.ts?sharedworker",
          "onResolve ./echo.ts?worker",
        ],
        results: ["string", "string", "function", "from the plugin"],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun test: vi.mock() and vi.stubGlobal() reach a ?worker import", async () => {
    expect(
      await runMain(
        {
          "echo.ts": echoWorker,
          "other.ts": echoWorker,
          "workers.test.ts": `
            import { expect, test, vi } from "bun:test";
            import EchoWorker from "./echo.ts?worker";
            import OtherWorker from "./other.ts?worker";
            vi.mock("./other.ts?worker", () => ({ default: class MockedWorker {} }));
            test("workers", () => {
              vi.stubGlobal("Worker", class StubbedWorker {});
              console.log("@" + JSON.stringify([new EchoWorker().constructor.name, new OtherWorker().constructor.name]));
              vi.unstubAllGlobals();
            });
          `,
        },
        ["test"],
      ),
    ).toEqual({ printed: ["StubbedWorker", "MockedWorker"], stderr: "", exitCode: 0 });
  });

  test("an error in the wrapper is shown with the wrapper's source", async () => {
    using dir = tempDir("import-suffixes", {
      "echo.ts": "// first line of the file\n// second line of the file\n// third line of the file\n" + echoWorker,
      "main.ts": `import EchoSharedWorker from "./echo.ts?sharedworker";\nnew EchoSharedWorker();\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("return new SharedWorker(");
    expect(stderr).not.toContain("line of the file");
    expect(stderr).toContain("ReferenceError: SharedWorker is not defined");
    expect(stderr).toContain(`at new WorkerWrapper (${path.join(String(dir), "echo.ts")}?sharedworker:2:`);
    expect(exitCode).toBe(1);
  });
});
