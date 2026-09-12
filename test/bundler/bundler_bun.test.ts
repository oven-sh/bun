import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { itBundled } from "./expectBundled";

const nestedFunctions = /* js */ `
  export function outer() {
    function middle() {
      function inner() {
        return "world";
      }
      return inner();
    }
    return middle();
  }
  console.log(outer());
`;

describe("bundler", () => {
  for (const backend of ["cli", "api"] as const) {
    itBundled(`bun/bytecode-depth-${backend}`, {
      backend,
      target: "bun",
      format: "cjs",
      bytecode: true,
      bytecodeDepth: 0,
      outdir: "/out",
      files: { "/entry.ts": nestedFunctions },
      run: { stdout: "world\n" },
      async onAfterBundle(api) {
        const shallow = Bun.file(api.join("out/entry.js.jsc")).size;
        const full = await Bun.build({
          entrypoints: [api.join("entry.ts")],
          outdir: api.join("full"),
          target: "bun",
          format: "cjs",
          bytecode: true,
        });
        expect(full.outputs[1].kind).toBe("bytecode");
        expect(shallow).toBeGreaterThan(0);
        expect(shallow).toBeLessThan(full.outputs[1].size);
      },
    });
  }

  // https://github.com/oven-sh/bun/issues/18899
  itBundled("bun/import-bun-format-cjs", {
    target: "bun",
    format: "cjs",
    bytecode: true,
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import {RedisClient} from 'bun';
        import * as BunStar from 'bun';
        const bunRequire = require("bun");
        if (RedisClient.name !== "RedisClient") {
          throw new Error("RedisClient.name is not RedisClient");
        }
        if (BunStar.RedisClient.name !== "RedisClient") {
          throw new Error("BunStar.RedisClient.name is not RedisClient");
        }
        if (bunRequire.RedisClient.name !== "RedisClient") {
          throw new Error("bunRequire.RedisClient.name is not RedisClient");
        }

        console.log(RedisClient.name);
        console.log(BunStar.RedisClient.name);
        console.log(bunRequire.RedisClient.name);

        export class RedisCache {
          constructor(config: any) {
            this.connectServer(config);
          }
          
        }
      `,
    },
    run: { stdout: "RedisClient\nRedisClient\nRedisClient\n" },
  });
  itBundled("bun/embedded-sqlite-file", {
    target: "bun",
    outfile: "",
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import db from './db.sqlite' with {type: "sqlite", embed: "true"};
        console.log(db.query("select message from messages LIMIT 1").get().message);
      `,
      "/db.sqlite": (() => {
        const db = new Database(":memory:");
        db.exec("create table messages (message text)");
        db.exec("insert into messages values ('Hello, world!')");
        return db.serialize();
      })(),
    },
    run: { stdout: "Hello, world!" },
  });
  itBundled("bun/sqlite-file", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import db from './db.sqlite' with {type: "sqlite"};
        console.log(db.query("select message from messages LIMIT 1").get().message);
      `,
    },
    runtimeFiles: {
      "/db.sqlite": (() => {
        const db = new Database(":memory:");
        db.exec("create table messages (message text)");
        db.exec("insert into messages values ('Hello, world!')");
        return db.serialize();
      })(),
    },
    run: { stdout: "Hello, world!", setCwd: true },
  });
  itBundled("bun/TargetBunNoSourcemapMessage", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        // this file has comments and weird whitespace, intentionally
        // to make it obvious if sourcemaps were generated and mapped properly
        if           (true) code();
        function code() {
          // hello world
                  throw new
            Error("Hello World");
        }
      `,
    },
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toInclude("\nnote: missing sourcemaps for ");
        expect(stderr).toInclude("\nnote: consider bundling with '--sourcemap' to get unminified traces\n");
      },
    },
  });
  itBundled("bun/TargetBunSourcemapInline", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        // this file has comments and weird whitespace, intentionally
        // to make it obvious if sourcemaps were generated and mapped properly
        if           (true) code();
        function code() {
          // hello world
                  throw   new
            Error("Hello World");
        }
      `,
    },
    sourceMap: "inline",
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toStartWith(
          `1 | // this file has comments and weird whitespace, intentionally
2 | // to make it obvious if sourcemaps were generated and mapped properly
3 | if           (true) code();
4 | function code() {
5 |   // hello world
6 |           throw   new
                      ^
error: Hello World`,
        );
        expect(stderr).toInclude("entry.ts:6:19");
      },
    },
  });
  itBundled("bun/unicode comment", {
    target: "bun",
    files: {
      "/a.ts": /* js */ `
        /* æ */
      `,
    },
    run: { stdout: "" },
  });
  if (Bun.version.startsWith("1.4") || Bun.version.startsWith("1.3") || Bun.version.startsWith("1.2")) {
    for (const backend of ["api", "cli"] as const) {
      itBundled("bun/ExportsConditionsDevelopment" + backend.toUpperCase(), {
        files: {
          "src/entry.js": `import 'pkg1'`,
          "node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "development": "./custom1.js",
            "default": "./default.js"
          }
        }
      `,
          "node_modules/pkg1/custom1.js": `console.log('SUCCESS')`,
          "node_modules/pkg1/default.js": `console.log('FAIL')`,
        },
        backend,
        outfile: "out.js",
        define: { "process.env.NODE_ENV": '"development"' },
        run: {
          stdout: "SUCCESS",
        },
      });
      itBundled("bun/ExportsConditionsDevelopmentInProduction" + backend.toUpperCase(), {
        files: {
          "src/entry.js": `import 'pkg1'`,
          "node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "development": "./custom1.js",
            "default": "./default.js"
          }
        }
      `,
          "node_modules/pkg1/custom1.js": `console.log('FAIL')`,
          "node_modules/pkg1/default.js": `console.log('SUCCESS')`,
        },
        backend,
        outfile: "/Users/user/project/out.js",
        define: { "process.env.NODE_ENV": '"production"' },
        run: {
          stdout: "SUCCESS",
        },
      });
    }
  }
});

// https://github.com/oven-sh/bun/issues/29286: `--bytecode --format=esm`
// without `--compile` emits a `.js.jsc` sidecar next to each chunk that
// `bun <chunk>.js` loads automatically, so top-level `await` works without
// embedding the runtime.
describe("ESM bytecode sidecar without --compile", () => {
  test.concurrent("issue #29286: --bytecode --format=esm --outdir emits .jsc sidecar", async () => {
    using dir = tempDir("29286", {
      "index.ts": `
        async function getConfig() {
          return { port: 3000 };
        }
        const config = await getConfig();
        console.log(\`Server starting on port \${config.port}\`);
      `,
    });

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "./index.ts", "--bytecode", "--format=esm", "--target=bun", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(buildStderr).not.toContain("ESM bytecode requires");
    expect(buildStderr).not.toContain('"await" can only be used');
    expect(buildExit).toBe(0);

    const distDir = join(String(dir), "dist");
    const jsPath = join(distDir, "index.js");
    // Bytecode sidecar is named .js.jsc (same convention as the existing
    // CJS bytecode sidecar — the extension is appended to the full chunk
    // filename, not a substitution of .js).
    const jscPath = join(distDir, "index.js.jsc");

    expect(existsSync(jsPath)).toBe(true);
    expect(existsSync(jscPath)).toBe(true);

    // ESM bytecode header — CJS wrapper must NOT be present.
    const jsContents = readFileSync(jsPath, "utf8");
    expect(jsContents).toContain("// @bun @bytecode");
    expect(jsContents).not.toContain("@bun-cjs");

    // Bytecode should be non-empty.
    expect(readFileSync(jscPath).byteLength).toBeGreaterThan(0);

    // End-to-end: running the bundle must work with top-level await,
    // loading the .jsc sidecar bytecode. Bytecode fails open (a broken
    // sidecar falls back to parsing source), so assert the cache hit.
    await using run = Bun.spawn({
      cmd: [bunExe(), jsPath],
      env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [runStdout, runStderr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(runStderr).toMatch(/\[Disk Cache\].*Cache hit/i);
    expect({ stdout: runStdout.trim(), exitCode: runExit }).toEqual({
      stdout: "Server starting on port 3000",
      exitCode: 0,
    });
  });

  test.concurrent("issue #29286: Bun.build({ bytecode: true, format: 'esm' }) no longer requires compile", async () => {
    using dir = tempDir("29286-api", {
      "entry.ts": `
          const x = await Promise.resolve(42);
          console.log('answer:', x);
        `,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
            const result = await Bun.build({
              entrypoints: ['${join(String(dir), "entry.ts").replace(/\\/g, "\\\\")}'],
              outdir: '${join(String(dir), "dist").replace(/\\/g, "\\\\")}',
              target: 'bun',
              format: 'esm',
              bytecode: true,
            });
            if (!result.success) {
              for (const log of result.logs) console.error(String(log));
              process.exit(1);
            }
            // Normalize separators so the test works on Windows — BuildArtifact.path
            // uses backslashes there.
            console.log('outputs:', result.outputs.map(o => o.path.replaceAll('\\\\', '/').split('/').pop()).sort().join(','));
          `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("ESM bytecode requires");
    // Match on comma-delimited tokens so `entry.js` isn't a false positive
    // for the prefix of `entry.js.jsc`.
    expect(stdout).toMatch(/outputs: (entry\.js),/);
    expect(stdout).toContain("entry.js.jsc");
    expect(exitCode).toBe(0);
  });

  // Two entrypoints sharing an import produce a separate non-entry chunk with
  // its own .jsc sidecar; running an entry loads that chunk at runtime. Covers
  // the multi-chunk ESM bytecode path (code splitting + sidecar load), which the
  // single-file cases above don't reach.
  test.concurrent("issue #29286: shared ESM bytecode chunk loads and runs", async () => {
    using dir = tempDir("29286-split", {
      "shared.ts": `export const value = await Promise.resolve(42);`,
      "a.ts": `import { value } from "./shared.ts"; console.log("a:", value);`,
      "b.ts": `import { value } from "./shared.ts"; console.log("b:", value);`,
    });

    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "./a.ts",
        "./b.ts",
        "--bytecode",
        "--format=esm",
        "--target=bun",
        "--splitting",
        "--outdir=dist",
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("ESM bytecode requires");
    expect(buildExit).toBe(0);

    // A shared chunk (distinct from a.js / b.js) must exist with a .jsc sidecar.
    const distDir = join(String(dir), "dist");
    const entries = readdirSync(distDir);
    const sharedJsc = entries.find(f => f.endsWith(".jsc") && !/^(a|b)\.js\.jsc$/.test(f));
    expect(sharedJsc).toBeDefined();

    // Running the entry loads the shared chunk's .jsc sidecar at runtime.
    // Bytecode fails open, so assert the cache hit.
    await using run = Bun.spawn({
      cmd: [bunExe(), join(distDir, "a.js")],
      env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [runStdout, runStderr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect([...runStderr.matchAll(/\[Disk Cache\] Cache hit/gi)].length).toBeGreaterThanOrEqual(2);
    expect({ stdout: runStdout.trim(), exitCode: runExit }).toEqual({
      stdout: "a: 42",
      exitCode: 0,
    });
  });
});
