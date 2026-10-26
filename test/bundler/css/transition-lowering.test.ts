import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

describe("css", () => {
  // The default browser targets add `-webkit-mask-box-image` in front of `mask-border`. Both keep the 2s.
  for (const backend of ["cli", "api"] as const) {
    itBundled(`css/transition-mask-border-keeps-its-duration-${backend}`, {
      backend,
      files: {
        "index.css": /* css */ `
          .a {
            transition: mask-border 2s, opacity 3s;
          }
        `,
      },
      outdir: "/out",
      entryPoints: ["/index.css"],
      onAfterBundle(api) {
        api.expectFile("/out/index.css").toMatchInlineSnapshot(`
          "/* index.css */
          .a {
            transition: -webkit-mask-box-image 2s, mask-border 2s, opacity 3s;
          }
          "
        `);
      },
    });
  }
});
