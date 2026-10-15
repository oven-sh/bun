import assert, { AssertionError } from "assert";
import { describe, expect, it } from "bun:test";

describe("assert.rejects", () => {
  it("accepts a rejecting function", async () => {
    const rejectingFn = async () => {
      throw new AssertionError({
        message: "Failed",
        operator: "fail",
      });
    };

    await expect(
      assert.rejects(rejectingFn, {
        name: "AssertionError",
        message: "Failed",
      }),
    ).resolves.toBeUndefined();
  });

  it("accepts a rejecting promise", async () => {
    const rejectingPromise = Promise.reject(
      new AssertionError({
        message: "Failed",
        operator: "fail",
      }),
    );

    await expect(
      assert.rejects(rejectingPromise, {
        name: "AssertionError",
        message: "Failed",
      }),
    ).resolves.toBeUndefined();
  });

  it("handles thenable objects when cast to Promise", async () => {
    // Create a Promise from a thenable to make TypeScript happy
    const thenablePromise = Promise.resolve().then(() => {
      return Promise.reject({ name: "CustomError" });
    });

    await expect(assert.rejects(thenablePromise, { name: "CustomError" })).resolves.toBeUndefined();
  });

  it("rejects when promise resolves instead of rejecting", async () => {
    await expect(assert.rejects(Promise.resolve())).rejects.toMatchObject({
      message: "Missing expected rejection.",
    });
  });

  it("rejects with correct error when validation function returns non-boolean", async () => {
    const err = new Error("foobar");
    const validate = () => "baz";

    await expect(assert.rejects(Promise.reject(err), validate)).rejects.toMatchObject({
      message: expect.stringContaining(
        'The "validate" validation function is expected to return "true". Received \'baz\'',
      ),
      actual: err,
      expected: validate,
      name: "AssertionError",
      operator: "rejects",
    });
  });
});

describe("assert.doesNotReject", () => {
  it("resolves when promise resolves", async () => {
    await expect(assert.doesNotReject(Promise.resolve())).resolves.toBeUndefined();
  });

  it("resolves when async function resolves", async () => {
    await expect(assert.doesNotReject(async () => {})).resolves.toBeUndefined();
  });

  it("handles thenable objects with proper Promise cast", async () => {
    // Create a proper Promise from a thenable pattern
    const thenablePromise = Promise.resolve().then(() => {
      return "success";
    });

    await expect(assert.doesNotReject(thenablePromise)).resolves.toBeUndefined();
  });

  it("documents Node.js behavior with invalid thenables", async () => {
    const invalidThenable = {
      then: (fulfill, reject) => {
        fulfill();
      },
    };

    await expect(assert.doesNotReject(invalidThenable as any)).rejects.toMatchObject({
      message: expect.stringContaining('The "promiseFn" argument must be of type function or an instance of Promise'),
    });
  });

  it("rejects when promise rejects", async () => {
    await expect(assert.doesNotReject(Promise.reject(new Error("Failed")))).rejects.toMatchObject({
      message: expect.stringContaining("Got unwanted rejection"),
      operator: "doesNotReject",
    });
  });

  it("rejects when async function rejects", async () => {
    const rejectingFn = async () => {
      throw new Error("Failed");
    };

    await expect(assert.doesNotReject(rejectingFn)).rejects.toMatchObject({
      message: expect.stringContaining("Got unwanted rejection"),
      operator: "doesNotReject",
    });
  });

  it("rejects with invalid argument types", async () => {
    await expect(assert.doesNotReject(123 as any)).rejects.toMatchObject({
      message: expect.stringContaining('The "promiseFn" argument must be of type function or an instance of Promise'),
    });
  });
});

describe("the stack of a failed assert.rejects and assert.doesNotReject", () => {
  let sink = 0; // `sink++` after a call keeps that call out of tail position

  async function callsRejects() {
    await assert.rejects(Promise.resolve(1));
    sink++;
  }
  async function callsStrictRejects() {
    await assert.strict.rejects(Promise.resolve(1));
    sink++;
  }
  async function callsDoesNotReject() {
    await assert.doesNotReject(Promise.reject(new Error("unwanted")));
    sink++;
  }
  async function callsStrictDoesNotReject() {
    await assert.strict.doesNotReject(Promise.reject(new Error("unwanted")));
    sink++;
  }

  it.each([
    ["assert.rejects", callsRejects],
    ["assert.strict.rejects", callsStrictRejects],
    ["assert.doesNotReject", callsDoesNotReject],
    ["assert.strict.doesNotReject", callsStrictDoesNotReject],
  ])("%s: starts at the function that called it", async (_, caller) => {
    const error = await caller().then(
      () => null,
      error => error,
    );
    expect(error).toBeInstanceOf(AssertionError);
    const frames = error.stack.split("\n").filter(line => line.startsWith("    at "));
    expect(frames[0]).toStartWith(`    at async ${caller.name} (`);
    expect(error.stack).not.toContain("node:assert");
  });
});
