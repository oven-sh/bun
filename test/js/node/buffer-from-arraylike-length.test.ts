import { describe, expect, it } from "bun:test";

// Node's fromObject/fromArrayLike path reads an array-like object's .length
// getter four times in the common case; caching it changes observable
// behavior for proxies and reactive wrappers and can change the resulting
// bytes when a getter returns different values across reads.
describe("Buffer.from(arrayLike) .length getter reads", () => {
  function makeArrayLike(lengthFn: () => unknown, n = 3) {
    const o = {};
    const order: string[] = [];
    Object.defineProperty(o, "length", {
      get() {
        order.push("length");
        return lengthFn();
      },
    });
    for (let i = 0; i < n; i++) {
      Object.defineProperty(o, String(i), {
        get() {
          order.push(String(i));
          return 97 + i;
        },
      });
    }
    return { o, order };
  }

  it.each([
    [2, "6162", ["length", "length", "length", "length", "0", "1"]],
    [0, "", ["length", "length", "length"]],
    [1.5, "61", ["length", "length", "length", "length", "0"]],
    [-5, "", ["length", "length", "length"]],
    [NaN, "", ["length", "length", "length", "length"]],
  ])("length=%p reads .length the same number of times as Node.js", (len, hex, expectedOrder) => {
    const { o, order } = makeArrayLike(() => len);
    expect(Buffer.from(o).toString("hex")).toBe(hex);
    expect(order).toEqual(expectedOrder);
  });

  it("length='2' (non-number) reads .length twice and returns an empty buffer", () => {
    const { o, order } = makeArrayLike(() => "2");
    expect(Buffer.from(o).toString("hex")).toBe("");
    expect(order).toEqual(["length", "length"]);
  });

  it("length=undefined reads .length once and throws ERR_INVALID_ARG_TYPE", () => {
    let reads = 0;
    const o = {};
    Object.defineProperty(o, "length", {
      get() {
        reads++;
        return undefined;
      },
    });
    expect(() => Buffer.from(o)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(reads).toBe(1);
  });

  it("length >= Buffer.poolSize/2 still reads .length four times", () => {
    const n = Math.max(5000, Buffer.poolSize);
    const { o, order } = makeArrayLike(() => n, 0);
    const b = Buffer.from(o);
    expect(b.length).toBe(n);
    expect(order.filter(k => k === "length")).toEqual(["length", "length", "length", "length"]);
  });

  it("a .length getter that returns 3,3,1,... yields the 1-byte buffer Node.js produces", () => {
    let calls = 0;
    const seq = [3, 3, 1];
    const { o, order } = makeArrayLike(() => seq[Math.min(calls++, seq.length - 1)]);
    expect(Buffer.from(o).toString("hex")).toBe("61");
    expect(order).toEqual(["length", "length", "length", "length", "0"]);
  });

  it("a .length getter that grows past the allocation size throws RangeError like Node.js", () => {
    let calls = 0;
    const seq = [3, 3, 1, 5];
    const { o } = makeArrayLike(() => seq[Math.min(calls++, seq.length - 1)], 5);
    expect(() => Buffer.from(o)).toThrow(RangeError);
  });

  it("a .length getter that shrinks after allocation leaves the unwritten tail zeroed", () => {
    let calls = 0;
    const seq = [100, 100, 100, 1];
    const { o } = makeArrayLike(() => seq[Math.min(calls++, seq.length - 1)], 1);
    const b = Buffer.from(o);
    expect(b.length).toBe(100);
    expect(b[0]).toBe(97);
    expect(b.subarray(1).every(x => x === 0)).toBe(true);
  });
});
