// Tests for server-side code evaluation errors that are not caught by the bundler.
// See: https://github.com/oven-sh/bun/issues/15530
import { expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

devTest("invalid regex does not crash dev server (#15530)", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function (req, meta) {
        return new Response("hello");
      }
    `,
  },
  async test(dev) {
    // First, verify the route works normally
    await dev.fetch("/").equals("hello");

    // Write a file with an invalid regex pattern. Bun's lexer does not
    // validate regex semantics (only flags and structure), so /+/ passes
    // through the bundler. When JSC evaluates the bundled server code,
    // it throws "Invalid regular expression: nothing to repeat".
    // The dev server must NOT panic - it should handle this gracefully.
    await dev.write(
      "routes/index.ts",
      'export const re = /+/;\nexport default function (req, meta) {\n  return new Response("with regex " + re);\n}\n',
      { dedent: false },
    );

    // The dev server should NOT panic. The route should still be
    // accessible (previous version continues to work).
    const response = await dev.fetch("/");
    expect(response.status).toBe(200);

    // Fix the regex error and verify the server recovers
    await dev.write(
      "routes/index.ts",
      `
      export default function (req, meta) {
        return new Response("recovered");
      }
    `,
    );
    await dev.fetch("/").equals("recovered");
  },
});
