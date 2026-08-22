import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

// With BUN_JSC_verboseDiskCache=1 JSC prints a "[Disk Cache] Cache hit/miss" line
// for every top-level code block it compiles, and with
// BUN_JSC_reportBytecodeCacheDecodeTimes=1 a "BytecodeCache: decoded <path>" line
// for every module whose embedded bytecode was used. Every thread prints its own
// lines, so the counts show which modules each worker ran from bytecode. The one
// expected miss per thread is the synthetic bun:main wrapper, which is not part
// of the binary.
const bytecodeCacheEnv = {
  BUN_JSC_verboseDiskCache: "1",
  BUN_JSC_reportBytecodeCacheDecodeTimes: "1",
};

function bytecodeCacheStats(stderr: string) {
  let hits = 0;
  let misses = 0;
  const decoded: Record<string, number> = {};
  for (const line of stderr.split("\n")) {
    if (line.includes("[Disk Cache] Cache hit for sourceCode")) {
      hits++;
    } else if (line.includes("[Disk Cache] Cache miss for sourceCode")) {
      misses++;
    } else {
      const match = /^BytecodeCache: decoded (.+) \(\d+ bytes\)/.exec(line.trim());
      if (match) {
        const name = match[1].split(/[\\/]/).pop()!;
        decoded[name] = (decoded[name] ?? 0) + 1;
      }
    }
  }
  return { hits, misses, decoded };
}

const workerCount = 4;

describe("bundler", () => {
  describe("compile with splitting", () => {
    // Every thread wraps the same embedded bytecode in its own CachedBytecode, so
    // worker_threads loading the entry point and the split chunks it imports must
    // run all of them from bytecode, exactly like the main thread does.
    itBundled("compile/splitting/WorkerThreadsSameEntryBytecode+minify", {
      compile: true,
      splitting: true,
      bytecode: true,
      format: "esm",
      minifySyntax: true,
      minifyIdentifiers: true,
      minifyWhitespace: true,
      files: {
        "/entry.ts": /* js */ `
          import { Worker, isMainThread, parentPort } from "node:worker_threads";

          async function run() {
            const [{ task }, { other }] = await Promise.all([import("./task.ts"), import("./other.ts")]);
            return task(10) + other(5);
          }

          if (isMainThread) {
            const main = await run();
            const workers = await Promise.all(
              Array.from({ length: ${workerCount} }, () => new Promise((resolve, reject) => {
                const worker = new Worker(new URL(import.meta.url));
                worker.on("message", resolve);
                worker.on("error", reject);
                worker.on("exit", code => {
                  if (code !== 0) reject(new Error("worker exited with " + code));
                });
              })),
            );
            console.log(JSON.stringify({ main, workers }));
          } else {
            parentPort.postMessage(await run());
          }
        `,
        "/task.ts": /* js */ `
          import { shared } from "./shared.ts";
          export function task(n) {
            return shared("task", n) * 2;
          }
        `,
        "/other.ts": /* js */ `
          import { shared } from "./shared.ts";
          export function other(n) {
            return shared("other", n) + 1;
          }
        `,
        "/shared.ts": /* js */ `
          export function shared(label, n) {
            let total = 0;
            for (let i = 0; i < n; i++) total += i;
            return total + label.length;
          }
        `,
      },
      run: {
        stdout: JSON.stringify({ main: 114, workers: Array(workerCount).fill(114) }),
        env: bytecodeCacheEnv,
        validate({ stderr }) {
          const threads = 1 + workerCount;
          const { hits, misses, decoded } = bytecodeCacheStats(stderr);
          expect(misses).toBe(threads);
          expect(Object.keys(decoded)).toEqual(
            expect.arrayContaining([expect.stringMatching(/^task-\w+\.js$/), expect.stringMatching(/^other-\w+\.js$/)]),
          );
          // The entry and every split chunk are decoded once per thread.
          expect(decoded).toEqual(Object.fromEntries(Object.keys(decoded).map(name => [name, threads])));
          expect(hits).toBe(threads * Object.keys(decoded).length);
        },
      },
    });

    // Here the worker entry and the chunks only it imports are loaded for the
    // first time by several threads at once, not by the main thread first.
    itBundled("compile/splitting/WorkerThreadsSeparateEntryBytecode+minify", {
      backend: "cli",
      compile: true,
      splitting: true,
      bytecode: true,
      format: "esm",
      minifySyntax: true,
      minifyIdentifiers: true,
      minifyWhitespace: true,
      files: {
        "/entry.ts": /* js */ `
          import { Worker } from "node:worker_threads";

          const workers = await Promise.all(
            Array.from({ length: ${workerCount} }, () => new Promise((resolve, reject) => {
              const worker = new Worker("./worker.ts");
              worker.on("message", resolve);
              worker.on("error", reject);
              worker.on("exit", code => {
                if (code !== 0) reject(new Error("worker exited with " + code));
              });
            })),
          );
          console.log(JSON.stringify(workers));
        `,
        "/worker.ts": /* js */ `
          import { parentPort } from "node:worker_threads";
          import { shared } from "./shared.ts";
          const { lazy } = await import("./lazy.ts");
          parentPort.postMessage(shared(10) + lazy());
        `,
        "/lazy.ts": /* js */ `
          import { shared } from "./shared.ts";
          export function lazy() {
            return shared(4) + 1000;
          }
        `,
        "/shared.ts": /* js */ `
          export function shared(n) {
            let total = 0;
            for (let i = 0; i < n; i++) total += i;
            return total;
          }
        `,
      },
      entryPointsRaw: ["./entry.ts", "./worker.ts"],
      outfile: "dist/out",
      run: {
        file: "dist/out",
        setCwd: true,
        stdout: JSON.stringify(Array(workerCount).fill(1051)),
        env: bytecodeCacheEnv,
        validate({ stderr }) {
          const { hits, misses, decoded } = bytecodeCacheStats(stderr);
          expect(misses).toBe(1 + workerCount);
          const lazyChunk = Object.keys(decoded).find(name => /^lazy-\w+\.js$/.test(name));
          expect(lazyChunk).toBeDefined();
          expect(decoded).toEqual(expect.objectContaining({ "worker.js": workerCount, [lazyChunk!]: workerCount }));
          expect(hits).toBe(Object.values(decoded).reduce((sum, count) => sum + count, 0));
          // Main entry once, then worker.js, the chunk holding shared.ts and the
          // lazy.ts chunk once per worker.
          expect(hits).toBeGreaterThanOrEqual(1 + 3 * workerCount);
          // A module is decoded by the main thread, by every worker, or by both;
          // never by only some of the workers.
          const partiallyDecoded = Object.entries(decoded).filter(
            ([, count]) => count !== 1 && count !== workerCount && count !== workerCount + 1,
          );
          expect(partiallyDecoded).toEqual([]);
        },
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
  });
});
