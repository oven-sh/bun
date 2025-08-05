import { expect, jest, test } from "bun:test";

test("toHaveReturnedWith basic functionality", () => {
  const mockFn = jest.fn(() => "La Croix");

  // Function hasn't been called yet
  expect(() => {
    expect(mockFn).toHaveReturnedWith("La Croix");
  }).toThrow();

  // Call the function
  mockFn();

  // Should pass - the function returned 'La Croix'
  expect(mockFn).toHaveReturnedWith("La Croix");

  // Should fail - the function didn't return this value
  expect(() => {
    expect(mockFn).toHaveReturnedWith("Pepsi");
  }).toThrow();
});

test("toHaveReturnedWith with multiple returns", () => {
  const mockFn = jest.fn();

  mockFn.mockReturnValueOnce("first");
  mockFn.mockReturnValueOnce("second");
  mockFn.mockReturnValueOnce("third");

  // Call the function multiple times
  mockFn();
  mockFn();
  mockFn();

  // Should pass for all returned values
  expect(mockFn).toHaveReturnedWith("first");
  expect(mockFn).toHaveReturnedWith("second");
  expect(mockFn).toHaveReturnedWith("third");

  // Should fail for values not returned
  expect(() => {
    expect(mockFn).toHaveReturnedWith("fourth");
  }).toThrow();
});

test("toHaveReturnedWith with objects", () => {
  const obj = { name: "La Croix" };
  const mockFn = jest.fn(() => obj);

  mockFn();

  // Should pass with deep equality
  expect(mockFn).toHaveReturnedWith({ name: "La Croix" });

  // Should also pass with same object reference
  expect(mockFn).toHaveReturnedWith(obj);

  // Should fail with different object
  expect(() => {
    expect(mockFn).toHaveReturnedWith({ name: "Pepsi" });
  }).toThrow();
});

test("toHaveReturnedWith with arrays", () => {
  const mockFn = jest.fn(() => [1, 2, 3]);

  mockFn();

  // Should pass with deep equality
  expect(mockFn).toHaveReturnedWith([1, 2, 3]);

  // Should fail with different array
  expect(() => {
    expect(mockFn).toHaveReturnedWith([1, 2, 4]);
  }).toThrow();
});

test("toHaveReturnedWith with undefined and null", () => {
  const mockFn = jest.fn();

  mockFn(); // returns undefined by default
  mockFn.mockReturnValueOnce(null);
  mockFn();

  expect(mockFn).toHaveReturnedWith(undefined);
  expect(mockFn).toHaveReturnedWith(null);
});

test("toHaveReturnedWith with thrown errors", () => {
  const mockFn = jest.fn();

  mockFn.mockReturnValueOnce("success");
  mockFn(); // returns 'success'

  // Mock a throw for the next call
  mockFn.mockImplementationOnce(() => {
    throw new Error("Failed");
  });

  expect(() => mockFn()).toThrow("Failed");

  // Should still pass for the successful return
  expect(mockFn).toHaveReturnedWith("success");

  // But not for values that were never returned
  expect(() => {
    expect(mockFn).toHaveReturnedWith("Failed");
  }).toThrow();
});

test("toHaveReturnedWith with .not modifier", () => {
  const mockFn = jest.fn(() => "La Croix");

  mockFn();

  // Should pass - the function didn't return 'Pepsi'
  expect(mockFn).not.toHaveReturnedWith("Pepsi");

  // Should fail - the function did return 'La Croix'
  expect(() => {
    expect(mockFn).not.toHaveReturnedWith("La Croix");
  }).toThrow();
});

test("drink returns La Croix example from Jest docs", () => {
  const beverage = { name: "La Croix" };
  const drink = jest.fn(beverage => beverage.name);

  drink(beverage);

  expect(drink).toHaveReturnedWith("La Croix");
});

test("toHaveReturnedWith with primitive values", () => {
  const mockFn = jest.fn();

  mockFn.mockReturnValueOnce(42);
  mockFn.mockReturnValueOnce(true);
  mockFn.mockReturnValueOnce("hello");
  mockFn.mockReturnValueOnce(3.14);

  mockFn();
  mockFn();
  mockFn();
  mockFn();

  expect(mockFn).toHaveReturnedWith(42);
  expect(mockFn).toHaveReturnedWith(true);
  expect(mockFn).toHaveReturnedWith("hello");
  expect(mockFn).toHaveReturnedWith(3.14);

  // Should fail for values not returned
  expect(() => {
    expect(mockFn).toHaveReturnedWith(false);
  }).toThrow();

  expect(() => {
    expect(mockFn).toHaveReturnedWith(43);
  }).toThrow();
});

test("toHaveReturnedWith should require a mock function", () => {
  const notAMock = () => "La Croix";

  expect(() => {
    expect(notAMock).toHaveReturnedWith("La Croix");
  }).toThrow("Expected value must be a mock function");
});

test("toHaveReturnedWith should require an argument", () => {
  const mockFn = jest.fn(() => "La Croix");
  mockFn();

  expect(() => {
    // @ts-expect-error - testing invalid usage
    expect(mockFn).toHaveReturnedWith();
  }).toThrow();
});

test("toHaveReturnedWith with promises using async/await", async () => {
  const mockFn = jest.fn(async () => "async result");

  await mockFn();

  expect(mockFn).toHaveReturnedWith(expect.any(Promise));
});

test("toHaveReturnedWith checks the resolved value, not the promise", async () => {
  const mockFn = jest.fn(async () => "async result");

  await mockFn();

  // The mock tracks the promise as the return value, not the resolved value
  expect(mockFn).not.toHaveReturnedWith("async result");
});
