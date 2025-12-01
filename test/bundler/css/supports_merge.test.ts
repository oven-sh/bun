import { itBundled } from "../expectBundled";

describe("css", () => {
  itBundled("css/SupportsMerge", {
    files: {
      "index.css": /* css */ `
      .test {
        border-top: 1px solid red;
        @supports (color: blue) {
          border-top: 1px solid blue;
        }
        @supports (color: blue) {
          border-left: 1px solid blue;
        }
        @supports (color: blue) {
          border-bottom: 1px solid blue;
        }
        @supports (color: blue) {
          border-right: 1px solid blue;
        }
        @supports (color: blue) {
          box-shadow: 0 0 10px blue;
        }
      }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    minifySyntax: true,
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toContain(".test{border-top:1px solid red}@supports (color: blue){.test{border-top:1px solid #00f}.test{border-left:1px solid #00f}.test{border-bottom:1px solid #00f}.test{border-right:1px solid #00f}.test{box-shadow:0 0 10px #00f}}");
    },
  });
});
