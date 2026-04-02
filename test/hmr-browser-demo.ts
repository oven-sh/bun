/**
 * Browser-testable HMR demo using import attributes + Bun.serve().
 *
 * Run:   bun bd test/hmr-browser-demo.ts
 * Then open the printed URL in a browser.
 *
 * To test HMR:
 *  1. Click Increment a few times
 *  2. Edit test/hmr-demo/Counter.tsx — change colors/text
 *  3. The component should update without losing the counter state
 */
import { join, basename } from "path";

import bundle from "./hmr-demo/index.tsx" with { type: "bundle" };

// Build exact route map from known file names. The handlers read
// bundle.files dynamically so they always serve the latest blob
// after HMR rebuilds (the blob objects are replaced on each rebuild).
const assetRoutes = Object.fromEntries(
  bundle.files.map((f: any) => [
    `/assets/${basename(f.name)}`,
    () =>
      new Response(bundle.files.find((b: any) => b.name === f.name)!.file(), { headers: { "Content-Type": f.type } }),
  ]),
);

const server = Bun.serve({
  port: 0,
  routes: {
    ...assetRoutes,
    "/*": () =>
      new Response(
        `<!DOCTYPE html>
          <html>
          <head><title>HMR Test</title></head>
          <body>
            <div id="root"></div>
            <script src="/assets/${basename(bundle.entrypoint.name)}"></script>
          </body>
          </html>`,
        { headers: { "Content-Type": "text/html" } },
      ),
  },
});

console.log(`Open: http://localhost:${server.port}`);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
