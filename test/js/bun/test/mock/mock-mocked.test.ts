import { expect, expectTypeOf, jest, test, vi } from "bun:test";

// =============================================================================
// Runtime behavior: jest.mocked() / vi.mocked() return their input unchanged.
// =============================================================================

test("jest.mocked returns the input unchanged at runtime", () => {
  const fn = jest.fn(() => 42);
  const mocked = jest.mocked(fn);
  expect(mocked).toBe(fn);
});

test("jest.mocked returns objects unchanged at runtime", () => {
  const obj = { a: 1, b: jest.fn() };
  expect(jest.mocked(obj)).toBe(obj);
});

test("jest.mocked with shallow option returns input unchanged", () => {
  const obj = { nested: { fn: jest.fn() } };
  expect(jest.mocked(obj, { shallow: true })).toBe(obj);
  expect(jest.mocked(obj, { shallow: false })).toBe(obj);
});

test("vi.mocked returns the input unchanged at runtime", () => {
  const fn = jest.fn(() => 42);
  expect(vi.mocked(fn)).toBe(fn);
});

test("vi.mocked with shallow option returns input unchanged", () => {
  const obj = { nested: { fn: jest.fn() } };
  expect(vi.mocked(obj, { shallow: true })).toBe(obj);
});

test("jest.mocked with no arguments returns undefined", () => {
  // @ts-expect-error - testing runtime behavior with no args
  expect(jest.mocked()).toBe(undefined);
});

// =============================================================================
// Type-level validation
// =============================================================================

test("jest.mocked types a function as MockedFunction", () => {
  const fn = jest.fn((x: number) => x * 2);
  const mocked = jest.mocked(fn);

  // Return type should expose mock control methods
  expectTypeOf(mocked.mockReturnValue).toBeFunction();
  expectTypeOf(mocked.mockImplementation).toBeFunction();
  expectTypeOf(mocked.mockReset).toBeFunction();
  expectTypeOf(mocked.mock.calls).toEqualTypeOf<number[][]>();
});

test("jest.mocked types object properties correctly", () => {
  const obj = {
    greet: jest.fn((name: string) => `Hello, ${name}`),
    count: 42,
  };
  const mocked = jest.mocked(obj);

  // Function property should be typed as MockedFunction
  expectTypeOf(mocked.greet.mockReturnValue).toBeFunction();

  // Non-function property retains original type
  expectTypeOf(mocked.count).toEqualTypeOf<number>();
});

test("vi.mocked types match jest.mocked types", () => {
  const fn = jest.fn((x: number) => x * 2);
  const mocked = vi.mocked(fn);

  expectTypeOf(mocked.mockReturnValue).toBeFunction();
  expectTypeOf(mocked.mockImplementation).toBeFunction();
});
