import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

// https://github.com/oven-sh/bun/issues/40364
// The default browser targets must support :is()/:where(), so a selector
// list that uses them stays one rule instead of being split per selector.
describe("css", () => {
  itBundled("css/where-selector-list-preserved", {
    files: {
      "index.css": /* css */ `
        :where(.a .b), :where(.c) {
          color: red;
          padding: 4px;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        :where(.a .b), :where(.c) {
          color: red;
          padding: 4px;
        }
        "
      `);
    },
  });

  itBundled("css/where-selector-list-preserved-minified", {
    files: {
      "index.css": /* css */ `
        :where(.a .b), :where(.c) {
          color: red;
          padding: 4px;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    minifyWhitespace: true,
    minifySyntax: true,
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        ":where(.a .b),:where(.c){color:red;padding:4px}
        "
      `);
    },
  });

  itBundled("css/is-selector-list-preserved", {
    files: {
      "index.css": /* css */ `
        :is(.a .b), :is(.c) {
          color: red;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        :is(.a .b), .c {
          color: red;
        }
        "
      `);
    },
  });

  // firefox 104 (in the default targets) lacks :has(), so the list is
  // downleveled, but into a single :is()-wrapped rule instead of one rule
  // per selector with duplicated declarations.
  itBundled("css/has-selector-list-not-duplicated", {
    files: {
      "index.css": /* css */ `
        :has(.a), :has(.c) {
          color: red;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    minifyWhitespace: true,
    minifySyntax: true,
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        ":is(:has(.a),:has(.c)){color:red}
        "
      `);
    },
  });

  itBundled("css/where-selector-list-with-pseudo-elements-preserved", {
    files: {
      "index.css": /* css */ `
        :where(.a)::before, :where(.c)::before, :where(.a)::after, :where(.c)::after {
          content: "";
          position: absolute;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        :where(.a):before, :where(.c):before, :where(.a):after, :where(.c):after {
          content: "";
          position: absolute;
        }
        "
      `);
    },
  });
});
