export default /** @returns {Promise<import('bun:test') & { isBun: Boolean, bunTest: string|null }>} */ async () => {
  if (globalThis.Bun) {
    /** @type {import('bun:jsc')} */
    const jsc = require("bun:jsc");
    const source = Bun.fileURLToPath(jsc.callerSourceOrigin());
    const bunTest = Bun.jest(source);
    return {
      isBun: true,
      bunTest,
      test: bunTest.test,
      describe: bunTest.describe,
      it: bunTest.it,
      expect: bunTest.expect,
      beforeEach: bunTest.beforeEach,
      afterEach: bunTest.afterEach,
      beforeAll: bunTest.beforeAll,
      afterAll: bunTest.afterAll,
      jest: bunTest.jest,
      mock: bunTest.mock,
      vi: bunTest.vi,
      spyOn: bunTest.spyOn,
    };
  } else if (process.env.VITEST) {
    // vitest doesn't work with require()
    const vitest = await import("vitest");
    const { default: jestExtended } = await import("jest-extended");
    vitest.expect.extend(jestExtended);
    return {
      isBun: false,
      bunTest: null,
      test: vitest.test,
      describe: vitest.describe,
      it: vitest.it,
      expect: vitest.expect,
      beforeEach: vitest.beforeEach,
      afterEach: vitest.afterEach,
      beforeAll: vitest.beforeAll,
      afterAll: vitest.afterAll,
      jest: { fn: vitest.vi.fn },
      mock: null,
      vi: vitest.vi,
      spyOn: vitest.vi.spyOn,
    };
  } else {
    const globals = await import("@jest/globals");
    const { default: jestExtended } = await import("jest-extended");
    globals.expect.extend(jestExtended);
    globals.test.todo = globals.test;
    return {
      isBun: false,
      bunTest: null,
      test: globals.test,
      describe: globals.describe,
      it: globals.it,
      expect: globals.expect,
      beforeEach: globals.beforeEach,
      afterEach: globals.afterEach,
      beforeAll: globals.beforeAll,
      afterAll: globals.afterAll,
      jest: globals.jest,
      mock: null,
      vi: null,
      spyOn: globals.jest.spyOn,
    };
  }
};
