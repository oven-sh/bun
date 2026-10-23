import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

describe("css", () => {
  // The default browser targets include engines that only match `:autofill`
  // as `:-webkit-autofill`, so the rule is printed once per prefix.
  itBundled("css/prefixed-pseudo-class-default-targets", {
    files: {
      "index.css": /* css */ `
        input:autofill {
          color: red;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        input:-webkit-autofill {
          color: red;
        }

        input:autofill {
          color: red;
        }
        "
      `);
    },
  });
});
