import { describe, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  describe("compile with splitting", () => {
    // The embedded module graph is laid out in load order: the entry point's
    // static imports (dependencies first), then each dynamic import's closure,
    // breadth-first. Chunk index order would be entry, lazy1, lazy2, shared,
    // shared2.
    itBundled("compile/splitting/ModulesLaidOutInLoadOrder", {
      compile: true,
      splitting: true,
      bytecode: true,
      format: "esm",
      files: {
        "/entry.ts": /* js */ `
          import "./shared";
          console.log("mark:entry");
          await import("./lazy1");
        `,
        "/lazy1.ts": /* js */ `
          import "./shared";
          import "./shared2";
          console.log("mark:lazy1");
          await import("./lazy2");
        `,
        "/lazy2.ts": /* js */ `
          import "./shared2";
          console.log("mark:lazy2");
        `,
        "/shared.ts": /* js */ `
          console.log("mark:shared");
        `,
        "/shared2.ts": /* js */ `
          console.log("mark:shared2");
        `,
      },
      run: {
        stdout: "mark:shared\nmark:entry\nmark:shared2\nmark:lazy1\nmark:lazy2",
      },
      onAfterBundle(api) {
        const payload = readFileSync(api.outfile).toString("latin1");
        const order = ["entry", "lazy1", "lazy2", "shared", "shared2"]
          .map(name => {
            const offset = payload.lastIndexOf(`mark:${name}"`);
            expect(offset, `marker mark:${name} not found in the payload`).toBeGreaterThanOrEqual(0);
            return { name, offset };
          })
          .sort((a, b) => a.offset - b.offset)
          .map(m => m.name);
        expect(order).toEqual(["shared", "entry", "shared2", "lazy1", "lazy2"]);
      },
    });

    // The payload records how many leading modules make up the entry point's
    // static import closure, and writes the internal-module bytecode and string
    // table right after them, so a cold start prefetches one run. Lazily
    // imported chunks come after that run.
    itBundled("compile/splitting/StartupModulesPrecedeLazyChunks", {
      compile: true,
      splitting: true,
      bytecode: true,
      format: "esm",
      files: {
        "/entry.ts": /* js */ `
          import "./shared";
          console.log("mark:entry");
          await import("./lazy1");
        `,
        "/lazy1.ts": /* js */ `
          import "./shared";
          console.log("mark:lazy1");
        `,
        "/shared.ts": /* js */ `
          console.log("mark:shared");
        `,
      },
      run: {
        stdout: "mark:shared\nmark:entry\nmark:lazy1",
      },
      onAfterBundle(api) {
        const file = readFileSync(api.outfile);
        const trailer = file.lastIndexOf("\n---- Bun! ----\n", undefined, "latin1");
        expect(trailer).toBeGreaterThan(0);
        // `Offsets { byte_count: usize, modules_ptr: StringPointer, entry_point_id: u32, compile_exec_argv_ptr: StringPointer, flags: u32 }`
        const offsets = trailer - 32;
        const base = offsets - Number(file.readBigUInt64LE(offsets));
        const modules = { offset: file.readUInt32LE(offsets + 8), length: file.readUInt32LE(offsets + 12) };
        const flags = file.readUInt32LE(offsets + 28);
        const u32 = (at: number) => file.readUInt32LE(base + at);
        // Three chunks of 52 bytes each; anything else means the layout above is stale.
        expect(modules.length).toBe(3 * 52);

        // Records chained after the module table, in `Flags` bit order.
        let at = modules.offset + modules.length;
        const count = modules.length / 52;
        if (flags & (1 << 5)) at += count * 4; // source hashes
        expect(flags & (1 << 6), "Flags::HAS_BUILTIN_BYTECODE").not.toBe(0);
        const builtinCount = u32(at);
        at += 4 + builtinCount * 12;
        expect(flags & (1 << 7), "Flags::HAS_BYTECODE_STRING_TABLE").not.toBe(0);
        const stringTable = { offset: u32(at), length: u32(at + 4) };
        at += 8;
        expect(flags & (1 << 8), "Flags::HAS_STARTUP_MODULE_COUNT").not.toBe(0);
        const startupCount = u32(at);

        // `CompiledModuleGraphFile`: name, contents, sourcemap, bytecode, module_info, bytecode_origin_path
        // (StringPointer each), then 4 bytes. Chunk names are hashed, so identify them by their source text.
        const index: Record<string, number> = {};
        const bytecodeEnd: number[] = [];
        for (let i = 0; i < count; i++) {
          const record = base + modules.offset + i * 52;
          const contents = { offset: file.readUInt32LE(record + 8), length: file.readUInt32LE(record + 12) };
          const bytecode = { offset: file.readUInt32LE(record + 24), length: file.readUInt32LE(record + 28) };
          expect(bytecode.length, `module ${i} has bytecode`).toBeGreaterThan(0);
          bytecodeEnd.push(bytecode.offset + bytecode.length);
          const source = file.toString("latin1", base + contents.offset, base + contents.offset + contents.length);
          for (const name of ["entry", "lazy1", "shared"]) {
            if (source.includes(`mark:${name}"`)) index[name] = i;
          }
        }
        expect(startupCount).toBe(2);
        expect([index.shared, index.entry].sort()).toEqual([0, 1]);
        expect(index.lazy1).toBe(2);
        // The string table sits between the startup modules' bytecode and the lazy chunk's.
        expect(stringTable.offset).toBeGreaterThanOrEqual(Math.max(bytecodeEnd[0], bytecodeEnd[1]));
        expect(stringTable.offset + stringTable.length).toBeLessThanOrEqual(bytecodeEnd[2]);
      },
    });

    itBundled("compile/splitting/ChunkNamesAreHashed", {
      compile: true,
      splitting: true,
      files: {
        "/entry.ts": /* js */ `
          import "./shared";
          console.log("mark:entry");
          await import("./lazy");
        `,
        "/lazy.ts": /* js */ `
          import "./shared";
          console.log("mark:lazy");
        `,
        "/shared.ts": /* js */ `
          console.log("mark:shared");
        `,
      },
      run: {
        stdout: "mark:shared\nmark:entry\nmark:lazy",
      },
      onAfterBundle(api) {
        const file = readFileSync(api.outfile);
        const trailer = file.lastIndexOf("\n---- Bun! ----\n", undefined, "latin1");
        expect(trailer).toBeGreaterThan(0);
        const offsets = trailer - 32;
        const base = offsets - Number(file.readBigUInt64LE(offsets));
        const modules = { offset: file.readUInt32LE(offsets + 8), length: file.readUInt32LE(offsets + 12) };
        const count = modules.length / 52;
        expect(count).toBe(3);
        const names: string[] = [];
        for (let i = 0; i < count; i++) {
          const record = base + modules.offset + i * 52;
          const name = { offset: file.readUInt32LE(record), length: file.readUInt32LE(record + 4) };
          names.push(file.toString("latin1", base + name.offset, base + name.offset + name.length));
        }
        const chunks = names.filter(name => !name.endsWith("/root/out"));
        expect(chunks).toHaveLength(2);
        for (const name of chunks) {
          expect(name).toMatch(/^(\/\$bunfs|B:\/~BUN)\/root\/chunk-[0-9a-z]+\.js$/);
        }
      },
    });

    itBundled("compile/splitting/RelativePathsAcrossChunks", {
      compile: true,
      splitting: true,
      backend: "cli",
      files: {
        "/src/app/entry.ts": /* js */ `
          console.log('app entry');
          import('../components/header').then(m => m.render());
        `,
        "/src/components/header.ts": /* js */ `
          export async function render() {
            console.log('header rendering');
            const nav = await import('./nav/menu');
            nav.show();
          }
        `,
        "/src/components/nav/menu.ts": /* js */ `
          export async function show() {
            console.log('menu showing');
            const items = await import('./items');
            console.log('items:', items.list);
          }
        `,
        "/src/components/nav/items.ts": /* js */ `
          export const list = ['home', 'about', 'contact'].join(',');
        `,
      },
      entryPoints: ["/src/app/entry.ts"],
      outdir: "/build",
      run: {
        stdout: "app entry\nheader rendering\nmenu showing\nitems: home,about,contact",
      },
    });

    for (const minify of [false, true]) {
      itBundled(`compile/splitting/ImportMetaInSplitChunk${minify ? "+minify" : ""}`, {
        compile: true,
        splitting: true,
        bytecode: true,
        format: "esm",
        ...(minify ? { minifySyntax: true, minifyIdentifiers: true, minifyWhitespace: true } : {}),
        files: {
          "/entry.ts": /* js */ `
            const mod = await import("./worker.ts");
            mod.run();
          `,
          "/worker.ts": /* js */ `
            export function run() {
              console.log(typeof import.meta.url === "string" ? "ok" : "fail");
              console.log(typeof import.meta.dir === "string" ? "ok" : "fail");
            }
          `,
        },
        run: {
          stdout: "ok\nok",
        },
      });
    }

    // The shared chunk contains a require()d (so __esm-wrapped) module with an
    // unused import of a node builtin. Builtins are side-effect free, so that
    // import is tree-shaken out of the printed chunk, but the module record
    // built for --bytecode still listed it, under the import's original local
    // name because the dead symbol was never renamed. When a live export of the
    // chunk had the same name, its export entry turned into a re-export of the
    // builtin, and the other chunk got fs/promises.rm instead of the local rm().
    //
    // The unused import binds every single-character name as well, so the
    // collision also happens with whatever name the minifier gives `rm`.
    //
    // Only the bytecode builds have a record to get wrong, and only the
    // splitting builds export `rm` across chunks; the other combinations pin
    // the configurations that already worked.
    const deadImportNames = [
      "rm",
      ...Array.from("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$", c => `rm as ${c}`),
    ];
    for (const splitting of [false, true]) {
      for (const bytecode of [false, true]) {
        for (const minify of [false, true]) {
          const suffix = (splitting ? "+splitting" : "") + (bytecode ? "+bytecode" : "") + (minify ? "+minify" : "");
          itBundled(`compile/DeadExternalImportInWrappedModule${suffix}`, {
            compile: true,
            splitting,
            bytecode,
            format: "esm",
            ...(minify ? { minifySyntax: true, minifyIdentifiers: true, minifyWhitespace: true } : {}),
            files: {
              "/entry.js": /* js */ `
                import { rm } from "./shared.js";
                console.log("entry:", rm());
                await import("./page.js");
              `,
              "/page.js": /* js */ `
                import { rm } from "./shared.js";
                console.log("page:", rm());
              `,
              "/shared.js": /* js */ `
                const { value } = require("./wrapped.js");
                export function rm() {
                  return "local rm " + value;
                }
              `,
              // A .js file on purpose: in TypeScript an unused import is dropped by
              // the parser and never reaches the linker.
              "/wrapped.js": /* js */ `
                import { ${deadImportNames.join(", ")} } from "fs/promises";
                export const value = 42;
              `,
            },
            run: {
              stdout: "entry: local rm 42\npage: local rm 42",
            },
          });
        }
      }
    }

    // A split chunk gets its own bytecode + module record. Re-exports of
    // externals in it are printed as `export * from`, or as imports plus the
    // chunk's `export { ... }` tail; the record has to describe all of them in
    // addition to the cross-chunk imports, or reading `fs` off the namespace
    // throws a TDZ ReferenceError.
    for (const minify of [false, true]) {
      itBundled(`compile/splitting/ReExportExternalFromSplitChunk${minify ? "+minify" : ""}`, {
        compile: true,
        splitting: true,
        bytecode: true,
        format: "esm",
        ...(minify ? { minifySyntax: true, minifyIdentifiers: true, minifyWhitespace: true } : {}),
        files: {
          "/entry.ts": /* js */ `
            const mod = await import("./reexports.ts");
            console.log(typeof mod.fs.readFileSync, typeof mod.join, typeof mod.rfs);
          `,
          "/reexports.ts": /* js */ `
            export * from "node:path";
            export * as fs from "node:fs";
            export { readFileSync as rfs } from "node:fs";
          `,
        },
        run: {
          stdout: "function function function",
        },
      });
    }

    // The executable keys the entry point's module at `/$bunfs/root/<outfile>`,
    // so nothing may fold into the entry's own chunk; chunks shared between
    // `import()` targets still fold into the first target's chunk.
    itBundled("compile/splitting/MinChunkSizeKeepsEntryChunkImportable", {
      compile: true,
      splitting: true,
      bytecode: true,
      format: "esm",
      minChunkSize: 1024 * 1024,
      files: {
        "/entry.ts": /* js */ `
          import { shared } from "./shared";
          console.log("entry", shared());
          const a = await import("./a");
          console.log("a", a.a());
        `,
        "/a.ts": /* js */ `
          import { shared } from "./shared";
          import { helper } from "./helper";
          export function a() { return shared() + helper() }
          export const b = import("./b").then(m => m.b());
        `,
        "/b.ts": /* js */ `
          import { helper } from "./helper";
          export function b() { return helper() * 2 }
        `,
        "/shared.ts": /* js */ `
          export function shared() { return 40 }
        `,
        "/helper.ts": /* js */ `
          export function helper() { return 1 }
        `,
      },
      run: {
        stdout: "entry 40\na 41",
      },
    });

    // A require()'d ESM chunk in a compiled binary is embedded under
    // /$bunfs/root and loaded synchronously from the call, including one made
    // while the entry is still evaluating (a require cycle), with or without
    // bytecode. With --bytecode every module that loads — the entry, its
    // static chunks and both require()'d chunks — must come from its embedded
    // bytecode; JSC logs one line per module, and the only "Cache miss" is the
    // `bun:main` wrapper, which never has bytecode.
    for (const bytecode of [false, true]) {
      itBundled(`compile/splitting/SplitRequireLoadsChunkSynchronously-${bytecode ? "bytecode" : "source"}`, {
        compile: true,
        splitting: true,
        bytecode,
        format: "esm",
        files: {
          "/entry.ts": /* js */ `
            import { getTool, eager } from "./registry.ts";
            console.log("mark:entry", eager.name);
            console.log(getTool().name);
            console.log(require("./lazy.ts") === (await import("./lazy.ts")));
          `,
          "/registry.ts": /* js */ `
            export function buildTool(name) { return { name } }
            export const eager = require("./eager.ts").Tool;
            export function getTool() { return require("./lazy.ts").Tool }
          `,
          "/eager.ts": /* js */ `
            import { buildTool } from "./registry.ts";
            console.log("mark:eager");
            export const Tool = buildTool("eager");
          `,
          "/lazy.ts": /* js */ `
            console.log("mark:lazy");
            export const Tool = { name: "lazy" };
          `,
        },
        run: {
          stdout: "mark:eager\nmark:entry eager\nmark:lazy\nlazy\ntrue",
          env: bytecode ? { BUN_JSC_verboseDiskCache: "1" } : undefined,
          validate: bytecode
            ? ({ stderr }) => {
                const lines = stderr.trim().split("\n");
                expect(lines.filter(l => l === "[Disk Cache] Cache miss for sourceCode")).toHaveLength(1);
                const hits = lines.filter(l => l === "[Disk Cache] Cache hit for sourceCode").length;
                expect(hits).toBeGreaterThanOrEqual(4);
                expect(lines).toHaveLength(hits + 1);
              }
            : undefined,
        },
        onAfterBundle(api) {
          const payload = readFileSync(api.outfile).toString("latin1");
          expect(payload).toMatch(/import\.meta\.require\("(\/\$bunfs|B:\/~BUN)\/root\/[^"]+\.js"\)/);
        },
      });
    }

    // Every chunk that imports the shared chunk names it by the same embedded
    // path, and the runtime memoizes that resolution after the first chunk.
    // The memo must hand back the one module instance, step aside as soon as
    // a Bun.plugin onResolve hook is registered, even for a specifier it
    // already answered, and answer again once the hook is cleared. The hook
    // only redirects chunk-to-chunk imports (lazy3 -> shared) to a module that
    // re-exports the shared chunk, so the entry's import() of lazy3 itself
    // still reaches the graph.
    itBundled("compile/splitting/SharedChunkResolutionIsMemoized", {
      compile: true,
      splitting: true,
      format: "esm",
      files: {
        "/entry.ts": /* js */ `
          import { plugin } from "bun";
          const a = await import("./lazy1.ts");
          const b = await import("./lazy2.ts");
          console.log(a.bump(), b.bump(), a.bump());
          plugin({
            name: "redirect-shared",
            setup(build) {
              const chunk = /[\\\\/]root[\\\\/]chunk-[0-9a-z]+\\.js$/;
              let shared;
              build.onResolve({ filter: chunk }, args => {
                if (!chunk.test(args.importer)) return undefined;
                shared = args.path;
                return { path: "redirected", namespace: "memo-test" };
              });
              build.onLoad({ filter: /.*/, namespace: "memo-test" }, () => ({
                contents: \`console.log("redirected"); export * from \${JSON.stringify(shared)};\`,
                loader: "js",
              }));
            },
          });
          const c = await import("./lazy3.ts");
          console.log(c.bump(), a.bump());
          plugin.clearAll();
          const d = await import("./lazy4.ts");
          console.log(d.bump(), c.bump());
        `,
        "/lazy1.ts": /* js */ `
          import { bump } from "./shared.ts";
          export { bump };
        `,
        "/lazy2.ts": /* js */ `
          import { bump } from "./shared.ts";
          export { bump };
        `,
        "/lazy3.ts": /* js */ `
          import { bump } from "./shared.ts";
          export { bump };
        `,
        "/lazy4.ts": /* js */ `
          import { bump } from "./shared.ts";
          export { bump };
        `,
        "/shared.ts": /* js */ `
          let n = 0;
          export function bump() { return ++n; }
        `,
      },
      run: {
        stdout: "1 2 3\nredirected\n4 5\n6 7",
      },
      onAfterBundle(api) {
        const payload = readFileSync(api.outfile).toString("latin1");
        const imports = payload.match(/from "(\/\$bunfs|B:\/~BUN)\/root\/chunk-[0-9a-z]+\.js"/g) ?? [];
        expect(imports).toHaveLength(4);
        expect(new Set(imports).size).toBe(1);
      },
    });
  });
});
