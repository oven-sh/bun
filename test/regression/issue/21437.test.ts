import { test, expect, mock } from "bun:test";

test("mock.clearAllMocks should exist and be callable", () => {
  // Create a mock function
  const mockFn = mock(() => "test");
  
  // Call the mock
  mockFn();
  expect(mockFn).toHaveBeenCalledTimes(1);
  
  // Test that clearAllMocks exists and is callable
  expect(typeof mock.clearAllMocks).toBe("function");
  
  // Call clearAllMocks
  mock.clearAllMocks();
  
  // Verify that the mock was cleared
  expect(mockFn).toHaveBeenCalledTimes(0);
});

test("mock.clearAllMocks should work the same as jest.clearAllMocks", () => {
  const mockFn = mock(() => "test");
  
  // Call the mock
  mockFn();
  expect(mockFn).toHaveBeenCalledTimes(1);
  
  // Use mock.clearAllMocks
  mock.clearAllMocks();
  expect(mockFn).toHaveBeenCalledTimes(0);
  
  // Call the mock again
  mockFn();
  expect(mockFn).toHaveBeenCalledTimes(1);
  
  // Use jest.clearAllMocks to verify they do the same thing
  jest.clearAllMocks();
  expect(mockFn).toHaveBeenCalledTimes(0);
});