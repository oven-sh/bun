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
});
