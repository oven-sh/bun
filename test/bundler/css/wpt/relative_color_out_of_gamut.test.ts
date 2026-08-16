import { describe } from "bun:test";
import { itBundled } from "../../expectBundled";

// https://github.com/web-platform-tests/wpt/blob/master/css/css-color/parsing/relative-color-out-of-gamut.html
//
// The WPT asserts that a relative rgb()/hsl()/hwb() color whose origin is outside the sRGB
// gamut computes to the unclamped out-of-gamut color (browsers clip it when painting), so
// the bundler must not resolve these: gamut mapping the origin gives a different color
// (`rgb(from lab(100 104.3 -50.9) r g b)` would become `#fff`; browsers compute
// `color(srgb 1.5935 .587758 1.40555)` and paint it clipped, #ff96ff). The declaration is
// left for the browser. What the bundler does do is its usual handling of a wide-gamut color
// literal inside a value it does not resolve: under the default browser targets the origin
// is downleveled into an sRGB fallback plus `@supports` tiers, with the losslessly converted
// origin in the widest tier. Every browser with relative color syntax supports that tier.
//
// Until the lab family accepted a number lightness, the 24 lab()/lch()/oklab()/oklch() cases
// were emitted as written only because their origin did not parse at all; now every origin
// parses and all 27 cases take the same path.
const origins: { origin: string; alpha?: string; srgb: string; p3: string; lab?: string }[] = [
  { origin: "color(display-p3 0 1 0)", alpha: " / alpha", srgb: "#00f942", p3: "color(display-p3 0 1 0)" },
  {
    origin: "lab(100 104.3 -50.9)",
    srgb: "#fff",
    p3: "color(display-p3 1.47874 .658561 1.37055)",
    lab: "lab(100% 104.3 -50.9)",
  },
  {
    origin: "lab(0 104.3 -50.9)",
    srgb: "#2a0022",
    p3: "color(display-p3 .306769 -.199656 .283743)",
    lab: "lab(0% 104.3 -50.9)",
  },
  {
    origin: "lch(100 116 334)",
    srgb: "#fff",
    p3: "color(display-p3 1.47862 .658765 1.3702)",
    lab: "lab(100% 104.26 -50.851)",
  },
  {
    origin: "lch(0 116 334)",
    srgb: "#2a0022",
    p3: "color(display-p3 .306711 -.199586 .283484)",
    lab: "lab(0% 104.26 -50.851)",
  },
  {
    origin: "oklab(1 0.365 -0.16)",
    srgb: "#fff",
    p3: "color(display-p3 1.46907 .484456 1.34749)",
    lab: "lab(94.0295% 119.52 -57.5484)",
  },
  {
    origin: "oklab(0 0.365 -0.16)",
    srgb: "#000",
    p3: "color(display-p3 .0601419 -.041443 .0865066)",
    lab: "lab(-.452515% 13.4914 -12.4407)",
  },
  {
    origin: "oklch(1 0.399 336.3)",
    srgb: "#fff",
    p3: "color(display-p3 1.46933 .483415 1.34835)",
    lab: "lab(94.0205% 119.644 -57.6823)",
  },
  {
    origin: "oklch(0 0.399 336.3)",
    srgb: "#000",
    p3: "color(display-p3 .0602585 -.0416396 .0869713)",
    lab: "lab(-.455916% 13.5528 -12.5395)",
  },
];

const functions: [name: string, channels: string][] = [
  ["rgb", "r g b"],
  ["hsl", "h s l"],
  ["hwb", "h w b"],
];

describe("relative_color_out_of_gamut", () => {
  for (const [fn, channels] of functions) {
    for (const { origin, alpha = "", srgb, p3, lab } of origins) {
      const input = `${fn}(from ${origin} ${channels}${alpha})`;
      const relative = (from: string) => `${fn}(from ${from} ${channels}${alpha})`;

      itBundled(input, {
        files: {
          "/a.css": /* css */ `
h1 {
  color: ${input};
}
          `,
        },
        outfile: "out.css",

        onAfterBundle(api) {
          api.expectFile("/out.css").toEqualIgnoringWhitespace(`
/* a.css */
h1 {
  color: ${relative(srgb)};
}

@supports (color: color(display-p3 0 0 0)) {
  h1 {
    color: ${relative(p3)};
  }
}
${
  lab === undefined
    ? ""
    : `
@supports (color: lab(0% 0 0)) {
  h1 {
    color: ${relative(lab)};
  }
}
`
}`);
        },
      });
    }
  }
});
