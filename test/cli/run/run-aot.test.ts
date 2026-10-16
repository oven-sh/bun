import { describe, expect, test } from "bun:test";
import { spawn } from "child_process";
import { once } from "events";
import { chmodSync, readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import type { Readable } from "stream";
import { text } from "stream/consumers";

const supported = !isWindows;

type Options = { args?: string[]; env?: Record<string, string>; stdin?: string; flags?: string[]; builds?: boolean };

function expectToHaveUsedImage(stderr: string) {
  expect(stderr).toContain("[aot] program data: ");
  expect(stderr).toContain("[aot] image: ");
  expect(stderr).not.toContain("[aot] not using");
  return stderr.replace(/^\[aot\] .*\n/gm, "");
}

async function run(
  cwd: string,
  aot: boolean,
  entry: string,
  { args = [], env = {}, stdin, flags = [], builds = true }: Options = {},
) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", ...(aot ? ["--aot"] : []), ...flags, entry, ...args],
    env: { ...bunEnv, ...env, ...(aot ? { BUN_AOT_VERBOSE: "1" } : {}) },
    cwd,
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: aot && builds ? expectToHaveUsedImage(stderr) : stderr, exitCode };
}

async function expectSameAsBunRun(files: Record<string, string>, entry: string, options?: Options) {
  using dir = tempDir(
    "run-aot",
    Object.fromEntries(Object.entries(files).map(([path, text]) => ["app/" + path, text])),
  );
  const [expected, actual] = await Promise.all([
    run(String(dir), false, "app/" + entry, options),
    run(String(dir), true, "app/" + entry, options),
  ]);
  expect(actual).toEqual(expected);
  return actual;
}

describe.skipIf(!supported)("a file that is imported for its path", () => {
  const files = {
    "first.bin": "the first asset\n",
    "sub/second.bin": "the second asset\n",
    "helper.ts": `
      import { readFileSync } from "fs";
      export const isPlaceholder = (path: string) => /^[0-9a-f]{16}[A-Z][0-9]{8}$/.test(path);
      export function read(path: string) {
        return [isPlaceholder(path) ? "a placeholder" : "a path", path.endsWith(".bin"), readFileSync(path, "utf8").trim()].join(", ");
      }
    `,
    "direct.ts": `
      import { readFileSync } from "fs";
      import first from "./first.bin" with { type: "file" };
      console.log(/^[0-9a-f]{16}[A-Z][0-9]{8}$/.test(first), first.length > 25, first.endsWith(".bin"), readFileSync(first, "utf8").trim());
    `,
    "through.ts": `
      import first from "./first.bin" with { type: "file" };
      import { read } from "./helper.ts";
      console.log(read(first));
    `,
    "two.ts": `
      import first from "./first.bin" with { type: "file" };
      import second from "./sub/second.bin" with { type: "file" };
      import { read } from "./helper.ts";
      console.log(read(first));
      console.log(read(second));
      console.log(first === second, [first, second].map(path => path.split("/").pop()!.slice(0, 5)).join());
    `,
    "worker.ts": `
      import first from "./first.bin" with { type: "file" };
      import { read } from "./helper.ts";
      if (Bun.isMainThread) {
        const worker = new Worker(import.meta.url);
        worker.onmessage = event => {
          console.log("the worker:", event.data);
          console.log("the main thread:", read(first));
          worker.terminate();
        };
      } else {
        postMessage(read(first));
      }
    `,
  };
  const expected: Record<string, string> = {
    "direct.ts": "false true true the first asset\n",
    "through.ts": "a path, true, the first asset\n",
    "two.ts": "a path, true, the first asset\na path, true, the second asset\nfalse first,secon\n",
    "worker.ts": "the worker: a path, true, the first asset\nthe main thread: a path, true, the first asset\n",
  };

  describe.each(Object.keys(expected))("%s", entry => {
    test.concurrent("bun run --aot", async () => {
      using dir = tempDir("run-aot", files);
      for (const aot of [false, true]) {
        const { stdout, stderr, exitCode } = await run(String(dir), aot, entry);
        expect({ aot, stdout, stderr, exitCode }).toEqual({ aot, stdout: expected[entry], stderr: "", exitCode: 0 });
      }
    });

    test.concurrent("bun build --compile --aot", async () => {
      using dir = tempDir("run-aot", files);
      for (const flags of [[], ["--aot"]]) {
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", "--compile", ...flags, entry, "--outfile", "out"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "ignore",
          stderr: "pipe",
        });
        expect([flags, await build.stderr.text(), await build.exited]).toEqual([flags, expect.not.stringContaining("error"), 0]);
        await using proc = Bun.spawn({ cmd: [join(String(dir), "out")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ flags, stdout, stderr, exitCode }).toEqual({ flags, stdout: expected[entry], stderr: "", exitCode: 0 });
      }
    });
  });
});

describe.skipIf(!supported)("bun run --aot", () => {
  test.concurrent("a preload that throws is reported", async () => {
    const { stderr, exitCode } = await expectSameAsBunRun(
      {
        "entry.ts": `console.log("the entry point runs");`,
        "preload.ts": `console.log("the preload begins"); throw new Error("thrown by the preload");`,
      },
      "entry.ts",
      { flags: ["--preload=./app/preload.ts"] },
    );
    expect(stderr).toContain("error: thrown by the preload");
    expect(exitCode).toBe(1);
  });

  test.concurrent.each([
    ["the entry point", `console.log("the entry point begins"); await Promise.resolve(); throw new Error("thrown behind an await");`],
    ["what it imports", `import "./imported"; console.log("never");`],
  ])("a throw behind a top-level await in %s is reported behind a preload", async (_where, entry) => {
    const { stderr, exitCode } = await expectSameAsBunRun(
      {
        "entry.ts": entry,
        "imported.ts": `console.log("the imported file begins"); await 0; throw new Error("thrown behind an await");`,
        "preload.ts": `console.log("the preload runs");`,
      },
      "entry.ts",
      { flags: ["--preload=./app/preload.ts"] },
    );
    expect(stderr).toContain("error: thrown behind an await");
    expect(exitCode).toBe(1);
  });

  test.concurrent("prints nothing of its own", async () => {
    using dir = tempDir("run-aot", { "entry.ts": `` });
    expect(await run(String(dir), true, "entry.ts")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  test.concurrent("modules see the paths of their source files", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          import { readFileSync } from "node:fs";
          import { join } from "node:path";
          import { other } from "./sub/other";
          const { dir, dirname, file, filename, path, url, main } = import.meta;
          console.log(JSON.stringify({ dir, dirname, file, filename, path, url, main }));
          console.log(JSON.stringify(other()));
          console.log(readFileSync(join(import.meta.dir, "fixture.txt"), "utf8"));
          console.log(import.meta.resolve("./fixture.txt"), import.meta.resolveSync("./sub/other.ts"));
        `,
        "sub/other.ts": `export const other = () => [import.meta.dir, import.meta.file, import.meta.resolve("./other.ts")];`,
        "fixture.txt": `the fixture`,
      },
      "entry.ts",
    );
    expect(stdout).toContain("the fixture");
    expect(stdout).not.toContain("$bunfs");
  });

  test.concurrent("CommonJS modules see the paths of their source files", async () => {
    await expectSameAsBunRun(
      { "entry.cjs": `console.log(__dirname, __filename, require.main === module);` },
      "entry.cjs",
    );
  });

  test.concurrent("require.main === module in an ES module", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          import { other } from "./other";
          if (require.main === module) console.log("main");
          console.log(require.main === module, module === require.main, require.main !== module, other());
        `,
        "other.ts": `export const other = () => [require.main === module, require.main !== module];`,
      },
      "entry.ts",
    );
    expect(stdout).toBe("main\ntrue true false [ false, true ]\n");
  });

  test.concurrent("__esModule of a module namespace object can be set", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          import * as Self from "./entry.ts";
          const seen: unknown[] = [(Self as any).__esModule];
          for (const value of [true, false, 1, undefined, "yes", null]) {
            (Self as any).__esModule = value;
            seen.push((Self as any).__esModule);
          }
          console.log(seen.join(), "__esModule" in Self, Object.getOwnPropertyNames(Self).join());
          console.log(require("./entry.ts") === Self, (Self as any).__esModule);
          for (const change of [() => ((Self as any).a = 2), () => delete (Self as any).a, () => ((Self as any).nothing = 2)]) {
            try {
              console.log(change());
            } catch (error: any) {
              console.log(error.constructor.name + ": " + error.message);
            }
          }
          export let a = 1;
        `,
      },
      "entry.ts",
    );
    expect(stdout).toStartWith(",true,,true,,true, true a\ntrue true\nTypeError: ");
  });

  test.concurrent("process.argv, process.execPath and Bun.main", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          console.log(JSON.stringify(process.argv), JSON.stringify(Bun.argv));
          console.log(process.execPath, process.argv0, Bun.main, Bun.main === import.meta.path);
        `,
      },
      "entry.ts",
      { args: ["a", "--b", "-c", "--", "--aot", "d e"] },
    );
    expect(stdout).toContain(`"a","--b","-c","--","--aot","d e"`);
  });

  const thrower = {
    "sub/thrower.ts": `
      export function inner(): never {
        throw new Error("from the other module");
      }
    `,
  };

  test.concurrent("stack traces", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          import { inner } from "./sub/thrower";
          function outer() { inner(); }
          try { outer(); } catch (e) { console.log((e as Error).stack); }
        `,
        ...thrower,
      },
      "entry.ts",
    );
    expect(stdout).toContain(join("sub", "thrower.ts") + ":3:");
  });

  test.concurrent("stack traces through require(), CommonJS top-level code and an immediately invoked function", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.cjs": `
          function load() {
            try {
              require("./throws.cjs");
            } catch (error) {
              return error.stack.replaceAll(__dirname, "");
            }
          }
          console.log(load().replace(/\\n +at \\S+ \\((?:unknown|:?\\d+:\\d+)\\)/g, ""));
        `,
        "throws.cjs": `
          exports.before = 1;
          (() => { throw new Error("thrown") })();
        `,
      },
      "entry.cjs",
    );
    expect(stdout).toMatch(
      /^Error: thrown\n    at <anonymous> \(\/throws\.cjs:3:\d+\)\n    at <anonymous> \(\/throws\.cjs:3:\d+\)\n    at load \(\/entry\.cjs:4:23\)\n    at <anonymous> \(\/entry\.cjs:9:\d+\)\n$/,
    );
  });

  test.concurrent("an error that nothing catches", async () => {
    using dir = tempDir("run-aot", { "entry.ts": `import { inner } from "./sub/thrower"; inner();`, ...thrower });
    const { stderr, exitCode } = await run(String(dir), true, "entry.ts");
    expect(stderr).toContain("error: from the other module");
    expect(stderr).toContain(join(String(dir), "sub", "thrower.ts") + ":3:");
    expect(stderr).toContain(join(String(dir), "entry.ts") + ":1:");
    expect(exitCode).toBe(1);
  });

  test.concurrent("other options mean what they mean without it", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          declare const DEFINED: string;
          import which from "pkg";
          console.log((globalThis as any).preloaded, DEFINED, which, process.env.FROM_FILE);
        `,
        "preload.ts": `(globalThis as any).preloaded = "preloaded";`,
        "other.env": `FROM_FILE=from the file`,
        "node_modules/pkg/package.json": JSON.stringify({
          name: "pkg",
          exports: { types: "./index.d.ts", custom: "./custom.js", default: "./default.js" },
        }),
        "node_modules/pkg/index.d.ts": `declare const which: string; export default which;`,
        "node_modules/pkg/custom.js": `export default "the custom condition";`,
        "node_modules/pkg/default.js": `export default "the default condition";`,
      },
      "entry.ts",
      {
        flags: [
          "--preload=./app/preload.ts",
          "--define=DEFINED:'defined'",
          "--conditions=custom",
          "--env-file=./app/other.env",
          "--smol",
        ],
      },
    );
    expect(stdout).toBe("preloaded defined the custom condition from the file\n");
  });

  test.concurrent("process.execArgv has it, for what is started with the same options", async () => {
    using dir = tempDir("run-aot", { "entry.ts": `console.log(JSON.stringify(process.execArgv));` });
    const { stdout, exitCode } = await run(String(dir), true, "entry.ts", { flags: ["--smol"], args: ["--aot"] });
    expect(stdout).toBe(`["--aot","--smol"]\n`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("import() and require() of what is only known when it runs", async () => {
    await expectSameAsBunRun(
      {
        "entry.ts": `
          const name = "./sub/" + ["oth", "er"].join("");
          console.log((await import(name)).default, require(name + ".ts").default, require.resolve(name));
          console.log((await import(import.meta.dir + "/sub/other.ts")).default);
        `,
        "sub/other.ts": `export default "the other module";`,
      },
      "entry.ts",
    );
  });

  test.concurrent("a module with a top-level await that a preload imports too is one module", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          import { state } from "./lib";
          state.seen.push("the entry point");
          console.log(state.seen.join(", "), (globalThis as any).ofThePreload === state);
        `,
        "lib.ts": `
          console.log("lib is evaluated");
          await Promise.resolve();
          export const state: { seen: string[] } = { seen: [] };
        `,
        "preload.ts": `
          import { state } from "./lib";
          state.seen.push("the preload");
          (globalThis as any).ofThePreload = state;
        `,
      },
      "entry.ts",
      { flags: ["--preload=./app/preload.ts"] },
    );
    expect(stdout).toBe("lib is evaluated\nthe preload, the entry point true\n");
  });

  test.concurrent("a file that was not compiled imports the compiled module that awaits the import() of it", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `import { said } from "./lib"; console.log("entry:", said);`,
        "lib.ts": `
          console.log("lib begins");
          const other = await import(import.meta.dirname + "/" + ["other", "ts"].join("."));
          export const said = "lib has " + other.word;
          console.log(other.later());
        `,
        "other.ts": `
          import * as lib from "./lib";
          console.log("other runs");
          export const word = "a word";
          export const later = () => Object.keys(lib).join() + ": " + lib.said;
        `,
      },
      "entry.ts",
    );
    expect(stdout).toBe("lib begins\nother runs\nsaid: lib has a word\nentry: lib has a word\n");
  });

  test.concurrent("export default { fetch } behind a preload starts one server", async () => {
    using dir = tempDir("run-aot", {
      "entry.ts": `export default { port: 0, fetch() { return new Response("served"); } }; setTimeout(() => process.exit(0), 50);`,
      "preload.ts": `console.log("the preload runs");`,
    });
    const { stdout, exitCode } = await run(String(dir), true, "entry.ts", { flags: ["--preload=./preload.ts"] });
    expect(stdout).toStartWith("the preload runs\n");
    expect(stdout.match(/^Started .*server: /gm)).toHaveLength(1);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a throw behind a top-level await in a Worker that has a preload is reported", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          const worker = new Worker(new URL("./worker.ts", import.meta.url).href, { preload: [new URL("./preload.ts", import.meta.url).pathname] });
          worker.addEventListener("error", event => { console.log("error:", event.message.includes("thrown behind an await")); });
          worker.addEventListener("close", () => { console.log("closed"); });
        `,
        "worker.ts": `console.log("the worker begins"); await Promise.resolve(); throw new Error("thrown behind an await");`,
        "preload.ts": `console.log("the preload runs");`,
      },
      "entry.ts",
    );
    expect(stdout).toBe("the preload runs\nthe worker begins\nerror: true\nclosed\n");
  });

  test.concurrent("require.extensions handlers run for compiled files", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          const extensions = require.extensions as Record<string, (module: any, filename: string) => void>;
          const { ".js": js, ".ts": ts, ".json": json } = extensions;
          let calls = 0;
          extensions[".js"] = (module, filename) => (calls++, module._compile("module.exports = 'by the handler';", filename));
          console.log(require("./common"), (await import("./imported.js")).default, calls);
          extensions[".js"] = js;
          console.log(require("./common"), require("./other"), calls);
          extensions[".ts"] = extensions[".cjs"] = (module, filename) => (calls++, ts(module, filename));
          console.log(require("./module.ts").name, require("./secretly-a-module").default, calls);
          extensions[".ts"] = ts;
          extensions[".json"] = module => (calls++, (module.exports = "by the handler"));
          console.log(require("./data.json"), calls);
          extensions[".json"] = json;
        `,
        "common.js": `module.exports = "common.js";`,
        "imported.js": `module.exports = "imported.js";`,
        "other.js": `module.exports = "other.js";`,
        "module.ts": `export const name: string = "module.ts";`,
        "secretly-a-module.cjs": `export default 1;`,
        "data.json": `{ "a": 1 }`,
      },
      "entry.ts",
    );
    expect(stdout).toBe("by the handler imported.js 1\nby the handler other.js 1\nmodule.ts 1 3\nby the handler 4\n");
  });

  test.concurrent("the default require.extensions loaders run compiled modules", async () => {
    using dir = tempDir("run-aot", {
      "entry.ts": `
        const extensions = require.extensions as Record<string, (module: any, filename: string) => void>;
        const { ".js": js, ".ts": ts } = extensions;
        const seen: string[] = [];
        const nameOf = (filename: string) => filename.slice(filename.lastIndexOf("/") + 1);
        extensions[".js"] = (module, filename) => (seen.push(nameOf(filename)), js(module, filename));
        extensions[".ts"] = (module, filename) => (seen.push(nameOf(filename)), ts(module, filename));
        console.log(require("./common"), require("./module.ts").name, seen.join());
      `,
      "common.js": `module.exports = "common.js";`,
      "module.ts": `export const name: string = "module.ts";`,
    });
    const [expected, actual] = await Promise.all([
      run(String(dir), false, "entry.ts"),
      run(String(dir), true, "entry.ts", { env: { BUN_JSC_crashIfInterpreterIsUsed: "1" } }),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.stdout).toBe("common.js module.ts common.js,module.ts\n");
  });

  test.concurrent("every store by name to process.env goes through the conversion to a string", async () => {
    using dir = tempDir("run-aot", {
      "entry.ts": `
        function store(env: any, value: any) { env.STORED_BY_NAME = value; }
        function storeTyped(env: NodeJS.ProcessEnv, value: string) { env.STORED_BY_A_TYPED_SITE = value; }
        const lines: string[] = [];
        for (let i = 0; i < 6; i++) {
          store(process.env, i);
          lines.push(typeof process.env.STORED_BY_NAME + " " + process.env.STORED_BY_NAME + " " + Bun.env.STORED_BY_NAME);
        }
        for (const value of [undefined, null, true, 1.5, { toString() { return "object"; } }]) {
          store(process.env, value);
          lines.push(typeof process.env.STORED_BY_NAME + " " + process.env.STORED_BY_NAME);
        }
        for (let i = 0; i < 4; i++) {
          storeTyped(process.env, "v" + i);
          const child = Bun.spawnSync({ cmd: ["/bin/sh", "-c", "echo $STORED_BY_A_TYPED_SITE"], env: process.env as Record<string, string> });
          lines.push(process.env.STORED_BY_A_TYPED_SITE + " " + child.stdout.toString().trim());
        }
        console.log(lines.join("\\n"));
      `,
    });
    const { stdout } = await run(String(dir), true, "entry.ts", { env: { BUN_JSC_crashIfInterpreterIsUsed: "1" } });
    expect(stdout.trim().split("\n")).toEqual([
      "string 0 0",
      "string 1 1",
      "string 2 2",
      "string 3 3",
      "string 4 4",
      "string 5 5",
      "string undefined",
      "string null",
      "string true",
      "string 1.5",
      "string object",
      "v0 v0",
      "v1 v1",
      "v2 v2",
      "v3 v3",
    ]);
  });

  test.concurrent("require() and require.resolve() of a file with an unknown extension", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `console.log(require("./file.custom"), require.resolve("./file.custom").endsWith("file.custom"));`,
        "file.custom": `module.exports = "loaded as JavaScript";`,
      },
      "entry.ts",
    );
    expect(stdout).toBe("loaded as JavaScript true\n");
  });

  test.concurrent("required JSON is read at require time and reread after eviction from require.cache", async () => {
    const files = {
      "entry.ts": `
        import { writeFileSync } from "node:fs";
        import imported from "./data.json";
        const path = require.resolve("./data.json");
        const first = require("./data.json");
        console.log(first.n, first === require("./data.json"), first === imported, require.cache[path]?.exports === first);
        writeFileSync(path, '{ "n": 2 }');
        console.log(require("./data.json").n);
        delete require.cache[path];
        console.log(require("./data.json").n);
      `,
      "data.json": `{ "n": 1 }`,
    };
    using plain = tempDir("run-aot", files);
    using compiled = tempDir("run-aot", files);
    const [expected, actual] = await Promise.all([run(String(plain), false, "entry.ts"), run(String(compiled), true, "entry.ts")]);
    expect(actual).toEqual(expected);
    expect(actual.stdout).toBe("1 true false true\n1\n2\n");
  });

  for (const [entry, expected] of Object.entries({
    "entry.cjs": "sloppy",
    "commonjs-package/entry.js": "sloppy",
    "commonjs-package/entry.cjs": "sloppy",
    "module-package/entry.cjs": "sloppy",
    "imports-cjs.mjs": "strict",
    "imports-js-of-commonjs-package.mjs": "sloppy",
    "imports-cjs-of-commonjs-package.mjs": "sloppy",
    "imports-dynamically.mjs": "strict sloppy strict strict",
    "requires.cjs": "sloppy strict sloppy sloppy",
  })) {
    test.concurrent("files that are CommonJS only by name are sloppy where bun run has them sloppy: " + entry, async () => {
      const text = `(function () { console.log(this === undefined ? "strict" : "sloppy"); })();`;
      const { stdout } = await expectSameAsBunRun(
        {
          "entry.cjs": text,
          "imported.cjs": text,
          "required.cjs": text,
          "no-package-type.js": text,
          "commonjs-package/package.json": `{ "type": "commonjs" }`,
          "commonjs-package/entry.js": text,
          "commonjs-package/entry.cjs": text,
          "module-package/package.json": `{ "type": "module" }`,
          "module-package/entry.cjs": text,
          "imports-cjs.mjs": `import "./imported.cjs";`,
          "imports-js-of-commonjs-package.mjs": `import "./commonjs-package/entry.js";`,
          "imports-cjs-of-commonjs-package.mjs": `import "./commonjs-package/entry.cjs";`,
          "imports-dynamically.mjs": `
            await import("./imported.cjs");
            await import("./commonjs-package/entry.js");
            await import("./module-package/entry.cjs");
            await import("./no-package-type.js");
          `,
          "requires.cjs": `
            require("./required.cjs");
            require("./no-package-type.js");
            require("./commonjs-package/entry.js");
            require("./module-package/entry.cjs");
          `,
        },
        entry,
      );
      expect(stdout.trim().split("\n").join(" ")).toBe(expected);
    });
  }

  test.concurrent("a CommonJS module with a top-level return is compiled", async () => {
    using dir = tempDir("run-aot", {
      "entry.cjs": `console.log(require("./returns.cjs"), require("./returns-a-value.cjs"));`,
      "returns.cjs": `
        exports.before = true;
        if (exports.before) return;
        exports.after = true;
      `,
      "returns-a-value.cjs": `
        module.exports = "exported";
        return "ignored";
      `,
    });
    const [expected, actual] = await Promise.all([
      run(String(dir), false, "entry.cjs"),
      run(String(dir), true, "entry.cjs", { env: { BUN_JSC_crashIfInterpreterIsUsed: "1" } }),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.stdout).toBe("{\n  before: true,\n} exported\n");
  });

  test.concurrent("compiled modules stay compiled under Module.prototype.require and Module._resolveFilename overrides", async () => {
    using dir = tempDir("run-aot", {
      "entry.cjs": `
        const Module = require("node:module");
        const { require: original } = Module.prototype;
        const { _resolveFilename: resolve } = Module;
        const seen = [];
        Module.prototype.require = function (id) {
          seen.push(id);
          return original.apply(this, arguments);
        };
        Module._resolveFilename = function (request, ...rest) {
          return resolve.call(this, request === "./common" ? "./other" : request, ...rest);
        };
        console.log(require("./common"), require("./module.ts").name, seen.join());
        Module._resolveFilename = resolve;
        console.log(require("./other"));
      `,
      "common.js": `module.exports = "common.js";`,
      "other.js": `module.exports = "other.js";`,
      "module.ts": `export const name: string = "module.ts";`,
    });
    const [expected, actual] = await Promise.all([
      run(String(dir), false, "entry.cjs"),
      run(String(dir), true, "entry.cjs", { env: { BUN_JSC_crashIfInterpreterIsUsed: "1" } }),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.stdout).toBe("other.js module.ts ./common,./module.ts\nother.js\n");
  });

  test.concurrent("Module.prototype.require, Module._resolveFilename and Module.wrapper overrides apply to compiled files", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.cjs": `
          const Module = require("node:module");
          const { require: original } = Module.prototype;
          const { _resolveFilename: resolve } = Module;
          const seen = [];
          Module.prototype.require = function (id) {
            seen.push(id);
            return original.apply(this, arguments);
          };
          console.log(require("./common"), require("./requires-other.cjs"), require("./module.ts").name, require("./data.json").a, seen.join());
          Module.prototype.require = original;
          Module._resolveFilename = function (request, ...rest) {
            seen.push(request);
            return resolve.call(this, request === "./common" ? "./other" : request, ...rest);
          };
          console.log(require("./common"), seen.slice(5).join());
          Module._resolveFilename = resolve;
          Module.wrapper[0] += "globalThis.wrapped = true;";
          console.log(require("./last"), globalThis.wrapped);
        `,
        "common.js": `module.exports = "common.js";`,
        "other.js": `module.exports = "other.js";`,
        "requires-other.cjs": `module.exports = "requires " + require("./other");`,
        "module.ts": `export const name: string = "module.ts";`,
        "data.json": `{ "a": 1 }`,
        "last.js": `module.exports = "last.js";`,
      },
      "entry.cjs",
    );
    expect(stdout).toBe(
      "common.js requires other.js module.ts 1 ./common,./requires-other.cjs,./other,./module.ts,./data.json\nother.js ./common\nlast.js true\n",
    );
  });

  test.concurrent("the exit code and stdin", async () => {
    const { stdout, exitCode } = await expectSameAsBunRun(
      { "entry.ts": `console.log((await Bun.stdin.text()).toUpperCase()); process.exit(7);` },
      "entry.ts",
      { stdin: "from stdin" },
    );
    expect(stdout).toBe("FROM STDIN\n");
    expect(exitCode).toBe(7);
  });

  test.concurrent("require.cache lists compiled modules that finished evaluating", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          import { name } from "./imported.ts";
          const [imported, later, failing] = ["./imported.ts", "./later.ts", "./failing.ts"].map(path => require.resolve(path));
          const names = () => Object.keys(require.cache).map(key => key.slice(key.lastIndexOf("/") + 1)).sort().join();
          console.log(name, names(), imported in require.cache, require.cache[imported]?.exports?.name, import.meta.path in require.cache);
          console.log(later in require.cache);
          await import("./later.ts");
          console.log(names(), later in require.cache);
          console.log(await import("./failing.ts").then(({ tries }) => tries, error => error.message), failing in require.cache);
        `,
        "imported.ts": `export const name = "imported.ts";`,
        "later.ts": `export {};`,
        "failing.ts": `
          const all = globalThis as { tries?: number };
          export const tries: number = (all.tries = (all.tries ?? 0) + 1);
          if (tries == 1) throw new Error("the first try fails");
        `,
      },
      "entry.ts",
    );
    expect(stdout).toBe("imported.ts imported.ts true imported.ts false\nfalse\nimported.ts,later.ts true\nthe first try fails false\n");
  });

  test.concurrent("ES modules evicted from require.cache are evaluated again, compiled", async () => {
    using dir = tempDir("run-aot", {
      "entry.ts": `
        const path = require.resolve("./counted.ts");
        delete require.cache[path];
        console.log(require("./counted.ts").count, path in require.cache, require("./counted.ts").count);
        delete require.cache[path];
        console.log(path in require.cache, require("./counted.ts").count, (await import("./counted.ts")).count);
        delete require.cache[path];
        console.log((await import("./counted.ts")).count, (await import(path)).count, require("./counted.ts").count);
        console.log((await import("./importer.ts")).seen);
        for (const evicts of [false, true, false]) {
          console.log(await import("./fails-once.ts").then(({ tries }) => tries, error => error.message));
          if (evicts) delete require.cache[require.resolve("./fails-once.ts")];
        }
        delete require.cache[require.resolve("./awaits.ts")];
        console.log((await import("./awaits.ts")).count);
        delete require.cache[require.resolve("./awaits.ts")];
        console.log((await import("./awaits.ts")).count);
      `,
      "counted.ts": `const all = globalThis as { count?: number }; export const count: number = (all.count = (all.count ?? 0) + 1);`,
      "importer.ts": `import { count } from "./counted.ts"; export const seen = "the importer sees " + count;`,
      "fails-once.ts": `
        const all = globalThis as { tries?: number };
        export const tries: number = (all.tries = (all.tries ?? 0) + 1);
        if (tries == 1) throw new Error("the first try fails");
      `,
      "awaits.ts": `
        const all = globalThis as { awaited?: number };
        await 0;
        export const count: number = (all.awaited = (all.awaited ?? 0) + 1);
      `,
    });
    const [expected, actual] = await Promise.all([
      run(String(dir), false, "entry.ts"),
      run(String(dir), true, "entry.ts", { env: { BUN_JSC_crashIfInterpreterIsUsed: "1" } }),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.stdout).toBe("1 true 1\nfalse 2 2\n3 3 3\nthe importer sees 3\nthe first try fails\nthe first try fails\n2\n1\n2\n");
  });

  test.concurrent("the namespace of an evicted ES module keeps its values", async () => {
    using dir = tempDir("run-aot", {
      "entry.ts": `
        const first = await import("./counted.ts");
        delete require.cache[require.resolve("./counted.ts")];
        console.log(first.count, Object.keys(first).join());
        const second = await import("./counted.ts");
        console.log(first.count, second.count, first === second, first.list === second.list, first.list.join(), second.list.join());
      `,
      "counted.ts": `
        const all = globalThis as { count?: number };
        export const count: number = (all.count = (all.count ?? 0) + 1);
        export const list: number[] = [count];
      `,
    });
    const [expected, actual] = await Promise.all([
      run(String(dir), false, "entry.ts"),
      run(String(dir), true, "entry.ts", { env: { BUN_JSC_crashIfInterpreterIsUsed: "1" } }),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.stdout).toBe("1 count,list\n1 2 false false 1 2\n");
  });

  test.concurrent("a Worker", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
          worker.onmessage = e => { console.log(JSON.stringify(e.data)); worker.terminate(); };
          worker.postMessage(20);
        `,
        "worker.ts": `
          declare var self: Worker;
          function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
          self.onmessage = e => postMessage({ fib: fib(e.data), path: import.meta.path });
        `,
      },
      "entry.ts",
    );
    expect(stdout).toContain(`"fib":6765`);
  });

  test.concurrent("the file of a Worker is compiled too", async () => {
    const isCompiled = `function isCompiled(none: string[]) { try { const first: string = none[0]!; return first !== undefined; } catch { return true; } }`;
    using dir = tempDir("run-aot", {
      "app/entry.ts": `
        import { viaNode } from "./via-node.ts";
        const said: Record<string, unknown> = {};
        const listen = (name: string, worker: Worker) =>
          new Promise<void>(done => { worker.onmessage = e => { said[name] = e.data; worker.terminate(); done(); }; });
        const name = "./computed";
        await Promise.all([
          listen("href", new Worker(new URL("./href.ts", import.meta.url).href)),
          listen("url", new Worker(new URL("./sub/url.ts", import.meta.url))),
          listen("bare", new Worker(new URL("bare.ts", import.meta.url))),
          listen("path", new Worker("./app/path.ts")),
          listen("computed", new Worker(new URL(name + ".ts", import.meta.url))),
          viaNode().then(data => { said.node = data; }),
        ]);
        function isNeverCalled() { return new Worker(new URL("./missing.ts", import.meta.url)); }
        ${isCompiled}
        console.log(JSON.stringify({ ...said, entry: isCompiled([]) && typeof isNeverCalled === "function" }));
      `,
      "app/shared.ts": `
        export function answer(isCompiled: boolean, path: string) { return [isCompiled, path.split("/").slice(-2).join("/")]; }
      `,
      ...Object.fromEntries(
        ["href", "bare", "path", "computed"].map(name => [
          `app/${name}.ts`,
          `import { answer } from "./shared.ts"; ${isCompiled} postMessage(answer(isCompiled([]), import.meta.path));`,
        ]),
      ),
      "app/sub/url.ts": `import { answer } from "../shared.ts"; ${isCompiled} postMessage(answer(isCompiled([]), import.meta.path));`,
      "app/via-node.ts": `
        import { Worker } from "node:worker_threads";
        export const viaNode = () => new Promise(done => {
          const worker = new Worker(new URL("./node.ts", import.meta.url));
          worker.on("message", data => { worker.terminate(); done(data); });
        });
      `,
      "app/node.ts": `
        import { parentPort } from "node:worker_threads";
        import { answer } from "./shared.ts";
        ${isCompiled}
        parentPort!.postMessage(answer(isCompiled([]), import.meta.path));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), true, "app/entry.ts");
    expect({ said: JSON.parse(stdout), stderr, exitCode }).toEqual({
      said: {
        href: [true, "app/href.ts"],
        url: [true, "sub/url.ts"],
        bare: [true, "app/bare.ts"],
        path: [true, "app/path.ts"],
        node: [true, "app/node.ts"],
        computed: [false, "app/computed.ts"],
        entry: true,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a Worker that loads nothing that was compiled calls built-in functions that were", async () => {
    const { stdout } = await expectSameAsBunRun(
      {
        "entry.ts": `
          const name = "./worker";
          const worker = new Worker(new URL(name + ".ts", import.meta.url).href);
          worker.onmessage = e => { console.log(e.data); worker.terminate(); };
          worker.postMessage(3);
        `,
        "worker.ts": `
          function* count(n: number) { for (let i = 0; i < n; i++) yield i; }
          self.onmessage = async e => {
            postMessage(JSON.stringify([
              [...count(e.data)], [3, 1, 2].sort((a, b) => a - b), [1, 2, 3].map(x => x * 2), Array.from(new Set([1, 2])),
              [...new Map([[1, 2]])], await Promise.all([1, Promise.resolve(2)]), Object.fromEntries([["a", 1]]), "a-b".replaceAll("-", "+"),
            ]));
          };
        `,
      },
      "entry.ts",
    );
    expect(stdout).toBe(`[[0,1,2],[1,2,3],[2,4,6],[1,2],[[1,2]],[1,2],{"a":1},"a+b"]\n`);
  });

  test.concurrent(".env, tsconfig.json paths and package.json", async () => {
    using dir = tempDir("run-aot", {
      ".env": `FROM_DOTENV=yes`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@alias/*": ["./sub/*"] } } }),
      "package.json": JSON.stringify({ name: "app", type: "module" }),
      "entry.ts": `
        import other from "@alias/other";
        const late = "@alias/" + "other";
        console.log(process.env.FROM_DOTENV, other, (await import(late)).default);
      `,
      "sub/other.ts": `export default "through the alias";`,
    });
    const [expected, actual] = await Promise.all([
      run(String(dir), false, "entry.ts"),
      run(String(dir), true, "entry.ts"),
    ]);
    expect(actual).toEqual(expected);
    expect(actual.stdout).toBe("yes through the alias through the alias\n");
  });

  test.concurrent("what it starts is bun, and does not inherit what was built", async () => {
    await expectSameAsBunRun(
      {
        "entry.ts": `
          const child = Bun.spawnSync({
            cmd: [process.execPath, "-e", "console.log(require('fs').readdirSync('/dev/fd').length, process.argv.length)"],
          });
          console.log(child.stdout.toString(), child.stderr.toString(), child.exitCode);
        `,
      },
      "entry.ts",
    );
  });

  test.concurrent("leaves no temporary file", async () => {
    using dir = tempDir("run-aot", { "entry.ts": `console.log("ran");`, "tmp/.keep": `` });
    const tmp = join(String(dir), "tmp");
    const { stdout, exitCode } = await run(String(dir), true, "entry.ts", { env: { BUN_TMPDIR: tmp } });
    expect(stdout).toBe("ran\n");
    expect(readdirSync(tmp)).toEqual([".keep"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("stays one process", async () => {
    using dir = tempDir("run-aot", { "entry.ts": `console.log(process.pid);` });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--aot", "entry.ts"],
      env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expectToHaveUsedImage(stderr);
    expect(stdout).toBe(proc.pid + "\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("an error in the build", async () => {
    using dir = tempDir("run-aot", { "entry.ts": `import "./does-not-exist"; console.log("ran");` });
    const { stdout, stderr, exitCode } = await run(String(dir), true, "entry.ts", { builds: false });
    expect(stdout).toBe("");
    expect(stderr).toContain("./does-not-exist");
    expect(exitCode).toBe(1);
  });

  test.concurrent.each<[string, string[], string]>([
    ["a package.json script", ["run", "--aot", "start"], "error: --aot does not apply to a package.json script (start). "],
    ["a package.json script, without run", ["--aot", "start"], "error: --aot does not apply to a package.json script (start). "],
    ["--filter", ["run", "--aot", "--filter", "*", "start"], "error: --aot does not apply to the processes that --filter, "],
    ["--parallel", ["run", "--aot", "--parallel", "start"], "error: --aot does not apply to the processes that --filter, "],
    ["an executable in node_modules/.bin", ["run", "--aot", "tool"], "error: --aot does not apply to an executable ("],
    ["a shell script", ["run", "--aot", "./script.sh"], "error: --aot does not apply to a shell script ("],
  ])("--aot with %s is an error", async (_what, args, message) => {
    using dir = tempDir("run-aot", {
      "package.json": JSON.stringify({ name: "app", scripts: { start: "echo the script ran" } }),
      "node_modules/.bin/tool": "#!/bin/sh\necho the tool ran\n",
      "script.sh": "echo the shell script ran\n",
    });
    chmodSync(join(String(dir), "node_modules/.bin/tool"), 0o755);
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd: String(dir), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(message);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test.concurrent("Bun.build with compile.aot builds what it builds without --aot", async () => {
    using dir = tempDir("run-aot", {
      "app.ts": `console.log("the executable runs", Object.isFrozen(Array.prototype));`,
      "build.ts": `
        const results = await Promise.all(
          [1, 2].map(n => Bun.build({ entrypoints: ["./app.ts"], compile: { aot: true, outfile: process.argv[2] + "/app" + n } })),
        );
        console.log(results.map(result => result.success).join());
      `,
    });
    for (const aot of [false, true]) {
      const { stdout, exitCode } = await run(String(dir), aot, "build.ts", { args: [aot ? "./compiled" : "./plain"] });
      expect({ stdout, exitCode }).toEqual({ stdout: "true,true\n", exitCode: 0 });
    }
    const hashOf = async (path: string) => Bun.hash(await Bun.file(join(String(dir), path)).bytes());
    expect(await hashOf("compiled/app1")).toBe(await hashOf("plain/app1"));
    expect(await hashOf("compiled/app2")).toBe(await hashOf("plain/app2"));
    await using proc = Bun.spawn({ cmd: [join(String(dir), "compiled/app1")], env: bunEnv, stdout: "pipe", stderr: "inherit" });
    expect(await proc.stdout.text()).toBe("the executable runs true\n");
    expect(await proc.exited).toBe(0);
  });

  test.concurrent("a replaced Module.prototype.require is called, whenever it is replaced", async () => {
    using dir = tempDir("run-aot", {
      "entry.cjs": `
        const Module = require("node:module");
        const original = Module.prototype.require;
        const answering = answer =>
          function (id) {
            return id === "virtual/module" ? answer : original.apply(this, arguments);
          };
        Module.prototype.require = answering("first");
        console.log(require("virtual/module"), Module.createRequire(__filename)("virtual/module"));
        Module.prototype.require = answering("second");
        console.log(require("virtual/module"), Module.createRequire(__filename)("virtual/module"));
        Module.prototype.require = original;
        try {
          require("virtual/module");
        } catch {
          console.log("not found");
        }
      `,
    });
    for (const aot of [false, true]) {
      const { stdout, exitCode } = await run(String(dir), aot, "entry.cjs");
      expect({ stdout, exitCode }).toEqual({ stdout: "first first\nsecond second\nnot found\n", exitCode: 0 });
    }
  });

  test.concurrent("default exports, with and without a name of their own, can be imported from other files", async () => {
    using dir = tempDir("run-aot", {
      "anonymous-class.js": `export default class {}
`,
      "anonymous-class-with-statics.js": `export default class {
  static value = "static field";
  static {
    this.block = "static block";
  }
  static method() {
    return "static method";
  }
}
`,
      "anonymous-class-with-constructor.js": `export default class {
  constructor(x) {
    this.x = x;
  }
}
`,
      "anonymous-class-extended.js": `import Base from "./anonymous-class-with-constructor.js";
export default class extends Base {
  get twice() {
    return this.x * 2;
  }
}
`,
      "named-class.js": `export default class Named {}
`,
      "named-class-extends-anonymous.js": `import Base from "./anonymous-class.js";
export default class Heir extends Base {}
`,
      "class-expression.js": `const Held = class {};
export { Held as default };
`,
      "anonymous-function.js": `export default function () {
  return "anonymous function";
}
`,
      "named-function.js": `export default function named() {
  return "named function";
}
`,
      "anonymous-generator.js": `export default function* () {
  yield "anonymous generator";
}
`,
      "anonymous-async-function.js": `export default async function () {
  return "anonymous async function";
}
`,
      "arrow.js": `export default () => "arrow";
`,
      "reexports.js": `export { default } from "./anonymous-class.js";
export { default as WithStatics } from "./anonymous-class-with-statics.js";
export { default as anonymousFunction } from "./anonymous-function.js";
`,
      "typed-anonymous-class.ts": `export default class {
  size: number = 1;
  grow(by: number): number {
    return (this.size += by);
  }
}
`,
      "typed-anonymous-class-with-constructor.ts": `export default class {
  constructor(public readonly label: string) {}
}
`,
      "typed-anonymous-class-extended.ts": `import Base from "./typed-anonymous-class";
export default class extends Base {
  shrink(by: number): number {
    return (this.size -= by);
  }
}
`,
      "typed-anonymous-function.ts": `export default function (n: number): number {
  return n + 1;
}
`,
      "entry.ts": `import Anonymous from "./anonymous-class.js";
import { default as AnonymousAgain } from "./anonymous-class.js";
import WithStatics from "./anonymous-class-with-statics.js";
import WithConstructor from "./anonymous-class-with-constructor.js";
import Extended from "./anonymous-class-extended.js";
import Named from "./named-class.js";
import Heir from "./named-class-extends-anonymous.js";
import Held from "./class-expression.js";
import anonymousFunction from "./anonymous-function.js";
import { default as anonymousFunctionAgain } from "./anonymous-function.js";
import namedFunction from "./named-function.js";
import anonymousGenerator from "./anonymous-generator.js";
import anonymousAsyncFunction from "./anonymous-async-function.js";
import arrow from "./arrow.js";
import Reexported, { WithStatics as ReexportedWithStatics, anonymousFunction as reexportedFunction } from "./reexports.js";
import * as namespace from "./anonymous-class.js";
import Typed from "./typed-anonymous-class";
import TypedWithConstructor from "./typed-anonymous-class-with-constructor";
import TypedExtended from "./typed-anonymous-class-extended";
import typedFunction from "./typed-anonymous-function";

const row = (name: string, ...values: unknown[]) => console.log(name + ": " + values.map(value => JSON.stringify(value)).join(" "));
row("anonymous class", Anonymous.name, new Anonymous() instanceof Anonymous, Anonymous === AnonymousAgain, Anonymous === Reexported, Anonymous === namespace.default);
row("with statics", WithStatics.name, WithStatics.value, WithStatics.block, WithStatics.method(), WithStatics === ReexportedWithStatics);
row("with a constructor", WithConstructor.name, new WithConstructor(3).x, WithConstructor.length);
row("extended", Extended.name, new Extended(4).twice, new Extended(4) instanceof WithConstructor);
row("named class", Named.name, new Named() instanceof Named);
row("named, extends anonymous", Heir.name, new Heir() instanceof Anonymous, Object.getPrototypeOf(Heir) === Anonymous);
row("class expression", Held.name, new Held() instanceof Held);
row("functions", anonymousFunction.name, anonymousFunction(), anonymousFunction === anonymousFunctionAgain, anonymousFunction === reexportedFunction, namedFunction.name, namedFunction(), arrow.name, arrow());
row("generator and async", anonymousGenerator.name, [...anonymousGenerator()], anonymousAsyncFunction.name, await anonymousAsyncFunction());
row("typed", Typed.name, new Typed().grow(2), TypedWithConstructor.name, new TypedWithConstructor("label").label, TypedExtended.name, new TypedExtended().shrink(1), new TypedExtended() instanceof Typed, typedFunction.name, typedFunction(1));
`,
    });
    const { stdout, exitCode } = await run(String(dir), true, "entry.ts");
    expect(stdout.trimEnd().split("\n")).toEqual([
      'anonymous class: "default" true true true true',
      'with statics: "default" "static field" "static block" "static method" true',
      'with a constructor: "default" 3 1',
      'extended: "default" 8 true',
      'named class: "Named" true',
      'named, extends anonymous: "Heir" true true',
      'class expression: "Held" true',
      'functions: "default" "anonymous function" true true "named" "named function" "default" "arrow"',
      'generator and async: "default" ["anonymous generator"] "default" "anonymous async function"',
      'typed: "default" 3 "default" "label" "default" 0 true "default" 2',
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a replaced Module.prototype.require is called for the files of the program", async () => {
    using dir = tempDir("run-aot", {
      "real.cjs": `exports.real = true;`,
      "entry.cjs": `
        const Module = require("node:module");
        const original = Module.prototype.require;
        const seen = [];
        Module.prototype.require = function (id) {
          if (id.startsWith(".")) seen.push(id);
          const exports = original.apply(this, arguments);
          return id === "./real.cjs" ? { ...exports, patched: true } : exports;
        };
        console.log(JSON.stringify(require("./real.cjs")), seen.join());
      `,
    });
    for (const aot of [false, true]) {
      const { stdout, exitCode } = await run(String(dir), aot, "entry.cjs");
      expect({ stdout, exitCode }).toEqual({ stdout: '{"real":true,"patched":true} ./real.cjs\n', exitCode: 0 });
    }
  });

  test.concurrent("globals that other sources of the project declare or bring in are seen", async () => {
    using dir = tempDir("run-aot", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, types: [], skipLibCheck: true }, include: ["src"] }),
      "node_modules/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0", main: "index.js", types: "index.d.ts" }),
      "node_modules/lib/index.js": `exports.make = () => ({ size: 3 });`,
      "node_modules/lib/index.d.ts": `
        export as namespace Lib;
        export interface Thing { size: number }
        export declare function make(): Thing;
      `,
      "src/imports-lib.ts": `
        import { make } from "lib";
        import { helper } from "./helper";
        export const made = helper(make());
      `,
      "src/helper.ts": `export const helper = <T>(value: T): T => value;`,
      "src/declares.ts": `
        import type { Sized } from "./sized";
        declare global {
          interface Shape extends Sized {}
        }
      `,
      "src/sized.ts": `export interface Sized { size: number }`,
      "src/entry.ts": `
        const thing: Lib.Thing = { size: 1 };
        const shape: Shape = { size: 2 };
        console.log(thing.size, shape.size);
      `,
      "src/entry-that-imports-them.ts": `
        import { made } from "./imports-lib";
        import type { Sized } from "./sized";
        const thing: Lib.Thing = made;
        const shape: Shape = { size: 4 } satisfies Sized;
        console.log(thing.size, shape.size);
      `,
    });
    const alone = await run(String(dir), true, "src/entry.ts");
    expect({ stdout: alone.stdout, exitCode: alone.exitCode }).toEqual({ stdout: "1 2\n", exitCode: 0 });
    const importing = await run(String(dir), true, "src/entry-that-imports-them.ts");
    expect({ stdout: importing.stdout, exitCode: importing.exitCode }).toEqual({ stdout: "3 4\n", exitCode: 0 });
  });

  test.concurrent("a replaced Module.prototype.require can replace the exports of a file of which only members are read", async () => {
    using dir = tempDir("run-aot", {
      "members.cjs": `
        const value = "original";
        exports.value = value;
        exports.shout = () => value.toUpperCase();
      `,
      "entry.cjs": `
        const Module = require("node:module");
        const original = Module.prototype.require;
        const seen = [];
        Module.prototype.require = function (id) {
          if (id.startsWith(".")) seen.push(id);
          return id === "./members.cjs" ? { value: "replaced", shout: () => "REPLACED" } : original.apply(this, arguments);
        };
        console.log(require("./members.cjs").value, require("./members.cjs").shout(), seen.join());
      `,
    });
    for (const aot of [false, true]) {
      const { stdout, exitCode } = await run(String(dir), aot, "entry.cjs");
      expect({ stdout, exitCode }).toEqual({ stdout: "replaced REPLACED ./members.cjs,./members.cjs\n", exitCode: 0 });
    }
  });

  test.concurrent("the debugger is not supported", async () => {
    using dir = tempDir("run-aot", { "entry.ts": `console.log("ran");` });
    const { stdout, stderr, exitCode } = await run(String(dir), true, "entry.ts", {
      flags: ["--inspect"],
      builds: false,
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("the debugger is not supported with --aot");
    expect(exitCode).toBe(1);
  });

  test.concurrent.each(["--watch", "--hot"])("%s is not supported", async flag => {
    using dir = tempDir("run-aot", { "entry.ts": `console.log("ran");` });
    const { stdout, stderr, exitCode } = await run(String(dir), true, "entry.ts", { flags: [flag], builds: false });
    expect(stdout).toBe("");
    expect(stderr).toContain(`error: --aot does not support ${flag}: `);
    expect(exitCode).toBe(1);
  });
});

test.skipIf(!supported).each([false, true])("inherited file descriptors stay open (--aot: %p)", async aot => {
  using dir = tempDir("run-aot", {
    "entry.js": `
      const { writeSync } = require("fs");
      writeSync(3, "written to 3");
      writeSync(4, "written to 4");
    `,
  });
  const child = spawn(bunExe(), ["run", ...(aot ? ["--aot"] : []), "entry.js"], {
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
  });
  const [stderr, third, fourth, [exitCode]] = await Promise.all([
    text(child.stderr!),
    text(child.stdio[3] as Readable),
    text(child.stdio[4] as Readable),
    once(child, "exit"),
  ]);
  expect({ stderr, third, fourth, exitCode }).toEqual({
    stderr: "",
    third: "written to 3",
    fourth: "written to 4",
    exitCode: 0,
  });
});
