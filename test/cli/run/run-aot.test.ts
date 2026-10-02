import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, isArm64, isWindows, tempDir } from "harness";
import { join } from "path";

// `bun run --aot`: compiles the program ahead of time, as `bun build --compile --compile-aot` does, then replaces
// itself with the result.
// The compiler only targets arm64 so far.
const supported = isArm64 && !isWindows;

type Options = { args?: string[]; env?: Record<string, string>; stdin?: string; flags?: string[]; builds?: boolean };

// A run that did not use its compiled code would still work, from the bytecode, and nothing else here would notice. So
// each run logs what it uses, which is checked and then removed from the output.
function expectToHaveUsedImage(stderr: string) {
  expect(stderr).toContain("[aot] static heap: ");
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

// `bun run` provides the expected output. The program is started from its parent directory, so that nothing is found
// only because it is in the working directory.
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

describe.skipIf(!supported)("bun run --aot", () => {
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
      // The error must not be on the first line.
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
    expect(stdout).toContain(join("sub", "thrower.ts") + ":4:");
  });

  // Not compared with `bun run`: for an uncaught error, bundled code with a source map reports a different column, with
  // or without ahead-of-time compilation.
  test.concurrent("an error that nothing catches", async () => {
    using dir = tempDir("run-aot", { "entry.ts": `import { inner } from "./sub/thrower"; inner();`, ...thrower });
    const { stderr, exitCode } = await run(String(dir), true, "entry.ts");
    expect(stderr).toContain("error: from the other module");
    expect(stderr).toContain(join(String(dir), "sub", "thrower.ts") + ":4:");
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
          exports: { custom: "./custom.js", default: "./default.js" },
        }),
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

  test.concurrent("the exit code and stdin", async () => {
    const { stdout, exitCode } = await expectSameAsBunRun(
      { "entry.ts": `console.log((await Bun.stdin.text()).toUpperCase()); process.exit(7);` },
      "entry.ts",
      { stdin: "from stdin" },
    );
    expect(stdout).toBe("FROM STDIN\n");
    expect(exitCode).toBe(7);
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
          function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
          self.onmessage = e => postMessage({ fib: fib(e.data), path: import.meta.path });
        `,
      },
      "entry.ts",
    );
    expect(stdout).toContain(`"fib":6765`);
  });

  // A file that a Worker starts with is part of the build if the build can tell which it is. A build that leaves out the
  // text of what it compiled shows which functions those are.
  test.concurrent("the file of a Worker is compiled too", async () => {
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
        function neverCalled() { return new Worker(new URL("./missing.ts", import.meta.url)); }
        console.log(JSON.stringify({ ...said, entry: String(neverCalled).endsWith("{ [native code] }") }));
      `,
      "app/shared.ts": `
        export function answer(path: string) { return [String(answer).endsWith("{ [native code] }"), path.split("/").slice(-2).join("/")]; }
      `,
      ...Object.fromEntries(
        ["href", "bare", "path", "computed"].map(name => [
          `app/${name}.ts`,
          `import { answer } from "./shared.ts"; postMessage(answer(import.meta.path));`,
        ]),
      ),
      "app/sub/url.ts": `import { answer } from "../shared.ts"; postMessage(answer(import.meta.path));`,
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
        parentPort!.postMessage(answer(import.meta.path));
      `,
    });
    // (Started from the parent directory: a path is relative to that, a URL to the file.)
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

  // The build cannot tell which file this worker starts with, so it is interpreted. The built-in functions it calls are
  // compiled.
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
    // The bundler's error message.
    expect(stderr).toContain(`Could not resolve: "./does-not-exist"`);
    expect(exitCode).toBe(1);
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
});
