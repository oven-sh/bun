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
      console.log(color(input, "ansi-24bit" as "ansi-16m") + input);
    });

    test(`console.log(color(${JSON.stringify(input)}, "ansi-256"))`, () => {
      console.log(color(input, "ansi-256") + input);
    });
    test(`console.log(color(${JSON.stringify(input)}, "ansi-16"))`, () => {
      console.log(color(input, "ansi-16") + input);
    });

    test(`color(${JSON.stringify(input)}, "${format}") = ${JSON.stringify(input)}`, () => {
      expect(color(input, format as any)).toEqual(input);
    });

    test(`color(${JSON.stringify(input)}, "ansi-24bit")`, () => {
      expect(color(input, "ansi-24bit" as "ansi-16m")).toMatchSnapshot();
    });

    test(`color(${JSON.stringify(input)}, "ansi-16")`, () => {
      expect(color(input, "ansi-16")).toMatchSnapshot();
    });

    test(`color(${JSON.stringify(input)}, "ansi256")`, () => {
      expect(color(input, "ansi256" as "ansi-256")).toMatchSnapshot();
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
  expect(message).toStartWith("outputFormat must be one of ");
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
  // @ts-expect-error
  expect(() => color()).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
    }),
  );
});

describe.concurrent('color(input, "ansi") picks the escape for the detected color depth', () => {
  // The "ansi" format resolves against the terminal color depth derived from
  // the environment, so it has to be observed from a child process.
  type Result = { stdout: string; exitCode: number; stderr?: string };
  async function autoAnsi(env: Record<string, string | undefined>): Promise<Result> {
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
    return { stdout: JSON.stringify(color("#ff0000", format as "ansi-256")), exitCode: 0 };
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
      if (color((r << 16) | (g << 8) | b, "ansi256" as "ansi-256") === null) {
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
      expect(color(color(input, format as "hex") as string, "hex")).toBe(color(input, "hex"));
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
    expect({ stdout, exitCode, stderr: exitCode === 0 ? undefined : stderr }).toEqual<object>({
      stdout: "null",
      exitCode: 0,
    });
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

// A conversion into lch, oklch, hsl or hwb leaves the hue missing when the
// converted color is a grey, within the "powerless hue ε" of the space
// (https://drafts.csswg.org/css-color-4/#powerless). In color-mix() a missing
// hue takes the hue of the other color.
describe("the hue of a color converted to a grey is missing", () => {
  test.each([
    ["color-mix(in oklch, black, oklch(50% 0.2 120))", "oklch(25% .1 120)"],
    ["color-mix(in oklch, oklch(50% 0.2 120), black)", "oklch(25% .1 120)"],
    ["color-mix(in oklch, white, oklch(50% 0.2 120))", "oklch(75% .1 120)"],
    ["color-mix(in oklch, oklch(50% 0.2 120), black 20%)", "oklch(40% .16 120)"],
    ["color-mix(in lch, black, lch(50% 60 120))", "lch(25% 30 120)"],
    ["color-mix(in lch, white, lch(50% 60 120))", "lch(75% 30 120)"],
    // Two greys: nothing has a hue to give.
    ["color-mix(in oklch, white, black)", "oklch(50% 0 none)"],
    // A hue the author wrote for a grey in the interpolation space is used.
    ["color-mix(in oklch, oklch(50% 0 200), oklch(50% 0.2 120))", "oklch(50% .1 160)"],
    // Lightness makes no channel powerless, and an operand is not gamut mapped.
    ["color-mix(in lab, lab(0% 30 40), lab(50% 50 -20))", "lab(25% 40 10)"],
    ["color-mix(in srgb, color(srgb -0.51 1.018 -0.31), color(srgb 0.6 0.2 0.4))", "#0b9b0b"],
    ["color-mix(in srgb, color(display-p3 0 1 0), color(srgb 0.6 0.2 0.4))", "#0b9b0b"],
  ])("%s is %s", (input, expected) => {
    expect(color(input, "css")).toBe(expected);
  });

  test("the mix is the color that the hand-written mix converts to", () => {
    expect(color("color-mix(in oklch, black, oklch(50% 0.2 120))", "hex")).toBe(color("oklch(25% 0.1 120)", "hex"));
    expect(color("color-mix(in oklch, #3b82f6, white 20%)", "hex")).toBe("#649dfa");
  });

  // The hsl format converts with the same functions. Near black and white the
  // saturation of a grey is rounding noise divided by rounding noise.
  test.each(["lab(L% 0 0)", "lch(L% 0 0)", "oklab(L% 0 0)", "oklch(L% 0 0)"])(
    "%s in the hsl format has hue 0 and saturation 0",
    form => {
      const wrong: string[] = [];
      for (const lightness of [0, 0.1, 1, 50, 98.7, 99, 99.5, 99.9, 99.99, 100]) {
        const grey = form.replace("L", String(lightness));
        const hsl = color(grey, "hsl") as string;
        if (!hsl.startsWith("hsl(0, 0%, ")) wrong.push(`${grey} is ${hsl}`);
      }
      expect(wrong).toEqual([]);
    },
  );

  test.each(["color-mix(in oklch, canvas, red)", "color-mix(in oklch, red, canvas)"])(
    "%s has a system color and is not folded",
    input => {
      expect(color(input, "css")).toBeNull();
    },
  );
});

// Rows of two Web Platform Tests: `specified => computed`, with ` ± epsilon`
// where the row sets one (the default is 0.01). A channel that WPT writes as a
// bare number is written here as the percentage it stands for, because bun
// does not parse the number form. Chrome 153 paints every row here the same
// before and after the fold, within 4 of 255 per channel.
// https://github.com/web-platform-tests/wpt/tree/172abd268d46f326b3fe937a5a84b99ce0390907/css/css-color/parsing
describe("color-mix() computes what WPT expects", () => {
  // The color space, then the channels and alpha. `none` is NaN. bun prints the
  // lightness of oklab() and oklch() as a percentage, WPT as a number up to 1.
  const parse = (css: string): [string, number[]] => {
    const open = css.indexOf("(");
    const tokens = css
      .slice(open + 1, -1)
      .replace("/", " ")
      .trim()
      .split(/\s+/);
    const space = css.startsWith("color(") ? tokens.shift()! : css.slice(0, open);
    const values = tokens.map(token => (token === "none" ? NaN : parseFloat(token)));
    if (space.startsWith("ok") && tokens[0].endsWith("%")) values[0] /= 100;
    return [space, values.length === 3 ? [...values, 1] : values];
  };

  function expectComputed(specified: string, computed: string, epsilon: number) {
    const actual = color(specified, "css");
    expect(actual).not.toBeNull();
    const [space, want] = parse(computed);
    // bun prints a mix in srgb, hsl or hwb as an 8-bit color: a hex color or a color name.
    const eightBit = space === "srgb";
    let got: number[];
    if (eightBit) {
      expect(actual).not.toContain("(");
      got = (color(actual!, "[rgba]") as number[]).map(channel => channel / 255);
    } else {
      const [actualSpace, channels] = parse(actual!);
      expect(actualSpace).toBe(space);
      got = channels;
    }
    for (let i = 0; i < 4; i++) {
      if (Number.isNaN(want[i])) {
        expect(got[i]).toBeNaN();
        continue;
      }
      let distance = Math.abs(got[i] - want[i]);
      // The third channel of lch() and oklch() is an angle.
      if (i === 2 && space.endsWith("lch")) distance = Math.min(distance % 360, 360 - (distance % 360));
      expect(distance).toBeLessThanOrEqual(eightBit ? epsilon + 0.5 / 255 : epsilon);
    }
  }

  const rows = (text: string) =>
    text
      .trim()
      .split("\n")
      .map(row => row.split(/ => | ± /));

  describe.each([
    [
      // Rows with two operands.
      "color-computed-powerless.html",
      `
color-mix(in hsl, hsl(0 50% 50%), hsl(11 33% 44%)) => color(srgb 0.66505 0.31070917 0.27495)
color-mix(in hsl, hsl(0 0% 0%), hsl(11 33% 44%)) => color(srgb 0.2563 0.190355 0.1837)
color-mix(in hsl, hsl(180 0.001% 50%), hsl(11 33% 44%)) => color(srgb 0.45578207 0.54755235 0.39244765)
color-mix(in hsl, hsl(180 0.0011% 50%), hsl(11 33% 44%)) => color(srgb 0.45578203 0.54755258 0.39244742)
color-mix(in hsl, hwb(0 25% 25%), hsl(11 33% 44%)) => color(srgb 0.66505 0.31070917 0.27495)
color-mix(in hsl, hwb(180 100% 25%), hsl(11 33% 44%)) => color(srgb 0.6827 0.58029 0.5573)
color-mix(in hsl, hwb(180 25% 100%), hsl(11 33% 44%)) => color(srgb 0.3728 0.28656 0.2672)
color-mix(in hsl, hwb(0 100% 25%), hsl(11 33% 44%)) => color(srgb 0.6827 0.58029 0.5573)
color-mix(in hsl, hwb(180 100% 100%), hsl(11 33% 44%)) => color(srgb 0.54755 0.420885 0.39245)
color-mix(in hsl, hwb(0 25% 100%), hsl(11 33% 44%)) => color(srgb 0.3728 0.28656 0.2672)
color-mix(in hsl, hwb(0 100% 100%), hsl(11 33% 44%)) => color(srgb 0.54755 0.420885 0.39245)
color-mix(in hsl, hwb(180 49.998% 50%), hsl(11 33% 44%)) => color(srgb 0.45577679 0.54754888 0.39244112)
color-mix(in hsl, lch(20% 20 0), hsl(11 33% 44%)) => color(srgb 0.43993218 0.21654551 0.23423138)
color-mix(in hsl, lch(0% 0 180), hsl(11 33% 44%)) => color(srgb 0.2563 0.19701 0.1837)
color-mix(in hsl, lch(0% 0 0), hsl(11 33% 44%)) => color(srgb 0.2563 0.19701 0.1837)
color-mix(in hsl, lch(20% 0.00151 180), hsl(11 33% 44%)) => color(srgb 0.31843217 0.36661447 0.26275819)
color-mix(in hsl, oklch(0% 0 180), hsl(11 33% 44%)) => color(srgb 0.2563 0.19701 0.1837)
color-mix(in hsl, oklch(0% 0 0), hsl(11 33% 44%)) => color(srgb 0.2563 0.19701 0.1837)
color-mix(in hsl, oklch(20% 0.0000041 180), hsl(11 33% 44%)) => color(srgb 0.26585563 0.30646187 0.21964017)
color-mix(in hsl, rgb(0 0 0), hsl(11 33% 44%)) => color(srgb 0.2563 0.19701 0.1837)
color-mix(in hsl, color(display-p3 0 0 0), hsl(11 33% 44%)) => color(srgb 0.2563 0.19701 0.1837)
color-mix(in hsl, lab(0% 0 0), hsl(11 33% 44%)) => color(srgb 0.2563 0.19701 0.1837)
color-mix(in hsl, oklab(0% 0 0), hsl(11 33% 44%)) => color(srgb 0.2563 0.19701 0.1837)
color-mix(in hsl, color(display-p3 0.49999645 0.50000513 0.50000531), hsl(11 33% 44%)) => color(srgb 0.45576023 0.54755258 0.39244741)
color-mix(in hwb, hsl(0 50% 50%), hwb(11 33% 44%)) => color(srgb 0.655 0.32345833 0.29)
color-mix(in hwb, hsl(180 0% 50%), hwb(11 33% 44%)) => color(srgb 0.53 0.43608333 0.415)
color-mix(in hwb, hsl(180 50% 0%), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, hsl(0 0% 50%), hwb(11 33% 44%)) => color(srgb 0.53 0.43608333 0.415)
color-mix(in hwb, hsl(180 0% 0%), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, hsl(0 50% 0%), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, hsl(0 0% 0%), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, hsl(180 0.0011% 50%), hwb(11 33% 44%)) => color(srgb 0.46195783 0.53000275 0.41499725)
color-mix(in hwb, hwb(0 25% 25%), hwb(11 33% 44%)) => color(srgb 0.655 0.32345833 0.29)
color-mix(in hwb, hwb(180 99.999% none), hwb(11 33% 44%)) => color(srgb 0.60180815 0.60180815 0.60180815)
color-mix(in hwb, hwb(180 none 99.999%), hwb(11 33% 44%)) => color(srgb 0.31428721 0.31428721 0.31428721)
color-mix(in hwb, hwb(180 49.999% 50%), hwb(11 33% 44%)) => color(srgb 0.46195538 0.53 0.414995)
color-mix(in hwb, hwb(180 49.998% 50%), hwb(11 33% 44%)) => color(srgb 0.46195242 0.53 0.41499)
color-mix(in hwb, lch(20% 20 0), hwb(11 33% 44%)) => color(srgb 0.4261832 0.23529449 0.25040745)
color-mix(in hwb, lch(0% 0 180), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, lch(0% 0 0), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, lch(20% 0.00151 180), hwb(11 33% 44%)) => color(srgb 0.32133431 0.37468928 0.25968338)
color-mix(in hwb, oklch(0% 0 180), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, oklch(0% 0 0), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, oklch(80% 0.0000041 180), hwb(11 33% 44%)) => color(srgb 0.5978169 0.65160487 0.53659799)
color-mix(in hwb, rgb(0 0 0), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, color(display-p3 0 0 0), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, lab(0% 0 0), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, oklab(0% 0 0), hwb(11 33% 44%)) => color(srgb 0.28 0.18608333 0.165)
color-mix(in hwb, color(display-p3 0.49999645 0.50000513 0.50000531), hwb(11 33% 44%)) => color(srgb 0.46194167 0.53000275 0.41499725)
color-mix(in lch, hsl(180 50% 0%), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in lch, hsl(180 0% 0%), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in lch, hsl(0 50% 0%), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in lch, hsl(0 0% 0%), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in lch, hwb(180 100% 25%), lch(11% 33 44)) => lch(46.52289084 16.5 44)
color-mix(in lch, hwb(180 25% 100%), lch(11% 33 44)) => lch(16.12336565 16.5 44)
color-mix(in lch, hwb(0 100% 25%), lch(11% 33 44)) => lch(46.52289084 16.5 44)
color-mix(in lch, hwb(0 25% 100%), lch(11% 33 44)) => lch(16.12336565 16.5 44)
color-mix(in lch, hwb(180 99.999% 0%), lch(11% 33 44)) => lch(55.49956019 16.5 44)
color-mix(in lch, lch(0% 20 180), lch(11% 33 44)) => lch(5.5 26.5 112)
color-mix(in lch, lch(20% 0 180), lch(11% 33 44)) => lch(15.5 16.5 112)
color-mix(in lch, lch(20% 20 0), lch(11% 33 44)) => lch(15.5 26.5 22)
color-mix(in lch, lch(0% 0 180), lch(11% 33 44)) => lch(5.5 16.5 112)
color-mix(in lch, lch(20% 0 0), lch(11% 33 44)) => lch(15.5 16.5 22)
color-mix(in lch, lch(0% 20 0), lch(11% 33 44)) => lch(5.5 26.5 22)
color-mix(in lch, lch(0% 0 0), lch(11% 33 44)) => lch(5.5 16.5 22)
color-mix(in lch, lch(20% 0.0015 180), lch(11% 33 44)) => lch(15.5 16.50075 112)
color-mix(in lch, lch(20% 0.00151 180), lch(11% 33 44)) => lch(15.5 16.500755 112)
color-mix(in lch, oklch(0% 0.2 180), lch(11% 33 44)) => lch(5.50498007 17.8251974 112.60184783)
color-mix(in lch, oklch(20% 0 180), lch(11% 33 44)) => lch(9.11318519 16.5 44)
color-mix(in lch, oklch(20% 0.2 0), lch(11% 33 44)) => lch(8.05436608 46.24412025 22.62103659)
color-mix(in lch, oklch(0% 0 180), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in lch, oklch(20% 0 0), lch(11% 33 44)) => lch(9.11318519 16.5 44)
color-mix(in lch, oklch(0% 0.2 0), lch(11% 33 44)) => lch(5.49501993 17.8251974 22.60184783)
color-mix(in lch, oklch(0% 0 0), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in lch, oklch(20% 0.000004 180), lch(11% 33 44)) => lch(9.11318519 16.5 44)
color-mix(in lch, oklch(20% 0.0000041 180), lch(11% 33 44)) => lch(9.11320925 16.5 44)
color-mix(in lch, rgb(0 0 0), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in lch, color(display-p3 0 0 0), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in lch, lab(0% 0 0), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in lch, oklab(0% 0 0), lch(11% 33 44)) => lch(5.5 16.5 44)
color-mix(in oklch, hsl(180 0% 50%), oklch(11% 0.33 0.44)) => oklch(0.35409037 0.165 0.44)
color-mix(in oklch, hsl(180 50% 0%), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
color-mix(in oklch, hsl(0 0% 50%), oklch(11% 0.33 0.44)) => oklch(0.35409037 0.165 0.44)
color-mix(in oklch, hsl(180 0% 0%), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
color-mix(in oklch, hsl(0 50% 0%), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
color-mix(in oklch, hsl(0 0% 0%), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
color-mix(in oklch, hwb(180 100% 25%), oklch(11% 0.33 0.44)) => oklch(0.47761113 0.165 0.44)
color-mix(in oklch, hwb(180 25% 100%), oklch(11% 0.33 0.44)) => oklch(0.21554626 0.165 0.44)
color-mix(in oklch, hwb(0 100% 25%), oklch(11% 0.33 0.44)) => oklch(0.47761113 0.165 0.44)
color-mix(in oklch, hwb(180 100% 100%), oklch(11% 0.33 0.44)) => oklch(0.35409037 0.165 0.44)
color-mix(in oklch, hwb(0 25% 100%), oklch(11% 0.33 0.44)) => oklch(0.21554626 0.165 0.44)
color-mix(in oklch, hwb(0 100% 100%), oklch(11% 0.33 0.44)) => oklch(0.35409037 0.165 0.44)
color-mix(in oklch, hwb(180 99.999% 0%), oklch(11% 0.33 0.44)) => oklch(0.55499621 0.165 0.44)
color-mix(in oklch, lch(0% 20 180), oklch(11% 0.33 0.44)) => oklch(0.02666949 0.29706278 87.85566456)
color-mix(in oklch, lch(20% 0 180), oklch(11% 0.33 0.44)) => oklch(0.21017241 0.165 0.44)
color-mix(in oklch, lch(20% 20 0), oklch(11% 0.33 0.44)) => oklch(0.21348598 0.19542764 359.91650151)
color-mix(in oklch, lch(0% 0 180), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
color-mix(in oklch, lch(20% 0 0), oklch(11% 0.33 0.44)) => oklch(0.21017241 0.165 0.44)
color-mix(in oklch, lch(0% 20 0), oklch(11% 0.33 0.44)) => oklch(0.08333051 0.29706278 357.85566456)
color-mix(in oklch, lch(0% 0 0), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
color-mix(in oklch, oklch(0% 0.2 180), oklch(11% 0.33 0.44)) => oklch(0.055 0.265 90.22)
color-mix(in oklch, oklch(20% 0 180), oklch(11% 0.33 0.44)) => oklch(0.155 0.165 90.22)
color-mix(in oklch, oklch(20% 0.2 0), oklch(11% 0.33 0.44)) => oklch(0.155 0.265 0.22)
color-mix(in oklch, oklch(0% 0 180), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 90.22)
color-mix(in oklch, oklch(20% 0 0), oklch(11% 0.33 0.44)) => oklch(0.155 0.165 0.22)
color-mix(in oklch, oklch(0% 0.2 0), oklch(11% 0.33 0.44)) => oklch(0.055 0.265 0.22)
color-mix(in oklch, oklch(0% 0 0), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.22)
color-mix(in oklch, oklch(20% 0.000004 180), oklch(11% 0.33 0.44)) => oklch(0.155 0.165002 90.22)
color-mix(in oklch, oklch(20% 0.0000041 180), oklch(11% 0.33 0.44)) => oklch(0.155 0.16500205 90.22)
color-mix(in oklch, rgb(0 0 0), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
color-mix(in oklch, color(display-p3 0 0 0), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
color-mix(in oklch, lab(0% 0 0), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
color-mix(in oklch, oklab(0% 0 0), oklch(11% 0.33 0.44)) => oklch(0.055 0.165 0.44)
`,
    ],
    [
      // The rows with a grey operand, an operand with `none`, or an operand
      // written in the interpolation space.
      "color-computed-color-mix-function.html",
      `
color-mix(in hsl, hsl(none none none), hsl(30deg 40% 80%)) => color(srgb 0.88 0.8 0.72)
color-mix(in hsl, hsl(120deg 20% 40%), hsl(none none none)) => color(srgb 0.32 0.48 0.32)
color-mix(in hsl, hsl(120deg 20% none), hsl(30deg 40% 60%)) => color(srgb 0.66 0.72 0.48)
color-mix(in hsl, hsl(120deg 20% 40%), hsl(30deg 20% none)) => color(srgb 0.44 0.48 0.32)
color-mix(in hsl, hsl(none 20% 40%), hsl(30deg none 80%)) => color(srgb 0.68 0.6 0.52)
color-mix(in hsl, hsl(30deg 40% 80% / 25%) 0%, hsl(90deg none none / none)) => color(srgb 0.8 0.88 0.72 / 0.25)
color-mix(in hsl, hsl(30deg 40% 80% / 25%) 0%, hsl(none 50% none / none)) => color(srgb 0.9 0.8 0.7 / 0.25)
color-mix(in hsl, hsl(30deg 40% 80% / 25%) 0%, hsl(none none 50% / none)) => color(srgb 0.7 0.5 0.3 / 0.25)
color-mix(in hsl, hsl(30deg 40% 80% / 25%) 0%, hsl(90deg 50% none / none)) => color(srgb 0.8 0.9 0.7 / 0.25)
color-mix(in hsl, hsl(30deg 40% 80% / 25%) 0%, hsl(none none none / 0.5)) => color(srgb 0.88 0.8 0.72 / 0.5)
color-mix(in hsl, hsl(30deg 40% 80% / 25%) 0%, hsl(90deg none none / 0.5)) => color(srgb 0.8 0.88 0.72 / 0.5)
color-mix(in hwb, hwb(none none none), hwb(30deg 30% 40%)) => color(srgb 0.6 0.45 0.3)
color-mix(in hwb, hwb(120deg 10% 20%), hwb(none none none)) => color(srgb 0.1 0.8 0.1)
color-mix(in hwb, hwb(120deg 10% none), hwb(30deg 30% 40%)) => color(srgb 0.5 0.6 0.2)
color-mix(in hwb, hwb(120deg 10% 20%), hwb(30deg 30% none)) => color(srgb 0.65 0.8 0.2)
color-mix(in hwb, hwb(none 10% 20%), hwb(30deg none 40%)) => color(srgb 0.7 0.4 0.1)
color-mix(in hwb, hwb(30deg 30% 40% / 25%) 0%, hwb(90deg none none / none)) => color(srgb 0.45 0.6 0.3 / 0.25)
color-mix(in hwb, hwb(30deg 30% 40% / 25%) 0%, hwb(none 50% none / none)) => color(srgb 0.6 0.55 0.5 / 0.25)
color-mix(in hwb, hwb(30deg 30% 40% / 25%) 0%, hwb(none none 50% / none)) => color(srgb 0.5 0.4 0.3 / 0.25)
color-mix(in hwb, hwb(30deg 30% 40% / 25%) 0%, hwb(90deg 50% none / none)) => color(srgb 0.55 0.6 0.5 / 0.25)
color-mix(in hwb, hwb(30deg 30% 40% / 25%) 0%, hwb(none none none / 0.5)) => color(srgb 0.6 0.45 0.3 / 0.5)
color-mix(in hwb, hwb(30deg 30% 40% / 25%) 0%, hwb(90deg none none / 0.5)) => color(srgb 0.45 0.6 0.3 / 0.5)
color-mix(in lch, white, blue) => lch(64.78 65.6 301.36) ± 0.1
color-mix(in lch, white 10%, blue) => lch(36.61 118.08 301.36) ± 0.1
color-mix(in lch, lch(100% 0 40deg), lch(100% 0 60deg)) => lch(100 0 50)
color-mix(in lch, lch(100% 0 60deg), lch(100% 0 40deg)) => lch(100 0 50)
color-mix(in lch, lch(100% 0 50deg), lch(100% 0 330deg)) => lch(100 0 10)
color-mix(in lch, lch(100% 0 330deg), lch(100% 0 50deg)) => lch(100 0 10)
color-mix(in lch, lch(100% 0 20deg), lch(100% 0 320deg)) => lch(100 0 350)
color-mix(in lch, lch(100% 0 320deg), lch(100% 0 20deg)) => lch(100 0 350)
color-mix(in lch shorter hue, lch(100% 0 40deg), lch(100% 0 60deg)) => lch(100 0 50)
color-mix(in lch shorter hue, lch(100% 0 60deg), lch(100% 0 40deg)) => lch(100 0 50)
color-mix(in lch shorter hue, lch(100% 0 50deg), lch(100% 0 330deg)) => lch(100 0 10)
color-mix(in lch shorter hue, lch(100% 0 330deg), lch(100% 0 50deg)) => lch(100 0 10)
color-mix(in lch shorter hue, lch(100% 0 20deg), lch(100% 0 320deg)) => lch(100 0 350)
color-mix(in lch shorter hue, lch(100% 0 320deg), lch(100% 0 20deg)) => lch(100 0 350)
color-mix(in lch shorter hue, red, white) => lch(77.145 53.4186 40.858)
color-mix(in lch shorter hue, red, black) => lch(27.145 53.4186 40.858)
color-mix(in lch longer hue, lch(100% 0 40deg), lch(100% 0 60deg)) => lch(100 0 230)
color-mix(in lch longer hue, lch(100% 0 60deg), lch(100% 0 40deg)) => lch(100 0 230)
color-mix(in lch longer hue, lch(100% 0 50deg), lch(100% 0 330deg)) => lch(100 0 190)
color-mix(in lch longer hue, lch(100% 0 330deg), lch(100% 0 50deg)) => lch(100 0 190)
color-mix(in lch longer hue, lch(100% 0 20deg), lch(100% 0 320deg)) => lch(100 0 170)
color-mix(in lch longer hue, lch(100% 0 320deg), lch(100% 0 20deg)) => lch(100 0 170)
color-mix(in lch increasing hue, lch(100% 0 40deg), lch(100% 0 60deg)) => lch(100 0 50)
color-mix(in lch increasing hue, lch(100% 0 60deg), lch(100% 0 40deg)) => lch(100 0 230)
color-mix(in lch increasing hue, lch(100% 0 50deg), lch(100% 0 330deg)) => lch(100 0 190)
color-mix(in lch increasing hue, lch(100% 0 330deg), lch(100% 0 50deg)) => lch(100 0 10)
color-mix(in lch increasing hue, lch(100% 0 20deg), lch(100% 0 320deg)) => lch(100 0 170)
color-mix(in lch increasing hue, lch(100% 0 320deg), lch(100% 0 20deg)) => lch(100 0 350)
color-mix(in lch increasing hue, red, white) => lch(77.145 53.4186 40.858)
color-mix(in lch increasing hue, red, black) => lch(27.145 53.4186 40.858)
color-mix(in lch decreasing hue, lch(100% 0 40deg), lch(100% 0 60deg)) => lch(100 0 230)
color-mix(in lch decreasing hue, lch(100% 0 60deg), lch(100% 0 40deg)) => lch(100 0 50)
color-mix(in lch decreasing hue, lch(100% 0 50deg), lch(100% 0 330deg)) => lch(100 0 10)
color-mix(in lch decreasing hue, lch(100% 0 330deg), lch(100% 0 50deg)) => lch(100 0 190)
color-mix(in lch decreasing hue, lch(100% 0 20deg), lch(100% 0 320deg)) => lch(100 0 350)
color-mix(in lch decreasing hue, lch(100% 0 320deg), lch(100% 0 20deg)) => lch(100 0 170)
color-mix(in lch decreasing hue, red, white) => lch(77.145 53.4186 40.858)
color-mix(in lch decreasing hue, red, black) => lch(27.145 53.4186 40.858)
color-mix(in lch, lab(50% 0 0), black) => lch(25 0 none)
color-mix(in oklch, white, blue) => oklch(0.726 0.157 264.052)
color-mix(in oklch, white 10%, blue) => oklch(0.507 0.282 264.052)
color-mix(in oklch, oklch(100% 0 40deg), oklch(100% 0 60deg)) => oklch(1 0 50)
color-mix(in oklch, oklch(100% 0 60deg), oklch(100% 0 40deg)) => oklch(1 0 50)
color-mix(in oklch, oklch(100% 0 50deg), oklch(100% 0 330deg)) => oklch(1 0 10)
color-mix(in oklch, oklch(100% 0 330deg), oklch(100% 0 50deg)) => oklch(1 0 10)
color-mix(in oklch, oklch(100% 0 20deg), oklch(100% 0 320deg)) => oklch(1 0 350)
color-mix(in oklch, oklch(100% 0 320deg), oklch(100% 0 20deg)) => oklch(1 0 350)
color-mix(in oklch shorter hue, oklch(100% 0 40deg), oklch(100% 0 60deg)) => oklch(1 0 50)
color-mix(in oklch shorter hue, oklch(100% 0 60deg), oklch(100% 0 40deg)) => oklch(1 0 50)
color-mix(in oklch shorter hue, oklch(100% 0 50deg), oklch(100% 0 330deg)) => oklch(1 0 10)
color-mix(in oklch shorter hue, oklch(100% 0 330deg), oklch(100% 0 50deg)) => oklch(1 0 10)
color-mix(in oklch shorter hue, oklch(100% 0 20deg), oklch(100% 0 320deg)) => oklch(1 0 350)
color-mix(in oklch shorter hue, oklch(100% 0 320deg), oklch(100% 0 20deg)) => oklch(1 0 350)
color-mix(in oklch shorter hue, red, white) => oklch(0.81398 0.128842 29.2339)
color-mix(in oklch shorter hue, red, black) => oklch(0.313978 0.128842 29.2339)
color-mix(in oklch longer hue, oklch(100% 0 40deg), oklch(100% 0 60deg)) => oklch(1 0 230)
color-mix(in oklch longer hue, oklch(100% 0 60deg), oklch(100% 0 40deg)) => oklch(1 0 230)
color-mix(in oklch longer hue, oklch(100% 0 50deg), oklch(100% 0 330deg)) => oklch(1 0 190)
color-mix(in oklch longer hue, oklch(100% 0 330deg), oklch(100% 0 50deg)) => oklch(1 0 190)
color-mix(in oklch longer hue, oklch(100% 0 20deg), oklch(100% 0 320deg)) => oklch(1 0 170)
color-mix(in oklch longer hue, oklch(100% 0 320deg), oklch(100% 0 20deg)) => oklch(1 0 170)
color-mix(in oklch increasing hue, oklch(100% 0 40deg), oklch(100% 0 60deg)) => oklch(1 0 50)
color-mix(in oklch increasing hue, oklch(100% 0 60deg), oklch(100% 0 40deg)) => oklch(1 0 230)
color-mix(in oklch increasing hue, oklch(100% 0 50deg), oklch(100% 0 330deg)) => oklch(1 0 190)
color-mix(in oklch increasing hue, oklch(100% 0 330deg), oklch(100% 0 50deg)) => oklch(1 0 10)
color-mix(in oklch increasing hue, oklch(100% 0 20deg), oklch(100% 0 320deg)) => oklch(1 0 170)
color-mix(in oklch increasing hue, oklch(100% 0 320deg), oklch(100% 0 20deg)) => oklch(1 0 350)
color-mix(in oklch increasing hue, red, white) => oklch(0.81398 0.128842 29.2339)
color-mix(in oklch increasing hue, red, black) => oklch(0.313978 0.128842 29.2339)
color-mix(in oklch decreasing hue, oklch(100% 0 40deg), oklch(100% 0 60deg)) => oklch(1 0 230)
color-mix(in oklch decreasing hue, oklch(100% 0 60deg), oklch(100% 0 40deg)) => oklch(1 0 50)
color-mix(in oklch decreasing hue, oklch(100% 0 50deg), oklch(100% 0 330deg)) => oklch(1 0 10)
color-mix(in oklch decreasing hue, oklch(100% 0 330deg), oklch(100% 0 50deg)) => oklch(1 0 190)
color-mix(in oklch decreasing hue, oklch(100% 0 20deg), oklch(100% 0 320deg)) => oklch(1 0 350)
color-mix(in oklch decreasing hue, oklch(100% 0 320deg), oklch(100% 0 20deg)) => oklch(1 0 170)
color-mix(in oklch decreasing hue, red, white) => oklch(0.81398 0.128842 29.2339)
color-mix(in oklch decreasing hue, red, black) => oklch(0.313978 0.128842 29.2339)
color-mix(in oklch, oklab(50% 0 0), black) => oklch(0.25 0 none)
color-mix(in srgb, color(srgb none none none), color(srgb .5 .6 .7)) => color(srgb 0.5 0.6 0.7)
color-mix(in srgb, color(srgb .1 .2 .3), color(srgb none none none)) => color(srgb 0.1 0.2 0.3)
color-mix(in srgb, color(srgb .1 .2 none), color(srgb .5 .6 .7)) => color(srgb 0.3 0.4 0.7)
color-mix(in srgb, color(srgb .1 .2 .3), color(srgb .5 .6 none)) => color(srgb 0.3 0.4 0.3)
color-mix(in srgb, color(srgb none .2 .3), color(srgb .5 none .7)) => color(srgb 0.5 0.2 0.5)
color-mix(in srgb, color(srgb .1 .2 .3 / 25%) 0%, color(srgb 0.5 none none / none)) => color(srgb 0.5 0.2 0.3 / 0.25)
color-mix(in srgb, color(srgb .1 .2 .3 / 25%) 0%, color(srgb none 0.5 none / none)) => color(srgb 0.1 0.5 0.3 / 0.25)
color-mix(in srgb, color(srgb .1 .2 .3 / 25%) 0%, color(srgb none none 0.5 / none)) => color(srgb 0.1 0.2 0.5 / 0.25)
color-mix(in srgb, color(srgb .1 .2 .3 / 25%) 0%, color(srgb 0.5 0.5 none / none)) => color(srgb 0.5 0.5 0.3 / 0.25)
color-mix(in srgb, color(srgb .1 .2 .3 / 25%) 0%, color(srgb none none none / 50%)) => color(srgb 0.1 0.2 0.3 / 0.5)
color-mix(in srgb, color(srgb .1 .2 .3 / 25%) 0%, color(srgb 0.5 none none / 50%)) => color(srgb 0.5 0.2 0.3 / 0.5)
color-mix(in srgb-linear, color(srgb-linear 2 3 4 / 5), color(srgb-linear 4 6 8 / 10)) => color(srgb-linear 3 4.5 6)
color-mix(in srgb-linear, color(srgb-linear -2 -3 -4), color(srgb-linear -4 -6 -8)) => color(srgb-linear -3 -4.5 -6)
color-mix(in srgb-linear, color(srgb-linear none none none), color(srgb-linear none none none)) => color(srgb-linear none none none)
color-mix(in srgb-linear, color(srgb-linear none none none), color(srgb-linear .5 .6 .7)) => color(srgb-linear 0.5 0.6 0.7)
color-mix(in srgb-linear, color(srgb-linear .1 .2 .3), color(srgb-linear none none none)) => color(srgb-linear 0.1 0.2 0.3)
color-mix(in srgb-linear, color(srgb-linear .1 .2 none), color(srgb-linear .5 .6 .7)) => color(srgb-linear 0.3 0.4 0.7)
color-mix(in srgb-linear, color(srgb-linear .1 .2 .3), color(srgb-linear .5 .6 none)) => color(srgb-linear 0.3 0.4 0.3)
color-mix(in srgb-linear, color(srgb-linear none .2 .3), color(srgb-linear .5 none .7)) => color(srgb-linear 0.5 0.2 0.5)
color-mix(in srgb-linear, color(srgb-linear .1 .2 .3 / 25%) 0%, color(srgb-linear 0.5 none none / none)) => color(srgb-linear 0.5 0.2 0.3 / 0.25)
color-mix(in srgb-linear, color(srgb-linear .1 .2 .3 / 25%) 0%, color(srgb-linear none 0.5 none / none)) => color(srgb-linear 0.1 0.5 0.3 / 0.25)
color-mix(in srgb-linear, color(srgb-linear .1 .2 .3 / 25%) 0%, color(srgb-linear none none 0.5 / none)) => color(srgb-linear 0.1 0.2 0.5 / 0.25)
color-mix(in srgb-linear, color(srgb-linear .1 .2 .3 / 25%) 0%, color(srgb-linear 0.5 0.5 none / none)) => color(srgb-linear 0.5 0.5 0.3 / 0.25)
color-mix(in srgb-linear, color(srgb-linear .1 .2 .3 / 25%) 0%, color(srgb-linear none none none / 50%)) => color(srgb-linear 0.1 0.2 0.3 / 0.5)
color-mix(in srgb-linear, color(srgb-linear .1 .2 .3 / 25%) 0%, color(srgb-linear 0.5 none none / 50%)) => color(srgb-linear 0.5 0.2 0.3 / 0.5)
color-mix(in lch, hsl(0 100% 100%), blue) => lch(64.784 65.6 301.364) ± 0.001
color-mix(in lch, lch(100% 0 0), blue) => lch(64.784 65.6 330.682) ± 0.001
color-mix(in lch, oklch(100% 0 0), blue) => lch(64.784 65.6 301.364) ± 0.001
color-mix(in oklch, hsl(0 100% 100%), blue) => oklch(0.726 0.1566 264.052) ± 0.001
color-mix(in oklch, lch(100% 0 0), blue) => oklch(0.726 0.1566 264.052) ± 0.001
color-mix(in oklch, oklch(100% 0 0), blue) => oklch(0.726 0.15661 312.026) ± 0.001
`,
    ],
    [
      // `longer hue` with a hue difference of 0 adds 360 to the second hue.
      "color-computed-color-mix-function.html, longer hue",
      `
color-mix(in hsl longer hue, hsl(60deg 50% 50%), hsl(60deg 50% 50%)) => color(srgb 0.25 0.25 0.75)
color-mix(in hsl longer hue, red, white) => color(srgb 0.625 0.875 0.875)
color-mix(in hsl longer hue, red, black) => color(srgb 0.125 0.375 0.375)
color-mix(in hsl longer hue, red, transparent) => color(srgb 0 1 1 / 0.5)
color-mix(in hwb longer hue, red, white) => color(srgb 0.5 1 1)
color-mix(in hwb longer hue, red, black) => color(srgb 0 0.5 0.5)
color-mix(in hwb longer hue, red, transparent) => color(srgb 0 1 1 / 0.5)
color-mix(in lch longer hue, red, white) => lch(77.145 53.4186 220.858)
color-mix(in lch longer hue, red, black) => lch(27.145 53.4186 220.858)
color-mix(in oklch longer hue, red, white) => oklch(0.81398 0.128842 209.234)
color-mix(in oklch longer hue, red, black) => oklch(0.313978 0.128842 209.2339)
`,
    ],
  ])("%s", (_, text) => {
    for (const [specified, computed, epsilon] of rows(text)) {
      test(specified, () => expectComputed(specified, computed, epsilon === undefined ? 0.01 : Number(epsilon)));
    }
  });
});
