import { describe, expect, test } from "bun:test";
import { cssInternals } from "bun:internal-for-testing";
import dedent from "./dedent";
const {
  minifyTestWithOptions,
  testWithOptions,
  _test,
  canonicalTest,
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
    } catch (err: any) {
      error_string = err.toString();
    }
    expect(error_string).toEqual(expectedError);
  });
}

export function minify_test(source: string, expected: string, browsers?: Browsers) {
  test(source, () => {
    const output = browsers ? minifyTest(source, expected, browsers) : minifyTestWithOptions(source, expected);
    expect(output).toEqual(expected);
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

export function cssTestTodo(source: string, expected: string, browsers?: Browsers) {
  test.todo(source, () => {
    expect(_test(source, expected, browsers)).toEqualIgnoringWhitespace(expected);
  });
}

/** Like `cssTest`, but compares byte for byte. `cssTest` ignores all whitespace, so it cannot see a lost or added blank. */
export function exact_test(source: string, expected: string, browsers?: Browsers) {
  test(source, () => {
    expect(_test(source, expected, browsers)).toBe(expected);
  });
}

/** The print that `bun pm diff` compares: not minified, each token list in its one canonical form. */
export function canonical_test(source: string, expected: string) {
  test(source, () => {
    expect(canonicalTest(source, expected)).toBe(expected);
  });
}

export function attrTest(source: string, expected: string, minify: boolean, targets?: Browsers) {
  return __attrTest(source, expected, minify, targets);
}

//
export function indoc(...args: Parameters<typeof dedent>) {
  return dedent(...args);
}

export { minifyTestWithOptions };
