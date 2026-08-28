import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The lexer accepts every identifier character the current spec allows
// (Unicode 16 `ID_Start` / `ID_Continue`). The printer only drops the quotes
// around a property name when the name is also valid in ES5, so the output
// stays parseable on engines with an older Unicode database.

const transpiler = new Bun.Transpiler({ loader: "js" });
const minifier = new Bun.Transpiler({ loader: "js", minify: { syntax: true } });

function transform(code: string, t = transpiler) {
  return t.transformSync(code).trim();
}

function expectParseError(code: string, message: string) {
  let thrown: unknown;
  try {
    transpiler.transformSync(code);
  } catch (e) {
    thrown = e;
  }
  if (thrown instanceof AggregateError) thrown = thrown.errors[0];
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(message);
}

// U+30FB and U+FF65 are `Other_ID_Continue` since Unicode 15.1.
const KATAKANA_MIDDLE_DOT = "\u30FB";
const HALFWIDTH_KATAKANA_MIDDLE_DOT = "\uFF65";

// New in Unicode 16.0.
const unicode16Start = [
  "\u{10EC2}", // ARABIC LETTER DAL WITH TWO DOTS VERTICALLY BELOW (Arabic Extended-C)
  "\u{1E5D0}", // OL ONAL LETTER O (Ol Onal)
  "\uA7CB", // LATIN CAPITAL LETTER RAMS HORN
  "\u{105C0}", // TODHRI LETTER A (Todhri)
];
const unicode16Continue = [
  "\u0897", // ARABIC PEPET (Mn)
  "\u{1E5EE}", // OL ONAL SIGN MU (Mn)
  "\u{1E5F1}", // OL ONAL DIGIT ONE (Nd)
];

describe("Unicode 15.1 Other_ID_Continue", () => {
  test("U+30FB and U+FF65 are identifier parts but not identifier starts", () => {
    for (const dot of [KATAKANA_MIDDLE_DOT, HALFWIDTH_KATAKANA_MIDDLE_DOT]) {
      expect(transform(`var y${dot} = 5; f(y${dot});`)).toBe(`var y${dot} = 5;\nf(y${dot});`);
      expect(transform(`let a${dot}b${dot} = 1;`)).toBe(`let a${dot}b${dot} = 1;`);
      expectParseError(`var ${dot}x = 1;`, 'Expected identifier but found "' + dot + '"');
    }
  });

  test("property keys and member access", () => {
    const dot = KATAKANA_MIDDLE_DOT;
    // The key is a valid identifier in the source. The printer quotes it, since
    // engines on Unicode 15.0 or older reject it as an identifier.
    expect(transform(`const o = { x${dot}: 0 }; f(o.x${dot});`)).toBe(`const o = { "x${dot}": 0 };\nf(o["x${dot}"]);`);
    expect(transform(`f(o?.x${dot}); o.x${dot}();`)).toBe(`f(o?.["x${dot}"]);\no["x${dot}"]();`);
    expect(transform(`class C { x${dot} = 1; get y${dot}() {} static z${dot}() {} }`)).toBe(
      `class C {\n  "x${dot}" = 1;\n  get "y${dot}"() {}\n  static "z${dot}"() {}\n}`,
    );
    expect(transform(`const { x${dot} } = o; const { y${dot}: z } = o;`)).toBe(
      `const { "x${dot}": x${dot} } = o;\nconst { "y${dot}": z } = o;`,
    );
  });

  test("shorthand properties with a default value", () => {
    const dot = KATAKANA_MIDDLE_DOT;
    // A quoted key cannot use the shorthand form, so the default is printed once after the value.
    expect(transform(`({ x${dot} = 1 } = o);`)).toBe(`({ "x${dot}": x${dot} = 1 } = o);`);
    expect(transform(`({ \u{10EC2} = 2, abc = 3 } = o);`)).toBe(`({ "\u{10EC2}": \u{10EC2} = 2, abc = 3 } = o);`);
    expect(transform(`const { x${dot} = 1 } = o;`)).toBe(`const { "x${dot}": x${dot} = 1 } = o;`);
    expect(transform(`function f({ x${dot} = 1 }) {}`)).toBe(`function f({ "x${dot}": x${dot} = 1 }) {}`);
    expect(transform(`const o2 = { x${dot} };`)).toBe(`const o2 = { "x${dot}": x${dot} };`);
  });

  test("runtime: JSC and the lexer agree", async () => {
    using dir = tempDir("unicode-15-1", {
      "c.js": `var y\uFF65 = 5; const o = { x\u30FB: 0 }; console.log(y\uFF65, o.x\u30FB, JSON.stringify(o));\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "c.js"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe('5 0 {"x\u30FB":0}\n');
    expect(exitCode).toBe(0);
  });
});

describe("Unicode 16 identifier characters", () => {
  test("ID_Start as a binding, a property key, and a member name", () => {
    for (const ch of unicode16Start) {
      expect(transform(`var ${ch} = 1; f(${ch});`)).toBe(`var ${ch} = 1;\nf(${ch});`);
      expect(transform(`var a${ch} = 1;`)).toBe(`var a${ch} = 1;`);
      expect(transform(`const o = { ${ch}: 1 }; f(o.${ch});`)).toBe(`const o = { "${ch}": 1 };\nf(o["${ch}"]);`);
    }
  });

  test("ID_Continue only as an identifier part", () => {
    for (const ch of unicode16Continue) {
      expect(transform(`var a${ch} = 1; f(a${ch});`)).toBe(`var a${ch} = 1;\nf(a${ch});`);
      expect(transform(`const o = { a${ch}: 1 }; f(o.a${ch});`)).toBe(`const o = { "a${ch}": 1 };\nf(o["a${ch}"]);`);
      expectParseError(`var ${ch} = 1;`, 'Expected identifier but found "' + ch + '"');
    }
  });

  test("runtime", async () => {
    using dir = tempDir("unicode-16", {
      "c16.js": `var \u{10EC2} = 1; const o = { \u{1E5D0}: 2 }; console.log(\u{10EC2}, o.\u{1E5D0});\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "c16.js"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1 2\n");
    expect(exitCode).toBe(0);
  });
});

describe("printer quoting", () => {
  test("names valid in both ES5 and ESNext are printed without quotes", () => {
    expect(transform(`const o = { código: 1, ø: 2, αβ: 3, 漢字: 4 }; f(o.código, o.ø, o.αβ, o.漢字);`, minifier)).toBe(
      `const o = { código: 1, ø: 2, αβ: 3, 漢字: 4 };\nf(o.código, o.ø, o.αβ, o.漢字);`,
    );
  });

  test("names valid only in newer Unicode versions stay quoted", () => {
    const dot = KATAKANA_MIDDLE_DOT;
    // Unicode 15.1 and Unicode 16 characters, plus U+2118 (ID_Start through
    // Other_ID_Start but not a letter in ES5).
    for (const name of [`x${dot}`, "a\u0897", "\u2118", "\u{10EC2}"]) {
      expect(transform(`const o = { ${name}: 1 }; f(o.${name});`, minifier)).toBe(
        `const o = { "${name}": 1 };\nf(o["${name}"]);`,
      );
    }
    // Quoted in the source: the quotes stay.
    for (const name of [`x${dot}`, "a\u0897", "\u2118"]) {
      expect(transform(`const o = { "${name}": 1 }; f(o["${name}"]);`, minifier)).toBe(
        `const o = { "${name}": 1 };\nf(o["${name}"]);`,
      );
    }
  });

  test("the output round-trips through the transpiler", () => {
    const dot = HALFWIDTH_KATAKANA_MIDDLE_DOT;
    const code = `var y${dot} = 5; const o = { x${dot}: 0, a\u0897: 1 }; console.log(y${dot}, o.x${dot}, o.a\u0897);`;
    const once = transform(code);
    expect(once).toBe(
      `var y${dot} = 5;\nconst o = { "x${dot}": 0, "a\u0897": 1 };\nconsole.log(y${dot}, o["x${dot}"], o["a\u0897"]);`,
    );
    expect(transform(once)).toBe(once);
    expect(transform(once, minifier)).toBe(once);
  });

  test("identifiers with escapes that resolve to new characters", () => {
    expect(transform(`var y\\u30FB = 1; var \\u{10EC2} = 2;`)).toBe(`var y\u30FB = 1;\nvar \u{10EC2} = 2;`);
  });
});
