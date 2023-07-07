import { describe, it, expect } from "bun:test";

describe("URLSearchParams", () => {
  describe("non-standard extensions", () => {
    it("should support .length", () => {
      const params = new URLSearchParams();
      params.append("foo", "bar");
      params.append("foo", "boop");
      params.append("bar", "baz");
      // @ts-ignore
      expect(params.length).toBe(3);
      params.delete("foo");
      // @ts-ignore
      expect(params.length).toBe(1);
      params.append("foo", "bar");
      // @ts-ignore
      expect(params.length).toBe(2);
      params.delete("foo");
      params.delete("foo");
      // @ts-ignore
      expect(params.length).toBe(1);
      params.delete("bar");
      // @ts-ignore
      expect(params.length).toBe(0);
    });

    it("should support .toJSON", () => {
      const params = new URLSearchParams();
      params.append("foo", "bar");
      params.append("foo", "boop");
      params.append("bar", "baz");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        foo: ["bar", "boop"],
        bar: "baz",
      });
      expect(JSON.parse(JSON.stringify(params))).toEqual({
        foo: ["bar", "boop"],
        bar: "baz",
      });
      expect(Bun.inspect(params)).toBe(
        "URLSearchParams {" + "\n" + '  "foo": [ "bar", "boop" ],' + "\n" + '  "bar": "baz"' + "\n" + "}",
      );
      params.delete("foo");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        bar: "baz",
      });
      params.append("foo", "bar");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        foo: "bar",
        bar: "baz",
      });
      params.delete("foo");
      params.delete("foo");
      // @ts-ignore
      expect(params.toJSON()).toEqual({
        bar: "baz",
      });
      params.delete("bar");
      // @ts-ignore
      expect(params.toJSON()).toEqual({});

      expect(JSON.stringify(params)).toBe("{}");
    });
  });
});
