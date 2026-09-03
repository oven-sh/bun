import { describe, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { itBundled } from "./expectBundled";
import { EmbeddedModule, Flags, ModuleGraph, readModuleGraph, Span } from "./standalone-graph";

// Every compile below rewrites a copy of the whole bun executable in memory
// (hundreds of MB in a debug build, about two seconds each), so the number of
// compiles is what this file costs on the test side. Cases that share a build
// configuration share one executable, and the module graph embedded in it is
// checked next to the run. Compiles stay serial on purpose: several at once
// exhaust CI memory (see bundler_compile.test.ts).

const entryName = /^(\/\$bunfs|B:\/~BUN)\/root\/out$/;
const chunkName = /^(\/\$bunfs|B:\/~BUN)\/root\/chunk-[0-9a-z]+\.js$/;

/** The embedded paths a printed chunk loads: static imports, `import()`, and `import.meta.require()`. */
function importedPaths(source: string): string[] {
  return [
    ...source.matchAll(/\b(?:import\.meta\.require|import|from)\s*\(?\s*"((?:\/\$bunfs|B:\/~BUN)\/root\/[^"]+)"/g),
  ].map(m => m[1]);
}

function moduleContaining(graph: ModuleGraph, text: string): EmbeddedModule {
  const found = graph.modules.filter(m => m.source.includes(text));
  expect(
    found.map(m => m.name),
    `exactly one embedded module contains ${JSON.stringify(text)}`,
  ).toHaveLength(1);
  return found[0];
}

/** Every embedded path a chunk loads names a module of the graph. */
function expectImportsResolve(graph: ModuleGraph) {
  const names = graph.modules.map(m => m.name);
  for (const module of graph.modules) {
    for (const path of importedPaths(module.source)) {
      expect(names, `${module.name} loads ${path}`).toContain(path);
    }
  }
}

describe("bundler", () => {
  describe("compile with splitting", () => {
    // The executable's loader registers an entry's whole static-import closure before JSC walks the graph. These
    // shapes must still load and link in order: a cycle back through the entry, builtins reached from pre-registered
    // chunks, two dynamic imports issued back to back whose closures overlap, and a dynamic import of a chunk that an
    // earlier closure already registered but has not finished loading.
    for (const bytecode of [false, true]) {
      itBundled(`compile/splitting/PreRegisteredClosure${bytecode ? "+bytecode" : ""}`, {
        compile: true,
        splitting: true,
        bytecode,
        format: "esm",
        files: {
          "/entry.ts": /* js */ `
            import { a } from "./a";
            import { isAbsolute } from "node:path";
            import { run } from "./run";
            export const fromEntry = "entry";
            console.log("static", a, isAbsolute("/x"));
            run();
          `,
          "/run.ts": /* js */ `
            export async function run() {
              const [x, y, s] = await Promise.all([import("./lazy-x"), import("./lazy-y"), import("./shared")]);
              console.log("dynamic", x.value, y.value, s.sharedValue);
            }
          `,
          "/a.ts": /* js */ `
            import { b } from "./b";
            import os from "os";
            export const a = "a" + b + typeof os.platform;
          `,
          "/b.ts": /* js */ `
            import { fromEntry } from "./entry";
            import { readFileSync } from "fs";
            export const b = "b" + typeof readFileSync;
            export const later = () => fromEntry;
          `,
          "/lazy-x.ts": /* js */ `
            import { sharedValue } from "./shared";
            import { createHash } from "crypto";
            export const value = "x" + sharedValue + typeof createHash;
          `,
          "/lazy-y.ts": /* js */ `
            import { sharedValue } from "./shared";
            import { inspect } from "node:util";
            export const value = "y" + sharedValue + typeof inspect;
          `,
          "/shared.ts": /* js */ `
            import { a } from "./a";
            import zlib from "zlib";
            export const sharedValue = "s" + a.length + typeof zlib.gzipSync;
          `,
        },
        run: {
          stdout: "static abfunctionfunction true\ndynamic xs18functionfunction ys18functionfunction s18function",
          // JSC logs one line per host-hook call. The graph has 7 source modules, 6 distinct builtins and 4 roots
          // (entry + 3 dynamic imports). With --bytecode each chunk carries its module record, so loading must cost a
          // host fetch per root (plus the shared chunk reached first by import()) rather than per module, and a host
          // resolve per root/builtin rather than per import edge.
          env: { BUN_JSC_dumpModuleLoadingState: "1" },
          validate({ stderr }) {
            const count = (kind: string) => stderr.split("\n").filter(l => l.startsWith(`Loader [${kind}] `)).length;
            expect(count("evaluate")).toBe(7);
            expect(count("fetch")).toBeLessThanOrEqual(bytecode ? 5 : 13);
            expect(count("resolve")).toBeLessThanOrEqual(bytecode ? 14 : 23);
          },
        },
      });
    }

    // Every name a chunk's module record carries — one, two, three and more characters, Latin-1 and UTF-16 — must
    // resolve to the same atom as the code block that reads it (the record's slots are spelled like the bytecode's),
    // and a chunk with non-ASCII text must still run from its embedded bytecode rather than miss the cache.
    itBundled("compile/splitting/ModuleRecordNamesMatchBytecode", {
      compile: true,
      splitting: true,
      bytecode: true,
      format: "esm",
      banner: "// ✓ non-ascii banner",
      files: {
        "/entry.ts": /* js */ `
          import { a, ab, abc, abcd, café, слово, "" as empty } from "./names";
          import { report } from "./report";
          const { lazy } = await import("./lazy");
          console.log(report(a, ab, abc, abcd, café, слово, empty), lazy());
        `,
        "/names.ts": /* js */ `
          export const a = 1, ab = 2, abc = 3, abcd = 4, café = 5, слово = 6;
          const empty = 7;
          export { empty as "" };
        `,
        "/report.ts": /* js */ `
          export function report(...values: number[]) { return values.join(","); }
        `,
        "/lazy.ts": /* js */ `
          import { a, ab, abc, abcd, café, слово } from "./names";
          var x = [a], xy = [ab], xyz = [abc], xyzw = [abcd], é = [café], ф = [слово], all = { x, xy, xyz, xyzw, é, ф };
          export function lazy() { return Object.values(all).flat().join("+") + "\u00e9\u0444"; }
        `,
      },
      minifyIdentifiers: false,
      run: {
        env: { BUN_JSC_verboseDiskCache: "1" },
        stdout: "1,2,3,4,5,6,7 1+2+3+4+5+6éф",
        validate({ stderr }) {
          const count = (text: string) => stderr.split("\n").filter(l => l.includes(text)).length;
          // bun:main carries no bytecode; the entry and its two chunks must hit.
          expect(count("[Disk Cache] Cache miss")).toBe(1);
          expect(count("[Disk Cache] Cache hit")).toBe(3);
        },
      },
    });

    // One executable pins the layout of the embedded module graph:
    //
    // - Modules are laid out in load order: the entry point's static imports
    //   (dependencies first), then each dynamic import's closure, breadth-first.
    //   So the table reads shared, entry, shared2, lazy1, lazy2, and every
    //   per-module region (bytecode, source text) follows the table order.
    // - The payload records how many leading modules make up the entry point's
    //   static import closure, and writes the internal-module bytecode (here
    //   node:fs and what it requires) and the string tables right after them,
    //   so a cold start prefetches one run. Lazily imported chunks come after
    //   that run.
    // - Chunks keep their hashed `chunk-<hash>.js` names inside the executable,
    //   and the entry point is keyed by the outfile name.
    itBundled("compile/splitting/ModuleGraphLayout", {
      compile: true,
      splitting: true,
      bytecode: true,
      format: "esm",
      files: {
        "/entry.ts": /* js */ `
          import { readFileSync } from "node:fs";
          import "./shared";
          console.log("mark:entry", typeof readFileSync);
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
        stdout: "mark:shared\nmark:entry function\nmark:shared2\nmark:lazy1\nmark:lazy2",
      },
      onAfterBundle(api) {
        const graph = readModuleGraph(api.outfile);
        const end = (span: Span) => span.offset + span.length;

        // Load order. Chunk names are hashed, so identify modules by their source text.
        expect(graph.modules.map(m => /mark:(\w+)"/.exec(m.source)?.[1])).toEqual([
          "shared",
          "entry",
          "shared2",
          "lazy1",
          "lazy2",
        ]);
        expect(graph.entryPointId).toBe(1);
        for (const region of ["bytecode", "contents"] as const) {
          const offsets = graph.modules.map(m => m[region].offset);
          expect(offsets, `${region} regions follow the table order`).toEqual([...offsets].sort((a, b) => a - b));
        }
        for (const module of graph.modules) {
          expect(module.bytecode.length, `${module.name} has bytecode`).toBeGreaterThan(0);
          expect(module.moduleInfo.length, `${module.name} has a module record`).toBeGreaterThan(0);
        }

        // Startup run: shared and entry, then the internal-module bytecode, then
        // the two string tables, then the lazy chunks.
        const required =
          Flags.HAS_BUILTIN_BYTECODE |
          Flags.HAS_BYTECODE_STRING_TABLE |
          Flags.HAS_STARTUP_MODULE_COUNT |
          Flags.HAS_MODULE_INFO_STRING_TABLE;
        expect(graph.flags & required).toBe(required);
        expect(graph.startupCount).toBe(2);
        const startup = graph.modules.slice(0, graph.startupCount);
        const lazy = graph.modules.slice(graph.startupCount);
        const startupEnd = Math.max(...startup.flatMap(m => [end(m.bytecode), end(m.moduleInfo)]));
        const lazyStart = Math.min(...lazy.map(m => m.bytecode.offset));
        expect(graph.builtinBytecode.length, "node:fs ships as internal-module bytecode").toBeGreaterThan(0);
        for (const region of [...graph.builtinBytecode, graph.bytecodeStringTable!, graph.moduleInfoStringTable!]) {
          expect(region.length).toBeGreaterThan(0);
          expect(region.offset).toBeGreaterThanOrEqual(startupEnd);
          expect(end(region)).toBeLessThanOrEqual(lazyStart);
        }
        expect(graph.bytecodeStringTable!.offset).toBeGreaterThanOrEqual(Math.max(...graph.builtinBytecode.map(end)));
        expect(graph.moduleInfoStringTable!.offset).toBeGreaterThanOrEqual(end(graph.bytecodeStringTable!));

        // Names.
        const entry = graph.modules[graph.entryPointId];
        expect(entry.name).toMatch(entryName);
        const chunks = graph.modules.filter(m => m !== entry).map(m => m.name);
        expect(chunks).toHaveLength(4);
        for (const name of chunks) expect(name).toMatch(chunkName);
        expect(new Set(chunks).size).toBe(4);
        expectImportsResolve(graph);
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
      onAfterBundle(api) {
        // One chunk per import() target, in load order; each import() names the
        // embedded chunk, whatever directory the source file lived in.
        const graph = readModuleGraph(api.outfile);
        expect(graph.modules).toHaveLength(4);
        const [entry, header, menu, items] = graph.modules;
        expect(graph.entryPointId).toBe(0);
        expect(entry.name).toMatch(entryName);
        expect(importedPaths(entry.source)).toEqual([header.name]);
        expect(importedPaths(header.source)).toEqual([menu.name]);
        expect(importedPaths(menu.source)).toEqual([items.name]);
        expect(importedPaths(items.source)).toEqual([]);
        for (const module of graph.modules) expect(module.bytecode.length, `${module.name} has no bytecode`).toBe(0);
      },
    });

    // A split chunk with --bytecode gets its own bytecode and module record;
    // `expectSplitChunkRecords` checks that the entry and its one chunk both
    // have them and that the entry's import() names the embedded chunk.
    const expectSplitChunkRecords = (graph: ModuleGraph) => {
      expect(graph.modules).toHaveLength(2);
      const entry = graph.modules[graph.entryPointId];
      expect(entry.name).toMatch(entryName);
      const chunk = graph.modules.find(m => m !== entry)!;
      expect(chunk.name).toMatch(chunkName);
      expect(importedPaths(entry.source)).toEqual([chunk.name]);
      for (const module of graph.modules) {
        expect(module.bytecode.length, `${module.name} has bytecode`).toBeGreaterThan(0);
        expect(module.moduleInfo.length, `${module.name} has a module record`).toBeGreaterThan(0);
      }
    };

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
        onAfterBundle(api) {
          expectSplitChunkRecords(readModuleGraph(api.outfile));
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
            onAfterBundle(api) {
              const graph = readModuleGraph(api.outfile);
              // The dead import is in no printed chunk and, with --bytecode, not
              // in the record of the chunk that holds wrapped.js: that chunk
              // requests no module at all.
              for (const module of graph.modules) expect(module.source).not.toContain("fs/promises");
              if (bytecode) {
                expect(moduleContaining(graph, "42;").moduleRecord?.requestedModules).toBe(0);
              }
              for (const module of graph.modules) {
                expect(module.bytecode.length > 0, `${module.name} bytecode`).toBe(bytecode);
              }
              if (splitting) {
                // The entry and the page chunk both import rm from shared.js's chunk.
                const shared = moduleContaining(graph, '"local rm "');
                expect(shared.name).toMatch(chunkName);
                for (const importer of [graph.modules[graph.entryPointId], moduleContaining(graph, '"page:"')]) {
                  expect(importedPaths(importer.source), `${importer.name} imports rm`).toContain(shared.name);
                }
              } else {
                expect(graph.modules.map(m => m.name)).toEqual([expect.stringMatching(entryName)]);
              }
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
        onAfterBundle(api) {
          expectSplitChunkRecords(readModuleGraph(api.outfile));
        },
      });
    }

    // The executable keys the entry point's module at `/$bunfs/root/<outfile>`,
    // so nothing may fold into the entry's own chunk: `shared` is loaded
    // whenever the entry is, and the same graph without --compile folds it into
    // the entry, which the uncompiled twin pins. An `import()` target's chunk
    // still absorbs the chunks only it and its own `import()` targets load:
    // `helper2` lands in c's chunk and d imports it from there, compiled or not.
    // The entry must not use top-level await: an awaiting entry guarantees
    // nothing to its `import()` targets, no fold is possible, and the pin has
    // nothing to block. `helper` stays in a chunk of its own because a.ts has
    // exports, so its chunk absorbs nothing.
    const minChunkSizeFiles = {
      "/entry.ts": /* js */ `
        import { shared } from "./shared";
        console.log("entry", shared());
        import("./a").then(a => {
          console.log("a", a.a());
          return import("./c");
        });
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
      "/c.ts": /* js */ `
        import { helper2 } from "./helper2";
        console.log("c", helper2());
        import("./d");
      `,
      "/d.ts": /* js */ `
        import { helper2 } from "./helper2";
        console.log("d", helper2() * 2);
      `,
      "/helper2.ts": /* js */ `
        export function helper2() { return 2 }
      `,
    };
    const minChunkSizeStdout = "entry 40\na 41\nc 2\nd 4";

    itBundled("compile/splitting/MinChunkSizeKeepsEntryChunkImportable", {
      compile: true,
      splitting: true,
      bytecode: true,
      format: "esm",
      minChunkSize: 1024 * 1024,
      files: minChunkSizeFiles,
      onAfterBundle(api) {
        const graph = readModuleGraph(api.outfile);
        // `shared` stays out of the entry's chunk, in a chunk the entry and a's chunk import.
        const entry = graph.modules[graph.entryPointId];
        expect(entry.name).toMatch(entryName);
        expect(entry.source).not.toContain("function shared");
        const shared = moduleContaining(graph, "function shared");
        expect(shared.name).toMatch(chunkName);
        expect(importedPaths(entry.source)).toContain(shared.name);
        expect(importedPaths(moduleContaining(graph, "function a()").source)).toContain(shared.name);
        const helper = moduleContaining(graph, "function helper()");
        expect(helper.name).toMatch(chunkName);
        expect(importedPaths(moduleContaining(graph, "function b()").source)).toEqual([helper.name]);
        // `helper2` folds into c's chunk, which d imports.
        const c = moduleContaining(graph, "function helper2");
        expect(c.name).toMatch(chunkName);
        expect(c.source).toContain('console.log("c"');
        expect(importedPaths(moduleContaining(graph, 'console.log("d"').source)).toEqual([c.name]);
        expectImportsResolve(graph);
      },
      run: {
        stdout: minChunkSizeStdout,
      },
    });

    itBundled("splitting/MinChunkSizeFoldsSharedIntoEntryWithoutCompile", {
      splitting: true,
      format: "esm",
      target: "bun",
      minChunkSize: 1024 * 1024,
      outdir: "/out",
      files: minChunkSizeFiles,
      onAfterBundle(api) {
        const outputs = readdirSync(api.outdir).filter(file => file.endsWith(".js"));
        const outputContaining = (text: string) => {
          const found = outputs.filter(file => api.readFile(`/out/${file}`).includes(text));
          expect(found, `exactly one output contains ${JSON.stringify(text)}`).toHaveLength(1);
          return found[0];
        };
        // Without the pin, `shared` folds into the entry and a's chunk imports it from there.
        expect(outputContaining("function shared")).toBe("entry.js");
        expect(api.readFile(`/out/${outputContaining("function a()")}`)).toContain('from "./entry.js"');
        expect(outputContaining("function helper()")).not.toBe("entry.js");
        const c = outputContaining("function helper2");
        expect(api.readFile(`/out/${c}`)).toContain('console.log("c"');
        expect(api.readFile(`/out/${outputContaining('console.log("d"')}`)).toContain(`from "./${c}"`);
      },
      run: {
        stdout: minChunkSizeStdout,
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
          // The require() calls are printed as import.meta.require() of embedded chunks.
          const graph = readModuleGraph(api.outfile);
          const required = graph.modules.flatMap(m =>
            [...m.source.matchAll(/import\.meta\.require\("([^"]+)"\)/g)].map(match => match[1]),
          );
          expect(required.length).toBeGreaterThan(0);
          for (const path of required) expect(path).toMatch(/^(\/\$bunfs|B:\/~BUN)\/root\/[^/]+\.js$/);
          expectImportsResolve(graph);
          for (const module of graph.modules) {
            expect(module.bytecode.length > 0, `${module.name} bytecode`).toBe(bytecode);
          }
        },
      });
    }
  });
});
