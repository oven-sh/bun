import assert from "assert";
import dedent from "dedent";
import { itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

interface TemplateStringTest {
  expr: string;
  print?: string | boolean; // expect stdout
  capture?: string | boolean; // expect literal transpilation
  captureRaw?: string; // expect raw transpilation
}

const templateStringTests: Record<string, TemplateStringTest> = {
  // note for writing tests: .print is .trim()'ed due to how run.stdout works
  Empty: { expr: '""', captureRaw: '""' },
  NullByte: { expr: '"hello\0"', captureRaw: '"hello\0"' },
  EmptyTemplate: { expr: "``", captureRaw: "``" },
  ConstantTemplate: { expr: "`asdf`", captureRaw: "`asdf`" },
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
  ArrowFunction: { expr: "`${() => 123}`", captureRaw: "`${(" }, // capture is weird in this scenario
  Function: { expr: "`${function() { return 123; }}`", captureRaw: "`${function(" },
  Identifier: { expr: "`${ident}`", captureRaw: "`${ident}`" },
  IdentifierAdd: { expr: "`${ident + ident}`", captureRaw: "`${ident+ident}`" },
  IdentifierConstAdd: { expr: "`${2 + ident}`", captureRaw: "`${ident+ident}`" },
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
    captureRaw: '`${"1"}\\${${VARIABLE ? "SOMETHING" : ""}`',
  },
  TernaryWithEscapeTrue: {
    expr: '`${"1"}\\${${true ? "SOMETHING" : ""}`',
    captureRaw: '`${"1"}\\${${"SOMETHING"}`',
  },
  TernaryWithEscapeFalse: {
    expr: '`${"1"}\\${${false ? "SOMETHING" : ""}`',
    captureRaw: '`${"1"}\\${${""}`',
  },
  Fold: { expr: "`a${'b'}c${'d'}e`", capture: true },
  FoldNested1: { expr: "`a${`b`}c${`${'d'}`}e`", capture: true },
  FoldNested2: { expr: "`a${`b`}c${`1${'d'}`}e`", capture: true },
  FoldNested3: { expr: "`a${`b`}c${`${'1'}${'d'}`}e`", capture: true },
  FoldNested4: { expr: "`a${`b`}c${`${`${`${'d'}`}`}`}e`", capture: true },
  FoldNested5: { expr: "`\\$${`d`}`", print: true }, // could be captured
  FoldNested6: { expr: "`a\0${5}c\\${{$${`d`}e`", capture: true },
  EscapedDollar: { expr: "`\\${'a'}`", captureRaw: "`\\${'a'}`" },
  EscapedDollar2: { expr: "`\\${'a'}\\${'b'}`", captureRaw: "`\\${'a'}\\${'b'}`" },
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
});
