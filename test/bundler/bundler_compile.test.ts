import assert from "assert";
import dedent from "dedent";
import { ESBUILD, itBundled, testForFile } from "./expectBundled";
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
  itBundled("compile/VariousBunAPIs", {
    compile: true,
    files: {
      "/entry.ts": `
        // testing random features of bun
        import { Database } from "bun:sqlite";
        import { serve } from 'bun';
        import { getRandomSeed } from 'bun:jsc';
        const db = new Database("test.db");
        const query = db.query(\`select "Hello world" as message\`);
        if (query.message !== "Hello world") throw "fail from sqlite";
        const icon = await fetch("https://bun.sh/favicon.ico").then(x=>x.arrayBuffer())
        if(icon.byteLength < 100) throw "fail from icon";
        if (typeof getRandomSeed() !== 'number') throw "fail from bun:jsc";
        const server = serve({
          fetch() {
            return new Response("Hello world");
          },
          port: 42000,
        });
        const res = await fetch("http://localhost:42000");
        if (res.status !== 200) throw "fail from server";
        if (await res.text() !== "Hello world") throw "fail from server";
        server.stop();
        Bun.build();
      `,
    },
    run: true,
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
    compile: true,
  });
});
