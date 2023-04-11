import assert from "assert";
import dedent from "dedent";
import { bundlerTest, expectBundled, itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

describe("bundler", () => {
  itBundled("edgecase/EmptyFile", {
    files: {
      "/entry.js": "",
    },
  });
  itBundled("edgecase/ImportStarFunction", {
    files: {
      "/entry.js": /* js */ `
        import * as foo from "./foo.js";
        console.log(foo.fn());
      `,
      "/foo.js": /* js */ `
        export function fn() {
          return "foo";
        }
      `,
    },
    run: { stdout: "foo" },
  });
  itBundled("default/ImportStarSyntaxErrorBug", {
    // bug: 'import {ns}, * as import_x from "x";'
    files: {
      "/entry.js": /* js */ `
        export {ns} from 'x'
        export * as ns2 from 'x'
      `,
    },
    external: ["x"],
    runtimeFiles: {
      "/node_modules/x/index.js": `export const ns = 1`,
    },
    run: true,
  });
});
