// Distinct fixture so the `vi.requireMock()` mirror test in auto-mock.test.ts
// exercises its own fresh mock registration, isolated from mocks installed
// for `./auto-mock-fixture` by earlier tests in the file.

export function plainFunction() {
  return "real-viRequireMock";
}

export class MyClass {
  constructor(public label: string) {}
}
