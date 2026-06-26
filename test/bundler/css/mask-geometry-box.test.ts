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
});
