import { describe, expect, test } from "bun:test";

// Jest 30 compares `cause` recursively in addition to `message` when the
// expected value passed to `toThrow` is an error object.
describe("toThrow compares Error cause", () => {
  const thrower = (err: unknown) => () => {
    throw err;
  };

  test("same message, different primitive cause fails", () => {
    expect(() => {
      expect(thrower(new Error("m", { cause: "a" }))).toThrow(new Error("m", { cause: "b" }));
    }).toThrow();
  });

  test("same message, same primitive cause passes", () => {
    expect(thrower(new Error("m", { cause: "a" }))).toThrow(new Error("m", { cause: "a" }));
  });

  test("same message, different Error cause fails", () => {
    expect(() => {
      expect(thrower(new Error("m", { cause: new Error("a") }))).toThrow(new Error("m", { cause: new Error("b") }));
    }).toThrow();
  });

  test("same message, same Error cause passes", () => {
    expect(thrower(new Error("m", { cause: new Error("a") }))).toThrow(new Error("m", { cause: new Error("a") }));
  });

  test("received has truthy cause but expected has none fails", () => {
    expect(() => {
      expect(thrower(new Error("m", { cause: new Error("a") }))).toThrow(new Error("m"));
    }).toThrow();
    expect(() => {
      expect(thrower(new Error("m", { cause: "x" }))).toThrow(new Error("m"));
    }).toThrow();
  });

  test("received has no cause but expected has truthy cause fails", () => {
    expect(() => {
      expect(thrower(new Error("m"))).toThrow(new Error("m", { cause: new Error("a") }));
    }).toThrow();
  });

  // Jest gates `cause` comparison on truthiness, so these are all no-cause.
  test.each([undefined, null, 0, false, ""])("falsy cause %p is treated as absent", falsy => {
    expect(thrower(new Error("m", { cause: falsy }))).toThrow(new Error("m"));
    expect(thrower(new Error("m"))).toThrow(new Error("m", { cause: falsy }));
  });

  test("nested causes differing at depth 2 fail", () => {
    expect(() => {
      expect(thrower(new Error("m", { cause: new Error("a", { cause: new Error("x") }) }))).toThrow(
        new Error("m", { cause: new Error("a", { cause: new Error("y") }) }),
      );
    }).toThrow();
  });

  test("nested causes matching at all depths pass", () => {
    expect(thrower(new Error("m", { cause: new Error("a", { cause: new Error("x") }) }))).toThrow(
      new Error("m", { cause: new Error("a", { cause: new Error("x") }) }),
    );
  });

  test("error subclass causes compare by message", () => {
    expect(thrower(new Error("m", { cause: new TypeError("x") }))).toThrow(new Error("m", { cause: new Error("x") }));
  });

  test("object causes compare structurally", () => {
    expect(thrower(new Error("m", { cause: { x: 1 } }))).toThrow(new Error("m", { cause: { x: 1 } }));
    expect(() => {
      expect(thrower(new Error("m", { cause: { x: 1 } }))).toThrow(new Error("m", { cause: { x: 2 } }));
    }).toThrow();
  });

  test(".not inverts the cause check", () => {
    expect(thrower(new Error("m", { cause: "a" }))).not.toThrow(new Error("m", { cause: "b" }));
    expect(() => {
      expect(thrower(new Error("m", { cause: "a" }))).not.toThrow(new Error("m", { cause: "a" }));
    }).toThrow();
    expect(thrower(new Error("m", { cause: new Error("a") }))).not.toThrow(new Error("m"));
  });

  test("a different message still fails regardless of cause", () => {
    expect(() => {
      expect(thrower(new Error("m1", { cause: "a" }))).toThrow(new Error("m2", { cause: "a" }));
    }).toThrow();
  });

  test("no cause on either side still matches by message only", () => {
    expect(thrower(new Error("m"))).toThrow(new Error("m"));
    expect(thrower(new Error("m"))).not.toThrow(new Error("other"));
  });

  test("cause mismatch reports both causes", () => {
    let caught: Error | undefined;
    try {
      expect(() => {
        throw new Error("m", { cause: "received-cause" });
      }).toThrow(new Error("m", { cause: "expected-cause" }));
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain("Expected cause:");
    expect(caught!.message).toContain("Received cause:");
    expect(caught!.message).toContain("expected-cause");
    expect(caught!.message).toContain("received-cause");
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
    let caught: unknown;
    try {
      await expect(Promise.reject(new Error("m", { cause: "a" }))).rejects.toThrow(new Error("m", { cause: "b" }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    await expect(Promise.reject(new Error("m", { cause: "a" }))).rejects.toThrow(new Error("m", { cause: "a" }));
  });
});
