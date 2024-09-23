import { cssInternals } from "bun:internal-for-testing";
import dedent from "./dedent";
const { minifyTestWithOptions, testWithOptions, prefixTestWithOptions } = cssInternals;

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
  return minifyTestWithOptions(source, expected);
}

export function prefix_test(source: string, expected: string, targets: Browsers) {
  return prefixTestWithOptions(source, expected, targets);
}
export function prefixTest(source: string, expected: string, targets: Browsers) {
  return minifyTestWithOptions(source, expected);
}

export function css_test(source: string, expected: string) {
  return cssTest(source, expected);
}
export function cssTest(source: string, expected: string) {
  return testWithOptions(source, expected);
}

//
export function indoc(...args: any) {
  return dedent(...args);
}

export { minifyTestWithOptions };
