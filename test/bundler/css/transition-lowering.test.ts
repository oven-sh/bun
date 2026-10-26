import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

describe("css", () => {
  // The default browser targets lower `inset` to four names and add a `-webkit-` name for the mask properties.
  // Each of those names keeps the duration of the entry it came from.
  for (const backend of ["cli", "api"] as const) {
    itBundled(`css/transition-lowered-entry-keeps-its-values-${backend}`, {
      backend,
      files: {
        "index.css": /* css */ `
          .shorthand {
            transition: inset 1s, mask-border 2s, opacity 3s;
          }
          .longhands {
            transition-property: mask-size, opacity;
            transition-duration: 1s, 2s;
          }
        `,
      },
      outdir: "/out",
      entryPoints: ["/index.css"],
      onAfterBundle(api) {
        api.expectFile("/out/index.css").toMatchInlineSnapshot(`
          "/* index.css */
          .shorthand {
            transition: top 1s, bottom 1s, left 1s, right 1s, -webkit-mask-box-image 2s, mask-border 2s, opacity 3s;
          }

          .longhands {
            transition-property: -webkit-mask-size, mask-size, opacity;
            transition-duration: 1s, 1s, 2s;
          }
          "
        `);
      },
    });
  }
});
