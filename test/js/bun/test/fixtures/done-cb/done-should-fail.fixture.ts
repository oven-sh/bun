let i = 0;
const msg = () => `error message ${++i}`;

describe("sync test functions", () => {
  test(`done('some string') fails the test`, done => {
    done(msg());
  });

  test(`done(new Error("message")) fails the test`, done => {
    done(new Error(msg()));
  });

  test(`throwing an error fails the test`, _done => {
    throw new Error(msg());
  });
});

describe("async test functions", () => {
  test("rejecting a promise fails the test", _done => {
    return Promise.reject(new Error(msg()));
  });

  test("resolving then calling done() with an error fails the test", done => {
    return Promise.resolve().then(() => done(new Error(msg())));
  });
});
