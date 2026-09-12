import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { rmSync } from "fs";
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
  // Two entry points that import() each other: the executable runs the first one.
  itBundled("compile/EntryPointsImportEachOther", {
    compile: true,
    files: {
      "/main.ts": /* js */ `
        import("./plugin.ts").then(plugin => console.log("main loaded", plugin.name));
      `,
      "/plugin.ts": /* js */ `
        export const name = "plugin";
        export const loadMain = () => import("./main.ts");
      `,
    },
    entryPointsRaw: ["./main.ts", "./plugin.ts"],
    outfile: "dist/out",
    run: {
      stdout: "main loaded plugin",
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
  // Every way of naming an embedded worker entry point resolves against the executable, not the cwd: a relative
  // specifier with the source extension, with the embedded `.js` extension, or with none, a `file:` URL made from
  // import.meta.url with either extension, and an absolute path in the platform's own syntax.
  itBundled("compile/WorkerSpecifierForms", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import { rmSync } from "fs";
        import { tmpdir } from "os";
        import { join } from "path";
        rmSync("./wjs.js", { force: true });
        rmSync("./wts.ts", { force: true });
        rmSync("./wmjs.mjs", { force: true });
        process.chdir(tmpdir());
        const specs = [
          "./wjs.js", "./wjs", "./wts.ts", "./wts", "./wmjs.mjs",
          new URL("./wjs.js", import.meta.url), new URL("./wts.ts", import.meta.url), new URL("./wmjs.mjs", import.meta.url),
          new URL("./wts.ts", import.meta.url).href,
          join(import.meta.dir, "wmjs.mjs"),
        ];
        for (const spec of specs) {
          const w = new Worker(spec);
          const msg = await new Promise(resolve => {
            w.onmessage = e => resolve(e.data);
            w.onerror = e => resolve("error: " + e.message);
          });
          w.terminate();
          console.log(msg);
        }
      `,
      "/wjs.js": `postMessage("wjs");`,
      "/wts.ts": `postMessage("wts" as string);`,
      "/wmjs.mjs": `postMessage("wmjs");`,
    },
    entryPointsRaw: ["./entry.ts", "./wjs.js", "./wts.ts", "./wmjs.mjs"],
    outfile: "dist/out",
    run: { stdout: "wjs\nwjs\nwts\nwts\nwmjs\nwjs\nwts\nwmjs\nwts\nwmjs\n", file: "dist/out", setCwd: true },
  });
  // The same resolution for import()/require() at run time (specifiers the bundler could not see), relative to the
  // embedded importer: by source extension, by embedded name, without extension, and by file: URL.
  itBundled("compile/DynamicImportEmbeddedEntryPoint", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import { rmSync } from "fs";
        import { tmpdir } from "os";
        rmSync("./mod.ts", { force: true });
        process.chdir(tmpdir());
        const specs = ["./mod.ts", "./mod.js", "./mod", new URL("./mod.ts", import.meta.url).href];
        for (const spec of specs) console.log((await import(spec)).default, require(spec).default);
        await import("./nope.ts").catch(e => console.log(e.constructor.name));
      `,
      "/mod.ts": `export default "mod" as string;`,
    },
    entryPointsRaw: ["./entry.ts", "./mod.ts"],
    outfile: "dist/out",
    run: { stdout: "mod mod\nmod mod\nmod mod\nmod mod\nResolveMessage\n", file: "dist/out", setCwd: true },
  });
  // Nested embedded entry points, from the entry and from inside the subdirectory (`../`), by every spelling.
  itBundled("compile/EmbeddedResolveNested", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import { rmSync } from "fs";
        import { tmpdir } from "os";
        rmSync("./sub", { recursive: true, force: true });
        rmSync("./top.ts", { force: true });
        process.chdir(tmpdir());
        const s = (x: string) => x; // keeps the bundler from resolving the specifier at build time
        for (const spec of ["./sub/inner.ts", "./sub/inner", "./sub/inner.js"]) console.log((await import(s(spec))).default);
        const w = new Worker("./sub/worker.ts");
        console.log(await new Promise(r => { w.onmessage = e => r(e.data); w.onerror = e => r("error: " + e.message); }));
        w.terminate();
        // sub/inner.js (the embedded module, not a copy bundled into this one) resolves its sibling and its parent
        console.log((await import(s("./sub/inner.ts"))).fromInside());
      `,
      "/top.ts": `export default "top" as string;`,
      "/sub/inner.ts": /* js */ `
        export default "inner" as string;
        export function fromInside() {
          const s = (x: string) => x;
          return [require(s("../top.ts")).default, require(s("../top")).default, require(s("./sibling.ts")).default].join(",");
        }
      `,
      "/sub/sibling.ts": `export default "sibling" as string;`,
      "/sub/worker.ts": /* js */ `
        const s = (x: string) => x;
        postMessage([(await import(s("./sibling.ts"))).default, (await import(s("../top"))).default].join(","));
      `,
    },
    entryPointsRaw: ["./entry.ts", "./top.ts", "./sub/inner.ts", "./sub/sibling.ts", "./sub/worker.ts"],
    outfile: "dist/out",
    run: { stdout: "inner\ninner\ninner\nsibling,top\ntop,top,sibling\n", file: "dist/out", setCwd: true },
  });
  // What resolves where: an embedded module wins over a file of the same name in the cwd; a relative specifier that
  // is not embedded still resolves against the cwd; the resolved name of an embedded module is the graph's own.
  itBundled("compile/EmbeddedResolvePrecedence", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        const s = (x: string) => x;
        console.log(require(s("./both.js")).default);
        console.log(require(s("./disk-only.js")).default);
        const w1 = new Worker("./both.js");
        console.log(await new Promise(r => { w1.onmessage = e => r(e.data); w1.onerror = e => r("error: " + e.message); }));
        w1.terminate();
        const w2 = new Worker("./disk-only-worker.js");
        console.log(await new Promise(r => { w2.onmessage = e => r(e.data); w2.onerror = e => r("error: " + e.message); }));
        w2.terminate();
        const root = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
        console.log(require.resolve(s("./both.ts")) === root + "both.js", Bun.resolveSync("./both", import.meta.dir) === root + "both.js");
        console.log(import.meta.path.replaceAll("\\\\", "/") === root + "out");
      `,
      "/both.js": `export default "both:embedded"; if (!Bun.isMainThread) postMessage("both:embedded worker");`,
    },
    runtimeFiles: {
      "/both.js": `export default "both:disk"; if (!Bun.isMainThread) postMessage("both:disk worker");`,
      "/disk-only.js": `export default "disk-only";`,
      "/disk-only-worker.js": `postMessage("disk-only worker");`,
    },
    entryPointsRaw: ["./entry.ts", "./both.js"],
    outfile: "dist/out",
    run: {
      stdout: "both:embedded\ndisk-only\nboth:embedded worker\ndisk-only worker\ntrue true\ntrue\n",
      file: "dist/out",
      setCwd: true,
    },
  });
  // Spellings that must not map to an embedded module, and inputs that must fail cleanly rather than crash.
  itBundled("compile/EmbeddedResolveMisses", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import { rmSync } from "fs";
        import { tmpdir } from "os";
        rmSync("./mod.ts", { force: true });
        rmSync("./UP.TS", { force: true });
        process.chdir(tmpdir());
        const s = (x: string) => x;
        const outcome = async (spec: string) => {
          try {
            return (await import(spec)).default;
          } catch (e: any) {
            return e?.constructor?.name ?? String(e);
          }
        };
        console.log(await outcome(s("./mod.ts")));          // maps to mod.js
        console.log(await outcome(s("./UP.ts")), await outcome(s("./up.TS"))); // the extension is case-insensitive, the name is not
        console.log(await outcome(s("./mod.css")));         // not a source extension: no mapping
        console.log(await outcome(s("./mod.js/")));         // trailing slash
        console.log(await outcome(s("../mod.ts")));         // escapes the embedded root
        console.log(await outcome(s("./" + Buffer.alloc(70000, "a").toString() + ".ts"))); // longer than any path buffer
        console.log(await outcome(s(".\\\\mod.ts")));      // a relative specifier on Windows only
      `,
      "/mod.ts": `export default "mod" as string;`,
      "/UP.TS": `export default "UP" as string;`,
    },
    entryPointsRaw: ["./entry.ts", "./mod.ts", "./UP.TS"],
    outfile: "dist/out",
    run: {
      stdout: [
        "mod",
        "UP ResolveMessage",
        "ResolveMessage",
        "ResolveMessage",
        "ResolveMessage",
        "ResolveMessage",
        isWindows ? "mod" : "ResolveMessage",
        "",
      ].join("\n"),
      file: "dist/out",
      setCwd: true,
    },
  });
  // A "./" specifier imported at runtime from an embedded module is joined onto
  // /$bunfs/root/ in a fixed-size path buffer and looked up in the standalone
  // module graph. A specifier that does not fit must fall through to the regular
  // resolver, not abort the process. Specifiers longer than 1.5x PATH_MAX (1024
  // on macOS, 4096 on Linux, 98302 on Windows) are rejected before resolution
  // starts, so the lengths below sit between PATH_MAX and that cap. Both probes
  // must report "not found" like a non-compiled `bun run` does, and the graph
  // must still serve a "./" specifier of normal length afterwards.
  itBundled("compile/RelativeSpecifierLongerThanPathMax", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        const req = (x) => require(x);
        const imp = (x) => import(x);
        const len = process.platform === "win32" ? 100_000 : process.platform === "linux" ? 5000 : 1200;
        const tooLong = "./" + Buffer.alloc(len, "w").toString();
        const out = [];
        try { req(tooLong); out.push("require resolved"); } catch (e) { out.push("require: " + e.code); }
        try { await imp(tooLong); out.push("import resolved"); } catch (e) { out.push("import: " + e.code); }
        out.push(req("./embedded-sibling.js").value);
        out.push((await imp("./embedded-sibling.js")).value);
        console.log(out.join("\\n"));
      `,
      "/embedded-sibling.ts": /* js */ `
        export const value = "embedded sibling resolved from the graph";
      `,
    },
    entryPointsRaw: ["./entry.ts", "./embedded-sibling.ts"],
    outfile: "dist/out",
    run: {
      file: "dist/out",
      stdout: [
        "require: MODULE_NOT_FOUND",
        "import: ERR_MODULE_NOT_FOUND",
        "embedded sibling resolved from the graph",
        "embedded sibling resolved from the graph",
      ].join("\n"),
    },
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
  // A relative Worker specifier is joined onto the embedded root ("./worker" ->
  // "/$bunfs/root/worker.js") in a fixed-size path buffer before the graph
  // lookup. A specifier that does not fit must fall through to the regular
  // resolver and fire the worker's error event, not abort the process.
  itBundled("compile/WorkerRelativePathLongerThanPathBuffer", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        const w = (length) => Buffer.alloc(length, "w").toString();
        // The specifier is joined onto import.meta.dir ("/$bunfs/root") plus a slash.
        const joinedPrefixLength = import.meta.dir.length + 1;
        const specifiers = [
          ["./ past the buffer", "./" + w(100_000)],
          ["../ past the buffer", "../" + w(100_000)],
          // Path buffer sizes on macOS, Linux and Windows. The joined path
          // stops one byte short of filling the buffer, so the join fits and
          // only the ".js" appended by the remap does not.
          ...[1024, 4096, 98302].map(size => [
            "./ one byte short of a " + size + " byte buffer",
            "./" + w(size - 1 - joinedPrefixLength),
          ]),
        ];
        for (const [label, specifier] of specifiers) {
          const { promise, resolve } = Promise.withResolvers();
          const worker = new Worker(specifier);
          worker.onerror = resolve;
          await promise;
          console.log(label + ": error event");
        }
      `,
    },
    run: {
      stdout: `
        ./ past the buffer: error event
        ../ past the buffer: error event
        ./ one byte short of a 1024 byte buffer: error event
        ./ one byte short of a 4096 byte buffer: error event
        ./ one byte short of a 98302 byte buffer: error event
      `,
      setCwd: true,
    },
  });
  // Preloads go through the same join, on the parent thread.
  itBundled("compile/WorkerPreloadLongerThanPathBuffer", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        try {
          new Worker("./worker.ts", { preload: ["./" + Buffer.alloc(100_000, "p").toString()] });
          console.log("constructed");
        } catch (e) {
          console.log("constructor threw an Error:", e instanceof Error);
        }
      `,
      "/worker.ts": /* js */ `
        console.log("Worker loaded!");
      `.trim(),
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    run: { stdout: "constructor threw an Error: true", file: "dist/out", setCwd: true },
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
  itBundled("compile/EmbeddedFileNamesPerThread", {
    compile: true,
    assetNaming: "[name].[ext]",
    files: {
      "/entry.ts": /* js */ `
        import { isMainThread, Worker } from "node:worker_threads";
        import "./asset.file";
        import txt from "./t.txt" with { type: "text" };
        function probe() {
          const f = [...Bun.embeddedFiles][0];
          const p = {};
          p[f.name] = 1;
          const o = {};
          o[txt] = 1;
          return p[f.name.split("").join("")] + " " + o[["embedded", "text", "module"].join("-")];
        }
        console.log(probe());
        if (isMainThread) {
          const w = new Worker(new URL(import.meta.url));
          await new Promise(resolve => w.on("exit", resolve));
          Bun.gc(true);
          console.log(probe());
        }
      `,
      "/asset.file": "abcd",
      "/t.txt": "embedded-text-module",
    },
    outfile: "dist/out",
    run: { stdout: "1 1\n1 1\n1 1", setCwd: true },
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
          : // pathToFileURL percent-encodes '~' (matches Node.js)
            `file:///B:/%7EBUN/root/out B:\\~BUN\\root\\out`,
      setCwd: true,
    },
  });
  itBundled("compile/VariousBunAPIs", {
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

  // A text import in a compiled executable is embedded as a string body
  // (8-bit when ASCII, UTF-16LE otherwise) that the runtime hands back without
  // a parse or a copy, instead of a JS module with a string literal. The same source also checks `require()`, `import()`, and that
  // `Bun.embeddedFiles` keeps listing only real assets.
  // Buffers: `files` strings go through dedent(), which would trim them.
  const textImportFiles = {
    "/ascii.txt": Buffer.from("hello world\nline 2\n"),
    "/latin1.txt": Buffer.from("caf\u00e9 na\u00efve\n"),
    "/wide.txt": Buffer.from("em \u2014 dash \u{1F600} emoji \u65e5\u672c\n"),
    "/empty.txt": Buffer.alloc(0),
    "/invalid.txt": Buffer.from([0x62, 0x61, 0x64, 0x20, 0xff, 0xfe, 0x20, 0xc3, 0x28, 0x0a]),
    "/doc.md": Buffer.from("# Title\n\nsome *markdown* \u2014 with dash\n"),
    "/asset.file": "abcd",
  };
  const textImportEntry = /* js */ `
    import ascii from "./ascii.txt";
    import latin1 from "./latin1.txt";
    import wide from "./wide.txt";
    import empty from "./empty.txt";
    import invalid from "./invalid.txt";
    import doc from "./doc.md";
    import asset from "./asset.file" with { type: "file" };
    import { readdirSync, readFileSync } from "node:fs";
    import { dirname, join } from "node:path";

    // No top-level await: the bytecode variant is CommonJS output.
    async function main() {
      // The embedded root. \`import.meta.dir\` is inlined at build time in CommonJS output.
      const root = dirname(Bun.main);
      const expected = {
        ascii: "hello world\\nline 2\\n",
        latin1: "caf\\u00e9 na\\u00efve\\n",
        wide: "em \\u2014 dash \\u{1F600} emoji \\u65e5\\u672c\\n",
        empty: "",
        // Invalid UTF-8 decodes like TextDecoder: one U+FFFD per bad byte.
        invalid: "bad \\ufffd\\ufffd \\ufffd(\\n",
        doc: "# Title\\n\\nsome *markdown* \\u2014 with dash\\n",
      };
      const actual = { ascii, latin1, wide, empty, invalid, doc };
      for (const [name, value] of Object.entries(actual)) {
        if (typeof value !== "string") throw new Error(name + " is a " + typeof value);
        if (value !== expected[name]) throw new Error(name + " mismatch: " + JSON.stringify(value));
      }
      if (require("./ascii.txt") !== ascii) throw new Error("require() returned " + JSON.stringify(require("./ascii.txt")));
      if ((await import("./wide.txt")).default !== wide) throw new Error("import() mismatch");

      // Text modules are not assets; only the file loader import is listed.
      const embedded = Bun.embeddedFiles.map(blob => blob.name);
      if (embedded.length !== 1 || !embedded[0].startsWith("asset-")) throw new Error("embeddedFiles: " + embedded);
      if ((await Bun.file(asset).text()) !== "abcd") throw new Error("asset: " + asset);

      // Reading the embedded module as a file gives its text as UTF-8, whichever width the body is stored in.
      const encoded = {
        "ascii.txt": Buffer.from(expected.ascii),
        "latin1.txt": Buffer.from(expected.latin1),
        "wide.txt": Buffer.from(expected.wide),
        "empty.txt": Buffer.alloc(0),
        "invalid.txt": Buffer.from(expected.invalid),
        "doc.md": Buffer.from(expected.doc),
      };
      const embeddedNames = readdirSync(root);
      for (const [name, bytes] of Object.entries(encoded)) {
        const [base, ext] = name.split(".");
        const file = embeddedNames.find(entry => entry.startsWith(base + "-") && entry.endsWith("." + ext));
        if (!file) throw new Error("no embedded module for " + name + " in " + JSON.stringify(embeddedNames));
        const got = readFileSync(join(root, file));
        if (!got.equals(bytes)) throw new Error(name + ": " + got.toString("hex") + " != " + bytes.toString("hex"));
      }
      console.log("PASS");
    }
    main();
  `;
  for (const [suffix, options] of [
    ["", {}],
    ["Bytecode", { bytecode: true }],
    ["BytecodeESM", { bytecode: true, format: "esm" }],
  ] as const) {
    itBundled(`compile/TextImport${suffix}`, {
      compile: true,
      ...options,
      loader: { ".md": "text" },
      files: { "/entry.ts": textImportEntry, ...textImportFiles },
      run: { stdout: "PASS" },
    });
  }

  // Text modules keep their own `[name]-[hash]` path: a user `--asset-naming`
  // without `[hash]` must not make two same-named text files share one path.
  itBundled("compile/TextImportSameBasename", {
    compile: true,
    assetNaming: "[name].[ext]",
    files: {
      "/entry.ts": /* js */ `
        import a from "./a/readme.txt";
        import b from "./b/readme.txt";
        import sameA from "./a/same.txt";
        import sameB from "./b/same.txt";
        import icon from "./a/icon.file" with { type: "file" };
        console.log(JSON.stringify({ a, b, sameA, sameB, icon: await Bun.file(icon).text() }));
      `,
      "/a/readme.txt": "from a",
      "/b/readme.txt": "from b",
      "/a/same.txt": "same",
      "/b/same.txt": "same",
      "/a/icon.file": "icon",
    },
    run: { stdout: JSON.stringify({ a: "from a", b: "from b", sameA: "same", sameB: "same", icon: "icon" }) },
  });

  // A browser chunk of a full-stack executable cannot reach the embedded
  // module graph, so its text imports stay inline string literals.
  itBundled("compile/TextImportClientChunkStaysInline", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import index from "./index.html";
        import note from "./note.txt";
        using server = Bun.serve({ port: 0, routes: { "/": index } });
        const html = await (await fetch(server.url)).text();
        const src = html.match(/<script[^>]*src="([^"]+)"/)[1];
        const js = await (await fetch(new URL(src, server.url))).text();
        console.log(JSON.stringify({
          server: note,
          clientHasLiteral: js.includes("client sees the text"),
          clientHasBunfs: js.includes("$bunfs"),
        }));
      `,
      "/index.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <body>
            <script type="module" src="./app.ts"></script>
          </body>
        </html>
      `,
      "/app.ts": /* js */ `
        import note from "./note.txt";
        document.body.textContent = note;
      `,
      "/note.txt": "client sees the text",
    },
    run: { stdout: JSON.stringify({ server: "client sees the text", clientHasLiteral: true, clientHasBunfs: false }) },
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

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_X86_64 = 0x01000007;
const MH_EXECUTE = 2;
const LC_SEGMENT_64 = 0x19;
const LC_SYMTAB = 0x2;

// Minimal Mach-O "base executable" for --compile-executable-path: a __BUN segment with one
// __bun section followed by a 0x100-byte __LINKEDIT segment, plus an optional LC_SYMTAB whose
// symbol table starts at __LINKEDIT and whose string table sits 0x80 bytes in.
// `bunFileOff`/`bunFileSize` are where the load commands claim the __BUN data lives;
// `fileSize` is how many bytes the template actually contains.
function machoTemplate({
  bunFileOff = 0x4000,
  bunFileSize = 0x4000,
  fileSize = 0x8100,
  linkeditFileOff = bunFileOff + bunFileSize,
  symtab = false,
}: {
  bunFileOff?: number;
  bunFileSize?: number;
  fileSize?: number;
  linkeditFileOff?: number;
  symtab?: boolean;
} = {}): Buffer {
  const segCmdSize = 72; // sizeof(segment_command_64)
  const sectSize = 80; // sizeof(section_64)
  const symtabCmdSize = 24; // sizeof(symtab_command)
  const sizeofcmds = segCmdSize + sectSize + segCmdSize + (symtab ? symtabCmdSize : 0);
  const buf = Buffer.alloc(fileSize);
  const writeName = (off: number, name: string) => buf.write(name, off, 16, "latin1");

  // mach_header_64
  buf.writeUInt32LE(MH_MAGIC_64, 0);
  buf.writeInt32LE(CPU_TYPE_X86_64, 4);
  buf.writeInt32LE(3, 8); // cpusubtype
  buf.writeUInt32LE(MH_EXECUTE, 12);
  buf.writeUInt32LE(symtab ? 3 : 2, 16); // ncmds
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
  buf.writeBigUInt64LE(BigInt(linkeditFileOff), o + 40); // fileoff
  buf.writeBigUInt64LE(0x100n, o + 48); // filesize
  buf.writeInt32LE(1, o + 56); // maxprot
  buf.writeInt32LE(1, o + 60); // initprot

  if (symtab) {
    // LC_SYMTAB
    o += segCmdSize;
    buf.writeUInt32LE(LC_SYMTAB, o);
    buf.writeUInt32LE(symtabCmdSize, o + 4);
    buf.writeUInt32LE(linkeditFileOff, o + 8); // symoff
    buf.writeUInt32LE(0, o + 12); // nsyms
    buf.writeUInt32LE(linkeditFileOff + 0x80, o + 16); // stroff
    buf.writeUInt32LE(0x80, o + 20); // strsize
  }

  return buf;
}

test("compile --compile-executable-path rejects a Mach-O template whose __BUN segment offsets exceed the file bounds", async () => {
  // `bun build --compile --target=bun-darwin-*` patches the application bundle into the
  // __BUN,__bun section of the base executable named by --compile-executable-path. The
  // segment/section offsets in that file's load commands must be validated against the
  // actual file size before they are used as memmove destinations.
  using dir = tempDir("compile-macho-template-bounds", {
    "entry.js": `console.log("compiled-from-template");`,
  });
  const cwd = String(dir);

  for (const [name, bytes, wantErr] of [
    // __BUN fileoff points 1 GiB past the end of the 33 KB file.
    ["fileoff-past-eof", machoTemplate({ bunFileOff: 0x40000000 }), "OffsetOutOfRange"],
    // __BUN filesize (32 KB) exceeds the 256-byte file: the bounds check must reject this
    // before the growth `reserve()` (which would otherwise see a negative size_diff).
    ["filesize-past-eof", machoTemplate({ bunFileOff: 0, bunFileSize: 0x8000, fileSize: 256 }), "OffsetOutOfRange"],
    // __BUN filesize (32 KB) is in-bounds but larger than the 16 KB aligned bundle slot;
    // write_section only grows, so a template that would require shrinking is rejected.
    ["filesize-needs-shrink", machoTemplate({ bunFileSize: 0x8000, fileSize: 0xc100 }), "InvalidObject"],
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
  await Bun.write(goodTemplate, machoTemplate());
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

test("compile --compile-executable-path rejects a Mach-O template whose __LINKEDIT offsets would pass 4 GiB once the bundle is embedded", async () => {
  // Mach-O load commands (LC_SYMTAB, LC_CODE_SIGNATURE, ...) store file offsets as u32.
  // Embedding the bundle grows __BUN and moves every __LINKEDIT offset forward by the same
  // amount, so a bundle of about 4 GiB pushes them past u32::MAX. Building such a bundle
  // is too slow for a test, so this template places __LINKEDIT and the LC_SYMTAB offsets
  // just below 4 GiB: a 32 KB bundle is then enough to move them over the edge.

  // Returns the __LINKEDIT fileoff and the LC_SYMTAB offsets of a Mach-O file.
  function readLinkeditOffsets(buf: Buffer) {
    const ncmds = buf.readUInt32LE(16);
    let linkeditFileOff = -1;
    let symoff = -1;
    let stroff = -1;
    let o = 32;
    for (let i = 0; i < ncmds; i++) {
      const cmd = buf.readUInt32LE(o);
      const cmdsize = buf.readUInt32LE(o + 4);
      if (cmd === LC_SEGMENT_64 && buf.toString("latin1", o + 8, o + 18) === "__LINKEDIT") {
        linkeditFileOff = Number(buf.readBigUInt64LE(o + 40));
      } else if (cmd === LC_SYMTAB) {
        symoff = buf.readUInt32LE(o + 8);
        stroff = buf.readUInt32LE(o + 16);
      }
      o += cmdsize;
    }
    return { linkeditFileOff, symoff, stroff };
  }

  // 32 KB of source does not fit the template's 16 KB __BUN slot, so __LINKEDIT has to move.
  using dir = tempDir("compile-macho-template-4gib", {
    "entry.js": `console.log("${Buffer.alloc(32 * 1024, "a").toString()}");`,
  });
  const cwd = String(dir);

  const build = async (name: string, template: Buffer) => {
    const templatePath = join(cwd, `template-${name}`);
    await Bun.write(templatePath, template);
    const outfile = join(cwd, `out-${name}`);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-darwin-x64",
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
    return { stderr, exitCode, outfile };
  };

  // __LINKEDIT starts 4 KiB below 4 GiB, so any growth of __BUN (16 KiB steps) overflows its offsets.
  {
    const { stderr, exitCode, outfile } = await build(
      "too-large",
      machoTemplate({ linkeditFileOff: 0xffff_f000, symtab: true }),
    );
    expect(stderr).toContain("executable would exceed 4 GiB");
    expect(stderr).toContain("failed to write compiled executable");
    expect(await Bun.file(outfile).exists()).toBe(false);
    expect(exitCode).toBe(1);
  }

  // The same template with __LINKEDIT right after __BUN builds, and its offsets move together.
  {
    const { stderr, exitCode, outfile } = await build("in-range", machoTemplate({ symtab: true }));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const out = Buffer.from(await Bun.file(outfile).arrayBuffer());
    const { linkeditFileOff, symoff, stroff } = readLinkeditOffsets(out);
    expect(linkeditFileOff).toBeGreaterThan(0x8000);
    expect({ symoff, stroff }).toEqual({ symoff: linkeditFileOff, stroff: linkeditFileOff + 0x80 });
  }
});

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

// The startup path used to release weak refs, drop every unlinked code block and run a synchronous full collection right
// after a standalone executable's entry module finished evaluating, i.e. before its first turn of the event loop.
test("a standalone executable does not run a synchronous full GC after loading its entry point", async () => {
  using dir = tempDir("compile-no-postload-gc", {
    "app.js": `setTimeout(() => console.log("done"), 1);`,
  });
  const cwd = String(dir);
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "app.js", "--outfile", "app"],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildStderr).not.toContain("error");
  expect(buildExit).toBe(0);
  await using proc = Bun.spawn({
    cmd: [join(cwd, isWindows ? "app.exe" : "app")],
    // BUN_DESTRUCT_VM_ON_EXIT would add an exit-time full collection to the log.
    env: { ...bunEnv, BUN_JSC_logGC: "1", BUN_DESTRUCT_VM_ON_EXIT: undefined },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("done\n");
  // Heap::notifyIsSafeToCollect logs this at VM creation whenever logGC is on, collection or not, so it proves the
  // option reached the compiled binary without depending on any GC happening.
  expect(stderr).toMatch(/\[GC<(0x)?[0-9a-fA-F]+>: starting /); // %p: "0x7f…" on POSIX, "00007FF6…" on Windows
  expect(stderr).not.toContain("FullCollection");
  expect(exitCode).toBe(0);
});
