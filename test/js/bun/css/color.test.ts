import { color } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, withoutAggressiveGC } from "harness";

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

test("invalid format string lists the accepted values", () => {
  let message!: string;
  try {
    // @ts-expect-error
    color("red", "nope");
    expect.unreachable();
  } catch (e) {
    message = (e as Error).message;
  }
  // Must not leak the internal Rust enum name.
  expect(message).not.toContain("OutputColorFormat");
  expect(message).toStartWith("format must be one of ");
  // Every accepted spelling should appear in the message, so a user can copy one.
  for (const ok of [
    "ansi",
    "ansi_16",
    "ansi-16",
    "ansi_16m",
    "ansi-16m",
    "ansi-24bit",
    "ansi-truecolor",
    "ansi_256",
    "ansi-256",
    "ansi256",
    "css",
    "hex",
    "HEX",
    "hsl",
    "lab",
    "number",
    "rgb",
    "rgba",
    "[rgb]",
    "[rgba]",
    "[r,g,b,a]",
    "{rgb}",
    "{r,g,b}",
    "{rgba}",
  ]) {
    expect(message).toContain(`'${ok}'`);
  }
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

describe("lab()/oklab() sRGB fallback for boundary colors (#33331)", () => {
  // Reference CIE Lab (D50) for each sRGB color (matches CSS Color 4 to four
  // decimals). These saturated blues sit on the sRGB gamut boundary, where the
  // fallback used to desaturate them instead of clipping (#0000ff -> #002cea).
  const labBlues: [string, string][] = [
    ["#0000ff", "lab(29.5683% 68.2874 -112.0297)"],
    ["#0000ee", "lab(27.2497% 64.8129 -106.3296)"],
    ["#0000cc", "lab(22.5153% 57.7180 -94.6900)"],
    ["#0000aa", "lab(17.6303% 50.3974 -82.6800)"],
  ];

  test.each(labBlues)("color(%s via lab) clips to the boundary", (expected, lab) => {
    expect(color(lab, "hex")).toBe(expected);
  });

  test("oklab blue is not desaturated", () => {
    expect(color("oklab(45.2% -0.032 -0.312)", "hex")).toBe("#0200ff");
  });
});

// 2^24 color() calls take minutes on debug builds (past the per-test timeout) and dominate
// the ASAN lane, so those sweep the ansi256 equivalence classes (~13k deterministic inputs):
// each single channel, the grey diagonal, the sub-8 cube, and a coarse 17-step cube.
test.skipIf(isDebug)("fuzz ansi256", () => {
  withoutAggressiveGC(() => {
    const check = (r: number, g: number, b: number) => {
      if (color((r << 16) | (g << 8) | b, "ansi256") === null) {
        throw new Error(`color(${r}, ${g}, ${b}, "ansi256") is null`);
      }
    };
    if (isASAN) {
      for (let v = 0; v < 256; v++) {
        check(v, 0, 0);
        check(0, v, 0);
        check(0, 0, v);
        check(v, v, v);
      }
      for (let r = 0; r < 256; r += r < 8 ? 1 : 17) {
        for (let g = 0; g < 256; g += g < 8 ? 1 : 17) {
          for (let b = 0; b < 256; b += b < 8 ? 1 : 17) {
            check(r, g, b);
          }
        }
      }
    } else {
      for (let i = 0; i < 256; i++) {
        for (let j = 0; j < 256; j++) {
          for (let k = 0; k < 256; k++) {
            check(i, j, k);
          }
        }
      }
    }
  });
});

// These assert the documented contract rather than snapshotting whatever the
// implementation currently emits. https://bun.com/docs/runtime/color
describe("ansi output is a well-formed SGR sequence", () => {
  const sgr = /^\u001b\[[\d;]+m$/;

  test.each(["ansi-16", "ansi-256", "ansi-16m"])("%s", format => {
    for (const input of ["black", "red", "lime", "blue", "white", "magenta", "cyan", "yellow", "#336699"]) {
      const escape = color(input, format as any);
      expect(typeof escape).toBe("string");
      expect(escape).toMatch(sgr);
    }
  });

  // 30..=37 for the first eight colors, 90..=97 for their bright variants.
  // https://github.com/oven-sh/bun/issues/22161
  test("ansi-16 uses the 16-color SGR parameters", () => {
    expect(color("black", "ansi-16")).toBe("\u001b[30m");
    expect(color("green", "ansi-16")).toBe("\u001b[32m");
    expect(color("gray", "ansi-16")).toBe("\u001b[37m");
    expect(color("red", "ansi-16")).toBe("\u001b[91m");
    expect(color("lime", "ansi-16")).toBe("\u001b[92m");
    expect(color("blue", "ansi-16")).toBe("\u001b[94m");
    expect(color("magenta", "ansi-16")).toBe("\u001b[95m");
    expect(color("white", "ansi-16")).toBe("\u001b[97m");
  });

  test("ansi-16 never emits a 256-color escape", () => {
    for (let r = 0; r < 256; r += r < 8 ? 1 : 51) {
      for (let g = 0; g < 256; g += g < 8 ? 1 : 51) {
        for (let b = 0; b < 256; b += b < 8 ? 1 : 51) {
          expect(color({ r, g, b }, "ansi-16")).toMatch(/^\u001b\[(3[0-7]|9[0-7])m$/);
        }
      }
    }
  });

  test("ansi-256 and ansi-16m keep their documented shapes", () => {
    expect(color("red", "ansi-256")).toBe("\u001b[38;5;196m");
    expect(color("red", "ansi-16m")).toBe("\u001b[38;2;255;0;0m");
  });

  // The palette only has 256 entries, so a valid-looking `38;5;429496961m` is
  // still a broken escape. The grey ramp is where the index arithmetic underflows.
  test("ansi-256 never emits an index outside the palette", () => {
    withoutAggressiveGC(() => {
      for (let value = 0; value < 256; value++) {
        for (const rgb of [
          { r: value, g: value, b: value },
          { r: 0, g: 0, b: value },
          { r: value, g: 0, b: 0 },
        ]) {
          const index = Number(color(rgb, "ansi-256")!.match(/38;5;(\d+)m/)![1]);
          if (index > 255) throw new Error(`color(${JSON.stringify(rgb)}, "ansi-256") = index ${index}`);
        }
      }
    });
  });

  // https://github.com/tmux/tmux/blob/master/colour.c
  test("near-black colors land on black, not on a wrapped grey index", () => {
    expect(color("#020202", "ansi-256")).toBe("\u001b[38;5;16m");
    expect(color("#020202", "ansi-16")).toBe("\u001b[30m");
    expect(color("#000004", "ansi-256")).toBe("\u001b[38;5;16m");
  });

  // A terminal skips the whole escape, so the printed width is just the text.
  test.each(["ansi-16", "ansi-256", "ansi-16m"])("%s occupies no columns", format => {
    expect(Bun.stringWidth(color("red", format as any) + "hello")).toBe(5);
  });

  test("every 24-bit color produces a well-formed ansi-16 sequence", () => {
    withoutAggressiveGC(() => {
      for (let r = 0; r < 256; r += r < 8 ? 1 : 17) {
        for (let g = 0; g < 256; g += g < 8 ? 1 : 17) {
          for (let b = 0; b < 256; b += b < 8 ? 1 : 17) {
            const escape = color({ r, g, b }, "ansi-16");
            if (!sgr.test(escape!)) throw new Error(`color(${r},${g},${b}, "ansi-16") = ${JSON.stringify(escape)}`);
          }
        }
      }
    });
  });
});

describe("css string output parses back to the same color", () => {
  const inputs = ["red", "#336699", "rgb(1, 2, 3)", "#000000", "#ffffff"];

  test.each(["css", "hex", "HEX", "rgb", "rgba"])("%s round-trips", format => {
    for (const input of inputs) {
      expect(color(color(input, format as any) as string, "hex")).toBe(color(input, "hex"));
    }
  });

  test("hsl round-trips", () => {
    for (const input of [...inputs, "#808080", "lime", "rebeccapurple"]) {
      expect(color(color(input, "hsl") as string, "hex")).toBe(color(input, "hex"));
    }
  });

  test("hsl round-trips across the color cube", () => {
    withoutAggressiveGC(() => {
      for (let r = 0; r < 256; r += 37) {
        for (let g = 0; g < 256; g += 53) {
          for (let b = 0; b < 256; b += 61) {
            const back = color(color({ r, g, b }, "hsl") as string, "hex");
            if (back !== color({ r, g, b }, "hex")) {
              throw new Error(`hsl(${r},${g},${b}) round-tripped to ${back}`);
            }
          }
        }
      }
    });
  });

  // An achromatic color has no hue, and `hsl(NaN, ...)` is not parseable.
  test("hsl of a grey has a zero hue", () => {
    expect(color("#808080", "hsl")).toMatch(/^hsl\(0, 0%, 50\.19\d*%\)$/);
    expect(color("#000000", "hsl")).toBe("hsl(0, 0%, 0%)");
  });

  // #0000ff is https://github.com/oven-sh/bun/issues/33331; the cube sweep below
  // steps over 255, so it never reaches pure blue.
  test("lab round-trips", () => {
    for (const input of [...inputs, "#808080", "lime", "rebeccapurple", "#0000ff"]) {
      expect(color(color(input, "lab") as string, "hex")).toBe(color(input, "hex"));
    }
  });

  test("lab round-trips across the color cube", () => {
    withoutAggressiveGC(() => {
      for (let r = 0; r < 256; r += 37) {
        for (let g = 0; g < 256; g += 53) {
          for (let b = 0; b < 256; b += 61) {
            const back = color(color({ r, g, b }, "lab") as string, "hex");
            if (back !== color({ r, g, b }, "hex")) {
              throw new Error(`lab(${r},${g},${b}) round-tripped to ${back}`);
            }
          }
        }
      }
    });
  });

  // The forward direction is exact, so the inverse is the broken one. It goes
  // through cbrt, so the last f32 digit varies by platform; compare numerically.
  test.each([
    ["#ff0000", [54.29, 80.8, 69.89]],
    ["#00ff00", [87.82, -79.27, 80.99]],
    ["#0000ff", [29.57, 68.29, -112.03]],
  ])("lab of %s matches the CIELAB D50 reference", (input, reference) => {
    const components = (color(input as string, "lab") as string).match(/-?[\d.]+/g)!.map(Number);
    expect(components).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(components[i]).toBeCloseTo((reference as number[])[i], 1);
    }
  });

  // A `none` component is a zero value outside of interpolation, and `NaN` is not
  // a token any CSS parser accepts.
  test("a none component does not leak NaN into the output", () => {
    expect(color("hsl(120 none 50%)", "hsl")).toBe("hsl(120, 0%, 50%)");
    expect(color("lab(none 40 30)", "lab")).toBe("lab(0% 40 30)");
    expect(color("lab(50% none 30)", "lab")).toBe("lab(50% 0 30)");
    expect(color(color("hsl(120 none 50%)", "hsl") as string, "hex")).not.toBeNull();
  });
});

describe("input forms", () => {
  test.each([
    ["a named color", "red"],
    ["3-digit hex", "#f00"],
    ["6-digit hex", "#ff0000"],
    ["8-digit hex", "#ff0000ff"],
    ["rgb()", "rgb(255, 0, 0)"],
    ["rgba()", "rgba(255, 0, 0, 1)"],
    ["hsl() with percentages", "hsl(0, 100%, 50%)"],
    ["a number", 0xff0000],
    ["an object", { r: 255, g: 0, b: 0 }],
    ["an array", [255, 0, 0]],
  ])("%s resolves to red", (_name, input) => {
    expect(color(input as any, "hex")).toBe("#ff0000");
  });

  test("an unparseable color is null", () => {
    expect(color("notacolor", "hex")).toBeNull();
    expect(color("", "hex")).toBeNull();
    expect(color("#gg0000", "hex")).toBeNull();
  });

  test("alpha survives the object and array forms", () => {
    expect(color("#f00", "{rgba}")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(color("#f00", "[rgba]")).toEqual([255, 0, 0, 255]);
    expect(color("#f00", "{rgb}")).toEqual({ r: 255, g: 0, b: 0 });
    expect(color("#f00", "[rgb]")).toEqual([255, 0, 0]);
  });

  // The r/g/b keys of an object input and the CSS rgba() parser both clamp
  // out-of-range values; the object's `a` key must too (it used to wrap mod 256,
  // so a: 1.004 became fully transparent).
  test("out-of-range object alpha clamps to [0, 1]", () => {
    expect(color({ r: 10, g: 20, b: 30, a: 1.004 }, "{rgba}")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(color({ r: 10, g: 20, b: 30, a: 2 }, "{rgba}")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(color({ r: 10, g: 20, b: 30, a: 100 }, "{rgba}")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(color({ r: 10, g: 20, b: 30, a: -1 }, "{rgba}")).toEqual({ r: 10, g: 20, b: 30, a: 0 });
    expect(color({ r: 10, g: 20, b: 30, a: -0.5 }, "{rgba}")).toEqual({ r: 10, g: 20, b: 30, a: 0 });
    expect(color({ r: 10, g: 20, b: 30, a: Infinity }, "{rgba}")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(color({ r: 10, g: 20, b: 30, a: -Infinity }, "{rgba}")).toEqual({ r: 10, g: 20, b: 30, a: 0 });
  });

  test("object alpha agrees with the CSS parser's clamping", () => {
    for (const a of [1.5, 2, -0.5, -1, 1.004]) {
      expect(color({ r: 10, g: 20, b: 30, a }, "{rgba}")).toEqual(color(`rgba(10, 20, 30, ${a})`, "{rgba}"));
    }
  });

  test("in-range object alpha is unchanged", () => {
    expect(color({ r: 10, g: 20, b: 30, a: 1 }, "{rgba}")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(color({ r: 10, g: 20, b: 30, a: 0.5 }, "[rgba]")).toEqual([10, 20, 30, 127]);
  });
});

// https://drafts.csswg.org/css-color-5/#color-mix — the grammar is
// <percentage [0,100]>, so a value outside that range is a parse error.
describe("color-mix() percentage range", () => {
  // fuzz repro: -9% drove HSL saturation negative and tripped a debug assertion
  // in hsl_to_rgb; release builds produced out-of-gamut garbage.
  test("does not crash on a negative mix percentage", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write(String(Bun.color("color-mix(in hsl,red -9%,color(display-p3 0 0 0)", "lab")))`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode, stderr: exitCode === 0 ? undefined : stderr }).toEqual({ stdout: "null", exitCode: 0 });
  });

  test.each([
    "color-mix(in hsl, red -9%, blue)",
    "color-mix(in hsl, red 150%, blue)",
    "color-mix(in hsl, -10% red, blue)",
    "color-mix(in hsl, red, blue -9%)",
    "color-mix(in hsl, red, blue 150%)",
    "color-mix(in hsl, red, 150% blue)",
    "color-mix(in srgb, red -1%, blue)",
    "color-mix(in srgb, red 100.001%, blue)",
    "color-mix(in lab, red -9%, blue)",
    "color-mix(in hwb, red -9%, blue)",
    "color-mix(in oklch, red 150%, blue)",
  ])("rejects %s", input => {
    expect(color(input, "css")).toBeNull();
  });

  test.each([
    ["color-mix(in hsl, red 0%, blue)", "#00f"],
    ["color-mix(in hsl, red 100%, blue)", "red"],
    ["color-mix(in hsl, red 50%, blue 50%)", "#f0f"],
    ["color-mix(in hsl, red, blue 0%)", "red"],
    ["color-mix(in hsl, red, blue 100%)", "#00f"],
  ])("accepts %s", (input, expected) => {
    expect(color(input, "css")).toBe(expected);
  });
});

describe("rgb() channel order and legacy syntax", () => {
  // Distinct channel values, so any two channels ending up in each other's
  // place shows in the output. The legacy comma syntax gives the channels on a
  // 0-255 scale and takes its alpha after another comma; the modern syntax
  // takes its alpha after a slash and is the only one that allows `none`.
  test.each([
    ["rgb(12 34 56)", "#0c2238"],
    ["rgb(12, 34, 56)", "#0c2238"],
    ["rgb(4.7% 13.3% 22%)", "#0c2238"],
    ["rgb(4.7%, 13.3%, 22%)", "#0c2238"],
    ["rgb(12 13.3% 56)", "#0c2238"],
    ["rgb(12 34 56 / 0.5)", "#0c223880"],
    ["rgb(12, 34, 56, 0.5)", "#0c223880"],
    ["rgba(12, 34, 56, 0.5)", "#0c223880"],
    ["rgb(12 none 56)", "#0c0038"],
    ["rgb(none 34 56)", "#002238"],
  ])("%s is %s", (input, expected) => {
    expect(color(input, "css")).toBe(expected);
  });

  test.each([
    "rgb(12, 34, 56 / 0.5)",
    "rgb(12 34 56, 0.5)",
    "rgb(12, 13.3%, 56)",
    "rgb(12, none, 56)",
    "rgb(none, 34, 56)",
  ])("%s mixes the two syntaxes and is rejected", input => {
    expect(color(input, "css")).toBeNull();
  });
});

// color-mix(in srgb, ...) folds to an 8-bit color. css-color-4 interpolates out-of-gamut
// channels as they are, so wide-gamut operands can leave the result outside the sRGB
// gamut; an sRGB screen shows such a result with each channel clipped (a wider screen
// shows it as is, which an 8-bit fold cannot express), so the fold clips. It used to gamut
// map the result (the chroma reduction used for the #rrggbb fallback of a wide-gamut
// color), which is a different color on every screen: #00f942 for display-p3 green, or
// plain white for the bright magentas below. The display-p3 green, lab() and oklch()
// operands are the ones of WPT css/css-color/parsing/color-mix-out-of-gamut.html; the
// expected colors are the computed values it lists (color(srgb 1.59343 0.58802 1.40564)
// for lab(100% 104.3 -50.9)) clipped to 8 bits. The other unclipped results are noted inline.
describe("color-mix() results outside the sRGB gamut are clipped", () => {
  test.each([
    // color(display-p3 0 1 0) is color(srgb -0.5116 1.0183 -0.3107); used to be #00f942.
    ["color-mix(in srgb, color(display-p3 0 1 0), color(display-p3 0 1 0))", "#0f0"],
    ["color-mix(in srgb, color(display-p3 0 1 0) 100%, red)", "#0f0"],
    ["color-mix(in srgb, color(display-p3 0 1 0 / 0.5), color(display-p3 0 1 0 / 0.5))", "#00ff0080"],
    // color(srgb 1 1 -0.346) and color(srgb 1.093 -0.227 -0.150); used to be #fdfe00 and #ff0f0e.
    ["color-mix(in srgb, color(display-p3 1 1 0), color(display-p3 1 1 0))", "#ff0"],
    ["color-mix(in srgb, color(display-p3 1 0 0), color(display-p3 1 0 0))", "red"],
    // color(srgb 1.593 0.359 1.386) and color(srgb 1.593 0.588 1.406): the oklch lightness of
    // these is above 1, which the gamut mapping turned into plain white.
    ["color-mix(in srgb, oklch(100% 0.399 336.3), oklch(100% 0.399 336.3))", "#ff5bff"],
    ["color-mix(in srgb, oklch(100% 0.399 336.3) 80%, white)", "#ff7cff"],
    ["color-mix(in srgb, oklch(100% 0.399 336.3) 50%, white)", "#ffadff"],
    ["color-mix(in srgb, lab(100% 104.3 -50.9), lab(100% 104.3 -50.9))", "#ff96ff"],
    ["color-mix(in srgb, lab(100% 104.3 -50.9), red)", "#ff4bb3"],
    // color(srgb 0.351 -0.214 0.300); used to be #2a0022.
    ["color-mix(in srgb, lab(0% 104.3 -50.9), lab(0% 104.3 -50.9))", "#5a004c"],
    // color(srgb -1.207 1.316 -0.489); used to be #a7ffc3 and #d5ffd4.
    ["color-mix(in srgb, color(xyz 0 1 0) 75%, lime)", "#0f0"],
    ["color-mix(in srgb, color(xyz 0 1 0) 50%, white)", "#00ff41"],
    // color(srgb 0 1.194 0) and color(srgb 1.353 1.353 0); used to be #edffea and white.
    ["color-mix(in srgb, color(srgb-linear 0 1.5 0), color(srgb-linear 0 1.5 0))", "#0f0"],
    ["color-mix(in srgb, color(srgb-linear 0 1.5 0 / 0.5), color(srgb-linear 0 1.5 0 / 0.5))", "#00ff0080"],
    ["color-mix(in srgb, color(srgb-linear 2 2 0), color(srgb-linear 2 2 0))", "#ff0"],
    [
      "color-mix(in srgb, light-dark(color(display-p3 0 1 0), red), light-dark(color(display-p3 0 1 0), blue))",
      "light-dark(#0f0, purple)",
    ],
    // The inner mix is folded to 8 bits before the outer one uses it, as an in-gamut inner mix
    // is too; browsers mix the unclipped inner result and get rgb(0, 130, 0) here.
    ["color-mix(in srgb, color-mix(in srgb, color(display-p3 0 1 0), color(display-p3 0 1 0)), black)", "green"],
  ])("%s is %s", (input, expected) => {
    expect(color(input, "css")).toBe(expected);
  });

  test("every output format gets the clipped color", () => {
    const mix = "color-mix(in srgb, color(display-p3 0 1 0), color(display-p3 0 1 0))";
    expect({
      rgb: color(mix, "{rgb}"),
      rgba: color(mix, "[rgba]"),
      hex: color(mix, "hex"),
      number: color(mix, "number"),
      ansi: color(mix, "ansi-16m"),
      hsl: color(mix, "hsl"),
    }).toEqual({
      rgb: { r: 0, g: 255, b: 0 },
      rgba: [0, 255, 0, 255],
      hex: "#00ff00",
      number: 0x00ff00,
      ansi: "\u001b[38;2;0;255;0m",
      hsl: "hsl(120, 100%, 50%)",
    });
  });

  // The gamut mapping already clipped a result whose clipped color is within its
  // just-noticeable difference, so results that are only slightly out of gamut fold to the
  // same color as before. The oklch() operands are Tailwind v4 palette entries in the shape
  // of its color-mix() fallback declarations.
  test.each([
    ["color-mix(in srgb, oklch(57.7% 0.245 27.325) 50%, transparent)", "#e7000b80"],
    ["color-mix(in srgb, oklch(69.6% 0.17 162.48) 30%, transparent)", "#00bc7d4d"],
    ["color-mix(in srgb, color(display-p3 0 1 0) 75%, white)", "#00ff04"],
    ["color-mix(in srgb, color(display-p3 0 1 0) 25%, white)", "#9fffab"],
    ["color-mix(in srgb, color(display-p3 0 0 1), color(display-p3 0 0 1))", "#00f"],
    // Converting this lab() red back to srgb leaves g and b around -1e-6.
    ["color-mix(in srgb, lab(54.2905% 80.8049 69.891), lab(54.2905% 80.8049 69.891))", "red"],
    ["color-mix(in srgb, red, blue)", "purple"],
    ["color-mix(in srgb, red 25%, blue)", "#4000bf"],
    ["color-mix(in srgb, rgb(255 0 0 / 0.5), blue)", "#5500aac0"],
    ["color-mix(in srgb, rgb(none 0 0), rgb(none 0 0))", "#000"],
    ["color-mix(in srgb, color(srgb-linear 1 0.2 0.001), color(srgb-linear 1 0.2 0.001))", "#ff7c03"],
    ["color-mix(in hsl, red, blue)", "#f0f"],
    ["color-mix(in hsl, hsl(120 100% 50% / 0.5), hsl(240 100% 50%))", "#00ffffc0"],
    ["color-mix(in hsl, hsl(none 100% 50%), hsl(none 100% 50%))", "red"],
    ["color-mix(in hwb, red, blue)", "#f0f"],
    ["color-mix(in hwb, hwb(120 0% 0% / 0.5), hwb(240 0% 0%))", "#00ffffc0"],
    ["rgb(none 0 0)", "#000"],
    ["hsl(none 100% 50%)", "red"],
  ])("%s is still %s", (input, expected) => {
    expect(color(input, "css")).toBe(expected);
  });
});

// color-mix(in hsl, ...) and color-mix(in hwb, ...) convert their operands into hsl or hwb first.
// That conversion used to gamut map an operand outside the sRGB gamut, so the mix was computed
// from a different color than the one written: display-p3 green went in as #00f942, and the
// bright lab()/oklch() magentas below went in as plain white (which even came back from the
// mapping with a stray hue and saturation, see the grey cases). css-color-4 converts the operand
// as it is: an hsl value with a saturation above 100% or a lightness outside 0%..100%, or an hwb
// value with a negative whiteness or blackness, which converts back to the same out-of-gamut
// sRGB channels. The mix is interpolated from those and the result is clipped like any other
// (the block above). WPT css/css-color/parsing/color-mix-out-of-gamut.html mixes the operands of
// the first table 100% / 0% with black in both spaces and expects the operand's own unclipped
// sRGB value back, so the fold is that value clipped to 8 bits: the same color the `in srgb` mixes
// above fold to. The other expected values are the css-color-4 sample code's results clipped to 8
// bits; the unclipped result is noted where it is not obvious.
describe("color-mix() in hsl and hwb mixes out-of-gamut operands as written", () => {
  const operands: [operand: string, expected: string, before: string][] = [
    ["color(display-p3 0 1 0)", "#0f0", "#00f942"],
    ["lab(100% 104.3 -50.9)", "#ff96ff", "#fff"],
    ["lab(0% 104.3 -50.9)", "#5a004c", "#2a0022"],
    ["lch(100% 116 334)", "#ff96ff", "#fff"],
    ["lch(0% 116 334)", "#5a004c", "#2a0022"],
    ["oklab(100% 0.365 -0.16)", "#ff5cff", "#fff"],
    ["oklab(0% 0.365 -0.16)", "#130018", "#000"],
    ["oklch(100% 0.399 336.3)", "#ff5bff", "#fff"],
    ["oklch(0% 0.399 336.3)", "#140018", "#000"],
  ];
  describe.each(["hsl", "hwb"])("in %s, mixed with 0% of black or with itself", space => {
    test.each(operands)("%s is %s (used to be %s)", (operand, expected) => {
      expect(color(`color-mix(in ${space}, ${operand} 100%, black 0%)`, "css")).toBe(expected);
      expect(color(`color-mix(in ${space}, ${operand}, ${operand})`, "css")).toBe(expected);
    });
  });

  test.each([
    // display-p3 green is hsl(127.9 302% 25.3%) and hwb(127.9 -51.2% -1.8%). Mixing with white or
    // black moves it halfway towards 100% / 0% lightness, or towards 100% whiteness / blackness.
    ["color-mix(in hsl, color(display-p3 0 1 0), white)", "#10ff36", "#9ddeae"],
    ["color-mix(in hwb, color(display-p3 0 1 0), white)", "#3eff58", "#80fca0"],
    ["color-mix(in hsl, color(display-p3 0 1 0), black)", "#005100", "#1f5d30"],
    ["color-mix(in hwb, color(display-p3 0 1 0), black)", "#008200", "#007c21"],
    ["color-mix(in hsl, color(display-p3 0 1 0) 25%, white)", "#abf3b5", "#d6e7db"],
    ["color-mix(in hwb, color(display-p3 0 1 0) 25%, white)", "#9fffab", "#bffdd0"],
    // The hue is interpolated from the operand's own hue (127.9, not the 135.9 of #00f942), and
    // the 302% saturation survives the mix: hsl(183.9 201% 37.7%) is color(srgb -0.38 1.03 1.13).
    ["color-mix(in hsl, color(display-p3 0 1 0), blue)", "#0ff", "#00dafc"],
    ["color-mix(in hwb, color(display-p3 0 1 0), blue)", "#00ecff", "#00dafc"],
    ["color-mix(in hsl longer hue, color(display-p3 0 1 0), blue)", "red", "#fc2100"],
    ["color-mix(in hwb longer hue, color(display-p3 0 1 0), blue)", "red", "#fc2100"],
    // The alpha is premultiplied into the out-of-range channels like into any other.
    ["color-mix(in hsl, color(display-p3 0 1 0 / 0.5), black)", "#002b06bf", "#1c3723bf"],
    ["color-mix(in hwb, color(display-p3 0 1 0 / 0.5), black)", "#005700bf", "#005316bf"],
    ["color-mix(in hsl, color(display-p3 0 1 0 / 0.5), color(display-p3 0 1 0 / 0.5))", "#00ff0080", "#00f94280"],
    [
      "color-mix(in hsl, light-dark(color(display-p3 0 1 0), red), light-dark(color(display-p3 0 1 0), blue))",
      "light-dark(#0f0, #f0f)",
      "light-dark(#00f942, #f0f)",
    ],
    // lab(100% 104.3 -50.9) is color(srgb 1.59 0.59 1.41): a lightness of 109%, which makes the
    // rgb-to-hsl saturation negative. The spec (w3c/csswg-drafts#9222) expresses that as the
    // opposite hue with a positive saturation, hsl(131.2 555% 109%), so in hsl it mixes with red
    // towards yellow. hwb keeps the hue of the channels themselves, hwb(311.2 58.8% -59.4%), the
    // only one its whiteness and blackness convert back with, so in hwb it mixes towards magenta.
    ["color-mix(in hsl, lab(100% 104.3 -50.9), red)", "#ffff20", "#bfef8f"],
    ["color-mix(in hwb, lab(100% 104.3 -50.9), red)", "#ff4bb3", "#bfff7f"],
    ["color-mix(in hsl, lab(100% 104.3 -50.9), black)", "#0f0", "#609f9f"],
    ["color-mix(in hwb, lab(100% 104.3 -50.9), black)", "#cb4bb3", "#7f8080"],
    ["color-mix(in hwb, lab(100% 104.3 -50.9), lab(0% 104.3 -50.9))", "#f830dc", "#817f94"],
    // lab(0% 104.3 -50.9) is color(srgb 0.35 -0.21 0.30): hsl(305.5 411% 6.9%), hwb(305.5 -21.4% 64.9%).
    ["color-mix(in hsl, lab(0% 104.3 -50.9), white)", "#f0f", "#c44fae"],
    ["color-mix(in hwb, lab(0% 104.3 -50.9), white)", "#ac64a6", "#948090"],
    ["color-mix(in hsl, oklch(100% 0.399 336.3) 50%, white)", "#ffd5ff", "#fff"],
    ["color-mix(in hwb, oklch(100% 0.399 336.3) 50%, white)", "#ffadff", "#fff"],
    // oklch(70% 0.4 145) is color(srgb -0.53 0.82 -0.39), hsl(126.4 466% 14.5%).
    ["color-mix(in hsl, oklch(70% 0.4 145), oklch(70% 0.4 145))", "#00d200", "#00c30b"],
    ["color-mix(in hsl, oklch(70% 0.4 145), black)", "#003e00", "#18491b"],
    ["color-mix(in hwb, oklch(70% 0.4 145), black)", "#006900", "#006105"],
    ["color-mix(in hsl, color(srgb-linear 0 1.5 0), color(srgb-linear 0 1.5 0))", "#0f0", "#edffea"],
    ["color-mix(in hwb, color(srgb-linear 0 1.5 0), color(srgb-linear 0 1.5 0))", "#0f0", "#edffea"],
    // Slightly out of gamut (Tailwind's red-600 is color(srgb 0.91 -0.10 0.04)): the operand is
    // mixed as written instead of as its gamut mapped #e7000b, which has a different hue.
    ["color-mix(in hsl, oklch(57.7% 0.245 27.325), white)", "#e28491", "#dc969a"],
    ["color-mix(in hwb, oklch(57.7% 0.245 27.325), white)", "#f37385", "#f38085"],
    // Greys outside the gamut: hsl(none 0% 120%) and hwb(none 120% -20%) have no hue to mix, and
    // hwb lands in the whiteness + blackness >= 100% branch with the out-of-range values. The
    // gamut mapping used to turn the bright one into a white carrying a noise hue and a 50%
    // saturation (from the conversion noise of its white), hence the teal hsl mix with black.
    ["color-mix(in hsl, color(srgb 1.2 1.2 1.2), black)", "#999", "#609f9f"],
    ["color-mix(in hwb, color(srgb 1.2 1.2 1.2), black)", "#999", "#7f8080"],
    ["color-mix(in hsl, color(srgb -0.2 -0.2 -0.2), white)", "#666", "gray"],
    ["color-mix(in hwb, color(srgb -0.2 -0.2 -0.2), white)", "#666", "gray"],
  ])("%s is %s (used to be %s)", (input, expected) => {
    expect(color(input, "css")).toBe(expected);
  });

  test("the typed output formats get the clipped result too", () => {
    const formats = (mix: string) => ({
      rgb: color(mix, "{rgb}"),
      rgba: color(mix, "[rgba]"),
      hex: color(mix, "hex"),
      hsl: color(mix, "hsl"),
    });
    const expected = {
      rgb: { r: 0, g: 255, b: 0 },
      rgba: [0, 255, 0, 255],
      hex: "#00ff00",
      hsl: "hsl(120, 100%, 50%)",
    };
    expect(formats("color-mix(in hsl, color(display-p3 0 1 0), color(display-p3 0 1 0))")).toEqual(expected);
    expect(formats("color-mix(in hwb, color(display-p3 0 1 0), color(display-p3 0 1 0))")).toEqual(expected);
  });

  // Operands inside the gamut convert exactly as before, so every mix of such operands is unchanged.
  // These also cover what the conversion change comes closest to: a boundary color written as lab()
  // converts back with channels a few 1e-7 outside the gamut, greys (8-bit, converted from lab(), or
  // out of gamut) have a missing hue, and an operand that only clips still folds to its clipped color.
  test.each([
    ["color-mix(in hsl, red, white)", "#df9f9f"],
    ["color-mix(in hsl, red, blue)", "#f0f"],
    ["color-mix(in hwb, red, blue)", "#f0f"],
    ["color-mix(in hsl, red 25%, blue)", "#8000ff"],
    ["color-mix(in hwb, red 25%, blue)", "#8000ff"],
    ["color-mix(in hsl, #808080, red)", "#bf4040"],
    ["color-mix(in hwb, #808080, red)", "#c04040"],
    ["color-mix(in hsl, lab(54.2905% 80.8049 69.891), lab(54.2905% 80.8049 69.891))", "red"],
    ["color-mix(in hwb, lab(54.2905% 80.8049 69.891), lab(54.2905% 80.8049 69.891))", "red"],
    ["color-mix(in hsl, lab(50% 0 0), lab(50% 0 0))", "#777"],
    ["color-mix(in hwb, lab(50% 0 0), lab(50% 0 0))", "#777"],
    // color(display-p3 0 0 1) is color(srgb 0 0 1.04); it clipped to #00f under the mapping too.
    ["color-mix(in hsl, color(display-p3 0 0 1), color(display-p3 0 0 1))", "#00f"],
    ["color-mix(in hwb, color(display-p3 0 0 1), color(display-p3 0 0 1))", "#00f"],
    ["color-mix(in hsl, color(srgb 1.2 1.2 1.2), color(srgb 1.2 1.2 1.2))", "#fff"],
    ["color-mix(in hwb, color(srgb -0.2 -0.2 -0.2), color(srgb -0.2 -0.2 -0.2))", "#000"],
  ])("%s is still %s", (input, expected) => {
    expect(color(input, "css")).toBe(expected);
  });
});

// The "hsl" output format converts the same way. It gamut maps first, like the rgb formats do,
// so a color outside the sRGB gamut still prints an hsl() inside 0%..100% that describes the
// same color as its "hex" output, rather than the unclipped hsl(305.5, 411%, 6.9%) of the first one.
describe('color(wide gamut input, "hsl") is the hsl of the gamut mapped color', () => {
  test.each([
    "lab(0% 104.3 -50.9)",
    "lch(0% 116 334)",
    "oklch(70% 0.4 145)",
    "oklab(60% -0.3 0.2)",
    "lab(100% 104.3 -50.9)",
  ])("%s", input => {
    const hsl = color(input, "hsl") as string;
    const [h, s, l] = hsl.match(/-?[\d.]+(?:e[+-]?\d+)?/g)!.map(Number);
    expect(hsl).toStartWith("hsl(");
    expect(h).toBeWithin(0, 360);
    expect(s).toBeWithin(0, 100.0001);
    expect(l).toBeWithin(0, 100.0001);
    expect(color(hsl, "hex")).toBe(color(input, "hex")!);
  });

  test("a color inside the gamut is converted without quantizing it to 8 bits first", () => {
    // #777777 is 46.67% lightness; the lab() grey itself is 46.63%.
    const [, s, l] = (color("lab(50% 0 0)", "hsl") as string).match(/-?[\d.]+(?:e[+-]?\d+)?/g)!.map(Number);
    expect(s).toBeCloseTo(0, 3);
    expect(l).toBeCloseTo(46.63, 1);
    expect(color("lab(50% 0 0)", "hex")).toBe("#777777");
  });
});

describe("conversions between color spaces", () => {
  // Each case converts a color whose channels all differ, so a channel landing
  // in another channel's place shows up in the output. Mixing a color with
  // itself is how a color is converted into a space Bun.color has no output
  // format for: color-mix() converts both operands into the interpolation
  // space and prints the result in it.
  const same = (space: string, value: string) => color(`color-mix(in ${space}, ${value}, ${value})`, "css") as string;
  const channels = (css: string) =>
    css
      .slice(css.indexOf("(") + 1)
      .match(/-?\d*\.?\d+(?:e[+-]?\d+)?/g)!
      .map(Number);
  const expectChannels = (css: string, expected: number[], digits: number) => {
    const actual = channels(css);
    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i]).toBeCloseTo(expected[i], digits);
    }
  };

  // Transcendental functions differ in the last f32 digit between platforms,
  // so the polar conversions are compared numerically.
  test.each([
    ["lch(50% 30 0)", [50, 30, 0]],
    ["lch(50% 30 90)", [50, 0, 30]],
    ["lch(50% 30 180)", [50, -30, 0]],
    ["lch(50% 30 270)", [50, 0, -30]],
  ])("%s has the lab channels %p", (input, expected) => {
    expectChannels(color(input, "lab") as string, expected as number[], 4);
  });

  test.each([
    ["oklch(60% 0.1 0)", "oklab(60% 0.1 0)"],
    ["oklch(60% 0.1 90)", "oklab(60% 0 0.1)"],
  ])("%s is the same color as %s", (polar, rectangular) => {
    expectChannels(color(polar, "lab") as string, channels(color(rectangular, "lab") as string), 3);
  });

  test.each([
    ["lch", "lab(50% 30 40)", [50, 50, 53.1301]],
    ["lch", "lab(50% 0 30)", [50, 30, 90]],
    ["lch", "lab(50% -30 0)", [50, 30, 180]],
    ["lch", "lab(50% 0 -30)", [50, 30, 270]],
    ["oklch", "oklab(60% 0.03 0.04)", [60, 0.05, 53.1301]],
  ])("converted to %s, %s has the channels %p", (space, input, expected) => {
    const out = same(space as string, input as string);
    expect(out).toStartWith(`${space}(`);
    expectChannels(out, expected as number[], 3);
  });

  // https://www.w3.org/TR/css-color-4/#color-conversion-code
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

  test("srgb to srgb-linear applies the transfer function to each channel", () => {
    const out = same("srgb-linear", "#ff8005");
    expect(out).toStartWith("color(srgb-linear ");
    expectChannels(out, [1, linear(128 / 255), linear(5 / 255)], 5);
  });

  test("srgb-linear to srgb applies the inverse to each channel", () => {
    // 1 -> 255, 0.2 -> 1.055 * 0.2^(1/2.4) - 0.055 = 0.4845 -> 124, and 0.001
    // is on the linear segment: 12.92 * 0.001 -> 3.
    expect(same("srgb", "color(srgb-linear 1 0.2 0.001)")).toBe("#ff7c03");
  });

  test("display-p3 to xyz linearizes each channel before the matrix", () => {
    // XYZ of the display-p3 primaries, i.e. the columns of the matrix in
    // https://www.w3.org/TR/css-color-4/#color-conversion-code. The matrix is
    // linear, so a color is the sum of its linearized channels times these.
    const red = [0.486571, 0.228975, 0];
    const green = [0.265668, 0.691739, 0.045113];
    const blue = [0.198217, 0.079287, 1.043944];
    const g = linear(0.5);
    const b = linear(0.002);
    const out = same("xyz", "color(display-p3 1 0.5 0.002)");
    expect(out).toStartWith("color(xyz ");
    expectChannels(
      out,
      [0, 1, 2].map(i => red[i] + g * green[i] + b * blue[i]),
      4,
    );
  });
});

// rgb(), hsl() and hwb() cannot hold an origin outside the sRGB gamut. Browsers compute the
// unclamped color and clip it when painting (w3c/csswg-drafts#8444): the display-p3 green
// below paints as #00ff00, the lab() one as #ff96ff. These used to be resolved by gamut
// mapping the origin, to #00f942 and #ffffff, so now they are not resolved at all.
describe("relative colors with an origin outside the sRGB gamut", () => {
  test.each([
    "rgb(from lab(100% 104.3 -50.9) r g b)",
    "hsl(from color(display-p3 0 1 0) h s l)",
    "hwb(from oklch(100% 0.399 336.3) h w b)",
    "rgb(from light-dark(red, color(display-p3 0 1 0)) r g b)",
    "color-mix(in srgb, rgb(from lab(100% 104.3 -50.9) r g b), red)",
  ])("%s is not resolved", input => {
    expect([color(input, "css"), color(input, "hex")]).toEqual([null, null]);
  });

  test.each([
    // In-gamut origins resolve as before.
    ["rgb(from lab(50% 40 -50) r g b)", "#965dcd"],
    ["hsl(from oklch(50% 0.1 120) h s l)", "#5c6b21"],
    ["hwb(from color(display-p3 0.4 0.4 0.4) h w b)", "#666"],
    // The unbounded functions hold any origin, so they still resolve out-of-gamut ones.
    ["lab(from oklch(100% 0.399 336.3) l a b)", "lab(94.0205% 119.644 -57.6823)"],
    ["color(from lab(100% 104.3 -50.9) srgb r g b)", "color(srgb 1.5935 .587758 1.40555)"],
  ])("%s is %s", (input, expected) => {
    expect(color(input, "css")).toBe(expected);
  });

  // A boundary color written in another space converts back a few 1e-7 outside the gamut.
  // That is conversion noise, not an out-of-gamut origin: every color on the faces of the
  // sRGB cube, written as the lab() Bun.color prints for it, still resolves to itself.
  test("boundary colors written as lab() still resolve", () => {
    withoutAggressiveGC(() => {
      const steps = [0, 51, 102, 153, 204, 255];
      for (const face of [0, 255]) {
        for (let axis = 0; axis < 3; axis++) {
          for (const x of steps) {
            for (const y of steps) {
              const rgb = [0, 0, 0];
              rgb[axis] = face;
              rgb[(axis + 1) % 3] = x;
              rgb[(axis + 2) % 3] = y;
              const hex = color({ r: rgb[0], g: rgb[1], b: rgb[2] }, "hex");
              const lab = color(hex!, "lab");
              for (const relative of [`rgb(from ${lab} r g b)`, `hsl(from ${lab} h s l)`, `hwb(from ${lab} h w b)`]) {
                const resolved = color(relative, "hex");
                if (resolved !== hex) {
                  throw new Error(`${relative} resolved to ${resolved}, expected ${hex}`);
                }
              }
            }
          }
        }
      }
    });
  });
});
