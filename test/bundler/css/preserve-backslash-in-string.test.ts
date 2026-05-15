import { itBundled } from "../expectBundled";

describe("css", () => {
  itBundled("css/PreserveBackslashInString", {
    files: {
      "/preserve-backslash-in-string.css": `
        .fa-shop-slash {
          --fa: "\e070";
          --fa--fa: "\e070\e070";
        }

        .fa-store-alt-slash {
          --fa: "\e070";
          --fa--fa: "\e070\e070";
        }
      `,
    },
    entryPoints: ["/preserve-backslash-in-string.css"],
    outdir: "/out",

    onAfterBundle(api) {
      api.expectFile("/out/preserve-backslash-in-string.css").toEqualIgnoringWhitespace(`
/* preserve-backslash-in-string.css */
.fa-shop-slash, .fa-store-alt-slash {
  --fa: "\e070";
  --fa--fa: "\e070\e070";
}`);
    },
  });
});
