import { describe, expect, test } from "bun:test";
import { cssInternals } from "bun:internal-for-testing";
import dedent from "./dedent";
const { minifyTestWithOptions, testWithOptions, prefixTestWithOptions, attrTest: __attrTest } = cssInternals;

type Browsers = {
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

export function minify_test(source: string, expected: string) {
  return minifyTest(source, expected);
}
export function minifyTest(source: string, expected: string) {
  test(source, () => {
    expect(minifyTestWithOptions(source, expected)).toEqual(expected);
  });
}

export function prefix_test(source: string, expected: string, targets: Browsers) {
  test(source, () => {
    expect(prefixTestWithOptions(source, expected, targets)).toEqualIgnoringWhitespace(expected);
  });
}

export function css_test(source: string, expected: string) {
  return cssTest(source, expected);
}
export function cssTest(source: string, expected: string) {
  test(source, () => {
    expect(testWithOptions(source, expected)).toEqualIgnoringWhitespace(expected);
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
