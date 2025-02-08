import { describe } from "bun:test";
import { dedent, itBundled } from "./expectBundled";

interface TemplateStringTest {
  expr: string;
  print?: string | boolean; // expect stdout
  capture?: string | boolean; // expect literal transpilation
  captureRaw?: string; // expect raw transpilation
}

const templateStringTests: Record<string, TemplateStringTest> = {
  // note for writing tests: .print is .trim()'ed due to how run.stdout works
  Empty: { expr: '""', captureRaw: '""' },
  NullByte: { expr: '"hello\0"', captureRaw: '"hello\\x00"' },
  EmptyTemplate: { expr: "``", captureRaw: '""' },
  ConstantTemplate: { expr: "`asdf`", captureRaw: '"asdf"' },
  AddConstant: { expr: "`${7 + 6}`", capture: true },
  AddConstant2: { expr: "`${7 + 6 + 96}`", capture: true },
  AddConstant3: { expr: "`${0.1 + 0.2}`", print: true },
  SubtractConstant: { expr: "`${7 - 6}`", capture: true },
  SubtractConstant2: { expr: "`${7 - 6 - 10}`", capture: true },
  MultiplyConstant: { expr: "`${7 * 6}`", capture: true },
  MultiplyConstant2: { expr: "`${7 * 6 * 2}`", capture: true },
  MultiplyConstant3: { expr: "`${7.5 * 6.02}`", print: true },
  DivideConstant: { expr: "`${7 / 6}`", print: true },
  DivideConstant2: { expr: "`${7 / 6 / 2}`", print: true },
  DivideConstant3: { expr: "`${7.5 / 6.02}`", print: true },
  Exponent1: { expr: "`${1e0}`", capture: true },
  Exponent2: { expr: "`${1e1}`", capture: true },
  Exponent3: { expr: "`${0e1337}`", capture: true },
  Exponent4: { expr: "`${-1e0}`", capture: true },
  BigExponent1: { expr: "`${1e20}`", print: "100000000000000000000" },
  BigExponent2: { expr: "`${1e21}`", print: "1e+21" },
  BigNumber1: { expr: "`${999999999999999934463.9999999}`", print: "999999999999999900000" },
  BigNumber2: { expr: "`${999999999999999934464.0000000}`", print: "1e+21" },
  True: { expr: "`${true}`", capture: true },
  False: { expr: "`${false}`", capture: true },
  BigInt: { expr: "`${1n}`", print: "1" },
  LongBigInt: {
    expr: "`${-" + "1234".repeat(1000) + "n}`",
    print: "-" + "1234".repeat(1000),
  },
  BigIntAdd: { expr: "`${1n + 2n}`", print: "3" },
  BigIntSubtract: { expr: "`${1n - 2n}`", print: "-1" },
  BigIntMultiply: { expr: "`${2n * 3n}`", print: "6" },
  BigIntDivide: { expr: "`${6n / 2n}`", print: "3" },
  BigIntModulo: { expr: "`${6n % 4n}`", print: "2" },
  BigIntExponent: { expr: "`${2n ** 3n}`", print: "8" },
  ArrowFunction: { expr: "`${() => 123}`", captureRaw: "`${()=>123}`" },
  Function: { expr: "`${function() { return 123; }}`", captureRaw: "`${function(){return 123}}`" },
  Identifier: { expr: "`${ident}`", captureRaw: "`${ident}`" },
  IdentifierAdd: { expr: "`${ident + ident}`", captureRaw: "`${ident+ident}`" },
  IdentifierConstAdd: { expr: "`${2 + ident}`", captureRaw: "`${2+ident}`" },
  EscapeIssue1: {
    expr: `\`\\abc\${ident}\``,
    captureRaw: `\`abc\${ident}\``,
  },
  EscapeIssue2: {
    expr: `\`\\abc\${ident}\``,
    captureRaw: `\`abc\${ident}\``,
  },
  TernaryWithEscapeVariable: {
    expr: '`${"1"}\\${${VARIABLE ? "SOMETHING" : ""}`',
    captureRaw: '`1\\${${VARIABLE?"SOMETHING":""}`',
  },
  TernaryWithEscapeTrue: {
    expr: '`${"1"}\\${${true ? "SOMETHING" : ""}`',
    captureRaw: '"1${SOMETHING"',
  },
  TernaryWithEscapeFalse: {
    expr: '`${"1"}\\${${false ? "SOMETHING" : ""}`',
    captureRaw: '"1${"',
  },
  Fold: { expr: "`a${'b'}c${'d'}e`", capture: true },
  FoldNested1: { expr: "`a${`b`}c${`${'d'}`}e`", capture: true },
  FoldNested2: { expr: "`a${`b`}c${`1${'d'}`}e`", capture: true },
  FoldNested3: { expr: "`a${`b`}c${`${'1'}${'d'}`}e`", capture: true },
  FoldNested4: { expr: "`a${`b`}c${`${`${`${'d'}`}`}`}e`", capture: true },
  FoldNested5: { expr: "`\\$${`d`}`", print: true }, // could be captured
  FoldNested6: { expr: "`a\0${5}c\\${{$${`d`}e`", print: true },
  EscapedDollar: { expr: "`\\${'a'}`", captureRaw: "\"${'a'}\"" },
  EscapedDollar2: { expr: "`\\${'a'}\\${'b'}`", captureRaw: "\"${'a'}${'b'}\"" },
  StringAddition: { expr: "`${1}\u2796` + 'rest'", capture: true },
  StringAddition2: { expr: "`\u2796${1}` + `a${Number(1)}b`", print: true },
  StringAddition3: { expr: '`0${"\u2796"}` + `a${Number(1)}b`', print: true },
  StringAddition4: { expr: "`${1}z` + `\u2796${Number(1)}rest`", print: true },
  StringAddition5: { expr: "`\u2796${1}z` + `\u2796${Number(1)}rest`", print: true },
  StringAddition6: { expr: "`${1}` + '\u2796rest'", capture: true },
  StringAddition7: { expr: "`\\x7f` + '!'", capture: true },
  StringAddition8: { expr: "'\\uD800' + '\\uDF34'", capture: true },
  StringAddition9: { expr: "JSON.stringify('\\uDF34' + '\\uD800')", print: true },
  StringAddition10: { expr: "JSON.stringify('\\uDF34')", print: true },
  StringAddition11: { expr: "'æ' + '™' + '\\uD800' + '\\uDF34'", capture: true },
  CharCodeAt1: { expr: '"a".charCodeAt(0)', captureRaw: "97" },
  CharCodeAt2: { expr: '"ab".charCodeAt(0)', capture: true },
  CharCodeAt3: { expr: '"ab".charCodeAt(1)', capture: true },
  CharCodeAt4: { expr: '"" + ("a" + "b").charCodeAt(1)', print: true },
  CharCodeAt5: { expr: '"" + "æ™".charCodeAt(0)', print: true },
  CharCodeAt6: { expr: '"" + "æ™".charCodeAt(1)', print: true },
  CharCodeAt7: { expr: '"" + "æ™".charCodeAt(2)', print: true },
  CharCodeAt8: { expr: '"" + "æ™".charCodeAt(0.6)', print: true },
  ArrayIndex1: { expr: '"" + "abc"[0]', capture: true },
  ArrayIndex2: { expr: '"" + "abc"[1]', capture: true },
  ArrayIndex3: { expr: '"" + "abc"[2]', capture: true },
  ArrayIndex4: { expr: '"" + "abc"[4]', print: true },
  ArrayIndex5: { expr: '"" + "æ™"[0]', print: true },
  ArrayIndex6: { expr: '"" + "æ™"[1]', print: true },
  ArrayIndex7: { expr: '"" + "æ™"[2]', print: true },
  ArrayIndex8: { expr: '"" + JSON.stringify("\u{10334}"[0])', print: true },
  ArrayIndex9: { expr: '"" + JSON.stringify("\u{10334}"[1])', print: true },
  ArrayIndex10: { expr: '"" + "\u{10334}"[2]', print: true },
  ArrayIndex11: { expr: '"" + ("a" + "b")[0]', capture: true },
  ArrayIndex12: { expr: '"" + ("a" + "b")[1]', capture: true },
  ArrayIndex13: { expr: '"" + ("a" + "b")[2]', print: true },
  Eql1: { expr: '"" + ("a" === "b")', capture: true },
  Eql2: { expr: '"" + ("a" === "a")', capture: true },
  Eql3: { expr: '"" + (("a" + "a") === "aa")', capture: true },
  Eql4: { expr: '"" + (("a" + "b") === "aa")', capture: true },
  Eql5: { expr: '"" + (("0" + "1") == 0)', print: true },
  Eql6: { expr: '"" + ("\\uD800\\uDF34" === "\\u{10334}")', capture: true },
  Eql7: { expr: '"" + ("ab\\uD800\\uDF34cd" === "ab\\u{10334}cd")', capture: true },
  Eql8: { expr: '"" + (("\\uD800" + "\\uDF34") === "\\u{10334}")', print: true },
  FoldLength1: { expr: '"" + "abc".length', capture: true },
  FoldLength2: { expr: '"" + "a\\uD800c".length', capture: true },
  FoldLength2_: { expr: '"" + "a\uD800c".length', capture: true },
  FoldLength3: { expr: '"" + "a\\uD800\\uDF34c".length', capture: true },
  FoldLength3_: { expr: '"" + "a\uD800\uDF34c".length', capture: true },
  FoldLength4: { expr: '"" + "a\\u{10334}c".length', capture: true },
  FoldLength4_: { expr: '"" + "a\u{10334}c".length', capture: true },
  FoldLength5: { expr: '"" + "a\\uDF34\\uD800c".length', capture: true },
  FoldLength5_: { expr: '"" + "a\uDF34\uD800c".length', capture: true },
  FoldLength6: { expr: '"" + "â€™".length', capture: true },
  FoldLength7: { expr: '"" + ("\\n" + "\x00").length', capture: true },
  FoldLength8: { expr: '"" + ("æ" + "™").length', capture: true },
  FoldLength9: { expr: '"" + ("\\uD800" + "\\uDF34").length', capture: true },
  EscapeSequences: { expr: '"\\\'\\"\\\\\\b\\f\\n\\r\\t\\v"', print: true },
};

describe("bundler", () => {
  for (const key in templateStringTests) {
    const test = templateStringTests[key];
    if ([test.capture, test.captureRaw, test.print].filter(x => x !== undefined).length !== 1) {
      throw new Error(`Exactly one of capture or print must be defined for 'template/${key}'`);
    }
    let captureRaw = test.captureRaw;
    if (test.capture === true) captureRaw = JSON.stringify(eval(test.expr)) as string;
    else if (test.capture !== undefined) captureRaw = JSON.stringify(test.capture);
    if (test.print === true) test.print = eval(test.expr) as string;

    itBundled(
      `string/${key}`,
      captureRaw !== undefined
        ? {
            files: {
              "index.ts": dedent`
                capture(${test.expr});
              `,
            },
            capture: [captureRaw],
            minifySyntax: true,
            minifyWhitespace: true,
          }
        : {
            files: {
              "index.ts": dedent`
                const capture = x => x;
                console.log(capture(${test.expr}));
              `,
            },
            run: {
              stdout: test.print as string,
            },
            minifySyntax: true,
            minifyWhitespace: true,
            onAfterBundle(api) {
              const capture = api.captureFile("out.js");
              if (capture[0] === JSON.stringify(test.print)) {
                // this is to tell the dev to change the test to use .capture
                // as that is a more strict test (checking literal output)
                // and if the test passes with this, we should be testing for that.
                throw new Error(
                  `Test 'string/${key}': Passes capture test when the test only defines print. Rename .print to .capture on the test to fix this.`,
                );
              }
            },
          },
    );
  }

  itBundled("string/TemplateFolding", {
    files: {
      "entry.js": /* js */ `
        const s1 = "hello";
        \`\${s1} world\`;
        console.log(s1);

        const s2 = \`hello\`;
        console.log(s2);
        const s3 = \`\${s2} world \${s1}\`;
        console.log(s3);

        const s4 = \`\${s1}\${s2}\${s3}\`;
        console.log(s4);

        const s5 = \`👋🌎\`;
        console.log(s5);
        const s6 = \`\${s5} 🌍 \${s1}\`;
        console.log(s6);

        const s7 = \`\${s1}\${s2}\${s3}\${s4}\${s5}\${s6}\`;
        console.log(s7);

        const hexCharacters = "a-f\\d";
        console.log(hexCharacters);
        const match3or4Hex = \`#?[\${hexCharacters}]{3}[\${hexCharacters}]?\`;
        console.log(match3or4Hex);
        const match6or8Hex = \`#?[\${hexCharacters}]{6}([\${hexCharacters}]{2})?\`;
        console.log(match6or8Hex);
        const nonHexChars = new RegExp(\`[^#\${hexCharacters}]\`, "gi");
        console.log(nonHexChars);
        const validHexSize = new RegExp(\`^\${match3or4Hex}\$|^\${match6or8Hex}$\`, "i");
        console.log(validHexSize);

        const INTERNAL = "OOPS";

        function foo() {
          return "NAME";
        }

        console.log(\`k\${foo()}=\${INTERNAL}j\`);
        console.log("d" + INTERNAL);
        console.log(INTERNAL + "l");
        console.log("d" + INTERNAL + "l");

        const CONST_VALUE = "CONST_VALUE";

        function blaBla(a) {
          const { propertyName } = a;
          const condition = \`\${propertyName}.\${CONST_VALUE}AA.WHAT\`;
          return condition;
        }

        console.log(CONST_VALUE);
        console.log(CONST_VALUE === "CONST_VALUE");
      `,
    },
    bundling: false,
    run: {
      stdout: `hello
      hello
      hello world hello
      hellohellohello world hello
      👋🌎
      👋🌎 🌍 hello
      hellohellohello world hellohellohellohello world hello👋🌎👋🌎 🌍 hello
      a-f\d
      #?[a-f\d]{3}[a-f\d]?
      #?[a-f\d]{6}([a-f\d]{2})?
      /[^#a-f\d]/gi
      /^#?[a-f\d]{3}[a-f\d]?$|^#?[a-f\d]{6}([a-f\d]{2})?$/i
      kNAME=OOPSj
      dOOPS
      OOPSl
      dOOPSl
      CONST_VALUE
      true`,
    },
  });
});
