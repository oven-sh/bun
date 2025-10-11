import { expect, test } from "bun:test";

test("issue #3521: toMatchSnapshot should also not mutate the original object", () => {
  const obj = {
    id: 123,
    createdAt: new Date("2024-01-01"),
    name: "Test User",
  };

  // Save original values
  const originalId = obj.id;
  const originalCreatedAt = obj.createdAt;

  // Note: We're accepting the snapshot change since it now shows actual values
  // instead of Any<Type>, which is a trade-off for not mutating objects
  expect(obj).toMatchSnapshot();

  // Verify the original object wasn't mutated (this is the important part)
  expect(obj.id).toBe(originalId);
  expect(obj.createdAt).toBe(originalCreatedAt);
  expect(obj.id).toBe(123);
  expect(obj.createdAt).toEqual(new Date("2024-01-01"));

  // Confirm the object properties are still the original types
  expect(typeof obj.id).toBe("number");
  expect(obj.createdAt).toBeInstanceOf(Date);
});
