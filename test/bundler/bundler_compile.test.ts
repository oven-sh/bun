import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";
import { BundlerTestInput, itBundled as itBundledBase } from "./expectBundled";

// Default to the CLI backend. We intentionally use plain `describe` here
// (not `describe.concurrent`): since the ELF-section inject path was added,
// each `bun build --compile` on Linux reads + rewrites the full executable
// (~500MB for profile builds). Running 20 of these concurrently exhausts CI
// memory/IO and causes subprocess timeouts — see build #40193 failures.
const itBundled = (id: string, opts: BundlerTestInput) => itBundledBase(id, { backend: "cli", ...opts });

describe("bundler", () => {
  itBundled("compile/HelloWorld", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,
    },
    run: { stdout: "Hello, world!" },
  });
  // --footer/--banner are concatenated verbatim (UTF-8). Guard against the
  // standalone module graph treating those bytes as Latin-1, which would
  // print "rÃ©sumÃ©" / "ã\x81\x93ã\x82\x93..." (one Latin-1 char per UTF-8
  // byte) instead of the original codepoints.
  for (const [where, flag] of [
    ["Footer", "--footer"],
    ["Banner", "--banner"],
  ] as const) {
    test(`compile/${where}NonAsciiUTF8`, async () => {
      using dir = tempDir(`compile-${where.toLowerCase()}-nonascii`, {
        "entry.ts": `export const x = 1;`,
      });
      const outfile = join(String(dir), isWindows ? "out.exe" : "out");
      {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            flag,
            `console.log("résumé", "こんにちは");`,
            "./entry.ts",
            "--outfile",
            outfile,
          ],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
      }
      await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("résumé こんにちは\n");
      expect(exitCode).toBe(0);
    });
  }
  itBundled("compile/HelloWorldWithProcessVersionsBun", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        process.exitCode = 1;
        process.versions.bun = "bun!";
        if (process.versions.bun === "bun!") throw new Error("fail");
        if (require("./${process.platform}-${process.arch}.js") === "${Bun.version.replaceAll("-debug", "")}") {
          process.exitCode = 0;
        }
      `,
      [`/${process.platform}-${process.arch}.js`]: "module.exports = process.versions.bun;",
    },
    run: { exitCode: 0 },
  });
  itBundled("compile/HelloWorldWithProcessVersionsBunAPI", {
    compile: true,
    backend: "api",
    outfile: "dist/out",
    files: {
      "/entry.ts": /* js */ `
        import { foo } from "hello:world";
        if (foo !== "bar") throw new Error("fail");
        process.exitCode = 1;
        process.versions.bun = "bun!";
        if (process.versions.bun === "bun!") throw new Error("fail");
        const another = require("./${process.platform}-${process.arch}.js").replaceAll("-debug", "");
        if (another === "${Bun.version.replaceAll("-debug", "")}") {
          process.exitCode = 0;
        }
      `,
      [`/${process.platform}-${process.arch}.js`]: "module.exports = process.versions.bun;",
    },
    run: { exitCode: 0, stdout: "hello world" },
    plugins: [
      {
        name: "hello-world",
        setup(api) {
          api.onResolve({ filter: /hello:world/, namespace: "file" }, args => {
            return {
              path: args.path,
              namespace: "hello",
            };
          });
          api.onLoad({ filter: /.*/, namespace: "hello" }, args => {
            return {
              contents: "export const foo = 'bar'; console.log('hello world');",
              loader: "js",
            };
          });
        },
      },
    ],
  });
  itBundled("compile/HelloWorldBytecode", {
    compile: true,
    bytecode: true,
    files: {
      "/entry.ts": /* js */ `
        console.log("Hello, world!");
      `,
    },
    run: {
      stdout: "Hello, world!",
      stderr: [
        "[Disk Cache] Cache hit for sourceCode",

        // TODO: remove this line once bun:main is removed.
        "[Disk Cache] Cache miss for sourceCode",
      ].join("\n"),
      env: {
        BUN_JSC_verboseDiskCache: "1",
      },
    },
  });

  // `import defer * as ns from "..."` must not break bytecode generation.
  // The bundler inlines the deferred module into the entry chunk (documented
  // out-of-scope limitation — same as esbuild), so the defer semantics are
  // lost in the compiled output; this test verifies that the syntax is
  // accepted by the bundler parser, the resulting source bytecode-compiles
  // cleanly in JSC, and the compiled binary loads from the bytecode cache.
  for (const format of ["cjs", "esm"] as const) {
    itBundled(`compile/ImportDeferBytecode+${format}`, {
      compile: true,
      bytecode: true,
      format,
      files: {
        "/entry.ts": /* js */ `
          import defer * as ns from "./dep.ts";
          console.log("before");
          console.log("value:", ns.value);
        `,
        "/dep.ts": /* js */ `
          console.log("dep evaluated");
          export const value = 42;
        `,
      },
      run: {
        stdout: "dep evaluated\nbefore\nvalue: 42",
        env: {
          BUN_JSC_verboseDiskCache: "1",
        },
        validate({ stderr }) {
          expect(stderr).toContain("[Disk Cache] Cache hit for sourceCode");
        },
      },
    });
  }
  // ESM bytecode test matrix: each scenario × {default, minified} = 2 tests per scenario.
  // With --compile, static imports are inlined into one chunk, but dynamic imports
  // create separate modules in the standalone graph — each with its own bytecode + ModuleInfo.
  const esmBytecodeScenarios: Array<{
    name: string;
    files: Record<string, string>;
    stdout: string;
  }> = [
    {
      name: "HelloWorld",
      files: {
        "/entry.ts": `console.log("Hello, world!");`,
      },
      stdout: "Hello, world!",
    },
    {
      // top-level await is ESM-only; if ModuleInfo or bytecode generation
      // mishandles async modules, this breaks.
      name: "TopLevelAwait",
      files: {
        "/entry.ts": `
          const result = await Promise.resolve("tla works");
          console.log(result);
        `,
      },
      stdout: "tla works",
    },
    {
      // import.meta is ESM-only.
      name: "ImportMeta",
      files: {
        "/entry.ts": `
          console.log(typeof import.meta.url === "string" ? "ok" : "fail");
          console.log(typeof import.meta.dir === "string" ? "ok" : "fail");
        `,
      },
      stdout: "ok\nok",
    },
    {
      // Dynamic import creates a separate module in the standalone graph,
      // exercising per-module bytecode + ModuleInfo.
      name: "DynamicImport",
      files: {
        "/entry.ts": `
          const { value } = await import("./lazy.ts");
          console.log("lazy:", value);
        `,
        "/lazy.ts": `export const value = 42;`,
      },
      stdout: "lazy: 42",
    },
    {
      // Dynamic import of a module that itself uses top-level await.
      // The dynamically imported module is a separate chunk with async
      // evaluation — stresses both ModuleInfo and async bytecode loading.
      name: "DynamicImportTLA",
      files: {
        "/entry.ts": `
          const mod = await import("./async-mod.ts");
          console.log("value:", mod.value);
        `,
        "/async-mod.ts": `export const value = await Promise.resolve(99);`,
      },
      stdout: "value: 99",
    },
    {
      // Multiple dynamic imports: several separate modules in the graph,
      // each with its own bytecode + ModuleInfo.
      name: "MultipleDynamicImports",
      files: {
        "/entry.ts": `
          const [a, b] = await Promise.all([
            import("./mod-a.ts"),
            import("./mod-b.ts"),
          ]);
          console.log(a.value, b.value);
        `,
        "/mod-a.ts": `export const value = "a";`,
        "/mod-b.ts": `export const value = "b";`,
      },
      stdout: "a b",
    },
  ];

  for (const scenario of esmBytecodeScenarios) {
    for (const minify of [false, true]) {
      itBundled(`compile/ESMBytecode+${scenario.name}${minify ? "+minify" : ""}`, {
        compile: true,
        bytecode: true,
        format: "esm",
        ...(minify && {
          minifySyntax: true,
          minifyIdentifiers: true,
          minifyWhitespace: true,
        }),
        files: scenario.files,
        run: { stdout: scenario.stdout },
      });
    }
  }

  // Multi-entry ESM bytecode with Worker (can't be in the matrix — needs
  // entryPointsRaw, outfile, setCwd). Each entry becomes a separate module
  // in the standalone graph with its own bytecode + ModuleInfo.
  itBundled("compile/WorkerBytecodeESM", {
    backend: "cli",
    compile: true,
    bytecode: true,
    format: "esm",
    files: {
      "/entry.ts": /* js */ `
        import {rmSync} from 'fs';
        // Verify we're not just importing from the filesystem
        rmSync("./worker.ts", {force: true});
        console.log("Hello, world!");
        new Worker("./worker.ts");
      `,
      "/worker.ts": /* js */ `
        console.log("Worker loaded!");
    `.trim(),
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    run: {
      stdout: "Hello, world!\nWorker loaded!\n",
      file: "dist/out",
      setCwd: true,
    },
  });
  // https://github.com/oven-sh/bun/issues/8697
  itBundled("compile/EmbeddedFileOutfile", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import bar from './foo.file' with {type: "file"};
        if ((await Bun.file(bar).text()).trim() !== "abcd") throw "fail";
        console.log("Hello, world!");
      `,
      "/foo.file": /* js */ `
      abcd
    `.trim(),
    },
    outfile: "dist/out",
    run: { stdout: "Hello, world!" },
  });
  itBundled("compile/WorkerRelativePathNoExtension", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import {rmSync} from 'fs';
        // Verify we're not just importing from the filesystem
        rmSync("./worker.ts", {force: true});

        console.log("Hello, world!");
        new Worker("./worker");
      `,
      "/worker.ts": /* js */ `
        console.log("Worker loaded!");
    `.trim(),
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    run: { stdout: "Hello, world!\nWorker loaded!\n", file: "dist/out", setCwd: true },
  });
  itBundled("compile/WorkerRelativePathTSExtension", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import {rmSync} from 'fs';
        // Verify we're not just importing from the filesystem
        rmSync("./worker.ts", {force: true});
        console.log("Hello, world!");
        new Worker("./worker.ts");
      `,
      "/worker.ts": /* js */ `
        console.log("Worker loaded!");
    `.trim(),
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    run: { stdout: "Hello, world!\nWorker loaded!\n", file: "dist/out", setCwd: true },
  });
  itBundled("compile/WorkerRelativePathTSExtensionBytecode", {
    backend: "cli",
    compile: true,
    bytecode: true,
    files: {
      "/entry.ts": /* js */ `
        import {rmSync} from 'fs';
        // Verify we're not just importing from the filesystem
        rmSync("./worker.ts", {force: true});
        console.log("Hello, world!");
        new Worker("./worker.ts");
      `,
      "/worker.ts": /* js */ `
        console.log("Worker loaded!");
    `.trim(),
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    run: {
      stdout: "Hello, world!\nWorker loaded!\n",
      file: "dist/out",
      setCwd: true,
      env: {
        BUN_JSC_verboseDiskCache: "1",
      },
      // The main thread and the worker each report one hit and one miss (the
      // miss is bun:main). The two threads interleave, so only the multiset of
      // lines is stable, not their order.
      validate({ stderr }) {
        const lines = stderr
          .split("\n")
          .map(line => line.trim())
          .filter(line => line.startsWith("[Disk Cache]"))
          .sort();
        expect(lines).toEqual([
          "[Disk Cache] Cache hit for sourceCode",
          "[Disk Cache] Cache hit for sourceCode",
          // TODO: remove these two lines once bun:main is removed.
          "[Disk Cache] Cache miss for sourceCode",
          "[Disk Cache] Cache miss for sourceCode",
        ]);
      },
    },
  });
  itBundled("compile/Bun.embeddedFiles", {
    compile: true,
    // TODO: this shouldn't be necessary, or we should add a map aliasing files.
    assetNaming: "[name].[ext]",

    files: {
      "/entry.ts": /* js */ `
      import {rmSync} from 'fs';
      import {createRequire} from 'module';
        import './foo.file';
        import './1.embed';
        import './2.embed';
        rmSync('./foo.file', {force: true});
        rmSync('./1.embed', {force: true});
        rmSync('./2.embed', {force: true});
        const names = {
          "1.embed": "1.embed",
          "2.embed": "2.embed",
          "foo.file": "foo.file",
        }
        // We want to verify it omits source code.
        for (let f of Bun.embeddedFiles) {
          const name = f.name;
          if (!names[name]) {
            throw new Error("Unexpected embedded file: " + name);
          }
        }

        if (Bun.embeddedFiles.length !== 3) throw "fail";
        if ((await Bun.file(createRequire(import.meta.url).resolve('./1.embed')).text()).trim() !== "abcd") throw "fail";
        if ((await Bun.file(createRequire(import.meta.url).resolve('./2.embed')).text()).trim() !== "abcd") throw "fail";
        if ((await Bun.file(createRequire(import.meta.url).resolve('./foo.file')).text()).trim() !== "abcd") throw "fail";
        if ((await Bun.file(import.meta.require.resolve('./1.embed')).text()).trim() !== "abcd") throw "fail";
        if ((await Bun.file(import.meta.require.resolve('./2.embed')).text()).trim() !== "abcd") throw "fail";
        if ((await Bun.file(import.meta.require.resolve('./foo.file')).text()).trim() !== "abcd") throw "fail";
        console.log("Hello, world!");
      `,
      "/1.embed": /* js */ `
      abcd
    `.trim(),
      "/2.embed": /* js */ `
      abcd
    `.trim(),
      "/foo.file": /* js */ `
      abcd
    `.trim(),
    },
    outfile: "dist/out",
    run: { stdout: "Hello, world!", setCwd: true },
  });
  itBundled("compile/Bun.isStandaloneExecutable", {
    compile: true,
    assetNaming: "[name].[ext]",
    files: {
      "/entry.ts": /* js */ `
        import { heapStats } from "bun:jsc";
        import "./asset.file";

        const blobCount = () => heapStats().objectTypeCounts.Blob ?? 0;

        // Reading isStandaloneExecutable must not materialize embedded files as Blobs.
        Bun.gc(true);
        const baseline = blobCount();
        if (Bun.isStandaloneExecutable !== true) {
          throw new Error("expected Bun.isStandaloneExecutable === true, got " + Bun.isStandaloneExecutable);
        }
        const afterRead = blobCount();
        if (afterRead !== baseline) {
          throw new Error("reading Bun.isStandaloneExecutable changed Blob count (" + baseline + " -> " + afterRead + ")");
        }

        // Accessing embeddedFiles allocates a Blob per embedded asset; if it did not,
        // the afterRead === baseline check above would be vacuous.
        const files = Bun.embeddedFiles;
        if (files.length !== 1) throw new Error("expected 1 embedded file, got " + files.length);
        const afterEmbedded = blobCount();
        if (afterEmbedded <= baseline) {
          throw new Error("expected Blob count to increase after reading Bun.embeddedFiles (" + baseline + " -> " + afterEmbedded + ")");
        }
        console.log("ok", JSON.stringify({ baseline, afterRead, afterEmbedded }));
      `,
      "/asset.file": "abcd",
    },
    outfile: "dist/out",
    run: { stdout: /^ok \{"baseline":\d+,"afterRead":\d+,"afterEmbedded":\d+\}$/ },
  });
  test("Bun.isStandaloneExecutable is false when not compiled", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(JSON.stringify({ value: Bun.isStandaloneExecutable, type: typeof Bun.isStandaloneExecutable }))`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: `{"value":false,"type":"boolean"}`,
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });
  });
  itBundled("compile/ResolveEmbeddedFileOutfile", {
    compile: true,
    // TODO: this shouldn't be necessary, or we should add a map aliasing files.
    assetNaming: "[name].[ext]",

    files: {
      "/entry.ts": /* js */ `
      import {rmSync} from 'fs';
        import './foo.file';
        rmSync('./foo.file', {force: true});
        if ((await Bun.file(import.meta.require.resolve('./foo.file')).text()).trim() !== "abcd") throw "fail";
        console.log("Hello, world!");
      `,
      "/foo.file": /* js */ `
      abcd
    `.trim(),
    },
    outfile: "dist/out",
    run: { stdout: "Hello, world!" },
  });
  itBundled("compile/pathToFileURLWorks", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import {pathToFileURL, fileURLToPath} from 'bun';
        console.log(pathToFileURL(import.meta.path).href + " " + fileURLToPath(import.meta.url));
        if (fileURLToPath(import.meta.url) !== import.meta.path) throw "fail";
        if (pathToFileURL(import.meta.path).href !== import.meta.url) throw "fail";
      `,
    },
    run: {
      stdout:
        process.platform !== "win32"
          ? `file:///$bunfs/root/out /$bunfs/root/out`
          : `file:///B:/~BUN/root/out B:\\~BUN\\root\\out`,
      setCwd: true,
    },
  });
  itBundled("compile/VariousBunAPIs", {
    todo: isWindows, // TODO
    compile: true,
    files: {
      "/entry.ts": `
        // testing random features of bun
        import 'node:process';
        import 'process';
        import 'fs';

        import { Database } from "bun:sqlite";
        import { serve } from 'bun';
        import { getRandomSeed } from 'bun:jsc';
        const db = new Database("test.db");
        const query = db.query(\`select "Hello world" as message\`);
        if (query.get().message !== "Hello world") throw "fail from sqlite";
        const icon = new Uint8Array(256);
        for (let i = 0; i < 256; i++) icon[i] = i;
        if(icon.byteLength < 100) throw "fail from icon";
        if (typeof getRandomSeed() !== 'number') throw "fail from bun:jsc";
        const server = serve({
          fetch() {
            return new Response("Hello world");
          },
          port: 0,
        });
        const res = await fetch(\`http://\${server.hostname}:\${server.port}\`);
        if (res.status !== 200) throw "fail from server";
        if (await res.text() !== "Hello world") throw "fail from server";
        server.stop();
        console.log("ok");
      `,
    },
    run: { stdout: "ok" },
  });

  const additionalOptionsIters: Array<{
    bytecode?: boolean;
    minify?: boolean;
    format: "cjs" | "esm";
  }> = [
    { bytecode: true, minify: true, format: "cjs" },
    { bytecode: true, format: "esm" },
    { bytecode: true, minify: true, format: "esm" },
    { format: "cjs" },
    { format: "cjs", minify: true },
    { format: "esm" },
    { format: "esm", minify: true },
  ];

  for (const additionalOptions of additionalOptionsIters) {
    const { bytecode = false, format, minify = false } = additionalOptions;
    const NODE_ENV = minify ? "'production'" : undefined;
    itBundled("compile/ReactSSR" + (bytecode ? "+bytecode" : "") + "+" + format + (minify ? "+minify" : ""), {
      install: ["react@19.2.0-canary-b94603b9-20250513", "react-dom@19.2.0-canary-b94603b9-20250513"],
      format,
      minifySyntax: minify,
      minifyIdentifiers: minify,
      minifyWhitespace: minify,
      define: NODE_ENV ? { "process.env.NODE_ENV": NODE_ENV } : undefined,
      files: {
        "/entry.tsx": /* tsx */ `
        import React from "react";
        import { renderToReadableStream } from "react-dom/server";

        const headers = {
          headers: {
            "Content-Type": "text/html",
          },
        };

        const App = () => (
          <html>
            <body>
              <h1>Hello World</h1>
              <p>This is an example.</p>
            </body>
          </html>
        );

        async function main() {
          const port = 0;
          using server = Bun.serve({
            port,
            async fetch(req) {
              return new Response(await renderToReadableStream(<App />), headers);
            },
          });
          const res = await fetch(server.url);
          if (res.status !== 200) throw "status error";
          console.log(await res.text());
        }

        main();
      `,
      },
      run: {
        stdout: "<!DOCTYPE html><html><head></head><body><h1>Hello World</h1><p>This is an example.</p></body></html>",
        stderr: bytecode
          ? "[Disk Cache] Cache hit for sourceCode\n[Disk Cache] Cache miss for sourceCode\n"
          : undefined,
        env: bytecode
          ? {
              BUN_JSC_verboseDiskCache: "1",
            }
          : undefined,
      },
      compile: true,
      bytecode,
    });
  }
  itBundled("compile/DynamicRequire", {
    files: {
      "/entry.tsx": /* tsx */ `
        const req = (x) => require(x);
        const y = req('commonjs');
        const z = req('esm').default;
        console.log(JSON.stringify([w, x, y, z]));
        module.exports = null;
      `,
      "/node_modules/commonjs/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/esm/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/other/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/other-esm/index.js": "throw new Error('Must be runtime import.')",
    },
    runtimeFiles: {
      "/node_modules/commonjs/index.js": "module.exports = 2; require('other');",
      "/node_modules/esm/index.js": "import 'other-esm'; export default 3;",
      "/node_modules/other/index.js": "globalThis.x = 1;",
      "/node_modules/other-esm/index.js": "globalThis.w = 0;",
    },
    run: {
      stdout: "[0,1,2,3]",
      setCwd: true,
    },
    compile: true,
  });
  itBundled("compile/DynamicImport", {
    files: {
      "/entry.tsx": /* tsx */ `
        import 'static';
        const imp = (x) => import(x).then(x => x.default);
        const y = await imp('commonjs');
        const z = await imp('esm');
        console.log(JSON.stringify([w, x, y, z]));
      `,
      "/node_modules/static/index.js": "'use strict';",
      "/node_modules/commonjs/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/esm/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/other/index.js": "throw new Error('Must be runtime import.')",
      "/node_modules/other-esm/index.js": "throw new Error('Must be runtime import.')",
    },
    runtimeFiles: {
      "/node_modules/commonjs/index.js": "module.exports = 2; require('other');",
      "/node_modules/esm/index.js": "import 'other-esm'; export default 3;",
      "/node_modules/other/index.js": "globalThis.x = 1;",
      "/node_modules/other-esm/index.js": "globalThis.w = 0;",
    },
    run: {
      stdout: "[0,1,2,3]",
      setCwd: true,
    },
    compile: true,
  });
  // see comment in `usePackageManager` for why this is a test
  itBundled("compile/NoAutoInstall", {
    files: {
      "/entry.tsx": /* tsx */ `
        const req = (x) => require(x);
        console.log(req('express'));
      `,
    },
    run: {
      error: 'Cannot find package "express"',
      setCwd: true,
    },
    compile: true,
  });
  itBundled("compile/CanRequireLocalPackages", {
    files: {
      "/entry.tsx": /* tsx */ `
        const req = (x) => require(x);
        console.log(req('react/package.json').version);
      `,
    },
    run: {
      stdout: require("react/package.json").version,
      setCwd: false,
    },
    compile: true,
  });
  for (const minify of [true, false] as const) {
    itBundled("compile/platform-specific-binary" + (minify ? "-minify" : ""), {
      minifySyntax: minify,
      target: "bun",
      compile: true,
      files: {
        "/entry.ts": /* js */ `
        await import(\`./platform.\${process.platform}.\${process.arch}.js\`);
    `,
        [`/platform.${process.platform}.${process.arch}.js`]: `console.log("${process.platform}", "${process.arch}");`,
      },
      run: { stdout: `${process.platform} ${process.arch}` },
    });
    for (const sourceMap of ["external", "inline", "none"] as const) {
      // https://github.com/oven-sh/bun/issues/10344
      itBundled("compile/10344+sourcemap=" + sourceMap + (minify ? "+minify" : ""), {
        minifyIdentifiers: minify,
        minifySyntax: minify,
        minifyWhitespace: minify,
        target: "bun",
        sourceMap,
        compile: true,
        files: {
          "/entry.ts": /* js */ `
        import big from './generated.big.binary' with {type: "file"};
        import small from './generated.small.binary' with {type: "file"};
        import fs from 'fs';
        fs.readFileSync(big).toString("hex");
        await Bun.file(big).arrayBuffer();
        fs.readFileSync(small).toString("hex");
        if ((await fs.promises.readFile(small)).length !== 31) throw "fail readFile";
        if (fs.statSync(small).size !== 31) throw "fail statSync";
        if (fs.statSync(big).size !== (4096 + (32 - 2))) throw "fail statSync";
        if (((await fs.promises.stat(big)).size) !== (4096 + (32 - 2))) throw "fail stat";
        await Bun.file(small).arrayBuffer();
        console.log("PASS");
      `,
          "/generated.big.binary": (() => {
            // make sure the size is not divisible by 32
            const buffer = new Uint8ClampedArray(4096 + (32 - 2));
            for (let i = 0; i < buffer.length; i++) {
              buffer[i] = i;
            }
            return buffer;
          })(),
          "/generated.small.binary": (() => {
            // make sure the size is less than 32
            const buffer = new Uint8ClampedArray(31);
            for (let i = 0; i < buffer.length; i++) {
              buffer[i] = i;
            }
            return buffer;
          })(),
        },
        run: { stdout: "PASS" },
      });
    }
  }
  itBundled("compile/EmbeddedSqlite", {
    compile: true,
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
  itBundled("compile/sqlite-file", {
    compile: true,
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
  itBundled("compile/Utf8", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log(JSON.stringify({\u{6211}: "\u{6211}"}));
      `,
    },
    run: { stdout: '{"\u{6211}":"\u{6211}"}' },
  });
  itBundled("compile/ImportMetaMain", {
    compile: true,
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        // test toString on function to observe what the inlined value was
        console.log((() => import.meta.main).toString().includes('true'));
        console.log((() => !import.meta.main).toString().includes('false'));
        console.log((() => !!import.meta.main).toString().includes('true'));
        console.log((() => require.main == module).toString().includes('true'));
        console.log((() => require.main === module).toString().includes('true'));
        console.log((() => require.main !== module).toString().includes('false'));
        console.log((() => require.main !== module).toString().includes('false'));
      `,
    },
    run: { stdout: new Array(7).fill("true").join("\n") },
  });
  itBundled("compile/SourceMap", {
    target: "bun",
    compile: true,
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
    sourceMap: "external",
    onAfterBundle(api) {
      rmSync(api.join("entry.ts"), {}); // Hide the source files for errors
    },
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
  itBundled("compile/SourceMapBigFile", {
    target: "bun",
    compile: true,
    files: {
      "/entry.ts": /* js */ `import * as ReactDom from ${JSON.stringify(require.resolve("react-dom/server"))};

// this file has comments and weird whitespace, intentionally
// to make it obvious if sourcemaps were generated and mapped properly
if           (true) code();
function code() {
  // hello world
          throw   new
    Error("Hello World");
}

console.log(ReactDom);`,
    },
    sourceMap: "external",
    onAfterBundle(api) {
      rmSync(api.join("entry.ts"), {}); // Hide the source files for errors
    },
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toStartWith(
          `3 | // this file has comments and weird whitespace, intentionally
4 | // to make it obvious if sourcemaps were generated and mapped properly
5 | if           (true) code();
6 | function code() {
7 |   // hello world
8 |           throw   new
                      ^
error: Hello World`,
        );
        expect(stderr).toInclude("entry.ts:8:19");
      },
    },
  });
  itBundled("compile/BunBeBunEnvVar", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log("This is compiled code");
        console.log(JSON.stringify({ isStandaloneExecutable: Bun.isStandaloneExecutable }));
      `,
    },
    run: [
      {
        stdout: `This is compiled code\n{"isStandaloneExecutable":true}`,
      },
      {
        env: { BUN_BE_BUN: "1" },
        validate({ stdout }) {
          expect(stdout).not.toContain("This is compiled code");
        },
      },
      {
        // With BUN_BE_BUN=1 the compiled executable behaves like the plain `bun` CLI:
        // the embedded standalone module graph is never loaded, so Bun.isStandaloneExecutable
        // must be false even though the binary itself contains one.
        env: { BUN_BE_BUN: "1" },
        args: [
          "-e",
          `console.log(JSON.stringify({ isStandaloneExecutable: Bun.isStandaloneExecutable, type: typeof Bun.isStandaloneExecutable }))`,
        ],
        stdout: `{"isStandaloneExecutable":false,"type":"boolean"}`,
      },
    ],
  });

  test("does not crash", async () => {
    const dir = tempDirWithFiles("bundler-compile-shadcn", {
      "frontend.tsx": `console.log("Hello, world!");`,
      "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bun + React</title>
    <script type="module" src="./frontend.tsx" async></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
        `,
      "index.tsx": `import { serve } from "bun";
import index from "./index.html";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: "LOL",
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

`,
    });

    // Step 2: Run bun build with compile, minify, sourcemap, and bytecode
    await Bun.$`${bunExe()} build ./index.tsx --compile --minify --sourcemap --bytecode`
      .cwd(dir)
      .env(bunEnv)
      .throws(true);
  }, 30_000);

  // Verify ESM bytecode is actually loaded from the cache at runtime, not just generated.
  // Uses regex matching on stderr (not itBundled) since we don't know the exact
  // number of cache hit/miss lines for ESM standalone.
  test("ESM bytecode cache is used at runtime", async () => {
    const ext = isWindows ? ".exe" : "";
    using dir = tempDir("esm-bytecode-cache", {
      "entry.js": `console.log("esm bytecode loaded");`,
    });

    const outfile = join(String(dir), `app${ext}`);

    // Build with ESM + bytecode
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--format=esm",
        join(String(dir), "entry.js"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    // Run with verbose disk cache to verify bytecode is loaded
    await using exe = Bun.spawn({
      cmd: [outfile],
      env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exeStdout, exeStderr, exeExitCode] = await Promise.all([exe.stdout.text(), exe.stderr.text(), exe.exited]);

    expect(exeStdout).toContain("esm bytecode loaded");
    expect(exeStderr).toMatch(/\[Disk Cache\].*Cache hit/i);
    expect(exeExitCode).toBe(0);
  }, 30_000);

  // When compiling with 8+ entry points, the main entry point should still run correctly.
  test("compile with 8+ entry points runs main entry correctly", async () => {
    const dir = tempDirWithFiles("compile-many-entries", {
      "app.js": `console.log("IT WORKS");`,
      "assets/file-1": "",
      "assets/file-2": "",
      "assets/file-3": "",
      "assets/file-4": "",
      "assets/file-5": "",
      "assets/file-6": "",
      "assets/file-7": "",
      "assets/file-8": "",
    });

    await Bun.$`${bunExe()} build --compile app.js assets/* --outfile app`.cwd(dir).env(bunEnv).throws(true);

    const result = await Bun.$`./app`.cwd(dir).env(bunEnv).nothrow();
    expect(result.stdout.toString().trim()).toBe("IT WORKS");
  }, 30_000);
});

test("compile --compile-executable-path rejects a Mach-O template whose __BUN segment offsets exceed the file bounds", async () => {
  // `bun build --compile --target=bun-darwin-*` patches the application bundle into the
  // __BUN,__bun section of the base executable named by --compile-executable-path. The
  // segment/section offsets in that file's load commands must be validated against the
  // actual file size before they are used as memmove destinations.
  const MH_MAGIC_64 = 0xfeedfacf;
  const CPU_TYPE_X86_64 = 0x01000007;
  const MH_EXECUTE = 2;
  const LC_SEGMENT_64 = 0x19;

  // Minimal Mach-O "base executable": a __BUN segment with one __bun section followed by a
  // __LINKEDIT segment. `bunFileOff`/`bunFileSize` are where the load commands claim the
  // __BUN data lives; `fileSize` is how many bytes the template actually contains.
  function machoTemplate(bunFileOff: number, bunFileSize = 0x4000, fileSize = 0x8100): Buffer {
    const segCmdSize = 72; // sizeof(segment_command_64)
    const sectSize = 80; // sizeof(section_64)
    const sizeofcmds = segCmdSize + sectSize + segCmdSize;
    const buf = Buffer.alloc(fileSize);
    const writeName = (off: number, name: string) => buf.write(name, off, 16, "latin1");

    // mach_header_64
    buf.writeUInt32LE(MH_MAGIC_64, 0);
    buf.writeInt32LE(CPU_TYPE_X86_64, 4);
    buf.writeInt32LE(3, 8); // cpusubtype
    buf.writeUInt32LE(MH_EXECUTE, 12);
    buf.writeUInt32LE(2, 16); // ncmds
    buf.writeUInt32LE(sizeofcmds, 20);

    // LC_SEGMENT_64 __BUN with one section
    let o = 32;
    buf.writeUInt32LE(LC_SEGMENT_64, o);
    buf.writeUInt32LE(segCmdSize + sectSize, o + 4); // cmdsize
    writeName(o + 8, "__BUN");
    buf.writeBigUInt64LE(0x1_0000_4000n, o + 24); // vmaddr
    buf.writeBigUInt64LE(BigInt(bunFileSize), o + 32); // vmsize
    buf.writeBigUInt64LE(BigInt(bunFileOff), o + 40); // fileoff
    buf.writeBigUInt64LE(BigInt(bunFileSize), o + 48); // filesize
    buf.writeInt32LE(7, o + 56); // maxprot
    buf.writeInt32LE(3, o + 60); // initprot
    buf.writeUInt32LE(1, o + 64); // nsects

    // section_64 __bun
    o += segCmdSize;
    writeName(o, "__bun");
    writeName(o + 16, "__BUN");
    buf.writeBigUInt64LE(0x1_0000_4000n, o + 32); // addr
    buf.writeBigUInt64LE(BigInt(bunFileSize), o + 40); // size
    buf.writeUInt32LE(bunFileOff, o + 48); // offset
    buf.writeUInt32LE(14, o + 52); // align = 2^14

    // LC_SEGMENT_64 __LINKEDIT
    o += sectSize;
    buf.writeUInt32LE(LC_SEGMENT_64, o);
    buf.writeUInt32LE(segCmdSize, o + 4);
    writeName(o + 8, "__LINKEDIT");
    buf.writeBigUInt64LE(0x1_0001_0000n, o + 24); // vmaddr
    buf.writeBigUInt64LE(0x1000n, o + 32); // vmsize
    buf.writeBigUInt64LE(BigInt(bunFileOff + bunFileSize), o + 40); // fileoff (right after __BUN)
    buf.writeBigUInt64LE(0x100n, o + 48); // filesize
    buf.writeInt32LE(1, o + 56); // maxprot
    buf.writeInt32LE(1, o + 60); // initprot

    return buf;
  }

  using dir = tempDir("compile-macho-template-bounds", {
    "entry.js": `console.log("compiled-from-template");`,
  });
  const cwd = String(dir);

  for (const [name, bytes, wantErr] of [
    // __BUN fileoff points 1 GiB past the end of the 33 KB file.
    ["fileoff-past-eof", machoTemplate(0x40000000), "OffsetOutOfRange"],
    // __BUN filesize (32 KB) exceeds the 256-byte file: the bounds check must reject this
    // before the growth `reserve()` (which would otherwise see a negative size_diff).
    ["filesize-past-eof", machoTemplate(0, 0x8000, 256), "OffsetOutOfRange"],
    // __BUN filesize (32 KB) is in-bounds but larger than the 16 KB aligned bundle slot;
    // write_section only grows, so a template that would require shrinking is rejected.
    ["filesize-needs-shrink", machoTemplate(0x4000, 0x8000, 0xc100), "InvalidObject"],
  ] as const) {
    const badTemplate = join(cwd, `template-${name}`);
    await Bun.write(badTemplate, bytes);
    const outBad = join(cwd, `out-${name}`);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-darwin-x64",
        "--compile-executable-path",
        badTemplate,
        join(cwd, "entry.js"),
        "--outfile",
        outBad,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The invalid template must be reported as a clean error...
    expect({ name, stderr }).toEqual({ name, stderr: expect.stringContaining(wantErr) });
    // ...no output executable is produced...
    expect(await Bun.file(outBad).exists()).toBe(false);
    // ...and the build exits with a normal failure code instead of crashing.
    expect(exitCode).toBe(1);
  }

  // The same template with in-bounds offsets is still accepted.
  const goodTemplate = join(cwd, "template-good");
  await Bun.write(goodTemplate, machoTemplate(0x4000));
  const outGood = join(cwd, "out-good");
  {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-darwin-x64",
        "--compile-executable-path",
        goodTemplate,
        join(cwd, "entry.js"),
        "--outfile",
        outGood,
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("OffsetOutOfRange");
    const outBytes = Buffer.from(await Bun.file(outGood).arrayBuffer());
    expect(outBytes.includes("compiled-from-template")).toBe(true);
    expect(exitCode).toBe(0);
  }
}, 60_000);
