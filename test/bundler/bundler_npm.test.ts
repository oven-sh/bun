import assert from "assert";
import dedent from "dedent";
import { ESBUILD, itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

describe("bundler", () => {
  itBundled("npm/ReactSSR", {
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

        const port = 42001;
        const server = Bun.serve({
          port,
          async fetch(req) {
            return new Response(await renderToReadableStream(<App />), headers);
          },
        });
        const res = await fetch("http://localhost:" + port);
        if (res.status !== 200) throw "status error";
        console.log(await res.text());
        server.stop();
      `,
    },
    run: {
      stdout: "<!DOCTYPE html><html><head></head><body><h1>Hello World</h1><p>This is an example.</p></body></html>",
    },
  });
  itBundled("npm/LodashES", {
    install: ["lodash-es"],
    files: {
      "/entry.ts": /* tsx */ `
        import { isEqual } from "lodash-es";

        // https://github.com/oven-sh/bun/issues/3206
        if(!isEqual({a: 1}, {a: 1})) throw "error 1";
        if(isEqual({a: 1}, {a: 2})) throw "error 2";

        console.log('pass')
      `,
    },
    run: {
      stdout: "pass",
    },
  });
});
