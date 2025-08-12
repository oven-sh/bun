// Test mixing named imports with default globals usage
import { mock } from "bun:test";
import * as path from "path";

const mockPath = mock(() => "/mocked/path");

test('should work with mixed imports', () => {
  // Using imported mock
  expect(mockPath()).toEqual("/mocked/path");
  
  // Using global test functions
  expect(path.join("a", "b")).toBe("a/b");
});

describe('mixed imports should not interfere', () => {
  beforeAll(() => {
    // This should work - beforeAll should be available as global
  });
  
  it('should have all test globals available', () => {
    expect(typeof beforeAll).toBe('function');
    expect(typeof afterAll).toBe('function');
    expect(typeof beforeEach).toBe('function');
    expect(typeof afterEach).toBe('function');
  });
});