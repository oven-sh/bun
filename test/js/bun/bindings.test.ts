import { describe, expect, test } from "bun:test";
import { bindingTests } from 'bun:internal-for-testing';

/// Tests for bindings.zig
test('JSC.JSValue.get', () => {
  console.log('get');
  expect(bindingTests.slowGet({ something: 'hello' })).toBe('hello');
  expect(bindingTests.slowGet({ })).toBe(404);
  expect(bindingTests.slowGet({ get something() { return 'hello' } })).toBe('hello');
  expect(() => bindingTests.slowGet({ get something() { throw 'error'; } })).toThrow('error');
  console.log('end get');
});
test('JSC.JSValue.get (known property fast path)', () => {
  console.log('get fast path');
  expect(bindingTests.fastGet({ headers: 'hello' })).toBe('hello');
  expect(bindingTests.fastGet({ })).toBe(404);
  expect(bindingTests.fastGet({ get headers() { return 'hello' } })).toBe('hello');
  expect(() => bindingTests.fastGet({ get headers() { throw 'error'; } })).toThrow('error');
  console.log('end get fast path');
});
