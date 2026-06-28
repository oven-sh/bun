import { describe, expect, test } from "bun:test";

// Jest 30 compares `cause` recursively in addition to `message` when the
// expected value passed to `toThrow` is an error object.
describe("toThrow compares Error cause", () => {
  const thrower = (err: unknown) => () => {
    throw err;
  };

  // Runs `fn`, asserts that it threw, and checks the failure message for each
  // `snippet` so an unrelated exception cannot satisfy a negative case.
  const expectAssertionFailure = (fn: () => void, ...snippets: string[]) => {
    let caught: Error | undefined;
    try {
      fn();
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    for (const snippet of snippets) {
      expect(caught!.message).toContain(snippet);
    }
  };

  test("same message, different primitive cause fails", () => {
    expectAssertionFailure(
      () => expect(thrower(new Error("m", { cause: "a" }))).toThrow(new Error("m", { cause: "b" })),
      "Expected cause:",
      "Received cause:",
    );
  });

  test("same message, same primitive cause passes", () => {
    expect(thrower(new Error("m", { cause: "a" }))).toThrow(new Error("m", { cause: "a" }));
  });

  test("same message, different Error cause fails", () => {
    expectAssertionFailure(
      () =>
        expect(thrower(new Error("m", { cause: new Error("a") }))).toThrow(new Error("m", { cause: new Error("b") })),
      "Expected cause:",
      "Received cause:",
    );
  });

  test("same message, same Error cause passes", () => {
    expect(thrower(new Error("m", { cause: new Error("a") }))).toThrow(new Error("m", { cause: new Error("a") }));
  });

  test("received has truthy cause but expected has none fails", () => {
    expectAssertionFailure(
      () => expect(thrower(new Error("m", { cause: new Error("a") }))).toThrow(new Error("m")),
      "Expected cause:",
      "Received cause:",
    );
    expectAssertionFailure(
      () => expect(thrower(new Error("m", { cause: "x" }))).toThrow(new Error("m")),
      "Expected cause:",
      "Received cause:",
    );
  });

  test("received has no cause but expected has truthy cause fails", () => {
    expectAssertionFailure(
      () => expect(thrower(new Error("m"))).toThrow(new Error("m", { cause: new Error("a") })),
      "Expected cause:",
      "Received cause:",
    );
  });

  // Jest gates `cause` comparison on truthiness, so these are all no-cause.
  test.each([undefined, null, 0, false, ""])("falsy cause %p is treated as absent", falsy => {
    expect(thrower(new Error("m", { cause: falsy }))).toThrow(new Error("m"));
    expect(thrower(new Error("m"))).toThrow(new Error("m", { cause: falsy }));
  });

  test("nested causes differing at depth 2 fail", () => {
    expectAssertionFailure(
      () =>
        expect(thrower(new Error("m", { cause: new Error("a", { cause: new Error("x") }) }))).toThrow(
          new Error("m", { cause: new Error("a", { cause: new Error("y") }) }),
        ),
      "Expected cause:",
      "Received cause:",
    );
  });

  test("nested causes matching at all depths pass", () => {
    expect(thrower(new Error("m", { cause: new Error("a", { cause: new Error("x") }) }))).toThrow(
      new Error("m", { cause: new Error("a", { cause: new Error("x") }) }),
    );
  });

  test("error subclass causes compare by message", () => {
    class Wrapped extends Error {}
    expect(thrower(new Error("m", { cause: new TypeError("x") }))).toThrow(new Error("m", { cause: new Error("x") }));
    expect(thrower(new Error("m", { cause: new Wrapped("x") }))).toThrow(new Error("m", { cause: new Error("x") }));
  });

  test("object causes compare structurally", () => {
    expect(thrower(new Error("m", { cause: { x: 1 } }))).toThrow(new Error("m", { cause: { x: 1 } }));
    expectAssertionFailure(
      () => expect(thrower(new Error("m", { cause: { x: 1 } }))).toThrow(new Error("m", { cause: { x: 2 } })),
      "Expected cause:",
      "Received cause:",
    );
  });

  // A plain object with a `message` is not an Error instance, so it is compared
  // structurally and every differing property is a mismatch, as in Jest 30.
  test("non-Error causes with a message still compare all properties", () => {
    expect(thrower(new Error("m", { cause: { message: "x", code: 1 } }))).toThrow(
      new Error("m", { cause: { message: "x", code: 1 } }),
    );
    expectAssertionFailure(
      () =>
        expect(thrower(new Error("m", { cause: { message: "x", code: 1 } }))).toThrow(
          new Error("m", { cause: { message: "x", code: 2 } }),
        ),
      "Expected cause:",
      "Received cause:",
    );
  });

  test(".not inverts the cause check", () => {
    expect(thrower(new Error("m", { cause: "a" }))).not.toThrow(new Error("m", { cause: "b" }));
    expectAssertionFailure(
      () => expect(thrower(new Error("m", { cause: "a" }))).not.toThrow(new Error("m", { cause: "a" })),
      "Expected message: not",
      "Expected cause: not",
    );
    expect(thrower(new Error("m", { cause: new Error("a") }))).not.toThrow(new Error("m"));
  });

  test("a different message still fails regardless of cause", () => {
    expectAssertionFailure(
      () => expect(thrower(new Error("m1", { cause: "a" }))).toThrow(new Error("m2", { cause: "a" })),
      "Expected message:",
      "Received message:",
      "m2",
      "m1",
    );
  });

  test("no cause on either side still matches by message only", () => {
    expect(thrower(new Error("m"))).toThrow(new Error("m"));
    expect(thrower(new Error("m"))).not.toThrow(new Error("other"));
  });

  test("cause mismatch reports both causes", () => {
    expectAssertionFailure(
      () => expect(thrower(new Error("m", { cause: "received-cause" }))).toThrow(new Error("m", { cause: "expected-cause" })),
      "Expected cause:",
      "Received cause:",
      "expected-cause",
      "received-cause",
    );
  });

  test("circular causes do not hang", () => {
    const a: Error = new Error("m");
    a.cause = a;
    const b: Error = new Error("m");
    b.cause = b;
    expect(() => {
      throw a;
    }).toThrow(b);
  });

  test("rejects.toThrow compares cause", async () => {
    let caught: Error | undefined;
    try {
      await expect(Promise.reject(new Error("m", { cause: "a" }))).rejects.toThrow(new Error("m", { cause: "b" }));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain("Expected cause:");
    expect(caught!.message).toContain("Received cause:");
    await expect(Promise.reject(new Error("m", { cause: "a" }))).rejects.toThrow(new Error("m", { cause: "a" }));
  });
});
