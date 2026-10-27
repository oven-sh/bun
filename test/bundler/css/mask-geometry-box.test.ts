import { describe, expect } from "bun:test";
import { itBundled } from "../expectBundled";

describe("css", () => {
  itBundled("css/mask-geometry-box-preserved", {
    files: {
      "index.css": /* css */ `
        .test-a::after {
            mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
        }
        .test-b::after {
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      const output = api.readFile("/out/index.css");
      expect(output).toContain("padding-box");
      expect(output).toContain("content-box");
      expect(output).toContain(".test-a");
      expect(output).toContain(".test-b");
      expect(output).not.toContain(".test-a:after, .test-b:after");
    },
  });

  itBundled("css/webkit-mask-geometry-box-preserved", {
    files: {
      "index.css": /* css */ `
        .test-c::after {
            -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      const output = api.readFile("/out/index.css");
      expect(output).toContain("padding-box");
    },
  });

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
