import { describe, expect, test } from "bun:test";

describe.each(["foo", "bar"])("%s", () => {
  test.only("works", () => {
    expect(1).toBe(1);
  });
});
