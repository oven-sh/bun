// Fixture for the "requireMock synthesises on demand" path of auto-mock.test.ts.
// Distinct from auto-mock-fixture.ts so other tests in the file don't prime
// the virtual-module map for this specifier.

export function plainFunction() {
  return "ondemand";
}
