// Fixture for the repeat-jest.mock test: mocked twice in one process, so the
// second auto-mock walk runs over the first round's mocks.

export function plainFunction() {
  return "real-double";
}
