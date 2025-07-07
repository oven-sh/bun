import { describe, expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

/**
 * Enure that node builtins imported on the server behave properly
 */
describe("node builtin test", () => {
  /**
   *
   * This creates a minimal reproduction of an issue when VFile was imported on the dev server.
   *
   * The issue was that it was importing node:process and this was not correctly handled
   */
  devTest("vfile import in server component", {
    framework: minimalFramework,
    files: {
      "node_modules/vfile/package.json": JSON.stringify({
        name: "vfile",
        version: "6.0.3",
        type: "module",
        exports: {
          ".": "./lib/index.js",
        },
      }),
      "node_modules/vfile/lib/process.js": `
      export { default as minproc } from 'process';
    `,
      "node_modules/vfile/lib/index.js": `
      // Minimal VFile implementation for testing
      import { minproc } from './process.js';
      
      export class VFile {
        constructor(value) {
          this.value = value;
          this.data = {};
          this.messages = [];
          this.history = [];
          this.cwd = minproc.cwd();
        }
      }
    `,
      "routes/test.ts": `
      import { VFile } from "vfile";

      export default function (req, meta) {
        const foo = new VFile("hello world");
        console.log(foo.value);
        
        return new Response(\`VFile content: \${foo.value}\`, {
          headers: { "Content-Type": "text/plain" }
        });
      }
    `,
    },
    async test(dev) {
      // Test that the dev server can bundle the page without errors
      const response = await dev.fetch("/test");
      expect(response.status).toBe(200);

      // Check that VFile is properly bundled and works
      const text = await response.text();
      expect(text).toBe("VFile content: hello world");
    },
  });
});
