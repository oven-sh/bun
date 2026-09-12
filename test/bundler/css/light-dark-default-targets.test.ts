import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

// The default browser targets must not rewrite light-dark() into the
// `var(--buncss-light, …) var(--buncss-dark, …)` polyfill. Those variables are
// only defined next to a `color-scheme` declaration compiled in the same
// stylesheet, so on a page that sets its scheme any other way (or not at all)
// the rewritten value is invalid at computed-value time.
describe("css", () => {
  itBundled("css/light-dark-is-not-polyfilled-by-default", {
    files: {
      "index.css": /* css */ `
        .b {
          color: light-dark(#102030, #d0e0f0);
          background-color: light-dark(white, black);
        }
        .c {
          accent-color: light-dark(red, blue);
          --c: light-dark(red, blue);
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        .b {
          color: light-dark(#102030, #d0e0f0);
          background-color: light-dark(#fff, #000);
        }

        .c {
          accent-color: light-dark(red, #00f);
          --c: light-dark(red, #00f);
        }
        "
      `);
    },
  });

  itBundled("css/light-dark-is-not-polyfilled-by-default-minified", {
    files: {
      "index.css": /* css */ `
        .b { color: light-dark(#102030, #d0e0f0) }
        .c { --c: light-dark(red, blue) }
      `,
    },
    outdir: "/out",
    minifyWhitespace: true,
    minifySyntax: true,
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        ".b{color:light-dark(#102030,#d0e0f0)}.c{--c:light-dark(red,#00f)}
        "
      `);
    },
  });

  itBundled("css/color-scheme-does-not-define-polyfill-vars-by-default", {
    files: {
      "index.css": /* css */ `
        :root {
          color-scheme: light dark;
        }
        .dark {
          color-scheme: dark;
        }
        .b {
          color: light-dark(red, blue);
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        :root {
          color-scheme: light dark;
        }

        .dark {
          color-scheme: dark;
        }

        .b {
          color: light-dark(red, #00f);
        }
        "
      `);
    },
  });
});
