import { mock, spyOn } from "bun:test";

const mockTrue = mock(() => true);
const mockFalse = mock(() => false);

test("should work with multiple imports from bun:test", () => {
  expect(mockTrue()).toEqual(true);
  expect(mockFalse()).toEqual(false);
});

describe("spyOn should work", () => {
  const obj = { foo: () => "original" };

  beforeEach(() => {
    spyOn(obj, "foo").mockReturnValue("mocked");
  });

  it("should spy on methods", () => {
    expect(obj.foo()).toBe("mocked");
  });
});
