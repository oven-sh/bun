// Distinct fixture so the `jest.mock()` parity test in auto-mock.test.ts
// exercises its own fresh mock registration, isolated from mocks installed
// for `./auto-mock-fixture` by earlier tests in the file.

export function plainFunction() {
  return "real-jest";
}

export class MyClass {
  constructor(public label: string) {}
}
