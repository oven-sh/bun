import { describe } from "bun:test";
import { itBundled } from "../../bundler/expectBundled";

describe("bundler", () => {
  // Test that `bun build --compile` produces absolute asset URLs in HTML,
  // so that assets load correctly when served from nested routes like "/foo/".
  // Regression test for https://github.com/oven-sh/bun/issues/27465
  for (const backend of ["api", "cli"] as const) {
    itBundled(`compile/${backend}/HTMLNestedRouteAssetURLs`, {
      compile: true,
      backend: backend,
      files: {
        "/entry.ts": /* js */ `
          import { serve } from "bun";
          import index from "./index.html";

          const server = serve({
            port: 0,
            routes: {
              "/foo/": index,
              "/foo/*": index,
            },
          });

          const res = await fetch(server.url + "foo/");
          const html = await res.text();

          const srcMatch = html.match(/src="([^"]+)"/);
          if (!srcMatch) {
            console.log("ERROR: no src attribute found in HTML");
            server.stop(true);
            process.exit(1);
          }
          const src = srcMatch[1];
          if (src.startsWith("./")) {
            console.log("FAIL: relative URL " + src);
            server.stop(true);
            process.exit(1);
          }

          // Asset URLs should be absolute (start with "/")
          const assetRes = await fetch(server.url + src.slice(1));
          if (!assetRes.ok) {
            console.log("FAIL: asset not accessible at " + src);
            server.stop(true);
            process.exit(1);
          }

          console.log("Asset URL is absolute: " + src);
          server.stop(true);
        `,
        "/index.html": /* html */ `
          <!DOCTYPE html>
          <html>
            <head><title>Test</title></head>
            <body>
              <h1>Hello</h1>
              <script src="./app.ts"></script>
            </body>
          </html>
        `,
        "/app.ts": /* js */ `
          console.log("client loaded");
        `,
      },
      run: {
        stdout: /Asset URL is absolute: \/.+/,
      },
    });
  }
});
