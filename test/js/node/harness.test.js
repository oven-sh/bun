// import { describe, it, expect } from "bun:test";
// import {
//   throws,
//   assert,
//   strictEqual,
//   createCallCheckCtx,
//   createDoneDotAll,
// } from "./node-test-helpers";

// describe("NodeTestHelpers.throws()", () => {
//   it("should pass when the function throws", () => {
//     throws(() => {
//       throw new Error("THROWN!");
//     });
//   });

//   it("should fail when the function doesn't throw", () => {
//     let err;
//     try {
//       throws(() => {}, Error);
//     } catch (e) {
//       err = e;
//     }

//     expect(err instanceof Error).toBe(true);
//   });
// });

// describe("NodeTestHelpers.assert()", () => {
//   it("should pass when the provided value is true", () => {
//     assert(true);
//   });

//   it("should fail when the provided value is false", () => {
//     let err;
//     try {
//       assert(false);
//     } catch (e) {
//       err = e;
//     }
//     expect(err instanceof Error).toBe(true);
//   });
// });

// describe("NodeTestHelpers.strictEqual()", () => {
//   it("should pass when the provided values are deeply equal", () => {
//     strictEqual(1, 1);
//     strictEqual("hello", "hello");
//     const testing = { hello: "world" };
//     const testing2 = testing;
//     testing2.hello = "bla";
//     strictEqual(testing, testing2);
//     strictEqual(NaN, NaN);
//     strictEqual(Infinity, Infinity);
//     strictEqual(-Infinity, -Infinity);
//     strictEqual(null, null);
//     strictEqual(undefined, undefined);
//   });

//   it("should fail when the provided values are not deeply equal", () => {
//     let err = null;
//     try {
//       strictEqual(1, 5);
//     } catch (e) {
//       err = e;
//     }
//     expect(err instanceof Error).toBe(true);
//     err = null;
//     try {
//       strictEqual({ foo: "bar" }, { foo: "bar" });
//     } catch (e) {
//       err = e;
//     }
//     expect(err instanceof Error).toBe(true);
//     err = null;
//     try {
//       strictEqual("1", 1);
//     } catch (e) {
//       err = e;
//     }
//     expect(err instanceof Error).toBe(true);
//     err = null;
//     const obj1 = { foo: "bar" };
//     const obj2 = JSON.parse(JSON.stringify(obj1));
//     try {
//       strictEqual(obj1, obj2);
//     } catch (e) {
//       err = e;
//     }
//     expect(err instanceof Error).toBe(true);
//   });
// });

// describe("NodeTestHelpers.createCallCheckCtx", () => {
//   it("should pass when all mustCall marked callbacks have been called", (done) => {
//     const { mustCall } = createCallCheckCtx(done);
//     const fn1 = mustCall(() => {});
//     const fn2 = mustCall(() => {});
//     fn1();
//     fn2();
//   });

//   it("should fail when all mustCall marked callbacks have NOT been called", (done) => {
//     const mockDone = (result) => {
//       expect(result instanceof Error).toBe(true);
//       done();
//     };
//     const { mustCall } = createCallCheckCtx(mockDone, 600);
//     const fn1 = mustCall(() => {});
//     mustCall(() => {});
//     fn1();
//   });

//   it("should allow us to get the args of the wrapped callback from mustCall", (done) => {
//     const { mustCall } = createCallCheckCtx(done);
//     const fn1 = mustCall((arg1, arg2) => {
//       expect(arg1).toBe("hello");
//       expect(arg2).toBe("world");
//     });
//     fn1("hello", "world");
//   });
// });

// describe("NodeTestHelpers.createDoneDotAll()", () => {
//   it("should pass when all dones have been called", (done) => {
//     const createDone = createDoneDotAll(done);
//     const done1 = createDone(600);
//     const done2 = createDone(600);
//     setTimeout(() => done1(), 300);
//     setTimeout(() => done2(), 450);
//   });

//   it("should fail when all dones have NOT been called before timeout", (done) => {
//     const mockDone = (result) => {
//       expect(result instanceof Error).toBe(true);
//       done();
//     };
//     const createDone = createDoneDotAll(mockDone);
//     const done1 = createDone(400);
//     createDone(400);
//     setTimeout(() => done1(), 200);
//   });

//   it("should allow us to combine mustCall and multiple dones", (done) => {
//     const createDone = createDoneDotAll(done);
//     const { mustCall } = createCallCheckCtx(createDone(600));
//     const done1 = createDone(600);
//     const done2 = createDone(600);
//     const fn1 = mustCall(() => {});
//     const fn2 = mustCall(() => {});
//     setTimeout(() => done1(), 300);
//     setTimeout(() => done2(), 450);
//     setTimeout(() => fn1(), 200);
//     setTimeout(() => fn2(), 200);
//   });

//   it("should fail if a done is called with an error", (done) => {
//     const mockDone = (result) => {
//       expect(result instanceof Error).toBe(true);
//       done();
//     };
//     const createDone = createDoneDotAll(mockDone);

//     const done1 = createDone(600);
//     const done2 = createDone(600);
//     setTimeout(() => done1(), 300);
//     setTimeout(() => done2(new Error("ERROR!")), 450);
//   });
// });
