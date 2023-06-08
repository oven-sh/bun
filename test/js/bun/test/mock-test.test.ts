import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

describe("mocks", () => {
  it("are callable", () => {
    const fn = mock(() => 42);
    expect(fn()).toBe(42);
    expect(fn.mock.calls.length).toBe(1);
    expect(fn.mock.calls[0].length).toBe(0);
    expect(fn).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
