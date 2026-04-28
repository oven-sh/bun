// Fixture for auto-mock.test.ts — covers the property kinds auto-mock needs
// to handle (primitives preserved, functions mocked, classes mocked, nested
// objects recursed, arrays preserved, cycles survived).

export function plainFunction(...args: unknown[]) {
  return "real-" + args.length;
}

export class MyClass {
  constructor(public label: string) {}
  greet() {
    return "hello from " + this.label;
  }
  static staticMethod() {
    return "static";
  }
}

export const CONSTANT = 42;
export const STRING_CONSTANT = "hello";

export const arr = [1, "two", { three: 3 }];

export const nested = {
  fn() {
    return "real-nested";
  },
  value: "nested-value",
};
