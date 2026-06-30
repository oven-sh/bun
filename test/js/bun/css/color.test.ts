import { color } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, withoutAggressiveGC } from "harness";

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

describe("number inputs are opaque", () => {
  test.each([
    [0xff0000, { r: 255, g: 0, b: 0, a: 1 }],
    [0x00ff00, { r: 0, g: 255, b: 0, a: 1 }],
    [0x0000ff, { r: 0, g: 0, b: 255, a: 1 }],
    [0x000000, { r: 0, g: 0, b: 0, a: 1 }],
    [0xffffff, { r: 255, g: 255, b: 255, a: 1 }],
  ])("color(%d, '{rgba}')", (input, expected) => {
    expect(color(input, "{rgba}")).toEqual(expected);
  });

  test("alpha is opaque in every output format", () => {
    expect(color(0xff0000, "[rgba]")).toEqual([255, 0, 0, 255]);
    expect(color(0xff0000, "rgba")).toBe("rgba(255, 0, 0, 1)");
    expect(color(0xff0000, "css")).toBe("red");
    expect(color(0xff0000)).toBe("red");
  });

  test("round-trips through the number format", () => {
    expect(color(color("pink", "number")!, "css")).toBe("pink");
    expect(color(color([255, 0, 0, 255], "number")!, "[rgba]")).toEqual([255, 0, 0, 255]);
  });

  test("values wider than 24 bits keep the explicit alpha byte", () => {
    expect(color(0x80ff0000, "[rgba]")).toEqual([255, 0, 0, 128]);
    expect(color(0xffff0000, "{rgba}")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(color(0xffffffff, "{rgba}")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  test("out-of-range values use their low 32 bits", () => {
    expect(color(-1, "{rgba}")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(color(0x1_00ff_0000, "{rgba}")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
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

  // In relative color syntax a channel keyword resolves through its own
  // channel type: `a`, `b` and chroma are <number> channels, so the
  // percentage reference range must not scale them.
  test("relative color syntax round-trips through every channel", () => {
    expect(color("lab(from red l a b)", "css")).toBe("lab(54.2905% 80.8049 69.891)");
    expect(color("lab(from red l a b)", "hex")).toBe("#ff0000");
    expect(color("lch(from red l c h)", "hex")).toBe("#ff0000");
    expect(color("oklab(from red l a b)", "hex")).toBe("#ff0000");
    expect(color("oklch(from red l c h)", "hex")).toBe("#ff0000");
  });

  test("relative color syntax accepts percentages and calc() on number channels", () => {
    expect(color("lab(from red l 100% -100%)", "css")).toBe("lab(54.2905% 125 -125)");
    expect(color("lab(from red calc(a * 1) b b)", "css")).toBe("lab(80.8049% 69.891 69.891)");
  });
});

// rgb()/hsl()/hwb() cannot represent an origin color outside the sRGB gamut.
// Resolving the relative color would have to gamut map or clip it, visibly
// changing what a browser resolving the same declaration renders, so it is
// not resolved at all. https://github.com/w3c/csswg-drafts/issues/8444
describe("relative colors with an out-of-gamut origin", () => {
  const outOfGamut = ["color(display-p3 0 1 0)", "lab(100 104.3 -50.9)", "oklch(1 .399 336.3)"];

  describe.each(outOfGamut)("from %s", origin => {
    test("legacy sRGB functions do not resolve", () => {
      expect(color(`rgb(from ${origin} r g b)`, "css")).toBeNull();
      expect(color(`rgb(from ${origin} r g b)`, "hex")).toBeNull();
      expect(color(`hsl(from ${origin} h s l)`, "css")).toBeNull();
      expect(color(`hwb(from ${origin} h w b)`, "css")).toBeNull();
    });

    test("unbounded targets resolve losslessly", () => {
      expect(color(`lab(from ${origin} l a b)`, "css")).toStartWith("lab(");
      expect(color(`color(from ${origin} srgb r g b)`, "css")).toStartWith("color(srgb ");
    });
  });

  test("the exact origin channels are preserved for unbounded targets", () => {
    expect(color("lab(from color(display-p3 0 1 0) l a b)", "css")).toBe("lab(86.614% -106.539 102.871)");
    // The out-of-gamut sRGB components survive untouched.
    expect(color("color(from lab(100 104.3 -50.9) srgb r g b)", "css")).toBe("color(srgb 1.5935 .587758 1.40555)");
  });

  test("in-gamut origins still resolve", () => {
    expect(color("rgb(from red r g b)", "css")).toBe("red");
    expect(color("hsl(from #ff0000 h s l)", "css")).toBe("red");
    expect(color("hwb(from rgb(255 0 0) h w b)", "css")).toBe("red");
    expect(color("hsl(from rgb(255 0 0 / 0.5) h s l / alpha)", "css")).toBe("#ff000080");
    expect(color("rgb(from lab(50% 50 50) r g b)", "hex")).toBe("#ca4b22");
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

  test("`none` components are resolved to 0, never NaN", () => {
    expect(color("hsl(none 100% 50%)", "hsl")).toBe("hsl(0, 100%, 50%)");
    expect(color("hsl(120 none 50%)", "hsl")).toBe("hsl(120, 0%, 50%)");
    expect(color("lab(none 20 30)", "lab")).toBe("lab(0% 20 30)");
    expect(color("lab(none none none)", "lab")).toBe("lab(0% 0 0)");
  });
});

describe.concurrent('color(input, "ansi") picks the escape for the detected color depth', () => {
  // The "ansi" format resolves against the terminal color depth derived from
  // the environment, so it has to be observed from a child process.
  async function autoAnsi(env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `process.stdout.write(JSON.stringify(Bun.color("#ff0000", "ansi")))`],
      env: {
        ...bunEnv,
        NO_COLOR: undefined,
        FORCE_COLOR: undefined,
        CI: undefined,
        TMUX: undefined,
        COLORTERM: undefined,
        TERM: "xterm-256color",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr is only part of the comparison when the child failed, so the
    // failure diff shows why without asserting it empty on success.
    return { stdout, exitCode, stderr: exitCode === 0 ? undefined : stderr };
  }

  function ansi(format: "ansi-24bit" | "ansi-256") {
    return { stdout: JSON.stringify(color("#ff0000", format)), exitCode: 0 };
  }

  test("TMUX is 24-bit color", async () => {
    // https://github.com/oven-sh/bun/issues/28463
    expect(await autoAnsi({ TMUX: "1", TERM: "screen-256color" })).toEqual(ansi("ansi-24bit"));
  });

  test("COLORTERM=truecolor is 24-bit color", async () => {
    expect(await autoAnsi({ COLORTERM: "truecolor" })).toEqual(ansi("ansi-24bit"));
  });

  test("FORCE_COLOR=2 is 256 colors", async () => {
    expect(await autoAnsi({ FORCE_COLOR: "2" })).toEqual(ansi("ansi-256"));
  });

  test("TERM=dumb is no color", async () => {
    expect(await autoAnsi({ TERM: "dumb" })).toEqual({ stdout: JSON.stringify(""), exitCode: 0 });
  });
});

// 2^24 color() calls take minutes on debug builds, past the per-test timeout.
test.skipIf(isDebug)("fuzz ansi256", () => {
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
