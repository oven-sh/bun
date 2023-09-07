module.exports = () => {
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
    const vi = require("vitest");

    return {
      isBun: false,
      bunTest: null,
      test: vi.test,
      describe: vi.describe,
      it: vi.it,
      expect: vi.expect,
      beforeEach: vi.beforeEach,
      afterEach: vi.afterEach,
      beforeAll: vi.beforeAll,
      afterAll: vi.afterAll,
      jest: { fn: vi.fn },
      mock: null,
      vi,
      spyOn: vi.spyOn,
    };
  } else {
    const globals = require("@jest/globals");
    const extended = require("jest-extended");
    globals.expect.extend(extended);
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
