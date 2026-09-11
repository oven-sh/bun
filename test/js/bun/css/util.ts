import { describe, expect, test } from "bun:test";
import { cssInternals } from "bun:internal-for-testing";
import dedent from "./dedent";
const {
  minifyTestWithOptions,
  testWithOptions,
  _test,
  prefixTestWithOptions,
  prefixTest,
  minifyTest,
  attrTest: __attrTest,
  minifyErrorTestWithOptions: __minifyErrorTestWithOptions,
} = cssInternals;

export type Browsers = {
  android?: number;
  chrome?: number;
  edge?: number;
  firefox?: number;
  ie?: number;
  ios_saf?: number;
  opera?: number;
  safari?: number;
  samsung?: number;
};

export type ParserOptions = {
  css_modules?: {
    pure: boolean;
  };
  flags?: ParserFlags[];
};

export enum ParserFlags {
  DEEP_SELECTOR_COMBINATOR = "DEEP_SELECTOR_COMBINATOR",
}

export function minify_error_test_with_options(source: string, expectedError: string, options: ParserOptions) {
  test.skip(source, () => {
    let error_string: string | undefined = undefined;
    try {
      __minifyErrorTestWithOptions(source, expectedError, options);
    } catch (err) {
      error_string = err.toString();
    }
    expect(error_string).toEqual(expectedError);
  });
}

// Every declaration block in a stylesheet goes through the same property handler instances, so state a
// handler does not reset between blocks makes a block's output depend on the rules before it. Each test
// below is therefore also run behind this rule, which leaves the handlers that keep per-block state
// (logical vs. physical tracking, vendor prefix tracking, and the separate `!important` handlers) in
// their non-default state, and is itself dropped from the output. The output must not change.
const precedingRule = (() => {
  const declarations = [
    "margin-inline-start:1px",
    "padding-inline-start:1px",
    "inset-inline-start:1px",
    "scroll-margin-inline-start:1px",
    "scroll-padding-inline-start:1px",
    "border-inline-start-color:red",
    "border-start-start-radius:1px",
    "inline-size:1px",
    "background-image:-webkit-linear-gradient(red,blue)",
  ];
  return `@media not all{z{${[...declarations, ...declarations.map(d => d + "!important")].join(";")}}}`;
})();

function expectUnaffectedByPrecedingRule(run: (source: string) => string, source: string, output: string) {
  // These at-rules are only valid before any other rule.
  if (/@(?:charset|import|namespace)\b/.test(source)) return;
  expect(run(precedingRule + source)).toBe(output);
}

export function minify_test(source: string, expected: string) {
  test(source, () => {
    const output = minifyTestWithOptions(source, expected);
    expect(output).toEqual(expected);
    expectUnaffectedByPrecedingRule(source => minifyTestWithOptions(source, expected), source, output);
  });
}

export function prefix_test(source: string, expected: string, targets: Browsers, skip?: boolean) {
  const testf = skip ? test.skip : test;
  testf(source, () => {
    const output = prefixTest(source, expected, targets);
    expect(output).toEqualIgnoringWhitespace(expected);
    expectUnaffectedByPrecedingRule(source => prefixTest(source, expected, targets), source, output);
  });
}

export function css_test(source: string, expected: string, browsers?: Browsers) {
  return cssTest(source, expected, browsers);
}
export function cssTest(source: string, expected: string, browsers?: Browsers, skip?: boolean) {
  const testf = skip ? test.skip : test;
  testf(source, () => {
    const output = _test(source, expected, browsers);
    console.log("Output", output);
    expect(output).toEqualIgnoringWhitespace(expected);
    expectUnaffectedByPrecedingRule(source => _test(source, expected, browsers), source, output);
  });
}

export function attrTest(source: string, expected: string, minify: boolean, targets?: Browsers) {
  return __attrTest(source, expected, minify, targets);
}

//
export function indoc(...args: any) {
  return dedent(...args);
}

export { minifyTestWithOptions };
