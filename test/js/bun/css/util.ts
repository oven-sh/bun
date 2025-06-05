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

export function minify_test(source: string, expected: string) {
  test(source, () => {
    expect(minifyTestWithOptions(source, expected)).toEqual(expected);
  });
}

export function prefix_test(source: string, expected: string, targets: Browsers, skip?: boolean) {
  const testf = skip ? test.skip : test;
  testf(source, () => {
    expect(prefixTest(source, expected, targets)).toEqualIgnoringWhitespace(expected);
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
