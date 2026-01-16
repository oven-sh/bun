import { color } from "bun";
import { cssInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { normalizeBunSnapshot, withoutAggressiveGC } from "harness";

const namedColors = ["red", "green", "blue", "yellow", "purple", "orange", "pink", "brown", "gray"];

const hexColors = [
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FFFF00",
  "#FF00FF",
  "#00FFFF",
  "#FFA500",
  "#800080",
  "#FFC0CB",
  "#808080",
  "#000000",
  "#FFFFFF",
];

const hexLowercase = hexColors.map(color => color.toLowerCase());
const hexUppercase = hexColors.map(color => color.toUpperCase());

const rgbColors = [
  "rgb(255, 0, 0)",
  "rgb(0, 255, 0)",
  "rgb(0, 0, 255)",
  "rgb(255, 255, 0)",
  "rgb(255, 0, 255)",
  "rgb(0, 255, 255)",
  "rgb(255, 165, 0)",
  "rgb(128, 0, 128)",
  "rgb(255, 204, 204)",
  "rgb(128, 128, 128)",
  "rgb(0, 0, 0)",
  "rgb(255, 255, 255)",
];

const rgbaColors = [
  "rgba(255, 0, 0, 1)",
  "rgba(0, 255, 0, 1)",
  "rgba(0, 0, 255, 1)",
  "rgba(255, 255, 0, 1)",
  "rgba(255, 0, 255, 1)",
  "rgba(0, 255, 255, 1)",
  "rgba(255, 165, 0, 1)",
  "rgba(128, 0, 128, 1)",
  "rgba(255, 204, 204, 1)",
  "rgba(128, 128, 128, 1)",
  "rgba(0, 0, 0, 1)",
  "rgba(255, 255, 255, 1)",
];

const rgbObjectColors = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 255, b: 0 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 255, g: 165, b: 0 },
  { r: 128, g: 0, b: 128 },
  { r: 255, g: 204, b: 204 },
  { r: 128, g: 128, b: 128 },
  { r: 0, g: 0, b: 0 },
  { r: 255, g: 255, b: 255 },
];

const hslColors = [
  "hsl(0, 100%, 50%)",
  "hsl(120, 100%, 50%)",
  "hsl(240, 100%, 50%)",
  "hsl(60, 100%, 50%)",
  "hsl(300, 100%, 50%)",
  "hsl(180, 100%, 50%)",
  "hsl(300, 100%, 50%)",
  "hsl(120, 100%, 50%)",
  "hsl(240, 100%, 50%)",
];

const labColors = [
  "lab(50%, 50%, 50%)",
  "lab(100%, 100%, 100%)",
  "lab(0%, 0%, 0%)",
  "lab(100%, 0%, 0%)",
  "lab(0%, 100%, 0%)",
  "lab(0%, 0%, 100%)",
];

const formatted = {
  "{rgb}": rgbObjectColors,
  "{rgba}": rgbObjectColors.map(color => ({ ...color, a: 1 })),
  "[rgb]": rgbObjectColors.map(color => [color.r, color.g, color.b]),
  "[rgba]": rgbObjectColors.map(color => [color.r, color.g, color.b, 255]),
  rgb: rgbColors,
  rgba: rgbaColors,
  hex: hexLowercase,
  HEX: hexUppercase,
  // hsl: hslColors,
  // lab: labColors,
  number: hexLowercase.map(color => parseInt(color.slice(1), 16)),
};

for (const format in formatted) {
  for (const input of formatted[format]) {
    test(`console.log(color(${JSON.stringify(input)}, "ansi-24bit"))`, () => {
      console.log(color(input, "ansi-24bit") + input);
    });

    test(`console.log(color(${JSON.stringify(input)}, "ansi-256"))`, () => {
      console.log(color(input, "ansi-256") + input);
    });
    test(`console.log(color(${JSON.stringify(input)}, "ansi-16"))`, () => {
      console.log(color(input, "ansi-16") + input);
    });

    test(`color(${JSON.stringify(input)}, "${format}") = ${JSON.stringify(input)}`, () => {
      expect(color(input, format)).toEqual(input);
    });

    test(`color(${JSON.stringify(input)}, "ansi-24bit")`, () => {
      expect(color(input, "ansi-24bit")).toMatchSnapshot();
    });

    test(`color(${JSON.stringify(input)}, "ansi-16")`, () => {
      expect(color(input, "ansi-16")).toMatchSnapshot();
    });

    test(`color(${JSON.stringify(input)}, "ansi256")`, () => {
      expect(color(input, "ansi256")).toMatchSnapshot();
    });
  }

  for (const input of formatted[format]) {
    test(`color(${JSON.stringify(input)}, "css")`, () => {
      expect(color(input, "css")).toMatchSnapshot();
    });
  }
}

for (const input of formatted.hex) {
  test(`color(${JSON.stringify(input)}, "HEX")`, () => {
    expect(color(input, "HEX")).toEqual(input.toUpperCase());
  });
}

for (const input of formatted.HEX) {
  test(`color(${JSON.stringify(input)}, "hex")`, () => {
    expect(color(input, "hex")).toEqual(input.toLowerCase());
  });
}

const bad = [
  "rg(255, 255, 255)",
  "bad color input",
  "#0129301293",
  "lab(101%, 100%, 100%)",
  "lch(100%, 100%, 100%)",
  "color(red)",
  "calc(1px + 1px)",
  "var(--bad)",
  "url(#bad)",
  "attr(id)",
  "calc(1px + 1px)",
  "calc(1px + 1px)",
  "calc(1px + 1px)",
  "calc(1px + 1px)",
  "calc(1px + 1px)",
  "calc(1px + 1px)",
  "0123456",
  "123456",
  "23456",
  "3456",
  "456",
  "56",
  "6",
  "#-fff",
  "0xfff",
];
test.each(bad)("color(%s, 'css') === null", input => {
  expect(color(input, "css")).toBeNull();
  expect(color(input)).toBeNull();
});

const weird = [
  ["rgb(-255, 0, 0)", "#000"],
  ["rgb(256, 0, 0)", "red"],
];
describe("weird", () => {
  test.each(weird)("color(%s, 'css') === %s", (input, expected) => {
    expect(color(input, "css")).toEqual(expected);
    expect(color(input)).toEqual(expected);
  });
});

test("0 args", () => {
  expect(() => color()).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
    }),
  );
});

test("fuzz ansi256", () => {
  withoutAggressiveGC(() => {
    for (let i = 0; i < 256; i++) {
      const iShifted = i << 16;
      for (let j = 0; j < 256; j++) {
        const jShifted = j << 8;
        for (let k = 0; k < 256; k++) {
          const int = iShifted | jShifted | k;
          if (color(int, "ansi256") === null) {
            throw new Error(`color(${i}, ${j}, ${k}, "ansi256") is null`);
          }
        }
      }
    }
  });
});

// Regression test for css-system-color-mix-crash
test("CSS system colors in color-mix should not crash", () => {
  // This test reproduces a crash that was happening when using system colors
  // in color-mix() functions. The crash was caused by system colors reaching
  // the color interpolation code which had a panic for system colors.

  const testCases = [
    "color-mix(in srgb, ButtonFace, red)",
    "color-mix(in srgb, Canvas, blue)",
    "color-mix(in srgb, AccentColor, white)",
    "color-mix(in srgb, red, ButtonFace)",
    "color-mix(in srgb, ButtonFace 50%, red)",
    "color-mix(in srgb, ButtonFace, Canvas)",
    "color-mix(in oklch, AccentColor, FieldText)",
    "color-mix(in hsl, WindowFrame, LinkText)",
  ];

  for (const testCase of testCases) {
    const css = `
      .test {
        color: ${testCase};
      }
    `;

    // This should not crash - it should either parse successfully or fail gracefully
    try {
      const result = cssInternals._test(css, css);
      expect(result).toBeDefined();
    } catch (error) {
      // If it fails, it should be a parsing error, not a crash
      expect(error.message).not.toContain("system colors cannot be converted to a color");
      expect(error.message).not.toContain("unreachable");
      expect(error.message).not.toContain("panic");
    }
  }
});

// Regression test for css-system-color-mix-crash
test("CSS system colors in color-mix - snapshot outputs", () => {
  const testCases = [
    "color-mix(in srgb, ButtonFace, red)",
    "color-mix(in srgb, Canvas, blue)",
    "color-mix(in srgb, AccentColor, white)",
    "color-mix(in srgb, red, ButtonFace)",
    "color-mix(in srgb, ButtonFace 50%, red)",
    "color-mix(in srgb, ButtonFace, Canvas)",
    "color-mix(in oklch, AccentColor, FieldText)",
    "color-mix(in hsl, WindowFrame, LinkText)",
    "color-mix(in srgb, HighlightText, GrayText)",
    "color-mix(in srgb, Canvas 25%, AccentColor 75%)",
    "color-mix(in lch, ButtonFace, transparent)",
    "color-mix(in hsl, AccentColor, currentColor)",
  ];

  const results = {};

  for (const testCase of testCases) {
    const css = `.test { color: ${testCase}; }`;

    try {
      const result = cssInternals._test(css, css);
      results[testCase] = { success: true, output: result };
    } catch (error) {
      results[testCase] = { success: false, error: error.message };
    }
  }

  expect(normalizeBunSnapshot(JSON.stringify(results, null, 2))).toMatchSnapshot();
});
