// @ts-check

// Types for custom matchers for "expect-extend.test.js"

interface CustomMatchersForTest {
  _toBeDivisibleBy(value: number): any;
  _toBeSymbol(value: Symbol): any;
  _toBeDivisibleBy(value: number): any;
  _toBeSymbol(value: Symbol): any;
  _toBeWithinRange(floor: number, ceiling: number): any;
  _toCustomEqual(value: any): any;
  _shouldNotError(): any;
  _toFailWithoutMessage(): any;
  _toBeOne(): any;
  _toAllowOverridingExistingMatcher(): any;
  _toCustomA(): any;
  _toCustomB(): any;
  [""](value: any): any;

  _toThrowErrorMatchingSnapshot(): any; // TODO: remove when implemented
  _toHaveMessageThatThrows(a: any): any;
}

declare module "bun:test" {
  interface Matchers<T> extends CustomMatchersForTest {
    _onlySymmetricalMatcher(): any;
  }
  interface AsymmetricMatchers extends CustomMatchersForTest {
    _onlyAsymmetricalMatcher(): any;
  }
}
