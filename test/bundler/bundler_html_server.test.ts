import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

// A standalone executable imports two HTML pages and serves them through Bun.serve routes.
// One compile per build backend covers both pages, their shared stylesheet, and their script.
describe.concurrent("bundler", () => {
  for (const backend of ["api", "cli"] as const) {
    itBundled(`compile/${backend}/HTMLServer`, {
      compile: true,
      backend,
      files: {
        "/entry.ts": /* js */ `
          import home from "./home.html";
          import about from "./about.html";

          using server = Bun.serve({
            port: 0,
            routes: {
              "/": home,
              "/about": about,
              // The same page under a prefix. Its asset URLs must stay root-absolute,
              // or a browser would request them under /foo/ (issue #27465).
              "/foo/": home,
              "/foo/*": home,
            },
          });

          async function get(url, base = server.url) {
            const res = await fetch(new URL(url, base));
            return { status: res.status, contentType: res.headers.get("content-type"), body: await res.text() };
          }

          const pages = {};
          for (const pathname of ["/", "/about", "/foo/", "/foo/deep"]) {
            const page = await get(pathname);
            const assets = {};
            for (const [, url] of page.body.matchAll(/(?:href|src)="([^"]+)"/g)) {
              // Resolve against the page URL, as a browser does.
              assets[url] = await get(url, new URL(pathname, server.url));
            }
            pages[pathname] = { ...page, assets };
          }
          console.log(JSON.stringify(pages));
        `,
        // Each page is one line, so the served HTML below can be compared exactly.
        "/home.html": /* html */ `<!DOCTYPE html><html><head><title>Home</title><link rel="stylesheet" href="./styles.css"></head><body><h1>Home Page</h1><script src="./app.ts"></script></body></html>`,
        "/about.html": /* html */ `<!DOCTYPE html><html><head><title>About</title><link rel="stylesheet" href="./styles.css"></head><body><h1>About Page</h1><script src="./app.ts"></script></body></html>`,
        "/styles.css": /* css */ `
          body {
            margin: 0;
            font-family: sans-serif;
          }
        `,
        "/app.ts": /* ts */ `
          const message: string = "App loaded";
          console.log(message);
        `,
      },
      run: {
        stderr: "",
        validate({ stdout }) {
          // Asset names carry a content hash. Replace it so the expected objects below are stable.
          const pages = JSON.parse(stdout.replaceAll(/chunk-[a-z0-9]+\./g, "chunk-[hash]."));
          const assets = {
            "/chunk-[hash].css": {
              status: 200,
              contentType: "text/css;charset=utf-8",
              body: "/* styles.css */\nbody {\n  margin: 0;\n  font-family: sans-serif;\n}\n",
            },
            "/chunk-[hash].js": {
              status: 200,
              contentType: "text/javascript;charset=utf-8",
              body: '// app.ts\nvar message = "App loaded";\nconsole.log(message);\n',
            },
          };
          const home = {
            status: 200,
            contentType: "text/html;charset=utf-8",
            body: `<!DOCTYPE html><html><head><title>Home</title><link rel="stylesheet" crossorigin href="/chunk-[hash].css"><script type="module" crossorigin src="/chunk-[hash].js"></script></head><body><h1>Home Page</h1></body></html>\n`,
            assets,
          };
          const about = {
            status: 200,
            contentType: "text/html;charset=utf-8",
            body: `<!DOCTYPE html><html><head><title>About</title><link rel="stylesheet" crossorigin href="/chunk-[hash].css"><script type="module" crossorigin src="/chunk-[hash].js"></script></head><body><h1>About Page</h1></body></html>\n`,
            assets,
          };
          expect(pages).toEqual({ "/": home, "/about": about, "/foo/": home, "/foo/deep": home });
        },
      },
    });
  }
});
