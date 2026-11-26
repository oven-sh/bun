import { describe, expect, test } from "bun:test";
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
  // A chunk with non-ASCII text is embedded as UTF-16; reading it back as a file must still give the UTF-8 text.
  itBundled("compile/NonAsciiChunkReadsBackAsUTF8", {
    compile: true,
    banner: "// ✓ résumé",
    files: {
      "/entry.ts": /* js */ `
        import { readFileSync, statSync } from "node:fs";
        const text = readFileSync(Bun.main, "utf8");
        const viaBlob = await Bun.file(Bun.main).text();
        console.log(text.includes("// ✓ résumé"), viaBlob === text, statSync(Bun.main).size === Buffer.byteLength(text));
      `,
    },
    run: { stdout: "true true true" },
  });
  itBundled("compile/HelloWorldWithProcessVersionsBun", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        process.exitCode = 1;
        process.versions.bun = "bun!";
        if (process.versions.bun === "bun!") throw new Error("fail");
        if (require("./${process.platform}-${process.arch}.js").replaceAll("-debug", "") === "${Bun.version.replaceAll("-debug", "")}") {
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
  // --bytecode selects cjs output. A wrapped CommonJS file that starts with "use strict"
  // keeps the directive in its wrapper, so the embedded bytecode runs it as strict code.
  itBundled("compile/BytecodeKeepsUseStrictOfWrappedCommonJS", {
    compile: true,
    bytecode: true,
    files: {
      "/entry.mjs": /* js */ `
        import strict from "./strict.cjs";
        import sloppy from "./sloppy.cjs";
        console.log(strict, sloppy);
      `,
      "/strict.cjs": /* js */ `
        "use strict";
        module.exports = (function () { return this === undefined; })();
      `,
      "/sloppy.cjs": /* js */ `
        module.exports = (function () { return this === undefined; })();
      `,
    },
    run: { stdout: "true false" },
  });
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
});
