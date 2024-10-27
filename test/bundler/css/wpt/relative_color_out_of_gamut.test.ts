import { describe } from "bun:test";
import { itBundled } from "../../expectBundled";

let i = 0;
const testname = () => `test-${i++}`;
describe("relative_color_out_of_gamut", () => {
  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
h1 {
  color: rgb(from color(display-p3 0 1 0) r g b / alpha);
}
      `,
    },
    outfile: "out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
/* a.css */
h1 {
    color: #00f942;
}
`);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: rgb(from lab(100 104.3 -50.9) r g b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: rgb(from lab(100 104.3 -50.9) r g b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: rgb(from lab(0 104.3 -50.9) r g b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: rgb(from lab(0 104.3 -50.9) r g b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: rgb(from lch(100 116 334) r g b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: rgb(from lch(100 116 334) r g b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: rgb(from lch(0 116 334) r g b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: rgb(from lch(0 116 334) r g b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: rgb(from oklab(1 0.365 -0.16) r g b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: rgb(from oklab(1 .365 -.16) r g b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: rgb(from oklab(0 0.365 -0.16) r g b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: rgb(from oklab(0 .365 -.16) r g b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: rgb(from oklch(1 0.399 336.3) r g b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: rgb(from oklch(1 .399 336.3) r g b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: rgb(from oklch(0 0.399 336.3) r g b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: rgb(from oklch(0 .399 336.3) r g b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hsl(from color(display-p3 0 1 0) h s l / alpha);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: #00f942;
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hsl(from lab(100 104.3 -50.9) h s l);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hsl(from lab(100 104.3 -50.9) h s l);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hsl(from lab(0 104.3 -50.9) h s l);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hsl(from lab(0 104.3 -50.9) h s l);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hsl(from lch(100 116 334) h s l);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hsl(from lch(100 116 334) h s l);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hsl(from lch(0 116 334) h s l);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hsl(from lch(0 116 334) h s l);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hsl(from oklab(1 0.365 -0.16) h s l);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hsl(from oklab(1 .365 -.16) h s l);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hsl(from oklab(0 0.365 -0.16) h s l);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hsl(from oklab(0 .365 -.16) h s l);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hsl(from oklch(1 0.399 336.3) h s l);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hsl(from oklch(1 .399 336.3) h s l);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hsl(from oklch(0 0.399 336.3) h s l);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hsl(from oklch(0 .399 336.3) h s l);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hwb(from color(display-p3 0 1 0) h w b / alpha);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: #00f942;
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hwb(from lab(100 104.3 -50.9) h w b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hwb(from lab(100 104.3 -50.9) h w b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hwb(from lab(0 104.3 -50.9) h w b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hwb(from lab(0 104.3 -50.9) h w b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hwb(from lch(100 116 334) h w b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hwb(from lch(100 116 334) h w b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hwb(from lch(0 116 334) h w b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hwb(from lch(0 116 334) h w b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hwb(from oklab(1 0.365 -0.16) h w b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hwb(from oklab(1 .365 -.16) h w b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hwb(from oklab(0 0.365 -0.16) h w b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hwb(from oklab(0 .365 -.16) h w b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hwb(from oklch(1 0.399 336.3) h w b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hwb(from oklch(1 .399 336.3) h w b);
  }
  `);
    },
  });

  itBundled(testname(), {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
  h1 {
    color: hwb(from oklch(0 0.399 336.3) h w b);
  }
        `,
    },
    outfile: "/out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
  /* a.css */
  h1 {
      color: hwb(from oklch(0 .399 336.3) h w b);
  }
  `);
    },
  });
});
