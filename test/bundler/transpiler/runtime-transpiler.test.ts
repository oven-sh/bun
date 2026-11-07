import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

test("use strict causes CommonJS", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), require.resolve("./use-strict-fixture.js")],
    env: bunEnv,
  });
  expect(stdout.toString()).toBe("function\n");
  expect(exitCode).toBe(0);
});

test("non-ascii regexp literals", () => {
  var str = "🔴11 54 / 10,000";
  expect(str.replace(/[🔵🔴,]+/g, "")).toBe("11 54 / 10000");
});

test("ascii regex with escapes", () => {
  expect(/^[-#!$@£%^&*()_+|~=`{}\[\]:";'<>?,.\/ ]$/).toBeInstanceOf(RegExp);
});

describe("a regexp literal", () => {
  test("with a backslash ahead of a non-ASCII character matches that character", () => {
    expect(/\é/.test("é")).toBe(true);
    expect(/^a\日b$/.test("a日b")).toBe(true);
    expect(/^\😀$/.test("😀")).toBe(true);
    expect(/^[\é]$/.test("é")).toBe(true);
    expect(/^[a-z\é]+$/.test("café")).toBe(true);
    expect(/^[a-z\é]+$/.test("a09")).toBe(false);
    expect("xéy".replace(/\é/g, "-")).toBe("x-y");
    expect(/^\\é$/.test("\\é")).toBe(true);
    expect(/^\\\é$/.test("\\é")).toBe(true);
    const fraction = /([⁰¹²³⁴⁵⁶⁷⁸⁹]+|[0-9]+)([\/\⁄])([₀₁₂₃₄₅₆₇₈₉]+|[0-9]+)/;
    expect(Array.from("³⁄₅₂ cup of stuff".match(fraction) ?? [])).toEqual(["³⁄₅₂", "³", "⁄", "₅₂"]);
  });

  const forBun = new Bun.Transpiler({ target: "bun" });
  // What the engine makes of a literal: its name for the error, or what it finds in each subject.
  const read = (assignment: string, subjects: string[]) => {
    let regexp: RegExp;
    try {
      regexp = new Function("let x;\n" + assignment + "\nreturn x;")();
    } catch (error) {
      return (error as Error).name;
    }
    return JSON.stringify(subjects.map(subject => regexp.exec(subject)).map(match => match && [match.index, ...match]));
  };

  // What Node finds.
  test.each([
    ["a backslash ahead of a tab", "/a\\\tb/", "a\tb", [0, "a\tb"]],
    ["a backslash ahead of U+007F in a class", "/[\\\x7F]/", "a\x7F", [1, "\x7F"]],
    ["a backslash ahead of U+0000", "/a\\\0/", "a\0", [0, "a\0"]],
    ["U+0000 in a class with the v flag", "/[\0]/v", "a\0", [1, "\0"]],
    ["a backslash ahead of U+00E9 behind \\k<, and no named group", "/\\k<\\\u00E9>/", "k<\u00E9>", [0, "k<\u00E9>"]],
  ])("with %s finds what it finds in Node", (_, literal, subject, found) => {
    expect(read(forBun.transformSync("x = " + literal + ";"), [subject])).toBe(JSON.stringify([found]));
  });

  test("is printed for Bun with an escape for each character that is not printable ASCII", () => {
    // [the literal, what is printed for Bun]
    const rows = [
      ["/\u0080\\\u0080\\\\\u0080/", "/\\u0080\\u0080\\\\\\u0080/"],
      ["/\uFFFF\\\uFFFF/", "/\\uFFFF\\uFFFF/"],
      ["/\u{10000}\\\u{10000}/u", "/\\uD800\\uDC00\\uD800\\uDC00/u"],
      ["/\u{10FFFF}\\\\\\\u{10FFFF}/", "/\\uDBFF\\uDFFF\\\\\\uDBFF\\uDFFF/"],
      ["/\u00E9\x7F\t\0\\\t~ /", "/\\u00E9\\u007F\\u0009\\u0000\\u0009~ /"],
    ];
    for (const target of ["browser", "node"] as const) {
      const transpiler = new Bun.Transpiler({ target });
      expect(rows.map(([literal]) => transpiler.transformSync("x = " + literal + ";"))).toEqual(
        rows.map(([literal]) => "x = " + literal + ";\n"),
      );
    }
    expect(rows.map(([literal]) => forBun.transformSync("x = " + literal + ";"))).toEqual(
      rows.map(([, printed]) => "x = " + printed + ";\n"),
    );
  });

  // Each pattern is given to the engine twice: as it is written, and as it is printed for Bun. The engine must
  // refuse both, or find the same with both. `X` stands for the character. V8 reads each of them as the engine does.
  test("is read by the engine as it is written, whatever stands ahead of a non-ASCII character", () => {
    const places = [
      ...["\\X", "X", "a\\Xb", "\\\\X", "\\\\\\X", "\\\\\\\\X", "\\X\\X", "X\\X", "\\XX"],
      ...["^\\X+$", "^\\X{2}$", "\\X*?", "\\b\\X", "\\d\\X", "\t\\X", "\\\t\\X", "\\\x7F\\X"],
      ...["[\\X]", "[^\\X]", "[a\\X]", "[a-\\X]", "[\\X-]", "[\\X-\\\u{10FFFF}]", "[\\X\\X]", "[\\]\\X]", "[/]\\X"],
      ...["(\\X)", "(?:\\X)", "(?=\\X)", "(?<=\\X)a", "(?<!\\X)a", "(?i:\\X)", "a|\\X", "a{1,\\X}", "\\/\\X"],
      ...["(?<a>\\X)", "(?<n>a)\\k<n>\\X", "(?<n>\\X)\\k<n>", "\\k<a \\X>", "\\k<a|\\X", "\\k<1\\X>", "\\\\k<\\X>"],
      ...["[\\k<\\X>]", "\\(?<\\X>", "[(?<\\X>]", "\\c\\X", "\\cX", "\\x\\X", "\\u\\X", "\\u00\\X", "\\u{\\X}"],
      ...["\\p{\\X}", "\\0\\X", "(a)\\1\\X"],
    ];
    // With `u` or `v`, ECMAScript refuses a backslash ahead of the character: these have none.
    const literals = [...places.map(place => "/" + place + "/"), "/X/u", "/^[X]+$/u", "/[^X]/v", "/(?<n>X)\\k<n>/u"];
    const characters = ["\u0080", "\u00E9", "\u65E5", "\uFFFF", "\u{10000}", "\u{1F600}"];
    const readAnotherWay: string[] = [];
    for (const X of characters) {
      const subjects = [
        ...["", "a", "u", "\\", "X", "XX", "\\X", "aX", "aXb", "aaX", "k<X>", "k<nX>", "k<a X>", "k<a|X", "k<1X>"],
        ...["\\k<X>", "(?<X>", "cX", "\\cX", "xX", "uX", "u00X", "u{X}", "p{X}", "\0X", "\tX", "\x7FX", "/X", "]X"],
        ...["a{1,X}", "dX", "0X", "\u{10FFFF}"],
      ].map(subject => subject.replaceAll("X", X));
      // The text of the escapes, with and without a backslash ahead, and each UTF-16 code unit alone.
      const units = X.split("");
      const escapes = units
        .map(unit => "\\u" + unit.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"))
        .join("");
      subjects.push(escapes, "\\" + escapes, escapes.slice(1), ...units);
      for (const literal of literals) {
        const written = "x = " + literal.replaceAll("X", X) + ";";
        if (read(forBun.transformSync(written), subjects) !== read(written, subjects)) {
          readAnotherWay.push(literal + " U+" + X.codePointAt(0)!.toString(16).toUpperCase());
        }
      }
    }
    expect(readAnotherWay).toEqual([]);
  });
});

describe("// @bun", () => {
  beforeEach(() => {
    delete require.cache[require.resolve("./async-transpiler-entry")];
    delete require.cache[require.resolve("./async-transpiler-imported")];
  });

  test("async transpiler", async () => {
    const { default: value, hbs } = await import("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("require()", async () => {
    const { default: value, hbs } = require("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("synchronous", async () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./async-transpiler-imported")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });
    expect(stdout.toString()).toBe("Hello world!\n");
    expect(exitCode).toBe(0);
  });
});

describe("json imports", () => {
  test("require(*.json)", async () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      default: defaultExport,
      ...other
    } = require("./runtime-transpiler-json-fixture.json");
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
      default: { a: 1 },
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
      default: { a: 1 },
    }).toEqual(obj);
    expect(other).toEqual({});

    // This tests that importing and requiring when already in the cache keeps the state the same
    {
      const {
        name,
        description,
        players,
        version,
        creator,
        default: defaultExport,
        // @ts-ignore
      } = await import("./runtime-transpiler-json-fixture.json");
      const obj = {
        "name": "Spiral 4v4 NS",
        "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
        "version": "1.0",
        "creator": "Grand Homie",
        "players": [8, 8],
        default: { a: 1 },
      };
      expect({
        name,
        description,
        players,
        version,
        creator,
        default: { a: 1 },
      }).toEqual(obj);
      // They should be strictly equal
      expect(defaultExport.players).toBe(players);
      expect(defaultExport).toEqual(obj);
    }

    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
  });

  test("import(*.json)", async () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      default: defaultExport,
      // @ts-ignore
    } = await import("./runtime-transpiler-json-fixture.json");
    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
      default: { a: 1 },
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
      default: { a: 1 },
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.players).toBe(players);
    expect(defaultExport).toEqual(obj);
  });

  test("should support comments in tsconfig.json", async () => {
    // @ts-ignore
    const { buildOptions, default: defaultExport } = await import("./tsconfig.with-commas.json");
    delete require.cache[require.resolve("./tsconfig.with-commas.json")];
    const obj = {
      "buildOptions": {
        "outDir": "dist",
        "baseUrl": ".",
        "paths": {
          "src/*": ["src/*"],
        },
      },
    };
    expect({
      buildOptions,
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.buildOptions).toBe(buildOptions);
    expect(defaultExport).toEqual(obj);
  });

  test("should handle non-boecjts in tsconfig.json", async () => {
    // @ts-ignore
    const { default: num } = await import("./tsconfig.is-just-a-number.json");
    delete require.cache[require.resolve("./tsconfig.is-just-a-number.json")];
    expect(num).toBe(1);
  });

  test("should handle duplicate keys", async () => {
    // @ts-ignore
    expect((await import("./runtime-transpiler-fixture-duplicate-keys.json")).a).toBe("4");
  });
});

describe("with statement", () => {
  test("works", () => {
    const { exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./with-statement-works.js")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
    });

    expect(exitCode).toBe(0);
  });
});

test("math.pow", () => {
  function foo1(foo) {
    return 10 ** (foo / 20);
  }

  function foo2(foo) {
    return foo ** -0.5;
  }

  expect(foo1(-1) + "").toEqual("0.8912509381337456");
  expect(10 ** (-1 / 20) + "").toEqual("0.8912509381337456");
  expect(foo2(20.4) + "").toEqual("0.22140372138502384");
  expect(20.4 ** -0.5 + "").toEqual("0.22140372138502384");
});

describe("unterminated string literals in large files", () => {
  test("reports an unterminated string literal at the end of a large JavaScript file", async () => {
    using dir = tempDir("transpiler-long-unterminated-js", {
      "index.js": `var s = "${Buffer.alloc(1 << 20, "a").toString()}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("Unterminated string literal");
    expect(exitCode).toBe(1);
  });

  test("reports an unterminated string literal at the end of a large JSON file", async () => {
    using dir = tempDir("transpiler-long-unterminated-json", {
      "tsconfig.big.json": `{"name": "${Buffer.alloc(1 << 20, "a").toString()}`,
      "index.js": `require("./tsconfig.big.json");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("Unterminated string literal");
    expect(exitCode).toBe(1);
  });
});

// 2 GiB through the printer takes over 30 seconds on a debug or ASAN build.
test.skipIf(isDebug || isASAN)(
  "printing more than 2 GiB of modules in one process keeps the space after a keyword",
  async () => {
    using dir = tempDir("transpiler-printer-position", {
      "big.cjs": `module.exports = "${Buffer.alloc(1 << 20, "a").toString()}";`,
      "probe.cjs": `module.exports = function named() { return typeof named; };`,
      "index.cjs": `
        const big = require.resolve("./big.cjs");
        for (let i = 0; i < 2100; i++) {
          delete require.cache[big];
          module.children.length = 0;
          require(big);
          if (i % 50 === 0) Bun.gc(true);
        }
        console.log(require("./probe.cjs")());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("function\n");
    expect(exitCode).toBe(0);
  },
);
