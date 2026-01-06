import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { itBundled } from "./expectBundled";

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
      stderr: [
        "[Disk Cache] Cache hit for sourceCode",

        // TODO: remove this line once bun:main is removed.
        "[Disk Cache] Cache miss for sourceCode",

        "[Disk Cache] Cache hit for sourceCode",

        // TODO: remove this line once bun:main is removed.
        "[Disk Cache] Cache miss for sourceCode",
      ].join("\n"),
      env: {
        BUN_JSC_verboseDiskCache: "1",
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
    todo: isWindows, // TODO(@paperclover)
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
        const icon = await fetch("https://bun.sh/favicon.ico").then(x=>x.arrayBuffer())
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
      `,
    },
    run: [
      {
        stdout: "This is compiled code",
      },
      {
        env: { BUN_BE_BUN: "1" },
        validate({ stdout }) {
          expect(stdout).not.toContain("This is compiled code");
        },
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
  });

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
  });
});
