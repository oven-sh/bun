import { describe } from "bun:test";
import { isWindows } from "harness";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("npm/ReactSSR", {
    todo: isWindows, // TODO
    install: ["react@18.3.1", "react-dom@18.3.1"],
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
        using server = Bun.serve({
          port,
          async fetch(req) {
            return new Response(await renderToReadableStream(<App />), headers);
          },
        });
        const res = await fetch("http://localhost:" + server.port);
        if (res.status !== 200) throw "status error";
        console.log(await res.text());
      `,
    },
    // this test serves two purposes
    // - does react work when bundled
    // - do sourcemaps on a real-world library work
    sourceMap: "external",
    outdir: "out/",
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    snapshotSourceMap: {
      "entry.js.map": {
        files: [
          "../node_modules/react/cjs/react.development.js",
          "../node_modules/react/cjs/react-jsx-dev-runtime.development.js",
          "../node_modules/react-dom/cjs/react-dom-server-legacy.browser.development.js",
          "../node_modules/react-dom/cjs/react-dom-server.browser.development.js",
          "../node_modules/react-dom/server.browser.js",
          "../entry.tsx",
        ],
        mappings: [
          ["react.development.js:524:'getContextName'", "1:5623:at"],
          ["react.development.js:2495:'actScopeDepth'", "23:4082:or++"],
          ["react.development.js:696:''Component'", '1:7685:\'Component "%s"'],
          ["entry.tsx:6:'\"Content-Type\"'", '100:18806:"Content-Type"'],
          ["entry.tsx:11:'<html>'", "100:19060:void"],
          ["entry.tsx:23:'await'", "100:19159:await"],
        ],
      },
    },
    expectExactFilesize: {
      "out/entry.js": 221984,
    },
    run: {
      stdout: "<!DOCTYPE html><html><body><h1>Hello World</h1><p>This is an example.</p></body></html>",
      stderr: "",
    },
  });
  itBundled("npm/LodashES", {
    install: ["lodash-es@4.17.21"],
    files: {
      "/entry.ts": /* ts */ `
        import { isEqual, isBuffer } from "lodash-es";

        // https://github.com/oven-sh/bun/issues/3206
        // isEqual calls isBuffer, whose module reads the free variables
        // "exports" and "module" to detect CommonJS.
        console.log(JSON.stringify({
          equal: isEqual({ a: 1 }, { a: 1 }),
          differentValue: isEqual({ a: 1 }, { a: 2 }),
          nested: isEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }),
          nestedDifferent: isEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }),
          isBufferType: typeof isBuffer,
        }));

        // Uncomment when https://github.com/lodash/lodash/issues/5660 is fixed
        // It prevents isBuffer from working at all since it evaluates to 'stubFalse'
        // if(!isBuffer(Buffer.from("hello"))) throw "error 3";
        // if(isBuffer("hello")) throw "error 4";
        // if(isBuffer({})) throw "error 5";
        // if(isBuffer(new Uint8Array([1]))) throw "error 6";
        // if(isBuffer(new ArrayBuffer(1))) throw "error 7";
      `,
    },
    run: {
      stdout: JSON.stringify({
        equal: true,
        differentValue: false,
        nested: true,
        nestedDifferent: false,
        isBufferType: "function",
      }),
      stderr: "",
    },
  });
});
