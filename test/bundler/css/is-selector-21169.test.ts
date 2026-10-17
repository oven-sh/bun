import { describe, expect } from "bun:test";
import { itBundled } from "../expectBundled";

describe("css", () => {
  itBundled("css/is-selector", {
    files: {
      "index.css": /* css */ `
        .foo:is(input:checked) {
           color: red;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        .foo:-webkit-any(input:checked) {
          color: red;
        }

        .foo:-moz-any(input:checked) {
          color: red;
        }

        .foo:is(input:checked) {
          color: red;
        }
        "
      `);
    },
  });

  // `:-webkit-any()` always counts as one pseudo-class, (0,1,0), in Blink and
  // WebKit. For `:is()` / `:not()` lists whose arguments are all below that, a
  // prefixed copy would outrank the standard rule in current browsers and flip
  // cascades the authored CSS loses, so no prefixed copy is emitted for them.
  itBundled("css/is-selector-no-any-below-class-specificity", {
    files: {
      "index.css": /* css */ `
        .d .e { color: blue }
        :not(span, p) .e { color: red }
        .b:is(*) { color: blue }
        :is(section, div) .q { color: green }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      const out = api.readFile("/out/index.css");
      expect(out).not.toContain("-webkit-any");
      expect(out).not.toContain("-moz-any");
      expect(out).toContain(".b:is(*)");
      expect(out).toContain(":is(section, div) .q");
    },
  });
});
