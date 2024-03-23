import assert from "assert";
import dedent from "dedent";
import { ESBUILD, itBundled, testForFile } from "./expectBundled";
import { Database } from "bun:sqlite";
var { describe, test, expect } = testForFile(import.meta.path);

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
    todo: process.platform === "win32", // TODO(@paperdave)
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
  itBundled("compile/ReactSSR", {
    install: ["react@next", "react-dom@next"],
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

        const port = 0;
        const server = Bun.serve({
          port,
          async fetch(req) {
            return new Response(await renderToReadableStream(<App />), headers);
          },
        });
        const res = await fetch(server.url);
        if (res.status !== 200) throw "status error";
        console.log(await res.text());
        server.stop(true);
      `,
    },
    run: {
      stdout: "<!DOCTYPE html><html><head></head><body><h1>Hello World</h1><p>This is an example.</p></body></html>",
    },
    compile: true,
  });
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
});
