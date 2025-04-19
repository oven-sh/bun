beforeEach(() => jest.setTimeout(5));

describe("sync test functions with a done() cb", () => {
  test.failing("fail when done is never called", done => {
    // nada
  });

  test.failing("fail when done is called after timeout", done => {
    setTimeout(() => done(), 1000);
  });
});

describe("async test functions", () => {
  test.failing("fail when they never resolve", () => {
    return new Promise((_resolve, _reject) => {
      // lol
    });
  });

  test.failing("fail when they don't resolve in time", async () => {
    await Bun.sleep(1000);
  });

  describe("with a done() cb", () => {
    test.failing("fail when done is never called", async done => {
      // nada
    });

    test.failing("fail when done is called after timeout", done => {
      return new Promise(resolve => {
        setTimeout(() => resolve(done()), 1000);
      });
    });
  });
});
