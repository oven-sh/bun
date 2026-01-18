import { itBundled } from "../expectBundled";

describe("css", () => {
  itBundled("css/is-selector", {
    virtual: true,
    files: {
      "/index.css": /* css */ `
        .foo:is(input:checked) {
           color: red;
        }
      `,
    },
    outfile: "/out.css",
    onAfterBundle(api) {
      api.expectFile("/out.css").toMatchInlineSnapshot(`
        "/* ../../index.css */
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
