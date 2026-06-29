import { color } from "bun";
import { describe, expect, test } from "bun:test";
import { withoutAggressiveGC } from "harness";

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

// These survive the u8 round-trip exactly, so `color(x, "hsl") === x`.
const hslColors = [
  "hsl(0, 100%, 50%)",
  "hsl(120, 100%, 50%)",
  "hsl(240, 100%, 50%)",
  "hsl(60, 100%, 50%)",
  "hsl(300, 100%, 50%)",
  "hsl(180, 100%, 50%)",
];

// Fixed points of the "lab" serializer: `lab(<percentage> <number> <number>)`
// with a lightness that survives the f32 `/ 100 * 100` round-trip.
const labColors = ["lab(50% 62.5 62.5)", "lab(75% -40 20)", "lab(100% 0 0)", "lab(0% 0 0)"];

const formatted = {
  "{rgb}": rgbObjectColors,
  "{rgba}": rgbObjectColors.map(color => ({ ...color, a: 1 })),
  "[rgb]": rgbObjectColors.map(color => [color.r, color.g, color.b]),
  "[rgba]": rgbObjectColors.map(color => [color.r, color.g, color.b, 255]),
  rgb: rgbColors,
  rgba: rgbaColors,
  hex: hexLowercase,
  HEX: hexUppercase,
  hsl: hslColors,
  lab: labColors,
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

// currentColor, system colors and light-dark() are valid CSS <color> values,
// but they have no concrete r/g/b channels to convert. Only the "css" format
// can represent them; everything else must return null, never the input text.
describe("colors without concrete channel values", () => {
  const inputs = [
    ["currentColor", "currentColor"],
    ["currentcolor", "currentColor"],
    ["Canvas", "canvas"],
    ["light-dark(red, blue)", "light-dark(red, #00f)"],
  ];
  const conversionFormats = [
    "number",
    "{rgba}",
    "{rgb}",
    "[rgba]",
    "[rgb]",
    "rgb",
    "rgba",
    "hex",
    "HEX",
    "hsl",
    "lab",
    "ansi-16m",
    "ansi-256",
    "ansi-16",
  ];

  describe.each(inputs)("color(%s)", (input, css) => {
    test.each(conversionFormats)(`"%s" is null`, format => {
      expect(color(input, format)).toBeNull();
    });
    test(`"css" is ${JSON.stringify(css)}`, () => {
      expect(color(input, "css")).toBe(css);
    });
  });
});

describe("color() function inputs convert", () => {
  test.each([
    ["color(srgb 1 0 0)", "#ff0000"],
    ["color(srgb-linear 1 0 0)", "#ff0000"],
    ["color(xyz 0 0 0)", "#000000"],
  ])("color(%s, 'hex') === %s", (input, expected) => {
    expect(color(input, "hex")).toBe(expected);
  });

  test("converts to non-string formats", () => {
    expect(color("color(srgb 1 0 0)", "number")).toBe(0xff0000);
    expect(color("color(srgb 1 0 0)", "{rgba}")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(color("color(srgb 1 0 0 / 0.5)", "[rgba]")).toEqual([255, 0, 0, 128]);
  });

  test("out-of-gamut colors are mapped into sRGB", () => {
    expect(color("color(display-p3 0 1 0)", "hex")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

// https://drafts.csswg.org/css-color-4/#named-colors are ASCII case-insensitive.
describe("named colors are ASCII case-insensitive", () => {
  test.each([
    ["Red", "red"],
    ["RED", "red"],
    ["rEbEcCaPuRpLe", "#639"],
    ["WhiteSmoke", "#f5f5f5"],
  ])("color(%s, 'css') === %s", (input, expected) => {
    expect(color(input, "css")).toBe(expected);
    expect(color(input, "hex")).toBe(color(input.toLowerCase(), "hex"));
  });
});

// Every component of lab()/lch()/oklab()/oklch() accepts <number> and
// <percentage>. The expected values are anchored to the equivalent syntax
// that was already supported, per the reference ranges in CSS Color 4.
// https://github.com/oven-sh/bun/issues/16727
describe("lab-like function component syntax", () => {
  test("lab() accepts percentage a/b (the docs' own example)", () => {
    expect(color("lab(50% 50% 50%)", "hex")).toBe("#db3702"); // == lab(50% 62.5 62.5)
    expect(color("lab(50% -100% -100%)", "hex")).toBe("#005d5a"); // == lab(50% -125 -125)
  });

  test("number lightness", () => {
    expect(color("lab(50 50 50)", "hex")).toBe("#ca4b22"); // == lab(50% 50 50)
    expect(color("lch(50 50 50)", "hex")).toBe("#b25f37"); // == lch(50% 50 50)
    expect(color("oklab(0.5 0.1 0.1)", "hex")).toBe("#a14203"); // == oklab(50% 0.1 0.1)
    expect(color("oklch(0.5 0.1 50)", "hex")).toBe("#90502a"); // == oklch(50% 0.1 50)
  });

  test("percentage chroma", () => {
    expect(color("lch(50% 50% 50)", "hex")).toBe("#c94e0d"); // == lch(50% 75 50)
    expect(color("oklab(0.5 100% -100%)", "hex")).toBe("#9500c0"); // == oklab(50% 0.4 -0.4)
    expect(color("oklch(0.5 50% 50)", "hex")).toBe("#a34100"); // == oklch(50% 0.2 50)
  });
});

describe("hsl and lab output formats emit valid CSS", () => {
  test('"hsl" uses percentages', () => {
    expect(color("red", "hsl")).toBe("hsl(0, 100%, 50%)");
    expect(color("hsl(120, 100%, 50%)", "hsl")).toBe("hsl(120, 100%, 50%)");
  });

  test('"hsl" output reparses to the same color', () => {
    const input = "hsl(120, 25%, 75%)";
    expect(color(color(input, "hsl")!, "hex")).toBe(color(input, "hex")!);
  });

  test('"lab" output reparses to the same color', () => {
    expect(color("lab(50% 62.5 62.5)", "lab")).toBe("lab(50% 62.5 62.5)");
    const red = color("red", "lab")!;
    expect(red).toStartWith("lab(");
    expect(color(red, "hex")).toBe("#ff0000");
  });
});

test("fuzz ansi256", () => {
  // Stride through each channel instead of sweeping all 16.7 million values:
  // the full sweep takes minutes on a debug build. 15 is smaller than every
  // bucket of the tmux quantizer (48, 114, then 40 wide), so every branch of
  // it is still reached, as are the 0 and 255 endpoints.
  const channel: number[] = [];
  for (let value = 0; value < 256; value += 15) {
    channel.push(value);
  }
  channel.push(255);

  withoutAggressiveGC(() => {
    for (const i of channel) {
      const iShifted = i << 16;
      for (const j of channel) {
        const jShifted = j << 8;
        for (const k of channel) {
          const int = iShifted | jShifted | k;
          if (color(int, "ansi256") === null) {
            throw new Error(`color(${i}, ${j}, ${k}, "ansi256") is null`);
          }
        }
      }
    }
  });
});
