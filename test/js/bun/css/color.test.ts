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

  // `hsl(0, 1, 0.5)` is near-black as CSS: saturation and lightness must be
  // percentages. Bun cannot parse its own hsl output back.
  test.failing("hsl round-trips", () => {
    expect(color(color("red", "hsl") as string, "hex")).toBe("#ff0000");
  });

  // `lab()` takes L in 0..100 and is space-separated, so `lab(0.54, 80.8, 69.9)`
  // is neither the right lightness nor valid syntax.
  test.failing("lab round-trips", () => {
    expect(color(color("red", "lab") as string, "hex")).toBe("#ff0000");
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
});
