import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { itBundled } from "./expectBundled";

// `main.ts` loads the entry point `tool.ts` at run time. `tool.ts` loads `main.ts` back with `import()` and with
// `require()`, and `main.ts` prints what each of the two returns, or the first line of its error.
const entryPointImportedBack = {
  "main.ts": /* js */ `
    export const who = "main";
    console.log("main ran");
    const settle = async (f: () => unknown) => { try { return await f(); } catch (e) { return String(e).split("\\n")[0]; } };
    const s = (x: string) => x;
    import(s("./tool.ts")).then(async tool => console.log(await settle(tool.viaImport), await settle(tool.viaRequire)));
  `,
  "tool.ts": /* js */ `
    export const viaImport = async () => (await import("./main.ts")).who;
    export const viaRequire = () => require("./main.ts").who;
  `,
};

// Runs `bun build --compile --splitting <args>` in `dir`, then runs the executable that it writes.
// On Windows, `executable` gets `.exe`.
async function buildAndRun(dir: string, args: string[], executable: string) {
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--splitting", ...args],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildStderr).toBe("");
  expect(buildExitCode).toBe(0);

  await using proc = Bun.spawn({
    cmd: [join(dir, isWindows ? executable + ".exe" : executable)],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
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

    // In an executable, nothing folds into the entry's own chunk; chunks shared
    // between `import()` targets still fold into the first target's chunk.
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

    // The executable embeds its entry point at `/$bunfs/root/<outfile>`. A chunk that loads the entry point with
    // `import()` or `require()` must name that path, and must get the module that already ran, not a second copy.
    // The "api" backend of `itBundled` sets `naming.entry` to the name of the outfile, and that also names the chunk of
    // the entry point. The "cli" backend does not, so this test uses it.
    itBundled("compile/splitting/ImportEntryPointFromLazyChunk", {
      backend: "cli",
      compile: true,
      splitting: true,
      files: {
        "/entry.ts": /* js */ `
          export const who = "entry";
          console.log("entry ran");
          const settle = async (f: () => unknown) => { try { return await f(); } catch (e) { return String(e).split("\\n")[0]; } };
          import("./lazy.ts").then(async lazy => console.log(await settle(lazy.viaImport), await settle(lazy.viaRequire)));
        `,
        "/lazy.ts": /* js */ `
          export const viaImport = async () => (await import("./entry.ts")).who;
          export const viaRequire = () => require("./entry.ts").who;
        `,
      },
      run: { stdout: "entry ran\nentry entry" },
    });

    itBundled("compile/splitting/ImportMainEntryPointFromOtherEntryPoint", {
      backend: "cli",
      compile: true,
      splitting: true,
      files: entryPointImportedBack,
      entryPointsRaw: ["./main.ts", "./tool.ts"],
      outfile: "dist/out",
      run: { file: "dist/out", stdout: "main ran\nmain main" },
    });

    // The chunk of the entry point has the name of the executable, and so do its source map and its metafile output.
    test.concurrent("Bun.build: import() and require() of the main entry point from another entry point", async () => {
      using dir = tempDir("compile-splitting-import-main", entryPointImportedBack);
      const result = await Bun.build({
        entrypoints: [join(String(dir), "main.ts"), join(String(dir), "tool.ts")],
        compile: { outfile: join(String(dir), "dist", "out") },
        splitting: true,
        sourcemap: "external",
        metafile: true,
      });
      expect(result.logs).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.outputs.map(output => [output.kind, basename(output.path)])).toEqual([
        ["entry-point", isWindows ? "out.exe" : "out"],
        ["sourcemap", "out.map"],
        ["sourcemap", "tool.js.map"],
      ]);
      expect(Object.keys(result.metafile!.outputs).sort()).toEqual(["./out", "./tool.js"]);
      expect(result.metafile!.outputs["./tool.js"].imports).toEqual([
        { path: "./out", kind: "dynamic-import" },
        { path: "./out", kind: "require-call" },
      ]);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("main ran\nmain main\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    // `--outfile .` writes the executable as `index`. The entry point is embedded under that name too, so `main.ts`
    // resolves `./tool.ts` next to it, and `tool.ts` can load `main.ts` back.
    test.concurrent("bun build --outfile . embeds the entry point as index", async () => {
      using dir = tempDir("compile-splitting-outfile-dot", entryPointImportedBack);
      const run = await buildAndRun(String(dir), ["./main.ts", "./tool.ts", "--outfile", "."], "index");
      expect(run).toEqual({ stdout: "main ran\nmain main\n", stderr: "", exitCode: 0 });
    });

    // Without `--outfile`, `src/index.ts` gives the name `src`. A directory has that name, so the executable is
    // written as `index` (not on Windows, where it is `src.exe`). The entry point stays embedded as `src`, and the
    // other chunks name that path.
    test.concurrent("bun build without --outfile: an entry point at src/index.ts", async () => {
      using dir = tempDir("compile-splitting-nested-index", {
        "src/index.ts": entryPointImportedBack["main.ts"],
        "src/tool.ts": entryPointImportedBack["tool.ts"].replaceAll("./main.ts", "./index.ts"),
      });
      const run = await buildAndRun(String(dir), ["./src/index.ts", "./src/tool.ts"], isWindows ? "src" : "index");
      expect(run).toEqual({ stdout: "main ran\nmain main\n", stderr: "", exitCode: 0 });
    });
  });
});
