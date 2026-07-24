import { describe } from "bun:test";
import { itBundled } from "../../expectBundled";

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
  color: rgb(from #fff r g b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: rgb(from color(display-p3 1.47874 .658561 1.37055) r g b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: rgb(from lab(100% 104.3 -50.9) r g b);
  }
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
  color: rgb(from #2a0022 r g b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: rgb(from color(display-p3 .306769 -.199656 .283743) r g b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: rgb(from lab(0% 104.3 -50.9) r g b);
  }
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
  color: rgb(from #fff r g b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: rgb(from color(display-p3 1.47862 .658765 1.3702) r g b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: rgb(from lab(100% 104.26 -50.851) r g b);
  }
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
  color: rgb(from #2a0022 r g b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: rgb(from color(display-p3 .306711 -.199586 .283484) r g b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: rgb(from lab(0% 104.26 -50.851) r g b);
  }
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
  color: rgb(from #fff r g b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: rgb(from color(display-p3 1.46907 .484456 1.34749) r g b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: rgb(from lab(94.0295% 119.52 -57.5484) r g b);
  }
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
  color: rgb(from #000 r g b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: rgb(from color(display-p3 .0601419 -.041443 .0865066) r g b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: rgb(from lab(-.452515% 13.4914 -12.4407) r g b);
  }
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
  color: rgb(from #fff r g b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: rgb(from color(display-p3 1.46933 .483415 1.34835) r g b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: rgb(from lab(94.0205% 119.644 -57.6823) r g b);
  }
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
  color: rgb(from #000 r g b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: rgb(from color(display-p3 .0602585 -.0416396 .0869713) r g b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: rgb(from lab(-.455916% 13.5528 -12.5395) r g b);
  }
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
  color: hsl(from #fff h s l);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hsl(from color(display-p3 1.47874 .658561 1.37055) h s l);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hsl(from lab(100% 104.3 -50.9) h s l);
  }
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
  color: hsl(from #2a0022 h s l);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hsl(from color(display-p3 .306769 -.199656 .283743) h s l);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hsl(from lab(0% 104.3 -50.9) h s l);
  }
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
  color: hsl(from #fff h s l);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hsl(from color(display-p3 1.47862 .658765 1.3702) h s l);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hsl(from lab(100% 104.26 -50.851) h s l);
  }
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
  color: hsl(from #2a0022 h s l);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hsl(from color(display-p3 .306711 -.199586 .283484) h s l);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hsl(from lab(0% 104.26 -50.851) h s l);
  }
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
  color: hsl(from #fff h s l);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hsl(from color(display-p3 1.46907 .484456 1.34749) h s l);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hsl(from lab(94.0295% 119.52 -57.5484) h s l);
  }
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
  color: hsl(from #000 h s l);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hsl(from color(display-p3 .0601419 -.041443 .0865066) h s l);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hsl(from lab(-.452515% 13.4914 -12.4407) h s l);
  }
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
  color: hsl(from #fff h s l);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hsl(from color(display-p3 1.46933 .483415 1.34835) h s l);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hsl(from lab(94.0205% 119.644 -57.6823) h s l);
  }
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
  color: hsl(from #000 h s l);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hsl(from color(display-p3 .0602585 -.0416396 .0869713) h s l);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hsl(from lab(-.455916% 13.5528 -12.5395) h s l);
  }
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
  color: hwb(from #fff h w b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hwb(from color(display-p3 1.47874 .658561 1.37055) h w b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hwb(from lab(100% 104.3 -50.9) h w b);
  }
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
  color: hwb(from #2a0022 h w b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hwb(from color(display-p3 .306769 -.199656 .283743) h w b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hwb(from lab(0% 104.3 -50.9) h w b);
  }
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
  color: hwb(from #fff h w b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hwb(from color(display-p3 1.47862 .658765 1.3702) h w b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hwb(from lab(100% 104.26 -50.851) h w b);
  }
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
  color: hwb(from #2a0022 h w b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hwb(from color(display-p3 .306711 -.199586 .283484) h w b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hwb(from lab(0% 104.26 -50.851) h w b);
  }
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
  color: hwb(from #fff h w b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hwb(from color(display-p3 1.46907 .484456 1.34749) h w b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hwb(from lab(94.0295% 119.52 -57.5484) h w b);
  }
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
  color: hwb(from #000 h w b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hwb(from color(display-p3 .0601419 -.041443 .0865066) h w b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hwb(from lab(-.452515% 13.4914 -12.4407) h w b);
  }
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
  color: hwb(from #fff h w b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hwb(from color(display-p3 1.46933 .483415 1.34835) h w b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hwb(from lab(94.0205% 119.644 -57.6823) h w b);
  }
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
  color: hwb(from #000 h w b);
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: hwb(from color(display-p3 .0602585 -.0416396 .0869713) h w b);
  }
}

@supports (color: lab(0% 0 0)) {
  h1 {
    color: hwb(from lab(-.455916% 13.5528 -12.5395) h w b);
  }
}
`);
    },
  });
});
