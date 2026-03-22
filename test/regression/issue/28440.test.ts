import { test, expect, describe } from "bun:test";

describe("toMatchObject should not mutate actual object", () => {
    test("should not mutate properties matched by expect.any()", () => {
        const obj = { foo: "foo", bar: "bar" };
        expect(obj).toMatchObject({ bar: expect.any(String) });
        // After toMatchObject, obj.bar should still be "bar", not the matcher
        expect(obj.bar).toBe("bar");
    });

    test("consecutive toMatchObject calls should work", () => {
        const obj = { foo: "foo", bar: "bar" };
        expect(obj).toMatchObject({ bar: expect.any(String) });
        // Second call should also pass since object wasn't mutated
        expect(obj).toMatchObject({ bar: expect.any(String) });
    });

    test("works with spread operator and expect.any()", () => {
        const hasExtra = true;
        const actual = { name: "test name", extra: "test extra" };
        const expected = {
            name: "test name",
            ...(hasExtra ? { extra: expect.any(String) } : {}),
        };
        expect(actual).toMatchObject(expected);
        // Verify actual wasn't mutated by the match
        expect(actual.extra).toBe("test extra");
    });

    test("works with Object.freeze and expect.any()", () => {
        const obj = Object.freeze({ foo: "foo", bar: "bar" });
        expect(obj).toMatchObject({ bar: expect.any(String) });
    });

    test("works with spread copy of actual and expect.any()", () => {
        const obj = { foo: "foo", bar: "bar" };
        expect({ ...obj }).toMatchObject({ bar: expect.any(String) });
    });

    test("does not mutate properties matched by expect.anything()", () => {
        const obj = { a: 1, b: "hello", c: [1, 2, 3] };
        expect(obj).toMatchObject({ b: expect.anything() });
        expect(obj.b).toBe("hello");
    });

    test("does not mutate nested properties matched by asymmetric matchers", () => {
        const obj = { outer: { inner: "value" } };
        expect(obj).toMatchObject({ outer: { inner: expect.any(String) } });
        expect(obj.outer.inner).toBe("value");
    });
});
