import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

describe("css", () => {
  // These properties need a prefix for every Safari or Chrome that the default browser list can hold.
  const sheet = /* css */ `
    .modal { user-select: none; }
    .title { hyphens: auto; }
    .card { box-decoration-break: clone; }
    @media print { .page { print-color-adjust: exact; } }
    .fade { transition: user-select 1s; }
    .reset { user-select: initial; }
    .kept { -webkit-user-select: text; user-select: none; }
  `;

  itBundled("css/vendor-prefix-default-browsers", {
    files: { "/index.css": sheet },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        .modal {
          -webkit-user-select: none;
          user-select: none;
        }

        .title {
          -webkit-hyphens: auto;
          hyphens: auto;
        }

        .card {
          -webkit-box-decoration-break: clone;
          box-decoration-break: clone;
        }

        @media print {
          .page {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }

        .fade {
          transition: -webkit-user-select 1s, user-select 1s;
        }

        .reset {
          -webkit-user-select: initial;
          user-select: initial;
        }

        .kept {
          -webkit-user-select: text;
          user-select: none;
        }
        "
      `);
    },
  });

  // `--target=bun` has no browser list, so nothing is added.
  itBundled("css/vendor-prefix-no-browsers", {
    files: { "/index.css": sheet },
    outdir: "/out",
    entryPoints: ["/index.css"],
    target: "bun",
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        .modal {
          user-select: none;
        }

        .title {
          hyphens: auto;
        }

        .card {
          box-decoration-break: clone;
        }

        @media print {
          .page {
            print-color-adjust: exact;
          }
        }

        .fade {
          transition: user-select 1s;
        }

        .reset {
          user-select: initial;
        }

        .kept {
          -webkit-user-select: text;
          user-select: none;
        }
        "
      `);
    },
  });

  // The condition of `@import ... supports()` keeps the prefix that it is written with.
  itBundled("css/vendor-prefix-import-supports", {
    files: {
      "/index.css": /* css */ `
        @import "./a.css" supports(-webkit-user-select: none);
        @import "./b.css" supports(-moz-appearance: none);
        @import "./c.css" supports((display: grid) and (-webkit-user-select: none));
        @import "./d.css" supports((user-select: none) or (-webkit-user-select: none));
      `,
      "/a.css": `.a { color: red; }`,
      "/b.css": `.b { color: blue; }`,
      "/c.css": `.c { color: red; }`,
      "/d.css": `.d { color: red; }`,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* a.css */
        @supports ((-webkit-user-select: none)) {
          .a {
            color: red;
          }
        }

        /* b.css */
        @supports ((-moz-appearance: none)) {
          .b {
            color: #00f;
          }
        }

        /* c.css */
        @supports (display: grid) and (-webkit-user-select: none) {
          .c {
            color: red;
          }
        }

        /* d.css */
        @supports (user-select: none) or (-webkit-user-select: none) {
          .d {
            color: red;
          }
        }

        /* index.css */

        "
      `);
    },
  });
});
