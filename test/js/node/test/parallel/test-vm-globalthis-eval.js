'use strict';

// This test verifies that globalThis in VM contexts correctly provides access to
// built-in functions like eval. This was broken in Bun where globalThis would
// incorrectly return the sandbox object instead of the actual global object.
// See: https://github.com/oven-sh/bun/pull/22454

const common = require('../common');
const assert = require('assert');
const vm = require('vm');

// Test 1: Basic globalThis.eval access
{
  const context = {};
  vm.createContext(context);
  vm.runInContext('this.eval = globalThis.eval', context);
  assert.strictEqual(typeof context.eval, 'function', 'eval should be available via globalThis');
}

// Test 2: Verify all standard builtins are accessible via globalThis
{
  const context = {};
  vm.createContext(context);
  
  const builtins = [
    'eval', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'Array', 'Object', 'Function', 'String', 'Number', 'Boolean',
    'Date', 'RegExp', 'Error', 'TypeError', 'RangeError',
    'JSON', 'Math', 'Promise', 'Symbol',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect'
  ];
  
  for (const builtin of builtins) {
    vm.runInContext(`this.${builtin} = globalThis.${builtin}`, context);
    assert.notStrictEqual(context[builtin], undefined, 
      `${builtin} should be available via globalThis`);
  }
}

// Test 3: Simulate happy-dom's VMGlobalPropertyScript pattern
// This is the exact pattern that was failing in happy-dom
{
  const context = {};
  vm.createContext(context);
  
  const script = new vm.Script(`
    this.ArrayBuffer = globalThis.ArrayBuffer;
    this.Boolean = globalThis.Boolean;
    this.eval = globalThis.eval;
    this.Array = globalThis.Array;
    this.Object = globalThis.Object;
    this.Function = globalThis.Function;
  `);
  
  script.runInContext(context);
  
  assert.strictEqual(typeof context.eval, 'function', 'happy-dom pattern: eval should work');
  assert.strictEqual(typeof context.Array, 'function', 'happy-dom pattern: Array should work');
  assert.strictEqual(typeof context.Object, 'function', 'happy-dom pattern: Object should work');
  assert.strictEqual(typeof context.Function, 'function', 'happy-dom pattern: Function should work');
  assert.strictEqual(typeof context.Boolean, 'function', 'happy-dom pattern: Boolean should work');
  assert.strictEqual(typeof context.ArrayBuffer, 'function', 'happy-dom pattern: ArrayBuffer should work');
}

// Test 4: Verify globalThis returns the global object with builtins
{
  const context = {};
  vm.createContext(context);
  
  const result = vm.runInContext('typeof globalThis.eval', context);
  assert.strictEqual(result, 'function', 'globalThis.eval should be a function in VM context');
  
  // Test that we can actually use eval
  const evalResult = vm.runInContext('globalThis.eval("1 + 1")', context);
  assert.strictEqual(evalResult, 2, 'globalThis.eval should be functional');
}

// Test 5: Verify that globalThis properties can be used directly
{
  const context = {};
  vm.createContext(context);
  
  // Test Array constructor
  vm.runInContext('this.arr = globalThis.Array.from([1, 2, 3])', context);
  assert.deepStrictEqual(context.arr, [1, 2, 3], 'Array.from should work via globalThis');
  
  // Test Object methods
  vm.runInContext('this.keys = globalThis.Object.keys({a: 1, b: 2})', context);
  assert.deepStrictEqual(context.keys, ['a', 'b'], 'Object.keys should work via globalThis');
  
  // Test JSON methods
  vm.runInContext('this.json = globalThis.JSON.stringify({x: 1})', context);
  assert.strictEqual(context.json, '{"x":1}', 'JSON.stringify should work via globalThis');
}

// Test 6: Regression test - ensure the fix doesn't break normal context behavior
{
  const context = { customProp: 'test' };
  vm.createContext(context);
  
  // Custom properties should still be accessible
  const result = vm.runInContext('customProp', context);
  assert.strictEqual(result, 'test', 'Custom properties should still work');
  
  // Setting properties should still work
  vm.runInContext('this.newProp = 123', context);
  assert.strictEqual(context.newProp, 123, 'Setting properties should still work');
}