import { BlockList } from "node:net";
import { describe, beforeEach, afterAll, it, expect } from "bun:test";

describe("BlockList", () => {
  let b: BlockList;

  beforeEach(() => {
    b = new BlockList();
  });

  afterAll(() => {
    // @ts-expect-error -- we're cleaning up
    b = undefined;
  });

  describe(".isBlockList(value)", () => {
    it('returns "true" for instances of BlockList', () => {
      expect(BlockList.isBlockList(b)).toBeTrue();
    });
    it.each([1, undefined, null, true, false, "string", {}, new Map(), new Set()])(`%p is not a BlockList`, value => {
      expect(BlockList.isBlockList(value)).toBeFalse();
    });
  });

  describe("#rules", () => {
    it("is an array", () => {
      expect(b.rules).toBeInstanceOf(Array);
      expect(b.rules).toStrictEqual([]);
    });

    it("cannot be overridden", () => {
      // NOTE: this doesn't throw in Node; it just no-ops
      // @ts-expect-error
      expect(() => (b.rules = true)).toThrow(TypeError);
      expect(b.rules).toStrictEqual([]);
    });

    it("cannot be manually added to", () => {
      expect(b.rules).toBeEmpty();
      // @ts-expect-error
      b.rules.push("foo");
      expect(b.rules).toBeEmpty();
    });
  });
});
