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
    } catch (err: any) {
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

// A number that stands alone. A digit in a name, in a hex color or in a dimension is not one.
const standaloneNumber = /(?<![\w#.-])-?(?:\d+\.?\d*|\.\d+)(?![\w.])/g;

/**
 * Returns `received` with each number that is close to the number at the same place in `expected`
 * replaced by that number. A converted color goes through the math library of the platform, so
 * its last digit is not the same on every platform (`lab(94.0295% ...)` on Linux is
 * `lab(94.0296% ...)` on Windows). The printer writes six significant digits, and close is a
 * difference of 1.5 units of the sixth digit at most.
 */
export function snapNumbers(received: string, expected: string): string {
  const wanted = expected.match(standaloneNumber) ?? [];
  let index = 0;
  return received.replace(standaloneNumber, found => {
    const want = wanted[index++];
    if (want === undefined) return found;
    const sixthDigit = 10 ** (Math.floor(Math.log10(Math.abs(+want))) - 5);
    return Math.abs(+found - +want) <= 1.5 * sixthDigit ? want : found;
  });
}

/**
 * Like `minify_test`, with browser targets, so that fallbacks are in the output. A fallback is a
 * converted color, so the numbers go through `snapNumbers`.
 */
export function minify_test_with_targets(source: string, expected: string, targets: Browsers) {
  test(source, () => {
    expect(snapNumbers(minifyTest(source, expected, targets), expected)).toEqual(expected);
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

export function attrTest(source: string, expected: string, minify: boolean, targets?: Browsers) {
  return __attrTest(source, expected, minify, targets);
}

//
export function indoc(...args: Parameters<typeof dedent>) {
  return dedent(...args);
}

export { minifyTestWithOptions };
