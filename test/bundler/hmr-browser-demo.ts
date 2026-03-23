/**
 * Browser-testable HMR demo using import attributes + Bun.serve().
 *
 * Run:   bun bd test/bundler/hmr-browser-demo.ts
 * Then open the printed URL in a browser.
 *
 * To test HMR:
 *  1. Click Increment a few times
 *  2. Edit test/bundler/hmr-demo/Counter.tsx — change colors/text
 *  3. The component should update without losing the counter state
 */
import { join } from "path";

import bundle from "./hmr-demo/index.tsx" with { type: "bundle" };

const demoDir = join(import.meta.dir, "hmr-demo");

const server = Bun.serve({
  port: 0,
  routes: {
    "/assets/*": bundle,
    "/*": () =>
      new Response(
        `<!DOCTYPE html>
<html>
<head><title>HMR Test</title></head>
<body>
  <div id="root"></div>
  <script src="/assets/${bundle.entrypoint.name}"></script>
</body>
</html>`,
        { headers: { "Content-Type": "text/html" } },
      ),
  },
});

console.log(`\nOpen: http://localhost:${server.port}`);
console.log(`Edit: ${join(demoDir, "Counter.tsx")}\n`);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
