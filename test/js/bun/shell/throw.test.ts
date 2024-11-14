import { $ } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";

beforeAll(() => {
  $.nothrow();
});

describe("throw", () => {
  test("enabled globally", async () => {
    $.throws(true);
    let e;
    try {
      await $`ls ksjflkjfksjdflksdjflksdf`;
      expect("Woops").toBe("Should have thrown");
    } catch (err) {
      e = err;
    }
    expect(e).toBeDefined();
  });

  test("enabled locally", async () => {
    let e;
    try {
      await $`ls ksjflkjfksjdflksdjflksdf`.throws(true);
      expect("Woops").toBe("Should have thrown");
    } catch (err) {
      e = err;
    }
    expect(e).toBeDefined();
  });

  test("disable globally", async () => {
    $.throws(true);
    $.nothrow();
    try {
      await $`ls ksjflkjfksjdflksdjflksdf`;
    } catch (err) {
      expect("Woops").toBe("Should not have thrown");
    }
  });

  test("disable locally", async () => {
    $.throws(true);
    try {
      await $`ls ksjflkjfksjdflksdjflksdf`.nothrow();
    } catch (err) {
      expect("Woops").toBe("Should not have thrown");
    }
  });
});
