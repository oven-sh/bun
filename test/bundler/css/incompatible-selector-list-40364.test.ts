import { describe, expect } from "bun:test";
import { itBundled } from "../expectBundled";

// https://github.com/oven-sh/bun/issues/40364
// A browser drops a whole rule when one selector in its list is invalid, so
// the minifier moves selectors the browser targets do not support out of the
// rule. Selectors that fail on the same feature are dropped by the same
// browsers, so they must keep sharing one rule instead of each getting a copy
// of the declarations. The explicit-target cases live in
// test/js/bun/css/css.test.ts; this checks the default bundler targets.
describe("css", () => {
  itBundled("css/incompatible-selector-list-40364", {
    files: {
      "index.css": /* css */ `
        :where(.a), :where(.b) { color: red; padding: 4px }
        :has(.c), :has(.d) { color: blue }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    minifyWhitespace: true,
    minifySyntax: true,
    onAfterBundle(api) {
      const output = api.readFile("/out/index.css");
      expect(output).toContain(":where(.a),:where(.b){color:red;padding:4px}");
      expect(output.split("color:red").length - 1).toBe(1);
      expect(output.split("color:#00f").length - 1).toBe(1);
    },
  });
});
