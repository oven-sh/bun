// This test is intended to be able to run in Vitest and Jest.
describe("top-level sibling", () => {
  beforeAll(() => {
    throw new Error("FAIL");
  });

  afterAll(() => {
    throw new Error("FAIL");
  });

  beforeEach(() => {
    throw new Error("FAIL");
  });

  afterEach(() => {
    throw new Error("FAIL");
  });

  test("test", () => {
    throw new Error("FAIL");
  });
});

describe("parent", () => {
  let ran = {
    beforeAll: 0,
    beforeEach: 0,
    afterEach: 0,
    afterAll: 0,
  };

  beforeEach(() => {
    if (++ran.beforeEach > 2) {
      throw new Error("FAIL");
    }

    console.log("<parent beforeEach>");
  });

  afterEach(() => {
    if (++ran.afterEach > 2) {
      throw new Error("FAIL");
    }

    console.log("<parent afterEach>");
  });

  beforeAll(() => {
    if (++ran.beforeAll > 1) {
      throw new Error("FAIL");
    }

    console.log("<parent beforeAll>");
  });

  afterAll(() => {
    if (++ran.afterAll > 1) {
      throw new Error("FAIL");
    }

    console.log("<parent afterAll>");
  });

  describe("sibling describe", () => {
    beforeEach(() => {
      throw new Error("FAIL");
    });

    afterEach(() => {
      throw new Error("FAIL");
    });

    test("test", () => {
      throw new Error("FAIL");
    });
  });

  describe("should run", () => {
    let ran = {
      beforeAll: 0,
      beforeEach: 0,
      afterEach: 0,
      afterAll: 0,
    };
    beforeAll(() => {
      if (++ran.beforeAll > 1) {
        throw new Error("FAIL");
      }

      console.log("<beforeAll>");
    });

    afterAll(() => {
      if (++ran.afterAll > 1) {
        throw new Error("FAIL");
      }

      console.log("<afterAll>");
    });

    beforeEach(() => {
      if (++ran.beforeEach > 2) {
        throw new Error("FAIL 1");
      }

      console.log("<beforeEach>");
    });

    afterEach(() => {
      if (++ran.afterEach > 2) {
        throw new Error("FAIL 2");
      }

      console.log("<afterEach>");
    });

    test("before sibling", () => {
      throw new Error("FAIL");
    });

    test("test", () => {
      console.log("<test 1>");
    });

    test("test 2", () => {
      console.log("<test 2>");
    });

    test("FAIL", () => {
      throw new Error("FAIL");
    });
  });
});
