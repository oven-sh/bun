import assert from "assert";
import dedent from "dedent";
import { bundlerTest, expectBundled, itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

describe("bundler", () => {
  // TODO: I must be misunderstanding how the cjs to esm transforms work. since this should pass
  itBundled("cjs2esm/ModuleExportsFunction", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo());
      `,
      "/node_modules/lib/index.js": /* js */ `
        module.exports.foo = function() {
          return 'foo';
        }
      `,
    },
    minifySyntax: true,
    platform: "bun",
    onAfterBundle(api) {
      assert(!api.readFile("/out.js").includes("__commonJS"), "should not include the commonJS helper");
    },
  });
});
