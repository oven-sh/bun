import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { BundlerTestInput, itBundled as itBundledBase } from "./expectBundled";

// Default to the CLI backend. We intentionally use plain `describe` here
// (not `describe.concurrent`): since the ELF-section inject path was added,
// each `bun build --compile` on Linux reads + rewrites the full executable
// (~500MB for profile builds). Running 20 of these concurrently exhausts CI
// memory/IO and causes subprocess timeouts — see build #40193 failures.
const itBundled = (id: string, opts: BundlerTestInput) => itBundledBase(id, { backend: "cli", ...opts });

describe("bundler", () => {
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
  // Two modules with the same bytes. The executable reads each by its own type.
  for (const order of ["file-first", "text-first"]) {
    const imports = [`import path from "./t.txt" with { type: "file" };`, `import text from "./t.txt";`];
    itBundled(`compile/FileAndTextOfOneFile/${order}`, {
      compile: true,
      files: {
        "/entry.ts": /* js */ `
          ${(order === "file-first" ? imports : imports.reverse()).join("\n")}
          console.log(path.endsWith(".txt"), text, await Bun.file(path).text());
        `,
        "/t.txt": "hello world",
      },
      run: { stdout: "true hello world hello world" },
    });
  }
  // A file imported with { type: "file" } is embedded byte for byte, whatever it begins with and whatever its extension.
  itBundled("compile/EmbeddedFileKeepsItsBytes", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import { readFileSync } from "fs";
        import utf8Bin from "./utf8.bin" with { type: "file" };
        import utf8Txt from "./utf8.txt" with { type: "file" };
        import utf8Js from "./utf8.js" with { type: "file" };
        import utf16Bin from "./utf16.bin" with { type: "file" };
        import utf16Json from "./utf16.json" with { type: "file" };
        import bytesBin from "./bytes.bin" with { type: "file" };
        import bytesTs from "./bytes.ts" with { type: "file" };
        for (const path of [utf8Bin, utf8Txt, utf8Js, utf16Bin, utf16Json, bytesBin, bytesTs]) {
          console.log(readFileSync(path).toString("hex"));
        }
      `,
      "/utf8.bin": Buffer.from("efbbbf61620a", "hex"),
      "/utf8.txt": Buffer.from("efbbbf61620a", "hex"),
      "/utf8.js": Buffer.from("efbbbf61620a", "hex"),
      "/utf16.bin": Buffer.from("fffe61006200", "hex"),
      "/utf16.json": Buffer.from("fffe61006200", "hex"),
      "/bytes.bin": Buffer.from("fffe000180810a", "hex"),
      "/bytes.ts": Buffer.from("fffe000180810a", "hex"),
    },
    outfile: "dist/out",
    run: {
      stdout: "efbbbf61620a\nefbbbf61620a\nefbbbf61620a\nfffe61006200\nfffe61006200\nfffe000180810a\nfffe000180810a",
    },
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
});
