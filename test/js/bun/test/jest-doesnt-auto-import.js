export function getJestGlobals() {
  return {
    describe: typeof describe === "function" ? describe : undefined,
    it: typeof it === "function" ? it : undefined,
    test: typeof test === "function" ? test : undefined,
    expect: typeof expect === "function" ? expect : undefined,
    beforeAll: typeof beforeAll === "function" ? beforeAll : undefined,
    beforeEach: typeof beforeEach === "function" ? beforeEach : undefined,
    afterAll: typeof afterAll === "function" ? afterAll : undefined,
    afterEach: typeof afterEach === "function" ? afterEach : undefined,
  };
}
