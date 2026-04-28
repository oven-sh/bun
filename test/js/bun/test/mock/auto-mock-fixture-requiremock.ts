// Distinct fixture so the `jest.requireMock()` test in auto-mock.test.ts
// exercises its own fresh mock registration, isolated from mocks installed
// for `./auto-mock-fixture` by earlier tests in the file.

export function plainFunction() {
  return "real-requireMock";
}

export class MyClass {
  constructor(public label: string) {}
}
