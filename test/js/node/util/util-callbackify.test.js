import { createTest } from "node-harness";
import { callbackify } from "util";

const { describe, expect, it, createCallCheckCtx } = createTest(import.meta.path);

const values = [
  "hello world",
  null,
  undefined,
  false,
  0,
  {},
  { key: "value" },
  Symbol("I am a symbol"),
  function ok() {},
  ["array", "with", 4, "values"],
  new Error("boo"),
];

describe("util.callbackify", () => {
  describe("rejection reason", () => {
    for (const value of values) {
      it(`callback is async function, value is ${String(value)}`, done => {
        const { mustCall } = createCallCheckCtx(done);
        async function asyncFn() {
          return Promise.reject(value);
        }

        const cbAsyncFn = callbackify(asyncFn);
        cbAsyncFn(
          mustCall((err, ret) => {
            try {
              expect(ret).toBeUndefined();
              if (err instanceof Error) {
                if ("reason" in err) {
                  expect(!value).toBeTrue();
                  expect(err.code).toStrictEqual("ERR_FALSY_VALUE_REJECTION");
                  expect(err.reason).toStrictEqual(value);
                } else {
                  expect(String(value)).toEndWith(err.message);
                }
              } else {
                expect(err).toStrictEqual(value);
              }

              done();
            } catch (error) {
              done(error);
            }
          }),
        );
      });

      it(`callback is promise, value is ${String(value)}`, done => {
        const { mustCall } = createCallCheckCtx(done);
        function promiseFn() {
          return Promise.reject(value);
        }
        const obj = {};
        Object.defineProperty(promiseFn, "name", {
          value: obj,
          writable: false,
          enumerable: false,
          configurable: true,
        });

        const cbPromiseFn = callbackify(promiseFn);
        try {
          expect(promiseFn.name).toStrictEqual(obj);
        } catch (error) {
          done(error);
        }

        cbPromiseFn(
          mustCall((err, ret) => {
            try {
              expect(ret).toBeUndefined();
              if (err instanceof Error) {
                if ("reason" in err) {
                  expect(!value).toBeTrue();
                  expect(err.code).toStrictEqual("ERR_FALSY_VALUE_REJECTION");
                  expect(err.reason).toStrictEqual(value);
                } else {
                  expect(String(value)).toEndWith(err.message);
                }
              } else {
                expect(err).toStrictEqual(value);
              }

              done();
            } catch (error) {
              done(error);
            }
          }),
        );
      });

      it(`callback is thenable, value is ${String(value)}`, done => {
        const { mustCall } = createCallCheckCtx(done);
        function thenableFn() {
          return {
            then(onRes, onRej) {
              onRej(value);
            },
          };
        }

        const cbThenableFn = callbackify(thenableFn);
        cbThenableFn(
          mustCall((err, ret) => {
            try {
              expect(ret).toBeUndefined();
              if (err instanceof Error) {
                if ("reason" in err) {
                  expect(!value).toBeTrue();
                  expect(err.code).toStrictEqual("ERR_FALSY_VALUE_REJECTION");
                  expect(err.reason).toStrictEqual(value);
                } else {
                  expect(String(value)).toEndWith(err.message);
                }
              } else {
                expect(err).toStrictEqual(value);
              }

              done();
            } catch (error) {
              done(error);
            }
          }),
        );
      });
    }
  });

  describe("return value", () => {
    for (const value of values) {
      it(`callback is async function, value is ${String(value)}`, done => {
        const { mustSucceed } = createCallCheckCtx(done);
        async function asyncFn() {
          return value;
        }

        const cbAsyncFn = callbackify(asyncFn);
        cbAsyncFn(
          mustSucceed(ret => {
            try {
              expect(ret).toStrictEqual(value);
              expect(ret).toStrictEqual(value);

              done();
            } catch (error) {
              done(error);
            }
          }),
        );
      });

      it(`callback is promise, value is ${String(value)}`, done => {
        const { mustSucceed } = createCallCheckCtx(done);
        function promiseFn() {
          return Promise.resolve(value);
        }

        const cbPromiseFn = callbackify(promiseFn);
        cbPromiseFn(
          mustSucceed(ret => {
            try {
              expect(ret).toStrictEqual(value);
              done();
            } catch (error) {
              done(error);
            }
          }),
        );
      });

      it(`callback is thenable, value is ${String(value)}`, done => {
        const { mustSucceed } = createCallCheckCtx(done);
        function thenableFn() {
          return {
            then(onRes, onRej) {
              onRes(value);
            },
          };
        }

        const cbThenableFn = callbackify(thenableFn);
        cbThenableFn(
          mustSucceed(ret => {
            try {
              expect(ret).toStrictEqual(value);
              done();
            } catch (error) {
              done(error);
            }
          }),
        );
      });
    }
  });

  describe("arguments", () => {
    for (const value of values) {
      it(`callback is async function, value is ${String(value)}`, done => {
        const { mustSucceed } = createCallCheckCtx(done);
        async function asyncFn(arg) {
          try {
            expect(arg).toStrictEqual(value);
          } catch (error) {
            done(error);
          }
          return arg;
        }

        const cbAsyncFn = callbackify(asyncFn);
        cbAsyncFn(
          value,
          mustSucceed(ret => {
            try {
              expect(ret).toStrictEqual(value);
              done();
            } catch (error) {
              done(error);
            }
          }),
        );
      });

      it(`callback is promise, value is ${String(value)}`, done => {
        const { mustSucceed } = createCallCheckCtx(done);
        function promiseFn(arg) {
          try {
            expect(arg).toStrictEqual(value);
          } catch (error) {
            done(error);
          }

          return Promise.resolve(arg);
        }
        const obj = {};
        Object.defineProperty(promiseFn, "length", {
          value: obj,
          writable: false,
          enumerable: false,
          configurable: true,
        });
        const cbPromiseFn = callbackify(promiseFn);
        try {
          expect(promiseFn.length).toStrictEqual(obj);
        } catch (error) {
          done(error);
        }

        cbPromiseFn(
          value,
          mustSucceed(ret => {
            try {
              expect(ret).toStrictEqual(value);
              done();
            } catch (error) {
              done(error);
            }
          }),
        );
      });
    }
  });

  describe("this binding", () => {
    const value = "hello world";
    it("callback is sync function", done => {
      // TODO:
      // const { mustSucceed } = createCallCheckCtx(done);
      const iAmThis = {
        fn(arg) {
          try {
            expect(this).toStrictEqual(iAmThis);
          } catch (error) {
            done(error);
          }
          return Promise.resolve(arg);
        },
      };

      iAmThis.cbFn = callbackify(iAmThis.fn);
      iAmThis.cbFn(value, function (rej, ret) {
        try {
          expect(ret).toStrictEqual(value);
          expect(this).toStrictEqual(iAmThis);

          done();
        } catch (error) {
          done(error);
        }
      });
    });

    it("callback is async function", done => {
      const iAmThis = {
        async fn(arg) {
          try {
            expect(this).toStrictEqual(iAmThis);
          } catch (error) {
            done(error);
          }
          return Promise.resolve(arg);
        },
      };

      iAmThis.cbFn = callbackify(iAmThis.fn);
      iAmThis.cbFn(value, function (rej, ret) {
        try {
          expect(ret).toStrictEqual(value);
          expect(this).toStrictEqual(iAmThis);

          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });
});
