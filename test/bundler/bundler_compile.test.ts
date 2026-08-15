import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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
    run: { stdout: "Hello, world!", stderr: "" },
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
    {
      // When the re-exporting file is inlined into the chunk, `export * as ns from`
      // and `export { x } from` an external module are rewritten into imports. The
      // chunk's module record is built by the bundler (JSC does not parse bytecode
      // modules), so it must list these imports too; otherwise `fs` hits a TDZ
      // ReferenceError and `rfs` is undefined.
      name: "ReExportExternalFromInlinedModule",
      files: {
        "/entry.ts": `
          import { fs, rfs } from "./reexports.ts";
          console.log(typeof fs.readFileSync, typeof rfs);
        `,
        "/reexports.ts": `
          export * as fs from "node:fs";
          export { readFileSync as rfs } from "node:fs";
        `,
      },
      stdout: "function function",
    },
    {
      // Same re-exports on the entry point itself: `export * from` is printed
      // verbatim and needs a star export entry, the other two become imports that
      // the entry's `export { ... }` tail must resolve back to. The debug build
      // cross-checks the record against JSC's parser and refuses to start the
      // binary when they differ.
      name: "ReExportExternalFromEntryPoint",
      files: {
        "/entry.ts": `
          export * from "node:path";
          export * as fs from "node:fs";
          export { readFileSync as rfs } from "node:fs";
          console.log("entry ran");
        `,
      },
      stdout: "entry ran",
    },
    {
      // A file mixing `import` with `module.exports` is wrapped in __commonJS();
      // its external imports are hoisted out of the wrapper and still have to be
      // in the module record, otherwise `join` is not defined at runtime.
      name: "ExternalImportInCommonJSWrapper",
      files: {
        "/entry.ts": `
          import mixed from "./mixed.js";
          console.log(typeof mixed.join);
        `,
        "/mixed.js": `
          import { join } from "node:path";
          module.exports = { join };
        `,
      },
      stdout: "function",
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
  // A second CommonJS entry point that is only reached through a runtime
  // require() must load from the embedded module graph (with its bytecode,
  // when built with --bytecode) rather than the filesystem.
  for (const bytecode of [false, true]) {
    itBundled("compile/RuntimeRequireEmbeddedCJS" + (bytecode ? "+bytecode" : ""), {
      backend: "cli",
      compile: true,
      bytecode,
      format: "cjs",
      files: {
        "/entry.js": /* js */ `
          const { rmSync } = require("fs");
          rmSync("./second.js", { force: true });
          const specifier = "./second" + ".js";
          const second = require(specifier);
          console.log(second.greeting, require(specifier) === second);
        `,
        "/second.js": /* js */ `
          module.exports = { greeting: "hello from second" };
        `,
      },
      entryPointsRaw: ["./entry.js", "./second.js"],
      outfile: "dist/out",
      run: {
        stdout: "hello from second true",
        stderr: bytecode
          ? "[Disk Cache] Cache hit for sourceCode\n[Disk Cache] Cache hit for sourceCode\n[Disk Cache] Cache miss for sourceCode\n"
          : undefined,
        env: bytecode ? { BUN_JSC_verboseDiskCache: "1" } : undefined,
        file: "dist/out",
        setCwd: true,
      },
    });
  }
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
    await using dir = tempDir("bundler-compile-shadcn", {
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
    await using dir = tempDir("compile-many-entries", {
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

// `bun build --compile --target=bun-linux-*` appends the application bundle to the base
// executable named by --compile-executable-path. To do that it walks the template's program
// header table, section header table and .shstrtab, patches the .bun section and rewrites a
// Nix store PT_INTERP. The templates below are the smallest ELF64 files with that shape:
//
//   [ehdr][phdrs][.shstrtab][.interp?][.bun (8 bytes)]   the writable PT_LOAD's file image
//   [pad][section headers: null, .shstrtab, .bun, .interp?]
//
// Every field a `corruption` overrides is one the writer reads from the (arbitrary) template.
const ELF = {
  EHDR: 64,
  PHDR: 56,
  SHDR: 64,
  PT_LOAD: 1,
  PT_INTERP: 3,
  SHT_PROGBITS: 1,
  SHT_STRTAB: 3,
  VADDR: 0x400000n,
  U64_MAX: (1n << 64n) - 1n,
};

interface ElfTemplateOptions {
  interp?: string; // adds a PT_INTERP holding this path and a matching .interp section
  interpOffset?: bigint; // corrupts that PT_INTERP's p_offset
  bunOffset?: bigint; // corrupts .bun's sh_offset
  phoff?: bigint; // e_phoff
  shoff?: bigint; // e_shoff
  shstrndx?: number; // e_shstrndx
  shstrtabOffset?: bigint; // .shstrtab's sh_offset
  loadFilesz?: bigint; // p_filesz of the writable PT_LOAD
  loadMemsz?: bigint; // p_memsz of the writable PT_LOAD
  pad?: number; // zero bytes between the PT_LOAD's file image and the section header table
}

function elfTemplate(o: ElfTemplateOptions = {}): Buffer {
  const { EHDR, PHDR, SHDR, VADDR } = ELF;
  const interp = o.interp === undefined ? null : Buffer.from(o.interp + "\0", "latin1");
  const phnum = interp ? 2 : 1;
  const shnum = interp ? 4 : 3;
  const shstrtab = Buffer.from("\0.shstrtab\0.bun\0.interp\0", "latin1");
  const shstrtabOff = EHDR + PHDR * phnum;
  const interpOff = shstrtabOff + shstrtab.length;
  const bunOff = (interpOff + (interp?.length ?? 0) + 7) & ~7;
  const loadEnd = bunOff + 8;
  const shoff = (loadEnd + (o.pad ?? 0) + 7) & ~7;
  const buf = Buffer.alloc(shoff + SHDR * shnum);

  buf.write("\x7fELF", 0, "latin1");
  buf[4] = 2; // ELFCLASS64
  buf[5] = 1; // ELFDATA2LSB
  buf[6] = 1; // EV_CURRENT
  buf.writeUInt16LE(2, 16); // e_type = ET_EXEC
  buf.writeUInt16LE(62, 18); // e_machine = EM_X86_64
  buf.writeUInt32LE(1, 20); // e_version
  buf.writeBigUInt64LE(VADDR, 24); // e_entry
  buf.writeBigUInt64LE(o.phoff ?? BigInt(EHDR), 32); // e_phoff
  buf.writeBigUInt64LE(o.shoff ?? BigInt(shoff), 40); // e_shoff
  buf.writeUInt16LE(EHDR, 52); // e_ehsize
  buf.writeUInt16LE(PHDR, 54); // e_phentsize
  buf.writeUInt16LE(phnum, 56); // e_phnum
  buf.writeUInt16LE(SHDR, 58); // e_shentsize
  buf.writeUInt16LE(shnum, 60); // e_shnum
  buf.writeUInt16LE(o.shstrndx ?? 1, 62); // e_shstrndx

  const phdr = (i: number, type: number, flags: number, offset: bigint, filesz: bigint, memsz: bigint) => {
    const p = EHDR + i * PHDR;
    buf.writeUInt32LE(type, p);
    buf.writeUInt32LE(flags, p + 4);
    buf.writeBigUInt64LE(offset, p + 8);
    buf.writeBigUInt64LE(BigInt.asUintN(64, VADDR + offset), p + 16); // p_vaddr
    buf.writeBigUInt64LE(BigInt.asUintN(64, VADDR + offset), p + 24); // p_paddr
    buf.writeBigUInt64LE(filesz, p + 32);
    buf.writeBigUInt64LE(memsz, p + 40);
    buf.writeBigUInt64LE(0x1000n, p + 48); // p_align
  };
  const PF_R = 4;
  const PF_W = 2;
  phdr(0, ELF.PT_LOAD, PF_R | PF_W, 0n, o.loadFilesz ?? BigInt(loadEnd), o.loadMemsz ?? BigInt(loadEnd));
  if (interp) {
    const size = BigInt(interp.length);
    phdr(1, ELF.PT_INTERP, PF_R, o.interpOffset ?? BigInt(interpOff), size, size);
    interp.copy(buf, interpOff);
  }

  shstrtab.copy(buf, shstrtabOff);

  const shdr = (i: number, name: number, type: number, alloc: boolean, offset: bigint, size: bigint) => {
    const s = shoff + i * SHDR;
    buf.writeUInt32LE(name, s);
    buf.writeUInt32LE(type, s + 4);
    buf.writeBigUInt64LE(alloc ? 2n : 0n, s + 8); // sh_flags = SHF_ALLOC
    buf.writeBigUInt64LE(alloc ? VADDR + offset : 0n, s + 16); // sh_addr
    buf.writeBigUInt64LE(offset, s + 24);
    buf.writeBigUInt64LE(size, s + 32);
    buf.writeBigUInt64LE(1n, s + 48); // sh_addralign
  };
  shdr(1, 1, ELF.SHT_STRTAB, false, o.shstrtabOffset ?? BigInt(shstrtabOff), BigInt(shstrtab.length));
  shdr(2, 11, ELF.SHT_PROGBITS, true, BigInt(bunOff), 8n);
  // Corrupt only sh_offset: sh_addr still has to fall inside the writable PT_LOAD for the
  // writer to get as far as using the offset.
  if (o.bunOffset !== undefined) buf.writeBigUInt64LE(o.bunOffset, shoff + 2 * SHDR + 24);
  if (interp) shdr(3, 16, ELF.SHT_PROGBITS, true, BigInt(interpOff), BigInt(interp.length));
  return buf;
}

/** PT_INTERP and the `.interp` section header as written to a compiled output. */
function readElfInterp(buf: Buffer): { interp: string; p_filesz: number; sh_size: number | null } {
  const { PHDR, SHDR } = ELF;
  const cstr = (offset: number, size: number) => {
    const bytes = buf.subarray(offset, offset + size);
    const nul = bytes.indexOf(0);
    return bytes.subarray(0, nul === -1 ? bytes.length : nul).toString("latin1");
  };
  let interp: string | null = null;
  let p_filesz = 0;
  const phoff = Number(buf.readBigUInt64LE(32));
  for (let i = 0; i < buf.readUInt16LE(56); i++) {
    const p = phoff + i * PHDR;
    if (buf.readUInt32LE(p) !== ELF.PT_INTERP) continue;
    p_filesz = Number(buf.readBigUInt64LE(p + 32));
    interp = cstr(Number(buf.readBigUInt64LE(p + 8)), p_filesz);
  }
  if (interp === null) throw new Error("output has no PT_INTERP");

  let sh_size: number | null = null;
  const shoff = Number(buf.readBigUInt64LE(40));
  const shnum = buf.readUInt16LE(60);
  const shstrtab = shoff + buf.readUInt16LE(62) * SHDR;
  const namesOff = Number(buf.readBigUInt64LE(shstrtab + 24));
  const namesSize = Number(buf.readBigUInt64LE(shstrtab + 32));
  for (let i = 0; i < shnum; i++) {
    const s = shoff + i * SHDR;
    const nameOff = buf.readUInt32LE(s);
    if (cstr(namesOff + nameOff, namesSize - nameOff) === ".interp") sh_size = Number(buf.readBigUInt64LE(s + 32));
  }
  return { interp, p_filesz, sh_size };
}

async function compileWithElfTemplate(cwd: string, name: string, template: Buffer) {
  const templatePath = join(cwd, `template-${name}`);
  await Bun.write(templatePath, template);
  const outfile = join(cwd, `out-${name}`);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--target=bun-linux-x64",
      "--compile-executable-path",
      templatePath,
      join(cwd, "entry.js"),
      "--outfile",
      outfile,
    ],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = (await Bun.file(outfile).exists()) ? Buffer.from(await Bun.file(outfile).arrayBuffer()) : null;
  return { name, stderr, exitCode, output };
}

const NIX_INTERP = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-glibc-2.40-1/lib/ld-linux-x86-64.so.2";

test("compile --compile-executable-path rejects an ELF template whose headers point outside the file", async () => {
  using dir = tempDir("compile-elf-template-bounds", {
    "entry.js": `console.log("compiled-from-template");`,
  });
  const cwd = String(dir);
  const { U64_MAX } = ELF;

  const corrupt: [name: string, template: Buffer][] = [
    ["bun-section-past-eof", elfTemplate({ bunOffset: 1n << 40n })],
    ["phdr-table-past-eof", elfTemplate({ phoff: 1n << 40n })],
    ["phdr-table-wraps", elfTemplate({ phoff: U64_MAX - 7n })],
    ["shdr-table-wraps", elfTemplate({ shoff: U64_MAX - 7n })],
    ["shstrndx-past-shnum", elfTemplate({ shstrndx: 3 })],
    ["shstrtab-wraps", elfTemplate({ shstrtabOffset: U64_MAX - 3n })],
    ["load-memsz-wraps", elfTemplate({ loadMemsz: U64_MAX })],
    // p_filesz > p_memsz: the appended data would land inside the segment's existing bytes.
    ["load-filesz-over-memsz", elfTemplate({ pad: 0x2000, loadFilesz: 0x1800n })],
  ];
  // The templates are a few hundred bytes, so unlike compiles against a real bun binary
  // these are cheap enough to run at once.
  const results = await Promise.all(corrupt.map(([name, template]) => compileWithElfTemplate(cwd, name, template)));
  for (const { name, stderr, exitCode, output } of results) {
    // Every corrupt template is reported as a clean error...
    expect({ name, stderr }).toEqual({ name, stderr: expect.stringContaining("InvalidElfFile") });
    // ...produces no executable...
    expect({ name, output }).toEqual({ name, output: null });
    // ...and exits with a normal failure code instead of crashing.
    expect({ name, exitCode }).toEqual({ name, exitCode: 1 });
  }

  // The same template with consistent headers is accepted, and so is one whose PT_INTERP
  // points outside the file: the interpreter rewrite is best-effort and leaves it alone.
  for (const [name, template] of [
    ["good", elfTemplate()],
    ["interp-wraps", elfTemplate({ interp: NIX_INTERP, interpOffset: U64_MAX - 3n })],
  ] as const) {
    const { stderr, exitCode, output } = await compileWithElfTemplate(cwd, name, template);
    expect({ name, stderr }).toEqual({ name, stderr: expect.not.stringContaining("error:") });
    expect({ name, embedded: output?.includes("compiled-from-template") }).toEqual({ name, embedded: true });
    expect({ name, exitCode }).toEqual({ name, exitCode: 0 });
  }
});

// On Nix/Guix hosts the FHS loader path is a stub, so the rewrite is skipped there (#29290).
test.skipIf(existsSync("/etc/NIXOS") || existsSync("/gnu/store"))(
  "compile --compile-executable-path rewrites a Nix store PT_INTERP and the .interp section header",
  async () => {
    using dir = tempDir("compile-elf-template-interp", {
      "entry.js": `console.log("compiled-from-template");`,
    });
    const { stderr, exitCode, output } = await compileWithElfTemplate(
      String(dir),
      "nix-interp",
      elfTemplate({ interp: NIX_INTERP }),
    );
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    const ldso = "/lib64/ld-linux-x86-64.so.2";
    expect(readElfInterp(output!)).toEqual({ interp: ldso, p_filesz: ldso.length + 1, sh_size: ldso.length + 1 });
    expect(output!.includes("compiled-from-template")).toBe(true);
  },
);

test("compile --compile-executable-path rejects a template shorter than the executable-format header", async () => {
  // `--compile-executable-path` accepts an arbitrary file. A file shorter than the target
  // format's fixed header (or one whose header advertises more load-command bytes than the
  // file contains) must surface as a clean error instead of a slice-index panic.
  using dir = tempDir("compile-template-short-header", {
    "entry.js": `console.log(1);`,
    // 19 bytes: shorter than mach_header_64 (32), Elf64_Ehdr (64), IMAGE_DOS_HEADER (64).
    "tiny": "WRONG-STUB-FALLBACK",
  });
  const cwd = String(dir);

  const machHeader = (ncmds: number, sizeofcmds: number) => {
    const b = Buffer.alloc(32);
    b.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
    b.writeInt32LE(0x01000007, 4); // CPU_TYPE_X86_64
    b.writeInt32LE(3, 8); // cpusubtype
    b.writeUInt32LE(2, 12); // filetype = MH_EXECUTE
    b.writeUInt32LE(ncmds, 16);
    b.writeUInt32LE(sizeofcmds, 20);
    return b;
  };

  // mach_header_64 with ncmds=2 sizeofcmds=10000 but only 8 trailing bytes — exercises the
  // load-command-table bounds check in MachoFile::init (iterator() would otherwise slice OOB).
  await Bun.write(join(cwd, "badcmds"), Buffer.concat([machHeader(2, 10000), Buffer.alloc(8)]));

  // mach_header_64 + one LC_SEGMENT_64 whose cmdsize (8) is smaller than sizeof(segment_command_64)
  // (72) — exercises the cast-site guard in write_section().
  const lc = Buffer.alloc(8);
  lc.writeUInt32LE(0x19, 0); // LC_SEGMENT_64
  lc.writeUInt32LE(8, 4); // cmdsize
  await Bun.write(join(cwd, "shortseg"), Buffer.concat([machHeader(1, 8), lc]));

  const run = async (target: string, template: string) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        `--target=${target}`,
        "--compile-executable-path",
        join(cwd, template),
        join(cwd, "entry.js"),
        "--outfile",
        join(cwd, `out-${template}`),
      ],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  for (const [target, template, wantErr, outName] of [
    ["bun-darwin-x64", "tiny", "InvalidObject", "out-tiny"],
    ["bun-darwin-x64", "badcmds", "InvalidObject", "out-badcmds"],
    ["bun-darwin-x64", "shortseg", "InvalidObject", "out-shortseg"],
    ["bun-linux-x64", "tiny", "InvalidElfFile", "out-tiny"],
    // build_command.rs appends .exe to the outfile for Windows targets.
    ["bun-windows-x64", "tiny", "InvalidPEFile", "out-tiny.exe"],
  ] as const) {
    const { stderr, exitCode } = await run(target, template);
    expect({ target, template, stderr }).toEqual({
      target,
      template,
      stderr: expect.stringContaining(wantErr),
    });
    expect(await Bun.file(join(cwd, outName)).exists()).toBe(false);
    expect(exitCode).toBe(1);
  }
}, 60_000);
