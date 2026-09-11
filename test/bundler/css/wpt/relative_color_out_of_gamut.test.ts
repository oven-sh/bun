import { describe } from "bun:test";
import { itBundled } from "../../expectBundled";

// https://github.com/web-platform-tests/wpt/blob/master/css/css-color/parsing/relative-color-out-of-gamut.html
//
// The WPT asserts that a relative rgb()/hsl()/hwb() color whose origin is outside the sRGB
// gamut computes to the unclamped out-of-gamut color (browsers clip it when painting), so the
// bundler must not resolve these: gamut mapping the origin gives a different color (the
// display-p3 green below used to come out as #00f942, browsers paint it as #00ff00). The
// declaration is left for the browser. What the bundler does do is its usual handling of a
// wide-gamut color literal inside a value it does not resolve: under the default browser
// targets the origin gets an sRGB fallback plus an `@supports` tier with the color as written.
//
// The lab()/lch()/oklab()/oklch() origins below are written with a number lightness, which
// does not parse yet (#16727), so those declarations are emitted as written for that reason.
let i = 0;
const testname = () => `test-${i++}`;
describe("relative_color_out_of_gamut", () => {
  itBundled(testname(), {
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
  color: rgb(from #00f942 r g b / alpha);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: rgb(from color(display-p3 0 1 0) r g b / alpha);
  }
}
`);
    },
  });

  itBundled(testname(), {
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
    color: hsl(from #00f942 h s l / alpha);
  }

  @supports (color: color(display-p3 0 0 0)) {
    h1 {
      color: hsl(from color(display-p3 0 1 0) h s l / alpha);
    }
  }
  `);
    },
  });

  itBundled(testname(), {
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
    color: hwb(from #00f942 h w b / alpha);
  }

  @supports (color: color(display-p3 0 0 0)) {
    h1 {
      color: hwb(from color(display-p3 0 1 0) h w b / alpha);
    }
  }
  `);
    },
  });

  itBundled(testname(), {
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
